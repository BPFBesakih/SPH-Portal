# PRD — HRIS BP Besakih

**Versi:** 1.0  
**Tanggal:** 15 Oktober 2026  
**Cakupan:** Login & Hak Akses, Modul SDM, dan Modul Keamanan  
**Tahap:** MVP  
**Pasangan dokumen:** [ERD dan kamus data](ERD-BP-Besakih.md)

## 1. Tujuan produk

Menyediakan satu aplikasi internal untuk mengatur akses pengguna, memelihara data pegawai, mendukung pengembangan pegawai melalui pelatihan dan coaching, serta menjalankan pencatatan dan penjadwalan keamanan BP Besakih.

Hasil yang diharapkan:

- Satu data pegawai yang digunakan lintas modul.
- Dokumen regulasi dan SOP memiliki versi berlaku yang jelas.
- Pelatihan dan coaching dapat ditelusuri per pegawai.
- Koordinator dapat membuat jadwal keamanan rutin otomatis, menerapkan penyesuaian sementara, dan melanjutkan rotasi rutin semula.
- Kegiatan patroli dan penanganan kejadian memiliki catatan serta penanggung jawab yang jelas.
- Setiap pengguna hanya mengakses modul, tindakan, dan data yang diizinkan.

Dokumen ini merupakan rancangan produk. Ketentuan bertanda **usulan** adalah keputusan rancangan untuk ditinjau, sedangkan nilai operasional yang belum disepakati dicatat di bagian 14. Dokumen ini tidak menetapkan aturan ketenagakerjaan atau jam kerja BP Besakih.

## 2. Dasar dan batas cakupan

Dasar cakupan adalah kesepakatan percakapan mengenai tiga bagian produk dan bagan organisasi 2026 pada sheet **Bagan Lengkap**, file **Daftar Pegawai&Org BP.xlsx**. Bagan dipakai untuk struktur fungsi, bukan sebagai bukti seluruh kewenangan operasional. Tidak ada implementasi database lama yang diasumsikan atau dipetakan secara otomatis.

| Bagian | Masuk MVP | Tahap berikutnya / di luar MVP |
|---|---|---|
| Login & Hak Akses | Login, logout, pengelolaan akun, role buatan Super Admin, izin menu/tindakan, pembatasan data, bantuan reset password | Pendaftaran publik, SSO, integrasi identitas eksternal |
| SDM | Dashboard; Data Pegawai & Organisasi; Regulasi & SOP; Kegiatan & Pelatihan; Evaluasi & Penilaian berupa coaching | Cuti/izin berikut approval dan saldo; KPI; rincian pekerjaan; penilaian kinerja; benefit; payroll; integrasi absensi |
| Keamanan | Dashboard; Jadwal & Penugasan otomatis; Logbook & Patroli; Laporan Kejadian; SOP Keamanan | Kalender upacara/kegiatan; GPS langsung; checkpoint QR; penjadwalan berbasis optimasi kompleks; approval bertingkat |

Pada MVP tidak ada menu Administrasi Pegawai untuk cuti/izin. Pencatatan petugas tidak tersedia untuk penjadwalan adalah pengaturan operasional oleh koordinator, bukan transaksi cuti atau izin.

## 3. Pengguna dan kewenangan

Role aplikasi berbeda dari jabatan organisasi. Nama role berikut merupakan **usulan awal**, dan Super Admin dapat membuat atau menyesuaikannya. Satu pengguna dapat memperoleh beberapa role bila tugasnya lintas fungsi.

| Pengguna / role awal | Tanggung jawab aplikasi | Batas data utama |
|---|---|---|
| Super Admin | Mengelola akun, role, izin, cakupan akses dan referensi aplikasi | Akses administrasi tidak otomatis memberi akses isi coaching atau berkas sensitif |
| Pengelola SDM | Mengelola pegawai, organisasi, dokumen, pelatihan, dan coaching sesuai izin | Unit atau keseluruhan organisasi yang diberikan |
| Kepala/Koordinator SDM | Memantau data dan aktivitas SDM sesuai fungsi | Cakupan yang ditugaskan |
| Kepala/Koordinator Keamanan | Mengatur petugas, kebutuhan penjagaan, pola jadwal, revisi, dan tindak lanjut kejadian | Kelompok/wilayah yang ditugaskan |
| Petugas Keamanan | Melihat jadwal relevan; mencatat kegiatan, patroli dan kejadian | Penugasan sendiri dan laporan yang diizinkan |
| Pegawai / pembimbing | Melihat informasi yang diberikan; mengakses pelatihan atau coaching sesuai izin | Data sendiri atau sesi coaching yang melibatkannya |

Ruang lingkup keamanan mencakup Wilayah I–IV, Linmas, dan Bankamda. Kelompok petugas dan wilayah/pos disimpan terpisah: keanggotaan Linmas atau Bankamda tidak otomatis berarti dapat mengisi semua pos.

