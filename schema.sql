CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
INSERT OR IGNORE INTO schema_migrations VALUES (1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE IF NOT EXISTS org_units (
 id TEXT PRIMARY KEY, code TEXT NOT NULL COLLATE NOCASE UNIQUE, name TEXT NOT NULL, parent_id TEXT REFERENCES org_units(id), is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), CHECK(parent_id IS NULL OR parent_id<>id));
CREATE TABLE IF NOT EXISTS positions (
 id TEXT PRIMARY KEY, org_unit_id TEXT NOT NULL REFERENCES org_units(id), code TEXT NOT NULL COLLATE NOCASE UNIQUE, name TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS employees (
 id TEXT PRIMARY KEY, employee_no TEXT NOT NULL COLLATE NOCASE UNIQUE, full_name TEXT NOT NULL, employment_status TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
 joined_on TEXT NOT NULL, ended_on TEXT, phone TEXT, email TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), CHECK(ended_on IS NULL OR ended_on>=joined_on));
CREATE TABLE IF NOT EXISTS employee_placements (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), position_id TEXT NOT NULL REFERENCES positions(id), supervisor_employee_id TEXT REFERENCES employees(id), valid_from TEXT NOT NULL, valid_to TEXT, is_primary INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), CHECK(valid_to IS NULL OR valid_to>=valid_from), CHECK(supervisor_employee_id IS NULL OR supervisor_employee_id<>employee_id));
CREATE INDEX IF NOT EXISTS placement_dates ON employee_placements(employee_id,valid_from,valid_to);
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL, employee_id TEXT UNIQUE REFERENCES employees(id), status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','INACTIVE','LOCKED')), must_change_password INTEGER NOT NULL DEFAULT 1, failed_login_count INTEGER NOT NULL DEFAULT 0,
 password_changed_at TEXT NOT NULL, locked_until TEXT, last_login_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS roles (
 id TEXT PRIMARY KEY, code TEXT NOT NULL COLLATE NOCASE UNIQUE, name TEXT NOT NULL, description TEXT, is_system INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS permissions (
 id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, module_code TEXT NOT NULL, resource TEXT NOT NULL, action TEXT NOT NULL, description TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS user_roles (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), role_id TEXT NOT NULL REFERENCES roles(id), scope_kind TEXT NOT NULL CHECK(scope_kind IN('SELF','ASSIGNED_UNITS','ASSIGNED_POSTS','ALL')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, UNIQUE(user_id,role_id,scope_kind));
CREATE TABLE IF NOT EXISTS user_role_units (created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), user_role_id TEXT NOT NULL REFERENCES user_roles(id) ON DELETE CASCADE, org_unit_id TEXT NOT NULL REFERENCES org_units(id), include_descendants INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_role_id,org_unit_id));
CREATE TABLE IF NOT EXISTS user_role_posts (created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), user_role_id TEXT NOT NULL REFERENCES user_roles(id) ON DELETE CASCADE, post_id TEXT NOT NULL REFERENCES security_posts(id), PRIMARY KEY(user_role_id,post_id));
CREATE TABLE IF NOT EXISTS role_permissions (created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE, permission_id TEXT NOT NULL REFERENCES permissions(id), PRIMARY KEY(role_id,permission_id));
CREATE TABLE IF NOT EXISTS auth_sessions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token_hash TEXT NOT NULL UNIQUE, csrf_hash TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, revoked_at TEXT, ip_address TEXT, user_agent TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS password_reset_tokens (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, issued_by TEXT NOT NULL REFERENCES users(id), consumed_at TEXT, revoked_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit_events (
 id TEXT PRIMARY KEY, actor_user_id TEXT REFERENCES users(id), action TEXT NOT NULL, object_type TEXT NOT NULL, object_key TEXT NOT NULL, occurred_at TEXT NOT NULL, outcome TEXT NOT NULL, request_id TEXT NOT NULL, reason TEXT, change_summary TEXT, ip_address TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'Audit append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'Audit append-only'); END;
CREATE TABLE IF NOT EXISTS files (
 id TEXT PRIMARY KEY, storage_key TEXT NOT NULL UNIQUE, original_name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL CHECK(size_bytes>0), checksum TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN('AVAILABLE','QUARANTINED','ARCHIVED')), uploaded_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS employee_contracts (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), contract_no TEXT NOT NULL UNIQUE, starts_on TEXT NOT NULL, ends_on TEXT, file_id TEXT REFERENCES files(id), notes TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), CHECK(ends_on IS NULL OR ends_on>=starts_on));
