import {createHash,randomUUID} from 'node:crypto';
import {all,one,run,assert,AppError,now} from './db.mjs';
import {visitRules,witaDate,shiftDate,visitFindingSums,visitScoreOf,lockVisitEvaluations} from './visit-data.mjs';
import {scoreRuleFinder,seragamLabels,resolveFlagEvents} from './visit-scoring.mjs';

// Salinan penilaian guide ke Google Spreadsheet di Drive portal.
//   - Folder SPH-Portal-Kunjungan di dalam GOOGLE_DRIVE_FOLDER_ID (koneksi OAuth
//     yang sama dengan unggah berkas), satu spreadsheet per tahun, satu tab per bulan.
//   - Baris ditulis ke POSISI yang dicatat basis data (bukan append), sehingga
//     percobaan ulang setelah gangguan menimpa baris yang sama, tidak menggandakan.
//   - Satu penyalinan pada satu waktu (lease di visit_sheet_state); semua panggilan
//     Google berjalan DI LUAR transaksi basis data.
//   - Retensi: baris > 6 minggu dicocokkan ulang dengan isi spreadsheet, dilipat ke
//     visit_daily_totals (dan visit_monthly_totals), baru dihapus. Yang belum cocok
//     tidak pernah dihapus.
//   - Kolom A–M sama dengan tab Evaluations NilaiGuide lama. Kolom N–T (penilaian
//     "100 − potongan") ditambahkan di kanan; tab lama yang masih 13 kolom dilebarkan
//     otomatis saat ditulis lagi, dan dibaca sesuai lebarnya saat dicocokkan.
// Aplikasi dan spreadsheet NilaiGuide lama tidak pernah disentuh.
export const visitSheetLegacyColumns=13;
export const visitSheetHeader=Object.freeze(['evaluationId','timestamp','pos','guideId','guideName','uniform','idCard','review','etika','catatan','receivedAt','koreksiDari','status',
 'versi','seragam','teguran','pelanggaranBerat','apresiasi','petugas','nilai']);
const columnLetter=n=>{let out='';for(let x=n;x>0;x=Math.floor((x-1)/26))out=String.fromCharCode(65+(x-1)%26)+out;return out;};
const lastColumn=columnLetter(visitSheetHeader.length);
export const visitSheetLimits=Object.freeze({batchRows:500,dirtyRows:200,verifyRows:3000,rangesPerRead:40,growRows:1000,throttleSeconds:20,retentionEveryHours:20,
 runs:Object.freeze({manual:{budgetMs:20000,leaseSeconds:45},auto:{budgetMs:60000,leaseSeconds:90}})});
const columnWidths=[290,190,50,90,200,80,70,70,70,240,190,290,80,60,120,220,160,140,180,60];
const sheetsApi='https://sheets.googleapis.com/v4/spreadsheets',driveApi='https://www.googleapis.com/drive/v3/files',tokenApi='https://oauth2.googleapis.com/token';
const folderMime='application/vnd.google-apps.folder',spreadsheetMime='application/vnd.google-apps.spreadsheet';
const kunjunganFolder='SPH-Portal-Kunjungan',driveIdPattern=/^[A-Za-z0-9_-]{8,200}$/;
const evaluationIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sheetAccessTokens=new Map();
const guideNotes=[
 'Penilaian Guide — salinan otomatis dari SPH Portal (modul Pengelolaan Kunjungan).',
 'Satu tab per bulan, tanggal menurut WITA. Kolom A–M sama dengan tab Evaluations aplikasi NilaiGuide lama.',
 'Kolom N–T: penilaian "100 − potongan" (versi 2). nilai = 100 − potongan menurut aturan bulan itu. Baris cara lama (versi kosong) dihitung portal dengan pemetaan: ID 0 = tanpa ID, Uniform −1 = tidak berseragam, Etika minus dengan seragam sesuai = satu teguran.',
 'Baris berstatus "diganti" adalah penilaian yang dikoreksi petugas pos dan tidak ikut dihitung.',
 'Jangan mengurutkan, menyisipkan, atau menghapus baris di tab bulanan: portal menulis ke posisi baris yang dicatatnya.',
 'Untuk mengolah data, gunakan Data → Tampilan filter, atau salin tab ke spreadsheet lain.',
 `Portal menyimpan rincian penilaian ${visitRules.retensiHari/7} minggu terakhir; rincian yang lebih lama hanya ada di spreadsheet ini.`
];

export function visitSheetConfig(env={}){
 const value=name=>typeof env[name]==='string'?env[name].trim():'';
 const config={folder:value('GOOGLE_DRIVE_FOLDER_ID'),clientId:value('GOOGLE_DRIVE_CLIENT_ID'),clientSecret:value('GOOGLE_DRIVE_CLIENT_SECRET'),refreshToken:value('GOOGLE_DRIVE_REFRESH_TOKEN')};
 return {...config,configured:Boolean(config.clientId&&config.clientSecret&&config.refreshToken&&driveIdPattern.test(config.folder))};
}
// ruleOf: pencari aturan nilai per bulan (visit-scoring.mjs). Baris cara lama mengosongkan
// kolom N–T, sehingga baris yang sudah tersalin sebelum kolom itu ada tetap cocok.
export function visitSheetValues(r,ruleOf){
 const base=[r.id,r.evaluated_at,Number(r.pos),r.guide_id,r.guide_name,Number(r.uniform),Number(r.id_card),Number(r.review),Number(r.etika),r.catatan||'',r.received_at,r.koreksi_dari||'',r.status];
 if(Number(r.versi)!==2)return [...base,'','','','','','',''];
 return [...base,2,seragamLabels[r.seragam]||r.seragam,r.teguran||'',r.berat||'',r.apresiasi||'',r.petugas_nama||'',visitScoreOf(r,ruleOf)];
}
const sameSheetRow=(cells,expected)=>Array.isArray(cells)&&expected.every((v,i)=>typeof v==='number'?Number(cells[i])===v&&cells[i]!==''&&cells[i]!==undefined:String(cells[i]??'')===v);
const quoteTab=title=>`'${title}'`;
const monthOfDay=day=>day.slice(0,7);

/* ---------------- Klien Google (OAuth yang sama dengan unggah berkas) ---------------- */

const knownSheetReasons=new Set(['invalid_grant','invalid_client','unauthorized_client','access_denied','SERVICE_DISABLED','accessNotConfigured','ACCESS_TOKEN_SCOPE_INSUFFICIENT','insufficientPermissions','PERMISSION_DENIED',
 'insufficientFilePermissions','appNotAuthorizedToFile','notFound','NOT_FOUND','storageQuotaExceeded','RATE_LIMIT_EXCEEDED','rateLimitExceeded','userRateLimitExceeded','dailyLimitExceeded','RESOURCE_EXHAUSTED','UNAUTHENTICATED','INVALID_ARGUMENT','badRequest','FAILED_PRECONDITION']);
