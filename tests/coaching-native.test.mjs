import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,sep} from 'node:path';
import {openDb,insert,one,all,run,tx,now} from '../lib/db.mjs';
import {seedPermissions,digest,hashPasswordSync} from '../lib/auth.mjs';
import {fileAllowed} from '../lib/files.mjs';
import {hrRoutes} from '../lib/hr.mjs';
import {publicCoachingLink,takeCoachingLinkSlot} from '../lib/coaching-links.mjs';
import {handleCoachingLink} from '../site-info/lib/coaching-link.mjs';
import {createApp} from '../server.mjs';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX5kAAAAASUVORK5CYII=',token='a'.repeat(64),password=hashPasswordSync('fixture123');
function fixture(t){
 const db=openDb(':memory:'),directory=mkdtempSync(resolve(tmpdir(),'besakih-coaching-'));
 t.after(()=>{db.close();assert(directory.startsWith(resolve(tmpdir())+sep)&&directory.split(sep).at(-1).startsWith('besakih-coaching-'));rmSync(directory,{recursive:true,force:true});});seedPermissions(db);
 const unit=insert(db,'org_units',{code:'HR',name:'Unit contoh',is_active:1}),position=insert(db,'positions',{code:'HR',name:'Staf contoh',org_unit_id:unit.id,is_active:1});
 const employees=['Karyawan Contoh','Coach Contoh','Karyawan Lain'].map((full_name,i)=>{const e=insert(db,'employees',{full_name,employee_no:`PRIVATE${i}`,employment_status:'Tetap',joined_on:'2020-01-01',is_active:1});insert(db,'employee_placements',{employee_id:e.id,position_id:position.id,is_primary:1,valid_from:'2020-01-01'});return e;});
 const link=insert(db,'coaching_links',{token_hash:digest(token),label:'Formulir Coaching',is_active:1,created_by:null});
 const account=(username,employee_id)=>{const u=insert(db,'users',{username,password_hash:password,status:'ACTIVE',employee_id,must_change_password:0,failed_login_count:0,password_changed_at:now()});insert(db,'user_roles',{user_id:u.id,role_id:one(db,"SELECT id FROM roles WHERE code='EMPLOYEE'").id,scope_kind:'SELF'});return u;};
 return {db,directory,unit,position,employees,link,account};
}
const payload=(f,extra={})=>({token,employee_id:f.employees[0].id,coach_employee_id:f.employees[1].id,department:'SEKRETARIAT',section:'Sumber Daya Manusia',held_on:'2026-10-23',due_on:'2026-10-30',topic:'Kinerja',constraints_notes:'Kendala contoh.',guidance_notes:'Arahan contoh.',agreement_notes:'Tindakan contoh.',photo:{mime_type:'image/png',data:png},idempotency_key:crypto.randomUUID(),...extra});
const submit=(f,b)=>tx(f.db,()=>publicCoachingLink(f.db,'submit',b,f.directory,'fixture_request'));

test('native context requires the private link and exposes searchable names without employee numbers',t=>{
 const f=fixture(t);for(const supplied of ['',null,'f'.repeat(64)])assert.throws(()=>publicCoachingLink(f.db,'context',{token:supplied}),e=>e.status===404);
 const context=publicCoachingLink(f.db,'context',{token});assert.equal(context.employees.length,3);assert.equal(context.employees[0].employee_no,undefined);assert(!JSON.stringify(context).includes('PRIVATE'));
 insert(f.db,'employees',{full_name:f.employees[0].full_name,employee_no:'DUPLICATE',employment_status:'Tetap',joined_on:'2020-01-01',is_active:1});
 const duplicate=one(f.db,"SELECT id FROM employees WHERE employee_no='DUPLICATE'");insert(f.db,'employee_placements',{employee_id:duplicate.id,position_id:f.position.id,is_primary:1,valid_from:'2020-01-01'});
 const choices=publicCoachingLink(f.db,'context',{token}).employees.filter(e=>e.full_name===f.employees[0].full_name);assert.equal(choices.length,1);assert.equal(choices[0].disabled,true);assert.equal(choices[0].id,'');
 assert.throws(()=>submit(f,payload(f)),e=>e.status===422);assert.equal(one(f.db,'SELECT count(*) n FROM files').n,0);
});

test('native submission creates the portal session, action and private photo atomically with self-reported provenance',async t=>{
 const f=fixture(t),result=submit(f,payload(f));assert.match(result.reference,/^CH-/);assert.deepEqual(Object.keys(result).sort(),['received_at','reference']);
 const session=one(f.db,'SELECT * FROM coaching_sessions'),file=one(f.db,'SELECT * FROM files'),source=one(f.db,'SELECT * FROM coaching_form_submissions');
 assert.equal(session.employee_id,f.employees[0].id);assert.equal(session.coach_employee_id,f.employees[1].id);assert.equal(session.created_by,null);assert.equal(session.held_at,'2026-10-22T16:00:00.000Z');assert.equal(source.form_id,`NATIVE_LINK:${f.link.id}`);
 assert.equal(one(f.db,'SELECT * FROM coaching_actions').due_on,'2026-10-30');assert.equal(one(f.db,'SELECT * FROM coaching_files').file_id,file.id);assert.equal(file.uploaded_by,null);
 const employee=f.account('employee',f.employees[0].id),coach=f.account('coach',f.employees[1].id),outsider=f.account('outsider',f.employees[2].id);
 assert(fileAllowed(f.db,employee,file.id));assert(fileAllowed(f.db,coach,file.id));assert(!fileAllowed(f.db,outsider,file.id));
 const detail=await hrRoutes({db:f.db,user:employee,p:['coaching',session.id],method:'GET',body:{}});assert.equal(detail.files.length,1);assert.equal(detail.held_date_only,true);
 const audit=one(f.db,"SELECT * FROM audit_events WHERE action='PUBLIC_COACHING_SUBMISSION'");assert.equal(audit.actor_user_id,null);assert.equal(JSON.parse(audit.change_summary).identity,'SELF_REPORTED');assert(!JSON.stringify(all(f.db,'SELECT * FROM audit_events')).includes(token));
});