### 3.1 Prinsip hak akses

- Izin adalah gabungan **modul/menu + tindakan + cakupan data**. Contoh tindakan: lihat, tambah, ubah, arsipkan, unduh, kelola peserta, kelola coaching, buat jadwal, dan terbitkan jadwal.
- Tidak ada izin berarti akses ditolak. Menu tersembunyi dan akses melalui alamat langsung/API sama-sama ditolak.
- Beberapa role menggabungkan izin, tetapi cakupan tiap pemberian role tetap melekat. Izin seluruh unit pada satu menu tidak memperluas menu lain.
- Cakupan dasar: data sendiri, unit yang ditugaskan, pos keamanan yang ditugaskan, atau seluruh organisasi. Pos memiliki pemberian akses eksplisit agar dua wilayah dalam unit organisasi yang sama tetap dapat dipisahkan. Hierarki unit hanya memperluas cakupan bila dikonfigurasi secara eksplisit.
- Cakupan pos berlaku pada sumber daya keamanan yang terkait pos; tidak memberi akses ke data SDM atau pengelolaan master kelompok. Pengelolaan master kelompok memerlukan izin dengan cakupan unit atau seluruh organisasi yang sesuai.
- Catatan coaching hanya tersedia bagi pihak yang diberi izin dan terkait sesi tersebut, atau pengelola coaching yang ditunjuk. Menjadi rekan satu unit tidak cukup.
- Berkas, lampiran, ekspor, pencarian, dan angka dashboard mengikuti pembatasan yang sama dengan data sumber.
- Perubahan hak akses dan penonaktifan akun berlaku pada permintaan berikutnya, termasuk sesi yang sudah aktif.
- Sistem mencegah penonaktifan atau pencabutan akses administrator terakhir yang dapat mengelola akun dan role.

## 4. Struktur navigasi

```text
Login
└── Beranda / pilihan modul sesuai akses
    ├── SDM
    │   ├── Dashboard SDM
    │   ├── Data Pegawai & Organisasi
    │   ├── Regulasi & SOP
    │   ├── Kegiatan & Pelatihan
    │   └── Evaluasi & Penilaian
    │       └── Coaching
    ├── Keamanan
    │   ├── Dashboard Keamanan
    │   ├── Jadwal & Penugasan
    │   ├── Logbook & Patroli
    │   ├── Laporan Kejadian
    │   └── SOP Keamanan
    └── Pengaturan Akses (sesuai izin)
        ├── Akun Pengguna
        ├── Role & Izin
        └── Riwayat Aktivitas
```

Pengaturan shift, pos, kelompok petugas, pola rotasi dan kebutuhan penjagaan berada di dalam Jadwal & Penugasan. Tidak perlu menambah menu utama keamanan untuk setiap pengaturan.

## 5. Login & Hak Akses

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| AUTH-01 | Login menggunakan username dan password; akun dibuat administrator, tanpa pendaftaran publik | Akun aktif dengan kredensial benar berhasil masuk; kredensial salah menghasilkan pesan umum tanpa membocorkan keberadaan akun |
| AUTH-02 | Logout dan pengakhiran sesi | Setelah logout, sesi tidak dapat digunakan kembali; sesi memiliki batas kedaluwarsa yang dapat dikonfigurasi |
| AUTH-03 | Buat/ubah/nonaktifkan akun; tautkan ke pegawai bila relevan | Satu pegawai maksimal memiliki satu akun; pegawai tetap dapat dicatat tanpa akun; akun admin teknis dapat tidak terkait pegawai. Usulan: pegawai nonaktif kehilangan akses akun terkait pada permintaan berikutnya; akun teknis mengikuti status akunnya sendiri |
| AUTH-04 | Password awal sementara dan bantuan reset oleh administrator | Password wajib diganti pada pemakaian awal; token reset disimpan sebagai hash, sekali pakai dan memiliki kedaluwarsa; reset mencabut sesi lama; tidak bergantung pada email/WhatsApp |
| AUTH-05 | Super Admin membuat role dan memilih menu serta tindakan yang tersedia | Role baru dapat diberikan pada akun dan diuji; pengguna tidak dapat meningkatkan izinnya sendiri di luar kewenangan yang diberikan |
| AUTH-06 | Cakupan akses per pemberian role | Pengguna dengan cakupan Wilayah I tidak dapat membuka, mengekspor atau mengunduh data Wilayah III tanpa izin tambahan |
| AUTH-07 | Audit akses administratif dan perubahan data penting | Pembuatan akun, perubahan role/izin, penonaktifan akun dan publikasi jadwal mencatat pelaku serta waktu; password/token tidak masuk audit |

