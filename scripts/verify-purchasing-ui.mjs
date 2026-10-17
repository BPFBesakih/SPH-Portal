// Uji lokal modul Pengadaan di browser headless terhadap server lokal (SQLite sementara).
// Data fiktif; tidak menyentuh produksi, profil browser, atau akun nyata.
// Pakai: node scripts/verify-purchasing-ui.mjs <playwright-core/index.mjs> <chromium>
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openDb,insert,one,now} from '../lib/db.mjs';
import {seedPermissions,hashPasswordSync} from '../lib/auth.mjs';
import {createApp} from '../server.mjs';

const [playwrightPath,executablePath]=process.argv.slice(2);
if(!playwrightPath||!executablePath)throw new Error('Supply Playwright module and browser executable paths.');
const {chromium}=await import(pathToFileURL(resolve(playwrightPath)).href);
const dir=mkdtempSync(join(tmpdir(),'sph-purchasing-ui-')),output=resolve('test-results/purchasing-ui');mkdirSync(output,{recursive:true});
const pdf=join(dir,'nota.pdf');writeFileSync(pdf,'%PDF-1.4\n% fiktif\n');
const password='FixturePassword!2026',hash=hashPasswordSync(password);

const db=openDb(join(dir,'portal.sqlite'));seedPermissions(db);
const unit=code=>insert(db,'org_units',{code,name:`Unit ${code}`,is_active:1});
const units={SEK:unit('SEK'),OPS:unit('OPS'),UMM:unit('UMM'),KEU:unit('KEU')},people={};
const person=(key,name,position,unitKey,supervisor=null)=>{const pos=insert(db,'positions',{code:`POS_${key}`,name:position,org_unit_id:units[unitKey].id,is_active:1});const e=insert(db,'employees',{employee_no:`NIP-${key}`,full_name:name,employment_status:'Tetap',joined_on:'2020-01-01',is_active:1});insert(db,'employee_placements',{employee_id:e.id,position_id:pos.id,supervisor_employee_id:supervisor?.id||null,valid_from:'2020-01-01',is_primary:1});people[key]={...e,position_id:pos.id};return people[key];};
person('kaban','Kaban Fiktif','Kepala Badan','SEK');person('sekban','Sekban Fiktif','Sekretaris Badan','SEK',people.kaban);person('kabid','Kabid Fiktif','Kabid Operasional','OPS',people.sekban);person('staf','Staf Fiktif','Staf Operasional','OPS',people.kabid);person('beli','Purchasing Fiktif','Staf Purchasing','UMM',people.sekban);person('keu','Keuangan Fiktif','Verifikator','KEU',people.sekban);
const account=(username,roles,employee)=>{const u=insert(db,'users',{username,password_hash:hash,status:'ACTIVE',employee_id:employee?.id||null,must_change_password:0,failed_login_count:0,password_changed_at:now()});for(const [code,scope] of roles)insert(db,'user_roles',{user_id:u.id,role_id:one(db,'SELECT id FROM roles WHERE code=?',code).id,scope_kind:scope});return u;};
for(const key of ['staf','kabid','sekban','kaban'])account(key,[['PURCHASE_REQUESTER','SELF']],people[key]);
account('beli',[['PURCHASING_STAFF','ALL']],people.beli);account('gabungan',[['SDM','ALL'],['COORDINATOR','ALL'],['PURCHASE_ADMIN','ALL']]);account('keu',[['FINANCE_VERIFIER','ALL']],people.keu);account('kelola',[['PURCHASE_ADMIN','ALL']]);
const {createServer}=await import('node:http');
const port=await new Promise(done=>{const probe=createServer();probe.listen(0,'127.0.0.1',()=>{const p=probe.address().port;probe.close(()=>done(p));});});
const base=`http://127.0.0.1:${port}`,app=createApp({db,dataDir:dir,origin:base});
await new Promise(ready=>app.server.listen(port,'127.0.0.1',ready));
const browser=await chromium.launch({executablePath,headless:true});
const errors=[];let checks=0;
let current=null;
const check=async(name,fn)=>{try{await fn();}catch(e){if(current)await current.screenshot({path:resolve(output,'gagal.png')}).catch(()=>{});throw e;}console.log(`PASS ${name}`);checks++;};
async function login(username,viewport={width:1440,height:960}){
  const context=await browser.newContext({viewport,baseURL:base});const page=await context.newPage();current=page;
  page.on('pageerror',e=>errors.push(`${username}: ${e.message}`));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))errors.push(`${username}: ${m.text()}`);});
  await page.goto('/');await page.getByLabel('Username').fill(username);await page.getByLabel('Password').fill(password);await page.getByRole('button',{name:'Masuk ke portal'}).click();
  await page.locator('.sidebar').waitFor({state:'attached'});await page.locator('#main .loading-panel').waitFor({state:'detached'});return {page,context};
}
const drawer=page=>page.locator('dialog[data-pg-detail][open]');
async function submitDialog(page,label){const dialog=page.locator('dialog').last();await dialog.evaluate(el=>{el.dataset.submitting='true';});await dialog.getByRole('button',{name:label,exact:true}).click();await page.locator('dialog[data-submitting]').waitFor({state:'detached'});}
async function openFirst(page,route){await page.goto(`/#${route}`);await page.locator('[data-action=pg-open]').first().click();await drawer(page).waitFor();}
try{
  // Pengelola menyiapkan pejabat, kode unit, Pos RKA, dan vendor lewat UI.
  await check('Pengelola Pengadaan menetapkan pejabat dan kode unit dari halaman Pengaturan',async()=>{
    const {page,context}=await login('kelola');
    await page.goto('/#purchasing-settings');await page.getByRole('button',{name:'Ubah pengaturan'}).click();
    const form=page.locator('dialog').last();
    await form.getByLabel('Posisi Sekban').selectOption({label:'Sekretaris Badan · Unit SEK'});await form.getByLabel('Posisi Kaban').selectOption({label:'Kepala Badan · Unit SEK'});
    await form.getByLabel('Kode PR Unit OPS').fill('OPS');await form.getByLabel('Dasar perubahan').fill('Penetapan awal uji lokal');
    await submitDialog(page,'Simpan');
    await page.getByText('Pemegang: Sekban Fiktif').waitFor();await page.getByText('Pemegang: Kaban Fiktif').waitFor();
    await page.goto('/#budget');await page.getByRole('button',{name:'Tambah tahun'}).click();await page.locator('dialog').last().getByLabel('Tahun').fill(new Date().getFullYear().toString());await submitDialog(page,'Simpan');
    await page.getByRole('button',{name:'Tambah Pos RKA'}).click();const line=page.locator('dialog').last();await line.getByLabel('Kode (mis. BHP)').fill('BHP');await line.getByLabel('Nama Pos').fill('Barang habis pakai');await line.getByLabel(/^Pagu/).fill('25000000');await submitDialog(page,'Simpan');
    await page.getByRole('cell',{name:'BHP',exact:true}).waitFor();
    for(const name of ['Toko Fiktif Satu','Toko Fiktif Dua']){await page.goto('/#vendors');await page.getByRole('button',{name:'Tambah vendor'}).click();const v=page.locator('dialog').last();await v.getByLabel('Nama vendor').fill(name);await v.getByLabel('Alamat').fill('Karangasem');await v.getByLabel('Nama pimpinan').fill(`Pimpinan ${name}`);await v.getByLabel('NIK pimpinan (dicetak di SPK)').fill('5108012345678901');await submitDialog(page,'Simpan');await page.getByRole('cell',{name:`${name} Karangasem`}).waitFor();}
    await context.close();
  });
  await check('pemohon membuat PR dua item dengan lampiran dari Pengajuan Saya',async()=>{
    const {page,context}=await login('staf');
    assert.equal(await page.locator('.workspace-switch [data-action=switch-purchasing]').count(),1);
    await page.getByText('Staf Operasional').first().waitFor();await page.screenshot({path:resolve(output,'00-beranda-pemohon.png')});
    await page.getByRole('button',{name:'Buat PR'}).first().click();
    const form=page.locator('dialog').last();
    await form.getByLabel('Tanggal barang dibutuhkan').fill(new Date(Date.now()+7*86400000).toISOString().slice(0,10));
    await form.getByLabel(/^Deskripsi/).fill('Kertas A4 80 gsm');await form.getByLabel(/^Jumlah/).fill('2,5');await form.getByLabel('Satuan',{exact:true}).fill('rim');await form.getByLabel(/^Perkiraan harga/).fill('400000');await form.getByLabel('Alasan kebutuhan').fill('Stok kantor habis');await form.getByLabel(/^Link pembelian/).fill('www.toko.example/kertas');
    await form.getByRole('button',{name:'Tambah item'}).click();
    await form.getByLabel(/^Deskripsi/).nth(1).fill('Tinta printer hitam');await form.getByLabel(/^Jumlah/).nth(1).fill('1');await form.getByLabel('Satuan',{exact:true}).nth(1).fill('botol');await form.getByLabel(/^Perkiraan harga/).nth(1).fill('150000');await form.getByLabel('Alasan kebutuhan').nth(1).fill('Tinta habis');
    assert.equal(await form.locator('[data-total]').textContent(),'Rp1.150.000');
    await page.screenshot({path:resolve(output,'01-buat-pr.png')});
    await submitDialog(page,'Kirim PR');
    await drawer(page).getByText('Menunggu atasan').first().waitFor();
    await drawer(page).getByRole('button',{name:'Batalkan PR'}).waitFor();
    await page.screenshot({path:resolve(output,'02-detail-pemohon.png')});
    await context.close();
  });
  const approve=async(username,{verify=false}={})=>{
    const {page,context}=await login(username);await openFirst(page,'pr-approvals');
    await drawer(page).getByRole('button',{name:verify?'Verifikasi':'Setujui'}).click();
    const form=page.locator('dialog').last();if(verify)await form.getByLabel('Pos RKA').selectOption({index:1});
    await submitDialog(page,'Simpan keputusan');await context.close();
  };
  await check('lonceng memberi tahu atasan tentang PR yang menunggu, termasuk setelah ganti akun di tab yang sama',async()=>{
    const {page,context}=await login('staf');
    await page.locator('[data-action=profile]').click();await page.getByRole('button',{name:'Keluar'}).click();
    const relogin=page.locator('#login-form');await relogin.getByLabel('Username').fill('kabid');await relogin.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Masuk ke portal'}).click();
    const panel=page.locator('.bell-panel');await panel.getByText('PR menunggu persetujuan Anda').waitFor();
    assert.equal(await page.locator('[data-bell-count]').textContent(),'1');
    assert.equal(await page.locator('.nav-link[href="#pr-approvals"] .badge-count').textContent(),'1');
    await page.screenshot({path:resolve(output,'06-lonceng-atasan.png')});
    await panel.locator('a.bell-item').click();await page.locator('[data-action=pg-open]').first().waitFor();
    assert.equal(await panel.count(),0);await page.reload();await page.locator('[data-action=pg-open]').first().waitFor();
    assert.equal(await page.locator('.bell-panel').count(),0,'pengingat otomatis hanya sekali per sesi');
    await page.locator('[data-action=notifications]').click();await page.locator('.bell-panel').getByText('PR menunggu persetujuan Anda').waitFor();
    await page.keyboard.press('Escape');assert.equal(await page.locator('.bell-panel').count(),0);
    await context.close();
  });
  await check('pemilih ruang kerja tiga modul tetap di dalam batas sidebar',async()=>{
    const {page,context}=await login('gabungan');const box=await page.locator('.workspace-switch').boundingBox();
    const buttons=page.locator('.workspace-switch button');assert.equal(await buttons.count(),3);
    for(let i=0;i<3;i++){const b=await buttons.nth(i).boundingBox();assert(b.x>=box.x-0.5&&b.x+b.width<=box.x+box.width+0.5&&b.y+b.height<=box.y+box.height+0.5,`tombol ruang kerja ${i+1} keluar batas`);}
    await page.locator('.sidebar').screenshot({path:resolve(output,'07-tiga-ruang-kerja.png')});
    await context.close();
  });
  await check('atasan, Keuangan, dan Sekban menyetujui dari antrean Persetujuan',async()=>{
    await approve('kabid');await approve('keu',{verify:true});await approve('sekban');
    const row=one(db,'SELECT status,final_approver_kind FROM purchase_requests');assert.deepEqual({...row},{status:'pending_completeness_check',final_approver_kind:'SEKBAN'});
  });
  await check('Purchasing memberi nomor, mencatat dua harga per item, memilih, dan membuat PO',async()=>{
    const {page,context}=await login('beli');await openFirst(page,'pr-queue');
    await drawer(page).getByRole('button',{name:'Terima & beri nomor'}).click();
    const accept=page.locator('dialog').last();assert.match(await accept.getByLabel('Nomor PR').inputValue(),/^001\/PR\/OPS\//);await submitDialog(page,'Terima PR');
    for(const [item,vendor,price] of [[1,'Toko Fiktif Satu','390000'],[1,'Toko Fiktif Dua','395000'],[2,'Toko Fiktif Satu','140000'],[2,'Toko Fiktif Dua','135000']]){
      await drawer(page).getByRole('button',{name:'Tambah harga'}).click();const q=page.locator('dialog').last();
      await q.getByLabel(/^Item/).selectOption({index:item});await q.getByLabel('Vendor terdaftar').selectOption({label:vendor});await q.getByLabel('Harga satuan (Rp)').fill(price);await q.getByLabel('Bukti harga: link').fill('https://toko.example/harga');
      await submitDialog(page,'Simpan');
    }
    await drawer(page).locator('tr',{hasText:'Rp390.000'}).locator('[data-action=pg-select-quote]').click();await drawer(page).getByText('Dipilih').first().waitFor();
    await drawer(page).locator('tr',{hasText:'Rp140.000'}).locator('[data-action=pg-select-quote]').click();
    const reason=page.locator('dialog').last();await reason.getByLabel('Alasan singkat').fill('Satu toko dengan kertas');await submitDialog(page,'Simpan');
    await drawer(page).getByRole('button',{name:'Buat pesanan'}).click();const order=page.locator('dialog').last();await order.getByLabel('Jalur').selectOption('B');await submitDialog(page,'Buat pesanan');
    await drawer(page).getByRole('button',{name:'Ajukan',exact:true}).click();await submitDialog(page,'Ajukan');
    await drawer(page).getByText('Menunggu persetujuan PO/SPK').waitFor();await context.close();
  });
  await check('Sekban menyetujui PO; nomor PO dan dokumen cetak ber-QR terbit',async()=>{
    await approve('sekban');
    const {page,context}=await login('beli');await openFirst(page,'pr-queue');
    await drawer(page).getByText(/001\/PO\/PURCHASE\//).first().waitFor();
    await drawer(page).locator('tr',{hasText:/\/PO\/PURCHASE\//}).locator('[data-action=pg-print]').click();
    const sheet=page.locator('dialog[data-pg-print] .pg-sheet');await sheet.getByText('Purchase Order (PO)').waitFor();
    assert.equal(await sheet.locator('.pg-qr svg').count(),1);await sheet.getByText('Satu Juta').first().waitFor();
    await page.screenshot({path:resolve(output,'03-cetak-po.png')});
    await page.locator('dialog[data-pg-print] [data-close]').click();
    await drawer(page).getByRole('button',{name:'Catat pembelian'}).click();await submitDialog(page,'Simpan');
    await drawer(page).getByRole('button',{name:'Serah terima'}).click();const r=page.locator('dialog').last();
    await r.getByLabel('Total nota vendor (Rp)').fill('1130000');await r.getByLabel('Nota, kwitansi, atau invoice vendor').setInputFiles(pdf);await r.getByLabel('Kondisi barang atau hasil pekerjaan').fill('Lengkap dan baik');
    await submitDialog(page,'Simpan');await drawer(page).getByText('Selesai').first().waitFor();
    await drawer(page).locator('.pg-orders').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(output,'05-detail-purchasing.png')});
    await context.close();
  });
  await check('pemohon melihat PR selesai, mencetak PR, dan memverifikasi QR',async()=>{
    const {page,context}=await login('staf',{width:390,height:844});await openFirst(page,'pr-mine');
    await drawer(page).getByText('Selesai').first().waitFor();assert.equal(await drawer(page).locator('[data-action=pg-select-quote]').count(),0);
    await drawer(page).locator('[data-action=pg-print]').first().click();const sheet=page.locator('dialog[data-pg-print] .pg-sheet');await sheet.getByText('Permohonan Pemesanan Barang (PR)').waitFor();
    assert.equal(await page.locator('dialog[data-pg-print] .notice.warning').count(),0,'dokumen PR teratas harus versi yang berlaku');await sheet.getByText(/001\/PR\/OPS\//).waitFor();
    const code=one(db,"SELECT verification_code FROM purchase_documents WHERE doc_type='PR' AND superseded_at IS NULL").verification_code;
    await page.screenshot({path:resolve(output,'04-cetak-pr-mobile.png')});
    await page.goto(`/#pr-verify?code=${code}`);await page.getByText('Dokumen asli dan berlaku').waitFor();
    const scroll=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);assert(scroll<=1,`horizontal scroll ${scroll}px`);
    await context.close();
  });
  assert.deepEqual(errors,[]);
  console.log(`${checks} purchasing UI checks passed. Screenshots: ${output}`);
}finally{await browser.close();app.server.close();db.close();rmSync(dir,{recursive:true,force:true});}
