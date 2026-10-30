import {withSupabase} from 'npm:@supabase/server@1';
import postgres from 'npm:postgres@3.4.7';
import {randomUUID} from 'node:crypto';
import {AppError,assert} from '../_shared/portal/db.mjs';
import {publicLeaveForm,takeLeaveFormSlot} from '../_shared/portal/leave-form.mjs';
let pool;
async function transaction(client,work){return client.begin(async sql=>{
 await sql.unsafe("SET LOCAL search_path=portal,pg_catalog; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='25s';");
 await sql.unsafe('SELECT pg_advisory_xact_lock(734829610160009)');
 return work({inTransaction:true,query:(statement,values=[])=>sql.unsafe(statement,values)});
});}
export default {fetch:withSupabase({auth:'secret'},async req=>{
 const requestId=randomUUID();
 try{
  assert(req.method==='POST','Metode tidak diizinkan.',405);
  assert(req.headers.get('content-type')?.toLowerCase().startsWith('application/json')&&req.body,'Gunakan JSON.',415);
  const reader=req.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();throw new AppError(413,'Permintaan terlalu besar.');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let b;try{b=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new AppError(400,'JSON tidak valid.');}
  assert(b&&['context','preview','submit'].includes(b.operation)&&b.body&&typeof b.body==='object'&&!Array.isArray(b.body),'Permintaan tidak valid.',400);
  if(!pool)pool=postgres(Deno.env.get('SUPABASE_DB_URL'),{prepare:false,max:1,idle_timeout:20,connect_timeout:10,onnotice:()=>{}});
  const allowed=await transaction(pool,db=>takeLeaveFormSlot(db,b.client_ip,b.operation));
  assert(allowed,'Terlalu banyak percobaan. Coba kembali beberapa menit lagi.',429);
  const result=await transaction(pool,db=>publicLeaveForm(db,b.operation,b.body,requestId));
  return Response.json({ok:true,result},{headers:{'Cache-Control':'no-store'}});
 }catch(error){
  const status=error instanceof AppError?error.status:['23505','40001','40P01','55P03'].includes(error?.code)?409:['23502','23503','23514','22P02'].includes(error?.code)?422:503;
  return Response.json({ok:false,error:error instanceof AppError?error.message:status===409?'Data berubah. Periksa pengajuan lalu coba kembali.':'Pengiriman belum dapat dikonfirmasi. Coba kembali dengan isi yang sama.',request_id:requestId},{status,headers:{'Cache-Control':'no-store'}});
 }
})};
