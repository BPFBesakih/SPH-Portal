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
CREATE TABLE IF NOT EXISTS briefing_links (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64), share_token TEXT NOT NULL CHECK(length(share_token)=64), label TEXT NOT NULL,
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)), revoked_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id));
CREATE UNIQUE INDEX IF NOT EXISTS briefing_one_active_link ON briefing_links(is_active) WHERE is_active=1;
CREATE TABLE IF NOT EXISTS morning_briefings (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), org_unit_id TEXT NOT NULL REFERENCES org_units(id),
 employee_name TEXT NOT NULL, position_name TEXT NOT NULL, department TEXT NOT NULL, section TEXT NOT NULL, held_on TEXT NOT NULL,
 absent_notes TEXT NOT NULL, briefing_notes TEXT NOT NULL, submitted_at TEXT NOT NULL, source TEXT NOT NULL CHECK(source='NATIVE_LINK'),
 link_id TEXT NOT NULL REFERENCES briefing_links(id), response_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
 deleted_at TEXT, deleted_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), UNIQUE(link_id,response_id));
CREATE INDEX IF NOT EXISTS briefing_unit_date ON morning_briefings(org_unit_id,held_on);
CREATE TABLE IF NOT EXISTS briefing_files (
 id TEXT PRIMARY KEY, briefing_id TEXT NOT NULL UNIQUE REFERENCES morning_briefings(id), file_id TEXT NOT NULL UNIQUE REFERENCES files(id),
 captured_at TEXT NOT NULL, capture_source TEXT NOT NULL CHECK(capture_source='CAMERA'),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id));
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
CREATE TABLE IF NOT EXISTS quick_report_links (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL, position_ids TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)), revoked_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES users(id));
CREATE UNIQUE INDEX IF NOT EXISTS quick_report_one_active ON quick_report_links(is_active) WHERE is_active=1;
CREATE TABLE IF NOT EXISTS quick_report_rate_limits (
 id TEXT PRIMARY KEY, window_start TEXT NOT NULL, hits INTEGER NOT NULL CHECK(hits>0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS logbook_entries (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), post_id TEXT REFERENCES security_posts(id), occurred_at TEXT NOT NULL, activity_type TEXT NOT NULL CHECK(activity_type IN('JAGA','PATROLI','LAINNYA')), activity_notes TEXT NOT NULL, findings TEXT, roster_assignment_id TEXT REFERENCES roster_assignments(id),
 reporting_org_unit_id TEXT REFERENCES org_units(id), latitude REAL, longitude REAL, location_accuracy REAL, location_captured_at TEXT, idempotency_key TEXT UNIQUE, request_fingerprint TEXT, report_source TEXT NOT NULL DEFAULT 'PORTAL' CHECK(report_source IN('PORTAL','PUBLIC_LINK')), report_link_id TEXT REFERENCES quick_report_links(id), location_name TEXT,
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

-- Modul Pengadaan (PR sampai serah terima). Uang dalam rupiah bulat; jumlah dan volume per seribu.
CREATE TABLE IF NOT EXISTS budget_years (
 id TEXT PRIMARY KEY, year INTEGER NOT NULL UNIQUE CHECK(year BETWEEN 2000 AND 2100), is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS budget_lines (
 id TEXT PRIMARY KEY, budget_year_id TEXT NOT NULL REFERENCES budget_years(id), code TEXT NOT NULL, name TEXT NOT NULL, org_unit_id TEXT REFERENCES org_units(id), ceiling INTEGER NOT NULL CHECK(ceiling>=0), is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), UNIQUE(budget_year_id,code));
CREATE TABLE IF NOT EXISTS vendors (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, leader_name TEXT, leader_title TEXT, leader_nik TEXT, contact_name TEXT, address TEXT, phone TEXT, bank_name TEXT, bank_branch TEXT, account_no TEXT, account_name TEXT, notes TEXT, is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS purchase_delegations (
 id TEXT PRIMARY KEY, from_employee_id TEXT NOT NULL REFERENCES employees(id), to_employee_id TEXT NOT NULL REFERENCES employees(id), starts_on TEXT NOT NULL, ends_on TEXT NOT NULL, reason TEXT NOT NULL, revoked_at TEXT, revoked_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), CHECK(ends_on>=starts_on), CHECK(from_employee_id<>to_employee_id));
CREATE TABLE IF NOT EXISTS purchase_number_sequences (
 id TEXT PRIMARY KEY, doc_type TEXT NOT NULL, sequence_key TEXT NOT NULL, year INTEGER NOT NULL, last_no INTEGER NOT NULL CHECK(last_no>=0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, UNIQUE(doc_type,sequence_key,year));
CREATE TABLE IF NOT EXISTS purchase_requests (
 id TEXT PRIMARY KEY, request_code TEXT NOT NULL UNIQUE, pr_number TEXT UNIQUE, requester_employee_id TEXT NOT NULL REFERENCES employees(id), submitted_by TEXT NOT NULL REFERENCES users(id), org_unit_id TEXT NOT NULL REFERENCES org_units(id),
 requester_name TEXT NOT NULL, requester_no TEXT NOT NULL, position_name TEXT NOT NULL, unit_name TEXT NOT NULL, supervisor_employee_id TEXT REFERENCES employees(id), request_date TEXT NOT NULL, needed_on TEXT NOT NULL,
 budget_line_id TEXT REFERENCES budget_lines(id), special_budget INTEGER NOT NULL DEFAULT 0 CHECK(special_budget IN(0,1)),
 status TEXT NOT NULL CHECK(status IN('pending_acknowledgement','pending_verification','pending_final_approval','returned','rejected','cancelled','pending_completeness_check','in_procurement','pending_requester_confirmation','pending_reverification','pending_reapproval','completed')),
 estimated_total INTEGER NOT NULL CHECK(estimated_total>=0), approved_total INTEGER CHECK(approved_total>=0), final_approver_kind TEXT CHECK(final_approver_kind IN('SEKBAN','KABAN')), procurement_path TEXT CHECK(procurement_path IN('A','B','C')),
 pic_employee_id TEXT REFERENCES employees(id), revision_no INTEGER NOT NULL DEFAULT 1 CHECK(revision_no>0), confirmation_round INTEGER NOT NULL DEFAULT 0, closed_reason TEXT, closed_at TEXT, completed_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), CHECK(needed_on>=request_date));
CREATE INDEX IF NOT EXISTS purchase_request_status ON purchase_requests(status);
CREATE INDEX IF NOT EXISTS purchase_request_requester ON purchase_requests(requester_employee_id);
CREATE TABLE IF NOT EXISTS purchase_request_items (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES purchase_requests(id), line_no INTEGER NOT NULL CHECK(line_no>0), description TEXT NOT NULL, item_kind TEXT NOT NULL CHECK(item_kind IN('GOODS','SERVICE')),
 quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0), unit TEXT NOT NULL, unit_price INTEGER NOT NULL CHECK(unit_price>=0), subtotal INTEGER NOT NULL CHECK(subtotal>=0),
 approved_unit_price INTEGER NOT NULL CHECK(approved_unit_price>=0), approved_subtotal INTEGER NOT NULL CHECK(approved_subtotal>=0), reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','CANCELLED')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), UNIQUE(request_id,line_no));
CREATE TABLE IF NOT EXISTS purchase_attachments (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES purchase_requests(id), owner_type TEXT NOT NULL CHECK(owner_type IN('ITEM','QUOTE','ORDER','APPOINTMENT')), owner_id TEXT NOT NULL,
 attachment_kind TEXT NOT NULL CHECK(attachment_kind IN('REFERENCE','PRICE_EVIDENCE','VENDOR_INVOICE','SIGNED_SCAN')), form TEXT NOT NULL CHECK(form IN('LINK','TEXT','FILE')), url TEXT, note TEXT, file_id TEXT UNIQUE REFERENCES files(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id),
 CHECK((form='FILE')=(file_id IS NOT NULL)), CHECK(form<>'LINK' OR url IS NOT NULL), CHECK(form<>'TEXT' OR note IS NOT NULL));
CREATE INDEX IF NOT EXISTS purchase_attachment_owner ON purchase_attachments(owner_type,owner_id);
CREATE TABLE IF NOT EXISTS purchase_approval_steps (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES purchase_requests(id), object_type TEXT NOT NULL CHECK(object_type IN('REQUEST','APPOINTMENT','ORDER')), object_id TEXT NOT NULL, cycle_no INTEGER NOT NULL,
 step_kind TEXT NOT NULL CHECK(step_kind IN('ACKNOWLEDGE','VERIFY','FINAL','REVERIFY','REAPPROVE','APPOINTMENT','ORDER')), target_kind TEXT NOT NULL CHECK(target_kind IN('EMPLOYEE','VERIFIERS')), target_employee_id TEXT REFERENCES employees(id), target_label TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','APPROVED','RETURNED','REJECTED','SKIPPED','SUPERSEDED')), actor_user_id TEXT REFERENCES users(id), actor_employee_id TEXT REFERENCES employees(id), actor_name TEXT, actor_position TEXT,
 as_delegate INTEGER NOT NULL DEFAULT 0 CHECK(as_delegate IN(0,1)), reason TEXT, acted_at TEXT, reassigned_from_employee_id TEXT REFERENCES employees(id), reassign_reason TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), CHECK(target_kind='VERIFIERS' OR target_employee_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS purchase_steps_request ON purchase_approval_steps(request_id,status);
CREATE INDEX IF NOT EXISTS purchase_steps_target ON purchase_approval_steps(target_employee_id,status);
CREATE TRIGGER IF NOT EXISTS purchase_step_decided BEFORE UPDATE ON purchase_approval_steps WHEN OLD.acted_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'Tahap yang sudah diputuskan tidak dapat diubah'); END;
CREATE TRIGGER IF NOT EXISTS purchase_step_no_delete BEFORE DELETE ON purchase_approval_steps BEGIN SELECT RAISE(ABORT,'Tahap persetujuan tidak dapat dihapus'); END;
CREATE TABLE IF NOT EXISTS purchase_price_quotes (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES purchase_requests(id), item_id TEXT NOT NULL REFERENCES purchase_request_items(id), vendor_id TEXT REFERENCES vendors(id), store_name TEXT NOT NULL, unit_price INTEGER NOT NULL CHECK(unit_price>=0),
 is_selected INTEGER NOT NULL DEFAULT 0 CHECK(is_selected IN(0,1)), not_cheapest_reason TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS purchase_price_confirmations (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES purchase_requests(id), item_id TEXT NOT NULL REFERENCES purchase_request_items(id), round_no INTEGER NOT NULL CHECK(round_no>0),
 old_unit_price INTEGER NOT NULL, new_unit_price INTEGER NOT NULL CHECK(new_unit_price>=0), old_subtotal INTEGER NOT NULL, new_subtotal INTEGER NOT NULL, reason TEXT NOT NULL,
 answer TEXT NOT NULL DEFAULT 'PENDING' CHECK(answer IN('PENDING','ACCEPTED','CANCELLED')), answered_at TEXT, answered_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), UNIQUE(request_id,item_id,round_no));
CREATE TABLE IF NOT EXISTS vendor_orders (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES purchase_requests(id), vendor_id TEXT REFERENCES vendors(id), store_name TEXT NOT NULL, path TEXT NOT NULL CHECK(path IN('A','B','C')), document_kind TEXT NOT NULL CHECK(document_kind IN('PO','SPK','NONE')),
 status TEXT NOT NULL CHECK(status IN('draft','pending_appointment_approval','pending_order_approval','ordered','purchased','received','cancelled')), total INTEGER NOT NULL CHECK(total>=0), due_on TEXT, cancelled_reason TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), CHECK(path='A' OR vendor_id IS NOT NULL), CHECK((path='A')=(document_kind='NONE')));
CREATE INDEX IF NOT EXISTS vendor_order_request ON vendor_orders(request_id);
CREATE TABLE IF NOT EXISTS vendor_order_items (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES vendor_orders(id), request_item_id TEXT NOT NULL REFERENCES purchase_request_items(id), quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0), unit TEXT NOT NULL,
 calc_volume_milli INTEGER CHECK(calc_volume_milli>0), calc_unit TEXT, unit_price INTEGER NOT NULL CHECK(unit_price>=0), subtotal INTEGER NOT NULL CHECK(subtotal>=0), needed_on TEXT NOT NULL,
 purchase_unit_price INTEGER CHECK(purchase_unit_price>=0), received_quantity_milli INTEGER CHECK(received_quantity_milli>=0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), UNIQUE(order_id,request_item_id), CHECK((calc_volume_milli IS NULL)=(calc_unit IS NULL)));
