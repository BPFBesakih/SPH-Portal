-- Pengelolaan Kunjungan — penilaian guide "100 − potongan" (disetujui pemilik 11 November 2026).
-- Petugas pos hanya mencatat fakta yang terlihat; besar potongan ditetapkan aturan.
-- Aditif. Jalankan SESUDAH 20261104090000_visit_portal_storage.sql dan
-- 20261104120000_visit_daily_totals_history.sql.
--
--   visit_evaluations   : kolom cara baru (versi 2): seragam, teguran, pelanggaran berat,
--                         apresiasi, petugas. Kolom lama (uniform, id_card, etika) tetap
--                         diisi padanannya, supaya portal-api versi sebelumnya tetap bisa
--                         menghitung bila rilis dibatalkan.
--   visit_daily_totals  : cacah temuan per hari. Baris yang sudah ada (cara lama) diisi
--                         dari kolomnya: tanpa ID = antar − id_card, tidak berseragam =
--                         antar − uniform_patuh. Teguran cara lama tidak bisa diturunkan
--                         dari jumlah harian, jadi dibiarkan 0 (lihat docs).
--   visit_score_rules   : bobot potongan, ambang layak reward, minimal pengantaran, per
--                         bulan berlaku. Portal hanya mengizinkan perubahan untuk bulan depan.
--   visit_finding_types : jenis teguran, pelanggaran berat, dan apresiasi.
--   visit_assessors     : petugas penilai, dipilih sekali per shift di HP pos.
--   visit_flags         : pelanggaran berat & apresiasi yang diverifikasi Pengelola
--                         Kunjungan. Tidak ikut retensi 6 minggu (dipakai syarat reward).
--   visit_form_settings : petunjuk ID-Card dan seragam di formulir pos.
-- Tidak ada izin baru: verifikasi dan pengaturan memakai visits.settings.manage
-- (Pengelola Kunjungan). IT_ADMIN tetap tanpa izin visits.*.
BEGIN;
SET LOCAL search_path=portal,pg_catalog;

