-- Penghubung Supabase Auth dengan akun aplikasi; belum memasang role portal.
BEGIN;

CREATE TABLE IF NOT EXISTS public.app_users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  username text NOT NULL UNIQUE
    CHECK (char_length(username) BETWEEN 1 AND 64)
    CHECK (username = lower(username) AND username = btrim(username)),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'LOCKED')),
  must_change_password boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0)
);

COMMENT ON TABLE public.app_users IS
  'Akun aplikasi yang terhubung ke Supabase Auth. Password dikelola oleh Auth; role diberikan terpisah.';

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.app_users
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT ON TABLE public.app_users TO authenticated, service_role;

DROP POLICY IF EXISTS app_users_read_own_active ON public.app_users;
CREATE POLICY app_users_read_own_active
  ON public.app_users
  FOR SELECT
  TO authenticated
  USING (id = (SELECT auth.uid()) AND status = 'ACTIVE');

-- Tidak ada izin INSERT/UPDATE/DELETE dari aplikasi pada tahap ini.
-- Penautan awal dilakukan pengelola lewat SQL Editor, bukan user_metadata.
COMMIT;

SELECT
  n.nspname AS skema,
  c.relname AS tabel,
  c.relrowsecurity AS rls_aktif
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'app_users';
