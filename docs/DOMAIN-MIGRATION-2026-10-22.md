# Status pemasangan bpbesakih.com — 22 Oktober 2026

**Pembaruan 25 Oktober 2026:** transisi telah selesai. `PORTAL_LEGACY_ORIGIN` dihapus dari Production pada 24 Oktober; `PORTAL_ORIGIN` tetap `https://bpbesakih.com`. Redirect alamat lama/www, HTTPS, HSTS dan DNSSEC telah diperiksa ulang pada 25 Oktober. Lihat [catatan keamanan](SECURITY-HARDENING-2026-10-24.md) dan [konteks proyek](KONTEKS-PROYEK.md). Bagian konfigurasi dan hasil di bawah adalah snapshot 22 Oktober, bukan instruksi mengaktifkan kembali origin lama.

Domain utama operasional sudah aktif di https://bpbesakih.com/app/. Database Supabase dan berkas Drive tidak dipindahkan.

## Konfigurasi pada 22 Oktober (historis)

- Nameserver Hostinger: donovan.ns.cloudflare.com dan grace.ns.cloudflare.com.
- Zona Cloudflare Free aktif. Apex CNAME proxied ke sph-portal.pages.dev; www CNAME proxied ke bpbesakih.com.
- Pages Custom domain bpbesakih.com: Active, SSL enabled.
- Production PORTAL_ORIGIN=https://bpbesakih.com dan PORTAL_LEGACY_ORIGIN=https://sph-portal.pages.dev.
- Bulk Redirect List sph_portal_domain_redirects (7e82943d856b4d8a9aef64b31cffe6b3): 301 dari sph-portal.pages.dev/ dan www.bpbesakih.com/ ke https://bpbesakih.com/. Preserve query string, Subpath matching, dan Preserve path suffix aktif; Include subdomains tidak aktif.
- Rule SPH-Portal ke bpbesakih.com (22364c0f55a44096aa794558b8209d35) kembali Enabled sesudah pengujian domain baru berhasil.

## Pemulihan dan perbaikan

Pengalihan awal sempat dinonaktifkan atas izin pengguna: "silahkan pulihkan dahulu dan kemudian perbaiki". Commit 77515ea373a968c8f8a86db1ee7b9bff2e1a3abb mengizinkan dua origin HTTPS secara eksplisit untuk pemulihan alamat lama. Cookie tetap host-only; perubahan data tetap memerlukan origin yang sama dengan URL permintaan dan CSRF yang sah. Deployment 6b1a008f-bc38-400a-b744-732b7774252a berhasil sekitar 12.28 UTC+8.

Jalur pengujian agen sempat mengalami kegagalan DNS dan jawaban portal blokir Fortinet. Itu tidak membuktikan bahwa pengguna memiliki FortiGate. Pengguna kemudian menunjukkan domain berhasil dibuka, dan DNS biasa, HTTPS, serta browser agen selanjutnya berhasil. Panel FortiGate tidak diperlukan. DNS komputer, firewall, dan perlindungan jaringan tidak diubah.

Login domain baru berhasil, tetapi dashboard dan daftar pegawai mengalami timeout. Log menunjukkan fungsi portal dijalankan di lokasi berbeda, termasuk eu-central-2, sedangkan database berada di Singapura. Layanan memiliki banyak perjalanan bolak-balik ke database.

Commit 06581793c3fbc64e2328a955bed4063fc4d79cf6 menambahkan x-region: ap-southeast-1 hanya untuk panggilan server ke Edge Functions. Auth dan REST tetap menggunakan rute normal. Deployment e2f268d9-ce1f-4bcb-b768-ca5f059155b4 success sekitar 13.39 UTC+8. Log sesudah deployment mengonfirmasi portal-api berjalan di ap-southeast-1; dashboard dan daftar pegawai kembali berhasil. Penetapan region mengikuti lokasi database saat ini; bila region terganggu atau database berpindah, konfigurasi perlu ditinjau.

Perubahan diterbitkan dari salinan kerja terisolasi berbasis commit produksi, lalu patch terbatas diterapkan ke folder utama. Pekerjaan lokal lain yang belum diterbitkan tidak ikut dideploy.

## Hasil pengujian

- HTTPS normal dan DNS biasa berhasil; /, /portal/, dan /app/ memberikan 200.
- /api/health sesudah perbaikan memberikan 200, status=ok, modules_revision=20261016.1, sekitar 0,9 detik dari jalur pengujian.
- API akun dan operasional tanpa sesi memberikan 401.
- Sesi pengguna nyata terhubung pada domain baru; halaman akun menampilkan status sudah masuk.
- Browser berhasil membuka Dashboard SDM, daftar 210 pegawai, Regulasi & SOP, Dashboard Keamanan, Logbook & Patroli, Beranda Pengadaan, dan Semua PR. Daftar SOP, Logbook, dan PR yang kosong tampil sebagai keadaan kosong normal.
- 45 pengujian backend Cloudflare dan login lulus, termasuk dua origin, CSRF, cookie, refresh, dan region fungsi.
- Setelah rule Enabled, alamat lama dan www memberikan 301 untuk /app/?domain-check=20261022 ke https://bpbesakih.com/app/?domain-check=20261022. Browser juga mencapai domain baru dengan jalur dan parameter tersebut.
- Tidak dilakukan pembuatan, perubahan, penghapusan, unggah, atau ekspor data operasional nyata untuk pengujian. Alur tulis dan transfer berkas belum diuji dengan transaksi produksi.

Bukti tampilan berada di C:/Users/Ayyymao/.codex/visualizations/2026/10/22/01a1618f-85c3-7cf1-b63b-e8506c49ff23/: bpbesakih-dashboard-tested.png dan bpbesakih-redirect-restored.png.

Referensi: [Cloudflare custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/), [Bulk Redirects](https://developers.cloudflare.com/rules/url-forwarding/bulk-redirects/create-dashboard/), [Supabase regional invocation](https://supabase.com/docs/guides/functions/regional-invocation).
