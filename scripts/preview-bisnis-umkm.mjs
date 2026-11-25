// Pratinjau lokal modul Bisnis dengan barang titipan UMKM — data fiktif, tanpa layanan cloud.
//
//   node scripts/preview-bisnis-umkm.mjs            (lanjutkan data pratinjau sebelumnya)
//   node scripts/preview-bisnis-umkm.mjs --reset    (mulai dari awal)
//
// Menjalankan portal lokal (SQLite) di data/pratinjau-bisnis/ (diabaikan Git). Tidak ada yang
// dikirim ke Supabase atau Google Drive. Semua nama barang, mitra, dan transaksi fiktif.
import {resolve} from 'node:path';
import {rmSync,mkdirSync} from 'node:fs';
import {openDb,one,insert,now} from '../lib/db.mjs';
import {seedPermissions,hashPasswordSync} from '../lib/auth.mjs';
import {merchandiseRoutes} from '../lib/merchandise.mjs';
import {createApp} from '../server.mjs';

if(process.env.NODE_ENV==='production')throw new Error('Pratinjau tidak boleh dijalankan dalam mode produksi.');
const dir=resolve('data','pratinjau-bisnis');
if(process.argv.includes('--reset'))rmSync(dir,{recursive:true,force:true});
mkdirSync(dir,{recursive:true});
const port=Number(process.env.PORT)||4627,origin=process.env.PREVIEW_ORIGIN||`http://127.0.0.1:${port}`;
const db=openDb(resolve(dir,'portal.sqlite'));seedPermissions(db);

if(!one(db,"SELECT id FROM users WHERE username='manager.bisnis'")){
  const hash=hashPasswordSync('Preview2026!'),users={};
  for(const [username,role] of [['manager.bisnis','BISNIS_MANAGER'],['koordinator.bisnis','BISNIS_KOORDINATOR'],['petugas.bisnis','BISNIS_PETUGAS'],['pimpinan.bisnis','BISNIS_PIMPINAN']]){
    users[username]=insert(db,'users',{username,password_hash:hash,status:'ACTIVE',must_change_password:0,failed_login_count:0,password_changed_at:now()});
    insert(db,'user_roles',{user_id:users[username].id,role_id:one(db,'SELECT id FROM roles WHERE code=?',role).id,scope_kind:'ALL'});
  }
  const call=(username,path,method='GET',body={})=>merchandiseRoutes({db,user:users[username],p:['merchandise',...path.split('/')],method,body,url:new URL('http://local/')});
  const product=(sku,name,buy,sell,display,warehouse)=>insert(db,'merchandise_products',{sku,name,buy_price:buy,sell_price:sell,stock_qty:display,warehouse_qty:warehouse,is_active:1});
  const kaos=product('MER-001','Kaos Besakih (contoh)',60000,90000,12,20);
  product('MER-002','Topi Besakih (contoh)',30000,50000,4,10);
  product('MER-003','Gantungan Kunci (contoh)',8000,15000,25,0);
  const kopi=call('koordinator.bisnis','umkm/partners','POST',{code:'KOPI',name:'Kopi Kintamani Contoh',owner_name:'Ni Made Contoh',phone:'081200000001',address:'Kintamani (fiktif)'});
  const dupa=call('koordinator.bisnis','umkm/partners','POST',{code:'DUPA',name:'Dupa Wangi Contoh',owner_name:'I Ketut Contoh',phone:'081200000002'});
  call('koordinator.bisnis','umkm/receipts','POST',{partner_id:kopi.id,counterpart_name:'Ni Made Contoh',items:[
    {name:'Kopi Bubuk 250 g',umkm_price:12500,quantity:12,location:'DISPLAY'},{name:'Kopi Biji 500 g',umkm_price:13000,quantity:6,location:'GUDANG'}]});
  call('koordinator.bisnis','umkm/receipts','POST',{partner_id:dupa.id,counterpart_name:'I Ketut Contoh',items:[{name:'Dupa Cendana',umkm_price:2700,quantity:30}]});
  const sku=code=>one(db,'SELECT * FROM merchandise_products WHERE sku=?',code);
  call('petugas.bisnis',`products/${sku('UMKM-KOPI-02').id}/stock`,'POST',{kind:'TRANSFER',location:'DISPLAY',quantity:3,reason:'Isi display',row_version:sku('UMKM-KOPI-02').row_version});
  call('petugas.bisnis','sales','POST',{payment_method:'QRIS',items:[{product_id:kaos.id,quantity:1},{product_id:sku('UMKM-KOPI-01').id,quantity:2}]});
  call('petugas.bisnis','sales','POST',{payment_method:'TUNAI',items:[{product_id:sku('UMKM-DUPA-01').id,quantity:5},{product_id:sku('UMKM-KOPI-02').id,quantity:1}]});
  call('koordinator.bisnis',`products/${sku('UMKM-KOPI-01').id}/stock`,'POST',{kind:'ADJUST',location:'DISPLAY',quantity:9,loss_borne_by:'BP',reason:'Kemasan sobek di display (contoh)',row_version:sku('UMKM-KOPI-01').row_version});
  call('koordinator.bisnis','umkm/takeouts','POST',{partner_id:dupa.id,counterpart_name:'I Ketut Contoh',reason:'TIDAK_LAKU',items:[{product_id:sku('UMKM-DUPA-01').id,quantity:5}]});
}
const {server}=createApp({db,dataDir:dir,origin});
server.listen(port,'127.0.0.1',()=>console.log(`
Portal pratinjau : ${origin}/#merchandise-umkm
Akun (password Preview2026!):
  manager.bisnis     — Pengelola Bisnis: semua fungsi, ubah harga UMKM, batalkan dokumen dan transaksi
  koordinator.bisnis — Koordinator: mitra UMKM, terima barang, takeout, koreksi stok
  petugas.bisnis     — Petugas: menjual dan memindah display ↔ gudang
  pimpinan.bisnis    — Pimpinan: melihat dan mengekspor laporan
Data fiktif di ${dir}. Hentikan dengan Ctrl+C.
`));
