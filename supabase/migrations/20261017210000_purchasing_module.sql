-- Modul Pengadaan: tabel PR sampai serah terima, izin purchasing.*, dan template role.
-- Aditif dan dapat dijalankan ulang. Tidak memberi role atau izin baru kepada akun mana pun.
-- Jalankan setelah 20261016000900_operational_modules.sql dan 20261016234704_training_documentation_and_deletion.sql.
BEGIN;
SET LOCAL search_path=portal,pg_catalog;

CREATE TABLE IF NOT EXISTS portal.budget_years (
 id TEXT PRIMARY KEY, year INTEGER NOT NULL UNIQUE CHECK(year BETWEEN 2000 AND 2100), is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID REFERENCES public.app_users(id));
CREATE TABLE IF NOT EXISTS portal.budget_lines (
 id TEXT PRIMARY KEY, budget_year_id TEXT NOT NULL REFERENCES portal.budget_years(id), code TEXT NOT NULL, name TEXT NOT NULL, org_unit_id TEXT REFERENCES portal.org_units(id), ceiling BIGINT NOT NULL CHECK(ceiling>=0), is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID REFERENCES public.app_users(id), UNIQUE(budget_year_id,code));
CREATE TABLE IF NOT EXISTS portal.vendors (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, leader_name TEXT, leader_title TEXT, leader_nik TEXT, contact_name TEXT, address TEXT, phone TEXT, bank_name TEXT, bank_branch TEXT, account_no TEXT, account_name TEXT, notes TEXT, is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID REFERENCES public.app_users(id));
CREATE TABLE IF NOT EXISTS portal.purchase_delegations (
 id TEXT PRIMARY KEY, from_employee_id TEXT NOT NULL REFERENCES portal.employees(id), to_employee_id TEXT NOT NULL REFERENCES portal.employees(id), starts_on TEXT NOT NULL, ends_on TEXT NOT NULL, reason TEXT NOT NULL, revoked_at TEXT, revoked_by UUID REFERENCES public.app_users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID REFERENCES public.app_users(id), CHECK(ends_on>=starts_on), CHECK(from_employee_id<>to_employee_id));
