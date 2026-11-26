# Absensi — absen harian lewat HP terdaftar (tahap 1)

**Status (10 November 2026): dipasang ulang di cabang `claude/absensi-pasang-ulang` di atas master `187455b`, siap di-merge, belum dirilis.** PR #23 sempat di-merge 7 November lalu dibatalkan lewat PR #28 sebelum langkah server dijalankan. Cabang ini membalik pembatalan itu dan menambah enam perbaikan hasil review 10 November. Pemilik repo menguji lokal, lalu merge dan merilis sendiri. Kebutuhan lengkap ada di PRD Absensi revisi 2 (Project `claude/prd-modul-absensi.md`); review kesiapan deploy ada di Project `claude/kesiapan-deploy-absensi.md`.

Tahap 1 mencatat jam **MASUK** dan **PULANG** dengan selfie dan lokasi GPS dari HP, untuk pegawai kantor, petugas shift/lapangan, dan THL (guide tidak ikut). Hasilnya rekap untuk atasan dan SDM, belum untuk gaji atau sanksi. Jam kerja unit dan shift diimpor belakangan; sampai saat itu portal belum menilai terlambat atau alpa, sehingga hari tanpa absen tampil sebagai **"Tidak ada catatan"**. Ekspor data aplikasi absen lama ditunda sesuai keputusan pemilik.

## Cara kerja singkat

1. **Yang didaftarkan adalah HP, bukan pegawai.** Banyak pegawai tidak punya HP dan menumpang absen di HP teman, koordinator, atau HP pos. Di HP terdaftar mana pun, siapa saja bisa absen dengan memilih namanya lalu selfie.
2. **Pendaftaran HP lewat tautan WhatsApp.** Di menu Absensi → HP Absen, SDM atau koordinator membuat tautan sekali pakai (berlaku 7 hari):
   - **HP pribadi**: tautan dikirim ke WhatsApp pemilik (nomor diambil dari data pegawai bila ada). Setiap kali dibuka, HP langsung menampilkan nama pemiliknya.
   - **HP bersama** (HP koordinator/pos): diberi label dan unit. HP menampilkan daftar nama unit itu, dan nama lain bisa dicari (minimal 3 huruf).
   - **Sesi pendaftaran** (5–30 menit, misalnya sesudah briefing pagi): satu tautan dikirim ke grup WhatsApp unit. Setiap HP memilih nama pemiliknya lalu menunggu disetujui di portal. Nama yang dipilih lebih dari satu HP ditandai. Menutup sesi menolak HP yang belum disetujui.
   - QR hanya cara lain untuk membuka tautan yang sama di HP tersebut. **Absen harian tidak memakai QR.**
3. Untuk **absen harian**, buka `https://bpbesakih.com/absen/`, pilih nama, lalu tekan **Masuk** atau **Pulang**. HP mencari lokasi GPS dan server memeriksa radius. Jika lokasinya diizinkan, kamera depan terbuka untuk selfie. Server memeriksa kembali lokasi dan izin saat mencatat absen.
4. **Titik absen.** Pengelola mengatur radius per titik pada peta (bawaan 100 m, rentang 20–1000 m). Pegawai yang berada di luar semua titik aktif langsung mendapat pesan penolakan sebelum selfie. Di **Absensi → Titik Absen → Absen di luar area kantor**, pengelola dengan cakupan seluruh organisasi dapat memberi atau mencabut izin per pegawai. Izin mengikuti pegawai yang dipilih, termasuk di HP bersama. Pemegang izin cukup mengirim selfie dan lokasi. Rekap menandai catatannya sebagai **Izin absen di luar area kantor**. Saat semua titik nonaktif, hanya pegawai dengan izin tersebut yang dapat absen.
5. **Perlu dicek.** Catatan yang memerlukan peninjauan meliputi absen luar area oleh pemegang akses, GPS kurang akurat (>100 m), lokasi melompat (>120 km/jam), banyak orang (≥4 dalam 10 menit) di satu HP pribadi, belum ada foto acuan, tanpa absen masuk/pulang, absen saat cuti, dan titik belum diatur. Atasan langsung atau Pengelola Absensi membandingkan selfie dengan **foto acuan**, lalu menilai *Sesuai* atau *Perlu klarifikasi*.
6. **Status harian dihitung saat dibaca** dari catatan asli, koreksi, keterangan (Izin/Sakit/Dinas luar), dan cuti yang disetujui di modul Cuti. Pulang setelah tengah malam ikut tanggal kerja absen masuknya (shift malam, batas 16 jam).
7. **Absen lebih awal.** Jam masuk yang tercatat mengikuti waktu aktual server. Untuk Sekretariat Senin–Jumat, absen pukul 07.30 WITA diterima di area yang diizinkan. Jadwalnya tetap 08.00–16.00, dengan batas mulai terlambat 08.16. Jika absen pulang pukul 16.00, rentang kehadirannya 8 jam 30 menit. Modul ini belum menghitung lembur.

## Siapa melihat dan mengubah apa

