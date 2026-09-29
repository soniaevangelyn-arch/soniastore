# 🌸 Panduan Migrasi & Arsitektur Baru: Sonia Beauty Store

Dokumentasi resmi arsitektur baru proyek **Sonia Beauty Store** setelah migrasi penuh dari **Supabase** ke ekosistem **Neon Database + Managed Better Auth + Vercel Blob Storage**.

---

## 🏗️ 1. Ikhtisar Arsitektur Baru

Seluruh layanan backend dan penyimpanan data telah dipisahkan ke dalam solusi serverless modern yang lebih fleksibel, cepat, dan terukur:

| Komponen | Layanan Sebelumnya (Supabase) | Layanan Baru (Target) | Pustaka / SDK Utama |
| :--- | :--- | :--- | :--- |
| **Database Relasional** | Supabase PostgreSQL | **Neon Serverless Postgres** | `@neondatabase/serverless` & `pg` |
| **REST Data API** | PostgREST (Supabase) | **Neon Data API (PostgREST)** | `@neondatabase/neon-js` |
| **Autentikasi & Akun** | Supabase Auth (GoTrue) | **Neon Managed Better Auth** | `@neondatabase/auth-ui` & `@neondatabase/neon-js` |
| **Media & File Storage** | Supabase Storage (S3 API) | **Vercel Blob Storage** | `@vercel/blob` & REST PUT API |
| **Fitur Realtime** | Supabase Realtime (Phoenix) | **Neon Logical Replication + WebSocket / SSE** | `@neondatabase/serverless` + `ws` |

### Diagram Alur Data & Sistem

```mermaid
flowchart TD
    subgraph Klien["Peramban / Frontend"]
        User["Pengguna Toko (index.html)"]
        Admin["Dashboard Admin (admin.html)"]
        Bundle["dist/neon.browser.js (NeonBundle)"]
    end

    subgraph NeonCloud["Neon Cloud Services"]
        NeonDB[("Neon Postgres Database (neondb)")]
        DataAPI["Neon Data API (PostgREST /rest/v1)"]
        BetterAuth["Neon Auth (Managed Better Auth /auth)"]
        PubSub["Neon Notification / LISTEN realtime_changes"]
    end

    subgraph VercelCloud["Vercel Cloud"]
        VercelBlob["Vercel Blob Storage (Media & Images)"]
    end

    subgraph RealtimeSubsystem["Realtime Gateway"]
        RTServer["WebSocket Server / Edge SSE Stream"]
    end

    Admin --> Bundle
    User --> Bundle

    Bundle -->|Query & CRUD| DataAPI
    Bundle -->|Login / Session| BetterAuth
    Bundle -->|Upload & Load Gambar| VercelBlob

    DataAPI --> NeonDB
    BetterAuth --> NeonDB

    NeonDB -->|Trigger pg_notify| PubSub
    PubSub --> RTServer
    RTServer -->|Live WebSocket Update| Admin
    RTServer -->|Live WebSocket Update| User
```

---

## ⚙️ 2. Konfigurasi Environment (`.env.migration`)

Konfigurasi kredensial disimpan pada file `.env.migration` di root direktori proyek. Kredensial ini otomatis dimuat oleh klien TypeScript baik di lingkungan Node.js maupun fallback runtime browser:

```env
# ==============================================================================
# KONFIGURASI MIGRASI (NEON DATABASE + BETTER AUTH + VERCEL BLOB)
# ==============================================================================

# 1. Neon Database (Direct & Connection Pooling)
NEON_DATABASE_URL=postgresql://neondb_owner:npg_NCyDSE0s2KqO@ep-lingering-bird-b587vms2-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require

# 2. Neon Data API (PostgREST Endpoint)
NEON_DATA_API_URL=https://ep-lingering-bird-b587vms2.apirest.c-7.us-east-2.aws.neon.tech/neondb/rest/v1

# 3. Neon Auth (Managed Better Auth Server)
NEON_AUTH_URL=https://ep-lingering-bird-b587vms2.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth
NEON_AUTH_PROJECT_ID=nameless-tree-27694734
NEON_AUTH_SERVER_KEY=https://ep-lingering-bird-b587vms2.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth/.well-known/jwks.json

# 4. Vercel Blob Storage
VERCEL_BLOB_READ_WRITE_TOKEN=vercel_blob_rw_D13YMXPZVpuEHykD_mfsMybgl4xrXWWBAtMpY0NlfVWUwYR
```

> [!IMPORTANT]
> - URL pooler (`*-pooler...`) digunakan untuk query transactional standar & serverless function.
> - URL direct (tanpa `-pooler`) digunakan khusus untuk listener realtime (`LISTEN/NOTIFY`) agar sesi websocket tetap persisten.

