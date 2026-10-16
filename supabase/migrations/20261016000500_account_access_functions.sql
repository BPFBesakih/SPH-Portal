-- Pendukung login username dan profil akun; belum membuka endpoint login.
BEGIN;

-- Hanya backend dapat menerjemahkan username ke identitas Supabase Auth.
-- Tidak memeriksa password, membuat sesi, atau mengembalikan hash/token.
CREATE OR REPLACE FUNCTION public.portal_resolve_login(p_username text)
RETURNS TABLE (auth_user_id uuid, login_email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $resolve_login$
  SELECT u.id, a.email::text
  FROM public.app_users u
  JOIN auth.users a ON a.id = u.id
  WHERE pg_catalog.char_length(pg_catalog.btrim(p_username)) BETWEEN 1 AND 64
    AND u.username = pg_catalog.lower(pg_catalog.btrim(p_username))
    AND u.status = 'ACTIVE'
    AND a.email_confirmed_at IS NOT NULL
    AND pg_catalog.btrim(a.email) <> '';
$resolve_login$;

REVOKE ALL ON FUNCTION public.portal_resolve_login(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_resolve_login(text) TO service_role;

-- Tetap memakai hak pemanggil dan RLS; tidak menerima ID akun dari klien.
-- Izin dikelompokkan per penugasan agar cakupan satu role tidak melebar ke role lain.
CREATE OR REPLACE FUNCTION public.portal_current_account()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $current_account$
  SELECT pg_catalog.jsonb_build_object(
    'user', pg_catalog.jsonb_build_object(
      'id', u.id,
      'username', u.username,
      'status', u.status,
      'must_change_password', u.must_change_password,
      'row_version', u.row_version
    ),
    'role_assignments', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'assignment_id', ur.id,
          'role_id', r.id,
          'role', r.code,
          'scope_kind', ur.scope_kind,
          'permissions', COALESCE((
            SELECT pg_catalog.jsonb_agg(p.code ORDER BY p.code)
            FROM public.app_role_permissions rp
            JOIN public.app_permissions p ON p.id = rp.permission_id
            WHERE rp.role_id = r.id
          ), '[]'::jsonb)
        ) ORDER BY r.code, ur.scope_kind
      )
      FROM public.app_user_roles ur
      JOIN public.app_roles r ON r.id = ur.role_id
      WHERE ur.user_id = u.id AND r.is_active
    ), '[]'::jsonb)
  )
  FROM public.app_users u
  WHERE u.id = (SELECT auth.uid()) AND u.status = 'ACTIVE';
$current_account$;

REVOKE ALL ON FUNCTION public.portal_current_account()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_current_account() TO authenticated;

COMMENT ON FUNCTION public.portal_resolve_login(text) IS
  'Pencarian identitas Auth hanya untuk backend. Login tetap harus memverifikasi password lewat Auth, membatasi percobaan, dan memakai pesan kegagalan umum.';
COMMENT ON FUNCTION public.portal_current_account() IS
  'Metadata akun aktif pemanggil dan izin per penugasan. Tidak memverifikasi JWT, mengubah password, atau menggantikan otorisasi operasional per permintaan.';

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Ringkasan hak panggil; tidak menampilkan identitas Auth atau email.
SELECT p.proname AS fungsi,
       p.prosecdef AS security_definer,
       pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_boleh,
       pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_boleh,
       pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS backend_boleh
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('portal_resolve_login', 'portal_current_account')
ORDER BY p.proname;
