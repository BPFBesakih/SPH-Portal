# Absensi — absen harian lewat HP terdaftar (tahap 1)

**Status: kode di cabang `claude/modul-absensi`, belum dirilis.** Pemilik repo menguji lokal lebih dulu, lalu merge dan merilis sendiri. Kebutuhan lengkap ada di PRD Absensi revisi 2 (Project `claude/prd-modul-absensi.md`).

Tahap 1 mencatat jam **MASUK** dan **PULANG** dengan selfie dan lokasi GPS dari HP, untuk pegawai kantor, petugas shift/lapangan, dan THL (guide tidak ikut). Hasilnya rekap untuk atasan dan SDM, belum untuk gaji atau sanksi. Jam kerja unit dan shift diimpor belakangan; sampai saat itu portal belum menilai terlambat atau alpa, sehingga hari tanpa absen tampil sebagai **"Tidak ada catatan"**. Ekspor data aplikasi absen lama ditunda sesuai keputusan pemilik.

## Cara kerja singkat

1. **Yang didaftarkan adalah HP, bukan pegawai.** Banyak pegawai tidak punya HP dan menumpang absen di HP teman, koordinator, atau HP pos. Di HP terdaftar mana pun, siapa saja bisa absen dengan memilih namanya lalu selfie.
2. **Pendaftaran HP lewat tautan WhatsApp.** Di menu Absensi → HP Absen, SDM atau koordinator membuat tautan sekali pakai (berlaku 7 hari):
   - **HP pribadi**: tautan dikirim ke WhatsApp pemilik (nomor diambil dari data pegawai bila ada). Setiap kali dibuka, HP langsung menampilkan nama pemiliknya.
   - **HP bersama** (HP koordinator/pos): diberi label dan unit. HP menampilkan daftar nama unit itu, dan nama lain bisa dicari (minimal 3 huruf).
   - **Sesi pendaftaran** (5–30 menit, misalnya sesudah briefing pagi): satu tautan dikirim ke grup WhatsApp unit. Setiap HP memilih nama pemiliknya lalu menunggu disetujui di portal. Nama yang dipilih lebih dari satu HP ditandai. Menutup sesi menolak HP yang belum disetujui.
   - QR hanya cara lain untuk membuka tautan yang sama di HP tersebut. **Absen harian tidak memakai QR.**
3. **Absen harian** di `https://bpbesakih.com/absen/` (bisa dipasang sebagai ikon): pilih nama → MASUK/PULANG (server menyarankan yang sesuai) → selfie kamera depan. Lokasi diambil saat itu juga, menunggu sampai akurasi ±100 m paling lama 20 detik.
4. **Titik absen** diatur Pengelola Absensi di peta (radius bawaan 100 m, 20–1000 m). Absen di luar semua radius tetap tercatat, tetapi wajib diberi alasan (Dinas luar, Tugas lapangan, Lainnya + keterangan).
5. **Tanda, bukan penolakan.** Absen yang janggal tetap sah dan masuk **Perlu dicek**: di luar titik, GPS kurang akurat (>100 m), lokasi melompat (>120 km/jam), banyak orang (≥4 dalam 10 menit) di satu HP pribadi, belum ada foto acuan, tanpa absen masuk/pulang, absen saat cuti, titik belum diatur. Atasan langsung atau Pengelola Absensi membandingkan selfie dengan **foto acuan** (dipilih dari selfie yang jelas), lalu menilai *Sesuai* atau *Perlu klarifikasi*.
6. **Status harian dihitung saat dibaca** dari catatan asli, koreksi, keterangan (Izin/Sakit/Dinas luar), dan cuti yang disetujui di modul Cuti. Pulang setelah tengah malam ikut tanggal kerja absen masuknya (shift malam, batas 16 jam).

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
| Antarmuka | `public/attendance.js` (menu Absensi), `public/absen/` (PWA HP), `public/assets/vendor/leaflet/` (Leaflet 1.9.4, BSD-2) |

Pilihan yang penting untuk produksi:

