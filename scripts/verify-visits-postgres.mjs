// Verifikasi modul Pengelolaan Kunjungan di PostgreSQL sementara (PGlite).
//
//   node scripts/verify-visits-postgres.mjs <pglite/dist/index.js>
//
// Memeriksa: migrasi (RLS, tanpa grant, role & izin, IT admin tanpa visits),
// bundel Edge guide-form (tanpa kunci global, jembatan di luar transaksi,
// batas frekuensi atomik, catatan kiriman), dan snapshot portal-api yang sudah
// ditambal (status galat tetap, rute jembatan di luar transaksi tulis).
// Google tidak pernah dihubungi: jembatan diganti tiruan yang memeriksa pengalihan 302.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {insert,one,all,now} from '../supabase/functions/_shared/portal/db.mjs';
import {has} from '../supabase/functions/_shared/portal/auth.mjs';
import {audit} from '../supabase/functions/_shared/portal/db.mjs';
import {visitRoutes} from '../supabase/functions/_shared/portal/visits.mjs';

const {PGlite}=await import(pathToFileURL(resolve(process.argv[2]||'/tmp/pglite/node_modules/@electric-sql/pglite/dist/index.js')).href);
const pg=new PGlite(),realFetch=globalThis.fetch,priorDeno=globalThis.Deno;let checks=0;
const check=async(name,work)=>{await work();console.log('PASS '+name);checks++;};
// PGlite tidak memiliki pg_cron; hanya di sini pendaftaran job diganti schema tiruan.
const cronShim=`CREATE SCHEMA IF NOT EXISTS cron;CREATE TABLE IF NOT EXISTS cron.job(jobid bigserial PRIMARY KEY,jobname text UNIQUE,schedule text NOT NULL,command text NOT NULL);
CREATE OR REPLACE FUNCTION cron.schedule(job_name text,schedule text,command text) RETURNS bigint LANGUAGE sql AS $shim$ INSERT INTO cron.job(jobname,schedule,command) VALUES(job_name,schedule,command) ON CONFLICT(jobname) DO UPDATE SET schedule=EXCLUDED.schedule,command=EXCLUDED.command RETURNING jobid $shim$;`;
const pgliteSql=sql=>sql.replace(/^\s*CREATE EXTENSION IF NOT EXISTS pg_cron\b[^;]*;\s*$/im,cronShim).replace(/^\s*COMMENT ON EXTENSION pg_cron\b[^;]*;\s*$/im,'');
const bridgeKey='k'.repeat(48)+'-pglite-fixture',bridgeUrl='https://script.google.com/macros/s/AKfycbPgliteFixtureFixture01/exec';
try{
  await pg.exec(`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,encrypted_password text);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id));CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO authenticated;`);
  const directory=new URL('../supabase/migrations/',import.meta.url);
  for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')).sort())await pg.exec(pgliteSql(readFileSync(new URL(name,directory),'utf8')));
  await pg.exec('SET search_path=portal,pg_catalog');
  // Pencatat status transaksi: jembatan tidak boleh dipanggil saat transaksi terbuka.
  let inTx=false;const statements=[];
  const db={inTransaction:true,query:async(statement,args=[])=>{statements.push(statement);const result=await pg.query(statement,args);return Object.assign(result.rows,{count:result.affectedRows??result.rows.length});}};
  const atomic=async work=>{assert(!inTx,'nested transaction');await pg.exec('BEGIN');inTx=true;try{const result=await work();await pg.exec('COMMIT');return result;}catch(error){await pg.exec('ROLLBACK');throw error;}finally{inTx=false;}};
  const client={begin:async work=>atomic(()=>work({unsafe:async(statement,args=[])=>{statements.push(statement);if(!args.length&&statement.includes(';')){await pg.exec(statement);return [];}const r=await pg.query(statement,args);return Object.assign(r.rows,{count:r.affectedRows??r.rows.length});}}))};
  const account=async(name,roleCode)=>{
    const id=randomUUID();await pg.query('INSERT INTO auth.users(id) VALUES($1)',[id]);const user=await insert(db,'users',{id,username:name,must_change_password:0,status:'ACTIVE',password_changed_at:now()});
    const role=await one(db,'SELECT * FROM roles WHERE code=?',roleCode);await insert(db,'user_roles',{user_id:id,role_id:role.id,scope_kind:'ALL'});return user;
  };
  await pg.exec("INSERT INTO public.app_roles(code,name) VALUES('IT_ADMIN_FIXTURE','IT admin fixture'); INSERT INTO public.app_role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.app_roles r CROSS JOIN public.app_permissions p WHERE r.code='IT_ADMIN_FIXTURE' AND p.module_code='admin';");
  const manager=await account('kunjungan','KUNJUNGAN_PENGELOLA'),leader=await account('pimpinan','KUNJUNGAN_PIMPINAN'),itAdmin=await account('itadmin','IT_ADMIN_FIXTURE'),superAdmin=await account('super','SUPER_ADMIN');

  await check('visit tables use RLS and grant nothing to API roles',async()=>{
    for(const name of ['guide_form_links','guide_form_rate_limits','guide_form_submissions']){
      assert.equal((await pg.query("SELECT rowsecurity FROM pg_tables WHERE schemaname='portal' AND tablename=$1",[name])).rows[0].rowsecurity,true);
      for(const role of ['anon','authenticated','service_role'])assert.equal((await pg.query("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') allowed",[role,'portal.'+name])).rows[0].allowed,false);
    }
  });
  await check('role templates hold exactly the visits permissions; IT admin holds none',async()=>{
    const codes=async code=>(await pg.query("SELECT p.code FROM public.app_role_permissions rp JOIN public.app_roles r ON r.id=rp.role_id JOIN public.app_permissions p ON p.id=rp.permission_id WHERE r.code=$1 AND p.module_code='visits' ORDER BY 1",[code])).rows.map(r=>r.code);
    assert.equal((await codes('KUNJUNGAN_PENGELOLA')).length,9);assert.equal((await codes('SUPER_ADMIN')).length,9);
    assert.deepEqual(await codes('KUNJUNGAN_PIMPINAN'),['visits.dashboard.read','visits.guides.read','visits.records.read','visits.reports.export','visits.reports.read']);
    assert.deepEqual(await codes('IT_ADMIN_FIXTURE'),[]);
    for(const user of [itAdmin])await assert.rejects(atomic(()=>visitRoutes({db,user,p:['visits','links'],method:'GET',body:{},url:new URL('https://x.invalid/')},{has,audit})),e=>e.status===403);
  });

  // Jembatan tiruan: POST /exec → 302 ke script.googleusercontent.com → GET balasan.
  let pending=null,busy=false;const bridgeCalls=[];
  globalThis.fetch=async(url,init={})=>{
    const target=new URL(url);
    if(target.hostname==='script.google.com'){
      assert(!inTx,'jembatan dipanggil di dalam transaksi database');
      const body=JSON.parse(init.body);bridgeCalls.push(body);assert.equal(body.credential,bridgeKey);assert.equal(init.redirect,'manual');
      const items=body.payload?.items||[];
      pending=body.operation==='form.context'?{ok:true,data:{guides:[{guideId:'G-001',guideName:'Guide Fiktif',kategori:'Asing',regu:'A1'}],serverTime:new Date().toISOString()}}
        :body.operation==='evaluations.submit'?(busy?{ok:false,code:'SIBUK',error:'x'}:{ok:true,data:{accepted:items.filter(i=>i.guideId!=='G-999').map(i=>({evaluationId:i.evaluationId,synced:true,duplicate:false})),rejected:items.filter(i=>i.guideId==='G-999').map(i=>({evaluationId:i.evaluationId,errors:['guideId "G-999" tidak ada di tab Guides']})),serverTime:new Date().toISOString()}})
        :body.operation==='guides.upsert'?{ok:true,data:{saved:true,created:true,guideId:'G-315'}}
        :{ok:true,data:{operation:body.operation,payload:body.payload}};
      return new Response(null,{status:302,headers:{location:'https://script.googleusercontent.com/macros/echo?user_content_key=fixture'}});
    }
    if(target.hostname==='script.googleusercontent.com'){assert.equal(init.method,'GET');assert(!init.body);return Response.json(pending);}
    throw new Error('Unexpected network call '+url);
  };
  globalThis.Deno={env:{toObject:()=>({SUPABASE_DB_URL:'postgresql://fixture:fixture@localhost/fixture',VISITS_BRIDGE_URL:bridgeUrl,VISITS_BRIDGE_KEY:bridgeKey,VISITS_IP_HMAC_KEY:'h'.repeat(40)})}};
  globalThis.__visitsFixture={postgres:()=>client};
  const shim=source=>source.replace('import { withSupabase } from "npm:@supabase/server@1";','const withSupabase=(mode,handler)=>{if(mode.auth!=="secret")throw new Error("Unexpected auth mode");return handler;};').replace('import postgres from "npm:postgres@3.4.7";','const postgres=globalThis.__visitsFixture.postgres;');
  const edgeSource=shim(readFileSync(new URL('../supabase/deploy/guide-form/index.ts',import.meta.url),'utf8'));
  assert(!edgeSource.includes('pg_advisory'),'guide-form tidak boleh memakai kunci global');
  const edge=(await import(`data:text/javascript;base64,${Buffer.from(edgeSource).toString('base64')}`)).default.fetch;
  const invoke=async(operation,body,ip='192.0.2.10')=>{const r=await edge(new Request('https://fixture.supabase.co/functions/v1/guide-form',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,client_ip:ip,body})}));return {status:r.status,data:await r.json()};};
  const link=await atomic(()=>visitRoutes({db,user:manager,p:['visits','links'],method:'POST',body:{action:'create',pos:1},url:new URL('https://x.invalid/')},{has,audit}));
  const evaluation=(extra={})=>({evaluationId:randomUUID(),guideId:'G-001',guideName:'Guide Fiktif',pos:1,timestamp:new Date(Date.now()-600000).toISOString(),criteria:{uniform:2,idCard:true,etika:1},catatan:'',...extra});

  await check('packaged guide-form serves context only for an active pos link',async()=>{
    const r=await invoke('context',{token:link.token});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.result.pos,1);assert.deepEqual(r.data.result.guides.map(g=>g.guideId),['G-001']);
    assert.equal((await invoke('context',{token:'f'.repeat(64)})).status,404);
    assert(!statements.some(s=>/pg_advisory/i.test(s)));
  });
  await check('packaged submit forwards valid items, logs outcomes without content, and keeps the token out of the bridge',async()=>{
    const good=evaluation(),unknown=evaluation({guideId:'G-999'}),wrong=evaluation({pos:3});
    const r=await invoke('submit',{token:link.token,evaluations:[good,unknown,wrong]});assert.equal(r.status,200,JSON.stringify(r.data));
    assert.deepEqual(r.data.result.accepted.map(a=>a.evaluationId),[good.evaluationId]);assert.equal(r.data.result.rejected.length,2);
    const sent=bridgeCalls.at(-1);assert.equal(sent.payload.pos,1);assert.equal(sent.payload.items.length,2);assert(!JSON.stringify(bridgeCalls).includes(link.token));
    const log=await all(db,'SELECT * FROM guide_form_submissions ORDER BY outcome,reason');
    assert.deepEqual(log.map(l=>[l.outcome,l.reason]),[['ACCEPTED',null],['REJECTED','GUIDE'],['REJECTED','POS']]);
    assert(log.every(l=>/^[a-f0-9]{64}$/.test(l.ip_hmac)&&l.link_id===link.link.id));assert(!JSON.stringify(log).includes('Guide Fiktif'));
  });
  await check('busy spreadsheet returns 503 and records nothing',async()=>{
    busy=true;const before=(await one(db,'SELECT count(*)::int n FROM guide_form_submissions')).n;
    const r=await invoke('submit',{token:link.token,evaluations:[evaluation()]});busy=false;
    assert.equal(r.status,503);assert.match(r.data.error,/sibuk/);assert.equal((await one(db,'SELECT count(*)::int n FROM guide_form_submissions')).n,before);
  });
  await check('rate limits are atomic per IP and per link in PostgreSQL',async()=>{
    const second=await atomic(()=>visitRoutes({db,user:manager,p:['visits','links'],method:'POST',body:{action:'create',pos:3},url:new URL('https://x.invalid/')},{has,audit}));
    const calls=bridgeCalls.length;let last;
    for(let i=0;i<61;i++)last=await invoke('context',{token:second.token},`198.51.100.${i%250}`);
    assert.equal(last.status,429);assert.equal(bridgeCalls.length-calls,60);
    const ipCalls=bridgeCalls.length;for(let i=0;i<60;i++)await invoke('context',{token:'e'.repeat(64)},'203.0.113.99');
    assert.equal((await invoke('context',{token:link.token},'203.0.113.99')).status,429);assert.equal(bridgeCalls.length,ipCalls);
  });
  await check('revoked links stop immediately',async()=>{
    const current=await one(db,'SELECT * FROM guide_form_links WHERE id=?',link.link.id);
    await atomic(()=>visitRoutes({db,user:manager,p:['visits','links'],method:'POST',body:{action:'revoke',pos:1,id:current.id,row_version:current.row_version},url:new URL('https://x.invalid/')},{has,audit}));
    assert.equal((await invoke('submit',{token:link.token,evaluations:[evaluation()]},'192.0.2.200')).status,404);
    assert.equal((await one(db,'SELECT share_token FROM guide_form_links WHERE id=?',link.link.id)).share_token,null);
  });

  // Snapshot portal-api hasil build-visits-deploy.mjs.
  let gateway=shim(readFileSync(new URL('../supabase/deploy/portal-api/index.ts',import.meta.url),'utf8'));
  assert(gateway.includes('visitsBridgeRequest'),'Jalankan scripts/build-visits-deploy.mjs lebih dulu.');
  const api=await import(`data:text/javascript;base64,${Buffer.from(gateway+'\nexport {routeOperation,visitsBridgeRequest,AppError};').toString('base64')}`);
  await check('patched gateway keeps visits errors as gateway AppError statuses',async()=>{
    await assert.rejects(atomic(()=>api.routeOperation({db,user:itAdmin,path:'visits/links',method:'GET',body:{},query:''})),e=>e instanceof api.AppError&&e.status===403);
    await assert.rejects(atomic(()=>api.routeOperation({db,user:manager,path:'visits/links',method:'POST',body:{action:'create',pos:2},query:''})),e=>e instanceof api.AppError&&e.status===422);
    const view=await atomic(()=>api.routeOperation({db,user:manager,path:'visits/links',method:'GET',body:{},query:''}));assert.equal(view.items.length,2);
    const activity=await atomic(()=>api.routeOperation({db,user:leader,path:'visits/activity',method:'GET',body:{},query:''}));assert.equal(activity.items[0].accepted_24h,1);
  });
  await check('patched gateway calls the bridge outside write transactions and audits guide changes',async()=>{
    const env=globalThis.Deno.env.toObject(),identity={},storage={};
    const auth=user=>async database=>{assert(inTx);return one(database,'SELECT * FROM users WHERE id=?',user.id);};
    statements.length=0;
    const overview=await api.visitsBridgeRequest(client,identity,storage,{path:'visits/overview',method:'GET',body:{},query:'from=2026-10-01&to=2026-10-31'},env,auth(leader));
    assert.deepEqual(overview.payload,{from:'2026-10-01',to:'2026-10-31'});assert(!statements.some(s=>/pg_advisory/i.test(s)),'baca tidak memakai kunci global');
    await assert.rejects(api.visitsBridgeRequest(client,identity,storage,{path:'visits/guides',method:'POST',body:{guideName:'Guide Baru',kategori:'Asing',regu:'A1',aktif:true},query:''},env,auth(leader)),e=>e instanceof api.AppError&&e.status===403);
    await assert.rejects(api.visitsBridgeRequest(client,identity,storage,{path:'visits/overview',method:'GET',body:{},query:''},env,auth(itAdmin)),e=>e instanceof api.AppError&&e.status===403);
    const saved=await api.visitsBridgeRequest(client,identity,storage,{path:'visits/guides',method:'POST',body:{guideName:'Guide Baru',kategori:'Asing',regu:'A1',aktif:true},query:''},env,auth(superAdmin));
    assert.equal(saved.guideId,'G-315');assert.equal((await one(db,"SELECT action FROM audit_events WHERE object_type='visit_guides' AND object_key='G-315'")).action,'CREATE');
    const fetchBefore=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('offline');};
    try{await assert.rejects(api.visitsBridgeRequest(client,identity,storage,{path:'visits/records',method:'GET',body:{},query:'from=2026-10-01&to=2026-10-31'},env,auth(manager)),e=>e instanceof api.AppError&&e.status===503&&/tidak dapat diakses/.test(e.message));}
    finally{globalThis.fetch=fetchBefore;}
  });
  console.log(`${checks} visits PostgreSQL checks passed.`);
}finally{globalThis.fetch=realFetch;globalThis.Deno=priorDeno;delete globalThis.__visitsFixture;await pg.close();}
