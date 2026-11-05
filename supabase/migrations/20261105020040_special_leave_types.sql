BEGIN;
ALTER TABLE portal.leave_requests DROP CONSTRAINT leave_requests_leave_type_check;
ALTER TABLE portal.leave_requests ADD CONSTRAINT leave_requests_leave_type_check CHECK(leave_type IN
 ('ANNUAL','MARRIAGE','CHILD_MARRIAGE','FAMILY_BEREAVEMENT','HOUSEHOLD_BEREAVEMENT','WIFE_CHILDBIRTH','MATERNITY','MISCARRIAGE'));
ALTER TABLE portal.leave_requests ADD CONSTRAINT leave_requests_special_duration CHECK(
 leave_type='ANNUAL' OR day_count<=CASE leave_type
  WHEN 'MARRIAGE' THEN 3 WHEN 'CHILD_MARRIAGE' THEN 2 WHEN 'FAMILY_BEREAVEMENT' THEN 2
  WHEN 'HOUSEHOLD_BEREAVEMENT' THEN 1 WHEN 'WIFE_CHILDBIRTH' THEN 2
  WHEN 'MATERNITY' THEN 84 WHEN 'MISCARRIAGE' THEN 45 END);
ALTER TABLE portal.leave_requests ADD CONSTRAINT leave_requests_calendar_duration CHECK(
 leave_type NOT IN ('MATERNITY','MISCARRIAGE') OR last_date-first_date+1=day_count);
ALTER TABLE portal.leave_requests ADD CONSTRAINT leave_requests_day_type_key UNIQUE(id,employee_id,leave_type);
ALTER TABLE portal.leave_request_days ALTER COLUMN balance_year DROP NOT NULL;
ALTER TABLE portal.leave_request_days ADD COLUMN leave_type text NOT NULL DEFAULT 'ANNUAL';
ALTER TABLE portal.leave_request_days DROP CONSTRAINT leave_request_days_request_id_employee_id_fkey;
ALTER TABLE portal.leave_request_days ADD CONSTRAINT leave_request_days_request_type_fkey
 FOREIGN KEY(request_id,employee_id,leave_type) REFERENCES portal.leave_requests(id,employee_id,leave_type);
ALTER TABLE portal.leave_request_days ADD CONSTRAINT leave_request_days_balance_kind CHECK(
 (leave_type='ANNUAL' AND balance_year IS NOT NULL) OR (leave_type<>'ANNUAL' AND balance_year IS NULL));
COMMENT ON COLUMN portal.leave_request_days.balance_year IS 'Annual allocation only. Special leave uses NULL and never reserves, consumes, or refunds an annual balance.';
COMMIT;