- **Kunci HP**: saat mendaftar, HP membuat pasangan kunci ECDSA P-256 dengan WebCrypto; kunci privat *tidak bisa diekspor* dan tersimpan di IndexedDB HP. Server hanya menyimpan kunci publik. Setiap permintaan menandatangani tindakan, ID HP, jam, dan isi kiriman. Selisih jam lebih dari 10 menit ditolak dengan jam server, lalu HP otomatis mengulang sekali dengan jam yang disesuaikan.
- **Token** tautan dan sesi hanya disimpan sebagai hash (SHA-256) dan hanya ditampilkan sekali kepada pembuatnya. Mendaftar ulang di HP yang sama mencabut pendaftaran lama hanya bila HP membuktikan masih memegang kunci lama.
- **Tanpa kunci global portal.** Edge `attendance-form` memakai transaksi pendek dan mengunci per pegawai (`pg_advisory_xact_lock(hashtextextended('portal.attendance:<id>',0))`), sehingga lonjakan absen pagi tidak menahan transaksi portal lain. Batas frekuensi per IP dan per HP (lebih longgar untuk HP bersama).
- **Selfie** (JPEG ≤ 300 KB, diambil ≤ 5 menit sebelum dikirim) diunggah ke Google Drive folder **SPH-Portal-Absensi** *di luar* transaksi; bila penyimpanan absen gagal, berkasnya dihapus lagi. Kiriman ulang dengan kunci kiriman yang sama tidak mengunggah dua kali. Portal membaca selfie satu per satu lewat `attendance/photos/<id>`.
- **Catatan absen append-only**: pemicu basis data menolak DELETE dan semua UPDATE kecuali penghapusan selfie oleh retensi.
- **Retensi 90 hari**: selfie lebih tua dari 90 hari dihapus dari Drive (paling sering 6 jam sekali, berjalan di latar belakang sesudah absen, dengan lease agar tidak ganda). Baris absen tetap. Selfie yang menjadi foto acuan disimpan selama pegawai aktif; foto acuan pegawai yang sudah nonaktif lebih dari 90 hari ikut dilepas. Tidak memakai pg_cron.
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

Yang diuji otomatis di cabang ini: 29 tes aturan/rute/alur HP (SQLite, tanda tangan WebCrypto sungguhan), 5 tes gateway, 11 pemeriksaan PostgreSQL (PGlite: RLS, role, pemicu, Edge terpaket dengan Drive tiruan, kunci per pegawai tanpa kunci global, tambalan portal-api, Cuti, retensi), dan 9 pemeriksaan browser (peta, tautan WhatsApp/QR, absen di HP bersama/pribadi dengan kamera dan GPS tiruan, di luar titik, sesi pendaftaran, Perlu dicek, ekspor Excel, tanpa pelanggaran CSP). Kamera dan GPS di HP sungguhan, pemasangan ikon, serta sinyal lemah di lapangan tetap perlu uji pengguna.

## Rilis (oleh pemilik repo)

