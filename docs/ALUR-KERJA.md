# Alur kerja perubahan: branch → uji lokal → merge

Berlaku sejak 3 November 2026 untuk semua perubahan, termasuk yang dikerjakan agen AI (Claude, Codex).

Prinsip utamanya: **`master` adalah produksi.** Setiap push atau merge ke `master` langsung ditayangkan Cloudflare Pages di bpbesakih.com. Karena itu semua pekerjaan dilakukan di branch terpisah, diuji lebih dulu, lalu di-merge oleh pemilik repo.

## Ringkasan alur

1. **Branch.** Perubahan dibuat di branch baru dari `master` terbaru:
   - `claude/<topik>` untuk pekerjaan Claude, `codex/<topik>` untuk Codex;
   - `feat/<topik>` dan `fix/<topik>` untuk pekerjaan manual.
2. **Pull request.** Branch di-push lalu dibuka PR ke `master`. Deskripsi PR mengikuti templat: ringkasan, cara uji lokal, hasil pemeriksaan, dan langkah rilis.
3. **CI otomatis.** Workflow **Tes** (`.github/workflows/tes.yml`) berjalan di setiap PR:
   - **Tes Node**: `node --test tests/*.test.mjs`;
   - **Build frontend sesuai source**: memastikan `site-info/dist` yang di-commit sama dengan hasil build dari `public/`;
   - **Verifikasi PostgreSQL (PGlite)**: semua migrasi dan bundel Edge diuji di PostgreSQL sementara.
4. **Uji lokal oleh pemilik repo** (lihat di bawah). Kalau belum cocok, beri komentar di PR atau sampaikan ke agen; perbaikan masuk ke branch yang sama.
5. **Rilis.** Bila PR menyentuh database atau Edge Function, terapkan dulu sesuai bagian Rilis.
6. **Merge** ke `master` oleh pemilik repo, lalu periksa situs produksi.
7. Hapus branch setelah merge (tombol *Delete branch* di PR).

Agen AI **tidak pernah** push ke `master`, merge PR, menjalankan migrasi produksi, men-deploy Edge Function, atau mengubah pengaturan Cloudflare, Supabase, dan Google. Semua langkah itu tetap di tangan pemilik repo.

## Uji lokal di Windows

Gunakan **folder uji terpisah** dari folder kerja utama. Folder kerja utama berisi banyak perubahan lokal yang belum di-push (lihat `KONTEKS-PROYEK.md` bagian 9), jadi berpindah branch di sana bisa mencampur pekerjaan.

Siapkan sekali saja:

```powershell
cd $HOME\Documents\GitHub
git clone https://github.com/BPFBesakih/SPH-Portal.git SPH-Portal-uji
cd SPH-Portal-uji
```

Setiap ada branch baru untuk diuji:

```powershell
cd $HOME\Documents\GitHub\SPH-Portal-uji
git switch master
git pull --ff-only
git fetch origin --prune
git switch <nama-branch>          # contoh: git switch claude/setup-alur-kerja
git pull --ff-only                # bila branch diperbarui setelah diuji

node --version                    # harus v24.x
node --test tests/*.test.mjs      # tes yang sama dengan CI
```

Mencoba aplikasi dengan data fiktif, memakai folder data terpisah per branch:

```powershell
node scripts/demo.mjs data/uji-<nama-singkat>
$env:DATA_DIR = 'data/uji-<nama-singkat>'
$env:APP_ORIGIN = 'http://127.0.0.1:3000'
$env:COOKIE_SECURE = 'false'
node server.mjs
```

Lalu buka http://127.0.0.1:3000. Akun demo `admin.demo`, `sdm.demo`, dan `petugas.demo` memakai password `BesakihDemo!2026` (data fiktif, bukan akun produksi). Hentikan server dengan `Ctrl+C`. Folder `data/` diabaikan Git, jadi aman dihapus kapan saja.

