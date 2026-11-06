// Add one isolated attendance module to the verified live gateway without
// regenerating unrelated handlers from older generated source modules.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from './cloud-tools/node_modules/esbuild/lib/main.js';
import {parse} from './cloud-tools/node_modules/acorn/dist/acorn.mjs';
const root=new URL('../',import.meta.url),target=new URL('supabase/deploy/portal-api/index.ts',root);
const baseline=JSON.parse(readFileSync(new URL('supabase/attendance/baseline.json',root),'utf8'));
const digest=s=>createHash('sha256').update(s).digest('hex');
let source=readFileSync(target,'utf8');
for(const name of ['MODULE','ROUTE']){
 const pattern=new RegExp('// BEGIN ATTENDANCE '+name+'\\n[\\s\\S]*?// END ATTENDANCE '+name+'\\n','g');
 const count=[...source.matchAll(pattern)].length;if(count>1)throw Error('Duplicate attendance '+name+' marker.');source=source.replace(pattern,'');
}
if(digest(source)!==baseline.sha256)throw Error('Gateway baseline changed. Review/rebase against live deployment before rebuilding attendance.');
const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
const handlers=ast.body.filter(n=>n.type==='FunctionDeclaration'&&n.id?.name==='routeOperation');
if(handlers.length!==1)throw Error('Expected exactly one router.');
const handler=handlers[0],anchor='  await guardLeaveRoleChanges({ db, user, p, method, body }, assert);\n';
const insertion=source.indexOf(anchor,handler.start)+anchor.length;
if(insertion<handler.start||insertion>handler.end)throw Error('Authenticated routing anchor missing.');
const built=await build({entryPoints:[fileURLToPath(new URL('supabase/functions/_shared/portal/attendance.mjs',root))],write:false,bundle:true,format:'iife',globalName:'__attendance',platform:'neutral',target:'es2022',packages:'external',legalComments:'none'});
const isolated=built.outputFiles[0].text;if(/^import /m.test(isolated))throw Error('Unexpected module import.');
const module='// BEGIN ATTENDANCE MODULE\n'+isolated+'function adoptAttendanceError(error){if(error instanceof Error && Number.isInteger(error.status) && error.status>=400 && error.status<600)throw new AppError(error.status,error.message);throw error;}\n// END ATTENDANCE MODULE\n';
const route='// BEGIN ATTENDANCE ROUTE\n  if(p[0]==="attendance")return __attendance.attendanceRoutes({db,user,p,method,body,url},{can,has,audit,collectionEnabled:Deno.env.get("ATTENDANCE_ENABLED")==="true"}).catch(adoptAttendanceError);\n// END ATTENDANCE ROUTE\n';
const patched=source.slice(0,handler.start)+module+source.slice(handler.start,insertion)+route+source.slice(insertion);
parse(patched,{ecmaVersion:'latest',sourceType:'module'});
writeFileSync(target,patched);
console.log(JSON.stringify({baseline_sha256:baseline.sha256,output_sha256:digest(patched),changes:['isolated attendance module','authenticated attendance route'],collection_default:'disabled'}));
