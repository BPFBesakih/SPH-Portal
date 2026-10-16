-- Fondasi sesi web untuk backend Cloudflare; belum menghubungkan frontend.
-- Backend wajib memverifikasi Auth, mengenkripsi pasangan token, dan menjaga
-- cookie/CSRF. Fungsi SQL ini hanya dapat dipanggil backend pemegang secret.
BEGIN;

CREATE SCHEMA IF NOT EXISTS portal_auth_private;
REVOKE ALL ON SCHEMA portal_auth_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS portal_auth_private.web_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  auth_session_id uuid NOT NULL UNIQUE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  csrf_hash text NOT NULL CHECK (csrf_hash ~ '^[a-f0-9]{64}$'),
  account_version bigint NOT NULL CHECK (account_version > 0),
  -- Envelope AES-GCM v1: nonce 12 byte dan ciphertext+tag, base64url tanpa padding.
  -- Format diperiksa di sini; enkripsi/dekripsi hanya dilakukan backend.
  token_box text CHECK (pg_catalog.char_length(token_box) <= 16020
    AND token_box ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$'),
  access_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  lease_hash text CHECK (lease_hash ~ '^[a-f0-9]{64}$'),
  lease_until timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours'),
  CHECK ((revoked_at IS NULL AND token_box IS NOT NULL)
      OR (revoked_at IS NOT NULL AND token_box IS NULL)),
  CHECK ((lease_hash IS NULL) = (lease_until IS NULL))
);
CREATE INDEX IF NOT EXISTS web_sessions_active_user_idx
  ON portal_auth_private.web_sessions (user_id) WHERE revoked_at IS NULL;
