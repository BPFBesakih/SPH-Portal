-- Hasil review PR #36: identitas kejadian lintas koreksi dan pemeriksaan dua arah
-- antara riwayat NilaiGuide dan antrean portal. Tidak menambah grant atau akses API.
-- Berkas ini dibuat oleh CLI pada waktu sebelum timestamp migrasi objective_scoring.
-- Pada instalasi baru tabel flags dibuat oleh migrasi tersebut dengan event_id;
-- pada instalasi yang sudah menjalankannya, tambahkan/backfill kolom di sini.
BEGIN;
SET LOCAL search_path=portal,pg_catalog;

ALTER TABLE portal.visit_history_ids
 ADD COLUMN guide_id TEXT REFERENCES portal.visit_guides(id),
 ADD COLUMN pos INTEGER CHECK(pos IN(1,3)),
 ADD COLUMN evaluated_at TEXT,
 ADD CONSTRAINT visit_history_ids_match_complete CHECK(
  (guide_id IS NULL AND pos IS NULL AND evaluated_at IS NULL)
  OR (guide_id IS NOT NULL AND pos IS NOT NULL AND evaluated_at IS NOT NULL));
CREATE INDEX visit_history_ids_match ON portal.visit_history_ids(guide_id,pos,evaluated_at);
-- Impor lama tetap utuh. Karena jam per ID tidak bisa diturunkan dari rekap harian,
-- pengelola membatalkan/mengimpor ulang bila masih ada antrean HP pada hari yang sama.

DO $$
BEGIN
 IF to_regclass('portal.visit_flags') IS NOT NULL THEN
  ALTER TABLE portal.visit_flags ADD COLUMN IF NOT EXISTS event_id TEXT
   CHECK(event_id IS NULL OR event_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  WITH RECURSIVE lineage(id,root_id) AS (
   SELECT e.id,e.id FROM portal.visit_evaluations e
    WHERE e.koreksi_dari IS NULL OR NOT EXISTS(SELECT 1 FROM portal.visit_evaluations p WHERE p.id=e.koreksi_dari)
   UNION SELECT e.id,l.root_id FROM portal.visit_evaluations e JOIN lineage l ON e.koreksi_dari=l.id
  ) UPDATE portal.visit_flags f SET event_id=coalesce((SELECT root_id FROM lineage l WHERE l.id=f.evaluation_id),f.evaluation_id)
    WHERE f.event_id IS NULL;
  CREATE INDEX IF NOT EXISTS visit_flags_event ON portal.visit_flags(event_id);
 END IF;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
