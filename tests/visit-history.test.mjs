// Migrasi awal riwayat NilaiGuide (sekali) dan rekap harian. Data fiktif.
import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,insert,one,all,run,tx,now} from '../lib/db.mjs';
import {seedPermissions,hashPasswordSync} from '../lib/auth.mjs';
import {visitRoutes} from '../lib/visits.mjs';
import {ingestGuideEvaluations,visitOverview,witaDate,shiftDate,historyRules} from '../lib/visit-data.mjs';

const password=hashPasswordSync('fixture123'),DAY=86400000;
const guides=[['G-001','Guide Fiktif Satu','Asing','A1'],['G-002','Guide Fiktif Dua','Asing','A2'],['G-003','Guide Fiktif Tiga','Domestik','D1']];
function fixture(t){
  const db=openDb(':memory:');t.after(()=>db.close());seedPermissions(db);
  const account=(username,role)=>{const u=insert(db,'users',{username,password_hash:password,status:'ACTIVE',must_change_password:0,failed_login_count:0,password_changed_at:now()});if(role)insert(db,'user_roles',{user_id:u.id,role_id:one(db,'SELECT id FROM roles WHERE code=?',role).id,scope_kind:'ALL'});return u;};
  const users={manager:account('kunjungan','KUNJUNGAN_PENGELOLA'),leader:account('pimpinan','KUNJUNGAN_PIMPINAN'),hr:account('sdm','SDM')};
  for(const [id,name,kategori,regu] of guides)insert(db,'visit_guides',{id,seq:Number(id.slice(2)),name,kategori,regu,is_active:1});
  const route=(user,path,method='GET',body={},query='')=>visitRoutes({db,user,p:['visits',...path.split('/').filter(Boolean)],method,body,url:new URL('https://portal.test/?'+query)});
  return {db,users,route};
}
const sha=c=>c.repeat(64);
const file=(rows,parts=1,c='a')=>({name:'Penilaian Guide Besakih — Basis Data 2026.xlsx',sha256:sha(c),rows_total:rows,parts_total:parts});
// Baris seperti hasil baca berkas: [baris, evaluationId, timestamp, pos, guideId, uniform, idCard, etika, status].
let line=1;
const row=(timestamp,{id=crypto.randomUUID(),pos=1,guide='G-001',uniform=1,idCard=1,etika=1,status='aktif'}={})=>[++line,id,timestamp,pos,guide,uniform,idCard,etika,status];
const wita=(day,hour='09:00')=>new Date(`${day}T${hour}:00+08:00`).toISOString();
const preview=(f,rows,meta=file(rows.length),part=0,user=f.users.manager)=>f.route(user,'history/import','POST',{mode:'preview',file:meta,part,rows});
const apply=(f,rows,meta,part=0,import_id)=>f.route(f.users.manager,'history/import','POST',{mode:'apply',file:meta,part,rows,import_id});
const finish=(f,import_id)=>f.route(f.users.manager,'history/finish','POST',{import_id});
const figures=o=>JSON.stringify({...o,diperbarui:null,periode:null});

