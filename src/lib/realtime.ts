/**
 * src/lib/realtime.ts
 * 
 * Implementasi Realtime menggunakan Neon Logical Replication & Database Notifications,
 * serta Vercel Edge Functions / Node WebSocket (ws) dan SSE (Server-Sent Events).
 * 
 * Mendukung berlangganan (subscribe) perubahan pada tabel 'clicks' dan 'products'
 * serta mengirim update secara langsung ke klien.
 */

import { Client, neonConfig } from '@neondatabase/serverless';
import WebSocket, { WebSocketServer } from 'ws';

// Set WebSocket constructor untuk @neondatabase/serverless di lingkungan Node.js
if (typeof WebSocket !== 'undefined') {
  neonConfig.webSocketConstructor = WebSocket;
}

// Database Connection String default dari .env.migration (menggunakan direct unpooled connection untuk LISTEN/NOTIFY)
export const DEFAULT_DIRECT_NEON_DB_URL =
  'postgresql://neondb_owner:npg_NCyDSE0s2KqO@ep-lingering-bird-b587vms2.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require';

export const NOTIFY_CHANNEL = 'realtime_changes';

export interface RealtimeEvent<T = any> {
  table: 'products' | 'clicks' | 'click_logs' | string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  data?: T;
  old?: T;
  timestamp: string;
}

export type RealtimeCallback<T = any> = (event: RealtimeEvent<T>) => void;

/**
 * 1. Menyiapkan skema triggers, function, dan logical replication publication di Neon Database
 */
export async function setupNeonRealtime(connectionString: string = DEFAULT_DIRECT_NEON_DB_URL): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    // 1. Pastikan tabel clicks ada
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.clicks (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
        user_agent TEXT,
        ip_address TEXT,
        clicked_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
      );
    `);

    // 2. Beri izin ke role publik dan anon
    await client.query(`
      GRANT USAGE ON SCHEMA public TO anonymous, authenticator, anon, authenticated;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO anonymous, authenticator, anon, authenticated;
      GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anonymous, authenticator, anon, authenticated;
    `);

    // 3. Buat atau perbarui Trigger Function untuk menerbitkan notifikasi pg_notify
    await client.query(`
      CREATE OR REPLACE FUNCTION notify_realtime_change()
      RETURNS trigger AS $$
      DECLARE
        payload json;
      BEGIN
        IF (TG_OP = 'DELETE') THEN
          payload = json_build_object(
            'table', TG_TABLE_NAME,
            'action', TG_OP,
            'old', row_to_json(OLD),
            'timestamp', clock_timestamp()
          );
        ELSE
          payload = json_build_object(
            'table', TG_TABLE_NAME,
            'action', TG_OP,
            'data', row_to_json(NEW),
            'old', CASE WHEN TG_OP = 'UPDATE' THEN row_to_json(OLD) ELSE null END,
            'timestamp', clock_timestamp()
          );
        END IF;

        PERFORM pg_notify('${NOTIFY_CHANNEL}', payload::text);
        RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql;
    `);

    // 4. Pasang trigger pada tabel products
    await client.query(`
      DROP TRIGGER IF EXISTS trigger_realtime_products ON public.products;
      CREATE TRIGGER trigger_realtime_products
      AFTER INSERT OR UPDATE OR DELETE ON public.products
      FOR EACH ROW EXECUTE FUNCTION notify_realtime_change();
    `);

    // 5. Pasang trigger pada tabel clicks
    await client.query(`
      DROP TRIGGER IF EXISTS trigger_realtime_clicks ON public.clicks;
      CREATE TRIGGER trigger_realtime_clicks
      AFTER INSERT OR UPDATE OR DELETE ON public.clicks
      FOR EACH ROW EXECUTE FUNCTION notify_realtime_change();
    `);

    // 6. Pasang trigger pada tabel click_logs (kompatibilitas)
    await client.query(`
      DROP TRIGGER IF EXISTS trigger_realtime_click_logs ON public.click_logs;
      CREATE TRIGGER trigger_realtime_click_logs
      AFTER INSERT OR UPDATE OR DELETE ON public.click_logs
      FOR EACH ROW EXECUTE FUNCTION notify_realtime_change();
    `);

    // 7. Siapkan publication untuk Logical Replication
    try {
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'neon_realtime_pub') THEN
            CREATE PUBLICATION neon_realtime_pub FOR TABLE public.products, public.clicks, public.click_logs;
          ELSE
            ALTER PUBLICATION neon_realtime_pub SET TABLE public.products, public.clicks, public.click_logs;
          END IF;
        END
        $$;
      `);
    } catch (e: any) {
      console.warn('[NeonRealtime] Info publication replication:', e.message);
    }

    console.log('[NeonRealtime] ✅ Skema Triggers & Publication Realtime berhasil dikonfigurasi di Neon DB');
  } finally {
    await client.end();
  }
}

/**
 * 2. Listener Database Realtime dari Neon
 * Menghubungkan client LISTEN ke PostgreSQL dan memancarkan event ke aplikasi
 */
