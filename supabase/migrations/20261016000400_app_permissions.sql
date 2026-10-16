-- Katalog izin tindakan; pemberian izin ke role dilakukan terpisah.
BEGIN;

CREATE TABLE IF NOT EXISTS public.app_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  module_code text NOT NULL,
  resource text NOT NULL,
  action text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  CHECK (resource ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  CHECK (action ~ '^[a-z][a-z0-9_]*$'),
  CHECK (code = resource || '.' || action),
  CHECK (module_code = split_part(resource, '.', 1))
);

CREATE TABLE IF NOT EXISTS public.app_role_permissions (
  role_id uuid NOT NULL REFERENCES public.app_roles(id) ON DELETE RESTRICT,
  permission_id uuid NOT NULL REFERENCES public.app_permissions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX IF NOT EXISTS app_role_permissions_by_permission
  ON public.app_role_permissions (permission_id);

ALTER TABLE public.app_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_role_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.app_permissions, public.app_role_permissions
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT ON TABLE public.app_permissions, public.app_role_permissions
  TO authenticated, service_role;

-- app_roles sudah membatasi pembacaan ke role aktif yang ditugaskan ke pemanggil.
-- Policy relasi ini tidak membaca app_permissions agar tidak terjadi rekursi.
DROP POLICY IF EXISTS app_role_permissions_read_assigned ON public.app_role_permissions;
CREATE POLICY app_role_permissions_read_assigned
  ON public.app_role_permissions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_roles r
      WHERE r.id = app_role_permissions.role_id AND r.is_active
    )
  );

DROP POLICY IF EXISTS app_permissions_read_assigned ON public.app_permissions;
CREATE POLICY app_permissions_read_assigned
  ON public.app_permissions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_role_permissions rp
      WHERE rp.permission_id = app_permissions.id
    )
  );

-- Kode izin mengikuti resourceActions pada lib/auth.mjs, tanpa membuka modulnya.
WITH resources (resource, actions) AS (
  VALUES
    ('hr.employees', ARRAY['read', 'create', 'update', 'export']),
    ('hr.organization', ARRAY['read', 'manage']),
    ('hr.employee_files', ARRAY['read', 'manage']),
    ('hr.documents', ARRAY['read', 'manage', 'publish', 'download']),
    ('hr.training', ARRAY['read', 'manage', 'participants', 'download']),
    ('hr.coaching', ARRAY['read', 'create', 'update', 'manage']),
    ('security.config', ARRAY['read', 'manage']),
    ('security.roster', ARRAY['read', 'generate', 'edit', 'publish', 'acknowledge', 'export']),
    ('security.logbook', ARRAY['read', 'create', 'update', 'download']),
    ('security.incidents', ARRAY['read', 'create', 'update', 'reopen', 'download']),
    ('admin.users', ARRAY['read', 'manage', 'reset']),
    ('admin.roles', ARRAY['read', 'manage']),
    ('admin.audit', ARRAY['read'])
)
INSERT INTO public.app_permissions (code, module_code, resource, action)
SELECT resource || '.' || a.action, split_part(resource, '.', 1), resource, a.action
FROM resources CROSS JOIN LATERAL unnest(actions) AS a(action)
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE public.app_permissions IS
  'Katalog izin tindakan aplikasi. Keberadaan kode izin tidak memberi akses operasional.';
COMMENT ON TABLE public.app_role_permissions IS
  'Pemberian izin eksplisit ke role. Otorisasi operasional tetap wajib memeriksa akun, izin, dan scope.';

COMMIT;

SELECT n.nspname AS skema, c.relname AS tabel, c.relrowsecurity AS rls_aktif
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('app_permissions', 'app_role_permissions')
ORDER BY c.relname;