test('pratinjau tidak menyimpan apa pun dan membaca nilai persis seperti rekap NilaiGuide',t=>{
  const f=fixture(t);
  const rows=[
    row(wita('2026-03-02'),{uniform:2,idCard:1,etika:3}),
    row(wita('2026-03-02','10:00'),{uniform:true,idCard:'TRUE',etika:7}),          // TRUE → +1, Etika dibatasi +5
    row(wita('2026-03-03'),{uniform:0,idCard:false,etika:''}),                     // 0 → -1 (skala Ya/Tidak lama), Etika kosong → 0
    row(wita('2026-03-03','11:00'),{uniform:'FALSE',idCard:'0',etika:-9}),         // FALSE → -1, Etika dibatasi -5
    row(String(Date.UTC(2026,2,3,23,30)/DAY+25569),{pos:3,guide:'G-003',uniform:5,idCard:1,etika:0}), // sel tanggal Sheets: 3 Mar 23.30 WITA (bila dibaca UTC jadi 4 Mar); Uniform dibatasi +2
    row(wita('2026-03-04'),{status:'diganti'}),
    row(wita('2026-03-04'),{pos:2}),
    row(wita('2026-03-04'),{guide:'G-999'}),
    row(wita('2026-03-04'),{id:'=HYPERLINK("x")'}),
    row(wita('2025-12-31','20:00')),
    row('bukan tanggal'),
    row(wita('2026-03-04'),{pos:4}),
  ];
  const p=preview(f,rows);
  assert.deepEqual(p.counts,{MASUK:5,DIGANTI:1,POS2:1,BENTROK:0,DUPLIKAT:0,ID:1,TANGGAL:2,POS:1,GUIDE:1,ID_PORTAL:0});
  const march=p.months.find(m=>m.month==='2026-03');
  assert.deepEqual({antar:march.antar,uniform:march.uniform,patuh:march.uniform_patuh,id:march.id_card,etika:march.etika},{antar:5,uniform:2+1-1-1+2,patuh:3,id:3,etika:3+5+0-5+0});
  assert.equal(march.pos2,1);assert.equal(march.diganti,1);
  assert.equal(witaDate(Date.parse(wita('2026-03-02'))),p.first);
  assert.deepEqual(p.problems.map(x=>x.reason).sort(),['GUIDE','ID','POS','TANGGAL','TANGGAL']);
  assert.equal(one(f.db,'SELECT count(*) n FROM visit_daily_totals').n,0);assert.equal(one(f.db,'SELECT count(*) n FROM visit_history_import').n,0);
  assert.equal(p.months.length,1,'sel tanggal Sheets dibaca sebagai waktu WITA, bukan UTC');
  assert.equal(p.last,'2026-03-03');
});

test('terapkan per bagian: bagian yang diulang tidak menggandakan, dan baru dihitung setelah selesai',t=>{
  const f=fixture(t);
  const a=[row(wita('2026-02-10'),{uniform:2,etika:2}),row(wita('2026-02-10','11:00'),{guide:'G-002',uniform:-1,idCard:0,etika:-1})];
  const b=[row(wita('2026-02-11'),{pos:3,guide:'G-003'}),row(wita('2026-04-01'),{uniform:1,idCard:1,etika:1})];
  const meta=file(4,2);
  const before=visitOverview(f.db,'2026-02-01','2026-04-30');
  const first=apply(f,a,meta,0);assert.equal(first.import.status,'menyusun');assert.deepEqual(first.import.parts_done,[0]);
  const id=first.import.id;
  assert.equal(apply(f,a,meta,0,id).ulang,true,'bagian yang sama dikirim ulang');
  assert.equal(one(f.db,"SELECT sum(antar) n FROM visit_daily_totals WHERE sumber='nilaiguide'").n,2);
  assert.equal(figures(visitOverview(f.db,'2026-02-01','2026-04-30')),figures(before),'belum dihitung selama menyusun');
  assert.throws(()=>finish(f,id),e=>e.status===409&&/1 dari 2 bagian/.test(e.message));
  assert.throws(()=>apply(f,b,file(4,2,'b'),1,id),e=>e.status===409&&/berbeda/.test(e.message),'berkas lain');
  apply(f,b,meta,1,id);
  const done=finish(f,id);assert.equal(done.import.status,'aktif');assert.equal(done.import.ringkasan.counts.MASUK,4);
  assert.deepEqual([done.import.first_day,done.import.last_day],['2026-02-10','2026-04-01']);
  const o=visitOverview(f.db,'2026-02-01','2026-04-30');
  assert.equal(o.ringkasan.pengantaran,4);assert.equal(o.ringkasan.hariDinilai,3);
  // Nilai lama dipetakan ke "100 − potongan": G-002 tanpa ID (−20) dan Uniform −1 (−20);
  // Etika −1 saat seragam tidak sesuai tidak dihitung lagi sebagai teguran.
  const g1=o.perGuide.find(g=>g.guideId==='G-001'),g2=o.perGuide.find(g=>g.guideId==='G-002');
  assert.deepEqual([g1.antar,g1.hari,g1.nilai,g1.tanpaId,g1.tidakBerseragam,g1.teguran],[2,2,100,0,0,0]);
  assert.deepEqual([g2.antar,g2.nilai,g2.tanpaId,g2.tidakBerseragam,g2.teguran],[1,60,1,1,0]);
  assert.deepEqual(all(f.db,"SELECT n_id,n_kurang,n_tidak,n_teguran FROM visit_daily_totals WHERE guide_id='G-002'").map(r=>({...r})),[{n_id:1,n_kurang:0,n_tidak:1,n_teguran:0}]);
  assert.equal(visitOverview(f.db,'2026-02-11','2026-02-11').perPos.find(p=>p.pos===3).pengantaran,1,'rentang harian bebas');
  assert.equal(one(f.db,'SELECT count(*) n FROM visit_history_ids').n,4);
  assert.equal(one(f.db,"SELECT count(*) n FROM audit_events WHERE action='IMPORT' AND object_type='visit_history_import'").n,1);
  assert.equal(f.route(f.users.leader,'history').current.status,'aktif','pimpinan boleh melihat keadaannya');
});

