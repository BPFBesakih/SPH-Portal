import {all,one,run,insert,update,assert,now,today,uid} from './db.mjs';
import {scoreRuleFinder,potonganOf,scoringRules,cancelPendingFlags,flagCounts} from './visit-scoring.mjs';

// Penilaian Guide di dalam portal. Aturan terima, rekap, dan peringkat dipindah
// dari aplikasi NilaiGuide (server-gas/03_Ingest.gs, 05_Ringkasan.gs,
// 08_Peringkat.gs) sebagai acuan; aplikasi itu sendiri tidak diubah.
// Rincian penilaian disimpan ±6 minggu. Setelah barisnya terbukti ada di
// spreadsheet tahunan, angkanya dilipat ke rekap harian visit_daily_totals (lihat
// visit-sheets.mjs), sehingga rentang mana pun tetap bisa dihitung per hari.
// Riwayat NilaiGuide masuk sekali lewat migrasi awal, juga sebagai rekap harian.
export const visitRules=Object.freeze({
 jedaMenit:15,          // dua penilaian guide+pos lebih rapat dari ini ditolak (salah pencet)
 umurMaksHari:30,       // kiriman offline lebih tua dari ini ditolak; harus < retensiHari
 retensiHari:42,        // rincian di basis data; lebih tua hanya di spreadsheet + ringkasan
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
// Penilaian cara baru (criteria.seragam ada) dicocokkan dengan daftar jenis temuan dan
// petugas di portal. Jenis/petugas yang kini nonaktif tetap diterima: penilaiannya mungkin
// dibuat sebelum dinonaktifkan. Mengembalikan pesan penolakan, atau null bila sah.
function newCriteriaProblem(c,catatan,petugasId,types,assessors){
 for(const code of c.teguran){const t=types.get(code);if(!t||t.jenis!=='teguran')return `Jenis teguran "${code}" tidak dikenal portal. Perbarui daftar di HP (Pengaturan → Tes Koneksi), lalu nilai ulang.`;}
 for(const [jenis,code] of [['berat',c.berat],['apresiasi',c.apresiasi]])if(code){const t=types.get(code);if(!t||t.jenis!==jenis)return `Jenis ${jenis==='berat'?'pelanggaran berat':'apresiasi'} "${code}" tidak dikenal portal. Perbarui daftar di HP, lalu nilai ulang.`;}
 let needsNote=Boolean(c.berat||c.apresiasi);
 for(const code of c.teguran)if(Number(types.get(code).perlu_catatan)===1)needsNote=true;
 if(needsNote&&catatan.trim().length<scoringRules.catatanMin)return 'Catatan wajib diisi untuk pelanggaran berat, apresiasi, atau teguran "lain".';
 if(petugasId&&!assessors.has(petugasId))return 'Petugas penilai tidak terdaftar di portal. Perbarui daftar petugas di HP, lalu pilih nama lagi.';
 return null;
}
// Kolom yang disimpan. Cara baru tetap mengisi kolom lama dengan padanannya (seragam
// lengkap = +1, kurang/tidak = −1; etika = −jumlah teguran), sehingga portal-api versi
// sebelumnya dan pembaca kolom A–M spreadsheet tetap mendapat angka yang masuk akal.
function storedValues(c,petugas){
 if(c.seragam===undefined)return {versi:1,uniform:c.uniform,id_card:c.idCard?1:0,etika:Math.min(5,Math.max(-5,Math.round(Number(c.etika)||0))),
  seragam:null,teguran:'',teguran_n:0,berat:null,apresiasi:null,petugas_id:null,petugas_nama:null};
 return {versi:2,uniform:c.seragam==='lengkap'?1:-1,id_card:c.idCard?1:0,etika:-c.teguran.length,seragam:c.seragam,teguran:c.teguran.join(','),teguran_n:c.teguran.length,
  berat:c.berat||null,apresiasi:c.apresiasi||null,petugas_id:petugas?petugas.id:null,petugas_nama:petugas?petugas.nama:null};
}

export function ingestGuideEvaluations(db,link,items,nowMs=Date.now()){
 const accepted=[],rejected=[];
 const receivedAt=new Date(nowMs).toISOString(),oldest=nowMs-visitRules.umurMaksHari*86400000;
 // Daftar jenis temuan dan petugas dibaca sekali per kiriman, hanya bila ada isian cara baru.
 const anyNew=items.some(item=>item.criteria.seragam!==undefined);
 const types=new Map(anyNew?all(db,'SELECT id,jenis,perlu_catatan FROM visit_finding_types').map(t=>[t.id,t]):[]);
 const assessors=new Map(anyNew?all(db,'SELECT id,nama FROM visit_assessors').map(a=>[a.id,a]):[]);
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
  // Isian diperiksa SEBELUM koreksi menandai baris lama, supaya kiriman yang ditolak
  // tidak pernah mengubah penilaian lain.
  const c=item.criteria,catatan=String(item.catatan||'').slice(0,500),petugasId=item.petugasId?item.petugasId.toLowerCase():null;
  if(c.seragam!==undefined){const problem=newCriteriaProblem(c,catatan,petugasId,types,assessors);if(problem){reject('VALIDASI',problem);continue;}}
  const v=storedValues(c,petugasId?assessors.get(petugasId):null);
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
   // Laporan berat/apresiasi dari penilaian lama yang belum diputuskan ikut batal;
   // yang sudah diputuskan Pengelola tetap seperti keputusannya.
   cancelPendingFlags(db,original.id);
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
  run(db,`INSERT INTO visit_evaluations(id,link_id,pos,guide_id,guide_name,uniform,id_card,review,etika,catatan,evaluated_at,wita_date,received_at,koreksi_dari,status,versi,seragam,teguran,teguran_n,berat,apresiasi,petugas_id,petugas_nama)
   VALUES(?,?,?,?,?,?,?,0,?,?,?,?,?,?,'aktif',?,?,?,?,?,?,?,?)`,id,link.id,link.pos,guide.id,guide.name,v.uniform,v.id_card,v.etika,catatan,evaluatedAt,day,receivedAt,replaces,
   v.versi,v.seragam,v.teguran,v.teguran_n,v.berat,v.apresiasi,v.petugas_id,v.petugas_nama);
  // Pelanggaran berat dan apresiasi menunggu keputusan Pengelola Kunjungan.
  for(const [jenis,kode] of [['berat',v.berat],['apresiasi',v.apresiasi]])if(kode)
   insert(db,'visit_flags',{evaluation_id:id,jenis,kode,guide_id:guide.id,guide_name:guide.name,pos:link.pos,wita_date:day,evaluated_at:evaluatedAt,catatan:catatan.trim(),petugas_nama:v.petugas_nama,status:'menunggu',keputusan_catatan:''});
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

/* ---------------- Migrasi awal riwayat NilaiGuide ---------------- */

// SEKALI, sebagai migrasi awal: penilaian tab Evaluations NilaiGuide (unduhan
// .xlsx/.csv) dilipat ke rekap harian visit_daily_totals (sumber 'nilaiguide').
// Nilainya dibaca persis seperti rekap NilaiGuide (05_Ringkasan.gs rangkumSaring_
// dan 03_Ingest.gs normalUniform_), supaya angka per bulan bisa dicocokkan dengan
// tab Dasbor NilaiGuide. Yang disimpan hanya rekap harian dan daftar ID; jam,
// catatan, dan nama petugas tetap di spreadsheet NilaiGuide, yang tidak disentuh.
//
// Berkas dikirim per bagian (batas badan permintaan portal 128 KB). Pratinjau tidak
// menyimpan apa pun. Terapkan menyimpan tiap bagian dalam transaksinya sendiri dan
// mengulang bagian yang sama tidak menggandakan angka; migrasi baru dihitung setelah
// SELESAI (semua bagian diterima). Batalkan menghapus seluruh hasilnya.
export const historyRules=Object.freeze({mulai:'2026-01-01',barisPerBagian:800,bagianMaks:200,barisMaks:100000,catatanMaks:100});
export const historyReasons=Object.freeze({
 MASUK:'Masuk ke rekap',
 DIGANTI:'Dilewati: sudah dikoreksi (status diganti), sama dengan rekap NilaiGuide',
 POS2:'Dilewati: Pos 2 (riwayat Pos 2 tidak diimpor)',
 BENTROK:'Dilewati: guide dan pos yang sama sudah dinilai lewat portal dalam jeda 15 menit',
 DUPLIKAT:'Dilewati: evaluationId sama dengan baris lain di berkas',
 ID:'Ditolak: evaluationId bukan UUID',
 TANGGAL:'Ditolak: timestamp kosong, tidak terbaca, atau di luar 1 Januari 2026 sampai hari ini',
 POS:'Ditolak: pos bukan 1 atau 3',
 GUIDE:'Ditolak: guideId tidak terdaftar di Data Guide',
 ID_PORTAL:'Ditolak: evaluationId sama dengan penilaian yang sudah ada di portal'
});
const historyReasonKeys=Object.keys(historyReasons);
const historyProblems=['ID','TANGGAL','POS','GUIDE','ID_PORTAL','BENTROK'];
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sheetSerial=/^-?\d+(\.\d+)?$/;
// Sel tanggal Google Sheets diekspor sebagai nomor seri hari menurut zona spreadsheet
// (Asia/Makassar di NilaiGuide); teks ISO dibaca apa adanya.
function historyTime(value){
 const text=String(value??'').trim();if(!text)return null;
 const ms=sheetSerial.test(text)?Math.round((Number(text)-25569)*86400000)-witaOffset:Date.parse(text);
 return Number.isFinite(ms)?ms:null;
}
const historyBool=value=>{const t=typeof value==='string'?value.trim().toUpperCase():value;return t===true||t==='TRUE'?true:t===false||t==='FALSE'?false:value;};
// = normalUniform_ NilaiGuide: TRUE +1, FALSE/0/kosong -1, lainnya dibatasi -1…+2.
function historyUniform(value){
 const v=historyBool(value);if(v===true)return 1;if(v===false)return -1;
 const n=Number(v);if(!Number.isFinite(n)||n===0)return -1;
 if(n<-1)return -1;if(n>2)return 2;return Math.round(n);
}
const historyIdCard=value=>{const v=historyBool(value);return v===true?1:v===false?0:Number(v)?1:0;};
const historyEtika=value=>Math.round(Math.min(5,Math.max(-5,Number(value)||0)));
const historyStatus=value=>String(value??'').trim().toLowerCase();

function historyMeta(b){
 const f=b?.file&&typeof b.file==='object'?b.file:{};
 const name=String(f.name??'').trim().slice(0,200),sha256=String(f.sha256??'');
 const total=Number(f.rows_total),parts=Number(f.parts_total),part=Number(b?.part);
 assert(name,'Nama berkas wajib dikirim.');
 assert(/^[0-9a-f]{64}$/.test(sha256),'Sidik berkas tidak valid. Pilih ulang berkasnya.');
 assert(Number.isInteger(total)&&total>=1&&total<=historyRules.barisMaks,`Berkas harus berisi 1–${historyRules.barisMaks} baris penilaian.`);
 assert(Number.isInteger(parts)&&parts>=1&&parts<=historyRules.bagianMaks,'Jumlah bagian tidak valid.');
 assert(Number.isInteger(part)&&part>=0&&part<parts,'Nomor bagian tidak valid.');
 assert(Array.isArray(b.rows)&&b.rows.length>=1&&b.rows.length<=historyRules.barisPerBagian,`Satu bagian berisi 1–${historyRules.barisPerBagian} baris.`,413);
 return {name,sha256,total,parts,part};
}

// ID yang sudah ada di sebuah tabel, dicari per 400 sekaligus.
function idsIn(db,table,ids){
 const found=new Set();
 for(let i=0;i<ids.length;i+=400){const part=ids.slice(i,i+400);for(const r of all(db,`SELECT id FROM ${table} WHERE id IN (${part.map(()=>'?').join(',')})`,...part))found.add(r.id);}
 return found;
}
// Periksa satu bagian. Tidak menulis apa pun; hasilnya dipakai pratinjau dan terapkan.
function evaluateHistoryRows(db,rows){
 for(const raw of rows)assert(Array.isArray(raw)&&raw.length===9&&raw.every(v=>v===null||['string','number','boolean'].includes(typeof v)&&String(v).length<=100),'Bentuk baris berkas tidak valid. Pilih ulang berkasnya.');
 const guides=new Set(all(db,'SELECT id FROM visit_guides').map(g=>g.id));
 const candidates=[...new Set(rows.map(r=>String(r[1]??'').trim().toLowerCase()).filter(id=>uuidPattern.test(id)))];
 const inPortal=idsIn(db,'visit_evaluations',candidates),inHistory=idsIn(db,'visit_history_ids',candidates);
 // Bentrok hanya mungkin dengan rincian portal yang masih ada (±6 minggu terakhir).
 const portalFrom=one(db,'SELECT min(wita_date) AS d FROM visit_evaluations')?.d||null;
 const last=today(),counts=Object.fromEntries(historyReasonKeys.map(k=>[k,0])),months=new Map(),groups=new Map(),problems=[],ids=[],seen=new Set();
 let first=null,lastDay=null;
 const note=(reason,line)=>{counts[reason]++;if(historyProblems.includes(reason)&&problems.length<historyRules.catatanMaks)problems.push({line,reason});};
 const monthOf=day=>{const m=day.slice(0,7);let t=months.get(m);if(!t){t={month:m,antar:0,uniform:0,uniform_patuh:0,id_card:0,etika:0,diganti:0,pos2:0,lainnya:0};months.set(m,t);}return t;};
 for(const raw of rows){
  const [lineValue,idValue,timeValue,posValue,guideValue,uniformValue,idCardValue,etikaValue,statusValue]=raw;
  const line=Number.isInteger(lineValue)&&lineValue>0&&lineValue<10000000?lineValue:0;
  const id=String(idValue??'').trim().toLowerCase();
  if(!uuidPattern.test(id)){note('ID',line);continue;}
  if(seen.has(id)){note('DUPLIKAT',line);continue;}
  seen.add(id);
  const ms=historyTime(timeValue),day=ms===null?null:witaDate(ms);
  if(historyStatus(statusValue)==='diganti'){note('DIGANTI',line);if(day&&day>=historyRules.mulai&&day<=last)monthOf(day).diganti++;continue;}
  if(!day||day<historyRules.mulai||day>last){note('TANGGAL',line);continue;}
  const pos=Number(posValue)||0;
  if(pos===2){note('POS2',line);monthOf(day).pos2++;continue;}
  if(pos!==1&&pos!==3){note('POS',line);monthOf(day).lainnya++;continue;}
  const guide=parseGuideId(guideValue);
  if(!guide||!guides.has(guide.id)){note('GUIDE',line);monthOf(day).lainnya++;continue;}
  if(inPortal.has(id)){note('ID_PORTAL',line);monthOf(day).lainnya++;continue;}
  if(inHistory.has(id)){note('DUPLIKAT',line);continue;}
  if(portalFrom&&day>=portalFrom){
   const low=new Date(ms-visitRules.jedaMenit*60000).toISOString(),high=new Date(ms+visitRules.jedaMenit*60000).toISOString();
   if(one(db,"SELECT id FROM visit_evaluations WHERE guide_id=? AND pos=? AND status='aktif' AND evaluated_at>? AND evaluated_at<? LIMIT 1",guide.id,pos,low,high)){note('BENTROK',line);monthOf(day).lainnya++;continue;}
  }
  const uniform=historyUniform(uniformValue),idCard=historyIdCard(idCardValue),etika=historyEtika(etikaValue),patuh=uniform>=1?1:0;
  counts.MASUK++;ids.push(id);
  if(!first||day<first)first=day;if(!lastDay||day>lastDay)lastDay=day;
  const m=monthOf(day);m.antar++;m.uniform+=uniform;m.uniform_patuh+=patuh;m.id_card+=idCard;m.etika+=etika;
  const key=`${day}|${guide.id}|${pos}`;let g=groups.get(key);
  if(!g){g={day,guide_id:guide.id,pos,antar:0,uniform:0,uniform_patuh:0,id_card:0,etika:0,n_id:0,n_tidak:0,n_teguran:0};groups.set(key,g);}
  g.antar++;g.uniform+=uniform;g.uniform_patuh+=patuh;g.id_card+=idCard;g.etika+=etika;
  // Temuan cara baru dari nilai lama (pemetaan di usulan rumus): ID 0 = tanpa ID,
  // Uniform −1 = tidak berseragam, Etika minus dengan seragam sesuai = satu teguran
  // (Etika minus saat seragam tidak sesuai adalah hukuman ganda atas seragam).
  g.n_id+=idCard?0:1;g.n_tidak+=uniform===-1?1:0;g.n_teguran+=etika<0&&uniform>=1?1:0;
 }
 return {counts,months:[...months.values()].sort((a,b)=>a.month<b.month?-1:1),first,last:lastDay,problems,ids,groups:[...groups.values()]};
}
const publicPart=r=>({counts:r.counts,months:r.months,first:r.first,last:r.last,problems:r.problems});

function mergeSummary(previous,part){
 const out={counts:{...Object.fromEntries(historyReasonKeys.map(k=>[k,0])),...(previous.counts||{})},months:Object.fromEntries((previous.months||[]).map(m=>[m.month,{...m}]))};
 for(const k of historyReasonKeys)out.counts[k]+=part.counts[k]||0;
 for(const m of part.months){const t=out.months[m.month]||(out.months[m.month]={month:m.month,antar:0,uniform:0,uniform_patuh:0,id_card:0,etika:0,diganti:0,pos2:0,lainnya:0});for(const k of Object.keys(t))if(k!=='month')t[k]+=m[k]||0;}
 return {counts:out.counts,months:Object.values(out.months).sort((a,b)=>a.month<b.month?-1:1)};
}
const historyView=imp=>imp&&({id:imp.id,status:imp.status,file_name:imp.file_name,file_sha256:imp.file_sha256,rows_total:Number(imp.rows_total),parts_total:Number(imp.parts_total),
 parts_done:JSON.parse(imp.parts_done||'[]'),ringkasan:JSON.parse(imp.ringkasan||'{}'),first_day:imp.first_day||null,last_day:imp.last_day||null,
 created_at:imp.created_at,finished_at:imp.finished_at||null,cancelled_at:imp.cancelled_at||null});

// Keadaan migrasi awal: yang terbuka (menyusun/aktif) bila ada, dan riwayat percobaannya.
export function visitHistoryStatus(db){
 const open=one(db,'SELECT * FROM visit_history_import WHERE terbuka=1');
 const past=all(db,"SELECT * FROM visit_history_import WHERE status='dibatalkan' ORDER BY created_at DESC LIMIT 5");
 return {current:historyView(open)||null,cancelled:past.map(historyView),rules:{mulai:historyRules.mulai,barisPerBagian:historyRules.barisPerBagian},reasons:historyReasons};
}

export function importVisitHistory(db,user,b,audit){
 assert(['preview','apply'].includes(b?.mode),'Mode impor tidak valid.');
 const meta=historyMeta(b);
 if(b.mode==='preview')return {part:meta.part,...publicPart(evaluateHistoryRows(db,b.rows))};
 let imp;
 if(b.import_id){
  imp=one(db,'SELECT * FROM visit_history_import WHERE id=?',String(b.import_id));
  assert(imp&&imp.status==='menyusun','Migrasi ini tidak sedang disusun. Muat ulang halaman.',409);
  assert(imp.file_sha256===meta.sha256&&Number(imp.rows_total)===meta.total&&Number(imp.parts_total)===meta.parts,'Berkas ini berbeda dengan migrasi yang sedang disusun. Pilih berkas yang sama, atau batalkan migrasi itu dulu.',409);
 }else{
  const open=one(db,'SELECT id,status FROM visit_history_import WHERE terbuka=1');
  assert(!open,open?.status==='aktif'?'Migrasi awal NilaiGuide sudah dilakukan. Untuk mengulang, batalkan dulu migrasi itu.':'Ada migrasi awal yang belum selesai. Lanjutkan dengan berkas yang sama, atau batalkan dulu.',409);
  assert(meta.part===0,'Migrasi baru dimulai dari bagian pertama.',409);
  const id=uid(),stamp=now();
  run(db,"INSERT INTO visit_history_import(id,status,terbuka,file_name,file_sha256,rows_total,parts_total,parts_done,ringkasan,created_by,created_at) VALUES(?,'menyusun',1,?,?,?,?,'[]','{}',?,?)",id,meta.name,meta.sha256,meta.total,meta.parts,user.id,stamp);
  imp=one(db,'SELECT * FROM visit_history_import WHERE id=?',id);
  audit(db,user,'IMPORT_START','visit_history_import',id,{file:meta.name,sha256:meta.sha256,rows:meta.total,parts:meta.parts});
 }
 const done=JSON.parse(imp.parts_done||'[]');
 // Bagian yang sudah diterima tidak diproses lagi: jawaban yang hilang di jalan
 // boleh dikirim ulang tanpa menggandakan angka.
 if(done.includes(meta.part))return {part:meta.part,ulang:true,import:historyView(imp)};
 const r=evaluateHistoryRows(db,b.rows),stamp=now();
 for(const id of r.ids)run(db,'INSERT INTO visit_history_ids(id,import_id) VALUES(?,?)',id,imp.id);
 for(const g of r.groups)run(db,`INSERT INTO visit_daily_totals(day,guide_id,pos,sumber,antar,uniform,uniform_patuh,id_card,review,etika,updated_at,n_id,n_kurang,n_tidak,n_teguran) VALUES(?,?,?,'nilaiguide',?,?,?,?,0,?,?,?,0,?,?)
  ON CONFLICT(day,guide_id,pos,sumber) DO UPDATE SET antar=visit_daily_totals.antar+excluded.antar,uniform=visit_daily_totals.uniform+excluded.uniform,uniform_patuh=visit_daily_totals.uniform_patuh+excluded.uniform_patuh,
  id_card=visit_daily_totals.id_card+excluded.id_card,etika=visit_daily_totals.etika+excluded.etika,updated_at=excluded.updated_at,
  n_id=visit_daily_totals.n_id+excluded.n_id,n_tidak=visit_daily_totals.n_tidak+excluded.n_tidak,n_teguran=visit_daily_totals.n_teguran+excluded.n_teguran`,
  g.day,g.guide_id,g.pos,g.antar,g.uniform,g.uniform_patuh,g.id_card,g.etika,stamp,g.n_id,g.n_tidak,g.n_teguran);
 const summary=mergeSummary(JSON.parse(imp.ringkasan||'{}'),r);
 const firstDay=[imp.first_day,r.first].filter(Boolean).sort()[0]||null,lastDay=[imp.last_day,r.last].filter(Boolean).sort().at(-1)||null;
 run(db,'UPDATE visit_history_import SET parts_done=?,ringkasan=?,first_day=?,last_day=? WHERE id=? AND status=?',JSON.stringify([...done,meta.part].sort((x,y)=>x-y)),JSON.stringify(summary),firstDay,lastDay,imp.id,'menyusun');
 return {part:meta.part,...publicPart(r),import:historyView(one(db,'SELECT * FROM visit_history_import WHERE id=?',imp.id))};
}

export function finishVisitHistory(db,user,b,audit){
 const imp=one(db,'SELECT * FROM visit_history_import WHERE id=?',String(b?.import_id||''));
 assert(imp&&imp.status==='menyusun','Migrasi ini tidak sedang disusun. Muat ulang halaman.',409);
 const done=JSON.parse(imp.parts_done||'[]');
 assert(done.length===Number(imp.parts_total),`Baru ${done.length} dari ${imp.parts_total} bagian yang diterima. Lanjutkan pengiriman dengan berkas yang sama.`,409);
 const summary=JSON.parse(imp.ringkasan||'{}');
 assert((summary.counts?.MASUK||0)>0,'Tidak ada baris yang masuk ke rekap. Periksa berkasnya, lalu batalkan migrasi ini.',422);
 run(db,"UPDATE visit_history_import SET status='aktif',finished_at=? WHERE id=? AND status='menyusun'",now(),imp.id);
 audit(db,user,'IMPORT','visit_history_import',imp.id,{file:imp.file_name,sha256:imp.file_sha256,rows:Number(imp.rows_total),counts:summary.counts,first_day:imp.first_day,last_day:imp.last_day});
 return {import:historyView(one(db,'SELECT * FROM visit_history_import WHERE id=?',imp.id))};
}

// Membatalkan menghapus SELURUH hasil migrasi (rekap harian 'nilaiguide' dan daftar
// ID), sehingga angka kembali seperti sebelum impor. Catatan migrasinya disimpan.
export function cancelVisitHistory(db,user,b,audit){
 const imp=one(db,'SELECT * FROM visit_history_import WHERE id=?',String(b?.import_id||''));
 assert(imp&&imp.terbuka!==null&&Number(imp.terbuka)===1,'Migrasi ini sudah dibatalkan atau tidak ada. Muat ulang halaman.',409);
 const totals=run(db,"DELETE FROM visit_daily_totals WHERE sumber='nilaiguide'").changes;
 const ids=run(db,'DELETE FROM visit_history_ids WHERE import_id=?',imp.id).changes;
 run(db,"UPDATE visit_history_import SET status='dibatalkan',terbuka=NULL,cancelled_by=?,cancelled_at=? WHERE id=?",user.id,now(),imp.id);
 audit(db,user,'IMPORT_CANCEL','visit_history_import',imp.id,{status_sebelumnya:imp.status,rekap_harian_dihapus:Number(totals),id_dihapus:Number(ids)});
 return {import:historyView(one(db,'SELECT * FROM visit_history_import WHERE id=?',imp.id))};
}

/* ---------------- Temuan & nilai pengantaran ---------------- */

// Cacah temuan per baris penilaian, untuk cara lama dan baru sekaligus:
//   tanpa ID         : ID-Card 0 / tidak terpasang
//   kurang lengkap   : hanya ada di cara baru
//   tidak berseragam : cara baru 'tidak'; cara lama Uniform −1
//   teguran          : cara baru = jumlah jenis teguran; cara lama = Etika minus dengan
//                      seragam sesuai (Etika minus saat seragam tidak sesuai = hukuman ganda)
// "Bagus" dan Etika plus cara lama tidak dihitung (subjektif).
export const visitFindingSums="sum(CASE WHEN id_card=0 THEN 1 ELSE 0 END) AS n_id,"+
 "sum(CASE WHEN versi=2 AND seragam='kurang' THEN 1 ELSE 0 END) AS n_kurang,"+
 "sum(CASE WHEN versi=2 THEN CASE WHEN seragam='tidak' THEN 1 ELSE 0 END WHEN uniform=-1 THEN 1 ELSE 0 END) AS n_tidak,"+
 "sum(CASE WHEN versi=2 THEN teguran_n WHEN etika<0 AND uniform>=1 THEN 1 ELSE 0 END) AS n_teguran";
export function rowFindings(r){
 const v2=Number(r.versi)===2,uniform=Number(r.uniform),etika=Number(r.etika);
 return {nId:Number(r.id_card)===0?1:0,nKurang:v2&&r.seragam==='kurang'?1:0,nTidak:v2?(r.seragam==='tidak'?1:0):(uniform===-1?1:0),nTeguran:v2?Number(r.teguran_n):(etika<0&&uniform>=1?1:0)};
}
// Nilai satu penilaian dengan aturan bulannya.
export const visitScoreOf=(r,ruleOf)=>100-potonganOf(ruleOf(String(r.wita_date).slice(0,7)),rowFindings(r));

/* ---------------- Daftar penilaian ---------------- */

const recordView=(r,ruleOf)=>{
 const v2=Number(r.versi)===2,f=rowFindings(r);
 return {evaluationId:r.id,timestamp:r.evaluated_at,tanggal:r.wita_date,pos:Number(r.pos),guideId:r.guide_id,guideName:r.guide_name,regu:r.regu||'',
  versi:v2?2:1,uniform:Number(r.uniform),idCard:Number(r.id_card),etika:Number(r.etika),review:Number(r.review),
  // Cara lama ditampilkan dengan pemetaannya, supaya satu bulan peralihan tetap satu ukuran.
  seragam:v2?r.seragam:(f.nTidak?'tidak':'lengkap'),teguran:r.teguran?String(r.teguran).split(','):[],teguranN:f.nTeguran,
  berat:r.berat||'',apresiasi:r.apresiasi||'',petugas:r.petugas_nama||'',nilai:visitScoreOf(r,ruleOf),
  catatan:r.catatan||'',receivedAt:r.received_at,koreksiDari:r.koreksi_dari||'',status:r.status,digantiOleh:r.replaced_by||''};
};
export function visitRecordPage(db,q){
 const where=['e.wita_date>=?','e.wita_date<=?'],args=[q.from,q.to];
 if(q.pos){where.push('e.pos=?');args.push(q.pos);}
 if(q.status){where.push('e.status=?');args.push(q.status);}
 if(q.guideId){where.push('e.guide_id=?');args.push(q.guideId);}
 if(q.regu){where.push('g.regu LIKE ?');args.push(`%${q.regu}%`);}
 const from=` FROM visit_evaluations e LEFT JOIN visit_guides g ON g.id=e.guide_id WHERE ${where.join(' AND ')}`;
 const total=Number(one(db,`SELECT count(*) AS n${from}`,...args).n),ruleOf=scoreRuleFinder(db);
 const rows=all(db,`SELECT e.*,g.regu${from} ORDER BY e.evaluated_at DESC,e.id LIMIT ? OFFSET ?`,...args,q.limit,q.offset);
 const items=rows.map(r=>recordView(r,ruleOf));
 return {items,total,more:q.offset+items.length<total,folded_through:one(db,'SELECT folded_through FROM visit_sheet_state WHERE id=1')?.folded_through||null};
}

/* ---------------- Rekap dan peringkat ---------------- */

const statKeys=['antar','uniform','idCard','review','etika','uniformPatuh','nId','nKurang','nTidak','nTeguran','potongan'];
const emptyStat=()=>Object.fromEntries(statKeys.map(k=>[k,0]));
function addStat(target,n){for(const k of statKeys)target[k]+=n[k];return target;}
function statFor(map,key){let s=map.get(key);if(!s){s=emptyStat();map.set(key,s);}return s;}
// Angka per kelompok; tanpa pengantaran hasilnya null, bukan 0.
//   nilai          = rata-rata nilai pengantaran = 100 − potongan ÷ pengantaran
//   persenId       = porsi pengantaran dengan ID terpasang
//   persenSeragam  = porsi pengantaran dengan seragam lengkap
const visitFigures=s=>{const antar=s?s.antar:0;return {pengantaran:antar,nilai:antar?100-s.potongan/antar:null,persenId:antar?1-s.nId/antar:null,persenSeragam:antar?1-(s.nKurang+s.nTidak)/antar:null,
 tanpaId:antar?s.nId:0,kurangLengkap:antar?s.nKurang:0,tidakBerseragam:antar?s.nTidak:0,teguran:antar?s.nTeguran:0,potongan:antar?s.potongan:0};};
// Nilai sama mendapat peringkat sama. Tidak diputus jumlah pengantaran, karena jumlah
// itu ditentukan urutan giliran; tieKey (apresiasi terverifikasi) dipakai sebagai
// penentu kedua, menurun. Nama hanya mengurutkan tampilan.
function ranked(list,key,ascending,count,tieKey=null){
 const sorted=list.slice().sort((a,b)=>{const d=ascending?a[key]-b[key]:b[key]-a[key];if(d)return d;if(tieKey&&b[tieKey]!==a[tieKey])return b[tieKey]-a[tieKey];const x=a.nama.toLowerCase(),y=b.nama.toLowerCase();return x<y?-1:x>y?1:0;});
 let rank=0,prev=null;
 return sorted.slice(0,count).map((r,i)=>{const sig=`${r[key]}|${tieKey?r[tieKey]:''}`;if(sig!==prev){rank=i+1;prev=sig;}return {...r,peringkat:rank};});
}

// Migrasi awal NilaiGuide baru ikut dihitung setelah seluruh bagiannya diterima.
const historyActive=db=>Boolean(one(db,"SELECT id FROM visit_history_import WHERE status='aktif'"));
// Bahan semua rekap untuk rentang mana pun, per guide × pos × hari: rincian penilaian
// (±6 minggu terakhir) ditambah rekap harian (lipatan retensi + migrasi awal).
// Penilaian portal satu hari selalu dilipat utuh, jadi hari itu ada di rincian ATAU
// di rekap harian, tidak di keduanya. Potongan dihitung dengan aturan bulan harinya.
export function visitDayRows(db,from,to){
 const rows=[],ruleOf=scoreRuleFinder(db);
 for(const r of all(db,`SELECT guide_id,pos,wita_date AS day,count(*) AS antar,sum(uniform) AS uniform,sum(CASE WHEN uniform>=1 THEN 1 ELSE 0 END) AS uniform_patuh,sum(id_card) AS id_card,sum(review) AS review,sum(etika) AS etika,${visitFindingSums}
  FROM visit_evaluations WHERE status='aktif' AND wita_date>=? AND wita_date<=? GROUP BY guide_id,pos,wita_date`,from,to))rows.push(r);
 const sumber=historyActive(db)?"sumber IN('portal','nilaiguide')":"sumber='portal'";
 for(const r of all(db,`SELECT guide_id,pos,day,antar,uniform,uniform_patuh,id_card,review,etika,n_id,n_kurang,n_tidak,n_teguran FROM visit_daily_totals WHERE ${sumber} AND day>=? AND day<=?`,from,to))rows.push(r);
 const out=[];
 for(const r of rows){
  const n={antar:Number(r.antar),uniform:Number(r.uniform),idCard:Number(r.id_card),review:Number(r.review),etika:Number(r.etika),uniformPatuh:Number(r.uniform_patuh),
   nId:Number(r.n_id),nKurang:Number(r.n_kurang),nTidak:Number(r.n_tidak),nTeguran:Number(r.n_teguran),potongan:0};
  n.potongan=potonganOf(ruleOf(r.day.slice(0,7)),n);
  out.push({guide_id:r.guide_id,pos:Number(r.pos),day:r.day,n});
 }
 return out;
}
// Status layak reward untuk SATU bulan kalender: tanpa pelanggaran berat yang disetujui,
// cukup pengantaran, dan nilai ≥ ambang. Pelanggaran berat yang disetujui disebut lebih
// dulu karena pasti menggugurkan. Laporan berat yang masih menunggu tidak menggugurkan,
// tetapi ditandai supaya diputuskan dulu sebelum reward dibagikan.
export function rewardStatus(g,rule){
 if(g.berat>0)return {status:'gugur',alasan:'Pelanggaran berat terverifikasi'};
 if(g.antar<rule.minimal)return {status:'kurang',alasan:`Belum cukup data (< ${rule.minimal} pengantaran)`};
 if(g.nilai<rule.ambang)return {status:'bawah',alasan:`Nilai di bawah ambang ${rule.ambang}`};
 return {status:'layak',alasan:g.beratMenunggu?'Layak, tetapi ada laporan pelanggaran berat yang belum diputuskan':'Layak'};
}
// Angka per petugas penilai, hanya dari rincian 6 minggu terakhir (rekap harian tidak
// menyimpan petugas). Dipakai melihat petugas yang mencatat jauh lebih banyak atau
// lebih sedikit temuan daripada yang lain.
export function visitAssessorStats(db,from,to,ruleOf){
 const rows=all(db,`SELECT coalesce(petugas_nama,'') AS nama,pos,substr(wita_date,1,7) AS bulan,count(*) AS antar,${visitFindingSums} FROM visit_evaluations
  WHERE status='aktif' AND versi=2 AND wita_date>=? AND wita_date<=? GROUP BY coalesce(petugas_nama,''),pos,substr(wita_date,1,7)`,from,to);
 const by=new Map();
 for(const r of rows){
  const n={nId:Number(r.n_id),nKurang:Number(r.n_kurang),nTidak:Number(r.n_tidak),nTeguran:Number(r.n_teguran)};
  let s=by.get(r.nama);if(!s){s={...emptyStat(),pos:new Set()};by.set(r.nama,s);}
  s.antar+=Number(r.antar);s.nId+=n.nId;s.nKurang+=n.nKurang;s.nTidak+=n.nTidak;s.nTeguran+=n.nTeguran;s.potongan+=potonganOf(ruleOf(r.bulan),n);s.pos.add(Number(r.pos));
 }
 return [...by.entries()].map(([nama,s])=>({petugas:nama||null,pos:[...s.pos].sort(),...visitFigures(s)})).sort((a,b)=>b.pengantaran-a.pengantaran);
}
export function visitOverview(db,from,to){
 const guides=all(db,'SELECT id,name,kategori,regu,is_active FROM visit_guides ORDER BY seq');
 const byId=new Map(guides.map(g=>[g.id,g]));
 const total=new Map(),byPos=new Map(),guideDays=new Map(),days=new Set();
 for(const r of visitDayRows(db,from,to)){
  addStat(statFor(total,r.guide_id),r.n);addStat(statFor(byPos,`${r.guide_id}|${r.pos}`),r.n);
  days.add(r.day);
  let set=guideDays.get(r.guide_id);if(!set){set=new Set();guideDays.set(r.guide_id,set);}set.add(r.day);
 }
 const ruleOf=scoreRuleFinder(db),months=monthsBetween(from.slice(0,7),to.slice(0,7)),rule=ruleOf(to.slice(0,7));
 // Status layak reward hanya untuk tepat satu bulan kalender (tanggal 1 sampai akhir
 // bulan, atau sampai hari ini untuk bulan berjalan).
 const singleMonth=months.length===1&&from.endsWith('-01')&&(to===monthLastDay(to.slice(0,7))||to===today());
 const flags=flagCounts(db,from,to);
 const noFlags={berat:{disetujui:0,menunggu:0},apresiasi:{disetujui:0,menunggu:0}};
 // Total memuat semua baris aktif, termasuk guide yang kini nonaktif.
 const sum=emptyStat();let evaluated=0;
 for(const s of total.values()){addStat(sum,s);if(s.antar)evaluated++;}
 const flagSum={berat:{disetujui:0,menunggu:0},apresiasi:{disetujui:0,menunggu:0}};
 for(const f of flags.values())for(const j of ['berat','apresiasi'])for(const st of ['disetujui','menunggu'])flagSum[j][st]+=f[j][st];
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
  const f=flags.get(g.id)||noFlags;
  const row={guideId:g.id,nama:g.name,regu:g.regu,kategori:g.kategori,hari:guideDays.get(g.id)?.size||0,antar:s.antar,...visitFigures(s),
   berat:f.berat.disetujui,beratMenunggu:f.berat.menunggu,apresiasi:f.apresiasi.disetujui,apresiasiMenunggu:f.apresiasi.menunggu,
   rataTeguran:s.nTeguran/s.antar,porsiTanpaId:s.nId/s.antar,porsiSeragam:(s.nKurang+s.nTidak)/s.antar};
  if(singleMonth)Object.assign(row,rewardStatus(row,rule));
  list.push(row);
 }
 const n=visitRules.jumlahPeringkat,enough=list.filter(x=>x.antar>=rule.minimal),short=list.filter(x=>x.antar<rule.minimal);
 const ringkasan={...visitFigures(sum),guideDinilai:evaluated,hariDinilai:days.size,guideAktif:guides.filter(g=>Number(g.is_active)===1).length,
  berat:flagSum.berat,apresiasi:flagSum.apresiasi,layak:singleMonth?list.filter(x=>x.status==='layak').length:null};
 return {from,to,ringkasan,perPos,perRegu,perPetugas:visitAssessorStats(db,from,to,ruleOf),
  aturan:{bulan:to.slice(0,7),...rule,satu_bulan:singleMonth,per_bulan:months.map(m=>({bulan:m,...ruleOf(m)}))},
  minimalPengantaran:rule.minimal,diperingkat:enough.length,belumCukup:short.length,
  peringkat:{nilaiTertinggi:ranked(enough,'nilai',false,n,'apresiasi'),nilaiTerendah:ranked(enough,'nilai',true,n),
   tanpaIdTerbanyak:ranked(enough.filter(x=>x.tanpaId>0),'porsiTanpaId',false,n),seragamTerbanyak:ranked(enough.filter(x=>x.kurangLengkap+x.tidakBerseragam>0),'porsiSeragam',false,n),
   teguranTerbanyak:ranked(enough.filter(x=>x.teguran>0),'rataTeguran',false,n),beratTerverifikasi:ranked(list.filter(x=>x.berat>0),'berat',false,list.length),
   belumCukup:ranked(short,'antar',false,n)},
  perGuide:ranked(list,'nilai',false,list.length,'apresiasi'),
  periode:{folded_through:one(db,'SELECT folded_through FROM visit_sheet_state WHERE id=1')?.folded_through||null,bulan_ringkasan:[]},
  diperbarui:now()};
}
