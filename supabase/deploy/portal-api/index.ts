// supabase/functions/portal-api/index.ts
import { withSupabase } from "npm:@supabase/server@1";
import postgres from "npm:postgres@3.4.7";
import { createHash as createHash4, randomUUID as randomUUID5 } from "node:crypto";

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

// supabase/functions/_shared/portal/identity.mjs
import { randomUUID as randomUUID2 } from "node:crypto";
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

// supabase/functions/_shared/portal/drive.mjs
import { Buffer } from "node:buffer";
import { randomUUID as randomUUID3 } from "node:crypto";
function createDriveStorage(env, fetchImpl = globalThis.fetch.bind(globalThis)) {
  const folder = env.GOOGLE_DRIVE_FOLDER_ID;
  const created = [];
  let access;
  async function request(url, options = {}) {
    let r;
    try {
      r = await fetchImpl(url, { ...options, redirect: "manual", signal: AbortSignal.timeout(12e3) });
    } catch {
      throw new AppError(503, "Penyimpanan berkas belum dapat dihubungi.");
    }
    if (!r.ok) {
      await r.body?.cancel();
      throw new AppError(503, "Penyimpanan berkas belum dapat diakses.");
    }
    return r;
  }
  async function token() {
    if (access) return access;
    assert(folder && env.GOOGLE_DRIVE_CLIENT_ID && env.GOOGLE_DRIVE_CLIENT_SECRET && env.GOOGLE_DRIVE_REFRESH_TOKEN, "Penyimpanan berkas belum dikonfigurasi.", 503);
    const r = await request("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", client_id: env.GOOGLE_DRIVE_CLIENT_ID, client_secret: env.GOOGLE_DRIVE_CLIENT_SECRET, refresh_token: env.GOOGLE_DRIVE_REFRESH_TOKEN }) });
    const j = await r.json();
    assert(typeof j.access_token === "string" && j.access_token.length < 8192, "Penyimpanan berkas belum dapat diakses.", 503);
    access = j.access_token;
    return access;
  }
  const headers = async () => ({ Authorization: `Bearer ${await token()}` });
  const valid = (id) => assert(typeof id === "string" && /^[A-Za-z0-9_-]{8,200}$/.test(id), "Berkas tidak tersedia.", 404);
  return {
    async put(data, mime) {
      const boundary = `sph_${randomUUID3()}`;
      const metadata = { name: randomUUID3(), parents: [folder], appProperties: { sph_portal: "v1" } };
      const body = new Blob([`--${boundary}\r
Content-Type: application/json; charset=UTF-8\r
\r
${JSON.stringify(metadata)}\r
--${boundary}\r
Content-Type: ${mime}\r
\r
`, data, `\r
--${boundary}--`]);
      const r = await request("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { ...await headers(), "Content-Type": `multipart/related; boundary=${boundary}` }, body });
      const file = await r.json();
      valid(file.id);
      created.push(file.id);
      return file.id;
    },
    async get(id) {
      valid(id);
      const meta = await (await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,parents,trashed,appProperties`, { headers: await headers() })).json();
      assert(meta.id === id && !meta.trashed && meta.parents?.includes(folder) && meta.appProperties?.sph_portal === "v1", "Berkas tidak tersedia.", 404);
      const r = await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { headers: await headers() });
      const chunks = [];
      let size = 0;
      const reader = r.body.getReader();
      try {
        for (; ; ) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 10 * 1024 * 1024) {
            await reader.cancel();
            throw new AppError(503, "Berkas melebihi ukuran yang diizinkan.");
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      return Buffer.concat(chunks);
    },
    async rollback() {
      for (const id of created) {
        try {
          await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, { method: "DELETE", headers: await headers() });
        } catch {
        }
      }
    }
  };
}

// supabase/functions/_shared/portal/router.mjs
import { Buffer as Buffer3 } from "node:buffer";
import { createHash as createHash3 } from "node:crypto";

// supabase/functions/_shared/portal/arrays.mjs
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

// supabase/functions/_shared/portal/auth.mjs
import { createHash } from "node:crypto";
var digest = (value) => createHash("sha256").update(value).digest("hex");
async function grants(db, user) {
  return await all(db, `SELECT ur.id,ur.scope_kind,p.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id AND r.is_active=1 JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=?`, user.id);
}
async function employeeContext(db, id, asOf) {
  const e = await one(db, `SELECT e.id employee_id,p.org_unit_id FROM employees e LEFT JOIN employee_placements ep ON ep.employee_id=e.id AND ep.is_primary=1 AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?) LEFT JOIN positions p ON p.id=ep.position_id WHERE e.id=?`, asOf || today(), asOf || today(), id);
  return e || {
    employee_id: id
  };
}
async function can(db, user, permission, context = {}) {
  const matches = (await grants(db, user)).filter((g) => g.code === permission);
  return await asyncSome(matches, async (g) => {
    if (g.scope_kind === "ALL") return true;
    if (g.scope_kind === "SELF") return Boolean(user.employee_id && [context.employee_id, context.reporter_employee_id, ...context.related_employees || []].includes(user.employee_id));
    if (g.scope_kind === "ASSIGNED_POSTS") return permission.startsWith("security.") && Boolean(context.post_id && await one(db, "SELECT 1 FROM user_role_posts WHERE user_role_id=? AND post_id=?", g.id, context.post_id));
    if (!context.org_unit_id) return false;
    return await asyncSome(await all(db, "SELECT * FROM user_role_units WHERE user_role_id=?", g.id), async (u) => {
      if (u.org_unit_id === context.org_unit_id) return true;
      return u.include_descendants && Boolean(await one(db, "WITH RECURSIVE tree(id) AS (SELECT id FROM org_units WHERE parent_id=? UNION ALL SELECT o.id FROM org_units o JOIN tree t ON o.parent_id=t.id) SELECT id FROM tree WHERE id=?", u.org_unit_id, context.org_unit_id));
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
  assert(await asyncSome(users, async (u) => await can(db, u, "admin.users.manage") && await can(db, u, "admin.roles.manage")), "Administrator terakhir yang aktif tidak boleh dinonaktifkan atau kehilangan izin.", 409);
}
var safeUser = (u) => ({
  id: u.id,
  username: u.username,
  employee_id: u.employee_id,
  must_change_password: Boolean(u.must_change_password),
  status: u.status,
  row_version: u.row_version
});

// supabase/functions/_shared/portal/files.mjs
import { Buffer as Buffer2 } from "node:buffer";
import { basename } from "node:path";
import { randomUUID as randomUUID4, createHash as createHash2 } from "node:crypto";
var attachments = [["employee_files", "employee_id", "employee"], ["employee_contracts", "employee_id", "contract"], ["document_versions", "document_id", "document"], ["training_materials", "training_event_id", "material"], ["participant_certificates", "training_participant_id", "certificate"], ["logbook_files", "logbook_entry_id", "logbook"], ["incident_files", "incident_id", "incident"], ["announcement_files", "announcement_id", "announcement"]];
async function claimFile(db, user, id) {
  const f = await get(db, "files", id);
  assert(f.status === "AVAILABLE" && f.uploaded_by === user.id, "Berkas tidak tersedia untuk dilampirkan.", 403);
  assert(!await asyncSome(attachments, async ([t]) => await one(db, `SELECT id FROM ${t} WHERE file_id=?`, id)), "Berkas sudah terhubung. Unggah berkas baru untuk objek ini.");
  return f;
}
async function linkedFiles(db, type, id) {
  const entry = attachments.find((x) => x[2] === type);
  assert(entry, "Jenis lampiran tidak valid.");
  const metadata = type === "announcement" ? ",l.usage_kind,l.caption" : ["logbook", "incident"].includes(type) ? ",l.captured_at,l.capture_source" : "";
  return await all(db, `SELECT f.id,f.original_name,f.mime_type,f.size_bytes,l.id link_id${metadata} FROM ${entry[0]} l JOIN files f ON f.id=l.file_id WHERE l.${entry[1]}=? AND f.status='AVAILABLE'`, id);
}
async function fileAllowed(db, user, id) {
  for (const material of await all(db, "SELECT tm.training_event_id,v.document_id FROM training_materials tm JOIN document_versions v ON v.id=tm.document_version_id WHERE v.file_id=?", id)) if (await trainingAllowed(db, user, "download", await get(db, "training_events", material.training_event_id)) && await documentAllowed(db, user, "download", await get(db, "documents", material.document_id))) return true;
  for (const [table, key, type] of attachments) for (const link of await all(db, `SELECT * FROM ${table} WHERE file_id=?`, id)) {
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
    if (type === "announcement") {
      const a = await get(db, "announcements", link.announcement_id);
      if (await announcementsManager(db, user) || a.published_at && ["PUBLISHED", "ARCHIVED"].includes(a.status) && (!a.starts_at || a.starts_at <= now())) return true;
    }
  }
  return false;
}
async function upload(db, user, b, dataDir) {
  assert(await announcementsManager(db, user) || await asyncSome(["hr.documents.manage", "hr.employee_files.manage", "hr.training.manage", "hr.training.participants", "security.logbook.create", "security.incidents.create", "security.incidents.update"], async (p) => await has(db, user, p)), "Akses unggah ditolak.", 403);
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
    checksum: createHash2("sha256").update(data).digest("hex"),
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
    data: await db.storage.get(file.storage_key)
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
    assert(row.latitude == null, "Foto laporan baru diambil melalui kamera saat pelaporan.");
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

// supabase/functions/_shared/portal/hr.mjs
var optional = (v) => typeof v === "string" ? v.trim().slice(0, 1e4) || null : null;
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
        phone: optional(b.phone),
        email: optional(b.email),
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
          phone: b.phone === void 0 ? e.phone : optional(b.phone),
          email: b.email === void 0 ? e.email : optional(b.email),
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
          notes: optional(b.notes),
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
        description: optional(b.description),
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
      if (m === "GET" && !action) {
        assert(await documentAllowed(db, user, "read", doc), "Akses ditolak.", 403);
        const manage = await documentAllowed(db, user, "manage", doc);
        return {
          ...doc,
          versions: (await all(db, "SELECT v.*,f.original_name FROM document_versions v JOIN files f ON f.id=v.file_id WHERE v.document_id=? ORDER BY v.created_at DESC", id)).filter((v) => manage || v.state === "ACTIVE"),
          targets: await all(db, "SELECT org_unit_id FROM document_target_units WHERE document_id=?", id)
        };
      }
      if (m === "POST" && action === "versions") return await tx(db, async () => {
        assert(await documentAllowed(db, user, "manage", doc), "Akses ditolak.", 403);
        await claimFile(db, user, b.file_id);
        const row = await insert(db, "document_versions", {
          document_id: id,
          file_id: b.file_id,
          version_label: text(b.version_label, "Versi", 50),
          effective_on: date(b.effective_on),
          state: "DRAFT",
          change_notes: optional(b.change_notes),
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
        organizer_name: optional(b.organizer_name),
        starts_at: start,
        ends_at: end,
        location: optional(b.location),
        description: optional(b.description),
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
          can_delete: user.username === "itadmin",
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
        assert(user.username === "itadmin", "Hanya itadmin yang boleh menghapus kegiatan.", 403);
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
      if (m === "POST" && action === "participants") return await tx(db, async () => {
        assert(await trainingAllowed(db, user, "participants", event), "Akses ditolak.", 403);
        const ec = await employeeContext(db, (await get(db, "employees", b.employee_id)).id);
        await requireAccess(db, user, "hr.training.participants", ec);
        const row = await insert(db, "training_participants", {
          training_event_id: id,
          employee_id: b.employee_id,
          attendance_status: "NOT_RECORDED",
          created_by: user.id
        });
        await audit(db, user, "ADD_PARTICIPANT", "training_events", id, {
          participant_id: row.id
        });
        return row;
      });
      if (m === "PATCH" && action === "participants") return await tx(db, async () => {
        assert(await trainingAllowed(db, user, "participants", event), "Akses ditolak.", 403);
        const tp = await get(db, "training_participants", p[3]);
        assert(tp.training_event_id === id, "Peserta tidak sesuai.");
        const status = enumValue(b.attendance_status, ["NOT_RECORDED", "PRESENT", "ABSENT"]);
        const row = await update(db, "training_participants", tp.id, b.row_version, {
          attendance_status: status,
          attendance_notes: optional(b.attendance_notes),
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
          certificate_no: optional(b.certificate_no),
          issued_on: b.issued_on ? date(b.issued_on) : null,
          created_by: user.id
        });
        await audit(db, user, "ADD_CERTIFICATE", "training_participants", tp.id);
        return row;
      });
    }
  }
  if (p[0] === "coaching") {
    if (m === "GET" && !id) {
      assert(await has(db, user, "hr.coaching.read") || await has(db, user, "hr.coaching.manage"), "Akses ditolak.", 403);
      return {
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
        constraints_notes: optional(b.constraints_notes),
        agreement_notes: optional(b.agreement_notes),
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
          actions: await all(db, "SELECT a.*,e.full_name responsible_name FROM coaching_actions a JOIN employees e ON e.id=a.responsible_employee_id WHERE coaching_session_id=? ORDER BY a.created_at", id)
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
          progress_notes: optional(b.progress_notes),
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

// supabase/functions/_shared/portal/field-reports.mjs
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
  const location = b.location;
  assert(location && typeof location === "object", "Lokasi perangkat wajib berhasil didapatkan sebelum laporan dikirim.");
  const numeric = (value, min, max) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
  assert(numeric(location.latitude, -90, 90) && numeric(location.longitude, -180, 180) && numeric(location.accuracy, 0, 1e7), "Koordinat atau akurasi lokasi tidak valid.");
  assert(Array.isArray(b.photos) && b.photos.length >= 1 && b.photos.length <= 5, "Ambil minimal satu dan maksimal lima foto melalui kamera aplikasi.");
  const photos = b.photos.map((photo) => {
    assert(photo && photo.source === "CAMERA", "Foto wajib diambil melalui kamera aplikasi.");
    return {
      file_id: text(photo.file_id, "Berkas foto", 100),
      captured_at: fresh(photo.captured_at),
      capture_source: "CAMERA"
    };
  });
  assert(new Set(photos.map((p) => p.file_id)).size === photos.length, "Foto yang sama tidak dapat digunakan berulang.");
  const payload = {
    post_id: null,
    reporting_org_unit_id: ctx.org_unit_id || null,
    latitude: location.latitude,
    longitude: location.longitude,
    location_accuracy: location.accuracy,
    location_captured_at: fresh(location.captured_at),
    occurred_at: instant(b.occurred_at)
  };
  if (incident) Object.assign(payload, {
    reporter_employee_id: employee.id,
    incident_type: text(b.incident_type, "Kategori kejadian", 200),
    chronology: text(b.chronology, "Kronologi", 2e4),
    initial_action: null,
    source_logbook_entry_id: b.source_logbook_entry_id || null
  });
  else Object.assign(payload, {
    employee_id: employee.id,
    activity_type: b.activity_type,
    activity_notes: text(b.activity_notes, "Uraian kegiatan", 1e4),
    findings: null,
    roster_assignment_id: null
  });
  return {
    payload,
    photos,
    key: text(b.idempotency_key, "Kunci permintaan", 100),
    fingerprint: digest(JSON.stringify({
      payload,
      photos
    }))
  };
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

// supabase/functions/_shared/portal/security.mjs
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
        if (log.latitude == null && b.findings !== void 0) values.findings = opt(b.findings);
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

// supabase/functions/_shared/portal/roster.mjs
var GENERATOR_VERSION = "besakih-rotation/1.0";
var DAY = 864e5;
var MIN = 6e4;
var addDays = (day, n) => new Date(Date.parse(day) + n * DAY).toISOString().slice(0, 10);
var localDate = (value) => new Date(Date.parse(value) + 8 * 36e5).toISOString().slice(0, 10);
function days(from, to) {
  const result = [];
  for (let d = from; d <= to; d = addDays(d, 1)) result.push(d);
  return result;
}
function shiftInterval(day, shift) {
  return {
    starts_at: (/* @__PURE__ */ new Date(`${day}T${shift.start_time}:00+08:00`)).toISOString(),
    ends_at: (/* @__PURE__ */ new Date(`${addDays(day, shift.end_day_offset)}T${shift.end_time}:00+08:00`)).toISOString()
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
    const day = localDate(new Date(cursor).toISOString()), next = Date.parse(`${addDays(day, 1)}T00:00:00+08:00`), stop = Math.min(next, end);
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
  }, (_, i) => addDays(d, i))));
  for (const end of windowEnds) {
    let minutes = 0;
    for (let i = 0; i < 7; i++) minutes += byDay.get(addDays(end, -i)) || 0;
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
    if (prev && day !== addDays(prev, 1)) {
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
        applies_to: next && next.effective_from <= snapshot.period.ends_on ? addDays(next.effective_from, -1) : snapshot.period.ends_on,
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

// supabase/functions/_shared/portal/admin.mjs
import { randomBytes } from "node:crypto";
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
      assert(typeof b.password === "string" && b.password.length >= 12 && b.password.length <= 128, "Password harus 12\u2013128 karakter.");
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
      await run(db, "DELETE FROM user_roles WHERE user_id=?", id);
      for (const g of b.grants) {
        const role = await get(db, "roles", g.role_id);
        assert(role.is_active, "Role tidak aktif.");
        const kind = enumValue(g.scope_kind, ["SELF", "ASSIGNED_UNITS", "ASSIGNED_POSTS", "ALL"]);
        if (role.code === "SUPER_ADMIN") assert(kind === "ALL", "Super Admin memerlukan cakupan seluruh organisasi.");
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
      await get(db, "users", id);
      const token = randomBytes(24).toString("hex");
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
          permissions: (await all(db, "SELECT p.code FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id=?", r.id)).map((p2) => p2.code)
        })),
        permissions: await all(db, "SELECT * FROM permissions ORDER BY code")
      };
    }
    if (["POST", "PATCH"].includes(m)) return await tx(db, async () => {
      await requireAccess(db, user, "admin.roles.manage");
      const old = id ? await get(db, "roles", id) : null;
      assert(Array.isArray(b.permissions), "Daftar izin wajib diisi.");
      const code = text(b.code === void 0 ? old?.code : b.code, "Kode role", 64).toUpperCase();
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
    if (m === "GET") return Object.fromEntries((await all(db, "SELECT key,value FROM app_settings")).map((r) => [r.key, r.value]));
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

// supabase/functions/_shared/portal/announcements.mjs
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

// supabase/functions/_shared/portal/read-models.mjs
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
      open_actions: coaching.reduce((sum, s) => sum + s.open_actions, 0),
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

// supabase/functions/_shared/portal/router.mjs
async function routeOperation({ db, user, path, method, body = {}, query = "" }) {
  assert(typeof path === "string" && /^[a-z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(path) && path.length <= 512, "Alamat API tidak valid.", 404);
  assert(["GET", "POST", "PATCH", "DELETE"].includes(method), "Metode tidak diizinkan.", 405);
  const p = path.split("/");
  const url = new URL(`https://portal.invalid/?${query}`);
  if (path === "portal/me" && method === "GET") return { user: safeUser(user), name: user.employee_id ? (await get(db, "employees", user.employee_id)).full_name : user.username, permissions: [...new Set((await grants(db, user)).map((g) => g.code))], announcements_manage: await announcementsManager(db, user), demo: false };
  assert(!user.must_change_password, "Anda wajib mengganti password sementara terlebih dahulu.", 428);
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
  if (path === "uploads" && method === "POST") return upload(db, user, body);
  if (path === "attachments" && method === "POST") return attach(db, user, body.type, body.owner_id, body);
  if (p[0] === "files" && p.length === 2 && method === "GET") {
    const { file, data } = await download(db, user, p[1]);
    assert(data.length === file.size_bytes && createHash3("sha256").update(data).digest("hex") === file.checksum, "Integritas berkas belum dapat diverifikasi.", 503);
    return { binary: true, data: Buffer3.from(data).toString("base64"), mime_type: file.mime_type, name: file.original_name, inline: url.searchParams.get("inline") === "1" && ["image/png", "image/jpeg"].includes(file.mime_type) };
  }
  const ctx = { db, user, p, method, body, url };
  for (const handler of [announcementRoutes, hrRoutes, securityRoutes, rosterRoutes, adminRoutes]) {
    const result = await handler(ctx);
    if (result !== void 0) return result;
  }
  throw new AppError(404, "Alamat API tidak ditemukan.");
}

// supabase/functions/portal-api/index.ts
var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var hash = (value) => createHash4("sha256").update(value).digest("hex");
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
function adapter(sql, identity, storage) {
  return { inTransaction: true, query: (statement, values = []) => sql.unsafe(statement, values), identity, storage };
}
async function transaction(client, identity, storage, work, mutating = true) {
  return client.begin(async (sql) => {
    await sql.unsafe("SET LOCAL search_path=portal,pg_catalog; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='40s';");
    if (mutating) await sql.unsafe("SELECT pg_advisory_xact_lock(734829610160009)");
    return work(adapter(sql, identity, storage));
  });
}
async function recover(client, identity, storage, b, requestId) {
  assert(typeof b.client_ip === "string" && b.client_ip.length <= 45 && /^[a-f0-9:.]+$/i.test(b.client_ip), "Permintaan tidak valid.", 400);
  const input = b.body;
  assert(typeof input?.token === "string" && /^[a-f0-9]{48}$/.test(input.token) && typeof input.new_password === "string" && input.new_password.length >= 12 && input.new_password.length <= 128, "Kredensial pemulihan atau password tidak valid.", 422);
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
      storage = createDriveStorage(env);
      const client = database(env);
      if (b.action === "health") {
        const ready = await transaction(client, identity, storage, async (db) => {
          const r = await one(db, "SELECT count(*)::integer total,count(*) FILTER(WHERE rowsecurity)::integer protected FROM pg_catalog.pg_tables WHERE schemaname='portal'");
          return r.total === 48 && r.protected === 48;
        }, false);
        assert(ready, "Modul portal belum siap.", 503);
        return Response.json({ ok: true, healthy: true, revision: "20261016.1" }, { headers: { "Cache-Control": "no-store" } });
      }
      if (b.action === "recover") return Response.json(await recover(client, identity, storage, b, requestId), { headers: { "Cache-Control": "no-store" } });
      assert(b.action === "operation" && typeof b.access_token === "string" && b.access_token.length <= 8192 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(b.access_token), "Sesi berakhir. Silakan masuk kembali.", 401);
      assert(typeof b.session_hash === "string" && /^[a-f0-9]{64}$/.test(b.session_hash) && typeof b.lease_hash === "string" && /^[a-f0-9]{64}$/.test(b.lease_hash), "Sesi berakhir. Silakan masuk kembali.", 401);
      assert(Number.isSafeInteger(b.session_version) && b.session_version > 0, "Sesi berakhir. Silakan masuk kembali.", 401);
      const verified = await identity.verify(b.access_token);
      assert(uuid.test(verified?.id), "Sesi berakhir. Silakan masuk kembali.", 401);
      const claims = JSON.parse(atob(b.access_token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/")));
      assert(claims.sub === verified.id && uuid.test(claims.session_id), "Sesi berakhir. Silakan masuk kembali.", 401);
      const result = await transaction(client, identity, storage, async (db) => {
        const user = await one(db, "SELECT * FROM users WHERE id=? AND status='ACTIVE'", verified.id);
        assert(user, "Akun tidak aktif.", 401);
        user.request_id = requestId;
        const session = await one(db, "SELECT id FROM portal_auth_private.web_sessions WHERE token_hash=? AND user_id=? AND auth_session_id=? AND revoked_at IS NULL AND expires_at>clock_timestamp() AND lease_hash=? AND lease_until>clock_timestamp() AND version=?", b.session_hash, user.id, claims.session_id, b.lease_hash, b.session_version);
        assert(session, "Sesi berakhir. Silakan masuk kembali.", 401);
        assert(!user.employee_id || (await one(db, "SELECT is_active FROM employees WHERE id=?", user.employee_id))?.is_active === 1, "Profil pegawai tidak aktif.", 401);
        assert(typeof b.query === "string" && b.query.length <= 2048 && b.body && typeof b.body === "object" && !Array.isArray(b.body), "Permintaan tidak valid.", 400);
        const result2 = await routeOperation({ db, user, path: b.path, method: b.method, body: b.body, query: b.query });
        workCompleted = true;
        return result2;
      }, b.method !== "GET");
      return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store", "X-SPH-Modules-Revision": "20261016.1" } });
    } catch (error) {
      if (!workCompleted) {
        await storage?.rollback();
        await identity?.rollback();
      }
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
