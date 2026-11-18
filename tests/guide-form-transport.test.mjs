import test from 'node:test';
import assert from 'node:assert/strict';
import {handleGuideForm} from '../site-info/lib/guide-form.mjs';
const env={PORTAL_ORIGIN:'https://portal.test',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'server-only-secret'};
const token='a'.repeat(64),id='0b8f7f5e-5d0c-4c1e-9a45-1f1e7a8b9c0d';
const request=(path='context',extra={},headers={})=>new Request(`https://portal.test/api/guide-form/${path}`,{method:'POST',headers:{Origin:'https://portal.test','Content-Type':'application/json','CF-Connecting-IP':'203.0.113.7',...headers},body:JSON.stringify({token,...extra})});
const fail=()=>{throw new Error('Must not call upstream');};

test('guide form proxy calls only the fixed function with the server secret and strips extra fields',async()=>{
 let calls=0;const response=await handleGuideForm(request(),env,async(url,options)=>{
  calls++;assert.equal(url,'https://example.supabase.co/functions/v1/guide-form');assert.equal(options.headers.apikey,env.SUPABASE_SECRET_KEY);assert.equal(options.redirect,'manual');
  const body=JSON.parse(options.body);assert.equal(body.client_ip,'203.0.113.7');assert.equal(body.operation,'context');assert.equal(body.body.token,token);
  return Response.json({ok:true,result:{pos:1,label:'Pos 1 — Pintu Masuk',serverTime:'2026-11-03T00:00:00.000Z',guides:[{guideId:'G-001',guideName:'Guide Fiktif',kategori:'Asing',regu:'A1',secret:'must-not-leak'}],token_hash:'must-not-leak'}});
 });
 assert.equal(calls,1);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
 const text=await response.text();assert(!text.includes('must-not-leak'));assert.equal(JSON.parse(text).guides[0].guideId,'G-001');assert.equal(JSON.parse(text).penilaian,undefined,'backend lama tetap didukung');
});

test('context carries scoring choices, assessors and instructions through the production proxy without internal fields',async()=>{
 const penilaian={versi:2,teguranMaks:2,catatanMin:3,
  teguran:[{kode:'antrean',label:'Tidak tertib antrean',perluCatatan:false}],
  berat:[{kode:'kasar',label:'Berkata kasar',perluCatatan:true}],apresiasi:[],
  petugas:[{id,nama:'Petugas Uji',keterangan:'Pos 1'}],petunjuk:{idCard:'Kartu terlihat.',seragam:'Atribut lengkap.'}};
 const internal={...structuredClone(penilaian),pot_id:20,secret:'must-not-leak'};
 internal.teguran[0].created_by='must-not-leak';internal.petugas[0].private_note='must-not-leak';internal.petunjuk.private_note='must-not-leak';
 const response=await handleGuideForm(request(),env,async()=>Response.json({ok:true,result:{pos:1,label:'Pos 1',guides:[],penilaian:internal}}));
 assert.equal(response.status,200);const data=await response.json();assert.deepEqual(data.penilaian,penilaian);
 assert(!JSON.stringify(data).includes('must-not-leak'));assert.equal(data.penilaian.pot_id,undefined);
 // Daftar aktif kosong harus tetap kosong; HP tidak boleh beralih ke contoh bawaan.
 const empty={...penilaian,teguran:[],berat:[],petugas:[]};
 const responseEmpty=await handleGuideForm(request(),env,async()=>Response.json({ok:true,result:{pos:3,label:'Pos 3',guides:[],penilaian:empty}}));
 assert.equal(responseEmpty.status,200);assert.deepEqual((await responseEmpty.json()).penilaian,empty);
 // guide-form yang menyimpan Etika mengirim rentangnya; tanda ini diteruskan tanpa isian lain.
 const withEtika={...penilaian,etika:{min:-10,max:10}};
 const responseEtika=await handleGuideForm(request(),env,async()=>Response.json({ok:true,result:{pos:1,label:'Pos 1',guides:[],penilaian:{...structuredClone(withEtika),etika:{min:-10,max:10,secret:'must-not-leak'}}}}));
 assert.equal(responseEtika.status,200);const etikaData=await responseEtika.json();assert.deepEqual(etikaData.penilaian,withEtika);assert(!JSON.stringify(etikaData).includes('must-not-leak'));
 assert.equal(data.penilaian.etika,undefined,'guide-form versi sebelumnya: tanpa tanda Etika');
});

