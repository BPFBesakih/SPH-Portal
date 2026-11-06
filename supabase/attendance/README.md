# Fondasi modul Absensi SPH-Portal

Status: implementasi tahap awal untuk peninjauan. Belum diaktifkan di produksi.

Titik kantor: **-8.379975, 115.447373**, radius awal **100 meter**. Tidak ada jam kerja, shift, jadwal pegawai, atau penugasan role yang dibuat otomatis.

## Cakupan

- Menu Absensi di akun portal yang sama: halaman hari ini, riwayat, pengajuan Sakit/Izin, jadwal, dan pengaturan sesuai izin.
- Absen masuk/keluar memakai selfie kamera dan GPS saat tombol ditekan. Identitas pegawai berasal dari sesi; jam penerimaan dan jarak dihitung server. Kamera/GPS browser bukan pembuktian biometrik atau jaminan anti-pemalsuan lokasi.
- Satu masuk/keluar per penugasan. Kunci idempotensi dan penguncian transaksi mencegah catatan ganda; pengiriman dengan hasil belum pasti dapat diperiksa ulang.
- Jadwal eksplisit per pegawai/tanggal mulai, termasuk jadwal melewati tengah malam. Satu penugasan per tanggal mulai; belum ada pembangkit pola atau impor shift massal.
- Tidak ada jadwal berarti tidak dihitung alpa. Jadwal draf tidak menghasilkan alpa. Jadwal terbit menyimpan kebijakan yang digunakan untuk penilaian, sehingga perubahan konfigurasi tidak mengubah perhitungan histori. Jadwal lampau tidak dapat diterbitkan secara retroaktif.
- Hadir tanpa keluar tetap hadir, dengan tanda belum lengkap. Sakit/Izin tertunda menghasilkan alpa sementara setelah jendela penugasan ditutup; cuti disetujui dibaca dari modul cuti tanpa mengubah saldonya. Hadir bersamaan dengan cuti/Sakit/Izin diberi tanda pemeriksaan.
- Tahap awal pengajuan adalah satu hari per permohonan, hanya setelah kebijakan SINGLE_DAY dipilih. Bukti wajib; keputusan hanya pengelola dengan cakupan izin, tanpa persetujuan sendiri. Pembatalan/revisi/pengajuan atas nama belum tersedia.
- Koreksi menyimpan nilai sebelum/sesudah dan alasan; event asli tidak diubah. Versi baris mencegah perubahan menimpa pekerjaan pengelola lain.
- Ekspor XLSX tiga sheet: Ringkasan, Detail, Keterangan. Laporan tanggal lintas bulan; maksimum 367 hari/10.000 penugasan. Bukti/foto tidak dimasukkan dalam ekspor.

## Akses dan penyimpanan

Semua tabel memakai RLS dan tidak dapat diakses langsung oleh anon, authenticated, atau service_role. Portal menggunakan gateway transaksi dengan otorisasi server, CSRF yang sudah ada, dan izin `hr.attendance.*`. Role `ATTENDANCE_MANAGER` dibuat tanpa penerima. Penetapan ke Agus/SDM dilakukan setelah daftar pengelola disepakati. Hak rekap, ekspor, koreksi, persetujuan, bukti, jadwal, serta konfigurasi dipisahkan. Konfigurasi organisasi memerlukan cakupan ALL.

Bukti disimpan melalui penyimpanan Google Drive privat yang sudah digunakan portal, dengan metadata khusus absensi. Endpoint berkas generik tidak memperoleh akses ke bukti absensi. Endpoint bukti memeriksa pemilik/cakupan izin, masa akses, dan checksum, serta menggunakan respons private/no-store. JPEG/PNG/PDF maksimum 2 MB; selfie hanya JPEG/PNG. Penolakan transaksi memakai rollback adapter penyimpanan portal.

Retensi saat ini **membatasi akses setelah kedaluwarsa**, belum menjalankan penghapusan fisik terjadwal di Drive. Sebelum membuka pengumpulan bukti produksi, wajib menetapkan serta menerapkan proses penghapusan, retensi metadata, pemberitahuan kepada pegawai, penanggung jawab, dan penanganan bukti hukum. Tidak ada klaim bahwa berkas otomatis terhapus.

## Tiga lapis aktivasi

1. Deployment flag `ATTENDANCE_ENABLED=true` pada gateway, setelah kesiapan operasional diverifikasi. Default tidak menerima absen/pengajuan.
2. Kebijakan organisasi lengkap dan aktif: tanggal mulai, detik batas, pembulatan menit, akurasi/usia GPS, retensi dan pemberitahuan bukti.
3. Aktivasi pegawai dengan tanggal berlaku dan jadwal diterbitkan. Pengaturan profil tidak membuat jadwal otomatis.

Aktivasi/publikasi tidak dijalankan oleh patch ini. Koordinat bukan satu-satunya syarat go-live. Jam kerja, shift, libur, dan keputusan kebijakan yang belum diberikan tetap perlu diselesaikan. Jalankan pilot kamera/GPS di HP Android/iPhone pada kantor, terutama ketepatan lokasi dan perilaku browser saat izin ditolak.

## Build dan migrasi

`schema.sql` adalah sumber skema yang diuji di PostgreSQL/PGlite. Supabase CLI belum tersedia dalam sesi pengembangan; file ini sengaja belum diberi nomor migrasi buatan. Di lingkungan dengan CLI, buat migrasi menggunakan `supabase migration new attendance_foundation`, isi dengan `schema.sql`, lalu review dan uji sebelum menerapkannya. Jangan menjalankan SQL langsung di produksi tanpa alur migrasi yang tercatat.

Baseline gateway ada dalam `baseline.json`: isi live `portal-api` v30 sama dengan GitHub master saat pengembangan dimulai. Builder menolak baseline yang berubah dan hanya menyisipkan modul absensi beserta satu cabang router. Modul cuti, merchandise, dan kunjungan yang sudah live dipertahankan byte-for-byte di luar sisipan.

```sh
node --test tests/attendance.test.mjs
node scripts/build-attendance-deploy.mjs
node scripts/build-cloud-deploy.mjs --frontend-only
```

Jangan memakai build cloud default untuk patch ini: generator lama belum setara dengan semua handler khusus gateway live. Sebelum rilis, bandingkan kembali gateway produksi dan master terbaru, lalu rebase builder dengan review jika berubah. Frontend, proxy Cloudflare, gateway Supabase, dan migrasi perlu dirilis secara terkoordinasi. Hentikan penerimaan baru dengan menghapus/mematikan flag deployment; histori dan bukti tetap mengikuti hak akses/retensinya.