test('uncertain native receipt retries preserve exactly one session, photo and action',t=>{
 const f=fixture(t),b=payload(f),first=submit(f,b);assert.deepEqual(submit(f,b),first);
 for(const table of ['coaching_sessions','coaching_actions','coaching_files','coaching_form_submissions','files'])assert.equal(one(f.db,`SELECT count(*) n FROM ${table}`).n,1);
 assert.throws(()=>submit(f,{...b,agreement_notes:'Changed'}),e=>e.status===409);assert.equal(one(f.db,'SELECT count(*) n FROM files').n,1);
 run(f.db,'UPDATE coaching_links SET is_active=0 WHERE id=?',f.link.id);assert.throws(()=>submit(f,b),e=>e.status===404);
});

test('invalid identities, dates, evidence and historical placement fail before upload',t=>{
 const f=fixture(t),b=payload(f);
 for(const extra of [{employee_id:'unknown'},{coach_employee_id:'unknown'},{coach_employee_id:b.employee_id},{held_on:'2026-02-30'},{due_on:'2026-10-22'},{topic:'Unknown'},{photo:null},{photo:{mime_type:'image/png',data:'aGVsbG8='}},{photo:{mime_type:'image/png',data:png+'='}},{guidance_notes:'x'.repeat(10001)},{held_on:'2019-01-01'},{website:'bot'}])assert.throws(()=>submit(f,{...b,...extra}),e=>e.status===422);
 run(f.db,'UPDATE employees SET is_active=0 WHERE id=?',f.employees[0].id);assert.throws(()=>submit(f,b),e=>e.status===422);
 assert.equal(one(f.db,'SELECT count(*) n FROM files').n,0);assert.equal(one(f.db,'SELECT count(*) n FROM coaching_sessions').n,0);
});

test('failed native database work rolls back coaching, evidence, provenance and audit',t=>{
 const f=fixture(t);f.db.exec("CREATE TRIGGER fixture_reject_coaching BEFORE INSERT ON coaching_actions BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
 assert.throws(()=>submit(f,payload(f)),/fixture failure/);
 for(const table of ['coaching_sessions','coaching_actions','coaching_files','coaching_form_submissions','files','audit_events'])assert.equal(one(f.db,`SELECT count(*) n FROM ${table}`).n,0);
});

test('coaching rate slots include invalid attempts and remain separate from patrol slots',t=>{
 const f=fixture(t);for(let i=0;i<30;i++)assert(tx(f.db,()=>takeCoachingLinkSlot(f.db,'127.0.0.1','submit')));assert.equal(tx(f.db,()=>takeCoachingLinkSlot(f.db,'127.0.0.1','submit')),false);
 assert(tx(f.db,()=>takeCoachingLinkSlot(f.db,'127.0.0.1','context')));assert.throws(()=>takeCoachingLinkSlot(f.db,'127.0.0.1','read'),e=>e.status===404);
});

test('Cloudflare coaching bridge enforces origin, server auth and a small response surface',async()=>{
 const env={PORTAL_ORIGIN:'https://bpbesakih.com',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'fixture-secret'},calls=[];
 const req=(action,body,headers={})=>new Request(`https://bpbesakih.com/api/coaching-link/${action}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:env.PORTAL_ORIGIN,'CF-Connecting-IP':'127.0.0.1',...headers},body:JSON.stringify(body)});
 const transport=async(url,init)=>{calls.push({url,init});return Response.json({ok:true,result:{label:'Coaching',today:'2026-10-23',employees:[{id:'employee',full_name:'Nama',position_name:'Unit',employee_no:'PRIVATE'}],secret:'PRIVATE'}});};
 const response=await handleCoachingLink(req('context',{token}),env,transport);assert.equal(response.status,200);const context=await response.json();assert(!JSON.stringify(context).includes('PRIVATE'));assert.equal(calls[0].url,'https://fixture.supabase.co/functions/v1/coaching-native');assert.equal(calls[0].init.headers.apikey,'fixture-secret');assert.equal(calls[0].init.headers['x-region'],'ap-southeast-1');assert.equal(calls[0].init.redirect,'manual');
 assert.equal((await handleCoachingLink(req('context',{token},{Origin:'https://evil.example'}),env,transport)).status,403);assert.equal((await handleCoachingLink(req('context',{token:'bad'}),env,transport)).status,404);assert.equal((await handleCoachingLink(req('read',{token}),env,transport)).status,404);assert.equal(calls.length,1);
});

test('native HTTP form submits without a portal account and requires the same origin',async t=>{
 const f=fixture(t),origin='https://portal.test',app=createApp({db:f.db,dataDir:f.directory,origin});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>app.server.close(resolve)));
 const url=`http://127.0.0.1:${app.server.address().port}`,post=body=>fetch(url+'/api/coaching-link/submit',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await fetch(url+'/coaching/')).status,200);assert.equal((await fetch(url+'/api/coaching-link/context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})})).status,403);
 const response=await post(payload(f));assert.equal(response.status,200);assert.match((await response.json()).reference,/^CH-/);
});
