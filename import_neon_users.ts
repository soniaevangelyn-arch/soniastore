/**
 * import_neon_users.ts
 * 
 * Skrip untuk membaca users.csv dan mengimpor pengguna ke Neon Managed Better Auth melalui API.
 * Menggunakan NEON_AUTH_URL, NEON_AUTH_PROJECT_ID, dan NEON_AUTH_SERVER_KEY dari .env.migration.
 * Menangani duplikat email secara graceful dan memberikan laporan komprehensif.
 */

import * as fs from 'fs';
import * as path from 'path';

interface CsvUserRow {
  id: string;
  email: string;
  encrypted_password: string;
  user_metadata: Record<string, any>;
  created_at: string;
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

// Parser CSV sederhana berbasis RFC 4180
function parseCsv(content: string): CsvUserRow[] {
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length <= 1) return [];

  // Parse header
  const headers = parseCsvLine(lines[0]);
  const rows: CsvUserRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.length < headers.length) continue;

    const rowObj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rowObj[h] = values[idx] || '';
    });

    let metadata = {};
    try {
      if (rowObj['user_metadata']) {
        metadata = JSON.parse(rowObj['user_metadata']);
      }
    } catch {
      metadata = {};
    }

    rows.push({
      id: rowObj['id'] || '',
      email: rowObj['email'] || '',
      encrypted_password: rowObj['encrypted_password'] || '',
      user_metadata: metadata,
      created_at: rowObj['created_at'] || ''
    });
  }

  return rows;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // lewati quote kedua
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

async function importUsers() {
  console.log('=====================================================');
  console.log('🚀 MEMULAI IMPOR PENGGUNA KE NEON MANAGED BETTER AUTH');
  console.log('=====================================================');

  const env = loadMigrationEnv();

  const neonAuthUrl = env.NEON_AUTH_URL;
  if (!neonAuthUrl) {
    throw new Error('NEON_AUTH_URL tidak ditemukan di .env.migration');
  }

  const neonProjectId = env.NEON_AUTH_PROJECT_ID;
  const neonServerKey = env.NEON_AUTH_SERVER_KEY;

  console.log(`📍 Neon Auth Endpoint   : ${neonAuthUrl}`);
  console.log(`🆔 Neon Project ID      : ${neonProjectId || '(tidak diset)'}`);
  console.log(`🔑 Neon Server Key      : ${neonServerKey ? '(tersedia)' : '(tidak diset)'}`);

  const csvPath = path.resolve(process.cwd(), 'users.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`File ${csvPath} belum dibuat. Jalankan export_supabase_users.ts terlebih dahulu.`);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const users = parseCsv(csvContent);

  console.log(`\n📋 Ditemukan ${users.length} pengguna di ${csvPath}\n`);

  if (users.length === 0) {
    console.log('Tidak ada pengguna yang perlu diimpor.');
    return;
  }

  // Password awal default untuk migrasi (dapat diubah nanti oleh pengguna/admin)
  const defaultPassword = process.env.MIGRATION_DEFAULT_PASSWORD || 'SoniaAdmin2026!#';

  const authUrlObj = new URL(neonAuthUrl);
  const origin = authUrlObj.origin;

  let successCount = 0;
  let duplicateCount = 0;
  let errorCount = 0;

  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const userIndex = `[${i + 1}/${users.length}]`;

    if (!u.email) {
      console.log(`⚠️  ${userIndex} Dilewati: Baris tidak memiliki email.`);
      continue;
    }

    const displayName = u.user_metadata?.name || u.user_metadata?.full_name || u.email.split('@')[0];

    console.log(`⏳ ${userIndex} Memproses: ${u.email}...`);

    try {
      const response = await fetch(`${neonAuthUrl}/sign-up/email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': origin,
          ...(neonProjectId ? { 'x-neon-project-id': neonProjectId } : {})
        },
        body: JSON.stringify({
          email: u.email,
          password: defaultPassword,
          name: displayName
        })
      });

      const responseText = await response.text();
      let resJson: any = {};
      try {
        resJson = JSON.parse(responseText);
      } catch {
        resJson = { raw: responseText };
      }

      if (response.ok) {
        console.log(`   ✅ BERHASIL: Pengguna dibuat di Neon Better Auth!`);
        console.log(`      ID: ${resJson.user?.id || '(generated)'}`);
        console.log(`      Email: ${u.email}`);
        console.log(`      Password Default: ${defaultPassword}`);
        successCount++;
      } else if (response.status === 422 && (resJson.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' || responseText.includes('already exists'))) {
        console.log(`   ⏭️  DILEWATI (DUPLIKAT): Email ${u.email} sudah terdaftar di Neon Better Auth.`);
        duplicateCount++;
      } else {
        console.log(`   ❌ GAGAL (Status ${response.status}): ${responseText}`);
        errorCount++;
      }
    } catch (err: any) {
      console.log(`   ❌ ERROR JARINGAN: ${err.message}`);
      errorCount++;
    }
  }

  console.log('\n=====================================================');
  console.log('📊 RINGKASAN HASIL MIGRASI KE NEON BETTER AUTH');
  console.log('=====================================================');
  console.log(`Total Pengguna di CSV : ${users.length}`);
  console.log(`✅ Berhasil Diimpor   : ${successCount}`);
  console.log(`⏭️  Dilewati (Duplikat): ${duplicateCount}`);
  console.log(`❌ Gagal               : ${errorCount}`);
  console.log(`🔑 Password Default   : ${defaultPassword}`);
  console.log('=====================================================');

  console.log('\n📢 PENTING TERKAIT HASHING PASSWORD:');
  console.log('1. Supabase Auth menggunakan algoritma hashing **Bcrypt** ($2a$/$2b$).');
  console.log('2. Neon Managed Better Auth menggunakan algoritma hashing **Scrypt/Argon2** secara internal.');
  console.log('3. API registrasi Better Auth menerima password plaintext saat pembuatan akun,');
  console.log('   lalu Better Auth melakukan hashing Scrypt sebelum menyimpannya ke database.');
  console.log(`4. Pengguna admin yang baru dimigrasi dapat login ke Neon Auth menggunakan:`);
  console.log(`   - Email    : <email masing-masing>`);
  console.log(`   - Password : ${defaultPassword}`);
  console.log('   Setelah login pertama kali, admin dapat langsung mengganti password.');
  console.log('=====================================================\n');
}

importUsers().catch(err => {
  console.error('\n❌ ERROR SAAT IMPOR NEON USERS:', err.message);
  process.exit(1);
});
