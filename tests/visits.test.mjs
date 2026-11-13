import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {openDb,insert,one,all,run,tx,now} from '../lib/db.mjs';
import {seedPermissions,hashPasswordSync,grants} from '../lib/auth.mjs';
import {visitRoutes,isVisitSheetAction} from '../lib/visits.mjs';
import {takeGuideFormIpSlot,admitGuideForm,checkGuideItem,guideFormLimits} from '../lib/guide-form.mjs';
import {ingestGuideEvaluations,visitOverview,witaDate,shiftDate,monthLastDay,visitRules} from '../lib/visit-data.mjs';
import {scoringRules} from '../lib/visit-scoring.mjs';
import {runVisitSheetSync,checkVisitSheetConnection,visitSheetHeader} from '../lib/visit-sheets.mjs';
import {createFakeGoogle} from '../scripts/fake-google-sheets.mjs';
import {createApp} from '../server.mjs';

const password=hashPasswordSync('fixture123'),DAY=86400000;
const iso=minutes=>new Date(Date.now()+minutes*60000).toISOString();
const baseGuides=[['G-001','Guide Fiktif Satu','Asing','A1'],['G-002','Guide Fiktif Dua','Asing','A2',0],['G-003','Guide Fiktif Tiga','Domestik','D1'],['G-004','Guide Fiktif Empat','Domestik','D1, D2'],['G-005','Guide Fiktif Lima','Asing','A2']];
function fixture(t,{guides=baseGuides}={}){
  const db=openDb(':memory:');t.after(()=>db.close());seedPermissions(db);
  const account=(username,role)=>{const u=insert(db,'users',{username,password_hash:password,status:'ACTIVE',must_change_password:0,failed_login_count:0,password_changed_at:now()});if(role)insert(db,'user_roles',{user_id:u.id,role_id:one(db,'SELECT id FROM roles WHERE code=?',role).id,scope_kind:'ALL'});return u;};
  // IT-admin produksi: hanya izin administratif, tanpa role kunjungan.
  const itRole=insert(db,'roles',{code:'IT_ADMIN_FIXTURE',name:'IT admin',is_system:0,is_active:1});
  for(const p of all(db,"SELECT id FROM permissions WHERE module_code='admin'"))run(db,'INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)',itRole.id,p.id);
  const users={manager:account('kunjungan','KUNJUNGAN_PENGELOLA'),leader:account('pimpinan','KUNJUNGAN_PIMPINAN'),admin:account('superadmin','SUPER_ADMIN'),it:account('itadmin','IT_ADMIN_FIXTURE'),hr:account('sdm','SDM')};
  for(const [id,name,kategori,regu,active=1] of guides)insert(db,'visit_guides',{id,seq:Number(id.slice(2)),name,kategori,regu,is_active:active});
  const route=(user,path,method='GET',body={},query='')=>visitRoutes({db,user,p:['visits',...path.split('/').filter(Boolean)],method,body,url:new URL('https://portal.test/?'+query)});
  const link=pos=>{const r=route(users.manager,'links','POST',{action:'create',pos});return {...r,admitted:{id:r.link.id,pos}};};
  const ingest=(l,items,nowMs=Date.now())=>tx(db,()=>ingestGuideEvaluations(db,l.admitted,items.map(clean),nowMs));
  const runTx=work=>tx(db,()=>work(db));
  return {db,users,route,link,ingest,runTx};
}
// Bentuk setelah checkGuideItem (guide-form.mjs) — dipakai langsung oleh ingest.
const clean=i=>{
  const c=i.criteria,criteria=c.seragam!==undefined?{idCard:c.idCard,seragam:c.seragam,teguran:c.teguran||[],berat:c.berat||null,apresiasi:c.apresiasi||null}:{idCard:c.idCard,uniform:c.uniform,etika:c.etika??0};
  return {evaluationId:i.evaluationId,guideId:i.guideId,guideName:i.guideName,pos:i.pos,timestamp:i.timestamp,criteria,catatan:i.catatan||'',...(i.koreksiDari?{koreksiDari:i.koreksiDari}:{}),...(i.petugasId?{petugasId:i.petugasId}:{})};
};
// Isian cara baru ("100 − potongan").
const fakta=(extra={})=>({idCard:true,seragam:'lengkap',teguran:[],berat:null,apresiasi:null,...extra});
const evaluation=(pos=1,extra={})=>({evaluationId:crypto.randomUUID(),guideId:'G-001',guideName:'Nama dari HP',pos,timestamp:iso(-30),criteria:{uniform:2,idCard:true,etika:1},catatan:'',...extra});
const at=(ms,extra={})=>evaluation(extra.pos||1,{timestamp:new Date(ms).toISOString(),...extra});
const sync=(f,google,options={})=>runVisitSheetSync({runTx:f.runTx,env:google.env,fetchImpl:google.fetch,trigger:'manual',...options});
const sheetIds=(google,title)=>google.rows(title).filter(r=>r.length).map(r=>r[0]);

test('role templates grant visits permissions while IT admin and other modules receive none',t=>{
  const f=fixture(t),codes=user=>new Set(grants(f.db,user).map(g=>g.code));
  assert.equal(codes(f.users.manager).size,9);assert(codes(f.users.manager).has('visits.forms.manage'));
  assert(codes(f.users.leader).has('visits.reports.export'));assert(!codes(f.users.leader).has('visits.guides.manage'));assert(!codes(f.users.leader).has('visits.forms.read'));
  assert(codes(f.users.admin).has('visits.settings.manage'));
  for(const user of [f.users.it,f.users.hr])assert(![...codes(user)].some(c=>c.startsWith('visits.')));
  run(f.db,"DELETE FROM role_permissions WHERE role_id=(SELECT id FROM roles WHERE code='SUPER_ADMIN') AND permission_id IN (SELECT id FROM permissions WHERE module_code='visits')");
  run(f.db,'DELETE FROM schema_migrations WHERE version=8');seedPermissions(f.db);
  assert.equal([...codes(f.users.admin)].filter(c=>c.startsWith('visits.')).length,9);
});

test('pos links: one active per pos, private copy on demand, rotate and revoke audited without tokens',t=>{
  const f=fixture(t),m=f.users.manager;
  const created=f.route(m,'links','POST',{action:'create',pos:1});assert.match(created.token,/^[a-f0-9]{64}$/);assert.equal(created.link.pos,1);
  assert.throws(()=>f.route(m,'links','POST',{action:'create',pos:1}),e=>e.status===409);
  assert.throws(()=>f.route(m,'links','POST',{action:'create',pos:2}),e=>e.status===422);
  const view=f.route(m,'links');assert.equal(view.items.length,2);assert.equal(view.items[0].link.id,created.link.id);assert.equal(view.items[1].link,null);
  assert(!JSON.stringify(view).includes(created.token));
  const copy=f.route(m,'links','POST',{action:'copy',pos:1,id:created.link.id,row_version:created.link.row_version});assert.equal(copy.token,created.token);
  assert.throws(()=>f.route(m,'links','POST',{action:'rotate',pos:1,id:created.link.id,row_version:99}),e=>e.status===409);
  const rotated=f.route(m,'links','POST',{action:'rotate',pos:1,id:created.link.id,row_version:created.link.row_version});assert.notEqual(rotated.token,created.token);
  const old=one(f.db,'SELECT * FROM guide_form_links WHERE id=?',created.link.id);assert.equal(old.is_active,0);assert.equal(old.share_token,null);assert(old.revoked_at);
  assert.throws(()=>admitGuideForm(f.db,'context',{token:created.token}),e=>e.status===404);
  assert.equal(admitGuideForm(f.db,'context',{token:rotated.token}).link.pos,1);
  f.route(m,'links','POST',{action:'revoke',pos:1,id:rotated.link.id,row_version:rotated.link.row_version});
  assert.throws(()=>admitGuideForm(f.db,'context',{token:rotated.token}),e=>e.status===404);
  assert.deepEqual(all(f.db,"SELECT action FROM audit_events WHERE object_type='guide_form_links'").map(a=>a.action),['CREATE','COPY_LINK','ROTATE','REVOKE']);
  assert(!JSON.stringify(all(f.db,'SELECT * FROM audit_events')).match(/[a-f0-9]{64}/));
  for(const user of [f.users.leader,f.users.it,f.users.hr])assert.throws(()=>f.route(user,'links','POST',{action:'create',pos:3}),e=>e.status===403);
  assert.throws(()=>f.route(f.users.leader,'links'),e=>e.status===403);
});

