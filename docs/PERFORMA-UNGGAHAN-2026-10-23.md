# Percepatan unggahan portal dan formulir publik

Unggahan PDF, JPEG/PNG, DOCX dan XLSX dari portal dikirim sebagai byte asli ke endpoint yang sama. Browser tidak lagi membuat string base64 besar; transfer ini sekitar 25% lebih kecil daripada base64 JSON untuk berkas yang sama. Cloudflare mengubah stream berbatas 10 MB menjadi format internal backend. Isi dan checksum berkas tidak berubah. Klien JSON yang sudah terbuka tetap didukung.

Jalur biner hanya diterima pada POST /api/uploads, dengan metadata nama/MIME yang dibatasi. Pemeriksaan origin, cookie privat, CSRF, perubahan password wajib, identitas, lease sesi, izin unggah, tanda tangan berkas, serta cakupan objek lampiran tetap dijalankan. Tidak ada kunci penyimpanan atau folder tujuan dari browser. Respons dan data privat tetap no-store.

Pemeriksaan penggunaan ID berkas pada seluruh jenis lampiran digabung dalam satu query UNION ALL; kepemilikan dan larangan memakai ulang berkas tetap sama. Izin unggah dihitung satu kali untuk tiap permintaan.

Koneksi Drive memakai ulang token OAuth yang sudah selesai diterima hanya di memori isolate server sampai sebelum expires_in (buffer 60 detik, maksimal satu jam). Cache dibatasi empat konfigurasi dan dipisahkan oleh hash konfigurasi. Promise atau respons jaringan tidak dibagikan antarpermintaan. Kesalahan 401 membuang token cache; unggahan tidak dikirim ulang otomatis agar tidak membuat duplikasi.

Respons pembuatan berkas meminta metadata privat yang diperlukan sekaligus. Parent, MIME, status, serta penanda aplikasi/modul diverifikasi sebelum unggahan dianggap berhasil. Finalisasi tidak membaca ulang metadata file baru yang baru diverifikasi dalam permintaan yang sama. File lama dan unduhan tetap diperiksa kembali. Rollback tetap hanya menghapus file yang dibuat permintaan tersebut.

Backend portal-api dan coaching-native ditambal dari source aktifnya; perubahan tidak mengubah schema, secret, akun, batas 10 MB atau format dokumen. Foto formulir publik tetap memakai validasi bukti dan idempotensi yang sama.

## Verifikasi

- 191 tes otomatis lulus, termasuk keutuhan byte pada batas stream arbitrer, metadata/ukuran berkas, CSRF/sesi/password, token kedaluwarsa/dicabut/rotasi konfigurasi, validasi metadata Drive dan rollback.
- 23 pemeriksaan PostgreSQL portal, 7 pemeriksaan laporan Keamanan, dan 6 pemeriksaan Coaching native lulus dengan bundel akhir.
- 28 pemeriksaan browser portal dan 8 pemeriksaan Pengadaan lulus. Unggahan PDF PR dan nota diuji melalui server HTTP nyata dengan data fiktif.
- Pada fixture lima foto patroli langsung ke folder modul, komunikasi penyimpanan turun dari 17 menjadi 7 request. Angka tersebut bukan waktu unggah produksi; durasi nyata tetap bergantung koneksi, ukuran berkas dan layanan Drive.

Tidak membuat laporan, akun atau lampiran percobaan pada produksi. Pemeriksaan produksi memeriksa paket aset, endpoint tanpa sesi serta kesehatan layanan. Bukti dan snapshot rollback ada di test-results/quick-report-deploy-20261023.
