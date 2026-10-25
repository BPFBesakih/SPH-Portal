# Aplikasi terpasang (PWA)

**Status 25 Oktober 2026: sudah dirilis.** Commit `e30ef6ee03f115a87d24db03f3f1eae7e221810f` dipush pada 23 Oktober dan menjadi source deployment sukses 24 Oktober. Pemeriksaan HTTP 25 Oktober mengonfirmasi `/app/` menautkan manifest, serta `/app/manifest.webmanifest` dan `/app/sw.js` memberi HTTP 200 dengan tipe konten sesuai. Pemasangan langsung pada perangkat Android/iPhone belum diuji. Lihat [konteks proyek](KONTEKS-PROYEK.md).

Ruang kerja `/app/` dapat dipasang sebagai aplikasi di HP dan komputer: ikon sendiri di layar utama dan jendela sendiri tanpa bilah alamat. Isinya tetap ruang kerja yang sama, dan semua data tetap diambil dari server.

## Memasang

| Perangkat | Langkah |
|---|---|
| Android (Chrome) | Buka <https://bpbesakih.com/app/>, ketuk menu ⋮ lalu **Instal aplikasi** atau **Tambahkan ke layar utama**. |
| iPhone/iPad (Safari) | Buka alamat yang sama, ketuk **Bagikan** lalu **Tambahkan ke Layar Utama**. |
| Komputer (Chrome/Edge) | Buka alamat yang sama, klik ikon pasang di ujung kanan bilah alamat. |

Pasang dari `/app/` agar ikon membuka ruang kerja yang benar. Manifest dan service worker PWA hanya ditambahkan pada ruang kerja; halaman informasi `/` dan halaman akun `/portal/` tetap memakai alurnya sendiri. Ikon Apple juga tersedia di halaman akun.

## Cara kerja

- `public/manifest.webmanifest` berisi nama, warna, dan ikon. Alamat di dalamnya relatif, sehingga berlaku untuk `/app/` di Cloudflare maupun `/` pada instalasi Node.js lokal.
- `public/sw.js` adalah service worker dengan lingkup folder ruang kerja. Dokumen ruang kerja selalu diambil dari jaringan; bila jaringan tidak tersedia, tampil halaman "Tidak ada koneksi internet" dengan tombol **Coba lagi**, yang juga memuat ulang otomatis saat koneksi kembali. Service worker tidak memakai Cache Storage dan tidak menangani permintaan `/api/`, berkas, atau aset. Dukungan PWA ini tidak menambahkan penyimpanan data internal untuk akses offline. Header `Cache-Control: no-store` untuk `/app/*` tetap berlaku.
- `public/pwa.js` mendaftarkan service worker setelah halaman selesai dimuat.
- `public/assets/icons/` berisi ikon 192 dan 512 px (`icon-*` untuk komputer, `maskable-*` untuk Android) serta `apple-touch-icon.png` 180 px untuk iPhone.
- `scripts/build-cloud-deploy.mjs --frontend-only` menyalin semuanya ke `site-info/dist/app/` dan membangun ulang bundel `/portal-static/`. Opsi ini menyiapkan berkas web tanpa membangun ulang backend.

## Menyiapkan penerapan

```powershell
node scripts/build-cloud-deploy.mjs --frontend-only
node --test tests/pwa.test.mjs
```

Hasil build harus diterbitkan lewat alur Cloudflare Pages proyek agar PWA tersedia di domain produksi. Menjalankan perintah build lokal saja belum memperbarui situs. HTTPS diperlukan di produksi; localhost dapat dipakai untuk pengujian.

## Mengubah ikon

Ikon dibuat dari `public/assets/bp-besakih.png` oleh `scripts/build-pwa-icons.mjs`: logo berdiri di atas anak tangga, diapit dua sisi candi bentar berwarna emas di latar marun portal. Ikon maskable menjaga logo dan gapura di dalam lingkaran aman 80 %, karena Android memotongnya mengikuti bentuk ikon perangkat.

Setelah mengubah logo atau gambar di skrip, jalankan:

```powershell
cd scripts/pwa-icons
pnpm install
cd ../..
node scripts/build-pwa-icons.mjs
node scripts/build-cloud-deploy.mjs --frontend-only
```

## Pembaruan dan penonaktifan

Browser memeriksa pembaruan `sw.js` saat ruang kerja dibuka; worker baru meminta aktivasi segera setelah terpasang. Halaman dan data tetap diambil dari jaringan. Pengguna yang sudah memasang aplikasi tidak perlu memasang ulang untuk pembaruan kode web; perubahan nama atau ikon mengikuti mekanisme pembaruan browser dan dapat memerlukan waktu.

Bila service worker perlu dimatikan di semua perangkat, ganti isi `public/sw.js` dengan kode berikut, lalu bangun ulang dan deploy. Hapus juga panggilan `registerServiceWorker()` di `public/app.js` bila PWA tidak dipakai lagi.

```js
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.registration.unregister()));
```

## Pengujian

`tests/pwa.test.mjs` memeriksa manifest, ukuran ikon, tautan di `index.html`, hasil build di `site-info/dist/app/`, dan perilaku service worker saat online, saat offline, dan untuk permintaan selain halaman.

Pemeriksaan browser memakai profil sementara dan server lokal, tanpa akun atau data produksi:

```powershell
node scripts/verify-pwa-ui.mjs <path-ke-playwright/index.mjs> <path-ke-browser>
```

Hasil verifikasi 23 Oktober 2026: folder kerja lokal lulus 225 pengujian Node.js, sedangkan paket rilis terpisah berbasis source produksi lulus 202 pengujian, termasuk sembilan pengujian PWA. Lima pemeriksaan PWA di browser Chromium/Edge juga lulus: pendaftaran worker dengan CSP produksi, manifest tanpa kesalahan pemasangan, halaman offline di desktop dan layar HP, pemulihan otomatis saat online, serta lingkup worker yang tidak mengambil alih halaman akun. Sebanyak 28 pemeriksaan regresi browser portal juga lulus. Jumlah tes berbeda karena cakupan source lokal dan rilis berbeda; angka tersebut tidak dijumlahkan. Screenshot berada di `test-results/pwa-ui/`. Status penerapan produksi terbaru tercatat di awal dokumen; pemasangan Android/iPhone masih memerlukan pengujian perangkat fisik.

Referensi: [syarat pemasangan PWA](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [manifest aplikasi web](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest).
