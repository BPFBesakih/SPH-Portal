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

`checks/check-permissions-without-user.sql` memeriksa role `authenticated` tanpa identitas, dengan hasil yang diharapkan `izin_tanpa_identitas = 0`. Pemeriksaan ini sudah disiapkan untuk langkah dashboard berikutnya, belum dikonfirmasi oleh pengelola.

`scripts/verify-supabase-permissions.mjs` lulus 15 kelompok uji pada PostgreSQL terisolasi, mencakup kesesuaian 43 kode katalog, enam izin administrasi eksplisit, RLS lintas akun/role, penolakan perubahan langsung, pencabutan akses, constraints, kegagalan atomik, pengulangan, pemeriksaan dashboard baca saja, dan pelestarian staging. Cara pemanggilannya sama seperti pengujian akun di bawah. Script membaca katalog sumber sebagai teks; tidak mengimpor aplikasi SQLite dan tidak mengakses database nyata. Hasil lokal tidak menggantikan pengujian sesi pengguna nyata di Supabase.

## Uji SQL terisolasi

`scripts/verify-supabase-auth-links.mjs` menjalankan SQL asli pada PostgreSQL dalam memori menggunakan [PGlite](https://pglite.dev/docs/), dengan role dan `auth.uid()` tiruan serta 157 baris staging fiktif. Sepuluh kelompok uji lulus, mencakup baca akun sendiri, penolakan akun lain/nonaktif/anon, penolakan perubahan langsung oleh klien, constraints, penautan identitas terkonfirmasi, konflik, pengulangan, dan pelestarian staging. Tidak ada koneksi ke Supabase atau SQLite asli.

PGlite adalah alat pengujian opsional; bukan dependensi aplikasi produksi. Paket versi `0.5.10` dipasang terpisah di folder sementara saat pengujian. Jalankan:

```text
node scripts/verify-supabase-auth-links.mjs <path-ke-pglite/dist/index.js>
```

Uji ini memvalidasi perilaku SQL/RLS pada PostgreSQL tertanam. Konfigurasi API, autentikasi runtime Supabase, dan login frontend tetap perlu diuji setelah integrasi terkait tersedia.

Rujukan: [data pengguna Supabase Auth](https://supabase.com/docs/guides/auth/managing-user-data), [grants dan RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), serta [pengaturan password](https://supabase.com/docs/guides/auth/password-security).
