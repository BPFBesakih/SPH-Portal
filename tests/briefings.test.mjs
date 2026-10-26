import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,sep} from 'node:path';
import {openDb,insert,one,all,run,tx,now,today} from '../lib/db.mjs';
import {seedPermissions,digest,hashPasswordSync} from '../lib/auth.mjs';
import {fileAllowed} from '../lib/files.mjs';
import {briefingRoutes,publicBriefingLink,takeBriefingLinkSlot} from '../lib/briefings.mjs';
import {takeCoachingLinkSlot} from '../lib/coaching-links.mjs';
import {handleBriefingLink} from '../site-info/lib/briefing-link.mjs';
import {createApp} from '../server.mjs';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX5kAAAAASUVORK5CYII=',token='a'.repeat(64),password=hashPasswordSync('fixture123');
function fixture(t){
  const db=openDb(':memory:'),directory=mkdtempSync(resolve(tmpdir(),'besakih-briefing-'));t.after(()=>{db.close();assert(directory.startsWith(resolve(tmpdir())+sep)&&directory.split(sep).at(-1).startsWith('besakih-briefing-'));rmSync(directory,{recursive:true,force:true});});seedPermissions(db);
  const units=['Operasional','Sekretariat'].map((name,i)=>insert(db,'org_units',{code:`U${i}`,name,is_active:1}));
  const positions=units.map((u,i)=>insert(db,'positions',{code:`P${i}`,name:`Staf ${u.name}`,org_unit_id:u.id,is_active:1}));
  const employees=['Pemberi Contoh','Rekan Satu Bidang','Pegawai Bidang Lain'].map((full_name,i)=>{const e=insert(db,'employees',{full_name,employee_no:`PRIVATE${i}`,employment_status:'Tetap',joined_on:'2020-01-01',is_active:1});insert(db,'employee_placements',{employee_id:e.id,position_id:positions[i===2?1:0].id,is_primary:1,valid_from:'2020-01-01'});return e;});
  const link=insert(db,'briefing_links',{token_hash:digest(token),share_token:token,label:'Briefing Pagi',is_active:1,created_by:null});
  const account=(username,employee_id=null,role=null,scope_kind='ALL')=>{const u=insert(db,'users',{username,password_hash:password,status:'ACTIVE',employee_id,must_change_password:0,failed_login_count:0,password_changed_at:now()});if(role)u.grant=insert(db,'user_roles',{user_id:u.id,role_id:one(db,'SELECT id FROM roles WHERE code=?',role).id,scope_kind});return u;};
  const route=(user,path='',method='GET',body={},query='')=>briefingRoutes({db,user,p:['briefings',...path.split('/').filter(Boolean)],method,body,url:new URL('https://portal.test/?'+query)});
  return {db,directory,units,positions,employees,link,account,route};
}
const payload=(f,extra={})=>({token,employee_id:f.employees[0].id,org_unit_id:f.units[0].id,section:'Pelayanan',held_on:today(),absent_notes:'Nihil',briefing_notes:'Arahan pelayanan hari ini.',photo:{data:png,mime_type:'image/png',captured_at:now(),source:'CAMERA'},idempotency_key:crypto.randomUUID(),...extra});
const submit=(f,body)=>tx(f.db,()=>publicBriefingLink(f.db,'submit',body,f.directory,'fixture-request'));

