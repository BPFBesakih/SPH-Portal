-- Pra-cek sebelum memasang Absensi (hanya membaca; ditutup ROLLBACK).
-- Satu tabel hasil: bagian · item · hasil. Jalankan di Supabase SQL Editor.
--   1. Prasyarat: semua harus "OK" (atau "Belum ada" untuk tabel Absensi sebelum migrasi).
--   2. Data per unit: perhatikan unit pilot; tanpa_atasan dan penempatan_ganda sebaiknya 0
--      (pucuk organisasi wajar tanpa atasan). Nomor HP dipakai untuk tautan WhatsApp HP pribadi.
--   3. Pegawai aktif dengan 0 atau lebih dari 1 penempatan utama aktif tidak masuk pohon
--      atasan Absensi dan tidak tampil benar di daftar nama HP; rapikan di Data Pegawai.
BEGIN READ ONLY;

WITH d AS (SELECT to_char(now() AT TIME ZONE 'Asia/Makassar','YYYY-MM-DD') AS today),
prerequisites(n,item,hasil) AS (VALUES
 (1,'Kolom leave_request_days.leave_type (migrasi Cuti khusus 20261105020040)',
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='portal' AND table_name='leave_request_days' AND column_name='leave_type')
       THEN 'OK' ELSE 'BELUM ADA - jalankan migrasi Cuti khusus dulu; tanpa kolom ini rekap Absensi gagal' END),
 (2,'Tabel Absensi (migrasi 20261105120000)',
  CASE WHEN to_regclass('portal.attendance_events') IS NULL THEN 'Belum ada - migrasi Absensi boleh dijalankan'
       ELSE 'Sudah ada - jangan jalankan migrasi lagi' END),
 (3,'View portal.users',CASE WHEN to_regclass('portal.users') IS NOT NULL THEN 'OK' ELSE 'TIDAK ADA - rute Absensi akan gagal' END),
 (4,'Ekstensi pg_cron (hanya untuk jadwal retensi opsional)',
  CASE WHEN EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN 'OK' ELSE 'Tidak aktif - jadwal retensi opsional tidak bisa dipasang' END)),
placed AS (
 SELECT e.id,e.phone,ep.supervisor_employee_id,p.org_unit_id,count(*) OVER (PARTITION BY e.id) AS primaries
 FROM portal.employees e CROSS JOIN d
 JOIN portal.employee_placements ep ON ep.employee_id=e.id AND ep.is_primary=1
  AND ep.valid_from<=d.today AND (ep.valid_to IS NULL OR ep.valid_to>=d.today)
 JOIN portal.positions p ON p.id=ep.position_id
 WHERE e.is_active=1),
units AS (
 SELECT u.name AS item,
  format('pegawai aktif %s; tanpa atasan %s; tanpa nomor HP %s; penempatan ganda %s; punya akun portal %s',
   count(DISTINCT pl.id),
   count(DISTINCT pl.id) FILTER (WHERE pl.supervisor_employee_id IS NULL),
   count(DISTINCT pl.id) FILTER (WHERE coalesce(trim(pl.phone),'')=''),
   count(DISTINCT pl.id) FILTER (WHERE pl.primaries>1),
   count(DISTINCT au.employee_id)) AS hasil
 FROM placed pl JOIN portal.org_units u ON u.id=pl.org_unit_id
 LEFT JOIN public.app_users au ON au.employee_id=pl.id
 GROUP BY u.name),
problems AS (
 SELECT concat_ws(' · ',e.employee_no,e.full_name) AS item,
  format('penempatan utama aktif: %s',count(ep.id)) AS hasil
 FROM portal.employees e CROSS JOIN d
 LEFT JOIN portal.employee_placements ep ON ep.employee_id=e.id AND ep.is_primary=1
  AND ep.valid_from<=d.today AND (ep.valid_to IS NULL OR ep.valid_to>=d.today)
 WHERE e.is_active=1
 GROUP BY e.id,e.employee_no,e.full_name
 HAVING count(ep.id)<>1)
SELECT bagian,item,hasil FROM (
 SELECT 1 AS urut,n AS sub,'1. Prasyarat' AS bagian,item,hasil FROM prerequisites
 UNION ALL SELECT 2,0,'2. Data per unit',item,hasil FROM units
 UNION ALL SELECT 3,0,'3. Penempatan bermasalah',item,hasil FROM problems
) AS rows ORDER BY urut,sub,item;

ROLLBACK;