async function sheetErrorReason(response){
 const reader=response.body?.getReader();if(!reader)return 'unknown';
 const chunks=[];let size=0;
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();return 'unknown';}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const body=JSON.parse(new TextDecoder().decode(bytes)),e=body?.error;
  const candidates=typeof e==='string'?[e]:[...(Array.isArray(e?.details)?e.details.map(d=>d?.reason):[]),...(Array.isArray(e?.errors)?e.errors.map(x=>x?.reason):[]),e?.status];
  return candidates.find(r=>knownSheetReasons.has(r))||'unknown';
 }catch{return 'unknown';}finally{reader.releaseLock();}
}
function sheetFailure(stage,status,reason){
 let message;
 if(reason==='invalid_grant')message='Koneksi Google portal perlu dihubungkan ulang: token akses kedaluwarsa atau dicabut.';
 else if(['invalid_client','unauthorized_client'].includes(reason))message='Konfigurasi OAuth Google portal tidak valid.';
 else if(['SERVICE_DISABLED','accessNotConfigured'].includes(reason))message=stage.startsWith('drive')?'Google Drive API belum aktif untuk koneksi portal.':'Google Sheets API belum aktif di project Google Cloud milik OAuth client SPH Portal.';
 else if(['ACCESS_TOKEN_SCOPE_INSUFFICIENT','insufficientPermissions','access_denied'].includes(reason))message='Izin token Google portal belum mencakup pengelolaan spreadsheet di Drive.';
 else if(['insufficientFilePermissions','appNotAuthorizedToFile','PERMISSION_DENIED'].includes(reason))message='Aplikasi belum diizinkan mengubah folder atau spreadsheet penilaian guide.';
 else if(['notFound','NOT_FOUND'].includes(reason)||status===404)message=stage.startsWith('sheet')?'Spreadsheet penilaian guide tidak ditemukan (mungkin terhapus). Pulihkan dari Sampah Drive; penyalinan dan penghapusan 6 minggu ditahan sampai spreadsheet kembali.':'Folder Google Drive portal tidak ditemukan atau belum dapat diakses.';
 else if(reason==='storageQuotaExceeded')message='Penyimpanan Google Drive portal penuh.';
 else if(['RATE_LIMIT_EXCEEDED','rateLimitExceeded','userRateLimitExceeded','dailyLimitExceeded','RESOURCE_EXHAUSTED'].includes(reason)||status===429)message='Batas penggunaan Google tercapai. Penyalinan dicoba lagi nanti.';
 else if(reason==='network_error')message='Google belum dapat dihubungi. Penyalinan dicoba lagi nanti.';
 else if(reason==='budget')message='Waktu penyalinan habis; sisanya disalin pada percobaan berikutnya.';
 else message=`Google menolak penyalinan penilaian (tahap ${stage}, HTTP ${status||'—'}).`;
 return new AppError(503,message,{service:'google_sheets',stage,upstream_status:status??null,reason});
}
function sheetClient(config,fetchImpl,deadline,tokenCache){
 const injected=typeof fetchImpl==='function';
 const send=injected?fetchImpl:globalThis.fetch.bind(globalThis);
 const cache=tokenCache===undefined?(injected?null:sheetAccessTokens):tokenCache;
 const cacheKey=createHash('sha256').update(JSON.stringify([config.clientId,config.clientSecret,config.refreshToken])).digest('hex');
 let access,pending;
 async function sheetCall(url,init,stage){
  const left=deadline-Date.now();
  // Tidak memulai panggilan baru menjelang batas waktu: lease tetap lebih panjang
  // dari panggilan terakhir yang mungkin masih berjalan.
  if(left<5000)throw sheetFailure(stage,null,'budget');
  let response;
  try{response=await send(url,{...init,redirect:'manual',signal:AbortSignal.timeout(Math.min(15000,left))});}catch{throw sheetFailure(stage,null,'network_error');}
  if(!response.ok){
   if(response.status===401&&stage!=='token'){access=undefined;cache?.delete(cacheKey);}
   throw sheetFailure(stage,response.status,await sheetErrorReason(response));
  }
  return response.json();
 }
 async function sheetAccessToken(){
  if(access)return access;
  const saved=cache?.get(cacheKey);if(saved&&saved.expiresAt>Date.now()){access=saved.access;return access;}
  if(!pending)pending=(async()=>{
   const j=await sheetCall(tokenApi,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:config.clientId,client_secret:config.clientSecret,refresh_token:config.refreshToken}).toString()},'token');
   assert(typeof j.access_token==='string'&&j.access_token.length>0&&j.access_token.length<8192,'Koneksi Google portal belum dapat diakses.',503);
   access=j.access_token;const lifetime=Math.min(Number(j.expires_in),3600);
   if(cache&&Number.isFinite(lifetime)&&lifetime>60){for(const [key,item]of cache)if(item.expiresAt<=Date.now())cache.delete(key);if(cache.size>=4&&!cache.has(cacheKey))cache.delete(cache.keys().next().value);cache.set(cacheKey,{access,expiresAt:Date.now()+(lifetime-60)*1000});}
   return access;
  })();
  try{return await pending;}finally{pending=undefined;}
 }
 const sheetAuthed=async(url,init,stage)=>sheetCall(url,{...init,headers:{...init.headers,Authorization:`Bearer ${await sheetAccessToken()}`}},stage);
 return {
  token:sheetAccessToken,
  read:(url,stage)=>sheetAuthed(url,{method:'GET',headers:{}},stage),
  write:(url,body,stage)=>sheetAuthed(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},stage)
 };
}

/* ---------------- Status dan lease (basis data) ---------------- */

