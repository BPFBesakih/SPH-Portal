-- Private leave opening balances and yearly ledger. No direct client grants.
BEGIN;

CREATE TABLE portal.leave_import_batches (
 id text PRIMARY KEY,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
 payload_sha256 text NOT NULL UNIQUE CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 cutoff_date date NOT NULL, balance_year integer NOT NULL CHECK(balance_year>=2026),
 approved_by text NOT NULL, approval_text text NOT NULL,
 approval_recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 imported_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 imported_count integer NOT NULL CHECK(imported_count>=0),
 imported_days integer NOT NULL CHECK(imported_days>=0),
 excluded_count integer NOT NULL CHECK(excluded_count>=0),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object')
);
CREATE TABLE portal.leave_import_rows (
 batch_id text NOT NULL REFERENCES portal.leave_import_batches(id),
 record_key text NOT NULL, source_kind text NOT NULL CHECK(source_kind IN ('PDF','USER_SUPPLEMENT')),
 source_row integer, source_page integer,
 source_name text NOT NULL, reconciled_name text NOT NULL,
 employee_id text REFERENCES portal.employees(id),
 source_days integer NOT NULL CHECK(source_days>=0),
 disposition text NOT NULL CHECK(disposition IN ('IMPORTED','EXCLUDED_INACTIVE')),
 decision jsonb NOT NULL,
 PRIMARY KEY(batch_id,record_key), UNIQUE(batch_id,employee_id),
 CHECK((source_kind='PDF' AND source_row>0 AND source_page BETWEEN 1 AND 3)
    OR (source_kind='USER_SUPPLEMENT' AND source_row IS NULL AND source_page IS NULL)),
 CHECK(disposition<>'IMPORTED' OR employee_id IS NOT NULL)
);
CREATE INDEX leave_import_rows_employee ON portal.leave_import_rows(employee_id);

CREATE TABLE portal.leave_year_balances (
 employee_id text NOT NULL REFERENCES portal.employees(id),
 balance_year integer NOT NULL CHECK(balance_year>=2026),
 origin text NOT NULL CHECK(origin IN ('OPENING','ANNUAL_GRANT')),
 granted_days integer NOT NULL CHECK(granted_days>=0),
 remaining_days integer NOT NULL CHECK(remaining_days>=0),
 consumed_days integer NOT NULL DEFAULT 0 CHECK(consumed_days>=0),
 expired_days integer NOT NULL DEFAULT 0 CHECK(expired_days>=0),
 effective_from date NOT NULL, expires_on date NOT NULL,
 source_batch_id text REFERENCES portal.leave_import_batches(id),
 closed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 row_version integer NOT NULL DEFAULT 1,
 PRIMARY KEY(employee_id,balance_year),
 CHECK(granted_days=remaining_days+consumed_days+expired_days),
 CHECK(expires_on=make_date(balance_year+1,4,1)),
 CHECK(effective_from<expires_on),
 CHECK((origin='OPENING' AND source_batch_id IS NOT NULL)
    OR (origin='ANNUAL_GRANT' AND source_batch_id IS NULL AND granted_days=12)),
 CHECK(closed_at IS NULL OR remaining_days=0)
);
CREATE INDEX leave_year_balances_batch ON portal.leave_year_balances(source_batch_id);
CREATE INDEX leave_year_balances_expiry ON portal.leave_year_balances(expires_on) WHERE closed_at IS NULL;

CREATE TABLE portal.leave_balance_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_id text NOT NULL, balance_year integer NOT NULL,
 event_key text NOT NULL UNIQUE,
 event_type text NOT NULL CHECK(event_type IN ('OPENING','ANNUAL_GRANT','EXPIRY')),
 delta_days integer NOT NULL,
 before_days integer NOT NULL CHECK(before_days>=0),
 after_days integer NOT NULL CHECK(after_days>=0),
 source_batch_id text REFERENCES portal.leave_import_batches(id),
 effective_date date NOT NULL,
 details jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(employee_id,balance_year) REFERENCES portal.leave_year_balances(employee_id,balance_year),
 CHECK(after_days=before_days+delta_days),
 CHECK((event_type='OPENING' AND before_days=0 AND delta_days>=0 AND source_batch_id IS NOT NULL)
    OR (event_type='ANNUAL_GRANT' AND before_days=0 AND delta_days=12 AND source_batch_id IS NULL)
    OR (event_type='EXPIRY' AND delta_days<=0 AND after_days=0))
);
CREATE INDEX leave_balance_events_employee_year ON portal.leave_balance_events(employee_id,balance_year,created_at);
CREATE INDEX leave_balance_events_batch ON portal.leave_balance_events(source_batch_id);

ALTER TABLE portal.leave_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.leave_import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.leave_year_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.leave_balance_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.leave_import_batches,portal.leave_import_rows,portal.leave_year_balances,portal.leave_balance_events
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION portal.leave_business_date() RETURNS date
 LANGUAGE sql STABLE PARALLEL SAFE SECURITY INVOKER SET search_path=pg_catalog
 AS $$ SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Makassar')::date $$;
REVOKE ALL ON FUNCTION portal.leave_business_date() FROM PUBLIC,anon,authenticated,service_role;

-- This job is private, has no date override and never credits years before 2027.
-- Hourly retries on 1 January remain idempotent. Mid-year/new-status eligibility
-- is deliberately not invented; new hires after January 1 require SDM review.
CREATE FUNCTION portal.run_leave_year_maintenance() RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
 AS $maintenance$