test('guide form admission checks token, pos, shape and both rate limits',t=>{
  const f=fixture(t),link=f.route(f.users.manager,'links','POST',{action:'create',pos:3});
  for(const token of [undefined,'','z'.repeat(64),'b'.repeat(64)])assert.throws(()=>admitGuideForm(f.db,'context',{token}),e=>e.status===404);
  const good=evaluation(3),wrongPos=evaluation(1),bad=evaluation(3,{evaluationId:'bukan-uuid'}),legacy=evaluation(3,{criteria:{uniform:0,idCard:true}});
  const admitted=admitGuideForm(f.db,'submit',{token:link.token,evaluations:[good,wrongPos,bad,legacy,good]});
  assert.equal(admitted.items.length,1);assert.equal(admitted.items[0].evaluationId,good.evaluationId);
  assert.equal(admitted.rejected.length,4);assert.match(admitted.rejected[0].errors.join(),/pos tautan \(Pos 3\)/);assert.match(admitted.rejected[3].errors.join(),/ganda/);
  assert.throws(()=>admitGuideForm(f.db,'submit',{token:link.token,evaluations:Array.from({length:21},()=>evaluation(3))}),e=>e.status===413);
  assert.deepEqual(checkGuideItem({...good,catatan:'x'.repeat(501)},3),['catatan maksimal 500 huruf']);
  let last;for(let i=0;i<guideFormLimits.context;i++)last=tx(f.db,()=>admitGuideForm(f.db,'context',{token:link.token}));
  assert(last.link);assert.equal(tx(f.db,()=>admitGuideForm(f.db,'context',{token:link.token})).limited,true);
  for(let i=0;i<guideFormLimits.context;i++)assert(tx(f.db,()=>takeGuideFormIpSlot(f.db,'context','203.0.113.9',{})));
  assert.equal(tx(f.db,()=>takeGuideFormIpSlot(f.db,'context','203.0.113.9',{})),false);
  assert(tx(f.db,()=>takeGuideFormIpSlot(f.db,'context','203.0.113.10',{})));
  for(let i=0;i<15;i++)assert(tx(f.db,()=>takeGuideFormIpSlot(f.db,'submit','198.51.100.1',{evaluations:Array(20).fill({})})));
  assert.equal(tx(f.db,()=>takeGuideFormIpSlot(f.db,'submit','198.51.100.1',{evaluations:[{}]})),false);
  assert.throws(()=>takeGuideFormIpSlot(f.db,'context','bukan ip!',{}),e=>e.status===400);
});

test('ingest keeps the NilaiGuide rules: duplicates, 15-minute gap across devices, same-day corrections, guide registry, age limit',t=>{
  const f=fixture(t),pos1=f.link(1),pos3=f.link(3),t0=Date.now()-3*3600000;
  const a=at(t0,{catatan:'=IMPORTDATA("x")'});
  let r=f.ingest(pos1,[a,a]);assert.deepEqual(r.accepted.map(x=>x.duplicate),[false,true]);
  const saved=one(f.db,'SELECT * FROM visit_evaluations WHERE id=?',a.evaluationId);
  assert.equal(saved.guide_name,'Guide Fiktif Satu','nama dari Data Guide, bukan dari HP');assert.equal(saved.catatan,'=IMPORTDATA("x")');assert.equal(saved.wita_date,witaDate(t0));
  // Jeda < 15 menit ditolak, termasuk dari kiriman HP lain dan di dalam satu kiriman.
  r=f.ingest(pos1,[at(t0+10*60000)]);assert.equal(r.rejected[0].reason,'JEDA');assert.equal(r.rejected[0].terlaluCepat,true);assert.equal(r.rejected[0].aktifSaatIni,a.evaluationId);
  r=f.ingest(pos1,[at(t0-14*60000)]);assert.equal(r.rejected[0].reason,'JEDA','selisih mutlak: entri offline yang lebih awal juga tertangkap');
  assert.equal(f.ingest(pos1,[at(t0+16*60000)]).accepted.length,1);
  assert.equal(f.ingest(pos3,[at(t0+5*60000,{pos:3})]).accepted.length,1,'pos lain boleh');
  const x=at(t0,{guideId:'G-003'}),y=at(t0+5*60000,{guideId:'G-003'});r=f.ingest(pos1,[x,y]);
  assert.deepEqual([r.accepted.length,r.rejected[0]?.reason],[1,'JEDA']);
  assert.equal(f.ingest(pos1,[at(t0,{guideId:'G-002'})]).accepted.length,1,'guide nonaktif tetap diterima');
  assert.equal(f.ingest(pos1,[at(t0,{guideId:'G-999'})]).rejected[0].reason,'GUIDE');
  // Koreksi: hanya guide, pos, dan tanggal yang sama; baris lama ditandai, tidak dihapus.
  const fix=at(t0,{koreksiDari:a.evaluationId,criteria:{uniform:-1,idCard:false,etika:-2}});
  assert.equal(f.ingest(pos1,[fix]).accepted.length,1);
  assert.deepEqual({...one(f.db,'SELECT status,replaced_by FROM visit_evaluations WHERE id=?',a.evaluationId)},{status:'diganti',replaced_by:fix.evaluationId});
  for(const bad of [at(t0,{koreksiDari:a.evaluationId}),at(t0,{koreksiDari:x.evaluationId,guideId:'G-001'}),at(t0,{koreksiDari:crypto.randomUUID()}),at(t0-2*DAY,{koreksiDari:fix.evaluationId}),at(t0,{pos:3,koreksiDari:fix.evaluationId})])
    assert.equal(f.ingest(bad.pos===3?pos3:pos1,[bad]).rejected[0]?.reason,'KOREKSI');
  // Umur maksimal: kiriman ulang yang sudah tersimpan tetap diakui; yang baru dan tua ditolak.
  const kept=at(Date.now()-35*DAY,{guideId:'G-005'});assert.equal(f.ingest(pos1,[kept],Date.now()-34*DAY).accepted.length,1);
  assert.equal(f.ingest(pos1,[kept]).accepted[0].duplicate,true);
  r=f.ingest(pos1,[at(Date.now()-(visitRules.umurMaksHari+1)*DAY,{guideId:'G-005'})]);assert.equal(r.rejected[0].reason,'WAKTU');assert.match(r.rejected[0].errors[0],/lebih dari 30 hari/);
  // Jam HP yang terlalu cepat tidak memindahkan penilaian ke masa depan.
  const ahead=at(Date.now()+5*3600000,{guideId:'G-004'}),before=Date.now();f.ingest(pos1,[ahead]);
  const stored=one(f.db,'SELECT evaluated_at FROM visit_evaluations WHERE id=?',ahead.evaluationId);assert(Date.parse(stored.evaluated_at)<=Date.now()&&Date.parse(stored.evaluated_at)>=before-1000);
});

test('guide registry: import from the old Guides tab, previews, errors, twins, and versioned edits',t=>{
  const f=fixture(t,{guides:[]}),m=f.users.manager;
  const rows=[{line:2,guideId:'G-001',guideName:' Guide  Fiktif Satu ',kategori:'Asing',regu:'A1',aktif:true},{line:3,guideId:'G-297',guideName:'Guide Fiktif Dua',kategori:'asing',regu:'a2',aktif:'FALSE'},
    {line:4,guideId:'g-010',guideName:'Guide Fiktif Tiga',kategori:'Domestik',regu:'D1, D2',aktif:''},{line:5,guideName:'Guide Tanpa ID',kategori:'Domestik',regu:'D1',aktif:'Ya'}];
  const preview=f.route(m,'guides/import','POST',{rows});assert.deepEqual([preview.applied,preview.create,preview.error_count],[false,4,0]);
  assert.equal(one(f.db,'SELECT count(*) n FROM visit_guides').n,0,'pratinjau tidak menyimpan');
  assert.equal(f.route(m,'guides/import','POST',{rows,apply:true}).applied,true);
  const list=f.route(f.users.leader,'guides').items;
  assert.deepEqual(list.map(g=>[g.guideId,g.guideName,g.kategori,g.regu,g.aktif]),[['G-001','Guide Fiktif Satu','Asing','A1',true],['G-010','Guide Fiktif Tiga','Domestik','D1, D2',true],['G-297','Guide Fiktif Dua','Asing','A2',false],['G-298','Guide Tanpa ID','Domestik','D1',true]]);
  const again=f.route(m,'guides/import','POST',{rows:[{guideId:'G-001',guideName:'Guide Fiktif Satu (2)',kategori:'Asing',regu:'A1',aktif:true},{guideId:'G-297',guideName:'Guide Fiktif Dua',kategori:'Asing',regu:'A2',aktif:false}],apply:true});
  assert.deepEqual([again.update,again.unchanged,again.create],[1,1,0]);
  const broken=[{line:2,guideId:'G-1',guideName:'Bentrok',kategori:'Asing',regu:'A1'},{line:3,guideId:'G-500',guideName:'Ganda',kategori:'Asing',regu:'A1'},{line:4,guideId:'G-500',guideName:'Ganda lagi',kategori:'Asing',regu:'A1'},{line:5,guideName:'',kategori:'Lokal',regu:'Z9',aktif:'mungkin'}];
  const checked=f.route(m,'guides/import','POST',{rows:broken});assert.equal(checked.error_count,3);assert.deepEqual(checked.errors.map(e=>e.line),[2,4,5]);
  assert.match(checked.errors[0].message,/bentrok dengan G-001/);
  assert.throws(()=>f.route(m,'guides/import','POST',{rows:broken,apply:true}),e=>e.status===422);
  assert.equal(one(f.db,"SELECT count(*) n FROM visit_guides WHERE id='G-500'").n,0,'impor gagal tidak menyimpan sebagian');
  const twin=f.route(m,'guides/import','POST',{rows:[{guideName:'Guide Fiktif Tiga',kategori:'Domestik',regu:'D2'}]});assert.equal(twin.warning_count,1);
  // Form satuan: ID otomatis berikutnya, kembar seregu ditolak, versi data wajib.
  const created=f.route(m,'guides','POST',{guideName:'Guide Baru',kategori:'Asing',regu:'A2',aktif:true});assert.equal(created.guideId,'G-299');assert.equal(created.created,true);
  assert.throws(()=>f.route(m,'guides','POST',{guideName:'guide fiktif tiga',kategori:'Domestik',regu:'D1',aktif:true}),e=>e.status===409);
  assert.equal(f.route(m,'guides','POST',{guideName:'Guide Fiktif Tiga',kategori:'Asing',regu:'A1',aktif:true}).created,true,'kembar beda regu boleh');
  const edited=f.route(m,'guides','POST',{guideId:'G-299',row_version:created.row_version,guideName:'Guide Baru',kategori:'Asing',regu:'A1',aktif:false});assert.equal(edited.aktif,false);
  assert.throws(()=>f.route(m,'guides','POST',{guideId:'G-299',row_version:created.row_version,guideName:'Guide Baru',kategori:'Asing',regu:'A1',aktif:true}),e=>e.status===409);
  assert.throws(()=>f.route(f.users.leader,'guides','POST',{guideName:'X',kategori:'Asing',regu:'A1',aktif:true}),e=>e.status===403);
  assert.throws(()=>f.route(f.users.it,'guides'),e=>e.status===403);
  assert.deepEqual(all(f.db,"SELECT action FROM audit_events WHERE object_type='visit_guides' ORDER BY occurred_at,rowid").map(a=>a.action),['IMPORT','IMPORT','CREATE','CREATE','UPDATE']);
});

