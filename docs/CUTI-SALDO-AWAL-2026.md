# Saldo awal cuti 2026

Impor produksi disahkan pengguna dan diterapkan pada **30 Oktober 2026, 10:02:19 WITA**: 152 pegawai aktif non-THL, total 781 hari, efektif 30 Oktober 2026 untuk tahun saldo 2026. Empat pegawai nonaktif dikecualikan; satu saldo tambahan dari pengguna melengkapi PDF. Dua koreksi nama master diterapkan dalam transaksi yang sama.

## Penyimpanan dan batas integrasi

- portal.leave_import_batches menyimpan persetujuan, hash sumber/payload, periode, dan bukti impor.
- portal.leave_import_rows menyimpan 156 keputusan: 155 baris PDF dan satu tambahan pengguna, termasuk empat pengecualian.
- portal.leave_year_balances menyimpan saldo per pegawai/tahun; portal.leave_balance_events menyimpan 152 kejadian pembukaan.
- portal.leave_effective_balances menegakkan periode berlaku dan menampilkan nol untuk pegawai nonaktif atau THL, walaupun proses pemeliharaan belum berjalan.
- Seluruh tabel baru memakai RLS dan tanpa akses langsung bagi anon, authenticated, maupun service_role; view memakai security_invoker. Fungsi privat juga tanpa akses panggil bagi role aplikasi.
- Belum ada endpoint, menu, dashboard, atau alur pengajuan modul Cuti yang diterbitkan dalam pekerjaan impor ini. Data saldo sudah tersimpan di database produksi; integrasi UI/API mengikuti pekerjaan modul Cuti selanjutnya.

## Aturan tahunan yang diaktifkan

portal.run_leave_year_maintenance() memakai tanggal bisnis Asia/Makassar. Job leave-year-maintenance aktif setiap jam (0 * * * *) sebagai postgres, dengan batas waktu 30 detik dan tanpa HTTP/token.

- Tidak ada tambahan 12 hari pada impor 2026, dan tidak ada kredit Januari 2026 secara retroaktif.
- Mulai 1 Januari 2027, pegawai aktif dengan status terverifikasi non-THL menerima 12 hari dalam bucket tahun baru. Pengulangan pada 1 Januari tidak menggandakan hak; primary key pegawai/tahun dan event key memastikan keunikan.
- Sisa 2026 berlaku sampai 31 Maret 2027 dan kedaluwarsa pada 1 April 2027 pukul 00.00 WITA. Pemeliharaan menutup bucket lama dan mencatat hanya sisa yang belum terpakai sebagai kedaluwarsa.
- Pembacaan view sudah menegakkan kedaluwarsa tepat pada batas hari WITA, meski pemeliharaan belum berjalan.
- Status yang saat ini terverifikasi adalah PKWT, Probation, dan THL. Status baru yang tidak dikenal menghentikan kredit untuk ditinjau SDM. Pegawai baru setelah 1 Januari, perubahan status, serta pemulihan kredit jika scheduler gagal sepanjang hari 1 Januari memerlukan penanganan SDM; aturan prorata/riwayat status tidak ditebak.

## Validasi

14 pemeriksaan integrasi pada PostgreSQL lokal terpisah lulus, meliputi izin/RLS, stale master, rollback seluruh batch termasuk nama, impor ulang, konflik payload, THL, nonaktif, saldo nol, kredit Januari, batas WITA, dan kedaluwarsa sisa yang belum terpakai. Uji tanggal masa depan dibatalkan di database uji, tidak dijalankan di produksi.

Pemeriksaan produksi memastikan seluruh 152 ID/saldo sama dengan preview; 781 hari tersedia pada tanggal impor, tidak ada saldo 2027, dua perubahan nama tepat, tiga audit impor/koreksi tercatat, serta fingerprint akun dan penempatan tidak berubah. Pemeliharaan dijalankan pada tanggal aktual dan mengembalikan nol kredit/nol kedaluwarsa. Job terdaftar aktif; tidak dilakukan simulasi tanggal masa depan di produksi.

Migrasi produksi dan lokal selaras:

- 20261030020112_leave_balances_and_annual_maintenance.sql
- 20261030020230_enable_leave_year_maintenance_cron.sql

SQL impor dengan nama/ID pegawai, snapshot sebelum/sesudah, persetujuan, hasil uji, dan bukti impor tersimpan privat pada data/imports/cuti-20261030/ yang diabaikan Git. Data individu tidak ditanamkan ke migrasi, aset publik, atau dokumentasi ini.

Pengujian ulang pada cluster lokal khusus yang baru:

    python scripts/verify-leave-balances-postgres.py --import-dir data/imports/cuti-20261030 --database leave_verify

Siapkan database baru bernama leave_verify pada cluster uji khusus sebelum menjalankan perintah di atas. Script membatasi koneksi ke loopback dan menolak cluster selain direktori uji khusus. Fixture dan nilai koreksi nama dibaca dari paket privat, tanpa nama/ID pegawai di source pengujian. Impor yang sama dapat dikirim ulang dengan aman; payload berbeda untuk batch yang sama ditolak, dan saldo tidak ditimpa.

Dokumentasi scheduler: [Supabase Cron](https://supabase.com/docs/guides/cron), [instalasi pg_cron](https://supabase.com/docs/guides/cron/install).
