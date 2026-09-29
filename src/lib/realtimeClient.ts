/**
 * src/lib/realtimeClient.ts
 * 
 * Client-side Realtime Subscriptions untuk browser dan frontend.
 * Terhubung ke Realtime Gateway melalui WebSocket atau Server-Sent Events (SSE).
 * Mendukung berlangganan perubahan tabel 'clicks' dan 'products'.
 */

export interface RealtimeEvent<T = any> {
  table: 'products' | 'clicks' | 'click_logs' | string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  data?: T;
  old?: T;
  timestamp: string;
}

export type RealtimeCallback<T = any> = (event: RealtimeEvent<T>) => void;

export class RealtimeClient {
  private url: string;
  private ws: any = null;
  private sse: any = null;
  private listeners: Map<string, Set<RealtimeCallback>> = new Map();
  private isConnected = false;
  private reconnectTimer: any = null;

  constructor(url: string = 'ws://localhost:8080') {
    this.url = url;
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // 1. Cek koneksi WebSocket
      if (this.url.startsWith('ws://') || this.url.startsWith('wss://')) {
        const isBrowser = typeof window !== 'undefined';
        const WS = isBrowser ? (window as any).WebSocket : undefined;

        if (!WS) {
          return reject(new Error('WebSocket constructor tidak ditemukan'));
        }

        try {
          this.ws = new WS(this.url);

          this.ws.onopen = () => {
            this.isConnected = true;
            console.log('[NeonRealtimeClient] Terhubung ke WebSocket gateway:', this.url);

            // Re-subscribe all active tables
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
            console.warn('[NeonRealtimeClient] WebSocket error:', err);
            if (!this.isConnected) reject(err);
          };

          this.ws.onclose = () => {
            this.isConnected = false;
            console.warn('[NeonRealtimeClient] WebSocket closed, auto reconnecting in 3s...');
            this.scheduleReconnect();
          };
        } catch (err) {
          reject(err);
        }
      } 
      // 2. Fallback koneksi SSE (Server-Sent Events) jika URL HTTP
      else if (this.url.startsWith('http://') || this.url.startsWith('https://')) {
        if (typeof window !== 'undefined' && (window as any).EventSource) {
          const EventSourceConstructor = (window as any).EventSource;
          this.sse = new EventSourceConstructor(this.url);

          this.sse.onopen = () => {
            this.isConnected = true;
            console.log('[NeonRealtimeClient] Terhubung ke SSE stream:', this.url);
            resolve();
          };

          this.sse.onmessage = (event: any) => {
            try {
              const payload = JSON.parse(event.data);
              if (payload.table && payload.action) {
                this.handleEvent(payload as RealtimeEvent);
              }
            } catch {}
          };

          this.sse.onerror = (err: any) => {
            console.warn('[NeonRealtimeClient] SSE error:', err);
            if (!this.isConnected) reject(err);
          };
        } else {
          reject(new Error('EventSource tidak tersedia di lingkungan ini'));
        }
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {});
    }, 3000);
  }

  private handleEvent(event: RealtimeEvent): void {
    const tableCallbacks = this.listeners.get(event.table);
    if (tableCallbacks) {
      tableCallbacks.forEach((cb) => {
        try {
          cb(event);
        } catch (e) {
          console.error('[NeonRealtimeClient] Error in callback:', e);
        }
      });
    }

    const wildcardCallbacks = this.listeners.get('*');
    if (wildcardCallbacks) {
      wildcardCallbacks.forEach((cb) => {
        try {
          cb(event);
        } catch (e) {
          console.error('[NeonRealtimeClient] Error in wildcard callback:', e);
        }
      });
    }
  }

  /**
   * Berlangganan perubahan tabel tertentu (misal 'products' atau 'clicks')
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
   * Fluent API mirip Supabase Realtime:
   * client.from('products').on('INSERT', e => { ... }).subscribe()
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
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
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

export function createRealtimeClient(url?: string): RealtimeClient {
  return new RealtimeClient(url);
}

// Global browser window bindings
if (typeof window !== 'undefined') {
  const win = window as any;
  win.NeonRealtime = {
    createRealtimeClient,
    RealtimeClient
  };
}
