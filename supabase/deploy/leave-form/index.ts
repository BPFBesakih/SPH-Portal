// supabase/functions/leave-form/index.ts
import { withSupabase } from "npm:@supabase/server@1";
import postgres from "npm:postgres@3.4.7";
import { randomUUID as randomUUID2 } from "node:crypto";

// supabase/functions/_shared/portal/db.mjs
import { randomUUID } from "node:crypto";
var now = () => (/* @__PURE__ */ new Date()).toISOString();
var today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(/* @__PURE__ */ new Date());
var uid = () => randomUUID();
var AppError = class extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
};
var assert = (condition, message, status = 422) => {
  if (!condition) throw new AppError(status, message);
};
var sqlName = (n) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(n)) throw new Error("Invalid SQL identifier");
  return n;
};
function postgresQuery(sql) {
  let quoted = false, index = 0, out = "";
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") {
      out += c;
      if (quoted && sql[i + 1] === "'") {
        out += sql[++i];
        continue;
      }
      quoted = !quoted;
      continue;
    }
    out += c === "?" && !quoted ? `$${++index}` : c;
  }
  return out.replace(/\b([a-z_]\w*)\.rowid\b/gi, "$1.id");
}
var all = (db, sql, ...args) => db.query(postgresQuery(sql), args.map((v) => v ?? null));
var one = async (db, sql, ...args) => (await all(db, sql, ...args))[0];
var run = async (db, sql, ...args) => {
  const rows = await db.query(postgresQuery(sql), args.map((v) => v ?? null));
  return { changes: rows.count ?? rows.affectedRows ?? 0 };
};
async function insert(db, table, values) {
  const row = { id: uid(), created_at: now(), updated_at: now(), row_version: 1, ...values };
  const columns = Object.keys(row).map(sqlName);
  await run(db, `INSERT INTO ${sqlName(table)} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`, ...Object.values(row).map((v) => typeof v === "boolean" ? Number(v) : v ?? null));
  return one(db, `SELECT * FROM ${sqlName(table)} WHERE id=?`, row.id);
}
async function audit(db, actor, action, type, key, summary = {}, reason = "") {
  await insert(db, "audit_events", { actor_user_id: actor?.id || null, action, object_type: type, object_key: String(key), occurred_at: now(), outcome: "SUCCESS", request_id: actor?.request_id || uid(), reason, change_summary: JSON.stringify(summary) });
}

