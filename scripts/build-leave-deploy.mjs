// Patch only the leave route into the actual active production gateway.
// This intentionally does not regenerate older unrelated backend modules.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from './cloud-tools/node_modules/esbuild/lib/main.js';
const [sourcePath,expectedHash]=process.argv.slice(2);
if(!sourcePath||!/^[a-f0-9]{64}$/.test(expectedHash||''))throw new Error('Pass active gateway source and its verified SHA-256.');
const source=readFileSync(resolve(sourcePath),'utf8');
const sha=createHash('sha256').update(source).digest('hex');
if(sha!==expectedHash)throw new Error('Active gateway snapshot hash mismatch.');
const anchor='  assert(!user.must_change_password, "Anda wajib mengganti password sementara terlebih dahulu.", 428);';
const route=source.indexOf('async function routeOperation('),point=source.indexOf(anchor,route);
if(route<0||point<route||source.includes("p[0] === 'leaves'"))throw new Error('Gateway route boundary does not match the inspected production version.');
const bridge="\n  if (p[0] === 'leaves') return leaveRoutes({db,user,p,method,body,url},{assert,can,has,audit,today});";
const patched="import {leaveRoutes} from '../../functions/_shared/portal/leaves.mjs';\n"+
 source.slice(0,point)+anchor+bridge+source.slice(point+anchor.length);
const out=resolve('supabase/deploy/portal-api/index.ts');mkdirSync(dirname(out),{recursive:true});
await build({stdin:{contents:patched,resolveDir:dirname(out),sourcefile:'active-gateway-with-leave.ts',loader:'ts'},
 outfile:out,bundle:true,format:'esm',platform:'neutral',target:'es2022',packages:'external',external:['node:*','npm:*'],legalComments:'none'});
console.log(JSON.stringify({source_sha256:sha,output:out,output_sha256:createHash('sha256').update(readFileSync(out)).digest('hex'),patches:['one leave module import','one route dispatch after existing password gate']}));
