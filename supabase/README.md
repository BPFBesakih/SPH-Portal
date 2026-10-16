# Persiapan backend Supabase

Backend aplikasi utama masih Node.js/SQLite. Berkas di sini menyiapkan komponen Supabase secara bertahap; keberhasilan satu komponen tidak menyelesaikan migrasi aplikasi.

## Hasil dashboard 16 Oktober 2026

- Staging memuat 157 calon pegawai, semuanya masih menunggu tinjauan. Inventaris SQL pengelola menunjukkan hanya `import_staging.employee_candidates` pada skema `public`/`import_staging`, dengan RLS aktif, sebelum migrasi akun di bawah dijalankan.
- [Fungsi pemeriksaan koneksi Drive](functions/README.md) sudah diterapkan dan pengelola mengonfirmasi ketiga pemeriksaan berhasil. Fungsi belum mengunggah foto.
- Authentication: pendaftaran mandiri dimatikan; anonymous sign-ins dan manual linking sudah terlihat mati. Email provider dan secure email change terlihat aktif. Minimum password diubah ke 12 karakter dan **Require current password when updating** diaktifkan, masing-masing telah dikonfirmasi tersimpan oleh pengelola. **Secure password change** tetap pada nilai awal mati agar belum menambahkan alur nonce/email yang belum diintegrasikan.
- Akun Auth pengelola `bpfbesakih@gmail.com` sudah dibuat melalui dashboard dengan **Auto confirm user**. Password ditetapkan oleh pengelola dan tidak dimasukkan ke source atau chat. Akun Auth ini belum otomatis mendapat hak administrator aplikasi.

## Tabel penghubung akun

Jalankan `migrations/20261016000200_app_user_links.sql` melalui SQL Editor setelah inventaris database diperiksa. Migrasi ini hanya menambahkan `public.app_users`, mengaktifkan RLS, serta menetapkan grants dan policy baca akun sendiri yang berstatus `ACTIVE`. Tidak ada password, salinan email Auth, atau role aplikasi pada tabel ini. Pengguna biasa tidak mendapat izin membuat, mengubah, atau menghapus baris; `service_role` baru diberi izin baca untuk kebutuhan backend berikutnya.

Sesudah hasil migrasi diperiksa, jalankan `setup/link-itadmin.sql` sebagai langkah terpisah. Script mencari tepat satu akun Auth terkonfirmasi dengan email pengelola, lalu menautkannya ke username `itadmin`. Normalisasi huruf kecil mengikuti aplikasi saat ini, yang menormalkan `ITAdmin` menjadi `itadmin`. Penautan tidak memasang role. Script menolak konflik identitas, tidak menimpa profil lain, dan saat diulang tidak mengaktifkan ulang akun atau menghapus kewajiban ganti password.

FK akun memakai `ON DELETE RESTRICT` agar penghapusan identitas Auth tidak diam-diam menghapus catatan akun aplikasi. Penonaktifan akun menggunakan status akun; prosedur penghapusan perlu ditetapkan terpisah. Penambahan pegawai, role, izin dan cakupan unit/pos dilakukan lewat migrasi berikutnya, sesuai PRD. Jangan memberikan izin dari `user_metadata` atau dari nama username.

Pengelola sudah menjalankan kedua SQL akun melalui dashboard pada 16 Oktober 2026. Hasil migrasi menampilkan `public | app_users | true`; hasil penautan menampilkan `itadmin | ACTIVE | true` untuk kolom `username`, `status`, dan `must_change_password`. Ini mengonfirmasi tabel dan penautan awal; penolakan akses lintas akun baru diuji pada PostgreSQL terisolasi, belum melalui sesi Auth nyata di aplikasi.

