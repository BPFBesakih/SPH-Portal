import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createLeaveFixture} from './helpers/leave-fixture.mjs';
import {attendanceRoutes} from '../supabase/functions/_shared/portal/attendance.mjs';
import {can,has} from '../supabase/functions/_shared/portal/auth.mjs';
import {audit} from '../supabase/functions/_shared/portal/db.mjs';
import {summarizeAttendance,distanceMeters} from '../supabase/functions/_shared/portal/attendance-rules.mjs';

test('attendance integration: real PostgreSQL schema, scoped authorization, events and reporting',async t=>{
 const f=await createLeaveFixture();t.after(()=>f.pg.close());
 await f.pg.exec(readFileSync(new URL('../supabase/attendance/schema.sql',import.meta.url),'utf8'));
 let clock='2026-11-06T00:00:00Z',collectionEnabled=true;const files=new Map();
 const services={can,has,audit,now:()=>clock,get collectionEnabled(){return collectionEnabled;}};
 const route=(actor,path='me',method='GET',body={})=>f.atomic(async db=>{
  db.storage={put:async(bytes)=>{const id=randomUUID();files.set(id,bytes);return id;},get:async id=>files.get(id)};
  const url=new URL('https://fixture.test/attendance/'+path);
  return attendanceRoutes({db,user:{...f.actors[actor]},p:['attendance',...url.pathname.split('/').slice(2)],method,body,url},services);
 });
 const manager=f.actors.boss;
 await f.db.query("INSERT INTO user_roles(user_id,role_id,scope_kind) SELECT $1,id,'ALL' FROM roles WHERE code='ATTENDANCE_MANAGER'",[manager.id]);
 const config={enabled:true,activation_on:'2026-11-06',boundary_mode:'EXACT',minute_rounding:'FLOOR',gps_max_accuracy_m:30,gps_max_age_seconds:60,evidence_retention_days:30,evidence_policy_confirmed:true,request_day_mode:'SINGLE_DAY',privacy_notice:'Bukti dipakai untuk verifikasi absensi; retensi 30 hari.',row_version:1,reason:'Pengaturan pengujian'};
 let schedule;
 const photo={mime_type:'image/jpeg',data:Buffer.from([255,216,255,224,0,2,255,217]).toString('base64')};
 const punch=(kind='IN',extra={})=>({client_key:randomUUID(),kind,schedule_id:schedule,latitude:-8.379975,longitude:115.447373,accuracy_m:5,location_read_at:clock,capture_source:'CAMERA',photo,...extra});
 const timing={employee_id:f.actors.employee.employee_id,work_date:'2026-11-06',name:'Jadwal pengujian',day_kind:'WORK',starts_at:'2026-11-06T08:00:00+08:00',ends_at:'2026-11-06T16:00:00+08:00',checkin_opens_at:'2026-11-06T05:00:00+08:00',checkin_closes_at:'2026-11-06T16:00:00+08:00',checkout_closes_at:'2026-11-06T20:00:00+08:00',late_after:'2026-11-06T08:15:00+08:00',status:'PUBLISHED',reason:'Penetapan pengujian'};
 await t.test('coordinate seed; disabled by default; no fabricated schedule or alpa',async()=>{
  const m=await route('employee');assert.equal(m.location.latitude,-8.379975);assert.equal(m.location.longitude,115.447373);assert.equal(m.location.radius_m,100);assert.equal(m.config.enabled,false);assert.equal(m.result,null);assert.equal(m.actions.in,false);
  assert.equal((await route('employee','records')).items.length,0);
  await assert.rejects(route('employee','settings'),e=>e.status===403);
  await assert.rejects(route('boss','schedules','POST',timing),e=>e.status===409);
 });
 await t.test('policies and individual activation are required; role is not assigned implicitly',async()=>{
  await assert.rejects(route('boss','settings','PATCH',{...config,gps_max_age_seconds:null}),/Lengkapi/);
  await route('boss','settings','PATCH',config);
  await route('boss','people/'+f.actors.employee.employee_id,'PATCH',{enabled:true,active_from:'2026-11-06',location_mode:'DEFAULT',row_version:0,reason:'Uji aktivasi'});
  schedule=(await route('boss','schedules','POST',timing)).id;
  assert.equal((await route('employee')).actions.in,true);
  collectionEnabled=false;await assert.rejects(route('employee','events','POST',punch()),/belum dibuka/);collectionEnabled=true;
 });
 await t.test('server validates identity, checkout order, freshness, radius and proof',async()=>{
  await assert.rejects(route('employee','events','POST',punch('OUT')),/Belum ada absen masuk/);
  await assert.rejects(route('employee','events','POST',punch('IN',{employee_id:f.actors.peer.employee_id})),e=>e.status===403);
  await assert.rejects(route('peer','events','POST',punch()),e=>e.status===409);
  await assert.rejects(route('employee','events','POST',punch('IN',{latitude:-8.39})),/Di luar radius/);
  await assert.rejects(route('employee','events','POST',punch('IN',{accuracy_m:50})),/Akurasi/);
  await assert.rejects(route('employee','events','POST',punch('IN',{location_read_at:'2026-11-05T00:00:00Z'})),/usang/);
  await assert.rejects(route('employee','events','POST',punch('IN',{capture_source:'FILE'})),/kamera/);
  await assert.rejects(route('employee','events','POST',punch('IN',{photo:{mime_type:'image/jpeg',data:'aGVsbG8='}})),/jenis berkas/);
  assert.equal((await f.db.query('SELECT * FROM attendance_events')).length,0);
 });
 let input;
 await t.test('server clock and idempotency; duplicate submissions never create another event',async()=>{
  clock='2026-11-06T00:20:00Z';input=punch('IN',{received_at:'2026-11-06T00:00:00Z'});
  const first=await route('employee','events','POST',input);assert.equal(new Date(first.receipt.received_at).toISOString(),new Date(clock).toISOString());
  assert.equal((await route('employee','events','POST',input)).replayed,true);
  assert.equal((await route('employee','submissions/'+input.client_key)).receipt.id,first.receipt.id);
  await assert.rejects(route('employee','events','POST',{...input,latitude:0}),/data berbeda/);
  await assert.rejects(route('employee','events','POST',punch()),/sudah tercatat/);
  const me=await route('employee');assert.equal(me.result.late_minutes,5);assert.equal(me.result.status,'PRESENT');
 });
 await t.test('private evidence and direct database access are denied to another employee',async()=>{
  const detail=await route('employee','records/'+schedule),id=detail.events[0].evidence_id;
  assert.equal((await route('employee','evidence/'+id)).binary,true);
  await assert.rejects(route('peer','evidence/'+id),e=>e.status===403);
  await assert.rejects(route('peer','records/'+schedule),e=>e.status===403);
  for(const role of ['anon','authenticated','service_role'])await assert.rejects(f.pg.transaction(async tx=>{await tx.exec('SET LOCAL ROLE '+role);await tx.query('SELECT * FROM portal.attendance_events');}),/permission denied/);
  assert.equal((await f.db.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='portal' AND tablename LIKE 'attendance_%' AND rowsecurity"))[0].n,8);
 });
 await t.test('incomplete remains present after close; correction preserves original; outdated correction rejected',async()=>{
  clock='2026-11-06T12:01:00Z';assert.equal((await route('employee')).result.completeness,'INCOMPLETE');
  await assert.rejects(route('employee','events','POST',punch('OUT')),/Di luar waktu/);
  await assert.rejects(route('employee','schedules/'+schedule+'/correction','POST',{}),e=>e.status===403);
  const correction={in_at:'2026-11-06T08:20:00+08:00',out_at:'2026-11-06T16:00:00+08:00',row_version:1,reason:'Lupa keluar, diperiksa pengelola'};
  await route('boss','schedules/'+schedule+'/correction','POST',correction);
  await assert.rejects(route('boss','schedules/'+schedule+'/correction','POST',correction),e=>e.status===409);
  const d=await route('employee','records/'+schedule);assert.equal(d.actual_out_at,null);assert.equal(d.out_at,'2026-11-06T08:00:00.000Z');assert.equal(d.corrected,true);assert.equal(d.status,'PRESENT');
  assert.equal((await f.db.query('SELECT * FROM attendance_events')).length,1);
 });
 await t.test('sick/request decision, evidence review and no self approval',async()=>{
  const req={client_key:randomUUID(),work_date:'2026-11-06',kind:'SICK',reason:'Pengujian sakit',evidence:photo};
  const r=await route('employee','requests','POST',req);assert.equal((await route('employee','requests','POST',req)).replayed,true);
  await f.db.query("INSERT INTO user_roles(user_id,role_id,scope_kind) SELECT $1,id,'ALL' FROM roles WHERE code='ATTENDANCE_MANAGER'",[f.actors.employee.id]);
  await assert.rejects(route('employee','requests/'+r.id+'/decision','POST',{status:'APPROVED',row_version:1,evidence_reviewed:true}),/sendiri/);
  await f.db.query('DELETE FROM user_roles WHERE user_id=$1',[f.actors.employee.id]);
  await assert.rejects(route('boss','requests/'+r.id+'/decision','POST',{status:'APPROVED',row_version:1}),/Periksa bukti/);
  await route('boss','requests/'+r.id+'/decision','POST',{status:'APPROVED',row_version:1,evidence_reviewed:true});
  assert.equal((await route('employee','records/'+schedule)).conflict,true);
  await assert.rejects(route('employee','requests','POST',{...req,client_key:randomUUID(),kind:'PERMIT'}),/sebelum hari/);
  await assert.rejects(route('boss','requests/'+r.id+'/decision','POST',{status:'APPROVED',row_version:1,evidence_reviewed:true}),e=>e.status===409);
 });
 await t.test('scoped exports, audit trail and history stable after disabling new collection',async()=>{
  const report=await route('boss','export?scope=all');assert.equal(report.items.length,1);assert.equal(report.items[0].late_minutes,5);assert.equal(report.items[0].events,undefined);
  await assert.rejects(route('peer','export?scope=all'),e=>e.status===403);
  await f.db.query("INSERT INTO user_roles(user_id,role_id,scope_kind) SELECT $1,id,'SELF' FROM roles WHERE code='ATTENDANCE_MANAGER'",[f.actors.peer.id]);
  assert.equal((await route('peer','export?scope=all')).items.length,0);
  await assert.rejects(route('peer','records/'+schedule),e=>e.status===403);
  await assert.rejects(route('peer','settings'),e=>e.status===403);
  await route('boss','settings','PATCH',{...config,enabled:false,row_version:2});
  assert.equal((await route('employee','records')).items[0].status,'PRESENT');assert.equal((await route('employee')).actions.in,false);
  assert.ok((await f.db.query("SELECT * FROM audit_events WHERE object_type='attendance'")).length>=8);
 });
});

test('calculation boundaries and overnight working date',()=>{
 const s={status:'PUBLISHED',day_kind:'WORK',starts_at:'2026-11-06T14:00:00Z',ends_at:'2026-11-06T22:00:00Z',late_after:'2026-11-06T14:15:00Z',checkout_closes_at:'2026-11-07T00:00:00Z'};
 const cfg={boundary_mode:'EXACT',minute_rounding:'FLOOR'};
 assert.equal(summarizeAttendance(s,[],null,null,cfg,'2026-11-07T00:00:01Z',false).status,'NOT_ACTIVE');
 assert.equal(summarizeAttendance(s,[],null,{kind:'PENDING'},cfg,'2026-11-07T00:00:01Z').status,'ABSENT_PENDING');
 assert.equal(summarizeAttendance(s,[{kind:'IN',received_at:'2026-11-06T14:20:00Z'}],null,null,cfg,'2026-11-07T00:00:01Z').late_minutes,5);
 assert.equal(summarizeAttendance({...s,status:'DRAFT'},[],null,null,cfg,'2026-11-07T00:00:01Z').status,'NEEDS_SCHEDULE');
 assert.equal(distanceMeters(-8.379975,115.447373,-8.379975,115.447373),0);
});
