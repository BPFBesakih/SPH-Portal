// Pratinjau lokal modul Pengelolaan Kunjungan dengan data fiktif — tanpa layanan cloud.
//
//   node scripts/preview-kunjungan.mjs            (lanjutkan data pratinjau sebelumnya)
//   node scripts/preview-kunjungan.mjs --reset    (mulai dari awal)
//   node scripts/preview-kunjungan.mjs --reset --contoh
//        (mulai dari awal dengan penilaian fiktif 5 minggu terakhir dan rekap harian sejak
//         Januari, untuk mencoba Laporan mingguan/bulanan dan grafik tren)
//
// Menjalankan portal lokal (SQLite) dan Google Drive/Sheets TIRUAN. Penilaian dari
// formulir pos masuk ke basis data portal, lalu "disalin" ke spreadsheet tiruan yang
// isinya ditulis sebagai CSV di data/pratinjau-kunjungan/google/ supaya bisa dibuka.
// Semua berkas pratinjau ada di data/ (diabaikan Git). Tidak ada yang dikirim ke Google.
import {resolve} from 'node:path';
import {rmSync,mkdirSync} from 'node:fs';
import {openDb,insert,one,all,run,now,today} from '../lib/db.mjs';
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
// Data contoh untuk Laporan & Ekspor, hanya pada data pratinjau yang belum berisi penilaian.
// Rincian 5 minggu terakhir masuk visit_evaluations (ikut disalin ke spreadsheet tiruan);
// sebelum itu hanya rekap harian, seolah rinciannya sudah dilipat retensi.
if(process.argv.includes('--contoh')){
  if(one(db,'SELECT 1 AS ada FROM visit_evaluations LIMIT 1')||one(db,'SELECT 1 AS ada FROM visit_daily_totals LIMIT 1'))console.log('--contoh dilewati: data pratinjau sudah berisi penilaian. Pakai --reset --contoh untuk mulai dari awal.');
  else{
    let seed=20261119;const pick=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
    const guides=all(db,'SELECT id,name FROM visit_guides WHERE is_active=1 ORDER BY seq'),petugas=all(db,'SELECT id,nama FROM visit_assessors WHERE is_active=1 ORDER BY nama');
    const day0=today(),shift=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10),stamp=now();
    let rows=0,totals=0;
    for(let back=34;back>=0;back--){
      const day=shift(day0,-back),weekend=[0,6].includes(new Date(day+'T00:00:00Z').getUTCDay());
      for(let k=0,count=(weekend?32:22)+pick(10);k<count;k++){
        const at=Date.parse(`${day}T07:00:00+08:00`)+pick(9*60)*60000;if(at>Date.now())continue;
        const g=guides[pick(guides.length)],pos=pick(2)?1:3,seragam=pick(100)<6?'tidak':pick(100)<9?'kurang':'lengkap',p=petugas[pos===1?pick(2):2]||null,iso=new Date(at).toISOString();
        run(db,`INSERT INTO visit_evaluations(id,pos,guide_id,guide_name,uniform,id_card,review,etika,catatan,evaluated_at,wita_date,received_at,status,versi,seragam,petugas_id,petugas_nama)
          VALUES(?,?,?,?,?,?,0,?,'',?,?,?,'aktif',2,?,?,?)`,crypto.randomUUID(),pos,g.id,g.name,seragam==='lengkap'?1:-1,pick(100)<(pos===3?22:6)?0:1,pick(100)<6?-1-pick(3):pick(100)<4?1+pick(2):0,iso,day,iso,seragam,p?.id||null,p?.nama||null);
        rows++;
      }
    }
    for(let day=['2026-01-01',shift(day0,-300)].sort().at(-1);day<=shift(day0,-35);day=shift(day,1))for(const g of guides){
      if(pick(100)<55)continue;const pos=pick(2)?1:3,antar=1+pick(2),nId=pick(100)<(pos===3?25:7)?1:0,nTidak=pick(100)<8?1:0,nKurang=!nTidak&&pick(100)<8?1:0;
      run(db,`INSERT INTO visit_daily_totals(day,guide_id,pos,sumber,antar,uniform,uniform_patuh,id_card,review,etika,updated_at,n_id,n_kurang,n_tidak,n_teguran) VALUES(?,?,?,'portal',?,?,?,?,0,?,?,?,?,?,0)`,
        day,g.id,pos,antar,antar-2*(nTidak+nKurang),antar-nTidak-nKurang,antar-nId,pick(100)<10?-1:0,stamp,nId,nKurang,nTidak);
      totals++;
    }
    console.log(`Data contoh: ${rows} penilaian 5 minggu terakhir dan ${totals} rekap harian sebelumnya (fiktif, hanya di data/).`);
  }
}
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
