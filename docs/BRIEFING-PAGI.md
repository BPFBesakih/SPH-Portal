# Briefing Pagi (Wewarah Semeng)

Status 26 Oktober 2026 (WITA): **tersedia pada cabang `codex/briefing-pagi`, belum diterapkan ke produksi**. Form Apps Script yang diberikan SDM dipakai sebagai acuan isian; layanan lama dan data historisnya tetap tersedia.

## Perilaku

- Menu **Briefing Pagi** berada di navigasi bersama, sehingga tersedia dari ruang kerja SDM, Keamanan, dan Pengadaan.
- Pegawai dapat membuka **Isi briefing pagi**, lalu mengikuti tautan formulir native `/briefing-pagi/#<token>`. Akun portal atau Google tidak diperlukan pada halaman formulir, mengikuti pola coaching native.
- Isian: tanggal WITA; pencarian nama pemberi briefing; bidang/unit dan jabatan dari penempatan resmi pada tanggal yang dipilih; bagian/urusan; pegawai tidak hadir (isi Nihil jika seluruhnya hadir); materi wewarah dan kendala; satu foto dari kamera.
- Pilihan bidang menggunakan organisasi portal terkini. Form lama memisahkan Keamanan/Infralink dan memakai nama bidang lama yang berbeda dengan organisasi portal; label lama tersebut tidak dipakai untuk menentukan izin.
- Form tidak menerima foto dari galeri. Pengambilan dilakukan melalui kamera browser; foto JPEG/PNG maksimal 10 MB dan umur pengambilan maksimal 30 menit pada pengiriman pertama. Nama dan informasi foto adalah isian pengirim, bukan autentikasi identitas atau verifikasi absensi.
- Rekap memiliki filter rentang tanggal, bidang/unit dalam akses, pencarian nama/urusan/materi, dan halaman berisi 20 catatan. Detail memuat pegawai tidak hadir, materi, dan foto privat.
- SDM dapat mengoreksi catatan, mengarsipkan, serta memulihkan kiriman dengan alasan dan pemeriksaan versi. Identitas/unit/jabatan asal tetap berupa snapshot. Arsip tidak menghapus rekaman atau foto.

## Akses

Keputusan pengguna: **pegawai hanya melihat rekap bidang/urusannya**. Akun aktif dengan satu penempatan utama aktif dapat membaca rekap pada `org_unit_id` yang sama dengan penempatannya saat ini, tanpa harus memperoleh role SDM. Pemeriksaan berlaku di API daftar, detail, serta unduhan foto. Akun tanpa profil/penempatan aktif atau dengan penempatan utama ganda tidak mendapat akses otomatis ke rekap.

Saat ini organisasi portal menyimpan unit pada tingkat bidang/Sekretariat/SPI. Kolom **bagian/urusan** berupa teks untuk mencatat kelompok pelaksana; teks tersebut tidak menjadi sumber otorisasi. Pemisahan akses lebih rinci antarurusan memerlukan unit resmi dan penempatan pegawai pada tingkat urusan terlebih dahulu. Nama bidang pada formulir tidak dapat diganti pengisi untuk mengarahkan laporan ke bidang lain.

Izin baru `hr.briefings.read` dan `hr.briefings.manage` dapat memberi akses tambahan sesuai grant dan scope yang sudah berlaku. Migrasi memberikan keduanya kepada role SDM dan Superadmin. IT-admin tidak mendapat akses operasional seluruh unit secara otomatis. Pengelola dengan scope `ALL` dapat mengaktifkan, mengganti, atau menonaktifkan tautan global. Pegawai terhubung dapat mengambil tautan aktif untuk membuka/membagikan formulir melalui kanal internal.

## Implementasi

- Domain: `lib/briefings.mjs`; aturan baca/foto: `lib/auth.mjs`, `lib/files.mjs`.
- Tabel privat: `briefing_links`, `morning_briefings`, `briefing_files`. RLS aktif; hak langsung PUBLIC/anon/authenticated/service_role dicabut. Perubahan dicatat dalam audit privat.
- Token acak 32 byte berada pada fragmen URL, divalidasi melalui SHA-256, dan salinannya disimpan privat agar tautan aktif dapat diambil kembali. Token tidak disimpan di aset, log, ataupun penyimpanan browser.
- Endpoint bertoken hanya menyediakan `context` dan `submit`. Proxy Cloudflare `/api/briefing-link/*` memeriksa origin, IP ingress, tipe dan ukuran body, lalu memanggil Edge `briefing-native` menggunakan secret server yang sudah dipakai coaching.
- Edge memakai kunci server, transaksi PostgreSQL, pembatasan percobaan yang terpisah dari coaching, validasi pegawai/penempatan/tanggal/foto, dan kunci idempotensi. Kirim ulang payload yang sama mengembalikan tanda terima yang sama. Pencabutan tautan menutup context dan pengiriman baru.
- Foto produksi masuk ke folder Drive privat **SPH-Portal-Briefing**. Kegagalan transaksi membersihkan unggahan baru; folder dan berkas lama tidak diberi akses publik.
- Routing `/api/briefings` dan otorisasi file ditambahkan pada portal API serta server lokal. Frontend memakai komponen dan gaya native portal/coaching.

