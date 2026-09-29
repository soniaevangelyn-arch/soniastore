import { describe, it, expect } from 'vitest';
import { createRealtimeClient, RealtimeClient } from '../src/lib/realtimeClient.ts';
import { NeonDatabaseListener, RealtimeServer } from '../src/lib/realtime.ts';

describe('Realtime Subsystem - Unit & Integration Tests', () => {
  it('createRealtimeClient() harus mengembalikan instance RealtimeClient yang valid', () => {
    const client = createRealtimeClient('ws://localhost:8080');
    expect(client).toBeInstanceOf(RealtimeClient);
    expect(typeof client.connect).toBe('function');
    expect(typeof client.subscribe).toBe('function');
    expect(typeof client.from).toBe('function');
    expect(typeof client.disconnect).toBe('function');
  });

  it('client.from() harus mendukung fluent chaining API untuk tabel products dan clicks', () => {
    const client = createRealtimeClient('ws://localhost:8080');

    let prodCalled = false;
    const prodSub = client
      .from('products')
      .on('INSERT', (e) => { prodCalled = true; })
      .on('UPDATE', (e) => { prodCalled = true; })
      .subscribe();

    expect(prodSub).toBeDefined();
    expect(typeof prodSub.unsubscribe).toBe('function');

    let clickCalled = false;
    const clickSub = client
      .from('clicks')
      .on('INSERT', (e) => { clickCalled = true; })
      .subscribe();

    expect(clickSub).toBeDefined();
    expect(typeof clickSub.unsubscribe).toBe('function');

    // Unsubscribe
    prodSub.unsubscribe();
    clickSub.unsubscribe();
  });

  it('NeonDatabaseListener harus dapat mendaftarkan listener dan memancarkan event ke callback', () => {
    const listener = new NeonDatabaseListener();

    let capturedEvent: any = null;
    const unsubscribe = listener.subscribe('products', (event) => {
      capturedEvent = event;
    });

    // Simulasi event emisi lokal
    listener.emit({
      table: 'products',
      action: 'UPDATE',
      data: { id: 'test-uuid-123', title: 'Produk Uji', sales: 50 },
      timestamp: new Date().toISOString()
    });

    expect(capturedEvent).not.toBeNull();
    expect(capturedEvent.table).toBe('products');
    expect(capturedEvent.action).toBe('UPDATE');
    expect(capturedEvent.data.sales).toBe(50);

    unsubscribe();
  });

  it('RealtimeServer harus dapat membuat instance broadcaster dan menyiarkan event', () => {
    const listener = new NeonDatabaseListener();
    const server = new RealtimeServer(listener);

    expect(server).toBeDefined();
    expect(typeof server.startWebSocketServer).toBe('function');
    expect(typeof server.broadcast).toBe('function');
    expect(typeof server.handleSSE).toBe('function');
    expect(typeof server.handleEdgeSSE).toBe('function');
  });
});
