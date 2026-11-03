import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {openDb,insert,one,all,run,tx,now} from '../lib/db.mjs';
import {seedPermissions,digest,hashPasswordSync,grants} from '../lib/auth.mjs';
import {visitRoutes,visitBridgePlan,isVisitBridgeRequest} from '../lib/visits.mjs';
import {takeGuideFormIpSlot,admitGuideForm,checkGuideItem,guideFormLimits} from '../lib/guide-form.mjs';
import {bridgeConfig,callBridge} from '../lib/visits-bridge.mjs';
import {createApp} from '../server.mjs';

const password=hashPasswordSync('fixture123'),bridgeKey='k'.repeat(48)+'-fixture-only';
const iso=minutes=>new Date(Date.now()+minutes*60000).toISOString();
function fixture(t){
  const db=openDb(':memory:');t.after(()=>db.close());seedPermissions(db);
  const account=(username,role)=>{const u=insert(db,'users',{username,password_hash:password,status:'ACTIVE',must_change_password:0,failed_login_count:0,password_changed_at:now()});if(role)insert(db,'user_roles',{user_id:u.id,role_id:one(db,'SELECT id FROM roles WHERE code=?',role).id,scope_kind:'ALL'});return u;};
  // IT-admin produksi: hanya izin administratif, tanpa role kunjungan.
  const itRole=insert(db,'roles',{code:'IT_ADMIN_FIXTURE',name:'IT admin',is_system:0,is_active:1});
  for(const p of all(db,"SELECT id FROM permissions WHERE module_code='admin'"))run(db,'INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)',itRole.id,p.id);
  const users={manager:account('kunjungan','KUNJUNGAN_PENGELOLA'),leader:account('pimpinan','KUNJUNGAN_PIMPINAN'),admin:account('superadmin','SUPER_ADMIN'),it:account('itadmin','IT_ADMIN_FIXTURE'),hr:account('sdm','SDM')};
  const route=(user,path,method='GET',body={},query='')=>visitRoutes({db,user,p:['visits',...path.split('/').filter(Boolean)],method,body,url:new URL('https://portal.test/?'+query)});
  const plan=(user,path,method='GET',body={},query='')=>visitBridgePlan({db,user,p:['visits',...path.split('/').filter(Boolean)],method,body,url:new URL('https://portal.test/?'+query)});
  return {db,users,route,plan};
}
const evaluation=(pos=1,extra={})=>({evaluationId:crypto.randomUUID(),guideId:'G-001',guideName:'Guide Fiktif',pos,timestamp:iso(-30),criteria:{uniform:2,idCard:true,etika:1},catatan:'',...extra});

