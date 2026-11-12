import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,sep} from 'node:path';
import {openDb,insert,one,all,run,now} from '../lib/db.mjs';
import {seedPermissions,hashPasswordSync} from '../lib/auth.mjs';
import {claimFile,fileAllowed} from '../lib/files.mjs';
import {announcementRoutes} from '../lib/announcements.mjs';
import {archiveRoutes,archiveUploadAllowed,archiveEnsureDailySummaries} from '../lib/archives.mjs';
import {archiveRules,archiveAgendaNumber,archiveWitaYear,archiveWitaDate,archiveDecide,archiveGrantActive,archiveNormalNumber,archiveNormalSubject,archiveDuplicateReasons,archiveDayStart,archiveDayEnd,archiveShiftDay} from '../lib/archive-rules.mjs';
import {createApp} from '../server.mjs';

// Semua nama, nomor, dan isi berkas di sini fiktif. Nomor ACxx merujuk PRD E-Arsip Tahap 1.
const password=hashPasswordSync('fixture123');
const pdf=(text='isi')=>Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.from(text)]);
const png=(text='x')=>Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from(text)]);

function fixture(t){
 const db=openDb(':memory:');t.after(()=>db.close());seedPermissions(db);
 const itRole=insert(db,'roles',{code:'IT_ADMIN',name:'IT Admin',is_system:1,is_active:1});
 run(db,'INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)',itRole.id,one(db,"SELECT id FROM permissions WHERE code='archives.officers.assign'").id);
 const unit=(code,name,parent=null)=>insert(db,'org_units',{code,name,parent_id:parent,is_active:1});
 const sek=unit('SEK','Sekretariat Fiktif'),hms=unit('SEK-HMS','Humas Fiktif',sek.id),keu=unit('SEK-KEU','Keuangan Fiktif',sek.id),ops=unit('OPS','Operasional Fiktif');
 let n=0;
 const person=(username,unitRow,role=null,scope='ALL')=>{
  let employee=null;
  if(unitRow){
   const position=insert(db,'positions',{code:`P${++n}`,name:`Staf ${username}`,org_unit_id:unitRow.id,is_active:1});
   employee=insert(db,'employees',{employee_no:`FX-${n}`,full_name:`Pegawai ${username}`,employment_status:'Tetap',joined_on:'2020-01-01',is_active:1});
   insert(db,'employee_placements',{employee_id:employee.id,position_id:position.id,valid_from:'2020-01-01',is_primary:1});
  }
  const user=insert(db,'users',{username,password_hash:password,status:'ACTIVE',employee_id:employee?.id||null,must_change_password:0,failed_login_count:0,password_changed_at:now()});
  if(role)user.role=insert(db,'user_roles',{user_id:user.id,role_id:one(db,'SELECT id FROM roles WHERE code=?',role).id,scope_kind:scope});
  return user;
 };
 const u={officerA:person('petugas.keu',keu),staffA:person('staf.keu',keu),officerB:person('petugas.ops',ops),staffB:person('staf.ops',ops),
  humas:person('humas.satu',hms,'HUMAS'),humasOfficer:person('humas.petugas',hms,'HUMAS'),boss:person('pimpinan',sek,'ARSIP_PENGAWAS','ASSIGNED_UNITS'),
  admin:person('admin',null,'SUPER_ADMIN'),itAdmin:person('it.admin',null,'IT_ADMIN'),outsider:person('tanpa.pegawai',null)};
 run(db,'INSERT INTO user_role_units(user_role_id,org_unit_id,include_descendants) VALUES(?,?,1)',u.boss.role.id,sek.id);
 const store=new Map(),claimed=[];
 const deps={claimFile,readFile:key=>store.get(key)||null,claimStorage:key=>claimed.push(key)};
 const call=(user,method,path,body={},query='')=>archiveRoutes({db,user:{...user,request_id:randomUUID()},p:path.split('/'),method,body,url:new URL(`http://localhost/?${query}`)},deps);
 const file=(user,name='surat.pdf',bytes=pdf(randomUUID()),mime=null)=>{
  const key=randomUUID();store.set(key,bytes);
  mime=mime||{pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}[name.split('.').pop()];
  return insert(db,'files',{storage_key:key,original_name:name,mime_type:mime,size_bytes:bytes.length,checksum:createHash('sha256').update(bytes).digest('hex'),status:'AVAILABLE',uploaded_by:user.id});
 };
 const f={db,u,units:{sek,hms,keu,ops},store,claimed,call,file,deps,person};
 f.assign=async(user,unitRow,code)=>call(u.admin,'POST','archives/officers',{user_id:user.id,org_unit_id:unitRow.id,reason:'SK penunjukan fiktif',agenda_code:code});
 f.payload=(user,unitRow,extra={})=>({idempotency_key:randomUUID(),owner_unit_id:unitRow.id,direction:'MASUK',document_type_id:'arsip-jenis-surat',official_number:`${Math.floor(Math.random()*1e6)}/FX/2026`,
  letter_date:'2026-11-10',subject:`Perihal fiktif ${randomUUID().slice(0,8)}`,main_file_id:file(user).id,attachment_file_ids:[],...extra});
 f.create=async(user,unitRow,extra={})=>(await call(user,'POST','archives',f.payload(user,unitRow,extra))).archive;
 f.classify=async(id,target='RAHASIA')=>call(u.humas,'POST',`archives/${id}/classification`,{target,reason:'Dokumen sensitif fiktif',expected_row_version:Number(one(db,'SELECT row_version FROM archive_records WHERE id=?',id).row_version)});
 f.grant=(id,body)=>call(u.humas,'POST',`archives/${id}/grants`,body);
 return f;
}
async function ready(t){const f=fixture(t);await f.assign(f.u.officerA,f.units.keu,'KEU');await f.assign(f.u.officerB,f.units.ops,'OPS');await f.assign(f.u.humasOfficer,f.units.hms,'HMS');return f;}
const status=(promise,code,pattern)=>assert.rejects(promise,error=>{assert.equal(error.status,code,error.message);if(pattern)assert.match(error.message,pattern);return true;});
const listed=async(f,user,query='')=>(await f.call(user,'GET','archives',{},query)).items;

test('Super Admin tanpa profil pegawai atau penunjukan menambah dan mengelola semua arsip',async t=>{
 const f=await ready(t),{db,u,units}=f;
 assert.equal(u.admin.employee_id,null);assert.equal(archiveUploadAllowed(db,u.admin),true);
 const overview=await f.call(u.admin,'GET','archives/overview');
 assert.equal(overview.super_admin,true);assert(overview.officer_units.some(x=>x.id===units.ops.id));
 const a=await f.create(u.admin,units.ops);
 assert.equal(one(db,'SELECT count(*) n FROM archive_officers WHERE user_id=?',u.admin.id).n,0);
 await f.call(u.admin,'POST',`archives/${a.id}/classification`,{target:'RAHASIA',reason:'Klasifikasi admin',expected_row_version:1});
 let detail=await f.call(u.admin,'GET',`archives/${a.id}`);
 assert.equal(detail.archive.restricted,false);assert.equal(detail.access.edit,true);assert.equal(detail.access.download,true);
 assert(detail.access.sources.includes('SUPER_ADMIN'));
 await f.call(u.admin,'PATCH',`archives/${a.id}`,{...f.payload(u.admin,units.ops),subject:'Koreksi Super Admin',expected_row_version:2});
 detail=await f.call(u.admin,'GET',`archives/${a.id}`);assert.equal(detail.archive.subject,'Koreksi Super Admin');
 const main=detail.documents.find(d=>d.role==='MAIN');
 assert(await f.call(u.admin,'GET',`archives/${a.id}/documents/${main.id}/versions/${main.current_version_id}/download`));
 await status(f.call(u.itAdmin,'GET',`archives/${a.id}`),404);
 await f.call(u.admin,'POST',`archives/${a.id}/delete`,{reason:'Keliru',reference:'Uji admin'});
 await status(f.call(u.admin,'GET',`archives/${a.id}`),404);
 await f.call(u.admin,'POST',`archives/deleted/${a.id}/restore`,{reason:'Dipakai lagi'});
 assert.equal((await f.call(u.admin,'GET',`archives/${a.id}`)).archive.subject,'Koreksi Super Admin');
 run(db,'DELETE FROM user_roles WHERE id=?',u.admin.role.id);
 assert.equal(archiveUploadAllowed(db,u.admin),false);
 await status(f.call(u.admin,'GET',`archives/${a.id}`),404);
});

test('Kepala Urusan hanya mencabut bawahannya; staf dan IT Admin tidak dapat melewati aturan lewat penunjukan ulang',async t=>{
 const f=fixture(t),{db,u,units}=f;
 const chiefA=f.person('kaur.humas',units.sek,'EMPLOYEE'),chiefB=f.person('kaur.keuangan',units.sek,'EMPLOYEE');
 const staffA=f.person('anggota.humas',units.sek,'HUMAS'),staffB=f.person('anggota.keuangan',units.sek,'EMPLOYEE');
 const title=(user,name)=>run(db,'UPDATE positions SET name=? WHERE id=(SELECT position_id FROM employee_placements WHERE employee_id=? AND is_primary=1)',name,user.employee_id);
 title(chiefA,'Kepala Urusan Hubungan Masyarakat');title(chiefB,'Kepala Urusan Keuangan');
 run(db,'UPDATE employee_placements SET supervisor_employee_id=? WHERE employee_id=?',chiefA.employee_id,staffA.employee_id);
 run(db,'UPDATE employee_placements SET supervisor_employee_id=? WHERE employee_id=?',chiefB.employee_id,staffB.employee_id);
 await f.assign(staffA,units.sek,'SEK');await f.assign(staffB,units.sek,'SEK');
 const archive=await f.create(staffA,units.sek),appointment=one(db,'SELECT * FROM archive_officers WHERE user_id=?',staffA.id);
 const overview=await f.call(chiefA,'GET','archives/overview');assert.equal(overview.admin,false);assert.equal(overview.officer_management,true);
 const list=await f.call(chiefA,'GET','archives/officers');
 assert.deepEqual(list.officers.map(o=>o.user.id),[staffA.id]);assert.equal(list.officers[0].can_revoke,true);assert.equal(list.can_assign,false);assert.equal(list.can_manage_codes,false);
 assert((await f.call(u.itAdmin,'GET','archives/officers')).officers.every(o=>o.can_revoke===false));
 for(const actor of [staffA,u.itAdmin,chiefB])await status(f.call(actor,'POST',`archives/officers/${appointment.id}/revoke`,{reason:'Tidak berwenang'}),403);
 await status(f.call(u.itAdmin,'POST','archives/officers',{user_id:staffA.id,org_unit_id:units.sek.id,agenda_code:'SEK',reason:'Mencoba menunjuk ulang'}),403);
 assert.equal(one(db,'SELECT revoked_at FROM archive_officers WHERE id=?',appointment.id).revoked_at,null);
 title(chiefA,'Koordinator Hubungan Masyarakat');
 await status(f.call(chiefA,'POST',`archives/officers/${appointment.id}/revoke`,{reason:'Sudah pindah jabatan'}),403);
 title(chiefA,'Kepala Urusan Hubungan Masyarakat');
 await f.call(chiefA,'POST',`archives/officers/${appointment.id}/revoke`,{reason:'Rotasi tugas'});
 assert.equal((await f.call(chiefA,'GET','archives/officers')).officers[0].can_revoke,false);
 assert.equal((await f.call(staffA,'GET',`archives/${archive.id}`)).access.edit,false);
 await status(f.call(staffA,'POST','archives',f.payload(staffA,units.sek)),403);
 assert.equal(one(db,'SELECT count(*) n FROM archive_records').n,1);
});

