// Halaman absen /absen/ (tanpa login) — dipanggil Pages Function /api/attendance-form/*
// dengan secret server. TIDAK memakai kunci global portal: penyimpanan absen
// diserialkan per pegawai (pg_advisory_xact_lock(hashtextextended('portal.attendance:<id>',0))),
// sehingga lonjakan absen pagi tidak menahan transaksi portal lain. Selfie diunggah ke
// Google Drive (folder SPH-Portal-Absensi) DI LUAR transaksi; bila penyimpanan absen
// gagal, berkasnya dihapus lagi. Retensi selfie 90 hari berjalan sesudah balasan dikirim
// (sesudah absen baru atau saat halaman absen dibuka di HP aktif, paling sering 6 jam sekali),
// dan bisa dijadwalkan lewat operasi `retention` (lihat docs/ABSENSI.md).
import {withSupabase} from 'npm:@supabase/server@1';
import postgres from 'npm:postgres@3.4.7';
import {randomUUID} from 'node:crypto';
import {AppError,assert} from '../_shared/portal/db.mjs';
import {createDriveStorage} from '../_shared/portal/drive.mjs';
import {attendanceFormRequest,attendanceRetentionDue,runAttendanceRetention} from '../_shared/portal/attendance-form.mjs';
let pool;
async function transaction(client,work,options={}){return client.begin(async sql=>{
 await sql.unsafe("SET LOCAL search_path=portal,pg_catalog; SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='15s';");
 if(options?.lock)await sql.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[options.lock]);
 return work({inTransaction:true,query:(statement,values=[])=>sql.unsafe(statement,values)});
});}
function drivePhotos(env){
 const storage=createDriveStorage(env,undefined,{module:'absensi'});
 return {put:async(bytes,mime)=>({key:await storage.put(bytes,mime)}),discard:key=>storage.remove(key),remove:key=>storage.remove(key)};
}
// Rincian galat yang boleh sampai ke HP (untuk jam HP dan absen di luar titik).
function safeDetails(details){
 if(!details||typeof details!=='object')return undefined;
 const out={};
 if(typeof details.code==='string'&&/^[A-Z_]{2,30}$/.test(details.code))out.code=details.code;
 if(typeof details.server_time==='string'&&details.server_time.length<=30)out.server_time=details.server_time;
 if(typeof details.point_name==='string')out.point_name=details.point_name.slice(0,80);
 if(Number.isFinite(details.distance_m))out.distance_m=Math.round(details.distance_m);
 return Object.keys(out).length?out:undefined;
}
const busyCodes=['23505','40001','40P01','55P03'];
// Retensi di latar belakang. Kegagalannya tidak memengaruhi absen; dicoba lagi pada pemicu berikutnya.
function retention(runTx,env,requestId,force=false){
 return runAttendanceRetention({runTx,photos:drivePhotos(env),force}).then(result=>{
  if(!result.skipped)console.log(JSON.stringify({event:'attendance_retention',request_id:requestId,deleted:result.deleted,error:result.error||null}));
  return result;
 },()=>{console.warn(JSON.stringify({event:'attendance_retention_failed',request_id:requestId}));return {skipped:false,deleted:0,error:'Penghapusan selfie lama belum berhasil.'};});
}
const background=task=>{const runtime=Reflect.get(globalThis,'EdgeRuntime');if(runtime&&typeof runtime.waitUntil==='function'){runtime.waitUntil(task);return true;}return false;};
export default {fetch:withSupabase({auth:'secret'},async req=>{
 const requestId=randomUUID();
 try{
  assert(req.method==='POST','Metode tidak diizinkan.',405);
  assert(req.headers.get('content-type')?.toLowerCase().startsWith('application/json')&&req.body,'Gunakan JSON.',415);
  const reader=req.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>480000){await reader.cancel();throw new AppError(413,'Permintaan terlalu besar.');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let b;try{b=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new AppError(400,'JSON tidak valid.');}
  assert(b&&typeof b.operation==='string'&&b.body&&typeof b.body==='object'&&!Array.isArray(b.body),'Permintaan tidak valid.',400);
  const env=Deno.env.toObject();
  if(!pool)pool=postgres(env.SUPABASE_DB_URL,{prepare:false,max:1,idle_timeout:20,connect_timeout:10,onnotice:()=>{}});
  const runTx=(work,options)=>transaction(pool,work,options);
  // Operasi terjadwal (pg_cron + pg_net). Hanya pemegang secret key yang dapat memanggil fungsi
  // ini, dan gateway Pages tidak pernah meneruskan `retention` dari HP. Jeda 6 jam tetap berlaku
  // kecuali force=true; lease mencegah dua proses bersamaan.
  if(b.operation==='retention'){
   const task=retention(runTx,env,requestId,b.body.force===true);
   if(background(task))return Response.json({ok:true,result:{started:true}},{headers:{'Cache-Control':'no-store'}});
   return Response.json({ok:true,result:await task},{headers:{'Cache-Control':'no-store'}});
  }
  const result=await attendanceFormRequest({action:b.operation,body:b.body,clientIp:b.client_ip,runTx,photos:drivePhotos(env),requestId});
  if(attendanceRetentionDue(b.operation,result))background(retention(runTx,env,requestId));
  return Response.json({ok:true,result},{headers:{'Cache-Control':'no-store'}});
 }catch(error){
  // Kunci per pegawai sibuk/benturan bersamaan: 503 supaya HP mencoba lagi.
  const status=error instanceof AppError?error.status:busyCodes.includes(error?.code)?503:['23502','23503','23514','22P02'].includes(error?.code)?422:503;
  if(!(error instanceof AppError))console.warn(JSON.stringify({event:'attendance_form_error',request_id:requestId,code:typeof error?.code==='string'?error.code:null}));
  const message=error instanceof AppError?error.message:busyCodes.includes(error?.code)?'Absen sedang diproses bersamaan. Coba kirim lagi.':'Absen belum dapat dikonfirmasi. Coba kirim lagi.';
  const details=error instanceof AppError?safeDetails(error.details):undefined;
  return Response.json({ok:false,error:message,request_id:requestId,...(details?{details}:{})},{status,headers:{'Cache-Control':'no-store'}});
 }
})};
