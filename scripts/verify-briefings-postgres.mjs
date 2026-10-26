import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {insert,one,all,today,now} from '../supabase/functions/_shared/portal/db.mjs';
import {routeOperation} from '../supabase/functions/_shared/portal/router.mjs';
import {fileAllowed} from '../supabase/functions/_shared/portal/files.mjs';
import {driveFixture} from '../tests/helpers/drive-fixture.mjs';

const {PGlite}=await import(pathToFileURL(resolve(process.argv[2]||'scripts/briefing-tools/node_modules/@electric-sql/pglite/dist/index.js')).href);
const pg=new PGlite(),drive=driveFixture(),realFetch=globalThis.fetch,priorDeno=globalThis.Deno,token='b'.repeat(64);let checks=0;
const check=async(name,work)=>{await work();console.log('PASS '+name);checks++;};
try{
  await pg.exec(`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,encrypted_password text);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id));CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO authenticated;`);
  const directory=new URL('../supabase/migrations/',import.meta.url);for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL(name,directory),'utf8'));
  await pg.exec('SET search_path=portal,pg_catalog');
  const db={inTransaction:true,query:async(statement,args=[])=>{const result=await pg.query(statement,args);return Object.assign(result.rows,{count:result.affectedRows??result.rows.length});}};
  const atomic=async work=>{await pg.exec('BEGIN');try{const result=await work();await pg.exec('COMMIT');return result;}catch(error){await pg.exec('ROLLBACK');throw error;}};
  const units=[],positions=[],employees=[];
  for(const [i,name] of ['Pelayanan','Sekretariat'].entries()){
    const unit=await insert(db,'org_units',{code:`FIXTURE${i}`,name,is_active:1});units.push(unit);
    const position=await insert(db,'positions',{code:`FIXTURE${i}`,name:`Staf ${name}`,org_unit_id:unit.id,is_active:1});positions.push(position);
    const employee=await insert(db,'employees',{employee_no:`PRIVATE${i}`,full_name:`Pegawai Contoh ${i}`,employment_status:'Tetap',joined_on:'2020-01-01',is_active:1});employees.push(employee);
    await insert(db,'employee_placements',{employee_id:employee.id,position_id:position.id,valid_from:'2020-01-01',is_primary:1});
  }
  const account=async(name,employee_id,manager=false)=>{
    const id=randomUUID();await pg.query('INSERT INTO auth.users(id) VALUES($1)',[id]);const user=await insert(db,'users',{id,username:name,employee_id,must_change_password:0,status:'ACTIVE',password_changed_at:now()});
    if(manager){const role=await one(db,"SELECT * FROM roles WHERE code='SDM'");await insert(db,'user_roles',{user_id:id,role_id:role.id,scope_kind:'ALL'});}return user;
  };
  const staff=await account('staff',employees[0].id),outsider=await account('outsider',employees[1].id),manager=await account('manager',null,true);
  const route=(user,path='briefings',method='GET',body={},query='')=>atomic(()=>routeOperation({db,user,path,method,body,query}));
  const link=await insert(db,'briefing_links',{token_hash:createHash('sha256').update(token).digest('hex'),share_token:token,label:'Wewarah Semeng',is_active:1,created_by:null});
  await check('new private tables have RLS and zero direct API grants',async()=>{
    for(const name of ['briefing_links','morning_briefings','briefing_files']){
      assert.equal((await pg.query("SELECT rowsecurity FROM pg_tables WHERE schemaname='portal' AND tablename=$1",[name])).rows[0].rowsecurity,true);
      for(const role of ['anon','authenticated','service_role'])assert.equal((await pg.query("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') allowed",[role,'portal.'+name])).rows[0].allowed,false);
    }
    assert.equal((await pg.query("SELECT count(*)::int n FROM public.app_role_permissions rp JOIN public.app_roles r ON r.id=rp.role_id JOIN public.app_permissions p ON p.id=rp.permission_id WHERE r.code='SDM' AND p.resource='hr.briefings'")).rows[0].n,2);
  });
  globalThis.__briefingFixture={postgres:()=>({begin:async work=>atomic(()=>work({unsafe:async(statement,args=[])=>{if(!args.length&&statement.includes(';')){await pg.exec(statement);return [];}const r=await pg.query(statement,args);return Object.assign(r.rows,{count:r.affectedRows??r.rows.length});}}))})};
  globalThis.Deno={env:{toObject:()=>({...drive.env,SUPABASE_DB_URL:'postgresql://fixture:fixture@localhost/fixture'})}};
  globalThis.fetch=async(url,init)=>{assert(['https://www.googleapis.com','https://oauth2.googleapis.com'].includes(new URL(url).origin));return drive.fetch(url,init);};
  let source=readFileSync(new URL('../supabase/deploy/briefing-native/index.ts',import.meta.url),'utf8');
  source=source.replace('import { withSupabase } from "npm:@supabase/server@1";','const withSupabase=(mode,handler)=>{if(mode.auth!=="secret")throw new Error("Unexpected auth mode");return handler;};').replace('import postgres from "npm:postgres@3.4.7";','const postgres=globalThis.__briefingFixture.postgres;');
  const edge=(await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default.fetch;
  const invoke=(operation,body={})=>edge(new Request('https://fixture.supabase.co/functions/v1/briefing-native',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,client_ip:'192.0.2.75',body:{token,...body}})}));
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX5kAAAAASUVORK5CYII=';
  const body={employee_id:employees[0].id,org_unit_id:units[0].id,held_on:today(),section:'Pelayanan',absent_notes:'Nihil',briefing_notes:'Arahan contoh.',photo:{mime_type:'image/png',data:png,source:'CAMERA',captured_at:now()},idempotency_key:randomUUID()};let receipt,file,row;
  await check('packaged form context exposes only choices and supports historical placements',async()=>{const r=await invoke('context');assert.equal(r.status,200,await r.clone().text());const data=(await r.json()).result;assert.equal(data.employees.length,2);assert(!JSON.stringify(data).includes('PRIVATE'));assert.equal((await invoke('read')).status,400);assert.equal((await invoke('context',{held_on:'2026-02-30'})).status,422);});
  await check('packaged submit stores one record and camera photo in a private Briefing Drive folder',async()=>{
    const r=await invoke('submit',body);assert.equal(r.status,200,await r.clone().text());receipt=(await r.json()).result;row=await one(db,'SELECT * FROM morning_briefings');file=await one(db,'SELECT * FROM files');
    assert.equal(row.employee_id,employees[0].id);assert.equal(row.created_by,null);assert.equal((await one(db,'SELECT * FROM briefing_files')).capture_source,'CAMERA');
    assert.equal(drive.files.get(drive.files.get(file.storage_key).parents[0]).name,'SPH-Portal-Briefing');assert(!drive.calls.some(c=>c.url.includes('/permissions')));
  });
  await check('packaged retry returns the same receipt with no duplicate rows or uploads',async()=>{const size=drive.files.size,r=await invoke('submit',body);assert.equal(r.status,200);assert.deepEqual((await r.json()).result,receipt);assert.equal(drive.files.size,size);assert.equal((await invoke('submit',{...body,briefing_notes:'Berbeda'})).status,409);});
  await check('generated portal list, detail and private file authorization follow the employee unit',async()=>{
    assert.equal((await route(staff)).items.length,1);assert.equal((await route(outsider)).items.length,0);assert.equal((await route(manager)).items.length,1);assert.equal((await route(staff)).can_fill,true);
    await assert.rejects(()=>route(outsider,`briefings/${row.id}`),e=>e.status===403);assert(await fileAllowed(db,staff,file.id));assert(!await fileAllowed(db,outsider,file.id));
    assert(!JSON.stringify(await route(staff)).includes(token));assert.equal((await route(staff,'briefings/form-link')).token,token);
  });
  await check('photo link rejection rolls back PostgreSQL records and only newly uploaded Drive files',async()=>{
    await pg.exec("ALTER TABLE portal.briefing_files ADD CONSTRAINT fixture_photo_failure CHECK(briefing_id='"+row.id+"')");const size=drive.files.size,r=await invoke('submit',{...body,idempotency_key:randomUUID()});assert.equal(r.status,422,await r.clone().text());assert.equal(drive.files.size,size);assert.equal((await one(db,'SELECT count(*)::int n FROM morning_briefings')).n,1);assert.equal((await one(db,'SELECT count(*)::int n FROM files')).n,1);
  });
  await check('SDM archive and restore keep audit reasons and revoke ordinary photo access',async()=>{
    const archived=await route(manager,`briefings/${row.id}`,'PATCH',{action:'archive',row_version:row.row_version,reason:'Kiriman ganda'});assert.equal((await route(staff)).items.length,0);assert(!await fileAllowed(db,staff,file.id));assert.equal((await route(manager,'briefings','GET',{},'archived=1')).items.length,1);
    await route(manager,`briefings/${row.id}`,'PATCH',{action:'restore',row_version:archived.row_version,reason:'Dipulihkan'});assert.equal((await route(staff)).items.length,1);assert.equal((await all(db,"SELECT * FROM audit_events WHERE object_type='morning_briefings' AND reason<>''")).length,2);
  });
  await check('global SDM link revocation closes public context and submission without deleting reports',async()=>{
    await route(manager,'briefings/form-link','POST',{action:'revoke',id:link.id,row_version:link.row_version});assert.equal((await invoke('context')).status,404);assert.equal((await invoke('submit',body)).status,404);assert.equal((await one(db,'SELECT count(*)::int n FROM morning_briefings')).n,1);
  });
  console.log(`${checks} briefing PostgreSQL and packaged-edge checks passed.`);
}finally{globalThis.fetch=realFetch;globalThis.Deno=priorDeno;delete globalThis.__briefingFixture;await pg.close();}
