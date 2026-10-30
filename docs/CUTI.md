# Cuti tahunan di SPH Portal

Menu **Cuti** tersedia di semua ruang kerja setelah login, melalui https://bpbesakih.com/app/#leaves. Saldo awal 2026 mengikuti impor yang sudah disahkan: 152 pegawai aktif non-THL, 781 hari. Dokumen dan snapshot individu tetap privat; aplikasi memakai ID pegawai.

## Formulir pegawai tanpa login

SDM membuka **Cuti → Formulir pegawai**, memilih nama (dilengkapi unit dan nomor pegawai untuk membedakan nama yang sama), lalu memilih **Buat / ganti tautan** dan **Salin tautan**. Bagikan tautan hanya kepada pegawai tersebut. Halaman formulir berada di `/cuti/` dan membutuhkan token pribadi di fragmen tautan; tautan umum tanpa token tidak menampilkan daftar pegawai.

Tautan terikat pada satu ID pegawai, berlaku 90 hari, dan bisa dinonaktifkan atau diganti melalui dialog yang sama. Token acak 256 bit hanya ditampilkan ketika dibuat; database menyimpan SHA-256, sehingga tautan lengkap tidak dapat dibaca kembali. Membuat tautan pengganti mematikan tautan lama. SDM hanya dapat mengelola pegawai dalam cakupan izin `hr.employees.update` miliknya. THL, pegawai nonaktif, dan pegawai tanpa atasan tunggal tidak bisa diberi tautan baru.

Pegawai membuka tautan, melihat identitas dan saldo sendiri, memilih tanggal hari kerja, mengisi alasan, memeriksa preview, lalu mengirim ke atasan langsung. Formulir tidak membutuhkan akun portal dan tidak menerima pilihan ID pegawai dari browser. Tidak ada akses melalui tautan ke daftar pegawai, alasan rekan, laporan, keputusan, atau pengelolaan tautan. Peringatan benturan hanya menyebut tanggal. Pengajuan masuk ke daftar persetujuan portal dan mengikuti reservasi serta pemotongan saldo yang sama. Nomor pengajuan ditampilkan setelah berhasil dikirim; mengulang kiriman yang sama tidak menggandakan pengajuan.

Pengajuan ditandai `FORM` dengan `created_by=NULL` dan ID tautan asal, sehingga pemilik tautan tidak dicatat sebagai pengguna portal yang sudah terautentikasi. Atasan wajib memverifikasi identitas pemohon serta tanggal hari kerjanya; server menolak persetujuan tanpa kedua konfirmasi tersebut. Hanya atasan langsung tetap dapat memutuskan. Pengajuan yang telah masuk tidak dibatalkan oleh pencabutan tautan. Perubahan atau pembatalan mengikuti alur akun portal yang sudah ada atau koordinasi dengan atasan; tautan formulir hanya untuk pengajuan.

Jalur publik Cloudflare `/api/leave-form/{context,preview,submit}` memverifikasi origin, tipe/ukuran isi, dan IP ingress, lalu meneruskan permintaan menggunakan kredensial server ke Edge Function `leave-form`. Fungsi memverifikasi kredensial server dan token pegawai, membaca status/atasan terkini, membatasi percobaan (120 konteks, 60 preview, 15 kiriman per IP per 10 menit), serta memakai transaksi dan lock yang sama dengan portal. Tabel tautan dan pembatas percobaan memakai RLS tanpa akses langsung role aplikasi. Kredensial dan token tidak masuk ke audit atau laporan.

Migrasi: `20261030040715_leave_employee_form_links.sql`. Build: `scripts/build-leave-form.mjs`, kemudian `scripts/build-portal-assets.mjs`; perubahan layanan cuti tetap dipaketkan melalui builder gateway terbatas. Pengujian: 239 tes regresi/transport, 18 skenario transaksi PostgreSQL, 9 skenario UI portal, serta 8 skenario UI formulir desktop/ponsel. Seluruh pengujian kiriman menggunakan data sintetis pada database loopback terpisah.

## Pengajuan dan persetujuan

1. Pegawai membuka Cuti, memilih **Ajukan cuti**, lalu menentukan rentang tanggal.
2. Pegawai mencentang tanggal yang merupakan hari kerjanya. Sabtu dan Minggu tidak otomatis dianggap libur.
3. Preview menampilkan jumlah hari, atasan langsung, dan peringatan cuti bersamaan dalam satu unit. Peringatan tidak menolak pengajuan.
4. Pengajuan mengunci alokasi saldo per tahun sebagai reservasi. Saldo buku belum dipotong saat menunggu.
5. **Hanya atasan langsung** yang dapat menyetujui atau menolak. Atasan harus mengonfirmasi verifikasi hari kerja. SDM, pimpinan, dan Superadmin tidak mengambil alih persetujuan bila bukan atasan langsung.
6. Persetujuan memotong saldo satu kali dan mencatat ledger serta audit. Penolakan melepaskan reservasi dengan alasan wajib.

