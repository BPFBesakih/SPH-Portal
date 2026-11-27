## Ringkasan

<!-- Apa yang berubah dan mengapa, dalam 2–5 kalimat. -->

## Cara uji lokal

<!-- Langkah konkret di folder uji (lihat docs/ALUR-KERJA.md): akun demo, menu, hal yang perlu dicek. -->

1.

**Tidak tercakup uji lokal:** <!-- mis. Cuti/PostgreSQL, tambalan backend produksi, Drive, kamera/GPS, PWA; atau "tidak ada" -->

## Pemeriksaan

- [ ] CI **Tes** hijau (Tes Node, Build frontend sesuai source, Verifikasi PostgreSQL)
- [ ] `site-info/dist` dibangun ulang dengan `--frontend-only` bila `public/` berubah
- [ ] Tidak ada secret, token, atau data pribadi asli

## Rilis

- [ ] Hanya frontend/dokumen: merge langsung tayang
- [ ] Migrasi baru, dijalankan **sebelum merge** di SQL Editor: <!-- nama berkas -->
- [ ] Edge Function berubah, di-deploy **sebelum merge**: <!-- nama fungsi, berkas supabase/deploy/... -->
- [ ] Variabel/secret baru: <!-- nama, tempat -->

## Risiko dan rollback

<!-- Apa yang bisa salah dan cara kembali: rollback Pages, versi Edge sebelumnya, revert PR. -->
