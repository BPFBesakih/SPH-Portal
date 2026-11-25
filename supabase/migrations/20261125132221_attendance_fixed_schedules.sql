-- Jadwal tetap untuk pilot Sekretariat.
-- Pola mengikuti penempatan utama pegawai dan berlaku sejak pemasangan.
BEGIN;

CREATE TABLE portal.attendance_schedule_shifts (
  code TEXT PRIMARY KEY CHECK (length(code) BETWEEN 1 AND 40),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  late_time TIME NOT NULL,
  end_day_offset SMALLINT NOT NULL CHECK (end_day_offset IN (0, 1)),
  CHECK (late_time >= start_time),
  CHECK (
    (end_day_offset = 0 AND end_time > start_time AND late_time < end_time)
    OR (end_day_offset = 1 AND end_time <= start_time)
  )
);

CREATE TABLE portal.attendance_schedule_units (
  org_unit_id TEXT PRIMARY KEY REFERENCES portal.org_units(id),
  starts_on DATE NOT NULL
);

CREATE TABLE portal.attendance_schedule_weekdays (
  org_unit_id TEXT NOT NULL REFERENCES portal.attendance_schedule_units(org_unit_id),
  weekday_no SMALLINT NOT NULL CHECK (weekday_no BETWEEN 1 AND 7),
  shift_code TEXT NOT NULL REFERENCES portal.attendance_schedule_shifts(code),
  PRIMARY KEY (org_unit_id, weekday_no)
);

CREATE TABLE portal.attendance_schedule_holidays (
  work_date DATE PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120)
);

ALTER TABLE portal.attendance_schedule_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.attendance_schedule_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.attendance_schedule_weekdays ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.attendance_schedule_holidays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.attendance_schedule_shifts, portal.attendance_schedule_units,
  portal.attendance_schedule_weekdays, portal.attendance_schedule_holidays
  FROM PUBLIC, anon, authenticated, service_role;

-- Master Shift Absensi SPH Portal yang dikonfirmasi, 41 kode.
INSERT INTO portal.attendance_schedule_shifts (code, name, start_time, end_time, late_time, end_day_offset) VALUES
  ('10000', 'Sekretariat Senin-Jumat', '08:00', '16:00', '08:16', 0),
  ('10001', 'Sekretariat Sabtu', '08:00', '13:00', '08:16', 0),
  ('20001', 'Ops. Shuttle Shift 1', '07:00', '15:00', '07:16', 0),
  ('20002', 'Ops. Shuttle Shift 2', '10:00', '18:00', '10:16', 0),
  ('20003', 'Ops. Shuttle Shift 3', '14:00', '22:00', '14:16', 0),
  ('20004', 'Ops. Shuttle half-shift', '07:00', '12:00', '07:16', 0),
  ('21001', 'Ops. Parkir Shift 1', '07:00', '12:00', '07:15', 0),
  ('21002', 'Ops. Parkir Shift 2', '10:00', '18:00', '10:15', 0),
  ('21003', 'Ops. Parkir half-shift', '07:00', '12:00', '07:15', 0),
  ('22001', 'Ops. Kunjungan Shift 1', '07:00', '15:00', '07:16', 0),
  ('22002', 'Ops. Kunjungan Shift 2', '10:00', '18:00', '10:15', 0),
  ('22003', 'Ops. Kunjungan half-shift 1', '07:00', '12:00', '07:16', 0),
  ('22004', 'Ops. Kunjungan half-shift 2', '13:00', '18:00', '13:15', 0),
  ('30001', 'Keamanan Shift 1', '07:00', '15:00', '07:15', 0),
  ('30002', 'Keamanan Shift 2', '15:00', '22:00', '15:15', 0),
  ('30003', 'Keamanan Shift 3', '22:00', '07:00', '22:15', 1),
  ('40001', 'Bankamda Shift 1', '07:00', '15:00', '07:15', 0),
  ('40002', 'Bankamda Shift 2', '10:00', '18:00', '10:15', 0),
  ('50001', 'Sekretariat Umum Shift 1', '07:00', '15:00', '07:15', 0),
  ('50002', 'Sekretariat Umum Shift 2', '10:00', '18:00', '10:15', 0),
  ('60001', 'Kebersihan Lingkungan', '07:00', '15:00', '07:16', 0),
  ('60002', 'Kebersihan Lingkungan 1/2 Shift', '07:00', '12:00', '07:16', 0),
  ('61001', 'Kebersihan Pahryangan', '08:00', '16:00', '08:16', 0),
  ('61002', 'Kebersihan Pahryangan 1/2 Shift', '08:00', '13:00', '08:16', 0),
  ('62001', 'Pertamanan', '08:00', '16:00', '08:16', 0),
  ('62002', 'Pertamanan 1/2 Shift', '08:00', '13:00', '08:16', 0),
  ('63001', 'Kebersihan Gedung A', '06:00', '14:00', '06:16', 0),
  ('63002', 'Kebersihan Gedung A 1/2 Shift', '06:00', '11:00', '06:16', 0),
  ('63003', 'Kebersihan Gedung B', '10:00', '18:00', '10:16', 0),
  ('63004', 'Kebersihan Gedung B 1/2 Shift', '10:00', '15:00', '10:16', 0),
  ('63005', 'Kebersihan Gedung C', '08:00', '16:00', '08:16', 0),
  ('63006', 'Kebersihan Gedung C 1/2 Shift', '08:00', '13:00', '08:15', 0),
  ('70000', 'Keamanan Pagi 0', '07:00', '15:00', '07:15', 0),
  ('70001', 'Keamanan Pagi 1', '06:00', '13:00', '06:15', 0),
  ('70002', 'Keamanan Pagi 2', '09:00', '17:00', '09:15', 0),
  ('70003', 'Keamanan Pagi 3', '07:00', '12:00', '07:15', 0),
  ('71000', 'Keamanan Siang 0', '11:00', '18:00', '11:15', 0),
  ('71002', 'Keamanan Siang 2', '11:00', '17:00', '11:15', 0),
  ('71003', 'Keamanan Siang 3', '10:00', '18:00', '10:15', 0),
  ('72001', 'Keamanan Sore 1', '15:00', '23:00', '15:15', 0),
  ('73000', 'Keamanan Malam 0', '22:00', '06:00', '22:15', 1);

-- Hari libur nasional sesuai bagian A lampiran SKB tahun 2026 dan 2027.
-- 2026: https://jdih.kemnaker.go.id/asset/data_puu/2025kb002.pdf
-- 2027: https://data-jdih.menpan.go.id/dokumen/2026skb002.pdf
INSERT INTO portal.attendance_schedule_holidays (work_date, name) VALUES
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
  ('2026-06-16', 'Tahun Baru Hijriah'),
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
  ('2027-12-25', 'Natal'),
  ('2027-12-26', 'Isra Mikraj');

INSERT INTO portal.attendance_schedule_units (org_unit_id, starts_on)
SELECT id, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Makassar')::date
FROM portal.org_units
WHERE code = 'BPB_S' AND is_active = 1;

INSERT INTO portal.attendance_schedule_weekdays (org_unit_id, weekday_no, shift_code)
SELECT su.org_unit_id, pattern.weekday_no, pattern.shift_code
FROM portal.attendance_schedule_units su
JOIN portal.org_units u ON u.id = su.org_unit_id
CROSS JOIN (VALUES
  (1, '10000'), (2, '10000'), (3, '10000'), (4, '10000'), (5, '10000'), (6, '10001')
) AS pattern(weekday_no, shift_code)
WHERE u.code = 'BPB_S';

COMMIT;
