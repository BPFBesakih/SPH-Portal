import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAttendanceForm} from '../site-info/lib/attendance-form.mjs';

// Gateway Pages untuk halaman absen /absen/: hanya asal, IP, jenis isi, dan ukuran
// yang diperiksa di sini; tanda tangan HP dan selfie diperiksa di Edge attendance-form.
const env={PORTAL_ORIGIN:'https://portal.test',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'server-only-secret'};
const request=(path='context',body={device_id:'d',ts:1,sig:'s',payload:'{}'},headers={})=>new Request(`https://portal.test/api/attendance-form/${path}`,{method:'POST',headers:{Origin:'https://portal.test','Content-Type':'application/json','CF-Connecting-IP':'203.0.113.7',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
const fail=()=>{throw new Error('Must not call upstream');};

test('attendance proxy calls only the fixed function with the server secret, client IP and operation',async()=>{
 let calls=0;
 const response=await handleAttendanceForm(request('submit'),env,async(url,options)=>{
  calls++;assert.equal(url,'https://example.supabase.co/functions/v1/attendance-form');
  assert.equal(options.headers.apikey,env.SUPABASE_SECRET_KEY);assert.equal(options.redirect,'manual');assert(options.signal instanceof AbortSignal);
  const body=JSON.parse(options.body);assert.deepEqual(Object.keys(body).sort(),['body','client_ip','operation']);
  assert.deepEqual([body.operation,body.client_ip,body.body.payload],['submit','203.0.113.7','{}']);
  return Response.json({ok:true,result:{event_id:'e',kind:'IN',duplicate:false}});
 });
 assert.equal(calls,1);assert.equal(response.status,200);
 for(const [name,value] of [['Cache-Control','no-store'],['Referrer-Policy','no-referrer'],['X-Robots-Tag','noindex, nofollow']])assert.equal(response.headers.get(name),value);
 assert.deepEqual(await response.json(),{event_id:'e',kind:'IN',duplicate:false});
 for(const action of ['registration','register','session','session-register','context','search','person'])
  assert.equal((await handleAttendanceForm(request(action),env,async()=>Response.json({ok:true,result:{}}))).status,200,action);
});
test('cross-origin, cross-site, wrong method, path, query and content type never reach the function',async()=>{
 assert.equal((await handleAttendanceForm(request('context',undefined,{Origin:'https://attacker.test'}),env,fail)).status,403);
 assert.equal((await handleAttendanceForm(request('context',undefined,{'Sec-Fetch-Site':'cross-site'}),env,fail)).status,403);
 assert.equal((await handleAttendanceForm(request('context',undefined,{'Content-Type':'text/plain'}),env,fail)).status,415);
 assert.equal((await handleAttendanceForm(new Request('https://portal.test/api/attendance-form/context'),env,fail)).status,405);
 assert.equal((await handleAttendanceForm(request('photos'),env,fail)).status,404);
 assert.equal((await handleAttendanceForm(new Request('https://portal.test/api/attendance-form/context?x=1',{method:'POST'}),env,fail)).status,404);
 assert.equal((await handleAttendanceForm(new Request('https://other.test/api/attendance-form/context',{method:'POST',headers:{Origin:'https://other.test','Content-Type':'application/json','CF-Connecting-IP':'203.0.113.7'},body:'{}'}),env,fail)).status,403);
});
test('missing client IP, broken JSON and oversized selfies are rejected before upstream',async()=>{
 const missing=request();missing.headers.delete('CF-Connecting-IP');
 assert.equal((await handleAttendanceForm(missing,env,fail)).status,400);
 assert.equal((await handleAttendanceForm(request('context',undefined,{'CF-Connecting-IP':'bukan ip'}),env,fail)).status,400);
 assert.equal((await handleAttendanceForm(request('context','{rusak'),env,fail)).status,400);
 assert.equal((await handleAttendanceForm(request('context','[1]'),env,fail)).status,400);
 assert.equal((await handleAttendanceForm(request('submit',{payload:'x'.repeat(470000)}),env,fail)).status,413);
});
test('known errors keep their message and only whitelisted details; unknown failures are redacted',async()=>{
 const upstream=(status,body)=>async()=>Response.json(body,{status});
 let r=await handleAttendanceForm(request('submit'),env,upstream(422,{ok:false,error:'Anda 420 m dari Titik Kantor, di luar titik absen.',details:{code:'OUTSIDE_POINT',point_name:'Titik Kantor',distance_m:420.4,secret:'must-not-leak'}}));
 assert.equal(r.status,422);let data=await r.json();
 assert.deepEqual(data,{error:'Anda 420 m dari Titik Kantor, di luar titik absen.',details:{code:'OUTSIDE_POINT',point_name:'Titik Kantor',distance_m:420}});
 r=await handleAttendanceForm(request('context'),env,upstream(401,{ok:false,error:'Jam HP berbeda jauh dari jam server.',details:{code:'CLOCK',server_time:'2026-11-05T01:00:00.000Z'}}));
 assert.equal(r.status,401);assert.deepEqual((await r.json()).details,{code:'CLOCK',server_time:'2026-11-05T01:00:00.000Z'});
 for(const status of [403,404,409,429,503]){r=await handleAttendanceForm(request(),env,upstream(status,{ok:false,error:'Pesan '+status}));assert.equal(r.status,status);assert.equal((await r.json()).error,'Pesan '+status);}
 r=await handleAttendanceForm(request(),env,upstream(500,{ok:false,error:'database secret details'}));assert.equal(r.status,503);assert(!(await r.text()).includes('secret'));
 r=await handleAttendanceForm(request(),env,upstream(422,{error:'tanpa penanda ok'}));assert.equal((await r.json()).error,'Absen belum dapat dikonfirmasi. Coba lagi.');
 r=await handleAttendanceForm(request(),env,async()=>{throw new Error('network down');});assert.equal(r.status,503);
 r=await handleAttendanceForm(request(),env,upstream(200,{ok:true,result:[1]}));assert.equal(r.status,503);
});
test('configuration must point at an HTTPS Supabase project with a server secret',async()=>{
 for(const bad of [{SUPABASE_URL:'http://example.supabase.co'},{SUPABASE_URL:'https://example.test'},{SUPABASE_SECRET_KEY:''},{PORTAL_ORIGIN:'http://portal.test'}]){
  const r=await handleAttendanceForm(request(),{...env,...bad},fail);assert([403,503].includes(r.status),JSON.stringify(bad));
 }
});
