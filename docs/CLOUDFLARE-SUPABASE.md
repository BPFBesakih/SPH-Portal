# Deploy seluruh modul ke Cloudflare + Supabase

Pada 16 Oktober 2026, migrasi produksi berhasil diterapkan, `portal-api` versi 2 aktif, dan commit `492e74f` berhasil diterbitkan Cloudflare. Pemeriksaan publik `/app/` menghasilkan HTTP 200, `/api/health` menghasilkan HTTP 200 dengan `modules_revision=20261016.1`, serta `/api/portal/me` tanpa sesi ditolak HTTP 401. Fingerprint akun sebelum/sesudah migrasi identik; 157 calon impor tetap PENDING, enam izin SUPER_ADMIN tetap sama, dan belum ada profil pegawai aktif yang dibuat dari calon impor.

Validasi lokal: 109 tes Node, 17 kelompok integrasi PostgreSQL/paket Edge, empat kelompok browser aplikasi lengkap, serta tujuh kelompok browser akun lulus. Koneksi database produksi dibuktikan health check; login produksi seluruh modul, unggahan nyata, kamera/GPS perangkat, serta beban operasional masih memerlukan pengujian pengguna sesuai role.

Izin role sistem `SUPER_ADMIN` kini dapat diedit oleh akun berizin `admin.roles.manage`, termasuk saat role tersebut dipakai akun pengelola sendiri. Kode identitas role sistem tetap, sementara pilihan izinnya dapat disesuaikan. Penyimpanan ditolak dan di-rollback jika organisasi kehilangan administrator terakhir yang dapat mengelola akun serta role. Setelah penyimpanan, frontend membaca ulang konteks akun agar perubahan menu langsung terlihat. Perubahan fitur ini tidak memberi atau mencabut izin produksi secara otomatis.

## Arsitektur

Cloudflare Pages menyajikan halaman informasi, halaman akun `/portal/`, dan aplikasi lengkap `/app/`. Pages Functions menjaga cookie sesi, CSRF, verifikasi Auth, refresh, dan pencabutan sesi. Browser hanya mengakses API pada origin sendiri. Token Auth, secret Supabase, dan konfigurasi Drive tidak dikirim ke browser.

Edge Function `portal-api` memakai `@supabase/server` dengan `auth: "secret"`. JWT lama dimatikan karena pemeriksaan secret dilakukan SDK. Operasi modul juga memverifikasi JWT pengguna melalui Auth dan mencocokkan hash sesi, lease, versi, identitas, serta masa berlaku dengan registry sesi privat. Semua operasi memeriksa akun/pegawai aktif, wajib ganti password, izin per tindakan, dan scope per penugasan.

Satu transaksi PostgreSQL meliputi pembacaan otorisasi, perubahan domain, dan audit. Mutasi mengambil advisory lock sebelum membaca keadaan yang akan diubah, termasuk publikasi jadwal dan perlindungan administrator terakhir. Kesalahan membatalkan seluruh perubahan database. Hasil commit yang belum pasti tidak menyebabkan penghapusan berkas/akun eksternal yang mungkin sudah terhubung.

Database utama berada di schema privat `portal`: 48 tabel dengan RLS dan tanpa grants langsung kepada `anon`, `authenticated`, atau `service_role`. Koneksi database milik Edge Function memakai `SUPABASE_DB_URL` bawaan runtime. Lima view identitas tetap memakai `public.app_users`, role, permission, dan penugasan yang sudah ada sebagai sumber otoritatif. Tidak ada database SQLite lokal yang disalin ke produksi.

Foto dan berkas diunggah ke folder Google Drive privat yang sudah dikonfigurasi. Nama penyimpanan dibuat acak; aplikasi tidak membuat tautan publik. Unduhan memeriksa objek induk/izin, folder dan penanda aplikasi, ukuran, serta SHA-256. Berkas unggahan tanpa tautan tidak bisa diunduh melalui portal. Gangguan jaringan setelah unggahan dapat meninggalkan berkas privat tanpa tautan; jangan menghapus berkas secara massal tanpa rekonsiliasi metadata.

Antrean API pada frontend mencegah request paralel dari tab yang sama berebut lease sesi. Tab/perangkat lain masih dapat menerima konflik sementara. Mutasi tidak dikirim ulang otomatis.

## Modul yang dipindahkan

