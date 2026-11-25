BEGIN;

-- Dasar pencatatan otomatis saat server memverifikasi izin luar area pegawai.
ALTER TABLE portal.attendance_events
  DROP CONSTRAINT attendance_events_outside_reason_check,
  ADD CONSTRAINT attendance_events_outside_reason_check
    CHECK (outside_reason IS NULL OR outside_reason IN ('DINAS_LUAR','TUGAS_LAPANGAN','LAINNYA','IZIN_LUAR_AREA'));

COMMIT;
