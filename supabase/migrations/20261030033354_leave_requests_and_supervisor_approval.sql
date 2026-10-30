BEGIN;
CREATE TABLE portal.leave_requests (
 id text PRIMARY KEY,employee_id text NOT NULL REFERENCES portal.employees(id),
 approver_employee_id text NOT NULL REFERENCES portal.employees(id),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','CANCELLED','CANCELLATION_PENDING')),
 leave_type text NOT NULL DEFAULT 'ANNUAL' CHECK(leave_type='ANNUAL'),
 first_date date NOT NULL,last_date date NOT NULL,day_count integer NOT NULL CHECK(day_count BETWEEN 1 AND 366),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),decision_note text,cancellation_reason text,
 client_key text NOT NULL,payload_hash text NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),
 decided_by uuid REFERENCES public.app_users(id),decided_at text,
 created_at text NOT NULL,updated_at text NOT NULL,row_version integer NOT NULL DEFAULT 1,
 UNIQUE(created_by,client_key),UNIQUE(id,employee_id),CHECK(first_date<=last_date),
 CHECK(employee_id<>approver_employee_id)
);
CREATE INDEX leave_requests_employee ON portal.leave_requests(employee_id,created_at);
CREATE INDEX leave_requests_approver ON portal.leave_requests(approver_employee_id,status);
CREATE INDEX leave_requests_creator ON portal.leave_requests(created_by);
CREATE INDEX leave_requests_decider ON portal.leave_requests(decided_by);
CREATE TABLE portal.leave_request_days (
 request_id text NOT NULL,employee_id text NOT NULL,work_date date NOT NULL,balance_year integer NOT NULL,
 state text NOT NULL CHECK(state IN ('PENDING','APPROVED','RELEASED')),PRIMARY KEY(request_id,work_date),
 FOREIGN KEY(request_id,employee_id) REFERENCES portal.leave_requests(id,employee_id),
 FOREIGN KEY(employee_id,balance_year) REFERENCES portal.leave_year_balances(employee_id,balance_year)
);
CREATE UNIQUE INDEX leave_request_days_no_duplicate ON portal.leave_request_days(employee_id,work_date) WHERE state IN ('PENDING','APPROVED');
CREATE INDEX leave_request_days_balance ON portal.leave_request_days(employee_id,balance_year,state);
CREATE INDEX leave_request_days_calendar ON portal.leave_request_days(work_date,state);
ALTER TABLE portal.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.leave_request_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.leave_requests,portal.leave_request_days FROM PUBLIC,anon,authenticated,service_role;
DO $constraints$
DECLARE constraint_name text;
BEGIN
 FOR constraint_name IN SELECT conname FROM pg_constraint
 WHERE conrelid='portal.leave_balance_events'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%event_type%' LOOP
  EXECUTE format('ALTER TABLE portal.leave_balance_events DROP CONSTRAINT %I',constraint_name);
 END LOOP;
END;
$constraints$;
ALTER TABLE portal.leave_balance_events ADD CONSTRAINT leave_balance_event_type
 CHECK(event_type IN ('OPENING','ANNUAL_GRANT','EXPIRY','CONSUMPTION','REVERSAL'));
ALTER TABLE portal.leave_balance_events ADD CONSTRAINT leave_balance_event_transition CHECK(
 (event_type='OPENING' AND before_days=0 AND delta_days>=0 AND source_batch_id IS NOT NULL)
 OR (event_type='ANNUAL_GRANT' AND before_days=0 AND delta_days=12 AND source_batch_id IS NULL)
 OR (event_type='EXPIRY' AND delta_days<=0 AND after_days=0)
 OR (event_type='CONSUMPTION' AND delta_days<0) OR (event_type='REVERSAL' AND delta_days>0));
INSERT INTO public.app_permissions(code,module_code,resource,action,description)
 VALUES('hr.leaves.read','hr','hr.leaves','read','Lihat saldo, laporan dan pengajuan cuti sesuai cakupan'),
       ('hr.leaves.export','hr','hr.leaves','export','Ekspor laporan cuti sesuai cakupan') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM public.app_roles r CROSS JOIN public.app_permissions p
 WHERE r.code IN ('SUPER_ADMIN','SDM','BISNIS_PIMPINAN') AND p.resource='hr.leaves' ON CONFLICT DO NOTHING;
COMMENT ON TABLE portal.leave_requests IS 'Only the active direct supervisor approves. Report permissions do not bypass this rule. Employee explicitly selects work dates.';
COMMENT ON TABLE portal.leave_request_days IS 'Pending rows reserve yearly funds; approval consumes once; future cancellation needs direct-supervisor approval before reversal.';
COMMIT;