CREATE TABLE IF NOT EXISTS vendor_appointments (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES vendor_orders(id), reason TEXT NOT NULL, number TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','APPROVED','REJECTED')), decided_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS vendor_order_documents (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES vendor_orders(id), doc_kind TEXT NOT NULL CHECK(doc_kind IN('PO','SPK')), number TEXT UNIQUE, doc_date TEXT, work_description TEXT, work_duration_days INTEGER CHECK(work_duration_days>0),
 payment_terms TEXT NOT NULL, billing_text TEXT NOT NULL, signer_employee_id TEXT REFERENCES employees(id), signer_name TEXT, signer_position TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS order_receipts (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES vendor_orders(id), purchased_on TEXT NOT NULL, received_on TEXT, received_by_employee_id TEXT REFERENCES employees(id), condition_note TEXT, invoice_total INTEGER CHECK(invoice_total>=0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), CHECK(received_on IS NULL OR received_on>=purchased_on));
CREATE TABLE IF NOT EXISTS purchase_documents (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES purchase_requests(id), doc_type TEXT NOT NULL CHECK(doc_type IN('PR','PO','SPK','SPV')), object_id TEXT NOT NULL, number TEXT, snapshot_json TEXT NOT NULL, snapshot_hash TEXT NOT NULL, verification_code TEXT NOT NULL UNIQUE, superseded_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id));
CREATE INDEX IF NOT EXISTS purchase_document_object ON purchase_documents(object_id);

