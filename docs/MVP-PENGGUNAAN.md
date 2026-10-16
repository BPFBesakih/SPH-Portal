# Penggunaan modul tambahan MVP

Pembaruan: 16 Oktober 2026.

## Memuat perubahan

1. Pada terminal server yang sedang berjalan, tekan `Ctrl+C`.
2. Jalankan kembali server dengan direktori data yang sama. Untuk demo Windows gunakan `./scripts/start-demo.ps1`, atau ulangi perintah menjalankan demo pada README.
3. Muat ulang browser menggunakan `Ctrl+F5`.

Database dimigrasikan otomatis ke versi 3 saat server dibuka. Laporan, temuan, tindakan awal historis, lampiran, dan riwayat penanganan lama dipertahankan. Untuk instalasi operasional, lakukan backup menggunakan versi aplikasi yang sedang berjalan sebelum mengganti kode, kemudian hentikan aplikasi, pasang kode baru, dan mulai kembali. Panduan Docker/HTTPS tersedia pada [DEPLOYMENT.md](DEPLOYMENT.md).

## Informasi Internal

- Menu tersedia untuk seluruh akun yang aktif dan telah menyelesaikan pergantian password awal.
- Admin/SDM dapat memilih **Buat pengumuman**, mengisi judul, kategori, prioritas, dan masa tayang opsional.
- Gunakan **Tambah paragraf** dan **Sisipkan gambar** untuk menyusun teks serta gambar di antara paragraf. Tersedia tombol memindahkan urutan dan menghapus bagian.
- Gambar mendukung JPG/PNG maksimal 10 MB per berkas. Lampiran PDF/DOCX/XLSX/JPG/PNG dapat ditambahkan terpisah, maksimal 10 lampiran.
- Periksa **Pratinjau**, lalu pilih **Simpan draf** atau **Simpan & terbitkan**.
- Detail pengumuman menyediakan pengubahan isi, sematan, penerbitan, dan arsip untuk Admin/SDM.
- Seluruh pegawai dapat mencari judul/isi, memfilter kategori, membaca arsip yang pernah terbit, memperbesar gambar, serta menekan **Tandai sudah dibaca**.
- Status baca dicatat per akun dan versi isi. Perubahan isi memunculkan penanda belum dibaca kembali; perubahan sematan tidak menghapus status baca.
- Ringkasan tiga pengumuman dan jumlah belum dibaca tersedia pada dashboard. Lonceng dan menu Informasi Internal juga menampilkan jumlah belum dibaca saat halaman dimuat.
- Draf serta pengumuman terjadwal sebelum mulai tayang, termasuk gambar dan lampirannya, hanya tersedia bagi Admin/SDM. Akhir tayang memindahkan pengumuman ke tampilan Arsip.

## Logbook & Patroli

1. Masuk menggunakan akun security yang terhubung ke profil pegawai aktif. Akun `petugas.demo` dapat dipakai untuk mencoba formulir pada database demo.
2. Pilih **Catat kegiatan**. Nama petugas otomatis diambil dari akun.
3. Pilih **Ambil lokasi** dan berikan izin lokasi. Hasilnya berupa koordinat, akurasi, dan waktu pengambilan.
4. Periksa waktu kegiatan WITA, pilih jenis kegiatan, lalu isi uraian. Teks contoh membantu menjelaskan kegiatan, temuan, dan tindakan.
5. Pilih **Buka kamera**, berikan izin kamera, kemudian **Ambil foto**. Periksa pratinjau; hapus foto dan ambil ulang jika perlu. Satu laporan memerlukan 1–5 foto.
6. Pilih **Kirim laporan**. Tombol baru aktif setelah lokasi dan foto tersedia. Server memeriksa syarat tersebut kembali.

Jika lokasi ditolak atau gagal, pengiriman tetap diblokir. Aktifkan layanan lokasi pada perangkat dan izinkan lokasi melalui pengaturan situs browser, kemudian coba lagi. Jika kamera gagal, periksa izin kamera dan pastikan tidak sedang dipakai aplikasi lain. Kamera dihentikan saat ditutup atau saat formulir ditutup.

Bukti lokasi dan foto memiliki batas umur 15 menit saat dikirim. Ambil bukti kembali bila formulir dibiarkan terbuka terlalu lama. Foto dikompresi menjadi JPEG dengan sisi terpanjang maksimal 1.600 piksel sebelum diunggah. Koordinat diambil satu kali per permintaan Ambil lokasi, bukan pelacakan perjalanan petugas.

## Laporan Kejadian

Alurnya sama dengan Patroli: identitas dari akun, lokasi perangkat wajib, dan foto kamera wajib. Formulir berisi waktu kejadian, kategori, serta kronologi dengan teks contoh. Kolom **Tindakan awal** telah dihapus dari formulir baru.

Waktu kejadian dapat berbeda dari waktu pelaporan. Lokasi yang dicatat menunjukkan perangkat saat melapor. Laporan dapat dibuat dari detail logbook agar keduanya tetap terhubung. Perkembangan, penanggung jawab, penyelesaian, dan pembukaan kembali tetap dicatat pada riwayat.

## Akses dari HP

Gunakan URL aplikasi **HTTPS** untuk kamera dan lokasi melalui jaringan. Alamat HTTP seperti `http://192.168.x.x:3000` belum mencukupi untuk fitur perangkat ini. `localhost`/`127.0.0.1` merupakan pengecualian untuk pengembangan pada perangkat yang menjalankan server; alamat itu pada HP menunjuk HP sendiri.

Reverse proxy harus mempertahankan izin kamera/geolokasi untuk origin aplikasi. Tidak diperlukan layanan peta, pencocokan radius pos, paket npm tambahan, atau izin mikrofon.

Kamera aplikasi, pemeriksaan waktu, dan lokasi membantu verifikasi pelaporan. Browser tidak dapat memberikan jaminan mutlak terhadap rekayasa sumber kamera atau lokasi perangkat. Uji kamera belakang, izin ditolak, lokasi gagal, pengambilan ulang foto, serta pengiriman pada HP Android/iOS yang akan digunakan petugas sebelum dipakai operasional.

## Pengujian

```powershell
npm.cmd test
```

Atau:

```powershell
node --test tests/*.test.mjs
```

Pengujian tambahan berada pada `tests/mvp.test.mjs`, mencakup hak penerbit, publikasi/masa tayang, berkas privat, status baca, validasi bukti, identitas pelapor, transaksi penyimpanan, cakupan laporan, retry, dan migrasi data lama.
