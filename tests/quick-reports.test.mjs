import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {resolve,sep} from 'node:path';
import {openDb,insert,one,all,run,tx,now,get} from '../lib/db.mjs';
import {seedPermissions,hashPasswordSync} from '../lib/auth.mjs';
import {quickReportManagement,publicQuickReport,takeQuickReportSlot} from '../lib/quick-reports.mjs';
import {securityRoutes} from '../lib/security.mjs';
import {fileAllowed} from '../lib/files.mjs';
import {handleQuickReport} from '../site-info/lib/quick-report.mjs';
import {createApp} from '../server.mjs';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX5kAAAAASUVORK5CYII=';
const hash=hashPasswordSync('TestPassword!2026');
function fixture(t){
 const db=openDb(':memory:'),directory=mkdtempSync(resolve(tmpdir(),'besakih-quick-'));
 t.after(()=>{db.close();assert(directory.startsWith(resolve(tmpdir())+sep)&&directory.split(sep).at(-1).startsWith('besakih-quick-'));rmSync(directory,{recursive:true,force:true});});seedPermissions(db);
 const unit=insert(db,'org_units',{code:'SEC',name:'Keamanan',is_active:1}),otherUnit=insert(db,'org_units',{code:'OTHER',name:'Unit lain',is_active:1});
 const positions=['Staf Keamanan Wilayah I','THL Bankamda','Staf Kebersihan','Staf Keamanan Wilayah II'].map((name,i)=>insert(db,'positions',{code:`POS${i}`,name,org_unit_id:i===3?otherUnit.id:unit.id,is_active:1}));
 const people=positions.map((p,i)=>{const employee=insert(db,'employees',{employee_no:`E${i}`,full_name:i===1?'I Made Petugas':'Petugas '+i,employment_status:'Tetap',joined_on:'2020-01-01',is_active:1});insert(db,'employee_placements',{employee_id:employee.id,position_id:p.id,valid_from:'2020-01-01',is_primary:1});return employee;});
 const account=(name,role,employee=null,scope='ALL')=>{const user=insert(db,'users',{username:name,password_hash:hash,status:'ACTIVE',employee_id:employee?.id||null,must_change_password:0,failed_login_count:0,password_changed_at:now()});if(role)insert(db,'user_roles',{user_id:user.id,role_id:one(db,'SELECT id FROM roles WHERE code=?',role).id,scope_kind:scope});return user;};
 return {db,directory,unit,otherUnit,positions,people,account,admin:account('admin','SUPER_ADMIN'),coordinator:account('coordinator','COORDINATOR'),officer:account('officer','OFFICER',people[0],'SELF')};
}
const manage=(f,user=f.admin,method='GET',body={},path='report-links')=>quickReportManagement({db:f.db,user,p:path.split('/'),method,body});
const link=f=>manage(f,f.admin,'POST',{position_ids:f.positions.slice(0,2).map(p=>p.id)});
const payload=(f,token,extra={})=>({token,employee_id:f.people[0].id,activity_type:'PATROLI',activity_notes:'Memeriksa area parkir.',idempotency_key:crypto.randomUUID(),location:{latitude:-8.37,longitude:115.45,accuracy:12,captured_at:now()},photos:[{data:png,mime_type:'image/png',source:'CAMERA',captured_at:now()}],...extra});
const submit=(f,b)=>tx(f.db,()=>publicQuickReport(f.db,'submit',b,f.directory,'fixture-request'));

