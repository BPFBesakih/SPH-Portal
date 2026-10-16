-- Memeriksa bahwa role authenticated tanpa identitas tidak mendapat izin.
-- Hasil yang diharapkan: izin_tanpa_identitas = 0.
BEGIN READ ONLY;

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{}', true);

SET LOCAL ROLE authenticated;

SELECT count(*)::integer AS izin_tanpa_identitas
FROM public.app_permissions;

ROLLBACK;
