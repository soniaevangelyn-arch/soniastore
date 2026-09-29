/**
 * src/lib/blob.ts
 * 
 * Vercel Blob Storage Client.
 * Menginisialisasi Vercel Blob dengan VERCEL_BLOB_READ_WRITE_TOKEN dari .env.migration / environment.
 * Menyediakan fungsi: uploadFile, getFileUrl, deleteFile, listFiles, dan storage adapter.
 */

// Kredensial default dari .env.migration
export const DEFAULT_VERCEL_BLOB_TOKEN = 'vercel_blob_rw_D13YMXPZVpuEHykD_mfsMybgl4xrXWWBAtMpY0NlfVWUwYR';
export const VERCEL_BLOB_STORE_URL = 'https://d13ymxpzvpuehykd.public.blob.vercel-storage.com';

/**
 * Mendapatkan Vercel Blob Token dari runtime environment
 */
export function getVercelBlobToken(): string {
  // 1. Browser window __ENV__
  if (typeof window !== 'undefined') {
    const win = window as any;
    if (win.__ENV__?.VERCEL_BLOB_READ_WRITE_TOKEN) {
      return win.__ENV__.VERCEL_BLOB_READ_WRITE_TOKEN;
    }
    if (win.VERCEL_BLOB_TOKEN) {
      return win.VERCEL_BLOB_TOKEN;
    }
  }

  // 2. Node.js process.env
  if (typeof process !== 'undefined' && process.env) {
    if (process.env.VERCEL_BLOB_READ_WRITE_TOKEN) {
      return process.env.VERCEL_BLOB_READ_WRITE_TOKEN;
    }

    // 3. Fallback baca .env.migration jika di Node
    try {
      const fs = (process as any).getBuiltinModule ? (process as any).getBuiltinModule('fs') : undefined;
      const path = (process as any).getBuiltinModule ? (process as any).getBuiltinModule('path') : undefined;
      if (fs && path) {
        const envPath = path.resolve(process.cwd(), '.env.migration');
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, 'utf-8');
          for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (trimmed.startsWith('VERCEL_BLOB_READ_WRITE_TOKEN=')) {
              let val = trimmed.split('=')[1]?.trim() || '';
              if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
              }
              if (val) return val;
            }
          }
        }
      }
    } catch {
      // Abaikan jika tidak di Node
    }
  }

  return DEFAULT_VERCEL_BLOB_TOKEN;
}

export interface BlobUploadOptions {
  token?: string;
  contentType?: string;
  addRandomSuffix?: boolean;
  access?: 'public';
}

export interface BlobUploadResult {
  url: string;
  downloadUrl: string;
  pathname: string;
  contentType?: string;
}

// In-memory cache pemetaan path ke URL
const blobUrlCache = new Map<string, string>();

/**
 * Unggah file ke Vercel Blob Storage
 * Mendukung File, Blob, Buffer, Uint8Array, atau string di browser maupun Node.js
 */
