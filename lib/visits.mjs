import {randomBytes} from 'node:crypto';
import {all,one,insert,update,tx,audit as localAudit,assert,date,now,today} from './db.mjs';
import {digest,has as localHas} from './auth.mjs';
import {guidePosts} from './guide-form.mjs';

// Ruang kerja Pengelolaan Kunjungan. Data penilaian dan guide tinggal di Google
// Spreadsheet NilaiGuide; database portal hanya memegang tautan pos dan catatan
// kiriman. Rute di sini dibagi dua:
//   - visitRoutes      : hanya database (tautan pos, catatan kiriman, audit ekspor)
//   - visitBridgePlan  : rute yang membaca/menulis spreadsheet. Pemanggil
//                        menjalankan jembatan DI LUAR transaksi, lalu
//                        visitBridgeFinish mencatat audit dalam transaksi pendek.
// Di produksi, gateway portal-api menyuntikkan `has` dan `audit` miliknya
// (deps) supaya tambalan izin produksi tetap berlaku, seperti modul Cuti.
const localDeps={has:localHas,audit:localAudit};
const posts=[1,3];
const regu=['A1','A2','D1','D2'];
const status=['aktif','diganti'];
const linkView=(db,link)=>link&&({id:link.id,pos:Number(link.pos),label:link.label,created_at:link.created_at,row_version:link.row_version,created_by_name:link.created_by?(one(db,'SELECT username FROM users WHERE id=?',link.created_by)?.username||''):''});
function requireAny(db,user,codes,has,message='Akses modul kunjungan ditolak.'){let allowed=false;for(const code of codes)if(has(db,user,code)){allowed=true;break;}assert(allowed,message,403);}
const month=v=>{assert(typeof v==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(v),'Bulan tidak valid.');return v;};
function range(url){
 const from=date(url?.searchParams.get('from')||today().slice(0,8)+'01','Tanggal mulai'),to=date(url?.searchParams.get('to')||today(),'Tanggal akhir');
 assert(from<=to,'Tanggal mulai harus sebelum tanggal akhir.');
 assert((Date.parse(to)-Date.parse(from))/86400000<366,'Rentang maksimal 366 hari.');
 return {from,to};
}
function newLink(db,user,pos){
 const token=randomBytes(32).toString('hex');
 const row=insert(db,'guide_form_links',{pos,label:guidePosts[pos],token_hash:digest(token),share_token:token,is_active:1,created_by:user.id});
 return {row,token};
}