// supabase/functions/_shared/portal/leaves.mjs
var eligible = (e) => Boolean(e?.is_active === 1 && ["Pegawai Kontrak (PKWT)", "Pegawai Probation"].includes(e.employment_status));
var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function leaveRoutes({ db, user, p, method, body = {}, url }, services) {
  const { assert: assert2, can, has, audit: audit2, today: today2, formLink } = services;
  db.authorizationCache ??= /* @__PURE__ */ new Map();
  const q = (sql, ...values) => db.query(sql, values), one2 = async (sql, ...values) => (await q(sql, ...values))[0];
  const day = today2(), stamp = () => (/* @__PURE__ */ new Date()).toISOString(), id = p[1], action = p[2];
  assert2(!user.must_change_password, "Ganti password awal terlebih dahulu.", 428);
  if (id === "notifications" && method === "GET") {
    const rows = user.employee_id ? await q(`SELECT r.id,r.status,r.row_version FROM leave_requests r
   JOIN employees e ON e.id=r.employee_id JOIN employees boss ON boss.id=$1 AND boss.is_active=1
   WHERE r.approver_employee_id=$1 AND r.employee_id<>$1 AND r.status IN ('PENDING','CANCELLATION_PENDING')
    AND (SELECT count(*) FROM employee_placements ep WHERE ep.employee_id=e.id AND ep.is_primary=1 AND ep.valid_from<=$2 AND (ep.valid_to IS NULL OR ep.valid_to>=$2))=1
    AND EXISTS(SELECT 1 FROM employee_placements ep WHERE ep.employee_id=e.id AND ep.is_primary=1 AND ep.valid_from<=$2 AND (ep.valid_to IS NULL OR ep.valid_to>=$2) AND ep.supervisor_employee_id=$1)
   ORDER BY r.id`, user.employee_id, day) : [];
    const signature = rows.length ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(rows))))].map((x) => x.toString(16).padStart(2, "0")).join("") : "";
    const keys = await Promise.all(rows.map(async (r2) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${r2.id}:${r2.status}:${r2.row_version}`)))].map((x) => x.toString(16).padStart(2, "0")).join("")));
    return { total: rows.length, pending: rows.filter((r2) => r2.status === "PENDING").length, cancellations: rows.filter((r2) => r2.status === "CANCELLATION_PENDING").length, signature, keys };
  }
  const validDate = (value) => {
    assert2(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, "Tanggal tidak valid.");
    return value;
  };
  const clean = (value, label, max = 2e3) => {
    assert2(typeof value === "string" && value.trim().length > 0 && value.length <= max, `${label} wajib diisi (maksimal ${max} karakter).`);
    return value.trim();
  };
  const people = await q(`SELECT e.id,e.employee_no,e.full_name,e.employment_status,e.is_active,e.joined_on,e.ended_on,
   ep.supervisor_employee_id,p.org_unit_id,p.name position_name,u.name unit_name
   FROM employees e LEFT JOIN employee_placements ep ON ep.employee_id=e.id AND ep.is_primary=1
     AND ep.valid_from<=$1 AND (ep.valid_to IS NULL OR ep.valid_to>=$1)
   LEFT JOIN positions p ON p.id=ep.position_id LEFT JOIN org_units u ON u.id=p.org_unit_id
   ORDER BY e.full_name,e.id`, day);
  const groups = /* @__PURE__ */ new Map();
  for (const e of people) {
    const list = groups.get(e.id) || [];
    list.push(e);
    groups.set(e.id, list);
  }
  const employees = [...groups.values()].map((list) => ({ ...list[0], placement_ambiguous: list.length !== 1 }));
  const byId = new Map(employees.map((e) => [e.id, e])), me = byId.get(user.employee_id);
  const subordinateIds = /* @__PURE__ */ new Set(), queue = user.employee_id ? [user.employee_id] : [];
  while (queue.length) {
    const parent = queue.shift();
    for (const e of employees) if (!e.placement_ambiguous && e.supervisor_employee_id === parent && !subordinateIds.has(e.id) && e.id !== user.employee_id) {
      subordinateIds.add(e.id);
      queue.push(e.id);
    }
  }
  const reportAccess = /* @__PURE__ */ new Map();
  for (const e of employees) reportAccess.set(e.id, await can(db, user, "hr.leaves.read", { employee_id: e.id, org_unit_id: e.org_unit_id }));
  const privateAllowed = (e) => Boolean(e && (e.id === user.employee_id || subordinateIds.has(e.id) || reportAccess.get(e.id)));
  const calendarAllowed = (e) => privateAllowed(e) || Boolean(me?.org_unit_id && e?.org_unit_id === me.org_unit_id);
  const supervisor = (e) => {
    const boss = byId.get(e?.supervisor_employee_id);
    assert2(e && !e.placement_ambiguous && boss?.is_active === 1 && boss.id !== e.id, "Data atasan langsung belum lengkap atau tidak tunggal. Hubungi SDM.");
    return boss;
  };
  const canDecide = (r2) => {
    const e = byId.get(r2.employee_id), boss = byId.get(e?.supervisor_employee_id);
    return Boolean(e && !e.placement_ambiguous && boss?.is_active === 1 && boss.id === user.employee_id && boss.id === r2.approver_employee_id && r2.employee_id !== user.employee_id);
  };
  const request = async (requestId) => {
    const r2 = (await one2("SELECT to_jsonb(r) row FROM leave_requests r WHERE id=$1 FOR UPDATE", requestId))?.row;
    assert2(r2, "Pengajuan tidak ditemukan.", 404);
    assert2(privateAllowed(byId.get(r2.employee_id)), "Akses pengajuan ditolak.", 403);
    return r2;
  };
  const requestDays = async (requestId) => q("SELECT work_date::text work_date,balance_year,state FROM leave_request_days WHERE request_id=$1 ORDER BY work_date", requestId);
  const balanceRows = async (employeeId) => q("SELECT to_jsonb(b) row FROM leave_effective_balances b WHERE employee_id=$1 ORDER BY expires_on", employeeId);
  const heldRows = async (employeeId) => q("SELECT balance_year,count(*)::int days FROM leave_request_days WHERE employee_id=$1 AND state='PENDING' GROUP BY balance_year", employeeId);
  const conflicts = async (dates2) => {
    if (!me?.org_unit_id) return [];
    const rows = await q(`SELECT d.employee_id,d.work_date::text work_date FROM leave_request_days d
    JOIN leave_requests r ON r.id=d.request_id WHERE d.state='APPROVED' AND r.status IN ('APPROVED','CANCELLATION_PENDING')
      AND d.work_date=ANY($1::date[]) AND d.employee_id<>$2`, dates2, me.id);
    return rows.filter((r2) => byId.get(r2.employee_id)?.org_unit_id === me.org_unit_id).map((r2) => ({ date: r2.work_date, name: byId.get(r2.employee_id).full_name }));
  };
  const plan = async (input) => {
    assert2(eligible(me), "THL atau pegawai nonaktif tidak memperoleh cuti tahunan.", 403);
    const boss = supervisor(me);
    assert2(Array.isArray(input) && input.length >= 1 && input.length <= 366, "Pilih minimal satu hari kerja, maksimal 366 hari.");
    const dates2 = input.map(validDate).sort();
    assert2(new Set(dates2).size === dates2.length, "Tanggal hari kerja tidak boleh berulang.");
    assert2(dates2.every((d) => d >= day), "Pengajuan baru tidak dapat memakai tanggal yang sudah lewat.");
    assert2(!await one2("SELECT 1 FROM leave_request_days WHERE employee_id=$1 AND work_date=ANY($2::date[]) AND state IN ('PENDING','APPROVED') LIMIT 1", me.id, dates2), "Tanggal tersebut sudah memiliki pengajuan aktif.");
    const balances = (await balanceRows(me.id)).map((x) => x.row), held = new Map((await heldRows(me.id)).map((r2) => [r2.balance_year, r2.days]));
    const available = balances.map((b) => ({ ...b, left: Math.max(0, b.available_days - (held.get(b.balance_year) || 0)) }));
    const allocations = [];
    for (const date of dates2) {
      const b = available.find((b2) => b2.left > 0 && b2.effective_from <= date && b2.expires_on > date && b2.closed_at === null);
      assert2(b, "Saldo yang berlaku pada tanggal pilihan tidak mencukupi. Saldo tahun mendatang belum dapat dipakai sebelum diberikan.");
      b.left--;
      allocations.push({ date, balance_year: b.balance_year });
    }
    return { dates: dates2, allocations, approver: { id: boss.id, name: boss.full_name }, conflicts: await conflicts(dates2) };
  };
  const locked = () => q("SELECT pg_advisory_xact_lock(hashtextextended('portal.leave_year_maintenance',0))");
  const manageLink = async (e) => Boolean(!formLink && e && await can(db, user, "hr.employees.update", { employee_id: e.id, org_unit_id: e.org_unit_id }));
  const manageShared = Boolean(!formLink && await can(db, user, "hr.employees.update", {}));
  if (id === "shared-form") {
    assert2(manageShared, "Tautan semua pegawai hanya dapat dikelola SDM dengan cakupan seluruh organisasi.", 403);
    const current = () => one2("SELECT id,share_token token,expires_at::text expires_at FROM leave_shared_form_links WHERE revoked_at IS NULL AND expires_at>now()");
    if (method === "GET") return { link: await current() || null };
    assert2(method === "POST" && ["issue", "revoke"].includes(body.action), "Tindakan tautan tidak valid.");
    await locked();
    await q("UPDATE leave_shared_form_links SET revoked_at=now() WHERE revoked_at IS NULL");
    if (body.action === "revoke") {
      await audit2(db, user, "LEAVE_SHARED_FORM_REVOKED", "leave_shared_form_links", "all");
      return { ok: true };
    }
    const token = [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join("");
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((x) => x.toString(16).padStart(2, "0")).join("");
    const linkId = crypto.randomUUID();
    await q("INSERT INTO leave_shared_form_links(id,token_hash,share_token,created_by,expires_at) VALUES($1,$2,$3,$4,now()+interval '90 days')", linkId, hash, token, user.id);
    await audit2(db, user, "LEAVE_SHARED_FORM_ISSUED", "leave_shared_form_links", linkId, { audience: "ALL_ELIGIBLE_EMPLOYEES" });
    return { link: await current() };
  }
  if (id === "form-links") {
    assert2(!formLink, "Akses ditolak.", 403);
    if (method === "GET") {
      const allowed = [];
      for (const e2 of employees) if (await manageLink(e2)) allowed.push(e2.id);
      assert2(allowed.length, "Hanya pengelola data pegawai yang dapat mengelola tautan.", 403);
      return { items: allowed.length ? await q("SELECT id,employee_id,created_at::text created_at,expires_at::text expires_at FROM leave_form_links WHERE employee_id=ANY($1::text[]) AND revoked_at IS NULL AND expires_at>now()", allowed) : [] };
    }
    assert2(method === "POST", "Alamat tidak ditemukan.", 404);
    const e = byId.get(body.employee_id);
    assert2(await manageLink(e), "Hanya pengelola data pegawai yang dapat mengelola tautan.", 403);
    await locked();
    assert2(["issue", "revoke"].includes(body.action), "Tindakan tautan tidak valid.");
    if (body.action === "issue") {
      assert2(eligible(e), "THL atau pegawai nonaktif tidak memperoleh formulir cuti.", 403);
      supervisor(e);
    }
    await q("UPDATE leave_form_links SET revoked_at=now() WHERE employee_id=$1 AND revoked_at IS NULL", e.id);
    if (body.action === "revoke") {
      await audit2(db, user, "LEAVE_FORM_REVOKED", "employees", e.id);
      return { ok: true };
    }
    const bytes = crypto.getRandomValues(new Uint8Array(32)), token = [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("");
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((x) => x.toString(16).padStart(2, "0")).join("");
    const linkId = crypto.randomUUID(), link = await one2("INSERT INTO leave_form_links(id,employee_id,token_hash,created_by,expires_at) VALUES($1,$2,$3,$4,now()+interval '90 days') RETURNING expires_at::text expires_at", linkId, e.id, digest, user.id);
    await audit2(db, user, "LEAVE_FORM_ISSUED", "leave_form_links", linkId, { employee_id: e.id, expires_at: link.expires_at });
    return { token, expires_at: link.expires_at, name: e.full_name };
  }
  if (method === "GET" && !id) {
    const year = Number(url.searchParams.get("year") || day.slice(0, 4));
    assert2(Number.isInteger(year) && year >= 2026 && year <= 2100, "Tahun laporan tidak valid.");
    const visibleEmployees = employees.filter(privateAllowed), visibleIds = visibleEmployees.map((e) => e.id);
    const rawBalances = visibleIds.length ? await q("SELECT to_jsonb(b) row FROM leave_effective_balances b WHERE employee_id=ANY($1::text[]) ORDER BY balance_year", visibleIds) : [];
    const holds = visibleIds.length ? await q("SELECT employee_id,balance_year,count(*)::int days FROM leave_request_days WHERE employee_id=ANY($1::text[]) AND state='PENDING' GROUP BY employee_id,balance_year", visibleIds) : [];
    const balances = visibleEmployees.map((e) => {
      const buckets = rawBalances.map((r2) => r2.row).filter((b) => b.employee_id === e.id).map((b) => ({ ...b, reserved_days: holds.find((h) => h.employee_id === e.id && h.balance_year === b.balance_year)?.days || 0 }));
      const usable = buckets.reduce((n, b) => n + b.available_days, 0), reserved = buckets.filter((b) => b.available_days > 0).reduce((n, b) => n + b.reserved_days, 0);
      return {
        employee_id: e.id,
        employee_no: e.employee_no,
        name: e.full_name,
        unit_id: e.org_unit_id,
        unit_name: e.unit_name,
        position_name: e.position_name,
        employment_status: e.employment_status,
        is_active: e.is_active,
        eligible: eligible(e),
        buckets,
        available_days: Math.max(0, usable - reserved),
        book_days: usable,
        reserved_days: reserved,
        used_days: buckets.filter((b) => b.balance_year === year).reduce((n, b) => n + b.consumed_days, 0)
      };
    });
    for (const b of balances) b.can_manage_form_link = await manageLink(byId.get(b.employee_id));
    const rows = visibleIds.length ? await q(`SELECT to_jsonb(r)||jsonb_build_object('dates',
     (SELECT jsonb_agg(work_date::text ORDER BY work_date) FROM leave_request_days WHERE request_id=r.id)) row
    FROM leave_requests r WHERE employee_id=ANY($1::text[])
    AND (first_date<=$3::date AND last_date>=$2::date OR status IN ('PENDING','CANCELLATION_PENDING')) ORDER BY created_at DESC`, visibleIds, year + "-01-01", year + "-12-31") : [];
    const requests = rows.map(({ row: r2 }) => {
      const e = byId.get(r2.employee_id);
      return {
        ...r2,
        employee_name: e.full_name,
        employee_no: e.employee_no,
        unit_id: e.org_unit_id,
        unit_name: e.unit_name,
        approver_name: byId.get(r2.approver_employee_id)?.full_name || "Atasan",
        can_decide: canDecide(r2),
        can_cancel: r2.employee_id === user.employee_id && ["PENDING", "APPROVED"].includes(r2.status) && r2.dates.every((d) => d >= day),
        supervisor_changed: r2.approver_employee_id !== e.supervisor_employee_id
      };
    });
    const calendarIds = employees.filter(calendarAllowed).map((e) => e.id);
    const calendar = calendarIds.length ? await q(`SELECT d.employee_id,d.work_date::text date FROM leave_request_days d JOIN leave_requests r ON r.id=d.request_id
    WHERE d.employee_id=ANY($1::text[]) AND d.state='APPROVED' AND r.status IN ('APPROVED','CANCELLATION_PENDING')
    AND d.work_date BETWEEN $2::date AND $3::date ORDER BY d.work_date`, calendarIds, year + "-01-01", year + "-12-31") : [];
    for (const r2 of requests) r2.conflicts = calendar.filter((c) => c.employee_id !== r2.employee_id && byId.get(c.employee_id)?.org_unit_id === r2.unit_id && r2.dates.includes(c.date)).map((c) => ({ date: c.date, name: byId.get(c.employee_id).full_name }));
    let boss = null;
    try {
      if (me) boss = supervisor(me);
    } catch {
    }
    return {
      today: day,
      year,
      me: me ? { id: me.id, name: me.full_name, eligible: eligible(me), employment_status: me.employment_status } : null,
      approver: boss ? { name: boss.full_name, id: boss.id } : null,
      balances,
      requests,
      calendar: calendar.map((r2) => ({ ...r2, name: byId.get(r2.employee_id)?.full_name, unit_name: byId.get(r2.employee_id)?.unit_name })),
      capabilities: { can_request: eligible(me) && Boolean(boss), can_export: await has(db, user, "hr.leaves.export"), can_manage_shared_form: manageShared, can_manage_form_links: !formLink && await has(db, user, "hr.employees.update"), can_manage_reports: visibleEmployees.some((e) => e.id !== user.employee_id && reportAccess.get(e.id)) },
      rules: { annual_credit: 12, next_credit_year: Math.max(2027, Number(day.slice(0, 4)) + 1), prior_year_valid_through: "31 Maret", approval: "Atasan langsung" }
    };
  }
  if (method === "GET" && id === "history") {
    const employeeId = url.searchParams.get("employee_id") || user.employee_id;
    assert2(privateAllowed(byId.get(employeeId)), "Akses riwayat saldo ditolak.", 403);
    return { employee_name: byId.get(employeeId).full_name, items: await q(`SELECT event_type,balance_year,delta_days,before_days,after_days,effective_date::text effective_date,created_at::text created_at
    FROM leave_balance_events WHERE employee_id=$1 ORDER BY created_at DESC,id DESC LIMIT 500`, employeeId) };
  }
  if (method === "POST" && id === "export-audit") {
    assert2(await has(db, user, "hr.leaves.export"), "Akses ekspor ditolak.", 403);
    const employeeIds = body.employee_ids;
    assert2(Array.isArray(employeeIds) && employeeIds.length <= 1e3, "Daftar ekspor tidak valid.");
    for (const employeeId of employeeIds) {
      const e = byId.get(employeeId);
      assert2(e && await can(db, user, "hr.leaves.export", { employee_id: e.id, org_unit_id: e.org_unit_id }) && privateAllowed(e), "Cakupan ekspor ditolak.", 403);
    }
    await audit2(db, user, "EXPORT", "leave_requests", "report", { employee_count: employeeIds.length, kind: body.kind || "balances" });
    return { ok: true };
  }
  assert2(method === "POST", "Alamat cuti tidak ditemukan.", 404);
  await locked();
  if (id === "preview") return plan(body.dates);
  if (!id) {
    assert2(uuid.test(body.client_key || ""), "Kunci pengiriman tidak valid.");
    const reason = clean(body.reason, "Alasan cuti");
    const canonical = JSON.stringify({ dates: Array.isArray(body.dates) ? [...body.dates].sort() : body.dates, reason });
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)))].map((x) => x.toString(16).padStart(2, "0")).join("");
    const prior = (await (formLink?.shared ? one2("SELECT to_jsonb(r) row FROM leave_requests r WHERE source_shared_form_link_id=$1 AND employee_id=$2 AND client_key=$3", formLink.id, me?.id, body.client_key) : one2(formLink ? "SELECT to_jsonb(r) row FROM leave_requests r WHERE source_form_link_id=$1 AND client_key=$2" : "SELECT to_jsonb(r) row FROM leave_requests r WHERE created_by=$1 AND client_key=$2", formLink?.id || user.id, body.client_key)))?.row;
    if (prior) {
      assert2(prior.payload_hash === hash, "Kunci pengiriman sudah dipakai untuk isi berbeda.", 409);
      return { id: prior.id, status: prior.status, duplicate: true };
    }
    const planned = await plan(body.dates), requestId = crypto.randomUUID(), now2 = stamp();
    await q(`INSERT INTO leave_requests(id,employee_id,approver_employee_id,first_date,last_date,day_count,reason,client_key,payload_hash,created_by,created_at,updated_at,submission_source,source_form_link_id,source_shared_form_link_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14)`, requestId, me.id, planned.approver.id, planned.dates[0], planned.dates.at(-1), planned.dates.length, reason, body.client_key, hash, user.id, now2, formLink ? "FORM" : "PORTAL", formLink && !formLink.shared ? formLink.id : null, formLink?.shared ? formLink.id : null);
    for (const a of planned.allocations) await q("INSERT INTO leave_request_days(request_id,employee_id,work_date,balance_year,state) VALUES($1,$2,$3,$4,'PENDING')", requestId, me.id, a.date, a.balance_year);
    await audit2(db, user, "LEAVE_SUBMITTED", "leave_requests", requestId, { days: planned.dates.length, approver_employee_id: planned.approver.id, conflict_days: planned.conflicts.length, submission_source: formLink ? "FORM" : "PORTAL", source_form_link_id: formLink && !formLink.shared ? formLink.id : null, source_shared_form_link_id: formLink?.shared ? formLink.id : null });
    return { id: requestId, status: "PENDING", conflicts: planned.conflicts };
  }
  const r = await request(id), dates = await requestDays(id);
  assert2(Number.isInteger(body.row_version) && body.row_version === r.row_version, "Pengajuan sudah berubah. Muat ulang.", 409);
  assert2(dates.length === r.day_count, "Rincian hari tidak konsisten. Hubungi SDM.", 409);
  const setStatus = async (status, note2, decided = false) => {
    await q(`UPDATE leave_requests SET status=$1,decision_note=$2,updated_at=$3,row_version=row_version+1,
    decided_by=CASE WHEN $4 THEN $5::uuid ELSE decided_by END,decided_at=CASE WHEN $4 THEN $3 ELSE decided_at END WHERE id=$6`, status, note2 || null, stamp(), decided, user.id, r.id);
    return { id: r.id, status };
  };
  if (action === "cancel") {
    assert2(r.employee_id === user.employee_id, "Hanya pemohon dapat meminta pembatalan.", 403);
    assert2(["PENDING", "APPROVED"].includes(r.status) && dates.every((d) => d.work_date >= day), "Pengajuan ini tidak dapat dibatalkan melalui proses ini.", 409);
    const note2 = clean(body.note, "Alasan pembatalan"), status = r.status === "PENDING" ? "CANCELLED" : "CANCELLATION_PENDING";
    if (status === "CANCELLED") await q("UPDATE leave_request_days SET state='RELEASED' WHERE request_id=$1", r.id);
    await q("UPDATE leave_requests SET cancellation_reason=$1 WHERE id=$2", note2, r.id);
    await setStatus(status, null);
    await audit2(db, user, "LEAVE_CANCELLATION_REQUESTED", "leave_requests", r.id, { status }, note2);
    return { id: r.id, status };
  }
  assert2(action === "decision" && canDecide(r), "Hanya atasan langsung yang berlaku dapat memutuskan pengajuan ini.", 403);
  const decision = body.decision, note = body.note ? clean(body.note, "Catatan keputusan") : null, cancellation = r.status === "CANCELLATION_PENDING";
  assert2(r.status === "PENDING" && ["approve", "reject"].includes(decision) || cancellation && ["approve-cancel", "reject-cancel"].includes(decision), "Keputusan tidak sesuai status pengajuan.", 409);
  if (decision === "reject" || decision === "reject-cancel") {
    assert2(note, "Alasan penolakan wajib diisi.");
    if (decision === "reject") await q("UPDATE leave_request_days SET state='RELEASED' WHERE request_id=$1", r.id);
    const result2 = await setStatus(cancellation ? "APPROVED" : "REJECTED", note, true);
    await audit2(db, user, cancellation ? "LEAVE_CANCELLATION_REJECTED" : "LEAVE_REJECTED", "leave_requests", r.id, {}, note);
    return result2;
  }
  assert2(body.verified_work_dates === true, "Atasan wajib memverifikasi tanggal hari kerja atau pembatalan sebelum menyetujui.");
  assert2(r.submission_source !== "FORM" || body.verified_identity === true, "Atasan wajib memverifikasi identitas pemohon dari formulir sebelum menyetujui.");
  assert2(eligible(byId.get(r.employee_id)), "Status pegawai tidak lagi memenuhi syarat.", 409);
  if (cancellation) assert2(dates.every((d) => d.work_date >= day), "Cuti sudah berlangsung. Pembatalan memerlukan rekonsiliasi SDM.", 409);
  const byYear = /* @__PURE__ */ new Map();
  for (const d of dates) byYear.set(d.balance_year, (byYear.get(d.balance_year) || 0) + 1);
  for (const [year, count] of byYear) {
    const b = await one2("SELECT *,expires_on::text expiry,effective_from::text start_day FROM leave_year_balances WHERE employee_id=$1 AND balance_year=$2 FOR UPDATE", r.employee_id, year);
    assert2(b && !b.closed_at && b.expiry > day, "Saldo asal sudah kedaluwarsa; lakukan rekonsiliasi sebelum keputusan.", 409);
    assert2(dates.filter((d) => d.balance_year === year).every((d) => d.work_date >= b.start_day && d.work_date < b.expiry), "Tanggal tidak sesuai masa berlaku saldo.", 409);
    const delta = cancellation ? count : -count;
    assert2(cancellation ? b.consumed_days >= count : b.remaining_days >= count, "Saldo berubah atau tidak mencukupi.", 409);
    await q("UPDATE leave_year_balances SET remaining_days=remaining_days+$1,consumed_days=consumed_days-$1,updated_at=CURRENT_TIMESTAMP,row_version=row_version+1 WHERE employee_id=$2 AND balance_year=$3", delta, r.employee_id, year);
    await q(
      `INSERT INTO leave_balance_events(employee_id,balance_year,event_key,event_type,delta_days,before_days,after_days,source_batch_id,effective_date,details)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      r.employee_id,
      year,
      `${cancellation ? "CANCEL" : "APPROVE"}:${r.id}:${year}`,
      cancellation ? "REVERSAL" : "CONSUMPTION",
      delta,
      b.remaining_days,
      b.remaining_days + delta,
      b.source_batch_id,
      day,
      JSON.stringify({ request_id: r.id, decided_by: user.id })
    );
  }
  await q("UPDATE leave_request_days SET state=$1 WHERE request_id=$2", cancellation ? "RELEASED" : "APPROVED", r.id);
  const result = await setStatus(cancellation ? "CANCELLED" : "APPROVED", note, true);
  await audit2(db, user, cancellation ? "LEAVE_CANCELLATION_APPROVED" : "LEAVE_APPROVED", "leave_requests", r.id, { days: r.day_count, work_dates_verified: true, identity_verified: r.submission_source === "FORM" }, note || "");
  return result;
}

