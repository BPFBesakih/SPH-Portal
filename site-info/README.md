# Halaman informasi publik SPH Portal

Folder ini berisi situs statis untuk beranda, penjelasan privasi, dan ketentuan penggunaan awal. Tidak ada server aplikasi, login, akses database, unggahan, token Google, atau pemanggilan API di dalam situs ini. Backend utama masih Node.js/SQLite dan belum dipindahkan ke Supabase.

## Pengaturan Cloudflare Pages dari Git

| Pengaturan | Nilai |
|---|---|
| Repository | `BPFBesakih/SPH-Portal` |
| Production branch | `master` |
| Framework preset | `None` |
| Root directory (advanced) | `site-info` |
| Build command | `exit 0` |
| Build output directory | `dist` |
| Environment variables | Tidak diperlukan untuk halaman informasi |

Berkas `dist/` sudah siap disajikan; tidak ada proses build atau pemasangan dependensi. Gunakan alamat yang benar-benar diberikan Cloudflare setelah penerapan berhasil. Alamat beranda adalah `/`, kebijakan privasi `/privacy/`, dan ketentuan penggunaan `/terms/`.

Penerapan publik dilakukan sendiri oleh pengelola melalui dashboard Cloudflare setelah meninjau halaman. Commit/push saja belum menyelesaikan konfigurasi Pages atau penerapan backend.

## Batas tahap persiapan

- Berkas `dist/google14e0857c104512e8.html` adalah bukti kepemilikan situs untuk Google Search Console. Pertahankan berkas asli ini di alamat publik yang sama, termasuk setelah verifikasi berhasil.
- Isi halaman menjelaskan status persiapan dan membedakan koneksi Drive yang diuji dari integrasi operasional yang belum selesai.
- Tidak ada klaim bahwa migrasi aplikasi, Auth/RLS produksi, kompresi foto, atau pengiriman foto melalui backend sudah diterapkan.
- Kebijakan retensi dan prosedur penghapusan data operasional belum ditetapkan. Pengelola perlu menentukannya dan memperbarui penjelasan privasi sebelum layanan operasional diluncurkan.
- Kontak mengikuti email dukungan pada Google Auth Platform. Konfirmasi kembali sebelum menerbitkan halaman.
- Jangan memasukkan rahasia backend ke folder `dist/` atau environment variables frontend. Konfigurasi Drive tetap berada di Supabase Edge Function Secrets.
- Verifikasi kepemilikan alamat situs dan kelengkapan Branding Google diselesaikan sesudah alamat Pages tersedia; tersedianya halaman tidak menjamin persetujuan Google.

## Status verifikasi 16 Oktober 2026

Google Search Console sudah mengonfirmasi kepemilikan properti URL-prefix `https://sph-portal.pages.dev/` melalui berkas HTML di atas. Google Auth Platform menampilkan status OAuth **In production**. Verifikasi Branding belum selesai: pesan Google meminta jeda 24 jam setelah verifikasi kepemilikan sebelum mencoba ulang. Status produksi OAuth tidak berarti portal operasional atau Branding sudah disetujui.
