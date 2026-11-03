// supabase/functions/guide-form/index.ts
import { withSupabase } from "npm:@supabase/server@1";
import postgres from "npm:postgres@3.4.7";
import { randomUUID as randomUUID2 } from "node:crypto";

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

// supabase/functions/_shared/portal/guide-form.mjs
import { createHmac } from "node:crypto";

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

// supabase/functions/_shared/portal/guide-form.mjs
var guidePosts = {
  1: "Pos 1 \u2014 Pintu Masuk",
  3: "Pos 3 \u2014 Pelataran Utama"
};
var guideFormLimits = {
  context: 60,
  submit: 300,
  windowMinutes: 10,
  batch: 20,
  retentionDays: 90
};
var invalidGuideLink = "Tautan pos tidak aktif. Minta tautan pos terbaru kepada pengelola kunjungan.";
var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var guideId = /^G-\d{1,7}$/;
var actions = ["context", "submit"];
async function takeSlot(db, key, amount, limit) {
  const stamp = now(), cutoff = new Date(Date.now() - guideFormLimits.windowMinutes * 6e4).toISOString();
  const row = await one(db, `INSERT INTO guide_form_rate_limits(id,window_start,hits) VALUES(?,?,?)
  ON CONFLICT(id) DO UPDATE SET hits=CASE WHEN guide_form_rate_limits.window_start<? THEN excluded.hits ELSE guide_form_rate_limits.hits+excluded.hits END,
  window_start=CASE WHEN guide_form_rate_limits.window_start<? THEN excluded.window_start ELSE guide_form_rate_limits.window_start END
  RETURNING hits`, digest(key), stamp, amount, cutoff, cutoff);
  return Number(row.hits) <= limit;
}
function batchSize(action, b) {
  return action === "submit" && Array.isArray(b?.evaluations) ? Math.min(Math.max(b.evaluations.length, 1), guideFormLimits.batch) : 1;
}
async function takeGuideFormIpSlot(db, action, clientIp, b) {
  assert(actions.includes(action), "Alamat tidak ditemukan.", 404);
  assert(typeof clientIp === "string" && clientIp.length <= 45 && /^[a-f0-9:.]+$/i.test(clientIp), "Permintaan tidak valid.", 400);
  await run(db, "DELETE FROM guide_form_rate_limits WHERE window_start<?", new Date(Date.now() - 24 * 36e5).toISOString());
  return await takeSlot(db, `guide-form\0${action}\0ip\0${clientIp}`, batchSize(action, b), guideFormLimits[action]);
}
function checkGuideItem(item, pos) {
  const errors = [];
  if (!item || typeof item !== "object" || Array.isArray(item)) return ["penilaian tidak valid"];
  if (typeof item.evaluationId !== "string" || !uuid.test(item.evaluationId)) errors.push("evaluationId harus UUID");
  if (typeof item.guideId !== "string" || !guideId.test(item.guideId.trim())) errors.push("guideId tidak valid");
  if (typeof item.guideName !== "string" || !item.guideName.trim() || item.guideName.length > 200) errors.push("guideName wajib");
  if (Number(item.pos) !== pos) errors.push(`pos penilaian harus sama dengan pos tautan (Pos ${pos})`);
  if (typeof item.timestamp !== "string" || !/(Z|[+-]\d\d:\d\d)$/.test(item.timestamp) || isNaN(Date.parse(item.timestamp))) errors.push("timestamp harus ISO8601 dengan zona waktu");
  const c = item.criteria;
  if (!c || typeof c !== "object" || Array.isArray(c)) errors.push("criteria wajib");
  else {
    if (typeof c.idCard !== "boolean") errors.push("criteria.idCard harus Ya/Tidak");
    if (![-1, 1, 2].includes(c.uniform)) errors.push("criteria.uniform harus -1, 1, atau 2");
    if (c.etika !== void 0 && c.etika !== null && !(Number.isInteger(c.etika) && c.etika >= -5 && c.etika <= 5)) errors.push("criteria.etika harus bilangan bulat -5 sampai 5");
  }
  if (item.catatan !== void 0 && item.catatan !== null && (typeof item.catatan !== "string" || item.catatan.length > 500)) errors.push("catatan maksimal 500 huruf");
  if (item.koreksiDari !== void 0 && item.koreksiDari !== null && item.koreksiDari !== "" && (typeof item.koreksiDari !== "string" || !uuid.test(item.koreksiDari) || item.koreksiDari === item.evaluationId)) errors.push("koreksiDari tidak valid");
  return errors;
}
var cleanItem = (item) => {
  const out = {
    evaluationId: item.evaluationId,
    guideId: item.guideId.trim(),
    guideName: item.guideName.trim(),
    pos: Number(item.pos),
    timestamp: item.timestamp,
    criteria: {
      idCard: item.criteria.idCard,
      uniform: item.criteria.uniform,
      etika: item.criteria.etika ?? 0
    },
    catatan: typeof item.catatan === "string" ? item.catatan : ""
  };
  if (item.koreksiDari) out.koreksiDari = item.koreksiDari;
  return out;
};
async function admitGuideForm(db, action, b) {
  assert(actions.includes(action), "Alamat tidak ditemukan.", 404);
  assert(b && typeof b === "object" && typeof b.token === "string" && /^[a-f0-9]{64}$/.test(b.token), invalidGuideLink, 404);
  const link = await one(db, "SELECT id,pos,label FROM guide_form_links WHERE token_hash=? AND is_active=1 AND revoked_at IS NULL", digest(b.token));
  assert(link, invalidGuideLink, 404);
  const pos = Number(link.pos), items = [], rejected = [];
  if (action === "submit") {
    assert(Array.isArray(b.evaluations) && b.evaluations.length > 0, "Kiriman tidak berisi penilaian.", 400);
    assert(b.evaluations.length <= guideFormLimits.batch, `Maksimal ${guideFormLimits.batch} penilaian per kiriman.`, 413);
    const seen = /* @__PURE__ */ new Set();
    for (const item of b.evaluations) {
      const errors = checkGuideItem(item, pos);
      if (!errors.length && seen.has(item.evaluationId)) errors.push("evaluationId ganda dalam satu kiriman");
      if (errors.length) {
        rejected.push({
          evaluationId: typeof item?.evaluationId === "string" && uuid.test(item.evaluationId) ? item.evaluationId : null,
          errors,
          local: true
        });
        continue;
      }
      seen.add(item.evaluationId);
      items.push(cleanItem(item));
    }
  }
  const allowed = await takeSlot(db, `guide-form\0${action}\0link\0${link.id}`, batchSize(action, b), guideFormLimits[action]);
  if (!allowed) return {
    limited: true
  };
  return {
    link: {
      id: link.id,
      pos,
      label: link.label || guidePosts[pos] || `Pos ${pos}`
    },
    items,
    rejected
  };
}
var guideFormContext = (link, data) => {
  assert(Array.isArray(data?.guides), "Spreadsheet sedang tidak dapat diakses.", 503);
  return {
    pos: link.pos,
    label: link.label,
    serverTime: typeof data.serverTime === "string" ? data.serverTime : now(),
    guides: data.guides.filter((g) => g && typeof g.guideId === "string" && guideId.test(g.guideId) && typeof g.guideName === "string").map((g) => ({
      guideId: g.guideId,
      guideName: g.guideName,
      kategori: String(g.kategori || ""),
      regu: String(g.regu || "")
    }))
  };
};
var reasonCode = (errors) => {
  const text = (errors || []).join(" ");
  return /jeda minimal|terlaluCepat/.test(text) ? "JEDA" : /koreksi|diperbaiki/.test(text) ? "KOREKSI" : /tab Guides|guideId/.test(text) ? "GUIDE" : /timestamp|jam HP|hari/.test(text) ? "WAKTU" : /pos/.test(text) ? "POS" : "VALIDASI";
};
function ipFingerprint(clientIp, key) {
  return typeof key === "string" && key.length >= 32 ? createHmac("sha256", key).update(String(clientIp)).digest("hex") : null;
}
async function recordGuideFormResult(db, link, result, ipHash) {
  const stamp = now();
  await run(db, "DELETE FROM guide_form_submissions WHERE received_at<?", new Date(Date.now() - guideFormLimits.retentionDays * 864e5).toISOString());
  const rows = [...(result.accepted || []).map((a) => [a.evaluationId, a.duplicate ? "DUPLICATE" : "ACCEPTED", null]), ...(result.rejected || []).filter((r) => r.evaluationId).map((r) => [r.evaluationId, "REJECTED", reasonCode(r.errors)])];
  for (const [evaluationId, outcome, reason] of rows) if (typeof evaluationId === "string" && uuid.test(evaluationId)) await insert(db, "guide_form_submissions", {
    link_id: link.id,
    pos: link.pos,
    evaluation_id: evaluationId,
    outcome,
    reason,
    received_at: stamp,
    ip_hmac: ipHash
  });
  return rows.length;
}
function guideFormReceipt(admitted, data) {
  const accepted = Array.isArray(data?.accepted) ? data.accepted.filter((a) => a && typeof a.evaluationId === "string").map((a) => ({
    evaluationId: a.evaluationId,
    synced: true,
    duplicate: a.duplicate === true
  })) : [];
  const remote = Array.isArray(data?.rejected) ? data.rejected.filter((r) => r && typeof r === "object").map((r) => ({
    evaluationId: typeof r.evaluationId === "string" ? r.evaluationId : null,
    errors: Array.isArray(r.errors) ? r.errors.map((e) => String(e).slice(0, 500)).slice(0, 5) : ["ditolak spreadsheet"],
    ...r.terlaluCepat ? {
      terlaluCepat: true,
      sudahDinilai: true,
      aktifSaatIni: typeof r.aktifSaatIni === "string" ? r.aktifSaatIni : void 0
    } : {}
  })) : [];
  return {
    accepted,
    rejected: [...admitted.rejected.map(({ local, ...r }) => r), ...remote],
    serverTime: typeof data?.serverTime === "string" ? data.serverTime : now()
  };
}

