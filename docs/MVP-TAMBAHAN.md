# Tambahan MVP SPH-Portal

Tanggal kesepakatan: 16 Oktober 2026.

Dokumen ini mencatat kebutuhan dari pembahasan bersama pengguna sebagai acuan implementasi.

## 1. Informasi Internal

### Penerima dan hak akses

- Pengumuman otomatis ditujukan kepada seluruh pegawai.
- Penerbitan dilakukan oleh Admin atau SDM.
- Admin/SDM dapat mengelola draf, mengedit, menerbitkan, menyematkan, dan mengarsipkan pengumuman.
- Pegawai dan koordinator dapat membaca dan menandai pengumuman sebagai sudah dibaca.
- Status baca dicatat per akun.

### Isi dan tampilan

- Judul, isi, kategori, prioritas, lampiran opsional, dan masa tayang.
- Nama penerbit dan tanggal terbit ditampilkan otomatis.
- Isi mendukung teks dan beberapa gambar JPG/PNG yang disisipkan di antara paragraf, termasuk poster pengumuman.
- Pengelola dapat melihat pratinjau sebelum menerbitkan.
- Gambar menyesuaikan layar ponsel dan dapat diperbesar.
- Lampiran dokumen tersedia terpisah dari gambar di dalam isi.
- Alur pengelolaan: Draf → Terbit → Arsip.
- Penanda belum dibaca, pencarian/filter, serta ringkasan pengumuman terbaru di beranda menjadi bagian rancangan MVP yang dibahas.

## 2. Penyesuaian Logbook & Patroli

### Lokasi perangkat

- Bagian Wilayah/Pos pada formulir disesuaikan untuk mengambil lokasi perangkat pelapor.
- Lokasi diambil dengan izin pengguna saat pelaporan.
- Hasil pengambilan lokasi dicatat sebagai koordinat perangkat; akurasi dan waktu pengambilan menjadi metadata pendukung.
- Pencocokan koordinat dengan wilayah/pos, radius area, dan penentuan pos terdekat berada di luar kebutuhan yang disepakati untuk MVP ini.
- Lokasi ditampilkan agar petugas dapat memeriksa hasil pengambilannya.

### Identitas petugas

- Identitas petugas otomatis berasal dari akun security yang sedang login.
- Nama ditampilkan sebagai informasi yang tidak dapat diedit.
- Server menetapkan identitas dari sesi autentikasi.
- Akun pelapor harus terhubung dengan profil pegawai aktif.

### Uraian kegiatan

- Tersedia teks contoh/placeholder untuk membantu petugas mengisi uraian.
- Contoh ditampilkan sebagai petunjuk, bukan sebagai nilai laporan yang tersimpan otomatis.
- Uraian mencakup kegiatan, kondisi/temuan, dan tindakan yang dilakukan.
- Contoh: "Melakukan patroli di area parkir. Memeriksa penerangan dan akses keluar masuk. Ditemukan satu lampu padam dan sudah dilaporkan kepada koordinator."

### Foto bukti

- Bagian Temuan pada formulir diganti menjadi Foto bukti.
- Minimal satu foto wajib tersedia sebelum laporan dikirim.
- Foto diambil melalui kamera perangkat di dalam aplikasi saat pelaporan.
- Alur formulir menyediakan tombol Ambil foto, pratinjau, serta pilihan ambil ulang atau menambah foto.
- Pemilihan foto dari galeri bukan alur pengambilan bukti yang disepakati.
- Waktu pengambilan dan waktu penerimaan di server dicatat terpisah.

## 3. Penyesuaian Laporan Kejadian

Pola pelaporan mengikuti penyesuaian Logbook & Patroli.