test('berkas arsip tidak dapat ditautkan atau dibaca melalui pengumuman, termasuk versi lama',async t=>{
 const f=await ready(t),{db,u,units}=f;
 insert(db,'user_roles',{user_id:u.officerA.id,role_id:one(db,"SELECT id FROM roles WHERE code='SDM'").id,scope_kind:'ALL'});
 const payload=f.payload(u.officerA,units.keu),a=(await f.call(u.officerA,'POST','archives',payload)).archive;
 let detail=await f.call(u.officerA,'GET',`archives/${a.id}`),main=detail.documents[0];
 const replacement=f.file(u.officerA),attachment=f.file(u.officerA);
 detail=await f.call(u.officerA,'POST',`archives/${a.id}/documents/${main.id}/versions`,{file_id:replacement.id,idempotency_key:randomUUID(),expected_row_version:1,change_reason:'Scan baru'});
 detail=await f.call(u.officerA,'POST',`archives/${a.id}/documents`,{file_id:attachment.id,idempotency_key:randomUUID(),expected_row_version:detail.archive.row_version});
 const attached=detail.documents.find(d=>d.role==='ATTACHMENT');
 await f.call(u.officerA,'POST',`archives/${a.id}/documents/${attached.id}/remove`,{reason:'Keliru',expected_row_version:detail.archive.row_version});
 await f.classify(a.id);
 const announce=fileId=>announcementRoutes({db,user:u.officerA,p:['announcements'],method:'POST',body:{title:'Pengumuman fiktif',category:'UMUM',blocks:[{type:'text',text:'Isi fiktif'}],attachments:[{file_id:fileId}]}});
 const fileIds=[payload.main_file_id,replacement.id,attachment.id];
 for(const id of fileIds){await status(announce(id),422,/terhubung ke arsip/);assert.equal(fileAllowed(db,u.officerA,id),false);}
 // Arah sebaliknya juga ditolak: lampiran pengumuman tidak boleh dipakai arsip.
 const ordinary=f.file(u.officerA),announcement=await announce(ordinary.id);
 await status(f.call(u.officerA,'POST','archives',f.payload(u.officerA,units.keu,{main_file_id:ordinary.id})),422,/sudah terhubung/i);
 run(db,"UPDATE announcements SET status='PUBLISHED',published_at=? WHERE id=?",now(),announcement.id);
 assert.equal(fileAllowed(db,u.staffB,ordinary.id),true);
 // Data ikatan ganda yang mungkin sudah ada tetap tidak membuka rute umum.
 insert(db,'announcement_files',{announcement_id:announcement.id,file_id:payload.main_file_id,usage_kind:'ATTACHMENT',caption:'',created_by:u.officerA.id});
 assert.equal(fileAllowed(db,u.staffB,payload.main_file_id),false);
 await f.call(u.humas,'POST',`archives/${a.id}/delete`,{reason:'Keliru',reference:'Pesan fiktif'});
 for(const id of fileIds)assert.throws(()=>claimFile(db,u.officerA,id),/terhubung ke arsip/);
});

test('kirim ulang pembuatan mengikuti hak baca dan penghapusan terkini',async t=>{
 const f=await ready(t),{db,u,units}=f,payload=f.payload(u.officerA,units.keu);
 const a=(await f.call(u.officerA,'POST','archives',payload)).archive;
 await f.classify(a.id);
 await f.grant(a.id,{purpose:'RAHASIA_READ',target_user_id:u.officerA.id,reason:'Koreksi'});
 await f.call(u.officerA,'PATCH',`archives/${a.id}`,{...payload,subject:'Perihal rahasia baru',official_number:'RAHASIA-BARU',expected_row_version:2});
 const grant=one(db,"SELECT id FROM archive_access_grants WHERE archive_id=? AND purpose='RAHASIA_READ' AND revoked_at IS NULL",a.id);
 await f.call(u.humas,'POST',`archives/${a.id}/grants/${grant.id}/revoke`,{reason:'Selesai'});
 const replay=await f.call(u.officerA,'POST','archives',payload);
 assert.equal(replay.repeated,true);assert.equal(replay.archive.restricted,true);
 assert.deepEqual(Object.keys(replay.archive).sort(),['agenda_number','archived_at','classification','id','restricted']);
 assert(!JSON.stringify(replay).includes('RAHASIA-BARU'));
 await f.call(u.humas,'POST',`archives/${a.id}/delete`,{reason:'Keliru',reference:'Pesan fiktif'});
 await status(f.call(u.officerA,'POST','archives',payload),404);
 await f.call(u.humas,'POST',`archives/deleted/${a.id}/restore`,{reason:'Diperlukan'});
 await f.grant(a.id,{purpose:'RAHASIA_READ',target_user_id:u.officerA.id,reason:'Lanjut'});
 assert.equal((await f.call(u.officerA,'POST','archives',payload)).archive.subject,'Perihal rahasia baru');
 assert.equal(one(db,'SELECT count(*) n FROM archive_records').n,1);
});

test('riwayat perubahan tetap terlihat setelah lebih dari 300 pembukaan detail',async t=>{
 const f=await ready(t),{u,units}=f,a=await f.create(u.officerA,units.keu);
 await f.grant(a.id,{purpose:'DOWNLOAD',target_user_id:u.staffA.id,reason:'Cetak'});
 for(let i=0;i<310;i++)await f.call(u.officerA,'GET',`archives/${a.id}`);
 const humas=await f.call(u.humas,'GET',`archives/${a.id}/history`),officer=await f.call(u.officerA,'GET',`archives/${a.id}/history`);
 assert(humas.items.some(i=>i.action==='ARCHIVE_CREATED'));assert(humas.items.some(i=>i.action==='DOWNLOAD_GRANTED'));
 assert(!humas.items.some(i=>i.action==='DETAIL_OPENED'));
 assert.deepEqual(officer.items.map(i=>i.action),['ARCHIVE_CREATED']);
});

test('tanpa migrasi arsip, pemeriksaan unggah dan lampiran lama tetap berjalan',async t=>{
 const f=fixture(t),{db,u}=f,file=f.file(u.admin);
 db.exec('ALTER TABLE archive_officers RENAME TO archive_officers_not_installed');
 assert.equal(archiveUploadAllowed(db,u.admin),false);
 assert.equal(await f.call(u.admin,'GET','archives/overview'),undefined);
 assert.equal(claimFile(db,u.admin,file.id).id,file.id);
 assert.equal(fileAllowed(db,u.admin,file.id),false);
});

test('penunjukan tetap aktif bila penyimpanan terjadi setelah waktu awal permintaan',async t=>{
 const f=fixture(t),{db,u,units}=f;
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 const prepare=db.prepare.bind(db);
 t.mock.method(db,'prepare',sql=>{
  if(sql.startsWith('SELECT u.id,u.username,u.employee_id,e.full_name'))t.mock.timers.tick(20);
  return prepare(sql);
 });
 const result=await f.assign(u.officerA,units.keu,'KEU');
 assert.equal(result.officers[0].status,'AKTIF');assert.equal(result.officers[0].expires_at,null);
});

/* ---------- Aturan murni ---------- */
test('E-Arsip aturan: nomor agenda, tahun WITA, normalisasi, dan predikat kanonis',()=>{
 assert.equal(archiveAgendaNumber('HMS',2026,1),'HMS/2026/0001');
 assert.equal(archiveAgendaNumber('HMS',2026,10000),'HMS/2026/10000');
 // 31 Des 2026 16.30 UTC sudah 1 Jan 2027 di WITA.
 assert.equal(archiveWitaYear(Date.parse('2026-12-31T15:59:59Z')),2026);
 assert.equal(archiveWitaYear(Date.parse('2026-12-31T16:00:00Z')),2027);
 assert.equal(archiveWitaDate(Date.parse('2026-11-11T16:00:00Z')),'2026-11-12');
 assert.equal(archiveDayStart('2026-11-12'),'2026-11-11T16:00:00.000Z');
 assert.equal(archiveDayEnd('2026-11-12'),'2026-11-12T16:00:00.000Z');
 assert.equal(archiveNormalNumber(' 005 / HMS / XI /2026 '),'005/hms/xi/2026');
 assert.equal(archiveNormalSubject('  Undangan   RAPAT—Koordinasi! '),'undangan rapat koordinasi');
 assert.equal(archiveRules.maxFileBytes,10_000_000);
 const d=archiveDecide;
 assert.deepEqual(d({classification:'BIASA',scope:true}),{list:true,read:true,edit:false,download:false});
 assert.deepEqual(d({classification:'RAHASIA',scope:true}),{list:true,read:false,edit:false,download:false});
 assert.deepEqual(d({classification:'RAHASIA',scope:true,officer:true,download:true}),{list:true,read:false,edit:false,download:false});
 assert.deepEqual(d({classification:'RAHASIA',rahasia:true,download:true}),{list:true,read:true,edit:false,download:true});
 assert.deepEqual(d({classification:'RAHASIA',humas:true}),{list:true,read:true,edit:false,download:false});
 assert.deepEqual(d({classification:'BIASA',download:true}),{list:false,read:false,edit:false,download:false});
 assert.deepEqual(d({deleted:true,classification:'BIASA',humas:true,scope:true,officer:true,download:true}),{list:false,read:false,edit:false,download:false});
 const at='2026-11-12T00:00:00.000Z',grant={purpose:'RAHASIA_READ',security_epoch:2,valid_from:'2026-11-11T00:00:00.000Z',expires_at:at};
 assert.equal(archiveGrantActive({...grant,expires_at:'2026-11-12T00:00:00.001Z'},at,2),true);
 assert.equal(archiveGrantActive(grant,at,2),false,'akhir masa berlaku eksklusif');
 assert.equal(archiveGrantActive({...grant,expires_at:null},at,3),false,'izin dari epoch lama tidak berlaku');
 assert.equal(archiveGrantActive({...grant,expires_at:null,revoked_at:at},at,2),false);
 assert.deepEqual(archiveDuplicateReasons({checksum_match:true,official_number_normalized:'1',letter_date:'2026-01-01',subject_normalized:'a'},{official_number_normalized:'1',letter_date:'2026-01-01',subject_normalized:'a'}),['BERKAS_SAMA','NOMOR_DAN_TANGGAL','PERIHAL_DAN_TANGGAL']);
 assert.deepEqual(archiveDuplicateReasons({official_number_normalized:null,letter_date:'2026-01-01',subject_normalized:'a'},{official_number_normalized:null,letter_date:'2026-01-02',subject_normalized:'a'}),[]);
});

