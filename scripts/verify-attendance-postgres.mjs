// Verifikasi modul Absensi di PostgreSQL sementara (PGlite).
//
//   node scripts/verify-attendance-postgres.mjs <pglite/dist/index.js>
//
// Memeriksa: migrasi (RLS, tanpa grant, role & izin, IT admin tanpa absensi, pemicu
// append-only), bundel Edge attendance-form (tanda tangan HP, kunci per pegawai — bukan
// kunci global portal, selfie diunggah ke Drive tiruan DI LUAR transaksi dan dihapus bila
// penyimpanan gagal, retensi lewat EdgeRuntime.waitUntil), snapshot portal-api yang sudah
// ditambal (rute attendance/*, folder Drive `absensi` dikenali saat membaca selfie), dan
// integrasi Cuti (leave_request_days) di rekap. Google tidak pernah dihubungi.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {insert,one,all,run,now,audit} from '../supabase/functions/_shared/portal/db.mjs';
import {has,can} from '../supabase/functions/_shared/portal/auth.mjs';
import {attendanceRoutes} from '../supabase/functions/_shared/portal/attendance.mjs';
import {signatureMessage,witaDate,shiftDay} from '../supabase/functions/_shared/portal/attendance-rules.mjs';
import {driveFixture} from '../tests/helpers/drive-fixture.mjs';

