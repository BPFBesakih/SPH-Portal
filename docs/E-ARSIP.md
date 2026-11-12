# E-Arsip Humas — Tahap 1

Status 12 November 2026: **perbaikan review PR #32 tersedia di cabang `33`, belum di-merge, belum dirilis.** Supabase, Google Drive, dan bpbesakih.com tidak diubah. Dasar kebutuhan: *PRD Final Modul Humas E-Arsip SPH Portal Tahap 1* (40 keputusan Q01–Q40, kriteria AC01–AC45).

PRD menyebut dirinya "bukan izin implementasi atau deployment". Cabang ini dibuat atas permintaan pemilik untuk ditinjau dan dicoba lokal; merilisnya tetap memerlukan keputusan pemilik dan langkah di bagian [Rilis](#rilis-oleh-pemilik-repo).

## Yang dibangun

Menu bersama **E-Arsip** di `/app/` (seperti Cuti dan Absensi), dengan isi mengikuti hak akun:

| Bagian | Untuk siapa | Isi |
|---|---|---|
| Ringkasan | Semua | Total arsip aktif, jumlah per jenis (hanya yang dapat dibaca penuh), arsip terbaru, notifikasi portal |
| Daftar Arsip | Semua | Cari nomor agenda/nomor surat/perihal; saringan tanggal arsip, bagian, jenis, arah, klasifikasi, tanggal surat, "dibagikan kepada saya"; tabel di desktop, kartu di HP |
| Tambah Arsip | Petugas arsip yang ditunjuk | Form Informasi Surat + Dokumen; satu dokumen utama wajib, banyak lampiran; status unggah per berkas; peringatan dugaan duplikat |
| Detail arsip | Pembaca | Informasi surat, pratinjau (PDF di kanvas, gambar), dokumen dan versi, Riwayat, dan untuk Humas: Pengaturan Akses |
| Laporan | Semua | Rekap periode/bagian/jenis, buku agenda masuk/keluar; XLSX dan PDF |
| Pengajuan Hapus | Petugas dan Humas | Petugas mengajukan dan membatalkan; Humas menyetujui atau menolak |
| Jenis Dokumen, Arsip Dihapus | Humas | Master jenis; daftar arsip yang disembunyikan dan pemulihannya |
| Petugas Arsip | Administrator | Menunjuk/mencabut petugas per bagian dan menetapkan kode agenda bagian |

Lonceng portal menampilkan notifikasi E-Arsip yang belum dibaca dan, untuk Humas, pengajuan hapus yang menunggu.

### Aturan inti

- **Nomor agenda** `KODEBAGIAN/TAHUN/URUTAN` (mis. `HMS/2026/0001`), satu pencacah per bagian dan tahun pengarsipan (WITA). Dibuat server saat arsip disimpan; tidak berubah saat diedit, dihapus, atau dipulihkan, dan tidak dipakai ulang.
- **Arsip baru selalu Biasa** dan langsung aktif tanpa persetujuan Humas. Form menyampaikan hal ini (Q31–Q32).
- **Hak akses** mengikuti predikat PRD 5.3 (`archiveDecide` di `lib/archive-rules.mjs`):
  - daftar = Humas, atau lingkup (anggota bagian pemilik, penerima berbagi, pengawasan), atau izin baca Rahasia;
  - baca = Humas, atau Biasa dalam lingkup, atau Rahasia dengan izin;
  - ubah = baca + petugas bagian pemilik; unduh = baca + izin unduh (juga bagi Humas).
- **Rahasia tanpa izin baca**: server hanya mengirim nomor agenda, tanggal pengarsipan, dan label Rahasia (ditambah ID teknis). Pencarian dan saringan atas atribut tersembunyi tidak mengikutkan baris itu. Penyamaran terjadi di `lib/archives.mjs`, bukan di tampilan.
- **Perubahan klasifikasi** menaikkan `security_epoch` dan mengakhiri izin baca Rahasia/unduh lama; berbagi Biasa tetap tercatat. Hal yang sama berlaku pada hapus logis.
- **Berkas lama tidak ditimpa**: penggantian membuat versi baru. Hapus berarti disembunyikan; tidak ada penghapusan permanen atau retensi otomatis.
- **Audit modul** (`archive_audit_events`) hanya bertambah dan ditulis dalam transaksi yang sama dengan perubahannya.

## Pemetaan PRD ke portal

| Di PRD (desain logis) | Di SPH-Portal |
|---|---|
| `portal_user`, `portal_unit` | `users` (`public.app_users`), `org_units` |
| Anggota bagian | Penempatan utama pegawai pada unit itu **atau unit di bawahnya** |
| Role Humas | Role baru **Humas** (`HUMAS`): izin `archives.humas.manage` |
| Pimpinan / pengawasan (RT08) | Role baru **Pengawas Arsip** (`ARSIP_PENGAWAS`): izin `archives.records.oversee` pada unit cakupan role. Tidak ada cakupan yang ditebak dari jabatan |
| Administrator | Izin `archives.officers.assign` (Super Admin dan IT Admin). Tidak memberi hak baca |
| schema `arsip`/`arsip_private`, RPC | Schema privat `portal` (RLS aktif, tanpa grant ke klien) + rute `archives/*` di Edge Function `portal-api`, sama seperti modul lain |
| `file_objects` | Tabel `files` yang sudah ada; berkas di Drive privat, folder modul **SPH-Portal-Arsip** |
| `notification_outbox` | `archive_notifications` (dibaca lewat menu E-Arsip dan lonceng) |

Catatan: di produksi, gateway memberi Super Admin semua kode izin. Karena itu modul ini **tidak** memakai `has/can` gateway; ia membaca langsung role yang memegang izin arsip, sehingga Super Admin tidak otomatis menjadi Humas.

Tabel baru (14): `archive_document_types`, `archive_units`, `archive_officers`, `archive_agenda_counters`, `archive_records`, `archive_documents`, `archive_document_versions`, `archive_access_grants`, `archive_delete_requests`, `archive_upload_operations`, `archive_duplicate_overrides`, `archive_audit_events`, `archive_notifications`, `archive_daily_summary_runs`.

## Parameter RT yang dipakai

PRD meminta parameter RT ditetapkan saat review. Cabang ini memakai **rekomendasi PRD sebagai bawaan**. Yang paling berpengaruh pada perilaku dan perlu dikonfirmasi pemilik proses sebelum rilis:

| RT | Dipakai | Bila ingin diubah |
|---|---|---|
| RT05 | Humas mengelola akses lintas bagian; menambah/mengubah arsip tetap perlu penunjukan petugas | Aturan `edit` di `archiveDecide` |
| RT06 | Pengajuan hapus **di aplikasi** (diajukan → disetujui/ditolak/dibatalkan). Humas juga dapat menghapus langsung dengan alasan + rujukan pengajuan manual | Tab Pengajuan Hapus dapat disembunyikan |
| RT08 | Pengawasan lewat role Pengawas Arsip dengan unit cakupan | Pemetaan jabatan → cakupan belum ada |
| RT09 | Izin baca Rahasia dan unduh hanya untuk pengguna bernama; berbagi Biasa untuk pengguna atau bagian | — |
| RT10 | Epoch: izin Rahasia/unduh berakhir saat klasifikasi berubah dan saat arsip dihapus | `arcRevokeEpochGrants` |
| RT13 | Folder Drive privat portal yang sudah ada (bukan Shared Drive) | Mengikuti penyimpanan portal |
| RT15 | Lihat [Penyimpangan](#penyimpangan-dan-batasan) nomor 1 | — |
| RT18 | Izin unduh sampai dicabut, mencakup semua berkas dan versi arsip itu | — |

Lainnya: RT01 zona WITA dan ringkasan pukul 07.00; RT02 perihal 1–500 karakter; RT03 batas 10.000.000 byte per berkas; RT04 dugaan duplikat = berkas sama, atau nomor+tanggal sama, atau perihal+tanggal sama; RT07 riwayat lengkap untuk Humas, riwayat isi untuk petugas; RT11 penerima notifikasi dipilih terpisah dari penerima akses; RT12 PWA tanpa data offline; RT16 petugas harus anggota aktif bagian; RT17 alasan penggantian versi wajib; RT19 periode laporan memakai tanggal pengarsipan; RT22 snapshot nama jenis dan kode bagian.

## Penyimpangan dan batasan

1. **Pratinjau tidak dirender di server (RT15).** Rute pratinjau mengirim isi berkas ke portal, lalu portal menggambarnya di kanvas (pdf.js) atau sebagai gambar, tanpa tombol simpan. Rute pratinjau dan rute unduh tetap terpisah dan diperiksa berbeda (AC23–AC25), tetapi pengguna yang paham teknis dapat mengambil isi berkas dari lalu lintas jaringan pratinjau. Render halaman di server memerlukan pekerja render yang belum ada di infrastruktur portal (Pages Functions + Edge Function). PRD sendiri mencatat bahwa konten yang dapat dilihat tetap dapat disalin.
2. **Tidak ada pemindaian malware.** Yang diperiksa: ekstensi, MIME, tanda tangan isi berkas (PDF/JPEG/PNG), ukuran, dan checksum. PDF berkata sandi diterima saat unggah dan gagal dipratinjau dengan pesan yang jelas.
3. **Unggah memakai rute `uploads` yang sudah ada** (satu permintaan per berkas, bukan resumable), dan di produksi masih berada di bawah kunci tulis global portal (temuan T4 pada audit Oktober). Berkas 10 MB di jaringan lambat dapat menahan penyimpanan modul lain beberapa detik.
4. **Operasi unggah disederhanakan.** `archive_upload_operations` hanya menyimpan operasi yang selesai (untuk idempotensi). Berkas yang sudah diunggah tetapi tidak pernah diikat ke arsip tinggal di tabel `files` dan folder Drive utama; belum ada rekonsiliasi atau pembersihan (RT14).
5. **Ringkasan harian Humas tidak memakai cron.** Ringkasan hari sebelumnya dibuat saat Humas pertama membuka portal setelah pukul 07.00 WITA; kunci unik mencegah ringkasan ganda, dan hari tanpa arsip tetap mendapat ringkasan nol. Bila tak ada Humas yang masuk selama lebih dari 7 hari, hari-hari yang lebih lama tidak dibuatkan ringkasan.
6. **Penolakan akses dicatat di log Edge Function**, bukan di tabel audit: penolakan membatalkan transaksi permintaan. Audit keberhasilan (termasuk buka detail, pratinjau, mulai unduh, ekspor) ada di tabel.
7. **Ekspor dibuat langsung** (maksimal 5.000 baris per laporan), tanpa `export_jobs`. Izin diperiksa saat data laporan diminta.
8. **Laporan PDF** memakai font bawaan PDF; karakter di luar Latin diganti huruf dasarnya.
9. **Belum ada**: watermark pratinjau, MFA (RT20), pemindahan arsip antarbagian, lampiran pada pengajuan hapus, pratinjau lokal sebelum unggah.

## Mencoba secara lokal

```text
node scripts/preview-arsip.mjs --reset
```

Membuka portal lokal (SQLite) di `http://127.0.0.1:4626/#archives` dengan data fiktif; akun dan perannya dicetak di terminal (password `Preview2026!`). Tidak ada yang dikirim ke Supabase atau Google.

## Pemeriksaan otomatis

Perbaikan review pada cabang `33`:

- Berkas arsip ditolak oleh pengikatan dan unduh umum, termasuk versi lama, lampiran dilepas, dan arsip dihapus. Ikatan ganda yang sudah terlanjur ada juga tidak membuka unduh umum.
- Kirim ulang pembuatan memakai hak baca dan status hapus terkini: Rahasia tetap disamarkan, arsip dihapus menjawab 404, dan nomor agenda tidak dibuat ulang.
- Riwayat menyaring jenis tindakan sebelum mengambil 300 hasil, sehingga pembukaan detail/pratinjau tidak menyingkirkan perubahan yang perlu ditampilkan.
- Kesiapan tabel diperiksa lewat katalog sebelum rute arsip dipakai. Bila migrasi belum dipasang, rute arsip menjawab 404 dan unggahan/lampiran/unduh modul lama tetap berjalan.
- Status penunjukan dievaluasi dengan waktu setelah penyimpanan, sehingga penunjukan baru tidak keliru dianggap kedaluwarsa.

Validasi perbaikan: Node 24.22.1 dan PGlite 0.5.16, seluruh data fiktif. Paket PGlite perlu tersedia untuk menjalankan suite penuh; contoh persiapan lokal: `npm install --no-save @electric-sql/pglite@0.5.16`. Pada checkout Windows, pertahankan LF untuk `site-info/dist/_headers` karena tes Kunjungan lama memisah blok berdasarkan LF.

| Pemeriksaan | Hasil di cabang ini |
|---|---|
| `npm test` | 359/359 lulus dengan PGlite terpasang; 24 di antaranya `tests/archives.test.mjs`, termasuk lima regresi review |
| `node scripts/verify-archives-postgres.mjs <pglite>` | 9/9 lulus: gateway sebelum migrasi, migrasi (RLS, tanpa grant, role, pemicu, tepat satu dokumen utama), gateway sesudah migrasi dengan Drive tiruan, pengikatan antarmodul, kirim ulang, dan riwayat |
| `PLAYWRIGHT_MODULE=… node scripts/verify-archives-ui.mjs` | 8/8 alur lulus di browser (desktop dan layar HP), tanpa pelanggaran CSP |
| `verify-attendance-postgres`, `verify-visits-postgres`, `verify-attendance-ui` | Masing-masing 12/12, 10/10, dan 12/12 lulus setelah perbaikan |

**Belum diuji** dan perlu staging atau perangkat nyata: Drive dan Supabase sungguhan, HP Android/iPhone dan sinyal lemah (AC42), berkas mendekati 10 MB lewat gateway, beban (RT21), latihan pemulihan (AC38), dan pemeriksaan izin folder Drive (AC24 bagian Drive).

## Rilis (oleh pemilik repo)

Urutan: migrasi → `portal-api` → merge (Pages). Pengaman rilis membuat urutan aman bila tertukar: menu E-Arsip baru tampil setelah `portal-api` menjawab `archives/overview`; sebelum itu rute menjawab 404 dan menu tersembunyi.

1. **Migrasi** di SQL Editor: `supabase/migrations/20261112100000_archive_module.sql`. Aditif, satu transaksi: 14 tabel, tiga izin `archives.*`, role Humas dan Pengawas Arsip, serta izin menunjuk petugas untuk Super Admin dan IT Admin. Tidak mengubah tabel modul lain.
2. **`portal-api`**: unduh versi yang sedang aktif, simpan sebagai titik kembali, dan hitung SHA-256-nya.
   - Bila sama dengan `d3c7448447f92bafc0e93b107c93d9d657166e947fefde32f8755876a50f98b1` (isi di master `b739829`, sesudah Absensi), deploy `supabase/deploy/portal-api/index.ts` dari cabang ini (SHA-256 `5ba37bf316156a0d354d2dcf15a5bf0fa19d7baa723ae16010291c1d3fa69367`). Hash mengacu pada isi LF yang tersimpan di Git.
   - Bila berbeda, jalankan `node scripts/build-archive-deploy.mjs <berkas-aktif.ts> <sha256>` lalu deploy hasilnya. Jangan deploy berkas dari cabang ini apa adanya.
3. **Merge** cabang ke `master`: Pages menayangkan bundel `portal-fd4003193113.js` + `portal-2f27fca3acb5.css` dan berkas pdf.js di `/app/assets/vendor/pdfjs/`.
4. **Uji asap**: muat ulang `/app/`; buka Cuti, Kunjungan, Merchandise, Pengadaan, Absensi (karena `portal-api` berganti); lalu di E-Arsip:
   - Role & Izin: beri role **Humas** kepada akun Humas;
   - Petugas Arsip: tunjuk satu petugas dan tetapkan kode agenda bagiannya;
   - sebagai petugas: tambah satu arsip uji (PDF + lampiran foto dari HP), buka pratinjau;
   - sebagai Humas: ubah klasifikasi, bagikan, beri izin unduh, hapus dan pulihkan;
   - pastikan folder Drive **SPH-Portal-Arsip** terbentuk dan log `portal-api` tanpa galat.
5. **Sebelum dipakai luas**: sahkan parameter RT di atas, kode agenda tiap bagian (tidak dapat diubah setelah arsip pertama), daftar jenis dokumen awal, dan siapa pemegang role Humas.

## Rollback

- **Hanya E-Arsip bermasalah**: deploy ulang `portal-api` versi sebelumnya (salinan dari langkah 2). Rute arsip kembali 404 dan menu hilang saat pengguna memuat ulang. Pages tidak perlu diubah.
- **Tampilan bermasalah**: revert merge di `master`, atau Rollback di Cloudflare ke deployment sebelumnya.
- **Data**: jangan `DROP TABLE` dan jangan menghapus folder Drive. Tabel arsip tidak dipakai versi tanpa E-Arsip, jadi boleh dibiarkan. Arsip yang sudah tersimpan tetap utuh untuk dipasang kembali.

## Berkas utama

| Bagian | Berkas |
|---|---|
| Aturan dan rute | `lib/archive-rules.mjs`, `lib/archives.mjs` |
| Skema | `schema.sql`, `supabase/migrations/20261112100000_archive_module.sql` |
| Antarmuka | `public/archives.js`, `public/archive-report-pdf.js`, `public/assets/vendor/pdfjs/` (pdf.js 4.10.38, Apache-2.0) |
| Tambalan `portal-api` | `scripts/build-archive-deploy.mjs` → `supabase/deploy/portal-api/index.ts` |
| Uji | `tests/archives.test.mjs`, `scripts/verify-archives-postgres.mjs`, `scripts/verify-archives-ui.mjs` |
| Pratinjau lokal | `scripts/preview-arsip.mjs`, `scripts/archive-demo-data.mjs` |