test('hanya sekali: impor kedua ditolak, batalkan mengembalikan angka, lalu boleh diimpor ulang',t=>{
  const f=fixture(t),rows=[row(wita('2026-05-05')),row(wita('2026-05-06'),{guide:'G-002'})],meta=file(2);
  const empty=visitOverview(f.db,'2026-05-01','2026-05-31');
  const id=apply(f,rows,meta).import.id;finish(f,id);
  assert.throws(()=>apply(f,rows,meta),e=>e.status===409&&/sudah dilakukan/.test(e.message));
  assert.throws(()=>apply(f,rows,meta,0,id),e=>e.status===409,'migrasi aktif tidak bisa ditambah');
  assert.equal(visitOverview(f.db,'2026-05-01','2026-05-31').ringkasan.pengantaran,2);
  assert.throws(()=>f.route(f.users.leader,'history/cancel','POST',{import_id:id}),e=>e.status===403);
  const cancelled=f.route(f.users.manager,'history/cancel','POST',{import_id:id});assert.equal(cancelled.import.status,'dibatalkan');
  assert.equal(figures(visitOverview(f.db,'2026-05-01','2026-05-31')),figures(empty),'angka kembali seperti sebelum impor');
  assert.equal(one(f.db,"SELECT count(*) n FROM visit_daily_totals WHERE sumber='nilaiguide'").n,0);assert.equal(one(f.db,'SELECT count(*) n FROM visit_history_ids').n,0);
  assert.throws(()=>f.route(f.users.manager,'history/cancel','POST',{import_id:id}),e=>e.status===409);
  const again=apply(f,rows,meta).import.id;finish(f,again);
  assert.equal(visitOverview(f.db,'2026-05-01','2026-05-31').ringkasan.pengantaran,2,'setelah batal, migrasi bisa diulang');
  const status=f.route(f.users.manager,'history');assert.equal(status.current.id,again);assert.equal(status.cancelled.length,1);assert.equal(status.can_manage,true);
});