export function visitSheetStatus(db,nowMs=Date.now()){
 const s=one(db,'SELECT * FROM visit_sheet_state WHERE id=1')||{};
 const c=one(db,'SELECT count(*) AS total,count(*) FILTER(WHERE sheet_row IS NULL) AS pending,count(*) FILTER(WHERE sheet_dirty=1) AS dirty,min(received_at) FILTER(WHERE sheet_row IS NULL) AS oldest FROM visit_evaluations');
 const files=all(db,'SELECT year,spreadsheet_id FROM visit_sheet_files ORDER BY year DESC').map(f=>({year:Number(f.year),url:`https://docs.google.com/spreadsheets/d/${f.spreadsheet_id}/edit`}));
 return {rows:Number(c.total),pending:Number(c.pending),dirty:Number(c.dirty),oldest_pending_at:c.oldest||null,
  running:Boolean(s.lease_until&&Date.parse(s.lease_until)>nowMs),last_attempt_at:s.last_attempt_at||null,last_success_at:s.last_success_at||null,
  last_error:s.last_error||null,last_error_at:s.last_error_at||null,last_retention_at:s.last_retention_at||null,folded_through:s.folded_through||null,
  folder_url:s.folder_id?`https://drive.google.com/drive/folders/${s.folder_id}`:null,files,retention_days:visitRules.retensiHari,max_age_days:visitRules.umurMaksHari};
}
function takeSheetLease(db,owner,nowMs,leaseSeconds,throttleSeconds){
 const stamp=new Date(nowMs).toISOString(),s=one(db,'SELECT lease_until,last_attempt_at FROM visit_sheet_state WHERE id=1');
 if(s.lease_until&&s.lease_until>stamp)return {ok:false,busy:true,retry_after_ms:Date.parse(s.lease_until)-nowMs};
 if(throttleSeconds&&s.last_attempt_at&&Date.parse(s.last_attempt_at)>nowMs-throttleSeconds*1000)return {ok:false,throttled:true,retry_after_ms:Date.parse(s.last_attempt_at)+throttleSeconds*1000-nowMs};
 const changed=run(db,'UPDATE visit_sheet_state SET lease_owner=?,lease_until=?,last_attempt_at=?,updated_at=? WHERE id=1 AND (lease_until IS NULL OR lease_until<=?)',owner,new Date(nowMs+leaseSeconds*1000).toISOString(),stamp,stamp,stamp);
 return changed.changes===1?{ok:true}:{ok:false,busy:true,retry_after_ms:5000};
}
function holdSheetLease(db,owner){
 const s=one(db,'SELECT lease_owner,lease_until FROM visit_sheet_state WHERE id=1');
 assert(s&&s.lease_owner===owner&&s.lease_until>now(),'Penyalinan spreadsheet diambil alih proses lain.',409);
}
function finishSheetRun(db,owner,error,keepLease){
 const stamp=now();
 if(!error){run(db,'UPDATE visit_sheet_state SET last_success_at=?,last_error=NULL,last_error_at=NULL,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=1 AND lease_owner=?',stamp,stamp,owner);return;}
 // Kegagalan saat menulis: lease dibiarkan habis sendiri, supaya tulisan yang
 // mungkin masih diproses Google tidak bertabrakan dengan percobaan berikutnya.
 if(keepLease)run(db,'UPDATE visit_sheet_state SET last_error=?,last_error_at=?,updated_at=? WHERE id=1 AND lease_owner=?',error.slice(0,300),stamp,stamp,owner);
 else run(db,'UPDATE visit_sheet_state SET last_error=?,last_error_at=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=1 AND lease_owner=?',error.slice(0,300),stamp,stamp,owner);
}
const chunked=(items,size)=>{const out=[];for(let i=0;i<items.length;i+=size)out.push(items.slice(i,i+size));return out;};
function groupBy(items,key){const map=new Map();for(const item of items){const k=key(item);if(!map.has(k))map.set(k,[]);map.get(k).push(item);}return map;}

/* ---------------- Folder, spreadsheet tahunan, dan tab bulanan ---------------- */

