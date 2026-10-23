# Optimasi login dan perpindahan menu portal

Portal kini memakai satu paket JavaScript dan satu stylesheet ringkas. Nama berkas mengikuti hash isinya dan memakai cache browser jangka panjang; HTML, sesi, dan respons API tetap tidak disimpan. Modul asli tetap tersedia untuk formulir publik dan pengembangan. Foto latar login kedua hingga keempat baru diambil ketika akan ditampilkan.

Validasi identitas Supabase dan profil akun yang independen berjalan bersamaan. Keduanya wajib selesai dan lolos sebelum sesi dipakai atau dilepas. Kegagalan identitas tetap didahulukan, dan diagnostik login tetap membedakan tahap identitas dan konteks akun.

Pembacaan izin, penugasan unit/pos, dan hierarki unit dipakai ulang hanya dalam satu transaksi baca. Setiap permintaan membuat Map baru. Pemeriksaan identitas dan lease sesi tetap dilakukan, serta permintaan mutasi tidak menggunakan cache ini. Perubahan/pencabutan izin terlihat pada permintaan berikutnya. Tidak ada cache data pegawai atau izin pada localStorage, sessionStorage, maupun cache HTTP.

Backend dirilis sebagai patch fungsi terarah dari portal-api v16 yang sedang aktif. Semua kebijakan Superadmin, perlindungan akun, serta modul lain pada bundel produksi dipertahankan. Tidak ada migrasi database atau perubahan secret.

## Verifikasi

- 184 tes otomatis lulus, termasuk uji paralelisme validasi dan isolasi cache izin.
- 23 pemeriksaan PostgreSQL/bundel Edge lulus. Pada fixture menu 92 pegawai, pembacaan database turun dari 200 menjadi 7 dengan isi respons identik; pencabutan grant menolak permintaan berikutnya.
- Fixture tiga unit dengan 90 pegawai turun dari 242 menjadi 5 pembacaan, tetap menampilkan hanya 60 pegawai dalam cakupan.
- 28 pemeriksaan browser portal dan 8 pemeriksaan alur Pengadaan lulus terhadap paket JavaScript/CSS yang digabung. Termasuk CSRF, ganti akun, menu cepat, notifikasi lambat, pilihan pegawai, dokumen, peserta pelatihan, serta pencetakan ber-QR.

Angka query berasal dari data fiktif terpisah. Waktu buka produksi sebelum/sesudah diukur tanpa login akun nyata. Kecepatan menu akun nyata bergantung jumlah data, cakupan akses, dan koneksi. Bukti pengukuran disimpan di test-results, tanpa password atau token sesi pengguna.

## Build

Jalankan scripts/build-cloud-deploy.mjs untuk paket lengkap, atau scripts/build-portal-assets.mjs setelah aset /app disiapkan. Script menghasilkan berkas ber-hash di site-info/dist/portal-static dan memperbarui /app/index.html. Pertahankan berkas hash lama selama masih ada HTML lama yang mungkin dibuka. Jangan menaruh informasi privat di paket statis ini.
