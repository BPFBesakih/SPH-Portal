# Pengelolaan Kunjungan — Penilaian Guide (tahap 1)

Ruang kerja kelima di portal. Penilaian guide di pos pemeriksaan dicatat lewat `bpbesakih.com/penilaian-guide/` (PWA hasil pindahan NilaiGuide) dan **disimpan di basis data portal**. Setiap penilaian disalin otomatis ke **spreadsheet baru** di Google Drive portal: folder `SPH-Portal-Kunjungan`, satu file per tahun (`Penilaian Guide 2026`), satu tab per bulan (`2026-11`). Kolom A–M sama dengan tab Evaluations lama: `evaluationId, timestamp, pos, guideId, guideName, uniform, idCard, review, etika, catatan, receivedAt, koreksiDari, status`. Sejak penilaian "100 − potongan" ditambah kolom N–T: `versi, seragam, teguran, pelanggaranBerat, apresiasi, petugas, nilai` (lihat [Penilaian "100 − potongan"](#penilaian-100--potongan)).

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
| Nilai | **Cara baru (versi 2, PWA 2.2.0):** ID-Card Terpasang/Tidak, Seragam Lengkap/Kurang lengkap/Tidak berseragam, teguran 0–2 kode berbeda dari daftar aktif, pelanggaran berat dan apresiasi masing-masing paling banyak satu kode (catatan wajib ≥ 3 huruf bila dipilih atau bila jenisnya "perlu catatan"), `petugasId` opsional (harus petugas aktif). **Cara lama (versi 1)** tetap diterima selama HP belum diperbarui: Uniform −1/+1/+2, ID-card Ya/Tidak, Etika −5..+5. Catatan ≤ 500 huruf (disimpan apa adanya; di spreadsheet ditulis sebagai teks, tidak pernah menjadi rumus). |
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

## Penilaian "100 − potongan"

Dasar: usulan `usulan-rumus-nilai-pengantaran.md` yang disetujui pemilik 11 November 2026. Petugas pos **hanya mencatat fakta**; nilai dihitung portal.

| Yang dicatat petugas | Pilihan | Potongan awal |
| --- | --- | --- |
| ID-Card | Terpasang / Tidak | Tidak: −20 |
| Seragam | Lengkap / Kurang lengkap / Tidak berseragam | 0 / −10 / −20 |
| Teguran | 0–2 jenis dari daftar | −20 per teguran |
| Pelanggaran berat | paling banyak 1, catatan wajib | tidak dirata-rata; bila **disetujui** Pengelola Kunjungan, guide gugur reward bulan itu |
| Apresiasi | opsional, catatan wajib | tidak masuk nilai; bila disetujui, penentu saat nilai sama |

- **Nilai pengantaran = 100 − potongan** (paling rendah 0; dengan batas aturan di bawah potongan tidak pernah melebihi 100). **Nilai bulanan = rata-rata** nilai pengantaran guide itu.
- **Layak reward**: nilai ≥ 95, minimal 10 pengantaran, tanpa pelanggaran berat terverifikasi. Status hanya tampil untuk tepat satu bulan kalender. Urutan status: gugur → belum cukup data → di bawah ambang → layak (laporan berat yang belum diputuskan diberi keterangan).
- **Peringkat**: nilai lebih tinggi didahulukan; bila sama, apresiasi terverifikasi lebih banyak; selebihnya setara. **Jumlah pengantaran tidak pernah menjadi penentu.**
- **Aturan Nilai** (Pengelola Kunjungan): besar potongan, ambang, dan minimal pengantaran disimpan per bulan berlaku. Perubahan hanya untuk bulan depan atau sesudahnya (bulan berjalan dan bulan lalu tidak bisa diubah) dan diaudit. Batas: potongan 0–50, kurang lengkap ≤ tidak berseragam, potongan maksimum satu pengantaran (tanpa ID + tidak berseragam + 2 teguran) ≤ 100, ambang 50–100, minimal 1–60. Aturan awal berlaku mulai Januari 2026 (−20/−10/−20/−20, 95, 10).
- **Daftar jenis** teguran/pelanggaran berat/apresiasi bisa ditambah, diubah namanya, atau dinonaktifkan; kodenya tetap (tidak pernah dipakai ulang) sehingga data lama tetap terbaca. Daftar awal masih **contoh** sampai pemilik mengirim daftar resmi.
- **Petugas penilai**: dipilih sekali per shift di HP pos (berlaku 8 jam), tanpa login. Nama tersimpan bersama penilaian dan tampil di Dashboard (per petugas, hanya dari rincian 6 minggu terakhir).
- **Petunjuk formulir**: teks patokan ID-Card dan Seragam tampil di bawah tombolnya, supaya Pos 1 dan Pos 3 menilai dengan cara yang sama. HP pos memperbarui daftar jenis, petugas, dan petunjuk bersama daftar guide.
- **Verifikasi**: pelanggaran berat dan apresiasi masuk sebagai *menunggu*. Pengelola menyetujui atau menolak (catatan keputusan wajib), bisa dibuka kembali; semuanya diaudit. Koreksi penilaian dari HP membatalkan laporan yang masih menunggu.
- **Data lama (versi 1)** dipetakan ke cara baru: ID 0 → tanpa ID; Uniform −1 → tidak berseragam (selain itu lengkap); Etika < 0 pada guide berseragam → 1 teguran; Etika positif dan REVIEW diabaikan. Bulan peralihan mencampur baris lama (dipetakan) dan baris baru. Riwayat NilaiGuide hasil migrasi awal dipetakan dengan aturan yang sama.
- **Rekap harian** (`visit_daily_totals`) kini juga menyimpan jumlah temuan (`n_id`, `n_kurang`, `n_tidak`, `n_teguran`), sehingga nilai bulan lama setelah pelipatan tetap persis sama. Migrasi mengisi kolom ini untuk rekap yang sudah ada dari kolom lama.
- **Spreadsheet**: kolom N–T ditambahkan; tab bulan lama yang masih 13 kolom dilebarkan otomatis saat ditulis. Baris versi 1 mengosongkan N–T.
- **PWA 2.2.1**: formulir baru, riwayat HP menampilkan temuan dan petugas, CSV HP berisi temuan per pengantaran. HP yang belum diperbarui tetap mengirim cara lama dan tetap diterima. Koreksi cara lama meminta penentuan jenis atau konfirmasi sebelum menghapus teguran; laporan nonaktif yang sudah dipilih tetap terlihat.

## Isi modul

| Bagian | Berkas | Keterangan |
| --- | --- | --- |
| Formulir lapangan | `public/penilaian-guide/` → `site-info/dist/penilaian-guide/` | PWA NilaiGuide yang dipindah: offline, tanpa login. Pos ditentukan tautan pos (token di fragmen URL). |
| Gateway publik | `site-info/lib/guide-form.mjs`, `site-info/functions/api/guide-form/[[action]].js` | `POST /api/guide-form/{context,submit}`: origin, `CF-Connecting-IP`, badan ≤ 24 KB, lalu ke Edge `guide-form` dengan secret server. |
| Edge publik | `supabase/functions/guide-form/index.ts` → `supabase/deploy/guide-form/index.ts` (`scripts/build-guide-form.mjs`) | Batas frekuensi, token → tautan aktif, aturan terima di bawah kunci khusus modul, salinan di latar belakang. Tanpa kunci global portal. |
| Aturan & rekap | `lib/visit-data.mjs` | Aturan terima, Data Guide + impor, daftar penilaian, rekap "100 − potongan", peringkat dan status reward, rekap per hari untuk rentang bebas, migrasi awal NilaiGuide. |
| Aturan nilai & verifikasi | `lib/visit-scoring.mjs` | Besar potongan per bulan (`visit_score_rules`), daftar teguran/pelanggaran berat/apresiasi (`visit_finding_types`), petugas penilai (`visit_assessors`), petunjuk formulir (`visit_form_settings`), laporan yang menunggu keputusan (`visit_flags`). |
| Salinan & retensi | `lib/visit-sheets.mjs` | Google Sheets/Drive lewat OAuth yang sama dengan unggah berkas (`GOOGLE_DRIVE_*`), lease, tulis posisional, verifikasi, pelipatan bulanan, pemeriksaan koneksi. |
| Rute pengelolaan | `lib/visits.mjs` → `_shared/portal/*.mjs`, disuntikkan ke snapshot `portal-api` oleh `scripts/build-visits-deploy.mjs` (snapshot sebelum Kunjungan) atau diperbarui oleh `scripts/build-visits-update.mjs` (snapshot yang sudah memuat Kunjungan, misalnya setelah Absensi) | Rute basis data di `routeOperation`; `visits/sheet/sync` dan `visits/sheet/check` dicegat sebelum transaksi permintaan. |
| Formulir pos | `lib/guide-form.mjs` | Pemeriksaan bentuk, batas 60 `context` dan 300 penilaian per 10 menit per tautan dan per IP, catatan kiriman tanpa isi nilai (90 hari). |
| Ruang kerja | `public/visits.js`, `public/visit-import.js` (+ `app.js`, `pages.js`, `role-permissions.js`, `styles.css`) | Dashboard, Data Guide (impor .xlsx/.csv di peramban), Penilaian, Verifikasi, Tautan Pos + Salinan spreadsheet, Aturan Nilai, Laporan & Ekspor (+ kartu Migrasi awal NilaiGuide). |
| Basis data | `supabase/migrations/20261103100000_visit_management.sql`, `…/20261104090000_visit_portal_storage.sql`, `…/20261104120000_visit_daily_totals_history.sql`, `…/20261113100000_visit_objective_scoring.sql`, `schema.sql` | Tautan pos, batas frekuensi, catatan kiriman; `visit_guides`, `visit_evaluations`, `visit_monthly_totals`, `visit_daily_totals`, `visit_history_import`, `visit_history_ids`, `visit_sheet_files`, `visit_sheet_tabs`, `visit_sheet_state`, `visit_score_rules`, `visit_finding_types`, `visit_assessors`, `visit_flags`, `visit_form_settings`. Semua RLS, tanpa grant ke anon/authenticated/service_role. **IT_ADMIN tidak diberi izin visits.** |
| Uji | `tests/visits.test.mjs`, `tests/visit-history.test.mjs`, `tests/guide-form-transport.test.mjs`, `scripts/verify-visits-postgres.mjs`, `scripts/verify-guide-form-ui.mjs`, `scripts/fake-google-sheets.mjs` | Google tiruan yang ketat (batas grid, galat bergaya Google); tidak pernah menghubungi Google. |

## Izin

| Izin | Pengelola | Pimpinan |
| --- | --- | --- |
| `visits.dashboard.read`, `visits.guides.read`, `visits.records.read`, `visits.reports.read`, `visits.reports.export` | ya | ya |
| `visits.guides.manage` (ubah & impor guide), `visits.forms.read`, `visits.forms.manage` (tautan pos), `visits.settings.manage` (sinkronkan, periksa koneksi, migrasi awal NilaiGuide, **Aturan Nilai**, **memutuskan Verifikasi**) | ya | — |

Pimpinan dapat membuka Verifikasi dan Aturan Nilai untuk melihat saja (tanpa daftar petugas penilai). Penilaian "100 − potongan" tidak menambah izin baru.

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
10. Penilaian "100 − potongan": di HP pilih nama petugas, isi ID-Card, Seragam, teguran (paling banyak 2), dan laporan pelanggaran berat/apresiasi (catatan wajib). Lihat nilai di Penilaian (mis. tanpa ID + kurang lengkap = 70), lalu putuskan laporannya di **Verifikasi** dan lihat status reward di Laporan & Ekspor. Di **Aturan Nilai**, rencanakan potongan bulan depan, tambah petugas atau jenis teguran; HP mendapatkannya setelah Pengaturan → Tes Koneksi.

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

Diperbarui 11 November 2026 di atas master `b739829` (Absensi PR #31): `portal-api` dibangun ulang dari snapshot yang memuat Absensi, jadi Absensi, Cuti khusus, dan tambalan lain tetap utuh.

1. SQL Editor: `20261104120000_visit_daily_totals_history.sql`. Bila muncul *"visit_monthly_totals sudah terisi"*, berhenti dan laporkan — jangan dipaksa.
2. Edge Function `guide-form`: deploy `supabase/deploy/guide-form/index.ts` (SHA-256 `a2b43df876ed6f0de6c023ecad5085b0091966a42366629211f5e46ea957142b`; pelipatan berjalan dari fungsi ini).
3. Edge Function `portal-api`: unduh versi aktif, simpan salinannya sebagai titik kembali, lalu hitung SHA-256-nya.
   - Bila sama dengan `d3c7448447f92bafc0e93b107c93d9d657166e947fefde32f8755876a50f98b1` (master `b739829`, Absensi), deploy `supabase/deploy/portal-api/index.ts` (SHA-256 `7a301b848978a6052c803e13ddf2fc2da1b36d7d773281ddf6d32345e10833b7`).
   - Bila berbeda, jalankan `node scripts/build-visits-update.mjs <berkas-aktif.ts> <sha256>` dan deploy hasilnya. Skrip ini hanya mengganti lingkup `__visits` dan impor `__visits_*`; isi snapshot lain tidak berubah. Skrip menolak sendiri bila hash tidak cocok atau snapshot belum memuat modul Kunjungan.
4. Merge PR: Pages menayangkan kartu Migrasi awal.

Rollback: `portal-api` → salinan versi aktif yang disimpan di langkah 3 (`d3c7448…98b1`), `guide-form` → versi sebelumnya (`632ca9b2…`; keduanya tetap mengisi/membaca `visit_monthly_totals`), Pages → deployment sebelumnya. Tabel baru dibiarkan. Migrasi awal yang sudah diterapkan bisa dibatalkan dari kartunya kapan pun sebelum rollback.

### Rilis penilaian "100 − potongan" (branch `claude/kunjungan-nilai-pengantaran`)

Branch ini **sudah memuat** rekap harian + migrasi awal (PR #20) dan master `cede9c9` (E-Arsip PR #35), jadi cukup rilis branch ini; PR #20 tidak perlu dirilis terpisah. Urutan penting: formulir HP versi baru (Pages) baru boleh tayang setelah `guide-form` baru aktif, dan `guide-form` baru butuh kolom baru di basis data.

1. SQL Editor, berurutan:
   - `20261104120000_visit_daily_totals_history.sql` (bila belum pernah dijalankan). Bila muncul *"visit_monthly_totals sudah terisi"*, berhenti dan laporkan.
   - `20261113100000_visit_objective_scoring.sql`. Aditif: kolom baru berisi nilai bawaan yang cocok untuk data lama, jadi `guide-form` dan `portal-api` lama tetap berjalan sampai langkah 2–3.
   - `20261113034733_visit_review_integrity.sql`. Menambahkan waktu/guide/pos pada ID riwayat untuk mencegah bentrok dengan antrean offline, dan identitas kejadian lintas koreksi. Jalankan juga bila dua migrasi sebelumnya sudah diterapkan. Timestamp berkas hasil CLI lebih awal daripada timestamp rencana penilaian; berkas mendukung urutan instalasi baru maupun upgrade. Kolom baru tetap menerima nilai kosong dari Edge versi sebelumnya selama pergantian versi.
2. Edge Function `guide-form`: simpan dulu versi aktif sebagai titik kembali, lalu deploy `supabase/deploy/guide-form/index.ts` (SHA-256 `99fa8bfeb69420240e0020c677812897431a2e604d324fa79a0ff44acef6a34b`). Kerjakan segera setelah langkah 1 dan sebelum pelipatan pertama (±16 Desember), karena hanya versi ini yang mengisi jumlah temuan di rekap harian.
3. Edge Function `portal-api`: unduh versi aktif, simpan salinannya, hitung SHA-256-nya.
   - Bila sama dengan `bf81f3229d4b21e287849f811785ebc4f9a63493327547f11dfc656fd5b9fa48` (master `cede9c9`), deploy `supabase/deploy/portal-api/index.ts` (SHA-256 `00d65ac2a1e9d001f494417b0a77d7c78c2a273325e5461db495507c20a54d04`).
   - Bila berbeda, jalankan `node scripts/build-visits-update.mjs <berkas-aktif.ts> <sha256>` dan deploy hasilnya (hanya lingkup `__visits` yang diganti).
4. Merge ke `master`: Pages menayangkan ruang kerja (Verifikasi, Aturan Nilai) dan PWA 2.2.1. HP pos memperbarui diri saat dibuka dalam keadaan online; antrean yang belum terkirim tetap terkirim (dengan cara lama).
5. Persiapan di portal (Pengelola Kunjungan): Aturan Nilai → **Tambah petugas** (nama petugas pos), periksa daftar teguran/pelanggaran berat/apresiasi, sesuaikan **Petunjuk di formulir pos**. Di HP pos: buka tautan, pilih nama petugas.

Rollback: `portal-api` dan `guide-form` → salinan yang disimpan di langkah 2–3 (versi lama membaca kolom lama, yang tetap diisi untuk setiap penilaian baru: ID dari ID-Card, Uniform +1/−1 dari seragam, Etika = −jumlah teguran); Pages → deployment sebelumnya (HP kembali ke formulir lama saat dibuka online). Tabel dan kolom baru dibiarkan. Catatan: bila pelipatan sempat berjalan dengan `guide-form` lama, hari yang dilipat saat itu tidak punya jumlah teguran/kurang lengkap; sebelum rilis ulang jalankan lagi baris `UPDATE … SET n_id=…, n_tidak=…` dari migrasi dengan `WHERE` tanggal hari-hari tersebut saja (jangan untuk hari lain, karena `n_tidak` hari yang dilipat versi baru sudah benar) (teguran dan kurang lengkap hari itu tidak bisa dipulihkan dari rekap; rinciannya ada di spreadsheet).

Bila PR #20 sudah lebih dulu dirilis dan migrasi awal NilaiGuide sudah diterapkan dengan kode lama, rekap riwayat itu belum memuat teguran dari Etika (hanya tanpa ID dan tidak berseragam yang terisi lewat migrasi). Batalkan migrasi awal lalu ulangi setelah rilis ini supaya bulan-bulan lama dihitung dengan pemetaan lengkap.

## Keputusan yang dipakai

- Penyimpanan: basis data portal + salinan spreadsheet baru (keputusan pemilik, 3 November). Retensi 42 hari, umur kiriman 30 hari, rekap harian untuk periode lama (4 November; sebelumnya ringkasan bulanan).
- Riwayat NilaiGuide: diekspor **sekali** sebagai migrasi awal; sesudahnya penilaian hanya lewat portal. Pos 2 dan REVIEW tidak diimpor (keputusan pemilik, 4 November).
- Satu spreadsheet per tahun, satu tab per bulan (WITA), kolom sama dengan tab Evaluations lama (kolom `review` diisi 0).
- Data Guide awal dari impor berkas tab Guides; ID lama dipertahankan.
- REVIEW belum dipakai (tidak ada di Dashboard, Laporan, dan ekspor).
- Penilaian "100 − potongan" (keputusan pemilik, 11 November): mulai segera setelah siap; bulan peralihan mencampur baris lama yang dipetakan; verifikasi oleh Pengelola Kunjungan dan diaudit; nama petugas dicatat (pilih sekali per shift di HP pos, tanpa login); besar potongan, ambang 95, dan minimal 10 bisa diubah Pengelola, berlaku bulan berikutnya, diaudit.
- Nama kembar di regu yang sama ditolak di form satuan; di impor hanya diperingatkan.
- Batas frekuensi formulir: 60 `context` dan 300 penilaian per 10 menit, per tautan dan per IP. Alamat `/penilaian-guide/`, nama ruang kerja "Kunjungan".

## Migrasi awal NilaiGuide

Spreadsheet NilaiGuide lama tetap menjadi arsip dan tidak diubah. Riwayatnya masuk ke portal **sekali** lewat Laporan & Ekspor → kartu **Migrasi awal NilaiGuide** (izin `visits.settings.manage`):

1. Lakukan setelah HP terakhir pindah ke tautan portal dan Data Guide sudah diimpor (guide dicocokkan lewat ID `G-…`).
2. Di spreadsheet NilaiGuide: *File → Download → Microsoft Excel (.xlsx)* (seluruh spreadsheet; portal membuka tab **Evaluations** saja). CSV tab Evaluations juga diterima.
3. Berkas dibaca di peramban. Yang dikirim ke portal hanya `evaluationId`, `timestamp`, `pos`, `guideId`, `uniform`, `idCard`, `etika`, `status` — **tanpa catatan, nama petugas, atau jam terima**. Dikirim per bagian (≤ 800 baris, ≤ 100 KB) karena batas badan permintaan portal 128 KB.
4. **Pratinjau** tidak menyimpan apa pun: jumlah masuk/dilewati/ditolak, tabel per bulan untuk dicocokkan dengan tab Dasbor NilaiGuide, dan nomor baris yang bermasalah.
5. **Terapkan**: portal menyimpan rekap harian per guide per pos (`visit_daily_totals`, sumber `nilaiguide`) dan daftar ID beserta guide, pos, dan waktu yang sudah diimpor (`visit_history_ids`) untuk mencegah hitungan ganda ketika antrean portal menyusul. Bila koneksi putus, bagian yang sudah diterima tersimpan; pilih **Lanjutkan** dengan berkas yang sama (dicek lewat SHA-256), termasuk bila hanya tahap penyelesaian yang belum berhasil. Riwayat baru dihitung di Dashboard dan Laporan setelah semua bagian diterima.
6. **Batalkan migrasi** menghapus seluruh rekap NilaiGuide dan ID-nya; angka kembali seperti sebelum impor, lalu migrasi bisa diulang. Hanya satu migrasi aktif pada satu waktu.

Aturan baca mengikuti NilaiGuide: tanggal seri Sheets dibaca sebagai jam WITA; Uniform seperti `normalUniform_` (TRUE +1, FALSE/0/kosong −1, dibatasi −1..+2); ID-card `Number(x)` → 1/0; Etika dibatasi −5..+5; baris `diganti` dilewati. Selain itu dilewati: Pos 2, ID ganda di berkas, dan baris yang bentrok (< 15 menit, guide + pos sama) dengan penilaian portal. Ditolak: ID bukan UUID, tanggal di luar 1 Januari 2026 – hari ini, pos tidak dikenal, guide tidak ada di Data Guide, ID yang sudah tersimpan di portal. REVIEW tidak diimpor (diisi 0).

Pengaman bentrok juga berlaku bila riwayat masuk lebih dulu: pengantaran portal dalam jeda 15 menit tidak ditambahkan lagi dan HP mendapat penjelasan. Selama migrasi masih disusun, kiriman yang bertumpang tindih menunggu tanpa dianggap ditolak permanen; selesaikan atau batalkan migrasi. Bila riwayat versi sebelumnya tidak memiliki waktu per ID, batalkan dan impor ulang sebelum memproses antrean untuk hari/guide/pos yang sama. Jika rincian portal sudah dilipat dan hanya ada rekap harian, impor yang bertumpang tindih ditahan dengan pesan untuk mencocokkan spreadsheet terlebih dahulu; aplikasi tidak menebak kejadian yang sama.

### Perbaikan hasil assessment PR #36

- Apresiasi/pelanggaran dihitung per kejadian pengantaran, sehingga koreksi berulang tidak menambah apresiasi. Keputusan lama tetap disimpan; identitas kejadian dipertahankan setelah retensi.
- Audit keputusan menyimpan keadaan sebelum/sesudah, alasan, penentu, dan waktu, termasuk saat keputusan dibuka kembali.
- Koreksi cara lama memperlihatkan satu teguran yang perlu ditentukan jenisnya. Menghapusnya perlu konfirmasi eksplisit, termasuk bila koreksi sempat tersimpan sebagai draf.
- Pilihan pelanggaran/apresiasi nonaktif yang sudah ada pada draf/koreksi tetap terlihat dan dapat dihapus secara eksplisit.
- Kelanjutan migrasi memakai bagian yang sudah tersimpan, bukan hanya jumlah baris baru pada pratinjau ulang.
- Impor, pembatalan, penyelesaian, dan pelipatan di PostgreSQL memakai kunci transaksi modul yang sama dengan kiriman HP untuk mencegah benturan saat bersamaan.

Regresi tambahan: `tests/visit-flag-corrections.test.mjs`, `tests/visit-history-overlap.test.mjs`, tambahan alur di `scripts/verify-guide-form-ui.mjs`, serta `scripts/verify-visit-resume-ui.mjs`. Semua memakai data fiktif dan layanan tiruan.

Validasi ulang setelah perbaikan: 381/381 tes aplikasi, 18/18 pemeriksaan PostgreSQL (termasuk paket Edge dan upgrade skema lama), 29/29 alur formulir/ruang kerja, 5/5 alur kelanjutan migrasi, dan 5/5 pemeriksaan PWA. Isi gateway di luar lingkup Kunjungan tetap identik dengan paket sebelum perbaikan.

## Tindak lanjut

- Dashboard (rentang preset, pembanding, tren, cakupan), laporan mingguan dan bulanan, ekspor Excel, dan tampilan cetak A4 — PR berikutnya. Format NILAI REWARD rekap regu menunggu revisi pemilik.
- Menunggu pemilik: daftar resmi atribut seragam (untuk petunjuk "Kurang lengkap"), daftar resmi jenis teguran/pelanggaran berat/apresiasi (daftar awal masih contoh), dan jawaban apakah Pos 3 memeriksa ID-Card dengan cara yang sama.
- Penyalinan terjadwal (pg_cron + pg_net) bila kiriman pos jarang; sekarang penyalinan dipicu kiriman dan tombol portal.
- Layar Pengaturan modul untuk batas frekuensi dan nama pos.
- Kebijakan privasi portal: formulir penilaian guide, nama guide sebagai data pribadi, salinan di Google Drive portal (ATR-KM-10).
- Rekonsiliasi sumber `supabase/functions/portal-api/index.ts` dan `router.mjs` dengan snapshot produksi (temuan T1); rute visits saat ini hanya masuk lewat `build-visits-deploy.mjs`, seperti modul Cuti.
