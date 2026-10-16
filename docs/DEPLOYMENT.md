# Menjalankan dan deploy Portal Besakih

## 1. Lingkungan

Paket ini berisi server Node.js dan SQLite beserta antarmuka web. Untuk deploy gunakan satu VPS/server Linux dengan Docker Engine serta Docker Compose v2, domain yang dikelola organisasi, dan penyimpanan disk persisten. Mulai dari kapasitas 2 vCPU/2 GB RAM sebagai lingkungan uji; tentukan kapasitas produksi setelah pengujian beban sesuai PRD.

Gunakan satu instance `portal` untuk setiap database. Database harus berada di disk lokal atau volume blok server yang mendukung penguncian SQLite. Jika kelak diperlukan beberapa node aplikasi, lakukan migrasi database dan desain penguncian ke layanan database yang mendukung kebutuhan tersebut.

Unduh source aplikasi ke server, misalnya ke `/opt/besakih-portal`. Instal Docker mengikuti [panduan resmi Docker Engine](https://docs.docker.com/engine/install/). Gunakan [dokumentasi Compose](https://docs.docker.com/compose/gettingstarted/) untuk administrasi layanan dan volume.

## 2. Domain dan HTTPS

1. Arahkan DNS `A` domain, misalnya `hris.example.org`, ke IP VPS. Jika memakai `AAAA`, pastikan koneksi IPv6 benar-benar tersedia.
2. Izinkan koneksi masuk TCP 80 dan 443. SSH dibatasi sesuai pengelolaan server organisasi. Port aplikasi 3000 tidak dipublikasikan oleh Compose.
3. Salin contoh konfigurasi dan ganti domain:

```bash
cd /opt/besakih-portal
cp .env.production.example .env
nano .env
```

Isi `.env`:

```dotenv
DOMAIN=hris.example.org
```

Gunakan domain sebenarnya. `compose.yaml` membentuk `APP_ORIGIN=https://<DOMAIN>` dan mengaktifkan cookie Secure. Caddy memperoleh dan memperbarui sertifikat ketika domain serta akses jaringan memenuhi persyaratan [Automatic HTTPS](https://caddyserver.com/docs/automatic-https).

## 3. Bangun dan inisialisasi

```bash
docker compose config
docker compose build
docker compose run --rm portal node scripts/init.mjs
docker compose up -d
docker compose ps
docker compose logs --tail=50 portal caddy
```

`init.mjs` menampilkan password sementara untuk username `admin`. Catat di penyimpanan kredensial organisasi. Script menolak inisialisasi ulang bila sudah ada akun. Login ke `https://hris.example.org` dan ganti password awal. Semua sesi lama dicabut setelah password berubah; masuk kembali menggunakan password baru.

Sebelum pengguna operasional masuk, buat role/pemberian akses yang tepat, siapkan unit dan pegawai, lalu konfigurasi kebutuhan operasional. Super Admin hanya mendapat kemampuan administratif yang didefinisikan aplikasinya; akses isi coaching dan berkas pegawai diberikan melalui role SDM atau role khusus yang secara eksplisit ditugaskan.

`portal_data` menampung database dan berkas privat; `portal_backups` menampung snapshot. Volume Caddy menyimpan konfigurasi dan sertifikat. Pertahankan nama proyek Compose/direktori deployment agar volume yang sama tetap terpasang setelah update. Hindari perintah yang menghapus volume produksi.

## 4. Pindahkan calon data impor

Ekstraksi Excel dijalankan di komputer yang memiliki file sumber dan Python dengan `openpyxl`, sesuai [panduan impor](IMPORT.md). Transfer `besakih-draft.json` melalui saluran organisasi ke server, kemudian:

```bash
docker compose cp data/imports/besakih-draft.json portal:/tmp/besakih-draft.json
docker compose exec portal node scripts/stage-import.mjs /tmp/besakih-draft.json
```

Command ini menambahkan data **untuk ditinjau**. Nomor pegawai, tanggal mulai, status, penempatan utama, dan atasan harus diperiksa di aplikasi. Jangan menyalin database `data/demo` ke produksi. Untuk migrasi seluruh database yang sudah diisi, gunakan backup/pemulihan, bukan impor ulang.

## 5. Konfigurasi penjadwalan

Di **Keamanan → Jadwal & Penugasan → Pengaturan**, lengkapi secara berurutan:

1. Kelompok dan pos dalam unit operasional yang benar.
2. Shift, termasuk pilihan hari selesai untuk shift malam.
3. Anggota kelompok serta kelayakan setiap petugas pada setiap pos; tanggal berlaku harus mencakup keseluruhan shift.
4. Aturan kerja versi pertama berdasarkan kebijakan yang disetujui: jeda minimum, batas hari beruntun, menit per hari lokal, dan menit tujuh hari.
5. Pola lengkap, binding petugas, tanggal anchor asli, dan offset fase.
6. Kebutuhan setiap hari Senin–Minggu untuk seluruh pos dan shift aktif. Kebutuhan nol tetap dicatat.
7. Ketidaktersediaan atau penyesuaian sementara bila diperlukan.

Buat periode pada tanggal setelah hari ini, pilih seluruh pos cakupannya, buat draf revisi dengan versi aturan, lalu susun otomatis. Periksa konflik dan kekurangan. Publikasi awal dengan kekurangan diblokir. Jika pemilik fungsi menyetujui kebijakan alternatif, administrator mencatat dasar keputusan di **Role & Izin → Kebijakan publikasi jadwal**. Penerbit tetap membutuhkan izin `publish` dan `acknowledge`, serta alasan untuk mengakui kekurangan draf yang tepat.

Jadwal terbit tidak diedit langsung. Buat revisi baru. Penyesuaian sebagian tanggal tidak menghapus tugas di luar tanggal tersebut. Jika perubahan master memengaruhi kebutuhan di luar rentang, perluas rentang secara eksplisit. Petugas melihat revisi terbit, sedangkan draf belum terlihat.

## 6. Backup

Backup menggunakan API backup SQLite yang konsisten, lalu menyalin berkas yang direferensikan snapshot tersebut. File immutable dan checksum diperiksa. Backup memuat data personal dan hash autentikasi, sehingga penyimpanannya mengikuti akses dan retensi organisasi.

```bash
docker compose exec -T portal node scripts/backup.mjs
```

Output menampilkan folder, misalnya `/app/backups/2026-10-15T02-00-00-000Z`. Simpan salinan di media cadangan organisasi; volume pada server yang sama saja tidak melindungi dari kehilangan server. Untuk mengambil satu snapshot:

```bash
docker compose cp portal:/app/backups/2026-10-15T02-00-00-000Z ./backup-20261015
```

Jadwal harian dapat dibuat dengan cron server. Contoh jika source berada di `/opt/besakih-portal`:

```cron
0 2 * * * cd /opt/besakih-portal && /usr/bin/docker compose exec -T portal node scripts/backup.mjs >> /var/log/besakih-backup.log 2>&1
```

Sesuaikan lokasi executable Docker dan zona waktu server. Ini contoh konfigurasi; paket tidak memasang cron secara otomatis. Retensi dan pemindahan ke media cadangan ditetapkan administrator server. Uji pemulihan sebelum penggunaan produksi.

## 7. Pemulihan

Pulihkan ke **direktori/volume baru yang kosong**. Script memverifikasi manifest, checksum database, setiap berkas, integritas SQLite, dan foreign key sebelum menyalin. Database lama tidak ditimpa. Sesi login dan token pemulihan lama dicabut pada hasil pemulihan.

Untuk uji lokal:

```bash
node scripts/restore.mjs ./backup-20261015 ./data-restored
DATA_DIR=./data-restored APP_ORIGIN=http://127.0.0.1:3000 node server.mjs
```

Untuk Docker pada server, gunakan subdirektori baru yang kosong dalam volume data. Data lama tetap berada di direktori asal:

```bash
docker compose stop portal
docker compose run --rm --no-deps portal node scripts/restore.mjs \
  /app/backups/2026-10-15T02-00-00-000Z /app/data/restored-20261015
```

Pastikan folder backup yang dipilih sudah ada di volume `portal_backups`. Jika mengambil backup dari komputer lain, salin dahulu ke folder backup container ketika service masih berjalan, atau pasang folder sumber sebagai bind mount read-only pada command pemulihan.

Setelah restore berhasil, tambahkan pengaturan berikut ke `environment` service `portal` di `compose.yaml`:

```yaml
DATA_DIR: /app/data/restored-20261015
```

Jalankan `docker compose up -d`, lalu verifikasi login, jumlah data, satu unduhan lampiran, dan satu jadwal terbit. Backup berikutnya otomatis memakai database dan lampiran pada `DATA_DIR` baru. Simpan data asal sampai hasil pemulihan disetujui. Jangan menjalankan dua instance penulis terhadap database yang sama.

## 8. Update aplikasi

1. Buat backup dan simpan salinan source versi yang sedang berjalan.
2. Terapkan source baru, periksa catatan migrasi, kemudian jalankan `docker compose build`.
3. Jalankan pengujian pada staging. Skema saat ini versi 2; migrasi v2 menambahkan waktu pembuatan pada tabel penghubung tanpa menghapus riwayat. Pembaruan skema berikutnya harus disertai migrasi yang sesuai.
4. Jalankan `docker compose up -d`, periksa health dan log, lalu verifikasi login serta fitur operasional.
5. Jika rollback diperlukan, gunakan source sebelumnya dan snapshot database yang kompatibel; jangan mengasumsikan database versi baru bisa dibuka source lama.

## 9. Batas verifikasi paket

Server lokal, pengujian otomatis, dan tampilan browser diperiksa pada Windows dengan Node.js 24.19.0. Docker Engine tidak tersedia pada komputer tersebut. `docker compose config`, build image Linux, ACME/sertifikat domain, pengujian beban target PRD, kebijakan retensi, serta UAT pemilik fungsi harus diverifikasi pada server tujuan sebelum rilis operasional. Pemindaian malware eksternal belum diintegrasikan; berkas tetap divalidasi tipe, signature, ukuran, dan akses unduh.

Implementasi ini tidak memasukkan payroll, cuti/izin, KPI, GPS, QR patroli, atau kalender kegiatan, sesuai batas MVP pada PRD.
