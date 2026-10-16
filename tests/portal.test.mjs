import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,sep} from 'node:path';
import {openDb,all,one,run,get,insert,now,today} from '../lib/db.mjs';
import {seedPermissions,hashPasswordSync,can,coachingAllowed,assertAdminRemains} from '../lib/auth.mjs';
import {hrRoutes} from '../lib/hr.mjs';
import {adminRoutes} from '../lib/admin.mjs';
import {securityRoutes} from '../lib/security.mjs';
import {buildSnapshot,generateAssignments,validateAssignments,shiftInterval,cycleDay,workErrors,rosterRoutes,addDays} from '../lib/roster.mjs';
import {fileAllowed,upload} from '../lib/files.mjs';
import {createApp} from '../server.mjs';
import {createBackup} from '../scripts/backup.mjs';
import {restoreBackup} from '../scripts/restore.mjs';
import {dashboard} from '../lib/read-models.mjs';
import {DatabaseSync} from 'node:sqlite';
function cleanup(directory){const absolute=resolve(directory);assert(absolute.startsWith(resolve(tmpdir())+sep)&&absolute.split(sep).at(-1).startsWith('besakih-'));rmSync(absolute,{recursive:true,force:true});}
const password='TestPassword!2026';
const hash=hashPasswordSync(password);
function fixture(t) {
  const db=openDb(':memory:');t.after(()=>db.close());seedPermissions(db);
  const unit=insert(db,'org_units',{code:'A',name:'Unit A',is_active:1}),otherUnit=insert(db,'org_units',{code:'B',name:'Unit B',is_active:1});
  const position=insert(db,'positions',{code:'A1',name:'Petugas',org_unit_id:unit.id,is_active:1}),otherPosition=insert(db,'positions',{code:'B1',name:'Petugas B',org_unit_id:otherUnit.id,is_active:1});
  const user=insert(db,'users',{username:'admin',password_hash:hash,status:'ACTIVE',must_change_password:0,failed_login_count:0,password_changed_at:now()});
  insert(db,'user_roles',{user_id:user.id,role_id:one(db,"SELECT id FROM roles WHERE code='SUPER_ADMIN'").id,scope_kind:'ALL'});
  const employees=[];
  for(let i=0;i<8;i++){const e=insert(db,'employees',{employee_no:`P${i}`,full_name:`Pegawai ${i}`,employment_status:'Kontrak',joined_on:'2020-01-01',is_active:1});insert(db,'employee_placements',{employee_id:e.id,position_id:i===7?otherPosition.id:position.id,valid_from:'2020-01-01',is_primary:1});employees.push(e);}
  function role(account,permissions,scope='ALL',unitId,postId){const r=insert(db,'roles',{code:'ROLE-'+Math.random(),name:'Test',is_active:1,is_system:0});for(const code of permissions)run(db,'INSERT INTO role_permissions (role_id,permission_id) VALUES(?,?)',r.id,one(db,'SELECT id FROM permissions WHERE code=?',code).id);const g=insert(db,'user_roles',{user_id:account.id,role_id:r.id,scope_kind:scope});if(unitId)run(db,'INSERT INTO user_role_units (user_role_id,org_unit_id,include_descendants) VALUES(?,?,?)',g.id,unitId,0);if(postId)run(db,'INSERT INTO user_role_posts (user_role_id,post_id) VALUES(?,?)',g.id,postId);return g;}
  function account(name='scoped',employeeId=employees[0].id){return insert(db,'users',{username:name,password_hash:hash,status:'ACTIVE',employee_id:employeeId,must_change_password:0,failed_login_count:0,password_changed_at:now()});}
  return {db,user,unit,otherUnit,position,employees,role,account};
}
function scheduling(t,{night=false}={}) {
  const f=fixture(t),{db,user,unit,employees}=f;
  const group=insert(db,'security_groups',{code:'G',name:'Grup',org_unit_id:unit.id,is_active:1});
  const posts=['Satu','Dua'].map((name,i)=>insert(db,'security_posts',{code:`POS${i}`,name,org_unit_id:unit.id,home_group_id:group.id,is_active:1}));
  const shift=insert(db,'shift_definitions',{code:'P',name:'Shift',org_unit_id:unit.id,start_time:night?'22:00':'06:00',end_time:night?'06:00':'14:00',end_day_offset:night?1:0,is_active:1});
  const rules=insert(db,'scheduling_rule_versions',{org_unit_id:unit.id,version_no:1,min_rest_minutes:600,max_consecutive_work_days:7,max_work_minutes_per_local_day:720,max_work_minutes_rolling_7_days:3360,is_active:1});
  const pattern=insert(db,'roster_pattern_versions',{org_unit_id:unit.id,pattern_code:'R',version_no:1,name:'Rutin',cycle_length_days:1,is_active:1});
  insert(db,'roster_pattern_steps',{pattern_version_id:pattern.id,cycle_day_no:1,step_kind:'WORK',shift_id:shift.id});
  for(const e of employees.slice(0,7)){insert(db,'security_group_members',{security_group_id:group.id,employee_id:e.id,valid_from:'2020-01-01'});for(const p of posts)insert(db,'employee_post_eligibility',{employee_id:e.id,post_id:p.id,valid_from:'2020-01-01'});insert(db,'employee_rotation_bindings',{employee_id:e.id,pattern_version_id:pattern.id,anchor_date:'2099-01-01',phase_offset_days:0,effective_from:'2020-01-01'});}
  for(const p of posts)for(let day=1;day<=7;day++)insert(db,'staffing_requirements',{post_id:p.id,shift_id:shift.id,weekday_no:day,required_count:1,effective_from:'2020-01-01',is_active:1});
  return {...f,group,posts,shift,rules,pattern};
}
const call=(handler,f,path,method='GET',body={})=>handler({db:f.db,user:f.user,p:path.split('/'),method,body,url:new URL('http://localhost')});
async function makePeriod(f,postIds=f.posts.map(p=>p.id),from='2099-01-10',to='2099-01-12'){
  return call(rosterRoutes,f,'periods','POST',{name:'Periode',org_unit_id:f.unit.id,post_ids:postIds,starts_on:from,ends_on:to});
}
async function draft(f,period,basedOn){return call(rosterRoutes,f,`periods/${period.id}/revisions`,'POST',{rules_version_id:f.rules.id,seed:'fixed',based_on_revision_id:basedOn});}
async function generate(f,r,extra={}){return call(rosterRoutes,f,`revisions/${r.id}/generate`,'POST',{row_version:r.row_version,...extra});}