test('masa uji coba: bentrok 15 menit dengan penilaian portal dilewati, ID portal ditolak, ID kembar di berkas dilewati',t=>{
  const f=fixture(t);
  const link=f.route(f.users.manager,'links','POST',{action:'create',pos:1}).link;
  const portalAt=Date.now()-2*DAY,portalId=crypto.randomUUID();
  tx(f.db,()=>ingestGuideEvaluations(f.db,{id:link.id,pos:1},[{evaluationId:portalId,guideId:'G-001',guideName:'x',pos:1,timestamp:new Date(portalAt).toISOString(),criteria:{uniform:1,idCard:true,etika:1},catatan:''}],portalAt+60000));
  const twin=crypto.randomUUID();
  const rows=[
    row(new Date(portalAt+10*60000).toISOString()),                                  // HP lama, guide & pos sama, 10 menit kemudian
    row(new Date(portalAt+10*60000).toISOString(),{pos:3}),                          // pos lain: bukan bentrok
    row(new Date(portalAt+40*60000).toISOString()),                                  // 40 menit: pengantaran berikutnya
    row(new Date(portalAt).toISOString(),{id:portalId}),
    row(new Date(portalAt-DAY).toISOString(),{id:twin}),row(new Date(portalAt-DAY).toISOString(),{id:twin}),
  ];
  const p=preview(f,rows);
  assert.equal(p.counts.BENTROK,1);assert.equal(p.counts.ID_PORTAL,1);assert.equal(p.counts.DUPLIKAT,1);assert.equal(p.counts.MASUK,3);
  const id=apply(f,rows,file(rows.length)).import.id;finish(f,id);
  const day=witaDate(portalAt),o=visitOverview(f.db,day,day);
  assert.equal(o.ringkasan.pengantaran,3,'1 dari portal + 2 dari NilaiGuide pada hari itu');
});

test('rekap harian portal dan migrasi awal dijumlahkan; izin dan batas bagian dijaga',t=>{
  const f=fixture(t);
  run(f.db,"INSERT INTO visit_daily_totals(day,guide_id,pos,sumber,antar,uniform,uniform_patuh,id_card,review,etika,updated_at,n_id,n_kurang,n_tidak,n_teguran) VALUES('2026-06-01','G-001',1,'portal',2,3,2,1,0,2,?,1,0,0,1)",now());
  const id=apply(f,[row(wita('2026-06-02'),{uniform:-1,idCard:0,etika:-2}),row(wita('2026-06-02','10:00'),{uniform:1,idCard:1,etika:-1})],file(2)).import.id;finish(f,id);
  const g=visitOverview(f.db,'2026-06-01','2026-06-02').perGuide.find(x=>x.guideId==='G-001');
  // Portal: 1 tanpa ID + 1 teguran; NilaiGuide: tanpa ID + Uniform −1, lalu Etika −1 dengan seragam sesuai = 1 teguran.
  assert.deepEqual([g.antar,g.tanpaId,g.tidakBerseragam,g.teguran,g.potongan,g.hari],[4,2,1,2,100,2]);assert.equal(g.nilai,75);
  assert.throws(()=>preview(f,[row(wita('2026-06-02'))],file(1),0,f.users.leader),e=>e.status===403);
  assert.throws(()=>f.route(f.users.hr,'history'),e=>e.status===403);
  const many=Array.from({length:historyRules.barisPerBagian+1},()=>row(wita('2026-06-02')));
  assert.throws(()=>preview(f,many,file(many.length)),e=>e.status===413);
  assert.throws(()=>preview(f,[[1,2,3]],file(1)),e=>e.status===422&&/Bentuk baris/.test(e.message));
  assert.throws(()=>preview(f,[row(wita('2026-06-02'))],{...file(1),sha256:'x'}),e=>e.status===422);
  assert.throws(()=>preview(f,[row(wita('2026-06-02'))],file(1,1),1),e=>e.status===422&&/Nomor bagian/.test(e.message));
});

test('tanggal sebelum 2026, di masa depan, dan rentang laporan di luar migrasi tidak ikut',t=>{
  const f=fixture(t),tomorrow=new Date(Date.now()+2*DAY).toISOString();
  const p=preview(f,[row(tomorrow),row(wita(historyRules.mulai,'00:30')),row(wita('2025-12-31','23:59'))]);
  assert.equal(p.counts.TANGGAL,2);assert.equal(p.counts.MASUK,1);assert.equal(p.first,'2026-01-01');
  assert.equal(shiftDate(p.first,-1),'2025-12-31');
});