- Lokasi pelaporan diambil dari perangkat dengan izin pengguna, disertai koordinat, akurasi, dan waktu pengambilan. Lokasi ini menunjukkan posisi perangkat saat pelaporan.
- Identitas pelapor otomatis berasal dari sesi akun security yang sedang login dan ditampilkan sebagai informasi yang tidak dapat diedit.
- Akun pelapor harus terhubung dengan profil pegawai aktif.
- Kategori kejadian tetap tersedia, dengan petunjuk seperti "Contoh: Barang tertinggal".
- Kronologi tetap berupa teks dan diberi placeholder. Contoh: "Pada pukul 10.00 WITA ditemukan tas tanpa pemilik di area parkir. Tas ditemukan saat petugas melakukan pemeriksaan area."
- Contoh kronologi hanya menjadi petunjuk pengisian.
- Formulir terdiri atas lokasi pelaporan, pelapor otomatis, waktu kejadian, kategori kejadian, kronologi, dan foto bukti.
- Minimal satu foto bukti wajib diambil melalui kamera aplikasi sebelum laporan dikirim, dengan pratinjau serta pilihan ambil ulang atau menambah foto.
- Waktu kejadian dan waktu penerimaan laporan di server dicatat terpisah.
- Riwayat penanganan, penanggung jawab, status kejadian, dan keterkaitan dengan logbook tetap dipertahankan.

## 4. Keputusan operasional yang diterapkan

- Sesuai jawaban pengguna, kedua formulir memblokir pengiriman sampai lokasi berhasil didapatkan. Foto kamera tetap wajib.
- Waktu kegiatan/kejadian diisi awal dengan waktu sekarang dalam WITA dan dapat disesuaikan untuk mencatat waktu kegiatan/kejadian sebenarnya. Waktu pengambilan bukti dan waktu penerimaan server disimpan terpisah.
- Bukti lokasi/foto harus baru (maksimal 15 menit saat dikirim). Jika melewati batas, petugas diminta mengambil lokasi/foto kembali.
- Tersedia 1–5 foto per laporan. Data laporan dan seluruh relasi foto disimpan dalam satu transaksi, dengan kunci permintaan untuk mencegah laporan ganda saat retry.

## 5. Catatan untuk implementasi

- Kamera dan lokasi memerlukan izin browser dan secure context, dengan HTTPS untuk penggunaan melalui jaringan di perangkat petugas.
- Server mengizinkan kamera dan geolokasi untuk origin aplikasi sendiri; mikrofon tetap dinonaktifkan.
- Master pos saat ini belum memiliki koordinat. Kebutuhan MVP ini tidak mengharuskan penambahan koordinat master pos.
- Migrasi skema versi 3 membuat `post_id` opsional untuk laporan, menambahkan koordinat dan unit pelapor saat pencatatan, serta mempertahankan pos pada data historis.
- Cakupan sendiri/unit/seluruh organisasi mengikuti identitas dan unit pelapor yang ditetapkan server. Grant yang hanya mencakup pos tetap terbatas pada laporan dengan pos terkait, termasuk data historis; koordinat tidak dipakai untuk menebak pos.
- `initial_action` menjadi opsional. Formulir dan API laporan baru menyimpan kejadian tanpa Tindakan awal; nilai historis tetap dapat dilihat pada laporan lama.
- Role bawaan OFFICER mendapat izin unduh bukti logbook/kejadian pada cakupan pemberian role-nya, agar dapat melihat foto laporan sendiri. Grant selain penambahan izin ini dipertahankan.
- Riwayat laporan, relasi kejadian, dan lampiran lama perlu dipertahankan saat migrasi formulir dan skema.
- Kamera langsung dan lokasi perangkat merupakan bukti pendukung. PWA tidak memberi jaminan mutlak terhadap manipulasi perangkat, lokasi, atau sumber kamera.
- Sumber teknis: [Geolocation API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition), [kamera browser](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), dan [HTML Media Capture](https://www.w3.org/TR/html-media-capture/).

## 6. Hasil implementasi

Implementasi tersedia pada kode aplikasi lokal. Penggunaan dan pembaruan instalasi dijelaskan pada [panduan modul tambahan](MVP-PENGGUNAAN.md). Pemeriksaan perangkat fisik (kamera dan lokasi HP) tetap menjadi bagian uji operasional pada URL HTTPS tujuan.