**Usulan alur reset:** administrator memverifikasi pemohon melalui prosedur internal, membuat kredensial pemulihan sekali pakai, lalu menyampaikannya melalui saluran internal yang disepakati. Saluran tersebut bukan integrasi aplikasi MVP. Password lama tidak pernah ditampilkan.

## 6. Modul SDM

### 6.1 Dashboard SDM

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| HR-01 | Ringkasan pegawai per unit dan status | Jumlah mengikuti filter dan hak akses; jumlah per unit memakai penempatan utama pada tanggal acuan agar pegawai tidak dihitung ganda |
| HR-02 | Pelatihan terdekat dan coaching yang tindak lanjutnya belum selesai | Daftar bersumber dari pencatatan aktual, dapat dibuka ke detail, dan tidak memuat data di luar izin |

### 6.2 Data Pegawai & Organisasi

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| HR-03 | Profil pegawai: nomor pegawai, nama, kontak kerja, tanggal mulai, status dan status aktif | Nomor pegawai unik; validasi bidang wajib jelas; penonaktifan mempertahankan riwayat |
| HR-04 | Unit organisasi, posisi, atasan dan penempatan | Daftar bertingkat dapat dicari; relasi unit tidak membentuk siklus; satu penempatan utama berlaku pada satu waktu; riwayat tanggal efektif tersimpan; pegawai tidak dapat menjadi atasan dirinya sendiri dan rantai atasan tidak boleh melingkar pada tanggal efektif yang sama |
| HR-05 | Masa kontrak dan berkas pegawai bila berlaku | Tanggal akhir tidak mendahului awal; lampiran hanya bisa diunduh pihak berizin; kontrak tidak mewajibkan seluruh pegawai berstatus kontrak |
| HR-06 | Pencarian dan filter | Pengguna dapat mencari berdasarkan nomor/nama serta menyaring unit, posisi dan status dengan hasil sesuai cakupan |

Bidang identitas sensitif hanya dikumpulkan bila diperlukan dan telah ditentukan pemilik data. MVP tidak perlu menyalin seluruh isian sistem lama. Perubahan penempatan dilakukan sebagai pencatatan riwayat, tanpa workflow approval mutasi.

### 6.3 Regulasi & SOP

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| DOC-01 | Buat dokumen dengan judul, kategori, pemilik, sasaran unit, serta versi | Setiap versi memiliki nomor unik dalam dokumen yang sama, file dan tanggal berlaku |
| DOC-02 | Simpan versi baru dan arsip versi sebelumnya | Dokumen maksimal memiliki satu versi berstatus berlaku; publikasi versi baru tidak menimpa berkas lama; versi bertanggal masa depan tidak ditampilkan sebagai berlaku |
| DOC-03 | Cari, lihat dan unduh | SOP keamanan dan standar layanan ditampilkan dari dokumen pusat yang sama sesuai kategori dan sasaran akses |

Publikasi dokumen dilakukan pengguna berizin tanpa rangkaian approval. Tanggal berlaku ditentukan pengelola. Aktivasi versi baru dilakukan secara eksplisit pada atau setelah tanggal tersebut; penjadwalan aktivasi otomatis belum diperlukan.

### 6.4 Kegiatan & Pelatihan

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| TRN-01 | Buat kegiatan atau pelatihan berisi judul, topik, penyelenggara, waktu, lokasi dan status | Waktu akhir tidak mendahului awal; status minimal direncanakan, selesai atau dibatalkan |
| TRN-02 | Kelola peserta dan kehadiran manual | Pegawai tidak terdaftar ganda pada pelatihan yang sama; hadir/tidak hadir/belum dicatat dibedakan |
| TRN-03 | Lampirkan materi dan sertifikat; lihat riwayat | Materi terkait kegiatan atau pelatihan, sertifikat terkait peserta; berkas dibatasi hak akses |
| TRN-04 | Materi dari dokumen pusat | Materi kegiatan dan pelatihan dapat merujuk versi dokumen pusat; pengelolaan standar layanan tetap di Regulasi & SOP |
| TRN-05 | Dokumentasi foto kegiatan | Pengelola sesuai cakupan kegiatan dapat mengunggah foto JPG/PNG maksimal 10 MB per foto beserta keterangan opsional. Foto ditampilkan terpisah dari materi dan mengikuti izin berkas kegiatan |
| TRN-06 | Hapus kegiatan khusus itadmin | Hanya akun aktif dengan username `itadmin` dan akses baca kegiatan yang dapat menghapus. Wajib konfirmasi dan versi data terkini; kegiatan hilang dari daftar, dashboard, riwayat pegawai, serta akses detail/berkas. Data terkait dan audit dipertahankan secara privat |

