import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,sep} from 'node:path';
import {openDb,insert,all,one,run,get,now} from '../lib/db.mjs';
import {seedPermissions,hashPasswordSync,reportContext,can} from '../lib/auth.mjs';
import {announcementRoutes} from '../lib/announcements.mjs';
import {securityRoutes} from '../lib/security.mjs';
import {upload,fileAllowed,attach} from '../lib/files.mjs';
import {dashboard} from '../lib/read-models.mjs';
import {createApp} from '../server.mjs';

const hash=hashPasswordSync('TestPassword!2026');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX5kAAAAASUVORK5CYII=','base64');
function fixture(t,path=':memory:'){
  const db=openDb(path);t.after(()=>db.close());seedPermissions(db);
  const units=['A','B'].map(code=>insert(db,'org_units',{code,name:`Unit ${code}`,is_active:1}));
  const employees=units.map((unit,i)=>{const position=insert(db,'positions',{code:`P${i}`,name:'Petugas',org_unit_id:unit.id,is_active:1});const employee=insert(db,'employees',{employee_no:`E${i}`,full_name:`Petugas ${i}`,employment_status:'Tetap',joined_on:'2020-01-01',is_active:1});insert(db,'employee_placements',{employee_id:employee.id,position_id:position.id,valid_from:'2020-01-01',is_primary:1});return employee;});
  const account=(username,role,employee=null,scope='ALL')=>{const user=insert(db,'users',{username,password_hash:hash,status:'ACTIVE',employee_id:employee?.id||null,must_change_password:0,failed_login_count:0,password_changed_at:now()});if(role)insert(db,'user_roles',{user_id:user.id,role_id:one(db,'SELECT id FROM roles WHERE code=?',role).id,scope_kind:scope});return user;};
  return {db,units,employees,account,admin:account('admin','SUPER_ADMIN'),hr:account('sdm','SDM'),officer:account('petugas','OFFICER',employees[0],'SELF'),other:account('lain','EMPLOYEE',employees[1],'SELF'),coordinator:account('koordinator','COORDINATOR')};
}
const call=(handler,f,user,path,method='GET',body={})=>handler({db:f.db,user,p:path.split('/'),method,body,url:new URL('http://localhost')});
const ann=(f,user,path='',method='GET',body={})=>call(announcementRoutes,f,user,`announcements${path?'/'+path:''}`,method,body);
const content=(extra={})=>({title:'Pengumuman internal',category:'UMUM',priority:'NORMAL',blocks:[{type:'text',text:'Isi pengumuman untuk seluruh pegawai.'}],attachments:[],...extra});
async function publish(f,body=content()){const draft=await ann(f,f.admin,'','POST',body);return ann(f,f.admin,`${draft.id}/publish`,'POST',{row_version:draft.row_version});}
function photo(f,user=f.officer){return insert(f.db,'files',{storage_key:crypto.randomUUID(),original_name:'bukti.png',mime_type:'image/png',size_bytes:png.length,checksum:'test',status:'AVAILABLE',uploaded_by:user.id});}
function report(f,user=f.officer,extra={}){return {idempotency_key:crypto.randomUUID(),occurred_at:now(),activity_type:'PATROLI',activity_notes:'Memeriksa area dan penerangan.',incident_type:'Barang tertinggal',chronology:'Barang ditemukan saat pemeriksaan.',location:{latitude:-8.374,longitude:115.45,accuracy:8,captured_at:now()},photos:[{file_id:photo(f,user).id,captured_at:now(),source:'CAMERA'}],...extra};}
function temporary(t){const dir=mkdtempSync(resolve(tmpdir(),'besakih-mvp-'));t.after(()=>{assert(resolve(dir).startsWith(resolve(tmpdir())+sep));assert(dir.split(sep).at(-1).startsWith('besakih-mvp-'));rmSync(dir,{recursive:true,force:true});});return dir;}