export function visitRoutes({db,user,p,method,body:b={},url},deps=localDeps){
 if(p[0]!=='visits')return undefined;
 const {has,audit}=deps;
 if(p[1]==='links'&&p.length===2){
  if(method==='GET'){
   requireAny(db,user,['visits.forms.read','visits.forms.manage'],has);
   const since=new Date(Date.now()-86400000).toISOString();
   const items=posts.map(pos=>{
    const link=one(db,'SELECT * FROM guide_form_links WHERE pos=? AND is_active=1 AND revoked_at IS NULL',pos);
    const last=one(db,"SELECT received_at,outcome FROM guide_form_submissions WHERE pos=? AND outcome IN('ACCEPTED','DUPLICATE') ORDER BY received_at DESC LIMIT 1",pos);
    const day=one(db,"SELECT count(*) FILTER(WHERE outcome='ACCEPTED') accepted,count(*) FILTER(WHERE outcome='REJECTED') rejected FROM guide_form_submissions WHERE pos=? AND received_at>=?",pos,since);
    return {pos,label:guidePosts[pos],link:linkView(db,link)||null,last_received_at:last?.received_at||null,accepted_24h:Number(day?.accepted||0),rejected_24h:Number(day?.rejected||0)};
   });
   const recent=all(db,'SELECT pos,outcome,reason,received_at FROM guide_form_submissions ORDER BY received_at DESC LIMIT 30');
   return {items,recent,can_manage:has(db,user,'visits.forms.manage')};
  }
  assert(method==='POST','Metode tidak diizinkan.',405);
  assert(has(db,user,'visits.forms.manage'),'Hanya pengelola kunjungan yang dapat mengelola tautan pos.',403);
  assert(['create','rotate','revoke','copy'].includes(b.action),'Tindakan tautan tidak valid.');
  const pos=Number(b.pos);assert(posts.includes(pos),'Pos tidak valid.');
  return tx(db,()=>{
   const active=one(db,'SELECT * FROM guide_form_links WHERE pos=? AND is_active=1 AND revoked_at IS NULL',pos);
   // Pemeriksaan versi mencegah dialog lama mencabut tautan yang lebih baru.
   if(b.action==='create'){
    assert(!active,`Tautan aktif ${guidePosts[pos]} sudah ada. Gunakan Salin atau Ganti.`,409);
    const {row,token}=newLink(db,user,pos);audit(db,user,'CREATE','guide_form_links',row.id,{pos});
    return {link:linkView(db,row),token};
   }
   assert(active&&b.id===active.id&&b.row_version===active.row_version,'Tautan sudah berubah. Muat ulang halaman Tautan Pos.',409);
   if(b.action==='copy'){
    assert(typeof active.share_token==='string'&&digest(active.share_token)===active.token_hash,'Salinan tautan tidak tersedia. Gunakan Ganti tautan.',409);
    audit(db,user,'COPY_LINK','guide_form_links',active.id,{pos});return {link:linkView(db,active),token:active.share_token};
   }
   update(db,'guide_form_links',active.id,active.row_version,{is_active:0,revoked_at:now(),revoked_by:user.id,share_token:null});
   if(b.action==='revoke'){audit(db,user,'REVOKE','guide_form_links',active.id,{pos});return {link:null};}
   const {row,token}=newLink(db,user,pos);audit(db,user,'ROTATE','guide_form_links',row.id,{pos,replaced:active.id});
   return {link:linkView(db,row),token};
  });
 }
 if(p[1]==='activity'&&p.length===2&&method==='GET'){
  // Kiriman terakhir per pos untuk Dashboard, tanpa rincian tautan (ATR-RK-09).
  requireAny(db,user,['visits.dashboard.read','visits.forms.read'],has);
  const since=new Date(Date.now()-86400000).toISOString();
  return {items:posts.map(pos=>{
   const last=one(db,"SELECT received_at FROM guide_form_submissions WHERE pos=? AND outcome IN('ACCEPTED','DUPLICATE') ORDER BY received_at DESC LIMIT 1",pos);
   const day=one(db,"SELECT count(*) FILTER(WHERE outcome='ACCEPTED') accepted,count(*) FILTER(WHERE outcome='REJECTED') rejected FROM guide_form_submissions WHERE pos=? AND received_at>=?",pos,since);
   return {pos,label:guidePosts[pos],last_received_at:last?.received_at||null,accepted_24h:Number(day?.accepted||0),rejected_24h:Number(day?.rejected||0)};
  })};
 }
 if(p[1]==='exports'&&p.length===2&&method==='POST'){
  assert(has(db,user,'visits.reports.export'),'Akses ekspor kunjungan ditolak.',403);
  assert(['records','summary'].includes(b.kind),'Jenis ekspor tidak valid.');
  const from=date(b.from,'Tanggal mulai'),to=date(b.to,'Tanggal akhir');assert(from<=to,'Rentang tanggal tidak valid.');
  const rows=Number(b.rows);assert(Number.isInteger(rows)&&rows>=0&&rows<=200000,'Jumlah baris tidak valid.');
  return tx(db,()=>{audit(db,user,'EXPORT','visit_'+b.kind,`${from}..${to}`,{row_count:rows});return {ok:true};});
 }
 assert(false,'Alamat API tidak ditemukan.',404);
}