async function kunjunganFolderId(ctx){
 const {google,config}=ctx;
 const url=new URL(driveApi);
 url.searchParams.set('q',`'${config.folder}' in parents and trashed = false and mimeType = '${folderMime}' and appProperties has { key='sph_portal' and value='v1' } and appProperties has { key='sph_module' and value='kunjungan' }`);
 url.searchParams.set('fields','files(id,parents,trashed,mimeType,appProperties)');url.searchParams.set('pageSize','10');url.searchParams.set('orderBy','createdTime');
 const listing=await google.read(url.href,'drive-folder');
 const found=(listing.files||[]).find(f=>driveIdPattern.test(f.id||'')&&f.trashed===false&&f.mimeType===folderMime&&f.parents?.[0]===config.folder);
 if(found)return found.id;
 const created=await google.write(`${driveApi}?fields=id,parents,trashed,mimeType`,{name:kunjunganFolder,mimeType:folderMime,parents:[config.folder],appProperties:{sph_portal:'v1',sph_module:'kunjungan'}},'drive-folder');
 assert(driveIdPattern.test(created.id||'')&&created.mimeType===folderMime&&created.parents?.[0]===config.folder,'Folder SPH-Portal-Kunjungan belum dapat diverifikasi.',503);
 return created.id;
}
async function yearSpreadsheet(ctx,year){
 const {google,runTx}=ctx;
 const folderId=await kunjunganFolderId(ctx);
 const url=new URL(driveApi);
 url.searchParams.set('q',`'${folderId}' in parents and trashed = false and mimeType = '${spreadsheetMime}' and appProperties has { key='sph_kind' and value='penilaian-guide' } and appProperties has { key='sph_year' and value='${year}' }`);
 url.searchParams.set('fields','files(id,trashed,mimeType)');url.searchParams.set('pageSize','10');url.searchParams.set('orderBy','createdTime');
 const listing=await google.read(url.href,'drive-file');
 let id=(listing.files||[]).find(f=>driveIdPattern.test(f.id||'')&&f.trashed===false&&f.mimeType===spreadsheetMime)?.id;
 if(!id){
  const created=await google.write(`${driveApi}?fields=id,mimeType,parents`,{name:`Penilaian Guide ${year}`,mimeType:spreadsheetMime,parents:[folderId],
   appProperties:{sph_portal:'v1',sph_module:'kunjungan',sph_kind:'penilaian-guide',sph_year:String(year)}},'drive-file');
  assert(driveIdPattern.test(created.id||'')&&created.mimeType===spreadsheetMime,'Spreadsheet penilaian belum dapat diverifikasi.',503);
  id=created.id;
 }
 // Tab pertama bawaan Google dijadikan petunjuk; nama bawaannya bergantung bahasa akun.
 // Dicek juga untuk berkas yang ditemukan, karena pembuatannya bisa terputus.
 const meta=await sheetTabs(ctx,id);
 if(!meta.some(s=>s.title==='Petunjuk')&&meta.length===1&&!/^\d{4}-\d{2}$/.test(meta[0].title)){
  await google.write(`${sheetsApi}/${encodeURIComponent(id)}:batchUpdate`,{requests:[
   {updateSheetProperties:{properties:{sheetId:meta[0].sheetId,title:'Petunjuk',gridProperties:{rowCount:guideNotes.length+2,columnCount:1}},fields:'title,gridProperties.rowCount,gridProperties.columnCount'}},
   {updateCells:{range:{sheetId:meta[0].sheetId,startRowIndex:0,endRowIndex:guideNotes.length,startColumnIndex:0,endColumnIndex:1},rows:guideNotes.map((text,i)=>({values:[{userEnteredValue:{stringValue:text},userEnteredFormat:{textFormat:{bold:i===0},wrapStrategy:'WRAP'}}]})),fields:'userEnteredValue,userEnteredFormat(textFormat,wrapStrategy)'}},
   {updateDimensionProperties:{range:{sheetId:meta[0].sheetId,dimension:'COLUMNS',startIndex:0,endIndex:1},properties:{pixelSize:820},fields:'pixelSize'}}]},'sheet-structure');
 }
 return runTx(db=>{
  holdSheetLease(db,ctx.owner);
  run(db,'INSERT INTO visit_sheet_files(year,spreadsheet_id,created_at) VALUES(?,?,?) ON CONFLICT(year) DO NOTHING',year,id,now());
  run(db,'UPDATE visit_sheet_state SET folder_id=?,updated_at=? WHERE id=1',folderId,now());
  return one(db,'SELECT * FROM visit_sheet_files WHERE year=?',year);
 });
}
async function sheetTabs(ctx,spreadsheetId){
 const meta=await ctx.google.read(`${sheetsApi}/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent('sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))')}`,'sheet-meta');
 return (meta.sheets||[]).map(s=>({sheetId:Number(s.properties?.sheetId),title:String(s.properties?.title||''),rowCount:Number(s.properties?.gridProperties?.rowCount||0),columnCount:Number(s.properties?.gridProperties?.columnCount||0)}));
}
function monthTabRequests(title,sheetId,rows){
 return [
  {addSheet:{properties:{sheetId,title,gridProperties:{rowCount:rows,columnCount:visitSheetHeader.length,frozenRowCount:1}}}},
  {updateCells:{range:{sheetId,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:visitSheetHeader.length},
   rows:[{values:visitSheetHeader.map(h=>({userEnteredValue:{stringValue:h},userEnteredFormat:{textFormat:{bold:true},backgroundColor:{red:0.93,green:0.95,blue:0.97}}}))}],fields:'userEnteredValue,userEnteredFormat(textFormat,backgroundColor)'}},
  ...columnWidths.map((pixelSize,i)=>({updateDimensionProperties:{range:{sheetId,dimension:'COLUMNS',startIndex:i,endIndex:i+1},properties:{pixelSize},fields:'pixelSize'}})),
  // Peringatan saja (bukan kunci): pemilik Drive tetap bisa mengubah bila perlu.
  {addProtectedRange:{protectedRange:{range:{sheetId},description:'Dikelola SPH Portal — jangan mengurutkan, menyisipkan, atau menghapus baris.',warningOnly:true}}}
 ];
}
// Tab bulanan yang dibuat sebelum kolom N–T ada: tambah kolom dan tulis kepalanya.
function widenTabRequests(sheet){
 const start=sheet.columnCount,add=visitSheetHeader.length-start;if(add<=0)return [];
 return [
  {appendDimension:{sheetId:sheet.sheetId,dimension:'COLUMNS',length:add}},
  {updateCells:{range:{sheetId:sheet.sheetId,startRowIndex:0,endRowIndex:1,startColumnIndex:start,endColumnIndex:visitSheetHeader.length},
   rows:[{values:visitSheetHeader.slice(start).map(h=>({userEnteredValue:{stringValue:h},userEnteredFormat:{textFormat:{bold:true},backgroundColor:{red:0.93,green:0.95,blue:0.97}}}))}],fields:'userEnteredValue,userEnteredFormat(textFormat,backgroundColor)'}},
  ...columnWidths.slice(start).map((pixelSize,i)=>({updateDimensionProperties:{range:{sheetId:sheet.sheetId,dimension:'COLUMNS',startIndex:start+i,endIndex:start+i+1},properties:{pixelSize},fields:'pixelSize'}}))];
}
async function addMonthTabs(ctx,file,meta,titles,pendingByTab){
 const {runTx}=ctx,used=new Set(meta.map(s=>s.sheetId)),requests=[],added=[];
 for(const title of titles){
  let sheetId=Number(title.replace('-',''));while(used.has(sheetId))sheetId++;used.add(sheetId);
  const rows=Math.max(visitSheetLimits.growRows,(pendingByTab.get(title)?.length||0)+1);
  requests.push(...monthTabRequests(title,sheetId,rows));added.push({title,sheetId,rows});
 }
 await ctx.google.write(`${sheetsApi}/${encodeURIComponent(file.spreadsheet_id)}:batchUpdate`,{requests},'sheet-structure');
 await runTx(db=>{
  holdSheetLease(db,ctx.owner);const stamp=now();
  for(const t of added){
   // Tab yang hilang (mis. terhapus) membuat posisi lama tidak berlaku: barisnya disalin ulang.
   run(db,'UPDATE visit_evaluations SET sheet_tab=NULL,sheet_row=NULL,sheet_dirty=0,sheet_verified_at=NULL WHERE sheet_tab=?',t.title);
   run(db,`INSERT INTO visit_sheet_tabs(title,year,sheet_id,next_row,row_count,created_at,updated_at) VALUES(?,?,?,2,?,?,?)
    ON CONFLICT(title) DO UPDATE SET year=excluded.year,sheet_id=excluded.sheet_id,next_row=2,row_count=excluded.row_count,updated_at=excluded.updated_at`,t.title,Number(file.year),t.sheetId,t.rows,stamp,stamp);
  }
 });
 return added.length;
}
// Baca ulang kolom evaluationId sebuah tab dan cocokkan posisi semua baris bulan itu.
// Dipakai bila posisi tercatat tidak cocok (tab diurutkan/disisipi) atau catatan tab hilang.
async function rescanMonthTab(ctx,file,tab){
 const {runTx}=ctx,range=encodeURIComponent(`${quoteTab(tab.title)}!A2:A${Math.max(2,tab.rowCount)}`);
 const data=await ctx.google.read(`${sheetsApi}/${encodeURIComponent(file.spreadsheet_id)}/values/${range}?majorDimension=COLUMNS&valueRenderOption=UNFORMATTED_VALUE`,'sheet-read');
 const column=(data.values?.[0]||[]).map(v=>String(v??'').trim().toLowerCase());
 let last=1;const found=new Map();
 column.forEach((v,i)=>{if(!v)return;last=i+2;if(evaluationIdPattern.test(v)&&!found.has(v))found.set(v,i+2);});
 await runTx(db=>{
  holdSheetLease(db,ctx.owner);const stamp=now();
  run(db,'UPDATE visit_evaluations SET sheet_tab=NULL,sheet_row=NULL,sheet_dirty=0,sheet_verified_at=NULL WHERE sheet_tab=?',tab.title);
  const ids=all(db,'SELECT id FROM visit_evaluations WHERE wita_date>=? AND wita_date<=?',`${tab.title}-01`,`${tab.title}-31`).map(r=>r.id).filter(id=>found.has(id));
  // Baris yang ditemukan ditulis ulang utuh di posisinya; yang tidak ditemukan disalin lagi di akhir tab.
  for(const part of chunked(ids,200))run(db,`UPDATE visit_evaluations SET sheet_tab=?,sheet_row=CAST(v.column2 AS INTEGER),sheet_dirty=1,sheet_verified_at=NULL
   FROM (VALUES ${part.map(()=>'(?,?)').join(',')}) AS v WHERE visit_evaluations.id=v.column1 AND visit_evaluations.sheet_row IS NULL`,tab.title,...part.flatMap(id=>[id,String(found.get(id))]));
  run(db,`INSERT INTO visit_sheet_tabs(title,year,sheet_id,next_row,row_count,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
   ON CONFLICT(title) DO UPDATE SET year=excluded.year,sheet_id=excluded.sheet_id,next_row=excluded.next_row,row_count=excluded.row_count,updated_at=excluded.updated_at`,tab.title,Number(file.year),tab.sheetId,last+1,tab.rowCount,stamp,stamp);
 });
 return found.size;
}

