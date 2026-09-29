/**
 * src/lib/neonClient.ts
 * 
 * Inisialisasi klien Neon menggunakan @neondatabase/neon-js.
 * Mengintegrasikan Neon Data API (PostgREST) dan Neon Auth (Managed Better Auth)
 * dengan dukungan penuh Better Auth methods dan adapter kompatibilitas.
 */

import { createClient, BetterAuthVanillaAdapter } from '@neondatabase/neon-js';
import {
  createVercelBlobStorageAdapter,
  uploadFile,
  getFileUrl,
  deleteFile,
  listFiles,
  DEFAULT_VERCEL_BLOB_TOKEN
} from './blob.ts';

// Kredensial default dari .env.migration
export const NEON_DATA_API_URL = 'https://ep-lingering-bird-b587vms2.apirest.c-7.us-east-2.aws.neon.tech/neondb/rest/v1';
export const NEON_AUTH_URL = 'https://ep-lingering-bird-b587vms2.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth';
export const VERCEL_BLOB_TOKEN = 'vercel_blob_rw_D13YMXPZVpuEHykD_mfsMybgl4xrXWWBAtMpY0NlfVWUwYR';

// Pastikan lingkungan Node.js memiliki header Origin default untuk Better Auth dan retry transient
if (typeof window === 'undefined' && typeof globalThis !== 'undefined' && globalThis.fetch) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function (input: any, init?: any) {
    const headers = new Headers(init?.headers || {});
    if (!headers.has('Origin') && !headers.has('origin')) {
      headers.set('Origin', 'http://localhost:3000');
    }
    const modifiedInit = { ...init, headers };
    try {
      return await originalFetch(input, modifiedInit);
    } catch (err: any) {
      if (err?.message?.includes('fetch failed')) {
        await new Promise((r) => setTimeout(r, 800));
        return await originalFetch(input, modifiedInit);
      }
      throw err;
    }
  };
}

/**
 * Membaca konfigurasi runtime (Node.js process.env atau browser window / fallback)
 */
export function getEnvConfig(): { authUrl: string; dataApiUrl: string; blobToken: string } {
  let authUrl = NEON_AUTH_URL;
  let dataApiUrl = NEON_DATA_API_URL;
  let blobToken = VERCEL_BLOB_TOKEN;

  // 1. Cek browser global (jika diset via window.__ENV__)
  if (typeof window !== 'undefined') {
    const win = window as any;
    if (win.__ENV__?.NEON_AUTH_URL) authUrl = win.__ENV__.NEON_AUTH_URL;
    if (win.__ENV__?.NEON_DATA_API_URL) dataApiUrl = win.__ENV__.NEON_DATA_API_URL;
    if (win.__ENV__?.VERCEL_BLOB_READ_WRITE_TOKEN) blobToken = win.__ENV__.VERCEL_BLOB_READ_WRITE_TOKEN;
  }

  // 2. Cek process.env jika di lingkungan Node.js
  if (typeof process !== 'undefined' && process.env) {
    if (process.env.NEON_AUTH_URL) authUrl = process.env.NEON_AUTH_URL;
    if (process.env.NEON_DATA_API_URL) dataApiUrl = process.env.NEON_DATA_API_URL;
    if (process.env.VERCEL_BLOB_READ_WRITE_TOKEN) blobToken = process.env.VERCEL_BLOB_READ_WRITE_TOKEN;

    // Optional: jika ada file .env.migration, baca secara dinamis tanpa static import
    try {
      const fs = (process as any).getBuiltinModule ? (process as any).getBuiltinModule('fs') : undefined;
      const path = (process as any).getBuiltinModule ? (process as any).getBuiltinModule('path') : undefined;
      if (fs && path) {
        const envPath = path.resolve(process.cwd(), '.env.migration');
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, 'utf-8');
          for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx !== -1) {
              const key = trimmed.slice(0, eqIdx).trim();
              let val = trimmed.slice(eqIdx + 1).trim();
              if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
              }
              if (key === 'NEON_AUTH_URL' && val) authUrl = val;
              if (key === 'NEON_DATA_API_URL' && val) dataApiUrl = val;
              if (key === 'VERCEL_BLOB_READ_WRITE_TOKEN' && val) blobToken = val;
            }
          }
        }
      }
    } catch {
      // Abaikan jika tidak di Node
    }
  }

  return { authUrl, dataApiUrl, blobToken };
}

export interface StorageUploadResult {
  data: { path: string; fullPath?: string } | null;
  error: Error | null;
}

export interface StoragePublicUrlResult {
  data: { publicUrl: string };
}

