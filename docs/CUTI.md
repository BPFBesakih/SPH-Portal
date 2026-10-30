# Cuti tahunan di SPH Portal

Menu **Cuti** tersedia di semua ruang kerja setelah login, melalui https://bpbesakih.com/app/#leaves. Saldo awal 2026 mengikuti impor yang sudah disahkan: 152 pegawai aktif non-THL, 781 hari. Dokumen dan snapshot individu tetap privat; aplikasi memakai ID pegawai.

## Formulir pegawai tanpa login

Pengelolaan tersedia melalui role **Kontrol Cuti** untuk akun yang ditetapkan secara privat dan **Super Admin**. Label kelompok izin di editor role juga **Kontrol Cuti**; kode internal `hr.leaves` dipertahankan untuk kompatibilitas. Role ini mencakup Lihat, Ekspor, dan Kelola. Keanggotaan SDM atau Pimpinan Bisnis saja tidak memberi akses pengelolaan cuti. Penetapan akun disimpan dalam tabel privat, dan server menolak pemberian role ini kepada akun di luar penetapan tersebut. Persetujuan operasional tetap mengikuti pejabat yang berwenang, terpisah dari hak pengelolaan.

Pengelola Kontrol Cuti dengan cakupan seluruh organisasi atau Super Admin membuka **Cuti → Formulir pegawai → Buat tautan bersama → Salin tautan bersama**. Satu tautan yang sama dapat dibagikan kepada semua pegawai. Pegawai mencari dan memilih nama sendiri, melihat jabatan/unit untuk membedakan nama, memilih hari kerja, mengisi alasan, memeriksa preview, dan mengirim tanpa login. Nama sama diberi tambahan empat karakter terakhir nomor pegawai untuk membantu pemilihan. Saldo serta riwayat pribadi tidak ditampilkan pada tautan bersama. Halaman `/cuti/` tanpa token aktif tidak memberikan daftar nama.

Tautan bersama memakai token acak 256 bit dan berlaku 90 hari. Pengelola Kontrol Cuti dapat menyalin kembali, mengganti, atau menonaktifkan tautan yang sama. Tabel privat menyimpan token bersama dan SHA-256-nya; pembacaan token lengkap hanya tersedia melalui API privat bagi akun yang ditetapkan dengan izin `hr.leaves.manage` scope ALL. Pembuatan/penggantian/pencabutan diaudit tanpa token. Tautan pribadi versi sebelumnya tetap terikat pada satu pegawai dan hanya menyimpan hash; tetap dapat dipakai sampai kedaluwarsa atau dicabut. Pengelola dengan scope terbatas tetap mengikuti cakupannya.

Daftar pilihan hanya memuat pegawai aktif dengan status PKWT/Probation dari master; saldo nol tetap ditampilkan karena nol bukan penentu THL. Server memeriksa kembali ID pilihan, status, atasan tunggal, tanggal, dan ketersediaan saldo saat preview/kirim. Pilihan nama pada tautan bersama merupakan pernyataan pemohon, bukan bukti identitas terautentikasi. Tidak ada akses melalui tautan ke riwayat/alasan pribadi, laporan, keputusan, atau pengelolaan tautan. Peringatan benturan hanya menyebut tanggal. Reservasi dan pemotongan memakai alur yang sama dengan portal. Idempotensi tautan bersama dipisahkan menurut tautan, pegawai, dan kunci kiriman; mengulang pengajuan tidak menggandakannya.

Pengajuan ditandai `FORM` dengan `created_by=NULL` dan ID tautan asal, sehingga pemilik tautan tidak dicatat sebagai pengguna portal yang sudah terautentikasi. Atasan wajib memverifikasi identitas pemohon serta tanggal hari kerjanya; server menolak persetujuan tanpa kedua konfirmasi tersebut. Persetujuan mengikuti tahap aktif pada jenjang yang ditetapkan. Pengajuan yang telah masuk tidak dibatalkan oleh pencabutan tautan. Perubahan atau pembatalan mengikuti alur akun portal yang sudah ada atau koordinasi dengan atasan; tautan formulir hanya untuk pengajuan.

Jalur publik Cloudflare `/api/leave-form/{context,preview,submit}` memverifikasi origin, tipe/ukuran isi, dan IP ingress, lalu meneruskan permintaan menggunakan kredensial server ke Edge Function `leave-form`. Fungsi memverifikasi kredensial server dan token pegawai, membaca status/atasan terkini, membatasi percobaan (120 konteks, 60 preview, 15 kiriman per IP per 10 menit), serta memakai transaksi dan lock yang sama dengan portal. Tabel tautan dan pembatas percobaan memakai RLS tanpa akses langsung role aplikasi. Kredensial dan token tidak masuk ke audit atau laporan.

Migrasi: `20261030040715_leave_employee_form_links.sql`, kemudian `20261030060840_leave_shared_forms.sql`. Build: `scripts/build-leave-form.mjs`, kemudian `scripts/build-portal-assets.mjs`; perubahan layanan cuti tetap dipaketkan melalui builder gateway terbatas. Pengujian: 241 tes regresi/transport, 30 skenario transaksi PostgreSQL, 10 skenario UI portal, 9 skenario UI formulir bersama, dan 7 skenario UI notifikasi. Migrasi Kontrol Cuti/riwayat tahap: `20261030074231_leave_control_and_approval_stages.sql`. Seluruh kiriman pengujian memakai database loopback dan data sintetis terpisah.