test('database menjaga foreign key, unique identifier dan audit append-only',t=>{
  const f=fixture(t);assert.throws(()=>insert(f.db,'employees',{employee_no:'P0',full_name:'Duplikat',employment_status:'Kontrak',joined_on:'2020-01-01',is_active:1}),/UNIQUE/);
  assert.throws(()=>insert(f.db,'positions',{code:'INVALID',name:'X',org_unit_id:'unknown',is_active:1}),/FOREIGN KEY/);
  const a=insert(f.db,'audit_events',{action:'TEST',object_type:'test',object_key:'1',occurred_at:now(),outcome:'SUCCESS',request_id:'test'});assert.throws(()=>run(f.db,'UPDATE audit_events SET action=? WHERE id=?','NEW',a.id),/append-only/);
});
test('izin setiap tindakan tidak diperluas oleh grant menu lain',t=>{
  const f=fixture(t),u=f.account();f.role(u,['hr.employees.read']);f.role(u,['hr.employees.update'],'ASSIGNED_UNITS',f.unit.id);
  assert.equal(can(f.db,u,'hr.employees.read',{org_unit_id:f.otherUnit.id}),true);assert.equal(can(f.db,u,'hr.employees.update',{org_unit_id:f.otherUnit.id}),false);
  assert.equal(can(f.db,u,'security.incidents.read',{org_unit_id:f.unit.id}),false);
});
test('scope pos memisahkan dua pos di unit yang sama',t=>{
  const f=scheduling(t),u=f.account();f.role(u,['security.roster.read'],'ASSIGNED_POSTS',null,f.posts[0].id);
  assert.equal(can(f.db,u,'security.roster.read',{org_unit_id:f.unit.id,post_id:f.posts[0].id}),true);assert.equal(can(f.db,u,'security.roster.read',{org_unit_id:f.unit.id,post_id:f.posts[1].id}),false);
});
test('coaching sesama unit tetap privat dan Super Admin tidak mendapat akses implisit',async t=>{
  const f=fixture(t),u=f.account();f.role(u,['hr.coaching.read'],'ASSIGNED_UNITS',f.unit.id);
  const s={org_unit_id:f.unit.id,employee_id:f.employees[1].id,coach_employee_id:f.employees[2].id};assert.equal(coachingAllowed(f.db,u,'read',s),false);assert.equal(coachingAllowed(f.db,f.user,'read',s),false);
  f.role(u,['hr.coaching.manage'],'ASSIGNED_UNITS',f.unit.id);assert.equal(coachingAllowed(f.db,u,'read',s),true);
});
test('berkas pegawai tidak dapat diunduh hanya dengan mengetahui file_id',t=>{
  const f=fixture(t),u=f.account();f.role(u,['hr.employees.read']);const file=insert(f.db,'files',{storage_key:'private',original_name:'x.pdf',mime_type:'application/pdf',size_bytes:1,checksum:'hash',status:'AVAILABLE',uploaded_by:f.user.id});insert(f.db,'employee_files',{employee_id:f.employees[1].id,file_id:file.id,category:'KONTRAK',title:'Rahasia'});assert.equal(fileAllowed(f.db,u,file.id),false);assert.equal(fileAllowed(f.db,f.user,file.id),false);
  f.role(u,['hr.employee_files.read'],'SELF');assert.equal(fileAllowed(f.db,u,file.id),false);
});
test('riwayat penempatan tidak terhapus dan rantai atasan melingkar ditolak',async t=>{
  const f=fixture(t);const e=f.employees[0];await call(hrRoutes,f,`employees/${e.id}/placements`,'POST',{row_version:e.row_version,position_id:f.position.id,supervisor_employee_id:f.employees[1].id,valid_from:'2098-01-01'});
  const before=all(f.db,'SELECT * FROM employee_placements WHERE employee_id=? ORDER BY valid_from',e.id);assert.equal(before.length,2);assert.equal(before[0].valid_to,'2097-12-31');
  await assert.rejects(call(hrRoutes,f,`employees/${f.employees[1].id}/placements`,'POST',{row_version:1,position_id:f.position.id,supervisor_employee_id:e.id,valid_from:'2098-01-01'}),/siklus/);
});
test('administrator terakhir dilindungi',async t=>{
  const f=fixture(t);await assert.rejects(call(adminRoutes,f,`users/${f.user.id}`,'PATCH',{row_version:1,status:'INACTIVE'}),/Administrator terakhir/);assert.equal(get(f.db,'users',f.user.id).status,'ACTIVE');
});

