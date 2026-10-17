import {Buffer} from 'node:buffer';
import {randomUUID} from 'node:crypto';
import {AppError,assert} from './db.mjs';

const knownReasons=new Set(['invalid_grant','invalid_client','unauthorized_client','access_denied','authError','insufficientPermissions','insufficientFilePermissions','appNotAuthorizedToFile','notFound','storageQuotaExceeded','dailyLimitExceeded','userRateLimitExceeded','rateLimitExceeded','accessNotConfigured','domainPolicy','badRequest','backendError']);
async function errorReason(response){
 const reader=response.body?.getReader();if(!reader)return 'unknown';const chunks=[];let size=0;
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();return 'unknown';}chunks.push(value);}
  const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const reason=typeof body.error==='string'?body.error:body.error?.errors?.find(e=>knownReasons.has(e.reason))?.reason;
  return knownReasons.has(reason)?reason:'unknown';
 }catch{return 'unknown';}finally{reader.releaseLock();}
}
function storageError(stage,status,reason){
 let message='Penyimpanan berkas belum dapat diakses.';
 if(reason==='invalid_grant')message='Koneksi Google Drive perlu dihubungkan ulang. Token akses telah kedaluwarsa atau dicabut.';
 else if(['invalid_client','unauthorized_client'].includes(reason))message='Konfigurasi OAuth Google Drive tidak valid. Administrator perlu memeriksa koneksi penyimpanan.';
 else if(['insufficientPermissions','access_denied'].includes(reason))message='Izin koneksi Google Drive belum mengizinkan tindakan ini. Administrator perlu memeriksa izin unggah.';
 else if(['insufficientFilePermissions','appNotAuthorizedToFile','domainPolicy'].includes(reason))message='Aplikasi belum memiliki izin untuk menyimpan berkas di folder Google Drive tujuan.';
 else if(reason==='notFound'||status===404)message='Folder atau berkas Google Drive tidak ditemukan atau belum dapat diakses aplikasi.';
 else if(reason==='storageQuotaExceeded')message='Penyimpanan Google Drive penuh. Hubungi administrator untuk memeriksa kuota.';
 else if(['dailyLimitExceeded','userRateLimitExceeded','rateLimitExceeded'].includes(reason))message='Batas penggunaan Google Drive tercapai. Coba lagi beberapa saat atau hubungi administrator.';
 else if(reason==='accessNotConfigured')message='Google Drive API belum aktif untuk koneksi penyimpanan aplikasi.';
 else if(reason==='network_error')message='Penyimpanan berkas belum dapat dihubungi.';
 else if(stage==='upload')message=`Google Drive menolak unggahan berkas (HTTP ${status}). Hubungi administrator.`;
 else if(stage==='token')message=`Koneksi Google Drive gagal memperbarui akses (HTTP ${status}). Hubungi administrator.`;
 return new AppError(503,message,{service:'google_drive',stage,upstream_status:status,reason});
}
export function createDriveStorage(env,fetchImpl=globalThis.fetch.bind(globalThis)){
 const value=name=>typeof env[name]==='string'?env[name].trim():'';
 const folder=value('GOOGLE_DRIVE_FOLDER_ID'),clientId=value('GOOGLE_DRIVE_CLIENT_ID'),clientSecret=value('GOOGLE_DRIVE_CLIENT_SECRET'),refreshToken=value('GOOGLE_DRIVE_REFRESH_TOKEN');
 const created=[];let access;
 async function request(url,options={},stage='storage'){
  let r;try{r=await fetchImpl(url,{...options,redirect:'manual',signal:AbortSignal.timeout(12000)});}catch{throw storageError(stage,null,'network_error');}
  if(!r.ok)throw storageError(stage,r.status,await errorReason(r));return r;
 }
 async function token(){
  if(access)return access;
  assert(folder&&clientId&&clientSecret&&refreshToken,'Penyimpanan berkas belum dikonfigurasi.',503);
  const r=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken})},'token');
  const j=await r.json();assert(typeof j.access_token==='string'&&j.access_token.length<8192,'Penyimpanan berkas belum dapat diakses.',503);access=j.access_token;return access;
 }
 const headers=async()=>({Authorization:`Bearer ${await token()}`});
 const valid=id=>assert(typeof id==='string'&&/^[A-Za-z0-9_-]{8,200}$/.test(id),'Berkas tidak tersedia.',404);
 return {
  async put(data,mime){
   const boundary=`sph_${randomUUID()}`;
   const metadata={name:randomUUID(),parents:[folder],appProperties:{sph_portal:'v1'}};
   const body=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,data,`\r\n--${boundary}--`]);
   const r=await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{...await headers(),'Content-Type':`multipart/related; boundary=${boundary}`},body},'upload');
   const file=await r.json();valid(file.id);created.push(file.id);return file.id;
  },
  async get(id){
   valid(id);
   const meta=await (await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,parents,trashed,appProperties`,{headers:await headers()},'metadata')).json();
   assert(meta.id===id&&!meta.trashed&&meta.parents?.includes(folder)&&meta.appProperties?.sph_portal==='v1','Berkas tidak tersedia.',404);
   const r=await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`,{headers:await headers()},'download');
   const chunks=[];let size=0;const reader=r.body.getReader();
   try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>10*1024*1024){await reader.cancel();throw new AppError(503,'Berkas melebihi ukuran yang diizinkan.');}chunks.push(value);}}finally{reader.releaseLock();}
   return Buffer.concat(chunks);
  },
  async rollback(){for(const id of created){try{await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`,{method:'DELETE',headers:await headers()},'cleanup');}catch{/* An unlinked private upload remains inaccessible through the portal. */}}},
 };
}
