# Verifikasi SPH-Portal — status terbaru dan riwayat

## Pembaruan dokumentasi dan pemeriksaan publik — 25 Oktober 2026

[Konteks proyek](KONTEKS-PROYEK.md) menjadi ringkasan status terbaru. Hasil tes di bagian lama berasal dari tanggal dan baseline berbeda; keterangan “belum deploy”, Super Admin administratif, pengecualian username, jumlah staging, atau domain lama tidak otomatis berlaku saat ini.

- Baseline GitHub sebelum perubahan dokumentasi: `e30ef6ee03f115a87d24db03f3f1eae7e221810f` (PWA). Paket rilis 23 Oktober tercatat lulus 202 tes Node, lima pemeriksaan PWA browser dan 28 regresi portal; folder kerja lokal saat itu lulus 225 tes karena cakupannya lebih luas.
- Pemeriksaan HTTP tanpa sesi: `/`, `/app/`, `/portal/`, `/privacy/`, `/terms/`, `/coaching/` dan `/laporan-cepat/` memberi 200; `/api/health` memberi 200 dengan `status=ok`; `/api/auth/me` memberi 401 yang diharapkan.
- HTML `/app/` menautkan manifest; manifest dan `sw.js` memberi 200 dengan tipe konten sesuai. PWA sudah diterbitkan; pemasangan Android/iPhone fisik belum diperiksa.
- HSTS `max-age=2592000` terkonfirmasi; HTML yang diperiksa tidak memuat beacon Cloudflare. Redirect HTTP/www/Pages mempertahankan jalur dan query. Google DNS memvalidasi SPF/DMARC/DS dengan status 0 dan `AD=true`.
- Penghapusan `PORTAL_LEGACY_ORIGIN` dan konfigurasi dashboard lainnya mengacu bukti 24 Oktober; dashboard tidak dibuka ulang. [Catatan keamanan](SECURITY-HARDENING-2026-10-24.md) memuat rinciannya.
- Tidak ada login, perubahan data produksi, migrasi, atau pengulangan suite aplikasi untuk pembaruan dokumentasi ini. Temuan Pengadaan F1–F4 dari audit 18 Oktober belum mempunyai bukti penutupan dalam catatan yang ditinjau; pengujian normal yang lulus tidak menutup temuan tersebut.

## Riwayat verifikasi implementasi awal

Tanggal pemeriksaan: 15 Oktober 2026. Runtime: Node.js 24.19.0 pada Windows. Acuan: PRD/ERD versi 1.0.

## Pengujian otomatis

Jalankan `node --test tests/portal.test.mjs`. Hasil terakhir: **31 lulus, 0 gagal**.

| Cakupan | Bukti yang diperiksa |
|---|---|
| Integritas database | Foreign key, nomor unik, audit append-only, serta penolakan versi data lama, serta migrasi timestamp relasi tanpa kehilangan grant |
| Hak akses | Grant tindakan dan scope tetap melekat; dua pos dalam satu unit dipisahkan; API lintas modul ditolak |
| Coaching dan berkas | Rekan satu unit tidak otomatis boleh membaca coaching; Super Admin tidak mendapat akses implisit; file_id saja tidak memberi hak unduh; materi dari versi SOP lama tetap mengikuti izin dokumen pusat |
| Akun dan sesi | CSRF, perubahan role berlaku pada permintaan berikutnya, akun tertaut pegawai nonaktif ditolak, password awal wajib diganti, token reset sekali pakai, dan sesi logout tidak dapat dipakai ulang |
| Pegawai | Penempatan lama ditutup tanpa dihapus; atasan melingkar ditolak; administrator terakhir dilindungi |
| Dokumen | Versi masa depan ditolak; versi lama diarsipkan ketika versi baru diaktifkan |
| Pelatihan | Pegawai tanpa akun dapat menjadi peserta; peserta ganda ditolak; belum dicatat dan tidak hadir dibedakan |
| Jadwal | Interval malam WITA, modulo anchor, hasil deterministik, kelayakan sepanjang shift, ketidaktersediaan, jeda, batas harian, rolling tujuh hari dan hari beruntun |
| Revisi jadwal | Periode dengan pos sama tidak overlap; pos berbeda boleh memiliki tanggal sama; kunci dipertahankan; generasi sebagian tidak menghapus tugas di luar rentang |
| Publikasi | Snapshot tetangga yang berubah ditolak; revisi lama pada periode sendiri tidak menimbulkan bentrok palsu; hanya satu revisi berlaku; draf yang memakai revisi acuan lama ditolak |
| Kekurangan | Tidak menghasilkan penugasan ilegal; default publikasi diblokir; pengakuan memerlukan kebijakan, izin, dan alasan |
| Riwayat | Perubahan master shift tidak menimpa assignment yang telah terbit; penugasan terbit tidak diedit langsung |
| Kejadian | Idempotensi permintaan, penolakan key yang dipakai untuk isi berbeda, status penyelesaian dan pembukaan kembali tetap terlacak |
| Berkas dan pemulihan | Signature tidak cocok ditolak; backup database dan lampiran dapat dipulihkan; direktori tujuan terisi ditolak; backup berkas yang rusak ditolak |

