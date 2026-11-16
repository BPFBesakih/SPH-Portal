import {all,one,run,insert,update,assert,now} from './db.mjs';

// Penilaian guide "100 − potongan" (disetujui pemilik 11 November 2026; usulan di
// dokumen project claude/usulan-rumus-nilai-pengantaran.md).
//
// Petugas pos hanya mencatat fakta yang terlihat: ID-Card terpasang atau tidak,
// seragam lengkap/kurang/tidak, teguran perilaku menurut jenisnya, serta laporan
// pelanggaran berat dan apresiasi. Besar potongan, ambang layak reward, dan minimal
// pengantaran ditetapkan per bulan berlaku dan hanya bisa diubah untuk bulan depan,
// supaya aturan bulan berjalan tidak bergeser. Pelanggaran berat dan apresiasi baru
// dihitung setelah diputuskan Pengelola Kunjungan (izin visits.settings.manage).
//
// Nilai pengantaran = 100 − (tanpa ID + seragam + teguran × potongan teguran).
// Teguran paling banyak 2 per pengantaran dan potongan terbesar dijaga ≤ 100, sehingga
// nilai tidak pernah di bawah 0. Karena itu rata-rata bulanan bisa dihitung PERSIS dari
// cacah temuan di rekap harian, tanpa memotong nilai tiap pengantaran di 0.
export const scoringRules=Object.freeze({teguranMaks:2,potonganMaks:50,catatanMin:3,flagLimit:500});
export const findingKinds=Object.freeze(['teguran','berat','apresiasi']);
export const seragamValues=Object.freeze(['lengkap','kurang','tidak']);
export const seragamLabels=Object.freeze({lengkap:'Lengkap',kurang:'Kurang lengkap',tidak:'Tidak berseragam'});
export const findingCode=/^[a-z0-9-]{2,40}$/;
const monthPattern=/^\d{4}-(0[1-9]|1[0-2])$/;
const witaMonth=ms=>new Date(ms+8*3600000).toISOString().slice(0,7);
const nextMonthOf=month=>{const [y,m]=month.split('-').map(Number);return m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,'0')}`;};
const cleanText=value=>typeof value==='string'?value.trim().replace(/\s+/g,' '):'';
// Bawaan bila tabel aturan kosong (tidak terjadi setelah migrasi; dijaga untuk uji).
export const defaultScoreRule=Object.freeze({berlaku_mulai:'2026-01',pot_id:20,pot_kurang:10,pot_tidak:20,pot_teguran:20,ambang:95,minimal:10});

/* ---------------- Aturan nilai per bulan ---------------- */

const ruleView=r=>({berlaku_mulai:r.berlaku_mulai,pot_id:Number(r.pot_id),pot_kurang:Number(r.pot_kurang),pot_tidak:Number(r.pot_tidak),pot_teguran:Number(r.pot_teguran),
 ambang:Number(r.ambang),minimal:Number(r.minimal),created_at:r.created_at||null});
export const scoreRuleRows=db=>all(db,'SELECT * FROM visit_score_rules ORDER BY berlaku_mulai').map(ruleView);
// Pencari aturan dari baris yang sudah dibaca: aturan bulan M = baris dengan
// berlaku_mulai terbesar yang ≤ M. Tidak menyentuh basis data.
export function ruleFinder(rows){
 const sorted=rows.slice().sort((a,b)=>a.berlaku_mulai<b.berlaku_mulai?-1:1);
 return month=>{let found=null;for(const r of sorted){if(r.berlaku_mulai<=month)found=r;else break;}return found||sorted[0]||defaultScoreRule;};
}
export const scoreRuleFinder=db=>ruleFinder(scoreRuleRows(db));
// n: {nId,nKurang,nTidak,nTeguran} = cacah temuan. Batas potongan per pengantaran dijaga
// saat aturan disimpan (≤ 100), jadi jumlah potongan sama dengan jumlah potongan setiap
// pengantaran.
export const potonganOf=(rule,n)=>n.nId*rule.pot_id+n.nKurang*rule.pot_kurang+n.nTidak*rule.pot_tidak+n.nTeguran*rule.pot_teguran;

export function scoreRuleState(db,nowMs=Date.now()){
 const current=witaMonth(nowMs),next=nextMonthOf(current),rows=scoreRuleRows(db),find=ruleFinder(rows);
 return {bulan_ini:current,bulan_depan:next,berlaku:find(current),bulan_depan_aturan:find(next),riwayat:rows,
  rencana:rows.filter(r=>r.berlaku_mulai>current),batas:{potongan_maks:scoringRules.potonganMaks,teguran_maks:scoringRules.teguranMaks}};
}
export function saveScoreRule(db,user,b,audit,nowMs=Date.now()){
 const month=String(b?.berlaku_mulai||'');
 assert(monthPattern.test(month),'Bulan berlaku tidak valid.');
 assert(month>witaMonth(nowMs),'Aturan hanya bisa diubah untuk bulan depan atau sesudahnya, supaya aturan bulan berjalan tidak berubah di tengah jalan.',409);
 const value=(key,label,min,max)=>{const raw=b[key],n=Number(raw);assert(raw!==''&&raw!=null&&Number.isInteger(n)&&n>=min&&n<=max,`${label} harus bilangan bulat ${min}–${max}.`);return n;};
 const max=scoringRules.potonganMaks;
 const row={pot_id:value('pot_id','Potongan tanpa ID-Card',0,max),pot_kurang:value('pot_kurang','Potongan seragam kurang lengkap',0,max),pot_tidak:value('pot_tidak','Potongan tidak berseragam',0,max),
  pot_teguran:value('pot_teguran','Potongan per teguran',0,max),ambang:value('ambang','Ambang layak reward',50,100),minimal:value('minimal','Minimal pengantaran',1,60)};
 assert(row.pot_kurang<=row.pot_tidak,'Potongan "kurang lengkap" tidak boleh lebih besar dari "tidak berseragam".');
 assert(row.pot_id+row.pot_tidak+scoringRules.teguranMaks*row.pot_teguran<=100,`Potongan terbesar per pengantaran (tanpa ID + tidak berseragam + ${scoringRules.teguranMaks} teguran) tidak boleh lebih dari 100.`);
 const existing=one(db,'SELECT * FROM visit_score_rules WHERE berlaku_mulai=?',month),stamp=now();
 if(existing)run(db,'UPDATE visit_score_rules SET pot_id=?,pot_kurang=?,pot_tidak=?,pot_teguran=?,ambang=?,minimal=?,created_by=?,created_at=? WHERE berlaku_mulai=?',
  row.pot_id,row.pot_kurang,row.pot_tidak,row.pot_teguran,row.ambang,row.minimal,user.id,stamp,month);
 else run(db,'INSERT INTO visit_score_rules(berlaku_mulai,pot_id,pot_kurang,pot_tidak,pot_teguran,ambang,minimal,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
  month,row.pot_id,row.pot_kurang,row.pot_tidak,row.pot_teguran,row.ambang,row.minimal,user.id,stamp);
 audit(db,user,existing?'UPDATE':'CREATE','visit_score_rules',month,{...row,sebelumnya:existing?ruleView(existing):null});
 return ruleView(one(db,'SELECT * FROM visit_score_rules WHERE berlaku_mulai=?',month));
}
// Rencana yang belum berlaku boleh dibatalkan; aturan yang sudah berjalan tidak.
export function deleteScoreRule(db,user,b,audit,nowMs=Date.now()){
 const month=String(b?.berlaku_mulai||'');
 assert(monthPattern.test(month),'Bulan berlaku tidak valid.');
 assert(month>witaMonth(nowMs),'Aturan yang sudah berlaku tidak bisa dihapus.',409);
 const existing=one(db,'SELECT * FROM visit_score_rules WHERE berlaku_mulai=?',month);
 assert(existing,'Rencana aturan ini tidak ada.',404);
 run(db,'DELETE FROM visit_score_rules WHERE berlaku_mulai=?',month);
 audit(db,user,'DELETE','visit_score_rules',month,ruleView(existing));
 return {deleted:month};
}

/* ---------------- Jenis temuan ---------------- */

const typeView=t=>({kode:t.id,jenis:t.jenis,label:t.label,urut:Number(t.urut),perlu_catatan:t.jenis!=='teguran'||Number(t.perlu_catatan)===1,aktif:Number(t.is_active)===1,row_version:Number(t.row_version)});
export const findingTypeList=db=>all(db,'SELECT * FROM visit_finding_types ORDER BY jenis,urut,label').map(typeView);
const slugOf=label=>label.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,36).replace(/-+$/,'');
export function saveFindingType(db,user,b,audit){
 const label=cleanText(b?.label);
 assert(label.length>=2&&label.length<=80,'Nama jenis temuan wajib diisi (2–80 huruf).');
 assert(typeof b.aktif==='boolean','Status aktif wajib dipilih.');
 const urut=b.urut===undefined||b.urut===null||b.urut===''?null:Number(b.urut);
 assert(urut===null||(Number.isInteger(urut)&&urut>=0&&urut<=999),'Urutan harus bilangan bulat 0–999.');
 if(b.kode){
  const current=one(db,'SELECT * FROM visit_finding_types WHERE id=?',String(b.kode));
  assert(current,'Jenis temuan tidak ditemukan.',404);
  // Teguran boleh tanpa catatan; pelanggaran berat dan apresiasi selalu wajib catatan.
  const perlu=current.jenis==='teguran'?(b.perlu_catatan===true?1:0):1;
  const saved=update(db,'visit_finding_types',current.id,b.row_version,{label,urut:urut??Number(current.urut),perlu_catatan:perlu,is_active:b.aktif?1:0,updated_by:user.id});
  audit(db,user,'UPDATE','visit_finding_types',current.id,{jenis:current.jenis,label,aktif:b.aktif,perlu_catatan:perlu===1});
  return typeView(saved);
 }
 assert(findingKinds.includes(b.jenis),'Jenis harus teguran, berat, atau apresiasi.');
 assert(!all(db,'SELECT label FROM visit_finding_types WHERE jenis=?',b.jenis).some(t=>t.label.toLocaleLowerCase('id')===label.toLocaleLowerCase('id')),'Nama jenis ini sudah ada.',409);
 let base=slugOf(label);if(base.length<2)base=`${b.jenis}-jenis`;
 // Kode tidak pernah dipakai ulang: penilaian lama tetap merujuk kodenya.
 const taken=new Set(all(db,'SELECT id FROM visit_finding_types').map(t=>t.id));
 let code=base;for(let i=2;taken.has(code);i++)code=`${base}-${i}`;
 assert(findingCode.test(code),'Kode jenis temuan tidak dapat dibentuk dari nama ini.');
 const next=urut??Math.min(989,Number(one(db,'SELECT coalesce(max(urut),0) AS n FROM visit_finding_types WHERE jenis=? AND urut<90',b.jenis).n)+10);
 const saved=insert(db,'visit_finding_types',{id:code,jenis:b.jenis,label,urut:next,perlu_catatan:b.jenis==='teguran'?(b.perlu_catatan===true?1:0):1,is_active:b.aktif?1:0,created_by:user.id,updated_by:user.id});
 audit(db,user,'CREATE','visit_finding_types',saved.id,{jenis:b.jenis,label});
 return typeView(saved);
}

/* ---------------- Petugas penilai ---------------- */

const assessorView=a=>({id:a.id,nama:a.nama,keterangan:a.keterangan||'',aktif:Number(a.is_active)===1,row_version:Number(a.row_version)});
export const assessorList=db=>all(db,'SELECT * FROM visit_assessors ORDER BY is_active DESC,nama').map(assessorView);
export function saveAssessor(db,user,b,audit){
 const nama=cleanText(b?.nama),keterangan=cleanText(b?.keterangan);
 assert(nama.length>=2&&nama.length<=120,'Nama petugas wajib diisi (2–120 huruf).');
 assert(keterangan.length<=80,'Keterangan maksimal 80 huruf.');
 assert(typeof b.aktif==='boolean','Status aktif wajib dipilih.');
 const key=nama.toLocaleLowerCase('id');
 const twin=all(db,'SELECT id,nama FROM visit_assessors WHERE is_active=1').find(a=>a.id!==b.id&&a.nama.toLocaleLowerCase('id')===key);
 assert(!(b.aktif&&twin),'Nama petugas ini sudah ada di daftar. Tambahkan pembeda, misalnya unit atau pos.',409);
 if(b.id){
  const current=one(db,'SELECT * FROM visit_assessors WHERE id=?',String(b.id));assert(current,'Petugas tidak ditemukan.',404);
  const saved=update(db,'visit_assessors',current.id,b.row_version,{nama,keterangan,is_active:b.aktif?1:0,updated_by:user.id});
  audit(db,user,'UPDATE','visit_assessors',current.id,{aktif:b.aktif});
  return assessorView(saved);
 }
 const saved=insert(db,'visit_assessors',{nama,keterangan,is_active:b.aktif?1:0,created_by:user.id,updated_by:user.id});
 audit(db,user,'CREATE','visit_assessors',saved.id,{aktif:b.aktif});
 return assessorView(saved);
}

/* ---------------- Petunjuk formulir pos ---------------- */

export function formSettings(db){
 const s=one(db,'SELECT * FROM visit_form_settings WHERE id=1');
 return {petunjuk_id:s?.petunjuk_id||'',petunjuk_seragam:s?.petunjuk_seragam||'',row_version:Number(s?.row_version||1),updated_at:s?.updated_at||null};
}
export function saveFormSettings(db,user,b,audit){
 const petunjukId=typeof b?.petunjuk_id==='string'?b.petunjuk_id.trim():'',petunjukSeragam=typeof b?.petunjuk_seragam==='string'?b.petunjuk_seragam.trim():'';
 assert(petunjukId.length>=1&&petunjukId.length<=300,'Petunjuk ID-Card wajib diisi (maksimal 300 huruf).');
 assert(petunjukSeragam.length>=1&&petunjukSeragam.length<=500,'Petunjuk seragam wajib diisi (maksimal 500 huruf).');
 update(db,'visit_form_settings',1,b.row_version,{petunjuk_id:petunjukId,petunjuk_seragam:petunjukSeragam,updated_by:user.id});
 audit(db,user,'UPDATE','visit_form_settings','1',{});
 return formSettings(db);
}

// Bahan formulir pos (dikirim bersama daftar guide lewat tautan pos): jenis temuan
// aktif, petugas aktif, dan petunjuk. Bobot potongan TIDAK dikirim: petugas mencatat
// fakta, bukan angka.
export function formScoringContext(db){
 const types=all(db,'SELECT id,jenis,label,perlu_catatan FROM visit_finding_types WHERE is_active=1 ORDER BY jenis,urut,label');
 const byKind=jenis=>types.filter(t=>t.jenis===jenis).map(t=>({kode:t.id,label:t.label,perluCatatan:jenis!=='teguran'||Number(t.perlu_catatan)===1}));
 const s=formSettings(db);
 return {versi:2,teguranMaks:scoringRules.teguranMaks,catatanMin:scoringRules.catatanMin,teguran:byKind('teguran'),berat:byKind('berat'),apresiasi:byKind('apresiasi'),
  petugas:all(db,'SELECT id,nama,keterangan FROM visit_assessors WHERE is_active=1 ORDER BY nama').map(a=>({id:a.id,nama:a.nama,keterangan:a.keterangan||''})),
  petunjuk:{idCard:s.petunjuk_id,seragam:s.petunjuk_seragam}};
}

/* ---------------- Pelanggaran berat & apresiasi ---------------- */

export const flagStatuses=Object.freeze(['menunggu','disetujui','ditolak','dibatalkan']);
// Satu pengantaran tetap satu kejadian walau penilaiannya beberapa kali dikoreksi.
// Identitas ini disalin ke laporan sebelum rincian penilaian dilipat oleh retensi.
export function flagEventId(db,evaluationId){
 let id=evaluationId;
 const seen=new Set();
 for(;;){
  assert(!seen.has(id),'Rangkaian koreksi penilaian tidak valid.',409);seen.add(id);
  const existing=one(db,'SELECT event_id FROM visit_flags WHERE evaluation_id=? LIMIT 1',id);
  if(existing?.event_id)return existing.event_id;
  const evaluation=one(db,'SELECT koreksi_dari FROM visit_evaluations WHERE id=?',id);
  if(!evaluation?.koreksi_dari)return id;
  id=evaluation.koreksi_dari;
 }
}
// Versi Edge lama masih boleh menerima laporan di sela migrasi dan deployment.
// Telusuri hanya laporan tanpa event_id; UNION menghentikan data bersiklus yang
// mungkin berasal dari data lama. Laporan normal tidak perlu menelusuri rincian.
const flagLineage=where=>`WITH RECURSIVE flag_lineage(flag_id,evaluation_id,koreksi_dari) AS (
 SELECT f.id,f.evaluation_id,e.koreksi_dari FROM visit_flags f
 LEFT JOIN visit_evaluations e ON e.id=f.evaluation_id WHERE f.event_id IS NULL AND ${where}
 UNION
 SELECT l.flag_id,e.id,e.koreksi_dari FROM flag_lineage l JOIN visit_evaluations e ON e.id=l.koreksi_dari
), flag_roots AS (
 SELECT l.flag_id,coalesce(l.koreksi_dari,l.evaluation_id) AS event_id FROM flag_lineage l
 WHERE l.koreksi_dari IS NULL OR NOT EXISTS(SELECT 1 FROM visit_evaluations e WHERE e.id=l.koreksi_dari)
)`;
// Panggil sebelum retensi menghapus rincian agar laporan dari versi Edge lama juga
// mempertahankan identitas kejadian. Tidak mengubah keputusan atau riwayat audit.
export function resolveFlagEvents(db,through){
 return Number(run(db,`${flagLineage('f.wita_date<=?')}
  UPDATE visit_flags SET event_id=(SELECT r.event_id FROM flag_roots r WHERE r.flag_id=visit_flags.id)
  WHERE event_id IS NULL AND id IN(SELECT flag_id FROM flag_roots)`,through).changes);
}
const flagView=f=>({id:f.id,evaluationId:f.evaluation_id,jenis:f.jenis,kode:f.kode,label:f.label||f.kode,guideId:f.guide_id,guideName:f.guide_name,regu:f.regu||'',pos:Number(f.pos),
 tanggal:f.wita_date,waktu:f.evaluated_at,catatan:f.catatan,petugas:f.petugas_nama||'',status:f.status,keputusanCatatan:f.keputusan_catatan||'',
 diputuskanOleh:f.decided_by_name||'',diputuskanPada:f.decided_at||null,row_version:Number(f.row_version)});
const flagSelect=`SELECT f.*,t.label,g.regu,(SELECT username FROM users WHERE id=f.decided_by) AS decided_by_name FROM visit_flags f
 LEFT JOIN visit_finding_types t ON t.id=f.kode LEFT JOIN visit_guides g ON g.id=f.guide_id`;
export function flagList(db,q){
 const where=['f.wita_date>=?','f.wita_date<=?'],args=[q.from,q.to];
 if(q.status){assert(flagStatuses.includes(q.status),'Status laporan tidak valid.');where.push('f.status=?');args.push(q.status);}
 if(q.jenis){assert(['berat','apresiasi'].includes(q.jenis),'Jenis laporan tidak valid.');where.push('f.jenis=?');args.push(q.jenis);}
 const items=all(db,`${flagSelect} WHERE ${where.join(' AND ')} ORDER BY CASE WHEN f.status='menunggu' THEN 0 ELSE 1 END,f.wita_date DESC,f.evaluated_at DESC LIMIT ?`,...args,scoringRules.flagLimit).map(flagView);
 const counts=Object.fromEntries(flagStatuses.map(s=>[s,0]));
 for(const r of all(db,'SELECT status,count(*) AS n FROM visit_flags WHERE wita_date>=? AND wita_date<=? GROUP BY status',q.from,q.to))counts[r.status]=Number(r.n);
 const waiting=Number(one(db,"SELECT count(*) AS n FROM visit_flags WHERE status='menunggu'").n);
 return {items,counts,menunggu_semua:waiting,batas:scoringRules.flagLimit};
}
// Setujui / tolak laporan yang menunggu; "buka" mengembalikan keputusan ke menunggu
// (salah pilih). Semua tercatat di audit.
const decisionSnapshot=f=>({status:f.status,catatan:f.keputusan_catatan||'',diputuskan_oleh:f.decided_by||null,
 diputuskan_pada:f.decided_at||null,diperbarui_pada:f.updated_at,row_version:Number(f.row_version)});
export function decideFlag(db,user,b,audit){
 assert(['setujui','tolak','buka'].includes(b?.action),'Tindakan tidak valid.');
 const f=one(db,'SELECT * FROM visit_flags WHERE id=?',String(b.id||''));
 assert(f,'Laporan tidak ditemukan.',404);
 assert(Number(b.row_version)===Number(f.row_version),'Laporan sudah berubah. Muat ulang halaman.',409);
 const note=typeof b.catatan==='string'?b.catatan.trim():'';
 assert(note.length<=500,'Catatan keputusan maksimal 500 huruf.');
 const stamp=now();
 if(b.action==='buka'){
  assert(['disetujui','ditolak'].includes(f.status),'Laporan ini belum diputuskan.',409);
  run(db,"UPDATE visit_flags SET status='menunggu',decided_by=NULL,decided_at=NULL,keputusan_catatan=?,updated_at=?,row_version=row_version+1 WHERE id=? AND row_version=?",note,stamp,f.id,f.row_version);
 }else{
  assert(f.status==='menunggu',f.status==='dibatalkan'?'Laporan ini dibatalkan karena penilaiannya dikoreksi petugas pos.':'Laporan ini sudah diputuskan.',409);
  assert(b.action==='setujui'||note.length>=scoringRules.catatanMin,'Tulis alasan penolakan.');
  run(db,'UPDATE visit_flags SET status=?,decided_by=?,decided_at=?,keputusan_catatan=?,updated_at=?,row_version=row_version+1 WHERE id=? AND row_version=?',
   b.action==='setujui'?'disetujui':'ditolak',user.id,stamp,note,stamp,f.id,f.row_version);
 }
 const saved=one(db,`${flagSelect} WHERE f.id=?`,f.id);
 audit(db,user,'DECIDE','visit_flags',f.id,{tindakan:b.action,jenis:f.jenis,kode:f.kode,guide:f.guide_id,tanggal:f.wita_date,
  sebelum:decisionSnapshot(f),sesudah:decisionSnapshot(saved)},note);
 return flagView(saved);
}
// Laporan yang belum diputuskan ikut batal bila penilaiannya dikoreksi petugas pos.
export function cancelPendingFlags(db,evaluationId){
 return run(db,"UPDATE visit_flags SET status='dibatalkan',updated_at=?,row_version=row_version+1 WHERE evaluation_id=? AND status='menunggu'",now(),evaluationId).changes;
}
// Cacah KEJADIAN per guide pada rentang tanggal, bukan jumlah versi laporannya.
// Keputusan yang disetujui tetap berlaku saat ada koreksi; versi lain dari kejadian
// itu tidak memberi apresiasi tambahan. Bila belum ada persetujuan, kejadian yang
// punya laporan menunggu dihitung satu kali. event_id tetap ada setelah retensi.
export function flagCounts(db,from,to){
 const out=new Map();
 for(const r of all(db,`${flagLineage("f.wita_date>=? AND f.wita_date<=? AND f.status IN('menunggu','disetujui')")}
 SELECT guide_id,jenis,status,count(*) AS n FROM (
  SELECT f.guide_id,f.jenis,coalesce(f.event_id,r.event_id,f.evaluation_id) AS event_id,
   CASE WHEN max(CASE WHEN f.status='disetujui' THEN 1 ELSE 0 END)=1 THEN 'disetujui' ELSE 'menunggu' END AS status
  FROM visit_flags f LEFT JOIN flag_roots r ON r.flag_id=f.id
  WHERE f.wita_date>=? AND f.wita_date<=? AND f.status IN('menunggu','disetujui')
  GROUP BY f.guide_id,f.jenis,coalesce(f.event_id,r.event_id,f.evaluation_id)
 ) AS events GROUP BY guide_id,jenis,status`,from,to,from,to)){
  let g=out.get(r.guide_id);if(!g){g={berat:{disetujui:0,menunggu:0},apresiasi:{disetujui:0,menunggu:0}};out.set(r.guide_id,g);}
  g[r.jenis][r.status]=Number(r.n);
 }
 return out;
}
