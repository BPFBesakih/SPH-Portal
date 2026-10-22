import {randomBytes as quickReportRandomBytes} from 'node:crypto';
// supabase/functions/portal-api/index.ts
import { withSupabase } from "npm:@supabase/server@1";
import postgres from "npm:postgres@3.4.7";
import { createHash as createHash5, randomUUID as randomUUID5 } from "node:crypto";

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
import {Buffer} from 'node:buffer';
import {randomUUID as randomUUID3} from 'node:crypto';


const knownReasons=new Set(['invalid_grant','invalid_client','unauthorized_client','access_denied','authError','insufficientPermissions','insufficientFilePermissions','appNotAuthorizedToFile','notFound','storageQuotaExceeded','dailyLimitExceeded','userRateLimitExceeded','rateLimitExceeded','accessNotConfigured','domainPolicy','badRequest','backendError']);
async function errorReason(response){
 const reader=response.body?.getReader();if(!reader)return 'unknown';const chunks=[];let size=0;
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();return 'unknown';}chunks.push(value);}
  const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const reason=typeof body.error==='string'?body.error:body.error?.errors?.find(e=>knownReasons.has(e.reason))?.reason;
  return knownReasons.has(reason)?reason:'unknown';
 }catch{return 'unknown';}finally{reader.releaseLock();}
}
function storageError(stage,status,reason){
 let message='Penyimpanan berkas belum dapat diakses.';
 if(reason==='invalid_grant')message='Koneksi Google Drive perlu dihubungkan ulang. Token akses telah kedaluwarsa atau dicabut.';
 else if(['invalid_client','unauthorized_client'].includes(reason))message='Konfigurasi OAuth Google Drive tidak valid. Administrator perlu memeriksa koneksi penyimpanan.';
 else if(['insufficientPermissions','access_denied'].includes(reason))message='Izin koneksi Google Drive belum mengizinkan tindakan ini. Administrator perlu memeriksa izin unggah.';
 else if(['insufficientFilePermissions','appNotAuthorizedToFile','domainPolicy'].includes(reason))message='Aplikasi belum memiliki izin untuk menyimpan berkas di folder Google Drive tujuan.';
 else if(reason==='notFound'||status===404)message='Folder atau berkas Google Drive tidak ditemukan atau belum dapat diakses aplikasi.';
 else if(reason==='storageQuotaExceeded')message='Penyimpanan Google Drive penuh. Hubungi administrator untuk memeriksa kuota.';
 else if(['dailyLimitExceeded','userRateLimitExceeded','rateLimitExceeded'].includes(reason))message='Batas penggunaan Google Drive tercapai. Coba lagi beberapa saat atau hubungi administrator.';
 else if(reason==='accessNotConfigured')message='Google Drive API belum aktif untuk koneksi penyimpanan aplikasi.';
 else if(reason==='network_error')message='Penyimpanan berkas belum dapat dihubungi.';
 else if(stage==='upload')message=`Google Drive menolak unggahan berkas (HTTP ${status}). Hubungi administrator.`;
 else if(stage==='token')message=`Koneksi Google Drive gagal memperbarui akses (HTTP ${status}). Hubungi administrator.`;
 return new AppError(503,message,{service:'google_drive',stage,upstream_status:status,reason});
}
const driveModuleFolders=Object.freeze({
 sop:'SPH-Portal-SOP',pelatihan:'SPH-Portal-Pelatihan',pegawai:'SPH-Portal-Pegawai',
 patroli:'SPH-Portal-Patroli',kejadian:'SPH-Portal-Kejadian',informasi:'SPH-Portal-Informasi',
 pengadaan:'SPH-Portal-Pengadaan',website:'SPH-Portal-Website',
});
function driveModuleForOperation(path,body={}){
 const resource=typeof path==='string'?path.split('/')[0]:'';
 if(resource==='attachments')return {employee:'pegawai',logbook:'patroli',incident:'kejadian'}[body?.type]||null;
 const module={documents:'sop',training:'pelatihan',employees:'pegawai',logbook:'patroli',incidents:'kejadian',announcements:'informasi',purchasing:'pengadaan',website:'website'}[resource];
 return typeof module==='string'?module:null;
}
function createDriveStorage(env,fetchImpl=globalThis.fetch.bind(globalThis),options={}){
 const value=name=>typeof env[name]==='string'?env[name].trim():'';
 const folder=value('GOOGLE_DRIVE_FOLDER_ID'),clientId=value('GOOGLE_DRIVE_CLIENT_ID'),clientSecret=value('GOOGLE_DRIVE_CLIENT_SECRET'),refreshToken=value('GOOGLE_DRIVE_REFRESH_TOKEN');
 const created=[],moves=[],claimed=new Set(),folders=new Map();let access;
 const folderType='application/vnd.google-apps.folder';
 const metadataFields='id,parents,trashed,mimeType,appProperties';
 async function request(url,options={},stage='storage'){
  let r;try{r=await fetchImpl(url,{...options,redirect:'manual',signal:AbortSignal.timeout(12000)});}catch{throw storageError(stage,null,'network_error');}
  if(!r.ok)throw storageError(stage,r.status,await errorReason(r));return r;
 }
 async function token(){
  if(access)return access;
  assert(folder&&clientId&&clientSecret&&refreshToken,'Penyimpanan berkas belum dikonfigurasi.',503);
  const r=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken})},'token');
  const j=await r.json();assert(typeof j.access_token==='string'&&j.access_token.length<8192,'Penyimpanan berkas belum dapat diakses.',503);access=j.access_token;return access;
 }
 const headers=async()=>({Authorization:`Bearer ${await token()}`});
 const valid=id=>assert(typeof id==='string'&&/^[A-Za-z0-9_-]{8,200}$/.test(id),'Berkas tidak tersedia.',404);
 const knownModule=module=>typeof module==='string'&&Object.hasOwn(driveModuleFolders,module);
 const validFolder=(meta,module)=>meta&&typeof meta.id==='string'&&/^[A-Za-z0-9_-]{8,200}$/.test(meta.id)&&meta.trashed===false&&meta.mimeType===folderType&&meta.parents?.length===1&&meta.parents[0]===folder&&meta.appProperties?.sph_portal==='v1'&&meta.appProperties.sph_module===module;
 async function metadata(id){
  valid(id);
  try{return await (await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=${metadataFields}`,{headers:await headers()},'metadata')).json();}
  catch(error){if(error instanceof AppError&&error.details?.stage==='metadata'&&error.details.upstream_status===404)throw new AppError(404,'Berkas tidak tersedia.');throw error;}
 }
 async function moduleFolder(module){
  assert(knownModule(module),'Modul penyimpanan tidak valid.');
  if(!folders.has(module)){
   const pending=(async()=>{
    valid(folder);
    const url=new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q',`'${folder}' in parents and trashed = false and mimeType = '${folderType}' and appProperties has { key='sph_portal' and value='v1' } and appProperties has { key='sph_module' and value='${module}' }`);
    url.searchParams.set('fields',`files(${metadataFields})`);url.searchParams.set('pageSize','100');url.searchParams.set('orderBy','createdTime');
    const listing=await (await request(url.href,{headers:await headers()},'folder')).json();
    const existing=listing.files?.find(meta=>validFolder(meta,module));if(existing)return existing.id;
    const meta=await (await request(`https://www.googleapis.com/drive/v3/files?fields=${metadataFields}`,{method:'POST',headers:{...await headers(),'Content-Type':'application/json'},body:JSON.stringify({name:driveModuleFolders[module],mimeType:folderType,parents:[folder],appProperties:{sph_portal:'v1',sph_module:module}})},'folder')).json();
    assert(validFolder(meta,module),'Folder penyimpanan belum dapat diverifikasi.',503);return meta.id;
   })();folders.set(module,pending);
   try{return await pending;}catch(error){folders.delete(module);throw error;}
  }return folders.get(module);
 }
 async function ownedMetadata(id){
  const meta=await metadata(id);
  assert(meta.id===id&&meta.trashed===false&&typeof meta.mimeType==='string'&&meta.mimeType!==folderType&&meta.appProperties?.sph_portal==='v1'&&meta.parents?.length===1,'Berkas tidak tersedia.',404);
  if(meta.parents[0]===folder)return meta;
  const parent=await metadata(meta.parents[0]),module=parent?.appProperties?.sph_module;
  assert(knownModule(module)&&validFolder(parent,module)&&parent.id===meta.parents[0]&&(!meta.appProperties.sph_module||meta.appProperties.sph_module===module),'Berkas tidak tersedia.',404);
  return meta;
 }
 async function move(id,from,to,properties){
  const url=new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);
  url.searchParams.set('addParents',to);url.searchParams.set('removeParents',from);url.searchParams.set('fields',metadataFields);
  return (await request(url.href,{method:'PATCH',headers:{...await headers(),'Content-Type':'application/json'},body:JSON.stringify({appProperties:properties})},'organize')).json();
 }
 async function organize(id,module,meta){
  assert(knownModule(module),'Modul penyimpanan tidak valid.');meta=meta||await ownedMetadata(id);
  if(meta.parents[0]!==folder&&meta.appProperties.sph_module===module)return;
  const target=await moduleFolder(module);if(meta.parents[0]===target)return;
  // Record before PATCH so an uncertain network result can be reconciled on rollback.
  moves.push({id,from:meta.parents[0],to:target,properties:{...meta.appProperties}});
  const moved=await move(id,meta.parents[0],target,{...meta.appProperties,sph_module:module});
  assert(moved.id===id&&moved.parents?.length===1&&moved.parents[0]===target&&moved.appProperties?.sph_portal==='v1'&&moved.appProperties.sph_module===module,'Pemindahan berkas belum dapat diverifikasi.',503);
 }
 return {
  async put(data,mime){
   const boundary=`sph_${randomUUID3()}`;
   const module=options.module;assert(module==null||knownModule(module),'Modul penyimpanan tidak valid.');
   const parent=module?await moduleFolder(module):folder;
   const meta={name:randomUUID3(),parents:[parent],appProperties:{sph_portal:'v1',...(module?{sph_module:module}:{})}};
   const body=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,data,`\r\n--${boundary}--`]);
   const r=await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{...await headers(),'Content-Type':`multipart/related; boundary=${boundary}`},body},'upload');
   const file=await r.json();valid(file.id);created.push(file.id);return file.id;
  },
  claim(id){valid(id);claimed.add(id);},
  async finalize(){
   if(!claimed.size)return;
   assert(knownModule(options.module),'Modul lampiran belum dapat ditentukan.',503);
   for(const id of claimed)await organize(id,options.module);
   claimed.clear();
  },
  async get(id,module){
   const meta=await ownedMetadata(id);
   if(module)await organize(id,module,meta);
   const r=await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`,{headers:await headers()},'download');
   const chunks=[];let size=0;const reader=r.body.getReader();
   try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>10*1024*1024){await reader.cancel();throw new AppError(503,'Berkas melebihi ukuran yang diizinkan.');}chunks.push(value);}}finally{reader.releaseLock();}
   return Buffer.concat(chunks);
  },
  async rollback(){
   for(const entry of moves.slice().reverse()){
    if(created.includes(entry.id))continue;
    try{
     const meta=await ownedMetadata(entry.id);if(meta.parents[0]!==entry.to)continue;
     // Drive merges appProperties; null removes a newly added property.
     await move(entry.id,entry.to,entry.from,{...entry.properties,sph_module:entry.properties.sph_module||null});
    }catch{/* Both the original root and verified module folders remain readable. */}
   }
   for(const id of created){try{await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`,{method:'DELETE',headers:await headers()},'cleanup');}catch{/* An unlinked private upload remains inaccessible through the portal. */}}
  },
 };
}

