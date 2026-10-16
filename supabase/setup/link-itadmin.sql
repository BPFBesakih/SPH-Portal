-- Jalankan setelah migrasi 20261016000200_app_user_links.sql berhasil.
-- Menghubungkan akun Auth terkonfirmasi; belum memberikan role administrator.
BEGIN;

DO $link_account$
DECLARE
  target_auth_id uuid;
BEGIN
  BEGIN
    SELECT id INTO STRICT target_auth_id
    FROM auth.users
    WHERE lower(email) = 'bpfbesakih@gmail.com'
      AND email_confirmed_at IS NOT NULL;
  EXCEPTION
    WHEN no_data_found THEN
      RAISE EXCEPTION 'Akun Auth terkonfirmasi untuk pengelola belum ditemukan.';
    WHEN too_many_rows THEN
      RAISE EXCEPTION 'Lebih dari satu akun Auth cocok; periksa akun pengelola terlebih dahulu.';
  END;

  IF EXISTS (
    SELECT 1 FROM public.app_users
    WHERE id = target_auth_id AND username <> 'itadmin'
  ) THEN
    RAISE EXCEPTION 'Akun Auth ini sudah terhubung ke username lain. Tidak ada perubahan dilakukan.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.app_users
    WHERE username = 'itadmin' AND id <> target_auth_id
  ) THEN
    RAISE EXCEPTION 'Username itadmin sudah terhubung ke akun lain. Tidak ada perubahan dilakukan.';
  END IF;

  INSERT INTO public.app_users (id, username)
  VALUES (target_auth_id, 'itadmin')
  ON CONFLICT (id) DO NOTHING;
END;
$link_account$;

COMMIT;

SELECT username, status, must_change_password
FROM public.app_users
WHERE username = 'itadmin';
