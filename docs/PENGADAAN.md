# Modul Pengadaan (MVP pertama)

Modul Pengadaan memindahkan alur PR dari kertas ke portal: pemohon mengajukan PR dengan akun portalnya, atasan mengetahui, Keuangan memverifikasi Pos RKA, Sekban atau Kaban menyetujui, lalu Purchasing memeriksa kelengkapan, membandingkan harga, menerbitkan PO/SPK atau surat penunjukan, dan mencatat pembelian serta serah terima. Rujukan aturan: PRD Modul Pengadaan (kode aturan `ATR-*` dipakai di pesan kesalahan dan komentar kode).

## Yang termasuk MVP ini

- Pengajuan PR multi-item dengan lampiran per item (link, teks toko, atau berkas), jumlah desimal, revisi setelah dikembalikan, dan pembatalan sebelum nomor PR terbit.
- Persetujuan berurutan: Diketahui (atasan dari penempatan utama SDM) → Verifikasi (Keuangan memilih Pos RKA dan tanda anggaran khusus) → Disetujui (Sekban ≤ batas, Kaban di atas batas atau anggaran khusus). Pemohon tidak pernah menyetujui PR-nya sendiri; PR Sekban dialihkan ke Kaban; PR Kaban melewati tahap Diketahui.
- Plh per periode, pengalihan penyetuju oleh Pengelola Pengadaan, dan riwayat persetujuan yang tidak bisa diubah setelah diputuskan (trigger database).
- Pemeriksaan kelengkapan dengan saran nomor PR `nnn/PR/<kode unit>/<bulan romawi>/<tahun>` dan PIC pembelian.
- Jalur A (langsung beli, < batas perbandingan), B (minimal dua harga per item dari toko berbeda, alasan bila bukan termurah, pesanan dikelompokkan per vendor), dan C (surat penunjukan yang disetujui Kaban sekaligus menerbitkan PO/SPK).
- Konfirmasi ulang harga: kenaikan berapa pun → pemohon setuju atau membatalkan item → Keuangan verifikasi ulang → Kaban menyetujui ulang bila total melewati batas Sekban.
- PO/SPK dengan volume hitung, termin, ketentuan penagihan, nomor otomatis terpisah (`nnn/PO|SPK|SPV/PURCHASE/<romawi>/<tahun>`), nomor manual terakhir agar urutan berlanjut, dan tenggat.
- Pembelian, serah terima dengan nota vendor wajib, dan PR selesai otomatis bila semua pesanan diterima.
- Dokumen final (PR, PO, SPK, surat penunjukan) dibekukan sebagai snapshot dengan hash SHA-256 dan kode verifikasi; halaman cetak berkop dengan QR yang membuka halaman verifikasi di portal (perlu masuk).
- Pos RKA per tahun dengan komitmen, realisasi, dan sisa pagu; daftar vendor dengan NIK/rekening tersamar bagi yang tidak berizin; laporan dan ekspor CSV untuk SPI.

Belum termasuk (fase berikutnya): SPJ (nota pesanan, kwitansi, BAST), PPV/PPB dan pembayaran, kode penutup audit SPI dan pengingat harian terjadwal, serta keputusan terbuka di PRD (mis. penyetuju PR Kaban di atas batas Sekban — aplikasi menolak dengan pesan yang jelas sampai diputuskan).

## Role template

Migrasi membuat lima role baru tanpa memberikannya ke akun mana pun. Role lama (termasuk `SUPER_ADMIN` dan `EMPLOYEE`) tidak berubah.

