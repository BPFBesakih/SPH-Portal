# Laporan penjualan bulanan

Menu **Merchandise → Laporan → Ekspor Penjualan Bulanan** mengikuti tata letak
Excel resmi penjualan yang diberikan pada 6 November 2026: kop dan logo asli,
rekap pendapatan/modal/laba, penjualan per barang, metode pembayaran, serta
area tanda tangan. Urutan sheet: MASTER, tanggal yang dipilih, MASTER AKHIR.
MASTER merupakan template kosong, sedangkan MASTER AKHIR berisi rekap periode.

Sebelum ekspor, pilih **Excel acuan penjualan** pada halaman yang sama. Gunakan
file laporan resmi yang mempunyai sheet per tanggal (misalnya file Oktober).
Kop, logo, nama penandatangan, dan tata letak area tanda tangan dibaca langsung
di browser, tanpa diunggah ke server atau dimasukkan ke repository publik.
Template hanya diingat selama halaman portal masih terbuka. Setelah memuat
ulang portal, pilih file acuan kembali. Angka transaksi dalam file acuan
tidak digunakan sebagai data laporan atau disimpan sebagai template.

Pilih tanggal dalam satu bulan, mulai 1 November 2026 sampai hari ini.
Riwayat sebelum November belum diimpor; file contoh Oktober hanya menjadi
acuan tata letak dan tidak dimasukkan ke database oleh perubahan ini.

Hanya transaksi COMPLETED pada periode terpilih yang dihitung. Transaksi VOID
tidak masuk omzet, modal, jumlah barang maupun rekap pembayaran. Harga modal
memakai snapshot unit_cost masing-masing transaksi; omzet memakai subtotal
yang tersimpan, termasuk bila harga barang berubah dalam periode yang sama.
Barang yang tidak terjual tetap tercantum. Produk historis yang sudah tidak
ada dalam katalog tetap disertakan berdasarkan SKU transaksi.

Bagian III METODE PEMBAYARAN (sejak 20 November 2026): 1 TUNAI, 2 NON TUNAI
(QRIS), 3 TRANSFER, 4 CARD, lalu 5 LAINNYA hanya bila digunakan pada periode itu.
TRANSFER dan CARD tetap tampil walau nol. Total pembayaran sama dengan pendapatan.
Template resmi hanya memiliki dua baris pembayaran; setiap baris tambahan
menggeser JUMLAH pembayaran, blok tanda tangan, dan gambar di bawahnya ke bawah.
File resmi asli dan hasil ekspor portal dapat digunakan sebagai acuan. Posisi
gambar dari hasil ekspor dikembalikan ke tata letak dasar sebelum menyesuaikan
jumlah barang dan metode pembayaran pada laporan baru.
Rekap mengenali penanda “pembayaran CARD (kategori lainnya)” pada transaksi
impor 1–7 November 2026. Metode asli tetap tersimpan dalam riwayat database.
Rata-rata per hari membagi jumlah barang dengan seluruh hari kalender dalam
periode terpilih, termasuk hari tanpa penjualan.

Ekspor memerlukan merchandise.reports.export. Angka modal/laba dan rumusnya
hanya diisi bila pengguna memiliki merchandise.catalog.costs. Data katalog
dan transaksi asli, termasuk harga, tidak disimpan dalam template publik.
Rumus #REF! tersembunyi dari file acuan tidak disalin. Total, laba, dan rekap
antarlembar mempunyai rumus dan cached values untuk pembaca XLSX.

Seluruh pembuatan XLSX berlangsung di browser. File acuan dibatasi 20 MB,
menolak relasi eksternal, enkripsi, format arsip yang tidak didukung, gambar
selain PNG, serta arsip rusak/terlalu besar. Perlu browser yang mendukung
DecompressionStream untuk membaca template XLSX terkompresi.
Tombol mengambil ulang laporan
dan mencocokkan rinciannya dengan ringkasan server agar ekspor yang terpotong
atau berubah ditolak. Backend/database dan fitur ekspor stok tetap digunakan
seperti sebelumnya. Build frontend menyalin modul public ke site-info/dist/app.

Verifikasi: node --test tests/merchandise-sales-*.test.mjs tests/merchandise-report-xlsx.test.mjs
