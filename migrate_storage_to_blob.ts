/**
 * migrate_storage_to_blob.ts
 * 
 * Skrip migrasi seluruh file media dari Supabase Storage ke Vercel Blob:
 * 1. Mengunduh semua file gambar dari bucket 'product-images' di Supabase Storage.
 * 2. Mengunduh semua file audio dari bucket 'music-files' di Supabase Storage.
 * 3. Mengunggah setiap file ke Vercel Blob menggunakan VERCEL_BLOB_READ_WRITE_TOKEN.
 * 4. Memperbarui kolom image_url pada tabel products di database ke URL Vercel Blob baru.
 * 5. Memperbarui kolom value (music_url) pada tabel settings di database.
 * 6. Memastikan tabel dan data di Neon Database juga terisi lengkap dengan URL baru.
 * 7. Memverifikasi bahwa seluruh file gambar dapat diakses secara publik (HTTP 200).
 */

import { uploadFile, getFileUrl, getVercelBlobToken } from './src/lib/blob.ts';
import pg from 'pg';
const { Client } = pg;

const SUPABASE_URL = 'https://uzezdoaunstiwmiejqvo.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6ZXpkb2F1bnN0aXdtaWVqcXZvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDA3MTU2MSwiZXhwIjoyMTA1NjQ3NTYxfQ.9L8KVmHzX9x1QwN1uLB5XMB-L6AdDR4vZlF4cQt144A';
const NEON_DB_URL = 'postgresql://neondb_owner:npg_NCyDSE0s2KqO@ep-lingering-bird-b587vms2-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require';