/* ---------------- Penyalinan ---------------- */

async function copyRound(ctx,summary){
 const {google,runTx}=ctx,writtenBefore=summary.written+summary.rewritten;
 const work=await runTx(db=>({
  pending:all(db,'SELECT * FROM visit_evaluations WHERE sheet_row IS NULL ORDER BY received_at,id LIMIT ?',visitSheetLimits.batchRows),
  dirty:all(db,'SELECT * FROM visit_evaluations WHERE sheet_dirty=1 ORDER BY sheet_tab,sheet_row LIMIT ?',visitSheetLimits.dirtyRows),
  files:all(db,'SELECT * FROM visit_sheet_files'),tabs:all(db,'SELECT * FROM visit_sheet_tabs'),ruleOf:scoreRuleFinder(db)}));
 if(!work.pending.length&&!work.dirty.length)return {more:false,structural:false};
 const sheetRow=r=>visitSheetValues(r,work.ruleOf);
 const pendingByTab=groupBy(work.pending,r=>monthOfDay(r.wita_date)),dirtyByTab=groupBy(work.dirty,r=>r.sheet_tab);
 const tabRows=new Map(work.tabs.map(t=>[t.title,t])),files=new Map(work.files.map(f=>[Number(f.year),f]));
 const titles=[...new Set([...pendingByTab.keys(),...dirtyByTab.keys()])].sort();
 let structural=false;
 for(const year of [...new Set(titles.map(t=>Number(t.slice(0,4))))]){
  const file=files.get(year)||await yearSpreadsheet(ctx,year);
  const meta=await sheetTabs(ctx,file.spreadsheet_id),yearTitles=titles.filter(t=>t.startsWith(`${year}-`));
  const missing=[],grow=[],widen=[];let changed=false;
  for(const title of yearTitles){
   const sheet=meta.find(s=>s.title===title),known=tabRows.get(title);
   if(!sheet){missing.push(title);continue;}
   if(!known||Number(known.sheet_id)!==sheet.sheetId){await rescanMonthTab(ctx,file,{...sheet,title});summary.rescanned++;changed=true;continue;}
   const needed=Number(known.next_row)+(pendingByTab.get(title)?.length||0)-1;
   if(needed>sheet.rowCount)grow.push({title,sheetId:sheet.sheetId,add:Math.max(visitSheetLimits.growRows,needed-sheet.rowCount),rowCount:sheet.rowCount});
   if(sheet.columnCount<visitSheetHeader.length)widen.push(sheet);
  }
  if(missing.length){await addMonthTabs(ctx,file,meta,missing,pendingByTab);changed=true;}
  if(changed){structural=true;continue;}
  // Baris yang harus ditulis ulang: posisinya dipastikan masih memuat evaluationId yang sama.
  const rewrites=yearTitles.flatMap(t=>dirtyByTab.get(t)||[]);
  if(rewrites.length){
   const cells=[];
   for(const part of chunked(rewrites,visitSheetLimits.rangesPerRead)){
    const url=new URL(`${sheetsApi}/${encodeURIComponent(file.spreadsheet_id)}/values:batchGet`);
    for(const r of part)url.searchParams.append('ranges',`${quoteTab(r.sheet_tab)}!A${r.sheet_row}`);
    url.searchParams.set('valueRenderOption','UNFORMATTED_VALUE');
    const data=await google.read(url.href,'sheet-read');
    part.forEach((r,i)=>cells.push(String(data.valueRanges?.[i]?.values?.[0]?.[0]??'').trim().toLowerCase()));
   }
   const moved=[...new Set(rewrites.filter((r,i)=>cells[i]!==r.id).map(r=>r.sheet_tab))];
   if(moved.length){for(const title of moved){const sheet=meta.find(s=>s.title===title);await rescanMonthTab(ctx,file,{...sheet,title});summary.rescanned++;}structural=true;continue;}
  }
  if(grow.length||widen.length){
   await google.write(`${sheetsApi}/${encodeURIComponent(file.spreadsheet_id)}:batchUpdate`,{requests:[...grow.map(g=>({appendDimension:{sheetId:g.sheetId,dimension:'ROWS',length:g.add}})),...widen.flatMap(widenTabRequests)]},'sheet-structure');
   if(grow.length)await runTx(db=>{holdSheetLease(db,ctx.owner);for(const g of grow)run(db,'UPDATE visit_sheet_tabs SET row_count=?,updated_at=? WHERE title=?',g.rowCount+g.add,now(),g.title);});
   summary.widened+=widen.length;
  }
  const data=[],placed=[],nextRows=[];
  for(const title of yearTitles){
   const rows=pendingByTab.get(title)||[];if(!rows.length)continue;
   const start=Number(tabRows.get(title).next_row);
   data.push({range:`${quoteTab(title)}!A${start}:${lastColumn}${start+rows.length-1}`,majorDimension:'ROWS',values:rows.map(sheetRow)});
   rows.forEach((r,i)=>placed.push({id:r.id,title,row:start+i,status:r.status}));
   nextRows.push([title,start+rows.length]);
  }
  for(const r of rewrites)data.push({range:`${quoteTab(r.sheet_tab)}!A${r.sheet_row}:${lastColumn}${r.sheet_row}`,majorDimension:'ROWS',values:[sheetRow(r)]});
  // RAW: isi catatan seperti "=…" tetap teks, tidak pernah menjadi rumus.
  // Kebenaran tulisan dibuktikan saat verifikasi sebelum penghapusan, bukan dari balasan ini.
  ctx.writing=true;
  await google.write(`${sheetsApi}/${encodeURIComponent(file.spreadsheet_id)}/values:batchUpdate`,{valueInputOption:'RAW',data},'sheet-write');
  const stamp=now();
  await runTx(db=>{
   holdSheetLease(db,ctx.owner);
   // Status yang ditulis dibandingkan dengan status terkini: koreksi yang masuk
   // selama penyalinan membuat baris itu ditulis ulang pada putaran berikutnya.
   for(const [title,list] of groupBy(placed,p=>p.title))for(const part of chunked(list,150))run(db,`UPDATE visit_evaluations SET sheet_tab=?,sheet_row=CAST(v.column2 AS INTEGER),sheet_synced_at=?,sheet_verified_at=NULL,
    sheet_dirty=CASE WHEN visit_evaluations.status=v.column3 THEN 0 ELSE 1 END FROM (VALUES ${part.map(()=>'(?,?,?)').join(',')}) AS v WHERE visit_evaluations.id=v.column1 AND visit_evaluations.sheet_row IS NULL`,
    title,stamp,...part.flatMap(p=>[p.id,String(p.row),p.status]));
   for(const r of rewrites)run(db,'UPDATE visit_evaluations SET sheet_synced_at=?,sheet_verified_at=NULL,sheet_dirty=CASE WHEN status=? THEN 0 ELSE 1 END WHERE id=? AND sheet_tab=? AND sheet_row=?',stamp,r.status,r.id,r.sheet_tab,r.sheet_row);
   for(const [title,next] of nextRows)run(db,'UPDATE visit_sheet_tabs SET next_row=?,updated_at=? WHERE title=?',next,stamp,title);
  });
  ctx.writing=false;
  summary.written+=placed.length;summary.rewritten+=rewrites.length;
 }
 // Setelah menulis, putaran berikutnya membaca ulang: kiriman yang masuk selama
 // penyalinan ikut tersalin tanpa menunggu pemicu berikutnya.
 return {more:structural||summary.written+summary.rewritten>writtenBefore,structural};
}