// supabase/functions/_shared/portal/visits-bridge.mjs
var productionUrl = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/;
var localUrl = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}\/[A-Za-z0-9/_-]*$/;
var devKeyMarker = "uji-lokal";
var bridgeCodes = {
  KUNCI: [503, "Jembatan spreadsheet menolak kredensial portal. Hubungi admin portal."],
  OPERASI: [503, "Versi jembatan spreadsheet belum sesuai. Hubungi admin portal."],
  SIBUK: [503, "Spreadsheet sedang sibuk. Coba lagi sebentar."],
  GAGAL_TULIS: [503, "Spreadsheet belum dapat menyimpan. Coba lagi sebentar."],
  GALAT: [503, "Spreadsheet sedang tidak dapat diakses."],
  TIDAK_SAH: [422],
  KEMBAR: [409],
  TIDAK_ADA: [404]
};
var unavailable = "Spreadsheet sedang tidak dapat diakses.";
function bridgeConfig(env = {}, { allowLocal = false } = {}) {
  const url = typeof env.VISITS_BRIDGE_URL === "string" ? env.VISITS_BRIDGE_URL.trim() : "";
  const key = typeof env.VISITS_BRIDGE_KEY === "string" ? env.VISITS_BRIDGE_KEY.trim() : "";
  if (!url || !key) return null;
  const local = localUrl.test(url);
  if (!(productionUrl.test(url) || allowLocal && local)) return null;
  if (key.length < 48 || key.length > 256 || !local && key.includes(devKeyMarker)) return null;
  return {
    url,
    key,
    local
  };
}
async function readLimited(response, limit = 4 * 1024 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new Error("Bridge response too large");
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
  return new TextDecoder("utf-8", {
    fatal: true
  }).decode(bytes);
}
async function callBridge(config, operation, payload = {}, { fetchImpl = globalThis.fetch, timeoutMs = 24e3 } = {}) {
  assert(config, "Jembatan Google Spreadsheet belum dikonfigurasi.", 503);
  let response;
  try {
    const signal = AbortSignal.timeout(timeoutMs);
    response = await fetchImpl(config.url, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({
        operation,
        credential: config.key,
        payload
      }),
      signal
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = new URL(response.headers.get("location") || "", config.url);
      if (next.protocol !== "https:" || next.hostname !== "script.googleusercontent.com" || next.username || next.password) throw new Error("Unexpected bridge redirect");
      await response.body?.cancel();
      response = await fetchImpl(next.href, {
        method: "GET",
        redirect: "manual",
        signal
      });
    }
  } catch {
    throw new AppError(503, unavailable, {
      bridge_code: "JARINGAN"
    });
  }
  let data;
  try {
    if (response.status !== 200) throw new Error(`Bridge HTTP ${response.status}`);
    data = JSON.parse(await readLimited(response));
  } catch {
    throw new AppError(503, unavailable, {
      bridge_code: "JAWABAN"
    });
  }
  if (!data || typeof data !== "object" || typeof data.ok !== "boolean") throw new AppError(503, unavailable, {
    bridge_code: "JAWABAN"
  });
  if (data.ok) {
    assert(data.data && typeof data.data === "object" && !Array.isArray(data.data), unavailable, 503);
    return data.data;
  }
  const [status, message] = bridgeCodes[data.code] || [503, unavailable];
  throw new AppError(status, message || (typeof data.error === "string" && data.error.length <= 500 ? data.error : unavailable), {
    bridge_code: String(data.code || "GALAT").slice(0, 20)
  });
}

