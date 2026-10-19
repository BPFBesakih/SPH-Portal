# Percepatan perpindahan menu portal

Perubahan ini mempersingkat waktu tunggu sebelum data menu ditampilkan. Berlaku
untuk aplikasi lokal dan aset Cloudflare Pages di `site-info/dist/app/`.

- Data menu ditampilkan setelah permintaan utamanya selesai. Pengumuman dan
  ringkasan Pengadaan untuk notifikasi dimuat sesudahnya di belakang layar.
- Ringkasan notifikasi dipakai ulang selama 60 detik di memori tab. Data tersebut
  dibaca ulang saat dibutuhkan setelah masa itu, saat halaman Informasi Internal
  dibuka, atau setelah penyimpanan/perintah muat ulang. Data utama menu tetap
  dibaca dari server setiap kali menu dibuka.
- Permintaan data menu didahulukan dari pembaruan notifikasi yang masih antre.
  Satu permintaan tetap berjalan pada satu waktu untuk menjaga lease sesi.
  Permintaan yang sudah berjalan diselesaikan sebelum permintaan berikutnya.
- Klik menu yang cepat berurutan hanya memuat menu terakhir setelah pemuatan
  aktif selesai. Hasil menu yang sudah ditinggalkan tidak ditampilkan.
- Cache ringkasan dibersihkan saat keluar/ganti akun. Hasil request lama tidak
  mengisi cache akun baru. Tidak ada penyimpanan data ringkasan di localStorage.
- Gangguan notifikasi tidak menggagalkan tampilan menu. Percobaan otomatis di
  belakang layar diberi jeda 15 detik; pembukaan menu terkait bisa mencoba lagi.

Pemeriksaan sesi, CSRF, izin dan scope pada backend tetap dijalankan. Perubahan
ini tidak mengubah skema database atau memerlukan migrasi/konfigurasi Supabase.

## Verifikasi

Paket rilis terpisah dari baseline produksi lulus 136 tes melalui
`node --test tests/*.test.mjs`, termasuk antrean permintaan,
perpindahan menu, masa cache, invalidasi, isolasi akun dan kegagalan jaringan.
Uji browser `scripts/verify-cloud-portal-ui.mjs` menambahkan simulasi API lambat,
kegagalan notifikasi, prioritas menu dan klik menu cepat.
Seluruh 19 pemeriksaan browser portal dan 8 pemeriksaan alur Pengadaan lulus,
termasuk pengingat persetujuan setelah ganti akun dan pemilih tiga modul.

Pada satu pengukuran fixture lokal dengan penundaan pengumuman 750 ms, menu
sudah terlihat 85 ms setelah permintaan datanya dimulai, sedangkan pengumuman
baru selesai pada 786 ms. Ini membuktikan notifikasi tidak lagi menahan tampilan
menu; angka tersebut bukan pengukuran kecepatan produksi.

## Penerapan

Aset deploy dihasilkan melalui `node scripts/build-cloud-deploy.mjs`. Terapkan
aset Pages yang sudah diperbarui agar perubahan tersedia di situs online.
Optimasi frontend ini tidak membutuhkan penerapan ulang Edge Function. Setelah
deploy, ukur perpindahan menu pada akun nyata melalui Network/Performance browser
untuk mengetahui waktu respons backend yang masih perlu dioptimalkan.