/* ---------- Penunjukan petugas dan tambah arsip ---------- */
test('AC01/AC13/AC16: hanya administrator menunjuk petugas; petugas hanya untuk bagiannya',async t=>{
 const f=fixture(t),{u,units}=f;
 for(const user of [u.humas,u.officerA,u.staffA])await status(f.call(user,'POST','archives/officers',{user_id:u.officerA.id,org_unit_id:units.keu.id,reason:'x',agenda_code:'KEU'}),403,/administrator/);
 await status(f.assign(u.officerA,units.ops,'OPS'),422,/ditempatkan pada bagian/);
 await status(f.call(u.admin,'POST','archives/officers',{user_id:u.officerA.id,org_unit_id:units.keu.id,reason:'SK',agenda_code:'k'}),422,/Kode agenda/);
 const result=await f.assign(u.officerA,units.keu,'KEU');
 assert.equal(result.officers[0].status,'AKTIF');assert.equal(result.units.find(x=>x.id===units.keu.id).agenda_code,'KEU');
 assert.equal(archiveUploadAllowed(f.db,u.officerA),true);assert.equal(archiveUploadAllowed(f.db,u.staffA),false);assert.equal(archiveUploadAllowed(f.db,u.humas),false);
 await f.assign(u.officerB,units.ops,'OPS');
 await status(f.call(u.admin,'POST','archives/units',{org_unit_id:units.hms.id,agenda_code:'KEU'}),409,/sudah dipakai/);
 // Pegawai tanpa penunjukan dan Humas tanpa penunjukan ditolak; petugas A ditolak untuk bagian B.
 for(const [user,unitRow] of [[u.staffA,units.keu],[u.humas,units.hms],[u.officerA,units.ops],[u.itAdmin,units.keu]])await status(f.call(user,'POST','archives',f.payload(u.officerA,unitRow)),403,/petugas arsip yang ditunjuk/);
 const a=await f.create(u.officerA,units.keu);
 assert.match(a.agenda_number,/^KEU\/\d{4}\/0001$/);
 // Kode agenda terkunci setelah dipakai.
 await status(f.call(u.admin,'POST','archives/units',{org_unit_id:units.keu.id,agenda_code:'KEUA'}),409,/tidak dapat diubah/);
 // Cabut penunjukan saat sesi masih hidup: permintaan berikutnya ditolak, kepemilikan arsip tetap.
 const officer=one(f.db,'SELECT id FROM archive_officers WHERE user_id=?',u.officerA.id);
 await f.call(u.admin,'POST',`archives/officers/${officer.id}/revoke`,{reason:'Pindah tugas fiktif'});
 await status(f.call(u.officerA,'POST','archives',f.payload(u.officerA,units.keu)),403);
 await status(f.call(u.officerA,'PATCH',`archives/${a.id}`,{expected_row_version:1,direction:'KELUAR',document_type_id:'arsip-jenis-surat',letter_date:'2026-11-10',subject:'ubah'}),403);
 assert.equal(one(f.db,'SELECT owner_unit_id FROM archive_records WHERE id=?',a.id).owner_unit_id,units.keu.id);
 assert.equal((await f.call(u.officerA,'GET',`archives/${a.id}`)).access.edit,false);
 assert(one(f.db,"SELECT 1 FROM archive_audit_events WHERE action='OFFICER_REVOKED'"));
});
test('AC13: pindah bagian menutup hak edit walau penunjukan belum dicabut',async t=>{
 const f=await ready(t),{u,units,db}=f,a=await f.create(u.officerA,units.keu);
 const placement=one(db,'SELECT ep.id FROM employee_placements ep WHERE ep.employee_id=?',u.officerA.employee_id),position=insert(db,'positions',{code:'PX',name:'Staf Pindahan',org_unit_id:units.ops.id,is_active:1});
 run(db,'UPDATE employee_placements SET position_id=? WHERE id=?',position.id,placement.id);
 await status(f.call(u.officerA,'POST','archives',f.payload(u.officerA,units.keu)),403);
 // Bukan lagi anggota bagian pemilik: arsip KEU tidak lagi terlihat sama sekali.
 await status(f.call(u.officerA,'GET',`archives/${a.id}`),404);
 assert.equal((await f.call(u.admin,'GET','archives/officers')).officers.find(o=>o.user.id===u.officerA.id&&!o.revoked_at).status,'TIDAK_BERLAKU');
});
test('AC02/AC03/AC04/AC34: arsip baru langsung Biasa dan aktif; form wajib; agenda tahun pengarsipan',async t=>{
 const f=await ready(t),{u,units,db}=f;
 const base=()=>f.payload(u.officerA,units.keu);
 await status(f.call(u.officerA,'POST','archives',{...base(),direction:'LAINNYA'}),422,/Arah surat/);
 await status(f.call(u.officerA,'POST','archives',{...base(),document_type_id:'tidak-ada'}),422,/Jenis dokumen/);
 await status(f.call(u.officerA,'POST','archives',{...base(),letter_date:'2026-13-01'}),422,/Tanggal surat/);
 await status(f.call(u.officerA,'POST','archives',{...base(),subject:'   '}),422,/Perihal/);
 await status(f.call(u.officerA,'POST','archives',{...base(),subject:'x'.repeat(501)}),422,/Perihal/);
 await status(f.call(u.officerA,'POST','archives',{...base(),main_file_id:null}),422,/Dokumen utama/);
 // Klien tidak dapat memaksa Rahasia, bagian lain, agenda, atau pembuat.
 const a=await f.create(u.officerA,units.keu,{official_number:'',letter_date:'2024-03-05',classification:'RAHASIA',agenda_number:'XX/1999/9999',created_by:u.humas.id,archived_at:'2024-03-05T00:00:00.000Z'});
 const row=one(db,'SELECT * FROM archive_records WHERE id=?',a.id);
 assert.equal(row.classification,'BIASA');assert.equal(row.official_number,null);assert.equal(row.created_by,u.officerA.id);assert.equal(row.deleted_at,null);
 assert.equal(row.letter_date,'2024-03-05');assert.equal(Number(row.archival_year),archiveWitaYear(Date.now()));
 assert.equal(row.agenda_number,`KEU/${archiveWitaYear(Date.now())}/0001`);assert.notEqual(row.agenda_number,row.id);
 // Langsung terbaca pegawai bagian pemilik, tanpa persetujuan Humas.
 const detail=await f.call(u.staffA,'GET',`archives/${a.id}`);
 assert.equal(detail.archive.subject,row.subject);assert.deepEqual(detail.access.sources,['BAGIAN']);assert.equal(detail.access.edit,false);
 assert.equal(one(db,"SELECT count(*) n FROM archive_audit_events WHERE archive_id=? AND action='ARCHIVE_CREATED'",a.id).n,1);
 assert.equal(f.claimed.length,1,'berkas diikat ke folder modul saat finalisasi');
});
test('AC05/AC41: agenda berurutan per bagian-tahun; kirim ulang operasi yang sama tidak membuat arsip kedua',async t=>{
 const f=await ready(t),{u,units,db}=f,year=archiveWitaYear(Date.now());
 const body=f.payload(u.officerA,units.keu);
 const [first,second]=await Promise.all([f.call(u.officerA,'POST','archives',body),f.call(u.officerA,'POST','archives',f.payload(u.officerA,units.keu))]);
 assert.deepEqual([first.archive.agenda_number,second.archive.agenda_number].sort(),[`KEU/${year}/0001`,`KEU/${year}/0002`]);
 const again=await f.call(u.officerA,'POST','archives',body);
 assert.equal(again.repeated,true);assert.equal(again.archive.id,first.archive.id);assert.equal(again.archive.agenda_number,first.archive.agenda_number);
 await status(f.call(u.officerA,'POST','archives',{...body,subject:'Isi berbeda dengan kunci sama'}),409,/isi berbeda/);
 assert.equal(one(db,'SELECT count(*) n FROM archive_records').n,2);assert.equal(one(db,"SELECT count(*) n FROM archive_audit_events WHERE action='ARCHIVE_CREATED'").n,2);
 // Bagian lain punya pencacah sendiri; arah dan jenis tidak memisahkan pencacah.
 assert.equal((await f.create(u.officerB,units.ops,{direction:'KELUAR'})).agenda_number,`OPS/${year}/0001`);
 assert.equal((await f.create(u.officerA,units.keu,{direction:'INTERNAL',document_type_id:'arsip-jenis-ba'})).agenda_number,`KEU/${year}/0003`);
 // Pergantian tahun: pencacah tahun baru mulai dari 1 tanpa mengubah tahun lama.
 run(db,'INSERT INTO archive_agenda_counters(id,org_unit_id,archival_year,last_value,updated_at) VALUES(?,?,?,?,?)',randomUUID(),units.keu.id,year+1,41,now());
 assert.equal(one(db,'SELECT last_value FROM archive_agenda_counters WHERE org_unit_id=? AND archival_year=?',units.keu.id,year).last_value,3);
 // Nomor tidak dipakai ulang setelah hapus logis.
 const third=one(db,'SELECT id FROM archive_records WHERE agenda_sequence=3 AND owner_unit_id=?',units.keu.id);
 await f.call(u.humas,'POST',`archives/${third.id}/delete`,{reason:'Salah unggah fiktif',reference:'WA 12 Nov'});
 assert.equal((await f.create(u.officerA,units.keu)).agenda_number,`KEU/${year}/0004`);
});
test('AC06/AC07/AC08/AC09: satu dokumen utama, format dan ukuran berkas, banyak lampiran',async t=>{
 const f=await ready(t),{u,units,db}=f;
 const big=(size)=>{const file=f.file(u.officerA,'besar.pdf',pdf());run(db,'UPDATE files SET size_bytes=? WHERE id=?',size,file.id);return file;};
 await status(f.call(u.officerA,'POST','archives',f.payload(u.officerA,units.keu,{main_file_id:f.file(u.officerA,'surat.docx',Buffer.from('PK')).id})),422,/PDF, JPG, JPEG, atau PNG/);
 await status(f.call(u.officerA,'POST','archives',f.payload(u.officerA,units.keu,{main_file_id:f.file(u.officerA,'palsu.pdf',png(),'image/png').id})),422,/ekstensi tidak sesuai/);
 await status(f.call(u.officerA,'POST','archives',f.payload(u.officerA,units.keu,{main_file_id:big(10_000_001).id})),413,/10 MB/);
 await status(f.call(u.officerA,'POST','archives',f.payload(u.officerA,units.keu,{main_file_id:f.file(u.officerB).id})),422,/Unggah ulang/);
 const duplicateId=f.file(u.officerA).id;
 await status(f.call(u.officerA,'POST','archives',f.payload(u.officerA,units.keu,{main_file_id:duplicateId,attachment_file_ids:[duplicateId]})),422,/Daftar berkas/);
 // Satu lampiran gagal: tidak ada arsip, dokumen, atau nomor agenda yang tersisa.
 await status(f.call(u.officerA,'POST','archives',f.payload(u.officerA,units.keu,{attachment_file_ids:[f.file(u.officerA,'a.png',png('1')).id,big(10_000_001).id]})),413);
 assert.equal(one(db,'SELECT count(*) n FROM archive_records').n,0);assert.equal(one(db,'SELECT count(*) n FROM archive_documents').n,0);assert.equal(one(db,'SELECT count(*) n FROM archive_agenda_counters').n,0);
 const a=await f.create(u.officerA,units.keu,{main_file_id:big(10_000_000).id,attachment_file_ids:[f.file(u.officerA,'a.png',png('2')).id,f.file(u.officerA,'b.jpg',Buffer.from([255,216,255,1])).id]});
 const detail=await f.call(u.officerA,'GET',`archives/${a.id}`);
 assert.deepEqual(detail.documents.map(d=>d.role),['MAIN','ATTACHMENT','ATTACHMENT']);
 assert.equal(detail.documents[0].versions[0].size,10_000_000);
 // Berkas yang sudah dipakai arsip tidak bisa dipakai lagi.
 const used=one(db,'SELECT file_id FROM archive_document_versions LIMIT 1').file_id;
 await status(f.call(u.officerA,'POST','archives',f.payload(u.officerA,units.keu,{main_file_id:used})),422,/sudah dipakai/);
 // Basis data menolak dokumen utama kedua dan pelepasan dokumen utama.
 const main=detail.documents[0];
 assert.throws(()=>run(db,"INSERT INTO archive_documents(id,archive_id,role,display_order,current_version_id,created_by,created_at,updated_at,row_version) VALUES(?,?,'MAIN',9,?,?,?,?,1)",randomUUID(),a.id,main.current_version_id,u.officerA.id,now(),now()),/UNIQUE|FOREIGN/);
 assert.throws(()=>run(db,"UPDATE archive_documents SET removed_at=?,removed_by=?,remove_reason='x' WHERE id=?",now(),u.officerA.id,main.id),/CHECK/);
 await status(f.call(u.officerA,'POST',`archives/${a.id}/documents/${main.id}/remove`,{reason:'coba',expected_row_version:detail.archive.row_version}),422,/Dokumen utama tidak dapat dilepas/);
 assert.throws(()=>run(db,'DELETE FROM archive_records WHERE id=?',a.id),/tidak boleh dihapus permanen/);
 assert.throws(()=>run(db,"UPDATE archive_records SET agenda_number='KEU/2000/0001' WHERE id=?",a.id),/Identitas arsip/);
});

