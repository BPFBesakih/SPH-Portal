-- Attendance foundation. Apply through a reviewed Supabase migration before deployment.
-- Supabase CLI is unavailable in the development session; no migration history is fabricated.
BEGIN;
CREATE TABLE portal.attendance_config (
 id integer PRIMARY KEY CHECK(id=1), enabled boolean NOT NULL DEFAULT false,
 activation_on date, boundary_mode text CHECK(boundary_mode IN ('EXACT','WHOLE_MINUTE')),
 minute_rounding text CHECK(minute_rounding IN ('FLOOR','CEIL')),
 gps_max_accuracy_m double precision CHECK(gps_max_accuracy_m BETWEEN 1 AND 100),
 gps_max_age_seconds integer CHECK(gps_max_age_seconds BETWEEN 5 AND 300),
 evidence_retention_days integer CHECK(evidence_retention_days BETWEEN 1 AND 3650),
 evidence_policy_confirmed boolean NOT NULL DEFAULT false,
 request_day_mode text CHECK(request_day_mode='SINGLE_DAY'),
 privacy_notice text NOT NULL DEFAULT '', row_version integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id)
);
INSERT INTO portal.attendance_config(id) VALUES(1);
CREATE TABLE portal.attendance_locations (
 id text PRIMARY KEY, name text NOT NULL, latitude double precision NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude double precision NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 radius_m double precision NOT NULL CHECK(radius_m BETWEEN 1 AND 10000), is_default boolean NOT NULL DEFAULT false,
 is_active boolean NOT NULL DEFAULT true, row_version integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id)
);
CREATE UNIQUE INDEX attendance_one_default ON portal.attendance_locations(is_default) WHERE is_default;
INSERT INTO portal.attendance_locations(id,name,latitude,longitude,radius_m,is_default)
 VALUES('office-default','Kantor BPFKSPA Besakih',-8.379975,115.447373,100,true);
CREATE TABLE portal.attendance_employee_settings (
 employee_id text PRIMARY KEY REFERENCES portal.employees(id), enabled boolean NOT NULL DEFAULT false, active_from date,
 location_mode text NOT NULL DEFAULT 'DEFAULT' CHECK(location_mode IN ('DEFAULT','CUSTOM','UNRESTRICTED')),
 location_id text REFERENCES portal.attendance_locations(id), row_version integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
 CHECK(location_mode<>'CUSTOM' OR location_id IS NOT NULL)
);
CREATE TABLE portal.attendance_schedules (
 id text PRIMARY KEY, employee_id text NOT NULL REFERENCES portal.employees(id), work_date date NOT NULL,
 name text NOT NULL, day_kind text NOT NULL CHECK(day_kind IN ('WORK','OFF')),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 checkin_opens_at timestamptz NOT NULL, checkin_closes_at timestamptz NOT NULL,
 checkout_closes_at timestamptz NOT NULL, late_after timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED')),
 policy_snapshot jsonb,
 row_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid REFERENCES public.app_users(id), updated_by uuid REFERENCES public.app_users(id),
 UNIQUE(employee_id,work_date), CHECK(ends_at>starts_at), CHECK(ends_at<=starts_at+interval '36 hours'),
 CHECK(checkin_opens_at<=starts_at AND checkin_closes_at>starts_at AND checkin_closes_at<=ends_at),
 CHECK(checkout_closes_at>=ends_at), CHECK(late_after>=starts_at AND late_after<ends_at)
);
CREATE INDEX attendance_schedules_period ON portal.attendance_schedules(work_date,employee_id);
CREATE TABLE portal.attendance_evidence (
 id text PRIMARY KEY, employee_id text NOT NULL REFERENCES portal.employees(id), purpose text NOT NULL CHECK(purpose IN ('SELFIE','REQUEST')),
 storage_key text NOT NULL UNIQUE, mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','application/pdf')),
 size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 2097152), checksum text NOT NULL,
 created_by uuid NOT NULL REFERENCES public.app_users(id), created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE INDEX attendance_evidence_expiry ON portal.attendance_evidence(expires_at);
