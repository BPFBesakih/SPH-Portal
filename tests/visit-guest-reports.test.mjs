// Review negatif dan komplain dari menu HP pos (keputusan pemilik 23 November 2026):
//   - dicatat petugas pos (nama wajib), baru berdampak setelah disetujui Pengelola Kunjungan;
//   - review: nilai akhir bulan kejadian dipotong sebesar yang ditetapkan Pengelola, tanpa
//     batas per bulan, paling rendah 0;
//   - komplain (dan pelanggaran berat terverifikasi): nilai bulan itu dihapus (0), gugur
//     reward, keluar dari peringkat.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {openDb,insert,one,all,tx,now} from '../lib/db.mjs';
import {seedPermissions,digest,hashPasswordSync} from '../lib/auth.mjs';
import {visitRoutes} from '../lib/visits.mjs';
import {ingestGuideEvaluations,visitOverview,visitReport,nilaiAkhirOf} from '../lib/visit-data.mjs';
import {admitGuideForm,submitGuideForm,guideFormReceipt,guideFormContext,checkGuestReportItem,recordGuideFormResult} from '../lib/guide-form.mjs';
import {handleGuideForm} from '../site-info/lib/guide-form.mjs';

const password=hashPasswordSync('FixtureLaporan2026!');
const token='7'.repeat(64);
// Oktober 2026, jam pos (WITA = UTC+8).
const T=(day,hour,minute=0)=>Date.UTC(2026,9,day,hour-8,minute);
const iso=ms=>new Date(ms).toISOString();
function fixture(t){
 const db=openDb(':memory:');t.after(()=>db.close());seedPermissions(db);
 const person=(username,role)=>{const u=insert(db,'users',{username,password_hash:password,status:'ACTIVE',must_change_password:0,failed_login_count:0,password_changed_at:now()});
  insert(db,'user_roles',{user_id:u.id,role_id:one(db,'SELECT id FROM roles WHERE code=?',role).id,scope_kind:'ALL'});return u;};
 const pengelola=person('kunjungan.laporan','KUNJUNGAN_PENGELOLA'),pimpinan=person('pimpinan.laporan','KUNJUNGAN_PIMPINAN');
 for(let i=1;i<=6;i++)insert(db,'visit_guides',{id:`G-00${i}`,seq:i,name:`Guide Fiktif ${i}`,kategori:'Asing',regu:'A1',is_active:1});
 const link=insert(db,'guide_form_links',{pos:3,label:'Pos 3 — Pelataran Utama',token_hash:digest(token),share_token:token,is_active:1,created_by:pengelola.id});
 const petugas=insert(db,'visit_assessors',{nama:'Petugas Fiktif',keterangan:'Pos 3',is_active:1});
 const route=(user,path,method='GET',body={},query='')=>visitRoutes({db,user,p:['visits',...path.split('/')],method,body,url:new URL(`https://portal.test/?${query}`)});
 const laporan=(extra={})=>({evaluationId:crypto.randomUUID(),jenis:'review',guideId:'G-001',guideName:'Guide Fiktif 1',pos:3,timestamp:iso(T(10,15)),tanggal:'2026-10-10',
  kode:'kurang-ramah',keterangan:'Wisatawan bilang guide-nya ketus.',petugasId:petugas.id,...extra});
 const komplain=(extra={})=>laporan({jenis:'komplain',kode:'komplain-pungutan',keterangan:'Diminta uang tambahan Rp100.000.',kronologi:'Setelah di pelataran, guide meminta uang tambahan di luar tarif.',
  wisatawan:{nama:'Wisatawan Fiktif',asal:'Australia',kontak:'+61 400 000 000'},...extra});
 // Sama dengan Edge guide-form: terima, catat hasil kiriman (tanpa isi), lalu balasan untuk HP.
 const submit=(body,at=T(10,16))=>tx(db,()=>{const admitted=admitGuideForm(db,'submit',{token,...body}),result=submitGuideForm(db,admitted,at);
  recordGuideFormResult(db,admitted,result,null);return {admitted,receipt:guideFormReceipt(admitted,result)};});
 // 10 pengantaran bersih per guide pada 10 Oktober (nilai 100), berjarak 20 menit.
 const deliveries=(guideId,{berat=null}={})=>{
  const items=Array.from({length:10},(_,i)=>({evaluationId:crypto.randomUUID(),guideId,guideName:'x',pos:3,timestamp:iso(T(10,8,i*20)),
   criteria:{idCard:true,seragam:'lengkap',teguran:[],etika:0,berat:i===0?berat:null,apresiasi:null},catatan:i===0&&berat?'Dilihat sendiri oleh petugas.':'',petugasId:petugas.id}));
  const r=tx(db,()=>ingestGuideEvaluations(db,{id:link.id,pos:3},items,T(10,18)));
  assert.deepEqual(r.rejected,[]);return items;
 };
 const report=id=>one(db,'SELECT * FROM visit_guest_reports WHERE id=?',id);
 const decide=(id,action,extra={})=>{const r=report(id);return route(pengelola,'guest-reports/decide','POST',{id,row_version:Number(r.row_version),action,...extra});};
 return {db,pengelola,pimpinan,link,petugas,route,laporan,komplain,submit,deliveries,report,decide};
}