ALTER TABLE portal.visit_evaluations
 ADD COLUMN versi INTEGER NOT NULL DEFAULT 1 CHECK(versi IN(1,2)),
 ADD COLUMN seragam TEXT CHECK(seragam IS NULL OR seragam IN('lengkap','kurang','tidak')),
 ADD COLUMN teguran TEXT NOT NULL DEFAULT '' CHECK(teguran ~ '^([a-z0-9-]{2,40}(,[a-z0-9-]{2,40})?)?$'),
 ADD COLUMN teguran_n INTEGER NOT NULL DEFAULT 0 CHECK(teguran_n BETWEEN 0 AND 2),
 ADD COLUMN berat TEXT CHECK(berat IS NULL OR berat ~ '^[a-z0-9-]{2,40}$'),
 ADD COLUMN apresiasi TEXT CHECK(apresiasi IS NULL OR apresiasi ~ '^[a-z0-9-]{2,40}$'),
 ADD COLUMN petugas_id TEXT CHECK(petugas_id IS NULL OR petugas_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 ADD COLUMN petugas_nama TEXT CHECK(petugas_nama IS NULL OR length(petugas_nama) BETWEEN 1 AND 120),
 ADD CONSTRAINT visit_evaluations_teguran_count CHECK(teguran_n=CASE WHEN teguran='' THEN 0 ELSE length(teguran)-length(replace(teguran,',',''))+1 END),
 ADD CONSTRAINT visit_evaluations_versi CHECK((versi=1 AND seragam IS NULL AND teguran='' AND berat IS NULL AND apresiasi IS NULL AND petugas_id IS NULL AND petugas_nama IS NULL)
  OR (versi=2 AND seragam IS NOT NULL AND (petugas_id IS NULL)=(petugas_nama IS NULL)));

ALTER TABLE portal.visit_daily_totals
 ADD COLUMN n_id INTEGER NOT NULL DEFAULT 0 CHECK(n_id>=0),
 ADD COLUMN n_kurang INTEGER NOT NULL DEFAULT 0 CHECK(n_kurang>=0),
 ADD COLUMN n_tidak INTEGER NOT NULL DEFAULT 0 CHECK(n_tidak>=0),
 ADD COLUMN n_teguran INTEGER NOT NULL DEFAULT 0 CHECK(n_teguran>=0);
UPDATE portal.visit_daily_totals SET n_id=antar-id_card,n_tidak=antar-uniform_patuh;
ALTER TABLE portal.visit_daily_totals ADD CONSTRAINT visit_daily_totals_findings CHECK(n_id<=antar AND n_kurang+n_tidak<=antar AND n_teguran<=2*antar);

-- Satu baris per bulan mulai berlaku; aturan bulan M = baris dengan berlaku_mulai
-- terbesar yang ≤ M. Potongan terbesar per pengantaran (tanpa ID + tidak berseragam +
-- dua teguran) dijaga ≤ 100, sehingga nilai pengantaran tidak pernah di bawah 0.
CREATE TABLE portal.visit_score_rules (
 berlaku_mulai TEXT PRIMARY KEY CHECK(berlaku_mulai ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 pot_id INTEGER NOT NULL CHECK(pot_id BETWEEN 0 AND 50),
 pot_kurang INTEGER NOT NULL CHECK(pot_kurang BETWEEN 0 AND 50),
 pot_tidak INTEGER NOT NULL CHECK(pot_tidak BETWEEN 0 AND 50),
 pot_teguran INTEGER NOT NULL CHECK(pot_teguran BETWEEN 0 AND 50),
 ambang INTEGER NOT NULL CHECK(ambang BETWEEN 50 AND 100),
 minimal INTEGER NOT NULL CHECK(minimal BETWEEN 1 AND 60),
 created_by UUID REFERENCES public.app_users(id), created_at TEXT NOT NULL,
 CHECK(pot_kurang<=pot_tidak),
 CHECK(pot_id+pot_tidak+2*pot_teguran<=100));
ALTER TABLE portal.visit_score_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.visit_score_rules FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO portal.visit_score_rules(berlaku_mulai,pot_id,pot_kurang,pot_tidak,pot_teguran,ambang,minimal,created_at)
VALUES('2026-01',20,10,20,20,95,10,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

-- Jenis temuan. id = kode yang disimpan di penilaian; tidak pernah dihapus atau dipakai
-- ulang, hanya dinonaktifkan (penilaian lama tetap merujuknya). Daftar awal = contoh di
-- usulan, sampai daftar resmi dari kode etik/SOP guide dikirim.
CREATE TABLE portal.visit_finding_types (
 id TEXT PRIMARY KEY CHECK(id ~ '^[a-z0-9-]{2,40}$'),
 jenis TEXT NOT NULL CHECK(jenis IN('teguran','berat','apresiasi')),
 label TEXT NOT NULL CHECK(length(label) BETWEEN 2 AND 80 AND label=btrim(label)),
 urut INTEGER NOT NULL CHECK(urut BETWEEN 0 AND 999),
 perlu_catatan INTEGER NOT NULL DEFAULT 0 CHECK(perlu_catatan IN(0,1)),
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 created_by UUID REFERENCES public.app_users(id), updated_by UUID REFERENCES public.app_users(id));
ALTER TABLE portal.visit_finding_types ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.visit_finding_types FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO portal.visit_finding_types(id,jenis,label,urut,perlu_catatan,created_at,updated_at,row_version)
SELECT t.id,t.jenis,t.label,t.urut,t.catatan,s.stamp,s.stamp,1
FROM (VALUES
 ('tamu-tanpa-kain','teguran','Tamu tidak memakai kain/selendang',10,0),
 ('merokok-hp','teguran','Merokok atau bermain HP saat memandu',20,0),
 ('meninggalkan-tamu','teguran','Meninggalkan tamu',30,0),
 ('antrean','teguran','Tidak tertib antrean/giliran',40,0),
 ('teguran-lain','teguran','Teguran lain (tulis di catatan)',90,1),
 ('pungutan','berat','Meminta uang di luar tarif resmi atau memaksa donasi',10,1),
 ('area-terlarang','berat','Membawa tamu ke area terlarang',20,1),
 ('kasar','berat','Berkata kasar atau mengancam',30,1),
 ('alkohol','berat','Dalam pengaruh alkohol',40,1),
 ('berat-lain','berat','Pelanggaran berat lain (tulis di catatan)',90,1),
 ('dipuji','apresiasi','Dipuji wisatawan di depan petugas',10,1),
 ('menolong','apresiasi','Membantu wisatawan yang sakit atau tersesat',20,1),
 ('apresiasi-lain','apresiasi','Apresiasi lain (tulis di catatan)',90,1)) AS t(id,jenis,label,urut,catatan)
CROSS JOIN (SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS stamp) AS s;

CREATE TABLE portal.visit_assessors (
 id TEXT PRIMARY KEY CHECK(id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 nama TEXT NOT NULL CHECK(length(nama) BETWEEN 2 AND 120 AND nama=btrim(nama)),
 keterangan TEXT NOT NULL DEFAULT '' CHECK(length(keterangan)<=80),
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 created_by UUID REFERENCES public.app_users(id), updated_by UUID REFERENCES public.app_users(id));
ALTER TABLE portal.visit_assessors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.visit_assessors FROM PUBLIC,anon,authenticated,service_role;

-- Pelanggaran berat dan apresiasi menunggu keputusan Pengelola Kunjungan. Disalin dari
-- penilaiannya saat diterima, sehingga tetap ada setelah rincian penilaian dihapus.
CREATE TABLE portal.visit_flags (
 id TEXT PRIMARY KEY CHECK(id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 evaluation_id TEXT NOT NULL CHECK(evaluation_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 jenis TEXT NOT NULL CHECK(jenis IN('berat','apresiasi')),
 kode TEXT NOT NULL REFERENCES portal.visit_finding_types(id),
 guide_id TEXT NOT NULL REFERENCES portal.visit_guides(id),
 guide_name TEXT NOT NULL CHECK(length(guide_name) BETWEEN 1 AND 120),
 pos INTEGER NOT NULL CHECK(pos IN(1,3)),
 wita_date TEXT NOT NULL CHECK(wita_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 evaluated_at TEXT NOT NULL,
 catatan TEXT NOT NULL CHECK(length(catatan) BETWEEN 1 AND 500),
 petugas_nama TEXT CHECK(petugas_nama IS NULL OR length(petugas_nama) BETWEEN 1 AND 120),
 status TEXT NOT NULL DEFAULT 'menunggu' CHECK(status IN('menunggu','disetujui','ditolak','dibatalkan')),
 keputusan_catatan TEXT NOT NULL DEFAULT '' CHECK(length(keputusan_catatan)<=500),
 decided_by UUID REFERENCES public.app_users(id), decided_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 UNIQUE(evaluation_id,jenis),
 CHECK((status IN('disetujui','ditolak'))=(decided_at IS NOT NULL)));
ALTER TABLE portal.visit_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.visit_flags FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX visit_flags_status_day ON portal.visit_flags(status,wita_date);
CREATE INDEX visit_flags_guide_day ON portal.visit_flags(guide_id,wita_date);

CREATE TABLE portal.visit_form_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 petunjuk_id TEXT NOT NULL CHECK(length(petunjuk_id) BETWEEN 1 AND 300),
 petunjuk_seragam TEXT NOT NULL CHECK(length(petunjuk_seragam) BETWEEN 1 AND 500),
 updated_at TEXT NOT NULL, updated_by UUID REFERENCES public.app_users(id), row_version INTEGER NOT NULL);
ALTER TABLE portal.visit_form_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.visit_form_settings FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO portal.visit_form_settings(id,petunjuk_id,petunjuk_seragam,updated_at,row_version)
VALUES(1,'Terpasang = kartu ID resmi dikalungkan dan terlihat. Dicek dengan cara yang sama di Pos 1 dan Pos 3.',
 'Lengkap = semua atribut seragam guide sesuai aturan. Kurang lengkap = berseragam tetapi ada atribut yang kurang. Tidak berseragam = tidak memakai seragam guide (mis. baju kaos).',
 to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),1);

COMMENT ON TABLE portal.visit_score_rules IS 'Guide scoring rules (deductions, reward threshold, minimum deliveries) by month of effect. The portal only edits next month.';
COMMENT ON TABLE portal.visit_flags IS 'Serious violations and appreciation reported from pos links, verified by the Kunjungan manager. Kept beyond the 6-week evaluation retention.';

NOTIFY pgrst,'reload schema';
COMMIT;
