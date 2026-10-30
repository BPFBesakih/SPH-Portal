import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import postgres from './leave-tools/node_modules/postgres/src/index.js';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'test-results/leave-live');mkdirSync(out,{recursive:true});
const control=postgres({host:'127.0.0.1',port:55439,user:'leave_test',database:'postgres',max:1});
assert.equal(resolve((await control.unsafe('SHOW data_directory'))[0].data_directory),resolve(root,'../tmp/leave-postgres'));
const database='leave_flow_'+Date.now();await control.unsafe('CREATE DATABASE '+database);await control.end();
const pool=postgres({host:'127.0.0.1',port:55439,user:'leave_test',database,max:3,prepare:false,onnotice:()=>{}});
const source=readFileSync(resolve(root,'supabase/deploy/portal-api/index.ts'),'utf8');
let testSource=source.replace(/import \{ withSupabase \} from "npm:@supabase\/server@1";/,'const withSupabase=(options,handler)=>{if(options.auth!=="secret")throw new Error("Gateway authentication changed");return handler;};')
 .replace(/import postgres from "npm:postgres@3.4.7";/,'const postgres=()=>{throw new Error("External database forbidden in test");};');
assert.notEqual(testSource,source);assert(!testSource.includes('"npm:'));
testSource+='\nexport {routeOperation,grants,guardLeaveRoleChanges};export function setFixtureDay(value){today=()=>value;}';
const gateway=await import('data:text/javascript;base64,'+Buffer.from(testSource).toString('base64'));
const formSource=readFileSync(resolve(root,'supabase/deploy/leave-form/index.ts'),'utf8')
 .replace(/import \{ withSupabase \} from "npm:@supabase\/server@1";/,'const withSupabase=(options,handler)=>handler;')
 .replace(/import postgres from "npm:postgres@3.4.7";/,'const postgres=()=>{throw new Error("External database forbidden in test");};');
assert(!formSource.includes('"npm:'));
const formGateway=await import('data:text/javascript;base64,'+Buffer.from(formSource+'\nexport {publicLeaveForm,takeLeaveFormSlot};export function setFormFixtureDay(value){today=()=>value;}').toString('base64'));
formGateway.setFormFixtureDay('2026-10-30');
gateway.setFixtureDay('2026-10-30');
await pool.unsafe(`CREATE SCHEMA portal;
 CREATE TABLE public.app_users(id uuid PRIMARY KEY,username text,status text,employee_id text,must_change_password integer DEFAULT 0,row_version integer DEFAULT 1);
 CREATE TABLE public.app_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text UNIQUE,name text,description text,is_system boolean DEFAULT false,is_active integer DEFAULT 1);
 CREATE TABLE public.app_permissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text UNIQUE,module_code text,resource text,action text,description text);
 CREATE TABLE public.app_role_permissions(role_id uuid REFERENCES public.app_roles(id),permission_id uuid REFERENCES public.app_permissions(id),PRIMARY KEY(role_id,permission_id));
 CREATE VIEW portal.roles AS SELECT * FROM public.app_roles;CREATE VIEW portal.permissions AS SELECT * FROM public.app_permissions;CREATE VIEW portal.role_permissions AS SELECT * FROM public.app_role_permissions;
 CREATE TABLE portal.user_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,role_id uuid,scope_kind text);
 CREATE TABLE portal.user_role_units(user_role_id uuid,org_unit_id text,include_descendants integer);
 CREATE TABLE portal.org_units(id text PRIMARY KEY,name text,parent_id text);
 CREATE TABLE portal.positions(id text PRIMARY KEY,org_unit_id text,name text);
 CREATE TABLE portal.employees(id text PRIMARY KEY,employee_no text,full_name text,employment_status text,is_active integer,joined_on text,ended_on text);
 CREATE TABLE portal.employee_placements(id text PRIMARY KEY,employee_id text,position_id text,supervisor_employee_id text,valid_from text,valid_to text,is_primary integer);
 CREATE TABLE portal.audit_events(id text PRIMARY KEY,actor_user_id uuid,action text,object_type text,object_key text,occurred_at text,outcome text,request_id text,reason text,change_summary text,created_at text,updated_at text,row_version integer);
 INSERT INTO public.app_roles(code) VALUES('SUPER_ADMIN'),('SDM'),('EMPLOYEE'),('BISNIS_PIMPINAN');
 INSERT INTO portal.org_units VALUES('unit-a','Unit Contoh A',NULL),('unit-b','Unit Contoh B',NULL);
 INSERT INTO portal.positions VALUES('pos-a','unit-a','Staf Contoh A'),('pos-b','unit-b','Staf Contoh B');`);
const people=[
 ['employee','Pegawai Contoh A','e-boss','pos-a',1,'Pegawai Kontrak (PKWT)'],
 ['peer','Pegawai Contoh B','e-boss','pos-a',1,'Pegawai Kontrak (PKWT)'],
 ['boss','Atasan Contoh','e-director','pos-a',1,'Pegawai Kontrak (PKWT)'],
 ['director','Pimpinan Contoh',null,'pos-a',1,'Pegawai Kontrak (PKWT)'],
 ['outsider','Pegawai Unit Lain','e-otherboss','pos-b',1,'Pegawai Kontrak (PKWT)'],
 ['otherboss','Atasan Unit Lain',null,'pos-b',1,'Pegawai Kontrak (PKWT)'],
 ['thl','Tenaga Harian Contoh','e-boss','pos-a',1,'Tenaga Harian Lepas'],
 ['inactive','Pegawai Nonaktif Contoh','e-boss','pos-a',0,'Pegawai Kontrak (PKWT)']];
