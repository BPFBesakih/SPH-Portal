-- Pengelolaan Kunjungan — rekap harian dan migrasi awal riwayat NilaiGuide.
-- Aditif: tabel lama tidak diubah.
--   visit_daily_totals    : rekap per tanggal × guide × pos. Diisi lipatan retensi
--                           (sumber 'portal') dan migrasi awal NilaiGuide (sumber
--                           'nilaiguide'). Tanpa jam, catatan, atau petugas. Dengan ini
--                           laporan mingguan/bulanan tetap bisa disusun setelah rincian
--                           penilaian dihapus (6 minggu).
--   visit_history_import  : migrasi awal; paling banyak satu yang terbuka.
--   visit_history_ids     : ID penilaian NilaiGuide yang ikut migrasi (bisa dibatalkan).
-- Spreadsheet dan aplikasi NilaiGuide tidak disentuh.
BEGIN;
SET LOCAL search_path=portal,pg_catalog;

-- Ringkasan bulanan hanya terisi setelah lipatan retensi pertama. Rilis ini harus
-- mendahuluinya: kalau sudah terisi, angka bulan itu tidak punya rekap harian, jadi
-- migrasi dihentikan alih-alih diam-diam menghilangkan angka dari laporan.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM portal.visit_monthly_totals) THEN
  RAISE EXCEPTION 'visit_monthly_totals sudah terisi: retensi pertama sudah berjalan. Hubungi pengembang untuk langkah konversi ke rekap harian sebelum menjalankan migrasi ini.';
 END IF;
END $$;

CREATE TABLE portal.visit_daily_totals (
 day TEXT NOT NULL CHECK(day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 guide_id TEXT NOT NULL REFERENCES portal.visit_guides(id),
 pos INTEGER NOT NULL CHECK(pos IN(1,3)),
 sumber TEXT NOT NULL CHECK(sumber IN('portal','nilaiguide')),
 antar INTEGER NOT NULL CHECK(antar>0), uniform INTEGER NOT NULL, uniform_patuh INTEGER NOT NULL CHECK(uniform_patuh>=0),
 id_card INTEGER NOT NULL CHECK(id_card>=0), review INTEGER NOT NULL DEFAULT 0 CHECK(review>=0), etika INTEGER NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(day,guide_id,pos,sumber));
ALTER TABLE portal.visit_daily_totals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.visit_daily_totals FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE portal.visit_history_import (
 id TEXT PRIMARY KEY CHECK(id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 status TEXT NOT NULL CHECK(status IN('menyusun','aktif','dibatalkan')),
 -- 1 selama menyusun/aktif, NULL setelah dibatalkan; UNIQUE menjamin satu yang terbuka.
 terbuka INTEGER UNIQUE CHECK(terbuka IS NULL OR terbuka=1),
 file_name TEXT NOT NULL CHECK(length(file_name) BETWEEN 1 AND 200),
 file_sha256 TEXT NOT NULL CHECK(file_sha256 ~ '^[0-9a-f]{64}$'),
 rows_total INTEGER NOT NULL CHECK(rows_total BETWEEN 1 AND 100000),
 parts_total INTEGER NOT NULL CHECK(parts_total BETWEEN 1 AND 200),
 parts_done TEXT NOT NULL DEFAULT '[]',
 ringkasan TEXT NOT NULL DEFAULT '{}',
 first_day TEXT CHECK(first_day IS NULL OR first_day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 last_day TEXT CHECK(last_day IS NULL OR last_day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 created_by UUID REFERENCES public.app_users(id), created_at TEXT NOT NULL,
 finished_at TEXT, cancelled_by UUID REFERENCES public.app_users(id), cancelled_at TEXT,
 CHECK((status IN('menyusun','aktif') AND terbuka=1) OR (status='dibatalkan' AND terbuka IS NULL)));
ALTER TABLE portal.visit_history_import ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.visit_history_import FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE portal.visit_history_ids (
 id TEXT PRIMARY KEY CHECK(id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 import_id TEXT NOT NULL REFERENCES portal.visit_history_import(id));
CREATE INDEX visit_history_ids_import ON portal.visit_history_ids(import_id);
ALTER TABLE portal.visit_history_ids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.visit_history_ids FROM PUBLIC,anon,authenticated,service_role;

COMMENT ON TABLE portal.visit_daily_totals IS 'Daily guide evaluation totals per guide and pos: folded portal evaluations (sumber portal) and the one-time NilaiGuide history import (sumber nilaiguide). No times, notes, or staff identity.';
COMMENT ON TABLE portal.visit_history_import IS 'One-time NilaiGuide history import. At most one open (menyusun/aktif); cancelling removes its daily totals and ids.';

NOTIFY pgrst,'reload schema';
COMMIT;
