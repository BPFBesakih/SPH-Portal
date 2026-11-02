/**
 * NilaiGuide Bridge for SPH-Portal (standalone Apps Script, NOT legacy Code.gs).
 * All data stays in Google Sheets. Deploy as web app "Anyone", executed as owner,
 * and require a 32+ byte BRIDGE_KEY via Script Properties for every operation.
 * Do not put credentials or spreadsheet IDs in the public GitHub repository.
 */
const GUIDE_HEADERS=['guideId','guideName','kategori','regu','aktif'];
const EVAL_HEADERS=['evaluationId','timestamp','pos','guideId','guideName','uniform','idCard','review','etika','catatan','receivedAt','koreksiDari','status'];
const TZ='Asia/Makassar';
const safe=(v)=>String(v==null?'':v).trim();
const respond=(data)=>ContentService.createTextOutput(JSON.stringify({ok:true,data:data})).setMimeType(ContentService.MimeType.JSON);
const fail=(error)=>ContentService.createTextOutput(JSON.stringify({ok:false,error:error&&error.message||'Permintaan gagal.'})).setMimeType(ContentService.MimeType.JSON);
function settings_(){
 const p=PropertiesService.getScriptProperties();
 const key=p.getProperty('BRIDGE_KEY'),active=p.getProperty('ACTIVE_SHEET_ID'),archive=p.getProperty('ARCHIVE_SHEET_ID');
 if(!key||key.length<48||!active||!archive||active===archive)throw Error('Konfigurasi tidak lengkap atau aktif dan arsip sama.');
 return {key,active,archive,enabled:p.getProperty('ENABLE_WRITES')==='true',cutover:p.getProperty('CUTOVER_DATE')};
}
function same_(a,b){
 if(typeof a!=='string'||a.length!==b.length)return false;
 let diff=0;for(let i=0;i<b.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;
}
function tab_(file,name){const sheet=SpreadsheetApp.openById(file).getSheetByName(name);if(!sheet)throw Error('Tab '+name+' belum tersedia.');return sheet;}
function raw_(sheet){return sheet.getLastRow()<2?[]:sheet.getRange(2,1,sheet.getLastRow()-1,sheet.getLastColumn()).getValues();}
function rows_(sheet,head){const h=sheet.getRange(1,1,1,head.length).getValues()[0].map(safe);if(h.join('|')!==head.join('|'))throw Error('Struktur tab '+sheet.getName()+' tidak cocok.');return raw_(sheet);}
function asIso_(d){const date=d instanceof Date?d:new Date(d);return isFinite(date.getTime())?date.toISOString():'';}
function wita_(d){return Utilities.formatDate(d,TZ,'yyyy-MM-dd');}
function asEval_(r){
 const o={};EVAL_HEADERS.forEach((h,i)=>{o[h]=r[i] instanceof Date?asIso_(r[i]):r[i]});
 return o;
}
function guides_(id){return rows_(tab_(id,'Guides'),GUIDE_HEADERS).filter(r=>safe(r[0])).map(r=>({guideId:safe(r[0]),guideName:safe(r[1]),kategori:safe(r[2]),regu:safe(r[3]),aktif:r[4]!==false&&safe(r[4]).toLowerCase()!=='false'}));}
function evaluations_(id){return rows_(tab_(id,'Evaluations'),EVAL_HEADERS).filter(r=>safe(r[0])).map(asEval_);}
function validDay_(x){return /^\d{4}-\d\d-\d\d$/.test(x||'')&&!isNaN(Date.parse(x));}
function dateOf_(e){return wita_(new Date(e.timestamp));}
function filtered_(id,p){if(!validDay_(p.from)||!validDay_(p.to)||p.from>p.to)throw Error('Rentang tanggal tidak valid.');
 return evaluations_(id).filter(e=>e.timestamp&&dateOf_(e)>=p.from&&dateOf_(e)<=p.to);}
function stats_(records,guideList){
 const active=records.filter(r=>safe(r.status).toLowerCase()!=='diganti');
 const gids=new Map(guideList.map(g=>[g.guideId,g]));const total=active.length;
 const pct=(n,d)=>d?Math.round(1000*n/d)/10:null;
 const mean=(n,d)=>d?Math.round(n*100/d)/100:null;
 const pos=[1,3].map(n=>{const items=active.filter(x=>Number(x.pos)===n);return {pos:n,trips:items.length,uniform_pct:pct(items.filter(x=>Number(x.uniform)>=1).length,items.length),id_pct:pct(items.filter(x=>Number(x.idCard)===1).length,items.length)};});
 const by_regu=['A1','A2','D1','D2'].map(regu=>{const a=active.filter(x=>(gids.get(safe(x.guideId))||{}).regu===regu);return {regu,trips:a.length,etika_avg:mean(a.reduce((n,x)=>n+Number(x.etika||0),0),a.length)};});
 return {summary:{active_guides:guideList.filter(x=>x.aktif).length,trips:total,today:active.filter(x=>dateOf_(x)===wita_(new Date())).length,guides_rated:new Set(active.map(x=>x.guideId)).size,uniform_pct:pct(active.filter(x=>Number(x.uniform)>=1).length,total),id_pct:pct(active.filter(x=>Number(x.idCard)===1).length,total),etika_avg:mean(active.reduce((n,x)=>n+Number(x.etika||0),0),total)},per_pos:pos,by_regu:by_regu};
}
function upsertGuide_(id,p){
 if(!/^[A-Z0-9-]{2,30}$/.test(p.guideId||'')||!safe(p.guideName)||safe(p.guideName).length>120)throw Error('Data guide tidak valid.');
 if(!['A1','A2','D1','D2'].includes(p.regu)||((p.regu[0]==='A')!==(p.kategori==='Asing')))throw Error('Regu tidak sesuai kategori.');
 if(typeof p.aktif!=='boolean')throw Error('Status tidak valid.');
 const lock=LockService.getScriptLock();if(!lock.tryLock(20000))throw Error('SERVER_BUSY');
 try{
  const sheet=tab_(id,'Guides'),rows=rows_(sheet,GUIDE_HEADERS),index=rows.findIndex(r=>safe(r[0])===p.guideId);
  const values=[p.guideId,safe(p.guideName),p.kategori,p.regu,p.aktif];
  if(index<0)sheet.appendRow(values);else sheet.getRange(index+2,1,1,5).setValues([values]);
  return {saved:true,guideId:p.guideId};
 }finally{lock.releaseLock();}
}
function submit_(id,p){
 const uid=safe(p.evaluationId),gid=safe(p.guideId),pos=Number(p.pos),uniform=Number(p.uniform),card=Number(p.idCard),etika=Number(p.etika),notes=safe(p.catatan||'');
 if(!/^[A-Za-z0-9_-]{15,72}$/.test(uid)||!gid||![1,3].includes(pos)||![-1,1,2].includes(uniform)||![0,1].includes(card)||!Number.isInteger(etika)||etika< -5||etika>5||notes.length>500)throw Error('Penilaian tidak valid.');
 const time=new Date(p.timestamp);if(!isFinite(time.getTime())||time.getTime()>Date.now()+300000||time.getTime()<Date.now()-7*86400000)throw Error('Waktu penilaian tidak valid.');
 const ss=SpreadsheetApp.openById(id),sheet=tab_(id,'Evaluations'),lock=LockService.getScriptLock();
 if(!lock.tryLock(20000))throw Error('SERVER_BUSY');
 try{
  const evaluations=rows_(sheet,EVAL_HEADERS);
  const existing=evaluations.find(r=>safe(r[0])===uid);
  if(existing)return {evaluationId:uid,duplicate:true,receivedAt:asIso_(existing[10])};
  const guide=guides_(id).find(x=>x.guideId===gid&&x.aktif);if(!guide)throw Error('Guide tidak ditemukan atau sudah nonaktif.');
  for(let i=evaluations.length-1;i>=0;i--){
   const r=evaluations[i];if(safe(r[3])!==gid||Number(r[2])!==pos||safe(r[12])==='diganti')continue;
   const old=new Date(r[1]);if(isFinite(old.getTime())&&Math.abs(time.getTime()-old.getTime())<15*60000)throw Error('Jeda penilaian guide dan pos belum 15 menit.');
  }
  sheet.appendRow([uid,time,pos,gid,guide.guideName,uniform,card,0,etika,notes,new Date(),'','aktif']);
  return {evaluationId:uid,duplicate:false,receivedAt:new Date().toISOString()};
 }finally{lock.releaseLock();}
}
function reviewArchive_(id,month){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))throw Error('Bulan tidak valid.');
 const ss=SpreadsheetApp.openById(id),guides=guides_(id),result=[],unmatched=[];
 for(const regu of ['A1','A2','D1','D2']){
  const sheet=ss.getSheetByName('Rekap '+regu+' '+month);if(!sheet)continue;
  if(sheet.getLastColumn()<4||sheet.getLastRow()<5)continue;
  const heads=sheet.getRange(2,1,1,sheet.getLastColumn()).getDisplayValues()[0],cols=[];
  heads.forEach((h,i)=>{const m=h.match(/^TGL:\s*(\d{1,2})-(\d{1,2})-(\d{4})/);if(m)cols.push({col:i+2,date:m[3]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[1]).slice(-2)});});
  const members=guides.filter(g=>g.regu===regu);
  const byName={};members.forEach(g=>{(byName[g.guideName]||(byName[g.guideName]=[])).push(g.guideId);});
  const rows=sheet.getRange(5,1,sheet.getLastRow()-4,sheet.getLastColumn()).getValues();
  for(const r of rows){
   const name=safe(r[0]);if(!name)continue;
   const candidates=byName[name]||[];
   for(const c of cols){
    const value=Number(r[c.col]);if(!Number.isFinite(value)||value===0)continue;
    if(candidates.length===1)result.push({guideId:candidates[0],guideName:name,regu,day:c.date,review:value});
    else unmatched.push({guideName:name,regu,day:c.date,review:value,reason:'ID ambigu'});
   }
  }
 }
 return {items:result,unmatched};
}
function dispatch_(s,operation,p){
 const active=s.active,archive=s.archive;
 if(operation==='guides.list')return {items:guides_(active)};
 if(operation==='guides.upsert'){if(!s.enabled)throw Error('Penulisan dinonaktifkan.');return upsertGuide_(active,p);}
 if(operation==='overview')return stats_(filtered_(active,p),guides_(active));
 if(operation==='records.list')return {items:filtered_(active,p).slice(-1000).reverse()};
 if(operation==='archive.list'){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(p.month||''))throw Error('Bulan tidak valid.');
  const offset=Number(p.offset),limit=Number(p.limit);
  if(!Number.isInteger(offset)||offset<0||offset>100000||!Number.isInteger(limit)||limit<1||limit>500)throw Error('Halaman arsip tidak valid.');
  const items=evaluations_(archive).filter(e=>e.timestamp&&dateOf_(e).startsWith(p.month));
  return {items:items.slice(offset,offset+limit),more:offset+limit<items.length};
 }
 if(operation==='archive.reviews')return reviewArchive_(archive,p.month);
 if(operation==='form.context')return {guides:guides_(active).filter(g=>g.aktif).map(g=>({guideId:g.guideId,guideName:g.guideName,regu:g.regu}))};
 if(operation==='form.submit'){if(!s.enabled)throw Error('Penulisan dinonaktifkan.');return submit_(active,p);}
 throw Error('Operasi tidak dikenal.');
}
function doPost(e){
 try{
  const input=JSON.parse(e.postData.contents);
  if(!input||typeof input!=='object')throw Error('Permintaan tidak valid.');
  const s=settings_();if(!same_(input.credential,s.key))throw Error('Akses ditolak.');
  if(typeof input.operation!=='string'||!input.payload||typeof input.payload!=='object'||Array.isArray(input.payload))throw Error('Permintaan tidak valid.');
  return respond(dispatch_(s,input.operation,input.payload));
 }catch(error){return fail(error);}
}
/** Run only once on a NEW blank operational spreadsheet; NEVER on the archive. */
function setupOperationalSheet(){
 const s=settings_(),ss=SpreadsheetApp.openById(s.active);
 if(ss.getSheets().some(x=>x.getName()==='Evaluations'))throw Error('Operational Evaluations already exists. Refusing to overwrite.');
 ss.setSpreadsheetTimeZone(TZ);
 const g=ss.getSheetByName('Guides')||ss.insertSheet('Guides');
 if(g.getLastRow()>0)throw Error('Guides tab already populated; refusing overwrite.');
 const gs=guides_(s.archive);g.getRange(1,1,1,5).setValues([GUIDE_HEADERS]);
 if(gs.length)g.getRange(2,1,gs.length,5).setValues(gs.map(x=>[x.guideId,x.guideName,x.kategori,x.regu,x.aktif]));
 const ev=ss.insertSheet('Evaluations');ev.getRange(1,1,1,13).setValues([EVAL_HEADERS]);
 return {copiedGuides:gs.length,activeSpreadsheet:s.active};
}