test('administrator dapat mengubah izin role sistem sendiri tanpa mengganti identitas sistemnya',async t=>{
  const f=fixture(t),role=one(f.db,"SELECT * FROM roles WHERE code='SUPER_ADMIN'");
  const original=all(f.db,'SELECT p.code FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id=?',role.id).map(p=>p.code);
  const permissions=[...original,'hr.coaching.read','hr.employee_files.read'];
  const saved=await call(adminRoutes,f,`roles/${role.id}`,'PATCH',{row_version:role.row_version,permissions});
  assert.equal(saved.is_system,1);assert.equal(saved.code,'SUPER_ADMIN');
  assert.equal(can(f.db,f.user,'hr.coaching.read'),true);assert.equal(can(f.db,f.user,'hr.employee_files.read'),true);
  await assert.rejects(call(adminRoutes,f,`roles/${role.id}`,'PATCH',{row_version:saved.row_version,code:'RENAMED',permissions}),/Kode role sistem/);
  await assert.rejects(call(adminRoutes,f,`roles/${role.id}`,'PATCH',{row_version:saved.row_version,permissions:permissions.filter(p=>p!=='admin.roles.manage')}),/Administrator terakhir/);
  assert.equal(get(f.db,'roles',role.id).row_version,saved.row_version);assert.equal(can(f.db,f.user,'admin.roles.manage'),true);
});