### 6.5 Evaluasi & Penilaian — Coaching

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| COA-01 | Catat sesi coaching: tanggal, pegawai, pembimbing, topik, kendala dan arahan | Sesi terkait pegawai dan pembimbing yang jelas; pembimbing dipilih dari data pegawai; pengguna pencatat tersimpan terpisah |
| COA-02 | Catat satu atau beberapa tindak lanjut | Tindakan memiliki uraian, penanggung jawab, tanggal target opsional dan status belum mulai/dalam proses/selesai |
| COA-03 | Pantau progres dan riwayat | Penyelesaian menyimpan waktu serta catatan hasil; perubahan tercatat dalam audit; keterlambatan dihitung dari target dan status |
| COA-04 | Batasi akses | Pengguna tanpa izin tidak dapat melihat isi sesi, lampiran atau ringkasannya melalui dashboard/pencarian |

Tidak ada perhitungan skor, KPI, rincian kerja per posisi, atau approval penilaian dalam MVP.

## 7. Modul Keamanan

### 7.1 Dashboard Keamanan

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| SEC-01 | Petugas terjadwal per hari/shift/wilayah | Hanya memakai revisi jadwal yang sedang berlaku; label menyatakan “terjadwal”, bukan bukti hadir |
| SEC-02 | Ringkasan kekurangan, patroli dan kejadian terbuka | Angka sesuai filter/cakupan dan dapat ditelusuri ke catatan; patroli berasal dari logbook, bukan pelacakan langsung |

### 7.2 Jadwal & Penugasan

#### A. Pengaturan dasar

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| SCH-01 | Master kelompok, wilayah/pos dan petugas | Petugas mengambil profil dari data pegawai; keanggotaan kelompok serta kelayakan pos memiliki tanggal berlaku |
| SCH-02 | Shift termasuk lintas tengah malam | Shift menyimpan jam lokal dan penanda hari selesai; 22.00–06.00 dihitung sebagai satu interval lintas tanggal dengan tanggal tugas pada awal shift |
| SCH-03 | Pola rotasi rutin berversi | Pola menyimpan urutan kerja/libur, anchor tanggal dan penempatan fase petugas; perubahan membuat versi baru bertanggal efektif |
| SCH-04 | Kebutuhan rutin | Jumlah petugas ditetapkan per tanggal/pola hari, pos dan shift; kebutuhan minimum dapat berbeda antarpos |
| SCH-05 | Ketidaktersediaan manual | Koordinator mencatat interval petugas tidak tersedia; interval bertabrakan tidak dapat diisi; tidak membuat catatan cuti/izin |
| SCH-06 | Aturan kerja dan istirahat | Aturan jeda minimum, maksimum jam/hari kerja berturut-turut dan batas relevan harus dikonfigurasi sebelum jadwal diterbitkan; tidak ada angka kebijakan yang ditebak sistem |

#### B. Pembuatan jadwal otomatis

1. Koordinator memilih periode dan cakupan kelompok/wilayah.
2. Sistem mengambil pola rutin, tanggal anchor, fase tiap petugas, kebutuhan, aturan, kelayakan, dan ketidaktersediaan yang berlaku.
3. Sistem membentuk slot kebutuhan dan mengisi dengan rotasi bergiliran yang deterministik. Keseimbangan jumlah tugas menjadi preferensi sederhana, setelah seluruh syarat wajib terpenuhi.
4. Sistem memeriksa bentrok, jeda istirahat, batas kerja, kelayakan, ketidaktersediaan, dan seluruh penugasan efektif petugas di semua kelompok/pos/periode. Pembacaan periode sebelum dan sesudah mengikuti panjang konteks yang dibutuhkan aturan kerja dan istirahat.
5. Hasil disimpan sebagai draf dengan daftar slot terisi, kekurangan dan alasan slot tidak dapat diisi oleh proses tersebut.
6. Koordinator menyesuaikan, memvalidasi ulang dan menerbitkan.

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| SCH-07 | Hasil yang dapat diulang | Input, versi aturan dan seed/urutan petugas yang sama menghasilkan draf sama; input pembuatan tersimpan sebagai snapshot |
| SCH-08 | Peringatan kekurangan | Kekurangan ditampilkan per tanggal/shift/pos; sistem tidak menugaskan petugas yang tidak layak atau melanggar jeda untuk memenuhi angka |
| SCH-09 | Edit manual dan penguncian | Penugasan manual tunduk pada validasi yang sama; penugasan dikunci tetap dipertahankan saat pembuatan ulang; jika menjadi tidak valid, sistem menampilkan konflik |
| SCH-10 | Draft dan publikasi | Petugas hanya melihat jadwal terbit; seluruh pelanggaran wajib diselesaikan sebelum publikasi. Kebijakan slot kosong mengikuti DEC-08; usulan: kekurangan dapat diterbitkan dengan pengakuan eksplisit dan alasan oleh penerbit berizin |
| SCH-11 | Riwayat revisi | Jadwal terbit tidak diedit langsung; perubahan membuat draf revisi; penerbitan revisi mengganti satu versi berlaku secara atomik tanpa menghapus versi sebelumnya |

