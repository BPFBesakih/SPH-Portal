// Panduan penggunaan di sidebar. Isinya disusun di browser dari menu yang memang
// tampil untuk akun yang sedang masuk, sehingga tiap pegawai hanya membaca bagian
// yang relevan. Tidak ada permintaan ke server; semua teks statis di berkas ini.
import {icon} from './ui.js';

const MODULE_ICONS={hr:'people',security:'shield',purchasing:'building',merchandise:'folder',visits:'calendar',humas:'document'};

// Satu penjelasan singkat per menu. Kunci = rute menu di sidebar.
export const ROUTE_HELP={
  // Menu umum
  announcements:'<strong>Informasi Internal</strong> — pengumuman resmi BP Besakih. Buka pengumuman, lalu tekan <strong>Tandai sudah dibaca</strong>. Jumlah yang belum dibaca tampil di menu dan di lonceng.',
  briefings:'<strong>Briefing Pagi</strong> — lihat rekap sesuai akses Anda. Tombol <strong>Isi briefing pagi</strong> tersedia jika akun terhubung ke pegawai dengan satu penempatan utama aktif. Jika penempatan perlu diperbarui, hubungi SDM. Pada formulir, isi tanggal, pemberi briefing, pegawai yang tidak hadir (isi Nihil bila semua hadir), materi dan kendala, lalu ambil satu foto.',
  leaves:'<strong>Cuti</strong> — kalender mengikuti akses akun Anda, termasuk untuk THL. Tombol <strong>Ajukan cuti</strong> tersedia bagi pegawai aktif yang berhak cuti dan memiliki jalur persetujuan. Pilih jenis cuti dan rentang tanggal. Untuk cuti tahunan dan cuti khusus singkat, pilih <strong>Tampilkan tanggal</strong> lalu centang hari kerja Anda. Untuk cuti melahirkan dan keguguran, formulir menghitung seluruh hari kalender dalam rentang tersebut, termasuk hari libur. Isi alasan, pilih <strong>Periksa pengajuan</strong>, lalu <strong>Kirim ke atasan</strong>. Atasan dapat melihat pengajuan yang menunggu keputusan di lonceng dan menu Cuti.',
  attendance:'<strong>Absensi</strong> — absen harian dilakukan di HP yang sudah didaftarkan: pilih nama, tekan <strong>MASUK</strong> atau <strong>PULANG</strong>, lalu selfie; lokasi diambil otomatis. Di menu ini Anda dapat melihat catatan absen sesuai akses Anda.',
  // SDM
  dashboard:'<strong>Dashboard</strong> — ringkasan tim, kegiatan, dan pengumuman terbaru.',
  employees:'<strong>Data Pegawai &amp; Organisasi</strong> — cari dan buka profil pegawai; struktur unit dan posisi ada di bagian Organisasi. Nomor pegawai, tanggal mulai kerja, dan status harus mengikuti data resmi kepegawaian.',
  documents:'<strong>Regulasi &amp; SOP</strong> — baca dan unduh dokumen yang berlaku. Pengelola dokumen menambah dokumen, mengunggah versi berkas, lalu menekan <strong>Aktifkan versi</strong> saat tanggal berlakunya tiba; versi lama otomatis diarsipkan.',
  training:'<strong>Kegiatan &amp; Pelatihan</strong> — kalender rencana dan realisasi kegiatan. Buka kegiatan untuk melihat peserta, kehadiran, materi, sertifikat, dan dokumentasi foto.',
  coaching:'<strong>Evaluasi &amp; Coaching</strong> — catatan pendampingan pegawai beserta tindak lanjutnya. Isinya hanya dapat dibaca pihak yang berhak.',
  // Keamanan
  security:'<strong>Dashboard</strong> — gambaran operasional kawasan hari ini.',
  roster:'<strong>Jadwal &amp; Penugasan</strong> — lihat jadwal jaga yang sudah terbit. Penyusun jadwal: lengkapi dulu <strong>Pengaturan Jadwal</strong> (pos, shift, anggota, dan aturan kerja yang sudah disepakati pengelola), buat periode dan draf, tekan <strong>Susun otomatis</strong>, periksa konflik dan kekurangan, lalu <strong>Terbitkan</strong>.',
  logbook:'<strong>Logbook &amp; Patroli</strong> — tekan <strong>Catat kegiatan</strong>, ambil lokasi, isi uraian, lalu ambil 1–5 foto dari kamera. Laporan baru bisa dikirim setelah lokasi dan foto tersedia.',
  incidents:'<strong>Laporan Kejadian</strong> — laporkan kejadian dengan lokasi dan foto kamera. Perkembangan, penanggung jawab, dan penyelesaiannya tercatat di riwayat laporan.',
  sop:'<strong>SOP Keamanan</strong> — dokumen SOP yang berlaku untuk petugas keamanan.',
  // Pengadaan
  purchasing:'<strong>Beranda</strong> — ringkasan PR dan tugas yang sedang menunggu Anda.',
  'pr-mine':'<strong>Pengajuan Saya</strong> — buat PR (boleh banyak barang, lampiran per barang) dan ikuti statusnya. PR yang dikembalikan dapat direvisi; PR dapat dibatalkan sebelum nomornya terbit.',
  'pr-approvals':'<strong>Persetujuan</strong> — PR yang menunggu keputusan Anda. Urutannya: diketahui atasan → verifikasi Keuangan (Pos RKA) → disetujui Sekban atau Kaban.',
  'pr-queue':'<strong>Antrean Purchasing</strong> — periksa kelengkapan, bandingkan harga, terbitkan PO/SPK atau surat penunjukan, lalu catat pembelian dan serah terima beserta nota vendor.',
  'pr-all':'<strong>Semua PR</strong> — seluruh PR dalam cakupan akses Anda.',
  vendors:'<strong>Vendor</strong> — data vendor untuk PO, SPK, dan surat penunjukan.',
  budget:'<strong>Pos RKA</strong> — pagu, komitmen, realisasi, dan sisa anggaran tiap pos.',
  'purchasing-reports':'<strong>Laporan</strong> — rekap PR dalam cakupan akses Anda beserta ekspornya.',
  'purchasing-settings':'<strong>Pengaturan</strong> — batas nilai, pejabat, penomoran, kop dokumen, dan Plh. Setiap perubahan tercatat.',
  // Bisnis
  merchandise:'<strong>Beranda</strong> — penjualan hari ini, barang yang total stoknya (display + gudang) 5 atau kurang, dan barang yang display-nya perlu diisi dari gudang.',
  'merchandise-products':'<strong>Daftar Barang</strong> — katalog, harga, serta stok <strong>display</strong> dan <strong>gudang</strong>. Tombol <strong>Stok</strong> untuk stok awal, barang masuk (ke gudang atau display), pindah gudang ↔ display, dan koreksi saldo. Barang titipan berlabel <strong>UMKM</strong>; stoknya hanya bisa dipindah atau dikoreksi di sini.',
  'merchandise-umkm':'<strong>Barang UMKM</strong> — barang titipan UMKM lokal. Koordinator ke atas mendaftarkan mitra, mencatat <strong>Terima barang</strong> (harga UMKM + 20%, dibulatkan, menjadi harga jual) dan <strong>Takeout</strong>, lalu mencetak tanda terima atau bukti takeout untuk ditandatangani. Keuangan membayar UMKM dari Ekspor Penjualan Bulanan.',
  'merchandise-sales':'<strong>Penjualan</strong> — catat setiap transaksi dan pilih pembayaran: Tunai, QRIS, Transfer, Card, atau Lainnya. Stok display berkurang otomatis; bila display kurang, catat dulu <strong>Pindah ke display</strong> dari gudang.',
  'merchandise-stock':'<strong>Stok Barang</strong> — riwayat semua perubahan stok per lokasi (display/gudang): stok awal, barang masuk, pindah stok, penjualan, takeout barang UMKM, dan koreksi. Koreksi saldo hanya oleh yang berwenang.',
  'merchandise-reports':'<strong>Laporan</strong> — rekap penjualan dan metode pembayaran per periode, serta ekspor Excel bulanan (stok display dan gudang dipisah). Barang UMKM punya bagian sendiri: hak UMKM per mitra dan keuntungan BP.',
  // Kunjungan
  visits:'<strong>Dashboard</strong> — ringkasan penilaian guide bulan berjalan.',
  'visits-guides':'<strong>Data Guide</strong> — daftar guide beserta kategori dan regunya.',
  'visits-records':'<strong>Penilaian</strong> — penilaian pengantaran yang dikirim petugas pos.',
  'visits-flags':'<strong>Verifikasi</strong> — periksa laporan pelanggaran berat dan apresiasi dari pos. Pelanggaran berat yang disetujui menggugurkan reward guide pada bulan itu.',
  'visits-links':'<strong>Tautan Pos</strong> — satu tautan aktif per pos. Buka tautan itu sekali di HP pos; petugas pos tidak perlu login.',
  'visits-scoring':'<strong>Aturan Nilai</strong> — nilai pengantaran = 100 − potongan + Etika. Perubahan aturan berlaku mulai bulan berikutnya.',
  'visits-reports':'<strong>Laporan &amp; Ekspor</strong> — pilih laporan <strong>Harian</strong>, <strong>Mingguan</strong>, atau <strong>Bulanan</strong>, lalu tentukan periodenya. Setiap laporan memuat perbandingan dengan periode sebelumnya, grafik tren, dan <strong>Ekspor Excel</strong>. Status reward hanya ada di laporan bulanan.',
  // Humas · E-Arsip
  archives:'<strong>Ringkasan</strong> — arsip terbaru dan hal yang perlu ditindaklanjuti.',
  'archive-list':'<strong>Daftar Arsip</strong> — cari arsip, lalu buka detail, pratinjau, atau unduh sesuai hak Anda.',
  'archive-new':'<strong>Tambah Arsip</strong> — unggah dokumen dan isi datanya; nomor agenda dibuat otomatis. Arsip baru langsung aktif sebagai <strong>Biasa</strong>. Untuk dokumen sensitif, minta Humas mengubahnya menjadi <strong>Rahasia</strong>.',
  'archive-reports':'<strong>Laporan</strong> — buku agenda dan rekap arsip per periode.',
  'archive-requests':'<strong>Pengajuan Hapus</strong> — permintaan hapus arsip yang menunggu keputusan Humas.',
  'archive-types':'<strong>Jenis Dokumen</strong> — daftar jenis dokumen yang dipakai saat mengarsipkan.',
  'archive-deleted':'<strong>Arsip Dihapus</strong> — arsip yang sudah disembunyikan dan masih dapat dipulihkan.',
  'archive-officers':'<strong>Petugas Arsip</strong> — penetapan petugas arsip tiap bagian.',
  // Pengaturan akses
  accounts:'<strong>Akun Pengguna</strong> — buat akun, hubungkan ke data pegawai, atur role dan cakupannya, serta reset password.',
  roles:'<strong>Role &amp; Izin</strong> — atur tindakan yang boleh dilakukan tiap role.',
  audit:'<strong>Riwayat Aktivitas</strong> — 500 aktivitas terbaru; riwayat ini tidak dapat diubah.'
};

