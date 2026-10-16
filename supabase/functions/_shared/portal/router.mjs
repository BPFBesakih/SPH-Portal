import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {all,one,audit,assert,AppError,get} from './db.mjs';
import {safeUser,grants,announcementsManager,has,can,postContext} from './auth.mjs';
import {hrRoutes,employees} from './hr.mjs';
import {securityRoutes} from './security.mjs';
import {rosterRoutes} from './roster.mjs';
import {adminRoutes} from './admin.mjs';
import {announcementRoutes} from './announcements.mjs';
import {dashboard,lookups} from './read-models.mjs';
import {upload,download,attach} from './files.mjs';
export async function routeOperation({db,user,path,method,body={},query=''}){
 assert(typeof path==='string'&&/^[a-z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(path)&&path.length<=512,'Alamat API tidak valid.',404);
 assert(['GET','POST','PATCH','DELETE'].includes(method),'Metode tidak diizinkan.',405);
 const p=path.split('/');const url=new URL(`https://portal.invalid/?${query}`);
 if(path==='portal/me'&&method==='GET')return {user:safeUser(user),name:user.employee_id?(await get(db,'employees',user.employee_id)).full_name:user.username,permissions:[...new Set((await grants(db,user)).map(g=>g.code))],announcements_manage:await announcementsManager(db,user),demo:false};
 assert(!user.must_change_password,'Anda wajib mengganti password sementara terlebih dahulu.',428);
 if(path==='dashboard'&&method==='GET')return dashboard(db,user,url.searchParams.get('module')||'hr',url.searchParams.get('as_of')||undefined);
 if(path==='lookups'&&method==='GET')return lookups(db,user,url.searchParams.get('purpose')||'employees',url.searchParams.get('session_id'));
 if(p[0]==='exports'&&method==='GET'){
  const cell=v=>'"'+String(v??'').replace(/^[=+\-@\t\r]/,"'$&").replaceAll('"','""')+'"';let rows,filename;
  if(p[1]==='employees'){
   assert(await has(db,user,'hr.employees.export'),'Akses ekspor ditolak.',403);rows=[['Nomor pegawai','Nama','Unit','Posisi','Status','Tanggal mulai','Aktif']];
   for(const e of await employees(db))if(await can(db,user,'hr.employees.read',e)&&await can(db,user,'hr.employees.export',e))rows.push([e.employee_no,e.full_name,e.unit_name,e.position_name,e.employment_status,e.joined_on,e.is_active?'Ya':'Tidak']);filename='pegawai-besakih.csv';
  }else if(p[1]==='revisions'&&p[2]){
   assert(await has(db,user,'security.roster.export'),'Akses ekspor ditolak.',403);
   const revision=await rosterRoutes({db,user,p:['revisions',p[2]],method:'GET',body:{},url});rows=[['Tanggal tugas','Nomor pegawai','Nama','Pos','Shift','Mulai UTC','Selesai UTC','Sumber']];
   for(const a of revision.assignments)if(await can(db,user,'security.roster.export',{...a,...await postContext(db,a.post_id)}))rows.push([a.service_date,a.display.employee_no,a.display.employee_name,a.display.post_name,a.display.shift_name,a.starts_at,a.ends_at,a.origin]);filename=`jadwal-revisi-${revision.revision_no}.csv`;
  }else throw new AppError(404,'Jenis ekspor tidak ditemukan.');
  await audit(db,user,'EXPORT',p[1],p[2]||'list',{row_count:rows.length-1});return {filename,csv:rows.map(row=>row.map(cell).join(',')).join('\r\n')};
 }
 if(path==='uploads'&&method==='POST')return upload(db,user,body);
 if(path==='attachments'&&method==='POST')return attach(db,user,body.type,body.owner_id,body);
 if(p[0]==='files'&&p.length===2&&method==='GET'){
  const {file,data}=await download(db,user,p[1]);
  assert(data.length===file.size_bytes&&createHash('sha256').update(data).digest('hex')===file.checksum,'Integritas berkas belum dapat diverifikasi.',503);
  return {binary:true,data:Buffer.from(data).toString('base64'),mime_type:file.mime_type,name:file.original_name,inline:url.searchParams.get('inline')==='1'&&['image/png','image/jpeg'].includes(file.mime_type)};
 }
 const ctx={db,user,p,method,body,url};
 for(const handler of [announcementRoutes,hrRoutes,securityRoutes,rosterRoutes,adminRoutes]){const result=await handler(ctx);if(result!==undefined)return result;}
 throw new AppError(404,'Alamat API tidak ditemukan.');
}
