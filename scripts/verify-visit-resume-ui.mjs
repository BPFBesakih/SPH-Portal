// Regresi migrasi NilaiGuide yang tersimpan sebagian/seluruhnya sebelum koneksi putus.
// Browser, portal, dan basis data sementara lokal; tidak menghubungi layanan luar.
// PLAYWRIGHT_MODULE dapat menunjuk paket Playwright yang sudah terpasang.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,sep} from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {openDb,insert,one,now} from '../lib/db.mjs';
import {seedPermissions,hashPasswordSync} from '../lib/auth.mjs';
import {createApp} from '../server.mjs';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const db=openDb(':memory:');seedPermissions(db);
const user=insert(db,'users',{username:'resume.uji',password_hash:hashPasswordSync('UjiResume!2026'),status:'ACTIVE',must_change_password:0,failed_login_count:0,password_changed_at:now()});
insert(db,'user_roles',{user_id:user.id,role_id:one(db,"SELECT id FROM roles WHERE code='KUNJUNGAN_PENGELOLA'").id,scope_kind:'ALL'});
insert(db,'visit_guides',{id:'G-001',seq:1,name:'Guide Uji Migrasi',kategori:'Asing',regu:'A1',is_active:1});
const tempRoot=resolve(tmpdir()),dataDir=mkdtempSync(resolve(tempRoot,'visit-resume-ui-'));
const port=await new Promise(ready=>{const probe=createServer().listen(0,'127.0.0.1',()=>{const {port}=probe.address();probe.close(()=>ready(port));});});
const base=`http://127.0.0.1:${port}`;
const portalApp=createApp({db,dataDir,origin:base,sheetEnv:{},sheetAuto:false});
await new Promise(ready=>portalApp.server.listen(Number(new URL(base).port),'127.0.0.1',ready));
const browser=await chromium.launch();let checks=0;
const check=async(name,work)=>{await work();checks++;console.log('PASS '+name);};
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const csv=rows=>Buffer.from('evaluationId,timestamp,pos,guideId,uniform,idCard,etika,status\n'+rows.join('\n'));
const row=(n,pos=1)=>`${uuid(n)},2026-03-03T01:00:00.000Z,${pos},G-001,1,1,0,aktif`;
const file=(name,buffer)=>({name,mimeType:'text/csv',buffer});
const current=()=>one(db,'SELECT * FROM visit_history_import WHERE terbuka=1');
const total=()=>Number(one(db,"SELECT coalesce(sum(antar),0) n FROM visit_daily_totals WHERE sumber='nilaiguide'").n);
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/');await page.fill('#login-form [name=username]','resume.uji');await page.fill('#login-form [name=password]','UjiResume!2026');await page.click('#login-form [type=submit]');
 await page.waitForSelector('.sidebar');await page.goto(base+'/#visits-reports');await page.waitForSelector('[data-visit="history-start"]');
 const open=async upload=>{await page.click('[data-visit="history-start"]');await page.setInputFiles('[data-history-file]',upload);await page.waitForSelector('[data-history-result] .notice');};
 const close=async()=>{await page.click('dialog[open] [data-close]');await page.waitForSelector('[data-visit="history-start"]');};
 const cancel=async()=>{await page.click('[data-visit="history-cancel"]');await page.waitForSelector('dialog [data-confirm]');await page.click('dialog [data-confirm]');await page.waitForSelector('text=Migrasi awal dibatalkan.');await page.waitForFunction(()=>/Unduh spreadsheet NilaiGuide/.test(document.querySelector('main')?.textContent||''));};
 const start=async()=>{await page.click('[data-history-apply]');await page.waitForSelector('dialog [data-confirm]');await page.click('dialog [data-confirm]');};
 const single=file('satu.csv',csv([row(1)]));
 await check('impor baru tanpa baris yang masuk tetap tidak dapat diterapkan',async()=>{
  await open(file('hanya-pos2.csv',csv([row(9,2)])));assert(await page.isDisabled('[data-history-apply]'));assert.equal(current(),undefined);await close();
 });
 let finishFailures=1,finishCalls=0,applyParts=[];
 await page.route('**/api/visits/history/import',route=>{const body=route.request().postDataJSON();if(body.mode==='apply')applyParts.push(body.part);return route.continue();});
 await page.route('**/api/visits/history/finish',route=>{finishCalls++;if(finishFailures-- >0)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Koneksi terputus sebelum penyelesaian (uji).'})});return route.continue();});
 await check('bagian terakhir tersimpan, gagal menyelesaikan: Lanjutkan tetap aktif untuk berkas sama',async()=>{
  await open(single);await start();await page.waitForSelector('text=Migrasi terhenti');assert.equal(current().status,'menyusun');assert.deepEqual(JSON.parse(current().parts_done),[0]);assert.equal(total(),1);
  await close();await open(single);assert.match(await page.textContent('[data-history-result]'),/0 penilaian masuk ke rekap/);assert.match(await page.textContent('[data-history-result]'),/1 penilaian sudah tersimpan/);assert(await page.isEnabled('[data-history-apply]'));
 });
 await check('berkas berbeda ditolak saat melanjutkan; berkas benar dapat dipilih kembali',async()=>{
  await page.setInputFiles('[data-history-file]',file('berbeda.csv',Buffer.concat([single.buffer,Buffer.from('\n')])));await page.waitForSelector('text=Berkas belum dapat dipakai');assert.match(await page.textContent('[data-history-result]'),/Berkas ini berbeda/);assert(await page.isDisabled('[data-history-apply]'));
  await page.setInputFiles('[data-history-file]',single);await page.waitForSelector('[data-history-result] .notice');assert(await page.isEnabled('[data-history-apply]'));
 });
 await check('melanjutkan bagian lengkap hanya mengirim penyelesaian, tanpa menggandakan data',async()=>{
  applyParts=[];const finished=page.waitForResponse(r=>r.url().endsWith('/api/visits/history/finish'));await page.click('[data-history-apply]');const response=await finished;assert(response.ok(),await response.text());assert.equal(current().status,'aktif');assert.deepEqual(applyParts,[]);assert.equal(finishCalls,2);assert.equal(total(),1);await page.waitForFunction(()=>/Masuk ke rekap/.test(document.querySelector('main')?.textContent||''));await cancel();
 });
 await page.unroute('**/api/visits/history/finish');await page.unroute('**/api/visits/history/import');
 let failPart=true;applyParts=[];
 const mixed=file('bagian-terakhir-dilewati.csv',csv([row(20),...Array.from({length:800},(_,i)=>row(i+21,2))]));
 await page.route('**/api/visits/history/import',route=>{const body=route.request().postDataJSON();if(body.mode==='apply'){applyParts.push(body.part);if(body.part===1&&failPart){failPart=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Bagian kedua terputus (uji).'})});}}return route.continue();});
 await check('bagian tersisa hanya berisi baris yang dilewati tetap dapat dilanjutkan',async()=>{
  await open(mixed);await start();await page.waitForSelector('text=Migrasi terhenti');assert.equal(current().status,'menyusun');assert.equal(current().parts_total,2);assert.deepEqual(JSON.parse(current().parts_done),[0]);assert.equal(total(),1);
  await close();await open(mixed);assert.match(await page.textContent('[data-history-result]'),/0 penilaian masuk ke rekap/);assert(await page.isEnabled('[data-history-apply]'));
  applyParts=[];const finished=page.waitForResponse(r=>r.url().endsWith('/api/visits/history/finish'));await page.click('[data-history-apply]');const response=await finished;assert(response.ok(),await response.text());assert.deepEqual(applyParts,[1]);assert.equal(current().status,'aktif');assert.equal(total(),1);assert.equal(JSON.parse(current().ringkasan).counts.POS2,800);
 });
 assert.deepEqual(errors,[]);console.log(`${checks} pemeriksaan UI kelanjutan migrasi lulus.`);
}finally{
 await browser.close();portalApp.server.closeAllConnections();await new Promise(ready=>portalApp.server.close(ready));db.close();
 assert(dataDir.startsWith(tempRoot+sep)&&dataDir!==tempRoot,'Direktori sementara harus di dalam temp');rmSync(dataDir,{recursive:true,force:true});
}