test('akun tanpa izin kelola role tidak dapat mengubah role sistem',async t=>{
  const f=fixture(t),role=one(f.db,"SELECT * FROM roles WHERE code='SUPER_ADMIN'"),user=f.account();
  await assert.rejects(call(adminRoutes,{...f,user},`roles/${role.id}`,'PATCH',{row_version:role.row_version,permissions:['admin.roles.manage']}),e=>e.status===403);
  assert.equal(get(f.db,'roles',role.id).row_version,role.row_version);
});
test('shift lintas tengah malam memakai tanggal tugas pada awal shift',()=>{
  const interval=shiftInterval('2099-01-10',{start_time:'22:00',end_time:'06:00',end_day_offset:1});assert.equal(interval.starts_at,'2099-01-10T14:00:00.000Z');assert.equal(interval.ends_at,'2099-01-10T22:00:00.000Z');assert.equal((Date.parse(interval.ends_at)-Date.parse(interval.starts_at))/60000,480);
});
test('penyesuaian tidak menggeser anchor atau fase negatif',()=>{
  const binding={anchor_date:'2099-01-01',phase_offset_days:0};assert.equal(cycleDay(binding,'2099-01-13',5),3);assert.equal(cycleDay(binding,'2098-12-31',5),5);
});
test('jeda shift malam, batas harian lokal dan rolling 7 hari diperiksa',()=>{
  const rule={min_rest_minutes:600,max_consecutive_work_days:6,max_work_minutes_per_local_day:480,max_work_minutes_rolling_7_days:2400};const a={starts_at:'2099-01-10T14:00:00.000Z',ends_at:'2099-01-10T22:00:00.000Z'};const b={starts_at:'2099-01-11T00:00:00.000Z',ends_at:'2099-01-11T08:00:00.000Z'};
  const errors=workErrors([b],[a],rule);assert(errors.some(e=>e.includes('istirahat')));assert(errors.some(e=>e.includes('harian')));
  const week=Array.from({length:7},(_,i)=>({starts_at:`2099-01-${String(10+i).padStart(2,'0')}T00:00:00.000Z`,ends_at:`2099-01-${String(10+i).padStart(2,'0')}T08:00:00.000Z`}));assert(workErrors(week.slice(-1),week.slice(0,-1),rule).some(e=>e.includes('tujuh')));assert(workErrors(week.slice(-1),week.slice(0,-1),rule).some(e=>e.includes('berturut')));
});
test('generator deterministik dan tidak menugaskan petugas tanpa kelayakan',async t=>{
  const f=scheduling(t),period=await makePeriod(f),snapshot=buildSnapshot(f.db,period.id,f.rules.id),a=generateAssignments(snapshot,[],'same'),b=generateAssignments(snapshot,[],'same');assert.deepEqual(a,b);assert.equal(a.assignments.length,6);assert.equal(a.errors.length,0);assert(!a.assignments.some(a=>a.employee_id===f.employees[7].id));
});
test('ketidaktersediaan menghasilkan kekurangan tanpa penugasan ilegal',async t=>{
  const f=scheduling(t);for(const e of f.employees.slice(0,7))insert(f.db,'employee_unavailability',{employee_id:e.id,starts_at:'2099-01-01T00:00:00.000Z',ends_at:'2099-02-01T00:00:00.000Z',reason:'Tidak tersedia',recorded_by:f.user.id});const period=await makePeriod(f),snapshot=buildSnapshot(f.db,period.id,f.rules.id),result=generateAssignments(snapshot);assert.equal(result.assignments.length,0);assert.equal(result.gaps.length,6);let r=await draft(f,period);r=await generate(f,r);await assert.rejects(call(rosterRoutes,f,`revisions/${r.id}/publish`,'POST',{row_version:r.row_version}),/Kekurangan/);
});
test('eligibility harus mencakup seluruh shift malam',async t=>{
  const f=scheduling(t,{night:true});run(f.db,'UPDATE employee_post_eligibility SET valid_to=? WHERE employee_id=?','2099-01-10',f.employees[0].id);const period=await makePeriod(f),snapshot=buildSnapshot(f.db,period.id,f.rules.id);const a={employee_id:f.employees[0].id,post_id:f.posts[0].id,shift_id:f.shift.id,service_date:'2099-01-10',...shiftInterval('2099-01-10',f.shift),origin:'ROUTINE'};assert(validateAssignments(snapshot,[a]).some(e=>e.message.includes('Kelayakan')));
});
test('pos yang sama tidak dapat dimasukkan ke periode tumpang tindih',async t=>{
  const f=scheduling(t);await makePeriod(f,[f.posts[0].id]);await assert.rejects(makePeriod(f,[f.posts[0].id]),/bertumpang tindih/);await assert.doesNotReject(makePeriod(f,[f.posts[1].id]));
});
test('penugasan terkunci bertahan saat generasi ulang dan konflik tidak dibersihkan',async t=>{
  const f=scheduling(t),period=await makePeriod(f);let r=await draft(f,period);r=await generate(f,r);const a=one(f.db,'SELECT * FROM roster_assignments WHERE roster_revision_id=?',r.id);
  await call(rosterRoutes,f,`revisions/${r.id}/lock`,'POST',{row_version:r.row_version,assignment_id:a.id,is_locked:true,reason:'Tetap'});r=get(f.db,'roster_revisions',r.id);insert(f.db,'employee_unavailability',{employee_id:a.employee_id,starts_at:a.starts_at,ends_at:a.ends_at,reason:'Tidak tersedia',recorded_by:f.user.id});r=await generate(f,r);const retained=get(f.db,'roster_assignments',a.id);assert.equal(retained.employee_id,a.employee_id);assert.equal(retained.is_locked,1);assert(JSON.parse(r.validation_report).errors.some(e=>e.message.includes('tidak tersedia')));await assert.rejects(call(rosterRoutes,f,`revisions/${r.id}/publish`,'POST',{row_version:r.row_version}),/Publikasi ditahan/);
});
test('publikasi revisi atomik, mengabaikan versi sendiri dan menolak draf bersamaan',async t=>{
  const f=scheduling(t),period=await makePeriod(f);let r=await draft(f,period);r=await generate(f,r);await call(rosterRoutes,f,`revisions/${r.id}/publish`,'POST',{row_version:r.row_version});const second=await draft(f,period,r.id),third=await draft(f,period,r.id);await call(rosterRoutes,f,`revisions/${second.id}/publish`,'POST',{row_version:second.row_version});assert.equal(get(f.db,'roster_revisions',r.id).status,'SUPERSEDED');assert.equal(all(f.db,"SELECT * FROM roster_revisions WHERE scheduling_period_id=? AND status='PUBLISHED'",period.id).length,1);await assert.rejects(call(rosterRoutes,f,`revisions/${third.id}/publish`,'POST',{row_version:third.row_version}),/Revisi terbit berubah/);
});
test('publikasi lintas periode memeriksa petugas dan menolak snapshot tetangga yang berubah',async t=>{
  const f=scheduling(t),p1=await makePeriod(f,[f.posts[0].id]),p2=await makePeriod(f,[f.posts[1].id]);let a=await draft(f,p1),b=await draft(f,p2);a=await generate(f,a);b=await generate(f,b);await call(rosterRoutes,f,`revisions/${a.id}/publish`,'POST',{row_version:a.row_version});await assert.rejects(call(rosterRoutes,f,`revisions/${b.id}/publish`,'POST',{row_version:b.row_version}),/periode lain berubah/);b=await generate(f,get(f.db,'roster_revisions',b.id));assert.equal(JSON.parse(b.validation_report).errors.length,0);await call(rosterRoutes,f,`revisions/${b.id}/publish`,'POST',{row_version:b.row_version});
});
test('generasi sebagian rentang tidak menghapus penugasan di luar rentang',async t=>{
  const f=scheduling(t),period=await makePeriod(f);let r=await draft(f,period);r=await generate(f,r);const outside=all(f.db,'SELECT * FROM roster_assignments WHERE roster_revision_id=? AND service_date=?',r.id,'2099-01-10');r=await generate(f,r,{starts_on:'2099-01-11',ends_on:'2099-01-11'});for(const a of outside)assert.deepEqual(get(f.db,'roster_assignments',a.id),a);
});
test('dokumen masa depan tidak diaktifkan; publikasi baru mengarsipkan versi lama',async t=>{
  const f=fixture(t);const doc=await call(hrRoutes,f,'documents','POST',{document_code:'SOP1',title:'SOP',category:'SOP_SECURITY',owner_org_unit_id:f.unit.id});
  const file=()=>insert(f.db,'files',{storage_key:crypto.randomUUID(),original_name:'sop.pdf',mime_type:'application/pdf',size_bytes:1,checksum:'h',status:'AVAILABLE',uploaded_by:f.user.id});
  const v=await call(hrRoutes,f,`documents/${doc.id}/versions`,'POST',{file_id:file().id,version_label:'1',effective_on:'2099-01-01'});await assert.rejects(call(hrRoutes,f,`documents/${doc.id}/activate`,'POST',{version_id:v.id,row_version:v.row_version}),/belum tiba/);
  const a=await call(hrRoutes,f,`documents/${doc.id}/versions`,'POST',{file_id:file().id,version_label:'2',effective_on:today()});await call(hrRoutes,f,`documents/${doc.id}/activate`,'POST',{version_id:a.id,row_version:a.row_version});const b=await call(hrRoutes,f,`documents/${doc.id}/versions`,'POST',{file_id:file().id,version_label:'3',effective_on:today()});await call(hrRoutes,f,`documents/${doc.id}/activate`,'POST',{version_id:b.id,row_version:b.row_version});assert.equal(get(f.db,'document_versions',a.id).state,'ARCHIVED');
});
test('kejadian idempoten, riwayat penyelesaian dan pembukaan kembali tersimpan',async t=>{
  const f=scheduling(t);f.user.employee_id=f.employees[0].id;run(f.db,'UPDATE users SET employee_id=? WHERE id=?',f.user.employee_id,f.user.id);const photo=insert(f.db,'files',{storage_key:'camera-test',original_name:'bukti.jpg',mime_type:'image/jpeg',size_bytes:10,checksum:'test',status:'AVAILABLE',uploaded_by:f.user.id});const payload={occurred_at:now(),incident_type:'Temuan',chronology:'Kronologi',idempotency_key:'same-request',location:{latitude:-8.37,longitude:115.45,accuracy:10,captured_at:now()},photos:[{file_id:photo.id,captured_at:now(),source:'CAMERA'}]};
  const a=await call(securityRoutes,f,'incidents','POST',payload),b=await call(securityRoutes,f,'incidents','POST',payload);assert.equal(a.id,b.id);assert.equal(one(f.db,'SELECT count(*) n FROM incidents').n,1);await assert.rejects(call(securityRoutes,f,'incidents','POST',{...payload,chronology:'Berbeda'}),/laporan berbeda/);
  let i=await call(securityRoutes,f,`incidents/${a.id}/updates`,'POST',{row_version:a.row_version,status:'IN_PROGRESS',responsible_employee_id:f.employees[1].id,notes:'Ditangani'});i=await call(securityRoutes,f,`incidents/${a.id}/updates`,'POST',{row_version:i.row_version,status:'RESOLVED',notes:'Barang diserahkan'});await call(securityRoutes,f,`incidents/${a.id}/updates`,'POST',{row_version:i.row_version,status:'IN_PROGRESS',notes:'Perlu pengecekan ulang'});const history=all(f.db,'SELECT * FROM incident_updates WHERE incident_id=?',a.id);assert.equal(history.length,4);assert(history.some(h=>h.notes==='Barang diserahkan'));assert(history.some(h=>h.event_type==='REOPENED'));
});
test('HTTP: logo dan favicon PNG tersedia tanpa membuka berkas privat',async t=>{
  const f=fixture(t),directory=mkdtempSync(resolve(tmpdir(),'besakih-brand-')),{server}=createApp({db:f.db,dataDir:directory});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));cleanup(directory);});
  const origin=`http://127.0.0.1:${server.address().port}`;
  for(const [name,png] of [['mark.svg','bp-besakih.png'],['favicon.svg','favicon.png']]){
    const response=await fetch(`${origin}/assets/${name}`);
    assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/svg+xml');
    const svg=await response.text(),encoded=svg.match(/href="data:image\/png;base64,([^"]+)"/);
    assert(encoded,'Logo SVG harus menyertakan piksel PNG asli.');
    assert.deepEqual(Buffer.from(encoded[1],'base64'),readFileSync(new URL(`../public/assets/${png}`,import.meta.url)));
  }
  for(const name of ['bp-besakih.png','favicon.png']){
    const response=await fetch(`${origin}/assets/${name}`);
    assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),readFileSync(new URL(`../public/assets/${name}`,import.meta.url)));
    const head=await fetch(`${origin}/assets/${name}`,{method:'HEAD'});
    assert.equal(head.status,200);assert.equal(head.headers.get('content-type'),'image/png');assert.equal((await head.arrayBuffer()).byteLength,0);
  }
  assert.equal((await fetch(`${origin}/schema.sql`)).status,404);
  assert.equal((await fetch(`${origin}/assets/%2e%2e%2fschema.sql`)).status,404);
  assert.equal((await fetch(`${origin}/assets/favicon.png`,{method:'POST'})).status,405);
});