test('briefing context requires a link and supplies active dated placements without employee numbers or records',t=>{
  const f=fixture(t);for(const token of ['',null,'b'.repeat(64)])assert.throws(()=>publicBriefingLink(f.db,'context',{token}),e=>e.status===404);
  const data=publicBriefingLink(f.db,'context',{token});assert.equal(data.employees.length,3);assert(!JSON.stringify(data).includes('PRIVATE'));assert.equal(data.items,undefined);
  const e=f.employees[0];insert(f.db,'employee_placements',{employee_id:e.id,position_id:f.positions[0].id,is_primary:1,valid_from:'2020-01-01'});
  assert(publicBriefingLink(f.db,'context',{token}).employees.filter(x=>x.full_name===e.full_name).every(x=>x.disabled&&x.id===''));
  assert.throws(()=>submit(f,payload(f)),e=>e.status===422);
});
test('any linked employee can read their own unit while lists, filters, details and photos deny another unit',t=>{
  const f=fixture(t),body=payload(f);submit(f,body);submit(f,payload(f,{employee_id:f.employees[2].id,org_unit_id:f.units[1].id}));
  const colleague=f.account('colleague',f.employees[1].id),other=f.account('other',f.employees[2].id),unlinked=f.account('unlinked'),manager=f.account('manager',null,'SDM');
  const rows=all(f.db,'SELECT * FROM morning_briefings'),own=rows.find(r=>r.org_unit_id===f.units[0].id),file=one(f.db,'SELECT * FROM briefing_files WHERE briefing_id=?',own.id);
  assert.equal(f.route(colleague).items.length,1);assert.equal(f.route(other).items.length,1);assert.equal(f.route(manager).items.length,2);assert.equal(f.route(unlinked).items.length,0);
  assert.equal(f.route(colleague,'','GET',{},`unit=${f.units[1].id}`).items.length,0);assert.equal(f.route(colleague).units.length,1);assert.equal(f.route(unlinked).needs_placement,true);
  assert.throws(()=>f.route(other,own.id),e=>e.status===403);assert(fileAllowed(f.db,colleague,file.file_id));assert(!fileAllowed(f.db,other,file.file_id));assert(!fileAllowed(f.db,unlinked,file.file_id));assert(fileAllowed(f.db,manager,file.file_id));
  const data=f.route(colleague,own.id);assert.equal(data.files.length,1);for(const key of ['payload_hash','link_id','response_id','token','share_token'])assert.equal(data[key],undefined);
  assert(!JSON.stringify(f.route(manager)).includes(token));assert.throws(()=>f.route(colleague,own.id,'PATCH',{...body,row_version:own.row_version,reason:'test'}),e=>e.status===403);
  run(f.db,'UPDATE employees SET is_active=0 WHERE id=?',colleague.employee_id);assert.equal(f.route(colleague).items.length,0);assert(!fileAllowed(f.db,colleague,file.file_id));
});
test('SDM scope stays attached to its grant and cannot manage another unit or global links',t=>{
  const f=fixture(t);submit(f,payload(f));const row=one(f.db,'SELECT * FROM morning_briefings'),scoped=f.account('scoped',f.employees[2].id,'SDM','ASSIGNED_UNITS');
  run(f.db,'INSERT INTO user_role_units(user_role_id,org_unit_id,include_descendants) VALUES(?,?,0)',scoped.grant.id,f.units[1].id);
  assert.equal(f.route(scoped).items.length,0);assert.equal(f.route(scoped).can_manage_link,false);
  assert.throws(()=>f.route(scoped,row.id,'PATCH',{...row,reason:'Out of scope'}),e=>e.status===403);
  assert.throws(()=>f.route(scoped,'form-link','POST',{action:'revoke',id:f.link.id,row_version:1}),e=>e.status===403);
});
test('native save is atomic, self-reported, and retries preserve one record and one private photo',t=>{
  const f=fixture(t),body=payload(f),first=submit(f,body);assert.match(first.reference,/^BP-/);assert.deepEqual(submit(f,body),first);
  for(const table of ['morning_briefings','briefing_files','files'])assert.equal(one(f.db,`SELECT count(*) n FROM ${table}`).n,1);
  const row=one(f.db,'SELECT * FROM morning_briefings');assert.equal(row.employee_name,f.employees[0].full_name);assert.equal(row.department,f.units[0].name);assert.equal(row.created_by,null);
  assert.throws(()=>submit(f,{...body,briefing_notes:'Berbeda'}),e=>e.status===409);
  const audit=one(f.db,"SELECT * FROM audit_events WHERE action='PUBLIC_BRIEFING_SUBMISSION'");assert.equal(JSON.parse(audit.change_summary).identity,'SELF_REPORTED');assert(!JSON.stringify(all(f.db,'SELECT * FROM audit_events')).includes(token));
  f.db.exec("CREATE TRIGGER reject_fixture_briefing BEFORE INSERT ON briefing_files BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");assert.throws(()=>submit(f,payload(f)),/fixture failure/);
  for(const table of ['morning_briefings','briefing_files','files'])assert.equal(one(f.db,`SELECT count(*) n FROM ${table}`).n,1);
});
test('invalid dates, forged units, camera claims, malformed photos and inactive identities fail before upload',t=>{
  const f=fixture(t),b=payload(f);
  for(const extra of [{employee_id:'unknown'},{org_unit_id:f.units[1].id},{held_on:'2026-02-30'},{held_on:'2999-01-01'},{photo:null},{photo:{...b.photo,source:'UPLOAD'}},{photo:{...b.photo,data:'aGVsbG8='}},{photo:{...b.photo,captured_at:'not-a-date'}},{photo:{...b.photo,captured_at:new Date(Date.now()-31*60000).toISOString()}},{briefing_notes:'x'.repeat(10001)},{section:''},{website:'bot'}])assert.throws(()=>submit(f,{...b,...extra}),e=>e.status===422);
  assert.equal(one(f.db,'SELECT count(*) n FROM files').n,0);
});
test('SDM corrections check version and reason, archives deny employee photos, and restore preserves provenance',t=>{
  const f=fixture(t);submit(f,payload(f));const row=one(f.db,'SELECT * FROM morning_briefings'),manager=f.account('manager',null,'SDM'),staff=f.account('staff',f.employees[1].id),file=one(f.db,'SELECT * FROM briefing_files');
  assert.throws(()=>f.route(manager,row.id,'PATCH',{...row,reason:''}),e=>e.status===422);
  const changed=f.route(manager,row.id,'PATCH',{...row,briefing_notes:'Arahan dikoreksi.',reason:'Perbaikan salah ketik'});assert.equal(changed.row_version,2);
  assert.throws(()=>f.route(manager,row.id,'PATCH',{...row,reason:'stale'}),e=>e.status===409);
  f.route(manager,row.id,'PATCH',{action:'archive',row_version:2,reason:'Kiriman ganda'});assert.equal(f.route(staff).items.length,0);assert.equal(f.route(manager).items.length,0);assert.equal(f.route(manager,'','GET',{},'archived=1').items.length,1);assert(!fileAllowed(f.db,staff,file.file_id));assert(fileAllowed(f.db,manager,file.file_id));
  f.route(manager,row.id,'PATCH',{action:'restore',row_version:3,reason:'Diperlukan kembali'});assert.equal(f.route(staff).items.length,1);assert(fileAllowed(f.db,staff,file.file_id));assert.equal(one(f.db,'SELECT employee_name FROM morning_briefings').employee_name,row.employee_name);
});
test('form link is available to employees; only global SDM can rotate or revoke with version checks',t=>{
  const f=fixture(t),manager=f.account('manager',null,'SDM'),staff=f.account('staff',f.employees[0].id),body=payload(f);
  assert.equal(f.route(staff,'form-link').token,token);assert.throws(()=>f.route(staff,'form-link','POST',{action:'revoke'}),e=>e.status===403);
  const newer=f.route(manager,'form-link','POST',{action:'rotate',id:f.link.id,row_version:1});assert.notEqual(newer.token,token);assert.throws(()=>submit(f,body),e=>e.status===404);
  assert.throws(()=>f.route(manager,'form-link','POST',{action:'revoke',id:f.link.id,row_version:1}),e=>e.status===409);
  f.route(manager,'form-link','POST',{action:'revoke',id:newer.id,row_version:newer.row_version});assert.equal(f.route(staff,'form-link').available,false);
  assert.equal(f.route(manager,'form-link','POST',{action:'create'}).available,true);assert.equal(one(f.db,'SELECT count(*) n FROM briefing_links WHERE is_active=1').n,1);
});
test('briefing rate limiting is separate from coaching and counts invalid attempts',t=>{
  const f=fixture(t);for(let i=0;i<30;i++)assert(tx(f.db,()=>takeBriefingLinkSlot(f.db,'127.0.0.1','submit')));assert.equal(tx(f.db,()=>takeBriefingLinkSlot(f.db,'127.0.0.1','submit')),false);assert(tx(f.db,()=>takeCoachingLinkSlot(f.db,'127.0.0.1','submit')));
});
test('Cloudflare briefing proxy checks origin, trusted ingress, token, server auth and response allowlist',async()=>{
  const env={PORTAL_ORIGIN:'https://bpbesakih.com',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'fixture-key'},calls=[];
  const req=(body={token},headers={},action='context')=>new Request(`${env.PORTAL_ORIGIN}/api/briefing-link/${action}`,{method:'POST',headers:{Origin:env.PORTAL_ORIGIN,'CF-Connecting-IP':'192.0.2.1','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const transport=async(url,init)=>{calls.push({url,init});return Response.json({ok:true,result:{label:'Briefing',today:today(),employees:[{id:'e',full_name:'Contoh',unit_name:'Unit',job_title:'Staf',org_unit_id:'u',employee_no:'PRIVATE'}],items:['PRIVATE']}});};
  const response=await handleBriefingLink(req(),env,transport);assert.equal(response.status,200);assert(!JSON.stringify(await response.json()).includes('PRIVATE'));assert.equal(calls[0].url,'https://fixture.supabase.co/functions/v1/briefing-native');assert.equal(calls[0].init.headers.apikey,'fixture-key');assert.equal(calls[0].init.redirect,'manual');assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal((await handleBriefingLink(req({token},{Origin:'https://evil.test'}),env,transport)).status,403);assert.equal((await handleBriefingLink(req({token:'bad'}),env,transport)).status,404);assert.equal((await handleBriefingLink(req({token},{},'read'),env,transport)).status,404);assert.equal(calls.length,1);
});
test('native HTTP routes work without a session and cannot read records through the form link',async t=>{
  const f=fixture(t),origin='https://portal.test',app=createApp({db:f.db,dataDir:f.directory,origin});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  assert.equal((await fetch(base+'/briefing-pagi/')).status,200);
  const response=await fetch(base+'/api/briefing-link/submit',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(payload(f))});assert.equal(response.status,200);assert.match((await response.json()).reference,/^BP-/);
  assert.equal((await fetch(base+'/api/briefings')).status,401);
  assert.equal((await fetch(base+'/api/briefing-link/context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})})).status,403);
});
