-- Pengelolaan Kunjungan — Penilaian Guide (tahap 1).
-- Penilaian dan data guide tetap di Google Spreadsheet NilaiGuide (lewat jembatan
-- berkunci). Portal hanya menyimpan tautan pos dan catatan kiriman tanpa isi
-- penilaian. IT_ADMIN sengaja TIDAK diberi izin visits.* (keputusan 19 Oktober).
BEGIN;
SET LOCAL search_path=portal,pg_catalog;

CREATE TABLE portal.guide_form_links (
 id TEXT PRIMARY KEY, pos INTEGER NOT NULL CHECK(pos IN(1,3)), label TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
 share_token TEXT CHECK(share_token IS NULL OR length(share_token)=64),
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
 revoked_at TEXT, revoked_by UUID REFERENCES public.app_users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID REFERENCES public.app_users(id),
 CHECK(is_active=1 OR revoked_at IS NOT NULL));
ALTER TABLE portal.guide_form_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.guide_form_links FROM PUBLIC,anon,authenticated,service_role;
CREATE UNIQUE INDEX guide_form_one_active_link ON portal.guide_form_links(pos) WHERE is_active=1;
COMMENT ON COLUMN portal.guide_form_links.share_token IS 'Private pos link, disclosed only through the authenticated portal (visits.forms.manage). Cleared on revoke. Never log or bundle.';

-- Batas frekuensi per IP dan per tautan (10 menit). Ditulis dengan satu
-- INSERT ... ON CONFLICT atomik, sehingga tidak memerlukan kunci global.
CREATE TABLE portal.guide_form_rate_limits (
 id TEXT PRIMARY KEY, window_start TEXT NOT NULL, hits INTEGER NOT NULL CHECK(hits>0));
ALTER TABLE portal.guide_form_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.guide_form_rate_limits FROM PUBLIC,anon,authenticated,service_role;

-- Catatan kiriman (ATR-KM-06): tanpa nama guide, nilai, atau catatan. Disimpan 90 hari.
CREATE TABLE portal.guide_form_submissions (
 id TEXT PRIMARY KEY, link_id TEXT NOT NULL REFERENCES portal.guide_form_links(id), pos INTEGER NOT NULL CHECK(pos IN(1,2,3)),
 evaluation_id TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN('ACCEPTED','DUPLICATE','REJECTED')),
 reason TEXT CHECK(reason IS NULL OR reason IN('JEDA','KOREKSI','GUIDE','WAKTU','POS','VALIDASI')),
 received_at TEXT NOT NULL, ip_hmac TEXT CHECK(ip_hmac IS NULL OR length(ip_hmac)=64),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL);
ALTER TABLE portal.guide_form_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.guide_form_submissions FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX guide_form_submissions_pos_time ON portal.guide_form_submissions(pos,received_at);
CREATE INDEX guide_form_submissions_time ON portal.guide_form_submissions(received_at);

WITH resources(resource,actions) AS (VALUES
 ('visits.dashboard',ARRAY['read']),
 ('visits.guides',ARRAY['read','manage']),
 ('visits.records',ARRAY['read']),
 ('visits.forms',ARRAY['read','manage']),
 ('visits.reports',ARRAY['read','export']),
 ('visits.settings',ARRAY['manage']))
INSERT INTO public.app_permissions(code,module_code,resource,action)
SELECT resource||'.'||a.action,'visits',resource,a.action
FROM resources CROSS JOIN LATERAL unnest(actions) AS a(action)
ON CONFLICT(code) DO NOTHING;

WITH templates(code,name,codes) AS (VALUES
 ('KUNJUNGAN_PENGELOLA','Pengelola Kunjungan',ARRAY['visits.dashboard.read','visits.guides.read','visits.guides.manage','visits.records.read','visits.forms.read','visits.forms.manage','visits.reports.read','visits.reports.export','visits.settings.manage']),
 ('KUNJUNGAN_PIMPINAN','Pimpinan Kunjungan',ARRAY['visits.dashboard.read','visits.guides.read','visits.records.read','visits.reports.read','visits.reports.export'])),
added AS (
 INSERT INTO public.app_roles(code,name) SELECT code,name FROM templates
 ON CONFLICT(code) DO NOTHING RETURNING id,code),
assigned AS (
 SELECT id,code FROM added
 UNION ALL
 SELECT r.id,r.code FROM public.app_roles r JOIN templates t ON t.code=r.code
 WHERE NOT EXISTS(SELECT 1 FROM added a WHERE a.code=r.code))
INSERT INTO public.app_role_permissions(role_id,permission_id)
SELECT a.id,p.id FROM assigned a JOIN templates t ON t.code=a.code JOIN public.app_permissions p ON p.code=ANY(t.codes)
ON CONFLICT DO NOTHING;

-- Super Admin memegang semua izin (keputusan 19 Oktober).
INSERT INTO public.app_role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM public.app_roles r CROSS JOIN public.app_permissions p
WHERE r.code='SUPER_ADMIN' AND p.module_code='visits'
ON CONFLICT DO NOTHING;

NOTIFY pgrst,'reload schema';
COMMIT;
