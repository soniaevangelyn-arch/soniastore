import { Pool } from '@neondatabase/serverless';
import { del } from '@vercel/blob';

const NEON_DB_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || 'postgresql://neondb_owner:npg_NCyDSE0s2KqO@ep-lingering-bird-b587vms2-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require';
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_READ_WRITE_TOKEN || 'vercel_blob_rw_D13YMXPZVpuEHykD_mfsMybgl4xrXWWBAtMpY0NlfVWUwYR';

const pool = new Pool({ connectionString: NEON_DB_URL });

async function verifyShopeeUrl(url) {
  if (!url || typeof url !== 'string' || !url.trim()) {
    return { isBroken: true, reason: 'URL affiliate kosong' };
  }

  const trimmed = url.trim();
  const isShopee = /shopee\.(co\.id|com|sg|my|vn|ph|th)|(s|my|vn)\.shopee\.co\.id|shope\.ee|shp\.ee/i.test(trimmed);
  if (!isShopee) {
    return { isBroken: true, reason: 'Bukan link resmi Shopee' };
  }

  try {
    const res = await fetch(trimmed, {
      headers: {
        'User-Agent': 'WhatsApp/2.21.12.21 A',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      redirect: 'follow'
    });

    const finalUrl = res.url || '';
    if (!res.ok && res.status >= 400) {
      return { isBroken: true, reason: `Link mengembalikan status error HTTP ${res.status}` };
    }

    if (finalUrl.includes('error_page') || finalUrl.includes('/error') || finalUrl.includes('shope.ee/error_page')) {
      return { isBroken: true, reason: 'Produk sudah dihapus atau link diarahkan ke halaman error oleh Shopee' };
    }

    const html = await res.text();
    if (html.includes('shope.ee/error_page')) {
      return { isBroken: true, reason: 'Produk sudah tidak tersedia di Shopee' };
    }

    const titleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) || 
                       html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    if (!title || title.toLowerCase().includes('mkt single page') || title.toLowerCase() === 'shopee' || title.toLowerCase().startsWith('error')) {
      return { isBroken: true, reason: 'Metadata produk tidak ditemukan (kemungkinan produk dihapus)' };
    }

    return { isBroken: false, title, finalUrl };
  } catch (err) {
    return { isBroken: true, reason: 'Gagal menghubungi server Shopee: ' + err.message };
  }
}

// Menghapus produk yang telah berstatus error lebih dari 24 jam tanpa respon admin
async function purgeExpiredBrokenProducts() {
  try {
    const query = `
      SELECT id, title, image_url, error_detected_at 
      FROM public.products 
      WHERE link_status = 'error' 
        AND error_detected_at IS NOT NULL 
        AND error_detected_at < (NOW() - INTERVAL '24 hours');
    `;
    const { rows: expiredItems } = await pool.query(query);

    if (expiredItems.length === 0) {
      return { count: 0, items: [] };
    }

    const expiredIds = expiredItems.map(p => p.id);

    // Hapus file gambar dari Vercel Blob jika ada
    for (const item of expiredItems) {
      if (item.image_url && item.image_url.includes('blob.vercel-storage.com')) {
        try {
          await del(item.image_url, { token: BLOB_TOKEN });
        } catch (e) {
          console.warn('Gagal menghapus blob file:', item.image_url, e.message);
        }
      }
    }

    // Hapus dari Neon Database
    await pool.query('DELETE FROM public.products WHERE id = ANY($1::uuid[])', [expiredIds]);

    return { count: expiredItems.length, items: expiredItems };
  } catch (err) {
    console.error('Error saat purge produk kadaluarsa:', err);
    return { count: 0, items: [], error: err.message };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const action = req.query.action || (req.body && req.body.action) || 'status';

  // 1. Purge produk kadaluarsa (> 24 jam)
  const purgeResult = await purgeExpiredBrokenProducts();

  // GET: Cek status produk bermasalah saat ini
  if (req.method === 'GET' || action === 'status') {
    try {
      const { rows: brokenItems } = await pool.query(`
        SELECT id, title, category, subcategory, affiliate_link, image_url, link_status, error_detected_at, error_reason
        FROM public.products
        WHERE link_status = 'error'
        ORDER BY error_detected_at ASC;
      `);

      const now = Date.now();
      const enriched = brokenItems.map(p => {
        const detectedMs = new Date(p.error_detected_at).getTime();
        const deadlineMs = detectedMs + 24 * 60 * 60 * 1000;
        const remainingMs = Math.max(0, deadlineMs - now);
        const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
        const remainingMinutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

        return {
          ...p,
          remaining_ms: remainingMs,
          remaining_time_label: remainingMs > 0 ? `${remainingHours} jam ${remainingMinutes} menit` : 'Segera dihapus'
        };
      });

      return res.status(200).json({
        success: true,
        auto_purged_count: purgeResult.count,
        auto_purged_items: purgeResult.items,
        broken_count: enriched.length,
        broken_products: enriched
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // POST: Verifikasi satu produk
  if (action === 'check_single') {
    const { id, affiliate_link } = req.body || {};
    if (!id || !affiliate_link) {
      return res.status(400).json({ success: false, message: 'ID dan affiliate_link wajib diisi' });
    }

    const check = await verifyShopeeUrl(affiliate_link);
    if (check.isBroken) {
      // Jika sebelumnya belum error, catat waktu error sekarang
      await pool.query(`
        UPDATE public.products
        SET link_status = 'error',
            error_detected_at = COALESCE(error_detected_at, NOW()),
            error_reason = $2
        WHERE id = $1;
      `, [id, check.reason]);

      return res.status(200).json({
        success: true,
        status: 'error',
        reason: check.reason,
        product_id: id
      });
    } else {
      // Link sehat, reset status error
      await pool.query(`
        UPDATE public.products
        SET link_status = 'ok',
            error_detected_at = NULL,
            error_reason = NULL
        WHERE id = $1;
      `, [id]);

      return res.status(200).json({
        success: true,
        status: 'ok',
        product_id: id
      });
    }
  }

  // POST: Admin menyelesaikan / mengabaikan error (tandai produk aman / dipertahankan)
  if (action === 'resolve') {
    const { id } = req.body || {};
    if (!id) {
      return res.status(400).json({ success: false, message: 'ID produk wajib diisi' });
    }

    await pool.query(`
      UPDATE public.products
      SET link_status = 'ok',
          error_detected_at = NULL,
          error_reason = NULL
      WHERE id = $1;
    `, [id]);

    return res.status(200).json({ success: true, message: 'Status link berhasil dipulihkan' });
  }

  // POST: Hapus sekarang tanpa menunggu 24 jam
  if (action === 'delete_now') {
    const { id } = req.body || {};
    if (!id) {
      return res.status(400).json({ success: false, message: 'ID produk wajib diisi' });
    }

    const { rows } = await pool.query('SELECT image_url FROM public.products WHERE id = $1', [id]);
    if (rows.length > 0 && rows[0].image_url && rows[0].image_url.includes('blob.vercel-storage.com')) {
      try {
        await del(rows[0].image_url, { token: BLOB_TOKEN });
      } catch (e) {}
    }

    await pool.query('DELETE FROM public.products WHERE id = $1', [id]);
    return res.status(200).json({ success: true, message: 'Produk berhasil dihapus' });
  }

  return res.status(400).json({ success: false, message: 'Aksi tidak dikenali' });
}
