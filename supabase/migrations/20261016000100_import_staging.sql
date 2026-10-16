-- Penampungan calon pegawai dari workbook untuk ditinjau sebelum aktivasi.
BEGIN;

CREATE SCHEMA IF NOT EXISTS import_staging;
REVOKE ALL ON SCHEMA import_staging
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS import_staging.employee_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL CHECK (length(btrim(full_name)) > 0),
  employee_no text,
  joined_on date,
  employment_status text,
  positions jsonb NOT NULL CHECK (jsonb_typeof(positions) = 'array'),
  source_name text NOT NULL,
  source_cells jsonb NOT NULL CHECK (jsonb_typeof(source_cells) = 'array'),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_name, source_cells, full_name)
);

ALTER TABLE import_staging.employee_candidates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE import_staging.employee_candidates
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

SELECT count(*) AS jumlah_calon
FROM import_staging.employee_candidates;