CREATE TABLE IF NOT EXISTS portal.purchase_number_sequences (
 id TEXT PRIMARY KEY, doc_type TEXT NOT NULL, sequence_key TEXT NOT NULL, year INTEGER NOT NULL, last_no INTEGER NOT NULL CHECK(last_no>=0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, UNIQUE(doc_type,sequence_key,year));
CREATE TABLE IF NOT EXISTS portal.purchase_requests (
 id TEXT PRIMARY KEY, request_code TEXT NOT NULL UNIQUE, pr_number TEXT UNIQUE, requester_employee_id TEXT NOT NULL REFERENCES portal.employees(id), submitted_by UUID NOT NULL REFERENCES public.app_users(id), org_unit_id TEXT NOT NULL REFERENCES portal.org_units(id),
 requester_name TEXT NOT NULL, requester_no TEXT NOT NULL, position_name TEXT NOT NULL, unit_name TEXT NOT NULL, supervisor_employee_id TEXT REFERENCES portal.employees(id), request_date TEXT NOT NULL, needed_on TEXT NOT NULL,
 budget_line_id TEXT REFERENCES portal.budget_lines(id), special_budget INTEGER NOT NULL DEFAULT 0 CHECK(special_budget IN(0,1)),
 status TEXT NOT NULL CHECK(status IN('pending_acknowledgement','pending_verification','pending_final_approval','returned','rejected','cancelled','pending_completeness_check','in_procurement','pending_requester_confirmation','pending_reverification','pending_reapproval','completed')),
 estimated_total BIGINT NOT NULL CHECK(estimated_total>=0), approved_total BIGINT CHECK(approved_total>=0), final_approver_kind TEXT CHECK(final_approver_kind IN('SEKBAN','KABAN')), procurement_path TEXT CHECK(procurement_path IN('A','B','C')),
 pic_employee_id TEXT REFERENCES portal.employees(id), revision_no INTEGER NOT NULL DEFAULT 1 CHECK(revision_no>0), confirmation_round INTEGER NOT NULL DEFAULT 0, closed_reason TEXT, closed_at TEXT, completed_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID REFERENCES public.app_users(id), CHECK(needed_on>=request_date));
CREATE INDEX IF NOT EXISTS purchase_request_status ON portal.purchase_requests(status);
CREATE INDEX IF NOT EXISTS purchase_request_requester ON portal.purchase_requests(requester_employee_id);
CREATE TABLE IF NOT EXISTS portal.purchase_request_items (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES portal.purchase_requests(id), line_no INTEGER NOT NULL CHECK(line_no>0), description TEXT NOT NULL, item_kind TEXT NOT NULL CHECK(item_kind IN('GOODS','SERVICE')),
 quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0), unit TEXT NOT NULL, unit_price BIGINT NOT NULL CHECK(unit_price>=0), subtotal BIGINT NOT NULL CHECK(subtotal>=0),
 approved_unit_price BIGINT NOT NULL CHECK(approved_unit_price>=0), approved_subtotal BIGINT NOT NULL CHECK(approved_subtotal>=0), reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','CANCELLED')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID REFERENCES public.app_users(id), UNIQUE(request_id,line_no));
CREATE TABLE IF NOT EXISTS portal.purchase_attachments (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES portal.purchase_requests(id), owner_type TEXT NOT NULL CHECK(owner_type IN('ITEM','QUOTE','ORDER','APPOINTMENT')), owner_id TEXT NOT NULL,
 attachment_kind TEXT NOT NULL CHECK(attachment_kind IN('REFERENCE','PRICE_EVIDENCE','VENDOR_INVOICE','SIGNED_SCAN')), form TEXT NOT NULL CHECK(form IN('LINK','TEXT','FILE')), url TEXT, note TEXT, file_id TEXT UNIQUE REFERENCES portal.files(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID REFERENCES public.app_users(id),
 CHECK((form='FILE')=(file_id IS NOT NULL)), CHECK(form<>'LINK' OR url IS NOT NULL), CHECK(form<>'TEXT' OR note IS NOT NULL));
CREATE INDEX IF NOT EXISTS purchase_attachment_owner ON portal.purchase_attachments(owner_type,owner_id);
CREATE TABLE IF NOT EXISTS portal.purchase_approval_steps (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES portal.purchase_requests(id), object_type TEXT NOT NULL CHECK(object_type IN('REQUEST','APPOINTMENT','ORDER')), object_id TEXT NOT NULL, cycle_no INTEGER NOT NULL,
 step_kind TEXT NOT NULL CHECK(step_kind IN('ACKNOWLEDGE','VERIFY','FINAL','REVERIFY','REAPPROVE','APPOINTMENT','ORDER')), target_kind TEXT NOT NULL CHECK(target_kind IN('EMPLOYEE','VERIFIERS')), target_employee_id TEXT REFERENCES portal.employees(id), target_label TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','APPROVED','RETURNED','REJECTED','SKIPPED','SUPERSEDED')), actor_user_id UUID REFERENCES public.app_users(id), actor_employee_id TEXT REFERENCES portal.employees(id), actor_name TEXT, actor_position TEXT,
 as_delegate INTEGER NOT NULL DEFAULT 0 CHECK(as_delegate IN(0,1)), reason TEXT, acted_at TEXT, reassigned_from_employee_id TEXT REFERENCES portal.employees(id), reassign_reason TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID REFERENCES public.app_users(id), CHECK(target_kind='VERIFIERS' OR target_employee_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS purchase_steps_request ON portal.purchase_approval_steps(request_id,status);
CREATE INDEX IF NOT EXISTS purchase_steps_target ON portal.purchase_approval_steps(target_employee_id,status);
CREATE TABLE IF NOT EXISTS portal.purchase_price_quotes (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES portal.purchase_requests(id), item_id TEXT NOT NULL REFERENCES portal.purchase_request_items(id), vendor_id TEXT REFERENCES portal.vendors(id), store_name TEXT NOT NULL, unit_price BIGINT NOT NULL CHECK(unit_price>=0),
 is_selected INTEGER NOT NULL DEFAULT 0 CHECK(is_selected IN(0,1)), not_cheapest_reason TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID REFERENCES public.app_users(id));
CREATE TABLE IF NOT EXISTS portal.purchase_price_confirmations (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES portal.purchase_requests(id), item_id TEXT NOT NULL REFERENCES portal.purchase_request_items(id), round_no INTEGER NOT NULL CHECK(round_no>0),
 old_unit_price BIGINT NOT NULL, new_unit_price BIGINT NOT NULL CHECK(new_unit_price>=0), old_subtotal BIGINT NOT NULL, new_subtotal BIGINT NOT NULL, reason TEXT NOT NULL,
 answer TEXT NOT NULL DEFAULT 'PENDING' CHECK(answer IN('PENDING','ACCEPTED','CANCELLED')), answered_at TEXT, answered_by UUID REFERENCES public.app_users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID REFERENCES public.app_users(id), UNIQUE(request_id,item_id,round_no));
CREATE TABLE IF NOT EXISTS portal.vendor_orders (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES portal.purchase_requests(id), vendor_id TEXT REFERENCES portal.vendors(id), store_name TEXT NOT NULL, path TEXT NOT NULL CHECK(path IN('A','B','C')), document_kind TEXT NOT NULL CHECK(document_kind IN('PO','SPK','NONE')),
 status TEXT NOT NULL CHECK(status IN('draft','pending_appointment_approval','pending_order_approval','ordered','purchased','received','cancelled')), total BIGINT NOT NULL CHECK(total>=0), due_on TEXT, cancelled_reason TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID REFERENCES public.app_users(id), CHECK(path='A' OR vendor_id IS NOT NULL), CHECK((path='A')=(document_kind='NONE')));
CREATE INDEX IF NOT EXISTS vendor_order_request ON portal.vendor_orders(request_id);
CREATE TABLE IF NOT EXISTS portal.vendor_order_items (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES portal.vendor_orders(id), request_item_id TEXT NOT NULL REFERENCES portal.purchase_request_items(id), quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0), unit TEXT NOT NULL,
 calc_volume_milli INTEGER CHECK(calc_volume_milli>0), calc_unit TEXT, unit_price BIGINT NOT NULL CHECK(unit_price>=0), subtotal BIGINT NOT NULL CHECK(subtotal>=0), needed_on TEXT NOT NULL,
 purchase_unit_price BIGINT CHECK(purchase_unit_price>=0), received_quantity_milli INTEGER CHECK(received_quantity_milli>=0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID REFERENCES public.app_users(id), UNIQUE(order_id,request_item_id), CHECK((calc_volume_milli IS NULL)=(calc_unit IS NULL)));
CREATE TABLE IF NOT EXISTS portal.vendor_appointments (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES portal.vendor_orders(id), reason TEXT NOT NULL, number TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','APPROVED','REJECTED')), decided_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID REFERENCES public.app_users(id));
CREATE TABLE IF NOT EXISTS portal.vendor_order_documents (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES portal.vendor_orders(id), doc_kind TEXT NOT NULL CHECK(doc_kind IN('PO','SPK')), number TEXT UNIQUE, doc_date TEXT, work_description TEXT, work_duration_days INTEGER CHECK(work_duration_days>0),
 payment_terms TEXT NOT NULL, billing_text TEXT NOT NULL, signer_employee_id TEXT REFERENCES portal.employees(id), signer_name TEXT, signer_position TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID REFERENCES public.app_users(id));
CREATE TABLE IF NOT EXISTS portal.order_receipts (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES portal.vendor_orders(id), purchased_on TEXT NOT NULL, received_on TEXT, received_by_employee_id TEXT REFERENCES portal.employees(id), condition_note TEXT, invoice_total BIGINT CHECK(invoice_total>=0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID REFERENCES public.app_users(id), CHECK(received_on IS NULL OR received_on>=purchased_on));
CREATE TABLE IF NOT EXISTS portal.purchase_documents (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES portal.purchase_requests(id), doc_type TEXT NOT NULL CHECK(doc_type IN('PR','PO','SPK','SPV')), object_id TEXT NOT NULL, number TEXT, snapshot_json TEXT NOT NULL, snapshot_hash TEXT NOT NULL, verification_code TEXT NOT NULL UNIQUE, superseded_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL, created_by UUID REFERENCES public.app_users(id));
CREATE INDEX IF NOT EXISTS purchase_document_object ON portal.purchase_documents(object_id);

-- Keputusan tahap persetujuan tidak dapat diubah atau dihapus setelah dicatat.
CREATE OR REPLACE FUNCTION portal.reject_decided_purchase_step() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $step$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Tahap persetujuan tidak dapat dihapus' USING ERRCODE='23514'; END IF;
 IF OLD.acted_at IS NOT NULL THEN RAISE EXCEPTION 'Tahap yang sudah diputuskan tidak dapat diubah' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $step$;
DROP TRIGGER IF EXISTS decided_step ON portal.purchase_approval_steps;
CREATE TRIGGER decided_step BEFORE UPDATE OR DELETE ON portal.purchase_approval_steps FOR EACH ROW EXECUTE FUNCTION portal.reject_decided_purchase_step();

DO $rls$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['budget_years','budget_lines','vendors','purchase_delegations','purchase_number_sequences','purchase_requests','purchase_request_items','purchase_attachments','purchase_approval_steps','purchase_price_quotes','purchase_price_confirmations','vendor_orders','vendor_order_items','vendor_appointments','vendor_order_documents','order_receipts','purchase_documents'] LOOP
  EXECUTE format('ALTER TABLE portal.%I ENABLE ROW LEVEL SECURITY',t);
 END LOOP;
END $rls$;
REVOKE ALL ON ALL TABLES IN SCHEMA portal FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA portal FROM PUBLIC,anon,authenticated,service_role;

-- Katalog izin pengadaan; keberadaan kode izin tidak memberi akses.
WITH resources(resource,actions) AS (VALUES
 ('purchasing.requests',ARRAY['create','read','verify']),('purchasing.procurement',ARRAY['manage']),('purchasing.vendors',ARRAY['read','manage','sensitive']),
 ('purchasing.budget',ARRAY['read','manage']),('purchasing.reports',ARRAY['read','export']),('purchasing.settings',ARRAY['manage']))
INSERT INTO public.app_permissions(code,module_code,resource,action)
SELECT resource||'.'||a.action,'purchasing',resource,a.action FROM resources CROSS JOIN LATERAL unnest(actions) AS a(action)
ON CONFLICT(code) DO NOTHING;

-- Template role baru. Izin hanya dipasang saat role dibuat pertama kali; role yang sudah ada tidak diubah.
WITH templates(code,name,codes) AS (VALUES
 ('PURCHASE_REQUESTER','Pemohon Pengadaan',ARRAY['purchasing.requests.create','purchasing.requests.read']),
 ('PURCHASING_STAFF','Staf Purchasing',ARRAY['purchasing.requests.read','purchasing.procurement.manage','purchasing.vendors.read','purchasing.vendors.manage','purchasing.vendors.sensitive','purchasing.budget.read','purchasing.reports.read']),
 ('FINANCE_VERIFIER','Verifikator Keuangan',ARRAY['purchasing.requests.read','purchasing.requests.verify','purchasing.budget.read','purchasing.budget.manage','purchasing.vendors.read','purchasing.vendors.sensitive','purchasing.reports.read']),
 ('PURCHASE_AUDITOR','Pemeriksa SPI',ARRAY['purchasing.requests.read','purchasing.vendors.read','purchasing.budget.read','purchasing.reports.read','purchasing.reports.export','admin.audit.read']),
 ('PURCHASE_ADMIN','Pengelola Pengadaan',ARRAY['purchasing.settings.manage','purchasing.requests.read','purchasing.vendors.read','purchasing.vendors.manage','purchasing.vendors.sensitive','purchasing.budget.read','purchasing.budget.manage'])),
added AS (
 INSERT INTO public.app_roles(code,name) SELECT code,name FROM templates ON CONFLICT(code) DO NOTHING RETURNING id,code)
INSERT INTO public.app_role_permissions(role_id,permission_id)
SELECT a.id,p.id FROM added a JOIN templates t ON t.code=a.code JOIN public.app_permissions p ON p.code=ANY(t.codes)
ON CONFLICT DO NOTHING;

NOTIFY pgrst,'reload schema';
COMMIT;

SELECT count(*) AS portal_tables FROM pg_catalog.pg_tables WHERE schemaname='portal';
