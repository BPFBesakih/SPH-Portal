# Konteks lengkap proyek SPH-Portal

**Diperbarui: 25 Oktober 2026 (UTC+8).** Dokumen ini merangkum produk, keputusan, arsitektur, rilis, kondisi operasional, pekerjaan lokal, dan tindak lanjut dalam satu berkas yang dapat dibaca tanpa percakapan sebelumnya. Ini ringkasan konteks terverifikasi, bukan salinan seluruh percakapan atau jaminan semua alur produksi sudah diuji.

## 1. Ringkasan terkini

SPH-Portal adalah aplikasi internal **Badan Pengelola Fasilitas Kawasan Suci Pura Agung Besakih**, untuk SDM, Keamanan, Pengadaan, informasi internal, serta administrasi akun. Antarmuka memakai Bahasa Indonesia, pendekatan Material Design 3, palet Tridatu (marun, putih, hitam, aksen emas), tampilan responsif dan tema gelap. Waktu operasional aplikasi adalah **Asia/Makassar (WITA, UTC+8)**.

| Bagian | Status yang tercatat |
|---|---|
| Produksi | Aktif pada [bpbesakih.com](https://bpbesakih.com/), ruang kerja di [/app/](https://bpbesakih.com/app/), akun di [/portal/](https://bpbesakih.com/portal/). |
| Infrastruktur | Cloudflare Pages/Functions, Supabase Auth/PostgreSQL/Edge Functions di jalur Singapura, dan Google Drive privat. |
| PWA | Kode sudah dipush pada 23 Oktober; manifest dan service worker produksi terkonfirmasi tersedia pada 25 Oktober. Data operasional tetap memerlukan internet. |
| Keamanan domain | HSTS 30 hari, SPF/DMARC untuk domain yang belum mengirim email, DNSSEC, penonaktifan RUM, dan penghapusan origin lama diterapkan pada 24 Oktober. HTTP/DNS publik diperiksa ulang pada 25 Oktober. |
| Formulir bersama | Laporan Cepat Keamanan dan Coaching native telah diterbitkan; akses pengiriman memerlukan tautan bertoken. |
| Website publik Besakih yang lebih lengkap | Implementasi/editor konten masih pekerjaan lokal; belum ada bukti rilisnya ke produksi. Berbeda dari halaman informasi publik yang sudah aktif. |
| Repo | [BPFBesakih/SPH-Portal](https://github.com/BPFBesakih/SPH-Portal), publik, cabang utama `master`. |
| Baseline kode rilis | `e30ef6ee03f115a87d24db03f3f1eae7e221810f` — PWA, 23 Oktober 2026. Ini baseline sebelum pembaruan dokumentasi 25 Oktober, bukan klaim bahwa HEAD selamanya tetap pada commit tersebut. |
| Folder kerja utama | Masih di `3a988e3f68437892d00c96391903c3db7a5944fc` saat inventarisasi; tertinggal 15 commit dari baseline rilis dan memuat banyak perubahan lokal. Jangan menyamakan keadaan ini dengan produksi. |

## 2. Cara membaca status dan sumber

Ada tiga keadaan yang harus dibedakan: **kode di GitHub**, **layanan yang benar-benar diterapkan**, dan **perubahan lokal**. Sejumlah patch Edge Function/configuration pernah diterapkan langsung dari source produksi, sementara perubahan sumbernya masih berada di folder kerja. Karena itu, checkout bersih dari GitHub belum boleh diasumsikan mereproduksi seluruh konfigurasi dan source backend aktif.

Urutan acuan: pemeriksaan langsung yang bertanggal, bukti deployment/commit, catatan perubahan khusus, lalu PRD/ERD awal. Dokumen ini menggantikan keterangan status lama yang bertentangan, tetapi tidak menghapus bukti historis. Angka pegawai, tabel, role, versi Edge, dan hasil tes lama selalu merupakan snapshot pada tanggalnya.

Sumber penyusunan meliputi dokumentasi proyek, riwayat Git lokal dan GitHub, percakapan lanjutan yang dapat dibaca, serta bukti lokal di `test-results/`. Beberapa percakapan lama terlalu besar untuk dibaca melalui alat riwayat; detailnya dirangkum dari dokumentasi dan artefak proyek. Kredensial, cookie, token tautan aktif, isi coaching, dan data pegawai per orang tidak dimasukkan ke dokumen ini.

## 3. Produk dan batas cakupan

### Akun, izin, dan administrasi

- Login memakai username dan password; akun dibuat administrator. Tidak ada pendaftaran publik, kewajiban email pegawai, maupun reset yang bergantung pada WhatsApp/email.
- Password awal wajib diganti. Tersedia pembatasan percobaan login, logout, pemulihan sekali pakai, pencabutan sesi dan audit. Perubahan 18 Oktober menerima password akun/pengganti minimal enam karakter; catatan konfigurasi awal dua belas karakter bersifat historis.
- Izin ditentukan per tindakan dan cakupan: diri sendiri, unit, pos yang sudah didukung, atau seluruh organisasi. Scope tetap melekat pada grant masing-masing; jabatan organisasi tidak otomatis menjadi role aplikasi.
- Keputusan 19 Oktober: `SUPER_ADMIN` memiliki akses penuh seluruh modul dengan scope `ALL`, termasuk izin baru. `IT_ADMIN` mengelola administrasi teknis dengan enam izin akun/role/audit; akses operasional perlu penugasan terpisah.
- IT-admin tidak boleh menaikkan kewenangan sendiri, memberikan role Superadmin, atau mengubah/memulihkan akun Superadmin. Minimal satu Superadmin aktif dipertahankan.
- Aturan awal PRD bahwa Super Admin hanya administratif dan pengecualian berdasarkan username `itadmin` telah digantikan keputusan tipe administrator tersebut. Perbedaan patch produksi dan source di Git perlu diperiksa sebelum membangun ulang backend.

### SDM

- Data pegawai, organisasi, posisi, penempatan utama/riwayat, atasan, kontrak dan berkas privat; pencarian/filter serta ekspor sesuai akses.
- Regulasi & SOP mempunyai versi, tanggal berlaku, unit pengelola dan sasaran. Aktivasi versi baru tidak boleh mendahului tanggal berlaku.
- Pengelola dokumen dalam cakupan, termasuk Superadmin, dapat menghapus melalui konfirmasi. Dokumen dan unduhan ditutup, sementara versi, relasi dan audit dipertahankan. Unit sasaran tertentu dipilih melalui daftar centang.
- Kegiatan & Pelatihan mencakup peserta, kehadiran manual, materi, referensi versi SOP, dokumentasi foto dan sertifikat. Pegawai tidak wajib memiliki akun untuk menjadi peserta.
- Sejak 22 Oktober, pencarian nama/nomor pegawai dan pilihan beberapa peserta disimpan dalam satu transaksi. Kegagalan salah satu peserta membatalkan seluruh batch. Penghapusan kegiatan mengikuti role Superadmin.
- Coaching memuat sesi, coach/karyawan, tindakan, penanggung jawab, target, progres dan penyelesaian; akses baca mengikuti kebijakan coaching.
- Cuti/izin beserta saldo/approval, payroll, benefit, KPI/penilaian kinerja lengkap, dan integrasi mesin absensi belum menjadi fitur MVP yang dinyatakan selesai.

### Keamanan

- Kelompok, wilayah/pos, shift termasuk lintas tengah malam, anggota, kelayakan, ketidaktersediaan, aturan kerja, pola rotasi, anchor/fase dan kebutuhan penjagaan.
- Generator deterministik, penugasan manual, kunci, validasi lintas periode, kekurangan petugas, snapshot, revisi dan publikasi atomik. Draf tidak boleh memaksakan penugasan yang melanggar aturan.
- Jam shift, batas kerja/istirahat, kebutuhan pos dan kebijakan kekurangan berasal dari keputusan organisasi. Nilainya tidak boleh ditebak. Ketidaktersediaan operasional bukan sistem pengajuan cuti.
- Logbook & Patroli serta Laporan Kejadian memiliki bukti foto, lokasi, penanggung jawab dan riwayat. Alur kejadian mendukung perkembangan, penyelesaian dan pembukaan kembali.
- Formulir laporan melalui login tetap meminta GPS dan foto kamera. Formulir kejadian baru tidak lagi meminta kolom Tindakan awal.
- Laporan Cepat merupakan jalur berbeda: nama tempat wajib, GPS opsional, 1–5 foto kamera JPEG/PNG. Identitas dipilih pengisi dan tidak diperlakukan sebagai autentikasi pegawai atau bukti kehadiran terverifikasi.

### Pengadaan

- Alur utama: PR multi-item → diketahui atasan → verifikasi Keuangan/Pos RKA → persetujuan Sekban/Kaban → pemeriksaan Purchasing → pembandingan/pemilihan vendor → PO/SPK/surat penunjukan → pembelian → serah terima.
- Ada jalur langsung beli, perbandingan harga, dan penunjukan; ketentuan nominal mengikuti pengaturan. Revisi, pengembalian, pembatalan, Plh, pengalihan penyetuju, konfirmasi ulang kenaikan harga, penomoran dan audit tersedia.
- Dokumen final berupa snapshot dengan SHA-256 dan QR verifikasi yang tetap memerlukan login. Pos RKA mencatat komitmen/realisasi; laporan dan ekspor untuk SPI tersedia. Data vendor sensitif dibatasi.
- Sekban dan Wakil Sekretaris Badan dapat memiliki kewenangan Sekban yang setara. Satu keputusan menyelesaikan tahap bersama; nama dan penandatangan mengikuti pelaksana sebenarnya. Ini bukan penugasan Plh.
- PR Sekban/Wakil sendiri naik ke Kaban. Kewenangan bersama tidak mengambil tahap Kaban. Pemegang ketiga posisi harus aktif, berbeda dan tunggal.
- Superadmin dapat menggantikan penyetuju dengan alasan yang dicatat, tetapi tetap tidak boleh menyetujui PR sendiri dan harus tertaut ke pegawai aktif. Ketentuan ini tidak membuktikan semua kontrol Pengadaan bebas temuan; lihat bagian 11.
- SPJ lanjutan, PPV/PPB/pembayaran, kode penutup audit SPI, dan pengingat harian terjadwal belum termasuk MVP selesai. Penyetuju PR Kaban yang belum ditetapkan tetap keputusan terbuka.

### Informasi internal

Pengumuman mendukung teks/gambar tersusun, lampiran, sasaran seluruh pegawai, periode tayang, sematan, arsip dan status baca. Pengelolaan mengikuti izin Admin/SDM. Lonceng notifikasi dan pemilih ruang kerja SDM/Keamanan/Pengadaan tersedia.

## 4. Arsitektur dan penyimpanan

```text
Browser / PWA
    → Cloudflare Pages (halaman dan aset)
    → Pages Functions (API satu origin, cookie, CSRF, sesi)
    → Supabase Auth + Edge Functions
    → PostgreSQL (data, otorisasi, transaksi, audit)
    → Google Drive privat (foto dan berkas)
```

| Komponen | Peran / catatan |
|---|---|
| Cloudflare Pages | Proyek `sph-portal`, repo `BPFBesakih/SPH-Portal`, branch `master`, root `site-info`, build `exit 0`, output `dist`. Aset dibangun sebelum push. |
| Pages Functions | Menangani sesi, cookie, CSRF dan perantara API. Browser tidak mengakses secret Supabase/Drive. |
| Supabase | Proyek `mcblosxtuhgxbgyrhfhm`; Auth dan PostgreSQL. Permintaan Edge operasional diarahkan ke `ap-southeast-1` mengikuti lokasi database Singapura. |
| Edge Functions | `portal-api` untuk modul utama, `coaching-native` untuk formulir coaching; fungsi Google coaching lama dipensiunkan. Nomor versi aktif harus dibaca ulang sebelum perubahan. |
| Database | Schema `portal` privat; RLS aktif dan hak akses tabel langsung dibatasi. Hitungan 48 tabel pada migrasi awal dan 65 setelah Pengadaan bukan inventaris terbaru setelah semua migrasi aditif. |
| Google Drive | Berkas privat; unduhan memeriksa izin objek induk, metadata/penanda aplikasi, folder, ukuran dan checksum. Tidak ada tautan publik otomatis untuk lampiran operasional. |
| Lokal | Node.js 24 LTS (>=24.14.0, <25), modul ESM, SQLite, HTML/CSS/JavaScript native. Jalur ini terpisah dari database dan berkas produksi. |

Folder Drive ditentukan backend berdasarkan modul: `SPH-Portal-SOP`, `SPH-Portal-Pelatihan`, `SPH-Portal-Pegawai`, `SPH-Portal-Patroli`, `SPH-Portal-Kejadian`, `SPH-Portal-Informasi`, `SPH-Portal-Pengadaan`, dan `SPH-Portal-Coaching`. Folder Website baru relevan ketika modul website diterapkan. Folder dibuat saat diperlukan; berkas lama dapat dirapikan saat dibuka oleh pengguna yang berhak.

Cookie produksi memakai prefiks `__Host-`, `Secure`, `HttpOnly` untuk sesi, `SameSite=Strict`, dan tanpa Domain. Mutasi memeriksa origin, CSRF, sesi, status akun/password, izin dan scope. Data operasional/API tidak disimpan dalam cache HTTP atau penyimpanan browser untuk akses offline. Transaksi domain dan audit berjalan bersama; perubahan yang saling bergantung dilindungi penguncian/versi data.

Backup lokal SQLite beserta lampiran **tidak mencadangkan produksi**. Pemulihan produksi memerlukan cadangan PostgreSQL dan Drive yang konsisten serta uji pemulihan keduanya. Bukti kebijakan retensi dan uji pemulihan produksi menyeluruh belum tersedia dalam catatan yang diperiksa.

## 5. Formulir tanpa login

### Laporan Cepat Keamanan

Halaman `https://bpbesakih.com/laporan-cepat/` memerlukan token pada fragmen URL untuk dipakai. Pengelola dengan `security.config.manage` membuat, mengganti atau menonaktifkan tautan dari Logbook & Patroli. Pilihan nama dibatasi pegawai aktif pada posisi Keamanan yang diizinkan dan cakupan pembuat tautan.

Token acak disimpan sebagai hash; endpoint publik hanya menyediakan konteks dan pengiriman. Data ditandai `PUBLIC_LINK`, identitas adalah pilihan mandiri, dan tidak ada sesi pegawai yang dipalsukan. Tautan tidak dapat membaca daftar laporan/foto. Penyimpanan catatan, foto, sumber dan audit atomik; retry dengan kunci/payload sama tidak membuat duplikasi. Foto/lokasi mempunyai batas umur bukti dan batas ukuran.

### Coaching native

Halaman `https://bpbesakih.com/coaching/` memakai token pada fragmen URL, tanpa akun Google/portal. Nama karyawan dan coach dapat dicari; nomor pegawai tidak ditampilkan. Nama dan penempatan identik yang ambigu ditandai agar SDM menyelesaikan duplikasi.

Data coaching masuk langsung ke tabel Supabase yang sama dengan portal; foto JPEG/PNG maksimal 10 MB masuk ke folder Coaching privat. Tautan hanya memberi akses pengiriman, bukan membaca sesi/foto. Pengelola `hr.coaching.manage` dengan scope `ALL` dapat mengambil tautan aktif melalui tombol salin. Database menyimpan hash token serta `share_token` privat agar tautan yang sama dapat dipulihkan; nilai tersebut tidak boleh masuk Git/log/aset publik.

Integrasi Apps Script/Google Sheets lama dipensiunkan 23 Oktober: web app diarsipkan, kode diganti pemberitahuan/handler tanpa operasi, proyek dipindahkan ke Sampah Drive, dan penerima `coaching-google-sync` versi pensiun merespons 410. Pemicu lama tidak dihapus permanen. Rekap/foto dipertahankan sebagai arsip; formulir native tidak menambahkan baris ke Sheets lama.

## 6. PWA dan performa

PWA dipasang dari `/app/`: Android melalui menu instalasi/tambah layar utama, iPhone/iPad melalui Safari → Bagikan → Tambahkan ke Layar Utama, dan komputer melalui Chrome/Edge. Ikon 192/512 px, maskable Android dan Apple touch icon tersedia.

Service worker hanya menangani navigasi ruang kerja. Halaman diambil dari jaringan; saat offline tampil pesan tidak ada koneksi dan tombol coba lagi, dengan pemulihan saat koneksi kembali. Worker tidak memakai Cache Storage, tidak menyimpan API/file/data internal, dan tidak menambahkan pengiriman laporan offline. Pemasangan nyata di perangkat Android/iPhone masih perlu uji pengguna.

Optimasi yang sudah dirilis:

- Permintaan menu didahulukan; notifikasi dimuat setelahnya. Antrean menjaga lease sesi. Klik cepat hanya menampilkan hasil menu yang masih relevan.
- Ringkasan notifikasi dipakai ulang di memori tab selama 60 detik, dibersihkan saat ganti akun/logout. Ini berbeda dari cache data untuk offline.
- Paket JavaScript/CSS ber-hash memakai cache jangka panjang; HTML/API privat tetap `no-store`. Foto latar login selain yang pertama ditunda.
- Validasi identitas dan konteks akun independen berjalan bersamaan, tetapi keduanya tetap wajib lolos. Izin dipakai ulang hanya dalam satu transaksi baca; pencabutan terlihat pada permintaan berikutnya.
- Unggahan portal mengirim byte asli, menghindari pembesaran base64 pada transport browser. Batas 10 MB, pemeriksaan tipe/signature, izin dan checksum dipertahankan.
- Token Drive hanya dipakai ulang di memori server sampai sebelum kedaluwarsa. Pemeriksaan metadata dan query relasi berkas diringkas tanpa membuat file privat menjadi publik.

Pengukuran fixture menunjukkan pembacaan database menu turun 200→7 dan 242→5 pada dua skenario, serta request penyimpanan lima foto turun 17→7. Angka ini hasil data fiktif, bukan janji latensi produksi atau uji beban banyak pengguna.

## 7. Domain dan keamanan 24–25 Oktober

Domain `bpbesakih.com` memakai registrar Hostinger dan nameserver Cloudflare. `www.bpbesakih.com` serta `sph-portal.pages.dev` diarahkan 301 ke HTTPS domain utama dengan path/query dipertahankan. Migrasi domain tidak memindahkan Supabase atau Drive.

| Konfigurasi | Keadaan terakhir dan sumber bukti |
|---|---|
| HSTS | `max-age=2592000` (30 hari); tanpa `includeSubDomains`/preload. Diterapkan 24 Oktober dan header diperiksa ulang 25 Oktober. |
| SPF | TXT apex `v=spf1 -all`, karena domain belum dipakai mengirim email. |
| DMARC | TXT `_dmarc`: `v=DMARC1; p=reject; sp=reject`. |
| DNSSEC | Cloudflare signing + DS di Hostinger; validasi Google 25 Oktober menghasilkan `AD=true`, status 0. |
| Origin | `PORTAL_ORIGIN=https://bpbesakih.com`; `PORTAL_LEGACY_ORIGIN` sudah dihapus dari Production pada 24 Oktober. Keberadaan dukungan legacy di kode tidak berarti variabel itu masih aktif. |
| Analitik | Pages Web Analytics dan RUM zona dinonaktifkan. Respons HTML yang diperiksa 25 Oktober tidak memuat beacon Cloudflare. Pemeriksaan DOM browser dilakukan pada pekerjaan 24 Oktober. |
| Deployment konfigurasi | `676d0bc7-60be-45c3-aef8-b927e3dc447e`, sukses 24 Oktober 10.29 UTC+8, source `e30ef6e`. Bukan perubahan kode/schema/data operasional. |

Pengguna berencana memakai email domain kemudian. **Sebelum email diaktifkan**, pilih penyedia, sesuaikan SPF, pasang DKIM dan MX, lalu uji alignment DMARC. Jangan menambahkan TXT SPF kedua pada nama yang sama. Dokumen ini tidak menyatakan email domain sudah siap digunakan.

Gangguan saat perpindahan domain pernah disertai halaman blokir Fortinet di jalur pengujian; itu tidak membuktikan pengguna mempunyai FortiGate. Tidak perlu mengasumsikan perubahan firewall/DNS komputer. Timeout menu sesudah login ditangani dengan pemilihan region Edge Singapura yang dekat database.

## 8. Riwayat penting

| Tanggal | Keputusan / hasil |
|---|---|
| 15 Oktober | PRD/ERD awal SDM, keamanan, akses; implementasi Node/SQLite dan staging bagan organisasi. |
| 16 Oktober | Fondasi Auth, sesi, RLS, Pages dan modul operasional Supabase; login, ganti password, logout/login ulang dikonfirmasi. Informasi Internal serta foto/GPS laporan ditambahkan. |
| 17 Oktober | Kegiatan & Pelatihan/dokumentasi; pemisahan posisi Staf/THL; pemilih pegawai; MVP Pengadaan dan demo terpisah. Diagnosis unggahan Drive `invalid_grant` dicatat. |
| 18 Oktober | Audit Pengadaan F1–F4 dan kekurangan PWA; perbaikan tampilan serta password minimal enam karakter. Website publik/editor mulai dikembangkan lokal. |
| 19 Oktober | Optimasi menu (`5672717`), pengaturan atasan dan Sekban/Wakil/Kaban, pemisahan Superadmin/IT-admin, folder Drive per modul, penghapusan SOP sesuai scope (`dbabd79`). |
| 22 Oktober | Domain utama berpindah; dukungan origin transisi (`77515ea`), region Singapura (`0658179`), peserta pelatihan sekaligus (`5f3c824`). |
| 23 Oktober | Laporan Cepat (`409c3c1`, `89d26b1`); coaching native (`0feed1f`) dan pensiun Google; optimasi portal (`616d922`) dan unggahan (`1559dc6`); salin link coaching; PWA (`e30ef6e`). |
| 24 Oktober | HSTS, SPF/DMARC, DNSSEC, penghapusan origin legacy dan penonaktifan beacon; penerapan ulang konfigurasi berhasil. |
| 25 Oktober | Konsolidasi dokumentasi dan pemeriksaan ulang HTTP/DNS/PWA tanpa login maupun transaksi operasional. |

Catatan administratif GitHub: pada 23 Oktober sidebar contributor masih menampilkan Claude meskipun riwayat commit/API yang diperiksa hanya menampilkan dua akun manusia. Draf GitHub Support tersedia lokal di `test-results/github-contributors/github-support-draft.md`, belum dikirim. Status sidebar belum diperiksa ulang pada pekerjaan dokumentasi ini; jangan menganggap masalah itu sudah ditutup atau mengubah riwayat Git untuk menebaknya.

## 9. Data organisasi dan pekerjaan lokal

Impor awal dari bagan organisasi menghasilkan 157 calon nama, 83 label posisi, enam unit utama dan tujuh isian nama belum ditetapkan. Itu **staging historis**, bukan jumlah pegawai produksi saat ini. Catatan 22 Oktober menyebut daftar 210 pegawai berhasil dibuka; jumlah terkini tidak dihitung ulang pada pekerjaan dokumentasi ini.

Pada 19 Oktober, atasan ditetapkan untuk 160 penempatan utama. Catatan saat itu menyebut 46 penempatan masih memerlukan keputusan: 25 belum mempunyai pemegang jabatan atasan aktif, 20 mempunyai dua calon pemegang atasan, dan satu belum mempunyai relasi sumber. Jangan menetapkan atasan secara sembarang atau menganggap angka tersebut masih sama tanpa membaca data terbaru. Konfigurasi pejabat Pengadaan dan akses pengelola Pos RKA sudah pernah diterapkan; jumlah RKA/vendor/PR dari audit lama bukan keadaan yang telah diverifikasi hari ini.

Website publik lokal memuat 26 profil pura, panduan kunjungan, fasilitas, kabar, galeri, tentang dan kontak. Konten awal diringkas dari besakih.org dengan referensi; foto berasal dari folder yang diberikan pengguna. Tarif, jam dan agenda operasional tidak dikarang. Agenda kosong sampai diterbitkan admin.

Editor lokal memisahkan draf, siap ditinjau, terbit dan arsip; halaman publik membaca snapshot `published_json`. Izin baca/kelola/terbit terpisah. Foto website tidak boleh memakai ID file privat modul lain. Pratinjau lokal memakai `npm run preview:website` pada port 3070 dan data terpisah; perintah ini hanya tersedia bila pekerjaan website lokal ikut ada. Source rilis GitHub tidak boleh diasumsikan sudah memuatnya.

Folder utama juga memuat source patch operasional, formulir, aset build, migrasi, skrip verifikasi dan integrasi lama yang belum seluruhnya tercatat di Git. Sebagian tampak belum dilacak hanya karena checkout utama lebih tua daripada commit rilis. Periksa isi/diff, bukan sekadar status `untracked`, sebelum menyimpulkan fitur belum dirilis.

## 10. Menjalankan, membangun, dan melanjutkan pekerjaan

### Demo lokal

Memerlukan Node.js 24.14 atau lebih baru dalam seri 24 LTS. Inti server lokal memakai modul bawaan Node; alat build/ikon/cloud/browser memiliki dependensi terpisah dan lockfile masing-masing.

```powershell
node scripts/demo.mjs
$env:DATA_DIR = 'data/demo'
$env:APP_ORIGIN = 'http://127.0.0.1:3000'
node server.mjs
```

Demo memakai data fiktif; akun demonstrasi dan panduan inisialisasi organisasi ada di README. `data/demo`, `data/demo-pengadaan`, database organisasi lokal, serta produksi adalah penyimpanan berbeda. Jangan menjalankan inisialisasi/demo pada database operasional atau menyalin SQLite ke produksi.

### Struktur sumber

| Lokasi | Isi |
|---|---|
| `server.mjs`, `schema.sql`, `lib/` | Server lokal, schema/migrasi lokal dan aturan domain. |
| `public/` | Antarmuka native, manifest, service worker, ikon dan formulir. |
| `site-info/functions/`, `site-info/lib/` | Perantara API/sesi Cloudflare. |
| `site-info/dist/` | Artefak Pages terbangun, termasuk `/app/`, formulir dan bundel `/portal-static/`. |
| `supabase/migrations/`, `supabase/setup/` | Migrasi aditif dan setup terarah; bukan perintah untuk menjalankan seluruh setup ulang. |
| `supabase/functions/`, `supabase/deploy/` | Source modular dan bundle Edge untuk deployment. |
| `scripts/`, `tests/`, `docs/` | Build, demo, verifikasi, pengujian dan dokumentasi. |
| `content/` | Konten/sumber website publik yang masih pekerjaan lokal. |
| `data/`, `backups/`, `test-results/` | Data/backup/bukti lokal, diabaikan Git. |

### Alur perubahan

1. Periksa status Git, HEAD remote, perubahan lokal, konfigurasi produksi dan source Edge aktif. Jangan menjalankan reset/clean atau menimpa pekerjaan yang belum dipush.
2. Siapkan perubahan terarah berbasis rilis aktif. Backend yang pernah ditambal langsung harus direkonsiliasi sebelum build penuh; generator dari checkout lama dapat menghilangkan perilaku yang sudah aktif.
3. Bila ada perubahan schema, siapkan migrasi aditif dan verifikasi pada database terisolasi. Urutan rilis fitur umumnya migrasi → Edge Function → aset Pages → pemeriksaan produksi.
4. `node scripts/build-cloud-deploy.mjs` membangun paket; `--frontend-only` membangun aset frontend. **Build lokal bukan deployment.** Jangan menerbitkan website lokal hanya karena asetnya ikut terbangun.
5. Jalankan pengujian sesuai perubahan. Suite Node: `node --test tests/*.test.mjs`. Skrip `verify-cloud-operations`, `verify-cloud-portal-ui`, `verify-purchasing-ui`, `verify-quick-reports-postgres`, `verify-native-coaching-postgres`, dan `verify-pwa-ui` mencakup bidang masing-masing; beberapa membutuhkan path PGlite/Playwright/browser.
6. Commit/push hanya berkas yang memang dimaksudkan. Push `master` dapat memicu Cloudflare Pages; Edge Function dan konfigurasi dashboard mempunyai siklus penerapan terpisah.
7. Catat commit, deployment, bagian yang diuji, hasil nyata, keterbatasan dan langkah rollback. Pertahankan artefak verifikasi/Search Console, privasi, ketentuan dan foto/sumber yang relevan.

## 11. Tindak lanjut yang belum boleh dianggap selesai

| Prioritas / bidang | Tindak lanjut dan status bukti |
|---|---|
| Kontrol Pengadaan | Audit 18 Oktober membuktikan F1 cakupan unit Pos RKA, F2 nota melampaui persetujuan, F3 penerimaan sebagian menutup PR, dan F4 tahun RKA tidak konsisten. Tidak ditemukan bukti penutupan eksplisit dalam catatan yang diperiksa. Verifikasi ulang source backend aktif dan kasus uji sebelum menyatakan selesai. |
| Konsistensi source produksi | Rekonsiliasi patch backend/admin/Drive/kewenangan yang diterapkan terarah dengan repo, tanpa membawa website lokal atau perubahan lain secara tidak sengaja. |
| Data/prasyarat Pengadaan | Tinjau penempatan yang belum memiliki atasan tunggal, tahun/Pos RKA, vendor, pemegang posisi dan role. Audit lama tidak membuktikan prasyarat sekarang lengkap. |
| UAT operasional | Uji alur per role, transaksi Pengadaan nyata yang disepakati, kamera/GPS perangkat fisik, unggah/unduh lintas modul dan cetak. Tes fixture tidak menggantikan penerimaan pengguna. |
| PWA perangkat | Uji pemasangan, pembukaan dan pemulihan jaringan di Android/iPhone yang digunakan petugas. Aset tersedia tidak sama dengan pemasangan fisik telah diuji. |
| Backup dan retensi | Tetapkan retensi data/foto/coaching/audit, pengelola backup PostgreSQL+Drive dan bukti uji pemulihan. Target PRD RPO/RTO masih memerlukan pengesahan. |
| Kapasitas | Target PRD 10.000 pegawai/100 pengguna bersamaan belum dibuktikan dengan uji beban produksi. |
| Email domain | Konfigurasi SPF/DKIM/MX sesuai penyedia sebelum mengirim/menerima email domain. |
| Website publik lengkap | Masih lokal; butuh verifikasi PostgreSQL/Cloudflare, migrasi, konten, deployment dan pemeriksaan akses media sebelum live. |
| Administrasi eksternal | Status branding Google, kepemilikan Search Console domain baru dan sidebar contributor GitHub tidak diverifikasi ulang pada pekerjaan ini. Jangan menyalin kesimpulan lama sebagai status terkini. |

Temuan PWA F5 dari audit 18 Oktober telah ditindaklanjuti melalui rilis PWA; batasnya tetap tidak menyediakan data/formulir offline. Keberhasilan itu tidak menutup temuan Pengadaan F1–F4.

## 12. Bukti pengujian dan batas pemeriksaan

Hasil tes memiliki baseline berbeda dan **tidak dijumlahkan** sebagai satu suite:

| Baseline / pekerjaan | Hasil historis |
|---|---|
| PWA, folder kerja lokal 23 Oktober | 225 tes Node, lima pemeriksaan PWA browser dan 28 regresi browser portal lulus. |
| PWA, paket rilis berbasis produksi | 202 tes Node, lima pemeriksaan PWA browser dan 28 regresi portal lulus. Selisih jumlah berasal dari cakupan source lokal/rilis yang berbeda. |
| Optimasi portal 23 Oktober | 184 tes Node, 23 pemeriksaan PostgreSQL/Edge, 28 browser portal dan delapan Pengadaan lulus. |
| Optimasi unggahan 23 Oktober | 191 tes Node; 23 PostgreSQL portal, tujuh Laporan Cepat, enam Coaching; 28 browser portal dan delapan Pengadaan lulus. |
| Drive per modul 19 Oktober | Unduhan SOP dummy dan foto kegiatan lama berhasil di produksi; folder modul terbentuk. Ini bukti spesifik, bukan semua jenis unggahan selalu berhasil. |

Pemeriksaan ulang **25 Oktober 2026** dilakukan tanpa login dan tanpa menulis data operasional:

- `/`, `/app/`, `/portal/`, `/privacy/`, `/terms/`, `/coaching/` dan `/laporan-cepat/`: HTTP 200.
- `/api/health`: HTTP 200, `status=ok`, `modules_revision=20261016.1`. Nilai revisi ini tidak mengidentifikasi commit atau versi Edge terbaru.
- `/api/auth/me` tanpa sesi: HTTP 401 yang diharapkan.
- Manifest `/app/manifest.webmanifest` dan worker `/app/sw.js`: HTTP 200, tipe konten sesuai; HTML `/app/` memuat tautan manifest. Ini bukan pengujian instalasi PWA pada perangkat fisik.
- HSTS 30 hari terdapat pada respons yang diperiksa; HTML tidak mengandung beacon Cloudflare. Halaman/API privat dan aset PWA yang diperiksa memakai `no-store`.
- HTTP domain utama, `www`, dan alamat Pages lama: 301 dengan path/query terpelihara.
- Google DNS-over-HTTPS: SPF, DMARC dan DS sesuai catatan; status DNS 0 dan `AD=true`.
- GitHub `master` sebelum perubahan dokumentasi: `e30ef6ee03f115a87d24db03f3f1eae7e221810f`.

Pemeriksaan dokumentasi ini tidak mengulang seluruh suite aplikasi, memeriksa ulang dashboard secret/role, menghitung data pegawai live, atau melakukan transaksi uji produksi. Hasil otomatis lama tetap dicatat sebagai historis.

## 13. Peta dokumentasi

Dokumen ini sengaja mandiri. Nama berikut membantu mencari rincian saat repositori/folder kerja tersedia; beberapa catatan khusus masih hanya ada pada folder kerja utama.

| Bidang | Berkas sumber |
|---|---|
| Kebutuhan awal | `docs/PRD-BP-Besakih.md`, `docs/ERD-BP-Besakih.md`, `docs/IMPORT.md`. |
| Panduan inti | `README.md`, `docs/MVP-PENGGUNAAN.md`, `docs/MVP-TAMBAHAN.md`. |
| Produksi | `docs/CLOUDFLARE-SUPABASE.md`, `site-info/README.md`, `supabase/README.md`. |
| PWA / domain | `docs/PWA.md`, `docs/DOMAIN-MIGRATION-2026-10-22.md`, `docs/SECURITY-HARDENING-2026-10-24.md`. |
| Akses / berkas | `docs/ADMIN-TYPES.md`, `docs/DRIVE-MODULE-FOLDERS.md`, `docs/SOP-2026-10-19.md`. |
| Pengadaan / audit | `docs/PENGADAAN.md`, `docs/SETUP-PENGADAAN-2026-10-19.md`, `docs/PENINJAUAN-2026-10-18.md`. |
| Formulir | `docs/LAPORAN-CEPAT-2026-10-23.md`, `docs/coaching-native.md`, arsip `integrations/coaching-google/README.md`. |
| Performa | `docs/PERFORMA-PORTAL-2026-10-19.md`, `docs/PERFORMA-PORTAL-2026-10-23.md`, `docs/PERFORMA-UNGGAHAN-2026-10-23.md`. |
| Website lokal | `docs/BESAKIH-WEBSITE-LOCAL.md`, `docs/RISET-BESAKIH-ORG-2026-10-18.md`, `docs/BESAKIH-PHOTO-SOURCES.md`. |
| Validasi / alternatif lokal | `docs/VERIFICATION.md`, `docs/DEPLOYMENT.md`; bukti rinci di `test-results/` yang tidak dipublikasikan ke Git. |

Saat melanjutkan proyek, pertahankan perubahan lokal, gunakan domain utama, periksa source produksi sebelum menimpa backend, pisahkan data demo dari data nyata, dan perbarui dokumen ini setiap ada keputusan atau rilis yang mengubah status.
