-- E-Arsip Humas (Tahap 1): arsip dokumen administrasi per bagian dengan pengawasan Humas.
-- Aditif, satu transaksi. Tidak mengubah tabel modul lain maupun tabel autentikasi.
--
-- Pemetaan dari PRD (nama di PRD adalah desain logis):
--   portal_user  -> public.app_users (lewat view portal.users)
--   portal_unit  -> portal.org_units; "bagian pemilik" = unit yang ditunjuk + unit di bawahnya
--   file_objects -> portal.files (berkas di Google Drive privat, folder SPH-Portal-Arsip)
--   schema arsip / arsip_private -> schema privat `portal` (RLS aktif, tanpa grant ke klien);
--   semua akses lewat Edge Function portal-api yang menjalankan otorisasi kanonis.
-- Role Humas ditentukan oleh izin archives.humas.manage yang DIBERIKAN LANGSUNG ke role;
-- Super Admin dan IT Admin hanya menerima izin menunjuk petugas (archives.officers.assign).
BEGIN;
SET LOCAL search_path=portal,pg_catalog;

CREATE TABLE portal.archive_document_types (
 id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE CHECK(length(code) BETWEEN 1 AND 20 AND code=upper(code)),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80), name_normalized TEXT NOT NULL UNIQUE,
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 created_by UUID REFERENCES public.app_users(id), updated_by UUID REFERENCES public.app_users(id));
INSERT INTO portal.archive_document_types(id,code,name,name_normalized,is_active,created_at,updated_at,row_version)
SELECT t.id,t.code,t.name,lower(t.name),1,s.ts,s.ts,1
FROM (VALUES('arsip-jenis-surat','SURAT','Surat'),('arsip-jenis-sk','SK','Surat Keputusan'),('arsip-jenis-st','ST','Surat Tugas'),
 ('arsip-jenis-und','UND','Undangan'),('arsip-jenis-nd','ND','Nota Dinas'),('arsip-jenis-ba','BA','Berita Acara')) AS t(id,code,name),
 (SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ts) s
ON CONFLICT DO NOTHING;

-- Kode agenda per bagian (mis. HMS). Tidak berubah setelah dipakai nomor agenda.
CREATE TABLE portal.archive_units (
 id TEXT PRIMARY KEY, org_unit_id TEXT NOT NULL UNIQUE REFERENCES portal.org_units(id),
 agenda_code TEXT NOT NULL UNIQUE CHECK(agenda_code ~ '^[A-Z0-9]{2,12}$'),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID NOT NULL REFERENCES public.app_users(id));

-- Petugas arsip yang ditunjuk administrator, per bagian. Masa berlaku diperiksa saat dibaca.
CREATE TABLE portal.archive_officers (
 id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES public.app_users(id), org_unit_id TEXT NOT NULL REFERENCES portal.org_units(id),
 valid_from TEXT NOT NULL, expires_at TEXT, assigned_by UUID NOT NULL REFERENCES public.app_users(id), assigned_at TEXT NOT NULL,
 revoked_by UUID REFERENCES public.app_users(id), revoked_at TEXT, reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 300),
 revoke_reason TEXT CHECK(revoke_reason IS NULL OR length(revoke_reason) BETWEEN 1 AND 300),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 CHECK(expires_at IS NULL OR expires_at>valid_from), CHECK((revoked_by IS NULL)=(revoked_at IS NULL)));
CREATE UNIQUE INDEX archive_officers_open ON portal.archive_officers(user_id,org_unit_id) WHERE revoked_at IS NULL;
CREATE INDEX archive_officers_unit ON portal.archive_officers(org_unit_id);

-- Pencacah nomor agenda per bagian dan tahun pengarsipan (WITA). Hanya finalisasi arsip yang mengubahnya.
CREATE TABLE portal.archive_agenda_counters (
 id TEXT PRIMARY KEY, org_unit_id TEXT NOT NULL REFERENCES portal.org_units(id), archival_year INTEGER NOT NULL CHECK(archival_year BETWEEN 2000 AND 9999),
 last_value INTEGER NOT NULL DEFAULT 0 CHECK(last_value>=0), updated_at TEXT NOT NULL, UNIQUE(org_unit_id,archival_year));