---

## 🚀 3. Cara Menjalankan Proyek

### A. Instalasi Dependensi
Gunakan Node.js v18+ (disarankan Node.js v20+ atau v24):
```bash
npm install
```

### B. Membangun Bundle Browser Frontend
Kompilasi TypeScript dan React UI Better Auth ke satu file bundle IIFE siap pakai di `dist/neon.browser.js`:
```bash
npm run build:client
```

### C. Validasi TypeScript & Typecheck
Pastikan tidak ada kesalahan tipe di seluruh proyek:
```bash
npm run typecheck
```

### D. Menjalankan Unit & Integration Test
Proyek dilengkapi 24 test otomatis menggunakan Vitest:
```bash
# Menjalankan seluruh test
npm run test

# Menjalankan test beserta laporan cakupan kode (coverage)
npm run test:coverage
```

### E. Menjalankan Monitoring Kesehatan Sistem
Periksa status koneksi, latensi, dan ketersediaan layanan secara langsung melalui CLI:
```bash
npm run monitor
```

### F. Skrip Migrasi Tambahan
- `npm run export:users` : Mengekspor pengguna Supabase Auth ke `users.csv`.
- `npm run import:users` : Mengimpor pengguna dari `users.csv` ke Neon Better Auth.
- `npm run migrate:storage` : Mengunduh seluruh gambar dari Supabase Storage, mengunggah ke Vercel Blob, dan memperbarui URL di database.
- `npm run test:realtime` : Menguji aliran data realtime end-to-end dari mutasi database hingga diterima oleh klien WebSocket.

---

## 🔍 4. Sistem Monitoring Kesehatan (Monitoring Guide)