test('overview: penilaian cara lama dipetakan ke 100 − potongan; daftar penilaian berhalaman',t=>{
  const f=fixture(t),pos1=f.link(1),pos3=f.link(3);
  const day=witaDate(Date.now()-2*DAY),base=Date.parse(`${day}T09:00:00+08:00`),slot=i=>base+i*20*60000;
  const series=(link,guideId,values)=>f.ingest(link,values.map(([uniform,idCard,etika],i)=>at(slot(i),{guideId,pos:link.admitted.pos,criteria:{uniform,idCard:Boolean(idCard),etika}})));
  // G-001: satu tanpa ID, satu Uniform −1 (Etika −1 di baris itu = hukuman ganda, tidak dihitung).
  series(pos1,'G-001',[[2,1,1],[1,1,0],[1,0,2],[-1,1,-1],[2,1,0],[1,1,1]]);
  series(pos3,'G-003',[[1,1,0],[1,1,-2],[1,1,0],[1,1,0],[1,1,0]]);   // Etika minus dengan seragam sesuai = 1 teguran
  series(pos1,'G-004',[[-1,0,-2],[-1,0,-1]]);
  series(pos3,'G-002',[[2,1,5]]);
  const o=f.route(f.users.leader,'overview','GET',{},`from=${shiftDate(day,-3)}&to=${witaDate(Date.now())}`);
  const potongan=(1+2)*20+(1+2)*20+1*20;
  assert.deepEqual(o.ringkasan,{pengantaran:14,nilai:100-potongan/14,persenId:1-3/14,persenSeragam:1-3/14,tanpaId:3,kurangLengkap:0,tidakBerseragam:3,teguran:1,potongan,
    guideDinilai:4,hariDinilai:1,guideAktif:4,berat:{disetujui:0,menunggu:0},apresiasi:{disetujui:0,menunggu:0},layak:null});
  assert.deepEqual(o.perPos.map(p=>[p.pos,p.pengantaran,p.nilai,p.guideDinilai]),[[1,8,100-120/8,2],[3,6,100-20/6,2]]);
  assert.deepEqual(o.perRegu.map(r=>[r.regu,r.pengantaran]),[['A1',6],['A2',1],['D1',7],['D2',2]]);
  // Minimal pengantaran mengikuti aturan bulan (bawaan 10): semua masih "belum cukup".
  assert.deepEqual([o.minimalPengantaran,o.diperingkat,o.belumCukup],[10,0,3]);
  const ids=list=>list.map(x=>x.guideId);
  assert.deepEqual(ids(o.peringkat.belumCukup),['G-001','G-003','G-004']);assert.deepEqual(ids(o.perGuide),['G-003','G-001','G-004'],'guide nonaktif tidak diperingkat');
  const g1=o.perGuide.find(g=>g.guideId==='G-001');assert.deepEqual([g1.antar,g1.hari,g1.tanpaId,g1.tidakBerseragam,g1.teguran,g1.potongan],[6,1,1,1,0,40]);
  assert.equal(g1.status,undefined,'status reward hanya untuk satu bulan kalender');
  assert.equal(o.peringkat.review,undefined,'REVIEW belum dipakai');
  assert.throws(()=>f.route(f.users.it,'overview'),e=>e.status===403);
  // Daftar penilaian: terbaru dulu, berhalaman, bisa disaring, dan memuat nilai pengantaran.
  const q=extra=>f.route(f.users.leader,'records','GET',{},`from=${day}&to=${day}&${extra}`);
  let page=q('limit=5');assert.deepEqual([page.items.length,page.total,page.more],[5,14,true]);assert(page.items[0].timestamp>=page.items[1].timestamp);
  assert.equal(q('limit=5&offset=10').items.length,4);
  assert.equal(q('pos=3').total,6);assert.equal(q('regu=D2').total,2);assert.equal(q('guide=G-001').total,6);assert.equal(q('status=diganti').total,0);
  assert.deepEqual(Object.keys(page.items[0]).sort(),['apresiasi','berat','catatan','digantiOleh','etika','evaluationId','guideId','guideName','idCard','koreksiDari','nilai','petugas','pos','receivedAt','regu','review','seragam','status','tanggal','teguran','teguranN','timestamp','uniform','versi']);
  assert.deepEqual(q('guide=G-004').items.map(r=>[r.versi,r.seragam,r.nilai]),[[1,'tidak',60],[1,'tidak',60]]);
  assert.deepEqual(q('guide=G-003').items.map(r=>r.nilai).sort((a,b)=>a-b),[80,100,100,100,100]);
  assert.throws(()=>q('pos=2'),e=>e.status===422);assert.throws(()=>f.route(f.users.hr,'records'),e=>e.status===403);
});

test('nilai 100 − potongan: contoh usulan 97,5, layak reward, pelanggaran berat, dan apresiasi sebagai penentu',t=>{
  const f=fixture(t,{guides:[...baseGuides,['G-006','Guide Fiktif Enam','Domestik','D2']]}),pos1=f.link(1),pos3=f.link(3);
  const petugas=f.route(f.users.manager,'scoring/assessors','POST',{nama:'Petugas Pos Satu',keterangan:'Pos 1',aktif:true});
  // Bulan lalu, supaya bulan itu utuh; kiriman diterima tepat setelah dibuat.
  const today=new Date(Date.now()+8*3600000),month=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()-1,1)).toISOString().slice(0,7);
  const base=Date.parse(`${month}-10T07:00:00+08:00`);
  const send=(link,guideId,list,offset=0)=>list.forEach((criteria,i)=>{const ms=base+(offset+i)*20*60000;
    const r=f.ingest(link,[at(ms,{guideId,pos:link.admitted.pos,criteria,petugasId:link.admitted.pos===1?petugas.id:undefined,catatan:criteria.berat||criteria.apresiasi?'Disaksikan petugas pos.':''})],ms+60000);
    assert.equal(r.accepted.length,1,JSON.stringify(r.rejected));});
  // Contoh di usulan: 20 pengantaran, 2 kali tanpa ID, 1 kali kurang lengkap → 100 − (40 + 10) ÷ 20 = 97,5.
  send(pos1,'G-001',Array.from({length:20},(_,i)=>fakta({idCard:i>1,seragam:i===2?'kurang':'lengkap'})));
  // 12 pengantaran, satu dengan 1 teguran dan satu dengan 2 teguran → 100 − 60 ÷ 12 = 95 (tepat ambang).
  send(pos3,'G-003',Array.from({length:12},(_,i)=>fakta({teguran:i===0?['merokok-hp']:i===1?['tamu-tanpa-kain','antrean']:[]})));
  send(pos1,'G-004',Array.from({length:10},(_,i)=>fakta({berat:i===4?'pungutan':null})),100);
  send(pos3,'G-005',Array.from({length:10},(_,i)=>fakta({apresiasi:i===3?'dipuji':null})),100);
  send(pos1,'G-006',Array.from({length:10},()=>fakta()),200);
  const saved=one(f.db,"SELECT * FROM visit_evaluations WHERE guide_id='G-003' AND teguran_n=2");
  assert.deepEqual([saved.versi,saved.seragam,saved.uniform,saved.etika,saved.teguran],[2,'lengkap',1,-2,'tamu-tanpa-kain,antrean'],'kolom lama diisi padanannya');
  assert.equal(one(f.db,"SELECT petugas_nama FROM visit_evaluations WHERE guide_id='G-001' LIMIT 1").petugas_nama,'Petugas Pos Satu');
  const overview=()=>f.route(f.users.leader,'overview','GET',{},`from=${month}-01&to=${monthLastDay(month)}`);
  let o=overview(),g=id=>o.perGuide.find(x=>x.guideId===id);
  assert.equal(g('G-001').nilai,97.5);assert.equal(g('G-003').nilai,95);
  assert.deepEqual(['G-001','G-003','G-004','G-005','G-006'].map(id=>g(id).status),['layak','layak','layak','layak','layak']);
  assert.match(g('G-004').alasan,/belum diputuskan/,'laporan berat yang menunggu tidak menggugurkan, tetapi ditandai');
  assert.deepEqual(o.ringkasan.berat,{disetujui:0,menunggu:1});assert.equal(o.ringkasan.layak,5);
  // Pengelola memutuskan: berat disetujui → gugur; apresiasi disetujui → penentu bila nilai sama.
  const flags=f.route(f.users.manager,'flags','GET',{},`from=${month}-01&to=${monthLastDay(month)}&status=menunggu`);
  assert.deepEqual(flags.items.map(x=>[x.jenis,x.guideId,x.kode,x.petugas]).sort(),[['apresiasi','G-005','dipuji',''],['berat','G-004','pungutan','Petugas Pos Satu']]);
  for(const item of flags.items)f.route(f.users.manager,'flags/decide','POST',{id:item.id,row_version:item.row_version,action:'setujui'});
  o=overview();
  assert.deepEqual([g('G-004').status,g('G-004').alasan],['gugur','Pelanggaran berat terverifikasi']);assert.equal(o.ringkasan.layak,4);
  assert.deepEqual(o.peringkat.nilaiTertinggi.map(x=>[x.guideId,x.peringkat]),[['G-005',1],['G-004',2],['G-006',2],['G-001',4],['G-003',5]],'nilai sama: apresiasi penentu, lalu setara');
  assert.deepEqual(o.peringkat.beratTerverifikasi.map(x=>x.guideId),['G-004']);
  assert.deepEqual(o.peringkat.tanpaIdTerbanyak.map(x=>x.guideId),['G-001']);assert.deepEqual(o.peringkat.teguranTerbanyak.map(x=>x.guideId),['G-003']);
  assert.deepEqual(o.perPetugas.map(p=>[p.petugas,p.pengantaran]),[[null,22],['Petugas Pos Satu',40]].sort((a,b)=>b[1]-a[1]));
  // Ambang dan bobot mengikuti aturan BULAN itu: aturan baru untuk bulan sesudahnya tidak mengubahnya.
  run(f.db,"INSERT INTO visit_score_rules(berlaku_mulai,pot_id,pot_kurang,pot_tidak,pot_teguran,ambang,minimal,created_at) VALUES(?,10,10,20,20,98,10,?)",month,now());
  o=overview();assert.equal(g('G-001').nilai,98.5);assert.equal(g('G-001').status,'layak');assert.deepEqual([g('G-003').status,g('G-003').alasan],['bawah','Nilai di bawah ambang 98']);
  assert.equal(o.aturan.ambang,98);
});