CREATE TABLE IF NOT EXISTS employee_files (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), file_id TEXT NOT NULL REFERENCES files(id), category TEXT NOT NULL, title TEXT NOT NULL, notes TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), UNIQUE(employee_id,file_id));
CREATE TABLE IF NOT EXISTS documents (
 id TEXT PRIMARY KEY, document_code TEXT NOT NULL COLLATE NOCASE UNIQUE, title TEXT NOT NULL, category TEXT NOT NULL, owner_org_unit_id TEXT NOT NULL REFERENCES org_units(id), audience_kind TEXT NOT NULL DEFAULT 'ALL_UNITS' CHECK(audience_kind IN('ALL_UNITS','SELECTED_UNITS')), is_archived INTEGER NOT NULL DEFAULT 0, description TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS document_versions (
 id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id), file_id TEXT NOT NULL REFERENCES files(id), version_label TEXT NOT NULL, effective_on TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','ACTIVE','ARCHIVED')), change_notes TEXT, activated_by TEXT REFERENCES users(id), activated_at TEXT, archived_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), UNIQUE(document_id,version_label));
CREATE UNIQUE INDEX IF NOT EXISTS single_active_document ON document_versions(document_id) WHERE state='ACTIVE';
CREATE TABLE IF NOT EXISTS document_target_units (created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), document_id TEXT NOT NULL REFERENCES documents(id), org_unit_id TEXT NOT NULL REFERENCES org_units(id), PRIMARY KEY(document_id,org_unit_id));
CREATE TABLE IF NOT EXISTS training_events (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, topic TEXT NOT NULL, organizer_org_unit_id TEXT NOT NULL REFERENCES org_units(id), starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PLANNED' CHECK(status IN('PLANNED','COMPLETED','CANCELLED')), organizer_name TEXT, location TEXT, description TEXT, deleted_at TEXT, deleted_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), CHECK(ends_at>starts_at));
CREATE TABLE IF NOT EXISTS training_participants (
 id TEXT PRIMARY KEY, training_event_id TEXT NOT NULL REFERENCES training_events(id), employee_id TEXT NOT NULL REFERENCES employees(id), attendance_status TEXT NOT NULL DEFAULT 'NOT_RECORDED' CHECK(attendance_status IN('NOT_RECORDED','PRESENT','ABSENT')), attendance_notes TEXT, attendance_recorded_by TEXT REFERENCES users(id), attendance_recorded_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), UNIQUE(training_event_id,employee_id));
CREATE TABLE IF NOT EXISTS training_materials (
 id TEXT PRIMARY KEY, training_event_id TEXT NOT NULL REFERENCES training_events(id), title TEXT NOT NULL, file_id TEXT REFERENCES files(id), document_version_id TEXT REFERENCES document_versions(id), usage_kind TEXT NOT NULL DEFAULT 'MATERIAL' CHECK(usage_kind IN('MATERIAL','DOCUMENTATION') AND (usage_kind='MATERIAL' OR file_id IS NOT NULL)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), CHECK((file_id IS NULL)<>(document_version_id IS NULL)));
CREATE TABLE IF NOT EXISTS participant_certificates (
 id TEXT PRIMARY KEY, training_participant_id TEXT NOT NULL REFERENCES training_participants(id), file_id TEXT NOT NULL REFERENCES files(id), certificate_no TEXT, issued_on TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), UNIQUE(training_participant_id,file_id));
