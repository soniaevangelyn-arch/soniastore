import { put } from '@vercel/blob';

// Vercel Serverless Function: Extract Shopee Product Metadata
// Safe server-side scraper with automatic image upload to Vercel Blob

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_READ_WRITE_TOKEN || 'vercel_blob_rw_D13YMXPZVpuEHykD_mfsMybgl4xrXWWBAtMpY0NlfVWUwYR';

function cleanTitle(rawTitle) {
  if (!rawTitle) return '';
  return rawTitle
    .replace(/^Jual\s+/i, '')
    .replace(/^Beli\s+/i, '')
    .replace(/\s*\|\s*Shopee\s+Indonesia$/i, '')
    .replace(/\s*\|\s*Shopee$/i, '')
    .replace(/\.\.\.$/, '')
    .trim();
}

function detectCategory(text) {
  const t = (text || '').toLowerCase();

  // 1. Makeup
  const makeupKeywords = [
    'lip', 'lipstik', 'lipstick', 'lip cream', 'lip gloss', 'lip lacquer', 
    'lip tint', 'lip vinyl', 'cushion', 'foundation', 'mascara', 'maskara', 
    'eyeshadow', 'bedak', 'powder', 'blush', 'eyebrow', 'alis', 'eyeliner', 
    'concealer', 'contour', 'highlighter', 'setting spray', 'makeup', 'make up'
  ];
  for (const kw of makeupKeywords) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(t) || t.includes(kw)) {
      return { category: 'Perawatan & Kecantikan', subcategory: 'Makeup' };
    }
  }

  // 2. Skincare
  const skincareKeywords = [
    'serum', 'moisturizer', 'sunscreen', 'sunblock', 'toner', 'cleanser', 
    'facial wash', 'face wash', 'essence', 'micellar', 'ceramide', 'retinol', 
    'niacinamide', 'acne', 'jerawat', 'masker wajah', 'sheet mask', 
    'sleeping mask', 'eye cream', 'ampoule', 'pelembab', 'skincare'
  ];
  for (const kw of skincareKeywords) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(t) || t.includes(kw)) {
      return { category: 'Perawatan & Kecantikan', subcategory: 'Skincare' };
    }
  }

  // 3. Hair Care
  const hairKeywords = [
    'shampoo', 'sampo', 'conditioner', 'kondisioner', 'hair oil', 
    'hair mask', 'hair tonic', 'minyak kemiri', 'pomade', 'wax rambut', 'hair'
  ];
  for (const kw of hairKeywords) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(t) || t.includes(kw)) {
      return { category: 'Perawatan & Kecantikan', subcategory: 'Hair Care' };
    }
  }

  // 4. Body Care
  const bodyKeywords = [
    'body lotion', 'lotion', 'body wash', 'sabun mandi', 'body scrub', 
    'scrub', 'lulur', 'deodorant', 'body serum', 'hand cream', 'body butter'
  ];
  for (const kw of bodyKeywords) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(t) || t.includes(kw)) {
      return { category: 'Perawatan & Kecantikan', subcategory: 'Body Care' };
    }
  }

  // 5. Tumbler
  const tumblerKeywords = [
    'tumbler', 'tambler', 'botol minum', 'termos', 'canteen', 'corkcicle', 'stanley', 'vacuum flask'
  ];
  for (const kw of tumblerKeywords) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(t) || t.includes(kw)) {
      return { category: 'Tumbler', subcategory: null };
    }
  }

  // 6. Outfit
  const outfitKeywords = [
    'baju', 'dress', 'gaun', 'blouse', 'kemeja', 'rok', 'skirt', 'celana', 
    'pants', 'cardigan', 'knit', 'sweater', 'outer', 'jacket', 'jaket', 
    'blazer', 'vest', 'hijab', 'pashmina', 'jilbab', 'kaos', 'outfit', 'kulot', 'one set'
  ];
  for (const kw of outfitKeywords) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(t) || t.includes(kw)) {
      return { category: 'Outfit', subcategory: null };
    }
  }

  // 7. Parfum
  const parfumKeywords = [
    'parfum', 'perfume', 'edp', 'edt', 'body mist', 'fragrance', 'cologne', 'minyak wangi', 'scent'
  ];
  for (const kw of parfumKeywords) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(t) || t.includes(kw)) {
      return { category: 'Parfum', subcategory: null };
    }
  }

  // 8. Herbal Kecantikan
  const herbalKeywords = [
    'herbal', 'collagen drink', 'minuman kolagen', 'teh diet', 'teh pelangsing', 
    'jamu', 'suplemen kecantikan', 'suplemen kulit', 'gluta', 'glutathione', 'kapsul herbal'
  ];
  for (const kw of herbalKeywords) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(t) || t.includes(kw)) {
      return { category: 'Herbal Kecantikan', subcategory: null };
    }
  }

  return { category: '', subcategory: null };
}