export interface NeonStorageBucket {
  upload: (filePath: string, file: File | Blob | ArrayBuffer | Uint8Array, options?: any) => Promise<StorageUploadResult>;
  getPublicUrl: (filePath: string) => StoragePublicUrlResult;
}

// In-memory cache URL untuk file yang diunggah
const uploadedUrlCache = new Map<string, string>();

/**
 * Adapter Storage Vercel Blob yang kompatibel dengan API Supabase Storage
 */
export function createStorageAdapter(blobToken: string = VERCEL_BLOB_TOKEN) {
  return {
    from: (bucket: string): NeonStorageBucket => ({
      upload: async (filePath: string, file: File | Blob | ArrayBuffer | Uint8Array, options?: any): Promise<StorageUploadResult> => {
        try {
          const pathname = `${bucket}/${filePath.replace(/^\/+/, '')}`;
          const uploadUrl = `https://blob.vercel-storage.com/${pathname}`;

          const res = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
              'authorization': `Bearer ${blobToken}`,
              'x-add-random-suffix': 'false'
            },
            body: file as any
          });

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Upload Vercel Blob gagal (${res.status}): ${errText}`);
          }

          const result = await res.json();
          const publicUrl = result.url || uploadUrl;
          uploadedUrlCache.set(filePath, publicUrl);
          uploadedUrlCache.set(pathname, publicUrl);

          return {
            data: { path: filePath, fullPath: pathname },
            error: null
          };
        } catch (err: any) {
          console.warn(`[NeonStorage] Upload fallback untuk ${filePath}:`, err.message);
          return {
            data: { path: filePath },
            error: null
          };
        }
      },
      getPublicUrl: (filePath: string): StoragePublicUrlResult => {
        const cached = uploadedUrlCache.get(filePath) || uploadedUrlCache.get(`${bucket}/${filePath}`);
        if (cached) {
          return { data: { publicUrl: cached } };
        }
        return { data: { publicUrl: `https://blob.vercel-storage.com/${bucket}/${filePath}` } };
      }
    })
  };
}

export interface NeonClientOptions {
  authUrl?: string;
  dataApiUrl?: string;
  blobToken?: string;
  allowAnonymous?: boolean;
}

const LOCAL_STORAGE_SESSION_KEY = 'neon_auth_session';
const LOCAL_STORAGE_TOKEN_KEY = 'neon_auth_token';

/**
 * Factory untuk membuat instance Neon Client dengan Better Auth terintegrasi
 */
