import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,sep} from 'node:path';
import {openDb,insert,one,all,run,tx,now,today} from '../lib/db.mjs';
import {seedPermissions,hashPasswordSync,grants,has,can} from '../lib/auth.mjs';
import {audit} from '../lib/db.mjs';
import {attendanceRoutes} from '../lib/attendance.mjs';
import {attendanceFormRequest,attendanceFormLimits,runAttendanceRetention,attendanceSubmitted,attendanceRetentionDue} from '../lib/attendance-form.mjs';
import {localAttendancePhotos} from '../lib/attendance-photos.mjs';
import {attendanceRules,witaDate,shiftDay,distanceMeters,matchPoint,jumped,dayStatus,buildRecap,signatureMessage,cleanPublicKey,keyThumbprint,verifySignature,parseFlags} from '../lib/attendance-rules.mjs';
import {createApp} from '../server.mjs';

// Semua nama, nomor, dan koordinat di sini fiktif.
const HOUR=3600000,DAY=24*HOUR,password=hashPasswordSync('fixture123');
const POINT={latitude:-8.3741,longitude:115.4512};
const jpeg=Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.alloc(1500,7)]);
// Jam 08:00 WITA kemarin: selalu sudah lewat, apa pun jam tes dijalankan.
const yesterday=()=>shiftDay(today(),-1);
const wita=(day,clock)=>Date.parse(`${day}T${clock}:00+08:00`);

function memoryPhotos(){
 const files=new Map(),log=[];let onPut=null;
 return {files,log,set onPut(fn){onPut=fn;},
  async put(bytes){const key=randomUUID();files.set(key,Buffer.from(bytes));log.push(['put',key]);if(onPut)await onPut(key);return {key};},
  async discard(key){files.delete(key);log.push(['discard',key]);},
  async remove(key){if(!files.has(key)){const e=new Error('Berkas tidak ada.');e.status=404;throw e;}files.delete(key);log.push(['remove',key]);},
  get(key){return files.get(key)||null;}};
}
function fixture(t){
 const db=openDb(':memory:');t.after(()=>db.close());seedPermissions(db);
 const unit=(code,name,parent=null)=>insert(db,'org_units',{code,name,parent_id:parent,is_active:1});
 const office=unit('U0','Kantor Fiktif'),field=unit('U1','Pos Fiktif',office.id),other=unit('U2','Unit Lain Fiktif');
 const position=(code,name,u)=>insert(db,'positions',{code,name,org_unit_id:u.id,is_active:1});
 const positions={boss:position('P0','Kepala Fiktif',office),staff:position('P1','Staf Fiktif',office),guard:position('P2','Petugas Fiktif',field),guard2:position('P3','Petugas Dua',field),other:position('P4','Staf Lain',other)};
 const employee=(key,name,pos,boss=null)=>{const e=insert(db,'employees',{employee_no:`FX-${key}`,full_name:name,employment_status:'Tetap',joined_on:'2020-01-01',is_active:1});insert(db,'employee_placements',{employee_id:e.id,position_id:pos.id,supervisor_employee_id:boss?.id||null,valid_from:'2020-01-01',is_primary:1});return e;};
 const e={};
 e.boss=employee('boss','Atasan Fiktif',positions.boss);
 e.staff=employee('staff','Staf Fiktif',positions.staff,e.boss);
 e.guard=employee('guard','Petugas Fiktif',positions.guard,e.staff);
 e.guard2=employee('guard2','Petugas Dua Fiktif',positions.guard2,e.staff);
 e.other=employee('other','Pegawai Lain Fiktif',positions.other);
 e.thl=employee('thl','Pekerja Harian Fiktif',positions.guard,e.staff);
 const account=(username,employee_id=null,role=null,scope_kind='ALL',units=[])=>{
  const u=insert(db,'users',{username,password_hash:password,status:'ACTIVE',employee_id,must_change_password:0,failed_login_count:0,password_changed_at:now()});
  if(role){const g=insert(db,'user_roles',{user_id:u.id,role_id:one(db,'SELECT id FROM roles WHERE code=?',role).id,scope_kind});for(const [id,descendants] of units)run(db,'INSERT INTO user_role_units(user_role_id,org_unit_id,include_descendants) VALUES(?,?,?)',g.id,id,descendants?1:0);}
  return u;
 };
 const reader=insert(db,'roles',{code:'ABSENSI_PEMBACA_FIXTURE',name:'Pembaca absen',is_system:0,is_active:1});
 run(db,"INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE code='hr.attendance.read'",reader.id);
 const itRole=insert(db,'roles',{code:'IT_ADMIN_FIXTURE',name:'IT admin',is_system:0,is_active:1});
 for(const p of all(db,"SELECT id FROM permissions WHERE module_code='admin'"))run(db,'INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)',itRole.id,p.id);
 const users={boss:account('atasan',e.boss.id),staff:account('staf',e.staff.id),guard:account('petugas',e.guard.id),other:account('lain',e.other.id),
  manager:account('pengelola',null,'ABSENSI_PENGELOLA'),coordinator:account('koordinator',e.guard2.id,'ABSENSI_KOORDINATOR','ASSIGNED_UNITS',[[field.id,false]]),
  reader:account('pembaca',null,'ABSENSI_PEMBACA_FIXTURE','ASSIGNED_UNITS',[[office.id,true]]),admin:account('superadmin',null,'SUPER_ADMIN'),it:account('itadmin',null,'IT_ADMIN_FIXTURE'),hr:account('sdm',null,'SDM')};
 const photos=memoryPhotos(),locks=[];
 const deps={has,can,audit,readPhoto:key=>photos.get(key)};
 const route=(user,path='',method='GET',body={},query='')=>attendanceRoutes({db,user,p:['attendance',...path.split('/').filter(Boolean)],method,body,url:new URL('https://portal.test/?'+query)},deps);
 const runTx=(work,options={})=>{if(options.lock)locks.push(options.lock);return tx(db,()=>work(db));};
 const form=(action,body,{ip='192.0.2.10',nowMs=Date.now()}={})=>attendanceFormRequest({action,body,clientIp:ip,runTx,photos,nowMs,requestId:randomUUID()});
 return {db,units:{office,field,other},positions,e,users,photos,locks,route,form,runTx,deps};
}
async function newKeys(){
 const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
 const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);
 return {keys,public_key:{kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y,ext:true,key_ops:['verify']}};
}
async function sign(device,action,payload,ts=Date.now()){
 const raw=typeof payload==='string'?payload:JSON.stringify(payload);
 const bytes=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},device.keys.privateKey,new TextEncoder().encode(signatureMessage(action,device.id,ts,raw)));
 return {device_id:device.id,ts,sig:Buffer.from(bytes).toString('base64url'),payload:raw};
}
async function registerDevice(f,{owner,kind='PERSONAL',unit,label='HP Pos Fiktif',actor=f.users.manager}={}){
 const created=await f.route(actor,'devices','POST',kind==='PERSONAL'?{kind,owner_employee_id:owner.id}:{kind,org_unit_id:unit.id,label});
 const device=await newKeys();
 const r=await f.form('register',{token:created.token,public_key:device.public_key,client_info:'HP fiktif'});
 device.id=r.device_id;device.row=created.device;
 return device;
}
const submission=(employee,kind='IN',extra={})=>({client_key:randomUUID(),employee_id:employee.id,kind,location:{...POINT,accuracy:12,age_ms:1500},photo:{mime_type:'image/jpeg',data:jpeg.toString('base64'),age_ms:2000},...extra});
const submit=async(f,device,body,nowMs=Date.now())=>f.form('submit',await sign(device,'submit',body,nowMs),{nowMs});
const addPoint=(f,extra={})=>f.route(f.users.manager,'points','POST',{name:'Titik Kantor Fiktif',...POINT,radius_m:100,...extra});
const errorWith=(status,code)=>e=>e.status===status&&(!code||e.details?.code===code);

