# Aturan untuk agen AI di repo SPH-Portal

Berlaku untuk Claude, Codex, dan agen lain yang mengubah repo ini. Baca dulu:
- `docs/KONTEKS-PROYEK.md`: produk, arsitektur, status produksi, dan tindak lanjut;
- `docs/ALUR-KERJA.md`: cara branch diuji dan dirilis.

## Alur

- `master` adalah produksi: push ke `master` langsung tayang di bpbesakih.com. **Jangan pernah commit, push, atau merge ke `master`.**
- Kerjakan setiap tugas di branch baru dari `master` terbaru: `claude/<topik>` atau `codex/<topik>`. Satu branch untuk satu tujuan.
- Buka PR ke `master` dengan templat `.github/pull_request_template.md`. Pemilik repo menguji secara lokal lalu memutuskan merge.
- **Jangan** menjalankan migrasi produksi, men-deploy Edge Function, mengubah dashboard Cloudflare/Supabase/Google, atau menulis data produksi. Tuliskan langkah rilis di PR untuk dijalankan pemilik repo.

## Sebelum push

- `node --test tests/*.test.mjs` lulus.
- Bila `public/` berubah: jalankan `node scripts/build-cloud-deploy.mjs --frontend-only`, lalu commit `site-info/dist/`.
- Bila migrasi, `supabase/functions/` atau `supabase/deploy/` berubah: jalankan verifier PGlite (`docs/ALUR-KERJA.md`) dan tambahkan pemeriksaan untuk perilaku baru.
- Sebutkan di PR apa yang tidak bisa diuji secara lokal (Cuti, tambalan backend produksi, Drive, kamera/GPS, PWA).

## Larangan teknis

- **Jangan** menjalankan `node scripts/build-cloud-deploy.mjs` tanpa `--frontend-only`. Bundel `supabase/deploy/portal-api/index.ts` berisi tambalan produksi yang tidak ada di `lib/`, dan generator penuh akan menghapusnya. Ubah backend dengan tambalan terarah dan jelaskan di PR sampai rekonsiliasi selesai.
- Jangan mengubah migrasi yang sudah ada. Skema hanya bertambah lewat migrasi aditif baru dengan RLS aktif dan tanpa grant ke `anon`/`authenticated`/`service_role`.
- Jangan memasukkan secret, token tautan, data pegawai asli, NIK, rekening, atau harga beli ke repo, log, atau aset publik.
- Jangan mengubah akhir baris berkas yang sudah ada (sebagian berkas memakai CRLF).

## Konvensi

- Antarmuka, pesan galat, dan dokumentasi memakai Bahasa Indonesia. Waktu operasional memakai WITA (Asia/Makassar).
- Aturan domain ditulis di `lib/*.mjs` dan dibangkitkan ke `supabase/functions/_shared/portal/` oleh `scripts/generate-cloud-modules.mjs`. Pengecualian saat ini: modul Cuti (`leaves*.mjs`, `leave-*.mjs`) yang hanya ada untuk PostgreSQL.
- Node.js 24 LTS. Server lokal tidak memakai dependensi npm. Alat build ada di `scripts/cloud-tools/`.
