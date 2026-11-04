// supabase/functions/guide-form/index.ts
import { withSupabase } from "npm:@supabase/server@1";
import postgres from "npm:postgres@3.4.7";
import { randomUUID as randomUUID3 } from "node:crypto";

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
async function ingestGuideEvaluations(db, link, items, nowMs = Date.now()) {
  const accepted = [], rejected = [];
  const receivedAt = new Date(nowMs).toISOString(), oldest = nowMs - visitRules.umurMaksHari * 864e5;
  for (const item of items) {
    const id = item.evaluationId.toLowerCase();
    const reject = (reason, message, extra = {}) => {
      rejected.push({
        evaluationId: item.evaluationId,
        errors: [message],
        reason,
        ...extra
      });
    };
    if (await one(db, "SELECT id FROM visit_evaluations WHERE id=?", id)) {
      accepted.push({
        evaluationId: item.evaluationId,
        duplicate: true
      });
      continue;
    }
    const clientMs = Date.parse(item.timestamp);
    if (clientMs < oldest) {
      reject("WAKTU", `Penilaian ini tertahan di HP lebih dari ${visitRules.umurMaksHari} hari, jadi tidak bisa dikirim lewat tautan pos. Ekspor riwayat dari HP lalu serahkan ke pengelola kunjungan.`);
      continue;
    }
    const ms = Math.min(clientMs, nowMs), evaluatedAt = new Date(ms).toISOString(), day = witaDate(ms);
    const guide = await one(db, "SELECT id,name FROM visit_guides WHERE id=?", item.guideId);
    if (!guide) {
      reject("GUIDE", `Guide ${item.guideId} tidak terdaftar di Data Guide portal. Muat ulang daftar guide di HP lalu nilai ulang.`);
      continue;
    }
    const replaces = item.koreksiDari ? item.koreksiDari.toLowerCase() : null;
    if (replaces) {
      const original = await one(db, "SELECT id,guide_id,pos,wita_date,status FROM visit_evaluations WHERE id=?", replaces);
      if (!original) {
        reject("KOREKSI", `Penilaian yang diperbaiki (${item.koreksiDari}) tidak ada di server.`);
        continue;
      }
      if (original.status !== "aktif") {
        reject("KOREKSI", "Penilaian itu sudah pernah diperbaiki oleh penilaian lain.");
        continue;
      }
      if (original.guide_id !== guide.id || Number(original.pos) !== link.pos || original.wita_date !== day) {
        reject("KOREKSI", "Koreksi harus untuk guide, pos, dan tanggal yang sama.");
        continue;
      }
      await run(db, "UPDATE visit_evaluations SET status='diganti',replaced_by=?,sheet_dirty=CASE WHEN sheet_row IS NULL THEN 0 ELSE 1 END,sheet_verified_at=NULL WHERE id=? AND status='aktif'", id, original.id);
    } else {
      const low = new Date(ms - visitRules.jedaMenit * 6e4).toISOString(), high = new Date(ms + visitRules.jedaMenit * 6e4).toISOString();
      const clash = await one(db, "SELECT id,evaluated_at FROM visit_evaluations WHERE guide_id=? AND pos=? AND status='aktif' AND evaluated_at>? AND evaluated_at<? ORDER BY evaluated_at LIMIT 1", guide.id, link.pos, low, high);
      if (clash) {
        const minutes = Math.round(Math.abs(Date.parse(clash.evaluated_at) - ms) / 6e4);
        reject("JEDA", `${guide.name} baru saja dinilai di Pos ${link.pos} (${minutes} menit dari penilaian ini) \u2014 jeda minimal ${visitRules.jedaMenit} menit, jadi ini hampir pasti salah pencet. Kalau memang pengantaran berikutnya, tunggu jedanya habis. Untuk membetulkan nilainya, kirim koreksi.`, {
          terlaluCepat: true,
          sudahDinilai: true,
          aktifSaatIni: clash.id
        });
        continue;
      }
    }
    const c = item.criteria, etika = Math.min(5, Math.max(-5, Math.round(Number(c.etika) || 0)));
    await run(db, `INSERT INTO visit_evaluations(id,link_id,pos,guide_id,guide_name,uniform,id_card,review,etika,catatan,evaluated_at,wita_date,received_at,koreksi_dari,status)
   VALUES(?,?,?,?,?,?,?,0,?,?,?,?,?,?,'aktif')`, id, link.id, link.pos, guide.id, guide.name, c.uniform, c.idCard ? 1 : 0, etika, String(item.catatan || "").slice(0, 500), evaluatedAt, day, receivedAt, replaces);
    accepted.push({
      evaluationId: item.evaluationId,
      duplicate: false
    });
  }
  return {
    accepted,
    rejected
  };
}
var formGuideList = async (db) => (await all(db, "SELECT id,name,kategori,regu FROM visit_guides WHERE is_active=1 ORDER BY name,seq")).map((g) => ({
  guideId: g.id,
  guideName: g.name,
  kategori: g.kategori,
  regu: g.regu
}));
var historyRules = Object.freeze({
  mulai: "2026-01-01",
  barisPerBagian: 800,
  bagianMaks: 200,
  barisMaks: 1e5,
  catatanMaks: 100
});
var historyReasons = Object.freeze({
  MASUK: "Masuk ke rekap",
  DIGANTI: "Dilewati: sudah dikoreksi (status diganti), sama dengan rekap NilaiGuide",
  POS2: "Dilewati: Pos 2 (riwayat Pos 2 tidak diimpor)",
  BENTROK: "Dilewati: guide dan pos yang sama sudah dinilai lewat portal dalam jeda 15 menit",
  DUPLIKAT: "Dilewati: evaluationId sama dengan baris lain di berkas",
  ID: "Ditolak: evaluationId bukan UUID",
  TANGGAL: "Ditolak: timestamp kosong, tidak terbaca, atau di luar 1 Januari 2026 sampai hari ini",
  POS: "Ditolak: pos bukan 1 atau 3",
  GUIDE: "Ditolak: guideId tidak terdaftar di Data Guide",
  ID_PORTAL: "Ditolak: evaluationId sama dengan penilaian yang sudah ada di portal"
});
var historyReasonKeys = Object.keys(historyReasons);

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
var guideFormContext = async (db, link) => ({
  pos: link.pos,
  label: link.label,
  serverTime: now(),
  guides: await formGuideList(db)
});
async function submitGuideForm(db, admitted, nowMs = Date.now()) {
  return admitted.items.length ? await ingestGuideEvaluations(db, admitted.link, admitted.items, nowMs) : {
    accepted: [],
    rejected: []
  };
}
var localReason = (errors) => {
  const text = (errors || []).join(" ");
  return /^pos penilaian/.test(text) ? "POS" : /timestamp/.test(text) ? "WAKTU" : "VALIDASI";
};
function ipFingerprint(clientIp, key) {
  return typeof key === "string" && key.length >= 32 ? createHmac("sha256", key).update(String(clientIp)).digest("hex") : null;
}
async function recordGuideFormResult(db, admitted, result, ipHash) {
  const stamp = now(), link = admitted.link;
  await run(db, "DELETE FROM guide_form_submissions WHERE received_at<?", new Date(Date.now() - guideFormLimits.retentionDays * 864e5).toISOString());
  const rows = [...result.accepted.map((a) => [a.evaluationId, a.duplicate ? "DUPLICATE" : "ACCEPTED", null]), ...admitted.rejected.filter((r) => r.evaluationId).map((r) => [r.evaluationId, "REJECTED", localReason(r.errors)]), ...result.rejected.map((r) => [r.evaluationId, "REJECTED", r.reason])];
  for (const [evaluationId, outcome, reason] of rows) if (typeof evaluationId === "string" && uuid.test(evaluationId)) await insert(db, "guide_form_submissions", {
    link_id: link.id,
    pos: link.pos,
    evaluation_id: evaluationId.toLowerCase(),
    outcome,
    reason,
    received_at: stamp,
    ip_hmac: ipHash
  });
  return rows.length;
}
function guideFormReceipt(admitted, result) {
  return {
    accepted: result.accepted.map((a) => ({
      evaluationId: a.evaluationId,
      synced: true,
      duplicate: a.duplicate === true
    })),
    rejected: [...admitted.rejected.map(({ local, ...r }) => r), ...result.rejected.map(({ reason, ...r }) => r)],
    serverTime: now()
  };
}