export class NeonDatabaseListener {
  private client: Client | null = null;
  private connectionString: string;
  private isConnected = false;
  private listeners: Map<string, Set<RealtimeCallback>> = new Map();
  private reconnectTimeout: any = null;

  constructor(connectionString: string = DEFAULT_DIRECT_NEON_DB_URL) {
    this.connectionString = connectionString;
  }

  public async start(): Promise<void> {
    if (this.isConnected) return;

    this.client = new Client({ connectionString: this.connectionString });
    await this.client.connect();
    this.isConnected = true;

    this.client.on('notification', (msg) => {
      if (msg.channel === NOTIFY_CHANNEL && msg.payload) {
        try {
          const event: RealtimeEvent = JSON.parse(msg.payload);
          this.emit(event);
        } catch (err: any) {
          console.error('[NeonRealtimeListener] Gagal parse payload notifikasi:', err.message);
        }
      }
    });

    this.client.on('error', (err) => {
      console.error('[NeonRealtimeListener] Database client error:', err.message);
      this.reconnect();
    });

    this.client.on('end', () => {
      if (this.isConnected) {
        console.warn('[NeonRealtimeListener] Database client disconnected, reconnecting...');
        this.reconnect();
      }
    });

    await this.client.query(`LISTEN ${NOTIFY_CHANNEL}`);
    console.log(`[NeonRealtimeListener] 📡 Berlangganan channel '${NOTIFY_CHANNEL}' di Neon DB`);
  }

  private reconnect(): void {
    this.isConnected = false;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.start();
      } catch (e: any) {
        console.error('[NeonRealtimeListener] Gagal reconnect:', e.message);
        this.reconnect();
      }
    }, 2000);
  }

  public subscribe(table: string, callback: RealtimeCallback): () => void {
    if (!this.listeners.has(table)) {
      this.listeners.set(table, new Set());
    }
    this.listeners.get(table)!.add(callback);

    // Unsubscribe callback
    return () => {
      const set = this.listeners.get(table);
      if (set) {
        set.delete(callback);
        if (set.size === 0) this.listeners.delete(table);
      }
    };
  }

  public emit(event: RealtimeEvent): void {
    // 1. Panggil listener spesifik tabel (e.g. 'products' atau 'clicks')
    const tableListeners = this.listeners.get(event.table);
    if (tableListeners) {
      tableListeners.forEach((fn) => {
        try {
          fn(event);
        } catch (e) {
          console.error('[NeonRealtimeListener] Error in callback:', e);
        }
      });
    }

    // 2. Panggil wildcard '*' listener
    const wildcardListeners = this.listeners.get('*');
    if (wildcardListeners) {
      wildcardListeners.forEach((fn) => {
        try {
          fn(event);
        } catch (e) {
          console.error('[NeonRealtimeListener] Error in wildcard callback:', e);
        }
      });
    }
  }

  public async stop(): Promise<void> {
    this.isConnected = false;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.client) {
      try {
        await this.client.end();
      } catch {}
      this.client = null;
    }
  }
}

/**
 * 3. Realtime Server (WebSocket Server + SSE Hub)
 * Menerima koneksi WebSocket atau SSE dari browser dan meneruskan perubahan data
 */
export class RealtimeServer {
  private wss: WebSocketServer | null = null;
  private dbListener: NeonDatabaseListener;
  private sseClients: Set<(data: string) => void> = new Set();
  private wsClients: Map<WebSocket, Set<string>> = new Map(); // ws => Set of subscribed tables

  constructor(dbListener: NeonDatabaseListener) {
    this.dbListener = dbListener;
  }

  /**
   * Menjalankan server WebSocket pada port yang ditentukan
   */
  public startWebSocketServer(port: number = 8080): WebSocketServer {
    this.wss = new WebSocketServer({ port });

    this.wss.on('connection', (ws) => {
      const subscriptions = new Set<string>(['*']); // default subscribe all
      this.wsClients.set(ws, subscriptions);

      // Kirim pesan sambutan
      ws.send(JSON.stringify({ type: 'connected', message: 'Terhubung ke Neon Realtime Gateway' }));

      ws.on('message', (message) => {
        try {
          const payload = JSON.parse(message.toString());
          if (payload.action === 'subscribe' && payload.table) {
            subscriptions.add(payload.table);
            ws.send(JSON.stringify({ type: 'subscribed', table: payload.table }));
          } else if (payload.action === 'unsubscribe' && payload.table) {
            subscriptions.delete(payload.table);
            ws.send(JSON.stringify({ type: 'unsubscribed', table: payload.table }));
          }
        } catch {}
      });

      ws.on('close', () => {
        this.wsClients.delete(ws);
      });
    });

    // Hubungkan database listener ke broadcaster
    this.dbListener.subscribe('*', (event) => {
      this.broadcast(event);
    });

    console.log(`[RealtimeServer] 🚀 WebSocket server berjalan di port ${port}`);
    return this.wss;
  }

