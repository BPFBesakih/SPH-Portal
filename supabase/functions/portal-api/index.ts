import {publicQuickReport,takeQuickReportSlot} from '../_shared/portal/quick-reports.mjs';
import {withSupabase} from 'npm:@supabase/server@1';
import postgres from 'npm:postgres@3.4.7';
import {createHash,randomUUID} from 'node:crypto';
import {AppError,assert,one,run,audit,now} from '../_shared/portal/db.mjs';
import {createIdentity} from '../_shared/portal/identity.mjs';
import {createDriveStorage} from '../_shared/portal/drive.mjs';
import {routeOperation} from '../_shared/portal/router.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash=value=>createHash('sha256').update(value).digest('hex');
let pool;
function database(env){
 if(!pool){
  const url=new URL(env.SUPABASE_DB_URL);assert(['postgres:','postgresql:'].includes(url.protocol),'Database belum dikonfigurasi.',503);
  pool=postgres(env.SUPABASE_DB_URL,{prepare:false,max:1,idle_timeout:20,connect_timeout:10,onnotice:()=>{},
   types:{safeBigint:{to:20,from:[20],serialize:String,parse:value=>{const number=Number(value);assert(Number.isSafeInteger(number),'Nilai database di luar batas.',503);return number;}}}});
 }return pool;
}
async function readBody(req){
 assert(req.headers.get('content-type')?.toLowerCase().startsWith('application/json')&&req.body,'Gunakan JSON.',415);
 const reader=req.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>14*1024*1024+65536){await reader.cancel();throw new AppError(413,'Permintaan terlalu besar.');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 let b;try{b=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new AppError(400,'JSON tidak valid.');}
 assert(b&&typeof b==='object'&&!Array.isArray(b),'Permintaan tidak valid.',400);return b;
}
function adapter(sql,identity,storage){return {inTransaction:true,query:(statement,values=[])=>sql.unsafe(statement,values),identity,storage};}
async function transaction(client,identity,storage,work,mutating=true){
 return client.begin(async sql=>{
  await sql.unsafe("SET LOCAL search_path=portal,pg_catalog; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='40s';");
  // Serialize writes before reading authorization or scheduling state. Every
  // domain mutation and its audit record commit on the same connection.
  if(mutating)await sql.unsafe('SELECT pg_advisory_xact_lock(734829610160009)');
  return work(adapter(sql,identity,storage));
 });
}
async function recover(client,identity,storage,b,requestId){
 assert(typeof b.client_ip==='string'&&b.client_ip.length<=45&&/^[a-f0-9:.]+$/i.test(b.client_ip),'Permintaan tidak valid.',400);
 const input=b.body;assert(typeof input?.token==='string'&&/^[a-f0-9]{48}$/.test(input.token)&&typeof input.new_password==='string'&&input.new_password.length>=6&&input.new_password.length<=128,'Kredensial pemulihan atau password tidak valid.',422);
 // Consume the token and revoke sessions before the external Auth update. An
 // uncertain Auth result never restores a used token or re-enables old sessions.
 const allowed=await transaction(client,identity,storage,async db=>{
  const slot=(await db.query('SELECT public.portal_take_login_slot($1,$2) result',[hash(`username\0recovery:${input.token}`),hash(`ip\0${b.client_ip}`)]))[0].result;
  return slot===true;
 });
 assert(allowed,'Terlalu banyak percobaan. Coba lagi 15 menit kemudian.',429);
 const target=await transaction(client,identity,storage,async db=>{
  const token=await one(db,'SELECT * FROM password_reset_tokens WHERE token_hash=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>? FOR UPDATE',hash(input.token),now());
  assert(token,'Kredensial pemulihan tidak valid atau kedaluwarsa.',422);
  const user=await one(db,"SELECT * FROM users WHERE id=? AND status='ACTIVE'",token.user_id);assert(user,'Kredensial pemulihan tidak valid atau kedaluwarsa.',422);
  await run(db,'UPDATE password_reset_tokens SET consumed_at=? WHERE id=?',now(),token.id);
  await run(db,'UPDATE public.app_users SET must_change_password=true,row_version=row_version+1 WHERE id=?',user.id);
  await audit(db,{id:user.id,request_id:requestId},'RECOVERY_CONSUMED','users',user.id);
  return user;
 });
 let updated;try{updated=await identity.setPassword(target.id,input.new_password);}catch{throw new AppError(503,'Hasil pemulihan belum dapat dikonfirmasi. Hubungi administrator untuk kredensial pemulihan baru.');}
 assert(updated?.id===target.id,'Hasil pemulihan belum dapat dikonfirmasi. Hubungi administrator.',503);
 await transaction(client,identity,storage,async db=>{
  await run(db,'UPDATE public.app_users SET must_change_password=false,row_version=row_version+1,password_changed_at=? WHERE id=?',now(),target.id);
  await audit(db,{id:target.id,request_id:requestId},'PASSWORD_RECOVERED','users',target.id);
 });return {ok:true};
}
export default {
 fetch:withSupabase({auth:'secret'},async req=>{
  const requestId=randomUUID();let identity,storage,workCompleted=false;
  try{
   assert(req.method==='POST','Metode tidak diizinkan.',405);
   const b=await readBody(req),env=Deno.env.toObject();identity=createIdentity(env);storage=createDriveStorage(env,undefined,{module:b.action==='quick-report'?'patroli':undefined});
   const client=database(env);
   if(b.action==='quick-report'){
    assert(['context','submit'].includes(b.operation)&&b.body&&typeof b.body==='object'&&!Array.isArray(b.body),'Permintaan tidak valid.',400);
    const allowed=await transaction(client,identity,storage,db=>takeQuickReportSlot(db,b.client_ip,b.operation));
    assert(allowed,'Terlalu banyak percobaan. Coba lagi beberapa menit kemudian.',429);
    const result=await transaction(client,identity,storage,async db=>{const result=await publicQuickReport(db,b.operation,b.body,undefined,requestId);await storage.finalize();workCompleted=true;return result;});
    return Response.json({ok:true,result},{headers:{'Cache-Control':'no-store'}});
   }
   if(b.action==='health'){
    const ready=await transaction(client,identity,storage,async db=>{
     const r=await one(db,"SELECT count(*)::integer total,count(*) FILTER(WHERE rowsecurity)::integer protected FROM pg_catalog.pg_tables WHERE schemaname='portal'");
     return r.total>=65&&r.protected===r.total;
    },false);
    assert(ready,'Modul portal belum siap.',503);return Response.json({ok:true,healthy:true,revision:'20261016.1'},{headers:{'Cache-Control':'no-store'}});
   }
   if(b.action==='recover')return Response.json(await recover(client,identity,storage,b,requestId),{headers:{'Cache-Control':'no-store'}});
   assert(b.action==='operation'&&typeof b.access_token==='string'&&b.access_token.length<=8192&&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(b.access_token),'Sesi berakhir. Silakan masuk kembali.',401);
   assert(typeof b.session_hash==='string'&&/^[a-f0-9]{64}$/.test(b.session_hash)&&typeof b.lease_hash==='string'&&/^[a-f0-9]{64}$/.test(b.lease_hash),'Sesi berakhir. Silakan masuk kembali.',401);
   assert(Number.isSafeInteger(b.session_version)&&b.session_version>0,'Sesi berakhir. Silakan masuk kembali.',401);
   const verified=await identity.verify(b.access_token);assert(uuid.test(verified?.id),'Sesi berakhir. Silakan masuk kembali.',401);
   const claims=JSON.parse(atob(b.access_token.split('.')[1].replaceAll('-','+').replaceAll('_','/')));assert(claims.sub===verified.id&&uuid.test(claims.session_id),'Sesi berakhir. Silakan masuk kembali.',401);
   const result=await transaction(client,identity,storage,async db=>{
    const user=await one(db,"SELECT * FROM users WHERE id=? AND status='ACTIVE'",verified.id);assert(user,'Akun tidak aktif.',401);user.request_id=requestId;
    const session=await one(db,'SELECT id FROM portal_auth_private.web_sessions WHERE token_hash=? AND user_id=? AND auth_session_id=? AND revoked_at IS NULL AND expires_at>clock_timestamp() AND lease_hash=? AND lease_until>clock_timestamp() AND version=?',b.session_hash,user.id,claims.session_id,b.lease_hash,b.session_version);
    assert(session,'Sesi berakhir. Silakan masuk kembali.',401);
    assert(!user.employee_id||(await one(db,'SELECT is_active FROM employees WHERE id=?',user.employee_id))?.is_active===1,'Profil pegawai tidak aktif.',401);
    assert(typeof b.query==='string'&&b.query.length<=2048&&b.body&&typeof b.body==='object'&&!Array.isArray(b.body),'Permintaan tidak valid.',400);
    const result=await routeOperation({db,user,path:b.path,method:b.method,body:b.body,query:b.query});workCompleted=true;return result;
   },b.method!=='GET');
   return Response.json({ok:true,result},{headers:{'Cache-Control':'no-store','X-SPH-Modules-Revision':'20261016.1'}});
  }catch(error){
   if(!workCompleted){await storage?.rollback();await identity?.rollback();}
   if(error instanceof AppError&&error.details?.service==='google_drive')console.warn(JSON.stringify({event:'storage_error',request_id:requestId,stage:error.details.stage,upstream_status:error.details.upstream_status,reason:error.details.reason}));
   const code=error?.code;
   const status=error instanceof AppError?error.status:['23505','40001','40P01','55P03'].includes(code)?409:['23502','23503','23514','22P02'].includes(code)?422:503;
   const message=error instanceof AppError?error.message:status===409?'Data atau proses sudah berubah. Muat ulang sebelum mencoba kembali.':status===422?'Relasi atau nilai data tidak valid.':'Modul portal belum dapat diakses.';
   return Response.json({ok:false,error:message,request_id:requestId},{status,headers:{'Cache-Control':'no-store'}});
  }
 }),
};