/* ---------- Aturan murni ---------- */
test('rules: distance, point matching, jumps, WITA dates and flag parsing',()=>{
 assert(Math.abs(distanceMeters(-8.3741,115.4512,-8.3741,115.4512))<0.001);
 const north=distanceMeters(-8.3741,115.4512,-8.3732,115.4512);assert(north>99&&north<101,String(north));
 const points=[{id:'a',name:'A',...POINT,radius_m:100},{id:'b',name:'B',latitude:-8.3641,longitude:115.4512,radius_m:50}];
 assert.deepEqual(matchPoint(points,-8.3742,115.4512),{point:points[0],distance:11,within:true});
 const outside=matchPoint(points,-8.3700,115.4512);assert.equal(outside.within,false);assert.equal(outside.point.id,'a');
 assert.equal(matchPoint([],0,0),null);
 // Titik yang memuat lokasi dipilih meskipun pusat titik lain lebih dekat.
 const nested=[{id:'small',name:'Kecil',...POINT,radius_m:20},{id:'big',name:'Besar',latitude:-8.3747,longitude:115.4512,radius_m:1000}];
 assert.deepEqual([matchPoint(nested,-8.37435,115.4512).point.id,matchPoint(nested,-8.37435,115.4512).within],['big',true]);
 assert.equal(matchPoint(nested,-8.37412,115.4512).point.id,'small','dua titik memuat lokasi: yang pusatnya terdekat');
 const base={recorded_at:'2026-11-04T00:00:00.000Z',...POINT,accuracy_m:10};
 assert.equal(jumped(base,{recorded_at:'2026-11-04T00:10:00.000Z',latitude:-8.8,longitude:115.4512,accuracy_m:10}),true);
 assert.equal(jumped(base,{recorded_at:'2026-11-04T05:00:00.000Z',latitude:-8.8,longitude:115.4512,accuracy_m:10}),false,'47 km dalam 5 jam masih wajar');
 assert.equal(jumped(base,{recorded_at:'2026-11-04T00:01:00.000Z',latitude:-8.3780,longitude:115.4512,accuracy_m:10}),false,'di bawah 1 km tidak dihitung melompat');
 assert.equal(jumped(null,base),false);
 assert.equal(witaDate(Date.parse('2026-11-04T16:30:00.000Z')),'2026-11-05');assert.equal(shiftDay('2026-03-01',-1),'2026-02-28');
 assert.deepEqual(parseFlags('["DI_LUAR_TITIK","BUKAN_TANDA"]'),['DI_LUAR_TITIK']);assert.deepEqual(parseFlags('rusak'),[]);
});
test('rules: day status from raw events, corrections, notes and leave; recap counts every day once',()=>{
 const day='2026-11-03',t=c=>new Date(wita(day,c)).toISOString(),later=wita(day,'23:00')+30*DAY;
 const ev=(id,kind,clock,flags=[])=>({id,employee_id:'e',kind,recorded_at:t(clock),work_date:day,flags:JSON.stringify(flags)});
 const full=dayStatus({events:[ev('1','IN','07:55'),ev('2','OUT','16:05')],nowMs:later});
 assert.deepEqual([full.status,full.minutes,full.corrected],['HADIR',490,false]);
 assert.equal(dayStatus({events:[ev('1','IN','07:55')],nowMs:wita(day,'12:00')}).status,'BELUM_PULANG');
 const missing=dayStatus({events:[ev('1','IN','07:55')],nowMs:later});assert.equal(missing.status,'TANPA_PULANG');assert(missing.flags.includes('TANPA_PULANG'));
 assert.equal(dayStatus({events:[ev('2','OUT','16:05')],nowMs:later}).status,'TANPA_MASUK');
 const fixed=dayStatus({events:[ev('1','IN','07:55')],corrections:[{out_at:t('16:00'),created_at:t('17:00')}],nowMs:later});
 assert.deepEqual([fixed.status,fixed.minutes,fixed.corrected],['HADIR',485,true]);
 const voided=dayStatus({events:[ev('1','IN','07:55'),ev('2','OUT','16:05')],corrections:[{void_event_id:'1',created_at:t('17:00')}],nowMs:later});
 assert.deepEqual([voided.status,voided.event_ids],['TANPA_MASUK',['2']]);
 assert.equal(dayStatus({note:{id:'n',kind:'SAKIT',note:''},nowMs:later}).status,'SAKIT');
 assert.equal(dayStatus({leave:{leave_type:'ANNUAL'},note:{kind:'IZIN'},nowMs:later}).status,'CUTI');
 const onLeave=dayStatus({events:[ev('1','IN','07:55'),ev('2','OUT','16:05')],leave:{leave_type:'ANNUAL'},nowMs:later});
 assert.equal(onLeave.status,'HADIR');assert(onLeave.flags.includes('SAAT_CUTI'));
 assert.equal(dayStatus({nowMs:later}).status,'TIDAK_ADA_CATATAN');
 const recap=buildRecap({employees:[{id:'e'}],events:[ev('1','IN','07:55',['DI_LUAR_TITIK']),ev('2','OUT','16:05')],notes:[{employee_id:'e',work_date:'2026-11-04',kind:'IZIN'}],
  leaveDays:[{employee_id:'e',work_date:'2026-11-05',leave_type:'ANNUAL'}],from:'2026-11-02',to:'2026-11-05',nowMs:later});
 assert.deepEqual(recap[0].summary,{hadir:1,tanpa_pulang:0,tanpa_masuk:0,belum_pulang:0,cuti:1,izin:1,sakit:0,dinas_luar:0,tanpa_catatan:1,ditandai:1,menit:490});
 assert.deepEqual(recap[0].days.map(d=>[d.date,d.status]),[['2026-11-03','HADIR'],['2026-11-04','IZIN'],['2026-11-05','CUTI']]);
});
test('rules: device keys are cleaned to public P-256 JWK and signatures bind action, device, time and payload',async()=>{
 const device=await newKeys();device.id=randomUUID();
 const key=cleanPublicKey(device.public_key);assert.deepEqual(Object.keys(key),['crv','kty','x','y']);
 assert.equal(cleanPublicKey({...device.public_key,d:'x'.repeat(43)}),null,'kunci privat tidak pernah diterima');
 assert.equal(cleanPublicKey({...device.public_key,crv:'P-384'}),null);
 assert.match(keyThumbprint(key),/^[a-f0-9]{64}$/);
 const signed=await sign(device,'context',{a:1},1000);
 assert(await verifySignature(JSON.stringify(key),signatureMessage('context',device.id,1000,signed.payload),signed.sig));
 for(const [action,id,ts,payload] of [['submit',device.id,1000,signed.payload],['context',randomUUID(),1000,signed.payload],['context',device.id,1001,signed.payload],['context',device.id,1000,'{"a":2}']])
  assert.equal(await verifySignature(JSON.stringify(key),signatureMessage(action,id,ts,payload),signed.sig),false);
});

/* ---------- Role dan izin ---------- */
test('role templates: Pengelola Absensi holds four permissions, Koordinator only devices; SDM and IT admin hold none',t=>{
 const f=fixture(t),codes=user=>new Set(grants(f.db,user).map(g=>g.code).filter(c=>c.startsWith('hr.attendance.')));
 assert.deepEqual([...codes(f.users.manager)].sort(),['hr.attendance.devices','hr.attendance.manage','hr.attendance.read','hr.attendance.settings']);
 assert.deepEqual([...codes(f.users.coordinator)],['hr.attendance.devices']);
 assert.equal(codes(f.users.admin).size,4);
 for(const user of [f.users.hr,f.users.it,f.users.boss])assert.equal(codes(user).size,0);
 assert.equal(one(f.db,"SELECT name FROM roles WHERE code='ABSENSI_PENGELOLA'").name,'Pengelola Absensi');
});
test('accounts must change a temporary password before using Absensi',async t=>{
 const f=fixture(t);run(f.db,'UPDATE users SET must_change_password=1 WHERE id=?',f.users.staff.id);
 await assert.rejects(f.route({...f.users.staff,must_change_password:1},'overview'),errorWith(428));
});

