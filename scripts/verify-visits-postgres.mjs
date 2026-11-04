// Verifikasi modul Pengelolaan Kunjungan di PostgreSQL sementara (PGlite).
//
//   node scripts/verify-visits-postgres.mjs <pglite/dist/index.js>
//
// Memeriksa: migrasi (RLS, tanpa grant, role & izin, IT admin tanpa visits),
// bundel Edge guide-form (aturan terima di PostgreSQL, kunci khusus modul — bukan
// kunci global, salinan spreadsheet di latar belakang lewat EdgeRuntime.waitUntil),
// snapshot portal-api yang sudah ditambal (status galat tetap, penyalinan di luar
// transaksi permintaan dan tanpa kunci global), serta retensi 6 minggu di PostgreSQL
// (UPDATE … FROM VALUES, ON CONFLICT, pelipatan ke rekap harian + ringkasan bulanan),
// migrasi awal riwayat NilaiGuide lewat gateway yang ditambal, dan migrasi basis data
// yang menolak berjalan bila ringkasan bulanan sudah terisi.
// Google tidak pernah dihubungi: semua panggilan ke Google tiruan (scripts/fake-google-sheets.mjs).
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {insert,one,all,now,audit} from '../supabase/functions/_shared/portal/db.mjs';
import {has} from '../supabase/functions/_shared/portal/auth.mjs';
import {visitRoutes} from '../supabase/functions/_shared/portal/visits.mjs';
import {ingestGuideEvaluations,visitOverview,witaDate,shiftDate} from '../supabase/functions/_shared/portal/visit-data.mjs';
import {runVisitSheetSync} from '../supabase/functions/_shared/portal/visit-sheets.mjs';
import {createFakeGoogle} from './fake-google-sheets.mjs';

