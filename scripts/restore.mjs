import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdirSync,readFileSync,readdirSync,copyFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assert,run,now,audit} from '../lib/db.mjs';
import {sha} from './backup.mjs';
export function restoreBackup(source,target){
  const manifest=JSON.parse(readFileSync(resolve(source,'manifest.json'),'utf8'));assert(manifest.version===1&&Array.isArray(manifest.files),'Manifest backup tidak valid.');
  assert(!existsSync(target)||readdirSync(target).length===0,'Tujuan pemulihan harus direktori kosong. Hentikan aplikasi dan pindahkan data lama ke arsip terlebih dahulu.');
  assert(sha(readFileSync(resolve(source,'portal.sqlite')))===manifest.database_sha256,'Checksum database backup tidak sesuai.');
  for(const file of manifest.files){assert(/^[a-f0-9-]{36}$/.test(file.storage_key),'Storage key tidak valid.');assert(sha(readFileSync(resolve(source,'files',file.storage_key)))===file.checksum,'Checksum berkas backup tidak sesuai.');}
  const check=new DatabaseSync(resolve(source,'portal.sqlite'),{readOnly:true});try{assert(check.prepare('PRAGMA integrity_check').get().integrity_check==='ok','Integritas database gagal.');assert(check.prepare('PRAGMA foreign_key_check').all().length===0,'Foreign key backup tidak valid.');assert(check.prepare('SELECT count(*) n FROM files').get().n===manifest.files.length,'Daftar berkas backup tidak lengkap.');}finally{check.close();}
  mkdirSync(resolve(target,'files'),{recursive:true,mode:0o700});copyFileSync(resolve(source,'portal.sqlite'),resolve(target,'portal.sqlite'));for(const file of manifest.files)copyFileSync(resolve(source,'files',file.storage_key),resolve(target,'files',file.storage_key));
  const restored=new DatabaseSync(resolve(target,'portal.sqlite'));try{restored.exec('PRAGMA foreign_keys=ON');run(restored,'UPDATE auth_sessions SET revoked_at=?',now());run(restored,'UPDATE password_reset_tokens SET revoked_at=? WHERE consumed_at IS NULL',now());audit(restored,null,'RESTORE','system','backup',{backup_created_at:manifest.created_at});}finally{restored.close();}return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){assert(process.argv[2]&&process.argv[3],'Pemakaian: node scripts/restore.mjs <folder-backup> <folder-data-kosong>');const result=restoreBackup(resolve(process.argv[2]),resolve(process.argv[3]));console.log(`Database dan ${result.files.length} berkas berhasil dipulihkan. Jalankan aplikasi menggunakan DATA_DIR tujuan tersebut.`);}
