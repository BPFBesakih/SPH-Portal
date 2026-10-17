// Modul Pengadaan: PR, persetujuan, kelengkapan, pengadaan, PO/SPK, dan serah terima.
// Aturan angka dan transisi ada di purchasing-rules.mjs; berkas ini menjaga izin,
// data SDM, penomoran, dan konsistensi tabel. Ditulis sinkron untuk SQLite lalu
// dibangkitkan menjadi modul async PostgreSQL oleh scripts/generate-cloud-modules.mjs.
import { createHash, randomBytes } from 'node:crypto';
import { all, one, run, get, insert, update, tx, audit, now, today, assert, AppError, text, date } from './db.mjs';
import { grants } from './auth.mjs';
import { claimFile } from './files.mjs';
import * as R from './purchasing-rules.mjs';

const SETTINGS_KEY = 'purchasing.settings';
const ACTIVE_COMMITMENT = ['pending_completeness_check', 'in_procurement', 'pending_requester_confirmation', 'pending_reverification', 'pending_reapproval'];
const CANCELLABLE = ['pending_acknowledgement', 'pending_verification', 'pending_final_approval', 'returned', 'pending_completeness_check'];
const STEP_LABELS = { ACKNOWLEDGE: 'Diketahui', VERIFY: 'Verifikasi', FINAL: 'Disetujui', REVERIFY: 'Verifikasi ulang', REAPPROVE: 'Persetujuan ulang', APPOINTMENT: 'Surat penunjukan', ORDER: 'Persetujuan PO/SPK' };
const optional = (v, max = 2000) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
const flag = v => v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
const year = isoDate => Number(isoDate.slice(0, 4));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const mask = value => value ? '••••' + String(value).slice(-4) : value;
function rule(fn) { try { return fn(); } catch (e) { if (e instanceof RangeError) throw new AppError(422, e.message); throw e; } }
// Rujukan dari isian pengguna diperiksa dulu agar pesan kesalahannya jelas di SQLite dan PostgreSQL.
function pick(db, table, id, label) { assert(typeof id === 'string' && id.length > 0 && id.length <= 64, `${label} wajib dipilih.`); return get(db, table, id); }
function versionOf(b) { assert(Number.isInteger(b?.row_version), 'Versi data wajib dikirim. Muat ulang data.', 409); return b.row_version; }

export function purchasingSettings(db) {
  const row = one(db, 'SELECT value FROM app_settings WHERE key=?', SETTINGS_KEY);
  let stored = {};
  if (row) { try { stored = JSON.parse(row.value); } catch { stored = {}; } }
  return R.mergeSettings(stored);
}

// Izin dibaca sekali per permintaan; cakupan unit dihitung di memori (PRD: ≤ 20 query).
export function purchasingAccess(db, user) {
  const rows = grants(db, user).filter(g => g.code.startsWith('purchasing.') || g.code === 'admin.audit.read');
  const unitRows = rows.some(g => g.scope_kind === 'ASSIGNED_UNITS') ? all(db, 'SELECT user_role_id,org_unit_id,include_descendants FROM user_role_units WHERE user_role_id IN (SELECT id FROM user_roles WHERE user_id=?)', user.id) : [];
  const tree = unitRows.some(u => u.include_descendants) ? all(db, 'SELECT id,parent_id FROM org_units') : [];
  const below = root => { const found = new Set([root]); let grew = true; while (grew) { grew = false; for (const u of tree) if (u.parent_id && found.has(u.parent_id) && !found.has(u.id)) { found.add(u.id); grew = true; } } return found; };
  const perms = {};
  for (const g of rows) {
    const p = perms[g.code] || (perms[g.code] = { all: false, self: false, units: new Set() });
    if (g.scope_kind === 'ALL') p.all = true;
    else if (g.scope_kind === 'SELF') p.self = true;
    else if (g.scope_kind === 'ASSIGNED_UNITS') for (const u of unitRows.filter(u => u.user_role_id === g.id)) for (const id of u.include_descendants ? below(u.org_unit_id) : [u.org_unit_id]) p.units.add(id);
  }
  return {
    perms,
    has: code => Boolean(perms[code]),
    allows: (code, ctx = {}) => { const p = perms[code]; if (!p) return false; if (p.all) return true; if (p.self && user.employee_id && ctx.employee_id === user.employee_id) return true; return Boolean(ctx.org_unit_id && p.units.has(ctx.org_unit_id)); },
    broad: code => { const p = perms[code]; return Boolean(p && (p.all || p.units.size)); }
  };
}

export function employeeOnDate(db, employeeId, asOf = today()) {
  return one(db, `SELECT e.id,e.full_name,e.employee_no,e.phone,e.is_active,ep.supervisor_employee_id,p.id position_id,p.name position_name,p.org_unit_id,u.name unit_name,u.code unit_code
    FROM employees e LEFT JOIN employee_placements ep ON ep.employee_id=e.id AND ep.is_primary=1 AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?)
    LEFT JOIN positions p ON p.id=ep.position_id LEFT JOIN org_units u ON u.id=p.org_unit_id WHERE e.id=?`, asOf, asOf, employeeId);
}
function positionHolders(db, positionId, asOf) {
  return all(db, `SELECT DISTINCT e.id,e.full_name,e.employee_no,e.phone,p.name position_name FROM employee_placements ep JOIN employees e ON e.id=ep.employee_id JOIN positions p ON p.id=ep.position_id
    WHERE ep.position_id=? AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?) AND e.is_active=1 ORDER BY e.full_name`, positionId, asOf, asOf);
}
function official(db, settings, kind, asOf) {
  const name = kind === 'SEKBAN' ? 'Sekban' : 'Kaban', positionId = settings.officials[kind === 'SEKBAN' ? 'sekban_position_id' : 'kaban_position_id'];
  assert(positionId, `Posisi ${name} belum dipilih di Pengaturan Pengadaan.`, 409);
  const holders = positionHolders(db, positionId, asOf);
  assert(holders.length === 1, `Posisi ${name} harus punya tepat satu pemegang aktif di data SDM (sekarang ${holders.length}).`, 409);
  return holders[0];
}
function holdsKaban(db, settings, employeeId, asOf) {
  if (!settings.officials.kaban_position_id) return false;
  return positionHolders(db, settings.officials.kaban_position_id, asOf).some(h => h.id === employeeId);
}
function delegatorsOf(db, employeeId, asOf) {
  if (!employeeId) return [];
  return all(db, 'SELECT from_employee_id FROM purchase_delegations WHERE to_employee_id=? AND revoked_at IS NULL AND starts_on<=? AND ends_on>=?', employeeId, asOf, asOf).map(r => r.from_employee_id);
}

function nextSequence(db, docType, key, yr, floor = 0) {
  const row = one(db, 'SELECT * FROM purchase_number_sequences WHERE doc_type=? AND sequence_key=? AND year=?', docType, key, yr);
  if (!row) { const n = Math.max(0, floor) + 1; insert(db, 'purchase_number_sequences', { doc_type: docType, sequence_key: key, year: yr, last_no: n }); return n; }
  const n = Math.max(row.last_no, floor) + 1;
  update(db, 'purchase_number_sequences', row.id, row.row_version, { last_no: n });
  return n;
}
function peekSequence(db, docType, key, yr, floor = 0) {
  const row = one(db, 'SELECT last_no FROM purchase_number_sequences WHERE doc_type=? AND sequence_key=? AND year=?', docType, key, yr);
  return Math.max(row?.last_no || 0, floor) + 1;
}
function raiseSequence(db, docType, key, yr, n) {
  const row = one(db, 'SELECT * FROM purchase_number_sequences WHERE doc_type=? AND sequence_key=? AND year=?', docType, key, yr);
  if (!row) insert(db, 'purchase_number_sequences', { doc_type: docType, sequence_key: key, year: yr, last_no: n });
  else if (n > row.last_no) update(db, 'purchase_number_sequences', row.id, row.row_version, { last_no: n });
}
function numberFloor(settings, kind, yr) { return Number(settings.number_floor.year) === yr ? Number(settings.number_floor[kind]) || 0 : 0; }
function unitCode(settings, request, unit) { return String(settings.unit_codes[request.org_unit_id] || unit?.code || 'UMUM').toUpperCase(); }

function freezeDocument(db, user, request, docType, objectId, number, snapshot) {
  run(db, 'UPDATE purchase_documents SET superseded_at=?,updated_at=?,row_version=row_version+1 WHERE object_id=? AND doc_type=? AND superseded_at IS NULL', now(), now(), objectId, docType);
  const json = R.canonicalJson(snapshot);
  return insert(db, 'purchase_documents', { request_id: request.id, doc_type: docType, object_id: objectId, number, snapshot_json: json, snapshot_hash: sha256(json), verification_code: randomBytes(10).toString('hex'), created_by: user.id });
}

function setStatus(db, request, to, extra = {}) {
  assert(R.canTransition(request.status, to), `PR berstatus ${R.STATUS_LABELS[request.status]} tidak dapat menjadi ${R.STATUS_LABELS[to]}.`, 409);
  return update(db, 'purchase_requests', request.id, request.row_version, { status: to, ...extra });
}
function addStep(db, user, request, stepKind, target, cycle, objectType = 'REQUEST', objectId = request.id) {
  return insert(db, 'purchase_approval_steps', { request_id: request.id, object_type: objectType, object_id: objectId, cycle_no: cycle, step_kind: stepKind, target_kind: target ? 'EMPLOYEE' : 'VERIFIERS', target_employee_id: target?.id || null, target_label: target ? `${target.role}: ${target.full_name}` : 'Verifikator Keuangan', status: 'PENDING', as_delegate: 0, created_by: user.id });
}
function supersedePending(db, requestId, objectId = null) {
  run(db, `UPDATE purchase_approval_steps SET status='SUPERSEDED',acted_at=?,updated_at=?,row_version=row_version+1 WHERE request_id=? AND status='PENDING'${objectId ? ' AND object_id=?' : ''}`, now(), now(), requestId, ...(objectId ? [objectId] : []));
}

// Penyetuju PR, surat penunjukan, dan PO/SPK. Pemohon tidak pernah menyetujui PR-nya sendiri (ATR-PS-12).
function finalTarget(db, settings, request, kind, asOf) {
  let approver = official(db, settings, kind, asOf);
  if (approver.id === request.requester_employee_id && kind === 'SEKBAN') { kind = 'KABAN'; approver = official(db, settings, 'KABAN', asOf); }
  assert(approver.id !== request.requester_employee_id, 'Penyetuju untuk PR yang diajukan Kaban belum ditetapkan (keputusan terbuka di PRD).', 409);
  return { kind, target: { ...approver, role: kind === 'SEKBAN' ? 'Sekban' : 'Kaban' } };
}
function actingAs(db, acc, user, request, step, asOf) {
  assert(step.status === 'PENDING', 'Tahap ini sudah diputuskan. Muat ulang data.', 409);
  assert(user.employee_id, 'Akun Anda belum tertaut ke data pegawai.', 403);
  assert(user.employee_id !== request.requester_employee_id, 'Pemohon tidak boleh bertindak di tahap persetujuan PR-nya sendiri.', 403);
  if (step.target_kind === 'VERIFIERS') {
    assert(acc.allows('purchasing.requests.verify', { org_unit_id: request.org_unit_id }), 'Anda tidak berwenang memverifikasi PR ini.', 403);
    return 0;
  }
  if (step.target_employee_id === user.employee_id) return 0;
  assert(delegatorsOf(db, user.employee_id, asOf).includes(step.target_employee_id), 'Tahap ini menunggu penyetuju lain.', 403);
  return 1;
}
function decide(db, user, me, step, status, reason, asDelegate) {
  return update(db, 'purchase_approval_steps', step.id, step.row_version, { status, actor_user_id: user.id, actor_employee_id: me.id, actor_name: me.full_name, actor_position: me.position_name || null, as_delegate: asDelegate, reason, acted_at: now() });
}

function involvedIn(db, user, request, asOf) {
  if (!user.employee_id) return false;
  const ids = [user.employee_id, ...delegatorsOf(db, user.employee_id, asOf)];
  return Boolean(one(db, `SELECT 1 hit FROM purchase_approval_steps WHERE request_id=? AND (actor_employee_id=? OR target_employee_id IN (${ids.map(() => '?').join(',')})) LIMIT 1`, request.id, user.employee_id, ...ids));
}
function viewOf(db, acc, user, request, asOf) {
  const ctx = { employee_id: request.requester_employee_id, org_unit_id: request.org_unit_id };
  const staff = acc.allows('purchasing.procurement.manage', ctx) || acc.allows('purchasing.requests.verify', ctx);
  const reader = acc.broad('purchasing.requests.read') && acc.allows('purchasing.requests.read', ctx);
  const involved = staff || reader ? true : involvedIn(db, user, request, asOf);
  const own = Boolean(user.employee_id && request.requester_employee_id === user.employee_id);
  return { own, full: staff || reader || involved, staff, any: own || staff || reader || involved };
}
// Lampiran item terlihat oleh semua pihak PR; bukti harga, nota, dan scan pesanan hanya
// untuk pihak yang menangani pengadaan (tampilan pemohon tidak memuat data vendor).
export function purchaseFileAllowed(db, user, link) {
  const request = one(db, 'SELECT * FROM purchase_requests WHERE id=?', link.request_id);
  if (!request) return false;
  const view = viewOf(db, purchasingAccess(db, user), user, request, today());
  return link.owner_type === 'ITEM' ? view.any : view.full;
}

