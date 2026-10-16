import {backup,DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {openDb,all,assert,now} from '../lib/db.mjs';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function createBackup(db,dataDir,target){
  mkdirSync(target,{recursive:false,mode:0o700});const destination=resolve(target,'portal.sqlite');await backup(db,destination);
  const snapshot=new DatabaseSync(destination,{readOnly:true});let files;
  try{assert(snapshot.prepare('PRAGMA integrity_check').get().integrity_check==='ok','Integritas snapshot database gagal.');files=all(snapshot,'SELECT storage_key,checksum FROM files');}finally{snapshot.close();}
  mkdirSync(resolve(target,'files'),{mode:0o700});
  for(const file of files){assert(/^[a-f0-9-]{36}$/.test(file.storage_key),'Storage key tidak valid.');const source=resolve(dataDir,'files',file.storage_key);assert(sha(readFileSync(source))===file.checksum,'Checksum berkas tidak sesuai.');copyFileSync(source,resolve(target,'files',file.storage_key));}
  const manifest={version:1,created_at:now(),database_sha256:sha(readFileSync(destination)),files};writeFileSync(resolve(target,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const directory=resolve(process.env.DATA_DIR||'data'),base=resolve(process.env.BACKUP_DIR||'backups');mkdirSync(base,{recursive:true,mode:0o700});const target=resolve(base,new Date().toISOString().replace(/[:.]/g,'-'));const db=openDb();
  try{const manifest=await createBackup(db,directory,target);console.log(`Backup tersimpan: ${target} (${manifest.files.length} berkas). Simpan salinan di lokasi cadangan yang dikelola organisasi.`);}finally{db.close();}
}