/* ---------------- Retensi 6 minggu ---------------- */

// Baris tua dicocokkan ulang SEL DEMI SEL dengan spreadsheet sebelum dilipat.
async function verifyOldRows(ctx,summary,cutoff){
 const {google,runTx}=ctx;
 const work=await runTx(db=>({rows:all(db,'SELECT * FROM visit_evaluations WHERE wita_date<? AND sheet_row IS NOT NULL AND sheet_dirty=0 AND sheet_verified_at IS NULL ORDER BY sheet_tab,sheet_row LIMIT ?',cutoff,visitSheetLimits.verifyRows),
  files:all(db,'SELECT * FROM visit_sheet_files'),ruleOf:scoreRuleFinder(db)}));
 if(!work.rows.length)return;
 const files=new Map(work.files.map(f=>[Number(f.year),f]));
 const verified=[],stale=[],moved=new Set(),widths=new Map();
 for(const [title,rows] of groupBy(work.rows,r=>r.sheet_tab)){
  const file=files.get(Number(title.slice(0,4)));if(!file)continue;
  // Tab lama bisa masih 13 kolom: dibaca sampai lebarnya saja (Google menolak rentang
  // di luar grid), dan kolom yang belum ada dianggap kosong.
  if(!widths.has(file.year))widths.set(file.year,new Map((await sheetTabs(ctx,file.spreadsheet_id)).map(t=>[t.title,t.columnCount])));
  const width=Math.min(visitSheetHeader.length,Math.max(visitSheetLegacyColumns,widths.get(file.year).get(title)||visitSheetLegacyColumns)),readTo=columnLetter(width);
  const runs=[];
  for(const r of rows){const last=runs.at(-1);if(last&&Number(r.sheet_row)===last.end+1&&last.rows.length<500){last.end++;last.rows.push(r);}else runs.push({start:Number(r.sheet_row),end:Number(r.sheet_row),rows:[r]});}
  for(const part of chunked(runs,visitSheetLimits.rangesPerRead)){
   const url=new URL(`${sheetsApi}/${encodeURIComponent(file.spreadsheet_id)}/values:batchGet`);
   for(const span of part)url.searchParams.append('ranges',`${quoteTab(title)}!A${span.start}:${readTo}${span.end}`);
   url.searchParams.set('valueRenderOption','UNFORMATTED_VALUE');url.searchParams.set('majorDimension','ROWS');
   const data=await google.read(url.href,'sheet-read');
   part.forEach((span,i)=>span.rows.forEach((r,j)=>{
    const cells=data.valueRanges?.[i]?.values?.[j];
    const expected=visitSheetValues(r,work.ruleOf);
    // Kolom di luar lebar tab harus memang kosong (baris cara lama); selain itu tulis ulang.
    if(sameSheetRow(cells,expected.slice(0,width))&&expected.slice(width).every(v=>v===''))verified.push(r);
    else if(String(cells?.[0]??'').trim().toLowerCase()===r.id)stale.push(r);
    else moved.add(title);
   }));
  }
 }
 const stamp=now();
 await runTx(db=>{
  holdSheetLease(db,ctx.owner);
  for(const r of verified)run(db,'UPDATE visit_evaluations SET sheet_verified_at=? WHERE id=? AND sheet_tab=? AND sheet_row=? AND status=? AND sheet_dirty=0',stamp,r.id,r.sheet_tab,r.sheet_row,r.status);
  // Isi berbeda di posisi yang benar: ditulis ulang utuh pada penyalinan berikutnya.
  for(const r of stale)run(db,'UPDATE visit_evaluations SET sheet_dirty=1,sheet_verified_at=NULL WHERE id=?',r.id);
 });
 summary.verified+=verified.length;summary.rewrite_queued+=stale.length;
 for(const title of moved){
  const file=files.get(Number(title.slice(0,4))),sheet=(await sheetTabs(ctx,file.spreadsheet_id)).find(s=>s.title===title);
  if(sheet){await rescanMonthTab(ctx,file,{...sheet,title});summary.rescanned++;}
  else await runTx(db=>{holdSheetLease(db,ctx.owner);run(db,'UPDATE visit_evaluations SET sheet_tab=NULL,sheet_row=NULL,sheet_dirty=0,sheet_verified_at=NULL WHERE sheet_tab=?',title);run(db,'DELETE FROM visit_sheet_tabs WHERE title=?',title);});
 }
}
// Hari-hari yang SELURUH barisnya sudah terverifikasi dilipat ke ringkasan bulanan
// lalu dihapus, dalam satu transaksi. Hari yang masih punya baris belum cocok —
// dan semua hari sesudahnya — ditahan.
function foldVerifiedDays(db,owner,cutoff){
 holdSheetLease(db,owner);
 lockVisitEvaluations(db);
 const blocking=one(db,'SELECT min(wita_date) AS d FROM visit_evaluations WHERE wita_date<? AND (sheet_row IS NULL OR sheet_dirty=1 OR sheet_verified_at IS NULL)',cutoff)?.d||null;
 const through=blocking?shiftDate(blocking,-1):shiftDate(cutoff,-1);
 const count=Number(one(db,'SELECT count(*) AS n FROM visit_evaluations WHERE wita_date<=?',through).n);
 if(!count)return {days:0,deleted:0,blocked:Boolean(blocking)};
 const sums="count(*) AS antar,sum(uniform) AS uniform,sum(CASE WHEN uniform>=1 THEN 1 ELSE 0 END) AS uniform_patuh,sum(id_card) AS id_card,sum(review) AS review,sum(etika) AS etika,count(DISTINCT wita_date) AS hari";
 const groups=[
  ...all(db,`SELECT substr(wita_date,1,7) AS month,guide_id,pos,${sums} FROM visit_evaluations WHERE status='aktif' AND wita_date<=? GROUP BY substr(wita_date,1,7),guide_id,pos`,through),
  ...all(db,`SELECT substr(wita_date,1,7) AS month,guide_id,0 AS pos,${sums} FROM visit_evaluations WHERE status='aktif' AND wita_date<=? GROUP BY substr(wita_date,1,7),guide_id`,through),
  ...all(db,`SELECT substr(wita_date,1,7) AS month,'*' AS guide_id,0 AS pos,${sums} FROM visit_evaluations WHERE status='aktif' AND wita_date<=? GROUP BY substr(wita_date,1,7)`,through)];
 const stamp=now();
 for(const g of groups)run(db,`INSERT INTO visit_monthly_totals(month,guide_id,pos,antar,uniform,uniform_patuh,id_card,review,etika,hari,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(month,guide_id,pos) DO UPDATE SET antar=visit_monthly_totals.antar+excluded.antar,uniform=visit_monthly_totals.uniform+excluded.uniform,uniform_patuh=visit_monthly_totals.uniform_patuh+excluded.uniform_patuh,
  id_card=visit_monthly_totals.id_card+excluded.id_card,review=visit_monthly_totals.review+excluded.review,etika=visit_monthly_totals.etika+excluded.etika,hari=visit_monthly_totals.hari+excluded.hari,updated_at=excluded.updated_at`,
  g.month,g.guide_id,Number(g.pos),Number(g.antar),Number(g.uniform),Number(g.uniform_patuh),Number(g.id_card),Number(g.review),Number(g.etika),Number(g.hari),stamp);
 // Rekap harian per guide × pos: bahan laporan mingguan/bulanan dan Dashboard setelah
 // rinciannya dihapus. Ringkasan bulanan di atas tetap ditulis supaya versi kode
 // sebelumnya masih bisa dipakai bila rilis ini dibatalkan.
 // Cacah temuan "100 − potongan" ikut dilipat, sehingga nilai pengantaran periode lama
 // tetap bisa dihitung dengan aturan bulannya setelah rinciannya dihapus.
 for(const g of all(db,`SELECT wita_date AS day,guide_id,pos,count(*) AS antar,sum(uniform) AS uniform,sum(CASE WHEN uniform>=1 THEN 1 ELSE 0 END) AS uniform_patuh,sum(id_card) AS id_card,sum(review) AS review,sum(etika) AS etika,${visitFindingSums} FROM visit_evaluations WHERE status='aktif' AND wita_date<=? GROUP BY wita_date,guide_id,pos`,through))
  run(db,`INSERT INTO visit_daily_totals(day,guide_id,pos,sumber,antar,uniform,uniform_patuh,id_card,review,etika,updated_at,n_id,n_kurang,n_tidak,n_teguran) VALUES(?,?,?,'portal',?,?,?,?,?,?,?,?,?,?,?)
   ON CONFLICT(day,guide_id,pos,sumber) DO UPDATE SET antar=visit_daily_totals.antar+excluded.antar,uniform=visit_daily_totals.uniform+excluded.uniform,uniform_patuh=visit_daily_totals.uniform_patuh+excluded.uniform_patuh,
   id_card=visit_daily_totals.id_card+excluded.id_card,review=visit_daily_totals.review+excluded.review,etika=visit_daily_totals.etika+excluded.etika,updated_at=excluded.updated_at,
   n_id=visit_daily_totals.n_id+excluded.n_id,n_kurang=visit_daily_totals.n_kurang+excluded.n_kurang,n_tidak=visit_daily_totals.n_tidak+excluded.n_tidak,n_teguran=visit_daily_totals.n_teguran+excluded.n_teguran`,
   g.day,g.guide_id,Number(g.pos),Number(g.antar),Number(g.uniform),Number(g.uniform_patuh),Number(g.id_card),Number(g.review),Number(g.etika),stamp,Number(g.n_id),Number(g.n_kurang),Number(g.n_tidak),Number(g.n_teguran));
 const days=Number(one(db,'SELECT count(DISTINCT wita_date) AS n FROM visit_evaluations WHERE wita_date<=?',through).n);
 resolveFlagEvents(db,through);
 const deleted=run(db,'DELETE FROM visit_evaluations WHERE wita_date<=?',through).changes;
 run(db,'UPDATE visit_sheet_state SET folded_through=?,updated_at=? WHERE id=1',through,stamp);
 return {days,deleted:Number(deleted),blocked:Boolean(blocking)};
}
async function retentionPass(ctx,summary,nowMs){
 const {runTx}=ctx,cutoff=shiftDate(witaDate(nowMs),-visitRules.retensiHari);
 await verifyOldRows(ctx,summary,cutoff);
 const folded=await runTx(db=>foldVerifiedDays(db,ctx.owner,cutoff));
 summary.folded_days+=folded.days;summary.deleted+=folded.deleted;summary.retention_blocked=folded.blocked;
 // Retensi yang tertahan (baris belum cocok) dicoba lagi pada penyalinan berikutnya.
 if(!folded.blocked)await runTx(db=>{holdSheetLease(db,ctx.owner);run(db,'UPDATE visit_sheet_state SET last_retention_at=?,updated_at=? WHERE id=1',now(),now());});
}