test('MVP: hanya Admin/SDM dapat mengelola dan menerbitkan pengumuman',async t=>{
  const f=fixture(t);for(const user of [f.officer,f.other,f.coordinator])await assert.rejects(ann(f,user,'','POST',content()),/Hanya Admin atau SDM/);
  const draft=await ann(f,f.hr,'','POST',content());assert.equal(draft.status,'DRAFT');await assert.rejects(ann(f,f.coordinator,`${draft.id}/publish`,'POST',{row_version:1}),/Hanya Admin atau SDM/);
  const published=await ann(f,f.hr,`${draft.id}/publish`,'POST',{row_version:1});assert.equal(published.published_by,f.hr.id);assert(one(f.db,"SELECT id FROM audit_events WHERE object_key=? AND action='PUBLISH'",draft.id));
});
test('MVP: pengumuman terbit tersedia untuk seluruh unit dan akun tanpa role',async t=>{
  const f=fixture(t),a=await publish(f),noRole=f.account('tanpa-role',null);
  for(const user of [f.officer,f.other,f.coordinator,noRole])assert.equal((await ann(f,user)).items[0].id,a.id);
});
test('MVP: draf dan pengumuman mendatang beserta gambarnya privat',async t=>{
  const f=fixture(t),image=photo(f,f.admin),a=await ann(f,f.admin,'','POST',content({starts_at:new Date(Date.now()+86400000).toISOString(),blocks:[{type:'image',file_id:image.id,caption:'Poster'}]}));
  assert.equal(fileAllowed(f.db,f.officer,image.id),false);assert.equal(fileAllowed(f.db,f.admin,image.id),true);await assert.rejects(ann(f,f.officer,a.id),/tidak tersedia/);
  const p=await ann(f,f.admin,`${a.id}/publish`,'POST',{row_version:1});assert.equal(p.phase,'SCHEDULED');assert.equal((await ann(f,f.officer)).items.length,0);assert.equal(fileAllowed(f.db,f.officer,image.id),false);
});
test('MVP: teks dan gambar tersusun berurutan; lampiran mengikuti akses pengumuman',async t=>{
  const f=fixture(t),image=photo(f,f.admin),file=insert(f.db,'files',{storage_key:'doc',original_name:'lampiran.pdf',mime_type:'application/pdf',size_bytes:5,checksum:'t',status:'AVAILABLE',uploaded_by:f.admin.id});
  const a=await publish(f,content({blocks:[{type:'text',text:'Pembuka'},{type:'image',file_id:image.id,caption:'Keterangan'},{type:'text',text:'Penutup'}],attachments:[{file_id:file.id,caption:'Lampiran'}]}));
  const read=await ann(f,f.other,a.id);assert.deepEqual(read.blocks.map(b=>b.type),['text','image','text']);assert.equal(read.files.length,2);assert.equal(fileAllowed(f.db,f.other,file.id),true);assert.equal(fileAllowed(f.db,f.other,image.id),true);
});
test('MVP: penolakan berkas asing, berkas terpakai, format gambar dan blok HTML',async t=>{
  const f=fixture(t),image=photo(f,f.other);await assert.rejects(ann(f,f.admin,'','POST',content({blocks:[{type:'image',file_id:image.id}]})),/tidak tersedia/);
  await assert.rejects(ann(f,f.admin,'','POST',content({blocks:[{type:'html',html:'<script>bad()</script>'}]})),/tidak didukung/);
  const file=photo(f,f.admin);await ann(f,f.admin,'','POST',content({blocks:[{type:'image',file_id:file.id}]}));await assert.rejects(ann(f,f.admin,'','POST',content({blocks:[{type:'image',file_id:file.id}]})),/sudah terhubung/);
  const doc=photo(f,f.admin);run(f.db,"UPDATE files SET mime_type='application/pdf' WHERE id=?",doc.id);await assert.rejects(ann(f,f.admin,'','POST',content({blocks:[{type:'image',file_id:doc.id}]})),/JPG atau PNG/);
});
test('MVP: status baca per akun dan diperbarui ketika isi pengumuman berubah',async t=>{
  const f=fixture(t);let a=await publish(f);await ann(f,f.officer,`${a.id}/read`,'POST');assert.equal((await ann(f,f.officer,a.id)).is_read,true);assert.equal((await ann(f,f.other,a.id)).is_read,false);
  await ann(f,f.officer,`${a.id}/read`,'POST');assert.equal(one(f.db,'SELECT count(*) n FROM announcement_reads').n,1);
  a=await ann(f,f.admin,a.id,'PATCH',{...content({title:'Isi diperbarui'}),row_version:a.row_version});assert.equal((await ann(f,f.officer,a.id)).is_read,false);
  await assert.rejects(ann(f,f.admin,a.id,'PATCH',{...content(),row_version:1}),/sudah berubah/);
});
test('MVP: masa tayang, arsip dan sematan tidak mencampurkan draf dengan publikasi',async t=>{
  const f=fixture(t);await assert.rejects(ann(f,f.admin,'','POST',content({starts_at:'2099-01-02T00:00:00Z',ends_at:'2099-01-01T00:00:00Z'})),/Akhir tayang/);
  let a=await publish(f);await ann(f,f.officer,`${a.id}/read`,'POST');a=await ann(f,f.admin,`${a.id}/pin`,'POST',{row_version:a.row_version,is_pinned:true});assert.equal((await ann(f,f.officer,a.id)).is_read,true);
  a=await ann(f,f.admin,`${a.id}/archive`,'POST',{row_version:a.row_version});assert.equal(a.phase,'ARCHIVED');assert.equal((await ann(f,f.other,a.id)).phase,'ARCHIVED');
  const draft=await ann(f,f.admin,'','POST',content());await ann(f,f.admin,`${draft.id}/archive`,'POST',{row_version:1});await assert.rejects(ann(f,f.officer,draft.id),/tidak tersedia/);
  run(f.db,"UPDATE announcements SET status='PUBLISHED',ends_at=? WHERE id=?",new Date(Date.now()-1000).toISOString(),a.id);assert.equal((await ann(f,f.other,a.id)).phase,'EXPIRED');
});
test('MVP: pencabutan role SDM langsung mencabut hak pengelolaan pengumuman',async t=>{
  const f=fixture(t);let a=await ann(f,f.hr,'','POST',content());run(f.db,'DELETE FROM user_roles WHERE user_id=?',f.hr.id);await assert.rejects(ann(f,f.hr,`${a.id}/publish`,'POST',{row_version:1}),/Hanya Admin atau SDM/);
});
test('MVP: laporan wajib memiliki lokasi dan foto kamera, validasi juga pada server',async t=>{
  const f=fixture(t),body=report(f);for(const [data,pattern] of [[{...body,location:null},/Lokasi perangkat wajib/],[{...body,photos:[]},/minimal satu/],[{...body,photos:[{...body.photos[0],source:'GALLERY'}]},/kamera aplikasi/],[{...body,location:{...body.location,latitude:91}},/Koordinat/]])await assert.rejects(call(securityRoutes,f,f.officer,'logbook','POST',data),pattern);
  assert.equal(one(f.db,'SELECT count(*) n FROM logbook_entries').n,0);
});
test('MVP: identitas pelapor ditetapkan sesi dan laporan tidak memerlukan master pos',async t=>{
  const f=fixture(t),body=report(f);await assert.rejects(call(securityRoutes,f,f.officer,'logbook','POST',{...body,employee_id:f.other.employee_id}),/Identitas pelapor/);
  const row=await call(securityRoutes,f,f.officer,'logbook','POST',body);assert.equal(row.employee_id,f.officer.employee_id);assert.equal(row.post_id,null);assert.equal(row.reporting_org_unit_id,f.units[0].id);assert.equal(row.latitude,body.location.latitude);assert.equal(row.findings,null);
  const detail=await call(securityRoutes,f,f.officer,`logbook/${row.id}`);assert.equal(detail.files[0].capture_source,'CAMERA');assert.equal((await call(securityRoutes,f,f.officer,'logbook')).items.length,1);assert.equal(fileAllowed(f.db,f.officer,body.photos[0].file_id),true);
});
test('MVP: akun tanpa profil atau profil nonaktif tidak dapat melapor',async t=>{
  const f=fixture(t),user=f.account('belum-terhubung','SUPER_ADMIN',null),body=report(f,user);await assert.rejects(call(securityRoutes,f,user,'incidents','POST',body),/belum terhubung/);run(f.db,'UPDATE employees SET is_active=0 WHERE id=?',f.officer.employee_id);await assert.rejects(call(securityRoutes,f,f.officer,'logbook','POST',report(f)),/tidak aktif/);
});
test('MVP: lokasi dan foto lama atau bertanggal masa depan ditolak',async t=>{
  const f=fixture(t),body=report(f),old=new Date(Date.now()-16*60000).toISOString(),future=new Date(Date.now()+120000).toISOString();
  for(const stamp of [old,future]){await assert.rejects(call(securityRoutes,f,f.officer,'incidents','POST',{...body,location:{...body.location,captured_at:stamp}}),/kedaluwarsa/);await assert.rejects(call(securityRoutes,f,f.officer,'incidents','POST',{...body,photos:[{...body.photos[0],captured_at:stamp}]}),/kedaluwarsa/);}
});
test('MVP: penyimpanan laporan dan seluruh foto atomik serta foto tidak bisa dipakai ulang',async t=>{
  const f=fixture(t),body=report(f),bad={file_id:photo(f,f.other).id,captured_at:now(),source:'CAMERA'};await assert.rejects(call(securityRoutes,f,f.officer,'incidents','POST',{...body,photos:[...body.photos,bad]}),/tidak tersedia/);assert.equal(one(f.db,'SELECT count(*) n FROM incidents').n,0);assert.equal(one(f.db,'SELECT count(*) n FROM incident_files').n,0);
  await call(securityRoutes,f,f.officer,'incidents','POST',body);await assert.rejects(call(securityRoutes,f,f.officer,'logbook','POST',{...body,idempotency_key:crypto.randomUUID()}),/sudah terhubung/);assert.equal(one(f.db,'SELECT count(*) n FROM logbook_entries').n,0);
});
test('MVP: retry patroli dan kejadian tidak menggandakan laporan atau foto',async t=>{
  const f=fixture(t);for(const kind of ['logbook','incidents']){const body=report(f),first=await call(securityRoutes,f,f.officer,kind,'POST',body),retry=await call(securityRoutes,f,f.officer,kind,'POST',body);assert.equal(first.id,retry.id);await assert.rejects(call(securityRoutes,f,f.officer,kind,'POST',{...body,activity_notes:'Berbeda',chronology:'Berbeda'}),/laporan berbeda/);}
  assert.equal(one(f.db,'SELECT count(*) n FROM logbook_files').n,1);assert.equal(one(f.db,'SELECT count(*) n FROM incident_files').n,1);
});
test('MVP: kejadian memakai pelapor sendiri, tanpa tindakan awal, dan tetap terhubung ke patroli',async t=>{
  const f=fixture(t),log=await call(securityRoutes,f,f.officer,'logbook','POST',report(f)),body=report(f,f.officer,{source_logbook_entry_id:log.id}),incident=await call(securityRoutes,f,f.officer,'incidents','POST',body);assert.equal(incident.initial_action,null);assert.equal(incident.reporter_employee_id,f.officer.employee_id);assert.equal(incident.source_logbook_entry_id,log.id);assert.equal((await call(securityRoutes,f,f.officer,`logbook/${log.id}`)).incidents.length,1);
  assert.equal((await call(securityRoutes,f,f.officer,'incidents')).items.length,1);assert.equal(dashboard(f.db,f.officer,'security').open_incidents,1);
});
test('MVP: laporan dan bukti lokasi tetap mengikuti cakupan sendiri/unit, scope pos tidak diperluas',async t=>{
  const f=fixture(t),body=report(f),row=await call(securityRoutes,f,f.officer,'logbook','POST',body);assert.equal(fileAllowed(f.db,f.other,body.photos[0].file_id),false);await assert.rejects(call(securityRoutes,f,f.other,`logbook/${row.id}`),/akses/);
  const role=one(f.db,"SELECT id FROM roles WHERE code='COORDINATOR'");run(f.db,'DELETE FROM user_roles WHERE user_id=?',f.coordinator.id);const grant=insert(f.db,'user_roles',{user_id:f.coordinator.id,role_id:role.id,scope_kind:'ASSIGNED_UNITS'});run(f.db,'INSERT INTO user_role_units(user_role_id,org_unit_id,include_descendants) VALUES(?,?,0)',grant.id,f.units[1].id);assert.equal((await call(securityRoutes,f,f.coordinator,'logbook')).items.length,0);run(f.db,'UPDATE user_role_units SET org_unit_id=? WHERE user_role_id=?',f.units[0].id,grant.id);assert.equal((await call(securityRoutes,f,f.coordinator,'logbook')).items.length,1);assert.equal(fileAllowed(f.db,f.coordinator,body.photos[0].file_id),true);
  run(f.db,"UPDATE user_roles SET scope_kind='ASSIGNED_POSTS' WHERE id=?",grant.id);assert.equal(can(f.db,f.coordinator,'security.logbook.read',reportContext(f.db,row)),false);
});
test('MVP: lampiran biasa tidak menjadi jalur penggantian bukti kamera pada laporan baru',async t=>{
  const f=fixture(t),row=await call(securityRoutes,f,f.officer,'logbook','POST',report(f));assert.throws(()=>attach(f.db,f.officer,'logbook',row.id,{file_id:photo(f).id}),/kamera/);
});
test('MVP HTTP: sesi, CSRF, header izin perangkat dan gambar privat bekerja bersama',async t=>{
  const directory=temporary(t),f=fixture(t),app=createApp({db:f.db,dataDir:directory,origin:'http://localhost'});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>app.server.close(resolve)));const base=`http://127.0.0.1:${app.server.address().port}`;
  const request=async(path,{method='GET',body,cookie,csrf}={})=>fetch(base+'/api/'+path,{method,headers:{...(body?{'Content-Type':'application/json',Origin:'http://localhost'}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},body:body?JSON.stringify(body):undefined});
  let response=await request('auth/login',{method:'POST',body:{username:'admin',password:'TestPassword!2026'}});const cookies=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),login=await response.json();assert.match(response.headers.get('Permissions-Policy'),/camera=\(self\)/);assert.match(response.headers.get('Permissions-Policy'),/geolocation=\(self\)/);
  response=await request('announcements',{method:'POST',body:content(),cookie:cookies});assert.equal(response.status,403);
  const image=upload(f.db,f.admin,{name:'poster.png',mime_type:'image/png',data:png.toString('base64')},directory);const a=await publish(f,content({blocks:[{type:'image',file_id:image.id}]}));
  response=await fetch(base+`/api/files/${image.id}?inline=1`);assert.equal(response.status,401);response=await fetch(base+`/api/files/${image.id}?inline=1`,{headers:{Cookie:cookies}});assert.equal(response.status,200);assert.match(response.headers.get('Content-Disposition'),/^inline;/);assert.match(response.headers.get('Cache-Control'),/no-store/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
  response=await request(`announcements/${a.id}/read`,{method:'POST',body:{},cookie:cookies,csrf:login.csrfToken});assert.equal(response.status,201);
});
test('MVP: migrasi laporan versi lama mempertahankan temuan, tindakan, foto dan riwayat',t=>{
  const directory=temporary(t),path=resolve(directory,'legacy.sqlite');let db=openDb(path);seedPermissions(db);const user=insert(db,'users',{username:'lama',password_hash:hash,status:'ACTIVE',must_change_password:0,failed_login_count:0,password_changed_at:now()}),unit=insert(db,'org_units',{code:'L',name:'Lama',is_active:1}),employee=insert(db,'employees',{employee_no:'L',full_name:'Pegawai lama',employment_status:'Tetap',joined_on:'2020-01-01',is_active:1}),post=insert(db,'security_posts',{code:'L',name:'Pos lama',org_unit_id:unit.id,is_active:1}),log=insert(db,'logbook_entries',{employee_id:employee.id,post_id:post.id,occurred_at:now(),activity_type:'PATROLI',activity_notes:'Kegiatan lama',findings:'Temuan lama',created_by:user.id}),incident=insert(db,'incidents',{incident_no:'INC-LAMA',idempotency_key:'lama',post_id:post.id,reporter_employee_id:employee.id,occurred_at:now(),incident_type:'Lama',chronology:'Kronologi lama',initial_action:'Tindakan historis',source_logbook_entry_id:log.id,status:'RECORDED',created_by:user.id}),file=insert(db,'files',{storage_key:'lama',original_name:'lama.png',mime_type:'image/png',size_bytes:8,checksum:'test',status:'AVAILABLE',uploaded_by:user.id});insert(db,'incident_files',{incident_id:incident.id,file_id:file.id});insert(db,'incident_updates',{incident_id:incident.id,actor_user_id:user.id,event_type:'CREATED',notes:'Riwayat lama'});
  const schema=readFileSync(new URL('../schema.sql',import.meta.url),'utf8');db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
  for(const table of ['logbook_entries','incidents']){let ddl=schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?;`))[0];ddl=ddl.split('\n').filter(line=>!line.startsWith(' reporting_org_unit_id ')).join('\n').replace('post_id TEXT REFERENCES','post_id TEXT NOT NULL REFERENCES').replace('initial_action TEXT,','initial_action TEXT NOT NULL,');db.exec(ddl.replace(`IF NOT EXISTS ${table}`,`${table}_old`));const columns=all(db,`PRAGMA table_info(${table}_old)`).map(c=>c.name).join(',');db.exec(`INSERT INTO ${table}_old(${columns}) SELECT ${columns} FROM ${table};DROP TABLE ${table};ALTER TABLE ${table}_old RENAME TO ${table}`);}
  for(const table of ['incident_files','logbook_files'])db.exec(`ALTER TABLE ${table} DROP COLUMN captured_at;ALTER TABLE ${table} DROP COLUMN capture_source`);db.exec('DELETE FROM schema_migrations WHERE version=3;COMMIT');db.close();db=openDb(path);
  try{assert.equal(get(db,'logbook_entries',log.id).findings,'Temuan lama');assert.equal(get(db,'incidents',incident.id).initial_action,'Tindakan historis');assert.equal(get(db,'incidents',incident.id).source_logbook_entry_id,log.id);assert.equal(all(db,'SELECT * FROM incident_files').length,1);assert.equal(all(db,'SELECT * FROM incident_updates').length,1);assert.equal(all(db,'PRAGMA foreign_key_check').length,0);assert.equal(one(db,'SELECT max(version) n FROM schema_migrations').n,6);assert.throws(()=>run(db,"UPDATE incident_updates SET notes='ubah'"),/append-only/);}finally{db.close();}
});