## Verifikasi lokal

Hasil verifikasi salinan bersih di atas master `3f05611`, 26 Oktober 2026:

- `node --test tests/*.test.mjs`: **212/212 lulus**, termasuk 10 tes briefing (scope pegawai/SDM, foto, validasi, audit, arsip, rotasi tautan, limiter, proxy Cloudflare, dan HTTP tanpa sesi).
- `node scripts/verify-briefings-postgres.mjs`: **8/8 pemeriksaan lulus**, dengan PGlite dan Drive fixture. Memeriksa migrasi/RLS/grant, bundle native, routing portal yang dihasilkan, idempotensi, rollback PostgreSQL/Drive, akses foto, arsip/pemulihan, dan pencabutan tautan.
- Verifikasi operasi PostgreSQL yang sudah ada: **24/24 lulus**. Pemeriksaan enam izin admin dipisahkan dari dua izin briefing baru, sehingga penambahan fitur tidak dianggap mengubah izin administratif.
- Build aset Cloudflare frontend dan bundle `briefing-native` berhasil; pemeriksaan sintaks serta `git diff --check` lulus.
- Browser: form terbuka tanpa sesi, pencarian nama mengisi bidang/jabatan, rekap SDM terbuka, detail/foto tampil, dan koreksi dengan alasan tersimpan pada fixture. Screenshot berada di `test-results/briefings/`.
- Kamera pada HP nyata, izin kamera perangkat, dan smoke test produksi belum diuji pada sesi ini.

PGlite untuk verifier baru memakai `scripts/briefing-tools/node_modules/@electric-sql/pglite` versi `0.3.14` (dependensi fixture lokal, tidak dikirim ke browser). Pasang fixture dengan `npm install --prefix scripts/briefing-tools --no-save --no-package-lock @electric-sql/pglite@0.3.14`. Lokasi lain dapat diberikan sebagai argumen pertama verifier. Preview terisolasi: `node scripts/preview-briefings.mjs`, URL `http://127.0.0.1:4614/#briefings`; akun fiktif `sdm.preview` / `pegawai.preview`, password `Preview2026!`. Preview memakai database memori dan tidak membuka `data/portal.sqlite`.

## Rilis berikutnya

1. Cocokkan source backend portal produksi dengan riwayat patch aktif; gunakan catatan `KONTEKS-PROYEK.md`. **Jangan deploy keseluruhan workspace atau mengganti `portal-api` dengan bundle lokal lama.** Bundle `supabase/deploy/portal-api/index.ts` belum dibangun ulang untuk briefing pada pekerjaan ini.
2. Siapkan perubahan portal API yang mencakup route briefing, katalog izin, dan adapter/otorisasi foto di atas baseline produksi yang sudah diverifikasi. Jalankan kembali verifikasi transaksi serta akses lintas unit pada kandidat bundle itu.
3. Terapkan migrasi aditif `20261026004937_morning_briefings.sql`, deploy kandidat `portal-api` yang telah dicocokkan, lalu deploy `briefing-native` dengan secret server yang sudah ada. Source/bundle native disiapkan melalui `node scripts/generate-cloud-modules.mjs` dan `node scripts/build-native-briefing.mjs`.
4. Rilis frontend terarah: menu/halaman rekap dan modulnya; callback opsional employee picker; form `/briefing-pagi/`; Functions proxy; route exclusion, redirect, serta header no-store/noindex/no-referrer. Aset frontend pada cabang ini dibangun dari salinan master bersih dengan perubahan briefing saja; pekerjaan website/editor dan perubahan lokal lain tidak disertakan.
5. SDM mengaktifkan tautan melalui menu, lalu uji dengan akun dua bidang, satu SDM, dan HP berkamera. Uji pencabutan tautan serta akses foto lintas bidang.

Kode cabang dipisahkan dari workspace utama yang masih berada pada commit lama dan memuat banyak perubahan belum dipush. Hasil 235 tes dan 36 pemeriksaan PostgreSQL pada workspace utama tetap merupakan catatan verifikasi sebelumnya; hasil cabang yang akan dipush adalah angka 212/8/24 di atas. Tidak ada migrasi riwayat Apps Script/Sheets atau penonaktifan layanan Google dalam cakupan implementasi ini.
