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
export const driveModuleFolders=Object.freeze({
 sop:'SPH-Portal-SOP',pelatihan:'SPH-Portal-Pelatihan',pegawai:'SPH-Portal-Pegawai',
 patroli:'SPH-Portal-Patroli',kejadian:'SPH-Portal-Kejadian',informasi:'SPH-Portal-Informasi',
 pengadaan:'SPH-Portal-Pengadaan',website:'SPH-Portal-Website',coaching:'SPH-Portal-Coaching',
});
export function driveModuleForOperation(path,body={}){
 const resource=typeof path==='string'?path.split('/')[0]:'';
 if(resource==='attachments')return {employee:'pegawai',logbook:'patroli',incident:'kejadian'}[body?.type]||null;
 const module={coaching:'coaching',documents:'sop',training:'pelatihan',employees:'pegawai',logbook:'patroli',incidents:'kejadian',announcements:'informasi',purchasing:'pengadaan',website:'website'}[resource];
 return typeof module==='string'?module:null;
}
export function createDriveStorage(env,fetchImpl=globalThis.fetch.bind(globalThis),options={}){
 const value=name=>typeof env[name]==='string'?env[name].trim():'';
 const folder=value('GOOGLE_DRIVE_FOLDER_ID'),clientId=value('GOOGLE_DRIVE_CLIENT_ID'),clientSecret=value('GOOGLE_DRIVE_CLIENT_SECRET'),refreshToken=value('GOOGLE_DRIVE_REFRESH_TOKEN');
 const created=[],moves=[],claimed=new Set(),folders=new Map();let access;
 const folderType='application/vnd.google-apps.folder';
 const metadataFields='id,parents,trashed,mimeType,appProperties';
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
 const knownModule=module=>typeof module==='string'&&Object.hasOwn(driveModuleFolders,module);
 const validFolder=(meta,module)=>meta&&typeof meta.id==='string'&&/^[A-Za-z0-9_-]{8,200}$/.test(meta.id)&&meta.trashed===false&&meta.mimeType===folderType&&meta.parents?.length===1&&meta.parents[0]===folder&&meta.appProperties?.sph_portal==='v1'&&meta.appProperties.sph_module===module;
 async function metadata(id){
  valid(id);
  try{return await (await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=${metadataFields}`,{headers:await headers()},'metadata')).json();}
  catch(error){if(error instanceof AppError&&error.details?.stage==='metadata'&&error.details.upstream_status===404)throw new AppError(404,'Berkas tidak tersedia.');throw error;}
 }
 async function moduleFolder(module){
  assert(knownModule(module),'Modul penyimpanan tidak valid.');
  if(!folders.has(module)){
   const pending=(async()=>{
    valid(folder);
    const url=new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q',`'${folder}' in parents and trashed = false and mimeType = '${folderType}' and appProperties has { key='sph_portal' and value='v1' } and appProperties has { key='sph_module' and value='${module}' }`);
    url.searchParams.set('fields',`files(${metadataFields})`);url.searchParams.set('pageSize','100');url.searchParams.set('orderBy','createdTime');
    const listing=await (await request(url.href,{headers:await headers()},'folder')).json();
    const existing=listing.files?.find(meta=>validFolder(meta,module));if(existing)return existing.id;
    const meta=await (await request(`https://www.googleapis.com/drive/v3/files?fields=${metadataFields}`,{method:'POST',headers:{...await headers(),'Content-Type':'application/json'},body:JSON.stringify({name:driveModuleFolders[module],mimeType:folderType,parents:[folder],appProperties:{sph_portal:'v1',sph_module:module}})},'folder')).json();
    assert(validFolder(meta,module),'Folder penyimpanan belum dapat diverifikasi.',503);return meta.id;
   })();folders.set(module,pending);
   try{return await pending;}catch(error){folders.delete(module);throw error;}
  }return folders.get(module);
 }
 async function ownedMetadata(id){
  const meta=await metadata(id);
  assert(meta.id===id&&meta.trashed===false&&typeof meta.mimeType==='string'&&meta.mimeType!==folderType&&meta.appProperties?.sph_portal==='v1'&&meta.parents?.length===1,'Berkas tidak tersedia.',404);
  if(meta.parents[0]===folder)return meta;
  const parent=await metadata(meta.parents[0]),module=parent?.appProperties?.sph_module;
  assert(knownModule(module)&&validFolder(parent,module)&&parent.id===meta.parents[0]&&(!meta.appProperties.sph_module||meta.appProperties.sph_module===module),'Berkas tidak tersedia.',404);
  return meta;
 }
 async function move(id,from,to,properties){
  const url=new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);
  url.searchParams.set('addParents',to);url.searchParams.set('removeParents',from);url.searchParams.set('fields',metadataFields);
  return (await request(url.href,{method:'PATCH',headers:{...await headers(),'Content-Type':'application/json'},body:JSON.stringify({appProperties:properties})},'organize')).json();
 }
 async function organize(id,module,meta){
  assert(knownModule(module),'Modul penyimpanan tidak valid.');meta=meta||await ownedMetadata(id);
  if(meta.parents[0]!==folder&&meta.appProperties.sph_module===module)return;
  const target=await moduleFolder(module);if(meta.parents[0]===target)return;
  // Record before PATCH so an uncertain network result can be reconciled on rollback.
  moves.push({id,from:meta.parents[0],to:target,properties:{...meta.appProperties}});
  const moved=await move(id,meta.parents[0],target,{...meta.appProperties,sph_module:module});
  assert(moved.id===id&&moved.parents?.length===1&&moved.parents[0]===target&&moved.appProperties?.sph_portal==='v1'&&moved.appProperties.sph_module===module,'Pemindahan berkas belum dapat diverifikasi.',503);
 }
 return {
  async put(data,mime){
   const boundary=`sph_${randomUUID()}`;
   const module=options.module;assert(module==null||knownModule(module),'Modul penyimpanan tidak valid.');
   const parent=module?await moduleFolder(module):folder;
   const meta={name:randomUUID(),parents:[parent],appProperties:{sph_portal:'v1',...(module?{sph_module:module}:{})}};
   const body=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,data,`\r\n--${boundary}--`]);
   const r=await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{...await headers(),'Content-Type':`multipart/related; boundary=${boundary}`},body},'upload');
   const file=await r.json();valid(file.id);created.push(file.id);return file.id;
  },
  claim(id){valid(id);claimed.add(id);},
  async finalize(){
   if(!claimed.size)return;
   assert(knownModule(options.module),'Modul lampiran belum dapat ditentukan.',503);
   for(const id of claimed)await organize(id,options.module);
   claimed.clear();
  },
  async get(id,module){
   const meta=await ownedMetadata(id);
   if(module)await organize(id,module,meta);
   const r=await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`,{headers:await headers()},'download');
   const chunks=[];let size=0;const reader=r.body.getReader();
   try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>10*1024*1024){await reader.cancel();throw new AppError(503,'Berkas melebihi ukuran yang diizinkan.');}chunks.push(value);}}finally{reader.releaseLock();}
   return Buffer.concat(chunks);
  },
  async rollback(){
   for(const entry of moves.slice().reverse()){
    if(created.includes(entry.id))continue;
    try{
     const meta=await ownedMetadata(entry.id);if(meta.parents[0]!==entry.to)continue;
     // Drive merges appProperties; null removes a newly added property.
     await move(entry.id,entry.to,entry.from,{...entry.properties,sph_module:entry.properties.sph_module||null});
    }catch{/* Both the original root and verified module folders remain readable. */}
   }
   for(const id of created){try{await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`,{method:'DELETE',headers:await headers()},'cleanup');}catch{/* An unlinked private upload remains inaccessible through the portal. */}}
  },
 };
}