test('isian cara baru diperiksa: jenis temuan, catatan wajib, petugas terdaftar, dan koreksi membatalkan laporan yang menunggu',t=>{
  const f=fixture(t),link=f.route(f.users.manager,'links','POST',{action:'create',pos:1}),pos1=f.link(3),t0=Date.now()-3*3600000;
  const item=(criteria,extra={})=>evaluation(1,{criteria,timestamp:new Date(t0).toISOString(),...extra});
  // Bentuk: seragam, paling banyak 2 teguran berbeda, kode valid, petugasId UUID.
  assert.deepEqual(checkGuideItem(item(fakta({seragam:'bagus'})),1),['criteria.seragam harus lengkap, kurang, atau tidak']);
  assert.match(checkGuideItem(item(fakta({teguran:['antrean','merokok-hp','meninggalkan-tamu']})),1).join(),/paling banyak 2/);
  assert.match(checkGuideItem(item(fakta({teguran:['antrean','antrean']})),1).join(),/berbeda/);
  assert.deepEqual(checkGuideItem(item(fakta({berat:'Bukan Kode!'})),1),['criteria.berat tidak valid']);
  assert.deepEqual(checkGuideItem(item(fakta(),{petugasId:'x'}),1),['petugasId tidak valid']);
  assert.deepEqual(checkGuideItem(item(fakta()),1),[]);assert.deepEqual(checkGuideItem(item({uniform:1,idCard:true,etika:0}),1),[],'cara lama tetap diterima');
  const admitted=admitGuideForm(f.db,'submit',{token:link.token,evaluations:[item(fakta({teguran:['antrean']}),{petugasId:crypto.randomUUID().toUpperCase()})]});
  assert.deepEqual(admitted.items[0].criteria,{idCard:true,seragam:'lengkap',teguran:['antrean'],berat:null,apresiasi:null});assert(admitted.items[0].petugasId);
  // Aturan terima: jenis harus dikenal portal dan sesuai golongannya; catatan wajib.
  const p1={admitted:{id:link.link.id,pos:1}};
  const rejected=(criteria,extra={})=>f.ingest(p1,[at(t0,{criteria,...extra})]).rejected[0];
  assert.match(rejected(fakta({teguran:['tidak-ada']})).errors[0],/Jenis teguran "tidak-ada" tidak dikenal/);
  assert.match(rejected(fakta({teguran:['pungutan']})).errors[0],/tidak dikenal/,'kode pelanggaran berat bukan teguran');
  assert.match(rejected(fakta({berat:'pungutan'})).errors[0],/Catatan wajib/);
  assert.match(rejected(fakta({teguran:['teguran-lain']})).errors[0],/Catatan wajib/);
  assert.match(rejected(fakta(),{petugasId:crypto.randomUUID()}).errors[0],/Petugas penilai tidak terdaftar/);
  assert.equal(rejected(fakta({berat:'pungutan'})).reason,'VALIDASI');
  // Jenis yang kini nonaktif tetap diterima: penilaiannya mungkin dibuat sebelum dinonaktifkan.
  const type=f.route(f.users.manager,'scoring','GET').jenis.find(x=>x.kode==='antrean');
  f.route(f.users.manager,'scoring/types','POST',{kode:'antrean',label:type.label,aktif:false,row_version:type.row_version});
  const a=at(t0,{criteria:fakta({teguran:['antrean'],berat:'pungutan'}),catatan:'Meminta uang parkir ke tamu.'});
  assert.equal(f.ingest(p1,[a]).accepted.length,1);
  let flag=one(f.db,'SELECT * FROM visit_flags WHERE evaluation_id=?',a.evaluationId);assert.deepEqual([flag.jenis,flag.kode,flag.status,flag.catatan],['berat','pungutan','menunggu','Meminta uang parkir ke tamu.']);
  // Koreksi penilaian itu: laporan yang belum diputuskan ikut batal dan tidak bisa diputuskan lagi.
  const fix=at(t0,{koreksiDari:a.evaluationId,criteria:fakta({teguran:['antrean']})});assert.equal(f.ingest(p1,[fix]).accepted.length,1);
  flag=one(f.db,'SELECT * FROM visit_flags WHERE evaluation_id=?',a.evaluationId);assert.equal(flag.status,'dibatalkan');
  assert.throws(()=>f.route(f.users.manager,'flags/decide','POST',{id:flag.id,row_version:flag.row_version,action:'setujui'}),e=>e.status===409&&/dikoreksi/.test(e.message));
  assert.equal(pos1.admitted.pos,3);
});