1. **Migrasi** di SQL Editor: `20261105120000_attendance_module.sql`. Aditif; membuat 10 tabel, izin, dan role Pengelola Absensi / Koordinator HP Absen (Super Admin otomatis mendapat izin).
2. **Edge Function `attendance-form`** (baru): deploy `supabase/deploy/attendance-form/index.ts` (SHA-256 `b4a6610b9210088cebcc391c435ca858ee4d9a7d4f5c2f5daff8936ebe05ee23`), `verify_jwt=false` seperti fungsi tanpa login lainnya. Secret Drive dan `SUPABASE_DB_URL` yang sudah ada terbaca otomatis.
3. **Edge Function `portal-api`**: pastikan versi aktif sama dengan snapshot dasar (SHA-256 `e580bd6e8747399aa7fe870812da08cb872ab7f7fb9d50b77ec418b82288aa8b`, yaitu `supabase/deploy/portal-api/index.ts` di master `3c7274d`). Bila sama, deploy `supabase/deploy/portal-api/index.ts` dari cabang ini (SHA-256 `9bfcd649cdba581d78567065eadc7967e49c7e11b376f38423c32912a0292e4e`). Bila berbeda (misalnya PR #20 dirilis lebih dulu), unduh versi aktif lalu jalankan `node scripts/build-attendance-deploy.mjs <berkas-aktif.ts> <sha256>` dan deploy hasilnya. Hal yang sama berlaku sebaliknya untuk PR lain yang menambal portal-api.
4. **Merge** ke `master`: Pages menayangkan menu Absensi di `/app/`, halaman `/absen/`, dan gateway `/api/attendance-form/*` (memakai `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `PORTAL_ORIGIN` yang sudah ada). **Pengaman rilis:** menu Absensi hanya muncul bila `portal-api` sudah menjawab `attendance/overview`. Jadi merge boleh dilakukan sebelum langkah 1–3: selama rute itu masih 404, menu tetap tersembunyi dan `#attendance` tidak bisa dibuka. Setelah langkah 1–3 selesai, menu muncul sendiri saat pengguna memuat ulang halaman atau masuk lagi.
5. **Persiapan**: beri role Pengelola Absensi dan Koordinator HP Absen (dengan unit) di Role & Izin → Titik Absen: tambahkan titik kantor/pos (tempel koordinat dari Google Maps, atau klik peta) → HP Absen: daftarkan HP pilot.
6. **Pilot** satu unit selama ±2 minggu: mesin sidik jari/wajah dan aplikasi lama tetap dipakai berdampingan. Bandingkan rekap portal dengan sistem lama, periksa antrean Perlu dicek, lalu putuskan perpindahan unit berikutnya.

Rollback: hentikan pemakaian `/absen/` (nonaktifkan HP atau cabut tautan), Pages → deployment sebelumnya, `portal-api` → versi sebelumnya, Edge `attendance-form` boleh dibiarkan atau dihapus. Migrasi aditif dan tidak perlu dibatalkan; selfie tetap di folder Drive SPH-Portal-Absensi sampai terhapus retensi atau dihapus manual.

## Pemberitahuan privasi (draf untuk pegawai)

> Absen di portal mencatat nama, jam, lokasi HP saat Anda menekan tombol absen, dan selfie. Lokasi tidak dilacak di luar saat absen. Selfie dipakai untuk memastikan absen dilakukan oleh orang yang benar, hanya dapat dilihat atasan dan pengelola absensi (setiap kali dibuka tercatat), dan dihapus otomatis setelah 90 hari, kecuali satu foto acuan per pegawai yang disimpan selama Anda aktif bekerja. Catatan jam absen disimpan sebagai rekap kepegawaian. Pertanyaan atau koreksi data dapat disampaikan kepada SDM.

Teks ini perlu disahkan pemilik/SDM sebelum pilot dan dapat dipasang di halaman privasi.

## Penyimpangan dari PRD / belum di tahap 1

- **Foto acuan** dipilih dari selfie absen (bukan unggah pas foto). Unggahan pas foto bisa ditambahkan bila diperlukan.
- **Keterangan** Izin/Sakit/Dinas luar belum bisa diberi lampiran (surat dokter dan sebagainya).
- **Antrean offline** belum ada: tanpa sinyal, absen ditolak dan HP meminta mencoba lagi (kiriman ulang aman, tidak tercatat dua kali).
- **Notifikasi ke atasan** untuk absen bertanda belum ada; atasan membuka tab Perlu dicek.
- **Jam kerja/shift, terlambat, alpa**, dan **ekspor data aplikasi lama** menyusul pada tahap berikutnya.
- Selfie dibaca portal di dalam transaksi baca permintaan (tanpa kunci global), sama seperti unduhan berkas portal lainnya.

## Keputusan yang masih terbuka

Mengikuti PRD: apakah koordinator boleh mendaftarkan HP di lapangan tanpa SDM; apakah data sistem lama dipakai untuk upah THL/tunjangan; pemegang role Pengelola Absensi; unit pilot; masa simpan selfie (usulan 90 hari); titik offline/per unit; toleransi dan format impor jam kerja; nama aplikasi lama dan cara ekspornya.
