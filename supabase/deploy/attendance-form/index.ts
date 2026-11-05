// supabase/functions/attendance-form/index.ts
import { withSupabase } from "npm:@supabase/server@1";
import postgres from "npm:postgres@3.4.7";
import { randomUUID as randomUUID4 } from "node:crypto";

// supabase/functions/_shared/portal/db.mjs
import { randomUUID } from "node:crypto";
var now = () => (/* @__PURE__ */ new Date()).toISOString();
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

// supabase/functions/_shared/portal/drive.mjs
import { Buffer } from "node:buffer";
import { randomUUID as randomUUID2, createHash as driveCacheHash } from "node:crypto";
var driveAccessTokens = /* @__PURE__ */ new Map();
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
  absensi: "SPH-Portal-Absensi"
});
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
    // Hapus satu berkas milik portal (retensi selfie Absensi). Berkas yang sudah tidak ada
    // dilaporkan 404 supaya pemanggil bisa menandainya terhapus.
    async remove(id) {
      await ownedMetadata(id);
      try {
        await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, { method: "DELETE", headers: await headers() }, "cleanup");
      } catch (error) {
        if (error instanceof AppError && error.details?.upstream_status === 404) throw new AppError(404, "Berkas tidak tersedia.");
        throw error;
      }
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

// supabase/functions/_shared/portal/attendance-form.mjs
import { Buffer as Buffer3 } from "node:buffer";
import { createHash as createHash3, randomUUID as randomUUID3 } from "node:crypto";

// supabase/functions/_shared/portal/auth.mjs
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

// supabase/functions/_shared/portal/attendance-rules.mjs
import { Buffer as Buffer2 } from "node:buffer";
import { createHash as createHash2, webcrypto } from "node:crypto";
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
var witaDate = (ms) => new Date(ms + 8 * 36e5).toISOString().slice(0, 10);
function distanceMeters(lat1, lon1, lat2, lon2) {
  const r = 63710088e-1, rad = (d) => d * Math.PI / 180, dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}
