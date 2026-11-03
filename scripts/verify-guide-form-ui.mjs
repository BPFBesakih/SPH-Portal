// Uji UI Playwright formulir penilaian guide dan ruang kerja Kunjungan, sepenuhnya lokal.
//
//   node scripts/verify-guide-form-ui.mjs
//
// Portal SQLite di memori + Google Drive/Sheets TIRUAN (scripts/fake-google-sheets.mjs),
// data guide fiktif. Memeriksa skenario UJI-01/02/03/05/10/13/17/27 PRD di HP pos,
// salinan spreadsheet di latar belakang, serta Data Guide (impor .csv), Dashboard,
// dan Tautan Pos (periksa koneksi, sinkronkan) di portal.
// Playwright diambil dari PLAYWRIGHT_MODULE bila diisi, selain itu dari `playwright`.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {deflateRawSync,crc32} from 'node:zlib';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {openDb,insert,one,all,now} from '../lib/db.mjs';
import {seedPermissions,digest,hashPasswordSync} from '../lib/auth.mjs';
import {guidePosts} from '../lib/guide-form.mjs';
import {createFakeGoogle} from './fake-google-sheets.mjs';
import {createApp} from '../server.mjs';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const freePort=()=>new Promise(r=>{const probe=createServer().listen(0,'127.0.0.1',()=>{const {port}=probe.address();probe.close(()=>r(port));});});
const db=openDb(':memory:');seedPermissions(db);
const user=insert(db,'users',{username:'kunjungan.uji',password_hash:hashPasswordSync('UjiKunjungan!2026'),status:'ACTIVE',must_change_password:0,failed_login_count:0,password_changed_at:now()});
insert(db,'user_roles',{user_id:user.id,role_id:one(db,"SELECT id FROM roles WHERE code='KUNJUNGAN_PENGELOLA'").id,scope_kind:'ALL'});
let seq=0;for(const regu of ['A1','A2','D1','D2'])for(let i=1;i<=10;i++){seq++;insert(db,'visit_guides',{id:`G-${String(seq).padStart(3,'0')}`,seq,name:`Guide Contoh ${regu}-${String(i).padStart(2,'0')}`,kategori:regu.startsWith('A')?'Asing':'Domestik',regu,is_active:1});}
const tokens={1:'1'.repeat(64),3:'3'.repeat(64)};
for(const pos of [1,3])insert(db,'guide_form_links',{pos,label:guidePosts[pos],token_hash:digest(tokens[pos]),share_token:tokens[pos],is_active:1,created_by:user.id});
const google=createFakeGoogle();
const port=await freePort(),base=`http://127.0.0.1:${port}`,dataDir=mkdtempSync(resolve(tmpdir(),'guide-form-ui-'));
const app=createApp({db,dataDir,origin:base,sheetEnv:google.env,sheetFetch:google.fetch,sheetAuto:true});
await new Promise(r=>app.server.listen(port,'127.0.0.1',r));
const browser=await chromium.launch();let checks=0;
const check=async(name,work)=>{await work();console.log('PASS '+name);checks++;};
const settle=async()=>{while(app.sheetTasks.size)await Promise.all([...app.sheetTasks]);};
try{
  const ctx=await browser.newContext({viewport:{width:390,height:844}}),page=await ctx.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const until=async(test,label,ms=20000)=>{const end=Date.now()+ms;for(;;){const c=await page.evaluate(()=>DB.counts());if(test(c))return c;if(Date.now()>end)throw new Error(`Menunggu ${label}: ${JSON.stringify(c)}`);await page.waitForTimeout(250);}};
  const rows=()=>one(db,'SELECT count(*) n FROM visit_evaluations').n;
  const pick=async(name,uniform='1',id='1')=>{await page.evaluate(()=>App.go('nilai'));await page.fill('#guideInput',name);await page.dispatchEvent('#guideInput','input');await page.click(`.criterion[data-crit="idCard"] .seg[data-val="${id}"]`);await page.click(`.criterion[data-crit="uniform"] .seg[data-val="${uniform}"]`);};
  await page.goto(base+'/penilaian-guide/');await page.waitForTimeout(800);await page.click('#tutSkip').catch(()=>{});
  await check('UJI-02 tanpa token hanya petunjuk tautan, tanpa daftar guide',async()=>{assert(await page.isVisible('#view-tautan'));assert.equal(await page.$$eval('#guideList option',o=>o.length),0);});
  await page.goto(base+'/penilaian-guide/#'+tokens[1]);await page.waitForFunction(()=>document.querySelectorAll('#guideList option').length>30);
  await check('UJI-01 tautan pos tersimpan, guide dari Data Guide portal termuat, token hilang dari alamat',async()=>{assert(!page.url().includes(tokens[1]));assert.match(await page.textContent('#posLabel'),/Pos 1/);});
  await pick('Guide Contoh A1-03','2');await page.click('.criterion[data-crit="etika"] [data-step="1"]');await page.fill('#catatan','=IMPORTDATA("x")');await page.dispatchEvent('#catatan','input');await page.waitForTimeout(600);
  await check('UJI-13 draf pulih setelah dimuat ulang',async()=>{await page.reload();await page.waitForTimeout(1000);await page.evaluate(()=>App.go('nilai'));assert.equal(await page.inputValue('#guideInput'),'Guide Contoh A1-03');assert.equal(await page.inputValue('#catatan'),'=IMPORTDATA("x")');assert.equal(await page.textContent('#etikaNilai'),'+1');});
  await page.click('#btnSave');await until(c=>c.synced===1,'kiriman pertama');await settle();
  await check('Simpan → ✅ hanya setelah portal menyimpan; salinan spreadsheet menyimpan catatan rumus sebagai teks',async()=>{
    assert.equal(rows(),1);const saved=one(db,'SELECT * FROM visit_evaluations');assert.equal(saved.catatan,'=IMPORTDATA("x")');
    const tab=google.rows(saved.wita_date.slice(0,7));assert.equal(tab.length,1);assert.equal(tab[0][9],'=IMPORTDATA("x")');
  });
  await pick('Guide Contoh A1-03');await page.click('#btnSave');await page.waitForTimeout(400);
  await check('UJI-05 guide & pos sama < 15 menit ditahan aplikasi tanpa tombol lanjut',async()=>{assert.match(await page.textContent('#guideAmbigu'),/server akan menolaknya/);assert.equal(await page.$('#guideAmbigu [data-lanjut]'),null);});
  await page.click('#guideAmbigu [data-fix]');await page.click('.criterion[data-crit="uniform"] .seg[data-val="-1"]');await page.click('#btnSave');await until(c=>c.synced===2,'koreksi');
  await check('UJI-10 koreksi menandai baris lama diganti, dengan jam yang sama',async()=>{const [a,b]=all(db,'SELECT * FROM visit_evaluations ORDER BY received_at');assert.equal(a.status,'diganti');assert.equal(b.status,'aktif');assert.equal(b.koreksi_dari,a.id);assert.equal(b.evaluated_at,a.evaluated_at);});
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

  // Ruang kerja portal (layar laptop).
  const desk=await browser.newContext({viewport:{width:1280,height:900}}),portal=await desk.newPage(),portalErrors=[];
  portal.on('pageerror',e=>portalErrors.push(e.message));
  await portal.goto(base+'/');await portal.fill('#login-form [name=username]','kunjungan.uji');await portal.fill('#login-form [name=password]','UjiKunjungan!2026');await portal.click('#login-form [type=submit]');
  await portal.waitForSelector('.sidebar');await portal.goto(base+'/#visits');await portal.waitForSelector('text=Dashboard Kunjungan');
  await settle();
  await check('Dashboard menghitung penilaian dari portal dan menampilkan status salinan',async()=>{
    await portal.goto(base+'/#visits-records');await portal.goto(base+'/#visits');await portal.waitForSelector('.stat-value');
    const values=await portal.$$eval('.stat-card .stat-value',els=>els.map(e=>e.textContent.trim()));assert.equal(values[0],'4','4 pengantaran aktif (1 diganti)');
    assert.match(await portal.textContent('main'),/semua baris sudah tersalin/);
  });
  const file=resolve(dataDir,'Guides.csv');
  writeFileSync(file,'﻿guideId,guideName,kategori,regu,aktif\r\nG-001,Guide Contoh A1-01,Asing,A1,TRUE\r\nG-041,"Guide Baru, Uji",Domestik,"D1, D2",TRUE\r\nG-042,Guide Nonaktif Uji,Asing,A2,FALSE\r\n');
  await check('Data Guide: impor .csv dengan pratinjau lalu terapkan',async()=>{
    await portal.goto(base+'/#visits-guides');await portal.waitForSelector('[data-visit="guide-import"]');await portal.click('[data-visit="guide-import"]');
    await portal.setInputFiles('[data-import-file]',file);await portal.waitForSelector('[data-import-result] .notice');
    assert.match(await portal.textContent('[data-import-result]'),/2 guide baru · 0 berubah · 1 tetap/);
    await portal.click('[data-import-apply]');await portal.waitForSelector('text=2 guide ditambahkan');
    assert.equal(one(db,"SELECT regu FROM visit_guides WHERE id='G-041'").regu,'D1, D2');assert.equal(one(db,"SELECT is_active FROM visit_guides WHERE id='G-042'").is_active,0);
  });
  // .xlsx seperti unduhan Google Sheets: teks bersama, sel boolean, sheet bernama Guides, rId bukan rId1.
  const zip=entries=>{const parts=[],central=[];let offset=0;
    for(const [name,text] of entries){const data=Buffer.from(text),packed=deflateRawSync(data),head=Buffer.alloc(30),file=Buffer.from(name);
      head.writeUInt32LE(0x04034b50,0);head.writeUInt16LE(20,4);head.writeUInt16LE(8,8);head.writeUInt32LE(crc32(data),14);head.writeUInt32LE(packed.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(file.length,26);
      const dir=Buffer.alloc(46);dir.writeUInt32LE(0x02014b50,0);dir.writeUInt16LE(20,4);dir.writeUInt16LE(20,6);dir.writeUInt16LE(8,10);dir.writeUInt32LE(crc32(data),16);dir.writeUInt32LE(packed.length,20);dir.writeUInt32LE(data.length,24);dir.writeUInt16LE(file.length,28);dir.writeUInt32LE(offset,42);
      parts.push(head,file,packed);central.push(dir,file);offset+=30+file.length+packed.length;}
    const size=central.reduce((n,b)=>n+b.length,0),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(size,12);end.writeUInt32LE(offset,16);
    return Buffer.concat([...parts,...central,end]);};
  const ns='xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const strings=['guideId','guideName','kategori','regu','aktif','G-002','Guide Contoh A1-02 (ganti)','Asing','A1','G-043','Guide Xlsx Uji','Domestik','D2'];
  const s=i=>`<c t="s"><v>${i}</v></c>`,cellRow=(r,cells)=>`<row r="${r}">${cells.map((c,j)=>c.replace('<c ',`<c r="${'ABCDE'[j]}${r}" `)).join('')}</row>`;
  writeFileSync(resolve(dataDir,'Guides.xlsx'),zip([
    ['xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8"?><workbook ${ns}><sheets><sheet name="Petunjuk" sheetId="1" r:id="rId4"/><sheet name="Guides" sheetId="2" r:id="rId5"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId4" Type="worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId5" Type="worksheet" Target="worksheets/sheet2.xml"/></Relationships>'],
    ['xl/sharedStrings.xml',`<?xml version="1.0" encoding="UTF-8"?><sst ${ns} count="${strings.length}" uniqueCount="${strings.length}">${strings.map(t=>`<si><t>${t}</t></si>`).join('')}</sst>`],
    ['xl/worksheets/sheet1.xml',`<?xml version="1.0" encoding="UTF-8"?><worksheet ${ns}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>bukan daftar guide</t></is></c></row></sheetData></worksheet>`],
    ['xl/worksheets/sheet2.xml',`<?xml version="1.0" encoding="UTF-8"?><worksheet ${ns}><sheetData>${cellRow(1,[0,1,2,3,4].map(s))}${cellRow(2,[s(5),s(6),s(7),s(8),'<c t="b"><v>1</v></c>'])}${cellRow(4,[s(9),s(10),s(11),s(12),'<c t="b"><v>0</v></c>'])}</sheetData></worksheet>`]]));
  await check('Data Guide: impor .xlsx unduhan Google Sheets (sheet Guides, teks bersama, boolean)',async()=>{
    await portal.goto(base+'/#visits-guides');await portal.waitForSelector('[data-visit="guide-import"]');await portal.click('[data-visit="guide-import"]');
    await portal.setInputFiles('[data-import-file]',resolve(dataDir,'Guides.xlsx'));await portal.waitForSelector('[data-import-result] .notice');
    const text=await portal.textContent('[data-import-result]');assert.match(text,/sheet "Guides"/);assert.match(text,/1 guide baru · 1 berubah · 0 tetap/);
    await portal.click('[data-import-apply]');await portal.waitForSelector('text=1 guide ditambahkan, 1 diperbarui');
    assert.equal(one(db,"SELECT name FROM visit_guides WHERE id='G-002'").name,'Guide Contoh A1-02 (ganti)');assert.equal(one(db,"SELECT is_active FROM visit_guides WHERE id='G-043'").is_active,0);
  });
  await check('Tautan Pos: periksa koneksi dan sinkronkan salinan spreadsheet',async()=>{
    await portal.goto(base+'/#visits-links');await portal.waitForSelector('text=Salinan spreadsheet');
    await portal.click('[data-visit="sheet-check"]');await portal.waitForSelector('.visit-check');
    assert.equal(await portal.$$eval('.visit-check li.ok',els=>els.length),4);await portal.click('dialog [data-close]');
    await portal.click('[data-visit="sheet-sync"]');await portal.waitForSelector('text=baris baru disalin');
    assert.match(await portal.textContent('main'),/Penilaian Guide \d{4}/);
  });
  assert.deepEqual(portalErrors,[]);
  console.log(`${checks} pemeriksaan UI penilaian guide lulus.`);
}finally{await browser.close();app.server.close();db.close();rmSync(dataDir,{recursive:true,force:true});}