/* ---------- Edit, versi, dan riwayat ---------- */
test('AC10/AC41: edit metadata diaudit sebelum/sesudah, konflik versi ditolak, berkas lama tetap ada',async t=>{
 const f=await ready(t),{u,units,db}=f,a=await f.create(u.officerA,units.keu,{subject:'Perihal awal',official_number:'001/FX'});
 const edit=(version,extra={})=>f.call(u.officerA,'PATCH',`archives/${a.id}`,{expected_row_version:version,direction:'MASUK',document_type_id:'arsip-jenis-surat',official_number:'001/FX',letter_date:'2026-11-10',subject:'Perihal awal',...extra});
 await status(edit(1),422,/Tidak ada perubahan/);
 // Dua edit dengan versi yang sama: satu berhasil, satu konflik.
 const [x,y]=await Promise.allSettled([edit(1,{subject:'Perihal A'}),edit(1,{subject:'Perihal B'})]);
 assert.deepEqual([x.status,y.status].sort(),['fulfilled','rejected']);assert.equal((x.status==='rejected'?x:y).reason.status,409);
 const current=one(db,'SELECT * FROM archive_records WHERE id=?',a.id);assert.equal(Number(current.row_version),2);
 // Mass assignment: kolom yang bukan metadata umum diabaikan.
 const edited=await edit(2,{subject:'Perihal final',document_type_id:'arsip-jenis-und',classification:'RAHASIA',owner_unit_id:units.ops.id,deleted_at:now(),agenda_number:'OPS/2026/0009',security_epoch:9});
 const row=one(db,'SELECT * FROM archive_records WHERE id=?',a.id);
 assert.equal(row.classification,'BIASA');assert.equal(row.owner_unit_id,units.keu.id);assert.equal(row.deleted_at,null);assert.equal(row.agenda_number,a.agenda_number);assert.equal(Number(row.security_epoch),1);
 assert.equal(row.document_type_name_snapshot,'Undangan');assert.equal(edited.archive.document_type,'Undangan');
 const audit=one(db,"SELECT * FROM archive_audit_events WHERE archive_id=? AND action='METADATA_EDITED' ORDER BY occurred_at DESC LIMIT 1",a.id);
 assert.deepEqual(JSON.parse(audit.before_data).document_type_id,'arsip-jenis-surat');assert.equal(JSON.parse(audit.after_data).subject,'Perihal final');
 assert.equal(JSON.parse(audit.safe_context).document_type_before,'Surat');
 // Pegawai biasa, penerima berbagi, dan Humas tanpa penunjukan tidak dapat mengedit.
 await f.grant(a.id,{purpose:'BIASA_SHARE',target_user_id:u.staffB.id});
 for(const user of [u.staffA,u.staffB,u.humas])await status(f.call(user,'PATCH',`archives/${a.id}`,{expected_row_version:3,direction:'KELUAR',document_type_id:'arsip-jenis-und',letter_date:'2026-11-10',subject:'x'}),403);
 // Ganti berkas: versi baru, versi lama tetap dapat dipratinjau; alasan wajib.
 const detail=await f.call(u.officerA,'GET',`archives/${a.id}`),main=detail.documents[0],oldVersion=main.versions[0];
 const replace=(body)=>f.call(u.officerA,'POST',`archives/${a.id}/documents/${main.id}/versions`,body);
 await status(replace({idempotency_key:randomUUID(),file_id:f.file(u.officerA).id,expected_row_version:3}),422,/Alasan penggantian/);
 const key=randomUUID(),fresh=f.file(u.officerA,'revisi.pdf',pdf('revisi'));
 const replaced=await replace({idempotency_key:key,file_id:fresh.id,change_reason:'Scan lebih jelas',expected_row_version:3});
 assert.deepEqual(replaced.documents[0].versions.map(v=>[v.version_number,v.current]),[[2,true],[1,false]]);
 const repeat=await replace({idempotency_key:key,file_id:fresh.id,change_reason:'Scan lebih jelas',expected_row_version:3});
 assert.equal(repeat.documents[0].versions.length,2,'kirim ulang tidak membuat versi ketiga');
 await status(replace({idempotency_key:randomUUID(),file_id:f.file(u.officerA).id,change_reason:'basi',expected_row_version:3}),409,/sudah diubah/);
 const preview=await f.call(u.staffA,'GET',`archives/${a.id}/documents/${main.id}/versions/${oldVersion.id}/preview`);
 assert.equal(preview.mime,'application/pdf');assert.equal(preview.filename,undefined);assert.equal(Buffer.from(preview.data,'base64').length,oldVersion.size);
 assert.throws(()=>run(db,"UPDATE archive_document_versions SET sha256=? WHERE id=?",'0'.repeat(64),oldVersion.id),/tidak boleh diubah/);
 // Lampiran: tambah lalu lepas secara logis; histori versi tetap tersimpan.
 const added=await f.call(u.officerA,'POST',`archives/${a.id}/documents`,{idempotency_key:randomUUID(),file_id:f.file(u.officerA,'lampiran.png',png('L')).id,expected_row_version:replaced.archive.row_version});
 const attachment=added.documents.find(d=>d.role==='ATTACHMENT');
 const removed=await f.call(u.officerA,'POST',`archives/${a.id}/documents/${attachment.id}/remove`,{reason:'Lampiran keliru',expected_row_version:added.archive.row_version});
 assert.equal(removed.documents.length,1);assert.equal(one(db,'SELECT count(*) n FROM archive_document_versions WHERE document_id=?',attachment.id).n,1);
 await status(f.call(u.staffA,'GET',`archives/${a.id}/documents/${attachment.id}/versions/${attachment.versions[0].id}/preview`),404);
 // Riwayat: petugas pembaca melihat perubahan isi; pegawai biasa tidak; Humas melihat semua.
 const history=await f.call(u.officerA,'GET',`archives/${a.id}/history`);
 assert.deepEqual([...new Set(history.items.map(i=>i.action))].sort(),['ARCHIVE_CREATED','ATTACHMENT_ADDED','ATTACHMENT_REMOVED','METADATA_EDITED','VERSION_ADDED']);
 assert(history.items.every(i=>i.context===undefined));
 await status(f.call(u.staffA,'GET',`archives/${a.id}/history`),403);
 assert((await f.call(u.humas,'GET',`archives/${a.id}/history`)).items.some(i=>i.action==='SHARE_GRANTED'));
});