// Jembatan palsu: meniru bentuk balasan 13_Jembatan.gs, termasuk pengalihan 302 Apps Script.
function fakeBridge({busy=false,delay=0}={}){
  const calls=[],rows=new Map();
  const fetchImpl=async(url,init)=>{
    if(init.method==='GET'){assert.match(url,/^https:\/\/script\.googleusercontent\.com\//);return Response.json(fakeBridge.pending);}
    const body=JSON.parse(init.body);calls.push(body);
    if(delay)await new Promise(r=>setTimeout(r,delay));
    let out;
    if(body.credential!==bridgeKey)out={ok:false,code:'KUNCI',error:'x'};
    else if(body.operation==='form.context')out={ok:true,data:{guides:[{guideId:'G-001',guideName:'Guide Fiktif',kategori:'Asing',regu:'A1'},{guideId:'bukan',guideName:'x'}],serverTime:new Date().toISOString()}};
    else if(body.operation==='evaluations.submit'){
      if(busy)out={ok:false,code:'SIBUK',error:'x'};
      else{const accepted=[],rejected=[];for(const it of body.payload.items){if(it.guideId==='G-999'){rejected.push({evaluationId:it.evaluationId,errors:['guideId "G-999" tidak ada di tab Guides']});continue;}accepted.push({evaluationId:it.evaluationId,synced:true,duplicate:rows.has(it.evaluationId)});rows.set(it.evaluationId,it);}out={ok:true,data:{accepted,rejected,total:rows.size,serverTime:new Date().toISOString()}};}
    }
    else if(body.operation==='guides.upsert')out=body.payload.guideName.startsWith('Kembar')?{ok:false,code:'KEMBAR',error:'Nama sudah dipakai di regu yang sama.'}:{ok:true,data:{saved:true,created:!body.payload.guideId,guideId:body.payload.guideId||'G-315'}};
    else out={ok:true,data:{operation:body.operation,payload:body.payload}};
    if(url.startsWith('https://')){fakeBridge.pending=out;return new Response(null,{status:302,headers:{location:'https://script.googleusercontent.com/macros/echo?user_content_key=fixture'}});}
    return Response.json(out);
  };
  return {calls,rows,fetchImpl};
}

test('role templates grant visits permissions while IT admin and other modules receive none',t=>{
  const f=fixture(t),codes=user=>new Set(grants(f.db,user).map(g=>g.code));
  assert.equal(codes(f.users.manager).size,9);assert(codes(f.users.manager).has('visits.forms.manage'));
  assert(codes(f.users.leader).has('visits.reports.export'));assert(!codes(f.users.leader).has('visits.guides.manage'));assert(!codes(f.users.leader).has('visits.forms.read'));
  assert(codes(f.users.admin).has('visits.settings.manage'));
  for(const user of [f.users.it,f.users.hr])assert(![...codes(user)].some(c=>c.startsWith('visits.')));
  // Basis data lama: Super Admin menerima izin kunjungan sekali lewat migrasi lokal versi 8.
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
  const audits=all(f.db,"SELECT action,change_summary FROM audit_events WHERE object_type='guide_form_links'").map(a=>a.action);
  assert.deepEqual(audits,['CREATE','COPY_LINK','ROTATE','REVOKE']);
  assert(!JSON.stringify(all(f.db,'SELECT * FROM audit_events')).match(/[a-f0-9]{64}/));
  for(const user of [f.users.leader,f.users.it,f.users.hr]){assert.throws(()=>f.route(user,'links','POST',{action:'create',pos:3}),e=>e.status===403);}
  assert.throws(()=>f.route(f.users.leader,'links'),e=>e.status===403);
});

test('bridge plans enforce visits permissions before any spreadsheet call',t=>{
  const f=fixture(t);
  assert.deepEqual(f.plan(f.users.leader,'overview','GET',{},'from=2026-10-01&to=2026-10-31'),{operation:'overview',payload:{from:'2026-10-01',to:'2026-10-31'}});
  for(const user of [f.users.it,f.users.hr])for(const path of ['overview','guides','records','reviews'])assert.throws(()=>f.plan(user,path),e=>e.status===403);
  assert.throws(()=>f.plan(f.users.leader,'guides','POST',{guideName:'Guide Baru',kategori:'Asing',regu:'A1',aktif:true}),e=>e.status===403);
  const upsert=f.plan(f.users.manager,'guides','POST',{guideName:' Guide Baru ',kategori:'Asing',regu:['A1'],aktif:true});
  assert.deepEqual(upsert.payload,{guideName:'Guide Baru',kategori:'Asing',regu:'A1',aktif:true});
  assert.throws(()=>f.plan(f.users.manager,'guides','POST',{guideName:'X',kategori:'Asing',regu:'Z9',aktif:true}),e=>e.status===422);
  assert.throws(()=>f.plan(f.users.manager,'records','GET',{},'from=2025-01-01&to=2026-10-31'),e=>e.status===422);
  assert.equal(f.plan(f.users.manager,'records','GET',{},'from=2026-10-01&to=2026-10-31&pos=3&status=diganti&limit=1000').payload.limit,1000);
  assert.equal(isVisitBridgeRequest('visits/links','GET'),false);assert.equal(isVisitBridgeRequest('visits/guides','POST'),true);
});

test('guide form admission checks token, pos, shape and both rate limits',t=>{
  const f=fixture(t),link=f.route(f.users.manager,'links','POST',{action:'create',pos:3});
  for(const token of [undefined,'','z'.repeat(64),'b'.repeat(64)])assert.throws(()=>admitGuideForm(f.db,'context',{token}),e=>e.status===404);
  const good=evaluation(3),wrongPos=evaluation(1),bad=evaluation(3,{evaluationId:'bukan-uuid'}),future=evaluation(3,{criteria:{uniform:0,idCard:true}});
  const admitted=admitGuideForm(f.db,'submit',{token:link.token,evaluations:[good,wrongPos,bad,future,good]});
  assert.equal(admitted.items.length,1);assert.equal(admitted.items[0].evaluationId,good.evaluationId);
  assert.equal(admitted.rejected.length,4);assert.match(admitted.rejected[0].errors.join(),/pos tautan \(Pos 3\)/);
  assert.match(admitted.rejected[3].errors.join(),/ganda/);
  assert.throws(()=>admitGuideForm(f.db,'submit',{token:link.token,evaluations:Array.from({length:21},()=>evaluation(3))}),e=>e.status===413);
  assert.deepEqual(checkGuideItem({...good,catatan:'x'.repeat(501)},3),['catatan maksimal 500 huruf']);
  let last;for(let i=0;i<guideFormLimits.context;i++)last=tx(f.db,()=>admitGuideForm(f.db,'context',{token:link.token}));
  assert(last.link);assert.equal(tx(f.db,()=>admitGuideForm(f.db,'context',{token:link.token})).limited,true);
  for(let i=0;i<guideFormLimits.context;i++)assert(tx(f.db,()=>takeGuideFormIpSlot(f.db,'context','203.0.113.9',{})));
  assert.equal(tx(f.db,()=>takeGuideFormIpSlot(f.db,'context','203.0.113.9',{})),false);
  assert(tx(f.db,()=>takeGuideFormIpSlot(f.db,'context','203.0.113.10',{})));
  // Kiriman dihitung per penilaian, bukan per permintaan.
  for(let i=0;i<15;i++)assert(tx(f.db,()=>takeGuideFormIpSlot(f.db,'submit','198.51.100.1',{evaluations:Array(20).fill({})})));
  assert.equal(tx(f.db,()=>takeGuideFormIpSlot(f.db,'submit','198.51.100.1',{evaluations:[{}]})),false);
  assert.throws(()=>takeGuideFormIpSlot(f.db,'context','bukan ip!',{}),e=>e.status===400);
});

test('bridge client follows only the Apps Script redirect and maps bridge codes',async()=>{
  const production=bridgeConfig({VISITS_BRIDGE_URL:'https://script.google.com/macros/s/AKfycbFixtureFixtureFixture01/exec',VISITS_BRIDGE_KEY:bridgeKey});assert(production);
  assert.equal(bridgeConfig({VISITS_BRIDGE_URL:'http://127.0.0.1:4620/exec',VISITS_BRIDGE_KEY:bridgeKey}),null);
  assert(bridgeConfig({VISITS_BRIDGE_URL:'http://127.0.0.1:4620/exec',VISITS_BRIDGE_KEY:bridgeKey},{allowLocal:true}));
  assert.equal(bridgeConfig({VISITS_BRIDGE_URL:'https://evil.example/exec',VISITS_BRIDGE_KEY:bridgeKey}),null);
  assert.equal(bridgeConfig({VISITS_BRIDGE_URL:production.url,VISITS_BRIDGE_KEY:'pendek'}),null);
  assert.equal(bridgeConfig({VISITS_BRIDGE_URL:production.url,VISITS_BRIDGE_KEY:'uji-lokal-'+'x'.repeat(48)}),null);
  const bridge=fakeBridge();
  assert.equal((await callBridge(production,'health',{},{fetchImpl:bridge.fetchImpl})).operation,'health');
  await assert.rejects(callBridge(production,'evaluations.submit',{items:[]},{fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://evil.example/x'}})}),e=>e.status===503);
  await assert.rejects(callBridge({...production,key:'x'.repeat(60)},'health',{},{fetchImpl:bridge.fetchImpl}),e=>e.status===503&&e.details.bridge_code==='KUNCI'&&!/x{10}/.test(e.message));
  await assert.rejects(callBridge(production,'guides.upsert',{guideName:'Kembar'},{fetchImpl:bridge.fetchImpl}),e=>e.status===409);
  await assert.rejects(callBridge(null,'health',{}),e=>e.status===503);
  await assert.rejects(callBridge(production,'health',{},{fetchImpl:async()=>{throw new Error('offline');}}),e=>e.status===503&&e.details.bridge_code==='JARINGAN');
});

const freePort=()=>new Promise(r=>{const probe=createServer().listen(0,'127.0.0.1',()=>{const {port}=probe.address();probe.close(()=>r(port));});});
async function listen(t,f,visitsBridge,bridgeFetch){
  const port=await freePort(),origin=`http://127.0.0.1:${port}`;
  const app=createApp({db:f.db,dataDir:resolve('data','test-visits'),origin,visitsBridge,bridgeFetch});
  await new Promise(r=>app.server.listen(port,'127.0.0.1',r));t.after(()=>app.server.close());return origin;
}
async function server(t,options={}){
  const f=fixture(t),bridge=fakeBridge(options);
  const origin=await listen(t,f,bridgeConfig({VISITS_BRIDGE_URL:'http://127.0.0.1:4620/exec',VISITS_BRIDGE_KEY:bridgeKey},{allowLocal:true}),bridge.fetchImpl);
  const form=(action,body,headers={})=>fetch(`${origin}/api/guide-form/${action}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...headers},body:JSON.stringify(body)});
  async function login(username){const r=await fetch(`${origin}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'fixture123'})});const data=await r.json();return {cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),csrf:data.csrfToken};}
  const api=(session,path,body)=>fetch(`${origin}/api/${path}`,{method:body?'POST':'GET',headers:{Cookie:session.cookie,'X-CSRF-Token':session.csrf,...(body?{'Content-Type':'application/json',Origin:origin}:{})},body:body?JSON.stringify(body):undefined});
  return {...f,bridge,origin,form,login,api};
}

