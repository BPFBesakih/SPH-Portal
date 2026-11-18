-- Etika −10 sampai +10 (keputusan pemilik 17 November 2026). Formulir pos 2.3 mengganti
-- bagian "Teguran perilaku" dengan Etika seperti sebelumnya; nilai pengantaran menjadi
-- 100 − potongan + Etika. Migrasi ini hanya melonggarkan batas kolom etika dari −5..+5
-- menjadi −10..+10. Data yang sudah ada tetap memenuhi batas baru.
-- Tidak menambah kolom, grant, atau akses API, dan aman dijalankan ulang. guide-form dan
-- portal-api versi sebelumnya tetap berjalan: keduanya hanya menulis −5..+5 (cara lama)
-- atau −jumlah teguran (formulir 2.2).
BEGIN;
SET LOCAL search_path=portal,pg_catalog;

-- Batas lama berupa CHECK tanpa nama (nama buatan PostgreSQL). Cari lewat kolomnya:
-- hanya CHECK yang menyangkut kolom etika saja, bukan CHECK gabungan kolom lain.
DO $$
DECLARE c record;
BEGIN
 FOR c IN SELECT con.conname FROM pg_constraint con
  JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attname='etika'
  WHERE con.conrelid='portal.visit_evaluations'::regclass AND con.contype='c' AND con.conkey=ARRAY[att.attnum]
 LOOP
  EXECUTE format('ALTER TABLE portal.visit_evaluations DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE portal.visit_evaluations ADD CONSTRAINT visit_evaluations_etika_range CHECK(etika BETWEEN -10 AND 10);

COMMIT;
