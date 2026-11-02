-- Pengelolaan Kunjungan: hanya izin dan tautan publik; penilaian tetap milik Google Spreadsheet.
BEGIN;
CREATE TABLE IF NOT EXISTS portal.guide_form_links (
 id text PRIMARY KEY,
 pos smallint NOT NULL CHECK(pos IN (1,3)),
 token_hash text UNIQUE NOT NULL CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 created_by uuid NOT NULL REFERENCES public.app_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS guide_form_one_active_per_pos ON portal.guide_form_links(pos) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS portal.guide_form_rate_limits (
 id text PRIMARY KEY,
 window_start timestamptz NOT NULL,
 hits integer NOT NULL CHECK(hits > 0)
);
CREATE INDEX IF NOT EXISTS guide_form_rate_window ON portal.guide_form_rate_limits(window_start);
ALTER TABLE portal.guide_form_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.guide_form_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.guide_form_links,portal.guide_form_rate_limits FROM PUBLIC,anon,authenticated,service_role;
WITH resources(resource,actions) AS (VALUES
 ('visits.dashboard',ARRAY['read']),('visits.guides',ARRAY['read','manage']),
 ('visits.records',ARRAY['read']),('visits.forms',ARRAY['read','manage']),
 ('visits.archive',ARRAY['read','export']),('visits.settings',ARRAY['manage'])
)
INSERT INTO public.app_permissions(code,module_code,resource,action)
SELECT resource||'.'||a.action,'visits',resource,a.action FROM resources CROSS JOIN LATERAL unnest(actions) AS a(action)
ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_roles(code,name) VALUES
 ('KUNJUNGAN_PENGELOLA','Pengelola Kunjungan'),
 ('KUNJUNGAN_PIMPINAN','Pimpinan Kunjungan')
ON CONFLICT(code) DO NOTHING;
WITH templates(role_code,codes) AS (VALUES
 ('KUNJUNGAN_PENGELOLA',ARRAY['visits.dashboard.read','visits.guides.read','visits.guides.manage','visits.records.read','visits.forms.read','visits.forms.manage','visits.archive.read','visits.archive.export']),
 ('KUNJUNGAN_PIMPINAN',ARRAY['visits.dashboard.read','visits.guides.read','visits.records.read','visits.archive.read','visits.archive.export'])
)
INSERT INTO public.app_role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM templates t JOIN public.app_roles r ON r.code=t.role_code
JOIN public.app_permissions p ON p.code=ANY(t.codes)
ON CONFLICT DO NOTHING;
-- IT Admin and Superadmin always retain the ability to administer the new workspace.
INSERT INTO public.app_role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM public.app_roles r CROSS JOIN public.app_permissions p
WHERE r.code IN ('IT_ADMIN','SUPER_ADMIN') AND p.module_code='visits'
ON CONFLICT DO NOTHING;
COMMIT;