CREATE TABLE portal.archive_records (
 id TEXT PRIMARY KEY, owner_unit_id TEXT NOT NULL REFERENCES portal.org_units(id), unit_code_snapshot TEXT NOT NULL,
 archival_year INTEGER NOT NULL, agenda_sequence INTEGER NOT NULL CHECK(agenda_sequence>0), agenda_number TEXT NOT NULL UNIQUE, archived_at TEXT NOT NULL,
 direction TEXT NOT NULL CHECK(direction IN('MASUK','KELUAR','INTERNAL')),
 document_type_id TEXT NOT NULL REFERENCES portal.archive_document_types(id) ON DELETE RESTRICT, document_type_name_snapshot TEXT NOT NULL,
 official_number TEXT CHECK(official_number IS NULL OR length(official_number) BETWEEN 1 AND 120), official_number_normalized TEXT,
 letter_date TEXT NOT NULL CHECK(letter_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'), subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 500), subject_normalized TEXT NOT NULL,
 classification TEXT NOT NULL DEFAULT 'BIASA' CHECK(classification IN('BIASA','RAHASIA')),
 security_epoch INTEGER NOT NULL DEFAULT 1 CHECK(security_epoch>0), row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version>0),
 source_kind TEXT NOT NULL DEFAULT 'MANUAL' CHECK(source_kind IN('MANUAL','PERSURATAN_TAHAP2')), source_system TEXT, source_reference TEXT,
 created_by UUID NOT NULL REFERENCES public.app_users(id), updated_by UUID NOT NULL REFERENCES public.app_users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 deleted_at TEXT, deleted_by UUID REFERENCES public.app_users(id), delete_reason TEXT,
 UNIQUE(owner_unit_id,archival_year,agenda_sequence),
 CHECK((official_number IS NULL)=(official_number_normalized IS NULL)),
 CHECK((source_system IS NULL)=(source_reference IS NULL)), CHECK(source_kind<>'MANUAL' OR source_system IS NULL),
 CHECK((deleted_at IS NULL AND deleted_by IS NULL AND delete_reason IS NULL) OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND length(delete_reason)>0)));
CREATE UNIQUE INDEX archive_records_source ON portal.archive_records(source_system,source_reference) WHERE source_system IS NOT NULL;
CREATE INDEX archive_records_unit_time ON portal.archive_records(owner_unit_id,archived_at DESC,id) WHERE deleted_at IS NULL;
CREATE INDEX archive_records_time ON portal.archive_records(archived_at DESC,id) WHERE deleted_at IS NULL;
CREATE INDEX archive_records_direction ON portal.archive_records(direction,archived_at) WHERE deleted_at IS NULL;
CREATE INDEX archive_records_type ON portal.archive_records(document_type_id,archived_at);
CREATE INDEX archive_records_class ON portal.archive_records(classification,archived_at) WHERE deleted_at IS NULL;
CREATE INDEX archive_records_number ON portal.archive_records(official_number_normalized) WHERE official_number_normalized IS NOT NULL;
CREATE INDEX archive_records_subject ON portal.archive_records(letter_date,subject_normalized);
CREATE INDEX archive_records_deleted ON portal.archive_records(deleted_at DESC) WHERE deleted_at IS NOT NULL;

-- Dokumen utama dan lampiran. Lampiran dilepas secara logis; dokumen utama hanya diganti versinya.
CREATE TABLE portal.archive_documents (
 id TEXT PRIMARY KEY, archive_id TEXT NOT NULL REFERENCES portal.archive_records(id) ON DELETE RESTRICT, role TEXT NOT NULL CHECK(role IN('MAIN','ATTACHMENT')),
 display_order INTEGER NOT NULL DEFAULT 0 CHECK(display_order>=0), current_version_id TEXT NOT NULL,
 created_by UUID NOT NULL REFERENCES public.app_users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 removed_at TEXT, removed_by UUID REFERENCES public.app_users(id), remove_reason TEXT,
 UNIQUE(archive_id,id), CHECK(role<>'MAIN' OR removed_at IS NULL),
 CHECK((removed_at IS NULL AND removed_by IS NULL AND remove_reason IS NULL) OR (removed_at IS NOT NULL AND removed_by IS NOT NULL AND length(remove_reason)>0)));
