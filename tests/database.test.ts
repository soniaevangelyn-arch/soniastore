import { describe, it, expect } from 'vitest';
import { createNeonClient } from '../src/lib/neonClient.ts';

describe('Neon Database & PostgREST Data API - Unit & Integration Tests', () => {
  const client = createNeonClient();

  it('harus dapat mengambil daftar produk dari tabel products', async () => {
    const { data, error } = await client
      .from('products')
      .select('*')
      .limit(10);

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(Array.isArray(data)).toBe(true);
    expect(data!.length).toBeGreaterThan(0);

    // Verifikasi struktur kolom produk
    const sample = data![0];
    expect(sample.id).toBeDefined();
    expect(sample.title).toBeDefined();
    expect(sample.price).toBeDefined();
    expect(sample.image_url).toBeDefined();
  });

  it('harus memuat URL gambar Vercel Blob untuk produk yang telah dimigrasi', async () => {
    const { data, error } = await client
      .from('products')
      .select('id, title, image_url')
      .limit(5);

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);

    // Setidaknya salah satu produk harus memiliki URL Vercel Blob yang valid
    const hasVercelBlobUrl = data!.some((p: any) =>
      p.image_url && p.image_url.includes('blob.vercel-storage.com')
    );
    expect(hasVercelBlobUrl).toBe(true);
  });

  it('harus mendukung pemfilteran (filtering) dan pengurutan (ordering)', async () => {
    const { data, error } = await client
      .from('products')
      .select('id, title, category, price')
      .order('price', { ascending: false })
      .limit(5);

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data!.length).toBeGreaterThan(0);

    // Pastikan urutan harga menurun
    if (data!.length >= 2) {
      expect(data![0].price).toBeGreaterThanOrEqual(data![1].price);
    }
  });

  it('harus dapat membaca data konfigurasi dari tabel settings', async () => {
    const { data, error } = await client
      .from('settings')
      .select('*');

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(Array.isArray(data)).toBe(true);

    const musicSetting = data?.find((s: any) => s.key === 'music_url');
    if (musicSetting) {
      expect(musicSetting.value).toContain('blob.vercel-storage.com');
    }
  });

  it('harus berhasil menjalankan siklus CRUD (Create, Read, Update, Delete) pada produk', async () => {
    const testTitle = `[AUTOMATED TEST] Produk Uji ${Date.now()}`;
    const testPayload = {
      title: testTitle,
      category: 'Perawatan & Kecantikan',
      subcategory: 'Skincare',
      price: 50000,
      sales: 0,
      affiliate_link: 'https://shopee.co.id/test-automated',
      image_url: 'https://d13ymxpzvpuehykd.public.blob.vercel-storage.com/product-images/test.jpg'
    };

    // 1. CREATE (Insert)
    const insertRes = await client
      .from('products')
      .insert([testPayload])
      .select();

    expect(insertRes.error).toBeNull();
    expect(insertRes.data).toBeDefined();
    expect(insertRes.data!.length).toBe(1);

    const createdProduct = insertRes.data![0];
    const createdId = createdProduct.id;
    expect(createdProduct.title).toBe(testTitle);

    // 2. READ (Select)
    const readRes = await client
      .from('products')
      .select('*')
      .eq('id', createdId)
      .single();

    expect(readRes.error).toBeNull();
    expect(readRes.data?.id).toBe(createdId);
    expect(readRes.data?.price).toBe(50000);

    // 3. UPDATE
    const updateRes = await client
      .from('products')
      .update({ price: 75000, sales: 5 })
      .eq('id', createdId)
      .select();

    expect(updateRes.error).toBeNull();
    expect(updateRes.data![0].price).toBe(75000);
    expect(updateRes.data![0].sales).toBe(5);

    // 4. DELETE
    const deleteRes = await client
      .from('products')
      .delete()
      .eq('id', createdId);

    expect(deleteRes.error).toBeNull();

    // Verifikasi penghapusan
    const verifyDelete = await client
      .from('products')
      .select('*')
      .eq('id', createdId);

    expect(verifyDelete.data?.length).toBe(0);
  });

  it('harus dapat mencatat interaksi ke tabel click_logs', async () => {
    const clickPayload = {
      product_id: null,
      clicked_at: new Date().toISOString()
    };

    const { data, error } = await client
      .from('click_logs')
      .insert([clickPayload])
      .select();

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data!.length).toBe(1);

    // Bersihkan klik tes
    if (data && data[0]?.id) {
      await client.from('click_logs').delete().eq('id', data[0].id);
    }
  });
});