// supabase/functions/guide-form/index.ts
var pool;
async function transaction(client, work) {
  return client.begin(async (sql) => {
    await sql.unsafe("SET LOCAL search_path=portal,pg_catalog; SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='15s';");
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
    assert(b && ["context", "submit"].includes(b.operation) && b.body && typeof b.body === "object" && !Array.isArray(b.body), "Permintaan tidak valid.", 400);
    const env = Deno.env.toObject();
    if (!pool) pool = postgres(env.SUPABASE_DB_URL, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10, onnotice: () => {
    } });
    const bridge = bridgeConfig(env);
    const ipOk = await transaction(pool, (db) => takeGuideFormIpSlot(db, b.operation, b.client_ip, b.body));
    assert(ipOk, "Terlalu banyak kiriman. Coba lagi beberapa menit kemudian.", 429);
    const admitted = await transaction(pool, (db) => admitGuideForm(db, b.operation, b.body));
    assert(!admitted.limited, "Terlalu banyak kiriman. Coba lagi beberapa menit kemudian.", 429);
    if (b.operation === "context") {
      const data2 = await callBridge(bridge, "form.context", {}, { timeoutMs: 3e4 });
      return Response.json({ ok: true, result: guideFormContext(admitted.link, data2) }, { headers: { "Cache-Control": "no-store" } });
    }
    const data = admitted.items.length ? await callBridge(bridge, "evaluations.submit", { pos: admitted.link.pos, items: admitted.items }, { timeoutMs: 3e4 }) : { accepted: [], rejected: [] };
    const receipt = guideFormReceipt(admitted, data);
    try {
      await transaction(pool, (db) => recordGuideFormResult(db, admitted.link, receipt, ipFingerprint(b.client_ip, env.VISITS_IP_HMAC_KEY)));
    } catch {
      console.warn(JSON.stringify({ event: "guide_form_log_failed", request_id: requestId }));
    }
    return Response.json({ ok: true, result: receipt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AppError && error.details?.bridge_code) console.warn(JSON.stringify({ event: "visits_bridge_error", request_id: requestId, code: error.details.bridge_code }));
    const status = error instanceof AppError ? error.status : ["23505", "40001", "40P01", "55P03"].includes(error?.code) ? 409 : ["23502", "23503", "23514", "22P02"].includes(error?.code) ? 422 : 503;
    return Response.json({ ok: false, error: error instanceof AppError ? error.message : "Kiriman belum dapat dikonfirmasi. HP akan mencoba lagi.", request_id: requestId }, { status, headers: { "Cache-Control": "no-store" } });
  }
}) };
export {
  index_default as default
};
