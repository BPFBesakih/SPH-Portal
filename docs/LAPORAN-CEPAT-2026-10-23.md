# Laporan Cepat Keamanan

Status: backend produksi portal-api v14 dan migrasi aditif telah diterapkan pada 23 Oktober 2026. Halaman dan pengelolaan tautan diterbitkan melalui rilis ini.

Petugas membuka satu tautan bersama, mencari dan memilih namanya, memilih kegiatan, menulis uraian, mengambil lokasi dan minimal satu foto kamera, lalu menekan **Kirim laporan**. Pengiriman langsung menjadi catatan pada Logbook & Patroli. Halaman tidak meminta akun atau password dan tidak membuka daftar laporan atau foto yang sudah tersimpan.

## Pengelolaan

Pengelola berizin `security.config.manage` membuka **Logbook & Patroli → Tautan laporan cepat**. Pilih posisi pegawai Keamanan yang diperbolehkan, kemudian **Buat tautan**. Salin dan simpan tautan yang ditampilkan untuk dibagikan. Pembuatan ulang menonaktifkan tautan lama. Tombol **Nonaktifkan tautan** mencabut akses pengiriman tanpa menghapus laporan lama.

Nama berasal dari pegawai aktif dengan penempatan utama yang masih berlaku pada posisi terpilih. Posisi yang tersedia dibatasi ke Keamanan/Ketertiban, Bankamda, Linmas, Satpam, atau Security dan cakupan pengelola. Pegawai tidak harus memiliki akun portal. Pegawai nonaktif atau pindah ke posisi lain langsung keluar dari daftar. Tautan juga berhenti berlaku bila akun pembuatnya kehilangan akses pengelolaan.

## Sumber dan penyimpanan

Nama pada formulir dipilih pengirim, sehingga laporan ditandai `PUBLIC_LINK` dan keterangan tersebut tampil pada detail laporan. `created_by`, pengunggah foto dan aktor audit bernilai null untuk kiriman ini; aplikasi tidak menganggap pengirim telah masuk sebagai pegawai atau administrator. ID pegawai tetap terhubung ke catatan yang sama. Audit menyimpan sumber tautan dan identitas yang dipilih, tanpa token tautan.

Tautan memakai token acak 32 byte pada fragmen URL. Database privat menyimpan hash token. Endpoint publik hanya menerima `context` dan `submit`, memeriksa tautan serta daftar pegawai lagi setiap kali dipakai, membatasi ukuran dan frekuensi permintaan, dan tidak meneruskan pilihan URL/aksi backend dari pengisi. Pengiriman tidak memakai cookie portal. Nama, posisi dan ID pegawai adalah satu-satunya metadata pegawai pada respons formulir; nomor, kontak dan profil lain tidak disajikan.

Foto JPEG/PNG dibatasi 1–5, dari pengambilan kamera formulir. Koordinat dan waktu pengambilan foto/lokasi diperiksa, dengan usia maksimal 15 menit. Browser tidak dapat memberi bukti kriptografis bahwa gambar atau koordinat benar-benar berasal dari perangkat; data ini tidak diperlakukan sebagai verifikasi kehadiran. Pada cloud, bukti disimpan privat pada folder Drive Patroli yang sudah ada dan mengikuti hak baca/unduh logbook. Endpoint publik tidak menerima ID berkas lama untuk ditautkan ulang.

Catatan, relasi foto, sumber laporan dan audit disimpan dalam satu transaksi. Pengiriman ulang dengan kunci dan payload sama mengembalikan bukti penerimaan yang sama. Kegagalan sementara di formulir mempertahankan isian serta foto agar dapat dicoba lagi.

## Penerapan

1. Siapkan rilis terpisah dari commit dan source Edge produksi aktif. Workspace juga berisi pekerjaan lain; hanya patch Laporan Cepat yang diterbitkan.
3. Terapkan migrasi aditif `supabase/migrations/20261022212406_quick_report_links.sql`. Dua tabel baru berada pada schema privat `portal`, ber-RLS, tanpa grant API langsung. Kolom sumber pada laporan lama mendapat default `PORTAL`.
2. Deploy `portal-api` terlebih dahulu dengan pemeriksaan kesehatan yang menerima seluruh tabel privat ber-RLS (minimum 65 tabel). Aksi server `quick-report` memakai validasi tautan sendiri; operasi portal lain tetap memakai sesi lama. `verify_jwt=false` mengikuti konfigurasi SDK dengan autentikasi secret yang sudah aktif.
4. Terbitkan Pages Function `/api/quick-report/*`, halaman `/laporan-cepat/`, serta aset aplikasi dan pengelolaan tautan. Tidak perlu secret Google atau Supabase baru. Panggilan Edge mengikuti region Singapura yang sudah dipakai portal.
5. Pengelola membuat satu tautan dari portal sesudah rilis, lalu menguji foto/lokasi pada perangkat Android/iOS yang akan dipakai. Jangan membagikan alamat halaman tanpa token; tautan lengkap dibuat melalui pengaturan.

## Verifikasi

- `npm test`: 158 tes lulus, termasuk 12 tes domain/HTTP/bridge/migrasi Laporan Cepat.
- `node scripts/verify-cloud-operations.mjs`: 22 pemeriksaan PostgreSQL dan bundel Edge lulus. `node scripts/verify-quick-reports-postgres.mjs` menambahkan enam pemeriksaan paket produksi terpisah. Uji baru memeriksa nama terbatas, kiriman tanpa sesi portal, foto Drive privat pada folder Patroli, retry, konflik, pencabutan, serta migrasi yang dapat diterapkan ulang.
- `node scripts/verify-cloud-portal-ui.mjs <playwright> <browser>`: 28 pemeriksaan regresi portal lulus.
- `node scripts/verify-quick-report-ui.mjs <playwright> <browser>`: enam pemeriksaan lulus, memakai data, lokasi dan kamera fiktif dengan backend lokal nyata. Termasuk hasil commit yang responsnya sengaja diputus, percobaan kirim ulang tanpa duplikasi, dan pembuatan/pencabutan tautan melalui portal. Screenshot berada di `test-results/quick-report-ui/`.

Kamera/GPS perangkat fisik dan pengiriman laporan produksi tidak diuji. Pengujian kiriman memakai data fiktif terpisah. Pemeriksaan produksi menggunakan formulir dan daftar nama tanpa membuat laporan percobaan. Tautan lengkap mengandung token dan tidak disimpan pada repositori.
