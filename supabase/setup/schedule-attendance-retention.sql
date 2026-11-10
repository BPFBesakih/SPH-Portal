-- OPSIONAL — jadwal harian penghapusan selfie Absensi yang sudah lewat 90 hari.
--
-- Tanpa jadwal ini pun, penghapusan berjalan otomatis setiap ada absen baru atau halaman absen
-- dibuka di HP aktif (paling sering 6 jam sekali). Jadwal ini menjaga masa simpan 90 hari tetap
-- berjalan saat Absensi sedang tidak dipakai, misalnya pilot dihentikan sementara.
--
-- Cara kerja: pg_cron memanggil Edge Function attendance-form dengan operasi `retention` lewat
-- pg_net. Operasi itu hanya menerima secret key server dan tidak pernah diteruskan gateway HP.
-- Fungsi langsung menjawab {"started":true}; penghapusan berjalan di latar belakang.
--
-- Sebelum menjalankan, ganti dua isian:
--   <PROJECT_REF>  ref proyek Supabase (subdomain <PROJECT_REF>.supabase.co).
--   <SECRET_KEY>   secret key server (Project Settings → API Keys → Secret keys), sama dengan
--                  SUPABASE_SECRET_KEY di Cloudflare Pages. Kunci disimpan di Vault, bukan di job.
-- Jadwal: 19.10 UTC = 03.10 WITA setiap hari.
--
-- Memeriksa:  Titik Absen → "Penghapusan selfie lama" → Terakhir berjalan; atau log Edge
--             attendance-form (event attendance_retention bila ada yang dihapus).
-- Membatalkan: SELECT cron.unschedule('attendance-selfie-retention');
--              DELETE FROM vault.secrets WHERE name='attendance_retention_secret';
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_net;
SELECT vault.create_secret('<SECRET_KEY>','attendance_retention_secret','Secret key untuk jadwal retensi selfie Absensi');
SELECT cron.schedule('attendance-selfie-retention','10 19 * * *',$job$
 SELECT net.http_post(
  url:='https://<PROJECT_REF>.supabase.co/functions/v1/attendance-form',
  body:=jsonb_build_object('operation','retention','client_ip','127.0.0.1','body','{}'::jsonb),
  headers:=jsonb_build_object('Content-Type','application/json','apikey',
   (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='attendance_retention_secret')),
  timeout_milliseconds:=10000)
$job$);
COMMIT;