CREATE TABLE IF NOT EXISTS coaching_sessions (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), coach_employee_id TEXT NOT NULL REFERENCES employees(id), org_unit_id TEXT NOT NULL REFERENCES org_units(id), held_at TEXT NOT NULL, topic TEXT NOT NULL, guidance_notes TEXT NOT NULL, constraints_notes TEXT, agreement_notes TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), CHECK(employee_id<>coach_employee_id));
CREATE TABLE IF NOT EXISTS coaching_actions (
 id TEXT PRIMARY KEY, coaching_session_id TEXT NOT NULL REFERENCES coaching_sessions(id), responsible_employee_id TEXT NOT NULL REFERENCES employees(id), action_text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','IN_PROGRESS','DONE')), due_on TEXT, progress_notes TEXT, completion_notes TEXT, completed_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), CHECK((status='DONE' AND completed_at IS NOT NULL AND length(trim(completion_notes))>0) OR (status<>'DONE' AND completed_at IS NULL)));
CREATE TABLE IF NOT EXISTS security_groups (
 id TEXT PRIMARY KEY, org_unit_id TEXT NOT NULL REFERENCES org_units(id), code TEXT NOT NULL COLLATE NOCASE UNIQUE, name TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS security_posts (
 id TEXT PRIMARY KEY, org_unit_id TEXT NOT NULL REFERENCES org_units(id), home_group_id TEXT REFERENCES security_groups(id), code TEXT NOT NULL COLLATE NOCASE UNIQUE, name TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, location_notes TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS security_group_members (
 id TEXT PRIMARY KEY, security_group_id TEXT NOT NULL REFERENCES security_groups(id), employee_id TEXT NOT NULL REFERENCES employees(id), valid_from TEXT NOT NULL, valid_to TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), UNIQUE(security_group_id,employee_id,valid_from), CHECK(valid_to IS NULL OR valid_to>=valid_from));
CREATE TABLE IF NOT EXISTS shift_definitions (
 id TEXT PRIMARY KEY, org_unit_id TEXT NOT NULL REFERENCES org_units(id), code TEXT NOT NULL, name TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, end_day_offset INTEGER NOT NULL CHECK(end_day_offset IN(0,1)), is_active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), UNIQUE(org_unit_id,code));
CREATE TABLE IF NOT EXISTS employee_post_eligibility (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), post_id TEXT NOT NULL REFERENCES security_posts(id), valid_from TEXT NOT NULL, valid_to TEXT, notes TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), UNIQUE(employee_id,post_id,valid_from), CHECK(valid_to IS NULL OR valid_to>=valid_from));
CREATE TABLE IF NOT EXISTS employee_unavailability (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, reason TEXT NOT NULL, recorded_by TEXT NOT NULL REFERENCES users(id), notes TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), CHECK(ends_at>starts_at));
CREATE TABLE IF NOT EXISTS scheduling_rule_versions (
 id TEXT PRIMARY KEY, org_unit_id TEXT NOT NULL REFERENCES org_units(id), version_no INTEGER NOT NULL, min_rest_minutes INTEGER NOT NULL CHECK(min_rest_minutes>0), max_consecutive_work_days INTEGER NOT NULL CHECK(max_consecutive_work_days>0), max_work_minutes_per_local_day INTEGER NOT NULL CHECK(max_work_minutes_per_local_day>0), max_work_minutes_rolling_7_days INTEGER NOT NULL CHECK(max_work_minutes_rolling_7_days>0), is_active INTEGER NOT NULL DEFAULT 1, notes TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), UNIQUE(org_unit_id,version_no));
CREATE TABLE IF NOT EXISTS roster_pattern_versions (
 id TEXT PRIMARY KEY, org_unit_id TEXT NOT NULL REFERENCES org_units(id), pattern_code TEXT NOT NULL, version_no INTEGER NOT NULL, name TEXT NOT NULL, cycle_length_days INTEGER NOT NULL CHECK(cycle_length_days>0), is_active INTEGER NOT NULL DEFAULT 1, notes TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), UNIQUE(org_unit_id,pattern_code,version_no));
CREATE TABLE IF NOT EXISTS roster_pattern_steps (
 id TEXT PRIMARY KEY, pattern_version_id TEXT NOT NULL REFERENCES roster_pattern_versions(id), cycle_day_no INTEGER NOT NULL, step_kind TEXT NOT NULL CHECK(step_kind IN('WORK','REST')), shift_id TEXT REFERENCES shift_definitions(id), post_id TEXT REFERENCES security_posts(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), UNIQUE(pattern_version_id,cycle_day_no), CHECK((step_kind='REST' AND shift_id IS NULL AND post_id IS NULL) OR (step_kind='WORK' AND shift_id IS NOT NULL)));
CREATE TABLE IF NOT EXISTS employee_rotation_bindings (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), pattern_version_id TEXT NOT NULL REFERENCES roster_pattern_versions(id), anchor_date TEXT NOT NULL, phase_offset_days INTEGER NOT NULL CHECK(phase_offset_days>=0), effective_from TEXT NOT NULL, notes TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), UNIQUE(employee_id,effective_from));
CREATE TABLE IF NOT EXISTS staffing_requirements (
 id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES security_posts(id), shift_id TEXT NOT NULL REFERENCES shift_definitions(id), weekday_no INTEGER NOT NULL CHECK(weekday_no BETWEEN 1 AND 7), required_count INTEGER NOT NULL CHECK(required_count>=0), effective_from TEXT NOT NULL, effective_to TEXT, is_active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), CHECK(effective_to IS NULL OR effective_to>=effective_from));