test('HTTP: login, CSRF, akses lintas modul, pencabutan role dan penonaktifan pegawai',async t=>{
  const f=fixture(t),scoped=f.account();f.role(scoped,['hr.employees.read'],'ASSIGNED_UNITS',f.unit.id);const directory=mkdtempSync(resolve(tmpdir(),'besakih-http-'));const {server}=createApp({db:f.db,dataDir:directory});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));cleanup(directory);});
  const origin=`http://127.0.0.1:${server.address().port}`;
  async function request(path,{method='GET',body,cookie,csrf}={}) {const response=await fetch(`${origin}/api/${path}`,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},body:body?JSON.stringify(body):undefined});const data=await response.json();return {response,data};}
  const login=await request('auth/login',{method:'POST',body:{username:scoped.username,password}});assert.equal(login.response.status,200);const cookie=login.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),csrf=login.data.csrfToken;
  assert.equal((await request('employees',{cookie})).data.items.length,7);assert.equal((await request('incidents',{cookie})).response.status,403);assert.equal((await request('auth/logout',{method:'POST',body:{},cookie})).response.status,403);
  run(f.db,'DELETE FROM user_roles WHERE user_id=?',scoped.id);assert.equal((await request('employees',{cookie})).response.status,403);f.role(scoped,['hr.employees.read'],'SELF');run(f.db,'UPDATE employees SET is_active=0 WHERE id=?',scoped.employee_id);assert.equal((await request('auth/me',{cookie})).response.status,401);
  const wrong=await request('auth/login',{method:'POST',body:{username:'does-not-exist',password:'incorrect'}});assert.equal(wrong.response.status,401);assert.match(wrong.data.error,/Username atau password/);
});
test('HTTP: wajib ganti password, reset sekali pakai, sesi logout tidak dapat digunakan ulang',async t=>{
  const f=fixture(t),directory=mkdtempSync(resolve(tmpdir(),'besakih-reset-')),{server}=createApp({db:f.db,dataDir:directory});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));cleanup(directory);});const origin=`http://127.0.0.1:${server.address().port}`;
  async function request(path,body,session){const response=await fetch(`${origin}/api/${path}`,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{})},body:body?JSON.stringify(body):undefined});return {response,data:await response.json()};}
  const login=await request('auth/login',{username:'admin',password}),session={cookie:login.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),csrf:login.data.csrfToken};const token=(await request(`users/${f.user.id}/reset`,{},session)).data.token;assert(token);assert.equal((await request('auth/me',undefined,session)).response.status,401);const reset=await request('auth/reset',{token,new_password:'NewTestPassword!2026'});assert.equal(reset.response.status,200);assert.equal((await request('auth/reset',{token,new_password:'OtherTestPassword!2026'})).response.status,422);
  const second=await request('auth/login',{username:'admin',password:'NewTestPassword!2026'}),s2={cookie:second.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),csrf:second.data.csrfToken};await request('auth/logout',{},s2);assert.equal((await request('auth/me',undefined,s2)).response.status,401);
});
test('versi data lama ditolak dan data terbaru dipertahankan',async t=>{
  const f=fixture(t),e=f.employees[0];run(f.db,'UPDATE employees SET phone=?,ended_on=? WHERE id=?','081234','2099-12-31',e.id);await call(hrRoutes,f,`employees/${e.id}`,'PATCH',{row_version:1,full_name:'Nama terbaru',employment_status:'Tetap',joined_on:e.joined_on});await assert.rejects(call(hrRoutes,f,`employees/${e.id}`,'PATCH',{row_version:1,full_name:'Nama lama',joined_on:e.joined_on}),/Data sudah berubah/);assert.equal(get(f.db,'employees',e.id).full_name,'Nama terbaru');assert.equal(get(f.db,'employees',e.id).phone,'081234');assert.equal(get(f.db,'employees',e.id).ended_on,'2099-12-31');
});
test('peserta tanpa akun dapat didaftarkan; peserta ganda ditolak dan status hadir dibedakan',async t=>{
  const f=fixture(t),event=await call(hrRoutes,f,'training','POST',{title:'Pelatihan',topic:'Layanan',organizer_org_unit_id:f.unit.id,starts_at:'2099-01-01T01:00:00Z',ends_at:'2099-01-01T03:00:00Z'});const p=await call(hrRoutes,f,`training/${event.id}/participants`,'POST',{employee_id:f.employees[0].id});assert.equal(p.attendance_status,'NOT_RECORDED');await assert.rejects(call(hrRoutes,f,`training/${event.id}/participants`,'POST',{employee_id:f.employees[0].id}),/UNIQUE/);const a=await call(hrRoutes,f,`training/${event.id}/participants/${p.id}`,'PATCH',{row_version:p.row_version,attendance_status:'ABSENT'});assert.equal(a.attendance_status,'ABSENT');assert(a.attendance_recorded_at);
});

