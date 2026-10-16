# Halaman informasi publik SPH Portal

Folder ini berisi halaman informasi publik, halaman masuk `/portal/`, serta Pages Functions untuk backend akun. Konfigurasi Production sudah disimpan dan deployment ulang berhasil; pemeriksaan tanpa sesi menghasilkan HTTP 401 yang diharapkan. Selain pengujian dengan API fiktif, pengelola sudah mengonfirmasi login nyata, tampilan akun setelah langkah ganti password, sesi setelah muat ulang, logout, serta login ulang memakai password baru. Refresh token dan kedaluwarsa nyata masih perlu diuji. Backend aplikasi utama masih Node.js/SQLite; modul operasional dan unggahan belum dipindahkan ke Supabase.

## Pengaturan Cloudflare Pages dari Git

| Pengaturan | Nilai |
|---|---|
| Repository | `BPFBesakih/SPH-Portal` |
| Production branch | `master` |
| Framework preset | `None` |
| Root directory (advanced) | `site-info` |
| Build command | `exit 0` |
| Build output directory | `dist` |
| Environment variables | Tidak diperlukan untuk halaman informasi |

Berkas `dist/` sudah siap disajikan; tidak ada proses build atau pemasangan dependensi. Alamat produksi adalah `https://sph-portal.pages.dev/`: beranda `/`, halaman masuk `/portal/`, kebijakan privasi `/privacy/`, dan ketentuan penggunaan `/terms/`.

Penerapan publik dilakukan sendiri oleh pengelola melalui dashboard Cloudflare setelah meninjau halaman. Commit/push saja belum menyelesaikan konfigurasi Pages atau penerapan backend.

## Backend akun Cloudflare

`functions/api/auth/[action].js` meneruskan request ke `lib/portal-auth.mjs`. `_routes.json` hanya mengaktifkan Functions pada `/api/auth/*`; halaman `/`, `/privacy/`, `/terms/`, serta bukti Search Console tetap disajikan sebagai aset statis. Source backend berada di luar `dist/`. Tidak ada rahasia dalam source atau bundel aset publik. Push dapat memicu deployment otomatis yang sudah dikonfigurasi pengelola; keberhasilan deployment dan runtime harus diperiksa terpisah.

| Endpoint | Perilaku source |
|---|---|
| `POST /api/auth/login` | Username/password diteruskan hanya ke Edge Function login dengan IP ingress Cloudflare. Auth dan profil diverifikasi kembali sebelum membuat sesi. Respons browser hanya berisi profil aman dan cookie acak. |
| `GET /api/auth/me` | Mengambil sesi privat, memverifikasi Auth, membaca profil/izin terbaru per penugasan/scope, dan melakukan refresh bila perlu. ID Auth, email, ciphertext, serta token tidak dikirim ke browser. |
| `POST /api/auth/logout` | Mencabut sesi portal sebelum signout Auth lokal, lalu menghapus cookie. Kegagalan Auth dilaporkan tanpa menghidupkan sesi portal kembali. |
| `POST /api/auth/password` | Memeriksa CSRF dan pembatasan, mengirim password lama/baru ke Auth, menyelesaikan perubahan aplikasi melalui RPC khusus, lalu signout global dan meminta login ulang. |

Empat route ini belum membuka API administrasi, modul pegawai/keamanan, file, atau Drive. Pengguna dengan `must_change_password = true` hanya mendapat konteks akun dan jalur ganti password/logout; modul operasional belum disediakan. Route operasional berikutnya tetap harus memeriksa flag, status, izin tindakan dan scope objek pada setiap request.

### Konfigurasi runtime

