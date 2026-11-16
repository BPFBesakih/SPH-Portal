import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,insert,one,all,run,tx,now} from '../lib/db.mjs';
import {seedPermissions,hashPasswordSync} from '../lib/auth.mjs';
import {visitRoutes} from '../lib/visits.mjs';
import {ingestGuideEvaluations,visitOverview,witaDate} from '../lib/visit-data.mjs';
import {flagCounts,flagEventId,resolveFlagEvents} from '../lib/visit-scoring.mjs';

const password=hashPasswordSync('FixtureFlags2026!');
function fixture(t){
 const db=openDb(':memory:');t.after(()=>db.close());seedPermissions(db);
 const user=insert(db,'users',{username:'kunjungan.flags',password_hash:password,status:'ACTIVE',must_change_password:0,failed_login_count:0,password_changed_at:now()});
 insert(db,'user_roles',{user_id:user.id,role_id:one(db,"SELECT id FROM roles WHERE code='KUNJUNGAN_PENGELOLA'").id,scope_kind:'ALL'});
 for(const [id,name] of [['G-001','Guide Satu'],['G-002','Guide Dua']])insert(db,'visit_guides',{id,seq:Number(id.slice(2)),name,kategori:'Asing',regu:'A1',is_active:1});
 const route=(path,method='GET',body={})=>visitRoutes({db,user,p:['visits',...path.split('/')],method,body,url:new URL('https://portal.test/')});
 const link=route('links','POST',{action:'create',pos:1}).link;
 const at=Date.now()-2*3600000,day=witaDate(at);
 const ingest=(previous=null,criteria={},guide='G-001')=>{
  const item={evaluationId:crypto.randomUUID(),guideId:guide,guideName:'Guide',pos:1,timestamp:new Date(at).toISOString(),
   criteria:{idCard:true,seragam:'lengkap',teguran:[],berat:null,apresiasi:'menolong',...criteria},catatan:'Membantu wisatawan di tangga.',...(previous?{koreksiDari:previous}: {})};
  const receipt=tx(db,()=>ingestGuideEvaluations(db,{id:link.id,pos:1},[item]));
  assert.deepEqual(receipt.rejected,[]);assert.equal(receipt.accepted.length,1);return item.evaluationId;
 };
 const flag=(evaluationId,jenis='apresiasi')=>one(db,'SELECT * FROM visit_flags WHERE evaluation_id=? AND jenis=?',evaluationId,jenis);
 const decide=(f,action='setujui',catatan='')=>route('flags/decide','POST',{id:f.id,row_version:Number(f.row_version),action,catatan});
 const counts=()=>flagCounts(db,day,day).get('G-001');
 return {db,user,route,ingest,flag,decide,counts,day};
}

test('approved appreciation counts once across repeated corrections, including after retention',t=>{
 const f=fixture(t),versions=[];
 for(let i=0;i<3;i++){
  const id=f.ingest(versions.at(-1));versions.push(id);f.decide(f.flag(id));
 }
 assert.equal(one(f.db,"SELECT count(*) AS n FROM visit_evaluations WHERE status='aktif' AND guide_id='G-001'").n,1);
 assert.equal(one(f.db,"SELECT count(*) AS n FROM visit_flags WHERE status='disetujui'").n,3,'each decision stays in the record');
 assert.deepEqual(all(f.db,'SELECT DISTINCT event_id FROM visit_flags').map(r=>r.event_id),[versions[0]],'corrections keep the original event identity');
 assert.deepEqual(f.counts().apresiasi,{disetujui:1,menunggu:0});
 const other=f.ingest(null,{},'G-002');f.decide(f.flag(other));
 const overview=visitOverview(f.db,f.day,f.day);
 assert.deepEqual(overview.perGuide.map(g=>[g.apresiasi,g.peringkat]),[[1,1],[1,1]],'correcting the same delivery gives no tie-break advantage');
 run(f.db,'DELETE FROM visit_evaluations');
 assert.deepEqual(f.counts().apresiasi,{disetujui:1,menunggu:0},'folding evaluation details does not lose deduplication');
});

test('reopening old correction decisions cannot multiply or hide approved events',t=>{
 const f=fixture(t),a=f.ingest();f.decide(f.flag(a));
 const b=f.ingest(a);f.decide(f.flag(b));
 const c=f.ingest(b);
 assert.deepEqual(f.counts().apresiasi,{disetujui:1,menunggu:0},'approved event takes precedence over a pending correction');
 f.decide(f.flag(a),'buka','Memeriksa ulang saksi.');
 assert.deepEqual(f.counts().apresiasi,{disetujui:1,menunggu:0},'another approved decision still applies');
 f.decide(f.flag(b),'buka','Memeriksa ulang saksi.');
 assert.deepEqual(f.counts().apresiasi,{disetujui:0,menunggu:1},'multiple pending versions are one event');
 f.decide(f.flag(c));
 assert.deepEqual(f.counts().apresiasi,{disetujui:1,menunggu:0});
});