test('aturan nilai: hanya untuk bulan depan, dijaga ≤ 100, diaudit; jenis temuan, petugas, petunjuk, dan verifikasi hanya Pengelola',t=>{
  const f=fixture(t),m=f.users.manager,leader=f.users.leader;
  const state=f.route(leader,'scoring','GET');
  assert.equal(state.can_manage,false);assert.deepEqual(state.petugas,[],'daftar petugas hanya untuk Pengelola');
  assert.deepEqual(state.aturan.berlaku,{berlaku_mulai:'2026-01',pot_id:20,pot_kurang:10,pot_tidak:20,pot_teguran:20,ambang:95,minimal:10,created_at:state.aturan.berlaku.created_at});
  assert.equal(state.jenis.filter(x=>x.jenis==='teguran').length,5);assert(state.jenis.filter(x=>x.jenis!=='teguran').every(x=>x.perlu_catatan));
  const rule={pot_id:25,pot_kurang:10,pot_tidak:25,pot_teguran:20,ambang:96,minimal:12};
  assert.throws(()=>f.route(m,'scoring/rule','POST',{...rule,berlaku_mulai:state.aturan.bulan_ini}),e=>e.status===409&&/bulan depan/.test(e.message));
  assert.throws(()=>f.route(m,'scoring/rule','POST',{...rule,berlaku_mulai:state.aturan.bulan_depan,pot_teguran:26}),e=>e.status===422&&/lebih dari 100/.test(e.message));
  assert.throws(()=>f.route(m,'scoring/rule','POST',{...rule,berlaku_mulai:state.aturan.bulan_depan,pot_kurang:30,pot_tidak:20}),e=>e.status===422);
  assert.throws(()=>f.route(m,'scoring/rule','POST',{...rule,berlaku_mulai:state.aturan.bulan_depan,minimal:''}),e=>e.status===422);
  assert.throws(()=>f.route(leader,'scoring/rule','POST',{...rule,berlaku_mulai:state.aturan.bulan_depan}),e=>e.status===403);
  const saved=f.route(m,'scoring/rule','POST',{...rule,berlaku_mulai:state.aturan.bulan_depan});assert.equal(saved.pot_id,25);
  let after=f.route(m,'scoring','GET');assert.equal(after.aturan.berlaku.pot_id,20,'bulan berjalan tidak berubah');assert.equal(after.aturan.bulan_depan_aturan.pot_id,25);
  assert.deepEqual(after.aturan.rencana.map(r=>r.berlaku_mulai),[state.aturan.bulan_depan]);
  assert.throws(()=>f.route(m,'scoring/rule-delete','POST',{berlaku_mulai:'2026-01'}),e=>e.status===409);
  f.route(m,'scoring/rule-delete','POST',{berlaku_mulai:state.aturan.bulan_depan});
  assert.equal(f.route(m,'scoring','GET').aturan.rencana.length,0);
  // Jenis temuan: kode dibentuk dari nama, tidak dipakai ulang, tidak bisa dihapus (hanya nonaktif).
  const created=f.route(m,'scoring/types','POST',{jenis:'teguran',label:'Tidak memakai alas kaki sesuai aturan',aktif:true});assert.equal(created.kode,'tidak-memakai-alas-kaki-sesuai-atura','kode paling panjang 36 huruf, sisa ruang untuk akhiran -2');assert.equal(created.perlu_catatan,false);
  assert.throws(()=>f.route(m,'scoring/types','POST',{jenis:'teguran',label:'tidak memakai alas kaki sesuai aturan',aktif:true}),e=>e.status===409);
  const berat=f.route(m,'scoring/types','POST',{jenis:'berat',label:'Menjual barang di area suci',aktif:true,perlu_catatan:false});assert.equal(berat.perlu_catatan,true,'pelanggaran berat selalu wajib catatan');
  const off=f.route(m,'scoring/types','POST',{kode:created.kode,label:created.label,aktif:false,row_version:created.row_version});assert.equal(off.aktif,false);
  assert.throws(()=>f.route(m,'scoring/types','POST',{kode:created.kode,label:'X lain',aktif:true,row_version:created.row_version}),e=>e.status===409);
  // Petugas: nama aktif tidak boleh kembar; petunjuk formulir wajib diisi.
  const p=f.route(m,'scoring/assessors','POST',{nama:'Made Petugas',keterangan:'Pos 3',aktif:true});
  assert.throws(()=>f.route(m,'scoring/assessors','POST',{nama:'made petugas',aktif:true}),e=>e.status===409);
  assert.equal(f.route(m,'scoring','GET').petugas[0].nama,'Made Petugas');
  const form=f.route(m,'scoring','GET').petunjuk;
  assert.throws(()=>f.route(m,'scoring/form','POST',{petunjuk_id:'',petunjuk_seragam:'x',row_version:form.row_version}),e=>e.status===422);
  const changed=f.route(m,'scoring/form','POST',{petunjuk_id:'Kartu ID resmi terlihat di dada.',petunjuk_seragam:'Kemeja, udeng, kamen.',row_version:form.row_version});assert.equal(changed.petunjuk_seragam,'Kemeja, udeng, kamen.');
  for(const [path,body] of [['scoring/types',{jenis:'teguran',label:'X',aktif:true}],['scoring/assessors',{nama:'X Y',aktif:true}],['scoring/form',{}],['flags/decide',{}]])
    assert.throws(()=>f.route(leader,path,'POST',body),e=>e.status===403,path);
  for(const user of [f.users.it,f.users.hr])for(const path of ['scoring','flags'])assert.throws(()=>f.route(user,path),e=>e.status===403);
  assert.deepEqual(all(f.db,"SELECT object_type,action FROM audit_events WHERE object_type IN('visit_score_rules','visit_finding_types','visit_assessors','visit_form_settings') ORDER BY occurred_at,rowid").map(a=>`${a.object_type}:${a.action}`),
    ['visit_score_rules:CREATE','visit_score_rules:DELETE','visit_finding_types:CREATE','visit_finding_types:CREATE','visit_finding_types:UPDATE','visit_assessors:CREATE','visit_form_settings:UPDATE']);
  assert.equal(p.aktif,true);assert.equal(scoringRules.teguranMaks,2);
});

test('verifikasi pelanggaran berat: setujui, tolak dengan alasan, buka kembali; semua diaudit',t=>{
  const f=fixture(t),pos1=f.link(1),t0=Date.now()-3*3600000,m=f.users.manager;
  f.ingest(pos1,[at(t0,{criteria:fakta({berat:'kasar'}),catatan:'Membentak tamu di tangga.'}),at(t0+30*60000,{guideId:'G-003',criteria:fakta({apresiasi:'menolong'}),catatan:'Membantu tamu lansia.'})]);
  const list=()=>f.route(m,'flags','GET',{},`from=${witaDate(t0)}&to=${witaDate(Date.now())}`);
  let l=list();assert.deepEqual([l.items.length,l.counts.menunggu,l.menunggu_semua,l.can_decide],[2,2,2,true]);
  assert.equal(f.route(f.users.leader,'flags','GET',{},`from=${witaDate(t0)}&to=${witaDate(Date.now())}`).can_decide,false,'pimpinan hanya melihat');
  const berat=l.items.find(x=>x.jenis==='berat'),apr=l.items.find(x=>x.jenis==='apresiasi');
  assert.throws(()=>f.route(m,'flags/decide','POST',{id:berat.id,row_version:berat.row_version,action:'tolak'}),e=>e.status===422&&/alasan/.test(e.message));
  const rejected=f.route(m,'flags/decide','POST',{id:berat.id,row_version:berat.row_version,action:'tolak',catatan:'Tidak ada saksi lain.'});
  assert.deepEqual([rejected.status,rejected.keputusanCatatan,rejected.diputuskanOleh],['ditolak','Tidak ada saksi lain.','kunjungan']);
  assert.throws(()=>f.route(m,'flags/decide','POST',{id:berat.id,row_version:berat.row_version,action:'setujui'}),e=>e.status===409,'versi lama');
  const reopened=f.route(m,'flags/decide','POST',{id:berat.id,row_version:rejected.row_version,action:'buka'});assert.equal(reopened.status,'menunggu');
  const approved=f.route(m,'flags/decide','POST',{id:berat.id,row_version:reopened.row_version,action:'setujui'});assert.equal(approved.status,'disetujui');
  f.route(m,'flags/decide','POST',{id:apr.id,row_version:apr.row_version,action:'setujui'});
  l=list();assert.deepEqual([l.counts.disetujui,l.counts.menunggu,l.menunggu_semua],[2,0,0]);
  assert.equal(f.route(m,'flags','GET',{},`from=${witaDate(t0)}&to=${witaDate(Date.now())}&jenis=berat`).items.length,1);
  assert.equal(one(f.db,"SELECT count(*) n FROM audit_events WHERE object_type='visit_flags' AND action='DECIDE'").n,4);
  // Laporan tetap ada setelah rincian penilaian dihapus (retensi 6 minggu).
  run(f.db,'DELETE FROM visit_evaluations');assert.equal(list().items.length,2);
});

test('sheet copy: yearly spreadsheet in SPH-Portal-Kunjungan, monthly tabs, positional rows, corrections rewritten, formulas kept as text',async t=>{
  const f=fixture(t),google=createFakeGoogle(),pos1=f.link(1);
  const t0=Date.now()-2*3600000,a=at(t0,{catatan:'=IMPORTDATA("http://x")'}),b=at(t0,{guideId:'G-003'});
  f.ingest(pos1,[a,b]);
  let r=await sync(f,google);assert.equal(r.ok,true,r.error);assert.equal(r.written,2);
  const [book]=google.spreadsheets(),year=witaDate(t0).slice(0,4),month=witaDate(t0).slice(0,7);
  assert.equal(book.name,`Penilaian Guide ${year}`);assert.deepEqual(book.appProperties,{sph_portal:'v1',sph_module:'kunjungan',sph_kind:'penilaian-guide',sph_year:year});
  const folder=google.state().files[book.parents[0]];assert.equal(folder.name,'SPH-Portal-Kunjungan');assert.equal(folder.parents[0],google.env.GOOGLE_DRIVE_FOLDER_ID);
  assert.deepEqual(book.tabs.map(x=>x.title),['Petunjuk',month]);assert.deepEqual(google.tab(month).cells[1],[...visitSheetHeader]);assert(google.tab(month).protected);
  const rowOf=id=>google.rows(month).find(x=>x[0]===id);
  assert.deepEqual(rowOf(a.evaluationId).slice(2,13),[1,'G-001','Guide Fiktif Satu',2,1,0,1,'=IMPORTDATA("http://x")',one(f.db,'SELECT received_at r FROM visit_evaluations WHERE id=?',a.evaluationId).r,'','aktif']);
  assert.deepEqual(all(f.db,'SELECT sheet_tab,sheet_row FROM visit_evaluations ORDER BY sheet_row').map(x=>[x.sheet_tab,x.sheet_row]),[[month,2],[month,3]]);
  // Kiriman berikutnya menyambung di baris berikutnya; koreksi menulis ulang baris lama.
  const fix=at(t0,{koreksiDari:a.evaluationId,criteria:{uniform:1,idCard:true,etika:0}});f.ingest(pos1,[fix]);
  r=await sync(f,google);assert.deepEqual([r.written,r.rewritten],[1,1]);
  assert.equal(rowOf(a.evaluationId)[12],'diganti');assert.equal(rowOf(fix.evaluationId)[11],a.evaluationId);assert.equal(sheetIds(google,month).length,3);
  assert.equal(r.status.pending,0);assert.equal(r.status.files[0].url,`https://docs.google.com/spreadsheets/d/${book.id}/edit`);
  // Tanpa pekerjaan: tidak ada panggilan Google sama sekali.
  const calls=google.calls.length;r=await sync(f,google);assert.equal(r.ok,true);assert.equal(google.calls.length,calls);
  // Pemicu otomatis dibatasi frekuensinya; pemicu manual tidak.
  f.ingest(pos1,[at(t0,{guideId:'G-004'})]);
  assert.equal((await sync(f,google,{trigger:'auto'})).throttled,true);assert.equal((await sync(f,google)).written,1);
});