// Link boleh ditulis tanpa skema (mis. www.shopee.co.id/...); dilengkapi https://. Skema lain ditolak.
function linkUrl(value, label) {
  let url = text(value, `${label}: link`, 1000);
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url.replace(/^\/+/, '')}`;
  assert(/^https?:\/\/[^\s/?#]+\.[^\s/?#]+(?:[/?#][^\s]*)?$/i.test(url), `${label}: link tidak valid. Contoh: www.shopee.co.id/nama-produk atau https://tokopedia.com/...`);
  return url;
}
function attachmentList(list, label, required) {
  const rows = list === undefined || list === null ? [] : list;
  assert(Array.isArray(rows) && rows.length <= 10, `${label}: lampiran paling banyak 10.`);
  if (required) assert(rows.length > 0, required);
  return rows.map(a => {
    const form = a?.form;
    assert(['LINK', 'TEXT', 'FILE'].includes(form), `${label}: jenis lampiran tidak valid.`);
    if (form === 'LINK') { const url = linkUrl(a.url, label); return { form, url, note: optional(a.note, 500), file_id: null }; }
    if (form === 'TEXT') return { form, url: null, note: text(a.note, 'Teks detail toko', 2000), file_id: null };
    assert(typeof a.file_id === 'string' && a.file_id, `${label}: berkas belum diunggah.`);
    return { form, url: null, note: optional(a.note, 500), file_id: a.file_id };
  });
}
function saveAttachments(db, user, request, ownerType, ownerId, kind, list, reusable = new Set()) {
  for (const a of list) {
    if (a.file_id && !reusable.has(a.file_id)) claimFile(db, user, a.file_id);
    insert(db, 'purchase_attachments', { request_id: request.id, owner_type: ownerType, owner_id: ownerId, attachment_kind: kind, form: a.form, url: a.url, note: a.note, file_id: a.file_id, created_by: user.id });
  }
}
function parseItems(items, settings) {
  assert(Array.isArray(items) && items.length >= 1, 'PR wajib berisi minimal satu item.');
  assert(items.length <= 100, 'PR paling banyak berisi 100 item.');
  return items.map((it, i) => {
    const label = `Item ${i + 1}`;
    const quantity = rule(() => R.quantityMilli(it?.quantity, `${label}: jumlah`));
    const unitPrice = rule(() => R.money(it?.unit_price, `${label}: harga satuan`));
    const subtotal = rule(() => R.lineSubtotal(quantity, unitPrice));
    const required = R.attachmentRequired(subtotal, settings) ? `${label} wajib punya lampiran karena subtotalnya ${R.formatRupiah(settings.attachment_min_item_subtotal)} atau lebih.` : null;
    assert(['GOODS', 'SERVICE'].includes(it?.item_kind), `${label}: pilih barang atau jasa.`);
    return { description: text(it?.description, `${label}: deskripsi`, 500), item_kind: it.item_kind, quantity_milli: quantity, unit: text(it?.unit, `${label}: satuan`, 40), unit_price: unitPrice, subtotal, reason: text(it?.reason, `${label}: alasan`, 1000), attachments: attachmentList(it?.attachments, label, required) };
  });
}
function saveItems(db, user, request, items, reusable) {
  items.forEach((it, i) => {
    const row = insert(db, 'purchase_request_items', { request_id: request.id, line_no: i + 1, description: it.description, item_kind: it.item_kind, quantity_milli: it.quantity_milli, unit: it.unit, unit_price: it.unit_price, subtotal: it.subtotal, approved_unit_price: it.unit_price, approved_subtotal: it.subtotal, reason: it.reason, status: 'ACTIVE', created_by: user.id });
    saveAttachments(db, user, request, 'ITEM', row.id, 'REFERENCE', it.attachments, reusable);
  });
}

function requesterContext(db, user, acc, settings, asOf) {
  const missing = [];
  if (!acc.has('purchasing.requests.create')) missing.push('Izin mengajukan PR (role Pemohon Pengadaan).');
  if (!user.employee_id) return { me: null, missing: [...missing, 'Akun belum tertaut ke data pegawai.'], kaban: false };
  const me = employeeOnDate(db, user.employee_id, asOf);
  if (!me || me.is_active !== 1) missing.push('Data pegawai tidak aktif.');
  else if (!me.position_id) missing.push('Penempatan utama aktif di data SDM.');
  const kaban = me ? holdsKaban(db, settings, me.id, asOf) : false;
  if (me?.position_id && !me.supervisor_employee_id && !kaban) missing.push('Atasan di penempatan utama (data SDM).');
  if (me?.position_id && !acc.allows('purchasing.requests.create', { employee_id: me.id, org_unit_id: me.org_unit_id })) missing.push('Cakupan izin mengajukan PR untuk diri sendiri.');
  return { me, missing, kaban };
}
function startApproval(db, user, request, settings, kaban, asOf) {
  const cycle = request.revision_no;
  if (kaban) {
    insert(db, 'purchase_approval_steps', { request_id: request.id, object_type: 'REQUEST', object_id: request.id, cycle_no: cycle, step_kind: 'ACKNOWLEDGE', target_kind: 'EMPLOYEE', target_employee_id: request.requester_employee_id, target_label: 'Atasan: dilewati (pemohon Kaban)', status: 'SKIPPED', as_delegate: 0, reason: 'Pemohon pemegang posisi Kaban; tahap Diketahui dilewati (ATR-PJ-12).', acted_at: now(), created_by: user.id });
  } else {
    const supervisor = employeeOnDate(db, request.supervisor_employee_id, asOf);
    assert(supervisor && supervisor.is_active === 1, 'Atasan Anda di data SDM tidak aktif. Hubungi SDM.', 422);
    addStep(db, user, request, 'ACKNOWLEDGE', { ...supervisor, role: 'Atasan' }, cycle);
    return;
  }
  addStep(db, user, request, 'VERIFY', null, cycle);
}

function budgetUsage(db, lineIds) {
  if (!lineIds.length) return {};
  const marks = lineIds.map(() => '?').join(',');
  const requests = all(db, `SELECT id,budget_line_id,status,approved_total FROM purchase_requests WHERE budget_line_id IN (${marks}) AND status NOT IN ('rejected','cancelled')`, ...lineIds);
  const received = all(db, `SELECT o.request_id,CAST(SUM(o.total) AS BIGINT) ordered,CAST(SUM(COALESCE(r.invoice_total,0)) AS BIGINT) invoiced FROM vendor_orders o JOIN order_receipts r ON r.order_id=o.id JOIN purchase_requests q ON q.id=o.request_id WHERE o.status='received' AND q.budget_line_id IN (${marks}) GROUP BY o.request_id`, ...lineIds);
  const usage = Object.fromEntries(lineIds.map(id => [id, { commitment: 0, realization: 0 }]));
  for (const r of requests) {
    const done = received.find(x => x.request_id === r.id);
    if (done) usage[r.budget_line_id].realization += Number(done.invoiced);
    if (ACTIVE_COMMITMENT.includes(r.status)) usage[r.budget_line_id].commitment += Math.max(0, Number(r.approved_total || 0) - Number(done?.ordered || 0));
  }
  return usage;
}
function budgetLines(db, yr) {
  const lines = all(db, 'SELECT l.*,y.year,u.name unit_name FROM budget_lines l JOIN budget_years y ON y.id=l.budget_year_id LEFT JOIN org_units u ON u.id=l.org_unit_id WHERE y.year=? ORDER BY l.code', yr);
  const usage = budgetUsage(db, lines.map(l => l.id));
  return lines.map(l => ({ ...l, ...usage[l.id], remaining: Number(l.ceiling) - usage[l.id].commitment - usage[l.id].realization }));
}

function requestSnapshot(db, settings, request) {
  const items = all(db, "SELECT * FROM purchase_request_items WHERE request_id=? AND status='ACTIVE' ORDER BY line_no", request.id);
  const steps = all(db, "SELECT step_kind,status,actor_name,actor_position,as_delegate,target_label,acted_at,reason FROM purchase_approval_steps WHERE request_id=? AND object_type='REQUEST' AND status IN ('APPROVED','SKIPPED') AND cycle_no=? ORDER BY created_at,id", request.id, request.revision_no);
  const later = all(db, "SELECT step_kind,status,actor_name,actor_position,as_delegate,target_label,acted_at,reason FROM purchase_approval_steps WHERE request_id=? AND object_type='REQUEST' AND status='APPROVED' AND step_kind IN ('REVERIFY','REAPPROVE') ORDER BY created_at,id", request.id);
  const line = request.budget_line_id ? one(db, 'SELECT code,name FROM budget_lines WHERE id=?', request.budget_line_id) : null;
  return {
    organization: settings.organization, request_code: request.request_code, pr_number: request.pr_number, request_date: request.request_date, needed_on: request.needed_on,
    requester: { name: request.requester_name, employee_no: request.requester_no, position: request.position_name, unit: request.unit_name },
    budget_line: line ? `${line.code} — ${line.name}` : null, special_budget: Boolean(request.special_budget), final_approver: request.final_approver_kind,
    items: items.map(i => ({ line_no: i.line_no, description: i.description, kind: i.item_kind, quantity: R.formatQuantity(i.quantity_milli), unit: i.unit, unit_price: Number(i.approved_unit_price), subtotal: Number(i.approved_subtotal), reason: i.reason })),
    total: Number(request.approved_total ?? request.estimated_total), total_words: R.terbilang(Number(request.approved_total ?? request.estimated_total)),
    approvals: [...steps, ...later].map(s => ({ stage: STEP_LABELS[s.step_kind], status: s.status, name: s.actor_name, position: s.actor_position, plh: Boolean(s.as_delegate), on_behalf: s.as_delegate ? s.target_label : null, at: s.acted_at, note: s.status === 'SKIPPED' ? s.reason : null }))
  };
}
function orderSnapshot(db, settings, request, order, doc, approvedAt) {
  const vendor = order.vendor_id ? one(db, 'SELECT * FROM vendors WHERE id=?', order.vendor_id) : null;
  const items = all(db, 'SELECT oi.*,i.description,i.item_kind,i.reason FROM vendor_order_items oi JOIN purchase_request_items i ON i.id=oi.request_item_id WHERE oi.order_id=? ORDER BY i.line_no', order.id);
  return {
    organization: settings.organization, kind: doc.doc_kind, number: doc.number, date: doc.doc_date, request_code: request.request_code, pr_number: request.pr_number,
    vendor: vendor ? { name: vendor.name, address: vendor.address, phone: vendor.phone, contact: vendor.contact_name || vendor.leader_name, leader_name: vendor.leader_name, leader_title: vendor.leader_title, leader_nik: doc.doc_kind === 'SPK' ? vendor.leader_nik : null, bank: vendor.bank_name, branch: vendor.bank_branch, account_no: vendor.account_no, account_name: vendor.account_name } : null,
    work_description: doc.work_description, work_duration_days: doc.work_duration_days, payment_terms: doc.payment_terms, billing_text: doc.billing_text,
    items: items.map(i => ({ description: i.description, quantity: R.formatQuantity(i.quantity_milli), unit: i.unit, calc_volume: i.calc_volume_milli ? R.formatQuantity(i.calc_volume_milli) : null, calc_unit: i.calc_unit, unit_price: Number(i.unit_price), subtotal: Number(i.subtotal), needed_on: i.needed_on, note: i.reason })),
    total: Number(order.total), total_words: R.terbilang(Number(order.total)),
    signer: { name: doc.signer_name, position: doc.signer_position, approved_at: approvedAt }
  };
}

function loadRequest(db, id) { return get(db, 'purchase_requests', id); }
function assertStaff(acc, request, message = 'Hanya Purchasing yang dapat melakukan tindakan ini.') {
  assert(acc.allows('purchasing.procurement.manage', { org_unit_id: request.org_unit_id }), message, 403);
}
function openOrderItems(db, requestId) {
  return all(db, "SELECT oi.request_item_id,o.id order_id,o.status FROM vendor_order_items oi JOIN vendor_orders o ON o.id=oi.order_id WHERE o.request_id=? AND o.status<>'cancelled'", requestId);
}
function completeIfDone(db, request) {
  const fresh = loadRequest(db, request.id);
  if (fresh.status !== 'in_procurement') return fresh;
  const orders = all(db, "SELECT id,status FROM vendor_orders WHERE request_id=? AND status<>'cancelled'", fresh.id);
  const active = all(db, "SELECT id FROM purchase_request_items WHERE request_id=? AND status='ACTIVE'", fresh.id);
  const covered = new Set(openOrderItems(db, fresh.id).map(r => r.request_item_id));
  if (orders.length && orders.every(o => o.status === 'received') && active.every(i => covered.has(i.id))) return setStatus(db, fresh, 'completed', { completed_at: now() });
  return fresh;
}