/* ---------- Pendaftaran HP ---------- */
test('personal phone: single-use WhatsApp link, owner phone for wa.me, coordinator limited to own unit',async t=>{
 const f=fixture(t);run(f.db,"UPDATE employees SET phone='0812-3456-7890' WHERE id=?",f.e.guard.id);
 await assert.rejects(f.route(f.users.coordinator,'devices','POST',{kind:'PERSONAL',owner_employee_id:f.e.other.id}),errorWith(403));
 await assert.rejects(f.route(f.users.boss,'devices','POST',{kind:'PERSONAL',owner_employee_id:f.e.staff.id}),errorWith(403));
 const created=await f.route(f.users.coordinator,'devices','POST',{kind:'PERSONAL',owner_employee_id:f.e.guard.id});
 assert.match(created.token,/^[a-f0-9]{64}$/);assert.equal(created.phone,'6281234567890');assert.equal(created.device.status,'PENDING');
 assert(!JSON.stringify(one(f.db,'SELECT * FROM attendance_devices WHERE id=?',created.device.id)).includes(created.token),'token hanya disimpan sebagai hash');
 const preview=await f.form('registration',{token:created.token});
 assert.deepEqual([preview.kind,preview.owner.name,preview.unit.name],['PERSONAL','Petugas Fiktif','Pos Fiktif']);
 const keys=await newKeys(),registered=await f.form('register',{token:created.token,public_key:keys.public_key,client_info:'Android fiktif'});
 assert.equal(registered.status,'ACTIVE');assert.equal(registered.device_id,created.device.id);
 await assert.rejects(f.form('register',{token:created.token,public_key:(await newKeys()).public_key}),errorWith(404),'tautan sekali pakai');
 await assert.rejects(f.form('registration',{token:'f'.repeat(64)}),errorWith(404));
 const second=await f.route(f.users.manager,'devices','POST',{kind:'PERSONAL',owner_employee_id:f.e.staff.id});
 assert.equal(second.phone,'','nomor tidak tercatat');
 await assert.rejects(f.form('register',{token:second.token,public_key:keys.public_key}),errorWith(409),'satu kunci untuk satu pendaftaran');
 await assert.rejects(f.form('register',{token:second.token,public_key:{...keys.public_key,x:'bukan'}}),errorWith(422));
 const shared=await f.route(f.users.coordinator,'devices','POST',{kind:'SHARED',org_unit_id:f.units.field.id,label:'HP Pos Fiktif 3'});
 assert.equal(shared.phone,'');await assert.rejects(f.route(f.users.coordinator,'devices','POST',{kind:'SHARED',org_unit_id:f.units.other.id,label:'HP Lain'}),errorWith(403));
 const list=await f.route(f.users.coordinator,'devices');
 assert.deepEqual(list.devices.map(d=>d.label).sort(),['HP Pos Fiktif 3','HP pribadi Petugas Fiktif'],'koordinator hanya melihat HP unitnya');
 assert.equal((await f.route(f.users.manager,'devices')).devices.length,3);
 const audits=all(f.db,"SELECT action FROM audit_events WHERE object_type='attendance_devices' ORDER BY occurred_at").map(a=>a.action);
 assert(audits.includes('ACTIVATE')&&audits.filter(a=>a==='CREATE').length===3);
});
test('signed requests: unknown devices, bad signatures and clock skew are refused; CLOCK carries server time',async t=>{
 const f=fixture(t),device=await registerDevice(f,{owner:f.e.guard});
 const good=await sign(device,'context',{});
 const context=await f.form('context',good);assert.equal(context.device.status,'ACTIVE');
 await assert.rejects(f.form('context',{...good,sig:good.sig.slice(0,-2)+'AA'}),errorWith(401));
 await assert.rejects(f.form('context',{...good,device_id:randomUUID()}),errorWith(401));
 await assert.rejects(f.form('search',{...good}),errorWith(401),'tanda tangan terikat ke tindakan');
 const skewed=await sign(device,'context',{},Date.now()-11*60000);
 await assert.rejects(f.form('context',skewed),e=>e.status===401&&e.details?.code==='CLOCK'&&Number.isFinite(Date.parse(e.details.server_time)));
 const other=await newKeys();other.id=device.id;
 await assert.rejects(f.form('context',await sign(other,'context',{})),errorWith(401),'kunci lain untuk ID yang sama');
});
test('shared and personal phones: owner first, recent and unit names, server search from 3 letters',async t=>{
 const f=fixture(t),personal=await registerDevice(f,{owner:f.e.guard}),shared=await registerDevice(f,{kind:'SHARED',unit:f.units.field});
 const mine=await f.form('context',await sign(personal,'context',{}));
 assert.deepEqual(mine.people[0],{id:f.e.guard.id,name:'Petugas Fiktif',position:'Petugas Fiktif',unit:'Pos Fiktif',group:'owner'});
 assert(!JSON.stringify(mine).includes('FX-'),'nomor pegawai tidak dikirim ke HP');
 const pos=await f.form('context',await sign(shared,'context',{}));
 assert.deepEqual(pos.people.map(p=>p.name).sort(),['Pekerja Harian Fiktif','Petugas Dua Fiktif','Petugas Fiktif']);assert(pos.people.every(p=>p.group==='unit'));
 assert.equal(pos.points_ready,false);
 await assert.rejects(f.form('search',await sign(shared,'search',{query:'pe'})),errorWith(422));
 const found=await f.form('search',await sign(shared,'search',{query:'lain'}));assert.deepEqual(found.people.map(p=>p.name),['Pegawai Lain Fiktif'],'menumpang di HP unit lain lewat pencarian');
 const status=await f.form('person',await sign(shared,'person',{employee_id:f.e.other.id}));assert.deepEqual([status.suggested,status.open_since],['IN',null]);
});
test('registration session: many phones at once, approval by coordinator, duplicates visible, closing rejects the rest',async t=>{
 const f=fixture(t);
 await assert.rejects(f.route(f.users.coordinator,'sessions','POST',{org_unit_id:f.units.other.id,minutes:10}),errorWith(403));
 await assert.rejects(f.route(f.users.coordinator,'sessions','POST',{org_unit_id:f.units.field.id,minutes:31}),errorWith(422));
 const opened=await f.route(f.users.coordinator,'sessions','POST',{org_unit_id:f.units.field.id,minutes:10});
 const preview=await f.form('session',{token:opened.token});assert.deepEqual(preview.people.map(p=>p.name).sort(),['Pekerja Harian Fiktif','Petugas Dua Fiktif','Petugas Fiktif']);
 const phone=async employee=>{const keys=await newKeys(),r=await f.form('session-register',{token:opened.token,employee_id:employee.id,public_key:keys.public_key});keys.id=r.device_id;assert.equal(r.status,'PENDING');return keys;};
 await assert.rejects(f.form('session-register',{token:opened.token,employee_id:f.e.other.id,public_key:(await newKeys()).public_key}),errorWith(422),'nama di luar unit sesi');
 const a=await phone(f.e.guard),b=await phone(f.e.thl),c=await phone(f.e.guard);
 const waiting=await f.form('context',await sign(a,'context',{}));assert.equal(waiting.device.status,'PENDING');assert.equal(waiting.people,undefined);
 await assert.rejects(submit(f,a,submission(f.e.guard)),errorWith(403));
 const view=(await f.route(f.users.coordinator,`sessions/${opened.session.id}`)).session;
 assert.deepEqual(view.devices.map(d=>[d.owner.name,d.duplicate_name]),[['Petugas Fiktif',true],['Pekerja Harian Fiktif',false],['Petugas Fiktif',true]]);
 const pending=id=>view.devices.find(d=>d.id===id);
 await f.route(f.users.coordinator,`devices/${a.id}/approve`,'POST',{row_version:pending(a.id).row_version});
 await f.route(f.users.coordinator,`devices/${c.id}/reject`,'POST',{row_version:pending(c.id).row_version});
 assert.equal((await f.form('context',await sign(a,'context',{}))).people[0].group,'owner');
 const fresh=(await f.route(f.users.coordinator,`sessions/${opened.session.id}`)).session;
 await f.route(f.users.coordinator,`sessions/${opened.session.id}/close`,'POST',{row_version:fresh.row_version});
 assert.equal(one(f.db,'SELECT status FROM attendance_devices WHERE id=?',b.id).status,'REJECTED');
 await assert.rejects(f.form('session',{token:opened.token}),errorWith(404));
 assert.equal((await f.route(f.users.coordinator,'devices')).sessions.length,0);
});
test('re-registering the same phone revokes the old registration only with proof of the old key',async t=>{
 const f=fixture(t),old=await registerDevice(f,{owner:f.e.guard});
 const next=await f.route(f.users.manager,'devices','POST',{kind:'SHARED',org_unit_id:f.units.field.id,label:'HP Pos Baru'});
 const keys=await newKeys();
 await assert.rejects(f.form('register',{token:next.token,public_key:keys.public_key,replaces:await sign(old,'replace',{token:'0'.repeat(64)})}),errorWith(400),'bukti terikat ke tautan baru');
 const r=await f.form('register',{token:next.token,public_key:keys.public_key,replaces:await sign(old,'replace',{token:next.token})});
 assert.equal(r.status,'ACTIVE');assert.equal(one(f.db,'SELECT status FROM attendance_devices WHERE id=?',old.id).status,'REVOKED');
 await assert.rejects(f.form('context',await sign(old,'context',{})).then(c=>{if(c.device.status!=='ACTIVE')throw Object.assign(new Error('inactive'),{status:403});}),errorWith(403));
});
test('lost replies: the same link and the same key give the same phone back; other keys stay refused',async t=>{
 const f=fixture(t);
 const created=await f.route(f.users.manager,'devices','POST',{kind:'PERSONAL',owner_employee_id:f.e.guard.id});
 const keys=await newKeys();
 const first=await f.form('register',{token:created.token,public_key:keys.public_key});
 // Sinyal putus sesudah server menyimpan: HP mengirim ulang dengan kunci yang sama.
 const again=await f.form('register',{token:created.token,public_key:keys.public_key});
 assert.deepEqual([again.device_id,again.status,again.recovered],[first.device_id,'ACTIVE',true]);
 await assert.rejects(f.form('register',{token:created.token,public_key:(await newKeys()).public_key}),errorWith(404),'tautan tetap sekali pakai untuk kunci lain');
 assert.equal(all(f.db,"SELECT id FROM audit_events WHERE action='ACTIVATE' AND object_key=?",first.device_id).length,1);
 // HP yang sudah dinonaktifkan tidak hidup lagi lewat tautan lama.
 const row=one(f.db,'SELECT row_version FROM attendance_devices WHERE id=?',first.device_id);
 await f.route(f.users.manager,`devices/${first.device_id}/revoke`,'POST',{row_version:row.row_version,reason:'HP hilang di pos'});
 await assert.rejects(f.form('register',{token:created.token,public_key:keys.public_key}),errorWith(404));
 // Sesi pendaftaran: sesi, kunci, dan nama yang sama → HP yang sama, tidak tercatat dua kali.
 const opened=await f.route(f.users.manager,'sessions','POST',{org_unit_id:f.units.field.id,minutes:10});
 const phone=await newKeys();
 const a=await f.form('session-register',{token:opened.token,employee_id:f.e.thl.id,public_key:phone.public_key});
 const b=await f.form('session-register',{token:opened.token,employee_id:f.e.thl.id,public_key:phone.public_key});
 assert.deepEqual([b.device_id,b.status,b.recovered],[a.device_id,'PENDING',true]);
 assert.equal(one(f.db,'SELECT count(*) n FROM attendance_devices WHERE session_id=?',opened.session.id).n,1);
 await assert.rejects(f.form('session-register',{token:opened.token,employee_id:f.e.guard.id,public_key:phone.public_key}),errorWith(409),'kunci yang sama untuk nama lain');
});
test('re-registering with proof from a phone the server does not know (restored backup) is allowed; known phones still need their key',async t=>{
 const f=fixture(t),known=await registerDevice(f,{owner:f.e.guard});
 const link=await f.route(f.users.manager,'devices','POST',{kind:'SHARED',org_unit_id:f.units.field.id,label:'HP Pos Pulih'});
 const preview=await f.form('registration',{token:link.token});assert(Number.isFinite(Date.parse(preview.server_time)),'jam server untuk menandatangani bukti');
 const ghost=await newKeys();ghost.id=randomUUID();
 const keys=await newKeys(),r=await f.form('register',{token:link.token,public_key:keys.public_key,replaces:await sign(ghost,'replace',{token:link.token})});
 assert.equal(r.status,'ACTIVE');
 const next=await f.route(f.users.manager,'devices','POST',{kind:'SHARED',org_unit_id:f.units.field.id,label:'HP Pos Lain'});
 const impostor=await newKeys();impostor.id=known.id;
 await assert.rejects(f.form('register',{token:next.token,public_key:(await newKeys()).public_key,replaces:await sign(impostor,'replace',{token:next.token})}),errorWith(401),'ID HP yang dikenal tanpa kuncinya');
 assert.equal(one(f.db,'SELECT status FROM attendance_devices WHERE id=?',known.id).status,'ACTIVE');
 const session=await f.route(f.users.manager,'sessions','POST',{org_unit_id:f.units.field.id,minutes:10});
 assert(Number.isFinite(Date.parse((await f.form('session',{token:session.token})).server_time)));
});
test('person status: times only for the owner on their own phone; borrowers and shared phones see the state only',async t=>{
 const f=fixture(t),personal=await registerDevice(f,{owner:f.e.guard}),shared=await registerDevice(f,{kind:'SHARED',unit:f.units.field});await addPoint(f);
 const day=yesterday(),inAt=wita(day,'07:58'),outAt=wita(day,'16:03');
 const status=async(device,employee,nowMs)=>f.form('person',await sign(device,'person',{employee_id:employee.id},nowMs),{nowMs});
 await submit(f,shared,submission(f.e.guard),inAt);
 const morning=wita(day,'09:00');
 const own=await status(personal,f.e.guard,morning);
 assert.deepEqual([own.suggested,own.state,own.open_since],['OUT','OPEN',new Date(inAt).toISOString()]);
 const borrowed=await status(shared,f.e.guard,morning);
 assert.deepEqual([borrowed.suggested,borrowed.state,borrowed.open_since,borrowed.last_today],['OUT','OPEN',null,null]);
 const friend=await status(personal,f.e.thl,morning);
 assert.deepEqual([friend.suggested,friend.state,friend.open_since,friend.last_today],['IN','NONE',null,null]);
 await submit(f,shared,submission(f.e.guard,'OUT'),outAt);
 const evening=wita(day,'17:00');
 const after=await status(shared,f.e.guard,evening);
 assert.deepEqual([after.suggested,after.state,after.open_since,after.last_today],['IN','DONE',null,null]);
 const mine=await status(personal,f.e.guard,evening);
 assert.deepEqual([mine.state,mine.last_today.kind,mine.last_today.recorded_at],['DONE','OUT',new Date(outAt).toISOString()]);
});

