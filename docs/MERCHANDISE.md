# Modul Penjualan Merchandise (Bidang Bisnis)

Status: **aktif di production** sejak akhir Oktober 2026. Perubahan stok display &
gudang serta pembayaran CARD (20 November 2026) dijelaskan di bagian
[Stok display & gudang, pindah stok, dan CARD](#stok-display--gudang-pindah-stok-dan-card).
Bagian "Persiapan database dan akun" di bawah adalah catatan peluncuran awal.

Modul Bidang Bisnis ditambahkan pada menu SPH Portal dengan lima halaman:
Beranda, Daftar Barang, Penjualan, Stok Barang, dan Laporan.

## Operasional

- Katalog awal berisi 68 jenis merchandise dari daftar resmi; nilai harga beli
  dan harga jual diimpor melalui SQL privat, **tidak boleh masuk repository publik**.
- Stok dicatat di dua lokasi: **display** (tempat barang dijual) dan **gudang**.
  Keduanya disimpan NULL sampai dihitung pertama kali (belum diopname). Nilai 0
  artinya sudah dihitung dan habis. Barang baru bisa dijual setelah stok
  display-nya dicatat.
- Barang masuk menambah stok di lokasi yang dipilih (bawaan gudang). Pindah stok
  memindahkan barang gudang ↔ display. Koreksi saldo per lokasi memerlukan izin
  koordinator atau manager dan wajib alasan.
- Transaksi menyimpan harga jual dan harga beli sebagai snapshot. Penjualan
  mengurangi stok **display** dalam transaksi database yang sama.
- Metode pembayaran: TUNAI, QRIS, TRANSFER, CARD, LAINNYA.
- Pembatalan hanya oleh manager, wajib alasan, mengembalikan stok ke display,
  dan menjaga riwayat transaksi. Tidak ada penghapusan permanen transaksi.
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

## Stok display & gudang, pindah stok, dan CARD

Keputusan pemilik 20 November 2026. Cabang `claude/bisnis-stok-gudang-card`.

### Aturan

| Hal | Aturan |
| --- | --- |
| Stok lama | `stock_qty` yang sudah ada = **stok display**. Riwayat mutasi lama otomatis berlokasi `DISPLAY`. |
| Stok gudang | Kolom baru `warehouse_qty`; NULL = belum dihitung (bukan 0). Dihitung sekali per barang lewat **Stok → Stok awal gudang**. |
| Penjualan | Hanya mengurangi display. Bila display kurang padahal gudang masih ada, penjualan ditolak dengan pesan untuk mencatat **Pindah ke display** dulu. |
| Barang masuk | Pilih lokasi; bawaan **gudang** (gudang harus sudah dihitung). |
| Pindah stok | Jenis mutasi `TRANSFER`: gudang → display atau display → gudang, dua baris riwayat (keluar dan masuk) dalam satu transaksi. Petugas boleh mencatatnya (izin `merchandise.stock.record`). |
| Koreksi saldo | Per lokasi, tetap hanya koordinator/manager (`merchandise.stock.adjust`). |
| Pembatalan | Barang kembali ke display. |
| Beranda | **Stok 5 atau kurang** = total display + gudang ≤ 5 (gudang belum dihitung = 0). **Display perlu diisi** = barang aktif dengan display ≤ 5 padahal gudang > 0. Peringatan muncul selama masih ada barang aktif yang stok gudangnya belum dihitung. |
| Pembayaran | `CARD` ditambahkan. LAINNYA tetap dapat dipilih. Transaksi lama tidak diubah. |

### API (portal-api)

- `POST merchandise/products/:id/stock` — `kind`: `INITIAL`, `IN`, `ADJUST`, `TRANSFER`;
  `location`: `DISPLAY` (bawaan bila tidak dikirim, sehingga tampilan lama tetap
  berarti display) atau `GUDANG`. Untuk `TRANSFER`, `location` adalah tujuan.
  `INITIAL` display boleh membawa `warehouse_quantity` untuk barang baru.
  Jawaban memuat `stock_qty`, `warehouse_qty`, dan `row_version` baru.
- `GET merchandise/stock?from=YYYY-MM-DD` — semua mutasi sejak 00.00 WITA tanggal
  itu (batas 10.000 baris) untuk Ekspor Stok Bulanan; tanpa `from` tetap 2.000
  mutasi terbaru untuk halaman Riwayat Stok.
- `GET merchandise/overview` menambah `products_display_low` dan
  `products_warehouse_uncounted`; `products_low` kini memakai total display + gudang.

### Laporan

- **Ekspor Penjualan Bulanan**, bagian III: 1 TUNAI, 2 NON TUNAI (QRIS),
  3 TRANSFER, 4 CARD, 5 LAINNYA (hanya bila dipakai), lalu JUMLAH. Blok tanda
  tangan dan gambar di bawahnya ikut turun. Lihat `MERCHANDISE-SALES-EXPORT.md`.
- **Ekspor Stok Bulanan**: tabel II tetap stok display (format resmi), ditambah
  catatan `DARI GUDANG`/`KE GUDANG`. Tabel baru **III. STOK GUDANG** (stok awal,
  barang masuk, pindah ke display, koreksi, stok akhir, nilai). Sebelum dihitung,
  baris gudang kosong ("Belum dihitung"); hitungan pertama menjadi dasar stok
  gudang dan **tidak** dihitung sebagai barang masuk. Daftar mutasi menjadi
  IV Barang masuk, V Pindah stok, VI Barang keluar, VII Pembatalan/koreksi positif,
  masing-masing dengan lokasi. Lembar Mutasi Stok mendapat kolom LOKASI.
- **Ekspor Detail Transaksi**: lembar Stok memuat stok display, gudang, dan total;
  lembar Mutasi Stok memuat lokasi.
- Halaman **Laporan** menampilkan rekap metode pembayaran dengan urutan yang sama.

### Urutan rilis

1. **Migrasi** `supabase/migrations/20261120090000_merchandise_stock_locations_card.sql`
   di Supabase SQL Editor. Aditif dan aman untuk portal-api yang sedang aktif:
   stok lama = display, riwayat lama = `DISPLAY`, batasan lama diganti berdasarkan
   isinya (bukan nama), dan aman dijalankan dua kali.
2. **portal-api**: pastikan snapshot aktif sama dengan `master` sebelum cabang ini
   (SHA-256 `b0e773a6c73cbe3b5b4edfbf56afe1673d567213be368b2f36752bfe03b05bf7`),
   lalu deploy `supabase/deploy/portal-api/index.ts`. Bila snapshot aktif berbeda,
   bangun ulang hanya blok merchandise di atas snapshot aktif:
   `node scripts/build-merchandise-update.mjs <snapshot-aktif.ts> <sha256>`.
   Skrip hanya mengganti lingkup `var merchandiseRoutes = (() => { … })();`
   (tanpa perubahan modul, keluarannya identik byte demi byte).
3. **Frontend**: merge ke `master` (Cloudflare Pages memakai `site-info/dist`).
4. Setelah rilis: petugas menghitung isi gudang dan mencatat **Stok awal gudang**
   per barang; Beranda menampilkan jumlah barang yang belum dihitung.

Frontend baru tanpa backend baru: pilihan CARD/gudang ditolak server (422) dan
ekspor stok bulanan tetap berjalan seperti sebelumnya. Jalankan langkah 1–3
berurutan dalam satu sesi rilis.

### Rollback

- **Kode**: revert merge PR dan deploy ulang portal-api snapshot sebelumnya
  (SHA di atas). Migrasi **tidak perlu** dibatalkan: portal-api lama tetap bekerja
  dengan kolom dan batasan baru (diuji di PGlite).
- Bila sudah ada data gudang/pindah stok/CARD, portal-api lama mengabaikan stok
  gudang, dan Ekspor Stok Bulanan versi lama menolak mutasi `TRANSFER`. Lebih
  aman memperbaiki maju daripada rollback setelah data baru tercatat.
- Membatalkan migrasi (hanya bila belum ada data baru): hapus kolom
  `warehouse_qty` dan `location`, kembalikan CHECK `kind` dan `payment_method`
  ke daftar lama, lalu `DROP INDEX merchandise_stock_created_idx`. Periksa dulu
  bahwa tidak ada baris `CARD`, `TRANSFER`, `GUDANG`, atau `warehouse_qty` terisi.

### Verifikasi

- `node --test tests/merchandise*.test.mjs` (domain, ekspor, beranda, upgrade SQLite lokal).
- `node scripts/verify-merchandise-postgres.mjs [pglite/dist/index.js] [snapshot-lama.ts]`
  — migrasi di PostgreSQL, gateway lama sebelum/sesudah migrasi, dan gateway yang
  sudah ditambal. Snapshot lama: `git show <commit-sebelum-cabang>:supabase/deploy/portal-api/index.ts`.
- Basis data lokal SQLite lama ditingkatkan otomatis saat `openDb` (tabel
  `merchandise_sales` dan `merchandise_stock_movements` dibangun ulang dengan nama tetap).
