import { Buffer as __archives_Buffer } from "node:buffer";
import { randomUUID as __archives_randomUUID } from "node:crypto";
import { createHash as __archives_createHash } from "node:crypto";
import { Buffer as __attendance_Buffer3 } from "node:buffer";
import { randomBytes as __attendance_randomBytes } from "node:crypto";
import { randomUUID as __attendance_randomUUID } from "node:crypto";
import { createHash as __attendance_createHash } from "node:crypto";
import { Buffer as __attendance_Buffer } from "node:buffer";
import { createHash as __attendance_createHash2, webcrypto as __attendance_webcrypto } from "node:crypto";
import { Buffer as __attendance_Buffer2 } from "node:buffer";
import { createHash as __attendance_createHash3, randomUUID as __attendance_randomUUID2 } from "node:crypto";
import { randomBytes as __visits_randomBytes } from "node:crypto";
import { randomUUID as __visits_randomUUID } from "node:crypto";
import { createHash as __visits_createHash } from "node:crypto";
import { createHmac as __visits_createHmac } from "node:crypto";
import { createHash as __visits_createHash2, randomUUID as __visits_randomUUID2 } from "node:crypto";
// supabase/functions/_shared/portal/leave-control.mjs
async function leaveControlEligible(db, user) {
  if (!user?.id) return false;
  const [row] = await db.query(`SELECT EXISTS(SELECT 1 FROM leave_controller_accounts WHERE user_id=$1)
  OR EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND r.code='SUPER_ADMIN' AND r.is_active=1) allowed`, [user.id]);
  return row?.allowed === true;
}
async function guardLeaveRoleChanges({ db, p, method, body }, assert2) {
  if (p[0] === "roles" && ["POST", "PATCH"].includes(method) && Array.isArray(body.permissions) && body.permissions.some((code) => typeof code === "string" && code.startsWith("hr.leaves."))) {
    const old = p[1] ? (await db.query("SELECT code FROM roles WHERE id::text=$1", [p[1]]))[0] : null;
    const code = String(body.code ?? old?.code ?? "").toUpperCase();
    assert2(["SUPER_ADMIN", "LEAVE_CONTROLLER"].includes(code), "Izin Kontrol Cuti hanya tersedia pada role Kontrol Cuti dan Super Admin.", 403);
  }
  if (p[0] === "users" && p[2] === "grants" && method === "POST" && Array.isArray(body.grants)) {
    const ids = body.grants.map((g) => g?.role_id).filter((id) => typeof id === "string");
    const roles = ids.length ? await db.query("SELECT code FROM roles WHERE id::text=ANY($1::text[])", [ids]) : [];
    if (roles.some((r) => r.code === "LEAVE_CONTROLLER") && !roles.some((r) => r.code === "SUPER_ADMIN")) {
      const allowed = (await db.query("SELECT 1 FROM leave_controller_accounts WHERE user_id::text=$1", [p[1]]))[0];
      assert2(allowed, "Role Kontrol Cuti hanya dapat diberikan kepada akun yang telah ditetapkan.", 403);
    }
  }
}

// supabase/functions/_shared/portal/leave-approval.mjs
function leaveApprovalRoute(employee, byId, assert2) {
  const bossOf = (e) => {
    const boss = byId.get(e?.supervisor_employee_id);
    assert2(e && !e.placement_ambiguous && boss?.is_active === 1 && !boss.placement_ambiguous && boss.id !== e.id, "Data jenjang atasan belum lengkap atau tidak tunggal. Hubungi pengelola Kontrol Cuti.");
    return boss;
  };
  const first = bossOf(employee), head = /^Kepala Bidang\b/i.test(employee.position_name || ""), leader = /^Kepala Badan\b|^Pimpinan\b/i.test(first.position_name || "");
  if (head) assert2(leader, "Atasan kepala bidang harus Pimpinan/Kepala Badan. Periksa master penempatan.");
  const route = head || leader ? [first] : [first, bossOf(first)];
  assert2((/* @__PURE__ */ new Set([employee.id, ...route.map((e) => e.id)])).size === route.length + 1, "Struktur atasan berulang. Periksa master penempatan.");
  return route.map((e) => ({ id: e.id, name: e.full_name }));
}

// supabase/functions/_shared/portal/leaves.mjs
var eligible = (e) => Boolean(e?.is_active === 1 && ["Pegawai Kontrak (PKWT)", "Pegawai Probation"].includes(e.employment_status));
var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// BEGIN SPECIAL LEAVE MODULE
var __specialLeave = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // supabase/functions/_shared/portal/leaves.mjs
  var leaves_exports = {};
  __export(leaves_exports, {
    leaveRoutes: () => leaveRoutes
  });

  // supabase/functions/_shared/portal/leave-control.mjs
  async function leaveControlEligible(db, user) {
    if (!user?.id) return false;
    const [row] = await db.query(`SELECT EXISTS(SELECT 1 FROM leave_controller_accounts WHERE user_id=$1)
  OR EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND r.code='SUPER_ADMIN' AND r.is_active=1) allowed`, [user.id]);
    return row?.allowed === true;
  }

  // supabase/functions/_shared/portal/leave-approval.mjs
  function leaveApprovalRoute(employee, byId, assert) {
    const bossOf = (e) => {
      const boss = byId.get(e?.supervisor_employee_id);
      assert(e && !e.placement_ambiguous && boss?.is_active === 1 && !boss.placement_ambiguous && boss.id !== e.id, "Data jenjang atasan belum lengkap atau tidak tunggal. Hubungi pengelola Kontrol Cuti.");
      return boss;
    };
    const first = bossOf(employee), head = /^Kepala Bidang\b/i.test(employee.position_name || ""), leader = /^Kepala Badan\b|^Pimpinan\b/i.test(first.position_name || "");
    if (head) assert(leader, "Atasan kepala bidang harus Pimpinan/Kepala Badan. Periksa master penempatan.");
    const route = head || leader ? [first] : [first, bossOf(first)];
    assert((/* @__PURE__ */ new Set([employee.id, ...route.map((e) => e.id)])).size === route.length + 1, "Struktur atasan berulang. Periksa master penempatan.");
    return route.map((e) => ({ id: e.id, name: e.full_name }));
  }

  // public/leave-policy.js
  var LEAVE_TYPES = Object.freeze([
    { code: "ANNUAL", name: "Cuti tahunan", max_days: 366, calendar_days: false, deducts_balance: true, entitlement: "Sesuai saldo cuti tahunan", note: "Pilih hanya hari kerja Anda. Saldo dipotong setelah persetujuan terakhir." },
    { code: "MARRIAGE", name: "Menikah", max_days: 3, calendar_days: false, deducts_balance: false, entitlement: "3 hari", note: "Tenaga kerja yang bersangkutan menikah: maksimal 3 hari kerja." },
    { code: "CHILD_MARRIAGE", name: "Menikahkan anak", max_days: 2, calendar_days: false, deducts_balance: false, entitlement: "2 hari", note: "Menikahkan anak: maksimal 2 hari kerja." },
    { code: "FAMILY_BEREAVEMENT", name: "Keluarga inti meninggal dunia", max_days: 2, calendar_days: false, deducts_balance: false, entitlement: "2 hari", note: "Suami/istri, orang tua/mertua, atau anak/menantu meninggal dunia: maksimal 2 hari kerja. Sebutkan hubungan keluarga dalam alasan." },
    { code: "HOUSEHOLD_BEREAVEMENT", name: "Keluarga serumah meninggal dunia", max_days: 1, calendar_days: false, deducts_balance: false, entitlement: "1 hari", note: "Keluarga yang tinggal serumah meninggal dunia: maksimal 1 hari kerja." },
    { code: "WIFE_CHILDBIRTH", name: "Istri melahirkan", max_days: 2, calendar_days: false, deducts_balance: false, entitlement: "2 hari", note: "Suami mendapat cuti saat istri melahirkan: maksimal 2 hari kerja." },
    { code: "MATERNITY", name: "Melahirkan", max_days: 84, calendar_days: true, deducts_balance: false, entitlement: "3 bulan / 12 minggu", note: "Menggunakan acuan 12 minggu (84 hari kalender), dengan ketentuan 6 minggu sebelum dan 6 minggu setelah melahirkan. Atasan memverifikasi jadwalnya." },
    { code: "MISCARRIAGE", name: "Keguguran", max_days: 45, calendar_days: true, deducts_balance: false, entitlement: "1,5 bulan", note: "Untuk tenaga kerja perempuan, sesuai surat keterangan dokter kandungan. Batas sistem 45 hari kalender (acuan 30 hari per bulan); pilih tanggal sesuai surat dokter dan jelaskan dalam alasan." }
  ].map(Object.freeze));
  var getLeaveType = (code) => LEAVE_TYPES.find((t) => t.code === (code ?? "ANNUAL"));

  // supabase/functions/_shared/portal/leaves.mjs
  var eligible = (e) => Boolean(e?.is_active === 1 && ["Pegawai Kontrak (PKWT)", "Pegawai Probation"].includes(e.employment_status));
  var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  async function leaveRoutes({ db, user, p, method, body = {}, url }, services) {
    const { assert, can, has, audit, today, formLink } = services;
    db.authorizationCache ??= /* @__PURE__ */ new Map();
    const q = (sql, ...values) => db.query(sql, values), one = async (sql, ...values) => (await q(sql, ...values))[0];
    const day = today(), stamp = () => (/* @__PURE__ */ new Date()).toISOString(), id = p[1], action = p[2];
    assert(!user.must_change_password, "Ganti password awal terlebih dahulu.", 428);
    const controlEligible = !formLink && await leaveControlEligible(db, user);
    const validDate = (value) => {
      assert(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, "Tanggal tidak valid.");
      return value;
    };
    const clean = (value, label, max = 2e3) => {
      assert(typeof value === "string" && value.trim().length > 0 && value.length <= max, `${label} wajib diisi (maksimal ${max} karakter).`);
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
    for (const e of employees) reportAccess.set(e.id, controlEligible && await can(db, user, "hr.leaves.read", { employee_id: e.id, org_unit_id: e.org_unit_id }));
    const privateAllowed = (e) => Boolean(e && (e.id === user.employee_id || subordinateIds.has(e.id) || reportAccess.get(e.id)));
    const calendarAllowed = (e) => privateAllowed(e) || Boolean(me?.org_unit_id && e?.org_unit_id === me.org_unit_id);
    const routeFor = (e) => leaveApprovalRoute(e, byId, assert), supervisor = (e) => routeFor(e)[0];
    const stepRows = (requestIds) => requestIds.length ? q("SELECT * FROM leave_approval_steps WHERE request_id=ANY($1::text[]) ORDER BY cycle_no,step_no", requestIds) : [];
    const progress = (r2, allSteps) => {
      let route;
      try {
        route = routeFor(byId.get(r2.employee_id));
      } catch {
        return { valid: false, steps: allSteps, current: null, total: 0 };
      }
      const stored = allSteps.filter((s) => s.cycle_no === r2.approval_cycle), legacy = !stored.length;
      if (legacy && !["PENDING", "CANCELLATION_PENDING"].includes(r2.status)) return { valid: false, steps: [], current: null, total: route.length, legacy: true, route };
      const steps = legacy ? route.map((a, i) => ({ step_no: i + 1, approver_employee_id: a.id, state: i ? "WAITING" : "PENDING", cycle_no: r2.approval_cycle, purpose: r2.status === "CANCELLATION_PENDING" ? "CANCELLATION" : "APPROVAL" })) : stored;
      const current = steps.find((s) => s.state === "PENDING");
      const valid = steps.length === route.length && steps.every((s, i) => s.approver_employee_id === route[i].id) && Boolean(current && current.approver_employee_id === r2.approver_employee_id && steps.filter((s) => s.step_no < current.step_no).every((s) => s.state === "APPROVED") && steps.filter((s) => s.step_no > current.step_no).every((s) => s.state === "WAITING"));
      return { valid, steps, current, total: route.length, legacy, route };
    };
    const canDecide = (r2, steps) => {
      const p2 = progress(r2, steps);
      return Boolean(["PENDING", "CANCELLATION_PENDING"].includes(r2.status) && p2.valid && p2.current.approver_employee_id === user.employee_id && r2.employee_id !== user.employee_id);
    };
    const createSteps = async (requestId, cycle, purpose, route) => {
      for (let i = 0; i < route.length; i++) await q("INSERT INTO leave_approval_steps(request_id,cycle_no,step_no,purpose,approver_employee_id,state) VALUES($1,$2,$3,$4,$5,$6)", requestId, cycle, i + 1, purpose, route[i].id, i ? "WAITING" : "PENDING");
    };
    if (id === "notifications" && method === "GET") {
      const raw = user.employee_id ? await q("SELECT to_jsonb(r) row FROM leave_requests r WHERE approver_employee_id=$1 AND status IN ('PENDING','CANCELLATION_PENDING') ORDER BY id", user.employee_id) : [];
      const steps = await stepRows(raw.map((x) => x.row.id)), rows = raw.map((x) => x.row).filter((r2) => canDecide(r2, steps.filter((s) => s.request_id === r2.id))).map((r2) => ({ id: r2.id, status: r2.status, row_version: r2.row_version }));
      const digest = async (v) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))].map((x) => x.toString(16).padStart(2, "0")).join("");
      return { total: rows.length, pending: rows.filter((r2) => r2.status === "PENDING").length, cancellations: rows.filter((r2) => r2.status === "CANCELLATION_PENDING").length, signature: rows.length ? await digest(JSON.stringify(rows)) : "", keys: await Promise.all(rows.map((r2) => digest(`${r2.id}:${r2.status}:${r2.row_version}`))) };
    }
    const request = async (requestId) => {
      const r2 = (await one("SELECT to_jsonb(r) row FROM leave_requests r WHERE id=$1 FOR UPDATE", requestId))?.row;
      assert(r2, "Pengajuan tidak ditemukan.", 404);
      assert(privateAllowed(byId.get(r2.employee_id)), "Akses pengajuan ditolak.", 403);
      return r2;
    };
    const requestDays = async (requestId) => q("SELECT work_date::text work_date,balance_year,state FROM leave_request_days WHERE request_id=$1 ORDER BY work_date", requestId);
    const balanceRows = async (employeeId) => q("SELECT to_jsonb(b) row FROM leave_effective_balances b WHERE employee_id=$1 ORDER BY expires_on", employeeId);
    const heldRows = async (employeeId) => q("SELECT balance_year,count(*)::int days FROM leave_request_days WHERE employee_id=$1 AND state='PENDING' AND balance_year IS NOT NULL GROUP BY balance_year", employeeId);
    const conflicts = async (dates2) => {
      if (!me?.org_unit_id) return [];
      const rows = await q(`SELECT d.employee_id,d.work_date::text work_date FROM leave_request_days d
    JOIN leave_requests r ON r.id=d.request_id WHERE d.state='APPROVED' AND r.status IN ('APPROVED','CANCELLATION_PENDING')
      AND d.work_date=ANY($1::date[]) AND d.employee_id<>$2`, dates2, me.id);
      return rows.filter((r2) => byId.get(r2.employee_id)?.org_unit_id === me.org_unit_id).map((r2) => ({ date: r2.work_date, name: byId.get(r2.employee_id).full_name }));
    };
    const plan = async (input, code) => {
      const type2 = getLeaveType(code);
      assert(type2, "Jenis cuti tidak valid.");
      assert(eligible(me), "Status pegawai tidak memenuhi syarat pengajuan cuti.", 403);
      const route = routeFor(me), boss = route[0];
      assert(Array.isArray(input) && input.length >= 1 && input.length <= 366, "Pilih minimal satu hari kerja, maksimal 366 hari.");
      const dates2 = input.map(validDate).sort();
      assert(new Set(dates2).size === dates2.length, "Tanggal hari kerja tidak boleh berulang.");
      assert(dates2.length <= type2.max_days, `${type2.name} maksimal ${type2.entitlement}.`);
      if (type2.calendar_days) assert(dates2.every((d, i) => !i || Date.parse(d) - Date.parse(dates2[i - 1]) === 864e5), "Cuti ini dihitung dalam hari kalender berurutan, termasuk hari libur.");
      assert(dates2.every((d) => d >= day), "Pengajuan baru tidak dapat memakai tanggal yang sudah lewat.");
      assert(!await one("SELECT 1 FROM leave_request_days WHERE employee_id=$1 AND work_date=ANY($2::date[]) AND state IN ('PENDING','APPROVED') LIMIT 1", me.id, dates2), "Tanggal tersebut sudah memiliki pengajuan aktif.");
      if (!type2.deducts_balance) return { dates: dates2, leave_type: type2.code, allocations: dates2.map((date) => ({ date, balance_year: null })), approver: boss, approvers: route, conflicts: await conflicts(dates2) };
      const balances = (await balanceRows(me.id)).map((x) => x.row), held = new Map((await heldRows(me.id)).map((r2) => [r2.balance_year, r2.days]));
      const available = balances.map((b) => ({ ...b, left: Math.max(0, b.available_days - (held.get(b.balance_year) || 0)) }));
      const allocations = [];
      for (const date of dates2) {
        const b = available.find((b2) => b2.left > 0 && b2.effective_from <= date && b2.expires_on > date && b2.closed_at === null);
        assert(b, "Saldo yang berlaku pada tanggal pilihan tidak mencukupi. Saldo tahun mendatang belum dapat dipakai sebelum diberikan.");
        b.left--;
        allocations.push({ date, balance_year: b.balance_year });
      }
      return { dates: dates2, leave_type: type2.code, allocations, approver: boss, approvers: route, conflicts: await conflicts(dates2) };
    };
    const locked = () => q("SELECT pg_advisory_xact_lock(hashtextextended('portal.leave_year_maintenance',0))");
    const manageLink = async (e) => Boolean(controlEligible && e && await can(db, user, "hr.leaves.manage", { employee_id: e.id, org_unit_id: e.org_unit_id }));
    const manageShared = Boolean(controlEligible && await can(db, user, "hr.leaves.manage", {}));
    if (id === "shared-form") {
      assert(manageShared, "Tautan semua pegawai hanya dapat dikelola SDM dengan cakupan seluruh organisasi.", 403);
      const current = () => one("SELECT id,share_token token,expires_at::text expires_at FROM leave_shared_form_links WHERE revoked_at IS NULL AND expires_at>now()");
      if (method === "GET") return { link: await current() || null };
      assert(method === "POST" && ["issue", "revoke"].includes(body.action), "Tindakan tautan tidak valid.");
      await locked();
      await q("UPDATE leave_shared_form_links SET revoked_at=now() WHERE revoked_at IS NULL");
      if (body.action === "revoke") {
        await audit(db, user, "LEAVE_SHARED_FORM_REVOKED", "leave_shared_form_links", "all");
        return { ok: true };
      }
      const token = [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join("");
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((x) => x.toString(16).padStart(2, "0")).join("");
      const linkId = crypto.randomUUID();
      await q("INSERT INTO leave_shared_form_links(id,token_hash,share_token,created_by,expires_at) VALUES($1,$2,$3,$4,now()+interval '90 days')", linkId, hash, token, user.id);
      await audit(db, user, "LEAVE_SHARED_FORM_ISSUED", "leave_shared_form_links", linkId, { audience: "ALL_ELIGIBLE_EMPLOYEES" });
      return { link: await current() };
    }
    if (id === "form-links") {
      assert(!formLink, "Akses ditolak.", 403);
      if (method === "GET") {
        const allowed = [];
        for (const e2 of employees) if (await manageLink(e2)) allowed.push(e2.id);
        assert(allowed.length, "Hanya pengelola data pegawai yang dapat mengelola tautan.", 403);
        return { items: allowed.length ? await q("SELECT id,employee_id,created_at::text created_at,expires_at::text expires_at FROM leave_form_links WHERE employee_id=ANY($1::text[]) AND revoked_at IS NULL AND expires_at>now()", allowed) : [] };
      }
      assert(method === "POST", "Alamat tidak ditemukan.", 404);
      const e = byId.get(body.employee_id);
      assert(await manageLink(e), "Hanya pengelola data pegawai yang dapat mengelola tautan.", 403);
      await locked();
      assert(["issue", "revoke"].includes(body.action), "Tindakan tautan tidak valid.");
      if (body.action === "issue") {
        assert(eligible(e), "THL atau pegawai nonaktif tidak memperoleh formulir cuti.", 403);
        supervisor(e);
      }
      await q("UPDATE leave_form_links SET revoked_at=now() WHERE employee_id=$1 AND revoked_at IS NULL", e.id);
      if (body.action === "revoke") {
        await audit(db, user, "LEAVE_FORM_REVOKED", "employees", e.id);
        return { ok: true };
      }
      const bytes = crypto.getRandomValues(new Uint8Array(32)), token = [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("");
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((x) => x.toString(16).padStart(2, "0")).join("");
      const linkId = crypto.randomUUID(), link = await one("INSERT INTO leave_form_links(id,employee_id,token_hash,created_by,expires_at) VALUES($1,$2,$3,$4,now()+interval '90 days') RETURNING expires_at::text expires_at", linkId, e.id, digest, user.id);
      await audit(db, user, "LEAVE_FORM_ISSUED", "leave_form_links", linkId, { employee_id: e.id, expires_at: link.expires_at });
      return { token, expires_at: link.expires_at, name: e.full_name };
    }
    if (method === "GET" && !id) {
      const year = Number(url.searchParams.get("year") || day.slice(0, 4));
      assert(Number.isInteger(year) && year >= 2026 && year <= 2100, "Tahun laporan tidak valid.");
      const visibleEmployees = employees.filter(privateAllowed), visibleIds = visibleEmployees.map((e) => e.id);
      const rawBalances = visibleIds.length ? await q("SELECT to_jsonb(b) row FROM leave_effective_balances b WHERE employee_id=ANY($1::text[]) ORDER BY balance_year", visibleIds) : [];
      const holds = visibleIds.length ? await q("SELECT employee_id,balance_year,count(*)::int days FROM leave_request_days WHERE employee_id=ANY($1::text[]) AND state='PENDING' AND balance_year IS NOT NULL GROUP BY employee_id,balance_year", visibleIds) : [];
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
      const allSteps = await stepRows(rows.map((x) => x.row.id));
      const requests = rows.map(({ row: r2 }) => {
        const e = byId.get(r2.employee_id);
        const history2 = allSteps.filter((s) => s.request_id === r2.id), p2 = progress(r2, history2);
        return {
          ...r2,
          employee_name: e.full_name,
          employee_no: e.employee_no,
          unit_id: e.org_unit_id,
          unit_name: e.unit_name,
          approver_name: byId.get(r2.approver_employee_id)?.full_name || "Atasan",
          can_decide: canDecide(r2, history2),
          current_step: p2.current?.step_no || null,
          total_steps: p2.total,
          approval_steps: (history2.length ? history2 : p2.steps).map((s) => ({ ...s, approver_name: byId.get(s.approver_employee_id)?.full_name || "Atasan" })),
          can_cancel: r2.employee_id === user.employee_id && ["PENDING", "APPROVED"].includes(r2.status) && r2.dates.every((d) => d >= day),
          supervisor_changed: ["PENDING", "CANCELLATION_PENDING"].includes(r2.status) && !p2.valid
        };
      });
      const calendarIds = employees.filter(calendarAllowed).map((e) => e.id);
      const calendar = calendarIds.length ? await q(`SELECT d.employee_id,d.work_date::text date FROM leave_request_days d JOIN leave_requests r ON r.id=d.request_id
    WHERE d.employee_id=ANY($1::text[]) AND d.state='APPROVED' AND r.status IN ('APPROVED','CANCELLATION_PENDING')
    AND d.work_date BETWEEN $2::date AND $3::date ORDER BY d.work_date`, calendarIds, year + "-01-01", year + "-12-31") : [];
      for (const r2 of requests) r2.conflicts = calendar.filter((c) => c.employee_id !== r2.employee_id && byId.get(c.employee_id)?.org_unit_id === r2.unit_id && r2.dates.includes(c.date)).map((c) => ({ date: c.date, name: byId.get(c.employee_id).full_name }));
      let boss = null, myRoute = [];
      try {
        if (me) {
          myRoute = routeFor(me);
          boss = myRoute[0];
        }
      } catch {
      }
      return {
        today: day,
        year,
        me: me ? { id: me.id, name: me.full_name, eligible: eligible(me), employment_status: me.employment_status } : null,
        approver: boss,
        approvers: myRoute,
        balances,
        requests,
        leave_types: LEAVE_TYPES,
        calendar: calendar.map((r2) => ({ ...r2, name: byId.get(r2.employee_id)?.full_name, unit_name: byId.get(r2.employee_id)?.unit_name })),
        capabilities: { can_request: eligible(me) && Boolean(boss), can_export: controlEligible && await has(db, user, "hr.leaves.export"), can_manage_shared_form: manageShared, can_manage_form_links: controlEligible && await has(db, user, "hr.leaves.manage"), can_manage_reports: visibleEmployees.some((e) => e.id !== user.employee_id && reportAccess.get(e.id)) },
        rules: { annual_credit: 12, next_credit_year: Math.max(2027, Number(day.slice(0, 4)) + 1), prior_year_valid_through: "31 Maret", approval: "Atasan langsung \u2192 atasan satu tingkat di atasnya; berhenti di Pimpinan" }
      };
    }
    if (method === "GET" && id === "history") {
      const employeeId = url.searchParams.get("employee_id") || user.employee_id;
      assert(privateAllowed(byId.get(employeeId)), "Akses riwayat saldo ditolak.", 403);
      return { employee_name: byId.get(employeeId).full_name, items: await q(`SELECT event_type,balance_year,delta_days,before_days,after_days,effective_date::text effective_date,created_at::text created_at
    FROM leave_balance_events WHERE employee_id=$1 ORDER BY created_at DESC,id DESC LIMIT 500`, employeeId) };
    }
    if (method === "POST" && id === "export-audit") {
      assert(controlEligible && await has(db, user, "hr.leaves.export"), "Akses ekspor ditolak.", 403);
      const employeeIds = body.employee_ids;
      assert(Array.isArray(employeeIds) && employeeIds.length <= 1e3, "Daftar ekspor tidak valid.");
      for (const employeeId of employeeIds) {
        const e = byId.get(employeeId);
        assert(e && await can(db, user, "hr.leaves.export", { employee_id: e.id, org_unit_id: e.org_unit_id }) && privateAllowed(e), "Cakupan ekspor ditolak.", 403);
      }
      await audit(db, user, "EXPORT", "leave_requests", "report", { employee_count: employeeIds.length, kind: body.kind || "balances" });
      return { ok: true };
    }
    assert(method === "POST", "Alamat cuti tidak ditemukan.", 404);
    await locked();
    if (id === "preview") return plan(body.dates, body.leave_type);
    if (!id) {
      assert(uuid.test(body.client_key || ""), "Kunci pengiriman tidak valid.");
      const reason = clean(body.reason, "Alasan cuti");
      const type2 = getLeaveType(body.leave_type);
      assert(type2, "Jenis cuti tidak valid.");
      const canonical = JSON.stringify({ dates: Array.isArray(body.dates) ? [...body.dates].sort() : body.dates, reason, ...type2.deducts_balance ? {} : { leave_type: type2.code } });
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)))].map((x) => x.toString(16).padStart(2, "0")).join("");
      const prior = (await (formLink?.shared ? one("SELECT to_jsonb(r) row FROM leave_requests r WHERE source_shared_form_link_id=$1 AND employee_id=$2 AND client_key=$3", formLink.id, me?.id, body.client_key) : one(formLink ? "SELECT to_jsonb(r) row FROM leave_requests r WHERE source_form_link_id=$1 AND client_key=$2" : "SELECT to_jsonb(r) row FROM leave_requests r WHERE created_by=$1 AND client_key=$2", formLink?.id || user.id, body.client_key)))?.row;
      if (prior) {
        assert(prior.payload_hash === hash, "Kunci pengiriman sudah dipakai untuk isi berbeda.", 409);
        return { id: prior.id, status: prior.status, duplicate: true };
      }
      const planned = await plan(body.dates, type2.code), requestId = crypto.randomUUID(), now = stamp();
      await q(`INSERT INTO leave_requests(id,employee_id,approver_employee_id,first_date,last_date,day_count,reason,client_key,payload_hash,created_by,created_at,updated_at,submission_source,source_form_link_id,source_shared_form_link_id,leave_type)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14,$15)`, requestId, me.id, planned.approver.id, planned.dates[0], planned.dates.at(-1), planned.dates.length, reason, body.client_key, hash, user.id, now, formLink ? "FORM" : "PORTAL", formLink && !formLink.shared ? formLink.id : null, formLink?.shared ? formLink.id : null, type2.code);
      for (const a of planned.allocations) await q("INSERT INTO leave_request_days(request_id,employee_id,work_date,balance_year,state,leave_type) VALUES($1,$2,$3,$4,'PENDING',$5)", requestId, me.id, a.date, a.balance_year, type2.code);
      await createSteps(requestId, 1, "APPROVAL", planned.approvers);
      await audit(db, user, "LEAVE_SUBMITTED", "leave_requests", requestId, { days: planned.dates.length, leave_type: type2.code, approver_employee_id: planned.approver.id, conflict_days: planned.conflicts.length, submission_source: formLink ? "FORM" : "PORTAL", source_form_link_id: formLink && !formLink.shared ? formLink.id : null, source_shared_form_link_id: formLink?.shared ? formLink.id : null });
      return { id: requestId, status: "PENDING", conflicts: planned.conflicts };
    }
    const r = await request(id), dates = await requestDays(id);
    assert(Number.isInteger(body.row_version) && body.row_version === r.row_version, "Pengajuan sudah berubah. Muat ulang.", 409);
    assert(dates.length === r.day_count, "Rincian hari tidak konsisten. Hubungi SDM.", 409);
    const type = getLeaveType(r.leave_type);
    assert(type && dates.every((d) => type.deducts_balance ? d.balance_year !== null : d.balance_year === null), "Alokasi jenis cuti tidak konsisten. Hubungi SDM.", 409);
    const setStatus = async (status, note2, decided = false) => {
      await q(`UPDATE leave_requests SET status=$1,decision_note=$2,updated_at=$3,row_version=row_version+1,
    decided_by=CASE WHEN $4 THEN $5::uuid ELSE decided_by END,decided_at=CASE WHEN $4 THEN $3 ELSE decided_at END WHERE id=$6`, status, note2 || null, stamp(), decided, user.id, r.id);
      return { id: r.id, status };
    };
    if (action === "cancel") {
      assert(r.employee_id === user.employee_id, "Hanya pemohon dapat meminta pembatalan.", 403);
      assert(["PENDING", "APPROVED"].includes(r.status) && dates.every((d) => d.work_date >= day), "Pengajuan ini tidak dapat dibatalkan melalui proses ini.", 409);
      const note2 = clean(body.note, "Alasan pembatalan"), status = r.status === "PENDING" ? "CANCELLED" : "CANCELLATION_PENDING";
      if (status === "CANCELLED") await q("UPDATE leave_request_days SET state='RELEASED' WHERE request_id=$1", r.id);
      if (status === "CANCELLED") await q("UPDATE leave_approval_steps SET state='CANCELLED' WHERE request_id=$1 AND state IN ('PENDING','WAITING')", r.id);
      else {
        const route = routeFor(byId.get(r.employee_id)), cycle = r.approval_cycle + 1;
        await createSteps(r.id, cycle, "CANCELLATION", route);
        await q("UPDATE leave_requests SET approval_cycle=$1,approver_employee_id=$2 WHERE id=$3", cycle, route[0].id, r.id);
      }
      await q("UPDATE leave_requests SET cancellation_reason=$1 WHERE id=$2", note2, r.id);
      await setStatus(status, null);
      await audit(db, user, "LEAVE_CANCELLATION_REQUESTED", "leave_requests", r.id, { status }, note2);
      return { id: r.id, status };
    }
    const history = await stepRows([r.id]), approval = progress(r, history);
    assert(action === "decision" && canDecide(r, history), "Hanya pejabat pada tahap persetujuan yang sedang aktif dapat memutuskan.", 403);
    if (approval.legacy) await createSteps(r.id, r.approval_cycle, r.status === "CANCELLATION_PENDING" ? "CANCELLATION" : "APPROVAL", approval.route);
    const decideStep = async (state, note2) => q("UPDATE leave_approval_steps SET state=$1,decided_by=$2,decided_at=now(),note=$3,verified_work_dates=$4,verified_identity=$5 WHERE request_id=$6 AND cycle_no=$7 AND step_no=$8", state, user.id, note2, body.verified_work_dates === true, body.verified_identity === true, r.id, r.approval_cycle, approval.current.step_no);
    const decision = body.decision, note = body.note ? clean(body.note, "Catatan keputusan") : null, cancellation = r.status === "CANCELLATION_PENDING";
    assert(r.status === "PENDING" && ["approve", "reject"].includes(decision) || cancellation && ["approve-cancel", "reject-cancel"].includes(decision), "Keputusan tidak sesuai status pengajuan.", 409);
    if (decision === "reject" || decision === "reject-cancel") {
      assert(note, "Alasan penolakan wajib diisi.");
      if (decision === "reject") await q("UPDATE leave_request_days SET state='RELEASED' WHERE request_id=$1", r.id);
      await decideStep("REJECTED", note);
      await q("UPDATE leave_approval_steps SET state='CANCELLED' WHERE request_id=$1 AND cycle_no=$2 AND state='WAITING'", r.id, r.approval_cycle);
      const result2 = await setStatus(cancellation ? "APPROVED" : "REJECTED", note, true);
      await audit(db, user, cancellation ? "LEAVE_CANCELLATION_REJECTED" : "LEAVE_REJECTED", "leave_requests", r.id, {}, note);
      return result2;
    }
    assert(body.verified_work_dates === true, "Atasan wajib memverifikasi tanggal, ketentuan jenis cuti, atau pembatalan sebelum menyetujui.");
    assert(r.submission_source !== "FORM" || body.verified_identity === true, "Atasan wajib memverifikasi identitas pemohon dari formulir sebelum menyetujui.");
    assert(eligible(byId.get(r.employee_id)), "Status pegawai tidak lagi memenuhi syarat.", 409);
    if (cancellation) assert(dates.every((d) => d.work_date >= day), "Cuti sudah berlangsung. Pembatalan memerlukan rekonsiliasi SDM.", 409);
    const next = approval.steps.find((s) => s.step_no === approval.current.step_no + 1);
    if (next) {
      await decideStep("APPROVED", note);
      await q("UPDATE leave_approval_steps SET state='PENDING' WHERE request_id=$1 AND cycle_no=$2 AND step_no=$3", r.id, r.approval_cycle, next.step_no);
      await q("UPDATE leave_requests SET approver_employee_id=$1,updated_at=$2,row_version=row_version+1 WHERE id=$3", next.approver_employee_id, stamp(), r.id);
      await audit(db, user, "LEAVE_APPROVAL_STAGE_APPROVED", "leave_requests", r.id, { cycle: r.approval_cycle, step: approval.current.step_no, next_approver_employee_id: next.approver_employee_id, purpose: cancellation ? "CANCELLATION" : "APPROVAL" }, note || "");
      return { id: r.id, status: r.status, next_step: next.step_no };
    }
    const byYear = /* @__PURE__ */ new Map();
    if (type.deducts_balance) for (const d of dates) byYear.set(d.balance_year, (byYear.get(d.balance_year) || 0) + 1);
    for (const [year, count] of byYear) {
      const b = await one("SELECT *,expires_on::text expiry,effective_from::text start_day FROM leave_year_balances WHERE employee_id=$1 AND balance_year=$2 FOR UPDATE", r.employee_id, year);
      assert(b && !b.closed_at && b.expiry > day, "Saldo asal sudah kedaluwarsa; lakukan rekonsiliasi sebelum keputusan.", 409);
      assert(dates.filter((d) => d.balance_year === year).every((d) => d.work_date >= b.start_day && d.work_date < b.expiry), "Tanggal tidak sesuai masa berlaku saldo.", 409);
      const delta = cancellation ? count : -count;
      assert(cancellation ? b.consumed_days >= count : b.remaining_days >= count, "Saldo berubah atau tidak mencukupi.", 409);
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
    await decideStep("APPROVED", note);
    const result = await setStatus(cancellation ? "CANCELLED" : "APPROVED", note, true);
    await audit(db, user, cancellation ? "LEAVE_CANCELLATION_APPROVED" : "LEAVE_APPROVED", "leave_requests", r.id, { days: r.day_count, work_dates_verified: true, identity_verified: r.submission_source === "FORM" }, note || "");
    return result;
  }
  return __toCommonJS(leaves_exports);
})();
// END SPECIAL LEAVE MODULE
async function leaveRoutes(context,services){return __specialLeave.leaveRoutes(context,services);}

// supabase/deploy/portal-api/active-gateway-with-leave.ts
import { createHash as driveCacheHash } from "node:crypto";
import { randomBytes as quickReportRandomBytes } from "node:crypto";
import { withSupabase } from "npm:@supabase/server@1";
import postgres from "npm:postgres@3.4.7";
import { createHash as createHash5, randomUUID as randomUUID5 } from "node:crypto";
import { randomUUID } from "node:crypto";
import { randomUUID as randomUUID2 } from "node:crypto";
import { Buffer } from "node:buffer";
import { Buffer as Buffer3 } from "node:buffer";
import { createHash as createHash4 } from "node:crypto";
import { createHash } from "node:crypto";
import { Buffer as Buffer2 } from "node:buffer";
import { basename } from "node:path";
import { createHash as createHash3 } from "node:crypto";
import { createHash as createHash2, randomBytes } from "node:crypto";
import { randomBytes as randomBytes2 } from "node:crypto";
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
async function update(db, table, id, version, values) {
  assert(Number.isInteger(version), "Versi data wajib dikirim. Muat ulang data.", 409);
  const row = { ...values, updated_at: now() };
  const result = await run(db, `UPDATE ${sqlName(table)} SET ${Object.keys(row).map((k) => `${sqlName(k)}=?`).join(",")},row_version=row_version+1 WHERE id=? AND row_version=?`, ...Object.values(row).map((v) => typeof v === "boolean" ? Number(v) : v ?? null), id, version);
  assert(result.changes === 1, "Data sudah berubah. Muat ulang sebelum menyimpan.", 409);
  return one(db, `SELECT * FROM ${sqlName(table)} WHERE id=?`, id);
}
async function tx(db, work) {
  assert(db.inTransaction, "Transaction required.", 500);
  return await work();
}
async function audit(db, actor, action, type, key, summary = {}, reason = "") {
  await insert(db, "audit_events", { actor_user_id: actor?.id || null, action, object_type: type, object_key: String(key), occurred_at: now(), outcome: "SUCCESS", request_id: actor?.request_id || uid(), reason, change_summary: JSON.stringify(summary) });
}
async function get(db, table, id) {
  const row = await one(db, `SELECT * FROM ${sqlName(table)} WHERE id=?`, id);
  assert(row, "Data tidak ditemukan.", 404);
  return row;
}
function text(v, label = "Isian", max = 500) {
  assert(typeof v === "string" && v.trim().length > 0 && v.length <= max, `${label} wajib diisi (maksimal ${max} karakter).`);
  return v.trim();
}
function date(v, label = "Tanggal") {
  assert(typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, `${label} tidak valid.`);
  return v;
}
function instant(v) {
  assert(typeof v === "string" && /(Z|[+-]\d\d:\d\d)$/.test(v) && !isNaN(Date.parse(v)), "Waktu harus menyertakan zona waktu.");
  return new Date(v).toISOString();
}
function integer(v, label, min = 0, max = 1e5) {
  const n = Number(v);
  assert(v !== "" && v != null && Number.isInteger(n) && n >= min && n <= max, `${label} harus bilangan bulat ${min}\u2013${max}.`);
  return n;
}
function enumValue(v, choices, label = "Status") {
  assert(choices.includes(v), `${label} tidak valid.`);
  return v;
}
function runtimeKey(env, dictionary, legacy) {
  const values = env[dictionary];
  if (values) {
    const key = JSON.parse(values).default;
    assert(typeof key === "string" && key.length > 0, "Konfigurasi layanan belum lengkap.", 503);
    return key;
  }
  assert(env[legacy], "Konfigurasi layanan belum lengkap.", 503);
  return env[legacy];
}
function createIdentity(env, fetchImpl = globalThis.fetch.bind(globalThis)) {
  const base = new URL(env.SUPABASE_URL);
  assert(base.protocol === "https:" && /^[a-z0-9-]+\.supabase\.co$/.test(base.hostname) && !base.username && !base.password, "Konfigurasi layanan tidak valid.", 503);
  const key = runtimeKey(env, "SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const created = [];
  async function call(path, method, body, token) {
    let r;
    try {
      r = await fetchImpl(`${base.origin}/auth/v1/${path}`, { method, redirect: "manual", signal: AbortSignal.timeout(12e3), headers: { apikey: key, ...token || key.startsWith("eyJ") ? { Authorization: `Bearer ${token || key}` } : {}, ...body ? { "Content-Type": "application/json" } : {} }, ...body ? { body: JSON.stringify(body) } : {} });
    } catch {
      throw new AppError(503, "Layanan akun belum dapat dihubungi.");
    }
    if (!r.ok) {
      await r.body?.cancel();
      const ended = path === "user" && [401, 403].includes(r.status);
      throw new AppError(ended ? 401 : r.status === 422 ? 422 : 503, ended ? "Sesi berakhir. Silakan masuk kembali." : r.status === 422 ? "Password tidak memenuhi ketentuan layanan akun." : "Layanan akun belum dapat diakses.");
    }
    return r.status === 204 ? null : await r.json();
  }
  return {
    verify: (token) => call("user", "GET", void 0, token),
    async create(password) {
      const user = await call("admin/users", "POST", { email: `${randomUUID2()}@accounts.sph-portal.invalid`, password, email_confirm: true });
      assert(typeof user?.id === "string", "Pembuatan akun belum dapat dikonfirmasi.", 503);
      created.push(user.id);
      return user;
    },
    setPassword: (id, password) => call(`admin/users/${encodeURIComponent(id)}`, "PUT", { password }),
    async rollback() {
      for (const id of created) {
        try {
          await call(`admin/users/${encodeURIComponent(id)}`, "DELETE");
        } catch {
        }
      }
    }
  };
}
var knownReasons = /* @__PURE__ */ new Set(["invalid_grant", "invalid_client", "unauthorized_client", "access_denied", "authError", "insufficientPermissions", "insufficientFilePermissions", "appNotAuthorizedToFile", "notFound", "storageQuotaExceeded", "dailyLimitExceeded", "userRateLimitExceeded", "rateLimitExceeded", "accessNotConfigured", "domainPolicy", "badRequest", "backendError"]);
async function errorReason(response) {
  const reader = response.body?.getReader();
  if (!reader) return "unknown";
  const chunks = [];
  let size = 0;
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16384) {
        await reader.cancel();
        return "unknown";
      }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const reason = typeof body.error === "string" ? body.error : body.error?.errors?.find((e) => knownReasons.has(e.reason))?.reason;
    return knownReasons.has(reason) ? reason : "unknown";
  } catch {
    return "unknown";
  } finally {
    reader.releaseLock();
  }
}
function storageError(stage, status, reason) {
  let message = "Penyimpanan berkas belum dapat diakses.";
  if (reason === "invalid_grant") message = "Koneksi Google Drive perlu dihubungkan ulang. Token akses telah kedaluwarsa atau dicabut.";
  else if (["invalid_client", "unauthorized_client"].includes(reason)) message = "Konfigurasi OAuth Google Drive tidak valid. Administrator perlu memeriksa koneksi penyimpanan.";
  else if (["insufficientPermissions", "access_denied"].includes(reason)) message = "Izin koneksi Google Drive belum mengizinkan tindakan ini. Administrator perlu memeriksa izin unggah.";
  else if (["insufficientFilePermissions", "appNotAuthorizedToFile", "domainPolicy"].includes(reason)) message = "Aplikasi belum memiliki izin untuk menyimpan berkas di folder Google Drive tujuan.";
  else if (reason === "notFound" || status === 404) message = "Folder atau berkas Google Drive tidak ditemukan atau belum dapat diakses aplikasi.";
  else if (reason === "storageQuotaExceeded") message = "Penyimpanan Google Drive penuh. Hubungi administrator untuk memeriksa kuota.";
  else if (["dailyLimitExceeded", "userRateLimitExceeded", "rateLimitExceeded"].includes(reason)) message = "Batas penggunaan Google Drive tercapai. Coba lagi beberapa saat atau hubungi administrator.";
  else if (reason === "accessNotConfigured") message = "Google Drive API belum aktif untuk koneksi penyimpanan aplikasi.";
  else if (reason === "network_error") message = "Penyimpanan berkas belum dapat dihubungi.";
  else if (stage === "upload") message = `Google Drive menolak unggahan berkas (HTTP ${status}). Hubungi administrator.`;
  else if (stage === "token") message = `Koneksi Google Drive gagal memperbarui akses (HTTP ${status}). Hubungi administrator.`;
  return new AppError(503, message, { service: "google_drive", stage, upstream_status: status, reason });
}
var driveModuleFolders = Object.freeze({
  sop: "SPH-Portal-SOP",
  pelatihan: "SPH-Portal-Pelatihan",
  pegawai: "SPH-Portal-Pegawai",
  patroli: "SPH-Portal-Patroli",
  kejadian: "SPH-Portal-Kejadian",
  informasi: "SPH-Portal-Informasi",
  pengadaan: "SPH-Portal-Pengadaan",
  website: "SPH-Portal-Website",
  coaching: "SPH-Portal-Coaching",
  briefing: "SPH-Portal-Briefing",
  absensi: "SPH-Portal-Absensi",
  arsip: "SPH-Portal-Arsip"
});
function driveModuleForOperation(path, body = {}) {
  const resource = typeof path === "string" ? path.split("/")[0] : "";
  if (resource === "attachments") return { employee: "pegawai", logbook: "patroli", incident: "kejadian" }[body?.type] || null;
  const module = { briefings: "briefing", documents: "sop", training: "pelatihan", employees: "pegawai", logbook: "patroli", incidents: "kejadian", announcements: "informasi", purchasing: "pengadaan", website: "website", coaching: "coaching", archives: "arsip" }[resource];
  return typeof module === "string" ? module : null;
}
var driveAccessTokens = /* @__PURE__ */ new Map();
function createDriveStorage(env, fetchImpl, options = {}) {
  const tokenCache = options.tokenCache || (fetchImpl === void 0 ? driveAccessTokens : void 0);
  fetchImpl = fetchImpl || globalThis.fetch.bind(globalThis);
  const value = (name) => typeof env[name] === "string" ? env[name].trim() : "";
  const folder = value("GOOGLE_DRIVE_FOLDER_ID"), clientId = value("GOOGLE_DRIVE_CLIENT_ID"), clientSecret = value("GOOGLE_DRIVE_CLIENT_SECRET"), refreshToken = value("GOOGLE_DRIVE_REFRESH_TOKEN");
  const cacheKey = driveCacheHash("sha256").update(JSON.stringify([folder, clientId, clientSecret, refreshToken])).digest("hex");
  const created = [], moves = [], claimed = /* @__PURE__ */ new Set(), folders = /* @__PURE__ */ new Map(), freshUploads = /* @__PURE__ */ new Map();
  let access, pendingAccess;
  const folderType = "application/vnd.google-apps.folder";
  const metadataFields = "id,parents,trashed,mimeType,appProperties";
  async function request(url, options2 = {}, stage = "storage") {
    let r;
    try {
      r = await fetchImpl(url, { ...options2, redirect: "manual", signal: AbortSignal.timeout(12e3) });
    } catch {
      throw storageError(stage, null, "network_error");
    }
    if (!r.ok) {
      if (r.status === 401 && stage !== "token") {
        access = void 0;
        tokenCache?.delete(cacheKey);
      }
      throw storageError(stage, r.status, await errorReason(r));
    }
    return r;
  }
  async function token() {
    if (access) return access;
    assert(folder && clientId && clientSecret && refreshToken, "Penyimpanan berkas belum dikonfigurasi.", 503);
    const saved = tokenCache?.get(cacheKey);
    if (saved && saved.expiresAt > Date.now()) {
      access = saved.access;
      return access;
    }
    if (!pendingAccess) pendingAccess = (async () => {
      const r = await request("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }) }, "token");
      const j = await r.json();
      assert(typeof j.access_token === "string" && j.access_token.length > 0 && j.access_token.length < 8192, "Penyimpanan berkas belum dapat diakses.", 503);
      const lifetime = Math.min(Number(j.expires_in), 3600);
      access = j.access_token;
      if (tokenCache && Number.isFinite(lifetime) && lifetime > 60) {
        for (const [key, item] of tokenCache) if (item.expiresAt <= Date.now()) tokenCache.delete(key);
        if (tokenCache.size >= 4 && !tokenCache.has(cacheKey)) tokenCache.delete(tokenCache.keys().next().value);
        tokenCache.set(cacheKey, { access, expiresAt: Date.now() + (lifetime - 60) * 1e3 });
      }
      return access;
    })();
    try {
      return await pendingAccess;
    } catch (error) {
      tokenCache?.delete(cacheKey);
      throw error;
    } finally {
      pendingAccess = void 0;
    }
  }
  const headers = async () => ({ Authorization: `Bearer ${await token()}` });
  const valid = (id) => assert(typeof id === "string" && /^[A-Za-z0-9_-]{8,200}$/.test(id), "Berkas tidak tersedia.", 404);
  const knownModule = (module) => typeof module === "string" && Object.hasOwn(driveModuleFolders, module);
  const validFolder = (meta, module) => meta && typeof meta.id === "string" && /^[A-Za-z0-9_-]{8,200}$/.test(meta.id) && meta.trashed === false && meta.mimeType === folderType && meta.parents?.length === 1 && meta.parents[0] === folder && meta.appProperties?.sph_portal === "v1" && meta.appProperties.sph_module === module;
  async function metadata(id) {
    valid(id);
    try {
      return await (await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=${metadataFields}`, { headers: await headers() }, "metadata")).json();
    } catch (error) {
      if (error instanceof AppError && error.details?.stage === "metadata" && error.details.upstream_status === 404) throw new AppError(404, "Berkas tidak tersedia.");
      throw error;
    }
  }
  async function moduleFolder(module) {
    assert(knownModule(module), "Modul penyimpanan tidak valid.");
    if (!folders.has(module)) {
      const pending = (async () => {
        valid(folder);
        const url = new URL("https://www.googleapis.com/drive/v3/files");
        url.searchParams.set("q", `'${folder}' in parents and trashed = false and mimeType = '${folderType}' and appProperties has { key='sph_portal' and value='v1' } and appProperties has { key='sph_module' and value='${module}' }`);
        url.searchParams.set("fields", `files(${metadataFields})`);
        url.searchParams.set("pageSize", "100");
        url.searchParams.set("orderBy", "createdTime");
        const listing = await (await request(url.href, { headers: await headers() }, "folder")).json();
        const existing = listing.files?.find((meta2) => validFolder(meta2, module));
        if (existing) return existing.id;
        const meta = await (await request(`https://www.googleapis.com/drive/v3/files?fields=${metadataFields}`, { method: "POST", headers: { ...await headers(), "Content-Type": "application/json" }, body: JSON.stringify({ name: driveModuleFolders[module], mimeType: folderType, parents: [folder], appProperties: { sph_portal: "v1", sph_module: module } }) }, "folder")).json();
        assert(validFolder(meta, module), "Folder penyimpanan belum dapat diverifikasi.", 503);
        return meta.id;
      })();
      folders.set(module, pending);
      try {
        return await pending;
      } catch (error) {
        folders.delete(module);
        throw error;
      }
    }
    return folders.get(module);
  }
  async function ownedMetadata(id) {
    const meta = await metadata(id);
    assert(meta.id === id && meta.trashed === false && typeof meta.mimeType === "string" && meta.mimeType !== folderType && meta.appProperties?.sph_portal === "v1" && meta.parents?.length === 1, "Berkas tidak tersedia.", 404);
    if (meta.parents[0] === folder) return meta;
    const parent = await metadata(meta.parents[0]), module = parent?.appProperties?.sph_module;
    assert(knownModule(module) && validFolder(parent, module) && parent.id === meta.parents[0] && (!meta.appProperties.sph_module || meta.appProperties.sph_module === module), "Berkas tidak tersedia.", 404);
    return meta;
  }
  async function move(id, from, to, properties) {
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);
    url.searchParams.set("addParents", to);
    url.searchParams.set("removeParents", from);
    url.searchParams.set("fields", metadataFields);
    return (await request(url.href, { method: "PATCH", headers: { ...await headers(), "Content-Type": "application/json" }, body: JSON.stringify({ appProperties: properties }) }, "organize")).json();
  }
  async function organize(id, module, meta) {
    assert(knownModule(module), "Modul penyimpanan tidak valid.");
    meta = meta || await ownedMetadata(id);
    if (meta.parents[0] !== folder && meta.appProperties.sph_module === module) return;
    const target = await moduleFolder(module);
    if (meta.parents[0] === target) return;
    moves.push({ id, from: meta.parents[0], to: target, properties: { ...meta.appProperties } });
    const moved = await move(id, meta.parents[0], target, { ...meta.appProperties, sph_module: module });
    assert(moved.id === id && moved.parents?.length === 1 && moved.parents[0] === target && moved.appProperties?.sph_portal === "v1" && moved.appProperties.sph_module === module, "Pemindahan berkas belum dapat diverifikasi.", 503);
  }
  return {
    async put(data, mime) {
      const boundary = `sph_${randomUUID()}`;
      const module = options.module;
      assert(module == null || knownModule(module), "Modul penyimpanan tidak valid.");
      const parent = module ? await moduleFolder(module) : folder;
      const meta = { name: randomUUID(), parents: [parent], appProperties: { sph_portal: "v1", ...module ? { sph_module: module } : {} } };
      const body = new Blob([`--${boundary}\r
Content-Type: application/json; charset=UTF-8\r
\r
${JSON.stringify(meta)}\r
--${boundary}\r
Content-Type: ${mime}\r
\r
`, data, `\r
--${boundary}--`]);
      const r = await request(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${metadataFields}`, { method: "POST", headers: { ...await headers(), "Content-Type": `multipart/related; boundary=${boundary}` }, body }, "upload");
      const file = await r.json();
      valid(file.id);
      created.push(file.id);
      assert(file.trashed === false && file.mimeType === mime && file.parents?.length === 1 && file.parents[0] === parent && file.appProperties?.sph_portal === "v1" && (!module || file.appProperties.sph_module === module), "Unggahan berkas belum dapat diverifikasi.", 503);
      freshUploads.set(file.id, module);
      return file.id;
    },
    claim(id) {
      valid(id);
      claimed.add(id);
    },
    async finalize() {
      if (!claimed.size) return;
      assert(knownModule(options.module), "Modul lampiran belum dapat ditentukan.", 503);
      for (const id of claimed) if (freshUploads.get(id) !== options.module) await organize(id, options.module);
      claimed.clear();
    },
    async get(id, module) {
      const meta = await ownedMetadata(id);
      if (module) await organize(id, module, meta);
      const r = await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { headers: await headers() }, "download");
      const chunks = [];
      let size = 0;
      const reader = r.body.getReader();
      try {
        for (; ; ) {
          const { done, value: value2 } = await reader.read();
          if (done) break;
          size += value2.length;
          if (size > 10 * 1024 * 1024) {
            await reader.cancel();
            throw new AppError(503, "Berkas melebihi ukuran yang diizinkan.");
          }
          chunks.push(value2);
        }
      } finally {
        reader.releaseLock();
      }
      return Buffer.concat(chunks);
    },
    async rollback() {
      for (const entry of moves.slice().reverse()) {
        if (created.includes(entry.id)) continue;
        try {
          const meta = await ownedMetadata(entry.id);
          if (meta.parents[0] !== entry.to) continue;
          await move(entry.id, entry.to, entry.from, { ...entry.properties, sph_module: entry.properties.sph_module || null });
        } catch {
        }
      }
      for (const id of created) {
        try {
          await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, { method: "DELETE", headers: await headers() }, "cleanup");
        } catch {
        }
      }
    }
  };
}
async function asyncMap(items, fn) {
  const out = [];
  for (let i = 0; i < items.length; i++) out.push(await fn(items[i], i, items));
  return out;
}
async function asyncFilter(items, fn) {
  const out = [];
  for (let i = 0; i < items.length; i++) if (await fn(items[i], i, items)) out.push(items[i]);
  return out;
}
async function asyncSome(items, fn) {
  for (let i = 0; i < items.length; i++) if (await fn(items[i], i, items)) return true;
  return false;
}
async function asyncEvery(items, fn) {
  for (let i = 0; i < items.length; i++) if (!await fn(items[i], i, items)) return false;
  return true;
}
async function asyncForEach(items, fn) {
  for (let i = 0; i < items.length; i++) await fn(items[i], i, items);
}
var digest = (value) => createHash("sha256").update(value).digest("hex");
var purchasingRoleCodes = {
  PURCHASE_REQUESTER: ["Pemohon Pengadaan", ["purchasing.requests.create", "purchasing.requests.read"]],
  PURCHASING_STAFF: ["Staf Purchasing", ["purchasing.requests.read", "purchasing.procurement.manage", "purchasing.vendors.read", "purchasing.vendors.manage", "purchasing.vendors.sensitive", "purchasing.budget.read", "purchasing.reports.read"]],
  FINANCE_VERIFIER: ["Verifikator Keuangan", ["purchasing.requests.read", "purchasing.requests.verify", "purchasing.budget.read", "purchasing.budget.manage", "purchasing.vendors.read", "purchasing.vendors.sensitive", "purchasing.reports.read"]],
  PURCHASE_AUDITOR: ["Pemeriksa SPI", ["purchasing.requests.read", "purchasing.vendors.read", "purchasing.budget.read", "purchasing.reports.read", "purchasing.reports.export", "admin.audit.read"]],
  PURCHASE_ADMIN: ["Pengelola Pengadaan", ["purchasing.settings.manage", "purchasing.requests.read", "purchasing.vendors.read", "purchasing.vendors.manage", "purchasing.vendors.sensitive", "purchasing.budget.read", "purchasing.budget.manage"]]
};
var purchasingRoles = Object.entries(purchasingRoleCodes).map(([code, [name, codes]]) => [code, name, (c) => codes.includes(c)]);
async function grants(db, user) {
  const key = `grants:${user.id}`, cache = db.authorizationCache;
  if (cache?.has(key)) return cache.get(key);
  const rows = await all(db, `SELECT DISTINCT ur.id,ur.scope_kind,r.code role_code,p.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id AND r.is_active=1 JOIN permissions p ON EXISTS(SELECT 1 FROM role_permissions rp WHERE rp.role_id=r.id AND rp.permission_id=p.id) OR (r.code='SUPER_ADMIN' AND ur.scope_kind='ALL') WHERE ur.user_id=?`, user.id);
  cache?.set(key, rows);
  return rows;
}
var IT_ADMIN_PERMISSIONS = ["admin.users.read", "admin.users.manage", "admin.users.reset", "admin.roles.read", "admin.roles.manage", "admin.audit.read"];
async function isSuperAdmin(db, user) {
  return Boolean(await one(db, "SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=? AND r.is_active=1 AND r.code='SUPER_ADMIN' AND ur.scope_kind='ALL'", user.id));
}
async function protectAdminAccount(db, actor, targetId) {
  assert(await isSuperAdmin(db, actor) || !await isSuperAdmin(db, {
    id: targetId
  }), "Hanya Superadmin yang boleh mengubah akun atau memulihkan password Superadmin.", 403);
}
async function employeeContext(db, id, asOf) {
  const e = await one(db, `SELECT e.id employee_id,p.org_unit_id FROM employees e LEFT JOIN employee_placements ep ON ep.employee_id=e.id AND ep.is_primary=1 AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?) LEFT JOIN positions p ON p.id=ep.position_id WHERE e.id=?`, asOf || today(), asOf || today(), id);
  return e || {
    employee_id: id
  };
}
async function authorizationScopeRows(db, kind, id, target) {
  const key = JSON.stringify(["scope", kind, id, target]), cache = db.authorizationCache;
  if (cache?.has(key)) return cache.get(key);
  const sql = kind === "units" ? "SELECT * FROM user_role_units WHERE user_role_id=?" : kind === "post" ? "SELECT 1 FROM user_role_posts WHERE user_role_id=? AND post_id=?" : "WITH RECURSIVE tree(id) AS (SELECT id FROM org_units WHERE parent_id=? UNION ALL SELECT o.id FROM org_units o JOIN tree t ON o.parent_id=t.id) SELECT id FROM tree WHERE id=?";
  const rows = await all(db, sql, ...kind === "units" ? [id] : [id, target]);
  cache?.set(key, rows);
  return rows;
}
async function can(db, user, permission, context = {}) {
  const matches = (await grants(db, user)).filter((g) => g.code === permission);
  return await asyncSome(matches, async (g) => {
    if (g.scope_kind === "ALL") return true;
    if (g.scope_kind === "SELF") return Boolean(user.employee_id && [context.employee_id, context.reporter_employee_id, ...context.related_employees || []].includes(user.employee_id));
    if (g.scope_kind === "ASSIGNED_POSTS") return permission.startsWith("security.") && Boolean(context.post_id && (await authorizationScopeRows(db, "post", g.id, context.post_id)).length);
    if (!context.org_unit_id) return false;
    return await asyncSome(await authorizationScopeRows(db, "units", g.id), async (u) => {
      if (u.org_unit_id === context.org_unit_id) return true;
      return u.include_descendants && Boolean((await authorizationScopeRows(db, "descendants", u.org_unit_id, context.org_unit_id)).length);
    });
  });
}
async function has(db, user, permission) {
  return (await grants(db, user)).some((g) => g.code === permission);
}
async function requireAccess(db, user, permission, context = {}) {
  assert(await can(db, user, permission, context), "Anda tidak memiliki akses untuk tindakan atau cakupan data ini.", 403);
}
async function postContext(db, id) {
  const p = await one(db, "SELECT org_unit_id,id post_id FROM security_posts WHERE id=?", id);
  assert(p, "Pos tidak ditemukan.", 404);
  return p;
}
async function reportContext(db, row) {
  return {
    ...row,
    ...row.post_id ? await postContext(db, row.post_id) : {
      org_unit_id: row.reporting_org_unit_id
    },
    related_employees: [row.responsible_employee_id].filter(Boolean)
  };
}
async function announcementsManager(db, user) {
  return Boolean(await one(db, "SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=? AND r.is_active=1 AND r.code IN ('SUPER_ADMIN','SDM')", user.id));
}
async function coachingAllowed(db, user, action, session) {
  if (await can(db, user, "hr.coaching.manage", session)) return true;
  return [session.employee_id, session.coach_employee_id].includes(user.employee_id) && await can(db, user, `hr.coaching.${action}`, {
    ...session,
    related_employees: [session.employee_id, session.coach_employee_id]
  });
}
async function documentAllowed(db, user, action, doc) {
  if (doc.is_archived) return false;
  const permission = `hr.documents.${action}`;
  if (!["read", "download"].includes(action)) return await can(db, user, permission, {
    org_unit_id: doc.owner_org_unit_id
  });
  const targets = (await all(db, "SELECT org_unit_id FROM document_target_units WHERE document_id=?", doc.id)).map((t) => t.org_unit_id);
  return await asyncSome((await grants(db, user)).filter((g) => g.code === permission), async (g) => {
    if (g.scope_kind === "ALL") return true;
    if (g.scope_kind === "ASSIGNED_POSTS") return false;
    if (g.scope_kind === "SELF") {
      const unit = user.employee_id && (await employeeContext(db, user.employee_id)).org_unit_id;
      return Boolean(unit && (doc.audience_kind === "ALL_UNITS" || targets.includes(unit)));
    }
    return doc.audience_kind === "ALL_UNITS" || await asyncSome(targets, async (org_unit_id) => await can(db, user, permission, {
      org_unit_id
    }));
  });
}
async function trainingAllowed(db, user, action, event) {
  if (event.deleted_at) return false;
  const related = user.employee_id && await one(db, "SELECT id FROM training_participants WHERE training_event_id=? AND employee_id=?", event.id, user.employee_id);
  return await can(db, user, `hr.training.${action}`, {
    org_unit_id: event.organizer_org_unit_id,
    employee_id: related ? user.employee_id : null
  });
}
async function assertAdminRemains(db) {
  const users = await all(db, `SELECT u.* FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.status='ACTIVE' AND (u.employee_id IS NULL OR e.is_active=1)`);
  assert(await asyncSome(users, async (u) => await isSuperAdmin(db, u)), "Administrator terakhir dengan role Superadmin yang aktif tidak boleh dinonaktifkan atau kehilangan role.", 409);
}
var safeUser = (u) => ({
  id: u.id,
  username: u.username,
  employee_id: u.employee_id,
  must_change_password: Boolean(u.must_change_password),
  status: u.status,
  row_version: u.row_version
});
var DEFAULT_SETTINGS = Object.freeze({
  sekban_max_total: 5e6,
  attachment_min_item_subtotal: 1e6,
  comparison_min_total: 1e6,
  min_quotes_per_item: 2,
  officials: {
    sekban_position_id: null,
    sekban_deputy_position_id: null,
    kaban_position_id: null
  },
  unit_codes: {},
  number_floor: {
    year: null,
    PO: 0,
    SPK: 0,
    SPV: 0
  },
  organization: {
    name: "Badan Pengelola Fasilitas Kawasan Suci Pura Agung Besakih",
    short_name: "BP Besakih",
    address: "",
    city: "Besakih"
  },
  texts: {
    payment_terms: "TOP 7 Hari",
    billing_text: "1. Pembayaran dilakukan paling lambat 7 hari setelah dokumen penagihan lengkap diterima Bagian Keuangan.\n2. Dokumen penagihan: kwitansi bermeterai sesuai ketentuan, invoice, BAST, dokumentasi, dan SPJ."
  }
});
var MAX_MONEY = 1e15;
var STATUS_LABELS = {
  pending_acknowledgement: "Menunggu atasan",
  pending_verification: "Menunggu Keuangan",
  pending_final_approval: "Menunggu Sekban/Kaban",
  returned: "Dikembalikan",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
  pending_completeness_check: "Diperiksa Purchasing",
  in_procurement: "Diproses Purchasing",
  pending_requester_confirmation: "Menunggu konfirmasi pemohon",
  pending_reverification: "Verifikasi ulang Keuangan",
  pending_reapproval: "Persetujuan ulang Kaban",
  completed: "Selesai"
};
var TRANSITIONS = {
  pending_acknowledgement: ["pending_verification", "returned", "rejected", "cancelled"],
  pending_verification: ["pending_final_approval", "returned", "rejected", "cancelled"],
  pending_final_approval: ["pending_completeness_check", "returned", "rejected", "cancelled"],
  returned: ["pending_acknowledgement", "pending_verification", "cancelled"],
  pending_completeness_check: ["in_procurement", "rejected", "cancelled"],
  in_procurement: ["pending_requester_confirmation", "completed"],
  pending_requester_confirmation: ["pending_reverification", "in_procurement", "cancelled"],
  pending_reverification: ["in_procurement", "pending_reapproval", "rejected"],
  pending_reapproval: ["in_procurement", "rejected"],
  rejected: [],
  cancelled: [],
  completed: []
};
function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}
function mergeSettings(stored) {
  const s = stored && typeof stored === "object" ? stored : {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    officials: {
      ...DEFAULT_SETTINGS.officials,
      ...s.officials || {}
    },
    unit_codes: {
      ...s.unit_codes || {}
    },
    number_floor: {
      ...DEFAULT_SETTINGS.number_floor,
      ...s.number_floor || {}
    },
    organization: {
      ...DEFAULT_SETTINGS.organization,
      ...s.organization || {}
    },
    texts: {
      ...DEFAULT_SETTINGS.texts,
      ...s.texts || {}
    }
  };
}
function money(value, label = "Nilai") {
  const n = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  if (!(Number.isSafeInteger(n) && n >= 0 && n <= MAX_MONEY)) throw new RangeError(`${label} harus rupiah bulat 0 sampai ${MAX_MONEY.toLocaleString("id-ID")}.`);
  return n;
}
function quantityMilli(value, label = "Jumlah") {
  const text2 = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim().replace(",", ".") : "";
  const match = /^(\d{1,7})(?:\.(\d{1,3}))?$/.exec(text2);
  if (!match) throw new RangeError(`${label} harus angka lebih dari 0 dengan paling banyak tiga desimal.`);
  const milli = Number(match[1]) * 1e3 + Number((match[2] || "").padEnd(3, "0"));
  if (!(milli > 0)) throw new RangeError(`${label} harus lebih dari 0.`);
  return milli;
}
function formatQuantity(milli) {
  const whole = Math.floor(milli / 1e3), fraction = milli % 1e3;
  return fraction ? `${whole},${String(fraction).padStart(3, "0").replace(/0+$/, "")}` : String(whole);
}
function lineSubtotal(milli, unitPrice) {
  const value = (BigInt(milli) * BigInt(unitPrice) + 500n) / 1000n;
  if (value > BigInt(MAX_MONEY)) throw new RangeError("Subtotal melebihi batas nilai yang diizinkan.");
  return Number(value);
}
function sum(values) {
  const total = values.reduce((acc, v) => acc + BigInt(v), 0n);
  if (total > BigInt(MAX_MONEY)) throw new RangeError("Total melebihi batas nilai yang diizinkan.");
  return Number(total);
}
function finalApproverKind(total, special, settings = DEFAULT_SETTINGS) {
  return special || total > settings.sekban_max_total ? "KABAN" : "SEKBAN";
}
function attachmentRequired(subtotal, settings = DEFAULT_SETTINGS) {
  return subtotal >= settings.attachment_min_item_subtotal;
}
function allowedPaths(total, settings = DEFAULT_SETTINGS) {
  return total < settings.comparison_min_total ? ["A"] : ["B", "C"];
}
function documentKindFor(kinds) {
  return kinds.length && kinds.every((k) => k === "GOODS") ? "PO" : "SPK";
}
var ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
var romanMonth = (isoDate) => ROMAN[Number(isoDate.slice(5, 7)) - 1];
var pad = (n, width = 3) => String(n).padStart(width, "0");
function requestCode(year2, n) {
  return `PJ-${year2}-${pad(n, 4)}`;
}
function documentNumber(kind, n, isoDate, key = "") {
  const tail = `${romanMonth(isoDate)}/${isoDate.slice(0, 4)}`;
  if (kind === "PR") return `${pad(n)}/PR/${key}/${tail}`;
  return `${pad(n)}/${kind}/PURCHASE/${tail}`;
}
function parseSequence(number) {
  const match = /^(\d+)\//.exec(number || "");
  return match ? Number(match[1]) : null;
}
function addDays(isoDate, days2) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days2 * 864e5).toISOString().slice(0, 10);
}
function isLate(order, today2) {
  return Boolean(order.due_on && !["received", "cancelled"].includes(order.status) && today2 > order.due_on);
}
var ONES = ["", "Satu", "Dua", "Tiga", "Empat", "Lima", "Enam", "Tujuh", "Delapan", "Sembilan", "Sepuluh", "Sebelas"];
function words(n) {
  if (n < 12) return ONES[n];
  if (n < 20) return `${words(n - 10)} Belas`;
  if (n < 100) return `${words(Math.floor(n / 10))} Puluh${n % 10 ? " " + words(n % 10) : ""}`;
  if (n < 200) return `Seratus${n > 100 ? " " + words(n - 100) : ""}`;
  if (n < 1e3) return `${words(Math.floor(n / 100))} Ratus${n % 100 ? " " + words(n % 100) : ""}`;
  if (n < 2e3) return `Seribu${n > 1e3 ? " " + words(n - 1e3) : ""}`;
  const scales = [[1e12, "Triliun"], [1e9, "Miliar"], [1e6, "Juta"], [1e3, "Ribu"]];
  for (const [size, name] of scales) if (n >= size) {
    const head = Math.floor(n / size), rest = n % size;
    return `${words(head)} ${name}${rest ? " " + words(rest) : ""}`;
  }
  return "";
}
function terbilang(value) {
  const n = money(value);
  return `${n === 0 ? "Nol" : words(n)} Rupiah`;
}
function formatRupiah(value) {
  return "Rp" + String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}
var SETTINGS_KEY = "purchasing.settings";
var ACTIVE_COMMITMENT = ["pending_completeness_check", "in_procurement", "pending_requester_confirmation", "pending_reverification", "pending_reapproval"];
var CANCELLABLE = ["pending_acknowledgement", "pending_verification", "pending_final_approval", "returned", "pending_completeness_check"];
var STEP_LABELS = {
  ACKNOWLEDGE: "Diketahui",
  VERIFY: "Verifikasi",
  FINAL: "Disetujui",
  REVERIFY: "Verifikasi ulang",
  REAPPROVE: "Persetujuan ulang",
  APPOINTMENT: "Surat penunjukan",
  ORDER: "Persetujuan PO/SPK"
};
var optional = (v, max = 2e3) => typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
var flag = (v) => v === true || v === 1 || v === "1" || v === "true" ? 1 : 0;
var year = (isoDate) => Number(isoDate.slice(0, 4));
var sha256 = (value) => createHash2("sha256").update(value).digest("hex");
var mask = (value) => value ? "\u2022\u2022\u2022\u2022" + String(value).slice(-4) : value;
function rule(fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RangeError) throw new AppError(422, e.message);
    throw e;
  }
}
async function pick(db, table, id, label) {
  assert(typeof id === "string" && id.length > 0 && id.length <= 64, `${label} wajib dipilih.`);
  return await get(db, table, id);
}
function versionOf(b) {
  assert(Number.isInteger(b?.row_version), "Versi data wajib dikirim. Muat ulang data.", 409);
  return b.row_version;
}
async function purchasingSettings(db) {
  const row = await one(db, "SELECT value FROM app_settings WHERE key=?", SETTINGS_KEY);
  let stored = {};
  if (row) {
    try {
      stored = JSON.parse(row.value);
    } catch {
      stored = {};
    }
  }
  return mergeSettings(stored);
}
async function purchasingAccess(db, user, settings) {
  settings = settings || await purchasingSettings(db);
  const rows = (await grants(db, user)).filter((g) => g.code.startsWith("purchasing.") || g.code === "admin.audit.read");
  const unitRows = rows.some((g) => g.scope_kind === "ASSIGNED_UNITS") ? await all(db, "SELECT user_role_id,org_unit_id,include_descendants FROM user_role_units WHERE user_role_id IN (SELECT id FROM user_roles WHERE user_id=?)", user.id) : [];
  const tree = unitRows.some((u) => u.include_descendants) ? await all(db, "SELECT id,parent_id FROM org_units") : [];
  const below = (root) => {
    const found = /* @__PURE__ */ new Set([root]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const u of tree) if (u.parent_id && found.has(u.parent_id) && !found.has(u.id)) {
        found.add(u.id);
        grew = true;
      }
    }
    return found;
  };
  const perms = {};
  for (const g of rows) {
    const p = perms[g.code] || (perms[g.code] = {
      all: false,
      self: false,
      units: /* @__PURE__ */ new Set()
    });
    if (g.scope_kind === "ALL") p.all = true;
    else if (g.scope_kind === "SELF") p.self = true;
    else if (g.scope_kind === "ASSIGNED_UNITS") for (const u of unitRows.filter((u2) => u2.user_role_id === g.id)) for (const id of u.include_descendants ? below(u.org_unit_id) : [u.org_unit_id]) p.units.add(id);
  }
  return {
    superadmin: rows.some((g) => g.role_code === "SUPER_ADMIN" && g.scope_kind === "ALL"),
    sekban_peers: await sekbanPeers(db, settings, user.employee_id, today()),
    perms,
    has: (code) => Boolean(perms[code]),
    allows: (code, ctx = {}) => {
      const p = perms[code];
      if (!p) return false;
      if (p.all) return true;
      if (p.self && user.employee_id && ctx.employee_id === user.employee_id) return true;
      return Boolean(ctx.org_unit_id && p.units.has(ctx.org_unit_id));
    },
    broad: (code) => {
      const p = perms[code];
      return Boolean(p && (p.all || p.units.size));
    }
  };
}
async function employeeOnDate(db, employeeId, asOf = today()) {
  return await one(db, `SELECT e.id,e.full_name,e.employee_no,e.phone,e.is_active,ep.supervisor_employee_id,p.id position_id,p.name position_name,p.org_unit_id,u.name unit_name,u.code unit_code
    FROM employees e LEFT JOIN employee_placements ep ON ep.employee_id=e.id AND ep.is_primary=1 AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?)
    LEFT JOIN positions p ON p.id=ep.position_id LEFT JOIN org_units u ON u.id=p.org_unit_id WHERE e.id=?`, asOf, asOf, employeeId);
}
async function positionHolders(db, positionId, asOf) {
  return await all(db, `SELECT DISTINCT e.id,e.full_name,e.employee_no,e.phone,p.name position_name FROM employee_placements ep JOIN employees e ON e.id=ep.employee_id JOIN positions p ON p.id=ep.position_id
    WHERE ep.position_id=? AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?) AND e.is_active=1 ORDER BY e.full_name`, positionId, asOf, asOf);
}
async function sekbanHolders(db, settings, asOf) {
  const ids = [settings.officials.sekban_position_id, settings.officials.sekban_deputy_position_id, settings.officials.kaban_position_id];
  if (!ids.every(Boolean) || new Set(ids).size !== 3) return [];
  const holders = await all(db, `SELECT DISTINCT ep.position_id,e.id,e.full_name,e.employee_no,e.phone,p.name position_name
    FROM employee_placements ep JOIN employees e ON e.id=ep.employee_id JOIN positions p ON p.id=ep.position_id
    WHERE ep.position_id IN (?,?,?) AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?) AND e.is_active=1 AND p.is_active=1`, ...ids, asOf, asOf);
  if (ids.some((id) => holders.filter((h) => h.position_id === id).length !== 1) || new Set(holders.map((h) => h.id)).size !== 3) return [];
  return holders.filter((h) => h.position_id !== settings.officials.kaban_position_id);
}
async function sekbanPeers(db, settings, employeeId, asOf) {
  if (!employeeId || !settings.officials.sekban_deputy_position_id) return [];
  const holders = await sekbanHolders(db, settings, asOf);
  return holders.some((h) => h.id === employeeId) ? [...new Set(holders.map((h) => h.id))].filter((id) => id !== employeeId) : [];
}
async function official(db, settings, kind, asOf) {
  const name = kind === "SEKBAN" ? "Sekban" : "Kaban", positionId = settings.officials[kind === "SEKBAN" ? "sekban_position_id" : "kaban_position_id"];
  assert(positionId, `Posisi ${name} belum dipilih di Pengaturan Pengadaan.`, 409);
  const holders = await positionHolders(db, positionId, asOf);
  assert(holders.length === 1, `Posisi ${name} harus punya tepat satu pemegang aktif di data SDM (sekarang ${holders.length}).`, 409);
  return holders[0];
}
async function holdsKaban(db, settings, employeeId, asOf) {
  if (!settings.officials.kaban_position_id) return false;
  return (await positionHolders(db, settings.officials.kaban_position_id, asOf)).some((h) => h.id === employeeId);
}
async function delegatorsOf(db, employeeId, asOf) {
  if (!employeeId) return [];
  return (await all(db, "SELECT from_employee_id FROM purchase_delegations WHERE to_employee_id=? AND revoked_at IS NULL AND starts_on<=? AND ends_on>=?", employeeId, asOf, asOf)).map((r) => r.from_employee_id);
}
async function nextSequence(db, docType, key, yr, floor = 0) {
  const row = await one(db, "SELECT * FROM purchase_number_sequences WHERE doc_type=? AND sequence_key=? AND year=?", docType, key, yr);
  if (!row) {
    const n2 = Math.max(0, floor) + 1;
    await insert(db, "purchase_number_sequences", {
      doc_type: docType,
      sequence_key: key,
      year: yr,
      last_no: n2
    });
    return n2;
  }
  const n = Math.max(row.last_no, floor) + 1;
  await update(db, "purchase_number_sequences", row.id, row.row_version, {
    last_no: n
  });
  return n;
}
async function peekSequence(db, docType, key, yr, floor = 0) {
  const row = await one(db, "SELECT last_no FROM purchase_number_sequences WHERE doc_type=? AND sequence_key=? AND year=?", docType, key, yr);
  return Math.max(row?.last_no || 0, floor) + 1;
}
async function raiseSequence(db, docType, key, yr, n) {
  const row = await one(db, "SELECT * FROM purchase_number_sequences WHERE doc_type=? AND sequence_key=? AND year=?", docType, key, yr);
  if (!row) await insert(db, "purchase_number_sequences", {
    doc_type: docType,
    sequence_key: key,
    year: yr,
    last_no: n
  });
  else if (n > row.last_no) await update(db, "purchase_number_sequences", row.id, row.row_version, {
    last_no: n
  });
}
function numberFloor(settings, kind, yr) {
  return Number(settings.number_floor.year) === yr ? Number(settings.number_floor[kind]) || 0 : 0;
}
function unitCode(settings, request, unit) {
  return String(settings.unit_codes[request.org_unit_id] || unit?.code || "UMUM").toUpperCase();
}
async function freezeDocument(db, user, request, docType, objectId, number, snapshot) {
  await run(db, "UPDATE purchase_documents SET superseded_at=?,updated_at=?,row_version=row_version+1 WHERE object_id=? AND doc_type=? AND superseded_at IS NULL", now(), now(), objectId, docType);
  const json = canonicalJson(snapshot);
  return await insert(db, "purchase_documents", {
    request_id: request.id,
    doc_type: docType,
    object_id: objectId,
    number,
    snapshot_json: json,
    snapshot_hash: sha256(json),
    verification_code: randomBytes(10).toString("hex"),
    created_by: user.id
  });
}
async function setStatus(db, request, to, extra = {}) {
  assert(canTransition(request.status, to), `PR berstatus ${STATUS_LABELS[request.status]} tidak dapat menjadi ${STATUS_LABELS[to]}.`, 409);
  return await update(db, "purchase_requests", request.id, request.row_version, {
    status: to,
    ...extra
  });
}
async function addStep(db, user, request, stepKind, target, cycle, objectType = "REQUEST", objectId = request.id) {
  return await insert(db, "purchase_approval_steps", {
    request_id: request.id,
    object_type: objectType,
    object_id: objectId,
    cycle_no: cycle,
    step_kind: stepKind,
    target_kind: target ? "EMPLOYEE" : "VERIFIERS",
    target_employee_id: target?.id || null,
    target_label: target ? `${target.role}: ${target.full_name}` : "Verifikator Keuangan",
    status: "PENDING",
    as_delegate: 0,
    created_by: user.id
  });
}
async function supersedePending(db, requestId, objectId = null) {
  await run(db, `UPDATE purchase_approval_steps SET status='SUPERSEDED',acted_at=?,updated_at=?,row_version=row_version+1 WHERE request_id=? AND status='PENDING'${objectId ? " AND object_id=?" : ""}`, now(), now(), requestId, ...objectId ? [objectId] : []);
}
async function finalTarget(db, settings, request, kind, asOf) {
  let approver = await official(db, settings, kind, asOf);
  if (kind === "SEKBAN" && (approver.id === request.requester_employee_id || (await sekbanPeers(db, settings, approver.id, asOf)).includes(request.requester_employee_id))) {
    kind = "KABAN";
    approver = await official(db, settings, "KABAN", asOf);
  }
  assert(approver.id !== request.requester_employee_id, "Penyetuju untuk PR yang diajukan Kaban belum ditetapkan (keputusan terbuka di PRD).", 409);
  return {
    kind,
    target: {
      ...approver,
      role: kind === "SEKBAN" ? "Sekban" : "Kaban"
    }
  };
}
async function actingAs(db, acc, user, request, step, asOf) {
  assert(step.status === "PENDING", "Tahap ini sudah diputuskan. Muat ulang data.", 409);
  assert(user.employee_id, "Akun Anda belum tertaut ke data pegawai.", 403);
  assert(user.employee_id !== request.requester_employee_id, "Pemohon tidak boleh bertindak di tahap persetujuan PR-nya sendiri.", 403);
  if (acc.superadmin) return 0;
  if (step.target_kind === "VERIFIERS") {
    assert(acc.allows("purchasing.requests.verify", {
      org_unit_id: request.org_unit_id
    }), "Anda tidak berwenang memverifikasi PR ini.", 403);
    return 0;
  }
  if (step.target_employee_id === user.employee_id || acc.sekban_peers.includes(step.target_employee_id)) return 0;
  assert((await delegatorsOf(db, user.employee_id, asOf)).includes(step.target_employee_id), "Tahap ini menunggu penyetuju lain.", 403);
  return 1;
}
async function decide(db, user, me, step, status, reason, asDelegate) {
  return await update(db, "purchase_approval_steps", step.id, step.row_version, {
    status,
    actor_user_id: user.id,
    actor_employee_id: me.id,
    actor_name: me.full_name,
    actor_position: me.position_name || null,
    as_delegate: asDelegate,
    reason,
    acted_at: now()
  });
}
async function involvedIn(db, acc, user, request, asOf) {
  if (!user.employee_id) return false;
  const ids = [user.employee_id, ...acc.sekban_peers, ...await delegatorsOf(db, user.employee_id, asOf)];
  return Boolean(await one(db, `SELECT 1 hit FROM purchase_approval_steps WHERE request_id=? AND (actor_employee_id=? OR target_employee_id IN (${ids.map(() => "?").join(",")})) LIMIT 1`, request.id, user.employee_id, ...ids));
}
async function viewOf(db, acc, user, request, asOf) {
  const ctx = {
    employee_id: request.requester_employee_id,
    org_unit_id: request.org_unit_id
  };
  const staff = acc.allows("purchasing.procurement.manage", ctx) || acc.allows("purchasing.requests.verify", ctx);
  const reader = acc.broad("purchasing.requests.read") && acc.allows("purchasing.requests.read", ctx);
  const involved = staff || reader ? true : await involvedIn(db, acc, user, request, asOf);
  const own = Boolean(user.employee_id && request.requester_employee_id === user.employee_id);
  return {
    own,
    full: staff || reader || involved,
    staff,
    any: own || staff || reader || involved
  };
}
async function purchaseFileAllowed(db, user, link) {
  const request = await one(db, "SELECT * FROM purchase_requests WHERE id=?", link.request_id);
  if (!request) return false;
  const view = await viewOf(db, await purchasingAccess(db, user), user, request, today());
  return link.owner_type === "ITEM" ? view.any : view.full;
}
function linkUrl(value, label) {
  let url = text(value, `${label}: link`, 1e3);
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url.replace(/^\/+/, "")}`;
  assert(/^https?:\/\/[^\s/?#]+\.[^\s/?#]+(?:[/?#][^\s]*)?$/i.test(url), `${label}: link tidak valid. Contoh: www.shopee.co.id/nama-produk atau https://tokopedia.com/...`);
  return url;
}
function attachmentList(list, label, required) {
  const rows = list === void 0 || list === null ? [] : list;
  assert(Array.isArray(rows) && rows.length <= 10, `${label}: lampiran paling banyak 10.`);
  if (required) assert(rows.length > 0, required);
  return rows.map((a) => {
    const form = a?.form;
    assert(["LINK", "TEXT", "FILE"].includes(form), `${label}: jenis lampiran tidak valid.`);
    if (form === "LINK") {
      const url = linkUrl(a.url, label);
      return {
        form,
        url,
        note: optional(a.note, 500),
        file_id: null
      };
    }
    if (form === "TEXT") return {
      form,
      url: null,
      note: text(a.note, "Teks detail toko", 2e3),
      file_id: null
    };
    assert(typeof a.file_id === "string" && a.file_id, `${label}: berkas belum diunggah.`);
    return {
      form,
      url: null,
      note: optional(a.note, 500),
      file_id: a.file_id
    };
  });
}
async function saveAttachments(db, user, request, ownerType, ownerId, kind, list, reusable = /* @__PURE__ */ new Set()) {
  for (const a of list) {
    if (a.file_id && !reusable.has(a.file_id)) await claimFile(db, user, a.file_id);
    await insert(db, "purchase_attachments", {
      request_id: request.id,
      owner_type: ownerType,
      owner_id: ownerId,
      attachment_kind: kind,
      form: a.form,
      url: a.url,
      note: a.note,
      file_id: a.file_id,
      created_by: user.id
    });
  }
}
function parseItems(items, settings) {
  assert(Array.isArray(items) && items.length >= 1, "PR wajib berisi minimal satu item.");
  assert(items.length <= 100, "PR paling banyak berisi 100 item.");
  return items.map((it, i) => {
    const label = `Item ${i + 1}`;
    const quantity = rule(() => quantityMilli(it?.quantity, `${label}: jumlah`));
    const unitPrice = rule(() => money(it?.unit_price, `${label}: harga satuan`));
    const subtotal = rule(() => lineSubtotal(quantity, unitPrice));
    const required = attachmentRequired(subtotal, settings) ? `${label} wajib punya lampiran karena subtotalnya ${formatRupiah(settings.attachment_min_item_subtotal)} atau lebih.` : null;
    assert(["GOODS", "SERVICE"].includes(it?.item_kind), `${label}: pilih barang atau jasa.`);
    return {
      description: text(it?.description, `${label}: deskripsi`, 500),
      item_kind: it.item_kind,
      quantity_milli: quantity,
      unit: text(it?.unit, `${label}: satuan`, 40),
      unit_price: unitPrice,
      subtotal,
      reason: text(it?.reason, `${label}: alasan`, 1e3),
      attachments: attachmentList(it?.attachments, label, required)
    };
  });
}
async function saveItems(db, user, request, items, reusable) {
  await asyncForEach(items, async (it, i) => {
    const row = await insert(db, "purchase_request_items", {
      request_id: request.id,
      line_no: i + 1,
      description: it.description,
      item_kind: it.item_kind,
      quantity_milli: it.quantity_milli,
      unit: it.unit,
      unit_price: it.unit_price,
      subtotal: it.subtotal,
      approved_unit_price: it.unit_price,
      approved_subtotal: it.subtotal,
      reason: it.reason,
      status: "ACTIVE",
      created_by: user.id
    });
    await saveAttachments(db, user, request, "ITEM", row.id, "REFERENCE", it.attachments, reusable);
  });
}
async function requesterContext(db, user, acc, settings, asOf) {
  const missing = [];
  if (!acc.has("purchasing.requests.create")) missing.push("Izin mengajukan PR (role Pemohon Pengadaan).");
  if (!user.employee_id) return {
    me: null,
    missing: [...missing, "Akun belum tertaut ke data pegawai."],
    kaban: false
  };
  const me = await employeeOnDate(db, user.employee_id, asOf);
  if (!me || me.is_active !== 1) missing.push("Data pegawai tidak aktif.");
  else if (!me.position_id) missing.push("Penempatan utama aktif di data SDM.");
  const kaban = me ? await holdsKaban(db, settings, me.id, asOf) : false;
  if (me?.position_id && !me.supervisor_employee_id && !kaban) missing.push("Atasan di penempatan utama (data SDM).");
  if (me?.position_id && !acc.allows("purchasing.requests.create", {
    employee_id: me.id,
    org_unit_id: me.org_unit_id
  })) missing.push("Cakupan izin mengajukan PR untuk diri sendiri.");
  return {
    me,
    missing,
    kaban
  };
}
async function startApproval(db, user, request, settings, kaban, asOf) {
  const cycle = request.revision_no;
  if (kaban) {
    await insert(db, "purchase_approval_steps", {
      request_id: request.id,
      object_type: "REQUEST",
      object_id: request.id,
      cycle_no: cycle,
      step_kind: "ACKNOWLEDGE",
      target_kind: "EMPLOYEE",
      target_employee_id: request.requester_employee_id,
      target_label: "Atasan: dilewati (pemohon Kaban)",
      status: "SKIPPED",
      as_delegate: 0,
      reason: "Pemohon pemegang posisi Kaban; tahap Diketahui dilewati (ATR-PJ-12).",
      acted_at: now(),
      created_by: user.id
    });
  } else {
    const supervisor = await employeeOnDate(db, request.supervisor_employee_id, asOf);
    assert(supervisor && supervisor.is_active === 1, "Atasan Anda di data SDM tidak aktif. Hubungi SDM.", 422);
    await addStep(db, user, request, "ACKNOWLEDGE", {
      ...supervisor,
      role: "Atasan"
    }, cycle);
    return;
  }
  await addStep(db, user, request, "VERIFY", null, cycle);
}
async function budgetUsage(db, lineIds) {
  if (!lineIds.length) return {};
  const marks = lineIds.map(() => "?").join(",");
  const requests = await all(db, `SELECT id,budget_line_id,status,approved_total FROM purchase_requests WHERE budget_line_id IN (${marks}) AND status NOT IN ('rejected','cancelled')`, ...lineIds);
  const received = await all(db, `SELECT o.request_id,CAST(SUM(o.total) AS BIGINT) ordered,CAST(SUM(COALESCE(r.invoice_total,0)) AS BIGINT) invoiced FROM vendor_orders o JOIN order_receipts r ON r.order_id=o.id JOIN purchase_requests q ON q.id=o.request_id WHERE o.status='received' AND q.budget_line_id IN (${marks}) GROUP BY o.request_id`, ...lineIds);
  const usage = Object.fromEntries(lineIds.map((id) => [id, {
    commitment: 0,
    realization: 0
  }]));
  for (const r of requests) {
    const done = received.find((x) => x.request_id === r.id);
    if (done) usage[r.budget_line_id].realization += Number(done.invoiced);
    if (ACTIVE_COMMITMENT.includes(r.status)) usage[r.budget_line_id].commitment += Math.max(0, Number(r.approved_total || 0) - Number(done?.ordered || 0));
  }
  return usage;
}
async function budgetLines(db, yr) {
  const lines = await all(db, "SELECT l.*,y.year,u.name unit_name FROM budget_lines l JOIN budget_years y ON y.id=l.budget_year_id LEFT JOIN org_units u ON u.id=l.org_unit_id WHERE y.year=? ORDER BY l.code", yr);
  const usage = await budgetUsage(db, lines.map((l) => l.id));
  return lines.map((l) => ({
    ...l,
    ...usage[l.id],
    remaining: Number(l.ceiling) - usage[l.id].commitment - usage[l.id].realization
  }));
}
async function requestSnapshot(db, settings, request) {
  const items = await all(db, "SELECT * FROM purchase_request_items WHERE request_id=? AND status='ACTIVE' ORDER BY line_no", request.id);
  const steps = await all(db, "SELECT step_kind,status,actor_name,actor_position,as_delegate,target_label,acted_at,reason FROM purchase_approval_steps WHERE request_id=? AND object_type='REQUEST' AND status IN ('APPROVED','SKIPPED') AND cycle_no=? ORDER BY created_at,id", request.id, request.revision_no);
  const later = await all(db, "SELECT step_kind,status,actor_name,actor_position,as_delegate,target_label,acted_at,reason FROM purchase_approval_steps WHERE request_id=? AND object_type='REQUEST' AND status='APPROVED' AND step_kind IN ('REVERIFY','REAPPROVE') ORDER BY created_at,id", request.id);
  const line = request.budget_line_id ? await one(db, "SELECT code,name FROM budget_lines WHERE id=?", request.budget_line_id) : null;
  return {
    organization: settings.organization,
    request_code: request.request_code,
    pr_number: request.pr_number,
    request_date: request.request_date,
    needed_on: request.needed_on,
    requester: {
      name: request.requester_name,
      employee_no: request.requester_no,
      position: request.position_name,
      unit: request.unit_name
    },
    budget_line: line ? `${line.code} \u2014 ${line.name}` : null,
    special_budget: Boolean(request.special_budget),
    final_approver: request.final_approver_kind,
    items: items.map((i) => ({
      line_no: i.line_no,
      description: i.description,
      kind: i.item_kind,
      quantity: formatQuantity(i.quantity_milli),
      unit: i.unit,
      unit_price: Number(i.approved_unit_price),
      subtotal: Number(i.approved_subtotal),
      reason: i.reason
    })),
    total: Number(request.approved_total ?? request.estimated_total),
    total_words: terbilang(Number(request.approved_total ?? request.estimated_total)),
    approvals: [...steps, ...later].map((s) => ({
      stage: STEP_LABELS[s.step_kind],
      status: s.status,
      name: s.actor_name,
      position: s.actor_position,
      plh: Boolean(s.as_delegate),
      on_behalf: s.as_delegate ? s.target_label : null,
      at: s.acted_at,
      note: s.status === "SKIPPED" ? s.reason : null
    }))
  };
}
async function orderSnapshot(db, settings, request, order, doc, approvedAt) {
  const vendor = order.vendor_id ? await one(db, "SELECT * FROM vendors WHERE id=?", order.vendor_id) : null;
  const items = await all(db, "SELECT oi.*,i.description,i.item_kind,i.reason FROM vendor_order_items oi JOIN purchase_request_items i ON i.id=oi.request_item_id WHERE oi.order_id=? ORDER BY i.line_no", order.id);
  return {
    organization: settings.organization,
    kind: doc.doc_kind,
    number: doc.number,
    date: doc.doc_date,
    request_code: request.request_code,
    pr_number: request.pr_number,
    vendor: vendor ? {
      name: vendor.name,
      address: vendor.address,
      phone: vendor.phone,
      contact: vendor.contact_name || vendor.leader_name,
      leader_name: vendor.leader_name,
      leader_title: vendor.leader_title,
      leader_nik: doc.doc_kind === "SPK" ? vendor.leader_nik : null,
      bank: vendor.bank_name,
      branch: vendor.bank_branch,
      account_no: vendor.account_no,
      account_name: vendor.account_name
    } : null,
    work_description: doc.work_description,
    work_duration_days: doc.work_duration_days,
    payment_terms: doc.payment_terms,
    billing_text: doc.billing_text,
    items: items.map((i) => ({
      description: i.description,
      quantity: formatQuantity(i.quantity_milli),
      unit: i.unit,
      calc_volume: i.calc_volume_milli ? formatQuantity(i.calc_volume_milli) : null,
      calc_unit: i.calc_unit,
      unit_price: Number(i.unit_price),
      subtotal: Number(i.subtotal),
      needed_on: i.needed_on,
      note: i.reason
    })),
    total: Number(order.total),
    total_words: terbilang(Number(order.total)),
    signer: {
      name: doc.signer_name,
      position: doc.signer_position,
      approved_at: approvedAt
    }
  };
}
async function loadRequest(db, id) {
  return await get(db, "purchase_requests", id);
}
function assertStaff(acc, request, message = "Hanya Purchasing yang dapat melakukan tindakan ini.") {
  assert(acc.allows("purchasing.procurement.manage", {
    org_unit_id: request.org_unit_id
  }), message, 403);
}
async function openOrderItems(db, requestId) {
  return await all(db, "SELECT oi.request_item_id,o.id order_id,o.status FROM vendor_order_items oi JOIN vendor_orders o ON o.id=oi.order_id WHERE o.request_id=? AND o.status<>'cancelled'", requestId);
}
async function completeIfDone(db, request) {
  const fresh2 = await loadRequest(db, request.id);
  if (fresh2.status !== "in_procurement") return fresh2;
  const orders = await all(db, "SELECT id,status FROM vendor_orders WHERE request_id=? AND status<>'cancelled'", fresh2.id);
  const active = await all(db, "SELECT id FROM purchase_request_items WHERE request_id=? AND status='ACTIVE'", fresh2.id);
  const covered = new Set((await openOrderItems(db, fresh2.id)).map((r) => r.request_item_id));
  if (orders.length && orders.every((o) => o.status === "received") && active.every((i) => covered.has(i.id))) return await setStatus(db, fresh2, "completed", {
    completed_at: now()
  });
  return fresh2;
}
async function createOrder(db, user, request, path, vendor, storeName, lines, docKind) {
  const total = rule(() => sum(lines.map((l) => l.subtotal)));
  const order = await insert(db, "vendor_orders", {
    request_id: request.id,
    vendor_id: vendor?.id || null,
    store_name: storeName,
    path,
    document_kind: docKind,
    status: path === "A" ? "ordered" : "draft",
    total,
    due_on: path === "A" ? request.needed_on : null,
    created_by: user.id
  });
  for (const l of lines) await insert(db, "vendor_order_items", {
    order_id: order.id,
    request_item_id: l.item.id,
    quantity_milli: l.item.quantity_milli,
    unit: l.item.unit,
    unit_price: l.unit_price,
    subtotal: l.subtotal,
    needed_on: request.needed_on,
    created_by: user.id
  });
  return order;
}
function pricedLines(items, prices) {
  const over = [];
  const lines = items.map((item) => {
    const unitPrice = rule(() => money(prices[item.id], `Harga item ${item.line_no}`));
    const subtotal = rule(() => lineSubtotal(item.quantity_milli, unitPrice));
    if (subtotal > Number(item.approved_subtotal)) over.push(item.line_no);
    return {
      item,
      unit_price: unitPrice,
      subtotal
    };
  });
  assert(!over.length, `Harga item ${over.join(", ")} lebih tinggi dari yang disetujui. Ajukan konfirmasi ulang ke pemohon terlebih dahulu (ATR-PG-09).`, 409);
  return lines;
}
function orderDocumentValues(b, settings, kind) {
  const d = b && typeof b === "object" ? b : {};
  const docKind = d.doc_kind === void 0 ? kind : d.doc_kind;
  assert(["PO", "SPK"].includes(docKind), "Jenis dokumen harus PO atau SPK.");
  const duration = d.work_duration_days === void 0 || d.work_duration_days === null || d.work_duration_days === "" ? null : Number(d.work_duration_days);
  assert(duration === null || Number.isInteger(duration) && duration > 0 && duration <= 3650, "Lama pengerjaan harus 1\u20133650 hari.");
  return {
    doc_kind: docKind,
    work_description: optional(d.work_description, 1e3),
    work_duration_days: duration,
    payment_terms: optional(d.payment_terms, 500) || settings.texts.payment_terms,
    billing_text: optional(d.billing_text, 3e3) || settings.texts.billing_text
  };
}
async function submitOrder(db, user, settings, request, order, b) {
  assert(order.status === "draft" && order.path !== "A", "Pesanan ini tidak dapat diajukan.", 409);
  const doc = await one(db, "SELECT * FROM vendor_order_documents WHERE order_id=?", order.id);
  assert(doc, "Lengkapi isi PO/SPK terlebih dahulu.");
  if (doc.doc_kind === "SPK") assert(doc.work_description && doc.work_duration_days, "SPK wajib berisi uraian pekerjaan dan lama pengerjaan.");
  const asOf = today();
  if (order.path === "C") {
    const reason = text(b?.reason, "Alasan tanpa pembanding", 2e3);
    const evidence = attachmentList(b?.evidence, "Bukti harga vendor", "Bukti harga dari vendor wajib dilampirkan (ATR-PG-06).");
    const appointment = await insert(db, "vendor_appointments", {
      order_id: order.id,
      reason,
      status: "PENDING",
      created_by: user.id
    });
    await saveAttachments(db, user, request, "APPOINTMENT", appointment.id, "PRICE_EVIDENCE", evidence);
    const { target: target2 } = await finalTarget(db, settings, request, "KABAN", asOf);
    await addStep(db, user, request, "APPOINTMENT", target2, request.revision_no, "APPOINTMENT", appointment.id);
    return await update(db, "vendor_orders", order.id, order.row_version, {
      status: "pending_appointment_approval"
    });
  }
  const { target } = await finalTarget(db, settings, request, request.final_approver_kind || "KABAN", asOf);
  await addStep(db, user, request, "ORDER", target, request.revision_no, "ORDER", order.id);
  return await update(db, "vendor_orders", order.id, order.row_version, {
    status: "pending_order_approval"
  });
}
async function issueOrderDocument(db, user, settings, request, order, step, approvedBy) {
  const doc = await one(db, "SELECT * FROM vendor_order_documents WHERE order_id=?", order.id);
  const issued = today(), yr = year(issued);
  const number = documentNumber(doc.doc_kind, await nextSequence(db, doc.doc_kind, "PURCHASE", yr, numberFloor(settings, doc.doc_kind, yr)), issued);
  const target = await isSuperAdmin(db, user) || (await sekbanPeers(db, settings, approvedBy.id, issued)).includes(step.target_employee_id) ? approvedBy : await employeeOnDate(db, step.target_employee_id, issued);
  const saved = await update(db, "vendor_order_documents", doc.id, doc.row_version, {
    number,
    doc_date: issued,
    signer_employee_id: target?.id || step.target_employee_id,
    signer_name: target?.full_name || approvedBy.full_name,
    signer_position: target?.position_name || approvedBy.position_name || null
  });
  const items = await all(db, "SELECT needed_on FROM vendor_order_items WHERE order_id=? ORDER BY needed_on", order.id);
  const due = saved.doc_kind === "SPK" && saved.work_duration_days ? addDays(issued, saved.work_duration_days) : items[0]?.needed_on || request.needed_on;
  const fresh2 = await update(db, "vendor_orders", order.id, order.row_version, {
    status: "ordered",
    due_on: due
  });
  await freezeDocument(db, user, request, saved.doc_kind, order.id, number, await orderSnapshot(db, settings, request, fresh2, saved, now()));
  return fresh2;
}
function requestRow(r) {
  return {
    ...r,
    estimated_total: Number(r.estimated_total),
    approved_total: r.approved_total === null ? null : Number(r.approved_total),
    status_label: STATUS_LABELS[r.status]
  };
}
async function listRequests(db, acc, user, view, url) {
  const asOf = today(), status = url.searchParams.get("status") || "", yr = Number(url.searchParams.get("year")) || null;
  let rows, waiting = /* @__PURE__ */ new Map();
  if (view === "mine") {
    assert(user.employee_id, "Akun belum tertaut ke data pegawai.", 403);
    rows = await all(db, "SELECT * FROM purchase_requests WHERE requester_employee_id=? ORDER BY created_at DESC", user.employee_id);
  } else if (view === "approvals") {
    const steps = await pendingSteps(db, acc, user, asOf);
    for (const s of steps) if (!waiting.has(s.request_id)) waiting.set(s.request_id, s);
    const ids2 = [...waiting.keys()];
    rows = ids2.length ? await all(db, `SELECT * FROM purchase_requests WHERE id IN (${ids2.map(() => "?").join(",")})`, ...ids2) : [];
  } else if (view === "procurement") {
    assert(acc.has("purchasing.procurement.manage"), "Hanya Purchasing yang dapat membuka antrean ini.", 403);
    rows = (await all(db, "SELECT * FROM purchase_requests WHERE status IN ('pending_completeness_check','in_procurement','pending_requester_confirmation','pending_reverification','pending_reapproval') ORDER BY updated_at")).filter((r) => acc.allows("purchasing.procurement.manage", {
      org_unit_id: r.org_unit_id
    }));
  } else {
    const readable = ["purchasing.requests.read", "purchasing.requests.verify", "purchasing.procurement.manage"];
    assert(readable.some((code) => acc.broad(code)), "Anda tidak memiliki akses ke daftar PR.", 403);
    rows = (await all(db, "SELECT * FROM purchase_requests ORDER BY created_at DESC")).filter((r) => readable.some((code) => acc.allows(code, {
      org_unit_id: r.org_unit_id,
      employee_id: r.requester_employee_id
    })));
  }
  rows = rows.filter((r) => (!status || r.status === status) && (!yr || year(r.request_date) === yr));
  const ids = rows.map((r) => r.id);
  const orders = ids.length ? await all(db, `SELECT request_id,status,due_on FROM vendor_orders WHERE request_id IN (${ids.map(() => "?").join(",")}) AND status<>'cancelled'`, ...ids) : [];
  const counts = ids.length ? await all(db, `SELECT request_id,count(*) n FROM purchase_request_items WHERE status='ACTIVE' AND request_id IN (${ids.map(() => "?").join(",")}) GROUP BY request_id`, ...ids) : [];
  const items = rows.map((r) => {
    const step = waiting.get(r.id);
    return {
      ...requestRow(r),
      item_count: Number(counts.find((c) => c.request_id === r.id)?.n || 0),
      late: orders.some((o) => o.request_id === r.id && isLate(o, asOf)),
      waiting_step: step ? {
        id: step.id,
        kind: step.step_kind,
        label: STEP_LABELS[step.step_kind],
        since: step.created_at,
        object_type: step.object_type,
        object_id: step.object_id
      } : null
    };
  });
  if (view === "approvals") items.sort((a, b) => a.waiting_step.since.localeCompare(b.waiting_step.since));
  return {
    items
  };
}
async function pendingSteps(db, acc, user, asOf) {
  const ids = user.employee_id ? [user.employee_id, ...acc.sekban_peers, ...await delegatorsOf(db, user.employee_id, asOf)] : [];
  const mine = acc.superadmin ? await all(db, "SELECT s.*,r.requester_employee_id FROM purchase_approval_steps s JOIN purchase_requests r ON r.id=s.request_id WHERE s.status='PENDING' ORDER BY s.created_at") : ids.length ? await all(db, `SELECT s.*,r.requester_employee_id FROM purchase_approval_steps s JOIN purchase_requests r ON r.id=s.request_id WHERE s.status='PENDING' AND s.target_kind='EMPLOYEE' AND s.target_employee_id IN (${ids.map(() => "?").join(",")}) ORDER BY s.created_at`, ...ids) : [];
  const verify = !acc.superadmin && acc.has("purchasing.requests.verify") ? (await all(db, "SELECT s.*,r.requester_employee_id,r.org_unit_id FROM purchase_approval_steps s JOIN purchase_requests r ON r.id=s.request_id WHERE s.status='PENDING' AND s.target_kind='VERIFIERS' ORDER BY s.created_at")).filter((s) => acc.allows("purchasing.requests.verify", {
    org_unit_id: s.org_unit_id
  })) : [];
  return [...mine, ...verify].filter((s) => s.requester_employee_id !== user.employee_id);
}
async function requestDetail(db, acc, user, settings, request) {
  const asOf = today(), view = await viewOf(db, acc, user, request, asOf);
  assert(view.any, "Anda tidak memiliki akses ke PR ini.", 403);
  const items = await all(db, "SELECT * FROM purchase_request_items WHERE request_id=? ORDER BY line_no", request.id);
  const attachments2 = await all(db, "SELECT a.*,f.original_name,f.mime_type,f.size_bytes FROM purchase_attachments a LEFT JOIN files f ON f.id=a.file_id WHERE a.request_id=? ORDER BY a.created_at,a.id", request.id);
  const steps = await all(db, "SELECT * FROM purchase_approval_steps WHERE request_id=? ORDER BY created_at,id", request.id);
  const confirmations = await all(db, "SELECT * FROM purchase_price_confirmations WHERE request_id=? ORDER BY round_no,created_at", request.id);
  const documents = await all(db, "SELECT id,doc_type,object_id,number,snapshot_hash,verification_code,superseded_at,created_at FROM purchase_documents WHERE request_id=? ORDER BY created_at", request.id);
  const sensitive = acc.allows("purchasing.vendors.sensitive", {
    org_unit_id: request.org_unit_id
  });
  let quotes = [], orders = [];
  if (view.full) {
    quotes = await all(db, "SELECT * FROM purchase_price_quotes WHERE request_id=? ORDER BY item_id,unit_price,created_at", request.id);
    const orderRows = await all(db, "SELECT o.*,v.name vendor_name,v.address vendor_address,v.phone vendor_phone,v.leader_name vendor_leader,v.account_no,v.account_name,v.bank_name,v.leader_nik FROM vendor_orders o LEFT JOIN vendors v ON v.id=o.vendor_id WHERE o.request_id=? ORDER BY o.created_at", request.id);
    const orderItems = await all(db, "SELECT oi.*,i.line_no,i.description FROM vendor_order_items oi JOIN vendor_orders o ON o.id=oi.order_id JOIN purchase_request_items i ON i.id=oi.request_item_id WHERE o.request_id=? ORDER BY i.line_no", request.id);
    const docs = await all(db, "SELECT d.* FROM vendor_order_documents d JOIN vendor_orders o ON o.id=d.order_id WHERE o.request_id=?", request.id);
    const appointments = await all(db, "SELECT a.* FROM vendor_appointments a JOIN vendor_orders o ON o.id=a.order_id WHERE o.request_id=? ORDER BY a.created_at", request.id);
    const receipts = await all(db, "SELECT r.* FROM order_receipts r JOIN vendor_orders o ON o.id=r.order_id WHERE o.request_id=?", request.id);
    orders = orderRows.map((o) => ({
      id: o.id,
      path: o.path,
      document_kind: o.document_kind,
      status: o.status,
      store_name: o.store_name,
      vendor_id: o.vendor_id,
      total: Number(o.total),
      due_on: o.due_on,
      late: isLate(o, asOf),
      cancelled_reason: o.cancelled_reason,
      row_version: o.row_version,
      vendor: o.vendor_id ? {
        name: o.vendor_name,
        address: o.vendor_address,
        phone: o.vendor_phone,
        leader_name: o.vendor_leader,
        ...sensitive ? {
          bank_name: o.bank_name,
          account_no: o.account_no,
          account_name: o.account_name,
          leader_nik: o.leader_nik
        } : {}
      } : null,
      items: orderItems.filter((i) => i.order_id === o.id).map((i) => ({
        ...i,
        unit_price: Number(i.unit_price),
        subtotal: Number(i.subtotal),
        purchase_unit_price: i.purchase_unit_price === null ? null : Number(i.purchase_unit_price)
      })),
      document: docs.find((d) => d.order_id === o.id) || null,
      appointments: appointments.filter((a) => a.order_id === o.id),
      receipt: receipts.find((r) => r.order_id === o.id) || null,
      attachments: attachments2.filter((a) => a.owner_type === "ORDER" && a.owner_id === o.id)
    }));
  } else {
    orders = (await all(db, "SELECT id,status,due_on FROM vendor_orders WHERE request_id=? AND status<>'cancelled' ORDER BY created_at", request.id)).map((o) => ({
      id: o.id,
      status: o.status,
      due_on: o.due_on,
      late: isLate(o, asOf)
    }));
  }
  const pending = steps.filter((s) => s.status === "PENDING");
  const delegators = user.employee_id ? await delegatorsOf(db, user.employee_id, asOf) : [];
  const myStep = pending.find((s) => {
    if (!user.employee_id || user.employee_id === request.requester_employee_id) return false;
    if (acc.superadmin) return true;
    if (s.target_kind === "VERIFIERS") return acc.allows("purchasing.requests.verify", {
      org_unit_id: request.org_unit_id
    });
    return s.target_employee_id === user.employee_id || acc.sekban_peers.includes(s.target_employee_id) || delegators.includes(s.target_employee_id);
  });
  const staff = acc.allows("purchasing.procurement.manage", {
    org_unit_id: request.org_unit_id
  });
  const covered = new Set(orders.filter((o) => o.status !== "cancelled" && o.items).flatMap((o) => o.items.map((i) => i.request_item_id)));
  const total = Number(request.approved_total ?? request.estimated_total);
  let suggestion = null;
  if (staff && request.status === "pending_completeness_check") {
    const unit = await one(db, "SELECT code FROM org_units WHERE id=?", request.org_unit_id), key = unitCode(settings, request, unit), yr = year(asOf);
    suggestion = documentNumber("PR", await peekSequence(db, "PR", key, yr), asOf, key);
  }
  return {
    ...requestRow(request),
    view: view.full ? "full" : "requester",
    items: items.map((i) => ({
      ...i,
      unit_price: Number(i.unit_price),
      subtotal: Number(i.subtotal),
      approved_unit_price: Number(i.approved_unit_price),
      approved_subtotal: Number(i.approved_subtotal),
      quantity: formatQuantity(i.quantity_milli),
      ordered: covered.has(i.id),
      attachments: attachments2.filter((a) => a.owner_type === "ITEM" && a.owner_id === i.id),
      quotes: quotes.filter((q) => q.item_id === i.id).map((q) => ({
        ...q,
        unit_price: Number(q.unit_price),
        attachments: attachments2.filter((a) => a.owner_type === "QUOTE" && a.owner_id === q.id)
      }))
    })),
    steps: steps.map((s) => ({
      ...s,
      label: STEP_LABELS[s.step_kind]
    })),
    confirmations: confirmations.map((c) => ({
      ...c,
      old_unit_price: Number(c.old_unit_price),
      new_unit_price: Number(c.new_unit_price),
      old_subtotal: Number(c.old_subtotal),
      new_subtotal: Number(c.new_subtotal)
    })),
    orders,
    documents,
    budget_line: request.budget_line_id ? (await budgetLines(db, year(request.request_date))).find((l) => l.id === request.budget_line_id) || null : null,
    allowed_paths: allowedPaths(total, settings),
    suggested_pr_number: suggestion,
    actions: {
      step: myStep ? {
        id: myStep.id,
        kind: myStep.step_kind,
        label: STEP_LABELS[myStep.step_kind],
        object_type: myStep.object_type,
        object_id: myStep.object_id,
        as_delegate: !acc.superadmin && myStep.target_kind === "EMPLOYEE" && myStep.target_employee_id !== user.employee_id && !acc.sekban_peers.includes(myStep.target_employee_id)
      } : null,
      revise: view.own && request.status === "returned",
      cancel: view.own && CANCELLABLE.includes(request.status) && !request.pr_number,
      answer: view.own && request.status === "pending_requester_confirmation",
      completeness: staff && request.status === "pending_completeness_check",
      procure: staff && request.status === "in_procurement",
      reassign: acc.has("purchasing.settings.manage") && pending.some((s) => s.target_kind === "EMPLOYEE"),
      verify_budget: acc.allows("purchasing.requests.verify", {
        org_unit_id: request.org_unit_id
      })
    }
  };
}
function vendorRow(v, sensitive) {
  const base = {
    id: v.id,
    name: v.name,
    leader_name: v.leader_name,
    leader_title: v.leader_title,
    contact_name: v.contact_name,
    address: v.address,
    phone: v.phone,
    notes: v.notes,
    is_active: v.is_active,
    row_version: v.row_version
  };
  return {
    ...base,
    bank_name: v.bank_name,
    bank_branch: v.bank_branch,
    account_name: v.account_name,
    leader_nik: sensitive ? v.leader_nik : mask(v.leader_nik),
    account_no: sensitive ? v.account_no : mask(v.account_no)
  };
}
async function vendorValues(b, old, sensitive) {
  const pick2 = (key, max) => b[key] === void 0 ? old?.[key] ?? null : optional(b[key], max);
  const nik = sensitive ? await pick2("leader_nik", 32) : old?.leader_nik ?? null, account = sensitive ? await pick2("account_no", 40) : old?.account_no ?? null;
  assert(!nik || /^\d{16}$/.test(nik), "NIK pimpinan harus 16 digit angka.");
  assert(!account || /^[0-9 .-]{4,40}$/.test(account), "Nomor rekening hanya boleh angka, spasi, titik, atau tanda hubung.");
  return {
    name: text(b.name === void 0 ? old?.name : b.name, "Nama vendor", 200),
    leader_name: await pick2("leader_name", 200),
    leader_title: await pick2("leader_title", 120),
    leader_nik: nik,
    contact_name: await pick2("contact_name", 200),
    address: await pick2("address", 500),
    phone: await pick2("phone", 40),
    bank_name: await pick2("bank_name", 120),
    bank_branch: await pick2("bank_branch", 120),
    account_no: account,
    account_name: await pick2("account_name", 200),
    notes: await pick2("notes", 1e3),
    is_active: b.is_active === void 0 ? old?.is_active ?? 1 : flag(b.is_active)
  };
}
async function settingsValues(db, b, current) {
  const s = b && typeof b === "object" ? b : {};
  const amount = (key, label) => s[key] === void 0 ? current[key] : rule(() => money(s[key], label));
  const next = mergeSettings({
    ...current,
    ...s,
    sekban_max_total: amount("sekban_max_total", "Batas penyetuju Sekban"),
    attachment_min_item_subtotal: amount("attachment_min_item_subtotal", "Batas lampiran wajib"),
    comparison_min_total: amount("comparison_min_total", "Batas perbandingan harga"),
    officials: {
      ...current.officials,
      ...s.officials || {}
    },
    number_floor: {
      ...current.number_floor,
      ...s.number_floor || {}
    },
    organization: {
      ...current.organization,
      ...s.organization || {}
    },
    texts: {
      ...current.texts,
      ...s.texts || {}
    },
    unit_codes: s.unit_codes === void 0 ? current.unit_codes : s.unit_codes
  });
  const quotes = Number(next.min_quotes_per_item);
  assert(Number.isInteger(quotes) && quotes >= 2 && quotes <= 5, "Jumlah harga pembanding minimal 2\u20135.");
  for (const key of ["sekban_position_id", "sekban_deputy_position_id", "kaban_position_id"]) if (next.officials[key]) await pick(db, "positions", next.officials[key], "Posisi pejabat");
  assert(!next.officials.sekban_position_id || next.officials.sekban_position_id !== next.officials.kaban_position_id, "Posisi Sekban dan Kaban harus berbeda.");
  if (next.officials.sekban_deputy_position_id) {
    const ids = [next.officials.sekban_position_id, next.officials.sekban_deputy_position_id, next.officials.kaban_position_id];
    assert(ids.every(Boolean) && new Set(ids).size === 3, "Posisi Sekban, Wakil Sekban, dan Kaban harus diisi dan berbeda.");
    const holders = await asyncMap(ids, async (id) => await positionHolders(db, id, today()));
    assert(holders.every((rows) => rows.length === 1) && new Set(holders.map((rows) => rows[0].id)).size === 3, "Sekban, Wakil Sekban, dan Kaban harus mempunyai pemegang aktif yang berbeda dan tunggal.", 409);
  }
  const floorYear = next.number_floor.year === null || next.number_floor.year === "" ? null : Number(next.number_floor.year);
  assert(floorYear === null || Number.isInteger(floorYear) && floorYear >= 2e3 && floorYear <= 2100, "Tahun nomor awal tidak valid.");
  const floor = {
    year: floorYear
  };
  for (const kind of ["PO", "SPK", "SPV"]) {
    const n = Number(next.number_floor[kind] || 0);
    assert(Number.isInteger(n) && n >= 0 && n < 1e5, `Nomor terakhir ${kind} tidak valid.`);
    floor[kind] = n;
  }
  assert(next.unit_codes && typeof next.unit_codes === "object" && !Array.isArray(next.unit_codes), "Kode unit tidak valid.");
  const codes = {};
  for (const [unitId, code] of Object.entries(next.unit_codes)) {
    if (!code) continue;
    assert(/^[A-Za-z0-9_-]{1,20}$/.test(String(code)), "Kode unit untuk nomor PR hanya huruf, angka, garis bawah, atau tanda hubung (maks. 20).");
    await pick(db, "org_units", unitId, "Unit");
    codes[unitId] = String(code).toUpperCase();
  }
  const organization = {
    name: text(next.organization.name, "Nama badan", 300),
    short_name: optional(next.organization.short_name, 100) || "",
    address: optional(next.organization.address, 500) || "",
    city: optional(next.organization.city, 100) || ""
  };
  const texts = {
    payment_terms: text(next.texts.payment_terms, "Termin pembayaran", 500),
    billing_text: text(next.texts.billing_text, "Teks dokumen penagihan", 3e3)
  };
  return {
    sekban_max_total: next.sekban_max_total,
    attachment_min_item_subtotal: next.attachment_min_item_subtotal,
    comparison_min_total: next.comparison_min_total,
    min_quotes_per_item: quotes,
    officials: {
      sekban_position_id: next.officials.sekban_position_id || null,
      sekban_deputy_position_id: next.officials.sekban_deputy_position_id || null,
      kaban_position_id: next.officials.kaban_position_id || null
    },
    unit_codes: codes,
    number_floor: floor,
    organization,
    texts
  };
}
async function reportRows(db, acc, yr) {
  const rows = (await all(db, "SELECT * FROM purchase_requests ORDER BY created_at")).filter((r) => year(r.request_date) === yr && acc.allows("purchasing.reports.read", {
    org_unit_id: r.org_unit_id,
    employee_id: r.requester_employee_id
  }));
  return rows;
}
async function purchasingRoutes(c) {
  const { db, user, p, method: m, body: b, url } = c;
  if (p[0] !== "purchasing") return void 0;
  const settings = await purchasingSettings(db), acc = await purchasingAccess(db, user, settings), asOf = today();
  const section = p[1], id = p[2], action = p[3];
  if (section === "overview" && m === "GET") {
    const ctx = await requesterContext(db, user, acc, settings, asOf);
    const mine = user.employee_id ? await all(db, "SELECT status FROM purchase_requests WHERE requester_employee_id=? AND status IN ('returned','pending_requester_confirmation')", user.employee_id) : [];
    const approvals = await pendingSteps(db, acc, user, asOf);
    const queue = acc.has("purchasing.procurement.manage") ? (await all(db, "SELECT status,org_unit_id FROM purchase_requests WHERE status IN ('pending_completeness_check','in_procurement')")).filter((r) => acc.allows("purchasing.procurement.manage", {
      org_unit_id: r.org_unit_id
    })) : [];
    const supervisor = ctx.me?.supervisor_employee_id ? await one(db, "SELECT full_name FROM employees WHERE id=?", ctx.me.supervisor_employee_id) : null;
    return {
      me: ctx.me ? {
        employee_id: ctx.me.id,
        name: ctx.me.full_name,
        employee_no: ctx.me.employee_no,
        position: ctx.me.position_name,
        unit: ctx.me.unit_name,
        supervisor: supervisor?.full_name || (ctx.kaban ? "Tidak ada (pemohon Kaban)" : null)
      } : null,
      can_submit: !ctx.missing.length,
      missing: ctx.missing,
      counts: {
        my_action: mine.length,
        approvals: approvals.length,
        completeness: queue.filter((r) => r.status === "pending_completeness_check").length,
        procurement: queue.filter((r) => r.status === "in_procurement").length
      },
      rules: {
        sekban_max_total: settings.sekban_max_total,
        attachment_min_item_subtotal: settings.attachment_min_item_subtotal,
        comparison_min_total: settings.comparison_min_total,
        min_quotes_per_item: settings.min_quotes_per_item
      },
      capabilities: {
        submit: acc.has("purchasing.requests.create"),
        read_all: ["purchasing.requests.read", "purchasing.requests.verify", "purchasing.procurement.manage"].some((code) => acc.broad(code)),
        verify: acc.has("purchasing.requests.verify"),
        procurement: acc.has("purchasing.procurement.manage"),
        vendors: acc.has("purchasing.vendors.read"),
        vendors_manage: acc.has("purchasing.vendors.manage"),
        budget: acc.has("purchasing.budget.read"),
        budget_manage: acc.has("purchasing.budget.manage"),
        reports: acc.has("purchasing.reports.read"),
        export: acc.has("purchasing.reports.export"),
        settings: acc.has("purchasing.settings.manage")
      }
    };
  }
  if (section === "lookups" && m === "GET") {
    const staff = acc.has("purchasing.procurement.manage"), admin = acc.has("purchasing.settings.manage"), finance = acc.has("purchasing.requests.verify") || acc.has("purchasing.budget.read");
    assert(staff || admin || finance || acc.has("purchasing.vendors.read"), "Akses pilihan data ditolak.", 403);
    const yr = Number(url.searchParams.get("year")) || year(asOf);
    return {
      vendors: staff || acc.has("purchasing.vendors.read") ? await all(db, "SELECT id,name,address,phone FROM vendors WHERE is_active=1 ORDER BY name") : [],
      budget_lines: staff || finance ? (await budgetLines(db, yr)).filter((l) => l.is_active) : [],
      employees: staff || admin ? await all(db, "SELECT id,full_name,employee_no FROM employees WHERE is_active=1 ORDER BY full_name") : [],
      positions: admin ? await all(db, "SELECT p.id,p.name,u.name unit_name FROM positions p JOIN org_units u ON u.id=p.org_unit_id WHERE p.is_active=1 ORDER BY p.name") : [],
      units: admin || finance ? await all(db, "SELECT id,code,name FROM org_units WHERE is_active=1 ORDER BY name") : []
    };
  }
  if (section === "requests") {
    if (!id && m === "GET") return await listRequests(db, acc, user, url.searchParams.get("view") || "mine", url);
    if (!id && m === "POST") return await tx(db, async () => {
      const ctx = await requesterContext(db, user, acc, settings, asOf);
      assert(!ctx.missing.length, `PR belum dapat dikirim. Lengkapi: ${ctx.missing.join(" ")}`, ctx.missing.some((x) => x.startsWith("Izin")) ? 403 : 422);
      const neededOn = date(b.needed_on, "Tanggal barang dibutuhkan");
      assert(neededOn >= asOf, "Tanggal barang dibutuhkan tidak boleh sebelum hari ini.");
      const items = parseItems(b.items, settings), total = rule(() => sum(items.map((i) => i.subtotal)));
      const me = ctx.me, code = requestCode(year(asOf), await nextSequence(db, "PJ", "ALL", year(asOf)));
      const request2 = await insert(db, "purchase_requests", {
        request_code: code,
        requester_employee_id: me.id,
        submitted_by: user.id,
        org_unit_id: me.org_unit_id,
        requester_name: me.full_name,
        requester_no: me.employee_no,
        position_name: me.position_name,
        unit_name: me.unit_name,
        supervisor_employee_id: ctx.kaban ? null : me.supervisor_employee_id,
        request_date: asOf,
        needed_on: neededOn,
        special_budget: 0,
        status: ctx.kaban ? "pending_verification" : "pending_acknowledgement",
        estimated_total: total,
        revision_no: 1,
        confirmation_round: 0,
        created_by: user.id
      });
      await saveItems(db, user, request2, items);
      await startApproval(db, user, request2, settings, ctx.kaban, asOf);
      await audit(db, user, "SUBMIT", "purchase_requests", request2.id, {
        request_code: code,
        total,
        items: items.length
      });
      return await requestDetail(db, acc, user, settings, await loadRequest(db, request2.id));
    });
    if (!id) return void 0;
    const request = await loadRequest(db, id);
    if (!action && m === "GET") return await requestDetail(db, acc, user, settings, request);
    if (!action && m === "PATCH") return await tx(db, async () => {
      assert(user.employee_id === request.requester_employee_id, "Hanya pemohon yang dapat merevisi PR ini.", 403);
      assert(request.status === "returned", "Hanya PR yang dikembalikan yang dapat direvisi.", 409);
      assert(request.row_version === versionOf(b), "PR sudah berubah. Muat ulang data.", 409);
      const neededOn = date(b.needed_on, "Tanggal barang dibutuhkan");
      assert(neededOn >= request.request_date, "Tanggal barang dibutuhkan tidak boleh sebelum tanggal pengajuan.");
      const items = parseItems(b.items, settings), total = rule(() => sum(items.map((i) => i.subtotal)));
      const kept = new Set((await all(db, "SELECT file_id FROM purchase_attachments WHERE request_id=? AND owner_type='ITEM' AND file_id IS NOT NULL", request.id)).map((r) => r.file_id));
      await run(db, "DELETE FROM purchase_attachments WHERE request_id=? AND owner_type='ITEM'", request.id);
      await run(db, "DELETE FROM purchase_request_items WHERE request_id=?", request.id);
      const ctx = await requesterContext(db, user, acc, settings, asOf);
      assert(!ctx.missing.length, `PR belum dapat dikirim ulang. Lengkapi: ${ctx.missing.join(" ")}`);
      await saveItems(db, user, request, items, kept);
      const revised = await setStatus(db, request, ctx.kaban ? "pending_verification" : "pending_acknowledgement", {
        needed_on: neededOn,
        estimated_total: total,
        revision_no: request.revision_no + 1,
        supervisor_employee_id: ctx.kaban ? null : ctx.me.supervisor_employee_id,
        budget_line_id: null,
        special_budget: 0,
        final_approver_kind: null
      });
      await startApproval(db, user, revised, settings, ctx.kaban, asOf);
      await audit(db, user, "REVISE", "purchase_requests", request.id, {
        revision_no: revised.revision_no,
        total
      });
      return await requestDetail(db, acc, user, settings, await loadRequest(db, request.id));
    });
    if (action === "cancel" && m === "POST") return await tx(db, async () => {
      assert(user.employee_id === request.requester_employee_id, "Hanya pemohon yang dapat membatalkan PR ini.", 403);
      assert(CANCELLABLE.includes(request.status) && !request.pr_number, "PR hanya dapat dibatalkan sebelum nomor PR terbit.", 409);
      assert(request.row_version === versionOf(b), "PR sudah berubah. Muat ulang data.", 409);
      await supersedePending(db, request.id);
      await setStatus(db, request, "cancelled", {
        closed_reason: optional(b.reason, 1e3) || "Dibatalkan pemohon.",
        closed_at: now()
      });
      await audit(db, user, "CANCEL", "purchase_requests", request.id, {}, optional(b.reason, 1e3) || "");
      return await requestDetail(db, acc, user, settings, await loadRequest(db, request.id));
    });
    if (action === "decide" && m === "POST") return await tx(db, async () => {
      const step = await pick(db, "purchase_approval_steps", b.step_id, "Tahap");
      assert(step.request_id === request.id && step.object_type === "REQUEST", "Tahap tidak sesuai dengan PR ini.", 422);
      assert(request.row_version === versionOf(b), "PR sudah berubah. Muat ulang data.", 409);
      const asDelegate = await actingAs(db, acc, user, request, step, asOf);
      const me = await employeeOnDate(db, user.employee_id, asOf);
      const verdict = b.action;
      assert(["APPROVE", "RETURN", "REJECT"].includes(verdict), "Tindakan tidak valid.");
      const override = acc.superadmin && step.target_kind === "EMPLOYEE" && step.target_employee_id !== user.employee_id && !acc.sekban_peers.includes(step.target_employee_id);
      const reason = override ? text(b.reason, "Alasan tindakan Superadmin menggantikan penyetuju", 2e3) : verdict === "APPROVE" ? optional(b.reason, 2e3) : text(b.reason, verdict === "RETURN" ? "Alasan pengembalian" : "Alasan penolakan", 2e3);
      if (verdict === "RETURN") assert(["ACKNOWLEDGE", "VERIFY", "FINAL"].includes(step.step_kind), "Tahap ini hanya dapat disetujui atau ditolak.");
      const expected = {
        ACKNOWLEDGE: "pending_acknowledgement",
        VERIFY: "pending_verification",
        FINAL: "pending_final_approval",
        REVERIFY: "pending_reverification",
        REAPPROVE: "pending_reapproval"
      }[step.step_kind];
      assert(request.status === expected, "Status PR tidak sesuai dengan tahap ini. Muat ulang data.", 409);
      if (verdict !== "APPROVE") {
        await decide(db, user, me, step, verdict === "RETURN" ? "RETURNED" : "REJECTED", reason, asDelegate);
        await supersedePending(db, request.id);
        await setStatus(db, request, verdict === "RETURN" ? "returned" : "rejected", verdict === "REJECT" ? {
          closed_reason: reason,
          closed_at: now()
        } : {});
        await audit(db, user, verdict, "purchase_requests", request.id, {
          step: step.step_kind
        }, reason);
        return await requestDetail(db, acc, user, settings, await loadRequest(db, request.id));
      }
      if (step.step_kind === "ACKNOWLEDGE") {
        await decide(db, user, me, step, "APPROVED", reason, asDelegate);
        await addStep(db, user, await setStatus(db, request, "pending_verification"), "VERIFY", null, request.revision_no);
      } else if (step.step_kind === "VERIFY") {
        const line = await pick(db, "budget_lines", b.budget_line_id, "Pos RKA");
        assert(line.is_active, "Pos RKA tidak aktif.");
        const special = flag(b.special_budget);
        const { kind, target } = await finalTarget(db, settings, request, finalApproverKind(Number(request.estimated_total), special, settings), asOf);
        await decide(db, user, me, step, "APPROVED", reason, asDelegate);
        const updated = await setStatus(db, request, "pending_final_approval", {
          budget_line_id: line.id,
          special_budget: special,
          final_approver_kind: kind
        });
        await addStep(db, user, updated, "FINAL", target, request.revision_no);
      } else if (step.step_kind === "FINAL") {
        await decide(db, user, me, step, "APPROVED", reason, asDelegate);
        const approved = await setStatus(db, request, "pending_completeness_check", {
          approved_total: request.estimated_total
        });
        await freezeDocument(db, user, approved, "PR", approved.id, approved.pr_number, await requestSnapshot(db, settings, approved));
      } else if (step.step_kind === "REVERIFY") {
        const round = request.confirmation_round;
        for (const c2 of await all(db, "SELECT * FROM purchase_price_confirmations WHERE request_id=? AND round_no=? AND answer='ACCEPTED'", request.id, round)) {
          const item = await get(db, "purchase_request_items", c2.item_id);
          await update(db, "purchase_request_items", item.id, item.row_version, {
            approved_unit_price: c2.new_unit_price,
            approved_subtotal: c2.new_subtotal
          });
        }
        const approved = await all(db, "SELECT approved_subtotal FROM purchase_request_items WHERE request_id=? AND status='ACTIVE'", request.id);
        const total = rule(() => sum(approved.map((i) => i.approved_subtotal)));
        await decide(db, user, me, step, "APPROVED", reason, asDelegate);
        const needsKaban = request.final_approver_kind === "SEKBAN" && finalApproverKind(total, request.special_budget, settings) === "KABAN";
        const updated = await setStatus(db, request, needsKaban ? "pending_reapproval" : "in_procurement", {
          approved_total: total
        });
        if (needsKaban) await addStep(db, user, updated, "REAPPROVE", (await finalTarget(db, settings, updated, "KABAN", asOf)).target, request.revision_no);
        else await freezeDocument(db, user, updated, "PR", updated.id, updated.pr_number, await requestSnapshot(db, settings, updated));
      } else if (step.step_kind === "REAPPROVE") {
        await decide(db, user, me, step, "APPROVED", reason, asDelegate);
        const updated = await setStatus(db, request, "in_procurement", {
          final_approver_kind: "KABAN"
        });
        await freezeDocument(db, user, updated, "PR", updated.id, updated.pr_number, await requestSnapshot(db, settings, updated));
      }
      await audit(db, user, "APPROVE", "purchase_requests", request.id, {
        step: step.step_kind,
        as_delegate: asDelegate
      });
      return await requestDetail(db, acc, user, settings, await loadRequest(db, request.id));
    });
    if (action === "completeness" && m === "POST") return await tx(db, async () => {
      assertStaff(acc, request);
      assert(request.status === "pending_completeness_check", "PR tidak sedang menunggu pemeriksaan kelengkapan.", 409);
      assert(request.row_version === versionOf(b), "PR sudah berubah. Muat ulang data.", 409);
      if (b.action === "REJECT") {
        const reason = text(b.reason, "Alasan penolakan", 2e3);
        await setStatus(db, request, "rejected", {
          closed_reason: reason,
          closed_at: now()
        });
        await audit(db, user, "REJECT", "purchase_requests", request.id, {
          step: "COMPLETENESS"
        }, reason);
        return await requestDetail(db, acc, user, settings, await loadRequest(db, request.id));
      }
      assert(b.action === "ACCEPT", "Tindakan tidak valid.");
      const unit = await one(db, "SELECT code FROM org_units WHERE id=?", request.org_unit_id), key = unitCode(settings, request, unit), yr = year(asOf);
      let number = optional(b.pr_number, 80);
      if (number) {
        assert(!await one(db, "SELECT id FROM purchase_requests WHERE pr_number=? AND id<>?", number, request.id), "Nomor PR sudah dipakai PR lain.", 409);
        const parsed = parseSequence(number);
        if (parsed && number.includes(`/PR/${key}/`) && number.endsWith(`/${yr}`)) await raiseSequence(db, "PR", key, yr, parsed);
      } else number = documentNumber("PR", await nextSequence(db, "PR", key, yr), asOf, key);
      const pic = b.pic_employee_id ? await pick(db, "employees", b.pic_employee_id, "PIC pembelian") : user.employee_id ? await get(db, "employees", user.employee_id) : null;
      assert(pic && pic.is_active === 1, "Pilih PIC pembelian yang aktif.");
      const updated = await setStatus(db, request, "in_procurement", {
        pr_number: number,
        pic_employee_id: pic.id
      });
      await freezeDocument(db, user, updated, "PR", updated.id, number, await requestSnapshot(db, settings, updated));
      await audit(db, user, "ACCEPT", "purchase_requests", request.id, {
        pr_number: number,
        pic_employee_id: pic.id
      });
      return await requestDetail(db, acc, user, settings, await loadRequest(db, request.id));
    });
    if (action === "quotes" && m === "POST" && !p[4]) return await tx(db, async () => {
      assertStaff(acc, request);
      assert(request.status === "in_procurement", "Perbandingan harga hanya untuk PR yang sedang diproses.", 409);
      const item = await pick(db, "purchase_request_items", b.item_id, "Item");
      assert(item.request_id === request.id && item.status === "ACTIVE", "Item tidak sesuai dengan PR ini.");
      assert(!(await openOrderItems(db, request.id)).some((o) => o.request_item_id === item.id), "Item ini sudah masuk pesanan.", 409);
      const vendor = b.vendor_id ? await pick(db, "vendors", b.vendor_id, "Vendor") : null;
      const storeName = vendor ? vendor.name : text(b.store_name, "Nama toko", 200);
      const evidence = attachmentList(b.evidence, "Bukti harga", "Bukti harga wajib dilampirkan (ATR-PG-02).");
      const quote = await insert(db, "purchase_price_quotes", {
        request_id: request.id,
        item_id: item.id,
        vendor_id: vendor?.id || null,
        store_name: storeName,
        unit_price: rule(() => money(b.unit_price, "Harga satuan")),
        is_selected: 0,
        created_by: user.id
      });
      await saveAttachments(db, user, request, "QUOTE", quote.id, "PRICE_EVIDENCE", evidence);
      await audit(db, user, "ADD_QUOTE", "purchase_requests", request.id, {
        item_id: item.id,
        quote_id: quote.id
      });
      return await requestDetail(db, acc, user, settings, await loadRequest(db, request.id));
    });
    if (action === "quotes" && p[4] && m === "DELETE") return await tx(db, async () => {
      assertStaff(acc, request);
      const quote = await get(db, "purchase_price_quotes", p[4]);
      assert(quote.request_id === request.id, "Harga tidak sesuai dengan PR ini.");
      assert(!(await openOrderItems(db, request.id)).some((o) => o.request_item_id === quote.item_id), "Item ini sudah masuk pesanan.", 409);
      await run(db, "DELETE FROM purchase_attachments WHERE owner_type='QUOTE' AND owner_id=?", quote.id);
      await run(db, "DELETE FROM purchase_price_quotes WHERE id=?", quote.id);
      await audit(db, user, "REMOVE_QUOTE", "purchase_requests", request.id, {
        quote_id: quote.id
      });
      return await requestDetail(db, acc, user, settings, await loadRequest(db, request.id));
    });
    if (action === "quotes" && p[4] && p[5] === "select" && m === "POST") return await tx(db, async () => {
      assertStaff(acc, request);
      const quote = await get(db, "purchase_price_quotes", p[4]);
      assert(quote.request_id === request.id, "Harga tidak sesuai dengan PR ini.");
      assert(!(await openOrderItems(db, request.id)).some((o) => o.request_item_id === quote.item_id), "Item ini sudah masuk pesanan.", 409);
      const siblings = await all(db, "SELECT * FROM purchase_price_quotes WHERE item_id=?", quote.item_id);
      const cheapest = Math.min(...siblings.map((q) => Number(q.unit_price)));
      const reason = Number(quote.unit_price) > cheapest ? text(b.reason, "Alasan memilih harga yang bukan termurah", 1e3) : null;
      await run(db, "UPDATE purchase_price_quotes SET is_selected=0,not_cheapest_reason=NULL,updated_at=?,row_version=row_version+1 WHERE item_id=?", now(), quote.item_id);
      await run(db, "UPDATE purchase_price_quotes SET is_selected=1,not_cheapest_reason=?,updated_at=?,row_version=row_version+1 WHERE id=?", reason, now(), quote.id);
      await audit(db, user, "SELECT_QUOTE", "purchase_requests", request.id, {
        quote_id: quote.id,
        not_cheapest: Boolean(reason)
      });
      return await requestDetail(db, acc, user, settings, await loadRequest(db, request.id));
    });
    if (action === "orders" && m === "POST") return await tx(db, async () => {
      assertStaff(acc, request);
      assert(request.status === "in_procurement", "Pesanan hanya dapat dibuat untuk PR yang sedang diproses.", 409);
      const path = b.path;
      assert(allowedPaths(Number(request.approved_total), settings).includes(path), path === "A" ? `Total PR ${formatRupiah(request.approved_total)} wajib lewat perbandingan harga atau surat penunjukan (ATR-PG-01).` : "Total PR di bawah batas perbandingan; gunakan jalur langsung beli.", 422);
      const taken = new Set((await openOrderItems(db, request.id)).map((o) => o.request_item_id));
      const active = (await all(db, "SELECT * FROM purchase_request_items WHERE request_id=? AND status='ACTIVE' ORDER BY line_no", request.id)).filter((i) => !taken.has(i.id));
      const wanted = Array.isArray(b.item_ids) && b.item_ids.length ? b.item_ids : active.map((i) => i.id);
      const items = wanted.map((itemId) => {
        const item = active.find((i) => i.id === itemId);
        assert(item, "Item sudah dipesan, dibatalkan, atau bukan milik PR ini.");
        return item;
      });
      assert(items.length, "Tidak ada item yang perlu dipesan.");
      const created = [];
      if (path === "A") {
        const vendor = b.vendor_id ? await pick(db, "vendors", b.vendor_id, "Vendor") : null;
        const prices = Object.fromEntries(items.map((i) => [i.id, b.prices?.[i.id] ?? Number(i.approved_unit_price)]));
        created.push(await createOrder(db, user, request, "A", vendor, vendor ? vendor.name : text(b.store_name, "Nama toko", 200), pricedLines(items, prices), "NONE"));
      } else if (path === "B") {
        const quotes = await all(db, `SELECT * FROM purchase_price_quotes WHERE item_id IN (${items.map(() => "?").join(",")})`, ...items.map((i) => i.id));
        const groups = /* @__PURE__ */ new Map();
        for (const item of items) {
          const own = quotes.filter((q) => q.item_id === item.id), stores = new Set(own.map((q) => q.store_name.trim().toLowerCase()));
          assert(stores.size >= settings.min_quotes_per_item, `Item ${item.line_no} butuh minimal ${settings.min_quotes_per_item} harga dari toko berbeda (ATR-PG-02).`);
          const chosen = own.filter((q) => q.is_selected);
          assert(chosen.length === 1, `Pilih satu harga untuk item ${item.line_no}.`);
          assert(chosen[0].vendor_id, `Harga terpilih item ${item.line_no} harus dari vendor yang terdaftar, karena PO/SPK memakai data vendor.`);
          const list = groups.get(chosen[0].vendor_id) || [];
          list.push({
            item,
            price: Number(chosen[0].unit_price)
          });
          groups.set(chosen[0].vendor_id, list);
        }
        for (const [vendorId, list] of groups) {
          const vendor = await get(db, "vendors", vendorId);
          const kind = documentKindFor(list.map((l) => l.item.item_kind));
          const order = await createOrder(db, user, request, "B", vendor, vendor.name, pricedLines(list.map((l) => l.item), Object.fromEntries(list.map((l) => [l.item.id, l.price]))), kind);
          await insert(db, "vendor_order_documents", {
            order_id: order.id,
            ...orderDocumentValues({}, settings, kind),
            created_by: user.id
          });
          created.push(order);
        }
      } else {
        const vendor = await pick(db, "vendors", b.vendor_id, "Vendor");
        const kind = documentKindFor(items.map((i) => i.item_kind));
        const order = await createOrder(db, user, request, "C", vendor, vendor.name, pricedLines(items, b.prices || {}), kind);
        await insert(db, "vendor_order_documents", {
          order_id: order.id,
          ...orderDocumentValues(b.document, settings, kind),
          created_by: user.id
        });
        created.push(await submitOrder(db, user, settings, request, order, b));
      }
      await update(db, "purchase_requests", request.id, request.row_version, {
        procurement_path: path
      });
      await audit(db, user, "CREATE_ORDERS", "purchase_requests", request.id, {
        path,
        orders: created.map((o) => o.id)
      });
      return await requestDetail(db, acc, user, settings, await loadRequest(db, request.id));
    });
    if (action === "confirmations" && m === "POST" && !p[4]) return await tx(db, async () => {
      assertStaff(acc, request);
      assert(request.status === "in_procurement", "Konfirmasi ulang hanya untuk PR yang sedang diproses.", 409);
      assert(request.row_version === versionOf(b), "PR sudah berubah. Muat ulang data.", 409);
      assert(Array.isArray(b.items) && b.items.length, "Pilih minimal satu item yang harganya berubah.");
      const taken = new Set((await openOrderItems(db, request.id)).map((o) => o.request_item_id)), round = request.confirmation_round + 1;
      for (const line of b.items) {
        const item = await pick(db, "purchase_request_items", line?.item_id, "Item");
        assert(item.request_id === request.id && item.status === "ACTIVE" && !taken.has(item.id), "Item sudah dipesan, dibatalkan, atau bukan milik PR ini.");
        const price = rule(() => money(line.new_unit_price, `Harga baru item ${item.line_no}`)), subtotal = rule(() => lineSubtotal(item.quantity_milli, price));
        assert(subtotal > Number(item.approved_subtotal), `Harga baru item ${item.line_no} tidak lebih tinggi dari yang disetujui, jadi tidak perlu konfirmasi (ATR-PG-11).`);
        await insert(db, "purchase_price_confirmations", {
          request_id: request.id,
          item_id: item.id,
          round_no: round,
          old_unit_price: item.approved_unit_price,
          new_unit_price: price,
          old_subtotal: item.approved_subtotal,
          new_subtotal: subtotal,
          reason: text(line.reason, `Alasan kenaikan item ${item.line_no}`, 1e3),
          answer: "PENDING",
          created_by: user.id
        });
      }
      await setStatus(db, request, "pending_requester_confirmation", {
        confirmation_round: round
      });
      await audit(db, user, "REQUEST_CONFIRMATION", "purchase_requests", request.id, {
        round,
        items: b.items.length
      });
      return await requestDetail(db, acc, user, settings, await loadRequest(db, request.id));
    });
    if (action === "confirmations" && p[4] === "answer" && m === "POST") return await tx(db, async () => {
      assert(user.employee_id === request.requester_employee_id, "Hanya pemohon yang dapat menjawab konfirmasi ulang.", 403);
      assert(request.status === "pending_requester_confirmation", "Tidak ada konfirmasi ulang yang menunggu jawaban.", 409);
      assert(request.row_version === versionOf(b), "PR sudah berubah. Muat ulang data.", 409);
      const open = await all(db, "SELECT * FROM purchase_price_confirmations WHERE request_id=? AND round_no=? AND answer='PENDING'", request.id, request.confirmation_round);
      const answers = Array.isArray(b.answers) ? b.answers : [];
      assert(open.every((c2) => answers.some((a) => a.item_id === c2.item_id && typeof a.accept === "boolean")), "Jawab setiap item: setujui harga baru atau batalkan item.");
      let accepted = 0;
      for (const c2 of open) {
        const accept = answers.find((a) => a.item_id === c2.item_id).accept;
        await update(db, "purchase_price_confirmations", c2.id, c2.row_version, {
          answer: accept ? "ACCEPTED" : "CANCELLED",
          answered_at: now(),
          answered_by: user.id
        });
        if (accept) accepted++;
        else {
          const item = await get(db, "purchase_request_items", c2.item_id);
          await update(db, "purchase_request_items", item.id, item.row_version, {
            status: "CANCELLED"
          });
        }
      }
      const remaining = await all(db, "SELECT approved_subtotal FROM purchase_request_items WHERE request_id=? AND status='ACTIVE'", request.id);
      if (!remaining.length) await setStatus(db, request, "cancelled", {
        closed_reason: "Semua item dibatalkan pemohon pada konfirmasi ulang harga.",
        closed_at: now()
      });
      else if (accepted) {
        const updated = await setStatus(db, request, "pending_reverification");
        await addStep(db, user, updated, "REVERIFY", null, request.revision_no);
      } else {
        await setStatus(db, request, "in_procurement", {
          approved_total: rule(() => sum(remaining.map((i) => i.approved_subtotal)))
        });
        await completeIfDone(db, request);
      }
      await audit(db, user, "ANSWER_CONFIRMATION", "purchase_requests", request.id, {
        accepted,
        cancelled: open.length - accepted
      });
      return await requestDetail(db, acc, user, settings, await loadRequest(db, request.id));
    });
    return void 0;
  }
  if (section === "orders" && id) {
    const order = await get(db, "vendor_orders", id), request = await loadRequest(db, order.request_id);
    if (!action && m === "PATCH") return await tx(db, async () => {
      assertStaff(acc, request);
      assert(order.status === "draft", "Hanya pesanan draf yang dapat diubah.", 409);
      assert(order.row_version === versionOf(b), "Pesanan sudah berubah. Muat ulang data.", 409);
      if (order.path !== "A") {
        const doc = await one(db, "SELECT * FROM vendor_order_documents WHERE order_id=?", order.id);
        const values = orderDocumentValues({
          ...doc,
          ...b.document || {}
        }, settings, doc.doc_kind);
        await update(db, "vendor_order_documents", doc.id, doc.row_version, values);
        if (values.doc_kind !== order.document_kind) await run(db, "UPDATE vendor_orders SET document_kind=? WHERE id=?", values.doc_kind, order.id);
      }
      const requestItems = await all(db, "SELECT * FROM purchase_request_items WHERE request_id=?", request.id);
      for (const line of Array.isArray(b.items) ? b.items : []) {
        const row = await pick(db, "vendor_order_items", line?.id, "Item pesanan");
        assert(row.order_id === order.id, "Item tidak sesuai dengan pesanan ini.");
        const neededOn = line.needed_on === void 0 ? row.needed_on : date(line.needed_on, "Tanggal dibutuhkan");
        const volume = line.calc_volume === void 0 || line.calc_volume === null || line.calc_volume === "" ? null : rule(() => quantityMilli(line.calc_volume, "Volume hitung"));
        const calcUnit = volume ? text(line.calc_unit, "Satuan volume hitung", 20) : null;
        const subtotal = rule(() => lineSubtotal(volume || row.quantity_milli, row.unit_price));
        const item = requestItems.find((i) => i.id === row.request_item_id);
        assert(subtotal <= Number(item.approved_subtotal), `Subtotal item ${item.line_no} melebihi nilai yang disetujui. Ajukan konfirmasi ulang (ATR-PG-09).`, 409);
        await update(db, "vendor_order_items", row.id, row.row_version, {
          needed_on: neededOn,
          calc_volume_milli: volume,
          calc_unit: calcUnit,
          subtotal
        });
      }
      const lines = await all(db, "SELECT subtotal FROM vendor_order_items WHERE order_id=?", order.id);
      const total = rule(() => sum(lines.map((i) => i.subtotal)));
      const fresh2 = await get(db, "vendor_orders", order.id);
      await update(db, "vendor_orders", order.id, fresh2.row_version, {
        total
      });
      await audit(db, user, "UPDATE_ORDER", "vendor_orders", order.id, {
        total
      });
      return await requestDetail(db, acc, user, settings, await loadRequest(db, request.id));
    });
    if (action === "submit" && m === "POST") return await tx(db, async () => {
      assertStaff(acc, request);
      assert(request.status === "in_procurement", "PR tidak sedang diproses.", 409);
      assert(order.row_version === versionOf(b), "Pesanan sudah berubah. Muat ulang data.", 409);
      await submitOrder(db, user, settings, request, order, b);
      await audit(db, user, "SUBMIT_ORDER", "vendor_orders", order.id, {
        path: order.path
      });
      return await requestDetail(db, acc, user, settings, await loadRequest(db, request.id));
    });
    if (action === "decide" && m === "POST") return await tx(db, async () => {
      const step = await pick(db, "purchase_approval_steps", b.step_id, "Tahap");
      const appointment = step.object_type === "APPOINTMENT" ? await get(db, "vendor_appointments", step.object_id) : null;
      assert(step.request_id === request.id && (step.object_type === "ORDER" ? step.object_id === order.id : appointment?.order_id === order.id), "Tahap tidak sesuai dengan pesanan ini.", 422);
      assert(order.row_version === versionOf(b), "Pesanan sudah berubah. Muat ulang data.", 409);
      const asDelegate = await actingAs(db, acc, user, request, step, asOf);
      const me = await employeeOnDate(db, user.employee_id, asOf);
      if (acc.superadmin && step.target_kind === "EMPLOYEE" && step.target_employee_id !== user.employee_id && !acc.sekban_peers.includes(step.target_employee_id)) text(b.reason, "Alasan tindakan Superadmin menggantikan penyetuju", 2e3);
      assert(["APPROVE", "REJECT"].includes(b.action), "Tindakan tidak valid.");
      if (b.action === "REJECT") {
        const reason = text(b.reason, "Alasan penolakan", 2e3);
        await decide(db, user, me, step, "REJECTED", reason, asDelegate);
        if (appointment) await update(db, "vendor_appointments", appointment.id, appointment.row_version, {
          status: "REJECTED",
          decided_at: now()
        });
        await update(db, "vendor_orders", order.id, order.row_version, {
          status: "draft"
        });
        await audit(db, user, "REJECT", "vendor_orders", order.id, {
          step: step.step_kind
        }, reason);
        return await requestDetail(db, acc, user, settings, await loadRequest(db, request.id));
      }
      await decide(db, user, me, step, "APPROVED", optional(b.reason, 2e3), asDelegate);
      if (appointment) {
        const issued = today(), yr = year(issued);
        const number = documentNumber("SPV", await nextSequence(db, "SPV", "PURCHASE", yr, numberFloor(settings, "SPV", yr)), issued);
        const savedAppointment = await update(db, "vendor_appointments", appointment.id, appointment.row_version, {
          status: "APPROVED",
          number,
          decided_at: now()
        });
        const target = acc.superadmin ? me : await employeeOnDate(db, step.target_employee_id, issued);
        const vendor = await get(db, "vendors", order.vendor_id);
        await freezeDocument(db, user, request, "SPV", appointment.id, number, {
          organization: settings.organization,
          number,
          date: issued,
          request_code: request.request_code,
          pr_number: request.pr_number,
          vendor: {
            name: vendor.name,
            address: vendor.address
          },
          reason: savedAppointment.reason,
          total: Number(order.total),
          total_words: terbilang(Number(order.total)),
          items: (await all(db, "SELECT i.description,oi.quantity_milli,oi.unit,oi.unit_price,oi.subtotal FROM vendor_order_items oi JOIN purchase_request_items i ON i.id=oi.request_item_id WHERE oi.order_id=? ORDER BY i.line_no", order.id)).map((i) => ({
            description: i.description,
            quantity: formatQuantity(i.quantity_milli),
            unit: i.unit,
            unit_price: Number(i.unit_price),
            subtotal: Number(i.subtotal)
          })),
          signer: {
            name: target?.full_name,
            position: target?.position_name,
            approved_at: now(),
            plh: asDelegate ? me.full_name : null
          }
        });
      }
      await issueOrderDocument(db, user, settings, request, order, step, me);
      await audit(db, user, "APPROVE", "vendor_orders", order.id, {
        step: step.step_kind,
        as_delegate: asDelegate
      });
      return await requestDetail(db, acc, user, settings, await loadRequest(db, request.id));
    });
    if (action === "purchase" && m === "POST") return await tx(db, async () => {
      assertStaff(acc, request);
      assert(order.status === "ordered", "Pembelian hanya dapat dicatat untuk pesanan yang sudah terbit.", 409);
      assert(order.row_version === versionOf(b), "Pesanan sudah berubah. Muat ulang data.", 409);
      const purchasedOn = date(b.purchased_on, "Tanggal beli");
      assert(purchasedOn <= asOf, "Tanggal beli tidak boleh di masa depan.");
      const rows = await all(db, "SELECT oi.*,i.line_no FROM vendor_order_items oi JOIN purchase_request_items i ON i.id=oi.request_item_id WHERE oi.order_id=?", order.id);
      const prices = Object.fromEntries((Array.isArray(b.items) ? b.items : []).map((l) => [l.id, l.unit_price]));
      for (const row of rows) {
        const price = prices[row.id] === void 0 ? Number(row.unit_price) : rule(() => money(prices[row.id], `Harga beli item ${row.line_no}`));
        assert(price <= Number(row.unit_price), `Harga beli item ${row.line_no} lebih tinggi dari harga pesanan. Ajukan konfirmasi ulang sebelum membeli (ATR-PG-09).`, 409);
        await update(db, "vendor_order_items", row.id, row.row_version, {
          purchase_unit_price: price
        });
      }
      await insert(db, "order_receipts", {
        order_id: order.id,
        purchased_on: purchasedOn,
        created_by: user.id
      });
      await update(db, "vendor_orders", order.id, order.row_version, {
        status: "purchased"
      });
      await audit(db, user, "PURCHASE", "vendor_orders", order.id, {
        purchased_on: purchasedOn
      });
      return await requestDetail(db, acc, user, settings, await loadRequest(db, request.id));
    });
    if (action === "receive" && m === "POST") return await tx(db, async () => {
      assertStaff(acc, request);
      assert(order.status === "purchased", "Serah terima dicatat setelah pembelian.", 409);
      assert(order.row_version === versionOf(b), "Pesanan sudah berubah. Muat ulang data.", 409);
      const receipt = await one(db, "SELECT * FROM order_receipts WHERE order_id=?", order.id);
      const receivedOn = date(b.received_on, "Tanggal serah terima");
      assert(receivedOn >= receipt.purchased_on && receivedOn <= asOf, "Tanggal serah terima harus antara tanggal beli dan hari ini.");
      const invoice = attachmentList(b.invoice, "Nota vendor", "Nota, kwitansi, atau invoice vendor wajib diunggah (ATR-ST-03).");
      assert(invoice.every((a) => a.form === "FILE"), "Nota vendor harus berupa berkas yang diunggah.");
      const rows = await all(db, "SELECT * FROM vendor_order_items WHERE order_id=?", order.id);
      const received = Object.fromEntries((Array.isArray(b.items) ? b.items : []).map((l) => [l.id, l.received_quantity]));
      for (const row of rows) {
        const qty = received[row.id] === void 0 ? row.quantity_milli : rule(() => quantityMilli(received[row.id], "Jumlah diterima"));
        await update(db, "vendor_order_items", row.id, row.row_version, {
          received_quantity_milli: qty
        });
      }
      await saveAttachments(db, user, request, "ORDER", order.id, "VENDOR_INVOICE", invoice);
      await update(db, "order_receipts", receipt.id, receipt.row_version, {
        received_on: receivedOn,
        received_by_employee_id: user.employee_id || null,
        condition_note: text(b.condition_note, "Kondisi barang atau hasil pekerjaan", 2e3),
        invoice_total: rule(() => money(b.invoice_total, "Total nota vendor"))
      });
      await update(db, "vendor_orders", order.id, order.row_version, {
        status: "received"
      });
      await completeIfDone(db, request);
      await audit(db, user, "RECEIVE", "vendor_orders", order.id, {
        received_on: receivedOn
      });
      return await requestDetail(db, acc, user, settings, await loadRequest(db, request.id));
    });
    if (action === "attachments" && m === "POST") return await tx(db, async () => {
      assertStaff(acc, request);
      assert(["ordered", "purchased", "received"].includes(order.status) && order.path !== "A", "Scan bertanda tangan diunggah setelah PO/SPK terbit.", 409);
      await saveAttachments(db, user, request, "ORDER", order.id, "SIGNED_SCAN", attachmentList(b.attachments, "Scan bertanda tangan", "Unggah scan PO/SPK yang sudah ditandatangani vendor."));
      await audit(db, user, "ATTACH_SIGNED", "vendor_orders", order.id);
      return await requestDetail(db, acc, user, settings, await loadRequest(db, request.id));
    });
    if (action === "cancel" && m === "POST") return await tx(db, async () => {
      assertStaff(acc, request);
      assert(["draft", "pending_appointment_approval", "pending_order_approval", "ordered"].includes(order.status), "Pesanan yang sudah dibeli tidak dapat dibatalkan.", 409);
      assert(order.row_version === versionOf(b), "Pesanan sudah berubah. Muat ulang data.", 409);
      const reason = text(b.reason, "Alasan pembatalan pesanan", 1e3);
      await supersedePending(db, request.id, order.id);
      for (const a of await all(db, "SELECT id FROM vendor_appointments WHERE order_id=? AND status='PENDING'", order.id)) await supersedePending(db, request.id, a.id);
      await run(db, "UPDATE vendor_appointments SET status='REJECTED',decided_at=?,updated_at=?,row_version=row_version+1 WHERE order_id=? AND status='PENDING'", now(), now(), order.id);
      await update(db, "vendor_orders", order.id, order.row_version, {
        status: "cancelled",
        cancelled_reason: reason
      });
      await run(db, "UPDATE purchase_documents SET superseded_at=?,updated_at=?,row_version=row_version+1 WHERE object_id=? AND superseded_at IS NULL", now(), now(), order.id);
      await audit(db, user, "CANCEL_ORDER", "vendor_orders", order.id, {}, reason);
      return await requestDetail(db, acc, user, settings, await loadRequest(db, request.id));
    });
    return void 0;
  }
  if (section === "steps" && id && action === "reassign" && m === "POST") return await tx(db, async () => {
    assert(acc.has("purchasing.settings.manage"), "Hanya Pengelola Pengadaan yang dapat mengalihkan tahap.", 403);
    const step = await get(db, "purchase_approval_steps", id), request = await loadRequest(db, step.request_id);
    assert(step.status === "PENDING" && step.target_kind === "EMPLOYEE", "Hanya tahap yang menunggu pegawai tertentu yang dapat dialihkan.", 409);
    assert(typeof b.employee_id === "string" && b.employee_id, "Pilih penyetuju baru.");
    const target = await employeeOnDate(db, b.employee_id, asOf);
    assert(target && target.is_active === 1, "Pilih pegawai aktif sebagai penyetuju baru.");
    assert(target.id !== request.requester_employee_id, "Pemohon tidak boleh menjadi penyetuju PR-nya sendiri.");
    assert(target.id !== step.target_employee_id, "Pilih penyetuju yang berbeda.");
    const reason = text(b.reason, "Alasan pengalihan", 1e3);
    const role = step.target_label.split(":")[0];
    await update(db, "purchase_approval_steps", step.id, step.row_version, {
      target_employee_id: target.id,
      target_label: `${role}: ${target.full_name}`,
      reassigned_from_employee_id: step.target_employee_id,
      reassign_reason: reason
    });
    await audit(db, user, "REASSIGN_STEP", "purchase_requests", request.id, {
      step_id: step.id,
      from: step.target_employee_id,
      to: target.id
    }, reason);
    return await requestDetail(db, acc, user, settings, await loadRequest(db, request.id));
  });
  if (section === "documents" && id && m === "GET") {
    const doc = await get(db, "purchase_documents", id), request = await loadRequest(db, doc.request_id);
    assert((await viewOf(db, acc, user, request, asOf)).any, "Anda tidak memiliki akses ke dokumen ini.", 403);
    if (doc.doc_type !== "PR") assert((await viewOf(db, acc, user, request, asOf)).full, "Dokumen pesanan hanya untuk pihak yang menangani pengadaan.", 403);
    const snapshot = JSON.parse(doc.snapshot_json);
    if (snapshot.vendor && !acc.allows("purchasing.vendors.sensitive", {
      org_unit_id: request.org_unit_id
    })) {
      snapshot.vendor.leader_nik = mask(snapshot.vendor.leader_nik);
      snapshot.vendor.account_no = mask(snapshot.vendor.account_no);
    }
    await audit(db, user, "VIEW_DOCUMENT", "purchase_documents", doc.id, {
      doc_type: doc.doc_type
    });
    return {
      id: doc.id,
      doc_type: doc.doc_type,
      number: doc.number,
      snapshot,
      snapshot_hash: doc.snapshot_hash,
      hash_valid: sha256(doc.snapshot_json) === doc.snapshot_hash,
      verification_code: doc.verification_code,
      superseded_at: doc.superseded_at,
      created_at: doc.created_at
    };
  }
  if (section === "verify" && id && m === "GET") {
    assert(/^[a-f0-9]{20}$/.test(id), "Kode verifikasi tidak valid.", 404);
    const doc = await one(db, "SELECT * FROM purchase_documents WHERE verification_code=?", id);
    assert(doc, "Dokumen dengan kode ini tidak ditemukan.", 404);
    const s = JSON.parse(doc.snapshot_json);
    return {
      doc_type: doc.doc_type,
      number: doc.number,
      request_code: s.request_code,
      date: s.date || s.request_date,
      total: s.total,
      approvals: s.approvals || (s.signer ? [{
        name: s.signer.name,
        position: s.signer.position,
        at: s.signer.approved_at
      }] : []),
      issued_at: doc.created_at,
      superseded_at: doc.superseded_at,
      hash_valid: sha256(doc.snapshot_json) === doc.snapshot_hash,
      snapshot_hash: doc.snapshot_hash
    };
  }
  if (section === "vendors") {
    const sensitive = acc.has("purchasing.vendors.sensitive");
    if (!id && m === "GET") {
      assert(acc.has("purchasing.vendors.read") || acc.has("purchasing.procurement.manage"), "Akses daftar vendor ditolak.", 403);
      return {
        items: (await all(db, "SELECT * FROM vendors ORDER BY name")).map((v) => vendorRow(v, sensitive)),
        sensitive
      };
    }
    if (m === "POST" && !id) return await tx(db, async () => {
      assert(acc.has("purchasing.vendors.manage"), "Akses kelola vendor ditolak.", 403);
      const row = await insert(db, "vendors", {
        ...await vendorValues(b, null, sensitive),
        created_by: user.id
      });
      await audit(db, user, "CREATE", "vendors", row.id, {
        name: row.name
      });
      return vendorRow(row, sensitive);
    });
    if (m === "PATCH" && id) return await tx(db, async () => {
      assert(acc.has("purchasing.vendors.manage"), "Akses kelola vendor ditolak.", 403);
      const old = await get(db, "vendors", id);
      const row = await update(db, "vendors", id, versionOf(b), await vendorValues(b, old, sensitive));
      await audit(db, user, "UPDATE", "vendors", id, {
        fields: Object.keys(b).filter((k) => k !== "row_version")
      });
      return vendorRow(row, sensitive);
    });
  }
  if (section === "budget") {
    if (!id && m === "GET") {
      assert(acc.has("purchasing.budget.read") || acc.has("purchasing.requests.verify"), "Akses Pos RKA ditolak.", 403);
      const yr = Number(url.searchParams.get("year")) || year(asOf);
      return {
        year: yr,
        years: await all(db, "SELECT * FROM budget_years ORDER BY year DESC"),
        items: await budgetLines(db, yr)
      };
    }
    if (id === "years" && m === "POST") return await tx(db, async () => {
      assert(acc.has("purchasing.budget.manage"), "Akses kelola Pos RKA ditolak.", 403);
      const yr = Number(b.year);
      assert(Number.isInteger(yr) && yr >= 2e3 && yr <= 2100, "Tahun anggaran tidak valid.");
      const row = await insert(db, "budget_years", {
        year: yr,
        is_active: 1,
        created_by: user.id
      });
      await audit(db, user, "CREATE", "budget_years", row.id, {
        year: yr
      });
      return row;
    });
    if (id === "lines" && m === "POST" && !action) return await tx(db, async () => {
      assert(acc.has("purchasing.budget.manage"), "Akses kelola Pos RKA ditolak.", 403);
      const by = await pick(db, "budget_years", b.budget_year_id, "Tahun anggaran");
      if (b.org_unit_id) await pick(db, "org_units", b.org_unit_id, "Unit");
      const code = text(b.code, "Kode Pos RKA", 20).toUpperCase();
      assert(/^[A-Z0-9_-]+$/.test(code), "Kode Pos RKA hanya huruf, angka, garis bawah, atau tanda hubung.");
      const row = await insert(db, "budget_lines", {
        budget_year_id: by.id,
        code,
        name: text(b.name, "Nama Pos RKA", 200),
        org_unit_id: b.org_unit_id || null,
        ceiling: rule(() => money(b.ceiling, "Pagu")),
        is_active: 1,
        created_by: user.id
      });
      await audit(db, user, "CREATE", "budget_lines", row.id, {
        code,
        ceiling: row.ceiling
      });
      return row;
    });
    if (id === "lines" && action && m === "PATCH") return await tx(db, async () => {
      assert(acc.has("purchasing.budget.manage"), "Akses kelola Pos RKA ditolak.", 403);
      const old = await get(db, "budget_lines", action);
      if (b.org_unit_id) await pick(db, "org_units", b.org_unit_id, "Unit");
      const row = await update(db, "budget_lines", old.id, versionOf(b), {
        name: b.name === void 0 ? old.name : text(b.name, "Nama Pos RKA", 200),
        org_unit_id: b.org_unit_id === void 0 ? old.org_unit_id : b.org_unit_id || null,
        ceiling: b.ceiling === void 0 ? old.ceiling : rule(() => money(b.ceiling, "Pagu")),
        is_active: b.is_active === void 0 ? old.is_active : flag(b.is_active)
      });
      await audit(db, user, "UPDATE", "budget_lines", row.id, {
        ceiling: row.ceiling,
        is_active: row.is_active
      });
      return row;
    });
  }
  if (section === "settings") {
    assert(acc.has("purchasing.settings.manage"), "Hanya Pengelola Pengadaan yang dapat membuka pengaturan.", 403);
    if (m === "GET") return {
      settings,
      officials: {
        sekban: settings.officials.sekban_position_id ? await positionHolders(db, settings.officials.sekban_position_id, asOf) : [],
        sekban_deputy: settings.officials.sekban_deputy_position_id ? await positionHolders(db, settings.officials.sekban_deputy_position_id, asOf) : [],
        kaban: settings.officials.kaban_position_id ? await positionHolders(db, settings.officials.kaban_position_id, asOf) : []
      }
    };
    if (m === "PATCH") return await tx(db, async () => {
      const next = await settingsValues(db, b.settings, settings);
      await run(db, "INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", SETTINGS_KEY, JSON.stringify(next));
      await audit(db, user, "SETTINGS_CHANGED", "app_settings", SETTINGS_KEY, {
        keys: Object.keys(b.settings || {})
      }, optional(b.reason, 1e3) || "");
      return {
        settings: next
      };
    });
  }
  if (section === "delegations") {
    assert(acc.has("purchasing.settings.manage"), "Hanya Pengelola Pengadaan yang dapat mengatur Plh.", 403);
    if (!id && m === "GET") return {
      items: await all(db, "SELECT d.*,f.full_name from_name,t.full_name to_name FROM purchase_delegations d JOIN employees f ON f.id=d.from_employee_id JOIN employees t ON t.id=d.to_employee_id ORDER BY d.starts_on DESC")
    };
    if (!id && m === "POST") return await tx(db, async () => {
      const from = await pick(db, "employees", b.from_employee_id, "Pejabat asal"), to = await pick(db, "employees", b.to_employee_id, "Plh");
      assert(from.id !== to.id, "Pejabat asal dan Plh harus berbeda.");
      assert(to.is_active === 1, "Plh harus pegawai aktif.");
      const starts = date(b.starts_on, "Tanggal mulai"), ends = date(b.ends_on, "Tanggal selesai");
      assert(ends >= starts, "Tanggal selesai tidak boleh sebelum tanggal mulai.");
      const row = await insert(db, "purchase_delegations", {
        from_employee_id: from.id,
        to_employee_id: to.id,
        starts_on: starts,
        ends_on: ends,
        reason: text(b.reason, "Dasar penunjukan Plh", 1e3),
        created_by: user.id
      });
      await audit(db, user, "CREATE", "purchase_delegations", row.id, {
        from: from.id,
        to: to.id,
        starts_on: starts,
        ends_on: ends
      });
      return row;
    });
    if (id && action === "revoke" && m === "POST") return await tx(db, async () => {
      const d = await get(db, "purchase_delegations", id);
      assert(!d.revoked_at, "Plh sudah dicabut.", 409);
      const row = await update(db, "purchase_delegations", id, versionOf(b), {
        revoked_at: now(),
        revoked_by: user.id
      });
      await audit(db, user, "REVOKE", "purchase_delegations", id);
      return row;
    });
  }
  if (section === "reports" && m === "GET") {
    assert(acc.has("purchasing.reports.read"), "Akses laporan ditolak.", 403);
    const yr = Number(url.searchParams.get("year")) || year(asOf), rows = await reportRows(db, acc, yr);
    const by = {};
    for (const r of rows) by[r.status] = (by[r.status] || 0) + 1;
    const ids = rows.map((r) => r.id);
    const orders = ids.length ? await all(db, `SELECT o.request_id,o.status,o.due_on,o.total,r.invoice_total FROM vendor_orders o LEFT JOIN order_receipts r ON r.order_id=o.id WHERE o.request_id IN (${ids.map(() => "?").join(",")}) AND o.status<>'cancelled'`, ...ids) : [];
    return {
      year: yr,
      total_requests: rows.length,
      by_status: Object.entries(by).map(([status, count]) => ({
        status,
        label: STATUS_LABELS[status],
        count
      })),
      approved_value: rule(() => sum(rows.filter((r) => r.approved_total !== null && !["rejected", "cancelled"].includes(r.status)).map((r) => r.approved_total))),
      realized_value: rule(() => sum(orders.filter((o) => o.status === "received").map((o) => o.invoice_total || 0))),
      late_orders: orders.filter((o) => isLate(o, asOf)).length,
      budget: acc.has("purchasing.budget.read") ? await budgetLines(db, yr) : []
    };
  }
  if (section === "export" && m === "GET") {
    assert(acc.has("purchasing.reports.export"), "Akses ekspor ditolak.", 403);
    const yr = Number(url.searchParams.get("year")) || year(asOf), rows = await reportRows(db, acc, yr);
    const cell = (v) => '"' + String(v ?? "").replace(/^[=+\-@\t\r]/, "'$&").replaceAll('"', '""') + '"';
    const table = [["Kode pengajuan", "Nomor PR", "Tanggal PR", "Pemohon", "Unit", "Status", "Total estimasi", "Total disetujui", "Penyetuju akhir", "Jalur"], ...rows.map((r) => [r.request_code, r.pr_number, r.request_date, r.requester_name, r.unit_name, STATUS_LABELS[r.status], r.estimated_total, r.approved_total, r.final_approver_kind, r.procurement_path])];
    await audit(db, user, "EXPORT", "purchase_requests", String(yr), {
      row_count: rows.length
    });
    return {
      filename: `pengadaan-${yr}.csv`,
      csv: table.map((row) => row.map(cell).join(",")).join("\r\n")
    };
  }
  return void 0;
}
async function purchasingPendingCount(db, user) {
  if (await isSuperAdmin(db, user)) return Number((user.employee_id ? await one(db, "SELECT count(*) n FROM purchase_approval_steps s JOIN purchase_requests r ON r.id=s.request_id WHERE s.status='PENDING' AND r.requester_employee_id<>?", user.employee_id) : await one(db, "SELECT count(*) n FROM purchase_approval_steps WHERE status='PENDING'")).n);
  if (!user.employee_id) return 0;
  const asOf = today(), ids = [user.employee_id, ...await sekbanPeers(db, await purchasingSettings(db), user.employee_id, asOf), ...await delegatorsOf(db, user.employee_id, asOf)];
  return Number((await one(db, `SELECT count(*) n FROM purchase_approval_steps s JOIN purchase_requests r ON r.id=s.request_id WHERE s.status='PENDING' AND s.target_kind='EMPLOYEE' AND r.requester_employee_id<>? AND s.target_employee_id IN (${ids.map(() => "?").join(",")})`, user.employee_id, ...ids)).n);
}
var attachments = [["briefing_files", "briefing_id", "briefing"], ["employee_files", "employee_id", "employee"], ["employee_contracts", "employee_id", "contract"], ["document_versions", "document_id", "document"], ["training_materials", "training_event_id", "material"], ["participant_certificates", "training_participant_id", "certificate"], ["logbook_files", "logbook_entry_id", "logbook"], ["incident_files", "incident_id", "incident"], ["announcement_files", "announcement_id", "announcement"], ["purchase_attachments", "request_id", "purchase"], ["coaching_files", "coaching_session_id", "coaching"]];
async function claimFile(db, user, id) {
  const f = await get(db, "files", id);
  assert(f.status === "AVAILABLE" && f.uploaded_by === user.id, "Berkas tidak tersedia untuk dilampirkan.", 403);
  assert(!await __archives.archiveFileLinked(db, id), "Berkas sudah terhubung ke arsip. Unggah berkas baru untuk objek ini.", 422);
  assert(!await one(db, attachments.map(([table]) => `SELECT 1 AS linked FROM ${table} WHERE file_id=?`).join(" UNION ALL ") + " LIMIT 1", ...attachments.map(() => id)), "Berkas sudah terhubung. Unggah berkas baru untuk objek ini.");
  return f;
}
async function fileStorageModule(db, id) {
  const modules = {
    website: "website",
    employee: "pegawai",
    contract: "pegawai",
    document: "sop",
    material: "pelatihan",
    certificate: "pelatihan",
    logbook: "patroli",
    incident: "kejadian",
    announcement: "informasi",
    purchase: "pengadaan",
    coaching: "coaching"
  };
  for (const [table, , type] of attachments) if (await one(db, `SELECT id FROM ${table} WHERE file_id=?`, id)) return modules[type];
  return null;
}
async function linkedFiles(db, type, id) {
  const entry = attachments.find((x) => x[2] === type);
  assert(entry, "Jenis lampiran tidak valid.");
  const metadata = type === "announcement" ? ",l.usage_kind,l.caption" : ["logbook", "incident", "briefing"].includes(type) ? ",l.captured_at,l.capture_source" : "";
  return await all(db, `SELECT f.id,f.original_name,f.mime_type,f.size_bytes,l.id link_id${metadata} FROM ${entry[0]} l JOIN files f ON f.id=l.file_id WHERE l.${entry[1]}=? AND f.status='AVAILABLE'`, id);
}
async function fileAllowed(db, user, id) {
  if (await __archives.archiveFileLinked(db, id)) return false;
  for (const material of await all(db, "SELECT tm.training_event_id,v.document_id FROM training_materials tm JOIN document_versions v ON v.id=tm.document_version_id WHERE v.file_id=?", id)) if (await trainingAllowed(db, user, "download", await get(db, "training_events", material.training_event_id)) && await documentAllowed(db, user, "download", await get(db, "documents", material.document_id))) return true;
  for (const [table, key, type] of attachments) for (const link of await all(db, `SELECT * FROM ${table} WHERE file_id=?`, id)) {
    if (type === "briefing" && await briefingAllowed(db, user, "read", await get(db, "morning_briefings", link.briefing_id))) return true;
    if (["employee", "contract"].includes(type) && await can(db, user, "hr.employee_files.read", await employeeContext(db, link[key]))) return true;
    if (type === "document") {
      const doc = await get(db, "documents", link.document_id);
      if (await documentAllowed(db, user, "download", doc) && (link.state === "ACTIVE" || await documentAllowed(db, user, "manage", doc))) return true;
    }
    if (type === "material" && await trainingAllowed(db, user, "download", await get(db, "training_events", link.training_event_id))) return true;
    if (type === "certificate") {
      const p = await get(db, "training_participants", link.training_participant_id), event = await get(db, "training_events", p.training_event_id);
      if (await trainingAllowed(db, user, "download", event) && (user.employee_id === p.employee_id || await trainingAllowed(db, user, "participants", event))) return true;
    }
    if (type === "logbook") {
      const log = await get(db, "logbook_entries", link.logbook_entry_id);
      if (await can(db, user, "security.logbook.download", await reportContext(db, log))) return true;
    }
    if (type === "incident") {
      const incident = await get(db, "incidents", link.incident_id);
      if (await can(db, user, "security.incidents.download", await reportContext(db, incident))) return true;
    }
    if (type === "coaching" && await coachingAllowed(db, user, "read", await get(db, "coaching_sessions", link.coaching_session_id))) return true;
    if (type === "purchase" && await purchaseFileAllowed(db, user, link)) return true;
    if (type === "announcement") {
      const a = await get(db, "announcements", link.announcement_id);
      if (await announcementsManager(db, user) || a.published_at && ["PUBLISHED", "ARCHIVED"].includes(a.status) && (!a.starts_at || a.starts_at <= now())) return true;
    }
  }
  return false;
}
async function upload(db, user, b, dataDir) {
  assert(await announcementsManager(db, user) || (await grants(db, user)).some((g) => ["hr.documents.manage", "hr.employee_files.manage", "hr.training.manage", "hr.training.participants", "security.logbook.create", "security.incidents.create", "security.incidents.update", "purchasing.requests.create", "purchasing.procurement.manage"].includes(g.code)), "Akses unggah ditolak.", 403);
  return await storeUpload(db, user, b, dataDir);
}
async function storeUpload(db, user, b, dataDir) {
  const name = basename(text(b.name, "Nama berkas", 180)).replace(/[\r\n"]/g, "_");
  assert(typeof b.data === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(b.data), "Isi berkas tidak valid.");
  const data = Buffer2.from(b.data, "base64"), max = 10 * 1024 * 1024;
  assert(data.length > 0 && data.length <= max, `Ukuran berkas harus 1 byte sampai ${max / 1024 / 1024} MB.`);
  const extension = name.split(".").at(-1).toLowerCase();
  const types = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  };
  assert(types[extension] && types[extension] === b.mime_type, "Jenis berkas yang diizinkan: PDF, PNG, JPEG, DOCX, XLSX.");
  const signature = extension === "pdf" ? data.subarray(0, 5).toString() === "%PDF-" : extension === "png" ? data.subarray(0, 8).equals(Buffer2.from([137, 80, 78, 71, 13, 10, 26, 10])) : ["jpg", "jpeg"].includes(extension) ? data[0] === 255 && data[1] === 216 && data[2] === 255 : data[0] === 80 && data[1] === 75 && data[2] === 3 && data[3] === 4;
  assert(signature, "Isi berkas tidak cocok dengan tipe yang dipilih.");
  if (["docx", "xlsx"].includes(extension)) assert(data.includes(Buffer2.from("[Content_Types].xml")) && data.includes(Buffer2.from(extension === "docx" ? "word/" : "xl/")), "Struktur berkas Office tidak valid.");
  const key = await db.storage.put(data, types[extension], name);
  const row = await insert(db, "files", {
    storage_key: key,
    original_name: name,
    mime_type: types[extension],
    size_bytes: data.length,
    checksum: createHash3("sha256").update(data).digest("hex"),
    status: "AVAILABLE",
    uploaded_by: user.id
  });
  await audit(db, user, "UPLOAD", "files", row.id, {
    size_bytes: data.length
  });
  return {
    id: row.id,
    original_name: name
  };
}
async function download(db, user, id, dataDir) {
  const file = await get(db, "files", id);
  assert(file.status === "AVAILABLE" && await fileAllowed(db, user, id), "Akses berkas ditolak.", 403);
  await audit(db, user, "DOWNLOAD", "files", id);
  return {
    file,
    data: await db.storage.get(file.storage_key, await fileStorageModule(db, file.id))
  };
}
async function attach(db, user, type, id, b) {
  return await tx(db, async () => {
    await claimFile(db, user, b.file_id);
    const f = b.file_id;
    if (type === "employee") {
      assert(await can(db, user, "hr.employee_files.manage", await employeeContext(db, id)), "Akses ditolak.", 403);
      return await insert(db, "employee_files", {
        employee_id: id,
        file_id: f,
        category: text(b.category || "LAINNYA"),
        title: text(b.title || (await get(db, "files", f)).original_name),
        created_by: user.id
      });
    }
    const config = type === "logbook" ? ["logbook_entries", "security.logbook", "logbook_files", "logbook_entry_id"] : type === "incident" ? ["incidents", "security.incidents", "incident_files", "incident_id"] : null;
    assert(config, "Jenis lampiran tidak valid.");
    const row = await get(db, config[0], id);
    assert(row.latitude == null && row.report_source !== "PUBLIC_LINK", "Foto laporan baru diambil melalui kamera saat pelaporan.");
    assert(await can(db, user, `${config[1]}.update`, await reportContext(db, row)) || row.created_by === user.id && await can(db, user, `${config[1]}.create`, await reportContext(db, row)), "Akses lampiran ditolak.", 403);
    const result = await insert(db, config[2], {
      [config[3]]: id,
      file_id: f,
      caption: text(b.caption || (await get(db, "files", f)).original_name),
      created_by: user.id
    });
    await audit(db, user, "ATTACH", config[0], id);
    return result;
  });
}
var optional2 = (v) => typeof v === "string" ? v.trim().slice(0, 1e4) || null : null;
var readList = async (db, user, perm, rows) => {
  assert(await has(db, user, perm), "Akses ditolak.", 403);
  return await asyncFilter(rows, async (r) => await can(db, user, perm, r));
};
async function employees(db, asOf = today()) {
  return (await all(db, `SELECT e.*,ep.id placement_id,ep.valid_from,ep.supervisor_employee_id,p.name position_name,p.id position_id,p.org_unit_id,u.name unit_name FROM employees e LEFT JOIN employee_placements ep ON ep.employee_id=e.id AND ep.is_primary=1 AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?) LEFT JOIN positions p ON p.id=ep.position_id LEFT JOIN org_units u ON u.id=p.org_unit_id ORDER BY e.full_name`, asOf, asOf)).map((e) => ({
    ...e,
    employee_id: e.id
  }));
}
async function placement(db, user, employeeId, b, permission = "hr.employees.update") {
  const position = await get(db, "positions", b.position_id), from = date(b.valid_from, "Tanggal efektif");
  await requireAccess(db, user, permission, {
    org_unit_id: position.org_unit_id,
    employee_id: employeeId
  });
  const supervisor = b.supervisor_employee_id || null;
  assert(supervisor !== employeeId, "Pegawai tidak boleh menjadi atasan dirinya sendiri.");
  if (supervisor) await get(db, "employees", supervisor);
  const existing = await all(db, "SELECT * FROM employee_placements WHERE employee_id=? AND is_primary=1 ORDER BY valid_from", employeeId);
  const active = existing.find((p) => p.valid_from <= from && (!p.valid_to || p.valid_to >= from));
  if (active) {
    assert(active.valid_from < from, "Penempatan di tanggal ini sudah ada. Gunakan tanggal efektif berikutnya.");
    await run(db, "UPDATE employee_placements SET valid_to=?,row_version=row_version+1,updated_at=? WHERE id=?", new Date(Date.parse(from) - 864e5).toISOString().slice(0, 10), now(), active.id);
  }
  const next = existing.filter((p) => p.valid_from > from).sort((a, b2) => a.valid_from.localeCompare(b2.valid_from))[0];
  const end = next ? new Date(Date.parse(next.valid_from) - 864e5).toISOString().slice(0, 10) : null;
  const row = await insert(db, "employee_placements", {
    employee_id: employeeId,
    position_id: position.id,
    supervisor_employee_id: supervisor,
    valid_from: from,
    valid_to: end,
    is_primary: 1,
    created_by: user.id
  });
  const boundaries = (await all(db, "SELECT DISTINCT valid_from FROM employee_placements ORDER BY valid_from")).map((r) => r.valid_from);
  for (const boundary of boundaries) {
    const graph = new Map((await all(db, "SELECT employee_id,supervisor_employee_id FROM employee_placements WHERE is_primary=1 AND valid_from<=? AND (valid_to IS NULL OR valid_to>=?)", boundary, boundary)).map((p) => [p.employee_id, p.supervisor_employee_id]));
    for (const start of graph.keys()) {
      let cursor = start;
      const seen = /* @__PURE__ */ new Set();
      while (cursor) {
        assert(!seen.has(cursor), "Rantai atasan membentuk siklus pada tanggal efektif.");
        seen.add(cursor);
        cursor = graph.get(cursor);
      }
    }
  }
  await audit(db, user, "PLACEMENT_CREATED", "employees", employeeId, {
    placement_id: row.id,
    valid_from: from
  });
  return row;
}
async function hrRoutes(c) {
  const { db, user, p, method: m, body: b, url } = c;
  const id = p[1], action = p[2];
  if (p[0] === "employees") {
    if (m === "GET" && !id) {
      const asOf = url.searchParams.get("as_of") || today();
      date(asOf);
      let rows = await readList(db, user, "hr.employees.read", await employees(db, asOf));
      const q = (url.searchParams.get("q") || "").toLowerCase(), unit = url.searchParams.get("unit"), status = url.searchParams.get("status");
      rows = rows.filter((e) => (!q || `${e.full_name} ${e.employee_no}`.toLowerCase().includes(q)) && (!unit || e.org_unit_id === unit) && (!status || e.employment_status === status));
      return {
        items: rows
      };
    }
    if (m === "POST" && !id) return await tx(db, async () => {
      const context = b.position_id ? {
        org_unit_id: (await get(db, "positions", b.position_id)).org_unit_id
      } : {};
      await requireAccess(db, user, "hr.employees.create", context);
      const row = await insert(db, "employees", {
        employee_no: text(b.employee_no, "Nomor pegawai", 60).toUpperCase(),
        full_name: text(b.full_name, "Nama lengkap", 200),
        employment_status: text(b.employment_status, "Status kepegawaian", 80),
        joined_on: date(b.joined_on, "Tanggal mulai kerja"),
        phone: optional2(b.phone),
        email: optional2(b.email),
        is_active: 1,
        created_by: user.id
      });
      if (b.position_id) await placement(db, user, row.id, {
        ...b,
        valid_from: b.valid_from || b.joined_on
      }, "hr.employees.create");
      await audit(db, user, "CREATE", "employees", row.id, {
        fields: ["employee_no", "full_name", "employment_status"]
      });
      return row;
    });
    if (id) {
      const e = await get(db, "employees", id), ctx = await employeeContext(db, id);
      if (m === "GET" && !action) {
        await requireAccess(db, user, "hr.employees.read", ctx);
        return {
          ...e,
          placements: await all(db, "SELECT ep.*,p.name position_name,o.name unit_name FROM employee_placements ep JOIN positions p ON p.id=ep.position_id JOIN org_units o ON o.id=p.org_unit_id WHERE ep.employee_id=? ORDER BY ep.valid_from DESC", id),
          contracts: await can(db, user, "hr.employee_files.read", ctx) ? await all(db, "SELECT * FROM employee_contracts WHERE employee_id=? ORDER BY starts_on DESC", id) : [],
          files: await can(db, user, "hr.employee_files.read", ctx) ? await linkedFiles(db, "employee", id) : [],
          training: await asyncFilter(await all(db, "SELECT t.*,p.attendance_status FROM training_participants p JOIN training_events t ON t.id=p.training_event_id WHERE p.employee_id=?", id), async (t) => await trainingAllowed(db, user, "read", t))
        };
      }
      if (m === "PATCH" && !action) return await tx(db, async () => {
        await requireAccess(db, user, "hr.employees.update", ctx);
        const joined = date(b.joined_on === void 0 ? e.joined_on : b.joined_on), ended = b.ended_on === void 0 ? e.ended_on : b.ended_on ? date(b.ended_on) : null;
        assert(!ended || ended >= joined, "Tanggal akhir tidak boleh mendahului tanggal mulai.");
        const row = await update(db, "employees", id, b.row_version, {
          employee_no: text(b.employee_no === void 0 ? e.employee_no : b.employee_no, "Nomor pegawai", 60).toUpperCase(),
          full_name: text(b.full_name === void 0 ? e.full_name : b.full_name, "Nama", 200),
          employment_status: text(b.employment_status === void 0 ? e.employment_status : b.employment_status),
          joined_on: joined,
          ended_on: ended,
          phone: b.phone === void 0 ? e.phone : optional2(b.phone),
          email: b.email === void 0 ? e.email : optional2(b.email),
          is_active: b.is_active === void 0 ? e.is_active : Number(Boolean(b.is_active))
        });
        await assertAdminRemains(db);
        if (!row.is_active) await run(db, "UPDATE public.app_users SET row_version=row_version+1 WHERE employee_id=?", id);
        await audit(db, user, "UPDATE", "employees", id, {
          fields: Object.keys(b).filter((x) => x !== "row_version")
        });
        return row;
      });
      if (action === "placements" && m === "POST") return await tx(db, async () => {
        await requireAccess(db, user, "hr.employees.update", ctx);
        assert(Number(b.row_version) === e.row_version, "Data berubah. Muat ulang.", 409);
        const result = await placement(db, user, id, b);
        await run(db, "UPDATE employees SET row_version=row_version+1 WHERE id=?", id);
        return result;
      });
      if (action === "contracts" && m === "POST") return await tx(db, async () => {
        await requireAccess(db, user, "hr.employee_files.manage", ctx);
        const start = date(b.starts_on), end = b.ends_on ? date(b.ends_on) : null;
        assert(!end || end >= start, "Rentang kontrak tidak valid.");
        if (b.file_id) await claimFile(db, user, b.file_id);
        const row = await insert(db, "employee_contracts", {
          employee_id: id,
          contract_no: text(b.contract_no),
          starts_on: start,
          ends_on: end,
          file_id: b.file_id || null,
          notes: optional2(b.notes),
          created_by: user.id
        });
        await audit(db, user, "CREATE", "employee_contracts", row.id);
        return row;
      });
    }
  }
  if (["units", "positions"].includes(p[0])) {
    const table = p[0] === "units" ? "org_units" : "positions";
    if (m === "GET" && !id) return {
      items: await readList(db, user, "hr.organization.read", (await all(db, `SELECT * FROM ${table} ORDER BY name`)).map((r) => ({
        ...r,
        org_unit_id: table === "org_units" ? r.id : r.org_unit_id
      })))
    };
    if (["POST", "PATCH"].includes(m)) return await tx(db, async () => {
      const old = id ? await get(db, table, id) : null, unit = table === "org_units" ? old?.id || b.parent_id : b.org_unit_id;
      await requireAccess(db, user, "hr.organization.manage", {
        org_unit_id: unit
      });
      const row = {
        code: text(b.code, "Kode", 64).toUpperCase(),
        name: text(b.name, "Nama", 200),
        is_active: b.is_active === void 0 ? 1 : Number(Boolean(b.is_active))
      };
      if (table === "org_units") {
        row.parent_id = b.parent_id || null;
        if (row.parent_id && row.parent_id !== old?.parent_id) await requireAccess(db, user, "hr.organization.manage", {
          org_unit_id: row.parent_id
        });
        let parent = row.parent_id;
        const seen = new Set(id ? [id] : []);
        while (parent) {
          assert(!seen.has(parent), "Hierarki unit membentuk siklus.");
          seen.add(parent);
          parent = (await get(db, "org_units", parent)).parent_id;
        }
      } else {
        await get(db, "org_units", unit);
        row.org_unit_id = unit;
        assert(!old || old.org_unit_id === unit, "Unit posisi tidak dapat dipindah. Buat posisi baru.");
      }
      const saved = old ? await update(db, table, id, b.row_version, row) : await insert(db, table, {
        ...row,
        created_by: user.id
      });
      await audit(db, user, old ? "UPDATE" : "CREATE", table, saved.id);
      return saved;
    });
  }
  if (p[0] === "documents") {
    if (m === "GET" && !id) {
      assert(await has(db, user, "hr.documents.read"), "Akses ditolak.", 403);
      return {
        items: await asyncFilter(await all(db, `SELECT d.*,o.name unit_name,(SELECT version_label FROM document_versions WHERE document_id=d.id AND state='ACTIVE') active_version,(SELECT effective_on FROM document_versions WHERE document_id=d.id AND state='ACTIVE') effective_on FROM documents d JOIN org_units o ON o.id=d.owner_org_unit_id WHERE d.is_archived=0 ORDER BY d.title`), async (d) => await documentAllowed(db, user, "read", d))
      };
    }
    if (m === "POST" && !id) return await tx(db, async () => {
      await requireAccess(db, user, "hr.documents.manage", {
        org_unit_id: b.owner_org_unit_id
      });
      await get(db, "org_units", b.owner_org_unit_id);
      const row = await insert(db, "documents", {
        document_code: text(b.document_code, "Kode", 64).toUpperCase(),
        title: text(b.title, "Judul", 250),
        category: enumValue(b.category, ["REGULATION", "SOP_SECURITY", "SOP", "SERVICE_STANDARD"], "Kategori"),
        owner_org_unit_id: b.owner_org_unit_id,
        audience_kind: enumValue(b.audience_kind || "ALL_UNITS", ["ALL_UNITS", "SELECTED_UNITS"]),
        description: optional2(b.description),
        is_archived: 0,
        created_by: user.id
      });
      if (row.audience_kind === "SELECTED_UNITS") {
        assert(Array.isArray(b.target_units) && b.target_units.length, "Pilih minimal satu sasaran unit.");
        for (const unit of new Set(b.target_units)) await run(db, "INSERT INTO document_target_units (document_id,org_unit_id) VALUES(?,?)", row.id, (await get(db, "org_units", unit)).id);
      }
      await audit(db, user, "CREATE", "documents", row.id);
      return row;
    });
    if (id) {
      const doc = await get(db, "documents", id);
      assert(!doc.is_archived, "Dokumen tidak ditemukan.", 404);
      if (m === "GET" && !action) {
        assert(await documentAllowed(db, user, "read", doc), "Akses ditolak.", 403);
        const manage = await documentAllowed(db, user, "manage", doc);
        return {
          ...doc,
          can_manage: manage,
          can_delete: manage,
          can_publish: await documentAllowed(db, user, "publish", doc),
          versions: (await all(db, "SELECT v.*,f.original_name FROM document_versions v JOIN files f ON f.id=v.file_id WHERE v.document_id=? ORDER BY v.created_at DESC", id)).filter((v) => manage || v.state === "ACTIVE"),
          targets: await all(db, "SELECT org_unit_id FROM document_target_units WHERE document_id=?", id)
        };
      }
      if (m === "DELETE" && !action) return await tx(db, async () => {
        assert(await documentAllowed(db, user, "manage", doc), "Anda tidak memiliki akses untuk menghapus dokumen unit ini.", 403);
        await update(db, "documents", id, b.row_version, { is_archived: 1 });
        await audit(db, user, "DELETE", "documents", id, { document_code: doc.document_code, title: doc.title });
        return { deleted: true };
      });
      if (m === "POST" && action === "versions") return await tx(db, async () => {
        assert(await documentAllowed(db, user, "manage", doc), "Akses ditolak.", 403);
        await claimFile(db, user, b.file_id);
        const row = await insert(db, "document_versions", {
          document_id: id,
          file_id: b.file_id,
          version_label: text(b.version_label, "Versi", 50),
          effective_on: date(b.effective_on),
          state: "DRAFT",
          change_notes: optional2(b.change_notes),
          created_by: user.id
        });
        await audit(db, user, "VERSION_ADDED", "documents", id, {
          version_id: row.id
        });
        return row;
      });
      if (m === "POST" && action === "activate") return await tx(db, async () => {
        assert(await documentAllowed(db, user, "publish", doc), "Akses ditolak.", 403);
        const v = await get(db, "document_versions", b.version_id);
        assert(v.document_id === id && v.state === "DRAFT", "Versi bukan draf dokumen ini.");
        assert(v.row_version === b.row_version, "Versi berubah. Muat ulang.", 409);
        assert(v.effective_on <= today(), "Tanggal berlaku belum tiba.");
        assert((await get(db, "files", v.file_id)).status === "AVAILABLE", "Berkas tidak tersedia.");
        await run(db, "UPDATE document_versions SET state='ARCHIVED',archived_at=?,row_version=row_version+1 WHERE document_id=? AND state='ACTIVE'", now(), id);
        const row = await update(db, "document_versions", v.id, b.row_version, {
          state: "ACTIVE",
          activated_by: user.id,
          activated_at: now()
        });
        await audit(db, user, "ACTIVATE", "document_versions", v.id);
        return row;
      });
    }
  }
  if (p[0] === "training") {
    if (m === "GET" && id === "calendar" && !action) {
      assert(user?.id && user.status === "ACTIVE", "Sesi pengguna tidak aktif.", 403);
      const year2 = Number(url.searchParams.get("year"));
      assert(Number.isInteger(year2) && year2 >= 2e3 && year2 <= 2100, "Tahun kalender tidak valid.");
      const from = (/* @__PURE__ */ new Date(`${year2}-01-01T00:00:00+08:00`)).toISOString();
      const until = (/* @__PURE__ */ new Date(`${year2 + 1}-01-01T00:00:00+08:00`)).toISOString();
      return {
        items: await all(db, "SELECT id,title,starts_at,ends_at,location,description,status FROM training_events WHERE deleted_at IS NULL AND starts_at<? AND ends_at>? ORDER BY starts_at,id", until, from)
      };
    }
    if (m === "GET" && !id) {
      assert(await has(db, user, "hr.training.read"), "Akses ditolak.", 403);
      return {
        items: await asyncFilter(await all(db, "SELECT t.*,(SELECT count(*) FROM training_participants WHERE training_event_id=t.id) participant_count FROM training_events t WHERE t.deleted_at IS NULL ORDER BY starts_at DESC"), async (t) => await trainingAllowed(db, user, "read", t))
      };
    }
    if (m === "POST" && !id) return await tx(db, async () => {
      await requireAccess(db, user, "hr.training.manage", {
        org_unit_id: b.organizer_org_unit_id
      });
      await get(db, "org_units", b.organizer_org_unit_id);
      const start = instant(b.starts_at), end = instant(b.ends_at);
      assert(end > start, "Waktu selesai harus setelah waktu mulai.");
      const row = await insert(db, "training_events", {
        title: text(b.title),
        topic: text(b.topic),
        organizer_org_unit_id: b.organizer_org_unit_id,
        organizer_name: optional2(b.organizer_name),
        starts_at: start,
        ends_at: end,
        location: optional2(b.location),
        description: optional2(b.description),
        status: "PLANNED",
        created_by: user.id
      });
      await audit(db, user, "CREATE", "training_events", row.id);
      return row;
    });
    if (id) {
      const event = await get(db, "training_events", id);
      assert(!event.deleted_at, "Kegiatan tidak ditemukan.", 404);
      if (m === "GET" && !action) {
        assert(await trainingAllowed(db, user, "read", event), "Akses ditolak.", 403);
        const manage = await trainingAllowed(db, user, "participants", event);
        return {
          ...event,
          can_delete: await isSuperAdmin(db, user),
          can_upload_documentation: await trainingAllowed(db, user, "manage", event),
          can_view_documentation: await trainingAllowed(db, user, "download", event),
          participants: await asyncFilter(await all(db, "SELECT tp.*,e.full_name,e.employee_no FROM training_participants tp JOIN employees e ON e.id=tp.employee_id WHERE tp.training_event_id=? ORDER BY e.full_name", id), async (tp) => manage || await can(db, user, "hr.training.read", {
            org_unit_id: event.organizer_org_unit_id,
            employee_id: tp.employee_id
          })),
          materials: await all(db, "SELECT tm.*,dv.file_id document_file_id FROM training_materials tm LEFT JOIN document_versions dv ON dv.id=tm.document_version_id WHERE tm.training_event_id=? AND tm.usage_kind='MATERIAL'", id),
          documentation: await all(db, "SELECT f.id,f.original_name,f.mime_type,f.size_bytes,tm.title caption,tm.created_at FROM training_materials tm JOIN files f ON f.id=tm.file_id WHERE tm.training_event_id=? AND tm.usage_kind='DOCUMENTATION' AND f.status='AVAILABLE' ORDER BY tm.created_at,tm.id", id),
          certificates: (await all(db, "SELECT pc.*,tp.employee_id FROM participant_certificates pc JOIN training_participants tp ON tp.id=pc.training_participant_id WHERE tp.training_event_id=?", id)).filter((pc) => manage || pc.employee_id === user.employee_id)
        };
      }
      if (m === "DELETE" && !action) return await tx(db, async () => {
        assert(await isSuperAdmin(db, user), "Hanya Superadmin yang boleh menghapus kegiatan.", 403);
        assert(await trainingAllowed(db, user, "read", event), "Akses ditolak.", 403);
        await update(db, "training_events", id, b.row_version, {
          deleted_at: now(),
          deleted_by: user.id
        });
        await audit(db, user, "DELETE", "training_events", id, {
          title: event.title
        });
        return {
          deleted: true
        };
      });
      if (m === "POST" && action === "documentation") return await tx(db, async () => {
        assert(await trainingAllowed(db, user, "manage", event), "Akses unggah dokumentasi ditolak.", 403);
        const file = await claimFile(db, user, b.file_id);
        assert(["image/jpeg", "image/png"].includes(file.mime_type), "Dokumentasi hanya menerima foto JPG atau PNG.");
        const row = await insert(db, "training_materials", {
          training_event_id: id,
          title: text(b.caption || file.original_name, "Keterangan foto"),
          file_id: file.id,
          usage_kind: "DOCUMENTATION",
          created_by: user.id
        });
        await audit(db, user, "ADD_DOCUMENTATION", "training_events", id, {
          file_id: file.id
        });
        return row;
      });
      if (m === "PATCH" && !action) return await tx(db, async () => {
        assert(await trainingAllowed(db, user, "manage", event), "Akses ditolak.", 403);
        const row = await update(db, "training_events", id, b.row_version, {
          status: enumValue(b.status, ["PLANNED", "COMPLETED", "CANCELLED"])
        });
        await audit(db, user, "UPDATE", "training_events", id, {
          status: row.status
        });
        return row;
      });
      if (m === "PATCH" && action === "details") return await tx(db, async () => {
        assert(await trainingAllowed(db, user, "manage", event), "Akses ditolak.", 403);
        const start = instant(b.starts_at), end = instant(b.ends_at);
        assert(end > start, "Waktu selesai harus setelah waktu mulai.");
        const values = {
          title: text(b.title),
          starts_at: start,
          ends_at: end,
          location: optional2(b.location),
          description: optional2(b.description)
        };
        const row = await update(db, "training_events", id, b.row_version, values);
        await audit(db, user, "UPDATE_DETAILS", "training_events", id, { changed_fields: Object.keys(values) });
        return row;
      });
      if (m === "POST" && action === "participants") return await tx(db, async () => {
        assert(await trainingAllowed(db, user, "participants", event), "Akses ditolak.", 403);
        const bulk = b.employee_ids !== void 0, employeeIds = bulk ? b.employee_ids : [b.employee_id];
        assert(Array.isArray(employeeIds) && employeeIds.length > 0 && employeeIds.every((employeeId) => typeof employeeId === "string" && employeeId.trim().length > 0), "Pilih minimal satu peserta.");
        assert(new Set(employeeIds).size === employeeIds.length, "Daftar peserta tidak boleh berulang.");
        const items = [];
        for (const employeeId of employeeIds) {
          const ec = await employeeContext(db, (await get(db, "employees", employeeId)).id);
          await requireAccess(db, user, "hr.training.participants", ec);
          if (bulk) assert(!await one(db, "SELECT id FROM training_participants WHERE training_event_id=? AND employee_id=?", id, employeeId), "Salah satu pegawai sudah terdaftar. Muat ulang kegiatan sebelum memilih peserta.", 409);
          const row = await insert(db, "training_participants", {
            training_event_id: id,
            employee_id: employeeId,
            attendance_status: "NOT_RECORDED",
            created_by: user.id
          });
          await audit(db, user, "ADD_PARTICIPANT", "training_events", id, {
            participant_id: row.id
          });
          items.push(row);
        }
        return bulk ? {
          items
        } : items[0];
      });
      if (m === "PATCH" && action === "participants") return await tx(db, async () => {
        assert(await trainingAllowed(db, user, "participants", event), "Akses ditolak.", 403);
        const tp = await get(db, "training_participants", p[3]);
        assert(tp.training_event_id === id, "Peserta tidak sesuai.");
        const status = enumValue(b.attendance_status, ["NOT_RECORDED", "PRESENT", "ABSENT"]);
        const row = await update(db, "training_participants", tp.id, b.row_version, {
          attendance_status: status,
          attendance_notes: optional2(b.attendance_notes),
          attendance_recorded_by: status === "NOT_RECORDED" ? null : user.id,
          attendance_recorded_at: status === "NOT_RECORDED" ? null : now()
        });
        await audit(db, user, "ATTENDANCE", "training_participants", row.id, {
          attendance_status: status
        });
        return row;
      });
      if (m === "POST" && action === "materials") return await tx(db, async () => {
        assert(await trainingAllowed(db, user, "manage", event), "Akses ditolak.", 403);
        assert(Boolean(b.file_id) !== Boolean(b.document_version_id), "Pilih satu berkas atau versi dokumen.");
        if (b.file_id) await claimFile(db, user, b.file_id);
        else {
          const v = await get(db, "document_versions", b.document_version_id);
          assert(v.state !== "DRAFT" && await documentAllowed(db, user, "read", await get(db, "documents", v.document_id)), "Versi dokumen tidak tersedia.", 403);
        }
        const row = await insert(db, "training_materials", {
          training_event_id: id,
          title: text(b.title),
          file_id: b.file_id || null,
          document_version_id: b.document_version_id || null,
          created_by: user.id
        });
        await audit(db, user, "ADD_MATERIAL", "training_events", id);
        return row;
      });
      if (m === "POST" && action === "certificates") return await tx(db, async () => {
        assert(await trainingAllowed(db, user, "participants", event), "Akses ditolak.", 403);
        const tp = await get(db, "training_participants", b.training_participant_id);
        assert(tp.training_event_id === id, "Peserta tidak sesuai.");
        await claimFile(db, user, b.file_id);
        const row = await insert(db, "participant_certificates", {
          training_participant_id: tp.id,
          file_id: b.file_id,
          certificate_no: optional2(b.certificate_no),
          issued_on: b.issued_on ? date(b.issued_on) : null,
          created_by: user.id
        });
        await audit(db, user, "ADD_CERTIFICATE", "training_participants", tp.id);
        return row;
      });
    }
  }
  if (p[0] === "coaching-form-link") {
    assert(m === "GET" && p.length === 1, "Alamat tidak ditemukan.", 404);
    assert(await can(db, user, "hr.coaching.manage"), "Hanya pengelola coaching seluruh unit yang dapat mengambil tautan formulir.", 403);
    const link = await one(db, "SELECT id,label,token_hash,share_token FROM coaching_links WHERE is_active=1 AND revoked_at IS NULL");
    assert(link && typeof link.share_token === "string" && /^[a-f0-9]{64}$/.test(link.share_token) && digest(link.share_token) === link.token_hash, "Tautan formulir coaching belum tersedia. Hubungi pengelola portal.", 404);
    return { label: link.label, token: link.share_token };
  }
  if (p[0] === "coaching") {
    if (m === "GET" && !id) {
      assert(await has(db, user, "hr.coaching.read") || await has(db, user, "hr.coaching.manage"), "Akses ditolak.", 403);
      return {
        can_share_link: await can(db, user, "hr.coaching.manage"),
        items: await asyncFilter(await all(db, `SELECT s.*,e.full_name employee_name,c.full_name coach_name,(SELECT count(*) FROM coaching_actions WHERE coaching_session_id=s.id AND status<>'DONE') open_actions FROM coaching_sessions s JOIN employees e ON e.id=s.employee_id JOIN employees c ON c.id=s.coach_employee_id ORDER BY held_at DESC`), async (s) => await coachingAllowed(db, user, "read", s))
      };
    }
    if (m === "POST" && !id) return await tx(db, async () => {
      const ec = await employeeContext(db, (await get(db, "employees", b.employee_id)).id);
      await get(db, "employees", b.coach_employee_id);
      const rowData = {
        employee_id: b.employee_id,
        coach_employee_id: b.coach_employee_id,
        org_unit_id: ec.org_unit_id
      };
      assert(rowData.org_unit_id, "Pegawai belum memiliki penempatan utama.");
      assert(rowData.employee_id !== rowData.coach_employee_id, "Pembimbing harus berbeda dari pegawai.");
      assert(await coachingAllowed(db, user, "create", rowData), "Akses pencatatan coaching ditolak.", 403);
      const row = await insert(db, "coaching_sessions", {
        ...rowData,
        held_at: instant(b.held_at),
        topic: text(b.topic),
        guidance_notes: text(b.guidance_notes, "Arahan", 1e4),
        constraints_notes: optional2(b.constraints_notes),
        agreement_notes: optional2(b.agreement_notes),
        created_by: user.id
      });
      await audit(db, user, "CREATE", "coaching_sessions", row.id);
      return row;
    });
    if (id) {
      const session = await get(db, "coaching_sessions", id);
      if (m === "GET" && !action) {
        assert(await coachingAllowed(db, user, "read", session), "Akses coaching ditolak.", 403);
        return {
          ...session,
          employee_name: (await get(db, "employees", session.employee_id)).full_name,
          coach_name: (await get(db, "employees", session.coach_employee_id)).full_name,
          actions: await all(db, "SELECT a.*,e.full_name responsible_name FROM coaching_actions a JOIN employees e ON e.id=a.responsible_employee_id WHERE coaching_session_id=? ORDER BY a.created_at", id),
          files: await linkedFiles(db, "coaching", id),
          held_date_only: Boolean(await one(db, "SELECT id FROM coaching_form_submissions WHERE coaching_session_id=?", id))
        };
      }
      if (m === "POST" && action === "actions") return await tx(db, async () => {
        assert(await coachingAllowed(db, user, "update", session), "Akses ditolak.", 403);
        await get(db, "employees", b.responsible_employee_id);
        const row = await insert(db, "coaching_actions", {
          coaching_session_id: id,
          responsible_employee_id: b.responsible_employee_id,
          action_text: text(b.action_text, "Tindak lanjut", 3e3),
          due_on: b.due_on ? date(b.due_on) : null,
          status: "OPEN",
          created_by: user.id
        });
        await audit(db, user, "ADD_ACTION", "coaching_sessions", id);
        return row;
      });
      if (m === "PATCH" && action === "actions") return await tx(db, async () => {
        assert(await coachingAllowed(db, user, "update", session), "Akses ditolak.", 403);
        const a = await get(db, "coaching_actions", p[3]);
        assert(a.coaching_session_id === id, "Tindak lanjut tidak sesuai.");
        const status = enumValue(b.status, ["OPEN", "IN_PROGRESS", "DONE"]);
        const row = await update(db, "coaching_actions", a.id, b.row_version, {
          status,
          progress_notes: optional2(b.progress_notes),
          completion_notes: status === "DONE" ? text(b.completion_notes, "Hasil penyelesaian", 5e3) : null,
          completed_at: status === "DONE" ? now() : null
        });
        await audit(db, user, "ACTION_UPDATED", "coaching_actions", a.id, {
          status
        });
        return row;
      });
    }
  }
  if (p[0] === "imports") {
    await requireAccess(db, user, "hr.employees.create");
    if (m === "GET" && !id) return {
      items: await all(db, "SELECT * FROM import_candidates WHERE status='PENDING' ORDER BY org_path,full_name")
    };
    if (m === "POST" && id) return await tx(db, async () => {
      const candidate = await get(db, "import_candidates", id);
      assert(candidate.status === "PENDING", "Baris telah ditinjau.", 409);
      const saved = await insert(db, "employees", {
        employee_no: text(b.employee_no, "Nomor pegawai", 60).toUpperCase(),
        full_name: text(b.full_name || candidate.full_name),
        employment_status: text(b.employment_status, "Status kepegawaian"),
        joined_on: date(b.joined_on),
        is_active: 1,
        created_by: user.id
      });
      await placement(db, user, saved.id, {
        position_id: b.position_id,
        valid_from: b.valid_from || b.joined_on,
        supervisor_employee_id: b.supervisor_employee_id
      }, "hr.employees.create");
      await update(db, "import_candidates", id, b.row_version, {
        status: "IMPORTED",
        employee_id: saved.id
      });
      await audit(db, user, "IMPORT_REVIEWED", "employees", saved.id, {
        source_cell: candidate.source_cell,
        source_name: candidate.source_name
      });
      return saved;
    });
  }
  return void 0;
}
var fresh = (value) => {
  const stamp = instant(value);
  assert(Date.parse(stamp) >= Date.now() - 15 * 6e4 && Date.parse(stamp) <= Date.now() + 6e4, "Lokasi atau foto sudah kedaluwarsa. Ambil lokasi dan foto kembali.");
  return stamp;
};
async function fieldReportPayload(db, user, b, incident = false) {
  assert(user.employee_id, "Akun Anda belum terhubung dengan profil pegawai. Hubungi Admin/SDM.", 403);
  const employee = await get(db, "employees", user.employee_id);
  assert(employee.is_active, "Profil pegawai tidak aktif.", 403);
  for (const key of ["employee_id", "reporter_employee_id"]) assert(!b[key] || b[key] === user.employee_id, "Identitas pelapor harus sesuai akun yang sedang login.", 403);
  assert(!b.post_id, "Formulir pelaporan sudah diperbarui. Muat ulang halaman.");
  const ctx = await employeeContext(db, employee.id);
  await requireAccess(db, user, incident ? "security.incidents.create" : "security.logbook.create", {
    ...ctx,
    reporter_employee_id: employee.id
  });
  return fieldReportDetails(b, employee.id, ctx.org_unit_id, incident);
}
function fieldReportDetails(b, employeeId, orgUnitId, incident = false, allowNamedLocation = false) {
  const location = b.location, locationName = allowNamedLocation && b.location_name !== void 0 ? text(b.location_name, "Nama tempat / lokasi patroli", 200) : null;
  assert(location != null || locationName, allowNamedLocation ? "Isi nama tempat / lokasi patroli atau ambil lokasi perangkat sebelum laporan dikirim." : "Lokasi perangkat wajib berhasil didapatkan sebelum laporan dikirim.");
  if (location != null) assert(typeof location === "object" && !Array.isArray(location), "Koordinat atau akurasi lokasi tidak valid.");
  const numeric = (value, min, max) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
  if (location != null) assert(numeric(location.latitude, -90, 90) && numeric(location.longitude, -180, 180) && numeric(location.accuracy, 0, 1e7), "Koordinat atau akurasi lokasi tidak valid.");
  assert(Array.isArray(b.photos) && b.photos.length >= 1 && b.photos.length <= 5, "Ambil minimal satu dan maksimal lima foto melalui kamera aplikasi.");
  const photos = b.photos.map((photo) => {
    assert(photo && photo.source === "CAMERA", "Foto wajib diambil melalui kamera aplikasi.");
    return { file_id: text(photo.file_id, "Berkas foto", 100), captured_at: fresh(photo.captured_at), capture_source: "CAMERA" };
  });
  assert(new Set(photos.map((p) => p.file_id)).size === photos.length, "Foto yang sama tidak dapat digunakan berulang.");
  const payload = { post_id: null, reporting_org_unit_id: orgUnitId || null, latitude: location?.latitude ?? null, longitude: location?.longitude ?? null, location_accuracy: location?.accuracy ?? null, location_captured_at: location ? fresh(location.captured_at) : null, ...locationName ? { location_name: locationName } : {}, occurred_at: instant(b.occurred_at) };
  if (incident) Object.assign(payload, { reporter_employee_id: employeeId, incident_type: text(b.incident_type, "Kategori kejadian", 200), chronology: text(b.chronology, "Kronologi", 2e4), initial_action: null, source_logbook_entry_id: b.source_logbook_entry_id || null });
  else Object.assign(payload, { employee_id: employeeId, activity_type: b.activity_type, activity_notes: text(b.activity_notes, "Uraian kegiatan", 1e4), findings: null, roster_assignment_id: null });
  return { payload, photos, key: text(b.idempotency_key, "Kunci permintaan", 100), fingerprint: digest(JSON.stringify({ payload, photos })) };
}
async function attachEvidence(db, user, kind, id, photos) {
  for (const photo of photos) {
    const file = await claimFile(db, user, photo.file_id);
    assert(["image/png", "image/jpeg"].includes(file.mime_type), "Bukti kamera harus berupa foto JPG atau PNG.");
    assert(Date.parse(file.created_at) >= Date.now() - 15 * 6e4, "Foto unggahan sudah kedaluwarsa. Ambil foto kembali.");
    await insert(db, kind === "incident" ? "incident_files" : "logbook_files", {
      [kind === "incident" ? "incident_id" : "logbook_entry_id"]: id,
      ...photo,
      caption: "Foto bukti dari kamera",
      created_by: user.id
    });
  }
}
var configTables = {
  groups: "security_groups",
  posts: "security_posts",
  shifts: "shift_definitions",
  members: "security_group_members",
  eligibility: "employee_post_eligibility",
  unavailability: "employee_unavailability",
  rules: "scheduling_rule_versions",
  patterns: "roster_pattern_versions",
  bindings: "employee_rotation_bindings",
  requirements: "staffing_requirements",
  overrides: "staffing_overrides"
};
var opt = (v) => typeof v === "string" ? v.trim().slice(0, 5e3) || null : null;
async function configContext(db, key, r) {
  if (r.post_id) return await postContext(db, r.post_id);
  if (key === "posts") return {
    ...r,
    post_id: r.id
  };
  if (r.security_group_id) return {
    org_unit_id: (await get(db, "security_groups", r.security_group_id)).org_unit_id
  };
  if (r.employee_id) return await employeeContext(db, r.employee_id);
  return {
    org_unit_id: r.org_unit_id
  };
}
async function rangeOverlap(db, table, where, args, from, to, startKey = "valid_from", endKey = "valid_to", exclude = "") {
  assert(!await one(db, `SELECT id FROM ${table} WHERE ${where} AND ${startKey}<=? AND (${endKey} IS NULL OR ${endKey}>=?) AND id<>?`, ...args, to || "9999-12-31", from, exclude), "Rentang aktif bertumpang tindih.");
}
async function configPayload(db, user, key, b, old) {
  const r = {};
  if (["groups", "posts", "shifts", "rules", "patterns"].includes(key)) {
    await get(db, "org_units", b.org_unit_id);
    r.org_unit_id = b.org_unit_id;
    assert(!old || old.org_unit_id === r.org_unit_id, "Unit master tidak dapat dipindahkan.");
  }
  if (["groups", "posts", "shifts"].includes(key)) {
    r.code = text(b.code, "Kode", 64).toUpperCase();
    r.name = text(b.name, "Nama", 200);
    r.is_active = b.is_active === void 0 ? 1 : Number(Boolean(b.is_active));
  }
  if (key === "posts") {
    r.home_group_id = b.home_group_id || null;
    r.location_notes = opt(b.location_notes);
    if (r.home_group_id) assert((await get(db, "security_groups", r.home_group_id)).org_unit_id === r.org_unit_id, "Kelompok pengelola harus sesuai unit pos.");
  }
  if (key === "shifts") {
    r.start_time = text(b.start_time);
    r.end_time = text(b.end_time);
    r.end_day_offset = integer(b.end_day_offset, "Pergantian hari", 0, 1);
    assert([r.start_time, r.end_time].every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)), "Format jam harus HH:mm.");
    const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    const duration = minutes(r.end_time) + r.end_day_offset * 1440 - minutes(r.start_time);
    assert(duration > 0 && duration <= 1440, "Durasi shift harus lebih dari 0 dan maksimal 24 jam.");
  }
  if (["members", "eligibility", "unavailability", "bindings"].includes(key)) {
    await get(db, "employees", b.employee_id);
    r.employee_id = b.employee_id;
  }
  if (["members", "eligibility"].includes(key)) {
    r.valid_from = date(b.valid_from);
    r.valid_to = b.valid_to ? date(b.valid_to) : null;
    assert(!r.valid_to || r.valid_to >= r.valid_from, "Rentang tanggal tidak valid.");
    const fk = key === "members" ? "security_group_id" : "post_id";
    r[fk] = b[fk];
    await get(db, key === "members" ? "security_groups" : "security_posts", b[fk]);
    await rangeOverlap(db, configTables[key], `${fk}=? AND employee_id=?`, [r[fk], r.employee_id], r.valid_from, r.valid_to, "valid_from", "valid_to", old?.id || "");
    if (key === "eligibility") r.notes = opt(b.notes);
  }
  if (key === "unavailability") {
    r.starts_at = instant(b.starts_at);
    r.ends_at = instant(b.ends_at);
    assert(r.ends_at > r.starts_at, "Waktu selesai harus setelah waktu mulai.");
    r.reason = text(b.reason);
    r.notes = opt(b.notes);
    r.recorded_by = user.id;
  }
  if (["rules", "patterns"].includes(key)) {
    r.version_no = integer(b.version_no, "Nomor versi", 1);
    r.is_active = 1;
    r.notes = opt(b.notes);
    assert(!old, "Master versi tidak diubah. Tambahkan versi baru.");
  }
  if (key === "rules") for (const field of ["min_rest_minutes", "max_consecutive_work_days", "max_work_minutes_per_local_day", "max_work_minutes_rolling_7_days"]) r[field] = integer(b[field], field, 1, field === "max_consecutive_work_days" ? 365 : field === "max_work_minutes_per_local_day" ? 1440 : 10080);
  if (key === "patterns") {
    r.pattern_code = text(b.pattern_code, "Kode pola", 64).toUpperCase();
    r.name = text(b.name);
    r.cycle_length_days = integer(b.cycle_length_days, "Jumlah hari siklus", 1, 366);
    assert(Array.isArray(b.steps) && b.steps.length === r.cycle_length_days, "Langkah pola harus lengkap untuk setiap hari.");
    for (const step of b.steps) {
      enumValue(step.step_kind, ["WORK", "REST"]);
      if (step.step_kind === "WORK") {
        assert((await get(db, "shift_definitions", step.shift_id)).org_unit_id === r.org_unit_id, "Shift pola harus sesuai unit.");
        if (step.post_id) assert((await get(db, "security_posts", step.post_id)).org_unit_id === r.org_unit_id, "Pos pola harus sesuai unit.");
      }
    }
  }
  if (key === "bindings") {
    assert(!old, "Binding immutable. Tambahkan binding bertanggal efektif baru.");
    const pattern = await get(db, "roster_pattern_versions", b.pattern_version_id);
    r.pattern_version_id = pattern.id;
    r.anchor_date = date(b.anchor_date);
    r.phase_offset_days = integer(b.phase_offset_days, "Fase", 0, pattern.cycle_length_days - 1);
    r.effective_from = date(b.effective_from);
    r.notes = opt(b.notes);
  }
  if (["requirements", "overrides"].includes(key)) {
    r.post_id = (await get(db, "security_posts", b.post_id)).id;
    r.shift_id = (await get(db, "shift_definitions", b.shift_id)).id;
    assert((await get(db, "security_posts", r.post_id)).org_unit_id === (await get(db, "shift_definitions", r.shift_id)).org_unit_id, "Pos dan shift harus sesuai unit.");
    r.is_active = b.is_active === void 0 ? 1 : Number(Boolean(b.is_active));
    if (key === "requirements") {
      r.weekday_no = integer(b.weekday_no, "Hari", 1, 7);
      r.required_count = integer(b.required_count, "Kebutuhan", 0, 200);
      r.effective_from = date(b.effective_from);
      r.effective_to = b.effective_to ? date(b.effective_to) : null;
      assert(!r.effective_to || r.effective_to >= r.effective_from, "Rentang tanggal tidak valid.");
      if (r.is_active) await rangeOverlap(db, configTables[key], "post_id=? AND shift_id=? AND weekday_no=? AND is_active=1", [r.post_id, r.shift_id, r.weekday_no], r.effective_from, r.effective_to, "effective_from", "effective_to", old?.id || "");
    } else {
      r.starts_on = date(b.starts_on);
      r.ends_on = date(b.ends_on);
      assert(r.ends_on >= r.starts_on, "Rentang penyesuaian tidak valid.");
      r.replacement_required_count = integer(b.replacement_required_count, "Kebutuhan pengganti", 0, 200);
      r.reason = text(b.reason);
      if (r.is_active) await rangeOverlap(db, configTables[key], "post_id=? AND shift_id=? AND is_active=1", [r.post_id, r.shift_id], r.starts_on, r.ends_on, "starts_on", "ends_on", old?.id || "");
    }
  }
  return r;
}
async function securityRoutes(c) {
  const { db, user, p, method: m, body: b, url } = c;
  const id = p[1], action = p[2];
  if (p[0] === "config" && p[1]) {
    const key = p[1], table = configTables[key];
    assert(table, "Jenis pengaturan tidak dikenal.", 404);
    if (m === "GET") {
      assert(await has(db, user, "security.config.read"), "Akses ditolak.", 403);
      return {
        items: await asyncMap(await asyncFilter(await all(db, `SELECT * FROM ${table} ORDER BY created_at DESC`), async (r) => await can(db, user, "security.config.read", await configContext(db, key, r))), async (r) => key === "patterns" ? {
          ...r,
          steps: await all(db, "SELECT * FROM roster_pattern_steps WHERE pattern_version_id=? ORDER BY cycle_day_no", r.id)
        } : r)
      };
    }
    if (["POST", "PATCH"].includes(m)) return await tx(db, async () => {
      const old = p[2] ? await get(db, table, p[2]) : null;
      if (old) await requireAccess(db, user, "security.config.manage", await configContext(db, key, old));
      const row = await configPayload(db, user, key, b, old);
      await requireAccess(db, user, "security.config.manage", await configContext(db, key, {
        ...old,
        ...row
      }));
      if (key === "eligibility") await requireAccess(db, user, "security.config.manage", await employeeContext(db, row.employee_id));
      const saved = old ? await update(db, table, old.id, b.row_version, row) : await insert(db, table, {
        ...row,
        created_by: user.id
      });
      if (key === "patterns") await asyncForEach(b.steps, async (s, i) => await insert(db, "roster_pattern_steps", {
        pattern_version_id: saved.id,
        cycle_day_no: i + 1,
        step_kind: s.step_kind,
        shift_id: s.step_kind === "WORK" ? s.shift_id : null,
        post_id: s.step_kind === "WORK" ? s.post_id || null : null,
        created_by: user.id
      }));
      await audit(db, user, old ? "UPDATE" : "CREATE", table, saved.id);
      return saved;
    });
  }
  if (p[0] === "logbook") {
    if (m === "GET" && !id) {
      assert(await has(db, user, "security.logbook.read"), "Akses ditolak.", 403);
      return {
        items: await asyncFilter(await all(db, "SELECT l.*,e.full_name employee_name,p.name post_name FROM logbook_entries l JOIN employees e ON e.id=l.employee_id LEFT JOIN security_posts p ON p.id=l.post_id ORDER BY occurred_at DESC"), async (l) => await can(db, user, "security.logbook.read", await reportContext(db, l)))
      };
    }
    if (m === "POST" && !id) return await tx(db, async () => {
      const { payload, photos, key, fingerprint } = await fieldReportPayload(db, user, b);
      enumValue(payload.activity_type, ["JAGA", "PATROLI", "LAINNYA"]);
      const previous = await one(db, "SELECT * FROM logbook_entries WHERE idempotency_key=?", key);
      if (previous) {
        assert(previous.created_by === user.id && previous.request_fingerprint === fingerprint, "Kunci permintaan sudah dipakai untuk laporan berbeda.", 409);
        return previous;
      }
      const row = await insert(db, "logbook_entries", {
        ...payload,
        idempotency_key: key,
        request_fingerprint: fingerprint,
        created_by: user.id
      });
      await attachEvidence(db, user, "logbook", row.id, photos);
      await audit(db, user, "CREATE", "logbook_entries", row.id);
      return row;
    });
    if (id) {
      const log = await get(db, "logbook_entries", id), ctx = await reportContext(db, log);
      if (m === "GET" && !action) {
        await requireAccess(db, user, "security.logbook.read", ctx);
        return {
          ...log,
          employee_name: (await get(db, "employees", log.employee_id)).full_name,
          post_name: log.post_id ? (await get(db, "security_posts", log.post_id)).name : null,
          files: await linkedFiles(db, "logbook", id),
          incidents: await asyncFilter(await all(db, "SELECT * FROM incidents WHERE source_logbook_entry_id=?", id), async (i) => await can(db, user, "security.incidents.read", await reportContext(db, i)))
        };
      }
      if (m === "PATCH" && !action) return await tx(db, async () => {
        await requireAccess(db, user, "security.logbook.update", ctx);
        const values = {
          activity_notes: text(b.activity_notes, "Uraian", 1e4)
        };
        if (log.latitude == null && log.report_source !== "PUBLIC_LINK" && b.findings !== void 0) values.findings = opt(b.findings);
        const row = await update(db, "logbook_entries", id, b.row_version, values);
        await audit(db, user, "UPDATE", "logbook_entries", id);
        return row;
      });
    }
  }
  if (p[0] === "incidents") {
    if (m === "GET" && !id) {
      assert(await has(db, user, "security.incidents.read"), "Akses ditolak.", 403);
      return {
        items: await asyncFilter(await all(db, "SELECT i.*,p.name post_name,e.full_name reporter_name,r.full_name responsible_name FROM incidents i LEFT JOIN security_posts p ON p.id=i.post_id JOIN employees e ON e.id=i.reporter_employee_id LEFT JOIN employees r ON r.id=i.responsible_employee_id ORDER BY i.occurred_at DESC"), async (i) => await can(db, user, "security.incidents.read", await reportContext(db, i)))
      };
    }
    if (m === "POST" && !id) return await tx(db, async () => {
      const { payload, photos, key, fingerprint } = await fieldReportPayload(db, user, b, true);
      const previous = await one(db, "SELECT * FROM incidents WHERE idempotency_key=?", key);
      if (previous) {
        assert(previous.created_by === user.id && previous.request_fingerprint === fingerprint, "Kunci permintaan sudah dipakai untuk laporan berbeda.", 409);
        return previous;
      }
      if (payload.source_logbook_entry_id) {
        const log = await get(db, "logbook_entries", payload.source_logbook_entry_id);
        await requireAccess(db, user, "security.logbook.read", await reportContext(db, log));
      }
      const count = (await one(db, "SELECT count(*) count FROM incidents")).count + 1;
      const row = await insert(db, "incidents", {
        ...payload,
        request_fingerprint: fingerprint,
        incident_no: `INC-${today().replaceAll("-", "")}-${String(count).padStart(4, "0")}`,
        idempotency_key: key,
        status: "RECORDED",
        created_by: user.id
      });
      await attachEvidence(db, user, "incident", row.id, photos);
      await insert(db, "incident_updates", {
        incident_id: row.id,
        actor_user_id: user.id,
        event_type: "CREATED",
        notes: "Laporan dicatat.",
        to_status: "RECORDED"
      });
      await audit(db, user, "CREATE", "incidents", row.id);
      return row;
    });
    if (id) {
      const incident = await get(db, "incidents", id), ctx = await reportContext(db, incident);
      if (m === "GET" && !action) {
        await requireAccess(db, user, "security.incidents.read", ctx);
        return {
          ...incident,
          post_name: incident.post_id ? (await get(db, "security_posts", incident.post_id)).name : null,
          reporter_name: (await get(db, "employees", incident.reporter_employee_id)).full_name,
          responsible_name: incident.responsible_employee_id ? (await get(db, "employees", incident.responsible_employee_id)).full_name : null,
          updates: await all(db, "SELECT iu.*,u.username actor_name FROM incident_updates iu JOIN users u ON u.id=iu.actor_user_id WHERE incident_id=? ORDER BY iu.created_at,iu.rowid", id),
          files: await linkedFiles(db, "incident", id)
        };
      }
      if (m === "POST" && action === "updates") return await tx(db, async () => {
        await requireAccess(db, user, "security.incidents.update", ctx);
        assert(b.row_version === incident.row_version, "Laporan berubah. Muat ulang.", 409);
        const notes = text(b.notes, "Catatan perkembangan", 1e4);
        const status = b.status || incident.status;
        enumValue(status, ["RECORDED", "IN_PROGRESS", "RESOLVED"]);
        const responsible = b.responsible_employee_id || incident.responsible_employee_id;
        if (responsible) await get(db, "employees", responsible);
        const reopen = incident.status === "RESOLVED" && status === "IN_PROGRESS";
        if (reopen) await requireAccess(db, user, "security.incidents.reopen", ctx);
        assert(status === incident.status || incident.status === "RECORDED" && status === "IN_PROGRESS" || incident.status === "IN_PROGRESS" && status === "RESOLVED" || reopen, "Transisi status tidak diizinkan.");
        assert(status === "RECORDED" || responsible, "Penanggung jawab wajib ditetapkan.");
        const row = await update(db, "incidents", id, b.row_version, {
          status,
          responsible_employee_id: responsible || null,
          resolved_at: status === "RESOLVED" ? incident.resolved_at || now() : null,
          resolution_notes: status === "RESOLVED" ? incident.status === "RESOLVED" ? incident.resolution_notes : notes : null
        });
        await insert(db, "incident_updates", {
          incident_id: id,
          actor_user_id: user.id,
          event_type: reopen ? "REOPENED" : status !== incident.status ? "STATUS_CHANGED" : responsible !== incident.responsible_employee_id ? "RESPONSIBLE_CHANGED" : "NOTE",
          notes,
          from_status: status !== incident.status ? incident.status : null,
          to_status: status !== incident.status ? status : null,
          new_responsible_employee_id: responsible !== incident.responsible_employee_id ? responsible : null
        });
        await audit(db, user, reopen ? "REOPEN" : "UPDATE", "incidents", id, {
          from_status: incident.status,
          to_status: status
        });
        return row;
      });
    }
  }
  return void 0;
}
var GENERATOR_VERSION = "besakih-rotation/1.0";
var DAY = 864e5;
var MIN = 6e4;
var addDays2 = (day, n) => new Date(Date.parse(day) + n * DAY).toISOString().slice(0, 10);
var localDate = (value) => new Date(Date.parse(value) + 8 * 36e5).toISOString().slice(0, 10);
function days(from, to) {
  const result = [];
  for (let d = from; d <= to; d = addDays2(d, 1)) result.push(d);
  return result;
}
function shiftInterval(day, shift) {
  return {
    starts_at: (/* @__PURE__ */ new Date(`${day}T${shift.start_time}:00+08:00`)).toISOString(),
    ends_at: (/* @__PURE__ */ new Date(`${addDays2(day, shift.end_day_offset)}T${shift.end_time}:00+08:00`)).toISOString()
  };
}
function cycleDay(binding, day, length) {
  return ((Math.round((Date.parse(day) - Date.parse(binding.anchor_date)) / DAY) + binding.phase_offset_days) % length + length) % length + 1;
}
var overlaps = (a, b) => a.starts_at < b.ends_at && b.starts_at < a.ends_at;
function covers(row, a) {
  const start = localDate(a.starts_at), end = localDate(new Date(Date.parse(a.ends_at) - 1).toISOString());
  return row.valid_from <= start && (!row.valid_to || row.valid_to >= end);
}
function dailySlices(a) {
  const out = [];
  let cursor = Date.parse(a.starts_at), end = Date.parse(a.ends_at);
  while (cursor < end) {
    const day = localDate(new Date(cursor).toISOString()), next = Date.parse(`${addDays2(day, 1)}T00:00:00+08:00`), stop = Math.min(next, end);
    out.push([day, (stop - cursor) / MIN]);
    cursor = stop;
  }
  return out;
}
function workErrors(local, external, rules) {
  if (!local.length) return [];
  const localIds = new Set(local.map((a, i) => a.id || `local-${i}`));
  const items = [...external.map((a) => ({
    ...a,
    isLocal: false
  })), ...local.map((a) => ({
    ...a,
    isLocal: true
  }))].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const errors = [];
  for (let i = 1; i < items.length; i++) {
    const before = items[i - 1], after = items[i];
    if (!before.isLocal && !after.isLocal) continue;
    if (overlaps(before, after)) errors.push("Penugasan bertabrakan.");
    else if ((Date.parse(after.starts_at) - Date.parse(before.ends_at)) / MIN < rules.min_rest_minutes) errors.push("Jeda istirahat minimum belum terpenuhi.");
  }
  const byDay = /* @__PURE__ */ new Map(), localDays = /* @__PURE__ */ new Set();
  for (const a of items) for (const [day, minutes] of dailySlices(a)) {
    byDay.set(day, (byDay.get(day) || 0) + minutes);
    if (a.isLocal) localDays.add(day);
  }
  for (const day of localDays) if (byDay.get(day) > rules.max_work_minutes_per_local_day) errors.push(`Batas menit kerja harian terlampaui (${day}).`);
  const windowEnds = new Set([...localDays].flatMap((d) => Array.from({
    length: 7
  }, (_, i) => addDays2(d, i))));
  for (const end of windowEnds) {
    let minutes = 0;
    for (let i = 0; i < 7; i++) minutes += byDay.get(addDays2(end, -i)) || 0;
    if (minutes > rules.max_work_minutes_rolling_7_days) {
      errors.push("Batas menit kerja dalam tujuh hari terlampaui.");
      break;
    }
  }
  let chain = [], prev = null;
  const check = () => {
    if (chain.length > rules.max_consecutive_work_days && chain.some((d) => localDays.has(d))) errors.push("Batas hari kerja berturut-turut terlampaui.");
  };
  for (const day of [...byDay.keys()].sort()) {
    if (prev && day !== addDays2(prev, 1)) {
      check();
      chain = [];
    }
    chain.push(day);
    prev = day;
  }
  check();
  return [...new Set(errors)];
}
function routineStep(snapshot, employeeId, day) {
  const binding = snapshot.bindings.filter((b) => b.employee_id === employeeId && b.effective_from <= day).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  if (!binding) return null;
  const pattern = snapshot.patterns.find((p) => p.id === binding.pattern_version_id);
  if (!pattern) return null;
  const step = pattern.steps.find((s) => s.cycle_day_no === cycleDay(binding, day, pattern.cycle_length_days));
  return {
    binding,
    pattern,
    step
  };
}
function assignmentErrors(snapshot, a) {
  const errors = [], employee = snapshot.employees.find((e) => e.id === a.employee_id), post = snapshot.posts.find((p) => p.id === a.post_id), shift = snapshot.shifts.find((s) => s.id === a.shift_id);
  if (!employee || !employee.is_active || employee.joined_on > a.service_date || employee.ended_on && employee.ended_on < localDate(new Date(Date.parse(a.ends_at) - 1).toISOString())) errors.push("Pegawai tidak aktif atau di luar masa kerja.");
  if (!post?.is_active || !snapshot.post_ids.includes(a.post_id)) errors.push("Pos di luar cakupan atau tidak aktif.");
  if (!shift?.is_active || shift.org_unit_id !== post?.org_unit_id) errors.push("Shift tidak sah untuk pos.");
  if (shift) {
    const expected = shiftInterval(a.service_date, shift);
    if (expected.starts_at !== a.starts_at || expected.ends_at !== a.ends_at) errors.push("Interval tidak cocok dengan snapshot shift.");
  }
  if (a.service_date < snapshot.period.starts_on || a.service_date > snapshot.period.ends_on) errors.push("Tanggal di luar periode.");
  if (!snapshot.members.some((m) => m.employee_id === a.employee_id && covers(m, a))) errors.push("Keanggotaan kelompok tidak berlaku sepanjang tugas.");
  if (!snapshot.eligibility.some((e) => e.employee_id === a.employee_id && e.post_id === a.post_id && covers(e, a))) errors.push("Kelayakan pos tidak berlaku sepanjang tugas.");
  if (snapshot.unavailability.some((u) => u.employee_id === a.employee_id && overlaps(u, a))) errors.push("Petugas tidak tersedia.");
  if (a.origin === "ROUTINE") {
    const routine = routineStep(snapshot, a.employee_id, a.service_date);
    if (!routine?.step || routine.step.step_kind !== "WORK" || routine.step.shift_id !== a.shift_id || routine.step.post_id && routine.step.post_id !== a.post_id) errors.push("Penugasan tidak sesuai langkah rotasi rutin.");
  }
  if (a.origin === "TEMPORARY" && !snapshot.overrides.some((o) => o.id === a.source_override_id && o.post_id === a.post_id && o.shift_id === a.shift_id && o.starts_on <= a.service_date && o.ends_on >= a.service_date)) errors.push("Sumber penyesuaian tidak sesuai.");
  if (a.origin === "MANUAL" && !a.manual_change_reason?.trim()) errors.push("Alasan perubahan manual wajib.");
  return errors;
}
function validateAssignments(snapshot, assignments) {
  const errors = [];
  for (const a of assignments) for (const message of assignmentErrors(snapshot, a)) errors.push({
    assignment_id: a.id,
    employee_id: a.employee_id,
    service_date: a.service_date,
    message
  });
  for (const employeeId of new Set(assignments.map((a) => a.employee_id))) {
    const local = assignments.filter((a) => a.employee_id === employeeId), external = snapshot.external.filter((a) => a.employee_id === employeeId);
    for (const message of workErrors(local, external, snapshot.rules)) errors.push({
      employee_id: employeeId,
      message
    });
  }
  return errors;
}
function generateAssignments(snapshot, retained = [], seed = "0", range) {
  const assignments = retained.map((a) => ({
    ...a
  }));
  const rejected = [];
  const order = snapshot.employees.map((e) => e.id).sort((a, b) => digest(seed + a).localeCompare(digest(seed + b)));
  for (const slot of snapshot.slots) {
    if (range && (slot.service_date < range.starts_on || slot.service_date > range.ends_on)) continue;
    const current = () => assignments.filter((a) => a.post_id === slot.post_id && a.shift_id === slot.shift_id && a.service_date === slot.service_date).length;
    const candidates = order.map((id, index) => ({
      id,
      index,
      count: assignments.filter((a) => a.employee_id === id).length
    })).sort((a, b) => a.count - b.count || a.index - b.index);
    for (const candidate of candidates) {
      if (current() >= slot.required_count) break;
      const routine = routineStep(snapshot, candidate.id, slot.service_date);
      const isRoutine = routine?.step?.step_kind === "WORK" && routine.step.shift_id === slot.shift_id && (!routine.step.post_id || routine.step.post_id === slot.post_id);
      if (!isRoutine && !slot.source_override_id) continue;
      const shift = snapshot.shifts.find((s) => s.id === slot.shift_id);
      if (!shift) continue;
      const a = {
        employee_id: candidate.id,
        post_id: slot.post_id,
        shift_id: slot.shift_id,
        service_date: slot.service_date,
        ...shiftInterval(slot.service_date, shift),
        origin: isRoutine ? "ROUTINE" : "TEMPORARY",
        source_override_id: isRoutine ? null : slot.source_override_id,
        is_locked: 0
      };
      const errors = [...assignmentErrors(snapshot, a), ...workErrors([...assignments.filter((x) => x.employee_id === candidate.id), a], snapshot.external.filter((x) => x.employee_id === candidate.id), snapshot.rules)];
      if (!errors.length) assignments.push(a);
      else if (rejected.length < 300) rejected.push({
        service_date: slot.service_date,
        post_id: slot.post_id,
        shift_id: slot.shift_id,
        employee_id: candidate.id,
        reasons: [...new Set(errors)]
      });
    }
  }
  const gaps = snapshot.slots.map((s) => ({
    ...s,
    assigned_count: assignments.filter((a) => a.post_id === s.post_id && a.shift_id === s.shift_id && a.service_date === s.service_date).length
  })).filter((s) => s.assigned_count < s.required_count);
  return {
    assignments,
    gaps,
    rejected,
    errors: validateAssignments(snapshot, assignments)
  };
}
async function periodPosts(db, periodId) {
  return (await all(db, "SELECT post_id FROM scheduling_period_posts WHERE scheduling_period_id=? ORDER BY post_id", periodId)).map((r) => r.post_id);
}
async function requirePeriod(db, user, permission, periodId) {
  const posts = await periodPosts(db, periodId);
  assert(posts.length, "Periode tidak memiliki pos.");
  for (const id of posts) await requireAccess(db, user, permission, await postContext(db, id));
  return posts;
}
async function buildSnapshot(db, periodId, rulesId) {
  const period = await get(db, "scheduling_periods", periodId), postIds = await periodPosts(db, periodId), rules = await get(db, "scheduling_rule_versions", rulesId);
  assert(rules.org_unit_id === period.org_unit_id && rules.is_active, "Aturan harus aktif dan sesuai unit periode.");
  const posts = await asyncMap(postIds, async (id) => await get(db, "security_posts", id));
  assert(posts.every((p) => p.org_unit_id === period.org_unit_id && p.is_active), "Pos periode harus aktif dan sesuai unit.");
  const shifts = await all(db, "SELECT * FROM shift_definitions WHERE org_unit_id=? AND is_active=1 ORDER BY id", period.org_unit_id);
  assert(shifts.length, "Konfigurasi shift belum tersedia.");
  const requirements = (await all(db, "SELECT * FROM staffing_requirements WHERE is_active=1 ORDER BY id")).filter((r) => postIds.includes(r.post_id));
  const overrides = (await all(db, "SELECT * FROM staffing_overrides WHERE is_active=1 ORDER BY id")).filter((r) => postIds.includes(r.post_id) && r.ends_on >= period.starts_on && r.starts_on <= period.ends_on);
  const slots = [];
  for (const day of days(period.starts_on, period.ends_on)) for (const postId of postIds) for (const shift of shifts) {
    const weekday = new Date(day).getUTCDay() || 7, required = requirements.filter((r) => r.post_id === postId && r.shift_id === shift.id && r.weekday_no === weekday && r.effective_from <= day && (!r.effective_to || r.effective_to >= day));
    assert(required.length === 1, `Kebutuhan rutin belum lengkap atau bertumpang tindih: ${day}, ${(await get(db, "security_posts", postId)).name}, ${shift.name}. Isi juga kebutuhan nol.`);
    const override = overrides.find((o) => o.post_id === postId && o.shift_id === shift.id && o.starts_on <= day && o.ends_on >= day);
    slots.push({
      service_date: day,
      post_id: postId,
      shift_id: shift.id,
      required_count: override ? override.replacement_required_count : required[0].required_count,
      source_override_id: override?.id || null
    });
  }
  const groups = await all(db, "SELECT * FROM security_groups WHERE is_active=1 ORDER BY id");
  const snapshot = {
    schema_version: 1,
    generator_version: GENERATOR_VERSION,
    period: {
      id: period.id,
      starts_on: period.starts_on,
      ends_on: period.ends_on,
      org_unit_id: period.org_unit_id
    },
    post_ids: postIds,
    rules,
    posts,
    shifts,
    slots,
    overrides,
    requirements,
    employees: await all(db, "SELECT id,employee_no,full_name,is_active,joined_on,ended_on FROM employees ORDER BY id"),
    groups,
    members: (await all(db, "SELECT * FROM security_group_members ORDER BY id")).filter((m) => groups.some((g) => g.id === m.security_group_id)),
    eligibility: (await all(db, "SELECT * FROM employee_post_eligibility ORDER BY id")).filter((e) => postIds.includes(e.post_id)),
    unavailability: await all(db, "SELECT id,employee_id,starts_at,ends_at FROM employee_unavailability ORDER BY id"),
    patterns: await asyncMap(await all(db, "SELECT * FROM roster_pattern_versions ORDER BY id"), async (p) => ({
      ...p,
      steps: await all(db, "SELECT * FROM roster_pattern_steps WHERE pattern_version_id=? ORDER BY cycle_day_no", p.id)
    })),
    bindings: await all(db, "SELECT * FROM employee_rotation_bindings ORDER BY id"),
    external: await all(db, `SELECT a.id,a.employee_id,a.starts_at,a.ends_at,a.service_date,a.post_id,r.id revision_id FROM roster_assignments a JOIN roster_revisions r ON r.id=a.roster_revision_id WHERE r.status='PUBLISHED' AND r.scheduling_period_id<>? ORDER BY a.id`, periodId)
  };
  snapshot.source_hash = digest(JSON.stringify(snapshot));
  return snapshot;
}
function display(snapshot, a) {
  return JSON.stringify({
    employee_name: snapshot.employees.find((e) => e.id === a.employee_id)?.full_name,
    employee_no: snapshot.employees.find((e) => e.id === a.employee_id)?.employee_no,
    post_name: snapshot.posts.find((p) => p.id === a.post_id)?.name,
    shift_name: snapshot.shifts.find((s) => s.id === a.shift_id)?.name,
    start_time: snapshot.shifts.find((s) => s.id === a.shift_id)?.start_time,
    end_time: snapshot.shifts.find((s) => s.id === a.shift_id)?.end_time
  });
}
async function saveAssignment(db, user, revision, snapshot, a) {
  const routine = routineStep(snapshot, a.employee_id, a.service_date);
  let link = null;
  if (a.origin === "ROUTINE" && routine) {
    link = await one(db, "SELECT * FROM revision_rotation_bindings WHERE roster_revision_id=? AND rotation_binding_id=?", revision.id, routine.binding.id);
    if (!link) {
      const next = snapshot.bindings.filter((b) => b.employee_id === a.employee_id && b.effective_from > routine.binding.effective_from).sort((a2, b) => a2.effective_from.localeCompare(b.effective_from))[0];
      link = await insert(db, "revision_rotation_bindings", {
        roster_revision_id: revision.id,
        rotation_binding_id: routine.binding.id,
        applies_from: routine.binding.effective_from > snapshot.period.starts_on ? routine.binding.effective_from : snapshot.period.starts_on,
        applies_to: next && next.effective_from <= snapshot.period.ends_on ? addDays2(next.effective_from, -1) : snapshot.period.ends_on,
        created_by: user.id
      });
    }
  }
  return await insert(db, "roster_assignments", {
    roster_revision_id: revision.id,
    employee_id: a.employee_id,
    post_id: a.post_id,
    shift_id: a.shift_id,
    service_date: a.service_date,
    starts_at: a.starts_at,
    ends_at: a.ends_at,
    origin: a.origin,
    is_locked: a.is_locked || 0,
    display_snapshot: a.display_snapshot || display(snapshot, a),
    revision_rotation_binding_id: link?.id || null,
    source_override_id: a.source_override_id || null,
    copied_from_assignment_id: a.copied_from_assignment_id || null,
    locked_by: a.is_locked ? a.locked_by || user.id : null,
    locked_at: a.is_locked ? a.locked_at || now() : null,
    manual_change_reason: a.manual_change_reason || null,
    created_by: user.id
  });
}
async function reportAndGaps(db, user, revision, snapshot, rejected = []) {
  const assignments = await all(db, "SELECT * FROM roster_assignments WHERE roster_revision_id=?", revision.id), errors = validateAssignments(snapshot, assignments);
  const gaps = snapshot.slots.map((s) => ({
    ...s,
    assigned_count: assignments.filter((a) => a.service_date === s.service_date && a.post_id === s.post_id && a.shift_id === s.shift_id).length
  })).filter((s) => s.required_count > s.assigned_count);
  await run(db, "DELETE FROM roster_gaps WHERE roster_revision_id=?", revision.id);
  for (const gap of gaps) await insert(db, "roster_gaps", {
    roster_revision_id: revision.id,
    post_id: gap.post_id,
    shift_id: gap.shift_id,
    service_date: gap.service_date,
    required_count: gap.required_count,
    assigned_count: gap.assigned_count,
    created_by: user.id
  });
  const report = {
    errors,
    rejected,
    gap_count: gaps.reduce((s, g) => s + g.required_count - g.assigned_count, 0),
    assignment_count: assignments.length,
    validated_at: now()
  };
  await run(db, "UPDATE roster_revisions SET validation_report=? WHERE id=?", JSON.stringify(report), revision.id);
  return report;
}
function assertFutureRange(from, to) {
  assert(Date.parse(`${from}T00:00:00+08:00`) > Date.now(), "Generator hanya dapat mengubah tanggal setelah hari ini. Koreksi historis tidak tersedia.");
  assert(to >= from, "Rentang generasi tidak valid.");
}
async function rosterRoutes(c) {
  const { db, user, p, method: m, body: b } = c, id = p[1], action = p[2];
  if (p[0] === "periods") {
    if (m === "GET" && !id) {
      assert(await has(db, user, "security.roster.read"), "Akses ditolak.", 403);
      return {
        items: await asyncMap(await asyncFilter(await all(db, "SELECT * FROM scheduling_periods ORDER BY starts_on DESC"), async (period) => await asyncSome(await periodPosts(db, period.id), async (postId) => await can(db, user, "security.roster.read", await postContext(db, postId)) || await has(db, user, "security.roster.read") && user.employee_id && await one(db, "SELECT a.id FROM roster_assignments a JOIN roster_revisions r ON r.id=a.roster_revision_id WHERE r.scheduling_period_id=? AND r.status='PUBLISHED' AND a.employee_id=?", period.id, user.employee_id))), async (period) => ({
          ...period,
          post_ids: await asyncFilter(await periodPosts(db, period.id), async (postId) => await can(db, user, "security.roster.read", await postContext(db, postId))),
          revisions: await asyncFilter(await all(db, "SELECT id,revision_no,status,row_version,published_at,created_at FROM roster_revisions WHERE scheduling_period_id=? ORDER BY revision_no DESC", period.id), async (r) => r.status === "PUBLISHED" || await asyncEvery(await periodPosts(db, period.id), async (pid) => await can(db, user, "security.roster.generate", await postContext(db, pid))))
        }))
      };
    }
    if (m === "POST" && !id) return await tx(db, async () => {
      const from = date(b.starts_on), to = date(b.ends_on);
      assert(to >= from && (Date.parse(to) - Date.parse(from)) / DAY < 93, "Periode harus 1\u201393 hari.");
      assertFutureRange(from, to);
      assert(Array.isArray(b.post_ids) && b.post_ids.length, "Pilih pos cakupan.");
      const posts = [...new Set(b.post_ids)];
      for (const pid of posts) {
        const post = await get(db, "security_posts", pid);
        assert(post.org_unit_id === b.org_unit_id && post.is_active, "Pos harus aktif dan sesuai unit periode.");
        await requireAccess(db, user, "security.roster.generate", await postContext(db, pid));
        assert(!await one(db, "SELECT p.id FROM scheduling_periods p JOIN scheduling_period_posts pp ON pp.scheduling_period_id=p.id WHERE pp.post_id=? AND p.starts_on<=? AND p.ends_on>=?", pid, to, from), "Pos telah dicakup periode yang bertumpang tindih.", 409);
      }
      const period = await insert(db, "scheduling_periods", {
        org_unit_id: b.org_unit_id,
        starts_on: from,
        ends_on: to,
        name: text(b.name, "Nama periode"),
        is_archived: 0,
        created_by: user.id
      });
      for (const pid of posts) await run(db, "INSERT INTO scheduling_period_posts (scheduling_period_id,post_id) VALUES(?,?)", period.id, pid);
      await audit(db, user, "CREATE", "scheduling_periods", period.id);
      return period;
    });
    if (id && m === "POST" && action === "revisions") return await tx(db, async () => {
      await requirePeriod(db, user, "security.roster.generate", id);
      const period = await get(db, "scheduling_periods", id);
      const current = await one(db, "SELECT * FROM roster_revisions WHERE scheduling_period_id=? AND status='PUBLISHED'", id);
      if (current) assert(b.based_on_revision_id === current.id, "Jadwal terbit berubah. Muat ulang.", 409);
      else assert(!b.based_on_revision_id, "Revisi acuan tidak sesuai.");
      const snapshot = await buildSnapshot(db, id, b.rules_version_id), number = (await one(db, "SELECT coalesce(max(revision_no),0)+1 n FROM roster_revisions WHERE scheduling_period_id=?", id)).n;
      const revision = await insert(db, "roster_revisions", {
        scheduling_period_id: id,
        revision_no: number,
        rules_version_id: b.rules_version_id,
        status: "DRAFT",
        input_snapshot: JSON.stringify(snapshot),
        input_hash: digest(JSON.stringify(snapshot)),
        generator_version: GENERATOR_VERSION,
        generator_seed: text(String(b.seed || "0"), "Seed", 100),
        based_on_revision_id: current?.id || null,
        created_by: user.id
      });
      if (current) for (const a of await all(db, "SELECT * FROM roster_assignments WHERE roster_revision_id=?", current.id)) await saveAssignment(db, user, revision, snapshot, {
        ...a,
        copied_from_assignment_id: a.id
      });
      await reportAndGaps(db, user, revision, snapshot);
      await audit(db, user, "DRAFT_CREATED", "roster_revisions", revision.id);
      return await get(db, "roster_revisions", revision.id);
    });
  }
  if (p[0] === "revisions" && id) {
    const revision = await get(db, "roster_revisions", id), period = await get(db, "scheduling_periods", revision.scheduling_period_id), snapshot = JSON.parse(revision.input_snapshot);
    if (m === "GET" && !action) {
      assert(await has(db, user, "security.roster.read"), "Akses ditolak.", 403);
      const editor = await asyncEvery(await periodPosts(db, period.id), async (pid) => await can(db, user, "security.roster.generate", await postContext(db, pid)));
      assert(editor || revision.status === "PUBLISHED", "Draf atau riwayat hanya tersedia bagi pengelola.", 403);
      const assignments = (await asyncFilter(await all(db, "SELECT * FROM roster_assignments WHERE roster_revision_id=? ORDER BY service_date,starts_at,post_id", id), async (a) => await can(db, user, "security.roster.read", {
        ...a,
        ...await postContext(db, a.post_id)
      }))).map((a) => ({
        ...a,
        display: JSON.parse(a.display_snapshot)
      }));
      const gaps = await asyncFilter(await all(db, "SELECT g.*,p.name post_name,s.name shift_name FROM roster_gaps g JOIN security_posts p ON p.id=g.post_id JOIN shift_definitions s ON s.id=g.shift_id WHERE roster_revision_id=?", id), async (g) => await can(db, user, "security.roster.read", await postContext(db, g.post_id)));
      assert(editor || assignments.length || gaps.length, "Cakupan revisi tidak dapat dibaca.", 403);
      return {
        id: revision.id,
        period,
        revision_no: revision.revision_no,
        status: revision.status,
        row_version: revision.row_version,
        published_at: revision.published_at,
        input_hash: editor ? revision.input_hash : void 0,
        assignments,
        gaps,
        report: editor ? JSON.parse(revision.validation_report || "{}") : void 0
      };
    }
    if (m === "POST") return await tx(db, async () => {
      const permission = action === "publish" ? "security.roster.publish" : action === "acknowledge" ? "security.roster.acknowledge" : action === "generate" ? "security.roster.generate" : "security.roster.edit";
      await requirePeriod(db, user, permission, period.id);
      assert(revision.status === "DRAFT", "Jadwal terbit tidak dapat diubah. Buat revisi baru.", 409);
      assert(revision.row_version === b.row_version, "Draf berubah. Muat ulang.", 409);
      if (action === "generate") {
        const from = b.starts_on ? date(b.starts_on) : period.starts_on, to = b.ends_on ? date(b.ends_on) : period.ends_on;
        assert(from >= period.starts_on && to <= period.ends_on, "Rentang di luar periode.");
        assertFutureRange(from, to);
        const fresh2 = await buildSnapshot(db, period.id, revision.rules_version_id);
        for (const slot of fresh2.slots.filter((s) => s.service_date < from || s.service_date > to)) {
          const old2 = snapshot.slots.find((o) => o.service_date === slot.service_date && o.post_id === slot.post_id && o.shift_id === slot.shift_id);
          assert(old2 && JSON.stringify(old2) === JSON.stringify(slot), "Kebutuhan di luar rentang berubah. Perluas rentang revisi secara eksplisit.");
        }
        const old = await all(db, "SELECT * FROM roster_assignments WHERE roster_revision_id=?", id), retained = old.filter((a) => a.is_locked || a.service_date < from || a.service_date > to);
        const result = generateAssignments(fresh2, retained, revision.generator_seed, {
          starts_on: from,
          ends_on: to
        });
        for (const a of old) if (!retained.some((r) => r.id === a.id)) await run(db, "DELETE FROM roster_assignments WHERE id=?", a.id);
        for (const a of result.assignments) if (!a.id) await saveAssignment(db, user, revision, fresh2, a);
        const saved = await update(db, "roster_revisions", id, b.row_version, {
          input_snapshot: JSON.stringify(fresh2),
          input_hash: digest(JSON.stringify({
            snapshot: fresh2,
            locked: retained.filter((a) => a.is_locked)
          }))
        });
        await reportAndGaps(db, user, saved, fresh2, result.rejected);
        await audit(db, user, "GENERATE", "roster_revisions", id, {
          starts_on: from,
          ends_on: to
        });
        return await get(db, "roster_revisions", id);
      }
      if (action === "assign") {
        const post = await get(db, "security_posts", b.post_id), shift = snapshot.shifts.find((s) => s.id === b.shift_id);
        assert((await periodPosts(db, period.id)).includes(post.id) && shift, "Pos atau shift di luar cakupan.");
        const day = date(b.service_date);
        assert(day >= period.starts_on && day <= period.ends_on, "Tanggal di luar periode.");
        assert(Date.parse(shiftInterval(day, shift).starts_at) > Date.now(), "Penugasan yang telah dimulai tidak dapat diubah.");
        await get(db, "employees", b.employee_id);
        const a = {
          employee_id: b.employee_id,
          post_id: b.post_id,
          shift_id: b.shift_id,
          service_date: day,
          ...shiftInterval(day, shift),
          origin: "MANUAL",
          manual_change_reason: text(b.reason, "Alasan perubahan"),
          is_locked: Number(Boolean(b.is_locked))
        };
        const existing = await all(db, "SELECT * FROM roster_assignments WHERE roster_revision_id=?", id), errors = validateAssignments(snapshot, [...existing, a]);
        assert(!errors.length, "Penugasan melanggar validasi: " + errors.slice(0, 3).map((e) => e.message).join(" "));
        await saveAssignment(db, user, revision, snapshot, a);
        await update(db, "roster_revisions", id, b.row_version, {});
        await reportAndGaps(db, user, revision, snapshot);
        await audit(db, user, "MANUAL_ASSIGNMENT", "roster_revisions", id, {}, b.reason);
        return {
          ok: true
        };
      }
      if (["lock", "remove"].includes(action)) {
        const a = await get(db, "roster_assignments", b.assignment_id);
        assert(a.roster_revision_id === id, "Penugasan tidak sesuai revisi.");
        const reason = text(b.reason, "Alasan");
        assert(a.starts_at > now(), "Penugasan yang telah dimulai tidak dapat diubah.");
        if (action === "remove") {
          assert(!a.is_locked, "Buka kunci sebelum menghapus penugasan.");
          await run(db, "DELETE FROM roster_assignments WHERE id=?", a.id);
        } else await run(db, "UPDATE roster_assignments SET is_locked=?,locked_by=?,locked_at=?,row_version=row_version+1 WHERE id=?", b.is_locked ? 1 : 0, b.is_locked ? user.id : null, b.is_locked ? now() : null, a.id);
        await update(db, "roster_revisions", id, b.row_version, {});
        await reportAndGaps(db, user, revision, snapshot);
        await audit(db, user, action.toUpperCase(), "roster_assignments", a.id, {}, reason);
        return {
          ok: true
        };
      }
      if (action === "validate") {
        const fresh2 = await buildSnapshot(db, period.id, revision.rules_version_id);
        assert(fresh2.source_hash === snapshot.source_hash, "Input berubah. Buat ulang draf untuk memperbarui snapshot.", 409);
        const report = await reportAndGaps(db, user, revision, snapshot);
        await update(db, "roster_revisions", id, b.row_version, {});
        return report;
      }
      if (action === "acknowledge") {
        await requirePeriod(db, user, "security.roster.publish", period.id);
        assert((await one(db, "SELECT value FROM app_settings WHERE key='allow_gap_publication'")).value === "true", "Publikasi dengan kekurangan belum diaktifkan oleh pengelola.");
        const reason = text(b.reason, "Alasan pengakuan kekurangan", 3e3);
        await run(db, "UPDATE roster_gaps SET acknowledged_by=?,acknowledged_at=?,acknowledgment_reason=? WHERE roster_revision_id=?", user.id, now(), reason, id);
        await update(db, "roster_revisions", id, b.row_version, {});
        await audit(db, user, "ACKNOWLEDGE_GAPS", "roster_revisions", id, {}, reason);
        return {
          ok: true
        };
      }
      if (action === "publish") {
        const active = await one(db, "SELECT id FROM roster_revisions WHERE scheduling_period_id=? AND status='PUBLISHED'", period.id);
        assert((active?.id || null) === (revision.based_on_revision_id || null), "Revisi terbit berubah. Buat draf dari revisi terbaru.", 409);
        const fresh2 = await buildSnapshot(db, period.id, revision.rules_version_id);
        assert(fresh2.source_hash === snapshot.source_hash, "Konfigurasi atau jadwal periode lain berubah. Buat ulang dan validasi draf.", 409);
        const assignments = await all(db, "SELECT * FROM roster_assignments WHERE roster_revision_id=?", id), errors = validateAssignments(fresh2, assignments);
        assert(!errors.length, "Publikasi ditahan: " + errors.slice(0, 4).map((e) => e.message).join(" "));
        const gaps = await all(db, "SELECT * FROM roster_gaps WHERE roster_revision_id=?", id);
        for (const slot of fresh2.slots) {
          const count = assignments.filter((a) => a.post_id === slot.post_id && a.shift_id === slot.shift_id && a.service_date === slot.service_date).length;
          if (count < slot.required_count) {
            const gap = gaps.find((g) => g.post_id === slot.post_id && g.shift_id === slot.shift_id && g.service_date === slot.service_date && g.required_count === slot.required_count && g.assigned_count === count);
            assert((await one(db, "SELECT value FROM app_settings WHERE key='allow_gap_publication'")).value === "true" && gap?.acknowledged_by && gap.acknowledgment_reason, "Kekurangan belum diakui atau publikasi dengan kekurangan dinonaktifkan.");
          }
        }
        if (active) await run(db, "UPDATE roster_revisions SET status='SUPERSEDED',superseded_at=?,row_version=row_version+1 WHERE id=?", now(), active.id);
        const saved = await update(db, "roster_revisions", id, b.row_version, {
          status: "PUBLISHED",
          published_by: user.id,
          published_at: now()
        });
        await audit(db, user, "PUBLISH", "roster_revisions", id, {
          revision_no: revision.revision_no
        });
        return {
          id: saved.id,
          status: saved.status
        };
      }
    });
  }
  return void 0;
}
async function adminRoutes(c) {
  const { db, user, p, method: m, body: b } = c, id = p[1], action = p[2];
  if (p[0] === "users") {
    if (m === "GET" && !id) {
      await requireAccess(db, user, "admin.users.read");
      return {
        items: await asyncMap(await all(db, "SELECT id,username,employee_id,status,must_change_password,last_login_at,row_version FROM users ORDER BY username"), async (u) => ({
          ...u,
          grants: await asyncMap(await all(db, "SELECT ur.*,r.name role_name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE user_id=?", u.id), async (g) => ({
            ...g,
            units: await all(db, "SELECT * FROM user_role_units WHERE user_role_id=?", g.id),
            posts: (await all(db, "SELECT post_id FROM user_role_posts WHERE user_role_id=?", g.id)).map((p2) => p2.post_id)
          }))
        }))
      };
    }
    if (m === "POST" && !id) {
      await requireAccess(db, user, "admin.users.manage");
      assert(typeof b.password === "string" && b.password.length >= 6 && b.password.length <= 128, "Password harus 6\u2013128 karakter.");
      const username = text(b.username, "Username", 64).toLowerCase();
      assert(/^[a-z0-9._-]{1,64}$/.test(username), "Username hanya berisi huruf kecil, angka, titik, garis bawah atau tanda hubung.");
      assert(!await one(db, "SELECT id FROM users WHERE username=?", username), "Username sudah digunakan.", 409);
      const identity = await db.identity.create(b.password);
      return await tx(db, async () => {
        const row = await insert(db, "users", {
          id: identity.id,
          username,
          employee_id: b.employee_id || null,
          status: "ACTIVE",
          must_change_password: 1,
          password_changed_at: now(),
          created_by: user.id
        });
        await audit(db, user, "CREATE", "users", row.id, {
          username: row.username
        });
        return safeUser(row);
      });
    }
    if (id && m === "PATCH" && !action) return await tx(db, async () => {
      await requireAccess(db, user, "admin.users.manage");
      await protectAdminAccount(db, user, id);
      await get(db, "users", id);
      const status = enumValue(b.status, ["ACTIVE", "INACTIVE"]);
      const saved = await update(db, "users", id, b.row_version, {
        status
      });
      if (status !== "ACTIVE") await run(db, "UPDATE public.app_users SET row_version=row_version+1 WHERE id=?", id);
      await assertAdminRemains(db);
      await audit(db, user, "STATUS_CHANGED", "users", id, {
        status
      });
      return safeUser(saved);
    });
    if (id && m === "POST" && action === "grants") return await tx(db, async () => {
      await requireAccess(db, user, "admin.roles.manage");
      const account = await get(db, "users", id);
      assert(account.row_version === b.row_version, "Data akun berubah. Muat ulang.", 409);
      assert(Array.isArray(b.grants) && b.grants.length <= 30, "Pemberian role tidak valid.");
      await protectAdminAccount(db, user, id);
      const superadmin = await isSuperAdmin(db, user);
      assert(superadmin || id !== user.id, "IT-admin tidak boleh mengubah role atau cakupan akunnya sendiri.", 403);
      if (!superadmin) for (const g of b.grants) assert((await get(db, "roles", g.role_id)).code !== "SUPER_ADMIN", "Hanya Superadmin yang boleh memberikan role Superadmin.", 403);
      await run(db, "DELETE FROM user_roles WHERE user_id=?", id);
      for (const g of b.grants) {
        const role = await get(db, "roles", g.role_id);
        assert(role.is_active, "Role tidak aktif.");
        const kind = enumValue(g.scope_kind, ["SELF", "ASSIGNED_UNITS", "ASSIGNED_POSTS", "ALL"]);
        if (["SUPER_ADMIN", "IT_ADMIN"].includes(role.code)) assert(kind === "ALL", "Role admin memerlukan cakupan seluruh organisasi.");
        const grant = await insert(db, "user_roles", {
          user_id: id,
          role_id: g.role_id,
          scope_kind: kind
        });
        if (kind === "ASSIGNED_UNITS") {
          assert(Array.isArray(g.units) && g.units.length, "Pilih minimal satu unit.");
          for (const unit of g.units) await run(db, "INSERT INTO user_role_units (user_role_id,org_unit_id,include_descendants) VALUES(?,?,?)", grant.id, (await get(db, "org_units", unit.org_unit_id)).id, Number(Boolean(unit.include_descendants)));
        }
        if (kind === "ASSIGNED_POSTS") {
          assert(Array.isArray(g.posts) && g.posts.length, "Pilih minimal satu pos.");
          for (const postId of new Set(g.posts)) await run(db, "INSERT INTO user_role_posts (user_role_id,post_id) VALUES(?,?)", grant.id, (await get(db, "security_posts", postId)).id);
        }
      }
      await assertAdminRemains(db);
      await update(db, "users", id, b.row_version, {});
      await audit(db, user, "GRANTS_CHANGED", "users", id, {
        grant_count: b.grants.length
      });
      return {
        ok: true
      };
    });
    if (id && m === "POST" && action === "reset") return await tx(db, async () => {
      await requireAccess(db, user, "admin.users.reset");
      await protectAdminAccount(db, user, id);
      await get(db, "users", id);
      const token = randomBytes2(24).toString("hex");
      await run(db, "UPDATE password_reset_tokens SET revoked_at=? WHERE user_id=? AND consumed_at IS NULL", now(), id);
      await insert(db, "password_reset_tokens", {
        user_id: id,
        token_hash: digest(token),
        expires_at: new Date(Date.now() + 30 * 6e4).toISOString(),
        issued_by: user.id
      });
      await run(db, "UPDATE public.app_users SET row_version=row_version+1 WHERE id=?", id);
      await run(db, "UPDATE public.app_users SET must_change_password=true WHERE id=?", id);
      await audit(db, user, "RESET_ISSUED", "users", id);
      return {
        token,
        expires_in_minutes: 30
      };
    });
  }
  if (p[0] === "roles") {
    if (m === "GET" && !id) {
      await requireAccess(db, user, "admin.roles.read");
      return {
        items: await asyncMap(await all(db, "SELECT * FROM roles ORDER BY name"), async (r) => ({
          ...r,
          permissions: (r.code === "SUPER_ADMIN" ? await all(db, "SELECT code FROM permissions") : await all(db, "SELECT p.code FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id=?", r.id)).map((p2) => p2.code)
        })),
        permissions: await all(db, "SELECT * FROM permissions ORDER BY code")
      };
    }
    if (["POST", "PATCH"].includes(m)) return await tx(db, async () => {
      await requireAccess(db, user, "admin.roles.manage");
      const old = id ? await get(db, "roles", id) : null;
      assert(Array.isArray(b.permissions), "Daftar izin wajib diisi.");
      const code = text(b.code === void 0 ? old?.code : b.code, "Kode role", 64).toUpperCase();
      const superadmin = await isSuperAdmin(db, user);
      assert(superadmin || !old?.is_system, "Hanya Superadmin yang boleh mengubah role sistem.", 403);
      assert(superadmin || !old || !await one(db, "SELECT 1 FROM user_roles WHERE role_id=? AND user_id=?", old.id, user.id), "IT-admin tidak boleh mengubah izin role yang dipakainya sendiri.", 403);
      if (["SUPER_ADMIN", "IT_ADMIN"].includes(code)) {
        assert(old && old.code === code, "Role admin sistem tidak dapat dibuat ulang.", 403);
        const expected = code === "SUPER_ADMIN" ? (await all(db, "SELECT code FROM permissions")).map((p2) => p2.code) : IT_ADMIN_PERMISSIONS;
        assert(b.is_active !== false && b.is_active !== 0 && new Set(b.permissions).size === expected.length && expected.every((p2) => b.permissions.includes(p2)), "Izin role admin sistem mengikuti tipe admin dan tidak dapat dikurangi atau diperluas.", 409);
      }
      assert(!old?.is_system || code === old.code, "Kode role sistem tidak dapat diubah. Izin role tetap dapat disesuaikan.");
      const values = {
        code,
        name: text(b.name === void 0 ? old?.name : b.name, "Nama role", 120),
        description: b.description === void 0 ? old?.description || null : typeof b.description === "string" ? b.description.slice(0, 2e3) : null,
        is_active: b.is_active === void 0 ? old?.is_active ?? 1 : Number(Boolean(b.is_active))
      };
      const saved = old ? await update(db, "roles", id, b.row_version, values) : await insert(db, "roles", {
        ...values,
        is_system: 0,
        created_by: user.id
      });
      await run(db, "DELETE FROM role_permissions WHERE role_id=?", saved.id);
      for (const code2 of new Set(b.permissions)) {
        const perm = await one(db, "SELECT id FROM permissions WHERE code=?", code2);
        assert(perm, "Izin tidak dikenal.");
        await run(db, "INSERT INTO role_permissions (role_id,permission_id) VALUES(?,?)", saved.id, perm.id);
      }
      await assertAdminRemains(db);
      await audit(db, user, old ? "UPDATE" : "CREATE", "roles", saved.id, {
        permission_count: b.permissions.length
      });
      return saved;
    });
  }
  if (p[0] === "audit" && m === "GET") {
    await requireAccess(db, user, "admin.audit.read");
    return {
      items: await all(db, "SELECT a.id,a.actor_user_id,u.username actor_name,a.action,a.object_type,a.object_key,a.occurred_at,a.outcome,a.reason,a.change_summary FROM audit_events a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.occurred_at DESC,a.rowid DESC LIMIT 500")
    };
  }
  if (p[0] === "settings") {
    await requireAccess(db, user, "admin.roles.manage");
    if (m === "GET") return Object.fromEntries((await asyncFilter(await all(db, "SELECT key,value FROM app_settings"), async (r) => await isSuperAdmin(db, user) || ["allow_gap_publication", "demo_mode"].includes(r.key))).map((r) => [r.key, r.value]));
    if (m === "PATCH") return await tx(db, async () => {
      assert(typeof b.allow_gap_publication === "boolean", "Pilihan kebijakan tidak valid.");
      await run(db, "UPDATE app_settings SET value=? WHERE key='allow_gap_publication'", String(b.allow_gap_publication));
      await audit(db, user, "POLICY_CHANGED", "app_settings", "allow_gap_publication", {
        enabled: b.allow_gap_publication
      }, text(b.reason, "Dasar keputusan"));
      return {
        ok: true
      };
    });
  }
  return void 0;
}
async function announcementVisible(db, user, row) {
  return await announcementsManager(db, user) || Boolean(row.published_at && ["PUBLISHED", "ARCHIVED"].includes(row.status) && (!row.starts_at || row.starts_at <= now()));
}
function announcementPhase(row) {
  if (row.status !== "PUBLISHED") return row.status;
  if (row.starts_at && row.starts_at > now()) return "SCHEDULED";
  return row.ends_at && row.ends_at <= now() ? "EXPIRED" : "ACTIVE";
}
async function decorate(db, user, row, detail = false) {
  const blocks = JSON.parse(row.content_json), read = await one(db, "SELECT * FROM announcement_reads WHERE announcement_id=? AND user_id=?", row.id, user.id);
  const result = {
    ...row,
    content_json: void 0,
    phase: announcementPhase(row),
    is_read: Boolean(read && read.content_version === row.content_version),
    read_at: read?.read_at || null,
    author_name: (await one(db, "SELECT coalesce(e.full_name,u.username) name FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.id=?", row.published_by || row.created_by))?.name || "Pengelola",
    search_text: blocks.filter((b) => b.type === "text").map((b) => b.text).join(" "),
    excerpt: blocks.filter((b) => b.type === "text").map((b) => b.text).join(" ").slice(0, 240),
    cover_file_id: blocks.find((b) => b.type === "image")?.file_id || null
  };
  if (detail) {
    result.blocks = blocks;
    result.files = await linkedFiles(db, "announcement", row.id);
  }
  return result;
}
async function content(db, user, b, old) {
  const values = {
    title: text(b.title, "Judul pengumuman", 200),
    category: enumValue(b.category, ["UMUM", "SDM", "OPERASIONAL", "KEAMANAN"], "Kategori"),
    priority: enumValue(b.priority || "NORMAL", ["NORMAL", "IMPORTANT"], "Prioritas"),
    is_pinned: Number(Boolean(b.is_pinned)),
    starts_at: b.starts_at ? instant(b.starts_at) : null,
    ends_at: b.ends_at ? instant(b.ends_at) : null
  };
  assert(!values.ends_at || values.ends_at > (values.starts_at || now()), "Akhir tayang harus setelah awal tayang.");
  assert(Array.isArray(b.blocks) && b.blocks.length > 0 && b.blocks.length <= 60, "Isi pengumuman wajib diisi, maksimal 60 bagian.");
  let textLength = 0;
  const references = [];
  const useFile = async (id, kind, caption = "") => {
    assert(typeof id === "string" && !references.some((r) => r.file_id === id), "Berkas pengumuman tidak valid atau dipakai berulang.");
    const retained = old && await one(db, "SELECT 1 FROM announcement_files WHERE announcement_id=? AND file_id=?", old.id, id);
    const file = retained ? await get(db, "files", id) : await claimFile(db, user, id);
    assert(file.status === "AVAILABLE", "Berkas tidak tersedia.");
    if (kind === "IMAGE") assert(["image/jpeg", "image/png"].includes(file.mime_type), "Gambar pengumuman harus JPG atau PNG.");
    references.push({
      file_id: id,
      usage_kind: kind,
      caption: String(caption || "").slice(0, 500)
    });
  };
  const blocks = (await asyncMap(b.blocks, async (block) => {
    assert(block && typeof block === "object", "Bagian isi tidak valid.");
    if (block.type === "text") {
      const value = typeof block.text === "string" ? block.text.trim() : "";
      textLength += value.length;
      return {
        type: "text",
        text: value
      };
    }
    assert(block.type === "image", "Jenis isi pengumuman tidak didukung.");
    await useFile(block.file_id, "IMAGE", block.caption);
    return {
      type: "image",
      file_id: block.file_id,
      caption: String(block.caption || "").slice(0, 500)
    };
  })).filter((block) => block.type === "image" || block.text);
  assert(blocks.length && textLength <= 5e4, "Isi wajib tersedia dan maksimal 50.000 karakter.");
  assert(b.attachments === void 0 || Array.isArray(b.attachments), "Lampiran tidak valid.");
  assert((b.attachments || []).length <= 10, "Maksimal 10 lampiran.");
  for (const attachment of b.attachments || []) await useFile(attachment.file_id, "ATTACHMENT", attachment.caption);
  return {
    values: {
      ...values,
      content_json: JSON.stringify(blocks),
      content_version: (old?.content_version || 0) + 1
    },
    references
  };
}
async function announcementRoutes({ db, user, p, method: m, body: b }) {
  if (p[0] !== "announcements") return;
  const id = p[1], action = p[2], manager = await announcementsManager(db, user);
  if (m === "GET" && !id) return {
    can_manage: manager,
    items: await asyncMap(await asyncFilter(await all(db, "SELECT * FROM announcements ORDER BY is_pinned DESC,published_at DESC,created_at DESC"), async (r) => await announcementVisible(db, user, r)), async (r) => await decorate(db, user, r))
  };
  if (m === "POST" && !id || m === "PATCH" && id && !action) {
    assert(manager, "Hanya Admin atau SDM yang dapat mengelola pengumuman.", 403);
    return await tx(db, async () => {
      const old = id ? await get(db, "announcements", id) : null;
      const { values, references } = await content(db, user, b, old);
      const row2 = old ? await update(db, "announcements", id, b.row_version, values) : await insert(db, "announcements", {
        ...values,
        status: "DRAFT",
        created_by: user.id
      });
      await run(db, "DELETE FROM announcement_files WHERE announcement_id=?", row2.id);
      for (const reference of references) await insert(db, "announcement_files", {
        announcement_id: row2.id,
        ...reference,
        created_by: user.id
      });
      await audit(db, user, old ? "UPDATE" : "CREATE", "announcements", row2.id, {
        content_version: row2.content_version
      });
      return await decorate(db, user, row2, true);
    });
  }
  if (!id) return;
  const row = await get(db, "announcements", id);
  if (m === "GET" && !action) {
    assert(await announcementVisible(db, user, row), "Pengumuman tidak tersedia.", 404);
    return {
      ...await decorate(db, user, row, true),
      can_manage: manager
    };
  }
  if (m === "POST" && action === "read") return await tx(db, async () => {
    assert(row.published_at && await announcementVisible(db, user, row), "Pengumuman belum tersedia untuk dibaca.", 404);
    assert(!row.starts_at || row.starts_at <= now(), "Pengumuman belum mulai tayang.");
    await run(db, "INSERT INTO announcement_reads(announcement_id,user_id,content_version,read_at) VALUES(?,?,?,?) ON CONFLICT(announcement_id,user_id) DO UPDATE SET content_version=excluded.content_version,read_at=excluded.read_at", id, user.id, row.content_version, now());
    return {
      ok: true
    };
  });
  if (m === "POST" && ["publish", "archive", "pin"].includes(action)) {
    assert(manager, "Hanya Admin atau SDM yang dapat menerbitkan dan mengelola pengumuman.", 403);
    return await tx(db, async () => {
      const values = action === "publish" ? {
        status: "PUBLISHED",
        published_at: row.published_at || now(),
        published_by: user.id
      } : action === "archive" ? {
        status: "ARCHIVED"
      } : {
        is_pinned: Number(Boolean(b.is_pinned))
      };
      if (action === "publish") assert(!row.ends_at || row.ends_at > now(), "Masa tayang sudah berakhir. Ubah akhir tayang sebelum menerbitkan.");
      const changed = await update(db, "announcements", id, b.row_version, values);
      await audit(db, user, action.toUpperCase(), "announcements", id);
      return await decorate(db, user, changed, true);
    });
  }
}
async function dashboard(db, user, module = "hr", asOf = today()) {
  date(asOf);
  if (module === "hr") {
    assert((await grants(db, user)).some((g) => g.code.startsWith("hr.")), "Akses SDM ditolak.", 403);
    const people = await asyncFilter(await employees(db, asOf), async (e) => await can(db, user, "hr.employees.read", e)), active = people.filter((e) => e.is_active && e.joined_on <= asOf && (!e.ended_on || e.ended_on >= asOf));
    const units = (await all(db, "SELECT * FROM org_units WHERE is_active=1")).map((u) => ({
      ...u,
      count: active.filter((e) => e.org_unit_id === u.id).length
    })).filter((u) => u.count);
    const training = await asyncFilter(await all(db, "SELECT t.*,(SELECT count(*) FROM training_participants WHERE training_event_id=t.id) participant_count FROM training_events t WHERE status='PLANNED' ORDER BY starts_at"), async (t) => localDate(t.starts_at) >= asOf && await trainingAllowed(db, user, "read", t));
    const coaching = await asyncFilter(await all(db, "SELECT s.*,e.full_name employee_name,c.full_name coach_name,(SELECT count(*) FROM coaching_actions WHERE coaching_session_id=s.id AND status<>'DONE') open_actions FROM coaching_sessions s JOIN employees e ON e.id=s.employee_id JOIN employees c ON c.id=s.coach_employee_id"), async (s) => await coachingAllowed(db, user, "read", s));
    const docs = await asyncFilter(await all(db, "SELECT d.*,v.version_label,v.effective_on,v.file_id FROM documents d JOIN document_versions v ON v.document_id=d.id AND v.state='ACTIVE' WHERE d.is_archived=0 ORDER BY v.activated_at DESC"), async (d) => await documentAllowed(db, user, "read", d));
    return {
      as_of: asOf,
      total: people.length,
      active: active.length,
      inactive: people.length - active.length,
      units: units.sort((a, b) => b.count - a.count),
      statuses: [...new Set(active.map((e) => e.employment_status))].map((s) => ({
        name: s,
        count: active.filter((e) => e.employment_status === s).length
      })),
      training: training.slice(0, 4),
      training_count: training.length,
      coaching: coaching.filter((s) => s.open_actions > 0).slice(0, 4),
      open_actions: coaching.reduce((sum2, s) => sum2 + s.open_actions, 0),
      documents: docs.slice(0, 4),
      document_count: docs.length,
      recent_employees: active.sort((a, b) => b.joined_on.localeCompare(a.joined_on)).slice(0, 5),
      can_coaching: await has(db, user, "hr.coaching.read") || await has(db, user, "hr.coaching.manage"),
      pending_import: await can(db, user, "hr.employees.create") ? (await one(db, "SELECT count(*) n FROM import_candidates WHERE status='PENDING'")).n : 0
    };
  }
  assert((await grants(db, user)).some((g) => g.code.startsWith("security.")), "Akses Keamanan ditolak.", 403);
  const assignments = await asyncFilter(await all(db, "SELECT a.* FROM roster_assignments a JOIN roster_revisions r ON r.id=a.roster_revision_id WHERE r.status='PUBLISHED' AND a.service_date=?", asOf), async (a) => await can(db, user, "security.roster.read", {
    ...a,
    ...await postContext(db, a.post_id)
  }));
  const gaps = await asyncFilter(await all(db, "SELECT g.*,p.name post_name,s.name shift_name FROM roster_gaps g JOIN roster_revisions r ON r.id=g.roster_revision_id JOIN security_posts p ON p.id=g.post_id JOIN shift_definitions s ON s.id=g.shift_id WHERE r.status='PUBLISHED' AND g.service_date=?", asOf), async (g) => await can(db, user, "security.roster.read", await postContext(db, g.post_id)));
  const incidents = await asyncFilter(await all(db, "SELECT i.*,p.name post_name FROM incidents i LEFT JOIN security_posts p ON p.id=i.post_id WHERE i.status<>'RESOLVED' ORDER BY occurred_at DESC"), async (i) => await can(db, user, "security.incidents.read", await reportContext(db, i)));
  const logs = await asyncFilter(await all(db, "SELECT l.*,p.name post_name,e.full_name employee_name FROM logbook_entries l LEFT JOIN security_posts p ON p.id=l.post_id JOIN employees e ON e.id=l.employee_id ORDER BY l.occurred_at DESC"), async (l) => await can(db, user, "security.logbook.read", await reportContext(db, l)));
  return {
    as_of: asOf,
    scheduled: assignments.length,
    gaps,
    gap_count: gaps.reduce((s, g) => s + g.required_count - g.assigned_count, 0),
    open_incidents: incidents.length,
    incidents: incidents.slice(0, 5),
    patrols: logs.filter((l) => localDate(l.occurred_at) === asOf && l.activity_type === "PATROLI").length,
    logs: logs.slice(0, 5),
    assignments: assignments.map((a) => ({
      ...a,
      display: JSON.parse(a.display_snapshot)
    }))
  };
}
async function lookups(db, user, purpose = "employees", sessionId) {
  const purposePerms = {
    employees: ["hr.employees.read", "hr.employees.create", "hr.employees.update"],
    organization: ["hr.organization.read", "hr.organization.manage"],
    documents: ["hr.documents.manage", "hr.documents.read"],
    training: ["hr.training.manage", "hr.training.participants"],
    coaching: ["hr.coaching.manage", "hr.coaching.create", "hr.coaching.update"],
    roster: ["security.roster.edit", "security.roster.generate", "security.config.manage", "security.roster.read"],
    logbook: ["security.logbook.create"],
    incidents: ["security.incidents.create", "security.incidents.update"],
    admin: ["admin.users.manage", "admin.roles.manage"]
  };
  const perms = purposePerms[purpose];
  assert(perms && await asyncSome(perms, async (p) => await has(db, user, p)), "Akses pilihan data ditolak.", 403);
  const any = async (ctx) => await asyncSome(perms, async (p) => await can(db, user, p, ctx));
  const admin = purpose === "admin" && await any({});
  const session = purpose === "coaching" && sessionId ? await one(db, "SELECT * FROM coaching_sessions WHERE id=?", sessionId) : null;
  const participants = session && await coachingAllowed(db, user, "read", session) ? [session.employee_id, session.coach_employee_id] : [];
  const posts = await asyncFilter(await all(db, "SELECT * FROM security_posts WHERE is_active=1 ORDER BY name"), async (p) => admin || await any({
    ...p,
    post_id: p.id,
    employee_id: user.employee_id
  }));
  const units = await asyncFilter(await all(db, "SELECT id,code,name,parent_id FROM org_units WHERE is_active=1 ORDER BY name"), async (u) => admin || await any({
    org_unit_id: u.id
  }) || posts.some((p) => p.org_unit_id === u.id) || user.employee_id && (await employeeContext(db, user.employee_id)).org_unit_id === u.id);
  const people = await asyncFilter(await employees(db), async (e) => e.is_active && (admin || await any(e) || participants.includes(e.id) || ["roster", "logbook", "incidents"].includes(purpose) && await asyncSome(posts, async (p) => await any({
    ...await postContext(db, p.id),
    employee_id: e.id
  }) && await one(db, "SELECT id FROM employee_post_eligibility WHERE employee_id=? AND post_id=? AND (valid_to IS NULL OR valid_to>=?)", e.id, p.id, today()))));
  return {
    employees: people.map((e) => ({
      id: e.id,
      full_name: e.full_name,
      employee_no: e.employee_no,
      org_unit_id: e.org_unit_id
    })),
    units,
    positions: (await all(db, "SELECT p.id,p.name,p.org_unit_id,u.name unit_name FROM positions p JOIN org_units u ON u.id=p.org_unit_id WHERE p.is_active=1 ORDER BY p.name")).filter((p) => units.some((u) => u.id === p.org_unit_id)),
    posts: posts.map((p) => ({
      id: p.id,
      name: p.name,
      org_unit_id: p.org_unit_id
    })),
    shifts: (await all(db, "SELECT * FROM shift_definitions WHERE is_active=1 ORDER BY start_time")).filter((s) => units.some((u) => u.id === s.org_unit_id)),
    groups: await asyncFilter(await all(db, "SELECT * FROM security_groups WHERE is_active=1 ORDER BY name"), async (g) => await any({
      org_unit_id: g.org_unit_id
    })),
    rules: (await all(db, "SELECT * FROM scheduling_rule_versions WHERE is_active=1 ORDER BY version_no DESC")).filter((r) => units.some((u) => u.id === r.org_unit_id)),
    patterns: (await all(db, "SELECT id,name,org_unit_id,cycle_length_days FROM roster_pattern_versions WHERE is_active=1")).filter((p) => units.some((u) => u.id === p.org_unit_id))
  };
}
var quickReport_tokenPattern = /^[a-f0-9]{64}$/;
var quickReport_securityPosition = (name) => /\b(keamanan|ketertiban|bankamda|linmas|satpam|security)\b/i.test(name);
var quickReport_invalidLink = "Tautan laporan tidak aktif. Minta tautan terbaru kepada koordinator.";
function quickReport_positionIds(link) {
  try {
    const ids = JSON.parse(link.position_ids);
    assert(Array.isArray(ids) && ids.length > 0, "Konfigurasi tautan tidak valid.", 403);
    return ids;
  } catch {
    assert(false, quickReport_invalidLink, 403);
  }
}
async function quickReport_manageable(db, user, link) {
  return await asyncEvery(quickReport_positionIds(link), async (id) => {
    const position = await one(db, "SELECT * FROM positions WHERE id=?", id);
    return position && await can(db, user, "security.config.manage", {
      org_unit_id: position.org_unit_id
    });
  });
}
async function quickReport_securityPositions(db, user) {
  return await asyncFilter(await all(db, "SELECT p.id,p.name,p.org_unit_id,u.name unit_name FROM positions p JOIN org_units u ON u.id=p.org_unit_id WHERE p.is_active=1 AND u.is_active=1 ORDER BY p.name"), async (p) => quickReport_securityPosition(p.name) && await can(db, user, "security.config.manage", {
    org_unit_id: p.org_unit_id
  }));
}
async function quickReport_eligibleEmployees(db, ids) {
  return (await all(db, `SELECT e.id,e.full_name,p.name position_name,p.id position_id,p.org_unit_id FROM employees e JOIN employee_placements ep ON ep.employee_id=e.id JOIN positions p ON p.id=ep.position_id JOIN org_units u ON u.id=p.org_unit_id WHERE e.is_active=1 AND p.is_active=1 AND u.is_active=1 AND ep.is_primary=1 AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?) ORDER BY e.full_name,e.id`, today(), today())).filter((e) => ids.includes(e.position_id) && quickReport_securityPosition(e.position_name));
}
async function quickReport_validLink(db, token) {
  assert(typeof token === "string" && quickReport_tokenPattern.test(token), quickReport_invalidLink, 404);
  const link = await one(db, "SELECT * FROM quick_report_links WHERE token_hash=? AND is_active=1", digest(token));
  assert(link, quickReport_invalidLink, 404);
  const owner = await one(db, "SELECT * FROM users WHERE id=? AND status='ACTIVE'", link.created_by);
  assert(owner && !owner.must_change_password && (!owner.employee_id || (await get(db, "employees", owner.employee_id)).is_active) && await quickReport_manageable(db, owner, link), quickReport_invalidLink, 403);
  return link;
}
async function quickReportManagement(c) {
  const { db, user, p, method, body: b } = c;
  if (p[0] !== "report-links") return;
  assert(await has(db, user, "security.config.manage"), "Akses pengelolaan tautan ditolak.", 403);
  if (method === "GET" && p.length === 1) {
    const active = await one(db, "SELECT * FROM quick_report_links WHERE is_active=1");
    return {
      positions: await quickReport_securityPositions(db, user),
      link: active && await quickReport_manageable(db, user, active) ? {
        id: active.id,
        label: active.label,
        position_ids: quickReport_positionIds(active),
        created_at: active.created_at,
        row_version: active.row_version
      } : null,
      can_manage_active: !active || await quickReport_manageable(db, user, active)
    };
  }
  if (method === "POST" && p.length === 1) return await tx(db, async () => {
    const active = await one(db, "SELECT * FROM quick_report_links WHERE is_active=1");
    assert(!active || await quickReport_manageable(db, user, active), "Tautan aktif berada di luar cakupan pengelolaan Anda.", 403);
    assert((active?.id || null) === (b.active_link_id || null), "Tautan sudah berubah. Buka kembali pengaturan tautan.", 409);
    if (active) assert(active.row_version === b.row_version, "Tautan sudah berubah. Buka kembali pengaturan tautan.", 409);
    const ids = b.position_ids, allowed = await quickReport_securityPositions(db, user);
    assert(Array.isArray(ids) && ids.length > 0 && ids.every((id) => typeof id === "string" && allowed.some((p2) => p2.id === id)) && new Set(ids).size === ids.length, "Pilih posisi pegawai Keamanan yang termasuk cakupan Anda.");
    assert((await quickReport_eligibleEmployees(db, ids)).length > 0, "Belum ada pegawai Keamanan aktif untuk posisi yang dipilih.");
    if (active) {
      await update(db, "quick_report_links", active.id, active.row_version, {
        is_active: 0,
        revoked_at: now()
      });
      await audit(db, user, "REVOKE", "quick_report_links", active.id);
    }
    const token = quickReportRandomBytes(32).toString("hex"), row = await insert(db, "quick_report_links", {
      token_hash: digest(token),
      label: text(b.label || "Laporan Keamanan", "Nama tautan", 120),
      position_ids: JSON.stringify(ids),
      is_active: 1,
      created_by: user.id
    });
    await audit(db, user, "CREATE", "quick_report_links", row.id, {
      position_ids: ids
    });
    return {
      id: row.id,
      label: row.label,
      token,
      row_version: row.row_version
    };
  });
  if (method === "POST" && p.length === 3 && p[2] === "revoke") return await tx(db, async () => {
    const link = await get(db, "quick_report_links", p[1]);
    assert(await quickReport_manageable(db, user, link), "Akses pengelolaan tautan ditolak.", 403);
    assert(link.is_active, "Tautan sudah dinonaktifkan.", 409);
    await update(db, "quick_report_links", link.id, b.row_version, {
      is_active: 0,
      revoked_at: now()
    });
    await audit(db, user, "REVOKE", "quick_report_links", link.id);
    return {
      revoked: true
    };
  });
  assert(false, "Alamat tidak ditemukan.", 404);
}
async function takeQuickReportSlot(db, clientIp, action) {
  assert(typeof clientIp === "string" && clientIp.length <= 45 && /^[a-f0-9:.]+$/i.test(clientIp), "Permintaan tidak valid.", 400);
  assert(["context", "submit"].includes(action), "Alamat tidak ditemukan.", 404);
  const stamp = now(), cutoff = new Date(Date.now() - 10 * 6e4).toISOString(), key = digest(`quick-report\0${action}\0${clientIp}`);
  await run(db, "DELETE FROM quick_report_rate_limits WHERE window_start<?", new Date(Date.now() - 24 * 36e5).toISOString());
  const slot = await one(db, "SELECT * FROM quick_report_rate_limits WHERE id=?", key);
  if (!slot) await insert(db, "quick_report_rate_limits", {
    id: key,
    window_start: stamp,
    hits: 1
  });
  else if (slot.window_start < cutoff) await update(db, "quick_report_rate_limits", key, slot.row_version, {
    window_start: stamp,
    hits: 1
  });
  else await update(db, "quick_report_rate_limits", key, slot.row_version, {
    hits: slot.hits + 1
  });
  return !slot || slot.window_start < cutoff || slot.hits < (action === "context" ? 120 : 30);
}
var quickReport_receipt = (row) => ({
  reference: `LB-${row.id.slice(0, 8).toUpperCase()}`,
  received_at: row.created_at
});
async function publicQuickReport(db, action, b, dataDir, requestId) {
  const link = await quickReport_validLink(db, b.token), people = await quickReport_eligibleEmployees(db, quickReport_positionIds(link));
  if (action === "context") return {
    label: link.label,
    employees: people.map((e) => ({
      id: e.id,
      full_name: e.full_name,
      position_name: e.position_name
    }))
  };
  assert(action === "submit", "Alamat tidak ditemukan.", 404);
  assert(!b.website, "Permintaan tidak valid.");
  const employee = people.find((e) => e.id === b.employee_id);
  assert(employee, "Pilih pegawai Keamanan aktif dari daftar.");
  assert(typeof b.idempotency_key === "string" && /^[a-f0-9-]{36}$/i.test(b.idempotency_key), "Kunci laporan tidak valid.");
  const locationName = b.location_name === void 0 ? null : text(b.location_name, "Nama tempat / lokasi patroli", 200);
  const notes = text(b.activity_notes, "Uraian kegiatan", 1e4), type = enumValue(b.activity_type, ["JAGA", "PATROLI", "LAINNYA"]);
  assert(Array.isArray(b.photos) && b.photos.length >= 1 && b.photos.length <= 5, "Ambil minimal satu dan maksimal lima foto.");
  let bytes = 0;
  const photos = b.photos.map((photo) => {
    assert(photo && photo.source === "CAMERA" && ["image/jpeg", "image/png"].includes(photo.mime_type) && typeof photo.data === "string" && photo.data.length <= 21e5 && /^[A-Za-z0-9+/]+={0,2}$/.test(photo.data), "Foto tidak valid atau terlalu besar. Ambil foto kembali.");
    const decoded = Buffer2.from(photo.data, "base64");
    assert(decoded.length > 0 && decoded.toString("base64") === photo.data, "Isi foto tidak valid.");
    assert(photo.mime_type === "image/png" ? decoded.subarray(0, 8).equals(Buffer2.from([137, 80, 78, 71, 13, 10, 26, 10])) : decoded[0] === 255 && decoded[1] === 216 && decoded[2] === 255, "Isi foto tidak cocok dengan jenisnya.");
    bytes += photo.data.length;
    return {
      mime_type: photo.mime_type,
      data: photo.data,
      captured_at: photo.captured_at,
      source: "CAMERA"
    };
  });
  assert(bytes <= 84e5, "Jumlah ukuran foto terlalu besar. Kurangi foto.");
  assert(new Set(photos.map((p) => digest(p.data))).size === photos.length, "Foto yang sama tidak dapat digunakan berulang.");
  const fingerprint = digest(JSON.stringify({
    link: link.id,
    employee: employee.id,
    type,
    notes,
    ...locationName ? { location_name: locationName } : {},
    location: b.location,
    photos
  }));
  const previous = await one(db, "SELECT * FROM logbook_entries WHERE idempotency_key=?", b.idempotency_key);
  if (previous) {
    assert(previous.report_source === "PUBLIC_LINK" && previous.report_link_id === link.id && previous.request_fingerprint === fingerprint, "Kunci laporan sudah digunakan. Periksa hasil pengiriman sebelumnya.", 409);
    return quickReport_receipt(previous);
  }
  const input = {
    occurred_at: now(),
    activity_type: type,
    activity_notes: notes,
    location: b.location,
    ...locationName ? { location_name: locationName } : {},
    idempotency_key: b.idempotency_key,
    photos: photos.map((p, i) => ({
      file_id: `pending-${i}`,
      source: p.source,
      captured_at: p.captured_at
    }))
  };
  const details = fieldReportDetails(input, employee.id, employee.org_unit_id, false, true);
  const actor = {
    id: null,
    request_id: requestId
  };
  const uploaded = await asyncMap(photos, async (photo, i) => {
    const file = await storeUpload(db, actor, {
      name: `laporan-${i + 1}.${photo.mime_type === "image/png" ? "png" : "jpg"}`,
      mime_type: photo.mime_type,
      data: photo.data
    }, dataDir);
    return {
      file_id: file.id,
      captured_at: photo.captured_at,
      capture_source: "CAMERA"
    };
  });
  const row = await insert(db, "logbook_entries", {
    ...details.payload,
    idempotency_key: b.idempotency_key,
    request_fingerprint: fingerprint,
    report_source: "PUBLIC_LINK",
    report_link_id: link.id,
    created_by: null
  });
  await attachEvidence(db, actor, "logbook", row.id, uploaded);
  await audit(db, actor, "PUBLIC_SUBMISSION", "logbook_entries", row.id, {
    employee_id: employee.id,
    report_link_id: link.id,
    identity: "SELF_REPORTED"
  });
  return quickReport_receipt(row);
}
async function briefingAllowed(db, user, action, row) {
  if (await can(db, user, "hr.briefings.manage", row)) return true;
  if (action !== "read" || row.deleted_at) return false;
  if (await can(db, user, "hr.briefings.read", row)) return true;
  if (!user.employee_id) return false;
  const key = `briefing-placement:${user.id}`, cache = db.authorizationCache;
  const placements = cache?.has(key) ? cache.get(key) : await all(db, `SELECT p.org_unit_id FROM employees e JOIN employee_placements ep ON ep.employee_id=e.id
    JOIN positions p ON p.id=ep.position_id AND p.is_active=1 JOIN org_units u ON u.id=p.org_unit_id AND u.is_active=1
    WHERE e.id=? AND e.is_active=1 AND ep.is_primary=1 AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?)`, user.employee_id, today(), today());
  cache?.set(key, placements);
  return placements.length === 1 && placements[0].org_unit_id === row.org_unit_id;
}
async function briefingRoutes({ db, user, p, method, body: b = {}, url }) {
  if (p[0] !== "briefings") return void 0;
  if (p[1] === "form-link") {
    assert(p.length === 2, "Alamat tidak ditemukan.", 404);
    const active = await one(db, "SELECT * FROM briefing_links WHERE is_active=1 AND revoked_at IS NULL");
    if (method === "GET") {
      assert(user.employee_id || await has(db, user, "hr.briefings.manage"), "Hubungkan akun dengan data pegawai melalui SDM untuk mengisi briefing.", 403);
      if (!active) return {
        available: false
      };
      assert(typeof active.share_token === "string" && digest(active.share_token) === active.token_hash, "Tautan belum tersedia.", 503);
      return {
        available: true,
        label: active.label,
        token: active.share_token,
        id: active.id,
        row_version: active.row_version
      };
    }
    assert(await can(db, user, "hr.briefings.manage"), "Hanya pengelola SDM seluruh unit yang dapat mengelola tautan.", 403);
    if (method === "POST") return await tx(db, async () => {
      assert(active ? b.id === active.id && b.row_version === active.row_version : !b.id, "Tautan sudah berubah. Buka kembali pengelolaan tautan.", 409);
      assert(["create", "rotate", "revoke"].includes(b.action), "Tindakan tautan tidak valid.");
      assert(b.action !== "create" || !active, "Tautan aktif sudah tersedia.", 409);
      assert(b.action === "create" || active, "Tautan aktif tidak ditemukan.", 409);
      if (active) {
        await update(db, "briefing_links", active.id, b.row_version, {
          is_active: 0,
          revoked_at: now()
        });
        await audit(db, user, "REVOKE", "briefing_links", active.id);
      }
      if (b.action === "revoke") return {
        available: false
      };
      const token = randomBytes(32).toString("hex"), row2 = await insert(db, "briefing_links", {
        token_hash: digest(token),
        share_token: token,
        label: "Briefing Pagi (Wewarah Semeng)",
        is_active: 1,
        created_by: user.id
      });
      await audit(db, user, "CREATE", "briefing_links", row2.id);
      return {
        available: true,
        id: row2.id,
        row_version: row2.row_version,
        label: row2.label,
        token
      };
    });
    assert(false, "Metode tidak diizinkan.", 405);
  }
  if (method === "GET" && p.length === 1) {
    const includeArchived = url?.searchParams.get("archived") === "1";
    const from = url?.searchParams.get("from"), to = url?.searchParams.get("to"), unit = url?.searchParams.get("unit"), search = url?.searchParams.get("search")?.trim().toLocaleLowerCase("id") || "";
    if (from) date(from, "Tanggal mulai");
    if (to) date(to, "Tanggal akhir");
    assert(!(from && to) || from <= to, "Rentang tanggal tidak valid.");
    assert(search.length <= 200, "Pencarian terlalu panjang.");
    const rows = await asyncFilter(await all(db, `SELECT * FROM morning_briefings WHERE (?='' OR held_on>=?) AND (?='' OR held_on<=?) AND (?='' OR org_unit_id=?) ORDER BY held_on DESC,submitted_at DESC`, from || "", from || "", to || "", to || "", unit || "", unit || ""), async (row2) => await briefingAllowed(db, user, "read", row2) && (includeArchived || !row2.deleted_at) && (!search || [row2.employee_name, row2.department, row2.section, row2.briefing_notes].some((v) => v.toLocaleLowerCase("id").includes(search))));
    const units = await asyncFilter(await all(db, "SELECT id,name FROM org_units WHERE is_active=1 ORDER BY name"), async (u) => await briefingAllowed(db, user, "read", {
      org_unit_id: u.id
    }));
    const current = await one(db, `SELECT count(*) n FROM employees e JOIN employee_placements ep ON ep.employee_id=e.id JOIN positions p ON p.id=ep.position_id JOIN org_units u ON u.id=p.org_unit_id WHERE e.id=? AND e.is_active=1 AND ep.is_primary=1 AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?) AND p.is_active=1 AND u.is_active=1`, user.employee_id, today(), today());
    return {
      items: await asyncMap(rows, async ({ payload_hash, response_id, link_id, ...row2 }) => ({
        ...row2,
        can_manage: await briefingAllowed(db, user, "manage", row2)
      })),
      units,
      can_manage: await has(db, user, "hr.briefings.manage"),
      can_manage_link: await can(db, user, "hr.briefings.manage"),
      can_fill: Number(current?.n) === 1,
      needs_placement: !await has(db, user, "hr.briefings.manage") && Number(current?.n) !== 1
    };
  }
  assert(p.length === 2, "Alamat tidak ditemukan.", 404);
  const row = await get(db, "morning_briefings", p[1]);
  if (method === "GET") {
    assert(await briefingAllowed(db, user, "read", row), "Akses briefing ditolak.", 403);
    const { payload_hash, response_id, link_id, ...safe } = row;
    return {
      ...safe,
      can_manage: await briefingAllowed(db, user, "manage", row),
      files: await linkedFiles(db, "briefing", row.id)
    };
  }
  assert(await briefingAllowed(db, user, "manage", row), "Akses pengelolaan briefing ditolak.", 403);
  if (method === "PATCH") return await tx(db, async () => {
    const reason = text(b.reason, "Alasan perubahan", 1e3);
    let changes;
    if (b.action === "archive") changes = {
      deleted_at: now(),
      deleted_by: user.id
    };
    else if (b.action === "restore") changes = {
      deleted_at: null,
      deleted_by: null
    };
    else {
      assert(!row.deleted_at, "Pulihkan briefing sebelum mengubahnya.", 409);
      const held = date(b.held_on, "Tanggal briefing");
      assert(held <= today(), "Tanggal briefing tidak boleh di masa depan.");
      changes = {
        held_on: held,
        section: text(b.section, "Bagian / urusan", 200),
        absent_notes: text(b.absent_notes, "Pegawai yang tidak hadir", 3e3),
        briefing_notes: text(b.briefing_notes, "Materi wewarah dan kendala", 1e4)
      };
    }
    const saved = await update(db, "morning_briefings", row.id, b.row_version, changes);
    await audit(db, user, b.action === "archive" ? "ARCHIVE" : b.action === "restore" ? "RESTORE" : "UPDATE", "morning_briefings", row.id, {
      fields: Object.keys(changes)
    }, reason);
    return {
      id: saved.id,
      row_version: saved.row_version
    };
  });
  assert(false, "Metode tidak diizinkan.", 405);
}
var merchandiseRoutes = /* @__PURE__ */ (() => {
  const price = (value) => integer(value, "Harga (rupiah)", 0, 1e9);
  const qty = (value) => integer(value, "Jumlah barang", 0, 1e6);
  const productFields = "id,sku,name,buy_price,sell_price,stock_qty,is_active,row_version";
  const visibleProduct = (row, costs) => costs ? row : (({ buy_price, ...rest }) => rest)(row);
  const saleItems = async (db, id) => await all(db, "SELECT * FROM merchandise_sale_items WHERE sale_id=? ORDER BY created_at,id", id);
  const canCosts = async (db, user) => await has(db, user, "merchandise.catalog.costs");
  async function stockMove(db, user, product, kind, delta, reason, saleId = null, target = null) {
    const before = product.stock_qty;
    const after = kind === "INITIAL" ? target : before + delta;
    assert(Number.isSafeInteger(after) && after >= 0 && after <= 1e6, "Stok tidak cukup atau jumlah melebihi batas.", 409);
    await update(db, "merchandise_products", product.id, product.row_version, {
      stock_qty: after
    });
    return await insert(db, "merchandise_stock_movements", {
      product_id: product.id,
      sale_id: saleId,
      kind,
      quantity_delta: kind === "INITIAL" ? after : delta,
      balance_before: before,
      balance_after: after,
      reason,
      created_by: user.id
    });
  }
  async function productList(db, user) {
    const costs = await canCosts(db, user);
    return (await all(db, `SELECT ${productFields} FROM merchandise_products ORDER BY sku`)).map((p) => visibleProduct(p, costs));
  }
  async function saleList(db, user, from, to) {
    const costs = await canCosts(db, user);
    const rows = await all(db, "SELECT * FROM merchandise_sales WHERE sold_on>=? AND sold_on<=? ORDER BY created_at DESC,id DESC", from, to);
    return await asyncMap(rows, async (r) => ({
      ...r,
      ...!costs ? {
        cost_total: void 0
      } : {},
      items: (await saleItems(db, r.id)).map((item) => costs ? item : (({ unit_cost, ...rest }) => rest)(item))
    }));
  }
  function dateRange(url) {
    const todayValue = today();
    const from = date(url.searchParams.get("from") || `${todayValue.slice(0, 7)}-01`);
    const to = date(url.searchParams.get("to") || todayValue);
    assert(from <= to, "Tanggal awal harus lebih dahulu daripada tanggal akhir.");
    return {
      from,
      to
    };
  }
  function totals(sales) {
    const active = sales.filter((s) => s.status === "COMPLETED");
    return {
      transaction_count: active.length,
      units_sold: active.flatMap((s) => s.items).reduce((n, i) => n + Number(i.quantity), 0),
      revenue: active.reduce((n, s) => n + Number(s.total), 0),
      cost: active.reduce((n, s) => n + Number(s.cost_total || 0), 0)
    };
  }
  async function merchandiseRoutes2(c) {
    const { db, user, p, method, body: b = {}, url } = c;
    if (p[0] !== "merchandise") return void 0;
    const part = p[1], id = p[2], action = p[3];
    if (method === "GET" && (!part || part === "overview")) {
      await requireAccess(db, user, "merchandise.catalog.read");
      const products = await productList(db, user), { from, to } = dateRange(url), sales = await has(db, user, "merchandise.reports.read") ? await saleList(db, user, from, to) : [];
      const summary = totals(sales);
      return {
        products_total: products.length,
        products_uninitialized: products.filter((r) => r.stock_qty === null).length,
        products_low: products.filter((r) => r.stock_qty !== null && r.stock_qty <= 5).length,
        ...summary,
        ...!await canCosts(db, user) ? {
          cost: void 0
        } : {},
        capabilities: {
          catalog_manage: await has(db, user, "merchandise.catalog.manage"),
          costs: await canCosts(db, user),
          stock_record: await has(db, user, "merchandise.stock.record"),
          stock_adjust: await has(db, user, "merchandise.stock.adjust"),
          sales_create: await has(db, user, "merchandise.sales.create"),
          sales_void: await has(db, user, "merchandise.sales.void"),
          reports: await has(db, user, "merchandise.reports.read"),
          export: await has(db, user, "merchandise.reports.export")
        }
      };
    }
    if (part === "products" && method === "GET" && !id) {
      await requireAccess(db, user, "merchandise.catalog.read");
      return {
        items: await productList(db, user)
      };
    }
    if (part === "products" && method === "POST" && !id) {
      await requireAccess(db, user, "merchandise.catalog.manage");
      const sku = text(b.sku, "SKU", 40).toUpperCase(), name = text(b.name, "Nama barang", 160);
      assert(/^[A-Z0-9-]+$/.test(sku), "SKU hanya boleh huruf, angka, dan tanda hubung.");
      return await tx(db, async () => {
        assert(!await one(db, "SELECT id FROM merchandise_products WHERE sku=?", sku), "Kode barang sudah dipakai.", 409);
        const saved = await insert(db, "merchandise_products", {
          sku,
          name,
          buy_price: price(b.buy_price),
          sell_price: price(b.sell_price),
          stock_qty: null,
          is_active: 1,
          created_by: user.id
        });
        await audit(db, user, "CREATE", "merchandise_products", saved.id, {
          sku
        });
        return visibleProduct(saved, await canCosts(db, user));
      });
    }
    if (part === "products" && id && method === "PATCH" && !action) {
      await requireAccess(db, user, "merchandise.catalog.manage");
      return await tx(db, async () => {
        const old = await get(db, "merchandise_products", id);
        const values = {};
        if (b.name !== void 0) values.name = text(b.name, "Nama barang", 160);
        if (b.sell_price !== void 0) values.sell_price = price(b.sell_price);
        if (b.buy_price !== void 0) values.buy_price = price(b.buy_price);
        if (b.is_active !== void 0) {
          assert(typeof b.is_active === "boolean", "Status barang tidak valid.");
          values.is_active = Number(b.is_active);
        }
        assert(Object.keys(values).length, "Tidak ada perubahan.");
        const saved = await update(db, "merchandise_products", id, b.row_version, values);
        await audit(db, user, "UPDATE", "merchandise_products", id, {
          fields: Object.keys(values)
        });
        return visibleProduct(saved, await canCosts(db, user));
      });
    }
    if (part === "products" && id && action === "stock" && method === "POST") {
      await requireAccess(db, user, "merchandise.stock.record");
      const kind = enumValue(b.kind, ["INITIAL", "IN", "ADJUST"], "Jenis mutasi stok");
      if (kind === "ADJUST") await requireAccess(db, user, "merchandise.stock.adjust");
      const amount = qty(b.quantity), reason = text(b.reason, "Alasan perubahan stok", 300);
      return await tx(db, async () => {
        const product = await get(db, "merchandise_products", id);
        assert(product.row_version === b.row_version, "Stok berubah. Muat ulang daftar barang.", 409);
        if (kind === "INITIAL") assert(product.stock_qty === null, "Stok awal sudah dicatat. Gunakan barang masuk atau penyesuaian.", 409);
        else assert(product.stock_qty !== null, "Masukkan stok awal terlebih dahulu.", 409);
        assert(kind !== "IN" || amount > 0, "Jumlah barang masuk harus lebih dari nol.");
        const movement = await stockMove(db, user, product, kind, kind === "IN" ? amount : kind === "ADJUST" ? amount - product.stock_qty : amount, reason, null, amount);
        await audit(db, user, "STOCK_" + kind, "merchandise_products", id, {
          before: movement.balance_before,
          after: movement.balance_after,
          reason
        });
        return {
          ok: true,
          stock_qty: movement.balance_after,
          row_version: product.row_version + 1
        };
      });
    }
    if (part === "stock" && method === "GET") {
      await requireAccess(db, user, "merchandise.stock.read");
      return {
        items: await all(db, "SELECT m.*,p.sku,p.name product_name,u.username actor_name FROM merchandise_stock_movements m JOIN merchandise_products p ON p.id=m.product_id JOIN users u ON u.id=m.created_by ORDER BY m.created_at DESC,m.id DESC LIMIT 2000")
      };
    }
    if (part === "sales" && method === "GET" && !id) {
      await requireAccess(db, user, "merchandise.sales.read");
      const { from, to } = dateRange(url);
      return {
        items: await saleList(db, user, from, to),
        from,
        to
      };
    }
    if (part === "sales" && method === "POST" && !id) {
      await requireAccess(db, user, "merchandise.sales.create");
      assert(Array.isArray(b.items) && b.items.length > 0 && b.items.length <= 50, "Pilih 1\u201350 barang dalam transaksi.");
      const items = b.items.map((i) => ({
        product_id: text(i.product_id, "ID barang", 64),
        quantity: integer(i.quantity, "Jumlah beli", 1, 1e4)
      }));
      assert(new Set(items.map((i) => i.product_id)).size === items.length, "Barang yang sama tidak boleh dimasukkan dua kali.");
      const payment = enumValue(b.payment_method, ["TUNAI", "QRIS", "TRANSFER", "LAINNYA"], "Metode pembayaran");
      const note = b.note ? text(b.note, "Catatan", 300) : null;
      return await tx(db, async () => {
        const snapshot = await asyncMap(items, async (item) => {
          const product = await get(db, "merchandise_products", item.product_id);
          assert(product.is_active === 1, "Barang tidak aktif.", 409);
          assert(product.stock_qty !== null, "Stok awal barang belum diisi.", 409);
          assert(product.stock_qty >= item.quantity, `Stok ${product.name} tidak mencukupi.`, 409);
          return {
            ...item,
            product,
            subtotal: item.quantity * product.sell_price,
            cost_total: item.quantity * product.buy_price
          };
        });
        const total = snapshot.reduce((n, item) => n + item.subtotal, 0);
        const costTotal = snapshot.reduce((n, item) => n + item.cost_total, 0);
        assert(Number.isSafeInteger(total) && Number.isSafeInteger(costTotal), "Total transaksi tidak valid.");
        const soldOn = today(), saleNo = `MR-${soldOn.replaceAll("-", "")}-${uid().slice(0, 8).toUpperCase()}`;
        const sale = await insert(db, "merchandise_sales", {
          sale_no: saleNo,
          sold_on: soldOn,
          payment_method: payment,
          status: "COMPLETED",
          total,
          cost_total: costTotal,
          note,
          created_by: user.id
        });
        for (const item of snapshot) {
          await insert(db, "merchandise_sale_items", {
            sale_id: sale.id,
            product_id: item.product.id,
            sku: item.product.sku,
            product_name: item.product.name,
            quantity: item.quantity,
            unit_price: item.product.sell_price,
            unit_cost: item.product.buy_price,
            subtotal: item.subtotal
          });
          await stockMove(db, user, item.product, "SALE", -item.quantity, `Penjualan ${saleNo}`, sale.id);
        }
        await audit(db, user, "SALE", "merchandise_sales", sale.id, {
          sale_no: saleNo,
          total,
          item_count: items.length
        });
        return {
          id: sale.id,
          sale_no: saleNo,
          total,
          sold_on: soldOn
        };
      });
    }
    if (part === "sales" && id && action === "void" && method === "POST") {
      await requireAccess(db, user, "merchandise.sales.void");
      const reason = text(b.reason, "Alasan pembatalan", 300);
      return await tx(db, async () => {
        const sale = await get(db, "merchandise_sales", id);
        assert(sale.status === "COMPLETED", "Transaksi sudah dibatalkan.", 409);
        assert(sale.row_version === b.row_version, "Transaksi berubah. Muat ulang.", 409);
        for (const item of await saleItems(db, id)) {
          const product = await get(db, "merchandise_products", item.product_id);
          await stockMove(db, user, product, "VOID", item.quantity, `Pembatalan ${sale.sale_no}: ${reason}`, sale.id);
        }
        const updated = await update(db, "merchandise_sales", id, b.row_version, {
          status: "VOID",
          void_reason: reason,
          voided_at: now(),
          voided_by: user.id
        });
        await audit(db, user, "VOID", "merchandise_sales", id, {
          sale_no: sale.sale_no,
          reason
        });
        return {
          ok: true,
          status: updated.status
        };
      });
    }
    if (part === "reports" && method === "GET") {
      await requireAccess(db, user, "merchandise.reports.read");
      const { from, to } = dateRange(url), sales = await saleList(db, user, from, to);
      const summary = totals(sales), costs = await canCosts(db, user);
      return {
        from,
        to,
        summary: costs ? summary : (({ cost, ...rest }) => rest)(summary),
        sales,
        stock: await productList(db, user),
        movements: await has(db, user, "merchandise.stock.read") ? await all(db, "SELECT m.*,p.sku,p.name product_name FROM merchandise_stock_movements m JOIN merchandise_products p ON p.id=m.product_id WHERE substr(m.created_at,1,10)>=? AND substr(m.created_at,1,10)<=? ORDER BY m.created_at DESC", from, to) : []
      };
    }
    if (part === "reports" && p[2] === "export" && method === "POST") {
      await requireAccess(db, user, "merchandise.reports.export");
      await audit(db, user, "EXPORT", "merchandise_reports", b.period || today());
      return {
        ok: true
      };
    }
    return void 0;
  }
  return merchandiseRoutes2;
})();
// --- Modul Pengelolaan Kunjungan, dibangkitkan dari lib/visit*.mjs dan lib/guide-form.mjs ---
const __visits = (() => {
  const randomBytes = __visits_randomBytes;
  const randomUUID = __visits_randomUUID;
  const createHash = __visits_createHash;
  const createHmac = __visits_createHmac;
  const createHash2 = __visits_createHash2;
  const randomUUID2 = __visits_randomUUID2;
// supabase/functions/_shared/portal/arrays.mjs
async function asyncMap(items, fn) {
  const out = [];
  for (let i = 0; i < items.length; i++) out.push(await fn(items[i], i, items));
  return out;
}

// supabase/functions/_shared/portal/visits.mjs

// supabase/functions/_shared/portal/db.mjs
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
async function update(db, table, id, version, values) {
  assert(Number.isInteger(version), "Versi data wajib dikirim. Muat ulang data.", 409);
  const row = { ...values, updated_at: now() };
  const result = await run(db, `UPDATE ${sqlName(table)} SET ${Object.keys(row).map((k) => `${sqlName(k)}=?`).join(",")},row_version=row_version+1 WHERE id=? AND row_version=?`, ...Object.values(row).map((v) => typeof v === "boolean" ? Number(v) : v ?? null), id, version);
  assert(result.changes === 1, "Data sudah berubah. Muat ulang sebelum menyimpan.", 409);
  return one(db, `SELECT * FROM ${sqlName(table)} WHERE id=?`, id);
}
async function tx(db, work) {
  assert(db.inTransaction, "Transaction required.", 500);
  return await work();
}
async function audit(db, actor, action, type, key, summary = {}, reason = "") {
  await insert(db, "audit_events", { actor_user_id: actor?.id || null, action, object_type: type, object_key: String(key), occurred_at: now(), outcome: "SUCCESS", request_id: actor?.request_id || uid(), reason, change_summary: JSON.stringify(summary) });
}
function date(v, label = "Tanggal") {
  assert(typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, `${label} tidak valid.`);
  return v;
}

// supabase/functions/_shared/portal/auth.mjs
var digest = (value) => createHash("sha256").update(value).digest("hex");
var purchasingRoleCodes = {
  PURCHASE_REQUESTER: ["Pemohon Pengadaan", ["purchasing.requests.create", "purchasing.requests.read"]],
  PURCHASING_STAFF: ["Staf Purchasing", ["purchasing.requests.read", "purchasing.procurement.manage", "purchasing.vendors.read", "purchasing.vendors.manage", "purchasing.vendors.sensitive", "purchasing.budget.read", "purchasing.reports.read"]],
  FINANCE_VERIFIER: ["Verifikator Keuangan", ["purchasing.requests.read", "purchasing.requests.verify", "purchasing.budget.read", "purchasing.budget.manage", "purchasing.vendors.read", "purchasing.vendors.sensitive", "purchasing.reports.read"]],
  PURCHASE_AUDITOR: ["Pemeriksa SPI", ["purchasing.requests.read", "purchasing.vendors.read", "purchasing.budget.read", "purchasing.reports.read", "purchasing.reports.export", "admin.audit.read"]],
  PURCHASE_ADMIN: ["Pengelola Pengadaan", ["purchasing.settings.manage", "purchasing.requests.read", "purchasing.vendors.read", "purchasing.vendors.manage", "purchasing.vendors.sensitive", "purchasing.budget.read", "purchasing.budget.manage"]]
};
var purchasingRoles = Object.entries(purchasingRoleCodes).map(([code, [name, codes]]) => [code, name, (c) => codes.includes(c)]);
var merchandiseRoleCodes = {
  BISNIS_PIMPINAN: ["Pimpinan Bisnis", ["merchandise.catalog.read", "merchandise.catalog.costs", "merchandise.stock.read", "merchandise.sales.read", "merchandise.reports.read", "merchandise.reports.export"]],
  BISNIS_MANAGER: ["Pengelola Bisnis", ["merchandise.catalog.read", "merchandise.catalog.manage", "merchandise.catalog.costs", "merchandise.stock.read", "merchandise.stock.record", "merchandise.stock.adjust", "merchandise.sales.read", "merchandise.sales.create", "merchandise.sales.void", "merchandise.reports.read", "merchandise.reports.export"]],
  BISNIS_KOORDINATOR: ["Koordinator Merchandise", ["merchandise.catalog.read", "merchandise.catalog.costs", "merchandise.stock.read", "merchandise.stock.record", "merchandise.stock.adjust", "merchandise.sales.read", "merchandise.sales.create", "merchandise.reports.read", "merchandise.reports.export"]],
  BISNIS_PETUGAS: ["Petugas Penjualan Merchandise", ["merchandise.catalog.read", "merchandise.stock.read", "merchandise.stock.record", "merchandise.sales.read", "merchandise.sales.create"]]
};
var merchandiseRoles = Object.entries(merchandiseRoleCodes).map(([code, [name, codes]]) => [code, name, (c) => codes.includes(c)]);
var visitRoleCodes = {
  KUNJUNGAN_PENGELOLA: ["Pengelola Kunjungan", ["visits.dashboard.read", "visits.guides.read", "visits.guides.manage", "visits.records.read", "visits.forms.read", "visits.forms.manage", "visits.reports.read", "visits.reports.export", "visits.settings.manage"]],
  KUNJUNGAN_PIMPINAN: ["Pimpinan Kunjungan", ["visits.dashboard.read", "visits.guides.read", "visits.records.read", "visits.reports.read", "visits.reports.export"]]
};
var visitRoles = Object.entries(visitRoleCodes).map(([code, [name, codes]]) => [code, name, (c) => codes.includes(c)]);
async function grants(db, user) {
  const key = `grants:${user.id}`, cache = db.authorizationCache;
  if (cache?.has(key)) return cache.get(key);
  const rows = await all(db, `SELECT ur.id,ur.scope_kind,p.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id AND r.is_active=1 JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=?`, user.id);
  cache?.set(key, rows);
  return rows;
}
async function has(db, user, permission) {
  return (await grants(db, user)).some((g) => g.code === permission);
}

// supabase/functions/_shared/portal/guide-form.mjs

// supabase/functions/_shared/portal/visit-data.mjs
var visitRules = Object.freeze({
  jedaMenit: 15,
  umurMaksHari: 30,
  retensiHari: 42,
  minimalPengantaran: 5,
  jumlahPeringkat: 10,
  reviewMaks: 20,
  importMaks: 2e3
});
var reguInfo = Object.freeze([{
  kode: "A1",
  kategori: "Asing",
  nomor: 1
}, {
  kode: "A2",
  kategori: "Asing",
  nomor: 2
}, {
  kode: "D1",
  kategori: "Domestik",
  nomor: 1
}, {
  kode: "D2",
  kategori: "Domestik",
  nomor: 2
}]);
var reguCodes = reguInfo.map((r) => r.kode);
var witaOffset = 8 * 36e5;
var witaDate = (ms) => new Date(ms + witaOffset).toISOString().slice(0, 10);
var shiftDate = (day, days) => new Date(Date.parse(day + "T00:00:00Z") + days * 864e5).toISOString().slice(0, 10);
var monthLastDay = (month) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
var nextMonth = (month) => {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
function monthsBetween(fromMonth, toMonth) {
  const out = [];
  for (let m = fromMonth; m <= toMonth; m = nextMonth(m)) out.push(m);
  return out;
}
var guideView = (g) => ({
  guideId: g.id,
  guideName: g.name,
  kategori: g.kategori,
  regu: g.regu,
  aktif: Number(g.is_active) === 1,
  row_version: Number(g.row_version)
});
var visitGuideList = async (db) => (await all(db, "SELECT * FROM visit_guides ORDER BY seq")).map(guideView);
function parseGuideId(value) {
  const m = /^G-(\d{1,7})$/.exec(String(value ?? "").trim().toUpperCase());
  return m && Number(m[1]) >= 1 ? {
    id: `G-${m[1]}`,
    seq: Number(m[1])
  } : null;
}
var cleanName = (value) => typeof value === "string" || typeof value === "number" ? String(value).trim().replace(/\s+/g, " ") : "";
function normalizeKategori(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "asing" ? "Asing" : v === "domestik" ? "Domestik" : null;
}
function normalizeRegu(value) {
  const codes = [...new Set((Array.isArray(value) ? value : String(value ?? "").split(/[,;/]/)).map((x) => String(x).trim().toUpperCase()).filter(Boolean))];
  return codes.length >= 1 && codes.length <= 2 && codes.every((c) => reguCodes.includes(c)) ? codes.join(", ") : null;
}
function parseActive(value) {
  if (value === void 0 || value === null || value === "") return true;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const v = String(value).trim().toLowerCase();
  if (["true", "ya", "y", "1", "aktif", "yes"].includes(v)) return true;
  if (["false", "tidak", "t", "0", "nonaktif", "tidak aktif", "no"].includes(v)) return false;
  return null;
}
var nameKey = (name) => name.toLocaleLowerCase("id").replace(/\s+/g, " ").trim();
var sharesRegu = (a, b) => a.split(", ").some((code) => b.split(", ").includes(code));
var twinOf = (guides, candidate) => guides.find((g) => g.id !== candidate.id && nameKey(g.name) === nameKey(candidate.name) && sharesRegu(g.regu, candidate.regu));
var formatGuideId = (seq) => `G-${String(seq).padStart(3, "0")}`;
async function saveVisitGuide(db, user, b, audit2) {
  const name = cleanName(b.guideName);
  assert(name.length >= 1 && name.length <= 120, "Nama guide wajib diisi (maksimal 120 huruf).");
  const kategori = normalizeKategori(b.kategori);
  assert(kategori, "Kategori harus Asing atau Domestik.");
  const regu = normalizeRegu(b.regu);
  assert(regu, "Pilih regu yang valid: A1, A2, D1, atau D2 (paling banyak dua).");
  assert(typeof b.aktif === "boolean", "Status aktif wajib dipilih.");
  const guides = await all(db, "SELECT id,name,regu FROM visit_guides");
  if (b.guideId !== void 0 && b.guideId !== null && b.guideId !== "") {
    const parsed = parseGuideId(b.guideId);
    assert(parsed, "ID guide tidak valid.");
    const current = await one(db, "SELECT * FROM visit_guides WHERE id=?", parsed.id);
    assert(current, "Guide tidak ditemukan.", 404);
    const twin2 = twinOf(guides, {
      id: current.id,
      name,
      regu
    });
    assert(!twin2, `Nama ini sudah dipakai ${twin2?.id} di regu yang sama. Beri pembeda dalam kurung, misalnya "${name} (2)".`, 409);
    const saved2 = await update(db, "visit_guides", current.id, b.row_version, {
      name,
      kategori,
      regu,
      is_active: b.aktif ? 1 : 0,
      updated_by: user.id
    });
    await audit2(db, user, "UPDATE", "visit_guides", current.id, {
      kategori,
      regu,
      aktif: b.aktif
    });
    return {
      ...guideView(saved2),
      created: false
    };
  }
  const twin = twinOf(guides, {
    id: null,
    name,
    regu
  });
  assert(!twin, `Nama ini sudah dipakai ${twin?.id} di regu yang sama. Beri pembeda dalam kurung, misalnya "${name} (2)".`, 409);
  const seq = Number((await one(db, "SELECT coalesce(max(seq),0) AS n FROM visit_guides")).n) + 1;
  const saved = await insert(db, "visit_guides", {
    id: formatGuideId(seq),
    seq,
    name,
    kategori,
    regu,
    is_active: b.aktif ? 1 : 0,
    created_by: user.id,
    updated_by: user.id
  });
  await audit2(db, user, "CREATE", "visit_guides", saved.id, {
    kategori,
    regu,
    aktif: b.aktif
  });
  return {
    ...guideView(saved),
    created: true
  };
}
async function importVisitGuides(db, user, b, audit2) {
  assert(Array.isArray(b.rows) && b.rows.length > 0, "Berkas tidak berisi baris guide.");
  assert(b.rows.length <= visitRules.importMaks, `Maksimal ${visitRules.importMaks} baris per impor.`, 413);
  const existing = new Map((await all(db, "SELECT * FROM visit_guides")).map((g) => [g.id, g]));
  const seqOwner = new Map([...existing.values()].map((g) => [Number(g.seq), g.id]));
  const errors = [], plan = [], seen = /* @__PURE__ */ new Map();
  b.rows.forEach((r, index) => {
    const line = Number.isInteger(r?.line) && r.line > 0 && r.line < 1e6 ? r.line : index + 2;
    if (!r || typeof r !== "object" || Array.isArray(r)) {
      errors.push({
        line,
        message: "Baris tidak valid."
      });
      return;
    }
    const problems = [];
    let parsed = null;
    if (r.guideId !== void 0 && r.guideId !== null && String(r.guideId).trim() !== "") {
      parsed = parseGuideId(r.guideId);
      if (!parsed) problems.push("ID guide harus berbentuk G-angka, misalnya G-001");
      else if (seen.has(parsed.seq)) problems.push(`ID ${parsed.id} sudah ada di baris ${seen.get(parsed.seq)}`);
      else {
        seen.set(parsed.seq, line);
        const owner = seqOwner.get(parsed.seq);
        if (owner && owner !== parsed.id) problems.push(`ID ${parsed.id} bentrok dengan ${owner} yang sudah tersimpan`);
      }
    }
    const name = cleanName(r.guideName);
    if (!name || name.length > 120) problems.push("Nama guide wajib diisi (maksimal 120 huruf)");
    const kategori = normalizeKategori(r.kategori);
    if (!kategori) problems.push("Kategori harus Asing atau Domestik");
    const regu = normalizeRegu(r.regu);
    if (!regu) problems.push("Regu harus A1, A2, D1, atau D2 (paling banyak dua, dipisah koma)");
    const active = parseActive(r.aktif);
    if (active === null) problems.push("Kolom aktif harus TRUE/FALSE atau Ya/Tidak");
    if (problems.length) {
      errors.push({
        line,
        message: problems.join("; ")
      });
      return;
    }
    plan.push({
      line,
      id: parsed?.id || null,
      seq: parsed?.seq || null,
      name,
      kategori,
      regu,
      is_active: active ? 1 : 0
    });
  });
  const finalGuides = new Map([...existing.values()].map((g) => [g.id, {
    id: g.id,
    name: g.name,
    regu: g.regu
  }]));
  plan.forEach((p, i) => {
    finalGuides.set(p.id || `baris-${i}`, {
      id: p.id || `baris-${i}`,
      name: p.name,
      regu: p.regu
    });
  });
  const warnings = [];
  plan.forEach((p, i) => {
    const key = p.id || `baris-${i}`, twin = twinOf([...finalGuides.values()], {
      id: key,
      name: p.name,
      regu: p.regu
    });
    if (twin) warnings.push({
      line: p.line,
      message: `Nama "${p.name}" juga dipakai ${twin.id.startsWith("baris-") ? "baris lain di berkas" : twin.id} di regu yang sama`
    });
  });
  let created = 0, changed = 0, unchanged = 0;
  for (const p of plan) {
    const current = p.id && existing.get(p.id);
    if (!current) created++;
    else if (current.name === p.name && current.kategori === p.kategori && current.regu === p.regu && Number(current.is_active) === p.is_active) unchanged++;
    else changed++;
  }
  const summary = {
    total: b.rows.length,
    create: created,
    update: changed,
    unchanged,
    error_count: errors.length,
    errors: errors.slice(0, 100),
    warning_count: warnings.length,
    warnings: warnings.slice(0, 100)
  };
  if (b.apply !== true) return {
    ...summary,
    applied: false
  };
  assert(!errors.length, `${errors.length} baris belum valid. Perbaiki berkasnya lalu impor ulang.`);
  let next = Math.max(0, ...[...existing.values()].map((g) => Number(g.seq)), ...plan.filter((p) => p.seq).map((p) => p.seq)) + 1;
  const stamp = now();
  for (const p of plan) {
    const current = p.id && existing.get(p.id);
    if (!current) {
      const seq = p.seq || next++;
      await insert(db, "visit_guides", {
        id: p.id || formatGuideId(seq),
        seq,
        name: p.name,
        kategori: p.kategori,
        regu: p.regu,
        is_active: p.is_active,
        created_by: user.id,
        updated_by: user.id
      });
    } else if (!(current.name === p.name && current.kategori === p.kategori && current.regu === p.regu && Number(current.is_active) === p.is_active)) {
      await run(db, "UPDATE visit_guides SET name=?,kategori=?,regu=?,is_active=?,updated_by=?,updated_at=?,row_version=row_version+1 WHERE id=?", p.name, p.kategori, p.regu, p.is_active, user.id, stamp, p.id);
    }
  }
  await audit2(db, user, "IMPORT", "visit_guides", "berkas", {
    created,
    updated: changed,
    unchanged,
    rows: b.rows.length
  });
  return {
    ...summary,
    applied: true
  };
}
var recordView = (r) => ({
  evaluationId: r.id,
  timestamp: r.evaluated_at,
  tanggal: r.wita_date,
  pos: Number(r.pos),
  guideId: r.guide_id,
  guideName: r.guide_name,
  regu: r.regu || "",
  uniform: Number(r.uniform),
  idCard: Number(r.id_card),
  etika: Number(r.etika),
  review: Number(r.review),
  catatan: r.catatan || "",
  receivedAt: r.received_at,
  koreksiDari: r.koreksi_dari || "",
  status: r.status,
  digantiOleh: r.replaced_by || ""
});
async function visitRecordPage(db, q) {
  const where = ["e.wita_date>=?", "e.wita_date<=?"], args = [q.from, q.to];
  if (q.pos) {
    where.push("e.pos=?");
    args.push(q.pos);
  }
  if (q.status) {
    where.push("e.status=?");
    args.push(q.status);
  }
  if (q.guideId) {
    where.push("e.guide_id=?");
    args.push(q.guideId);
  }
  if (q.regu) {
    where.push("g.regu LIKE ?");
    args.push(`%${q.regu}%`);
  }
  const from = ` FROM visit_evaluations e LEFT JOIN visit_guides g ON g.id=e.guide_id WHERE ${where.join(" AND ")}`;
  const total = Number((await one(db, `SELECT count(*) AS n${from}`, ...args)).n);
  const items = (await all(db, `SELECT e.*,g.regu${from} ORDER BY e.evaluated_at DESC,e.id LIMIT ? OFFSET ?`, ...args, q.limit, q.offset)).map(recordView);
  return {
    items,
    total,
    more: q.offset + items.length < total,
    folded_through: (await one(db, "SELECT folded_through FROM visit_sheet_state WHERE id=1"))?.folded_through || null
  };
}
var emptyStat = () => ({
  antar: 0,
  uniform: 0,
  idCard: 0,
  review: 0,
  etika: 0,
  uniformPatuh: 0
});
function addStat(target, n) {
  target.antar += n.antar;
  target.uniform += n.uniform;
  target.idCard += n.idCard;
  target.review += n.review;
  target.etika += n.etika;
  target.uniformPatuh += n.uniformPatuh;
  return target;
}
function statFor(map, key) {
  let s = map.get(key);
  if (!s) {
    s = emptyStat();
    map.set(key, s);
  }
  return s;
}
var visitFigures = (s) => {
  const antar = s ? s.antar : 0;
  return {
    pengantaran: antar,
    persenUniform: antar ? s.uniformPatuh / antar : null,
    persenId: antar ? s.idCard / antar : null,
    mutuUniform: antar ? s.uniform / antar : null,
    rataEtika: antar ? s.etika / antar : null
  };
};
function rankBy(list, key, ascending, count) {
  return list.slice().sort((a, b) => {
    const diff = ascending ? a[key] - b[key] : b[key] - a[key];
    if (diff) return diff;
    if (a.antar !== b.antar) return b.antar - a.antar;
    const x = a.nama.toLowerCase(), y = b.nama.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }).slice(0, count);
}
async function visitPeriod(db, from, to) {
  const folded = (await one(db, "SELECT folded_through FROM visit_sheet_state WHERE id=1"))?.folded_through || null;
  if (!folded || from > folded) return {
    from,
    to,
    folded,
    months: []
  };
  const monthStart = from.slice(8) === "01", monthEnd = to === monthLastDay(to.slice(0, 7));
  assert(monthStart && (to >= folded || monthEnd), `Rincian harian sampai ${folded} hanya tersimpan di spreadsheet tahunan. Untuk periode itu pilih bulan penuh (mulai tanggal 1 dan berakhir di akhir bulan), atau buka spreadsheetnya.`);
  return {
    from,
    to,
    folded,
    months: monthsBetween(from.slice(0, 7), (to >= folded ? folded : to).slice(0, 7))
  };
}
async function visitOverview(db, from, to) {
  const period = await visitPeriod(db, from, to);
  const guides = await all(db, "SELECT id,name,kategori,regu,is_active FROM visit_guides ORDER BY seq");
  const byId = new Map(guides.map((g) => [g.id, g]));
  const total = /* @__PURE__ */ new Map(), byPos = /* @__PURE__ */ new Map(), guideDays = /* @__PURE__ */ new Map(), days = /* @__PURE__ */ new Set(), foldedDays = /* @__PURE__ */ new Map();
  let foldedAllDays = 0;
  for (const r of await all(db, "SELECT guide_id,pos,uniform,id_card,review,etika,wita_date FROM visit_evaluations WHERE status='aktif' AND wita_date>=? AND wita_date<=?", from, to)) {
    const uniform = Number(r.uniform), n2 = {
      antar: 1,
      uniform,
      idCard: Number(r.id_card),
      review: Number(r.review),
      etika: Number(r.etika),
      uniformPatuh: uniform >= 1 ? 1 : 0
    };
    addStat(statFor(total, r.guide_id), n2);
    addStat(statFor(byPos, `${r.guide_id}|${Number(r.pos)}`), n2);
    days.add(r.wita_date);
    let set = guideDays.get(r.guide_id);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      guideDays.set(r.guide_id, set);
    }
    set.add(r.wita_date);
  }
  if (period.months.length) {
    for (const t of await all(db, "SELECT * FROM visit_monthly_totals WHERE month>=? AND month<=?", period.months[0], period.months.at(-1))) {
      const n2 = {
        antar: Number(t.antar),
        uniform: Number(t.uniform),
        idCard: Number(t.id_card),
        review: Number(t.review),
        etika: Number(t.etika),
        uniformPatuh: Number(t.uniform_patuh)
      };
      const pos = Number(t.pos);
      if (t.guide_id === "*") {
        if (pos === 0) foldedAllDays += Number(t.hari);
        continue;
      }
      if (pos === 0) {
        addStat(statFor(total, t.guide_id), n2);
        foldedDays.set(t.guide_id, (foldedDays.get(t.guide_id) || 0) + Number(t.hari));
      } else addStat(statFor(byPos, `${t.guide_id}|${pos}`), n2);
    }
  }
  const dayCount = (id) => (guideDays.get(id)?.size || 0) + (foldedDays.get(id) || 0);
  const sum = emptyStat();
  let evaluated = 0;
  for (const s of total.values()) {
    addStat(sum, s);
    if (s.antar) evaluated++;
  }
  const ringkasan = {
    ...visitFigures(sum),
    guideDinilai: evaluated,
    hariDinilai: days.size + foldedAllDays,
    guideAktif: guides.filter((g) => Number(g.is_active) === 1).length
  };
  const perPos = [1, 3].map((pos) => {
    const s = emptyStat();
    let count = 0;
    for (const [key, v] of byPos) if (key.endsWith(`|${pos}`)) {
      addStat(s, v);
      if (v.antar) count++;
    }
    return {
      pos,
      ...visitFigures(s),
      guideDinilai: count
    };
  });
  const perRegu = reguInfo.map((info) => {
    const s = emptyStat();
    let count = 0;
    for (const [id, v] of total) {
      const g = byId.get(id);
      if (!g || !g.regu.split(", ").includes(info.kode)) continue;
      addStat(s, v);
      if (v.antar) count++;
    }
    return {
      regu: info.kode,
      kategori: info.kategori,
      ...visitFigures(s),
      guideDinilai: count
    };
  });
  const list = [];
  for (const g of guides) {
    const s = total.get(g.id);
    if (Number(g.is_active) !== 1 || !s || !s.antar) continue;
    const sumNilai = s.uniform + s.idCard + s.etika + s.review;
    list.push({
      guideId: g.id,
      nama: g.name,
      regu: g.regu,
      kategori: g.kategori,
      hari: dayCount(g.id),
      antar: s.antar,
      uniform: s.uniform,
      uniformPatuh: s.uniformPatuh,
      idCard: s.idCard,
      etika: s.etika,
      review: s.review,
      total: sumNilai,
      rataTotal: sumNilai / s.antar,
      taat: (s.uniformPatuh + s.idCard) / (2 * s.antar),
      rataUniform: s.uniform / s.antar,
      rataEtika: s.etika / s.antar
    });
  }
  const n = visitRules.jumlahPeringkat, enough = list.filter((x) => x.antar >= visitRules.minimalPengantaran), short = list.filter((x) => x.antar < visitRules.minimalPengantaran);
  return {
    from,
    to,
    ringkasan,
    perPos,
    perRegu,
    minimalPengantaran: visitRules.minimalPengantaran,
    diperingkat: enough.length,
    belumCukup: short.length,
    peringkat: {
      totalTertinggi: rankBy(enough, "rataTotal", false, n),
      totalTerendah: rankBy(enough, "rataTotal", true, n),
      taatTertinggi: rankBy(enough, "taat", false, n),
      taatTerendah: rankBy(enough, "taat", true, n),
      etikaTertinggi: rankBy(enough, "rataEtika", false, n),
      etikaTerendah: rankBy(enough, "rataEtika", true, n),
      belumCukup: rankBy(short, "antar", false, n)
    },
    perGuide: rankBy(list, "rataTotal", false, list.length),
    periode: {
      folded_through: period.folded,
      bulan_ringkasan: period.months
    },
    diperbarui: now()
  };
}

// supabase/functions/_shared/portal/guide-form.mjs
var guidePosts = {
  1: "Pos 1 \u2014 Pintu Masuk",
  3: "Pos 3 \u2014 Pelataran Utama"
};

// supabase/functions/_shared/portal/visit-sheets.mjs
var visitSheetHeader = Object.freeze(["evaluationId", "timestamp", "pos", "guideId", "guideName", "uniform", "idCard", "review", "etika", "catatan", "receivedAt", "koreksiDari", "status"]);
var visitSheetLimits = Object.freeze({
  batchRows: 500,
  dirtyRows: 200,
  verifyRows: 3e3,
  rangesPerRead: 40,
  growRows: 1e3,
  throttleSeconds: 20,
  retentionEveryHours: 20,
  runs: Object.freeze({
    manual: {
      budgetMs: 2e4,
      leaseSeconds: 45
    },
    auto: {
      budgetMs: 6e4,
      leaseSeconds: 90
    }
  })
});
var columnWidths = [290, 190, 50, 90, 200, 80, 70, 70, 70, 240, 190, 290, 80];
var sheetsApi = "https://sheets.googleapis.com/v4/spreadsheets";
var driveApi = "https://www.googleapis.com/drive/v3/files";
var tokenApi = "https://oauth2.googleapis.com/token";
var folderMime = "application/vnd.google-apps.folder";
var spreadsheetMime = "application/vnd.google-apps.spreadsheet";
var kunjunganFolder = "SPH-Portal-Kunjungan";
var driveIdPattern = /^[A-Za-z0-9_-]{8,200}$/;
var evaluationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
var sheetAccessTokens = /* @__PURE__ */ new Map();
var guideNotes = ["Penilaian Guide \u2014 salinan otomatis dari SPH Portal (modul Pengelolaan Kunjungan).", "Satu tab per bulan, tanggal menurut WITA. Kolomnya sama dengan tab Evaluations aplikasi NilaiGuide lama.", 'Baris berstatus "diganti" adalah penilaian yang dikoreksi petugas pos dan tidak ikut dihitung.', "Jangan mengurutkan, menyisipkan, atau menghapus baris di tab bulanan: portal menulis ke posisi baris yang dicatatnya.", "Untuk mengolah data, gunakan Data \u2192 Tampilan filter, atau salin tab ke spreadsheet lain.", `Portal menyimpan rincian penilaian ${visitRules.retensiHari / 7} minggu terakhir; rincian yang lebih lama hanya ada di spreadsheet ini.`];
function visitSheetConfig(env = {}) {
  const value = (name) => typeof env[name] === "string" ? env[name].trim() : "";
  const config = {
    folder: value("GOOGLE_DRIVE_FOLDER_ID"),
    clientId: value("GOOGLE_DRIVE_CLIENT_ID"),
    clientSecret: value("GOOGLE_DRIVE_CLIENT_SECRET"),
    refreshToken: value("GOOGLE_DRIVE_REFRESH_TOKEN")
  };
  return {
    ...config,
    configured: Boolean(config.clientId && config.clientSecret && config.refreshToken && driveIdPattern.test(config.folder))
  };
}
var visitSheetValues = (r) => [r.id, r.evaluated_at, Number(r.pos), r.guide_id, r.guide_name, Number(r.uniform), Number(r.id_card), Number(r.review), Number(r.etika), r.catatan || "", r.received_at, r.koreksi_dari || "", r.status];
var sameSheetRow = (cells, expected) => Array.isArray(cells) && expected.every((v, i) => typeof v === "number" ? Number(cells[i]) === v && cells[i] !== "" && cells[i] !== void 0 : String(cells[i] ?? "") === v);
var quoteTab = (title) => `'${title}'`;
var monthOfDay = (day) => day.slice(0, 7);
var knownSheetReasons = /* @__PURE__ */ new Set(["invalid_grant", "invalid_client", "unauthorized_client", "access_denied", "SERVICE_DISABLED", "accessNotConfigured", "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "insufficientPermissions", "PERMISSION_DENIED", "insufficientFilePermissions", "appNotAuthorizedToFile", "notFound", "NOT_FOUND", "storageQuotaExceeded", "RATE_LIMIT_EXCEEDED", "rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded", "RESOURCE_EXHAUSTED", "UNAUTHENTICATED", "INVALID_ARGUMENT", "badRequest", "FAILED_PRECONDITION"]);
async function sheetErrorReason(response) {
  const reader = response.body?.getReader();
  if (!reader) return "unknown";
  const chunks = [];
  let size = 0;
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16384) {
        await reader.cancel();
        return "unknown";
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    const body = JSON.parse(new TextDecoder().decode(bytes)), e = body?.error;
    const candidates = typeof e === "string" ? [e] : [...Array.isArray(e?.details) ? e.details.map((d) => d?.reason) : [], ...Array.isArray(e?.errors) ? e.errors.map((x) => x?.reason) : [], e?.status];
    return candidates.find((r) => knownSheetReasons.has(r)) || "unknown";
  } catch {
    return "unknown";
  } finally {
    reader.releaseLock();
  }
}
function sheetFailure(stage, status, reason) {
  let message;
  if (reason === "invalid_grant") message = "Koneksi Google portal perlu dihubungkan ulang: token akses kedaluwarsa atau dicabut.";
  else if (["invalid_client", "unauthorized_client"].includes(reason)) message = "Konfigurasi OAuth Google portal tidak valid.";
  else if (["SERVICE_DISABLED", "accessNotConfigured"].includes(reason)) message = stage.startsWith("drive") ? "Google Drive API belum aktif untuk koneksi portal." : "Google Sheets API belum aktif di project Google Cloud milik OAuth client SPH Portal.";
  else if (["ACCESS_TOKEN_SCOPE_INSUFFICIENT", "insufficientPermissions", "access_denied"].includes(reason)) message = "Izin token Google portal belum mencakup pengelolaan spreadsheet di Drive.";
  else if (["insufficientFilePermissions", "appNotAuthorizedToFile", "PERMISSION_DENIED"].includes(reason)) message = "Aplikasi belum diizinkan mengubah folder atau spreadsheet penilaian guide.";
  else if (["notFound", "NOT_FOUND"].includes(reason) || status === 404) message = stage.startsWith("sheet") ? "Spreadsheet penilaian guide tidak ditemukan (mungkin terhapus). Pulihkan dari Sampah Drive; penyalinan dan penghapusan 6 minggu ditahan sampai spreadsheet kembali." : "Folder Google Drive portal tidak ditemukan atau belum dapat diakses.";
  else if (reason === "storageQuotaExceeded") message = "Penyimpanan Google Drive portal penuh.";
  else if (["RATE_LIMIT_EXCEEDED", "rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded", "RESOURCE_EXHAUSTED"].includes(reason) || status === 429) message = "Batas penggunaan Google tercapai. Penyalinan dicoba lagi nanti.";
  else if (reason === "network_error") message = "Google belum dapat dihubungi. Penyalinan dicoba lagi nanti.";
  else if (reason === "budget") message = "Waktu penyalinan habis; sisanya disalin pada percobaan berikutnya.";
  else message = `Google menolak penyalinan penilaian (tahap ${stage}, HTTP ${status || "\u2014"}).`;
  return new AppError(503, message, {
    service: "google_sheets",
    stage,
    upstream_status: status ?? null,
    reason
  });
}
function sheetClient(config, fetchImpl, deadline, tokenCache) {
  const injected = typeof fetchImpl === "function";
  const send = injected ? fetchImpl : globalThis.fetch.bind(globalThis);
  const cache = tokenCache === void 0 ? injected ? null : sheetAccessTokens : tokenCache;
  const cacheKey = createHash2("sha256").update(JSON.stringify([config.clientId, config.clientSecret, config.refreshToken])).digest("hex");
  let access, pending;
  async function sheetCall(url, init, stage) {
    const left = deadline - Date.now();
    if (left < 5e3) throw sheetFailure(stage, null, "budget");
    let response;
    try {
      response = await send(url, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(Math.min(15e3, left))
      });
    } catch {
      throw sheetFailure(stage, null, "network_error");
    }
    if (!response.ok) {
      if (response.status === 401 && stage !== "token") {
        access = void 0;
        cache?.delete(cacheKey);
      }
      throw sheetFailure(stage, response.status, await sheetErrorReason(response));
    }
    return response.json();
  }
  async function sheetAccessToken() {
    if (access) return access;
    const saved = cache?.get(cacheKey);
    if (saved && saved.expiresAt > Date.now()) {
      access = saved.access;
      return access;
    }
    if (!pending) pending = (async () => {
      const j = await sheetCall(tokenApi, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: config.clientId,
          client_secret: config.clientSecret,
          refresh_token: config.refreshToken
        }).toString()
      }, "token");
      assert(typeof j.access_token === "string" && j.access_token.length > 0 && j.access_token.length < 8192, "Koneksi Google portal belum dapat diakses.", 503);
      access = j.access_token;
      const lifetime = Math.min(Number(j.expires_in), 3600);
      if (cache && Number.isFinite(lifetime) && lifetime > 60) {
        for (const [key, item] of cache) if (item.expiresAt <= Date.now()) cache.delete(key);
        if (cache.size >= 4 && !cache.has(cacheKey)) cache.delete(cache.keys().next().value);
        cache.set(cacheKey, {
          access,
          expiresAt: Date.now() + (lifetime - 60) * 1e3
        });
      }
      return access;
    })();
    try {
      return await pending;
    } finally {
      pending = void 0;
    }
  }
  const sheetAuthed = async (url, init, stage) => await sheetCall(url, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${await sheetAccessToken()}`
    }
  }, stage);
  return {
    token: sheetAccessToken,
    read: async (url, stage) => await sheetAuthed(url, {
      method: "GET",
      headers: {}
    }, stage),
    write: async (url, body, stage) => await sheetAuthed(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }, stage)
  };
}
async function visitSheetStatus(db, nowMs = Date.now()) {
  const s = await one(db, "SELECT * FROM visit_sheet_state WHERE id=1") || {};
  const c = await one(db, "SELECT count(*) AS total,count(*) FILTER(WHERE sheet_row IS NULL) AS pending,count(*) FILTER(WHERE sheet_dirty=1) AS dirty,min(received_at) FILTER(WHERE sheet_row IS NULL) AS oldest FROM visit_evaluations");
  const files = (await all(db, "SELECT year,spreadsheet_id FROM visit_sheet_files ORDER BY year DESC")).map((f) => ({
    year: Number(f.year),
    url: `https://docs.google.com/spreadsheets/d/${f.spreadsheet_id}/edit`
  }));
  return {
    rows: Number(c.total),
    pending: Number(c.pending),
    dirty: Number(c.dirty),
    oldest_pending_at: c.oldest || null,
    running: Boolean(s.lease_until && Date.parse(s.lease_until) > nowMs),
    last_attempt_at: s.last_attempt_at || null,
    last_success_at: s.last_success_at || null,
    last_error: s.last_error || null,
    last_error_at: s.last_error_at || null,
    last_retention_at: s.last_retention_at || null,
    folded_through: s.folded_through || null,
    folder_url: s.folder_id ? `https://drive.google.com/drive/folders/${s.folder_id}` : null,
    files,
    retention_days: visitRules.retensiHari,
    max_age_days: visitRules.umurMaksHari
  };
}
async function takeSheetLease(db, owner, nowMs, leaseSeconds, throttleSeconds) {
  const stamp = new Date(nowMs).toISOString(), s = await one(db, "SELECT lease_until,last_attempt_at FROM visit_sheet_state WHERE id=1");
  if (s.lease_until && s.lease_until > stamp) return {
    ok: false,
    busy: true,
    retry_after_ms: Date.parse(s.lease_until) - nowMs
  };
  if (throttleSeconds && s.last_attempt_at && Date.parse(s.last_attempt_at) > nowMs - throttleSeconds * 1e3) return {
    ok: false,
    throttled: true,
    retry_after_ms: Date.parse(s.last_attempt_at) + throttleSeconds * 1e3 - nowMs
  };
  const changed = await run(db, "UPDATE visit_sheet_state SET lease_owner=?,lease_until=?,last_attempt_at=?,updated_at=? WHERE id=1 AND (lease_until IS NULL OR lease_until<=?)", owner, new Date(nowMs + leaseSeconds * 1e3).toISOString(), stamp, stamp, stamp);
  return changed.changes === 1 ? {
    ok: true
  } : {
    ok: false,
    busy: true,
    retry_after_ms: 5e3
  };
}
async function holdSheetLease(db, owner) {
  const s = await one(db, "SELECT lease_owner,lease_until FROM visit_sheet_state WHERE id=1");
  assert(s && s.lease_owner === owner && s.lease_until > now(), "Penyalinan spreadsheet diambil alih proses lain.", 409);
}
async function finishSheetRun(db, owner, error, keepLease) {
  const stamp = now();
  if (!error) {
    await run(db, "UPDATE visit_sheet_state SET last_success_at=?,last_error=NULL,last_error_at=NULL,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=1 AND lease_owner=?", stamp, stamp, owner);
    return;
  }
  if (keepLease) await run(db, "UPDATE visit_sheet_state SET last_error=?,last_error_at=?,updated_at=? WHERE id=1 AND lease_owner=?", error.slice(0, 300), stamp, stamp, owner);
  else await run(db, "UPDATE visit_sheet_state SET last_error=?,last_error_at=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=1 AND lease_owner=?", error.slice(0, 300), stamp, stamp, owner);
}
var chunked = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};
function groupBy(items, key) {
  const map = /* @__PURE__ */ new Map();
  for (const item of items) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}
async function kunjunganFolderId(ctx) {
  const { google, config } = ctx;
  const url = new URL(driveApi);
  url.searchParams.set("q", `'${config.folder}' in parents and trashed = false and mimeType = '${folderMime}' and appProperties has { key='sph_portal' and value='v1' } and appProperties has { key='sph_module' and value='kunjungan' }`);
  url.searchParams.set("fields", "files(id,parents,trashed,mimeType,appProperties)");
  url.searchParams.set("pageSize", "10");
  url.searchParams.set("orderBy", "createdTime");
  const listing = await google.read(url.href, "drive-folder");
  const found = (listing.files || []).find((f) => driveIdPattern.test(f.id || "") && f.trashed === false && f.mimeType === folderMime && f.parents?.[0] === config.folder);
  if (found) return found.id;
  const created = await google.write(`${driveApi}?fields=id,parents,trashed,mimeType`, {
    name: kunjunganFolder,
    mimeType: folderMime,
    parents: [config.folder],
    appProperties: {
      sph_portal: "v1",
      sph_module: "kunjungan"
    }
  }, "drive-folder");
  assert(driveIdPattern.test(created.id || "") && created.mimeType === folderMime && created.parents?.[0] === config.folder, "Folder SPH-Portal-Kunjungan belum dapat diverifikasi.", 503);
  return created.id;
}
async function yearSpreadsheet(ctx, year) {
  const { google, runTx } = ctx;
  const folderId = await kunjunganFolderId(ctx);
  const url = new URL(driveApi);
  url.searchParams.set("q", `'${folderId}' in parents and trashed = false and mimeType = '${spreadsheetMime}' and appProperties has { key='sph_kind' and value='penilaian-guide' } and appProperties has { key='sph_year' and value='${year}' }`);
  url.searchParams.set("fields", "files(id,trashed,mimeType)");
  url.searchParams.set("pageSize", "10");
  url.searchParams.set("orderBy", "createdTime");
  const listing = await google.read(url.href, "drive-file");
  let id = (listing.files || []).find((f) => driveIdPattern.test(f.id || "") && f.trashed === false && f.mimeType === spreadsheetMime)?.id;
  if (!id) {
    const created = await google.write(`${driveApi}?fields=id,mimeType,parents`, {
      name: `Penilaian Guide ${year}`,
      mimeType: spreadsheetMime,
      parents: [folderId],
      appProperties: {
        sph_portal: "v1",
        sph_module: "kunjungan",
        sph_kind: "penilaian-guide",
        sph_year: String(year)
      }
    }, "drive-file");
    assert(driveIdPattern.test(created.id || "") && created.mimeType === spreadsheetMime, "Spreadsheet penilaian belum dapat diverifikasi.", 503);
    id = created.id;
  }
  const meta = await sheetTabs(ctx, id);
  if (!meta.some((s) => s.title === "Petunjuk") && meta.length === 1 && !/^\d{4}-\d{2}$/.test(meta[0].title)) {
    await google.write(`${sheetsApi}/${encodeURIComponent(id)}:batchUpdate`, {
      requests: [{
        updateSheetProperties: {
          properties: {
            sheetId: meta[0].sheetId,
            title: "Petunjuk",
            gridProperties: {
              rowCount: guideNotes.length + 2,
              columnCount: 1
            }
          },
          fields: "title,gridProperties.rowCount,gridProperties.columnCount"
        }
      }, {
        updateCells: {
          range: {
            sheetId: meta[0].sheetId,
            startRowIndex: 0,
            endRowIndex: guideNotes.length,
            startColumnIndex: 0,
            endColumnIndex: 1
          },
          rows: guideNotes.map((text, i) => ({
            values: [{
              userEnteredValue: {
                stringValue: text
              },
              userEnteredFormat: {
                textFormat: {
                  bold: i === 0
                },
                wrapStrategy: "WRAP"
              }
            }]
          })),
          fields: "userEnteredValue,userEnteredFormat(textFormat,wrapStrategy)"
        }
      }, {
        updateDimensionProperties: {
          range: {
            sheetId: meta[0].sheetId,
            dimension: "COLUMNS",
            startIndex: 0,
            endIndex: 1
          },
          properties: {
            pixelSize: 820
          },
          fields: "pixelSize"
        }
      }]
    }, "sheet-structure");
  }
  return runTx(async (db) => {
    await holdSheetLease(db, ctx.owner);
    await run(db, "INSERT INTO visit_sheet_files(year,spreadsheet_id,created_at) VALUES(?,?,?) ON CONFLICT(year) DO NOTHING", year, id, now());
    await run(db, "UPDATE visit_sheet_state SET folder_id=?,updated_at=? WHERE id=1", folderId, now());
    return await one(db, "SELECT * FROM visit_sheet_files WHERE year=?", year);
  });
}
async function sheetTabs(ctx, spreadsheetId) {
  const meta = await ctx.google.read(`${sheetsApi}/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent("sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))")}`, "sheet-meta");
  return (meta.sheets || []).map((s) => ({
    sheetId: Number(s.properties?.sheetId),
    title: String(s.properties?.title || ""),
    rowCount: Number(s.properties?.gridProperties?.rowCount || 0)
  }));
}
function monthTabRequests(title, sheetId, rows) {
  return [{
    addSheet: {
      properties: {
        sheetId,
        title,
        gridProperties: {
          rowCount: rows,
          columnCount: visitSheetHeader.length,
          frozenRowCount: 1
        }
      }
    }
  }, {
    updateCells: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 0,
        endColumnIndex: visitSheetHeader.length
      },
      rows: [{
        values: visitSheetHeader.map((h) => ({
          userEnteredValue: {
            stringValue: h
          },
          userEnteredFormat: {
            textFormat: {
              bold: true
            },
            backgroundColor: {
              red: 0.93,
              green: 0.95,
              blue: 0.97
            }
          }
        }))
      }],
      fields: "userEnteredValue,userEnteredFormat(textFormat,backgroundColor)"
    }
  }, ...columnWidths.map((pixelSize, i) => ({
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: i,
        endIndex: i + 1
      },
      properties: {
        pixelSize
      },
      fields: "pixelSize"
    }
  })), {
    addProtectedRange: {
      protectedRange: {
        range: {
          sheetId
        },
        description: "Dikelola SPH Portal \u2014 jangan mengurutkan, menyisipkan, atau menghapus baris.",
        warningOnly: true
      }
    }
  }];
}
async function addMonthTabs(ctx, file, meta, titles, pendingByTab) {
  const { runTx } = ctx, used = new Set(meta.map((s) => s.sheetId)), requests = [], added = [];
  for (const title of titles) {
    let sheetId = Number(title.replace("-", ""));
    while (used.has(sheetId)) sheetId++;
    used.add(sheetId);
    const rows = Math.max(visitSheetLimits.growRows, (pendingByTab.get(title)?.length || 0) + 1);
    requests.push(...monthTabRequests(title, sheetId, rows));
    added.push({
      title,
      sheetId,
      rows
    });
  }
  await ctx.google.write(`${sheetsApi}/${encodeURIComponent(file.spreadsheet_id)}:batchUpdate`, {
    requests
  }, "sheet-structure");
  await runTx(async (db) => {
    await holdSheetLease(db, ctx.owner);
    const stamp = now();
    for (const t of added) {
      await run(db, "UPDATE visit_evaluations SET sheet_tab=NULL,sheet_row=NULL,sheet_dirty=0,sheet_verified_at=NULL WHERE sheet_tab=?", t.title);
      await run(db, `INSERT INTO visit_sheet_tabs(title,year,sheet_id,next_row,row_count,created_at,updated_at) VALUES(?,?,?,2,?,?,?)
    ON CONFLICT(title) DO UPDATE SET year=excluded.year,sheet_id=excluded.sheet_id,next_row=2,row_count=excluded.row_count,updated_at=excluded.updated_at`, t.title, Number(file.year), t.sheetId, t.rows, stamp, stamp);
    }
  });
  return added.length;
}
async function rescanMonthTab(ctx, file, tab) {
  const { runTx } = ctx, range2 = encodeURIComponent(`${quoteTab(tab.title)}!A2:A${Math.max(2, tab.rowCount)}`);
  const data = await ctx.google.read(`${sheetsApi}/${encodeURIComponent(file.spreadsheet_id)}/values/${range2}?majorDimension=COLUMNS&valueRenderOption=UNFORMATTED_VALUE`, "sheet-read");
  const column = (data.values?.[0] || []).map((v) => String(v ?? "").trim().toLowerCase());
  let last = 1;
  const found = /* @__PURE__ */ new Map();
  column.forEach((v, i) => {
    if (!v) return;
    last = i + 2;
    if (evaluationIdPattern.test(v) && !found.has(v)) found.set(v, i + 2);
  });
  await runTx(async (db) => {
    await holdSheetLease(db, ctx.owner);
    const stamp = now();
    await run(db, "UPDATE visit_evaluations SET sheet_tab=NULL,sheet_row=NULL,sheet_dirty=0,sheet_verified_at=NULL WHERE sheet_tab=?", tab.title);
    const ids = (await all(db, "SELECT id FROM visit_evaluations WHERE wita_date>=? AND wita_date<=?", `${tab.title}-01`, `${tab.title}-31`)).map((r) => r.id).filter((id) => found.has(id));
    for (const part of chunked(ids, 200)) await run(db, `UPDATE visit_evaluations SET sheet_tab=?,sheet_row=CAST(v.column2 AS INTEGER),sheet_dirty=1,sheet_verified_at=NULL
   FROM (VALUES ${part.map(() => "(?,?)").join(",")}) AS v WHERE visit_evaluations.id=v.column1 AND visit_evaluations.sheet_row IS NULL`, tab.title, ...part.flatMap((id) => [id, String(found.get(id))]));
    await run(db, `INSERT INTO visit_sheet_tabs(title,year,sheet_id,next_row,row_count,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
   ON CONFLICT(title) DO UPDATE SET year=excluded.year,sheet_id=excluded.sheet_id,next_row=excluded.next_row,row_count=excluded.row_count,updated_at=excluded.updated_at`, tab.title, Number(file.year), tab.sheetId, last + 1, tab.rowCount, stamp, stamp);
  });
  return found.size;
}
async function copyRound(ctx, summary) {
  const { google, runTx } = ctx, writtenBefore = summary.written + summary.rewritten;
  const work = await runTx(async (db) => ({
    pending: await all(db, "SELECT * FROM visit_evaluations WHERE sheet_row IS NULL ORDER BY received_at,id LIMIT ?", visitSheetLimits.batchRows),
    dirty: await all(db, "SELECT * FROM visit_evaluations WHERE sheet_dirty=1 ORDER BY sheet_tab,sheet_row LIMIT ?", visitSheetLimits.dirtyRows),
    files: await all(db, "SELECT * FROM visit_sheet_files"),
    tabs: await all(db, "SELECT * FROM visit_sheet_tabs")
  }));
  if (!work.pending.length && !work.dirty.length) return {
    more: false,
    structural: false
  };
  const pendingByTab = groupBy(work.pending, (r) => monthOfDay(r.wita_date)), dirtyByTab = groupBy(work.dirty, (r) => r.sheet_tab);
  const tabRows = new Map(work.tabs.map((t) => [t.title, t])), files = new Map(work.files.map((f) => [Number(f.year), f]));
  const titles = [.../* @__PURE__ */ new Set([...pendingByTab.keys(), ...dirtyByTab.keys()])].sort();
  let structural = false;
  for (const year of [...new Set(titles.map((t) => Number(t.slice(0, 4))))]) {
    const file = files.get(year) || await yearSpreadsheet(ctx, year);
    const meta = await sheetTabs(ctx, file.spreadsheet_id), yearTitles = titles.filter((t) => t.startsWith(`${year}-`));
    const missing = [], grow = [];
    let changed = false;
    for (const title of yearTitles) {
      const sheet = meta.find((s) => s.title === title), known = tabRows.get(title);
      if (!sheet) {
        missing.push(title);
        continue;
      }
      if (!known || Number(known.sheet_id) !== sheet.sheetId) {
        await rescanMonthTab(ctx, file, {
          ...sheet,
          title
        });
        summary.rescanned++;
        changed = true;
        continue;
      }
      const needed = Number(known.next_row) + (pendingByTab.get(title)?.length || 0) - 1;
      if (needed > sheet.rowCount) grow.push({
        title,
        sheetId: sheet.sheetId,
        add: Math.max(visitSheetLimits.growRows, needed - sheet.rowCount),
        rowCount: sheet.rowCount
      });
    }
    if (missing.length) {
      await addMonthTabs(ctx, file, meta, missing, pendingByTab);
      changed = true;
    }
    if (changed) {
      structural = true;
      continue;
    }
    const rewrites = yearTitles.flatMap((t) => dirtyByTab.get(t) || []);
    if (rewrites.length) {
      const cells = [];
      for (const part of chunked(rewrites, visitSheetLimits.rangesPerRead)) {
        const url = new URL(`${sheetsApi}/${encodeURIComponent(file.spreadsheet_id)}/values:batchGet`);
        for (const r of part) url.searchParams.append("ranges", `${quoteTab(r.sheet_tab)}!A${r.sheet_row}`);
        url.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
        const data2 = await google.read(url.href, "sheet-read");
        part.forEach((r, i) => cells.push(String(data2.valueRanges?.[i]?.values?.[0]?.[0] ?? "").trim().toLowerCase()));
      }
      const moved = [...new Set(rewrites.filter((r, i) => cells[i] !== r.id).map((r) => r.sheet_tab))];
      if (moved.length) {
        for (const title of moved) {
          const sheet = meta.find((s) => s.title === title);
          await rescanMonthTab(ctx, file, {
            ...sheet,
            title
          });
          summary.rescanned++;
        }
        structural = true;
        continue;
      }
    }
    if (grow.length) {
      await google.write(`${sheetsApi}/${encodeURIComponent(file.spreadsheet_id)}:batchUpdate`, {
        requests: grow.map((g) => ({
          appendDimension: {
            sheetId: g.sheetId,
            dimension: "ROWS",
            length: g.add
          }
        }))
      }, "sheet-structure");
      await runTx(async (db) => {
        await holdSheetLease(db, ctx.owner);
        for (const g of grow) await run(db, "UPDATE visit_sheet_tabs SET row_count=?,updated_at=? WHERE title=?", g.rowCount + g.add, now(), g.title);
      });
    }
    const data = [], placed = [], nextRows = [];
    for (const title of yearTitles) {
      const rows = pendingByTab.get(title) || [];
      if (!rows.length) continue;
      const start = Number(tabRows.get(title).next_row);
      data.push({
        range: `${quoteTab(title)}!A${start}:M${start + rows.length - 1}`,
        majorDimension: "ROWS",
        values: rows.map(visitSheetValues)
      });
      rows.forEach((r, i) => placed.push({
        id: r.id,
        title,
        row: start + i,
        status: r.status
      }));
      nextRows.push([title, start + rows.length]);
    }
    for (const r of rewrites) data.push({
      range: `${quoteTab(r.sheet_tab)}!A${r.sheet_row}:M${r.sheet_row}`,
      majorDimension: "ROWS",
      values: [visitSheetValues(r)]
    });
    ctx.writing = true;
    await google.write(`${sheetsApi}/${encodeURIComponent(file.spreadsheet_id)}/values:batchUpdate`, {
      valueInputOption: "RAW",
      data
    }, "sheet-write");
    const stamp = now();
    await runTx(async (db) => {
      await holdSheetLease(db, ctx.owner);
      for (const [title, list] of groupBy(placed, (p) => p.title)) for (const part of chunked(list, 150)) await run(db, `UPDATE visit_evaluations SET sheet_tab=?,sheet_row=CAST(v.column2 AS INTEGER),sheet_synced_at=?,sheet_verified_at=NULL,
    sheet_dirty=CASE WHEN visit_evaluations.status=v.column3 THEN 0 ELSE 1 END FROM (VALUES ${part.map(() => "(?,?,?)").join(",")}) AS v WHERE visit_evaluations.id=v.column1 AND visit_evaluations.sheet_row IS NULL`, title, stamp, ...part.flatMap((p) => [p.id, String(p.row), p.status]));
      for (const r of rewrites) await run(db, "UPDATE visit_evaluations SET sheet_synced_at=?,sheet_verified_at=NULL,sheet_dirty=CASE WHEN status=? THEN 0 ELSE 1 END WHERE id=? AND sheet_tab=? AND sheet_row=?", stamp, r.status, r.id, r.sheet_tab, r.sheet_row);
      for (const [title, next] of nextRows) await run(db, "UPDATE visit_sheet_tabs SET next_row=?,updated_at=? WHERE title=?", next, stamp, title);
    });
    ctx.writing = false;
    summary.written += placed.length;
    summary.rewritten += rewrites.length;
  }
  return {
    more: structural || summary.written + summary.rewritten > writtenBefore,
    structural
  };
}
async function verifyOldRows(ctx, summary, cutoff) {
  const { google, runTx } = ctx;
  const work = await runTx(async (db) => ({
    rows: await all(db, "SELECT * FROM visit_evaluations WHERE wita_date<? AND sheet_row IS NOT NULL AND sheet_dirty=0 AND sheet_verified_at IS NULL ORDER BY sheet_tab,sheet_row LIMIT ?", cutoff, visitSheetLimits.verifyRows),
    files: await all(db, "SELECT * FROM visit_sheet_files")
  }));
  if (!work.rows.length) return;
  const files = new Map(work.files.map((f) => [Number(f.year), f]));
  const verified = [], stale = [], moved = /* @__PURE__ */ new Set();
  for (const [title, rows] of groupBy(work.rows, (r) => r.sheet_tab)) {
    const file = files.get(Number(title.slice(0, 4)));
    if (!file) continue;
    const runs = [];
    for (const r of rows) {
      const last = runs.at(-1);
      if (last && Number(r.sheet_row) === last.end + 1 && last.rows.length < 500) {
        last.end++;
        last.rows.push(r);
      } else runs.push({
        start: Number(r.sheet_row),
        end: Number(r.sheet_row),
        rows: [r]
      });
    }
    for (const part of chunked(runs, visitSheetLimits.rangesPerRead)) {
      const url = new URL(`${sheetsApi}/${encodeURIComponent(file.spreadsheet_id)}/values:batchGet`);
      for (const span of part) url.searchParams.append("ranges", `${quoteTab(title)}!A${span.start}:M${span.end}`);
      url.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
      url.searchParams.set("majorDimension", "ROWS");
      const data = await google.read(url.href, "sheet-read");
      part.forEach((span, i) => span.rows.forEach((r, j) => {
        const cells = data.valueRanges?.[i]?.values?.[j];
        if (sameSheetRow(cells, visitSheetValues(r))) verified.push(r);
        else if (String(cells?.[0] ?? "").trim().toLowerCase() === r.id) stale.push(r);
        else moved.add(title);
      }));
    }
  }
  const stamp = now();
  await runTx(async (db) => {
    await holdSheetLease(db, ctx.owner);
    for (const r of verified) await run(db, "UPDATE visit_evaluations SET sheet_verified_at=? WHERE id=? AND sheet_tab=? AND sheet_row=? AND status=? AND sheet_dirty=0", stamp, r.id, r.sheet_tab, r.sheet_row, r.status);
    for (const r of stale) await run(db, "UPDATE visit_evaluations SET sheet_dirty=1,sheet_verified_at=NULL WHERE id=?", r.id);
  });
  summary.verified += verified.length;
  summary.rewrite_queued += stale.length;
  for (const title of moved) {
    const file = files.get(Number(title.slice(0, 4))), sheet = (await sheetTabs(ctx, file.spreadsheet_id)).find((s) => s.title === title);
    if (sheet) {
      await rescanMonthTab(ctx, file, {
        ...sheet,
        title
      });
      summary.rescanned++;
    } else await runTx(async (db) => {
      await holdSheetLease(db, ctx.owner);
      await run(db, "UPDATE visit_evaluations SET sheet_tab=NULL,sheet_row=NULL,sheet_dirty=0,sheet_verified_at=NULL WHERE sheet_tab=?", title);
      await run(db, "DELETE FROM visit_sheet_tabs WHERE title=?", title);
    });
  }
}
async function foldVerifiedDays(db, owner, cutoff) {
  await holdSheetLease(db, owner);
  const blocking = (await one(db, "SELECT min(wita_date) AS d FROM visit_evaluations WHERE wita_date<? AND (sheet_row IS NULL OR sheet_dirty=1 OR sheet_verified_at IS NULL)", cutoff))?.d || null;
  const through = blocking ? shiftDate(blocking, -1) : shiftDate(cutoff, -1);
  const count = Number((await one(db, "SELECT count(*) AS n FROM visit_evaluations WHERE wita_date<=?", through)).n);
  if (!count) return {
    days: 0,
    deleted: 0,
    blocked: Boolean(blocking)
  };
  const sums = "count(*) AS antar,sum(uniform) AS uniform,sum(CASE WHEN uniform>=1 THEN 1 ELSE 0 END) AS uniform_patuh,sum(id_card) AS id_card,sum(review) AS review,sum(etika) AS etika,count(DISTINCT wita_date) AS hari";
  const groups = [...await all(db, `SELECT substr(wita_date,1,7) AS month,guide_id,pos,${sums} FROM visit_evaluations WHERE status='aktif' AND wita_date<=? GROUP BY substr(wita_date,1,7),guide_id,pos`, through), ...await all(db, `SELECT substr(wita_date,1,7) AS month,guide_id,0 AS pos,${sums} FROM visit_evaluations WHERE status='aktif' AND wita_date<=? GROUP BY substr(wita_date,1,7),guide_id`, through), ...await all(db, `SELECT substr(wita_date,1,7) AS month,'*' AS guide_id,0 AS pos,${sums} FROM visit_evaluations WHERE status='aktif' AND wita_date<=? GROUP BY substr(wita_date,1,7)`, through)];
  const stamp = now();
  for (const g of groups) await run(db, `INSERT INTO visit_monthly_totals(month,guide_id,pos,antar,uniform,uniform_patuh,id_card,review,etika,hari,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(month,guide_id,pos) DO UPDATE SET antar=visit_monthly_totals.antar+excluded.antar,uniform=visit_monthly_totals.uniform+excluded.uniform,uniform_patuh=visit_monthly_totals.uniform_patuh+excluded.uniform_patuh,
  id_card=visit_monthly_totals.id_card+excluded.id_card,review=visit_monthly_totals.review+excluded.review,etika=visit_monthly_totals.etika+excluded.etika,hari=visit_monthly_totals.hari+excluded.hari,updated_at=excluded.updated_at`, g.month, g.guide_id, Number(g.pos), Number(g.antar), Number(g.uniform), Number(g.uniform_patuh), Number(g.id_card), Number(g.review), Number(g.etika), Number(g.hari), stamp);
  const days = Number((await one(db, "SELECT count(DISTINCT wita_date) AS n FROM visit_evaluations WHERE wita_date<=?", through)).n);
  const deleted = (await run(db, "DELETE FROM visit_evaluations WHERE wita_date<=?", through)).changes;
  await run(db, "UPDATE visit_sheet_state SET folded_through=?,updated_at=? WHERE id=1", through, stamp);
  return {
    days,
    deleted: Number(deleted),
    blocked: Boolean(blocking)
  };
}
async function retentionPass(ctx, summary, nowMs) {
  const { runTx } = ctx, cutoff = shiftDate(witaDate(nowMs), -visitRules.retensiHari);
  await verifyOldRows(ctx, summary, cutoff);
  const folded = await runTx(async (db) => await foldVerifiedDays(db, ctx.owner, cutoff));
  summary.folded_days += folded.days;
  summary.deleted += folded.deleted;
  summary.retention_blocked = folded.blocked;
  if (!folded.blocked) await runTx(async (db) => {
    await holdSheetLease(db, ctx.owner);
    await run(db, "UPDATE visit_sheet_state SET last_retention_at=?,updated_at=? WHERE id=1", now(), now());
  });
}
async function runVisitSheetSync({ runTx, env, fetchImpl, trigger = "manual", tokenCache, retention = "auto" }) {
  const startedAt = Date.now(), config = visitSheetConfig(env), plan = visitSheetLimits.runs[trigger === "manual" ? "manual" : "auto"];
  if (!config.configured) {
    const message = "Koneksi Google Drive portal belum dikonfigurasi; penilaian tetap tersimpan di portal dan tidak ada yang dihapus.";
    await runTx(async (db) => {
      await run(db, "UPDATE visit_sheet_state SET last_attempt_at=?,last_error=?,last_error_at=?,updated_at=? WHERE id=1 AND lease_owner IS NULL", now(), message, now(), now());
    });
    return {
      ok: false,
      configured: false,
      error: message
    };
  }
  const owner = randomUUID2();
  const lease = await runTx(async (db) => await takeSheetLease(db, owner, startedAt, plan.leaseSeconds, trigger === "manual" ? 0 : visitSheetLimits.throttleSeconds));
  if (!lease.ok) return lease;
  const ctx = {
    runTx,
    config,
    owner,
    writing: false,
    google: sheetClient(config, fetchImpl, startedAt + plan.budgetMs, tokenCache)
  };
  const summary = {
    ok: true,
    written: 0,
    rewritten: 0,
    rescanned: 0,
    verified: 0,
    rewrite_queued: 0,
    folded_days: 0,
    deleted: 0
  };
  try {
    for (let round = 0; round < 4; round++) {
      const r = await copyRound(ctx, summary);
      if (!r.more) break;
    }
    const state = await runTx(async (db) => await one(db, "SELECT last_retention_at FROM visit_sheet_state WHERE id=1"));
    const due = retention === "force" || retention === "auto" && (!state.last_retention_at || Date.parse(state.last_retention_at) < Date.now() - visitSheetLimits.retentionEveryHours * 36e5);
    if (due && startedAt + plan.budgetMs - Date.now() > 8e3) await retentionPass(ctx, summary, Date.now());
    await runTx(async (db) => await finishSheetRun(db, owner, null, false));
  } catch (error) {
    const message = error instanceof AppError || Number.isInteger(error?.status) ? error.message : "Penyalinan spreadsheet gagal karena kesalahan server.";
    if (!(error instanceof AppError || Number.isInteger(error?.status))) console.warn(JSON.stringify({
      event: "visit_sheet_error",
      name: error?.name || "Error"
    }));
    try {
      await runTx(async (db) => await finishSheetRun(db, owner, message, ctx.writing || error?.details?.reason === "network_error"));
    } catch {
    }
    summary.ok = false;
    summary.error = message;
    summary.stage = error?.details?.stage || null;
  }
  summary.status = await runTx(async (db) => await visitSheetStatus(db, Date.now()));
  return summary;
}
async function checkVisitSheetConnection({ runTx, env, fetchImpl, tokenCache }) {
  const config = visitSheetConfig(env), steps = [];
  const step = (key, label, ok, message) => {
    steps.push({
      key,
      label,
      ok,
      message
    });
    return ok;
  };
  if (!step("config", "Konfigurasi koneksi Google", config.configured, config.configured ? "Lengkap." : "Secret GOOGLE_DRIVE_* belum lengkap di server.")) return {
    ok: false,
    steps
  };
  const google = sheetClient(config, fetchImpl, Date.now() + 25e3, tokenCache);
  try {
    await google.token();
    step("token", "Token akses Google", true, "Berhasil diperbarui.");
  } catch (error) {
    step("token", "Token akses Google", false, error.message);
    return {
      ok: false,
      steps
    };
  }
  try {
    const meta = await google.read(`${driveApi}/${encodeURIComponent(config.folder)}?fields=id,mimeType,trashed`, "drive-folder");
    if (!step("drive", "Folder Google Drive portal", meta.mimeType === folderMime && meta.trashed === false, meta.mimeType === folderMime && meta.trashed === false ? "Dapat dibuka." : "Folder tujuan bukan folder aktif.")) return {
      ok: false,
      steps
    };
  } catch (error) {
    step("drive", "Folder Google Drive portal", false, error.message);
    return {
      ok: false,
      steps
    };
  }
  const file = await runTx(async (db) => await one(db, "SELECT * FROM visit_sheet_files ORDER BY year DESC LIMIT 1"));
  try {
    if (file) {
      await google.read(`${sheetsApi}/${encodeURIComponent(file.spreadsheet_id)}?fields=spreadsheetId`, "sheet-meta");
      step("sheets", "Google Sheets API", true, `Spreadsheet ${file.year} dapat dibuka.`);
    } else {
      try {
        await google.read(`${sheetsApi}/sph-portal-pemeriksaan-koneksi-0000?fields=spreadsheetId`, "sheet-probe");
        step("sheets", "Google Sheets API", true, "Aktif.");
      } catch (error) {
        if (error?.details?.upstream_status === 404 || error?.details?.upstream_status === 400) step("sheets", "Google Sheets API", true, "Aktif. Spreadsheet tahun berjalan dibuat saat penilaian pertama disalin.");
        else throw error;
      }
    }
  } catch (error) {
    step("sheets", "Google Sheets API", false, error.message);
  }
  return {
    ok: steps.every((s) => s.ok),
    steps
  };
}

// supabase/functions/_shared/portal/visits.mjs
var localDeps = {
  has,
  audit
};
var posts = [1, 3];
var statuses = ["aktif", "diganti"];
var linkView = async (db, link) => link && {
  id: link.id,
  pos: Number(link.pos),
  label: link.label,
  created_at: link.created_at,
  row_version: link.row_version,
  created_by_name: link.created_by ? (await one(db, "SELECT username FROM users WHERE id=?", link.created_by))?.username || "" : ""
};
async function requireAny(db, user, codes, has2, message = "Akses modul kunjungan ditolak.") {
  let allowed = false;
  for (const code of codes) if (await has2(db, user, code)) {
    allowed = true;
    break;
  }
  assert(allowed, message, 403);
}
function range(url) {
  const from = date(url?.searchParams.get("from") || today().slice(0, 8) + "01", "Tanggal mulai"), to = date(url?.searchParams.get("to") || today(), "Tanggal akhir");
  assert(from <= to, "Tanggal mulai harus sebelum tanggal akhir.");
  assert((Date.parse(to) - Date.parse(from)) / 864e5 < 366, "Rentang maksimal 366 hari.");
  return {
    from,
    to
  };
}
async function newLink(db, user, pos) {
  const token = randomBytes(32).toString("hex");
  const row = await insert(db, "guide_form_links", {
    pos,
    label: guidePosts[pos],
    token_hash: digest(token),
    share_token: token,
    is_active: 1,
    created_by: user.id
  });
  return {
    row,
    token
  };
}
async function visitRoutes({ db, user, p, method, body: b = {}, url }, deps = localDeps) {
  if (p[0] !== "visits") return void 0;
  const { has: has2, audit: audit2 } = deps;
  if (p[1] === "links" && p.length === 2) {
    if (method === "GET") {
      await requireAny(db, user, ["visits.forms.read", "visits.forms.manage"], has2);
      const since = new Date(Date.now() - 864e5).toISOString();
      const items = await asyncMap(posts, async (pos2) => {
        const link = await one(db, "SELECT * FROM guide_form_links WHERE pos=? AND is_active=1 AND revoked_at IS NULL", pos2);
        const last = await one(db, "SELECT received_at,outcome FROM guide_form_submissions WHERE pos=? AND outcome IN('ACCEPTED','DUPLICATE') ORDER BY received_at DESC LIMIT 1", pos2);
        const day = await one(db, "SELECT count(*) FILTER(WHERE outcome='ACCEPTED') accepted,count(*) FILTER(WHERE outcome='REJECTED') rejected FROM guide_form_submissions WHERE pos=? AND received_at>=?", pos2, since);
        return {
          pos: pos2,
          label: guidePosts[pos2],
          link: await linkView(db, link) || null,
          last_received_at: last?.received_at || null,
          accepted_24h: Number(day?.accepted || 0),
          rejected_24h: Number(day?.rejected || 0)
        };
      });
      const recent = await all(db, "SELECT pos,outcome,reason,received_at FROM guide_form_submissions ORDER BY received_at DESC LIMIT 30");
      return {
        items,
        recent,
        can_manage: await has2(db, user, "visits.forms.manage")
      };
    }
    assert(method === "POST", "Metode tidak diizinkan.", 405);
    assert(await has2(db, user, "visits.forms.manage"), "Hanya pengelola kunjungan yang dapat mengelola tautan pos.", 403);
    assert(["create", "rotate", "revoke", "copy"].includes(b.action), "Tindakan tautan tidak valid.");
    const pos = Number(b.pos);
    assert(posts.includes(pos), "Pos tidak valid.");
    return await tx(db, async () => {
      const active = await one(db, "SELECT * FROM guide_form_links WHERE pos=? AND is_active=1 AND revoked_at IS NULL", pos);
      if (b.action === "create") {
        assert(!active, `Tautan aktif ${guidePosts[pos]} sudah ada. Gunakan Salin atau Ganti.`, 409);
        const { row: row2, token: token2 } = await newLink(db, user, pos);
        await audit2(db, user, "CREATE", "guide_form_links", row2.id, {
          pos
        });
        return {
          link: await linkView(db, row2),
          token: token2
        };
      }
      assert(active && b.id === active.id && b.row_version === active.row_version, "Tautan sudah berubah. Muat ulang halaman Tautan Pos.", 409);
      if (b.action === "copy") {
        assert(typeof active.share_token === "string" && digest(active.share_token) === active.token_hash, "Salinan tautan tidak tersedia. Gunakan Ganti tautan.", 409);
        await audit2(db, user, "COPY_LINK", "guide_form_links", active.id, {
          pos
        });
        return {
          link: await linkView(db, active),
          token: active.share_token
        };
      }
      await update(db, "guide_form_links", active.id, active.row_version, {
        is_active: 0,
        revoked_at: now(),
        revoked_by: user.id,
        share_token: null
      });
      if (b.action === "revoke") {
        await audit2(db, user, "REVOKE", "guide_form_links", active.id, {
          pos
        });
        return {
          link: null
        };
      }
      const { row, token } = await newLink(db, user, pos);
      await audit2(db, user, "ROTATE", "guide_form_links", row.id, {
        pos,
        replaced: active.id
      });
      return {
        link: await linkView(db, row),
        token
      };
    });
  }
  if (p[1] === "activity" && p.length === 2 && method === "GET") {
    await requireAny(db, user, ["visits.dashboard.read", "visits.forms.read"], has2);
    const since = new Date(Date.now() - 864e5).toISOString();
    return {
      items: await asyncMap(posts, async (pos) => {
        const last = await one(db, "SELECT received_at FROM guide_form_submissions WHERE pos=? AND outcome IN('ACCEPTED','DUPLICATE') ORDER BY received_at DESC LIMIT 1", pos);
        const day = await one(db, "SELECT count(*) FILTER(WHERE outcome='ACCEPTED') accepted,count(*) FILTER(WHERE outcome='REJECTED') rejected FROM guide_form_submissions WHERE pos=? AND received_at>=?", pos, since);
        return {
          pos,
          label: guidePosts[pos],
          last_received_at: last?.received_at || null,
          accepted_24h: Number(day?.accepted || 0),
          rejected_24h: Number(day?.rejected || 0)
        };
      })
    };
  }
  if (p[1] === "exports" && p.length === 2 && method === "POST") {
    assert(await has2(db, user, "visits.reports.export"), "Akses ekspor kunjungan ditolak.", 403);
    assert(["records", "summary"].includes(b.kind), "Jenis ekspor tidak valid.");
    const from = date(b.from, "Tanggal mulai"), to = date(b.to, "Tanggal akhir");
    assert(from <= to, "Rentang tanggal tidak valid.");
    const rows = Number(b.rows);
    assert(Number.isInteger(rows) && rows >= 0 && rows <= 2e5, "Jumlah baris tidak valid.");
    return await tx(db, async () => {
      await audit2(db, user, "EXPORT", "visit_" + b.kind, `${from}..${to}`, {
        row_count: rows
      });
      return {
        ok: true
      };
    });
  }
  if (p[1] === "overview" && p.length === 2 && method === "GET") {
    await requireAny(db, user, ["visits.dashboard.read", "visits.reports.read"], has2);
    const r = range(url);
    return await visitOverview(db, r.from, r.to);
  }
  if (p[1] === "records" && p.length === 2 && method === "GET") {
    await requireAny(db, user, ["visits.records.read"], has2);
    const r = range(url), q = url.searchParams, limit = Number(q.get("limit") || 200), offset = Number(q.get("offset") || 0);
    assert(Number.isInteger(limit) && limit >= 1 && limit <= 1e3 && Number.isInteger(offset) && offset >= 0 && offset <= 2e5, "Halaman tidak valid.");
    const filter = {
      ...r,
      limit,
      offset
    };
    if (q.get("pos")) {
      filter.pos = Number(q.get("pos"));
      assert(posts.includes(filter.pos), "Pos tidak valid.");
    }
    if (q.get("regu")) {
      filter.regu = q.get("regu");
      assert(reguCodes.includes(filter.regu), "Regu tidak valid.");
    }
    if (q.get("status")) {
      filter.status = q.get("status");
      assert(statuses.includes(filter.status), "Status tidak valid.");
    }
    if (q.get("guide")) {
      const parsed = parseGuideId(q.get("guide"));
      assert(parsed, "Guide tidak valid.");
      filter.guideId = parsed.id;
    }
    return await visitRecordPage(db, filter);
  }
  if (p[1] === "guides" && p.length === 2 && method === "GET") {
    await requireAny(db, user, ["visits.guides.read", "visits.guides.manage"], has2);
    return {
      items: await visitGuideList(db),
      can_manage: await has2(db, user, "visits.guides.manage")
    };
  }
  if (p[1] === "guides" && method === "POST" && (p.length === 2 || p.length === 3 && p[2] === "import")) {
    assert(await has2(db, user, "visits.guides.manage"), "Hanya pengelola kunjungan yang dapat mengubah data guide.", 403);
    return await tx(db, async () => p.length === 2 ? await saveVisitGuide(db, user, b, audit2) : await importVisitGuides(db, user, b, audit2));
  }
  if (p[1] === "sheet" && p.length === 2 && method === "GET") {
    await requireAny(db, user, ["visits.dashboard.read", "visits.forms.read", "visits.settings.manage"], has2);
    const status = await visitSheetStatus(db), manage = await has2(db, user, "visits.settings.manage");
    const links = manage || await has2(db, user, "visits.reports.export");
    return {
      ...status,
      files: links ? status.files : status.files.map((f) => ({
        year: f.year
      })),
      folder_url: links ? status.folder_url : null,
      can_sync: manage
    };
  }
  assert(false, "Alamat API tidak ditemukan.", 404);
}
var isVisitSheetAction = (path, method) => method === "POST" && (path === "visits/sheet/sync" || path === "visits/sheet/check");
async function authorizeVisitSheetAction({ db, user }, deps = localDeps) {
  const { has: has2 } = deps;
  assert(!user.must_change_password, "Anda wajib mengganti password sementara terlebih dahulu.", 428);
  assert(await has2(db, user, "visits.settings.manage"), "Hanya pengelola kunjungan yang dapat menjalankan penyalinan spreadsheet.", 403);
  return true;
}
  return { authorizeVisitSheetAction: authorizeVisitSheetAction, checkVisitSheetConnection: checkVisitSheetConnection, isVisitSheetAction: isVisitSheetAction, runVisitSheetSync: runVisitSheetSync, visitRoutes: visitRoutes };
})();
// --- Pengelolaan Kunjungan (build-visits-deploy.mjs) ---
// Galat dari modul kunjungan memakai kelas AppError salinannya sendiri; diubah ke
// AppError snapshot supaya status 403/404/409/422 tidak berubah menjadi 503.
function adoptVisitError(error) {
  if (!(error instanceof AppError) && error instanceof Error && Number.isInteger(error.status) && error.status >= 400 && error.status < 600) throw new AppError(error.status, error.message, error.details);
  throw error;
}
async function visitsSheetRequest(client, identity, storage, b, env, authorize) {
  try {
    await transaction(client, identity, storage, async (db) => {
      const user = await authorize(db);
      return __visits.authorizeVisitSheetAction({ db, user }, { has });
    }, false);
    // Langkah basis data penyalinan menyentuh tabel visit_* saja; serialisasinya
    // dipegang lease visit_sheet_state, bukan kunci global portal.
    const runTx = (work) => transaction(client, identity, storage, work, false);
    if (b.path === "visits/sheet/sync") return await __visits.runVisitSheetSync({ runTx, env, trigger: "manual" });
    return await __visits.checkVisitSheetConnection({ runTx, env });
  } catch (error) {
    adoptVisitError(error);
  }
}
// --- Modul Absensi, dibangkitkan dari lib/attendance*.mjs (build-attendance-deploy.mjs) ---
const __attendance = (() => {
  const Buffer3 = __attendance_Buffer3;
  const randomBytes = __attendance_randomBytes;
  const randomUUID = __attendance_randomUUID;
  const createHash = __attendance_createHash;
  const Buffer = __attendance_Buffer;
  const createHash2 = __attendance_createHash2;
  const webcrypto = __attendance_webcrypto;
  const Buffer2 = __attendance_Buffer2;
  const createHash3 = __attendance_createHash3;
  const randomUUID2 = __attendance_randomUUID2;
// supabase/functions/_shared/portal/arrays.mjs
async function asyncMap(items, fn) {
  const out = [];
  for (let i = 0; i < items.length; i++) out.push(await fn(items[i], i, items));
  return out;
}
async function asyncSome(items, fn) {
  for (let i = 0; i < items.length; i++) if (await fn(items[i], i, items)) return true;
  return false;
}

// supabase/functions/_shared/portal/attendance.mjs

// supabase/functions/_shared/portal/db.mjs
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
async function update(db, table, id, version, values) {
  assert(Number.isInteger(version), "Versi data wajib dikirim. Muat ulang data.", 409);
  const row = { ...values, updated_at: now() };
  const result = await run(db, `UPDATE ${sqlName(table)} SET ${Object.keys(row).map((k) => `${sqlName(k)}=?`).join(",")},row_version=row_version+1 WHERE id=? AND row_version=?`, ...Object.values(row).map((v) => typeof v === "boolean" ? Number(v) : v ?? null), id, version);
  assert(result.changes === 1, "Data sudah berubah. Muat ulang sebelum menyimpan.", 409);
  return one(db, `SELECT * FROM ${sqlName(table)} WHERE id=?`, id);
}
async function tx(db, work) {
  assert(db.inTransaction, "Transaction required.", 500);
  return await work();
}
async function audit(db, actor, action, type, key, summary = {}, reason = "") {
  await insert(db, "audit_events", { actor_user_id: actor?.id || null, action, object_type: type, object_key: String(key), occurred_at: now(), outcome: "SUCCESS", request_id: actor?.request_id || uid(), reason, change_summary: JSON.stringify(summary) });
}
function date(v, label = "Tanggal") {
  assert(typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, `${label} tidak valid.`);
  return v;
}
function instant(v) {
  assert(typeof v === "string" && /(Z|[+-]\d\d:\d\d)$/.test(v) && !isNaN(Date.parse(v)), "Waktu harus menyertakan zona waktu.");
  return new Date(v).toISOString();
}

// supabase/functions/_shared/portal/auth.mjs
var digest = (value) => createHash("sha256").update(value).digest("hex");
var purchasingRoleCodes = {
  PURCHASE_REQUESTER: ["Pemohon Pengadaan", ["purchasing.requests.create", "purchasing.requests.read"]],
  PURCHASING_STAFF: ["Staf Purchasing", ["purchasing.requests.read", "purchasing.procurement.manage", "purchasing.vendors.read", "purchasing.vendors.manage", "purchasing.vendors.sensitive", "purchasing.budget.read", "purchasing.reports.read"]],
  FINANCE_VERIFIER: ["Verifikator Keuangan", ["purchasing.requests.read", "purchasing.requests.verify", "purchasing.budget.read", "purchasing.budget.manage", "purchasing.vendors.read", "purchasing.vendors.sensitive", "purchasing.reports.read"]],
  PURCHASE_AUDITOR: ["Pemeriksa SPI", ["purchasing.requests.read", "purchasing.vendors.read", "purchasing.budget.read", "purchasing.reports.read", "purchasing.reports.export", "admin.audit.read"]],
  PURCHASE_ADMIN: ["Pengelola Pengadaan", ["purchasing.settings.manage", "purchasing.requests.read", "purchasing.vendors.read", "purchasing.vendors.manage", "purchasing.vendors.sensitive", "purchasing.budget.read", "purchasing.budget.manage"]]
};
var purchasingRoles = Object.entries(purchasingRoleCodes).map(([code, [name, codes]]) => [code, name, (c) => codes.includes(c)]);
var merchandiseRoleCodes = {
  BISNIS_PIMPINAN: ["Pimpinan Bisnis", ["merchandise.catalog.read", "merchandise.catalog.costs", "merchandise.stock.read", "merchandise.sales.read", "merchandise.reports.read", "merchandise.reports.export"]],
  BISNIS_MANAGER: ["Pengelola Bisnis", ["merchandise.catalog.read", "merchandise.catalog.manage", "merchandise.catalog.costs", "merchandise.stock.read", "merchandise.stock.record", "merchandise.stock.adjust", "merchandise.sales.read", "merchandise.sales.create", "merchandise.sales.void", "merchandise.reports.read", "merchandise.reports.export"]],
  BISNIS_KOORDINATOR: ["Koordinator Merchandise", ["merchandise.catalog.read", "merchandise.catalog.costs", "merchandise.stock.read", "merchandise.stock.record", "merchandise.stock.adjust", "merchandise.sales.read", "merchandise.sales.create", "merchandise.reports.read", "merchandise.reports.export"]],
  BISNIS_PETUGAS: ["Petugas Penjualan Merchandise", ["merchandise.catalog.read", "merchandise.stock.read", "merchandise.stock.record", "merchandise.sales.read", "merchandise.sales.create"]]
};
var merchandiseRoles = Object.entries(merchandiseRoleCodes).map(([code, [name, codes]]) => [code, name, (c) => codes.includes(c)]);
var visitRoleCodes = {
  KUNJUNGAN_PENGELOLA: ["Pengelola Kunjungan", ["visits.dashboard.read", "visits.guides.read", "visits.guides.manage", "visits.records.read", "visits.forms.read", "visits.forms.manage", "visits.reports.read", "visits.reports.export", "visits.settings.manage"]],
  KUNJUNGAN_PIMPINAN: ["Pimpinan Kunjungan", ["visits.dashboard.read", "visits.guides.read", "visits.records.read", "visits.reports.read", "visits.reports.export"]]
};
var visitRoles = Object.entries(visitRoleCodes).map(([code, [name, codes]]) => [code, name, (c) => codes.includes(c)]);
async function grants(db, user) {
  const key = `grants:${user.id}`, cache = db.authorizationCache;
  if (cache?.has(key)) return cache.get(key);
  const rows = await all(db, `SELECT ur.id,ur.scope_kind,p.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id AND r.is_active=1 JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=?`, user.id);
  cache?.set(key, rows);
  return rows;
}
async function authorizationScopeRows(db, kind, id, target) {
  const key = JSON.stringify(["scope", kind, id, target]), cache = db.authorizationCache;
  if (cache?.has(key)) return cache.get(key);
  const sql = kind === "units" ? "SELECT * FROM user_role_units WHERE user_role_id=?" : kind === "post" ? "SELECT 1 FROM user_role_posts WHERE user_role_id=? AND post_id=?" : "WITH RECURSIVE tree(id) AS (SELECT id FROM org_units WHERE parent_id=? UNION ALL SELECT o.id FROM org_units o JOIN tree t ON o.parent_id=t.id) SELECT id FROM tree WHERE id=?";
  const rows = await all(db, sql, ...kind === "units" ? [id] : [id, target]);
  cache?.set(key, rows);
  return rows;
}
async function can(db, user, permission, context = {}) {
  const matches = (await grants(db, user)).filter((g) => g.code === permission);
  return await asyncSome(matches, async (g) => {
    if (g.scope_kind === "ALL") return true;
    if (g.scope_kind === "SELF") return Boolean(user.employee_id && [context.employee_id, context.reporter_employee_id, ...context.related_employees || []].includes(user.employee_id));
    if (g.scope_kind === "ASSIGNED_POSTS") return permission.startsWith("security.") && Boolean(context.post_id && (await authorizationScopeRows(db, "post", g.id, context.post_id)).length);
    if (!context.org_unit_id) return false;
    return await asyncSome(await authorizationScopeRows(db, "units", g.id), async (u) => {
      if (u.org_unit_id === context.org_unit_id) return true;
      return u.include_descendants && Boolean((await authorizationScopeRows(db, "descendants", u.org_unit_id, context.org_unit_id)).length);
    });
  });
}
async function has(db, user, permission) {
  return (await grants(db, user)).some((g) => g.code === permission);
}

// supabase/functions/_shared/portal/attendance-rules.mjs
var attendanceRules = Object.freeze({
  sessionHours: 16,
  radiusDefault: 100,
  radiusMin: 20,
  radiusMax: 1e3,
  accuracyLimit: 100,
  crowdedPeople: 4,
  crowdedMinutes: 10,
  jumpKmh: 120,
  jumpMinMeters: 1e3,
  jumpWindowHours: 12,
  photoMaxBytes: 300 * 1024,
  photoMaxAgeMinutes: 5,
  locationMaxAgeMinutes: 2,
  photoRetentionDays: 90,
  referenceRetentionDays: 90,
  correctionDays: 7,
  signatureSkewMinutes: 10,
  registrationDays: 7,
  sessionMinutesMax: 30,
  recapMaxDays: 62,
  reviewDays: 31
});
var attendanceFlags = Object.freeze({
  DI_LUAR_TITIK: "Di luar titik",
  GPS_KURANG_AKURAT: "GPS kurang akurat",
  LOKASI_MELOMPAT: "Lokasi melompat",
  HP_PRIBADI_RAMAI: "Banyak pegawai di satu HP pribadi",
  TANPA_FOTO_ACUAN: "Belum ada foto acuan",
  TANPA_MASUK: "Tanpa absen masuk",
  TANPA_PULANG: "Tanpa absen pulang",
  SAAT_CUTI: "Absen saat cuti",
  TITIK_BELUM_ADA: "Titik absen belum diatur"
});
var outsideReasons = Object.freeze({
  DINAS_LUAR: "Dinas luar",
  TUGAS_LAPANGAN: "Tugas lapangan",
  LAINNYA: "Lainnya"
});
var dayNoteKinds = Object.freeze({
  IZIN: "Izin",
  SAKIT: "Sakit",
  DINAS_LUAR: "Dinas luar"
});
var dayStatuses = Object.freeze({
  HADIR: "Hadir",
  BELUM_PULANG: "Masuk, belum pulang",
  TANPA_PULANG: "Hadir, tanpa absen pulang",
  TANPA_MASUK: "Pulang tanpa absen masuk",
  CUTI: "Cuti",
  IZIN: "Izin",
  SAKIT: "Sakit",
  DINAS_LUAR: "Dinas luar",
  TIDAK_ADA_CATATAN: "Tidak ada catatan"
});
var presentStatuses = Object.freeze(["HADIR", "BELUM_PULANG", "TANPA_PULANG", "TANPA_MASUK"]);
var DAY = 864e5;
var witaDate = (ms) => new Date(ms + 8 * 36e5).toISOString().slice(0, 10);
var shiftDay = (day, days) => new Date(Date.parse(day + "T00:00:00Z") + days * DAY).toISOString().slice(0, 10);
function daysBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = shiftDay(d, 1)) out.push(d);
  return out;
}
var parseFlags = (value) => {
  if (Array.isArray(value)) return value.filter((f) => typeof f === "string" && Object.hasOwn(attendanceFlags, f));
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((f) => typeof f === "string" && Object.hasOwn(attendanceFlags, f)) : [];
  } catch {
    return [];
  }
};
function dayStatus({ events = [], corrections = [], note = null, leave = null, nowMs = Date.now() }) {
  const voided = new Set(corrections.filter((c) => c.void_event_id).map((c) => c.void_event_id));
  const live = events.filter((e) => !voided.has(e.id)).sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at)));
  const ins = live.filter((e) => e.kind === "IN"), outs = live.filter((e) => e.kind === "OUT");
  let correctedIn = null, correctedOut = null;
  for (const c of [...corrections].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    if (c.in_at) correctedIn = c.in_at;
    if (c.out_at) correctedOut = c.out_at;
  }
  const inAt = correctedIn || ins[0]?.recorded_at || null;
  let outAt = correctedOut || outs.at(-1)?.recorded_at || null;
  if (inAt && outAt && outAt <= inAt) outAt = null;
  const flags = /* @__PURE__ */ new Set();
  for (const e of live) for (const f of parseFlags(e.flags)) flags.add(f);
  let status;
  if (inAt && outAt) status = "HADIR";
  else if (inAt) status = nowMs - Date.parse(inAt) <= attendanceRules.sessionHours * 36e5 ? "BELUM_PULANG" : "TANPA_PULANG";
  else if (outAt) status = "TANPA_MASUK";
  else if (leave) status = "CUTI";
  else if (note) status = note.kind;
  else status = "TIDAK_ADA_CATATAN";
  if (inAt) flags.delete("TANPA_MASUK");
  else if (outAt) flags.add("TANPA_MASUK");
  if (status === "TANPA_PULANG") flags.add("TANPA_PULANG");
  if (leave && (inAt || outAt)) flags.add("SAAT_CUTI");
  return {
    status,
    in_at: inAt,
    out_at: outAt,
    minutes: inAt && outAt ? Math.round((Date.parse(outAt) - Date.parse(inAt)) / 6e4) : null,
    flags: [...flags],
    corrected: Boolean(correctedIn || correctedOut || voided.size),
    event_ids: live.map((e) => e.id),
    note: note ? {
      id: note.id,
      kind: note.kind,
      note: note.note || ""
    } : null,
    leave_type: leave?.leave_type || null
  };
}
function buildRecap({ employees, events = [], corrections = [], notes = [], leaveDays: leaveDays2 = [], from, to, nowMs = Date.now() }) {
  const key = (employeeId, day) => `${employeeId}\0${day}`;
  const group = (rows, field = "work_date") => {
    const map = /* @__PURE__ */ new Map();
    for (const r of rows) {
      const k = key(r.employee_id, r[field]);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    return map;
  };
  const byEvents = group(events), byCorrections = group(corrections), byLeave = group(leaveDays2);
  const byNotes = new Map(notes.map((n) => [key(n.employee_id, n.work_date), n]));
  const dates = daysBetween(from, to);
  return employees.map((e) => {
    const days = [];
    const summary = {
      hadir: 0,
      tanpa_pulang: 0,
      tanpa_masuk: 0,
      belum_pulang: 0,
      cuti: 0,
      izin: 0,
      sakit: 0,
      dinas_luar: 0,
      tanpa_catatan: 0,
      ditandai: 0,
      menit: 0
    };
    for (const day of dates) {
      const k = key(e.id, day);
      const result = dayStatus({
        events: byEvents.get(k) || [],
        corrections: byCorrections.get(k) || [],
        note: byNotes.get(k) || null,
        leave: byLeave.get(k)?.[0] || null,
        nowMs
      });
      if (presentStatuses.includes(result.status)) summary.hadir++;
      if (result.status === "TANPA_PULANG") summary.tanpa_pulang++;
      if (result.status === "TANPA_MASUK") summary.tanpa_masuk++;
      if (result.status === "BELUM_PULANG") summary.belum_pulang++;
      if (result.status === "CUTI") summary.cuti++;
      if (result.status === "IZIN") summary.izin++;
      if (result.status === "SAKIT") summary.sakit++;
      if (result.status === "DINAS_LUAR") summary.dinas_luar++;
      if (result.status === "TIDAK_ADA_CATATAN") summary.tanpa_catatan++;
      if (result.flags.length) summary.ditandai++;
      if (result.minutes) summary.menit += result.minutes;
      if (result.status !== "TIDAK_ADA_CATATAN" || result.flags.length) days.push({
        date: day,
        ...result
      });
    }
    return {
      employee_id: e.id,
      days,
      summary
    };
  });
}

// supabase/functions/_shared/portal/attendance-form.mjs
var attendanceFormActions = Object.freeze(["registration", "register", "session", "session-register", "context", "search", "person", "submit"]);
var attendanceFormLimits = Object.freeze({
  windowMinutes: 10,
  ip: {
    registration: 60,
    register: 30,
    session: 300,
    "session-register": 120,
    context: 1500,
    search: 800,
    person: 2e3,
    submit: 800
  },
  device: {
    context: 120,
    search: 120,
    person: 300,
    submit: 60
  },
  sharedDevice: {
    context: 300,
    search: 300,
    person: 900,
    submit: 150
  }
});
var peopleSql = `SELECT e.id,e.full_name,e.is_active,ep.supervisor_employee_id,p.org_unit_id,p.name position_name,u.name unit_name
 FROM employees e
 LEFT JOIN employee_placements ep ON ep.employee_id=e.id AND ep.is_primary=1 AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?)
 LEFT JOIN positions p ON p.id=ep.position_id LEFT JOIN org_units u ON u.id=p.org_unit_id`;
function groupPeople(rows) {
  const map = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const list = map.get(r.id) || [];
    list.push(r);
    map.set(r.id, list);
  }
  return [...map.values()].map((list) => ({
    ...list[0],
    ambiguous: list.length !== 1
  }));
}
async function attendancePeople(db, where = "", ...args) {
  const day = witaDate(Date.now());
  return groupPeople(await all(db, `${peopleSql} WHERE e.is_active=1${where ? ` AND ${where}` : ""} ORDER BY e.full_name,e.id`, day, day, ...args));
}
var personView = (p) => p && {
  id: p.id,
  name: p.full_name,
  position: p.position_name || "",
  unit: p.unit_name || ""
};
async function unitTree(db, unitId) {
  return (await all(db, "WITH RECURSIVE tree(id) AS (SELECT id FROM org_units WHERE id=? UNION ALL SELECT o.id FROM org_units o JOIN tree t ON o.parent_id=t.id) SELECT id FROM tree", unitId)).map((r) => r.id);
}
var unitName = async (db, id) => id ? (await one(db, "SELECT name FROM org_units WHERE id=?", id))?.name || "" : "";
async function deviceView(db, d) {
  const owner = d.owner_employee_id ? (await attendancePeople(db, "e.id=?", d.owner_employee_id))[0] || null : null;
  const ownerName = owner ? owner.full_name : d.owner_employee_id ? (await one(db, "SELECT full_name FROM employees WHERE id=?", d.owner_employee_id))?.full_name || "" : "";
  return {
    id: d.id,
    kind: d.kind,
    status: d.status,
    label: d.kind === "SHARED" ? d.label : `HP pribadi ${ownerName}`.trim(),
    owner: owner ? personView(owner) : d.owner_employee_id ? {
      id: d.owner_employee_id,
      name: ownerName,
      position: "",
      unit: ""
    } : null,
    unit: d.kind === "SHARED" ? {
      id: d.org_unit_id,
      name: await unitName(db, d.org_unit_id)
    } : owner?.org_unit_id ? {
      id: owner.org_unit_id,
      name: owner.unit_name
    } : null
  };
}

// supabase/functions/_shared/portal/attendance.mjs
var localDeps = {
  has,
  can,
  audit,
  readPhoto: null
};
var DAY2 = 864e5;
var peopleSql2 = `SELECT e.id,e.employee_no,e.full_name,e.is_active,e.employment_status,ep.supervisor_employee_id,p.org_unit_id,p.name position_name,u.name unit_name
 FROM employees e
 LEFT JOIN employee_placements ep ON ep.employee_id=e.id AND ep.is_primary=1 AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?)
 LEFT JOIN positions p ON p.id=ep.position_id LEFT JOIN org_units u ON u.id=p.org_unit_id`;
async function directory(db, employeeId = null) {
  const day = today(), map = /* @__PURE__ */ new Map();
  const rows = employeeId ? await all(db, `${peopleSql2} WHERE e.id=?`, day, day, employeeId) : await all(db, `${peopleSql2} ORDER BY e.full_name,e.id`, day, day);
  for (const r of rows) {
    const list = map.get(r.id) || [];
    list.push(r);
    map.set(r.id, list);
  }
  return [...map.values()].map((list) => ({
    ...list[0],
    is_active: Number(list[0].is_active) === 1,
    ambiguous: list.length !== 1
  }));
}
var view = (p) => ({
  id: p.id,
  name: p.full_name,
  employee_no: p.employee_no || "",
  position: p.position_name || "",
  unit: p.unit_name || "",
  unit_id: p.org_unit_id || null,
  active: p.is_active,
  ambiguous: p.ambiguous
});
async function scopeOf(db, user, deps) {
  const { has: has2, can: can2 } = deps;
  const people = await directory(db), byId = new Map(people.map((p) => [p.id, p]));
  const subordinates = /* @__PURE__ */ new Set(), direct = /* @__PURE__ */ new Set(), queue = user.employee_id ? [user.employee_id] : [];
  while (queue.length) {
    const parent = queue.shift();
    for (const e of people) if (!e.ambiguous && e.supervisor_employee_id === parent && !subordinates.has(e.id) && e.id !== user.employee_id) {
      subordinates.add(e.id);
      queue.push(e.id);
      if (parent === user.employee_id) direct.add(e.id);
    }
  }
  const hasRead = await has2(db, user, "hr.attendance.read"), hasManage = await has2(db, user, "hr.attendance.manage");
  const allRead = hasRead && await can2(db, user, "hr.attendance.read", {}), allManage = hasManage && await can2(db, user, "hr.attendance.manage", {});
  const readable = /* @__PURE__ */ new Set(), managed = /* @__PURE__ */ new Set();
  for (const e of people) {
    const context = {
      employee_id: e.id,
      org_unit_id: e.org_unit_id
    };
    const manage = allManage || hasManage && await can2(db, user, "hr.attendance.manage", context);
    if (manage) managed.add(e.id);
    if (e.id === user.employee_id || subordinates.has(e.id) || manage || allRead || hasRead && await can2(db, user, "hr.attendance.read", context)) readable.add(e.id);
  }
  return {
    people,
    byId,
    subordinates,
    direct,
    readable,
    managed,
    hasRead,
    hasManage,
    allRead
  };
}
function writeAccess(scope, employeeId) {
  if (scope.managed.has(employeeId)) return {
    allowed: true,
    manager: true
  };
  if (scope.direct.has(employeeId)) return {
    allowed: true,
    manager: false
  };
  return {
    allowed: false,
    manager: false
  };
}
async function targetAccess(db, user, deps, employeeId, message = "Hanya atasan langsung atau Pengelola Absensi yang dapat mengubah data absen pegawai ini.") {
  const { has: has2, can: can2 } = deps;
  assert(typeof employeeId === "string" && employeeId.length <= 100, "Pegawai tidak ditemukan.", 404);
  const [person] = await directory(db, employeeId);
  assert(person, "Pegawai tidak ditemukan.", 404);
  const direct = Boolean(user.employee_id) && !person.ambiguous && person.supervisor_employee_id === user.employee_id && person.id !== user.employee_id;
  const manager = await has2(db, user, "hr.attendance.manage") && await can2(db, user, "hr.attendance.manage", {
    employee_id: person.id,
    org_unit_id: person.org_unit_id
  });
  assert(manager || direct, message, 403);
  return {
    person,
    allowed: true,
    manager
  };
}
function range(url, { maxDays = attendanceRules.recapMaxDays, defaultFrom } = {}) {
  const end = today(), from = date(url?.searchParams.get("from") || defaultFrom || end.slice(0, 8) + "01", "Tanggal mulai"), to = date(url?.searchParams.get("to") || end, "Tanggal akhir");
  assert(from <= to, "Tanggal mulai harus sebelum tanggal akhir.");
  assert((Date.parse(to) - Date.parse(from)) / DAY2 < maxDays, `Rentang maksimal ${maxDays} hari.`);
  return {
    from,
    to
  };
}
var eventSql = `SELECT e.id,e.employee_id,e.kind,e.recorded_at,e.work_date,e.pair_event_id,e.flags,e.within_point,e.point_name,e.distance_m,e.outside_reason,e.outside_note,
 e.accuracy_m,e.latitude,e.longitude,e.device_id,e.photo_storage_key,e.photo_deleted_at,e.confirmed_order,d.kind device_kind,d.label device_label,d.owner_employee_id device_owner
 FROM attendance_events e JOIN attendance_devices d ON d.id=e.device_id`;
async function leaveDays(db, from, to) {
  if (typeof db.query !== "function" && !await one(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='leave_request_days'")) return [];
  return await all(db, "SELECT employee_id,CAST(work_date AS TEXT) work_date,leave_type FROM leave_request_days WHERE state='APPROVED' AND work_date>=? AND work_date<=?", from, to);
}
async function loadRange(db, from, to, ids) {
  const keep = (r) => ids.has(r.employee_id);
  return {
    events: (await all(db, `${eventSql} WHERE e.work_date>=? AND e.work_date<=? ORDER BY e.recorded_at`, from, to)).filter(keep),
    corrections: (await all(db, "SELECT * FROM attendance_corrections WHERE revoked_at IS NULL AND work_date>=? AND work_date<=? ORDER BY created_at", from, to)).filter(keep),
    notes: (await all(db, "SELECT * FROM attendance_day_notes WHERE revoked_at IS NULL AND work_date>=? AND work_date<=?", from, to)).filter(keep),
    leaveDays: (await leaveDays(db, from, to)).filter(keep)
  };
}
async function ownerNames(db, events) {
  const ids = [...new Set(events.map((e) => e.device_owner).filter(Boolean))], names = /* @__PURE__ */ new Map();
  for (const id of ids) names.set(id, (await one(db, "SELECT full_name FROM employees WHERE id=?", id))?.full_name || "");
  return names;
}
function eventView(e, owners) {
  return {
    id: e.id,
    employee_id: e.employee_id,
    kind: e.kind,
    recorded_at: e.recorded_at,
    work_date: e.work_date,
    paired: Boolean(e.pair_event_id),
    flags: parseFlags(e.flags),
    within_point: Number(e.within_point) === 1,
    point_name: e.point_name || null,
    distance_m: e.distance_m == null ? null : Number(e.distance_m),
    outside_reason: e.outside_reason || null,
    outside_note: e.outside_note || "",
    accuracy_m: Math.round(Number(e.accuracy_m)),
    latitude: Number(e.latitude),
    longitude: Number(e.longitude),
    has_photo: Boolean(e.photo_storage_key),
    photo_deleted: Boolean(e.photo_deleted_at),
    device: {
      id: e.device_id,
      kind: e.device_kind,
      label: e.device_kind === "SHARED" ? e.device_label : `HP pribadi ${owners.get(e.device_owner) || ""}`.trim(),
      borrowed: e.device_kind === "PERSONAL" && e.device_owner !== e.employee_id
    }
  };
}
async function filterUnit(db, scope, url) {
  const unit = url?.searchParams.get("unit") || "";
  const ids = new Set(scope.readable);
  if (unit) {
    const units2 = new Set(await unitTree(db, unit));
    for (const id of [...ids]) if (!units2.has(scope.byId.get(id)?.org_unit_id)) ids.delete(id);
  }
  return ids;
}
async function photoOf(db, user, deps, event, scope, kind) {
  const { audit: audit2, readPhoto } = deps;
  assert(event && scope.readable.has(event.employee_id), "Akses foto ditolak.", 403);
  assert(event.photo_storage_key, "Selfie ini sudah dihapus sesuai masa simpan 90 hari.", 404);
  assert(typeof readPhoto === "function", "Penyimpanan selfie belum tersedia.", 503);
  const data = await readPhoto(event.photo_storage_key);
  assert(data && data.length === Number(event.photo_size), "Selfie belum dapat dibaca. Coba lagi.", 503);
  await audit2(db, user, kind === "reference" ? "VIEW_REFERENCE_PHOTO" : "VIEW_PHOTO", "attendance_events", event.id, {
    employee_id: event.employee_id
  });
  return {
    event_id: event.id,
    mime_type: "image/jpeg",
    data: Buffer3.from(data).toString("base64")
  };
}
function tokenPair() {
  const token = randomBytes(32).toString("hex");
  return {
    token,
    hash: digest(token)
  };
}
var units = async (db) => await all(db, "SELECT id,name FROM org_units WHERE is_active=1 ORDER BY name,id");
async function deviceScope(db, user, deps, device, byId = null) {
  const { can: can2 } = deps;
  if (device.kind === "SHARED") return await can2(db, user, "hr.attendance.devices", {
    org_unit_id: device.org_unit_id
  });
  const owner = byId ? byId.get(device.owner_employee_id) : (await directory(db, device.owner_employee_id))[0];
  return await can2(db, user, "hr.attendance.devices", {
    employee_id: device.owner_employee_id,
    org_unit_id: owner?.org_unit_id || null
  });
}
async function sessionView(db, s) {
  const devices = await asyncMap(await all(db, "SELECT * FROM attendance_devices WHERE session_id=? ORDER BY created_at", s.id), async (d) => ({
    ...await deviceView(db, d),
    row_version: d.row_version,
    created_at: d.created_at
  }));
  const counts = /* @__PURE__ */ new Map();
  for (const d of devices) if (d.status !== "REJECTED" && d.owner) counts.set(d.owner.id, (counts.get(d.owner.id) || 0) + 1);
  return {
    id: s.id,
    unit: {
      id: s.org_unit_id,
      name: (await one(db, "SELECT name FROM org_units WHERE id=?", s.org_unit_id))?.name || ""
    },
    expires_at: s.expires_at,
    closed_at: s.closed_at,
    open: !s.closed_at && s.expires_at > now(),
    row_version: s.row_version,
    devices: devices.map((d) => ({
      ...d,
      duplicate_name: Boolean(d.owner && counts.get(d.owner.id) > 1)
    }))
  };
}
async function deviceRow(db, d, stats) {
  const v = await deviceView(db, d), usage = stats.get(d.id) || {
    events: 0,
    people: 0,
    last: null
  };
  const ownerActive = d.kind !== "PERSONAL" || Boolean(await one(db, "SELECT id FROM employees WHERE id=? AND is_active=1", d.owner_employee_id));
  return {
    ...v,
    row_version: d.row_version,
    registered: Boolean(d.public_key),
    activated_at: d.activated_at || d.approved_at || null,
    expires_at: d.registration_expires_at || null,
    session_id: d.session_id || null,
    revoked_at: d.revoked_at || null,
    revoke_reason: d.revoke_reason || "",
    last_seen_at: d.last_seen_at || null,
    created_at: d.created_at,
    owner_active: ownerActive,
    events_7d: usage.events,
    people_7d: usage.people
  };
}
async function ownerPhone(db, d) {
  if (d.kind !== "PERSONAL") return "";
  const digits = String((await one(db, "SELECT phone FROM employees WHERE id=?", d.owner_employee_id))?.phone || "").replace(/\D/g, "");
  const phone = digits.startsWith("0") ? "62" + digits.slice(1) : digits.startsWith("8") ? "62" + digits : digits;
  return /^62\d{8,13}$/.test(phone) ? phone : "";
}
function validatePoint(b, old = {}) {
  const name = typeof b.name === "string" ? b.name.trim().replace(/\s+/g, " ") : old.name;
  assert(typeof name === "string" && name.length >= 1 && name.length <= 80, "Nama titik wajib diisi (maksimal 80 karakter).");
  const lat = b.latitude === void 0 ? old.latitude : Number(b.latitude), lon = b.longitude === void 0 ? old.longitude : Number(b.longitude);
  assert(Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lon) && lon >= -180 && lon <= 180, "Koordinat titik tidak valid.");
  const radius = b.radius_m === void 0 ? old.radius_m ?? attendanceRules.radiusDefault : Number(b.radius_m);
  assert(Number.isInteger(radius) && radius >= attendanceRules.radiusMin && radius <= attendanceRules.radiusMax, `Radius harus ${attendanceRules.radiusMin}\u2013${attendanceRules.radiusMax} meter.`);
  const active = b.is_active === void 0 ? old.is_active ?? 1 : b.is_active === true || b.is_active === 1 || b.is_active === "1" ? 1 : 0;
  return {
    name,
    latitude: Math.round(lat * 1e7) / 1e7,
    longitude: Math.round(lon * 1e7) / 1e7,
    radius_m: radius,
    is_active: active
  };
}
var pointView = (p) => ({
  id: p.id,
  name: p.name,
  latitude: Number(p.latitude),
  longitude: Number(p.longitude),
  radius_m: Number(p.radius_m),
  is_active: Number(p.is_active) === 1,
  row_version: p.row_version,
  updated_at: p.updated_at
});
function workDate(value, label = "Tanggal kerja") {
  return date(value, label);
}
async function reviewItems(db, scope, from, to, nowMs) {
  const ids = new Set(scope.readable), data = await loadRange(db, from, to, ids), owners = await ownerNames(db, data.events);
  const voided = new Set(data.corrections.filter((c) => c.void_event_id).map((c) => c.void_event_id));
  const paired = new Set(data.events.filter((e) => e.pair_event_id).map((e) => e.pair_event_id));
  const leave = new Set(data.leaveDays.map((l) => `${l.employee_id}\0${l.work_date}`));
  const reviews = new Map((await all(db, "SELECT r.*,u.username reviewer FROM attendance_reviews r JOIN attendance_events e ON e.id=r.event_id LEFT JOIN users u ON u.id=r.reviewed_by WHERE e.work_date>=? AND e.work_date<=?", from, to)).map((r) => [r.event_id, r]));
  const references = new Set((await all(db, "SELECT employee_id FROM attendance_reference_photos")).map((r) => r.employee_id));
  const items = [];
  for (const e of data.events) {
    if (voided.has(e.id)) continue;
    const flags = new Set(parseFlags(e.flags));
    if (e.kind === "IN" && !paired.has(e.id) && nowMs - Date.parse(e.recorded_at) > attendanceRules.sessionHours * 36e5) flags.add("TANPA_PULANG");
    if (leave.has(`${e.employee_id}\0${e.work_date}`)) flags.add("SAAT_CUTI");
    if (references.has(e.employee_id)) flags.delete("TANPA_FOTO_ACUAN");
    if (!flags.size) continue;
    const review = reviews.get(e.id), person = scope.byId.get(e.employee_id);
    items.push({
      ...eventView(e, owners),
      flags: [...flags],
      employee: view(person),
      has_reference: references.has(e.employee_id),
      can_review: writeAccess(scope, e.employee_id).allowed,
      review: review ? {
        decision: review.decision,
        note: review.note || "",
        reviewed_at: review.reviewed_at,
        reviewer: review.reviewer || ""
      } : null
    });
  }
  items.sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
  const latest = /* @__PURE__ */ new Map();
  for (const e of data.events) if (e.photo_storage_key && !voided.has(e.id) && !references.has(e.employee_id)) latest.set(e.employee_id, e);
  const missing = [...latest.values()].map((e) => ({
    employee: view(scope.byId.get(e.employee_id)),
    event_id: e.id,
    recorded_at: e.recorded_at,
    can_set: writeAccess(scope, e.employee_id).allowed
  })).sort((a, b) => a.employee.name.localeCompare(b.employee.name, "id"));
  return {
    items,
    missing_reference: missing
  };
}
async function attendanceRoutes({ db, user, p, method, body: b = {}, url }, deps = localDeps) {
  if (p[0] !== "attendance") return void 0;
  const { has: has2, can: can2, audit: audit2 } = deps;
  assert(!user.must_change_password, "Anda wajib mengganti password sementara terlebih dahulu.", 428);
  const nowMs = Date.now();
  if (p[1] === "overview" && p.length === 2 && method === "GET") {
    const scope = await scopeOf(db, user, deps);
    const canDevices = await has2(db, user, "hr.attendance.devices"), canSettings = await can2(db, user, "hr.attendance.settings", {});
    const state = await one(db, "SELECT last_retention_at,last_error,deleted_photos FROM attendance_state WHERE id=1");
    const due = canSettings ? Number((await one(db, `SELECT count(*) n FROM attendance_events e WHERE e.photo_storage_key IS NOT NULL AND e.recorded_at<?
   AND NOT EXISTS(SELECT 1 FROM attendance_reference_photos r WHERE r.event_id=e.id)`, new Date(nowMs - attendanceRules.photoRetentionDays * DAY2).toISOString()))?.n || 0) : 0;
    return {
      today: today(),
      self: Boolean(user.employee_id && scope.byId.has(user.employee_id)),
      employee_id: user.employee_id || null,
      subordinates: scope.subordinates.size,
      readable: scope.readable.size,
      read_scope: scope.hasRead,
      manage: scope.hasManage || scope.direct.size > 0,
      devices: canDevices,
      settings: canSettings,
      points_ready: Number((await one(db, "SELECT count(*) n FROM attendance_points WHERE is_active=1"))?.n || 0) > 0,
      units: await units(db),
      retention: canSettings ? {
        last_run_at: state?.last_retention_at || null,
        last_error: state?.last_error || null,
        deleted_photos: Number(state?.deleted_photos || 0),
        due_photos: due
      } : null
    };
  }
  if (p[1] === "today" && p.length === 2 && method === "GET") {
    const scope = await scopeOf(db, user, deps);
    const day = today(), ids = await filterUnit(db, scope, url), data = await loadRange(db, day, day, ids), owners = await ownerNames(db, data.events);
    const rows = [];
    for (const id of ids) {
      const person = scope.byId.get(id);
      if (!person?.is_active) continue;
      const events = data.events.filter((e) => e.employee_id === id), result = dayStatus({
        events,
        corrections: data.corrections.filter((c) => c.employee_id === id),
        note: data.notes.find((n) => n.employee_id === id) || null,
        leave: data.leaveDays.find((l) => l.employee_id === id) || null,
        nowMs
      });
      const last = events.at(-1);
      rows.push({
        employee: view(person),
        ...result,
        last_event: last ? eventView(last, owners) : null,
        can_manage: writeAccess(scope, id).allowed,
        self: id === user.employee_id
      });
    }
    rows.sort((a, b2) => a.employee.name.localeCompare(b2.employee.name, "id"));
    return {
      date: day,
      rows
    };
  }
  if (p[1] === "recap" && p.length === 2 && method === "GET") {
    const scope = await scopeOf(db, user, deps);
    const r = range(url), ids = await filterUnit(db, scope, url), data = await loadRange(db, r.from, r.to, ids);
    const withEvents = new Set(data.events.map((x) => x.employee_id));
    const people = [...ids].map((id) => scope.byId.get(id)).filter((e) => e && (e.is_active || withEvents.has(e.id)));
    const recap = buildRecap({
      employees: people,
      ...data,
      from: r.from,
      to: r.to,
      nowMs
    });
    const detail = url?.searchParams.get("detail") === "1";
    return {
      from: r.from,
      to: r.to,
      employees: recap.map((x) => ({
        employee: view(scope.byId.get(x.employee_id)),
        summary: x.summary,
        can_manage: writeAccess(scope, x.employee_id).allowed,
        ...detail ? {
          days: x.days
        } : {}
      })).sort((a, b2) => a.employee.name.localeCompare(b2.employee.name, "id"))
    };
  }
  if (p[1] === "recap" && p.length === 3 && method === "GET") {
    const scope = await scopeOf(db, user, deps), id = p[2];
    assert(scope.readable.has(id), "Akses data absen pegawai ini ditolak.", 403);
    const r = range(url), person = scope.byId.get(id), data = await loadRange(db, r.from, r.to, /* @__PURE__ */ new Set([id])), owners = await ownerNames(db, data.events);
    const [recap] = buildRecap({
      employees: [person],
      ...data,
      from: r.from,
      to: r.to,
      nowMs
    });
    const access = writeAccess(scope, id), names = /* @__PURE__ */ new Map();
    for (const uid2 of new Set([...data.corrections, ...data.notes].map((x) => x.created_by))) names.set(uid2, (await one(db, "SELECT username FROM users WHERE id=?", uid2))?.username || "");
    const reference = await one(db, "SELECT event_id,set_at FROM attendance_reference_photos WHERE employee_id=?", id);
    return {
      employee: view(person),
      from: r.from,
      to: r.to,
      days: recap.days,
      summary: recap.summary,
      events: data.events.map((e) => eventView(e, owners)),
      corrections: data.corrections.map((c) => ({
        id: c.id,
        work_date: c.work_date,
        in_at: c.in_at,
        out_at: c.out_at,
        void_event_id: c.void_event_id,
        reason: c.reason,
        created_at: c.created_at,
        created_by: names.get(c.created_by) || "",
        row_version: c.row_version
      })),
      notes: data.notes.map((n) => ({
        id: n.id,
        work_date: n.work_date,
        kind: n.kind,
        note: n.note || "",
        created_at: n.created_at,
        created_by: names.get(n.created_by) || "",
        row_version: n.row_version
      })),
      reference: reference ? {
        event_id: reference.event_id,
        set_at: reference.set_at
      } : null,
      can_manage: access.allowed,
      manager: access.manager,
      correction_from: access.manager ? null : shiftDay(today(), -attendanceRules.correctionDays)
    };
  }
  if (p[1] === "review" && p.length === 2 && method === "GET") {
    const scope = await scopeOf(db, user, deps);
    const r = range(url, {
      maxDays: attendanceRules.reviewDays,
      defaultFrom: shiftDay(today(), -13)
    });
    const status = url?.searchParams.get("status") || "open";
    assert(["open", "all"].includes(status), "Saringan tidak valid.");
    const result = await reviewItems(db, scope, r.from, r.to, nowMs);
    return {
      from: r.from,
      to: r.to,
      items: status === "open" ? result.items.filter((i) => !i.review) : result.items,
      missing_reference: result.missing_reference
    };
  }
  if (p[1] === "photos" && p.length === 3 && method === "GET") {
    const scope = await scopeOf(db, user, deps);
    return await photoOf(db, user, deps, await one(db, "SELECT * FROM attendance_events WHERE id=?", p[2]), scope, "event");
  }
  if (p[1] === "references" && p.length === 3 && method === "GET") {
    const scope = await scopeOf(db, user, deps);
    assert(scope.readable.has(p[2]), "Akses foto ditolak.", 403);
    const ref = await one(db, "SELECT event_id FROM attendance_reference_photos WHERE employee_id=?", p[2]);
    assert(ref, "Pegawai ini belum punya foto acuan.", 404);
    return await photoOf(db, user, deps, await one(db, "SELECT * FROM attendance_events WHERE id=?", ref.event_id), scope, "reference");
  }
  if (p[1] === "references" && p.length === 2 && method === "POST") {
    const event = await one(db, "SELECT * FROM attendance_events WHERE id=?", typeof b.event_id === "string" ? b.event_id : "");
    assert(event && event.employee_id === b.employee_id, "Selfie tidak sesuai dengan pegawai.", 422);
    await targetAccess(db, user, deps, event.employee_id);
    assert(event.photo_storage_key, "Selfie ini sudah dihapus. Pilih selfie lain.", 409);
    return await tx(db, async () => {
      const old = await one(db, "SELECT * FROM attendance_reference_photos WHERE employee_id=?", event.employee_id);
      const row = old ? await update(db, "attendance_reference_photos", old.id, old.row_version, {
        event_id: event.id,
        set_by: user.id,
        set_at: now()
      }) : await insert(db, "attendance_reference_photos", {
        employee_id: event.employee_id,
        event_id: event.id,
        set_by: user.id,
        set_at: now()
      });
      await audit2(db, user, old ? "REPLACE_REFERENCE" : "SET_REFERENCE", "attendance_reference_photos", row.id, {
        employee_id: event.employee_id,
        event_id: event.id
      });
      return {
        employee_id: row.employee_id,
        event_id: row.event_id,
        set_at: row.set_at
      };
    });
  }
  if (p[1] === "reviews" && p.length === 2 && method === "POST") {
    const event = await one(db, "SELECT * FROM attendance_events WHERE id=?", typeof b.event_id === "string" ? b.event_id : "");
    assert(event, "Absen tidak ditemukan.", 404);
    await targetAccess(db, user, deps, event.employee_id, "Hanya atasan langsung atau Pengelola Absensi yang dapat menilai absen ini.");
    assert(["SESUAI", "KLARIFIKASI"].includes(b.decision), "Pilih Sesuai atau Perlu klarifikasi.");
    const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : "";
    assert(b.decision !== "KLARIFIKASI" || note.length >= 3, "Tuliskan hal yang perlu diklarifikasi.");
    return await tx(db, async () => {
      const old = await one(db, "SELECT * FROM attendance_reviews WHERE event_id=?", event.id);
      const values = {
        decision: b.decision,
        note: note || null,
        reviewed_by: user.id,
        reviewed_at: now()
      };
      const row = old ? await update(db, "attendance_reviews", old.id, old.row_version, values) : await insert(db, "attendance_reviews", {
        event_id: event.id,
        ...values
      });
      await audit2(db, user, "REVIEW", "attendance_events", event.id, {
        decision: b.decision
      });
      return {
        event_id: event.id,
        decision: row.decision,
        note: row.note || "",
        reviewed_at: row.reviewed_at
      };
    });
  }
  if (p[1] === "notes" && p.length === 2 && method === "POST") {
    await targetAccess(db, user, deps, b.employee_id);
    const day = workDate(b.work_date);
    assert(day <= shiftDay(today(), 31), "Keterangan paling jauh 31 hari ke depan.");
    assert(["IZIN", "SAKIT", "DINAS_LUAR"].includes(b.kind), "Pilih Izin, Sakit, atau Dinas luar.");
    const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : "";
    return await tx(db, async () => {
      assert(!await one(db, "SELECT id FROM attendance_day_notes WHERE employee_id=? AND work_date=? AND revoked_at IS NULL", b.employee_id, day), "Tanggal ini sudah punya keterangan. Cabut dulu bila ingin mengganti.", 409);
      const row = await insert(db, "attendance_day_notes", {
        employee_id: b.employee_id,
        work_date: day,
        kind: b.kind,
        note: note || null,
        created_by: user.id
      });
      await audit2(db, user, "CREATE", "attendance_day_notes", row.id, {
        employee_id: b.employee_id,
        work_date: day,
        kind: b.kind
      });
      return {
        id: row.id,
        work_date: row.work_date,
        kind: row.kind,
        note: row.note || "",
        row_version: row.row_version
      };
    });
  }
  if (p[1] === "notes" && p.length === 4 && p[3] === "revoke" && method === "POST") {
    const row = await one(db, "SELECT * FROM attendance_day_notes WHERE id=?", p[2]);
    assert(row && !row.revoked_at, "Keterangan tidak ditemukan.", 404);
    await targetAccess(db, user, deps, row.employee_id);
    return await tx(db, async () => {
      const next = await update(db, "attendance_day_notes", row.id, b.row_version, {
        revoked_at: now(),
        revoked_by: user.id
      });
      await audit2(db, user, "REVOKE", "attendance_day_notes", row.id, {
        employee_id: row.employee_id,
        work_date: row.work_date
      });
      return {
        id: next.id,
        revoked: true
      };
    });
  }
  if (p[1] === "corrections" && p.length === 2 && method === "POST") {
    const access = await targetAccess(db, user, deps, b.employee_id);
    const day = workDate(b.work_date);
    assert(day <= today(), "Koreksi hanya untuk tanggal yang sudah lewat atau hari ini.");
    if (!access.manager) assert(day >= shiftDay(today(), -attendanceRules.correctionDays), `Atasan dapat mengoreksi paling lambat ${attendanceRules.correctionDays} hari setelah tanggal kerja. Setelah itu hubungi Pengelola Absensi.`, 403);
    const reason = typeof b.reason === "string" ? b.reason.trim() : "";
    assert(reason.length >= 3 && reason.length <= 500, "Alasan koreksi wajib diisi (3\u2013500 karakter).");
    const inAt = b.in_at ? instant(b.in_at) : null, outAt = b.out_at ? instant(b.out_at) : null;
    if (inAt) assert(witaDate(Date.parse(inAt)) === day, "Jam masuk harus pada tanggal kerja yang sama.");
    if (outAt) assert([day, shiftDay(day, 1)].includes(witaDate(Date.parse(outAt))), "Jam pulang harus pada tanggal kerja atau sehari sesudahnya.");
    assert(!inAt || !outAt || inAt < outAt, "Jam pulang harus sesudah jam masuk.");
    assert(!inAt || Date.parse(inAt) <= nowMs + 5 * 6e4, "Jam masuk belum terjadi.");
    assert(!outAt || Date.parse(outAt) <= nowMs + 5 * 6e4, "Jam pulang belum terjadi.");
    let voidId = null;
    if (b.void_event_id) {
      const event = await one(db, "SELECT * FROM attendance_events WHERE id=?", String(b.void_event_id));
      assert(event && event.employee_id === b.employee_id && event.work_date === day, "Absen yang disisihkan harus milik pegawai ini pada tanggal yang sama.", 422);
      voidId = event.id;
    }
    assert(inAt || outAt || voidId, "Isi jam masuk, jam pulang, atau pilih absen yang disisihkan.");
    return await tx(db, async () => {
      if (voidId) assert(!await one(db, "SELECT id FROM attendance_corrections WHERE void_event_id=? AND revoked_at IS NULL", voidId), "Absen ini sudah disisihkan.", 409);
      const row = await insert(db, "attendance_corrections", {
        employee_id: b.employee_id,
        work_date: day,
        in_at: inAt,
        out_at: outAt,
        void_event_id: voidId,
        reason,
        created_by: user.id
      });
      await audit2(db, user, "CREATE", "attendance_corrections", row.id, {
        employee_id: b.employee_id,
        work_date: day,
        in_at: inAt,
        out_at: outAt,
        void_event_id: voidId
      }, reason);
      return {
        id: row.id,
        work_date: row.work_date,
        row_version: row.row_version
      };
    });
  }
  if (p[1] === "corrections" && p.length === 4 && p[3] === "revoke" && method === "POST") {
    const row = await one(db, "SELECT * FROM attendance_corrections WHERE id=?", p[2]);
    assert(row && !row.revoked_at, "Koreksi tidak ditemukan.", 404);
    const access = await targetAccess(db, user, deps, row.employee_id);
    if (!access.manager) assert(row.work_date >= shiftDay(today(), -attendanceRules.correctionDays), "Koreksi lama hanya dapat dicabut Pengelola Absensi.", 403);
    return await tx(db, async () => {
      const next = await update(db, "attendance_corrections", row.id, b.row_version, {
        revoked_at: now(),
        revoked_by: user.id
      });
      await audit2(db, user, "REVOKE", "attendance_corrections", row.id, {
        employee_id: row.employee_id,
        work_date: row.work_date
      });
      return {
        id: next.id,
        revoked: true
      };
    });
  }
  if (p[1] === "exports" && p.length === 2 && method === "POST") {
    assert(["recap", "detail"].includes(b.kind), "Jenis ekspor tidak valid.");
    const from = date(b.from, "Tanggal mulai"), to = date(b.to, "Tanggal akhir");
    assert(from <= to, "Rentang tanggal tidak valid.");
    const rows = Number(b.rows);
    assert(Number.isInteger(rows) && rows >= 0 && rows <= 2e5, "Jumlah baris tidak valid.");
    const allowed = Boolean(user.employee_id) || await has2(db, user, "hr.attendance.read") || await has2(db, user, "hr.attendance.manage");
    assert(allowed, "Akses ekspor absensi ditolak.", 403);
    return await tx(db, async () => {
      await audit2(db, user, "EXPORT", "attendance_" + b.kind, `${from}..${to}`, {
        row_count: rows
      });
      return {
        ok: true
      };
    });
  }
  if (p[1] === "points") {
    const manage = await can2(db, user, "hr.attendance.settings", {});
    if (p.length === 2 && method === "GET") {
      assert(manage || await has2(db, user, "hr.attendance.devices") || await has2(db, user, "hr.attendance.read") || await has2(db, user, "hr.attendance.manage"), "Akses titik absen ditolak.", 403);
      return {
        points: (await all(db, "SELECT * FROM attendance_points ORDER BY is_active DESC,name,id")).map(pointView),
        can_manage: manage
      };
    }
    assert(manage, "Hanya Pengelola Absensi (cakupan seluruh organisasi) yang dapat mengubah titik absen.", 403);
    if (p.length === 2 && method === "POST") return await tx(db, async () => {
      const row = await insert(db, "attendance_points", {
        ...validatePoint(b),
        created_by: user.id
      });
      await audit2(db, user, "CREATE", "attendance_points", row.id, {
        name: row.name,
        radius_m: row.radius_m
      });
      return pointView(row);
    });
    if (p.length === 3 && method === "PATCH") {
      const old = await one(db, "SELECT * FROM attendance_points WHERE id=?", p[2]);
      assert(old, "Titik tidak ditemukan.", 404);
      return await tx(db, async () => {
        const row = await update(db, "attendance_points", old.id, b.row_version, validatePoint(b, old));
        await audit2(db, user, "UPDATE", "attendance_points", row.id, {
          name: row.name,
          radius_m: row.radius_m,
          is_active: row.is_active
        });
        return pointView(row);
      });
    }
  }
  if (["devices", "sessions", "people"].includes(p[1])) {
    assert(await has2(db, user, "hr.attendance.devices"), "Akses pendaftaran HP absen ditolak.", 403);
    if (p[1] === "people" && p.length === 2 && method === "GET") {
      const list = [], everyone = await can2(db, user, "hr.attendance.devices", {});
      for (const e of await directory(db)) if (e.is_active && (everyone || await can2(db, user, "hr.attendance.devices", {
        employee_id: e.id,
        org_unit_id: e.org_unit_id
      }))) list.push(view(e));
      return {
        people: list
      };
    }
    if (p[1] === "devices" && p.length === 2 && method === "GET") {
      const since = new Date(nowMs - 7 * DAY2).toISOString(), byId = new Map((await directory(db)).map((e) => [e.id, e]));
      const stats = new Map((await all(db, "SELECT device_id,count(*) events,count(DISTINCT employee_id) people,max(recorded_at) last FROM attendance_events WHERE recorded_at>=? GROUP BY device_id", since)).map((r) => [r.device_id, {
        events: Number(r.events),
        people: Number(r.people),
        last: r.last
      }]));
      const devices = [];
      for (const d of await all(db, "SELECT * FROM attendance_devices WHERE session_id IS NULL OR status<>'PENDING' ORDER BY created_at DESC")) if (await deviceScope(db, user, deps, d, byId)) devices.push(await deviceRow(db, d, stats));
      const sessions = [];
      for (const s of await all(db, "SELECT * FROM attendance_registration_sessions WHERE closed_at IS NULL AND expires_at>? ORDER BY created_at DESC", now())) if (await can2(db, user, "hr.attendance.devices", {
        org_unit_id: s.org_unit_id
      })) sessions.push(await sessionView(db, s));
      return {
        devices,
        sessions,
        units: await units(db)
      };
    }
    if (p[1] === "devices" && p.length === 2 && method === "POST") {
      assert(["PERSONAL", "SHARED"].includes(b.kind), "Pilih HP pribadi atau HP bersama.");
      let values;
      if (b.kind === "PERSONAL") {
        const [owner] = typeof b.owner_employee_id === "string" ? await directory(db, b.owner_employee_id) : [];
        assert(owner && owner.is_active, "Pilih pemilik HP dari pegawai aktif.", 422);
        assert(await can2(db, user, "hr.attendance.devices", {
          employee_id: owner.id,
          org_unit_id: owner.org_unit_id
        }), "Pegawai ini di luar cakupan unit Anda.", 403);
        values = {
          kind: "PERSONAL",
          owner_employee_id: owner.id,
          org_unit_id: null,
          label: null
        };
      } else {
        const unit = await one(db, "SELECT id FROM org_units WHERE id=? AND is_active=1", typeof b.org_unit_id === "string" ? b.org_unit_id : "");
        assert(unit, "Pilih unit HP bersama.", 422);
        assert(await can2(db, user, "hr.attendance.devices", {
          org_unit_id: unit.id
        }), "Unit ini di luar cakupan Anda.", 403);
        const label = typeof b.label === "string" ? b.label.trim().replace(/\s+/g, " ") : "";
        assert(label.length >= 3 && label.length <= 80, 'Beri label HP bersama, misalnya "HP Koordinator Pos 3".');
        values = {
          kind: "SHARED",
          owner_employee_id: null,
          org_unit_id: unit.id,
          label
        };
      }
      const { token, hash } = tokenPair(), expires = new Date(nowMs + attendanceRules.registrationDays * DAY2).toISOString();
      return await tx(db, async () => {
        const row = await insert(db, "attendance_devices", {
          ...values,
          status: "PENDING",
          registration_token_hash: hash,
          registration_expires_at: expires,
          created_by: user.id
        });
        await audit2(db, user, "CREATE", "attendance_devices", row.id, {
          kind: row.kind,
          owner_employee_id: row.owner_employee_id,
          org_unit_id: row.org_unit_id
        });
        return {
          device: await deviceRow(db, row, /* @__PURE__ */ new Map()),
          token,
          expires_at: expires,
          phone: await ownerPhone(db, row)
        };
      });
    }
    if (p[1] === "devices" && p.length === 4 && method === "POST") {
      const d = await one(db, "SELECT * FROM attendance_devices WHERE id=?", p[2]);
      assert(d, "HP tidak ditemukan.", 404);
      assert(await deviceScope(db, user, deps, d), "HP ini di luar cakupan unit Anda.", 403);
      assert(b.row_version === d.row_version, "Data HP sudah berubah. Muat ulang halaman HP Absen.", 409);
      if (p[3] === "link") {
        assert(d.status === "PENDING" && !d.public_key && !d.session_id, "Tautan baru hanya untuk HP yang belum mendaftar.", 409);
        const { token, hash } = tokenPair(), expires = new Date(nowMs + attendanceRules.registrationDays * DAY2).toISOString();
        return await tx(db, async () => {
          const row = await update(db, "attendance_devices", d.id, d.row_version, {
            registration_token_hash: hash,
            registration_expires_at: expires
          });
          await audit2(db, user, "ROTATE_LINK", "attendance_devices", d.id);
          return {
            device: await deviceRow(db, row, /* @__PURE__ */ new Map()),
            token,
            expires_at: expires,
            phone: await ownerPhone(db, row)
          };
        });
      }
      if (p[3] === "approve" || p[3] === "reject") {
        assert(d.status === "PENDING" && d.session_id && d.public_key, "HP ini tidak sedang menunggu persetujuan.", 409);
        const session = await one(db, "SELECT * FROM attendance_registration_sessions WHERE id=?", d.session_id);
        if (p[3] === "approve") assert(session && !session.closed_at && session.expires_at > now(), "Sesi pendaftaran sudah berakhir. Buka sesi baru.", 409);
        return await tx(db, async () => {
          const row = await update(db, "attendance_devices", d.id, d.row_version, p[3] === "approve" ? {
            status: "ACTIVE",
            approved_by: user.id,
            approved_at: now()
          } : {
            status: "REJECTED",
            revoked_by: user.id,
            revoked_at: now(),
            revoke_reason: "Ditolak saat sesi pendaftaran"
          });
          await audit2(db, user, p[3] === "approve" ? "APPROVE" : "REJECT", "attendance_devices", d.id, {
            session_id: d.session_id
          });
          return {
            device: await deviceRow(db, row, /* @__PURE__ */ new Map())
          };
        });
      }
      if (p[3] === "revoke") {
        assert(["PENDING", "ACTIVE"].includes(d.status), "HP ini sudah tidak aktif.", 409);
        const reason = typeof b.reason === "string" ? b.reason.trim() : "";
        assert(reason.length >= 3 && reason.length <= 300, "Tuliskan alasan menonaktifkan HP (misalnya HP hilang).");
        return await tx(db, async () => {
          const row = await update(db, "attendance_devices", d.id, d.row_version, {
            status: "REVOKED",
            revoked_by: user.id,
            revoked_at: now(),
            revoke_reason: reason,
            registration_token_hash: null
          });
          await audit2(db, user, "REVOKE", "attendance_devices", d.id, {}, reason);
          return {
            device: await deviceRow(db, row, /* @__PURE__ */ new Map())
          };
        });
      }
    }
    if (p[1] === "sessions" && p.length === 2 && method === "POST") {
      const unit = await one(db, "SELECT id FROM org_units WHERE id=? AND is_active=1", typeof b.org_unit_id === "string" ? b.org_unit_id : "");
      assert(unit, "Pilih unit untuk sesi pendaftaran.", 422);
      assert(await can2(db, user, "hr.attendance.devices", {
        org_unit_id: unit.id
      }), "Unit ini di luar cakupan Anda.", 403);
      const minutes = b.minutes === void 0 ? attendanceRules.sessionMinutesMax : Number(b.minutes);
      assert(Number.isInteger(minutes) && minutes >= 5 && minutes <= attendanceRules.sessionMinutesMax, `Lama sesi 5\u2013${attendanceRules.sessionMinutesMax} menit.`);
      const { token, hash } = tokenPair();
      return await tx(db, async () => {
        const row = await insert(db, "attendance_registration_sessions", {
          org_unit_id: unit.id,
          token_hash: hash,
          expires_at: new Date(nowMs + minutes * 6e4).toISOString(),
          created_by: user.id
        });
        await audit2(db, user, "OPEN_SESSION", "attendance_registration_sessions", row.id, {
          org_unit_id: unit.id,
          minutes
        });
        return {
          session: await sessionView(db, row),
          token
        };
      });
    }
    if (p[1] === "sessions" && p.length >= 3) {
      const s = await one(db, "SELECT * FROM attendance_registration_sessions WHERE id=?", p[2]);
      assert(s, "Sesi tidak ditemukan.", 404);
      assert(await can2(db, user, "hr.attendance.devices", {
        org_unit_id: s.org_unit_id
      }), "Sesi ini di luar cakupan Anda.", 403);
      if (p.length === 3 && method === "GET") return {
        session: await sessionView(db, s)
      };
      if (p.length === 4 && p[3] === "close" && method === "POST") {
        assert(!s.closed_at, "Sesi sudah ditutup.", 409);
        return await tx(db, async () => {
          const row = await update(db, "attendance_registration_sessions", s.id, b.row_version, {
            closed_at: now(),
            closed_by: user.id
          });
          const rejected = (await run(db, "UPDATE attendance_devices SET status='REJECTED',revoked_by=?,revoked_at=?,revoke_reason=?,updated_at=?,row_version=row_version+1 WHERE session_id=? AND status='PENDING'", user.id, now(), "Sesi ditutup sebelum disetujui", now(), s.id)).changes;
          await audit2(db, user, "CLOSE_SESSION", "attendance_registration_sessions", s.id, {
            rejected
          });
          return {
            session: await sessionView(db, row)
          };
        });
      }
    }
  }
  assert(false, "Alamat API tidak ditemukan.", 404);
}
  return { attendanceRoutes: attendanceRoutes };
})();
// Galat dari modul Absensi memakai kelas AppError salinannya sendiri; diubah ke
// AppError snapshot supaya status 403/404/409/422 tidak berubah menjadi 503.
function adoptAttendanceError(error) {
  if (!(error instanceof AppError) && error instanceof Error && Number.isInteger(error.status) && error.status >= 400 && error.status < 600) throw new AppError(error.status, error.message, error.details);
  throw error;
}
// --- Modul E-Arsip, dibangkitkan dari lib/archive*.mjs (build-archive-deploy.mjs) ---
const __archives = (() => {
  const Buffer = __archives_Buffer;
  const randomUUID = __archives_randomUUID;
  const createHash = __archives_createHash;
// supabase/functions/_shared/portal/arrays.mjs
async function asyncMap(items, fn) {
  const out = [];
  for (let i = 0; i < items.length; i++) out.push(await fn(items[i], i, items));
  return out;
}
async function asyncForEach(items, fn) {
  for (let i = 0; i < items.length; i++) await fn(items[i], i, items);
}

// supabase/functions/_shared/portal/archives.mjs

// supabase/functions/_shared/portal/db.mjs
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
async function tx(db, work) {
  assert(db.inTransaction, "Transaction required.", 500);
  return await work();
}
async function audit(db, actor, action, type, key, summary = {}, reason = "") {
  await insert(db, "audit_events", { actor_user_id: actor?.id || null, action, object_type: type, object_key: String(key), occurred_at: now(), outcome: "SUCCESS", request_id: actor?.request_id || uid(), reason, change_summary: JSON.stringify(summary) });
}

// supabase/functions/_shared/portal/archive-files.mjs
async function archiveSchemaReady(db) {
  return Number((await one(db, "SELECT count(*) AS n FROM pg_catalog.pg_tables WHERE schemaname='portal' AND tablename IN ('archive_records','archive_officers','archive_document_versions')")).n) === 3;
}
async function archiveFileLinked(db, fileId) {
  return await archiveSchemaReady(db) && Boolean(await one(db, "SELECT 1 AS linked FROM archive_document_versions WHERE file_id=?", fileId));
}

// supabase/functions/_shared/portal/archive-rules.mjs
var archiveRules = Object.freeze({
  maxFileBytes: 1e7,
  mimes: Object.freeze(["application/pdf", "image/jpeg", "image/png"]),
  extensions: Object.freeze({
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png"
  }),
  subjectMax: 500,
  numberMax: 120,
  reasonMax: 300,
  longReasonMax: 500,
  maxAttachmentsPerRequest: 30,
  pageSize: 50,
  maxPageSize: 100,
  reportMaxRows: 5e3,
  duplicateRuleVersion: "RT04-v1",
  timezone: "Asia/Makassar",
  digestHour: 7,
  summaryBackfillDays: 7
});
var archiveDirections = Object.freeze(["MASUK", "KELUAR", "INTERNAL"]);
var archiveClassifications = Object.freeze(["BIASA", "RAHASIA"]);
var archiveGrantPurposes = Object.freeze(["BIASA_SHARE", "RAHASIA_READ", "DOWNLOAD"]);
var archiveReportTypes = Object.freeze(["recap_period", "recap_unit", "recap_type", "agenda_in", "agenda_out"]);
var archiveContentActions = Object.freeze(["ARCHIVE_CREATED", "METADATA_EDITED", "ATTACHMENT_ADDED", "ATTACHMENT_REMOVED", "VERSION_ADDED"]);
var WITA_OFFSET = 8 * 36e5;
var archiveWitaDate = (ms) => new Date(ms + WITA_OFFSET).toISOString().slice(0, 10);
var archiveWitaYear = (ms) => new Date(ms + WITA_OFFSET).getUTCFullYear();
var archiveWitaHour = (ms) => new Date(ms + WITA_OFFSET).getUTCHours();
var archiveShiftDay = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
var archiveDayStart = (day) => new Date(Date.parse(`${day}T00:00:00+08:00`)).toISOString();
var archiveDayEnd = (day) => archiveDayStart(archiveShiftDay(day, 1));
var archiveValidDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
var archiveAgendaCode = (value) => typeof value === "string" && /^[A-Z0-9]{2,12}$/.test(value);
var archiveAgendaNumber = (code, year, sequence) => `${code}/${year}/${String(sequence).padStart(4, "0")}`;
var archiveSuggestCode = (code) => String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
var archiveNormalNumber = (value) => String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
var archiveNormalSubject = (value) => String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
var archiveNormalName = (value) => String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
var archiveLike = (value) => `%${String(value).replace(/[\\%_]/g, "\\$&")}%`;
var archiveFingerprint = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function archiveDecide({ deleted, classification, humas, scope, rahasia, download, officer }) {
  const active = !deleted;
  const list = active && Boolean(humas || scope || rahasia);
  const read = active && Boolean(humas || classification === "BIASA" && scope || classification === "RAHASIA" && rahasia);
  return {
    list,
    read,
    edit: read && Boolean(officer),
    download: read && Boolean(download)
  };
}
function archiveDuplicateReasons(candidate, incoming) {
  const reasons = [];
  if (candidate.checksum_match) reasons.push("BERKAS_SAMA");
  if (incoming.official_number_normalized && candidate.official_number_normalized === incoming.official_number_normalized && candidate.letter_date === incoming.letter_date) reasons.push("NOMOR_DAN_TANGGAL");
  if (candidate.subject_normalized === incoming.subject_normalized && candidate.letter_date === incoming.letter_date) reasons.push("PERIHAL_DAN_TANGGAL");
  return reasons;
}

// supabase/functions/_shared/portal/archives.mjs
var HUMAS = "archives.humas.manage";
var OVERSEE = "archives.records.oversee";
var ASSIGN = "archives.officers.assign";
var HOLD_SQL = "FROM user_roles ur JOIN roles r ON r.id=ur.role_id AND r.is_active=1 JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id";
var USER_SQL = `SELECT u.id,u.username,u.employee_id,e.full_name FROM users u LEFT JOIN employees e ON e.id=u.employee_id`;
var directionLabel = {
  MASUK: "Masuk",
  KELUAR: "Keluar",
  INTERNAL: "Internal"
};
var str = (value, label, max, { optional = false } = {}) => {
  if (optional && (value == null || String(value).trim() === "")) return null;
  assert(typeof value === "string" && value.trim().length > 0 && value.trim().length <= max, `${label} wajib diisi (maksimal ${max} karakter).`);
  return value.trim();
};
var idOf = (value, label = "Data") => {
  assert(typeof value === "string" && value.length > 0 && value.length <= 100 && /^[A-Za-z0-9_.:-]+$/.test(value), `${label} tidak ditemukan.`, 404);
  return value;
};
var placeholders = (values, params) => {
  params.push(...values);
  return `(${values.map(() => "?").join(",")})`;
};
var parse = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};
var notFound = () => new AppError(404, "Arsip tidak ditemukan.");
var denied = (db, user, action, archiveId, message = "Akses ditolak.", status = 403) => {
  console.warn(JSON.stringify({
    event: "archive_denied",
    action,
    archive_id: archiveId || null,
    actor: user.id,
    request_id: user.request_id || null
  }));
  return new AppError(status, message);
};
async function arcTree(db) {
  const rows = await all(db, "SELECT id,parent_id,code,name,is_active FROM org_units ORDER BY name,id"), byId = new Map(rows.map((r) => [r.id, r])), children = /* @__PURE__ */ new Map();
  for (const r of rows) if (r.parent_id) {
    const list = children.get(r.parent_id) || [];
    list.push(r.id);
    children.set(r.parent_id, list);
  }
  return {
    rows,
    byId,
    ancestors(id) {
      const out = [];
      for (let at = id, guard = 0; at && byId.has(at) && guard < 50; guard++) {
        out.push(at);
        at = byId.get(at).parent_id;
      }
      return out;
    },
    descendants(id) {
      const out = /* @__PURE__ */ new Set(), queue = [id];
      while (queue.length) {
        const at = queue.shift();
        if (out.has(at) || !byId.has(at)) continue;
        out.add(at);
        queue.push(...children.get(at) || []);
      }
      return out;
    }
  };
}
async function arcHolds(db, userId, code) {
  return Boolean(await one(db, `SELECT 1 AS ok ${HOLD_SQL} WHERE ur.user_id=? AND p.code=? LIMIT 1`, userId, code));
}
async function arcPlacementUnits(db, employeeId) {
  if (!employeeId) return [];
  const day = today();
  return (await all(db, `SELECT p.org_unit_id FROM employee_placements ep JOIN positions p ON p.id=ep.position_id JOIN employees e ON e.id=ep.employee_id
  WHERE ep.employee_id=? AND ep.is_primary=1 AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?) AND e.is_active=1`, employeeId, day, day)).map((r) => r.org_unit_id);
}
async function arcMemberUnits(db, tree, employeeId) {
  const out = /* @__PURE__ */ new Set();
  for (const unit of await arcPlacementUnits(db, employeeId)) for (const id of tree.ancestors(unit)) out.add(id);
  return out;
}
async function arcOversight(db, tree, userId) {
  const roles = await all(db, `SELECT DISTINCT ur.id,ur.scope_kind ${HOLD_SQL} WHERE ur.user_id=? AND p.code=?`, userId, OVERSEE);
  if (roles.some((r) => r.scope_kind === "ALL")) return "ALL";
  const out = /* @__PURE__ */ new Set();
  for (const role of roles.filter((r) => r.scope_kind === "ASSIGNED_UNITS")) for (const unit of await all(db, "SELECT org_unit_id,include_descendants FROM user_role_units WHERE user_role_id=?", role.id)) {
    if (Number(unit.include_descendants) === 1) for (const id of tree.descendants(unit.org_unit_id)) out.add(id);
    else out.add(unit.org_unit_id);
  }
  return out;
}
async function arcActor(db, user) {
  const tree = await arcTree(db), nowIso = now(), memberUnits = await arcMemberUnits(db, tree, user.employee_id);
  const officerUnits = new Set((await all(db, "SELECT org_unit_id FROM archive_officers WHERE user_id=? AND revoked_at IS NULL AND valid_from<=? AND (expires_at IS NULL OR expires_at>?)", user.id, nowIso, nowIso)).map((r) => r.org_unit_id).filter((id) => memberUnits.has(id) && tree.byId.get(id)?.is_active !== 0));
  const ctx = {
    user,
    tree,
    nowIso,
    humas: await arcHolds(db, user.id, HUMAS),
    admin: await arcHolds(db, user.id, ASSIGN),
    memberUnits,
    officerUnits,
    oversight: await arcOversight(db, tree, user.id)
  };
  ctx.snapshot = {
    username: user.username,
    humas: ctx.humas,
    admin: ctx.admin,
    officer_units: [...officerUnits]
  };
  return ctx;
}
async function archiveUploadAllowed(db, user) {
  return await archiveSchemaReady(db) && (await arcActor(db, user)).officerUnits.size > 0;
}
async function arcAudit(db, ctx, action, detail = {}) {
  await insert(db, "archive_audit_events", {
    occurred_at: now(),
    actor_user_id: ctx.user.id,
    actor_snapshot: JSON.stringify(ctx.snapshot),
    actor_type: "USER",
    action,
    archive_id: detail.archive_id || null,
    document_id: detail.document_id || null,
    version_id: detail.version_id || null,
    request_id: ctx.user.request_id || uid(),
    operation_id: detail.operation_id || null,
    outcome: "SUCCESS",
    reason: detail.reason || null,
    before_data: detail.before ? JSON.stringify(detail.before) : null,
    after_data: detail.after ? JSON.stringify(detail.after) : null,
    safe_context: JSON.stringify(detail.context || {})
  });
}
function scopeSql(ctx, params) {
  if (ctx.oversight === "ALL") return "1=1";
  const units = [.../* @__PURE__ */ new Set([...ctx.memberUnits, ...ctx.oversight])], member = [...ctx.memberUnits], parts = [];
  if (units.length) parts.push(`a.owner_unit_id IN ${placeholders(units, params)}`);
  params.push(ctx.user.id);
  parts.push(`EXISTS(SELECT 1 FROM archive_access_grants g WHERE g.archive_id=a.id AND g.purpose='BIASA_SHARE' AND g.revoked_at IS NULL AND (g.target_user_id=?${member.length ? ` OR g.target_unit_id IN ${placeholders(member, params)}` : ""}))`);
  return `(${parts.join(" OR ")})`;
}
function grantSql(ctx, params, purpose) {
  params.push(ctx.user.id, ctx.nowIso, ctx.nowIso);
  return `EXISTS(SELECT 1 FROM archive_access_grants g WHERE g.archive_id=a.id AND g.purpose='${purpose}' AND g.revoked_at IS NULL AND g.target_user_id=? AND g.security_epoch=a.security_epoch AND g.valid_from<=? AND (g.expires_at IS NULL OR g.expires_at>?))`;
}
var listSql = (ctx, params) => ctx.humas ? "1=1" : `(${scopeSql(ctx, params)} OR ${grantSql(ctx, params, "RAHASIA_READ")})`;
var fullSql = (ctx, params) => ctx.humas ? "1=1" : `((a.classification='BIASA' AND ${scopeSql(ctx, params)}) OR (a.classification='RAHASIA' AND ${grantSql(ctx, params, "RAHASIA_READ")}))`;
async function arcAccess(db, ctx, a) {
  const member = ctx.memberUnits.has(a.owner_unit_id), oversee = ctx.oversight === "ALL" || ctx.oversight.has(a.owner_unit_id);
  const memberUnits = [...ctx.memberUnits], params = [a.id, ctx.user.id];
  const shared = Boolean(await one(db, `SELECT 1 AS ok FROM archive_access_grants g WHERE g.archive_id=? AND g.purpose='BIASA_SHARE' AND g.revoked_at IS NULL AND (g.target_user_id=?${memberUnits.length ? ` OR g.target_unit_id IN ${placeholders(memberUnits, params)}` : ""}) LIMIT 1`, ...params));
  const epochGrant = async (purpose) => Boolean(await one(db, "SELECT 1 AS ok FROM archive_access_grants g WHERE g.archive_id=? AND g.purpose=? AND g.revoked_at IS NULL AND g.target_user_id=? AND g.security_epoch=? AND g.valid_from<=? AND (g.expires_at IS NULL OR g.expires_at>?) LIMIT 1", a.id, purpose, ctx.user.id, a.security_epoch, ctx.nowIso, ctx.nowIso));
  const rahasia = await epochGrant("RAHASIA_READ"), download = await epochGrant("DOWNLOAD"), officer = ctx.officerUnits.has(a.owner_unit_id);
  const decision = archiveDecide({
    deleted: Boolean(a.deleted_at),
    classification: a.classification,
    humas: ctx.humas,
    scope: member || oversee || shared,
    rahasia,
    download,
    officer
  });
  const sources = [];
  if (ctx.humas) sources.push("HUMAS");
  if (a.classification === "BIASA") {
    if (member) sources.push("BAGIAN");
    if (oversee) sources.push("PENGAWASAN");
    if (shared) sources.push("BERBAGI");
  }
  if (a.classification === "RAHASIA" && rahasia) sources.push("IZIN_RAHASIA");
  return {
    ...decision,
    member,
    oversee,
    shared,
    rahasia,
    download_grant: download,
    officer,
    sources
  };
}
async function arcLoad(db, ctx, id, action = "READ") {
  const a = await one(db, "SELECT a.*,u.name AS unit_name FROM archive_records a JOIN org_units u ON u.id=a.owner_unit_id WHERE a.id=?", idOf(id, "Arsip"));
  if (!a || a.deleted_at) throw notFound();
  const access = await arcAccess(db, ctx, a);
  if (!access.list) throw notFound();
  return {
    a,
    access,
    action
  };
}
async function arcLoadFull(db, ctx, id, action) {
  const loaded = await arcLoad(db, ctx, id, action);
  if (!loaded.access.read) throw denied(db, ctx.user, action, loaded.a.id, "Arsip ini berklasifikasi Rahasia. Hubungi Humas secara langsung untuk meminta akses.");
  return loaded;
}
var arcRestricted = (a) => ({
  id: a.id,
  restricted: true,
  agenda_number: a.agenda_number,
  archived_at: a.archived_at,
  classification: "RAHASIA"
});
var arcFull = (a) => ({
  id: a.id,
  restricted: false,
  agenda_number: a.agenda_number,
  archived_at: a.archived_at,
  archival_year: Number(a.archival_year),
  letter_date: a.letter_date,
  direction: a.direction,
  document_type_id: a.document_type_id,
  document_type: a.document_type_name_snapshot,
  official_number: a.official_number,
  subject: a.subject,
  unit: {
    id: a.owner_unit_id,
    name: a.unit_name
  },
  classification: a.classification,
  row_version: Number(a.row_version)
});
var arcProject = (a) => Number(a.is_full) === 1 ? arcFull(a) : arcRestricted(a);
async function arcUserNames(db, ids) {
  const unique = [...new Set(ids.filter(Boolean))], map = /* @__PURE__ */ new Map();
  if (!unique.length) return map;
  const params = [];
  for (const u of await all(db, `${USER_SQL} WHERE u.id IN ${placeholders(unique, params)}`, ...params)) map.set(u.id, u.full_name || u.username);
  return map;
}
async function arcDocuments(db, archiveId) {
  const docs = await all(db, "SELECT * FROM archive_documents WHERE archive_id=? AND removed_at IS NULL ORDER BY role DESC,display_order,created_at,id", archiveId);
  const versions = await all(db, "SELECT v.* FROM archive_document_versions v JOIN archive_documents d ON d.id=v.document_id WHERE d.archive_id=? AND d.removed_at IS NULL ORDER BY v.version_number DESC", archiveId);
  const names = await arcUserNames(db, versions.map((v) => v.created_by));
  return docs.map((d) => ({
    id: d.id,
    role: d.role,
    current_version_id: d.current_version_id,
    versions: versions.filter((v) => v.document_id === d.id).map((v) => ({
      id: v.id,
      version_number: Number(v.version_number),
      filename: v.original_filename,
      mime: v.detected_mime,
      size: Number(v.byte_size),
      change_reason: v.change_reason,
      created_at: v.created_at,
      created_by: names.get(v.created_by) || "\u2014",
      current: v.id === d.current_version_id
    }))
  }));
}
async function arcDetail(db, ctx, a, access) {
  if (!access.read) return {
    archive: arcRestricted(a),
    access: {
      read: false,
      sources: []
    },
    notice: "Arsip ini berklasifikasi Rahasia. Hubungi Humas secara langsung (misalnya lewat WhatsApp) untuk meminta akses."
  };
  const type = await one(db, "SELECT name,is_active FROM archive_document_types WHERE id=?", a.document_type_id);
  const pending = await one(db, "SELECT id,requested_by,requested_at,reason FROM archive_delete_requests WHERE archive_id=? AND status='PENDING'", a.id);
  const names = await arcUserNames(db, [a.created_by, a.updated_by, pending?.requested_by]);
  const showPending = pending && (ctx.humas || access.edit || pending.requested_by === ctx.user.id);
  return {
    archive: {
      ...arcFull({
        ...a,
        is_full: 1
      }),
      security_epoch: Number(a.security_epoch),
      updated_at: a.updated_at,
      created_by: names.get(a.created_by) || "\u2014",
      updated_by: names.get(a.updated_by) || "\u2014",
      document_type_current: type?.name || a.document_type_name_snapshot,
      document_type_active: Number(type?.is_active) === 1
    },
    documents: await arcDocuments(db, a.id),
    access: {
      read: true,
      edit: access.edit,
      download: access.download,
      download_grant: access.download_grant,
      request_delete: access.edit,
      humas: ctx.humas,
      history: ctx.humas || access.edit,
      sources: access.sources
    },
    delete_request: showPending ? {
      id: pending.id,
      requested_at: pending.requested_at,
      requested_by: names.get(pending.requested_by) || "\u2014",
      reason: pending.reason,
      mine: pending.requested_by === ctx.user.id
    } : null
  };
}
async function arcShow(db, ctx, id) {
  const loaded = await arcLoad(db, ctx, id);
  return await arcDetail(db, ctx, loaded.a, loaded.access);
}
async function arcTypes(db) {
  return (await all(db, "SELECT id,code,name,is_active,row_version FROM archive_document_types ORDER BY is_active DESC,name,id")).map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    active: Number(t.is_active) === 1,
    row_version: Number(t.row_version)
  }));
}
async function arcUnitCodes(db) {
  return new Map((await all(db, "SELECT org_unit_id,agenda_code FROM archive_units")).map((r) => [r.org_unit_id, r.agenda_code]));
}
async function arcUnread(db, userId) {
  return Number((await one(db, "SELECT count(*) n FROM archive_notifications WHERE recipient_user_id=? AND read_at IS NULL", userId)).n);
}
async function arcOverview(db, ctx) {
  if (ctx.humas) await archiveEnsureDailySummaries(db);
  const codes = await arcUnitCodes(db), unit = (id) => ({
    id,
    name: ctx.tree.byId.get(id)?.name || "\u2014",
    agenda_code: codes.get(id) || null
  });
  const known = ctx.humas || ctx.oversight === "ALL" ? [...codes.keys()] : [.../* @__PURE__ */ new Set([...ctx.memberUnits, ...ctx.oversight])].filter((id) => codes.has(id));
  return {
    humas: ctx.humas,
    admin: ctx.admin,
    oversight: ctx.oversight === "ALL" || ctx.oversight.size > 0,
    employee: Boolean(ctx.user.employee_id),
    officer_units: [...ctx.officerUnits].map(unit),
    units: known.map(unit).sort((x, y) => x.name.localeCompare(y.name)),
    types: await arcTypes(db),
    limits: {
      max_file_bytes: archiveRules.maxFileBytes,
      mimes: archiveRules.mimes,
      max_attachments: archiveRules.maxAttachmentsPerRequest,
      subject_max: archiveRules.subjectMax,
      number_max: archiveRules.numberMax
    },
    unread: await arcUnread(db, ctx.user.id),
    pending_delete_requests: ctx.humas ? Number((await one(db, "SELECT count(*) n FROM archive_delete_requests WHERE status='PENDING'")).n) : 0
  };
}
function arcFilters(ctx, query, params) {
  const where = ["a.deleted_at IS NULL", listSql(ctx, params)];
  let hidden = false;
  const day = (key, label) => {
    const v = query.get(key);
    if (!v) return null;
    assert(archiveValidDay(v), `${label} tidak valid.`);
    return v;
  };
  const from = day("from", "Tanggal awal"), to = day("to", "Tanggal akhir");
  if (from) {
    where.push("a.archived_at>=?");
    params.push(archiveDayStart(from));
  }
  if (to) {
    where.push("a.archived_at<?");
    params.push(archiveDayEnd(to));
  }
  if (from && to) assert(from <= to, "Tanggal awal tidak boleh setelah tanggal akhir.");
  const unit = query.get("unit");
  if (unit) {
    where.push("a.owner_unit_id=?");
    params.push(idOf(unit, "Bagian"));
  }
  const classification = query.get("classification");
  if (classification) {
    assert(archiveClassifications.includes(classification), "Klasifikasi tidak valid.");
    where.push("a.classification=?");
    params.push(classification);
  }
  if (query.get("shared") === "1") {
    const member = [...ctx.memberUnits];
    params.push(ctx.user.id);
    where.push(`EXISTS(SELECT 1 FROM archive_access_grants g WHERE g.archive_id=a.id AND g.purpose='BIASA_SHARE' AND g.revoked_at IS NULL AND (g.target_user_id=?${member.length ? ` OR g.target_unit_id IN ${placeholders(member, params)}` : ""}))`);
  }
  const full = (condition, ...values) => {
    hidden = true;
    where.push(`(${fullSql(ctx, params)} AND ${condition})`);
    params.push(...values);
  };
  const type = query.get("type");
  if (type) full("a.document_type_id=?", idOf(type, "Jenis dokumen"));
  const direction = query.get("direction");
  if (direction) {
    assert(archiveDirections.includes(direction), "Arah surat tidak valid.");
    full("a.direction=?", direction);
  }
  const letterFrom = day("letter_from", "Tanggal surat awal"), letterTo = day("letter_to", "Tanggal surat akhir");
  if (letterFrom) full("a.letter_date>=?", letterFrom);
  if (letterTo) full("a.letter_date<=?", letterTo);
  const q = (query.get("q") || "").trim();
  if (q) {
    assert(q.length <= 120, "Kata pencarian terlalu panjang.");
    hidden = true;
    const number = archiveNormalNumber(q), subject = archiveNormalSubject(q), inner = [], values = [];
    if (number) {
      inner.push("a.official_number_normalized LIKE ? ESCAPE '\\'");
      values.push(archiveLike(number));
    }
    if (subject) {
      inner.push("a.subject_normalized LIKE ? ESCAPE '\\'");
      values.push(archiveLike(subject));
    }
    params.push(archiveLike(q.toUpperCase().replace(/\s+/g, "")));
    let clause = "(a.agenda_number LIKE ? ESCAPE '\\'";
    if (inner.length) {
      clause += ` OR (${fullSql(ctx, params)} AND (${inner.join(" OR ")}))`;
      params.push(...values);
    }
    where.push(clause + ")");
  }
  return {
    where,
    hidden: hidden && !ctx.humas
  };
}
async function arcList(db, ctx, query) {
  const size = Math.min(Math.max(Number.parseInt(query.get("limit") || archiveRules.pageSize, 10) || archiveRules.pageSize, 1), archiveRules.maxPageSize);
  const selectParams = [], select = `SELECT a.*,u.name AS unit_name,CASE WHEN ${fullSql(ctx, selectParams)} THEN 1 ELSE 0 END AS is_full FROM archive_records a JOIN org_units u ON u.id=a.owner_unit_id`;
  const filterParams = [], filters = arcFilters(ctx, query, filterParams);
  const total = Number((await one(db, `SELECT count(*) n FROM archive_records a WHERE ${filters.where.join(" AND ")}`, ...filterParams)).n);
  const pageWhere = [...filters.where], pageParams = [...selectParams, ...filterParams], cursor = query.get("cursor");
  if (cursor) {
    let at;
    try {
      at = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    } catch {
      at = null;
    }
    assert(Array.isArray(at) && at.length === 2 && typeof at[0] === "string" && typeof at[1] === "string", "Penanda halaman tidak valid.");
    pageWhere.push("(a.archived_at<? OR (a.archived_at=? AND a.id<?))");
    pageParams.push(at[0], at[0], at[1]);
  }
  const rows = await all(db, `${select} WHERE ${pageWhere.join(" AND ")} ORDER BY a.archived_at DESC,a.id DESC LIMIT ${size + 1}`, ...pageParams);
  const page = rows.slice(0, size), last = page.at(-1);
  return {
    items: page.map(arcProject),
    total,
    next_cursor: rows.length > size ? Buffer.from(JSON.stringify([last.archived_at, last.id])).toString("base64url") : null,
    readable_only: filters.hidden
  };
}
async function arcDashboard(db, ctx) {
  const p1 = [], base = `FROM archive_records a WHERE a.deleted_at IS NULL AND ${listSql(ctx, p1)}`, total = Number((await one(db, `SELECT count(*) n ${base}`, ...p1)).n);
  const p2 = [], readable = Number((await one(db, `SELECT count(*) n FROM archive_records a WHERE a.deleted_at IS NULL AND ${fullSql(ctx, p2)}`, ...p2)).n);
  const p3 = [], types = await all(db, `SELECT a.document_type_id,count(*) n FROM archive_records a WHERE a.deleted_at IS NULL AND ${fullSql(ctx, p3)} GROUP BY a.document_type_id`, ...p3);
  const names = new Map((await arcTypes(db)).map((t) => [t.id, t.name]));
  const p4 = [], latest = await all(db, `SELECT a.*,u.name AS unit_name,CASE WHEN ${fullSql(ctx, p4)} THEN 1 ELSE 0 END AS is_full FROM archive_records a JOIN org_units u ON u.id=a.owner_unit_id
  WHERE a.deleted_at IS NULL AND ${listSql(ctx, p4)} ORDER BY a.archived_at DESC,a.id DESC LIMIT 8`, ...p4);
  return {
    total,
    readable,
    restricted: total - readable,
    by_type: types.map((t) => ({
      id: t.document_type_id,
      name: names.get(t.document_type_id) || "\u2014",
      count: Number(t.n)
    })).sort((x, y) => y.count - x.count || x.name.localeCompare(y.name)),
    latest: latest.map(arcProject)
  };
}
async function arcClaim(db, ctx, deps, fileId) {
  const file = await one(db, "SELECT * FROM files WHERE id=?", idOf(fileId, "Berkas"));
  assert(file && file.status === "AVAILABLE" && file.uploaded_by === ctx.user.id, "Berkas tidak tersedia. Unggah ulang berkas tersebut.", 422);
  assert(!await one(db, "SELECT 1 AS ok FROM archive_document_versions WHERE file_id=?", file.id), "Berkas sudah dipakai arsip lain. Unggah berkas baru.", 422);
  assert(archiveRules.mimes.includes(file.mime_type), `${file.original_name}: jenis berkas harus PDF, JPG, JPEG, atau PNG.`, 422);
  assert(Number(file.size_bytes) > 0 && Number(file.size_bytes) <= archiveRules.maxFileBytes, `${file.original_name}: ukuran berkas melebihi 10 MB.`, 413);
  const extension = String(file.original_name).split(".").pop().toLowerCase();
  assert(archiveRules.extensions[extension] === file.mime_type, `${file.original_name}: ekstensi tidak sesuai dengan isi berkas.`, 422);
  const claimFile = deps.claimFile;
  if (claimFile) await claimFile(db, ctx.user, file.id);
  return file;
}
async function arcVersion(db, ctx, deps, documentId, number, file, reason) {
  const id = uid();
  await insert(db, "archive_document_versions", {
    id,
    document_id: documentId,
    version_number: number,
    file_id: file.id,
    original_filename: file.original_name,
    detected_mime: file.mime_type,
    byte_size: Number(file.size_bytes),
    sha256: file.checksum,
    change_reason: reason || null,
    created_by: ctx.user.id
  });
  if (deps.claimStorage) deps.claimStorage(file.storage_key);
  return id;
}
async function arcDuplicates(db, ctx, incoming, checksums) {
  const found = /* @__PURE__ */ new Map(), add = (row, checksum) => {
    const item = found.get(row.id) || {
      ...row,
      checksum_match: false
    };
    if (checksum) item.checksum_match = true;
    found.set(row.id, item);
  };
  const fields = "a.id,a.agenda_number,a.archived_at,a.letter_date,a.official_number,a.official_number_normalized,a.subject,a.subject_normalized,a.classification,a.owner_unit_id,a.security_epoch,a.deleted_at,a.document_type_name_snapshot";
  if (checksums.length) {
    const params = [];
    for (const row of await all(db, `SELECT DISTINCT ${fields} FROM archive_records a JOIN archive_documents d ON d.archive_id=a.id AND d.removed_at IS NULL JOIN archive_document_versions v ON v.document_id=d.id WHERE v.sha256 IN ${placeholders(checksums, params)}`, ...params)) add(row, true);
  }
  if (incoming.official_number_normalized) for (const row of await all(db, `SELECT ${fields} FROM archive_records a WHERE a.official_number_normalized=? AND a.letter_date=?`, incoming.official_number_normalized, incoming.letter_date)) add(row, false);
  for (const row of await all(db, `SELECT ${fields} FROM archive_records a WHERE a.letter_date=? AND a.subject_normalized=?`, incoming.letter_date, incoming.subject_normalized)) add(row, false);
  const visible = [], internal = [];
  for (const row of found.values()) {
    const reasons = archiveDuplicateReasons(row, incoming);
    if (!reasons.length) continue;
    if (!row.deleted_at && (await arcAccess(db, ctx, row)).read) visible.push({
      id: row.id,
      agenda_number: row.agenda_number,
      archived_at: row.archived_at,
      letter_date: row.letter_date,
      official_number: row.official_number,
      subject: row.subject,
      document_type: row.document_type_name_snapshot,
      reasons
    });
    else internal.push(row.id);
  }
  return {
    visible,
    internal
  };
}
async function arcOperation(db, ctx, type, key, fingerprint) {
  assert(typeof key === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(key), "Kunci operasi tidak valid. Muat ulang halaman.", 422);
  const done = await one(db, "SELECT * FROM archive_upload_operations WHERE actor_id=? AND operation_type=? AND idempotency_key=?", ctx.user.id, type, key);
  if (done) assert(done.payload_fingerprint === fingerprint, "Operasi ini sudah selesai dengan isi berbeda. Mulai operasi baru.", 409);
  return done || null;
}
async function arcType(db, id, { mustBeActive }) {
  const type = await one(db, "SELECT * FROM archive_document_types WHERE id=?", idOf(id, "Jenis dokumen"));
  assert(type, "Jenis dokumen tidak ditemukan.", 422);
  if (mustBeActive) assert(Number(type.is_active) === 1, "Jenis dokumen ini sudah nonaktif. Pilih jenis lain.", 422);
  return type;
}
async function arcMetadata(db, b, { currentTypeId = null } = {}) {
  assert(archiveDirections.includes(b.direction), "Arah surat wajib dipilih: Masuk, Keluar, atau Internal.");
  const type = await arcType(db, b.document_type_id, {
    mustBeActive: b.document_type_id !== currentTypeId
  });
  const official = str(b.official_number, "Nomor surat", archiveRules.numberMax, {
    optional: true
  });
  assert(archiveValidDay(b.letter_date), "Tanggal surat wajib diisi dengan tanggal yang valid.");
  const subject = str(b.subject, "Perihal", archiveRules.subjectMax);
  return {
    direction: b.direction,
    document_type_id: type.id,
    document_type_name_snapshot: type.name,
    official_number: official,
    official_number_normalized: official ? archiveNormalNumber(official) : null,
    letter_date: b.letter_date,
    subject,
    subject_normalized: archiveNormalSubject(subject)
  };
}
var arcMetaView = (m) => ({
  direction: m.direction,
  document_type_id: m.document_type_id,
  document_type: m.document_type_name_snapshot,
  official_number: m.official_number,
  letter_date: m.letter_date,
  subject: m.subject
});
async function arcCreate(db, ctx, deps, b) {
  const unitId = idOf(b.owner_unit_id, "Bagian");
  if (!ctx.officerUnits.has(unitId)) throw denied(db, ctx.user, "CREATE", null, "Hanya petugas arsip yang ditunjuk untuk bagian ini yang dapat menambah arsip.");
  const attachments = Array.isArray(b.attachment_file_ids) ? b.attachment_file_ids : [];
  assert(typeof b.main_file_id === "string" && b.main_file_id, "Dokumen utama wajib diunggah.");
  assert(attachments.length <= archiveRules.maxAttachmentsPerRequest, `Paling banyak ${archiveRules.maxAttachmentsPerRequest} lampiran per penyimpanan. Lampiran lain dapat ditambahkan dari detail arsip.`);
  const fileIds = [b.main_file_id, ...attachments];
  assert(fileIds.every((id) => typeof id === "string") && new Set(fileIds).size === fileIds.length, "Daftar berkas tidak valid.");
  return await tx(db, async () => {
    const meta = await arcMetadata(db, b);
    const fingerprint = archiveFingerprint([unitId, arcMetaView(meta), fileIds]);
    const done = await arcOperation(db, ctx, "CREATE_ARCHIVE", b.idempotency_key, fingerprint);
    if (done) {
      const { a: a2, access } = await arcLoad(db, ctx, done.result_archive_id);
      return {
        archive: access.read ? arcFull(a2) : arcRestricted(a2),
        repeated: true
      };
    }
    const unit = await one(db, "SELECT agenda_code FROM archive_units WHERE org_unit_id=?", unitId);
    assert(unit, "Kode agenda bagian ini belum ditetapkan. Hubungi administrator portal.", 422);
    const files = await asyncMap(fileIds, async (id2) => await arcClaim(db, ctx, deps, id2));
    const duplicates = await arcDuplicates(db, ctx, meta, [...new Set(files.map((f) => f.checksum))]);
    const reason = str(b.duplicate_reason, "Alasan tetap menyimpan", archiveRules.longReasonMax, {
      optional: true
    });
    if (duplicates.visible.length && !reason) return {
      duplicate_warning: true,
      candidates: duplicates.visible
    };
    const archivedAt = now(), year = archiveWitaYear(Date.parse(archivedAt)), id = uid(), operationId = uid();
    const sequence = Number((await one(db, `INSERT INTO archive_agenda_counters(id,org_unit_id,archival_year,last_value,updated_at) VALUES(?,?,?,1,?)
   ON CONFLICT(org_unit_id,archival_year) DO UPDATE SET last_value=archive_agenda_counters.last_value+1,updated_at=excluded.updated_at RETURNING last_value`, uid(), unitId, year, archivedAt)).last_value);
    const agenda = archiveAgendaNumber(unit.agenda_code, year, sequence);
    await run(db, `INSERT INTO archive_records(id,owner_unit_id,unit_code_snapshot,archival_year,agenda_sequence,agenda_number,archived_at,direction,document_type_id,document_type_name_snapshot,
   official_number,official_number_normalized,letter_date,subject,subject_normalized,classification,security_epoch,row_version,source_kind,created_by,updated_by,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'BIASA',1,1,'MANUAL',?,?,?,?)`, id, unitId, unit.agenda_code, year, sequence, agenda, archivedAt, meta.direction, meta.document_type_id, meta.document_type_name_snapshot, meta.official_number, meta.official_number_normalized, meta.letter_date, meta.subject, meta.subject_normalized, ctx.user.id, ctx.user.id, archivedAt, archivedAt);
    await asyncForEach(files, async (file, index) => {
      const documentId = uid(), versionId = uid();
      await run(db, "INSERT INTO archive_documents(id,archive_id,role,display_order,current_version_id,created_by,created_at,updated_at,row_version) VALUES(?,?,?,?,?,?,?,?,1)", documentId, id, index === 0 ? "MAIN" : "ATTACHMENT", index, versionId, ctx.user.id, archivedAt, archivedAt);
      await insert(db, "archive_document_versions", {
        id: versionId,
        document_id: documentId,
        version_number: 1,
        file_id: file.id,
        original_filename: file.original_name,
        detected_mime: file.mime_type,
        byte_size: Number(file.size_bytes),
        sha256: file.checksum,
        change_reason: null,
        created_by: ctx.user.id
      });
      if (deps.claimStorage) deps.claimStorage(file.storage_key);
    });
    await insert(db, "archive_upload_operations", {
      id: operationId,
      actor_id: ctx.user.id,
      owner_unit_id: unitId,
      operation_type: "CREATE_ARCHIVE",
      idempotency_key: b.idempotency_key,
      payload_fingerprint: fingerprint,
      status: "COMMITTED",
      result_archive_id: id,
      request_id: ctx.user.request_id || uid()
    });
    await arcAudit(db, ctx, "ARCHIVE_CREATED", {
      archive_id: id,
      operation_id: operationId,
      after: {
        ...arcMetaView(meta),
        agenda_number: agenda,
        classification: "BIASA"
      },
      context: {
        files: files.length
      }
    });
    if (duplicates.visible.length || duplicates.internal.length) {
      await insert(db, "archive_duplicate_overrides", {
        archive_id: id,
        operation_id: operationId,
        actor_id: ctx.user.id,
        reason: duplicates.visible.length ? reason : null,
        rule_version: archiveRules.duplicateRuleVersion,
        visible_match_ids: JSON.stringify(duplicates.visible.map((c) => c.id)),
        internal_match_ids: JSON.stringify(duplicates.internal)
      });
      if (duplicates.visible.length) await arcAudit(db, ctx, "DUPLICATE_OVERRIDE", {
        archive_id: id,
        operation_id: operationId,
        reason,
        context: {
          visible: duplicates.visible.length
        }
      });
    }
    const a = await one(db, "SELECT a.*,u.name AS unit_name FROM archive_records a JOIN org_units u ON u.id=a.owner_unit_id WHERE a.id=?", id);
    return {
      archive: arcFull({
        ...a,
        is_full: 1
      })
    };
  });
}
async function arcBump(db, ctx, a, expected, fields = {}) {
  assert(Number.isInteger(expected), "Versi data wajib dikirim. Muat ulang arsip.", 409);
  const row = {
    ...fields,
    updated_at: now(),
    updated_by: ctx.user.id
  }, keys = Object.keys(row);
  const changed = await run(db, `UPDATE archive_records SET ${keys.map((k) => `${k}=?`).join(",")},row_version=row_version+1 WHERE id=? AND row_version=? AND deleted_at IS NULL`, ...keys.map((k) => row[k] ?? null), a.id, expected);
  assert(changed.changes === 1, "Arsip ini sudah diubah orang lain. Muat ulang, tinjau perubahan terbaru, lalu simpan kembali.", 409);
}
async function arcEdit(db, ctx, id, b) {
  return await tx(db, async () => {
    const { a, access } = await arcLoadFull(db, ctx, id, "EDIT");
    if (!access.edit) throw denied(db, ctx.user, "EDIT", a.id, "Hanya petugas arsip bagian pemilik yang dapat mengubah arsip ini.");
    const meta = await arcMetadata(db, b, {
      currentTypeId: a.document_type_id
    });
    if (meta.document_type_id === a.document_type_id) meta.document_type_name_snapshot = a.document_type_name_snapshot;
    const before = arcMetaView(a), after = arcMetaView(meta);
    const changedKeys = Object.keys(after).filter((k) => k !== "document_type" && (before[k] ?? null) !== (after[k] ?? null));
    assert(changedKeys.length, "Tidak ada perubahan untuk disimpan.");
    await arcBump(db, ctx, a, b.expected_row_version, meta);
    await arcAudit(db, ctx, "METADATA_EDITED", {
      archive_id: a.id,
      before: Object.fromEntries(changedKeys.map((k) => [k, before[k] ?? null])),
      after: Object.fromEntries(changedKeys.map((k) => [k, after[k] ?? null])),
      context: meta.document_type_id !== a.document_type_id ? {
        document_type_before: a.document_type_name_snapshot,
        document_type_after: meta.document_type_name_snapshot
      } : {}
    });
    return await arcShow(db, ctx, a.id);
  });
}
async function arcAddAttachment(db, ctx, deps, id, b) {
  return await tx(db, async () => {
    const { a, access } = await arcLoadFull(db, ctx, id, "ADD_ATTACHMENT");
    if (!access.edit) throw denied(db, ctx.user, "ADD_ATTACHMENT", a.id, "Hanya petugas arsip bagian pemilik yang dapat menambah lampiran.");
    const fingerprint = archiveFingerprint([a.id, b.file_id]), done = await arcOperation(db, ctx, "ADD_ATTACHMENT", b.idempotency_key, fingerprint);
    if (!done) {
      const file = await arcClaim(db, ctx, deps, b.file_id);
      await arcBump(db, ctx, a, b.expected_row_version);
      const order = Number((await one(db, "SELECT coalesce(max(display_order),0)+1 AS n FROM archive_documents WHERE archive_id=?", a.id)).n), documentId = uid(), versionId = uid(), at = now(), operationId = uid();
      await run(db, "INSERT INTO archive_documents(id,archive_id,role,display_order,current_version_id,created_by,created_at,updated_at,row_version) VALUES(?,?,'ATTACHMENT',?,?,?,?,?,1)", documentId, a.id, order, versionId, ctx.user.id, at, at);
      await insert(db, "archive_document_versions", {
        id: versionId,
        document_id: documentId,
        version_number: 1,
        file_id: file.id,
        original_filename: file.original_name,
        detected_mime: file.mime_type,
        byte_size: Number(file.size_bytes),
        sha256: file.checksum,
        change_reason: null,
        created_by: ctx.user.id
      });
      if (deps.claimStorage) deps.claimStorage(file.storage_key);
      await insert(db, "archive_upload_operations", {
        id: operationId,
        actor_id: ctx.user.id,
        owner_unit_id: a.owner_unit_id,
        operation_type: "ADD_ATTACHMENT",
        idempotency_key: b.idempotency_key,
        payload_fingerprint: fingerprint,
        status: "COMMITTED",
        result_archive_id: a.id,
        result_document_id: documentId,
        result_version_id: versionId,
        request_id: ctx.user.request_id || uid()
      });
      await arcAudit(db, ctx, "ATTACHMENT_ADDED", {
        archive_id: a.id,
        document_id: documentId,
        version_id: versionId,
        operation_id: operationId,
        after: {
          filename: file.original_name,
          size: Number(file.size_bytes)
        }
      });
    }
    return await arcShow(db, ctx, a.id);
  });
}
async function arcDocument(db, a, documentId) {
  const d = await one(db, "SELECT * FROM archive_documents WHERE id=? AND archive_id=? AND removed_at IS NULL", idOf(documentId, "Dokumen"), a.id);
  if (!d) throw new AppError(404, "Dokumen tidak ditemukan.");
  return d;
}
async function arcReplaceFile(db, ctx, deps, id, documentId, b) {
  return await tx(db, async () => {
    const { a, access } = await arcLoadFull(db, ctx, id, "REPLACE_FILE");
    if (!access.edit) throw denied(db, ctx.user, "REPLACE_FILE", a.id, "Hanya petugas arsip bagian pemilik yang dapat mengganti berkas.");
    const d = await arcDocument(db, a, documentId), reason = str(b.change_reason, "Alasan penggantian berkas", archiveRules.reasonMax);
    const fingerprint = archiveFingerprint([a.id, d.id, b.file_id, reason]), done = await arcOperation(db, ctx, "REPLACE_FILE", b.idempotency_key, fingerprint);
    if (!done) {
      const file = await arcClaim(db, ctx, deps, b.file_id);
      await arcBump(db, ctx, a, b.expected_row_version);
      const number = Number((await one(db, "SELECT coalesce(max(version_number),0)+1 AS n FROM archive_document_versions WHERE document_id=?", d.id)).n), operationId = uid();
      const versionId = await arcVersion(db, ctx, deps, d.id, number, file, reason);
      await run(db, "UPDATE archive_documents SET current_version_id=?,updated_at=?,row_version=row_version+1 WHERE id=?", versionId, now(), d.id);
      await insert(db, "archive_upload_operations", {
        id: operationId,
        actor_id: ctx.user.id,
        owner_unit_id: a.owner_unit_id,
        operation_type: "REPLACE_FILE",
        idempotency_key: b.idempotency_key,
        payload_fingerprint: fingerprint,
        status: "COMMITTED",
        result_archive_id: a.id,
        result_document_id: d.id,
        result_version_id: versionId,
        request_id: ctx.user.request_id || uid()
      });
      await arcAudit(db, ctx, "VERSION_ADDED", {
        archive_id: a.id,
        document_id: d.id,
        version_id: versionId,
        operation_id: operationId,
        reason,
        after: {
          role: d.role,
          version_number: number,
          filename: file.original_name,
          size: Number(file.size_bytes)
        }
      });
    }
    return await arcShow(db, ctx, a.id);
  });
}
async function arcRemoveAttachment(db, ctx, id, documentId, b) {
  return await tx(db, async () => {
    const { a, access } = await arcLoadFull(db, ctx, id, "REMOVE_ATTACHMENT");
    if (!access.edit) throw denied(db, ctx.user, "REMOVE_ATTACHMENT", a.id, "Hanya petugas arsip bagian pemilik yang dapat melepas lampiran.");
    const d = await arcDocument(db, a, documentId);
    assert(d.role === "ATTACHMENT", "Dokumen utama tidak dapat dilepas. Ganti berkasnya dengan versi baru.");
    const reason = str(b.reason, "Alasan melepas lampiran", archiveRules.reasonMax), at = now();
    await arcBump(db, ctx, a, b.expected_row_version);
    await run(db, "UPDATE archive_documents SET removed_at=?,removed_by=?,remove_reason=?,updated_at=?,row_version=row_version+1 WHERE id=?", at, ctx.user.id, reason, at, d.id);
    await arcAudit(db, ctx, "ATTACHMENT_REMOVED", {
      archive_id: a.id,
      document_id: d.id,
      reason
    });
    return await arcShow(db, ctx, a.id);
  });
}
async function arcVersionOf(db, a, documentId, versionId) {
  const v = await one(db, `SELECT v.*,f.storage_key,f.size_bytes,f.checksum,f.status FROM archive_document_versions v JOIN archive_documents d ON d.id=v.document_id JOIN files f ON f.id=v.file_id
  WHERE v.id=? AND d.id=? AND d.archive_id=? AND d.removed_at IS NULL`, idOf(versionId, "Versi"), idOf(documentId, "Dokumen"), a.id);
  if (!v || v.status !== "AVAILABLE") throw new AppError(404, "Berkas tidak ditemukan.");
  return v;
}
function arcHumas(db, ctx, action, archiveId = null) {
  if (!ctx.humas) throw denied(db, ctx.user, action, archiveId, "Tindakan ini hanya untuk Humas.");
}
async function arcRevokeEpochGrants(db, ctx, a, reason) {
  const at = now(), open = await all(db, "SELECT id,purpose FROM archive_access_grants WHERE archive_id=? AND revoked_at IS NULL AND purpose IN('RAHASIA_READ','DOWNLOAD')", a.id);
  await run(db, "UPDATE archive_access_grants SET revoked_at=?,revoked_by=?,revoked_reason=?,updated_at=?,row_version=row_version+1 WHERE archive_id=? AND revoked_at IS NULL AND purpose IN('RAHASIA_READ','DOWNLOAD')", at, ctx.user.id, reason, at, a.id);
  return {
    rahasia_read: open.filter((g) => g.purpose === "RAHASIA_READ").length,
    download: open.filter((g) => g.purpose === "DOWNLOAD").length
  };
}
async function arcClassify(db, ctx, id, b) {
  return await tx(db, async () => {
    arcHumas(db, ctx, "CLASSIFY", id);
    const { a } = await arcLoadFull(db, ctx, id, "CLASSIFY");
    assert(archiveClassifications.includes(b.target) && b.target !== a.classification, "Pilih klasifikasi yang berbeda dari klasifikasi saat ini.");
    const reason = str(b.reason, "Alasan perubahan klasifikasi", archiveRules.reasonMax);
    await arcBump(db, ctx, a, b.expected_row_version, {
      classification: b.target,
      security_epoch: Number(a.security_epoch) + 1
    });
    const ended = await arcRevokeEpochGrants(db, ctx, a, `Klasifikasi diubah menjadi ${b.target === "RAHASIA" ? "Rahasia" : "Biasa"}`);
    await arcAudit(db, ctx, "CLASSIFICATION_CHANGED", {
      archive_id: a.id,
      reason,
      before: {
        classification: a.classification,
        security_epoch: Number(a.security_epoch)
      },
      after: {
        classification: b.target,
        security_epoch: Number(a.security_epoch) + 1
      },
      context: {
        grants_ended: ended
      }
    });
    return await arcShow(db, ctx, a.id);
  });
}
async function arcActiveUser(db, id) {
  const u = await one(db, `${USER_SQL} WHERE u.id=? AND u.status='ACTIVE' AND (u.employee_id IS NULL OR e.is_active=1)`, idOf(id, "Pengguna"));
  assert(u, "Pengguna tidak ditemukan atau tidak aktif.", 422);
  return u;
}
async function arcUnitMembers(db, tree, unitId) {
  const inside = tree.descendants(unitId), day = today();
  return (await all(db, `SELECT u.id,u.username,e.full_name,p.org_unit_id,p.name AS position_name FROM users u JOIN employees e ON e.id=u.employee_id AND e.is_active=1
  JOIN employee_placements ep ON ep.employee_id=e.id AND ep.is_primary=1 AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?)
  JOIN positions p ON p.id=ep.position_id WHERE u.status='ACTIVE' ORDER BY e.full_name,u.id`, day, day)).filter((r) => inside.has(r.org_unit_id));
}
async function arcCanRead(db, tree, a, userId) {
  const user = await one(db, "SELECT id,username,employee_id FROM users WHERE id=?", userId);
  if (!user) return false;
  const nowIso = now(), ctx = {
    user,
    tree,
    nowIso,
    humas: await arcHolds(db, userId, HUMAS),
    memberUnits: await arcMemberUnits(db, tree, user.employee_id),
    officerUnits: /* @__PURE__ */ new Set(),
    oversight: await arcOversight(db, tree, userId)
  };
  return (await arcAccess(db, ctx, a)).read;
}
async function arcGrantView(db, ctx, a) {
  const grants = await all(db, "SELECT * FROM archive_access_grants WHERE archive_id=? ORDER BY revoked_at IS NOT NULL,granted_at DESC,id LIMIT 200", a.id);
  const names = await arcUserNames(db, grants.flatMap((g) => [g.target_user_id, g.granted_by, g.revoked_by]));
  const label = {
    BIASA_SHARE: "Berbagi Biasa",
    RAHASIA_READ: "Baca Rahasia",
    DOWNLOAD: "Unduh"
  };
  return await asyncMap(grants, async (g) => {
    const open = !g.revoked_at, epochOk = g.purpose === "BIASA_SHARE" || Number(g.security_epoch) === Number(a.security_epoch), timeOk = g.valid_from <= ctx.nowIso && (!g.expires_at || g.expires_at > ctx.nowIso);
    const active = open && epochOk && timeOk && (g.purpose !== "BIASA_SHARE" || a.classification === "BIASA") && (g.purpose !== "RAHASIA_READ" || a.classification === "RAHASIA");
    return {
      id: g.id,
      purpose: g.purpose,
      purpose_label: label[g.purpose],
      target: g.target_user_id ? {
        kind: "USER",
        id: g.target_user_id,
        name: names.get(g.target_user_id) || "\u2014"
      } : {
        kind: "UNIT",
        id: g.target_unit_id,
        name: ctx.tree.byId.get(g.target_unit_id)?.name || "\u2014"
      },
      valid_from: g.valid_from,
      expires_at: g.expires_at,
      granted_at: g.granted_at,
      granted_by: names.get(g.granted_by) || "\u2014",
      reason: g.reason,
      revoked_at: g.revoked_at,
      revoked_by: g.revoked_by ? names.get(g.revoked_by) || "\u2014" : null,
      revoked_reason: g.revoked_reason,
      open,
      active,
      status: !open ? "DICABUT" : !timeOk && g.expires_at && g.expires_at <= ctx.nowIso ? "KEDALUWARSA" : !active ? "TIDAK_BERLAKU" : "AKTIF",
      effective: g.purpose === "DOWNLOAD" && active ? await arcCanRead(db, ctx.tree, a, g.target_user_id) : void 0
    };
  });
}
async function arcAccessPanel(db, ctx, id) {
  arcHumas(db, ctx, "ACCESS_PANEL", id);
  const { a } = await arcLoadFull(db, ctx, id, "ACCESS_PANEL"), grants = await arcGrantView(db, ctx, a), open = (purpose) => grants.filter((g) => g.open && g.purpose === purpose);
  return {
    archive: {
      id: a.id,
      agenda_number: a.agenda_number,
      classification: a.classification,
      security_epoch: Number(a.security_epoch),
      row_version: Number(a.row_version),
      unit: {
        id: a.owner_unit_id,
        name: a.unit_name
      }
    },
    grants,
    impact: {
      unit_members: (await arcUnitMembers(db, ctx.tree, a.owner_unit_id)).length,
      share_users: open("BIASA_SHARE").filter((g) => g.target.kind === "USER").length,
      share_units: open("BIASA_SHARE").filter((g) => g.target.kind === "UNIT").length,
      rahasia_grants: open("RAHASIA_READ").length,
      download_grants: open("DOWNLOAD").length
    }
  };
}
async function arcGrant(db, ctx, id, b) {
  return await tx(db, async () => {
    arcHumas(db, ctx, "GRANT", id);
    const { a } = await arcLoadFull(db, ctx, id, "GRANT"), purpose = b.purpose, at = now();
    assert(["BIASA_SHARE", "RAHASIA_READ", "DOWNLOAD"].includes(purpose), "Jenis izin tidak valid.");
    let targetUser = null, targetUnit = null, expires = null;
    if (b.target_unit_id) {
      assert(purpose === "BIASA_SHARE" && !b.target_user_id, "Izin Rahasia dan unduh hanya diberikan kepada pengguna bernama.");
      targetUnit = ctx.tree.byId.get(idOf(b.target_unit_id, "Bagian"));
      assert(targetUnit && targetUnit.is_active !== 0, "Bagian tidak ditemukan atau tidak aktif.", 422);
    } else targetUser = await arcActiveUser(db, b.target_user_id);
    if (purpose === "BIASA_SHARE") assert(a.classification === "BIASA", "Berbagi hanya untuk arsip Biasa. Untuk arsip Rahasia, berikan izin baca Rahasia.");
    if (purpose === "RAHASIA_READ") {
      assert(a.classification === "RAHASIA", "Izin baca Rahasia hanya untuk arsip Rahasia.");
      if (b.expires_at) {
        assert(typeof b.expires_at === "string" && !Number.isNaN(Date.parse(b.expires_at)), "Batas waktu izin tidak valid.");
        expires = new Date(b.expires_at).toISOString();
        assert(expires > at, "Batas waktu izin harus setelah waktu sekarang.");
      }
    } else assert(!b.expires_at, "Hanya izin baca Rahasia yang dapat diberi batas waktu.");
    const reason = purpose === "BIASA_SHARE" ? str(b.reason, "Catatan", archiveRules.reasonMax, {
      optional: true
    }) || "Dibagikan oleh Humas" : str(b.reason, "Alasan pemberian izin", archiveRules.reasonMax);
    const previous = targetUser ? await one(db, "SELECT id FROM archive_access_grants WHERE archive_id=? AND purpose=? AND target_user_id=? AND revoked_at IS NULL", a.id, purpose, targetUser.id) : await one(db, "SELECT id FROM archive_access_grants WHERE archive_id=? AND purpose=? AND target_unit_id=? AND revoked_at IS NULL", a.id, purpose, targetUnit.id);
    if (previous) {
      assert(purpose !== "BIASA_SHARE", "Arsip ini sudah dibagikan kepada penerima tersebut.", 409);
      await run(db, "UPDATE archive_access_grants SET revoked_at=?,revoked_by=?,revoked_reason='Diganti izin baru',updated_at=?,row_version=row_version+1 WHERE id=?", at, ctx.user.id, at, previous.id);
    }
    const grant = await insert(db, "archive_access_grants", {
      archive_id: a.id,
      purpose,
      target_user_id: targetUser?.id || null,
      target_unit_id: targetUnit?.id || null,
      security_epoch: purpose === "BIASA_SHARE" ? null : Number(a.security_epoch),
      valid_from: at,
      expires_at: expires,
      granted_by: ctx.user.id,
      granted_at: at,
      reason
    });
    let notified = 0;
    if (purpose === "BIASA_SHARE") {
      const requested = Array.isArray(b.notify_user_ids) ? [...new Set(b.notify_user_ids)] : [];
      assert(requested.length <= 100 && requested.every((x) => typeof x === "string"), "Daftar penerima notifikasi tidak valid.");
      const eligible = new Set(targetUser ? [targetUser.id] : (await arcUnitMembers(db, ctx.tree, targetUnit.id)).map((m) => m.id));
      assert(requested.every((x) => eligible.has(x)), "Penerima notifikasi harus termasuk penerima akses.", 422);
      for (const recipient of requested) {
        await run(db, `INSERT INTO archive_notifications(id,event_id,notification_type,recipient_user_id,archive_id,payload_minimal,created_at,updated_at,row_version) VALUES(?,?,'ARCHIVE_SHARED',?,?,'{}',?,?,1) ON CONFLICT DO NOTHING`, uid(), grant.id, recipient, a.id, at, at);
        notified++;
      }
    }
    await arcAudit(db, ctx, purpose === "BIASA_SHARE" ? "SHARE_GRANTED" : purpose === "RAHASIA_READ" ? "RAHASIA_GRANTED" : "DOWNLOAD_GRANTED", {
      archive_id: a.id,
      reason,
      context: {
        grant_id: grant.id,
        target_user_id: targetUser?.id || null,
        target_unit_id: targetUnit?.id || null,
        expires_at: expires,
        renewed: Boolean(previous),
        notified,
        self_grant: targetUser?.id === ctx.user.id
      }
    });
    return await arcAccessPanel(db, ctx, a.id);
  });
}
async function arcRevoke(db, ctx, id, grantId, b) {
  return await tx(db, async () => {
    arcHumas(db, ctx, "REVOKE", id);
    const { a } = await arcLoadFull(db, ctx, id, "REVOKE");
    const grant = await one(db, "SELECT * FROM archive_access_grants WHERE id=? AND archive_id=?", idOf(grantId, "Izin"), a.id);
    assert(grant && !grant.revoked_at, "Izin tidak ditemukan atau sudah dicabut.", 409);
    const reason = str(b.reason, "Alasan pencabutan", archiveRules.reasonMax, {
      optional: true
    }) || "Dicabut oleh Humas", at = now();
    await run(db, "UPDATE archive_access_grants SET revoked_at=?,revoked_by=?,revoked_reason=?,updated_at=?,row_version=row_version+1 WHERE id=? AND revoked_at IS NULL", at, ctx.user.id, reason, at, grant.id);
    await arcAudit(db, ctx, grant.purpose === "BIASA_SHARE" ? "SHARE_REVOKED" : grant.purpose === "RAHASIA_READ" ? "RAHASIA_REVOKED" : "DOWNLOAD_REVOKED", {
      archive_id: a.id,
      reason,
      context: {
        grant_id: grant.id,
        target_user_id: grant.target_user_id,
        target_unit_id: grant.target_unit_id
      }
    });
    return await arcAccessPanel(db, ctx, a.id);
  });
}
async function arcSoftDelete(db, ctx, a, reason, context = {}) {
  const at = now();
  const changed = await run(db, "UPDATE archive_records SET deleted_at=?,deleted_by=?,delete_reason=?,updated_at=?,updated_by=?,row_version=row_version+1 WHERE id=? AND deleted_at IS NULL", at, ctx.user.id, reason, at, ctx.user.id, a.id);
  assert(changed.changes === 1, "Arsip sudah dihapus.", 409);
  const ended = await arcRevokeEpochGrants(db, ctx, a, "Arsip dihapus");
  await arcAudit(db, ctx, "ARCHIVE_DELETED", {
    archive_id: a.id,
    reason,
    context: {
      ...context,
      grants_ended: ended
    }
  });
}
async function arcRequestDelete(db, ctx, id, b) {
  return await tx(db, async () => {
    const { a, access } = await arcLoadFull(db, ctx, id, "DELETE_REQUEST");
    if (!access.edit) throw denied(db, ctx.user, "DELETE_REQUEST", a.id, "Hanya petugas arsip bagian pemilik yang dapat mengajukan penghapusan.");
    assert(!await one(db, "SELECT 1 AS ok FROM archive_delete_requests WHERE archive_id=? AND status='PENDING'", a.id), "Sudah ada pengajuan penghapusan yang menunggu keputusan Humas.", 409);
    const reason = str(b.reason, "Alasan penghapusan", archiveRules.longReasonMax), at = now();
    const request = await insert(db, "archive_delete_requests", {
      archive_id: a.id,
      requested_by: ctx.user.id,
      requested_at: at,
      reason,
      status: "PENDING"
    });
    await arcAudit(db, ctx, "DELETE_REQUESTED", {
      archive_id: a.id,
      reason,
      context: {
        request_id: request.id
      }
    });
    return await arcShow(db, ctx, a.id);
  });
}
async function arcDeleteRequests(db, ctx, query) {
  const status = query.get("status") || "PENDING";
  assert(["PENDING", "APPROVED", "REJECTED", "CANCELLED", "ALL"].includes(status), "Status tidak valid.");
  const params = [], where = [];
  if (status !== "ALL") {
    where.push("q.status=?");
    params.push(status);
  }
  if (!ctx.humas) {
    where.push("q.requested_by=?");
    params.push(ctx.user.id);
  }
  const rows = await all(db, `SELECT q.*,a.agenda_number,a.subject,a.classification,a.owner_unit_id,a.deleted_at,u.name AS unit_name FROM archive_delete_requests q JOIN archive_records a ON a.id=q.archive_id JOIN org_units u ON u.id=a.owner_unit_id
  ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY q.requested_at DESC,q.id LIMIT 200`, ...params);
  const names = await arcUserNames(db, rows.flatMap((r) => [r.requested_by, r.decided_by]));
  return {
    items: rows.map((r) => ({
      id: r.id,
      archive_id: r.archive_id,
      agenda_number: r.agenda_number,
      subject: ctx.humas ? r.subject : void 0,
      classification: ctx.humas ? r.classification : void 0,
      unit: r.unit_name,
      status: r.status,
      reason: r.reason,
      requested_at: r.requested_at,
      requested_by: names.get(r.requested_by) || "\u2014",
      decided_at: r.decided_at,
      decided_by: r.decided_by ? names.get(r.decided_by) || "\u2014" : null,
      decision_reason: r.decision_reason,
      mine: r.requested_by === ctx.user.id,
      archive_deleted: Boolean(r.deleted_at)
    }))
  };
}
async function arcDecideDelete(db, ctx, requestId, b) {
  return await tx(db, async () => {
    arcHumas(db, ctx, "DELETE_DECIDE");
    const request = await one(db, "SELECT * FROM archive_delete_requests WHERE id=?", idOf(requestId, "Pengajuan"));
    assert(request && request.status === "PENDING", "Pengajuan tidak ditemukan atau sudah diputuskan.", 409);
    assert(["APPROVE", "REJECT"].includes(b.decision), "Keputusan tidak valid.");
    const reason = str(b.reason, "Alasan keputusan", archiveRules.longReasonMax), at = now(), a = await one(db, "SELECT * FROM archive_records WHERE id=?", request.archive_id);
    assert(a && !a.deleted_at, "Arsip sudah dihapus.", 409);
    await run(db, "UPDATE archive_delete_requests SET status=?,decided_by=?,decided_at=?,decision_reason=?,updated_at=?,row_version=row_version+1 WHERE id=? AND status=?", b.decision === "APPROVE" ? "APPROVED" : "REJECTED", ctx.user.id, at, reason, at, request.id, "PENDING");
    if (b.decision === "APPROVE") await arcSoftDelete(db, ctx, a, reason, {
      request_id: request.id
    });
    else await arcAudit(db, ctx, "DELETE_REJECTED", {
      archive_id: a.id,
      reason,
      context: {
        request_id: request.id
      }
    });
    return {
      ok: true,
      status: b.decision === "APPROVE" ? "APPROVED" : "REJECTED"
    };
  });
}
async function arcCancelDelete(db, ctx, requestId) {
  return await tx(db, async () => {
    const request = await one(db, "SELECT * FROM archive_delete_requests WHERE id=?", idOf(requestId, "Pengajuan"));
    if (!request || request.requested_by !== ctx.user.id) throw new AppError(404, "Pengajuan tidak ditemukan.");
    assert(request.status === "PENDING", "Pengajuan sudah diputuskan.", 409);
    const at = now();
    await run(db, "UPDATE archive_delete_requests SET status='CANCELLED',updated_at=?,row_version=row_version+1 WHERE id=? AND status='PENDING'", at, request.id);
    await arcAudit(db, ctx, "DELETE_REQUEST_CANCELLED", {
      archive_id: request.archive_id,
      context: {
        request_id: request.id
      }
    });
    return {
      ok: true,
      status: "CANCELLED"
    };
  });
}
async function arcDeleteDirect(db, ctx, id, b) {
  return await tx(db, async () => {
    arcHumas(db, ctx, "DELETE", id);
    const { a } = await arcLoadFull(db, ctx, id, "DELETE");
    const reason = str(b.reason, "Alasan penghapusan", archiveRules.longReasonMax), reference = str(b.reference, "Rujukan pengajuan", archiveRules.reasonMax), at = now();
    const pending = await one(db, "SELECT id FROM archive_delete_requests WHERE archive_id=? AND status='PENDING'", a.id);
    if (pending) await run(db, "UPDATE archive_delete_requests SET status='APPROVED',decided_by=?,decided_at=?,decision_reason=?,updated_at=?,row_version=row_version+1 WHERE id=?", ctx.user.id, at, reason, at, pending.id);
    await arcSoftDelete(db, ctx, a, reason, {
      reference,
      request_id: pending?.id || null
    });
    return {
      ok: true
    };
  });
}
async function arcDeletedList(db, ctx) {
  arcHumas(db, ctx, "DELETED_LIST");
  const rows = await all(db, "SELECT a.*,u.name AS unit_name FROM archive_records a JOIN org_units u ON u.id=a.owner_unit_id WHERE a.deleted_at IS NOT NULL ORDER BY a.deleted_at DESC,a.id LIMIT 300");
  const names = await arcUserNames(db, rows.map((r) => r.deleted_by));
  return {
    items: rows.map((r) => ({
      ...arcFull({
        ...r,
        is_full: 1
      }),
      deleted_at: r.deleted_at,
      deleted_by: names.get(r.deleted_by) || "\u2014",
      delete_reason: r.delete_reason
    }))
  };
}
async function arcRestore(db, ctx, id, b) {
  return await tx(db, async () => {
    arcHumas(db, ctx, "RESTORE", id);
    const a = await one(db, "SELECT * FROM archive_records WHERE id=?", idOf(id, "Arsip"));
    assert(a && a.deleted_at, "Arsip yang dihapus tidak ditemukan.", 404);
    const reason = str(b.reason, "Alasan pemulihan", archiveRules.longReasonMax), at = now();
    await run(db, "UPDATE archive_records SET deleted_at=NULL,deleted_by=NULL,delete_reason=NULL,updated_at=?,updated_by=?,row_version=row_version+1 WHERE id=? AND deleted_at IS NOT NULL", at, ctx.user.id, a.id);
    await arcAudit(db, ctx, "ARCHIVE_RESTORED", {
      archive_id: a.id,
      reason,
      context: {
        deleted_at: a.deleted_at,
        previous_reason: a.delete_reason
      }
    });
    return {
      ok: true,
      id: a.id,
      agenda_number: a.agenda_number,
      classification: a.classification
    };
  });
}
async function arcHistory(db, ctx, id) {
  const { a, access } = await arcLoadFull(db, ctx, id, "HISTORY");
  if (!ctx.humas && !access.edit) throw denied(db, ctx.user, "HISTORY", a.id, "Riwayat arsip hanya untuk petugas arsip bagian pemilik dan Humas.");
  const actions = ctx.humas ? ["DETAIL_OPENED", "PREVIEW_OPENED"] : archiveContentActions, params = [a.id];
  const visible = `action ${ctx.humas ? "NOT IN" : "IN"} ${placeholders(actions, params)}`;
  const rows = await all(db, `SELECT * FROM archive_audit_events WHERE archive_id=? AND outcome='SUCCESS' AND ${visible} ORDER BY occurred_at DESC,id LIMIT 300`, ...params);
  const names = await arcUserNames(db, rows.map((r) => r.actor_user_id));
  return {
    items: rows.map((r) => ({
      id: r.id,
      occurred_at: r.occurred_at,
      action: r.action,
      actor: names.get(r.actor_user_id) || "Sistem",
      reason: r.reason,
      before: parse(r.before_data, null),
      after: parse(r.after_data, null),
      context: ctx.humas ? parse(r.safe_context, {}) : void 0
    }))
  };
}
async function arcTypeSave(db, ctx, id, b) {
  return await tx(db, async () => {
    arcHumas(db, ctx, "TYPE_MANAGE");
    const at = now();
    if (!id) {
      const code = str(b.code, "Kode jenis", 20).toUpperCase();
      assert(/^[A-Z0-9_-]{1,20}$/.test(code), "Kode jenis hanya huruf, angka, garis bawah, atau tanda hubung.");
      const name = str(b.name, "Nama jenis", 80), normalized = archiveNormalName(name);
      assert(!await one(db, "SELECT 1 AS ok FROM archive_document_types WHERE code=? OR name_normalized=?", code, normalized), "Kode atau nama jenis dokumen sudah ada.", 409);
      const type = await insert(db, "archive_document_types", {
        code,
        name,
        name_normalized: normalized,
        is_active: 1,
        created_by: ctx.user.id,
        updated_by: ctx.user.id
      });
      await arcAudit(db, ctx, "TYPE_CREATED", {
        after: {
          code,
          name
        },
        context: {
          type_id: type.id
        }
      });
      await audit(db, ctx.user, "ARCHIVE_TYPE_CREATED", "archive_document_types", type.id, {
        code,
        name
      });
    } else {
      const type = await arcType(db, id, {
        mustBeActive: false
      }), name = b.name === void 0 ? type.name : str(b.name, "Nama jenis", 80), active = b.is_active === void 0 ? Number(type.is_active) : b.is_active ? 1 : 0, normalized = archiveNormalName(name);
      assert(b.code === void 0 || String(b.code).toUpperCase() === type.code, "Kode jenis tidak dapat diubah.");
      assert(!await one(db, "SELECT 1 AS ok FROM archive_document_types WHERE name_normalized=? AND id<>?", normalized, type.id), "Nama jenis dokumen sudah dipakai.", 409);
      assert(Number.isInteger(b.expected_row_version), "Versi data wajib dikirim. Muat ulang data.", 409);
      const changed = await run(db, "UPDATE archive_document_types SET name=?,name_normalized=?,is_active=?,updated_by=?,updated_at=?,row_version=row_version+1 WHERE id=? AND row_version=?", name, normalized, active, ctx.user.id, at, type.id, b.expected_row_version);
      assert(changed.changes === 1, "Data sudah berubah. Muat ulang sebelum menyimpan.", 409);
      await arcAudit(db, ctx, "TYPE_UPDATED", {
        before: {
          name: type.name,
          active: Number(type.is_active) === 1
        },
        after: {
          name,
          active: active === 1
        },
        context: {
          type_id: type.id
        }
      });
      await audit(db, ctx.user, "ARCHIVE_TYPE_UPDATED", "archive_document_types", type.id, {
        name,
        active: active === 1
      });
    }
    return {
      types: await arcTypes(db)
    };
  });
}
function arcAdmin(db, ctx, action) {
  if (!ctx.admin) throw denied(db, ctx.user, action, null, "Tindakan ini hanya untuk administrator portal.");
}
async function arcOfficers(db, ctx) {
  arcAdmin(db, ctx, "OFFICER_LIST");
  const evaluatedAt = now();
  const rows = await all(db, "SELECT * FROM archive_officers ORDER BY revoked_at IS NOT NULL,assigned_at DESC,id LIMIT 500"), names = await arcUserNames(db, rows.flatMap((r) => [r.user_id, r.assigned_by, r.revoked_by])), codes = await arcUnitCodes(db);
  const used = new Set((await all(db, "SELECT DISTINCT owner_unit_id FROM archive_records")).map((r) => r.owner_unit_id));
  return {
    officers: await asyncMap(rows, async (r) => {
      const user = await one(db, "SELECT id,employee_id,status FROM users WHERE id=?", r.user_id), member = user ? (await arcMemberUnits(db, ctx.tree, user.employee_id)).has(r.org_unit_id) : false;
      const timeOk = r.valid_from <= evaluatedAt && (!r.expires_at || r.expires_at > evaluatedAt);
      return {
        id: r.id,
        user: {
          id: r.user_id,
          name: names.get(r.user_id) || "\u2014"
        },
        unit: {
          id: r.org_unit_id,
          name: ctx.tree.byId.get(r.org_unit_id)?.name || "\u2014"
        },
        valid_from: r.valid_from,
        expires_at: r.expires_at,
        assigned_at: r.assigned_at,
        assigned_by: names.get(r.assigned_by) || "\u2014",
        reason: r.reason,
        revoked_at: r.revoked_at,
        revoked_by: r.revoked_by ? names.get(r.revoked_by) || "\u2014" : null,
        revoke_reason: r.revoke_reason,
        status: r.revoked_at ? "DICABUT" : !timeOk ? "KEDALUWARSA" : user?.status !== "ACTIVE" || !member ? "TIDAK_BERLAKU" : "AKTIF"
      };
    }),
    units: ctx.tree.rows.filter((u) => u.is_active !== 0).map((u) => ({
      id: u.id,
      name: u.name,
      code: u.code,
      agenda_code: codes.get(u.id) || null,
      suggested_code: archiveSuggestCode(u.code),
      code_locked: used.has(u.id)
    }))
  };
}
async function arcAssign(db, ctx, b) {
  return await tx(db, async () => {
    arcAdmin(db, ctx, "OFFICER_ASSIGN");
    const unit = ctx.tree.byId.get(idOf(b.org_unit_id, "Bagian"));
    assert(unit && unit.is_active !== 0, "Bagian tidak ditemukan atau tidak aktif.", 422);
    const target = await arcActiveUser(db, b.user_id), reason = str(b.reason, "Dasar penunjukan", archiveRules.reasonMax), at = now();
    assert(target.employee_id && (await arcMemberUnits(db, ctx.tree, target.employee_id)).has(unit.id), "Petugas harus pegawai aktif yang ditempatkan pada bagian tersebut.", 422);
    let expires = null;
    if (b.expires_at) {
      assert(typeof b.expires_at === "string" && !Number.isNaN(Date.parse(b.expires_at)), "Batas waktu penunjukan tidak valid.");
      expires = new Date(b.expires_at).toISOString();
      assert(expires > at, "Batas waktu penunjukan harus setelah waktu sekarang.");
    }
    const existing = await one(db, "SELECT agenda_code FROM archive_units WHERE org_unit_id=?", unit.id);
    if (!existing) {
      const code = String(b.agenda_code || "").trim().toUpperCase();
      assert(archiveAgendaCode(code), "Kode agenda bagian wajib diisi: 2\u201312 huruf kapital atau angka, misalnya HMS.");
      assert(!await one(db, "SELECT 1 AS ok FROM archive_units WHERE agenda_code=?", code), "Kode agenda sudah dipakai bagian lain.", 409);
      await insert(db, "archive_units", {
        org_unit_id: unit.id,
        agenda_code: code,
        created_by: ctx.user.id
      });
    }
    const open = await one(db, "SELECT id FROM archive_officers WHERE user_id=? AND org_unit_id=? AND revoked_at IS NULL", target.id, unit.id);
    if (open) await run(db, "UPDATE archive_officers SET revoked_at=?,revoked_by=?,revoke_reason='Diganti penunjukan baru',updated_at=?,row_version=row_version+1 WHERE id=?", at, ctx.user.id, at, open.id);
    const officer = await insert(db, "archive_officers", {
      user_id: target.id,
      org_unit_id: unit.id,
      valid_from: at,
      expires_at: expires,
      assigned_by: ctx.user.id,
      assigned_at: at,
      reason
    });
    await arcAudit(db, ctx, "OFFICER_ASSIGNED", {
      reason,
      context: {
        officer_id: officer.id,
        user_id: target.id,
        org_unit_id: unit.id,
        expires_at: expires,
        renewed: Boolean(open)
      }
    });
    await audit(db, ctx.user, "ARCHIVE_OFFICER_ASSIGNED", "archive_officers", officer.id, {
      user_id: target.id,
      org_unit_id: unit.id
    }, reason);
    return await arcOfficers(db, ctx);
  });
}
async function arcUnassign(db, ctx, officerId, b) {
  return await tx(db, async () => {
    arcAdmin(db, ctx, "OFFICER_REVOKE");
    const officer = await one(db, "SELECT * FROM archive_officers WHERE id=?", idOf(officerId, "Penunjukan"));
    assert(officer && !officer.revoked_at, "Penunjukan tidak ditemukan atau sudah dicabut.", 409);
    const reason = str(b.reason, "Alasan pencabutan", archiveRules.reasonMax), at = now();
    await run(db, "UPDATE archive_officers SET revoked_at=?,revoked_by=?,revoke_reason=?,updated_at=?,row_version=row_version+1 WHERE id=? AND revoked_at IS NULL", at, ctx.user.id, reason, at, officer.id);
    await arcAudit(db, ctx, "OFFICER_REVOKED", {
      reason,
      context: {
        officer_id: officer.id,
        user_id: officer.user_id,
        org_unit_id: officer.org_unit_id
      }
    });
    await audit(db, ctx.user, "ARCHIVE_OFFICER_REVOKED", "archive_officers", officer.id, {
      user_id: officer.user_id,
      org_unit_id: officer.org_unit_id
    }, reason);
    return await arcOfficers(db, ctx);
  });
}
async function arcSetUnitCode(db, ctx, b) {
  return await tx(db, async () => {
    arcAdmin(db, ctx, "UNIT_CODE");
    const unit = ctx.tree.byId.get(idOf(b.org_unit_id, "Bagian"));
    assert(unit, "Bagian tidak ditemukan.", 422);
    const code = String(b.agenda_code || "").trim().toUpperCase();
    assert(archiveAgendaCode(code), "Kode agenda: 2\u201312 huruf kapital atau angka, misalnya HMS.");
    assert(!await one(db, "SELECT 1 AS ok FROM archive_records WHERE owner_unit_id=? LIMIT 1", unit.id), "Kode agenda tidak dapat diubah setelah dipakai nomor agenda.", 409);
    assert(!await one(db, "SELECT 1 AS ok FROM archive_units WHERE agenda_code=? AND org_unit_id<>?", code, unit.id), "Kode agenda sudah dipakai bagian lain.", 409);
    const existing = await one(db, "SELECT id,agenda_code FROM archive_units WHERE org_unit_id=?", unit.id), at = now();
    if (existing) await run(db, "UPDATE archive_units SET agenda_code=?,updated_at=?,row_version=row_version+1 WHERE id=?", code, at, existing.id);
    else await insert(db, "archive_units", {
      org_unit_id: unit.id,
      agenda_code: code,
      created_by: ctx.user.id
    });
    await arcAudit(db, ctx, "UNIT_CODE_SET", {
      before: existing ? {
        agenda_code: existing.agenda_code
      } : null,
      after: {
        agenda_code: code
      },
      context: {
        org_unit_id: unit.id
      }
    });
    return await arcOfficers(db, ctx);
  });
}
async function arcLookup(db, ctx, query) {
  if (!ctx.humas && !ctx.admin) throw denied(db, ctx.user, "LOOKUP", null);
  const kind = query.get("kind");
  if (kind === "unit-members") return {
    users: (await arcUnitMembers(db, ctx.tree, idOf(query.get("unit"), "Bagian"))).map((m) => ({
      id: m.id,
      name: m.full_name,
      note: [m.position_name, ctx.tree.byId.get(m.org_unit_id)?.name].filter(Boolean).join(" \xB7 ")
    }))
  };
  if (kind === "units") return {
    units: ctx.tree.rows.filter((u) => u.is_active !== 0).map((u) => ({
      id: u.id,
      name: u.name
    }))
  };
  assert(kind === "users", "Jenis pencarian tidak valid.");
  const q = archiveNormalName(query.get("q") || "");
  assert(q.length >= 2 && q.length <= 60, "Ketik minimal 2 huruf nama atau username.");
  const day = today();
  const rows = await all(db, `SELECT u.id,u.username,e.full_name,(SELECT p.name FROM employee_placements ep JOIN positions p ON p.id=ep.position_id WHERE ep.employee_id=e.id AND ep.is_primary=1 AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?) LIMIT 1) AS position_name
  FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.status='ACTIVE' AND (u.employee_id IS NULL OR e.is_active=1) AND (lower(u.username) LIKE ? ESCAPE '\\' OR lower(coalesce(e.full_name,'')) LIKE ? ESCAPE '\\') ORDER BY coalesce(e.full_name,u.username),u.id LIMIT 20`, day, day, archiveLike(q), archiveLike(q));
  return {
    users: rows.map((r) => ({
      id: r.id,
      name: r.full_name || r.username,
      note: [r.position_name, r.username].filter(Boolean).join(" \xB7 ")
    }))
  };
}
var reportTitles = {
  recap_period: "Rekap Arsip per Periode",
  recap_unit: "Rekap Arsip per Bagian",
  recap_type: "Rekap Arsip per Jenis Dokumen",
  agenda_in: "Buku Agenda Surat Masuk",
  agenda_out: "Buku Agenda Surat Keluar"
};
async function arcReport(db, ctx, b) {
  const type = b.type;
  assert(archiveReportTypes.includes(type), "Jenis laporan tidak valid.");
  assert(["xlsx", "pdf"].includes(b.format), "Format laporan tidak valid.");
  assert(archiveValidDay(b.from) && archiveValidDay(b.to) && b.from <= b.to, "Periode laporan tidak valid.");
  const query = new URLSearchParams({
    from: b.from,
    to: b.to
  }), notes = [];
  if (b.unit_id) query.set("unit", b.unit_id);
  if (type === "agenda_in") query.set("direction", "MASUK");
  if (type === "agenda_out") query.set("direction", "KELUAR");
  if (b.document_type_id && ["recap_type", "recap_period"].includes(type)) query.set("type", b.document_type_id);
  const selectParams = [], filterParams = [], filters = arcFilters(ctx, query, filterParams);
  const rows = await all(db, `SELECT a.*,u.name AS unit_name,CASE WHEN ${fullSql(ctx, selectParams)} THEN 1 ELSE 0 END AS is_full FROM archive_records a JOIN org_units u ON u.id=a.owner_unit_id
  WHERE ${filters.where.join(" AND ")} ORDER BY a.archived_at ASC,a.id ASC LIMIT ${archiveRules.reportMaxRows + 1}`, ...selectParams, ...filterParams);
  assert(rows.length <= archiveRules.reportMaxRows, `Laporan melebihi ${archiveRules.reportMaxRows} baris. Persempit periode laporan.`);
  const items = rows.map(arcProject), restricted = items.filter((i) => i.restricted).length, groups = [];
  const count = (key, label) => {
    const map = /* @__PURE__ */ new Map();
    for (const i of items.filter((x) => !x.restricted)) {
      const k = key(i);
      map.set(k, (map.get(k) || 0) + 1);
    }
    for (const [name, total] of [...map].sort((x, y) => String(x[0]).localeCompare(String(y[0])))) groups.push({
      label: `${label}: ${name}`,
      count: total
    });
  };
  if (type === "recap_unit") {
    const map = /* @__PURE__ */ new Map();
    for (const r of rows) map.set(r.unit_name, (map.get(r.unit_name) || 0) + 1);
    for (const [name, total] of [...map].sort((x, y) => x[0].localeCompare(y[0]))) groups.push({
      label: `Bagian: ${name}`,
      count: total
    });
  }
  if (type === "recap_type") {
    count((i) => i.document_type, "Jenis");
    if (restricted) groups.push({
      label: "Rahasia dengan informasi terbatas (jenis tidak ditampilkan)",
      count: restricted
    });
  }
  if (type === "recap_period") count((i) => directionLabel[i.direction], "Arah");
  if (type === "recap_period" && restricted) groups.push({
    label: "Rahasia dengan informasi terbatas",
    count: restricted
  });
  if (["agenda_in", "agenda_out"].includes(type)) notes.push("Laporan ini hanya memuat arsip dengan arah surat yang boleh Anda ketahui.");
  if (filters.hidden && !["agenda_in", "agenda_out"].includes(type)) notes.push("Saringan jenis hanya diterapkan pada arsip yang dapat Anda baca.");
  if (restricted) notes.push("Arsip Rahasia tanpa izin baca hanya menampilkan nomor agenda, tanggal pengarsipan, dan label Rahasia.");
  const unitName = b.unit_id ? ctx.tree.byId.get(b.unit_id)?.name || "\u2014" : "Semua bagian dalam kewenangan", typeName = query.get("type") ? (await arcTypes(db)).find((t) => t.id === query.get("type"))?.name || "\u2014" : null;
  const requester = (await arcUserNames(db, [ctx.user.id])).get(ctx.user.id) || ctx.user.username;
  await arcAudit(db, ctx, "REPORT_EXPORTED", {
    context: {
      type,
      format: b.format,
      from: b.from,
      to: b.to,
      unit_id: b.unit_id || null,
      document_type_id: query.get("type") || null,
      rows: items.length
    }
  });
  return {
    type,
    title: reportTitles[type],
    format: b.format,
    period: {
      from: b.from,
      to: b.to
    },
    generated_at: now(),
    requested_by: requester,
    filters: [`Periode pengarsipan: ${b.from} s.d. ${b.to}`, `Bagian: ${unitName}`, ...typeName ? [`Jenis dokumen: ${typeName}`] : []],
    notes,
    groups,
    total: items.length,
    rows: items.map((i) => i.restricted ? {
      agenda_number: i.agenda_number,
      archived_on: archiveWitaDate(Date.parse(i.archived_at)),
      classification: "Rahasia",
      restricted: true
    } : {
      agenda_number: i.agenda_number,
      archived_on: archiveWitaDate(Date.parse(i.archived_at)),
      letter_date: i.letter_date,
      direction: directionLabel[i.direction],
      document_type: i.document_type,
      official_number: i.official_number || "",
      subject: i.subject,
      unit: i.unit.name,
      classification: i.classification === "RAHASIA" ? "Rahasia" : "Biasa",
      restricted: false
    })
  };
}
async function arcHumasUsers(db) {
  return (await all(db, `SELECT DISTINCT u.id ${HOLD_SQL} JOIN users u ON u.id=ur.user_id LEFT JOIN employees e ON e.id=u.employee_id WHERE p.code=? AND u.status='ACTIVE' AND (u.employee_id IS NULL OR e.is_active=1)`, HUMAS)).map((r) => r.id);
}
async function archiveEnsureDailySummaries(db, nowMs = Date.now()) {
  const todayWita = archiveWitaDate(nowMs), lastDay = archiveShiftDay(todayWita, archiveWitaHour(nowMs) >= archiveRules.digestHour ? -1 : -2);
  const latest = (await one(db, "SELECT max(summary_date) AS day FROM archive_daily_summary_runs"))?.day || null;
  if (latest && latest >= lastDay) return 0;
  let first = latest ? archiveShiftDay(latest, 1) : lastDay;
  const earliest = archiveShiftDay(lastDay, -(archiveRules.summaryBackfillDays - 1));
  if (first < earliest) first = earliest;
  const tree = await arcTree(db), recipients = await arcHumasUsers(db);
  let created = 0;
  for (let day = first; day <= lastDay; day = archiveShiftDay(day, 1)) {
    const start = archiveDayStart(day), end = archiveDayEnd(day), at = now(), runId = uid();
    const counts = (await all(db, "SELECT owner_unit_id,count(*) n FROM archive_records WHERE archived_at>=? AND archived_at<? GROUP BY owner_unit_id", start, end)).map((r) => ({
      unit_id: r.owner_unit_id,
      unit: tree.byId.get(r.owner_unit_id)?.name || "\u2014",
      count: Number(r.n)
    })).sort((x, y) => x.unit.localeCompare(y.unit));
    const total = counts.reduce((n, c) => n + c.count, 0);
    const inserted = await run(db, `INSERT INTO archive_daily_summary_runs(id,summary_date,timezone,period_start,period_end,counts_by_unit,total,status,prepared_at,created_at,updated_at,row_version) VALUES(?,?,?,?,?,?,?,'PREPARED',?,?,?,1) ON CONFLICT(summary_date) DO NOTHING`, runId, day, archiveRules.timezone, start, end, JSON.stringify(counts), total, at, at, at);
    if (inserted.changes !== 1) continue;
    const payload = JSON.stringify({
      total,
      units: counts.map((c) => ({
        unit: c.unit,
        count: c.count
      }))
    });
    for (const recipient of recipients) await run(db, `INSERT INTO archive_notifications(id,event_id,notification_type,recipient_user_id,summary_date,payload_minimal,created_at,updated_at,row_version) VALUES(?,?,'HUMAS_DAILY_SUMMARY',?,?,?,?,?,1) ON CONFLICT DO NOTHING`, uid(), runId, recipient, day, payload, at, at);
    await run(db, "UPDATE archive_daily_summary_runs SET status='COMPLETED',completed_at=?,updated_at=?,row_version=row_version+1 WHERE id=?", at, at, runId);
    created++;
  }
  return created;
}
async function arcNotifications(db, ctx) {
  if (ctx.humas) await archiveEnsureDailySummaries(db);
  const rows = await all(db, "SELECT * FROM archive_notifications WHERE recipient_user_id=? ORDER BY created_at DESC,id LIMIT 40", ctx.user.id);
  return {
    unread: await arcUnread(db, ctx.user.id),
    items: await asyncMap(rows, async (n) => {
      const base = {
        id: n.id,
        type: n.notification_type,
        created_at: n.created_at,
        read: Boolean(n.read_at)
      };
      if (n.notification_type === "HUMAS_DAILY_SUMMARY") {
        const payload = ctx.humas ? parse(n.payload_minimal, {}) : {};
        return {
          ...base,
          summary_date: n.summary_date,
          total: ctx.humas ? Number(payload.total || 0) : null,
          units: ctx.humas ? payload.units || [] : []
        };
      }
      const a = await one(db, "SELECT a.*,u.name AS unit_name FROM archive_records a JOIN org_units u ON u.id=a.owner_unit_id WHERE a.id=?", n.archive_id), access = a ? await arcAccess(db, ctx, a) : null;
      if (!a || !access.list) return {
        ...base,
        available: false
      };
      return {
        ...base,
        available: true,
        archive: access.read ? {
          id: a.id,
          agenda_number: a.agenda_number,
          subject: a.subject,
          unit: a.unit_name
        } : {
          id: a.id,
          agenda_number: a.agenda_number
        }
      };
    })
  };
}
async function arcReadNotifications(db, ctx, b) {
  const at = now();
  if (b.all === true) await run(db, "UPDATE archive_notifications SET read_at=?,updated_at=?,row_version=row_version+1 WHERE recipient_user_id=? AND read_at IS NULL", at, at, ctx.user.id);
  else {
    assert(Array.isArray(b.ids) && b.ids.length > 0 && b.ids.length <= 100 && b.ids.every((x) => typeof x === "string"), "Daftar notifikasi tidak valid.");
    for (const id of b.ids) await run(db, "UPDATE archive_notifications SET read_at=?,updated_at=?,row_version=row_version+1 WHERE id=? AND recipient_user_id=? AND read_at IS NULL", at, at, id, ctx.user.id);
  }
  return {
    unread: await arcUnread(db, ctx.user.id)
  };
}
async function archiveRoutes({ db, user, p, method, body, url }, deps = {}) {
  if (p[0] !== "archives") return void 0;
  if (!await archiveSchemaReady(db)) return void 0;
  const ctx = await arcActor(db, user), b = body || {}, query = url.searchParams;
  const GET = method === "GET", POST = method === "POST", PATCH = method === "PATCH";
  if (p.length === 1 && GET) return await arcList(db, ctx, query);
  if (p.length === 1 && POST) return await arcCreate(db, ctx, deps, b);
  if (p.length === 2) {
    if (p[1] === "overview" && GET) return await arcOverview(db, ctx);
    if (p[1] === "dashboard" && GET) return await arcDashboard(db, ctx);
    if (p[1] === "types" && GET) return {
      types: await arcTypes(db)
    };
    if (p[1] === "types" && POST) return await arcTypeSave(db, ctx, null, b);
    if (p[1] === "officers" && GET) return await arcOfficers(db, ctx);
    if (p[1] === "officers" && POST) return await arcAssign(db, ctx, b);
    if (p[1] === "units" && POST) return await arcSetUnitCode(db, ctx, b);
    if (p[1] === "lookups" && GET) return await arcLookup(db, ctx, query);
    if (p[1] === "reports" && POST) return await arcReport(db, ctx, b);
    if (p[1] === "notifications" && GET) return await arcNotifications(db, ctx);
    if (p[1] === "delete-requests" && GET) return await arcDeleteRequests(db, ctx, query);
    if (p[1] === "deleted" && GET) return await arcDeletedList(db, ctx);
  }
  if (p[1] === "types" && p.length === 3 && PATCH) return await arcTypeSave(db, ctx, p[2], b);
  if (p[1] === "officers" && p.length === 4 && p[3] === "revoke" && POST) return await arcUnassign(db, ctx, p[2], b);
  if (p[1] === "notifications" && p.length === 3 && p[2] === "read" && POST) return await arcReadNotifications(db, ctx, b);
  if (p[1] === "delete-requests" && p.length === 4 && POST) {
    if (p[3] === "decide") return await arcDecideDelete(db, ctx, p[2], b);
    if (p[3] === "cancel") return await arcCancelDelete(db, ctx, p[2]);
  }
  if (p[1] === "deleted" && p.length === 4 && p[3] === "restore" && POST) return await arcRestore(db, ctx, p[2], b);
  if (["overview", "dashboard", "types", "officers", "units", "lookups", "reports", "notifications", "delete-requests", "deleted"].includes(p[1])) return void 0;
  const id = p[1];
  if (p.length === 2 && GET) {
    const loaded = await arcLoad(db, ctx, id);
    if (loaded.access.read) await arcAudit(db, ctx, "DETAIL_OPENED", {
      archive_id: loaded.a.id
    });
    return await arcDetail(db, ctx, loaded.a, loaded.access);
  }
  if (p.length === 2 && PATCH) return await arcEdit(db, ctx, id, b);
  if (p.length === 3) {
    if (p[2] === "history" && GET) return await arcHistory(db, ctx, id);
    if (p[2] === "access" && GET) return await arcAccessPanel(db, ctx, id);
    if (p[2] === "classification" && POST) return await arcClassify(db, ctx, id, b);
    if (p[2] === "grants" && POST) return await arcGrant(db, ctx, id, b);
    if (p[2] === "delete-requests" && POST) return await arcRequestDelete(db, ctx, id, b);
    if (p[2] === "delete" && POST) return await arcDeleteDirect(db, ctx, id, b);
    if (p[2] === "documents" && POST) return await arcAddAttachment(db, ctx, deps, id, b);
  }
  if (p.length === 5 && p[2] === "grants" && p[4] === "revoke" && POST) return await arcRevoke(db, ctx, id, p[3], b);
  if (p.length === 5 && p[2] === "documents" && POST) {
    if (p[4] === "versions") return await arcReplaceFile(db, ctx, deps, id, p[3], b);
    if (p[4] === "remove") return await arcRemoveAttachment(db, ctx, id, p[3], b);
  }
  if (p.length === 7 && p[2] === "documents" && p[4] === "versions" && ["preview", "download"].includes(p[6]) && GET) {
    const download = p[6] === "download", { a, access } = await arcLoadFull(db, ctx, id, download ? "DOWNLOAD" : "PREVIEW");
    if (download && !access.download) throw denied(db, ctx.user, "DOWNLOAD", a.id, "Unduh memerlukan izin Humas. Hubungi Humas secara langsung.");
    const v = await arcVersionOf(db, a, p[3], p[5]);
    assert(typeof deps.readFile === "function", "Penyimpanan berkas belum dikonfigurasi.", 503);
    let bytes;
    try {
      bytes = await deps.readFile(v.storage_key);
    } catch (error) {
      if (error?.status && error.status !== 404) throw error;
      bytes = null;
    }
    assert(bytes && bytes.length === Number(v.byte_size), "Layanan berkas sedang terganggu atau berkas belum dapat diverifikasi. Coba lagi nanti.", 503);
    await arcAudit(db, ctx, download ? "DOWNLOAD_STARTED" : "PREVIEW_OPENED", {
      archive_id: a.id,
      document_id: p[3],
      version_id: v.id
    });
    return {
      mime: v.detected_mime,
      size: Number(v.byte_size),
      data: Buffer.from(bytes).toString("base64"),
      ...download ? {
        filename: v.original_filename
      } : {}
    };
  }
  return void 0;
}
  return { archiveFileLinked: archiveFileLinked, archiveRoutes: archiveRoutes, archiveUploadAllowed: archiveUploadAllowed };
})();
// Rute arsip yang tidak dikenal dijawab 404, sama seperti alamat API lain.
function archiveFound(result) {
  if (result === void 0) throw new AppError(404, "Alamat API tidak ditemukan.");
  return result;
}
// Galat dari modul E-Arsip memakai kelas AppError salinannya sendiri; diubah ke
// AppError snapshot supaya status 403/404/409/413/422 tidak berubah menjadi 503.
function adoptArchiveError(error) {
  if (!(error instanceof AppError) && error instanceof Error && Number.isInteger(error.status) && error.status >= 400 && error.status < 600) throw new AppError(error.status, error.message, error.details);
  throw error;
}
async function routeOperation({ db, user, path, method, body = {}, query = "" }) {
  assert(typeof path === "string" && /^[a-z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(path) && path.length <= 512, "Alamat API tidak valid.", 404);
  assert(["GET", "POST", "PATCH", "DELETE"].includes(method), "Metode tidak diizinkan.", 405);
  const p = path.split("/");
  const url = new URL(`https://portal.invalid/?${query}`);
  if (path === "portal/me" && method === "GET") return { user: safeUser(user), name: user.employee_id ? (await get(db, "employees", user.employee_id)).full_name : user.username, permissions: [...new Set((await grants(db, user)).map((g) => g.code))], announcements_manage: await announcementsManager(db, user), purchasing_pending: await purchasingPendingCount(db, user), demo: false };
  assert(!user.must_change_password, "Anda wajib mengganti password sementara terlebih dahulu.", 428);
  await guardLeaveRoleChanges({ db, user, p, method, body }, assert);
  if (p[0] === "leaves") return leaveRoutes({ db, user, p, method, body, url }, { assert, can, has, audit, today });
  if (p[0] === "visits") return __visits.visitRoutes({ db, user, p, method, body, url }, { has, audit }).catch(adoptVisitError);
  if (p[0] === "attendance") return __attendance.attendanceRoutes({ db, user, p, method, body, url }, { has, can, audit, readPhoto: (key) => db.storage.get(key) }).catch(adoptAttendanceError);
  if (p[0] === "archives") return __archives.archiveRoutes({ db, user, p, method, body, url }, { claimFile, readFile: (key) => db.storage.get(key, "arsip"), claimStorage: (key) => db.storage.claim(key) }).then(archiveFound, adoptArchiveError);
  if (path === "dashboard" && method === "GET") return dashboard(db, user, url.searchParams.get("module") || "hr", url.searchParams.get("as_of") || void 0);
  if (path === "lookups" && method === "GET") return lookups(db, user, url.searchParams.get("purpose") || "employees", url.searchParams.get("session_id"));
  if (p[0] === "exports" && method === "GET") {
    const cell = (v) => '"' + String(v ?? "").replace(/^[=+\-@\t\r]/, "'$&").replaceAll('"', '""') + '"';
    let rows, filename;
    if (p[1] === "employees") {
      assert(await has(db, user, "hr.employees.export"), "Akses ekspor ditolak.", 403);
      rows = [["Nomor pegawai", "Nama", "Unit", "Posisi", "Status", "Tanggal mulai", "Aktif"]];
      for (const e of await employees(db)) if (await can(db, user, "hr.employees.read", e) && await can(db, user, "hr.employees.export", e)) rows.push([e.employee_no, e.full_name, e.unit_name, e.position_name, e.employment_status, e.joined_on, e.is_active ? "Ya" : "Tidak"]);
      filename = "pegawai-besakih.csv";
    } else if (p[1] === "revisions" && p[2]) {
      assert(await has(db, user, "security.roster.export"), "Akses ekspor ditolak.", 403);
      const revision = await rosterRoutes({ db, user, p: ["revisions", p[2]], method: "GET", body: {}, url });
      rows = [["Tanggal tugas", "Nomor pegawai", "Nama", "Pos", "Shift", "Mulai UTC", "Selesai UTC", "Sumber"]];
      for (const a of revision.assignments) if (await can(db, user, "security.roster.export", { ...a, ...await postContext(db, a.post_id) })) rows.push([a.service_date, a.display.employee_no, a.display.employee_name, a.display.post_name, a.display.shift_name, a.starts_at, a.ends_at, a.origin]);
      filename = `jadwal-revisi-${revision.revision_no}.csv`;
    } else throw new AppError(404, "Jenis ekspor tidak ditemukan.");
    await audit(db, user, "EXPORT", p[1], p[2] || "list", { row_count: rows.length - 1 });
    return { filename, csv: rows.map((row) => row.map(cell).join(",")).join("\r\n") };
  }
  if (path === "uploads" && method === "POST") return await __archives.archiveUploadAllowed(db, user) ? storeUpload(db, user, body) : upload(db, user, body);
  if (path === "attachments" && method === "POST") return attach(db, user, body.type, body.owner_id, body);
  if (p[0] === "files" && p.length === 2 && method === "GET") {
    const { file, data } = await download(db, user, p[1]);
    assert(data.length === file.size_bytes && createHash4("sha256").update(data).digest("hex") === file.checksum, "Integritas berkas belum dapat diverifikasi.", 503);
    return { binary: true, data: Buffer3.from(data).toString("base64"), mime_type: file.mime_type, name: file.original_name, inline: url.searchParams.get("inline") === "1" && ["image/png", "image/jpeg"].includes(file.mime_type) };
  }
  const ctx = { db, user, p, method, body, url };
  for (const handler of [briefingRoutes, quickReportManagement, announcementRoutes, hrRoutes, securityRoutes, rosterRoutes, adminRoutes, purchasingRoutes, merchandiseRoutes]) {
    const result = await handler(ctx);
    if (result !== void 0) return result;
  }
  throw new AppError(404, "Alamat API tidak ditemukan.");
}
var uuid2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var hash = (value) => createHash5("sha256").update(value).digest("hex");
var pool;
function database(env) {
  if (!pool) {
    const url = new URL(env.SUPABASE_DB_URL);
    assert(["postgres:", "postgresql:"].includes(url.protocol), "Database belum dikonfigurasi.", 503);
    pool = postgres(env.SUPABASE_DB_URL, {
      prepare: false,
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {
      },
      types: { safeBigint: { to: 20, from: [20], serialize: String, parse: (value) => {
        const number = Number(value);
        assert(Number.isSafeInteger(number), "Nilai database di luar batas.", 503);
        return number;
      } } }
    });
  }
  return pool;
}
async function readBody(req) {
  assert(req.headers.get("content-type")?.toLowerCase().startsWith("application/json") && req.body, "Gunakan JSON.", 415);
  const reader = req.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 14 * 1024 * 1024 + 65536) {
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
  assert(b && typeof b === "object" && !Array.isArray(b), "Permintaan tidak valid.", 400);
  return b;
}
function adapter(sql, identity, storage, readOnly = false) {
  return { authorizationCache: readOnly ? /* @__PURE__ */ new Map() : void 0, inTransaction: true, query: (statement, values = []) => sql.unsafe(statement, values), identity, storage };
}
async function transaction(client, identity, storage, work, mutating = true) {
  return client.begin(async (sql) => {
    await sql.unsafe("SET LOCAL search_path=portal,pg_catalog; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='40s';");
    if (mutating) await sql.unsafe("SELECT pg_advisory_xact_lock(734829610160009)");
    return work(adapter(sql, identity, storage, !mutating));
  });
}
async function recover(client, identity, storage, b, requestId) {
  assert(typeof b.client_ip === "string" && b.client_ip.length <= 45 && /^[a-f0-9:.]+$/i.test(b.client_ip), "Permintaan tidak valid.", 400);
  const input = b.body;
  assert(typeof input?.token === "string" && /^[a-f0-9]{48}$/.test(input.token) && typeof input.new_password === "string" && input.new_password.length >= 6 && input.new_password.length <= 128, "Kredensial pemulihan atau password tidak valid.", 422);
  const allowed = await transaction(client, identity, storage, async (db) => {
    const slot = (await db.query("SELECT public.portal_take_login_slot($1,$2) result", [hash(`username\0recovery:${input.token}`), hash(`ip\0${b.client_ip}`)]))[0].result;
    return slot === true;
  });
  assert(allowed, "Terlalu banyak percobaan. Coba lagi 15 menit kemudian.", 429);
  const target = await transaction(client, identity, storage, async (db) => {
    const token = await one(db, "SELECT * FROM password_reset_tokens WHERE token_hash=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>? FOR UPDATE", hash(input.token), now());
    assert(token, "Kredensial pemulihan tidak valid atau kedaluwarsa.", 422);
    const user = await one(db, "SELECT * FROM users WHERE id=? AND status='ACTIVE'", token.user_id);
    assert(user, "Kredensial pemulihan tidak valid atau kedaluwarsa.", 422);
    await run(db, "UPDATE password_reset_tokens SET consumed_at=? WHERE id=?", now(), token.id);
    await run(db, "UPDATE public.app_users SET must_change_password=true,row_version=row_version+1 WHERE id=?", user.id);
    await audit(db, { id: user.id, request_id: requestId }, "RECOVERY_CONSUMED", "users", user.id);
    return user;
  });
  let updated;
  try {
    updated = await identity.setPassword(target.id, input.new_password);
  } catch {
    throw new AppError(503, "Hasil pemulihan belum dapat dikonfirmasi. Hubungi administrator untuk kredensial pemulihan baru.");
  }
  assert(updated?.id === target.id, "Hasil pemulihan belum dapat dikonfirmasi. Hubungi administrator.", 503);
  await transaction(client, identity, storage, async (db) => {
    await run(db, "UPDATE public.app_users SET must_change_password=false,row_version=row_version+1,password_changed_at=? WHERE id=?", now(), target.id);
    await audit(db, { id: target.id, request_id: requestId }, "PASSWORD_RECOVERED", "users", target.id);
  });
  return { ok: true };
}
var index_default = {
  fetch: withSupabase({ auth: "secret" }, async (req) => {
    const requestId = randomUUID5();
    let identity, storage, workCompleted = false;
    try {
      assert(req.method === "POST", "Metode tidak diizinkan.", 405);
      const b = await readBody(req), env = Deno.env.toObject();
      identity = createIdentity(env);
      storage = createDriveStorage(env, void 0, { module: b.action === "quick-report" ? "patroli" : driveModuleForOperation(b.path, b.body) });
      const client = database(env);
      if (b.action === "quick-report") {
        assert(["context", "submit"].includes(b.operation) && b.body && typeof b.body === "object" && !Array.isArray(b.body), "Permintaan tidak valid.", 400);
        const allowed = await transaction(client, identity, storage, (db) => takeQuickReportSlot(db, b.client_ip, b.operation));
        assert(allowed, "Terlalu banyak percobaan. Coba lagi beberapa menit kemudian.", 429);
        const result2 = await transaction(client, identity, storage, async (db) => {
          const result3 = await publicQuickReport(db, b.operation, b.body, void 0, requestId);
          await storage.finalize();
          workCompleted = true;
          return result3;
        });
        return Response.json({ ok: true, result: result2 }, { headers: { "Cache-Control": "no-store" } });
      }
      if (b.action === "health") {
        const ready = await transaction(client, identity, storage, async (db) => {
          const r = await one(db, "SELECT count(*)::integer total,count(*) FILTER(WHERE rowsecurity)::integer protected FROM pg_catalog.pg_tables WHERE schemaname='portal'");
          return r.total >= 65 && r.protected === r.total;
        }, false);
        assert(ready, "Modul portal belum siap.", 503);
        return Response.json({ ok: true, healthy: true, revision: "20261016.1" }, { headers: { "Cache-Control": "no-store" } });
      }
      if (b.action === "recover") return Response.json(await recover(client, identity, storage, b, requestId), { headers: { "Cache-Control": "no-store" } });
      assert(b.action === "operation" && typeof b.access_token === "string" && b.access_token.length <= 8192 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(b.access_token), "Sesi berakhir. Silakan masuk kembali.", 401);
      assert(typeof b.session_hash === "string" && /^[a-f0-9]{64}$/.test(b.session_hash) && typeof b.lease_hash === "string" && /^[a-f0-9]{64}$/.test(b.lease_hash), "Sesi berakhir. Silakan masuk kembali.", 401);
      assert(Number.isSafeInteger(b.session_version) && b.session_version > 0, "Sesi berakhir. Silakan masuk kembali.", 401);
      const verified = await identity.verify(b.access_token);
      assert(uuid2.test(verified?.id), "Sesi berakhir. Silakan masuk kembali.", 401);
      const claims = JSON.parse(atob(b.access_token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/")));
      assert(claims.sub === verified.id && uuid2.test(claims.session_id), "Sesi berakhir. Silakan masuk kembali.", 401);
      if (typeof b.path === "string" && __visits.isVisitSheetAction(b.path, b.method)) {
        const result = await visitsSheetRequest(client, identity, storage, b, Deno.env.toObject(), async (db) => {
        const user = await one(db, "SELECT * FROM users WHERE id=? AND status='ACTIVE'", verified.id);
        assert(user, "Akun tidak aktif.", 401);
        user.request_id = requestId;
        const session = await one(db, "SELECT id FROM portal_auth_private.web_sessions WHERE token_hash=? AND user_id=? AND auth_session_id=? AND revoked_at IS NULL AND expires_at>clock_timestamp() AND lease_hash=? AND lease_until>clock_timestamp() AND version=?", b.session_hash, user.id, claims.session_id, b.lease_hash, b.session_version);
        assert(session, "Sesi berakhir. Silakan masuk kembali.", 401);
        assert(!user.employee_id || (await one(db, "SELECT is_active FROM employees WHERE id=?", user.employee_id))?.is_active === 1, "Profil pegawai tidak aktif.", 401);
        assert(typeof b.query === "string" && b.query.length <= 2048 && b.body && typeof b.body === "object" && !Array.isArray(b.body), "Permintaan tidak valid.", 400);
          assert(!user.must_change_password, "Anda wajib mengganti password sementara terlebih dahulu.", 428);
          return user;
        });
        workCompleted = true;
        return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store", "X-SPH-Modules-Revision": "20261016.1" } });
      }
      const result = await transaction(client, identity, storage, async (db) => {
        const user = await one(db, "SELECT * FROM users WHERE id=? AND status='ACTIVE'", verified.id);
        assert(user, "Akun tidak aktif.", 401);
        user.request_id = requestId;
        const session = await one(db, "SELECT id FROM portal_auth_private.web_sessions WHERE token_hash=? AND user_id=? AND auth_session_id=? AND revoked_at IS NULL AND expires_at>clock_timestamp() AND lease_hash=? AND lease_until>clock_timestamp() AND version=?", b.session_hash, user.id, claims.session_id, b.lease_hash, b.session_version);
        assert(session, "Sesi berakhir. Silakan masuk kembali.", 401);
        assert(!user.employee_id || (await one(db, "SELECT is_active FROM employees WHERE id=?", user.employee_id))?.is_active === 1, "Profil pegawai tidak aktif.", 401);
        assert(typeof b.query === "string" && b.query.length <= 2048 && b.body && typeof b.body === "object" && !Array.isArray(b.body), "Permintaan tidak valid.", 400);
        const result2 = await routeOperation({ db, user, path: b.path, method: b.method, body: b.body, query: b.query });
        await storage.finalize();
        workCompleted = true;
        return result2;
      }, b.method !== "GET" || b.path?.startsWith("files/"));
      return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store", "X-SPH-Modules-Revision": "20261016.1" } });
    } catch (error) {
      if (!workCompleted) {
        await storage?.rollback();
        await identity?.rollback();
      }
      if (error instanceof AppError && error.details?.service === "google_drive") console.warn(JSON.stringify({ event: "storage_error", request_id: requestId, stage: error.details.stage, upstream_status: error.details.upstream_status, reason: error.details.reason }));
      const code = error?.code;
      const status = error instanceof AppError ? error.status : ["23505", "40001", "40P01", "55P03"].includes(code) ? 409 : ["23502", "23503", "23514", "22P02"].includes(code) ? 422 : 503;
      const message = error instanceof AppError ? error.message : status === 409 ? "Data atau proses sudah berubah. Muat ulang sebelum mencoba kembali." : status === 422 ? "Relasi atau nilai data tidak valid." : "Modul portal belum dapat diakses.";
      return Response.json({ ok: false, error: message, request_id: requestId }, { status, headers: { "Cache-Control": "no-store" } });
    }
  })
};
export {
  index_default as default
};
