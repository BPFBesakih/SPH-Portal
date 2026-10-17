# Impor dari bagan organisasi

Workbook sumber adalah `Daftar Pegawai&Org BP.xlsx`. Script membaca nama pada sheet `Bagan Lengkap`; sheet cabang membantu mengelompokkan label posisi ke fungsi utama. Workbook asli tidak diubah.

Hasil ekstraksi pada 15 Oktober 2026:

| Jenis | Jumlah |
|---|---:|
| Calon nama pegawai setelah penggabungan nama yang sama | 157 |
| Label posisi/fungsi | 83 |
| Unit utama, termasuk Badan Pengelola Besakih | 6 |
| Isian nama belum ditetapkan | 7 |

Jumlah ini hasil pembacaan bagan, bukan jumlah pegawai aktif yang telah disahkan. Isian `TBA` dan `?` dicatat dalam bagian `unresolved` dan tidak menjadi calon pegawai. Penanda `(Pjs.)` tidak menjadi bagian nama; posisi terkait tetap dicatat agar pemilik data dapat memeriksa penempatan utama dan rangkap tugas. Nama dibersihkan dari nomor urut dan digabung secara case-insensitive; konfirmasi kembali bila ada dua orang yang kebetulan memiliki nama sama.

## Ekstraksi

Memerlukan Python 3 dengan paket `openpyxl`. Paket ini hanya diperlukan untuk alat impor Excel; aplikasi web berjalan tanpa Python.

```powershell
python -m pip install openpyxl
python scripts/extract-organization.py 'D:\BPFKSPA Besakih\Daftar Pegawai&Org BP.xlsx'
```

Output default: `data/imports/besakih-draft.json`. Lokasi lain dapat diberikan dengan `--out <path>`. File memuat nama, posisi sumber, unit usulan, referensi sel, serta nilai kosong untuk nomor pegawai, tanggal mulai, dan status. Periksa file dan catatan `unresolved` sebelum memasukkannya ke database organisasi.

## Staging

Pastikan `DATA_DIR` menunjuk database organisasi, lalu:

```powershell
node --env-file=.env scripts/stage-import.mjs data/imports/besakih-draft.json
```

Script menambahkan unit utama dan posisi dari bagan jika belum ada, lalu menampung calon pegawai di `import_candidates`. Menjalankan ulang sumber dan referensi sel yang sama tidak menambahkan baris yang sama dua kali. Perubahan format bagan atau pemetaan baru harus direview; script tidak menyamakan ulang pegawai aktif berdasarkan nama secara otomatis.

## Tinjauan dalam aplikasi

1. Login menggunakan akun yang mempunyai akses tambah pegawai untuk seluruh organisasi.
2. Buka **Data Pegawai & Organisasi → Tinjau impor**.
3. Pilih baris dan isi nomor pegawai resmi, status kepegawaian, tanggal mulai, posisi utama, dan atasan bila diketahui.
4. Simpan. Sistem membuat satu profil dan satu penempatan utama, lalu menandai calon data tersebut sudah diimpor.
5. Jika ada rangkap tugas, putuskan penempatan utama yang dipakai perhitungan jumlah pegawai. Jangan membuat pegawai kedua hanya karena orang yang sama tampil di dua posisi.

Maksimal satu profil dibuat per baris calon. Nomor pegawai tetap unik secara global. Semua perubahan dicatat pada audit. Tidak ada akun login, hak akses, keanggotaan kelompok, kelayakan pos, jadwal, atau kebijakan kerja yang terbentuk dari nama/jabatan dalam bagan.

Folder `data/` diabaikan Git dan Docker build karena berisi data personal serta database. Pada server baru, pindahkan JSON staging lewat saluran internal dan ikuti langkah impor dalam [DEPLOYMENT.md](DEPLOYMENT.md).

## Posisi Staf dan THL

Empat label sumber yang menggabungkan “Staf dan THL” dipisahkan menjadi pilihan Staf dan THL untuk Kebersihan Lingkungan, Kebersihan Bangunan, Pertamanan, dan Pengolahan Sampah. Koreksi data master PostgreSQL tersedia pada `supabase/setup/separate-staff-thl-positions.sql` dan dapat dijalankan ulang tanpa menggandakan posisi.

Penempatan utama yang masih terbuka diarahkan ke posisi terpisah berdasarkan status kerja tersimpan: `Pegawai Kontrak (PKWT)` ke Staf dan `Tenaga Harian Lepas` ke THL. Status lain menghentikan seluruh transaksi untuk ditinjau. Tanggal, atasan, dan penempatan historis yang sudah ditutup tetap dipertahankan; posisi gabungan dinonaktifkan dari pilihan baru. Sumber impor tetap menyimpan label asli. Koreksi posisi dan penempatan dicatat dalam audit, tanpa mengubah status kerja, akun, atau izin akses.

Koreksi produksi pada 17 Oktober 2026 menghasilkan delapan pilihan posisi aktif dan memisahkan 52 penempatan: 25 Staf serta 27 THL. Verifikasi tidak menemukan penempatan utama terbuka pada empat posisi gabungan atau ketidaksesuaian status. Fingerprint data pegawai selain versi/waktu pembaruan, tanggal/atasan penempatan, akun, pemberian role, dan izin tetap sama. Salinan sebelum perubahan dan hasil pemeriksaan disimpan pada folder lokal `data/imports/staff-thl-20261017/` yang diabaikan Git.
