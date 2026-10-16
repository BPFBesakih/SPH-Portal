-- Generated from schema.sql by scripts/generate-cloud-schema.mjs.
-- Does not read or publish the local SQLite database. Apply after migrations 001–008.
BEGIN;
CREATE SCHEMA IF NOT EXISTS portal;
REVOKE ALL ON SCHEMA portal FROM PUBLIC,anon,authenticated,service_role;
SET LOCAL search_path=portal,pg_catalog;
CREATE TABLE IF NOT EXISTS portal.org_units (
 id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, parent_id TEXT, is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, CHECK(parent_id IS NULL OR parent_id<>id));
CREATE TABLE IF NOT EXISTS portal.positions (
 id TEXT PRIMARY KEY, org_unit_id TEXT NOT NULL, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID);
CREATE TABLE IF NOT EXISTS portal.employees (
 id TEXT PRIMARY KEY, employee_no TEXT NOT NULL UNIQUE, full_name TEXT NOT NULL, employment_status TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
 joined_on TEXT NOT NULL, ended_on TEXT, phone TEXT, email TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, CHECK(ended_on IS NULL OR ended_on>=joined_on));
CREATE TABLE IF NOT EXISTS portal.employee_placements (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, position_id TEXT NOT NULL, supervisor_employee_id TEXT, valid_from TEXT NOT NULL, valid_to TEXT, is_primary INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, CHECK(valid_to IS NULL OR valid_to>=valid_from), CHECK(supervisor_employee_id IS NULL OR supervisor_employee_id<>employee_id));
CREATE TABLE IF NOT EXISTS portal.user_role_units (created_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), user_role_id UUID NOT NULL, org_unit_id TEXT NOT NULL, include_descendants INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_role_id,org_unit_id));
CREATE TABLE IF NOT EXISTS portal.user_role_posts (created_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), user_role_id UUID NOT NULL, post_id TEXT NOT NULL, PRIMARY KEY(user_role_id,post_id));
CREATE TABLE IF NOT EXISTS portal.password_reset_tokens (
 id TEXT PRIMARY KEY, user_id UUID NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, issued_by UUID NOT NULL, consumed_at TEXT, revoked_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS portal.audit_events (
 id TEXT PRIMARY KEY, actor_user_id UUID, action TEXT NOT NULL, object_type TEXT NOT NULL, object_key TEXT NOT NULL, occurred_at TEXT NOT NULL, outcome TEXT NOT NULL, request_id TEXT NOT NULL, reason TEXT, change_summary TEXT, ip_address TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS portal.files (
 id TEXT PRIMARY KEY, storage_key TEXT NOT NULL UNIQUE, original_name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL CHECK(size_bytes>0), checksum TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN('AVAILABLE','QUARANTINED','ARCHIVED')), uploaded_by UUID,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS portal.employee_contracts (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, contract_no TEXT NOT NULL UNIQUE, starts_on TEXT NOT NULL, ends_on TEXT, file_id TEXT, notes TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, CHECK(ends_on IS NULL OR ends_on>=starts_on));
CREATE TABLE IF NOT EXISTS portal.employee_files (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, file_id TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL, notes TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, UNIQUE(employee_id,file_id));
CREATE TABLE IF NOT EXISTS portal.documents (
 id TEXT PRIMARY KEY, document_code TEXT NOT NULL UNIQUE, title TEXT NOT NULL, category TEXT NOT NULL, owner_org_unit_id TEXT NOT NULL, audience_kind TEXT NOT NULL DEFAULT 'ALL_UNITS' CHECK(audience_kind IN('ALL_UNITS','SELECTED_UNITS')), is_archived INTEGER NOT NULL DEFAULT 0, description TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID);
CREATE TABLE IF NOT EXISTS portal.document_versions (
 id TEXT PRIMARY KEY, document_id TEXT NOT NULL, file_id TEXT NOT NULL, version_label TEXT NOT NULL, effective_on TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','ACTIVE','ARCHIVED')), change_notes TEXT, activated_by UUID, activated_at TEXT, archived_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, UNIQUE(document_id,version_label));
CREATE TABLE IF NOT EXISTS portal.document_target_units (created_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), document_id TEXT NOT NULL, org_unit_id TEXT NOT NULL, PRIMARY KEY(document_id,org_unit_id));
CREATE TABLE IF NOT EXISTS portal.training_events (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, topic TEXT NOT NULL, organizer_org_unit_id TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PLANNED' CHECK(status IN('PLANNED','COMPLETED','CANCELLED')), organizer_name TEXT, location TEXT, description TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, CHECK(ends_at>starts_at));
CREATE TABLE IF NOT EXISTS portal.training_participants (
 id TEXT PRIMARY KEY, training_event_id TEXT NOT NULL, employee_id TEXT NOT NULL, attendance_status TEXT NOT NULL DEFAULT 'NOT_RECORDED' CHECK(attendance_status IN('NOT_RECORDED','PRESENT','ABSENT')), attendance_notes TEXT, attendance_recorded_by UUID, attendance_recorded_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, UNIQUE(training_event_id,employee_id));
CREATE TABLE IF NOT EXISTS portal.training_materials (
 id TEXT PRIMARY KEY, training_event_id TEXT NOT NULL, title TEXT NOT NULL, file_id TEXT, document_version_id TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, CHECK((file_id IS NULL)<>(document_version_id IS NULL)));
CREATE TABLE IF NOT EXISTS portal.participant_certificates (
 id TEXT PRIMARY KEY, training_participant_id TEXT NOT NULL, file_id TEXT NOT NULL, certificate_no TEXT, issued_on TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, UNIQUE(training_participant_id,file_id));
CREATE TABLE IF NOT EXISTS portal.coaching_sessions (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, coach_employee_id TEXT NOT NULL, org_unit_id TEXT NOT NULL, held_at TEXT NOT NULL, topic TEXT NOT NULL, guidance_notes TEXT NOT NULL, constraints_notes TEXT, agreement_notes TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, CHECK(employee_id<>coach_employee_id));
CREATE TABLE IF NOT EXISTS portal.coaching_actions (
 id TEXT PRIMARY KEY, coaching_session_id TEXT NOT NULL, responsible_employee_id TEXT NOT NULL, action_text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','IN_PROGRESS','DONE')), due_on TEXT, progress_notes TEXT, completion_notes TEXT, completed_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, CHECK((status='DONE' AND completed_at IS NOT NULL AND length(trim(completion_notes))>0) OR (status<>'DONE' AND completed_at IS NULL)));
CREATE TABLE IF NOT EXISTS portal.security_groups (
 id TEXT PRIMARY KEY, org_unit_id TEXT NOT NULL, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID);
CREATE TABLE IF NOT EXISTS portal.security_posts (
 id TEXT PRIMARY KEY, org_unit_id TEXT NOT NULL, home_group_id TEXT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, location_notes TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID);
CREATE TABLE IF NOT EXISTS portal.security_group_members (
 id TEXT PRIMARY KEY, security_group_id TEXT NOT NULL, employee_id TEXT NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, UNIQUE(security_group_id,employee_id,valid_from), CHECK(valid_to IS NULL OR valid_to>=valid_from));
CREATE TABLE IF NOT EXISTS portal.shift_definitions (
 id TEXT PRIMARY KEY, org_unit_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, end_day_offset INTEGER NOT NULL CHECK(end_day_offset IN(0,1)), is_active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, UNIQUE(org_unit_id,code));
CREATE TABLE IF NOT EXISTS portal.employee_post_eligibility (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, post_id TEXT NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT, notes TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, UNIQUE(employee_id,post_id,valid_from), CHECK(valid_to IS NULL OR valid_to>=valid_from));
CREATE TABLE IF NOT EXISTS portal.employee_unavailability (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, reason TEXT NOT NULL, recorded_by UUID NOT NULL, notes TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, CHECK(ends_at>starts_at));
CREATE TABLE IF NOT EXISTS portal.scheduling_rule_versions (
 id TEXT PRIMARY KEY, org_unit_id TEXT NOT NULL, version_no INTEGER NOT NULL, min_rest_minutes INTEGER NOT NULL CHECK(min_rest_minutes>0), max_consecutive_work_days INTEGER NOT NULL CHECK(max_consecutive_work_days>0), max_work_minutes_per_local_day INTEGER NOT NULL CHECK(max_work_minutes_per_local_day>0), max_work_minutes_rolling_7_days INTEGER NOT NULL CHECK(max_work_minutes_rolling_7_days>0), is_active INTEGER NOT NULL DEFAULT 1, notes TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, UNIQUE(org_unit_id,version_no));
CREATE TABLE IF NOT EXISTS portal.roster_pattern_versions (
 id TEXT PRIMARY KEY, org_unit_id TEXT NOT NULL, pattern_code TEXT NOT NULL, version_no INTEGER NOT NULL, name TEXT NOT NULL, cycle_length_days INTEGER NOT NULL CHECK(cycle_length_days>0), is_active INTEGER NOT NULL DEFAULT 1, notes TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, UNIQUE(org_unit_id,pattern_code,version_no));
CREATE TABLE IF NOT EXISTS portal.roster_pattern_steps (
 id TEXT PRIMARY KEY, pattern_version_id TEXT NOT NULL, cycle_day_no INTEGER NOT NULL, step_kind TEXT NOT NULL CHECK(step_kind IN('WORK','REST')), shift_id TEXT, post_id TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, UNIQUE(pattern_version_id,cycle_day_no), CHECK((step_kind='REST' AND shift_id IS NULL AND post_id IS NULL) OR (step_kind='WORK' AND shift_id IS NOT NULL)));
CREATE TABLE IF NOT EXISTS portal.employee_rotation_bindings (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, pattern_version_id TEXT NOT NULL, anchor_date TEXT NOT NULL, phase_offset_days INTEGER NOT NULL CHECK(phase_offset_days>=0), effective_from TEXT NOT NULL, notes TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, UNIQUE(employee_id,effective_from));
CREATE TABLE IF NOT EXISTS portal.staffing_requirements (
 id TEXT PRIMARY KEY, post_id TEXT NOT NULL, shift_id TEXT NOT NULL, weekday_no INTEGER NOT NULL CHECK(weekday_no BETWEEN 1 AND 7), required_count INTEGER NOT NULL CHECK(required_count>=0), effective_from TEXT NOT NULL, effective_to TEXT, is_active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, CHECK(effective_to IS NULL OR effective_to>=effective_from));
CREATE TABLE IF NOT EXISTS portal.staffing_overrides (
 id TEXT PRIMARY KEY, post_id TEXT NOT NULL, shift_id TEXT NOT NULL, starts_on TEXT NOT NULL, ends_on TEXT NOT NULL, replacement_required_count INTEGER NOT NULL CHECK(replacement_required_count>=0), reason TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, CHECK(ends_on>=starts_on));
CREATE TABLE IF NOT EXISTS portal.scheduling_periods (
 id TEXT PRIMARY KEY, org_unit_id TEXT NOT NULL, starts_on TEXT NOT NULL, ends_on TEXT NOT NULL, is_archived INTEGER NOT NULL DEFAULT 0, name TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, CHECK(ends_on>=starts_on));
CREATE TABLE IF NOT EXISTS portal.scheduling_period_posts (created_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), scheduling_period_id TEXT NOT NULL, post_id TEXT NOT NULL, PRIMARY KEY(scheduling_period_id,post_id));
CREATE TABLE IF NOT EXISTS portal.roster_revisions (
 id TEXT PRIMARY KEY, scheduling_period_id TEXT NOT NULL, revision_no INTEGER NOT NULL, rules_version_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','PUBLISHED','SUPERSEDED')), input_snapshot TEXT NOT NULL, input_hash TEXT NOT NULL, generator_version TEXT NOT NULL, generator_seed TEXT NOT NULL, based_on_revision_id TEXT, published_by UUID, published_at TEXT, superseded_at TEXT, validation_report TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, UNIQUE(scheduling_period_id,revision_no));
CREATE TABLE IF NOT EXISTS portal.revision_rotation_bindings (
 id TEXT PRIMARY KEY, roster_revision_id TEXT NOT NULL, rotation_binding_id TEXT NOT NULL, applies_from TEXT NOT NULL, applies_to TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, UNIQUE(roster_revision_id,rotation_binding_id,applies_from));
CREATE TABLE IF NOT EXISTS portal.roster_assignments (
 id TEXT PRIMARY KEY, roster_revision_id TEXT NOT NULL, employee_id TEXT NOT NULL, post_id TEXT NOT NULL, shift_id TEXT NOT NULL, service_date TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, origin TEXT NOT NULL CHECK(origin IN('ROUTINE','TEMPORARY','MANUAL')), is_locked INTEGER NOT NULL DEFAULT 0, display_snapshot TEXT NOT NULL, revision_rotation_binding_id TEXT, source_override_id TEXT, copied_from_assignment_id TEXT, locked_by UUID, locked_at TEXT, manual_change_reason TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, CHECK(ends_at>starts_at));
CREATE TABLE IF NOT EXISTS portal.roster_gaps (
 id TEXT PRIMARY KEY, roster_revision_id TEXT NOT NULL, post_id TEXT NOT NULL, shift_id TEXT NOT NULL, service_date TEXT NOT NULL, required_count INTEGER NOT NULL, assigned_count INTEGER NOT NULL, acknowledged_by UUID, acknowledged_at TEXT, acknowledgment_reason TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, UNIQUE(roster_revision_id,post_id,shift_id,service_date), CHECK(required_count>assigned_count AND assigned_count>=0));
CREATE TABLE IF NOT EXISTS portal.logbook_entries (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, post_id TEXT, occurred_at TEXT NOT NULL, activity_type TEXT NOT NULL CHECK(activity_type IN('JAGA','PATROLI','LAINNYA')), activity_notes TEXT NOT NULL, findings TEXT, roster_assignment_id TEXT,
 reporting_org_unit_id TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, location_accuracy DOUBLE PRECISION, location_captured_at TEXT, idempotency_key TEXT UNIQUE, request_fingerprint TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID);
CREATE TABLE IF NOT EXISTS portal.logbook_files (
 id TEXT PRIMARY KEY, logbook_entry_id TEXT NOT NULL, file_id TEXT NOT NULL, caption TEXT, captured_at TEXT, capture_source TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, UNIQUE(logbook_entry_id,file_id));
CREATE TABLE IF NOT EXISTS portal.incidents (
 id TEXT PRIMARY KEY, incident_no TEXT NOT NULL UNIQUE, idempotency_key TEXT NOT NULL UNIQUE, post_id TEXT, reporter_employee_id TEXT NOT NULL, occurred_at TEXT NOT NULL, incident_type TEXT NOT NULL, chronology TEXT NOT NULL, initial_action TEXT, status TEXT NOT NULL DEFAULT 'RECORDED' CHECK(status IN('RECORDED','IN_PROGRESS','RESOLVED')), source_logbook_entry_id TEXT, responsible_employee_id TEXT, resolved_at TEXT, resolution_notes TEXT,
 reporting_org_unit_id TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, location_accuracy DOUBLE PRECISION, location_captured_at TEXT, request_fingerprint TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID);
CREATE TABLE IF NOT EXISTS portal.incident_updates (
 id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, actor_user_id UUID NOT NULL, event_type TEXT NOT NULL, notes TEXT NOT NULL, from_status TEXT, to_status TEXT, new_responsible_employee_id TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS portal.incident_files (
 id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, file_id TEXT NOT NULL, caption TEXT, captured_at TEXT, capture_source TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, UNIQUE(incident_id,file_id));
CREATE TABLE IF NOT EXISTS portal.app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS portal.import_candidates (
 id TEXT PRIMARY KEY, full_name TEXT NOT NULL, position_name TEXT NOT NULL, org_path TEXT NOT NULL, source_cell TEXT NOT NULL, source_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', employee_id TEXT, notes TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, UNIQUE(source_name,source_cell,full_name));
CREATE TABLE IF NOT EXISTS portal.announcements (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN('UMUM','SDM','OPERASIONAL','KEAMANAN')), priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK(priority IN('NORMAL','IMPORTANT')),
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','PUBLISHED','ARCHIVED')), is_pinned INTEGER NOT NULL DEFAULT 0 CHECK(is_pinned IN(0,1)), content_json TEXT NOT NULL, content_version INTEGER NOT NULL DEFAULT 1,
 starts_at TEXT, ends_at TEXT, published_at TEXT, published_by UUID,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID NOT NULL, CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at>starts_at));
CREATE TABLE IF NOT EXISTS portal.announcement_files (
 id TEXT PRIMARY KEY, announcement_id TEXT NOT NULL, file_id TEXT NOT NULL, usage_kind TEXT NOT NULL CHECK(usage_kind IN('IMAGE','ATTACHMENT')), caption TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID, UNIQUE(announcement_id,file_id));
CREATE TABLE IF NOT EXISTS portal.announcement_reads (
 announcement_id TEXT NOT NULL, user_id UUID NOT NULL, content_version INTEGER NOT NULL, read_at TEXT NOT NULL, PRIMARY KEY(announcement_id,user_id));

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS employee_id TEXT UNIQUE;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS last_login_at TEXT;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS password_changed_at TEXT;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.app_users(id);
ALTER TABLE public.app_roles ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.app_users(id);
DO $fk$ BEGIN ALTER TABLE portal.org_units ADD CONSTRAINT org_units_parent_id_fk FOREIGN KEY (parent_id) REFERENCES portal.org_units(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.org_units ADD CONSTRAINT org_units_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.positions ADD CONSTRAINT positions_org_unit_id_fk FOREIGN KEY (org_unit_id) REFERENCES portal.org_units(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.positions ADD CONSTRAINT positions_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.employees ADD CONSTRAINT employees_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.employee_placements ADD CONSTRAINT employee_placements_employee_id_fk FOREIGN KEY (employee_id) REFERENCES portal.employees(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.employee_placements ADD CONSTRAINT employee_placements_position_id_fk FOREIGN KEY (position_id) REFERENCES portal.positions(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.employee_placements ADD CONSTRAINT employee_placements_supervisor_employee_id_fk FOREIGN KEY (supervisor_employee_id) REFERENCES portal.employees(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.employee_placements ADD CONSTRAINT employee_placements_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.user_role_units ADD CONSTRAINT user_role_units_user_role_id_fk FOREIGN KEY (user_role_id) REFERENCES public.app_user_roles(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.user_role_units ADD CONSTRAINT user_role_units_org_unit_id_fk FOREIGN KEY (org_unit_id) REFERENCES portal.org_units(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.user_role_posts ADD CONSTRAINT user_role_posts_user_role_id_fk FOREIGN KEY (user_role_id) REFERENCES public.app_user_roles(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.user_role_posts ADD CONSTRAINT user_role_posts_post_id_fk FOREIGN KEY (post_id) REFERENCES portal.security_posts(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.password_reset_tokens ADD CONSTRAINT password_reset_tokens_user_id_fk FOREIGN KEY (user_id) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.password_reset_tokens ADD CONSTRAINT password_reset_tokens_issued_by_fk FOREIGN KEY (issued_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.audit_events ADD CONSTRAINT audit_events_actor_user_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.files ADD CONSTRAINT files_uploaded_by_fk FOREIGN KEY (uploaded_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.employee_contracts ADD CONSTRAINT employee_contracts_employee_id_fk FOREIGN KEY (employee_id) REFERENCES portal.employees(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.employee_contracts ADD CONSTRAINT employee_contracts_file_id_fk FOREIGN KEY (file_id) REFERENCES portal.files(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.employee_contracts ADD CONSTRAINT employee_contracts_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.employee_files ADD CONSTRAINT employee_files_employee_id_fk FOREIGN KEY (employee_id) REFERENCES portal.employees(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.employee_files ADD CONSTRAINT employee_files_file_id_fk FOREIGN KEY (file_id) REFERENCES portal.files(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.employee_files ADD CONSTRAINT employee_files_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.documents ADD CONSTRAINT documents_owner_org_unit_id_fk FOREIGN KEY (owner_org_unit_id) REFERENCES portal.org_units(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.documents ADD CONSTRAINT documents_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.document_versions ADD CONSTRAINT document_versions_document_id_fk FOREIGN KEY (document_id) REFERENCES portal.documents(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.document_versions ADD CONSTRAINT document_versions_file_id_fk FOREIGN KEY (file_id) REFERENCES portal.files(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.document_versions ADD CONSTRAINT document_versions_activated_by_fk FOREIGN KEY (activated_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.document_versions ADD CONSTRAINT document_versions_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.document_target_units ADD CONSTRAINT document_target_units_document_id_fk FOREIGN KEY (document_id) REFERENCES portal.documents(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.document_target_units ADD CONSTRAINT document_target_units_org_unit_id_fk FOREIGN KEY (org_unit_id) REFERENCES portal.org_units(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.training_events ADD CONSTRAINT training_events_organizer_org_unit_id_fk FOREIGN KEY (organizer_org_unit_id) REFERENCES portal.org_units(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.training_events ADD CONSTRAINT training_events_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.training_participants ADD CONSTRAINT training_participants_training_event_id_fk FOREIGN KEY (training_event_id) REFERENCES portal.training_events(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.training_participants ADD CONSTRAINT training_participants_employee_id_fk FOREIGN KEY (employee_id) REFERENCES portal.employees(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.training_participants ADD CONSTRAINT training_participants_attendance_recorded_by_fk FOREIGN KEY (attendance_recorded_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.training_participants ADD CONSTRAINT training_participants_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.training_materials ADD CONSTRAINT training_materials_training_event_id_fk FOREIGN KEY (training_event_id) REFERENCES portal.training_events(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.training_materials ADD CONSTRAINT training_materials_file_id_fk FOREIGN KEY (file_id) REFERENCES portal.files(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.training_materials ADD CONSTRAINT training_materials_document_version_id_fk FOREIGN KEY (document_version_id) REFERENCES portal.document_versions(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.training_materials ADD CONSTRAINT training_materials_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.participant_certificates ADD CONSTRAINT participant_certificates_training_participant_id_fk FOREIGN KEY (training_participant_id) REFERENCES portal.training_participants(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.participant_certificates ADD CONSTRAINT participant_certificates_file_id_fk FOREIGN KEY (file_id) REFERENCES portal.files(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.participant_certificates ADD CONSTRAINT participant_certificates_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.coaching_sessions ADD CONSTRAINT coaching_sessions_employee_id_fk FOREIGN KEY (employee_id) REFERENCES portal.employees(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.coaching_sessions ADD CONSTRAINT coaching_sessions_coach_employee_id_fk FOREIGN KEY (coach_employee_id) REFERENCES portal.employees(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.coaching_sessions ADD CONSTRAINT coaching_sessions_org_unit_id_fk FOREIGN KEY (org_unit_id) REFERENCES portal.org_units(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.coaching_sessions ADD CONSTRAINT coaching_sessions_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.coaching_actions ADD CONSTRAINT coaching_actions_coaching_session_id_fk FOREIGN KEY (coaching_session_id) REFERENCES portal.coaching_sessions(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.coaching_actions ADD CONSTRAINT coaching_actions_responsible_employee_id_fk FOREIGN KEY (responsible_employee_id) REFERENCES portal.employees(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.coaching_actions ADD CONSTRAINT coaching_actions_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.security_groups ADD CONSTRAINT security_groups_org_unit_id_fk FOREIGN KEY (org_unit_id) REFERENCES portal.org_units(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.security_groups ADD CONSTRAINT security_groups_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.security_posts ADD CONSTRAINT security_posts_org_unit_id_fk FOREIGN KEY (org_unit_id) REFERENCES portal.org_units(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.security_posts ADD CONSTRAINT security_posts_home_group_id_fk FOREIGN KEY (home_group_id) REFERENCES portal.security_groups(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.security_posts ADD CONSTRAINT security_posts_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.security_group_members ADD CONSTRAINT security_group_members_security_group_id_fk FOREIGN KEY (security_group_id) REFERENCES portal.security_groups(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.security_group_members ADD CONSTRAINT security_group_members_employee_id_fk FOREIGN KEY (employee_id) REFERENCES portal.employees(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.security_group_members ADD CONSTRAINT security_group_members_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.shift_definitions ADD CONSTRAINT shift_definitions_org_unit_id_fk FOREIGN KEY (org_unit_id) REFERENCES portal.org_units(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.shift_definitions ADD CONSTRAINT shift_definitions_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.employee_post_eligibility ADD CONSTRAINT employee_post_eligibility_employee_id_fk FOREIGN KEY (employee_id) REFERENCES portal.employees(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.employee_post_eligibility ADD CONSTRAINT employee_post_eligibility_post_id_fk FOREIGN KEY (post_id) REFERENCES portal.security_posts(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.employee_post_eligibility ADD CONSTRAINT employee_post_eligibility_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.employee_unavailability ADD CONSTRAINT employee_unavailability_employee_id_fk FOREIGN KEY (employee_id) REFERENCES portal.employees(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.employee_unavailability ADD CONSTRAINT employee_unavailability_recorded_by_fk FOREIGN KEY (recorded_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.employee_unavailability ADD CONSTRAINT employee_unavailability_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.scheduling_rule_versions ADD CONSTRAINT scheduling_rule_versions_org_unit_id_fk FOREIGN KEY (org_unit_id) REFERENCES portal.org_units(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.scheduling_rule_versions ADD CONSTRAINT scheduling_rule_versions_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_pattern_versions ADD CONSTRAINT roster_pattern_versions_org_unit_id_fk FOREIGN KEY (org_unit_id) REFERENCES portal.org_units(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_pattern_versions ADD CONSTRAINT roster_pattern_versions_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_pattern_steps ADD CONSTRAINT roster_pattern_steps_pattern_version_id_fk FOREIGN KEY (pattern_version_id) REFERENCES portal.roster_pattern_versions(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_pattern_steps ADD CONSTRAINT roster_pattern_steps_shift_id_fk FOREIGN KEY (shift_id) REFERENCES portal.shift_definitions(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_pattern_steps ADD CONSTRAINT roster_pattern_steps_post_id_fk FOREIGN KEY (post_id) REFERENCES portal.security_posts(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_pattern_steps ADD CONSTRAINT roster_pattern_steps_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.employee_rotation_bindings ADD CONSTRAINT employee_rotation_bindings_employee_id_fk FOREIGN KEY (employee_id) REFERENCES portal.employees(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.employee_rotation_bindings ADD CONSTRAINT employee_rotation_bindings_pattern_version_id_fk FOREIGN KEY (pattern_version_id) REFERENCES portal.roster_pattern_versions(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.employee_rotation_bindings ADD CONSTRAINT employee_rotation_bindings_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.staffing_requirements ADD CONSTRAINT staffing_requirements_post_id_fk FOREIGN KEY (post_id) REFERENCES portal.security_posts(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.staffing_requirements ADD CONSTRAINT staffing_requirements_shift_id_fk FOREIGN KEY (shift_id) REFERENCES portal.shift_definitions(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.staffing_requirements ADD CONSTRAINT staffing_requirements_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.staffing_overrides ADD CONSTRAINT staffing_overrides_post_id_fk FOREIGN KEY (post_id) REFERENCES portal.security_posts(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.staffing_overrides ADD CONSTRAINT staffing_overrides_shift_id_fk FOREIGN KEY (shift_id) REFERENCES portal.shift_definitions(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.staffing_overrides ADD CONSTRAINT staffing_overrides_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.scheduling_periods ADD CONSTRAINT scheduling_periods_org_unit_id_fk FOREIGN KEY (org_unit_id) REFERENCES portal.org_units(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.scheduling_periods ADD CONSTRAINT scheduling_periods_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.scheduling_period_posts ADD CONSTRAINT scheduling_period_posts_scheduling_period_id_fk FOREIGN KEY (scheduling_period_id) REFERENCES portal.scheduling_periods(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.scheduling_period_posts ADD CONSTRAINT scheduling_period_posts_post_id_fk FOREIGN KEY (post_id) REFERENCES portal.security_posts(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_revisions ADD CONSTRAINT roster_revisions_scheduling_period_id_fk FOREIGN KEY (scheduling_period_id) REFERENCES portal.scheduling_periods(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_revisions ADD CONSTRAINT roster_revisions_rules_version_id_fk FOREIGN KEY (rules_version_id) REFERENCES portal.scheduling_rule_versions(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_revisions ADD CONSTRAINT roster_revisions_based_on_revision_id_fk FOREIGN KEY (based_on_revision_id) REFERENCES portal.roster_revisions(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_revisions ADD CONSTRAINT roster_revisions_published_by_fk FOREIGN KEY (published_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_revisions ADD CONSTRAINT roster_revisions_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.revision_rotation_bindings ADD CONSTRAINT revision_rotation_bindings_roster_revision_id_fk FOREIGN KEY (roster_revision_id) REFERENCES portal.roster_revisions(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.revision_rotation_bindings ADD CONSTRAINT revision_rotation_bindings_rotation_binding_id_fk FOREIGN KEY (rotation_binding_id) REFERENCES portal.employee_rotation_bindings(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.revision_rotation_bindings ADD CONSTRAINT revision_rotation_bindings_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_assignments ADD CONSTRAINT roster_assignments_roster_revision_id_fk FOREIGN KEY (roster_revision_id) REFERENCES portal.roster_revisions(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_assignments ADD CONSTRAINT roster_assignments_employee_id_fk FOREIGN KEY (employee_id) REFERENCES portal.employees(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_assignments ADD CONSTRAINT roster_assignments_post_id_fk FOREIGN KEY (post_id) REFERENCES portal.security_posts(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_assignments ADD CONSTRAINT roster_assignments_shift_id_fk FOREIGN KEY (shift_id) REFERENCES portal.shift_definitions(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_assignments ADD CONSTRAINT roster_assignments_revision_rotation_binding_id_fk FOREIGN KEY (revision_rotation_binding_id) REFERENCES portal.revision_rotation_bindings(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_assignments ADD CONSTRAINT roster_assignments_source_override_id_fk FOREIGN KEY (source_override_id) REFERENCES portal.staffing_overrides(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_assignments ADD CONSTRAINT roster_assignments_copied_from_assignment_id_fk FOREIGN KEY (copied_from_assignment_id) REFERENCES portal.roster_assignments(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_assignments ADD CONSTRAINT roster_assignments_locked_by_fk FOREIGN KEY (locked_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_assignments ADD CONSTRAINT roster_assignments_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_gaps ADD CONSTRAINT roster_gaps_roster_revision_id_fk FOREIGN KEY (roster_revision_id) REFERENCES portal.roster_revisions(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_gaps ADD CONSTRAINT roster_gaps_post_id_fk FOREIGN KEY (post_id) REFERENCES portal.security_posts(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_gaps ADD CONSTRAINT roster_gaps_shift_id_fk FOREIGN KEY (shift_id) REFERENCES portal.shift_definitions(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_gaps ADD CONSTRAINT roster_gaps_acknowledged_by_fk FOREIGN KEY (acknowledged_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.roster_gaps ADD CONSTRAINT roster_gaps_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.logbook_entries ADD CONSTRAINT logbook_entries_employee_id_fk FOREIGN KEY (employee_id) REFERENCES portal.employees(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.logbook_entries ADD CONSTRAINT logbook_entries_post_id_fk FOREIGN KEY (post_id) REFERENCES portal.security_posts(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.logbook_entries ADD CONSTRAINT logbook_entries_roster_assignment_id_fk FOREIGN KEY (roster_assignment_id) REFERENCES portal.roster_assignments(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.logbook_entries ADD CONSTRAINT logbook_entries_reporting_org_unit_id_fk FOREIGN KEY (reporting_org_unit_id) REFERENCES portal.org_units(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.logbook_entries ADD CONSTRAINT logbook_entries_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.logbook_files ADD CONSTRAINT logbook_files_logbook_entry_id_fk FOREIGN KEY (logbook_entry_id) REFERENCES portal.logbook_entries(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.logbook_files ADD CONSTRAINT logbook_files_file_id_fk FOREIGN KEY (file_id) REFERENCES portal.files(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.logbook_files ADD CONSTRAINT logbook_files_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.incidents ADD CONSTRAINT incidents_post_id_fk FOREIGN KEY (post_id) REFERENCES portal.security_posts(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.incidents ADD CONSTRAINT incidents_reporter_employee_id_fk FOREIGN KEY (reporter_employee_id) REFERENCES portal.employees(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.incidents ADD CONSTRAINT incidents_source_logbook_entry_id_fk FOREIGN KEY (source_logbook_entry_id) REFERENCES portal.logbook_entries(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.incidents ADD CONSTRAINT incidents_responsible_employee_id_fk FOREIGN KEY (responsible_employee_id) REFERENCES portal.employees(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.incidents ADD CONSTRAINT incidents_reporting_org_unit_id_fk FOREIGN KEY (reporting_org_unit_id) REFERENCES portal.org_units(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.incidents ADD CONSTRAINT incidents_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.incident_updates ADD CONSTRAINT incident_updates_incident_id_fk FOREIGN KEY (incident_id) REFERENCES portal.incidents(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.incident_updates ADD CONSTRAINT incident_updates_actor_user_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.incident_updates ADD CONSTRAINT incident_updates_new_responsible_employee_id_fk FOREIGN KEY (new_responsible_employee_id) REFERENCES portal.employees(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.incident_files ADD CONSTRAINT incident_files_incident_id_fk FOREIGN KEY (incident_id) REFERENCES portal.incidents(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.incident_files ADD CONSTRAINT incident_files_file_id_fk FOREIGN KEY (file_id) REFERENCES portal.files(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.incident_files ADD CONSTRAINT incident_files_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.import_candidates ADD CONSTRAINT import_candidates_employee_id_fk FOREIGN KEY (employee_id) REFERENCES portal.employees(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.announcements ADD CONSTRAINT announcements_published_by_fk FOREIGN KEY (published_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.announcements ADD CONSTRAINT announcements_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.announcement_files ADD CONSTRAINT announcement_files_announcement_id_fk FOREIGN KEY (announcement_id) REFERENCES portal.announcements(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.announcement_files ADD CONSTRAINT announcement_files_file_id_fk FOREIGN KEY (file_id) REFERENCES portal.files(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.announcement_files ADD CONSTRAINT announcement_files_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.announcement_reads ADD CONSTRAINT announcement_reads_announcement_id_fk FOREIGN KEY (announcement_id) REFERENCES portal.announcements(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE portal.announcement_reads ADD CONSTRAINT announcement_reads_user_id_fk FOREIGN KEY (user_id) REFERENCES public.app_users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN ALTER TABLE public.app_users ADD CONSTRAINT app_users_employee_id_fk FOREIGN KEY (employee_id) REFERENCES portal.employees(id); EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
CREATE INDEX IF NOT EXISTS placement_dates ON portal.employee_placements(employee_id,valid_from,valid_to);
CREATE UNIQUE INDEX IF NOT EXISTS single_active_document ON portal.document_versions(document_id) WHERE state='ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS single_published_roster ON portal.roster_revisions(scheduling_period_id) WHERE status='PUBLISHED';
CREATE INDEX IF NOT EXISTS employee_roster_time ON portal.roster_assignments(employee_id,starts_at,ends_at);
CREATE INDEX IF NOT EXISTS announcement_publication ON portal.announcements(status,starts_at,ends_at);
CREATE UNIQUE INDEX IF NOT EXISTS org_units_code_folded ON portal.org_units(lower(code));
CREATE UNIQUE INDEX IF NOT EXISTS positions_code_folded ON portal.positions(lower(code));
CREATE UNIQUE INDEX IF NOT EXISTS employees_employee_no_folded ON portal.employees(lower(employee_no));
CREATE UNIQUE INDEX IF NOT EXISTS documents_document_code_folded ON portal.documents(lower(document_code));
CREATE UNIQUE INDEX IF NOT EXISTS security_groups_code_folded ON portal.security_groups(lower(code));
CREATE UNIQUE INDEX IF NOT EXISTS security_posts_code_folded ON portal.security_posts(lower(code));
CREATE OR REPLACE VIEW portal.users AS SELECT id,username,employee_id,status,must_change_password::integer must_change_password,last_login_at,password_changed_at,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') created_at,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') updated_at,row_version::integer row_version,created_by FROM public.app_users;
CREATE OR REPLACE VIEW portal.roles AS SELECT id,code,name,description,is_system::integer is_system,is_active::integer is_active,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') created_at,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') updated_at,row_version::integer row_version,created_by FROM public.app_roles;
CREATE OR REPLACE VIEW portal.permissions AS SELECT id,code,module_code,resource,action,description,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') created_at,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') updated_at,row_version::integer row_version FROM public.app_permissions;
CREATE OR REPLACE VIEW portal.user_roles AS SELECT id,user_id,role_id,scope_kind,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') created_at,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') updated_at,row_version::integer row_version FROM public.app_user_roles;
CREATE OR REPLACE VIEW portal.role_permissions AS SELECT role_id,permission_id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') created_at FROM public.app_role_permissions;
CREATE OR REPLACE FUNCTION portal.write_identity_view() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $view$
DECLARE target text; data jsonb; cols text; assignments text; predicate text;
BEGIN
 IF TG_TABLE_SCHEMA<>'portal' THEN RAISE EXCEPTION 'Invalid view'; END IF;
 target:=CASE TG_TABLE_NAME WHEN 'users' THEN 'app_users' WHEN 'roles' THEN 'app_roles' WHEN 'permissions' THEN 'app_permissions' WHEN 'user_roles' THEN 'app_user_roles' WHEN 'role_permissions' THEN 'app_role_permissions' END;
 IF target IS NULL THEN RAISE EXCEPTION 'Invalid view'; END IF;
 data:=to_jsonb(CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END);
 IF TG_TABLE_NAME='users' THEN data:=jsonb_set(data,'{must_change_password}',to_jsonb((data->>'must_change_password')::integer<>0)); END IF;
 IF TG_TABLE_NAME='roles' THEN data:=jsonb_set(jsonb_set(data,'{is_active}',to_jsonb((data->>'is_active')::integer<>0)),'{is_system}',to_jsonb((data->>'is_system')::integer<>0)); END IF;
 predicate:=CASE WHEN TG_TABLE_NAME='role_permissions' THEN 't.role_id=r.role_id AND t.permission_id=r.permission_id' ELSE 't.id=r.id' END;
 IF TG_OP='INSERT' THEN
  SELECT string_agg(format('%I',key),',') INTO cols FROM jsonb_each(data) WHERE value<>'null'::jsonb;
  EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I,$1)',target,cols,cols,target) USING data;
 ELSIF TG_OP='UPDATE' THEN
  SELECT string_agg(format('%I=r.%I',key,key),',') INTO assignments FROM jsonb_each(data) WHERE key<>'id';
  EXECUTE format('UPDATE public.%I t SET %s FROM jsonb_populate_record(NULL::public.%I,$1) r WHERE %s',target,assignments,target,predicate) USING data;
 ELSE
  EXECUTE format('DELETE FROM public.%I t USING jsonb_populate_record(NULL::public.%I,$1) r WHERE %s',target,target,predicate) USING data;
  RETURN OLD;
 END IF;
 RETURN NEW;
END $view$;
DROP TRIGGER IF EXISTS write_identity ON portal.users;
CREATE TRIGGER write_identity INSTEAD OF INSERT OR UPDATE OR DELETE ON portal.users FOR EACH ROW EXECUTE FUNCTION portal.write_identity_view();
DROP TRIGGER IF EXISTS write_identity ON portal.roles;
CREATE TRIGGER write_identity INSTEAD OF INSERT OR UPDATE OR DELETE ON portal.roles FOR EACH ROW EXECUTE FUNCTION portal.write_identity_view();
DROP TRIGGER IF EXISTS write_identity ON portal.permissions;
CREATE TRIGGER write_identity INSTEAD OF INSERT OR UPDATE OR DELETE ON portal.permissions FOR EACH ROW EXECUTE FUNCTION portal.write_identity_view();
DROP TRIGGER IF EXISTS write_identity ON portal.user_roles;
CREATE TRIGGER write_identity INSTEAD OF INSERT OR UPDATE OR DELETE ON portal.user_roles FOR EACH ROW EXECUTE FUNCTION portal.write_identity_view();
DROP TRIGGER IF EXISTS write_identity ON portal.role_permissions;
CREATE TRIGGER write_identity INSTEAD OF INSERT OR UPDATE OR DELETE ON portal.role_permissions FOR EACH ROW EXECUTE FUNCTION portal.write_identity_view();
CREATE OR REPLACE FUNCTION portal.reject_history_change() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $history$ BEGIN RAISE EXCEPTION 'History append-only' USING ERRCODE='23514'; END $history$;
DROP TRIGGER IF EXISTS append_only ON portal.audit_events;
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON portal.audit_events FOR EACH ROW EXECUTE FUNCTION portal.reject_history_change();
DROP TRIGGER IF EXISTS append_only ON portal.incident_updates;
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON portal.incident_updates FOR EACH ROW EXECUTE FUNCTION portal.reject_history_change();
ALTER TABLE portal.org_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.employee_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.user_role_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.user_role_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.employee_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.employee_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.document_target_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.training_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.training_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.training_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.participant_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.coaching_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.coaching_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.security_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.security_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.security_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.shift_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.employee_post_eligibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.employee_unavailability ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.scheduling_rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.roster_pattern_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.roster_pattern_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.employee_rotation_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.staffing_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.staffing_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.scheduling_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.scheduling_period_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.roster_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.revision_rotation_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.roster_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.roster_gaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.logbook_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.logbook_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.incident_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.incident_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.import_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.announcement_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.announcement_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA portal FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA portal FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA portal REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA portal REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO portal.app_settings VALUES('allow_gap_publication','false'),('demo_mode','false') ON CONFLICT DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('hr.employees.read','hr','hr.employees','read') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('hr.employees.create','hr','hr.employees','create') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('hr.employees.update','hr','hr.employees','update') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('hr.employees.export','hr','hr.employees','export') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('hr.organization.read','hr','hr.organization','read') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('hr.organization.manage','hr','hr.organization','manage') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('hr.employee_files.read','hr','hr.employee_files','read') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('hr.employee_files.manage','hr','hr.employee_files','manage') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('hr.documents.read','hr','hr.documents','read') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('hr.documents.manage','hr','hr.documents','manage') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('hr.documents.publish','hr','hr.documents','publish') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('hr.documents.download','hr','hr.documents','download') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('hr.training.read','hr','hr.training','read') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('hr.training.manage','hr','hr.training','manage') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('hr.training.participants','hr','hr.training','participants') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('hr.training.download','hr','hr.training','download') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('hr.coaching.read','hr','hr.coaching','read') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('hr.coaching.create','hr','hr.coaching','create') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('hr.coaching.update','hr','hr.coaching','update') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('hr.coaching.manage','hr','hr.coaching','manage') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('security.config.read','security','security.config','read') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('security.config.manage','security','security.config','manage') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('security.roster.read','security','security.roster','read') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('security.roster.generate','security','security.roster','generate') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('security.roster.edit','security','security.roster','edit') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('security.roster.publish','security','security.roster','publish') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('security.roster.acknowledge','security','security.roster','acknowledge') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('security.roster.export','security','security.roster','export') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('security.logbook.read','security','security.logbook','read') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('security.logbook.create','security','security.logbook','create') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('security.logbook.update','security','security.logbook','update') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('security.logbook.download','security','security.logbook','download') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('security.incidents.read','security','security.incidents','read') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('security.incidents.create','security','security.incidents','create') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('security.incidents.update','security','security.incidents','update') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('security.incidents.reopen','security','security.incidents','reopen') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('security.incidents.download','security','security.incidents','download') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('admin.users.read','admin','admin.users','read') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('admin.users.manage','admin','admin.users','manage') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('admin.users.reset','admin','admin.users','reset') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('admin.roles.read','admin','admin.roles','read') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('admin.roles.manage','admin','admin.roles','manage') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('admin.audit.read','admin','admin.audit','read') ON CONFLICT(code) DO NOTHING;
WITH added AS (INSERT INTO public.app_roles(code,name) VALUES('SDM','Pengelola SDM') ON CONFLICT(code) DO NOTHING RETURNING id) INSERT INTO public.app_role_permissions(role_id,permission_id) SELECT a.id,p.id FROM added a CROSS JOIN public.app_permissions p WHERE code LIKE 'hr.%' ON CONFLICT DO NOTHING;
WITH added AS (INSERT INTO public.app_roles(code,name) VALUES('COORDINATOR','Koordinator Keamanan') ON CONFLICT(code) DO NOTHING RETURNING id) INSERT INTO public.app_role_permissions(role_id,permission_id) SELECT a.id,p.id FROM added a CROSS JOIN public.app_permissions p WHERE code LIKE 'security.%' OR code IN ('hr.documents.read','hr.documents.download') ON CONFLICT DO NOTHING;
WITH added AS (INSERT INTO public.app_roles(code,name) VALUES('OFFICER','Petugas Keamanan') ON CONFLICT(code) DO NOTHING RETURNING id) INSERT INTO public.app_role_permissions(role_id,permission_id) SELECT a.id,p.id FROM added a CROSS JOIN public.app_permissions p WHERE code IN ('security.roster.read','security.logbook.read','security.logbook.create','security.logbook.download','security.incidents.read','security.incidents.create','security.incidents.download','hr.documents.read','hr.documents.download') ON CONFLICT DO NOTHING;
WITH added AS (INSERT INTO public.app_roles(code,name) VALUES('EMPLOYEE','Pegawai') ON CONFLICT(code) DO NOTHING RETURNING id) INSERT INTO public.app_role_permissions(role_id,permission_id) SELECT a.id,p.id FROM added a CROSS JOIN public.app_permissions p WHERE code IN ('hr.employees.read','hr.training.read','hr.training.download','hr.coaching.read','hr.coaching.update','hr.documents.read','hr.documents.download') ON CONFLICT DO NOTHING;
INSERT INTO portal.import_candidates(id,full_name,position_name,org_path,source_cell,source_name,status,notes,created_at,updated_at,row_version)
 SELECT i.id::text,i.full_name,coalesce((SELECT string_agg(p->>'name','; ' ORDER BY p->>'name') FROM jsonb_array_elements(i.positions) p),'Belum ditetapkan'),
 coalesce((SELECT string_agg(p->>'org_path','; ' ORDER BY p->>'org_path') FROM jsonb_array_elements(i.positions) p),'Belum ditetapkan'),
 (SELECT string_agg(c,'; ' ORDER BY c) FROM jsonb_array_elements_text(i.source_cells) c),i.source_name,'PENDING',i.notes,
 to_char(i.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),1
 FROM import_staging.employee_candidates i WHERE i.status='PENDING' ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT count(*) AS operational_tables FROM pg_catalog.pg_tables WHERE schemaname='portal';