/* ---------- Lingkup baca, berbagi, dan klasifikasi ---------- */
test('AC14/AC20/AC32/AC33: berbagi hanya oleh Humas, hanya baca, notifikasi hanya untuk yang dituju',async t=>{
 const f=await ready(t),{u,units,db}=f,a=await f.create(u.officerA,units.keu);
 for(const user of [u.staffB,u.outsider,u.itAdmin]){await status(f.call(user,'GET',`archives/${a.id}`),404);assert.equal((await listed(f,user)).length,0);assert.equal((await f.call(user,'GET','archives/dashboard')).total,0);}
 await status(f.call(u.staffB,'GET',`archives/${randomUUID()}`),404);
 for(const user of [u.officerA,u.staffA,u.itAdmin,u.boss])await status(f.call(user,'POST',`archives/${a.id}/grants`,{purpose:'BIASA_SHARE',target_user_id:u.staffB.id}),403,/Humas/);
 // Berbagi ke pengguna: langsung berlaku, notifikasi hanya ke pengguna itu.
 await f.grant(a.id,{purpose:'BIASA_SHARE',target_user_id:u.staffB.id,notify_user_ids:[u.staffB.id]});
 const shared=await f.call(u.staffB,'GET',`archives/${a.id}`);
 assert.deepEqual(shared.access.sources,['BERBAGI']);assert.equal(shared.access.edit,false);assert.equal(shared.access.download,false);
 assert.equal((await listed(f,u.staffB,'shared=1')).length,1);assert.equal((await listed(f,u.staffA,'shared=1')).length,0);
 const notes=await f.call(u.staffB,'GET','archives/notifications');
 assert.equal(notes.unread,1);assert.equal(notes.items[0].archive.agenda_number,a.agenda_number);
 assert.equal(one(db,'SELECT count(*) n FROM archive_notifications').n,1);
 assert.equal((await f.call(u.staffB,'POST','archives/notifications/read',{all:true})).unread,0);
 await status(f.grant(a.id,{purpose:'BIASA_SHARE',target_user_id:u.staffB.id}),409,/sudah dibagikan/);
 await status(f.grant(a.id,{purpose:'BIASA_SHARE',target_user_id:u.officerB.id,notify_user_ids:[u.staffB.id]}),422,/penerima akses/);
 await status(f.grant(a.id,{purpose:'BIASA_SHARE',target_user_id:u.officerB.id,expires_at:new Date(Date.now()+86400000).toISOString()}),422,/batas waktu/);
 // Berbagi ke bagian: seluruh anggota dapat membaca, tetapi tidak ada notifikasi otomatis.
 const b=await f.create(u.officerA,units.keu);
 await f.grant(b.id,{purpose:'BIASA_SHARE',target_unit_id:units.ops.id});
 assert.equal((await f.call(u.officerB,'GET',`archives/${b.id}`)).archive.id,b.id);
 assert.equal(one(db,'SELECT count(*) n FROM archive_notifications').n,1,'berbagi ke bagian tidak memberi tahu siapa pun secara otomatis');
 const c=await f.create(u.officerA,units.keu);
 await f.grant(c.id,{purpose:'BIASA_SHARE',target_unit_id:units.ops.id,notify_user_ids:[u.officerB.id]});
 assert.equal((await f.call(u.officerB,'GET','archives/notifications')).unread,1);assert.equal((await f.call(u.staffB,'GET','archives/notifications')).unread,0);
 // Petugas bagian lain tidak memperoleh hak edit lewat berbagi.
 assert.equal((await f.call(u.officerB,'GET',`archives/${b.id}`)).access.edit,false);
 // Dicabut: berlaku pada permintaan berikutnya; berbagi tidak kedaluwarsa sendiri.
 const panel=await f.call(u.humas,'GET',`archives/${a.id}/access`),grant=panel.grants.find(g=>g.purpose==='BIASA_SHARE'&&g.target.id===u.staffB.id);
 assert.equal(grant.expires_at,null);assert.equal(grant.status,'AKTIF');
 await f.call(u.humas,'POST',`archives/${a.id}/grants/${grant.id}/revoke`,{});
 await status(f.call(u.staffB,'GET',`archives/${a.id}`),404);
 assert.equal((await f.call(u.staffB,'GET','archives/notifications')).items[0].available,false);
 for(const user of [u.officerA,u.itAdmin])await status(f.call(user,'POST',`archives/${a.id}/grants/${grant.id}/revoke`,{}),403);
});
test('AC15/AC17/AC39/AC43: Rahasia disamarkan di server; Humas membaca tanpa izin; pimpinan dan IT Admin tidak otomatis',async t=>{
 const f=await ready(t),{u,units,db}=f,a=await f.create(u.officerA,units.keu,{subject:'Rencana mutasi fiktif',official_number:'RHS/77'});
 // Pimpinan dengan cakupan Sekretariat melihat arsip Biasa di bawahnya, bukan Operasional.
 assert.deepEqual((await f.call(u.boss,'GET',`archives/${a.id}`)).access.sources,['PENGAWASAN']);
 const other=await f.create(u.officerB,units.ops);
 await status(f.call(u.boss,'GET',`archives/${other.id}`),404);
 for(const user of [u.officerA,u.staffA,u.itAdmin,u.boss])await status(f.call(user,'POST',`archives/${a.id}/classification`,{target:'RAHASIA',reason:'x',expected_row_version:1}),403,/Humas/);
 await status(f.call(u.humas,'POST',`archives/${a.id}/classification`,{target:'BIASA',reason:'x',expected_row_version:1}),422,/berbeda/);
 await status(f.call(u.humas,'POST',`archives/${a.id}/classification`,{target:'RAHASIA',reason:'',expected_row_version:1}),422,/Alasan/);
 await f.grant(a.id,{purpose:'BIASA_SHARE',target_user_id:u.staffB.id});
 await f.classify(a.id);
 const row=one(db,'SELECT * FROM archive_records WHERE id=?',a.id);assert.equal(row.classification,'RAHASIA');assert.equal(Number(row.security_epoch),2);
 // Anggota bagian, petugas, pimpinan, dan penerima berbagi: hanya tiga field + kunci teknis.
 for(const user of [u.staffA,u.officerA,u.boss,u.staffB]){
  const item=(await listed(f,user)).find(i=>i.id===a.id);
  assert.deepEqual(item,{id:a.id,restricted:true,agenda_number:a.agenda_number,archived_at:row.archived_at,classification:'RAHASIA'});
  const detail=await f.call(user,'GET',`archives/${a.id}`);
  assert.deepEqual(Object.keys(detail).sort(),['access','archive','notice']);assert.deepEqual(detail.archive,item);
  assert(!JSON.stringify([item,detail]).includes('mutasi')&&!JSON.stringify([item,detail]).includes('RHS'));
  const main=one(db,"SELECT id,current_version_id FROM archive_documents WHERE archive_id=? AND role='MAIN'",a.id);
  await status(f.call(user,'GET',`archives/${a.id}/documents/${main.id}/versions/${main.current_version_id}/preview`),403,/Rahasia/);
  await status(f.call(user,'GET',`archives/${a.id}/history`),403);
  await status(f.call(user,'PATCH',`archives/${a.id}`,{expected_row_version:2,direction:'MASUK',document_type_id:'arsip-jenis-surat',letter_date:'2026-11-10',subject:'x'}),403);
 }
 // Administrator tanpa role Humas tetap di luar hak daftar.
 await status(f.call(u.itAdmin,'GET',`archives/${a.id}`),404);
 // Semua Humas membaca penuh tanpa izin, lintas bagian.
 for(const user of [u.humas,u.humasOfficer]){const detail=await f.call(user,'GET',`archives/${a.id}`);assert.equal(detail.archive.subject,'Rencana mutasi fiktif');assert.deepEqual(detail.access.sources,['HUMAS']);assert.equal(detail.access.edit,false);}
 // Role Humas dicabut saat sesi masih hidup: permintaan berikutnya ditolak.
 run(db,'DELETE FROM user_roles WHERE id=?',u.humasOfficer.role.id);
 await status(f.call(u.humasOfficer,'GET',`archives/${a.id}`),404);
 await status(f.call(u.humasOfficer,'POST',`archives/${a.id}/classification`,{target:'BIASA',reason:'x',expected_row_version:2}),403);
 // Kembali Biasa: anggota bagian dan penerima berbagi Biasa dapat membaca lagi.
 await f.classify(a.id,'BIASA');
 assert.equal((await f.call(u.staffA,'GET',`archives/${a.id}`)).archive.subject,'Rencana mutasi fiktif');
 assert.deepEqual((await f.call(u.staffB,'GET',`archives/${a.id}`)).access.sources,['BERBAGI']);
 const audits=all(db,"SELECT before_data,after_data FROM archive_audit_events WHERE archive_id=? AND action='CLASSIFICATION_CHANGED' ORDER BY occurred_at",a.id);
 assert.equal(audits.length,2);assert.equal(JSON.parse(audits[1].after_data).security_epoch,3);
});
test('AC18/AC19: pencarian dan saringan tidak mengungkap atribut Rahasia terbatas',async t=>{
 const f=await ready(t),{u,units}=f;
 // Dua arsip dengan metadata terlihat sama, atribut tersembunyi berbeda.
 const secretA=await f.create(u.officerA,units.keu,{subject:'Rotasi pejabat fiktif',official_number:'RHS/01',direction:'KELUAR',document_type_id:'arsip-jenis-sk',letter_date:'2026-10-01'});
 const secretB=await f.create(u.officerA,units.keu,{subject:'Undangan syukuran',official_number:'UND/09',direction:'MASUK',document_type_id:'arsip-jenis-und',letter_date:'2026-11-01'});
 const open=await f.create(u.officerA,units.keu,{subject:'Rotasi jadwal piket',official_number:'UM/02',direction:'KELUAR',document_type_id:'arsip-jenis-sk',letter_date:'2026-10-01'});
 await f.classify(secretA.id);await f.classify(secretB.id);
 const ids=async(user,query)=>(await listed(f,user,query)).map(i=>i.id).sort();
 const total=async(user,query)=>(await f.call(user,'GET','archives',{},query)).total;
 // Pegawai bagian: perihal, nomor surat, jenis, arah, dan tanggal surat tidak mencocokkan baris terbatas.
 for(const query of ['q=rotasi','type=arsip-jenis-sk','direction=KELUAR','letter_from=2026-10-01&letter_to=2026-10-01']){
  assert.deepEqual(await ids(u.staffA,query),[open.id],query);assert.equal(await total(u.staffA,query),1,query);
  assert.equal((await f.call(u.staffA,'GET','archives',{},query)).readable_only,true);
 }
 for(const query of ['q=RHS','q=rhs/01','q=undangan','q=UND/09','type=arsip-jenis-und','direction=MASUK','letter_from=2026-11-01']){assert.deepEqual(await ids(u.staffA,query),[],query);assert.equal(await total(u.staffA,query),0,query);}
 // Jawaban tidak berubah walau atribut tersembunyi berbeda: A dan B sama-sama tidak pernah cocok.
 // Nomor agenda, klasifikasi, bagian, dan tanggal pengarsipan tetap boleh dipakai.
 assert.deepEqual(await ids(u.staffA,`q=${encodeURIComponent(secretA.agenda_number)}`),[secretA.id]);
 assert.deepEqual(await ids(u.staffA,'classification=RAHASIA'),[secretA.id,secretB.id].sort());
 assert.deepEqual(await ids(u.staffA,`unit=${units.keu.id}`),[secretA.id,secretB.id,open.id].sort());
 const todayWita=archiveWitaDate(Date.now());
 assert.equal((await ids(u.staffA,`from=${todayWita}&to=${todayWita}`)).length,3);assert.equal((await ids(u.staffA,`to=${archiveShiftDay(todayWita,-1)}`)).length,0);
 assert.equal((await f.call(u.staffA,'GET','archives',{},'classification=RAHASIA')).readable_only,false);
 // Urutan tetap berdasarkan waktu pengarsipan, bukan atribut tersembunyi.
 assert.deepEqual((await listed(f,u.staffA)).map(i=>i.id),[open.id,secretB.id,secretA.id]);
 // Humas mencari di semua arsip.
 assert.deepEqual(await ids(u.humas,'q=rotasi'),[secretA.id,open.id].sort());assert.deepEqual(await ids(u.humas,'direction=MASUK'),[secretB.id]);
 // Halaman: penanda stabil, tidak ada baris ganda atau hilang.
 const first=await f.call(u.staffA,'GET','archives',{},'limit=2'),second=await f.call(u.staffA,'GET','archives',{},`limit=2&cursor=${first.next_cursor}`);
 assert.equal(first.total,3);assert.equal(first.items.length,2);assert.equal(second.items.length,1);assert.equal(second.next_cursor,null);
 assert.equal(new Set([...first.items,...second.items].map(i=>i.id)).size,3);
 await status(f.call(u.staffA,'GET','archives',{},'cursor=bukan-penanda'),422);
});
test('AC21/AC44: izin Rahasia permanen atau sementara, terikat epoch; berbagi Biasa tidak menjadi izin Rahasia',async t=>{
 const f=await ready(t),{u,units,db}=f,a=await f.create(u.officerA,units.keu);
 await status(f.grant(a.id,{purpose:'RAHASIA_READ',target_user_id:u.staffB.id,reason:'Tugas'}),422,/hanya untuk arsip Rahasia/);
 await f.grant(a.id,{purpose:'BIASA_SHARE',target_user_id:u.staffB.id});
 await f.classify(a.id);
 await status(f.grant(a.id,{purpose:'BIASA_SHARE',target_user_id:u.officerB.id}),422,/arsip Biasa/);
 await status(f.grant(a.id,{purpose:'RAHASIA_READ',target_unit_id:units.ops.id,reason:'Tugas'}),422,/pengguna bernama/);
 await status(f.grant(a.id,{purpose:'RAHASIA_READ',target_user_id:u.staffA.id}),422,/Alasan/);
 await status(f.grant(a.id,{purpose:'RAHASIA_READ',target_user_id:u.staffA.id,reason:'Tugas',expires_at:new Date(Date.now()-1000).toISOString()}),422,/setelah waktu sekarang/);
 // Berbagi Biasa lama tidak membuka isi Rahasia; hanya tiga field.
 assert.equal((await f.call(u.staffB,'GET',`archives/${a.id}`)).archive.restricted,true);
 // Permanen: berlaku sampai dicabut, dan arsip jadi dapat ditemukan penerimanya.
 await f.grant(a.id,{purpose:'RAHASIA_READ',target_user_id:u.officerB.id,reason:'Penugasan audit fiktif'});
 assert.deepEqual((await f.call(u.officerB,'GET',`archives/${a.id}`)).access.sources,['IZIN_RAHASIA']);
 assert.equal((await listed(f,u.officerB)).find(i=>i.id===a.id).restricted,false);
 // Sementara: gagal tepat pada expires_at.
 const until=new Date(Date.now()+3600000).toISOString();
 await f.grant(a.id,{purpose:'RAHASIA_READ',target_user_id:u.staffA.id,reason:'Rapat fiktif',expires_at:until});
 assert.equal((await f.call(u.staffA,'GET',`archives/${a.id}`)).archive.restricted,false);
 const temp=one(db,"SELECT id FROM archive_access_grants WHERE target_user_id=? AND purpose='RAHASIA_READ' AND revoked_at IS NULL",u.staffA.id);
 run(db,'UPDATE archive_access_grants SET valid_from=?,expires_at=? WHERE id=?',new Date(Date.now()-7200000).toISOString(),new Date(Date.now()-1).toISOString(),temp.id);
 assert.equal((await f.call(u.staffA,'GET',`archives/${a.id}`)).archive.restricted,true);
 assert.equal((await f.call(u.humas,'GET',`archives/${a.id}/access`)).grants.find(g=>g.id===temp.id).status,'KEDALUWARSA');
 // Perpanjangan: izin lama ditutup, izin baru dibuat.
 await f.grant(a.id,{purpose:'RAHASIA_READ',target_user_id:u.staffA.id,reason:'Diperpanjang'});
 assert.equal(one(db,"SELECT count(*) n FROM archive_access_grants WHERE target_user_id=? AND purpose='RAHASIA_READ' AND revoked_at IS NULL",u.staffA.id).n,1);
 assert.equal((await f.call(u.staffA,'GET',`archives/${a.id}`)).archive.restricted,false);
 // Izin unduh tidak mengatasi hak baca yang hilang.
 await f.grant(a.id,{purpose:'DOWNLOAD',target_user_id:u.staffA.id,reason:'Perlu salinan'});
 const main=one(db,"SELECT id,current_version_id FROM archive_documents WHERE archive_id=? AND role='MAIN'",a.id),path=`archives/${a.id}/documents/${main.id}/versions/${main.current_version_id}/download`;
 assert.equal((await f.call(u.staffA,'GET',path)).filename,'surat.pdf');
 const read=one(db,"SELECT id FROM archive_access_grants WHERE target_user_id=? AND purpose='RAHASIA_READ' AND revoked_at IS NULL",u.staffA.id);
 await f.call(u.humas,'POST',`archives/${a.id}/grants/${read.id}/revoke`,{reason:'Selesai'});
 await status(f.call(u.staffA,'GET',path),403,/Rahasia/);
 assert.equal((await f.call(u.humas,'GET',`archives/${a.id}/access`)).grants.find(g=>g.purpose==='DOWNLOAD'&&g.open).effective,false);
 // Klasifikasi bolak-balik: izin Rahasia/unduh epoch lama berakhir dan tidak hidup kembali.
 await f.classify(a.id,'BIASA');await f.classify(a.id,'RAHASIA');
 assert.equal(one(db,"SELECT count(*) n FROM archive_access_grants WHERE archive_id=? AND purpose<>'BIASA_SHARE' AND revoked_at IS NULL",a.id).n,0);
 assert.equal((await f.call(u.officerB,'GET',`archives/${a.id}`).catch(e=>e.status)),404,'penerima izin lama di luar bagian tidak lagi melihat arsip');
 assert.equal(one(db,"SELECT count(*) n FROM archive_access_grants WHERE archive_id=? AND purpose='BIASA_SHARE' AND revoked_at IS NULL",a.id).n,1,'berbagi Biasa tetap tercatat');
 assert.equal((await f.call(u.staffB,'GET',`archives/${a.id}`)).archive.restricted,true);
 // Izin baru untuk penerima yang sama dapat diterbitkan lagi di epoch baru.
 await f.grant(a.id,{purpose:'RAHASIA_READ',target_user_id:u.officerB.id,reason:'Terbit ulang'});
 assert.equal((await f.call(u.officerB,'GET',`archives/${a.id}`)).archive.restricted,false);
 assert.equal(JSON.parse(one(db,"SELECT safe_context FROM archive_audit_events WHERE action='RAHASIA_GRANTED' ORDER BY occurred_at DESC LIMIT 1").safe_context).self_grant,false);
});
test('AC23/AC24/AC25: pratinjau perlu hak baca, unduh asli perlu izin unduh — termasuk Humas dan versi lama',async t=>{
 const f=await ready(t),{u,units,db}=f,a=await f.create(u.officerA,units.keu,{attachment_file_ids:[f.file(u.officerA,'lampiran.png',png('lamp')).id]});
 const docs=(await f.call(u.officerA,'GET',`archives/${a.id}`)).documents,main=docs[0],attachment=docs[1];
 await f.call(u.officerA,'POST',`archives/${a.id}/documents/${main.id}/versions`,{idempotency_key:randomUUID(),file_id:f.file(u.officerA,'baru.pdf').id,change_reason:'Perbaikan',expected_row_version:1});
 await f.classify(a.id);
 const versions=(await f.call(u.humas,'GET',`archives/${a.id}`)).documents[0].versions,path=(doc,version,kind)=>`archives/${a.id}/documents/${doc}/versions/${version}/${kind}`;
 // Humas: pratinjau semua Rahasia, tetapi unduh ditolak tanpa izin — utama, lampiran, dan versi lama.
 for(const [doc,version] of [[main.id,versions[0].id],[main.id,versions[1].id],[attachment.id,attachment.versions[0].id]]){
  assert((await f.call(u.humas,'GET',path(doc,version,'preview'))).data.length>0);
  await status(f.call(u.humas,'GET',path(doc,version,'download')),403,/izin Humas/);
 }
 // Pemberian izin kepada diri sendiri diperbolehkan dan diaudit.
 await f.grant(a.id,{purpose:'DOWNLOAD',target_user_id:u.humas.id,reason:'Arsip fisik fiktif'});
 assert.equal(JSON.parse(one(db,"SELECT safe_context FROM archive_audit_events WHERE action='DOWNLOAD_GRANTED'").safe_context).self_grant,true);
 const got=await f.call(u.humas,'GET',path(main.id,versions[1].id,'download'));
 assert.equal(got.filename,'surat.pdf');assert.equal(Buffer.from(got.data,'base64').length,got.size);
 assert.equal((await f.call(u.humas,'GET',`archives/${a.id}`)).access.download,true);
 // Versi atau dokumen milik arsip lain ditolak walau ID-nya benar.
 const other=await f.create(u.officerB,units.ops),otherMain=one(db,"SELECT id,current_version_id FROM archive_documents WHERE archive_id=? AND role='MAIN'",other.id);
 await status(f.call(u.humas,'GET',path(otherMain.id,otherMain.current_version_id,'download')),404);
 await status(f.call(u.humas,'GET',path(main.id,otherMain.current_version_id,'preview')),404);
 await status(f.call(u.staffB,'GET',path(main.id,versions[0].id,'preview')),404);
 // Berkas arsip tidak dapat diambil lewat rute berkas umum, juga oleh pengunggahnya.
 const fileId=one(db,'SELECT file_id FROM archive_document_versions WHERE id=?',versions[0].id).file_id;
 const {download}=await import('../lib/files.mjs');
 assert.throws(()=>download(db,u.officerA,fileId,'/tmp'),/Akses berkas ditolak/);assert.throws(()=>download(db,u.humas,fileId,'/tmp'),/Akses berkas ditolak/);
 // Gangguan penyimpanan: pesan aman, bukan kebocoran kunci penyimpanan.
 f.store.clear();
 await status(f.call(u.humas,'GET',path(main.id,versions[0].id,'preview')),503,/Layanan berkas/);
 const events=all(db,"SELECT action FROM archive_audit_events WHERE archive_id=? AND action IN('PREVIEW_OPENED','DOWNLOAD_STARTED')",a.id).map(r=>r.action);
 assert.equal(events.filter(x=>x==='DOWNLOAD_STARTED').length,1);assert.equal(events.filter(x=>x==='PREVIEW_OPENED').length,3);
});