test('hanya itadmin dapat menghapus kegiatan; audit dan relasi dipertahankan, seluruh akses kegiatan dicabut',async t=>{
  const f=fixture(t),event=await call(hrRoutes,f,'training','POST',{title:'Kegiatan uji',topic:'Koordinasi',organizer_org_unit_id:f.unit.id,starts_at:'2099-01-01T01:00:00Z',ends_at:'2099-01-01T03:00:00Z'});
  const participant=await call(hrRoutes,f,`training/${event.id}/participants`,'POST',{employee_id:f.employees[0].id});
  const file=insert(f.db,'files',{storage_key:crypto.randomUUID(),original_name:'foto.png',mime_type:'image/png',size_bytes:1,checksum:'fixture',status:'AVAILABLE',uploaded_by:f.user.id});
  await call(hrRoutes,f,`training/${event.id}/documentation`,'POST',{file_id:file.id,caption:'Dokumentasi uji'});
  assert.equal((await call(hrRoutes,f,`training/${event.id}`)).can_delete,false);
  await assert.rejects(call(hrRoutes,f,`training/${event.id}`,'DELETE',{row_version:event.row_version,username:'itadmin'}),e=>e.status===403);
  const itadmin=f.account('itadmin',null);f.role(itadmin,['hr.training.read']);const asItadmin={...f,user:itadmin};
  assert.equal((await call(hrRoutes,asItadmin,`training/${event.id}`)).can_delete,true);
  const changed=await call(hrRoutes,f,`training/${event.id}`,'PATCH',{row_version:event.row_version,status:'PLANNED'});
  assert.equal(dashboard(f.db,f.user,'hr').training_count,1);
  await assert.rejects(call(hrRoutes,asItadmin,`training/${event.id}`,'DELETE',{row_version:event.row_version}),e=>e.status===409);
  assert.equal(get(f.db,'training_events',event.id).deleted_at,null);
  assert.deepEqual(await call(hrRoutes,asItadmin,`training/${event.id}`,'DELETE',{row_version:changed.row_version}),{deleted:true});
  const deleted=get(f.db,'training_events',event.id);assert(deleted.deleted_at);assert.equal(deleted.deleted_by,itadmin.id);
  assert.equal(get(f.db,'training_participants',participant.id).training_event_id,event.id);
  assert.equal(one(f.db,"SELECT count(*) n FROM audit_events WHERE action='DELETE' AND object_key=?",event.id).n,1);
  assert.equal((await call(hrRoutes,f,'training')).items.length,0);
  assert.equal(dashboard(f.db,f.user,'hr').training_count,0);
  assert.equal((await call(hrRoutes,f,`employees/${f.employees[0].id}`)).training.length,0);
  assert.equal(fileAllowed(f.db,f.user,file.id),false);
  await assert.rejects(call(hrRoutes,f,`training/${event.id}`),e=>e.status===404);
  await assert.rejects(call(hrRoutes,f,`training/${event.id}`,'PATCH',{row_version:deleted.row_version,status:'PLANNED'}),e=>e.status===404);
  await assert.rejects(call(hrRoutes,f,`training/${event.id}/documentation`,'POST',{file_id:file.id}),e=>e.status===404);
});

