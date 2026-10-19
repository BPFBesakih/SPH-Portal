import {readFileSync,writeFileSync,mkdirSync,cpSync,readdirSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {build} from './cloud-tools/node_modules/esbuild/lib/main.js';
const root=new URL('../',import.meta.url);
for(const script of ['generate-cloud-modules.mjs','generate-cloud-schema.mjs']){
 const result=spawnSync(process.execPath,[fileURLToPath(new URL(script,import.meta.url))],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);
}
const output=new URL('supabase/deploy/portal-api/',root);mkdirSync(output,{recursive:true});
await build({entryPoints:[fileURLToPath(new URL('supabase/functions/portal-api/index.ts',root))],outfile:fileURLToPath(new URL('index.ts',output)),bundle:true,format:'esm',platform:'neutral',target:'es2022',packages:'external',legalComments:'none'});
const app=new URL('site-info/dist/app/',root);mkdirSync(app,{recursive:true});cpSync(new URL('public/',root),app,{recursive:true});
function visit(dir){for(const name of readdirSync(dir)){const path=new URL(name,dir);if(statSync(path).isDirectory()){visit(new URL(`${name}/`,dir));continue;}if(!/\.(html|js|css)$/.test(name))continue;let text=readFileSync(path,'utf8').replaceAll('/assets/','/app/assets/');if(name==='index.html')text=text.replaceAll('href="/styles.css"','href="/app/styles.css"').replaceAll('href="/mvp.css"','href="/app/mvp.css"').replaceAll('href="/appearance.css"','href="/app/appearance.css"').replaceAll('href="/photo-slideshow.css"','href="/app/photo-slideshow.css"').replaceAll('src="/app.js"','src="/app/app.js"');
 if(name==='api.js')text=text.replace('const headers={...options.headers};',"if(path==='auth/me')path='portal/me';const headers={...options.headers};")
  .replace("new Error(data.error||'Permintaan gagal.')","new Error(data.message||data.error||'Permintaan gagal.')");
 if(name==='app.js')text=text.replace("await post('auth/login',Object.fromEntries(new FormData(form)));","const values=Object.fromEntries(new FormData(form));form.querySelector('[name=password]').value='';await post('auth/login',values);");
 writeFileSync(path,text);
}}
visit(app);
console.log('Prepared Cloudflare /app/ assets and one-file Supabase portal-api deployment. No production data or credentials included.');