function createOrder(db, user, request, path, vendor, storeName, lines, docKind) {
  const total = rule(() => R.sum(lines.map(l => l.subtotal)));
  const order = insert(db, 'vendor_orders', { request_id: request.id, vendor_id: vendor?.id || null, store_name: storeName, path, document_kind: docKind, status: path === 'A' ? 'ordered' : 'draft', total, due_on: path === 'A' ? request.needed_on : null, created_by: user.id });
  for (const l of lines) insert(db, 'vendor_order_items', { order_id: order.id, request_item_id: l.item.id, quantity_milli: l.item.quantity_milli, unit: l.item.unit, unit_price: l.unit_price, subtotal: l.subtotal, needed_on: request.needed_on, created_by: user.id });
  return order;
}
function pricedLines(items, prices) {
  const over = [];
  const lines = items.map(item => {
    const unitPrice = rule(() => R.money(prices[item.id], `Harga item ${item.line_no}`));
    const subtotal = rule(() => R.lineSubtotal(item.quantity_milli, unitPrice));
    if (subtotal > Number(item.approved_subtotal)) over.push(item.line_no);
    return { item, unit_price: unitPrice, subtotal };
  });
  assert(!over.length, `Harga item ${over.join(', ')} lebih tinggi dari yang disetujui. Ajukan konfirmasi ulang ke pemohon terlebih dahulu (ATR-PG-09).`, 409);
  return lines;
}
function orderDocumentValues(b, settings, kind) {
  const d = b && typeof b === 'object' ? b : {};
  const docKind = d.doc_kind === undefined ? kind : d.doc_kind;
  assert(['PO', 'SPK'].includes(docKind), 'Jenis dokumen harus PO atau SPK.');
  const duration = d.work_duration_days === undefined || d.work_duration_days === null || d.work_duration_days === '' ? null : Number(d.work_duration_days);
  assert(duration === null || (Number.isInteger(duration) && duration > 0 && duration <= 3650), 'Lama pengerjaan harus 1–3650 hari.');
  return { doc_kind: docKind, work_description: optional(d.work_description, 1000), work_duration_days: duration, payment_terms: optional(d.payment_terms, 500) || settings.texts.payment_terms, billing_text: optional(d.billing_text, 3000) || settings.texts.billing_text };
}
function submitOrder(db, user, settings, request, order, b) {
  assert(order.status === 'draft' && order.path !== 'A', 'Pesanan ini tidak dapat diajukan.', 409);
  const doc = one(db, 'SELECT * FROM vendor_order_documents WHERE order_id=?', order.id);
  assert(doc, 'Lengkapi isi PO/SPK terlebih dahulu.');
  if (doc.doc_kind === 'SPK') assert(doc.work_description && doc.work_duration_days, 'SPK wajib berisi uraian pekerjaan dan lama pengerjaan.');
  const asOf = today();
  if (order.path === 'C') {
    const reason = text(b?.reason, 'Alasan tanpa pembanding', 2000);
    const evidence = attachmentList(b?.evidence, 'Bukti harga vendor', 'Bukti harga dari vendor wajib dilampirkan (ATR-PG-06).');
    const appointment = insert(db, 'vendor_appointments', { order_id: order.id, reason, status: 'PENDING', created_by: user.id });
    saveAttachments(db, user, request, 'APPOINTMENT', appointment.id, 'PRICE_EVIDENCE', evidence);
    const { target } = finalTarget(db, settings, request, 'KABAN', asOf);
    addStep(db, user, request, 'APPOINTMENT', target, request.revision_no, 'APPOINTMENT', appointment.id);
    return update(db, 'vendor_orders', order.id, order.row_version, { status: 'pending_appointment_approval' });
  }
  const { target } = finalTarget(db, settings, request, request.final_approver_kind || 'KABAN', asOf);
  addStep(db, user, request, 'ORDER', target, request.revision_no, 'ORDER', order.id);
  return update(db, 'vendor_orders', order.id, order.row_version, { status: 'pending_order_approval' });
}
function issueOrderDocument(db, user, settings, request, order, step, approvedBy) {
  const doc = one(db, 'SELECT * FROM vendor_order_documents WHERE order_id=?', order.id);
  const issued = today(), yr = year(issued);
  const number = R.documentNumber(doc.doc_kind, nextSequence(db, doc.doc_kind, 'PURCHASE', yr, numberFloor(settings, doc.doc_kind, yr)), issued);
  const target = employeeOnDate(db, step.target_employee_id, issued);
  const saved = update(db, 'vendor_order_documents', doc.id, doc.row_version, { number, doc_date: issued, signer_employee_id: step.target_employee_id, signer_name: target?.full_name || approvedBy.full_name, signer_position: target?.position_name || approvedBy.position_name || null });
  const items = all(db, 'SELECT needed_on FROM vendor_order_items WHERE order_id=? ORDER BY needed_on', order.id);
  const due = saved.doc_kind === 'SPK' && saved.work_duration_days ? R.addDays(issued, saved.work_duration_days) : items[0]?.needed_on || request.needed_on;
  const fresh = update(db, 'vendor_orders', order.id, order.row_version, { status: 'ordered', due_on: due });
  freezeDocument(db, user, request, saved.doc_kind, order.id, number, orderSnapshot(db, settings, request, fresh, saved, now()));
  return fresh;
}