Pengujian transaksi publikasi memakai koneksi database aplikasi dengan transaksi tulis SQLite. Verifikasi operasional serentak pada server tujuan tetap diperlukan sebelum menerima target beban PRD.

## Pemeriksaan browser

- Login akun demo dan tampilan dashboard dengan data terhitung.
- Form tambah pegawai menyimpan profil dan penempatan, kemudian detail dan jumlah dashboard berubah.
- Detail pelatihan menampilkan peserta, status kehadiran, materi, serta sertifikat.
- Daftar jadwal terbit menampilkan penugasan hasil generator dan revisi.
- Tampilan ponsel pada viewport 390 × 844: konten mengikuti lebar layar, kartu tersusun ulang, navigasi memakai drawer, dan kontrol sentuh disesuaikan.
- Akun petugas hanya menampilkan modul keamanan, empat penugasan miliknya sendiri, dan pilihan dirinya pada formulir logbook; tombol generasi/publikasi tidak tersedia.
- Tema gelap dan pengembalian ke tema terang.
- Backup CLI pada database demo yang sedang dipakai berhasil dipulihkan: 37 profil demo, 3 lampiran, 0 pelanggaran foreign key, dan 0 sesi lama aktif pada hasil restore.
- Pemeriksaan pesan error JavaScript pada tampilan yang diuji.

## Data sumber

Ekstraksi menghasilkan 157 calon nama, 83 label posisi, dan 7 isian nama belum ditetapkan. Calon data disimpan di staging pada database organisasi dan dipisahkan dari demo. Tidak ada nomor pegawai, tanggal mulai, status resmi, kewenangan, atau kelayakan keamanan yang ditebak dari bagan.

## Sebelum rilis operasional

Pemilik fungsi perlu memverifikasi pemetaan pegawai/organisasi dan memilih keputusan DEC-01–DEC-12 yang relevan, termasuk jam shift, aturan kerja, kelayakan, kebijakan gap, penerbit jadwal, dan retensi. Cakupan cuti/izin, KPI, payroll, GPS, QR, serta kalender kegiatan tetap di luar MVP.

Docker Engine tidak tersedia di komputer pengerjaan. Pemeriksaan konfigurasi/build image, DNS, sertifikat HTTPS, backup ke media organisasi, pengujian pemulihan dalam volume server, target 10.000 pegawai/100 pengguna bersamaan, dan UAT operasional perlu dijalankan pada staging/server tujuan. Pengujian otomatis ini tidak dianggap sebagai pengesahan kebijakan kerja atau pengganti penerimaan oleh pengguna operasional.

## Tambahan MVP — 16 Oktober 2026

Perintah untuk seluruh pengujian: `node --test tests/*.test.mjs` (atau `npm.cmd test`). Total 51 pengujian: 32 pengujian aplikasi utama dan 19 pengujian tambahan pada `tests/mvp.test.mjs`.

