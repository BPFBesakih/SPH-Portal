# Perbaikan konfigurasi situs live — 24 Oktober 2026

Domain: https://bpbesakih.com. Pemeriksaan akhir pada 24 Oktober 2026 pukul 10.30 UTC+8.

**Pemeriksaan ulang 25 Oktober 2026:** HTTP publik/API tanpa sesi, manifest/service worker PWA, HSTS 30 hari, ketiadaan beacon pada respons HTML, redirect HTTP/www/Pages, serta SPF/DMARC/DS melalui Google DNS tetap sesuai hasil di bawah. DNS menghasilkan status 0 dan `AD=true`. Tidak ada login atau mutasi data operasional; dashboard konfigurasi tidak dibuka ulang. Rangkuman seluruh proyek tersedia pada [KONTEKS-PROYEK.md](KONTEKS-PROYEK.md).

## Hasil

| Temuan | Perubahan dan bukti |
|---|---|
| HSTS belum ada pada halaman biasa | Diaktifkan pada zona Cloudflare dengan `max-age=2592000` (30 hari). `includeSubDomains` dan preload tidak diaktifkan. Header terverifikasi pada `/`, `/app/`, `/portal/`, `/privacy/`, `/terms/`, `/api/auth/me`, dan `/api/health`. |
| SPF/DMARC belum ada | TXT apex `v=spf1 -all`; TXT `_dmarc` berisi `v=DMARC1; p=reject; sp=reject`. Keduanya sudah terbaca pada resolver Cloudflare dan Google. |
| DNSSEC belum tersambung | Penandatanganan di Cloudflare diaktifkan dan DS ditambahkan pada registrar Hostinger setelah persetujuan pengguna. Cloudflare menampilkan “Success! bpbesakih.com is protected with DNSSEC.” Validasi Cloudflare dan Google menghasilkan `AD=true` tanpa SERVFAIL. |
| Origin lama masih diizinkan | `PORTAL_LEGACY_ORIGIN` dihapus dari konfigurasi Production Pages. Deployment produksi baru berhasil dan Build settings berisi enam variabel, tanpa origin lama. `PORTAL_ORIGIN` tetap `https://bpbesakih.com`. |
| Beacon analitik bertentangan dengan konfigurasi CSP/penjelasan privasi | Pages Web Analytics sudah disabled. Sumber injeksi ditemukan pada RUM zona Cloudflare, lalu dinonaktifkan melalui Disable completely → Disable RUM. DOM browser pada halaman privasi dan respons HTML dengan User-Agent browser tidak lagi memuat `static.cloudflareinsights.com` atau `data-cf-beacon`. CSP tetap membatasi script ke origin sendiri. |

## Email domain di masa mendatang

Pengguna mengonfirmasi domain belum dipakai untuk email, tetapi ada rencana menggunakannya. SPF saat ini menyatakan tidak ada pengirim yang diizinkan; DMARC meminta penolakan pesan yang gagal autentikasi/alignment. Sebelum mengirim email dari `@bpbesakih.com`, sesuaikan SPF dengan penyedia email yang dipilih, pasang DKIM dari penyedia tersebut, serta konfigurasi MX untuk menerima email. Uji alignment SPF/DKIM terhadap DMARC sebelum mulai dipakai. Jangan menambahkan TXT SPF kedua pada nama yang sama.

## Data DS publik

```text
bpbesakih.com. 3600 IN DS 2371 13 2 26D90A460F127F1126ECB56D4E94214662FAE3DA674FF75DDE79DEFEF3AD540A
```

Key Tag `2371`; Algorithm `13` (ECDSA P-256/SHA-256); Digest Type `2` (SHA-256). DS telah terbit pada parent `.com`; DNSKEY dan TXT domain terverifikasi melalui resolver yang memvalidasi DNSSEC.

## Deployment dan verifikasi

- Deployment produksi: `676d0bc7-60be-45c3-aef8-b927e3dc447e`, status **success**, 24 Oktober 2026 pukul 10.29 UTC+8.
- Commit sumber: `e30ef6ee03f115a87d24db03f3f1eae7e221810f`. Penerapan ulang memakai konfigurasi Production terbaru.
- Lima halaman publik/portal yang diperiksa memberikan HTTP 200, HSTS 30 hari, dan tidak mengandung beacon.
- `/api/health` memberikan HTTP 200; `/api/auth/me` tanpa sesi memberikan HTTP 401 yang diharapkan. Login memakai akun nyata tidak diuji pada pekerjaan ini.
- HTTP pada domain utama, `www`, serta `sph-portal.pages.dev` tetap mengarah 301 ke HTTPS domain utama, dengan jalur dan query string dipertahankan.
- Perubahan dilakukan pada dashboard Cloudflare dan Hostinger. Tidak ada perubahan kode aplikasi, migrasi database, atau data operasional untuk pekerjaan ini.

Catatan JSON dan screenshot berada di `test-results/security-hardening-20261024/`, termasuk `verification.json`, `hsts-cloudflare.png`, `dns-email-records.png`, `dnssec-cloudflare.png`, `dnssec-ds-hostinger-saved.png`, `pages-origin-config.png`, `rum-disabled.png`, dan `deployment-success.png`.

## Referensi

- [Cloudflare HSTS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/http-strict-transport-security/)
- [Cloudflare DNSSEC](https://developers.cloudflare.com/dns/dnssec/)
- [Hostinger DNSSEC](https://www.hostinger.com/support/3667267-how-to-use-dnssec-records-at-hostinger/)
- [Cloudflare Web Analytics](https://developers.cloudflare.com/web-analytics/get-started/)
- [Cloudflare Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/)