test('konteks formulir pos membawa daftar review negatif & komplain; potongan bawaan tidak dikirim',t=>{
 const f=fixture(t),k=guideFormContext(f.db,{pos:3,label:'Pos 3'}).penilaian;
 assert.deepEqual(k.laporan.review.map(x=>x.kode),['kurang-ramah','penjelasan-kurang','terburu-buru','terlambat','review-lain']);
 assert.deepEqual(k.laporan.komplain.map(x=>x.kode),['komplain-pungutan','komplain-memaksa','komplain-kasar','komplain-menelantarkan','komplain-lain']);
 assert(k.laporan.review.every(x=>x.perluCatatan===true));
 assert.equal(k.laporan.mundurHari,7);assert.equal(k.laporan.keteranganMin,3);assert.equal(k.laporan.kronologiMaks,1000);
 assert(!JSON.stringify(k).includes('pot_review'),'bobot tidak dikirim ke HP');
 const scoring=f.route(f.pengelola,'scoring');assert.equal(scoring.petunjuk.pot_review,5);
 // Jenis baru bisa diatur di Aturan Nilai seperti jenis pelanggaran berat.
 const added=f.route(f.pengelola,'scoring/types','POST',{jenis:'komplain',label:'Membawa tamu ke tempat belanja tertentu',aktif:true});
 assert.equal(added.jenis,'komplain');assert.equal(added.perlu_catatan,true);
 assert(guideFormContext(f.db,{pos:3,label:'Pos 3'}).penilaian.laporan.komplain.some(x=>x.kode===added.kode));
});

