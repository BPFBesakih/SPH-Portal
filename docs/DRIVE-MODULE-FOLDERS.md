# Folder penyimpanan per modul

**Pembaruan 25 Oktober 2026:** pemisahan folder tetap menjadi rancangan produksi. Coaching native yang dirilis 23 Oktober memakai `SPH-Portal-Coaching`; pustaka Website masih bergantung penerapan modul website yang saat ini lokal. Versi backend dan angka pengujian di bawah merupakan bukti historis 19 Oktober. Lihat [konteks proyek](KONTEKS-PROYEK.md).

Pembaruan 19 Oktober 2026. Backend produksi `portal-api` versi 11 memisahkan berkas ke subfolder privat di dalam folder pusat yang ditetapkan oleh `GOOGLE_DRIVE_FOLDER_ID`.

| Modul | Subfolder |
| --- | --- |
| Regulasi & SOP | `SPH-Portal-SOP` |
| Kegiatan & Pelatihan: foto, materi unggahan, sertifikat | `SPH-Portal-Pelatihan` |
| Kontrak dan berkas pegawai | `SPH-Portal-Pegawai` |
| Logbook & Patroli | `SPH-Portal-Patroli` |
| Laporan Kejadian | `SPH-Portal-Kejadian` |
| Informasi Internal | `SPH-Portal-Informasi` |
| Pengadaan | `SPH-Portal-Pengadaan` |
| Coaching native (rilis 23 Oktober) | `SPH-Portal-Coaching` |
| Pustaka website, saat modul tersebut diterapkan | `SPH-Portal-Website` |

Folder dibuat saat pertama dibutuhkan, lalu digunakan kembali. Modul ditentukan oleh rute server yang menyimpan lampiran. Browser tidak memilih ID folder. Unggahan umum berada sementara di folder pusat sampai berhasil dilampirkan; unggahan tanpa relasi tetap tidak dapat diunduh lewat portal.

Berkas lama dirapikan ke folder modulnya saat pertama dibuka/diunduh oleh pengguna yang berhak. ID Drive, ID berkas portal, nama asli, checksum, dan relasi dokumen/kegiatan tetap dipertahankan. Materi pelatihan yang merujuk versi SOP tetap memakai berkas di folder SOP.

Pengorganisasian berkas dan pencarian/pembuatan folder diserialkan dengan transaksi mutasi portal. Jika pekerjaan gagal sebelum commit, backend berusaha mengembalikan lokasi berkas yang dipindahkan. Hasil commit yang belum pasti tidak memicu penghapusan berkas lama. Folder kosong boleh tetap ada dan digunakan lagi.

Unduhan tetap memeriksa izin objek induk di database, penanda aplikasi pada berkas, serta folder pusat atau subfolder modul yang ditandai aplikasi dan masih berada langsung di bawah folder pusat. Folder luar, folder tanpa penanda, folder terhapus, dan subfolder bertingkat tidak diterima. Tidak ada pemberian izin publik otomatis.

Pengujian: 151 tes Node dan 21 kelompok integrasi PostgreSQL/paket Edge lulus. Paket produksi diuji terpisah dari perubahan website/operasional lain yang sedang ada di workspace, menggunakan source produksi versi 10 sebagai dasar. Penerapan tidak memerlukan perubahan schema, frontend, atau secret.

Verifikasi produksi: source aktif versi 11 cocok dengan paket yang diuji. Unduhan dokumen dummy SOP berhasil dan membuat folder `SPH-Portal-SOP`; pembukaan kegiatan `TES PENYIMPANAN` membuat folder `SPH-Portal-Pelatihan`, dan foto lama berhasil dimuat dengan ukuran asli 3613 × 3613. Daftar folder pusat menampilkan kedua subfolder dan tidak lagi menampilkan kedua berkas lama di tingkat pusat. Bukti visual lokal: `test-results/drive-module-folders/production-folders.png`.