// supabase/functions/_shared/portal/router.mjs
import { Buffer as Buffer3 } from "node:buffer";
import { createHash as createHash4 } from "node:crypto";

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
var purchasingRoleCodes = {
  PURCHASE_REQUESTER: ["Pemohon Pengadaan", ["purchasing.requests.create", "purchasing.requests.read"]],
  PURCHASING_STAFF: ["Staf Purchasing", ["purchasing.requests.read", "purchasing.procurement.manage", "purchasing.vendors.read", "purchasing.vendors.manage", "purchasing.vendors.sensitive", "purchasing.budget.read", "purchasing.reports.read"]],
  FINANCE_VERIFIER: ["Verifikator Keuangan", ["purchasing.requests.read", "purchasing.requests.verify", "purchasing.budget.read", "purchasing.budget.manage", "purchasing.vendors.read", "purchasing.vendors.sensitive", "purchasing.reports.read"]],
  PURCHASE_AUDITOR: ["Pemeriksa SPI", ["purchasing.requests.read", "purchasing.vendors.read", "purchasing.budget.read", "purchasing.reports.read", "purchasing.reports.export", "admin.audit.read"]],
  PURCHASE_ADMIN: ["Pengelola Pengadaan", ["purchasing.settings.manage", "purchasing.requests.read", "purchasing.vendors.read", "purchasing.vendors.manage", "purchasing.vendors.sensitive", "purchasing.budget.read", "purchasing.budget.manage"]]
};
var purchasingRoles = Object.entries(purchasingRoleCodes).map(([code, [name, codes]]) => [code, name, (c) => codes.includes(c)]);
async function grants(db, user) {
  return await all(db, `SELECT DISTINCT ur.id,ur.scope_kind,r.code role_code,p.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id AND r.is_active=1 JOIN permissions p ON EXISTS(SELECT 1 FROM role_permissions rp WHERE rp.role_id=r.id AND rp.permission_id=p.id) OR (r.code='SUPER_ADMIN' AND ur.scope_kind='ALL') WHERE ur.user_id=?`, user.id);
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
  assert(await asyncSome(users, async u => await isSuperAdmin(db, u)), "Administrator terakhir dengan role Superadmin yang aktif tidak boleh dinonaktifkan atau kehilangan role.", 409);
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
import { randomUUID as randomUUID4, createHash as createHash3 } from "node:crypto";

// supabase/functions/_shared/portal/purchasing.mjs
import { createHash as createHash2, randomBytes } from "node:crypto";

// supabase/functions/_shared/portal/purchasing-rules.mjs
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

// supabase/functions/_shared/portal/purchasing.mjs
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
  const rows = (await grants(db, user)).filter(g => g.code.startsWith("purchasing.") || g.code === "admin.audit.read");
  const unitRows = rows.some(g => g.scope_kind === "ASSIGNED_UNITS") ? await all(db, "SELECT user_role_id,org_unit_id,include_descendants FROM user_role_units WHERE user_role_id IN (SELECT id FROM user_roles WHERE user_id=?)", user.id) : [];
  const tree = unitRows.some(u => u.include_descendants) ? await all(db, "SELECT id,parent_id FROM org_units") : [];
  const below = root => {
    const found = new Set([root]);
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
      units: new Set()
    });
    if (g.scope_kind === "ALL") p.all = true; else if (g.scope_kind === "SELF") p.self = true; else if (g.scope_kind === "ASSIGNED_UNITS") for (const u of unitRows.filter(u2 => u2.user_role_id === g.id)) for (const id of u.include_descendants ? below(u.org_unit_id) : [u.org_unit_id]) p.units.add(id);
  }
  return {
    superadmin: rows.some(g => g.role_code === "SUPER_ADMIN" && g.scope_kind === "ALL"),
    sekban_peers: await sekbanPeers(db, settings, user.employee_id, today()),
    perms,
    has: code => Boolean(perms[code]),
    allows: (code, ctx = {}) => {
      const p = perms[code];
      if (!p) return false;
      if (p.all) return true;
      if (p.self && user.employee_id && ctx.employee_id === user.employee_id) return true;
      return Boolean(ctx.org_unit_id && p.units.has(ctx.org_unit_id));
    },
    broad: code => {
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
  if (ids.some(id => holders.filter(h => h.position_id === id).length !== 1) || new Set(holders.map(h => h.id)).size !== 3) return [];
  return holders.filter(h => h.position_id !== settings.officials.kaban_position_id);
}
async function sekbanPeers(db, settings, employeeId, asOf) {
  if (!employeeId || !settings.officials.sekban_deputy_position_id) return [];
  const holders = await sekbanHolders(db, settings, asOf);
  return holders.some(h => h.id === employeeId) ? [...new Set(holders.map(h => h.id))].filter(id => id !== employeeId) : [];
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
  const verify = !acc.superadmin && acc.has("purchasing.requests.verify") ? (await all(db, "SELECT s.*,r.requester_employee_id,r.org_unit_id FROM purchase_approval_steps s JOIN purchase_requests r ON r.id=s.request_id WHERE s.status='PENDING' AND s.target_kind='VERIFIERS' ORDER BY s.created_at")).filter(s => acc.allows("purchasing.requests.verify", {
    org_unit_id: s.org_unit_id
  })) : [];
  return [...mine, ...verify].filter(s => s.requester_employee_id !== user.employee_id);
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
    orders = orderRows.map(o => ({
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
      items: orderItems.filter(i => i.order_id === o.id).map(i => ({
        ...i,
        unit_price: Number(i.unit_price),
        subtotal: Number(i.subtotal),
        purchase_unit_price: i.purchase_unit_price === null ? null : Number(i.purchase_unit_price)
      })),
      document: docs.find(d => d.order_id === o.id) || null,
      appointments: appointments.filter(a => a.order_id === o.id),
      receipt: receipts.find(r => r.order_id === o.id) || null,
      attachments: attachments2.filter(a => a.owner_type === "ORDER" && a.owner_id === o.id)
    }));
  } else {
    orders = (await all(db, "SELECT id,status,due_on FROM vendor_orders WHERE request_id=? AND status<>'cancelled' ORDER BY created_at", request.id)).map(o => ({
      id: o.id,
      status: o.status,
      due_on: o.due_on,
      late: isLate(o, asOf)
    }));
  }
  const pending = steps.filter(s => s.status === "PENDING");
  const delegators = user.employee_id ? await delegatorsOf(db, user.employee_id, asOf) : [];
  const myStep = pending.find(s => {
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
  const covered = new Set(orders.filter(o => o.status !== "cancelled" && o.items).flatMap(o => o.items.map(i => i.request_item_id)));
  const total = Number(request.approved_total ?? request.estimated_total);
  let suggestion = null;
  if (staff && request.status === "pending_completeness_check") {
    const unit = await one(db, "SELECT code FROM org_units WHERE id=?", request.org_unit_id), key = unitCode(settings, request, unit), yr = year(asOf);
    suggestion = documentNumber("PR", await peekSequence(db, "PR", key, yr), asOf, key);
  }
  return {
    ...requestRow(request),
    view: view.full ? "full" : "requester",
    items: items.map(i => ({
      ...i,
      unit_price: Number(i.unit_price),
      subtotal: Number(i.subtotal),
      approved_unit_price: Number(i.approved_unit_price),
      approved_subtotal: Number(i.approved_subtotal),
      quantity: formatQuantity(i.quantity_milli),
      ordered: covered.has(i.id),
      attachments: attachments2.filter(a => a.owner_type === "ITEM" && a.owner_id === i.id),
      quotes: quotes.filter(q => q.item_id === i.id).map(q => ({
        ...q,
        unit_price: Number(q.unit_price),
        attachments: attachments2.filter(a => a.owner_type === "QUOTE" && a.owner_id === q.id)
      }))
    })),
    steps: steps.map(s => ({
      ...s,
      label: STEP_LABELS[s.step_kind]
    })),
    confirmations: confirmations.map(c => ({
      ...c,
      old_unit_price: Number(c.old_unit_price),
      new_unit_price: Number(c.new_unit_price),
      old_subtotal: Number(c.old_subtotal),
      new_subtotal: Number(c.new_subtotal)
    })),
    orders,
    documents,
    budget_line: request.budget_line_id ? (await budgetLines(db, year(request.request_date))).find(l => l.id === request.budget_line_id) || null : null,
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
      reassign: acc.has("purchasing.settings.manage") && pending.some(s => s.target_kind === "EMPLOYEE"),
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
      ...s.officials || ({})
    },
    number_floor: {
      ...current.number_floor,
      ...s.number_floor || ({})
    },
    organization: {
      ...current.organization,
      ...s.organization || ({})
    },
    texts: {
      ...current.texts,
      ...s.texts || ({})
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
    const holders = await asyncMap(ids, async id => await positionHolders(db, id, today()));
    assert(holders.every(rows => rows.length === 1) && new Set(holders.map(rows => rows[0].id)).size === 3, "Sekban, Wakil Sekban, dan Kaban harus mempunyai pemegang aktif yang berbeda dan tunggal.", 409);
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
    assert((/^[A-Za-z0-9_-]{1,20}$/).test(String(code)), "Kode unit untuk nomor PR hanya huruf, angka, garis bawah, atau tanda hubung (maks. 20).");
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
  const {db, user, p, method: m, body: b, url} = c;
  if (p[0] !== "purchasing") return void 0;
  const settings = await purchasingSettings(db), acc = await purchasingAccess(db, user, settings), asOf = today();
  const section = p[1], id = p[2], action = p[3];
  if (section === "overview" && m === "GET") {
    const ctx = await requesterContext(db, user, acc, settings, asOf);
    const mine = user.employee_id ? await all(db, "SELECT status FROM purchase_requests WHERE requester_employee_id=? AND status IN ('returned','pending_requester_confirmation')", user.employee_id) : [];
    const approvals = await pendingSteps(db, acc, user, asOf);
    const queue = acc.has("purchasing.procurement.manage") ? (await all(db, "SELECT status,org_unit_id FROM purchase_requests WHERE status IN ('pending_completeness_check','in_procurement')")).filter(r => acc.allows("purchasing.procurement.manage", {
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
        completeness: queue.filter(r => r.status === "pending_completeness_check").length,
        procurement: queue.filter(r => r.status === "in_procurement").length
      },
      rules: {
        sekban_max_total: settings.sekban_max_total,
        attachment_min_item_subtotal: settings.attachment_min_item_subtotal,
        comparison_min_total: settings.comparison_min_total,
        min_quotes_per_item: settings.min_quotes_per_item
      },
      capabilities: {
        submit: acc.has("purchasing.requests.create"),
        read_all: ["purchasing.requests.read", "purchasing.requests.verify", "purchasing.procurement.manage"].some(code => acc.broad(code)),
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
      budget_lines: staff || finance ? (await budgetLines(db, yr)).filter(l => l.is_active) : [],
      employees: staff || admin ? await all(db, "SELECT id,full_name,employee_no FROM employees WHERE is_active=1 ORDER BY full_name") : [],
      positions: admin ? await all(db, "SELECT p.id,p.name,u.name unit_name FROM positions p JOIN org_units u ON u.id=p.org_unit_id WHERE p.is_active=1 ORDER BY p.name") : [],
      units: admin || finance ? await all(db, "SELECT id,code,name FROM org_units WHERE is_active=1 ORDER BY name") : []
    };
  }
  if (section === "requests") {
    if (!id && m === "GET") return await listRequests(db, acc, user, url.searchParams.get("view") || "mine", url);
    if (!id && m === "POST") return await tx(db, async () => {
      const ctx = await requesterContext(db, user, acc, settings, asOf);
      assert(!ctx.missing.length, `PR belum dapat dikirim. Lengkapi: ${ctx.missing.join(" ")}`, ctx.missing.some(x => x.startsWith("Izin")) ? 403 : 422);
      const neededOn = date(b.needed_on, "Tanggal barang dibutuhkan");
      assert(neededOn >= asOf, "Tanggal barang dibutuhkan tidak boleh sebelum hari ini.");
      const items = parseItems(b.items, settings), total = rule(() => sum(items.map(i => i.subtotal)));
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
      const items = parseItems(b.items, settings), total = rule(() => sum(items.map(i => i.subtotal)));
      const kept = new Set((await all(db, "SELECT file_id FROM purchase_attachments WHERE request_id=? AND owner_type='ITEM' AND file_id IS NOT NULL", request.id)).map(r => r.file_id));
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
      const expected = ({
        ACKNOWLEDGE: "pending_acknowledgement",
        VERIFY: "pending_verification",
        FINAL: "pending_final_approval",
        REVERIFY: "pending_reverification",
        REAPPROVE: "pending_reapproval"
      })[step.step_kind];
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
        const {kind, target} = await finalTarget(db, settings, request, finalApproverKind(Number(request.estimated_total), special, settings), asOf);
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
        const total = rule(() => sum(approved.map(i => i.approved_subtotal)));
        await decide(db, user, me, step, "APPROVED", reason, asDelegate);
        const needsKaban = request.final_approver_kind === "SEKBAN" && finalApproverKind(total, request.special_budget, settings) === "KABAN";
        const updated = await setStatus(db, request, needsKaban ? "pending_reapproval" : "in_procurement", {
          approved_total: total
        });
        if (needsKaban) await addStep(db, user, updated, "REAPPROVE", (await finalTarget(db, settings, updated, "KABAN", asOf)).target, request.revision_no); else await freezeDocument(db, user, updated, "PR", updated.id, updated.pr_number, await requestSnapshot(db, settings, updated));
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
      assert(!(await openOrderItems(db, request.id)).some(o => o.request_item_id === item.id), "Item ini sudah masuk pesanan.", 409);
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
      assert(!(await openOrderItems(db, request.id)).some(o => o.request_item_id === quote.item_id), "Item ini sudah masuk pesanan.", 409);
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
      assert(!(await openOrderItems(db, request.id)).some(o => o.request_item_id === quote.item_id), "Item ini sudah masuk pesanan.", 409);
      const siblings = await all(db, "SELECT * FROM purchase_price_quotes WHERE item_id=?", quote.item_id);
      const cheapest = Math.min(...siblings.map(q => Number(q.unit_price)));
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
      const taken = new Set((await openOrderItems(db, request.id)).map(o => o.request_item_id));
      const active = (await all(db, "SELECT * FROM purchase_request_items WHERE request_id=? AND status='ACTIVE' ORDER BY line_no", request.id)).filter(i => !taken.has(i.id));
      const wanted = Array.isArray(b.item_ids) && b.item_ids.length ? b.item_ids : active.map(i => i.id);
      const items = wanted.map(itemId => {
        const item = active.find(i => i.id === itemId);
        assert(item, "Item sudah dipesan, dibatalkan, atau bukan milik PR ini.");
        return item;
      });
      assert(items.length, "Tidak ada item yang perlu dipesan.");
      const created = [];
      if (path === "A") {
        const vendor = b.vendor_id ? await pick(db, "vendors", b.vendor_id, "Vendor") : null;
        const prices = Object.fromEntries(items.map(i => [i.id, b.prices?.[i.id] ?? Number(i.approved_unit_price)]));
        created.push(await createOrder(db, user, request, "A", vendor, vendor ? vendor.name : text(b.store_name, "Nama toko", 200), pricedLines(items, prices), "NONE"));
      } else if (path === "B") {
        const quotes = await all(db, `SELECT * FROM purchase_price_quotes WHERE item_id IN (${items.map(() => "?").join(",")})`, ...items.map(i => i.id));
        const groups = new Map();
        for (const item of items) {
          const own = quotes.filter(q => q.item_id === item.id), stores = new Set(own.map(q => q.store_name.trim().toLowerCase()));
          assert(stores.size >= settings.min_quotes_per_item, `Item ${item.line_no} butuh minimal ${settings.min_quotes_per_item} harga dari toko berbeda (ATR-PG-02).`);
          const chosen = own.filter(q => q.is_selected);
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
          const kind = documentKindFor(list.map(l => l.item.item_kind));
          const order = await createOrder(db, user, request, "B", vendor, vendor.name, pricedLines(list.map(l => l.item), Object.fromEntries(list.map(l => [l.item.id, l.price]))), kind);
          await insert(db, "vendor_order_documents", {
            order_id: order.id,
            ...orderDocumentValues({}, settings, kind),
            created_by: user.id
          });
          created.push(order);
        }
      } else {
        const vendor = await pick(db, "vendors", b.vendor_id, "Vendor");
        const kind = documentKindFor(items.map(i => i.item_kind));
        const order = await createOrder(db, user, request, "C", vendor, vendor.name, pricedLines(items, b.prices || ({})), kind);
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
        orders: created.map(o => o.id)
      });
      return await requestDetail(db, acc, user, settings, await loadRequest(db, request.id));
    });
    if (action === "confirmations" && m === "POST" && !p[4]) return await tx(db, async () => {
      assertStaff(acc, request);
      assert(request.status === "in_procurement", "Konfirmasi ulang hanya untuk PR yang sedang diproses.", 409);
      assert(request.row_version === versionOf(b), "PR sudah berubah. Muat ulang data.", 409);
      assert(Array.isArray(b.items) && b.items.length, "Pilih minimal satu item yang harganya berubah.");
      const taken = new Set((await openOrderItems(db, request.id)).map(o => o.request_item_id)), round = request.confirmation_round + 1;
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
      assert(open.every(c2 => answers.some(a => a.item_id === c2.item_id && typeof a.accept === "boolean")), "Jawab setiap item: setujui harga baru atau batalkan item.");
      let accepted = 0;
      for (const c2 of open) {
        const accept = answers.find(a => a.item_id === c2.item_id).accept;
        await update(db, "purchase_price_confirmations", c2.id, c2.row_version, {
          answer: accept ? "ACCEPTED" : "CANCELLED",
          answered_at: now(),
          answered_by: user.id
        });
        if (accept) accepted++; else {
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
      }); else if (accepted) {
        const updated = await setStatus(db, request, "pending_reverification");
        await addStep(db, user, updated, "REVERIFY", null, request.revision_no);
      } else {
        await setStatus(db, request, "in_procurement", {
          approved_total: rule(() => sum(remaining.map(i => i.approved_subtotal)))
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
          ...b.document || ({})
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
        const item = requestItems.find(i => i.id === row.request_item_id);
        assert(subtotal <= Number(item.approved_subtotal), `Subtotal item ${item.line_no} melebihi nilai yang disetujui. Ajukan konfirmasi ulang (ATR-PG-09).`, 409);
        await update(db, "vendor_order_items", row.id, row.row_version, {
          needed_on: neededOn,
          calc_volume_milli: volume,
          calc_unit: calcUnit,
          subtotal
        });
      }
      const lines = await all(db, "SELECT subtotal FROM vendor_order_items WHERE order_id=?", order.id);
      const total = rule(() => sum(lines.map(i => i.subtotal)));
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
          items: (await all(db, "SELECT i.description,oi.quantity_milli,oi.unit,oi.unit_price,oi.subtotal FROM vendor_order_items oi JOIN purchase_request_items i ON i.id=oi.request_item_id WHERE oi.order_id=? ORDER BY i.line_no", order.id)).map(i => ({
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
      const prices = Object.fromEntries((Array.isArray(b.items) ? b.items : []).map(l => [l.id, l.unit_price]));
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
      assert(invoice.every(a => a.form === "FILE"), "Nota vendor harus berupa berkas yang diunggah.");
      const rows = await all(db, "SELECT * FROM vendor_order_items WHERE order_id=?", order.id);
      const received = Object.fromEntries((Array.isArray(b.items) ? b.items : []).map(l => [l.id, l.received_quantity]));
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
    assert((/^[a-f0-9]{20}$/).test(id), "Kode verifikasi tidak valid.", 404);
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
        items: (await all(db, "SELECT * FROM vendors ORDER BY name")).map(v => vendorRow(v, sensitive)),
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
        fields: Object.keys(b).filter(k => k !== "row_version")
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
      assert((/^[A-Z0-9_-]+$/).test(code), "Kode Pos RKA hanya huruf, angka, garis bawah, atau tanda hubung.");
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
        keys: Object.keys(b.settings || ({}))
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
    const ids = rows.map(r => r.id);
    const orders = ids.length ? await all(db, `SELECT o.request_id,o.status,o.due_on,o.total,r.invoice_total FROM vendor_orders o LEFT JOIN order_receipts r ON r.order_id=o.id WHERE o.request_id IN (${ids.map(() => "?").join(",")}) AND o.status<>'cancelled'`, ...ids) : [];
    return {
      year: yr,
      total_requests: rows.length,
      by_status: Object.entries(by).map(([status, count]) => ({
        status,
        label: STATUS_LABELS[status],
        count
      })),
      approved_value: rule(() => sum(rows.filter(r => r.approved_total !== null && !["rejected", "cancelled"].includes(r.status)).map(r => r.approved_total))),
      realized_value: rule(() => sum(orders.filter(o => o.status === "received").map(o => o.invoice_total || 0))),
      late_orders: orders.filter(o => isLate(o, asOf)).length,
      budget: acc.has("purchasing.budget.read") ? await budgetLines(db, yr) : []
    };
  }
  if (section === "export" && m === "GET") {
    assert(acc.has("purchasing.reports.export"), "Akses ekspor ditolak.", 403);
    const yr = Number(url.searchParams.get("year")) || year(asOf), rows = await reportRows(db, acc, yr);
    const cell = v => '"' + String(v ?? "").replace(/^[=+\-@\t\r]/, "'$&").replaceAll('"', '""') + '"';
    const table = [["Kode pengajuan", "Nomor PR", "Tanggal PR", "Pemohon", "Unit", "Status", "Total estimasi", "Total disetujui", "Penyetuju akhir", "Jalur"], ...rows.map(r => [r.request_code, r.pr_number, r.request_date, r.requester_name, r.unit_name, STATUS_LABELS[r.status], r.estimated_total, r.approved_total, r.final_approver_kind, r.procurement_path])];
    await audit(db, user, "EXPORT", "purchase_requests", String(yr), {
      row_count: rows.length
    });
    return {
      filename: `pengadaan-${yr}.csv`,
      csv: table.map(row => row.map(cell).join(",")).join("\r\n")
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

// supabase/functions/_shared/portal/files.mjs
var attachments = [["employee_files", "employee_id", "employee"], ["employee_contracts", "employee_id", "contract"], ["document_versions", "document_id", "document"], ["training_materials", "training_event_id", "material"], ["participant_certificates", "training_participant_id", "certificate"], ["logbook_files", "logbook_entry_id", "logbook"], ["incident_files", "incident_id", "incident"], ["announcement_files", "announcement_id", "announcement"], ["purchase_attachments", "request_id", "purchase"]];
async function claimFile(db, user, id) {
  const f = await get(db, "files", id);
  assert(f.status === "AVAILABLE" && f.uploaded_by === user.id, "Berkas tidak tersedia untuk dilampirkan.", 403);
  assert(!await asyncSome(attachments, async ([t]) => await one(db, `SELECT id FROM ${t} WHERE file_id=?`, id)), "Berkas sudah terhubung. Unggah berkas baru untuk objek ini.");
  db.storage?.claim?.(f.storage_key);
  return f;
}
async function fileStorageModule(db, id) {
  const modules = {
    website: 'website',
    employee: 'pegawai',
    contract: 'pegawai',
    document: 'sop',
    material: 'pelatihan',
    certificate: 'pelatihan',
    logbook: 'patroli',
    incident: 'kejadian',
    announcement: 'informasi',
    purchase: 'pengadaan'
  };
  for (const [table, , type] of attachments) if (await one(db, `SELECT id FROM ${table} WHERE file_id=?`, id)) return modules[type];
  return null;
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
    if (type === "purchase" && await purchaseFileAllowed(db, user, link)) return true;
    if (type === "announcement") {
      const a = await get(db, "announcements", link.announcement_id);
      if (await announcementsManager(db, user) || a.published_at && ["PUBLISHED", "ARCHIVED"].includes(a.status) && (!a.starts_at || a.starts_at <= now())) return true;
    }
  }
  return false;
}
async function upload(db, user, b, dataDir) {
  assert(await announcementsManager(db, user) || await asyncSome(["hr.documents.manage", "hr.employee_files.manage", "hr.training.manage", "hr.training.participants", "security.logbook.create", "security.incidents.create", "security.incidents.update", "purchasing.requests.create", "purchasing.procurement.manage"], async (p) => await has(db, user, p)), "Akses unggah ditolak.", 403);
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
    assert(row.latitude==null&&row.report_source!=='PUBLIC_LINK', "Foto laporan baru diambil melalui kamera saat pelaporan.");
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
  const {db, user, p, method: m, body: b, url} = c;
  const id = p[1], action = p[2];
  if (p[0] === "employees") {
    if (m === "GET" && !id) {
      const asOf = url.searchParams.get("as_of") || today();
      date(asOf);
      let rows = await readList(db, user, "hr.employees.read", await employees(db, asOf));
      const q = (url.searchParams.get("q") || "").toLowerCase(), unit = url.searchParams.get("unit"), status = url.searchParams.get("status");
      rows = rows.filter(e => (!q || `${e.full_name} ${e.employee_no}`.toLowerCase().includes(q)) && (!unit || e.org_unit_id === unit) && (!status || e.employment_status === status));
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
          training: await asyncFilter(await all(db, "SELECT t.*,p.attendance_status FROM training_participants p JOIN training_events t ON t.id=p.training_event_id WHERE p.employee_id=?", id), async t => await trainingAllowed(db, user, "read", t))
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
          fields: Object.keys(b).filter(x => x !== "row_version")
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
      items: await readList(db, user, "hr.organization.read", (await all(db, `SELECT * FROM ${table} ORDER BY name`)).map(r => ({
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
        items: await asyncFilter(await all(db, `SELECT d.*,o.name unit_name,(SELECT version_label FROM document_versions WHERE document_id=d.id AND state='ACTIVE') active_version,(SELECT effective_on FROM document_versions WHERE document_id=d.id AND state='ACTIVE') effective_on FROM documents d JOIN org_units o ON o.id=d.owner_org_unit_id WHERE d.is_archived=0 ORDER BY d.title`), async d => await documentAllowed(db, user, "read", d))
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
          versions: (await all(db, "SELECT v.*,f.original_name FROM document_versions v JOIN files f ON f.id=v.file_id WHERE v.document_id=? ORDER BY v.created_at DESC", id)).filter(v => manage || v.state === "ACTIVE"),
          targets: await all(db, "SELECT org_unit_id FROM document_target_units WHERE document_id=?", id)
        };
      }
      if (m === "DELETE" && !action) return await tx(db, async () => {
        assert(await documentAllowed(db, user, "manage", doc), "Anda tidak memiliki akses untuk menghapus dokumen unit ini.", 403);
        await update(db, "documents", id, b.row_version, {is_archived: 1});
        await audit(db, user, "DELETE", "documents", id, {document_code: doc.document_code, title: doc.title});
        return {deleted: true};
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
    if (m === "GET" && !id) {
      assert(await has(db, user, "hr.training.read"), "Akses ditolak.", 403);
      return {
        items: await asyncFilter(await all(db, "SELECT t.*,(SELECT count(*) FROM training_participants WHERE training_event_id=t.id) participant_count FROM training_events t WHERE t.deleted_at IS NULL ORDER BY starts_at DESC"), async t => await trainingAllowed(db, user, "read", t))
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
          participants: await asyncFilter(await all(db, "SELECT tp.*,e.full_name,e.employee_no FROM training_participants tp JOIN employees e ON e.id=tp.employee_id WHERE tp.training_event_id=? ORDER BY e.full_name", id), async tp => manage || await can(db, user, "hr.training.read", {
            org_unit_id: event.organizer_org_unit_id,
            employee_id: tp.employee_id
          })),
          materials: await all(db, "SELECT tm.*,dv.file_id document_file_id FROM training_materials tm LEFT JOIN document_versions dv ON dv.id=tm.document_version_id WHERE tm.training_event_id=? AND tm.usage_kind='MATERIAL'", id),
          documentation: await all(db, "SELECT f.id,f.original_name,f.mime_type,f.size_bytes,tm.title caption,tm.created_at FROM training_materials tm JOIN files f ON f.id=tm.file_id WHERE tm.training_event_id=? AND tm.usage_kind='DOCUMENTATION' AND f.status='AVAILABLE' ORDER BY tm.created_at,tm.id", id),
          certificates: (await all(db, "SELECT pc.*,tp.employee_id FROM participant_certificates pc JOIN training_participants tp ON tp.id=pc.training_participant_id WHERE tp.training_event_id=?", id)).filter(pc => manage || pc.employee_id === user.employee_id)
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
        if (b.file_id) await claimFile(db, user, b.file_id); else {
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
  if (p[0] === "coaching") {
    if (m === "GET" && !id) {
      assert(await has(db, user, "hr.coaching.read") || await has(db, user, "hr.coaching.manage"), "Akses ditolak.", 403);
      return {
        items: await asyncFilter(await all(db, `SELECT s.*,e.full_name employee_name,c.full_name coach_name,(SELECT count(*) FROM coaching_actions WHERE coaching_session_id=s.id AND status<>'DONE') open_actions FROM coaching_sessions s JOIN employees e ON e.id=s.employee_id JOIN employees c ON c.id=s.coach_employee_id ORDER BY held_at DESC`), async s => await coachingAllowed(db, user, "read", s))
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
        if (log.latitude == null && log.report_source !== 'PUBLIC_LINK' && b.findings !== void 0) values.findings = opt(b.findings);
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

// supabase/functions/_shared/portal/admin.mjs
import { randomBytes as randomBytes2 } from "node:crypto";
async function adminRoutes(c) {
  const {db, user, p, method: m, body: b} = c, id = p[1], action = p[2];
  if (p[0] === "users") {
    if (m === "GET" && !id) {
      await requireAccess(db, user, "admin.users.read");
      return {
        items: await asyncMap(await all(db, "SELECT id,username,employee_id,status,must_change_password,last_login_at,row_version FROM users ORDER BY username"), async u => ({
          ...u,
          grants: await asyncMap(await all(db, "SELECT ur.*,r.name role_name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE user_id=?", u.id), async g => ({
            ...g,
            units: await all(db, "SELECT * FROM user_role_units WHERE user_role_id=?", g.id),
            posts: (await all(db, "SELECT post_id FROM user_role_posts WHERE user_role_id=?", g.id)).map(p2 => p2.post_id)
          }))
        }))
      };
    }
    if (m === "POST" && !id) {
      await requireAccess(db, user, "admin.users.manage");
      assert(typeof b.password === "string" && b.password.length >= 6 && b.password.length <= 128, "Password harus 6\u2013128 karakter.");
      const username = text(b.username, "Username", 64).toLowerCase();
      assert((/^[a-z0-9._-]{1,64}$/).test(username), "Username hanya berisi huruf kecil, angka, titik, garis bawah atau tanda hubung.");
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
        items: await asyncMap(await all(db, "SELECT * FROM roles ORDER BY name"), async r => ({
          ...r,
          permissions: (r.code === "SUPER_ADMIN" ? await all(db, "SELECT code FROM permissions") : await all(db, "SELECT p.code FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id=?", r.id)).map(p2 => p2.code)
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
        const expected = code === "SUPER_ADMIN" ? (await all(db, "SELECT code FROM permissions")).map(p2 => p2.code) : IT_ADMIN_PERMISSIONS;
        assert(b.is_active !== false && b.is_active !== 0 && new Set(b.permissions).size === expected.length && expected.every(p2 => b.permissions.includes(p2)), "Izin role admin sistem mengikuti tipe admin dan tidak dapat dikurangi atau diperluas.", 409);
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
    if (m === "GET") return Object.fromEntries((await asyncFilter(await all(db, "SELECT key,value FROM app_settings"), async r => await isSuperAdmin(db, user) || ["allow_gap_publication", "demo_mode"].includes(r.key))).map(r => [r.key, r.value]));
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

// supabase/functions/_shared/portal/router.mjs
const quickReport_tokenPattern = /^[a-f0-9]{64}$/;
const quickReport_securityPosition = (name) => /\b(keamanan|ketertiban|bankamda|linmas|satpam|security)\b/i.test(name);
const quickReport_invalidLink = "Tautan laporan tidak aktif. Minta tautan terbaru kepada koordinator.";
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
const quickReport_receipt = (row) => ({
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
    ...(locationName ? {location_name: locationName} : {}),
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
    ...(locationName ? {location_name: locationName} : {}),
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

async function routeOperation({ db, user, path, method, body = {}, query = "" }) {
  assert(typeof path === "string" && /^[a-z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(path) && path.length <= 512, "Alamat API tidak valid.", 404);
  assert(["GET", "POST", "PATCH", "DELETE"].includes(method), "Metode tidak diizinkan.", 405);
  const p = path.split("/");
  const url = new URL(`https://portal.invalid/?${query}`);
  if (path === "portal/me" && method === "GET") return { user: safeUser(user), name: user.employee_id ? (await get(db, "employees", user.employee_id)).full_name : user.username, permissions: [...new Set((await grants(db, user)).map((g) => g.code))], announcements_manage: await announcementsManager(db, user), purchasing_pending: await purchasingPendingCount(db, user), demo: false };
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
    assert(data.length === file.size_bytes && createHash4("sha256").update(data).digest("hex") === file.checksum, "Integritas berkas belum dapat diverifikasi.", 503);
    return { binary: true, data: Buffer3.from(data).toString("base64"), mime_type: file.mime_type, name: file.original_name, inline: url.searchParams.get("inline") === "1" && ["image/png", "image/jpeg"].includes(file.mime_type) };
  }
  const ctx = { db, user, p, method, body, url };
  for (const handler of [quickReportManagement, announcementRoutes, hrRoutes, securityRoutes, rosterRoutes, adminRoutes, purchasingRoutes]) {
    const result = await handler(ctx);
    if (result !== void 0) return result;
  }
  throw new AppError(404, "Alamat API tidak ditemukan.");
}

// supabase/functions/portal-api/index.ts
var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
      storage = createDriveStorage(env, undefined, {module: b.action === "quick-report" ? "patroli" : driveModuleForOperation(b.path, b.body)});
      const client = database(env);
      if (b.action === "quick-report") {
        assert(["context", "submit"].includes(b.operation) && b.body && typeof b.body === "object" && !Array.isArray(b.body), "Permintaan tidak valid.", 400);
        const allowed = await transaction(client, identity, storage, db => takeQuickReportSlot(db, b.client_ip, b.operation));
        assert(allowed, "Terlalu banyak percobaan. Coba lagi beberapa menit kemudian.", 429);
        const result = await transaction(client, identity, storage, async db => {
          const result = await publicQuickReport(db, b.operation, b.body, undefined, requestId);
          await storage.finalize();
          workCompleted = true;
          return result;
        });
        return Response.json({ok: true, result}, {headers: {"Cache-Control": "no-store"}});
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
