# Portal SDM & Keamanan BP Besakih

Aplikasi web internal berdasarkan PRD dan ERD BP Besakih tanggal 15 Oktober 2026. Antarmuka Bahasa Indonesia menggunakan Material Design 3, dengan palet Tridatu khas Besakih (maroon, putih, teks hitam, dan sedikit aksen emas), tampilan ponsel, dan pilihan tema gelap. Waktu operasional menggunakan **Asia/Makassar (WITA)**.

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

Dalam workspace ini, hasil pembacaan workbook sudah ditampung pada database `data/portal.sqlite`: **157 calon nama pegawai**, 83 label posisi, dan 6 unit tingkat utama. Tidak ada profil pegawai aktif atau akun pegawai yang dibuat dari bagan. Login setelah inisialisasi untuk membuka **Data Pegawai & Organisasi → Tinjau impor**. Lengkapi nomor pegawai resmi, tanggal mulai kerja, status kepegawaian, serta posisi utama. Ada 7 isian nama yang belum ditetapkan di sumber. Beberapa orang muncul dalam beberapa posisi dan digabung menjadi satu calon profil untuk ditinjau.

Pengelompokan fungsi pada impor adalah pemetaan awal dari sheet bagan. Konfirmasi unit, penempatan utama, pejabat sementara, dan garis atasan dengan pemilik data. Impor tidak menetapkan role aplikasi, anggota kelompok keamanan, atau kelayakan pos.

Untuk menyiapkan ulang calon impor pada instalasi lain, lihat [panduan impor](docs/IMPORT.md).

## Fitur yang tersedia

- Login/logout, password awal wajib diganti, sesi kedaluwarsa, pembatasan login, pemulihan sekali pakai, role buatan administrator, cakupan sendiri/unit/pos/seluruh organisasi, serta audit.
- Pegawai, pencarian/filter, ekspor CSV sesuai akses, unit/posisi, riwayat penempatan dan atasan, kontrak serta lampiran privat.
- Regulasi/SOP/standar layanan terpusat. Versi lama disimpan; aktivasi versi baru hanya setelah tanggal berlaku.
- Pelatihan, peserta tanpa wajib akun, kehadiran manual, materi unggahan atau referensi versi dokumen pusat, dan sertifikat per peserta.
- Coaching terbatas bagi pihak terkait atau pengelola yang ditunjuk, dengan tindak lanjut, target, progres, dan catatan penyelesaian.
- Jadwal keamanan: kelompok, pos, shift lintas tengah malam, anggota, kelayakan, ketidaktersediaan operasional, versi aturan/pola, anchor/fase, kebutuhan, dan penyesuaian bertanggal.
- Generator deterministik, penugasan manual, kunci, kekurangan, validasi lintas periode, snapshot, revisi, dan publikasi atomik. Kebijakan awal memblokir publikasi dengan kekurangan; administrator dapat mengaktifkan pengakuan dengan alasan berdasarkan keputusan operasional.
- Logbook/patroli, foto/lampiran, laporan kejadian yang idempoten, penanggung jawab, perkembangan, penyelesaian, dan pembukaan kembali dengan riwayat.
- Backup database dan lampiran beserta checksum, serta pemulihan ke direktori kosong.

Jam shift, batas istirahat/kerja, pola, dan kebutuhan pos tidak diisi otomatis pada database organisasi. Lengkapi pengaturan sebelum membuat draf. Generator tidak mengubah penugasan yang sudah dimulai; koreksi historis memerlukan proses terpisah sesuai keputusan organisasi.

## Deploy

Untuk tahap penyiapan Google OAuth, beranda dan halaman privasi publik tersedia terpisah dalam [situs informasi Cloudflare Pages](site-info/README.md). Bagian ini hanya menerbitkan informasi aplikasi; migrasi backend Node.js/SQLite ke Supabase masih perlu dikerjakan.