// supabase/functions/_shared/portal/leave-form.mjs
var formDigest = async (value) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((x) => x.toString(16).padStart(2, "0")).join("");
async function takeLeaveFormSlot(db, ip, action) {
  assert(typeof ip === "string" && ip.length <= 45 && /^[a-f0-9:.]+$/i.test(ip), "Jalur pengiriman tidak valid.", 400);
  assert(["context", "preview", "submit"].includes(action), "Alamat tidak ditemukan.", 404);
  const key = await formDigest(`leave-form:${action}:${ip}`), limit = { context: 120, preview: 60, submit: 15 }[action];
  await db.query("DELETE FROM leave_form_rate_limits WHERE window_start<now()-interval '1 day'");
  const [row] = await db.query(`INSERT INTO leave_form_rate_limits(id,window_start,hits) VALUES($1,now(),1)
 ON CONFLICT(id) DO UPDATE SET window_start=CASE WHEN leave_form_rate_limits.window_start<now()-interval '10 minutes' THEN now() ELSE leave_form_rate_limits.window_start END,
 hits=CASE WHEN leave_form_rate_limits.window_start<now()-interval '10 minutes' THEN 1 ELSE leave_form_rate_limits.hits+1 END RETURNING hits`, [key]);
  return row.hits <= limit;
}
async function publicLeaveForm(db, action, body, requestId) {
  assert(["context", "preview", "submit"].includes(action), "Alamat tidak ditemukan.", 404);
  assert(typeof body.token === "string" && /^[a-f0-9]{64}$/.test(body.token), "Tautan tidak aktif. Minta tautan formulir kepada SDM.", 404);
  const hash = await formDigest(body.token);
  let [link] = await db.query("SELECT id,employee_id,expires_at::text expires_at FROM leave_form_links WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE", [hash]);
  if (!link) {
    [link] = await db.query("SELECT id,expires_at::text expires_at FROM leave_shared_form_links WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE", [hash]);
    if (link) link.shared = true;
  }
  assert(link, "Tautan tidak aktif atau kedaluwarsa. Minta tautan baru kepada SDM.", 404);
  assert(!body.website, "Permintaan tidak valid.");
  if (link.shared && action === "context") {
    const rows = await db.query(`SELECT e.id,e.full_name,right(e.employee_no,4) suffix,p.name position_name,u.name unit_name,
   ep.supervisor_employee_id,boss.full_name approver,boss.is_active boss_active FROM employees e
   LEFT JOIN employee_placements ep ON ep.employee_id=e.id AND ep.is_primary=1 AND ep.valid_from<=$1 AND (ep.valid_to IS NULL OR ep.valid_to>=$1)
   LEFT JOIN positions p ON p.id=ep.position_id LEFT JOIN org_units u ON u.id=p.org_unit_id LEFT JOIN employees boss ON boss.id=ep.supervisor_employee_id
   WHERE e.is_active=1 AND e.employment_status IN ('Pegawai Kontrak (PKWT)','Pegawai Probation') ORDER BY e.full_name,e.id`, [today()]);
    const groups = /* @__PURE__ */ new Map();
    for (const row of rows) {
      const list = groups.get(row.id) || [];
      list.push(row);
      groups.set(row.id, list);
    }
    const people = [...groups.values()].map((list) => ({ ...list[0], single: list.length === 1 }));
    return { shared: true, today: today(), expires_at: link.expires_at, employees: people.map((e) => ({
      id: e.id,
      full_name: e.full_name,
      unit_name: e.unit_name || "",
      position_name: [e.position_name, e.unit_name, ...people.filter((p) => p.full_name === e.full_name).length > 1 ? ["ID berakhir " + e.suffix] : []].filter(Boolean).join(" \xB7 "),
      approver: e.approver || null,
      can_request: e.single && e.boss_active === 1 && e.supervisor_employee_id !== e.id
    })) };
  }
  if (link.shared) {
    assert(typeof body.employee_id === "string", "Pilih nama pegawai dari hasil pencarian.");
    const [employee] = await db.query("SELECT id FROM employees WHERE id=$1 AND is_active=1 AND employment_status IN ('Pegawai Kontrak (PKWT)','Pegawai Probation')", [body.employee_id]);
    assert(employee, "Pegawai tidak tersedia untuk cuti tahunan.", 403);
    link.employee_id = employee.id;
  }
  const user = { id: null, employee_id: link.employee_id, must_change_password: 0, request_id: requestId };
  const ctx = {
    db,
    user,
    p: ["leaves", ...action === "preview" ? ["preview"] : []],
    method: action === "context" ? "GET" : "POST",
    body: { dates: body.dates, reason: body.reason, client_key: body.client_key },
    url: new URL("https://internal.invalid/leaves")
  };
  const result = await leaveRoutes(ctx, { assert, can: async () => false, has: async () => false, audit, today, formLink: link });
  if (action === "context") {
    assert(result.me?.eligible, "THL atau pegawai nonaktif tidak memperoleh cuti tahunan.", 403);
    const own = result.balances.find((b) => b.employee_id === link.employee_id);
    return {
      today: result.today,
      name: result.me.name,
      unit_name: own?.unit_name || "",
      position_name: own?.position_name || "",
      available_days: own?.available_days || 0,
      reserved_days: own?.reserved_days || 0,
      approver: result.approver?.name || null,
      can_request: result.capabilities.can_request,
      expires_at: link.expires_at
    };
  }
  if (action === "preview") return {
    dates: result.dates,
    day_count: result.dates.length,
    approver: result.approver.name,
    conflicts: [...new Set(result.conflicts.map((c) => c.date))],
    allocations: result.allocations
  };
  return { reference: result.id, status: result.status, duplicate: result.duplicate === true };
}

