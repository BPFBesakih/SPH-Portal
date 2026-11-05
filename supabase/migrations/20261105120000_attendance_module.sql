-- Absensi (tahap 1): absen harian GPS + selfie dari HP terdaftar.
-- Yang didaftarkan adalah HP, bukan pegawai: satu HP terdaftar bisa dipakai banyak
-- pegawai (pegawai tanpa HP menumpang di HP teman, koordinator, atau HP pos).
-- Catatan absen tidak pernah dihapus atau diubah; koreksi ditambahkan sebagai baris baru.
-- Selfie disimpan di folder Drive SPH-Portal-Absensi dan dihapus setelah 90 hari
-- oleh Edge Function attendance-form (bukan pg_cron, karena Drive hanya bisa
-- dihubungi dari Edge). IT_ADMIN sengaja TIDAK diberi izin hr.attendance.*.
BEGIN;
SET LOCAL search_path=portal,pg_catalog;

-- Titik absen: koordinat + radius (bawaan 100 m).
CREATE TABLE portal.attendance_points (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 latitude DOUBLE PRECISION NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude DOUBLE PRECISION NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 radius_m INTEGER NOT NULL DEFAULT 100 CHECK(radius_m BETWEEN 20 AND 1000),
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID REFERENCES public.app_users(id));

-- Sesi pendaftaran: satu tautan untuk banyak HP pribadi dalam satu unit, paling lama
-- 30 menit. Setiap HP yang masuk menunggu dicentang pengelola.
CREATE TABLE portal.attendance_registration_sessions (
 id TEXT PRIMARY KEY, org_unit_id TEXT NOT NULL REFERENCES portal.org_units(id),
 token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
 expires_at TEXT NOT NULL, closed_at TEXT, closed_by UUID REFERENCES public.app_users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID NOT NULL REFERENCES public.app_users(id));

-- HP terdaftar. PENDING: tautan belum dibuka (tanpa kunci) atau menunggu dicentang
-- (sesi, sudah berkunci). Kunci privat tidak pernah meninggalkan HP; portal hanya
-- menyimpan kunci publik untuk memeriksa tanda tangan setiap permintaan.
CREATE TABLE portal.attendance_devices (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN('PERSONAL','SHARED')),
 owner_employee_id TEXT REFERENCES portal.employees(id), org_unit_id TEXT REFERENCES portal.org_units(id),
 label TEXT CHECK(label IS NULL OR length(label) BETWEEN 1 AND 80),
 status TEXT NOT NULL CHECK(status IN('PENDING','ACTIVE','REJECTED','REVOKED')),
 registration_token_hash TEXT UNIQUE CHECK(registration_token_hash IS NULL OR length(registration_token_hash)=64), registration_expires_at TEXT,
 session_id TEXT REFERENCES portal.attendance_registration_sessions(id),
 public_key TEXT CHECK(public_key IS NULL OR length(public_key)<=400), key_thumbprint TEXT UNIQUE CHECK(key_thumbprint IS NULL OR length(key_thumbprint)=64),
 activated_at TEXT, approved_by UUID REFERENCES public.app_users(id), approved_at TEXT,
 revoked_by UUID REFERENCES public.app_users(id), revoked_at TEXT, revoke_reason TEXT CHECK(revoke_reason IS NULL OR length(revoke_reason)<=300),
 last_seen_at TEXT, client_info TEXT CHECK(client_info IS NULL OR length(client_info)<=200),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID REFERENCES public.app_users(id),
 CHECK(kind<>'PERSONAL' OR owner_employee_id IS NOT NULL),
 CHECK(kind<>'SHARED' OR (org_unit_id IS NOT NULL AND label IS NOT NULL)),
 CHECK(status<>'ACTIVE' OR public_key IS NOT NULL),
 CHECK(session_id IS NULL OR kind='PERSONAL'));
CREATE INDEX attendance_devices_owner ON portal.attendance_devices(owner_employee_id);
CREATE INDEX attendance_devices_session ON portal.attendance_devices(session_id) WHERE session_id IS NOT NULL;

