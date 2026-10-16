-- Keep historical activity records and distinguish documentation photos from materials.
BEGIN;
ALTER TABLE portal.training_events ADD COLUMN IF NOT EXISTS deleted_at TEXT;
ALTER TABLE portal.training_events ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.app_users(id);
ALTER TABLE portal.training_materials ADD COLUMN IF NOT EXISTS usage_kind TEXT NOT NULL DEFAULT 'MATERIAL';
DO $constraint$ BEGIN
  ALTER TABLE portal.training_materials ADD CONSTRAINT training_materials_usage_kind_check
    CHECK (usage_kind IN ('MATERIAL','DOCUMENTATION') AND (usage_kind='MATERIAL' OR file_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $constraint$;
-- Existing RLS and table privileges remain unchanged.
COMMIT;
