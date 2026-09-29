/**
 * src/lib/monitoring.ts
 * 
 * Modul monitoring dasar untuk memantau status kesehatan & latensi layanan:
 * 1. Neon Database (Direct PostgreSQL Connection)
 * 2. Neon Data API (PostgREST REST API)
 * 3. Neon Auth (Managed Better Auth Service)
 * 4. Vercel Blob Storage (Read/Write Storage API)
 */

import { Client, neonConfig } from '@neondatabase/serverless';
import WebSocket from 'ws';
import { getEnvConfig } from './neonClient.ts';
import { listFiles, getVercelBlobToken } from './blob.ts';

if (typeof WebSocket !== 'undefined') {
  neonConfig.webSocketConstructor = WebSocket;
}

export interface ServiceHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs: number;
  message?: string;
  details?: any;
}

export interface SystemHealthReport {
  timestamp: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    neonDatabase: ServiceHealth;
    neonDataApi: ServiceHealth;
    neonAuth: ServiceHealth;
    vercelBlob: ServiceHealth;
  };
}

/**
 * Memeriksa koneksi langsung ke database PostgreSQL Neon
 */
export async function checkNeonDatabase(connectionString?: string): Promise<ServiceHealth> {
  const env = getEnvConfig();
  const connStr =
    connectionString ||
    (typeof process !== 'undefined' && process.env?.NEON_DATABASE_URL
      ? process.env.NEON_DATABASE_URL
      : 'postgresql://neondb_owner:npg_NCyDSE0s2KqO@ep-lingering-bird-b587vms2-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require');

  const start = Date.now();
  try {
    const client = new Client({ connectionString: connStr });
    await client.connect();
    const res = await client.query('SELECT 1 as ping, current_database() as db, version() as version');
    await client.end();

    const latency = Date.now() - start;
    return {
      name: 'Neon Database (Postgres)',
      status: latency < 5000 ? 'healthy' : 'degraded',
      latencyMs: latency,
      details: {
        database: res.rows[0]?.db,
        ping: res.rows[0]?.ping === 1 ? 'OK' : 'FAIL'
      }
    };
  } catch (err: any) {
    return {
      name: 'Neon Database (Postgres)',
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      message: err.message
    };
  }
}

/**
 * Memeriksa ketersediaan Neon Data API (PostgREST)
 */
export async function checkNeonDataApi(dataApiUrl?: string): Promise<ServiceHealth> {
  const start = Date.now();

  try {
    const { createNeonClient } = await import('./neonClient.ts');
    const client = createNeonClient(dataApiUrl ? { dataApiUrl } : undefined);
    const { data, error } = await client.from('products').select('id').limit(1);

    const latency = Date.now() - start;
    if (!error) {
      return {
        name: 'Neon Data API (PostgREST)',
        status: latency < 4000 ? 'healthy' : 'degraded',
        latencyMs: latency,
        details: { count: data?.length || 0, status: 'OK' }
      };
    } else {
      return {
        name: 'Neon Data API (PostgREST)',
        status: 'degraded',
        latencyMs: latency,
        message: error.message
      };
    }
  } catch (err: any) {
    return {
      name: 'Neon Data API (PostgREST)',
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      message: err.message
    };
  }
}

/**
 * Memeriksa endpoint Neon Auth (Managed Better Auth)
 */
export async function checkNeonAuth(authUrl?: string): Promise<ServiceHealth> {
  const env = getEnvConfig();
  const url = authUrl || env.authUrl;
  const start = Date.now();

  try {
    const res = await fetch(`${url}/.well-known/jwks.json`);
    const latency = Date.now() - start;

    if (res.ok) {
      const jwks = await res.json();
      return {
        name: 'Neon Auth (Better Auth)',
        status: latency < 5000 ? 'healthy' : 'degraded',
        latencyMs: latency,
        details: { keysCount: jwks.keys?.length || 0 }
      };
    } else {
      return {
        name: 'Neon Auth (Better Auth)',
        status: 'degraded',
        latencyMs: latency,
        message: `HTTP Status ${res.status}`
      };
    }
  } catch (err: any) {
    return {
      name: 'Neon Auth (Better Auth)',
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      message: err.message
    };
  }
}

/**
 * Memeriksa ketersediaan dan izin Vercel Blob Storage
 */
export async function checkVercelBlob(token?: string): Promise<ServiceHealth> {
  const authToken = token || getVercelBlobToken();
  const start = Date.now();

  try {
    const res = await listFiles({ limit: 1, token: authToken });
    const latency = Date.now() - start;

    return {
      name: 'Vercel Blob Storage',
      status: latency < 5000 ? 'healthy' : 'degraded',
      latencyMs: latency,
      details: {
        hasBlobs: (res.blobs?.length || 0) > 0,
        tokenPrefix: authToken.slice(0, 16) + '...'
      }
    };
  } catch (err: any) {
    return {
      name: 'Vercel Blob Storage',
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      message: err.message
    };
  }
}

/**
 * Menghasilkan laporan monitoring sistem secara menyeluruh
 */
export async function getSystemHealthReport(): Promise<SystemHealthReport> {
  const [neonDatabase, neonDataApi, neonAuth, vercelBlob] = await Promise.all([
    checkNeonDatabase(),
    checkNeonDataApi(),
    checkNeonAuth(),
    checkVercelBlob()
  ]);

  const allStatuses = [neonDatabase.status, neonDataApi.status, neonAuth.status, vercelBlob.status];
  let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  if (allStatuses.includes('unhealthy')) {
    overallStatus = 'unhealthy';
  } else if (allStatuses.includes('degraded')) {
    overallStatus = 'degraded';
  }

  return {
    timestamp: new Date().toISOString(),
    status: overallStatus,
    services: {
      neonDatabase,
      neonDataApi,
      neonAuth,
      vercelBlob
    }
  };
}
