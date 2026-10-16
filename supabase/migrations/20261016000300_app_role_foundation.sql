-- Dasar role aplikasi; penugasan administrator dilakukan terpisah.
BEGIN;

CREATE TABLE IF NOT EXISTS public.app_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE
    CHECK (char_length(code) BETWEEN 1 AND 64)
    CHECK (code = upper(code) AND code = btrim(code)),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description text,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0)
);

CREATE TABLE IF NOT EXISTS public.app_user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  role_id uuid NOT NULL REFERENCES public.app_roles(id) ON DELETE RESTRICT,
  scope_kind text NOT NULL
    CHECK (scope_kind IN ('SELF', 'ASSIGNED_UNITS', 'ASSIGNED_POSTS', 'ALL')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  UNIQUE (user_id, role_id, scope_kind)
);
CREATE INDEX IF NOT EXISTS app_user_roles_by_role
  ON public.app_user_roles (role_id);

ALTER TABLE public.app_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_user_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.app_roles, public.app_user_roles
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT ON TABLE public.app_roles, public.app_user_roles
  TO authenticated, service_role;

-- Policy penugasan tidak membaca app_roles, sehingga tidak terjadi rekursi RLS.
DROP POLICY IF EXISTS app_user_roles_read_own_active ON public.app_user_roles;
CREATE POLICY app_user_roles_read_own_active
  ON public.app_user_roles
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = app_user_roles.user_id AND u.status = 'ACTIVE'
    )
  );

DROP POLICY IF EXISTS app_roles_read_assigned_active ON public.app_roles;
CREATE POLICY app_roles_read_assigned_active
  ON public.app_roles
  FOR SELECT TO authenticated
  USING (
    is_active
    AND EXISTS (
      SELECT 1 FROM public.app_user_roles ur
      WHERE ur.role_id = app_roles.id AND ur.user_id = (SELECT auth.uid())
    )
  );

-- Membuat definisi role tidak otomatis memberi role kepada akun mana pun.
INSERT INTO public.app_roles (code, name, description, is_system)
VALUES (
  'SUPER_ADMIN', 'Super Admin',
  'Role administrator sistem; izin tindakan dan modul dipasang pada tahap berikutnya.',
  true
)
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE public.app_roles IS
  'Definisi role, terpisah dari username dan jabatan. Belum memberikan izin modul.';
COMMENT ON TABLE public.app_user_roles IS
  'Penugasan role eksplisit. Klien tidak memiliki izin menambah/mengubah/menghapus penugasan.';

COMMIT;

SELECT n.nspname AS skema, c.relname AS tabel, c.relrowsecurity AS rls_aktif
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('app_roles', 'app_user_roles')
ORDER BY c.relname;
