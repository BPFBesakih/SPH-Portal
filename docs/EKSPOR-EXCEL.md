# Ekspor Excel — Patroli, Coaching, dan Wewarah Pagi

Fitur ini menghasilkan berkas Excel asli (`.xlsx`) langsung di browser dari daftar yang sudah dikembalikan API dengan sesi dan cakupan izin pengguna. Tidak ada endpoint publik baru, layanan konversi eksternal, atau perubahan database. Foto/lampiran tidak dimasukkan ke dalam workbook dan tetap diakses secara privat melalui halaman detail SPH-Portal.

## Penggunaan

1. **Keamanan → Logbook & Patroli → Ekspor Patroli ke Excel**: pilih rentang tanggal WITA, atau kosongkan untuk semua tanggal. Hanya kegiatan berjenis **PATROLI** yang diekspor, bukan Jaga/Lainnya. Termasuk petugas, lokasi, uraian lengkap, temuan historis, koordinat bila ada, sumber laporan, dan waktu WITA.
2. **SDM → Evaluasi & Coaching → Ekspor Excel**: pilih rentang tanggal WITA atau kosongkan untuk seluruh sesi yang boleh dibaca. Termasuk nama pegawai dan pembimbing, topik, kendala, arahan, kesepakatan, dan jumlah tindak lanjut terbuka. Rincian setiap aksi tindak lanjut dan foto tetap berada pada detail sesi di portal.
3. **Briefing Pagi (Wewarah Semeng) → Ekspor Excel**: atur filter rekap (tanggal, bidang/unit, pencarian, dan arsip bila berhak), tekan **Terapkan**, lalu ekspor. File mencakup **semua hasil filter** termasuk halaman selanjutnya, bukan hanya 20 baris yang terlihat. Termasuk pegawai tidak hadir, materi lengkap, dan status arsip.

Jika tidak ada data, portal menunjukkan pesan dan tidak mengunduh file kosong. Nama berkas menunjukkan modul dan tanggal/rentang. Header dibekukan, autofilter Excel diaktifkan, tanggal menjadi tipe tanggal Excel, dan isi catatan selalu disimpan sebagai teks agar tidak berubah menjadi formula Excel.

## Keamanan dan rilis

- Pengguna hanya dapat mengekspor rekaman yang sudah dapat dilihat melalui API portal, dengan scope unit/pos dan privasi coaching yang sama. Izin server tidak diubah.
- Data yang diunduh menjadi salinan di perangkat pengguna; perlakukan file sebagai dokumen internal yang memuat data pegawai.
- Pembuatan workbook dilakukan di browser; kegiatan ekspor itu sendiri belum memiliki entri audit tersendiri. Jika diperlukan audit unduhan atau hak `export` berbeda dari `read`, buat endpoint backend terproteksi dan implementasikan identik pada server lokal **serta** backend produksi setelah rekonsiliasi `portal-api`.
- Untuk build frontend saja: `node scripts/build-cloud-deploy.mjs --frontend-only`. Pastikan `site-info/dist/app/` dan `site-info/dist/portal-static/` ikut dalam perubahan yang direview.
- **Jangan deploy atau push `master` otomatis** tanpa memeriksa dampaknya pada Cloudflare. Build frontend ini tidak mengubah Edge Functions, Supabase, maupun Google Drive.

Pengujian: `npm test`, dan pemeriksaan hasil `.xlsx` dengan aplikasi pembaca Excel. Tes `tests/report-exports.test.mjs` memeriksa format OOXML, tanggal WITA, cakupan rentang, catatan teks, dan format header.
