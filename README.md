# SPH-Portal — SDM, Keamanan & Pengadaan BP Besakih

Aplikasi internal BP Besakih untuk SDM, Keamanan, Pengadaan, informasi internal, dan administrasi akun. Antarmuka Bahasa Indonesia menggunakan Material Design 3, dengan palet Tridatu khas Besakih (maroon, putih, teks hitam, dan sedikit aksen emas), tampilan ponsel, dan pilihan tema gelap. Waktu operasional menggunakan **Asia/Makassar (WITA)**.

**Diperbarui 25 Oktober 2026.** Baca [konteks lengkap proyek dalam satu file Markdown](docs/KONTEKS-PROYEK.md) untuk keputusan, arsitektur, riwayat rilis, pekerjaan lokal, bukti verifikasi, dan tindak lanjut. PRD/ERD serta catatan bertanggal lama tetap disimpan sebagai riwayat; status terbaru mengacu pada ringkasan tersebut.

## Status terbaru

| Bagian | Status |
|---|---|
| Produksi | [bpbesakih.com](https://bpbesakih.com/), [ruang kerja](https://bpbesakih.com/app/), [halaman masuk](https://bpbesakih.com/portal/). |
| Infrastruktur | Cloudflare Pages/Functions + Supabase Auth/PostgreSQL/Edge Functions + Google Drive privat. Node.js/SQLite tetap tersedia untuk penggunaan lokal. |
| PWA | Sudah dirilis; manifest dan service worker produksi diperiksa 25 Oktober. Dapat dipasang, tetapi data operasional tetap memerlukan internet. |
| Formulir bersama | Laporan Cepat Keamanan dan Coaching native sudah diterbitkan. Pengelola membagikan tautan bertoken; alamat halaman saja tidak memberikan akses pengiriman. |
| Keamanan domain | HSTS 30 hari, SPF/DMARC, DNSSEC, penghapusan origin legacy dan penonaktifan RUM diterapkan 24 Oktober. Lihat [catatan keamanan](docs/SECURITY-HARDENING-2026-10-24.md). |
| Website publik lengkap | Pengembangan/editor konten masih lokal, terpisah dari halaman informasi yang sudah aktif. |

Baseline kode rilis sebelum pembaruan dokumentasi ini adalah [`e30ef6e`](https://github.com/BPFBesakih/SPH-Portal/commit/e30ef6ee03f115a87d24db03f3f1eae7e221810f). Sejumlah patch backend/configuration diterapkan terarah; source aktif harus diperiksa sebelum membangun ulang backend. Folder kerja utama mempunyai perubahan yang belum seluruhnya dipush.

## Coba di komputer lokal

Memerlukan **Node.js 24.14 atau lebih baru dalam seri 24 LTS**. Aplikasi inti memakai modul bawaan Node.js sehingga tidak memerlukan `npm install` atau proses build frontend.

Jalankan dari folder proyek menggunakan PowerShell:

```powershell
node scripts/demo.mjs
$env:DATA_DIR = 'data/demo'
$env:APP_ORIGIN = 'http://127.0.0.1:3000'
node server.mjs
```

Buka [http://127.0.0.1:3000](http://127.0.0.1:3000). Akun demonstrasi:

| Username | Password | Akses |
|---|---|---|
| `admin.demo` | `BesakihDemo!2026` | Role Super Admin, Pengelola SDM, dan Koordinator diberikan secara eksplisit |
| `sdm.demo` | `BesakihDemo!2026` | Pengelola SDM |
| `petugas.demo` | `BesakihDemo!2026` | Jadwal terbit sendiri, pencatatan kegiatan dan laporan sendiri |

Alternatif Windows: `./scripts/start-demo.ps1`. Gunakan `Ctrl+C` untuk menghentikan server.

Database `data/demo/` berisi **data fiktif dan aturan contoh**, terpisah dari calon data pegawai asli. Script demo tidak menimpa database yang sudah berisi akun, dan ditolak dalam `NODE_ENV=production`.

## Mulai dengan data organisasi

Gunakan terminal baru setelah menghentikan demo agar variabel `DATA_DIR` demo tidak terbawa:

```powershell
Copy-Item .env.example .env
node --env-file=.env scripts/init.mjs
node --env-file=.env server.mjs
```

`init.mjs` membuat satu akun `admin` dan menampilkan password acak sementara sekali di terminal. Simpan kredensial tersebut dan ganti password saat login pertama. Jika `ADMIN_PASSWORD` diisi dalam `.env`, nilai itulah yang digunakan. Jangan memasukkan `.env` ke Git. Environment variable terminal mengalahkan `.env`; pastikan `DATA_DIR` menunjuk `./data`, bukan `data/demo`.

Pada impor awal, pembacaan workbook menghasilkan **157 calon nama pegawai**, 83 label posisi, dan 6 unit tingkat utama, dengan 7 isian nama belum ditetapkan. Ini catatan staging historis, bukan jumlah pegawai produksi saat ini; database `data/portal.sqlite` juga tidak disertakan saat clone repo. Impor tidak otomatis membuat profil aktif atau akun. Setelah menyiapkan staging, buka **Data Pegawai & Organisasi → Tinjau impor** dan lengkapi nomor pegawai resmi, tanggal mulai kerja, status kepegawaian, serta posisi utama. Beberapa orang dalam beberapa posisi digabung menjadi satu calon profil untuk ditinjau.

Pengelompokan fungsi pada impor adalah pemetaan awal dari sheet bagan. Konfirmasi unit, penempatan utama, pejabat sementara, dan garis atasan dengan pemilik data. Impor tidak menetapkan role aplikasi, anggota kelompok keamanan, atau kelayakan pos.

Untuk menyiapkan ulang calon impor pada instalasi lain, lihat [panduan impor](docs/IMPORT.md).

## Fitur yang tersedia

- Login/logout, password awal wajib diganti, sesi kedaluwarsa, pembatasan login, pemulihan sekali pakai, role buatan administrator, cakupan sendiri/unit/pos/seluruh organisasi, serta audit.
- Pegawai, pencarian/filter, ekspor CSV sesuai akses, unit/posisi, riwayat penempatan dan atasan, kontrak serta lampiran privat.
- Regulasi/SOP/standar layanan terpusat. Versi lama disimpan; aktivasi versi baru hanya setelah tanggal berlaku. Pengelola dokumen sesuai cakupan unit, termasuk Superadmin, dapat menghapus dokumen melalui konfirmasi. Dokumen terhapus beserta unduhannya ditutup, sementara riwayat dan audit dipertahankan. Unit sasaran dipilih melalui daftar centang saat sasaran “Unit tertentu” dipilih.
- Kegiatan & Pelatihan, peserta tanpa wajib akun, pencarian nama/nomor pegawai dan penambahan beberapa peserta sekaligus, kehadiran manual, materi unggahan atau referensi versi dokumen pusat, dokumentasi foto JPG/PNG, dan sertifikat per peserta. Penghapusan kegiatan tersedia bagi role Superadmin, dengan riwayat audit tetap tersimpan.
- **Kalender Kegiatan & Pelatihan (rilis 27 Oktober 2026):** tampilan bulanan ringkas dan tahunan (12 bulan) memakai kegiatan yang sudah ada. Seluruh akun aktif dapat melihat judul, tanggal, lokasi, keterangan dan status lintas unit tanpa peserta/berkas privat; SDM sesuai cakupan izin dapat mengubah rincian kegiatan. Warna hijau = selesai, oranye = rencana, abu-abu = dibatalkan, tanggal tanpa agenda = tanpa warna.
- Coaching terbatas bagi pihak terkait atau pengelola yang ditunjuk, dengan tindak lanjut, target, progres, dan catatan penyelesaian.
- [Coaching native tanpa login](docs/coaching-native.md), melalui tautan internal bertoken, pencarian karyawan/coach, dan foto privat. Integrasi Google Script lama sudah dipensiunkan.
- Jadwal keamanan: kelompok, pos, shift lintas tengah malam, anggota, kelayakan, ketidaktersediaan operasional, versi aturan/pola, anchor/fase, kebutuhan, dan penyesuaian bertanggal.
- Generator deterministik, penugasan manual, kunci, kekurangan, validasi lintas periode, snapshot, revisi, dan publikasi atomik. Kebijakan awal memblokir publikasi dengan kekurangan; administrator dapat mengaktifkan pengakuan dengan alasan berdasarkan keputusan operasional.
- Logbook/patroli, foto/lampiran, laporan kejadian yang idempoten, penanggung jawab, perkembangan, penyelesaian, dan pembukaan kembali dengan riwayat.
- [Laporan Cepat Keamanan](docs/LAPORAN-CEPAT-2026-10-23.md): tautan pengiriman tanpa login, pilihan pegawai terbatas, nama tempat wajib, GPS opsional dan foto kamera. Laporan melalui login tetap memerlukan GPS.
- [Pengadaan](docs/PENGADAAN.md): PR, persetujuan, Pos RKA, perbandingan vendor, PO/SPK, pembelian, serah terima, dokumen snapshot/QR dan audit. Temuan kontrol yang belum memiliki bukti penutupan tercatat pada [tindak lanjut proyek](docs/KONTEKS-PROYEK.md#11-tindak-lanjut-yang-belum-boleh-dianggap-selesai).
- Backup database/lampiran lokal beserta checksum dan pemulihan ke direktori kosong. Produksi memerlukan cadangan PostgreSQL dan Drive terpisah.

Jam shift, batas istirahat/kerja, pola, dan kebutuhan pos tidak diisi otomatis pada database organisasi. Lengkapi pengaturan sebelum membuat draf. Generator tidak mengubah penugasan yang sudah dimulai; koreksi historis memerlukan proses terpisah sesuai keputusan organisasi.

## Deploy

Jalur produksi memakai **Cloudflare Pages + Supabase + folder Google Drive privat**. Aplikasi lengkap berada di [ruang kerja SPH Portal](https://bpbesakih.com/app/); halaman akun tetap di [halaman masuk](https://bpbesakih.com/portal/). Ruang kerja mendukung pemasangan sebagai aplikasi (PWA) di HP dan komputer; lihat [panduan PWA](docs/PWA.md).

Berkas Drive dipisahkan otomatis ke subfolder per modul, misalnya `SPH-Portal-SOP` dan `SPH-Portal-Pelatihan`. Folder dibuat saat diperlukan; berkas lama dirapikan saat dibuka kembali. Lihat [arsitektur dan penyimpanan](docs/KONTEKS-PROYEK.md#4-arsitektur-dan-penyimpanan).

[Panduan produksi](docs/CLOUDFLARE-SUPABASE.md) menjelaskan migrasi PostgreSQL, sesi, izin/scope, unggahan Drive, penerapan, dan validasi. Migrasi awal 009 dilanjutkan migrasi Pengadaan dan formulir; angka tabel dan staging pada catatan awal bukan inventaris terbaru. Role operasional diberikan admin secara eksplisit sesuai kebijakan tipe administrator.

Cloudflare memakai root `site-info`, build `exit 0`, dan output `dist`. `node scripts/build-cloud-deploy.mjs` menyiapkan paket; opsi `--frontend-only` hanya menyiapkan frontend. Build lokal tidak menerbitkan situs. Push `master` dapat memicu deployment Pages, sementara migrasi dan Edge Functions diterapkan terpisah. Jangan membangun/deploy seluruh folder kerja yang berisi pekerjaan lain tanpa meninjau source produksi dan isi rilis.

**Catatan rilis backend kalender:** `portal-api` production v21 diterapkan sebagai dua penambahan terarah di atas source v20 yang benar-benar aktif (endpoint ringkasan kalender dan perubahan rincian kegiatan). Source modular `supabase/functions/_shared/portal/hr.mjs` ikut diperbarui, tetapi generated bundle lama belum merepresentasikan seluruh patch backend production sebelumnya. **Jangan menjalankan generator/deploy backend penuh sebelum selisih tersebut direkonsiliasi dan diuji regresi PostgreSQL**, agar fitur Briefing Pagi, Keamanan, Pengadaan, dan patch lain tidak terhapus. Untuk aset frontend, gunakan `node scripts/build-cloud-deploy.mjs --frontend-only`.

Halaman publik, privasi, ketentuan, dan bukti Search Console dipertahankan. Fondasi login dan sesi sebelumnya tetap dipakai. Catatan penyiapan tersedia pada [panduan Pages](site-info/README.md) dan [catatan Supabase](supabase/README.md).

Instalasi Node.js/SQLite lokal tetap tersedia. [Panduan VPS/Docker](docs/DEPLOYMENT.md) khusus jalur tersebut; backup SQLite tidak mencadangkan PostgreSQL atau Drive produksi.

## Pengujian

Pembagian akses terbaru: [akun, izin, dan administrasi](docs/KONTEKS-PROYEK.md#akun-izin-dan-administrasi). Superadmin mempunyai akses penuh ke semua modul; IT-admin mengelola administrasi teknis dengan akses operasional terpisah.

```powershell
node --test tests/*.test.mjs
```

Pengujian mencakup batas akses per tindakan, coaching dan file privat, pencabutan sesi/role, pergantian penempatan, penjadwalan malam, batas kerja, anchor, kunci, konflik lintas periode, revisi, dokumen berversi, kejadian idempoten, serta backup/pemulihan.

Lihat [catatan verifikasi dan cakupan UAT](docs/VERIFICATION.md). Paket rilis PWA tercatat lulus 202 tes Node, lima pemeriksaan PWA browser dan 28 regresi portal; suite folder kerja lokal saat itu berisi 225 tes. Angka tersebut berasal dari baseline berbeda, bukan hasil pengujian ulang hari ini. Pemeriksaan HTTP/DNS/PWA tanpa sesi pada 25 Oktober berhasil. Instalasi PWA Android/iPhone, target beban 10.000 pegawai/100 pengguna bersamaan, UAT transaksi operasional, serta pemulihan PostgreSQL+Drive tetap memerlukan bukti tersendiri.

## Struktur aplikasi

```text
server.mjs          HTTP, sesi, CSRF, rute API, dan berkas statis
schema.sql          Schema/migrasi SQLite, pengaturan, dan staging impor
lib/                Layanan SDM, keamanan, RBAC, berkas, dan generator
public/             Source antarmuka native, PWA, ikon, dan formulir
site-info/          Pages Functions dan artefak web di dist/
supabase/           Migrasi, source modular, dan bundle Edge Functions
scripts/            Inisialisasi, demo, impor, backup, dan restore
tests/              Pengujian dengan Node test runner
docs/               PRD, ERD, deploy, impor, dan verifikasi
data/               Database/lampiran lokal; diabaikan Git dan Docker build
```

Jalur lokal menggunakan SQLite dengan foreign key, WAL, prepared statements dan transaksi `BEGIN IMMEDIATE`; password lokal memakai scrypt. Produksi menggunakan Supabase Auth/PostgreSQL serta sesi privat di belakang Pages Functions. Satu transaksi publikasi memeriksa ulang penugasan lintas periode sebelum mengganti revisi berlaku. Unduhan memeriksa izin objek induk; secret dan token produksi tidak dimasukkan ke aset publik.

Sumber desain: [Material Design 3 skill](https://github.com/hamen/material-3-skill). Dokumen kebutuhan: [PRD](docs/PRD-BP-Besakih.md) dan [ERD](docs/ERD-BP-Besakih.md). Dokumen lampiran diperlakukan sebagai spesifikasi produk, bukan izin untuk menjalankan instruksi operasional atau menerbitkan data ke layanan eksternal.

## Informasi Internal dan pelaporan

Modul **Informasi Internal** menyediakan pengumuman untuk seluruh pegawai, dikelola Admin/SDM, dengan teks dan gambar tersusun, lampiran, masa tayang, sematan, arsip, serta status baca per akun.

**Patroli dan Laporan Kejadian melalui akun portal** memakai identitas akun, koordinat perangkat, dan foto wajib melalui kamera aplikasi. Pengiriman diblokir sampai lokasi berhasil didapatkan dan foto tersedia. Formulir kejadian baru tidak memiliki kolom Tindakan awal. Jalur Laporan Cepat mempunyai ketentuan GPS opsional yang dijelaskan di panduannya.

Lihat [panduan penggunaan dan pembaruan modul](docs/MVP-PENGGUNAAN.md) serta [spesifikasi yang disepakati](docs/MVP-TAMBAHAN.md). Pada instalasi Node.js lokal, restart server dan muat ulang browser setelah memperbarui kode; migrasi SQLite dijalankan aplikasi dengan mempertahankan data historis. Produksi Cloudflare/Supabase mengikuti urutan migrasi dan deployment terpisah di panduan produksi.
