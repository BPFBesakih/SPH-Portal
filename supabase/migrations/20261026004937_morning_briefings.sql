BEGIN;
SET LOCAL search_path=portal,pg_catalog;
CREATE TABLE portal.briefing_links (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64), share_token TEXT NOT NULL CHECK(length(share_token)=64), label TEXT NOT NULL,
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)), revoked_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID REFERENCES public.app_users(id));
ALTER TABLE portal.briefing_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.briefing_links FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE portal.morning_briefings (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), org_unit_id TEXT NOT NULL REFERENCES org_units(id),
 employee_name TEXT NOT NULL, position_name TEXT NOT NULL, department TEXT NOT NULL, section TEXT NOT NULL, held_on TEXT NOT NULL,
 absent_notes TEXT NOT NULL, briefing_notes TEXT NOT NULL, submitted_at TEXT NOT NULL, source TEXT NOT NULL CHECK(source='NATIVE_LINK'),
 link_id TEXT NOT NULL REFERENCES briefing_links(id), response_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
 deleted_at TEXT, deleted_by UUID REFERENCES public.app_users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID REFERENCES public.app_users(id), UNIQUE(link_id,response_id));
ALTER TABLE portal.morning_briefings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.morning_briefings FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE portal.briefing_files (
 id TEXT PRIMARY KEY, briefing_id TEXT NOT NULL UNIQUE REFERENCES morning_briefings(id), file_id TEXT NOT NULL UNIQUE REFERENCES files(id),
 captured_at TEXT NOT NULL, capture_source TEXT NOT NULL CHECK(capture_source='CAMERA'),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID REFERENCES public.app_users(id));
ALTER TABLE portal.briefing_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.briefing_files FROM PUBLIC,anon,authenticated,service_role;
CREATE UNIQUE INDEX briefing_one_active_link ON portal.briefing_links(is_active) WHERE is_active=1;
CREATE INDEX briefing_unit_date ON portal.morning_briefings(org_unit_id,held_on);
COMMENT ON COLUMN portal.briefing_links.share_token IS 'Private submission link, disclosed only through authenticated portal. Never log or bundle.';
INSERT INTO public.app_permissions(code,module_code,resource,action)
VALUES ('hr.briefings.read','hr','hr.briefings','read'),('hr.briefings.manage','hr','hr.briefings','manage')
ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM public.app_roles r CROSS JOIN public.app_permissions p
WHERE r.code IN ('SUPER_ADMIN','SDM') AND p.resource='hr.briefings'
ON CONFLICT DO NOTHING;
COMMIT;