test('migrasi kegiatan mempertahankan agenda dan materi lama saat database dibuka ulang',t=>{
  const directory=mkdtempSync(resolve(tmpdir(),'besakih-training-'));t.after(()=>cleanup(directory));const path=resolve(directory,'portal.sqlite');
  const legacySchema=readFileSync(new URL('../schema.sql',import.meta.url),'utf8')
    .replace(', deleted_at TEXT, deleted_by TEXT REFERENCES users(id)','')
    .replace(", usage_kind TEXT NOT NULL DEFAULT 'MATERIAL' CHECK(usage_kind IN('MATERIAL','DOCUMENTATION') AND (usage_kind='MATERIAL' OR file_id IS NOT NULL))",'');
  const legacy=new DatabaseSync(path);legacy.exec(legacySchema);
  const unit=insert(legacy,'org_units',{code:'A',name:'Unit A',is_active:1});
  const event=insert(legacy,'training_events',{title:'Kegiatan lama',topic:'Koordinasi',organizer_org_unit_id:unit.id,starts_at:'2099-01-01T01:00:00Z',ends_at:'2099-01-01T03:00:00Z',status:'PLANNED'});
  const file=insert(legacy,'files',{storage_key:crypto.randomUUID(),original_name:'materi.pdf',mime_type:'application/pdf',size_bytes:1,checksum:'fixture',status:'AVAILABLE'});
  const material=insert(legacy,'training_materials',{training_event_id:event.id,title:'Materi lama',file_id:file.id});legacy.close();
  for(let i=0;i<2;i++){
    const upgraded=openDb(path);try{assert.equal(get(upgraded,'training_events',event.id).title,'Kegiatan lama');assert.equal(get(upgraded,'training_events',event.id).deleted_at,null);assert.equal(get(upgraded,'training_materials',material.id).usage_kind,'MATERIAL');assert.equal(one(upgraded,'SELECT count(*) n FROM training_materials').n,1);assert.equal(upgraded.prepare('PRAGMA foreign_key_check').all().length,0);}finally{upgraded.close();}
  }
});