CREATE TABLE IF NOT EXISTS coaching_links (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64), label TEXT NOT NULL,
 share_token TEXT CHECK(share_token IS NULL OR length(share_token)=64),
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)), revoked_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS coaching_files (
 id TEXT PRIMARY KEY, coaching_session_id TEXT NOT NULL REFERENCES coaching_sessions(id), file_id TEXT NOT NULL UNIQUE REFERENCES files(id), caption TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id));

CREATE TABLE IF NOT EXISTS coaching_form_submissions (
 id TEXT PRIMARY KEY, form_id TEXT NOT NULL, response_id TEXT NOT NULL, payload_hash TEXT NOT NULL, coaching_session_id TEXT NOT NULL UNIQUE REFERENCES coaching_sessions(id),
 submitted_at TEXT NOT NULL, department TEXT NOT NULL, section TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, UNIQUE(form_id,response_id));
CREATE UNIQUE INDEX IF NOT EXISTS coaching_one_active_link ON coaching_links(is_active) WHERE is_active=1;
CREATE INDEX IF NOT EXISTS coaching_files_session_idx ON coaching_files(coaching_session_id);

-- Merchandise: stok NULL berarti belum pernah dihitung oleh petugas.
CREATE TABLE IF NOT EXISTS merchandise_products (
 id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL, buy_price INTEGER NOT NULL CHECK(buy_price>=0), sell_price INTEGER NOT NULL CHECK(sell_price>=0),
 stock_qty INTEGER CHECK(stock_qty IS NULL OR stock_qty>=0), is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS merchandise_sales (
 id TEXT PRIMARY KEY, sale_no TEXT NOT NULL UNIQUE, sold_on TEXT NOT NULL, payment_method TEXT NOT NULL CHECK(payment_method IN('TUNAI','QRIS','TRANSFER','LAINNYA')),
 status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK(status IN('COMPLETED','VOID')), total INTEGER NOT NULL CHECK(total>=0), cost_total INTEGER NOT NULL CHECK(cost_total>=0),
 note TEXT, void_reason TEXT, voided_at TEXT, voided_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES users(id));
CREATE INDEX IF NOT EXISTS merchandise_sales_date_idx ON merchandise_sales(sold_on,status);
CREATE TABLE IF NOT EXISTS merchandise_sale_items (
 id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES merchandise_sales(id), product_id TEXT NOT NULL REFERENCES merchandise_products(id), sku TEXT NOT NULL, product_name TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity>0), unit_price INTEGER NOT NULL CHECK(unit_price>=0), unit_cost INTEGER NOT NULL CHECK(unit_cost>=0), subtotal INTEGER NOT NULL CHECK(subtotal>=0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, UNIQUE(sale_id,product_id));
CREATE TABLE IF NOT EXISTS merchandise_stock_movements (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES merchandise_products(id), sale_id TEXT REFERENCES merchandise_sales(id), kind TEXT NOT NULL CHECK(kind IN('INITIAL','IN','ADJUST','SALE','VOID')),
 quantity_delta INTEGER NOT NULL, balance_before INTEGER, balance_after INTEGER NOT NULL CHECK(balance_after>=0), reason TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES users(id));
CREATE INDEX IF NOT EXISTS merchandise_stock_product_idx ON merchandise_stock_movements(product_id,created_at);
-- Pengelolaan Kunjungan: tautan pos dan catatan kiriman (catatan tanpa nama guide/nilai/catatan).
CREATE TABLE IF NOT EXISTS guide_form_links (
 id TEXT PRIMARY KEY, pos INTEGER NOT NULL CHECK(pos IN(1,3)), label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
 share_token TEXT CHECK(share_token IS NULL OR length(share_token)=64), is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
 revoked_at TEXT, revoked_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), CHECK(is_active=1 OR revoked_at IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS guide_form_one_active_link ON guide_form_links(pos) WHERE is_active=1;
CREATE TABLE IF NOT EXISTS guide_form_rate_limits (id TEXT PRIMARY KEY, window_start TEXT NOT NULL, hits INTEGER NOT NULL CHECK(hits>0));
CREATE TABLE IF NOT EXISTS guide_form_submissions (
 id TEXT PRIMARY KEY, link_id TEXT NOT NULL REFERENCES guide_form_links(id), pos INTEGER NOT NULL CHECK(pos IN(1,2,3)), evaluation_id TEXT NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN('ACCEPTED','DUPLICATE','REJECTED')), reason TEXT CHECK(reason IS NULL OR reason IN('JEDA','KOREKSI','GUIDE','WAKTU','POS','VALIDASI')),
 received_at TEXT NOT NULL, ip_hmac TEXT CHECK(ip_hmac IS NULL OR length(ip_hmac)=64),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS guide_form_submissions_pos_time ON guide_form_submissions(pos,received_at);
CREATE INDEX IF NOT EXISTS guide_form_submissions_time ON guide_form_submissions(received_at);
-- Penilaian guide disimpan di portal (6 minggu) dan disalin ke spreadsheet tahunan di Drive portal.
CREATE TABLE IF NOT EXISTS visit_guides (
 id TEXT PRIMARY KEY CHECK(id GLOB 'G-[0-9]*' AND length(id) BETWEEN 3 AND 9), seq INTEGER NOT NULL UNIQUE CHECK(seq BETWEEN 1 AND 9999999),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120 AND name=trim(name)), kategori TEXT NOT NULL CHECK(kategori IN('Asing','Domestik')),
 regu TEXT NOT NULL CHECK(regu IN('A1','A2','D1','D2') OR (length(regu)=6 AND substr(regu,1,2) IN('A1','A2','D1','D2') AND substr(regu,3,2)=', ' AND substr(regu,5,2) IN('A1','A2','D1','D2'))),
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS visit_evaluations (
 id TEXT PRIMARY KEY CHECK(length(id)=36), link_id TEXT REFERENCES guide_form_links(id), pos INTEGER NOT NULL CHECK(pos IN(1,3)),
 guide_id TEXT NOT NULL REFERENCES visit_guides(id), guide_name TEXT NOT NULL CHECK(length(guide_name) BETWEEN 1 AND 120),
 uniform INTEGER NOT NULL CHECK(uniform IN(-1,1,2)), id_card INTEGER NOT NULL CHECK(id_card IN(0,1)), review INTEGER NOT NULL DEFAULT 0 CHECK(review BETWEEN 0 AND 20),
 etika INTEGER NOT NULL CHECK(etika BETWEEN -5 AND 5), catatan TEXT NOT NULL DEFAULT '' CHECK(length(catatan)<=500),
 evaluated_at TEXT NOT NULL CHECK(length(evaluated_at)=24), wita_date TEXT NOT NULL CHECK(length(wita_date)=10), received_at TEXT NOT NULL,
 koreksi_dari TEXT CHECK(koreksi_dari IS NULL OR koreksi_dari<>id), status TEXT NOT NULL DEFAULT 'aktif' CHECK(status IN('aktif','diganti')), replaced_by TEXT,
 sheet_tab TEXT, sheet_row INTEGER CHECK(sheet_row IS NULL OR sheet_row>=2), sheet_dirty INTEGER NOT NULL DEFAULT 0 CHECK(sheet_dirty IN(0,1)),
 sheet_synced_at TEXT, sheet_verified_at TEXT,
 CHECK((sheet_tab IS NULL)=(sheet_row IS NULL)), CHECK(status='aktif' OR replaced_by IS NOT NULL));
CREATE INDEX IF NOT EXISTS visit_evaluations_date ON visit_evaluations(wita_date);
CREATE INDEX IF NOT EXISTS visit_evaluations_guide_pos_time ON visit_evaluations(guide_id,pos,evaluated_at);
CREATE INDEX IF NOT EXISTS visit_evaluations_unsynced ON visit_evaluations(received_at,id) WHERE sheet_row IS NULL;
CREATE INDEX IF NOT EXISTS visit_evaluations_dirty ON visit_evaluations(sheet_tab,sheet_row) WHERE sheet_dirty=1;
CREATE UNIQUE INDEX IF NOT EXISTS visit_evaluations_sheet_position ON visit_evaluations(sheet_tab,sheet_row) WHERE sheet_row IS NOT NULL;
CREATE TABLE IF NOT EXISTS visit_monthly_totals (
 month TEXT NOT NULL CHECK(length(month)=7), guide_id TEXT NOT NULL, pos INTEGER NOT NULL CHECK(pos IN(0,1,3)),
 antar INTEGER NOT NULL CHECK(antar>=0), uniform INTEGER NOT NULL, uniform_patuh INTEGER NOT NULL CHECK(uniform_patuh>=0), id_card INTEGER NOT NULL CHECK(id_card>=0),
 review INTEGER NOT NULL CHECK(review>=0), etika INTEGER NOT NULL, hari INTEGER NOT NULL CHECK(hari>=0), updated_at TEXT NOT NULL, PRIMARY KEY(month,guide_id,pos));
CREATE TABLE IF NOT EXISTS visit_sheet_files (year INTEGER PRIMARY KEY CHECK(year BETWEEN 2026 AND 2100), spreadsheet_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS visit_sheet_tabs (
 title TEXT PRIMARY KEY CHECK(length(title)=7), year INTEGER NOT NULL REFERENCES visit_sheet_files(year), sheet_id INTEGER NOT NULL CHECK(sheet_id>=0),
 next_row INTEGER NOT NULL CHECK(next_row>=2), row_count INTEGER NOT NULL CHECK(row_count>=1), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS visit_sheet_state (
 id INTEGER PRIMARY KEY CHECK(id=1), folder_id TEXT, lease_owner TEXT, lease_until TEXT, last_attempt_at TEXT, last_success_at TEXT,
 last_error TEXT CHECK(last_error IS NULL OR length(last_error)<=300), last_error_at TEXT, last_retention_at TEXT, folded_through TEXT, updated_at TEXT NOT NULL,
 CHECK((lease_owner IS NULL)=(lease_until IS NULL)));
INSERT OR IGNORE INTO visit_sheet_state(id,updated_at) VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
-- Absensi (tahap 1): HP terdaftar, absen GPS + selfie, koreksi sebagai baris baru.
CREATE TABLE IF NOT EXISTS attendance_points (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90), longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 radius_m INTEGER NOT NULL DEFAULT 100 CHECK(radius_m BETWEEN 20 AND 1000), is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS attendance_registration_sessions (
 id TEXT PRIMARY KEY, org_unit_id TEXT NOT NULL REFERENCES org_units(id), token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
 expires_at TEXT NOT NULL, closed_at TEXT, closed_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES users(id));
CREATE TABLE IF NOT EXISTS attendance_devices (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN('PERSONAL','SHARED')),
 owner_employee_id TEXT REFERENCES employees(id), org_unit_id TEXT REFERENCES org_units(id), label TEXT CHECK(label IS NULL OR length(label) BETWEEN 1 AND 80),
 status TEXT NOT NULL CHECK(status IN('PENDING','ACTIVE','REJECTED','REVOKED')),
 registration_token_hash TEXT UNIQUE CHECK(registration_token_hash IS NULL OR length(registration_token_hash)=64), registration_expires_at TEXT,
 session_id TEXT REFERENCES attendance_registration_sessions(id),
 public_key TEXT CHECK(public_key IS NULL OR length(public_key)<=400), key_thumbprint TEXT UNIQUE CHECK(key_thumbprint IS NULL OR length(key_thumbprint)=64),
 activated_at TEXT, approved_by TEXT REFERENCES users(id), approved_at TEXT,
 revoked_by TEXT REFERENCES users(id), revoked_at TEXT, revoke_reason TEXT CHECK(revoke_reason IS NULL OR length(revoke_reason)<=300),
 last_seen_at TEXT, client_info TEXT CHECK(client_info IS NULL OR length(client_info)<=200),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id),
 CHECK(kind<>'PERSONAL' OR owner_employee_id IS NOT NULL), CHECK(kind<>'SHARED' OR (org_unit_id IS NOT NULL AND label IS NOT NULL)),
 CHECK(status<>'ACTIVE' OR public_key IS NOT NULL), CHECK(session_id IS NULL OR kind='PERSONAL'));
CREATE INDEX IF NOT EXISTS attendance_devices_owner ON attendance_devices(owner_employee_id);
CREATE TABLE IF NOT EXISTS attendance_events (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), kind TEXT NOT NULL CHECK(kind IN('IN','OUT')), recorded_at TEXT NOT NULL,
 work_date TEXT NOT NULL CHECK(length(work_date)=10), pair_event_id TEXT REFERENCES attendance_events(id),
 device_id TEXT NOT NULL REFERENCES attendance_devices(id), client_key TEXT NOT NULL CHECK(length(client_key)=36),
 latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90), longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 accuracy_m REAL NOT NULL CHECK(accuracy_m>=0 AND accuracy_m<=100000), location_captured_at TEXT,
 point_id TEXT REFERENCES attendance_points(id), point_name TEXT CHECK(point_name IS NULL OR length(point_name)<=80),
 distance_m INTEGER CHECK(distance_m IS NULL OR distance_m>=0), within_point INTEGER NOT NULL CHECK(within_point IN(0,1)),
 outside_reason TEXT CHECK(outside_reason IS NULL OR outside_reason IN('DINAS_LUAR','TUGAS_LAPANGAN','LAINNYA')), outside_note TEXT CHECK(outside_note IS NULL OR length(outside_note)<=300),
 photo_storage_key TEXT CHECK(photo_storage_key IS NULL OR length(photo_storage_key)<=200), photo_mime TEXT NOT NULL CHECK(photo_mime='image/jpeg'),
 photo_size INTEGER NOT NULL CHECK(photo_size BETWEEN 1 AND 307200), photo_checksum TEXT NOT NULL CHECK(length(photo_checksum)=64), photo_deleted_at TEXT,
 flags TEXT NOT NULL DEFAULT '[]' CHECK(length(flags)<=400), confirmed_order INTEGER NOT NULL DEFAULT 0 CHECK(confirmed_order IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 UNIQUE(device_id,client_key), CHECK(pair_event_id IS NULL OR kind='OUT'),
 CHECK(within_point=1 OR point_id IS NULL OR outside_reason IS NOT NULL), CHECK((photo_storage_key IS NULL)=(photo_deleted_at IS NOT NULL)));
CREATE UNIQUE INDEX IF NOT EXISTS attendance_events_one_pair ON attendance_events(pair_event_id) WHERE pair_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS attendance_events_employee_time ON attendance_events(employee_id,recorded_at);
CREATE INDEX IF NOT EXISTS attendance_events_day ON attendance_events(work_date,employee_id);
CREATE INDEX IF NOT EXISTS attendance_events_device_time ON attendance_events(device_id,recorded_at);
CREATE TRIGGER IF NOT EXISTS attendance_events_no_delete BEFORE DELETE ON attendance_events BEGIN SELECT RAISE(ABORT,'Catatan absen tidak boleh dihapus.'); END;
CREATE TRIGGER IF NOT EXISTS attendance_events_no_update BEFORE UPDATE OF id,employee_id,kind,recorded_at,work_date,pair_event_id,device_id,client_key,latitude,longitude,accuracy_m,location_captured_at,point_id,point_name,distance_m,within_point,outside_reason,outside_note,photo_mime,photo_size,photo_checksum,flags,confirmed_order,created_at ON attendance_events BEGIN SELECT RAISE(ABORT,'Catatan absen tidak boleh diubah. Tambahkan koreksi.'); END;
CREATE TRIGGER IF NOT EXISTS attendance_events_no_photo_restore BEFORE UPDATE OF photo_storage_key ON attendance_events WHEN OLD.photo_storage_key IS NULL AND NEW.photo_storage_key IS NOT NULL BEGIN SELECT RAISE(ABORT,'Catatan absen tidak boleh diubah. Tambahkan koreksi.'); END;
CREATE TABLE IF NOT EXISTS attendance_corrections (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), work_date TEXT NOT NULL CHECK(length(work_date)=10),
 in_at TEXT, out_at TEXT, void_event_id TEXT REFERENCES attendance_events(id), reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
 revoked_at TEXT, revoked_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
 CHECK(in_at IS NOT NULL OR out_at IS NOT NULL OR void_event_id IS NOT NULL), CHECK(in_at IS NULL OR out_at IS NULL OR in_at<out_at));