Sistem monitoring dasar diimplementasikan di [`src/lib/monitoring.ts`](file:///d:/sonia_beauty/src/lib/monitoring.ts) dan dapat dipicu melalui perintah `npm run monitor`.

### Metrik yang Dipantau:

1. **Neon Database (PostgreSQL Engine)**:
   - Mengeksekusi kueri ping `SELECT 1, current_database(), version()`.
   - Mengukur waktu round-trip latency jaringan ke database.
2. **Neon Data API (PostgREST REST Endpoint)**:
   - Menguji kueri PostgREST `/products?select=id&limit=1`.
   - Memvalidasi respons HTTP 200 dan parsing JSON.
3. **Neon Auth (Better Auth Service)**:
   - Mengakses endpoint JWKS `/.well-known/jwks.json`.
   - Memastikan server auth aktif dan kunci penandatanganan token tersedia.
4. **Vercel Blob Storage**:
   - Memeriksa validitas token `VERCEL_BLOB_READ_WRITE_TOKEN` via panggilan API `listFiles()`.
   - Memverifikasi kemampuan membaca dan status store Vercel Blob.

### Contoh Output Monitoring:
```
═══════════════════════════════════════════════════════════════
       🔍 SONIA BEAUTY - MONITORING STATUS SISTEM
═══════════════════════════════════════════════════════════════

⏱️ Waktu Pemeriksaan : 29/9/2026, 20.15.00
📊 Status Keseluruhan: 🟢 HEALTHY

┌─────────────────────────────┬─────────────┬─────────────┬────────────────────────┐
│ Layanan                     │ Status      │ Latensi     │ Catatan                │
├─────────────────────────────┼─────────────┼─────────────┼────────────────────────┤
│ Neon Database (Postgres)    │ 🟢 HEALTHY  │ 2150ms      │ {"database":"neondb"}  │
│ Neon Data API (PostgREST)   │ 🟢 HEALTHY  │ 1850ms      │ {"count":1,"status":"O │
│ Neon Auth (Better Auth)     │ 🟢 HEALTHY  │ 2270ms      │ {"keysCount":1}        │
│ Vercel Blob Storage         │ 🟢 HEALTHY  │ 1411ms      │ {"hasBlobs":true}      │
└─────────────────────────────┴─────────────┴─────────────┴────────────────────────┘

✅ Seluruh layanan Neon dan Vercel Blob beroperasi normal tanpa kendala.
```

---

## 📁 5. Struktur Direktori Utama

```
d:\sonia_beauty\
├── .env.migration             # Konfigurasi kredensial migrasi (Neon, Better Auth, Vercel Blob)
├── admin.html                 # Dashboard Admin (Vanilla JS + Better Auth UI + Vercel Blob Upload)
├── index.html                 # Halaman Katalog Publik Sonia Store
├── dummy_data.sql             # Skema & data awal PostgreSQL
├── package.json               # Dependensi & skrip npm
├── tsconfig.json              # Konfigurasi kompilator TypeScript
├── vitest.config.ts           # Konfigurasi test runner & coverage Vitest
│
├── dist/
│   ├── neon.browser.js        # Bundle browser hasil esbuild (klien Neon + Better Auth UI + Blob)
│   └── auth-ui.css            # Stylesheet resmi untuk komponen Better Auth UI
│
├── src/
│   ├── index.ts               # Entry point utama bundler browser
│   └── lib/
│       ├── authUI.tsx         # Komponen React Better Auth UI untuk Dashboard Admin
│       ├── blob.ts            # Modul klien Vercel Blob (upload, get URL, delete, list)
│       ├── neonClient.ts      # Inisialisasi klien @neondatabase/neon-js dengan Better Auth
│       ├── realtime.ts        # Server gateway realtime (LISTEN/NOTIFY + WebSocket / SSE)
│       ├── realtimeClient.ts  # Klien langganan realtime berbasis browser WebSocket
│       └── monitoring.ts      # Modul monitoring kesehatan layanan Neon dan Vercel
│
├── tests/
│   ├── auth.test.ts           # Unit & Integration test untuk Neon Auth
│   ├── database.test.ts       # Unit & Integration test untuk PostgREST Data API & CRUD
│   ├── realtime.test.ts       # Unit test untuk klien & server realtime
│   └── storage.test.ts        # Unit & Integration test untuk Vercel Blob Storage
│
├── export_supabase_users.ts   # Skrip ekspor user dari Supabase Auth
├── import_neon_users.ts       # Skrip impor user ke Neon Better Auth
├── migrate_storage_to_blob.ts # Skrip migrasi seluruh file gambar/audio ke Vercel Blob
├── test_realtime.ts           # Skrip pengujian end-to-end fitur realtime
└── monitor.ts                 # CLI runner untuk monitoring status sistem
```

---

## 🔐 6. Akun Admin Default

Setelah migrasi auth, akun administrator telah terdaftar di Neon Managed Better Auth:
- **Email**: `roidjr12@gmail.com`
- **Password**: `SoniaAdmin2026!#`
- **Akses**: Login melalui antarmuka Better Auth di [`admin.html`](file:///d:/sonia_beauty/admin.html).

---

## 🌐 7. Panduan Deployment Vercel & Konfigurasi Production

### A. Environment Variables di Dashboard Vercel
Tambahkan variabel berikut di **Project Settings > Environment Variables** di Vercel:

| Nama Variable | Deskripsi / Nilai Contoh | Lingkungan |
| :--- | :--- | :---: |
| `NEXT_PUBLIC_APP_URL` | URL domain production Anda, misal `https://sonia-beauty.vercel.app` | Production, Preview |
| `APP_URL` | Sama dengan `NEXT_PUBLIC_APP_URL` | Production, Preview |
| `NEON_DATABASE_URL` | URL PostgreSQL Neon (`postgresql://neondb_owner:...`) | Production, Preview, Dev |
| `NEON_DATA_API_URL` | Endpoint PostgREST Neon Data API | Production, Preview, Dev |
| `NEON_AUTH_URL` | Endpoint Neon Managed Better Auth | Production, Preview, Dev |
| `NEON_AUTH_PROJECT_ID` | ID Project Neon Auth (`nameless-tree-27694734`) | Production, Preview, Dev |
| `NEON_AUTH_SERVER_KEY` | Endpoint JWKS Server Key Neon Auth | Production, Preview, Dev |
| `VERCEL_BLOB_READ_WRITE_TOKEN` | Read-Write Token dari Vercel Blob Storage | Production, Preview, Dev |

### B. Konfigurasi Allowed Origins di Neon Auth Console (Kritis)
Karena Better Auth menerapkan perlindungan Origin/CORS dan anti-CSRF, server Neon Auth hanya menerima permintaan dari domain yang telah didaftarkan:
1. Masuk ke [Neon Console](https://console.neon.tech).
2. Pilih project database Anda > Masuk ke tab **Auth (Better Auth)** > **Settings**.
3. Di bagian **Allowed Origins / Trusted Origins**, tambahkan:
   - `https://your-domain.vercel.app` (URL deployment Vercel Anda)
   - `https://your-custom-domain.com` (jika menggunakan custom domain)
   - `http://localhost:3000` (untuk pengujian lokal)
4. Di bagian **Redirect URLs**, pastikan menyertakan:
   - `https://your-domain.vercel.app/admin.html`
   - `https://your-domain.vercel.app/`
5. Simpan perubahan. Permintaan login dari domain Vercel Anda sekarang akan otomatis diterima dan tidak akan ditolak dengan error `403 Invalid origin`.