/* ---------- Duplikasi ---------- */
test('AC30/AC31: dugaan duplikat memberi peringatan, boleh lanjut dengan alasan, tidak membocorkan arsip tersembunyi',async t=>{
 const f=await ready(t),{u,units,db}=f,bytes=pdf('surat yang sama');
 const first=await f.create(u.officerA,units.keu,{subject:'Undangan rapat kerja',official_number:'005/FX/XI/2026',letter_date:'2026-11-05',main_file_id:f.file(u.officerA,'a.pdf',bytes).id});
 // Berkas sama, nomor+tanggal sama, atau perihal+tanggal sama.
 const same=()=>f.payload(u.officerA,units.keu,{subject:'UNDANGAN  rapat kerja!',official_number:'005 / fx / XI / 2026',letter_date:'2026-11-05',main_file_id:f.file(u.officerA,'b.pdf',bytes).id});
 const body=same(),warning=await f.call(u.officerA,'POST','archives',body);
 assert.equal(warning.duplicate_warning,true);assert.equal(warning.candidates.length,1);assert.equal(warning.candidates[0].id,first.id);
 assert.deepEqual(warning.candidates[0].reasons,['BERKAS_SAMA','NOMOR_DAN_TANGGAL','PERIHAL_DAN_TANGGAL']);
 assert.equal(one(db,'SELECT count(*) n FROM archive_records').n,1,'peringatan tidak menulis apa pun');
 await status(f.call(u.officerA,'POST','archives',{...body,duplicate_reason:'  '}).then(r=>{if(r.duplicate_warning)throw Object.assign(new Error('masih peringatan'),{status:422});}),422);
 const saved=await f.call(u.officerA,'POST','archives',{...body,duplicate_reason:'Tembusan untuk bagian keuangan'});
 assert(saved.archive.id);
 const override=one(db,'SELECT * FROM archive_duplicate_overrides WHERE archive_id=?',saved.archive.id);
 assert.equal(override.reason,'Tembusan untuk bagian keuangan');assert.deepEqual(JSON.parse(override.visible_match_ids),[first.id]);assert.equal(override.rule_version,'RT04-v1');
 assert(one(db,"SELECT 1 FROM archive_audit_events WHERE archive_id=? AND action='DUPLICATE_OVERRIDE'",saved.archive.id));
 // Kecocokan dengan arsip yang tidak boleh dibaca pemohon: jawaban sama persis seperti tanpa kecocokan.
 const hidden=await f.create(u.officerB,units.ops,{subject:'Nota khusus fiktif',official_number:'900/OPS',letter_date:'2026-11-06'});
 const clean=await f.call(u.officerA,'POST','archives',f.payload(u.officerA,units.keu,{letter_date:'2026-11-06'}));
 const silent=await f.call(u.officerA,'POST','archives',f.payload(u.officerA,units.keu,{subject:'Nota khusus fiktif',official_number:'900/OPS',letter_date:'2026-11-06'}));
 assert.deepEqual(Object.keys(silent),Object.keys(clean));assert.equal(silent.duplicate_warning,undefined);
 const internal=one(db,'SELECT * FROM archive_duplicate_overrides WHERE archive_id=?',silent.archive.id);
 assert.deepEqual(JSON.parse(internal.internal_match_ids),[hidden.id]);assert.equal(internal.reason,null);assert.deepEqual(JSON.parse(internal.visible_match_ids),[]);
 assert(!one(db,"SELECT 1 FROM archive_audit_events WHERE archive_id=? AND action='DUPLICATE_OVERRIDE'",silent.archive.id),'riwayat yang dibaca petugas tidak memuat kecocokan tersembunyi');
 // Arsip Rahasia yang hanya terdaftar (tidak terbaca) juga tidak muncul sebagai kandidat.
 await f.classify(first.id);await f.classify(saved.archive.id);
 const third=await f.call(u.officerA,'POST','archives',same());
 assert.equal(third.duplicate_warning,undefined);assert.equal(JSON.parse(one(db,'SELECT internal_match_ids FROM archive_duplicate_overrides WHERE archive_id=?',third.archive.id).internal_match_ids).length,2);
 // Tidak ada kunci unik pada nomor surat, perihal, tanggal, atau checksum.
 assert.equal(one(db,"SELECT count(*) n FROM archive_records WHERE official_number_normalized='005/fx/xi/2026'").n,3);
});

