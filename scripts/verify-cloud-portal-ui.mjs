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
const server=createServer(async(req,res)=>{const path=resolve(root,`.${new URL(req.url,'http://fixture').pathname.replace(/\/$/,'/index.html')}`);if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}try{const body=await readFile(path);res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[extname(path)]||'application/octet-stream','Content-Security-Policy':csp,'Permissions-Policy':'camera=(self), microphone=(), geolocation=(self)','Cache-Control':'no-store'}).end(body);}catch{res.writeHead(404).end();}});
await new Promise(ready=>server.listen(0,'127.0.0.1',ready));
const base=`http://127.0.0.1:${server.address().port}`,origin='https://portal.test';
const browser=await chromium.launch({executablePath,headless:true});
let checks=0;
const check=async(name,fn)=>{await fn();console.log(`PASS ${name}`);checks++;};
const permissions=['admin.users.read','admin.users.manage','admin.users.reset','admin.roles.read','admin.roles.manage','admin.audit.read'];
const me={user:{id:'fixture-user',username:'itadmin',status:'ACTIVE',row_version:1,must_change_password:false,employee_id:null},name:'itadmin',permissions,csrfToken:'fixture-csrf',demo:false};
const contexts=[];const errors=[];
async function fixture({signedIn=true,required=false,roleEditor=false,mayManage=true,viewport={width:1440,height:960}}={}){
 const context=await browser.newContext({viewport,baseURL:origin});contexts.push(context);const page=await context.newPage();let active=0,maximum=0;const calls=[];let authenticated=signedIn;
 let currentPermissions=permissions.filter(p=>mayManage||p!=='admin.roles.manage');
 const systemRole={id:'fixture-system-role',code:'SUPER_ADMIN',name:'Super Admin',is_system:1,is_active:1,row_version:1,permissions:[...permissions]};
 const catalog=[...permissions,'hr.employees.read'].map(code=>({code,resource:code.split('.').slice(0,2).join('.'),action:code.split('.').at(-1)}));
 page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(msg.type()==='error'&&!msg.text().includes('Failed to load resource'))errors.push(msg.text());});
 await page.route(`${origin}/**`,async route=>{
  const req=route.request(),url=new URL(req.url());if(!url.pathname.startsWith('/api/')){const r=await fetch(base+url.pathname);await route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())});return;}
  active++;maximum=Math.max(maximum,active);calls.push({path:url.pathname,method:req.method(),body:req.postDataJSON()});let body,status=200;
  await new Promise(r=>setTimeout(r,15));
  try{
   if(url.pathname==='/api/auth/login'){const sent=req.postDataJSON();assert.equal(sent.username,'itadmin');authenticated=true;body={ok:true};}
   else if(url.pathname==='/api/auth/logout'){assert.equal(req.headers()['x-csrf-token'],'fixture-csrf');authenticated=false;body={ok:true};}
   else if(!authenticated){status=401;body={error:'SESSION_ENDED',message:'Sesi berakhir. Silakan masuk kembali.'};}
   else if(url.pathname==='/api/portal/me')body={...me,permissions:currentPermissions,user:{...me.user,must_change_password:required}};
   else if(url.pathname==='/api/users')body={items:[{...me.user,grants:[]}]};
   else if(url.pathname==='/api/announcements')body={items:[],can_manage:true};
   else if(url.pathname==='/api/roles')body={items:roleEditor?[systemRole]:[],permissions:roleEditor?catalog:[]};
   else if(roleEditor&&url.pathname===`/api/roles/${systemRole.id}`&&req.method()==='PATCH'){const change=req.postDataJSON();assert(mayManage);systemRole.permissions=change.permissions;systemRole.row_version++;currentPermissions=[...change.permissions];body={...systemRole};}
   else if(url.pathname==='/api/settings')body={allow_gap_publication:'false'};
   else if(url.pathname==='/api/audit')body={items:[]};
   else throw new Error(`Unexpected fixture request ${url.pathname}`);
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  }finally{active--;}
 });
 await page.goto('/app/');return {page,calls,get maximum(){return maximum;}};
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
 await check('the mobile shell fits 320 px and opens its navigation',async()=>{
  const f=await fixture({viewport:{width:320,height:800}});await f.page.getByRole('heading',{name:'Akun Pengguna',exact:true}).waitFor();
  assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await f.page.getByRole('button',{name:'Buka navigasi'}).click();assert(await f.page.locator('.sidebar').evaluate(e=>e.classList.contains('open')));
  await f.page.locator('.sidebar').evaluate(async e=>{await Promise.all(e.getAnimations().map(a=>a.finished));});
  const box=await f.page.locator('.sidebar').boundingBox();assert(box.x>=0&&box.width<=320);
  await f.page.screenshot({path:resolve(output,'admin-mobile.png'),fullPage:true});
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
 assert.deepEqual(errors,[]);console.log(`${checks} isolated portal browser checks passed.`);
}finally{for(const context of contexts)await context.close();await browser.close();await new Promise(done=>server.close(done));}
