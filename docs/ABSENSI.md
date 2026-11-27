# Absensi — absen harian lewat HP terdaftar (tahap 1)

**Status (27 November 2026): tahap 1 tayang sejak 11 November (PR #31).** Jadwal pilot Sekretariat dan pemeriksaan radius sebelum selfie masuk lewat PR #46 (di-merge 26 November). Pratinjau selfie dan keterangan ketepatan masuk masuk lewat PR #47 (di-merge 27 November). Aturan **absen untuk orang lain hanya oleh atasan langsung** ada di cabang `claude/absensi-hanya-atasan-langsung` dan belum dirilis. Langkah rilis setiap pembaruan ada di bagian **Rilis pembaruan**, cara kembalinya di bagian **Rollback**. Kebutuhan lengkap ada di PRD Absensi revisi 2 (Project `claude/prd-modul-absensi.md`); bagian yang diganti keputusan sesudahnya tercatat di **Penyimpangan dari PRD**.

Tahap 1 mencatat jam **MASUK** dan **PULANG** dengan selfie dan lokasi GPS dari HP, untuk pegawai kantor, petugas shift/lapangan, dan THL (guide tidak ikut). Hasilnya rekap untuk atasan dan SDM, belum untuk gaji atau sanksi. Ketepatan masuk dinilai untuk pegawai dengan jadwal tetap pada hari kerja. Hari tanpa absen tampil sebagai **"Tidak ada catatan"**. Ekspor data aplikasi absen lama ditunda sesuai keputusan pemilik.

## Cara kerja singkat

1. **Yang didaftarkan adalah HP pribadi.** Untuk mencegah titip absen (keputusan pemilik 27 November 2026):
   - pemilik HP absen untuk dirinya sendiri;
   - pegawai lain hanya bisa diabsenkan **atasan langsungnya**, dari HP pribadi atasan itu. Pegawai tanpa HP absen di HP atasan langsungnya; rekan kerja, atasan tidak langsung, atau koordinator yang bukan atasannya tidak bisa mengabsenkan;
   - atasan langsung mengikuti penempatan utama yang berlaku hari ini (WITA) di Data Pegawai, sama dengan hak koreksi dan keterangan. Pegawai tanpa atasan atau dengan penempatan utama ganda hanya bisa absen di HP-nya sendiri;
   - **HP bersama tidak dipakai lagi.** HP bersama yang sudah terdaftar menolak absen dan menampilkan layar "HP bersama tidak dipakai lagi". HP koordinator atau HP pos didaftarkan ulang sebagai HP pribadi pemegangnya: buka tautan HP pribadi di HP itu, dan pendaftaran bersama yang lama dicabut otomatis. Satu pegawai boleh punya lebih dari satu HP pribadi.

   Server memeriksa hak ini setiap kali nama dibuka, lokasi dicek, dan absen dicatat (diulang di bawah kunci per pegawai sesudah selfie diunggah). Penolakan memakai kode `NOT_DIRECT_SUPERVISOR` atau `SHARED_RETIRED` dan tidak pernah mengunggah selfie.
2. **Pendaftaran HP lewat tautan WhatsApp.** Di menu Absensi → HP Absen, SDM atau koordinator membuat tautan sekali pakai (berlaku 7 hari):
   - **HP pribadi**: tautan dikirim ke WhatsApp pemilik (nomor diambil dari data pegawai bila ada). Setiap kali dibuka, HP langsung menampilkan nama pemiliknya. Bila pemiliknya atasan, tombol **Absen untuk bawahan** membuka daftar bawahan langsungnya.
   - **HP bersama** tidak bisa didaftarkan lagi (portal menolak, tombolnya dihapus). Tautan HP bersama yang dibuat sebelumnya ditolak saat dibuka.
   - **Sesi pendaftaran** (5–30 menit, misalnya sesudah briefing pagi): satu tautan dikirim ke grup WhatsApp unit. Setiap HP memilih nama pemiliknya lalu menunggu disetujui di portal. Nama yang dipilih lebih dari satu HP ditandai. Menutup sesi menolak HP yang belum disetujui. Karena HP atasan bisa mengabsenkan bawahan langsungnya, setujui HP hanya bila pemegangnya memang orang yang namanya dipilih, terutama untuk nama atasan.
   - QR hanya cara lain untuk membuka tautan yang sama di HP tersebut. **Absen harian tidak memakai QR.**
3. Untuk **absen harian**, buka `https://bpbesakih.com/absen/`. Nama pemilik HP langsung tampil; atasan bisa menekan **Absen untuk bawahan** lalu memilih nama bawahan langsungnya. Tekan **Masuk** atau **Pulang**. HP mencari lokasi GPS dan server memeriksa radius. Jika lokasinya diizinkan, kamera depan terbuka untuk selfie. Pegawai melihat foto, lalu memilih **Ambil ulang foto** atau **Kirim absen**. Tombol **Kembali** di pojok kanan atas pratinjau membuka kamera kembali (di layar di bawah 360 px tombolnya hanya panah ←). **Ambil ulang foto** dan **Kembali** langsung membuka kamera tanpa mencari lokasi ulang; lokasi yang sudah didapat tetap dipakai. Server memeriksa kembali lokasi dan izin saat mencatat absen. Saat mengirim, HP memilih titik GPS terakurat yang berumur maksimal 30 detik. Jika semua titik sudah lebih lama, HP mencari lokasi baru dan tetap memakai foto yang sudah dikonfirmasi selama masih berlaku. Bila server tetap menolak karena di luar radius, tombol **Cek lokasi lagi** mencari lokasi ulang; foto yang sudah dikonfirmasi dikirim ulang dengan kunci kiriman yang sama, tanpa selfie baru, selama umurnya belum 4,5 menit.
4. **Titik absen.** Pengelola mengatur radius per titik pada peta (bawaan 100 m, rentang 20–1000 m). Pegawai yang berada di luar semua titik aktif langsung mendapat pesan penolakan sebelum selfie. Di **Absensi → Titik Absen → Absen di luar area kantor**, pengelola dengan cakupan seluruh organisasi dapat memberi atau mencabut izin per pegawai. Izin mengikuti pegawai yang diabsenkan, termasuk saat diabsenkan atasan dari HP atasan. Pemegang izin cukup mengirim selfie dan lokasi. Rekap menandai catatannya sebagai **Izin absen di luar area kantor**. Saat semua titik nonaktif, hanya pegawai dengan izin tersebut yang dapat absen.
5. **Perlu dicek.** Catatan yang memerlukan peninjauan meliputi absen luar area oleh pemegang akses, GPS kurang akurat (>100 m), lokasi melompat (>120 km/jam), belum ada foto acuan, tanpa absen masuk/pulang, absen saat cuti, dan titik belum diatur. Tanda **Banyak pegawai di satu HP pribadi** tidak dibuat lagi sejak aturan atasan langsung (HP pribadi yang ramai kini berarti atasan mengabsenkan timnya); absen lama yang sudah bertanda tetap tampil sampai dinilai. Atasan langsung atau Pengelola Absensi membandingkan selfie dengan **foto acuan**, lalu menilai *Sesuai* atau *Perlu klarifikasi*.
6. **Status harian dihitung saat dibaca** dari catatan asli, koreksi, keterangan (Izin/Sakit/Dinas luar), dan cuti yang disetujui di modul Cuti. Pulang setelah tengah malam ikut tanggal kerja absen masuknya (shift malam, batas 16 jam).
7. **Absen lebih awal.** Jam masuk yang tercatat mengikuti waktu aktual server. Untuk Sekretariat Senin–Jumat, absen pukul 07.30 WITA diterima di area yang diizinkan. Jadwalnya tetap 08.00–16.00, dengan batas mulai terlambat 08.16. Jika absen pulang pukul 16.00, rentang kehadirannya 8 jam 30 menit. Modul ini belum menghitung lembur.

## Siapa melihat dan mengubah apa

| Peran | Lihat | Ubah |
|---|---|---|
| Pegawai (akun tertaut) | Absen sendiri (tab *Absen saya*) | — (di HP: absen untuk diri sendiri; atasan juga untuk bawahan langsungnya) |
| Atasan (penempatan utama) | Bawahan langsung dan tidak langsung | Hanya bawahan **langsung**: keterangan, koreksi jam (≤ 7 hari), menyisihkan absen salah nama, penilaian, foto acuan |
| Pengelola Absensi (`ABSENSI_PENGELOLA`) | Sesuai cakupan role | Semua di atas tanpa batas 7 hari, HP Absen, titik absen (cakupan seluruh organisasi) |
| Koordinator HP Absen (`ABSENSI_KOORDINATOR`) | Absen sendiri | Mendaftarkan/menonaktifkan HP dan membuka sesi untuk unit cakupannya |
| Super Admin | Semua | Semua |
| IT Admin, SDM | Hanya bila diberi role di atas | — |

Izin baru: `hr.attendance.read`, `.manage`, `.devices`, `.settings` (modul `hr`). Koreksi tidak pernah mengubah catatan asli; semua perubahan, ekspor, dan setiap kali selfie dibuka tercatat di audit.

## Arsitektur

| Bagian | Berkas |
|---|---|
| Aturan murni (jarak, titik, status harian, tanda tangan) | `lib/attendance-rules.mjs` |
| Halaman absen tanpa login (pendaftaran, absen, retensi) | `lib/attendance-form.mjs` |
| Rute portal `attendance/*` | `lib/attendance.mjs` |
| Penyimpanan selfie lokal | `lib/attendance-photos.mjs` (`<DATA_DIR>/attendance/`) |
| Versi cloud (async) | `supabase/functions/_shared/portal/attendance*.mjs`, dibuat oleh `node scripts/generate-cloud-modules.mjs --only=attendance-rules,attendance-schedule,attendance-form,attendance` |
| Edge Function halaman absen | `supabase/functions/attendance-form/index.ts` → paket `supabase/deploy/attendance-form/index.ts` (`node scripts/build-attendance-form.mjs`) |
| Gateway Pages `/api/attendance-form/*` | `site-info/lib/attendance-form.mjs`, `site-info/functions/api/attendance-form/[[action]].js` |
| Tambalan `portal-api` | `scripts/build-attendance-deploy.mjs` → `supabase/deploy/portal-api/index.ts` |
| Migrasi | `supabase/migrations/20261105120000_attendance_module.sql` (dan padanan SQLite di `schema.sql`) |
| Pra-cek rilis (hanya membaca) | `supabase/checks/check-attendance-readiness.sql`; dampak aturan atasan langsung: `supabase/checks/check-attendance-direct-supervisor.sql` |
| Jadwal retensi selfie (opsional) | `supabase/setup/schedule-attendance-retention.sql` (pg_cron + pg_net → operasi `retention`) |
| Antarmuka | `public/attendance.js` (menu Absensi), `public/absen/` (PWA HP), `public/assets/vendor/leaflet/` (Leaflet 1.9.4, BSD-2) |

Pilihan yang penting untuk produksi:

- **Kunci HP**: saat mendaftar, HP membuat pasangan kunci ECDSA P-256 dengan WebCrypto; kunci privat *tidak bisa diekspor* dan tersimpan di IndexedDB HP. Server hanya menyimpan kunci publik. Setiap permintaan menandatangani tindakan, ID HP, jam, dan isi kiriman. Selisih jam lebih dari 10 menit ditolak dengan jam server, lalu HP otomatis mengulang sekali dengan jam yang disesuaikan.
- **Pendaftaran tahan sinyal putus**: kunci baru disimpan di HP *sebelum* pendaftaran dikirim. Bila balasan hilang padahal server sudah menyimpan, kiriman ulang (tombol *Coba lagi*, atau otomatis saat halaman dibuka lagi) memakai kunci yang sama dan mendapat HP yang sama: tautan + kunci sama, atau sesi + kunci + nama sama. Kunci lain tetap ditolak, dan HP yang sudah dinonaktifkan tidak hidup lagi. Halaman juga meminta penyimpanan permanen (`navigator.storage.persist`) supaya kunci tidak terhapus saat ruang HP sempit.
- **Token** tautan dan sesi hanya disimpan sebagai hash (SHA-256) dan hanya ditampilkan sekali kepada pembuatnya. Mendaftar ulang di HP yang sama mencabut pendaftaran lama hanya bila HP membuktikan masih memegang kunci lama. Bukti dari HP yang tidak dikenal server (misalnya sesudah basis data dipulihkan dari backup) diabaikan, sehingga HP tetap bisa mendaftar.
- **Status di HP**: jam masuk/pulang hari ini hanya dikirim untuk pemilik HP pribadi di HP-nya sendiri. Saat atasan mengabsenkan bawahannya, HP hanya melihat keadaannya (belum masuk, sudah masuk, sudah pulang), cukup untuk menyorot tombol yang benar tanpa membuka jam orang lain.
- **Daftar nama di HP**: `context` hanya mengirim pemilik dan bawahan langsungnya (grup `owner` dan `team`). Pencarian nama (`search`, tetap ada untuk HP versi lama) dibatasi ke nama yang sama, jadi daftar pegawai lain tidak bisa ditelusuri dari HP.
- **Tanpa kunci global portal.** Edge `attendance-form` memakai transaksi pendek dan mengunci per pegawai (`pg_advisory_xact_lock(hashtextextended('portal.attendance:<id>',0))`), sehingga lonjakan absen pagi tidak menahan transaksi portal lain. Batas frekuensi per IP dan per HP.
- **Selfie** (JPEG ≤ 300 KB, diambil ≤ 5 menit sebelum dikirim) diunggah ke Google Drive folder **SPH-Portal-Absensi** *di luar* transaksi; bila penyimpanan absen gagal, berkasnya dihapus lagi. Kiriman ulang dengan kunci kiriman yang sama tidak mengunggah dua kali. Portal membaca selfie satu per satu lewat `attendance/photos/<id>`.
- **Catatan absen append-only**: pemicu basis data menolak DELETE dan semua UPDATE kecuali penghapusan selfie oleh retensi.
- **Retensi 90 hari**: selfie lebih tua dari 90 hari dihapus dari Drive. Penghapusan berjalan di latar belakang sesudah absen baru atau saat halaman absen dibuka di HP aktif, paling sering 6 jam sekali, dengan lease agar tidak ganda. Baris absen tetap. Selfie yang menjadi foto acuan disimpan selama pegawai aktif; foto acuan pegawai yang sudah nonaktif lebih dari 90 hari ikut dilepas. Untuk masa tanpa pemakaian sama sekali, Edge `attendance-form` menerima operasi terjadwal `retention` (hanya dengan secret key; gateway HP tidak meneruskannya) yang bisa dipanggil pg_cron + pg_net lewat `supabase/setup/schedule-attendance-retention.sql` (opsional). Status penghapusan dan jumlah selfie yang menunggu tampil di tab Titik Absen.
- Semua tabel baru memakai RLS tanpa grant ke `anon`, `authenticated`, maupun `service_role`; hanya fungsi server yang membaca/menulis.
- CSP ditambah `img-src https://tile.openstreetmap.org` untuk ubin peta di halaman Titik Absen. HP absen tidak memuat peta.

## Uji lokal

```bash
node scripts/preview-absensi.mjs            # portal pratinjau + data fiktif (http://127.0.0.1:4625)
node --test tests/attendance.test.mjs tests/attendance-form-transport.test.mjs
node scripts/verify-attendance-postgres.mjs <pglite/dist/index.js>
PLAYWRIGHT_MODULE=<path playwright> node scripts/verify-attendance-ui.mjs [folder-tangkapan-layar]
```

Akun pratinjau (password `Preview2026!`): `pengelola.absen`, `koordinator.absen`, `pegawai.absen`, `admin.preview`. Skrip mencetak tautan HP pribadi contoh milik Koordinator Pos Contoh, atasan langsung tiga petugas: dari HP itu koordinator bisa mengabsenkan ketiganya, sedangkan nama lain tidak tersedia. Kamera dan lokasi hanya jalan di *secure context*: buka `/absen/` di laptop yang sama (Chrome DevTools → Toggle device toolbar, Sensors → Location), atau lewatkan port melalui tunnel HTTPS dan jalankan dengan `PREVIEW_ORIGIN=https://alamat-tunnel`. Di iPhone, ikon layar utama punya penyimpanan sendiri: pasang ikon dulu, buka dari ikon, lalu tempel tautan pendaftaran.

Pengujian SQLite mencakup tanda tangan HP, pencatatan waktu aktual, pemberian akses, dan pencabutan izin saat selfie sedang diunggah. Pengujian PostgreSQL memakai seluruh migrasi, Edge terpaket, dan penyimpanan Drive tiruan. Pengujian browser mencakup peta, pendaftaran HP, atasan mengabsenkan bawahan langsung, HP tanpa bawahan, HP bersama lama, absen di dalam dan di luar titik, pratinjau selfie dan kirim ulang foto sesudah ditolak di luar radius, pengelolaan akses, tinjauan selfie, dan ekspor Excel. Kamera dan GPS pada HP sungguhan, pemasangan ikon, serta sinyal lemah di lapangan diuji saat pilot.

## Rilis pembaruan

Berlaku untuk pembaruan sesudah pemasangan awal. Urutannya tetap migrasi → Edge Function → `portal-api` → merge (Pages).

**`portal-api` selalu ditambal di atas versi yang sedang tayang.** Unduh versi aktif, simpan salinannya sebagai titik kembali, lalu hitung SHA-256-nya. Bila sama dengan snapshot dasar pembaruan itu, deploy `supabase/deploy/portal-api/index.ts` dari repo. Bila berbeda, jalankan `node scripts/build-attendance-deploy.mjs <berkas-aktif.ts> <sha256>` dan deploy hasilnya; skrip hanya membangkitkan ulang lingkup Absensi, sehingga tambalan modul lain tetap utuh. Jangan mendeploy berkas `portal-api` dari rilis atau cabang yang lebih lama, karena kode Absensi yang lebih baru ikut tercabut.

### PR #46 — jadwal Sekretariat dan cek radius sebelum selfie (di-merge 26 November)

1. Prasyarat: migrasi PR #43–#45 (`20261120090000`, `20261123100000`, `20261125090000`) sudah jalan, karena `portal-api` rilis ini ikut membawa backend ketiganya.
2. Pra-cek: `SELECT id,code,name FROM portal.org_units WHERE code='BPB_S' AND is_active=1;` harus menghasilkan 1 baris. Bila kosong, migrasi tetap sukses tetapi jadwal Sekretariat tidak terisi.
3. Migrasi berurutan: `20261125132221_attendance_fixed_schedules.sql`, lalu `20261125132222_attendance_outside_access_basis.sql`. Cek: `SELECT count(*) FROM portal.attendance_schedule_weekdays;` = 6 dan `SELECT count(*) FROM portal.attendance_schedule_holidays;` = 61. Daftar **Absen di luar area kantor** awalnya kosong.
4. Edge `attendance-form` → SHA-256 `7ee11ac2482369a64388a5f40a26a0fe8ce6dae0fb2cd3cb6450461fdb81aabd`, `verify_jwt` tetap mati. HP versi ini memanggil aksi baru `check-location`, yang dijawab 404 oleh Edge lama; bila semua HP gagal sebelum kamera terbuka, periksa versi Edge ini.
5. `portal-api`: snapshot dasar `94eaa33e088d10fdeeeac168739fecfcb2d3591e0285f07ce123fe7a8b35acae` → `d09d5a36e55660cad27684ee2099bc41286d23fa35efe8e50eff3d090cc4938b` (master `528c778`).
6. Pastikan titik kantor yang dipakai pegawai aktif, lalu uji radiusnya dari dalam gedung dengan HP sungguhan. Di luar radius absen ditolak, kecuali untuk pegawai di daftar **Absen di luar area kantor**.
7. Merge PR (cache `/absen/` `sph-absen-v1.3.0`).

### PR #47 — pratinjau selfie dan keterangan ketepatan masuk

Tanpa migrasi. HP dan portal lama mengabaikan field baru `timing`; HP dan portal baru tetap berjalan tanpa keterangan bila backend belum diperbarui. Jadi urutannya tidak kritis, tetapi backend sebaiknya didahulukan supaya keterangan langsung tampil.

1. Edge `attendance-form` → SHA-256 `9c3db4bc787427dd79543f14cb561f048eaae807c0b990cf2165a8eb0c375507`, `verify_jwt` tetap mati.
2. `portal-api`: snapshot dasar `d09d5a36…` (master `528c778`) → `62c82e429c2f21c1e13c826679de6d1669aaa9b09fa5148f7ca3429d5de633b4`.
3. Uji di HP sungguhan (Android dan iPhone): pratinjau, **Ambil ulang foto**, **Kembali**, **Cek lokasi lagi**, dan keterangan ketepatan masuk untuk pegawai Sekretariat.
4. Merge PR: cache `/absen/` `sph-absen-v1.4.3`, bundel `/app/` `portal-17fe45d1dbb7.js` + `portal-28cfaa1eaf72.css`.

### Absen untuk orang lain hanya oleh atasan langsung (cabang `claude/absensi-hanya-atasan-langsung`)

Tanpa migrasi dan tanpa mengubah data. Prasyarat: PR #47 sudah dirilis (Edge `9c3db4bc…`, `portal-api` `62c82e42…`).

1. **Sebelum rilis**, jalankan `supabase/checks/check-attendance-direct-supervisor.sql` di SQL Editor (hanya membaca). Hasilnya:
   - HP bersama yang masih aktif atau menunggu. Sesudah rilis HP itu tidak bisa dipakai absen: siapkan tautan HP pribadi untuk pemegangnya, atau nonaktifkan.
   - Absen 30 hari terakhir di HP pribadi orang lain yang bukan atasan langsungnya. Absen seperti ini ditolak sesudah rilis, jadi beri tahu pegawai dan pemilik HP tersebut.
   - Pegawai aktif tanpa atasan langsung yang pasti. Bila pegawai itu tidak punya HP, rapikan atasannya di Data Pegawai lebih dulu.
2. Edge `attendance-form` → SHA-256 `ac664fa078bdc1db9f117d601acf36c6d9c8886a8e7aedc4f0f188ffbc36e40e`, `verify_jwt` tetap mati. Mulai saat ini server menerapkan aturan baru, juga untuk HP yang masih memuat halaman lama.
3. `portal-api`: snapshot dasar `62c82e42…` (master `2e69b61`) → `66d01d558d53ffc50f1fe9951cf1055920e651d5f22984bca7cfe0c9ceb23d6c`. Hanya rute HP Absen yang berubah: HP bersama tidak bisa didaftarkan dan tidak mendapat tautan baru, dan daftar HP menandainya **Tidak dipakai lagi**.
4. Merge PR: cache `/absen/` `sph-absen-v1.5.0`, bundel `/app/` `portal-15dc4ab7e63d.js` + `portal-28cfaa1eaf72.css`.
5. Uji di HP sungguhan:
   - HP pribadi atasan: **Absen untuk bawahan** hanya menampilkan bawahan langsungnya, lalu absen satu bawahan sampai tercatat;
   - HP pegawai tanpa bawahan: tidak ada tombol untuk orang lain;
   - HP bersama lama: tampil layar **HP bersama tidak dipakai lagi**; tempel tautan HP pribadi pemegangnya, lalu pastikan HP itu kembali bisa dipakai dan baris HP bersama berubah **Nonaktif**.

Urutan Edge → Pages dianjurkan, tetapi tidak kritis. Halaman HP lama dengan Edge baru hanya bisa mencari nama bawahan langsung. Halaman HP baru dengan Edge lama sudah tidak menampilkan nama lain dan menampilkan layar HP bersama, tetapi penolakan di server baru berlaku sesudah langkah 2.

## Riwayat pemasangan awal Tahap 1 (November 2026)

Urutan mengikuti kebiasaan proyek: migrasi → Edge Function → aset Pages → pemeriksaan produksi. Pengaman rilis membuat urutan Pages dan server aman bila tertukar: menu Absensi baru tampil setelah `portal-api` menjawab `attendance/overview`.

0. **Pra-cek** di SQL Editor: `supabase/checks/check-attendance-readiness.sql` (hanya membaca, satu tabel hasil). Semua prasyarat harus OK, terutama kolom `leave_request_days.leave_type` dari migrasi Cuti khusus; tanpa kolom itu rekap Absensi gagal. Periksa juga data unit pilot (penempatan utama tunggal, atasan, nomor HP, akun atasan). Di Google Cloud, status OAuth consent screen untuk Drive portal harus *In production*: bila masih *Testing*, refresh token kedaluwarsa 7 hari dan absen gagal karena selfie tidak bisa diunggah.
1. **Migrasi** di SQL Editor: `20261105120000_attendance_module.sql`. Aditif, satu transaksi; membuat 10 tabel, izin, dan role Pengelola Absensi / Koordinator HP Absen (Super Admin otomatis mendapat izin).
2. **Edge Function `attendance-form`** (baru): deploy `supabase/deploy/attendance-form/index.ts` (SHA-256 `5624a7c01db4c6722ff4a5d2c951568022a69f7dff3c7d0481d3fc9698774472`) dengan `verify_jwt=false`, seperti fungsi tanpa login lainnya. Secret Drive dan `SUPABASE_DB_URL` yang sudah ada terbaca otomatis.
3. **Edge Function `portal-api`**: unduh dulu versi yang aktif, simpan salinannya sebagai titik kembali, lalu hitung SHA-256-nya.
   - Bila sama dengan snapshot dasar `e580bd6e8747399aa7fe870812da08cb872ab7f7fb9d50b77ec418b82288aa8b` (isi `supabase/deploy/portal-api/index.ts` di master `187455b`), deploy `supabase/deploy/portal-api/index.ts` dari cabang ini (SHA-256 `d3c7448447f92bafc0e93b107c93d9d657166e947fefde32f8755876a50f98b1`).
   - Bila berbeda, jalankan `node scripts/build-attendance-deploy.mjs <berkas-aktif.ts> <sha256>` dan deploy hasilnya. Skrip menolak sendiri bila hash tidak cocok atau snapshot sudah memuat Absensi.
   - PR lain yang menambal `portal-api` (misalnya PR #20) harus dibangun ulang di atas snapshot yang tayang setelah langkah ini; jangan deploy berkas `portal-api` dari cabang lain apa adanya.
4. **Merge** PR ke `master`: Pages menayangkan menu Absensi di `/app/`, halaman `/absen/`, dan gateway `/api/attendance-form/*` (memakai `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `PORTAL_ORIGIN` yang sudah ada). Bundel `/app/`: `portal-5ac191fc4de9.js` + `portal-ec6c0b3c086c.css`.
5. **Uji asap** sekitar 15 menit sebagai Super Admin:
   - muat ulang `/app/`; menu Absensi muncul;
   - karena `portal-api` berganti, buka Cuti, Kunjungan, Merchandise, dan Pengadaan;
   - Titik Absen: tambah titik kantor; HP Absen: daftarkan satu HP bersama untuk uji;
   - dari HP uji: absen MASUK di dalam titik, lalu di luar titik; cek Hari ini; di Perlu dicek buka selfie (tercatat di Riwayat Aktivitas); coba ekspor;
   - folder Drive SPH-Portal-Absensi terbentuk; log Edge `attendance-form` tanpa galat.
6. **Persiapan**: beri role Pengelola Absensi dan Koordinator HP Absen (dengan unit) di Role & Izin → Titik Absen: tambahkan titik kantor/pos (tempel koordinat dari Google Maps, atau klik peta) → HP Absen: daftarkan HP pilot, misalnya lewat sesi pendaftaran.
7. **Pilot** satu unit selama ±2 minggu: mesin sidik jari/wajah dan aplikasi lama tetap dipakai berdampingan. Bandingkan rekap portal dengan sistem lama, periksa antrean Perlu dicek, lalu putuskan perpindahan unit berikutnya.
8. *(Opsional)* jadwal harian penghapusan selfie: `supabase/setup/schedule-attendance-retention.sql` (isi `<PROJECT_REF>` dan `<SECRET_KEY>` dulu). Belum diuji di Supabase sungguhan; periksa "Terakhir berjalan" di Titik Absen keesokan harinya.

## Rollback

Kembalikan per pembaruan, mulai dari yang terakhir dirilis. Migrasi Absensi aditif dan boleh dibiarkan; data absen tetap tersimpan.

| Pembaruan | Edge `attendance-form` | `portal-api` | Pages |
|---|---|---|---|
| Atasan langsung | `9c3db4bc…` | salinan versi aktif sebelum deploy (`62c82e42…` bila itu yang aktif) | revert PR cabang `claude/absensi-hanya-atasan-langsung` |
| PR #47 | `7ee11ac2…` | salinan versi aktif sebelum deploy (`d09d5a36…` bila itu yang aktif) | revert PR #47 |
| PR #46 | `5624a7c0…` | salinan versi aktif sebelum deploy (`94eaa33e…` bila itu yang aktif) | revert PR #46, sesudah PR #47 di-revert |

- **Pages** cepat: Cloudflare → Workers & Pages → sph-portal → Deployments → deployment produksi terakhir sebelum merge → *Rollback to this deployment* (sementara; deploy berikutnya dari master menimpanya). Permanen: tombol *Revert* di PR, lalu merge PR revert itu.
- **Menghentikan absen dari HP sementara** tanpa menyentuh modul lain: hapus Edge `attendance-form`. HP menampilkan pesan gagal saat dibuka, sedangkan data tetap bisa dibaca di portal. Deploy ulang berkas yang sama untuk menyalakannya lagi.
- **Jadwal retensi** (bila dipasang): `SELECT cron.unschedule('attendance-selfie-retention');`
- **Atasan langsung**: tidak ada data yang perlu dibatalkan. HP bersama yang sudah didaftarkan ulang sebagai HP pribadi tetap HP pribadi; pendaftaran bersamanya yang lama tetap nonaktif, jadi bila HP bersama ingin dipakai lagi, daftarkan HP baru. HP bersama yang tidak didaftarkan ulang langsung bisa dipakai lagi.
- **Titik kembali sebelum Absensi** (master `187455b`, `portal-api` `e580bd6e…`, 10 November) kini hanya catatan sejarah. Jangan dipakai lagi: mengembalikan Pages atau `portal-api` ke versi itu ikut mencabut semua pembaruan sesudahnya, antara lain E-Arsip Humas, pembaruan Kunjungan, Merchandise, dan Barang Titipan UMKM.

**Sesudah rollback:**
- Periksa versi tayang lewat daftar Deployments Cloudflare atau nama bundel di sumber halaman `/app/`. Jangan mengandalkan `portal-static/manifest.json`: `/portal-static/*` di-cache 1 tahun, jadi manifest bisa menampilkan versi lama.
- Bila absen dari HP dihentikan, beri tahu pegawai untuk kembali ke mesin/aplikasi lama.
- Data absen tetap di tabel. Selfie tetap di folder Drive SPH-Portal-Absensi dan tidak lagi terhapus otomatis bila Edge `attendance-form` dihapus; putuskan apakah disimpan untuk dipakai lagi atau folder dihapus manual.

**Memasang lagi sesudah revert**: revert commit revert-nya (seperti pemasangan ulang 10 November), bangun ulang frontend bila master sudah bergerak (`node scripts/build-cloud-deploy.mjs --frontend-only`), lalu ulangi langkah rilis. Jangan merge ulang cabang lama, karena Git menganggapnya sudah masuk.

## Pemberitahuan privasi (draf untuk pegawai)

> Absen di portal mencatat nama, jam, lokasi HP saat Anda menekan tombol absen, dan selfie. Lokasi tidak dilacak di luar saat absen. Selfie dipakai untuk memastikan absen dilakukan oleh orang yang benar, hanya dapat dilihat atasan dan pengelola absensi (setiap kali dibuka tercatat), dan dihapus otomatis setelah 90 hari, kecuali satu foto acuan per pegawai yang disimpan selama Anda aktif bekerja. Catatan jam absen disimpan sebagai rekap kepegawaian. Pertanyaan atau koreksi data dapat disampaikan kepada SDM.

Teks ini perlu disahkan pemilik/SDM sebelum pilot dan dapat dipasang di halaman privasi.

## Pilot jadwal Sekretariat

Tab **Jadwal Kerja** menampilkan shift per tanggal sesuai cakupan akun. Jadwal berlaku sejak migrasi dipasang dan mengikuti penempatan utama pegawai aktif pada tanggal yang dipilih, termasuk THL. Senin–Jumat memakai `10000` (08.00–16.00 WITA), Sabtu memakai `10001` (08.00–13.00 WITA), dan keduanya mulai terlambat pukul 08.16 WITA. Minggu berstatus **Libur mingguan**. Hari libur nasional dan hari raya Hindu Bali berstatus **Hari libur** beserta namanya. Cuti bersama tetap hari kerja.

Pegawai yang posisinya punya acuan shift (lihat bagian berikut) tidak ikut jadwal tetap unitnya, termasuk kalender liburnya. Menurut SDM, mereka tetap masuk pada hari raya Bali.

Migrasi `20261125132221_attendance_fixed_schedules.sql` memuat:
- master 41 shift yang dikonfirmasi SDM 26 Nov 2026, dengan mulai terlambat = jam masuk + 16 menit untuk semua shift;
- libur nasional dari SKB 2026–2027 (bagian A, tanpa cuti bersama);
- hari raya Hindu Bali 2026–2027 dari daftar Ditjen Bimas Hindu Kemenag yang berlabel Libur Fakultatif, tanpa Deepavali: Siwaratri, Penampahan Galungan, Galungan, Umanis Galungan, Penampahan Kuningan, Kuningan, Tawur Agung Kesanga (2027), Ngembak Geni, Saraswati, dan Pagerwesi.

Kalender hanya bisa diubah lewat SQL. Tahun di luar kalender tersebut menampilkan status **Kalender libur belum tersedia** pada hari dengan pola kerja. Kalender 2028 perlu ditambahkan sebelum akhir 2027, setelah SKB dan daftar Bimas Hindu 2028 terbit. Rekap masih memakai catatan absen, koreksi, keterangan, dan cuti yang disetujui. Bukti absen masuk pertama dan riwayat di HP pribadi menampilkan ketepatan jam yang tercatat. Di portal, tab **Hari ini**, **Absen saya**, rincian rekap, dan ekspor harian memakai jam masuk setelah koreksi. Untuk Sekretariat, 08.15 WITA masih dalam toleransi. Mulai 08.16, durasi terlambat dihitung sejak jam masuk 08.00. Penilaian hanya berlaku jika jadwal kerja pegawai pada tanggal itu sudah pasti. Keterangannya ditulis seperti **Terlambat 16 menit dari jam masuk 08.00 WITA**; 60 menit atau lebih ditulis dalam jam dan menit, misalnya **Terlambat 1 jam 5 menit**. Lembar **Ringkasan** di ekspor punya kolom terpisah **Hari terlambat** dan **Menit terlambat** (total menit sejak jam masuk), dihitung dari keterangan per hari di lembar **Rincian harian**. Kolom **Penilaian jam masuk** menunjukkan berapa hari masuk yang bisa dinilai. Jika ada jam masuk tetapi seluruhnya belum bisa dinilai, kolom ini menampilkan **Belum dapat dinilai** dan kedua total terlambat dikosongkan. Untuk periode campuran, total mencakup hari yang bisa dinilai saja. Periode tanpa jam masuk ditandai **Tidak ada jam masuk**.

Keputusan pemilik (27 November 2026, malam): absen untuk orang lain hanya oleh atasan langsungnya, dari HP pribadi atasan itu, untuk mencegah titip absen. HP bersama tidak dipakai lagi, dan tanda HP pribadi ramai dihapus. Rinciannya ada di **Cara kerja singkat** nomor 1.

Keputusan pemilik (27 November 2026): keterangan telat tetap muncul apa pun keadaannya, termasuk bila pada hari itu ada keterangan Izin/Sakit/Dinas luar, izin absen di luar area kantor, atau cuti yang disetujui. Riwayat di HP pribadi tidak mengikuti koreksi atasan.

## Acuan shift per posisi

Di **Absensi → Acuan Shift**, pilih posisi untuk melihat kode, jam masuk dan pulang, serta jam mulai terlambat dalam WITA.

| Posisi | Kode acuan |
|---|---|
| Staf Pelayanan Internal Sekretariat (`BPB_S_P056`) | `50001` (07.00–15.00 WITA), `50002` (10.00–18.00 WITA) |
| Koordinator dan staf Pelayanan Shuttle | `20001`–`20004` |
| Koordinator dan staf Pelayanan Parkir | `21001`–`21003` |
| Koordinator dan staf Informasi & Penjualan Tiket, Administrasi Layanan Kunjungan, serta Review & Keluhan Pelanggan | `22001`–`22004` |
| Koordinator dan staf Keamanan Wilayah I–IV | `30001`–`30003`, `70000`–`70003`, `71000`, `71002`, `71003`, `72001`, `73000` |
| Koordinator dan THL Bankamda | `40001`–`40002` |
| Koordinator, staf, dan THL Kebersihan Lingkungan | `60001`–`60002` |
| Koordinator Kebersihan Parahyangan | `61001`–`61002` |
| Koordinator, staf, dan THL Pertamanan | `62001`–`62002` |
| Koordinator, staf, dan THL Kebersihan Bangunan | Gedung A `63001`–`63002`, B `63003`–`63004`, C `63005`–`63006` |

Acuan melekat ke kode posisi. Pegawai melihat pilihan untuk posisi utamanya, atasan dapat melihat posisi timnya, dan pengelola melihat posisi sesuai cakupan akses. Penugasan gedung, shift penuh atau setengah, serta hari kerja dan libur pegawai memerlukan jadwal harian. Rekap tetap mencatat jam absen aktual.

Untuk Keamanan, daftar berlaku sebagai acuan bidang. Pembagian shift per wilayah atau regu mengikuti penugasan. Kode `71001` memang tidak dipakai.

Kepala Urusan Pengadaan & Pelayanan Internal (`BPB_S_P011`) dan Koordinator Pelayanan Internal (`BPB_S_P025`) mengikuti jadwal reguler Sekretariat beserta kalender liburnya. Acuan untuk posisi lain, misalnya Pengolahan Sampah, menyusul dari SDM.

## Penyimpangan dari PRD / belum di tahap 1

- **Absen untuk orang lain** (keputusan pemilik 27 November 2026) menggantikan bagian PRD tentang HP bersama dan menumpang di HP teman: ATR-AB-07 (satu HP untuk banyak pegawai), ATR-AB-09 (pencarian nama di luar unit), UJI-AB-03 (absen di HP pribadi teman), UJI-AB-17 dan tanda HP pribadi ramai di ATR-TD. Kini hanya pemilik HP dan atasan langsung yang bisa mengabsenkan, dan HP bersama tidak dipakai lagi.
- **Foto acuan** dipilih dari selfie absen (bukan unggah pas foto). Unggahan pas foto bisa ditambahkan bila diperlukan.
- **Keterangan** Izin/Sakit/Dinas luar belum bisa diberi lampiran (surat dokter dan sebagainya).
- **Antrean offline** belum ada: tanpa sinyal, absen ditolak dan HP meminta mencoba lagi (kiriman ulang aman, tidak tercatat dua kali).
- **Notifikasi ke atasan** untuk absen bertanda belum ada; atasan membuka tab Perlu dicek.
- **Roster shift bergilir dan perhitungan Alpa**, serta **ekspor data aplikasi lama** menyusul pada tahap berikutnya.
- Selfie dibaca portal di dalam transaksi baca permintaan (tanpa kunci global), sama seperti unduhan berkas portal lainnya.

## Keputusan yang masih terbuka

Mengikuti PRD: apakah koordinator boleh mendaftarkan HP di lapangan tanpa SDM; apakah data sistem lama dipakai untuk upah THL/tunjangan; pemegang role Pengelola Absensi; unit pilot; masa simpan selfie (usulan 90 hari); titik offline/per unit; toleransi dan format impor jam kerja; nama aplikasi lama dan cara ekspornya.