Setiap periode memiliki daftar pos yang tetap. Dua periode boleh mencakup tanggal sama bila daftar posnya terpisah; satu pos tidak boleh berada pada periode yang bertumpang tindih. Revisi selalu mempertahankan seluruh cakupan periode. Edit sebagian tanggal/pos menyalin bagian lainnya tanpa perubahan, dan penerbit harus berwenang atas seluruh cakupan revisi. Koordinator yang kewenangannya terpisah memakai periode dengan set pos terpisah.

Saat memvalidasi draf pengganti, sistem memakai seluruh penugasan draf dan jadwal terbit pada periode lain. Versi terbit lama pada periode yang akan digantikan dikecualikan agar salinan penugasan tidak dianggap bentrok dengan dirinya sendiri.

Kekurangan hasil penyusunan bukan bukti matematis bahwa seluruh kombinasi tidak mungkin. MVP memakai rotasi sederhana, bukan solver optimasi. Koordinator dapat memperbaiki draf atau mengubah input yang sah.

#### C. Penyesuaian sementara dan kembali ke pola rutin

Penyesuaian tidak membutuhkan kalender upacara atau nama kegiatan. Koordinator mengisi tanggal mulai–selesai, cakupan pos/shift, serta perubahan kebutuhan atau petugas. Tanggal mulai dan selesai bersifat inklusif menurut tanggal mulai shift. Jumlah kebutuhan sementara menggantikan jumlah rutin pada tanggal/pos/shift terkait, bukan otomatis ditambahkan. Pemeriksaan keselamatan tetap memakai interval waktu aktual.

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| SCH-12 | Penyesuaian berbatas waktu | Perubahan hanya berlaku dalam interval yang ditetapkan; rentang valid dan tidak bertumpang tindih dengan penyesuaian aktif lain pada kebutuhan yang sama |
| SCH-13 | Susun ulang periode terdampak | Sistem mengisi ulang slot dalam rentang yang diizinkan, mempertahankan penugasan terkunci, dan memeriksa batas sebelum/sesudah rentang; penugasan di luar rentang tidak ikut diubah |
| SCH-14 | Kembali ke pola rutin semula | Setelah tanggal akhir, fase rotasi dihitung dari anchor asli; siklus tidak dimulai ulang dan tidak dihitung ulang untuk meratakan beban pascapenyesuaian |
| SCH-15 | Konflik pada transisi | Bila tugas tambahan menyebabkan pelanggaran jeda pada jadwal rutin berikutnya, sistem menandai konflik dan menahan publikasi; koordinator memperbaiki penyesuaian atau memperluas rentang revisi secara eksplisit |

Contoh: tanggal 1–9 mengikuti pola rutin, 10–12 memakai penyesuaian, dan mulai 13 kembali ke fase yang memang jatuh pada tanggal 13 menurut anchor semula. Bila penugasan tanggal 12 berakhir pada pagi tanggal 13, validasi memakai jam sebenarnya.

“Kembali otomatis” berarti perhitungan draf sudah melanjutkan pola rutin setelah interval selesai. Sistem tidak memerlukan pekerjaan terjadwal untuk mengganti pola pada tanggal 13, dan tidak menerbitkan jadwal diam-diam. Jika jadwal dibuat hanya sampai tanggal 12, pembuatan periode berikutnya tetap memakai anchor asli.

#### D. Aturan prioritas penyusunan

1. Validitas wajib: status aktif, keanggotaan/kelayakan, ketidaktersediaan, bentrok, jeda dan batas kerja.
2. Penugasan manual terkunci yang masih valid.
3. Penyesuaian kebutuhan sementara pada tanggal terkait.
4. Pola rutin berdasarkan anchor asli.
5. Preferensi pembagian giliran sederhana.

Tidak ada pilihan prioritas yang dapat mengalahkan validitas wajib. Jika kebutuhan dan sumber daya tidak cocok, sistem menghasilkan kekurangan atau konflik yang dapat ditindaklanjuti.

### 7.3 Logbook & Patroli

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| LOG-01 | Catat kegiatan jaga/patroli | Tanggal/waktu, pelapor, petugas, wilayah/pos, jenis kegiatan, uraian dan temuan tersimpan; hubungan jadwal opsional untuk kegiatan di luar rencana |
| LOG-02 | Foto dan riwayat | Lampiran mengikuti hak akses laporan; dapat dicari berdasarkan tanggal, wilayah dan petugas |
| LOG-03 | Buat kejadian dari temuan | Satu logbook dapat menjadi sumber beberapa kejadian berbeda; tautan dua arah tersedia; pengiriman ulang permintaan pembuatan yang sama tidak membuat kejadian ganda |

Waktu pencatatan dan waktu kegiatan disimpan terpisah. Pencatatan tidak membuktikan kehadiran atau lokasi aktual. Penyuntingan catatan penting tercatat pada audit.

