import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {parse} from './cloud-tools/node_modules/acorn/dist/acorn.mjs';
import {generate} from './cloud-tools/node_modules/astring/dist/astring.mjs';

// Keep the tested domain rules in lib/ as the source. This small compiler lifts
// database calls and their callers, including ordered array callbacks, to async.
// Generated output is committed and checked on PostgreSQL before deployment.
const destination=new URL('../supabase/functions/_shared/portal/',import.meta.url);
mkdirSync(destination,{recursive:true});
const names=['auth','files','hr','security','field-reports','quick-reports','coaching-links','briefings','roster','announcements','read-models','admin','purchasing-rules','purchasing'];
const modules=[];
for(const name of names){
 let source=readFileSync(new URL(`../lib/${name}.mjs`,import.meta.url),'utf8');
 if(name==='auth'){
  source=`import {createHash} from 'node:crypto';\nimport {all,one,assert,today} from './db.mjs';\nexport const digest=value=>createHash('sha256').update(value).digest('hex');\n`+
   source.slice(source.indexOf('export const resourceActions'),source.indexOf('export function seedPermissions'))+
   source.slice(source.indexOf('export function grants'),source.indexOf('export function cookies'))+
   `\nexport const safeUser=u=>({id:u.id,username:u.username,employee_id:u.employee_id,must_change_password:Boolean(u.must_change_password),status:u.status,row_version:u.row_version});\n`;
 }
 if(name==='files'){
  source=source.replace("import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';", "import {Buffer} from 'node:buffer';")
   .replace("import { resolve, basename } from 'node:path';", "import {basename} from 'node:path';")
   .replace('(Number(process.env.MAX_UPLOAD_MB)||10)*1024*1024','10*1024*1024')
   .replace("const key=randomUUID();mkdirSync(resolve(dataDir,'files'),{recursive:true});writeFileSync(resolve(dataDir,'files',key),data,{flag:'wx',mode:0o600});", "const key=await db.storage.put(data,types[extension],name);")
   .replace("readFileSync(resolve(dataDir,'files',file.storage_key))",'await db.storage.get(file.storage_key)');
  // acorn needs the existing await to be in an async function on the first parse.
  source=source.replace('export function storeUpload(', 'export async function storeUpload(').replace('export function download(', 'export async function download(');
 }
 if(name==='admin'){
  source=source.replace('postContext,hashPassword,digest','postContext,digest')
   .replace("const hash=await hashPassword(b.password);", "assert(typeof b.password==='string'&&b.password.length>=6&&b.password.length<=128,'Password harus 6–128 karakter.');const username=text(b.username,'Username',64).toLowerCase();assert(/^[a-z0-9._-]{1,64}$/.test(username),'Username hanya berisi huruf kecil, angka, titik, garis bawah atau tanda hubung.');assert(!await one(db,'SELECT id FROM users WHERE username=?',username),'Username sudah digunakan.',409);const identity=await db.identity.create(b.password);")
   .replace("{username:text(b.username,'Username',64).toLowerCase(),employee_id:b.employee_id||null,password_hash:hash,status:'ACTIVE',must_change_password:1,failed_login_count:0,password_changed_at:now(),created_by:user.id}", "{id:identity.id,username,employee_id:b.employee_id||null,status:'ACTIVE',must_change_password:1,password_changed_at:now(),created_by:user.id}")
   .replaceAll("run(db,'UPDATE auth_sessions SET revoked_at=? WHERE user_id=?',now(),id)","run(db,'UPDATE public.app_users SET row_version=row_version+1 WHERE id=?',id)")
   .replace("audit(db,user,'RESET_ISSUED','users',id);", "run(db,'UPDATE public.app_users SET must_change_password=true WHERE id=?',id);audit(db,user,'RESET_ISSUED','users',id);");
 }
 if(name==='hr')source=source.replace("run(db,'UPDATE auth_sessions SET revoked_at=? WHERE user_id IN (SELECT id FROM users WHERE employee_id=?)',now(),id)","run(db,'UPDATE public.app_users SET row_version=row_version+1 WHERE employee_id=?',id)");
 modules.push({name,ast:parse(source,{ecmaVersion:'latest',sourceType:'module'})});
}
function children(node){return Object.entries(node).filter(([k])=>!k.startsWith('_')).flatMap(([key,value])=>Array.isArray(value)?value.map((n,i)=>({n,key,i})): [{n:value,key}]).filter(({n})=>n&&typeof n==='object'&&typeof n.type==='string');}
const isFunction=n=>['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(n.type);
const functions=[];
function collect(node,parent){
 if(isFunction(node)){
  node._name=node.id?.name||(parent?.type==='VariableDeclarator'&&parent.id.type==='Identifier'?parent.id.name:null);
  functions.push(node);
 }
 for(const {n} of children(node))collect(n,node);
}
for(const m of modules)collect(m.ast);
const asyncNames=new Set(['all','one','run','get','insert','update','tx','audit','upload','download','claimFile','linkedFiles','fileAllowed']);
const arrayMethods=new Set(['map','filter','some','every','find','forEach','reduce']);
function asyncCallback(n){return isFunction(n)?n.async:n.type==='Identifier'&&asyncNames.has(n.name);}
function inspect(node,fn){
 if(node!==fn&&isFunction(node))return false;
 if(node.type==='AwaitExpression')return true;
 if(node.type==='CallExpression'){
  if(node.callee.type==='Identifier'&&asyncNames.has(node.callee.name))return true;
  if(node.callee.type==='MemberExpression'&&!node.callee.computed&&arrayMethods.has(node.callee.property.name)&&node.arguments.some(asyncCallback))return true;
 }
 return children(node).some(({n})=>inspect(n,fn));
}
for(let changed=true;changed;){
 changed=false;
 for(const fn of functions)if(!fn.async&&inspect(fn,fn)){fn.async=true;changed=true;}
 for(const fn of functions)if(fn.async&&fn._name&&!asyncNames.has(fn._name)){asyncNames.add(fn._name);changed=true;}
}
const id=name=>({type:'Identifier',name});
const awaitNode=argument=>({type:'AwaitExpression',argument});
function transform(node,parent){
 for(const {n,key,i} of children(node)){
  const result=transform(n,node);if(i===undefined)node[key]=result;else node[key][i]=result;
 }
 if(node.type==='CallExpression'){
  let needed=node.callee.type==='Identifier'&&asyncNames.has(node.callee.name);
  if(node.callee.type==='MemberExpression'&&!node.callee.computed&&node.arguments.some(asyncCallback)){
   const method=node.callee.property.name;
   if(!arrayMethods.has(method))throw new Error(`Unsupported asynchronous callback: ${method}`);
   const receiver=node.callee.object;
   node.callee=id(`async${method[0].toUpperCase()+method.slice(1)}`);
   node.arguments.unshift(receiver);needed=true;
  }
  if(needed&&parent?.type!=='AwaitExpression')return awaitNode(node);
 }
 delete node._name;
 return node;
}
for(const module of modules){
 const result=transform(module.ast);
 const prefix=`// Generated by scripts/generate-cloud-modules.mjs; domain source: lib/${module.name}.mjs.\nimport {asyncMap,asyncFilter,asyncSome,asyncEvery,asyncFind,asyncForEach,asyncReduce} from './arrays.mjs';\n`;
 writeFileSync(new URL(`${module.name}.mjs`,destination),prefix+generate(result));
}
console.log(`Generated ${modules.length} asynchronous domain modules.`);