function detectBadge(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('shopee mall') || t.includes('official store') || t.includes('official shop')) {
    return 'Shopee Mall';
  }
  if (t.includes('star+') || t.includes('star plus')) {
    return 'Star+';
  }
  if (t.includes('star seller') || t.includes('star')) {
    return 'Star Seller';
  }
  return null;
}

function extractPrices(text, html) {
  // 1. Cek meta tags spesifik harga jika ada
  const ogPriceMatch = html && html.match(/<meta[^>]*property=["'](?:product|og):price:amount["'][^>]*content=["']([^"']+)["']/i);
  if (ogPriceMatch) {
    const val = parseInt(ogPriceMatch[1].replace(/[^\d]/g, ''), 10);
    if (!isNaN(val) && val > 0) {
      return { price: val, discount_price: null };
    }
  }

  // 2. Cek format Rp ... di text
  const matches = (text || '').match(/Rp\s*([\d\.\,]+)/gi);
  if (!matches) return { price: null, discount_price: null };

  const parsed = matches.map(m => {
    const num = parseInt(m.replace(/[^\d]/g, ''), 10);
    return isNaN(num) ? null : num;
  }).filter(n => n && n >= 500);

  if (parsed.length === 0) return { price: null, discount_price: null };
  if (parsed.length === 1) return { price: parsed[0], discount_price: null };

  const unique = Array.from(new Set(parsed)).sort((a, b) => b - a);
  return {
    price: unique[0],
    discount_price: unique.length > 1 ? unique[unique.length - 1] : null
  };
}

export default async function handler(req, res) {
  // Set CORS headers
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

  let targetUrl = '';
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {}
    }
    targetUrl = body && (body.url || body.affiliate_link);
  } else if (req.method === 'GET') {
    targetUrl = req.query && (req.query.url || req.query.affiliate_link);
  }

  if (!targetUrl || typeof targetUrl !== 'string' || !targetUrl.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Parameter URL affiliate Shopee wajib disertakan.'
    });
  }

  targetUrl = targetUrl.trim();

  // Validasi domain Shopee
  const isShopeeDomain = /shopee\.(co\.id|com|sg|my|vn|ph|th)|(s|my|vn)\.shopee\.co\.id|shope\.ee|shp\.ee/i.test(targetUrl);
  if (!isShopeeDomain) {
    return res.status(400).json({
      success: false,
      message: 'URL yang dimasukkan bukan tautan resmi Shopee.'
    });
  }

  try {
    const headers = {
      'User-Agent': 'WhatsApp/2.21.12.21 A',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
    };

    const fetchRes = await fetch(targetUrl, {
      headers,
      redirect: 'follow'
    });

    if (!fetchRes.ok && fetchRes.status >= 500) {
      return res.status(502).json({
        success: false,
        message: `Gagal mengakses halaman Shopee (status: ${fetchRes.status}).`
      });
    }

    const html = await fetchRes.text();

    // Cek apakah diarahkan ke error_page oleh Shopee
    if (fetchRes.url.includes('error_page') || fetchRes.url.includes('/error') || (html && html.includes('shope.ee/error_page'))) {
      return res.status(200).json({
        success: false,
        message: 'Tautan Shopee ini tidak aktif atau diarahkan ke halaman error oleh Shopee. Silakan gunakan tautan produk aktif atau isi form secara manual.',
        affiliate_url: targetUrl
      });
    }

    function getMeta(prop) {
      const r1 = new RegExp(`<meta[^>]*property=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i');
      const m1 = html.match(r1);
      if (m1) return m1[1];
      const r2 = new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${prop}["']`, 'i');
      const m2 = html.match(r2);
      if (m2) return m2[1];
      const r3 = new RegExp(`<meta[^>]*name=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i');
      const m3 = html.match(r3);
      if (m3) return m3[1];
      return null;
    }

    let rawTitle = getMeta('og:title') || getMeta('twitter:title') || (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1];
    let imageUrl = getMeta('og:image') || getMeta('og:square_image') || getMeta('twitter:image');
    let description = getMeta('og:description') || getMeta('twitter:description') || getMeta('description');

    // Jika judul terpotong (...) dari shortlink, coba ambil judul lengkap dari canonical redirect URL
    let fullTitle = rawTitle;
    if (rawTitle && rawTitle.endsWith('...')) {
      try {
        const redirectRes = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
          },
          redirect: 'follow'
        });
        const match = redirectRes.url.match(/(\d{5,})\/(\d{7,})/);
        if (match) {
          const [_, shopid, itemid] = match;
          const prodRes = await fetch(`https://shopee.co.id/product/${shopid}/${itemid}`, { headers });
          if (prodRes.ok) {
            const prodHtml = await prodRes.text();
            const fullTitleMatch = prodHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (fullTitleMatch && fullTitleMatch[1]) {
              fullTitle = fullTitleMatch[1];
            }
          }
        }
      } catch (err) {
        // Fallback ke rawTitle
      }
    }

    const title = cleanTitle(fullTitle || rawTitle);

    if (!title || title.toLowerCase().includes('mkt single page') || (!imageUrl && !description)) {
      return res.status(200).json({
        success: false,
        message: 'Tidak dapat mengambil metadata dari link Shopee ini (halaman produk tidak ditemukan atau link sudah kadaluarsa). Silakan gunakan link yang masih aktif atau isi form manual.',
        affiliate_url: targetUrl
      });
    }

    const textContext = `${title} ${description || ''}`;
    const { category, subcategory } = detectCategory(textContext);
    const badge = detectBadge(textContext);
    const prices = extractPrices(textContext, html);

    // Otomatis download foto dari Shopee dan upload ke Vercel Blob
    let finalImageUrl = imageUrl || '';
    let isUploadedToBlob = false;

    if (imageUrl && BLOB_TOKEN) {
      try {
        const imgRes = await fetch(imageUrl);
        if (imgRes.ok) {
          const arrayBuffer = await imgRes.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const pathname = `product-images/shopee_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.jpg`;
          const blobUpload = await put(pathname, buffer, {
            access: 'public',
            token: BLOB_TOKEN
          });
          if (blobUpload && blobUpload.url) {
            finalImageUrl = blobUpload.url;
            isUploadedToBlob = true;
          }
        }
      } catch (blobErr) {
        console.warn('Gagal upload otomatis ke Vercel Blob, fallback ke CDN Shopee:', blobErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Metadata produk Shopee berhasil diambil.',
      data: {
        affiliate_url: targetUrl, // Tetap gunakan link affiliate asli
        title: title || '',
        image_url: finalImageUrl,
        is_blob: isUploadedToBlob,
        category: category || '',
        subcategory: subcategory || null,
        badge: badge || null,
        price: prices.price || null,
        discount_price: prices.discount_price || null,
        description: description || ''
      }
    });

  } catch (error) {
    console.error('Shopee metadata scraping error:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat memproses link Shopee: ' + error.message,
      affiliate_url: targetUrl
    });
  }
}