Cakupan tambahan: Admin/SDM sebagai penerbit, pembaca lintas unit, draf dan gambar terjadwal privat, teks/gambar berurutan, lampiran, status baca per akun/versi isi, arsip/masa tayang/sematan, pencabutan role, lokasi dan foto wajib, identitas sesi, batas umur bukti, transaksi laporan+foto, retry idempoten, relasi kejadian/logbook, cakupan unit dan pos, header izin perangkat, sesi/CSRF pada endpoint baru, serta migrasi data lama.

Pemeriksaan browser memakai database demo terpisah `data/mvp-qa-20261016` pada port 3001. Berhasil membuat teks → gambar → teks melalui editor, melihat pratinjau, menerbitkan, membuka detail, dan menandai sudah dibaca. Akun petugas dapat membaca pengumuman dengan status baca sendiri, tanpa tombol pengelolaan. Formulir Patroli dan Kejadian diperiksa pada viewport 390 × 844, dengan lebar konten mengikuti viewport, pelapor otomatis, placeholder, tombol kamera, tanpa pilihan berkas galeri, dan Kirim laporan dinonaktifkan sebelum bukti tersedia. Tampilan desktop diperiksa pada 1280 × 900. Label aksesibilitas tombol layar kecil dan pemilihan modul sesudah berganti akun diperbaiki.

Batas verifikasi: pengambilan gambar melalui kamera fisik dan pembacaan posisi fisik HP belum diuji. Validasi bukti dan alur penyimpanan telah diuji melalui server/API dengan data uji. Lakukan uji perangkat Android/iOS di URL HTTPS tujuan sebelum dipakai petugas.


## Kegiatan & Pelatihan — 17 Oktober 2026

Seluruh 114 tes aplikasi dan 19 kelompok pemeriksaan PostgreSQL lulus. Cakupan baru: penghapusan hanya oleh username terverifikasi itadmin, penolakan versi data lama, retensi audit/relasi, pencabutan akses detail dan foto sesudah penghapusan, serta pemisahan foto dokumentasi dari materi. Migrasi SQLite diuji dari schema lama dan saat dibuka ulang tanpa kehilangan agenda atau materi.

Pemeriksaan browser pada server lokal port 3017 memakai database di memori, tiga akun fiktif, dan gambar logo sebagai berkas uji: unggah JPG/PNG melalui pemilih berkas, simpan keterangan, tampilkan galeri, perbesar gambar, serta buka dan batalkan konfirmasi hapus. itadmin melihat tombol hapus; pengelola biasa dapat unggah tanpa tombol hapus; pembaca hanya dapat melihat foto. Tidak ada kegiatan atau berkas produksi yang diubah untuk pengujian ini.

Status penerapan: migrasi kolom tambahan berhasil diterapkan pada proyek SPH-Portal. Pemeriksaan read-only mengonfirmasi deleted_at (text), deleted_by (uuid), serta usage_kind (text, default MATERIAL), dengan RLS dan privilege lama tetap. Health check produksi HTTP 200. Setelah persetujuan eksplisit pengguna, portal-api versi 4 berhasil diaktifkan dan commit e22c0e1 berhasil dipush ke master. Cloudflare Pages melaporkan deployment sukses; aset details.js/forms.js produksi cocok dengan commit. Pemeriksaan browser pada kegiatan yang sudah ada mengonfirmasi bagian Dokumentasi, tombol Tambah foto, dan tombol Hapus kegiatan untuk itadmin. Verifikasi produksi dilakukan dengan membaca tampilan; tidak ada kegiatan produksi yang dihapus atau berkas uji yang diunggah.


## Diagnosa unggahan Google Drive — 17 Oktober 2026

Unggahan nyata pengguna menghasilkan HTTP 503 dengan pesan penyimpanan umum. Log produksi belum memisahkan kegagalan pembaruan token dari penolakan unggahan, sehingga penyebab Google spesifik belum dikonfirmasi. Pemeriksaan fitur sebelumnya membuktikan unggahan lokal dengan data fiktif dan tampilan produksi, belum unggahan ke Google Drive nyata.

