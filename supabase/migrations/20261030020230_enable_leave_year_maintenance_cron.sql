-- Database-local scheduling; no HTTP calls, tokens or client permissions.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;
-- This module is administrative; app roles do not manage scheduler jobs.
REVOKE ALL ON SCHEMA cron FROM PUBLIC,anon,authenticated,service_role;
SELECT cron.schedule(
 'leave-year-maintenance',
 '0 * * * *',
 $job$SET statement_timeout='30s'; SELECT portal.run_leave_year_maintenance();$job$
);
COMMENT ON EXTENSION pg_cron IS 'Database scheduler. Leave job uses WITA business dates and private idempotent yearly ledger.';
COMMIT;
