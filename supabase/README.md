# Backend Supabase SPH-Portal

**Acuan 25 Oktober 2026:** produksi sudah memakai Supabase Auth/PostgreSQL/Edge Functions bersama Cloudflare Pages dan Google Drive privat. Node.js/SQLite adalah jalur lokal. Modul operasional, Pengadaan, Laporan Cepat dan Coaching native sudah mempunyai catatan penerapan. Ringkasan status, batas pengujian, dan perbedaan source lokal/produksi ada di [konteks proyek](../docs/KONTEKS-PROYEK.md).

Bagian berikut adalah **riwayat penyiapan**, bukan konfigurasi yang perlu dijalankan ulang. Catatan awal minimum password 12 karakter, role `itadmin` sebagai Super Admin, 48 tabel dan 157 calon staging telah diikuti perubahan: password minimal enam karakter pada 18 Oktober, pemisahan Superadmin/IT-admin pada 19 Oktober, serta migrasi modul/formulir. Jangan memakai hitungan atau setup awal untuk menimpa keadaan live. Versi fungsi, schema, grants, sumber backend dan konfigurasi dashboard harus dibaca sebelum penerapan berikutnya.

Migrasi operasional `20261016000900_operational_modules.sql` serta Edge Function `portal-api` melanjutkan fondasi akun di dokumen ini. Sebanyak 48 tabel privat dan lima view identitas mendukung seluruh modul, tanpa memberi role baru otomatis kepada akun yang sudah ada. Lihat [panduan produksi lengkap](../docs/CLOUDFLARE-SUPABASE.md). Bagian berikut mempertahankan riwayat verifikasi tahap penyiapan.

Pada tahap awal yang didokumentasikan berikut, aplikasi masih memakai Node.js/SQLite dan komponen Supabase disiapkan bertahap. Status itu sudah digantikan penerapan produksi yang dirangkum di atas.

## Hasil dashboard 16 Oktober 2026

- Staging memuat 157 calon pegawai, semuanya masih menunggu tinjauan. Inventaris SQL pengelola menunjukkan hanya `import_staging.employee_candidates` pada skema `public`/`import_staging`, dengan RLS aktif, sebelum migrasi akun di bawah dijalankan.
- [Fungsi pemeriksaan koneksi Drive](functions/README.md) sudah diterapkan dan pengelola mengonfirmasi ketiga pemeriksaan berhasil. Fungsi belum mengunggah foto.
- Authentication: pendaftaran mandiri dimatikan; anonymous sign-ins dan manual linking sudah terlihat mati. Email provider dan secure email change terlihat aktif. Minimum password diubah ke 12 karakter dan **Require current password when updating** diaktifkan, masing-masing telah dikonfirmasi tersimpan oleh pengelola. **Secure password change** tetap pada nilai awal mati agar belum menambahkan alur nonce/email yang belum diintegrasikan.
- Akun Auth pengelola `bpfbesakih@gmail.com` sudah dibuat melalui dashboard dengan **Auto confirm user**. Password ditetapkan oleh pengelola dan tidak dimasukkan ke source atau chat. Akun Auth ini belum otomatis mendapat hak administrator aplikasi.
- Reset password `itadmin` melalui fungsi pemulihan sementara sudah berhasil, lalu probe `portal-login` mengonfirmasi login password, konteks akun, dan signout sesi uji berhasil. Ringkasan akun memuat `must_change_password = true`, satu role, dan enam izin. Pengelola sudah mengonfirmasi deployment `portal-recover-itadmin` dihapus; source tetap disimpan. Frontend dan backend sesi portal sudah terhubung; pengelola mengonfirmasi login nyata, tampilan akun setelah langkah ganti password, sesi setelah muat ulang, logout ke form masuk, serta login ulang memakai password baru.
- Migrasi sesi web sudah diterapkan: screenshot mengonfirmasi lima fungsi hanya dapat dipanggil backend, serta tabel `web_sessions` dengan RLS aktif dan tanpa hak baca langsung bagi `anon`, `authenticated`, atau `service_role`. Ini konfigurasi skema/grants, belum pengujian cookie atau sesi browser nyata.
- Migrasi penyelesaian ganti password sudah diterapkan: screenshot mengonfirmasi `portal_complete_password_change` dengan akses `anon/authenticated/backend = false/false/true`, serta `password_change_events` dengan RLS aktif dan akses langsung ketiganya `false`. Penerapan migrasi ini hanya menyiapkan skema/grants dan tidak mengubah password. Konfirmasi alur browser pengelola sesudahnya tercatat pada panduan Cloudflare; isi audit database belum diperiksa terpisah.

## Tabel penghubung akun

