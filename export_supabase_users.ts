/**
 * export_supabase_users.ts
 * 
 * Skrip untuk mengekspor data pengguna dari Supabase Auth ke users.csv.
 * Menggunakan SUPABASE_URL / SUPABASE_DB_URL dan SUPABASE_SERVICE_ROLE_KEY dari .env.migration.
 */

import * as fs from 'fs';
import * as path from 'path';

interface SupabaseUser {
  id: string;
  email: string;
  encrypted_password?: string;
  user_metadata?: Record<string, any>;
  app_metadata?: Record<string, any>;
  created_at: string;
  [key: string]: any;
}

// Fungsi pembaca file .env.migration
function loadMigrationEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), '.env.migration');
  if (!fs.existsSync(envPath)) {
    throw new Error(`File .env.migration tidak ditemukan di: ${envPath}`);
  }

  const content = fs.readFileSync(envPath, 'utf-8');
  const env: Record<string, string> = {};

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
      env[key] = val;
    }
  }

  return env;
}

// Fungsi helper escape nilai CSV (RFC 4180)
function escapeCsv(val: any): string {
  if (val === null || val === undefined) return '""';
  const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

async function exportUsers() {
  console.log('=====================================================');
  console.log('🚀 MEMULAI EKSPOR PENGGUNA DARI SUPABASE AUTH');
  console.log('=====================================================');

  const env = loadMigrationEnv();

  const rawUrl = env.SUPABASE_URL || env.SUPABASE_DB_URL;
  if (!rawUrl) {
    throw new Error('SUPABASE_URL atau SUPABASE_DB_URL tidak ditemukan di .env.migration');
  }

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY tidak ditemukan di .env.migration');
  }

  // Normalisasi base URL (menghilangkan /rest/v1 jika ada)
  const supabaseBaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  console.log(`📡 Menghubungi Supabase Auth API: ${supabaseBaseUrl}/auth/v1/admin/users`);

  const allUsers: SupabaseUser[] = [];
  let page = 1;
  const perPage = 1000;
  let hasMore = true;

  while (hasMore) {
    const endpoint = `${supabaseBaseUrl}/auth/v1/admin/users?page=${page}&per_page=${perPage}`;
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gagal mengambil data dari Supabase (Status ${response.status}): ${errText}`);
    }

    const data = await response.json();
    const users: SupabaseUser[] = data.users || [];

    if (users.length === 0) {
      hasMore = false;
    } else {
      allUsers.push(...users);
      console.log(`📥 Berhasil mengunduh halaman ${page} (${users.length} pengguna)...`);
      if (users.length < perPage) {
        hasMore = false;
      } else {
        page++;
      }
    }
  }

  console.log(`\n✅ Total pengguna ditemukan: ${allUsers.length}`);

  // Catatan teknis keamanan Supabase GoTrue
  console.log('\n🔍 Memeriksa ketersediaan encrypted_password...');
  const hasEncryptedPasswords = allUsers.some(u => !!u.encrypted_password);
  if (!hasEncryptedPasswords) {
    console.log('ℹ️  CATATAN TEKNIS: Supabase GoTrue REST API secara sengaja TIDAK MENGEKSPOS');
    console.log('   kolom `encrypted_password` melalui endpoint HTTP admin untuk alasan keamanan.');
    console.log('   Kolom ini akan dicatat sebagai string kosong di users.csv.');
  }

  // Siapkan baris CSV
  const csvHeaders = ['id', 'email', 'encrypted_password', 'user_metadata', 'created_at'];
  const csvRows: string[] = [csvHeaders.join(',')];

  for (const user of allUsers) {
    const row = [
      escapeCsv(user.id || ''),
      escapeCsv(user.email || ''),
      escapeCsv(user.encrypted_password || ''),
      escapeCsv(user.user_metadata || {}),
      escapeCsv(user.created_at || '')
    ];
    csvRows.push(row.join(','));
  }

  const outputPath = path.resolve(process.cwd(), 'users.csv');
  fs.writeFileSync(outputPath, csvRows.join('\n'), 'utf-8');

  console.log(`\n🎉 Data pengguna berhasil disimpan ke: ${outputPath}`);
  console.log(`📊 Ukuran file: ${fs.statSync(outputPath).size} bytes`);
  console.log('=====================================================\n');
}

exportUsers().catch(err => {
  console.error('\n❌ ERROR SAAT EKSPOR SUPABASE USERS:', err.message);
  process.exit(1);
});