## Notifikasi persetujuan atasan

Lonceng dan menu Cuti menampilkan jumlah pengajuan serta pembatalan yang menunggu keputusan akun tersebut. Penghitungan hanya mencakup permintaan pada tahap yang sedang menjadi kewenangan akun tersebut. Angka dan notifikasi berpindah dari pejabat tahap pertama ke pejabat tahap kedua setelah persetujuan awal. Jenjang yang berubah/tidak tunggal tidak mendapat kewenangan keputusan. Hak pengelolaan atau membaca laporan tidak otomatis memberi kewenangan persetujuan.

Ringkasan kecil `/api/leaves/notifications` diperbarui saat navigasi, setelah perubahan, setiap 30 detik ketika halaman terlihat, serta saat kembali ke tab portal. Pengajuan atau permintaan pembatalan baru membuka panel lonceng sekali per permintaan dalam sesi browser. Jika pengguna sedang mengisi formulir/dialog, pemberitahuan singkat tampil tanpa memindahkan fokus. Angka berkurang setelah diputuskan; permintaan lama yang masih menunggu tidak memicu popup baru hanya karena permintaan lain selesai. Klik pemberitahuan membuka **Persetujuan saya** secara langsung. Data ringkasan dihapus saat keluar akun; panel dibatasi dalam layar ponsel.

## Pengajuan dan persetujuan

1. Pegawai membuka Cuti, memilih **Ajukan cuti**, lalu menentukan rentang tanggal.
2. Pegawai mencentang tanggal yang merupakan hari kerjanya. Sabtu dan Minggu tidak otomatis dianggap libur.
3. Preview menampilkan jumlah hari, atasan langsung, dan peringatan cuti bersamaan dalam satu unit. Peringatan tidak menolak pengajuan.
4. Pengajuan mengunci alokasi saldo per tahun sebagai reservasi. Saldo buku belum dipotong saat menunggu.
5. **Dua jenjang:** atasan langsung, kemudian atasan satu tingkat di atasnya. Pengajuan kepala bidang langsung ke Pimpinan/Kepala Badan. Jalur berhenti bila sudah mencapai Pimpinan. Pejabat tahap kedua baru dapat memutuskan setelah tahap pertama selesai; hak Kontrol Cuti/Super Admin tidak mengambil alih keputusan pejabat.
6. Persetujuan tahap pertama meneruskan pengajuan dan notifikasi ke tahap berikutnya; saldo masih ditahan. Persetujuan terakhir memotong saldo satu kali. Penolakan di tahap mana pun melepaskan reservasi dengan alasan wajib. Riwayat tiap tahap menyimpan pejabat, waktu, catatan, dan verifikasi.

Pengajuan pribadi yang masih menunggu dapat dibatalkan. Untuk cuti yang sudah disetujui namun belum berlangsung, pemohon meminta pembatalan melalui urutan pejabat yang sama. Pengembalian saldo baru terjadi setelah tahap pembatalan terakhir disetujui. Penolakan pembatalan mempertahankan cuti dan pemotongan sebelumnya; pengajuan pembatalan ulang memiliki siklus riwayat terpisah. Pengajuan yang sudah berlangsung tidak dikembalikan otomatis.

Kedua jenjang harus terdaftar secara tunggal dan aktif pada penempatan utama. Nama jabatan digunakan untuk mengenali kepala bidang/Pimpinan; sistem tidak menebak pejabat dari role aplikasi. Jika belum tersedia, aplikasi menampilkan petunjuk agar SDM melengkapi master; sistem tidak menebak pengganti. Jika salah satu jenjang berubah ketika pengajuan menunggu, keputusan diblokir sampai pemohon membatalkan lalu mengajukan ulang sesuai master saat ini. Pengajuan lama yang masih menunggu dan belum memiliki riwayat tahap mengadopsi dua jenjang pada keputusan pertamanya. Pengajuan lama yang telah selesai tidak dibuka atau dipotong ulang.

## Saldo dan pergantian tahun

- THL dan pegawai nonaktif tidak memperoleh alokasi cuti tahunan. Saldo nol bukan penentu status THL.
- Angka awal 2026 tidak ditambah 12 lagi sekarang. Hak berikutnya diberikan 1 Januari 2027.
- Sistem menyimpan saldo per tahun dan memakai saldo yang lebih dulu kedaluwarsa, sepanjang masih berlaku pada tanggal kerja yang dipilih.
- Sisa 2026 berlaku sampai 31 Maret 2027, lalu kedaluwarsa 1 April 2027 pukul 00.00 WITA.
- Pengajuan tahun mendatang hanya dapat memakai saldo yang sudah diberikan dan sah pada tanggal pilihan; aplikasi tidak menciptakan kredit 2027 lebih awal.
- Lock transaksi, versi pengajuan, idempotency key, dan kunci unik ledger mencegah pemotongan atau pengembalian ganda.

## Akses, kalender, dan laporan

Pegawai melihat saldo/permintaan sendiri dan kalender cuti disetujui dalam satu bagian. Atasan melihat bawahannya; keputusan mengikuti jalur persetujuan operasional. Akses pengelolaan, laporan organisasi, ekspor, serta pengelolaan tautan memerlukan penetapan Kontrol Cuti atau Super Admin dan grant yang sesuai. Izin cuti dicabut dari role umum SDM/Pimpinan Bisnis; menambahkan kode izin tersebut ke role lain tidak melewati pemeriksaan penetapan akun di server.

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