-- Absen masuk/pulang. Jam dari server (WITA untuk tanggal kerja). Pulang menunjuk
-- pasangan masuknya, sehingga shift malam tetap satu tanggal kerja.
CREATE TABLE portal.attendance_events (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES portal.employees(id),
 kind TEXT NOT NULL CHECK(kind IN('IN','OUT')), recorded_at TEXT NOT NULL,
 work_date TEXT NOT NULL CHECK(work_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 pair_event_id TEXT REFERENCES portal.attendance_events(id),
 device_id TEXT NOT NULL REFERENCES portal.attendance_devices(id), client_key TEXT NOT NULL CHECK(length(client_key)=36),
 latitude DOUBLE PRECISION NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude DOUBLE PRECISION NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 accuracy_m DOUBLE PRECISION NOT NULL CHECK(accuracy_m>=0 AND accuracy_m<=100000), location_captured_at TEXT,
 point_id TEXT REFERENCES portal.attendance_points(id), point_name TEXT CHECK(point_name IS NULL OR length(point_name)<=80),
 distance_m INTEGER CHECK(distance_m IS NULL OR distance_m>=0), within_point INTEGER NOT NULL CHECK(within_point IN(0,1)),
 outside_reason TEXT CHECK(outside_reason IS NULL OR outside_reason IN('DINAS_LUAR','TUGAS_LAPANGAN','LAINNYA')),
 outside_note TEXT CHECK(outside_note IS NULL OR length(outside_note)<=300),
 photo_storage_key TEXT CHECK(photo_storage_key IS NULL OR length(photo_storage_key)<=200),
 photo_mime TEXT NOT NULL CHECK(photo_mime='image/jpeg'), photo_size INTEGER NOT NULL CHECK(photo_size BETWEEN 1 AND 307200),
 photo_checksum TEXT NOT NULL CHECK(length(photo_checksum)=64), photo_deleted_at TEXT,
 flags TEXT NOT NULL DEFAULT '[]' CHECK(length(flags)<=400), confirmed_order INTEGER NOT NULL DEFAULT 0 CHECK(confirmed_order IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 UNIQUE(device_id,client_key),
 CHECK(pair_event_id IS NULL OR kind='OUT'),
 CHECK(within_point=1 OR point_id IS NULL OR outside_reason IS NOT NULL),
 CHECK((photo_storage_key IS NULL)=(photo_deleted_at IS NOT NULL)));
CREATE UNIQUE INDEX attendance_events_one_pair ON portal.attendance_events(pair_event_id) WHERE pair_event_id IS NOT NULL;
CREATE INDEX attendance_events_employee_time ON portal.attendance_events(employee_id,recorded_at);
CREATE INDEX attendance_events_day ON portal.attendance_events(work_date,employee_id);
CREATE INDEX attendance_events_device_time ON portal.attendance_events(device_id,recorded_at);
CREATE INDEX attendance_events_photo_retention ON portal.attendance_events(recorded_at) WHERE photo_storage_key IS NOT NULL;

-- Hanya penghapusan selfie (retensi 90 hari) yang boleh mengubah baris absen.
CREATE FUNCTION portal.attendance_events_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $guard$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Catatan absen tidak boleh dihapus.'; END IF;
 IF (to_jsonb(NEW)-ARRAY['photo_storage_key','photo_deleted_at','updated_at','row_version'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['photo_storage_key','photo_deleted_at','updated_at','row_version'])
    OR (OLD.photo_storage_key IS NULL AND NEW.photo_storage_key IS NOT NULL) THEN
  RAISE EXCEPTION 'Catatan absen tidak boleh diubah. Tambahkan koreksi.';
 END IF;
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION portal.attendance_events_append_only() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER attendance_events_append_only BEFORE UPDATE OR DELETE ON portal.attendance_events
 FOR EACH ROW EXECUTE FUNCTION portal.attendance_events_append_only();

-- Koreksi jam oleh atasan langsung (≤ 7 hari) atau Pengelola Absensi. Koreksi terbaru
-- yang aktif menentukan jam masuk/pulang; void_event_id menyisihkan absen yang salah
-- nama. Catatan asli tetap ada.
CREATE TABLE portal.attendance_corrections (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES portal.employees(id),
 work_date TEXT NOT NULL CHECK(work_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 in_at TEXT, out_at TEXT, void_event_id TEXT REFERENCES portal.attendance_events(id),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
 revoked_at TEXT, revoked_by UUID REFERENCES public.app_users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID NOT NULL REFERENCES public.app_users(id),
 CHECK(in_at IS NOT NULL OR out_at IS NOT NULL OR void_event_id IS NOT NULL),
 CHECK(in_at IS NULL OR out_at IS NULL OR in_at<out_at));
CREATE INDEX attendance_corrections_day ON portal.attendance_corrections(work_date,employee_id);

-- Keterangan harian (Izin, Sakit, Dinas luar). Satu keterangan aktif per pegawai per tanggal.
CREATE TABLE portal.attendance_day_notes (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES portal.employees(id),
 work_date TEXT NOT NULL CHECK(work_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 kind TEXT NOT NULL CHECK(kind IN('IZIN','SAKIT','DINAS_LUAR')), note TEXT CHECK(note IS NULL OR length(note)<=500),
 revoked_at TEXT, revoked_by UUID REFERENCES public.app_users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID NOT NULL REFERENCES public.app_users(id));
CREATE UNIQUE INDEX attendance_day_notes_active ON portal.attendance_day_notes(employee_id,work_date) WHERE revoked_at IS NULL;
CREATE INDEX attendance_day_notes_day ON portal.attendance_day_notes(work_date);

-- Hasil pengecekan absen bertanda: Sesuai atau Perlu klarifikasi.
CREATE TABLE portal.attendance_reviews (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL UNIQUE REFERENCES portal.attendance_events(id),
 decision TEXT NOT NULL CHECK(decision IN('SESUAI','KLARIFIKASI')), note TEXT CHECK(note IS NULL OR length(note)<=500),
 reviewed_by UUID NOT NULL REFERENCES public.app_users(id), reviewed_at TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL);

-- Foto acuan: satu selfie terkonfirmasi per pegawai. Selfie acuan tidak ikut
-- dihapus retensi selama pegawai aktif (dan 90 hari setelah nonaktif).
CREATE TABLE portal.attendance_reference_photos (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL UNIQUE REFERENCES portal.employees(id),
 event_id TEXT NOT NULL REFERENCES portal.attendance_events(id),
 set_by UUID NOT NULL REFERENCES public.app_users(id), set_at TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL);
CREATE INDEX attendance_reference_photos_event ON portal.attendance_reference_photos(event_id);

-- Batas frekuensi per IP dan per HP (10 menit), satu INSERT … ON CONFLICT atomik.
CREATE TABLE portal.attendance_rate_limits (
 id TEXT PRIMARY KEY, window_start TEXT NOT NULL, hits INTEGER NOT NULL CHECK(hits>0));

-- Lease retensi selfie (satu baris).
CREATE TABLE portal.attendance_state (
 id INTEGER PRIMARY KEY CHECK(id=1), lease_owner TEXT, lease_until TEXT, last_retention_at TEXT,
 last_error TEXT CHECK(last_error IS NULL OR length(last_error)<=300), deleted_photos INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
 CHECK((lease_owner IS NULL)=(lease_until IS NULL)));
INSERT INTO portal.attendance_state(id,updated_at) VALUES(1,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ON CONFLICT DO NOTHING;

DO $rls$
DECLARE t TEXT;
BEGIN
 FOREACH t IN ARRAY ARRAY['attendance_points','attendance_registration_sessions','attendance_devices','attendance_events','attendance_corrections',
  'attendance_day_notes','attendance_reviews','attendance_reference_photos','attendance_rate_limits','attendance_state'] LOOP
  EXECUTE format('ALTER TABLE portal.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON portal.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $rls$;

INSERT INTO public.app_permissions(code,module_code,resource,action)
SELECT 'hr.attendance.'||a.action,'hr','hr.attendance',a.action
FROM unnest(ARRAY['read','manage','devices','settings']) AS a(action)
ON CONFLICT(code) DO NOTHING;

-- Pengelola Absensi memegang semua izin; Koordinator HP Absen hanya mendaftarkan dan
-- menonaktifkan HP untuk unit cakupannya. Role SDM tidak otomatis mendapat absensi.
WITH templates(code,name,codes) AS (VALUES
 ('ABSENSI_PENGELOLA','Pengelola Absensi',ARRAY['hr.attendance.read','hr.attendance.manage','hr.attendance.devices','hr.attendance.settings']),
 ('ABSENSI_KOORDINATOR','Koordinator HP Absen',ARRAY['hr.attendance.devices'])),
added AS (
 INSERT INTO public.app_roles(code,name) SELECT code,name FROM templates
 ON CONFLICT(code) DO NOTHING RETURNING id,code),
assigned AS (
 SELECT id,code FROM added
 UNION ALL
 SELECT r.id,r.code FROM public.app_roles r JOIN templates t ON t.code=r.code
 WHERE NOT EXISTS(SELECT 1 FROM added a WHERE a.code=r.code))
INSERT INTO public.app_role_permissions(role_id,permission_id)
SELECT a.id,p.id FROM assigned a JOIN templates t ON t.code=a.code JOIN public.app_permissions p ON p.code=ANY(t.codes)
ON CONFLICT DO NOTHING;

-- Super Admin memegang semua izin (keputusan 19 Oktober).
INSERT INTO public.app_role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM public.app_roles r CROSS JOIN public.app_permissions p
WHERE r.code='SUPER_ADMIN' AND p.resource='hr.attendance'
ON CONFLICT DO NOTHING;

NOTIFY pgrst,'reload schema';
COMMIT;
