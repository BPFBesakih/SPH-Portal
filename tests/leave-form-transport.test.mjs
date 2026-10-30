import test from 'node:test';
import assert from 'node:assert/strict';
import {handleLeaveForm} from '../site-info/lib/leave-form.mjs';
const env={PORTAL_ORIGIN:'https://portal.test',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'server-only-secret'};
const token='a'.repeat(64);
const request=(extra={},headers={})=>new Request('https://portal.test/api/leave-form/context',{method:'POST',headers:{Origin:'https://portal.test','Content-Type':'application/json','CF-Connecting-IP':'127.0.0.1',...headers},body:JSON.stringify({token,...extra})});
test('form proxy sends credentials only to fixed server function and never returns them',async()=>{
 let calls=0;const response=await handleLeaveForm(request({employee_id:'forged'}),env,async(url,options)=>{
  calls++;assert.equal(url,'https://example.supabase.co/functions/v1/leave-form');assert.equal(options.headers.apikey,env.SUPABASE_SECRET_KEY);assert.equal(options.redirect,'manual');
  const body=JSON.parse(options.body);assert.equal(body.client_ip,'127.0.0.1');assert.equal(body.operation,'context');assert.equal(body.body.token,token);
  return Response.json({ok:true,result:{name:'Pegawai Contoh',today:'2026-10-30',available_days:5,token_hash:'must-not-leak',secret:'must-not-leak',requests:[{reason:'must-not-leak'}]}});
 });
 assert.equal(calls,1);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert(!(await response.text()).includes('must-not-leak'));
});
test('cross-origin and cross-site requests never reach the server function',async()=>{
 const fail=()=>{throw new Error('Must not call upstream');};
 assert.equal((await handleLeaveForm(request({}, {Origin:'https://attacker.test'}),env,fail)).status,403);
 assert.equal((await handleLeaveForm(request({}, {'Sec-Fetch-Site':'cross-site'}),env,fail)).status,403);
});
test('shared directory response exposes only form choices and never balances, full identifiers or reasons',async()=>{
 const response=await handleLeaveForm(request(),env,async()=>Response.json({ok:true,result:{shared:true,today:'2026-10-30',employees:[{id:'opaque-choice',full_name:'Contoh',position_name:'Staf · Unit A',unit_name:'Unit A',can_request:true,approver:'Atasan',employee_no:'PRIVATE-NUMBER',available_days:9,requests:[{reason:'PRIVATE-REASON'}]}],share_token:'PRIVATE-TOKEN'}}));
 assert.equal(response.status,200);const value=await response.json();assert(value.shared);assert.equal(value.employees.length,1);assert(!JSON.stringify(value).includes('PRIVATE'));assert(!JSON.stringify(value).includes('available_days'));
});
test('invalid token, method and content type are rejected before upstream',async()=>{
 const fail=()=>{throw new Error('Must not call upstream');};
 assert.equal((await handleLeaveForm(request({token:''}),env,fail)).status,404);
 assert.equal((await handleLeaveForm(request({}, {'Content-Type':'text/plain'}),env,fail)).status,415);
 assert.equal((await handleLeaveForm(new Request('https://portal.test/api/leave-form/context'),env,fail)).status,405);
 assert.equal((await handleLeaveForm(new Request('https://portal.test/api/leave-form/decision'),env,fail)).status,404);
});
test('missing trusted client IP and oversized requests cannot bypass transport limits',async()=>{
 const missing=request();missing.headers.delete('CF-Connecting-IP');
 assert.equal((await handleLeaveForm(missing,env)).status,400);
 assert.equal((await handleLeaveForm(request({reason:'x'.repeat(25000)}),env)).status,413);
});
test('server failures are redacted while actionable validation and rate errors remain visible',async()=>{
 for(const status of [400,403,404,409,413,422,429]){
  const r=await handleLeaveForm(request(),env,async()=>Response.json({error:'Periksa formulir.'},{status}));assert.equal(r.status,status);assert.equal((await r.json()).error,'Periksa formulir.');
 }
 const response=await handleLeaveForm(request(),env,async()=>Response.json({error:'database secret details'},{status:500}));
 assert.equal(response.status,503);assert(!(await response.text()).includes('secret'));
});