Jalankan `migrations/20261016000200_app_user_links.sql` melalui SQL Editor setelah inventaris database diperiksa. Migrasi ini hanya menambahkan `public.app_users`, mengaktifkan RLS, serta menetapkan grants dan policy baca akun sendiri yang berstatus `ACTIVE`. Tidak ada password, salinan email Auth, atau role aplikasi pada tabel ini. Pengguna biasa tidak mendapat izin membuat, mengubah, atau menghapus baris; `service_role` baru diberi izin baca untuk kebutuhan backend berikutnya.

Sesudah hasil migrasi diperiksa, jalankan `setup/link-itadmin.sql` sebagai langkah terpisah. Script mencari tepat satu akun Auth terkonfirmasi dengan email pengelola, lalu menautkannya ke username `itadmin`. Normalisasi huruf kecil mengikuti aplikasi saat ini, yang menormalkan `ITAdmin` menjadi `itadmin`. Penautan tidak memasang role. Script menolak konflik identitas, tidak menimpa profil lain, dan saat diulang tidak mengaktifkan ulang akun atau menghapus kewajiban ganti password.

FK akun memakai `ON DELETE RESTRICT` agar penghapusan identitas Auth tidak diam-diam menghapus catatan akun aplikasi. Penonaktifan akun menggunakan status akun; prosedur penghapusan perlu ditetapkan terpisah. Penambahan pegawai, role, izin dan cakupan unit/pos dilakukan lewat migrasi berikutnya, sesuai PRD. Jangan memberikan izin dari `user_metadata` atau dari nama username.

Pengelola sudah menjalankan kedua SQL akun melalui dashboard pada 16 Oktober 2026. Hasil migrasi menampilkan `public | app_users | true`; hasil penautan menampilkan `itadmin | ACTIVE | true` untuk kolom `username`, `status`, dan `must_change_password`. Ini mengonfirmasi tabel dan penautan awal; penolakan akses lintas akun baru diuji pada PostgreSQL terisolasi, belum melalui sesi Auth nyata di aplikasi.

Penugasan role administrator dan enam izin administrasi sudah tersimpan melalui langkah di bawah; integrasi otorisasi operasional masih perlu dibuat. Flag `must_change_password` sudah tersimpan; backend dan form ganti password sudah dibuat, migrasi penyelesaiannya sudah diterapkan, dan konfigurasi Cloudflare Production sudah diisi. Sesudah langkah ganti password, screenshot pengelola menunjukkan halaman akun tanpa kewajiban ganti password; muat ulang juga tetap menampilkan akun terhubung. Pemeriksaan audit database dan pencabutan sesi lintas perangkat belum dilakukan. Persyaratan PRD tetap username + password, akun dibuat administrator, dan pemulihan tidak bergantung pada email/WhatsApp. Email akun pengelola pada Auth tidak mengubah persyaratan login pegawai tersebut. Simpan sumber SQL yang sama untuk pelacakan migrasi saat beralih dari dashboard ke CLI.

## Dasar role

`migrations/20261016000300_app_role_foundation.sql` menambah `app_roles` dan `app_user_roles`, mengaktifkan RLS, lalu membuat definisi `SUPER_ADMIN` tanpa penugasan otomatis. Klien hanya dapat membaca penugasan miliknya sendiri ketika akunnya aktif, serta definisi role aktif yang ditugaskan kepadanya. Policy penugasan membaca `app_users`, dan policy definisi role membaca penugasan; tidak ada ketergantungan balik yang menyebabkan rekursi RLS. Role nonaktif tidak ikut terbaca pada join role efektif.

Semua hak tulis untuk `anon`, `authenticated`, dan `service_role` dicabut pada kedua tabel. Setelah hasil migrasi diperiksa, `setup/grant-itadmin-super-admin.sql` dapat dijalankan terpisah untuk menugaskan `SUPER_ADMIN` dengan scope `ALL` hanya kepada akun aktif yang terhubung ke identitas Auth pengelola terkonfirmasi. Pengulangan tidak menimpa status akun, kewajiban ganti password, definisi role, atau menggandakan penugasan.

Pengelola mengonfirmasi kedua langkah berhasil melalui dashboard pada 16 Oktober 2026. Hasil migrasi menampilkan `app_roles` dan `app_user_roles` dengan RLS aktif; hasil penugasan menampilkan akun `itadmin`, role `SUPER_ADMIN`, scope `ALL`, status `ACTIVE`, serta `role_aktif = true`. Pemeriksaan autentikasi dan policy dengan sesi pengguna nyata masih perlu dilakukan setelah integrasi login tersedia.

Tabel permission dan relasi role-permission sudah dipasang pada tahap berikutnya. Pemeriksaan cakupan unit/pos, audit administrasi, dan perlindungan administrator terakhir belum dipasang pada backend baru. Seluruh jalur perubahan role dari aplikasi masih ditutup; jangan membuka endpoint pengelolaan sebelum pemeriksaan izin, audit, dan perlindungan administrator terakhir tersedia. Tidak ada akses otomatis ke coaching atau berkas pegawai dari username atau kode role ini. Frontend/Edge Function operasional belum memakai data role ini.

