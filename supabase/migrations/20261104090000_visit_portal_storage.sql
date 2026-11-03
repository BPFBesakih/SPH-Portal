-- Pengelolaan Kunjungan — Penilaian Guide disimpan di portal (tahap 1, revisi).
-- Menggantikan rancangan jembatan NilaiGuide: aplikasi NilaiGuide, Apps Script, dan
-- spreadsheet lamanya TIDAK disentuh. Penilaian dari tautan pos masuk ke tabel di
-- bawah, lalu disalin ke spreadsheet baru (satu file per tahun, satu tab per bulan)
-- di folder SPH-Portal-Kunjungan pada Google Drive portal.
--
-- Retensi: baris penilaian dihapus dari basis data setelah 6 minggu, HANYA bila
-- barisnya sudah dicocokkan ulang dengan isi spreadsheet. Sebelum dihapus, angkanya
-- dilipat ke visit_monthly_totals supaya peringkat bulan lama tetap bisa dibuka.
-- Migrasi ini aditif dan bergantung pada 20261103100000_visit_management.sql.
BEGIN;
SET LOCAL search_path=portal,pg_catalog;

-- Data guide. ID mengikuti tab Guides lama (G-001 …) supaya data lama dan baru
-- bisa digabung. Guide tidak pernah dihapus, hanya dinonaktifkan.
CREATE TABLE portal.visit_guides (
 id TEXT PRIMARY KEY CHECK(id ~ '^G-[0-9]{1,7}$'),
 seq INTEGER NOT NULL UNIQUE CHECK(seq BETWEEN 1 AND 9999999),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120 AND name=btrim(name)),
 kategori TEXT NOT NULL CHECK(kategori IN('Asing','Domestik')),
 regu TEXT NOT NULL CHECK(regu ~ '^(A1|A2|D1|D2)(, (A1|A2|D1|D2))?$'),
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 created_by UUID REFERENCES public.app_users(id), updated_by UUID REFERENCES public.app_users(id));
ALTER TABLE portal.visit_guides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.visit_guides FROM PUBLIC,anon,authenticated,service_role;