CREATE TABLE IF NOT EXISTS staffing_overrides (
 id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES security_posts(id), shift_id TEXT NOT NULL REFERENCES shift_definitions(id), starts_on TEXT NOT NULL, ends_on TEXT NOT NULL, replacement_required_count INTEGER NOT NULL CHECK(replacement_required_count>=0), reason TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), CHECK(ends_on>=starts_on));
CREATE TABLE IF NOT EXISTS scheduling_periods (
 id TEXT PRIMARY KEY, org_unit_id TEXT NOT NULL REFERENCES org_units(id), starts_on TEXT NOT NULL, ends_on TEXT NOT NULL, is_archived INTEGER NOT NULL DEFAULT 0, name TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), CHECK(ends_on>=starts_on));
CREATE TABLE IF NOT EXISTS scheduling_period_posts (created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), scheduling_period_id TEXT NOT NULL REFERENCES scheduling_periods(id), post_id TEXT NOT NULL REFERENCES security_posts(id), PRIMARY KEY(scheduling_period_id,post_id));
CREATE TABLE IF NOT EXISTS roster_revisions (
 id TEXT PRIMARY KEY, scheduling_period_id TEXT NOT NULL REFERENCES scheduling_periods(id), revision_no INTEGER NOT NULL, rules_version_id TEXT NOT NULL REFERENCES scheduling_rule_versions(id), status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','PUBLISHED','SUPERSEDED')), input_snapshot TEXT NOT NULL, input_hash TEXT NOT NULL, generator_version TEXT NOT NULL, generator_seed TEXT NOT NULL, based_on_revision_id TEXT REFERENCES roster_revisions(id), published_by TEXT REFERENCES users(id), published_at TEXT, superseded_at TEXT, validation_report TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), UNIQUE(scheduling_period_id,revision_no));
CREATE UNIQUE INDEX IF NOT EXISTS single_published_roster ON roster_revisions(scheduling_period_id) WHERE status='PUBLISHED';
CREATE TABLE IF NOT EXISTS revision_rotation_bindings (
 id TEXT PRIMARY KEY, roster_revision_id TEXT NOT NULL REFERENCES roster_revisions(id), rotation_binding_id TEXT NOT NULL REFERENCES employee_rotation_bindings(id), applies_from TEXT NOT NULL, applies_to TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), UNIQUE(roster_revision_id,rotation_binding_id,applies_from));
CREATE TABLE IF NOT EXISTS roster_assignments (
 id TEXT PRIMARY KEY, roster_revision_id TEXT NOT NULL REFERENCES roster_revisions(id), employee_id TEXT NOT NULL REFERENCES employees(id), post_id TEXT NOT NULL REFERENCES security_posts(id), shift_id TEXT NOT NULL REFERENCES shift_definitions(id), service_date TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, origin TEXT NOT NULL CHECK(origin IN('ROUTINE','TEMPORARY','MANUAL')), is_locked INTEGER NOT NULL DEFAULT 0, display_snapshot TEXT NOT NULL, revision_rotation_binding_id TEXT REFERENCES revision_rotation_bindings(id), source_override_id TEXT REFERENCES staffing_overrides(id), copied_from_assignment_id TEXT REFERENCES roster_assignments(id), locked_by TEXT REFERENCES users(id), locked_at TEXT, manual_change_reason TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), CHECK(ends_at>starts_at));
CREATE INDEX IF NOT EXISTS employee_roster_time ON roster_assignments(employee_id,starts_at,ends_at);
CREATE TABLE IF NOT EXISTS roster_gaps (
 id TEXT PRIMARY KEY, roster_revision_id TEXT NOT NULL REFERENCES roster_revisions(id), post_id TEXT NOT NULL REFERENCES security_posts(id), shift_id TEXT NOT NULL REFERENCES shift_definitions(id), service_date TEXT NOT NULL, required_count INTEGER NOT NULL, assigned_count INTEGER NOT NULL, acknowledged_by TEXT REFERENCES users(id), acknowledged_at TEXT, acknowledgment_reason TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), UNIQUE(roster_revision_id,post_id,shift_id,service_date), CHECK(required_count>assigned_count AND assigned_count>=0));