`scripts/verify-supabase-role-foundation.mjs` menguji SQL dasar role dan penugasan pada PostgreSQL dalam memori. Dua belas kelompok uji lulus, termasuk RLS lintas akun, penolakan perubahan langsung, konflik identitas, pengulangan, serta pelestarian staging. Cara pemanggilannya sama seperti pengujian akun di bawah.

## Katalog izin tindakan

`migrations/20261016000400_app_permissions.sql` menambah `app_permissions` dan `app_role_permissions` dengan RLS serta hak baca yang terbatas. Katalog mengikuti 43 kode pada `resourceActions` aplikasi saat ini. Membuat katalog tidak memberikan izin kepada role. Pengguna hanya dapat membaca kode izin dan relasi dari role aktif yang sudah ditugaskan kepadanya, melalui rangkaian policy yang juga memeriksa akun aktif. Pengguna tanpa penugasan tidak menerima izin dari username, kode role, atau user metadata.

Sesudah hasil migrasi diperiksa, `setup/grant-super-admin-permissions.sql` memasang tepat enam izin: `admin.users.read`, `admin.users.manage`, `admin.users.reset`, `admin.roles.read`, `admin.roles.manage`, dan `admin.audit.read`. Script mensyaratkan identitas Auth pengelola terkonfirmasi, akun `itadmin` aktif, serta penugasan sistem `SUPER_ADMIN` aktif dengan scope `ALL`. Izin HR, keamanan, coaching, dan berkas pegawai tidak diberikan oleh script ini. Kode izin baru yang ditambahkan ke katalog juga tidak otomatis diberikan kepada role.

Semua hak tulis pada kedua tabel dicabut dari `anon`, `authenticated`, dan `service_role`; perubahan masih dilakukan melalui SQL pengelola. Kode izin dan scope adalah data untuk otorisasi, bukan pengganti policy operasional atau pemeriksaan server. API/layar administrasi belum dibuka oleh langkah ini. Perlindungan administrator terakhir, audit, izin operasional per objek/unit/pos, alur login username, dan ganti password pertama masih perlu diintegrasikan sebelum endpoint terkait dibuka.

Screenshot dashboard pada 16 Oktober 2026 mengonfirmasi enam kode administrasi tersebut terbaca ketika SQL Editor menetapkan identitas `itadmin` dan `SET LOCAL ROLE authenticated`. Query hanya membaca data dalam transaksi yang diakhiri `ROLLBACK`; salinannya tersedia di `checks/check-itadmin-permissions.sql`. Ini mengonfirmasi hasil policy pada database Supabase melalui simulasi identitas SQL, belum login atau validasi JWT aplikasi. Screenshot ini tidak memuat inventaris semua tabel/RLS atau jumlah katalog keseluruhan.

Pengelola juga menjalankan pemeriksaan role `authenticated` tanpa identitas melalui SQL Editor pada 16 Oktober 2026. Screenshot mengonfirmasi `izin_tanpa_identitas = 0` setelah kedua pengaturan klaim dikosongkan. Salinan query tersedia di `checks/check-permissions-without-user.sql`; transaksi hanya membaca data dan diakhiri `ROLLBACK`. Kedua pemeriksaan dashboard ini belum menguji pengiriman atau validasi JWT melalui API.

`scripts/verify-supabase-permissions.mjs` lulus 15 kelompok uji pada PostgreSQL terisolasi, mencakup kesesuaian 43 kode katalog, enam izin administrasi eksplisit, RLS lintas akun/role, penolakan perubahan langsung, pencabutan akses, constraints, kegagalan atomik, pengulangan, pemeriksaan dashboard baca saja, dan pelestarian staging. Cara pemanggilannya sama seperti pengujian akun di bawah. Script membaca katalog sumber sebagai teks; tidak mengimpor aplikasi SQLite dan tidak mengakses database nyata. Hasil lokal tidak menggantikan pengujian sesi pengguna nyata di Supabase.

## Fungsi pendukung akun

`migrations/20261016000500_account_access_functions.sql` menyiapkan dua fungsi baca untuk integrasi akun:

