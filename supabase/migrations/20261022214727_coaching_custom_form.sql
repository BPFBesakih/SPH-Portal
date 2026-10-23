-- Staged additive production DDL. Create a migration with the Supabase CLI
-- before activation; do not apply this to production without deployment approval.
BEGIN;
CREATE TABLE portal.coaching_files (
 id TEXT PRIMARY KEY, coaching_session_id TEXT NOT NULL REFERENCES portal.coaching_sessions(id), file_id TEXT NOT NULL UNIQUE REFERENCES portal.files(id), caption TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID REFERENCES public.app_users(id));
CREATE INDEX coaching_files_session_idx ON portal.coaching_files(coaching_session_id);
CREATE TABLE portal.coaching_form_submissions (
 id TEXT PRIMARY KEY, form_id TEXT NOT NULL, response_id TEXT NOT NULL, payload_hash TEXT NOT NULL, coaching_session_id TEXT NOT NULL UNIQUE REFERENCES portal.coaching_sessions(id),
 submitted_at TEXT NOT NULL, department TEXT NOT NULL, section TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, UNIQUE(form_id,response_id));
ALTER TABLE portal.coaching_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.coaching_form_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.coaching_files,portal.coaching_form_submissions FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