CREATE UNIQUE INDEX archive_documents_one_main ON portal.archive_documents(archive_id) WHERE role='MAIN' AND removed_at IS NULL;
CREATE INDEX archive_documents_archive ON portal.archive_documents(archive_id,display_order);

-- Setiap versi berkas adalah berkas Drive tersendiri; versi lama tidak pernah ditimpa.
CREATE TABLE portal.archive_document_versions (
 id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES portal.archive_documents(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 version_number INTEGER NOT NULL CHECK(version_number>0),
 file_id TEXT NOT NULL UNIQUE REFERENCES portal.files(id) ON DELETE RESTRICT, original_filename TEXT NOT NULL CHECK(length(original_filename) BETWEEN 1 AND 180),
 detected_mime TEXT NOT NULL CHECK(detected_mime IN('application/pdf','image/jpeg','image/png')),
 byte_size INTEGER NOT NULL CHECK(byte_size>0 AND byte_size<=10000000), sha256 TEXT NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 change_reason TEXT CHECK(change_reason IS NULL OR length(change_reason) BETWEEN 1 AND 300),
 created_by UUID NOT NULL REFERENCES public.app_users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 UNIQUE(document_id,version_number), UNIQUE(document_id,id), CHECK(version_number=1 OR change_reason IS NOT NULL));
CREATE INDEX archive_document_versions_hash ON portal.archive_document_versions(sha256);
ALTER TABLE portal.archive_documents ADD CONSTRAINT archive_documents_current_version_fk
 FOREIGN KEY(id,current_version_id) REFERENCES portal.archive_document_versions(document_id,id) DEFERRABLE INITIALLY DEFERRED;

-- Izin per arsip. BIASA_SHARE: pengguna atau bagian, sampai dicabut. RAHASIA_READ dan
-- DOWNLOAD: hanya pengguna bernama dan terikat security_epoch arsip saat diberikan.
CREATE TABLE portal.archive_access_grants (
 id TEXT PRIMARY KEY, archive_id TEXT NOT NULL REFERENCES portal.archive_records(id) ON DELETE RESTRICT,
 purpose TEXT NOT NULL CHECK(purpose IN('BIASA_SHARE','RAHASIA_READ','DOWNLOAD')),
 target_user_id UUID REFERENCES public.app_users(id), target_unit_id TEXT REFERENCES portal.org_units(id), security_epoch INTEGER,
 valid_from TEXT NOT NULL, expires_at TEXT, granted_by UUID NOT NULL REFERENCES public.app_users(id), granted_at TEXT NOT NULL,
 revoked_by UUID REFERENCES public.app_users(id), revoked_at TEXT, reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 300),
 revoked_reason TEXT CHECK(revoked_reason IS NULL OR length(revoked_reason) BETWEEN 1 AND 300),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 CHECK((target_user_id IS NULL)<>(target_unit_id IS NULL)), CHECK(purpose='BIASA_SHARE' OR target_user_id IS NOT NULL),
 CHECK((purpose='BIASA_SHARE')=(security_epoch IS NULL)), CHECK(purpose='RAHASIA_READ' OR expires_at IS NULL),
 CHECK(expires_at IS NULL OR expires_at>valid_from), CHECK((revoked_by IS NULL)=(revoked_at IS NULL)));
CREATE UNIQUE INDEX archive_access_grants_user_open ON portal.archive_access_grants(archive_id,purpose,target_user_id) WHERE revoked_at IS NULL AND target_user_id IS NOT NULL;
CREATE UNIQUE INDEX archive_access_grants_unit_open ON portal.archive_access_grants(archive_id,purpose,target_unit_id) WHERE revoked_at IS NULL AND target_unit_id IS NOT NULL;
CREATE INDEX archive_access_grants_user ON portal.archive_access_grants(target_user_id,purpose) WHERE revoked_at IS NULL;
CREATE INDEX archive_access_grants_unit ON portal.archive_access_grants(target_unit_id,purpose) WHERE revoked_at IS NULL;