Pratinjau khusus modul:
- `node scripts/preview-briefings.mjs` untuk Briefing Pagi (http://127.0.0.1:4614/#briefings)
- `scripts/start-demo-pengadaan.ps1` untuk Pengadaan

### Batas uji lokal

Server lokal (Node.js + SQLite) **tidak sama dengan produksi** (Cloudflare Pages + Supabase):

- **Modul Cuti hanya ada untuk PostgreSQL** (`supabase/functions/_shared/portal/leaves.mjs`). Server lokal tidak memilikinya.
- **Backend produksi berisi tambalan yang belum ada di `lib/`**: aturan Superadmin/IT-admin, Wakil Sekban, dan folder Drive per modul (lihat `KONTEKS-PROYEK.md`). Perilaku izin lokal bisa berbeda dari produksi.
- Login, sesi, CSRF, Drive, kamera dan GPS di HP, serta PWA terpasang tidak tercakup sepenuhnya oleh server lokal.

Untuk perubahan di area itu, deskripsi PR wajib menyebut apa yang sudah diuji dan apa yang hanya bisa diperiksa setelah rilis.

### Menerima branch sebagai berkas `.bundle`

Bila agen belum bisa push ke GitHub, branch dikirim sebagai berkas `.bundle`. Di folder uji:

```powershell
git switch master
git pull --ff-only
git bundle verify $HOME\Downloads\<berkas>.bundle
git fetch $HOME\Downloads\<berkas>.bundle <nama-branch>:<nama-branch>
git switch <nama-branch>
git push -u origin <nama-branch>  # supaya CI berjalan dan PR bisa dibuka
```

## Rilis setelah lolos uji

Merge ke `master` **hanya** menerbitkan isi `site-info/dist` (frontend dan Pages Functions). Migrasi database dan Edge Function diterapkan terpisah, dan **harus lebih dulu** bila frontend baru membutuhkannya.

| Isi PR | Langkah sebelum merge | Pemeriksaan sesudahnya |
|---|---|---|
| Hanya `public/`, `site-info/`, dokumen, tes | Tidak ada | Buka halaman terkait di bpbesakih.com |
| `supabase/migrations/*.sql` baru | Jalankan migrasi di SQL Editor Supabase, satu per satu sesuai urutan nama berkas | Tabel baru memakai RLS; `/api/health` HTTP 200 |
| `supabase/deploy/<fungsi>/index.ts` berubah | Deploy fungsi itu dari berkas tersebut. Catat nomor versi sebelumnya untuk rollback | `/api/health` HTTP 200; fitur terkait berjalan |
| Variabel atau secret baru | Tambahkan di dashboard (Pages *Production* atau Supabase Secrets) | Sesuai deskripsi PR |

Rollback:
- **Frontend:** *Rollback* ke deployment sebelumnya di Cloudflare Pages, atau *revert* PR.
- **Edge Function:** deploy ulang versi sebelumnya.
- **Migrasi:** migrasi bersifat aditif dan tidak dihapus. Perbaikan dilakukan lewat migrasi baru.

## Aturan teknis yang wajib dijaga

- **Jangan** menjalankan `node scripts/build-cloud-deploy.mjs` tanpa `--frontend-only`. Generator backend dari repo menghasilkan `portal-api` yang berbeda dari produksi dan akan menghapus tambalan aktif. Perubahan backend dibuat sebagai tambalan terarah di atas `supabase/deploy/portal-api/index.ts` dan dijelaskan di PR, sampai rekonsiliasi selesai.
- Setiap perubahan di `public/` diikuti `node scripts/build-cloud-deploy.mjs --frontend-only`, lalu hasilnya di `site-info/dist/` ikut di-commit. Pages tidak menjalankan build sendiri; CI menolak bila lupa.
- Migrasi baru bersifat aditif. Migrasi yang sudah diterapkan di produksi tidak diubah.
- Tidak ada secret, token tautan, data pegawai asli, atau harga beli di repo. Data privat disimpan di `data/` atau `test-results/` yang diabaikan Git.
- Pertahankan akhir baris berkas yang ada (misalnya `public/pages.js` memakai CRLF), supaya diff tetap kecil.

## Menjalankan pemeriksaan CI di komputer sendiri

```powershell
node --test tests/*.test.mjs

# build frontend: alat build cukup dipasang sekali
npm install --prefix scripts/cloud-tools --no-package-lock
node scripts/build-cloud-deploy.mjs --frontend-only
git status --short site-info/dist   # harus kosong bila tidak ada perubahan public/

# verifier PostgreSQL: PGlite dipasang di luar repo
npm install --prefix $env:TEMP\pglite --no-package-lock @electric-sql/pglite@0.5.11
$P = "$env:TEMP\pglite\node_modules\@electric-sql\pglite\dist\index.js"
node scripts/verify-cloud-operations.mjs $P
node scripts/verify-quick-reports-postgres.mjs $P
node scripts/verify-native-coaching-postgres.mjs $P
node scripts/verify-briefings-postgres.mjs $P
```

PGlite tidak memiliki ekstensi `pg_cron`. Karena itu `scripts/pglite-migrations.mjs` mengganti pendaftaran job pg_cron dengan schema `cron` tiruan, khusus saat verifikasi. Berkas migrasi produksi tidak berubah.

## Pengaturan yang disarankan di GitHub dan Cloudflare

- **Proteksi `master`** (GitHub → Settings → Rules/Branches): wajib lewat PR, dan wajib lulus status check *Tes Node*, *Build frontend sesuai source*, serta *Verifikasi PostgreSQL (PGlite)*. Check baru bisa dipilih setelah workflow berjalan sekali.
- **Preview Cloudflare Pages:** secara bawaan setiap push ke branch selain `master` membuat deployment preview publik di `<branch>.sph-portal.pages.dev`, termasuk Pages Functions-nya. Pilih salah satu:
  - matikan preview otomatis (Settings → Builds & deployments → Preview deployments → *None*); atau
  - pastikan variabel Preview tidak berisi kunci Supabase/Drive produksi dan aktifkan pembatasan akses preview.
