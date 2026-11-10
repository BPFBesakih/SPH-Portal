// Uji UI Playwright modul Absensi, sepenuhnya lokal.
//
//   PLAYWRIGHT_MODULE=/path/ke/playwright node scripts/verify-attendance-ui.mjs [folder-tangkapan-layar]
//
// Portal SQLite di memori, data pegawai fiktif, kamera dan GPS tiruan Chromium, ubin peta
// OpenStreetMap diganti gambar kosong (tidak ada panggilan jaringan keluar). Memeriksa:
// titik absen di peta, pendaftaran HP bersama/pribadi lewat tautan WhatsApp (QR opsional),
// absen MASUK di HP bersama (selfie + lokasi), absen di luar titik dengan alasan,
// sesi pendaftaran banyak HP dengan persetujuan, serta Hari ini, Perlu dicek (selfie,
// foto acuan, penilaian), Rekap + ekspor Excel di portal. Tidak boleh ada pelanggaran CSP.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {openDb,insert,one,all,run,now} from '../lib/db.mjs';
import {seedPermissions,hashPasswordSync} from '../lib/auth.mjs';
import {createApp} from '../server.mjs';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const shots=process.argv[2]?resolve(process.argv[2]):null;if(shots)mkdirSync(shots,{recursive:true});
const freePort=()=>new Promise(r=>{const probe=createServer().listen(0,'127.0.0.1',()=>{const {port}=probe.address();probe.close(()=>r(port));});});
const db=openDb(':memory:');seedPermissions(db);
const office=insert(db,'org_units',{code:'UJI-U0',name:'Kantor Uji',is_active:1}),post=insert(db,'org_units',{code:'UJI-U1',name:'Pos Uji',parent_id:office.id,is_active:1});
const position=(code,name,unit)=>insert(db,'positions',{code,name,org_unit_id:unit.id,is_active:1});
const employee=(no,name,pos,boss=null,phone=null)=>{const e=insert(db,'employees',{employee_no:no,full_name:name,employment_status:'Tetap',joined_on:'2020-01-01',is_active:1,phone});insert(db,'employee_placements',{employee_id:e.id,position_id:pos.id,supervisor_employee_id:boss?.id||null,valid_from:'2020-01-01',is_primary:1});return e;};
const head=employee('UJI-001','Kepala Uji',position('UJI-P1','Kepala Kantor Uji',office));
const guard=employee('UJI-002','Petugas Uji Satu',position('UJI-P2','Petugas Pos Uji',post),head,'0812-3456-7890');
const helper=employee('UJI-003','Pekerja Harian Uji',position('UJI-P3','THL Pos Uji',post),head);
const user=insert(db,'users',{username:'absensi.uji',password_hash:hashPasswordSync('UjiAbsensi!2026'),employee_id:head.id,status:'ACTIVE',must_change_password:0,failed_login_count:0,password_changed_at:now()});
insert(db,'user_roles',{user_id:user.id,role_id:one(db,"SELECT id FROM roles WHERE code='ABSENSI_PENGELOLA'").id,scope_kind:'ALL'});
const port=await freePort(),base=`http://127.0.0.1:${port}`,dataDir=mkdtempSync(resolve(tmpdir(),'attendance-ui-'));
const app=createApp({db,dataDir,origin:base});
await new Promise(r=>app.server.listen(port,'127.0.0.1',r));
const browser=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
const tile=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX5kAAAAASUVORK5CYII=','base64');
let checks=0;const check=async(name,work)=>{await work();console.log('PASS '+name);checks++;};
const shot=async(page,name)=>{if(shots)await page.screenshot({path:resolve(shots,name+'.png'),fullPage:false});};
async function watch(context){
 await context.route('https://tile.openstreetmap.org/**',r=>r.fulfill({status:200,contentType:'image/png',body:tile}));
 await context.route(url=>!url.href.startsWith(base)&&!url.href.startsWith('https://tile.openstreetmap.org/')&&!url.href.startsWith('data:')&&!url.href.startsWith('blob:'),r=>{throw new Error('Unexpected request '+r.request().url());});
 await context.addInitScript(()=>{window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));});
}
const phoneContext=async(location={latitude:-8.37412,longitude:115.45121,accuracy:8})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2,permissions:['geolocation','camera'],geolocation:location,locale:'id-ID',timezoneId:'Asia/Makassar',
  userAgent:'Mozilla/5.0 (Linux; Android 13; HP Uji) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'});
 await watch(context);return context;
};
try{
 const portalContext=await browser.newContext({viewport:{width:1366,height:900},acceptDownloads:true,locale:'id-ID',timezoneId:'Asia/Makassar',permissions:['geolocation'],geolocation:{latitude:-8.3741,longitude:115.4512,accuracy:20}});
 await watch(portalContext);
 const portal=await portalContext.newPage();
 const errors=[];portal.on('pageerror',e=>errors.push(e.message));
 const dialog=()=>portal.locator('dialog[open]').last();
 const tab=async name=>{await portal.locator('[data-att=tab]',{hasText:name}).click();await portal.locator('[data-att=tab].active',{hasText:name}).waitFor();};

 await check('release gate: without the attendance routes on the server the Absensi menu stays hidden',async()=>{
  const context=await browser.newContext({viewport:{width:1366,height:900}});await watch(context);
  // Seperti produksi sebelum migrasi dan tambalan portal-api: rute absensi menjawab 404.
  await context.route(`${base}/api/attendance/**`,r=>r.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Halaman tidak ditemukan.'})}));
  const page=await context.newPage(),problems=[];page.on('pageerror',e=>problems.push(e.message));
  await page.goto(base+'/');await page.fill('#login-form [name=username]','absensi.uji');await page.fill('#login-form [name=password]','UjiAbsensi!2026');
  // Ditunggu sebelum login dikirim: pemeriksaan menu bisa selesai sebelum navigasi tampil.
  const probed=page.waitForResponse(r=>r.url().includes('/api/attendance/overview'));
  await page.click('#login-form [type=submit]');
  await page.locator('.nav-link',{hasText:'Cuti'}).waitFor();
  await probed;await page.waitForTimeout(300);
  assert.equal(await page.locator('.nav-link',{hasText:'Absensi'}).count(),0,'menu Absensi tersembunyi');
  await page.goto(base+'/#attendance?tab=today');await page.locator('.nav-link',{hasText:'Cuti'}).waitFor();await page.waitForTimeout(300);
  assert.notEqual(await page.evaluate(()=>location.hash.split('?')[0]),'#attendance','rute Absensi tidak dibuka');
  assert.equal(await page.getByRole('heading',{name:'Absensi',exact:true}).count(),0);
  assert.deepEqual(problems,[]);await context.close();
 });
 await check('release gate: a temporary error does not hide the Absensi menu for the rest of the session',async()=>{
  const context=await browser.newContext({viewport:{width:1366,height:900}});await watch(context);
  let calls=0;
  await context.route(`${base}/api/attendance/overview`,r=>++calls===1?r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Layanan sedang sibuk.'})}):r.continue());
  const page=await context.newPage(),problems=[];page.on('pageerror',e=>problems.push(e.message));
  await page.goto(base+'/');await page.fill('#login-form [name=username]','absensi.uji');await page.fill('#login-form [name=password]','UjiAbsensi!2026');
  const failed=page.waitForResponse(r=>r.url().includes('/api/attendance/overview')&&r.status()===503);
  await page.click('#login-form [type=submit]');
  await page.locator('.nav-link',{hasText:'Cuti'}).waitFor();
  await failed;await page.waitForTimeout(300);
  assert.equal(await page.locator('.nav-link',{hasText:'Absensi'}).count(),0);
  // Berpindah halaman memeriksa ulang; menu muncul tanpa memuat ulang atau masuk lagi.
  await page.locator('.nav-link',{hasText:'Informasi Internal'}).click();
  await page.locator('.nav-link',{hasText:'Absensi'}).waitFor({timeout:10000});
  assert(calls>=2);assert.deepEqual(problems,[]);await context.close();
 });
 await check('portal: Absensi menu and tabs follow the account capabilities',async()=>{
  await portal.goto(base+'/');await portal.fill('#login-form [name=username]','absensi.uji');await portal.fill('#login-form [name=password]','UjiAbsensi!2026');await portal.click('#login-form [type=submit]');
  await portal.locator('.nav-link',{hasText:'Absensi'}).click();
  await portal.getByRole('heading',{name:'Absensi',exact:true}).waitFor();
  assert.deepEqual(await portal.locator('[data-att=tab]').allTextContents(),['Hari ini','Rekap','Perlu dicek','HP Absen','Titik Absen','Absen saya']);
 });
 await check('portal: a point is placed with pasted Google Maps coordinates and drawn on the map with its radius',async()=>{
  await tab('Titik Absen');
  await portal.locator('.notice',{hasText:'Belum ada titik absen aktif'}).waitFor();
  await portal.locator('#attendance-map.leaflet-container').waitFor();
  await portal.locator('[data-att=point-new]').click();
  const d=dialog();await d.locator('[name=name]').fill('Kantor Uji');
  await d.locator('[data-paste]').fill('https://www.google.com/maps/place/@-8.3741000,115.4512000,17z');
  assert.equal(await d.locator('[name=latitude]').inputValue(),'-8.3741000');assert.equal(await d.locator('[name=longitude]').inputValue(),'115.4512000');
  await d.locator('[data-map].leaflet-container path.leaflet-interactive').first().waitFor();
  await d.locator('[name=radius_m]').fill('100');
  await d.getByRole('button',{name:'Simpan'}).click();
  await portal.locator('#attendance-content td',{hasText:'Kantor Uji'}).waitFor();
  assert.equal(await portal.locator('#attendance-content td',{hasText:'100 m'}).count(),1);
  await portal.locator('#attendance-map path.leaflet-interactive').first().waitFor();
  assert.equal(await portal.locator('#attendance-map .leaflet-control-attribution').textContent(),'Leaflet | © OpenStreetMap');
  await shot(portal,'portal-titik-absen');
 });
 const shareLink=async()=>{const d=dialog();const link=await d.locator('[data-link]').inputValue();const wa=await d.locator('a',{hasText:'Kirim lewat WhatsApp'}).getAttribute('href');await d.locator('summary').click();await d.locator('.attendance-qr svg').waitFor();return {link,wa,d};};
 let sharedLink,personalLink;
 await check('portal: registering a shared and a personal phone gives single-use WhatsApp links (QR optional)',async()=>{
  await tab('HP Absen');
  await portal.locator('[data-att=device-shared]').click();
  let d=dialog();await d.locator('[name=org_unit_id]').selectOption({label:'Pos Uji'});await d.locator('[name=label]').fill('HP Pos Uji');await d.getByRole('button',{name:'Simpan'}).click();
  let share=await shareLink();sharedLink=share.link;
  assert.match(sharedLink,new RegExp(`^${base.replace(/[.]/g,'\\.')}/absen/#daftar=[a-f0-9]{64}$`));assert.match(share.wa,/^https:\/\/wa\.me\/\?text=/);
  await shot(portal,'portal-tautan-hp');
  await share.d.locator('[data-close]').first().click();
  await portal.locator('#attendance-content td',{hasText:'HP Pos Uji'}).waitFor();
  await portal.locator('[data-att=device-personal]').click();
  d=dialog();await d.locator('[role=combobox]').fill('petugas');await d.locator('[role=option]',{hasText:'Petugas Uji Satu'}).click();await d.getByRole('button',{name:'Simpan'}).click();
  share=await shareLink();personalLink=share.link;
  assert.match(share.wa,/^https:\/\/wa\.me\/6281234567890\?text=/,'nomor HP pegawai dipakai untuk WhatsApp');
  await share.d.locator('[data-close]').first().click();
 });
 const phone=await phoneContext(),hp=await phone.newPage();
 const phoneLog=[];hp.on('console',m=>phoneLog.push(`${m.type()}: ${m.text()}`));hp.on('pageerror',e=>phoneLog.push('pageerror: '+e.message));hp.on('requestfailed',r=>phoneLog.push(`failed: ${r.url()} ${r.failure()?.errorText}`));
 const screen=async text=>{try{await hp.locator('#app h1',{hasText:text}).waitFor({timeout:15000});}catch(error){console.error('PHONE SCREEN:',await hp.locator('#app').innerText().catch(()=>'?'),'\nLOG:',phoneLog.join('\n'));throw error;}};
 await check('shared phone: registration link, then any employee checks in with a selfie inside the point',async()=>{
  await hp.goto(sharedLink);await screen('Daftarkan HP ini untuk absen');
  assert.equal(await hp.evaluate(()=>location.hash),'','token dihapus dari alamat');
  await hp.getByRole('button',{name:'Ya, daftarkan'}).click();await screen('HP berhasil didaftarkan');
  await hp.getByRole('button',{name:'Mulai absen'}).click();await screen('Siapa yang absen?');
  assert.deepEqual(await hp.locator('[data-lists] .group').allTextContents(),['Unit Pos Uji']);
  await shot(hp,'hp-pilih-nama');
  await hp.locator('[data-action=choose]',{hasText:'Pekerja Harian Uji'}).click();await screen('Absen sebagai');
  await hp.getByRole('button',{name:'Ya, benar'}).click();
  await hp.locator('.status',{hasText:'Belum absen masuk hari ini.'}).waitFor();
  assert.match(await hp.locator('#device-label').textContent(),/HP bersama · HP Pos Uji/);
  await shot(hp,'hp-masuk-pulang');
  await hp.locator('[data-action=kind][data-kind=IN]').click();await screen('Selfie untuk absen MASUK');
  await hp.locator('[data-action=shoot]:not([disabled])').waitFor({timeout:15000});
  await hp.locator('[data-location]',{hasText:'Lokasi didapat'}).waitFor({timeout:15000});
  await hp.locator('[data-action=shoot]').click();
  await hp.locator('.success .kind',{hasText:'MASUK TERCATAT'}).waitFor({timeout:20000});
  assert.match(await hp.locator('.success .where').textContent(),/^Kantor Uji \(\d+ m\)$/);
  assert.equal(await hp.locator('.success .who').textContent(),'Pekerja Harian Uji');
  await shot(hp,'hp-tercatat');
  const row=one(db,'SELECT * FROM attendance_events WHERE employee_id=?',helper.id);
  assert.equal(row.kind,'IN');assert.equal(row.within_point,1);assert(row.photo_size>1000&&row.photo_size<=300*1024);
  assert.deepEqual(readdirSync(resolve(dataDir,'attendance')),[row.photo_storage_key]);
  assert.deepEqual(readFileSync(resolve(dataDir,'attendance',row.photo_storage_key)).subarray(0,3),Buffer.from([0xff,0xd8,0xff]));
 });
 await check('shared phone: outside the point the employee picks a reason and the check-in is flagged',async()=>{
  await hp.getByRole('button',{name:'Selesai'}).click();await screen('Siapa yang absen?');
  await phone.setGeolocation({latitude:-8.3700,longitude:115.4512,accuracy:10});
  await hp.locator('[data-search]').fill('satu');
  await hp.locator('[data-action=choose]',{hasText:'Petugas Uji Satu'}).first().click();await hp.getByRole('button',{name:'Ya, benar'}).click();
  await hp.locator('[data-action=kind][data-kind=IN]').click();
  await hp.locator('[data-action=shoot]:not([disabled])').waitFor({timeout:15000});await hp.locator('[data-location]',{hasText:'Lokasi didapat'}).waitFor({timeout:15000});
  await hp.locator('[data-action=shoot]').click();
  await screen('Di luar titik absen');assert.match(await hp.locator('.status.warn').textContent(),/Anda \d+ m dari Kantor Uji/);
  await hp.getByRole('button',{name:'Tugas lapangan'}).click();await hp.getByRole('button',{name:'Kirim absen'}).click();
  await hp.locator('.success .where',{hasText:'Di luar titik'}).waitFor({timeout:20000});
  const row=one(db,'SELECT * FROM attendance_events WHERE employee_id=?',guard.id);
  assert.deepEqual([row.within_point,row.outside_reason,JSON.parse(row.flags).includes('DI_LUAR_TITIK')],[0,'TUGAS_LAPANGAN',true]);
  assert.deepEqual(await hp.evaluate(()=>window.__csp),[]);
 });
 await check('personal phone: the owner opens straight to MASUK/PULANG and can check in a colleague',async()=>{
  const own=await phoneContext(),page=await own.newPage();
  await page.goto(personalLink);await page.locator('#app',{hasText:'HP pribadi milik Petugas Uji Satu'}).waitFor();
  await page.getByRole('button',{name:'Ya, daftarkan'}).click();await page.getByRole('button',{name:'Mulai absen'}).click();
  await page.locator('.person .name',{hasText:'Petugas Uji Satu'}).waitFor();
  await page.locator('.status',{hasText:'Sudah absen masuk pukul'}).waitFor();
  assert.equal(await page.locator('[data-action=kind][data-kind=OUT]').getAttribute('class'),'suggested','PULANG disarankan karena sudah absen masuk di HP lain');
  await page.getByRole('button',{name:'Absen untuk orang lain'}).click();await page.locator('#app h1',{hasText:'Siapa yang absen?'}).waitFor();
  assert.deepEqual(await page.locator('[data-lists] .group').allTextContents(),['Pemilik HP','Unit Pos Uji']);
  await own.close();
 });
 await check('registration session: phones register at once and start after approval in the portal',async()=>{
  await portal.locator('[data-att=session-open]').click();
  const d=dialog();await d.locator('[name=org_unit_id]').selectOption({label:'Pos Uji'});await d.locator('[name=minutes]').fill('10');await d.getByRole('button',{name:'Simpan'}).click();
  const {link,d:share}=await shareLink();assert.match(link,/\/absen\/#sesi=[a-f0-9]{64}$/);await share.locator('[data-close]').first().click();
  const other=await phoneContext(),page=await other.newPage();
  await page.goto(link);await page.locator('#app h1',{hasText:'Pilih nama Anda'}).waitFor();
  await page.locator('[data-action=session-person]',{hasText:'Pekerja Harian Uji'}).click();await page.getByRole('button',{name:'Ya, ini HP saya'}).click();
  await page.locator('#app h1',{hasText:'Menunggu persetujuan SDM'}).waitFor();
  await portal.locator('[data-sessions] td',{hasText:'Pekerja Harian Uji'}).waitFor({timeout:15000});
  await portal.locator('[data-sessions] [data-att=approve]').click();
  await page.locator('#app h1',{hasText:'HP berhasil didaftarkan'}).waitFor({timeout:20000});
  await page.getByRole('button',{name:'Mulai absen'}).click();await page.locator('.person .name',{hasText:'Pekerja Harian Uji'}).waitFor();
  await other.close();
 });
 await check('lost reply: registration that reached the server is recovered with the same key, by "Coba lagi" or on reopening',async()=>{
  const sharedPhoneLink=async label=>{
   await tab('HP Absen');await portal.locator('[data-att=device-shared]').click();
   const d=dialog();await d.locator('[name=org_unit_id]').selectOption({label:'Pos Uji'});await d.locator('[name=label]').fill(label);await d.getByRole('button',{name:'Simpan'}).click();
   const share=await shareLink();await share.d.locator('[data-close]').first().click();return share.link;
  };
  // Balasan pertama dibuang SESUDAH server menyimpan, seperti sinyal putus di lapangan.
  const lossyPhone=async()=>{
   const context=await phoneContext();let dropped=0;
   await context.addInitScript(()=>{window.__persist=0;const s=navigator.storage;if(s){s.persisted=()=>Promise.resolve(false);s.persist=()=>{window.__persist++;return Promise.resolve(true);};}});
   await context.route(`${base}/api/attendance-form/register`,async r=>{if(dropped++===0){await r.fetch();await r.abort('connectionreset');return;}await r.continue();});
   return context;
  };
  const registered=label=>{const rows=all(db,'SELECT * FROM attendance_devices WHERE label=?',label);assert.equal(rows.length,1);return rows[0];};
  // 1. Tombol "Coba lagi".
  let link=await sharedPhoneLink('HP Pos Cadangan'),context=await lossyPhone(),page=await context.newPage();
  await page.goto(link);await page.locator('#app h1',{hasText:'Daftarkan HP ini untuk absen'}).waitFor();
  await page.getByRole('button',{name:'Ya, daftarkan'}).click();await page.locator('#app h1',{hasText:'Belum berhasil'}).waitFor({timeout:15000});
  let row=registered('HP Pos Cadangan');assert.equal(row.status,'ACTIVE','server sudah menyimpan walau balasan hilang');
  await page.getByRole('button',{name:'Coba lagi'}).click();await page.locator('#app h1',{hasText:'HP berhasil didaftarkan'}).waitFor({timeout:15000});
  assert.equal(registered('HP Pos Cadangan').id,row.id);assert.equal(one(db,"SELECT count(*) n FROM audit_events WHERE action='ACTIVATE' AND object_key=?",row.id).n,1);
  await page.getByRole('button',{name:'Mulai absen'}).click();await page.locator('#app h1',{hasText:'Siapa yang absen?'}).waitFor();
  assert(await page.evaluate(()=>window.__persist)>=1,'penyimpanan permanen diminta sesudah pendaftaran');
  await context.close();
  // 2. HP ditutup sebelum mencoba lagi: saat dibuka kembali, pendaftaran dilanjutkan sendiri.
  link=await sharedPhoneLink('HP Pos Malam');context=await lossyPhone();page=await context.newPage();
  await page.goto(link);await page.getByRole('button',{name:'Ya, daftarkan'}).click();await page.locator('#app h1',{hasText:'Belum berhasil'}).waitFor({timeout:15000});
  row=registered('HP Pos Malam');assert.equal(row.status,'ACTIVE');
  await page.goto(base+'/absen/');await page.locator('#app h1',{hasText:'HP berhasil didaftarkan'}).waitFor({timeout:15000});
  assert.equal(registered('HP Pos Malam').id,row.id);
  await page.getByRole('button',{name:'Mulai absen'}).click();await page.locator('#app h1',{hasText:'Siapa yang absen?'}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.__csp),[]);
  await context.close();
 });
 await check('portal: Hari ini shows who checked in where; Perlu dicek compares the selfie and sets the reference photo',async()=>{
  await tab('Hari ini');
  const row=portal.locator('#attendance-content tr',{hasText:'Petugas Uji Satu'});
  await row.locator('.badge',{hasText:'Masuk, belum pulang'}).waitFor();await row.locator('.badge',{hasText:'Di luar titik'}).waitFor();
  assert.match(await portal.locator('#attendance-content tr',{hasText:'Pekerja Harian Uji'}).textContent(),/lewat HP Pos Uji/);
  await shot(portal,'portal-hari-ini');
  await tab('Perlu dicek');
  const item=portal.locator('#attendance-content tr',{hasText:'Petugas Uji Satu'});await item.locator('[data-att=review]').click();
  const d=dialog();await d.locator('[data-photo=event] img[src^="blob:"]').waitFor();
  await d.locator('[data-photo=reference]',{hasText:'Belum ada foto acuan'}).waitFor();
  assert.equal(await d.locator('a',{hasText:'lokasi di peta'}).count(),1);
  await shot(portal,'portal-perlu-dicek');
  await d.getByRole('button',{name:'Jadikan foto acuan'}).click();
  await portal.locator('.toast',{hasText:'Foto acuan tersimpan.'}).waitFor();
  await item.locator('[data-att=review]').click();
  const again=dialog();await again.locator('[data-photo=reference] img[src^="blob:"]').waitFor();
  await again.getByRole('button',{name:'Sesuai'}).click();await portal.locator('.toast',{hasText:'Ditandai sesuai.'}).waitFor();
  assert.equal(one(db,"SELECT decision FROM attendance_reviews").decision,'SESUAI');
  assert.equal(one(db,"SELECT count(*) n FROM audit_events WHERE action='VIEW_PHOTO'").n,2);
 });
 await check('portal: Rekap opens the daily detail and exports Excel with an audit entry',async()=>{
  await tab('Rekap');
  await portal.locator('#attendance-content [data-att=detail]',{hasText:'Pekerja Harian Uji'}).click();
  const d=dialog();await d.locator('h3',{hasText:'Harian'}).waitFor();await d.locator('td',{hasText:'Masuk'}).first().waitFor();
  await d.locator('[data-close]').first().click();
  const [download]=await Promise.all([portal.waitForEvent('download'),portal.locator('[data-att=export]').click()]);
  assert.match(download.suggestedFilename(),/^absensi-\d{4}-\d{2}-\d{2}-sd-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const file=await download.path();assert.equal(readFileSync(file).subarray(0,2).toString(),'PK');
  assert.equal(one(db,"SELECT count(*) n FROM audit_events WHERE action='EXPORT'").n,1);
  assert.deepEqual(await portal.evaluate(()=>window.__csp),[],'tanpa pelanggaran CSP (Leaflet, QR, selfie blob)');
  assert.deepEqual(errors,[]);
 });
 console.log(`${checks} attendance UI checks passed.`);
}finally{await browser.close();await new Promise(r=>app.server.close(r));db.close();rmSync(dataDir,{recursive:true,force:true});}