| Peran | Lihat | Ubah |
|---|---|---|
| Pegawai (akun tertaut) | Absen sendiri (tab *Absen saya*) | — |
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
| Versi cloud (async) | `supabase/functions/_shared/portal/attendance*.mjs`, dibuat oleh `node scripts/generate-cloud-modules.mjs --only=attendance-rules,attendance-form,attendance` |
| Edge Function halaman absen | `supabase/functions/attendance-form/index.ts` → paket `supabase/deploy/attendance-form/index.ts` (`node scripts/build-attendance-form.mjs`) |
| Gateway Pages `/api/attendance-form/*` | `site-info/lib/attendance-form.mjs`, `site-info/functions/api/attendance-form/[[action]].js` |
| Tambalan `portal-api` | `scripts/build-attendance-deploy.mjs` → `supabase/deploy/portal-api/index.ts` |
| Migrasi | `supabase/migrations/20261105120000_attendance_module.sql` (dan padanan SQLite di `schema.sql`) |
| Pra-cek rilis (hanya membaca) | `supabase/checks/check-attendance-readiness.sql` |
| Jadwal retensi selfie (opsional) | `supabase/setup/schedule-attendance-retention.sql` (pg_cron + pg_net → operasi `retention`) |
| Antarmuka | `public/attendance.js` (menu Absensi), `public/absen/` (PWA HP), `public/assets/vendor/leaflet/` (Leaflet 1.9.4, BSD-2) |

Pilihan yang penting untuk produksi:

- **Kunci HP**: saat mendaftar, HP membuat pasangan kunci ECDSA P-256 dengan WebCrypto; kunci privat *tidak bisa diekspor* dan tersimpan di IndexedDB HP. Server hanya menyimpan kunci publik. Setiap permintaan menandatangani tindakan, ID HP, jam, dan isi kiriman. Selisih jam lebih dari 10 menit ditolak dengan jam server, lalu HP otomatis mengulang sekali dengan jam yang disesuaikan.
- **Pendaftaran tahan sinyal putus**: kunci baru disimpan di HP *sebelum* pendaftaran dikirim. Bila balasan hilang padahal server sudah menyimpan, kiriman ulang (tombol *Coba lagi*, atau otomatis saat halaman dibuka lagi) memakai kunci yang sama dan mendapat HP yang sama: tautan + kunci sama, atau sesi + kunci + nama sama. Kunci lain tetap ditolak, dan HP yang sudah dinonaktifkan tidak hidup lagi. Halaman juga meminta penyimpanan permanen (`navigator.storage.persist`) supaya kunci tidak terhapus saat ruang HP sempit.
- **Token** tautan dan sesi hanya disimpan sebagai hash (SHA-256) dan hanya ditampilkan sekali kepada pembuatnya. Mendaftar ulang di HP yang sama mencabut pendaftaran lama hanya bila HP membuktikan masih memegang kunci lama. Bukti dari HP yang tidak dikenal server (misalnya sesudah basis data dipulihkan dari backup) diabaikan, sehingga HP tetap bisa mendaftar.
- **Status di HP**: jam masuk/pulang hari ini hanya dikirim untuk pemilik HP pribadi di HP-nya sendiri. Penumpang dan HP bersama hanya melihat keadaannya (belum masuk, sudah masuk, sudah pulang), cukup untuk menyorot tombol yang benar tanpa membuka jam orang lain.
- **Tanpa kunci global portal.** Edge `attendance-form` memakai transaksi pendek dan mengunci per pegawai (`pg_advisory_xact_lock(hashtextextended('portal.attendance:<id>',0))`), sehingga lonjakan absen pagi tidak menahan transaksi portal lain. Batas frekuensi per IP dan per HP (lebih longgar untuk HP bersama).
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

Akun pratinjau (password `Preview2026!`): `pengelola.absen`, `koordinator.absen`, `pegawai.absen`, `admin.preview`. Skrip mencetak tautan HP bersama contoh. Kamera dan lokasi hanya jalan di *secure context*: buka `/absen/` di laptop yang sama (Chrome DevTools → Toggle device toolbar, Sensors → Location), atau lewatkan port melalui tunnel HTTPS dan jalankan dengan `PREVIEW_ORIGIN=https://alamat-tunnel`. Di iPhone, ikon layar utama punya penyimpanan sendiri: pasang ikon dulu, buka dari ikon, lalu tempel tautan pendaftaran.

Pengujian SQLite mencakup tanda tangan HP, pencatatan waktu aktual, pemberian akses, dan pencabutan izin saat selfie sedang diunggah. Pengujian PostgreSQL memakai seluruh migrasi, Edge terpaket, dan penyimpanan Drive tiruan. Pengujian browser mencakup peta, pendaftaran HP, absen di dalam dan di luar titik, pengelolaan akses, tinjauan selfie, dan ekspor Excel. Kamera dan GPS pada HP sungguhan, pemasangan ikon, serta sinyal lemah di lapangan diuji saat pilot.

## Pembaruan akses luar area pada instalasi yang sudah berjalan

