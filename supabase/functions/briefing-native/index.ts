import {withSupabase} from 'npm:@supabase/server@1';
import postgres from 'npm:postgres@3.4.7';
import {randomUUID} from 'node:crypto';
import {AppError,assert} from '../_shared/portal/db.mjs';
import {createDriveStorage} from '../_shared/portal/drive.mjs';
import {publicBriefingLink,takeBriefingLinkSlot} from '../_shared/portal/briefings.mjs';

let pool;
async function readBody(req){
  assert(req.headers.get('content-type')?.toLowerCase().startsWith('application/json')&&req.body,'Gunakan JSON.',415);
  const reader=req.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>14*1024*1024+131072){await reader.cancel();throw new AppError(413,'Permintaan terlalu besar.');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let b;try{b=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new AppError(400,'JSON tidak valid.');}
  assert(b&&typeof b==='object'&&!Array.isArray(b),'Permintaan tidak valid.',400);return b;
}
async function transaction(client,storage,work){return client.begin(async sql=>{
  await sql.unsafe("SET LOCAL search_path=portal,pg_catalog; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='40s';");
  await sql.unsafe('SELECT pg_advisory_xact_lock(734829610160009)');
  return work({inTransaction:true,query:(statement,values=[])=>sql.unsafe(statement,values),storage});
});}
export default {fetch:withSupabase({auth:'secret'},async req=>{
  const requestId=randomUUID();let storage,completed=false;
  try{
    assert(req.method==='POST','Metode tidak diizinkan.',405);
    const b=await readBody(req),env=Deno.env.toObject();
    assert(['context','submit'].includes(b.operation)&&b.body&&typeof b.body==='object'&&!Array.isArray(b.body),'Permintaan tidak valid.',400);
    if(!pool)pool=postgres(env.SUPABASE_DB_URL,{prepare:false,max:1,idle_timeout:20,connect_timeout:10,onnotice:()=>{}});
    storage=createDriveStorage(env,undefined,{module:'briefing'});
    const allowed=await transaction(pool,storage,db=>takeBriefingLinkSlot(db,b.client_ip,b.operation));
    assert(allowed,'Terlalu banyak percobaan. Coba lagi beberapa menit kemudian.',429);
    const result=await transaction(pool,storage,async db=>{const result=await publicBriefingLink(db,b.operation,b.body,undefined,requestId);await storage.finalize();completed=true;return result;});
    return Response.json({ok:true,result},{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    if(!completed)await storage?.rollback();
    const status=error instanceof AppError?error.status:['23505','40001','40P01','55P03'].includes(error?.code)?409:['23502','23503','23514','22P02'].includes(error?.code)?422:503;
    const message=error instanceof AppError?error.message:status===409?'Proses berubah. Coba kirim kembali dengan jawaban yang sama.':status===422?'Relasi atau nilai data perlu diperiksa.':'Pengiriman belum dapat dikonfirmasi. Coba kirim kembali.';
    return Response.json({ok:false,error:message,request_id:requestId},{status,headers:{'Cache-Control':'no-store'}});
  }
})};