CREATE INDEX IF NOT EXISTS attendance_corrections_day ON attendance_corrections(work_date,employee_id);
CREATE TABLE IF NOT EXISTS attendance_day_notes (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), work_date TEXT NOT NULL CHECK(length(work_date)=10),
 kind TEXT NOT NULL CHECK(kind IN('IZIN','SAKIT','DINAS_LUAR')), note TEXT CHECK(note IS NULL OR length(note)<=500),
 revoked_at TEXT, revoked_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES users(id));
CREATE UNIQUE INDEX IF NOT EXISTS attendance_day_notes_active ON attendance_day_notes(employee_id,work_date) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS attendance_reviews (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL UNIQUE REFERENCES attendance_events(id), decision TEXT NOT NULL CHECK(decision IN('SESUAI','KLARIFIKASI')),
 note TEXT CHECK(note IS NULL OR length(note)<=500), reviewed_by TEXT NOT NULL REFERENCES users(id), reviewed_at TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS attendance_reference_photos (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL UNIQUE REFERENCES employees(id), event_id TEXT NOT NULL REFERENCES attendance_events(id),
 set_by TEXT NOT NULL REFERENCES users(id), set_at TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS attendance_rate_limits (id TEXT PRIMARY KEY, window_start TEXT NOT NULL, hits INTEGER NOT NULL CHECK(hits>0));
CREATE TABLE IF NOT EXISTS attendance_state (
 id INTEGER PRIMARY KEY CHECK(id=1), lease_owner TEXT, lease_until TEXT, last_retention_at TEXT,
 last_error TEXT CHECK(last_error IS NULL OR length(last_error)<=300), deleted_photos INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
 CHECK((lease_owner IS NULL)=(lease_until IS NULL)));
INSERT OR IGNORE INTO attendance_state(id,updated_at) VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- E-Arsip Humas (Tahap 1): arsip dokumen administrasi per bagian dengan pengawasan Humas.
-- Padanan PostgreSQL: supabase/migrations/20261112100000_archive_module.sql.
-- Berkas tetap di tabel files (Drive privat); tabel di bawah hanya metadata, izin, dan audit.
CREATE TABLE IF NOT EXISTS archive_document_types (
 id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE CHECK(length(code) BETWEEN 1 AND 20 AND code=upper(code)),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80), name_normalized TEXT NOT NULL UNIQUE,
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id));
INSERT OR IGNORE INTO archive_document_types(id,code,name,name_normalized,is_active,created_at,updated_at,row_version) VALUES
 ('arsip-jenis-surat','SURAT','Surat','surat',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),1),
 ('arsip-jenis-sk','SK','Surat Keputusan','surat keputusan',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),1),
 ('arsip-jenis-st','ST','Surat Tugas','surat tugas',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),1),
 ('arsip-jenis-und','UND','Undangan','undangan',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),1),
 ('arsip-jenis-nd','ND','Nota Dinas','nota dinas',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),1),
 ('arsip-jenis-ba','BA','Berita Acara','berita acara',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),1);