test('catatan dari HP: diterima menunggu, kiriman ulang diakui, bentuk dan aturan terima diperiksa',t=>{
 const f=fixture(t),r=f.laporan(),k=f.komplain();
 const first=f.submit({laporan:[r,k]});
 assert.deepEqual(first.receipt.accepted.map(a=>[a.evaluationId,a.duplicate]),[[r.evaluationId,false],[k.evaluationId,false]]);
 assert.deepEqual(first.receipt.rejected,[]);
 const saved=f.report(k.evaluationId);
 assert.equal(saved.status,'menunggu');assert.equal(saved.jenis,'komplain');assert.equal(saved.jenis_awal,'komplain');assert.equal(saved.petugas_nama,'Petugas Fiktif');
 assert.equal(saved.wisatawan_asal,'Australia');assert.equal(saved.wita_date,'2026-10-10');assert.equal(saved.pos,3);
 assert.equal(f.report(r.evaluationId).kronologi,'','review tidak menyimpan kronologi');
 const again=f.submit({laporan:[r]});
 assert.deepEqual(again.receipt.accepted,[{evaluationId:r.evaluationId,synced:true,duplicate:true}]);
 assert.equal(one(f.db,'SELECT count(*) AS n FROM visit_guest_reports').n,2);
 // Penilaian dan catatan boleh dalam satu kiriman; batasnya dihitung bersama.
 const evaluation={evaluationId:crypto.randomUUID(),guideId:'G-002',guideName:'x',pos:3,timestamp:iso(T(10,9)),criteria:{idCard:true,seragam:'lengkap',etika:0},catatan:''};
 const mixed=f.submit({evaluations:[evaluation],laporan:[f.laporan({guideId:'G-002'})]});
 assert.equal(mixed.receipt.accepted.length,2);assert.equal(mixed.receipt.rejected.length,0);
 assert.throws(()=>f.submit({evaluations:Array.from({length:15},()=>({})),laporan:Array.from({length:6},()=>f.laporan())}),e=>e.status===413);
 assert.throws(()=>f.submit({laporan:[]}),e=>e.status===400);
 // Bentuk (ditolak di HP-gateway): kronologi komplain, nama petugas, pos tautan, tanggal.
 for(const [item,pesan] of [[f.komplain({kronologi:' '}),/kronologi/],[f.laporan({petugasId:undefined}),/petugas/],[f.laporan({pos:1}),/pos catatan/],
  [f.laporan({tanggal:'2026-02-30'}),/tanggal kejadian/],[f.laporan({keterangan:'ok'}),/keterangan/],[f.laporan({jenis:'pujian'}),/jenis harus/],
  [f.komplain({wisatawan:{kontak:'x'.repeat(121)}}),/data wisatawan/]])
  assert.match(checkGuestReportItem(item,3).join('; '),pesan);
 // Aturan terima di server: jenis keluhan harus dari daftar jenisnya, guide terdaftar, tanggal kejadian ≤ 7 hari sebelum dicatat.
 const ditolak=f.submit({laporan:[f.laporan({kode:'komplain-kasar'}),f.laporan({kode:'tidak-ada'}),f.laporan({guideId:'G-999'}),
  f.laporan({tanggal:'2026-10-02'}),f.laporan({tanggal:'2026-10-11'})]});
 assert.equal(ditolak.receipt.accepted.length,0);
 assert.deepEqual(ditolak.receipt.rejected.map(x=>x.errors[0].split(' ')[0]),['Jenis','Jenis','Guide','Tanggal','Tanggal']);
 const lama=f.submit({laporan:[f.laporan({timestamp:iso(T(10,15)-31*86400000),tanggal:'2026-09-09'})]});
 assert.match(lama.receipt.rejected[0].errors[0],/tertahan di HP lebih dari 30 hari/);
 // Kiriman tidak pernah mencatat isi catatan; hanya hasilnya.
 const logged=all(f.db,'SELECT * FROM guide_form_submissions');
 assert(logged.length>0&&!JSON.stringify(logged).includes('ketus'));
});

