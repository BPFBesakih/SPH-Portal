import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {state} from '../public/api.js';
import {loadAttendancePage,resetAttendance,leaveAttendance} from '../public/attendance.js';

test('attendance view uses authenticated API, escapes employee data, and hides management for ordinary staff',async()=>{
 const original=globalThis.fetch;try{
  state.me={name:'Test',user:{id:'fixture'}};state.route='attendance';
  globalThis.fetch=async url=>{assert.equal(url,'/api/attendance/me');return Response.json({installed:true,employee:{full_name:'<img onerror=alert(1)>'},server_time:'2026-11-06T00:00:00Z',config:{privacy_notice:'<script>bad</script>'},profile:{location_mode:'DEFAULT'},location:{name:'Kantor',latitude:-8.379975,longitude:115.447373,radius_m:100},capabilities:{},actions:{in:false,out:false},result:null,reason:'Jadwal belum tersedia.'});};
  const html=await loadAttendancePage();assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<script>/);assert.match(html,/Absen masuk[\s\S]*?disabled/);assert.doesNotMatch(html,/data-tab="settings"|data-tab="schedules"/);assert.match(html,/-8\.379975, 115\.447373/);
 }finally{resetAttendance();globalThis.fetch=original;state.me=null;}
});
test('old attendance responses cannot repopulate the view after account or route changes',async()=>{
 const original=globalThis.fetch;try{
  state.me={user:{id:'first'}};state.route='attendance';let resolve,started;
  const began=new Promise(r=>started=r);globalThis.fetch=()=>{started();return new Promise(r=>resolve=r);};
  const loading=loadAttendancePage();await began;state.me={user:{id:'second'}};leaveAttendance();resolve(Response.json({installed:false,reason:'Old response'}));
  await assert.rejects(loading,/berubah/);
 }finally{resetAttendance();globalThis.fetch=original;state.me=null;}
});
test('shipped attendance handler is executable and preserves all unrelated gateway bytes',async()=>{
 const source=readFileSync(new URL('../supabase/deploy/portal-api/index.ts',import.meta.url),'utf8'),baseline=JSON.parse(readFileSync(new URL('../supabase/attendance/baseline.json',import.meta.url),'utf8'));
 let stripped=source;for(const name of ['MODULE','ROUTE'])stripped=stripped.replace(new RegExp('// BEGIN ATTENDANCE '+name+'\\n[\\s\\S]*?// END ATTENDANCE '+name+'\\n','g'),'');
 assert.equal(createHash('sha256').update(stripped).digest('hex'),baseline.sha256);
 const module=source.split('// BEGIN ATTENDANCE MODULE\n')[1].split('// END ATTENDANCE MODULE')[0];
 const handler=runInNewContext(module+';__attendance.attendanceRoutes',{URL,Date,crypto,TextEncoder,TextDecoder,atob,btoa});
 const result=await handler({p:['attendance','me'],method:'GET',body:{},user:{id:'fixture',status:'ACTIVE'},db:{inTransaction:true,query:async()=>[]}},{});
 assert.equal(result.installed,false);
 assert.match(source,/collectionEnabled:Deno\.env\.get\("ATTENDANCE_ENABLED"\)===\"true\"/);
});
test('production assets include the attendance UI and preserve the merchandise logo URL',()=>{
 const dir=new URL('../site-info/dist/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('portal-static/manifest.json',dir),'utf8'));
 const html=readFileSync(new URL('app/index.html',dir),'utf8'),js=readFileSync(new URL(manifest.javascript.slice(1),dir),'utf8'),css=readFileSync(new URL(manifest.stylesheet.slice(1),dir),'utf8');
 assert.ok(html.includes(manifest.javascript)&&html.includes(manifest.stylesheet));assert.match(js,/attendance\/me/);assert.match(css,/att-dashboard/);
 assert.match(js,/new URL\("\/app\/assets\/bp-besakih\.png",location.href\)/);assert.doesNotMatch(js,/\.\/app\/assets\/bp-besakih/);
});