DECLARE
 business_day date := portal.leave_business_date();
 credit_year integer := extract(year FROM business_day)::integer;
 balance record;
 employee record;
 inserted_employee text;
 expiry_count integer := 0;
 credit_count integer := 0;
 expired_total integer := 0;
 stamp text := to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('portal.leave_year_maintenance',0));
 FOR balance IN SELECT * FROM portal.leave_year_balances
   WHERE expires_on<=business_day AND closed_at IS NULL
   ORDER BY employee_id,balance_year FOR UPDATE LOOP
   UPDATE portal.leave_year_balances
     SET remaining_days=0,expired_days=expired_days+balance.remaining_days,
         closed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,row_version=row_version+1
     WHERE employee_id=balance.employee_id AND balance_year=balance.balance_year;
   INSERT INTO portal.leave_balance_events
     (employee_id,balance_year,event_key,event_type,delta_days,before_days,after_days,source_batch_id,effective_date,details)
     VALUES(balance.employee_id,balance.balance_year,'EXPIRY:'||balance.employee_id||':'||balance.balance_year,
       'EXPIRY',-balance.remaining_days,balance.remaining_days,0,balance.source_batch_id,balance.expires_on,
       jsonb_build_object('processed_on',business_day,'timezone','Asia/Makassar'));
   expiry_count := expiry_count+1;
   expired_total := expired_total+balance.remaining_days;
 END LOOP;
 IF credit_year>=2027 AND extract(month FROM business_day)=1 AND extract(day FROM business_day)=1 THEN
   IF EXISTS(SELECT 1 FROM portal.employees WHERE is_active=1 AND employment_status NOT IN
       ('Pegawai Kontrak (PKWT)','Pegawai Probation','Tenaga Harian Lepas')) THEN
     RAISE EXCEPTION 'Unrecognized employment status: SDM must verify eligibility before annual credit';
   END IF;
   FOR employee IN SELECT id,full_name,employment_status FROM portal.employees
     WHERE is_active=1 AND employment_status IN ('Pegawai Kontrak (PKWT)','Pegawai Probation')
       AND joined_on<=business_day::text AND (ended_on IS NULL OR ended_on>=business_day::text)
     ORDER BY id FOR SHARE LOOP
     INSERT INTO portal.leave_year_balances
       (employee_id,balance_year,origin,granted_days,remaining_days,effective_from,expires_on)
       VALUES(employee.id,credit_year,'ANNUAL_GRANT',12,12,business_day,make_date(credit_year+1,4,1))
       ON CONFLICT(employee_id,balance_year) DO NOTHING RETURNING employee_id INTO inserted_employee;
     IF FOUND THEN
       INSERT INTO portal.leave_balance_events
         (employee_id,balance_year,event_key,event_type,delta_days,before_days,after_days,effective_date,details)
         VALUES(employee.id,credit_year,'ANNUAL:'||employee.id||':'||credit_year,'ANNUAL_GRANT',12,0,12,business_day,
           jsonb_build_object('full_name',employee.full_name,'employment_status',employee.employment_status,'timezone','Asia/Makassar'));
       credit_count := credit_count+1;
     ELSIF NOT EXISTS(SELECT 1 FROM portal.leave_year_balances WHERE employee_id=employee.id
       AND balance_year=credit_year AND origin='ANNUAL_GRANT' AND granted_days=12) THEN
       RAISE EXCEPTION 'Existing opening balance for annual credit year requires reconciliation';
     END IF;
   END LOOP;
 END IF;
 IF expiry_count>0 OR credit_count>0 THEN
   INSERT INTO portal.audit_events
     (id,action,object_type,object_key,occurred_at,outcome,request_id,reason,change_summary,created_at,updated_at,row_version)
     VALUES(gen_random_uuid()::text,'LEAVE_YEAR_MAINTENANCE','leave_year_balances',business_day::text,
       stamp,'SUCCESS','leave-maintenance-'||business_day,
       'Ketentuan pengguna: tambah 12 setiap Januari; sisa tahun lalu kedaluwarsa 1 April WITA.',
       jsonb_build_object('credited_employees',credit_count,'expired_buckets',expiry_count,'expired_days',expired_total)::text,
       stamp,stamp,1);
 END IF;
 RETURN jsonb_build_object('business_date',business_day,'credited_employees',credit_count,
   'expired_buckets',expiry_count,'expired_days',expired_total);
END;
$maintenance$;
REVOKE ALL ON FUNCTION portal.run_leave_year_maintenance() FROM PUBLIC,anon,authenticated,service_role;

-- Expiry and ineligible status take effect on reads even before the hourly job.
CREATE VIEW portal.leave_effective_balances WITH(security_invoker=true) AS
 SELECT b.*,
   CASE WHEN e.is_active=1 AND e.employment_status IN ('Pegawai Kontrak (PKWT)','Pegawai Probation')
     AND e.joined_on<=portal.leave_business_date()::text
     AND (e.ended_on IS NULL OR e.ended_on>=portal.leave_business_date()::text)
     AND b.effective_from<=portal.leave_business_date()
     AND b.expires_on>portal.leave_business_date() AND b.closed_at IS NULL
     THEN b.remaining_days ELSE 0 END AS available_days
 FROM portal.leave_year_balances b JOIN portal.employees e ON e.id=b.employee_id;
REVOKE ALL ON portal.leave_effective_balances FROM PUBLIC,anon,authenticated,service_role;

COMMENT ON TABLE portal.leave_year_balances IS 'Private yearly leave ledger: approved 2026 opening; next annual credit starts 2027. API/UI integration is separate.';
COMMENT ON FUNCTION portal.run_leave_year_maintenance() IS 'Private scheduled maintenance. WITA Jan 1: credit 12 once per active verified non-THL; Apr 1 and later: expire previous-year remainders.';
COMMIT;