test('keputusan Pengelola: potongan review bebas 1–100, komplain wajib klarifikasi, tolak wajib alasan, buka dan pindah diaudit',t=>{
 const f=fixture(t),r=f.laporan(),k=f.komplain();f.submit({laporan:[r,k]});
 for(const potongan of [0,101,2.5,'',null])assert.throws(()=>f.decide(r.evaluationId,'setujui',{potongan}),/Potongan review negatif harus bilangan bulat 1–100/,String(potongan));
 const approved=f.decide(r.evaluationId,'setujui',{potongan:37,catatan:'Dikonfirmasi koordinator lapangan.'});
 assert.equal(approved.status,'disetujui');assert.equal(approved.potongan,37);
 assert.throws(()=>f.decide(r.evaluationId,'setujui',{potongan:5}),e=>e.status===409);
 f.decide(r.evaluationId,'buka',{catatan:'Salah pilih guide.'});
 assert.equal(f.report(r.evaluationId).potongan,null);assert.equal(f.report(r.evaluationId).status,'menunggu');
 assert.throws(()=>f.decide(k.evaluationId,'setujui'),/klarifikasi guide/);
 assert.throws(()=>f.decide(k.evaluationId,'tolak',{catatan:''}),/alasan penolakan/);
 const sah=f.decide(k.evaluationId,'setujui',{klarifikasi:'Guide tidak menanggapi panggilan 3 hari.'});
 assert.equal(sah.status,'disetujui');assert.equal(sah.potongan,null);
 // Pindah hanya selama menunggu, ke jenis aktif di daftar tujuan.
 assert.throws(()=>f.decide(k.evaluationId,'pindah',{kode:'kurang-ramah'}),e=>e.status===409);
 assert.throws(()=>f.decide(r.evaluationId,'pindah',{kode:'kurang-ramah'}),/Pilih jenis komplain/);
 const moved=f.decide(r.evaluationId,'pindah',{kode:'komplain-kasar',catatan:'Isinya ancaman, bukan soal pelayanan.'});
 assert.equal(moved.jenis,'komplain');assert.equal(moved.jenisAwal,'review');assert.equal(moved.kode,'komplain-kasar');assert.equal(moved.status,'menunggu');
 const audit=all(f.db,"SELECT * FROM audit_events WHERE object_type='visit_guest_reports' ORDER BY occurred_at");
 assert.deepEqual(audit.map(a=>JSON.parse(a.change_summary).tindakan),['setujui','buka','setujui','pindah']);
 assert.equal(JSON.parse(audit[0].change_summary).sesudah.potongan,37);
 // Pimpinan melihat tanpa data wisatawan dan tidak bisa memutuskan.
 const forPimpinan=f.route(f.pimpinan,'guest-reports','GET',{},'from=2026-10-01&to=2026-10-31');
 assert.equal(forPimpinan.can_decide,false);assert(forPimpinan.items.every(x=>x.wisatawan===null));
 assert(!JSON.stringify(forPimpinan).includes('Australia'));
 assert.throws(()=>f.route(f.pimpinan,'guest-reports/decide','POST',{id:k.evaluationId,row_version:1,action:'buka'}),e=>e.status===403);
 assert.throws(()=>f.route(f.pimpinan,'scoring/reports','POST',{pot_review:8,row_version:1}),e=>e.status===403);
 const forPengelola=f.route(f.pengelola,'guest-reports','GET',{},'from=2026-10-01&to=2026-10-31&jenis=komplain');
 assert.equal(forPengelola.items.length,2);assert.equal(forPengelola.items.find(x=>x.id===k.evaluationId).wisatawan.asal,'Australia');
 assert.equal(forPengelola.menunggu_semua,1);assert.deepEqual(forPengelola.menunggu_jenis,{review:0,komplain:1});
 // Potongan bawaan bisa diubah Pengelola dan diaudit.
 const settings=f.route(f.pengelola,'scoring');
 assert.equal(f.route(f.pengelola,'scoring/reports','POST',{pot_review:12,row_version:settings.petunjuk.row_version}).pot_review,12);
 assert.throws(()=>f.route(f.pengelola,'scoring/reports','POST',{pot_review:0,row_version:settings.petunjuk.row_version+1}),/1–100/);
});

