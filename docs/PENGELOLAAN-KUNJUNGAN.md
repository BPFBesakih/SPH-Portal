# Pengelolaan Kunjungan — Penilaian Guide (tahap 1)

Ruang kerja kelima di portal. Penilaian guide di pos pemeriksaan pindah dari aplikasi NilaiGuide (nilaiguide.vercel.app) ke `bpbesakih.com/penilaian-guide/`, tetapi **data tetap di Google Spreadsheet NilaiGuide**: tab Evaluations, Guides, Rekap regu, dan Dasbor tidak berubah. Portal hanya menyimpan tautan pos dan catatan kiriman. Rancangan lengkap ada di PRD (dokumen Project "PRD Modul Pengelolaan Kunjungan").

## Isi modul

| Bagian | Berkas | Keterangan |
| --- | --- | --- |
| Formulir lapangan | `public/penilaian-guide/` → `site-info/dist/penilaian-guide/` | PWA NilaiGuide yang dipindah: offline, terenkripsi, tanpa login. Pos ditentukan tautan pos (token di fragmen URL). |
| Gateway publik | `site-info/lib/guide-form.mjs`, `site-info/functions/api/guide-form/[[action]].js` | `POST /api/guide-form/{context,submit}`: origin, `CF-Connecting-IP`, badan ≤ 24 KB, lalu ke Edge `guide-form` dengan secret server. |
| Edge publik | `supabase/functions/guide-form/index.ts` → `supabase/deploy/guide-form/index.ts` (`scripts/build-guide-form.mjs`) | Batas frekuensi, token → tautan aktif, jembatan **di luar** transaksi, tanpa kunci global. |
| Rute pengelolaan | `lib/visits.mjs` → `_shared/portal/visits.mjs`, disuntikkan ke snapshot `portal-api` oleh `scripts/build-visits-deploy.mjs` | Tautan pos, aktivitas, audit ekspor (database); dashboard, guide, penilaian, REVIEW, kesehatan (jembatan). |
| Klien jembatan | `lib/visits-bridge.mjs` | Hanya `https://script.google.com/macros/s/…/exec`, mengikuti 302 hanya ke `script.googleusercontent.com` dengan GET tanpa kredensial. |
| Aturan formulir | `lib/guide-form.mjs` | Pemeriksaan bentuk, batas 60 `context` dan 300 penilaian per 10 menit per tautan dan per IP, catatan kiriman tanpa isi nilai. |
| Ruang kerja | `public/visits.js` (+ `app.js`, `pages.js`, `role-permissions.js`, `styles.css`) | Dashboard, Data Guide, Penilaian, Tautan Pos, Laporan & Ekspor. |
| Basis data | `supabase/migrations/20261103100000_visit_management.sql`, `schema.sql` | `guide_form_links`, `guide_form_rate_limits`, `guide_form_submissions`; izin `visits.*`; role `KUNJUNGAN_PENGELOLA` dan `KUNJUNGAN_PIMPINAN`. **IT_ADMIN tidak diberi izin visits.** |
| Jembatan Apps Script | repo NilaiGuide, branch `claude/jembatan-portal`: `server-gas/13_Jembatan.gs` | Satu aturan terima (`terimaPenilaian_`) untuk portal dan aplikasi lama. Lihat `docs/JEMBATAN-PORTAL.md` di repo itu. |

## Izin

| Izin | Pengelola | Pimpinan |
| --- | --- | --- |
| `visits.dashboard.read`, `visits.guides.read`, `visits.records.read`, `visits.reports.read`, `visits.reports.export` | ya | ya |
| `visits.guides.manage`, `visits.forms.read`, `visits.forms.manage`, `visits.settings.manage` | ya | — |

Super Admin memegang semua izin `visits.*`. `visits.settings.manage` sudah ada tetapi belum punya layar; batas frekuensi dan nama pos masih konstanta di `lib/guide-form.mjs`.

## Uji lokal (Windows)

Butuh dua folder: SPH-Portal di branch `claude/pengelolaan-kunjungan`, dan NilaiGuide di branch `claude/jembatan-portal` (lihat bagian NilaiGuide di deskripsi PR).

Cara tercepat, satu perintah, data fiktif, tanpa layanan cloud:

```powershell
cd $HOME\Documents\GitHub\SPH-Portal-uji
node scripts/preview-kunjungan.mjs $HOME\Documents\GitHub\nilaiguide
```

- Portal: http://127.0.0.1:4615/#visits — akun `kunjungan.preview`, `pimpinan.preview`, `admin.preview`, `sdm.preview` (password `Preview2026!`).
- Formulir Pos 1 dan Pos 3: alamatnya tercetak di terminal (token pratinjau tetap, hanya untuk uji).
- Jembatan tiruan menjalankan kode Apps Script NilaiGuide yang asli di atas spreadsheet palsu berisi 42 guide fiktif dan riwayat tiga minggu. Isinya disimpan di `data/jembatan-uji/` (diabaikan Git); hapus folder itu untuk mulai dari awal.

Yang layak dicoba:

1. Buka formulir tanpa token (`/penilaian-guide/`): hanya petunjuk dan kotak tempel tautan.
2. Buka tautan Pos 1: daftar guide termuat, token hilang dari bilah alamat. Isi penilaian, muat ulang halaman (draf pulih), lalu SIMPAN.
3. Nilai guide yang sama lagi: aplikasi menahan (< 15 menit). Tekan *Betulkan penilaian itu*, ubah, SIMPAN: baris lama menjadi `diganti` di Penilaian.
4. Matikan Wi-Fi (atau DevTools → Offline), simpan beberapa penilaian, nyalakan lagi: ⏳ menjadi ✅.
5. Di portal: Tautan Pos → Ganti tautan Pos 1. HP yang masih memakai tautan lama menampilkan spanduk "Tautan pos sudah diganti" dan antreannya menunggu; buka tautan baru, antrean terkirim.
6. Data Guide: tambah guide; nama yang sama di regu yang sama ditolak. Guide baru muncul di formulir setelah *Tes Koneksi & Perbarui Daftar Guide*.
7. Penilaian dan Laporan: ekspor Excel.
8. Masuk sebagai `pimpinan.preview` (tanpa Tautan Pos dan tanpa ubah guide) dan `sdm.preview` (tanpa ruang kerja Kunjungan).

Memakai server demo biasa (`scripts/demo.mjs` + `server.mjs`) juga bisa. Jalankan jembatan tiruan di terminal lain, lalu isi variabelnya:

```powershell
node scripts/visits-bridge-dev.mjs $HOME\Documents\GitHub\nilaiguide   # terminal 1
$env:VISITS_BRIDGE_URL = 'http://127.0.0.1:4620/exec'                    # terminal 2
$env:VISITS_BRIDGE_KEY = '<kunci yang dicetak terminal 1>'
node server.mjs
```

Akun demo tambahan: `kunjungan.demo` dan `pimpinan.kunjungan.demo`. Tautan pos dibuat dari Kunjungan → Tautan Pos.

Pemeriksaan otomatis:

```powershell
node --test tests/*.test.mjs                                   # termasuk tests/visits.test.mjs dan guide-form-transport
$env:NILAIGUIDE_DIR = "$HOME\Documents\GitHub\nilaiguide"; node --test tests/visits.test.mjs   # + uji ujung-ke-ujung dengan kode Apps Script asli
node scripts/verify-visits-postgres.mjs $P                     # PGlite: migrasi, Edge guide-form, snapshot portal-api
node scripts/verify-guide-form-ui.mjs $HOME\Documents\GitHub\nilaiguide   # Playwright, butuh paket playwright
```

### Batas uji lokal

- Server lokal (SQLite) menjalankan aturan yang sama dari `lib/`, tetapi bukan snapshot `portal-api` produksi. Tambalan produksi (Superadmin/IT-admin) diuji lewat `verify-visits-postgres.mjs` di atas snapshot yang sudah ditambal, bukan di Supabase sungguhan.
- Jembatan tiruan bukan Google Apps Script: kuota, waktu kunci 20 detik, pengalihan 302 asli, dan trigger rekap tidak tercakup. Uji `health` dan satu kiriman ke **salinan** spreadsheet setelah jembatan dipasang.
- PWA terpasang di layar utama (Android/iPhone), service worker setelah versi baru, dan kamera QR hanya bisa dicek di HP sungguhan.
- REVIEW di Laporan kosong di jembatan tiruan karena tab Rekap regu tidak disusun di sana.

## Rilis (oleh pemilik repo)

