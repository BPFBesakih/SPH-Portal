import {randomBytes} from 'node:crypto';
import {all,one,insert,update,tx,audit as localAudit,assert,date,now,today} from './db.mjs';
import {digest,has as localHas} from './auth.mjs';
import {guidePosts} from './guide-form.mjs';
import {reguCodes,parseGuideId,visitGuideList,saveVisitGuide,importVisitGuides,visitRecordPage,visitOverview,visitHistoryStatus,importVisitHistory,finishVisitHistory,cancelVisitHistory} from './visit-data.mjs';
import {visitSheetStatus} from './visit-sheets.mjs';
import {scoreRuleState,saveScoreRule,deleteScoreRule,findingTypeList,saveFindingType,assessorList,saveAssessor,formSettings,saveFormSettings,flagList,decideFlag,flagStatuses} from './visit-scoring.mjs';

// Ruang kerja Pengelolaan Kunjungan. Penilaian guide dan data guide disimpan di
// basis data portal (penilaian ±6 minggu) dan disalin ke spreadsheet tahunan di
// Drive portal (visit-sheets.mjs). Aplikasi NilaiGuide lama tidak disentuh.
//   - visitRoutes          : semua rute basis data, di dalam transaksi permintaan
//   - isVisitSheetAction   : penyalinan & pemeriksaan koneksi; pemanggil menjalankan
//                            panggilan Google DI LUAR transaksi permintaan
// Di produksi, gateway portal-api menyuntikkan `has` dan `audit` miliknya (deps)
// supaya tambalan izin produksi tetap berlaku, seperti modul Cuti.
const localDeps={has:localHas,audit:localAudit};
const posts=[1,3];
const statuses=['aktif','diganti'];
const linkView=(db,link)=>link&&({id:link.id,pos:Number(link.pos),label:link.label,created_at:link.created_at,row_version:link.row_version,created_by_name:link.created_by?(one(db,'SELECT username FROM users WHERE id=?',link.created_by)?.username||''):''});
function requireAny(db,user,codes,has,message='Akses modul kunjungan ditolak.'){let allowed=false;for(const code of codes)if(has(db,user,code)){allowed=true;break;}assert(allowed,message,403);}
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
 if(p[1]==='overview'&&p.length===2&&method==='GET'){
  requireAny(db,user,['visits.dashboard.read','visits.reports.read'],has);
  const r=range(url);return visitOverview(db,r.from,r.to);
 }
 if(p[1]==='records'&&p.length===2&&method==='GET'){
  requireAny(db,user,['visits.records.read'],has);
  const r=range(url),q=url.searchParams,limit=Number(q.get('limit')||200),offset=Number(q.get('offset')||0);
  assert(Number.isInteger(limit)&&limit>=1&&limit<=1000&&Number.isInteger(offset)&&offset>=0&&offset<=200000,'Halaman tidak valid.');
  const filter={...r,limit,offset};
  if(q.get('pos')){filter.pos=Number(q.get('pos'));assert(posts.includes(filter.pos),'Pos tidak valid.');}
  if(q.get('regu')){filter.regu=q.get('regu');assert(reguCodes.includes(filter.regu),'Regu tidak valid.');}
  if(q.get('status')){filter.status=q.get('status');assert(statuses.includes(filter.status),'Status tidak valid.');}
  if(q.get('guide')){const parsed=parseGuideId(q.get('guide'));assert(parsed,'Guide tidak valid.');filter.guideId=parsed.id;}
  return visitRecordPage(db,filter);
 }
 if(p[1]==='guides'&&p.length===2&&method==='GET'){
  requireAny(db,user,['visits.guides.read','visits.guides.manage'],has);
  return {items:visitGuideList(db),can_manage:has(db,user,'visits.guides.manage')};
 }
 if(p[1]==='guides'&&method==='POST'&&(p.length===2||(p.length===3&&p[2]==='import'))){
  assert(has(db,user,'visits.guides.manage'),'Hanya pengelola kunjungan yang dapat mengubah data guide.',403);
  return tx(db,()=>p.length===2?saveVisitGuide(db,user,b,audit):importVisitGuides(db,user,b,audit));
 }
 // Migrasi awal riwayat NilaiGuide (sekali). Membaca keadaannya boleh bagi yang
 // melihat Dashboard/Laporan; menjalankannya hanya Pengelola Kunjungan.
 if(p[1]==='history'&&p.length===2&&method==='GET'){
  requireAny(db,user,['visits.settings.manage','visits.dashboard.read','visits.reports.read'],has);
  return {...visitHistoryStatus(db),can_manage:has(db,user,'visits.settings.manage')};
 }
 if(p[1]==='history'&&p.length===3&&method==='POST'&&['import','finish','cancel'].includes(p[2])){
  assert(has(db,user,'visits.settings.manage'),'Hanya pengelola kunjungan yang dapat menjalankan migrasi awal NilaiGuide.',403);
  if(p[2]==='import')return tx(db,()=>importVisitHistory(db,user,b,audit));
  if(p[2]==='finish')return tx(db,()=>finishVisitHistory(db,user,b,audit));
  return tx(db,()=>cancelVisitHistory(db,user,b,audit));
 }
 // Penilaian "100 − potongan": aturan nilai per bulan, jenis temuan, petugas penilai,
 // dan petunjuk formulir pos. Semua yang melihat Dashboard/Laporan boleh membaca;
 // mengubah hanya Pengelola Kunjungan, dan setiap perubahan diaudit.
 if(p[1]==='scoring'&&p.length===2&&method==='GET'){
  requireAny(db,user,['visits.settings.manage','visits.dashboard.read','visits.reports.read'],has);
  const manage=has(db,user,'visits.settings.manage');
  return {aturan:scoreRuleState(db),jenis:findingTypeList(db),petugas:manage?assessorList(db):[],petunjuk:formSettings(db),can_manage:manage};
 }
 if(p[1]==='scoring'&&p.length===3&&method==='POST'&&['rule','rule-delete','types','assessors','form'].includes(p[2])){
  assert(has(db,user,'visits.settings.manage'),'Hanya pengelola kunjungan yang dapat mengubah aturan penilaian.',403);
  if(p[2]==='rule')return tx(db,()=>saveScoreRule(db,user,b,audit));
  if(p[2]==='rule-delete')return tx(db,()=>deleteScoreRule(db,user,b,audit));
  if(p[2]==='types')return tx(db,()=>saveFindingType(db,user,b,audit));
  if(p[2]==='assessors')return tx(db,()=>saveAssessor(db,user,b,audit));
  return tx(db,()=>saveFormSettings(db,user,b,audit));
 }
 // Pelanggaran berat & apresiasi dari HP pos: hanya Pengelola Kunjungan yang memutuskan.
 if(p[1]==='flags'&&p.length===2&&method==='GET'){
  requireAny(db,user,['visits.settings.manage','visits.dashboard.read','visits.reports.read'],has);
  const r=range(url),q=url.searchParams,filter={...r};
  if(q.get('status')){filter.status=q.get('status');assert(flagStatuses.includes(filter.status),'Status laporan tidak valid.');}
  if(q.get('jenis')){filter.jenis=q.get('jenis');assert(['berat','apresiasi'].includes(filter.jenis),'Jenis laporan tidak valid.');}
  return {...flagList(db,filter),can_decide:has(db,user,'visits.settings.manage')};
 }
 if(p[1]==='flags'&&p.length===3&&p[2]==='decide'&&method==='POST'){
  assert(has(db,user,'visits.settings.manage'),'Hanya pengelola kunjungan yang dapat memverifikasi laporan.',403);
  return tx(db,()=>decideFlag(db,user,b,audit));
 }
 if(p[1]==='sheet'&&p.length===2&&method==='GET'){
  requireAny(db,user,['visits.dashboard.read','visits.forms.read','visits.settings.manage'],has);
  const status=visitSheetStatus(db),manage=has(db,user,'visits.settings.manage');
  // Alamat berkas hanya untuk yang mengelola atau berhak mengekspor data penilaian.
  const links=manage||has(db,user,'visits.reports.export');
  return {...status,files:links?status.files:status.files.map(f=>({year:f.year})),folder_url:links?status.folder_url:null,can_sync:manage};
 }
 assert(false,'Alamat API tidak ditemukan.',404);
}

// Penyalinan dan pemeriksaan koneksi dikenali tanpa basis data supaya gateway bisa
// menjalankannya di luar transaksi permintaan (panggilan Google bisa lambat).
export const isVisitSheetAction=(path,method)=>method==='POST'&&(path==='visits/sheet/sync'||path==='visits/sheet/check');
export function authorizeVisitSheetAction({db,user},deps=localDeps){
 // `has` diambil sebagai nama sendiri: generator modul cloud hanya menambahkan
 // await pada pemanggilan nama, bukan deps.has(...).
 const {has}=deps;
 assert(!user.must_change_password,'Anda wajib mengganti password sementara terlebih dahulu.',428);
 assert(has(db,user,'visits.settings.manage'),'Hanya pengelola kunjungan yang dapat menjalankan penyalinan spreadsheet.',403);
 return true;
}
