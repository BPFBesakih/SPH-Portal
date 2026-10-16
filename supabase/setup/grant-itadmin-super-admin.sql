-- Jalankan setelah migrasi dasar role berhasil diperiksa.
-- Penugasan eksplisit; belum menyediakan izin modul atau endpoint administrasi.
BEGIN;

DO $grant_initial_admin$
DECLARE
  target_user_id uuid;
  target_role_id uuid;
BEGIN
  BEGIN
    SELECT u.id INTO STRICT target_user_id
    FROM public.app_users u
    JOIN auth.users a ON a.id = u.id
    WHERE u.username = 'itadmin' AND u.status = 'ACTIVE'
      AND lower(a.email) = 'bpfbesakih@gmail.com'
      AND a.email_confirmed_at IS NOT NULL;
  EXCEPTION WHEN no_data_found THEN
    RAISE EXCEPTION 'Akun itadmin aktif dan identitas Auth terkonfirmasi yang sesuai belum ditemukan.';
  END;

  BEGIN
    SELECT id INTO STRICT target_role_id
    FROM public.app_roles
    WHERE code = 'SUPER_ADMIN' AND is_system AND is_active;
  EXCEPTION WHEN no_data_found THEN
    RAISE EXCEPTION 'Definisi role SUPER_ADMIN sistem yang aktif belum ditemukan.';
  END;

  INSERT INTO public.app_user_roles (user_id, role_id, scope_kind)
  VALUES (target_user_id, target_role_id, 'ALL')
  ON CONFLICT (user_id, role_id, scope_kind) DO NOTHING;
END;
$grant_initial_admin$;

COMMIT;

SELECT u.username, r.code AS role, ur.scope_kind, u.status,
  r.is_active AS role_aktif
FROM public.app_user_roles ur
JOIN public.app_users u ON u.id = ur.user_id
JOIN public.app_roles r ON r.id = ur.role_id
WHERE u.username = 'itadmin' AND r.code = 'SUPER_ADMIN'
  AND ur.scope_kind = 'ALL';