test('dokumentasi menerima foto milik pengunggah, terpisah dari materi, dan mengikuti scope serta izin kegiatan',async t=>{
  const f=fixture(t),event=await call(hrRoutes,f,'training','POST',{title:'Kegiatan uji',topic:'Koordinasi',organizer_org_unit_id:f.unit.id,starts_at:'2099-01-01T01:00:00Z',ends_at:'2099-01-01T03:00:00Z'});
  const makeFile=(mime_type='image/png',uploaded_by=f.user.id)=>insert(f.db,'files',{storage_key:crypto.randomUUID(),original_name:'foto.png',mime_type,size_bytes:1,checksum:'fixture',status:'AVAILABLE',uploaded_by});
  const pdf=makeFile('application/pdf');await assert.rejects(call(hrRoutes,f,`training/${event.id}/documentation`,'POST',{file_id:pdf.id}),/JPG atau PNG/);
  const reader=f.account('reader');f.role(reader,['hr.training.read','hr.training.download'],'ASSIGNED_UNITS',f.unit.id);
  const stolen=makeFile('image/jpeg',reader.id);await assert.rejects(call(hrRoutes,f,`training/${event.id}/documentation`,'POST',{file_id:stolen.id}),e=>e.status===403);
  const photo=makeFile();await call(hrRoutes,f,`training/${event.id}/documentation`,'POST',{file_id:photo.id,caption:'Foto bersama'});
  await call(hrRoutes,f,`training/${event.id}/materials`,'POST',{file_id:pdf.id,title:'Materi rapat',usage_kind:'DOCUMENTATION'});
  const detail=await call(hrRoutes,f,`training/${event.id}`);assert.equal(detail.materials.length,1);assert.equal(detail.materials[0].usage_kind,'MATERIAL');assert.equal(detail.documentation.length,1);assert.equal(detail.documentation[0].caption,'Foto bersama');
  assert.equal(fileAllowed(f.db,reader,photo.id),true);assert.equal((await call(hrRoutes,{...f,user:reader},`training/${event.id}`)).can_upload_documentation,false);
  await assert.rejects(call(hrRoutes,{...f,user:reader},`training/${event.id}/documentation`,'POST',{file_id:stolen.id}),e=>e.status===403);
  await assert.rejects(call(hrRoutes,f,`training/${event.id}/documentation`,'POST',{file_id:photo.id}),/sudah terhubung/);
  const outsider=f.account('outsider',null);f.role(outsider,['hr.training.read','hr.training.download','hr.training.manage'],'ASSIGNED_UNITS',f.otherUnit.id);
  assert.equal(fileAllowed(f.db,outsider,photo.id),false);await assert.rejects(call(hrRoutes,{...f,user:outsider},`training/${event.id}`),e=>e.status===403);
  await assert.rejects(call(hrRoutes,{...f,user:outsider},`training/${event.id}/documentation`,'POST',{file_id:photo.id}),e=>e.status===403);
});
test('kebutuhan yang belum lengkap tidak ditafsirkan sebagai nol',async t=>{
  const f=scheduling(t),p=await makePeriod(f);run(f.db,'DELETE FROM staffing_requirements WHERE post_id=?',f.posts[1].id);await assert.rejects(draft(f,p),/Kebutuhan rutin belum lengkap/);
});
test('perubahan master tidak menimpa waktu historis jadwal terbit',async t=>{
  const f=scheduling(t),p=await makePeriod(f);let r=await draft(f,p);r=await generate(f,r);await call(rosterRoutes,f,`revisions/${r.id}/publish`,'POST',{row_version:r.row_version});const a=one(f.db,'SELECT * FROM roster_assignments WHERE roster_revision_id=?',r.id);await call(securityRoutes,f,`config/shifts/${f.shift.id}`,'PATCH',{...f.shift,row_version:f.shift.row_version,start_time:'07:00',end_time:'15:00'});assert.deepEqual(get(f.db,'roster_assignments',a.id),a);await assert.rejects(call(rosterRoutes,f,`revisions/${r.id}/assign`,'POST',{row_version:r.row_version}),/terbit tidak dapat diubah/);
});
test('pengakuan gap memerlukan kebijakan, alasan, dan izin khusus sebelum publikasi',async t=>{
  const f=scheduling(t),p=await makePeriod(f);for(const e of f.employees.slice(0,7))run(f.db,'UPDATE employees SET is_active=0 WHERE id=?',e.id);let r=await draft(f,p);r=await generate(f,r);await assert.rejects(call(rosterRoutes,f,`revisions/${r.id}/acknowledge`,'POST',{row_version:r.row_version,reason:'Kurang petugas'}),/belum diaktifkan/);run(f.db,"UPDATE app_settings SET value='true' WHERE key='allow_gap_publication'");await assert.rejects(call(rosterRoutes,f,`revisions/${r.id}/acknowledge`,'POST',{row_version:r.row_version,reason:' '}),/Alasan/);await call(rosterRoutes,f,`revisions/${r.id}/acknowledge`,'POST',{row_version:r.row_version,reason:'Kebijakan uji: kekurangan dipantau koordinator'});r=get(f.db,'roster_revisions',r.id);await assert.doesNotReject(call(rosterRoutes,f,`revisions/${r.id}/publish`,'POST',{row_version:r.row_version}));assert(all(f.db,'SELECT * FROM roster_gaps WHERE roster_revision_id=?',r.id).every(g=>g.acknowledgment_reason));
});
test('upload menolak tipe yang tidak cocok dan backup dapat dipulihkan beserta lampiran',async t=>{
  const f=fixture(t),directory=mkdtempSync(resolve(tmpdir(),'besakih-backup-'));t.after(()=>cleanup(directory));
  assert.throws(()=>upload(f.db,f.user,{name:'x.pdf',mime_type:'application/pdf',data:Buffer.from('not-pdf').toString('base64')},directory),/Isi berkas/);
  const file=upload(f.db,f.user,{name:'test.pdf',mime_type:'application/pdf',data:Buffer.from('%PDF-1.4\nTest backup\n%%EOF').toString('base64')},directory);const backupDir=resolve(directory,'snapshot');const manifest=await createBackup(f.db,directory,backupDir);assert.equal(manifest.files.length,1);const target=resolve(directory,'restored');restoreBackup(backupDir,target);const restored=openDb(resolve(target,'portal.sqlite'));try{assert.equal(one(restored,'SELECT count(*) n FROM employees').n,8);assert.equal(get(restored,'files',file.id).checksum,get(f.db,'files',file.id).checksum);}finally{restored.close();}assert.throws(()=>restoreBackup(backupDir,target),/direktori kosong/);writeFileSync(resolve(backupDir,'files',manifest.files[0].storage_key),'corrupt');assert.throws(()=>restoreBackup(backupDir,resolve(directory,'bad-restored')),/Checksum berkas/);
});
test('akun dengan password sementara tidak dapat membuka modul sebelum mengganti password',async t=>{
  const f=fixture(t);run(f.db,'UPDATE users SET must_change_password=1 WHERE id=?',f.user.id);const {server}=createApp({db:f.db});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const origin=`http://127.0.0.1:${server.address().port}`;
  const login=await fetch(`${origin}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password})});const body=await login.json(),cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');const blocked=await fetch(`${origin}/api/employees`,{headers:{Cookie:cookie}});assert.equal(blocked.status,428);const changed=await fetch(`${origin}/api/auth/password`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':body.csrfToken},body:JSON.stringify({current_password:password,new_password:'UpdatedPassword!2026'})});assert.equal(changed.status,200);const oldSession=await fetch(`${origin}/api/auth/me`,{headers:{Cookie:cookie}});assert.equal(oldSession.status,401);
});
test('materi dari versi SOP lama tetap mengikuti hak unduh dokumen pusat',t=>{
  const f=fixture(t),u=f.account();f.role(u,['hr.training.download']);const grant=f.role(u,['hr.documents.download']);const file=insert(f.db,'files',{storage_key:crypto.randomUUID(),original_name:'sop.pdf',mime_type:'application/pdf',size_bytes:1,checksum:'h',status:'AVAILABLE',uploaded_by:f.user.id});const doc=insert(f.db,'documents',{document_code:'SOP-PRIVATE',title:'SOP Terbatas',category:'SOP',owner_org_unit_id:f.unit.id,audience_kind:'ALL_UNITS',is_archived:0});const version=insert(f.db,'document_versions',{document_id:doc.id,file_id:file.id,version_label:'1',effective_on:'2020-01-01',state:'ARCHIVED',activated_by:f.user.id,activated_at:now(),archived_at:now()});const training=insert(f.db,'training_events',{title:'Pelatihan SOP',topic:'SOP',organizer_org_unit_id:f.unit.id,starts_at:'2099-01-01T00:00:00.000Z',ends_at:'2099-01-01T01:00:00.000Z',status:'PLANNED'});insert(f.db,'training_materials',{training_event_id:training.id,title:'Materi SOP',document_version_id:version.id});assert.equal(fileAllowed(f.db,u,file.id),true);run(f.db,'DELETE FROM user_roles WHERE id=?',grant.id);assert.equal(fileAllowed(f.db,u,file.id),false);
});
test('migrasi tabel penghubung mempertahankan seluruh pemberian izin lama',t=>{
  const directory=mkdtempSync(resolve(tmpdir(),'besakih-migration-'));t.after(()=>cleanup(directory));const path=resolve(directory,'portal.sqlite');let db=openDb(path);seedPermissions(db);const before=one(db,'SELECT count(*) n FROM role_permissions').n;db.exec('ALTER TABLE role_permissions DROP COLUMN created_at; DELETE FROM schema_migrations WHERE version=2;');db.close();db=openDb(path);try{assert.equal(one(db,'SELECT count(*) n FROM role_permissions').n,before);assert.equal(one(db,'SELECT count(*) n FROM role_permissions WHERE created_at IS NULL').n,0);assert.equal(one(db,'SELECT max(version) n FROM schema_migrations').n,4);const role=insert(db,'roles',{code:'MIGRATION_TEST',name:'Role migrasi',is_system:0,is_active:1});run(db,'INSERT INTO role_permissions (role_id,permission_id) VALUES(?,?)',role.id,one(db,'SELECT id FROM permissions LIMIT 1').id);assert(one(db,'SELECT created_at FROM role_permissions WHERE role_id=?',role.id).created_at);}finally{db.close();}
});