| Kode | Nama | Izin utama | Cakupan yang disarankan |
| --- | --- | --- | --- |
| `PURCHASE_REQUESTER` | Pemohon Pengadaan | `purchasing.requests.create`, `purchasing.requests.read` | Data sendiri |
| `PURCHASING_STAFF` | Staf Purchasing | proses pengadaan, vendor (termasuk data sensitif), baca Pos RKA dan laporan | Seluruh organisasi |
| `FINANCE_VERIFIER` | Verifikator Keuangan | verifikasi PR, kelola Pos RKA, vendor sensitif, laporan | Seluruh organisasi |
| `PURCHASE_AUDITOR` | Pemeriksa SPI | baca PR, vendor (tersamar), Pos RKA, laporan, ekspor, audit | Seluruh organisasi |
| `PURCHASE_ADMIN` | Pengelola Pengadaan | pengaturan, Plh, pengalihan penyetuju, vendor, Pos RKA, baca PR | Seluruh organisasi |

Atasan, Sekban, dan Kaban tidak memerlukan izin khusus untuk menyetujui: tahap ditujukan ke pegawai tertentu dan ruang kerja Pengadaan muncul bila ada tahap yang menunggu mereka. Beri mereka `PURCHASE_REQUESTER` bila mereka juga mengajukan PR.

## Penerapan ke produksi (berurutan)

1. Terapkan `supabase/migrations/20261017210000_purchasing_module.sql` melalui koneksi pengelola proyek. Migrasi hanya menambah 17 tabel (total 65 tabel `portal`, semuanya RLS tanpa grants), izin `purchasing.*`, dan lima role template. Aman diulang.
2. Deploy ulang `portal-api` dari `supabase/deploy/portal-api/index.ts` (`verify_jwt=false`). Health check sekarang menunggu 65 tabel; urutan ini mencegah fungsi baru berjalan sebelum migrasi.
3. Push source dan aset `site-info/dist/app/` ke `master` agar Cloudflare Pages menerbitkan menu Pengadaan.
4. Masuk sebagai administrator akun, beri `PURCHASE_ADMIN` ke pengelola, lalu di **Pengadaan → Pengaturan** pilih posisi Sekban dan Kaban (masing-masing harus punya tepat satu pemegang aktif di data SDM), isi kode unit untuk nomor PR, kop, dan nomor manual terakhir bila ada.
5. Keuangan menambah tahun anggaran dan Pos RKA; Purchasing mengisi daftar vendor.
6. Beri role sesuai tabel di atas. Pastikan setiap pemohon punya penempatan utama aktif dengan atasan di data SDM; halaman Beranda Pengadaan menampilkan data yang masih kurang.

## Uji lokal

```text
node --test tests/*.test.mjs
node scripts/build-cloud-deploy.mjs
node scripts/verify-cloud-operations.mjs <path-ke-pglite/dist/index.js>
node scripts/verify-cloud-portal-ui.mjs <path-ke-playwright/index.mjs> <path-ke-browser>
node scripts/verify-purchasing-ui.mjs <path-ke-playwright/index.mjs> <path-ke-browser>
```

`tests/purchasing.test.mjs` menguji aturan dan alur jalur A/B/C, konfirmasi ulang, revisi, Plh, pengalihan, akses, dan batas query detail PR. `verify-cloud-operations` menjalankan alur PR → PO → serah terima pada PostgreSQL (PGlite) melalui modul cloud hasil generator. `verify-purchasing-ui` menjalankan alur lengkap di browser headless terhadap server lokal dengan SQLite sementara dan data fiktif, termasuk cetak PO ber-QR dan verifikasi di layar ponsel.

## Catatan teknis

- Sumber aturan ada di `lib/purchasing-rules.mjs` (murni) dan `lib/purchasing.mjs` (rute, izin, penomoran). Modul cloud `supabase/functions/_shared/portal/purchasing*.mjs` dihasilkan generator; jangan diedit langsung.
- Uang disimpan sebagai rupiah bulat (BIGINT di PostgreSQL), jumlah sebagai per seribu (`quantity_milli`), subtotal dibulatkan setengah ke atas.
- Pengaturan disimpan di `app_settings` dengan kunci `purchasing.settings` (JSON) dan setiap perubahan tercatat di audit.
- QR dibuat di browser dengan pustaka `public/vendor/qr.js` (paulmillr/qr, MIT/Apache-2.0) tanpa layanan luar.