Urutan mengikuti PRD: Apps Script dulu, lalu Supabase, lalu Pages.

1. **NilaiGuide**: merge `claude/jembatan-portal`, `npm run build:gas`, tempel `Code.gs`, Save. Script Properties: `JEMBATAN_KUNCI` (acak, ≥ 48 karakter) dan `TERIMA_APLIKASI_LAMA=true`. Deploy → Manage deployments → deployment lama → *New version*. Deploy → *New deployment* (Execute as: Me, Who has access: Anyone) untuk jembatan; salin alamat `/exec`-nya.
2. **Uji jembatan** ke salinan spreadsheet: operasi `health` dan `form.context` dengan kunci.
3. **Supabase Secrets**: `VISITS_BRIDGE_URL` (alamat `/exec` jembatan), `VISITS_BRIDGE_KEY` (sama dengan `JEMBATAN_KUNCI`), `VISITS_IP_HMAC_KEY` (acak, ≥ 32 karakter).
4. **Migrasi**: jalankan `supabase/migrations/20261103100000_visit_management.sql` di SQL Editor.
5. **Edge Function `guide-form`** (baru): deploy dari `supabase/deploy/guide-form/index.ts`, `verify_jwt=false` seperti fungsi portal lain (autentikasi lewat `withSupabase({auth:'secret'})`). Pages Function `/api/guide-form/*` memakai `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, dan `PORTAL_ORIGIN` yang sudah ada.
6. **Edge Function `portal-api`**: pastikan versi yang sedang aktif sama dengan snapshot di `master` (SHA-256 `fd304a9e5a5b3e846bacdb2a428a2b7dc1210133ecd3be683441d4aff6100580`). Bila sama, deploy `supabase/deploy/portal-api/index.ts` dari branch ini. Bila berbeda, unduh versi aktif lalu jalankan ulang `node scripts/build-visits-deploy.mjs <versi-aktif.ts> <sha256>` dan deploy hasilnya. Catat nomor versi sebelumnya untuk rollback. Periksa `/api/health` 200.
7. **Merge** PR ke `master`: Pages menayangkan `/penilaian-guide/`, ruang kerja Kunjungan, `_headers`, dan `/api/guide-form/*`.
8. **Akun**: beri role Pengelola/Pimpinan Kunjungan di Role & Izin, lalu buat tautan Pos 1 dan Pos 3.
9. **Pilot dan cutover** sesuai PRD: satu HP Pos 1 dua hari, lalu per HP (Tertunda 0 dan Ditahan 0 di aplikasi lama sebelum pindah), lalu `TERIMA_APLIKASI_LAMA=false`, dan arsipkan deployment lama setelah 14 hari.

Rollback: kembalikan HP ke aplikasi lama (`TERIMA_APLIKASI_LAMA=true`), deploy ulang versi `portal-api` sebelumnya, cabut tautan pos. Migrasi aditif dan tidak dihapus.

## Keputusan yang dipakai sementara

Keputusan terbuka PRD diisi dengan usulan PRD dan bisa diubah sebelum rilis:

- Etika bawaan tetap 0 (teks aplikasi sekarang). Bila diputuskan +1, ubah `TUT` di `public/penilaian-guide/js/app/06-status.js`, teks bantuan di `index.html`, dan nilai awal formulir.
- Token tautan: hash + salinan privat (pola `/cuti/`), dihapus saat dicabut atau diganti.
- Umur antrean yang diterima jembatan: 60 hari; cap waktu > 10 menit di depan jam server ditolak.
- Batas frekuensi: 60 `context` dan 300 penilaian per 10 menit, per tautan dan per IP.
- Alamat `/penilaian-guide/`, nama ruang kerja "Kunjungan".

## Tindak lanjut

- Layar Pengaturan modul untuk `visits.settings.manage` (batas frekuensi, nama pos).
- Kebijakan privasi portal: formulir penilaian guide, nama guide sebagai data pribadi, penyimpanan di Google Spreadsheet (ATR-KM-10).
- *Protected range* tab Evaluations dan Guides di Sheets (ATR-KM-08).
- Rekonsiliasi sumber `supabase/functions/portal-api/index.ts` dan `router.mjs` dengan snapshot produksi (temuan T1); rute visits saat ini hanya masuk lewat `build-visits-deploy.mjs`, seperti modul Cuti.