const {PGlite}=await import(pathToFileURL(resolve(process.argv[2]||'/tmp/pglite/node_modules/@electric-sql/pglite/dist/index.js')).href);
const pg=new PGlite(),realFetch=globalThis.fetch,priorDeno=globalThis.Deno,priorRuntime=globalThis.EdgeRuntime;let checks=0;
const check=async(name,work)=>{await work();console.log('PASS '+name);checks++;};
const cronShim=`CREATE SCHEMA IF NOT EXISTS cron;CREATE TABLE IF NOT EXISTS cron.job(jobid bigserial PRIMARY KEY,jobname text UNIQUE,schedule text NOT NULL,command text NOT NULL);
CREATE OR REPLACE FUNCTION cron.schedule(job_name text,schedule text,command text) RETURNS bigint LANGUAGE sql AS $shim$ INSERT INTO cron.job(jobname,schedule,command) VALUES(job_name,schedule,command) ON CONFLICT(jobname) DO UPDATE SET schedule=EXCLUDED.schedule,command=EXCLUDED.command RETURNING jobid $shim$;`;
const pgliteSql=sql=>sql.replace(/^\s*CREATE EXTENSION IF NOT EXISTS pg_cron\b[^;]*;\s*$/im,cronShim).replace(/^\s*COMMENT ON EXTENSION pg_cron\b[^;]*;\s*$/im,'');
const tables=['attendance_points','attendance_registration_sessions','attendance_devices','attendance_events','attendance_corrections','attendance_day_notes','attendance_reviews','attendance_reference_photos','attendance_rate_limits','attendance_state'];
const DAY=86400000,globalLock='734829610160009',POINT={latitude:-8.3741,longitude:115.4512};
const jpeg=Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.alloc(2048,9)]);
try{
  await pg.exec(`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,encrypted_password text);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id));CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO authenticated;`);
  const directory=new URL('../supabase/migrations/',import.meta.url);
  for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')).sort())await pg.exec(pgliteSql(readFileSync(new URL(name,directory),'utf8')));
  await pg.exec('SET search_path=portal,pg_catalog');
  // Pencatat transaksi: Drive tidak boleh dipanggil saat transaksi basis data terbuka.
  let inTx=false;const statements=[];
  const db={inTransaction:true,query:async(statement,args=[])=>{statements.push(statement);const result=await pg.query(statement,args);return Object.assign(result.rows,{count:result.affectedRows??result.rows.length});}};
  const atomic=async work=>{assert(!inTx,'nested transaction');await pg.exec('BEGIN');inTx=true;try{const result=await work();await pg.exec('COMMIT');return result;}catch(error){await pg.exec('ROLLBACK');throw error;}finally{inTx=false;}};
  const unsafe=async(statement,args=[])=>{statements.push(statement);if(!args.length&&statement.includes(';')){await pg.exec(statement);return [];}const r=await pg.query(statement,args);return Object.assign(r.rows,{count:r.affectedRows??r.rows.length});};
  const client={begin:async work=>atomic(()=>work({unsafe}))};
  const account=async(name,employeeId=null,roleCode=null,scope='ALL',units=[])=>{
    const id=randomUUID();await pg.query('INSERT INTO auth.users(id) VALUES($1)',[id]);
    const user=await insert(db,'users',{id,username:name,employee_id:employeeId,must_change_password:0,status:'ACTIVE',password_changed_at:now()});
    if(roleCode){const role=await one(db,'SELECT * FROM roles WHERE code=?',roleCode);const grant=await insert(db,'user_roles',{user_id:id,role_id:role.id,scope_kind:scope});
      for(const unit of units)await run(db,'INSERT INTO user_role_units(user_role_id,org_unit_id,include_descendants) VALUES(?,?,?)',grant.id,unit,0);}
    return user;
  };
  await pg.exec("INSERT INTO public.app_roles(code,name) VALUES('IT_ADMIN_FIXTURE','IT admin fixture'); INSERT INTO public.app_role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.app_roles r CROSS JOIN public.app_permissions p WHERE r.code='IT_ADMIN_FIXTURE' AND p.module_code='admin';");
  const office=await insert(db,'org_units',{code:'ABS-U0',name:'Kantor Fiktif'}),field=await insert(db,'org_units',{code:'ABS-U1',name:'Pos Fiktif',parent_id:office.id});
  const people={};
  for(const [key,name,unit,boss] of [['boss','Atasan Fiktif',office,null],['guard','Petugas Fiktif',field,'boss'],['thl','Pekerja Harian Fiktif',field,'boss']]){
    const position=await insert(db,'positions',{code:'ABS-'+key,org_unit_id:unit.id,name:'Jabatan '+name});
    people[key]=await insert(db,'employees',{employee_no:'ABS-'+key,full_name:name,employment_status:'Tetap',is_active:1,joined_on:'2020-01-01',phone:key==='guard'?'0812 3456 7890':null});
    await insert(db,'employee_placements',{employee_id:people[key].id,position_id:position.id,supervisor_employee_id:boss?people[boss].id:null,valid_from:'2020-01-01',is_primary:1});
  }
  const manager=await account('pengelola-absen',null,'ABSENSI_PENGELOLA'),coordinator=await account('koordinator-absen',null,'ABSENSI_KOORDINATOR','ASSIGNED_UNITS',[field.id]);
  const boss=await account('atasan-absen',people.boss.id),guardUser=await account('petugas-absen',people.guard.id),itAdmin=await account('itadmin-absen',null,'IT_ADMIN_FIXTURE');
  const deps={has,can,audit,readPhoto:null};
  const route=(user,path,method='GET',body={},query='')=>atomic(()=>attendanceRoutes({db,user,p:['attendance',...path.split('/').filter(Boolean)],method,body,url:new URL('https://x.invalid/?'+query)},deps));

  await check('attendance tables use RLS and grant nothing to API roles; state row seeded',async()=>{
    for(const name of tables){
      assert.equal((await pg.query("SELECT rowsecurity FROM pg_tables WHERE schemaname='portal' AND tablename=$1",[name])).rows[0]?.rowsecurity,true,name);
      for(const role of ['anon','authenticated','service_role'])assert.equal((await pg.query("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') allowed",[role,'portal.'+name])).rows[0].allowed,false,`${role} ${name}`);
    }
    assert.equal((await pg.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='portal' AND NOT rowsecurity")).rows[0].n,0,'gateway health check memerlukan RLS di semua tabel portal');
    assert.equal((await one(db,'SELECT count(*)::int n FROM attendance_state')).n,1);
    assert.equal((await pg.query("SELECT count(*)::int n FROM pg_extension WHERE extname='pg_cron'")).rows[0].n,0,'retensi tidak memakai pg_cron');
  });
  await check('role templates: Pengelola Absensi 4 izin, Koordinator HP Absen 1, Superadmin 4, IT admin dan SDM tanpa absensi',async()=>{
    const codes=async code=>(await pg.query("SELECT p.code FROM public.app_role_permissions rp JOIN public.app_roles r ON r.id=rp.role_id JOIN public.app_permissions p ON p.id=rp.permission_id WHERE r.code=$1 AND p.code LIKE 'hr.attendance.%' ORDER BY 1",[code])).rows.map(r=>r.code);
    assert.deepEqual(await codes('ABSENSI_PENGELOLA'),['hr.attendance.devices','hr.attendance.manage','hr.attendance.read','hr.attendance.settings']);
    assert.deepEqual(await codes('ABSENSI_KOORDINATOR'),['hr.attendance.devices']);
    assert.equal((await codes('SUPER_ADMIN')).length,4);assert.deepEqual(await codes('IT_ADMIN_FIXTURE'),[]);assert.deepEqual(await codes('SDM'),[]);
    assert.equal((await pg.query("SELECT name FROM public.app_roles WHERE code='ABSENSI_PENGELOLA'")).rows[0].name,'Pengelola Absensi');
    await assert.rejects(route(itAdmin,'devices'),e=>e.status===403);
  });

  // Drive tiruan + Edge attendance-form yang sudah dibundel.
  // Edge attendance-form tidak boleh memanggil Drive di dalam transaksi. Portal membaca selfie
  // di transaksi baca permintaan (tanpa kunci global), sama seperti unduhan berkas portal lain.
  const drive=driveFixture(),driveCalls=[];let portalRead=false;
  globalThis.fetch=async(url,init)=>{const host=new URL(url).hostname;if(/googleapis\.com$/.test(host)){assert(!inTx||portalRead,`Drive (${host}) dipanggil di dalam transaksi`);driveCalls.push(`${init?.method||'GET'} ${new URL(url).pathname}`);return drive.fetch(url,{...init,redirect:'manual'});}throw new Error('Unexpected network call '+url);};
  const env={SUPABASE_DB_URL:'postgresql://fixture:fixture@localhost/fixture',...drive.env};
  globalThis.Deno={env:{toObject:()=>({...env})}};
  const background=[];globalThis.EdgeRuntime={waitUntil:task=>background.push(task)};
  globalThis.__attendanceFixture={postgres:()=>client};
  const shim=source=>source.replace('import { withSupabase } from "npm:@supabase/server@1";','const withSupabase=(mode,handler)=>{if(mode.auth!=="secret")throw new Error("Unexpected auth mode");return handler;};').replace('import postgres from "npm:postgres@3.4.7";','const postgres=globalThis.__attendanceFixture.postgres;');
  const edgeSource=shim(readFileSync(new URL('../supabase/deploy/attendance-form/index.ts',import.meta.url),'utf8'));
  assert(edgeSource.includes('globalThis.__attendanceFixture.postgres')&&edgeSource.includes('const withSupabase='),'shim Edge tidak cocok dengan bundel');
  assert(!edgeSource.includes(globalLock),'attendance-form tidak boleh memakai kunci global portal');
  const edge=(await import(`data:text/javascript;base64,${Buffer.from(edgeSource).toString('base64')}`)).default.fetch;
  const invoke=async(operation,body,ip='192.0.2.10')=>{const r=await edge(new Request('https://fixture.supabase.co/functions/v1/attendance-form',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,client_ip:ip,body})}));return {status:r.status,data:await r.json()};};
  const keysFor=async()=>{const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);return {keys,public_key:{kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y}};};
  const sign=async(device,action,payload,ts=Date.now())=>{const raw=JSON.stringify(payload);const sig=Buffer.from(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},device.keys.privateKey,new TextEncoder().encode(signatureMessage(action,device.id,ts,raw)))).toString('base64url');return {device_id:device.id,ts,sig,payload:raw};};
  const submission=(employee,kind='IN',extra={})=>({client_key:randomUUID(),employee_id:employee.id,kind,location:{...POINT,accuracy:10,age_ms:1000},photo:{mime_type:'image/jpeg',data:jpeg.toString('base64'),age_ms:1000},...extra});

  const created=await route(coordinator,'devices','POST',{kind:'SHARED',org_unit_id:field.id,label:'HP Pos Fiktif'});
  const device=await keysFor();
  await check('registration through the packaged Edge function activates a shared phone once',async()=>{
    let r=await invoke('registration',{token:created.token});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.result.label,'HP Pos Fiktif');
    r=await invoke('register',{token:created.token,public_key:device.public_key,client_info:'Android fiktif'});assert.equal(r.status,200,JSON.stringify(r.data));
    device.id=r.data.result.device_id;assert.equal(r.data.result.status,'ACTIVE');
    // Balasan hilang: kiriman ulang dengan tautan dan kunci yang sama mendapat HP yang sama.
    const again=await invoke('register',{token:created.token,public_key:device.public_key,client_info:'Android fiktif'});
    assert.deepEqual([again.status,again.data.result.device_id,again.data.result.recovered],[200,device.id,true]);
    assert.equal((await invoke('register',{token:created.token,public_key:(await keysFor()).public_key})).status,404);
    const ctx=await invoke('context',await sign(device,'context',{}));assert.equal(ctx.status,200);
    assert.deepEqual(ctx.data.result.people.map(p=>p.name).sort(),['Pekerja Harian Fiktif','Petugas Fiktif']);
    assert.equal(background.length,1,'membuka halaman absen di HP aktif juga menjadwalkan retensi');await Promise.all(background.splice(0));
    const person=await invoke('person',await sign(device,'person',{employee_id:people.guard.id}));
    assert.deepEqual([person.data.result.state,person.data.result.open_since,person.data.result.last_today],['NONE',null,null],'HP bersama tanpa jam orang lain');
    assert.equal(background.length,0);
    const skew=await invoke('context',await sign(device,'context',{},Date.now()-11*60000));
    assert.equal(skew.status,401);assert.equal(skew.data.details.code,'CLOCK');assert(Number.isFinite(Date.parse(skew.data.details.server_time)));
    assert(!statements.some(s=>s.includes(globalLock)));
  });
  await route(manager,'points','POST',{name:'Titik Kantor Fiktif',...POINT,radius_m:100});
  let firstEvent;
  await check('submit: per-employee lock, no global lock, selfie uploaded to Drive outside the transaction',async()=>{
    statements.length=0;driveCalls.length=0;
    const r=await invoke('submit',await sign(device,'submit',submission(people.guard)));assert.equal(r.status,200,JSON.stringify(r.data));
    assert.deepEqual([r.data.result.kind,r.data.result.within_point,r.data.result.duplicate],['IN',true,false]);firstEvent=r.data.result.event_id;
    assert(statements.some(s=>s.includes('pg_advisory_xact_lock(hashtextextended($1,0))')),'penyimpanan diserialkan kunci per pegawai');
    assert(!statements.some(s=>s.includes(globalLock)),'tanpa kunci global portal');
    assert(driveCalls.some(c=>c.startsWith('POST /upload/drive/v3/files')),'selfie diunggah ke Drive');
    const row=await one(db,'SELECT * FROM attendance_events WHERE id=?',firstEvent);
    const file=drive.files.get(row.photo_storage_key);assert(file,'selfie tersimpan di Drive');assert.equal(file.data.toString('hex'),jpeg.toString('hex'));
    const folder=drive.files.get(file.parents[0]);assert.deepEqual([folder.name,folder.appProperties.sph_module],['SPH-Portal-Absensi','absensi']);
    assert.equal(background.length,1,'retensi dijadwalkan di latar belakang');await Promise.all(background.splice(0));
    assert((await one(db,'SELECT last_retention_at FROM attendance_state WHERE id=1')).last_retention_at);
  });
  await check('duplicates are idempotent without a second upload; outside-point refusal never uploads',async()=>{
    const body=submission(people.thl);driveCalls.length=0;
    assert.equal((await invoke('submit',await sign(device,'submit',body))).status,200);
    const again=await invoke('submit',await sign(device,'submit',body));assert.equal(again.data.result.duplicate,true);
    assert.equal(driveCalls.filter(c=>c.startsWith('POST /upload')).length,1);assert.equal(background.length,1);background.splice(0);
    driveCalls.length=0;
    const far=await invoke('submit',await sign(device,'submit',submission(people.boss,'IN',{location:{latitude:-8.3700,longitude:115.4512,accuracy:10,age_ms:1000}})));
    assert.equal(far.status,422);assert.deepEqual(Object.keys(far.data.details).sort(),['code','distance_m','point_name']);assert.equal(far.data.details.code,'OUTSIDE_POINT');
    assert.equal(driveCalls.length,0,'absen yang pasti ditolak tidak mengunggah selfie');
  });
  await check('a failure after upload deletes the Drive file again',async()=>{
    await pg.exec(`UPDATE portal.employees SET is_active=0 WHERE id='${people.boss.id}'`);
    const filesBefore=drive.files.size;driveCalls.length=0;
    // Pegawai nonaktif ditolak di pemeriksaan awal (sebelum unggah).
    assert.equal((await invoke('submit',await sign(device,'submit',submission(people.boss)))).status,404);assert.equal(driveCalls.length,0);
    await pg.exec(`UPDATE portal.employees SET is_active=1 WHERE id='${people.boss.id}'`);
    // Benturan saat penyimpanan: pemicu menolak baris; berkas yang sudah diunggah dihapus.
    await pg.exec(`CREATE FUNCTION portal.fixture_reject() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'fixture' USING ERRCODE='40001'; END $f$;
      CREATE TRIGGER fixture_reject BEFORE INSERT ON portal.attendance_events FOR EACH ROW EXECUTE FUNCTION portal.fixture_reject();`);
    try{const r=await invoke('submit',await sign(device,'submit',submission(people.boss)));assert.equal(r.status,503);assert.match(r.data.error,/bersamaan/);}
    finally{await pg.exec('DROP TRIGGER fixture_reject ON portal.attendance_events; DROP FUNCTION portal.fixture_reject();');}
    assert(driveCalls.some(c=>c.startsWith('POST /upload'))&&driveCalls.some(c=>c.startsWith('DELETE ')),JSON.stringify(driveCalls));
    assert.equal(drive.files.size,filesBefore,'selfie yang gagal disimpan dihapus lagi dari Drive');
  });
  await check('append-only trigger in PostgreSQL: only selfie removal may change an event',async()=>{
    await assert.rejects(pg.query("UPDATE portal.attendance_events SET kind='OUT' WHERE id=$1",[firstEvent]));
    await assert.rejects(pg.query('DELETE FROM portal.attendance_events WHERE id=$1',[firstEvent]));
    await assert.rejects(pg.query("UPDATE portal.attendance_events SET latitude=0 WHERE id=$1",[firstEvent]));
    const thl=await one(db,'SELECT id FROM attendance_events WHERE employee_id=? LIMIT 1',people.thl.id);
    await pg.query("UPDATE portal.attendance_events SET photo_storage_key=NULL,photo_deleted_at=$2,updated_at=$2,row_version=row_version+1 WHERE id=$1",[thl.id,now()]);
    await assert.rejects(pg.query("UPDATE portal.attendance_events SET photo_storage_key='x',photo_deleted_at=NULL WHERE id=$1",[thl.id]));
  });

  // Snapshot portal-api hasil build-attendance-deploy.mjs.
  const gateway=shim(readFileSync(new URL('../supabase/deploy/portal-api/index.ts',import.meta.url),'utf8'));
  assert(gateway.includes('p[0] === "attendance"')&&gateway.includes('absensi: "SPH-Portal-Absensi"'),'Jalankan scripts/build-attendance-deploy.mjs lebih dulu.');
  const api=await import(`data:text/javascript;base64,${Buffer.from(gateway+'\nexport {routeOperation,AppError,createDriveStorage};').toString('base64')}`);
  const storage=api.createDriveStorage(env,undefined,{module:null});
  const portal=(user,path,method='GET',body={},query='')=>atomic(()=>api.routeOperation({db:{...db,storage},user,path,method,body,query}));
  await check('patched gateway serves attendance routes with gateway AppError statuses',async()=>{
    await assert.rejects(portal(itAdmin,'attendance/devices'),e=>e instanceof api.AppError&&e.status===403);
    await assert.rejects(portal(coordinator,'attendance/points','POST',{name:'X',...POINT}),e=>e instanceof api.AppError&&e.status===403);
    const personal=await portal(coordinator,'attendance/devices','POST',{kind:'PERSONAL',owner_employee_id:people.guard.id});
    assert.equal(personal.phone,'6281234567890');assert.match(personal.token,/^[a-f0-9]{64}$/);
    const overview=await portal(boss,'attendance/overview');assert.deepEqual([overview.self,overview.subordinates,overview.manage],[true,2,true]);
    assert.equal(overview.retention,null);const settings=await portal(manager,'attendance/overview');
    assert.deepEqual([settings.retention.due_photos,typeof settings.retention.deleted_photos],[0,'number'],'jumlah selfie lewat masa simpan dihitung di PostgreSQL');
    const today=await portal(boss,'attendance/today');assert.deepEqual(today.rows.map(r=>[r.employee.name,r.status]),[['Atasan Fiktif','TIDAK_ADA_CATATAN'],['Pekerja Harian Fiktif','BELUM_PULANG'],['Petugas Fiktif','BELUM_PULANG']]);
    const mine=await portal(guardUser,'attendance/recap');assert.deepEqual(mine.employees.map(r=>r.employee.name),['Petugas Fiktif']);
    await assert.rejects(portal(guardUser,`attendance/recap/${people.thl.id}`),e=>e instanceof api.AppError&&e.status===403);
  });
  await check('patched gateway reads selfies from the absensi Drive folder and audits each view',async()=>{
    statements.length=0;driveCalls.length=0;portalRead=true;
    const photo=await portal(boss,`attendance/photos/${firstEvent}`);assert.equal(Buffer.from(photo.data,'base64').toString('hex'),jpeg.toString('hex'));
    assert(driveCalls.some(c=>c.includes('/drive/v3/files/')),'selfie dibaca dari Drive');
    assert.equal((await one(db,"SELECT count(*)::int n FROM audit_events WHERE action='VIEW_PHOTO' AND object_key=?",firstEvent)).n,1);
    await assert.rejects(portal(guardUser,`attendance/photos/${(await one(db,'SELECT id FROM attendance_events WHERE employee_id=? LIMIT 1',people.thl.id)).id}`),e=>e.status===403);
    await portal(boss,'attendance/references','POST',{employee_id:people.guard.id,event_id:firstEvent});
    assert.equal((await portal(boss,`attendance/references/${people.guard.id}`)).event_id,firstEvent);
    assert(!statements.some(s=>s.includes(globalLock)));portalRead=false;
  });
  await check('corrections, notes and approved leave are combined at read time in PostgreSQL',async()=>{
    const day=shiftDay(witaDate(Date.now()),-1),out=new Date(Date.parse(`${day}T16:00:00+08:00`)).toISOString(),inAt=new Date(Date.parse(`${day}T08:00:00+08:00`)).toISOString();
    await portal(boss,'attendance/corrections','POST',{employee_id:people.guard.id,work_date:day,in_at:inAt,out_at:out,reason:'Mesin lama dipakai'});
    await portal(boss,'attendance/notes','POST',{employee_id:people.thl.id,work_date:day,kind:'IZIN',note:'Keperluan keluarga'});
    const leaveDay=shiftDay(day,-1);
    await pg.exec("SET session_replication_role=replica");
    try{await pg.query("INSERT INTO portal.leave_request_days(request_id,employee_id,work_date,balance_year,state,leave_type) VALUES('fixture-leave',$1,$2,NULL,'APPROVED','MARRIAGE')",[people.guard.id,leaveDay]);}
    finally{await pg.exec("SET session_replication_role=DEFAULT");}
    const recap=await portal(manager,'attendance/recap','GET',{},`from=${leaveDay}&to=${day}&detail=1`);
    const guard=recap.employees.find(r=>r.employee.id===people.guard.id),thl=recap.employees.find(r=>r.employee.id===people.thl.id);
    assert.deepEqual(guard.days.map(d=>[d.date,d.status,d.minutes,d.corrected,d.leave_type]),[[leaveDay,'CUTI',null,false,'MARRIAGE'],[day,'HADIR',480,true,null]]);
    assert.deepEqual(thl.days.map(d=>[d.date,d.status]),[[day,'IZIN']]);
    assert.deepEqual([guard.summary.hadir,guard.summary.cuti,thl.summary.izin],[1,1,1]);
  });
  await check('retention in PostgreSQL deletes Drive selfies older than 90 days and keeps the reference photo',async()=>{
    const fresh=await invoke('submit',await sign(device,'submit',submission(people.boss)));assert.equal(fresh.status,200,JSON.stringify(fresh.data));
    const freshKey=(await one(db,'SELECT photo_storage_key FROM attendance_events WHERE id=?',fresh.data.result.event_id)).photo_storage_key;assert(drive.files.has(freshKey));
    await Promise.all(background.splice(0));driveCalls.length=0;
    const later=Date.now()+91*DAY;
    const {runAttendanceRetention}=await import('../supabase/functions/_shared/portal/attendance-form.mjs');
    const edgePhotos=(await import('../supabase/functions/_shared/portal/drive.mjs')).createDriveStorage(env,undefined,{module:'absensi'});
    const result=await runAttendanceRetention({runTx:work=>atomic(()=>work(db)),photos:{remove:key=>edgePhotos.remove(key),discard:key=>edgePhotos.remove(key)},nowMs:later,force:true});
    assert.equal(result.error,null);assert.equal(result.deleted,1,'selfie atasan; selfie petugas menjadi foto acuan');assert(!drive.files.has(freshKey));
    const left=await all(db,'SELECT id FROM attendance_events WHERE photo_storage_key IS NOT NULL');assert.deepEqual(left.map(r=>r.id),[firstEvent]);
    assert(driveCalls.some(c=>c.startsWith('DELETE ')),'selfie dihapus dari Drive di luar transaksi');
  });
  await check('scheduled retention operation answers at once and runs in the background (pg_cron + pg_net)',async()=>{
    background.splice(0);
    const r=await invoke('retention',{force:true},'127.0.0.1');
    assert.equal(r.status,200,JSON.stringify(r.data));assert.deepEqual(r.data.result,{started:true});
    assert.equal(background.length,1);const result=await background.splice(0)[0];
    assert.deepEqual([result.skipped,result.error],[false,null]);
    const after=(await one(db,'SELECT last_retention_at,lease_owner FROM attendance_state WHERE id=1'));
    assert(Math.abs(Date.parse(after.last_retention_at)-Date.now())<60000&&after.lease_owner===null,JSON.stringify(after));
    assert(!statements.some(s=>s.includes(globalLock)));
  });
  console.log(`${checks} attendance PostgreSQL checks passed.`);
}finally{globalThis.fetch=realFetch;globalThis.Deno=priorDeno;globalThis.EdgeRuntime=priorRuntime;delete globalThis.__attendanceFixture;await pg.close();}
