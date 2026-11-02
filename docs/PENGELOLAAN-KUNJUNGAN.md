# Pengelolaan Kunjungan — branch feature
Status: fondasi UI, role, tautan dan kontrak jembatan data. **Belum siap produksi.**
Tidak ada data historis disisipkan ke kode; spreadsheet lama tidak dimodifikasi.

## Ruang lingkup
- Workspace baru: Dashboard, Guide, Penilaian Baru, Link Formulir, Arsip.
- Role: KUNJUNGAN_PENGELOLA dan KUNJUNGAN_PIMPINAN. Admin IT dapat memberi izin melalui Role & Izin.
- Tautan permanen terpisah untuk Pos 1 dan Pos 3, token 32 byte acak, hanya hash tersimpan di database.
- Google Spreadsheet adalah sumber data operasional dan arsip; data historis **tidak masuk** statistik baru.
- Formulir lapangan anonim tanpa login, offline-first: **belum diimplementasikan**.
- Laporan REVIEW manual harus diambil dari rekap bulanan, bukan kolom Evaluations saja.
- Tidak ada deployment/migrasi dilakukan.

## Penghubung Google Spreadsheet (belum terpasang)
Konfigurasi Edge Function (hanya di server, bukan GitHub):
- VISITS_BRIDGE_URL: endpoint HTTPS privat yang menyediakan API manajemen + laporan.
- VISITS_BRIDGE_KEY: kunci kuat yang diverifikasi oleh endpoint jembatan (jangan dikirim ke browser).

Kontrak respons: `{ "ok": true, "data": ... }`.
POST `text/plain` dengan body `{operation,credential,payload}`. Operasi:
- `overview`: {from,to} -> {summary:{active_guides,trips,today,guides_rated,uniform_pct,id_pct,etika_avg},per_pos:[],by_regu:[]}
- `guides.list` -> {items:[{guideId,guideName,kategori,regu,aktif}]}
- `guides.upsert` -> guide record
- `records.list`: {from,to} -> {items:[evaluation]}
- `archive.list`: {month,offset,limit} -> {items:[evaluation],more:boolean}.

**Jangan pointing VISITS_BRIDGE_URL ke /exec NilaiGuide saat ini.** Endpoint lama tidak menyediakan autentikasi credential maupun operasi di atas. Sediakan gateway validasi credential dan pengaturan spreadsheet tujuan, termasuk cutover date, lalu baru aktifkan.

## Sebelum merge
1. Implementasikan penghubung Apps Script dengan autentikasi dan akses scoped untuk data baru/arsip.
2. Implementasikan formulir publik /penilaian-guide/pos-1 dan pos-3, validasi token, rate limit, idempotency evaluationId, antrean offline terenkripsi dan sinkronisasi.
3. Tambahkan gateway publik yang memvalidasi token di database dan meneruskan ke backend; jangan tampilkan VISITS_BRIDGE_KEY.
4. Ekspor arsip saat ini hanya baris Evaluations (tanpa REVIEW manual di rekap). Tambahkan workbook rekap bulanan dan PDF sebelum produksi.
5. Periksa risiko rekonsiliasi data lama: uniform 0/1 vs -1/1/2, baris diganti, guide bernama sama, nilai REVIEW manual.
6. Tes terintegrasi frontend, API, Supabase dan GAS. Deploy ke preview branch saja; jangan merge master tanpa verifikasi.

## Pemisahan data
Arsip lama: spreadsheet NilaiGuide Basis Data 2026, berisi 5.363 penilaian pada snapshot 2 Nov; spreadsheet generasi awal juga perlu diarsipkan. Tidak ada penyalinan tanpa validasi.
Data baru dimulai pada cutover resmi setelah seluruh antrean offline PWA lama terkirim. Gunakan spreadsheet operasional baru jika telah disiapkan.
