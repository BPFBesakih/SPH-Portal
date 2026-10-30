BEGIN;
CREATE TABLE portal.leave_form_links (
 id text PRIMARY KEY, employee_id text NOT NULL REFERENCES portal.employees(id),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES public.app_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL, revoked_at timestamptz,
 UNIQUE(id,employee_id), CHECK(expires_at>created_at)
);
CREATE UNIQUE INDEX leave_form_links_active_employee ON portal.leave_form_links(employee_id) WHERE revoked_at IS NULL;
CREATE INDEX leave_form_links_creator ON portal.leave_form_links(created_by);
CREATE TABLE portal.leave_form_rate_limits (
 id text PRIMARY KEY, window_start timestamptz NOT NULL, hits integer NOT NULL CHECK(hits>0)
);
CREATE INDEX leave_form_rate_limits_window ON portal.leave_form_rate_limits(window_start);
ALTER TABLE portal.leave_form_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.leave_form_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.leave_form_links,portal.leave_form_rate_limits FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE portal.leave_requests ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE portal.leave_requests ADD COLUMN submission_source text NOT NULL DEFAULT 'PORTAL';
ALTER TABLE portal.leave_requests ADD COLUMN source_form_link_id text;
ALTER TABLE portal.leave_requests ADD CONSTRAINT leave_request_source CHECK (
 (submission_source='PORTAL' AND created_by IS NOT NULL AND source_form_link_id IS NULL)
 OR (submission_source='FORM' AND created_by IS NULL AND source_form_link_id IS NOT NULL)
);
ALTER TABLE portal.leave_requests ADD CONSTRAINT leave_request_form_owner
 FOREIGN KEY(source_form_link_id,employee_id) REFERENCES portal.leave_form_links(id,employee_id);
CREATE UNIQUE INDEX leave_request_form_idempotency ON portal.leave_requests(source_form_link_id,client_key) WHERE source_form_link_id IS NOT NULL;
COMMIT;
