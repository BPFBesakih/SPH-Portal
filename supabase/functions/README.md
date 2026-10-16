# Pemeriksaan koneksi Google Drive

`drive-connection-check/index.ts` adalah fungsi diagnostik terpisah untuk memeriksa empat Edge Function Secrets yang sudah disimpan. Fungsi menukar refresh token menjadi access token, lalu membaca metadata folder yang ID-nya berasal dari secret. Fungsi tidak menerima ID folder dari pemanggil, tidak membuat folder, tidak mengunggah foto, dan tidak mengubah database.

## Pengaturan dashboard

- Nama fungsi: `drive-connection-check`.
- Salin seluruh isi `drive-connection-check/index.ts` ke `index.ts` di editor Supabase.
- Kode memakai `withSupabase({ auth: "secret" })`. Hanya secret key Supabase bernama `default` pada header `apikey` yang dapat menjalankan pemeriksaan; publishable/anon key dan sesi pegawai tidak diberi akses.
- Sesuai dokumentasi Supabase, konfigurasi fungsi ini memakai `verify_jwt = false` karena pemeriksaan secret key dilakukan oleh SDK di dalam fungsi. Atur melalui dashboard setelah penerapan bila pengaturan tersedia. Ini khusus fungsi diagnostik ini; jangan menerapkannya ke fungsi lain.
- Uji melalui dashboard dengan metode `POST`, body `{}`, dan secret key Supabase pada header `apikey`. Pada panel Test, pilih panah di kanan **Add header**, lalu klik **Add secret key** hingga baris `apikey` benar-benar muncul sebelum menekan **Send Request**. Gunakan sarana autentikasi pada dashboard; jangan menempelkan nilai key ke source, Git, frontend, atau chat.

Secret yang dibaca, tanpa nilai pada source:

```text
GOOGLE_DRIVE_CLIENT_ID
GOOGLE_DRIVE_CLIENT_SECRET
GOOGLE_DRIVE_REFRESH_TOKEN
GOOGLE_DRIVE_FOLDER_ID
```

Respons berhasil:

```json
{
  "ok": true,
  "checks": {
    "token_refresh": true,
    "folder_access": true,
    "can_add_files": true
  }
}
```

`can_add_files` berasal dari izin `capabilities.canAddChildren` Google; fungsi belum menguji unggahan foto. Respons tidak mengeluarkan token, ID/nama folder, isi file, body galat Google, atau detail exception. Setiap permintaan Google memiliki batas waktu 12 detik dan menolak redirect.

## Validasi dan batas

Jalankan `node --test tests/drive-connection-check.test.mjs` dari root repository. Tujuh uji lokal lulus menggunakan lingkungan Deno dan respons Google tiruan. Uji memastikan alur baca folder, penanganan kegagalan, dan tidak terpaparnya rahasia pada respons. SDK autentikasi tidak dijalankan oleh uji lokal; validasi runtime dilakukan terpisah melalui dashboard.

Pengelola mengonfirmasi hasil berikut pada 16 Oktober 2026:

- Fungsi sudah diterapkan dan **Verify JWT with legacy secret** sudah dimatikan serta disimpan.
- Permintaan dengan publishable key ditolak HTTP 401 dengan `INVALID_API_KEY` dari SDK, sebelum handler Google dijalankan.
- Setelah **Add secret key** mengisi header `apikey`, permintaan menghasilkan `ok: true` dengan ketiga pemeriksaan bernilai `true`, sesuai contoh di atas. Tidak ada nilai key atau token yang dicatat di repository.

Kode ini adalah langkah persiapan backend. Migrasi aplikasi utama, Supabase Auth/Postgres, RLS produksi, integrasi unggahan, dan PWA belum diselesaikan oleh fungsi ini.

Rujukan: [autentikasi Edge Functions](https://supabase.com/docs/guides/functions/auth), [secrets](https://supabase.com/docs/guides/functions/secrets), [pembaruan access token Google](https://developers.google.com/identity/protocols/oauth2/web-server#offline), [Drive files.get](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get), dan [capabilities folder](https://developers.google.com/workspace/drive/api/reference/rest/v3/files).