Penugasan role administrator dan enam izin administrasi sudah tersimpan melalui langkah di bawah; integrasi otorisasi operasional masih perlu dibuat. Flag `must_change_password` sudah tersimpan, tetapi alur ganti password pertama pada frontend/backend Supabase belum dibuat. Persyaratan PRD tetap username + password, akun dibuat administrator, dan pemulihan tidak bergantung pada email/WhatsApp. Email akun pengelola pada Auth tidak mengubah persyaratan login pegawai tersebut. Simpan sumber SQL yang sama untuk pelacakan migrasi saat beralih dari dashboard ke CLI.

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

Fungsi ini adalah pendukung integrasi akun. Backend login di bawah sudah disiapkan tetapi belum diterapkan atau diuji dengan Auth nyata. Pengelolaan sesi web dan perubahan password pertama masih perlu dibuat. Perubahan password harus diverifikasi sebelum flag dibersihkan, dan setiap endpoint operasional harus memeriksa status akun, kewajiban ganti password, izin, dan scope pada permintaan terkait. Jangan menggunakan hasil profil sebagai bukti bahwa JWT sudah diverifikasi atau sebagai pengganti pemeriksaan objek/unit/pos.

## Pembatasan login

`migrations/20261016000600_login_rate_limit.sql` membuat counter privat dan fungsi `portal_take_login_slot(text, text)`. Hanya `service_role` dapat memanggilnya. Klien dan `service_role` tidak memperoleh akses langsung ke skema/tabel counter; RLS aktif tanpa policy klien. Backend menghitung hash SHA-256 dari username yang sudah dinormalisasi dan IP dari proxy tepercaya, lalu mengambil slot sebelum mencari identitas atau memanggil Auth. Browser tidak boleh menentukan hash atau alamat IP yang dipercaya backend.

Pengelola menjalankan migrasi melalui dashboard pada 16 Oktober 2026. Screenshot mengonfirmasi fungsi `portal_take_login_slot` dengan `security_definer = true`, `anon_boleh = false`, `authenticated_boleh = false`, dan `backend_boleh = true`. Hasil ini memeriksa konfigurasi hak panggil; perilaku batas percobaan dan jendela waktu baru diuji pada PostgreSQL lokal, belum melalui endpoint login nyata.

Batas awal berupa jendela 15 menit: **5 percobaan per username** dan **300 percobaan per IP**, termasuk percobaan yang berhasil. Batas IP mengakomodasi banyak pegawai pada jaringan kantor yang sama. Mengganti IP tidak melewati batas username; permintaan yang sudah dibatasi pada IP tidak membuat counter username baru. Update counter memakai UPSERT bersyarat, dengan urutan kunci IP lalu username. Pengulangan migrasi tidak mereset counter. Ini pembatasan frekuensi, tidak mengubah status akun menjadi `LOCKED` atau membersihkan flag wajib ganti password.

Counter menyimpan jenis bucket, hash, jumlah percobaan, dan waktu mulai jendela; tidak menyimpan username/IP mentah, password, atau token. Jendela kedaluwarsa dipakai ulang saat bucket itu menerima permintaan berikutnya; migrasi ini tidak mengatur pekerjaan pembersihan berkala.

