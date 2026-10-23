# Formulir coaching native

Formulir dibuka langsung pada `https://bpbesakih.com/coaching/#<token>` tanpa akun portal atau Google, seperti laporan patroli. Token harus dibagikan utuh melalui kanal internal; jangan menyimpan nilai token di Git, log, analitik, atau dokumentasi publik. Tautan memungkinkan pengiriman coaching dan pemilihan nama, bukan membaca rekaman coaching.

## Alur dan penyimpanan

- Halaman statis menggunakan pencarian nama karyawan dan coach; Nomor Pegawai tidak ditampilkan. Nama identik pada unit/jabatan yang sama dinonaktifkan agar SDM menyelesaikan data ganda terlebih dahulu.
- Cloudflare Pages `/api/coaching-link/context` dan `/submit` memeriksa asal permintaan, IP ingress, dan ukuran JSON. Kunci server hanya berada di konfigurasi Cloudflare.
- Edge Function `coaching-native` memakai autentikasi kunci server, lalu memeriksa hash token, pegawai aktif, tanggal, isian, foto, batas percobaan, dan idempotensi. Foto JPG/PNG maksimal 10 MB disimpan privat pada folder Drive `SPH-Portal-Coaching`, di dalam `SPH Portal - Foto Laporan`.
- Sesi, tindakan, lampiran, dan sumber kiriman disimpan secara transaksional dalam tabel coaching yang sama dengan portal. Identitas yang dipilih dinyatakan sebagai isian mandiri; tautan ini tidak membuktikan identitas pengisi.
- Tabel `portal.coaching_links` menyimpan hash untuk validasi dan `share_token` privat agar pengelola dapat mengambil kembali link yang sama. RLS aktif tanpa kebijakan akses langsung dan semua hak API dicabut. Endpoint sesi `GET /api/coaching-form-link` hanya mengembalikan link aktif bagi pemegang `hr.coaching.manage` dengan cakupan `ALL`; daftar sesi tidak memuat token. Tidak ada endpoint publik untuk membaca coaching/foto.
- Pada **SDM → Evaluasi & Coaching**, pengelola tersebut melihat tombol **Salin Link Formulir Coaching**. Dialog dapat menyalin link atau membuka formulir. Link tidak disimpan di aset publik, penyimpanan browser, atau log.
- Rekap Google Sheets lama tetap menjadi arsip. Kiriman native disimpan langsung di Supabase dan tidak menambahkan baris ke Sheets lama.

## Aktivasi dan pencabutan

Terapkan migrasi foundation `20261022214727_coaching_custom_form.sql`, lalu `20261023053253_coaching_native_links.sql`. Bangun fungsi menggunakan `node scripts/build-native-coaching.mjs`, deploy fungsi terpisah `coaching-native` dengan pemeriksaan kunci server di handler, dan rilis aset Cloudflare. Jangan menimpa `portal-api` dengan bundle lama.

Satu tautan aktif diperbolehkan. Buat token acak kriptografis 32 byte, simpan hash saja bersama label dan metadata pada `portal.coaching_links`, kemudian bagikan URL dengan token pada fragmen. Untuk mencabut tautan, set `is_active=0`, isi `revoked_at`, dan tingkatkan `row_version`. Untuk mengganti tautan, cabut yang lama terlebih dahulu dalam transaksi, lalu buat token baru. Pencabutan tidak menghapus rekaman atau foto.

Status 23 Oktober 2026: formulir native dan pencarian nama terverifikasi pada domain produksi; satu tautan aktif dibuat tanpa menyimpan token mentah di repositori. Ledger Google lama kosong. Deployment web app lama telah diarsipkan dan URL-nya menampilkan Page Not Found. Semua kode Script diganti pemberitahuan pensiun dan handler `retryCoachingSync_` tanpa operasi (tanpa baca/tulis/upload/jaringan), kemudian proyek dipindahkan ke Sampah Drive. Pemicu tidak dihapus permanen. Folder, foto, dan rekap dipertahankan. Fungsi `coaching-google-sync` versi 2 merespons 410 tanpa akses data dengan gateway JWT aktif.

## Validasi

`node --test tests/*.test.mjs` memeriksa domain, API, transaksi SQLite, foto, idempotensi, pencabutan, batas percobaan dan kompatibilitas portal. `node scripts/verify-native-coaching-postgres.mjs` memeriksa migrasi PostgreSQL dan bundle Edge menggunakan PGlite serta Drive fixture. `node scripts/preview-native-coaching.mjs` menyediakan data contoh lokal untuk uji antarmuka tanpa membuat rekaman SDM produksi.