test('sheet copy survives failures without duplicates: lost network, crash before bookkeeping, sorted and deleted tabs, grid growth',async t=>{
  const f=fixture(t),google=createFakeGoogle(),pos1=f.link(1),t0=Date.now()-5*3600000;
  const month=witaDate(t0).slice(0,7),items=[0,1,2].map(i=>at(t0+i*20*60000));f.ingest(pos1,items);
  // Jaringan putus saat menulis: lease dibiarkan habis sendiri, tidak ada baris tercatat.
  await sync(f,google);google.fail('/values:batchUpdate',0,'network',{throws:true});
  f.ingest(pos1,[at(t0,{guideId:'G-003'})]);
  let r=await sync(f,google);assert.equal(r.ok,false);assert.match(r.error,/belum dapat dihubungi/);
  assert(one(f.db,'SELECT lease_owner FROM visit_sheet_state').lease_owner,'lease ditahan');assert.equal((await sync(f,google)).busy,true);
  const expire=()=>run(f.db,"UPDATE visit_sheet_state SET lease_until='2000-01-01T00:00:00.000Z'");
  expire();r=await sync(f,google);assert.equal(r.ok,true,r.error);assert.equal(sheetIds(google,month).length,4);
  // Tulisan sampai di Google tetapi pencatatan gagal: percobaan berikutnya menimpa posisi yang sama.
  f.ingest(pos1,[at(t0,{guideId:'G-004'}),at(t0,{guideId:'G-005'})]);
  const prepare=f.db.prepare.bind(f.db);let crash=true;
  f.db.prepare=sql=>{if(crash&&sql.includes('sheet_synced_at=?,sheet_verified_at=NULL,')){crash=false;throw new Error('crash simulasi');}return prepare(sql);};
  r=await sync(f,google);f.db.prepare=prepare;assert.equal(r.ok,false);
  expire();r=await sync(f,google);assert.equal(r.ok,true,r.error);
  const ids=sheetIds(google,month);assert.equal(ids.length,6);assert.equal(new Set(ids).size,6,'tanpa baris ganda');
  // Pengguna mengurutkan tab: posisi dibaca ulang, baris yang berubah ditulis di posisi barunya.
  google.sortTab(month,1);
  f.ingest(pos1,[at(Date.parse(items[1].timestamp),{koreksiDari:items[1].evaluationId,criteria:{uniform:-1,idCard:false,etika:-5}})]);
  r=await sync(f,google);assert.equal(r.ok,true,r.error);assert(r.rescanned>=1);
  const byId=new Map(google.rows(month).filter(x=>x.length).map((x,i)=>[x[0],{row:i+2,cells:x}]));assert.equal(byId.size,7);assert.equal(sheetIds(google,month).length,7);
  for(const e of all(f.db,'SELECT * FROM visit_evaluations')){assert.equal(byId.get(e.id).row,e.sheet_row);assert.equal(byId.get(e.id).cells[12],e.status);}
  // Tab terhapus: dibuat ulang dan semua baris bulan itu disalin lagi.
  google.removeTab(month);f.ingest(pos1,[at(t0+3*20*60000,{guideId:'G-003'})]);
  r=await sync(f,google);assert.equal(r.ok,true,r.error);assert.equal(sheetIds(google,month).length,8);
  // Lebih dari 1000 baris dalam sebulan: grid ditambah lewat appendDimension (Google tiruan menolak menulis di luar grid).
  const rowsBefore=google.tab(month).rowCount,start=Date.parse(`${witaDate(t0)}T00:00:00+08:00`);
  tx(f.db,()=>{for(let i=0;i<1100;i++){const ms=Math.min(start+i*60000,Date.now());run(f.db,"INSERT INTO visit_evaluations(id,link_id,pos,guide_id,guide_name,uniform,id_card,review,etika,catatan,evaluated_at,wita_date,received_at,status) VALUES(?,?,1,'G-005','Guide Fiktif Lima',1,1,0,0,'',?,?,?,'aktif')",crypto.randomUUID(),pos1.admitted.id,new Date(ms).toISOString(),witaDate(ms),now());}});
  r=await sync(f,google);assert.equal(r.ok,true,r.error);if(r.status.pending)r=await sync(f,google);
  assert.equal(r.status.pending,0);assert(google.tab(month).rowCount>rowsBefore);assert.equal(sheetIds(google,month).length,1108);
});

test('retention: rows older than 6 weeks are verified cell by cell, folded into daily totals, then deleted — figures stay identical for any day range',async t=>{
  const f=fixture(t),google=createFakeGoogle(),pos1=f.link(1),pos3=f.link(3);
  const oldNow=Date.now()-50*DAY,oldDay=witaDate(oldNow-DAY),base=Date.parse(`${oldDay}T08:00:00+08:00`);
  f.ingest(pos1,[0,1,2,3,4,5].map(i=>at(base+i*20*60000,{criteria:{uniform:i%3?1:2,idCard:i!==2,etika:i-2}})),oldNow);
  f.ingest(pos3,[at(base,{pos:3,guideId:'G-003'}),at(base+DAY,{pos:3,guideId:'G-003',criteria:{uniform:-1,idCard:false,etika:-3}})],oldNow+DAY+3600000);
  const recent=Date.now()-41*DAY;f.ingest(pos1,[at(recent,{guideId:'G-004'})],recent+60000);
  const today=witaDate(Date.now()),from=`${oldDay.slice(0,7)}-01`;
  // Angka per petugas hanya dari rincian 6 minggu (rekap harian sengaja tanpa identitas petugas).
  const figures=o=>JSON.stringify({...o,diperbarui:null,periode:null,perPetugas:null});
  const before=visitOverview(f.db,from,today);
  // Rentang harian yang memotong hari-hari yang akan dilipat: dulu harus bulan penuh.
  let cut=shiftDate(shiftDate(shiftDate(today,-visitRules.retensiHari),-1),-1);if(cut.endsWith('-01'))cut=shiftDate(cut,-1);
  const beforeCut=visitOverview(f.db,cut,today),beforeOldDay=visitOverview(f.db,oldDay,oldDay);
  // Tersalin tanpa retensi, lalu satu sel diubah orang di spreadsheet.
  let r=await sync(f,google,{retention:'skip'});assert.equal(r.ok,true,r.error);
  const victim=one(f.db,"SELECT * FROM visit_evaluations WHERE guide_id='G-003' ORDER BY wita_date DESC LIMIT 1");
  google.editCell(victim.sheet_tab,victim.sheet_row,4,'Diubah tangan');
  r=await sync(f,google);assert.equal(r.ok,true,r.error);assert.equal(r.rewrite_queued,1);assert.equal(r.retention_blocked,true);
  assert(one(f.db,'SELECT id FROM visit_evaluations WHERE id=?',victim.id),'baris yang belum cocok tidak dihapus');
  assert.equal(one(f.db,'SELECT count(*) n FROM visit_evaluations WHERE wita_date<?',victim.wita_date).n,0,'hari sebelum baris itu sudah dilipat');
  r=await sync(f,google);assert.equal(r.ok,true,r.error);assert.equal(r.rewritten,1);
  assert.equal(google.rows(victim.sheet_tab).find(x=>x[0]===victim.id)[4],'Guide Fiktif Tiga');
  const cutoff=shiftDate(today,-visitRules.retensiHari);
  assert.equal(one(f.db,'SELECT count(*) n FROM visit_evaluations WHERE wita_date<?',cutoff).n,0);
  assert.equal(r.status.folded_through,shiftDate(cutoff,-1));assert.equal(one(f.db,'SELECT count(*) n FROM visit_evaluations').n,1);
  assert.equal(figures(visitOverview(f.db,from,today)),figures(before),'angka sama persis sebelum dan sesudah pelipatan');
  const allIds=google.spreadsheets().flatMap(b=>b.tabs.filter(x=>x.title!=='Petunjuk').flatMap(x=>sheetIds(google,x.title)));
  assert.equal(allIds.length,9,'spreadsheet tetap memuat semuanya');
  assert.equal(f.route(f.users.leader,'records','GET',{},`from=${from}&to=${today}`).items.length,1);
  assert.equal(figures(f.route(f.users.leader,'overview','GET',{},`from=${cut}&to=${today}`)),figures(beforeCut),'rentang harian di atas hari yang dilipat');
  assert.equal(figures(visitOverview(f.db,oldDay,oldDay)),figures(beforeOldDay),'satu hari yang sudah dilipat');
  const daily=all(f.db,"SELECT * FROM visit_daily_totals WHERE sumber='portal' ORDER BY day,guide_id,pos");
  assert.equal(daily.reduce((n,d)=>n+Number(d.antar),0),8,'rekap harian memuat semua pengantaran aktif yang dilipat');
  assert(daily.every(d=>d.day<=r.status.folded_through));
  // Kiriman ulang penilaian yang sudah dilipat ditolak karena umurnya, bukan tersimpan ganda.
  assert.equal(f.ingest(pos1,[at(base)]).rejected[0].reason,'WAKTU');
});

