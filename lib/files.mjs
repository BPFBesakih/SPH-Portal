import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { all, one, get, insert, tx, audit, assert, text, now } from './db.mjs';
import { has, can, employeeContext, postContext, reportContext, announcementsManager, documentAllowed, trainingAllowed } from './auth.mjs';
const attachments = [
 ['employee_files','employee_id','employee'], ['employee_contracts','employee_id','contract'],
 ['document_versions','document_id','document'], ['training_materials','training_event_id','material'],
 ['participant_certificates','training_participant_id','certificate'], ['logbook_files','logbook_entry_id','logbook'], ['incident_files','incident_id','incident'], ['announcement_files','announcement_id','announcement']
];
export function claimFile(db,user,id) {
  const f=get(db,'files',id);assert(f.status==='AVAILABLE'&&f.uploaded_by===user.id,'Berkas tidak tersedia untuk dilampirkan.',403);
  assert(!attachments.some(([t])=>one(db,`SELECT id FROM ${t} WHERE file_id=?`,id)),'Berkas sudah terhubung. Unggah berkas baru untuk objek ini.');return f;
}
export function linkedFiles(db,type,id) {
  const entry=attachments.find(x=>x[2]===type);assert(entry,'Jenis lampiran tidak valid.');
  const metadata=type==='announcement'?',l.usage_kind,l.caption':['logbook','incident'].includes(type)?',l.captured_at,l.capture_source':'';
  return all(db,`SELECT f.id,f.original_name,f.mime_type,f.size_bytes,l.id link_id${metadata} FROM ${entry[0]} l JOIN files f ON f.id=l.file_id WHERE l.${entry[1]}=? AND f.status='AVAILABLE'`,id);
}
export function fileAllowed(db,user,id) {
  for(const material of all(db,'SELECT tm.training_event_id,v.document_id FROM training_materials tm JOIN document_versions v ON v.id=tm.document_version_id WHERE v.file_id=?',id))if(trainingAllowed(db,user,'download',get(db,'training_events',material.training_event_id))&&documentAllowed(db,user,'download',get(db,'documents',material.document_id)))return true;
  for(const [table,key,type] of attachments) for(const link of all(db,`SELECT * FROM ${table} WHERE file_id=?`,id)) {
    if(['employee','contract'].includes(type)&&can(db,user,'hr.employee_files.read',employeeContext(db,link[key])))return true;
    if(type==='document') {const doc=get(db,'documents',link.document_id);if(documentAllowed(db,user,'download',doc)&&(link.state==='ACTIVE'||documentAllowed(db,user,'manage',doc)))return true;}
    if(type==='material'&&trainingAllowed(db,user,'download',get(db,'training_events',link.training_event_id)))return true;
    if(type==='certificate') {const p=get(db,'training_participants',link.training_participant_id),event=get(db,'training_events',p.training_event_id);if(trainingAllowed(db,user,'download',event)&&(user.employee_id===p.employee_id||trainingAllowed(db,user,'participants',event)))return true;}
    if(type==='logbook') {const log=get(db,'logbook_entries',link.logbook_entry_id);if(can(db,user,'security.logbook.download',reportContext(db,log)))return true;}
    if(type==='incident') {const incident=get(db,'incidents',link.incident_id);if(can(db,user,'security.incidents.download',reportContext(db,incident)))return true;}
    if(type==='announcement'){const a=get(db,'announcements',link.announcement_id);if(announcementsManager(db,user)||(a.published_at&&['PUBLISHED','ARCHIVED'].includes(a.status)&&(!a.starts_at||a.starts_at<=now())))return true;}
  }
  return false;
}
export function upload(db,user,b,dataDir) {
  assert(announcementsManager(db,user)||['hr.documents.manage','hr.employee_files.manage','hr.training.manage','hr.training.participants','security.logbook.create','security.incidents.create','security.incidents.update'].some(p=>has(db,user,p)),'Akses unggah ditolak.',403);
  const name=basename(text(b.name,'Nama berkas',180)).replace(/[\r\n"]/g,'_');
  assert(typeof b.data==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(b.data),'Isi berkas tidak valid.');
  const data=Buffer.from(b.data,'base64'),max=(Number(process.env.MAX_UPLOAD_MB)||10)*1024*1024;
  assert(data.length>0&&data.length<=max,`Ukuran berkas harus 1 byte sampai ${max/1024/1024} MB.`);
  const extension=name.split('.').at(-1).toLowerCase();
  const types={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
  assert(types[extension]&&types[extension]===b.mime_type,'Jenis berkas yang diizinkan: PDF, PNG, JPEG, DOCX, XLSX.');
  const signature=extension==='pdf'?data.subarray(0,5).toString()==='%PDF-':extension==='png'?data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):['jpg','jpeg'].includes(extension)?data[0]===255&&data[1]===216&&data[2]===255:data[0]===80&&data[1]===75&&data[2]===3&&data[3]===4;
  assert(signature,'Isi berkas tidak cocok dengan tipe yang dipilih.');
  if(['docx','xlsx'].includes(extension))assert(data.includes(Buffer.from('[Content_Types].xml'))&&data.includes(Buffer.from(extension==='docx'?'word/':'xl/')),'Struktur berkas Office tidak valid.');
  const key=randomUUID();mkdirSync(resolve(dataDir,'files'),{recursive:true});writeFileSync(resolve(dataDir,'files',key),data,{flag:'wx',mode:0o600});
  const row=insert(db,'files',{storage_key:key,original_name:name,mime_type:types[extension],size_bytes:data.length,checksum:createHash('sha256').update(data).digest('hex'),status:'AVAILABLE',uploaded_by:user.id});
  audit(db,user,'UPLOAD','files',row.id,{size_bytes:data.length});return {id:row.id,original_name:name};
}
export function download(db,user,id,dataDir) {
  const file=get(db,'files',id);assert(file.status==='AVAILABLE'&&fileAllowed(db,user,id),'Akses berkas ditolak.',403);
  audit(db,user,'DOWNLOAD','files',id);return {file,data:readFileSync(resolve(dataDir,'files',file.storage_key))};
}
export function attach(db,user,type,id,b) {
  return tx(db,()=> {
    claimFile(db,user,b.file_id);const f=b.file_id;
    if(type==='employee') {
      assert(can(db,user,'hr.employee_files.manage',employeeContext(db,id)),'Akses ditolak.',403);
      return insert(db,'employee_files',{employee_id:id,file_id:f,category:text(b.category||'LAINNYA'),title:text(b.title||get(db,'files',f).original_name),created_by:user.id});
    }
    const config=type==='logbook'?['logbook_entries','security.logbook','logbook_files','logbook_entry_id']:type==='incident'?['incidents','security.incidents','incident_files','incident_id']:null;
    assert(config,'Jenis lampiran tidak valid.');const row=get(db,config[0],id);
    assert(row.latitude==null,'Foto laporan baru diambil melalui kamera saat pelaporan.');
    assert(can(db,user,`${config[1]}.update`,reportContext(db,row))||(row.created_by===user.id&&can(db,user,`${config[1]}.create`,reportContext(db,row))),'Akses lampiran ditolak.',403);
    const result=insert(db,config[2],{[config[3]]:id,file_id:f,caption:text(b.caption||get(db,'files',f).original_name),created_by:user.id});audit(db,user,'ATTACH',config[0],id);return result;
  });
}
