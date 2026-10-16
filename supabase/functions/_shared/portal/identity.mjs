import {randomUUID} from 'node:crypto';
import {AppError,assert} from './db.mjs';
export function runtimeKey(env,dictionary,legacy){const values=env[dictionary];if(values){const key=JSON.parse(values).default;assert(typeof key==='string'&&key.length>0,'Konfigurasi layanan belum lengkap.',503);return key;}assert(env[legacy],'Konfigurasi layanan belum lengkap.',503);return env[legacy];}
export function createIdentity(env,fetchImpl=globalThis.fetch.bind(globalThis)){
 const base=new URL(env.SUPABASE_URL);assert(base.protocol==='https:'&&/^[a-z0-9-]+\.supabase\.co$/.test(base.hostname)&&!base.username&&!base.password,'Konfigurasi layanan tidak valid.',503);
 const key=runtimeKey(env,'SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY');
 const created=[];
 async function call(path,method,body,token){
  let r;try{r=await fetchImpl(`${base.origin}/auth/v1/${path}`,{method,redirect:'manual',signal:AbortSignal.timeout(12000),headers:{apikey:key,...(token||key.startsWith('eyJ')?{Authorization:`Bearer ${token||key}`} :{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}catch{throw new AppError(503,'Layanan akun belum dapat dihubungi.');}
  if(!r.ok){await r.body?.cancel();const ended=path==='user'&&[401,403].includes(r.status);throw new AppError(ended?401:r.status===422?422:503,ended?'Sesi berakhir. Silakan masuk kembali.':r.status===422?'Password tidak memenuhi ketentuan layanan akun.':'Layanan akun belum dapat diakses.');}
  return r.status===204?null:await r.json();
 }
 return {
  verify:token=>call('user','GET',undefined,token),
  async create(password){const user=await call('admin/users','POST',{email:`${randomUUID()}@accounts.sph-portal.invalid`,password,email_confirm:true});assert(typeof user?.id==='string','Pembuatan akun belum dapat dikonfirmasi.',503);created.push(user.id);return user;},
  setPassword:(id,password)=>call(`admin/users/${encodeURIComponent(id)}`,'PUT',{password}),
  async rollback(){for(const id of created){try{await call(`admin/users/${encodeURIComponent(id)}`,'DELETE');}catch{/* No app_users link means the orphan cannot enter the portal. */}}},
 };
}