/* ---------------- Titik masuk ---------------- */

// runTx(work) menjalankan work(db) dalam satu transaksi pendek dan mengembalikan hasilnya.
// trigger 'auto' (setelah kiriman pos) dibatasi frekuensinya; 'manual' dari portal tidak.
export async function runVisitSheetSync({runTx,env,fetchImpl,trigger='manual',tokenCache,retention='auto'}){
 const startedAt=Date.now(),config=visitSheetConfig(env),plan=visitSheetLimits.runs[trigger==='manual'?'manual':'auto'];
 if(!config.configured){
  const message='Koneksi Google Drive portal belum dikonfigurasi; penilaian tetap tersimpan di portal dan tidak ada yang dihapus.';
  await runTx(db=>{run(db,'UPDATE visit_sheet_state SET last_attempt_at=?,last_error=?,last_error_at=?,updated_at=? WHERE id=1 AND lease_owner IS NULL',now(),message,now(),now());});
  return {ok:false,configured:false,error:message};
 }
 const owner=randomUUID();
 const lease=await runTx(db=>takeSheetLease(db,owner,startedAt,plan.leaseSeconds,trigger==='manual'?0:visitSheetLimits.throttleSeconds));
 if(!lease.ok)return lease;
 const ctx={runTx,config,owner,writing:false,google:sheetClient(config,fetchImpl,startedAt+plan.budgetMs,tokenCache)};
 const summary={ok:true,written:0,rewritten:0,rescanned:0,widened:0,verified:0,rewrite_queued:0,folded_days:0,deleted:0};
 try{
  for(let round=0;round<4;round++){const r=await copyRound(ctx,summary);if(!r.more)break;}
  const state=await runTx(db=>one(db,'SELECT last_retention_at FROM visit_sheet_state WHERE id=1'));
  const due=retention==='force'||(retention==='auto'&&(!state.last_retention_at||Date.parse(state.last_retention_at)<Date.now()-visitSheetLimits.retentionEveryHours*3600000));
  if(due&&startedAt+plan.budgetMs-Date.now()>8000)await retentionPass(ctx,summary,Date.now());
  await runTx(db=>finishSheetRun(db,owner,null,false));
 }catch(error){
  const message=error instanceof AppError||Number.isInteger(error?.status)?error.message:'Penyalinan spreadsheet gagal karena kesalahan server.';
  if(!(error instanceof AppError||Number.isInteger(error?.status)))console.warn(JSON.stringify({event:'visit_sheet_error',name:error?.name||'Error'}));
  try{await runTx(db=>finishSheetRun(db,owner,message,ctx.writing||error?.details?.reason==='network_error'));}catch{/* lease habis sendiri */}
  summary.ok=false;summary.error=message;summary.stage=error?.details?.stage||null;
 }
 summary.status=await runTx(db=>visitSheetStatus(db,Date.now()));
 return summary;
}