const {PGlite}=await import(pathToFileURL(resolve(process.argv[2]||'/tmp/pglite/node_modules/@electric-sql/pglite/dist/index.js')).href);
const pg=new PGlite(),realFetch=globalThis.fetch,priorDeno=globalThis.Deno,priorRuntime=globalThis.EdgeRuntime;let checks=0;
const check=async(name,work)=>{await work();console.log('PASS '+name);checks++;};
// PGlite tidak memiliki pg_cron; hanya di sini pendaftaran job diganti schema tiruan.
const cronShim=`CREATE SCHEMA IF NOT EXISTS cron;CREATE TABLE IF NOT EXISTS cron.job(jobid bigserial PRIMARY KEY,jobname text UNIQUE,schedule text NOT NULL,command text NOT NULL);
CREATE OR REPLACE FUNCTION cron.schedule(job_name text,schedule text,command text) RETURNS bigint LANGUAGE sql AS $shim$ INSERT INTO cron.job(jobname,schedule,command) VALUES(job_name,schedule,command) ON CONFLICT(jobname) DO UPDATE SET schedule=EXCLUDED.schedule,command=EXCLUDED.command RETURNING jobid $shim$;`;
const pgliteSql=sql=>sql.replace(/^\s*CREATE EXTENSION IF NOT EXISTS pg_cron\b[^;]*;\s*$/im,cronShim).replace(/^\s*COMMENT ON EXTENSION pg_cron\b[^;]*;\s*$/im,'');
const visitTables=['guide_form_links','guide_form_rate_limits','guide_form_submissions','visit_guides','visit_evaluations','visit_monthly_totals','visit_sheet_files','visit_sheet_tabs','visit_sheet_state','visit_daily_totals','visit_history_import','visit_history_ids'];
const DAY=86400000,globalLock='734829610160009';
const bootstrapSql=`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,encrypted_password text);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id));CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO authenticated;`;
try{
  await pg.exec(bootstrapSql);
  const directory=new URL('../supabase/migrations/',import.meta.url);
  for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')).sort())await pg.exec(pgliteSql(readFileSync(new URL(name,directory),'utf8')));
  await pg.exec('SET search_path=portal,pg_catalog');
  // Pencatat transaksi: Google tidak boleh dipanggil saat transaksi basis data terbuka.
  let inTx=false;const statements=[];
  const db={inTransaction:true,query:async(statement,args=[])=>{statements.push(statement);const result=await pg.query(statement,args);return Object.assign(result.rows,{count:result.affectedRows??result.rows.length});}};
  const atomic=async work=>{assert(!inTx,'nested transaction');await pg.exec('BEGIN');inTx=true;try{const result=await work();await pg.exec('COMMIT');return result;}catch(error){await pg.exec('ROLLBACK');throw error;}finally{inTx=false;}};
  const client={begin:async work=>atomic(()=>work({unsafe:async(statement,args=[])=>{statements.push(statement);if(!args.length&&statement.includes(';')){await pg.exec(statement);return [];}const r=await pg.query(statement,args);return Object.assign(r.rows,{count:r.affectedRows??r.rows.length});}}))};
  const runTx=work=>atomic(()=>work(db));
  const account=async(name,roleCode)=>{
    const id=randomUUID();await pg.query('INSERT INTO auth.users(id) VALUES($1)',[id]);const user=await insert(db,'users',{id,username:name,must_change_password:0,status:'ACTIVE',password_changed_at:now()});
    const role=await one(db,'SELECT * FROM roles WHERE code=?',roleCode);await insert(db,'user_roles',{user_id:id,role_id:role.id,scope_kind:'ALL'});return user;
  };
  await pg.exec("INSERT INTO public.app_roles(code,name) VALUES('IT_ADMIN_FIXTURE','IT admin fixture'); INSERT INTO public.app_role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.app_roles r CROSS JOIN public.app_permissions p WHERE r.code='IT_ADMIN_FIXTURE' AND p.module_code='admin';");
  const manager=await account('kunjungan','KUNJUNGAN_PENGELOLA'),leader=await account('pimpinan','KUNJUNGAN_PIMPINAN'),itAdmin=await account('itadmin','IT_ADMIN_FIXTURE');
  for(const [id,name,kategori,regu,active] of [['G-001','Guide Fiktif Satu','Asing','A1',1],['G-002','Guide Fiktif Dua','Asing','A2',0],['G-003','Guide Fiktif Tiga','Domestik','D1, D2',1]])
    await insert(db,'visit_guides',{id,seq:Number(id.slice(2)),name,kategori,regu,is_active:active});

  await check('visit tables use RLS and grant nothing to API roles',async()=>{
    for(const name of visitTables){
      assert.equal((await pg.query("SELECT rowsecurity FROM pg_tables WHERE schemaname='portal' AND tablename=$1",[name])).rows[0]?.rowsecurity,true,name);
      for(const role of ['anon','authenticated','service_role'])assert.equal((await pg.query("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') allowed",[role,'portal.'+name])).rows[0].allowed,false);
    }
    assert.equal((await pg.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='portal' AND NOT rowsecurity")).rows[0].n,0,'gateway health check memerlukan RLS di semua tabel portal');
    assert.equal((await one(db,'SELECT count(*)::int n FROM visit_sheet_state')).n,1);
  });
  await check('role templates hold exactly the visits permissions; IT admin holds none',async()=>{
    const codes=async code=>(await pg.query("SELECT p.code FROM public.app_role_permissions rp JOIN public.app_roles r ON r.id=rp.role_id JOIN public.app_permissions p ON p.id=rp.permission_id WHERE r.code=$1 AND p.module_code='visits' ORDER BY 1",[code])).rows.map(r=>r.code);
    assert.equal((await codes('KUNJUNGAN_PENGELOLA')).length,9);assert.equal((await codes('SUPER_ADMIN')).length,9);
    assert.deepEqual(await codes('KUNJUNGAN_PIMPINAN'),['visits.dashboard.read','visits.guides.read','visits.records.read','visits.reports.export','visits.reports.read']);
    assert.deepEqual(await codes('IT_ADMIN_FIXTURE'),[]);
    await assert.rejects(atomic(()=>visitRoutes({db,user:itAdmin,p:['visits','links'],method:'GET',body:{},url:new URL('https://x.invalid/')},{has,audit})),e=>e.status===403);
  });

  // Google tiruan; setiap panggilan ke Google diperiksa: tidak boleh di dalam transaksi.
  const google=createFakeGoogle(),googleCalls=[];
  globalThis.fetch=async(url,init)=>{const host=new URL(url).hostname;if(/googleapis\.com$/.test(host)){assert(!inTx,`Google (${host}) dipanggil di dalam transaksi`);googleCalls.push(host);return google.fetch(url,init);}throw new Error('Unexpected network call '+url);};
  const env={SUPABASE_DB_URL:'postgresql://fixture:fixture@localhost/fixture',VISITS_IP_HMAC_KEY:'h'.repeat(40),...google.env};
  globalThis.Deno={env:{toObject:()=>({...env})}};
  const background=[];globalThis.EdgeRuntime={waitUntil:task=>background.push(task)};
  globalThis.__visitsFixture={postgres:()=>client};
  const shim=source=>source.replace('import { withSupabase } from "npm:@supabase/server@1";','const withSupabase=(mode,handler)=>{if(mode.auth!=="secret")throw new Error("Unexpected auth mode");return handler;};').replace('import postgres from "npm:postgres@3.4.7";','const postgres=globalThis.__visitsFixture.postgres;');
  const edgeSource=shim(readFileSync(new URL('../supabase/deploy/guide-form/index.ts',import.meta.url),'utf8'));
  assert(!edgeSource.includes(globalLock),'guide-form tidak boleh memakai kunci global portal');
  const edge=(await import(`data:text/javascript;base64,${Buffer.from(edgeSource).toString('base64')}`)).default.fetch;
  const invoke=async(operation,body,ip='192.0.2.10')=>{const r=await edge(new Request('https://fixture.supabase.co/functions/v1/guide-form',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,client_ip:ip,body})}));return {status:r.status,data:await r.json()};};
  const link=await atomic(()=>visitRoutes({db,user:manager,p:['visits','links'],method:'POST',body:{action:'create',pos:1},url:new URL('https://x.invalid/')},{has,audit}));
  const evaluation=(extra={})=>({evaluationId:randomUUID(),guideId:'G-001',guideName:'Nama dari HP',pos:1,timestamp:new Date(Date.now()-600000).toISOString(),criteria:{uniform:2,idCard:true,etika:1},catatan:'',...extra});
  const good=evaluation();

  await check('packaged guide-form serves the active Data Guide list for an active pos link only',async()=>{
    const r=await invoke('context',{token:link.token});assert.equal(r.status,200,JSON.stringify(r.data));
    assert.equal(r.data.result.pos,1);assert.deepEqual(r.data.result.guides.map(g=>g.guideId),['G-001','G-003']);
    assert.equal((await invoke('context',{token:'f'.repeat(64)})).status,404);
    assert(!statements.some(s=>s.includes(globalLock)));
  });
  await check('packaged submit applies the acceptance rules in PostgreSQL under the module lock and logs outcomes without content',async()=>{
    statements.length=0;
    const near=evaluation({timestamp:new Date(Date.parse(good.timestamp)+5*60000).toISOString()}),unknown=evaluation({guideId:'G-999'}),wrong=evaluation({pos:3}),inactive=evaluation({guideId:'G-002'});
    const r=await invoke('submit',{token:link.token,evaluations:[good,near,unknown,wrong,inactive]});assert.equal(r.status,200,JSON.stringify(r.data));
    assert.deepEqual(r.data.result.accepted.map(a=>a.evaluationId),[good.evaluationId,inactive.evaluationId]);
    assert.deepEqual(r.data.result.rejected.map(x=>x.evaluationId).sort(),[near.evaluationId,unknown.evaluationId,wrong.evaluationId].sort());
    assert(statements.some(s=>s.includes("hashtextextended('portal.visits.guide_evaluations',0)")),'penerimaan diserialkan kunci modul');
    assert(!statements.some(s=>s.includes(globalLock)),'tanpa kunci global portal');
    const row=await one(db,'SELECT * FROM visit_evaluations WHERE id=?',good.evaluationId);
    assert.deepEqual([row.guide_name,row.pos,row.uniform,row.id_card,row.status,row.wita_date],['Guide Fiktif Satu',1,2,1,'aktif',witaDate(Date.parse(good.timestamp))]);
    const log=await all(db,'SELECT outcome,reason,ip_hmac,link_id FROM guide_form_submissions ORDER BY outcome,reason');
    assert.deepEqual(log.map(l=>[l.outcome,l.reason]),[['ACCEPTED',null],['ACCEPTED',null],['REJECTED','GUIDE'],['REJECTED','JEDA'],['REJECTED','POS']]);
    assert(log.every(l=>/^[a-f0-9]{64}$/.test(l.ip_hmac)&&l.link_id===link.link.id));
  });
  await check('background copy after submit runs outside the request transaction via EdgeRuntime.waitUntil',async()=>{
    assert.equal(background.length,1,'satu tugas latar belakang');await Promise.all(background.splice(0));
    const month=witaDate(Date.parse(good.timestamp)).slice(0,7);
    assert.deepEqual(google.rows(month).map(r=>r[0]).sort(),[good.evaluationId,(await all(db,"SELECT id FROM visit_evaluations WHERE guide_id='G-002'"))[0].id].sort());
    assert.equal((await one(db,'SELECT count(*)::int n FROM visit_evaluations WHERE sheet_row IS NULL')).n,0);
    assert(googleCalls.length>0);
  });
  await check('duplicates and corrections behave the same in PostgreSQL; rate limits are atomic',async()=>{
    let r=await invoke('submit',{token:link.token,evaluations:[good]});assert.equal(r.data.result.accepted[0].duplicate,true);assert.equal(background.length,0,'kiriman ulang tidak memicu penyalinan');
    const fix=evaluation({timestamp:good.timestamp,koreksiDari:good.evaluationId,criteria:{uniform:-1,idCard:false,etika:-2}});
    r=await invoke('submit',{token:link.token,evaluations:[fix]},'192.0.2.11');assert.equal(r.data.result.accepted.length,1);
    assert.deepEqual({...await one(db,'SELECT status,replaced_by,sheet_dirty FROM visit_evaluations WHERE id=?',good.evaluationId)},{status:'diganti',replaced_by:fix.evaluationId,sheet_dirty:1});
    await Promise.all(background.splice(0));
    const month=witaDate(Date.parse(good.timestamp)).slice(0,7);
    assert.equal(google.rows(month).find(x=>x[0]===good.evaluationId)[12],'diganti');
    const second=await atomic(()=>visitRoutes({db,user:manager,p:['visits','links'],method:'POST',body:{action:'create',pos:3},url:new URL('https://x.invalid/')},{has,audit}));
    let last;for(let i=0;i<61;i++)last=await invoke('context',{token:second.token},`198.51.100.${i%250}`);assert.equal(last.status,429);
    for(let i=0;i<60;i++)await invoke('context',{token:'e'.repeat(64)},'203.0.113.99');
    assert.equal((await invoke('context',{token:link.token},'203.0.113.99')).status,429);
  });
  await check('revoked links stop immediately',async()=>{
    const current=await one(db,'SELECT * FROM guide_form_links WHERE id=?',link.link.id);
    await atomic(()=>visitRoutes({db,user:manager,p:['visits','links'],method:'POST',body:{action:'revoke',pos:1,id:current.id,row_version:current.row_version},url:new URL('https://x.invalid/')},{has,audit}));
    assert.equal((await invoke('submit',{token:link.token,evaluations:[evaluation()]},'192.0.2.200')).status,404);
    assert.equal((await one(db,'SELECT share_token FROM guide_form_links WHERE id=?',link.link.id)).share_token,null);
  });

  // Snapshot portal-api hasil build-visits-deploy.mjs.
  const gateway=shim(readFileSync(new URL('../supabase/deploy/portal-api/index.ts',import.meta.url),'utf8'));
  assert(gateway.includes('visitsSheetRequest')&&!gateway.includes('visitsBridgeRequest'),'Jalankan scripts/build-visits-deploy.mjs lebih dulu.');
  const api=await import(`data:text/javascript;base64,${Buffer.from(gateway+'\nexport {routeOperation,visitsSheetRequest,AppError};').toString('base64')}`);
  const route=(user,path,method='GET',body={},query='')=>atomic(()=>api.routeOperation({db,user,path,method,body,query}));
  await check('patched gateway serves visits database routes with the gateway AppError statuses',async()=>{
    await assert.rejects(route(itAdmin,'visits/links'),e=>e instanceof api.AppError&&e.status===403);
    await assert.rejects(route(manager,'visits/links','POST',{action:'create',pos:2}),e=>e instanceof api.AppError&&e.status===422);
    await assert.rejects(route(leader,'visits/guides/import','POST',{rows:[{guideName:'X',kategori:'Asing',regu:'A1'}]}),e=>e instanceof api.AppError&&e.status===403);
    const imported=await route(manager,'visits/guides/import','POST',{rows:[{guideId:'G-010',guideName:'Guide Impor',kategori:'Domestik',regu:'D2',aktif:'TRUE'}],apply:true});
    assert.deepEqual([imported.applied,imported.create],[true,1]);assert.equal((await one(db,"SELECT action FROM audit_events WHERE object_type='visit_guides' ORDER BY occurred_at DESC LIMIT 1")).action,'IMPORT');
    await assert.rejects(route(manager,'visits/guides','POST',{guideName:'guide impor',kategori:'Domestik',regu:'D2',aktif:true}),e=>e instanceof api.AppError&&e.status===409);
    const guides=await route(leader,'visits/guides');assert.deepEqual(guides.items.map(g=>g.guideId),['G-001','G-002','G-003','G-010']);
    const today=witaDate(Date.now()),overview=await route(leader,'visits/overview','GET',{},`from=${shiftDate(today,-3)}&to=${today}`);
    assert.equal(overview.ringkasan.pengantaran,2);assert.equal(overview.perPos[0].pengantaran,2);
    const records=await route(leader,'visits/records','GET',{},`from=${shiftDate(today,-3)}&to=${today}&status=diganti`);assert.equal(records.total,1);
    const status=await route(leader,'visits/sheet');assert.equal(status.pending,0);assert.equal(status.can_sync,false);
    await assert.rejects(route(manager,'visits/sheet/sync','POST'),e=>e instanceof api.AppError&&e.status===404,'penyalinan tidak pernah lewat transaksi permintaan');
  });
  await check('patched gateway runs sheet sync and connection check outside the request transaction and without the global lock',async()=>{
    const identity={},storage={};
    const authorize=user=>async database=>{assert(inTx);return one(database,'SELECT * FROM users WHERE id=?',user.id);};
    await assert.rejects(api.visitsSheetRequest(client,identity,storage,{path:'visits/sheet/sync',method:'POST',body:{},query:''},env,authorize(leader)),e=>e instanceof api.AppError&&e.status===403);
    await assert.rejects(api.visitsSheetRequest(client,identity,storage,{path:'visits/sheet/check',method:'POST',body:{},query:''},env,authorize(itAdmin)),e=>e instanceof api.AppError&&e.status===403);
    statements.length=0;
    const checked=await api.visitsSheetRequest(client,identity,storage,{path:'visits/sheet/check',method:'POST',body:{},query:''},env,authorize(manager));
    assert.equal(checked.ok,true,JSON.stringify(checked.steps));
    await atomic(()=>ingestGuideEvaluations(db,{id:link.link.id,pos:1},[{...evaluation({guideId:'G-003'}),criteria:{uniform:1,idCard:true,etika:0}}].map(i=>({...i,catatan:''}))));
    const synced=await api.visitsSheetRequest(client,identity,storage,{path:'visits/sheet/sync',method:'POST',body:{},query:''},env,authorize(manager));
    assert.equal(synced.ok,true,synced.error);assert.equal(synced.written,1);
    assert(!statements.some(s=>s.includes(globalLock)),'penyalinan tidak memakai kunci global portal');
  });
  await check('retention on PostgreSQL: rescans moved rows, folds verified days into daily and monthly totals, keeps figures identical',async()=>{
    const pos1={id:link.link.id,pos:1},oldNow=Date.now()-50*DAY,oldDay=witaDate(oldNow-DAY),base=Date.parse(`${oldDay}T08:00:00+08:00`);
    const items=[0,1,2,3].map(i=>({evaluationId:randomUUID(),guideId:i%2?'G-003':'G-001',guideName:'x',pos:1,timestamp:new Date(base+i*20*60000).toISOString(),criteria:{uniform:i?1:2,idCard:i!==1,etika:i-1},catatan:''}));
    const result=await atomic(()=>ingestGuideEvaluations(db,pos1,items,oldNow));assert.equal(result.accepted.length,4);
    const today=witaDate(Date.now()),from=`${oldDay.slice(0,7)}-01`,figures=o=>JSON.stringify({...o,diperbarui:null,periode:null});
    const before=await atomic(()=>visitOverview(db,from,today)),beforeDay=await atomic(()=>visitOverview(db,oldDay,oldDay));
    let r=await runVisitSheetSync({runTx,env,trigger:'manual',retention:'skip'});assert.equal(r.ok,true,r.error);
    // Pengguna mengurutkan tab lama: posisi dibaca ulang (UPDATE … FROM VALUES) sebelum verifikasi.
    google.sortTab(oldDay.slice(0,7),4);
    // Retensi sudah berjalan hari ini lewat penyalinan sebelumnya, jadi dipaksa di sini.
    r=await runVisitSheetSync({runTx,env,trigger:'manual',retention:'force'});assert.equal(r.ok,true,r.error);
    if(r.retention_blocked)r=await runVisitSheetSync({runTx,env,trigger:'manual',retention:'force'});
    if(r.retention_blocked)r=await runVisitSheetSync({runTx,env,trigger:'manual',retention:'force'});
    assert.equal(r.retention_blocked,false);assert(r.status.folded_through>=oldDay);
    assert.equal((await one(db,'SELECT count(*)::int n FROM visit_evaluations WHERE wita_date<=?',r.status.folded_through)).n,0);
    assert.equal((await one(db,"SELECT antar FROM visit_monthly_totals WHERE month=? AND guide_id='*' AND pos=0",oldDay.slice(0,7))).antar,4);
    assert.equal(figures(await atomic(()=>visitOverview(db,from,today))),figures(before));
    assert.equal((await one(db,"SELECT sum(antar)::int n FROM visit_daily_totals WHERE sumber='portal' AND day=?",oldDay)).n,4,'rekap harian ikut terisi');
    assert.equal(figures(await atomic(()=>visitOverview(db,oldDay,oldDay))),figures(beforeDay),'satu hari yang sudah dilipat tetap bisa dihitung');
    assert.equal(google.rows(oldDay.slice(0,7)).filter(x=>x.length).length,4,'spreadsheet tetap memuat rinciannya');
  });
  await check('NilaiGuide history import on PostgreSQL through the patched gateway: preview, resent part, finish, once only, cancel',async()=>{
    const wita=(day,hour)=>new Date(`${day}T${hour}:00+08:00`).toISOString();
    const rows=[[2,randomUUID(),wita('2026-03-02','09:00'),1,'G-001',2,1,3,'aktif'],[3,randomUUID(),wita('2026-03-02','10:00'),3,'G-003','TRUE',true,-2,'aktif'],[4,randomUUID(),wita('2026-03-03','09:00'),2,'G-001',1,1,1,'aktif'],[5,randomUUID(),wita('2026-03-03','11:00'),1,'G-001',1,1,1,'diganti']];
    const second=[[6,randomUUID(),wita('2026-04-01','08:00'),1,'G-003',-1,0,0,'aktif']];
    const file={name:'Basis Data 2026.xlsx',sha256:'c'.repeat(64),rows_total:5,parts_total:2};
    await assert.rejects(route(leader,'visits/history/import','POST',{mode:'preview',file,part:0,rows}),e=>e instanceof api.AppError&&e.status===403);
    const p=await route(manager,'visits/history/import','POST',{mode:'preview',file,part:0,rows});
    assert.deepEqual([p.counts.MASUK,p.counts.POS2,p.counts.DIGANTI],[2,1,1]);
    assert.equal((await one(db,'SELECT count(*)::int n FROM visit_history_import')).n,0,'pratinjau tidak menyimpan');
    const first=await route(manager,'visits/history/import','POST',{mode:'apply',file,part:0,rows});const id=first.import.id;
    assert.equal((await route(manager,'visits/history/import','POST',{mode:'apply',file,part:0,rows,import_id:id})).ulang,true);
    await assert.rejects(route(manager,'visits/history/finish','POST',{import_id:id}),e=>e instanceof api.AppError&&e.status===409);
    await route(manager,'visits/history/import','POST',{mode:'apply',file,part:1,rows:second,import_id:id});
    const done=await route(manager,'visits/history/finish','POST',{import_id:id});assert.equal(done.import.status,'aktif');
    const march=await route(leader,'visits/overview','GET',{},'from=2026-03-01&to=2026-03-31');assert.equal(march.ringkasan.pengantaran,2);assert.equal(march.ringkasan.hariDinilai,1);
    await assert.rejects(route(manager,'visits/history/import','POST',{mode:'apply',file,part:0,rows}),e=>e instanceof api.AppError&&e.status===409,'hanya sekali');
    // Batasan UNIQUE: dua migrasi terbuka tidak mungkin, bahkan lewat SQL langsung.
    await assert.rejects(pg.query("INSERT INTO portal.visit_history_import(id,status,terbuka,file_name,file_sha256,rows_total,parts_total,created_at) VALUES($1,'menyusun',1,'x',$2,1,1,'2026-01-01T00:00:00.000Z')",[randomUUID(),'d'.repeat(64)]));
    const status=await route(leader,'visits/history');assert.equal(status.current.ringkasan.counts.MASUK,3);assert.equal(status.can_manage,false);
    const cancelled=await route(manager,'visits/history/cancel','POST',{import_id:id});assert.equal(cancelled.import.status,'dibatalkan');
    assert.equal((await route(leader,'visits/overview','GET',{},'from=2026-03-01&to=2026-04-30')).ringkasan.pengantaran,0);
    assert.equal((await one(db,"SELECT count(*)::int n FROM visit_daily_totals WHERE sumber='nilaiguide'")).n,0);
    assert.equal((await one(db,"SELECT count(*)::int n FROM audit_events WHERE object_type='visit_history_import' AND action IN('IMPORT_START','IMPORT','IMPORT_CANCEL')")).n,3);
  });

  await check('daily-totals migration refuses to run once monthly totals exist, so no folded month silently loses its figures',async()=>{
    const fresh=new PGlite();
    try{
      await fresh.exec(bootstrapSql);
      const names=readdirSync(directory).filter(n=>n.endsWith('.sql')).sort(),last=names.indexOf('20261104120000_visit_daily_totals_history.sql');
      assert(last>0,'migrasi rekap harian ada');
      for(const name of names.slice(0,last))await fresh.exec(pgliteSql(readFileSync(new URL(name,directory),'utf8')));
      await fresh.exec("INSERT INTO portal.visit_monthly_totals(month,guide_id,pos,antar,uniform,uniform_patuh,id_card,review,etika,hari,updated_at) VALUES('2026-11','*',0,1,1,1,1,0,1,1,'2026-12-20T00:00:00.000Z')");
      await assert.rejects(fresh.exec(pgliteSql(readFileSync(new URL(names[last],directory),'utf8'))),e=>/visit_monthly_totals sudah terisi/.test(e.message));
      await fresh.exec('ROLLBACK');
      assert.equal((await fresh.query("SELECT to_regclass('portal.visit_daily_totals') AS t")).rows[0].t,null,'tidak ada yang dibuat');
    }finally{await fresh.close();}
  });
  console.log(`${checks} visits PostgreSQL checks passed.`);
}finally{globalThis.fetch=realFetch;globalThis.Deno=priorDeno;globalThis.EdgeRuntime=priorRuntime;delete globalThis.__visitsFixture;await pg.close();}
