import {randomUUID} from 'node:crypto';
export const now=()=>new Date().toISOString();
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Makassar'}).format(new Date());
export const uid=()=>randomUUID();
export class AppError extends Error{constructor(status,message,details){super(message);this.status=status;this.details=details;}}
export const assert=(condition,message,status=422)=>{if(!condition)throw new AppError(status,message);};
const sqlName=n=>{if(!/^[a-z_][a-z0-9_]*$/.test(n))throw new Error('Invalid SQL identifier');return n;};
// Only fixed server SQL reaches this adapter. Values always remain parameters.
export function postgresQuery(sql){
 let quoted=false,index=0,out='';
 for(let i=0;i<sql.length;i++){
  const c=sql[i];
  if(c==="'"){out+=c;if(quoted&&sql[i+1]==="'"){out+=sql[++i];continue;}quoted=!quoted;continue;}
  out+=c==='?'&&!quoted?`$${++index}`:c;
 }
 return out.replace(/\b([a-z_]\w*)\.rowid\b/gi,'$1.id');
}
export const all=(db,sql,...args)=>db.query(postgresQuery(sql),args.map(v=>v??null));
export const one=async(db,sql,...args)=>(await all(db,sql,...args))[0];
export const run=async(db,sql,...args)=>{const rows=await db.query(postgresQuery(sql),args.map(v=>v??null));return {changes:rows.count??rows.affectedRows??0};};
export async function insert(db,table,values){
 const row={id:uid(),created_at:now(),updated_at:now(),row_version:1,...values};
 const columns=Object.keys(row).map(sqlName);
 await run(db,`INSERT INTO ${sqlName(table)} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`,...Object.values(row).map(v=>typeof v==='boolean'?Number(v):v??null));
 return one(db,`SELECT * FROM ${sqlName(table)} WHERE id=?`,row.id);
}
export async function update(db,table,id,version,values){
 assert(Number.isInteger(version),'Versi data wajib dikirim. Muat ulang data.',409);
 const row={...values,updated_at:now()};
 const result=await run(db,`UPDATE ${sqlName(table)} SET ${Object.keys(row).map(k=>`${sqlName(k)}=?`).join(',')},row_version=row_version+1 WHERE id=? AND row_version=?`,...Object.values(row).map(v=>typeof v==='boolean'?Number(v):v??null),id,version);
 assert(result.changes===1,'Data sudah berubah. Muat ulang sebelum menyimpan.',409);
 return one(db,`SELECT * FROM ${sqlName(table)} WHERE id=?`,id);
}
// The request owner opens a single database transaction around authentication,
// authorization and the entire handler. Nested domain transactions share it.
export async function tx(db,work){assert(db.inTransaction,'Transaction required.',500);return await work();}
export async function audit(db,actor,action,type,key,summary={},reason=''){
 await insert(db,'audit_events',{actor_user_id:actor?.id||null,action,object_type:type,object_key:String(key),occurred_at:now(),outcome:'SUCCESS',request_id:actor?.request_id||uid(),reason,change_summary:JSON.stringify(summary)});
}
export async function get(db,table,id){const row=await one(db,`SELECT * FROM ${sqlName(table)} WHERE id=?`,id);assert(row,'Data tidak ditemukan.',404);return row;}
export function text(v,label='Isian',max=500){assert(typeof v==='string'&&v.trim().length>0&&v.length<=max,`${label} wajib diisi (maksimal ${max} karakter).`);return v.trim();}
export function date(v,label='Tanggal'){assert(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,`${label} tidak valid.`);return v;}
export function instant(v){assert(typeof v==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(v)&&!isNaN(Date.parse(v)),'Waktu harus menyertakan zona waktu.');return new Date(v).toISOString();}
export function integer(v,label,min=0,max=100000){const n=Number(v);assert(v!==''&&v!=null&&Number.isInteger(n)&&n>=min&&n<=max,`${label} harus bilangan bulat ${min}–${max}.`);return n;}
export function enumValue(v,choices,label='Status'){assert(choices.includes(v),`${label} tidak valid.`);return v;}
