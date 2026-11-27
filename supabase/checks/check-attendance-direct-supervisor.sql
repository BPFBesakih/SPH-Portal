-- Dampak aturan "absen untuk orang lain hanya oleh atasan langsung" (hanya membaca; ditutup ROLLBACK).
-- Jalankan di Supabase SQL Editor sebelum merilis pembaruan ini, lalu sekali lagi sesudahnya.
-- Satu tabel hasil: bagian · item · hasil.
--   0. Ringkasan jumlah.
--   1. HP bersama aktif/menunggu: sesudah rilis tidak bisa dipakai absen. Daftarkan ulang HP itu
--      sebagai HP pribadi pemegangnya (misalnya koordinator), atau nonaktifkan di HP Absen.
--   2. Absen 30 hari terakhir di HP pribadi orang lain yang BUKAN atasan langsungnya menurut
--      penempatan hari ini: absen seperti ini ditolak sesudah rilis. Pegawai tersebut perlu absen di
--      HP sendiri atau di HP atasan langsungnya.
--   3. Pegawai aktif tanpa atasan langsung yang pasti (tanpa atasan, tanpa penempatan utama, atau
--      penempatan utama ganda): hanya bisa absen di HP-nya sendiri. Bila pegawai itu tidak punya
--      HP, rapikan atasannya di Data Pegawai.
BEGIN READ ONLY;

WITH d AS (
 SELECT to_char(now() AT TIME ZONE 'Asia/Makassar','YYYY-MM-DD') AS today,
        to_char((now() - interval '30 days') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS') AS since),
-- Atasan langsung per pegawai aktif, sama dengan aturan portal: penempatan utama yang berlaku
-- hari ini (WITA); hanya pasti bila penempatan utamanya tepat satu.
direct AS (
 SELECT e.id,e.employee_no,e.full_name,count(ep.id) AS primaries,min(ep.supervisor_employee_id) AS supervisor_id
 FROM portal.employees e CROSS JOIN d
 LEFT JOIN portal.employee_placements ep ON ep.employee_id=e.id AND ep.is_primary=1
  AND ep.valid_from<=d.today AND (ep.valid_to IS NULL OR ep.valid_to>=d.today)
 WHERE e.is_active=1
 GROUP BY e.id,e.employee_no,e.full_name),
shared AS (
 SELECT concat_ws(' · ',dv.label,u.name) AS item,
  format('status %s; terakhir dipakai %s; absen 30 hari: %s dari %s orang',
   dv.status,coalesce(dv.last_seen_at,'belum pernah'),count(ev.id),count(DISTINCT ev.employee_id)) AS hasil
 FROM portal.attendance_devices dv CROSS JOIN d
 LEFT JOIN portal.org_units u ON u.id=dv.org_unit_id
 LEFT JOIN portal.attendance_events ev ON ev.device_id=dv.id AND ev.recorded_at>=d.since
 WHERE dv.kind='SHARED' AND dv.status IN ('ACTIVE','PENDING')
 GROUP BY dv.id,dv.label,u.name,dv.status,dv.last_seen_at),
refused AS (
 SELECT concat_ws(' · ',who.full_name,'HP pribadi '||owner.full_name) AS item,
  format('%s absen dalam 30 hari; atasan langsung saat ini: %s',count(*),
   CASE WHEN coalesce(l.primaries,0)<>1 THEN format('tidak pasti (penempatan utama aktif: %s)',coalesce(l.primaries,0))
        ELSE coalesce(boss.full_name,'tidak ada') END) AS hasil
 FROM portal.attendance_events ev CROSS JOIN d
 JOIN portal.attendance_devices dv ON dv.id=ev.device_id AND dv.kind='PERSONAL'
 JOIN portal.employees owner ON owner.id=dv.owner_employee_id
 JOIN portal.employees who ON who.id=ev.employee_id
 LEFT JOIN direct l ON l.id=ev.employee_id
 LEFT JOIN portal.employees boss ON boss.id=l.supervisor_id
 WHERE ev.recorded_at>=d.since AND ev.employee_id<>dv.owner_employee_id
  AND NOT (coalesce(l.primaries,0)=1 AND l.supervisor_id IS NOT DISTINCT FROM dv.owner_employee_id)
 GROUP BY who.full_name,owner.full_name,boss.full_name,l.primaries),
unclear AS (
 SELECT concat_ws(' · ',l.employee_no,l.full_name) AS item,
  CASE WHEN l.primaries=0 THEN 'tanpa penempatan utama aktif'
       WHEN l.primaries>1 THEN format('penempatan utama aktif: %s',l.primaries)
       ELSE 'penempatan utama tanpa atasan' END AS hasil
 FROM direct l WHERE l.primaries<>1 OR l.supervisor_id IS NULL)
SELECT bagian,item,hasil FROM (
 SELECT 0 AS urut,1 AS sub,'0. Ringkasan' AS bagian,'HP bersama aktif/menunggu' AS item,(SELECT count(*) FROM shared)::text AS hasil
 UNION ALL SELECT 0,2,'0. Ringkasan','Pasangan pegawai · HP pribadi orang lain yang sesudah rilis ditolak (30 hari)',(SELECT count(*) FROM refused)::text
 UNION ALL SELECT 0,3,'0. Ringkasan','Pegawai aktif tanpa atasan langsung yang pasti',(SELECT count(*) FROM unclear)::text
 UNION ALL SELECT 1,0,'1. HP bersama yang berhenti dipakai',item,hasil FROM shared
 UNION ALL SELECT 2,0,'2. Absen di HP orang lain yang bukan atasan langsung',item,hasil FROM refused
 UNION ALL SELECT 3,0,'3. Pegawai tanpa atasan langsung yang pasti',item,hasil FROM unclear
) AS rows ORDER BY urut,sub,item;

ROLLBACK;
