# Modul Penjualan Merchandise (Bidang Bisnis)

Status: **aktif di production** sejak akhir Oktober 2026. Perubahan stok display &
gudang serta pembayaran CARD (20 November 2026) dijelaskan di bagian
[Stok display & gudang, pindah stok, dan CARD](#stok-display--gudang-pindah-stok-dan-card).
Barang titipan UMKM (25 November 2026, belum dirilis) dijelaskan di bagian
[Barang titipan UMKM](#barang-titipan-umkm).
Bagian "Persiapan database dan akun" di bawah adalah catatan peluncuran awal.

Modul Bidang Bisnis ditambahkan pada menu SPH Portal dengan lima halaman:
Beranda, Daftar Barang, Penjualan, Stok Barang, dan Laporan. Halaman keenam,
Barang UMKM, ditambahkan bersama barang titipan UMKM.

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
- `GET merchandise/stock-export?from=YYYY-MM-DD&to=YYYY-MM-DD` membaca saldo,
  transaksi periode, dan mutasi sejak awal periode dalam satu snapshot saat ekspor.
  Akses memerlukan izin baca laporan, ekspor laporan, dan baca stok.

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
- Baris jumlah gudang menampilkan **Belum dihitung**, **SUBTOTAL**, atau **JUMLAH**
  sesuai cakupan opname. Kolom keterangan merinci jumlah barang yang sudah dihitung.

### Urutan rilis

1. **Migrasi** `supabase/migrations/20261120090000_merchandise_stock_locations_card.sql`
   di Supabase SQL Editor. Aditif dan aman untuk portal-api yang sedang aktif:
   stok lama = display, riwayat lama = `DISPLAY`, batasan lama diganti berdasarkan
   isinya (bukan nama), dan aman dijalankan dua kali.
2. **portal-api**: pastikan snapshot aktif sama dengan `master` sebelum cabang ini
   (SHA-256 `b0e773a6c73cbe3b5b4edfbf56afe1673d567213be368b2f36752bfe03b05bf7`),
   lalu deploy `supabase/deploy/portal-api/index.ts`. Bila snapshot aktif berbeda,
   bangun ulang pembaruan merchandise di atas snapshot aktif:
   `node scripts/build-merchandise-update.mjs <snapshot-aktif.ts> <sha256>`.
   Skrip memperbarui modul merchandise dan mengaktifkan transaksi PostgreSQL
   `REPEATABLE READ` khusus untuk ekspor stok sebelum pembacaan data pertama.
3. **Frontend**: merge ke `master` (Cloudflare Pages memakai `site-info/dist`).
4. Setelah rilis: petugas menghitung isi gudang dan mencatat **Stok awal gudang**
   per barang; Beranda menampilkan jumlah barang yang belum dihitung.

Endpoint ekspor stok dan pilihan CARD/gudang tersedia setelah rilis backend.
Jalankan langkah 1–3 berurutan dalam satu sesi rilis.

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

## Barang titipan UMKM

Keputusan tim Bisnis dan Keuangan 25 November 2026. Cabang `claude/bisnis-barang-umkm`.
Barang UMKM lokal dipajang dan dijual bersama merchandise BP, tetapi tetap milik UMKM
sampai terjual.

### Aturan

| Hal | Aturan |
| --- | --- |
| Penanda | `merchandise_products.umkm_partner_id` terisi = barang UMKM; NULL = barang BP (semua barang lama). SKU otomatis `UMKM-<kode mitra>-NN`; awalan `UMKM-` ditolak untuk barang BP. |
| Harga | UMKM menyebut harga yang ingin diterimanya (**harga UMKM**, disimpan di `buy_price`). Harga jual = harga UMKM + 20%, dibulatkan **ke atas** ke kelipatan Rp500 (di bawah Rp5.000: kelipatan Rp100). Selisih pembulatan masuk keuntungan BP. Contoh: Rp4.100 → Rp4.920 → **Rp5.000** (keuntungan BP Rp820 + pembulatan Rp80). |
| Ubah harga | Harga jual tidak bisa diketik. Manager mengubah harga UMKM lewat Daftar Barang → Ubah; harga jual dihitung ulang. Transaksi lama memakai snapshot harganya sendiri. |
| Terima barang | Hanya koordinator ke atas. Satu **tanda terima** (`TU-…`) per penyerahan, berisi barang terdaftar atau barang baru (nama + harga UMKM) dan lokasi display/gudang. Stok bertambah lewat mutasi `IN`. Mitra nonaktif tidak bisa menitipkan barang. |
| Takeout | Barang UMKM yang keluar selain terjual **wajib** dicatat lebih dulu sebagai takeout (`TO-…`, mutasi `TAKEOUT`), lalu buktinya dicetak dan ditandatangani. Alasan: diambil kembali, rusak, tidak laku, berhenti menitip, lainnya (wajib keterangan). Tidak ada batas waktu titip. Mitra nonaktif tetap bisa takeout. |
| Stok | Barang UMKM tidak bisa diberi stok awal atau barang masuk lewat Stok Barang; hanya pindah display ↔ gudang dan koreksi saldo. |
| Koreksi | Bila saldo berubah, wajib dipilih **tanggungan selisih** (`umkm_loss_borne_by`): BP atau UMKM. Kekurangan yang ditanggung BP menambah hak UMKM sebesar harga saat koreksi. Kelebihan mengurangi tanggungan hanya sampai jumlah kekurangan BP sebelumnya untuk SKU dan lokasi yang sama dalam periode laporan dan bulan WITA yang sama. Pengurang memakai harga saat kekurangan dicatat. |
| Penjualan | Barang UMKM dan barang BP boleh dalam satu transaksi. Baris penjualan menyimpan snapshot mitra, harga UMKM (`unit_cost`), dan persen keuntungan (`umkm_markup_pct`). |
| Pembatalan | Transaksi yang berisi barang UMKM, serta tanda terima/takeout, hanya bisa dibatalkan **pada bulan yang sama** (WITA) oleh pemegang `merchandise.sales.void`, karena laporan bulanannya menjadi dasar pembayaran. Karena stok per SKU bercampur, pembatalan tanda terima ditolak jika ada penjualan atau takeout yang masih berlaku atau koreksi turun untuk SKU tersebut setelah penerimaan. |
| Pembayaran | Uang penjualan disetor utuh ke Keuangan. Keuangan membayar tiap UMKM sebesar subtotal hak UMKM di **Ekspor Penjualan Bulanan**. Portal tidak mencatat pembayaran ke UMKM. |
| Kerahasiaan | Harga UMKM mengikuti izin `merchandise.catalog.costs` (tidak terlihat oleh petugas), termasuk di dokumen, mutasi, dan ekspor. |
| Jenis barang | Belum ditetapkan (masih dibahas dengan UMKM); portal tidak membatasi jenis barang. |

### Izin

| Izin | Isi | Role Bisnis |
| --- | --- | --- |
| `merchandise.umkm.read` | Halaman Barang UMKM, daftar mitra dan dokumen | PIMPINAN, MANAGER, KOORDINATOR |
| `merchandise.umkm.receive` | Tambah/ubah mitra, terima barang, takeout | MANAGER, KOORDINATOR |

Petugas tidak melihat menu Barang UMKM tetapi tetap bisa menjual barang UMKM.
Migrasi menambahkan kedua izin ke template role Bisnis yang sudah ada tanpa mengubah
penugasan akun. Di SQLite lokal, `seedPermissions` (migrasi versi 11) melakukan hal yang sama.

### Data

- Tabel baru (ber-RLS, tanpa grant ke klien): `merchandise_umkm_partners` (kode 2–8
  huruf/angka, nama usaha, pemilik, WhatsApp, alamat, catatan, aktif),
  `merchandise_umkm_docs` (`TERIMA`/`TAKEOUT`, `ACTIVE`/`VOID`), dan
  `merchandise_umkm_doc_items` (urutan baris, snapshot nama, SKU, lokasi, jumlah, harga UMKM, harga jual).
- Kolom baru: `merchandise_products.umkm_partner_id`;
  `merchandise_sale_items.umkm_partner_id`, `umkm_partner_name`, `umkm_markup_pct`;
  `merchandise_stock_movements.umkm_doc_id`, `unit_cost`, `umkm_loss_borne_by`, dan `product_stock_version`
  untuk mengurutkan mutasi SKU yang tercatat di milidetik yang sama.
  Jenis mutasi `TAKEOUT` ditambahkan ke CHECK `kind`.

### API (portal-api)

- `GET merchandise/umkm/partners`; `POST merchandise/umkm/partners`
  (`code`, `name`, `owner_name`, `phone`, `address`, `notes`);
  `PATCH merchandise/umkm/partners/:id` (kolom yang sama tanpa `code`, ditambah `is_active`
  dan `row_version`).
- `GET merchandise/umkm/docs?from=&to=` dan `GET merchandise/umkm/docs/:id` (dengan data mitra).
- `POST merchandise/umkm/receipts` — `partner_id`, `counterpart_name`, `note`,
  `items[]`: `{product_id | name + umkm_price, quantity, location}` (1–50 baris).
- `POST merchandise/umkm/takeouts` — `partner_id`, `counterpart_name`, `reason`
  (`DIAMBIL_UMKM`, `RUSAK`, `TIDAK_LAKU`, `BERHENTI`, `LAINNYA`), `note`,
  `items[]`: `{product_id, quantity, location}`.
- `POST merchandise/umkm/docs/:id/void` — `reason`, `row_version`.
- Perubahan endpoint lama: `POST merchandise/products/:id/stock` untuk barang UMKM hanya
  menerima `TRANSFER` dan `ADJUST`, dan `ADJUST` yang mengubah saldo wajib `loss_borne_by`
  (`BP`/`UMKM`). `PATCH merchandise/products/:id` menolak `sell_price` untuk barang UMKM.
  `GET merchandise/reports` menambah `umkm_losses` (koreksi tanggungan BP pada periode, batas
  hari WITA). Kemampuan pengguna menambah `umkm_read` dan `umkm_receive`.

### Laporan

- **Ekspor Penjualan Bulanan**: bila ada barang UMKM pada periode, rekap bagian I mendapat
  baris PENJUALAN BARANG UMKM, HAK UMKM (DIBAYARKAN KEUANGAN), KEUNTUNGAN BP DARI BARANG
  UMKM (20%, pembulatan, dan tanggungan hilang/rusak bila ada), TOTAL LABA BP, dan TOTAL
  UANG DITERIMA. Bagian baru **III. PENJUALAN BARANG UMKM (TITIPAN)** dikelompokkan per mitra
  dengan subtotal hak UMKM per mitra dan JUMLAH SEMUA MITRA; metode pembayaran menjadi
  bagian IV. Tanpa barang UMKM, file **identik** dengan format sebelumnya.
- **Ekspor Stok Bulanan**: barang UMKM tidak masuk tabel dan nilai stok BP. Bagian baru
  **VIII. STOK BARANG UMKM (TITIPAN, BUKAN MILIK BP)**: stok awal, diterima, terjual,
  takeout, koreksi, stok akhir per mitra. Lembar Penjualan dan Mutasi Stok mendapat kolom
  PEMILIK hanya bila ada data UMKM.
- **Ekspor Detail Transaksi**: kolom pemilik, harga UMKM, dan hak UMKM untuk baris UMKM.
- Halaman **Laporan**: rekap **Barang UMKM per mitra** (terjual, penjualan, hak UMKM,
  keuntungan BP, hilang/rusak ditanggung BP). Kartu Laba kotor sama dengan TOTAL LABA BP
  di ekspor penjualan bulanan.
- Tanda terima dan bukti takeout dicetak dari halaman Barang UMKM (kop BP, tanda tangan
  kedua pihak).

### Urutan rilis

1. **Migrasi**. Pastikan migrasi `20261120090000_merchandise_stock_locations_card.sql`
   sudah berjalan (kolom `warehouse_qty` ada), lalu jalankan
   `supabase/migrations/20261125090000_merchandise_umkm.sql` di Supabase SQL Editor.
   Migrasi ini aditif, tidak mengubah data lama, aman untuk portal-api yang sedang aktif,
   dan aman dijalankan dua kali.
2. **portal-api**: pastikan snapshot aktif sama dengan `master` sebelum cabang ini
   (SHA-256 `650d36a28dccff137e2b2db17fca2cbe4ceea8a6df88b88df350794b507b1437`), lalu deploy
   `supabase/deploy/portal-api/index.ts`
    (SHA-256 `fca1c65b1d727606edab921c1b0b7131b696aaa086498cbc368fc5cc3b2c16b5`). Bila snapshot
   aktif berbeda, bangun ulang di atas snapshot aktif:
   `node scripts/build-merchandise-update.mjs <snapshot-aktif.ts> <sha256>`.
3. **Frontend**: merge ke `master` (Cloudflare Pages memakai `site-info/dist`). Jangan
   mendahului langkah 2: halaman Barang UMKM membutuhkan endpoint baru.
4. Setelah rilis: koordinator/manager menambah mitra (kode mitra menjadi awalan SKU),
   lalu mencatat penyerahan pertama lewat **Terima barang** dan mencetak tanda terimanya.

> **Jangan** menjalankan ulang migrasi `20261120090000` setelah migrasi UMKM: migrasi itu
> membuat ulang CHECK `kind` tanpa `TAKEOUT`. Bila terlanjur, jalankan ulang
> `20261125090000` (aman diulang).

### Rollback

- **Kode**: revert merge PR dan deploy ulang portal-api snapshot sebelumnya (SHA
  `650d36a2…1437` di atas). Migrasi **tidak perlu** dibatalkan: portal-api lama tetap
  bekerja dengan tabel dan kolom baru (diuji di PGlite).
- Setelah ada mitra, barang, atau dokumen UMKM, backend lama menganggap barang UMKM
  sebagai barang BP biasa (harga jual bisa diketik, ekspor lama tidak memisahkan hak UMKM),
  dan Ekspor Stok Bulanan versi lama menolak periode yang berisi mutasi `TAKEOUT`.
  Lebih aman memperbaiki maju daripada rollback.
- Membatalkan migrasi (hanya bila belum ada data UMKM): hapus izin `merchandise.umkm.*`
  dari `app_role_permissions` lalu `app_permissions`; hapus kolom `umkm_doc_id`,
  `unit_cost`, `umkm_loss_borne_by` (mutasi), `umkm_partner_id`, `umkm_partner_name`,
  `umkm_markup_pct` (baris penjualan), `product_stock_version` (mutasi), dan `umkm_partner_id` (barang); kembalikan CHECK
  `kind` tanpa `TAKEOUT`; lalu `DROP TABLE` dokumen baris, dokumen, dan mitra. Periksa dulu
  tidak ada mutasi `TAKEOUT` atau barang dengan `umkm_partner_id` terisi.

### Verifikasi

- `node --test tests/merchandise*.test.mjs` — termasuk `merchandise-umkm.test.mjs` (aturan,
  izin, harga, takeout, koreksi, pembatalan, upgrade SQLite) dan
  `merchandise-umkm-xlsx.test.mjs` (ekspor penjualan dan stok).
- `node scripts/verify-merchandise-umkm-postgres.mjs [pglite/dist/index.js] [snapshot-lama.ts]`
  — migrasi di PostgreSQL, RLS dan syarat health portal-api, gateway lama sebelum/sesudah
  migrasi, dan alur lengkap di gateway yang sudah ditambal.
- Pratinjau lokal dengan data fiktif. Jalankan `npm run preview:umkm`, lalu buka
  `http://127.0.0.1:4627`. Akun fiktif `manager.bisnis`, `koordinator.bisnis`,
  `petugas.bisnis`, `pimpinan.bisnis`, password `Preview2026!`. Data di `data/pratinjau-bisnis/`
  (diabaikan Git), tanpa Supabase. Jalankan `npm run test:merchandise` untuk tes modul di Node.js 24.