  /**
   * Mengirimkan event perubahan data ke semua klien yang berlangganan
   */
  public broadcast(event: RealtimeEvent): void {
    const raw = JSON.stringify(event);

    // 1. Broadcast ke WebSocket clients
    for (const [ws, subs] of this.wsClients.entries()) {
      if (ws.readyState === WebSocket.OPEN) {
        if (subs.has('*') || subs.has(event.table)) {
          ws.send(raw);
        }
      }
    }

    // 2. Broadcast ke SSE clients
    for (const sendSSE of this.sseClients) {
      try {
        sendSSE(raw);
      } catch {}
    }
  }

  /**
   * Handler untuk Vercel Edge Functions / Node HTTP SSE (Server-Sent Events)
   */
  public handleSSE(req: any, res: any): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    res.write('event: ready\ndata: {"status": "connected"}\n\n');

    const sendSSE = (raw: string) => {
      res.write(`data: ${raw}\n\n`);
    };

    this.sseClients.add(sendSSE);

    req.on('close', () => {
      this.sseClients.delete(sendSSE);
      res.end();
    });
  }

  /**
   * Handler untuk Vercel Edge / Web Standard Request (Response dengan ReadableStream)
   */
  public handleEdgeSSE(request: Request): Response {
    let sendFn: (data: string) => void;

    const stream = new ReadableStream({
      start: (controller) => {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('event: ready\ndata: {"status": "connected"}\n\n'));

        sendFn = (raw: string) => {
          controller.enqueue(encoder.encode(`data: ${raw}\n\n`));
        };
        this.sseClients.add(sendFn);
      },
      cancel: () => {
        if (sendFn) this.sseClients.delete(sendFn);
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  public close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}

/**
 * 4. Client-side Realtime Client
 * Digunakan di frontend (browser) atau klien Node untuk menerima update live.
 */
export class RealtimeClient {
  private url: string;
  private ws: any = null;
  private sse: any = null;
  private listeners: Map<string, Set<RealtimeCallback>> = new Map();
  private isConnected = false;

  constructor(url: string = 'ws://localhost:8080') {
    this.url = url;
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const isBrowser = typeof window !== 'undefined';
      const WSConstructor = isBrowser ? (window as any).WebSocket : WebSocket;

      if (!WSConstructor) {
        return reject(new Error('WebSocket tidak didukung di lingkungan ini'));
      }

      this.ws = new WSConstructor(this.url);

      this.ws.onopen = () => {
        this.isConnected = true;
        // Daftarkan kembali subscriptions yang ada
        for (const table of this.listeners.keys()) {
          this.ws.send(JSON.stringify({ action: 'subscribe', table }));
        }
        resolve();
      };

      this.ws.onmessage = (event: any) => {
        try {
          const payload = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
          if (payload.table && payload.action) {
            this.handleEvent(payload as RealtimeEvent);
          }
        } catch {}
      };

      this.ws.onerror = (err: any) => {
        if (!this.isConnected) reject(err);
      };

      this.ws.onclose = () => {
        this.isConnected = false;
      };
    });
  }

  private handleEvent(event: RealtimeEvent): void {
    const tableCallbacks = this.listeners.get(event.table);
    if (tableCallbacks) {
      tableCallbacks.forEach((cb) => cb(event));
    }
    const wildcardCallbacks = this.listeners.get('*');
    if (wildcardCallbacks) {
      wildcardCallbacks.forEach((cb) => cb(event));
    }
  }

  /**
   * Berlangganan perubahan tabel tertentu
   */
  public subscribe<T = any>(table: 'products' | 'clicks' | string, callback: RealtimeCallback<T>): () => void {
    if (!this.listeners.has(table)) {
      this.listeners.set(table, new Set());
    }
    this.listeners.get(table)!.add(callback);

    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ action: 'subscribe', table }));
    }

    return () => {
      const set = this.listeners.get(table);
      if (set) {
        set.delete(callback);
        if (set.size === 0) {
          this.listeners.delete(table);
          if (this.ws && this.ws.readyState === 1) {
            this.ws.send(JSON.stringify({ action: 'unsubscribe', table }));
          }
        }
      }
    };
  }

  /**
   * API fluent mirip Supabase Realtime:
   * client.from('products').on('INSERT', (e) => { ... }).subscribe()
   */
  public from(table: 'products' | 'clicks' | string) {
    const handlers: Array<{ event: string; callback: RealtimeCallback }> = [];

    const builder = {
      on: (event: 'INSERT' | 'UPDATE' | 'DELETE' | '*', callback: RealtimeCallback) => {
        handlers.push({ event, callback });
        return builder;
      },
      subscribe: () => {
        const unsub = this.subscribe(table, (e) => {
          handlers.forEach((h) => {
            if (h.event === '*' || h.event === e.action) {
              h.callback(e);
            }
          });
        });
        return { unsubscribe: unsub };
      }
    };

    return builder;
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.sse) {
      this.sse.close();
      this.sse = null;
    }
    this.isConnected = false;
  }
}

/**
 * Helper factory untuk membuat klien realtime
 */
export function createRealtimeClient(url?: string): RealtimeClient {
  return new RealtimeClient(url);
}

// Expose ke window untuk lingkungan browser
if (typeof window !== 'undefined') {
  const win = window as any;
  win.NeonRealtime = {
    createRealtimeClient,
    RealtimeClient
  };
}
