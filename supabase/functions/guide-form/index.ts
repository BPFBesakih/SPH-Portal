// Formulir penilaian guide (tanpa login) — dipanggil Pages Function /api/guide-form/*
// dengan secret server. Tidak memakai kunci global portal: penerimaan penilaian
// diserialkan dengan kunci transaksi khusus modul kunjungan, supaya pengaman jeda
// dan koreksi melihat kiriman pos lain. Penyalinan ke spreadsheet tahunan berjalan
// SESUDAH balasan dikirim (EdgeRuntime.waitUntil), di luar transaksi database.
import {withSupabase} from 'npm:@supabase/server@1';
import postgres from 'npm:postgres@3.4.7';
import {randomUUID} from 'node:crypto';
import {AppError,assert} from '../_shared/portal/db.mjs';
import {takeGuideFormIpSlot,admitGuideForm,guideFormContext,submitGuideForm,guideFormReceipt,recordGuideFormResult,ipFingerprint} from '../_shared/portal/guide-form.mjs';
import {syncVisitSheetAfterSubmit,visitSheetConfig} from '../_shared/portal/visit-sheets.mjs';
let pool;
async function transaction(client,work,ingest=false){return client.begin(async sql=>{
 await sql.unsafe("SET LOCAL search_path=portal,pg_catalog; SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='15s';");
 if(ingest)await sql.unsafe("SELECT pg_advisory_xact_lock(hashtextextended('portal.visits.guide_evaluations',0))");
 return work({inTransaction:true,query:(statement,values=[])=>sql.unsafe(statement,values)});
});}
const busyCodes=['23505','40001','40P01','55P03'];
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
  const ipOk=await transaction(pool,db=>takeGuideFormIpSlot(db,b.operation,b.client_ip,b.body));
  assert(ipOk,'Terlalu banyak kiriman. Coba lagi beberapa menit kemudian.',429);
  // Batas per tautan, aturan terima, dan catatan kiriman dalam SATU transaksi:
  // HP hanya menerima ✅ bila penilaiannya benar-benar tersimpan.
  const outcome=await transaction(pool,async db=>{
   const admitted=await admitGuideForm(db,b.operation,b.body);
   if(admitted.limited)return admitted;
   if(b.operation==='context')return {context:await guideFormContext(db,admitted.link)};
   const result=await submitGuideForm(db,admitted);
   await recordGuideFormResult(db,admitted,result,ipFingerprint(b.client_ip,env.VISITS_IP_HMAC_KEY));
   return {receipt:guideFormReceipt(admitted,result),fresh:result.accepted.some(a=>!a.duplicate)};
  },b.operation==='submit');
  assert(!outcome.limited,'Terlalu banyak kiriman. Coba lagi beberapa menit kemudian.',429);
  if(outcome.context)return Response.json({ok:true,result:outcome.context},{headers:{'Cache-Control':'no-store'}});
  if(outcome.fresh&&visitSheetConfig(env).configured){
   // Kegagalan penyalinan tidak memengaruhi kiriman: barisnya tetap menunggu di basis data.
   const task=syncVisitSheetAfterSubmit({runTx:work=>transaction(pool,work),env}).catch(()=>{console.warn(JSON.stringify({event:'visit_sheet_background_failed',request_id:requestId}));});
   const runtime=Reflect.get(globalThis,'EdgeRuntime');
   if(runtime&&typeof runtime.waitUntil==='function')runtime.waitUntil(task);
  }
  return Response.json({ok:true,result:outcome.receipt},{headers:{'Cache-Control':'no-store'}});
 }catch(error){
  // Kunci sibuk/benturan bersamaan: 503 supaya HP mengulang, bukan menganggapnya ditolak.
  const status=error instanceof AppError?error.status:busyCodes.includes(error?.code)?503:['23502','23503','23514','22P02'].includes(error?.code)?422:503;
  if(!(error instanceof AppError))console.warn(JSON.stringify({event:'guide_form_error',request_id:requestId,code:typeof error?.code==='string'?error.code:null}));
  return Response.json({ok:false,error:error instanceof AppError?error.message:busyCodes.includes(error?.code)?'Kiriman sedang diproses bersamaan. HP akan mencoba lagi.':'Kiriman belum dapat dikonfirmasi. HP akan mencoba lagi.',request_id:requestId},{status,headers:{'Cache-Control':'no-store'}});
 }
})};
