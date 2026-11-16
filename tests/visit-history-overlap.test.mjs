import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,insert,one,run,tx,now} from '../lib/db.mjs';
import {seedPermissions,hashPasswordSync} from '../lib/auth.mjs';
import {visitRoutes} from '../lib/visits.mjs';
import {ingestGuideEvaluations,visitOverview,witaDate} from '../lib/visit-data.mjs';

const password=hashPasswordSync('FixtureHistory2026!');
function fixture(t){
 const db=openDb(':memory:');t.after(()=>db.close());seedPermissions(db);
 const user=insert(db,'users',{username:'kunjungan.overlap',password_hash:password,status:'ACTIVE',must_change_password:0,failed_login_count:0,password_changed_at:now()});
 insert(db,'user_roles',{user_id:user.id,role_id:one(db,"SELECT id FROM roles WHERE code='KUNJUNGAN_PENGELOLA'").id,scope_kind:'ALL'});
 insert(db,'visit_guides',{id:'G-001',seq:1,name:'Guide Satu',kategori:'Asing',regu:'A1',is_active:1});
 const route=(path,body)=>visitRoutes({db,user,p:['visits',...path.split('/')],method:'POST',body,url:new URL('https://portal.test/')});
 const link=route('links',{action:'create',pos:1}).link;
 const ms=Date.now()-2*86400000,day=witaDate(ms),stamp=new Date(ms).toISOString();
 const historyId=crypto.randomUUID(),rows=[[2,historyId,stamp,1,'G-001',1,1,0,'aktif']];
 const file={name:'NilaiGuide.csv',sha256:'a'.repeat(64),rows_total:1,parts_total:1};
 const apply=()=>route('history/import',{mode:'apply',file,part:0,rows});
 const ingest=(offset=0,extra={})=>tx(db,()=>ingestGuideEvaluations(db,{id:link.id,pos:1},[{
  evaluationId:crypto.randomUUID(),guideId:'G-001',guideName:'Guide Satu',pos:1,timestamp:new Date(ms+offset*60000).toISOString(),
  criteria:{uniform:1,idCard:true,etika:0},catatan:'',...extra}]));
 return {db,route,ms,day,stamp,historyId,rows,file,apply,ingest,total:()=>visitOverview(db,day,day).ringkasan.pengantaran};
}

test('active imported history prevents a delayed portal delivery being counted again, including same UUID',t=>{
 const f=fixture(t),id=f.apply().import.id;f.route('history/finish',{import_id:id});
 assert.equal(f.total(),1);
 const delayed=f.ingest(-10);assert.equal(delayed.accepted.length,0);assert.equal(delayed.rejected[0].reason,'JEDA');
 assert.match(delayed.rejected[0].errors[0],/riwayat NilaiGuide/);assert.equal(f.total(),1);
 assert.equal(f.ingest(0,{evaluationId:f.historyId}).rejected[0].reason,'JEDA');
 assert.equal(one(f.db,'SELECT count(*) n FROM visit_evaluations').n,0,'rejected deliveries are never inserted');
 assert.equal(f.ingest(15).accepted.length,1,'the existing strict 15-minute boundary is preserved');
 assert.equal(f.total(),2);
 const metadata=one(f.db,'SELECT guide_id,pos,evaluated_at FROM visit_history_ids');
 assert.deepEqual({...metadata},{guide_id:'G-001',pos:1,evaluated_at:f.stamp});
});

test('a staged import holds the offline queue temporarily and cancelling releases it',t=>{
 const f=fixture(t),id=f.apply().import.id;
 assert.throws(()=>f.ingest(-10),e=>e.status===503&&/sedang disusun/.test(e.message));
 assert.equal(f.total(),0);assert.equal(one(f.db,'SELECT count(*) n FROM visit_evaluations').n,0);
 f.route('history/cancel',{import_id:id});assert.equal(f.ingest(-10).accepted.length,1);assert.equal(f.total(),1);
});

test('folded portal totals refuse an ambiguous overlapping history file without writing anything',t=>{
 const f=fixture(t);
 run(f.db,"INSERT INTO visit_daily_totals(day,guide_id,pos,sumber,antar,uniform,uniform_patuh,id_card,review,etika,updated_at) VALUES(?,'G-001',1,'portal',1,1,1,1,0,0,?)",f.day,now());
 for(const mode of ['preview','apply'])assert.throws(()=>f.route('history/import',{mode,file:f.file,part:0,rows:f.rows}),e=>e.status===409&&/sudah dilipat/.test(e.message));
 assert.equal(one(f.db,'SELECT count(*) n FROM visit_history_import').n,0);assert.equal(one(f.db,'SELECT count(*) n FROM visit_history_ids').n,0);
 assert.equal(f.total(),1);
 const otherPos=f.rows.map(r=>r.map((v,i)=>i===3?3:v));
 assert.equal(f.route('history/import',{mode:'preview',file:f.file,part:0,rows:otherPos}).counts.MASUK,1,'another pos remains unambiguous');
});

test('pre-upgrade imports without time metadata hold only overlapping submissions until reimport',t=>{
 const f=fixture(t),id=f.apply().import.id;f.route('history/finish',{import_id:id});
 run(f.db,'UPDATE visit_history_ids SET guide_id=NULL,pos=NULL,evaluated_at=NULL');
 assert.throws(()=>f.ingest(-10),e=>e.status===503&&/diimpor ulang/.test(e.message));
 assert.equal(f.total(),1);
 assert.equal(f.ingest(1440).accepted.length,1,'a different day is unaffected');
 f.route('history/cancel',{import_id:id});const retry=f.apply().import.id;f.route('history/finish',{import_id:retry});
 assert.equal(f.ingest(-10).rejected[0].reason,'JEDA');assert.equal(f.total(),1);
});