test('public form over HTTP: context, submit, duplicate, local rejection, busy and revoked links',async t=>{
  const s=await server(t),link=s.route(s.users.manager,'links','POST',{action:'create',pos:1});
  assert.equal((await s.form('context',{token:link.token},{Origin:'https://evil.example'})).status,403);
  assert.equal((await fetch(`${s.origin}/api/guide-form/context`,{method:'GET'})).status,404);
  const context=await s.form('context',{token:link.token});assert.equal(context.status,200);
  const data=await context.json();assert.equal(data.pos,1);assert.equal(data.label,'Pos 1 — Pintu Masuk');assert.deepEqual(data.guides.map(g=>g.guideId),['G-001']);
  assert(!JSON.stringify(s.bridge.calls).includes(link.token));
  const page=await fetch(`${s.origin}/penilaian-guide/`);assert.equal(page.status,200);assert.equal(page.headers.get('referrer-policy'),'no-referrer');assert.match(page.headers.get('x-robots-tag'),/noindex/);
  const good=evaluation(1),unknown=evaluation(1,{guideId:'G-999'}),wrong=evaluation(3);
  let r=await s.form('submit',{token:link.token,evaluations:[good,unknown,wrong]});assert.equal(r.status,200);let receipt=await r.json();
  assert.deepEqual(receipt.accepted.map(a=>a.evaluationId),[good.evaluationId]);assert.equal(receipt.rejected.length,2);
  assert.equal(s.bridge.calls.at(-1).payload.pos,1);assert.deepEqual(s.bridge.calls.at(-1).payload.items.map(i=>i.evaluationId),[good.evaluationId,unknown.evaluationId]);
  r=await s.form('submit',{token:link.token,evaluations:[good]});receipt=await r.json();assert.equal(receipt.accepted[0].duplicate,true);
  const log=all(s.db,'SELECT * FROM guide_form_submissions ORDER BY received_at');assert.deepEqual(log.map(l=>l.outcome).sort(),['ACCEPTED','DUPLICATE','REJECTED','REJECTED']);
  assert(log.every(l=>l.ip_hmac===null&&!('guide_id' in l)));assert(!JSON.stringify(log).includes('Guide Fiktif'));
  assert.deepEqual(all(s.db,"SELECT reason FROM guide_form_submissions WHERE outcome='REJECTED' ORDER BY reason").map(r=>r.reason),['GUIDE','POS']);
  assert.equal((await s.form('submit',{token:link.token,evaluations:'x'})).status,400);
  assert.equal((await s.form('submit',{token:link.token,evaluations:[evaluation(1,{catatan:'x'.repeat(30000)})]})).status,413);
  s.route(s.users.manager,'links','POST',{action:'revoke',pos:1,id:link.link.id,row_version:link.link.row_version});
  r=await s.form('submit',{token:link.token,evaluations:[evaluation(1)]});assert.equal(r.status,404);assert.match((await r.json()).error,/Tautan pos tidak aktif/);
});

