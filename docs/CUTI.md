# Cuti tahunan di SPH Portal

Menu **Cuti** tersedia di semua ruang kerja setelah login, melalui https://bpbesakih.com/app/#leaves. Saldo awal 2026 mengikuti impor yang sudah disahkan: 152 pegawai aktif non-THL, 781 hari. Dokumen dan snapshot individu tetap privat; aplikasi memakai ID pegawai.

## Formulir pegawai tanpa login

SDM dengan cakupan seluruh organisasi membuka **Cuti → Formulir pegawai → Buat tautan bersama → Salin tautan bersama**. Satu tautan yang sama dapat dibagikan kepada semua pegawai. Pegawai mencari dan memilih nama sendiri, melihat jabatan/unit untuk membedakan nama, memilih hari kerja, mengisi alasan, memeriksa preview, dan mengirim tanpa login. Nama sama diberi tambahan empat karakter terakhir nomor pegawai untuk membantu pemilihan. Saldo serta riwayat pribadi tidak ditampilkan pada tautan bersama. Halaman `/cuti/` tanpa token aktif tidak memberikan daftar nama.

Tautan bersama memakai token acak 256 bit dan berlaku 90 hari. SDM dapat menyalin kembali, mengganti, atau menonaktifkan tautan yang sama. Tabel privat menyimpan token bersama dan SHA-256-nya; pembacaan token lengkap hanya tersedia melalui API privat bagi pengelola `hr.employees.update` dengan scope ALL. Pembuatan/penggantian/pencabutan diaudit tanpa token. Tautan pribadi versi sebelumnya tetap terikat pada satu pegawai dan hanya menyimpan hash; tetap dapat dipakai sampai kedaluwarsa atau dicabut. Pengelola dengan scope terbatas tetap memakai pengelolaan tautan pribadi dalam cakupannya.

Daftar pilihan hanya memuat pegawai aktif dengan status PKWT/Probation dari master; saldo nol tetap ditampilkan karena nol bukan penentu THL. Server memeriksa kembali ID pilihan, status, atasan tunggal, tanggal, dan ketersediaan saldo saat preview/kirim. Pilihan nama pada tautan bersama merupakan pernyataan pemohon, bukan bukti identitas terautentikasi. Tidak ada akses melalui tautan ke riwayat/alasan pribadi, laporan, keputusan, atau pengelolaan tautan. Peringatan benturan hanya menyebut tanggal. Reservasi dan pemotongan memakai alur yang sama dengan portal. Idempotensi tautan bersama dipisahkan menurut tautan, pegawai, dan kunci kiriman; mengulang pengajuan tidak menggandakannya.

Pengajuan ditandai `FORM` dengan `created_by=NULL` dan ID tautan asal, sehingga pemilik tautan tidak dicatat sebagai pengguna portal yang sudah terautentikasi. Atasan wajib memverifikasi identitas pemohon serta tanggal hari kerjanya; server menolak persetujuan tanpa kedua konfirmasi tersebut. Hanya atasan langsung tetap dapat memutuskan. Pengajuan yang telah masuk tidak dibatalkan oleh pencabutan tautan. Perubahan atau pembatalan mengikuti alur akun portal yang sudah ada atau koordinasi dengan atasan; tautan formulir hanya untuk pengajuan.

Jalur publik Cloudflare `/api/leave-form/{context,preview,submit}` memverifikasi origin, tipe/ukuran isi, dan IP ingress, lalu meneruskan permintaan menggunakan kredensial server ke Edge Function `leave-form`. Fungsi memverifikasi kredensial server dan token pegawai, membaca status/atasan terkini, membatasi percobaan (120 konteks, 60 preview, 15 kiriman per IP per 10 menit), serta memakai transaksi dan lock yang sama dengan portal. Tabel tautan dan pembatas percobaan memakai RLS tanpa akses langsung role aplikasi. Kredensial dan token tidak masuk ke audit atau laporan.

Migrasi: `20261030040715_leave_employee_form_links.sql`, kemudian `20261030060840_leave_shared_forms.sql`. Build: `scripts/build-leave-form.mjs`, kemudian `scripts/build-portal-assets.mjs`; perubahan layanan cuti tetap dipaketkan melalui builder gateway terbatas. Pengujian: 240 tes regresi/transport, 23 skenario transaksi PostgreSQL, 9 skenario UI portal, 9 skenario UI formulir bersama, dan 6 skenario UI notifikasi. Seluruh kiriman pengujian memakai database loopback dan data sintetis terpisah.

## Notifikasi persetujuan atasan

Lonceng dan menu Cuti menampilkan jumlah pengajuan serta pembatalan yang menunggu keputusan akun tersebut. Penghitungan hanya mencakup bawahan langsung yang penempatan/atasannya masih berlaku dan tunggal; SDM atau atasan lebih tinggi tidak mendapat antrean keputusan hanya karena dapat membaca laporan.

Ringkasan kecil `/api/leaves/notifications` diperbarui saat navigasi, setelah perubahan, setiap 30 detik ketika halaman terlihat, serta saat kembali ke tab portal. Pengajuan atau permintaan pembatalan baru membuka panel lonceng sekali per permintaan dalam sesi browser. Jika pengguna sedang mengisi formulir/dialog, pemberitahuan singkat tampil tanpa memindahkan fokus. Angka berkurang setelah diputuskan; permintaan lama yang masih menunggu tidak memicu popup baru hanya karena permintaan lain selesai. Klik pemberitahuan membuka **Persetujuan saya** secara langsung. Data ringkasan dihapus saat keluar akun; panel dibatasi dalam layar ponsel.

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