Pengajuan pribadi yang masih menunggu dapat dibatalkan. Untuk cuti yang sudah disetujui namun belum berlangsung, pemohon meminta pembatalan dan atasan langsung memutuskannya. Pengembalian saldo baru terjadi setelah pembatalan disetujui. Pengajuan yang sudah berlangsung tidak dikembalikan otomatis.

Atasan harus terdaftar secara tunggal dan aktif pada penempatan utama. Jika belum tersedia, aplikasi menampilkan petunjuk agar SDM melengkapi master; sistem tidak menebak pengganti. Jika atasan berubah ketika pengajuan masih menunggu, pemohon dapat membatalkan lalu mengajukan ulang kepada atasan saat ini.

## Saldo dan pergantian tahun

- THL dan pegawai nonaktif tidak memperoleh alokasi cuti tahunan. Saldo nol bukan penentu status THL.
- Angka awal 2026 tidak ditambah 12 lagi sekarang. Hak berikutnya diberikan 1 Januari 2027.
- Sistem menyimpan saldo per tahun dan memakai saldo yang lebih dulu kedaluwarsa, sepanjang masih berlaku pada tanggal kerja yang dipilih.
- Sisa 2026 berlaku sampai 31 Maret 2027, lalu kedaluwarsa 1 April 2027 pukul 00.00 WITA.
- Pengajuan tahun mendatang hanya dapat memakai saldo yang sudah diberikan dan sah pada tanggal pilihan; aplikasi tidak menciptakan kredit 2027 lebih awal.
- Lock transaksi, versi pengajuan, idempotency key, dan kunci unik ledger mencegah pemotongan atau pengembalian ganda.

## Akses, kalender, dan laporan

Pegawai melihat saldo/permintaan sendiri dan kalender cuti disetujui dalam satu bagian. Atasan melihat bawahannya; keputusan tetap terbatas pada bawahan langsung. SDM dan pimpinan membaca sesuai grant RBAC. Role SDM, Superadmin, dan Pimpinan Bisnis mendapatkan katalog baca/ekspor Cuti dengan cakupan penugasannya tetap berlaku.

Kalender hanya menampilkan nama, unit, dan tanggal cuti disetujui. Alasan dan catatan keputusan tidak diberikan kepada rekan kerja yang hanya memiliki akses kalender.

Ringkasan memuat statistik saldo tersedia/ditahan, pemakaian bulanan, rekap unit, dan daftar keputusan yang menunggu pengguna. Laporan menyediakan pilihan jenis data, tahun, unit, periode pengajuan, status, serta kolom. Excel dibuat sebagai XLSX; PDF disiapkan melalui tampilan cetak browser dengan pilihan Simpan sebagai PDF. Ekspor diverifikasi cakupannya di server dan dicatat dalam audit.

## Implementasi dan verifikasi

- Migrasi aplikasi: 20261030033354_leave_requests_and_supervisor_approval.sql. Saldo awal dan job pergantian tahun dari migrasi sebelumnya dipertahankan.
- Endpoint privat berada di /api/leaves, melewati gateway sesi/CSRF portal yang sama. Tabel baru memakai RLS tanpa akses langsung role aplikasi.
- Backend dibangun dari snapshot gateway aktif versi 22 melalui scripts/build-leave-deploy.mjs. Perubahannya berupa satu modul dan dispatch Cuti setelah pemeriksaan password; patch Auth, Drive, Pengadaan, Patroli, dan modul produksi lain tetap dipertahankan. Jangan mengganti gateway aktif memakai hasil generator lama tanpa rekonsiliasi.
- Source modular baru tersedia pada supabase/functions/_shared/portal/leaves.mjs. Builder khusus memerlukan snapshot gateway dan SHA-256 yang sudah diverifikasi.
- 234 tes regresi portal, 12 pemeriksaan workflow PostgreSQL, dan 9 pemeriksaan browser desktop/ponsel lulus. Pemeriksaan mencakup atasan tunggal, larangan bypass SDM, reservasi bersamaan, rollback, idempotensi, perubahan atasan, pembatalan/refund, tahun asal, peringatan benturan, privasi kalender, ekspor, dan THL.
- Pengujian transaksi serta data contoh dijalankan pada database loopback terpisah. Tidak ada pengajuan cuti contoh yang dikirim ke produksi.

Ketentuan Cuti Khusus tidak diisi dari asumsi; rilis ini menyediakan alur cuti tahunan yang terhubung ke saldo terverifikasi.
