// Formulir penilaian guide (tanpa login) — dipanggil Pages Function /api/guide-form/*
// dengan secret server. Tidak memakai kunci global pg_advisory_xact_lock, dan
// panggilan ke jembatan Google Spreadsheet berjalan DI LUAR transaksi database
// (ATR-KM-03, temuan T4): transaksi hanya untuk batas frekuensi, token, dan catatan kiriman.
import {withSupabase} from 'npm:@supabase/server@1';
import postgres from 'npm:postgres@3.4.7';
import {randomUUID} from 'node:crypto';
import {AppError,assert} from '../_shared/portal/db.mjs';
import {takeGuideFormIpSlot,admitGuideForm,guideFormContext,guideFormReceipt,recordGuideFormResult,ipFingerprint} from '../_shared/portal/guide-form.mjs';
import {bridgeConfig,callBridge} from '../_shared/portal/visits-bridge.mjs';
let pool;
async function transaction(client,work){return client.begin(async sql=>{
 await sql.unsafe("SET LOCAL search_path=portal,pg_catalog; SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='15s';");
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
  assert(b&&['context','submit'].includes(b.operation)&&b.body&&typeof b.body==='object'&&!Array.isArray(b.body),'Permintaan tidak valid.',400);
  const env=Deno.env.toObject();
  if(!pool)pool=postgres(env.SUPABASE_DB_URL,{prepare:false,max:1,idle_timeout:20,connect_timeout:10,onnotice:()=>{}});
  const bridge=bridgeConfig(env);
  const ipOk=await transaction(pool,db=>takeGuideFormIpSlot(db,b.operation,b.client_ip,b.body));
  assert(ipOk,'Terlalu banyak kiriman. Coba lagi beberapa menit kemudian.',429);
  const admitted=await transaction(pool,db=>admitGuideForm(db,b.operation,b.body));
  assert(!admitted.limited,'Terlalu banyak kiriman. Coba lagi beberapa menit kemudian.',429);
  if(b.operation==='context'){
   const data=await callBridge(bridge,'form.context',{},{timeoutMs:30000});
   return Response.json({ok:true,result:guideFormContext(admitted.link,data)},{headers:{'Cache-Control':'no-store'}});
  }
  const data=admitted.items.length?await callBridge(bridge,'evaluations.submit',{pos:admitted.link.pos,items:admitted.items},{timeoutMs:30000}):{accepted:[],rejected:[]};
  const receipt=guideFormReceipt(admitted,data);
  // Penilaian sudah diterima spreadsheet; kegagalan mencatat log tidak boleh
  // membuat HP mengulang kiriman yang sebenarnya sudah masuk.
  try{await transaction(pool,db=>recordGuideFormResult(db,admitted.link,receipt,ipFingerprint(b.client_ip,env.VISITS_IP_HMAC_KEY)));}
  catch{console.warn(JSON.stringify({event:'guide_form_log_failed',request_id:requestId}));}
  return Response.json({ok:true,result:receipt},{headers:{'Cache-Control':'no-store'}});
 }catch(error){
  if(error instanceof AppError&&error.details?.bridge_code)console.warn(JSON.stringify({event:'visits_bridge_error',request_id:requestId,code:error.details.bridge_code}));
  const status=error instanceof AppError?error.status:['23505','40001','40P01','55P03'].includes(error?.code)?409:['23502','23503','23514','22P02'].includes(error?.code)?422:503;
  return Response.json({ok:false,error:error instanceof AppError?error.message:'Kiriman belum dapat dikonfirmasi. HP akan mencoba lagi.',request_id:requestId},{status,headers:{'Cache-Control':'no-store'}});
 }
})};