-- Kode agenda per bagian (mis. HMS). Tidak berubah setelah dipakai nomor agenda.
CREATE TABLE IF NOT EXISTS archive_units (
 id TEXT PRIMARY KEY, org_unit_id TEXT NOT NULL UNIQUE REFERENCES org_units(id),
 agenda_code TEXT NOT NULL UNIQUE CHECK(length(agenda_code) BETWEEN 2 AND 12 AND agenda_code=upper(agenda_code)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES users(id));
-- Petugas arsip yang ditunjuk administrator, per bagian.
CREATE TABLE IF NOT EXISTS archive_officers (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), org_unit_id TEXT NOT NULL REFERENCES org_units(id),
 valid_from TEXT NOT NULL, expires_at TEXT, assigned_by TEXT NOT NULL REFERENCES users(id), assigned_at TEXT NOT NULL,
 revoked_by TEXT REFERENCES users(id), revoked_at TEXT, reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 300),
 revoke_reason TEXT CHECK(revoke_reason IS NULL OR length(revoke_reason) BETWEEN 1 AND 300),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 CHECK(expires_at IS NULL OR expires_at>valid_from), CHECK((revoked_by IS NULL)=(revoked_at IS NULL)));
CREATE UNIQUE INDEX IF NOT EXISTS archive_officers_open ON archive_officers(user_id,org_unit_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS archive_officers_unit ON archive_officers(org_unit_id);
-- Pencacah nomor agenda per bagian dan tahun pengarsipan (WITA).
CREATE TABLE IF NOT EXISTS archive_agenda_counters (
 id TEXT PRIMARY KEY, org_unit_id TEXT NOT NULL REFERENCES org_units(id), archival_year INTEGER NOT NULL CHECK(archival_year BETWEEN 2000 AND 9999),
 last_value INTEGER NOT NULL DEFAULT 0 CHECK(last_value>=0), updated_at TEXT NOT NULL, UNIQUE(org_unit_id,archival_year));
CREATE TABLE IF NOT EXISTS archive_records (
 id TEXT PRIMARY KEY, owner_unit_id TEXT NOT NULL REFERENCES org_units(id), unit_code_snapshot TEXT NOT NULL,
 archival_year INTEGER NOT NULL, agenda_sequence INTEGER NOT NULL CHECK(agenda_sequence>0), agenda_number TEXT NOT NULL UNIQUE, archived_at TEXT NOT NULL,
 direction TEXT NOT NULL CHECK(direction IN('MASUK','KELUAR','INTERNAL')),
 document_type_id TEXT NOT NULL REFERENCES archive_document_types(id), document_type_name_snapshot TEXT NOT NULL,
 official_number TEXT CHECK(official_number IS NULL OR length(official_number) BETWEEN 1 AND 120), official_number_normalized TEXT,
 letter_date TEXT NOT NULL CHECK(length(letter_date)=10), subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 500), subject_normalized TEXT NOT NULL,
 classification TEXT NOT NULL DEFAULT 'BIASA' CHECK(classification IN('BIASA','RAHASIA')),
 security_epoch INTEGER NOT NULL DEFAULT 1 CHECK(security_epoch>0), row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version>0),
 source_kind TEXT NOT NULL DEFAULT 'MANUAL' CHECK(source_kind IN('MANUAL','PERSURATAN_TAHAP2')), source_system TEXT, source_reference TEXT,
 created_by TEXT NOT NULL REFERENCES users(id), updated_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 deleted_at TEXT, deleted_by TEXT REFERENCES users(id), delete_reason TEXT,
 UNIQUE(owner_unit_id,archival_year,agenda_sequence),
 CHECK((official_number IS NULL)=(official_number_normalized IS NULL)),
 CHECK((source_system IS NULL)=(source_reference IS NULL)), CHECK(source_kind<>'MANUAL' OR source_system IS NULL),
 CHECK((deleted_at IS NULL AND deleted_by IS NULL AND delete_reason IS NULL) OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND length(delete_reason)>0)));
