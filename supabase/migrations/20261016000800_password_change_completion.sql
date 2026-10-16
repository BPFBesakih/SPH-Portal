-- Penyelesaian ganti password oleh backend SETELAH Auth menerima perubahan.
-- Tidak menerima password/ID target dan tidak menulis tabel Auth.
BEGIN;

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

CREATE TABLE IF NOT EXISTS portal_auth_private.password_change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  web_session_id uuid NOT NULL,
  changed_at timestamptz NOT NULL,
  previous_account_version bigint NOT NULL CHECK (previous_account_version > 0),
  new_account_version bigint NOT NULL CHECK (new_account_version = previous_account_version + 1),
  UNIQUE (web_session_id, previous_account_version)
);
ALTER TABLE portal_auth_private.password_change_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON SCHEMA portal_auth_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE portal_auth_private.password_change_events
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.portal_complete_password_change(
  p_token_hash text, p_lease_hash text, p_expected_account_version bigint
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $complete_password_change$
DECLARE
  changed_at timestamptz := pg_catalog.clock_timestamp();
  target_id uuid;
  source portal_auth_private.web_sessions%ROWTYPE;
  changed_count integer;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_lease_hash IS NULL OR p_lease_hash !~ '^[a-f0-9]{64}$'
     OR p_expected_account_version IS NULL OR p_expected_account_version < 1 THEN
    RETURN false;
  END IF;

  -- Urutan kunci akun lalu sesi sama dengan trigger pencabutan sesi akun.
  SELECT w.user_id INTO target_id FROM portal_auth_private.web_sessions w
  WHERE w.token_hash = p_token_hash;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.app_users u WHERE u.id = target_id
    AND u.status = 'ACTIVE' AND u.row_version = p_expected_account_version FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT w.* INTO source
  FROM portal_auth_private.web_sessions w
  WHERE w.token_hash = p_token_hash AND w.user_id = target_id
  FOR UPDATE OF w;
  IF NOT FOUND THEN RETURN false; END IF;
  changed_at := pg_catalog.clock_timestamp();
  IF source.revoked_at IS NOT NULL OR source.expires_at <= changed_at
     OR source.lease_hash IS NULL OR source.lease_hash <> p_lease_hash
     OR source.lease_until IS NULL OR source.lease_until <= changed_at
     OR source.account_version <> p_expected_account_version
     OR NOT EXISTS (SELECT 1 FROM auth.sessions a
       WHERE a.id = source.auth_session_id AND a.user_id = source.user_id) THEN
    RETURN false;
  END IF;

  UPDATE public.app_users u
  SET must_change_password = false, password_changed_at = changed_at,
      updated_at = changed_at, row_version = u.row_version + 1
  WHERE u.id = target_id AND u.status = 'ACTIVE'
    AND u.row_version = p_expected_account_version;
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 1 THEN RETURN false; END IF;

  -- Trigger dari migrasi 007 mencabut seluruh sesi portal akun ini, termasuk
  -- sesi pemanggil. Audit dan perubahan profil berada dalam transaksi sama.
  INSERT INTO portal_auth_private.password_change_events
    (user_id, web_session_id, changed_at, previous_account_version, new_account_version)
  VALUES (target_id, source.id, changed_at,
    p_expected_account_version, p_expected_account_version + 1);
  RETURN true;
END;
$complete_password_change$;

REVOKE ALL ON FUNCTION public.portal_complete_password_change(text, text, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_complete_password_change(text, text, bigint) TO service_role;
COMMENT ON FUNCTION public.portal_complete_password_change(text, text, bigint) IS
  'Khusus backend setelah PUT Auth user berhasil dan identitas cocok. SQL tidak memverifikasi password; perlu lease sesi aktif dan versi akun cocok. Membersihkan flag, mencabut sesi portal, dan mencatat event tanpa kredensial secara atomik.';
COMMENT ON TABLE portal_auth_private.password_change_events IS
  'Event ganti password sendiri tanpa password, token, cookie, hash kredensial, email, atau data request. Belum menyediakan API baca audit.';

NOTIFY pgrst, 'reload schema';
COMMIT;

SELECT 'password_change_events' AS objek, 'table' AS jenis, c.relrowsecurity AS rls_aktif,
       pg_catalog.has_table_privilege('anon', c.oid, 'SELECT') AS anon_boleh,
       pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_boleh,
       pg_catalog.has_table_privilege('service_role', c.oid, 'SELECT') AS backend_boleh
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'portal_auth_private' AND c.relname = 'password_change_events'
UNION ALL
SELECT p.proname, 'function', NULL::boolean,
       pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'),
       pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'),
       pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'portal_complete_password_change'
ORDER BY jenis, objek;