// supabase/functions/_shared/portal/visit-sheets.mjs
import { createHash as createHash2, randomUUID as randomUUID2 } from "node:crypto";
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
  const { runTx } = ctx, range = encodeURIComponent(`${quoteTab(tab.title)}!A2:A${Math.max(2, tab.rowCount)}`);
  const data = await ctx.google.read(`${sheetsApi}/${encodeURIComponent(file.spreadsheet_id)}/values/${range}?majorDimension=COLUMNS&valueRenderOption=UNFORMATTED_VALUE`, "sheet-read");
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
  for (const g of await all(db, `SELECT wita_date AS day,guide_id,pos,count(*) AS antar,sum(uniform) AS uniform,sum(CASE WHEN uniform>=1 THEN 1 ELSE 0 END) AS uniform_patuh,sum(id_card) AS id_card,sum(review) AS review,sum(etika) AS etika FROM visit_evaluations WHERE status='aktif' AND wita_date<=? GROUP BY wita_date,guide_id,pos`, through)) await run(db, `INSERT INTO visit_daily_totals(day,guide_id,pos,sumber,antar,uniform,uniform_patuh,id_card,review,etika,updated_at) VALUES(?,?,?,'portal',?,?,?,?,?,?,?)
   ON CONFLICT(day,guide_id,pos,sumber) DO UPDATE SET antar=visit_daily_totals.antar+excluded.antar,uniform=visit_daily_totals.uniform+excluded.uniform,uniform_patuh=visit_daily_totals.uniform_patuh+excluded.uniform_patuh,
   id_card=visit_daily_totals.id_card+excluded.id_card,review=visit_daily_totals.review+excluded.review,etika=visit_daily_totals.etika+excluded.etika,updated_at=excluded.updated_at`, g.day, g.guide_id, Number(g.pos), Number(g.antar), Number(g.uniform), Number(g.uniform_patuh), Number(g.id_card), Number(g.review), Number(g.etika), stamp);
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
async function syncVisitSheetAfterSubmit(options) {
  let result = await runVisitSheetSync({
    ...options,
    trigger: "auto"
  });
  for (let attempt = 0; attempt < 2 && (result.throttled || result.busy); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(Number(result.retry_after_ms) || 0, 1e3) + 500, 3e4)));
    result = await runVisitSheetSync({
      ...options,
      trigger: "auto"
    });
  }
  return result;
}