test('sheet copy: kolom N–T untuk cara baru; tab 13 kolom dilebarkan saat ditulis dan dicocokkan sesuai lebarnya saat retensi',async t=>{
  const f=fixture(t),google=createFakeGoogle(),pos1=f.link(1),pos3=f.link(3);
  const petugas=f.route(f.users.manager,'scoring/assessors','POST',{nama:'Ketut Petugas',aktif:true});
  // Penilaian cara lama 50 hari lalu, tersalin ke tab yang lalu "dikembalikan" ke 13 kolom seperti sebelum rilis.
  const oldNow=Date.now()-50*DAY,oldBase=oldNow-3600000,oldMonth=witaDate(oldBase).slice(0,7);
  f.ingest(pos3,[at(oldBase,{pos:3,guideId:'G-003',criteria:{uniform:-1,idCard:false,etika:-2}})],oldNow);
  let r=await sync(f,google,{retention:'skip'});assert.equal(r.ok,true,r.error);
  const oldTab=google.tab(oldMonth);oldTab.columnCount=13;for(const row of Object.values(oldTab.cells))row.length=Math.min(row.length,13);
  // Cara baru hari ini: kolom versi, seragam, teguran, pelanggaranBerat, apresiasi, petugas, nilai.
  const t0=Date.now()-2*3600000,month=witaDate(t0).slice(0,7);
  const a=at(t0,{criteria:fakta({seragam:'kurang',teguran:['antrean'],idCard:false}),petugasId:petugas.id});
  const b=at(t0,{guideId:'G-004',criteria:fakta({berat:'pungutan'}),catatan:'Meminta uang di gerbang.'});
  f.ingest(pos1,[a,b]);
  r=await sync(f,google,{retention:'skip'});assert.equal(r.ok,true,r.error);
  assert.deepEqual(google.tab(month).cells[1],[...visitSheetHeader]);assert.equal(visitSheetHeader.length,20);
  const rowOf=id=>google.rows(month).find(x=>x[0]===id);
  assert.deepEqual(rowOf(a.evaluationId).slice(5,9),[-1,0,0,-1],'kolom lama berisi padanannya');
  assert.deepEqual(rowOf(a.evaluationId).slice(13),[2,'Kurang lengkap','antrean','','','Ketut Petugas',100-20-10-20]);
  assert.deepEqual(rowOf(b.evaluationId).slice(13),[2,'Lengkap','','pungutan','','',100]);
  // Koreksi penilaian cara lama di tab 13 kolom: tab dilebarkan, kepala N–T ditulis, baris ditulis ulang utuh.
  if(oldMonth!==month){
   const old=one(f.db,"SELECT * FROM visit_evaluations WHERE guide_id='G-003'");
   run(f.db,'UPDATE visit_evaluations SET sheet_dirty=1 WHERE id=?',old.id);
   r=await sync(f,google,{retention:'skip'});assert.equal(r.ok,true,r.error);assert.equal(r.widened,1);
   assert.equal(google.tab(oldMonth).columnCount,20);assert.deepEqual(google.tab(oldMonth).cells[1].slice(13),visitSheetHeader.slice(13));
   oldTab.columnCount=13;for(const row of Object.values(oldTab.cells))row.length=Math.min(row.length,13);
  }
  // Retensi: tab 13 kolom dibaca A–M saja (Google menolak rentang di luar grid) dan barisnya cocok.
  r=await sync(f,google,{retention:'force'});assert.equal(r.ok,true,r.error);assert.equal(r.verified,1);assert.equal(r.deleted,1);
  const daily=one(f.db,"SELECT * FROM visit_daily_totals WHERE guide_id='G-003'");
  assert.deepEqual([daily.antar,daily.n_id,daily.n_kurang,daily.n_tidak,daily.n_teguran],[1,1,0,1,0],'temuan cara lama ikut dilipat');
  // Baris cara baru yang dilipat membawa cacah temuannya.
  const fold=Date.now()-45*DAY,c=at(fold,{guideId:'G-005',criteria:fakta({seragam:'tidak',teguran:['antrean','merokok-hp']}),petugasId:petugas.id});
  f.ingest(pos1,[c],fold+60000);r=await sync(f,google,{retention:'force'});assert.equal(r.ok,true,r.error);
  const daily5=one(f.db,"SELECT * FROM visit_daily_totals WHERE guide_id='G-005'");assert.deepEqual([daily5.n_tidak,daily5.n_teguran,daily5.n_id],[1,2,0]);
  const day=witaDate(fold),o=visitOverview(f.db,day,day);assert.equal(o.ringkasan.nilai,100-20-40,'nilai hari yang sudah dilipat');
});

test('nothing is deleted while the Google copy is unavailable, and the connection check explains why without creating files',async t=>{
  const f=fixture(t),google=createFakeGoogle(),pos1=f.link(1),oldNow=Date.now()-50*DAY;
  f.ingest(pos1,[at(oldNow-3600000)],oldNow);
  google.options.sheetsDisabled=true;
  let check=await checkVisitSheetConnection({runTx:f.runTx,env:google.env,fetchImpl:google.fetch});
  assert.equal(check.ok,false);assert.deepEqual(check.steps.map(s=>[s.key,s.ok]),[['config',true],['token',true],['drive',true],['sheets',false]]);
  google.options.sheetsDisabled=false;google.options.scopeInsufficient=true;
  check=await checkVisitSheetConnection({runTx:f.runTx,env:google.env,fetchImpl:google.fetch});assert.match(check.steps.at(-1).message,/Izin token/);
  google.options.scopeInsufficient=false;google.options.tokenRevoked=true;
  check=await checkVisitSheetConnection({runTx:f.runTx,env:google.env,fetchImpl:google.fetch});assert.equal(check.steps.at(-1).key,'token');assert.match(check.steps.at(-1).message,/dihubungkan ulang/);
  google.options.tokenRevoked=false;
  check=await checkVisitSheetConnection({runTx:f.runTx,env:google.env,fetchImpl:google.fetch});assert.equal(check.ok,true);
  assert.equal(google.spreadsheets().length,0,'pemeriksaan tidak membuat berkas');
  google.options.sheetsDisabled=true;
  let r=await sync(f,google);assert.equal(r.ok,false);assert.match(r.error,/Google Sheets API belum aktif/);
  assert.equal(one(f.db,'SELECT count(*) n FROM visit_evaluations').n,1);assert.match(r.status.last_error,/Sheets API/);
  google.options.sheetsDisabled=false;
  const missing=await runVisitSheetSync({runTx:f.runTx,env:{},trigger:'manual'});assert.equal(missing.configured,false);assert.equal(one(f.db,'SELECT count(*) n FROM visit_evaluations').n,1);
  // Spreadsheet terhapus permanen: penyalinan dan penghapusan ditahan, tidak dibuat ulang diam-diam.
  r=await sync(f,google);assert.equal(r.ok,true,r.error);assert.equal(one(f.db,'SELECT count(*) n FROM visit_evaluations').n,0);
  assert.deepEqual(google.spreadsheets()[0].tabs.map(x=>x.title)[0],'Petunjuk','berkas yang terbentuk saat Sheets API mati tetap dirapikan');assert.equal(google.spreadsheets().length,1);
  f.ingest(pos1,[at(Date.now()-3600000)]);google.deleteSpreadsheet(google.spreadsheets()[0].id);
  r=await sync(f,google);assert.equal(r.ok,false);assert.match(r.error,/tidak ditemukan/);assert.equal(google.spreadsheets().length,0);
  assert.equal(isVisitSheetAction('visits/sheet/sync','POST'),true);assert.equal(isVisitSheetAction('visits/sheet/sync','GET'),false);
});

const freePort=()=>new Promise(r=>{const probe=createServer().listen(0,'127.0.0.1',()=>{const {port}=probe.address();probe.close(()=>r(port));});});
async function server(t,{google=createFakeGoogle(),sheetAuto=false}={}){
  const f=fixture(t),port=await freePort(),origin=`http://127.0.0.1:${port}`;
  const app=createApp({db:f.db,dataDir:resolve('data','test-visits'),origin,sheetEnv:google.env,sheetFetch:google.fetch,sheetAuto});
  await new Promise(r=>app.server.listen(port,'127.0.0.1',r));t.after(()=>app.server.close());
  const form=(action,body,headers={})=>fetch(`${origin}/api/guide-form/${action}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...headers},body:JSON.stringify(body)});
  async function login(username){const r=await fetch(`${origin}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'fixture123'})});const data=await r.json();return {cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),csrf:data.csrfToken};}
  const api=(session,path,body)=>fetch(`${origin}/api/${path}`,{method:body?'POST':'GET',headers:{Cookie:session.cookie,'X-CSRF-Token':session.csrf,...(body?{'Content-Type':'application/json',Origin:origin}:{})},body:body?JSON.stringify(body):undefined});
  return {...f,app,google,origin,form,login,api};
}

