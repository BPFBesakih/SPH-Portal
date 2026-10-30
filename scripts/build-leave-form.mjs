import {readFileSync,writeFileSync,mkdirSync,cpSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from './cloud-tools/node_modules/esbuild/lib/main.js';
const root=new URL('../',import.meta.url),output=new URL('supabase/deploy/leave-form/',root);
mkdirSync(output,{recursive:true});
await build({entryPoints:[fileURLToPath(new URL('supabase/functions/leave-form/index.ts',root))],outfile:fileURLToPath(new URL('index.ts',output)),bundle:true,format:'esm',platform:'neutral',target:'es2022',packages:'external',legalComments:'none'});
const app=new URL('site-info/dist/app/',root),page=new URL('site-info/dist/cuti/',root);mkdirSync(page,{recursive:true});
for(const name of ['leave-form.html','leave-form.js','leave-form.css','leaves.js','leave-notifications.js','employee-picker.js'])cpSync(new URL(`public/${name}`,root),new URL(name,app));
// Keep the established Pages asset paths and login password-field clearing.
const portalApp=readFileSync(new URL('public/app.js',root),'utf8').replaceAll('/assets/','/app/assets/')
 .replace("await post('auth/login',Object.fromEntries(new FormData(form)));","const values=Object.fromEntries(new FormData(form));form.querySelector('[name=password]').value='';await post('auth/login',values);");
writeFileSync(new URL('app.js',app),portalApp);
writeFileSync(new URL('index.html',page),readFileSync(new URL('public/leave-form.html',root),'utf8'));
console.log('Prepared employee leave form and server-secret function.');