test('shared report links require scoped management and expose only selected active security names',t=>{
 const f=fixture(t);assert.throws(()=>manage(f,f.officer),e=>e.status===403);
 assert.equal(manage(f).positions.some(p=>p.id===f.positions[2].id),false);
 assert.throws(()=>manage(f,f.admin,'POST',{position_ids:[f.positions[2].id]}),e=>e.status===422);
 const created=link(f);assert.match(created.token,/^[a-f0-9]{64}$/);assert.notEqual(get(f.db,'quick_report_links',created.id).token_hash,created.token);
 assert.equal('token' in manage(f).link,false);assert.equal('token_hash' in manage(f).link,false);
 const context=publicQuickReport(f.db,'context',{token:created.token});assert.deepEqual(context.employees.map(e=>e.id).sort(),f.people.slice(0,2).map(e=>e.id).sort());
 assert.deepEqual(Object.keys(context.employees[0]).sort(),['full_name','id','position_name']);
 run(f.db,'UPDATE employees SET is_active=0 WHERE id=?',f.people[1].id);assert.equal(publicQuickReport(f.db,'context',{token:created.token}).employees.length,1);
 const scoped=f.account('scoped','COORDINATOR',null,'ASSIGNED_UNITS'),grant=one(f.db,'SELECT id FROM user_roles WHERE user_id=?',scoped.id);run(f.db,'INSERT INTO user_role_units(user_role_id,org_unit_id,include_descendants) VALUES(?,?,?)',grant.id,f.otherUnit.id,0);
 assert.equal(manage(f,scoped).can_manage_active,false);assert.throws(()=>manage(f,scoped,'POST',{position_ids:[f.positions[3].id],active_link_id:created.id,row_version:1}),e=>e.status===403);
});
test('public submissions create the same private logbook with self-reported identity, private photos and audit',async t=>{
 const f=fixture(t),created=link(f),receipt=submit(f,payload(f,created.token));assert.match(receipt.reference,/^LB-/);assert.deepEqual(Object.keys(receipt).sort(),['received_at','reference']);
 const report=one(f.db,'SELECT * FROM logbook_entries');assert.equal(report.employee_id,f.people[0].id);assert.equal(report.created_by,null);assert.equal(report.report_source,'PUBLIC_LINK');assert.equal(report.report_link_id,created.id);assert.equal(report.reporting_org_unit_id,f.unit.id);
 const file=one(f.db,'SELECT * FROM files');assert.equal(file.uploaded_by,null);assert.equal(one(f.db,'SELECT file_id FROM logbook_files').file_id,file.id);assert.equal(fileAllowed(f.db,f.officer,file.id),true);
 const audit=one(f.db,"SELECT * FROM audit_events WHERE action='PUBLIC_SUBMISSION'");assert.equal(audit.actor_user_id,null);assert.equal(JSON.parse(audit.change_summary).identity,'SELF_REPORTED');assert(!JSON.stringify(all(f.db,'SELECT * FROM audit_events')).includes(created.token));
 const detail=await securityRoutes({db:f.db,user:f.officer,p:['logbook',report.id],method:'GET',body:{}});assert.equal(detail.report_source,'PUBLIC_LINK');assert.equal(detail.files.length,1);
});
test('retrying a public report returns the same receipt without repeating photo uploads',t=>{
 const f=fixture(t),created=link(f),body=payload(f,created.token),first=submit(f,body);t.mock.method(Date,'now',()=>new Date().getTime()+20*60000);
 assert.deepEqual(submit(f,body),first);assert.equal(one(f.db,'SELECT count(*) n FROM logbook_entries').n,1);assert.equal(one(f.db,'SELECT count(*) n FROM files').n,1);
 assert.throws(()=>submit(f,{...body,activity_notes:'Catatan berbeda.'}),e=>e.status===409);
});
test('public reports reject unrelated or inactive employees, missing evidence, stale evidence and invalid photos before upload',t=>{
 const f=fixture(t),created=link(f),body=payload(f,created.token);
 for(const changes of [{employee_id:f.people[2].id},{employee_id:f.people[3].id},{photos:[]},{location:null},{location:{...body.location,latitude:999}},{photos:[{...body.photos[0],source:'GALLERY'}]},{photos:[{...body.photos[0],data:'aGVsbG8='}]},{photos:[body.photos[0],body.photos[0]]},{location:{...body.location,captured_at:'2020-01-01T00:00:00Z'}},{photos:[{...body.photos[0],captured_at:'2020-01-01T00:00:00Z'}]},{website:'bot'}])assert.throws(()=>submit(f,{...body,...changes}),e=>e.status===422);
 run(f.db,'UPDATE employees SET is_active=0 WHERE id=?',f.people[0].id);assert.throws(()=>submit(f,body),e=>e.status===422);
 assert.equal(one(f.db,'SELECT count(*) n FROM logbook_entries').n,0);assert.equal(one(f.db,'SELECT count(*) n FROM files').n,0);
});
test('link rotation, stale management requests, revocation and lost owner access invalidate shared access',t=>{
 const f=fixture(t),created=link(f);assert.throws(()=>link(f),e=>e.status===409);
 const rotated=manage(f,f.admin,'POST',{position_ids:[f.positions[0].id],active_link_id:created.id,row_version:created.row_version});
 assert.throws(()=>publicQuickReport(f.db,'context',{token:created.token}),e=>e.status===404);assert.equal(publicQuickReport(f.db,'context',{token:rotated.token}).employees.length,1);
 assert.throws(()=>manage(f,f.admin,'POST',{row_version:0},`report-links/${rotated.id}/revoke`),e=>e.status===409);
 manage(f,f.admin,'POST',{row_version:rotated.row_version},`report-links/${rotated.id}/revoke`);assert.throws(()=>submit(f,payload(f,rotated.token)),e=>e.status===404);
 const next=link(f);run(f.db,"UPDATE users SET status='INACTIVE' WHERE id=?",f.admin.id);assert.throws(()=>publicQuickReport(f.db,'context',{token:next.token}),e=>e.status===403);
});
test('failed public database work rolls back logbook, photo metadata and audit together',t=>{
 const f=fixture(t),created=link(f);f.db.exec("CREATE TRIGGER reject_quick_test BEFORE INSERT ON logbook_entries BEGIN SELECT RAISE(ABORT,'fixture rejection'); END");
 assert.throws(()=>submit(f,payload(f,created.token)),/fixture rejection/);assert.equal(one(f.db,'SELECT count(*) n FROM files').n,0);assert.equal(one(f.db,"SELECT count(*) n FROM audit_events WHERE action IN ('UPLOAD','PUBLIC_SUBMISSION')").n,0);
});
test('rate limits count failed attempts, separate read and submission quotas and reset after ten minutes',t=>{
 const f=fixture(t);for(let i=0;i<30;i++)assert.equal(tx(f.db,()=>takeQuickReportSlot(f.db,'192.0.2.15','submit')),true);
 assert.equal(tx(f.db,()=>takeQuickReportSlot(f.db,'192.0.2.15','submit')),false);assert.equal(tx(f.db,()=>takeQuickReportSlot(f.db,'192.0.2.15','context')),true);
 assert.equal(tx(f.db,()=>takeQuickReportSlot(f.db,'192.0.2.16','submit')),true);run(f.db,'UPDATE quick_report_rate_limits SET window_start=?','2020-01-01T00:00:00Z');assert.equal(tx(f.db,()=>takeQuickReportSlot(f.db,'192.0.2.15','submit')),true);
});