Migrasi Supabase 001–008 sudah dikonfirmasi diterapkan. Pada 16 Oktober 2026, pengelola mengisi keenam variabel berikut pada **Production** dan mengonfirmasi deployment ulang commit `a525cba` berhasil. Key Supabase dan key sesi disimpan sebagai Secret; nilai rahasia tidak dicatat di repo/chat. [Dokumentasi Cloudflare](https://developers.cloudflare.com/pages/functions/bindings/#secrets) menjelaskan secret terenkripsi dan akses runtime melalui `context.env`. Preview tidak diberi rahasia produksi secara otomatis dan origin preview akan ditolak kecuali dikonfigurasi terpisah.

| Nama | Jenis | Nilai/purpose |
|---|---|---|
| `PORTAL_ORIGIN` | Text | `https://sph-portal.pages.dev` |
| `SUPABASE_URL` | Text | `https://mcblosxtuhgxbgyrhfhm.supabase.co` |
| `SUPABASE_SECRET_KEY` | Secret | Key `sb_secret_…` yang mengizinkan pemanggilan backend/Edge Function; isi langsung dari dashboard Supabase. |
| `SUPABASE_PUBLISHABLE_KEY` | Text atau Secret | Key `sb_publishable_…` untuk Auth dan RPC dengan JWT pengguna; tetap konfigurasi backend. |
| `PORTAL_SESSION_KEY` | Secret | Key acak khusus 32 byte, base64url tanpa padding (43 karakter); untuk AES-GCM, tidak ditaruh pada Git/HTML/JavaScript browser. |
| `PORTAL_SESSION_SECONDS` | Text, opsional | Bawaan `28800` (8 jam), bilangan bulat 900–86400. |

Pengelola mengisi key/password langsung di dashboard; jangan meminta nilainya di chat atau screenshot panel request/secret. Jangan membuat atau menyalin nilai contoh sebagai kredensial. File `.env*`, `.dev.vars*`, dan `.wrangler/` diabaikan Git, dengan `.env.example` tetap boleh dilacak. Konfigurasi tidak lengkap atau format tidak valid ditolak HTTP 503 sebelum request Auth; request origin lain ditolak. API hanya menerima HTTPS pada origin yang ditetapkan, JSON maksimal 4 KiB, serta Origin yang cocok pada POST. IP berasal dari `CF-Connecting-IP`, tidak dari JSON atau X-Forwarded-For; source harus dijalankan di belakang ingress Cloudflare.

Cookie `__Host-sph_session` berisi 32 byte acak dan memakai `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, tanpa Domain. Cookie CSRF `__Host-sph_csrf` dapat dibaca frontend dan harus dikirim sebagai `X-CSRF-Token` untuk password/logout; nilainya juga dicocokkan dengan hash pada sesi server. Semua respons API memakai `no-store`. Token Auth hanya berada di memori backend dan envelope AES-GCM pada penyimpanan privat, terikat pada hash cookie, ID pengguna dan ID sesi Auth melalui AAD. Rotasi key membuat envelope lama tidak dapat dipakai dan memerlukan login ulang.

Lease memakai satu retry setelah 60 ms bila sibuk; konflik berlanjut menghasilkan HTTP 409 dengan `Retry-After: 1`. Refresh hanya dicoba satu kali per request dan tidak memperpanjang masa sesi mutlak atau cookie. Setiap request membatasi pekerjaan jaringan utama 40 detik, masing-masing fetch paling lama 10 detik, dengan upaya cleanup singkat. Backend tidak mencatat request, cookie, exception, password, respons upstream, atau token. Frontend harus menampilkan pesan gagal tanpa memasukkan nilai isian rahasia ke URL/log.

### Validasi source

`node --test tests/cloudflare-auth.test.mjs tests/portal-login.test.mjs` lulus 35 uji: 23 uji backend Cloudflare dan 12 uji Edge Function. Enkripsi/dekripsi AES-GCM Web Crypto diuji nyata, termasuk penolakan ciphertext/key/AAD yang berubah; Auth, SDK, dan RPC memakai fixture. Uji mencakup cookie/CSRF, origin, IP tepercaya, profil/izin terkini tanpa menggabungkan scope antarrole, refresh/lease, logout, dan urutan ganti password. Ini belum membuktikan login atau perubahan password nyata melalui Cloudflare/browser. Status penerapan dan pengujian dashboard dicatat terpisah di [panduan Supabase](../supabase/README.md).

Percobaan build lokal dengan CLI resmi Wrangler `4.151.0` belum berhasil karena resolver dependency cache pnpm di host tidak menemukan `undici`, lalu `unenv` setelah lokasi modul dilengkapi. Tidak ada deploy/login atau pembacaan `.env` pada percobaan ini; dependensi aplikasi tidak diubah. Build/deployment Cloudflare sendiri sudah berhasil. Setelah konfigurasi Production dan deployment ulang pada 16 Oktober 2026, `GET https://sph-portal.pages.dev/api/auth/me` tanpa cookie/kredensial menghasilkan HTTP 401, `application/json`, `error: SESSION_ENDED`. Ini menggantikan respons 503 saat konfigurasi belum lengkap. Hasil 401 mengonfirmasi validasi konfigurasi dan jalur tanpa sesi berjalan; belum membuktikan login Auth, penulisan sesi database, refresh, logout, atau perubahan password nyata.

### Antarmuka akun

`dist/portal/index.html`, `assets/portal.js`, dan `assets/portal.css` menyediakan form username/password, alur wajib ganti password, halaman status akun, perubahan password sukarela, serta logout. Tidak ada pendaftaran publik atau formulir reset yang belum berfungsi; bantuan akun diarahkan kepada administrator. Akun dengan flag wajib ganti password tidak mendapat tombol untuk melewati langkah itu. Setelah perubahan berhasil, frontend meminta login baru. Halaman status menjelaskan bahwa modul operasional masih disiapkan.

Frontend hanya memakai `/api/auth/*` pada origin sendiri dan cookie CSRF untuk perubahan/logout. Password dibersihkan dari isian sesudah request disiapkan; tidak disimpan dalam localStorage/sessionStorage atau parameter URL. Pesan ditentukan dari kode error yang dikenal, sementara username ditulis sebagai teks. Pengiriman ulang otomatis untuk login/perubahan password tidak dilakukan. Form menggunakan POST dan tombol awal nonaktif bila JavaScript belum berjalan. Halaman akun memakai `no-store`/`noindex`; CSP mengizinkan script, stylesheet dan koneksi hanya dari origin sendiri, tanpa inline script atau CDN.

`scripts/verify-cloudflare-auth-ui.mjs` menjalankan tujuh kelompok pengujian pada profil browser headless terisolasi, server statis lokal, origin HTTPS yang diintersep, dan API akun fiktif. Uji mencakup jalur tanpa sesi, pengiriman JSON, wajib ganti password, konfirmasi password, CSRF, error/hasil belum pasti, logout parsial, pembatasan percobaan, penolakan HTML dari data akun, serta ketiadaan password dalam storage/URL. Screenshot desktop dan ponsel diperiksa; lebar 320 px tidak meluap. Uji ini tidak mengakses akun produksi atau membuktikan koneksi Auth/database nyata.

```text
node scripts/verify-cloudflare-auth-ui.mjs <path-ke-playwright/index.mjs> <path-browser-chromium>
```

Playwright/browser adalah alat pengujian opsional terpisah, bukan dependensi runtime situs. Screenshot pengujian tersimpan pada `test-results/auth-ui/` yang diabaikan Git.

Sesudah push commit `f5ca37f` pada 16 Oktober 2026, pemeriksaan produksi mengonfirmasi `/portal/` HTTP 200 dengan `Cache-Control: no-store` serta `X-Robots-Tag: noindex, nofollow`. Browser terisolasi tanpa sesi menampilkan form masuk aktif, menerima HTTP 401 dari satu panggilan `/api/auth/me`, dan tidak menghasilkan exception JavaScript. Tampilan desktop/ponsel juga diperiksa pada deployment tersebut. Tidak ada kredensial dimasukkan atau percobaan login produksi dalam pemeriksaan otomatis ini. Konfirmasi pengelola sesudahnya dicatat di bawah.

### Perbaikan koneksi masuk 16 Oktober 2026

Percobaan masuk pengelola kemudian menampilkan kegagalan layanan. Uji akun fiktif yang tidak ada mengonfirmasi HTTP 503, dan label transport aman mengisolasi kegagalan opsi redirect. [Implementasi resmi workerd](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/http.c%2B%2B) menolak `redirect: 'error'` sebelum request jaringan. Backend kini memakai `redirect: 'manual'` dan secara eksplisit menolak seluruh respons 3xx sebelum membaca body, tanpa mengikuti Location atau meneruskan kredensial ke tujuan redirect. Transport backend juga memakai User-Agent tetap dan fetch yang terikat pada konteks global.

Kegagalan login layanan dapat menyertakan `support_code` dari daftar label tahap tetap. Tidak ada pesan exception atau isi respons upstream yang diteruskan. Header `X-SPH-Auth-Revision` memungkinkan pemeriksaan revisi sebelum menguji deployment. Uji regresi mencakup transport dengan receiver, error jaringan/body, label aman, serta redirect 3xx pada login, verifikasi Auth, profil, dan penyimpanan sesi; total 35 uji backend/Edge Function lulus.

Setelah deployment commit `36e6d0b`, revisi `20261016.5` dikonfirmasi aktif. `GET /api/auth/me` tanpa sesi tetap HTTP 401 `SESSION_ENDED`; satu percobaan akun fiktif yang tidak ada menghasilkan HTTP 401 `INVALID_CREDENTIALS`, menggantikan error layanan 503. Browser terisolasi dengan akun fiktif juga menampilkan pesan kredensial yang benar dan membersihkan isian password. Pemeriksaan akun fiktif ini hanya mengonfirmasi jalur Cloudflare ke backend login serta penolakannya; konfirmasi akun nyata oleh pengelola dicatat di bawah. Counter percobaan tidak direset atau dilewati.

### Konfirmasi akun pengelola melalui browser

Pada 16 Oktober 2026, sesudah perbaikan koneksi, pengelola mengonfirmasi layar wajib ganti password. Dalam kelanjutan alur tersebut, screenshot menampilkan **Akun terhubung**, username `itadmin`, dan halaman persiapan modul dengan tombol ganti password sukarela/logout. Frontend hanya menampilkan halaman akun ini ketika ringkasan backend menyatakan `must_change_password = false`. Pengelola kemudian memuat ulang halaman dan mengonfirmasi akun tetap terhubung. Sesudah menekan **Keluar dari akun**, pengelola mengonfirmasi kembali ke form masuk, lalu masuk ulang sebagai `itadmin` memakai password baru dan mengonfirmasi **Akun terhubung** kembali tampil.

Bukti ini mengonfirmasi login nyata, keadaan akun sesudah langkah ganti password, serta penyimpanan/pembacaan sesi browser melalui backend. Nilai password, key, cookie, dan token tetap diisi/dikelola secara privat; tidak diminta atau dicatat dalam repo/chat. Tidak ada pemeriksaan terpisah terhadap isi event audit, pencabutan semua sesi Auth, sesi perangkat lain, kedaluwarsa, atau rotasi refresh token. Muat ulang dalam sesi aktif tidak dengan sendirinya membuktikan refresh token. Logout dan login ulang telah dikonfirmasi pada tingkat perilaku browser; pencabutan sesi server/Auth lama tidak diperiksa secara terpisah. Modul operasional dan administrasi akun masih belum tersedia.

## Batas tahap persiapan

- Berkas `dist/google14e0857c104512e8.html` adalah bukti kepemilikan situs untuk Google Search Console. Pertahankan berkas asli ini di alamat publik yang sama, termasuk setelah verifikasi berhasil.
- Isi halaman menjelaskan status persiapan dan membedakan koneksi Drive yang diuji dari integrasi operasional yang belum selesai.
- Tidak ada klaim bahwa migrasi aplikasi, Auth/RLS produksi, kompresi foto, atau pengiriman foto melalui backend sudah diterapkan.
- Kebijakan retensi dan prosedur penghapusan data operasional belum ditetapkan. Pengelola perlu menentukannya dan memperbarui penjelasan privasi sebelum layanan operasional diluncurkan.
- Kontak mengikuti email dukungan pada Google Auth Platform. Konfirmasi kembali sebelum menerbitkan halaman.
- Jangan memasukkan rahasia backend ke folder `dist/` atau environment variables frontend. Konfigurasi Drive tetap berada di Supabase Edge Function Secrets.
- Verifikasi kepemilikan alamat situs dan kelengkapan Branding Google diselesaikan sesudah alamat Pages tersedia; tersedianya halaman tidak menjamin persetujuan Google.

## Status verifikasi 16 Oktober 2026

Google Search Console sudah mengonfirmasi kepemilikan properti URL-prefix `https://sph-portal.pages.dev/` melalui berkas HTML di atas. Google Auth Platform menampilkan status OAuth **In production**. Verifikasi Branding belum selesai: pesan Google meminta jeda 24 jam setelah verifikasi kepemilikan sebelum mencoba ulang. Status produksi OAuth tidak berarti portal operasional atau Branding sudah disetujui.