### 7.4 Laporan Kejadian

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| INC-01 | Buat laporan | Nomor laporan, waktu kejadian, lokasi, kategori, pelapor, kronologi, tindakan awal dan lampiran tersedia |
| INC-02 | Tanggung jawab dan perkembangan | Koordinator menetapkan penanggung jawab; tindak lanjut mencatat pelaku, waktu dan uraian; riwayat tidak ditimpa |
| INC-03 | Status penanganan | Urutan normal: Dicatat → Dalam Penanganan → Selesai; penyelesaian memerlukan catatan hasil dan waktu |
| INC-04 | Koreksi penyelesaian | Usulan: koordinator berizin dapat membuka kembali menjadi Dalam Penanganan dengan alasan wajib; perubahan tetap tercatat |

Laporan kejadian merupakan workflow penanganan, bukan approval bertingkat. Akses pelapor terhadap laporan lintas wilayah tetap mengikuti izin dan hubungan dengan laporannya.

### 7.5 SOP Keamanan

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| SEC-DOC-01 | Daftar, cari, lihat dan unduh SOP | Hanya dokumen kategori/sasaran Keamanan yang diizinkan; versi berlaku sama dengan pusat Regulasi & SOP |

Pengelola dokumen pusat memiliki izin mengubah/publikasi; petugas Keamanan cukup memiliki izin membaca. Tidak ada salinan dokumen terpisah.

## 8. Status dan transisi utama

| Objek | Status | Ketentuan penting |
|---|---|---|
| Akun | Aktif / nonaktif | Nonaktif mencabut penggunaan sesi |
| Versi dokumen | Draf / berlaku / diarsipkan | Maksimal satu berlaku; aktivasi tidak sebelum tanggal berlaku |
| Pelatihan | Direncanakan / selesai / dibatalkan | Kehadiran belum dicatat berbeda dari tidak hadir |
| Tindak lanjut coaching | Belum mulai / dalam proses / selesai | Selesai mempunyai waktu dan catatan hasil |
| Revisi jadwal | Draf / terbit / digantikan | Draf dapat dibuat ulang; isi versi terbit tidak diubah |
| Kejadian | Dicatat / dalam penanganan / selesai | Transisi dan pembukaan kembali tersimpan |

## 9. Ketentuan data dan integrasi internal

- Data pegawai, unit, posisi, file, dan akun memiliki identitas stabil; nama yang berubah tidak memutus riwayat.
- Akun pengguna dan pegawai merupakan objek berbeda. Penonaktifan salah satu tidak menghapus catatan yang pernah dibuat.
- Penempatan utama bertanggal efektif digunakan untuk profil dan dashboard. Keanggotaan keamanan serta kelayakan pos memiliki masa berlaku sendiri.
- Hubungan posisi/pos ke unit organisasi tidak dipindah langsung setelah direferensikan. Reorganisasi membuat referensi baru agar riwayat penempatan, kejadian dan cakupan akses lama tetap dapat ditelusuri.
- File disimpan sekali dan dihubungkan secara eksplisit ke dokumen versi, berkas pegawai, kontrak, pelatihan/peserta, logbook atau kejadian. Unduhan selalu memeriksa akses objek pemiliknya.
- Dashboard dihitung dari sumber; tidak ada input angka dashboard manual.
- Versi jadwal menyimpan snapshot pola, aturan, kebutuhan dan waktu shift agar perubahan master tidak mengubah penugasan historis.
- Waktu kejadian dan jadwal disimpan sebagai waktu yang tidak ambigu. Tampilan operasional menggunakan **WITA, Asia/Makassar (UTC+08:00)**. Tanggal tugas mengikuti awal shift.
- Data yang sudah direferensikan diarsipkan/dinonaktifkan, bukan dihapus permanen melalui operasi biasa.
- Perubahan bersamaan memakai pemeriksaan versi data. Publikasi jadwal mengunci cakupan dan memeriksa bentrok ulang agar dua koordinator tidak menerbitkan penugasan ganda.

## 10. Kebutuhan nonfungsional