const bridgeEnv={PORTAL_ORIGIN:'https://portal.test',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_fixture'};
const bridgeRequest=(action='context',body={token:'a'.repeat(64)},extra={})=>new Request(`https://portal.test/api/quick-report/${action}`,{method:'POST',headers:{Origin:'https://portal.test','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1',...extra.headers},body:JSON.stringify(body),...Object.fromEntries(Object.entries(extra).filter(([key])=>key!=='headers'))});
test('public bridge keeps backend authentication private and returns only public context or a receipt',async()=>{
 const calls=[];const transport=async(url,init)=>{calls.push({url,init});return Response.json({ok:true,result:{label:'Laporan',token_hash:'private',employees:[{id:'e',full_name:'Nama',position_name:'Keamanan',phone:'private'}]}});};
 const response=await handleQuickReport(bridgeRequest(),bridgeEnv,transport);assert.equal(response.status,200);assert.deepEqual(await response.json(),{label:'Laporan',employees:[{id:'e',full_name:'Nama',position_name:'Keamanan'}]});
 assert.equal(calls[0].url,'https://fixture.supabase.co/functions/v1/portal-api');assert.equal(calls[0].init.headers.apikey,bridgeEnv.SUPABASE_SECRET_KEY);assert.equal(calls[0].init.headers['x-region'],'ap-southeast-1');assert.equal(calls[0].init.redirect,'manual');
 assert.equal(JSON.parse(calls[0].init.body).client_ip,'192.0.2.1');assert.equal(JSON.parse(calls[0].init.body).action,'quick-report');assert.equal(response.headers.get('cache-control'),'no-store');
});
test('public bridge rejects cross-origin requests, missing ingress IP, invalid links and oversized bodies before forwarding',async()=>{
 let calls=0;const transport=async()=>{calls++;throw new Error('should not forward');};
 for(const [request,status] of [[bridgeRequest('context',{},{}),404],[bridgeRequest('context',{token:'a'.repeat(64)},{headers:{Origin:'https://foreign.test'}}),403],[bridgeRequest('context',{token:'a'.repeat(64)},{headers:{'Sec-Fetch-Site':'cross-site'}}),403],[bridgeRequest('context',{token:'a'.repeat(64)},{headers:{'CF-Connecting-IP':''}}),400],[bridgeRequest('context',{token:'a'.repeat(64),large:'a'.repeat(5000)}),413]])assert.equal((await handleQuickReport(request,bridgeEnv,transport)).status,status);
 assert.equal(calls,0);
});
test('public bridge failures do not expose upstream bodies and a receipt cannot leak private rows',async()=>{
 let response=await handleQuickReport(bridgeRequest(),bridgeEnv,async()=>new Response('secret fixture',{status:503}));assert.equal(response.status,503);assert(!(await response.text()).includes('secret fixture'));
 response=await handleQuickReport(bridgeRequest('submit'),bridgeEnv,async()=>Response.json({ok:true,result:{reference:'LB-TEST',received_at:now(),employee_id:'private'}}));assert.deepEqual(Object.keys(await response.json()).sort(),['received_at','reference']);
});
test('HTTP public form and submission work without a portal session while private APIs still require login',async t=>{
 const f=fixture(t),created=link(f),origin='https://portal.test',app=createApp({db:f.db,dataDir:f.directory,origin});await new Promise(done=>app.server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>app.server.close(done)));
 const base=`http://127.0.0.1:${app.server.address().port}`,headers={Origin:origin,'Content-Type':'application/json'};
 let response=await fetch(base+'/laporan-cepat/');assert.equal(response.status,200);assert((await response.text()).includes('Laporan cepat'));
 response=await fetch(base+'/api/quick-report/context',{method:'POST',headers,body:JSON.stringify({token:created.token})});assert.equal(response.status,200);
 response=await fetch(base+'/api/quick-report/submit',{method:'POST',headers,body:JSON.stringify(payload(f,created.token))});assert.equal(response.status,200);
 response=await fetch(base+'/api/logbook');assert.equal(response.status,401);response=await fetch(base+'/api/files/'+one(f.db,'SELECT id FROM files').id);assert.equal(response.status,401);
 response=await fetch(base+'/api/quick-report/context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:created.token})});assert.equal(response.status,403);
});

test('legacy logbook migration preserves old reports and marks their source as portal',t=>{
 const directory=mkdtempSync(resolve(tmpdir(),'besakih-quick-migration-')),path=resolve(directory,'legacy.sqlite');
 t.after(()=>{assert(directory.startsWith(resolve(tmpdir())+sep)&&directory.split(sep).at(-1).startsWith('besakih-quick-'));rmSync(directory,{recursive:true,force:true});});
 let schema=readFileSync(new URL('../schema.sql',import.meta.url),'utf8');
 schema=schema.replace(/CREATE TABLE IF NOT EXISTS quick_report_links \([\s\S]*?;\r?\n/,'').replace(/CREATE UNIQUE INDEX IF NOT EXISTS quick_report_one_active[^;]+;\r?\n/,'').replace(/CREATE TABLE IF NOT EXISTS quick_report_rate_limits \([\s\S]*?;\r?\n/,'').replace(", report_source TEXT NOT NULL DEFAULT 'PORTAL' CHECK(report_source IN('PORTAL','PUBLIC_LINK')), report_link_id TEXT REFERENCES quick_report_links(id)",'');
 const legacy=new DatabaseSync(path);legacy.exec(schema);
 const employee=insert(legacy,'employees',{employee_no:'LEGACY',full_name:'Petugas lama',employment_status:'Tetap',joined_on:'2020-01-01',is_active:1});
 const report=insert(legacy,'logbook_entries',{employee_id:employee.id,activity_type:'PATROLI',activity_notes:'Catatan historis',occurred_at:now()});
 legacy.exec("INSERT OR IGNORE INTO schema_migrations VALUES(3,'2020-01-01');INSERT OR IGNORE INTO schema_migrations VALUES(4,'2020-01-01');");legacy.close();
 const db=openDb(path);try{assert.equal(get(db,'logbook_entries',report.id).activity_notes,'Catatan historis');assert.equal(get(db,'logbook_entries',report.id).report_source,'PORTAL');assert.equal(get(db,'logbook_entries',report.id).report_link_id,null);assert.equal(one(db,'SELECT count(*) n FROM quick_report_links').n,0);assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);}finally{db.close();}
});