Untuk merilis pembaruan, terapkan migrasi `20261125132222_attendance_outside_access_basis.sql`, perbarui Edge Function `attendance-form` dan `portal-api`, lalu rilis aset dan gateway Pages. Pastikan titik kantor yang digunakan pegawai aktif. Daftar pengecualian awal kosong. Untuk membangun bundel `portal-api`, jalankan `scripts/build-attendance-deploy.mjs` terhadap snapshot yang sedang tayang beserta SHA-256 snapshot itu agar perubahan modul lain ikut dipertahankan.

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

**Titik kembali** (versi sebelum Absensi, 10 November 2026). Bila master bergerak sebelum PR ini di-merge, titik kembali Pages adalah parent pertama merge commit PR ini.

| Bagian | Versi sebelum Absensi | Cara kembali |
|---|---|---|
| Pages | master `187455b` (PR #30), bundel `portal-8448a95e95c8.js` + `portal-d51de915396d.css`; cabang `claude/rollback-sebelum-absensi-20261110` | Cepat: Cloudflare → Workers & Pages → sph-portal → Deployments → deployment produksi terakhir sebelum merge → *Rollback to this deployment* (sementara; deploy berikutnya dari master menimpanya). Permanen: tombol *Revert* di PR, lalu merge PR revert itu. |
| `portal-api` | SHA-256 `e580bd6e…` (v30, dicocokkan saat langkah rilis 3) | Deploy ulang salinan versi aktif yang disimpan, atau `supabase/deploy/portal-api/index.ts` dari cabang titik kembali. |
| Edge `attendance-form` | belum ada | Hapus fungsi, atau biarkan (tanpa HP terdaftar tidak dipanggil). |
| Migrasi | belum ada | Tidak dibatalkan: aditif, tabel dan data pilot tetap tersimpan dan tidak dipakai versi lama. |
| Jadwal retensi (bila dipasang) | belum ada | `SELECT cron.unschedule('attendance-selfie-retention');` |

**Pilih tingkatnya:**
1. *Hanya Absensi bermasalah, modul lain normal*: deploy ulang `portal-api` versi sebelumnya; rute absensi kembali 404 dan menu hilang saat pengguna memuat ulang. Bila absen dari HP juga harus berhenti, hapus Edge `attendance-form`. Pages tidak perlu diubah.
2. *Modul lain ikut bermasalah sesudah `portal-api` berganti*: langsung lakukan tingkat 1, lalu cek ulang Cuti, Kunjungan, Merchandise, dan Pengadaan.
3. *Tampilan bermasalah, atau kembali penuh*: rollback deployment Pages di Cloudflare, lalu revert PR di GitHub, ditambah tingkat 1.

**Sesudah rollback:**
- Periksa versi tayang lewat daftar Deployments Cloudflare atau nama bundel di sumber halaman `/app/`. Jangan mengandalkan `portal-static/manifest.json`: `/portal-static/*` di-cache 1 tahun, jadi manifest bisa menampilkan versi lama.
- `/absen/` menjadi 404 bila Pages dikembalikan.
- Beri tahu peserta pilot untuk kembali ke mesin/aplikasi lama.
- Data absen pilot tetap di tabel. Selfie tetap di folder Drive SPH-Portal-Absensi dan tidak lagi terhapus otomatis bila Edge `attendance-form` dihapus; putuskan apakah disimpan untuk dipakai lagi atau folder dihapus manual.

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

Kalender hanya bisa diubah lewat SQL. Tahun di luar kalender tersebut menampilkan status **Kalender libur belum tersedia** pada hari dengan pola kerja. Kalender 2028 perlu ditambahkan sebelum akhir 2027, setelah SKB dan daftar Bimas Hindu 2028 terbit. Rekap masih memakai catatan absen, koreksi, keterangan, dan cuti yang disetujui. Status terlambat dan Alpa memerlukan integrasi jadwal ke perhitungan rekap.

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

- **Foto acuan** dipilih dari selfie absen (bukan unggah pas foto). Unggahan pas foto bisa ditambahkan bila diperlukan.
- **Keterangan** Izin/Sakit/Dinas luar belum bisa diberi lampiran (surat dokter dan sebagainya).
- **Antrean offline** belum ada: tanpa sinyal, absen ditolak dan HP meminta mencoba lagi (kiriman ulang aman, tidak tercatat dua kali).
- **Notifikasi ke atasan** untuk absen bertanda belum ada; atasan membuka tab Perlu dicek.
- **Roster shift bergilir, perhitungan terlambat dan Alpa**, serta **ekspor data aplikasi lama** menyusul pada tahap berikutnya.
- Selfie dibaca portal di dalam transaksi baca permintaan (tanpa kunci global), sama seperti unduhan berkas portal lainnya.

## Keputusan yang masih terbuka

Mengikuti PRD: apakah koordinator boleh mendaftarkan HP di lapangan tanpa SDM; apakah data sistem lama dipakai untuk upah THL/tunjangan; pemegang role Pengelola Absensi; unit pilot; masa simpan selfie (usulan 90 hari); titik offline/per unit; toleransi dan format impor jam kerja; nama aplikasi lama dan cara ekspornya.
