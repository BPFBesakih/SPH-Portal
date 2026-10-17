-- Correct the four combined master positions without changing employment status,
-- placement dates, supervisors, closed history, accounts or access grants.
-- Repeatable: separate positions are reused and only changed rows are audited.
BEGIN;
LOCK TABLE portal.positions, portal.employee_placements, portal.employees IN SHARE ROW EXCLUSIVE MODE;

DO $split$
DECLARE
  source record;
  target record;
  assignment record;
  kind text;
  target_id text;
  target_name text;
  target_code text;
  touched text[] := ARRAY[]::text[];
  stamp text := to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  reason text := 'Pisahkan posisi Staf dan THL sesuai permintaan pengelola dan status kerja tersimpan.';
  request text := 'separate-staff-thl-positions-20261017';
BEGIN
  IF (SELECT count(*) FROM portal.positions p JOIN portal.org_units u ON u.id=p.org_unit_id
      WHERE u.code='BPB_PLK' AND p.code IN ('BPB_PLK_P080','BPB_PLK_P081','BPB_PLK_P082','BPB_PLK_P083')
        AND p.name IN ('Staf dan THL Kebersihan Lingkungan','Staf dan THL Kebersihan Bangunan','Staf dan THL Pertamanan','Staf dan THL Pengolahan Sampah')) <> 4 THEN
    RAISE EXCEPTION 'Empat posisi sumber Staf dan THL tidak sesuai. Periksa master sebelum menjalankan koreksi.';
  END IF;
  IF EXISTS (SELECT 1 FROM portal.employee_placements ep JOIN portal.positions p ON p.id=ep.position_id
      JOIN portal.employees e ON e.id=ep.employee_id
      WHERE p.code IN ('BPB_PLK_P080','BPB_PLK_P081','BPB_PLK_P082','BPB_PLK_P083')
        AND ep.is_primary=1 AND ep.valid_to IS NULL
        AND e.employment_status NOT IN ('Pegawai Kontrak (PKWT)','Tenaga Harian Lepas')) THEN
    RAISE EXCEPTION 'Status kerja belum dapat membedakan Staf dan THL. Tinjau pegawai terlebih dahulu.';
  END IF;

  FOR source IN SELECT * FROM portal.positions
      WHERE code IN ('BPB_PLK_P080','BPB_PLK_P081','BPB_PLK_P082','BPB_PLK_P083') ORDER BY code LOOP
    FOREACH kind IN ARRAY ARRAY['STAF','THL'] LOOP
      target_name := CASE kind WHEN 'STAF' THEN 'Staf ' ELSE 'THL ' END || substring(source.name FROM 14);
      target_code := source.code || '_' || kind;
      SELECT * INTO target FROM portal.positions WHERE lower(code)=lower(target_code);
      IF FOUND THEN
        IF target.org_unit_id<>source.org_unit_id OR target.name<>target_name OR target.is_active<>1 THEN
          RAISE EXCEPTION 'Posisi tujuan % sudah dipakai untuk data lain atau tidak aktif.',target_code;
        END IF;
        target_id := target.id;
      ELSE
        target_id := gen_random_uuid()::text;
        INSERT INTO portal.positions(id,code,name,org_unit_id,is_active,created_at,updated_at,row_version)
          VALUES(target_id,target_code,target_name,source.org_unit_id,1,stamp,stamp,1);
        INSERT INTO portal.audit_events(id,action,object_type,object_key,occurred_at,outcome,request_id,reason,change_summary,created_at,updated_at,row_version)
          VALUES(gen_random_uuid()::text,'CREATE','positions',target_id,stamp,'SUCCESS',request,reason,
            jsonb_build_object('code',target_code,'name',target_name,'source_position_id',source.id)::text,stamp,stamp,1);
      END IF;

      FOR assignment IN SELECT ep.* FROM portal.employee_placements ep JOIN portal.employees e ON e.id=ep.employee_id
          WHERE ep.position_id=source.id AND ep.is_primary=1 AND ep.valid_to IS NULL
            AND e.employment_status=CASE kind WHEN 'STAF' THEN 'Pegawai Kontrak (PKWT)' ELSE 'Tenaga Harian Lepas' END LOOP
        UPDATE portal.employee_placements SET position_id=target_id,updated_at=stamp,row_version=row_version+1 WHERE id=assignment.id;
        touched := array_append(touched,assignment.employee_id);
        INSERT INTO portal.audit_events(id,action,object_type,object_key,occurred_at,outcome,request_id,reason,change_summary,created_at,updated_at,row_version)
          VALUES(gen_random_uuid()::text,'POSITION_CORRECTED','employees',assignment.employee_id,stamp,'SUCCESS',request,reason,
            jsonb_build_object('placement_id',assignment.id,'previous_position_id',source.id,'position_id',target_id)::text,stamp,stamp,1);
      END LOOP;
    END LOOP;

    IF source.is_active<>0 THEN
      UPDATE portal.positions SET is_active=0,updated_at=stamp,row_version=row_version+1 WHERE id=source.id;
      INSERT INTO portal.audit_events(id,action,object_type,object_key,occurred_at,outcome,request_id,reason,change_summary,created_at,updated_at,row_version)
        VALUES(gen_random_uuid()::text,'ARCHIVE_COMBINED','positions',source.id,stamp,'SUCCESS',request,reason,
          jsonb_build_object('previous_name',source.name,'is_active',0)::text,stamp,stamp,1);
    END IF;
  END LOOP;
  UPDATE portal.employees SET updated_at=stamp,row_version=row_version+1 WHERE id=ANY(touched);
END $split$;
COMMIT;