/* ---------- Hapus, pulihkan, jenis dokumen ---------- */
test('AC11/AC12/AC37: petugas mengajukan hapus, Humas memutuskan; hapus logis dan pemulihan menjaga identitas',async t=>{
 const f=await ready(t),{u,units,db}=f,a=await f.create(u.officerA,units.keu);
 await f.grant(a.id,{purpose:'BIASA_SHARE',target_user_id:u.staffB.id});await f.grant(a.id,{purpose:'DOWNLOAD',target_user_id:u.staffB.id,reason:'Perlu salinan'});
 // Petugas tidak dapat menghapus langsung; pegawai biasa tidak dapat mengajukan.
 await status(f.call(u.officerA,'POST',`archives/${a.id}/delete`,{reason:'x',reference:'y'}),403,/Humas/);
 await status(f.call(u.staffA,'POST',`archives/${a.id}/delete-requests`,{reason:'x'}),403);
 await status(f.call(u.officerA,'POST',`archives/${a.id}/delete-requests`,{reason:''}),422);
 const requested=await f.call(u.officerA,'POST',`archives/${a.id}/delete-requests`,{reason:'Salah unggah fiktif'});
 assert.equal(requested.delete_request.mine,true);
 await status(f.call(u.officerA,'POST',`archives/${a.id}/delete-requests`,{reason:'lagi'}),409,/menunggu keputusan/);
 // Selama diajukan arsip tetap aktif.
 assert.equal((await f.call(u.staffA,'GET',`archives/${a.id}`)).archive.id,a.id);
 const queue=await f.call(u.humas,'GET','archives/delete-requests');assert.equal(queue.items.length,1);
 assert.equal((await f.call(u.officerB,'GET','archives/delete-requests')).items.length,0);
 const request=queue.items[0];
 await status(f.call(u.officerA,'POST',`archives/delete-requests/${request.id}/decide`,{decision:'APPROVE',reason:'x'}),403);
 await status(f.call(u.humas,'POST',`archives/delete-requests/${request.id}/decide`,{decision:'APPROVE',reason:''}),422);
 // Ditolak: tercatat, arsip tetap; lalu diajukan lagi dan disetujui.
 await f.call(u.humas,'POST',`archives/delete-requests/${request.id}/decide`,{decision:'REJECT',reason:'Masih diperlukan'});
 await f.call(u.officerA,'POST',`archives/${a.id}/delete-requests`,{reason:'Benar-benar salah unggah'});
 const second=(await f.call(u.humas,'GET','archives/delete-requests')).items[0];
 await status(f.call(u.staffA,'POST',`archives/delete-requests/${second.id}/cancel`),404);
 const before=one(db,'SELECT * FROM archive_records WHERE id=?',a.id),versions=all(db,'SELECT v.id FROM archive_document_versions v JOIN archive_documents d ON d.id=v.document_id WHERE d.archive_id=?',a.id).map(r=>r.id);
 await f.call(u.humas,'POST',`archives/delete-requests/${second.id}/decide`,{decision:'APPROVE',reason:'Disetujui'});
 // Akses normal tertutup untuk semua orang, termasuk Humas lewat jalur biasa.
 for(const user of [u.officerA,u.staffA,u.staffB,u.humas]){await status(f.call(user,'GET',`archives/${a.id}`),404);assert.equal((await listed(f,user)).some(i=>i.id===a.id),false);assert.equal((await f.call(user,'GET','archives/dashboard')).total,0);}
 const main=one(db,"SELECT id,current_version_id FROM archive_documents WHERE archive_id=? AND role='MAIN'",a.id);
 await status(f.call(u.humas,'GET',`archives/${a.id}/documents/${main.id}/versions/${main.current_version_id}/preview`),404);
 assert.equal(f.store.size>0,true,'berkas tidak dihapus dari penyimpanan');
 // Hanya Humas melihat metadata pemulihan.
 await status(f.call(u.officerA,'GET','archives/deleted'),403);await status(f.call(u.itAdmin,'GET','archives/deleted'),403);
 const deleted=(await f.call(u.humas,'GET','archives/deleted')).items;assert.equal(deleted[0].delete_reason,'Disetujui');assert.equal(deleted[0].agenda_number,a.agenda_number);
 await status(f.call(u.officerA,'POST',`archives/deleted/${a.id}/restore`,{reason:'x'}),403);
 await status(f.call(u.humas,'POST',`archives/deleted/${a.id}/restore`,{reason:''}),422);
 await f.call(u.humas,'POST',`archives/deleted/${a.id}/restore`,{reason:'Ternyata benar'});
 const after=one(db,'SELECT * FROM archive_records WHERE id=?',a.id);
 for(const key of ['id','agenda_number','archived_at','owner_unit_id','classification','created_by'])assert.equal(after[key],before[key],key);
 assert.deepEqual(all(db,'SELECT v.id FROM archive_document_versions v JOIN archive_documents d ON d.id=v.document_id WHERE d.archive_id=?',a.id).map(r=>r.id),versions);
 // Berbagi Biasa yang belum dicabut berlaku lagi; izin unduh lama tidak hidup kembali.
 const restored=await f.call(u.staffB,'GET',`archives/${a.id}`);assert.deepEqual(restored.access.sources,['BERBAGI']);assert.equal(restored.access.download,false);
 assert.deepEqual(all(db,"SELECT action FROM archive_audit_events WHERE archive_id=? AND action LIKE '%DELETE%' OR action LIKE '%RESTOR%' ORDER BY occurred_at,action",a.id).map(r=>r.action),['DELETE_REQUESTED','DELETE_REJECTED','DELETE_REQUESTED','ARCHIVE_DELETED','ARCHIVE_RESTORED']);
 // Pembatalan oleh pemohon saat masih menunggu.
 await f.call(u.officerA,'POST',`archives/${a.id}/delete-requests`,{reason:'Ragu'});
 const mine=(await f.call(u.officerA,'GET','archives/delete-requests')).items[0];assert.equal(mine.subject,undefined);
 assert.equal((await f.call(u.officerA,'POST',`archives/delete-requests/${mine.id}/cancel`)).status,'CANCELLED');
 // Tidak ada penghapusan berdasarkan usia: arsip lama dan yang dihapus tetap tersimpan.
 assert.equal(one(db,'SELECT count(*) n FROM archive_records').n,1);
});
test('AC36: Humas mengelola jenis dokumen; jenis nonaktif tetap terbaca di arsip lama',async t=>{
 const f=await ready(t),{u,units,db}=f;
 await status(f.call(u.officerA,'POST','archives/types',{code:'MEMO',name:'Memo'}),403,/Humas/);await status(f.call(u.itAdmin,'POST','archives/types',{code:'MEMO',name:'Memo'}),403);
 const created=await f.call(u.humas,'POST','archives/types',{code:'memo',name:'Memo Internal'}),memo=created.types.find(t=>t.code==='MEMO');
 assert(memo.active);
 await status(f.call(u.humas,'POST','archives/types',{code:'MEMO2',name:'memo  internal'}),409,/sudah ada/);
 await status(f.call(u.humas,'POST','archives/types',{code:'ME MO',name:'Lain'}),422);
 const a=await f.create(u.officerA,units.keu,{document_type_id:memo.id});
 await status(f.call(u.humas,'PATCH',`archives/types/${memo.id}`,{code:'LAIN',expected_row_version:memo.row_version}),422,/Kode jenis tidak dapat diubah/);
 await status(f.call(u.humas,'PATCH',`archives/types/${memo.id}`,{name:'Memo',expected_row_version:99}),409);
 // Ganti nama master: snapshot arsip lama tidak berubah.
 await f.call(u.humas,'PATCH',`archives/types/${memo.id}`,{name:'Memorandum',expected_row_version:memo.row_version});
 let detail=await f.call(u.officerA,'GET',`archives/${a.id}`);assert.equal(detail.archive.document_type,'Memo Internal');assert.equal(detail.archive.document_type_current,'Memorandum');
 // Nonaktif: tidak bisa dipilih arsip baru, arsip lama tetap valid dan tetap bisa diedit tanpa mengganti jenis.
 await f.call(u.humas,'PATCH',`archives/types/${memo.id}`,{is_active:false,expected_row_version:memo.row_version+1});
 await status(f.call(u.officerA,'POST','archives',f.payload(u.officerA,units.keu,{document_type_id:memo.id})),422,/nonaktif/);
 detail=await f.call(u.officerA,'PATCH',`archives/${a.id}`,{expected_row_version:1,direction:'MASUK',document_type_id:memo.id,official_number:'',letter_date:'2026-11-10',subject:'Perihal diubah, jenis tetap'});
 assert.equal(detail.archive.document_type,'Memo Internal');assert.equal(detail.archive.document_type_active,false);
 // Koreksi jenis pada arsip: ID dan snapshot berubah bersama, nilai lama di audit.
 detail=await f.call(u.officerA,'PATCH',`archives/${a.id}`,{expected_row_version:2,direction:'MASUK',document_type_id:'arsip-jenis-nd',official_number:'',letter_date:'2026-11-10',subject:'Perihal diubah, jenis tetap'});
 assert.equal(detail.archive.document_type,'Nota Dinas');
 assert.equal(JSON.parse(one(db,"SELECT safe_context FROM archive_audit_events WHERE archive_id=? AND action='METADATA_EDITED' ORDER BY occurred_at DESC LIMIT 1",a.id).safe_context).document_type_before,'Memo Internal');
 assert.throws(()=>run(db,"DELETE FROM archive_document_types WHERE id='arsip-jenis-nd'"),/FOREIGN KEY/,'jenis yang dipakai arsip tidak dapat dihapus');
});

