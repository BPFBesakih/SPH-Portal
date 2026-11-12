// Verifikasi modul E-Arsip di PostgreSQL sementara (PGlite).
//
//   node scripts/verify-archives-postgres.mjs <pglite/dist/index.js>
//
// Memeriksa: migrasi (RLS aktif, tanpa grant ke klien, role dan izin, Super Admin hanya
// menunjuk petugas, pemicu identitas/append-only, tepat satu dokumen utama saat commit),
// lalu snapshot portal-api yang sudah ditambal (scripts/build-archive-deploy.mjs): unggah
// petugas ke Drive tiruan, finalisasi arsip dan nomor agenda, folder Drive `arsip`,
// penyamaran Rahasia di server, pratinjau vs unduh, hapus logis dan pemulihan, ringkasan
// harian, serta status galat. Google tidak pernah dihubungi; semua data fiktif.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {insert,one,all,run,now} from '../supabase/functions/_shared/portal/db.mjs';
import {driveFixture} from '../tests/helpers/drive-fixture.mjs';

const {PGlite}=await import(pathToFileURL(resolve(process.argv[2]||'/tmp/pglite/node_modules/@electric-sql/pglite/dist/index.js')).href);
const pg=new PGlite(),realFetch=globalThis.fetch,priorDeno=globalThis.Deno;let checks=0;
const check=async(name,work)=>{await work();console.log('PASS '+name);checks++;};
const cronShim=`CREATE SCHEMA IF NOT EXISTS cron;CREATE TABLE IF NOT EXISTS cron.job(jobid bigserial PRIMARY KEY,jobname text UNIQUE,schedule text NOT NULL,command text NOT NULL);
CREATE OR REPLACE FUNCTION cron.schedule(job_name text,schedule text,command text) RETURNS bigint LANGUAGE sql AS $shim$ INSERT INTO cron.job(jobname,schedule,command) VALUES(job_name,schedule,command) ON CONFLICT(jobname) DO UPDATE SET schedule=EXCLUDED.schedule,command=EXCLUDED.command RETURNING jobid $shim$;`;
const pgliteSql=sql=>sql.replace(/^\s*CREATE EXTENSION IF NOT EXISTS pg_cron\b[^;]*;\s*$/im,cronShim).replace(/^\s*COMMENT ON EXTENSION pg_cron\b[^;]*;\s*$/im,'');
const tables=['archive_document_types','archive_units','archive_officers','archive_agenda_counters','archive_records','archive_documents','archive_document_versions','archive_access_grants',
 'archive_delete_requests','archive_upload_operations','archive_duplicate_overrides','archive_audit_events','archive_notifications','archive_daily_summary_runs'];