// supabase/functions/leave-form/index.ts
var pool;
async function transaction(client, work) {
  return client.begin(async (sql) => {
    await sql.unsafe("SET LOCAL search_path=portal,pg_catalog; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='25s';");
    await sql.unsafe("SELECT pg_advisory_xact_lock(734829610160009)");
    return work({ inTransaction: true, query: (statement, values = []) => sql.unsafe(statement, values) });
  });
}
var index_default = { fetch: withSupabase({ auth: "secret" }, async (req) => {
  const requestId = randomUUID2();
  try {
    assert(req.method === "POST", "Metode tidak diizinkan.", 405);
    assert(req.headers.get("content-type")?.toLowerCase().startsWith("application/json") && req.body, "Gunakan JSON.", 415);
    const reader = req.body.getReader(), chunks = [];
    let size = 0;
    try {
      for (; ; ) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 32768) {
          await reader.cancel();
          throw new AppError(413, "Permintaan terlalu besar.");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let b;
    try {
      b = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new AppError(400, "JSON tidak valid.");
    }
    assert(b && ["context", "preview", "submit"].includes(b.operation) && b.body && typeof b.body === "object" && !Array.isArray(b.body), "Permintaan tidak valid.", 400);
    if (!pool) pool = postgres(Deno.env.get("SUPABASE_DB_URL"), { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10, onnotice: () => {
    } });
    const allowed = await transaction(pool, (db) => takeLeaveFormSlot(db, b.client_ip, b.operation));
    assert(allowed, "Terlalu banyak percobaan. Coba kembali beberapa menit lagi.", 429);
    const result = await transaction(pool, (db) => publicLeaveForm(db, b.operation, b.body, requestId));
    return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof AppError ? error.status : ["23505", "40001", "40P01", "55P03"].includes(error?.code) ? 409 : ["23502", "23503", "23514", "22P02"].includes(error?.code) ? 422 : 503;
    return Response.json({ ok: false, error: error instanceof AppError ? error.message : status === 409 ? "Data berubah. Periksa pengajuan lalu coba kembali." : "Pengiriman belum dapat dikonfirmasi. Coba kembali dengan isi yang sama.", request_id: requestId }, { status, headers: { "Cache-Control": "no-store" } });
  }
}) };
export {
  index_default as default
};