CREATE UNIQUE INDEX IF NOT EXISTS archive_records_source ON archive_records(source_system,source_reference) WHERE source_system IS NOT NULL;
CREATE INDEX IF NOT EXISTS archive_records_unit_time ON archive_records(owner_unit_id,archived_at DESC,id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS archive_records_time ON archive_records(archived_at DESC,id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS archive_records_direction ON archive_records(direction,archived_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS archive_records_type ON archive_records(document_type_id,archived_at);
CREATE INDEX IF NOT EXISTS archive_records_class ON archive_records(classification,archived_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS archive_records_number ON archive_records(official_number_normalized) WHERE official_number_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS archive_records_subject ON archive_records(letter_date,subject_normalized);
CREATE TRIGGER IF NOT EXISTS archive_records_immutable BEFORE UPDATE ON archive_records
 WHEN NEW.id<>OLD.id OR NEW.owner_unit_id<>OLD.owner_unit_id OR NEW.unit_code_snapshot<>OLD.unit_code_snapshot OR NEW.archival_year<>OLD.archival_year
  OR NEW.agenda_sequence<>OLD.agenda_sequence OR NEW.agenda_number<>OLD.agenda_number OR NEW.archived_at<>OLD.archived_at OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at
 BEGIN SELECT RAISE(ABORT,'Identitas arsip tidak boleh diubah.'); END;
CREATE TRIGGER IF NOT EXISTS archive_records_no_delete BEFORE DELETE ON archive_records BEGIN SELECT RAISE(ABORT,'Arsip tidak boleh dihapus permanen.'); END;
-- Dokumen utama dan lampiran. Versi aktif ditunjuk current_version_id (diperiksa saat commit).
CREATE TABLE IF NOT EXISTS archive_documents (
 id TEXT PRIMARY KEY, archive_id TEXT NOT NULL REFERENCES archive_records(id), role TEXT NOT NULL CHECK(role IN('MAIN','ATTACHMENT')),
 display_order INTEGER NOT NULL DEFAULT 0 CHECK(display_order>=0), current_version_id TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 removed_at TEXT, removed_by TEXT REFERENCES users(id), remove_reason TEXT,
 UNIQUE(archive_id,id), CHECK(role<>'MAIN' OR removed_at IS NULL),
 CHECK((removed_at IS NULL AND removed_by IS NULL AND remove_reason IS NULL) OR (removed_at IS NOT NULL AND removed_by IS NOT NULL AND length(remove_reason)>0)),
 FOREIGN KEY(id,current_version_id) REFERENCES archive_document_versions(document_id,id) DEFERRABLE INITIALLY DEFERRED);
CREATE UNIQUE INDEX IF NOT EXISTS archive_documents_one_main ON archive_documents(archive_id) WHERE role='MAIN' AND removed_at IS NULL;
CREATE INDEX IF NOT EXISTS archive_documents_archive ON archive_documents(archive_id,display_order);
CREATE TRIGGER IF NOT EXISTS archive_documents_no_delete BEFORE DELETE ON archive_documents BEGIN SELECT RAISE(ABORT,'Dokumen arsip tidak boleh dihapus permanen.'); END;
CREATE TABLE IF NOT EXISTS archive_document_versions (
 id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES archive_documents(id) DEFERRABLE INITIALLY DEFERRED, version_number INTEGER NOT NULL CHECK(version_number>0),
 file_id TEXT NOT NULL UNIQUE REFERENCES files(id), original_filename TEXT NOT NULL CHECK(length(original_filename) BETWEEN 1 AND 180),
 detected_mime TEXT NOT NULL CHECK(detected_mime IN('application/pdf','image/jpeg','image/png')),
 byte_size INTEGER NOT NULL CHECK(byte_size>0 AND byte_size<=10000000), sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 change_reason TEXT CHECK(change_reason IS NULL OR length(change_reason) BETWEEN 1 AND 300),
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 UNIQUE(document_id,version_number), UNIQUE(document_id,id), CHECK(version_number=1 OR change_reason IS NOT NULL));
CREATE INDEX IF NOT EXISTS archive_document_versions_hash ON archive_document_versions(sha256);
CREATE TRIGGER IF NOT EXISTS archive_document_versions_no_update BEFORE UPDATE ON archive_document_versions BEGIN SELECT RAISE(ABORT,'Versi berkas arsip tidak boleh diubah.'); END;
CREATE TRIGGER IF NOT EXISTS archive_document_versions_no_delete BEFORE DELETE ON archive_document_versions BEGIN SELECT RAISE(ABORT,'Versi berkas arsip tidak boleh dihapus.'); END;
-- Izin per arsip: berbagi Biasa (pengguna/bagian), baca Rahasia dan unduh (pengguna, terikat epoch).
CREATE TABLE IF NOT EXISTS archive_access_grants (
 id TEXT PRIMARY KEY, archive_id TEXT NOT NULL REFERENCES archive_records(id), purpose TEXT NOT NULL CHECK(purpose IN('BIASA_SHARE','RAHASIA_READ','DOWNLOAD')),
 target_user_id TEXT REFERENCES users(id), target_unit_id TEXT REFERENCES org_units(id), security_epoch INTEGER,
 valid_from TEXT NOT NULL, expires_at TEXT, granted_by TEXT NOT NULL REFERENCES users(id), granted_at TEXT NOT NULL,
 revoked_by TEXT REFERENCES users(id), revoked_at TEXT, reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 300),
 revoked_reason TEXT CHECK(revoked_reason IS NULL OR length(revoked_reason) BETWEEN 1 AND 300),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 CHECK((target_user_id IS NULL)<>(target_unit_id IS NULL)), CHECK(purpose='BIASA_SHARE' OR target_user_id IS NOT NULL),
 CHECK((purpose='BIASA_SHARE')=(security_epoch IS NULL)), CHECK(purpose='RAHASIA_READ' OR expires_at IS NULL),
 CHECK(expires_at IS NULL OR expires_at>valid_from), CHECK((revoked_by IS NULL)=(revoked_at IS NULL)));
CREATE UNIQUE INDEX IF NOT EXISTS archive_access_grants_user_open ON archive_access_grants(archive_id,purpose,target_user_id) WHERE revoked_at IS NULL AND target_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS archive_access_grants_unit_open ON archive_access_grants(archive_id,purpose,target_unit_id) WHERE revoked_at IS NULL AND target_unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS archive_access_grants_user ON archive_access_grants(target_user_id,purpose) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS archive_access_grants_unit ON archive_access_grants(target_unit_id,purpose) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS archive_delete_requests (
 id TEXT PRIMARY KEY, archive_id TEXT NOT NULL REFERENCES archive_records(id), requested_by TEXT NOT NULL REFERENCES users(id), requested_at TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500), status TEXT NOT NULL CHECK(status IN('PENDING','APPROVED','REJECTED','CANCELLED')),
 decided_by TEXT REFERENCES users(id), decided_at TEXT, decision_reason TEXT CHECK(decision_reason IS NULL OR length(decision_reason) BETWEEN 1 AND 500),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 CHECK(status NOT IN('APPROVED','REJECTED') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_reason IS NOT NULL)));
CREATE UNIQUE INDEX IF NOT EXISTS archive_delete_requests_pending ON archive_delete_requests(archive_id) WHERE status='PENDING';
-- Operasi idempoten (buat arsip, tambah lampiran, ganti berkas): kunci sama + isi sama = hasil sama.
CREATE TABLE IF NOT EXISTS archive_upload_operations (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), owner_unit_id TEXT NOT NULL REFERENCES org_units(id),
 operation_type TEXT NOT NULL CHECK(operation_type IN('CREATE_ARCHIVE','ADD_ATTACHMENT','REPLACE_FILE')),
 idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 64), payload_fingerprint TEXT NOT NULL CHECK(length(payload_fingerprint)=64),
 status TEXT NOT NULL CHECK(status IN('COMMITTED')), result_archive_id TEXT NOT NULL REFERENCES archive_records(id),
 result_document_id TEXT REFERENCES archive_documents(id), result_version_id TEXT REFERENCES archive_document_versions(id), request_id TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, UNIQUE(actor_id,operation_type,idempotency_key));