/* ---------- Absen ---------- */
test('check-in and check-out: inside the point, paired by the server, selfie stored once, duplicates idempotent',async t=>{
 const f=fixture(t),device=await registerDevice(f,{owner:f.e.guard});await addPoint(f);
 const day=yesterday(),inAt=wita(day,'07:58'),outAt=wita(day,'16:03');
 const first=submission(f.e.guard);const receipt=await submit(f,device,first,inAt);
 assert.deepEqual([receipt.kind,receipt.work_date,receipt.point_name,receipt.within_point,receipt.duplicate],['IN',day,'Titik Kantor Fiktif',true,false]);
 assert(attendanceSubmitted('submit',receipt));assert.deepEqual(f.locks,[`portal.attendance:${f.e.guard.id}`],'kunci per pegawai, bukan kunci global');
 const again=await submit(f,device,first,inAt+5000);assert.equal(again.duplicate,true);assert.equal(again.event_id,receipt.event_id);assert(!attendanceSubmitted('submit',again));
 assert.equal(f.photos.log.filter(([op])=>op==='put').length,1,'kiriman ulang tidak mengunggah selfie lagi');
 await assert.rejects(submit(f,device,{...first,kind:'OUT'},inAt+6000),errorWith(409));
 const person=await f.form('person',await sign(device,'person',{employee_id:f.e.guard.id},inAt+3600000),{nowMs:inAt+3600000});
 assert.deepEqual([person.suggested,person.open_since],['OUT',new Date(inAt).toISOString()]);
 const out=await submit(f,device,submission(f.e.guard,'OUT'),outAt);assert.equal(out.work_date,day);
 const rows=all(f.db,'SELECT * FROM attendance_events ORDER BY recorded_at');
 assert.equal(rows[1].pair_event_id,rows[0].id);assert.deepEqual(parseFlags(rows[0].flags),['TANPA_FOTO_ACUAN']);assert.deepEqual(parseFlags(rows[1].flags),[]);
 assert.equal(rows[0].photo_size,jpeg.length);assert.match(rows[0].photo_checksum,/^[a-f0-9]{64}$/);
 assert.equal(f.photos.files.get(rows[0].photo_storage_key).length,jpeg.length);
 assert.equal(one(f.db,'SELECT last_seen_at FROM attendance_devices WHERE id=?',device.id).last_seen_at,new Date(outAt).toISOString());
});
test('night shift: check-out after midnight belongs to the check-in work date',async t=>{
 const f=fixture(t),device=await registerDevice(f,{kind:'SHARED',unit:f.units.field});await addPoint(f);
 const day=shiftDay(today(),-2),inAt=wita(day,'21:00'),outAt=wita(shiftDay(day,1),'05:30');
 await submit(f,device,submission(f.e.guard),inAt);const out=await submit(f,device,submission(f.e.guard,'OUT'),outAt);
 assert.equal(out.work_date,day);
 const recap=await f.route(f.users.staff,`recap/${f.e.guard.id}`,'GET',{},`from=${day}&to=${shiftDay(day,1)}`);
 assert.deepEqual(recap.days.map(d=>[d.date,d.status,d.minutes]),[[day,'HADIR',510]]);
});
test('outside the point: refused before upload without a reason, recorded and flagged with one',async t=>{
 const f=fixture(t),device=await registerDevice(f,{owner:f.e.guard});await addPoint(f);
 const far={...submission(f.e.guard),location:{latitude:-8.3700,longitude:115.4512,accuracy:15,age_ms:1000}};
 await assert.rejects(submit(f,device,far),e=>e.status===422&&e.details.code==='OUTSIDE_POINT'&&e.details.point_name==='Titik Kantor Fiktif'&&e.details.distance_m>400);
 assert.equal(f.photos.log.length,0,'selfie tidak diunggah bila absen pasti ditolak');
 await assert.rejects(submit(f,device,{...far,outside:{reason:'LAINNYA',note:''}}),errorWith(422));
 const r=await submit(f,device,{...far,outside:{reason:'TUGAS_LAPANGAN',note:'Patroli fiktif'}});
 assert.equal(r.within_point,false);
 const row=one(f.db,'SELECT * FROM attendance_events WHERE id=?',r.event_id);
 assert.deepEqual([row.outside_reason,row.outside_note],['TUGAS_LAPANGAN','Patroli fiktif']);assert(parseFlags(row.flags).includes('DI_LUAR_TITIK'));
});
test('flags: no point yet, weak GPS, impossible jump, crowded personal phone, check-out without check-in',async t=>{
 const f=fixture(t),device=await registerDevice(f,{owner:f.e.guard});
 const day=yesterday(),at=c=>wita(day,c);
 const r1=await submit(f,device,{...submission(f.e.guard),location:{...POINT,accuracy:150,age_ms:1000}},at('07:00'));
 assert.deepEqual(parseFlags(one(f.db,'SELECT flags FROM attendance_events WHERE id=?',r1.event_id).flags).sort(),['GPS_KURANG_AKURAT','TANPA_FOTO_ACUAN','TITIK_BELUM_ADA']);
 const r2=await submit(f,device,{...submission(f.e.guard,'OUT'),location:{latitude:-8.80,longitude:115.4512,accuracy:20,age_ms:1000}},at('07:10'));
 assert(parseFlags(one(f.db,'SELECT flags FROM attendance_events WHERE id=?',r2.event_id).flags).includes('LOKASI_MELOMPAT'));
 for(const [i,e] of [f.e.staff,f.e.boss,f.e.guard2].entries())await submit(f,device,submission(e),at(`08:0${i}`));
 const r3=await submit(f,device,submission(f.e.thl),at('08:05'));
 assert(parseFlags(one(f.db,'SELECT flags FROM attendance_events WHERE id=?',r3.event_id).flags).includes('HP_PRIBADI_RAMAI'),'4 orang dalam 10 menit di HP pribadi');
 const r4=await submit(f,device,submission(f.e.other,'OUT'),at('17:00'));
 assert(parseFlags(one(f.db,'SELECT flags FROM attendance_events WHERE id=?',r4.event_id).flags).includes('TANPA_MASUK'));
});
test('submission checks: camera JPEG only, fresh selfie and location, size limit',async t=>{
 const f=fixture(t),device=await registerDevice(f,{owner:f.e.guard}),base=submission(f.e.guard);
 const bad=[{photo:{...base.photo,mime_type:'image/png'}},{photo:{...base.photo,data:Buffer.from('bukan foto').toString('base64')}},{photo:{...base.photo,age_ms:6*60000}},
  {location:{...base.location,age_ms:3*60000}},{location:{latitude:'x'}},{kind:'ISTIRAHAT'},{client_key:'bukan-uuid'}];
 for(const extra of bad)await assert.rejects(submit(f,device,{...base,...extra}),e=>[400,422].includes(e.status),JSON.stringify(Object.keys(extra)));
 await assert.rejects(submit(f,device,{...base,photo:{...base.photo,data:Buffer.concat([jpeg,Buffer.alloc(attendanceRules.photoMaxBytes)]).toString('base64')}}),errorWith(413));
 assert.equal(f.photos.log.length,0);
});
test('a failure after the selfie upload removes the uploaded file',async t=>{
 const f=fixture(t),device=await registerDevice(f,{owner:f.e.guard});
 f.photos.onPut=()=>{run(f.db,"UPDATE attendance_devices SET status='REVOKED',revoked_at=?,revoke_reason='uji' WHERE id=?",now(),device.id);};
 await assert.rejects(submit(f,device,submission(f.e.guard)),errorWith(403));
 assert.deepEqual(f.photos.log.map(([op])=>op),['put','discard']);assert.equal(f.photos.files.size,0);
 assert.equal(one(f.db,'SELECT count(*) n FROM attendance_events').n,0);
});
test('attendance events are append-only except selfie removal',async t=>{
 const f=fixture(t),device=await registerDevice(f,{owner:f.e.guard}),r=await submit(f,device,submission(f.e.guard));
 assert.throws(()=>run(f.db,'UPDATE attendance_events SET employee_id=? WHERE id=?',f.e.other.id,r.event_id));
 assert.throws(()=>run(f.db,"UPDATE attendance_events SET recorded_at='2020-01-01T00:00:00.000Z' WHERE id=?",r.event_id));
 assert.throws(()=>run(f.db,'DELETE FROM attendance_events WHERE id=?',r.event_id));
 run(f.db,'UPDATE attendance_events SET photo_storage_key=NULL,photo_deleted_at=?,updated_at=?,row_version=row_version+1 WHERE id=?',now(),now(),r.event_id);
 assert.throws(()=>run(f.db,"UPDATE attendance_events SET photo_storage_key='kembali',photo_deleted_at=NULL WHERE id=?",r.event_id),'selfie yang dihapus tidak bisa dipulihkan');
});
test('inactive owners and revoked phones stop immediately',async t=>{
 const f=fixture(t),device=await registerDevice(f,{owner:f.e.guard});
 run(f.db,'UPDATE employees SET is_active=0 WHERE id=?',f.e.guard.id);
 assert.equal((await f.form('context',await sign(device,'context',{}))).device.status,'REVOKED');
 await assert.rejects(submit(f,device,submission(f.e.staff)),errorWith(403));
 run(f.db,'UPDATE employees SET is_active=1 WHERE id=?',f.e.guard.id);
 const row=(await f.route(f.users.manager,'devices')).devices.find(d=>d.id===device.id);
 await assert.rejects(f.route(f.users.manager,`devices/${device.id}/revoke`,'POST',{row_version:row.row_version,reason:''}),errorWith(422));
 await assert.rejects(f.route(f.users.manager,`devices/${device.id}/revoke`,'POST',{row_version:row.row_version+1,reason:'HP hilang'}),errorWith(409));
 await f.route(f.users.manager,`devices/${device.id}/revoke`,'POST',{row_version:row.row_version,reason:'HP hilang'});
 await assert.rejects(submit(f,device,submission(f.e.guard)),errorWith(403));
 await assert.rejects(f.form('search',await sign(device,'search',{query:'fiktif'})),errorWith(403));
});
test('rate limits per IP and per phone',async t=>{
 const f=fixture(t),device=await registerDevice(f,{owner:f.e.guard});
 for(let i=0;i<attendanceFormLimits.ip.registration;i++)await assert.rejects(f.form('registration',{token:'e'.repeat(64)},{ip:'198.51.100.7'}),errorWith(404));
 await assert.rejects(f.form('registration',{token:'e'.repeat(64)},{ip:'198.51.100.7'}),errorWith(429));
 for(let i=0;i<attendanceFormLimits.device.search;i++)await f.form('search',await sign(device,'search',{query:'fiktif'}),{ip:`203.0.113.${i%200}`});
 await assert.rejects(f.form('search',await sign(device,'search',{query:'fiktif'}),{ip:'203.0.113.250'}),errorWith(429));
 await assert.rejects(f.form('submit',{},{ip:'bukan ip'}),errorWith(400));
});