test('malformed scoring context is retryable instead of silently dropping configured choices',async()=>{
 const valid={versi:2,teguranMaks:2,catatanMin:3,teguran:[],berat:[],apresiasi:[],petugas:[],petunjuk:{idCard:'ID',seragam:'Seragam'}};
 for(const patch of [{versi:1},{teguran:null},{berat:{}},{apresiasi:'secret'},{petugas:null},{petunjuk:null},{teguran:[null]},{petugas:[{id}]},{teguranMaks:'2'},{catatanMin:'3'},
  {etika:null},{etika:{min:-10}},{etika:{min:'-10',max:10}},{etika:{min:0,max:10}},{etika:{min:-10,max:0}}]){
  const response=await handleGuideForm(request(),env,async()=>Response.json({ok:true,result:{pos:1,label:'Pos 1',guides:[],penilaian:{...valid,...patch}}}));
  assert.equal(response.status,503,JSON.stringify(patch));assert(!JSON.stringify(await response.json()).includes('secret'));
 }
});
test('submit receipt keeps only confirmation fields',async()=>{
 const response=await handleGuideForm(request('submit',{evaluations:[{evaluationId:id}]}),env,async()=>Response.json({ok:true,result:{serverTime:'x',accepted:[{evaluationId:id,duplicate:false,row:12},{evaluationId:'bukan'}],rejected:[{evaluationId:id,errors:['jeda'],terlaluCepat:true,internal:'must-not-leak'}]}}));
 const data=await response.json();assert.deepEqual(data.accepted,[{evaluationId:id,synced:true,duplicate:false}]);assert.equal(data.rejected[0].terlaluCepat,true);assert(!JSON.stringify(data).includes('must-not-leak'));
});
test('cross-origin, cross-site, wrong method, path, type and token never reach the function',async()=>{
 assert.equal((await handleGuideForm(request('context',{},{Origin:'https://attacker.test'}),env,fail)).status,403);
 assert.equal((await handleGuideForm(request('context',{},{'Sec-Fetch-Site':'cross-site'}),env,fail)).status,403);
 assert.equal((await handleGuideForm(request('context',{},{'Content-Type':'text/plain'}),env,fail)).status,415);
 assert.equal((await handleGuideForm(request('context',{token:'z'}),env,fail)).status,404);
 assert.equal((await handleGuideForm(new Request('https://portal.test/api/guide-form/context'),env,fail)).status,405);
 assert.equal((await handleGuideForm(request('records'),env,fail)).status,404);
 assert.equal((await handleGuideForm(new Request('https://portal.test/api/guide-form/context?x=1',{method:'POST'}),env,fail)).status,404);
});
test('missing client IP and oversized batches are rejected before upstream',async()=>{
 const missing=request();missing.headers.delete('CF-Connecting-IP');
 assert.equal((await handleGuideForm(missing,env,fail)).status,400);
 assert.equal((await handleGuideForm(request('submit',{evaluations:[{catatan:'x'.repeat(25000)}]}),env,fail)).status,413);
});
test('busy and rate-limit answers stay retryable; unknown failures are redacted',async()=>{
 for(const [status,error] of [[429,'Terlalu banyak kiriman.'],[503,'Kiriman sedang diproses. Coba lagi sebentar.'],[404,'Tautan pos tidak aktif.'],[422,'Periksa isian.']]){
  const r=await handleGuideForm(request(),env,async()=>Response.json({error},{status}));assert.equal(r.status,status);assert.equal((await r.json()).error,error);
 }
 const leaked=await handleGuideForm(request(),env,async()=>Response.json({error:'database secret details'},{status:503}));assert.equal(leaked.status,503);assert(!(await leaked.text()).includes('secret'));
 const crashed=await handleGuideForm(request(),env,async()=>Response.json({error:'database secret details'},{status:500}));assert.equal(crashed.status,503);assert(!(await crashed.text()).includes('secret'));
 const thrown=await handleGuideForm(request(),env,async()=>{throw new Error('timeout');});assert.equal(thrown.status,503);
});