const pdf=text=>Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.from(text)]);
try{
  await pg.exec(`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,encrypted_password text);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id));CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO authenticated;`);
  const directory=new URL('../supabase/migrations/',import.meta.url);
  const archiveMigration=readFileSync(new URL('20261112100000_archive_module.sql',directory),'utf8');
  for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')&&n!=='20261112100000_archive_module.sql').sort())await pg.exec(pgliteSql(readFileSync(new URL(name,directory),'utf8')));
  await pg.exec("INSERT INTO public.app_roles(code,name) VALUES('IT_ADMIN','IT Admin') ON CONFLICT(code) DO NOTHING");
  await pg.exec('SET search_path=portal,pg_catalog');
  let inTx=false;
  const db={inTransaction:true,query:async(statement,args=[])=>{const result=await pg.query(statement,args);return Object.assign(result.rows,{count:result.affectedRows??result.rows.length});}};
  const atomic=async work=>{assert(!inTx,'nested transaction');await pg.exec('BEGIN');inTx=true;try{const result=await work();await pg.exec('COMMIT');return result;}catch(error){await pg.exec('ROLLBACK');throw error;}finally{inTx=false;}};

  // Snapshot portal-api hasil build-archive-deploy.mjs, dengan Drive tiruan.
  const drive=driveFixture(),driveCalls=[];
  globalThis.fetch=async(url,init)=>{const host=new URL(url).hostname;if(/googleapis\.com$/.test(host)){driveCalls.push(`${init?.method||'GET'} ${new URL(url).pathname}`);return drive.fetch(url,{...init,redirect:'manual'});}throw new Error('Unexpected network call '+url);};
  const env={SUPABASE_DB_URL:'postgresql://fixture:fixture@localhost/fixture',...drive.env};
  globalThis.Deno={env:{toObject:()=>({...env})}};
  const shim=source=>source.replace('import { withSupabase } from "npm:@supabase/server@1";','const withSupabase=(mode,handler)=>handler;').replace('import postgres from "npm:postgres@3.4.7";','const postgres=()=>{throw new Error("no database in fixture")};');
  const gateway=shim(readFileSync(new URL('../supabase/deploy/portal-api/index.ts',import.meta.url),'utf8'));
  assert(gateway.includes('p[0] === "archives"')&&gateway.includes('arsip: "SPH-Portal-Arsip"')&&gateway.includes('p[0] === "attendance"'),'Jalankan scripts/build-archive-deploy.mjs di atas snapshot yang sudah memuat Absensi.');
  const api=await import(`data:text/javascript;base64,${Buffer.from(gateway+'\nexport {routeOperation,AppError,createDriveStorage,driveModuleForOperation};').toString('base64')}`);
  // Seperti penangan sungguhan: penyimpanan dibuat per permintaan menurut modul rute, dan
  // berkas yang diikat dipindahkan ke folder modul setelah transaksi selesai.
  const portal=async(user,path,method='GET',body={},query='')=>{
    const storage=api.createDriveStorage(env,undefined,{module:api.driveModuleForOperation(path,body)});
    const result=await atomic(()=>api.routeOperation({db:{...db,storage},user:{...user,request_id:randomUUID()},path,method,body,query}));
    await storage.finalize();return result;
  };
  const denied=(promise,status)=>assert.rejects(promise,error=>{assert(error instanceof api.AppError,String(error?.stack||error));assert.equal(error.status,status,error.message);return true;});
  const upload=(user,name,bytes)=>portal(user,'uploads','POST',{name,mime_type:'application/pdf',data:bytes.toString('base64')});
  const bytes=pdf('surat fiktif '+randomUUID());let archive,main,creationPayload;

  await check('before archive migration, legacy uploads, attachments and downloads still work; archives answer 404',async()=>{
    const id=randomUUID();await pg.query('INSERT INTO auth.users(id) VALUES($1)',[id]);
    const legacy=await insert(db,'users',{id,username:'legacy-admin',status:'ACTIVE',must_change_password:0});
    await insert(db,'user_roles',{user_id:id,role_id:(await one(db,"SELECT id FROM roles WHERE code='SUPER_ADMIN'")).id,scope_kind:'ALL'});
    const uploaded=await upload(legacy,'legacy.pdf',pdf('legacy'));
    const announcement=await portal(legacy,'announcements','POST',{title:'Legacy fixture',category:'UMUM',blocks:[{type:'text',text:'Legacy fixture'}],attachments:[{file_id:uploaded.id}]});
    assert(announcement.id);
    assert(await portal(legacy,'files/'+uploaded.id));
    await denied(portal(legacy,'archives/overview'),404);
    await denied(portal(legacy,'archives','POST',{}),404);
  });
  await pg.exec(archiveMigration);

  await check('migration creates the archive tables with RLS, no client grants, roles and permissions',async()=>{
    const rls=await all(db,"SELECT tablename,rowsecurity FROM pg_catalog.pg_tables WHERE schemaname='portal' AND tablename LIKE 'archive_%' ORDER BY tablename");
    assert.deepEqual(rls.map(r=>r.tablename),[...tables].sort());assert(rls.every(r=>r.rowsecurity===true));
    const grants=await all(db,"SELECT table_name FROM information_schema.role_table_grants WHERE table_schema='portal' AND table_name LIKE 'archive_%' AND grantee IN('anon','authenticated','PUBLIC')");
    assert.equal(grants.length,0);
    const codes=(await all(db,"SELECT code FROM permissions WHERE code LIKE 'archives.%' ORDER BY code")).map(r=>r.code);
    assert.deepEqual(codes,['archives.humas.manage','archives.officers.assign','archives.records.oversee']);
    const held=async role=>(await all(db,"SELECT p.code FROM roles r JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE r.code=? AND p.code LIKE 'archives.%' ORDER BY p.code",role)).map(r=>r.code);
    assert.deepEqual(await held('HUMAS'),['archives.humas.manage']);assert.deepEqual(await held('ARSIP_PENGAWAS'),['archives.records.oversee']);
    assert.deepEqual(await held('SUPER_ADMIN'),['archives.officers.assign'],'template tetap; kebijakan Super Admin diperiksa langsung di modul');
    assert.equal(Number((await one(db,'SELECT count(*) n FROM archive_document_types WHERE is_active=1')).n),6);
  });

  const account=async(name,employeeId=null,roleCode=null,scope='ALL',units=[])=>{
    const id=randomUUID();await pg.query('INSERT INTO auth.users(id) VALUES($1)',[id]);
    const user=await insert(db,'users',{id,username:name,employee_id:employeeId,must_change_password:0,status:'ACTIVE',password_changed_at:now()});
    if(roleCode){const role=await one(db,'SELECT * FROM roles WHERE code=?',roleCode);const grant=await insert(db,'user_roles',{user_id:id,role_id:role.id,scope_kind:scope});
      for(const unit of units)await run(db,'INSERT INTO user_role_units(user_role_id,org_unit_id,include_descendants) VALUES(?,?,?)',grant.id,unit,1);}
    return user;
  };
  const sek=await insert(db,'org_units',{code:'ARS-U0',name:'Sekretariat Fiktif'}),keu=await insert(db,'org_units',{code:'ARS-U1',name:'Keuangan Fiktif',parent_id:sek.id}),ops=await insert(db,'org_units',{code:'ARS-U2',name:'Operasional Fiktif'});
  const person=async(key,name,unit)=>{
    const position=await insert(db,'positions',{code:'ARS-'+key,org_unit_id:unit.id,name:'Jabatan '+name}),employee=await insert(db,'employees',{employee_no:'ARS-'+key,full_name:name,employment_status:'Tetap',is_active:1,joined_on:'2020-01-01'});
    await insert(db,'employee_placements',{employee_id:employee.id,position_id:position.id,valid_from:'2020-01-01',is_primary:1});return employee;
  };
  const admin=await account('admin-arsip',null,'SUPER_ADMIN'),humas=await account('humas-arsip',(await person('h','Humas Fiktif',sek)).id,'HUMAS');
  const itAdmin=await account('it-admin-arsip',null,'IT_ADMIN');
  const officer=await account('petugas-arsip',(await person('o','Petugas Fiktif',keu)).id),staff=await account('pegawai-arsip',(await person('s','Pegawai Fiktif',keu)).id);
  const outsider=await account('pegawai-ops',(await person('x','Pegawai Operasional Fiktif',ops)).id),boss=await account('pimpinan-arsip',(await person('b','Pimpinan Fiktif',sek)).id,'ARSIP_PENGAWAS','ASSIGNED_UNITS',[sek.id]);


  await check('only an appointed officer uploads and files an archive; the agenda number follows unit and archival year',async()=>{
    await denied(upload(officer,'surat.pdf',bytes),403);
    await denied(portal(humas,'archives/officers','POST',{user_id:officer.id,org_unit_id:keu.id,reason:'SK fiktif',agenda_code:'KEU'}),403);
    const assigned=await portal(admin,'archives/officers','POST',{user_id:officer.id,org_unit_id:keu.id,reason:'SK fiktif',agenda_code:'KEU'});
    assert.equal(assigned.officers.find(o=>o.user.id===officer.id).status,'AKTIF');
    await denied(upload(staff,'surat.pdf',bytes),403);
    const file=await upload(officer,'surat masuk.pdf',bytes);
    const body={idempotency_key:randomUUID(),owner_unit_id:keu.id,direction:'MASUK',document_type_id:'arsip-jenis-surat',official_number:'01/FX/2026',letter_date:'2024-03-01',subject:'Perihal fiktif PostgreSQL',main_file_id:file.id,attachment_file_ids:[],classification:'RAHASIA'};
    creationPayload=body;
    await denied(portal(staff,'archives','POST',body),403);
    archive=(await portal(officer,'archives','POST',body)).archive;
    const year=new Date(Date.now()+8*3600000).getUTCFullYear();
    assert.equal(archive.agenda_number,`KEU/${year}/0001`);assert.equal(archive.classification,'BIASA','klasifikasi awal dipaksa Biasa');
    assert.equal((await portal(officer,'archives','POST',body)).repeated,true,'kirim ulang operasi yang sama tidak membuat arsip kedua');
    assert.equal(Number((await one(db,'SELECT count(*) n FROM archive_records')).n),1);
    const second=await upload(officer,'kedua.pdf',pdf('kedua '+randomUUID()));
    const next=(await portal(officer,'archives','POST',{...body,idempotency_key:randomUUID(),official_number:null,subject:'Perihal kedua fiktif',main_file_id:second.id})).archive;
    assert.equal(next.agenda_number,`KEU/${year}/0002`);
    // Berkas dipindahkan ke folder Drive modul `arsip`.
    const stored=await one(db,'SELECT f.storage_key FROM archive_document_versions v JOIN files f ON f.id=v.file_id JOIN archive_documents d ON d.id=v.document_id WHERE d.archive_id=?',archive.id);
    const folder=[...drive.files.values()].find(f=>f.appProperties?.sph_module==='arsip'&&f.mimeType==='application/vnd.google-apps.folder');
    assert(folder&&folder.name==='SPH-Portal-Arsip','folder Drive E-Arsip dibuat');
    assert.deepEqual(drive.files.get(stored.storage_key).parents,[folder.id]);
  });

  await check('preview needs read access; the original file needs a download grant, also for Humas',async()=>{
    const detail=await portal(staff,`archives/${archive.id}`);main=detail.documents[0];
    const path=`archives/${archive.id}/documents/${main.id}/versions/${main.current_version_id}`;
    assert.equal(Buffer.from((await portal(staff,`${path}/preview`)).data,'base64').toString('hex'),bytes.toString('hex'));
    await denied(portal(staff,`${path}/download`),403);await denied(portal(humas,`${path}/download`),403);
    await denied(portal(outsider,`archives/${archive.id}`),404);await denied(portal(outsider,`${path}/preview`),404);
    const fileId=(await one(db,'SELECT file_id FROM archive_document_versions WHERE id=?',main.current_version_id)).file_id;
    await denied(portal(officer,`files/${fileId}`),403);
    await portal(humas,`archives/${archive.id}/grants`,'POST',{purpose:'DOWNLOAD',target_user_id:staff.id,reason:'Perlu dicetak'});
    const original=await portal(staff,`${path}/download`);assert.equal(original.filename,'surat masuk.pdf');assert.equal(Buffer.from(original.data,'base64').toString('hex'),bytes.toString('hex'));
    assert.equal(Number((await one(db,"SELECT count(*) n FROM archive_audit_events WHERE action='DOWNLOAD_STARTED' AND archive_id=?",archive.id)).n),1);
  });

  await check('Rahasia is masked; grants follow the security epoch; IT Admin and supervisors are not a bypass',async()=>{
    await denied(portal(officer,`archives/${archive.id}/classification`,'POST',{target:'RAHASIA',reason:'x',expected_row_version:1}),403);
    const before=await portal(humas,`archives/${archive.id}`);
    await denied(portal(humas,`archives/${archive.id}/classification`,'POST',{target:'RAHASIA',reason:'Sensitif',expected_row_version:before.archive.row_version+5}),409);
    await portal(humas,`archives/${archive.id}/classification`,'POST',{target:'RAHASIA',reason:'Sensitif',expected_row_version:before.archive.row_version});
    for(const user of [staff,officer,boss]){
      const row=(await portal(user,'archives')).items.find(i=>i.id===archive.id);
      assert.deepEqual(Object.keys(row).sort(),['agenda_number','archived_at','classification','id','restricted']);
      const detail=await portal(user,`archives/${archive.id}`);assert.equal(detail.access.read,false);assert(!JSON.stringify(detail).includes('Perihal fiktif PostgreSQL'));
      await denied(portal(user,`archives/${archive.id}/documents/${main.id}/versions/${main.current_version_id}/preview`),403);
      assert.equal((await portal(user,'archives','GET',{},'q=PostgreSQL')).items.some(i=>i.id===archive.id),false,'pencarian perihal tidak mengungkap arsip Rahasia terbatas');
    }
    await denied(portal(itAdmin,`archives/${archive.id}`),404);
    assert.equal((await portal(humas,`archives/${archive.id}`)).archive.subject,'Perihal fiktif PostgreSQL');
    const repeated=await portal(officer,'archives','POST',creationPayload);
    assert.equal(repeated.repeated,true);assert.equal(repeated.archive.restricted,true);
    assert(!JSON.stringify(repeated).includes('Perihal fiktif PostgreSQL'));
    // Izin unduh dari epoch lama berakhir bersama perubahan klasifikasi.
    assert.equal(Number((await one(db,"SELECT count(*) n FROM archive_access_grants WHERE archive_id=? AND purpose='DOWNLOAD' AND revoked_at IS NULL",archive.id)).n),0);
    await portal(humas,`archives/${archive.id}/grants`,'POST',{purpose:'RAHASIA_READ',target_user_id:staff.id,reason:'Tindak lanjut',expires_at:new Date(Date.now()+3600000).toISOString()});
    assert.equal((await portal(staff,`archives/${archive.id}`)).archive.subject,'Perihal fiktif PostgreSQL');
    await run(db,"UPDATE archive_access_grants SET valid_from='2020-01-01T00:00:00.000Z',expires_at='2020-01-02T00:00:00.000Z' WHERE archive_id=? AND purpose='RAHASIA_READ'",archive.id);
    assert.equal((await portal(staff,`archives/${archive.id}`)).access.read,false,'izin sementara berakhir tepat pada batasnya');
  });

  await check('soft delete hides the archive without touching Drive; restore keeps identity; rows cannot be deleted or rewritten',async()=>{
    const filesBefore=drive.files.size;
    await denied(portal(officer,`archives/${archive.id}/delete`,'POST',{reason:'x',reference:'y'}),403);
    await portal(humas,`archives/${archive.id}/delete`,'POST',{reason:'Salah unggah',reference:'Pesan WA petugas'});
    await denied(portal(humas,`archives/${archive.id}`),404);
    await denied(portal(officer,'archives','POST',creationPayload),404);
    assert.equal((await portal(humas,'archives/deleted')).items.some(i=>i.id===archive.id),true);await denied(portal(officer,'archives/deleted'),403);
    assert.equal(drive.files.size,filesBefore,'berkas Drive tidak dihapus');
    const restored=await portal(humas,`archives/deleted/${archive.id}/restore`,'POST',{reason:'Ternyata benar'});
    assert.equal(restored.agenda_number,archive.agenda_number);
    await assert.rejects(pg.query('DELETE FROM portal.archive_records WHERE id=$1',[archive.id]));
    await assert.rejects(pg.query("UPDATE portal.archive_records SET agenda_number='X/1/1' WHERE id=$1",[archive.id]));
    await assert.rejects(pg.query("UPDATE portal.archive_audit_events SET action='X'"));await assert.rejects(pg.query('DELETE FROM portal.archive_audit_events'));
    await assert.rejects(pg.query("UPDATE portal.archive_document_versions SET original_filename='x'"));
    // Arsip tanpa dokumen utama gagal saat commit.
    await assert.rejects(atomic(()=>pg.query("INSERT INTO portal.archive_records(id,owner_unit_id,unit_code_snapshot,archival_year,agenda_sequence,agenda_number,archived_at,direction,document_type_id,document_type_name_snapshot,letter_date,subject,subject_normalized,created_by,updated_by,created_at,updated_at) VALUES('tanpa-utama',$1,'KEU',2026,999,'KEU/2026/0999',$2,'MASUK','arsip-jenis-surat','Surat','2026-01-01','x','x',$3,$3,$2,$2)",[keu.id,now(),officer.id])));
  });

  await check('gateway answers unknown archive routes with 404, and the Humas daily summary is prepared once',async()=>{
    await denied(portal(humas,'archives/overview/extra'),404);await denied(portal(staff,'archives/types','POST',{code:'X',name:'X'}),403);
    const first=await portal(humas,'archives/overview');await portal(humas,'archives/overview');
    assert.equal(first.humas,true);
    const runs=await all(db,'SELECT summary_date FROM archive_daily_summary_runs');assert(runs.length>=1&&new Set(runs.map(r=>r.summary_date)).size===runs.length);
    const notes=await all(db,"SELECT recipient_user_id,summary_date FROM archive_notifications WHERE notification_type='HUMAS_DAILY_SUMMARY'");
    assert(notes.length===runs.length&&notes.every(n=>n.recipient_user_id===humas.id),'satu ringkasan per tanggal untuk tiap Humas aktif');
    const report=await portal(staff,'archives/reports','POST',{type:'recap_period',format:'xlsx',from:'2020-01-01',to:'2099-12-31'});
    assert(report.rows.some(r=>r.restricted&&Object.keys(r).sort().join()==='agenda_number,archived_on,classification,restricted'));
  });
  await check('archive files cannot be reused in announcements; old double links do not bypass archive access',async()=>{
    await insert(db,'user_roles',{user_id:officer.id,role_id:(await one(db,"SELECT id FROM roles WHERE code='SDM'")).id,scope_kind:'ALL'});
    const announce=fileId=>portal(officer,'announcements','POST',{title:'Pengumuman fiktif',category:'UMUM',blocks:[{type:'text',text:'Isi fiktif'}],attachments:[{file_id:fileId}]});
    await denied(announce(creationPayload.main_file_id),422);
    const ordinary=await upload(officer,'ordinary.pdf',pdf('ordinary')),announcement=await announce(ordinary.id);
    await denied(portal(officer,'archives','POST',{...creationPayload,idempotency_key:randomUUID(),main_file_id:ordinary.id}),422);
    await portal(officer,`announcements/${announcement.id}/publish`,'POST',{row_version:announcement.row_version});
    assert(await portal(outsider,`files/${ordinary.id}`));
    await insert(db,'announcement_files',{announcement_id:announcement.id,file_id:creationPayload.main_file_id,usage_kind:'ATTACHMENT',caption:'',created_by:officer.id});
    await denied(portal(outsider,`files/${creationPayload.main_file_id}`),403);
    await denied(portal(officer,`files/${creationPayload.main_file_id}`),403);
  });

  await check('history keeps content and access changes after hundreds of detail openings',async()=>{
    for(let i=0;i<305;i++)await portal(humas,`archives/${archive.id}`);
    const history=await portal(humas,`archives/${archive.id}/history`);
    assert(history.items.some(i=>i.action==='ARCHIVE_CREATED'));
    assert(history.items.some(i=>i.action==='CLASSIFICATION_CHANGED'));
    assert(!history.items.some(i=>i.action==='DETAIL_OPENED'));
  });
  await check('Super Admin without employee or appointment uploads, creates, reads Rahasia, edits and downloads',async()=>{
    const uploaded=await upload(admin,'admin.pdf',pdf('Super Admin '+randomUUID()));
    const created=(await portal(admin,'archives','POST',{...creationPayload,idempotency_key:randomUUID(),main_file_id:uploaded.id,subject:'Arsip Super Admin fiktif',official_number:'ADMIN-001'})).archive;
    await portal(admin,`archives/${created.id}/classification`,'POST',{target:'RAHASIA',reason:'Uji admin',expected_row_version:1});
    await portal(admin,`archives/${created.id}`,'PATCH',{...creationPayload,subject:'Koreksi admin',expected_row_version:2});
    const detail=await portal(admin,`archives/${created.id}`);
    assert.equal(detail.archive.subject,'Koreksi admin');assert.equal(detail.access.edit,true);assert.equal(detail.access.download,true);
    const doc=detail.documents[0];assert(await portal(admin,`archives/${created.id}/documents/${doc.id}/versions/${doc.current_version_id}/download`));
    assert.equal(Number((await one(db,'SELECT count(*) n FROM archive_officers WHERE user_id=?',admin.id)).n),0);
    await denied(portal(itAdmin,`archives/${created.id}`),404);
  });
  await check('Kepala Urusan revokes only subordinates; staff and IT Admin cannot revoke or replace appointments',async()=>{
    const chief=await account('kaur-humas',(await person('chief','Kaur Humas',keu)).id,'EMPLOYEE');
    await run(db,"UPDATE positions SET name='Kepala Urusan Hubungan Masyarakat' WHERE id=(SELECT position_id FROM employee_placements WHERE employee_id=?)",chief.employee_id);
    const own=await account('bawahan-humas',(await person('own','Bawahan Humas',keu)).id,'HUMAS');
    const other=await account('bawahan-lain',(await person('other','Bawahan Urusan Lain',keu)).id,'EMPLOYEE');
    await run(db,'UPDATE employee_placements SET supervisor_employee_id=? WHERE employee_id=?',chief.employee_id,own.employee_id);
    for(const target of [own,other])await portal(admin,'archives/officers','POST',{user_id:target.id,org_unit_id:keu.id,reason:'Uji penunjukan'});
    const list=await portal(chief,'archives/officers');
    assert.deepEqual(list.officers.map(o=>o.user.id),[own.id]);assert.equal(list.can_assign,false);assert.equal(list.officers[0].can_revoke,true);
    const appointment=list.officers[0],foreign=await one(db,'SELECT id FROM archive_officers WHERE user_id=? AND revoked_at IS NULL',other.id);
    for(const actor of [own,itAdmin])await denied(portal(actor,`archives/officers/${appointment.id}/revoke`,'POST',{reason:'Tidak berwenang'}),403);
    await denied(portal(chief,`archives/officers/${foreign.id}/revoke`,'POST',{reason:'Di luar urusan'}),403);
    await denied(portal(itAdmin,'archives/officers','POST',{user_id:own.id,org_unit_id:keu.id,reason:'Penunjukan ulang'}),403);
    await portal(chief,`archives/officers/${appointment.id}/revoke`,'POST',{reason:'Rotasi tugas'});
    assert.equal((await portal(chief,'archives/officers')).officers[0].can_revoke,false);
  });
  console.log(`${checks} archive PostgreSQL checks passed.`);
}finally{globalThis.fetch=realFetch;globalThis.Deno=priorDeno;await pg.close();}