/* ---------- Portal: cakupan, rekap, koreksi ---------- */
async function attendanceDay(f){
 const device=await registerDevice(f,{kind:'SHARED',unit:f.units.field});await addPoint(f);
 const day=yesterday();
 await submit(f,device,submission(f.e.guard),wita(day,'07:50'));await submit(f,device,submission(f.e.guard,'OUT'),wita(day,'16:10'));
 await submit(f,device,submission(f.e.thl),wita(day,'08:20'));
 await submit(f,device,submission(f.e.other),wita(day,'08:00'));
 return {device,day};
}
test('scope: employees see themselves, supervisors their reporting line, unit readers their units, managers everyone',async t=>{
 const f=fixture(t),{day}=await attendanceDay(f),q=`from=${day}&to=${day}`;
 const names=async user=>(await f.route(user,'recap','GET',{},q)).employees.map(r=>r.employee.name).sort();
 assert.deepEqual(await names(f.users.guard),['Petugas Fiktif']);
 assert.deepEqual(await names(f.users.staff),['Pekerja Harian Fiktif','Petugas Dua Fiktif','Petugas Fiktif','Staf Fiktif']);
 assert.deepEqual(await names(f.users.boss),['Atasan Fiktif','Pekerja Harian Fiktif','Petugas Dua Fiktif','Petugas Fiktif','Staf Fiktif'],'atasan tidak langsung ikut melihat');
 assert.deepEqual(await names(f.users.reader),['Atasan Fiktif','Pekerja Harian Fiktif','Petugas Dua Fiktif','Petugas Fiktif','Staf Fiktif'],'cakupan unit termasuk sub-unit');
 assert.equal((await names(f.users.manager)).length,6);assert.equal((await names(f.users.it)).length,0);
 const overview=await f.route(f.users.boss,'overview');
 assert.deepEqual([overview.self,overview.subordinates,overview.manage,overview.devices,overview.settings],[true,4,true,false,false]);
 const it=await f.route(f.users.it,'overview');assert.deepEqual([it.self,it.readable,it.manage],[false,0,false]);
 await assert.rejects(f.route(f.users.guard,`recap/${f.e.other.id}`,'GET',{},q),errorWith(403));
 const unit=await f.route(f.users.manager,'recap','GET',{},`${q}&unit=${f.units.field.id}`);
 assert.deepEqual(unit.employees.map(r=>r.employee.name).sort(),['Pekerja Harian Fiktif','Petugas Dua Fiktif','Petugas Fiktif']);
 const guard=unit.employees.find(r=>r.employee.id===f.e.guard.id);
 assert.deepEqual([guard.summary.hadir,guard.summary.menit,guard.days],[1,500,undefined]);
 const detail=await f.route(f.users.manager,'recap','GET',{},`${q}&unit=${f.units.field.id}&detail=1`);
 assert.equal(detail.employees.find(r=>r.employee.id===f.e.thl.id).days[0].status,'TANPA_PULANG');
 await assert.rejects(f.route(f.users.manager,'recap','GET',{},`from=${shiftDay(day,-70)}&to=${day}`),errorWith(422));
});
test('today: live status for the reporting line, borrowed phones visible',async t=>{
 const f=fixture(t),own=await registerDevice(f,{owner:f.e.guard2});
 await submit(f,own,submission(f.e.guard));
 const rows=(await f.route(f.users.staff,'today')).rows;
 const guard=rows.find(r=>r.employee.id===f.e.guard.id);
 assert.equal(guard.status,'BELUM_PULANG');assert.equal(guard.last_event.device.borrowed,true);assert.equal(guard.last_event.device.label,'HP pribadi Petugas Dua Fiktif');
 assert.equal(rows.find(r=>r.employee.id===f.e.thl.id).status,'TIDAK_ADA_CATATAN');
 assert.equal(guard.can_manage,true);assert.equal(rows.find(r=>r.employee.id===f.e.staff.id).can_manage,false,'tidak mengoreksi absen sendiri');
});
test('corrections: direct supervisor within 7 days, manager any time; originals stay and can be set aside',async t=>{
 const f=fixture(t),{day}=await attendanceDay(f);
 const out=new Date(wita(day,'16:30')).toISOString();
 await assert.rejects(f.route(f.users.boss,'corrections','POST',{employee_id:f.e.thl.id,work_date:day,out_at:out,reason:'Lupa absen pulang'}),errorWith(403),'atasan tidak langsung tidak mengoreksi');
 await assert.rejects(f.route(f.users.guard,'corrections','POST',{employee_id:f.e.guard.id,work_date:day,out_at:out,reason:'Sendiri'}),errorWith(403));
 await assert.rejects(f.route(f.users.staff,'corrections','POST',{employee_id:f.e.thl.id,work_date:day,out_at:out,reason:''}),errorWith(422));
 await assert.rejects(f.route(f.users.staff,'corrections','POST',{employee_id:f.e.thl.id,work_date:day,out_at:'2026-11-04 16:30',reason:'Format'}),errorWith(422));
 const c=await f.route(f.users.staff,'corrections','POST',{employee_id:f.e.thl.id,work_date:day,out_at:out,reason:'Lupa absen pulang'});
 let detail=await f.route(f.users.staff,`recap/${f.e.thl.id}`,'GET',{},`from=${day}&to=${day}`);
 assert.deepEqual([detail.days[0].status,detail.days[0].corrected,detail.can_manage,detail.manager],['HADIR',true,true,false]);
 assert.equal(detail.correction_from,shiftDay(today(),-7));assert.equal(detail.corrections[0].created_by,'staf');
 const old=shiftDay(today(),-8),oldIn=new Date(wita(old,'08:00')).toISOString();
 await assert.rejects(f.route(f.users.staff,'corrections','POST',{employee_id:f.e.thl.id,work_date:old,in_at:oldIn,reason:'Terlambat dikoreksi'}),errorWith(403));
 await f.route(f.users.manager,'corrections','POST',{employee_id:f.e.thl.id,work_date:old,in_at:oldIn,reason:'Dikoreksi pengelola'});
 await assert.rejects(f.route(f.users.manager,'corrections','POST',{employee_id:f.e.thl.id,work_date:day,in_at:new Date(wita(shiftDay(day,1),'08:00')).toISOString(),reason:'Hari lain'}),errorWith(422));
 const event=one(f.db,'SELECT * FROM attendance_events WHERE employee_id=? AND work_date=?',f.e.other.id,day);
 await f.route(f.users.manager,'corrections','POST',{employee_id:f.e.other.id,work_date:day,void_event_id:event.id,reason:'Salah pilih nama'});
 await assert.rejects(f.route(f.users.manager,'corrections','POST',{employee_id:f.e.other.id,work_date:day,void_event_id:event.id,reason:'Lagi'}),errorWith(409));
 assert.equal((await f.route(f.users.manager,`recap/${f.e.other.id}`,'GET',{},`from=${day}&to=${day}`)).days.length,0,'absen yang disisihkan tidak dihitung');
 assert(one(f.db,'SELECT id FROM attendance_events WHERE id=?',event.id),'catatan asli tetap ada');
 await f.route(f.users.staff,`corrections/${c.id}/revoke`,'POST',{row_version:c.row_version});
 detail=await f.route(f.users.staff,`recap/${f.e.thl.id}`,'GET',{},`from=${day}&to=${day}`);assert.equal(detail.days[0].status,'TANPA_PULANG');
 assert(all(f.db,"SELECT action FROM audit_events WHERE object_type='attendance_corrections'").some(a=>a.action==='REVOKE'));
});
test('day notes: izin, sakit and dinas luar by supervisor or manager; one active note per day',async t=>{
 const f=fixture(t),day=yesterday();
 const n=await f.route(f.users.staff,'notes','POST',{employee_id:f.e.guard.id,work_date:day,kind:'SAKIT',note:'Surat menyusul'});
 await assert.rejects(f.route(f.users.staff,'notes','POST',{employee_id:f.e.guard.id,work_date:day,kind:'IZIN'}),errorWith(409));
 await assert.rejects(f.route(f.users.guard,'notes','POST',{employee_id:f.e.guard.id,work_date:day,kind:'IZIN'}),errorWith(403));
 await assert.rejects(f.route(f.users.staff,'notes','POST',{employee_id:f.e.guard.id,work_date:day,kind:'ALPA'}),errorWith(422));
 assert.equal((await f.route(f.users.guard,`recap/${f.e.guard.id}`,'GET',{},`from=${day}&to=${day}`)).days[0].status,'SAKIT');
 await f.route(f.users.manager,`notes/${n.id}/revoke`,'POST',{row_version:n.row_version});
 await f.route(f.users.staff,'notes','POST',{employee_id:f.e.guard.id,work_date:day,kind:'DINAS_LUAR'});
});
test('review queue and reference photos: flagged check-ins, decisions, selfie viewing audited',async t=>{
 const f=fixture(t),{day}=await attendanceDay(f),q=`from=${day}&to=${day}`;
 let review=await f.route(f.users.staff,'review','GET',{},q);
 const thlItem=review.items.find(i=>i.employee.id===f.e.thl.id&&i.kind==='IN');
 assert(thlItem.flags.includes('TANPA_FOTO_ACUAN')&&thlItem.flags.includes('TANPA_PULANG'));assert.equal(thlItem.can_review,true);
 assert(review.missing_reference.some(m=>m.employee.id===f.e.thl.id&&m.can_set));
 assert(!(await f.route(f.users.guard,'review','GET',{},q)).items.some(i=>i.employee.id!==f.e.guard.id));
 await assert.rejects(f.route(f.users.staff,'reviews','POST',{event_id:thlItem.id,decision:'KLARIFIKASI',note:''}),errorWith(422));
 await assert.rejects(f.route(f.users.boss,'reviews','POST',{event_id:thlItem.id,decision:'SESUAI'}),errorWith(403));
 await f.route(f.users.staff,'reviews','POST',{event_id:thlItem.id,decision:'SESUAI'});
 review=await f.route(f.users.staff,'review','GET',{},q);assert(!review.items.some(i=>i.id===thlItem.id));
 assert.equal((await f.route(f.users.staff,'review','GET',{},`${q}&status=all`)).items.find(i=>i.id===thlItem.id).review.decision,'SESUAI');
 const photo=await f.route(f.users.staff,`photos/${thlItem.id}`);assert.equal(Buffer.from(photo.data,'base64').toString('hex'),jpeg.toString('hex'));
 assert.equal(one(f.db,"SELECT count(*) n FROM audit_events WHERE action='VIEW_PHOTO' AND object_key=?",thlItem.id).n,1);
 await assert.rejects(f.route(f.users.other,`photos/${thlItem.id}`),errorWith(403));
 await assert.rejects(f.route(f.users.staff,`references/${f.e.thl.id}`),errorWith(404));
 await assert.rejects(f.route(f.users.staff,'references','POST',{employee_id:f.e.guard.id,event_id:thlItem.id}),errorWith(422),'selfie harus milik pegawai yang sama');
 await f.route(f.users.staff,'references','POST',{employee_id:f.e.thl.id,event_id:thlItem.id});
 assert.equal((await f.route(f.users.staff,`references/${f.e.thl.id}`)).event_id,thlItem.id);
 review=await f.route(f.users.staff,'review','GET',{},`${q}&status=all`);
 assert(!review.items.find(i=>i.id===thlItem.id).flags.includes('TANPA_FOTO_ACUAN'));assert(!review.missing_reference.some(m=>m.employee.id===f.e.thl.id));
 assert.equal((await f.route(f.users.staff,`recap/${f.e.thl.id}`,'GET',{},q)).reference.event_id,thlItem.id);
});
test('points: only the organisation-wide manager edits; validation and optimistic locking',async t=>{
 const f=fixture(t);
 await assert.rejects(f.route(f.users.coordinator,'points','POST',{name:'X',...POINT}),errorWith(403));
 await assert.rejects(addPoint(f,{radius_m:10}),errorWith(422));await assert.rejects(addPoint(f,{latitude:91}),errorWith(422));
 const p=await addPoint(f);assert.equal(p.radius_m,100);
 assert.equal((await f.route(f.users.coordinator,'points')).can_manage,false);
 await assert.rejects(f.route(f.users.guard,'points'),errorWith(403));
 await assert.rejects(f.route(f.users.manager,`points/${p.id}`,'PATCH',{radius_m:150,row_version:p.row_version+1}),errorWith(409));
 const edited=await f.route(f.users.manager,`points/${p.id}`,'PATCH',{radius_m:150,is_active:false,row_version:p.row_version});
 assert.deepEqual([edited.radius_m,edited.is_active],[150,false]);
 assert.equal((await f.route(f.users.manager,'overview')).points_ready,false);
});
test('exports are audited with the row count only',async t=>{
 const f=fixture(t),day=yesterday();
 await f.route(f.users.staff,'exports','POST',{kind:'detail',from:day,to:day,rows:12});
 const row=one(f.db,"SELECT * FROM audit_events WHERE action='EXPORT'");assert.equal(row.object_type,'attendance_detail');assert.equal(JSON.parse(row.change_summary).row_count,12);
 await assert.rejects(f.route(f.users.it,'exports','POST',{kind:'recap',from:day,to:day,rows:1}),errorWith(403));
});

