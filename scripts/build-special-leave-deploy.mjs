// Replace only the existing leave handler in a verified gateway snapshot.
// Usage: node scripts/build-special-leave-deploy.mjs <snapshot.ts> <sha256>
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from './cloud-tools/node_modules/esbuild/lib/main.js';
import {parse} from './cloud-tools/node_modules/acorn/dist/acorn.mjs';
const [sourcePath,expectedHash]=process.argv.slice(2);
if(!sourcePath||!/^[a-f0-9]{64}$/.test(expectedHash||''))throw new Error('Pass gateway snapshot and verified SHA-256.');
const source=readFileSync(resolve(sourcePath),'utf8');
const sha=createHash('sha256').update(source).digest('hex');
if(sha!==expectedHash)throw new Error('Gateway snapshot hash mismatch.');
if(source.includes('// BEGIN SPECIAL LEAVE MODULE'))throw new Error('Snapshot already has the special-leave module.');
const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
const handlers=ast.body.filter(n=>n.type==='FunctionDeclaration'&&n.id?.name==='leaveRoutes');
if(handlers.length!==1)throw new Error('Expected exactly one existing leaveRoutes handler.');
const handler=handlers[0];
const result=await build({entryPoints:[resolve('supabase/functions/_shared/portal/leaves.mjs')],write:false,bundle:true,format:'iife',globalName:'__specialLeave',platform:'neutral',target:'es2022',packages:'external',legalComments:'none'});
const moduleText=result.outputFiles[0].text;
if(/^import /m.test(moduleText))throw new Error('Unexpected import in isolated leave module.');
const replacement='// BEGIN SPECIAL LEAVE MODULE\n'+moduleText+'// END SPECIAL LEAVE MODULE\nasync function leaveRoutes(context,services){return __specialLeave.leaveRoutes(context,services);}';
const patched=source.slice(0,handler.start)+replacement+source.slice(handler.end);
parse(patched,{ecmaVersion:'latest',sourceType:'module'});
// All bytes outside this one handler remain exactly as in the supplied snapshot.
const output=resolve('supabase/deploy/portal-api/index.ts');writeFileSync(output,patched);
console.log(JSON.stringify({source_sha256:sha,output,output_sha256:createHash('sha256').update(patched).digest('hex'),patches:['existing leaveRoutes handler only']}));