-- Pengajuan penghapusan oleh petugas; Humas yang memutuskan (RT06, kanal digital ringan).
CREATE TABLE portal.archive_delete_requests (
 id TEXT PRIMARY KEY, archive_id TEXT NOT NULL REFERENCES portal.archive_records(id) ON DELETE RESTRICT,
 requested_by UUID NOT NULL REFERENCES public.app_users(id), requested_at TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500), status TEXT NOT NULL CHECK(status IN('PENDING','APPROVED','REJECTED','CANCELLED')),
 decided_by UUID REFERENCES public.app_users(id), decided_at TEXT, decision_reason TEXT CHECK(decision_reason IS NULL OR length(decision_reason) BETWEEN 1 AND 500),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 CHECK(status NOT IN('APPROVED','REJECTED') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_reason IS NOT NULL)));
CREATE UNIQUE INDEX archive_delete_requests_pending ON portal.archive_delete_requests(archive_id) WHERE status='PENDING';
CREATE INDEX archive_delete_requests_archive ON portal.archive_delete_requests(archive_id);

-- Operasi idempoten (buat arsip, tambah lampiran, ganti berkas): kunci sama + isi sama = hasil sama.
CREATE TABLE portal.archive_upload_operations (
 id TEXT PRIMARY KEY, actor_id UUID NOT NULL REFERENCES public.app_users(id), owner_unit_id TEXT NOT NULL REFERENCES portal.org_units(id),
 operation_type TEXT NOT NULL CHECK(operation_type IN('CREATE_ARCHIVE','ADD_ATTACHMENT','REPLACE_FILE')),
 idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 64), payload_fingerprint TEXT NOT NULL CHECK(length(payload_fingerprint)=64),
 status TEXT NOT NULL CHECK(status IN('COMMITTED')), result_archive_id TEXT NOT NULL REFERENCES portal.archive_records(id),
 result_document_id TEXT REFERENCES portal.archive_documents(id), result_version_id TEXT REFERENCES portal.archive_document_versions(id), request_id TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, UNIQUE(actor_id,operation_type,idempotency_key));
CREATE INDEX archive_upload_operations_archive ON portal.archive_upload_operations(result_archive_id);

-- Alasan tetap menyimpan dugaan duplikat. internal_match_ids tidak pernah dikirim ke pemohon.
CREATE TABLE portal.archive_duplicate_overrides (
 id TEXT PRIMARY KEY, archive_id TEXT NOT NULL REFERENCES portal.archive_records(id), operation_id TEXT NOT NULL UNIQUE REFERENCES portal.archive_upload_operations(id),
 actor_id UUID NOT NULL REFERENCES public.app_users(id), reason TEXT CHECK(reason IS NULL OR length(reason) BETWEEN 1 AND 500), rule_version TEXT NOT NULL,
 visible_match_ids TEXT NOT NULL DEFAULT '[]', internal_match_ids TEXT NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, CHECK(reason IS NOT NULL OR visible_match_ids='[]'));
CREATE INDEX archive_duplicate_overrides_archive ON portal.archive_duplicate_overrides(archive_id);

-- Audit modul, hanya bertambah. Terpisah dari portal.audit_events supaya ringkasan perubahan
-- arsip Rahasia tidak terbaca lewat Riwayat Aktivitas administrator.
CREATE TABLE portal.archive_audit_events (
 id TEXT PRIMARY KEY, occurred_at TEXT NOT NULL, actor_user_id UUID REFERENCES public.app_users(id), actor_snapshot TEXT NOT NULL DEFAULT '{}',
 actor_type TEXT NOT NULL CHECK(actor_type IN('USER','SYSTEM')), action TEXT NOT NULL CHECK(length(action) BETWEEN 1 AND 60),
 archive_id TEXT REFERENCES portal.archive_records(id), document_id TEXT REFERENCES portal.archive_documents(id), version_id TEXT REFERENCES portal.archive_document_versions(id),
 request_id TEXT NOT NULL, operation_id TEXT, outcome TEXT NOT NULL CHECK(outcome IN('SUCCESS','DENIED','FAILED')), reason TEXT,
 before_data TEXT, after_data TEXT, safe_context TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, CHECK(actor_type<>'USER' OR actor_user_id IS NOT NULL));
CREATE INDEX archive_audit_events_archive ON portal.archive_audit_events(archive_id,occurred_at DESC);
CREATE INDEX archive_audit_events_actor ON portal.archive_audit_events(actor_user_id,occurred_at DESC);
CREATE INDEX archive_audit_events_request ON portal.archive_audit_events(request_id);
CREATE UNIQUE INDEX archive_audit_events_operation ON portal.archive_audit_events(operation_id,action) WHERE operation_id IS NOT NULL AND outcome='SUCCESS';