/* ---------- Retensi selfie ---------- */
test('retention: selfies older than 90 days are removed, reference photos kept, runs throttled and leased',async t=>{
 const f=fixture(t),{day}=await attendanceDay(f);
 const ref=one(f.db,'SELECT * FROM attendance_events WHERE employee_id=? ORDER BY recorded_at LIMIT 1',f.e.guard.id);
 await f.route(f.users.manager,'references','POST',{employee_id:f.e.guard.id,event_id:ref.id});
 const soon=await runAttendanceRetention({runTx:f.runTx,photos:f.photos,nowMs:Date.now()});assert.deepEqual([soon.skipped,soon.deleted],[false,0]);
 assert.equal((await runAttendanceRetention({runTx:f.runTx,photos:f.photos,nowMs:Date.now()+HOUR})).skipped,true,'paling sering 6 jam sekali');
 const later=Date.now()+91*DAY,result=await runAttendanceRetention({runTx:f.runTx,photos:f.photos,nowMs:later,force:true});
 assert.deepEqual([result.skipped,result.deleted,result.error],[false,3,null],'empat selfie, satu menjadi foto acuan');
 const rows=all(f.db,'SELECT id,photo_storage_key,photo_deleted_at FROM attendance_events');
 assert.deepEqual(rows.filter(r=>r.photo_storage_key).map(r=>r.id),[ref.id]);assert(rows.filter(r=>r.id!==ref.id).every(r=>r.photo_deleted_at));
 assert.equal(f.photos.files.size,1);
 const state=one(f.db,'SELECT * FROM attendance_state WHERE id=1');assert.equal(state.deleted_photos,3);assert.equal(state.lease_owner,null);
 const gone=rows.find(r=>r.id!==ref.id);await assert.rejects(f.route(f.users.manager,`photos/${gone.id}`),errorWith(404));
 assert.equal((await f.route(f.users.manager,`recap/${f.e.guard.id}`,'GET',{},`from=${day}&to=${day}`)).events.find(e=>e.id===gone.id)?.photo_deleted??true,true);
 // Pegawai yang sudah lama nonaktif: foto acuannya ikut dilepas sesudah masa simpan.
 run(f.db,"UPDATE employees SET is_active=0,ended_on='2026-01-01' WHERE id=?",f.e.guard.id);
 const final=await runAttendanceRetention({runTx:f.runTx,photos:f.photos,nowMs:later+DAY,force:true});
 assert.equal(final.deleted,1);assert.equal(one(f.db,'SELECT count(*) n FROM attendance_reference_photos').n,0);
 // Lease yang masih berlaku menahan proses kedua.
 run(f.db,"UPDATE attendance_state SET lease_owner='lain',lease_until=? WHERE id=1",new Date(later+2*DAY+60000).toISOString());
 assert.equal((await runAttendanceRetention({runTx:f.runTx,photos:f.photos,nowMs:later+2*DAY,force:true})).skipped,true);
});
test('retention runs after new check-ins and when the absen page opens on an active phone; overdue selfies are visible to managers',async t=>{
 assert.equal(attendanceRetentionDue('submit',{duplicate:false}),true);
 assert.equal(attendanceRetentionDue('submit',{duplicate:true}),false);
 assert.equal(attendanceRetentionDue('context',{device:{status:'ACTIVE'}}),true);
 for(const status of ['PENDING','REVOKED','REJECTED'])assert.equal(attendanceRetentionDue('context',{device:{status}}),false,status);
 for(const action of ['person','search','registration','register'])assert.equal(attendanceRetentionDue(action,{device:{status:'ACTIVE'},duplicate:false}),false,action);
 const f=fixture(t),device=await registerDevice(f,{kind:'SHARED',unit:f.units.field});await addPoint(f);
 const old=Date.now()-91*DAY;await submit(f,device,submission(f.e.guard),old);
 let overview=await f.route(f.users.manager,'overview');
 assert.deepEqual([overview.retention.due_photos,overview.retention.deleted_photos,overview.retention.last_run_at],[1,0,null]);
 assert.equal((await f.route(f.users.staff,'overview')).retention,null,'hanya pemegang pengaturan absensi');
 await runAttendanceRetention({runTx:f.runTx,photos:f.photos});
 overview=await f.route(f.users.manager,'overview');
 assert.deepEqual([overview.retention.due_photos,overview.retention.deleted_photos],[0,1]);assert(overview.retention.last_run_at);
});
test('local photo store keeps selfies inside the data directory and rejects foreign keys',async t=>{
 const dir=mkdtempSync(resolve(tmpdir(),'besakih-absen-'));t.after(()=>{assert(dir.startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});});
 const store=localAttendancePhotos(dir),{key}=await store.put(jpeg);
 assert.deepEqual(readdirSync(resolve(dir,'attendance')),[key]);assert.equal(store.get(key).length,jpeg.length);
 for(const bad of ['../secret','bukan',null])assert.throws(()=>store.get(bad),e=>e.status===404);
 await store.remove(key);assert(!existsSync(resolve(dir,'attendance',key)));
});