/* ---------- Dashboard, laporan, notifikasi harian, audit ---------- */
test('AC26/AC27/AC28: dashboard cocok dengan daftar; lima laporan mengikuti hak dan penyamaran',async t=>{
 const f=await ready(t),{u,units,db}=f;
 const inA=await f.create(u.officerA,units.keu,{direction:'MASUK',subject:'=HYPERLINK("http://x")',document_type_id:'arsip-jenis-und'});
 const outA=await f.create(u.officerA,units.keu,{direction:'KELUAR',document_type_id:'arsip-jenis-sk',subject:'Keputusan fiktif'});
 const internal=await f.create(u.officerA,units.keu,{direction:'INTERNAL',document_type_id:'arsip-jenis-nd'});
 const secret=await f.create(u.officerA,units.keu,{direction:'MASUK',subject:'Sangat rahasia fiktif',document_type_id:'arsip-jenis-sk'});
 const gone=await f.create(u.officerA,units.keu);await f.create(u.officerB,units.ops,{direction:'MASUK'});
 await f.classify(secret.id);await f.call(u.humas,'POST',`archives/${gone.id}/delete`,{reason:'Salah',reference:'WA'});
 const dash=await f.call(u.staffA,'GET','archives/dashboard'),list=await f.call(u.staffA,'GET','archives');
 assert.equal(dash.total,4);assert.equal(dash.total,list.total);assert.equal(dash.readable+dash.restricted,dash.total);assert.equal(dash.restricted,1);
 assert.deepEqual(dash.by_type.map(t=>[t.name,t.count]).sort(),[['Nota Dinas',1],['Surat Keputusan',1],['Undangan',1]]);
 assert.equal(dash.latest.find(i=>i.id===secret.id).restricted,true);
 assert.equal((await f.call(u.humas,'GET','archives/dashboard')).total,5);
 const todayWita=archiveWitaDate(Date.now()),report=(user,type,extra={})=>f.call(user,'POST','archives/reports',{type,format:'xlsx',from:todayWita,to:todayWita,...extra});
 await status(report(u.staffA,'lainnya'),422);await status(f.call(u.staffA,'POST','archives/reports',{type:'recap_period',format:'csv',from:todayWita,to:todayWita}),422);
 await status(report(u.staffA,'recap_period',{from:'2026-12-01',to:'2026-11-01'}),422);
 const period=await report(u.staffA,'recap_period');
 assert.equal(period.total,4);assert.equal(period.rows.length,list.total);
 const masked=period.rows.find(r=>r.restricted);
 assert.deepEqual(masked,{agenda_number:secret.agenda_number,archived_on:todayWita,classification:'Rahasia',restricted:true});
 assert(!JSON.stringify(period).includes('Sangat rahasia'));assert(period.notes.some(n=>/nomor agenda, tanggal pengarsipan, dan label/.test(n)));
 assert(period.groups.some(g=>g.label==='Rahasia dengan informasi terbatas'&&g.count===1));
 assert(period.filters[0].includes(todayWita));assert.match(period.requested_by,/staf\.keu/);
 // Buku agenda: arah menentukan isi; Internal hanya di rekap; Rahasia terbatas tidak ikut dan tidak dihitung.
 const agendaIn=await report(u.staffA,'agenda_in'),agendaOut=await report(u.staffA,'agenda_out');
 assert.deepEqual(agendaIn.rows.map(r=>r.agenda_number),[inA.agenda_number]);assert.deepEqual(agendaOut.rows.map(r=>r.agenda_number),[outA.agenda_number]);
 assert(agendaIn.notes[0].includes('arah surat yang boleh Anda ketahui'));assert(!JSON.stringify(agendaIn.notes).match(/\d/));
 assert(!agendaIn.rows.concat(agendaOut.rows).some(r=>r.agenda_number===internal.agenda_number));
 assert.deepEqual((await report(u.humas,'agenda_in')).rows.map(r=>r.unit).sort(),['Keuangan Fiktif','Keuangan Fiktif','Operasional Fiktif']);
 // Rekap jenis: Rahasia terbatas dipisahkan tanpa jenis; saringan jenis mengecualikan baris terbatas.
 const byType=await report(u.staffA,'recap_type');
 assert(byType.groups.some(g=>g.label==='Jenis: Surat Keputusan'&&g.count===1));assert(byType.groups.some(g=>/jenis tidak ditampilkan/.test(g.label)&&g.count===1));
 assert.equal((await report(u.staffA,'recap_type',{document_type_id:'arsip-jenis-sk'})).total,1);
 const byUnit=await report(u.humas,'recap_unit');
 assert.deepEqual(byUnit.groups.map(g=>[g.label,g.count]),[['Bagian: Keuangan Fiktif',4],['Bagian: Operasional Fiktif',1]]);
 assert.equal((await report(u.staffB,'recap_unit',{unit_id:units.keu.id})).total,0,'bagian di luar lingkup tidak menghasilkan baris');
 // Nilai yang berawalan tanda formula dikirim apa adanya; penetralan dilakukan saat berkas dibuat (lihat tes ekspor).
 assert.equal(agendaIn.rows[0].subject,'=HYPERLINK("http://x")');
 assert.equal(one(db,"SELECT count(*) n FROM archive_audit_events WHERE action='REPORT_EXPORTED'").n,8,'setiap ekspor yang berhasil diaudit');
});
test('AC35: satu ringkasan harian per Humas aktif, tanpa ganda, menghitung peristiwa pengarsipan',async t=>{
 const f=await ready(t),{u,units,db}=f,a=await f.create(u.officerA,units.keu);await f.create(u.officerA,units.keu);await f.create(u.officerB,units.ops);
 await f.call(u.humas,'POST',`archives/${a.id}/delete`,{reason:'Salah',reference:'WA'});
 const day=archiveWitaDate(Date.now()),next=archiveShiftDay(day,1),at07=Date.parse(`${next}T07:00:00+08:00`);
 assert.equal(one(db,'SELECT count(*) n FROM archive_notifications').n,0,'tidak ada notifikasi per unggahan');
 // Sebelum 07.00 WITA ringkasan hari itu belum dibuat.
 archiveEnsureDailySummaries(db,at07-60000);
 assert.equal(one(db,'SELECT count(*) n FROM archive_daily_summary_runs WHERE summary_date=?',day).n,0);
 assert.equal(archiveEnsureDailySummaries(db,at07)>=1,true);assert.equal(archiveEnsureDailySummaries(db,at07),0);archiveEnsureDailySummaries(db,at07+3600000);
 const runRow=one(db,'SELECT * FROM archive_daily_summary_runs WHERE summary_date=?',day);
 assert.equal(runRow.status,'COMPLETED');assert.equal(Number(runRow.total),3,'arsip yang kemudian dihapus tetap dihitung');
 assert.equal(runRow.period_start,archiveDayStart(day));assert.equal(runRow.period_end,archiveDayEnd(day));
 assert.deepEqual(JSON.parse(runRow.counts_by_unit).map(c=>[c.unit,c.count]),[['Keuangan Fiktif',2],['Operasional Fiktif',1]]);
 // Tepat satu per Humas aktif; pegawai lain tidak menerima.
 const recipients=all(db,"SELECT recipient_user_id FROM archive_notifications WHERE notification_type='HUMAS_DAILY_SUMMARY' AND summary_date=?",day).map(r=>r.recipient_user_id).sort();
 assert.deepEqual(recipients,[u.humas.id,u.humasOfficer.id].sort());
 const notes=await f.call(u.humas,'GET','archives/notifications'),summary=notes.items.find(i=>i.summary_date===day);
 assert.equal(summary.total,3);assert.deepEqual(summary.units,[{unit:'Keuangan Fiktif',count:2},{unit:'Operasional Fiktif',count:1}]);
 assert(!JSON.stringify(summary).includes('Perihal'));
 // Hari tanpa arsip tetap mendapat ringkasan nol.
 archiveEnsureDailySummaries(db,at07+86400000);
 assert.equal(Number(one(db,'SELECT total FROM archive_daily_summary_runs WHERE summary_date=?',next).total),0);
 assert.equal(one(db,"SELECT count(*) n FROM archive_notifications WHERE recipient_user_id=? AND summary_date=?",u.humas.id,next).n,1);
 assert.equal((await f.call(u.staffA,'GET','archives/notifications')).items.length,0);
});
test('AC22/AC40/AC45: tidak ada alur permintaan akses digital; audit hanya bertambah; siap dirujuk Tahap 2',async t=>{
 const f=await ready(t),{u,units,db}=f,a=await f.create(u.officerA,units.keu,{actor_user_id:u.humas.id});
 // Tidak ada rute permintaan akses, permintaan berbagi, atau persetujuan unggahan.
 for(const path of ['archives/access-requests','archives/share-requests','archives/approvals',`archives/${a.id}/access-requests`,`archives/${a.id}/approve`])assert.equal(await f.call(u.staffB,'POST',path,{}).catch(e=>e.status),undefined,path);
 const event=one(db,"SELECT * FROM archive_audit_events WHERE archive_id=? AND action='ARCHIVE_CREATED'",a.id);
 assert.equal(event.actor_user_id,u.officerA.id,'pelaku dari sesi, bukan dari isi permintaan');assert.equal(JSON.parse(event.actor_snapshot).username,'petugas.keu');
 assert.throws(()=>run(db,"UPDATE archive_audit_events SET actor_user_id=? WHERE id=?",u.humas.id,event.id),/tidak boleh diubah/);
 assert.throws(()=>run(db,'DELETE FROM archive_audit_events WHERE id=?',event.id),/tidak boleh dihapus/);
 // Audit umum portal tidak memuat perihal arsip.
 assert.equal(all(db,"SELECT change_summary FROM audit_events").some(r=>String(r.change_summary).includes('Perihal fiktif')),false);
 // Tahap 2: arsip punya ID tetap dan kolom rujukan sumber yang unik bila terisi.
 const row=one(db,'SELECT source_kind,source_system,source_reference FROM archive_records WHERE id=?',a.id);
 assert.deepEqual({...row},{source_kind:'MANUAL',source_system:null,source_reference:null});
 assert.throws(()=>run(db,"UPDATE archive_records SET source_system='persuratan' WHERE id=?",a.id),/CHECK/);
 assert.equal(one(db,"SELECT count(*) n FROM sqlite_master WHERE type='table' AND (name LIKE '%approval%' OR name LIKE '%disposition%') AND name LIKE 'archive%'").n,0);
 // Ikhtisar: batas berkas dan kewenangan dari server.
 const overview=await f.call(u.officerA,'GET','archives/overview');
 assert.equal(overview.limits.max_file_bytes,10_000_000);assert.deepEqual(overview.officer_units.map(x=>x.agenda_code),['KEU']);assert.equal(overview.humas,false);assert.equal(overview.admin,false);
 assert.equal((await f.call(u.admin,'GET','archives/overview')).admin,true);assert.equal((await f.call(u.admin,'GET','archives/overview')).humas,true,'Super Admin mengelola seluruh arsip sesuai revisi 13 November');
 assert.equal((await f.call(u.humas,'GET','archives/overview')).humas,true);
 await status(f.call(u.staffA,'GET','archives/lookups',{},'kind=users&q=pe'),403);
 assert((await f.call(u.humas,'GET','archives/lookups',{},'kind=users&q=staf')).users.length>=2);
 assert.deepEqual((await f.call(u.humas,'GET','archives/lookups',{},`kind=unit-members&unit=${units.ops.id}`)).users.map(x=>x.name).sort(),['Pegawai petugas.ops','Pegawai staf.ops']);
});

/* ---------- Lewat server HTTP lokal ---------- */
test('E-Arsip lewat server: petugas mengunggah, menyimpan, dan berkas tidak bocor lewat rute umum',async t=>{
 const dir=mkdtempSync(resolve(tmpdir(),'besakih-arsip-'));
 t.after(()=>{assert(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});});
 const db=openDb(':memory:'),origin='https://portal.test',app=createApp({db,dataDir:dir,origin});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>app.server.close(()=>{db.close();done();})));
 const base=`http://127.0.0.1:${app.server.address().port}`;
 const unit=insert(db,'org_units',{code:'HMS',name:'Humas Fiktif',is_active:1}),position=insert(db,'positions',{code:'P1',name:'Staf',org_unit_id:unit.id,is_active:1});
 const account=(username,role)=>{
  const employee=insert(db,'employees',{employee_no:`FX-${username}`,full_name:`Pegawai ${username}`,employment_status:'Tetap',joined_on:'2020-01-01',is_active:1});
  insert(db,'employee_placements',{employee_id:employee.id,position_id:position.id,valid_from:'2020-01-01',is_primary:1});
  const user=insert(db,'users',{username,password_hash:password,status:'ACTIVE',employee_id:employee.id,must_change_password:0,failed_login_count:0,password_changed_at:now()});
  if(role)insert(db,'user_roles',{user_id:user.id,role_id:one(db,'SELECT id FROM roles WHERE code=?',role).id,scope_kind:'ALL'});
  return user;
 };
 const officer=account('petugas'),staff=account('staf'),admin=account('admin','SUPER_ADMIN');
 async function session(username){
  const response=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({username,password:'fixture123'})});
  assert.equal(response.status,200);const data=await response.json(),cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  return async(path,{method='GET',body,headers={}}={})=>{
   const r=await fetch(`${base}/api/${path}`,{method,headers:{Cookie:cookie,'X-CSRF-Token':data.csrfToken,Origin:origin,...(body&&!(body instanceof Uint8Array)?{'Content-Type':'application/json'}:{}),...headers},body:body instanceof Uint8Array?body:body?JSON.stringify(body):undefined});
   return {status:r.status,data:await r.json()};
  };
 }
 const asAdmin=await session('admin'),asOfficer=await session('petugas'),asStaff=await session('staf');
 const bytes=pdf('surat lewat server');
 const upload=api=>api('uploads',{method:'POST',body:new Uint8Array(bytes),headers:{'Content-Type':'application/octet-stream','X-Upload-Name':encodeURIComponent('surat masuk.pdf'),'X-Upload-Type':'application/pdf'}});
 // Sebelum ditunjuk, pegawai tanpa izin unggah modul lain ditolak.
 assert.equal((await upload(asOfficer)).status,403);
 assert.equal((await asAdmin('archives/officers',{method:'POST',body:{user_id:officer.id,org_unit_id:unit.id,reason:'SK fiktif',agenda_code:'HMS'}})).status,201);
 assert.equal((await upload(asStaff)).status,403);
 const uploaded=await upload(asOfficer);assert.equal(uploaded.status,201);
 const created=await asOfficer('archives',{method:'POST',body:{idempotency_key:randomUUID(),owner_unit_id:unit.id,direction:'MASUK',document_type_id:'arsip-jenis-surat',letter_date:'2026-11-11',subject:'Surat lewat server',main_file_id:uploaded.data.id,attachment_file_ids:[]}});
 assert.equal(created.status,201);assert.match(created.data.archive.agenda_number,/^HMS\/\d{4}\/0001$/);
 const detail=await asStaff(`archives/${created.data.archive.id}`);assert.equal(detail.status,200);
 const main=detail.data.documents[0],path=`archives/${created.data.archive.id}/documents/${main.id}/versions/${main.current_version_id}`;
 const preview=await asStaff(`${path}/preview`);assert.equal(preview.status,200);assert.deepEqual(Buffer.from(preview.data.data,'base64'),bytes);
 assert.equal((await asStaff(`${path}/download`)).status,403);
 // Rute berkas umum menolak berkas arsip, juga bagi pengunggahnya.
 assert.equal((await asOfficer(`files/${uploaded.data.id}`)).status,403);
 // Super Admin mengelola arsip tanpa penunjukan tambahan; keanggotaan bagiannya tetap tercatat.
 const adminView=await asAdmin(`archives/${created.data.archive.id}`);assert.deepEqual(adminView.data.access.sources,['SUPER_ADMIN','BAGIAN']);assert.equal(adminView.data.access.humas,true);
 assert.equal((await asStaff('archives/overview')).data.officer_units.length,0);
 assert.equal((await asOfficer('archives/tidak-ada/aksi/aneh')).status,404);
});