- `portal_resolve_login(p_username text)` hanya dapat dipanggil `service_role`. Fungsi menormalkan username seperti aplikasi saat ini, memeriksa akun aktif dan identitas Auth terkonfirmasi dengan email terisi, lalu mengembalikan ID Auth dan email login kepada backend. Akun yang tidak cocok menghasilkan nol baris. Fungsi tidak membaca hash, memverifikasi password, atau membuat sesi. Pencarian ini memakai `SECURITY DEFINER` dengan search path kosong dan nama tabel berskema; hak panggil `PUBLIC`, `anon`, dan `authenticated` dicabut, termasuk grant langsung yang mungkin sudah ada. Hasil pencarian tidak boleh diteruskan kepada klien sebagai layanan pencarian akun.
- `portal_current_account()` hanya dapat dipanggil `authenticated`, memakai `SECURITY INVOKER`, RLS, dan ID dari `auth.uid()` tanpa menerima ID target. Hasil memuat profil akun aktif pemanggil, flag wajib ganti password, serta izin yang tetap dikelompokkan pada masing-masing penugasan role dan scope. Role nonaktif dikeluarkan. Akun tidak aktif/tidak tertaut atau tanpa identitas mendapat `null`; akun aktif tanpa role mendapat daftar penugasan kosong. Email, hash password, token, dan user metadata tidak dimasukkan ke hasil.

