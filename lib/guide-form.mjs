import {createHmac} from 'node:crypto';
import {one,run,insert,assert,now} from './db.mjs';
import {digest} from './auth.mjs';
import {formGuideList,ingestGuideEvaluations} from './visit-data.mjs';

// Formulir penilaian guide di /penilaian-guide/ (tanpa login, satu tautan per pos).
// Setiap permintaan memakai dua transaksi pendek, tanpa panggilan ke luar:
//   1. takeGuideFormIpSlot  — batas per IP (selalu tercatat, walau kiriman ditolak)
//   2. admitGuideForm → ingest → recordGuideFormResult — token → tautan aktif,
//      batas per tautan, pemeriksaan bentuk, aturan terima (visit-data.mjs), dan
//      catatan kiriman tanpa isi nilai.
// Penyalinan ke spreadsheet berjalan sesudahnya, di luar transaksi (visit-sheets.mjs).
export const guidePosts={1:'Pos 1 — Pintu Masuk',3:'Pos 3 — Pelataran Utama'};
export const guideFormLimits={context:60,submit:300,windowMinutes:10,batch:20,retentionDays:90};
export const invalidGuideLink='Tautan pos tidak aktif. Minta tautan pos terbaru kepada pengelola kunjungan.';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const guideId=/^G-\d{1,7}$/;
const actions=['context','submit'];

// Satu pernyataan atomik di SQLite dan PostgreSQL: aman tanpa kunci global.
function takeSlot(db,key,amount,limit){
 const stamp=now(),cutoff=new Date(Date.now()-guideFormLimits.windowMinutes*60000).toISOString();
 const row=one(db,`INSERT INTO guide_form_rate_limits(id,window_start,hits) VALUES(?,?,?)
  ON CONFLICT(id) DO UPDATE SET hits=CASE WHEN guide_form_rate_limits.window_start<? THEN excluded.hits ELSE guide_form_rate_limits.hits+excluded.hits END,
  window_start=CASE WHEN guide_form_rate_limits.window_start<? THEN excluded.window_start ELSE guide_form_rate_limits.window_start END
  RETURNING hits`,digest(key),stamp,amount,cutoff,cutoff);
 return Number(row.hits)<=limit;
}
function batchSize(action,b){return action==='submit'&&Array.isArray(b?.evaluations)?Math.min(Math.max(b.evaluations.length,1),guideFormLimits.batch):1;}

export function takeGuideFormIpSlot(db,action,clientIp,b){
 assert(actions.includes(action),'Alamat tidak ditemukan.',404);
 assert(typeof clientIp==='string'&&clientIp.length<=45&&/^[a-f0-9:.]+$/i.test(clientIp),'Permintaan tidak valid.',400);
 run(db,'DELETE FROM guide_form_rate_limits WHERE window_start<?',new Date(Date.now()-24*3600000).toISOString());
 return takeSlot(db,`guide-form\0${action}\0ip\0${clientIp}`,batchSize(action,b),guideFormLimits[action]);
}

// Pemeriksaan bentuk setiap penilaian. Aturan terima (jeda, koreksi, guide
// terdaftar, umur kiriman) ada di ingestGuideEvaluations.
export function checkGuideItem(item,pos){
 const errors=[];
 if(!item||typeof item!=='object'||Array.isArray(item))return ['penilaian tidak valid'];
 if(typeof item.evaluationId!=='string'||!uuid.test(item.evaluationId))errors.push('evaluationId harus UUID');
 if(typeof item.guideId!=='string'||!guideId.test(item.guideId.trim()))errors.push('guideId tidak valid');
 if(typeof item.guideName!=='string'||!item.guideName.trim()||item.guideName.length>200)errors.push('guideName wajib');
 if(Number(item.pos)!==pos)errors.push(`pos penilaian harus sama dengan pos tautan (Pos ${pos})`);
 if(typeof item.timestamp!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(item.timestamp)||isNaN(Date.parse(item.timestamp)))errors.push('timestamp harus ISO8601 dengan zona waktu');
 const c=item.criteria;
 if(!c||typeof c!=='object'||Array.isArray(c))errors.push('criteria wajib');
 else{
  if(typeof c.idCard!=='boolean')errors.push('criteria.idCard harus Ya/Tidak');
  if(![-1,1,2].includes(c.uniform))errors.push('criteria.uniform harus -1, 1, atau 2');
  if(c.etika!==undefined&&c.etika!==null&&!(Number.isInteger(c.etika)&&c.etika>=-5&&c.etika<=5))errors.push('criteria.etika harus bilangan bulat -5 sampai 5');
 }
 if(item.catatan!==undefined&&item.catatan!==null&&(typeof item.catatan!=='string'||item.catatan.length>500))errors.push('catatan maksimal 500 huruf');
 if(item.koreksiDari!==undefined&&item.koreksiDari!==null&&item.koreksiDari!==''&&(typeof item.koreksiDari!=='string'||!uuid.test(item.koreksiDari)||item.koreksiDari===item.evaluationId))errors.push('koreksiDari tidak valid');
 return errors;
}
const cleanItem=item=>{
 const out={evaluationId:item.evaluationId,guideId:item.guideId.trim(),guideName:item.guideName.trim(),pos:Number(item.pos),timestamp:item.timestamp,
  criteria:{idCard:item.criteria.idCard,uniform:item.criteria.uniform,etika:item.criteria.etika??0},catatan:typeof item.catatan==='string'?item.catatan:''};
 if(item.koreksiDari)out.koreksiDari=item.koreksiDari;return out;
};