Pembaruan yang disiapkan: normalisasi whitespace konfigurasi agar konsisten dengan drive-connection-check; klasifikasi tahap/status dan kode galat Google yang diizinkan; pesan operasional yang lebih jelas; log hanya request_id, tahap, status, dan kode aman. Body galat mentah, token, nama/ID folder, dan isi berkas tidak dicatat. Tujuh tes adapter Drive serta 19 kelompok pemeriksaan PostgreSQL/paket Edge lulus. Setelah persetujuan eksplisit pengguna, commit 96f56c7 sudah dipush dan portal-api versi 5 berhasil aktif. Percobaan ulang memakai logo publik portal mengonfirmasi tahap token gagal dengan HTTP 400 dan kode invalid_grant dari Google. Tidak ada berkas uji yang berhasil dibuat atau ditautkan ke kegiatan. Koneksi Drive memerlukan otorisasi ulang dan pembaruan GOOGLE_DRIVE_REFRESH_TOKEN oleh pemilik akun; keberhasilan unggahan nyata masih menunggu langkah tersebut.

Pengguna mengonfirmasi token dibuat lewat OAuth Playground, tetapi tidak mengingat apakah memakai kredensial OAuth sendiri. [Playground](https://developers.google.com/oauthplayground/) mencabut refresh token bawaan setelah 24 jam; ini kemungkinan penyebab jika opsi kredensial sendiri dahulu tidak digunakan, bukan penyebab pencabutan yang sudah terbukti. Halaman Playground telah disiapkan dengan Use your own OAuth credentials, Access type Offline, dan Force prompt Consent Screen, tanpa memasukkan atau membaca Client Secret/token. Pengguna perlu memakai OAuth client aplikasi yang sesuai, menyelesaikan login/consent Google, lalu memperbarui secret langsung di Supabase.

## Penyimpanan per modul — 19 Oktober 2026

Pengguna menyelesaikan otorisasi ulang dengan OAuth client SPH Portal dan memperbarui refresh token langsung di Supabase. Pengguna mengonfirmasi unggah foto, pembukaan kembali, refresh halaman, serta logout/login ulang berhasil. Screenshot Google Auth Platform menunjukkan Publishing status In production. Tidak ada nilai token atau Client Secret yang disimpan untuk pengerjaan ini.

Atas permintaan pengguna, portal-api versi 11 memisahkan lampiran ke subfolder privat SPH-Portal-SOP, Pelatihan, Pegawai, Patroli, Kejadian, Informasi, Pengadaan, dan Website (untuk modul website saat diterapkan). Modul ditentukan server ketika relasi lampiran disimpan. Berkas lama dirapikan saat dibuka oleh pengguna yang berhak; ID dan relasi berkas tetap sama. Rincian tersedia pada [panduan folder Drive](DRIVE-MODULE-FOLDERS.md).

151 tes Node dan 21 kelompok integrasi PostgreSQL/paket Edge lulus. Paket produksi dibuat dari source aktif versi 10, diuji terpisah, dan source yang diterapkan dikonfirmasi identik dengan paket tersebut. Tidak ada migrasi database, perubahan secret, atau deployment frontend dalam langkah ini. Verifikasi browser produksi menunjukkan unduhan SOP dummy berhasil, foto kegiatan lama termuat (3613 × 3613), serta folder pusat kini berisi SPH-Portal-SOP dan SPH-Portal-Pelatihan sebagai pengganti kedua berkas yang sebelumnya tercampur. Bukti screenshot: test-results/drive-module-folders/production-folders.png. Kode sumber perubahan tetap di workspace; tidak ada push Git dalam langkah ini.

## Pilihan banyak peserta kegiatan & pelatihan — 22 Oktober 2026

Form Tambah peserta menyediakan pencarian nama atau nomor pegawai dan daftar centang. Pilihan tetap tersimpan saat pencarian berubah, ditampilkan bersama jumlah peserta terpilih, dan dapat dibatalkan satu per satu. Pegawai yang sudah terdaftar tidak ditampilkan sebagai pilihan. Nomor pegawai membedakan nama yang sama; daftar dan nama panjang tetap terbaca di ponsel.

POST `training/:id/participants` menerima `employee_ids` untuk menyimpan beberapa peserta dalam satu transaksi, dengan pemeriksaan izin kegiatan dan cakupan tiap pegawai serta audit per peserta. Daftar kosong/invalid, ID berulang, pegawai yang tidak ditemukan, penolakan akses, atau peserta yang sudah terdaftar membatalkan seluruh batch beserta auditnya. Payload lama `employee_id` tetap didukung. Kehadiran awal tetap NOT_RECORDED. Kegagalan penyimpanan mempertahankan pilihan agar dapat dicoba kembali.

168 tes Node, 24 pemeriksaan PostgreSQL/paket Edge, dan 28 pemeriksaan browser terisolasi lulus. Uji browser mencakup pencarian sebagian nama/nomor, pilihan lintas pencarian, pembatalan pilihan, keyboard, nama sama, validasi kosong, satu permintaan untuk seluruh pilihan, percobaan ulang setelah gagal, penonaktifan kontrol saat menyimpan, serta tampilan desktop dan ponsel 390 px. Screenshot: `test-results/cloud-portal-ui/training-participants-desktop.png` dan `test-results/cloud-portal-ui/training-participants-mobile.png`. Paket cloud sudah dibangun ulang di workspace.

Atas instruksi deploy, rilis produksi disiapkan terpisah dari commit aktif `06581793c3fbc64e2328a955bed4063fc4d79cf6` dan source Edge aktif versi 12. Patch hanya menyertakan fitur peserta. Paket rilis ini lulus 146 tes aplikasi, 22 pemeriksaan PostgreSQL/paket Edge (termasuk endpoint batch pada bundel yang diterapkan), dan 28 pemeriksaan browser. `portal-api` versi 13 aktif dengan source identik paket teruji. Commit `5f3c824a1e521fcbd26b857cb84eb2e6e62b8b7b` berhasil dipush ke master, dan Cloudflare Pages melaporkan deployment `d6516e8a-009c-45a4-a06e-174298828bea` sukses.

Verifikasi pada https://bpbesakih.com/app/ memastikan 13 aset frontend identik dengan paket rilis, halaman publik/aplikasi/akun memberikan HTTP 200, health API `ok`, API privat tanpa sesi HTTP 401, dan halaman masuk pada browser terisolasi tanpa exception JavaScript. Pengujian tidak membuat atau mengubah data operasional produksi. Bukti: `test-results/training-participants-deploy-20261022/verification.json` dan `production-login.png`.

## Laporan Cepat Keamanan — pemeriksaan lokal sebelum rilis 23 Oktober 2026

Satu tautan bersama membuka formulir tanpa login, dengan pilihan nama terbatas ke pegawai Keamanan aktif pada posisi yang disetujui pengelola. Pengiriman menyimpan kegiatan, foto kamera dan lokasi ke Logbook & Patroli, dengan penanda sumber tautan dan identitas yang dipilih pengirim. Pengelola dapat membuat ulang dan menonaktifkan tautan melalui portal.

191 tes aplikasi, 26 pemeriksaan PostgreSQL/paket Edge, 28 pemeriksaan regresi browser portal, dan enam pemeriksaan browser formulir baru lulus. Pengujian memakai data fiktif, termasuk penyimpanan melalui HTTP lokal nyata, respons commit yang diputus, retry tanpa duplikasi, foto Drive privat, dan pencabutan tautan. Halaman ponsel 320/390 px serta desktop telah diperiksa. Kode dan migrasi lokal siap; belum ada deployment atau perubahan data produksi untuk fitur ini. Rincian terdapat pada [panduan Laporan Cepat](LAPORAN-CEPAT-2026-10-23.md).

Status sesudah pemeriksaan lokal tersebut: Laporan Cepat sudah dirilis melalui `409c3c1` dan penambahan nama tempat/GPS opsional melalui `89d26b1` pada 23 Oktober. Halaman produksi diperiksa ulang 25 Oktober dengan HTTP 200, tanpa mengirim laporan percobaan. Pernyataan belum deployment pada paragraf sebelumnya hanya menjelaskan tahap pengujian awal.
