// Uji UI Playwright modul E-Arsip, sepenuhnya lokal dengan data fiktif.
//
//   PLAYWRIGHT_MODULE=/path/ke/playwright node scripts/verify-archives-ui.mjs [folder-tangkapan-layar]
//
// Portal SQLite di memori. Memeriksa: petugas menambah arsip (unggah PDF + lampiran PNG,
// pratinjau pdf.js), peringatan dugaan duplikat, daftar di layar HP dengan baris Rahasia
// yang disamarkan (jawaban server tidak memuat perihal), unduh hanya dengan izin, Humas
// mengubah klasifikasi/berbagi dengan notifikasi yang ditargetkan/memberi izin, pengajuan
// hapus → setuju → pulihkan, laporan XLSX dan PDF, penunjukan petugas oleh administrator.
// Tidak boleh ada galat halaman atau pelanggaran CSP.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {openDb,one,run} from '../lib/db.mjs';
import {seedPermissions,hashPasswordSync} from '../lib/auth.mjs';
import {createApp} from '../server.mjs';
import {seedArchiveDemo,samplePdf,samplePng} from './archive-demo-data.mjs';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const shots=process.argv[2]?resolve(process.argv[2]):null;if(shots)mkdirSync(shots,{recursive:true});
const freePort=()=>new Promise(r=>{const probe=createServer().listen(0,'127.0.0.1',()=>{const {port}=probe.address();probe.close(()=>r(port));});});
const db=openDb(':memory:');seedPermissions(db);
const dataDir=mkdtempSync(resolve(tmpdir(),'archives-ui-')),password='UjiArsip!2026';
const demo=await seedArchiveDemo(db,dataDir,hashPasswordSync(password));
run(db,"UPDATE positions SET name='Kepala Urusan Keuangan' WHERE id=(SELECT position_id FROM employee_placements WHERE employee_id=?)",demo.users.staffKeu.employee_id);
run(db,'UPDATE employee_placements SET supervisor_employee_id=? WHERE employee_id=?',demo.users.staffKeu.employee_id,demo.users.officerKeu.employee_id);
const port=await freePort(),base=`http://127.0.0.1:${port}`,app=createApp({db,dataDir,origin:base});
await new Promise(r=>app.server.listen(port,'127.0.0.1',r));
const letter=resolve(dataDir,'surat-baru.pdf'),attachment=resolve(dataDir,'lampiran-foto.png'),other=resolve(dataDir,'surat-lain.pdf'),fake=resolve(dataDir,'bukan-pdf.pdf'),heic=resolve(dataDir,'foto.heic');
writeFileSync(letter,await samplePdf('Surat baru uji',30));writeFileSync(attachment,samplePng(480,640,[20,90,60]));writeFileSync(other,await samplePdf('Surat lain uji',8));writeFileSync(fake,'ini bukan pdf');writeFileSync(heic,'heic');
const browser=await chromium.launch(),problems=[];
let checks=0;const check=async(name,work)=>{await work();console.log('PASS '+name);checks++;};
async function session(username,viewport={width:1360,height:900}){
 const context=await browser.newContext({viewport,acceptDownloads:true}),page=await context.newPage();
 page.on('pageerror',e=>problems.push(`${username}: ${e.message}`));
 page.on('console',m=>{if(m.type()==='error'&&!/status of (401|403|404|409|422)/.test(m.text()))problems.push(`${username}: ${m.text()}`);});
 await page.goto(base+'/');await page.fill('[name=username]',username);await page.fill('[name=password]',password);await page.click('#login-form [type=submit]');
 await page.waitForSelector('.sidebar');
 page.open=async query=>{const target=`${base}/#archives${query?`?${query}`:''}`;if(page.url()===target)await page.reload();else await page.goto(target);await page.waitForSelector('#archive-content, .archive-back');await page.waitForTimeout(250);};
 page.shot=async name=>{if(shots)await page.screenshot({path:resolve(shots,name+'.png'),fullPage:true});};
 page.toast=text=>page.waitForSelector(`.toast:has-text("${text}")`);
 return page;
}
const downloadOf=async(page,trigger)=>{const [download]=await Promise.all([page.waitForEvent('download'),trigger()]);return {name:download.suggestedFilename(),bytes:readFileSync(await download.path())};};
try{
 const officer=await session('petugas.keu'),staff=await session('pegawai.keu',{width:390,height:800}),humas=await session('humas.arsip'),admin=await session('admin.arsip');
 let created;

 await check('menu E-Arsip tampil setelah server siap; petugas menambah arsip dengan lampiran dan melihat pratinjau',async()=>{
  await officer.waitForSelector('a.nav-link[href="#archives"]');
  await officer.open('tab=new');
  assert.match(await officer.locator('.archive-form .notice').innerText(),/langsung tersimpan sebagai Biasa/);
  assert.equal(await officer.locator('[name=classification]').count(),0,'tidak ada pemilih Rahasia pada form petugas');
  await officer.setInputFiles('[name=main]',heic);assert.match(await officer.locator('.archive-files').innerText(),/HEIC belum didukung/);
  await officer.setInputFiles('[name=main]',fake);
  await officer.selectOption('[name=direction]','MASUK');await officer.selectOption('[name=document_type_id]','arsip-jenis-surat');
  await officer.fill('[name=official_number]','099/UJI/XI/2026');await officer.fill('[name=letter_date]','2026-11-09');await officer.fill('[name=subject]','Surat uji antarmuka E-Arsip');
  await officer.click('.archive-form [type=submit]');
  await officer.waitForSelector('.archive-form .form-error:has-text("Isi berkas tidak cocok")');
  assert.equal(Number(one(db,"SELECT count(*) n FROM archive_records WHERE subject='Surat uji antarmuka E-Arsip'").n),0,'berkas palsu tidak menghasilkan arsip');
  await officer.setInputFiles('[name=main]',letter);await officer.setInputFiles('[name=attachments]',attachment);
  await officer.click('.archive-form [type=submit]');
  await officer.toast('Arsip tersimpan dengan nomor agenda KEU/');
  await officer.waitForSelector('#archive-viewer canvas');
  assert.match(await officer.locator('.archive-viewer-controls').innerText(),/Halaman 1 dari 2/);
  await officer.click('[data-arc=viewer-next]');await officer.waitForSelector('.archive-viewer-controls:has-text("Halaman 2 dari 2")');
  assert.match(await officer.locator('h1').innerText(),/^KEU\/\d{4}\/0005$/);
  assert.equal(await officer.locator('[data-arc=download]').count(),0);assert.match(await officer.locator('#archive-content').innerText(),/Unduh memerlukan izin Humas/);
  created=one(db,"SELECT * FROM archive_records WHERE subject='Surat uji antarmuka E-Arsip'");assert.equal(created.classification,'BIASA');
  await officer.click('[data-arc=preview][data-label="lampiran-foto.png"]');await officer.waitForSelector('#archive-viewer img');
  await officer.shot('01-detail-petugas');
 });

 await check('dugaan duplikat memberi peringatan dan hanya lanjut dengan alasan',async()=>{
  await officer.open('tab=new');
  await officer.setInputFiles('[name=main]',other);
  await officer.selectOption('[name=direction]','MASUK');await officer.selectOption('[name=document_type_id]','arsip-jenis-surat');
  await officer.fill('[name=official_number]','099/UJI/XI/2026');await officer.fill('[name=letter_date]','2026-11-09');await officer.fill('[name=subject]','Surat dengan nomor yang sama');
  await officer.click('.archive-form [type=submit]');
  await officer.waitForSelector('dialog:has-text("Dugaan arsip ganda")');
  assert.match(await officer.locator('dialog').innerText(),/KEU\/\d{4}\/0005[\s\S]*nomor dan tanggal surat sama/);
  await officer.shot('02-duplikat');
  await officer.click('dialog [data-close] >> nth=0');await officer.waitForSelector('.form-error:has-text("Penyimpanan dibatalkan")');
  assert.equal(Number(one(db,"SELECT count(*) n FROM archive_records WHERE subject='Surat dengan nomor yang sama'").n),0);
  await officer.click('.archive-form [type=submit]');await officer.waitForSelector('dialog:has-text("Dugaan arsip ganda")');
  await officer.fill('dialog [name=duplicate_reason]','Surat berbeda, nomor kebetulan sama');await officer.click('dialog [type=submit]');
  await officer.toast('Arsip tersimpan dengan nomor agenda KEU/');
  assert.equal(Number(one(db,"SELECT count(*) n FROM archive_duplicate_overrides WHERE reason='Surat berbeda, nomor kebetulan sama'").n),1);
 });

 await check('di layar HP, baris Rahasia hanya memuat agenda, tanggal arsip, dan label; server tidak mengirim perihalnya',async()=>{
  const [response]=await Promise.all([staff.waitForResponse(r=>/\/api\/archives\?/.test(r.url())),staff.open('tab=list')]);
  const body=await response.text();assert(!body.includes('pemeriksaan internal'),'perihal Rahasia tidak ada di jawaban server');
  const secret=JSON.parse(body).items.find(i=>i.id===demo.archives.secret.id);assert.deepEqual(Object.keys(secret).sort(),['agenda_number','archived_at','classification','id','restricted']);
  const row=staff.locator('tr.archive-restricted');assert.equal(await row.count(),1);
  const text=await row.innerText();assert.match(text,/KEU\/\d{4}\/0004/);assert.match(text,/Rahasia/);assert(!/Surat pemeriksaan/.test(text));
  assert.equal(await staff.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'tidak ada gulir mendatar di HP');
  await staff.shot('03-daftar-hp');
  await staff.fill('.archive-search [name=q]','pemeriksaan');await staff.click('.archive-search [type=submit]');await staff.waitForSelector('.notice:has-text("hanya pada arsip yang dapat Anda baca")');
  assert.equal(await staff.locator('tr.archive-restricted').count(),0,'pencarian perihal tidak mengungkap arsip Rahasia');
  await staff.open(`id=${demo.archives.secret.id}`);
  assert.match(await staff.locator('#main').innerText(),/berklasifikasi Rahasia[\s\S]*Hubungi Humas secara langsung/);assert.equal(await staff.locator('#archive-viewer').count(),0);
  await staff.shot('04-rahasia-terbatas-hp');
 });

 await check('unduh berkas asli hanya dengan izin unduh; pratinjau tetap tersedia tanpa izin',async()=>{
  await staff.open(`id=${demo.archives.invitation.id}`);await staff.waitForSelector('#archive-viewer canvas');
  const file=await downloadOf(staff,()=>staff.click('[data-arc=download] >> nth=0'));
  assert.equal(file.name,'undangan-rapat.pdf');assert.equal(file.bytes.subarray(0,5).toString(),'%PDF-');
  await staff.open(`id=${demo.archives.note.id}`);await staff.waitForSelector('#archive-viewer canvas');
  assert.equal(await staff.locator('[data-arc=download]').count(),0);assert.equal(await staff.locator('[data-arc=edit]').count(),0,'pegawai biasa tidak dapat mengubah');
  await humas.open(`id=${demo.archives.secret.id}`);await humas.waitForSelector('#archive-viewer canvas');
  assert.match(await humas.locator('.archive-source').innerText(),/role Humas/);assert.equal(await humas.locator('[data-arc=download]').count(),0,'Humas membaca Rahasia tetapi unduh tetap perlu izin');
 });

 await check('Humas mengubah klasifikasi dengan dampak yang ditampilkan, berbagi ke bagian dengan notifikasi yang dipilih, dan memberi izin unduh',async()=>{
  await humas.open(`id=${created.id}&view=access`);
  await humas.click('[data-arc=classify]');await humas.waitForSelector('dialog:has-text("Ubah klasifikasi menjadi Rahasia")');
  assert.match(await humas.locator('dialog .form-note').innerText(),/2 pegawai bagian pemilik[\s\S]*hanya melihat nomor agenda/);
  await humas.click('dialog [data-close] >> nth=0');
  await humas.click('[data-arc=grant-share]');await humas.check('dialog [name=kind][value=UNIT]');
  await humas.waitForFunction(()=>document.querySelector('dialog [name=target_unit_id]').options.length>1);
  await humas.selectOption('dialog [name=target_unit_id]',demo.units.ops.id);await humas.waitForSelector('dialog [name="notify[]"]');
  assert.equal(await humas.locator('dialog [name="notify[]"]:checked').count(),0,'berbagi ke bagian tidak otomatis memberi notifikasi');
  await humas.check(`dialog [name="notify[]"][value="${demo.users.staffOps.id}"]`);await humas.shot('05-berbagi');
  await humas.click('dialog [type=submit]');await humas.toast('Arsip dibagikan. 1 pegawai diberi notifikasi portal.');
  const notified=db.prepare("SELECT recipient_user_id FROM archive_notifications WHERE archive_id=? AND notification_type='ARCHIVE_SHARED'").all(created.id).map(r=>r.recipient_user_id);
  assert.deepEqual(notified,[demo.users.staffOps.id]);
  await humas.click('[data-arc=grant-download]');await humas.fill('dialog [data-picker-query]','pegawai keu');await humas.click('dialog [data-picker-search]');
  await humas.check('dialog [name=picked_user]');await humas.fill('dialog [name=reason]','Perlu dicetak');await humas.click('dialog [type=submit]');await humas.toast('Izin unduh diberikan.');
  await humas.waitForSelector('#archive-content tr:has-text("Unduh"):has-text("Pegawai Keuangan Contoh"):has-text("Aktif")');
  await humas.click('[data-arc=classify]');await humas.fill('dialog [name=reason]','Memuat data sensitif uji');await humas.click('dialog [type=submit]');await humas.toast('Klasifikasi diubah menjadi Rahasia.');
  assert.equal(one(db,'SELECT classification FROM archive_records WHERE id=?',created.id).classification,'RAHASIA');
  await humas.waitForSelector('#archive-content tr:has-text("Dicabut"):has-text("Klasifikasi diubah menjadi Rahasia")');await humas.waitForSelector('[data-arc=grant-rahasia]');
  await humas.shot('06-pengaturan-akses');
  // Halaman petugas yang masih terbuka menutup akses pada permintaan berikutnya.
  await officer.open(`id=${created.id}`);assert.match(await officer.locator('#main').innerText(),/berklasifikasi Rahasia/);
  await humas.click('[data-arc=classify]');await humas.fill('dialog [name=reason]','Kembali Biasa untuk uji');await humas.click('dialog [type=submit]');await humas.toast('Klasifikasi diubah menjadi Biasa.');await humas.waitForSelector('[data-arc=grant-share]');
 });

 await check('pengajuan hapus petugas diputuskan Humas; arsip disembunyikan lalu dipulihkan dengan nomor agenda yang sama',async()=>{
  await officer.open(`id=${created.id}`);await officer.click('[data-arc=delete-request]');await officer.fill('dialog [name=reason]','Salah unggah saat uji');await officer.click('dialog [type=submit]');
  await officer.toast('Pengajuan penghapusan dikirim ke Humas.');assert.equal(await officer.locator('[data-arc=delete-direct]').count(),0,'petugas tidak dapat menghapus langsung');
  await humas.open('tab=requests');
  const row=humas.locator('tr',{hasText:created.agenda_number});await row.locator('[data-arc=request-approve]').click();
  assert.match(await humas.locator('dialog .form-note').innerText(),/disembunyikan dan dapat dipulihkan/);
  await humas.fill('dialog [name=reason]','Disetujui untuk uji');await humas.click('dialog [type=submit]');await humas.toast('Pengajuan disetujui. Arsip dihapus.');
  await officer.open(`id=${created.id}`);assert.match(await officer.locator('#main').innerText(),/Arsip tidak ditemukan/);
  await humas.open('tab=deleted');await humas.locator('tr',{hasText:created.agenda_number}).locator('[data-arc=restore]').click();
  await humas.fill('dialog [name=reason]','Dipulihkan untuk uji');await humas.click('dialog [type=submit]');await humas.toast(`Arsip ${created.agenda_number} dipulihkan.`);
  const after=one(db,'SELECT agenda_number,deleted_at FROM archive_records WHERE id=?',created.id);assert.deepEqual([after.agenda_number,after.deleted_at],[created.agenda_number,null]);
 });

 await check('laporan XLSX dan PDF dibuat sesuai hak; arsip Rahasia terbatas tidak membawa perihal',async()=>{
  await staff.open('tab=reports');
  await staff.fill('[data-arc-form=report] [name=from]','2026-01-01');
  const xlsx=await downloadOf(staff,()=>staff.click('[data-arc-form=report] [value=xlsx]'));
  assert.match(xlsx.name,/^e-arsip-recap-period-.*\.xlsx$/);assert.equal(xlsx.bytes.subarray(0,2).toString(),'PK');
  const text=xlsx.bytes.toString('latin1');assert(text.includes('Undangan rapat koordinasi anggaran contoh'));assert(!text.includes('pemeriksaan internal'),'XLSX tidak memuat perihal Rahasia');assert(!text.includes('state="hidden"'));
  await staff.selectOption('[data-arc-form=report] [name=type]','agenda_in');
  const pdf=await downloadOf(staff,()=>staff.click('[data-arc-form=report] [value=pdf]'));
  assert.match(pdf.name,/^e-arsip-agenda-in-.*\.pdf$/);const raw=pdf.bytes.toString('latin1');
  assert(raw.startsWith('%PDF-')&&raw.includes('Buku Agenda Surat Masuk')&&!raw.includes('pemeriksaan internal')&&!raw.includes('Pegawai Keuangan Contoh)\n/'));
  assert.equal(Number(one(db,"SELECT count(*) n FROM archive_audit_events WHERE action='REPORT_EXPORTED' AND actor_user_id=?",demo.users.staffKeu.id).n),2);
  await staff.shot('07-laporan-hp');
 });

 await check('Super Admin menunjuk petugas dan mengelola arsip lengkap',async()=>{
  await admin.open('tab=officers');
  assert.equal(await admin.locator('[data-arc=tab][data-tab=types]').count(),1);
  await admin.click('[data-arc=officer-new]');await admin.selectOption('dialog [name=org_unit_id]',demo.units.hms.id);
  assert.equal(await admin.inputValue('dialog [name=agenda_code]'),'ARSHMS');await admin.fill('dialog [name=agenda_code]','HMS');
  await admin.fill('dialog [data-picker-query]','humas');await admin.click('dialog [data-picker-search]');await admin.check('dialog [name=picked_user]');
  await admin.fill('dialog [name=reason]','SK penunjukan uji');await admin.click('dialog [type=submit]');await admin.toast('Petugas arsip ditunjuk.');
  await admin.shot('08-petugas');
  await admin.open(`id=${demo.archives.invitation.id}`);assert.match(await admin.locator('#main').innerText(),/Undangan rapat koordinasi/);
  assert(await admin.locator('[data-arc=download]').count()>0);
  await humas.open('tab=new');assert.match(await humas.locator('.archive-static').first().innerText(),/Humas Contoh \(HMS\)/);
  await humas.open('tab=types');await humas.click('[data-arc=type-new]');await humas.fill('dialog [name=code]','MOU');await humas.fill('dialog [name=name]','Nota Kesepahaman');await humas.click('dialog [type=submit]');
  await humas.toast('Jenis dokumen ditambahkan.');await humas.waitForSelector('#archive-content tr:has-text("MOU"):has-text("Nota Kesepahaman")');
 });

 await check('Super Admin tanpa penunjukan menambah arsip dari antarmuka',async()=>{
  const file=resolve(dataDir,'admin-baru.pdf');writeFileSync(file,await samplePdf('Arsip Super Admin unik',4));
  await admin.open('tab=new');await admin.setInputFiles('[name=main]',file);await admin.selectOption('[name=owner_unit_id]',demo.units.keu.id);
  await admin.selectOption('[name=direction]','MASUK');await admin.selectOption('[name=document_type_id]','arsip-jenis-surat');
  await admin.fill('[name=letter_date]','2026-11-09');await admin.fill('[name=official_number]','ADMIN-001/UJI');await admin.fill('[name=subject]','Arsip administrasi Super Admin uji');
  await admin.click('.archive-form [type=submit]');await admin.toast('Arsip tersimpan dengan nomor agenda KEU/');
  assert(one(db,"SELECT id FROM archive_records WHERE subject='Arsip administrasi Super Admin uji'"));
  assert.equal(Number(one(db,'SELECT count(*) n FROM archive_officers WHERE user_id=?',demo.users.admin.id).n),0);
 });
 await check('Kepala Urusan mencabut bawahannya; hak petugas berubah setelah pencabutan',async()=>{
  await staff.open('tab=officers');assert.equal(await staff.locator('[data-arc=officer-new]').count(),0);assert.equal(await staff.locator('[data-arc=unit-code]').count(),0);
  assert.equal(await staff.locator('[data-arc=officer-revoke]').count(),1);
  await staff.click('[data-arc=officer-revoke]');await staff.fill('dialog [name=reason]','Rotasi petugas oleh Kepala Urusan');await staff.click('dialog [type=submit]');await staff.toast('Penunjukan dicabut.');
  assert.equal(await staff.locator('[data-arc=officer-revoke]').count(),0);
  await officer.open('tab=new');assert.equal(await officer.locator('[data-arc=tab][data-tab=new]').count(),0);
 });
 assert.deepEqual(problems,[],'tidak boleh ada galat halaman atau pelanggaran CSP');
 console.log(`${checks} archive UI checks passed.`);
}finally{await browser.close();await new Promise(r=>app.server.close(r));db.close();rmSync(dataDir,{recursive:true,force:true});}
