-- Etika −10 sampai +10 (keputusan pemilik 17 November 2026). Formulir pos 2.3 mengganti
-- bagian "Teguran perilaku" dengan Etika seperti sebelumnya; nilai pengantaran menjadi
-- 100 − potongan + Etika. Batas kolom etika dilonggarkan dari −5..+5 menjadi −10..+10.
-- Posisi rekonsiliasi spreadsheet disimpan per tab. Aman dijalankan ulang. guide-form dan
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
ALTER TABLE portal.visit_sheet_tabs ADD COLUMN IF NOT EXISTS etika_next_row INTEGER NOT NULL DEFAULT 2 CHECK(etika_next_row>=2);

COMMIT;