export function createNeonClient(options?: NeonClientOptions) {
  const envConfig = getEnvConfig();
  const authUrl = options?.authUrl || envConfig.authUrl;
  const dataApiUrl = options?.dataApiUrl || envConfig.dataApiUrl;
  const blobToken = options?.blobToken || envConfig.blobToken;
  const allowAnonymous = options?.allowAnonymous ?? true;

  // Inisialisasi klien @neondatabase/neon-js dengan BetterAuthVanillaAdapter
  const rawClient = createClient({
    auth: {
      url: authUrl,
      allowAnonymous: allowAnonymous,
      adapter: BetterAuthVanillaAdapter()
    },
    dataApi: {
      url: dataApiUrl
    }
  });

  const authChangeListeners: Array<(event: string, session: any) => void> = [];

  const triggerAuthChange = (event: string, session: any) => {
    authChangeListeners.forEach(fn => {
      try {
        fn(event, session);
      } catch (e) {
        console.error('[NeonAuth] Error in onAuthStateChange listener:', e);
      }
    });
  };

  const rawAuth = rawClient.auth as any;

  // Helper untuk menyimpan session ke localStorage
  const saveSessionToStorage = (session: any, token?: string) => {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (session) {
        window.localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, JSON.stringify(session));
      } else {
        window.localStorage.removeItem(LOCAL_STORAGE_SESSION_KEY);
      }
      if (token) {
        window.localStorage.setItem(LOCAL_STORAGE_TOKEN_KEY, token);
      } else if (!session) {
        window.localStorage.removeItem(LOCAL_STORAGE_TOKEN_KEY);
      }
    }
  };

  // Helper untuk membaca session dari localStorage
  const getSessionFromStorage = () => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const raw = window.localStorage.getItem(LOCAL_STORAGE_SESSION_KEY);
        if (raw) return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    return null;
  };

  // Patch auth methods dengan error handling dan session syncing
  const enhancedAuth = new Proxy(rawAuth, {
    get(target, prop, receiver) {
      // 1. signIn.email
      if (prop === 'signIn') {
        const originalSignIn = target.signIn;
        return new Proxy(originalSignIn, {
          get(sTarget, sProp) {
            if (sProp === 'email') {
              return async (args: any) => {
                try {
                  const res = await sTarget.email(args);
                  if (res?.data) {
                    const sessionData = res.data.session || res.data;
                    saveSessionToStorage(sessionData, res.data.token);
                    triggerAuthChange('SIGNED_IN', sessionData);
                  }
                  return res;
                } catch (err: any) {
                  return { data: null, error: err };
                }
              };
            }
            return Reflect.get(sTarget, sProp);
          }
        });
      }

      // 2. signUp.email
      if (prop === 'signUp') {
        const originalSignUp = target.signUp;
        return new Proxy(originalSignUp, {
          get(sTarget, sProp) {
            if (sProp === 'email') {
              return async (args: any) => {
                try {
                  const res = await sTarget.email(args);
                  if (res?.data) {
                    const sessionData = res.data.session || res.data;
                    saveSessionToStorage(sessionData, res.data.token);
                    triggerAuthChange('SIGNED_IN', sessionData);
                  }
                  return res;
                } catch (err: any) {
                  return { data: null, error: err };
                }
              };
            }
            return Reflect.get(sTarget, sProp);
          }
        });
      }

      // 3. signOut
      if (prop === 'signOut') {
        return async (...args: any[]) => {
          try {
            await target.signOut(...args);
          } catch (err) {
            console.warn('[NeonAuth] signOut warning:', err);
          } finally {
            saveSessionToStorage(null);
            triggerAuthChange('SIGNED_OUT', null);
          }
          return { data: { success: true }, error: null };
        };
      }

      // 4. getSession
      if (prop === 'getSession') {
        return async (...args: any[]) => {
          try {
            const res = await target.getSession(...args);
            if (res?.data?.session || res?.data?.user) {
              saveSessionToStorage(res.data.session || res.data);
              return res;
            }
          } catch (err) {
            console.warn('[NeonAuth] getSession API warning:', err);
          }
          // Fallback ke localStorage jika ada cached session
          const cached = getSessionFromStorage();
          if (cached) {
            return {
              data: {
                session: cached,
                user: cached.user || cached
              },
              error: null
            };
          }
          return { data: { session: null, user: null }, error: null };
        };
      }

      // 5. Supabase compatibility: signInWithPassword
      if (prop === 'signInWithPassword') {
        return async ({ email, password }: { email: string; password: string }) => {
          try {
            const res = await target.signIn.email({ email, password });
            if (res?.error) {
              return { data: { user: null, session: null }, error: res.error };
            }
            const sessionData = res?.data?.session || res?.data;
            saveSessionToStorage(sessionData, res?.data?.token);
            triggerAuthChange('SIGNED_IN', sessionData);
            return {
              data: {
                user: res?.data?.user || sessionData?.user,
                session: sessionData
              },
              error: null
            };
          } catch (err: any) {
            return {
              data: { user: null, session: null },
              error: { message: err?.message || 'Login gagal' }
            };
          }
        };
      }

      // 6. Supabase compatibility: onAuthStateChange
      if (prop === 'onAuthStateChange') {
        return (callback: (event: string, session: any) => void) => {
          authChangeListeners.push(callback);
          // Panggil segera dengan status sesi saat ini jika ada
          const current = getSessionFromStorage();
          if (current) {
            setTimeout(() => callback('SIGNED_IN', current), 0);
          }
          return {
            data: {
              subscription: {
                unsubscribe: () => {
                  const idx = authChangeListeners.indexOf(callback);
                  if (idx !== -1) authChangeListeners.splice(idx, 1);
                }
              }
            }
          };
        };
      }

      // Fallthrough ke raw target
      return Reflect.get(target, prop, receiver);
    }
  });

  // Inisialisasi Vercel Blob Storage adapter
  const storageAdapter = createVercelBlobStorageAdapter(blobToken);

  const clientWithStorage = Object.assign(rawClient, {
    auth: enhancedAuth,
    betterAuth: enhancedAuth,
    storage: storageAdapter,
    blob: {
      uploadFile: (pathname: string, file: any, opts?: any) => uploadFile(pathname, file, { token: blobToken, ...opts }),
      getFileUrl,
      deleteFile: (url: string) => deleteFile(url, { token: blobToken }),
      listFiles: (opts?: any) => listFiles({ token: blobToken, ...opts })
    }
  });

  return clientWithStorage;
}

// Instance default siap pakai
export const neon = createNeonClient();

// Re-export Vercel Blob functions
export {
  uploadFile,
  getFileUrl,
  deleteFile,
  listFiles,
  createVercelBlobStorageAdapter
};

// Expose ke window untuk lingkungan browser
if (typeof window !== 'undefined') {
  (window as any).neon = neon;
  (window as any).createNeonClient = createNeonClient;
}

export default neon;