-- Notifikasi portal: berbagi (hanya pegawai yang dituju) dan satu ringkasan harian per Humas.
CREATE TABLE portal.archive_notifications (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL, notification_type TEXT NOT NULL CHECK(notification_type IN('ARCHIVE_SHARED','HUMAS_DAILY_SUMMARY')),
 recipient_user_id UUID NOT NULL REFERENCES public.app_users(id), archive_id TEXT REFERENCES portal.archive_records(id),
 summary_date TEXT CHECK(summary_date IS NULL OR summary_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 payload_minimal TEXT NOT NULL DEFAULT '{}', read_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 UNIQUE(event_id,recipient_user_id,notification_type),
 CHECK((notification_type='ARCHIVE_SHARED')=(archive_id IS NOT NULL)), CHECK((notification_type='HUMAS_DAILY_SUMMARY')=(summary_date IS NOT NULL)));
CREATE UNIQUE INDEX archive_notifications_summary ON portal.archive_notifications(recipient_user_id,notification_type,summary_date) WHERE summary_date IS NOT NULL;
CREATE INDEX archive_notifications_recipient ON portal.archive_notifications(recipient_user_id,created_at DESC);
CREATE INDEX archive_notifications_archive ON portal.archive_notifications(archive_id) WHERE archive_id IS NOT NULL;

CREATE TABLE portal.archive_daily_summary_runs (
 id TEXT PRIMARY KEY, summary_date TEXT NOT NULL UNIQUE CHECK(summary_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'), timezone TEXT NOT NULL,
 period_start TEXT NOT NULL, period_end TEXT NOT NULL, counts_by_unit TEXT NOT NULL, total INTEGER NOT NULL CHECK(total>=0),
 status TEXT NOT NULL CHECK(status IN('PREPARED','COMPLETED')), prepared_at TEXT NOT NULL, completed_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, CHECK(period_end>period_start));

-- Identitas arsip tidak berubah; arsip, dokumen, versi, dan audit tidak pernah dihapus fisik.
CREATE FUNCTION portal.archive_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $guard$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Data arsip tidak boleh dihapus permanen.'; END IF;
 IF TG_TABLE_NAME IN('archive_document_versions','archive_audit_events') THEN RAISE EXCEPTION 'Versi berkas dan audit arsip tidak boleh diubah.'; END IF;
 IF TG_TABLE_NAME='archive_records' AND (NEW.id,NEW.owner_unit_id,NEW.unit_code_snapshot,NEW.archival_year,NEW.agenda_sequence,NEW.agenda_number,NEW.archived_at,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.owner_unit_id,OLD.unit_code_snapshot,OLD.archival_year,OLD.agenda_sequence,OLD.agenda_number,OLD.archived_at,OLD.created_by,OLD.created_at) THEN
  RAISE EXCEPTION 'Identitas arsip tidak boleh diubah.';
 END IF;
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION portal.archive_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER archive_records_guard BEFORE UPDATE OR DELETE ON portal.archive_records FOR EACH ROW EXECUTE FUNCTION portal.archive_guard();
CREATE TRIGGER archive_documents_guard BEFORE DELETE ON portal.archive_documents FOR EACH ROW EXECUTE FUNCTION portal.archive_guard();
CREATE TRIGGER archive_document_versions_guard BEFORE UPDATE OR DELETE ON portal.archive_document_versions FOR EACH ROW EXECUTE FUNCTION portal.archive_guard();
CREATE TRIGGER archive_audit_events_guard BEFORE UPDATE OR DELETE ON portal.archive_audit_events FOR EACH ROW EXECUTE FUNCTION portal.archive_guard();

-- Diperiksa saat commit: setiap arsip punya TEPAT satu dokumen utama aktif, dan setiap
-- dokumen menunjuk versi miliknya sendiri. Arsip tanpa dokumen gagal commit.
CREATE FUNCTION portal.archive_assert_complete(target TEXT) RETURNS void LANGUAGE plpgsql SET search_path='' AS $complete$
BEGIN
 IF target IS NULL OR NOT EXISTS(SELECT 1 FROM portal.archive_records r WHERE r.id=target) THEN RETURN; END IF;
 IF (SELECT count(*) FROM portal.archive_documents d WHERE d.archive_id=target AND d.role='MAIN' AND d.removed_at IS NULL)<>1 THEN
  RAISE EXCEPTION 'Arsip harus memiliki tepat satu dokumen utama.' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM portal.archive_documents d WHERE d.archive_id=target
    AND NOT EXISTS(SELECT 1 FROM portal.archive_document_versions v WHERE v.id=d.current_version_id AND v.document_id=d.id)) THEN
  RAISE EXCEPTION 'Dokumen arsip harus menunjuk versi miliknya.' USING ERRCODE='23514';
 END IF;
END $complete$;
CREATE FUNCTION portal.archive_records_complete() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $complete$
BEGIN
 PERFORM portal.archive_assert_complete(NEW.id);
 RETURN NULL;
END $complete$;
CREATE FUNCTION portal.archive_documents_complete() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $complete$
BEGIN
 IF TG_OP<>'INSERT' THEN PERFORM portal.archive_assert_complete(OLD.archive_id); END IF;
 IF TG_OP<>'DELETE' THEN PERFORM portal.archive_assert_complete(NEW.archive_id); END IF;
 RETURN NULL;
END $complete$;
REVOKE ALL ON FUNCTION portal.archive_assert_complete(TEXT) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION portal.archive_records_complete() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION portal.archive_documents_complete() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER archive_records_complete AFTER INSERT OR UPDATE ON portal.archive_records
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.archive_records_complete();
CREATE CONSTRAINT TRIGGER archive_documents_complete AFTER INSERT OR UPDATE OR DELETE ON portal.archive_documents
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.archive_documents_complete();

DO $rls$
DECLARE t TEXT;
BEGIN
 FOREACH t IN ARRAY ARRAY['archive_document_types','archive_units','archive_officers','archive_agenda_counters','archive_records','archive_documents',
  'archive_document_versions','archive_access_grants','archive_delete_requests','archive_upload_operations','archive_duplicate_overrides',
  'archive_audit_events','archive_notifications','archive_daily_summary_runs'] LOOP
  EXECUTE format('ALTER TABLE portal.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON portal.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $rls$;

INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES
 ('archives.humas.manage','archives','archives.humas','manage'),
 ('archives.records.oversee','archives','archives.records','oversee'),
 ('archives.officers.assign','archives','archives.officers','assign')
ON CONFLICT(code) DO NOTHING;

-- Humas: seluruh kewenangan khusus E-Arsip. Pengawas Arsip: melihat arsip Biasa pada unit
-- cakupan role (bukan isi Rahasia). Role diberikan administrator lewat Role & Izin.
WITH templates(code,name,codes) AS (VALUES
 ('HUMAS','Humas',ARRAY['archives.humas.manage']),
 ('ARSIP_PENGAWAS','Pengawas Arsip',ARRAY['archives.records.oversee'])),
added AS (
 INSERT INTO public.app_roles(code,name) SELECT code,name FROM templates
 ON CONFLICT(code) DO NOTHING RETURNING id,code),
assigned AS (
 SELECT id,code FROM added
 UNION ALL
 SELECT r.id,r.code FROM public.app_roles r JOIN templates t ON t.code=r.code
 WHERE NOT EXISTS(SELECT 1 FROM added a WHERE a.code=r.code))
INSERT INTO public.app_role_permissions(role_id,permission_id)
SELECT a.id,p.id FROM assigned a JOIN templates t ON t.code=a.code JOIN public.app_permissions p ON p.code=ANY(t.codes)
ON CONFLICT DO NOTHING;

-- Administrator portal hanya menunjuk petugas arsip. Izin Humas dan pengawasan TIDAK
-- diberikan ke Super Admin/IT Admin: administrator tidak otomatis membaca arsip Rahasia.
INSERT INTO public.app_role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM public.app_roles r CROSS JOIN public.app_permissions p
WHERE r.code IN('SUPER_ADMIN','IT_ADMIN') AND p.code='archives.officers.assign'
ON CONFLICT DO NOTHING;

NOTIFY pgrst,'reload schema';
COMMIT;