export async function uploadFile(
  pathname: string,
  file: File | Blob | ArrayBuffer | Uint8Array | Buffer | string,
  options?: BlobUploadOptions
): Promise<BlobUploadResult> {
  const token = options?.token || getVercelBlobToken();
  const cleanPath = pathname.replace(/^\/+/, '');
  const addSuffix = options?.addRandomSuffix ? 'true' : 'false';

  const uploadEndpoint = `https://blob.vercel-storage.com/${cleanPath}`;

  const headers: Record<string, string> = {
    'authorization': `Bearer ${token}`
  };

  if (options?.contentType) {
    headers['content-type'] = options.contentType;
  } else if (typeof File !== 'undefined' && file instanceof File && file.type) {
    headers['content-type'] = file.type;
  } else if (typeof Blob !== 'undefined' && file instanceof Blob && file.type) {
    headers['content-type'] = file.type;
  }

  const res = await fetch(uploadEndpoint, {
    method: 'PUT',
    headers,
    body: file as any
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Upload Vercel Blob gagal (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  const publicUrl = data.url || `${VERCEL_BLOB_STORE_URL}/${cleanPath}`;
  const downloadUrl = data.downloadUrl || `${publicUrl}?download=1`;

  // Simpan di cache
  blobUrlCache.set(cleanPath, publicUrl);
  blobUrlCache.set(pathname, publicUrl);

  return {
    url: publicUrl,
    downloadUrl,
    pathname: data.pathname || cleanPath,
    contentType: data.contentType
  };
}

/**
 * Mendapatkan Public URL untuk file di Vercel Blob
 */
export function getFileUrl(pathnameOrUrl: string): string {
  if (!pathnameOrUrl) return '';

  // Jika sudah berupa URL penuh Vercel Blob atau HTTP lain, kembalikan langsung
  if (pathnameOrUrl.startsWith('http://') || pathnameOrUrl.startsWith('https://')) {
    return pathnameOrUrl;
  }

  // Cek cache
  const cached = blobUrlCache.get(pathnameOrUrl) || blobUrlCache.get(pathnameOrUrl.replace(/^\/+/, ''));
  if (cached) return cached;

  const cleanPath = pathnameOrUrl.replace(/^\/+/, '');
  return `${VERCEL_BLOB_STORE_URL}/${cleanPath}`;
}

/**
 * Menghapus file dari Vercel Blob Storage berdasarkan URL atau pathname
 */
export async function deleteFile(urlOrPathname: string, options?: { token?: string }): Promise<boolean> {
  const token = options?.token || getVercelBlobToken();
  const targetUrl = urlOrPathname.startsWith('http') ? urlOrPathname : getFileUrl(urlOrPathname);

  try {
    const res = await fetch('https://blob.vercel-storage.com/delete', {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ urls: [targetUrl] })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[VercelBlob] Hapus file gagal (${res.status}): ${errText}`);
      return false;
    }

    // Hapus dari cache jika ada
    blobUrlCache.delete(urlOrPathname);
    blobUrlCache.delete(urlOrPathname.replace(/^\/+/, ''));
    return true;
  } catch (err: any) {
    console.warn(`[VercelBlob] Error saat deleteFile:`, err.message);
    return false;
  }
}

/**
 * Daftar file di Vercel Blob Storage
 */
export async function listFiles(options?: { prefix?: string; limit?: number; token?: string }) {
  const token = options?.token || getVercelBlobToken();
  const params = new URLSearchParams();
  if (options?.prefix) params.set('prefix', options.prefix);
  if (options?.limit) params.set('limit', String(options.limit));

  const url = `https://blob.vercel-storage.com${params.toString() ? `?${params.toString()}` : ''}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'authorization': `Bearer ${token}`
    }
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`List files Vercel Blob gagal (${res.status}): ${errText}`);
  }

  return await res.json();
}

/**
 * Adapter Storage Vercel Blob yang kompatibel dengan Supabase Storage API
 */
export function createVercelBlobStorageAdapter(token?: string) {
  const authToken = token || getVercelBlobToken();

  return {
    from: (bucket: string) => ({
      upload: async (filePath: string, file: File | Blob | ArrayBuffer | Uint8Array, options?: any) => {
        try {
          const pathname = `${bucket}/${filePath.replace(/^\/+/, '')}`;
          const res = await uploadFile(pathname, file, { token: authToken, addRandomSuffix: false });
          return {
            data: { path: res.pathname, fullPath: res.pathname, url: res.url },
            error: null
          };
        } catch (err: any) {
          console.error(`[VercelBlobStorage] Error upload:`, err);
          return {
            data: null,
            error: err
          };
        }
      },
      getPublicUrl: (filePath: string) => {
        const pathname = `${bucket}/${filePath.replace(/^\/+/, '')}`;
        return {
          data: {
            publicUrl: getFileUrl(pathname)
          }
        };
      },
      remove: async (filePaths: string[]) => {
        const results = await Promise.all(
          filePaths.map(p => {
            const pathname = `${bucket}/${p.replace(/^\/+/, '')}`;
            return deleteFile(pathname, { token: authToken });
          })
        );
        return {
          data: results,
          error: null
        };
      }
    })
  };
}

// Expose ke window untuk browser environment
if (typeof window !== 'undefined') {
  const win = window as any;
  win.VercelBlob = {
    uploadFile,
    getFileUrl,
    deleteFile,
    listFiles,
    createVercelBlobStorageAdapter,
    DEFAULT_VERCEL_BLOB_TOKEN,
    VERCEL_BLOB_STORE_URL
  };
}
