import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  uploadFile,
  getFileUrl,
  deleteFile,
  listFiles,
  createVercelBlobStorageAdapter,
  getVercelBlobToken,
  VERCEL_BLOB_STORE_URL
} from '../src/lib/blob.ts';

describe('Vercel Blob Storage - Unit & Integration Tests', () => {
  const testFileName = `test-run-${Date.now()}.txt`;
  const testPathname = `tests/${testFileName}`;
  let uploadedUrl = '';

  it('harus memuat VERCEL_BLOB_READ_WRITE_TOKEN dengan benar', () => {
    const token = getVercelBlobToken();
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    expect(token.startsWith('vercel_blob_rw_')).toBe(true);
  });

  it('getFileUrl() harus mengembalikan URL yang valid', () => {
    // 1. Kasus input URL absolut
    const existingUrl = 'https://d13ymxpzvpuehykd.public.blob.vercel-storage.com/test.jpg';
    expect(getFileUrl(existingUrl)).toBe(existingUrl);

    // 2. Kasus input pathname relatif
    const path = 'product-images/item-1.jpg';
    expect(getFileUrl(path)).toBe(`${VERCEL_BLOB_STORE_URL}/${path}`);

    // 3. Kasus input kosong
    expect(getFileUrl('')).toBe('');
  });

  it('uploadFile() harus berhasil mengunggah file ke Vercel Blob', async () => {
    const content = Buffer.from(`Halo Vercel Blob! Waktu tes: ${new Date().toISOString()}`);
    const result = await uploadFile(testPathname, content, {
      contentType: 'text/plain',
      addRandomSuffix: false
    });

    expect(result).toBeDefined();
    expect(result.pathname).toBe(testPathname);
    expect(result.url).toContain(testFileName);
    expect(result.downloadUrl).toContain('?download=1');

    uploadedUrl = result.url;

    // Verifikasi file bisa diakses secara publik (HTTP 200)
    const checkRes = await fetch(uploadedUrl, { method: 'HEAD' });
    expect(checkRes.status).toBe(200);
  });

  it('listFiles() harus dapat mengambil daftar file yang tersimpan', async () => {
    const res = await listFiles({ limit: 10 });
    expect(res).toBeDefined();
    expect(Array.isArray(res.blobs)).toBe(true);
    expect(res.blobs.length).toBeGreaterThan(0);
  });

  it('createVercelBlobStorageAdapter() harus kompatibel dengan Supabase Storage API', async () => {
    const adapter = createVercelBlobStorageAdapter();
    const bucket = adapter.from('test-bucket');

    expect(typeof bucket.upload).toBe('function');
    expect(typeof bucket.getPublicUrl).toBe('function');
    expect(typeof bucket.remove).toBe('function');

    // 1. Uji getPublicUrl
    const urlRes = bucket.getPublicUrl('sample.png');
    expect(urlRes.data.publicUrl).toBe(`${VERCEL_BLOB_STORE_URL}/test-bucket/sample.png`);

    // 2. Uji upload adapter
    const adapterPath = `adapter-${Date.now()}.txt`;
    const adapterBuffer = Buffer.from('Adapter Supabase compatibility test');
    const uploadRes = await bucket.upload(adapterPath, adapterBuffer);

    expect(uploadRes.error).toBeNull();
    expect(uploadRes.data?.path).toContain('test-bucket/');

    // 3. Uji remove adapter
    if (uploadRes.data?.path) {
      const removeRes = await bucket.remove([adapterPath]);
      expect(removeRes.error).toBeNull();
    }
  });

  it('deleteFile() harus berhasil menghapus file dari Vercel Blob', async () => {
    if (uploadedUrl) {
      const success = await deleteFile(uploadedUrl);
      expect(success).toBe(true);

      // Verifikasi di store bahwa file sudah terhapus
      const listAfter = await listFiles({ prefix: testPathname });
      expect(listAfter.blobs.length).toBe(0);
    }
  });
});