CREATE TABLE IF NOT EXISTS logbook_entries (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), post_id TEXT REFERENCES security_posts(id), occurred_at TEXT NOT NULL, activity_type TEXT NOT NULL CHECK(activity_type IN('JAGA','PATROLI','LAINNYA')), activity_notes TEXT NOT NULL, findings TEXT, roster_assignment_id TEXT REFERENCES roster_assignments(id),
 reporting_org_unit_id TEXT REFERENCES org_units(id), latitude REAL, longitude REAL, location_accuracy REAL, location_captured_at TEXT, idempotency_key TEXT UNIQUE, request_fingerprint TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS logbook_files (
 id TEXT PRIMARY KEY, logbook_entry_id TEXT NOT NULL REFERENCES logbook_entries(id), file_id TEXT NOT NULL REFERENCES files(id), caption TEXT, captured_at TEXT, capture_source TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), UNIQUE(logbook_entry_id,file_id));
CREATE TABLE IF NOT EXISTS incidents (
 id TEXT PRIMARY KEY, incident_no TEXT NOT NULL UNIQUE, idempotency_key TEXT NOT NULL UNIQUE, post_id TEXT REFERENCES security_posts(id), reporter_employee_id TEXT NOT NULL REFERENCES employees(id), occurred_at TEXT NOT NULL, incident_type TEXT NOT NULL, chronology TEXT NOT NULL, initial_action TEXT, status TEXT NOT NULL DEFAULT 'RECORDED' CHECK(status IN('RECORDED','IN_PROGRESS','RESOLVED')), source_logbook_entry_id TEXT REFERENCES logbook_entries(id), responsible_employee_id TEXT REFERENCES employees(id), resolved_at TEXT, resolution_notes TEXT,
 reporting_org_unit_id TEXT REFERENCES org_units(id), latitude REAL, longitude REAL, location_accuracy REAL, location_captured_at TEXT, request_fingerprint TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS incident_updates (
 id TEXT PRIMARY KEY, incident_id TEXT NOT NULL REFERENCES incidents(id), actor_user_id TEXT NOT NULL REFERENCES users(id), event_type TEXT NOT NULL, notes TEXT NOT NULL, from_status TEXT, to_status TEXT, new_responsible_employee_id TEXT REFERENCES employees(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS incident_history_no_update BEFORE UPDATE ON incident_updates BEGIN SELECT RAISE(ABORT,'History append-only'); END;
CREATE TRIGGER IF NOT EXISTS incident_history_no_delete BEFORE DELETE ON incident_updates BEGIN SELECT RAISE(ABORT,'History append-only'); END;
CREATE TABLE IF NOT EXISTS incident_files (
 id TEXT PRIMARY KEY, incident_id TEXT NOT NULL REFERENCES incidents(id), file_id TEXT NOT NULL REFERENCES files(id), caption TEXT, captured_at TEXT, capture_source TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), UNIQUE(incident_id,file_id));
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO app_settings VALUES ('allow_gap_publication','false');
INSERT OR IGNORE INTO app_settings VALUES ('demo_mode','false');
CREATE TABLE IF NOT EXISTS import_candidates (
 id TEXT PRIMARY KEY, full_name TEXT NOT NULL, position_name TEXT NOT NULL, org_path TEXT NOT NULL, source_cell TEXT NOT NULL, source_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', employee_id TEXT REFERENCES employees(id), notes TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, UNIQUE(source_name,source_cell,full_name));

CREATE TABLE IF NOT EXISTS announcements (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN('UMUM','SDM','OPERASIONAL','KEAMANAN')), priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK(priority IN('NORMAL','IMPORTANT')),
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','PUBLISHED','ARCHIVED')), is_pinned INTEGER NOT NULL DEFAULT 0 CHECK(is_pinned IN(0,1)), content_json TEXT NOT NULL, content_version INTEGER NOT NULL DEFAULT 1,
 starts_at TEXT, ends_at TEXT, published_at TEXT, published_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at>starts_at));
CREATE TABLE IF NOT EXISTS announcement_files (
 id TEXT PRIMARY KEY, announcement_id TEXT NOT NULL REFERENCES announcements(id), file_id TEXT NOT NULL REFERENCES files(id), usage_kind TEXT NOT NULL CHECK(usage_kind IN('IMAGE','ATTACHMENT')), caption TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), UNIQUE(announcement_id,file_id));
CREATE TABLE IF NOT EXISTS announcement_reads (
 announcement_id TEXT NOT NULL REFERENCES announcements(id), user_id TEXT NOT NULL REFERENCES users(id), content_version INTEGER NOT NULL, read_at TEXT NOT NULL, PRIMARY KEY(announcement_id,user_id));
CREATE INDEX IF NOT EXISTS announcement_publication ON announcements(status,starts_at,ends_at);
