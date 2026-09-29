/**
 * monitor.ts
 * 
 * Script CLI untuk memantau kesehatan sistem Neon dan Vercel Blob secara live.
 * Dijalankan melalui `npm run monitor`
 */

import { getSystemHealthReport } from './src/lib/monitoring.ts';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('       🔍 SONIA BEAUTY - MONITORING STATUS SISTEM');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Memeriksa seluruh layanan (Neon Database, Data API, Auth, Vercel Blob)...\n');

  const report = await getSystemHealthReport();

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'healthy':
        return '🟢 HEALTHY';
      case 'degraded':
        return '🟡 DEGRADED';
      case 'unhealthy':
        return '🔴 UNHEALTHY';
      default:
        return '⚪ UNKNOWN';
    }
  };

  console.log(`⏱️ Waktu Pemeriksaan : ${new Date(report.timestamp).toLocaleString('id-ID')}`);
  console.log(`📊 Status Keseluruhan: ${getStatusBadge(report.status)}\n`);

  console.log('┌─────────────────────────────┬─────────────┬─────────────┬────────────────────────┐');
  console.log('│ Layanan                     │ Status      │ Latensi     │ Catatan                │');
  console.log('├─────────────────────────────┼─────────────┼─────────────┼────────────────────────┤');

  for (const key of Object.keys(report.services) as Array<keyof typeof report.services>) {
    const s = report.services[key];
    const name = s.name.padEnd(27, ' ');
    const status = getStatusBadge(s.status).padEnd(11, ' ');
    const latency = `${s.latencyMs}ms`.padEnd(11, ' ');
    const note = (s.message || (s.details ? JSON.stringify(s.details) : 'OK')).slice(0, 22).padEnd(22, ' ');
    console.log(`│ ${name} │ ${status} │ ${latency} │ ${note} │`);
  }

  console.log('└─────────────────────────────┴─────────────┴─────────────┴────────────────────────┘');

  if (report.status === 'healthy') {
    console.log('\n✅ Seluruh layanan Neon dan Vercel Blob beroperasi normal tanpa kendala.');
  } else {
    console.log('\n⚠️ Beberapa layanan memerlukan perhatian, cek pesan error di atas.');
  }
}

main().catch(console.error);