test('nilai akhir bulanan: review memotong tanpa batas, komplain dan pelanggaran berat menghapus nilai dan keluar dari peringkat',t=>{
 const f=fixture(t);
 f.deliveries('G-001');f.deliveries('G-002');const beratItems=f.deliveries('G-003',{berat:'pungutan'});f.deliveries('G-004');f.deliveries('G-005');
 const r1=f.laporan(),r2=f.laporan({kode:'terlambat'}),k=f.komplain({guideId:'G-002'}),pending=f.laporan({guideId:'G-004'});
 const big=[1,2,3].map(()=>f.laporan({guideId:'G-005'}));
 f.submit({laporan:[r1,r2,k,pending,...big]});
 f.decide(r1.evaluationId,'setujui',{potongan:5});f.decide(r2.evaluationId,'setujui',{potongan:3});
 f.decide(k.evaluationId,'setujui',{klarifikasi:'Guide mengakui meminta uang tambahan.'});
 for(const b of big)f.decide(b.evaluationId,'setujui',{potongan:40});
 const flag=one(f.db,"SELECT * FROM visit_flags WHERE evaluation_id=?",beratItems[0].evaluationId.toLowerCase());
 f.route(f.pengelola,'flags/decide','POST',{id:flag.id,row_version:Number(flag.row_version),action:'setujui'});

 const month=visitOverview(f.db,'2026-10-01','2026-10-31'),g=id=>month.perGuide.find(x=>x.guideId===id);
 assert.equal(month.aturan.satu_bulan,true);
 assert.equal(g('G-001').nilai,100);assert.equal(g('G-001').potonganReview,8);assert.equal(g('G-001').nilaiAkhir,92);
 assert.equal(g('G-001').status,'bawah');assert.match(g('G-001').alasan,/review negatif 8/);
 assert.equal(g('G-005').nilaiAkhir,0,'potongan tanpa batas, nilai akhir paling rendah 0');assert.equal(g('G-005').status,'bawah');
 assert.equal(g('G-002').nilaiAkhir,0);assert.equal(g('G-002').status,'gugur');assert.equal(g('G-002').sebab,'komplain');assert.equal(g('G-002').peringkat,null);
 assert.equal(g('G-003').nilaiAkhir,0);assert.equal(g('G-003').status,'gugur');assert.equal(g('G-003').sebab,'berat');assert.equal(g('G-003').peringkat,null);
 assert.equal(g('G-004').status,'layak');assert.match(g('G-004').alasan,/review negatif yang belum diputuskan/);assert.equal(g('G-004').nilaiAkhir,100,'yang menunggu belum memotong');
 assert.deepEqual(month.peringkat.nilaiTertinggi.map(x=>[x.guideId,x.peringkat]),[['G-004',1],['G-001',2],['G-005',3]]);
 assert.deepEqual(month.peringkat.nilaiTerendah.map(x=>x.guideId),['G-005','G-001','G-004']);
 assert.deepEqual(month.peringkat.komplainDisetujui.map(x=>x.guideId),['G-002']);
 assert.deepEqual(month.peringkat.beratTerverifikasi.map(x=>x.guideId),['G-003']);
 assert.deepEqual(month.peringkat.reviewNegatif.map(x=>[x.guideId,x.potonganReview]),[['G-005',120],['G-001',8]]);
 assert.deepEqual(month.perGuide.slice(-2).map(x=>x.guideId),['G-002','G-003'],'nilai yang dihapus tercantum tanpa peringkat di bawah');
 assert.equal(month.ringkasan.layak,1);assert.equal(month.diperingkat,3);
 assert.deepEqual(month.ringkasan.laporan,{review:{disetujui:5,menunggu:1,potongan:128},komplain:{disetujui:1,menunggu:0}});
 // Angka pos tidak berubah oleh review atau komplain.
 assert.equal(month.ringkasan.nilai,100);assert.equal(month.ringkasan.persenId,1);
 const petugas=month.perPetugas.find(p=>p.petugas==='Petugas Fiktif');
 assert.equal(petugas.review,6);assert.equal(petugas.komplain,1);assert.equal(petugas.laporanDitolak,0);assert.equal(petugas.pengantaran,50);
 // Rentang bukan satu bulan: tanpa nilai akhir dan status reward, tetapi nilai yang dihapus tetap tidak diperingkat.
 const range=visitOverview(f.db,'2026-10-05','2026-10-20');
 assert.equal(range.perGuide.find(x=>x.guideId==='G-001').nilaiAkhir,null);assert.equal(range.perGuide.find(x=>x.guideId==='G-001').status,undefined);
 assert(!range.peringkat.nilaiTertinggi.some(x=>['G-002','G-003'].includes(x.guideId)));
 // Laporan bulanan berikutnya membandingkan jumlah layak reward Oktober dengan aturan yang sama.
 const november=visitReport(f.db,'bulan','2026-11',Date.UTC(2026,10,15,4));
 assert.equal(november.sebelumnya.layak,1);
 // Rumus bersama: komplain/berat → 0; review → nilai − potongan, paling rendah 0.
 assert.equal(nilaiAkhirOf({nilai:97.5,potonganReview:2,komplain:0,berat:0}),95.5);
 assert.equal(nilaiAkhirOf({nilai:97.5,potonganReview:200,komplain:0,berat:0}),0);
 assert.equal(nilaiAkhirOf({nilai:100,potonganReview:0,komplain:1,berat:0}),0);
});