Pemisahan ini mempertahankan username pada antarmuka pengguna. [Password Auth Supabase](https://supabase.com/docs/guides/auth/passwords) memverifikasi kredensial menggunakan email atau nomor telepon; backend berikutnya dapat memakai hasil pencarian internal untuk menghubungkan username dengan Auth. Pegawai tidak perlu memakai alamat email sebagai username. Prosedur pembuatan identitas bagi pegawai yang tidak memiliki email tetap perlu diimplementasikan bersama pengelolaan akun.

Migrasi tidak mengubah data akun, role, izin, atau 157 calon pegawai, serta tidak membuka jalur tulis. Pengelola mengonfirmasi penerapan melalui screenshot dashboard pada 16 Oktober 2026: kolom `security_definer`, `anon_boleh`, `authenticated_boleh`, dan `backend_boleh` untuk `portal_current_account` bernilai `false, false, true, false`; untuk `portal_resolve_login` bernilai `true, false, false, true`.

Screenshot berikutnya mengonfirmasi pembacaan profil melalui `portal_current_account()` dalam simulasi identitas SQL menghasilkan `itadmin | true | 6` untuk username, kewajiban ganti password, dan jumlah izin penugasan pertama. Salinan query tersedia di `checks/check-current-account.sql`. Ini memeriksa hasil RPC di database, belum login dengan password atau validasi JWT melalui API. Flag password tetap `true`.

`scripts/verify-supabase-account-access.mjs` lulus 12 kelompok uji PostgreSQL terisolasi: hak panggil, normalisasi username, penolakan akun tidak layak, penolakan pencarian identitas dari klien, profil sendiri tanpa informasi kredensial, metadata palsu, pemisahan scope beberapa role, pencabutan akses, pembacaan flag password, ketahanan terhadap search path pemanggil, pengulangan, dan pelestarian staging. Pengujian tidak membuat sesi Auth atau mengakses data nyata. Cara pemanggilan sama seperti script SQL lainnya di bawah.

Fungsi ini adalah pendukung integrasi akun. Probe backend login di bawah sudah mengonfirmasi Auth nyata dan pembacaan profil sendiri melalui API. Pengelolaan sesi web dan perubahan password pertama masih perlu dibuat. Perubahan password harus diverifikasi sebelum flag dibersihkan, dan setiap endpoint operasional harus memeriksa status akun, kewajiban ganti password, izin, dan scope pada permintaan terkait. Jangan menggunakan hasil profil sebagai pengganti verifikasi JWT atau pemeriksaan objek/unit/pos pada permintaan berikutnya.

## Pembatasan login

`migrations/20261016000600_login_rate_limit.sql` membuat counter privat dan fungsi `portal_take_login_slot(text, text)`. Hanya `service_role` dapat memanggilnya. Klien dan `service_role` tidak memperoleh akses langsung ke skema/tabel counter; RLS aktif tanpa policy klien. Backend menghitung hash SHA-256 dari username yang sudah dinormalisasi dan IP dari proxy tepercaya, lalu mengambil slot sebelum mencari identitas atau memanggil Auth. Browser tidak boleh menentukan hash atau alamat IP yang dipercaya backend.

Pengelola menjalankan migrasi melalui dashboard pada 16 Oktober 2026. Screenshot mengonfirmasi fungsi `portal_take_login_slot` dengan `security_definer = true`, `anon_boleh = false`, `authenticated_boleh = false`, dan `backend_boleh = true`. Hasil ini memeriksa konfigurasi hak panggil; perilaku batas percobaan dan jendela waktu baru diuji pada PostgreSQL lokal, belum melalui endpoint login nyata.

Batas awal berupa jendela 15 menit: **5 percobaan per username** dan **300 percobaan per IP**, termasuk percobaan yang berhasil. Batas IP mengakomodasi banyak pegawai pada jaringan kantor yang sama. Mengganti IP tidak melewati batas username; permintaan yang sudah dibatasi pada IP tidak membuat counter username baru. Update counter memakai UPSERT bersyarat, dengan urutan kunci IP lalu username. Pengulangan migrasi tidak mereset counter. Ini pembatasan frekuensi, tidak mengubah status akun menjadi `LOCKED` atau membersihkan flag wajib ganti password.

Counter menyimpan jenis bucket, hash, jumlah percobaan, dan waktu mulai jendela; tidak menyimpan username/IP mentah, password, atau token. Jendela kedaluwarsa dipakai ulang saat bucket itu menerima permintaan berikutnya; migrasi ini tidak mengatur pekerjaan pembersihan berkala.

`scripts/verify-supabase-login-rate-limit.mjs` lulus 9 kelompok uji PostgreSQL dalam memori, termasuk grants, batas username/IP, banyak akun pada IP yang sama, pergantian IP, jendela kedaluwarsa, rollback, constraints, dan pengulangan. Uji ini memakai panggilan berurutan, bukan uji beban beberapa koneksi PostgreSQL. SQL memakai [perilaku atomik UPSERT PostgreSQL](https://www.postgresql.org/docs/current/sql-insert.html#SQL-ON-CONFLICT); pengujian beban runtime masih perlu dilakukan setelah backend diterapkan.

## Backend login

[`functions/portal-login/index.ts`](functions/portal-login/index.ts) adalah fungsi POST khusus antarserver dengan SDK `auth: "secret"`. Setelah migrasi pembatasan diterapkan, fungsi dapat disiapkan melalui editor Edge Functions sebagai `portal-login`, dengan pemeriksaan JWT legacy dimatikan dan key secret pada header `apikey`, sama seperti pola diagnostik Drive. Jangan menghubungkan key secret ini ke JavaScript browser.

Pada 16 Oktober 2026, pengelola mengonfirmasi **Verify JWT with legacy secret = OFF** sudah tersimpan untuk `portal-login`. Pengujian dashboard memakai POST, **Add secret key**, dan mode `probe`; password baru diisi langsung oleh pengelola. Screenshot respons mengonfirmasi hasil Auth nyata berikut, tanpa password, key, token, ID Auth, atau email:

```json
{
  "ok": true,
  "checks": {
    "password_sign_in": true,
    "account_context": true,
    "temporary_session_signout": true
  },
  "account": {
    "username": "itadmin",
    "must_change_password": true,
    "role_count": 1,
    "permission_count": 6
  }
}
```

Hasil ini mengonfirmasi satu jalur probe berhasil. Login frontend, sesi web, pembaruan password pertama, akses lintas akun, pencabutan sesi, dan uji beban runtime belum dikonfirmasi melalui aplikasi. Tidak ada password atau token Auth nyata dimasukkan ke source/pengujian lokal.

Fungsi membaca URL serta dictionary API key bawaan Supabase, dengan fallback key legacy. Urutannya: validasi body maksimum 4 KiB, ambil slot login, cari identitas internal, verifikasi password melalui Auth, lalu baca profil menggunakan JWT pengguna dan RPC yang mengikuti RLS. Username tidak dikenal tetap melewati password Auth dengan identitas cadangan yang tidak diberikan kepada klien. Username tidak dikenal dan password salah menghasilkan pesan umum yang sama; kegagalan layanan ditolak. Hasil profil dibatasi ke field yang diperlukan dan izin tetap dikelompokkan per penugasan/scope. Kode fungsi tidak mencatat password, token, exception, atau respons mentah layanan.

Mode bawaan `probe` memeriksa kredensial dan profil, lalu meminta signout `scope=local` untuk sesi uji yang baru dibuat. Respons sukses hanya memuat hasil pemeriksaan dan ringkasan akun, tanpa token, ID Auth, atau email. Kegagalan signout menghasilkan kegagalan pemeriksaan. Signout lokal tidak mengakhiri sesi pengguna pada perangkat lain; ini juga bukan bukti bahwa JWT lama langsung tidak berlaku pada semua API. Lihat [perilaku sesi Supabase](https://supabase.com/docs/guides/auth/sessions#how-to-ensure-an-access-token-jwt-cannot-be-used-after-a-user-signs-out).

Mode eksplisit `login` memerlukan IP dari backend tepercaya dan mengembalikan pasangan token hanya kepada backend yang memegang key secret; mode ini tidak digunakan untuk uji dashboard. [Backend Cloudflare](../site-info/README.md#backend-akun-cloudflare) menghubungkan mode ini ke form `/portal/` dan menjaga token, sesi portal, logout, refresh, CSRF, serta perubahan password. Keenam variabel Production sudah diisi dan deployment ulang berhasil pada 16 Oktober 2026; `GET /api/auth/me` tanpa sesi menghasilkan HTTP 401 `SESSION_ENDED`. Tujuh kelompok uji browser memakai API fiktif. Pengelola kemudian mengonfirmasi login nyata, tampilan akun setelah langkah ganti password, sesi setelah muat ulang, logout ke form masuk, serta login ulang memakai password baru; lihat catatan bukti pada panduan Cloudflare. Edge Function ini sendiri tidak membuka API administrasi atau modul HR/keamanan, dan tidak menghapus flag wajib ganti password.

`node --test tests/portal-login.test.mjs` lulus 12 pengujian dengan HTTP/env tiruan: jalur probe/login, pembatasan request, rate-limit, kegagalan kredensial umum, pengikatan identitas ke profil, scope, penutupan sesi uji, error layanan, dan perlindungan nilai privat dalam respons. Pengujian menjalankan sumber TypeScript yang sama dengan deployment; batas SDK distub. Konfirmasi key SDK dan Auth nyata berasal dari probe dashboard di atas, terpisah dari hasil lokal.

## Fondasi sesi web

`migrations/20261016000700_web_sessions.sql` menyiapkan penyimpanan sesi untuk backend Cloudflare. Pengelola sudah menjalankannya melalui SQL Editor pada 16 Oktober 2026. Screenshot mengonfirmasi enam baris: tabel `web_sessions` dengan RLS aktif dan ketiga kolom akses `false`, serta lima fungsi dengan akses `anon = false`, `authenticated = false`, dan `backend = true`. Hasil dashboard ini mengonfirmasi skema/grants. Login dan muat ulang halaman akun oleh pengelola kemudian mengonfirmasi pembuatan serta pembacaan sesi melalui aplikasi; logout dan login ulang juga dikonfirmasi melalui browser. Refresh token serta pencabutan sesi lama secara terpisah masih perlu diuji.

Tabel `portal_auth_private.web_sessions` tidak mendapat policy atau grant API, termasuk bagi `service_role` yang dapat melewati RLS. Backend hanya dapat mengelola sesi melalui lima RPC `SECURITY DEFINER` dengan search path kosong:

| Fungsi | Kegunaan |
|---|---|
| `portal_create_web_session` | Mendaftarkan hash cookie acak dan hash CSRF, terikat pada akun aktif serta baris `auth.sessions` milik pengguna yang sama. Umur mutlak bawaan 8 jam, dapat ditentukan backend antara 15 menit dan 24 jam. Konflik tidak menimpa sesi. |
| `portal_acquire_web_session` | Mengambil lease 60 detik dan data sesi untuk satu request backend; pesaing hanya mendapat status `busy`. Sesi dicabut, kedaluwarsa, akun tidak aktif/versi berubah, atau baris Auth hilang menghasilkan `null`. |
| `portal_save_web_session` | Mengganti envelope token setelah refresh memakai lease dan versi yang cocok. Penulis lama tidak dapat menimpa hasil request berikutnya; umur mutlak sesi portal tidak diperpanjang. |
| `portal_release_web_session` | Melepas lease milik request itu sendiri ketika tidak perlu mengganti token. |
| `portal_revoke_web_session` | Mencabut sesi portal dan menghapus ciphertext, termasuk saat sesi kedaluwarsa atau masih dipegang request lain. Signout Auth tetap harus dilakukan backend secara terpisah. |

Trigger pada perubahan `status`, `must_change_password`, atau `row_version` akun mencabut semua sesi portal akun tersebut secara atomik dan menghapus ciphertext. Mengaktifkan kembali akun tidak menghidupkan sesi lama. Nilai yang tidak berubah tidak mencabut sesi. Migrasi tidak mengubah flag password, role/izin, staging, counter login, atau baris Auth yang sudah ada. Tidak ada endpoint administrasi atau pembacaan audit yang dibuka.

Source `site-info/lib/portal-auth.mjs` menyiapkan verifikasi identitas/sesi Auth, cookie sesi acak `Secure`/`HttpOnly`/`SameSite=Strict`, pemeriksaan CSRF/origin, serta AES-GCM dengan key khusus pada secret runtime dan additional authenticated data yang mengikat ciphertext ke hash cookie, akun, dan sesi Auth. Konfigurasi Cloudflare Production sudah diisi; pengujian sesi nyata belum selesai. SQL hanya memeriksa format envelope `v1.<nonce base64url>.<ciphertext dan tag base64url>` dan panjangnya; SQL tidak membuktikan enkripsi atau memverifikasi JWT. Cookie mentah, token CSRF mentah, key enkripsi, password, dan token Auth mentah tidak disimpan dalam tabel.

Setiap request backend memakai hash cookie sesi dan hash lease dari nilai acak baru khusus request itu. Source mencoba ulang satu kali saat `busy`, lalu mengembalikan HTTP 409 dengan `Retry-After: 1`; setiap request memverifikasi Auth dan membaca profil/izin terkini per penugasan/scope. Refresh disimpan sebelum lease dilepas, kemudian sesi diambil kembali sebelum melanjutkan. Masa sesi portal tidak diperpanjang. [Supabase mendokumentasikan](https://supabase.com/docs/guides/auth/sessions#how-to-ensure-an-access-token-jwt-cannot-be-used-after-a-user-signs-out) pemeriksaan keberadaan `session_id` pada `auth.sessions` untuk mendeteksi signout; keberadaan baris saja tidak menggantikan pemeriksaan JWT, batas sesi Auth, atau otorisasi objek. Uji dengan Auth tiruan sudah dilakukan; login serta pembacaan sesi nyata setelah muat ulang dikonfirmasi pengelola pada runtime Cloudflare. Logout dan login ulang memakai password baru telah dikonfirmasi melalui browser. Refresh token dan pencabutan sesi Auth lama secara terpisah belum diuji. Belum ada pekerjaan pembersihan sesi terjadwal atau audit login/logout aplikasi.

`scripts/verify-supabase-web-sessions.mjs` lulus 15 kelompok uji PostgreSQL terisolasi: RLS/grants meskipun default permisif, penolakan RPC oleh role klien, pengikatan identitas, input/envelope/waktu, masa sesi, lease dan versi, timeout, pencabutan Auth, logout portal, perubahan keamanan akun, rollback, penerapan ulang, serta pelestarian data migrasi sebelumnya dan 157 staging fiktif. Envelope pada uji adalah fixture berbentuk ciphertext, bukan bukti enkripsi AES-GCM; lease diuji dengan panggilan SQL berurutan, bukan uji beban beberapa koneksi. Cara menjalankannya sama seperti uji SQL lain di bawah; tidak mengakses Supabase atau SQLite nyata.

Rujukan integrasi berikutnya: [Pages Functions routing](https://developers.cloudflare.com/pages/functions/routing/) dan [binding/secret runtime](https://developers.cloudflare.com/pages/functions/bindings/).

## Penyelesaian ganti password

`migrations/20261016000800_password_change_completion.sql` menambah timestamp `password_changed_at` yang awalnya `null`, tabel privat `password_change_events` dengan RLS tanpa grant API, dan RPC `portal_complete_password_change(text,text,bigint)` hanya untuk `service_role`. Pengelola sudah menjalankannya melalui SQL Editor pada 16 Oktober 2026. Screenshot mengonfirmasi dua baris: satu fungsi dengan akses `false/false/true` serta satu tabel RLS aktif dengan akses `false/false/false` untuk `anon/authenticated/backend`. Penerapan ini menyiapkan skema/fungsi; belum memanggil penyelesaian atau mengganti password akun melalui aplikasi.

RPC tidak menerima password atau ID target; akun ditentukan dari sesi portal yang sedang di-lease. Fungsi mengunci akun lalu sesi, memeriksa status, versi, masa berlaku, lease, serta keberadaan sesi Auth. Setelah pemeriksaan lolos, fungsi membersihkan flag, mencatat waktu, menaikkan versi akun, dan menulis event tanpa kredensial. Trigger migrasi 007 mencabut seluruh sesi portal akun tersebut dan menghapus ciphertext. Semua perubahan ini berada dalam transaksi yang sama; kegagalan pencatatan event membatalkan perubahan profil maupun pencabutan sesi. Akun lain tidak berubah dan event tidak dapat dibaca lewat API.

SQL tidak memverifikasi password dan tidak dapat membuktikan keberhasilan HTTP Auth. Pemanggil tepercaya wajib lebih dahulu berhasil menjalankan `PUT /auth/v1/user` dengan JWT pengguna, `password` baru, dan `current_password`, serta mencocokkan ID respons dengan identitas sesi. [Sumber resmi Supabase Auth](https://github.com/supabase/auth/blob/master/internal/api/user.go) menerima `current_password`; pengaturan **Require current password when updating** harus tetap ON sesuai hasil dashboard sebelumnya. Backend memanggil penyelesaian hanya sesudah langkah itu berhasil, lalu signout Auth global dan meminta login baru. Penolakan password tidak membersihkan flag. Kegagalan jaringan setelah pengiriman perubahan atau kegagalan penyelesaian ditampilkan sebagai hasil yang belum dapat dikonfirmasi; backend mencoba mencabut sesi dan meminta login kembali. Tidak ada upaya menulis hash Auth lewat SQL atau Admin API pada alur ini.

Endpoint ganti password juga mengambil slot pembatasan yang sama dengan login, sehingga percobaan ganti password ikut dihitung dalam batas username/IP 15 menit. Audit tabel ini hanya mencatat ganti password sendiri; pengelolaan akun/reset pegawai, audit administrasi lengkap, dan perlindungan administrator terakhir tetap belum tersedia.

`scripts/verify-supabase-password-completion.mjs` lulus 10 kelompok uji PostgreSQL terisolasi: grants/RLS, input dan versi, lease/sesi kedaluwarsa, penolakan sesi Auth yang hilang, pengikatan akun, pencabutan seluruh sesi akun, pengulangan/perubahan berikutnya, perubahan status/versi, rollback, kegagalan audit, penerapan ulang, dan pelestarian 157 staging fiktif. Auth menggunakan tabel fixture; tidak ada password Auth nyata yang diubah. Sebanyak 23 uji `tests/cloudflare-auth.test.mjs` menguji batas HTTP dan enkripsi Web Crypto nyata dengan respons Auth/RPC tiruan. Tidak ada klaim pengujian browser atau runtime produksi dari hasil lokal ini.

## Pemulihan akun pengelola saat penyiapan

`functions/portal-recover-itadmin/index.ts` adalah alat pemulihan sementara untuk operator proyek, memakai SDK `auth: "secret"`. Fungsi mencari akun `itadmin` melalui resolver backend, mencocokkan identitas Auth terkonfirmasi dengan email pengelola, dan memeriksa penugasan sistem `SUPER_ADMIN` aktif dengan scope `ALL`. ID target tidak diambil dari request. Setelah pemeriksaan itu lolos, satu-satunya perubahan yang dikirim adalah password melalui [Auth Admin API](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid); tidak memerlukan password lama atau pengiriman email dan tidak menulis hash Auth dengan SQL. UID, penautan aplikasi, role, status, dan flag wajib ganti password tidak diubah oleh kode pemulihan.

Pada 16 Oktober 2026, fungsi `portal-recover-itadmin` sudah diterapkan dan **Verify JWT with legacy secret = OFF** dikonfirmasi tersimpan. Pengelola menjalankan POST dengan **Add secret key**, serta `new_password` 12–128 karakter yang dipilih dan diisi langsung pada dashboard. Respons HTTP 200 `{"ok":true,"username":"itadmin","password_reset":true}` mengonfirmasi reset nyata berhasil. Nilai password/key tidak dimasukkan ke source atau chat. Probe login dengan password baru juga berhasil seperti dicatat di atas; reset tidak perlu diulang.

Pengelola mengonfirmasi deployment `portal-recover-itadmin` sudah dihapus pada 16 Oktober 2026 setelah probe berhasil. Source tetap disimpan untuk pelacakan; tidak perlu menerapkan atau menjalankan ulang fungsi pemulihan. Deployment `portal-login` dan `drive-connection-check` tetap diperlukan.

Tujuh pengujian `tests/portal-recover-itadmin.test.mjs` lulus dengan HTTP/env tiruan, mencakup pengikatan target, role/scope, penolakan input, error layanan, dan tidak keluarnya nilai privat dalam respons. SDK autentikasi distub; konfirmasi deployment dan reset nyata berasal dari dashboard, terpisah dari hasil lokal. Ini pemulihan bootstrap oleh operator pemegang secret proyek, belum implementasi alur reset pegawai dengan kredensial sekali pakai pada aplikasi.

## Uji SQL terisolasi

`scripts/verify-supabase-auth-links.mjs` menjalankan SQL asli pada PostgreSQL dalam memori menggunakan [PGlite](https://pglite.dev/docs/), dengan role dan `auth.uid()` tiruan serta 157 baris staging fiktif. Sepuluh kelompok uji lulus, mencakup baca akun sendiri, penolakan akun lain/nonaktif/anon, penolakan perubahan langsung oleh klien, constraints, penautan identitas terkonfirmasi, konflik, pengulangan, dan pelestarian staging. Tidak ada koneksi ke Supabase atau SQLite asli.

PGlite adalah alat pengujian opsional; bukan dependensi aplikasi produksi. Paket versi `0.5.10` dipasang terpisah di folder sementara saat pengujian. Jalankan:

```text
node scripts/verify-supabase-auth-links.mjs <path-ke-pglite/dist/index.js>
```

Uji ini memvalidasi perilaku SQL/RLS pada PostgreSQL tertanam. Konfigurasi API, autentikasi runtime Supabase, dan login frontend tetap perlu diuji setelah integrasi terkait tersedia.

Rujukan: [data pengguna Supabase Auth](https://supabase.com/docs/guides/auth/managing-user-data), [grants dan RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [keamanan fungsi database](https://supabase.com/docs/guides/database/functions#secure-a-database-function), serta [pengaturan password](https://supabase.com/docs/guides/auth/password-security).