test('lineage includes an original without flags and keeps an approved serious finding after correction',t=>{
 const f=fixture(t),original=f.ingest(null,{apresiasi:null});
 assert.equal(flagEventId(f.db,original),original);
 assert.equal(flagEventId(f.db,'11223344-1122-3344-5566-778899001122'),'11223344-1122-3344-5566-778899001122','new evaluation has its own identity');
 const second=f.ingest(original,{apresiasi:null,berat:'kasar'});f.decide(f.flag(second,'berat'));
 const third=f.ingest(second,{apresiasi:null,berat:null});
 assert.equal(flagEventId(f.db,third),original);
 assert.equal(f.flag(second,'berat').event_id,original);
 assert.deepEqual(f.counts().berat,{disetujui:1,menunggu:0},'a correction from the pos cannot erase a verified serious finding');
 run(f.db,'DELETE FROM visit_evaluations');
 assert.deepEqual(f.counts().berat,{disetujui:1,menunggu:0});
});

test('decision audit preserves rejection reasons and actors through reopening and later approval',t=>{
 const f=fixture(t),id=f.ingest(null,{apresiasi:null,berat:'kasar'}),flag=f.flag(id,'berat');
 const rejection='Saksi membuktikan identitas pelaku berbeda.';
 f.decide(flag,'tolak',rejection);
 const rejected=f.flag(id,'berat');
 f.decide(rejected,'buka','Saksi kedua akan diperiksa.');
 const reopened=f.flag(id,'berat');
 f.decide(reopened,'setujui','Saksi kedua membenarkan laporan.');
 const events=all(f.db,"SELECT reason,change_summary FROM audit_events WHERE object_type='visit_flags' AND object_key=? AND action='DECIDE' ORDER BY rowid",flag.id);
 assert.equal(events.length,3);
 const [rejectAudit,reopenAudit,approveAudit]=events.map(e=>JSON.parse(e.change_summary));
 assert.equal(events[0].reason,rejection);
 assert.deepEqual([rejectAudit.sebelum.status,rejectAudit.sebelum.catatan,rejectAudit.sesudah.status,rejectAudit.sesudah.catatan],['menunggu','','ditolak',rejection]);
 assert.deepEqual([reopenAudit.sebelum.status,reopenAudit.sebelum.catatan,reopenAudit.sebelum.diputuskan_oleh,reopenAudit.sebelum.diputuskan_pada],['ditolak',rejection,f.user.id,rejected.decided_at]);
 assert.deepEqual([reopenAudit.sesudah.status,reopenAudit.sesudah.diputuskan_oleh,reopenAudit.sesudah.diputuskan_pada],['menunggu',null,null]);
 assert.equal(reopenAudit.sesudah.catatan,'Saksi kedua akan diperiksa.');
 assert.equal(approveAudit.sebelum.catatan,'Saksi kedua akan diperiksa.');
 assert.equal(approveAudit.sesudah.catatan,'Saksi kedua membenarkan laporan.');
 assert.equal(approveAudit.sesudah.diputuskan_oleh,f.user.id);
 assert.equal(rejectAudit.sesudah.row_version,reopenAudit.sebelum.row_version);
 assert.equal(reopenAudit.sesudah.row_version,approveAudit.sebelum.row_version);
 assert(events.some(e=>e.change_summary.includes(rejection)),'old reason survives all subsequent changes');
});

test('legacy Edge flags written during deployment are deduplicated and resolved before retention',t=>{
 const f=fixture(t),a=f.ingest();f.decide(f.flag(a));
 const b=f.ingest(a);f.decide(f.flag(b));
 const c=f.ingest(b);f.decide(f.flag(c));
 run(f.db,'UPDATE visit_flags SET event_id=NULL');
 assert.deepEqual(f.counts().apresiasi,{disetujui:1,menunggu:0},'null legacy identities follow retained correction ancestry');
 assert.equal(resolveFlagEvents(f.db,f.day),3);
 assert.deepEqual(all(f.db,'SELECT DISTINCT event_id FROM visit_flags').map(r=>r.event_id),[a]);
 assert.equal(resolveFlagEvents(f.db,f.day),0,'the metadata repair is idempotent');
 run(f.db,'DELETE FROM visit_evaluations');
 assert.deepEqual(f.counts().apresiasi,{disetujui:1,menunggu:0},'deduplication survives removal of all evaluation ancestry');
});