// Catatan tambahan per modul, ditampilkan bila modulnya tersedia untuk akun.
const MODULE_NOTES={
  purchasing:'Dokumen cetak (PR, PO, SPK) memiliki kode QR. Pindai kodenya untuk memeriksa keaslian dokumen.'
};

const items=routes=>routes.filter(route=>ROUTE_HELP[route]).map(route=>`<li>${ROUTE_HELP[route]}</li>`);

function section(title,ico,lines,{open=false,badge=''}={}){
  if(!lines.length)return '';
  return `<details class="help-section"${open?' open':''}><summary>${icon(ico)}<span>${title}</span>${badge?`<small>${badge}</small>`:''}</summary><ul>${lines.join('')}</ul></details>`;
}

/**
 * @param {{current:string,modules:{key:string,label:string,routes:string[]}[],common:string[],admin:string[]}} access
 *   Hanya modul dan rute yang memang tampil di sidebar akun ini.
 */
export function helpGuideHtml({current,modules=[],common=[],admin=[]}){
  const start=[
    modules.length>1?'<li>Pindah modul lewat kotak <strong>Modul kerja</strong> di bagian atas menu. Daftar menu berganti sesuai modul yang dipilih.</li>':'',
    '<li>Di HP, buka menu dengan tombol <strong>☰</strong> di kiri atas.</li>',
    '<li>Ikon <strong>lonceng</strong> di kanan atas menampilkan pemberitahuan, misalnya pengumuman baru atau pengajuan yang menunggu keputusan Anda.</li>',
    '<li class="help-theme-tip">Ikon <strong>bulan</strong> mengganti tampilan terang atau gelap.</li>',
    '<li>Portal dapat dipasang seperti aplikasi. Android (Chrome): menu <strong>⋮</strong> → <strong>Instal aplikasi</strong>. iPhone (Safari): <strong>Bagikan</strong> → <strong>Tambahkan ke Layar Utama</strong>.</li>'
  ].filter(Boolean);
  const ordered=[...modules.filter(m=>m.key===current),...modules.filter(m=>m.key!==current)];
  const moduleSections=ordered.map(m=>{
    const lines=items(m.routes);
    if(lines.length&&MODULE_NOTES[m.key])lines.push(`<li>${MODULE_NOTES[m.key]}</li>`);
    return section(m.label,MODULE_ICONS[m.key]||'folder',lines,{open:m.key===current,badge:m.key===current&&modules.length>1?'Modul aktif':''});
  });
  const account=[
    '<li><strong>Ganti password</strong>: klik foto atau inisial nama di kanan atas, lalu pilih <strong>Ganti password</strong>. Setelah itu masuk kembali dengan password baru.</li>',
    '<li>Lupa password, akun terkunci, atau menu yang Anda perlukan tidak muncul? Hubungi <strong>administrator BP Besakih</strong>. Menu yang tampil mengikuti akses akun Anda.</li>',
    '<li>Bila foto atau lokasi gagal diambil, izinkan <strong>kamera</strong> dan <strong>lokasi</strong> untuk situs ini di pengaturan browser, lalu coba lagi.</li>'
  ];
  return `<div class="help-guide"><p class="help-guide-intro">Panduan ini hanya memuat menu yang dapat Anda buka.</p>${[
    section('Mulai di sini','help',start,{open:true}),
    moduleSections[0]||'',
    section('Menu umum','bell',items(common)),
    ...moduleSections.slice(1),
    section('Pengaturan akses','key',items(admin)),
    section('Akun &amp; bantuan','key',account,{open:true})
  ].join('')}</div>`;
}
