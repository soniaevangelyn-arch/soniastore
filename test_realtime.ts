/**
 * test_realtime.ts
 * 
 * Pengujian integrasi Realtime:
 * 1. Menginisialisasi triggers & publication pada tabel 'clicks' dan 'products' di Neon DB.
 * 2. Menjalankan RealtimeServer (WebSocket Server di port 8085).
 * 3. Menghubungkan RealtimeClient melalui WebSocket.
 * 4. Berlangganan perubahan pada tabel 'clicks' dan 'products'.
 * 5. Mengubah data langsung di Neon Database (INSERT clicks, UPDATE products, DELETE products).
 * 6. Memastikan klien menerima semua update secara realtime.
 */

import {
  setupNeonRealtime,
  NeonDatabaseListener,
  RealtimeServer,
  RealtimeClient,
  DEFAULT_DIRECT_NEON_DB_URL
} from './src/lib/realtime.ts';
import type { RealtimeEvent } from './src/lib/realtimeClient.ts';
import { Client } from '@neondatabase/serverless';

async function runRealtimeTest() {
  console.log('🧪 Memulai pengujian Neon Logical Replication & Realtime Gateway...\n');

  // 1. Setup triggers & schema di Neon DB
  console.log('1️⃣ Menyiapkan skema & triggers realtime di Neon Database...');
  await setupNeonRealtime();

  // 2. Start Database Listener
  console.log('2️⃣ Mengaktifkan Neon Database Listener...');
  const dbListener = new NeonDatabaseListener();
  await dbListener.start();

  // 3. Start WebSocket Server di port 8085
  console.log('3️⃣ Menjalankan Realtime WebSocket Server pada port 8085...');
  const testPort = 8085;
  const server = new RealtimeServer(dbListener);
  server.startWebSocketServer(testPort);

  // 4. Connect Client
  console.log('4️⃣ Menghubungkan RealtimeClient ke WebSocket...');
  const client = new RealtimeClient(`ws://localhost:${testPort}`);
  await client.connect();
  console.log('   ✅ RealtimeClient berhasil terhubung!');

  // Catatan event yang diterima klien
  const receivedEvents: RealtimeEvent[] = [];

  // Berlangganan ke tabel 'products'
  client.from('products').on('*', (event) => {
    console.log(`   📨 [Klien Menerima Event 'products']: Action=${event.action}, ID=${event.data?.id || event.old?.id}, Title="${event.data?.title || event.old?.title || ''}"`);
    receivedEvents.push(event);
  }).subscribe();

  // Berlangganan ke tabel 'clicks'
  client.from('clicks').on('*', (event) => {
    console.log(`   📨 [Klien Menerima Event 'clicks']: Action=${event.action}, ID=${event.data?.id}, IP=${event.data?.ip_address}`);
    receivedEvents.push(event);
  }).subscribe();

  // Beri waktu 1 detik agar subscriptions terdaftar
  await new Promise(r => setTimeout(r, 1000));

  // 5. Melakukan mutasi data di Neon Database
  console.log('\n5️⃣ Melakukan perubahan data langsung di database...');
  const dbClient = new Client({ connectionString: DEFAULT_DIRECT_NEON_DB_URL });
  await dbClient.connect();

  let testProductId: string = '';

  try {
    // A. INSERT ke tabel clicks
    console.log('\n   A. Menguji INSERT pada tabel "clicks"...');
    const clickRes = await dbClient.query(`
      INSERT INTO public.clicks (user_agent, ip_address)
      VALUES ('Mozilla/5.0 TestBrowser', '192.168.1.100')
      RETURNING *;
    `);
    console.log('      DB INSERT clicks berhasil, ID:', clickRes.rows[0].id);

    // Tunggu notifikasi
    await new Promise(r => setTimeout(r, 1500));

    // B. INSERT ke tabel products (produk tes)
    console.log('\n   B. Menguji INSERT pada tabel "products"...');
    const prodRes = await dbClient.query(`
      INSERT INTO public.products (title, category, price, sales, affiliate_link, image_url)
      VALUES ('[TEST REALTIME] Produk Tes Cantik', 'Perawatan & Kecantikan', 99000, 10, 'https://shopee.co.id/test', 'https://example.com/test.jpg')
      RETURNING *;
    `);
    testProductId = prodRes.rows[0].id;
    console.log('      DB INSERT products berhasil, ID:', testProductId);

    await new Promise(r => setTimeout(r, 1500));

    // C. UPDATE tabel products
    console.log('\n   C. Menguji UPDATE pada tabel "products"...');
    await dbClient.query(`
      UPDATE public.products
      SET sales = 15, title = '[TEST REALTIME] Produk Tes Updated'
      WHERE id = $1;
    `, [testProductId]);
    console.log('      DB UPDATE products berhasil.');

    await new Promise(r => setTimeout(r, 1500));

    // D. DELETE produk tes dari tabel products
    console.log('\n   D. Menguji DELETE pada tabel "products"...');
    await dbClient.query(`
      DELETE FROM public.products WHERE id = $1;
    `, [testProductId]);
    console.log('      DB DELETE products berhasil.');

    await new Promise(r => setTimeout(r, 1500));

    // Bersihkan klik tes
    await dbClient.query(`DELETE FROM public.clicks WHERE ip_address = '192.168.1.100';`);
  } finally {
    await dbClient.end();
  }

  // 6. Evaluasi hasil
  console.log('\n6️⃣ Memverifikasi event yang diterima oleh RealtimeClient:');
  console.log(`   Total event diterima klien: ${receivedEvents.length}`);

  const hasClicksInsert = receivedEvents.some(e => e.table === 'clicks' && e.action === 'INSERT');
  const hasProductsInsert = receivedEvents.some(e => e.table === 'products' && e.action === 'INSERT');
  const hasProductsUpdate = receivedEvents.some(e => e.table === 'products' && e.action === 'UPDATE');
  const hasProductsDelete = receivedEvents.some(e => e.table === 'products' && e.action === 'DELETE');

  console.log(`   - Event INSERT clicks:   ${hasClicksInsert ? '✅ DITERIMA' : '❌ TIDAK DITERIMA'}`);
  console.log(`   - Event INSERT products: ${hasProductsInsert ? '✅ DITERIMA' : '❌ TIDAK DITERIMA'}`);
  console.log(`   - Event UPDATE products: ${hasProductsUpdate ? '✅ DITERIMA' : '❌ TIDAK DITERIMA'}`);
  console.log(`   - Event DELETE products: ${hasProductsDelete ? '✅ DITERIMA' : '❌ TIDAK DITERIMA'}`);

  // Cleanup
  client.disconnect();
  await dbListener.stop();
  await server.close();

  if (hasClicksInsert && hasProductsInsert && hasProductsUpdate && hasProductsDelete) {
    console.log('\n🎉 SEMUA PENGUJIAN REALTIME BERHASIL 100%!');
  } else {
    throw new Error('Sebagian event realtime tidak diterima oleh klien.');
  }
}

runRealtimeTest().catch((err) => {
  console.error('Pengujian gagal:', err);
  process.exit(1);
});
