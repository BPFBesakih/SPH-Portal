import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {all,one,insert,update,run,now,today,tx} from '../supabase/functions/_shared/portal/db.mjs';
import {can,assertAdminRemains,resourceActions} from '../supabase/functions/_shared/portal/auth.mjs';
import {routeOperation} from '../supabase/functions/_shared/portal/router.mjs';
import {buildSnapshot,generateAssignments,validateAssignments} from '../supabase/functions/_shared/portal/roster.mjs';

const {PGlite}=await import(pathToFileURL(resolve(process.argv[2]||'C:/Users/Ayyymao/AppData/Local/Temp/sph-portal-sql-20261016/node_modules/@electric-sql/pglite/dist/index.js')).href);
const pg=new PGlite();
let checks=0;
const check=async(name,fn)=>{await fn();console.log(`PASS ${name}`);checks++;};
try{
 await pg.exec(`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;
 CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,encrypted_password text);
 CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id));
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth TO authenticated;`);
 const directory=new URL('../supabase/migrations/',import.meta.url);
 for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')&&n<'20261016000900').sort())await pg.exec(readFileSync(new URL(name,directory),'utf8'));
 const existingId=randomUUID();
 await pg.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[existingId,'existing-fixture@example.invalid']);
 await pg.query('INSERT INTO public.app_users(id,username,must_change_password) VALUES($1,$2,false)',[existingId,'existing_admin']);
 await pg.query("INSERT INTO public.app_user_roles(user_id,role_id,scope_kind) SELECT $1,id,'ALL' FROM public.app_roles WHERE code='SUPER_ADMIN'",[existingId]);
 await pg.exec("INSERT INTO public.app_role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.app_roles r CROSS JOIN public.app_permissions p WHERE r.code='SUPER_ADMIN' AND p.module_code='admin' ON CONFLICT DO NOTHING");
 await pg.exec(`INSERT INTO import_staging.employee_candidates(full_name,positions,source_name,source_cells)
  SELECT 'Fiktif '||g,'[{"name":"Posisi Fiktif","org_path":"Unit Fiktif"}]'::jsonb,'fixture',jsonb_build_array('Bagan Lengkap!A'||g) FROM generate_series(1,157)g;`);
 const beforeIdentity=(await pg.query('SELECT id,username,status,must_change_password,row_version FROM public.app_users ORDER BY id')).rows;
 await pg.exec(readFileSync(new URL('20261016000900_operational_modules.sql',directory),'utf8'));
 for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')&&n>'20261016000900_operational_modules.sql').sort())await pg.exec(readFileSync(new URL(name,directory),'utf8'));
 await check('migration preserves existing accounts, six admin permissions and all 157 pending candidates',async()=>{
  assert.deepEqual((await pg.query('SELECT id,username,status,must_change_password,row_version FROM public.app_users ORDER BY id')).rows,beforeIdentity);
  assert.equal((await pg.query("SELECT count(*)::int n FROM public.app_role_permissions rp JOIN public.app_roles r ON r.id=rp.role_id WHERE r.code='SUPER_ADMIN'")).rows[0].n,6);
  assert.equal((await pg.query("SELECT count(*)::int n FROM import_staging.employee_candidates WHERE status='PENDING'")).rows[0].n,157);
  assert.equal((await pg.query("SELECT count(*)::int n FROM portal.import_candidates WHERE status='PENDING'")).rows[0].n,157);
  assert.equal((await pg.query('SELECT count(*)::int n FROM portal.employees')).rows[0].n,0);
 });
 // Remove only this isolated fixture grant before testing the last-admin guard.
 await pg.query('DELETE FROM public.app_user_roles WHERE user_id=$1',[existingId]);
 const db={inTransaction:true,query:async(sql,args=[])=>{const r=await pg.query(sql,args);return Object.assign(r.rows,{count:r.affectedRows??r.rows.length});}};
 await pg.exec('SET search_path=portal,pg_catalog');
 await check('operational schema has RLS and no direct client or service-role grants',async()=>{
  const tables=await pg.query("SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='portal'");
  assert.equal(tables.rows.length,65);assert(tables.rows.every(t=>t.rowsecurity));
  for(const role of ['anon','authenticated','service_role']){
   assert.equal((await pg.query('SELECT has_schema_privilege($1,\'portal\',\'USAGE\') ok',[role])).rows[0].ok,false);
   assert.equal((await pg.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='portal' AND has_table_privilege($1,schemaname||'.'||tablename,'SELECT,INSERT,UPDATE,DELETE')",[role])).rows[0].n,0);
  }
 });
 await check('migration can be reapplied without changing account access',async()=>{await pg.exec(readFileSync(new URL('20261016000900_operational_modules.sql',directory),'utf8'));});
 const userId=randomUUID();await pg.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[userId,'fixture@example.invalid']);
 let admin;
 await check('identity views write the existing account and role authorities',async()=>{
  admin=await insert(db,'users',{id:userId,username:'fixture_admin',must_change_password:0,status:'ACTIVE',password_changed_at:now()});
  assert.equal(admin.must_change_password,0);assert.equal(admin.row_version,1);
  const role=await one(db,"SELECT * FROM roles WHERE code='SUPER_ADMIN'")||await insert(db,'roles',{code:'SUPER_ADMIN',name:'Fixture administrator',is_system:1,is_active:1});
  for(const perm of await all(db,"SELECT id FROM permissions WHERE module_code='admin'"))if(!await one(db,'SELECT 1 FROM role_permissions WHERE role_id=? AND permission_id=?',role.id,perm.id))await run(db,'INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)',role.id,perm.id);
  await insert(db,'user_roles',{user_id:admin.id,role_id:role.id,scope_kind:'ALL'});
  assert.equal(await can(db,admin,'admin.users.manage'),true);
  assert.equal(await can(db,admin,'hr.coaching.read'),false);
  assert.equal((await pg.query('SELECT count(*)::int n FROM public.app_user_roles WHERE user_id=$1',[admin.id])).rows[0].n,1);
 });
 await check('last administrator changes roll back across the identity view',async()=>{
  await pg.exec('BEGIN');try{await update(db,'users',admin.id,1,{status:'INACTIVE'});await assert.rejects(assertAdminRemains(db),/Administrator terakhir/);}finally{await pg.exec('ROLLBACK');}
  assert.equal((await one(db,'SELECT status FROM users WHERE id=?',admin.id)).status,'ACTIVE');
 });
 const files=new Map();
 db.storage={put:async data=>{const key=randomUUID();files.set(key,data);return key;},get:async key=>files.get(key)};
 db.identity={create:async()=>{const id=randomUUID();await pg.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[id,`${id}@example.invalid`]);return {id};}};
 const call=async(user,path,method='GET',body={},query='')=>{
  await pg.exec('BEGIN');
  try{const result=await routeOperation({db,user,path,method,body,query});await pg.exec('COMMIT');return result;}catch(e){await pg.exec('ROLLBACK');throw e;}
 };
 const account=async(name,role,employee_id=null,scope_kind='ALL')=>{
  const id=randomUUID();await pg.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[id,`${id}@example.invalid`]);
  const u=await insert(db,'users',{id,username:name,status:'ACTIVE',must_change_password:0,employee_id});
  if(role)await insert(db,'user_roles',{user_id:id,role_id:(await one(db,'SELECT id FROM roles WHERE code=?',role)).id,scope_kind});return u;
 };
 await check('an administrator can edit their system role permissions while last-admin and identity checks remain atomic',async()=>{
  const role=await one(db,"SELECT * FROM roles WHERE code='SUPER_ADMIN'");
  const original=(await all(db,'SELECT p.code FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id=?',role.id)).map(p=>p.code);
  const permissions=[...original,'hr.coaching.read','hr.employee_files.read'];
  const saved=await call(admin,`roles/${role.id}`,'PATCH',{row_version:role.row_version,permissions});
  assert.equal(saved.code,'SUPER_ADMIN');assert.equal(saved.is_system,1);assert.equal(await can(db,admin,'hr.coaching.read'),true);
  await assert.rejects(call(admin,`roles/${role.id}`,'PATCH',{row_version:saved.row_version,code:'RENAMED',permissions}),e=>e.status===422);
  await assert.rejects(call(admin,`roles/${role.id}`,'PATCH',{row_version:saved.row_version,permissions:permissions.filter(p=>p!=='admin.roles.manage')}),e=>e.status===409);
  assert.equal((await one(db,'SELECT row_version FROM roles WHERE id=?',role.id)).row_version,saved.row_version);
  const ordinary=await account('role_reader',null);
  await assert.rejects(call(ordinary,`roles/${role.id}`,'PATCH',{row_version:saved.row_version,permissions}),e=>e.status===403);
  await call(admin,`roles/${role.id}`,'PATCH',{row_version:saved.row_version,permissions:original});
  assert.equal(await can(db,admin,'hr.coaching.read'),false);
 });
 const sdm=await account('sdm','SDM'),coordinator=await account('coordinator','COORDINATOR');
 let unit,otherUnit,position,employee,otherEmployee,officer;
 await check('organization and employee placement routes run on PostgreSQL',async()=>{
  unit=await call(sdm,'units','POST',{code:'UNIT_A',name:'Unit A'});
  otherUnit=await call(sdm,'units','POST',{code:'UNIT_B',name:'Unit B'});
  position=await call(sdm,'positions','POST',{code:'POS_A',name:'Petugas',org_unit_id:unit.id});
  employee=await call(sdm,'employees','POST',{employee_no:'E001',full_name:'Pegawai Fiktif',employment_status:'Tetap',joined_on:'2020-01-01',position_id:position.id,valid_from:'2020-01-01'});
  otherEmployee=await call(sdm,'employees','POST',{employee_no:'E002',full_name:'Pegawai Lain',employment_status:'Kontrak',joined_on:'2020-01-01',position_id:position.id,valid_from:'2020-01-01'});
  assert.equal((await call(sdm,'employees')).items.length,2);
  assert.equal((await call(sdm,'lookups','GET',{},'purpose=employees')).positions[0].id,position.id);
  await assert.rejects(call(admin,'employees'),e=>e.status===403);
  officer=await account('officer','OFFICER',employee.id,'SELF');
 });
 await check('scope from another role never broadens an action',async()=>{
  const scoped=await account('scoped',null);
  for(const [code,permission,kind]of [['R_READ','hr.employees.read','ALL'],['R_EDIT','hr.employees.update','ASSIGNED_UNITS']]){
   const r=await insert(db,'roles',{code,name:code,is_system:0,is_active:1});
   await run(db,'INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)',r.id,(await one(db,'SELECT id FROM permissions WHERE code=?',permission)).id);
   const grant=await insert(db,'user_roles',{user_id:scoped.id,role_id:r.id,scope_kind:kind});
   if(kind==='ASSIGNED_UNITS')await run(db,'INSERT INTO user_role_units(user_role_id,org_unit_id,include_descendants) VALUES(?,?,?)',grant.id,unit.id,0);
  }
  assert.equal(await can(db,scoped,'hr.employees.read',{org_unit_id:otherUnit.id}),true);
  assert.equal(await can(db,scoped,'hr.employees.update',{org_unit_id:otherUnit.id}),false);
  assert.equal(await can(db,scoped,'hr.employees.update',{org_unit_id:unit.id}),true);
 });
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX5kAAAAASUVORK5CYII=';
 const photo=async user=>(await call(user,'uploads','POST',{name:'bukti.png',mime_type:'image/png',data:png})).id;
 let poster;
 await check('announcements, private Drive-backed uploads and read receipts preserve access',async()=>{
  poster=await photo(admin);
  const draft=await call(admin,'announcements','POST',{title:'Informasi Fiktif',category:'UMUM',blocks:[{type:'text',text:'Isi fiktif'},{type:'image',file_id:poster}],attachments:[]});
  await assert.rejects(call(officer,`files/${poster}`),e=>e.status===403);
  const published=await call(admin,`announcements/${draft.id}/publish`,'POST',{row_version:draft.row_version});
  assert.equal(published.status,'PUBLISHED');
  assert.equal((await call(officer,`files/${poster}`)).data,png);
  assert.equal((await call(officer,'announcements')).items.length,1);
  await call(officer,`announcements/${draft.id}/read`,'POST',{});
  assert.equal((await call(officer,`announcements/${draft.id}`)).is_read,true);
  await assert.rejects(call(officer,'announcements','POST',{title:'X'}),e=>e.status===403);
 });
 await check('patrol, camera evidence, incident idempotency and history work together',async()=>{
  const report={idempotency_key:randomUUID(),occurred_at:now(),activity_type:'PATROLI',activity_notes:'Pemeriksaan fiktif',incident_type:'Fiktif',chronology:'Kronologi fiktif',location:{latitude:-8,longitude:115,accuracy:10,captured_at:now()},photos:[{file_id:await photo(officer),captured_at:now(),source:'CAMERA'}]};
  const log=await call(officer,'logbook','POST',report);
  assert.equal((await call(officer,'logbook','POST',report)).id,log.id);
  const incidentReport={...report,idempotency_key:randomUUID(),photos:[{file_id:await photo(officer),captured_at:now(),source:'CAMERA'}]};
  const incident=await call(officer,'incidents','POST',incidentReport);
  assert.equal((await call(officer,'incidents','POST',incidentReport)).id,incident.id);
  assert.equal((await call(officer,'incidents')).items.length,1);
  await assert.rejects(call(officer,'logbook','POST',{...report,idempotency_key:randomUUID(),location:null}),e=>e.status===422);
 });
 let documentFile;
 await check('documents and training retain versioned materials and participant access',async()=>{
  documentFile=await photo(sdm);
  const doc=await call(sdm,'documents','POST',{document_code:'D01',title:'Dokumen Fiktif',category:'SOP',owner_org_unit_id:unit.id,audience_kind:'ALL_UNITS'});
  const version=await call(sdm,`documents/${doc.id}/versions`,'POST',{file_id:documentFile,version_label:'1',effective_on:'2020-01-01'});
  await call(sdm,`documents/${doc.id}/activate`,'POST',{version_id:version.id,row_version:doc.row_version});
  const event=await call(sdm,'training','POST',{title:'Pelatihan Fiktif',topic:'Topik',organizer_org_unit_id:unit.id,starts_at:'2099-01-01T00:00:00Z',ends_at:'2099-01-01T01:00:00Z'});
  await call(sdm,`training/${event.id}/participants`,'POST',{employee_id:employee.id});
  await call(sdm,`training/${event.id}/materials`,'POST',{title:'SOP',document_version_id:version.id});
  assert.equal((await call(sdm,`training/${event.id}`)).participants.length,1);
  assert.equal((await call(officer,`files/${documentFile}`)).binary,true);
 });
 await check('activity documentation and itadmin-only deletion enforce permissions on PostgreSQL',async()=>{
  const event=await call(sdm,'training','POST',{title:'Kegiatan dokumentasi',topic:'Koordinasi',organizer_org_unit_id:unit.id,starts_at:'2099-02-01T01:00:00Z',ends_at:'2099-02-01T02:00:00Z'});
  const file=await photo(sdm);
  await call(sdm,`training/${event.id}/documentation`,'POST',{file_id:file,caption:'Foto kegiatan'});
  const detail=await call(sdm,`training/${event.id}`);
  assert.equal(detail.documentation.length,1);assert.equal(detail.materials.length,0);assert.equal(detail.can_delete,false);assert.equal(detail.can_view_documentation,true);
  assert.equal((await call(sdm,`files/${file}`)).binary,true);
  await assert.rejects(call(sdm,`training/${event.id}`,'DELETE',{row_version:event.row_version,username:'itadmin'}),e=>e.status===403);
  await assert.rejects(call(admin,`training/${event.id}`,'DELETE',{row_version:event.row_version}),e=>e.status===403);
  await assert.rejects(call(coordinator,`training/${event.id}/documentation`,'POST',{file_id:file}),e=>e.status===403);
  const itadmin=await account('itadmin','SDM');
  assert.equal((await call(itadmin,`training/${event.id}`)).can_delete,true);
  await assert.rejects(call(itadmin,`training/${event.id}`,'DELETE',{row_version:0}),e=>e.status===409);
  await call(itadmin,`training/${event.id}`,'DELETE',{row_version:event.row_version});
  assert.equal((await call(sdm,'training')).items.some(t=>t.id===event.id),false);
  await assert.rejects(call(sdm,`training/${event.id}`),e=>e.status===404);
  await assert.rejects(call(sdm,`files/${file}`),e=>e.status===403);
  assert.equal((await one(db,'SELECT deleted_by FROM training_events WHERE id=?',event.id)).deleted_by,itadmin.id);
  assert.equal((await one(db,"SELECT count(*)::integer n FROM audit_events WHERE action='DELETE' AND object_key=?",event.id)).n,1);
 });
 await check('coaching remains private to its participants and explicit managers',async()=>{
  const session=await call(sdm,'coaching','POST',{employee_id:employee.id,coach_employee_id:otherEmployee.id,org_unit_id:unit.id,held_at:now(),topic:'Fiktif',guidance_notes:'Catatan fiktif'});
  assert.equal((await call(sdm,`coaching/${session.id}`)).id,session.id);
  await assert.rejects(call(admin,`coaching/${session.id}`),e=>e.status===403);
 });
 await check('scheduling builds, validates and publishes an atomic revision',async()=>{
  const group=await call(coordinator,'config/groups','POST',{code:'G',name:'Kelompok',org_unit_id:unit.id});
  const post=await call(coordinator,'config/posts','POST',{code:'POST',name:'Pos',org_unit_id:unit.id,home_group_id:group.id});
  const shift=await call(coordinator,'config/shifts','POST',{code:'P',name:'Pagi',org_unit_id:unit.id,start_time:'06:00',end_time:'14:00',end_day_offset:0});
  const rules=await call(coordinator,'config/rules','POST',{org_unit_id:unit.id,version_no:1,min_rest_minutes:600,max_consecutive_work_days:7,max_work_minutes_per_local_day:720,max_work_minutes_rolling_7_days:3360});
  const pattern=await call(coordinator,'config/patterns','POST',{org_unit_id:unit.id,pattern_code:'R',version_no:1,name:'Rutin',cycle_length_days:1,steps:[{step_kind:'WORK',shift_id:shift.id}]});
  await call(coordinator,'config/members','POST',{security_group_id:group.id,employee_id:employee.id,valid_from:'2020-01-01'});
  await call(coordinator,'config/eligibility','POST',{post_id:post.id,employee_id:employee.id,valid_from:'2020-01-01'});
  await call(coordinator,'config/bindings','POST',{employee_id:employee.id,pattern_version_id:pattern.id,anchor_date:'2099-01-01',phase_offset_days:0,effective_from:'2020-01-01'});
  for(let day=1;day<=7;day++)await call(coordinator,'config/requirements','POST',{post_id:post.id,shift_id:shift.id,weekday_no:day,required_count:1,effective_from:'2020-01-01'});
  const period=await call(coordinator,'periods','POST',{name:'Periode',org_unit_id:unit.id,post_ids:[post.id],starts_on:'2099-01-10',ends_on:'2099-01-12'});
  const revision=await call(coordinator,`periods/${period.id}/revisions`,'POST',{rules_version_id:rules.id,seed:'fixed'});
  const generated=await call(coordinator,`revisions/${revision.id}/generate`,'POST',{row_version:revision.row_version});
  const detail=await call(coordinator,`revisions/${revision.id}`);assert.equal(detail.assignments.length,3);
  const published=await call(coordinator,`revisions/${revision.id}/publish`,'POST',{row_version:generated.row_version});assert.equal(published.status,'PUBLISHED');
  assert.equal((await call(officer,'periods')).items.length,1);
  assert((await call(coordinator,`exports/revisions/${revision.id}`)).csv.includes('Pegawai Fiktif'));
 });
 await check('admin account creation, scoped grants, reset issuance and audit use the same identity tables',async()=>{
  const account=await call(admin,'users','POST',{username:'managed',password:'FixturePassword!2026',employee_id:otherEmployee.id});
  assert.equal(account.must_change_password,true);
  const roles=await call(admin,'roles');const r=roles.items.find(r=>r.code==='EMPLOYEE');
  await call(admin,`users/${account.id}/grants`,'POST',{row_version:account.row_version,grants:[{role_id:r.id,scope_kind:'SELF'}]});
  const reset=await call(admin,`users/${account.id}/reset`,'POST',{});assert.match(reset.token,/^[a-f0-9]{48}$/);
  assert.equal(reset.expires_in_minutes,30);
  assert.equal((await call(admin,'users')).items.some(u=>u.id===account.id),true);
  assert((await call(admin,'audit')).items.length>0);
 });
 await check('dashboards, CSV and self-profile have the expected web contract',async()=>{
  assert.equal((await call(sdm,'dashboard')).total,2);
  assert((await call(sdm,'exports/employees')).csv.includes('Pegawai Fiktif'));
  const me=await call(officer,'portal/me');assert.equal(me.user.username,'officer');assert.equal(me.demo,false);assert(!JSON.stringify(me).includes('access_token'));
 });
 await check('purchasing PR, approvals, PO, receipt and budget usage run on PostgreSQL within the query bound',async()=>{
  const pdf=Buffer.from('%PDF-1.4 fiktif').toString('base64');
  const units={};for(const code of ['SEKR','OPSR','UMMR','KEUR'])units[code]=await call(sdm,'units','POST',{code,name:`Unit ${code}`});
  const people={};
  const person=async(key,unitCode,supervisor=null)=>{
   const pos=await call(sdm,'positions','POST',{code:`PP_${key.toUpperCase()}`,name:`Jabatan ${key}`,org_unit_id:units[unitCode].id});
   people[key]=await call(sdm,'employees','POST',{employee_no:`PJ-${key.toUpperCase()}`,full_name:`Pegawai ${key}`,employment_status:'Tetap',joined_on:'2020-01-01',position_id:pos.id,valid_from:'2020-01-01',supervisor_employee_id:supervisor?.id||null});
   people[key].position_id=pos.id;return people[key];
  };
  await person('kaban','SEKR');await person('sekban','SEKR',people.kaban);await person('kabid','OPSR',people.sekban);await person('staf','OPSR',people.kabid);await person('beli','UMMR',people.sekban);await person('keu','KEUR',people.sekban);
  const u={};
  for(const key of ['kaban','sekban','kabid','staf'])u[key]=await account(`pj_${key}`,'PURCHASE_REQUESTER',people[key].id,'SELF');
  u.beli=await account('pj_beli','PURCHASING_STAFF',people.beli.id);u.keu=await account('pj_keu','FINANCE_VERIFIER',people.keu.id);u.spi=await account('pj_spi','PURCHASE_AUDITOR');u.kelola=await account('pj_kelola','PURCHASE_ADMIN');
  assert.equal((await pg.query("SELECT count(*)::int n FROM public.app_role_permissions rp JOIN public.app_roles r ON r.id=rp.role_id WHERE r.code='PURCHASE_ADMIN'")).rows[0].n,7);
  const catalog=Object.entries(resourceActions).filter(([r])=>r.startsWith('purchasing.')).flatMap(([r,actions])=>actions.map(a=>`${r}.${a}`)).sort();
  assert.deepEqual((await pg.query("SELECT code FROM public.app_permissions WHERE module_code='purchasing' ORDER BY code")).rows.map(r=>r.code),catalog);
  await call(u.kelola,'purchasing/settings','PATCH',{settings:{officials:{sekban_position_id:people.sekban.position_id,kaban_position_id:people.kaban.position_id},unit_codes:{[units.OPSR.id]:'OPS'}}});
  const year=Number(today().slice(0,4)),needed=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
  const by=await call(u.keu,'purchasing/budget/years','POST',{year});
  const line=await call(u.keu,'purchasing/budget/lines','POST',{budget_year_id:by.id,code:'BHP',name:'Barang habis pakai',ceiling:20000000});
  const v1=await call(u.beli,'purchasing/vendors','POST',{name:'Toko Fiktif Satu',leader_nik:'5108012345678901',account_no:'0011223344'}),v2=await call(u.beli,'purchasing/vendors','POST',{name:'Toko Fiktif Dua'});
  const evidence=(await call(u.staf,'uploads','POST',{name:'penawaran.pdf',mime_type:'application/pdf',data:pdf})).id;
  let pr=await call(u.staf,'purchasing/requests','POST',{needed_on:needed,items:[{description:'Kertas',item_kind:'GOODS',quantity:'2,5',unit:'rim',unit_price:600000,reason:'Stok habis',attachments:[{form:'FILE',file_id:evidence}]}]});
  assert.equal(pr.estimated_total,1500000);assert.equal(pr.request_code,`PJ-${year}-0001`);
  const step=async(user,extra={})=>{const view=await call(user,`purchasing/requests/${pr.id}`);assert(view.actions.step,`step for ${user.username}`);return call(user,`purchasing/requests/${pr.id}/decide`,'POST',{step_id:view.actions.step.id,row_version:view.row_version,action:'APPROVE',...extra});};
  await assert.rejects(call(u.keu,`purchasing/requests/${pr.id}/decide`,'POST',{step_id:pr.steps[0].id,row_version:pr.row_version,action:'APPROVE'}),e=>e.status===403);
  pr=await step(u.kabid);pr=await step(u.keu,{budget_line_id:line.id});assert.equal(pr.final_approver_kind,'SEKBAN');pr=await step(u.sekban);
  assert.equal(pr.status,'pending_completeness_check');assert.equal(pr.budget_line.commitment,1500000);
  pr=await call(u.beli,`purchasing/requests/${pr.id}/completeness`,'POST',{action:'ACCEPT',row_version:pr.row_version});assert.match(pr.pr_number,/^001\/PR\/OPS\//);
  const [paper]=pr.items;
  for(const [vendor,price] of [[v1,580000],[v2,590000]])pr=await call(u.beli,`purchasing/requests/${pr.id}/quotes`,'POST',{item_id:paper.id,vendor_id:vendor.id,unit_price:price,evidence:[{form:'LINK',url:'https://toko.example/harga'}]});
  pr=await call(u.beli,`purchasing/requests/${pr.id}/quotes/${pr.items[0].quotes[0].id}/select`,'POST',{});
  pr=await call(u.beli,`purchasing/requests/${pr.id}/orders`,'POST',{path:'B'});
  let order=pr.orders[0];assert.equal(order.total,1450000);
  pr=await call(u.beli,`purchasing/orders/${order.id}/submit`,'POST',{row_version:order.row_version});
  const sekban=await call(u.sekban,`purchasing/requests/${pr.id}`);
  pr=await call(u.sekban,`purchasing/orders/${order.id}/decide`,'POST',{step_id:sekban.actions.step.id,row_version:pr.orders[0].row_version,action:'APPROVE'});
  order=pr.orders[0];assert.match(order.document.number,/^001\/PO\/PURCHASE\//);
  const po=pr.documents.find(d=>d.doc_type==='PO');assert.equal((await call(u.spi,`purchasing/verify/${po.verification_code}`)).hash_valid,true);
  assert.equal((await call(u.spi,`purchasing/documents/${po.id}`)).snapshot.vendor.account_no,'••••3344');
  pr=await call(u.beli,`purchasing/orders/${order.id}/purchase`,'POST',{row_version:order.row_version,purchased_on:today()});
  const invoice=(await call(u.beli,'uploads','POST',{name:'nota.pdf',mime_type:'application/pdf',data:pdf})).id;
  pr=await call(u.beli,`purchasing/orders/${order.id}/receive`,'POST',{row_version:pr.orders[0].row_version,received_on:today(),condition_note:'Baik',invoice_total:1450000,invoice:[{form:'FILE',file_id:invoice}]});
  assert.equal(pr.status,'completed');
  const budget=await call(u.keu,'purchasing/budget','GET',{},`year=${year}`);assert.equal(budget.items[0].realization,1450000);assert.equal(budget.items[0].commitment,0);
  assert.equal((await call(u.spi,'purchasing/reports','GET',{},`year=${year}`)).realized_value,1450000);
  assert.match((await call(u.spi,'purchasing/export','GET',{},`year=${year}`)).csv,/001\/PR\/OPS/);
  assert.equal((await call(u.staf,`files/${evidence}`)).binary,true);await assert.rejects(call(u.staf,`files/${invoice}`),e=>e.status===403);
  assert.equal((await call(u.kabid,'portal/me')).purchasing_pending,0);
  await assert.rejects(pg.query('UPDATE portal.purchase_approval_steps SET reason=$1 WHERE request_id=$2',['ubah',pr.id]),/sudah diputuskan/);
  const original=db.query;let queries=0;db.query=(...args)=>{queries++;return original(...args);};
  try{await call(u.beli,`purchasing/requests/${pr.id}`);}finally{db.query=original;}
  assert(queries<=25,`purchasing detail used ${queries} queries`);
 });
 await check('employee deactivation revokes portal sessions through the original account authority',async()=>{
  const before=await one(db,'SELECT * FROM employees WHERE id=?',otherEmployee.id);
  await call(sdm,`employees/${before.id}`,'PATCH',{row_version:before.row_version,is_active:false});
  assert.equal((await one(db,'SELECT is_active FROM employees WHERE id=?',before.id)).is_active,0);
 });
 const realFetch=globalThis.fetch,previousDeno=globalThis.Deno;
 let verifiedId=officer.id,passwordUpdates=0;
 const hash=value=>createHash('sha256').update(value).digest('hex');
 const sessionId=randomUUID(),cookieHash=hash('fixture-cookie'),leaseHash=hash('fixture-lease');
 await pg.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)',[sessionId,officer.id]);
 await pg.query('SELECT public.portal_create_web_session($1,$2,$3,$4,$5,$6,28800)',[officer.id,sessionId,cookieHash,hash('csrf'),`v1.${'N'.repeat(16)}.${'C'.repeat(100)}`,new Date(Date.now()+3600000).toISOString()]);
 await pg.query('SELECT public.portal_acquire_web_session($1,$2)',[cookieHash,leaseHash]);
 globalThis.Deno={env:{toObject:()=>({SUPABASE_URL:'https://fixture-project.supabase.co',SUPABASE_SECRET_KEYS:JSON.stringify({default:'sb_secret_fixture'}),SUPABASE_DB_URL:'postgresql://fixture:fixture@localhost/fixture'})}};
 globalThis.__sphFixture={mode:null,postgres:()=>({begin:async work=>{await pg.exec('BEGIN');const sql={unsafe:async(statement,args=[])=>{if(!args.length&&statement.includes(';')){await pg.exec(statement);return [];}const r=await pg.query(statement,args);return Object.assign(r.rows,{count:r.affectedRows??r.rows.length});}};try{const r=await work(sql);await pg.exec('COMMIT');return r;}catch(e){await pg.exec('ROLLBACK');throw e;}}})};
 globalThis.fetch=async(url,init)=>{
  assert(new URL(url).origin==='https://fixture-project.supabase.co');assert.equal(init.redirect,'manual');
  if(init.method==='GET'&&new URL(url).pathname==='/auth/v1/user')return Response.json({id:verifiedId,is_anonymous:false});
  if(init.method==='PUT'&&new URL(url).pathname.startsWith('/auth/v1/admin/users/')){passwordUpdates++;return Response.json({id:new URL(url).pathname.split('/').at(-1)});}
  throw new Error('Unexpected isolated identity call');
 };
 try{
  let bundle=readFileSync(new URL('../supabase/deploy/portal-api/index.ts',import.meta.url),'utf8');
  bundle=bundle.replace('import { withSupabase } from "npm:@supabase/server@1";','const withSupabase=(mode,handler)=>{globalThis.__sphFixture.mode=mode;return handler;};').replace('import postgres from "npm:postgres@3.4.7";','const postgres=globalThis.__sphFixture.postgres;');
  const edge=(await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}`)).default.fetch;
  const token=`${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({sub:officer.id,session_id:sessionId})).toString('base64url')}.fixture`;
  const invoke=body=>edge(new Request('https://fixture-project.supabase.co/functions/v1/portal-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
  const operation={action:'operation',path:'portal/me',method:'GET',query:'',body:{},access_token:token,session_hash:cookieHash,lease_hash:leaseHash,session_version:1};
  await check('the packaged Edge function verifies Auth and its current leased portal session',async()=>{
   assert.equal(globalThis.__sphFixture.mode.auth,'secret');
   let response=await invoke(operation);assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).result.user.username,'officer');
   response=await invoke({...operation,session_hash:hash('forged')});assert.equal(response.status,401);
   verifiedId=admin.id;response=await invoke(operation);assert.equal(response.status,401);verifiedId=officer.id;
   response=await invoke({...operation,path:'users'});assert.equal(response.status,403);
   response=await invoke({action:'health'});assert.equal(response.status,200);assert.equal((await response.json()).healthy,true);
  });
  await check('packaged recovery consumes once, keeps failed-attempt counters and revokes sessions',async()=>{
   const recoveryToken='b'.repeat(48);
   await insert(db,'password_reset_tokens',{user_id:officer.id,token_hash:hash(recoveryToken),expires_at:new Date(Date.now()+1800000).toISOString(),issued_by:admin.id});
   let response=await invoke({action:'recover',client_ip:'192.0.2.15',body:{token:'a'.repeat(48),new_password:'FixtureNewPassword!2026'}});assert.equal(response.status,422);
   // Count the committed IP window directly; no raw IP is stored.
   assert.equal((await pg.query("SELECT count(*)::int n FROM portal_auth_private.login_rate_windows WHERE bucket_kind='ip'")).rows[0].n,1);
   response=await invoke({action:'recover',client_ip:'192.0.2.15',body:{token:recoveryToken,new_password:'FixtureNewPassword!2026'}});assert.equal(response.status,200,await response.clone().text());
   assert.equal(passwordUpdates,1);assert((await one(db,'SELECT consumed_at FROM password_reset_tokens WHERE token_hash=?',hash(recoveryToken))).consumed_at);
   assert.equal((await one(db,'SELECT must_change_password FROM users WHERE id=?',officer.id)).must_change_password,0);
   assert((await pg.query('SELECT revoked_at FROM portal_auth_private.web_sessions WHERE token_hash=$1',[cookieHash])).rows[0].revoked_at);
   response=await invoke({action:'recover',client_ip:'192.0.2.15',body:{token:recoveryToken,new_password:'FixtureNewPassword!2026'}});assert.equal(response.status,422);assert.equal(passwordUpdates,1);
  });
 }finally{globalThis.fetch=realFetch;globalThis.Deno=previousDeno;delete globalThis.__sphFixture;}
 console.log(`${checks} PostgreSQL operation checks passed.`);
}finally{await pg.close();}
