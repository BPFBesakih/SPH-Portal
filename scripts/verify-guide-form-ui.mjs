// Uji UI Playwright formulir penilaian guide dan ruang kerja Kunjungan, sepenuhnya lokal.
//
//   node scripts/verify-guide-form-ui.mjs <folder-repo-nilaiguide>
//
// Menjalankan jembatan tiruan (kode Apps Script NilaiGuide asli + data fiktif) dan
// portal SQLite di memori, lalu memeriksa skenario UJI-01/02/03/05/10/13/17/27 PRD.
// Playwright diambil dari PLAYWRIGHT_MODULE bila diisi, selain itu dari `playwright`.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {openDb,insert,one,now} from '../lib/db.mjs';
import {seedPermissions,digest,hashPasswordSync} from '../lib/auth.mjs';
import {guidePosts} from '../lib/guide-form.mjs';
import {bridgeConfig} from '../lib/visits-bridge.mjs';
import {startBridgeSimulator} from './visits-bridge-dev.mjs';
import {createApp} from '../server.mjs';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const freePort=()=>new Promise(r=>{const probe=createServer().listen(0,'127.0.0.1',()=>{const {port}=probe.address();probe.close(()=>r(port));});});
const bridge=await startBridgeSimulator({nilaiguideDir:process.argv[2]||process.env.NILAIGUIDE_DIR,port:0,stateFile:null,seedDays:0,log:null});
const db=openDb(':memory:');seedPermissions(db);
const user=insert(db,'users',{username:'kunjungan.uji',password_hash:hashPasswordSync('UjiKunjungan!2026'),status:'ACTIVE',must_change_password:0,failed_login_count:0,password_changed_at:now()});
insert(db,'user_roles',{user_id:user.id,role_id:one(db,"SELECT id FROM roles WHERE code='KUNJUNGAN_PENGELOLA'").id,scope_kind:'ALL'});
const tokens={1:'1'.repeat(64),3:'3'.repeat(64)};
for(const pos of [1,3])insert(db,'guide_form_links',{pos,label:guidePosts[pos],token_hash:digest(tokens[pos]),share_token:tokens[pos],is_active:1,created_by:user.id});
const port=await freePort(),base=`http://127.0.0.1:${port}`,dataDir=mkdtempSync(resolve(tmpdir(),'guide-form-ui-'));
const {server}=createApp({db,dataDir,origin:base,visitsBridge:bridgeConfig({VISITS_BRIDGE_URL:bridge.url,VISITS_BRIDGE_KEY:bridge.key},{allowLocal:true})});
await new Promise(r=>server.listen(port,'127.0.0.1',r));
const browser=await chromium.launch();let checks=0;
const check=async(name,work)=>{await work();console.log('PASS '+name);checks++;};
try{
  const ctx=await browser.newContext({viewport:{width:390,height:844}}),page=await ctx.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const until=async(test,label,ms=20000)=>{const end=Date.now()+ms;for(;;){const c=await page.evaluate(()=>DB.counts());if(test(c))return c;if(Date.now()>end)throw new Error(`Menunggu ${label}: ${JSON.stringify(c)}`);await page.waitForTimeout(250);}};
  const rows=()=>bridge.doc.getSheetByName('Evaluations').data.length-1;
  const pick=async(name,uniform='1',id='1')=>{await page.evaluate(()=>App.go('nilai'));await page.fill('#guideInput',name);await page.dispatchEvent('#guideInput','input');await page.click(`.criterion[data-crit="idCard"] .seg[data-val="${id}"]`);await page.click(`.criterion[data-crit="uniform"] .seg[data-val="${uniform}"]`);};
  await page.goto(base+'/penilaian-guide/');await page.waitForTimeout(800);await page.click('#tutSkip').catch(()=>{});
  await check('UJI-02 tanpa token hanya petunjuk tautan, tanpa daftar guide',async()=>{assert(await page.isVisible('#view-tautan'));assert.equal(await page.$$eval('#guideList option',o=>o.length),0);});
  await page.goto(base+'/penilaian-guide/#'+tokens[1]);await page.waitForFunction(()=>document.querySelectorAll('#guideList option').length>30);
  await check('UJI-01 tautan pos tersimpan, guide termuat, token hilang dari alamat',async()=>{assert(!page.url().includes(tokens[1]));assert.match(await page.textContent('#posLabel'),/Pos 1/);});
  await pick('Guide Contoh A1-03','2');await page.click('.criterion[data-crit="etika"] [data-step="1"]');await page.fill('#catatan','=IMPORTDATA("x")');await page.dispatchEvent('#catatan','input');await page.waitForTimeout(600);
  await check('UJI-13 draf pulih setelah dimuat ulang',async()=>{await page.reload();await page.waitForTimeout(1000);await page.evaluate(()=>App.go('nilai'));assert.equal(await page.inputValue('#guideInput'),'Guide Contoh A1-03');assert.equal(await page.inputValue('#catatan'),'=IMPORTDATA("x")');assert.equal(await page.textContent('#etikaNilai'),'+1');});
  await page.click('#btnSave');await until(c=>c.synced===1,'kiriman pertama');
  await check('Simpan → ✅ hanya setelah spreadsheet menerima; catatan rumus disimpan sebagai teks',async()=>{assert.equal(rows(),1);assert.equal(bridge.doc.getSheetByName('Evaluations').data[1][9],'\'=IMPORTDATA("x")');});
  await pick('Guide Contoh A1-03');await page.click('#btnSave');await page.waitForTimeout(400);
  await check('UJI-05 guide & pos sama < 15 menit ditahan aplikasi tanpa tombol lanjut',async()=>{assert.match(await page.textContent('#guideAmbigu'),/server akan menolaknya/);assert.equal(await page.$('#guideAmbigu [data-lanjut]'),null);});
  await page.click('#guideAmbigu [data-fix]');await page.click('.criterion[data-crit="uniform"] .seg[data-val="-1"]');await page.click('#btnSave');await until(c=>c.synced===2,'koreksi');
  await check('UJI-10 koreksi menandai baris lama diganti',async()=>{const data=bridge.doc.getSheetByName('Evaluations').data;assert.equal(data[1][12],'diganti');assert.equal(data[2][12],'aktif');assert.equal(data[2][1],data[1][1]);});
  await ctx.setOffline(true);for(const name of ['Guide Contoh A2-01','Guide Contoh D1-02','Guide Contoh D2-03']){await pick(name,'1','0');await page.click('#btnSave');await page.waitForTimeout(250);}
  assert.equal((await page.evaluate(()=>DB.counts())).pending,3);
  await ctx.setOffline(false);await page.evaluate(()=>window.dispatchEvent(new Event('online')));await until(c=>c.pending===0&&c.synced===5,'antrean offline');
  await check('UJI-03 tiga penilaian offline terkirim setelah online',async()=>{assert.equal(rows(),5);});
  await page.evaluate(()=>App.go('tautan'));await page.fill('#tautanInput',`${base}/penilaian-guide/#${tokens[3]}`);await page.click('#formTautan button[type=submit]');await page.waitForTimeout(1200);
  await check('UJI-27 tempel tautan Pos 3; pemilih pos muncul',async()=>{assert(await page.isVisible('#homePos'));assert.equal((await page.$$eval('#homePos option',o=>o.length)),2);});
  const csv=await page.evaluate(async()=>{let out='';const orig=App.download;App.download=(n,c)=>{out=c;};await App.exportCsv();App.download=orig;return out;});
  await check('UJI-17 CSV menulis Uniform -1 dan 2',async()=>{const lines=csv.split('\n').filter(l=>l.includes('A1-03'));assert(lines.some(l=>l.includes(';-1;')));assert(lines.some(l=>l.includes(';2;')));});
  await check('NG-R6 riwayat membedakan Sesuai dan Bagus',async()=>{await page.evaluate(()=>App.go('riwayat'));await page.waitForTimeout(300);const t=await page.textContent('#historyList');assert.match(t,/Uniform Bagus/);assert.match(t,/Uniform Sesuai/);});
  assert.deepEqual(errors,[]);
  console.log(`${checks} pemeriksaan UI formulir penilaian guide lulus.`);
}finally{await browser.close();server.close();await bridge.close();db.close();rmSync(dataDir,{recursive:true,force:true});}
