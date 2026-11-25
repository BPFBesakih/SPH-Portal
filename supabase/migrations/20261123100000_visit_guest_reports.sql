-- Pengelolaan Kunjungan — Review Negatif dan Komplain (keputusan pemilik 23 November 2026).
-- Petugas pos mencatat keluhan wisatawan lewat dua menu baru di aplikasi HP Penilaian Guide.
-- Catatan baru berdampak setelah disetujui Pengelola Kunjungan di Verifikasi:
--   review negatif : nilai akhir bulan kejadian dipotong sebesar yang ditetapkan Pengelola
--                    (bawaan pot_review), tanpa batas per bulan; nilai akhir paling rendah 0.
--   komplain       : nilai bulan kejadian dihapus (0), guide gugur reward dan keluar dari peringkat.
-- Aditif dan aman dijalankan ulang. Jalankan SESUDAH 20261113100000_visit_objective_scoring.sql.
-- guide-form dan portal-api versi sebelumnya tetap berjalan: keduanya tidak membaca tabel baru,
-- dan daftar jenis temuan hanya dibaca per jenis yang mereka kenal.
--
--   visit_finding_types : jenis 'review' dan 'komplain' (daftar awal = contoh, bisa diubah di
--                         Aturan Nilai seperti jenis pelanggaran berat/apresiasi).
--   visit_form_settings : pot_review, potongan bawaan saat menyetujui review negatif.
--   visit_guest_reports : catatan review negatif/komplain dari HP pos. Tidak ikut retensi
--                         6 minggu dan tidak disalin ke spreadsheet (data wisatawan hanya
--                         untuk Pengelola Kunjungan).
-- Tidak ada izin baru: membaca memakai izin Dashboard/Laporan, memutuskan memakai
-- visits.settings.manage (Pengelola Kunjungan). IT_ADMIN tetap tanpa izin visits.*.
BEGIN;
SET LOCAL search_path=portal,pg_catalog;

-- CHECK jenis lama tanpa nama (nama buatan PostgreSQL): cari lewat kolomnya, seperti
-- migrasi batas Etika. Hanya CHECK yang menyangkut kolom jenis saja.
DO $$
DECLARE c record;
BEGIN
 FOR c IN SELECT con.conname FROM pg_constraint con
  JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attname='jenis'
  WHERE con.conrelid='portal.visit_finding_types'::regclass AND con.contype='c' AND con.conkey=ARRAY[att.attnum]
 LOOP
  EXECUTE format('ALTER TABLE portal.visit_finding_types DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE portal.visit_finding_types ADD CONSTRAINT visit_finding_types_jenis
 CHECK(jenis IN('teguran','berat','apresiasi','review','komplain'));

INSERT INTO portal.visit_finding_types(id,jenis,label,urut,perlu_catatan,created_at,updated_at,row_version)
SELECT t.id,t.jenis,t.label,t.urut,1,s.stamp,s.stamp,1
FROM (VALUES
 ('kurang-ramah','review','Kurang ramah atau tidak sopan',10),
 ('penjelasan-kurang','review','Penjelasan kurang atau tidak jelas',20),
 ('terburu-buru','review','Terburu-buru',30),
 ('terlambat','review','Terlambat atau membuat tamu menunggu',40),
 ('review-lain','review','Keluhan pelayanan lain (tulis di keterangan)',90),
 ('komplain-pungutan','komplain','Meminta uang di luar tarif resmi',10),
 ('komplain-memaksa','komplain','Memaksa belanja atau donasi',20),
 ('komplain-kasar','komplain','Berkata kasar atau mengancam',30),
 ('komplain-menelantarkan','komplain','Menelantarkan tamu',40),
 ('komplain-lain','komplain','Komplain lain (tulis di keterangan)',90)) AS t(id,jenis,label,urut)
CROSS JOIN (SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS stamp) AS s
ON CONFLICT(id) DO NOTHING;

ALTER TABLE portal.visit_form_settings ADD COLUMN IF NOT EXISTS pot_review INTEGER NOT NULL DEFAULT 5 CHECK(pot_review BETWEEN 1 AND 100);

-- id = ID antrean HP (UUID), sehingga kiriman ulang diakui sebagai duplikat.
CREATE TABLE IF NOT EXISTS portal.visit_guest_reports (
 id TEXT PRIMARY KEY CHECK(id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 link_id TEXT REFERENCES portal.guide_form_links(id),
 pos INTEGER NOT NULL CHECK(pos IN(1,3)),
 jenis TEXT NOT NULL CHECK(jenis IN('review','komplain')),
 jenis_awal TEXT NOT NULL CHECK(jenis_awal IN('review','komplain')),
 kode TEXT NOT NULL REFERENCES portal.visit_finding_types(id),
 guide_id TEXT NOT NULL REFERENCES portal.visit_guides(id),
 guide_name TEXT NOT NULL CHECK(length(guide_name) BETWEEN 1 AND 120),
 wita_date TEXT NOT NULL CHECK(wita_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 recorded_at TEXT NOT NULL,
 received_at TEXT NOT NULL,
 keterangan TEXT NOT NULL CHECK(length(keterangan) BETWEEN 3 AND 500),
 kronologi TEXT NOT NULL DEFAULT '' CHECK(length(kronologi)<=1000),
 wisatawan_nama TEXT NOT NULL DEFAULT '' CHECK(length(wisatawan_nama)<=120),
 wisatawan_asal TEXT NOT NULL DEFAULT '' CHECK(length(wisatawan_asal)<=120),
 wisatawan_kontak TEXT NOT NULL DEFAULT '' CHECK(length(wisatawan_kontak)<=120),
 petugas_id TEXT NOT NULL CHECK(petugas_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 petugas_nama TEXT NOT NULL CHECK(length(petugas_nama) BETWEEN 1 AND 120),
 status TEXT NOT NULL DEFAULT 'menunggu' CHECK(status IN('menunggu','disetujui','ditolak')),
 potongan INTEGER CHECK(potongan IS NULL OR potongan BETWEEN 1 AND 100),
 klarifikasi TEXT NOT NULL DEFAULT '' CHECK(length(klarifikasi)<=1000),
 keputusan_catatan TEXT NOT NULL DEFAULT '' CHECK(length(keputusan_catatan)<=500),
 decided_by UUID REFERENCES public.app_users(id), decided_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 CHECK((status IN('disetujui','ditolak'))=(decided_at IS NOT NULL)),
 CHECK((status='disetujui' AND jenis='review')=(potongan IS NOT NULL)),
 CHECK(status<>'disetujui' OR jenis<>'komplain' OR length(klarifikasi)>=3));
ALTER TABLE portal.visit_guest_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.visit_guest_reports FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX IF NOT EXISTS visit_guest_reports_status_day ON portal.visit_guest_reports(status,wita_date);
CREATE INDEX IF NOT EXISTS visit_guest_reports_guide_day ON portal.visit_guest_reports(guide_id,wita_date);

COMMENT ON TABLE portal.visit_guest_reports IS 'Negative reviews and complaints from guests, recorded at the pos and decided by the Kunjungan manager. Kept beyond the 6-week evaluation retention; never copied to the spreadsheet.';

NOTIFY pgrst,'reload schema';
COMMIT;
