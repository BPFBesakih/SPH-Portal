// test-results/coaching-native/release/supabase/functions/coaching-native/index.ts
import { withSupabase } from "npm:@supabase/server@1";
import postgres from "npm:postgres@3.4.7";
import { randomUUID as randomUUID4 } from "node:crypto";

// test-results/coaching-native/release/supabase/functions/_shared/portal/db.mjs
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
async function audit(db, actor, action, type, key, summary = {}, reason = "") {
  await insert(db, "audit_events", { actor_user_id: actor?.id || null, action, object_type: type, object_key: String(key), occurred_at: now(), outcome: "SUCCESS", request_id: actor?.request_id || uid(), reason, change_summary: JSON.stringify(summary) });
}
function text(v, label = "Isian", max = 500) {
  assert(typeof v === "string" && v.trim().length > 0 && v.length <= max, `${label} wajib diisi (maksimal ${max} karakter).`);
  return v.trim();
}

// test-results/coaching-native/release/supabase/functions/_shared/portal/drive.mjs
import { Buffer } from "node:buffer";
import { randomUUID as randomUUID2 } from "node:crypto";
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
  coaching: "SPH-Portal-Coaching"
});
function createDriveStorage(env, fetchImpl = globalThis.fetch.bind(globalThis), options = {}) {
  const value = (name) => typeof env[name] === "string" ? env[name].trim() : "";
  const folder = value("GOOGLE_DRIVE_FOLDER_ID"), clientId = value("GOOGLE_DRIVE_CLIENT_ID"), clientSecret = value("GOOGLE_DRIVE_CLIENT_SECRET"), refreshToken = value("GOOGLE_DRIVE_REFRESH_TOKEN");
  const created = [], moves = [], claimed = /* @__PURE__ */ new Set(), folders = /* @__PURE__ */ new Map();
  let access;
  const folderType = "application/vnd.google-apps.folder";
  const metadataFields = "id,parents,trashed,mimeType,appProperties";
  async function request(url, options2 = {}, stage = "storage") {
    let r;
    try {
      r = await fetchImpl(url, { ...options2, redirect: "manual", signal: AbortSignal.timeout(12e3) });
    } catch {
      throw storageError(stage, null, "network_error");
    }
    if (!r.ok) throw storageError(stage, r.status, await errorReason(r));
    return r;
  }
  async function token() {
    if (access) return access;
    assert(folder && clientId && clientSecret && refreshToken, "Penyimpanan berkas belum dikonfigurasi.", 503);
    const r = await request("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }) }, "token");
    const j = await r.json();
    assert(typeof j.access_token === "string" && j.access_token.length < 8192, "Penyimpanan berkas belum dapat diakses.", 503);
    access = j.access_token;
    return access;
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
      const boundary = `sph_${randomUUID2()}`;
      const module = options.module;
      assert(module == null || knownModule(module), "Modul penyimpanan tidak valid.");
      const parent = module ? await moduleFolder(module) : folder;
      const meta = { name: randomUUID2(), parents: [parent], appProperties: { sph_portal: "v1", ...module ? { sph_module: module } : {} } };
      const body = new Blob([`--${boundary}\r
Content-Type: application/json; charset=UTF-8\r
\r
${JSON.stringify(meta)}\r
--${boundary}\r
Content-Type: ${mime}\r
\r
`, data, `\r
--${boundary}--`]);
      const r = await request("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { ...await headers(), "Content-Type": `multipart/related; boundary=${boundary}` }, body }, "upload");
      const file = await r.json();
      valid(file.id);
      created.push(file.id);
      return file.id;
    },
    claim(id) {
      valid(id);
      claimed.add(id);
    },
    async finalize() {
      if (!claimed.size) return;
      assert(knownModule(options.module), "Modul lampiran belum dapat ditentukan.", 503);
      for (const id of claimed) await organize(id, options.module);
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

// test-results/coaching-native/release/supabase/functions/_shared/portal/coaching-links.mjs
import { Buffer as Buffer3 } from "node:buffer";

// test-results/coaching-native/release/supabase/functions/_shared/portal/auth.mjs
import { createHash } from "node:crypto";
var digest = (value) => createHash("sha256").update(value).digest("hex");
var purchasingRoleCodes = {
  PURCHASE_REQUESTER: ["Pemohon Pengadaan", ["purchasing.requests.create", "purchasing.requests.read"]],
  PURCHASING_STAFF: ["Staf Purchasing", ["purchasing.requests.read", "purchasing.procurement.manage", "purchasing.vendors.read", "purchasing.vendors.manage", "purchasing.vendors.sensitive", "purchasing.budget.read", "purchasing.reports.read"]],
  FINANCE_VERIFIER: ["Verifikator Keuangan", ["purchasing.requests.read", "purchasing.requests.verify", "purchasing.budget.read", "purchasing.budget.manage", "purchasing.vendors.read", "purchasing.vendors.sensitive", "purchasing.reports.read"]],
  PURCHASE_AUDITOR: ["Pemeriksa SPI", ["purchasing.requests.read", "purchasing.vendors.read", "purchasing.budget.read", "purchasing.reports.read", "purchasing.reports.export", "admin.audit.read"]],
  PURCHASE_ADMIN: ["Pengelola Pengadaan", ["purchasing.settings.manage", "purchasing.requests.read", "purchasing.vendors.read", "purchasing.vendors.manage", "purchasing.vendors.sensitive", "purchasing.budget.read", "purchasing.budget.manage"]]
};
var purchasingRoles = Object.entries(purchasingRoleCodes).map(([code, [name, codes]]) => [code, name, (c) => codes.includes(c)]);

// test-results/coaching-native/release/supabase/functions/_shared/portal/files.mjs
import { Buffer as Buffer2 } from "node:buffer";
import { basename } from "node:path";
import { randomUUID as randomUUID3, createHash as createHash3 } from "node:crypto";

// test-results/coaching-native/release/supabase/functions/_shared/portal/purchasing.mjs
import { createHash as createHash2, randomBytes } from "node:crypto";

// test-results/coaching-native/release/supabase/functions/_shared/portal/purchasing-rules.mjs
var DEFAULT_SETTINGS = Object.freeze({
  sekban_max_total: 5e6,
  attachment_min_item_subtotal: 1e6,
  comparison_min_total: 1e6,
  min_quotes_per_item: 2,
  officials: {
    sekban_position_id: null,
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

// test-results/coaching-native/release/supabase/functions/_shared/portal/files.mjs
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

// test-results/coaching-native/release/supabase/functions/_shared/portal/coaching-links.mjs
var invalidLink = "Tautan coaching tidak aktif. Minta tautan terbaru kepada pengelola.";
var topics = ["Disiplin", "Kinerja", "Pelayanan", "Sikap Kerja", "Lainnya"];
async function linkFor(db, token) {
  assert(typeof token === "string" && /^[a-f0-9]{64}$/.test(token), invalidLink, 404);
  const link = await one(db, "SELECT * FROM coaching_links WHERE token_hash=? AND is_active=1", digest(token));
  assert(link, invalidLink, 404);
  return link;
}
async function peopleFor(db) {
  const stamp = today(), rows = await all(db, `SELECT e.id,e.full_name,p.name position_name,u.name unit_name FROM employees e
    LEFT JOIN employee_placements ep ON ep.employee_id=e.id AND ep.is_primary=1 AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?)
    LEFT JOIN positions p ON p.id=ep.position_id LEFT JOIN org_units u ON u.id=p.org_unit_id
    WHERE e.is_active=1 ORDER BY e.full_name,e.id`, stamp, stamp);
  const groups = /* @__PURE__ */ new Map(), ids = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const context = [row.unit_name, row.position_name].filter(Boolean).join(" \xB7 "), key = JSON.stringify([row.full_name.trim().toLocaleLowerCase("id"), context]);
    const group = groups.get(key) || [];
    group.push({
      ...row,
      position_name: context
    });
    groups.set(key, group);
    ids.set(row.id, (ids.get(row.id) || 0) + 1);
  }
  return [...groups.values()].map((group) => group.length === 1 && ids.get(group[0].id) === 1 ? {
    id: group[0].id,
    full_name: group[0].full_name,
    position_name: group[0].position_name
  } : {
    id: "",
    full_name: group[0].full_name,
    position_name: `${group[0].position_name || "Penempatan belum tersedia"} \xB7 Data ganda \u2014 hubungi SDM`,
    disabled: true
  });
}
var day = (value, label) => {
  assert(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, `${label} tidak valid.`);
  return value;
};
var receipt = (row) => ({
  reference: `CH-${row.coaching_session_id.slice(0, 8).toUpperCase()}`,
  received_at: row.submitted_at
});
async function takeCoachingLinkSlot(db, clientIp, action) {
  assert(typeof clientIp === "string" && clientIp.length <= 45 && /^[a-f0-9:.]+$/i.test(clientIp), "Permintaan tidak valid.", 400);
  assert(["context", "submit"].includes(action), "Alamat tidak ditemukan.", 404);
  const stamp = now(), cutoff = new Date(Date.now() - 10 * 6e4).toISOString(), key = digest(`coaching-link\0${action}\0${clientIp}`);
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
async function publicCoachingLink(db, action, b, dataDir, requestId) {
  const link = await linkFor(db, b.token), people = await peopleFor(db);
  if (action === "context") return {
    label: link.label,
    today: today(),
    employees: people
  };
  assert(action === "submit", "Alamat tidak ditemukan.", 404);
  assert(!b.website, "Permintaan tidak valid.");
  const employee = people.find((e) => e.id === b.employee_id && !e.disabled), coach = people.find((e) => e.id === b.coach_employee_id && !e.disabled);
  assert(employee && coach, "Pilih nama karyawan dan coach dari hasil pencarian. Data ganda perlu diperiksa SDM.");
  assert(employee.id !== coach.id, "Coach harus berbeda dari karyawan.");
  assert(typeof b.idempotency_key === "string" && /^[a-f0-9-]{36}$/i.test(b.idempotency_key), "Kunci coaching tidak valid.");
  const held = day(b.held_on, "Tanggal coaching"), due = day(b.due_on, "Target penyelesaian");
  assert(due >= held, "Target penyelesaian harus pada atau setelah tanggal coaching.");
  assert(topics.includes(b.topic), "Pilih topik coaching.");
  const payload = {
    employee_id: employee.id,
    coach_employee_id: coach.id,
    held_on: held,
    due_on: due,
    topic: b.topic,
    department: text(b.department, "Bidang", 200),
    section: text(b.section, "Urusan", 200),
    constraints_notes: text(b.constraints_notes, "Permasalahan", 1e4),
    guidance_notes: text(b.guidance_notes, "Arahan", 1e4),
    agreement_notes: text(b.agreement_notes, "Komitmen", 3e3)
  };
  const photo = b.photo;
  assert(photo && ["image/jpeg", "image/png"].includes(photo.mime_type) && typeof photo.data === "string" && photo.data.length <= 13981016 && /^[A-Za-z0-9+/]+={0,2}$/.test(photo.data), "Sertakan satu foto JPG/PNG maksimal 10 MB.");
  const bytes = Buffer3.from(photo.data, "base64");
  assert(bytes.length > 0 && bytes.length <= 10485760 && bytes.toString("base64") === photo.data, "Isi foto tidak valid atau terlalu besar.");
  assert(photo.mime_type === "image/png" ? bytes.subarray(0, 8).equals(Buffer3.from([137, 80, 78, 71, 13, 10, 26, 10])) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255, "Isi foto tidak cocok dengan jenisnya.");
  const fingerprint = digest(JSON.stringify({
    ...payload,
    photo_hash: digest(photo.data)
  })), source = `NATIVE_LINK:${link.id}`;
  const previous = await one(db, "SELECT coaching_session_id,payload_hash,submitted_at FROM coaching_form_submissions WHERE form_id=? AND response_id=?", source, b.idempotency_key);
  if (previous) {
    assert(previous.payload_hash === fingerprint, "Kunci coaching sudah digunakan untuk jawaban berbeda. Periksa hasil pengiriman sebelumnya.", 409);
    return receipt(previous);
  }
  const placements = await all(db, "SELECT p.org_unit_id FROM employee_placements ep JOIN positions p ON p.id=ep.position_id WHERE ep.employee_id=? AND ep.is_primary=1 AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?)", employee.id, held, held);
  assert(placements.length === 1, "Penempatan utama karyawan pada tanggal coaching perlu diperiksa SDM.");
  const stamp = now(), actor = {
    id: null,
    request_id: requestId
  };
  const file = await storeUpload(db, actor, {
    name: `Coaching_${held}.${photo.mime_type === "image/png" ? "png" : "jpg"}`,
    mime_type: photo.mime_type,
    data: photo.data
  }, dataDir);
  const stored = await one(db, "SELECT storage_key FROM files WHERE id=? AND uploaded_by IS NULL", file.id);
  assert(stored, "Foto coaching belum dapat dikonfirmasi.", 503);
  db.storage?.claim?.(stored.storage_key);
  const session = await insert(db, "coaching_sessions", {
    employee_id: employee.id,
    coach_employee_id: coach.id,
    org_unit_id: placements[0].org_unit_id,
    held_at: (/* @__PURE__ */ new Date(`${held}T00:00:00+08:00`)).toISOString(),
    topic: payload.topic,
    constraints_notes: payload.constraints_notes,
    guidance_notes: payload.guidance_notes,
    agreement_notes: payload.agreement_notes,
    created_by: null
  });
  await insert(db, "coaching_actions", {
    coaching_session_id: session.id,
    responsible_employee_id: employee.id,
    action_text: payload.agreement_notes,
    status: "OPEN",
    due_on: due,
    created_by: null
  });
  await insert(db, "coaching_files", {
    coaching_session_id: session.id,
    file_id: file.id,
    caption: "Foto coaching",
    created_by: null
  });
  const submission = await insert(db, "coaching_form_submissions", {
    form_id: source,
    response_id: b.idempotency_key,
    payload_hash: fingerprint,
    coaching_session_id: session.id,
    submitted_at: stamp,
    department: payload.department,
    section: payload.section
  });
  await audit(db, actor, "PUBLIC_COACHING_SUBMISSION", "coaching_sessions", session.id, {
    source: "NATIVE_LINK",
    link_id: link.id,
    employee_id: employee.id,
    coach_employee_id: coach.id,
    identity: "SELF_REPORTED"
  });
  return receipt(submission);
}

// test-results/coaching-native/release/supabase/functions/coaching-native/index.ts
var pool;
async function readBody(req) {
  assert(req.headers.get("content-type")?.toLowerCase().startsWith("application/json") && req.body, "Gunakan JSON.", 415);
  const reader = req.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 14 * 1024 * 1024 + 131072) {
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
async function transaction(client, storage, work) {
  return client.begin(async (sql) => {
    await sql.unsafe("SET LOCAL search_path=portal,pg_catalog; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='40s';");
    await sql.unsafe("SELECT pg_advisory_xact_lock(734829610160009)");
    return work({ inTransaction: true, query: (statement, values = []) => sql.unsafe(statement, values), storage });
  });
}
var index_default = { fetch: withSupabase({ auth: "secret" }, async (req) => {
  const requestId = randomUUID4();
  let storage, completed = false;
  try {
    assert(req.method === "POST", "Metode tidak diizinkan.", 405);
    const b = await readBody(req), env = Deno.env.toObject();
    assert(["context", "submit"].includes(b.operation) && b.body && typeof b.body === "object" && !Array.isArray(b.body), "Permintaan tidak valid.", 400);
    if (!pool) pool = postgres(env.SUPABASE_DB_URL, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10, onnotice: () => {
    } });
    storage = createDriveStorage(env, void 0, { module: "coaching" });
    const allowed = await transaction(pool, storage, (db) => takeCoachingLinkSlot(db, b.client_ip, b.operation));
    assert(allowed, "Terlalu banyak percobaan. Coba lagi beberapa menit kemudian.", 429);
    const result = await transaction(pool, storage, async (db) => {
      const result2 = await publicCoachingLink(db, b.operation, b.body, void 0, requestId);
      await storage.finalize();
      completed = true;
      return result2;
    });
    return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!completed) await storage?.rollback();
    const status = error instanceof AppError ? error.status : ["23505", "40001", "40P01", "55P03"].includes(error?.code) ? 409 : ["23502", "23503", "23514", "22P02"].includes(error?.code) ? 422 : 503;
    const message = error instanceof AppError ? error.message : status === 409 ? "Proses berubah. Coba kirim kembali dengan jawaban yang sama." : status === 422 ? "Relasi atau nilai data perlu diperiksa." : "Pengiriman belum dapat dikonfirmasi. Coba kirim kembali.";
    return Response.json({ ok: false, error: message, request_id: requestId }, { status, headers: { "Cache-Control": "no-store" } });
  }
}) };
export {
  index_default as default
};
