# Pengelolaan Kunjungan — Penilaian Guide (tahap 1)

Ruang kerja kelima di portal. Penilaian guide di pos pemeriksaan dicatat lewat `bpbesakih.com/penilaian-guide/` (PWA hasil pindahan NilaiGuide) dan **disimpan di basis data portal**. Setiap penilaian disalin otomatis ke **spreadsheet baru** di Google Drive portal: folder `SPH-Portal-Kunjungan`, satu file per tahun (`Penilaian Guide 2026`), satu tab per bulan (`2026-11`). Kolomnya sama dengan tab Evaluations lama: `evaluationId, timestamp, pos, guideId, guideName, uniform, idCard, review, etika, catatan, receivedAt, koreksiDari, status`.

**Aplikasi NilaiGuide (nilaiguide.vercel.app), Apps Script, dan spreadsheet lamanya tidak disentuh.** Repo NilaiGuide hanya dipakai sebagai acuan aturan. HP pos pindah satu per satu; HP yang belum pindah tetap memakai aplikasi lama seperti biasa, dan datanya tetap masuk spreadsheet lama.

> Rancangan sebelumnya (jembatan ke Apps Script NilaiGuide, PR #17) dibatalkan atas permintaan pemilik. Kode jembatan sudah dihapus dari portal dan tidak pernah dipasang di NilaiGuide.

## Alur data

```
HP pos ──► /api/guide-form (Pages) ──► Edge guide-form ──► basis data portal (visit_evaluations)
                                              │ sesudah balasan dikirim (EdgeRuntime.waitUntil)
                                              ▼
                         Google Drive portal / SPH-Portal-Kunjungan / Penilaian Guide 2026 / tab 2026-11
```

- HP baru menerima ✅ setelah penilaian tersimpan di basis data portal. Penyalinan ke spreadsheet berjalan sesudahnya dan tidak memengaruhi kiriman; bila Google sedang bermasalah, baris menunggu di portal.
- Baris ditulis ke **posisi** yang dicatat portal, bukan ditambahkan di bawah. Percobaan ulang setelah gangguan menimpa baris yang sama, sehingga tidak ada baris ganda.
- Koreksi petugas mengubah status baris lama menjadi `diganti` di portal dan di spreadsheet.
- Hanya satu penyalinan berjalan pada satu waktu (lease di `visit_sheet_state`). Semua panggilan Google berjalan **di luar** transaksi basis data dan tidak memakai kunci global portal.
- Pemicu: setiap kiriman pos (dibatasi paling sering 20 detik sekali), dan tombol **Sinkronkan sekarang** di Tautan Pos.

## Aturan terima (dipindah dari `server-gas/03_Ingest.gs`)

| Aturan | Perilaku |
| --- | --- |
| Kiriman ulang | `evaluationId` yang sudah tersimpan diakui sebagai duplikat (✅), tidak disimpan dua kali. |
| Jeda | Guide + pos yang sama < 15 menit (selisih mutlak, lintas HP dan di dalam satu kiriman) ditolak. 15–60 menit diperingatkan aplikasi. |
| Koreksi | Hanya untuk guide, pos, dan tanggal WITA yang sama; baris lama ditandai `diganti`, tidak dihapus; satu baris hanya bisa dikoreksi sekali. |
| Guide | Harus terdaftar di Data Guide portal. Guide nonaktif tetap diterima. Nama diambil dari Data Guide, bukan dari HP. |
| Nilai | Uniform −1/+1/+2, ID-card Ya/Tidak, Etika −5..+5, catatan ≤ 500 huruf (disimpan apa adanya; di spreadsheet ditulis sebagai teks, tidak pernah menjadi rumus). |
| Jam HP | Jam yang lebih cepat dari server dipotong ke waktu terima, supaya penilaian tidak jatuh di tanggal yang belum terjadi. |
| Umur kiriman | **Baru:** penilaian yang tertahan di HP lebih dari 30 hari ditolak (pesan jelas di HP). Perlu untuk retensi di bawah. |

## Retensi 6 minggu

Supaya basis data tidak terus membesar, rincian penilaian disimpan 6 minggu (42 hari). Sebagai gambaran, 70–150 penilaian per hari hanya ±3–6 ribu baris per 6 minggu.

1. Sekali sehari (saat penyalinan berjalan), baris yang lebih tua dari 42 hari **dibaca ulang dari spreadsheet dan dicocokkan sel demi sel**.
2. Hari yang seluruh barisnya cocok dilipat ke **`visit_daily_totals`** (jumlah per hari, per guide, per pos) lalu dihapus dari basis data — dalam satu transaksi. `visit_monthly_totals` masih ikut diisi supaya `portal-api` versi sebelumnya tetap benar bila perlu rollback.
3. Baris yang belum tersalin, berbeda isinya (mis. diubah orang di spreadsheet), atau berpindah posisi **tidak dihapus**: baris itu ditulis ulang dulu, dan hari itu serta hari sesudahnya ditahan sampai cocok.
4. Batas umur kiriman 30 hari lebih pendek dari retensi 42 hari, sehingga kiriman ulang dari HP untuk penilaian yang sudah dihapus selalu ditolak, bukan tercatat dua kali.
5. Bila Google tidak bisa dihubungi atau Sheets API belum aktif, tidak ada yang dihapus.

Dashboard dan Laporan bisa dibuka untuk **rentang tanggal mana pun** — juga minggu dan bulan lama: angkanya dari rincian (6 minggu terakhir) ditambah rekap harian, persis sama dengan sebelum dilipat (diuji untuk setiap hari). Rincian per penilaian yang lebih tua dari 6 minggu dibuka di spreadsheet.

> Migrasi `20261104120000_visit_daily_totals_history.sql` harus dijalankan **sebelum pelipatan pertama** (paling cepat ±16 Desember 2026, 42 hari setelah penilaian portal pertama). Migrasi itu menolak berjalan bila `visit_monthly_totals` sudah berisi, supaya tidak ada bulan yang hanya punya ringkasan bulanan.

## Isi modul

| Bagian | Berkas | Keterangan |
| --- | --- | --- |
| Formulir lapangan | `public/penilaian-guide/` → `site-info/dist/penilaian-guide/` | PWA NilaiGuide yang dipindah: offline, tanpa login. Pos ditentukan tautan pos (token di fragmen URL). |
| Gateway publik | `site-info/lib/guide-form.mjs`, `site-info/functions/api/guide-form/[[action]].js` | `POST /api/guide-form/{context,submit}`: origin, `CF-Connecting-IP`, badan ≤ 24 KB, lalu ke Edge `guide-form` dengan secret server. |
| Edge publik | `supabase/functions/guide-form/index.ts` → `supabase/deploy/guide-form/index.ts` (`scripts/build-guide-form.mjs`) | Batas frekuensi, token → tautan aktif, aturan terima di bawah kunci khusus modul, salinan di latar belakang. Tanpa kunci global portal. |
| Aturan & rekap | `lib/visit-data.mjs` | Aturan terima, Data Guide + impor, daftar penilaian, rekap dan peringkat (aturan `05_Ringkasan.gs` dan `08_Peringkat.gs`), rekap per hari untuk rentang bebas, migrasi awal NilaiGuide. |
| Salinan & retensi | `lib/visit-sheets.mjs` | Google Sheets/Drive lewat OAuth yang sama dengan unggah berkas (`GOOGLE_DRIVE_*`), lease, tulis posisional, verifikasi, pelipatan bulanan, pemeriksaan koneksi. |
| Rute pengelolaan | `lib/visits.mjs` → `_shared/portal/*.mjs`, disuntikkan ke snapshot `portal-api` oleh `scripts/build-visits-deploy.mjs` | Rute basis data di `routeOperation`; `visits/sheet/sync` dan `visits/sheet/check` dicegat sebelum transaksi permintaan. |
| Formulir pos | `lib/guide-form.mjs` | Pemeriksaan bentuk, batas 60 `context` dan 300 penilaian per 10 menit per tautan dan per IP, catatan kiriman tanpa isi nilai (90 hari). |
| Ruang kerja | `public/visits.js`, `public/visit-import.js` (+ `app.js`, `pages.js`, `role-permissions.js`, `styles.css`) | Dashboard, Data Guide (impor .xlsx/.csv di peramban), Penilaian, Tautan Pos + Salinan spreadsheet, Laporan & Ekspor (+ kartu Migrasi awal NilaiGuide). |
| Basis data | `supabase/migrations/20261103100000_visit_management.sql`, `…/20261104090000_visit_portal_storage.sql`, `…/20261104120000_visit_daily_totals_history.sql`, `schema.sql` | Tautan pos, batas frekuensi, catatan kiriman; `visit_guides`, `visit_evaluations`, `visit_monthly_totals`, `visit_daily_totals`, `visit_history_import`, `visit_history_ids`, `visit_sheet_files`, `visit_sheet_tabs`, `visit_sheet_state`. Semua RLS, tanpa grant ke anon/authenticated/service_role. **IT_ADMIN tidak diberi izin visits.** |
| Uji | `tests/visits.test.mjs`, `tests/visit-history.test.mjs`, `tests/guide-form-transport.test.mjs`, `scripts/verify-visits-postgres.mjs`, `scripts/verify-guide-form-ui.mjs`, `scripts/fake-google-sheets.mjs` | Google tiruan yang ketat (batas grid, galat bergaya Google); tidak pernah menghubungi Google. |

## Izin

| Izin | Pengelola | Pimpinan |
| --- | --- | --- |
| `visits.dashboard.read`, `visits.guides.read`, `visits.records.read`, `visits.reports.read`, `visits.reports.export` | ya | ya |
| `visits.guides.manage` (ubah & impor guide), `visits.forms.read`, `visits.forms.manage` (tautan pos), `visits.settings.manage` (sinkronkan, periksa koneksi, migrasi awal NilaiGuide) | ya | — |

Super Admin memegang semua izin `visits.*`. Alamat file spreadsheet hanya tampil bagi pemegang `visits.settings.manage` atau `visits.reports.export`; aksesnya sendiri tetap diatur berbagi Google Drive.

## Data Guide awal

Buka spreadsheet NilaiGuide lama → tab **Guides** → *File → Download → Microsoft Excel (.xlsx)* atau *CSV*. Di portal: Kunjungan → Data Guide → **Impor berkas**. Berkas dibaca di peramban; portal menampilkan pratinjau (baru/berubah/tetap/baris bermasalah) sebelum diterapkan. ID guide (G-001 …) dipertahankan supaya data lama dan baru bisa digabung; baris tanpa ID diberi ID berikutnya. Guide yang tidak ada di berkas tidak diubah. Spreadsheet lama tidak diubah. Daftar guide asli tidak disimpan di repo.

## Uji lokal (Windows)

Tidak perlu folder NilaiGuide dan tidak perlu layanan cloud:

```powershell
cd $HOME\Documents\GitHub\SPH-Portal-uji
node scripts/preview-kunjungan.mjs            # lanjutkan data pratinjau
node scripts/preview-kunjungan.mjs --reset    # mulai dari awal
```

- Portal: http://127.0.0.1:4615/#visits — akun `kunjungan.preview`, `pimpinan.preview`, `admin.preview`, `sdm.preview` (password `Preview2026!`).
- Formulir Pos 1 dan Pos 3: alamatnya tercetak di terminal (token pratinjau, hanya untuk uji).
- Data Guide awal berisi 40 guide fiktif; daftar asli bisa dicoba lewat Impor berkas (tersimpan hanya di `data/`).
- "Spreadsheet" adalah Google tiruan. Isinya ditulis sebagai CSV per tab di `data/pratinjau-kunjungan/google/` supaya bisa dibuka di Excel.

Yang layak dicoba:

1. Formulir tanpa token (`/penilaian-guide/`): hanya petunjuk dan kotak tempel tautan.
2. Tautan Pos 1: daftar guide termuat, token hilang dari bilah alamat. Isi penilaian, muat ulang (draf pulih), SIMPAN. Lihat CSV tab bulan ini terisi beberapa detik kemudian.
3. Nilai guide yang sama lagi: aplikasi menahan (< 15 menit). *Betulkan penilaian itu*, ubah, SIMPAN: baris lama menjadi `diganti` di Penilaian dan di CSV.
4. Matikan Wi-Fi (DevTools → Offline), simpan beberapa penilaian, nyalakan lagi: ⏳ menjadi ✅.
5. Data Guide → Impor berkas (.xlsx dari Google Sheets atau .csv) → pratinjau → Terapkan.
6. Tautan Pos → **Periksa koneksi** (empat langkah hijau) dan **Sinkronkan sekarang**. Ganti tautan Pos 1: HP dengan tautan lama menunggu tautan baru; antreannya tidak hilang.
7. Dashboard, Penilaian, Laporan: ekspor Excel.
8. Laporan & Ekspor → **Mulai migrasi awal** → pilih unduhan .xlsx spreadsheet NilaiGuide (atau salinannya) → pratinjau per bulan → Terapkan. Pilih bulan Maret, dll. di Laporan: angka NilaiGuide ikut terhitung. **Batalkan migrasi** mengembalikan angka seperti semula. Data pratinjau tetap di `data/` dan tidak dikirim ke mana pun.
9. Masuk sebagai `pimpinan.preview` (tanpa Tautan Pos, ubah guide, atau sinkronkan) dan `sdm.preview` (tanpa ruang kerja Kunjungan).

Pemeriksaan otomatis:

```powershell
node --test tests/*.test.mjs                                    # termasuk tests/visits.test.mjs
node scripts/verify-visits-postgres.mjs <pglite\dist\index.js>  # PGlite: migrasi, Edge guide-form, snapshot portal-api, retensi, migrasi awal
node scripts/verify-guide-form-ui.mjs                           # Playwright: HP pos dan ruang kerja (termasuk migrasi awal)
```

### Batas uji lokal

- **Google tiruan bukan Google.** Izin token OAuth, status Google Sheets API di project Google Cloud, kuota, dan bentuk galat asli hanya bisa dipastikan di produksi lewat tombol **Periksa koneksi** (tidak membuat atau mengubah berkas).
- Server lokal (SQLite) menjalankan aturan yang sama dari `lib/`, tetapi bukan snapshot `portal-api` produksi. Tambalan produksi diuji lewat `verify-visits-postgres.mjs` di atas snapshot yang sudah ditambal (PGlite), bukan di Supabase sungguhan.
- `EdgeRuntime.waitUntil` disimulasikan; batas waktu latar belakang Supabase (wall clock) tidak diuji. Setiap percobaan penyalinan dibatasi 60 detik (20 detik dari tombol portal) dan berhenti dengan aman bila waktunya habis; total latar belakang paling lama ±2 menit.
- PWA terpasang di layar utama (Android/iPhone), pembaruan service worker, dan kamera QR hanya bisa dicek di HP sungguhan.

## Rilis (oleh pemilik repo)

1. **Google Cloud** (project pemilik OAuth client SPH Portal): APIs & Services → Library → **Google Sheets API → Enable**. Refresh token yang dipakai unggah berkas tidak perlu diganti selama izinnya mencakup Drive (`drive` atau `drive.file`); tombol Periksa koneksi di langkah 7 memastikannya.
2. **Supabase Secrets**: `VISITS_IP_HMAC_KEY` (acak, ≥ 32 karakter). `GOOGLE_DRIVE_FOLDER_ID`, `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN` sudah ada dan otomatis terbaca fungsi baru.
3. **Migrasi** di SQL Editor, berurutan: `20261103100000_visit_management.sql`, lalu `20261104090000_visit_portal_storage.sql`.
4. **Edge Function `guide-form`** (baru): deploy dari `supabase/deploy/guide-form/index.ts`, `verify_jwt=false` seperti fungsi portal lain (autentikasi lewat `withSupabase({auth:'secret'})`). Pages Function `/api/guide-form/*` memakai `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, dan `PORTAL_ORIGIN` yang sudah ada.
5. **Edge Function `portal-api`**: pastikan versi aktif sama dengan snapshot sebelum modul ini (SHA-256 `fd304a9e5a5b3e846bacdb2a428a2b7dc1210133ecd3be683441d4aff6100580`). Bila sama, deploy `supabase/deploy/portal-api/index.ts`. Bila berbeda, unduh versi aktif lalu jalankan `node scripts/build-visits-deploy.mjs <berkas-aktif.ts> <sha256>`.
6. **Merge** PR ke `master`: Pages menayangkan ruang kerja dan formulir versi baru.
7. **Persiapan**: beri role Pengelola/Pimpinan Kunjungan di Role & Izin → impor tab Guides → Tautan Pos → **Periksa koneksi** → buat tautan Pos 1 dan Pos 3.
8. **Pilot**: satu HP di Pos 1 memakai tautan portal selama dua hari, HP lain tetap di aplikasi lama. Cocokkan Dashboard portal dengan spreadsheet `Penilaian Guide 2026`. Setelah itu pindahkan HP satu per satu (di aplikasi lama: Tertunda 0 dan Ditahan 0 sebelum pindah). Aplikasi lama cukup tidak dipakai lagi setelah semua HP pindah; NilaiGuide tidak perlu diubah.

Rollback: HP kembali ke aplikasi lama (masih tayang dan tidak berubah) dan tautan pos dicabut; Pages → deployment sebelumnya; `portal-api` → versi sebelumnya. Migrasi aditif dan tidak dihapus. Spreadsheet baru tetap ada di Drive.

### Rilis rekap harian + migrasi awal (PR `claude/kunjungan-rekap-harian-migrasi`)

Harus selesai **sebelum ±16 Desember 2026** (pelipatan pertama). Urutan:

1. SQL Editor: `20261104120000_visit_daily_totals_history.sql`. Bila muncul *"visit_monthly_totals sudah terisi"*, berhenti dan laporkan — jangan dipaksa.
2. Edge Function `guide-form`: deploy `supabase/deploy/guide-form/index.ts` (pelipatan berjalan dari fungsi ini).
3. Edge Function `portal-api`: pastikan SHA-256 versi aktif `8ad551a8e95663b17d245be8864512dd50a2b7467ccb05d1f997cdfddd95355a` (PR #19), lalu deploy `supabase/deploy/portal-api/index.ts`. Bila berbeda, unduh versi aktif lalu jalankan `node scripts/build-visits-deploy.mjs` dari snapshot sebelum modul Kunjungan (lihat langkah 5 di atas).
4. Merge PR: Pages menayangkan kartu Migrasi awal.

Rollback: `portal-api` dan `guide-form` → versi sebelumnya (keduanya tetap mengisi/membaca `visit_monthly_totals`), Pages → deployment sebelumnya. Tabel baru dibiarkan. Migrasi awal yang sudah diterapkan bisa dibatalkan dari kartunya kapan pun sebelum rollback.

## Keputusan yang dipakai

- Penyimpanan: basis data portal + salinan spreadsheet baru (keputusan pemilik, 3 November). Retensi 42 hari, umur kiriman 30 hari, rekap harian untuk periode lama (4 November; sebelumnya ringkasan bulanan).
- Riwayat NilaiGuide: diekspor **sekali** sebagai migrasi awal; sesudahnya penilaian hanya lewat portal. Pos 2 dan REVIEW tidak diimpor (keputusan pemilik, 4 November).
- Satu spreadsheet per tahun, satu tab per bulan (WITA), kolom sama dengan tab Evaluations lama (kolom `review` diisi 0).
- Data Guide awal dari impor berkas tab Guides; ID lama dipertahankan.
- REVIEW belum dipakai (tidak ada di Dashboard, Laporan, dan ekspor).
- Nama kembar di regu yang sama ditolak di form satuan; di impor hanya diperingatkan.
- Batas frekuensi formulir: 60 `context` dan 300 penilaian per 10 menit, per tautan dan per IP. Alamat `/penilaian-guide/`, nama ruang kerja "Kunjungan".

## Migrasi awal NilaiGuide

Spreadsheet NilaiGuide lama tetap menjadi arsip dan tidak diubah. Riwayatnya masuk ke portal **sekali** lewat Laporan & Ekspor → kartu **Migrasi awal NilaiGuide** (izin `visits.settings.manage`):

1. Lakukan setelah HP terakhir pindah ke tautan portal dan Data Guide sudah diimpor (guide dicocokkan lewat ID `G-…`).
2. Di spreadsheet NilaiGuide: *File → Download → Microsoft Excel (.xlsx)* (seluruh spreadsheet; portal membuka tab **Evaluations** saja). CSV tab Evaluations juga diterima.
3. Berkas dibaca di peramban. Yang dikirim ke portal hanya `evaluationId`, `timestamp`, `pos`, `guideId`, `uniform`, `idCard`, `etika`, `status` — **tanpa catatan, nama petugas, atau jam terima**. Dikirim per bagian (≤ 800 baris, ≤ 100 KB) karena batas badan permintaan portal 128 KB.
4. **Pratinjau** tidak menyimpan apa pun: jumlah masuk/dilewati/ditolak, tabel per bulan untuk dicocokkan dengan tab Dasbor NilaiGuide, dan nomor baris yang bermasalah.
5. **Terapkan**: portal menyimpan rekap harian per guide per pos (`visit_daily_totals`, sumber `nilaiguide`) dan daftar ID yang sudah diimpor (`visit_history_ids`). Bila koneksi putus, bagian yang sudah diterima tersimpan; pilih **Lanjutkan** dengan berkas yang sama (dicek lewat SHA-256). Riwayat baru dihitung di Dashboard dan Laporan setelah semua bagian diterima.
6. **Batalkan migrasi** menghapus seluruh rekap NilaiGuide dan ID-nya; angka kembali seperti sebelum impor, lalu migrasi bisa diulang. Hanya satu migrasi aktif pada satu waktu.

Aturan baca mengikuti NilaiGuide: tanggal seri Sheets dibaca sebagai jam WITA; Uniform seperti `normalUniform_` (TRUE +1, FALSE/0/kosong −1, dibatasi −1..+2); ID-card `Number(x)` → 1/0; Etika dibatasi −5..+5; baris `diganti` dilewati. Selain itu dilewati: Pos 2, ID ganda di berkas, dan baris yang bentrok (< 15 menit, guide + pos sama) dengan penilaian portal. Ditolak: ID bukan UUID, tanggal di luar 1 Januari 2026 – hari ini, pos tidak dikenal, guide tidak ada di Data Guide, ID yang sudah tersimpan di portal. REVIEW tidak diimpor (diisi 0).

## Tindak lanjut

- Dashboard (rentang preset, pembanding, tren, cakupan), laporan mingguan dan bulanan, ekspor Excel, dan tampilan cetak A4 — PR berikutnya. Format NILAI REWARD rekap regu menunggu revisi pemilik.
- Penyalinan terjadwal (pg_cron + pg_net) bila kiriman pos jarang; sekarang penyalinan dipicu kiriman dan tombol portal.
- Layar Pengaturan modul untuk batas frekuensi dan nama pos.
- Kebijakan privasi portal: formulir penilaian guide, nama guide sebagai data pribadi, salinan di Google Drive portal (ATR-KM-10).
- Rekonsiliasi sumber `supabase/functions/portal-api/index.ts` dan `router.mjs` dengan snapshot produksi (temuan T1); rute visits saat ini hanya masuk lewat `build-visits-deploy.mjs`, seperti modul Cuti.