// Mengembalikan {limited:true} alih-alih melempar, supaya hitungan batas tetap tersimpan.
export function admitGuideForm(db,action,b){
 assert(actions.includes(action),'Alamat tidak ditemukan.',404);
 assert(b&&typeof b==='object'&&typeof b.token==='string'&&/^[a-f0-9]{64}$/.test(b.token),invalidGuideLink,404);
 const link=one(db,'SELECT id,pos,label FROM guide_form_links WHERE token_hash=? AND is_active=1 AND revoked_at IS NULL',digest(b.token));
 assert(link,invalidGuideLink,404);
 const pos=Number(link.pos),items=[],rejected=[];
 if(action==='submit'){
  assert(Array.isArray(b.evaluations)&&b.evaluations.length>0,'Kiriman tidak berisi penilaian.',400);
  assert(b.evaluations.length<=guideFormLimits.batch,`Maksimal ${guideFormLimits.batch} penilaian per kiriman.`,413);
  const seen=new Set();
  for(const item of b.evaluations){
   const errors=checkGuideItem(item,pos);
   if(!errors.length&&seen.has(item.evaluationId))errors.push('evaluationId ganda dalam satu kiriman');
   if(errors.length){rejected.push({evaluationId:typeof item?.evaluationId==='string'&&uuid.test(item.evaluationId)?item.evaluationId:null,errors,local:true});continue;}
   seen.add(item.evaluationId);items.push(cleanItem(item));
  }
 }
 const allowed=takeSlot(db,`guide-form\0${action}\0link\0${link.id}`,batchSize(action,b),guideFormLimits[action]);
 if(!allowed)return {limited:true};
 return {link:{id:link.id,pos,label:link.label||guidePosts[pos]||`Pos ${pos}`},items,rejected};
}

export const guideFormContext=(db,link)=>({pos:link.pos,label:link.label,serverTime:now(),guides:formGuideList(db)});
export function submitGuideForm(db,admitted,nowMs=Date.now()){
 return admitted.items.length?ingestGuideEvaluations(db,admitted.link,admitted.items,nowMs):{accepted:[],rejected:[]};
}

// Kode alasan untuk penolakan bentuk; penolakan aturan terima sudah membawa kodenya.
const localReason=errors=>{const text=(errors||[]).join(' ');return /^pos penilaian/.test(text)?'POS':/timestamp/.test(text)?'WAKTU':'VALIDASI';};
export function ipFingerprint(clientIp,key){return typeof key==='string'&&key.length>=32?createHmac('sha256',key).update(String(clientIp)).digest('hex'):null;}

// Hanya hasil, pos, dan waktu yang dicatat — tanpa nama guide, nilai, atau catatan (ATR-KM-06).
export function recordGuideFormResult(db,admitted,result,ipHash){
 const stamp=now(),link=admitted.link;
 run(db,'DELETE FROM guide_form_submissions WHERE received_at<?',new Date(Date.now()-guideFormLimits.retentionDays*86400000).toISOString());
 const rows=[...result.accepted.map(a=>[a.evaluationId,a.duplicate?'DUPLICATE':'ACCEPTED',null]),
  ...admitted.rejected.filter(r=>r.evaluationId).map(r=>[r.evaluationId,'REJECTED',localReason(r.errors)]),
  ...result.rejected.map(r=>[r.evaluationId,'REJECTED',r.reason])];
 for(const [evaluationId,outcome,reason]of rows)if(typeof evaluationId==='string'&&uuid.test(evaluationId))insert(db,'guide_form_submissions',{link_id:link.id,pos:link.pos,evaluation_id:evaluationId.toLowerCase(),outcome,reason,received_at:stamp,ip_hmac:ipHash});
 return rows.length;
}

// Balasan ke HP: ✅ hanya untuk evaluationId yang benar-benar tersimpan.
export function guideFormReceipt(admitted,result){
 return {accepted:result.accepted.map(a=>({evaluationId:a.evaluationId,synced:true,duplicate:a.duplicate===true})),
  rejected:[...admitted.rejected.map(({local,...r})=>r),...result.rejected.map(({reason,...r})=>r)],serverTime:now()};
}