-- Penilaian 6 minggu terakhir. Kolom sheet_* mencatat posisi baris di salinan
-- spreadsheet; sheet_verified_at diisi setelah isinya dicocokkan ulang.
CREATE TABLE portal.visit_evaluations (
 id TEXT PRIMARY KEY CHECK(id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 link_id TEXT REFERENCES portal.guide_form_links(id),
 pos INTEGER NOT NULL CHECK(pos IN(1,3)),
 guide_id TEXT NOT NULL REFERENCES portal.visit_guides(id),
 guide_name TEXT NOT NULL CHECK(length(guide_name) BETWEEN 1 AND 120),
 uniform INTEGER NOT NULL CHECK(uniform IN(-1,1,2)),
 id_card INTEGER NOT NULL CHECK(id_card IN(0,1)),
 review INTEGER NOT NULL DEFAULT 0 CHECK(review BETWEEN 0 AND 20),
 etika INTEGER NOT NULL CHECK(etika BETWEEN -5 AND 5),
 catatan TEXT NOT NULL DEFAULT '' CHECK(length(catatan)<=500),
 evaluated_at TEXT NOT NULL CHECK(evaluated_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'),
 wita_date TEXT NOT NULL CHECK(wita_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 received_at TEXT NOT NULL,
 koreksi_dari TEXT CHECK(koreksi_dari IS NULL OR koreksi_dari<>id),
 status TEXT NOT NULL DEFAULT 'aktif' CHECK(status IN('aktif','diganti')),
 replaced_by TEXT,
 sheet_tab TEXT CHECK(sheet_tab IS NULL OR sheet_tab ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 sheet_row INTEGER CHECK(sheet_row IS NULL OR sheet_row>=2),
 sheet_dirty INTEGER NOT NULL DEFAULT 0 CHECK(sheet_dirty IN(0,1)),
 sheet_synced_at TEXT, sheet_verified_at TEXT,
 CHECK((sheet_tab IS NULL)=(sheet_row IS NULL)),
 CHECK(status='aktif' OR replaced_by IS NOT NULL));
ALTER TABLE portal.visit_evaluations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.visit_evaluations FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX visit_evaluations_date ON portal.visit_evaluations(wita_date);
CREATE INDEX visit_evaluations_guide_pos_time ON portal.visit_evaluations(guide_id,pos,evaluated_at);
CREATE INDEX visit_evaluations_unsynced ON portal.visit_evaluations(received_at,id) WHERE sheet_row IS NULL;
CREATE INDEX visit_evaluations_dirty ON portal.visit_evaluations(sheet_tab,sheet_row) WHERE sheet_dirty=1;
CREATE UNIQUE INDEX visit_evaluations_sheet_position ON portal.visit_evaluations(sheet_tab,sheet_row) WHERE sheet_row IS NOT NULL;

-- Angka penilaian yang sudah dihapus dari basis data (dilipat per bulan).
-- guide_id='*' = semua guide; pos=0 = semua pos. hari = jumlah tanggal berpenilaian.
CREATE TABLE portal.visit_monthly_totals (
 month TEXT NOT NULL CHECK(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 guide_id TEXT NOT NULL CHECK(guide_id='*' OR guide_id ~ '^G-[0-9]{1,7}$'),
 pos INTEGER NOT NULL CHECK(pos IN(0,1,3)),
 antar INTEGER NOT NULL CHECK(antar>=0), uniform INTEGER NOT NULL, uniform_patuh INTEGER NOT NULL CHECK(uniform_patuh>=0),
 id_card INTEGER NOT NULL CHECK(id_card>=0), review INTEGER NOT NULL CHECK(review>=0), etika INTEGER NOT NULL,
 hari INTEGER NOT NULL CHECK(hari>=0),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(month,guide_id,pos));
ALTER TABLE portal.visit_monthly_totals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.visit_monthly_totals FROM PUBLIC,anon,authenticated,service_role;

-- Spreadsheet salinan: satu file per tahun, satu tab per bulan.
CREATE TABLE portal.visit_sheet_files (
 year INTEGER PRIMARY KEY CHECK(year BETWEEN 2026 AND 2100),
 spreadsheet_id TEXT NOT NULL UNIQUE CHECK(spreadsheet_id ~ '^[A-Za-z0-9_-]{20,200}$'),
 created_at TEXT NOT NULL);
ALTER TABLE portal.visit_sheet_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.visit_sheet_files FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE portal.visit_sheet_tabs (
 title TEXT PRIMARY KEY CHECK(title ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 year INTEGER NOT NULL REFERENCES portal.visit_sheet_files(year),
 sheet_id INTEGER NOT NULL CHECK(sheet_id>=0),
 next_row INTEGER NOT NULL CHECK(next_row>=2),
 row_count INTEGER NOT NULL CHECK(row_count>=1),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
ALTER TABLE portal.visit_sheet_tabs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.visit_sheet_tabs FROM PUBLIC,anon,authenticated,service_role;

-- Satu baris status penyalinan. lease_* mencegah dua penyalinan berjalan bersamaan.
-- folded_through = tanggal WITA terakhir yang barisnya sudah dihapus (dilipat).
CREATE TABLE portal.visit_sheet_state (
 id INTEGER PRIMARY KEY CHECK(id=1),
 folder_id TEXT CHECK(folder_id IS NULL OR folder_id ~ '^[A-Za-z0-9_-]{8,200}$'),
 lease_owner TEXT, lease_until TEXT,
 last_attempt_at TEXT, last_success_at TEXT,
 last_error TEXT CHECK(last_error IS NULL OR length(last_error)<=300), last_error_at TEXT,
 last_retention_at TEXT,
 folded_through TEXT CHECK(folded_through IS NULL OR folded_through ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 updated_at TEXT NOT NULL,
 CHECK((lease_owner IS NULL)=(lease_until IS NULL)));
ALTER TABLE portal.visit_sheet_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.visit_sheet_state FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO portal.visit_sheet_state(id,updated_at) VALUES(1,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

COMMENT ON TABLE portal.visit_evaluations IS 'Guide evaluations from pos links, kept about 6 weeks. Older rows live only in the yearly Google spreadsheet copy and visit_monthly_totals.';

NOTIFY pgrst,'reload schema';
COMMIT;