// Rute jembatan dikenali tanpa database supaya gateway bisa memilih jalurnya.
export function isVisitBridgeRequest(path,method){
 return (method==='GET'&&['visits/overview','visits/guides','visits/records','visits/reviews','visits/health'].includes(path))||(method==='POST'&&path==='visits/guides');
}

export function visitBridgePlan({db,user,p,method,body:b={},url},deps=localDeps){
 const path=p.join('/'),{has}=deps;
 if(!isVisitBridgeRequest(path,method))return undefined;
 assert(!user.must_change_password,'Anda wajib mengganti password sementara terlebih dahulu.',428);
 if(path==='visits/overview'){requireAny(db,user,['visits.dashboard.read','visits.reports.read'],has);return {operation:'overview',payload:range(url)};}
 if(path==='visits/records'){
  requireAny(db,user,['visits.records.read'],has);const r=range(url),q=url.searchParams;
  const limit=Number(q.get('limit')||200),offset=Number(q.get('offset')||0);
  assert(Number.isInteger(limit)&&limit>=1&&limit<=1000&&Number.isInteger(offset)&&offset>=0&&offset<=200000,'Halaman tidak valid.');
  const payload={...r,limit,offset};
  if(q.get('pos')){payload.pos=Number(q.get('pos'));assert([1,2,3].includes(payload.pos),'Pos tidak valid.');}
  if(q.get('regu')){payload.regu=q.get('regu');assert(regu.includes(payload.regu),'Regu tidak valid.');}
  if(q.get('status')){payload.status=q.get('status');assert(status.includes(payload.status),'Status tidak valid.');}
  if(q.get('guide')){payload.guideId=q.get('guide');assert(/^G-\d{1,7}$/.test(payload.guideId),'Guide tidak valid.');}
  return {operation:'records.list',payload};
 }
 if(path==='visits/reviews'){requireAny(db,user,['visits.reports.read'],has);return {operation:'reviews.month',payload:{month:month(url.searchParams.get('month')||today().slice(0,7))}};}
 if(path==='visits/health'){requireAny(db,user,['visits.forms.read','visits.forms.manage','visits.dashboard.read'],has);return {operation:'health',payload:{}};}
 if(method==='GET'){requireAny(db,user,['visits.guides.read','visits.guides.manage'],has);return {operation:'guides.list',payload:{}};}
 assert(has(db,user,'visits.guides.manage'),'Hanya pengelola kunjungan yang dapat mengubah data guide.',403);
 assert(b.guideId===undefined||b.guideId===null||b.guideId===''||(typeof b.guideId==='string'&&/^G-\d{1,7}$/.test(b.guideId)),'ID guide tidak valid.');
 assert(typeof b.guideName==='string'&&b.guideName.trim().length>0&&b.guideName.length<=120,'Nama guide wajib diisi (maksimal 120 huruf).');
 assert(['Asing','Domestik'].includes(b.kategori),'Kategori harus Asing atau Domestik.');
 const codes=(Array.isArray(b.regu)?b.regu:String(b.regu||'').split(',')).map(x=>String(x).trim()).filter(Boolean);
 assert(codes.length>0&&codes.length<=2&&codes.every(c=>regu.includes(c)),'Pilih regu yang valid.');
 assert(typeof b.aktif==='boolean','Status aktif wajib dipilih.');
 const payload={guideName:b.guideName.trim(),kategori:b.kategori,regu:codes.join(', '),aktif:b.aktif};if(b.guideId)payload.guideId=b.guideId;
 return {operation:'guides.upsert',payload,audit:{action:b.guideId?'UPDATE':'CREATE',type:'visit_guides',summary:{kategori:payload.kategori,regu:payload.regu,aktif:payload.aktif}}};
}

export function visitBridgeFinish({db,user,plan,data},deps=localDeps){
 if(plan.audit){
  const {audit}=deps;
  assert(typeof data.guideId==='string','Jawaban spreadsheet tidak lengkap.',503);
  audit(db,user,data.created?'CREATE':plan.audit.action,plan.audit.type,data.guideId,plan.audit.summary);
 }
 return data;
}