function matchPoint(points, latitude, longitude) {
  let inside = null, nearest = null;
  for (const p of points) {
    const distance = distanceMeters(latitude, longitude, Number(p.latitude), Number(p.longitude));
    if (distance <= Number(p.radius_m) && (!inside || distance < inside.distance)) inside = {
      point: p,
      distance
    };
    if (!nearest || distance < nearest.distance) nearest = {
      point: p,
      distance
    };
  }
  const best = inside || nearest;
  return best ? {
    point: best.point,
    distance: Math.round(best.distance),
    within: Boolean(inside)
  } : null;
}
function jumped(previous, current) {
  if (!previous) return false;
  const hours = (Date.parse(current.recorded_at) - Date.parse(previous.recorded_at)) / 36e5;
  if (!(hours >= 0) || hours > attendanceRules.jumpWindowHours) return false;
  const meters = distanceMeters(Number(previous.latitude), Number(previous.longitude), Number(current.latitude), Number(current.longitude));
  if (meters <= Math.max(attendanceRules.jumpMinMeters, Number(previous.accuracy_m) + Number(current.accuracy_m))) return false;
  return meters / 1e3 / Math.max(hours, 1 / 3600) > attendanceRules.jumpKmh;
}
var signatureMessage = (action, deviceId, ts, payload) => `sph-absen-v1
${action}
${deviceId}
${ts}
${payload}`;
var b64url = /^[A-Za-z0-9_-]+$/;
function cleanPublicKey(jwk) {
  const valid = jwk && typeof jwk === "object" && !Array.isArray(jwk) && jwk.kty === "EC" && jwk.crv === "P-256" && typeof jwk.x === "string" && typeof jwk.y === "string" && jwk.x.length === 43 && jwk.y.length === 43 && b64url.test(jwk.x) && b64url.test(jwk.y) && !("d" in jwk);
  if (!valid) return null;
  return {
    crv: "P-256",
    kty: "EC",
    x: jwk.x,
    y: jwk.y
  };
}
var keyThumbprint = (key) => createHash2("sha256").update(JSON.stringify({
  crv: key.crv,
  kty: key.kty,
  x: key.x,
  y: key.y
})).digest("hex");
var subtle = () => globalThis.crypto?.subtle || webcrypto.subtle;
async function importPublicKey(key) {
  try {
    return await subtle().importKey("jwk", {
      ...key,
      ext: true
    }, {
      name: "ECDSA",
      namedCurve: "P-256"
    }, false, ["verify"]);
  } catch {
    return null;
  }
}
async function verifySignature(publicKeyText, message, signature) {
  let key;
  try {
    key = JSON.parse(publicKeyText);
  } catch {
    return false;
  }
  const clean = cleanPublicKey(key);
  if (!clean || typeof signature !== "string" || !b64url.test(signature)) return false;
  const imported = await importPublicKey(clean);
  if (!imported) return false;
  const bytes = Buffer2.from(signature, "base64url");
  if (bytes.length !== 64) return false;
  try {
    return await subtle().verify({
      name: "ECDSA",
      hash: "SHA-256"
    }, imported, bytes, new TextEncoder().encode(message));
  } catch {
    return false;
  }
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
var invalidRegistration = "Tautan pendaftaran tidak aktif atau sudah dipakai. Minta tautan baru kepada SDM atau koordinator.";
var invalidSession = "Sesi pendaftaran sudah ditutup. Minta tautan sesi yang baru kepada SDM.";
var unknownDevice = "HP ini belum terdaftar untuk absen. Minta SDM atau koordinator mendaftarkannya.";
var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var tokenPattern = /^[a-f0-9]{64}$/;
var HOUR = 36e5;
async function takeSlot(db, key, limit) {
  const stamp = now(), cutoff = new Date(Date.now() - attendanceFormLimits.windowMinutes * 6e4).toISOString();
  const row = await one(db, `INSERT INTO attendance_rate_limits(id,window_start,hits) VALUES(?,?,1)
  ON CONFLICT(id) DO UPDATE SET hits=CASE WHEN attendance_rate_limits.window_start<? THEN 1 ELSE attendance_rate_limits.hits+1 END,
  window_start=CASE WHEN attendance_rate_limits.window_start<? THEN excluded.window_start ELSE attendance_rate_limits.window_start END
  RETURNING hits`, digest(key), stamp, cutoff, cutoff);
  return Number(row.hits) <= limit;
}
async function takeAttendanceIpSlot(db, action, clientIp) {
  assert(attendanceFormActions.includes(action), "Alamat tidak ditemukan.", 404);
  assert(typeof clientIp === "string" && clientIp.length <= 45 && /^[a-f0-9:.]+$/i.test(clientIp), "Permintaan tidak valid.", 400);
  await run(db, "DELETE FROM attendance_rate_limits WHERE window_start<?", new Date(Date.now() - 24 * HOUR).toISOString());
  return await takeSlot(db, `absen\0${action}\0ip\0${clientIp}`, attendanceFormLimits.ip[action]);
}
async function takeDeviceSlot(db, action, device) {
  const limits = device.kind === "SHARED" ? attendanceFormLimits.sharedDevice : attendanceFormLimits.device;
  return await takeSlot(db, `absen\0${action}\0device\0${device.id}`, limits[action]);
}
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
async function unitPeople(db, unitId) {
  const units = new Set(await unitTree(db, unitId));
  return (await attendancePeople(db)).filter((p) => units.has(p.org_unit_id));
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
async function pendingByToken(db, token) {
  assert(typeof token === "string" && tokenPattern.test(token), invalidRegistration, 404);
  const d = await one(db, "SELECT * FROM attendance_devices WHERE registration_token_hash=? AND status='PENDING'", digest(token));
  assert(d && d.registration_expires_at > now(), invalidRegistration, 404);
  return d;
}
async function registrationPreview(db, b) {
  const d = await pendingByToken(db, b?.token), view = await deviceView(db, d);
  if (view.kind === "PERSONAL") assert(view.owner && (await attendancePeople(db, "e.id=?", view.owner.id)).length, "Pemilik HP ini tidak aktif. Minta tautan baru kepada SDM.", 409);
  return {
    kind: view.kind,
    label: view.label,
    owner: view.owner,
    unit: view.unit,
    expires_at: d.registration_expires_at
  };
}
async function checkRegistrationKey(b) {
  const key = cleanPublicKey(b?.public_key);
  assert(key, "Kunci HP tidak valid. Muat ulang halaman lalu coba lagi.", 422);
  assert(await importPublicKey(key), "Kunci HP tidak valid. Muat ulang halaman lalu coba lagi.", 422);
  const info = typeof b.client_info === "string" ? b.client_info.replace(/[\u0000-\u001f]/g, " ").slice(0, 200) : null;
  return {
    text: JSON.stringify(key),
    thumbprint: keyThumbprint(key),
    info
  };
}
async function revokeReplaced(db, replacedId, newId) {
  if (!replacedId) return;
  const old = await one(db, "SELECT * FROM attendance_devices WHERE id=? AND status IN('ACTIVE','PENDING')", replacedId);
  if (!old || old.id === newId) return;
  await run(db, "UPDATE attendance_devices SET status='REVOKED',revoked_at=?,revoke_reason=?,registration_token_hash=NULL,updated_at=?,row_version=row_version+1 WHERE id=?", now(), "Diganti pendaftaran baru di HP yang sama", now(), old.id);
}
async function activateDevice(db, b, key, replacedId, requestId) {
  const d = await pendingByToken(db, b?.token);
  assert(!d.public_key, invalidRegistration, 404);
  assert(!await one(db, "SELECT id FROM attendance_devices WHERE key_thumbprint=?", key.thumbprint), "HP ini sudah terdaftar. Muat ulang halaman absen.", 409);
  if (d.kind === "PERSONAL") assert((await attendancePeople(db, "e.id=?", d.owner_employee_id)).length, "Pemilik HP ini tidak aktif. Minta tautan baru kepada SDM.", 409);
  const stamp = now();
  const row = await update(db, "attendance_devices", d.id, d.row_version, {
    status: "ACTIVE",
    public_key: key.text,
    key_thumbprint: key.thumbprint,
    activated_at: stamp,
    registration_token_hash: null,
    registration_expires_at: null,
    client_info: key.info
  });
  await revokeReplaced(db, replacedId, row.id);
  await audit(db, {
    id: null,
    request_id: requestId || randomUUID3()
  }, "ACTIVATE", "attendance_devices", row.id, {
    kind: row.kind,
    replaced: replacedId || null
  });
  return {
    device_id: row.id,
    status: row.status,
    server_time: stamp
  };
}
async function openSession(db, token) {
  assert(typeof token === "string" && tokenPattern.test(token), invalidSession, 404);
  const s = await one(db, "SELECT * FROM attendance_registration_sessions WHERE token_hash=? AND closed_at IS NULL", digest(token));
  assert(s && s.expires_at > now(), invalidSession, 404);
  return s;
}
async function sessionPreview(db, b) {
  const s = await openSession(db, b?.token);
  return {
    unit: {
      id: s.org_unit_id,
      name: await unitName(db, s.org_unit_id)
    },
    expires_at: s.expires_at,
    people: (await unitPeople(db, s.org_unit_id)).map(personView)
  };
}
async function sessionRegister(db, b, key, replacedId, requestId) {
  const s = await openSession(db, b?.token);
  assert(typeof b.employee_id === "string" && b.employee_id.length <= 100, "Pilih nama Anda terlebih dahulu.", 422);
  const person = (await unitPeople(db, s.org_unit_id)).find((p) => p.id === b.employee_id);
  assert(person, "Nama tidak ada di unit sesi ini. Tanyakan kepada SDM.", 422);
  assert(!await one(db, "SELECT id FROM attendance_devices WHERE key_thumbprint=?", key.thumbprint), "HP ini sudah terdaftar. Muat ulang halaman absen.", 409);
  const row = await insert(db, "attendance_devices", {
    kind: "PERSONAL",
    owner_employee_id: person.id,
    status: "PENDING",
    session_id: s.id,
    public_key: key.text,
    key_thumbprint: key.thumbprint,
    client_info: key.info,
    created_by: null
  });
  await revokeReplaced(db, replacedId, row.id);
  await audit(db, {
    id: null,
    request_id: requestId || randomUUID3()
  }, "SESSION_REGISTER", "attendance_devices", row.id, {
    session_id: s.id,
    replaced: replacedId || null
  });
  return {
    device_id: row.id,
    status: row.status,
    server_time: now()
  };
}
function parseSignedRequest(body) {
  assert(body && typeof body === "object" && !Array.isArray(body), "Permintaan tidak valid.", 400);
  assert(typeof body.device_id === "string" && uuid.test(body.device_id), unknownDevice, 401);
  assert(Number.isSafeInteger(body.ts) && body.ts > 0, "Waktu permintaan tidak valid.", 400);
  assert(typeof body.sig === "string" && /^[A-Za-z0-9_-]{86}$/.test(body.sig), unknownDevice, 401);
  assert(typeof body.payload === "string" && body.payload.length <= 43e4, "Permintaan terlalu besar.", 413);
  let payload;
  try {
    payload = JSON.parse(body.payload);
  } catch {
    throw new AppError(400, "Permintaan tidak valid.");
  }
  assert(payload && typeof payload === "object" && !Array.isArray(payload), "Permintaan tidak valid.", 400);
  return {
    deviceId: body.device_id.toLowerCase(),
    ts: body.ts,
    sig: body.sig,
    raw: body.payload,
    payload
  };
}
async function signingDevice(db, deviceId) {
  return await one(db, "SELECT id,kind,status,public_key FROM attendance_devices WHERE id=?", deviceId) || null;
}
async function verifySignedRequest(action, auth, device, nowMs = Date.now()) {
  assert(device && device.public_key, unknownDevice, 401);
  if (Math.abs(nowMs - auth.ts) > attendanceRules.signatureSkewMinutes * 6e4) throw new AppError(401, "Jam HP berbeda jauh dari jam server. Halaman akan mencoba lagi.", {
    code: "CLOCK",
    server_time: new Date(nowMs).toISOString()
  });
  assert(await verifySignature(device.public_key, signatureMessage(action, auth.deviceId, auth.ts, auth.raw), auth.sig), unknownDevice, 401);
  return true;
}
async function activeDevice(db, deviceId) {
  const d = await one(db, "SELECT * FROM attendance_devices WHERE id=?", deviceId);
  assert(d, unknownDevice, 401);
  assert(d.status === "ACTIVE", d.status === "PENDING" ? "HP ini menunggu persetujuan SDM." : "HP ini sudah tidak aktif untuk absen. Minta SDM mendaftarkannya lagi.", 403);
  if (d.kind === "PERSONAL") assert((await attendancePeople(db, "e.id=?", d.owner_employee_id)).length, "Pemilik HP ini tidak aktif. Minta SDM mendaftarkan HP ini lagi.", 403);
  return d;
}
async function admitDeviceAction(db, action, deviceId) {
  const d = await one(db, "SELECT * FROM attendance_devices WHERE id=?", deviceId);
  assert(d, unknownDevice, 401);
  return {
    allowed: await takeDeviceSlot(db, action, d)
  };
}
async function openIn(db, employeeId, nowMs) {
  return await one(db, `SELECT * FROM attendance_events e WHERE e.employee_id=? AND e.kind='IN' AND e.recorded_at>=?
  AND NOT EXISTS(SELECT 1 FROM attendance_events o WHERE o.pair_event_id=e.id)
  AND NOT EXISTS(SELECT 1 FROM attendance_corrections c WHERE c.void_event_id=e.id AND c.revoked_at IS NULL)
  ORDER BY e.recorded_at DESC LIMIT 1`, employeeId, new Date(nowMs - attendanceRules.sessionHours * HOUR).toISOString()) || null;
}
async function deviceContext(db, deviceId, nowMs = Date.now()) {
  const d = await one(db, "SELECT * FROM attendance_devices WHERE id=?", deviceId);
  assert(d, unknownDevice, 401);
  const view = await deviceView(db, d), base = {
    server_time: new Date(nowMs).toISOString(),
    device: view
  };
  if (d.status !== "ACTIVE") return base;
  if (d.kind === "PERSONAL" && !(await attendancePeople(db, "e.id=?", d.owner_employee_id)).length) return {
    ...base,
    device: {
      ...view,
      status: "REVOKED"
    }
  };
  const since = new Date(nowMs - 30 * 24 * HOUR).toISOString();
  const recentIds = (await all(db, "SELECT employee_id,max(recorded_at) last_at FROM attendance_events WHERE device_id=? AND recorded_at>=? GROUP BY employee_id ORDER BY last_at DESC LIMIT 15", d.id, since)).map((r) => r.employee_id);
  const everyone = new Map((await attendancePeople(db)).map((p) => [p.id, p]));
  const people = [], seen = /* @__PURE__ */ new Set(), add = (p, group) => {
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      people.push({
        ...personView(p),
        group
      });
    }
  };
  if (d.kind === "PERSONAL") add(everyone.get(d.owner_employee_id), "owner");
  for (const id of recentIds) add(everyone.get(id), "recent");
  const unit = view.unit?.id;
  if (unit) {
    const units = new Set(await unitTree(db, unit));
    for (const p of everyone.values()) if (people.length < 120 && units.has(p.org_unit_id)) add(p, "unit");
  }
  const history = d.kind === "PERSONAL" ? (await all(db, `SELECT kind,recorded_at,work_date,point_name,within_point FROM attendance_events WHERE employee_id=? AND recorded_at>=? ORDER BY recorded_at DESC LIMIT 80`, d.owner_employee_id, since)).map((r) => ({
    ...r,
    within_point: Number(r.within_point) === 1
  })) : [];
  const points = Number((await one(db, "SELECT count(*) n FROM attendance_points WHERE is_active=1"))?.n || 0);
  return {
    ...base,
    people,
    history,
    points_ready: points > 0
  };
}
async function searchPeople(db, deviceId, query) {
  await activeDevice(db, deviceId);
  const q = typeof query === "string" ? query.toLowerCase().replace(/[%_\\]/g, " ").replace(/\s+/g, " ").trim() : "";
  assert(q.length >= 3 && q.length <= 40, "Ketik minimal 3 huruf nama.", 422);
  return {
    people: (await attendancePeople(db, "lower(e.full_name) LIKE ?", `%${q}%`)).slice(0, 15).map(personView)
  };
}
async function personStatus(db, deviceId, employeeId, nowMs = Date.now()) {
  await activeDevice(db, deviceId);
  assert(typeof employeeId === "string" && employeeId.length <= 100, "Pilih nama terlebih dahulu.", 422);
  const person = (await attendancePeople(db, "e.id=?", employeeId))[0];
  assert(person, "Nama tidak ditemukan atau pegawai tidak aktif.", 404);
  const open = await openIn(db, employeeId, nowMs);
  const last = await one(db, "SELECT kind,recorded_at FROM attendance_events WHERE employee_id=? AND work_date=? ORDER BY recorded_at DESC LIMIT 1", employeeId, witaDate(nowMs));
  return {
    employee: personView(person),
    suggested: open ? "OUT" : "IN",
    open_since: open?.recorded_at || null,
    last_today: last || null,
    server_time: new Date(nowMs).toISOString()
  };
}
var numeric = (v, min, max) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
function checkSubmission(payload) {
  const p = payload || {};
  assert(typeof p.client_key === "string" && uuid.test(p.client_key), "Kiriman tidak valid. Muat ulang halaman.", 400);
  assert(typeof p.employee_id === "string" && p.employee_id.length > 0 && p.employee_id.length <= 100, "Pilih nama terlebih dahulu.", 422);
  assert(["IN", "OUT"].includes(p.kind), "Pilih MASUK atau PULANG.", 422);
  const l = p.location;
  assert(l && typeof l === "object" && numeric(l.latitude, -90, 90) && numeric(l.longitude, -180, 180) && numeric(l.accuracy, 0, 1e5) && numeric(l.age_ms, -6e4, 36e5), "Lokasi HP belum didapat. Nyalakan Lokasi lalu coba lagi.", 422);
  assert(l.age_ms <= attendanceRules.locationMaxAgeMinutes * 6e4, "Lokasi sudah lama diambil. Coba absen lagi.", 422);
  const photo = p.photo;
  assert(photo && typeof photo === "object" && photo.mime_type === "image/jpeg" && typeof photo.data === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(photo.data), "Selfie wajib diambil dari kamera.", 422);
  assert(numeric(photo.age_ms, -6e4, 36e5) && photo.age_ms <= attendanceRules.photoMaxAgeMinutes * 6e4, "Selfie sudah lama diambil. Ambil selfie lagi.", 422);
  const bytes = Buffer3.from(photo.data, "base64");
  assert(bytes.length > 0 && bytes.length <= attendanceRules.photoMaxBytes, "Ukuran selfie terlalu besar. Coba lagi.", 413);
  assert(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255, "Selfie wajib diambil dari kamera.", 422);
  let outside = null;
  if (p.outside != null) {
    assert(typeof p.outside === "object" && ["DINAS_LUAR", "TUGAS_LAPANGAN", "LAINNYA"].includes(p.outside.reason), "Pilih alasan absen di luar titik.", 422);
    const note = typeof p.outside.note === "string" ? p.outside.note.trim().slice(0, 300) : "";
    assert(p.outside.reason !== "LAINNYA" || note.length >= 3, "Tuliskan alasan absen di luar titik.", 422);
    outside = {
      reason: p.outside.reason,
      note: note || null
    };
  }
  return {
    client_key: p.client_key.toLowerCase(),
    employee_id: p.employee_id,
    kind: p.kind,
    confirmed_order: p.confirmed_order === true,
    location: {
      latitude: l.latitude,
      longitude: l.longitude,
      accuracy: l.accuracy,
      age_ms: Math.max(0, l.age_ms)
    },
    outside,
    bytes,
    checksum: createHash3("sha256").update(bytes).digest("hex")
  };
}
var activePoints = async (db) => await all(db, "SELECT * FROM attendance_points WHERE is_active=1 ORDER BY name,id");
async function receiptOf(db, e, duplicate = false) {
  const person = await one(db, "SELECT full_name FROM employees WHERE id=?", e.employee_id);
  return {
    event_id: e.id,
    kind: e.kind,
    recorded_at: e.recorded_at,
    work_date: e.work_date,
    employee: {
      id: e.employee_id,
      name: person?.full_name || ""
    },
    point_name: e.point_name || null,
    distance_m: e.distance_m == null ? null : Number(e.distance_m),
    within_point: Number(e.within_point) === 1,
    duplicate
  };
}
function outsideError(match) {
  return new AppError(422, `Anda ${match.distance} m dari ${match.point.name}, di luar titik absen. Pilih alasan lalu kirim lagi.`, {
    code: "OUTSIDE_POINT",
    point_name: match.point.name,
    distance_m: match.distance
  });
}
async function prepareSubmission(db, deviceId, input, nowMs = Date.now()) {
  await activeDevice(db, deviceId);
  const dup = await one(db, "SELECT * FROM attendance_events WHERE device_id=? AND client_key=?", deviceId, input.client_key);
  if (dup) {
    assert(dup.employee_id === input.employee_id && dup.kind === input.kind, "Kiriman bentrok dengan absen sebelumnya. Muat ulang halaman.", 409);
    return {
      duplicate: true,
      receipt: await receiptOf(db, dup, true)
    };
  }
  assert((await attendancePeople(db, "e.id=?", input.employee_id)).length, "Nama tidak ditemukan atau pegawai tidak aktif.", 404);
  const match = matchPoint(await activePoints(db), input.location.latitude, input.location.longitude);
  if (match && !match.within && !input.outside) throw outsideError(match);
  return {
    duplicate: false
  };
}
async function recordSubmission(db, deviceId, input, stored, nowMs = Date.now()) {
  const d = await activeDevice(db, deviceId);
  const dup = await one(db, "SELECT * FROM attendance_events WHERE device_id=? AND client_key=?", deviceId, input.client_key);
  if (dup) {
    assert(dup.employee_id === input.employee_id && dup.kind === input.kind, "Kiriman bentrok dengan absen sebelumnya. Muat ulang halaman.", 409);
    return await receiptOf(db, dup, true);
  }
  const person = (await attendancePeople(db, "e.id=?", input.employee_id))[0];
  assert(person, "Nama tidak ditemukan atau pegawai tidak aktif.", 404);
  const points = await activePoints(db), match = matchPoint(points, input.location.latitude, input.location.longitude);
  if (match && !match.within && !input.outside) throw outsideError(match);
  const recordedAt = new Date(nowMs).toISOString(), open = await openIn(db, person.id, nowMs);
  const current = {
    recorded_at: recordedAt,
    latitude: input.location.latitude,
    longitude: input.location.longitude,
    accuracy_m: input.location.accuracy
  };
  const previous = await one(db, "SELECT recorded_at,latitude,longitude,accuracy_m FROM attendance_events WHERE employee_id=? AND recorded_at>=? ORDER BY recorded_at DESC LIMIT 1", person.id, new Date(nowMs - attendanceRules.jumpWindowHours * HOUR).toISOString());
  const flags = [];
  if (!match) flags.push("TITIK_BELUM_ADA");
  else if (!match.within) flags.push("DI_LUAR_TITIK");
  if (input.location.accuracy > attendanceRules.accuracyLimit) flags.push("GPS_KURANG_AKURAT");
  if (jumped(previous, current)) flags.push("LOKASI_MELOMPAT");
  if (input.kind === "OUT" && !open) flags.push("TANPA_MASUK");
  if (d.kind === "PERSONAL") {
    const others = (await all(db, "SELECT DISTINCT employee_id FROM attendance_events WHERE device_id=? AND recorded_at>=? AND employee_id<>?", d.id, new Date(nowMs - attendanceRules.crowdedMinutes * 6e4).toISOString(), person.id)).length;
    if (others + 1 >= attendanceRules.crowdedPeople) flags.push("HP_PRIBADI_RAMAI");
  }
  if (!await one(db, "SELECT id FROM attendance_reference_photos WHERE employee_id=?", person.id) && !await one(db, "SELECT id FROM attendance_events WHERE employee_id=? LIMIT 1", person.id)) flags.push("TANPA_FOTO_ACUAN");
  const row = await insert(db, "attendance_events", {
    employee_id: person.id,
    kind: input.kind,
    recorded_at: recordedAt,
    work_date: input.kind === "OUT" && open ? open.work_date : witaDate(nowMs),
    pair_event_id: input.kind === "OUT" && open ? open.id : null,
    device_id: d.id,
    client_key: input.client_key,
    latitude: input.location.latitude,
    longitude: input.location.longitude,
    accuracy_m: input.location.accuracy,
    location_captured_at: new Date(nowMs - input.location.age_ms).toISOString(),
    point_id: match?.point.id || null,
    point_name: match?.point.name || null,
    distance_m: match ? match.distance : null,
    within_point: match?.within ? 1 : 0,
    outside_reason: match && !match.within ? input.outside.reason : null,
    outside_note: match && !match.within ? input.outside.note : null,
    photo_storage_key: stored.key,
    photo_mime: "image/jpeg",
    photo_size: input.bytes.length,
    photo_checksum: input.checksum,
    photo_deleted_at: null,
    flags: JSON.stringify(flags),
    confirmed_order: input.confirmed_order ? 1 : 0
  });
  await run(db, "UPDATE attendance_devices SET last_seen_at=? WHERE id=?", recordedAt, d.id);
  return await receiptOf(db, row);
}
async function attendanceFormRequest({ action, body, clientIp, runTx, photos, nowMs = Date.now(), requestId }) {
  assert(attendanceFormActions.includes(action), "Alamat tidak ditemukan.", 404);
  assert(await runTx(async (db) => await takeAttendanceIpSlot(db, action, clientIp)), "Terlalu banyak permintaan. Coba lagi beberapa menit kemudian.", 429);
  if (action === "registration") return await runTx(async (db) => await registrationPreview(db, body));
  if (action === "session") return await runTx(async (db) => await sessionPreview(db, body));
  if (action === "register" || action === "session-register") {
    const key = await checkRegistrationKey(body);
    let replaced = null;
    if (body.replaces != null) {
      const auth2 = parseSignedRequest(body.replaces), old = await runTx(async (db) => await signingDevice(db, auth2.deviceId));
      const token = typeof body.token === "string" ? body.token : "";
      assert(auth2.raw === JSON.stringify({
        token
      }), "Pendaftaran lama tidak dapat diganti. Muat ulang halaman.", 400);
      await verifySignedRequest("replace", auth2, old, nowMs);
      replaced = auth2.deviceId;
    }
    return await runTx(async (db) => action === "register" ? await activateDevice(db, body, key, replaced, requestId) : await sessionRegister(db, body, key, replaced, requestId));
  }
  const auth = parseSignedRequest(body), device = await runTx(async (db) => await signingDevice(db, auth.deviceId));
  await verifySignedRequest(action, auth, device, nowMs);
  assert((await runTx(async (db) => await admitDeviceAction(db, action, auth.deviceId))).allowed, "Terlalu banyak permintaan dari HP ini. Coba lagi beberapa menit kemudian.", 429);
  if (action === "context") return await runTx(async (db) => await deviceContext(db, auth.deviceId, nowMs));
  if (action === "search") return await runTx(async (db) => await searchPeople(db, auth.deviceId, auth.payload.query));
  if (action === "person") return await runTx(async (db) => await personStatus(db, auth.deviceId, auth.payload.employee_id, nowMs));
  const input = checkSubmission(auth.payload);
  const pre = await runTx(async (db) => await prepareSubmission(db, auth.deviceId, input, nowMs));
  if (pre.duplicate) return pre.receipt;
  const stored = await photos.put(input.bytes, "image/jpeg");
  let receipt;
  try {
    receipt = await runTx(async (db) => await recordSubmission(db, auth.deviceId, input, stored, nowMs), {
      lock: `portal.attendance:${input.employee_id}`
    });
  } catch (error) {
    await photos.discard(stored.key).catch(() => {
    });
    throw error;
  }
  if (receipt.duplicate) await photos.discard(stored.key).catch(() => {
  });
  return receipt;
}
var attendanceSubmitted = (action, result) => action === "submit" && result && result.duplicate === false;
async function takeRetentionLease(db, owner, nowMs, throttleHours, force) {
  const until = new Date(nowMs + 5 * 6e4).toISOString(), stamp = new Date(nowMs).toISOString(), due = new Date(nowMs - throttleHours * HOUR).toISOString();
  const changed = await run(db, `UPDATE attendance_state SET lease_owner=?,lease_until=?,updated_at=? WHERE id=1 AND (lease_until IS NULL OR lease_until<?)
  AND (?=1 OR last_retention_at IS NULL OR last_retention_at<?)`, owner, until, stamp, stamp, force ? 1 : 0, due);
  return changed.changes === 1;
}
async function expireReferences(db, nowMs) {
  const cutoff = witaDate(nowMs - attendanceRules.referenceRetentionDays * 24 * HOUR);
  return (await run(db, "DELETE FROM attendance_reference_photos WHERE employee_id IN (SELECT id FROM employees WHERE is_active=0 AND coalesce(ended_on,substr(updated_at,1,10))<?)", cutoff)).changes;
}
async function duePhotos(db, nowMs, limit) {
  return await all(db, `SELECT id,photo_storage_key FROM attendance_events e WHERE photo_storage_key IS NOT NULL AND recorded_at<?
  AND NOT EXISTS(SELECT 1 FROM attendance_reference_photos r WHERE r.event_id=e.id) ORDER BY recorded_at LIMIT ?`, new Date(nowMs - attendanceRules.photoRetentionDays * 24 * HOUR).toISOString(), limit);
}
async function markPhotoDeleted(db, id, key) {
  return (await run(db, "UPDATE attendance_events SET photo_storage_key=NULL,photo_deleted_at=?,updated_at=?,row_version=row_version+1 WHERE id=? AND photo_storage_key=?", now(), now(), id, key)).changes;
}
async function finishRetention(db, owner, deleted, error, nowMs) {
  await run(db, `UPDATE attendance_state SET lease_owner=NULL,lease_until=NULL,last_retention_at=?,last_error=?,deleted_photos=deleted_photos+?,updated_at=? WHERE id=1 AND lease_owner=?`, new Date(nowMs).toISOString(), error ? String(error).slice(0, 300) : null, deleted, now(), owner);
}
async function runAttendanceRetention({ runTx, photos, nowMs = Date.now(), owner = randomUUID3(), limit = 200, throttleHours = 6, force = false }) {
  if (!await runTx(async (db) => await takeRetentionLease(db, owner, nowMs, throttleHours, force))) return {
    skipped: true,
    deleted: 0
  };
  let deleted = 0, error = null;
  try {
    await runTx(async (db) => await expireReferences(db, nowMs));
    for (const row of await runTx(async (db) => await duePhotos(db, nowMs, limit))) {
      try {
        await photos.remove(row.photo_storage_key);
      } catch (failure) {
        if (failure?.status !== 404) throw failure;
      }
      deleted += await runTx(async (db) => await markPhotoDeleted(db, row.id, row.photo_storage_key));
    }
  } catch (failure) {
    error = failure instanceof AppError ? failure.message : "Penghapusan selfie lama belum berhasil.";
  }
  await runTx(async (db) => await finishRetention(db, owner, deleted, error, nowMs));
  return {
    skipped: false,
    deleted,
    error
  };
}

// supabase/functions/attendance-form/index.ts
var pool;
async function transaction(client, work, options = {}) {
  return client.begin(async (sql) => {
    await sql.unsafe("SET LOCAL search_path=portal,pg_catalog; SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='15s';");
    if (options?.lock) await sql.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [options.lock]);
    return work({ inTransaction: true, query: (statement, values = []) => sql.unsafe(statement, values) });
  });
}
function drivePhotos(env) {
  const storage = createDriveStorage(env, void 0, { module: "absensi" });
  return { put: async (bytes, mime) => ({ key: await storage.put(bytes, mime) }), discard: (key) => storage.remove(key), remove: (key) => storage.remove(key) };
}
function safeDetails(details) {
  if (!details || typeof details !== "object") return void 0;
  const out = {};
  if (typeof details.code === "string" && /^[A-Z_]{2,30}$/.test(details.code)) out.code = details.code;
  if (typeof details.server_time === "string" && details.server_time.length <= 30) out.server_time = details.server_time;
  if (typeof details.point_name === "string") out.point_name = details.point_name.slice(0, 80);
  if (Number.isFinite(details.distance_m)) out.distance_m = Math.round(details.distance_m);
  return Object.keys(out).length ? out : void 0;
}
var busyCodes = ["23505", "40001", "40P01", "55P03"];
var index_default = { fetch: withSupabase({ auth: "secret" }, async (req) => {
  const requestId = randomUUID4();
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
        if (size > 48e4) {
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
    assert(b && typeof b.operation === "string" && b.body && typeof b.body === "object" && !Array.isArray(b.body), "Permintaan tidak valid.", 400);
    const env = Deno.env.toObject();
    if (!pool) pool = postgres(env.SUPABASE_DB_URL, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10, onnotice: () => {
    } });
    const runTx = (work, options) => transaction(pool, work, options);
    const result = await attendanceFormRequest({ action: b.operation, body: b.body, clientIp: b.client_ip, runTx, photos: drivePhotos(env), requestId });
    if (attendanceSubmitted(b.operation, result)) {
      const task = runAttendanceRetention({ runTx, photos: drivePhotos(env) }).catch(() => {
        console.warn(JSON.stringify({ event: "attendance_retention_failed", request_id: requestId }));
      });
      const runtime = Reflect.get(globalThis, "EdgeRuntime");
      if (runtime && typeof runtime.waitUntil === "function") runtime.waitUntil(task);
    }
    return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof AppError ? error.status : busyCodes.includes(error?.code) ? 503 : ["23502", "23503", "23514", "22P02"].includes(error?.code) ? 422 : 503;
    if (!(error instanceof AppError)) console.warn(JSON.stringify({ event: "attendance_form_error", request_id: requestId, code: typeof error?.code === "string" ? error.code : null }));
    const message = error instanceof AppError ? error.message : busyCodes.includes(error?.code) ? "Absen sedang diproses bersamaan. Coba kirim lagi." : "Absen belum dapat dikonfirmasi. Coba kirim lagi.";
    const details = error instanceof AppError ? safeDetails(error.details) : void 0;
    return Response.json({ ok: false, error: message, request_id: requestId, ...details ? { details } : {} }, { status, headers: { "Cache-Control": "no-store" } });
  }
}) };
export {
  index_default as default
};