-- Alasan tetap menyimpan dugaan duplikat. internal_match_ids tidak pernah dikirim ke pemohon.
CREATE TABLE IF NOT EXISTS archive_duplicate_overrides (
 id TEXT PRIMARY KEY, archive_id TEXT NOT NULL REFERENCES archive_records(id), operation_id TEXT NOT NULL UNIQUE REFERENCES archive_upload_operations(id),
 actor_id TEXT NOT NULL REFERENCES users(id), reason TEXT CHECK(reason IS NULL OR length(reason) BETWEEN 1 AND 500), rule_version TEXT NOT NULL,
 visible_match_ids TEXT NOT NULL DEFAULT '[]', internal_match_ids TEXT NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, CHECK(reason IS NOT NULL OR visible_match_ids='[]'));
-- Audit modul, hanya bertambah. Terpisah dari audit_events supaya ringkasan perubahan
-- arsip Rahasia tidak terbaca lewat Riwayat Aktivitas administrator.
CREATE TABLE IF NOT EXISTS archive_audit_events (
 id TEXT PRIMARY KEY, occurred_at TEXT NOT NULL, actor_user_id TEXT REFERENCES users(id), actor_snapshot TEXT NOT NULL DEFAULT '{}',
 actor_type TEXT NOT NULL CHECK(actor_type IN('USER','SYSTEM')), action TEXT NOT NULL CHECK(length(action) BETWEEN 1 AND 60),
 archive_id TEXT REFERENCES archive_records(id), document_id TEXT REFERENCES archive_documents(id), version_id TEXT REFERENCES archive_document_versions(id),
 request_id TEXT NOT NULL, operation_id TEXT, outcome TEXT NOT NULL CHECK(outcome IN('SUCCESS','DENIED','FAILED')), reason TEXT,
 before_data TEXT, after_data TEXT, safe_context TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, CHECK(actor_type<>'USER' OR actor_user_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS archive_audit_events_archive ON archive_audit_events(archive_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS archive_audit_events_actor ON archive_audit_events(actor_user_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS archive_audit_events_request ON archive_audit_events(request_id);
CREATE UNIQUE INDEX IF NOT EXISTS archive_audit_events_operation ON archive_audit_events(operation_id,action) WHERE operation_id IS NOT NULL AND outcome='SUCCESS';
CREATE TRIGGER IF NOT EXISTS archive_audit_events_no_update BEFORE UPDATE ON archive_audit_events BEGIN SELECT RAISE(ABORT,'Audit arsip tidak boleh diubah.'); END;
CREATE TRIGGER IF NOT EXISTS archive_audit_events_no_delete BEFORE DELETE ON archive_audit_events BEGIN SELECT RAISE(ABORT,'Audit arsip tidak boleh dihapus.'); END;
-- Notifikasi portal: berbagi (hanya pegawai yang dituju) dan ringkasan harian Humas.
CREATE TABLE IF NOT EXISTS archive_notifications (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL, notification_type TEXT NOT NULL CHECK(notification_type IN('ARCHIVE_SHARED','HUMAS_DAILY_SUMMARY')),
 recipient_user_id TEXT NOT NULL REFERENCES users(id), archive_id TEXT REFERENCES archive_records(id), summary_date TEXT CHECK(summary_date IS NULL OR length(summary_date)=10),
 payload_minimal TEXT NOT NULL DEFAULT '{}', read_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 UNIQUE(event_id,recipient_user_id,notification_type),
 CHECK((notification_type='ARCHIVE_SHARED')=(archive_id IS NOT NULL)), CHECK((notification_type='HUMAS_DAILY_SUMMARY')=(summary_date IS NOT NULL)));
CREATE UNIQUE INDEX IF NOT EXISTS archive_notifications_summary ON archive_notifications(recipient_user_id,notification_type,summary_date) WHERE summary_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS archive_notifications_recipient ON archive_notifications(recipient_user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS archive_daily_summary_runs (
 id TEXT PRIMARY KEY, summary_date TEXT NOT NULL UNIQUE CHECK(length(summary_date)=10), timezone TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
 counts_by_unit TEXT NOT NULL, total INTEGER NOT NULL CHECK(total>=0), status TEXT NOT NULL CHECK(status IN('PREPARED','COMPLETED')), prepared_at TEXT NOT NULL, completed_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, CHECK(period_end>period_start));
