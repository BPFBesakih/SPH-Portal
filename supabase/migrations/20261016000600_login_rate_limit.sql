-- Batas percobaan login terpusat; hanya backend yang boleh mengambil slot.
BEGIN;

CREATE SCHEMA IF NOT EXISTS portal_auth_private;
REVOKE ALL ON SCHEMA portal_auth_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS portal_auth_private.login_rate_windows (
  bucket_kind text NOT NULL CHECK (bucket_kind IN ('ip', 'username')),
  bucket_hash text NOT NULL CHECK (bucket_hash ~ '^[a-f0-9]{64}$'),
  attempt_count integer NOT NULL CHECK (attempt_count BETWEEN 1 AND 300),
  window_started_at timestamptz NOT NULL,
  PRIMARY KEY (bucket_kind, bucket_hash)
);
ALTER TABLE portal_auth_private.login_rate_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE portal_auth_private.login_rate_windows
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.portal_take_login_slot(
  p_username_hash text, p_ip_hash text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $take_login_slot$
DECLARE
  attempted_at timestamptz := pg_catalog.clock_timestamp();
  bucket record;
  changed_count integer;
BEGIN
  IF p_username_hash IS NULL OR p_ip_hash IS NULL
     OR p_username_hash !~ '^[a-f0-9]{64}$'
     OR p_ip_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN false;
  END IF;

  -- Urutan kunci selalu IP lalu username. IP dibatasi lebih dahulu agar
  -- permintaan dari IP yang sudah dibatasi tidak membuat bucket username baru.
  FOR bucket IN
    SELECT v.kind, v.hash, v.attempt_limit
    FROM (VALUES
      (1, 'ip'::text, p_ip_hash, 300),
      (2, 'username'::text, p_username_hash, 5)
    ) AS v(position, kind, hash, attempt_limit)
    ORDER BY v.position
  LOOP
    INSERT INTO portal_auth_private.login_rate_windows AS current_window
      (bucket_kind, bucket_hash, attempt_count, window_started_at)
    VALUES (bucket.kind, bucket.hash, 1, attempted_at)
    ON CONFLICT (bucket_kind, bucket_hash) DO UPDATE
    SET attempt_count = CASE
          WHEN current_window.window_started_at <= attempted_at - interval '15 minutes'
            THEN 1
          ELSE current_window.attempt_count + 1
        END,
        window_started_at = CASE
          WHEN current_window.window_started_at <= attempted_at - interval '15 minutes'
            THEN attempted_at
          ELSE current_window.window_started_at
        END
    WHERE current_window.window_started_at <= attempted_at - interval '15 minutes'
       OR current_window.attempt_count < bucket.attempt_limit;

    GET DIAGNOSTICS changed_count = ROW_COUNT;
    IF changed_count = 0 THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$take_login_slot$;

REVOKE ALL ON FUNCTION public.portal_take_login_slot(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_take_login_slot(text, text) TO service_role;

COMMENT ON TABLE portal_auth_private.login_rate_windows IS
  'Counter jendela 15 menit memakai hash, tanpa username/IP mentah, password, atau token. Bukan catatan audit login.';
COMMENT ON FUNCTION public.portal_take_login_slot(text, text) IS
  'Slot login backend: 5 percobaan per username dan 300 per IP per 15 menit, termasuk percobaan berhasil. Hash harus dihitung backend, bukan dipercaya dari browser.';

NOTIFY pgrst, 'reload schema';
COMMIT;

SELECT p.proname AS fungsi,
       p.prosecdef AS security_definer,
       pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_boleh,
       pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_boleh,
       pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS backend_boleh
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'portal_take_login_slot';
