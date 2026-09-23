# Sonia Store - Affiliate Website

Website affiliate aesthetic dan clean dengan dashboard admin yang terintegrasi dengan Supabase.

## Persiapan Supabase (Wajib!)
1. Buat project baru di [Supabase](https://supabase.com/).
2. Masuk ke menu **SQL Editor**, lalu paste isi dari file `dummy_data.sql` dan jalankan (klik tombol **Run**). 
   *(Langkah ini akan secara otomatis membuat tabel `products`, mengaktifkan keamanan RLS, memasukkan 3 data dummy, dan membuat Storage bucket bernama `product-images`)*.
3. Masuk ke menu **Authentication > Providers**, pastikan provider **Email** sudah aktif.
4. Masuk ke menu **Authentication > Users**, klik **Add User** > **Create New User**. Masukkan email dan password untuk login Admin kamu.
5. Buka **Project Settings > API**. Copy URL project kamu dan `anon` public key.
6. Buka file `index.html` dan `admin.html`, cari blok kode berikut yang berada di bagian bawah (di dalam tag `<script>`):
   ```javascript
   // ====== ISI DENGAN DATA SUPABASE KAMU ======
   const SUPABASE_URL = "MASUKKAN_PROJECT_URL_DI_SINI";
   const SUPABASE_ANON_KEY = "MASUKKAN_PUBLISHABLE_KEY_DI_SINI";
   const STORAGE_BUCKET = "product-images";
   // ==========================================
   ```
   Lalu ganti string `MASUKKAN_...` dengan URL dan Key dari Supabase yang sudah kamu copy tadi.

## Cara Menjalankan Secara Lokal
Bisa langsung double-click file `index.html` (untuk web publik) atau `admin.html` (untuk admin) di browser kamu. Tidak perlu server khusus karena semuanya dihandle dengan Vanilla JS & CDN.

## Cara Login Admin
Buka `admin.html`, kamu akan otomatis diminta login. Masukkan email dan password yang kamu buat di langkah (4) di atas. Jika berhasil, kamu akan diarahkan ke Dashboard.

## Cara Deploy (Hosting Gratis)
1. Buat akun di [Netlify](https://www.netlify.com/) atau [Vercel](https://vercel.com/).
2. Drag and drop folder `sonia_beauty` ke dalam dashboard mereka (atau hubungkan repository Github jika sudah di-push).
3. Selesai! Website kamu akan langsung online.

## Catatan Tambahan (Storage Policies)
Bucket bernama `product-images` harus bersifat "Public" agar pembeli dapat melihat gambarnya. File `dummy_data.sql` sudah disetup untuk membuatnya public, namun **jika kamu mengalami error saat upload gambar di admin**, pastikan policies storage-nya benar:
1. Ke Supabase > Storage > Policies.
2. Buat policy baru pada `product-images`:
   - `SELECT` (Read): centang agar bisa dibaca semua orang (anon/public).
   - `INSERT`/`UPDATE`/`DELETE`: centang HANYA untuk Authenticated users (admin).