test('busy spreadsheet answers 503 so phones retry without counting a rejection',async t=>{
  const s=await server(t,{busy:true}),link=s.route(s.users.manager,'links','POST',{action:'create',pos:3});
  const r=await s.form('submit',{token:link.token,evaluations:[evaluation(3)]});assert.equal(r.status,503);assert.match((await r.json()).error,/sibuk/);
  assert.equal(one(s.db,'SELECT count(*) n FROM guide_form_submissions').n,0);
});

test('a slow spreadsheet call does not hold a database transaction',async t=>{
  const s=await server(t,{delay:300}),link=s.route(s.users.manager,'links','POST',{action:'create',pos:1});
  const slow=s.form('submit',{token:link.token,evaluations:[evaluation(1)]});
  await new Promise(r=>setTimeout(r,60));
  const started=Date.now();tx(s.db,()=>insert(s.db,'audit_events',{actor_user_id:null,action:'FIXTURE',object_type:'x',object_key:'x',occurred_at:now(),outcome:'SUCCESS',request_id:crypto.randomUUID(),reason:'',change_summary:'{}'}));
  assert(Date.now()-started<100,'transaksi lain tidak boleh menunggu jembatan');
  assert.equal((await slow).status,200);
});

test('workspace API: dashboard and guide changes go through the bridge with audit; other roles get 403',async t=>{
  const s=await server(t),manager=await s.login('kunjungan'),leader=await s.login('pimpinan'),it=await s.login('itadmin');
  let r=await s.api(manager,'visits/overview?from=2026-10-01&to=2026-10-31');assert.equal(r.status,200);assert.deepEqual((await r.json()).payload,{from:'2026-10-01',to:'2026-10-31'});
  assert.equal((await s.api(it,'visits/overview')).status,403);
  assert.equal((await s.api(leader,'visits/guides',{guideName:'Guide Baru',kategori:'Asing',regu:'A1',aktif:true})).status,403);
  assert.equal((await s.api(leader,'visits/links',{action:'create',pos:1})).status,403);
  r=await s.api(manager,'visits/guides',{guideName:'Guide Baru',kategori:'Asing',regu:'A1',aktif:true});assert.equal(r.status,200);assert.equal((await r.json()).guideId,'G-315');
  r=await s.api(manager,'visits/guides',{guideName:'Kembar Nama',kategori:'Asing',regu:'A1',aktif:true});assert.equal(r.status,409);
  const audit=one(s.db,"SELECT * FROM audit_events WHERE object_type='visit_guides'");assert.equal(audit.action,'CREATE');assert.equal(audit.object_key,'G-315');
  r=await s.api(manager,'visits/links',{action:'create',pos:3});assert.equal(r.status,201);
  r=await s.api(leader,'visits/exports',{kind:'records',from:'2026-10-01',to:'2026-10-31',rows:12});assert.equal(r.status,201);
  assert.equal(one(s.db,"SELECT count(*) n FROM audit_events WHERE action='EXPORT' AND object_type='visit_records'").n,1);
});

