import {mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {AppError} from './db.mjs';

// Penyimpanan selfie untuk server lokal (SQLite): berkas di <DATA_DIR>/attendance/.
// Di produksi, Edge attendance-form memakai folder Google Drive SPH-Portal-Absensi.
const keyPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function localAttendancePhotos(dataDir){
 const dir=resolve(dataDir,'attendance');
 const path=key=>{if(typeof key!=='string'||!keyPattern.test(key))throw new AppError(404,'Selfie tidak tersedia.');return resolve(dir,key);};
 const remove=async key=>{rmSync(path(key),{force:true});};
 return {
  async put(bytes){mkdirSync(dir,{recursive:true});const key=randomUUID();writeFileSync(resolve(dir,key),bytes,{flag:'wx',mode:0o600});return {key};},
  discard:remove,remove,
  get(key){try{return readFileSync(path(key));}catch(error){if(error instanceof AppError)throw error;throw new AppError(404,'Selfie tidak tersedia.');}},
 };
}
