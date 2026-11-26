-- Inisialisasi SQLite untuk pilot Sekretariat.
-- Dipanggil sekali dalam transaksi versi 7. Perubahan kalender sesudahnya tetap tersimpan.
INSERT INTO attendance_schedule_holidays (work_date, name) VALUES
  ('2026-01-01', 'Tahun Baru Masehi'),
  ('2026-01-16', 'Isra Mikraj'),
  ('2026-02-17', 'Tahun Baru Imlek'),
  ('2026-03-19', 'Hari Suci Nyepi'),
  ('2026-03-21', 'Idulfitri'),
  ('2026-03-22', 'Idulfitri'),
  ('2026-04-03', 'Wafat Yesus Kristus'),
  ('2026-04-05', 'Paskah'),
  ('2026-05-01', 'Hari Buruh'),
  ('2026-05-14', 'Kenaikan Yesus Kristus'),
  ('2026-05-27', 'Iduladha'),
  ('2026-05-31', 'Hari Raya Waisak'),
  ('2026-06-01', 'Hari Lahir Pancasila'),
  ('2026-06-16', 'Tahun Baru Hijriah dan Penampahan Galungan'),
  ('2026-08-17', 'Hari Kemerdekaan RI'),
  ('2026-08-25', 'Maulid Nabi Muhammad'),
  ('2026-12-25', 'Natal'),
  ('2027-01-01', 'Tahun Baru Masehi'),
  ('2027-01-05', 'Isra Mikraj'),
  ('2027-02-06', 'Tahun Baru Imlek'),
  ('2027-03-08', 'Hari Suci Nyepi'),
  ('2027-03-10', 'Idulfitri'),
  ('2027-03-11', 'Idulfitri'),
  ('2027-03-26', 'Wafat Yesus Kristus'),
  ('2027-03-28', 'Paskah'),
  ('2027-05-01', 'Hari Buruh'),
  ('2027-05-06', 'Kenaikan Yesus Kristus'),
  ('2027-05-17', 'Iduladha'),
  ('2027-05-20', 'Hari Raya Waisak'),
  ('2027-06-01', 'Hari Lahir Pancasila'),
  ('2027-06-06', 'Tahun Baru Hijriah'),
  ('2027-08-15', 'Maulid Nabi Muhammad'),
  ('2027-08-17', 'Hari Kemerdekaan RI'),
  ('2027-12-25', 'Natal dan Hari Raya Saraswati'),
  ('2027-12-26', 'Isra Mikraj'),
  ('2026-01-17', 'Hari Suci Siwaratri'),
  ('2026-03-20', 'Ngembak Geni'),
  ('2026-04-04', 'Hari Raya Saraswati'),
  ('2026-04-08', 'Hari Raya Pagerwesi'),
  ('2026-06-17', 'Hari Raya Galungan'),
  ('2026-06-18', 'Umanis Galungan'),
  ('2026-06-26', 'Penampahan Kuningan'),
  ('2026-06-27', 'Hari Raya Kuningan'),
  ('2026-10-31', 'Hari Raya Saraswati'),
  ('2026-11-04', 'Hari Raya Pagerwesi'),
  ('2027-01-06', 'Hari Suci Siwaratri'),
  ('2027-01-12', 'Penampahan Galungan'),
  ('2027-01-13', 'Hari Raya Galungan'),
  ('2027-01-14', 'Umanis Galungan'),
  ('2027-01-22', 'Penampahan Kuningan'),
  ('2027-01-23', 'Hari Raya Kuningan'),
  ('2027-03-07', 'Tawur Agung Kesanga'),
  ('2027-03-09', 'Ngembak Geni'),
  ('2027-05-29', 'Hari Raya Saraswati'),
  ('2027-06-02', 'Hari Raya Pagerwesi'),
  ('2027-08-10', 'Penampahan Galungan'),
  ('2027-08-11', 'Hari Raya Galungan'),
  ('2027-08-12', 'Umanis Galungan'),
  ('2027-08-20', 'Penampahan Kuningan'),
  ('2027-08-21', 'Hari Raya Kuningan'),
  ('2027-12-29', 'Hari Raya Pagerwesi')
ON CONFLICT(work_date) DO NOTHING;

-- Hanya jadwal baru milik Sekretariat yang menerima pola awal Senin–Sabtu.
CREATE TRIGGER attendance_sekretariat_weekdays
AFTER INSERT ON attendance_schedule_units
WHEN EXISTS (SELECT 1 FROM org_units WHERE id=NEW.org_unit_id AND code='BPB_S')
BEGIN
  INSERT INTO attendance_schedule_weekdays (org_unit_id, weekday_no, shift_code) VALUES
    (NEW.org_unit_id, 1, '10000'), (NEW.org_unit_id, 2, '10000'),
    (NEW.org_unit_id, 3, '10000'), (NEW.org_unit_id, 4, '10000'),
    (NEW.org_unit_id, 5, '10000'), (NEW.org_unit_id, 6, '10001');
END;

-- Unit bisa sudah ada saat migrasi, atau baru dibuat/diaktifkan oleh impor pegawai.
CREATE TRIGGER attendance_sekretariat_insert
AFTER INSERT ON org_units
WHEN NEW.code='BPB_S' AND NEW.is_active=1
BEGIN
  INSERT INTO attendance_schedule_units (org_unit_id, starts_on)
  VALUES (NEW.id, date('now', '+8 hours')) ON CONFLICT(org_unit_id) DO NOTHING;
END;

CREATE TRIGGER attendance_sekretariat_activate
AFTER UPDATE OF code, is_active ON org_units
WHEN NEW.code='BPB_S' AND NEW.is_active=1 AND (OLD.code<>NEW.code OR OLD.is_active<>NEW.is_active)
BEGIN
  INSERT INTO attendance_schedule_units (org_unit_id, starts_on)
  VALUES (NEW.id, date('now', '+8 hours')) ON CONFLICT(org_unit_id) DO NOTHING;
END;

INSERT INTO attendance_schedule_units (org_unit_id, starts_on)
SELECT id, date('now', '+8 hours') FROM org_units WHERE code='BPB_S' AND is_active=1
ON CONFLICT(org_unit_id) DO NOTHING;