// Uji ujung-ke-ujung dengan kode Apps Script NilaiGuide asli. Berjalan bila
// NILAIGUIDE_DIR menunjuk ke checkout branch claude/jembatan-portal.
const nilaiguide=process.env.NILAIGUIDE_DIR;
test('end-to-end with the real NilaiGuide bridge code',{skip:!(nilaiguide&&existsSync(resolve(nilaiguide,'server-gas','13_Jembatan.gs')))&&'set NILAIGUIDE_DIR untuk uji ujung-ke-ujung'},async t=>{
  const {startBridgeSimulator}=await import('../scripts/visits-bridge-dev.mjs');
  const sim=await startBridgeSimulator({nilaiguideDir:nilaiguide,port:0,stateFile:null,seedDays:0,log:null});t.after(()=>sim.close());
  const f=fixture(t),config=bridgeConfig({VISITS_BRIDGE_URL:sim.url,VISITS_BRIDGE_KEY:sim.key},{allowLocal:true});
  const origin=await listen(t,f,config);
  const link=f.route(f.users.manager,'links','POST',{action:'create',pos:1});
  const form=(action,body)=>fetch(`${origin}/api/guide-form/${action}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)}).then(async r=>({status:r.status,data:await r.json()}));
  const context=await form('context',{token:link.token});assert.equal(context.status,200);assert(context.data.guides.length>30);
  const a=evaluation(1,{timestamp:iso(-120)}),near=evaluation(1,{timestamp:iso(-110)}),formula=evaluation(1,{guideId:'G-002',catatan:'=IMPORTDATA("x")'});
  let r=await form('submit',{token:link.token,evaluations:[a,near,formula]});
  assert.deepEqual(r.data.accepted.map(x=>x.evaluationId).sort(),[a.evaluationId,formula.evaluationId].sort());
  assert.equal(r.data.rejected[0].terlaluCepat,true);
  const fix=evaluation(1,{timestamp:a.timestamp,koreksiDari:a.evaluationId,criteria:{uniform:-1,idCard:false,etika:-2}});
  r=await form('submit',{token:link.token,evaluations:[fix]});assert.equal(r.data.accepted.length,1);
  const sheet=sim.doc.getSheetByName('Evaluations').data;
  assert.equal(sheet.find(x=>x[0]===a.evaluationId)[12],'diganti');assert.equal(sheet.find(x=>x[0]===formula.evaluationId)[9],'\'=IMPORTDATA("x")');
  assert.equal(one(f.db,"SELECT count(*) n FROM guide_form_submissions WHERE outcome='REJECTED' AND reason='JEDA'").n,1);
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
    for(const banned of ['guides.json','script.google','config.js','APP_CONFIG','eval('])assert(!text.includes(banned),`${file} memuat ${banned}`);
    assert(!/[a-f0-9]{64}/.test(text),`${file} memuat token`);
  }
  const sw=readFileSync(resolve(root,'sw.js'),'utf8');assert.match(sw,/url\.pathname\.startsWith\('\/api\/'\)/);
  const headers=readFileSync(resolve('site-info','dist','_headers'),'utf8'),block=headers.split(/\n\n/).find(b=>b.startsWith('/penilaian-guide/*'));
  assert(block&&/no-store/.test(block)&&/noindex/.test(block)&&/no-referrer/.test(block));
});
