# Validasi pengembangan — 6 November 2026

Lingkungan: Node 24.20.0, PostgreSQL melalui PGlite. Seluruh data pengujian sintetis.

## Lolos

- 81 tes pada `attendance`, `attendance-frontend`, `cloudflare-auth`, `leave-special`, `merchandise-report-xlsx`, `navigation-performance`, dan `role-permissions`.
- Skema dipasang pada fixture PostgreSQL berisi migrasi portal yang sudah ada; delapan tabel absensi mengaktifkan RLS, akses langsung anon/authenticated/service_role ditolak.
- Koordinat dan radius seed, default nonaktif, jadwal kosong, aktivasi organisasi/pegawai, flag penerimaan, radius/akurasi/usia GPS, identitas dari sesi, masuk sebelum keluar, jam server, idempotensi, akses bukti, koreksi, konflik sakit/kehadiran, pembatasan cakupan ekspor, serta audit.
- Hak manajer tidak diberikan otomatis; pemegang izin dengan cakupan SELF tidak dapat membaca/mengekspor rekan atau mengubah kebijakan organisasi. Pemegang izin persetujuan tetap tidak boleh menyetujui pengajuan sendiri.
- Proxy upload hanya memperbesar batas JSON untuk dua endpoint bukti absensi; CSRF tetap wajib. Respons bukti memakai private/no-store.
- UI memakai API aktual, meng-escape data pegawai, menyembunyikan tab pengelolaan tanpa izin, dan menolak respons lama setelah sesi/halaman berubah.
- Backend hasil build dapat dijalankan untuk endpoint kesiapan; setelah sisipan absensi dilepas, hash seluruh gateway sama persis dengan snapshot live v30. Tes handler cuti dari bundle tetap lolos.
- Build frontend berhasil. Asset absensi termuat dan URL logo merchandise tetap benar saat dibundel. Pemeriksaan diff memperhitungkan konvensi CRLF berkas lama.
- Delapan pemeriksaan PWA tanpa server lokal lolos pada percobaan suite PWA.

## Belum terverifikasi

- Satu tes PWA yang membuka server localhost gagal karena lingkungan menolak koneksi `127.0.0.1` dengan `EACCES`; tidak ada perubahan pada handler PWA/server untuk mengakali tes tersebut.
- Browser headless belum tersedia. Percobaan Chromium/Edge melalui Playwright tidak menemukan executable. Pemeriksaan visual, izin kamera/GPS, dan uji perangkat kantor masih harus dilakukan pada lingkungan browser yang tersedia.
- Migrasi belum dijalankan di Supabase, flag aktivasi belum diubah, role belum ditugaskan, dan kode belum digabungkan/dideploy ke produksi.
- Pembersihan fisik bukti kedaluwarsa di Drive, penetapan jadwal/shift sebenarnya, dan kebijakan operasional masih menjadi pekerjaan sebelum go-live. Detail pada README.

Perintah suite terfokus:

```sh
node --test tests/attendance.test.mjs tests/attendance-frontend.test.mjs tests/cloudflare-auth.test.mjs tests/leave-special.test.mjs tests/merchandise-report-xlsx.test.mjs tests/navigation-performance.test.mjs tests/role-permissions.test.mjs
```
