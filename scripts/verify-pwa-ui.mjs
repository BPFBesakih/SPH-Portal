// Isolated browser verification of the built PWA. Uses no production account or data.
// Usage: node scripts/verify-pwa-ui.mjs <playwright/index.mjs> <browser executable>
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {pathToFileURL} from 'node:url';

const [playwrightPath,executablePath]=process.argv.slice(2);
if(!playwrightPath||!executablePath)throw new Error('Supply Playwright and browser executable paths.');
const {chromium}=await import(pathToFileURL(resolve(playwrightPath)).href);
const root=resolve('site-info/dist'),output=resolve('test-results/pwa-ui');
await mkdir(output,{recursive:true});
const headerSource=await readFile(resolve(root,'_headers'),'utf8');
const csp=headerSource.split(/\r?\n/).find(line=>line.trim().startsWith('Content-Security-Policy:')).trim().slice(24).trim();
const requests=[];
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://fixture');requests.push(url.pathname);
 if(url.pathname.startsWith('/api/')){
  res.writeHead(401,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({error:'SESSION_ENDED',message:'Silakan masuk kembali.'}));return;
 }
 const path=resolve(root,`.${url.pathname.replace(/\/$/,'/index.html')}`);
 if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
 try{
  const body=await readFile(path);
  res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.webmanifest':'application/manifest+json'}[extname(path)]||'application/octet-stream','Content-Security-Policy':csp,'Cache-Control':'no-store'}).end(body);
 }catch{res.writeHead(404).end();}
});
await new Promise(ready=>server.listen(0,'127.0.0.1',ready));
const base=`http://127.0.0.1:${server.address().port}`;
let browser,checks=0;
const profile=await mkdtemp(resolve(output,'profile-'));
const check=async(name,fn)=>{await fn();checks++;console.log(`PASS ${name}`);};
try{
 // A fresh persistent profile allows installability checks, which incognito blocks.
 browser=await chromium.launchPersistentContext(profile,{executablePath,headless:true,viewport:{width:1365,height:900}});
 const context=browser,page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error'&&/Content Security Policy|Refused to|violates/.test(message.text()))errors.push(message.text());});
 await check('built workspace registers the service worker under the production CSP',async()=>{
  await page.goto(`${base}/app/`);
  await page.locator('#login-form').waitFor();
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.waitForFunction(()=>navigator.serviceWorker.controller?.state==='activated');
  assert.deepEqual(await page.evaluate(async()=>{const registration=await navigator.serviceWorker.ready;return {scope:registration.scope,worker:registration.active.scriptURL};}),{scope:`${base}/app/`,worker:`${base}/app/sw.js`});
 });
 await check('Chromium accepts the manifest and reports no installability errors',async()=>{
  const session=await context.newCDPSession(page);
  const result=await session.send('Page.getAppManifest');
  assert.deepEqual(result.errors,[]);
  const manifest=JSON.parse(result.data);
  assert.equal(new URL(manifest.id,result.url).href,`${base}/app/`);
  assert.equal(new URL(manifest.start_url,result.url).href,`${base}/app/`);
  assert.equal(manifest.display,'standalone');
  for(const icon of manifest.icons){
   const response=await context.request.get(new URL(icon.src,result.url).href);
   assert.equal(response.status(),200);assert.match(response.headers()['content-type'],/^image\/png/);
  }
  const {installabilityErrors}=await session.send('Page.getInstallabilityErrors');
  assert.deepEqual(installabilityErrors,[]);
  await session.detach();
 });
 await check('offline page and retry work on desktop and mobile without cached portal data',async()=>{
  await context.setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Tidak ada koneksi internet',exact:true}).waitFor();
  assert.equal(await page.evaluate(async()=>JSON.stringify(await caches.keys())),'[]');
  await page.screenshot({path:resolve(output,'offline-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Coba lagi',exact:true}).click();
  await page.getByRole('heading',{name:'Tidak ada koneksi internet',exact:true}).waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:resolve(output,'offline-mobile.png'),fullPage:true});
 });
 await check('reconnecting automatically restores the login screen',async()=>{
  await context.setOffline(false);
  await page.locator('#login-form').waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:resolve(output,'online-mobile.png'),fullPage:true});
 });
 await check('account page stays outside the PWA worker scope',async()=>{
  await page.goto(`${base}/portal/`);
  assert.equal(await page.evaluate(()=>navigator.serviceWorker.controller),null);
  assert.equal(await page.locator('link[rel="manifest"]').count(),0);
  assert.equal(await page.locator('link[rel="apple-touch-icon"]').getAttribute('href'),'/app/assets/icons/apple-touch-icon.png');
 });
 assert.deepEqual(errors,[],'No runtime or CSP errors are allowed.');
 assert(requests.includes('/app/sw.js'));
 console.log(`Verified ${checks} PWA browser checks. Screenshots: ${output}`);
}finally{
 await browser?.close();
 await new Promise(done=>server.close(done));
 assert(resolve(profile).startsWith(output+sep)&&profile.split(sep).at(-1).startsWith('profile-'));
 await rm(profile,{recursive:true,force:true});
}