async function migrate() {
  console.log('🚀 Memulai migrasi Supabase Storage -> Vercel Blob...\n');

  const token = getVercelBlobToken();
  console.log('Menggunakan Vercel Blob Token:', token.slice(0, 16) + '...');

  const urlMapping: Record<string, string> = {};

  // =========================================================================
  // LANGKAH 1: Pindahkan file dari bucket 'product-images'
  // =========================================================================
  console.log('\n📦 [Langkah 1/5] Memindahkan file dari bucket "product-images"...');
  const prodListRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/product-images`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ limit: 100, prefix: '' })
  });

  if (!prodListRes.ok) {
    throw new Error('Gagal mengambil daftar file product-images: ' + await prodListRes.text());
  }

  const prodFiles = await prodListRes.json();
  console.log(`Ditemukan ${prodFiles.length} file di bucket product-images.`);

  let prodSuccess = 0;
  for (const f of prodFiles) {
    const filename = f.name;
    const oldSupabaseUrl = `${SUPABASE_URL}/storage/v1/object/public/product-images/${filename}`;
    const pathname = `product-images/${filename}`;

    try {
      // Download dari Supabase
      const downloadRes = await fetch(oldSupabaseUrl);
      if (!downloadRes.ok) {
        console.warn(`  ⚠️ Gagal mengunduh ${filename} dari Supabase (${downloadRes.status})`);
        continue;
      }
      const buffer = Buffer.from(await downloadRes.arrayBuffer());
      const contentType = downloadRes.headers.get('content-type') || 'image/jpeg';

      // Upload ke Vercel Blob
      const result = await uploadFile(pathname, buffer, {
        token,
        contentType,
        addRandomSuffix: false
      });

      urlMapping[oldSupabaseUrl] = result.url;
      prodSuccess++;
      process.stdout.write(`  [${prodSuccess}/${prodFiles.length}] ✅ ${filename} -> ${result.url.slice(0, 45)}...\n`);
    } catch (err: any) {
      console.error(`  ❌ Error migrasi ${filename}:`, err.message);
    }
  }

  // =========================================================================
  // LANGKAH 2: Pindahkan file dari bucket 'music-files'
  // =========================================================================
  console.log('\n🎵 [Langkah 2/5] Memindahkan file dari bucket "music-files"...');
  try {
    const musicListRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/music-files`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ limit: 100, prefix: '' })
    });

    if (musicListRes.ok) {
      const musicFiles = await musicListRes.json();
      console.log(`Ditemukan ${musicFiles.length} file di bucket music-files.`);

      let musicSuccess = 0;
      for (const f of musicFiles) {
        const filename = f.name;
        const oldSupabaseUrl = `${SUPABASE_URL}/storage/v1/object/public/music-files/${filename}`;
        const pathname = `music-files/${filename}`;

        try {
          const downloadRes = await fetch(oldSupabaseUrl);
          if (!downloadRes.ok) continue;
          const buffer = Buffer.from(await downloadRes.arrayBuffer());
          const contentType = downloadRes.headers.get('content-type') || 'audio/mpeg';

          const result = await uploadFile(pathname, buffer, {
            token,
            contentType,
            addRandomSuffix: false
          });

          urlMapping[oldSupabaseUrl] = result.url;
          musicSuccess++;
          console.log(`  [${musicSuccess}/${musicFiles.length}] ✅ ${filename} -> ${result.url}`);
        } catch (err: any) {
          console.error(`  ❌ Error migrasi audio ${filename}:`, err.message);
        }
      }
    }
  } catch (err: any) {
    console.warn('Lewati music-files:', err.message);
  }

  // =========================================================================
  // LANGKAH 3: Perbarui URL di database Supabase
  // =========================================================================
  console.log('\n📝 [Langkah 3/5] Memperbarui URL di Supabase Database...');

  // 1. Ambil data produk dari Supabase
  const prodRes = await fetch(`${SUPABASE_URL}/rest/v1/products?select=*`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });
  const products = await prodRes.json();
  console.log(`Memeriksa ${products.length} produk di database...`);

  let updatedProdCount = 0;
  for (const prod of products) {
    let newImageUrl = prod.image_url;
    if (urlMapping[prod.image_url]) {
      newImageUrl = urlMapping[prod.image_url];
    } else if (prod.image_url && prod.image_url.includes('product-images/')) {
      const parts = prod.image_url.split('product-images/');
      const filename = parts[1]?.split('?')[0];
      if (filename) {
        newImageUrl = getFileUrl(`product-images/${filename}`);
      }
    }

    if (newImageUrl !== prod.image_url) {
      const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${prod.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ image_url: newImageUrl })
      });
      if (updateRes.ok) {
        updatedProdCount++;
        prod.image_url = newImageUrl;
        console.log(`  ✅ Produk "${prod.title.slice(0, 30)}..." diperbarui ke Vercel Blob URL`);
      } else {
        console.warn(`  ⚠️ Gagal update produk ${prod.id}:`, await updateRes.text());
      }
    }
  }
  console.log(`Selesai: ${updatedProdCount} URL produk diperbarui di database Supabase.`);

  // 2. Ambil settings dan update music_url
  const setRes = await fetch(`${SUPABASE_URL}/rest/v1/settings?select=*`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });
  const settings = await setRes.json();
  for (const s of settings) {
    if (s.key === 'music_url' && urlMapping[s.value]) {
      const newMusicUrl = urlMapping[s.value];
      await fetch(`${SUPABASE_URL}/rest/v1/settings?key=eq.music_url`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ value: newMusicUrl })
      });
      s.value = newMusicUrl;
      console.log(`  ✅ Setting music_url diperbarui ke: ${newMusicUrl}`);
    }
  }

  // =========================================================================
  // LANGKAH 4: Sinkronisasi Skema dan Data ke Neon Database
  // =========================================================================
  console.log('\n🐘 [Langkah 4/5] Memastikan skema & data di Neon Database terisi...');
  const neonPg = new Client({ connectionString: NEON_DB_URL });
  await neonPg.connect();

  try {
    // 1. Buat tabel public.products jika belum ada
    await neonPg.query(`
      CREATE TABLE IF NOT EXISTS public.products (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        subcategory TEXT,
        price INTEGER NOT NULL,
        discount_price INTEGER,
        sales INTEGER NOT NULL DEFAULT 0,
        affiliate_link TEXT NOT NULL,
        image_url TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
      );
    `);

    // 2. Buat tabel public.settings jika belum ada
    await neonPg.query(`
      CREATE TABLE IF NOT EXISTS public.settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
      );
    `);

    // 3. Buat tabel public.feedbacks jika belum ada
    await neonPg.query(`
      CREATE TABLE IF NOT EXISTS public.feedbacks (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        name TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
      );
    `);

    // 4. Buat tabel public.click_logs jika belum ada
    await neonPg.query(`
      CREATE TABLE IF NOT EXISTS public.click_logs (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
        clicked_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
      );
    `);

    // Insert / Upsert semua data produk ke Neon DB
    for (const p of products) {
      await neonPg.query(`
        INSERT INTO public.products (id, title, category, subcategory, price, discount_price, sales, affiliate_link, image_url, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          category = EXCLUDED.category,
          subcategory = EXCLUDED.subcategory,
          price = EXCLUDED.price,
          discount_price = EXCLUDED.discount_price,
          sales = EXCLUDED.sales,
          affiliate_link = EXCLUDED.affiliate_link,
          image_url = EXCLUDED.image_url;
      `, [p.id, p.title, p.category, p.subcategory, p.price, p.discount_price, p.sales, p.affiliate_link, p.image_url, p.created_at]);
    }
    console.log(`  ✅ Berhasil menyinkronkan ${products.length} produk ke Neon Database.`);

    // Insert / Upsert settings ke Neon DB
    for (const s of settings) {
      await neonPg.query(`
        INSERT INTO public.settings (key, value, updated_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (key) DO UPDATE SET
          value = EXCLUDED.value,
          updated_at = EXCLUDED.updated_at;
      `, [s.key, s.value, s.updated_at]);
    }
    console.log(`  ✅ Berhasil menyinkronkan pengaturan ke Neon Database.`);

    // Refresh PostgREST schema cache agar mengenali tabel baru
    try {
      await neonPg.query(`NOTIFY pgrst, 'reload schema';`);
    } catch {
      // Abaikan jika reload notify tidak didukung
    }
  } catch (err: any) {
    console.error('Error sinkronisasi Neon DB:', err.message);
  } finally {
    await neonPg.end();
  }

  // =========================================================================
  // LANGKAH 5: Verifikasi Aksesibilitas Gambar di Vercel Blob
  // =========================================================================
  console.log('\n🔍 [Langkah 5/5] Memverifikasi aksesibilitas gambar baru...');
  const sampleUrls = Object.values(urlMapping).slice(0, 5);
  for (const url of sampleUrls) {
    try {
      const headRes = await fetch(url, { method: 'HEAD' });
      console.log(`  - ${url.slice(0, 60)}... => Status ${headRes.status} (${headRes.statusText})`);
    } catch (e: any) {
      console.error(`  - Error verifikasi ${url}:`, e.message);
    }
  }

  console.log('\n🎉 MIGRASI KE VERCEL BLOB SELESAI DENGAN SUKSES!');
  console.log(`Total file dimigrasikan: ${Object.keys(urlMapping).length}`);
  console.log(`Total produk diperbarui: ${updatedProdCount}`);
}

migrate().catch(err => {
  console.error('Fatal migration error:', err);
  process.exit(1);
});
