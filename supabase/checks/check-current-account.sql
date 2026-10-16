-- Pemeriksaan profil melalui RLS di SQL Editor, bukan login/JWT nyata.
-- Hasil akun awal: itadmin | true | 6.
BEGIN READ ONLY;

SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT id::text FROM public.app_users WHERE username = 'itadmin'),
  true
);

SET LOCAL ROLE authenticated;

SELECT
  akun->'user'->>'username' AS username,
  akun->'user'->>'must_change_password' AS wajib_ganti_password,
  jsonb_array_length(akun->'role_assignments'->0->'permissions') AS jumlah_izin
FROM (SELECT public.portal_current_account() AS akun) profil;

ROLLBACK;
