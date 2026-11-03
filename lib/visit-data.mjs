import {all,one,run,insert,update,assert,now} from './db.mjs';

// Penilaian Guide di dalam portal. Aturan terima, rekap, dan peringkat dipindah
// dari aplikasi NilaiGuide (server-gas/03_Ingest.gs, 05_Ringkasan.gs,
// 08_Peringkat.gs) sebagai acuan; aplikasi itu sendiri tidak diubah.
// Rincian penilaian disimpan ±6 minggu. Setelah barisnya terbukti ada di
// spreadsheet tahunan, angkanya dilipat ke visit_monthly_totals (lihat
// visit-sheets.mjs) sehingga rentang lama dihitung dari ringkasan bulanan.
export const visitRules=Object.freeze({
 jedaMenit:15,          // dua penilaian guide+pos lebih rapat dari ini ditolak (salah pencet)
 umurMaksHari:30,       // kiriman offline lebih tua dari ini ditolak; harus < retensiHari
 retensiHari:42,        // rincian di basis data; lebih tua hanya di spreadsheet + ringkasan
 minimalPengantaran:5,  // syarat masuk tabel peringkat
 jumlahPeringkat:10,
 reviewMaks:20,
 importMaks:2000
});
export const reguInfo=Object.freeze([
 {kode:'A1',kategori:'Asing',nomor:1},{kode:'A2',kategori:'Asing',nomor:2},
 {kode:'D1',kategori:'Domestik',nomor:1},{kode:'D2',kategori:'Domestik',nomor:2}
]);
export const reguCodes=reguInfo.map(r=>r.kode);
const witaOffset=8*3600000;
// Asia/Makassar tidak memakai musim panas, jadi selisih tetap +8 jam.
export const witaDate=ms=>new Date(ms+witaOffset).toISOString().slice(0,10);
export const shiftDate=(day,days)=>new Date(Date.parse(day+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
export const monthLastDay=month=>{const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);};
const nextMonth=month=>{const [y,m]=month.split('-').map(Number);return m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,'0')}`;};
export function monthsBetween(fromMonth,toMonth){const out=[];for(let m=fromMonth;m<=toMonth;m=nextMonth(m))out.push(m);return out;}

/* ---------------- Penerimaan penilaian dari tautan pos ---------------- */

// items sudah lolos pemeriksaan bentuk (guide-form.mjs). Dijalankan di dalam
// transaksi; urutan di dalam satu kiriman dipertahankan seperti aplikasi lama,
// sehingga pencetan ganda di dalam SATU kiriman juga tertangkap pengaman jeda.
export function ingestGuideEvaluations(db,link,items,nowMs=Date.now()){
 const accepted=[],rejected=[];
 const receivedAt=new Date(nowMs).toISOString(),oldest=nowMs-visitRules.umurMaksHari*86400000;
 for(const item of items){
  const id=item.evaluationId.toLowerCase();
  const reject=(reason,message,extra={})=>{rejected.push({evaluationId:item.evaluationId,errors:[message],reason,...extra});};
  // Kiriman ulang selalu diakui lebih dulu, termasuk yang sudah tua, supaya HP
  // tidak menahan penilaian yang sebenarnya sudah tersimpan.
  if(one(db,'SELECT id FROM visit_evaluations WHERE id=?',id)){accepted.push({evaluationId:item.evaluationId,duplicate:true});continue;}
  const clientMs=Date.parse(item.timestamp);
  if(clientMs<oldest){reject('WAKTU',`Penilaian ini tertahan di HP lebih dari ${visitRules.umurMaksHari} hari, jadi tidak bisa dikirim lewat tautan pos. Ekspor riwayat dari HP lalu serahkan ke pengelola kunjungan.`);continue;}
  // Jam HP yang terlalu cepat tidak boleh memindahkan penilaian ke tanggal yang
  // belum terjadi: penilaian pasti dibuat sebelum diterima server.
  const ms=Math.min(clientMs,nowMs),evaluatedAt=new Date(ms).toISOString(),day=witaDate(ms);
  // Guide nonaktif tetap diterima: penilaiannya mungkin dibuat sebelum dinonaktifkan.
  const guide=one(db,'SELECT id,name FROM visit_guides WHERE id=?',item.guideId);
  if(!guide){reject('GUIDE',`Guide ${item.guideId} tidak terdaftar di Data Guide portal. Muat ulang daftar guide di HP lalu nilai ulang.`);continue;}
  const replaces=item.koreksiDari?item.koreksiDari.toLowerCase():null;
  if(replaces){
   // Koreksi salah pencet: baris lama tidak dihapus, hanya ditandai 'diganti'.
   const original=one(db,'SELECT id,guide_id,pos,wita_date,status FROM visit_evaluations WHERE id=?',replaces);
   if(!original){reject('KOREKSI',`Penilaian yang diperbaiki (${item.koreksiDari}) tidak ada di server.`);continue;}
   if(original.status!=='aktif'){reject('KOREKSI','Penilaian itu sudah pernah diperbaiki oleh penilaian lain.');continue;}
   // Hanya untuk guide, pos, dan tanggal yang sama, supaya "koreksi" tidak dipakai
   // menyelundupkan penilaian tambahan.
   if(original.guide_id!==guide.id||Number(original.pos)!==link.pos||original.wita_date!==day){reject('KOREKSI','Koreksi harus untuk guide, pos, dan tanggal yang sama.');continue;}
   run(db,"UPDATE visit_evaluations SET status='diganti',replaced_by=?,sheet_dirty=CASE WHEN sheet_row IS NULL THEN 0 ELSE 1 END,sheet_verified_at=NULL WHERE id=? AND status='aktif'",id,original.id);
  }else{
   // Pengaman jeda, lintas hari dan lintas HP: hanya server yang melihat semua pos.
   // Selisih mutlak, karena entri offline bisa tiba belakangan dengan jam lebih awal.
   const low=new Date(ms-visitRules.jedaMenit*60000).toISOString(),high=new Date(ms+visitRules.jedaMenit*60000).toISOString();
   const clash=one(db,"SELECT id,evaluated_at FROM visit_evaluations WHERE guide_id=? AND pos=? AND status='aktif' AND evaluated_at>? AND evaluated_at<? ORDER BY evaluated_at LIMIT 1",guide.id,link.pos,low,high);
   if(clash){
    const minutes=Math.round(Math.abs(Date.parse(clash.evaluated_at)-ms)/60000);
    reject('JEDA',`${guide.name} baru saja dinilai di Pos ${link.pos} (${minutes} menit dari penilaian ini) — jeda minimal ${visitRules.jedaMenit} menit, jadi ini hampir pasti salah pencet. Kalau memang pengantaran berikutnya, tunggu jedanya habis. Untuk membetulkan nilainya, kirim koreksi.`,{terlaluCepat:true,sudahDinilai:true,aktifSaatIni:clash.id});
    continue;
   }
  }
  const c=item.criteria,etika=Math.min(5,Math.max(-5,Math.round(Number(c.etika)||0)));
  run(db,`INSERT INTO visit_evaluations(id,link_id,pos,guide_id,guide_name,uniform,id_card,review,etika,catatan,evaluated_at,wita_date,received_at,koreksi_dari,status)
   VALUES(?,?,?,?,?,?,?,0,?,?,?,?,?,?,'aktif')`,id,link.id,link.pos,guide.id,guide.name,c.uniform,c.idCard?1:0,etika,String(item.catatan||'').slice(0,500),evaluatedAt,day,receivedAt,replaces);
  accepted.push({evaluationId:item.evaluationId,duplicate:false});
 }
 return {accepted,rejected};
}

/* ---------------- Data guide ---------------- */

const guideView=g=>({guideId:g.id,guideName:g.name,kategori:g.kategori,regu:g.regu,aktif:Number(g.is_active)===1,row_version:Number(g.row_version)});
export const visitGuideList=db=>all(db,'SELECT * FROM visit_guides ORDER BY seq').map(guideView);
export const formGuideList=db=>all(db,'SELECT id,name,kategori,regu FROM visit_guides WHERE is_active=1 ORDER BY name,seq').map(g=>({guideId:g.id,guideName:g.name,kategori:g.kategori,regu:g.regu}));

export function parseGuideId(value){
 const m=/^G-(\d{1,7})$/.exec(String(value??'').trim().toUpperCase());
 return m&&Number(m[1])>=1?{id:`G-${m[1]}`,seq:Number(m[1])}:null;
}
const cleanName=value=>typeof value==='string'||typeof value==='number'?String(value).trim().replace(/\s+/g,' '):'';
export function normalizeKategori(value){const v=String(value??'').trim().toLowerCase();return v==='asing'?'Asing':v==='domestik'?'Domestik':null;}
export function normalizeRegu(value){
 const codes=[...new Set((Array.isArray(value)?value:String(value??'').split(/[,;/]/)).map(x=>String(x).trim().toUpperCase()).filter(Boolean))];
 return codes.length>=1&&codes.length<=2&&codes.every(c=>reguCodes.includes(c))?codes.join(', '):null;
}
function parseActive(value){
 if(value===undefined||value===null||value==='')return true;
 if(typeof value==='boolean')return value;
 if(typeof value==='number')return value!==0;
 const v=String(value).trim().toLowerCase();
 if(['true','ya','y','1','aktif','yes'].includes(v))return true;
 if(['false','tidak','t','0','nonaktif','tidak aktif','no'].includes(v))return false;
 return null;
}
const nameKey=name=>name.toLocaleLowerCase('id').replace(/\s+/g,' ').trim();
const sharesRegu=(a,b)=>a.split(', ').some(code=>b.split(', ').includes(code));
// Nama kembar di regu yang sama membingungkan rekap per regu; di regu berbeda dibiarkan
// (aturan tab Guides lama: kembar seregu diberi pembeda dalam kurung).
const twinOf=(guides,candidate)=>guides.find(g=>g.id!==candidate.id&&nameKey(g.name)===nameKey(candidate.name)&&sharesRegu(g.regu,candidate.regu));
const formatGuideId=seq=>`G-${String(seq).padStart(3,'0')}`;

export function saveVisitGuide(db,user,b,audit){
 const name=cleanName(b.guideName);
 assert(name.length>=1&&name.length<=120,'Nama guide wajib diisi (maksimal 120 huruf).');
 const kategori=normalizeKategori(b.kategori);assert(kategori,'Kategori harus Asing atau Domestik.');
 const regu=normalizeRegu(b.regu);assert(regu,'Pilih regu yang valid: A1, A2, D1, atau D2 (paling banyak dua).');
 assert(typeof b.aktif==='boolean','Status aktif wajib dipilih.');
 const guides=all(db,'SELECT id,name,regu FROM visit_guides');
 if(b.guideId!==undefined&&b.guideId!==null&&b.guideId!==''){
  const parsed=parseGuideId(b.guideId);assert(parsed,'ID guide tidak valid.');
  const current=one(db,'SELECT * FROM visit_guides WHERE id=?',parsed.id);assert(current,'Guide tidak ditemukan.',404);
  const twin=twinOf(guides,{id:current.id,name,regu});
  assert(!twin,`Nama ini sudah dipakai ${twin?.id} di regu yang sama. Beri pembeda dalam kurung, misalnya "${name} (2)".`,409);
  const saved=update(db,'visit_guides',current.id,b.row_version,{name,kategori,regu,is_active:b.aktif?1:0,updated_by:user.id});
  audit(db,user,'UPDATE','visit_guides',current.id,{kategori,regu,aktif:b.aktif});
  return {...guideView(saved),created:false};
 }
 const twin=twinOf(guides,{id:null,name,regu});
 assert(!twin,`Nama ini sudah dipakai ${twin?.id} di regu yang sama. Beri pembeda dalam kurung, misalnya "${name} (2)".`,409);
 const seq=Number(one(db,'SELECT coalesce(max(seq),0) AS n FROM visit_guides').n)+1;
 const saved=insert(db,'visit_guides',{id:formatGuideId(seq),seq,name,kategori,regu,is_active:b.aktif?1:0,created_by:user.id,updated_by:user.id});
 audit(db,user,'CREATE','visit_guides',saved.id,{kategori,regu,aktif:b.aktif});
 return {...guideView(saved),created:true};
}

// Impor daftar guide dari berkas (tab Guides lama diunduh sebagai .xlsx/.csv).
// Berkas dibaca di peramban; server memeriksa ulang setiap baris. Pratinjau dulu
// (apply=false), lalu terapkan. Guide yang tidak ada di berkas tidak diubah.
export function importVisitGuides(db,user,b,audit){
 assert(Array.isArray(b.rows)&&b.rows.length>0,'Berkas tidak berisi baris guide.');
 assert(b.rows.length<=visitRules.importMaks,`Maksimal ${visitRules.importMaks} baris per impor.`,413);
 const existing=new Map(all(db,'SELECT * FROM visit_guides').map(g=>[g.id,g]));
 const seqOwner=new Map([...existing.values()].map(g=>[Number(g.seq),g.id]));
 const errors=[],plan=[],seen=new Map();
 b.rows.forEach((r,index)=>{
  const line=Number.isInteger(r?.line)&&r.line>0&&r.line<1000000?r.line:index+2;
  if(!r||typeof r!=='object'||Array.isArray(r)){errors.push({line,message:'Baris tidak valid.'});return;}
  const problems=[];let parsed=null;
  if(r.guideId!==undefined&&r.guideId!==null&&String(r.guideId).trim()!==''){
   parsed=parseGuideId(r.guideId);
   if(!parsed)problems.push('ID guide harus berbentuk G-angka, misalnya G-001');
   else if(seen.has(parsed.seq))problems.push(`ID ${parsed.id} sudah ada di baris ${seen.get(parsed.seq)}`);
   else{seen.set(parsed.seq,line);const owner=seqOwner.get(parsed.seq);if(owner&&owner!==parsed.id)problems.push(`ID ${parsed.id} bentrok dengan ${owner} yang sudah tersimpan`);}
  }
  const name=cleanName(r.guideName);if(!name||name.length>120)problems.push('Nama guide wajib diisi (maksimal 120 huruf)');
  const kategori=normalizeKategori(r.kategori);if(!kategori)problems.push('Kategori harus Asing atau Domestik');
  const regu=normalizeRegu(r.regu);if(!regu)problems.push('Regu harus A1, A2, D1, atau D2 (paling banyak dua, dipisah koma)');
  const active=parseActive(r.aktif);if(active===null)problems.push('Kolom aktif harus TRUE/FALSE atau Ya/Tidak');
  if(problems.length){errors.push({line,message:problems.join('; ')});return;}
  plan.push({line,id:parsed?.id||null,seq:parsed?.seq||null,name,kategori,regu,is_active:active?1:0});
 });
 // Nama kembar seregu diperiksa pada hasil akhir (data tersimpan + isi berkas).
 const finalGuides=new Map([...existing.values()].map(g=>[g.id,{id:g.id,name:g.name,regu:g.regu}]));
 plan.forEach((p,i)=>{finalGuides.set(p.id||`baris-${i}`,{id:p.id||`baris-${i}`,name:p.name,regu:p.regu});});
 const warnings=[];
 plan.forEach((p,i)=>{const key=p.id||`baris-${i}`,twin=twinOf([...finalGuides.values()],{id:key,name:p.name,regu:p.regu});if(twin)warnings.push({line:p.line,message:`Nama "${p.name}" juga dipakai ${twin.id.startsWith('baris-')?'baris lain di berkas':twin.id} di regu yang sama`});});
 let created=0,changed=0,unchanged=0;
 for(const p of plan){
  const current=p.id&&existing.get(p.id);
  if(!current)created++;
  else if(current.name===p.name&&current.kategori===p.kategori&&current.regu===p.regu&&Number(current.is_active)===p.is_active)unchanged++;
  else changed++;
 }
 const summary={total:b.rows.length,create:created,update:changed,unchanged,error_count:errors.length,errors:errors.slice(0,100),warning_count:warnings.length,warnings:warnings.slice(0,100)};
 if(b.apply!==true)return {...summary,applied:false};
 assert(!errors.length,`${errors.length} baris belum valid. Perbaiki berkasnya lalu impor ulang.`);
 let next=Math.max(0,...[...existing.values()].map(g=>Number(g.seq)),...plan.filter(p=>p.seq).map(p=>p.seq))+1;
 const stamp=now();
 for(const p of plan){
  const current=p.id&&existing.get(p.id);
  if(!current){
   const seq=p.seq||next++;
   insert(db,'visit_guides',{id:p.id||formatGuideId(seq),seq,name:p.name,kategori:p.kategori,regu:p.regu,is_active:p.is_active,created_by:user.id,updated_by:user.id});
  }else if(!(current.name===p.name&&current.kategori===p.kategori&&current.regu===p.regu&&Number(current.is_active)===p.is_active)){
   run(db,'UPDATE visit_guides SET name=?,kategori=?,regu=?,is_active=?,updated_by=?,updated_at=?,row_version=row_version+1 WHERE id=?',p.name,p.kategori,p.regu,p.is_active,user.id,stamp,p.id);
  }
 }
 audit(db,user,'IMPORT','visit_guides','berkas',{created,updated:changed,unchanged,rows:b.rows.length});
 return {...summary,applied:true};
}

/* ---------------- Daftar penilaian ---------------- */

const recordView=r=>({evaluationId:r.id,timestamp:r.evaluated_at,tanggal:r.wita_date,pos:Number(r.pos),guideId:r.guide_id,guideName:r.guide_name,regu:r.regu||'',
 uniform:Number(r.uniform),idCard:Number(r.id_card),etika:Number(r.etika),review:Number(r.review),catatan:r.catatan||'',receivedAt:r.received_at,
 koreksiDari:r.koreksi_dari||'',status:r.status,digantiOleh:r.replaced_by||''});
export function visitRecordPage(db,q){
 const where=['e.wita_date>=?','e.wita_date<=?'],args=[q.from,q.to];
 if(q.pos){where.push('e.pos=?');args.push(q.pos);}
 if(q.status){where.push('e.status=?');args.push(q.status);}
 if(q.guideId){where.push('e.guide_id=?');args.push(q.guideId);}
 if(q.regu){where.push('g.regu LIKE ?');args.push(`%${q.regu}%`);}
 const from=` FROM visit_evaluations e LEFT JOIN visit_guides g ON g.id=e.guide_id WHERE ${where.join(' AND ')}`;
 const total=Number(one(db,`SELECT count(*) AS n${from}`,...args).n);
 const items=all(db,`SELECT e.*,g.regu${from} ORDER BY e.evaluated_at DESC,e.id LIMIT ? OFFSET ?`,...args,q.limit,q.offset).map(recordView);
 return {items,total,more:q.offset+items.length<total,folded_through:one(db,'SELECT folded_through FROM visit_sheet_state WHERE id=1')?.folded_through||null};
}

/* ---------------- Rekap dan peringkat ---------------- */

const emptyStat=()=>({antar:0,uniform:0,idCard:0,review:0,etika:0,uniformPatuh:0});
function addStat(target,n){target.antar+=n.antar;target.uniform+=n.uniform;target.idCard+=n.idCard;target.review+=n.review;target.etika+=n.etika;target.uniformPatuh+=n.uniformPatuh;return target;}
function statFor(map,key){let s=map.get(key);if(!s){s=emptyStat();map.set(key,s);}return s;}
// Rata-rata per pengantaran; tanpa pengantaran hasilnya null, bukan 0.
const visitFigures=s=>{const antar=s?s.antar:0;return {pengantaran:antar,persenUniform:antar?s.uniformPatuh/antar:null,persenId:antar?s.idCard/antar:null,mutuUniform:antar?s.uniform/antar:null,rataEtika:antar?s.etika/antar:null};};
function rankBy(list,key,ascending,count){
 // Nilai sama: pengantaran lebih banyak didahulukan (bukti lebih banyak), lalu nama.
 return list.slice().sort((a,b)=>{const diff=ascending?a[key]-b[key]:b[key]-a[key];if(diff)return diff;if(a.antar!==b.antar)return b.antar-a.antar;const x=a.nama.toLowerCase(),y=b.nama.toLowerCase();return x<y?-1:x>y?1:0;}).slice(0,count);
}

// Rentang yang menyentuh tanggal yang sudah dilipat hanya bisa dihitung per bulan
// penuh, karena ringkasan lama disimpan per bulan.
export function visitPeriod(db,from,to){
 const folded=one(db,'SELECT folded_through FROM visit_sheet_state WHERE id=1')?.folded_through||null;
 if(!folded||from>folded)return {from,to,folded,months:[]};
 const monthStart=from.slice(8)==='01',monthEnd=to===monthLastDay(to.slice(0,7));
 assert(monthStart&&(to>=folded||monthEnd),`Rincian harian sampai ${folded} hanya tersimpan di spreadsheet tahunan. Untuk periode itu pilih bulan penuh (mulai tanggal 1 dan berakhir di akhir bulan), atau buka spreadsheetnya.`);
 return {from,to,folded,months:monthsBetween(from.slice(0,7),(to>=folded?folded:to).slice(0,7))};
}

export function visitOverview(db,from,to){
 const period=visitPeriod(db,from,to);
 const guides=all(db,'SELECT id,name,kategori,regu,is_active FROM visit_guides ORDER BY seq');
 const byId=new Map(guides.map(g=>[g.id,g]));
 const total=new Map(),byPos=new Map(),guideDays=new Map(),days=new Set(),foldedDays=new Map();
 let foldedAllDays=0;
 for(const r of all(db,"SELECT guide_id,pos,uniform,id_card,review,etika,wita_date FROM visit_evaluations WHERE status='aktif' AND wita_date>=? AND wita_date<=?",from,to)){
  const uniform=Number(r.uniform),n={antar:1,uniform,idCard:Number(r.id_card),review:Number(r.review),etika:Number(r.etika),uniformPatuh:uniform>=1?1:0};
  addStat(statFor(total,r.guide_id),n);addStat(statFor(byPos,`${r.guide_id}|${Number(r.pos)}`),n);
  days.add(r.wita_date);
  let set=guideDays.get(r.guide_id);if(!set){set=new Set();guideDays.set(r.guide_id,set);}set.add(r.wita_date);
 }
 if(period.months.length){
  for(const t of all(db,'SELECT * FROM visit_monthly_totals WHERE month>=? AND month<=?',period.months[0],period.months.at(-1))){
   const n={antar:Number(t.antar),uniform:Number(t.uniform),idCard:Number(t.id_card),review:Number(t.review),etika:Number(t.etika),uniformPatuh:Number(t.uniform_patuh)};
   const pos=Number(t.pos);
   if(t.guide_id==='*'){if(pos===0)foldedAllDays+=Number(t.hari);continue;}
   if(pos===0){addStat(statFor(total,t.guide_id),n);foldedDays.set(t.guide_id,(foldedDays.get(t.guide_id)||0)+Number(t.hari));}
   else addStat(statFor(byPos,`${t.guide_id}|${pos}`),n);
  }
 }
 const dayCount=id=>(guideDays.get(id)?.size||0)+(foldedDays.get(id)||0);
 // Total memuat semua baris aktif, termasuk guide yang kini nonaktif.
 const sum=emptyStat();let evaluated=0;
 for(const s of total.values()){addStat(sum,s);if(s.antar)evaluated++;}
 const ringkasan={...visitFigures(sum),guideDinilai:evaluated,hariDinilai:days.size+foldedAllDays,guideAktif:guides.filter(g=>Number(g.is_active)===1).length};
 const perPos=[1,3].map(pos=>{
  const s=emptyStat();let count=0;
  for(const [key,v] of byPos)if(key.endsWith(`|${pos}`)){addStat(s,v);if(v.antar)count++;}
  return {pos,...visitFigures(s),guideDinilai:count};
 });
 const perRegu=reguInfo.map(info=>{
  const s=emptyStat();let count=0;
  for(const [id,v] of total){const g=byId.get(id);if(!g||!g.regu.split(', ').includes(info.kode))continue;addStat(s,v);if(v.antar)count++;}
  return {regu:info.kode,kategori:info.kategori,...visitFigures(s),guideDinilai:count};
 });
 // Peringkat hanya untuk guide aktif yang punya pengantaran pada rentang ini.
 const list=[];
 for(const g of guides){
  const s=total.get(g.id);if(Number(g.is_active)!==1||!s||!s.antar)continue;
  const sumNilai=s.uniform+s.idCard+s.etika+s.review;
  list.push({guideId:g.id,nama:g.name,regu:g.regu,kategori:g.kategori,hari:dayCount(g.id),antar:s.antar,uniform:s.uniform,uniformPatuh:s.uniformPatuh,idCard:s.idCard,etika:s.etika,review:s.review,
   total:sumNilai,rataTotal:sumNilai/s.antar,
   // Ketaatan memakai CACAH yang patuh: Uniform bernilai -1/+1/+2, sehingga jumlah
   // nilainya tidak bisa dibagi dua kesempatan.
   taat:(s.uniformPatuh+s.idCard)/(2*s.antar),rataUniform:s.uniform/s.antar,rataEtika:s.etika/s.antar});
 }
 const n=visitRules.jumlahPeringkat,enough=list.filter(x=>x.antar>=visitRules.minimalPengantaran),short=list.filter(x=>x.antar<visitRules.minimalPengantaran);
 return {from,to,ringkasan,perPos,perRegu,minimalPengantaran:visitRules.minimalPengantaran,diperingkat:enough.length,belumCukup:short.length,
  peringkat:{totalTertinggi:rankBy(enough,'rataTotal',false,n),totalTerendah:rankBy(enough,'rataTotal',true,n),taatTertinggi:rankBy(enough,'taat',false,n),taatTerendah:rankBy(enough,'taat',true,n),
   etikaTertinggi:rankBy(enough,'rataEtika',false,n),etikaTerendah:rankBy(enough,'rataEtika',true,n),belumCukup:rankBy(short,'antar',false,n)},
  perGuide:rankBy(list,'rataTotal',false,list.length),
  periode:{folded_through:period.folded,bulan_ringkasan:period.months},
  diperbarui:now()};
}