test('public form over HTTP: context from Data Guide, receipts, outcome log without content, revoked links, and background copy',async t=>{
  const s=await server(t,{sheetAuto:true}),link=s.route(s.users.manager,'links','POST',{action:'create',pos:1});
  assert.equal((await s.form('context',{token:link.token},{Origin:'https://evil.example'})).status,403);
  assert.equal((await fetch(`${s.origin}/api/guide-form/context`,{method:'GET'})).status,404);
  const context=await (await s.form('context',{token:link.token})).json();
  assert.deepEqual([context.pos,context.label],[1,'Pos 1 — Pintu Masuk']);assert.deepEqual(context.guides.map(g=>g.guideId).sort(),['G-001','G-003','G-004','G-005'],'hanya guide aktif');
  // Bahan formulir cara baru: jenis temuan aktif, petugas aktif, petunjuk — tanpa bobot potongan.
  assert.deepEqual([context.penilaian.versi,context.penilaian.teguranMaks,context.penilaian.teguran.length,context.penilaian.berat.length,context.penilaian.apresiasi.length],[2,2,5,5,3]);
  assert.match(context.penilaian.petunjuk.idCard,/Terpasang/);assert.equal(JSON.stringify(context.penilaian).includes('pot_'),false);
  const page=await fetch(`${s.origin}/penilaian-guide/`);assert.equal(page.headers.get('referrer-policy'),'no-referrer');assert.match(page.headers.get('x-robots-tag'),/noindex/);
  const good=evaluation(1),unknown=evaluation(1,{guideId:'G-999'}),wrong=evaluation(3);
  let r=await s.form('submit',{token:link.token,evaluations:[good,unknown,wrong]});assert.equal(r.status,200);let receipt=await r.json();
  assert.deepEqual(receipt.accepted,[{evaluationId:good.evaluationId,synced:true,duplicate:false}]);assert.equal(receipt.rejected.length,2);assert(!JSON.stringify(receipt).includes('"reason"'));
  await Promise.all([...s.app.sheetTasks]);assert.deepEqual(sheetIds(s.google,witaDate(Date.parse(good.timestamp)).slice(0,7)),[good.evaluationId],'tersalin di latar belakang');
  r=await s.form('submit',{token:link.token,evaluations:[good]});receipt=await r.json();assert.equal(receipt.accepted[0].duplicate,true);
  // Formulir cara baru lewat HTTP: diterima bersama kiriman cara lama dari HP lain.
  const fresh=evaluation(1,{guideId:'G-003',criteria:fakta({teguran:['antrean']})});
  receipt=await (await s.form('submit',{token:link.token,evaluations:[fresh]})).json();assert.equal(receipt.accepted[0].evaluationId,fresh.evaluationId);
  assert.equal(one(s.db,'SELECT versi FROM visit_evaluations WHERE id=?',fresh.evaluationId).versi,2);
  await Promise.all([...s.app.sheetTasks]);
  const log=all(s.db,'SELECT * FROM guide_form_submissions ORDER BY outcome,reason');
  assert.deepEqual(log.map(l=>[l.outcome,l.reason]),[['ACCEPTED',null],['ACCEPTED',null],['DUPLICATE',null],['REJECTED','GUIDE'],['REJECTED','POS']]);
  assert(log.every(l=>l.ip_hmac===null));assert(!JSON.stringify(log).includes('Guide Fiktif'));
  assert.equal((await s.form('submit',{token:link.token,evaluations:'x'})).status,400);
  assert.equal((await s.form('submit',{token:link.token,evaluations:[evaluation(1,{catatan:'x'.repeat(30000)})]})).status,413);
  s.route(s.users.manager,'links','POST',{action:'revoke',pos:1,id:link.link.id,row_version:link.link.row_version});
  r=await s.form('submit',{token:link.token,evaluations:[evaluation(1)]});assert.equal(r.status,404);assert.match((await r.json()).error,/Tautan pos tidak aktif/);
});

test('workspace API: permissions, import, sheet status and actions; a slow Google never holds a database transaction',async t=>{
  const s=await server(t),manager=await s.login('kunjungan'),leader=await s.login('pimpinan'),it=await s.login('itadmin');
  s.ingest(s.link(1),[evaluation(1)]);
  let r=await s.api(leader,`visits/overview?from=${witaDate(Date.now()-DAY)}&to=${witaDate(Date.now())}`);assert.equal(r.status,200);assert.equal((await r.json()).ringkasan.pengantaran,1);
  assert.equal((await s.api(it,'visits/overview')).status,403);assert.equal((await s.api(leader,'visits/guides',{guideName:'X',kategori:'Asing',regu:'A1',aktif:true})).status,403);
  r=await s.api(manager,'visits/guides/import',{rows:[{guideId:'G-010',guideName:'Guide Impor',kategori:'Asing',regu:'A1'}],apply:true});assert.equal(r.status,201);assert.equal((await r.json()).create,1);
  assert.equal((await s.api(leader,'visits/sheet/sync',{})).status,403);assert.equal((await s.api(it,'visits/sheet/check',{})).status,403);
  r=await s.api(leader,'visits/sheet');let status=await r.json();assert.equal(r.status,200);assert.equal(status.pending,1);assert.equal(status.can_sync,false);
  r=await s.api(manager,'visits/sheet/check',{});assert.equal(r.status,200);assert.equal((await r.json()).ok,true);
  s.google.options.latencyMs=150;
  const slow=s.api(manager,'visits/sheet/sync',{});await new Promise(res=>setTimeout(res,80));
  const started=Date.now();tx(s.db,()=>insert(s.db,'audit_events',{actor_user_id:null,action:'FIXTURE',object_type:'x',object_key:'x',occurred_at:now(),outcome:'SUCCESS',request_id:crypto.randomUUID(),reason:'',change_summary:'{}'}));
  assert(Date.now()-started<100,'transaksi lain tidak menunggu Google');
  r=await slow;assert.equal(r.status,200);const result=await r.json();assert.equal(result.ok,true,result.error);assert.equal(result.written,1);
  status=await (await s.api(leader,'visits/sheet')).json();assert.equal(status.pending,0);assert.match(status.files[0].url,/^https:\/\/docs\.google\.com\/spreadsheets\/d\//,'pimpinan berhak ekspor melihat alamat berkas');
});

test('generated cloud modules await every permission check (a pending promise never authorizes)',async()=>{
  const cloud=await import('../supabase/functions/_shared/portal/visits.mjs');
  const deny={has:async()=>false,audit:async()=>{}},user={id:crypto.randomUUID(),must_change_password:false},db={inTransaction:true,query:async()=>[]};
  await assert.rejects(cloud.authorizeVisitSheetAction({db,user},deny),e=>e.status===403);
  for(const [path,method,body] of [['links','GET'],['links','POST',{action:'create',pos:1}],['activity','GET'],['exports','POST',{kind:'records',from:'2026-11-01',to:'2026-11-02',rows:1}],
    ['overview','GET'],['records','GET'],['guides','GET'],['guides','POST',{guideName:'X',kategori:'Asing',regu:'A1',aktif:true}],['guides/import','POST',{rows:[{}]}],['sheet','GET'],
    ['scoring','GET'],['scoring/rule','POST',{berlaku_mulai:'2099-01'}],['scoring/types','POST',{}],['scoring/assessors','POST',{}],['scoring/form','POST',{}],['flags','GET'],['flags/decide','POST',{}]])
    await assert.rejects(cloud.visitRoutes({db,user,p:['visits',...path.split('/')],method,body:body||{},url:new URL('https://portal.test/?')},deny),e=>e.status===403,`${method} visits/${path}`);
});

test('guide form assets follow the portal CSP and ship no guide list, bridge address or token',async()=>{
  const {readFileSync,readdirSync,statSync}=await import('node:fs');
  const root=resolve('public','penilaian-guide'),files=[];
  const walk=dir=>{for(const name of readdirSync(dir)){const path=resolve(dir,name);if(statSync(path).isDirectory())walk(path);else files.push(path);}};walk(root);
  const html=readFileSync(resolve(root,'index.html'),'utf8');
  assert(!/\sstyle=/.test(html)&&!/\son[a-z]+=/.test(html),'tanpa style/handler inline');
  assert(![...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].some(([,attrs,body])=>!/\bsrc=/.test(attrs)||body.trim()),'tanpa skrip inline');
  for(const file of files.filter(f=>/\.(js|html|css|webmanifest)$/.test(f))){
    const text=readFileSync(file,'utf8');
    for(const banned of ['guides.json','script.google','googleapis.com','config.js','APP_CONFIG','eval('])assert(!text.includes(banned),`${file} memuat ${banned}`);
    assert(!/[a-f0-9]{64}/.test(text),`${file} memuat token`);
  }
  const sw=readFileSync(resolve(root,'sw.js'),'utf8');assert.match(sw,/url\.pathname\.startsWith\('\/api\/'\)/);
  const headers=readFileSync(resolve('site-info','dist','_headers'),'utf8'),block=headers.split(/\n\n/).find(b=>b.startsWith('/penilaian-guide/*'));
  assert(block&&/no-store/.test(block)&&/noindex/.test(block)&&/no-referrer/.test(block));
});
