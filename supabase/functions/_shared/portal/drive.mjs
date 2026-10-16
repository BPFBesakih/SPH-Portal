import {Buffer} from 'node:buffer';
import {randomUUID} from 'node:crypto';
import {AppError,assert} from './db.mjs';

export function createDriveStorage(env,fetchImpl=globalThis.fetch.bind(globalThis)){
 const folder=env.GOOGLE_DRIVE_FOLDER_ID;
 const created=[];let access;
 async function request(url,options={}){
  let r;try{r=await fetchImpl(url,{...options,redirect:'manual',signal:AbortSignal.timeout(12000)});}catch{throw new AppError(503,'Penyimpanan berkas belum dapat dihubungi.');}
  if(!r.ok){await r.body?.cancel();throw new AppError(503,'Penyimpanan berkas belum dapat diakses.');}return r;
 }
 async function token(){
  if(access)return access;
  assert(folder&&env.GOOGLE_DRIVE_CLIENT_ID&&env.GOOGLE_DRIVE_CLIENT_SECRET&&env.GOOGLE_DRIVE_REFRESH_TOKEN,'Penyimpanan berkas belum dikonfigurasi.',503);
  const r=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:env.GOOGLE_DRIVE_CLIENT_ID,client_secret:env.GOOGLE_DRIVE_CLIENT_SECRET,refresh_token:env.GOOGLE_DRIVE_REFRESH_TOKEN})});
  const j=await r.json();assert(typeof j.access_token==='string'&&j.access_token.length<8192,'Penyimpanan berkas belum dapat diakses.',503);access=j.access_token;return access;
 }
 const headers=async()=>({Authorization:`Bearer ${await token()}`});
 const valid=id=>assert(typeof id==='string'&&/^[A-Za-z0-9_-]{8,200}$/.test(id),'Berkas tidak tersedia.',404);
 return {
  async put(data,mime){
   const boundary=`sph_${randomUUID()}`;
   const metadata={name:randomUUID(),parents:[folder],appProperties:{sph_portal:'v1'}};
   const body=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,data,`\r\n--${boundary}--`]);
   const r=await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{...await headers(),'Content-Type':`multipart/related; boundary=${boundary}`},body});
   const file=await r.json();valid(file.id);created.push(file.id);return file.id;
  },
  async get(id){
   valid(id);
   const meta=await (await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,parents,trashed,appProperties`,{headers:await headers()})).json();
   assert(meta.id===id&&!meta.trashed&&meta.parents?.includes(folder)&&meta.appProperties?.sph_portal==='v1','Berkas tidak tersedia.',404);
   const r=await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`,{headers:await headers()});
   const chunks=[];let size=0;const reader=r.body.getReader();
   try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>10*1024*1024){await reader.cancel();throw new AppError(503,'Berkas melebihi ukuran yang diizinkan.');}chunks.push(value);}}finally{reader.releaseLock();}
   return Buffer.concat(chunks);
  },
  async rollback(){for(const id of created){try{await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`,{method:'DELETE',headers:await headers()});}catch{/* An unlinked private upload remains inaccessible through the portal. */}}},
 };
}