// Setelah kiriman pos: sekali jalan, dan sekali lagi bila sedang dibatasi atau
// dipakai proses lain, supaya baris terakhir hari itu tidak menunggu kiriman besok.
export async function syncVisitSheetAfterSubmit(options){
 let result=await runVisitSheetSync({...options,trigger:'auto'});
 // Proses lain yang sedang berjalan bisa saja membaca antrean sebelum kiriman ini
 // tersimpan; karena itu dicoba lagi (paling banyak dua kali) setelah proses itu selesai.
 for(let attempt=0;attempt<2&&(result.throttled||result.busy);attempt++){
  await new Promise(resolve=>setTimeout(resolve,Math.min(Math.max(Number(result.retry_after_ms)||0,1000)+500,30000)));
  result=await runVisitSheetSync({...options,trigger:'auto'});
 }
 return result;
}

// Pemeriksaan koneksi tanpa membuat atau mengubah berkas apa pun.
export async function checkVisitSheetConnection({runTx,env,fetchImpl,tokenCache}){
 const config=visitSheetConfig(env),steps=[];
 const step=(key,label,ok,message)=>{steps.push({key,label,ok,message});return ok;};
 if(!step('config','Konfigurasi koneksi Google',config.configured,config.configured?'Lengkap.':'Secret GOOGLE_DRIVE_* belum lengkap di server.'))return {ok:false,steps};
 const google=sheetClient(config,fetchImpl,Date.now()+25000,tokenCache);
 try{await google.token();step('token','Token akses Google',true,'Berhasil diperbarui.');}
 catch(error){step('token','Token akses Google',false,error.message);return {ok:false,steps};}
 try{
  const meta=await google.read(`${driveApi}/${encodeURIComponent(config.folder)}?fields=id,mimeType,trashed`,'drive-folder');
  if(!step('drive','Folder Google Drive portal',meta.mimeType===folderMime&&meta.trashed===false,meta.mimeType===folderMime&&meta.trashed===false?'Dapat dibuka.':'Folder tujuan bukan folder aktif.'))return {ok:false,steps};
 }catch(error){step('drive','Folder Google Drive portal',false,error.message);return {ok:false,steps};}
 const file=await runTx(db=>one(db,'SELECT * FROM visit_sheet_files ORDER BY year DESC LIMIT 1'));
 try{
  if(file){await google.read(`${sheetsApi}/${encodeURIComponent(file.spreadsheet_id)}?fields=spreadsheetId`,'sheet-meta');step('sheets','Google Sheets API',true,`Spreadsheet ${file.year} dapat dibuka.`);}
  else{
   // Belum ada spreadsheet: ID fiktif membedakan "API aktif" (404) dari "API mati/izin kurang" (403).
   try{await google.read(`${sheetsApi}/sph-portal-pemeriksaan-koneksi-0000?fields=spreadsheetId`,'sheet-probe');step('sheets','Google Sheets API',true,'Aktif.');}
   catch(error){if(error?.details?.upstream_status===404||error?.details?.upstream_status===400)step('sheets','Google Sheets API',true,'Aktif. Spreadsheet tahun berjalan dibuat saat penilaian pertama disalin.');else throw error;}
  }
 }catch(error){step('sheets','Google Sheets API',false,error.message);}
 return {ok:steps.every(s=>s.ok),steps};
}