// supabase/functions/guide-form/index.ts
var pool;
async function transaction(client, work, ingest = false) {
  return client.begin(async (sql) => {
    await sql.unsafe("SET LOCAL search_path=portal,pg_catalog; SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='15s';");
    if (ingest) await sql.unsafe("SELECT pg_advisory_xact_lock(hashtextextended('portal.visits.guide_evaluations',0))");
    return work({ inTransaction: true, query: (statement, values = []) => sql.unsafe(statement, values) });
  });
}
var busyCodes = ["23505", "40001", "40P01", "55P03"];
var index_default = { fetch: withSupabase({ auth: "secret" }, async (req) => {
  const requestId = randomUUID3();
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
    const ipOk = await transaction(pool, (db) => takeGuideFormIpSlot(db, b.operation, b.client_ip, b.body));
    assert(ipOk, "Terlalu banyak kiriman. Coba lagi beberapa menit kemudian.", 429);
    const outcome = await transaction(pool, async (db) => {
      const admitted = await admitGuideForm(db, b.operation, b.body);
      if (admitted.limited) return admitted;
      if (b.operation === "context") return { context: await guideFormContext(db, admitted.link) };
      const result = await submitGuideForm(db, admitted);
      await recordGuideFormResult(db, admitted, result, ipFingerprint(b.client_ip, env.VISITS_IP_HMAC_KEY));
      return { receipt: guideFormReceipt(admitted, result), fresh: result.accepted.some((a) => !a.duplicate) };
    }, b.operation === "submit");
    assert(!outcome.limited, "Terlalu banyak kiriman. Coba lagi beberapa menit kemudian.", 429);
    if (outcome.context) return Response.json({ ok: true, result: outcome.context }, { headers: { "Cache-Control": "no-store" } });
    if (outcome.fresh && visitSheetConfig(env).configured) {
      const task = syncVisitSheetAfterSubmit({ runTx: (work) => transaction(pool, work), env }).catch(() => {
        console.warn(JSON.stringify({ event: "visit_sheet_background_failed", request_id: requestId }));
      });
      const runtime = Reflect.get(globalThis, "EdgeRuntime");
      if (runtime && typeof runtime.waitUntil === "function") runtime.waitUntil(task);
    }
    return Response.json({ ok: true, result: outcome.receipt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof AppError ? error.status : busyCodes.includes(error?.code) ? 503 : ["23502", "23503", "23514", "22P02"].includes(error?.code) ? 422 : 503;
    if (!(error instanceof AppError)) console.warn(JSON.stringify({ event: "guide_form_error", request_id: requestId, code: typeof error?.code === "string" ? error.code : null }));
    return Response.json({ ok: false, error: error instanceof AppError ? error.message : busyCodes.includes(error?.code) ? "Kiriman sedang diproses bersamaan. HP akan mencoba lagi." : "Kiriman belum dapat dikonfirmasi. HP akan mencoba lagi.", request_id: requestId }, { status, headers: { "Cache-Control": "no-store" } });
  }
}) };
export {
  index_default as default
};
