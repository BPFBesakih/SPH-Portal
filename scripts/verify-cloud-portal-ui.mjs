// Headless, isolated browser fixture. Never connects to production or uses an
// existing browser profile, password, cookie or real employee record.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
const [playwrightPath,executablePath]=process.argv.slice(2);
if(!playwrightPath||!executablePath)throw new Error('Supply Playwright module and browser executable paths.');
const {chromium}=await import(pathToFileURL(resolve(playwrightPath)).href);
const root=resolve('site-info/dist'),output=resolve('test-results/cloud-portal-ui');await mkdir(output,{recursive:true});
const headerSource=await readFile(resolve(root,'_headers'),'utf8');const csp=headerSource.split(/\r?\n/).find(l=>l.trim().startsWith('Content-Security-Policy:')).trim().slice(24).trim();
const server=createServer(async(req,res)=>{const path=resolve(root,`.${new URL(req.url,'http://fixture').pathname.replace(/\/$/,'/index.html')}`);if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}try{const body=await readFile(path);res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'}[extname(path)]||'application/octet-stream','Content-Security-Policy':csp,'Permissions-Policy':'camera=(self), microphone=(), geolocation=(self)','Cache-Control':'no-store'}).end(body);}catch{res.writeHead(404).end();}});
await new Promise(ready=>server.listen(0,'127.0.0.1',ready));
const base=`http://127.0.0.1:${server.address().port}`,origin='https://portal.test';
const browser=await chromium.launch({executablePath,headless:true});
let checks=0;
const check=async(name,fn)=>{await fn();console.log(`PASS ${name}`);checks++;};
const permissions=['admin.users.read','admin.users.manage','admin.users.reset','admin.roles.read','admin.roles.manage','admin.audit.read'];
const me={user:{id:'fixture-user',username:'itadmin',status:'ACTIVE',row_version:1,must_change_password:false,employee_id:null},name:'itadmin',permissions,csrfToken:'fixture-csrf',demo:false};
const contexts=[];const errors=[];
async function fixture({signedIn=true,required=false,roleEditor=false,grantEditor=false,accountGrants=[],mayManage=true,employees=[],clock=false,reducedMotion='no-preference',viewport={width:1440,height:960},delays={},failures={},purchasingAccess=false,documentsAccess=false,documentManager=true,trainingAccess=false,initialHash=''}={}){
 // page.route cannot serve service-worker scripts on the synthetic origin.
 // Real worker registration and offline behavior are checked by verify-pwa-ui.mjs.
 const context=await browser.newContext({viewport,baseURL:origin,reducedMotion,serviceWorkers:'block'});contexts.push(context);const page=await context.newPage();let active=0,maximum=0;const calls=[];let authenticated=signedIn;
 if(clock)await page.clock.install({time:new Date('2026-10-18T00:00:00Z')});
 let currentPermissions=permissions.filter(p=>mayManage||p!=='admin.roles.manage');
 if(purchasingAccess)currentPermissions.push('purchasing.requests.read_all');
 if(documentsAccess)currentPermissions.push('hr.documents.read','hr.documents.manage','hr.documents.publish','hr.documents.download');
 if(trainingAccess)currentPermissions.push('hr.training.read','hr.training.participants');
 const units=['Badan Pengelola Besakih','Bisnis & Pengembangan Usaha','Operasional & Pelayanan','Pengelolaan Lingkungan & Keamanan Kawasan Besakih','Satuan Pengawas Internal & Manajemen Risiko','Sekretariat'].map((name,index)=>({id:`document-unit-${index}`,name}));
 const documents=[{id:'fixture-document',document_code:'SOP-001',title:'SOP Keamanan Kawasan',category:'SOP_SECURITY',unit_name:units[3].name,row_version:1,active_version:'1.0',effective_on:'2026-10-19',versions:[],targets:[]}];
 const training={id:'fixture-training',title:'Pelatihan Layanan',topic:'Layanan',organizer_org_unit_id:'fixture-unit',organizer_name:'Sekretariat',status:'PLANNED',starts_at:'2099-01-01T01:00:00Z',ends_at:'2099-01-01T03:00:00Z',location:'Besakih',row_version:1,participants:employees.slice(0,1).map(e=>({...e,id:`participant-${e.id}`,employee_id:e.id,attendance_status:'NOT_RECORDED'})),materials:[],documentation:[],certificates:[]};
 const calendarItems=[
  {id:'calendar-planned',title:'Pelatihan K3',status:'PLANNED',starts_at:'2026-10-18T01:00:00Z',ends_at:'2026-10-18T03:00:00Z',location:'Wantilan',description:'Rencana pelatihan K3'},
  {id:'calendar-done',title:'Evaluasi Pelayanan',status:'COMPLETED',starts_at:'2026-10-18T02:00:00Z',ends_at:'2026-10-18T04:00:00Z',location:'Ruang SDM',description:'Telah dilaksanakan'},
  {id:'calendar-cancelled',title:'Kegiatan Batal',status:'CANCELLED',starts_at:'2026-10-20T01:00:00Z',ends_at:'2026-10-20T03:00:00Z',location:'Besakih',description:'Batal'}
 ];
 const systemRole={id:'fixture-system-role',code:'SUPER_ADMIN',name:'Super Admin',is_system:1,is_active:1,row_version:1,permissions:[...permissions]};
 const grantRole={id:'fixture-employee-role',code:'EMPLOYEE',name:'Pegawai',is_active:1,is_system:0,permissions:['hr.employees.read']};
 const users=[{...me.user,grants:accountGrants}];
 const catalog=[...permissions,'hr.employees.read'].map(code=>({code,resource:code.split('.').slice(0,2).join('.'),action:code.split('.').at(-1)}));
 page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(msg.type()==='error'&&!msg.text().includes('Failed to load resource'))errors.push(msg.text());});
 await page.route(`${origin}/**`,async route=>{
  const req=route.request(),url=new URL(req.url());if(!url.pathname.startsWith('/api/')){const r=await fetch(base+url.pathname);await route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())});return;}
  active++;maximum=Math.max(maximum,active);const call={path:url.pathname,method:req.method(),body:req.postDataJSON(),startedAt:Date.now()};calls.push(call);let body,status=200;
  await new Promise(r=>setTimeout(r,delays[url.pathname]??15));
  try{
   if(url.pathname==='/api/auth/login'){const sent=req.postDataJSON();assert.equal(sent.username,'itadmin');authenticated=true;body={ok:true};}
   else if(url.pathname==='/api/auth/logout'){assert.equal(req.headers()['x-csrf-token'],'fixture-csrf');authenticated=false;body={ok:true};}
   else if(!authenticated){status=401;body={error:'SESSION_ENDED',message:'Sesi berakhir. Silakan masuk kembali.'};}
   else if(url.pathname==='/api/portal/me')body={...me,permissions:currentPermissions,user:{...me.user,must_change_password:required}};
   else if(url.pathname==='/api/users'&&req.method()==='POST'){const sent=req.postDataJSON();const user={...me.user,id:`fixture-created-${users.length}`,username:sent.username,employee_id:sent.employee_id||null,must_change_password:true,grants:[]};users.push(user);body=user;}
   else if(grantEditor&&url.pathname===`/api/users/${me.user.id}/grants`&&req.method()==='POST'){const sent=req.postDataJSON();users[0].grants=sent.grants.map((g,index)=>({...g,id:`fixture-grant-${index}`,role_name:g.role_id===grantRole.id?grantRole.name:'Petugas Keamanan'}));users[0].row_version++;body={ok:true};}
   else if(url.pathname==='/api/users')body={items:users};
   else if(url.pathname==='/api/lookups')body={employees,units:documentsAccess?units:grantEditor?[{id:'fixture-unit',name:'Sekretariat'}]:[],posts:grantEditor?[{id:'fixture-post',name:'Pos Fiktif'}]:[]};
   else if(url.pathname==='/api/training/calendar')body={items:url.searchParams.get('year')==='2099'?[{id:training.id,title:training.title,status:training.status,starts_at:training.starts_at,ends_at:training.ends_at,location:training.location,description:null}]:url.searchParams.get('year')==='2026'?calendarItems:[]};
   else if(trainingAccess&&url.pathname==='/api/training')body={items:[{...training,participant_count:training.participants.length}]};
   else if(trainingAccess&&url.pathname===`/api/training/${training.id}`)body=training;
   else if(trainingAccess&&url.pathname===`/api/training/${training.id}/participants`&&req.method()==='POST'){
    const sent=req.postDataJSON();assert.equal(req.headers()['x-csrf-token'],'fixture-csrf');assert(Array.isArray(sent.employee_ids));assert(sent.employee_ids.length);
    const items=sent.employee_ids.map(id=>{assert(!training.participants.some(p=>p.employee_id===id));const employee=employees.find(e=>e.id===id);assert(employee);return {...employee,id:`participant-${id}`,employee_id:id,attendance_status:'NOT_RECORDED'};});
    if(!failures[url.pathname])training.participants.push(...items);body={items};
   }
   else if(documentsAccess&&url.pathname==='/api/documents'){
    if(req.method()==='POST'){const sent=req.postDataJSON();body={...sent,id:`fixture-document-${documents.length}`,row_version:1,versions:[],targets:[],unit_name:units.find(u=>u.id===sent.owner_org_unit_id)?.name};documents.push(body);}else body={items:documents};
   }
   else if(documentsAccess&&url.pathname.startsWith('/api/documents/')){
    const id=url.pathname.split('/').at(-1),doc=documents.find(d=>d.id===id);assert(doc);
    if(req.method()==='DELETE'){assert.deepEqual(req.postDataJSON(),{row_version:doc.row_version});assert.equal(req.headers()['x-csrf-token'],'fixture-csrf');if(!failures[url.pathname])documents.splice(documents.indexOf(doc),1);body={deleted:true};}
    else body={...doc,can_manage:documentManager,can_delete:documentManager,can_publish:documentManager};
   }
   else if(url.pathname==='/api/announcements')body={items:[],can_manage:true};
   else if(url.pathname==='/api/purchasing/overview')body={capabilities:{home:true},counts:{approvals:1}};
   else if(url.pathname==='/api/roles')body={items:grantEditor?[grantRole]:roleEditor?[systemRole]:[],permissions:roleEditor?catalog:[]};
   else if(roleEditor&&url.pathname===`/api/roles/${systemRole.id}`&&req.method()==='PATCH'){const change=req.postDataJSON();assert(mayManage);systemRole.permissions=change.permissions;systemRole.row_version++;currentPermissions=[...change.permissions];body={...systemRole};}
   else if(url.pathname==='/api/settings')body={allow_gap_publication:'false'};
   else if(url.pathname==='/api/audit')body={items:[]};
   else throw new Error(`Unexpected fixture request ${url.pathname}`);
   if(failures[url.pathname]){status=failures[url.pathname];body={error:'Layanan sementara tidak tersedia.'};}
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  }finally{call.completedAt=Date.now();active--;}
 });
 await page.goto(`/app/${initialHash?'#'+initialHash:''}`);return {page,calls,get maximum(){return maximum;},async idle(){while(active)await new Promise(r=>setTimeout(r,10));}};
}
try{
 await check('full app boots with the six existing admin permissions and serializes session-bound API calls',async()=>{
  const f=await fixture();await f.page.getByRole('heading',{name:'Akun Pengguna',exact:true}).waitFor();assert.equal(f.maximum,1);
  assert.equal(await f.page.getByRole('link',{name:'Data Pegawai & Organisasi',exact:true}).count(),0);
  assert.equal(await f.page.getByRole('link',{name:'Informasi Internal',exact:true}).count(),1);
  await f.page.screenshot({path:resolve(output,'admin-desktop.png'),fullPage:true});
  await f.page.getByRole('link',{name:'Role & Izin',exact:true}).click();await f.page.getByRole('heading',{name:'Role & Izin',exact:true}).waitFor();
  await f.page.getByRole('link',{name:'Riwayat Aktivitas',exact:true}).click();await f.page.getByRole('heading',{name:'Riwayat Aktivitas',exact:true}).waitFor();
 });
 await check('menu data renders before slow notifications and notifications are reused across menu changes',async()=>{
  const f=await fixture({delays:{'/api/announcements':750}});
  await f.page.getByRole('heading',{name:'Akun Pengguna',exact:true}).waitFor();
  const users=f.calls.find(c=>c.path==='/api/users'),announcements=f.calls.find(c=>c.path==='/api/announcements');
  assert(users.completedAt);assert(announcements&&!announcements.completedAt,'the menu must be visible while notifications are still loading');
  const visibleAt=Date.now();await f.idle();
  console.log(`TIMING fixture menu visible ${visibleAt-users.startedAt} ms after its request; notifications finished ${announcements.completedAt-users.startedAt} ms after it (750 ms simulated delay).`);
  await f.page.getByRole('link',{name:'Role & Izin',exact:true}).click();await f.page.getByRole('heading',{name:'Role & Izin',exact:true}).waitFor();
  await f.page.getByRole('link',{name:'Riwayat Aktivitas',exact:true}).click();await f.page.getByRole('heading',{name:'Riwayat Aktivitas',exact:true}).waitFor();await f.idle();
  assert.equal(f.calls.filter(c=>c.path==='/api/announcements').length,1);assert.equal(f.maximum,1);
 });
 await check('slow purchasing notifications do not delay unrelated menus and queued refreshes yield to menu requests',async()=>{
  const f=await fixture({purchasingAccess:true,initialHash:'accounts',delays:{'/api/announcements':500}});
  await f.page.getByRole('heading',{name:'Akun Pengguna',exact:true}).waitFor();
  assert.equal(await f.page.locator('.workspace-switch [data-action="switch-purchasing"]').count(),1);
  assert.equal(f.calls.some(c=>c.path==='/api/purchasing/overview'),false);
  await f.page.getByRole('link',{name:'Role & Izin',exact:true}).click();await f.page.getByRole('heading',{name:'Role & Izin',exact:true}).waitFor();await f.idle();
  const paths=f.calls.map(c=>c.path);assert(paths.indexOf('/api/roles')<paths.indexOf('/api/purchasing/overview'));
  assert(paths.indexOf('/api/settings')<paths.indexOf('/api/purchasing/overview'));
  await f.page.locator('.nav-link[href="#pr-approvals"] .badge-count').waitFor();assert.equal(f.maximum,1);
 });
 await check('notification failures leave the selected menu usable and background retries are bounded',async()=>{
  const f=await fixture({failures:{'/api/announcements':503}});await f.page.getByRole('heading',{name:'Akun Pengguna',exact:true}).waitFor();await f.idle();
  await f.page.getByRole('link',{name:'Riwayat Aktivitas',exact:true}).click();await f.page.getByRole('heading',{name:'Riwayat Aktivitas',exact:true}).waitFor();await f.idle();
  assert.equal(await f.page.getByText('Halaman belum dapat ditampilkan',{exact:true}).count(),0);
  assert.equal(f.calls.filter(c=>c.path==='/api/announcements').length,1);
 });
 await check('rapid menu changes render the last menu and skip intermediate loads',async()=>{
  const f=await fixture({delays:{'/api/roles':350}});await f.page.getByRole('heading',{name:'Akun Pengguna',exact:true}).waitFor();await f.idle();
  await Promise.all([f.page.waitForRequest('**/api/roles'),f.page.getByRole('link',{name:'Role & Izin',exact:true}).click()]);
  await f.page.evaluate(()=>{location.hash='accounts';location.hash='audit';});
  await f.page.getByRole('heading',{name:'Riwayat Aktivitas',exact:true}).waitFor();await f.idle();
  assert.equal(f.calls.filter(c=>c.path==='/api/users').length,1);assert.equal(await f.page.locator('.nav-link[aria-current="page"]').getAttribute('href'),'#audit');
 });
 await check('an explicit refresh reloads the menu and invalidates notification summaries',async()=>{
  const f=await fixture();await f.page.getByRole('heading',{name:'Akun Pengguna',exact:true}).waitFor();await f.idle();
  await f.page.evaluate(()=>document.dispatchEvent(new Event('refresh-app')));
  await f.page.getByRole('heading',{name:'Akun Pengguna',exact:true}).waitFor();await f.idle();
  assert.equal(f.calls.filter(c=>c.path==='/api/users').length,2);assert.equal(f.calls.filter(c=>c.path==='/api/announcements').length,2);
 });
 await check('the mobile shell fits 320 px and opens its navigation',async()=>{
  const f=await fixture({viewport:{width:320,height:800}});await f.page.getByRole('heading',{name:'Akun Pengguna',exact:true}).waitFor();
  assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await f.page.getByRole('button',{name:'Buka navigasi'}).click();assert(await f.page.locator('.sidebar').evaluate(e=>e.classList.contains('open')));
  await f.page.locator('.sidebar').evaluate(async e=>{await Promise.all(e.getAnimations().map(a=>a.finished));});
  const box=await f.page.locator('.sidebar').boundingBox();assert(box.x>=0&&box.width<=320);
  await f.page.screenshot({path:resolve(output,'admin-mobile.png'),fullPage:true});
 });
 await check('four new login photos rotate and fade automatically without playback controls or changing the login input',async()=>{
  const f=await fixture({signedIn:false,clock:true});
  await f.page.getByRole('heading',{name:'Masuk ke portal',exact:true}).waitFor();
  await f.page.clock.pauseAt(new Date('2026-10-18T00:00:05Z'));
  const slides=f.page.locator('.photo-slide');
  assert.equal(await slides.count(),4);
  assert.equal(new Set(await slides.evaluateAll(images=>images.map(image=>image.getAttribute('src')||image.dataset.src))).size,4);
  assert.equal(await slides.evaluateAll(images=>images.filter(image=>image.hasAttribute('src')).length),1);
  assert.deepEqual(await slides.evaluateAll(images=>images.map(image=>new URL(image.getAttribute('src')||image.dataset.src).pathname.split('/').at(-1))),['besakih-candi.webp','besakih-wantilan.webp','besakih-talent.webp','besakih-shuttle.webp']);
  assert.equal(await f.page.locator('besakih-photo-slideshow button, .photo-controls, .photo-counter').count(),0);
  assert(await slides.first().evaluate(async image=>{await image.decode();return image.naturalWidth>0;}));
  await f.page.getByLabel('Username',{exact:true}).fill('pegawai.contoh');
  for(const index of [1,2,3,0]){
   await f.page.clock.runFor(7100);
   await f.page.locator(`.photo-slide-${index}.is-active`).waitFor();
   assert.equal(await f.page.locator('.photo-slide.is-active').count(),1);
   if(index===1){
    // CSS transitions use the compositor's clock, independently of fake JS timers.
    await new Promise(resolve=>setTimeout(resolve,600));
    const opacity=await f.page.locator('.photo-slide.is-active').evaluate(image=>Number(getComputedStyle(image).opacity));
    assert(opacity>0&&opacity<1,`The incoming photo should fade in instead of switching immediately (opacity ${opacity}).`);
   }
  }
  assert.equal(await f.page.getByLabel('Username',{exact:true}).inputValue(),'pegawai.contoh');
  assert(await f.page.getByLabel('Username',{exact:true}).evaluate(input=>input===document.activeElement));
 });
 await check('reduced motion keeps the decorative background still and the mobile login fits without controls',async()=>{
  const f=await fixture({signedIn:false,clock:true,reducedMotion:'reduce',viewport:{width:320,height:800}});
  await f.page.getByRole('heading',{name:'Masuk ke portal',exact:true}).waitFor();
  await f.page.clock.pauseAt(new Date('2026-10-18T00:00:05Z'));
  await f.page.clock.runFor(21000);assert(await f.page.locator('.photo-slide-0.is-active').isVisible());
  assert.equal(await f.page.locator('besakih-photo-slideshow button').count(),0);
  assert(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 });
 await check('the app uses the Supabase login bridge, clears the password and logs out with CSRF',async()=>{
  const f=await fixture({signedIn:false});await f.page.getByLabel('Username',{exact:true}).fill('itadmin');await f.page.getByLabel('Password',{exact:true}).fill('FixturePassword!2026');await f.page.getByRole('button',{name:'Masuk ke portal',exact:false}).click();
  await f.page.getByRole('heading',{name:'Akun Pengguna',exact:true}).waitFor();assert(f.calls.some(c=>c.path==='/api/portal/me'));
  assert.equal(await f.page.evaluate(()=>JSON.stringify(localStorage)+JSON.stringify(sessionStorage)), '{}{}');
  assert.equal(f.page.url().includes('FixturePassword'),false);
  await f.page.getByRole('button',{name:'Menu akun'}).click();await f.page.getByRole('button',{name:'Keluar',exact:true}).click();await f.page.getByRole('heading',{name:'Masuk ke portal',exact:true}).waitFor();
 });
 await check('mandatory password change opens before any operational module request',async()=>{
  const f=await fixture({required:true});await f.page.getByRole('heading',{name:'Ganti password',exact:true}).waitFor();
  assert.equal(f.calls.filter(c=>c.path!=='/api/portal/me').length,0);
 });
 const employees=[...Array.from({length:12},(_,i)=>({id:`fixture-employee-${i}`,full_name:`Pegawai Contoh ${i}`,employee_no:`PG-${String(i).padStart(3,'0')}`})),{id:'fixture-adi-a',full_name:'Adi Pramana',employee_no:'PG-101'},{id:'fixture-adi-b',full_name:'Adi Pramana',employee_no:'PG-102'}];
 async function accountForm(config={}){
  const f=await fixture({employees,...config});await f.page.getByRole('button',{name:'Buat akun',exact:true}).click();
  f.dialog=f.page.getByRole('dialog',{name:'Buat akun pengguna',exact:true});await f.dialog.waitFor();
  f.search=f.dialog.getByRole('combobox',{name:'Tautkan pegawai (opsional)'});return f;
 }
 async function accountCredentials(f,username='pegawai.fixture'){
  await f.dialog.getByLabel('Username',{exact:true}).fill(username);await f.dialog.getByLabel('Password sementara (minimal 6 karakter)',{exact:true}).fill('123456');
 }
 await check('account employee search starts empty, matches partial names and limits long result lists',async()=>{
  const f=await accountForm(),list=f.dialog.getByRole('listbox');assert.equal(await list.isVisible(),false);
  await f.search.fill('p');assert.equal(await list.isVisible(),false);
  await f.search.fill('  PEGAWAI   contoh  ');assert.equal(await f.dialog.getByRole('option').count(),8);assert.match(await f.dialog.getByRole('status').textContent(),/8 dari 12/);
  await f.search.fill('tidak ditemukan');assert.equal(await list.isVisible(),false);assert.match(await f.dialog.getByRole('status').textContent(),/Pegawai tidak ditemukan/);
 });
 await check('account employee selection distinguishes duplicate names and submits only the selected ID',async()=>{
  const f=await accountForm();await accountCredentials(f);await f.search.fill('pramana');assert.equal(await f.dialog.getByRole('option').count(),2);
  await f.dialog.getByRole('option',{name:'Adi Pramana PG-101',exact:true}).click();assert.equal(await f.dialog.locator('[name=employee_id]').inputValue(),'fixture-adi-a');
  await f.search.fill('pg-102');assert.equal(await f.dialog.locator('[name=employee_id]').inputValue(),'');
  await f.dialog.getByRole('option',{name:'Adi Pramana PG-102',exact:true}).click();assert.equal(await f.search.inputValue(),'Adi Pramana');assert.equal(await f.dialog.getByRole('listbox').isVisible(),false);
  await f.dialog.getByRole('button',{name:'Simpan',exact:true}).click();await f.page.getByRole('dialog',{name:'pegawai.fixture',exact:true}).waitFor();
  assert.deepEqual(f.calls.find(c=>c.path==='/api/users'&&c.method==='POST').body,{username:'pegawai.fixture',password:'123456',employee_id:'fixture-adi-b'});
 });
 await check('employee search supports keyboard selection, Tab and Escape without prematurely submitting or closing the form',async()=>{
  const f=await accountForm();await f.search.fill('pramana');await f.search.press('ArrowDown');
  assert.equal(await f.dialog.getByRole('option',{selected:true}).textContent(),'Adi PramanaPG-101');
  assert.equal(await f.search.getAttribute('aria-activedescendant'),await f.dialog.getByRole('option',{selected:true}).getAttribute('id'));
  await f.search.press('Escape');assert.equal(await f.dialog.isVisible(),true);assert.equal(await f.dialog.getByRole('listbox').isVisible(),false);
  await f.search.press('ArrowUp');await f.search.press('Enter');assert.equal(await f.dialog.locator('[name=employee_id]').inputValue(),'fixture-adi-b');
  assert.equal(f.calls.some(c=>c.path==='/api/users'&&c.method==='POST'),false);
  await f.search.fill('pramana');await f.search.press('Tab');assert.equal(await f.dialog.getByRole('listbox').isVisible(),false);
 });
 await check('unselected employee text cannot silently save an account and clearing keeps employee linking optional',async()=>{
  const f=await accountForm();await accountCredentials(f,'tanpa.pegawai');await f.search.fill('pramana');await f.dialog.getByRole('option',{name:'Adi Pramana PG-101',exact:true}).click();
  await f.search.fill('tidak ditemukan');await f.dialog.getByRole('button',{name:'Simpan',exact:true}).click();
  assert.equal(await f.search.evaluate(input=>input.validity.valid),false);assert.equal(await f.dialog.locator('[name=employee_id]').inputValue(),'');assert.equal(f.calls.some(c=>c.path==='/api/users'&&c.method==='POST'),false);
  await f.search.fill('');await f.dialog.getByRole('button',{name:'Simpan',exact:true}).click();await f.page.getByRole('dialog',{name:'tanpa.pegawai',exact:true}).waitFor();
  assert.equal(f.calls.find(c=>c.path==='/api/users'&&c.method==='POST').body.employee_id,'');
 });
 await check('the account employee search fits mobile screens and handles an empty employee directory',async()=>{
  const f=await accountForm({viewport:{width:320,height:800}});await f.search.fill('pegawai');
  const box=await f.dialog.boundingBox();assert(box.x>=0&&box.x+box.width<=320);assert.equal(await f.dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  assert.equal(await f.dialog.getByRole('listbox').evaluate(el=>el.clientHeight<=220&&el.scrollHeight>el.clientHeight),true);
  await f.page.screenshot({path:resolve(output,'account-employee-search-mobile.png'),fullPage:true});
  await f.dialog.getByRole('button',{name:'Batal',exact:true}).click();await f.page.setViewportSize({width:1440,height:960});await f.page.getByRole('button',{name:'Buat akun',exact:true}).click();await f.page.getByRole('combobox').fill('pramana');
  await f.page.screenshot({path:resolve(output,'account-employee-search-desktop.png'),fullPage:true});
  const empty=await accountForm({employees:[]});assert.match(await empty.dialog.getByRole('status').textContent(),/Belum ada pegawai/);assert.equal(await empty.dialog.getByRole('listbox').isVisible(),false);
 });
 await check('granting unit access preserves existing post grants while new grants offer only the three supported scopes',async()=>{
  const existing={id:'fixture-post-grant',role_id:'fixture-officer-role',role_name:'Petugas Keamanan',scope_kind:'ASSIGNED_POSTS',units:[],posts:['fixture-post']};
  const f=await fixture({grantEditor:true,accountGrants:[existing]});await f.page.getByRole('button',{name:'Lihat detail',exact:true}).click();await f.page.getByRole('button',{name:'Berikan role',exact:true}).click();
  const form=f.page.getByRole('dialog',{name:'Berikan role & cakupan',exact:true});await form.waitFor();
  assert.deepEqual(await form.getByLabel('Cakupan',{exact:true}).locator('option').evaluateAll(options=>options.map(option=>option.value)),['','SELF','ASSIGNED_UNITS','ALL']);
  assert.equal(await form.locator('[name=posts]').count(),0);
  await form.getByLabel('Role',{exact:true}).selectOption('fixture-employee-role');await form.getByLabel('Cakupan',{exact:true}).selectOption('ASSIGNED_UNITS');
  await form.getByLabel('Unit (untuk cakupan unit)',{exact:true}).selectOption('fixture-unit');await form.getByLabel('Sertakan unit turunan',{exact:true}).check();
  await f.page.screenshot({path:resolve(output,'grant-scope-without-posts.png'),fullPage:true});
  await form.getByRole('button',{name:'Simpan',exact:true}).click();await form.waitFor({state:'hidden'});
  const sent=f.calls.find(c=>c.path===`/api/users/${me.user.id}/grants`&&c.method==='POST').body;
  assert.deepEqual(sent,{row_version:1,grants:[{role_id:'fixture-officer-role',scope_kind:'ASSIGNED_POSTS',units:[],posts:['fixture-post']},{role_id:'fixture-employee-role',scope_kind:'ASSIGNED_UNITS',units:[{org_unit_id:'fixture-unit',include_descendants:true}],posts:[]}]});
 });
 await check('Super Admin permission checkboxes are editable and saving refreshes the current account menus',async()=>{
  const f=await fixture({roleEditor:true});await f.page.getByRole('heading',{name:'Akun Pengguna',exact:true}).waitFor();
  await f.page.getByRole('link',{name:'Role & Izin',exact:true}).click();await f.page.getByRole('heading',{name:'Role & Izin',exact:true}).waitFor();
  await f.page.getByRole('button',{name:/Super Admin/}).click();await f.page.getByRole('heading',{name:'Ubah role',exact:true}).waitFor();
  const code=f.page.getByLabel('Kode',{exact:true});assert.equal(await code.getAttribute('readonly'),'');
  const permission=f.page.locator('input[name="permissions[]"][value="hr.employees.read"]');assert.equal(await permission.isEnabled(),true);await permission.check();
  await f.page.getByRole('button',{name:'Simpan',exact:true}).click();await f.page.getByRole('link',{name:'Data Pegawai & Organisasi',exact:true}).waitFor();
  const index=f.calls.findIndex(c=>c.path==='/api/roles/fixture-system-role'&&c.method==='PATCH');assert(index>=0);assert(f.calls[index].body.permissions.includes('hr.employees.read'));assert.equal(f.calls[index].body.code,'SUPER_ADMIN');assert(f.calls.slice(index+1).some(c=>c.path==='/api/portal/me'));
 });
 await check('a role reader still sees permission controls without mutation access',async()=>{
  const f=await fixture({roleEditor:true,mayManage:false});await f.page.getByRole('heading',{name:'Akun Pengguna',exact:true}).waitFor();
  await f.page.getByRole('link',{name:'Role & Izin',exact:true}).click();await f.page.getByRole('button',{name:/Super Admin/}).click();
  await f.page.getByRole('dialog',{name:'Super Admin',exact:true}).waitFor();
  assert.equal(await f.page.locator('dialog input[name="permissions[]"]:enabled').count(),0);assert.equal(await f.page.getByRole('button',{name:'Simpan',exact:true}).count(),0);
 });
 const documentForm=async(viewport)=>{
  const f=await fixture({documentsAccess:true,initialHash:'documents',...(viewport?{viewport}:{})});
  await f.page.getByRole('button',{name:'Tambah dokumen',exact:true}).click();
  const form=f.page.getByRole('dialog',{name:'Tambah dokumen',exact:true});await form.waitFor();
  await form.getByLabel('Kode dokumen',{exact:true}).fill('SOP-TEST');await form.getByLabel('Judul',{exact:true}).fill('SOP pengujian');
  await form.getByLabel('Kategori',{exact:true}).selectOption('SOP_SECURITY');await form.getByLabel('Unit pengelola',{exact:true}).selectOption('document-unit-3');
  return {...f,form};
 };
 await check('document target units are explicit checkboxes with wrapping labels, validation and a multi-unit payload',async()=>{
  const f=await documentForm(),group=f.form.getByRole('group',{name:'Unit sasaran',exact:true});
  assert.equal(await group.isVisible(),false);assert.equal(await f.form.locator('select[multiple]').count(),0);
  await f.form.getByLabel('Sasaran',{exact:true}).selectOption('SELECTED_UNITS');await group.waitFor();
  await f.form.getByRole('button',{name:'Simpan',exact:true}).click();await f.form.getByRole('alert').filter({hasText:'Pilih minimal satu unit sasaran.'}).waitFor();
  assert.equal(f.calls.some(c=>c.path==='/api/documents'&&c.method==='POST'),false);
  await group.getByLabel('Pengelolaan Lingkungan & Keamanan Kawasan Besakih',{exact:true}).check();await group.getByLabel('Satuan Pengawas Internal & Manajemen Risiko',{exact:true}).check();
  assert.match(await group.locator('[data-target-count]').textContent(),/2 unit dipilih/);
  assert.equal(await f.form.getByRole('alert').textContent(),'');
  assert.equal(await group.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  await f.page.screenshot({path:resolve(output,'document-targets-desktop.png'),fullPage:true});
  await f.form.getByRole('button',{name:'Simpan',exact:true}).click();await f.form.waitFor({state:'hidden'});
  const sent=f.calls.find(c=>c.path==='/api/documents'&&c.method==='POST').body;
  assert.deepEqual(sent.target_units,['document-unit-3','document-unit-4']);assert.equal('target_units[]' in sent,false);
 });
 await check('mobile document targets remain readable and switching to all units clears the submitted targets',async()=>{
  const f=await documentForm({width:390,height:844});await f.form.getByLabel('Sasaran',{exact:true}).selectOption('SELECTED_UNITS');
  const group=f.form.getByRole('group',{name:'Unit sasaran',exact:true});await group.getByLabel('Pengelolaan Lingkungan & Keamanan Kawasan Besakih',{exact:true}).check();
  assert.equal(await f.form.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  assert.equal(await group.evaluate(el=>[...el.querySelectorAll('label')].every(label=>label.scrollWidth<=label.clientWidth)),true);
  await f.page.screenshot({path:resolve(output,'document-targets-mobile.png'),fullPage:true});
  await f.form.getByLabel('Sasaran',{exact:true}).selectOption('ALL_UNITS');assert.equal(await group.isVisible(),false);
  await f.form.getByRole('button',{name:'Simpan',exact:true}).click();await f.form.waitFor({state:'hidden'});
  assert.deepEqual(f.calls.find(c=>c.path==='/api/documents'&&c.method==='POST').body.target_units,[]);
 });
 await check('document deletion requires confirmation, supports cancel and refreshes the list',async()=>{
  const f=await fixture({documentsAccess:true,initialHash:'documents'});await f.page.getByRole('button',{name:/SOP Keamanan Kawasan/}).click();
  await f.page.getByRole('button',{name:'Hapus dokumen',exact:true}).click();
  let confirmation=f.page.getByRole('dialog',{name:'Hapus dokumen?',exact:true});await confirmation.waitFor();
  await confirmation.getByRole('button',{name:'Batal',exact:true}).click();assert.equal(f.calls.some(c=>c.method==='DELETE'),false);
  await f.page.getByRole('button',{name:'Hapus dokumen',exact:true}).click();confirmation=f.page.getByRole('dialog',{name:'Hapus dokumen?',exact:true});
  await confirmation.getByRole('button',{name:'Hapus dokumen',exact:true}).click();await confirmation.waitFor({state:'hidden'});
  await f.page.getByText('Dokumen berhasil dihapus.',{exact:true}).waitFor();await f.page.getByText('Belum ada dokumen',{exact:true}).waitFor();
  assert.equal(f.calls.filter(c=>c.method==='DELETE'&&c.path==='/api/documents/fixture-document').length,1);
 });
 await check('document actions follow server scope even with a management permission on another unit',async()=>{
  const f=await fixture({documentsAccess:true,documentManager:false,initialHash:'documents'});await f.page.getByRole('button',{name:/SOP Keamanan Kawasan/}).click();
  const detail=f.page.getByRole('dialog',{name:'SOP Keamanan Kawasan',exact:true});await detail.waitFor();
  assert.equal(await detail.getByRole('button',{name:'Hapus dokumen',exact:true}).count(),0);assert.equal(await detail.getByRole('button',{name:'Tambah versi',exact:true}).count(),0);
 });
 await check('a rejected document deletion keeps its confirmation and list available',async()=>{
  const f=await fixture({documentsAccess:true,initialHash:'documents',failures:{'/api/documents/fixture-document':409}});
  // Fail only the mutation so the detail can load normally.
  await f.page.route(`${origin}/api/documents/fixture-document`,async route=>{if(route.request().method()==='GET')await route.fulfill({json:{id:'fixture-document',document_code:'SOP-001',title:'SOP Keamanan Kawasan',category:'SOP_SECURITY',row_version:1,can_manage:true,can_delete:true,can_publish:true,versions:[],targets:[]}});else await route.fallback();});
  await f.page.getByRole('button',{name:/SOP Keamanan Kawasan/}).click();await f.page.getByRole('button',{name:'Hapus dokumen',exact:true}).click();
  const confirmation=f.page.getByRole('dialog',{name:'Hapus dokumen?',exact:true});await confirmation.getByRole('button',{name:'Hapus dokumen',exact:true}).click();
  await confirmation.getByRole('alert').filter({hasText:'Layanan sementara tidak tersedia.'}).waitFor();assert.equal(await confirmation.getByRole('button',{name:'Hapus dokumen',exact:true}).isEnabled(),true);
 });
 const trainingEmployees=[
  {id:'registered',full_name:'Peserta Terdaftar',employee_no:'P-001'},
  {id:'adi',full_name:'I Wayan Adi Putra',employee_no:'P-002'},
  {id:'ayu-1',full_name:'Ni Made Ayu Pradnyaswari Kusumaningrum',employee_no:'P-003'},
  {id:'ayu-2',full_name:'Ni Made Ayu Pradnyaswari Kusumaningrum',employee_no:'P-004'}
 ];
 const participantForm=async(options={})=>{
  const f=await fixture({trainingAccess:true,employees:trainingEmployees,initialHash:'training',...options});
  await f.page.getByRole('button',{name:'Daftar kegiatan',exact:true}).click();
  await f.page.getByRole('button',{name:/Pelatihan Layanan/}).click();
  await f.page.getByRole('button',{name:'Tambah peserta',exact:true}).click();
  const form=f.page.getByRole('dialog',{name:'Tambah peserta',exact:true});await form.waitFor();
  return {...f,form,search:form.getByRole('searchbox',{name:'Cari nama atau nomor pegawai',exact:true})};
 };
 await check('calendar is readable by signed-in accounts without private training permission',async()=>{
  const f=await fixture({initialHash:'training',clock:true});
  await f.page.getByRole('heading',{name:'Kegiatan & Pelatihan',exact:true}).waitFor();
  assert(f.calls.some(c=>c.path==='/api/training/calendar'));
  assert.equal(f.calls.some(c=>c.path==='/api/training'),false);
  await f.page.locator('[data-action=training-day][data-date="2026-10-18"]').first().click();
  await f.page.getByRole('button',{name:/Pelatihan K3/}).click();
  const summary=f.page.getByRole('dialog',{name:'Pelatihan K3',exact:true});
  await summary.getByText('Rencana pelatihan K3').waitFor();
  assert.equal(await summary.getByRole('button',{name:'Buka detail kegiatan'}).count(),0);
  await summary.getByRole('button',{name:'Tutup'}).click();
  await f.page.getByRole('button',{name:'Tahunan',exact:true}).click();
  assert.equal(await f.page.locator('.training-mini-month').count(),12);
  assert.equal(await f.page.locator('.training-dot.cancelled').count()>0,true);
  assert.equal(f.calls.some(c=>c.path==='/api/training/fixture-training'),false);
 });
 await check('participant search preserves choices across queries, supports removal and submits one batch',async()=>{
  const f=await participantForm();assert.equal(await f.form.getByRole('checkbox').count(),3);
  assert.equal(await f.form.getByText('Peserta Terdaftar',{exact:true}).count(),0);
  await f.form.getByRole('button',{name:'Tambah peserta',exact:true}).click();
  await f.form.getByRole('alert').filter({hasText:'Pilih minimal satu peserta.'}).waitFor();
  assert.equal(f.calls.some(c=>c.method==='POST'&&c.path.endsWith('/participants')),false);
  await f.search.fill('  aDI   PUTRA ');await f.form.getByRole('checkbox',{name:'I Wayan Adi Putra P-002',exact:true}).check();
  assert.equal(await f.form.getByRole('alert').textContent(),'');
  await f.search.fill('P-003');const ayu=f.form.getByRole('checkbox',{name:'Ni Made Ayu Pradnyaswari Kusumaningrum P-003',exact:true});
  await ayu.focus();await f.page.keyboard.press('Space');assert.equal(await ayu.isChecked(),true);
  await f.search.fill('tidak ditemukan');await f.form.getByText('Pegawai tidak ditemukan. Coba nama atau nomor pegawai lain.',{exact:true}).waitFor();
  await f.form.getByText('2 peserta dipilih',{exact:true}).waitFor();
  await f.form.getByRole('button',{name:'Batalkan pilihan I Wayan Adi Putra (P-002)',exact:true}).click();
  await f.form.getByText('1 peserta dipilih',{exact:true}).waitFor();
  await f.search.fill('P-002');await f.form.getByRole('checkbox',{name:'I Wayan Adi Putra P-002',exact:true}).check();
  await f.search.fill('P-004');await f.search.press('Enter');assert.equal(f.calls.some(c=>c.method==='POST'&&c.path.endsWith('/participants')),false);
  await f.search.fill('');await f.page.screenshot({path:resolve(output,'training-participants-desktop.png'),fullPage:true});
  await f.search.fill('P-004');await f.form.getByRole('button',{name:'Tambah peserta',exact:true}).click();await f.form.waitFor({state:'hidden'});
  const sent=f.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/participants'));assert.equal(sent.length,1);assert.deepEqual(sent[0].body,{employee_ids:['adi','ayu-1']});
  await f.page.getByText('2 peserta berhasil ditambahkan.',{exact:true}).waitFor();
  const detail=f.page.getByRole('dialog',{name:'Pelatihan Layanan',exact:true});await detail.getByText('I Wayan Adi Putra',{exact:true}).waitFor();
  await detail.getByRole('button',{name:'Tambah peserta',exact:true}).click();
  const reopened=f.page.getByRole('dialog',{name:'Tambah peserta',exact:true});await reopened.waitFor();
  assert.equal(await reopened.getByRole('checkbox').count(),1);
 });
 await check('mobile participant names wrap and same-name employees remain distinguishable by number',async()=>{
  const f=await participantForm({viewport:{width:390,height:844}});await f.search.fill('ayu');
  assert.equal(await f.form.getByRole('checkbox').count(),2);
  await f.form.getByRole('checkbox',{name:'Ni Made Ayu Pradnyaswari Kusumaningrum P-003',exact:true}).check();
  await f.form.getByRole('checkbox',{name:'Ni Made Ayu Pradnyaswari Kusumaningrum P-004',exact:true}).check();
  await f.form.getByText('2 peserta dipilih',{exact:true}).waitFor();
  assert.equal(await f.form.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  assert.equal(await f.form.locator('.training-participant-option').evaluateAll(rows=>rows.every(row=>row.scrollWidth<=row.clientWidth)),true);
  await f.page.screenshot({path:resolve(output,'training-participants-mobile.png'),fullPage:true});
  await f.form.getByRole('button',{name:'Tambah peserta',exact:true}).click();await f.form.waitFor({state:'hidden'});
  assert.deepEqual(f.calls.find(c=>c.method==='POST'&&c.path.endsWith('/participants')).body,{employee_ids:['ayu-1','ayu-2']});
 });
 await check('a failed batch keeps choices for retry and blocks changes during save',async()=>{
  const f=await participantForm({delays:{'/api/training/fixture-training/participants':300}});
  await f.form.getByRole('checkbox',{name:'I Wayan Adi Putra P-002',exact:true}).check();await f.search.fill('P-003');
  await f.form.getByRole('checkbox',{name:'Ni Made Ayu Pradnyaswari Kusumaningrum P-003',exact:true}).check();
  const path=`${origin}/api/training/fixture-training/participants`;
  await f.page.route(path,async route=>route.fulfill({status:503,json:{error:'Layanan sementara tidak tersedia.'}}));
  await f.form.getByRole('button',{name:'Tambah peserta',exact:true}).click();
  await f.form.getByRole('alert').filter({hasText:'Layanan sementara tidak tersedia.'}).waitFor();
  assert.equal(await f.form.locator('input[type=checkbox]:checked').count(),2);assert.equal(await f.search.isEnabled(),true);
  await f.page.unroute(path);await f.form.getByRole('button',{name:'Tambah peserta',exact:true}).click();
  await f.form.getByRole('button',{name:'Menyimpan…',exact:true}).waitFor();assert.equal(await f.search.isDisabled(),true);
  assert.equal(await f.form.getByRole('button',{name:'Batalkan pilihan I Wayan Adi Putra (P-002)',exact:true}).isDisabled(),true);
  await f.form.waitFor({state:'hidden'});assert.equal(f.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/participants')).length,1);
 });
 await check('participant picker explains when no employees remain available',async()=>{
  const f=await participantForm({employees:trainingEmployees.slice(0,1)});
  await f.form.getByText('Semua pegawai yang tersedia sudah menjadi peserta atau belum ada pegawai yang dapat dipilih.',{exact:true}).waitFor();
  assert.equal(await f.form.getByRole('button',{name:'Tambah peserta',exact:true}).isDisabled(),true);
 });
 assert.deepEqual(errors,[]);console.log(`${checks} isolated portal browser checks passed.`);
}finally{for(const context of contexts)await context.close();await browser.close();await new Promise(done=>server.close(done));}