| Bidang | Kebutuhan / target usulan |
|---|---|
| Penggunaan | Web responsif; input patroli/kejadian dan lihat jadwal nyaman dari ponsel; bahasa antarmuka Indonesia |
| Keamanan akun | Password di-hash dengan algoritma adaptif; komunikasi terenkripsi; pembatasan percobaan login; sesi terlindungi dan dapat dicabut |
| Perlindungan berkas | Penyimpanan privat; validasi ekstensi, tipe dan ukuran; nama penyimpanan tidak memakai data sensitif; pemindaian malware jika layanan tersedia |
| Integritas | Validasi server, foreign key, transaksi dan unique constraint; pengiriman ulang tidak membuat peserta/kejadian/publikasi ganda |
| Audit | Pelaku, waktu, objek dan jenis perubahan penting dapat ditelusuri; data rahasia autentikasi tidak dicatat; akses audit dibatasi |
| Kinerja | Target awal daftar/dashboard p95 ≤3 detik pada 10.000 pegawai, 100 pengguna bersamaan; pembuatan jadwal 31 hari/200 petugas/50 pos ≤60 detik, dengan indikator proses; target diverifikasi saat uji beban |
| Pemulihan | Usulan backup harian, target kehilangan data maksimum 24 jam dan pemulihan 8 jam; uji pemulihan sebelum rilis; angka final mengikuti lingkungan hosting |
| Aksesibilitas | Label isian, validasi yang dapat dibaca, navigasi keyboard, status tidak hanya dibedakan melalui warna |
| Operasi | MVP memerlukan koneksi internet; tidak ada sinkronisasi offline atau aplikasi native baru |

Jumlah pada target kinerja adalah beban uji usulan, bukan jumlah pegawai aktual BP Besakih. Kebijakan retensi berkas, coaching dan audit harus ditetapkan pemilik data sebelum produksi.

## 11. Skenario penerimaan lintas fitur

| ID | Skenario | Hasil yang wajib |
|---|---|---|
| UAT-01 | Pengguna SDM membuka alamat/API Keamanan tanpa izin | Ditolak, bukan sekadar menu disembunyikan |
| UAT-02 | Pengguna punya izin lihat pegawai seluruh unit dan coaching unit tertentu | Izin pegawai tidak memperluas akses coaching |
| UAT-03 | Akun dinonaktifkan atau role dicabut saat sesi masih aktif | Permintaan berikutnya ditolak sesuai perubahan |
| UAT-04 | Pegawai tanpa akun dipilih sebagai peserta atau petugas | Berhasil tanpa membuat akun otomatis |
| UAT-05 | Versi SOP baru diaktifkan | Pembaca SDM dan Keamanan melihat versi sama; versi lama tetap tersedia bagi pengelola berizin |
| UAT-06 | Pegawai berpindah unit | Riwayat sebelumnya tetap tersimpan; dashboard tanggal acuan tidak menghitung ganda |
| UAT-07 | Pengguna satu unit mencoba mengunduh coaching rekan melalui tautan langsung | Ditolak bila bukan pihak yang diizinkan |
| UAT-08 | Jadwal memuat shift 22.00–06.00 dan tugas berikutnya terlalu dekat | Konflik terdeteksi memakai interval aktual lintas tanggal |
| UAT-09 | Penyesuaian 10–12 selesai | Tanggal 13 mengikuti fase anchor semula; bukan fase hari pertama; jeda setelah tugas tanggal 12 tetap diperiksa |
| UAT-10 | Jadwal dibuat ulang dengan penugasan terkunci | Penugasan tetap sama; konflik baru ditandai dan tidak diloloskan |
| UAT-11 | Petugas kurang dari kebutuhan | Draf menunjukkan kekurangan; tidak membuat penugasan ilegal; publikasi mengikuti kebijakan DEC-08. Bila usulan pengakuan kekurangan dipilih, alasan penerbit berizin wajib terisi |
| UAT-12 | Periode berikutnya sudah terbit | Generator memeriksa tugas periode sebelum dan sesudah; konflik tidak boleh dipublikasikan |
| UAT-13 | Master shift/pola berubah setelah publikasi | Jadwal historis tetap sama; perubahan hanya melalui revisi atau versi master baru |
| UAT-14 | Dua pengguna menerbitkan revisi cakupan sama bersamaan | Hanya satu revisi berlaku; pengguna lain menerima konflik versi dan harus memuat ulang |
| UAT-15 | Permintaan pembuatan kejadian terkirim ulang | Permintaan yang sama hanya membentuk satu kejadian; temuan lain dari logbook yang sama tetap dapat dibuat sebagai kejadian berbeda |
| UAT-16 | Kejadian diselesaikan lalu dibuka kembali | Catatan hasil dan alasan pembukaan kembali tetap terlihat dalam riwayat |
| UAT-17 | Draf pola dibuat hanya sampai akhir penyesuaian | Periode lanjutan tetap menggunakan anchor asli ketika dibuat kemudian |
| UAT-18 | Petugas ditandai tidak tersedia pada tanggal tertentu | Tidak dijadwalkan pada interval bertabrakan; tidak terbentuk pengajuan cuti/izin |
| UAT-19 | Dua koordinator menerbitkan cakupan berbeda tetapi memakai petugas sama pada waktu bertabrakan | Publikasi kedua ditolak; validasi dan penguncian mencakup petugas, bukan hanya periode/cakupan |
| UAT-20 | Pegawai tertaut akun dinonaktifkan | Sesuai usulan DEC-12, akses akun tertaut ditolak pada permintaan berikutnya; data historis tetap tersimpan |
| UAT-21 | Draf revisi menyalin jadwal terbit tanpa perubahan | Tidak timbul bentrok palsu dengan versi yang digantikan; penugasan periode lain tetap diperiksa |
| UAT-22 | Koordinator pos berbeda membuat periode pada tanggal sama | Diperbolehkan bila set pos terpisah; revisi satu periode tidak menghapus atau mengganti jadwal periode lain |