function requestRow(r) { return { ...r, estimated_total: Number(r.estimated_total), approved_total: r.approved_total === null ? null : Number(r.approved_total), status_label: R.STATUS_LABELS[r.status] }; }
function listRequests(db, acc, user, view, url) {
  const asOf = today(), status = url.searchParams.get('status') || '', yr = Number(url.searchParams.get('year')) || null;
  let rows, waiting = new Map();
  if (view === 'mine') {
    assert(user.employee_id, 'Akun belum tertaut ke data pegawai.', 403);
    rows = all(db, 'SELECT * FROM purchase_requests WHERE requester_employee_id=? ORDER BY created_at DESC', user.employee_id);
  } else if (view === 'approvals') {
    const steps = pendingSteps(db, acc, user, asOf);
    for (const s of steps) if (!waiting.has(s.request_id)) waiting.set(s.request_id, s);
    const ids = [...waiting.keys()];
    rows = ids.length ? all(db, `SELECT * FROM purchase_requests WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids) : [];
  } else if (view === 'procurement') {
    assert(acc.has('purchasing.procurement.manage'), 'Hanya Purchasing yang dapat membuka antrean ini.', 403);
    rows = all(db, "SELECT * FROM purchase_requests WHERE status IN ('pending_completeness_check','in_procurement','pending_requester_confirmation','pending_reverification','pending_reapproval') ORDER BY updated_at").filter(r => acc.allows('purchasing.procurement.manage', { org_unit_id: r.org_unit_id }));
  } else {
    const readable = ['purchasing.requests.read', 'purchasing.requests.verify', 'purchasing.procurement.manage'];
    assert(readable.some(code => acc.broad(code)), 'Anda tidak memiliki akses ke daftar PR.', 403);
    rows = all(db, 'SELECT * FROM purchase_requests ORDER BY created_at DESC').filter(r => readable.some(code => acc.allows(code, { org_unit_id: r.org_unit_id, employee_id: r.requester_employee_id })));
  }
  rows = rows.filter(r => (!status || r.status === status) && (!yr || year(r.request_date) === yr));
  const ids = rows.map(r => r.id);
  const orders = ids.length ? all(db, `SELECT request_id,status,due_on FROM vendor_orders WHERE request_id IN (${ids.map(() => '?').join(',')}) AND status<>'cancelled'`, ...ids) : [];
  const counts = ids.length ? all(db, `SELECT request_id,count(*) n FROM purchase_request_items WHERE status='ACTIVE' AND request_id IN (${ids.map(() => '?').join(',')}) GROUP BY request_id`, ...ids) : [];
  const items = rows.map(r => {
    const step = waiting.get(r.id);
    return { ...requestRow(r), item_count: Number(counts.find(c => c.request_id === r.id)?.n || 0), late: orders.some(o => o.request_id === r.id && R.isLate(o, asOf)), waiting_step: step ? { id: step.id, kind: step.step_kind, label: STEP_LABELS[step.step_kind], since: step.created_at, object_type: step.object_type, object_id: step.object_id } : null };
  });
  if (view === 'approvals') items.sort((a, b) => a.waiting_step.since.localeCompare(b.waiting_step.since));
  return { items };
}
function pendingSteps(db, acc, user, asOf) {
  const ids = user.employee_id ? [user.employee_id, ...delegatorsOf(db, user.employee_id, asOf)] : [];
  const mine = ids.length ? all(db, `SELECT s.*,r.requester_employee_id FROM purchase_approval_steps s JOIN purchase_requests r ON r.id=s.request_id WHERE s.status='PENDING' AND s.target_kind='EMPLOYEE' AND s.target_employee_id IN (${ids.map(() => '?').join(',')}) ORDER BY s.created_at`, ...ids) : [];
  const verify = acc.has('purchasing.requests.verify') ? all(db, "SELECT s.*,r.requester_employee_id,r.org_unit_id FROM purchase_approval_steps s JOIN purchase_requests r ON r.id=s.request_id WHERE s.status='PENDING' AND s.target_kind='VERIFIERS' ORDER BY s.created_at").filter(s => acc.allows('purchasing.requests.verify', { org_unit_id: s.org_unit_id })) : [];
  return [...mine, ...verify].filter(s => s.requester_employee_id !== user.employee_id);
}

function requestDetail(db, acc, user, settings, request) {
  const asOf = today(), view = viewOf(db, acc, user, request, asOf);
  assert(view.any, 'Anda tidak memiliki akses ke PR ini.', 403);
  const items = all(db, 'SELECT * FROM purchase_request_items WHERE request_id=? ORDER BY line_no', request.id);
  const attachments = all(db, 'SELECT a.*,f.original_name,f.mime_type,f.size_bytes FROM purchase_attachments a LEFT JOIN files f ON f.id=a.file_id WHERE a.request_id=? ORDER BY a.created_at,a.id', request.id);
  const steps = all(db, 'SELECT * FROM purchase_approval_steps WHERE request_id=? ORDER BY created_at,id', request.id);
  const confirmations = all(db, 'SELECT * FROM purchase_price_confirmations WHERE request_id=? ORDER BY round_no,created_at', request.id);
  const documents = all(db, 'SELECT id,doc_type,object_id,number,snapshot_hash,verification_code,superseded_at,created_at FROM purchase_documents WHERE request_id=? ORDER BY created_at', request.id);
  const sensitive = acc.allows('purchasing.vendors.sensitive', { org_unit_id: request.org_unit_id });
  let quotes = [], orders = [];
  if (view.full) {
    quotes = all(db, 'SELECT * FROM purchase_price_quotes WHERE request_id=? ORDER BY item_id,unit_price,created_at', request.id);
    const orderRows = all(db, 'SELECT o.*,v.name vendor_name,v.address vendor_address,v.phone vendor_phone,v.leader_name vendor_leader,v.account_no,v.account_name,v.bank_name,v.leader_nik FROM vendor_orders o LEFT JOIN vendors v ON v.id=o.vendor_id WHERE o.request_id=? ORDER BY o.created_at', request.id);
    const orderItems = all(db, 'SELECT oi.*,i.line_no,i.description FROM vendor_order_items oi JOIN vendor_orders o ON o.id=oi.order_id JOIN purchase_request_items i ON i.id=oi.request_item_id WHERE o.request_id=? ORDER BY i.line_no', request.id);
    const docs = all(db, 'SELECT d.* FROM vendor_order_documents d JOIN vendor_orders o ON o.id=d.order_id WHERE o.request_id=?', request.id);
    const appointments = all(db, 'SELECT a.* FROM vendor_appointments a JOIN vendor_orders o ON o.id=a.order_id WHERE o.request_id=? ORDER BY a.created_at', request.id);
    const receipts = all(db, 'SELECT r.* FROM order_receipts r JOIN vendor_orders o ON o.id=r.order_id WHERE o.request_id=?', request.id);
    orders = orderRows.map(o => ({
      id: o.id, path: o.path, document_kind: o.document_kind, status: o.status, store_name: o.store_name, vendor_id: o.vendor_id, total: Number(o.total), due_on: o.due_on, late: R.isLate(o, asOf), cancelled_reason: o.cancelled_reason, row_version: o.row_version,
      vendor: o.vendor_id ? { name: o.vendor_name, address: o.vendor_address, phone: o.vendor_phone, leader_name: o.vendor_leader, ...(sensitive ? { bank_name: o.bank_name, account_no: o.account_no, account_name: o.account_name, leader_nik: o.leader_nik } : {}) } : null,
      items: orderItems.filter(i => i.order_id === o.id).map(i => ({ ...i, unit_price: Number(i.unit_price), subtotal: Number(i.subtotal), purchase_unit_price: i.purchase_unit_price === null ? null : Number(i.purchase_unit_price) })),
      document: docs.find(d => d.order_id === o.id) || null, appointments: appointments.filter(a => a.order_id === o.id), receipt: receipts.find(r => r.order_id === o.id) || null,
      attachments: attachments.filter(a => a.owner_type === 'ORDER' && a.owner_id === o.id)
    }));
  } else {
    orders = all(db, "SELECT id,status,due_on FROM vendor_orders WHERE request_id=? AND status<>'cancelled' ORDER BY created_at", request.id).map(o => ({ id: o.id, status: o.status, due_on: o.due_on, late: R.isLate(o, asOf) }));
  }
  const pending = steps.filter(s => s.status === 'PENDING');
  const delegators = user.employee_id ? delegatorsOf(db, user.employee_id, asOf) : [];
  const myStep = pending.find(s => {
    if (!user.employee_id || user.employee_id === request.requester_employee_id) return false;
    if (s.target_kind === 'VERIFIERS') return acc.allows('purchasing.requests.verify', { org_unit_id: request.org_unit_id });
    return s.target_employee_id === user.employee_id || delegators.includes(s.target_employee_id);
  });
  const staff = acc.allows('purchasing.procurement.manage', { org_unit_id: request.org_unit_id });
  const covered = new Set(orders.filter(o => o.status !== 'cancelled' && o.items).flatMap(o => o.items.map(i => i.request_item_id)));
  const total = Number(request.approved_total ?? request.estimated_total);
  let suggestion = null;
  if (staff && request.status === 'pending_completeness_check') {
    const unit = one(db, 'SELECT code FROM org_units WHERE id=?', request.org_unit_id), key = unitCode(settings, request, unit), yr = year(asOf);
    suggestion = R.documentNumber('PR', peekSequence(db, 'PR', key, yr), asOf, key);
  }
  return {
    ...requestRow(request), view: view.full ? 'full' : 'requester',
    items: items.map(i => ({ ...i, unit_price: Number(i.unit_price), subtotal: Number(i.subtotal), approved_unit_price: Number(i.approved_unit_price), approved_subtotal: Number(i.approved_subtotal), quantity: R.formatQuantity(i.quantity_milli), ordered: covered.has(i.id), attachments: attachments.filter(a => a.owner_type === 'ITEM' && a.owner_id === i.id),
      quotes: quotes.filter(q => q.item_id === i.id).map(q => ({ ...q, unit_price: Number(q.unit_price), attachments: attachments.filter(a => a.owner_type === 'QUOTE' && a.owner_id === q.id) })) })),
    steps: steps.map(s => ({ ...s, label: STEP_LABELS[s.step_kind] })),
    confirmations: confirmations.map(c => ({ ...c, old_unit_price: Number(c.old_unit_price), new_unit_price: Number(c.new_unit_price), old_subtotal: Number(c.old_subtotal), new_subtotal: Number(c.new_subtotal) })),
    orders, documents, budget_line: request.budget_line_id ? budgetLines(db, year(request.request_date)).find(l => l.id === request.budget_line_id) || null : null,
    allowed_paths: R.allowedPaths(total, settings), suggested_pr_number: suggestion,
    actions: {
      step: myStep ? { id: myStep.id, kind: myStep.step_kind, label: STEP_LABELS[myStep.step_kind], object_type: myStep.object_type, object_id: myStep.object_id, as_delegate: myStep.target_kind === 'EMPLOYEE' && myStep.target_employee_id !== user.employee_id } : null,
      revise: view.own && request.status === 'returned', cancel: view.own && CANCELLABLE.includes(request.status) && !request.pr_number,
      answer: view.own && request.status === 'pending_requester_confirmation',
      completeness: staff && request.status === 'pending_completeness_check', procure: staff && request.status === 'in_procurement',
      reassign: acc.has('purchasing.settings.manage') && pending.some(s => s.target_kind === 'EMPLOYEE'),
      verify_budget: acc.allows('purchasing.requests.verify', { org_unit_id: request.org_unit_id })
    }
  };
}

function vendorRow(v, sensitive) {
  const base = { id: v.id, name: v.name, leader_name: v.leader_name, leader_title: v.leader_title, contact_name: v.contact_name, address: v.address, phone: v.phone, notes: v.notes, is_active: v.is_active, row_version: v.row_version };
  return { ...base, bank_name: v.bank_name, bank_branch: v.bank_branch, account_name: v.account_name, leader_nik: sensitive ? v.leader_nik : mask(v.leader_nik), account_no: sensitive ? v.account_no : mask(v.account_no) };
}
function vendorValues(b, old, sensitive) {
  const pick = (key, max) => b[key] === undefined ? old?.[key] ?? null : optional(b[key], max);
  // Tanpa izin data sensitif, NIK dan rekening hanya terlihat tersamar sehingga tidak boleh diubah.
  const nik = sensitive ? pick('leader_nik', 32) : old?.leader_nik ?? null, account = sensitive ? pick('account_no', 40) : old?.account_no ?? null;
  assert(!nik || /^\d{16}$/.test(nik), 'NIK pimpinan harus 16 digit angka.');
  assert(!account || /^[0-9 .-]{4,40}$/.test(account), 'Nomor rekening hanya boleh angka, spasi, titik, atau tanda hubung.');
  return { name: text(b.name === undefined ? old?.name : b.name, 'Nama vendor', 200), leader_name: pick('leader_name', 200), leader_title: pick('leader_title', 120), leader_nik: nik, contact_name: pick('contact_name', 200), address: pick('address', 500), phone: pick('phone', 40), bank_name: pick('bank_name', 120), bank_branch: pick('bank_branch', 120), account_no: account, account_name: pick('account_name', 200), notes: pick('notes', 1000), is_active: b.is_active === undefined ? old?.is_active ?? 1 : flag(b.is_active) };
}

function settingsValues(db, b, current) {
  const s = b && typeof b === 'object' ? b : {};
  const amount = (key, label) => s[key] === undefined ? current[key] : rule(() => R.money(s[key], label));
  const next = R.mergeSettings({ ...current, ...s,
    sekban_max_total: amount('sekban_max_total', 'Batas penyetuju Sekban'), attachment_min_item_subtotal: amount('attachment_min_item_subtotal', 'Batas lampiran wajib'), comparison_min_total: amount('comparison_min_total', 'Batas perbandingan harga'),
    officials: { ...current.officials, ...(s.officials || {}) }, number_floor: { ...current.number_floor, ...(s.number_floor || {}) }, organization: { ...current.organization, ...(s.organization || {}) }, texts: { ...current.texts, ...(s.texts || {}) }, unit_codes: s.unit_codes === undefined ? current.unit_codes : s.unit_codes });
  const quotes = Number(next.min_quotes_per_item);
  assert(Number.isInteger(quotes) && quotes >= 2 && quotes <= 5, 'Jumlah harga pembanding minimal 2–5.');
  for (const key of ['sekban_position_id', 'kaban_position_id']) if (next.officials[key]) pick(db, 'positions', next.officials[key], 'Posisi pejabat');
  assert(!next.officials.sekban_position_id || next.officials.sekban_position_id !== next.officials.kaban_position_id, 'Posisi Sekban dan Kaban harus berbeda.');
  const floorYear = next.number_floor.year === null || next.number_floor.year === '' ? null : Number(next.number_floor.year);
  assert(floorYear === null || (Number.isInteger(floorYear) && floorYear >= 2000 && floorYear <= 2100), 'Tahun nomor awal tidak valid.');
  const floor = { year: floorYear };
  for (const kind of ['PO', 'SPK', 'SPV']) { const n = Number(next.number_floor[kind] || 0); assert(Number.isInteger(n) && n >= 0 && n < 100000, `Nomor terakhir ${kind} tidak valid.`); floor[kind] = n; }
  assert(next.unit_codes && typeof next.unit_codes === 'object' && !Array.isArray(next.unit_codes), 'Kode unit tidak valid.');
  const codes = {};
  for (const [unitId, code] of Object.entries(next.unit_codes)) { if (!code) continue; assert(/^[A-Za-z0-9_-]{1,20}$/.test(String(code)), 'Kode unit untuk nomor PR hanya huruf, angka, garis bawah, atau tanda hubung (maks. 20).'); pick(db, 'org_units', unitId, 'Unit'); codes[unitId] = String(code).toUpperCase(); }
  const organization = { name: text(next.organization.name, 'Nama badan', 300), short_name: optional(next.organization.short_name, 100) || '', address: optional(next.organization.address, 500) || '', city: optional(next.organization.city, 100) || '' };
  const texts = { payment_terms: text(next.texts.payment_terms, 'Termin pembayaran', 500), billing_text: text(next.texts.billing_text, 'Teks dokumen penagihan', 3000) };
  return { sekban_max_total: next.sekban_max_total, attachment_min_item_subtotal: next.attachment_min_item_subtotal, comparison_min_total: next.comparison_min_total, min_quotes_per_item: quotes, officials: { sekban_position_id: next.officials.sekban_position_id || null, kaban_position_id: next.officials.kaban_position_id || null }, unit_codes: codes, number_floor: floor, organization, texts };
}

function reportRows(db, acc, yr) {
  const rows = all(db, 'SELECT * FROM purchase_requests ORDER BY created_at').filter(r => year(r.request_date) === yr && acc.allows('purchasing.reports.read', { org_unit_id: r.org_unit_id, employee_id: r.requester_employee_id }));
  return rows;
}

export async function purchasingRoutes(c) {
  const { db, user, p, method: m, body: b, url } = c;
  if (p[0] !== 'purchasing') return undefined;
  const acc = purchasingAccess(db, user), settings = purchasingSettings(db), asOf = today();
  const section = p[1], id = p[2], action = p[3];

  if (section === 'overview' && m === 'GET') {
    const ctx = requesterContext(db, user, acc, settings, asOf);
    const mine = user.employee_id ? all(db, "SELECT status FROM purchase_requests WHERE requester_employee_id=? AND status IN ('returned','pending_requester_confirmation')", user.employee_id) : [];
    const approvals = pendingSteps(db, acc, user, asOf);
    const queue = acc.has('purchasing.procurement.manage') ? all(db, "SELECT status,org_unit_id FROM purchase_requests WHERE status IN ('pending_completeness_check','in_procurement')").filter(r => acc.allows('purchasing.procurement.manage', { org_unit_id: r.org_unit_id })) : [];
    const supervisor = ctx.me?.supervisor_employee_id ? one(db, 'SELECT full_name FROM employees WHERE id=?', ctx.me.supervisor_employee_id) : null;
    return {
      me: ctx.me ? { employee_id: ctx.me.id, name: ctx.me.full_name, employee_no: ctx.me.employee_no, position: ctx.me.position_name, unit: ctx.me.unit_name, supervisor: supervisor?.full_name || (ctx.kaban ? 'Tidak ada (pemohon Kaban)' : null) } : null,
      can_submit: !ctx.missing.length, missing: ctx.missing,
      counts: { my_action: mine.length, approvals: approvals.length, completeness: queue.filter(r => r.status === 'pending_completeness_check').length, procurement: queue.filter(r => r.status === 'in_procurement').length },
      rules: { sekban_max_total: settings.sekban_max_total, attachment_min_item_subtotal: settings.attachment_min_item_subtotal, comparison_min_total: settings.comparison_min_total, min_quotes_per_item: settings.min_quotes_per_item },
      capabilities: { submit: acc.has('purchasing.requests.create'), read_all: ['purchasing.requests.read', 'purchasing.requests.verify', 'purchasing.procurement.manage'].some(code => acc.broad(code)), verify: acc.has('purchasing.requests.verify'), procurement: acc.has('purchasing.procurement.manage'), vendors: acc.has('purchasing.vendors.read'), vendors_manage: acc.has('purchasing.vendors.manage'), budget: acc.has('purchasing.budget.read'), budget_manage: acc.has('purchasing.budget.manage'), reports: acc.has('purchasing.reports.read'), export: acc.has('purchasing.reports.export'), settings: acc.has('purchasing.settings.manage') }
    };
  }

  if (section === 'lookups' && m === 'GET') {
    const staff = acc.has('purchasing.procurement.manage'), admin = acc.has('purchasing.settings.manage'), finance = acc.has('purchasing.requests.verify') || acc.has('purchasing.budget.read');
    assert(staff || admin || finance || acc.has('purchasing.vendors.read'), 'Akses pilihan data ditolak.', 403);
    const yr = Number(url.searchParams.get('year')) || year(asOf);
    return {
      vendors: staff || acc.has('purchasing.vendors.read') ? all(db, 'SELECT id,name,address,phone FROM vendors WHERE is_active=1 ORDER BY name') : [],
      budget_lines: staff || finance ? budgetLines(db, yr).filter(l => l.is_active) : [],
      employees: staff || admin ? all(db, 'SELECT id,full_name,employee_no FROM employees WHERE is_active=1 ORDER BY full_name') : [],
      positions: admin ? all(db, 'SELECT p.id,p.name,u.name unit_name FROM positions p JOIN org_units u ON u.id=p.org_unit_id WHERE p.is_active=1 ORDER BY p.name') : [],
      units: admin || finance ? all(db, 'SELECT id,code,name FROM org_units WHERE is_active=1 ORDER BY name') : []
    };
  }

  if (section === 'requests') {
    if (!id && m === 'GET') return listRequests(db, acc, user, url.searchParams.get('view') || 'mine', url);
    if (!id && m === 'POST') return tx(db, () => {
      const ctx = requesterContext(db, user, acc, settings, asOf);
      assert(!ctx.missing.length, `PR belum dapat dikirim. Lengkapi: ${ctx.missing.join(' ')}`, ctx.missing.some(x => x.startsWith('Izin')) ? 403 : 422);
      const neededOn = date(b.needed_on, 'Tanggal barang dibutuhkan');
      assert(neededOn >= asOf, 'Tanggal barang dibutuhkan tidak boleh sebelum hari ini.');
      const items = parseItems(b.items, settings), total = rule(() => R.sum(items.map(i => i.subtotal)));
      const me = ctx.me, code = R.requestCode(year(asOf), nextSequence(db, 'PJ', 'ALL', year(asOf)));
      const request = insert(db, 'purchase_requests', { request_code: code, requester_employee_id: me.id, submitted_by: user.id, org_unit_id: me.org_unit_id, requester_name: me.full_name, requester_no: me.employee_no, position_name: me.position_name, unit_name: me.unit_name, supervisor_employee_id: ctx.kaban ? null : me.supervisor_employee_id, request_date: asOf, needed_on: neededOn, special_budget: 0, status: ctx.kaban ? 'pending_verification' : 'pending_acknowledgement', estimated_total: total, revision_no: 1, confirmation_round: 0, created_by: user.id });
      saveItems(db, user, request, items);
      startApproval(db, user, request, settings, ctx.kaban, asOf);
      audit(db, user, 'SUBMIT', 'purchase_requests', request.id, { request_code: code, total, items: items.length });
      return requestDetail(db, acc, user, settings, loadRequest(db, request.id));
    });
    if (!id) return undefined;
    const request = loadRequest(db, id);
    if (!action && m === 'GET') return requestDetail(db, acc, user, settings, request);

    if (!action && m === 'PATCH') return tx(db, () => {
      assert(user.employee_id === request.requester_employee_id, 'Hanya pemohon yang dapat merevisi PR ini.', 403);
      assert(request.status === 'returned', 'Hanya PR yang dikembalikan yang dapat direvisi.', 409);
      assert(request.row_version === versionOf(b), 'PR sudah berubah. Muat ulang data.', 409);
      const neededOn = date(b.needed_on, 'Tanggal barang dibutuhkan');
      assert(neededOn >= request.request_date, 'Tanggal barang dibutuhkan tidak boleh sebelum tanggal pengajuan.');
      const items = parseItems(b.items, settings), total = rule(() => R.sum(items.map(i => i.subtotal)));
      const kept = new Set(all(db, "SELECT file_id FROM purchase_attachments WHERE request_id=? AND owner_type='ITEM' AND file_id IS NOT NULL", request.id).map(r => r.file_id));
      run(db, "DELETE FROM purchase_attachments WHERE request_id=? AND owner_type='ITEM'", request.id);
      run(db, 'DELETE FROM purchase_request_items WHERE request_id=?', request.id);
      const ctx = requesterContext(db, user, acc, settings, asOf);
      assert(!ctx.missing.length, `PR belum dapat dikirim ulang. Lengkapi: ${ctx.missing.join(' ')}`);
      saveItems(db, user, request, items, kept);
      const revised = setStatus(db, request, ctx.kaban ? 'pending_verification' : 'pending_acknowledgement', { needed_on: neededOn, estimated_total: total, revision_no: request.revision_no + 1, supervisor_employee_id: ctx.kaban ? null : ctx.me.supervisor_employee_id, budget_line_id: null, special_budget: 0, final_approver_kind: null });
      startApproval(db, user, revised, settings, ctx.kaban, asOf);
      audit(db, user, 'REVISE', 'purchase_requests', request.id, { revision_no: revised.revision_no, total });
      return requestDetail(db, acc, user, settings, loadRequest(db, request.id));
    });

    if (action === 'cancel' && m === 'POST') return tx(db, () => {
      assert(user.employee_id === request.requester_employee_id, 'Hanya pemohon yang dapat membatalkan PR ini.', 403);
      assert(CANCELLABLE.includes(request.status) && !request.pr_number, 'PR hanya dapat dibatalkan sebelum nomor PR terbit.', 409);
      assert(request.row_version === versionOf(b), 'PR sudah berubah. Muat ulang data.', 409);
      supersedePending(db, request.id);
      setStatus(db, request, 'cancelled', { closed_reason: optional(b.reason, 1000) || 'Dibatalkan pemohon.', closed_at: now() });
      audit(db, user, 'CANCEL', 'purchase_requests', request.id, {}, optional(b.reason, 1000) || '');
      return requestDetail(db, acc, user, settings, loadRequest(db, request.id));
    });

    if (action === 'decide' && m === 'POST') return tx(db, () => {
      const step = pick(db, 'purchase_approval_steps', b.step_id, 'Tahap');
      assert(step.request_id === request.id && step.object_type === 'REQUEST', 'Tahap tidak sesuai dengan PR ini.', 422);
      assert(request.row_version === versionOf(b), 'PR sudah berubah. Muat ulang data.', 409);
      const asDelegate = actingAs(db, acc, user, request, step, asOf);
      const me = employeeOnDate(db, user.employee_id, asOf);
      const verdict = b.action;
      assert(['APPROVE', 'RETURN', 'REJECT'].includes(verdict), 'Tindakan tidak valid.');
      const reason = verdict === 'APPROVE' ? optional(b.reason, 2000) : text(b.reason, verdict === 'RETURN' ? 'Alasan pengembalian' : 'Alasan penolakan', 2000);
      if (verdict === 'RETURN') assert(['ACKNOWLEDGE', 'VERIFY', 'FINAL'].includes(step.step_kind), 'Tahap ini hanya dapat disetujui atau ditolak.');
      const expected = { ACKNOWLEDGE: 'pending_acknowledgement', VERIFY: 'pending_verification', FINAL: 'pending_final_approval', REVERIFY: 'pending_reverification', REAPPROVE: 'pending_reapproval' }[step.step_kind];
      assert(request.status === expected, 'Status PR tidak sesuai dengan tahap ini. Muat ulang data.', 409);
      if (verdict !== 'APPROVE') {
        decide(db, user, me, step, verdict === 'RETURN' ? 'RETURNED' : 'REJECTED', reason, asDelegate);
        supersedePending(db, request.id);
        setStatus(db, request, verdict === 'RETURN' ? 'returned' : 'rejected', verdict === 'REJECT' ? { closed_reason: reason, closed_at: now() } : {});
        audit(db, user, verdict, 'purchase_requests', request.id, { step: step.step_kind }, reason);
        return requestDetail(db, acc, user, settings, loadRequest(db, request.id));
      }
      if (step.step_kind === 'ACKNOWLEDGE') {
        decide(db, user, me, step, 'APPROVED', reason, asDelegate);
        addStep(db, user, setStatus(db, request, 'pending_verification'), 'VERIFY', null, request.revision_no);
      } else if (step.step_kind === 'VERIFY') {
        const line = pick(db, 'budget_lines', b.budget_line_id, 'Pos RKA');
        assert(line.is_active, 'Pos RKA tidak aktif.');
        const special = flag(b.special_budget);
        const { kind, target } = finalTarget(db, settings, request, R.finalApproverKind(Number(request.estimated_total), special, settings), asOf);
        decide(db, user, me, step, 'APPROVED', reason, asDelegate);
        const updated = setStatus(db, request, 'pending_final_approval', { budget_line_id: line.id, special_budget: special, final_approver_kind: kind });
        addStep(db, user, updated, 'FINAL', target, request.revision_no);
      } else if (step.step_kind === 'FINAL') {
        decide(db, user, me, step, 'APPROVED', reason, asDelegate);
        const approved = setStatus(db, request, 'pending_completeness_check', { approved_total: request.estimated_total });
        freezeDocument(db, user, approved, 'PR', approved.id, approved.pr_number, requestSnapshot(db, settings, approved));
      } else if (step.step_kind === 'REVERIFY') {
        const round = request.confirmation_round;
        for (const c of all(db, "SELECT * FROM purchase_price_confirmations WHERE request_id=? AND round_no=? AND answer='ACCEPTED'", request.id, round)) {
          const item = get(db, 'purchase_request_items', c.item_id);
          update(db, 'purchase_request_items', item.id, item.row_version, { approved_unit_price: c.new_unit_price, approved_subtotal: c.new_subtotal });
        }
        const approved = all(db, "SELECT approved_subtotal FROM purchase_request_items WHERE request_id=? AND status='ACTIVE'", request.id);
        const total = rule(() => R.sum(approved.map(i => i.approved_subtotal)));
        decide(db, user, me, step, 'APPROVED', reason, asDelegate);
        const needsKaban = request.final_approver_kind === 'SEKBAN' && R.finalApproverKind(total, request.special_budget, settings) === 'KABAN';
        const updated = setStatus(db, request, needsKaban ? 'pending_reapproval' : 'in_procurement', { approved_total: total });
        if (needsKaban) addStep(db, user, updated, 'REAPPROVE', finalTarget(db, settings, updated, 'KABAN', asOf).target, request.revision_no);
        else freezeDocument(db, user, updated, 'PR', updated.id, updated.pr_number, requestSnapshot(db, settings, updated));
      } else if (step.step_kind === 'REAPPROVE') {
        decide(db, user, me, step, 'APPROVED', reason, asDelegate);
        const updated = setStatus(db, request, 'in_procurement', { final_approver_kind: 'KABAN' });
        freezeDocument(db, user, updated, 'PR', updated.id, updated.pr_number, requestSnapshot(db, settings, updated));
      }
      audit(db, user, 'APPROVE', 'purchase_requests', request.id, { step: step.step_kind, as_delegate: asDelegate });
      return requestDetail(db, acc, user, settings, loadRequest(db, request.id));
    });

    if (action === 'completeness' && m === 'POST') return tx(db, () => {
      assertStaff(acc, request);
      assert(request.status === 'pending_completeness_check', 'PR tidak sedang menunggu pemeriksaan kelengkapan.', 409);
      assert(request.row_version === versionOf(b), 'PR sudah berubah. Muat ulang data.', 409);
      if (b.action === 'REJECT') {
        const reason = text(b.reason, 'Alasan penolakan', 2000);
        setStatus(db, request, 'rejected', { closed_reason: reason, closed_at: now() });
        audit(db, user, 'REJECT', 'purchase_requests', request.id, { step: 'COMPLETENESS' }, reason);
        return requestDetail(db, acc, user, settings, loadRequest(db, request.id));
      }
      assert(b.action === 'ACCEPT', 'Tindakan tidak valid.');
      const unit = one(db, 'SELECT code FROM org_units WHERE id=?', request.org_unit_id), key = unitCode(settings, request, unit), yr = year(asOf);
      let number = optional(b.pr_number, 80);
      if (number) {
        assert(!one(db, 'SELECT id FROM purchase_requests WHERE pr_number=? AND id<>?', number, request.id), 'Nomor PR sudah dipakai PR lain.', 409);
        const parsed = R.parseSequence(number);
        if (parsed && number.includes(`/PR/${key}/`) && number.endsWith(`/${yr}`)) raiseSequence(db, 'PR', key, yr, parsed);
      } else number = R.documentNumber('PR', nextSequence(db, 'PR', key, yr), asOf, key);
      const pic = b.pic_employee_id ? pick(db, 'employees', b.pic_employee_id, 'PIC pembelian') : user.employee_id ? get(db, 'employees', user.employee_id) : null;
      assert(pic && pic.is_active === 1, 'Pilih PIC pembelian yang aktif.');
      const updated = setStatus(db, request, 'in_procurement', { pr_number: number, pic_employee_id: pic.id });
      freezeDocument(db, user, updated, 'PR', updated.id, number, requestSnapshot(db, settings, updated));
      audit(db, user, 'ACCEPT', 'purchase_requests', request.id, { pr_number: number, pic_employee_id: pic.id });
      return requestDetail(db, acc, user, settings, loadRequest(db, request.id));
    });

    if (action === 'quotes' && m === 'POST' && !p[4]) return tx(db, () => {
      assertStaff(acc, request);
      assert(request.status === 'in_procurement', 'Perbandingan harga hanya untuk PR yang sedang diproses.', 409);
      const item = pick(db, 'purchase_request_items', b.item_id, 'Item');
      assert(item.request_id === request.id && item.status === 'ACTIVE', 'Item tidak sesuai dengan PR ini.');
      assert(!openOrderItems(db, request.id).some(o => o.request_item_id === item.id), 'Item ini sudah masuk pesanan.', 409);
      const vendor = b.vendor_id ? pick(db, 'vendors', b.vendor_id, 'Vendor') : null;
      const storeName = vendor ? vendor.name : text(b.store_name, 'Nama toko', 200);
      const evidence = attachmentList(b.evidence, 'Bukti harga', 'Bukti harga wajib dilampirkan (ATR-PG-02).');
      const quote = insert(db, 'purchase_price_quotes', { request_id: request.id, item_id: item.id, vendor_id: vendor?.id || null, store_name: storeName, unit_price: rule(() => R.money(b.unit_price, 'Harga satuan')), is_selected: 0, created_by: user.id });
      saveAttachments(db, user, request, 'QUOTE', quote.id, 'PRICE_EVIDENCE', evidence);
      audit(db, user, 'ADD_QUOTE', 'purchase_requests', request.id, { item_id: item.id, quote_id: quote.id });
      return requestDetail(db, acc, user, settings, loadRequest(db, request.id));
    });
    if (action === 'quotes' && p[4] && m === 'DELETE') return tx(db, () => {
      assertStaff(acc, request);
      const quote = get(db, 'purchase_price_quotes', p[4]);
      assert(quote.request_id === request.id, 'Harga tidak sesuai dengan PR ini.');
      assert(!openOrderItems(db, request.id).some(o => o.request_item_id === quote.item_id), 'Item ini sudah masuk pesanan.', 409);
      run(db, "DELETE FROM purchase_attachments WHERE owner_type='QUOTE' AND owner_id=?", quote.id);
      run(db, 'DELETE FROM purchase_price_quotes WHERE id=?', quote.id);
      audit(db, user, 'REMOVE_QUOTE', 'purchase_requests', request.id, { quote_id: quote.id });
      return requestDetail(db, acc, user, settings, loadRequest(db, request.id));
    });
    if (action === 'quotes' && p[4] && p[5] === 'select' && m === 'POST') return tx(db, () => {
      assertStaff(acc, request);
      const quote = get(db, 'purchase_price_quotes', p[4]);
      assert(quote.request_id === request.id, 'Harga tidak sesuai dengan PR ini.');
      assert(!openOrderItems(db, request.id).some(o => o.request_item_id === quote.item_id), 'Item ini sudah masuk pesanan.', 409);
      const siblings = all(db, 'SELECT * FROM purchase_price_quotes WHERE item_id=?', quote.item_id);
      const cheapest = Math.min(...siblings.map(q => Number(q.unit_price)));
      const reason = Number(quote.unit_price) > cheapest ? text(b.reason, 'Alasan memilih harga yang bukan termurah', 1000) : null;
      run(db, 'UPDATE purchase_price_quotes SET is_selected=0,not_cheapest_reason=NULL,updated_at=?,row_version=row_version+1 WHERE item_id=?', now(), quote.item_id);
      run(db, 'UPDATE purchase_price_quotes SET is_selected=1,not_cheapest_reason=?,updated_at=?,row_version=row_version+1 WHERE id=?', reason, now(), quote.id);
      audit(db, user, 'SELECT_QUOTE', 'purchase_requests', request.id, { quote_id: quote.id, not_cheapest: Boolean(reason) });
      return requestDetail(db, acc, user, settings, loadRequest(db, request.id));
    });

    if (action === 'orders' && m === 'POST') return tx(db, () => {
      assertStaff(acc, request);
      assert(request.status === 'in_procurement', 'Pesanan hanya dapat dibuat untuk PR yang sedang diproses.', 409);
      const path = b.path;
      assert(R.allowedPaths(Number(request.approved_total), settings).includes(path), path === 'A' ? `Total PR ${R.formatRupiah(request.approved_total)} wajib lewat perbandingan harga atau surat penunjukan (ATR-PG-01).` : 'Total PR di bawah batas perbandingan; gunakan jalur langsung beli.', 422);
      const taken = new Set(openOrderItems(db, request.id).map(o => o.request_item_id));
      const active = all(db, "SELECT * FROM purchase_request_items WHERE request_id=? AND status='ACTIVE' ORDER BY line_no", request.id).filter(i => !taken.has(i.id));
      const wanted = Array.isArray(b.item_ids) && b.item_ids.length ? b.item_ids : active.map(i => i.id);
      const items = wanted.map(itemId => { const item = active.find(i => i.id === itemId); assert(item, 'Item sudah dipesan, dibatalkan, atau bukan milik PR ini.'); return item; });
      assert(items.length, 'Tidak ada item yang perlu dipesan.');
      const created = [];
      if (path === 'A') {
        const vendor = b.vendor_id ? pick(db, 'vendors', b.vendor_id, 'Vendor') : null;
        const prices = Object.fromEntries(items.map(i => [i.id, b.prices?.[i.id] ?? Number(i.approved_unit_price)]));
        created.push(createOrder(db, user, request, 'A', vendor, vendor ? vendor.name : text(b.store_name, 'Nama toko', 200), pricedLines(items, prices), 'NONE'));
      } else if (path === 'B') {
        const quotes = all(db, `SELECT * FROM purchase_price_quotes WHERE item_id IN (${items.map(() => '?').join(',')})`, ...items.map(i => i.id));
        const groups = new Map();
        for (const item of items) {
          const own = quotes.filter(q => q.item_id === item.id), stores = new Set(own.map(q => q.store_name.trim().toLowerCase()));
          assert(stores.size >= settings.min_quotes_per_item, `Item ${item.line_no} butuh minimal ${settings.min_quotes_per_item} harga dari toko berbeda (ATR-PG-02).`);
          const chosen = own.filter(q => q.is_selected);
          assert(chosen.length === 1, `Pilih satu harga untuk item ${item.line_no}.`);
          assert(chosen[0].vendor_id, `Harga terpilih item ${item.line_no} harus dari vendor yang terdaftar, karena PO/SPK memakai data vendor.`);
          const list = groups.get(chosen[0].vendor_id) || [];
          list.push({ item, price: Number(chosen[0].unit_price) });
          groups.set(chosen[0].vendor_id, list);
        }
        for (const [vendorId, list] of groups) {
          const vendor = get(db, 'vendors', vendorId);
          const kind = R.documentKindFor(list.map(l => l.item.item_kind));
          const order = createOrder(db, user, request, 'B', vendor, vendor.name, pricedLines(list.map(l => l.item), Object.fromEntries(list.map(l => [l.item.id, l.price]))), kind);
          insert(db, 'vendor_order_documents', { order_id: order.id, ...orderDocumentValues({}, settings, kind), created_by: user.id });
          created.push(order);
        }
      } else {
        const vendor = pick(db, 'vendors', b.vendor_id, 'Vendor');
        const kind = R.documentKindFor(items.map(i => i.item_kind));
        const order = createOrder(db, user, request, 'C', vendor, vendor.name, pricedLines(items, b.prices || {}), kind);
        insert(db, 'vendor_order_documents', { order_id: order.id, ...orderDocumentValues(b.document, settings, kind), created_by: user.id });
        created.push(submitOrder(db, user, settings, request, order, b));
      }
      update(db, 'purchase_requests', request.id, request.row_version, { procurement_path: path });
      audit(db, user, 'CREATE_ORDERS', 'purchase_requests', request.id, { path, orders: created.map(o => o.id) });
      return requestDetail(db, acc, user, settings, loadRequest(db, request.id));
    });

    if (action === 'confirmations' && m === 'POST' && !p[4]) return tx(db, () => {
      assertStaff(acc, request);
      assert(request.status === 'in_procurement', 'Konfirmasi ulang hanya untuk PR yang sedang diproses.', 409);
      assert(request.row_version === versionOf(b), 'PR sudah berubah. Muat ulang data.', 409);
      assert(Array.isArray(b.items) && b.items.length, 'Pilih minimal satu item yang harganya berubah.');
      const taken = new Set(openOrderItems(db, request.id).map(o => o.request_item_id)), round = request.confirmation_round + 1;
      for (const line of b.items) {
        const item = pick(db, 'purchase_request_items', line?.item_id, 'Item');
        assert(item.request_id === request.id && item.status === 'ACTIVE' && !taken.has(item.id), 'Item sudah dipesan, dibatalkan, atau bukan milik PR ini.');
        const price = rule(() => R.money(line.new_unit_price, `Harga baru item ${item.line_no}`)), subtotal = rule(() => R.lineSubtotal(item.quantity_milli, price));
        assert(subtotal > Number(item.approved_subtotal), `Harga baru item ${item.line_no} tidak lebih tinggi dari yang disetujui, jadi tidak perlu konfirmasi (ATR-PG-11).`);
        insert(db, 'purchase_price_confirmations', { request_id: request.id, item_id: item.id, round_no: round, old_unit_price: item.approved_unit_price, new_unit_price: price, old_subtotal: item.approved_subtotal, new_subtotal: subtotal, reason: text(line.reason, `Alasan kenaikan item ${item.line_no}`, 1000), answer: 'PENDING', created_by: user.id });
      }
      setStatus(db, request, 'pending_requester_confirmation', { confirmation_round: round });
      audit(db, user, 'REQUEST_CONFIRMATION', 'purchase_requests', request.id, { round, items: b.items.length });
      return requestDetail(db, acc, user, settings, loadRequest(db, request.id));
    });
    if (action === 'confirmations' && p[4] === 'answer' && m === 'POST') return tx(db, () => {
      assert(user.employee_id === request.requester_employee_id, 'Hanya pemohon yang dapat menjawab konfirmasi ulang.', 403);
      assert(request.status === 'pending_requester_confirmation', 'Tidak ada konfirmasi ulang yang menunggu jawaban.', 409);
      assert(request.row_version === versionOf(b), 'PR sudah berubah. Muat ulang data.', 409);
      const open = all(db, "SELECT * FROM purchase_price_confirmations WHERE request_id=? AND round_no=? AND answer='PENDING'", request.id, request.confirmation_round);
      const answers = Array.isArray(b.answers) ? b.answers : [];
      assert(open.every(c => answers.some(a => a.item_id === c.item_id && typeof a.accept === 'boolean')), 'Jawab setiap item: setujui harga baru atau batalkan item.');
      let accepted = 0;
      for (const c of open) {
        const accept = answers.find(a => a.item_id === c.item_id).accept;
        update(db, 'purchase_price_confirmations', c.id, c.row_version, { answer: accept ? 'ACCEPTED' : 'CANCELLED', answered_at: now(), answered_by: user.id });
        if (accept) accepted++;
        else { const item = get(db, 'purchase_request_items', c.item_id); update(db, 'purchase_request_items', item.id, item.row_version, { status: 'CANCELLED' }); }
      }
      const remaining = all(db, "SELECT approved_subtotal FROM purchase_request_items WHERE request_id=? AND status='ACTIVE'", request.id);
      if (!remaining.length) setStatus(db, request, 'cancelled', { closed_reason: 'Semua item dibatalkan pemohon pada konfirmasi ulang harga.', closed_at: now() });
      else if (accepted) { const updated = setStatus(db, request, 'pending_reverification'); addStep(db, user, updated, 'REVERIFY', null, request.revision_no); }
      else { setStatus(db, request, 'in_procurement', { approved_total: rule(() => R.sum(remaining.map(i => i.approved_subtotal))) }); completeIfDone(db, request); }
      audit(db, user, 'ANSWER_CONFIRMATION', 'purchase_requests', request.id, { accepted, cancelled: open.length - accepted });
      return requestDetail(db, acc, user, settings, loadRequest(db, request.id));
    });
    return undefined;
  }

  if (section === 'orders' && id) {
    const order = get(db, 'vendor_orders', id), request = loadRequest(db, order.request_id);
    if (!action && m === 'PATCH') return tx(db, () => {
      assertStaff(acc, request);
      assert(order.status === 'draft', 'Hanya pesanan draf yang dapat diubah.', 409);
      assert(order.row_version === versionOf(b), 'Pesanan sudah berubah. Muat ulang data.', 409);
      if (order.path !== 'A') {
        const doc = one(db, 'SELECT * FROM vendor_order_documents WHERE order_id=?', order.id);
        const values = orderDocumentValues({ ...doc, ...(b.document || {}) }, settings, doc.doc_kind);
        update(db, 'vendor_order_documents', doc.id, doc.row_version, values);
        if (values.doc_kind !== order.document_kind) run(db, 'UPDATE vendor_orders SET document_kind=? WHERE id=?', values.doc_kind, order.id);
      }
      const requestItems = all(db, 'SELECT * FROM purchase_request_items WHERE request_id=?', request.id);
      for (const line of Array.isArray(b.items) ? b.items : []) {
        const row = pick(db, 'vendor_order_items', line?.id, 'Item pesanan');
        assert(row.order_id === order.id, 'Item tidak sesuai dengan pesanan ini.');
        const neededOn = line.needed_on === undefined ? row.needed_on : date(line.needed_on, 'Tanggal dibutuhkan');
        const volume = line.calc_volume === undefined || line.calc_volume === null || line.calc_volume === '' ? null : rule(() => R.quantityMilli(line.calc_volume, 'Volume hitung'));
        const calcUnit = volume ? text(line.calc_unit, 'Satuan volume hitung', 20) : null;
        const subtotal = rule(() => R.lineSubtotal(volume || row.quantity_milli, row.unit_price));
        const item = requestItems.find(i => i.id === row.request_item_id);
        assert(subtotal <= Number(item.approved_subtotal), `Subtotal item ${item.line_no} melebihi nilai yang disetujui. Ajukan konfirmasi ulang (ATR-PG-09).`, 409);
        update(db, 'vendor_order_items', row.id, row.row_version, { needed_on: neededOn, calc_volume_milli: volume, calc_unit: calcUnit, subtotal });
      }
      const lines = all(db, 'SELECT subtotal FROM vendor_order_items WHERE order_id=?', order.id);
      const total = rule(() => R.sum(lines.map(i => i.subtotal)));
      const fresh = get(db, 'vendor_orders', order.id);
      update(db, 'vendor_orders', order.id, fresh.row_version, { total });
      audit(db, user, 'UPDATE_ORDER', 'vendor_orders', order.id, { total });
      return requestDetail(db, acc, user, settings, loadRequest(db, request.id));
    });
    if (action === 'submit' && m === 'POST') return tx(db, () => {
      assertStaff(acc, request);
      assert(request.status === 'in_procurement', 'PR tidak sedang diproses.', 409);
      assert(order.row_version === versionOf(b), 'Pesanan sudah berubah. Muat ulang data.', 409);
      submitOrder(db, user, settings, request, order, b);
      audit(db, user, 'SUBMIT_ORDER', 'vendor_orders', order.id, { path: order.path });
      return requestDetail(db, acc, user, settings, loadRequest(db, request.id));
    });
    if (action === 'decide' && m === 'POST') return tx(db, () => {
      const step = pick(db, 'purchase_approval_steps', b.step_id, 'Tahap');
      const appointment = step.object_type === 'APPOINTMENT' ? get(db, 'vendor_appointments', step.object_id) : null;
      assert(step.request_id === request.id && (step.object_type === 'ORDER' ? step.object_id === order.id : appointment?.order_id === order.id), 'Tahap tidak sesuai dengan pesanan ini.', 422);
      assert(order.row_version === versionOf(b), 'Pesanan sudah berubah. Muat ulang data.', 409);
      const asDelegate = actingAs(db, acc, user, request, step, asOf);
      const me = employeeOnDate(db, user.employee_id, asOf);
      assert(['APPROVE', 'REJECT'].includes(b.action), 'Tindakan tidak valid.');
      if (b.action === 'REJECT') {
        const reason = text(b.reason, 'Alasan penolakan', 2000);
        decide(db, user, me, step, 'REJECTED', reason, asDelegate);
        if (appointment) update(db, 'vendor_appointments', appointment.id, appointment.row_version, { status: 'REJECTED', decided_at: now() });
        update(db, 'vendor_orders', order.id, order.row_version, { status: 'draft' });
        audit(db, user, 'REJECT', 'vendor_orders', order.id, { step: step.step_kind }, reason);
        return requestDetail(db, acc, user, settings, loadRequest(db, request.id));
      }
      decide(db, user, me, step, 'APPROVED', optional(b.reason, 2000), asDelegate);
      if (appointment) {
        const issued = today(), yr = year(issued);
        const number = R.documentNumber('SPV', nextSequence(db, 'SPV', 'PURCHASE', yr, numberFloor(settings, 'SPV', yr)), issued);
        const savedAppointment = update(db, 'vendor_appointments', appointment.id, appointment.row_version, { status: 'APPROVED', number, decided_at: now() });
        const target = employeeOnDate(db, step.target_employee_id, issued);
        const vendor = get(db, 'vendors', order.vendor_id);
        freezeDocument(db, user, request, 'SPV', appointment.id, number, { organization: settings.organization, number, date: issued, request_code: request.request_code, pr_number: request.pr_number, vendor: { name: vendor.name, address: vendor.address }, reason: savedAppointment.reason, total: Number(order.total), total_words: R.terbilang(Number(order.total)), items: all(db, 'SELECT i.description,oi.quantity_milli,oi.unit,oi.unit_price,oi.subtotal FROM vendor_order_items oi JOIN purchase_request_items i ON i.id=oi.request_item_id WHERE oi.order_id=? ORDER BY i.line_no', order.id).map(i => ({ description: i.description, quantity: R.formatQuantity(i.quantity_milli), unit: i.unit, unit_price: Number(i.unit_price), subtotal: Number(i.subtotal) })), signer: { name: target?.full_name, position: target?.position_name, approved_at: now(), plh: asDelegate ? me.full_name : null } });
      }
      issueOrderDocument(db, user, settings, request, order, step, me);
      audit(db, user, 'APPROVE', 'vendor_orders', order.id, { step: step.step_kind, as_delegate: asDelegate });
      return requestDetail(db, acc, user, settings, loadRequest(db, request.id));
    });
    if (action === 'purchase' && m === 'POST') return tx(db, () => {
      assertStaff(acc, request);
      assert(order.status === 'ordered', 'Pembelian hanya dapat dicatat untuk pesanan yang sudah terbit.', 409);
      assert(order.row_version === versionOf(b), 'Pesanan sudah berubah. Muat ulang data.', 409);
      const purchasedOn = date(b.purchased_on, 'Tanggal beli');
      assert(purchasedOn <= asOf, 'Tanggal beli tidak boleh di masa depan.');
      const rows = all(db, 'SELECT oi.*,i.line_no FROM vendor_order_items oi JOIN purchase_request_items i ON i.id=oi.request_item_id WHERE oi.order_id=?', order.id);
      const prices = Object.fromEntries((Array.isArray(b.items) ? b.items : []).map(l => [l.id, l.unit_price]));
      for (const row of rows) {
        const price = prices[row.id] === undefined ? Number(row.unit_price) : rule(() => R.money(prices[row.id], `Harga beli item ${row.line_no}`));
        assert(price <= Number(row.unit_price), `Harga beli item ${row.line_no} lebih tinggi dari harga pesanan. Ajukan konfirmasi ulang sebelum membeli (ATR-PG-09).`, 409);
        update(db, 'vendor_order_items', row.id, row.row_version, { purchase_unit_price: price });
      }
      insert(db, 'order_receipts', { order_id: order.id, purchased_on: purchasedOn, created_by: user.id });
      update(db, 'vendor_orders', order.id, order.row_version, { status: 'purchased' });
      audit(db, user, 'PURCHASE', 'vendor_orders', order.id, { purchased_on: purchasedOn });
      return requestDetail(db, acc, user, settings, loadRequest(db, request.id));
    });
    if (action === 'receive' && m === 'POST') return tx(db, () => {
      assertStaff(acc, request);
      assert(order.status === 'purchased', 'Serah terima dicatat setelah pembelian.', 409);
      assert(order.row_version === versionOf(b), 'Pesanan sudah berubah. Muat ulang data.', 409);
      const receipt = one(db, 'SELECT * FROM order_receipts WHERE order_id=?', order.id);
      const receivedOn = date(b.received_on, 'Tanggal serah terima');
      assert(receivedOn >= receipt.purchased_on && receivedOn <= asOf, 'Tanggal serah terima harus antara tanggal beli dan hari ini.');
      const invoice = attachmentList(b.invoice, 'Nota vendor', 'Nota, kwitansi, atau invoice vendor wajib diunggah (ATR-ST-03).');
      assert(invoice.every(a => a.form === 'FILE'), 'Nota vendor harus berupa berkas yang diunggah.');
      const rows = all(db, 'SELECT * FROM vendor_order_items WHERE order_id=?', order.id);
      const received = Object.fromEntries((Array.isArray(b.items) ? b.items : []).map(l => [l.id, l.received_quantity]));
      for (const row of rows) {
        const qty = received[row.id] === undefined ? row.quantity_milli : rule(() => R.quantityMilli(received[row.id], 'Jumlah diterima'));
        update(db, 'vendor_order_items', row.id, row.row_version, { received_quantity_milli: qty });
      }
      saveAttachments(db, user, request, 'ORDER', order.id, 'VENDOR_INVOICE', invoice);
      update(db, 'order_receipts', receipt.id, receipt.row_version, { received_on: receivedOn, received_by_employee_id: user.employee_id || null, condition_note: text(b.condition_note, 'Kondisi barang atau hasil pekerjaan', 2000), invoice_total: rule(() => R.money(b.invoice_total, 'Total nota vendor')) });
      update(db, 'vendor_orders', order.id, order.row_version, { status: 'received' });
      completeIfDone(db, request);
      audit(db, user, 'RECEIVE', 'vendor_orders', order.id, { received_on: receivedOn });
      return requestDetail(db, acc, user, settings, loadRequest(db, request.id));
    });
    if (action === 'attachments' && m === 'POST') return tx(db, () => {
      assertStaff(acc, request);
      assert(['ordered', 'purchased', 'received'].includes(order.status) && order.path !== 'A', 'Scan bertanda tangan diunggah setelah PO/SPK terbit.', 409);
      saveAttachments(db, user, request, 'ORDER', order.id, 'SIGNED_SCAN', attachmentList(b.attachments, 'Scan bertanda tangan', 'Unggah scan PO/SPK yang sudah ditandatangani vendor.'));
      audit(db, user, 'ATTACH_SIGNED', 'vendor_orders', order.id);
      return requestDetail(db, acc, user, settings, loadRequest(db, request.id));
    });
    if (action === 'cancel' && m === 'POST') return tx(db, () => {
      assertStaff(acc, request);
      assert(['draft', 'pending_appointment_approval', 'pending_order_approval', 'ordered'].includes(order.status), 'Pesanan yang sudah dibeli tidak dapat dibatalkan.', 409);
      assert(order.row_version === versionOf(b), 'Pesanan sudah berubah. Muat ulang data.', 409);
      const reason = text(b.reason, 'Alasan pembatalan pesanan', 1000);
      supersedePending(db, request.id, order.id);
      for (const a of all(db, "SELECT id FROM vendor_appointments WHERE order_id=? AND status='PENDING'", order.id)) supersedePending(db, request.id, a.id);
      run(db, "UPDATE vendor_appointments SET status='REJECTED',decided_at=?,updated_at=?,row_version=row_version+1 WHERE order_id=? AND status='PENDING'", now(), now(), order.id);
      update(db, 'vendor_orders', order.id, order.row_version, { status: 'cancelled', cancelled_reason: reason });
      run(db, "UPDATE purchase_documents SET superseded_at=?,updated_at=?,row_version=row_version+1 WHERE object_id=? AND superseded_at IS NULL", now(), now(), order.id);
      audit(db, user, 'CANCEL_ORDER', 'vendor_orders', order.id, {}, reason);
      return requestDetail(db, acc, user, settings, loadRequest(db, request.id));
    });
    return undefined;
  }

  if (section === 'steps' && id && action === 'reassign' && m === 'POST') return tx(db, () => {
    assert(acc.has('purchasing.settings.manage'), 'Hanya Pengelola Pengadaan yang dapat mengalihkan tahap.', 403);
    const step = get(db, 'purchase_approval_steps', id), request = loadRequest(db, step.request_id);
    assert(step.status === 'PENDING' && step.target_kind === 'EMPLOYEE', 'Hanya tahap yang menunggu pegawai tertentu yang dapat dialihkan.', 409);
    assert(typeof b.employee_id === 'string' && b.employee_id, 'Pilih penyetuju baru.');
    const target = employeeOnDate(db, b.employee_id, asOf);
    assert(target && target.is_active === 1, 'Pilih pegawai aktif sebagai penyetuju baru.');
    assert(target.id !== request.requester_employee_id, 'Pemohon tidak boleh menjadi penyetuju PR-nya sendiri.');
    assert(target.id !== step.target_employee_id, 'Pilih penyetuju yang berbeda.');
    const reason = text(b.reason, 'Alasan pengalihan', 1000);
    const role = step.target_label.split(':')[0];
    update(db, 'purchase_approval_steps', step.id, step.row_version, { target_employee_id: target.id, target_label: `${role}: ${target.full_name}`, reassigned_from_employee_id: step.target_employee_id, reassign_reason: reason });
    audit(db, user, 'REASSIGN_STEP', 'purchase_requests', request.id, { step_id: step.id, from: step.target_employee_id, to: target.id }, reason);
    return requestDetail(db, acc, user, settings, loadRequest(db, request.id));
  });

  if (section === 'documents' && id && m === 'GET') {
    const doc = get(db, 'purchase_documents', id), request = loadRequest(db, doc.request_id);
    assert(viewOf(db, acc, user, request, asOf).any, 'Anda tidak memiliki akses ke dokumen ini.', 403);
    if (doc.doc_type !== 'PR') assert(viewOf(db, acc, user, request, asOf).full, 'Dokumen pesanan hanya untuk pihak yang menangani pengadaan.', 403);
    const snapshot = JSON.parse(doc.snapshot_json);
    if (snapshot.vendor && !acc.allows('purchasing.vendors.sensitive', { org_unit_id: request.org_unit_id })) { snapshot.vendor.leader_nik = mask(snapshot.vendor.leader_nik); snapshot.vendor.account_no = mask(snapshot.vendor.account_no); }
    audit(db, user, 'VIEW_DOCUMENT', 'purchase_documents', doc.id, { doc_type: doc.doc_type });
    return { id: doc.id, doc_type: doc.doc_type, number: doc.number, snapshot, snapshot_hash: doc.snapshot_hash, hash_valid: sha256(doc.snapshot_json) === doc.snapshot_hash, verification_code: doc.verification_code, superseded_at: doc.superseded_at, created_at: doc.created_at };
  }
  if (section === 'verify' && id && m === 'GET') {
    assert(/^[a-f0-9]{20}$/.test(id), 'Kode verifikasi tidak valid.', 404);
    const doc = one(db, 'SELECT * FROM purchase_documents WHERE verification_code=?', id);
    assert(doc, 'Dokumen dengan kode ini tidak ditemukan.', 404);
    const s = JSON.parse(doc.snapshot_json);
    return { doc_type: doc.doc_type, number: doc.number, request_code: s.request_code, date: s.date || s.request_date, total: s.total, approvals: s.approvals || (s.signer ? [{ name: s.signer.name, position: s.signer.position, at: s.signer.approved_at }] : []), issued_at: doc.created_at, superseded_at: doc.superseded_at, hash_valid: sha256(doc.snapshot_json) === doc.snapshot_hash, snapshot_hash: doc.snapshot_hash };
  }

  if (section === 'vendors') {
    const sensitive = acc.has('purchasing.vendors.sensitive');
    if (!id && m === 'GET') { assert(acc.has('purchasing.vendors.read') || acc.has('purchasing.procurement.manage'), 'Akses daftar vendor ditolak.', 403); return { items: all(db, 'SELECT * FROM vendors ORDER BY name').map(v => vendorRow(v, sensitive)), sensitive }; }
    if (m === 'POST' && !id) return tx(db, () => { assert(acc.has('purchasing.vendors.manage'), 'Akses kelola vendor ditolak.', 403); const row = insert(db, 'vendors', { ...vendorValues(b, null, sensitive), created_by: user.id }); audit(db, user, 'CREATE', 'vendors', row.id, { name: row.name }); return vendorRow(row, sensitive); });
    if (m === 'PATCH' && id) return tx(db, () => { assert(acc.has('purchasing.vendors.manage'), 'Akses kelola vendor ditolak.', 403); const old = get(db, 'vendors', id); const row = update(db, 'vendors', id, versionOf(b), vendorValues(b, old, sensitive)); audit(db, user, 'UPDATE', 'vendors', id, { fields: Object.keys(b).filter(k => k !== 'row_version') }); return vendorRow(row, sensitive); });
  }

  if (section === 'budget') {
    if (!id && m === 'GET') {
      assert(acc.has('purchasing.budget.read') || acc.has('purchasing.requests.verify'), 'Akses Pos RKA ditolak.', 403);
      const yr = Number(url.searchParams.get('year')) || year(asOf);
      return { year: yr, years: all(db, 'SELECT * FROM budget_years ORDER BY year DESC'), items: budgetLines(db, yr) };
    }
    if (id === 'years' && m === 'POST') return tx(db, () => { assert(acc.has('purchasing.budget.manage'), 'Akses kelola Pos RKA ditolak.', 403); const yr = Number(b.year); assert(Number.isInteger(yr) && yr >= 2000 && yr <= 2100, 'Tahun anggaran tidak valid.'); const row = insert(db, 'budget_years', { year: yr, is_active: 1, created_by: user.id }); audit(db, user, 'CREATE', 'budget_years', row.id, { year: yr }); return row; });
    if (id === 'lines' && m === 'POST' && !action) return tx(db, () => {
      assert(acc.has('purchasing.budget.manage'), 'Akses kelola Pos RKA ditolak.', 403);
      const by = pick(db, 'budget_years', b.budget_year_id, 'Tahun anggaran'); if (b.org_unit_id) pick(db, 'org_units', b.org_unit_id, 'Unit');
      const code = text(b.code, 'Kode Pos RKA', 20).toUpperCase(); assert(/^[A-Z0-9_-]+$/.test(code), 'Kode Pos RKA hanya huruf, angka, garis bawah, atau tanda hubung.');
      const row = insert(db, 'budget_lines', { budget_year_id: by.id, code, name: text(b.name, 'Nama Pos RKA', 200), org_unit_id: b.org_unit_id || null, ceiling: rule(() => R.money(b.ceiling, 'Pagu')), is_active: 1, created_by: user.id });
      audit(db, user, 'CREATE', 'budget_lines', row.id, { code, ceiling: row.ceiling }); return row;
    });
    if (id === 'lines' && action && m === 'PATCH') return tx(db, () => {
      assert(acc.has('purchasing.budget.manage'), 'Akses kelola Pos RKA ditolak.', 403);
      const old = get(db, 'budget_lines', action); if (b.org_unit_id) pick(db, 'org_units', b.org_unit_id, 'Unit');
      const row = update(db, 'budget_lines', old.id, versionOf(b), { name: b.name === undefined ? old.name : text(b.name, 'Nama Pos RKA', 200), org_unit_id: b.org_unit_id === undefined ? old.org_unit_id : b.org_unit_id || null, ceiling: b.ceiling === undefined ? old.ceiling : rule(() => R.money(b.ceiling, 'Pagu')), is_active: b.is_active === undefined ? old.is_active : flag(b.is_active) });
      audit(db, user, 'UPDATE', 'budget_lines', row.id, { ceiling: row.ceiling, is_active: row.is_active }); return row;
    });
  }

  if (section === 'settings') {
    assert(acc.has('purchasing.settings.manage'), 'Hanya Pengelola Pengadaan yang dapat membuka pengaturan.', 403);
    if (m === 'GET') return { settings, officials: { sekban: settings.officials.sekban_position_id ? positionHolders(db, settings.officials.sekban_position_id, asOf) : [], kaban: settings.officials.kaban_position_id ? positionHolders(db, settings.officials.kaban_position_id, asOf) : [] } };
    if (m === 'PATCH') return tx(db, () => {
      const next = settingsValues(db, b.settings, settings);
      run(db, 'INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', SETTINGS_KEY, JSON.stringify(next));
      audit(db, user, 'SETTINGS_CHANGED', 'app_settings', SETTINGS_KEY, { keys: Object.keys(b.settings || {}) }, optional(b.reason, 1000) || '');
      return { settings: next };
    });
  }

  if (section === 'delegations') {
    assert(acc.has('purchasing.settings.manage'), 'Hanya Pengelola Pengadaan yang dapat mengatur Plh.', 403);
    if (!id && m === 'GET') return { items: all(db, 'SELECT d.*,f.full_name from_name,t.full_name to_name FROM purchase_delegations d JOIN employees f ON f.id=d.from_employee_id JOIN employees t ON t.id=d.to_employee_id ORDER BY d.starts_on DESC') };
    if (!id && m === 'POST') return tx(db, () => {
      const from = pick(db, 'employees', b.from_employee_id, 'Pejabat asal'), to = pick(db, 'employees', b.to_employee_id, 'Plh');
      assert(from.id !== to.id, 'Pejabat asal dan Plh harus berbeda.'); assert(to.is_active === 1, 'Plh harus pegawai aktif.');
      const starts = date(b.starts_on, 'Tanggal mulai'), ends = date(b.ends_on, 'Tanggal selesai'); assert(ends >= starts, 'Tanggal selesai tidak boleh sebelum tanggal mulai.');
      const row = insert(db, 'purchase_delegations', { from_employee_id: from.id, to_employee_id: to.id, starts_on: starts, ends_on: ends, reason: text(b.reason, 'Dasar penunjukan Plh', 1000), created_by: user.id });
      audit(db, user, 'CREATE', 'purchase_delegations', row.id, { from: from.id, to: to.id, starts_on: starts, ends_on: ends }); return row;
    });
    if (id && action === 'revoke' && m === 'POST') return tx(db, () => { const d = get(db, 'purchase_delegations', id); assert(!d.revoked_at, 'Plh sudah dicabut.', 409); const row = update(db, 'purchase_delegations', id, versionOf(b), { revoked_at: now(), revoked_by: user.id }); audit(db, user, 'REVOKE', 'purchase_delegations', id); return row; });
  }

  if (section === 'reports' && m === 'GET') {
    assert(acc.has('purchasing.reports.read'), 'Akses laporan ditolak.', 403);
    const yr = Number(url.searchParams.get('year')) || year(asOf), rows = reportRows(db, acc, yr);
    const by = {}; for (const r of rows) by[r.status] = (by[r.status] || 0) + 1;
    const ids = rows.map(r => r.id);
    const orders = ids.length ? all(db, `SELECT o.request_id,o.status,o.due_on,o.total,r.invoice_total FROM vendor_orders o LEFT JOIN order_receipts r ON r.order_id=o.id WHERE o.request_id IN (${ids.map(() => '?').join(',')}) AND o.status<>'cancelled'`, ...ids) : [];
    return { year: yr, total_requests: rows.length, by_status: Object.entries(by).map(([status, count]) => ({ status, label: R.STATUS_LABELS[status], count })), approved_value: rule(() => R.sum(rows.filter(r => r.approved_total !== null && !['rejected', 'cancelled'].includes(r.status)).map(r => r.approved_total))), realized_value: rule(() => R.sum(orders.filter(o => o.status === 'received').map(o => o.invoice_total || 0))), late_orders: orders.filter(o => R.isLate(o, asOf)).length, budget: acc.has('purchasing.budget.read') ? budgetLines(db, yr) : [] };
  }
  if (section === 'export' && m === 'GET') {
    assert(acc.has('purchasing.reports.export'), 'Akses ekspor ditolak.', 403);
    const yr = Number(url.searchParams.get('year')) || year(asOf), rows = reportRows(db, acc, yr);
    const cell = v => '"' + String(v ?? '').replace(/^[=+\-@\t\r]/, "'$&").replaceAll('"', '""') + '"';
    const table = [['Kode pengajuan', 'Nomor PR', 'Tanggal PR', 'Pemohon', 'Unit', 'Status', 'Total estimasi', 'Total disetujui', 'Penyetuju akhir', 'Jalur'], ...rows.map(r => [r.request_code, r.pr_number, r.request_date, r.requester_name, r.unit_name, R.STATUS_LABELS[r.status], r.estimated_total, r.approved_total, r.final_approver_kind, r.procurement_path])];
    audit(db, user, 'EXPORT', 'purchase_requests', String(yr), { row_count: rows.length });
    return { filename: `pengadaan-${yr}.csv`, csv: table.map(row => row.map(cell).join(',')).join('\r\n') };
  }
  return undefined;
}

// Jumlah tahap yang menunggu akun ini, untuk menampilkan ruang kerja Pengadaan bagi
// penyetuju yang tidak memegang izin pengadaan apa pun (portal/me).
export function purchasingPendingCount(db, user) {
  if (!user.employee_id) return 0;
  const asOf = today(), ids = [user.employee_id, ...delegatorsOf(db, user.employee_id, asOf)];
  return Number(one(db, `SELECT count(*) n FROM purchase_approval_steps s JOIN purchase_requests r ON r.id=s.request_id WHERE s.status='PENDING' AND s.target_kind='EMPLOYEE' AND r.requester_employee_id<>? AND s.target_employee_id IN (${ids.map(() => '?').join(',')})`, user.employee_id, ...ids).n);
}
