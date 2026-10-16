# Halaman informasi publik SPH Portal

Folder ini berisi halaman informasi publik statis dan source Pages Functions untuk backend akun. Route backend sudah terjangkau di Cloudflare, tetapi konfigurasi Auth dan pengujian akun nyata belum selesai; form login frontend belum dibuat. Backend aplikasi utama masih Node.js/SQLite; modul operasional dan unggahan belum dipindahkan ke Supabase.

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

Berkas `dist/` sudah siap disajikan; tidak ada proses build atau pemasangan dependensi. Gunakan alamat yang benar-benar diberikan Cloudflare setelah penerapan berhasil. Alamat beranda adalah `/`, kebijakan privasi `/privacy/`, dan ketentuan penggunaan `/terms/`.

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

### Konfigurasi runtime yang masih diperlukan

Migrasi Supabase 001–007 sudah diterapkan; 008 belum dikonfirmasi. Jangan menguji perubahan password nyata sebelum migrasi 008 serta seluruh konfigurasi runtime tersedia. Atur pada Cloudflare Pages **Settings → Variables and Secrets** untuk **Production**, lalu deploy ulang. [Dokumentasi Cloudflare](https://developers.cloudflare.com/pages/functions/bindings/#secrets) menjelaskan secret terenkripsi dan akses runtime melalui `context.env`. Preview tidak diberi rahasia produksi secara otomatis dan origin preview akan ditolak kecuali dikonfigurasi terpisah.

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

`node --test tests/cloudflare-auth.test.mjs tests/portal-login.test.mjs` lulus 32 uji: 20 uji backend Cloudflare dan 12 uji Edge Function. Enkripsi/dekripsi AES-GCM Web Crypto diuji nyata, termasuk penolakan ciphertext/key/AAD yang berubah; Auth, SDK, dan RPC memakai fixture. Uji mencakup cookie/CSRF, origin, IP tepercaya, profil/izin terkini tanpa menggabungkan scope antarrole, refresh/lease, logout, dan urutan ganti password. Ini belum membuktikan login atau perubahan password nyata melalui Cloudflare/browser. Status penerapan dan pengujian dashboard dicatat terpisah di [panduan Supabase](../supabase/README.md).

Percobaan build lokal dengan CLI resmi Wrangler `4.151.0` belum berhasil karena resolver dependency cache pnpm di host tidak menemukan `undici`, lalu `unenv` setelah lokasi modul dilengkapi. Tidak ada deploy/login atau pembacaan `.env` pada percobaan ini; dependensi aplikasi tidak diubah. Setelah source dipush, pemeriksaan HTTP publik pada 16 Oktober 2026 ke `GET https://sph-portal.pages.dev/api/auth/me` tanpa cookie/kredensial menghasilkan HTTP 503, `application/json`, dengan `error: AUTH_UNAVAILABLE` dan pesan umum layanan belum tersedia. Hasil ini mengonfirmasi route Functions sudah berjalan di Pages setelah deployment otomatis; konfigurasi runtime belum lengkap. Pemeriksaan entry point ini belum menguji Auth, cookie browser, refresh, logout, atau perubahan password nyata.

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
