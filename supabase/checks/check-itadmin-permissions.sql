-- Pemeriksaan RLS di SQL Editor, bukan pengujian login/JWT aplikasi.
-- Hasil yang diharapkan: enam kode izin administrasi.
BEGIN READ ONLY;

SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT id::text FROM public.app_users WHERE username = 'itadmin'),
  true
);

SET LOCAL ROLE authenticated;

SELECT code AS izin
FROM public.app_permissions
ORDER BY code;

ROLLBACK;
