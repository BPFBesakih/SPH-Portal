BEGIN;
CREATE TABLE IF NOT EXISTS portal.quick_report_links (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL, position_ids TEXT NOT NULL,
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)), revoked_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 created_by UUID NOT NULL REFERENCES public.app_users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS quick_report_one_active ON portal.quick_report_links(is_active) WHERE is_active=1;
CREATE TABLE IF NOT EXISTS portal.quick_report_rate_limits (
 id TEXT PRIMARY KEY, window_start TEXT NOT NULL, hits INTEGER NOT NULL CHECK(hits>0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL
);
ALTER TABLE portal.logbook_entries ADD COLUMN IF NOT EXISTS report_source TEXT NOT NULL DEFAULT 'PORTAL' CHECK(report_source IN('PORTAL','PUBLIC_LINK'));
ALTER TABLE portal.logbook_entries ADD COLUMN IF NOT EXISTS report_link_id TEXT REFERENCES portal.quick_report_links(id);
ALTER TABLE portal.quick_report_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.quick_report_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.quick_report_links,portal.quick_report_rate_limits FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
