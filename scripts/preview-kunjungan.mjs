// Pratinjau lokal modul Pengelolaan Kunjungan dengan data fiktif.
//
//   node scripts/preview-kunjungan.mjs <folder-repo-nilaiguide>
//
// Menjalankan dua hal sekaligus, tanpa layanan cloud mana pun:
//   - jembatan spreadsheet tiruan (kode Apps Script NilaiGuide asli + data fiktif)
//   - portal lokal (SQLite di memori) dengan akun pratinjau dan tautan Pos 1 & Pos 3
// Data spreadsheet tiruan disimpan di data/jembatan-uji/ (diabaikan Git).
import {resolve} from 'node:path';
import {openDb,insert,one,now} from '../lib/db.mjs';
import {seedPermissions,digest,hashPasswordSync} from '../lib/auth.mjs';
import {guidePosts} from '../lib/guide-form.mjs';
import {bridgeConfig} from '../lib/visits-bridge.mjs';
import {startBridgeSimulator} from './visits-bridge-dev.mjs';
import {createApp} from '../server.mjs';

if(process.env.NODE_ENV==='production')throw new Error('Pratinjau tidak boleh dijalankan dalam mode produksi.');
const nilaiguideDir=process.argv[2]||process.env.NILAIGUIDE_DIR;
const port=Number(process.env.PORT)||4615,origin=`http://127.0.0.1:${port}`;
const bridge=await startBridgeSimulator({nilaiguideDir,port:Number(process.env.BRIDGE_PORT)||4620,stateFile:resolve('data','jembatan-uji','spreadsheet.json')});
const db=openDb(':memory:');seedPermissions(db);
const password=hashPasswordSync('Preview2026!');
for(const [username,role] of [['kunjungan.preview','KUNJUNGAN_PENGELOLA'],['pimpinan.preview','KUNJUNGAN_PIMPINAN'],['admin.preview','SUPER_ADMIN'],['sdm.preview','SDM']]){
  const user=insert(db,'users',{username,password_hash:password,status:'ACTIVE',must_change_password:0,failed_login_count:0,password_changed_at:now()});
  insert(db,'user_roles',{user_id:user.id,role_id:one(db,'SELECT id FROM roles WHERE code=?',role).id,scope_kind:'ALL'});
}
// Token pratinjau tetap, supaya HP/peramban uji tidak perlu membuka tautan baru setiap restart.
const tokens={1:'1'.repeat(64),3:'3'.repeat(64)};
for(const pos of [1,3])insert(db,'guide_form_links',{pos,label:guidePosts[pos],token_hash:digest(tokens[pos]),share_token:tokens[pos],is_active:1,created_by:null});
const {server}=createApp({db,dataDir:resolve('data','jembatan-uji'),origin,visitsBridge:bridgeConfig({VISITS_BRIDGE_URL:bridge.url,VISITS_BRIDGE_KEY:bridge.key},{allowLocal:true})});
server.listen(port,'127.0.0.1',()=>console.log(`
Portal pratinjau : ${origin}/#visits
Akun (password Preview2026!): kunjungan.preview · pimpinan.preview · admin.preview · sdm.preview (tanpa akses Kunjungan)
Formulir Pos 1   : ${origin}/penilaian-guide/#${tokens[1]}
Formulir Pos 3   : ${origin}/penilaian-guide/#${tokens[3]}
Hentikan dengan Ctrl+C. Hapus data/jembatan-uji/ untuk memulai spreadsheet tiruan dari awal.`));
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{server.close();bridge.close().then(()=>process.exit(0));});