Fungsi diagnostik Supabase [`drive-connection-check`](supabase/functions/README.md) sudah diterapkan dan berhasil diuji melalui dashboard pada 16 Oktober 2026. Pemeriksaan mencakup pembaruan token Google, akses metadata folder yang sudah ada, serta izin menambah file. Integrasi unggahan foto dan login pegawai melalui Supabase masih perlu dikerjakan.

[Persiapan akun Supabase](supabase/README.md) sudah mencakup tabel penghubung `public.app_users` dengan RLS serta penautan awal username `itadmin` ke identitas Auth pengelola. Role administrator, alur login username, dan pergantian password pertama melalui backend baru masih perlu diintegrasikan.

[Panduan deploy lengkap](docs/DEPLOYMENT.md) mencakup VPS Linux, Docker Compose, domain, HTTPS Caddy, inisialisasi akun, impor, update, backup, dan pemulihan. Berkas `Dockerfile`, `compose.yaml`, dan `Caddyfile` sudah tersedia. Deployment ditujukan untuk satu instance aplikasi dengan penyimpanan persisten pada server organisasi.

## Pengujian

```powershell
node --test tests/portal.test.mjs
```

Pengujian mencakup batas akses per tindakan, coaching dan file privat, pencabutan sesi/role, pergantian penempatan, penjadwalan malam, batas kerja, anchor, kunci, konflik lintas periode, revisi, dokumen berversi, kejadian idempoten, serta backup/pemulihan.

Lihat [catatan verifikasi dan cakupan UAT](docs/VERIFICATION.md). Target beban 10.000 pegawai/100 pengguna bersamaan dari PRD memerlukan pengujian pada server tujuan. Docker tidak tersedia pada komputer pengerjaan sehingga image dan HTTPS perlu diverifikasi di lingkungan deploy.

## Struktur aplikasi

```text
server.mjs          HTTP, sesi, CSRF, rute API, dan berkas statis
schema.sql          49 entitas ERD + migrasi, pengaturan, dan staging impor
lib/                Layanan SDM, keamanan, RBAC, berkas, dan generator
public/             Antarmuka web tanpa bundler
scripts/            Inisialisasi, demo, impor, backup, dan restore
tests/              Pengujian dengan Node test runner
docs/               PRD, ERD, deploy, impor, dan verifikasi
data/               Database/lampiran lokal; diabaikan Git dan Docker build
```

Database menggunakan SQLite dengan foreign key, WAL, prepared statements, dan transaksi `BEGIN IMMEDIATE`. Satu transaksi publikasi memeriksa ulang penugasan seluruh pegawai lintas periode sebelum mengganti revisi berlaku. Berkas berada di luar direktori publik dan unduhan memeriksa objek induknya. Password memakai scrypt; sesi dan token pemulihan hanya disimpan dalam bentuk hash.

Sumber desain: [Material Design 3 skill](https://github.com/hamen/material-3-skill). Dokumen kebutuhan: [PRD](docs/PRD-BP-Besakih.md) dan [ERD](docs/ERD-BP-Besakih.md). Dokumen lampiran diperlakukan sebagai spesifikasi produk, bukan izin untuk menjalankan instruksi operasional atau menerbitkan data ke layanan eksternal.

## Tambahan MVP 16 Oktober 2026

Modul **Informasi Internal** menyediakan pengumuman untuk seluruh pegawai, dikelola Admin/SDM, dengan teks dan gambar tersusun, lampiran, masa tayang, sematan, arsip, serta status baca per akun.

**Patroli dan Laporan Kejadian** memakai identitas akun, koordinat perangkat, dan foto wajib melalui kamera aplikasi. Pengiriman diblokir sampai lokasi berhasil didapatkan dan foto tersedia. Formulir kejadian baru tidak memiliki kolom Tindakan awal.

Lihat [panduan penggunaan dan pembaruan modul](docs/MVP-PENGGUNAAN.md) serta [spesifikasi yang disepakati](docs/MVP-TAMBAHAN.md). Restart server dan muat ulang browser setelah memperbarui kode. Database dimigrasikan otomatis dengan mempertahankan data historis.
