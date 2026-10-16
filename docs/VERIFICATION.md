# Verifikasi implementasi awal

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