test('gateway Pages meneruskan daftar review & komplain tanpa isian internal; konteks rusak tidak diteruskan',async()=>{
 const env={PORTAL_ORIGIN:'https://portal.test',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'server-only-secret'};
 const request=()=>new Request('https://portal.test/api/guide-form/context',{method:'POST',headers:{Origin:'https://portal.test','Content-Type':'application/json','CF-Connecting-IP':'203.0.113.7'},body:JSON.stringify({token})});
 const laporan={review:[{kode:'kurang-ramah',label:'Kurang ramah',perluCatatan:true}],komplain:[{kode:'komplain-kasar',label:'Kasar',perluCatatan:true}],
  keteranganMin:3,keteranganMaks:500,kronologiMin:3,kronologiMaks:1000,wisatawanMaks:120,mundurHari:7};
 const penilaian={versi:2,teguranMaks:2,catatanMin:3,teguran:[],berat:[],apresiasi:[],petugas:[],petunjuk:{idCard:'a',seragam:'b'}};
 const call=async extra=>handleGuideForm(request(),env,async()=>Response.json({ok:true,result:{pos:3,label:'Pos 3',guides:[],penilaian:{...penilaian,...extra}}}));
 const ok=await call({laporan:{...structuredClone(laporan),pot_review:5,review:[{...laporan.review[0],created_by:'must-not-leak'}]}});
 assert.equal(ok.status,200);const data=await ok.json();
 assert.deepEqual(data.penilaian.laporan,laporan);assert(!JSON.stringify(data).includes('must-not-leak'));assert.equal(data.penilaian.laporan.pot_review,undefined);
 const lama=await (await call({})).json();assert.equal(lama.penilaian.laporan,undefined,'guide-form lama: HP menahan catatan');
 assert.equal((await call({laporan:{...laporan,mundurHari:'7'}})).status,503);
});

test('basis data lokal lama: jenis review/komplain dan potongan bawaan ditambahkan tanpa mengubah data',t=>{
 const dir=mkdtempSync(resolve(tmpdir(),'sph-laporan-')),path=resolve(dir,'portal.sqlite');
 let db;t.after(()=>{db?.close();rmSync(dir,{recursive:true,force:true});});
 const schema=readFileSync(new URL('../schema.sql',import.meta.url),'utf8');
 const lama=schema.replace("CHECK(jenis IN('teguran','berat','apresiasi','review','komplain'))","CHECK(jenis IN('teguran','berat','apresiasi'))")
  .replace(/-- Jenis keluhan wisatawan[\s\S]*?\('komplain-lain'[^\n]*\n/,'')
  .replace(/,\n -- Potongan bawaan saat Pengelola[^\n]*\n pot_review INTEGER NOT NULL DEFAULT 5 CHECK\(pot_review BETWEEN 1 AND 100\)\);/,');')
  .replace(/-- Review negatif dan komplain wisatawan yang dicatat[\s\S]*?CREATE INDEX IF NOT EXISTS visit_guest_reports_guide_day[^\n]*\n/,'');
 assert(!lama.includes('visit_guest_reports')&&!lama.includes('pot_review')&&!lama.includes("'komplain'"),'skema lama tersusun');
 db=new DatabaseSync(path);db.exec(lama);
 assert.throws(()=>db.prepare("INSERT INTO visit_finding_types(id,jenis,label,urut,perlu_catatan,created_at,updated_at,row_version) VALUES('x','review','X uji',1,1,'t','t',1)").run(),/CHECK constraint failed/);
 const before=db.prepare("SELECT id,jenis,label FROM visit_finding_types ORDER BY id").all();
 db.close();db=null;
 db=openDb(path);
 const after=all(db,"SELECT id,jenis,label FROM visit_finding_types ORDER BY id");
 for(const t of before)assert(after.some(x=>x.id===t.id&&x.jenis===t.jenis&&x.label===t.label),`jenis lama ${t.id} tetap`);
 assert.equal(after.filter(x=>x.jenis==='review').length,5);assert.equal(after.filter(x=>x.jenis==='komplain').length,5);
 assert.equal(one(db,'SELECT pot_review FROM visit_form_settings WHERE id=1').pot_review,5);
 assert.equal(Object.values(db.prepare('PRAGMA integrity_check').get())[0],'ok');
 db.exec('PRAGMA writable_schema=ON');
 assert.throws(()=>db.prepare("UPDATE sqlite_schema SET sql=sql WHERE name='visit_finding_types'").run(),/may not be modified/,'mode defensif kembali aktif');
 db.exec('PRAGMA writable_schema=OFF');
 assert.throws(()=>db.prepare("INSERT INTO visit_finding_types(id,jenis,label,urut,perlu_catatan,created_at,updated_at,row_version) VALUES('y','pujian','Y uji',1,1,'t','t',1)").run(),/CHECK constraint failed/);
 db.close();db=openDb(path);
 assert.equal(all(db,"SELECT id FROM visit_finding_types WHERE jenis IN('review','komplain')").length,10,'membuka ulang tidak menggandakan');
});
