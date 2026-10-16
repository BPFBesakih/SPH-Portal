-- Jalankan setelah katalog izin berhasil diperiksa.
-- Enam izin administrasi eksplisit; tidak memberi izin HR/keamanan secara otomatis.
BEGIN;

DO $grant_admin_permissions$
DECLARE
  target_role_id uuid;
  permission_codes text[] := ARRAY[
    'admin.users.read', 'admin.users.manage', 'admin.users.reset',
    'admin.roles.read', 'admin.roles.manage', 'admin.audit.read'
  ];
  matched_count integer;
BEGIN
  BEGIN
    SELECT r.id INTO STRICT target_role_id
    FROM public.app_roles r
    JOIN public.app_user_roles ur ON ur.role_id = r.id
    JOIN public.app_users u ON u.id = ur.user_id
    JOIN auth.users a ON a.id = u.id
    WHERE r.code = 'SUPER_ADMIN' AND r.is_system AND r.is_active
      AND ur.scope_kind = 'ALL'
      AND u.username = 'itadmin' AND u.status = 'ACTIVE'
      AND lower(a.email) = 'bpfbesakih@gmail.com'
      AND a.email_confirmed_at IS NOT NULL;
  EXCEPTION WHEN no_data_found THEN
    RAISE EXCEPTION 'Penugasan SUPER_ADMIN / ALL untuk identitas itadmin aktif yang sesuai belum ditemukan.';
  END;

  SELECT count(*) INTO matched_count
  FROM public.app_permissions WHERE code = ANY(permission_codes);
  IF matched_count <> cardinality(permission_codes) THEN
    RAISE EXCEPTION 'Katalog enam izin administrasi belum lengkap. Tidak ada pemberian izin dilakukan.';
  END IF;

  INSERT INTO public.app_role_permissions (role_id, permission_id)
  SELECT target_role_id, p.id FROM public.app_permissions p
  WHERE p.code = ANY(permission_codes)
  ON CONFLICT (role_id, permission_id) DO NOTHING;
END;
$grant_admin_permissions$;

COMMIT;

SELECT r.code AS role, p.code AS izin
FROM public.app_role_permissions rp
JOIN public.app_roles r ON r.id = rp.role_id
JOIN public.app_permissions p ON p.id = rp.permission_id
WHERE r.code = 'SUPER_ADMIN' AND p.module_code = 'admin'
ORDER BY p.code;