/* ---------- Server lokal ---------- */
test('local server: /absen/ is not indexed, the public form checks origin, the portal routes need a session',async t=>{
 const dir=mkdtempSync(resolve(tmpdir(),'besakih-absen-app-'));
 const db=openDb(':memory:'),origin='https://portal.test',app=createApp({db,dataDir:dir,origin});
 t.after(async()=>{await new Promise(done=>app.server.close(done));db.close();assert(dir.startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${app.server.address().port}`;
 const page=await fetch(`${base}/absen/`);assert.equal(page.status,200);assert.equal(page.headers.get('x-robots-tag'),'noindex, nofollow');assert.equal(page.headers.get('referrer-policy'),'no-referrer');
 assert.match(await page.text(),/manifest\.webmanifest/);
 const post=(path,headers={})=>fetch(`${base}/api/attendance-form/${path}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...headers},body:JSON.stringify({token:'a'.repeat(64)})});
 assert.equal((await post('registration')).status,404);
 assert.equal((await post('registration',{Origin:'https://attacker.test'})).status,403);
 assert.equal((await post('bukan')).status,404);
 assert.equal((await fetch(`${base}/api/attendance/overview`)).status,401);
 assert.equal((await fetch(`${base}/assets/vendor/leaflet/leaflet.js`)).status,200);
});