ALTER TABLE portal_auth_private.web_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE portal_auth_private.web_sessions
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.portal_create_web_session(
  p_user_id uuid, p_auth_session_id uuid, p_token_hash text, p_csrf_hash text,
  p_token_box text, p_access_expires_at timestamptz,
  p_lifetime_seconds integer DEFAULT 28800
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $create_web_session$
DECLARE
  created timestamptz := pg_catalog.clock_timestamp();
  account_version bigint;
  result jsonb;
BEGIN
  IF p_user_id IS NULL OR p_auth_session_id IS NULL
     OR p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_csrf_hash IS NULL OR p_csrf_hash !~ '^[a-f0-9]{64}$'
     OR p_token_box IS NULL
     OR pg_catalog.char_length(p_token_box) > 16020
     OR p_token_box !~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$'
     OR p_access_expires_at IS NULL OR p_access_expires_at <= created
     OR p_access_expires_at > created + interval '24 hours'
     OR p_lifetime_seconds IS NULL OR p_lifetime_seconds NOT BETWEEN 900 AND 86400 THEN
    RETURN NULL;
  END IF;

  -- Mengikat sesi ke akun aktif dan baris Auth milik identitas yang sama.
  -- Kunci singkat mencegah pembuatan sesi melintasi perubahan status akun.
  SELECT u.row_version INTO account_version
  FROM public.app_users u
  JOIN auth.sessions a ON a.id = p_auth_session_id AND a.user_id = u.id
  JOIN auth.users identity ON identity.id = u.id
  WHERE u.id = p_user_id AND u.status = 'ACTIVE'
    AND identity.email_confirmed_at IS NOT NULL
  FOR SHARE OF u;
  IF NOT FOUND THEN RETURN NULL; END IF;

  INSERT INTO portal_auth_private.web_sessions AS w
    (user_id, auth_session_id, token_hash, csrf_hash, account_version,
     token_box, access_expires_at, created_at, expires_at)
  VALUES
    (p_user_id, p_auth_session_id, p_token_hash, p_csrf_hash, account_version,
     p_token_box, p_access_expires_at, created,
     created + p_lifetime_seconds * interval '1 second')
  ON CONFLICT DO NOTHING
  RETURNING pg_catalog.jsonb_build_object('id', w.id, 'expires_at', w.expires_at)
    INTO result;
  RETURN result;
END;
$create_web_session$;

CREATE OR REPLACE FUNCTION public.portal_acquire_web_session(
  p_token_hash text, p_lease_hash text
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $acquire_web_session$
DECLARE
  acquired_at timestamptz := pg_catalog.clock_timestamp();
  result jsonb;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_lease_hash IS NULL OR p_lease_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN NULL;
  END IF;

  -- Lease singkat menserialkan pemakaian refresh token pada beberapa request.
  -- Ciphertext hanya dikembalikan kepada backend, tidak kepada browser.
  UPDATE portal_auth_private.web_sessions w
  SET lease_hash = p_lease_hash, lease_until = acquired_at + interval '60 seconds'
  WHERE w.token_hash = p_token_hash AND w.revoked_at IS NULL
    AND w.expires_at > acquired_at
    AND (w.lease_until IS NULL OR w.lease_until <= acquired_at)
    AND EXISTS (SELECT 1 FROM public.app_users u
      WHERE u.id = w.user_id AND u.status = 'ACTIVE' AND u.row_version = w.account_version)
    AND EXISTS (SELECT 1 FROM auth.sessions a
      WHERE a.id = w.auth_session_id AND a.user_id = w.user_id)
  RETURNING pg_catalog.jsonb_build_object(
    'status', 'acquired', 'id', w.id, 'user_id', w.user_id,
    'auth_session_id', w.auth_session_id, 'csrf_hash', w.csrf_hash,
    'token_box', w.token_box, 'access_expires_at', w.access_expires_at,
    'expires_at', w.expires_at, 'version', w.version
  ) INTO result;
  IF result IS NOT NULL THEN RETURN result; END IF;

  IF EXISTS (SELECT 1 FROM portal_auth_private.web_sessions w
    JOIN public.app_users u ON u.id = w.user_id
    JOIN auth.sessions a ON a.id = w.auth_session_id AND a.user_id = w.user_id
    WHERE w.token_hash = p_token_hash AND w.revoked_at IS NULL
      AND w.expires_at > acquired_at AND w.lease_until > acquired_at
      AND u.status = 'ACTIVE' AND u.row_version = w.account_version) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'busy');
  END IF;
  RETURN NULL;
END;
$acquire_web_session$;

CREATE OR REPLACE FUNCTION public.portal_save_web_session(
  p_token_hash text, p_lease_hash text, p_expected_version bigint,
  p_token_box text, p_access_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $save_web_session$
DECLARE
  saved_at timestamptz := pg_catalog.clock_timestamp();
  changed_count integer;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_lease_hash IS NULL OR p_lease_hash !~ '^[a-f0-9]{64}$'
     OR p_expected_version IS NULL OR p_expected_version < 1
     OR p_token_box IS NULL
     OR pg_catalog.char_length(p_token_box) > 16020
     OR p_token_box !~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$'
     OR p_access_expires_at IS NULL OR p_access_expires_at <= saved_at
     OR p_access_expires_at > saved_at + interval '24 hours' THEN
    RETURN false;
  END IF;

  UPDATE portal_auth_private.web_sessions w
  SET token_box = p_token_box, access_expires_at = p_access_expires_at,
      version = w.version + 1, lease_hash = NULL, lease_until = NULL
  WHERE w.token_hash = p_token_hash AND w.lease_hash = p_lease_hash
    AND w.lease_until > saved_at AND w.version = p_expected_version
    AND w.revoked_at IS NULL AND w.expires_at > saved_at
    AND EXISTS (SELECT 1 FROM public.app_users u
      WHERE u.id = w.user_id AND u.status = 'ACTIVE' AND u.row_version = w.account_version)
    AND EXISTS (SELECT 1 FROM auth.sessions a
      WHERE a.id = w.auth_session_id AND a.user_id = w.user_id);
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  RETURN changed_count = 1;
END;
$save_web_session$;

CREATE OR REPLACE FUNCTION public.portal_release_web_session(
  p_token_hash text, p_lease_hash text
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $release_web_session$
DECLARE changed_count integer;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_lease_hash IS NULL OR p_lease_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN false;
  END IF;
  UPDATE portal_auth_private.web_sessions w
  SET lease_hash = NULL, lease_until = NULL
  WHERE w.token_hash = p_token_hash AND w.lease_hash = p_lease_hash
    AND w.revoked_at IS NULL;
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  RETURN changed_count = 1;
END;
$release_web_session$;

CREATE OR REPLACE FUNCTION public.portal_revoke_web_session(p_token_hash text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $revoke_web_session$
DECLARE changed_count integer;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
  -- Logout tetap dapat mencabut sesi yang kedaluwarsa atau sedang di-lease.
  UPDATE portal_auth_private.web_sessions w
  SET revoked_at = pg_catalog.clock_timestamp(), token_box = NULL,
      lease_hash = NULL, lease_until = NULL, version = w.version + 1
  WHERE w.token_hash = p_token_hash AND w.revoked_at IS NULL;
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  RETURN changed_count = 1;
END;
$revoke_web_session$;

-- Perubahan keamanan akun mencabut seluruh sesi portal secara atomik.
-- Tidak mengubah flag password, role, permission, maupun tabel Auth.
CREATE OR REPLACE FUNCTION portal_auth_private.revoke_web_sessions_for_account_change()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $account_change$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     OR OLD.must_change_password IS DISTINCT FROM NEW.must_change_password
     OR OLD.row_version IS DISTINCT FROM NEW.row_version THEN
    UPDATE portal_auth_private.web_sessions w
    SET revoked_at = pg_catalog.clock_timestamp(), token_box = NULL,
        lease_hash = NULL, lease_until = NULL, version = w.version + 1
    WHERE w.user_id = NEW.id AND w.revoked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$account_change$;
REVOKE ALL ON FUNCTION portal_auth_private.revoke_web_sessions_for_account_change()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS app_users_revoke_web_sessions ON public.app_users;
CREATE TRIGGER app_users_revoke_web_sessions
  AFTER UPDATE OF status, must_change_password, row_version ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION portal_auth_private.revoke_web_sessions_for_account_change();

REVOKE ALL ON FUNCTION public.portal_create_web_session(uuid, uuid, text, text, text, timestamptz, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_acquire_web_session(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_save_web_session(text, text, bigint, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_release_web_session(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_revoke_web_session(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_create_web_session(uuid, uuid, text, text, text, timestamptz, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_acquire_web_session(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_save_web_session(text, text, bigint, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_release_web_session(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_revoke_web_session(text) TO service_role;

COMMENT ON TABLE portal_auth_private.web_sessions IS
  'Sesi backend: hash cookie/CSRF dan envelope token terenkripsi. Bukan verifikasi JWT atau audit. Tanpa akses tabel bagi role API.';
COMMENT ON FUNCTION public.portal_acquire_web_session(text, text) IS
  'Lease backend 60 detik; null bila tidak layak, status busy bila masih dipegang request lain. Backend tetap wajib memverifikasi Auth dan membaca izin terkini per permintaan.';
COMMENT ON FUNCTION public.portal_save_web_session(text, text, bigint, text, timestamptz) IS
  'Simpan token terenkripsi setelah refresh terverifikasi; perlu lease dan versi yang cocok, tidak memperpanjang masa sesi portal.';

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Ringkasan dashboard: satu tabel RLS dan lima fungsi khusus backend.
SELECT 'web_sessions' AS objek, 'table' AS jenis, c.relrowsecurity AS rls_aktif,
       pg_catalog.has_table_privilege('anon', c.oid, 'SELECT') AS anon_boleh,
       pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_boleh,
       pg_catalog.has_table_privilege('service_role', c.oid, 'SELECT') AS backend_boleh
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'portal_auth_private' AND c.relname = 'web_sessions'
UNION ALL
SELECT p.proname, 'function', NULL::boolean,
       pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'),
       pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'),
       pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN (
  'portal_create_web_session', 'portal_acquire_web_session', 'portal_save_web_session',
  'portal_release_web_session', 'portal_revoke_web_session'
)
ORDER BY jenis, objek;
