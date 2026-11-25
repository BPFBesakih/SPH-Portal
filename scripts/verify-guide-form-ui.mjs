// Uji UI Playwright formulir penilaian guide dan ruang kerja Kunjungan, sepenuhnya lokal.
//
//   node scripts/verify-guide-form-ui.mjs
//
// Portal SQLite di memori + Google Drive/Sheets TIRUAN (scripts/fake-google-sheets.mjs),
// data guide fiktif. Memeriksa skenario UJI-01/02/03/05/10/13/17/27 PRD di HP pos,
// daftar saran nama guide (nama + ID · regu, filter, keyboard, nama kembar),
// isian "100 − potongan + Etika" (ID, seragam, Etika −10…+10 lewat tombol dengan patokan dan pengingat hukuman ganda, laporan berat
// dengan catatan wajib, nama petugas sekali per shift), koreksi/draf dari formulir lama,
// penilaian Etika yang ditahan di HP selama server belum menyimpan Etika, menu Review Negatif
// dan Komplain di HP pos (petugas wajib, guide dari daftar, draf, antrean bersama, ditahan selama
// server belum menerimanya, Riwayat/CSV tanpa data wisatawan) beserta keputusannya di Verifikasi,
// Verifikasi dan Aturan Nilai di ruang kerja,
// salinan spreadsheet di latar belakang, serta Data Guide (impor .csv), Dashboard,
// migrasi awal NilaiGuide (pratinjau, putus lalu lanjutkan, batalkan), dan Tautan Pos
// (periksa koneksi, sinkronkan) di portal.
// Playwright diambil dari PLAYWRIGHT_MODULE bila diisi, selain itu dari `playwright`.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {deflateRawSync,crc32} from 'node:zlib';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {openDb,insert,one,all,now} from '../lib/db.mjs';
import {seedPermissions,digest,hashPasswordSync} from '../lib/auth.mjs';
import {guidePosts} from '../lib/guide-form.mjs';
import {visitDayRows,visitOverview,witaDate} from '../lib/visit-data.mjs';
import {createFakeGoogle} from './fake-google-sheets.mjs';
import {createApp} from '../server.mjs';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const freePort=()=>new Promise(r=>{const probe=createServer().listen(0,'127.0.0.1',()=>{const {port}=probe.address();probe.close(()=>r(port));});});
const db=openDb(':memory:');seedPermissions(db);
const user=insert(db,'users',{username:'kunjungan.uji',password_hash:hashPasswordSync('UjiKunjungan!2026'),status:'ACTIVE',must_change_password:0,failed_login_count:0,password_changed_at:now()});
insert(db,'user_roles',{user_id:user.id,role_id:one(db,"SELECT id FROM roles WHERE code='KUNJUNGAN_PENGELOLA'").id,scope_kind:'ALL'});
let seq=0;for(const regu of ['A1','A2','D1','D2'])for(let i=1;i<=10;i++){seq++;insert(db,'visit_guides',{id:`G-${String(seq).padStart(3,'0')}`,seq,name:`Guide Contoh ${regu}-${String(i).padStart(2,'0')}`,kategori:regu.startsWith('A')?'Asing':'Domestik',regu,is_active:1});}
// Dua guide bernama persis sama: daftar saran harus membedakannya lewat ID dan regu.
for(const [id,regu] of [['G-090','A1'],['G-091','D2']])insert(db,'visit_guides',{id,seq:Number(id.slice(2)),name:'Guide Kembar Uji',kategori:regu.startsWith('A')?'Asing':'Domestik',regu,is_active:1});
const tokens={1:'1'.repeat(64),3:'3'.repeat(64)};
const petugasUji=insert(db,'visit_assessors',{nama:'Petugas Uji Satu',keterangan:'Pos 1',is_active:1});
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
  // Baris daftar saran nama guide: ID, nama, dan keterangan ID · regu.
  const saran=()=>page.$$eval('#guideSaran .saran-item',els=>els.map(e=>({id:e.dataset.saran,nama:e.querySelector('.saran-nama').textContent,meta:e.querySelector('.saran-meta').textContent})));
  const pilihSaran=async name=>{const ids=(await saran()).filter(r=>r.nama===name).map(r=>r.id);assert.equal(ids.length,1,`satu saran bernama ${name}`);await page.click(`#guideSaran [data-saran="${ids[0]}"]`);};
  // Ketik sebagian nama lalu pilih dari daftar, seperti petugas di pos.
  const pick=async(name,seragam='lengkap',id='1')=>{await page.evaluate(()=>App.go('nilai'));await page.fill('#guideInput',name.slice(0,-1));await pilihSaran(name);await page.click(`.criterion[data-crit="idCard"] .seg[data-val="${id}"]`);await page.click(`.criterion[data-crit="seragam"] .seg[data-val="${seragam}"]`);};
  // Etika diatur dengan tombol − / + seperti di HP pos, sampai angkanya tercapai.
  const etikaBtn=step=>`[data-crit="etika"] .stepbtn[data-step="${step}"]`;
  const patokanAktif=()=>page.$$eval('#etikaPatokan li.aktif',els=>els.map(e=>e.dataset.patokan));
  const pengingatGanda=()=>page.$eval('#etikaGanda',e=>!e.hidden);
  const aturEtika=async target=>{for(let i=0;i<25;i++){const n=await page.evaluate(()=>App.state.form.crit.etika);if(n===target)return;await page.click(etikaBtn(n<target?1:-1));}throw new Error(`Etika tidak mencapai ${target}`);};
  await page.goto(base+'/penilaian-guide/');await page.waitForTimeout(800);await page.click('#tutSkip').catch(()=>{});
  await check('UJI-02 tanpa token hanya petunjuk tautan, tanpa daftar guide',async()=>{assert(await page.isVisible('#view-tautan'));assert.equal(await page.evaluate(()=>App.state.guides.length),0);assert.equal((await saran()).length,0);});
  await page.goto(base+'/penilaian-guide/#'+tokens[1]);await page.waitForFunction(()=>App.state.guides.length>30);
  await check('UJI-01 tautan pos tersimpan, guide dari Data Guide portal termuat, token hilang dari alamat',async()=>{assert(!page.url().includes(tokens[1]));assert.match(await page.textContent('#posLabel'),/Pos 1/);});
  // Dulu <datalist>: Firefox menampilkan label "Asing · Regu 1" menggantikan nama guide.
  // Perilaku sama dengan pemilih nama coaching/patroli: daftar muncul setelah 2 huruf, maks. 8 baris.
  const petunjuk=()=>page.$eval('#guidePetunjuk',e=>e.textContent);
  await check('Daftar saran menampilkan nama guide beserta ID dan regu, bukan hanya "Asing · Regu 1"',async()=>{
    await page.evaluate(()=>App.go('nilai'));await page.click('#guideInput');assert(await page.isHidden('#guideSaran'));assert.match(await petunjuk(),/Ketik minimal 2 huruf/);
    await page.fill('#guideInput','c');assert(await page.isHidden('#guideSaran'),'satu huruf belum membuka daftar');
    await page.fill('#guideInput','contoh a1');const rows=await saran();assert.equal(rows.length,8);assert.match(await petunjuk(),/Menampilkan 8 dari 10 hasil/);
    assert(rows.every(r=>/^Guide Contoh A1-\d\d$/.test(r.nama)&&/^G-\d{3} · Asing · Regu 1$/.test(r.meta)),JSON.stringify(rows));
    await page.keyboard.press('Escape');assert(await page.isHidden('#guideSaran'));
  });
  await check('Nama yang dipilih tidak membuka daftar lagi; nama lengkap yang diketik langsung terpilih',async()=>{
    await page.fill('#guideInput','contoh a2-0');await pilihSaran('Guide Contoh A2-05');assert(await page.isHidden('#guideSaran'));
    assert.match(await page.textContent('#guidePicked'),/Guide Contoh A2-05 · G-015/);
    await page.click('#guideInput');assert(await page.isHidden('#guideSaran'),'ketuk ulang kotak yang sudah terisi');
    await page.fill('#guideInput','Guide Contoh D2-07');assert(await page.isHidden('#guideSaran'));assert.equal(await page.evaluate(()=>App.state.form.guide.guideId),'G-037');
    await page.fill('#guideInput','');
  });
  await check('Filter Kategori/Regu menyaring saran; nama dari regu lain tetap ditawarkan dengan keterangan',async()=>{
    await page.selectOption('#filterKategori','Domestik');await page.selectOption('#filterRegu','2');
    await page.fill('#guideInput','contoh');const rows=await saran();assert.equal(rows.length,8);assert(rows.every(r=>r.meta.endsWith('Domestik · Regu 2')));
    await page.fill('#guideInput','A1-03');assert.match(await petunjuk(),/Tidak ada di Domestik · Regu 2/);assert.deepEqual((await saran()).map(r=>r.nama),['Guide Contoh A1-03']);
    await page.fill('#guideInput','zzz');assert(await page.isHidden('#guideSaran'));assert.match(await petunjuk(),/Guide tidak ditemukan/);
    await page.selectOption('#filterKategori','');await page.selectOption('#filterRegu','');await page.fill('#guideInput','');
  });
  await check('Keyboard: panah bawah lalu Enter memilih saran tanpa mengirim formulir',async()=>{
    await page.evaluate(()=>{window.__kirim=0;document.querySelector('#formEval').addEventListener('submit',()=>window.__kirim++);});
    await page.fill('#guideInput','contoh d1');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
    assert.equal(await page.inputValue('#guideInput'),'Guide Contoh D1-02');assert.equal(await page.evaluate(()=>App.state.form.guide.guideId),'G-022');
    assert(await page.isHidden('#guideSaran'));assert.equal(await page.evaluate(()=>window.__kirim),0);
  });
  await check('Isian 100 − potongan + Etika: Etika −10…+10 lewat tombol, bawaan 0, tanpa catatan wajib; ID dan seragam wajib; nama petugas sekali per shift',async()=>{
    await page.evaluate(()=>App.go('nilai'));
    assert.equal(await page.locator('#teguranList, [data-teguran]').count(),0,'daftar teguran tidak ada lagi');
    assert.equal(await page.textContent('#etikaNilai'),'0');
    // Patokan Etika selalu terlihat; baris "0 = standar" disorot selama angkanya 0.
    const patokan=await page.textContent('#etikaPatokan');
    assert.match(patokan,/0 = standar/);assert.match(patokan,/Minus \(sampai −10\) hanya untuk perilaku yang perlu ditegur/);assert.match(patokan,/Seragam dan ID-Card sudah dinilai di atas, jangan dikurangi lagi/);
    assert.match(patokan,/Plus \(sampai \+10\) hanya untuk yang benar-benar menonjol/);assert.match(patokan,/Rapi dan tertib termasuk standar/);
    assert.deepEqual(await patokanAktif(),['nol']);assert.equal(await pengingatGanda(),false);
    const tutorial=await page.evaluate(()=>App.TUT.map(t=>t.b).join(' '));assert.match(tutorial,/Etika: 0 = standar/);assert.doesNotMatch(tutorial,/Teguran/);
    assert.match(await page.textContent('#petunjukId'),/Terpasang = kartu ID resmi/);
    assert.equal(await page.$$eval('#beratSelect option',o=>o.length),6);assert(await page.isVisible('#petugasSelect'),'nama petugas diminta');
    await page.fill('#guideInput','Guide Contoh A1-0');await pilihSaran('Guide Contoh A1-03');await page.click('#btnSave');
    assert.match(await page.textContent('#toastWrap'),/Pilih ID-Card dan Seragam/);
    await page.click('.criterion[data-crit="idCard"] .seg[data-val="1"]');await page.click('.criterion[data-crit="seragam"] .seg[data-val="kurang"]');
    // Di batas bawah/atas tombolnya terkunci, jadi angkanya tidak pernah melewati −10/+10.
    await aturEtika(-10);assert.equal(await page.textContent('#etikaNilai'),'−10');assert(await page.isDisabled(etikaBtn(-1)));assert(await page.$eval('#etikaNilai',e=>e.classList.contains('minus')));
    // Seragam kurang lengkap sudah dipotong: Etika minus memunculkan pengingat hukuman ganda.
    assert.deepEqual(await patokanAktif(),['minus']);assert.equal(await pengingatGanda(),true);assert.match(await page.textContent('#etikaGanda'),/sudah dipotong/);
    await aturEtika(10);assert.equal(await page.textContent('#etikaNilai'),'+10');assert(await page.isDisabled(etikaBtn(1)));assert(!await page.isDisabled(etikaBtn(-1)));assert(await page.$eval('#etikaNilai',e=>e.classList.contains('plus')));
    assert.deepEqual(await patokanAktif(),['plus']);assert.equal(await pengingatGanda(),false);
    await aturEtika(-2);assert.equal(await page.textContent('#etikaNilai'),'−2');assert.equal(await page.getAttribute('#etikaNilai','aria-label'),'Etika minus 2');
    assert.deepEqual(await patokanAktif(),['minus']);assert.equal(await pengingatGanda(),true);
    // Pengingat mengikuti seragam: dengan seragam lengkap dan ID terpasang, Etika minus tanpa pengingat.
    await page.click('.criterion[data-crit="seragam"] .seg[data-val="lengkap"]');assert.equal(await pengingatGanda(),false);
    await page.click('.criterion[data-crit="seragam"] .seg[data-val="kurang"]');assert.equal(await pengingatGanda(),true);
    assert.equal(await page.evaluate(()=>App.catatanWajib()),false,'Etika boleh tanpa catatan');
    await page.click('#btnSave');assert.match(await page.textContent('#toastWrap'),/Pilih nama petugas/);assert.equal(rows(),0);
    await page.selectOption('#petugasSelect',petugasUji.id);await page.waitForSelector('#petugasBox [data-ganti-petugas]');
    assert.match(await page.textContent('#petugasBox'),/Petugas Uji Satu · berlaku sampai/);
  });
  await page.fill('#catatan','=IMPORTDATA("x")');await page.dispatchEvent('#catatan','input');await page.waitForTimeout(600);
  await check('UJI-13 draf pulih setelah dimuat ulang (termasuk seragam dan Etika), nama petugas tetap',async()=>{await page.reload();await page.waitForTimeout(1000);await page.evaluate(()=>App.go('nilai'));assert.equal(await page.inputValue('#guideInput'),'Guide Contoh A1-03');assert.equal(await page.inputValue('#catatan'),'=IMPORTDATA("x")');
    assert.deepEqual(await page.evaluate(()=>App.state.form.crit),{idCard:true,seragam:'kurang',etika:-2,berat:'',apresiasi:''});assert.equal(await page.textContent('#etikaNilai'),'−2');
    assert.match(await page.textContent('#petugasBox'),/Petugas Uji Satu/);});
  await page.click('#btnSave');await until(c=>c.synced===1,'kiriman pertama');await settle();
  await check('Simpan → ✅ hanya setelah portal menyimpan; Etika tersimpan bersama petugas; spreadsheet: catatan rumus tetap teks, kolom etika dan N–T terisi',async()=>{
    assert.equal(rows(),1);const saved=one(db,'SELECT * FROM visit_evaluations');assert.equal(saved.catatan,'=IMPORTDATA("x")');
    assert.deepEqual([saved.versi,saved.seragam,saved.etika,saved.teguran,saved.teguran_n,saved.petugas_nama],[2,'kurang',-2,'',0,'Petugas Uji Satu']);
    // Kurang lengkap (−10) dengan Etika −2 → 100 − 10 − 2 = 88.
    const tab=google.rows(saved.wita_date.slice(0,7));assert.equal(tab.length,1);assert.equal(tab[0][9],'=IMPORTDATA("x")');assert.equal(tab[0][8],-2);
    assert.deepEqual(tab[0].slice(13),[2,'Kurang lengkap','','','','Petugas Uji Satu',88]);
  });
  await pick('Guide Contoh A1-03');await page.click('#btnSave');await page.waitForTimeout(400);
  await check('UJI-05 guide & pos sama < 15 menit ditahan aplikasi tanpa tombol lanjut',async()=>{assert.match(await page.textContent('#guideAmbigu'),/server akan menolaknya/);assert.equal(await page.$('#guideAmbigu [data-lanjut]'),null);});
  await page.click('#guideAmbigu [data-fix]');await page.waitForSelector('#koreksiBar:not([hidden])');
  await check('Koreksi membuka isian lama (seragam, Etika) untuk dibetulkan',async()=>{assert.deepEqual(await page.evaluate(()=>App.state.form.crit),{idCard:true,seragam:'kurang',etika:-2,berat:'',apresiasi:''});assert.equal(await page.textContent('#etikaNilai'),'−2');assert.match(await page.textContent('#koreksiBar'),/Seragam Kurang lengkap, Etika −2/);});
  await page.click('.criterion[data-crit="seragam"] .seg[data-val="tidak"]');await aturEtika(1);await page.click('#btnSave');await until(c=>c.synced===2,'koreksi');
  await check('UJI-10 koreksi menandai baris lama diganti, dengan jam yang sama dan Etika baru',async()=>{const [a,b]=all(db,'SELECT * FROM visit_evaluations ORDER BY received_at');assert.equal(a.status,'diganti');assert.equal(b.status,'aktif');assert.equal(b.koreksi_dari,a.id);assert.equal(b.evaluated_at,a.evaluated_at);assert.deepEqual([a.etika,b.etika,b.seragam],[-2,1,'tidak']);});
  await ctx.setOffline(true);for(const name of ['Guide Contoh A2-01','Guide Contoh D1-02','Guide Contoh D2-03']){await pick(name,'lengkap','0');await page.click('#btnSave');await page.waitForTimeout(250);}
  assert.equal((await page.evaluate(()=>DB.counts())).pending,3);
  await ctx.setOffline(false);await page.evaluate(()=>window.dispatchEvent(new Event('online')));await until(c=>c.pending===0&&c.synced===5,'antrean offline');
  await check('UJI-03 tiga penilaian offline terkirim setelah online',async()=>{assert.equal(rows(),5);});
  await check('Nama kembar: saran membedakan ID/regu, dan guide yang dipilih tersimpan lewat guideId',async()=>{
    await page.evaluate(()=>App.go('nilai'));await page.fill('#guideInput','kembar');
    assert.deepEqual((await saran()).map(r=>[r.id,r.nama,r.meta]),[['G-090','Guide Kembar Uji','G-090 · Asing · Regu 1'],['G-091','Guide Kembar Uji','G-091 · Domestik · Regu 2']]);
    await page.click('#guideSaran [data-saran="G-091"]');assert(await page.isHidden('#guideSaran'));assert.match(await page.textContent('#guidePicked'),/G-091/);
    await page.click('.criterion[data-crit="idCard"] .seg[data-val="1"]');await page.click('.criterion[data-crit="seragam"] .seg[data-val="lengkap"]');
    // Laporan pelanggaran berat: catatan wajib, lalu menunggu verifikasi Pengelola.
    await page.click('#laporanBox summary');await page.selectOption('#beratSelect','pungutan');assert.match(await page.textContent('#catatanWajib'),/wajib/);
    await page.click('#btnSave');assert.match(await page.textContent('#toastWrap'),/Tulis catatan singkat/);
    await page.fill('#catatan','Meminta uang parkir ke tamu.');await page.dispatchEvent('#catatan','input');
    await page.click('#btnSave');await until(c=>c.synced===6,'nama kembar');
    assert.equal(one(db,"SELECT status FROM visit_flags WHERE guide_id='G-091'").status,'menunggu');
    assert.deepEqual(all(db,"SELECT guide_id FROM visit_evaluations WHERE guide_name='Guide Kembar Uji'").map(r=>r.guide_id),['G-091']);
  });
  await page.evaluate(()=>App.go('tautan'));await page.fill('#tautanInput',`${base}/penilaian-guide/#${tokens[3]}`);await page.click('#formTautan button[type=submit]');await page.waitForTimeout(1200);
  await check('UJI-27 tempel tautan Pos 3; pemilih pos muncul',async()=>{assert(await page.isVisible('#homePos'));assert.equal((await page.$$eval('#homePos option',o=>o.length)),2);});
  const csv=await page.evaluate(async()=>{let out='';const orig=App.download;App.download=(n,c)=>{out=c;};await App.exportCsv();App.download=orig;return out;});
  await check('UJI-17 CSV menulis temuan per pengantaran, jumlah Etika, dan rinciannya',async()=>{const lines=csv.split('\n').filter(l=>l.includes('A1-03'));
    assert(lines.some(l=>/;Tidak berseragam;1;;;;Petugas Uji Satu;/.test(l)),lines.join('\n'));assert(lines.some(l=>/;Kurang lengkap;-2;;;;Petugas Uji Satu;/.test(l)),'koreksi tercatat di bagian dibetulkan');
    // Rekap harian: 1 antar, 0 tanpa ID, 0 kurang lengkap, 1 tidak berseragam, jumlah Etika +1.
    assert(lines.some(l=>/;Guide Contoh A1-03;G-003;A1;1;0;0;1;1;0;0;/.test(l)),lines.join('\n'));
    assert.match(csv,/TANPA ID;KURANG LENGKAP;TIDAK BERSERAGAM;JUMLAH ETIKA;/);assert.match(csv,/;Seragam;Etika;Teguran \(formulir 2\.2\);/);});
  await check('Riwayat HP menampilkan seragam, Etika, laporan berat, dan nama petugas',async()=>{await page.evaluate(()=>App.go('riwayat'));await page.waitForTimeout(300);const t=await page.textContent('#historyList');assert.match(t,/Seragam Tidak berseragam/);assert.match(t,/Etika \+1/);assert.match(t,/Etika −2/);assert.doesNotMatch(t,/Teguran:/);assert.match(t,/Berat: Meminta uang/);assert.match(t,/👤 Petugas Uji Satu/);});
  assert.deepEqual(errors,[]);

  // Ruang kerja portal (layar laptop).
  const desk=await browser.newContext({viewport:{width:1280,height:900}}),portal=await desk.newPage(),portalErrors=[];
  portal.on('pageerror',e=>portalErrors.push(e.message));
  await portal.goto(base+'/');await portal.fill('#login-form [name=username]','kunjungan.uji');await portal.fill('#login-form [name=password]','UjiKunjungan!2026');await portal.click('#login-form [type=submit]');
  await portal.waitForSelector('.sidebar');await portal.goto(base+'/#visits');await portal.waitForSelector('text=Dashboard Kunjungan');
  await settle();
  await check('Dashboard menghitung penilaian dari portal dan menampilkan status salinan',async()=>{
    await portal.goto(base+'/#visits-records');await portal.goto(base+'/#visits');await portal.waitForSelector('.stat-value');
    const values=await portal.$$eval('.stat-card .stat-value',els=>els.map(e=>e.textContent.trim()));assert.equal(values[0],'5','5 pengantaran aktif (1 diganti), termasuk nama kembar');
    // Tidak berseragam (−20) + 3 tanpa ID (−60), Etika +1, dari 5 pengantaran → 100 − (80 − 1) ÷ 5 = 84,2.
    assert.equal(values[2],'84,2');const main=await portal.textContent('main');assert.match(main,/semua baris sudah tersalin/);assert.match(main,/1 laporan menunggu verifikasi/);assert.match(main,/Per petugas penilai/);
  });
  await check('Verifikasi: Pengelola menyetujui laporan pelanggaran berat; guide itu gugur reward',async()=>{
    await portal.goto(base+'/#visits-flags');await portal.waitForSelector('[data-visit="flag-approve"]');assert.match(await portal.textContent('main'),/Meminta uang parkir ke tamu\./);
    await portal.click('[data-visit="flag-approve"]');await portal.waitForSelector('dialog [data-confirm]');await portal.click('dialog [data-confirm]');await portal.waitForSelector('text=Laporan disetujui.');
    assert.equal(one(db,"SELECT status FROM visit_flags WHERE guide_id='G-091'").status,'disetujui');
    await portal.goto(base+'/#visits-reports');await portal.waitForSelector('text=Ringkasan per guide');assert.match(await portal.textContent('main'),/Gugur — pelanggaran berat/);
  });
  // Isi berkas .xlsx unduhan (ZIP tanpa kompresi, ditulis public/xlsx-export.js).
  const xlsxFiles=async download=>{const bytes=readFileSync(await download.path()),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),files=new Map();
    for(let at=0;view.getUint32(at,true)===0x04034b50;){const size=view.getUint32(at+18,true),nameLength=view.getUint16(at+26,true),extra=view.getUint16(at+28,true),begin=at+30+nameLength+extra;
      files.set(bytes.subarray(at+30,at+30+nameLength).toString(),bytes.subarray(begin,begin+size).toString());at=begin+size;}
    return files;};
  const sheetNames=files=>[...files.get('xl/workbook.xml').matchAll(/<sheet name="([^"]+)"/g)].map(m=>m[1]);
  await check('Penilaian: Ekspor Excel memuat rincian dan ringkasan per guide, persen berformat %',async()=>{
    await portal.goto(base+'/#visits-records');await portal.waitForSelector('[data-visit="export-records"]');
    const [download]=await Promise.all([portal.waitForEvent('download'),portal.click('[data-visit="export-records"]')]);
    const files=await xlsxFiles(download);assert.deepEqual(sheetNames(files),['Penilaian','Ringkasan per guide']);
    assert.match(files.get('xl/worksheets/sheet2.xml'),/ s="12"><v>/,'% ID dan % seragam berformat persen');
    await portal.waitForSelector('text=penilaian diekspor.');
  });
  await check('Laporan & Ekspor: bulanan (bawaan), mingguan, dan harian dengan pembanding, grafik tren yang terbaca papan ketik, dan ekspor Excel bersheet tren',async()=>{
    await portal.goto(base+'/#visits-reports');await portal.waitForSelector('[data-trend] svg');
    let main=await portal.textContent('main');
    assert.match(main,/Laporan bulanan per guide untuk penetapan reward dan arsip/);assert.match(main,/Status reward/);assert.match(main,/vs /,'kartu angka memuat pembanding');
    const periodBar=portal.locator('.visit-period'),monthPicker=periodBar.getByRole('combobox',{name:'Bulan laporan'});
    const selectedMonth=await monthPicker.inputValue(),monthText=await monthPicker.locator('option:checked').textContent();
    assert.equal(await periodBar.locator('.visit-stepper select').count(),1);
    assert.equal(await periodBar.getByText(monthText,{exact:true}).evaluateAll(elements=>elements.filter(el=>el.tagName!=='OPTION').length),0);
    await periodBar.getByRole('button',{name:'Bulan sebelumnya'}).click();
    await periodBar.getByRole('button',{name:'Bulan ini',exact:true}).waitFor();
    assert.notEqual(await monthPicker.inputValue(),selectedMonth);
    await monthPicker.selectOption(selectedMonth);
    await periodBar.getByRole('button',{name:'Bulan ini',exact:true}).waitFor({state:'detached'});
    assert(await periodBar.getByRole('button',{name:'Bulan berikutnya'}).isDisabled());
    assert.match(await portal.getAttribute('.visit-trend','aria-label'),/^Grafik tren \d+ hari/);
    // Papan ketik: fokus ke grafik membuka angka titik terakhir yang berisi; panah berpindah titik.
    await portal.focus('.visit-trend');await portal.waitForSelector('.visit-trend-tip:not([hidden])');
    const tipToday=await portal.textContent('.visit-trend-tip');assert.match(tipToday,/Nilai rata-rata/);assert.match(tipToday,/Pengantaran · \d+ guide/);
    assert.equal(await portal.locator('.viz-hover:not([hidden]) .viz-cross').count(),1,'garis bantu tampil');
    await portal.keyboard.press('Home');assert.notEqual(await portal.textContent('.visit-trend-tip'),tipToday);
    await portal.keyboard.press('Escape');assert.equal(await portal.locator('.visit-trend-tip[hidden]').count(),1);
    // Tabel padanan grafik.
    await portal.click('.visit-trend-table summary');assert(await portal.locator('.visit-trend-table tbody tr').count()>=1);
    // Mingguan: Senin–Minggu, tanpa status reward; pilihan diingat setelah dimuat ulang.
    await portal.click('[data-visit="report-mode"][data-mode="minggu"]');await portal.waitForSelector('text=Laporan mingguan');await portal.waitForSelector('[data-trend] svg');
    main=await portal.textContent('main');assert.doesNotMatch(main,/Layak reward/);assert.match(main,/Senin–Minggu WITA/);
    assert.equal(await portal.locator('th',{hasText:'Status reward'}).count(),0,'status reward hanya di laporan bulanan');
    assert.equal(await portal.locator('[data-visit="report-next"][disabled]').count(),1,'minggu depan belum bisa dibuka');
    await portal.reload();await portal.waitForSelector('[data-trend] svg');assert.match(await portal.textContent('main'),/Laporan mingguan/);
    await portal.click('[data-visit="trend-scope"][data-scope="tren"]');await portal.waitForFunction(()=>/^Grafik tren 12 minggu/.test(document.querySelector('.visit-trend')?.getAttribute('aria-label')||''));
    await portal.click('[data-visit="report-prev"]');await portal.waitForSelector('[data-visit="report-current"]');await portal.waitForSelector('[data-trend]');
    await portal.click('[data-visit="report-current"]');await portal.waitForFunction(()=>!document.querySelector('[data-visit="report-current"]'));await portal.waitForSelector('[data-trend] svg');
    // Ekspor mingguan: ringkasan + pembanding, per hari, tren 12 minggu, per regu/pos/guide; persen berformat %.
    const [download]=await Promise.all([portal.waitForEvent('download'),portal.click('[data-visit="export-report"]')]);
    assert.match(download.suggestedFilename(),/^laporan-mingguan-penilaian-guide-\d{4}-\d{2}-\d{2}-sd-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const files=await xlsxFiles(download);
    assert.deepEqual(sheetNames(files),['Ringkasan','Per hari','Tren 12 minggu','Per pos','Per regu','Ringkasan per guide']);
    assert.match(files.get('xl/worksheets/sheet1.xml'),/Pembanding: /);assert.match(files.get('xl/worksheets/sheet1.xml'),/ s="12"><v>/);
    assert.doesNotMatch(files.get('xl/worksheets/sheet6.xml'),/Status reward/);assert.match(files.get('xl/styles.xml'),/formatCode="0\.0%"/);
    await portal.waitForSelector('text=Laporan mingguan diekspor.');
    // Harian: per jam (WITA) bawaan, pembanding kemarin sampai jam yang sama, per petugas, rincian penilaian.
    await portal.click('[data-visit="report-mode"][data-mode="hari"]');await portal.waitForSelector('text=Laporan harian');await portal.waitForSelector('[data-trend] svg');
    assert.match(await portal.getAttribute('.visit-trend','aria-label'),/^Grafik tren \d+ jam/);
    main=await portal.textContent('main');assert.match(main,/Hari berjalan: angka sampai pukul \d\d\.\d\d, dibanding kemarin s\.d\. \d\d\.\d\d\./);
    assert.match(main,/Per petugas penilai/);assert.match(main,/Petugas Uji Satu/);assert.match(main,/Pos 1: \d+ · Pos 3: \d+/);
    assert.equal(await portal.locator('th',{hasText:'Status reward'}).count(),0);assert.equal(await portal.locator('[data-visit="report-next"][disabled]').count(),1,'besok belum bisa dibuka');
    await portal.focus('.visit-trend');await portal.waitForSelector('.visit-trend-tip:not([hidden])');assert.match(await portal.textContent('.visit-trend-tip'),/pukul \d\d\.00–\d\d\.59/);
    await portal.click('[data-visit="trend-scope"][data-scope="tren"]');await portal.waitForFunction(()=>/^Grafik tren 30 hari/.test(document.querySelector('.visit-trend')?.getAttribute('aria-label')||''));
    const exportDay=await portal.locator('[data-visit-field="reportDayPick"]').inputValue();
    const details='**/api/visits/records?**',gate=Promise.withResolvers();
    await portal.route(details,async route=>{await gate.promise;await route.continue();},{times:1});
    const downloadReady=portal.waitForEvent('download');
    try{
      await Promise.all([portal.waitForRequest(details),portal.click('[data-visit="export-report"]')]);
      await portal.click('[data-visit="report-prev"]');
    }finally{gate.resolve();}
    const daily=await downloadReady;
    assert.equal(daily.suggestedFilename(),`laporan-harian-penilaian-guide-${exportDay}.xlsx`);
    const dayFiles=await xlsxFiles(daily);
    assert.deepEqual(sheetNames(dayFiles),['Ringkasan','Per jam','Tren 30 hari','Per pos','Per regu','Per petugas','Ringkasan per guide','Penilaian']);
    assert.match(dayFiles.get('xl/worksheets/sheet1.xml'),/Pembanding: kemarin s\.d\. /);
    await portal.waitForSelector('text=Laporan harian diekspor.');
    await portal.waitForSelector('[data-visit="report-current"]');await portal.waitForSelector('text=hari sebelumnya');
    await portal.click('[data-visit="report-current"]');await portal.waitForFunction(()=>!document.querySelector('[data-visit="report-current"]'));
    await portal.click('[data-visit="report-records"]');await portal.waitForSelector('[data-visit="export-records"]');
    const today=await portal.evaluate(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Makassar'}).format(new Date()));
    assert.deepEqual(await portal.$$eval('[data-visit-field="from"],[data-visit-field="to"]',els=>els.map(e=>e.value)),[today,today],'rincian penilaian hari itu');
    await portal.goto(base+'/#visits-reports');await portal.waitForSelector('text=Laporan harian');
    // Kembali ke bulanan untuk pemeriksaan berikutnya.
    await portal.click('[data-visit="report-mode"][data-mode="bulan"]');await portal.waitForSelector('text=Laporan bulanan');await portal.waitForSelector('[data-trend] svg');
    // Ekspor bulanan: ditambah per minggu dan status reward.
    const [monthly]=await Promise.all([portal.waitForEvent('download'),portal.click('[data-visit="export-report"]')]);
    assert.match(monthly.suggestedFilename(),/^laporan-bulanan-penilaian-guide-\d{4}-\d{2}\.xlsx$/);
    const monthFiles=await xlsxFiles(monthly);
    assert.deepEqual(sheetNames(monthFiles),['Ringkasan','Per hari','Per minggu','Tren 12 bulan','Per pos','Per regu','Ringkasan per guide']);
    assert.match(monthFiles.get('xl/worksheets/sheet1.xml'),/Layak reward/);assert.match(monthFiles.get('xl/worksheets/sheet7.xml'),/Status reward/);
    assert.match(await portal.locator('.visit-stat').filter({hasText:'Layak reward'}).locator('.visit-stat-delta').textContent(),/vs /);
    const rewardCells=[...monthFiles.get('xl/worksheets/sheet1.xml').matchAll(/<c r="P[234]"><v>(-?\d+)<\/v>/g)].map(m=>Number(m[1]));
    assert.equal(rewardCells.length,3);assert.equal(rewardCells[2],rewardCells[0]-rewardCells[1]);
    // portal-api versi sebelumnya (tanpa rute laporan): rekap tetap tampil dari visits/overview, tanpa grafik.
    await portal.route('**/api/visits/report?**',r=>r.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Alamat API tidak ditemukan.'})}));
    await portal.reload();await portal.waitForSelector('text=Grafik tren dan pembanding belum tersedia');
    assert.equal(await portal.locator('[data-trend]').count(),0);assert.match(await portal.textContent('main'),/Ringkasan per guide/);
    assert.notEqual(await portal.textContent('.stat-card .stat-value'),'—');
    await portal.unroute('**/api/visits/report?**');
  });
  await check('Aturan Nilai: Etika −10…+10 tanpa potongan teguran; rencana bulan depan disimpan dan dibatalkan; petugas dan jenis apresiasi ditambah',async()=>{
    await portal.goto(base+'/#visits-scoring');await portal.waitForSelector('[data-visit="rule-edit"]');const main=await portal.textContent('main');
    assert.match(main,/Tanpa ID-Card/);assert.match(main,/100 − potongan \+ Etika/);assert.match(main,/−10 … \+10/);assert.doesNotMatch(main,/Per teguran/);
    assert.match(main,/Etika: 0 = standar \(tertib, tidak ada catatan khusus\)\. Minus hanya untuk perilaku yang perlu ditegur, bukan untuk seragam atau ID-Card/);
    assert.equal(await portal.locator('[data-visit="type-new"][data-jenis="teguran"]').count(),0,'jenis teguran tidak diatur lagi');
    await portal.click('[data-visit="rule-edit"]');assert.equal(await portal.locator('dialog [name=pot_teguran]').count(),0);
    // Tanpa ID + tidak berseragam paling banyak 90: dengan Etika −10 nilai tidak di bawah 0.
    await portal.fill('dialog [name=pot_id]','50');await portal.fill('dialog [name=pot_tidak]','41');await portal.click('dialog [type=submit]');
    await portal.waitForFunction(()=>/paling banyak 90/.test(document.querySelector('dialog .form-error')?.textContent||''));await portal.fill('dialog [name=pot_tidak]','40');await portal.click('dialog [type=submit]');await portal.waitForSelector('text=Rencana');
    const plan=one(db,'SELECT pot_id,pot_tidak,pot_teguran FROM visit_score_rules ORDER BY berlaku_mulai DESC LIMIT 1');assert.deepEqual([plan.pot_id,plan.pot_tidak,plan.pot_teguran],[50,40,0]);
    await portal.click('[data-visit="rule-delete"]');await portal.waitForSelector('dialog [data-confirm]');await portal.click('dialog [data-confirm]');await portal.waitForSelector('text=Rencana aturan dibatalkan.');
    assert.equal(one(db,'SELECT count(*) n FROM visit_score_rules').n,1);
    await portal.click('[data-visit="assessor-new"]');await portal.fill('dialog [name=nama]','Petugas Uji Dua');await portal.click('dialog [type=submit]');await portal.waitForSelector('text=Petugas disimpan.');
    await portal.click('[data-visit="type-new"][data-jenis="apresiasi"]');await portal.fill('dialog [name=label]','Menjaga kebersihan area suci');await portal.click('dialog [type=submit]');await portal.waitForSelector('text=Jenis temuan disimpan.');
    assert.equal(one(db,"SELECT count(*) n FROM visit_finding_types WHERE jenis='apresiasi' AND is_active=1").n,4);
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
  // Unduhan seluruh spreadsheet NilaiGuide: tab Dasbor lebih dulu, tab Evaluations dengan
  // tanggal sebagai nomor seri (jam WITA), kolom tambahan yang tidak dikirim, 1.004 baris → 2 bagian.
  const serial=(m,d,h)=>String(Date.UTC(2026,m-1,d,h,0)/86400000+25569);
  const evalStrings=['evaluationId','timestamp','pos','guideId','guideName','uniform','idCard','etika','catatan','status','aktif','diganti','Catatan rahasia petugas'];
  const col=i=>'ABCDEFGHIJ'[i],inl=t=>`<c t="inlineStr"><is><t>${t}</t></is></c>`,num=v=>`<c><v>${v}</v></c>`,bool=v=>`<c t="b"><v>${v?1:0}</v></c>`;
  const evalRow=(r,cells)=>`<row r="${r}">${cells.map((c,j)=>c.replace('<c',`<c r="${col(j)}${r}"`)).join('')}</row>`;
  const uuid=i=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
  const evalRows=[evalRow(1,evalStrings.slice(0,10).map((_,i)=>s(i)))];let masuk=0;
  for(let i=0;i<1000;i++){const pos=i%10===9?2:i%2?3:1;if(pos!==2)masuk++;const day=new Date(Date.UTC(2026,2,1+Math.floor(i/12)));
    evalRows.push(evalRow(i+2,[inl(uuid(i)),num(serial(day.getUTCMonth()+1,day.getUTCDate(),8+i%12)),num(pos),inl(`G-${String(1+i%40).padStart(3,'0')}`),inl('Nama di NilaiGuide'),i%3===0?bool(true):i%3===1?num(2):bool(false),bool(i%4!==0),num(i%5-2),s(12),s(10)]));}
  // Dikoreksi (status diganti), guide tak dikenal, ID bukan UUID, dan ID ganda.
  evalRows.push(evalRow(1002,[inl(uuid(5000)),num(serial(4,1,9)),num(1),inl('G-001'),inl('x'),bool(true),bool(true),num(0),inl(''),s(11)]));
  evalRows.push(evalRow(1003,[inl(uuid(5001)),num(serial(4,1,10)),num(1),inl('G-999'),inl('x'),bool(true),bool(true),num(0),inl(''),s(10)]));
  evalRows.push(evalRow(1004,[inl('bukan-uuid'),num(serial(4,1,11)),num(3),inl('G-001'),inl('x'),bool(true),bool(true),num(0),inl(''),s(10)]));
  evalRows.push(evalRow(1005,[inl(uuid(0)),num(serial(3,1,8)),num(1),inl('G-001'),inl('x'),bool(true),bool(true),num(0),inl(''),s(10)]));
  const historyFile=resolve(dataDir,'NilaiGuide.xlsx');
  writeFileSync(historyFile,zip([
    ['xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8"?><workbook ${ns}><sheets><sheet name="Dasbor" sheetId="1" r:id="rId7"/><sheet name="Evaluations" sheetId="2" r:id="rId8"/><sheet name="Guides" sheetId="3" r:id="rId9"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId8" Type="worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId9" Type="worksheet" Target="worksheets/sheet3.xml"/></Relationships>'],
    ['xl/sharedStrings.xml',`<?xml version="1.0" encoding="UTF-8"?><sst ${ns} count="${evalStrings.length}" uniqueCount="${evalStrings.length}">${evalStrings.map(t=>`<si><t>${t}</t></si>`).join('')}</sst>`],
    ['xl/worksheets/sheet1.xml',`<?xml version="1.0" encoding="UTF-8"?><worksheet ${ns}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>TOTAL</t></is></c></row></sheetData></worksheet>`],
    ['xl/worksheets/sheet2.xml',`<?xml version="1.0" encoding="UTF-8"?><worksheet ${ns}><sheetData>${evalRows.join('')}</sheetData></worksheet>`],
    ['xl/worksheets/sheet3.xml',`<?xml version="1.0" encoding="UTF-8"?><worksheet ${ns}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>guideId</t></is></c></row></sheetData></worksheet>`]]));
  const historyTotal=()=>visitDayRows(db,'2026-01-01','2026-06-30').reduce((n,r)=>n+r.n.antar,0);
  const historyCard=()=>portal.textContent('main');
  let sent=[],failPart=1;
  await portal.route('**/api/visits/history/import',route=>{const body=JSON.parse(route.request().postData());sent.push({mode:body.mode,part:body.part,bytes:route.request().postData().length,keys:Object.keys(body),catatan:route.request().postData().includes('rahasia')});
    if(body.mode==='apply'&&body.part===failPart){failPart=null;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Koneksi terputus (uji).'})});}
    return route.continue();});
  await check('Migrasi awal NilaiGuide: pratinjau .xlsx tanpa menyimpan; hanya kolom rekap yang dikirim, per bagian ≤100 KB',async()=>{
    await portal.goto(base+'/#visits-reports');await portal.waitForSelector('[data-visit="history-start"]');assert.match(await historyCard(),/Migrasi awal NilaiGuide/);
    await portal.click('[data-visit="history-start"]');await portal.setInputFiles('[data-history-file]',historyFile);await portal.waitForSelector('[data-history-result] .notice');
    const text=await portal.textContent('[data-history-result]');
    assert.match(text,new RegExp(`${masuk} penilaian masuk ke rekap`),text);assert.match(text,/Maret 2026/);assert.match(text,/Mei 2026/);
    assert.match(text,/evaluationId bukan UUID/);assert.match(text,/Baris berkas/);
    assert.match(await portal.textContent('[data-history-progress]'),/1\.004 baris dari sheet "Evaluations"\. Pratinjau/);
    assert.deepEqual(sent.map(x=>[x.mode,x.part]),[['preview',0],['preview',1]]);assert(sent.every(x=>x.bytes<100000&&!x.catatan),JSON.stringify(sent.map(x=>x.bytes)));
    assert.equal(one(db,'SELECT count(*) n FROM visit_history_import').n,0);assert.equal(one(db,"SELECT count(*) n FROM visit_daily_totals WHERE sumber='nilaiguide'").n,0);
  });
  await check('Migrasi awal NilaiGuide: koneksi putus di bagian 2 → belum dihitung; Lanjutkan dengan berkas sama menyelesaikannya',async()=>{
    sent=[];await portal.click('[data-history-apply]');await portal.waitForSelector('dialog [data-confirm]');await portal.click('dialog [data-confirm]');
    await portal.waitForSelector('text=Migrasi terhenti');assert.match(await portal.textContent('[data-history-result]'),/Koneksi terputus \(uji\)/);
    assert.equal(one(db,'SELECT status FROM visit_history_import').status,'menyusun');assert.equal(historyTotal(),0,'impor yang belum selesai tidak ikut dihitung');
    await portal.click('dialog[open] [data-close]');await portal.waitForSelector('text=Migrasi awal NilaiGuide belum selesai');assert.match(await historyCard(),/1 dari 2 bagian sudah diterima/);
    await portal.click('[data-visit="history-start"]');await portal.waitForSelector('text=Pilih berkas yang sama: NilaiGuide.xlsx');
    await portal.setInputFiles('[data-history-file]',historyFile);await portal.waitForSelector('[data-history-result] .notice');
    sent=[];await portal.click('[data-history-apply]');await portal.waitForSelector(`text=Migrasi awal selesai: ${masuk} penilaian`);
    assert.deepEqual(sent.map(x=>[x.mode,x.part]),[['apply',1]],'bagian yang sudah diterima tidak dikirim ulang');
    assert.equal(historyTotal(),masuk);assert.equal(one(db,'SELECT status FROM visit_history_import').status,'aktif');
    // Teks toast juga memuat "masuk ke rekap": tunggu kartunya di halaman, bukan toast.
    await portal.waitForFunction(()=>/Masuk ke rekap/.test(document.querySelector('main').textContent),null,{timeout:15000});assert.match(await historyCard(),/1 Mar 2026|1 Maret 2026/);
  });
  await check('Migrasi awal NilaiGuide: dibatalkan → rekapnya hilang, kartu kembali ke awal',async()=>{
    await portal.click('[data-visit="history-cancel"]');await portal.waitForSelector('dialog [data-confirm]');await portal.click('dialog [data-confirm]');
    await portal.waitForSelector('text=Migrasi awal dibatalkan.');await portal.waitForSelector('[data-visit="history-start"]');
    assert.equal(historyTotal(),0);assert.equal(one(db,"SELECT count(*) n FROM visit_daily_totals WHERE sumber='nilaiguide'").n,0);
    assert.equal(one(db,'SELECT status FROM visit_history_import').status,'dibatalkan');
  });
  await portal.unroute('**/api/visits/history/import');
  await check('Tautan Pos: periksa koneksi dan sinkronkan salinan spreadsheet',async()=>{
    await portal.goto(base+'/#visits-links');await portal.waitForSelector('text=Salinan spreadsheet');
    await portal.click('[data-visit="sheet-check"]');await portal.waitForSelector('.visit-check');
    assert.equal(await portal.$$eval('.visit-check li.ok',els=>els.length),4);await portal.click('dialog [data-close]');
    await portal.click('[data-visit="sheet-sync"]');await portal.waitForSelector('text=baris baru disalin');
    // Setelah sinkron halaman dimuat ulang; tunggu sampai selesai, jangan membaca "Memuat data…".
    await portal.waitForFunction(()=>/Penilaian Guide \d{4}/.test(document.querySelector('main').textContent),null,{timeout:15000});
  });
  // Regresi koreksi/draf: jalankan setelah pemeriksaan rekap yang memakai jumlah tetap.
  // Penilaian berikut hanya berada di HP sampai pemeriksaan terakhir, supaya tidak menambah data server fixture.
  await page.evaluate(()=>Sync.Settings.set({forceOffline:true}));
  // Penilaian bentuk lama yang masih tertinggal di HP dari versi sebelumnya.
  const simpanDiHp=(guideId,criteria,catatan='')=>page.evaluate(async ([id,criteria,catatan])=>{
    const g=App.state.guides.find(g=>g.guideId===id),evaluationId=App.uuid();
    await DB.save({evaluationId,guideId:id,guideName:g.guideName,pos:1,timestamp:DB.sekarangISO(),criteria,catatan,synced:false});
    return evaluationId;
  },[guideId,criteria,catatan]);
  const koreksiDiHp=async(guideId,criteria,catatan)=>{const id=await simpanDiHp(guideId,criteria,catatan);await page.evaluate(id=>App.mulaiKoreksi(id),id);return id;};
  const isianDiHp=id=>page.evaluate(async id=>(await DB.get(id)).criteria,id);
  // Nilai pengantaran dengan aturan bawaan (tanpa ID −20, kurang lengkap −10, tidak berseragam −20) + Etika.
  const nilaiDiHp=id=>page.evaluate(async id=>{const f=App.temuanDari((await DB.get(id)).criteria);return 100-20*f.tanpaId-10*f.kurang-20*f.tidak+f.etika;},id);
  // Koreksi tidak lagi menanyakan "hapus teguran lama": Etika lama dibawa apa adanya.
  let dialogs=0;page.on('dialog',async d=>{dialogs++;await d.dismiss();});
  await check('Koreksi cara lama: dibuka dengan Etika apa adanya; membetulkan ID tidak mengubah Etika dan tanpa pertanyaan',async()=>{
    const id=await koreksiDiHp('G-008',{idCard:false,uniform:1,etika:-1});
    assert.deepEqual(await page.evaluate(()=>App.state.form.crit),{idCard:false,seragam:'lengkap',etika:-1,berat:'',apresiasi:''});
    assert.equal(await page.textContent('#etikaNilai'),'−1');assert.equal(await page.locator('#teguranLamaNote').count(),0);
    assert.equal(await pengingatGanda(),true,'tanpa ID-Card dengan Etika minus');
    await page.click('.criterion[data-crit="idCard"] .seg[data-val="1"]');assert.equal(await pengingatGanda(),false);assert.deepEqual(await patokanAktif(),['minus']);
    await page.click('#btnSave');await page.waitForFunction(()=>!App.state.koreksi);
    assert.deepEqual(await isianDiHp(id),{idCard:true,seragam:'lengkap',etika:-1,berat:'',apresiasi:''});assert.equal(await nilaiDiHp(id),99);
    assert.equal(dialogs,0);
  });
  await check('Koreksi formulir 2.2: teguran dibuka sebagai Etika −1 per teguran, lalu disimpan sebagai formulir Etika',async()=>{
    const id=await koreksiDiHp('G-009',{idCard:true,seragam:'kurang',teguran:['antrean','merokok-hp'],berat:'',apresiasi:''});
    assert.match(await page.textContent('#koreksiBar'),/Seragam Kurang lengkap, 2 teguran/);
    assert.deepEqual(await page.evaluate(()=>App.state.form.crit),{idCard:true,seragam:'kurang',etika:-2,berat:'',apresiasi:''});assert.equal(await page.textContent('#etikaNilai'),'−2');
    await aturEtika(-1);await page.click('#btnSave');await page.waitForFunction(()=>!App.state.koreksi);
    assert.deepEqual(await isianDiHp(id),{idCard:true,seragam:'kurang',etika:-1,berat:'',apresiasi:''});assert.equal(await nilaiDiHp(id),89);
    assert.equal(dialogs,0);
  });
  await check('Draf versi sebelumnya: teguran 2.2 menjadi Etika −1 per teguran; Etika cara lama dibatasi −5…+5, formulir Etika −10…+10',async()=>{
    const pulihkan=crit=>page.evaluate(async crit=>{await DB.simpanDraftSegera({...App.state.form,crit});App.state.form.crit={};await App.loadDraft();return App.state.form.crit;},crit);
    assert.deepEqual(await pulihkan({idCard:true,seragam:'lengkap',teguran:['antrean','merokok-hp'],berat:'',apresiasi:''}),{idCard:true,seragam:'lengkap',etika:-2,berat:'',apresiasi:''});
    assert.equal((await pulihkan({idCard:true,seragam:'lengkap',teguran:[],berat:'',apresiasi:''})).etika,0);
    assert.deepEqual(await pulihkan({idCard:true,uniform:1,etika:-7}),{idCard:true,seragam:null,etika:-5,berat:'',apresiasi:''});
    assert.equal((await pulihkan({idCard:false,seragam:'tidak',etika:7,berat:'',apresiasi:''})).etika,7);
    assert.equal((await pulihkan({idCard:false,seragam:'tidak',etika:25,berat:'',apresiasi:''})).etika,10);
    assert.equal(await page.textContent('#etikaNilai'),'+10');
    await page.evaluate(()=>{DB.hapusDraft();App.resetForm(true);});assert.equal(await page.textContent('#etikaNilai'),'0');
  });
  await check('Laporan nonaktif tetap terlihat dalam koreksi/draf dan hanya hilang setelah dipilih Tidak ada',async()=>{
    const id=await page.evaluate(async()=>{
      window.__penilaianBefore=DB.getPenilaian();const k=structuredClone(window.__penilaianBefore);
      k.berat=k.berat.filter(t=>t.kode!=='kasar');k.apresiasi=k.apresiasi.filter(t=>t.kode!=='menolong');DB.setPenilaian(k);
      const g=App.state.guides.find(g=>g.guideId==='G-010'),evaluationId=App.uuid();
      await DB.save({evaluationId,guideId:g.guideId,guideName:g.guideName,pos:1,timestamp:DB.sekarangISO(),criteria:{idCard:true,seragam:'lengkap',etika:0,berat:'kasar',apresiasi:'menolong'},catatan:'Catatan laporan semula.',synced:false});
      await App.mulaiKoreksi(evaluationId);return evaluationId;
    });
    for(const [sel,kode]of [['#beratSelect','kasar'],['#apresiasiSelect','menolong']]){
      assert.equal(await page.inputValue(sel),kode);assert.match(await page.$eval(`${sel} option:checked`,e=>e.textContent),/tidak aktif/);
    }
    await page.evaluate(async()=>{await DB.simpanDraftSegera(App.state.form);App.state.form.crit.berat='';App.state.form.crit.apresiasi='';await App.loadDraft();});
    assert.equal(await page.inputValue('#beratSelect'),'kasar');assert.equal(await page.inputValue('#apresiasiSelect'),'menolong');
    await page.selectOption('#beratSelect','');await page.selectOption('#apresiasiSelect','');await page.click('#btnSave');await page.waitForFunction(()=>!App.state.koreksi);
    const criteria=await page.evaluate(async id=>(await DB.get(id)).criteria,id);assert.equal(criteria.berat,'');assert.equal(criteria.apresiasi,'');
    assert.equal(await page.$('#beratSelect option[value="kasar"]'),null);assert.equal(await page.$('#apresiasiSelect option[value="menolong"]'),null,'laporan baru tidak menawarkan jenis nonaktif');
    await page.evaluate(()=>{DB.setPenilaian(window.__penilaianBefore);delete window.__penilaianBefore;App.renderPenilaianForm();});
  });
  await check('Server belum menyimpan Etika: penilaian Etika ditahan di HP (bukan ditolak), formulir lama tetap terkirim; setelah server siap terkirim sendiri',async()=>{
    // guide-form sebelum Etika menerima formulir baru tetapi membuang Etika-nya; bahan formulirnya tanpa `etika`.
    const terkirim=[],bentukEtika=e=>typeof e.criteria.seragam==='string'&&typeof e.criteria.etika==='number';
    await page.route('**/api/guide-form/context',async route=>{const res=await route.fetch(),body=await res.json();delete body.penilaian.etika;await route.fulfill({response:res,json:body});});
    await page.route('**/api/guide-form/submit',route=>{terkirim.push(...JSON.parse(route.request().postData()).evaluations);return route.continue();});
    // Bahan formulir yang tersimpan berasal dari server lama itu.
    await page.evaluate(()=>{const k=DB.getPenilaian();delete k.etika;DB.setPenilaian(k);});
    await simpanDiHp('G-038',{idCard:true,seragam:'lengkap',teguran:['antrean'],berat:'',apresiasi:''});
    await simpanDiHp('G-039',{idCard:true,uniform:2,etika:3});
    await pick('Guide Contoh D2-10');await aturEtika(2);await page.click('#btnSave');await page.waitForFunction(()=>App.state.form.guide===null);
    // Formulir Etika di HP: koreksi G-008, G-009, G-010 dan penilaian baru G-040.
    const etikaDiHp=await page.evaluate(async()=>(await DB.pending()).filter(e=>typeof e.criteria?.seragam==='string'&&typeof e.criteria?.etika==='number').map(e=>e.guideId).sort());
    assert.deepEqual(etikaDiHp,['G-008','G-009','G-010','G-040']);
    await page.evaluate(async()=>{Sync.Settings.set({forceOffline:false});await Sync.refreshGuides({force:true});await Sync.syncNow();});
    await until(c=>c.pending===4,'formulir lama terkirim, formulir Etika menunggu');
    await page.waitForFunction(()=>!document.querySelector('#serverNotice').hidden);
    assert.match(await page.textContent('#serverNotice'),/4 penilaian menunggu portal diperbarui/);
    assert.equal(await page.evaluate(()=>DB.getPenilaian().etika),undefined,'tanda Etika dari server sebelumnya tidak terbawa');
    assert.deepEqual(terkirim.filter(bentukEtika),[],'tidak ada formulir Etika yang dikirim ke server lama');
    assert.deepEqual(terkirim.map(e=>e.guideId).sort(),['G-038','G-039']);
    assert(await page.evaluate(async()=>(await DB.pending()).every(e=>!e.tolakan&&!e.lastError)),'ditahan bukan ditolak');assert.equal((await page.evaluate(()=>DB.counts())).buntu,0);
    const lama=Object.fromEntries(all(db,"SELECT guide_id,versi,teguran,etika FROM visit_evaluations WHERE guide_id IN ('G-038','G-039')").map(r=>[r.guide_id,[r.versi,r.teguran,r.etika]]));
    assert.deepEqual(lama,{'G-038':[2,'antrean',-1],'G-039':[1,'',3]});
    assert.equal(one(db,"SELECT count(*) n FROM visit_evaluations WHERE guide_id IN ('G-008','G-009','G-010','G-040')").n,0);
    await page.evaluate(()=>App.go('riwayat'));await page.waitForTimeout(300);
    const riwayat=await page.textContent('#historyList');assert.match(riwayat,/Teguran: Tidak tertib antrean/);assert.match(riwayat,/Uniform Bagus/);assert.match(riwayat,/Etika \+3/);assert.match(riwayat,/Etika \+2/);
    // Server diperbarui: bahan formulirnya kembali membawa `etika` (Tes Koneksi atau pembaruan 10 menit).
    await page.unroute('**/api/guide-form/context');
    await page.evaluate(async()=>{await Sync.ping();for(let i=0;i<20&&(await Sync.syncNow()).skipped;i++)await new Promise(r=>setTimeout(r,250));});
    await until(c=>c.pending===0,'formulir Etika terkirim setelah server siap');
    await page.waitForFunction(()=>document.querySelector('#serverNotice').hidden);
    assert.deepEqual(terkirim.filter(bentukEtika).map(e=>[e.guideId,e.criteria.etika]).sort(),[['G-008',-1],['G-009',-1],['G-010',0],['G-040',2]]);
    const saved=one(db,"SELECT * FROM visit_evaluations WHERE guide_id='G-040' AND status='aktif'");
    assert(saved,'penilaian baru benar-benar tersimpan di server');assert.deepEqual([saved.etika,saved.teguran,saved.teguran_n],[2,'',0]);
    // Tanpa temuan dengan Etika +2 → 102.
    assert.equal(visitOverview(db,saved.wita_date,saved.wita_date).perGuide.find(g=>g.guideId==='G-040').nilai,102);
    await page.unroute('**/api/guide-form/submit');await settle();
  });

  // Menu Review Negatif dan Komplain di HP pos (keputusan pemilik 23 November 2026).
  const saranLap=()=>page.$$eval('#lapGuideSaran .saran-item',els=>els.map(e=>({id:e.dataset.lapSaran,nama:e.querySelector('.saran-nama').textContent})));
  const pilihLap=async(ketik,id)=>{await page.fill('#lapGuideInput',ketik);await page.click(`#lapGuideSaran [data-lap-saran="${id}"]`);assert.match(await page.textContent('#lapGuidePicked'),new RegExp(id));};
  const toastTerakhir=()=>page.$$eval('#toastWrap .toast',els=>els.length?els.at(-1).textContent:'');
  // Toast "tersimpan" muncul setelah penyimpanan IndexedDB selesai (dan toast kiriman bisa
  // langsung menyusul), jadi ditunggu di antara semua toast yang tampil.
  const tungguToast=async re=>{const end=Date.now()+5000;for(;;){const t=await page.$$eval('#toastWrap .toast',els=>els.map(e=>e.textContent).join(' | '));if(re.test(t))return t;if(Date.now()>end)throw new Error(`Menunggu toast ${re}: "${t}"`);await page.waitForTimeout(100);}};
  const patokanLap=()=>page.$$eval('[data-patokan-jenis].aktif',els=>els.map(e=>e.dataset.patokanJenis));
  await check('HP: menu Review Negatif dan Komplain dari Beranda dan menu utama; nama petugas wajib, guide dipilih dari daftar, jenis keluhan, tanggal kejadian; pindah menu mempertahankan isian; draf pulih',async()=>{
    await page.evaluate(()=>{Sync.Settings.set({petugas:null});App.go('home');});
    for(const view of ['review','komplain']){assert.equal(await page.locator(`#view-home .duatombol [data-nav="${view}"]`).count(),1);assert.equal(await page.locator(`#drawer [data-nav="${view}"]`).count(),1);}
    assert.equal(await page.textContent('.criterion[data-crit="idCard"] .crit-icon'),'🆔','ikon ID-Card yang terbaca di HP lama');
    await page.click('#view-home .duatombol [data-nav="review"]');
    assert(await page.isVisible('#view-laporan'));assert.equal(await page.textContent('#appTitle'),'Review Negatif');assert.deepEqual(await patokanLap(),['review']);
    assert(await page.isHidden('#lapKronologi'));assert(await page.isHidden('#lapWisKontak'));assert(await page.isHidden('#lapServer'));
    assert.equal(await page.inputValue('#lapTanggal'),await page.evaluate(()=>DB.tanggalLokal()));
    assert.deepEqual(await page.$$eval('#lapKode option',o=>o.map(x=>x.value)),['','kurang-ramah','penjelasan-kurang','terburu-buru','terlambat','review-lain']);
    // Nama petugas wajib; pilihannya sama dengan formulir penilaian (sekali per shift).
    assert.match(await page.textContent('#lapPetugasBox'),/Nama petugas yang mencatat \(wajib/);
    await page.click('#btnSaveLaporan');assert.match(await toastTerakhir(),/Pilih nama petugas/);
    await page.selectOption('#lapPetugasSelect',petugasUji.id);await page.waitForSelector('#lapPetugasBox [data-ganti-petugas]');
    assert.match(await page.textContent('#lapPetugasBox'),/Petugas Uji Satu · berlaku sampai/);assert.match(await page.textContent('#petugasBox'),/Petugas Uji Satu/);
    // Guide tidak pernah ditebak dari ketikan.
    await page.fill('#lapGuideInput','contoh a2-0');assert((await saranLap()).length>1);await page.click('#btnSaveLaporan');assert.match(await toastTerakhir(),/Pilih guide dari daftar/);
    await page.click('#lapGuideSaran [data-lap-saran="G-011"]');assert.match(await page.textContent('#lapGuidePicked'),/Guide Contoh A2-01 · G-011/);assert(await page.isHidden('#lapGuideSaran'));
    await page.click('#btnSaveLaporan');assert.match(await toastTerakhir(),/Pilih jenis keluhan/);
    await page.selectOption('#lapKode','kurang-ramah');await page.click('#btnSaveLaporan');assert.match(await toastTerakhir(),/Tulis apa kata wisatawan/);
    await page.fill('#lapKeterangan','Tamu bilang guide membentak saat antre.');
    // Pindah menu: guide dan ketikan tetap, jenis keluhan dipilih ulang dari daftar menu tujuan.
    await page.click('#lapGantiJenis');assert.equal(await page.textContent('#appTitle'),'Komplain');assert(await page.isVisible('#lapKronologi'));assert.deepEqual(await patokanLap(),['komplain']);
    assert.deepEqual([await page.inputValue('#lapGuideInput'),await page.inputValue('#lapKeterangan'),await page.inputValue('#lapKode')],['Guide Contoh A2-01','Tamu bilang guide membentak saat antre.','']);
    assert.equal(await page.$$eval('#lapKode option[value^="komplain-"]',o=>o.length),5);
    await page.click('#lapGantiJenis');assert.equal(await page.textContent('#appTitle'),'Review Negatif');await page.selectOption('#lapKode','kurang-ramah');
    // Draf terenkripsi pulih setelah dimuat ulang.
    await page.waitForTimeout(500);await page.reload();await page.waitForFunction(()=>App.state.initialised&&App.state.guides.length>30);
    await page.evaluate(()=>App.go('review'));
    assert.deepEqual([await page.inputValue('#lapGuideInput'),await page.inputValue('#lapKode'),await page.inputValue('#lapKeterangan')],['Guide Contoh A2-01','kurang-ramah','Tamu bilang guide membentak saat antre.']);
    assert.equal(await page.evaluate(()=>localStorage.getItem('bpb.pg.draftLaporan').includes('membentak')),false,'draf tidak tersimpan polos');
  });
  await check('HP: review negatif dan komplain masuk antrean yang sama dan terkirim; bukan penilaian (Beranda, Riwayat tanpa Perbaiki, CSV terpisah tanpa data wisatawan)',async()=>{
    const before=await page.evaluate(()=>DB.counts()),pos=await page.evaluate(()=>App.state.form.pos);
    await page.click('#btnSaveLaporan');await tungguToast(/Review negatif tersimpan/);
    await until(c=>c.synced===before.synced+1,'review negatif terkirim');
    const review=one(db,"SELECT * FROM visit_guest_reports WHERE guide_id='G-011'");
    assert.deepEqual([review.status,review.jenis,review.kode,review.keterangan,review.petugas_nama,review.pos,review.kronologi,review.wisatawan_kontak],['menunggu','review','kurang-ramah','Tamu bilang guide membentak saat antre.','Petugas Uji Satu',pos,'','']);
    // Komplain lewat menu utama; Enter memilih satu-satunya saran tanpa menyimpan.
    await page.evaluate(()=>App.go('home'));await page.click('#btnMenu');await page.click('#drawer [data-nav="komplain"]');
    assert.equal(await page.textContent('#appTitle'),'Komplain');assert.equal(await page.inputValue('#lapGuideInput'),'','formulir kosong setelah disimpan');
    await page.fill('#lapGuideInput','contoh d1-02');assert.equal((await saranLap()).length,1);await page.press('#lapGuideInput','Enter');
    assert.match(await page.textContent('#lapGuidePicked'),/G-022/);assert.equal((await page.evaluate(()=>DB.counts())).pending,0);
    // Tanggal kejadian kemarin (bila masih bulan yang sama), dalam batas 7 hari ke belakang.
    const tanggal=await page.evaluate(()=>{const t=DB.tanggalLokal(),d=new Date(t+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-1);const k=d.toISOString().slice(0,10);return k.slice(0,7)===t.slice(0,7)?k:t;});
    await page.selectOption('#lapKode','komplain-memaksa');await page.fill('#lapTanggal',tanggal);await page.fill('#lapKeterangan','Tamu dipaksa membeli kain di kios.');
    await page.click('#btnSaveLaporan');assert.match(await toastTerakhir(),/Tulis kronologi komplain/);
    await page.fill('#lapKronologi','Setelah turun dari bus, guide membawa tamu ke kios dan menolak melanjutkan tur sebelum tamu membeli.');
    await page.fill('#lapWisNama','Tamu Uji');await page.fill('#lapWisAsal','Australia');await page.fill('#lapWisKontak','+61 400 000 000');
    await page.click('#btnSaveLaporan');await tungguToast(/Komplain tersimpan/);
    await until(c=>c.synced===before.synced+2,'komplain terkirim');
    const komplain=one(db,"SELECT * FROM visit_guest_reports WHERE guide_id='G-022'");
    assert.deepEqual([komplain.status,komplain.jenis,komplain.kode,komplain.wita_date,komplain.wisatawan_nama,komplain.wisatawan_asal,komplain.wisatawan_kontak],['menunggu','komplain','komplain-memaksa',tanggal,'Tamu Uji','Australia','+61 400 000 000']);
    assert.match(komplain.kronologi,/menolak melanjutkan tur/);
    // Pengaman rollback: catatan di HP membawa seragam "laporan" yang pasti ditolak bila dikirim PWA 2.3.
    assert(await page.evaluate(async()=>(await DB.all()).filter(e=>e.laporan).every(e=>e.criteria?.seragam==='laporan')));
    // Beranda: "Penilaian Hari Ini" tidak bertambah; catatan dihitung terpisah.
    await page.evaluate(()=>App.go('home'));
    assert.equal(await page.textContent('#statTotal'),String(before.today));assert.match(await page.textContent('#laporanHariIni'),/dicatat hari ini: 2/);
    // Riwayat: kartu catatan tanpa tombol Perbaiki dan tanpa data wisatawan.
    await page.evaluate(()=>App.go('riwayat'));await page.click('.chip[data-filter="laporan"]');await page.waitForTimeout(300);
    const t=await page.textContent('#historyList');
    assert.match(t,/👎 Review negatif: Kurang ramah atau tidak sopan/);assert.match(t,/📢 Komplain: Memaksa belanja atau donasi/);assert.match(t,/Terkirim — menunggu keputusan Pengelola/);
    assert.match(t,/Data wisatawan tercatat/);assert.doesNotMatch(t,/\+61 400|Tamu Uji/);
    assert.equal(await page.locator('#historyList .card').count(),2);assert.equal(await page.locator('#historyList [data-fix]').count(),0);
    await page.click('.chip[data-filter="all"]');
    const csv=await page.evaluate(async()=>{let out='';const orig=App.download;App.download=(n,c)=>{out=c;};await App.exportCsv();App.download=orig;return out;});
    const penilaian=await page.evaluate(async()=>(await DB.all()).filter(e=>!DB.bukanPenilaian(e)).length);
    assert.match(csv,new RegExp(`Total penilaian;${penilaian}\r`));assert.match(csv,/Review negatif tercatat;1/);assert.match(csv,/Komplain tercatat;1/);assert.match(csv,/REVIEW NEGATIF & KOMPLAIN/);
    assert.match(csv,/;Review negatif;G-011;Guide Contoh A2-01;Kurang ramah atau tidak sopan;Tamu bilang guide membentak saat antre\.;;Petugas Uji Satu;Terkirim;/);
    assert.match(csv,/;Komplain;G-022;Guide Contoh D1-02;Memaksa belanja atau donasi;Tamu dipaksa membeli kain di kios\.;Setelah turun dari bus/);assert.doesNotMatch(csv,/\+61 400|Tamu Uji|Australia/);
  });
  await check('Server belum menerima review negatif & komplain: catatan ditahan di HP (bukan ditolak) dengan spanduk; setelah server siap terkirim sendiri tanpa kunci evaluations',async()=>{
    const bodies=[];
    await page.route('**/api/guide-form/context',async route=>{const res=await route.fetch(),body=await res.json();delete body.penilaian.laporan;await route.fulfill({response:res,json:body});});
    await page.route('**/api/guide-form/submit',route=>{bodies.push(JSON.parse(route.request().postData()));return route.continue();});
    await page.evaluate(()=>Sync.refreshGuides({force:true}));assert.equal(await page.evaluate(()=>Sync.serverTerimaLaporan()),false);
    await page.evaluate(()=>App.go('review'));assert(await page.isVisible('#lapServer'));assert.match(await page.textContent('#lapServer'),/Portal belum menerima review negatif/);
    await pilihLap('contoh a2-06','G-016');await page.selectOption('#lapKode','terlambat');await page.fill('#lapKeterangan','Tamu menunggu guide 40 menit.');
    await page.click('#btnSaveLaporan');await tungguToast(/Review negatif tersimpan/);
    await page.evaluate(async()=>{for(let i=0;i<20&&(await Sync.syncNow()).skipped;i++)await new Promise(r=>setTimeout(r,250));});
    await page.waitForFunction(()=>!document.querySelector('#serverNotice').hidden);
    const notice=await page.textContent('#serverNotice');assert.match(notice,/1 review negatif\/komplain menunggu portal diperbarui/);assert.doesNotMatch(notice,/penilaian menunggu/);
    assert(bodies.every(b=>!b.laporan),'server lama tidak pernah menerima catatan');
    assert(await page.evaluate(async()=>(await DB.pending()).every(e=>!e.tolakan&&!e.lastError)),'ditahan bukan ditolak');
    assert.equal(one(db,"SELECT count(*) n FROM visit_guest_reports WHERE guide_id='G-016'").n,0);
    // Server diperbarui: bahan formulirnya membawa `laporan` lagi (Tes Koneksi atau pembaruan 10 menit).
    await page.unroute('**/api/guide-form/context');
    await page.evaluate(async()=>{await Sync.ping();for(let i=0;i<20&&(await Sync.syncNow()).skipped;i++)await new Promise(r=>setTimeout(r,250));});
    await until(c=>c.pending===0,'catatan terkirim setelah server siap');await page.waitForFunction(()=>document.querySelector('#serverNotice').hidden);
    assert(bodies.some(b=>Array.isArray(b.laporan)&&b.laporan.length===1&&b.evaluations===undefined),JSON.stringify(bodies.map(Object.keys)));
    assert.equal(one(db,"SELECT kode FROM visit_guest_reports WHERE guide_id='G-016'").kode,'terlambat');
    await page.unroute('**/api/guide-form/submit');
  });
  await check('Verifikasi: Pengelola melihat review negatif dan komplain (dengan data wisatawan), menyetujui review dengan potongan bawaan yang bisa diubah, komplain wajib klarifikasi, memindah dan menolak; laporan bulanan: gugur komplain dan nilai akhir; potongan bawaan di Aturan Nilai',async()=>{
    await settle();
    await portal.goto(base+'/#visits');await portal.reload();await portal.waitForSelector('text=Dashboard Kunjungan');await portal.waitForSelector('.stat-value');
    const dash=await portal.textContent('main');assert.match(dash,/3 laporan menunggu verifikasi/);assert.match(dash,/1 komplain, 2 review negatif/);
    await portal.goto(base+'/#visits-flags');await portal.waitForSelector('[data-visit="guest-approve"]');
    const main=await portal.textContent('main');
    assert.match(main,/Kurang ramah atau tidak sopan/);assert.match(main,/Memaksa belanja atau donasi/);assert.match(main,/Wisatawan: Tamu Uji · Australia · \+61 400 000 000/);assert.match(main,/Kronologi: Setelah turun dari bus/);
    const row=name=>portal.locator('tr',{hasText:name});
    // Review negatif: isian potongan berisi potongan bawaan (5) dan boleh diganti.
    await row('Guide Contoh A2-01').locator('[data-visit="guest-approve"]').click();await portal.waitForSelector('dialog [name=potongan]');
    assert.equal(await portal.inputValue('dialog [name=potongan]'),'5');await portal.fill('dialog [name=potongan]','25');await portal.click('dialog [type=submit]');await portal.waitForSelector('text=Review negatif disetujui.');
    assert.deepEqual({...one(db,"SELECT status,potongan FROM visit_guest_reports WHERE guide_id='G-011'")},{status:'disetujui',potongan:25});
    // Komplain: klarifikasi guide wajib sebelum disetujui.
    await row('Guide Contoh D1-02').locator('[data-visit="guest-approve"]').click();await portal.waitForSelector('dialog [name=klarifikasi]');
    await portal.click('dialog [type=submit]');await portal.waitForTimeout(300);assert.equal(one(db,"SELECT status FROM visit_guest_reports WHERE guide_id='G-022'").status,'menunggu');
    await portal.fill('dialog [name=klarifikasi]','Guide tidak menanggapi saat dihubungi.');await portal.click('dialog [type=submit]');await portal.waitForSelector('text=Komplain disetujui.');
    assert.equal(one(db,"SELECT status FROM visit_guest_reports WHERE guide_id='G-022'").status,'disetujui');
    // Review yang ternyata dugaan pelanggaran dipindah ke komplain, lalu ditolak dengan alasan.
    await row('Guide Contoh A2-06').locator('[data-visit="guest-move"]').click();await portal.waitForSelector('dialog [name=kode]');
    await portal.selectOption('dialog [name=kode]','komplain-menelantarkan');await portal.click('dialog [type=submit]');await portal.waitForSelector('text=Catatan dipindah ke komplain.');
    await row('Guide Contoh A2-06').locator('[data-visit="guest-reject"]').click();await portal.waitForSelector('dialog [name=catatan][required]');
    await portal.fill('dialog [name=catatan][required]','Tamu salah mengenali guide.');await portal.click('dialog [type=submit]');await portal.waitForSelector('text=Catatan ditolak.');
    assert.deepEqual({...one(db,"SELECT status,jenis,jenis_awal,kode FROM visit_guest_reports WHERE guide_id='G-016'")},{status:'ditolak',jenis:'komplain',jenis_awal:'review',kode:'komplain-menelantarkan'});
    // Laporan bulanan: komplain menggugurkan, review memotong nilai akhir; ekspor tanpa data wisatawan.
    await portal.goto(base+'/#visits-reports');await portal.waitForSelector('text=Ringkasan per guide');await portal.waitForSelector('[data-trend] svg');
    const report=await portal.textContent('main');assert.match(report,/Gugur — komplain/);assert.match(report,/Nilai akhir/);
    const today=witaDate(Date.now()),perGuide=visitOverview(db,`${today.slice(0,7)}-01`,today).perGuide,g11=perGuide.find(x=>x.guideId==='G-011'),g22=perGuide.find(x=>x.guideId==='G-022');
    assert.deepEqual([g11.potonganReview,g11.nilaiAkhir],[25,Math.max(0,g11.nilai-25)]);assert.deepEqual([g22.status,g22.sebab,g22.nilaiAkhir,g22.peringkat],['gugur','komplain',0,null]);
    const [monthly]=await Promise.all([portal.waitForEvent('download'),portal.click('[data-visit="export-report"]')]);
    const files=await xlsxFiles(monthly);assert.deepEqual(sheetNames(files).map(n=>n.replaceAll('&amp;','&')),['Ringkasan','Per hari','Per minggu','Tren 12 bulan','Per pos','Per regu','Ringkasan per guide','Review & komplain']);
    const sheet=files.get('xl/worksheets/sheet8.xml');assert.match(sheet,/Memaksa belanja atau donasi/);assert.match(sheet,/Guide tidak menanggapi saat dihubungi\./);assert.doesNotMatch(sheet,/\+61 400|Tamu Uji/);
    await portal.waitForSelector('text=Laporan bulanan diekspor.');
    // Potongan bawaan saat menyetujui review negatif.
    await portal.goto(base+'/#visits-scoring');await portal.waitForSelector('[data-visit="report-settings"]');
    assert.match(await portal.textContent('main'),/Potongan bawaan review negatif:\s*−5 poin per review/);
    await portal.click('[data-visit="report-settings"]');await portal.fill('dialog [name=pot_review]','8');await portal.click('dialog [type=submit]');await portal.waitForSelector('text=Potongan bawaan disimpan.');
    assert.equal(one(db,'SELECT pot_review FROM visit_form_settings WHERE id=1').pot_review,8);
  });
  assert.equal(dialogs,0);
  assert.deepEqual(errors,[]);
  assert.deepEqual(portalErrors,[]);
  console.log(`${checks} pemeriksaan UI penilaian guide lulus.`);
}finally{await browser.close();app.server.close();db.close();rmSync(dataDir,{recursive:true,force:true});}