for(const [key,name,boss,position,active,status] of people){
 await pool.unsafe('INSERT INTO portal.employees VALUES($1,$2,$3,$4,$5,$6,NULL)',['e-'+key,'FIXTURE-'+key,name,status,active,'2020-01-01']);
 await pool.unsafe('INSERT INTO portal.employee_placements VALUES($1,$2,$3,$4,$5,NULL,1)',['placement-'+key,'e-'+key,position,boss,'2020-01-01']);
}
const actors={};
for(const key of ['employee','peer','boss','director','outsider','thl','sdm','unlinked']){
 const id=randomUUID(),role=key==='sdm'?'SDM':'EMPLOYEE',employee_id=['sdm','unlinked'].includes(key)?null:'e-'+key;
 await pool.unsafe("INSERT INTO public.app_users(id,username,status,employee_id) VALUES($1,$2,'ACTIVE',$3)",[id,'fixture-'+key,employee_id]);
 await pool.unsafe("INSERT INTO portal.user_roles(user_id,role_id,scope_kind) SELECT $1,id,'ALL' FROM public.app_roles WHERE code=$2",[id,role]);
 actors[key]={id,username:'fixture-'+key,employee_id,status:'ACTIVE',must_change_password:0,request_id:'fixture-'+randomUUID(),row_version:1};
}
await pool.unsafe("INSERT INTO portal.positions VALUES('pos-head','unit-a','Kepala Bidang Contoh'),('pos-leader','unit-a','Kepala Badan'); UPDATE portal.employee_placements SET position_id='pos-head' WHERE employee_id='e-boss'; UPDATE portal.employee_placements SET position_id='pos-leader' WHERE employee_id='e-director'; UPDATE portal.employee_placements SET supervisor_employee_id='e-director' WHERE employee_id='e-otherboss'");
for(const file of ['20261030020112_leave_balances_and_annual_maintenance.sql','20261030033354_leave_requests_and_supervisor_approval.sql','20261030040715_leave_employee_form_links.sql','20261030060840_leave_shared_forms.sql','20261030074231_leave_control_and_approval_stages.sql']){
 const migration=readFileSync(resolve(root,'supabase/migrations',file),'utf8').replace(/^\s*BEGIN;\s*$/gm,'').replace(/^\s*COMMIT;\s*$/gm,'');
 await pool.begin(sql=>sql.unsafe(migration));
}
const clock=day=>pool.unsafe(`CREATE OR REPLACE FUNCTION portal.leave_business_date() RETURNS date LANGUAGE sql STABLE PARALLEL SAFE SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT DATE '${day}' $$`);
await clock('2026-10-30');
async function seedBalances(){
 await pool.unsafe("INSERT INTO portal.leave_import_batches(id,source_sha256,payload_sha256,cutoff_date,balance_year,approved_by,approval_text,imported_count,imported_days,excluded_count,payload) VALUES('fixture-batch',$1,$2,'2026-10-30',2026,'Fixture','Test',6,48,0,'{}')",['1'.repeat(64),'2'.repeat(64)]);
 for(const [key,days] of [['employee',5],['peer',3],['boss',12],['director',12],['outsider',4],['otherboss',12]])
  await pool.unsafe("INSERT INTO portal.leave_year_balances(employee_id,balance_year,origin,granted_days,remaining_days,effective_from,expires_on,source_batch_id) VALUES($1,2026,'OPENING',$2,$2,'2026-10-30','2027-04-01','fixture-batch')",['e-'+key,days]);
}
await seedBalances();
await pool.unsafe('INSERT INTO portal.leave_controller_accounts(user_id) VALUES($1)',[actors.sdm.id]);
await pool.unsafe("INSERT INTO portal.user_roles(user_id,role_id,scope_kind) SELECT $1,id,'ALL' FROM public.app_roles WHERE code='LEAVE_CONTROLLER'",[actors.sdm.id]);
await pool.unsafe("INSERT INTO public.app_permissions(code,module_code,resource,action,description) VALUES('hr.employees.update','hr','employees','update','Fixture'); INSERT INTO public.app_role_permissions SELECT r.id,p.id FROM public.app_roles r CROSS JOIN public.app_permissions p WHERE r.code='SDM' AND p.code='hr.employees.update'");
const invoke=(key,path='leaves',method='GET',body={},query='')=>pool.begin(async sql=>{
 await sql.unsafe('SET LOCAL search_path=portal,pg_catalog');
 if(method!=='GET')await sql.unsafe('SELECT pg_advisory_xact_lock(734829610160009)');
 const db={inTransaction:true,query:(statement,args=[])=>sql.unsafe(statement,args),authorizationCache:method==='GET'?new Map():undefined};
 return gateway.routeOperation({db,user:{...actors[key]},path,method,body,query});
});
const query=async(sql,args=[])=>(await pool.unsafe(sql,args))[0];
const formInvoke=(action,body)=>pool.begin(async sql=>{
 await sql.unsafe('SET LOCAL search_path=portal,pg_catalog');await sql.unsafe('SELECT pg_advisory_xact_lock(734829610160009)');
 return formGateway.publicLeaveForm({inTransaction:true,query:(s,a=[])=>sql.unsafe(s,a)},action,body,randomUUID());
});
const checks=[];const check=async(name,work)=>{await work();checks.push(name);console.log('PASS '+name);};
const send=(key,dates,reason='Keperluan contoh',client_key=randomUUID())=>invoke(key,'leaves','POST',{dates,reason,client_key});
const find=async(key,id)=>(await invoke(key)).requests.find(r=>r.id===id);
const decision=async(key,id,action='approve',note='',verified=true)=>{const r=await find(key,id);return invoke(key,'leaves/'+id+'/decision','POST',{decision:action,note,row_version:r.row_version,verified_work_dates:verified,verified_identity:verified});};
const complete=async(id,action='approve')=>{for(let i=0;i<2;i++){const r=await find('sdm',id);if(!['PENDING','CANCELLATION_PENDING'].includes(r.status))return r;const actor=Object.keys(actors).find(key=>actors[key].employee_id===r.approver_employee_id);assert(actor);await decision(actor,id,action);}return find('sdm',id);};
const cancel=async(key,id)=>{const r=await find(key,id);return invoke(key,'leaves/'+id+'/cancel','POST',{row_version:r.row_version,note:'Perubahan rencana contoh'});};
await check('normal employee sees own balance, SDM sees organization, calendar has no private reasons',async()=>{
 assert.equal((await invoke('employee')).balances.length,1);assert.equal((await invoke('employee')).balances[0].available_days,5);
 assert.equal((await invoke('sdm')).balances.length,8);assert.equal((await invoke('unlinked')).balances.length,0);
 assert(!JSON.stringify((await invoke('peer')).calendar).includes('reason'));
});
await check('Kontrol Cuti is limited to configured accounts and Super Admin even when another role gains leave permissions',async()=>{
 await pool.unsafe("INSERT INTO portal.user_roles(user_id,role_id,scope_kind) SELECT $1,id,'ALL' FROM public.app_roles WHERE code='BISNIS_PIMPINAN'",[actors.outsider.id]);
 await pool.unsafe("INSERT INTO public.app_role_permissions SELECT r.id,p.id FROM public.app_roles r CROSS JOIN public.app_permissions p WHERE r.code='BISNIS_PIMPINAN' AND p.resource='hr.leaves'");
 const outsider=await invoke('outsider');assert.equal(outsider.capabilities.can_manage_reports,false);assert.equal(outsider.capabilities.can_export,false);assert.equal(outsider.capabilities.can_manage_shared_form,false);assert.equal(outsider.balances.length,1);
 await assert.rejects(()=>invoke('outsider','leaves/shared-form'),e=>e.status===403);
 await assert.rejects(()=>invoke('outsider','leaves/export-audit','POST',{employee_ids:['e-outsider']}),e=>e.status===403);
 const roleId=(await query("SELECT id FROM public.app_roles WHERE code='LEAVE_CONTROLLER'")).id;
 await assert.rejects(()=>invoke('sdm','users/'+actors.outsider.id+'/grants','POST',{grants:[{role_id:roleId,scope_kind:'ALL'}]}),e=>e.status===403);
 await assert.rejects(()=>invoke('sdm','roles','POST',{code:'UNRESTRICTED_ROLE',permissions:['hr.leaves.read']}),e=>e.status===403);
 await pool.begin(async sql=>{await sql.unsafe('SET LOCAL search_path=portal,pg_catalog');await gateway.guardLeaveRoleChanges({db:{query:(s,a=[])=>sql.unsafe(s,a)},p:['users',actors.sdm.id,'grants'],method:'POST',body:{grants:[{role_id:roleId}]}},assert);});
 await pool.unsafe("INSERT INTO portal.user_roles(user_id,role_id,scope_kind) SELECT $1,id,'ALL' FROM public.app_roles WHERE code='SUPER_ADMIN'",[actors.unlinked.id]);
 assert((await invoke('unlinked')).capabilities.can_manage_shared_form);await pool.unsafe('DELETE FROM portal.user_roles WHERE user_id=$1 AND role_id=(SELECT id FROM public.app_roles WHERE code=\'SUPER_ADMIN\')',[actors.unlinked.id]);
 await pool.unsafe("DELETE FROM public.app_role_permissions WHERE role_id=(SELECT id FROM public.app_roles WHERE code='BISNIS_PIMPINAN')");
 await pool.unsafe("DELETE FROM portal.user_roles WHERE user_id=$1 AND role_id=(SELECT id FROM public.app_roles WHERE code='BISNIS_PIMPINAN')",[actors.outsider.id]);
});
await check('THL, duplicate dates, unknown future credits and missing supervisor are rejected',async()=>{
 await assert.rejects(()=>send('thl',['2026-11-01']),e=>e.status===403);
 await assert.rejects(()=>send('employee',['2026-11-01','2026-11-01']),e=>e.status===422);
 await assert.rejects(()=>send('employee',['2027-04-02']),e=>e.status===422);
 await assert.rejects(()=>send('director',['2026-11-01']),e=>e.status===422);
});
let first;
await check('explicit weekend work date is reserved without consuming and repeated submit is idempotent',async()=>{
 const key=randomUUID();first=await send('employee',['2026-11-01'],'Alasan privat contoh',key);
 assert.equal((await invoke('employee')).balances[0].available_days,4);
 assert.equal((await query("SELECT remaining_days FROM portal.leave_year_balances WHERE employee_id='e-employee' AND balance_year=2026")).remaining_days,5);
 assert.equal((await send('employee',['2026-11-01'],'Alasan privat contoh',key)).id,first.id);
 await assert.rejects(()=>send('employee',['2026-11-01'],'Isi berbeda',key),e=>e.status===409);
});
await check('only the active approval stage decides; control role and future approvers cannot bypass verification',async()=>{
 await assert.rejects(()=>decision('sdm',first.id),e=>e.status===403);
 await assert.rejects(()=>decision('director',first.id),e=>e.status===403);
 await assert.rejects(()=>decision('boss',first.id,'approve','',false),e=>e.status===422);
 await assert.rejects(()=>decision('boss',first.id,'reject'),e=>e.status===422);
});
await check('failed debit rolls back request status, funds and audit',async()=>{
 await decision('boss',first.id);
 assert.equal((await invoke('boss','leaves/notifications')).total,0);assert.equal((await invoke('director','leaves/notifications')).total,1);
 assert.equal((await query("SELECT remaining_days FROM portal.leave_year_balances WHERE employee_id='e-employee' AND balance_year=2026")).remaining_days,5);
 await pool.unsafe("ALTER TABLE portal.leave_balance_events ADD CONSTRAINT fixture_debit_fail CHECK(event_type<>'CONSUMPTION')");
 await assert.rejects(()=>decision('director',first.id));
 assert.equal((await find('employee',first.id)).status,'PENDING');
 assert.equal((await query("SELECT remaining_days FROM portal.leave_year_balances WHERE employee_id='e-employee' AND balance_year=2026")).remaining_days,5);
 assert.equal((await query("SELECT count(*)::int n FROM portal.audit_events WHERE action='LEAVE_APPROVED'")).n,0);
 await pool.unsafe('ALTER TABLE portal.leave_balance_events DROP CONSTRAINT fixture_debit_fail');
});
await check('final-stage approval consumes exactly once and stale decisions cannot debit again',async()=>{
 const r=await find('director',first.id);await decision('director',first.id);
 assert.equal((await find('employee',first.id)).status,'APPROVED');
 assert.equal((await query("SELECT remaining_days FROM portal.leave_year_balances WHERE employee_id='e-employee' AND balance_year=2026")).remaining_days,4);
 await assert.rejects(()=>invoke('boss','leaves/'+first.id+'/decision','POST',{decision:'approve',row_version:r.row_version,verified_work_dates:true}),e=>e.status===409);
});
await check('approved team overlap warns but is allowed; peer calendar exposes no reason or request details',async()=>{
 const preview=await invoke('peer','leaves/preview','POST',{dates:['2026-11-01']});assert.equal(preview.conflicts.length,1);
 const peer=await send('peer',['2026-11-01']);await complete(peer.id);
 const peerView=await invoke('peer');assert(peerView.calendar.some(r=>r.employee_id==='e-employee'));assert(!peerView.requests.some(r=>r.id===first.id));
 assert((await find('boss',first.id)).conflicts.some(c=>c.name==='Pegawai Contoh B'));
 assert(!JSON.stringify(peerView).includes('Alasan privat contoh'));assert.equal((await invoke('outsider')).calendar.length,0);
});
await check('approved cancellation waits for direct supervisor and restores once',async()=>{
 await cancel('employee',first.id);assert.equal((await find('employee',first.id)).status,'CANCELLATION_PENDING');
 assert.equal((await query("SELECT remaining_days FROM portal.leave_year_balances WHERE employee_id='e-employee' AND balance_year=2026")).remaining_days,4);
 await complete(first.id,'approve-cancel');
 assert.equal((await find('employee',first.id)).status,'CANCELLED');
 assert.equal((await query("SELECT remaining_days FROM portal.leave_year_balances WHERE employee_id='e-employee' AND balance_year=2026")).remaining_days,5);
});
await check('concurrent reservations cannot exceed balance; pending cancellation releases reservations',async()=>{
 const results=await Promise.allSettled([send('employee',['2026-11-02','2026-11-03','2026-11-04']),send('employee',['2026-11-05','2026-11-06','2026-11-07'])]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const held=results.find(r=>r.status==='fulfilled').value;await cancel('employee',held.id);
 assert.equal((await invoke('employee')).balances[0].available_days,5);
});
await check('supervisor change blocks stale approval and owner can withdraw for correct resubmission',async()=>{
 const r=await send('employee',['2026-11-08']);
 await pool.unsafe("UPDATE portal.employee_placements SET supervisor_employee_id='e-director' WHERE employee_id='e-employee'");
 await assert.rejects(()=>invoke('boss','leaves/'+r.id+'/decision','POST',{decision:'approve',row_version:1,verified_work_dates:true}),e=>e.status===403);
 await cancel('employee',r.id);await pool.unsafe("UPDATE portal.employee_placements SET supervisor_employee_id='e-boss' WHERE employee_id='e-employee'");
});
await check('report export is scoped and protected; another unit cannot read balance history',async()=>{
 await assert.rejects(()=>invoke('employee','leaves/export-audit','POST',{employee_ids:['e-employee']}),e=>e.status===403);
 await invoke('sdm','leaves/export-audit','POST',{employee_ids:['e-employee','e-peer'],kind:'balances'});
 await assert.rejects(()=>invoke('outsider','leaves/history','GET',{},'employee_id=e-employee'),e=>e.status===403);
 assert((await invoke('employee','leaves/history')).items.some(r=>r.event_type==='CONSUMPTION'));
});
await check('department head goes directly to Pimpinan with one approval and one cancellation decision',async()=>{
 const planned=await invoke('boss','leaves/preview','POST',{dates:['2026-11-27']});assert.deepEqual(planned.approvers.map(a=>a.id),['e-director']);
 const r=await send('boss',['2026-11-27']);await assert.rejects(()=>decision('boss',r.id),e=>e.status===403);await decision('director',r.id);assert.equal((await find('boss',r.id)).status,'APPROVED');
 await cancel('boss',r.id);await decision('director',r.id,'approve-cancel');assert.equal((await find('boss',r.id)).status,'CANCELLED');
});
await check('rejection at either stage releases reservations without consuming balance',async()=>{
 const a=await send('employee',['2026-11-28']);await decision('boss',a.id,'reject','Contoh penolakan tahap pertama');
 assert.equal((await find('employee',a.id)).status,'REJECTED');
 const b=await send('employee',['2026-11-28']);await decision('boss',b.id);assert.equal((await find('employee',b.id)).current_step,2);
 await decision('director',b.id,'reject','Contoh penolakan tahap kedua');assert.equal((await find('employee',b.id)).status,'REJECTED');
 assert.equal((await invoke('employee')).balances[0].available_days,5);assert.equal((await query('SELECT count(*)::int n FROM portal.leave_balance_events WHERE event_key=$1',['APPROVE:'+b.id+':2026'])).n,0);
});
await check('cancellation requires both stages, rejected cancellation preserves debit, retry refunds exactly once',async()=>{
 const r=await send('employee',['2026-11-29']);await complete(r.id);await cancel('employee',r.id);await decision('boss',r.id,'approve-cancel');
 assert.equal((await find('employee',r.id)).status,'CANCELLATION_PENDING');assert.equal((await query("SELECT remaining_days FROM portal.leave_year_balances WHERE employee_id='e-employee' AND balance_year=2026")).remaining_days,4);
 await decision('director',r.id,'reject-cancel','Tetap menggunakan cuti');assert.equal((await find('employee',r.id)).status,'APPROVED');await cancel('employee',r.id);await complete(r.id,'approve-cancel');
 const final=await find('employee',r.id);assert.equal(final.status,'CANCELLED');assert.equal(final.approval_cycle,3);assert.equal(final.approval_steps.length,6);
 assert.equal((await query('SELECT count(*)::int n FROM portal.leave_balance_events WHERE event_key=$1',['CANCEL:'+r.id+':2026'])).n,1);
});
await check('changing the second supervisor blocks stale routing after first approval',async()=>{
 const r=await send('employee',['2026-11-30']);await decision('boss',r.id);
 await pool.unsafe("UPDATE portal.employee_placements SET supervisor_employee_id='e-otherboss' WHERE employee_id='e-boss'");
 await assert.rejects(()=>invoke('director','leaves/'+r.id+'/decision','POST',{decision:'approve',row_version:2,verified_work_dates:true}),e=>e.status===403);
 assert.equal((await invoke('director','leaves/notifications')).total,0);await cancel('employee',r.id);await pool.unsafe("UPDATE portal.employee_placements SET supervisor_employee_id='e-director' WHERE employee_id='e-boss'");
});
await check('existing pending requests without step history adopt both stages on the first decision',async()=>{
 const r=await send('employee',['2026-12-01']);await pool.unsafe('DELETE FROM portal.leave_approval_steps WHERE request_id=$1',[r.id]);
 await decision('boss',r.id);const after=await find('employee',r.id);assert.equal(after.current_step,2);assert.equal(after.approval_steps.length,2);assert.equal(after.approval_steps[0].state,'APPROVED');
 await decision('director',r.id);await cancel('employee',r.id);await complete(r.id,'approve-cancel');
});
await check('missing or cyclic second supervisor prevents submission without guessing a substitute',async()=>{
 await pool.unsafe("UPDATE portal.employee_placements SET supervisor_employee_id=NULL WHERE employee_id='e-boss'");await assert.rejects(()=>send('employee',['2026-12-02']),e=>e.status===422);
 await pool.unsafe("UPDATE portal.employee_placements SET supervisor_employee_id='e-employee' WHERE employee_id='e-boss'");await assert.rejects(()=>send('employee',['2026-12-02']),e=>e.status===422);
 await pool.unsafe("UPDATE portal.employee_placements SET supervisor_employee_id='e-director' WHERE employee_id='e-boss'");
});
await check('only authorized SDM can issue personal links; THL, inactive and missing supervisor are denied',async()=>{
 await assert.rejects(()=>invoke('employee','leaves/form-links','POST',{employee_id:'e-employee',action:'issue'}),e=>e.status===403);
 await assert.rejects(()=>invoke('sdm','leaves/form-links','POST',{employee_id:'e-thl',action:'issue'}),e=>e.status===403);
 await assert.rejects(()=>invoke('sdm','leaves/form-links','POST',{employee_id:'e-inactive',action:'issue'}),e=>e.status===403);
 await assert.rejects(()=>invoke('sdm','leaves/form-links','POST',{employee_id:'e-director',action:'issue'}),e=>e.status===422);
 const grant=await query("SELECT ur.id FROM portal.user_roles ur JOIN public.app_roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND r.code='LEAVE_CONTROLLER'",[actors.sdm.id]);
 await pool.unsafe("UPDATE portal.user_roles SET scope_kind='ASSIGNED_UNITS' WHERE id=$1",[grant.id]);
 await pool.unsafe("INSERT INTO portal.user_role_units VALUES($1,'unit-a',0)",[grant.id]);
 await assert.rejects(()=>invoke('sdm','leaves/form-links','POST',{employee_id:'e-outsider',action:'issue'}),e=>e.status===403);
 await invoke('sdm','leaves/form-links','POST',{employee_id:'e-employee',action:'issue'});
 await pool.unsafe("DELETE FROM portal.user_role_units WHERE user_role_id=$1",[grant.id]);await pool.unsafe("UPDATE portal.user_roles SET scope_kind='ALL' WHERE id=$1",[grant.id]);
});
await check('leave notifications contain only current direct-supervisor work, including cancellation and resolved requests',async()=>{
 for(const role of ['employee','sdm','director','unlinked','outsider'])assert.equal((await invoke(role,'leaves/notifications')).total,0);
 const a=await send('employee',['2026-11-25']);
 const n=await invoke('boss','leaves/notifications');assert.equal(n.total,1);assert.equal(n.pending,1);assert.equal(n.cancellations,0);assert(/^[a-f0-9]{64}$/.test(n.signature));
 assert(!JSON.stringify(n).includes('employee'));assert(!JSON.stringify(n).includes(a.id));
 assert.equal((await invoke('director','leaves/notifications')).total,0);
 await pool.unsafe("UPDATE portal.employee_placements SET supervisor_employee_id='e-director' WHERE employee_id='e-employee'");assert.equal((await invoke('boss','leaves/notifications')).total,0);assert.equal((await invoke('director','leaves/notifications')).total,0);
 await pool.unsafe("UPDATE portal.employee_placements SET supervisor_employee_id='e-boss' WHERE employee_id='e-employee'");
 await complete(a.id);assert.equal((await invoke('boss','leaves/notifications')).total,0);
 await cancel('employee',a.id);const c=await invoke('boss','leaves/notifications');assert.equal(c.cancellations,1);assert.notEqual(c.signature,n.signature);
 await complete(a.id,'approve-cancel');assert.equal((await invoke('boss','leaves/notifications')).total,0);
});
let sharedToken;
await check('one shared link is managed only by organization-wide SDM and can be copied again',async()=>{
 await assert.rejects(()=>invoke('employee','leaves/shared-form'),e=>e.status===403);
 const grant=await query("SELECT ur.id FROM portal.user_roles ur JOIN public.app_roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND r.code='LEAVE_CONTROLLER'",[actors.sdm.id]);await pool.unsafe("UPDATE portal.user_roles SET scope_kind='SELF' WHERE id=$1",[grant.id]);
 await assert.rejects(()=>invoke('sdm','leaves/shared-form','POST',{action:'issue'}),e=>e.status===403);await pool.unsafe("UPDATE portal.user_roles SET scope_kind='ALL' WHERE id=$1",[grant.id]);
 const result=await invoke('sdm','leaves/shared-form','POST',{action:'issue'});sharedToken=result.link.token;assert.equal((await invoke('sdm','leaves/shared-form')).link.token,sharedToken);
});
await check('shared context lists active non-THL names with no private balances, requests or full employee numbers',async()=>{
 const ctx=await formInvoke('context',{token:sharedToken});assert(ctx.shared);assert(ctx.employees.some(e=>e.id==='e-employee'));assert(ctx.employees.some(e=>e.id==='e-peer'));
 assert(!ctx.employees.some(e=>['e-thl','e-inactive'].includes(e.id)));for(const value of ['FIXTURE-','available_days','reserved_days','reason','requests','share_token'])assert(!JSON.stringify(ctx).includes(value));
 await assert.rejects(()=>formInvoke('submit',{token:sharedToken,employee_id:'e-thl',client_key:randomUUID(),dates:['2026-11-26'],reason:'No'}),e=>e.status===403);
 await assert.rejects(()=>formInvoke('preview',{token:sharedToken,employee_id:'unknown',dates:['2026-11-26']}),e=>e.status===403);
 await pool.unsafe("INSERT INTO portal.employees VALUES('e-zero','ZERO-0000','Pegawai Saldo Nol','Pegawai Kontrak (PKWT)',1,'2020-01-01',NULL); INSERT INTO portal.employee_placements VALUES('placement-zero','e-zero','pos-a','e-boss','2020-01-01',NULL,1); UPDATE portal.employees SET full_name='Pegawai Contoh A' WHERE id='e-peer'");
 const updated=await formInvoke('context',{token:sharedToken});assert(updated.employees.some(e=>e.id==='e-zero'));const duplicates=updated.employees.filter(e=>e.full_name==='Pegawai Contoh A');assert.equal(duplicates.length,2);assert.notEqual(duplicates[0].position_name,duplicates[1].position_name);assert(duplicates.every(e=>e.position_name.includes('ID berakhir')));
 await pool.unsafe("DELETE FROM portal.employee_placements WHERE employee_id='e-zero'; DELETE FROM portal.employees WHERE id='e-zero'; UPDATE portal.employees SET full_name='Pegawai Contoh B' WHERE id='e-peer'");
});
await check('same shared form submits for two selected employees with isolated retries, holds, attribution and identity checks',async()=>{
 const key=randomUUID(),payload={token:sharedToken,employee_id:'e-employee',dates:['2026-11-26'],reason:'Contoh bersama',client_key:key};
 const a=await formInvoke('submit',payload),b=await formInvoke('submit',{...payload,employee_id:'e-peer'});assert.notEqual(a.reference,b.reference);assert.equal((await formInvoke('submit',payload)).reference,a.reference);
 const stored=await find('boss',a.reference);assert.equal(stored.submission_source,'FORM');assert(stored.source_shared_form_link_id);assert.equal(stored.source_form_link_id,null);assert.equal(stored.created_by,null);
 assert.equal((await invoke('boss','leaves/notifications')).total,2);
 await assert.rejects(()=>invoke('boss','leaves/'+stored.id+'/decision','POST',{decision:'approve',row_version:1,verified_work_dates:true}),e=>e.status===422);
 await cancel('employee',a.reference);await cancel('peer',b.reference);assert.equal((await invoke('boss','leaves/notifications')).total,0);
});
await check('shared link rotation and revocation block the old link without changing existing requests',async()=>{
 const next=await invoke('sdm','leaves/shared-form','POST',{action:'issue'});await assert.rejects(()=>formInvoke('context',{token:sharedToken}),e=>e.status===404);
 sharedToken=next.link.token;await invoke('sdm','leaves/shared-form','POST',{action:'revoke'});await assert.rejects(()=>formInvoke('context',{token:sharedToken}),e=>e.status===404);
});
let publicToken;
await check('link binds identity and redacts employee numbers, peer names, requests and reasons',async()=>{
 const issued=await invoke('sdm','leaves/form-links','POST',{employee_id:'e-employee',action:'issue'});publicToken=issued.token;
 assert(/^[a-f0-9]{64}$/.test(publicToken));
 const ctx=await formInvoke('context',{token:publicToken,employee_id:'e-peer'});assert.equal(ctx.name,'Pegawai Contoh A');
 for(const value of ['FIXTURE-','Alasan privat','requests','e-peer','Pegawai Contoh B'])assert(!JSON.stringify(ctx).includes(value));
 assert(!(await invoke('sdm','leaves/form-links')).items.some(r=>JSON.stringify(r).includes(publicToken)));
 await assert.rejects(()=>formInvoke('context',{token:'0'.repeat(64)}),e=>e.status===404);
 const preview=await formInvoke('preview',{token:publicToken,dates:['2026-11-01']});assert.deepEqual(preview.conflicts,['2026-11-01']);assert(!JSON.stringify(preview).includes('Pegawai Contoh B'));
});
await check('public requests reserve once, ignore forged IDs and require direct boss identity verification',async()=>{
 const payload={token:publicToken,dates:['2026-11-15'],reason:'Formulir contoh',client_key:randomUUID(),employee_id:'e-peer',user_id:actors.peer.id};
 const r=await formInvoke('submit',payload),again=await formInvoke('submit',payload);assert.equal(r.reference,again.reference);
 const stored=await find('boss',r.reference);assert.equal(stored.employee_id,'e-employee');assert.equal(stored.created_by,null);assert.equal(stored.submission_source,'FORM');
 assert.equal((await invoke('employee')).balances[0].available_days,4);
 await assert.rejects(()=>formInvoke('submit',{...payload,reason:'Different'}),e=>e.status===409);
 await assert.rejects(()=>invoke('sdm','leaves/'+stored.id+'/decision','POST',{decision:'approve',row_version:1,verified_work_dates:true,verified_identity:true}),e=>e.status===403);
 await assert.rejects(()=>invoke('boss','leaves/'+stored.id+'/decision','POST',{decision:'approve',row_version:1,verified_work_dates:true}),e=>e.status===422);
 await complete(stored.id);await cancel('employee',stored.id);await complete(stored.id,'approve-cancel');
 assert.equal((await invoke('employee')).balances[0].available_days,5);
});
await check('concurrent public forms share portal reservations and cannot overdraw',async()=>{
 const results=await Promise.allSettled([formInvoke('submit',{token:publicToken,dates:['2026-11-16','2026-11-17','2026-11-18'],reason:'Contoh A',client_key:randomUUID()}),send('employee',['2026-11-19','2026-11-20','2026-11-21'])]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const r=results.find(r=>r.status==='fulfilled').value;await cancel('employee',r.reference||r.id);
});
await check('rotation, revocation, expiry and current employment status invalidate personal links',async()=>{
 const next=await invoke('sdm','leaves/form-links','POST',{employee_id:'e-employee',action:'issue'});
 await assert.rejects(()=>formInvoke('context',{token:publicToken}),e=>e.status===404);publicToken=next.token;
 await pool.unsafe("UPDATE portal.employees SET is_active=0 WHERE id='e-employee'");await assert.rejects(()=>formInvoke('context',{token:publicToken}),e=>e.status===403);
 await pool.unsafe("UPDATE portal.employees SET is_active=1 WHERE id='e-employee'; UPDATE portal.leave_form_links SET created_at=now()-interval '100 days',expires_at=now()-interval '1 day' WHERE employee_id='e-employee' AND revoked_at IS NULL");
 await assert.rejects(()=>formInvoke('context',{token:publicToken}),e=>e.status===404);
 const last=await invoke('sdm','leaves/form-links','POST',{employee_id:'e-employee',action:'issue'});
 await invoke('sdm','leaves/form-links','POST',{employee_id:'e-employee',action:'revoke'});
 await assert.rejects(()=>formInvoke('submit',{token:last.token,dates:['2026-11-22'],reason:'No',client_key:randomUUID()}),e=>e.status===404);
});
await check('public rate limits persist separately and reject excess attempts',async()=>{
 const hits=[];for(let i=0;i<16;i++)hits.push(await pool.begin(async sql=>{await sql.unsafe('SET LOCAL search_path=portal,pg_catalog');return formGateway.takeLeaveFormSlot({query:(s,a=[])=>sql.unsafe(s,a)},'127.0.0.1','submit');}));
 assert.equal(hits.filter(Boolean).length,15);assert.equal(hits.at(-1),false);
 const row=await query('SELECT id FROM portal.leave_form_rate_limits LIMIT 1');assert(!row.id.includes('127.0.0.1'));
});
await check('year-aware reservations use expiring carry first and a new-year bucket for April',async()=>{
 gateway.setFixtureDay('2027-01-01');await clock('2027-01-01');await pool.unsafe('SELECT portal.run_leave_year_maintenance()');
 const preview=await invoke('employee','leaves/preview','POST',{dates:['2027-01-03','2027-04-02']});
 assert.deepEqual(preview.allocations.map(r=>r.balance_year),[2026,2027]);
 const r=await send('employee',['2027-01-03','2027-04-02']);await complete(r.id);await cancel('employee',r.id);await complete(r.id,'approve-cancel');
 gateway.setFixtureDay('2027-04-01');await clock('2027-04-01');await pool.unsafe('SELECT portal.run_leave_year_maintenance()');
 assert.equal((await invoke('employee','leaves/preview','POST',{dates:['2027-04-02']})).allocations[0].balance_year,2027);
});
writeFileSync(resolve(out,'workflow-results.json'),JSON.stringify({passed:checks.length,checks,production_mutations:false,gateway_source:'actual packaged production gateway with leave route'},null,2));
console.log(checks.length+' workflow checks passed.');
if(!process.argv.includes('--serve')){await pool.end();process.exit(0);}
// Reset only this newly-created synthetic database for browser QA.
await pool.unsafe('TRUNCATE portal.leave_request_days,portal.leave_requests,portal.leave_balance_events,portal.leave_year_balances,portal.leave_import_batches,portal.audit_events CASCADE');
gateway.setFixtureDay('2026-10-30');await clock('2026-10-30');await seedBalances();
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.json':'application/json'};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1:3187');
  if(url.pathname==='/__fixture/actor'){const key=url.searchParams.get('role');assert(actors[key]);res.writeHead(200,{'Set-Cookie':'fixture_actor='+key+'; Path=/; HttpOnly; SameSite=Strict'});res.end('ok');return;}
  const key=(req.headers.cookie||'').match(/fixture_actor=([a-z]+)/)?.[1]||'sdm';
  if(url.pathname.startsWith('/api/')){
   res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
   let result;
   if(url.pathname==='/api/auth/me'){
    const permissions=await pool.begin(async sql=>{await sql.unsafe('SET LOCAL search_path=portal,pg_catalog');return [...new Set((await gateway.grants({query:(s,a)=>sql.unsafe(s,a)},actors[key])).map(g=>g.code))];});
    result={user:actors[key],name:'Akun Contoh '+key,permissions,csrfToken:'fixture-only',announcements_manage:false,purchasing_pending:0};
   }else if(url.pathname.startsWith('/api/leave-form/')){
    let raw='';for await(const chunk of req)raw+=chunk;result=await formInvoke(url.pathname.split('/').at(-1),JSON.parse(raw));
   }else if(url.pathname.startsWith('/api/leaves')){
    let raw='';for await(const chunk of req)raw+=chunk;
    result=await invoke(key,url.pathname.slice(5),req.method,raw?JSON.parse(raw):{},url.search.slice(1));
   }else if(url.pathname.includes('announcements'))result={items:[],unread_count:0,unread:0};
   else result={items:[]};
   res.end(JSON.stringify(result));return;
  }
  const pathname=url.pathname==='/cuti/'?'/leave-form.html':url.pathname.startsWith('/app/')?url.pathname.slice(4):url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname);
  let file=resolve(root,'public','.'+pathname);
  if(!file.startsWith(resolve(root,'public'))||!existsSync(file)){res.writeHead(404);res.end('not found');return;}
  res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(readFileSync(file));
 }catch(error){res.writeHead(error.status||422,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
});
server.listen(3187,'127.0.0.1',()=>console.log('Leave browser fixture ready at http://127.0.0.1:3187/#leaves'));
process.on('SIGINT',async()=>{server.close();await pool.end();process.exit(0);});