- Organisasi, pegawai, penempatan, kontrak, lampiran, dan tinjauan impor.
- Dokumen berversi, pelatihan, peserta, materi, sertifikat, coaching, dan tindak lanjut.
- Konfigurasi keamanan, generator deterministik, draf/revisi, validasi, kekurangan, publikasi, dan ekspor jadwal.
- Pengumuman, gambar/lampiran, masa tayang, sematan, arsip, dan tanda baca.
- Patroli, lokasi/foto kamera, kejadian idempoten, penanggung jawab, dan riwayat tindak lanjut.
- Akun Supabase Auth buatan admin, role/izin/scope, perlindungan administrator terakhir, dan audit.
- Pemulihan sekali pakai tanpa kewajiban email pegawai. Token dikonsumsi serta sesi dicabut sebelum perubahan Auth; hasil Auth yang belum pasti memerlukan penerbitan token baru. Password tidak ditulis ke SQL atau audit.

## Penerapan berurutan

1. Pastikan migrasi 001–008 sudah ada. Terapkan `supabase/migrations/20261016000900_operational_modules.sql` melalui koneksi pengelola proyek. Migrasi menyalin calon impor yang masih `PENDING` ke tinjauan operasional tanpa membuat profil aktif. Akun, password, serta enam izin `SUPER_ADMIN` dipertahankan; role SDM/koordinator/petugas/pegawai baru berupa template tanpa penugasan otomatis.
2. Deploy `portal-api` dengan `verify_jwt=false`. Source modular berada di `supabase/functions/portal-api/index.ts`; berkas mandiri untuk dashboard adalah `supabase/deploy/portal-api/index.ts`. Konfigurasi fungsi lain tidak diubah. Fungsi pemulihan bootstrap sementara tidak diterapkan ulang.
3. Push source Pages dan aset `site-info/dist/app/` ke branch `master`. Konfigurasi Cloudflare tetap root `site-info`, build `exit 0`, output `dist`. Variabel Production yang sudah ada tetap digunakan; secret Drive berada di Supabase.
4. Periksa `/api/health`: hanya sukses setelah Cloudflare menghubungi Edge Function dan Edge membaca kesiapan 48 tabel/RLS melalui koneksi PostgreSQL nyata. Periksa juga `/api/auth/me` dan `/api/portal/me` tanpa sesi: keduanya harus menolak dengan HTTP 401. Halaman publik, Search Console, serta halaman privasi/ketentuan tetap tersedia.
5. Masuk sebagai pengelola melalui `/portal/`, lalu **Buka ruang kerja**. Akun `itadmin` tetap memiliki enam izin administrasi. Admin dapat memberi role operasional yang diperlukan secara eksplisit melalui **Akun Pengguna**. Role tersebut menentukan menu dan scope data; deploy tidak memberi akses coaching/berkas pegawai secara otomatis.

## Build dan pemeriksaan lokal

Alat pengembangan terpisah berada di `scripts/cloud-tools/`. Pasang dependensi dari lockfile dengan pnpm, kemudian:

```text
node scripts/build-cloud-deploy.mjs
node --test tests/*.test.mjs
node scripts/verify-cloud-operations.mjs <path-ke-pglite/dist/index.js>
node scripts/verify-cloud-portal-ui.mjs <path-ke-playwright/index.mjs> <path-ke-browser>
node scripts/verify-cloudflare-auth-ui.mjs <path-ke-playwright/index.mjs> <path-ke-browser>
```

Generator mempertahankan aturan domain pada `lib/` sebagai sumber aplikasi lokal, lalu mengangkat panggilan database dan callback berurutan menjadi async untuk PostgreSQL. Output modul dan aset dilacak di Git agar build Pages tetap tanpa pemasangan dependensi. Jangan mengedit output generator secara langsung.

Pemeriksaan PostgreSQL menggunakan PGlite, tabel Auth/sesi fiktif, serta transport HTTP fiktif. Paket Edge yang sama diperiksa untuk pengikatan sesi dan pemulihan sekali pakai. Tes browser memakai profil headless terisolasi dan data fiktif. Hasil lokal tidak membuktikan unggahan Google nyata, perangkat kamera/GPS, beban banyak pengguna, atau alur seluruh akun produksi.

## Operasional

Backup SQLite/Docker hanya berlaku bagi instalasi lokal lama. Untuk layanan ini, cadangkan PostgreSQL menggunakan fasilitas/prosedur Supabase dan simpan cadangan berkas Drive dengan akses organisasi. Pemulihan keduanya harus diuji sebagai satu set; kebijakan retensi dan uji beban tetap ditentukan pengelola.

Pemeriksaan advisor `RLS enabled, no policy` pada schema privat memang sesuai desain: akses langsung ditolak dan operasi hanya lewat backend tepercaya. Jangan membuka grants atau menambah policy `true` agar pesan tersebut hilang.

Referensi: [koneksi PostgreSQL dari Edge Functions](https://supabase.com/docs/guides/functions/connect-to-postgres), [autentikasi fungsi](https://supabase.com/docs/guides/functions/auth), [secret runtime](https://supabase.com/docs/guides/functions/secrets), [unggahan Drive](https://developers.google.com/workspace/drive/api/guides/manage-uploads).