CREATE TABLE portal.attendance_events (
 id text PRIMARY KEY, schedule_id text NOT NULL REFERENCES portal.attendance_schedules(id), employee_id text NOT NULL REFERENCES portal.employees(id),
 kind text NOT NULL CHECK(kind IN ('IN','OUT')), received_at timestamptz NOT NULL,
 client_key text NOT NULL, payload_hash text NOT NULL, evidence_id text NOT NULL UNIQUE REFERENCES portal.attendance_evidence(id),
 latitude double precision NOT NULL CHECK(latitude BETWEEN -90 AND 90), longitude double precision NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 accuracy_m double precision NOT NULL CHECK(accuracy_m>0), location_read_at timestamptz NOT NULL, distance_m double precision NOT NULL CHECK(distance_m>=0),
 policy_snapshot jsonb NOT NULL, created_by uuid NOT NULL REFERENCES public.app_users(id),
 UNIQUE(schedule_id,kind), UNIQUE(employee_id,client_key)
);
CREATE INDEX attendance_events_employee_time ON portal.attendance_events(employee_id,received_at);
CREATE TABLE portal.attendance_requests (
 id text PRIMARY KEY, employee_id text NOT NULL REFERENCES portal.employees(id), kind text NOT NULL CHECK(kind IN ('SICK','PERMIT')),
 work_date date NOT NULL, reason text NOT NULL, evidence_id text NOT NULL UNIQUE REFERENCES portal.attendance_evidence(id),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
 client_key text NOT NULL, payload_hash text NOT NULL, row_version integer NOT NULL DEFAULT 1,
 created_by uuid NOT NULL REFERENCES public.app_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 decided_by uuid REFERENCES public.app_users(id), decided_at timestamptz, decision_note text,
 UNIQUE(employee_id,client_key)
);
CREATE UNIQUE INDEX attendance_requests_active_day ON portal.attendance_requests(employee_id,work_date) WHERE status IN ('PENDING','APPROVED');
CREATE INDEX attendance_requests_pending ON portal.attendance_requests(status,work_date);
CREATE TABLE portal.attendance_corrections (
 id text PRIMARY KEY, schedule_id text NOT NULL REFERENCES portal.attendance_schedules(id), revision integer NOT NULL,
 before_value jsonb NOT NULL, after_value jsonb NOT NULL, reason text NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.app_users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(schedule_id,revision)
);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['attendance_config','attendance_locations','attendance_employee_settings','attendance_schedules','attendance_evidence','attendance_events','attendance_requests','attendance_corrections'] LOOP
  EXECUTE format('ALTER TABLE portal.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON portal.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $$;
-- All access uses the authenticated portal gateway and its transaction-bound authorization.
-- No generic administrator, employee, or manager receives these new grants automatically.
INSERT INTO public.app_permissions(code,module_code,resource,action,description) VALUES
 ('hr.attendance.read','hr','hr.attendance','read','Melihat rekap absensi sesuai cakupan.'),
 ('hr.attendance.export','hr','hr.attendance','export','Mengekspor rekap absensi sesuai cakupan.'),
 ('hr.attendance.correct','hr','hr.attendance','correct','Mengoreksi absensi dengan alasan dan audit.'),
 ('hr.attendance.approve','hr','hr.attendance','approve','Memutuskan Sakit/Izin sesuai cakupan.'),
 ('hr.attendance.evidence','hr','hr.attendance','evidence','Membaca selfie, lokasi, dan bukti sesuai cakupan.'),
 ('hr.attendance.schedule','hr','hr.attendance','schedule','Menetapkan jadwal absensi sesuai cakupan.'),
 ('hr.attendance.settings','hr','hr.attendance','settings','Mengatur kebijakan, lokasi, dan aktivasi absensi.')
 ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_roles(code,name,description,is_system)
 VALUES('ATTENDANCE_MANAGER','Pengelola Absensi','Pengelolaan absensi. Tetapkan hanya pada akun berwenang.',true) ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM public.app_roles r CROSS JOIN public.app_permissions p
 WHERE r.code='ATTENDANCE_MANAGER' AND p.resource='hr.attendance' ON CONFLICT DO NOTHING;
COMMIT;