## 12. Urutan implementasi

1. **Fondasi:** identitas, sesi, role/izin/cakupan, audit, file privat, unit, posisi, pegawai dan penempatan.
2. **SDM:** dokumen berversi, pelatihan, coaching dan dashboard SDM.
3. **Operasional Keamanan:** kelompok/pos, logbook, laporan kejadian dan akses SOP.
4. **Penjadwalan:** konfigurasi shift/pola/aturan, kebutuhan, generator draf, penyesuaian, penguncian, revisi dan publikasi.
5. **Penyelesaian rilis:** dashboard Keamanan, uji akses lintas modul, uji jadwal batas periode, pemulihan backup dan UAT pengguna.

Urutan ini tidak mengubah cakupan MVP. Integrasi modul memakai data bersama sejak awal, bukan menyalin profil pegawai atau dokumen ke tabel terpisah.

## 13. Ukuran keberhasilan dan syarat rilis

Ukuran penggunaan yang dipantau: kelengkapan data pegawai wajib, jumlah dokumen berlaku, pelatihan yang tercatat, tindak lanjut coaching terbuka/selesai, waktu menyusun jadwal, jumlah revisi manual, slot kekurangan, dan umur kejadian terbuka. Target adopsi ditetapkan setelah data awal tersedia.

Syarat rilis:

- Seluruh kebutuhan MVP dan skenario UAT kritis lulus.
- Hak akses telah diuji dengan akun SDM, koordinator dan petugas yang berbeda cakupan.
- Parameter jadwal wajib telah disepakati dan dikonfigurasi.
- Data awal dipetakan dan diperiksa oleh pemilik fungsi sebelum digunakan.
- Tidak ada pelanggaran penugasan pada jadwal terbit; kebijakan kekurangan DEC-08 telah dipilih dan diterapkan. Jika publikasi dengan kekurangan diperbolehkan, pengakuan dan alasan wajib tersimpan.
- Riwayat revisi, dokumen dan kejadian dapat ditelusuri.
- Backup berhasil dipulihkan pada uji pra-rilis.

## 14. Keputusan yang perlu ditetapkan sebelum implementasi/produksi

| ID | Keputusan | Usulan / status |
|---|---|---|
| DEC-01 | Username, pembuat akun dan saluran pemulihan | Usulan username + password, reset dibantu administrator; konfirmasi prosedur identifikasi |
| DEC-02 | Matriks role, cakupan unit/wilayah dan akses coaching | Nama role merupakan usulan; kepala fungsi menetapkan pemilik izin |
| DEC-03 | Bidang profil wajib, jenis kontrak dan data sensitif | Konfirmasi daftar minimum dan retensi |
| DEC-04 | Siapa mengaktifkan versi SOP | Usulan pengelola dokumen berizin, tanpa approval bertingkat |
| DEC-05 | Siapa melihat coaching dan siapa memperbarui tindak lanjut | Usulan pembimbing/pihak terkait dengan izin dan pengelola coaching khusus |
| DEC-06 | Jam shift, rotasi, anchor, hari libur, batas jam kerja dan jeda | Belum ada nilai operasional; wajib sebelum publikasi jadwal |
| DEC-07 | Kebutuhan pos dan pertukaran petugas antarwilayah/kelompok | Konfirmasi kelayakan; tidak diasumsikan saling menggantikan |
| DEC-08 | Penerbit jadwal dan kebijakan menerbitkan kekurangan | Usulan koordinator berizin dengan alasan wajib; dapat dipilih memblokir seluruh kekurangan |
| DEC-09 | Batas periode revisi yang boleh diubah | Usulan tugas yang sudah mulai/selesai tidak diubah lewat generator; koreksi historis diaudit terpisah |
| DEC-10 | Pembukaan kembali kejadian | Usulan koordinator berizin dengan alasan wajib |
| DEC-11 | Ukuran/jenis berkas, retensi, hosting dan target layanan | Tetapkan sebelum produksi; target nonfungsional masih usulan |
| DEC-12 | Akses akun setelah pegawai nonaktif | Usulan akses akun tertaut langsung ditolak; akses mantan pegawai, jika dibutuhkan, perlu kebijakan terpisah |

Seluruh keputusan tersebut dapat ditetapkan tanpa menambah menu cuti/izin, KPI, kalender kegiatan atau approval bertingkat ke dalam MVP.
