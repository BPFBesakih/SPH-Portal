# Modul Penjualan Merchandise — Persiapan

Status: **disiapkan di branch fitur; belum diaktifkan di production**.

Modul Bidang Bisnis ditambahkan pada menu SPH Portal dengan lima halaman:
Beranda, Daftar Barang, Penjualan, Stok Barang, dan Laporan.

## Operasional

- Katalog awal berisi 68 jenis merchandise dari daftar resmi; nilai harga beli
  dan harga jual diimpor melalui SQL privat, **tidak boleh masuk repository publik**.
- Stok awal disimpan NULL (belum diopname). Petugas mengisi jumlah aktual
  sebelum barang dapat dijual. Nilai 0 artinya sudah dihitung dan stok habis.
- Penerimaan barang menambah stok. Koreksi saldo memerlukan izin koordinator
  atau manager dan wajib alasan.
- Transaksi menyimpan harga jual dan harga beli sebagai snapshot. Penjualan
  mengurangi stok dalam transaksi database yang sama.
- Metode pembayaran tahap awal: TUNAI, QRIS, TRANSFER, LAINNYA.
- Pembatalan hanya oleh manager, wajib alasan, mengembalikan stok, dan menjaga
  riwayat transaksi. Tidak ada penghapusan permanen transaksi.
- Ekspor .xlsx dibuat di browser memakai fasilitas ekspor internal portal:
  detail penjualan sah, stok terkini, dan riwayat mutasi stok. Harga beli dan
  laba tidak ditampilkan kepada role petugas.

## Role dan izin

| Role | Kewenangan |
| --- | --- |
| BISNIS_PIMPINAN | Dashboard, harga modal, ringkasan dan ekspor laporan |
| BISNIS_MANAGER | Semua fungsi merchandise, koreksi stok, perubahan harga dan pembatalan |
| BISNIS_KOORDINATOR | Penjualan, stok dan koreksi, laporan, biaya; tanpa pengubahan harga/pembatalan |
| BISNIS_PETUGAS | Melihat katalog/harga jual, input stok awal/barang masuk, mencatat penjualan |

Role tidak otomatis memberi izin SDM, Keamanan, Pengadaan, ataupun administrasi
portal. Perubahan izin harus dilakukan melalui pengelolaan role yang sudah ada.

## Persiapan database dan akun

1. Rekonsiliasi dahulu backend Edge Function portal-api dengan perubahan
   production setelah versi source generator. **Jangan menjalankan
   scripts/build-cloud-deploy.mjs tanpa --frontend-only pada production
   sebelum rekonsiliasi dan uji regresi PostgreSQL selesai.**
2. Tinjau dan terapkan migrasi aditif
   supabase/migrations/20261027065420_merchandise_module.sql pada tahap
   deployment yang disetujui. Migrasi membuat tabel, izin, dan template role,
   tetapi tidak membuat akun atau mengubah penugasan role pengguna.
3. Jalankan file SQL katalog **privat** melalui jalur administrator tepercaya
   setelah migrasi, jangan commit daftar harga beli ke GitHub. Verifikasi jumlah
   produk: **68**; semua stok tetap belum diisi.
4. Buat akun individual untuk kelima pegawai yang telah disetujui melalui
   prosedur Admin Portal saat deployment. Tautkan satu akun ke
   satu ID pegawai HRIS; periksa akun yang sudah ada untuk menghindari duplikasi.
   Gunakan password sementara unik melalui kanal aman dan wajib ganti password.
   Jangan menyimpan password dalam code, SQL, laporan, atau percakapan.
5. Pasang tepat satu role merchandise sesuai jabatan dengan scope ALL untuk
   domain modul merchandise (bukan otorisasi seluruh modul portal). Uji penolakan
   akses role asing serta penolakan petugas ketika meminta harga modal,
   mengoreksi stok, atau membatalkan transaksi.
6. Uji transaksi bersamaan, stok tidak cukup, ekspor .xlsx, serta satu
   pembatalan yang dapat diaudit. Baru terbitkan frontend dan backend yang cocok.

## Catatan implementasi

- Domain lokal: lib/merchandise.mjs; adaptor Supabase Edge Function:
  supabase/functions/_shared/portal/merchandise.mjs.
- View: public/merchandise.js (disalin ke site-info/dist/app/ oleh build
  frontend). Routing dan izin tetap diterapkan di backend.
- Migrasi hanya menambah objek dan tidak mengubah data modul lain.
- Test fokus: node tests/merchandise.test.mjs; regresi: npm test.
- Tidak ada akun production yang dibuat atau password yang dihasilkan sebagai
  bagian dari persiapan ini.
