// Pratinjau lokal modul Pengelolaan Kunjungan dengan data fiktif — tanpa layanan cloud.
//
//   node scripts/preview-kunjungan.mjs            (lanjutkan data pratinjau sebelumnya)
//   node scripts/preview-kunjungan.mjs --reset    (mulai dari awal)
//
// Menjalankan portal lokal (SQLite) dan Google Drive/Sheets TIRUAN. Penilaian dari
// formulir pos masuk ke basis data portal, lalu "disalin" ke spreadsheet tiruan yang
// isinya ditulis sebagai CSV di data/pratinjau-kunjungan/google/ supaya bisa dibuka.
// Semua berkas pratinjau ada di data/ (diabaikan Git). Tidak ada yang dikirim ke Google.
import {resolve} from 'node:path';
import {rmSync,mkdirSync} from 'node:fs';
import {openDb,insert,one,now} from '../lib/db.mjs';
import {seedPermissions,digest,hashPasswordSync} from '../lib/auth.mjs';
import {guidePosts} from '../lib/guide-form.mjs';
import {createFakeGoogle} from './fake-google-sheets.mjs';
import {createApp} from '../server.mjs';

if(process.env.NODE_ENV==='production')throw new Error('Pratinjau tidak boleh dijalankan dalam mode produksi.');
const dir=resolve('data','pratinjau-kunjungan');
if(process.argv.includes('--reset'))rmSync(dir,{recursive:true,force:true});
mkdirSync(dir,{recursive:true});
const port=Number(process.env.PORT)||4615,origin=`http://127.0.0.1:${port}`;
const db=openDb(resolve(dir,'portal.sqlite'));seedPermissions(db);
const password=hashPasswordSync('Preview2026!');
for(const [username,role] of [['kunjungan.preview','KUNJUNGAN_PENGELOLA'],['pimpinan.preview','KUNJUNGAN_PIMPINAN'],['admin.preview','SUPER_ADMIN'],['sdm.preview','SDM']]){
  if(one(db,'SELECT id FROM users WHERE username=?',username))continue;
  const user=insert(db,'users',{username,password_hash:password,status:'ACTIVE',must_change_password:0,failed_login_count:0,password_changed_at:now()});
  insert(db,'user_roles',{user_id:user.id,role_id:one(db,'SELECT id FROM roles WHERE code=?',role).id,scope_kind:'ALL'});
}
// Token pratinjau tetap, supaya HP/peramban uji tidak perlu membuka tautan baru setiap restart.
for(const pos of [1,3])if(!one(db,'SELECT id FROM guide_form_links WHERE pos=? AND is_active=1',pos)){
  const token=String(pos).repeat(64);
  insert(db,'guide_form_links',{pos,label:guidePosts[pos],token_hash:digest(token),share_token:token,is_active:1,created_by:null});
}
// Guide fiktif hanya bila Data Guide masih kosong; daftar asli bisa dicoba lewat Impor berkas.
if(!one(db,'SELECT id FROM visit_guides LIMIT 1')){
  let seq=0;
  for(const regu of ['A1','A2','D1','D2'])for(let i=1;i<=10;i++){seq++;insert(db,'visit_guides',{id:`G-${String(seq).padStart(3,'0')}`,seq,name:`Guide Contoh ${regu}-${String(i).padStart(2,'0')}`,kategori:regu.startsWith('A')?'Asing':'Domestik',regu,is_active:i===10?0:1});}
}
// Petugas penilai fiktif (dipilih sekali per shift di formulir pos), bila daftarnya masih kosong.
if(!one(db,'SELECT id FROM visit_assessors LIMIT 1'))for(const [nama,keterangan] of [['Petugas Contoh Satu','Pos 1'],['Petugas Contoh Dua','Pos 1'],['Petugas Contoh Tiga','Pos 3']])
  insert(db,'visit_assessors',{nama,keterangan,is_active:1});
const google=createFakeGoogle({stateFile:resolve(dir,'google.json'),exportDir:resolve(dir,'google')});
const {server}=createApp({db,dataDir:dir,origin,sheetEnv:google.env,sheetFetch:google.fetch,sheetAuto:true});
const links=[1,3].map(pos=>one(db,'SELECT share_token FROM guide_form_links WHERE pos=? AND is_active=1',pos)?.share_token);
server.listen(port,'127.0.0.1',()=>console.log(`
Portal pratinjau : ${origin}/#visits
Akun (password Preview2026!): kunjungan.preview · pimpinan.preview · admin.preview · sdm.preview (tanpa akses Kunjungan)
Formulir Pos 1   : ${links[0]?`${origin}/penilaian-guide/#${links[0]}`:'(tautan dicabut — buat di Tautan Pos)'}
Formulir Pos 3   : ${links[1]?`${origin}/penilaian-guide/#${links[1]}`:'(tautan dicabut — buat di Tautan Pos)'}
Spreadsheet tiruan (CSV per tab): ${resolve(dir,'google')}
Hentikan dengan Ctrl+C. Jalankan dengan --reset untuk memulai dari awal.`));
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{server.close();db.close();process.exit(0);});