`scripts/verify-supabase-login-rate-limit.mjs` lulus 9 kelompok uji PostgreSQL dalam memori, termasuk grants, batas username/IP, banyak akun pada IP yang sama, pergantian IP, jendela kedaluwarsa, rollback, constraints, dan pengulangan. Uji ini memakai panggilan berurutan, bukan uji beban beberapa koneksi PostgreSQL. SQL memakai [perilaku atomik UPSERT PostgreSQL](https://www.postgresql.org/docs/current/sql-insert.html#SQL-ON-CONFLICT); pengujian beban runtime masih perlu dilakukan setelah backend diterapkan.

## Backend login (disiapkan, belum diterapkan)

[`functions/portal-login/index.ts`](functions/portal-login/index.ts) adalah fungsi POST khusus antarserver dengan SDK `auth: "secret"`. Setelah migrasi pembatasan diterapkan, fungsi dapat disiapkan melalui editor Edge Functions sebagai `portal-login`, dengan pemeriksaan JWT legacy dimatikan dan key secret pada header `apikey`, sama seperti pola diagnostik Drive. Jangan menghubungkan key secret ini ke JavaScript browser.

Fungsi membaca URL serta dictionary API key bawaan Supabase, dengan fallback key legacy. Urutannya: validasi body maksimum 4 KiB, ambil slot login, cari identitas internal, verifikasi password melalui Auth, lalu baca profil menggunakan JWT pengguna dan RPC yang mengikuti RLS. Username tidak dikenal tetap melewati password Auth dengan identitas cadangan yang tidak diberikan kepada klien. Username tidak dikenal dan password salah menghasilkan pesan umum yang sama; kegagalan layanan ditolak. Hasil profil dibatasi ke field yang diperlukan dan izin tetap dikelompokkan per penugasan/scope. Kode fungsi tidak mencatat password, token, exception, atau respons mentah layanan.

Mode bawaan `probe` memeriksa kredensial dan profil, lalu meminta signout `scope=local` untuk sesi uji yang baru dibuat. Respons sukses hanya memuat hasil pemeriksaan dan ringkasan akun, tanpa token, ID Auth, atau email. Kegagalan signout menghasilkan kegagalan pemeriksaan. Signout lokal tidak mengakhiri sesi pengguna pada perangkat lain; ini juga bukan bukti bahwa JWT lama langsung tidak berlaku pada semua API. Lihat [perilaku sesi Supabase](https://supabase.com/docs/guides/auth/sessions#how-to-ensure-an-access-token-jwt-cannot-be-used-after-a-user-signs-out).

Mode eksplisit `login` memerlukan IP dari backend tepercaya dan mengembalikan pasangan token hanya kepada backend yang memegang key secret. Mode ini belum terhubung ke frontend dan tidak digunakan untuk uji dashboard. Backend web berikutnya harus menjaga token dari browser, memverifikasi status sesi pada permintaan, menerapkan kedaluwarsa sesi portal, logout, refresh, CSRF, serta alur wajib ganti password. Fungsi ini tidak membuka API administrasi atau modul HR/keamanan, dan tidak menghapus flag wajib ganti password.

`node --test tests/portal-login.test.mjs` lulus 12 pengujian dengan HTTP/env tiruan: jalur probe/login, pembatasan request, rate-limit, kegagalan kredensial umum, pengikatan identitas ke profil, scope, penutupan sesi uji, error layanan, dan perlindungan nilai privat dalam respons. Pengujian menjalankan sumber TypeScript yang sama dengan deployment; batas SDK distub, sehingga pemeriksaan key SDK dan Auth nyata belum dikonfirmasi.

## Uji SQL terisolasi

`scripts/verify-supabase-auth-links.mjs` menjalankan SQL asli pada PostgreSQL dalam memori menggunakan [PGlite](https://pglite.dev/docs/), dengan role dan `auth.uid()` tiruan serta 157 baris staging fiktif. Sepuluh kelompok uji lulus, mencakup baca akun sendiri, penolakan akun lain/nonaktif/anon, penolakan perubahan langsung oleh klien, constraints, penautan identitas terkonfirmasi, konflik, pengulangan, dan pelestarian staging. Tidak ada koneksi ke Supabase atau SQLite asli.

PGlite adalah alat pengujian opsional; bukan dependensi aplikasi produksi. Paket versi `0.5.10` dipasang terpisah di folder sementara saat pengujian. Jalankan:

```text
node scripts/verify-supabase-auth-links.mjs <path-ke-pglite/dist/index.js>
```

Uji ini memvalidasi perilaku SQL/RLS pada PostgreSQL tertanam. Konfigurasi API, autentikasi runtime Supabase, dan login frontend tetap perlu diuji setelah integrasi terkait tersedia.

Rujukan: [data pengguna Supabase Auth](https://supabase.com/docs/guides/auth/managing-user-data), [grants dan RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [keamanan fungsi database](https://supabase.com/docs/guides/database/functions#secure-a-database-function), serta [pengaturan password](https://supabase.com/docs/guides/auth/password-security).
