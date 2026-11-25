// Barang titipan UMKM di modul Bisnis (keputusan tim Bisnis & Keuangan 25 November 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {openDb,insert,one,all,now,today} from '../lib/db.mjs';
import {seedPermissions} from '../lib/auth.mjs';
import {merchandiseRoutes} from '../lib/merchandise.mjs';
import {umkmPricing} from '../public/merchandise.js';

function fixture(t){
  const db=openDb(':memory:');t.after(()=>db.close());seedPermissions(db);
  const users={};
  for(const [key,role] of [['manager','BISNIS_MANAGER'],['leader','BISNIS_PIMPINAN'],['coordinator','BISNIS_KOORDINATOR'],['cashier','BISNIS_PETUGAS'],['outsider','EMPLOYEE']]){
    users[key]=insert(db,'users',{username:key,password_hash:'test',status:'ACTIVE',must_change_password:0,failed_login_count:0,password_changed_at:now()});
    insert(db,'user_roles',{user_id:users[key].id,role_id:one(db,'SELECT id FROM roles WHERE code=?',role).id,scope_kind:'ALL'});
  }
  const merch=insert(db,'merchandise_products',{sku:'MER-001',name:'Kaos Besakih',buy_price:60000,sell_price:90000,stock_qty:20,warehouse_qty:0,is_active:1});
  const call=(key,path,method='GET',body={},query='')=>merchandiseRoutes({db,user:users[key],p:['merchandise',...path.split('/')],method,body,url:new URL('http://local/?'+query)});
  const partner=(code='KOPI',name='Kopi Kintamani Bu Sari')=>call('coordinator','umkm/partners','POST',{code,name,owner_name:'Ni Made Sari',phone:'0812 3456 7890'});
  const receive=(partnerId,items,key='coordinator')=>call(key,'umkm/receipts','POST',{partner_id:partnerId,counterpart_name:'Ni Made Sari',items});
  const product=sku=>one(db,'SELECT * FROM merchandise_products WHERE sku=?',sku);
  return {db,users,merch,call,partner,receive,product};
}
const previousMonth=()=>{const [y,m]=today().split('-').map(Number);return (m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,'0')}`)+'-15';};

test('harga jual barang UMKM: +20% lalu dibulatkan ke atas ke Rp500 (di bawah Rp5.000 ke Rp100)',()=>{
  const cases=[[12500,15000,2500,0],[13000,16000,2600,400],[7250,9000,1450,300],[2700,3300,540,60],[50000,60000,10000,0],[15000,18000,3000,0],[4100,5000,820,80],[100,200,20,80]];
  for(const [cost,sell,markup,rounding] of cases)
    assert.deepEqual(umkmPricing(cost),{cost,markup,base:cost+markup,rounding,sell,profit:sell-cost},String(cost));
  for(let cost=100;cost<=200000;cost+=137){
    const p=umkmPricing(cost);
    assert(p.sell>=p.base&&p.rounding<(p.base<5000?100:500)&&p.sell%(p.base<5000?100:500)===0,String(cost));
  }
});

test('izin: menerima barang dan takeout hanya koordinator ke atas; pimpinan hanya melihat',t=>{
  const f=fixture(t);
  const perm=code=>all(f.db,'SELECT p.code FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE r.code=? AND p.code LIKE ?',code,'merchandise.umkm.%').map(p=>p.code).sort();
  assert.deepEqual(perm('BISNIS_MANAGER'),['merchandise.umkm.read','merchandise.umkm.receive']);
  assert.deepEqual(perm('BISNIS_KOORDINATOR'),['merchandise.umkm.read','merchandise.umkm.receive']);
  assert.deepEqual(perm('BISNIS_PIMPINAN'),['merchandise.umkm.read']);
  assert.deepEqual(perm('BISNIS_PETUGAS'),[]);
  assert.deepEqual(perm('SUPER_ADMIN'),[]);
  const kopi=f.partner();
  assert.throws(()=>f.call('cashier','umkm/partners'),/akses/);
  assert.throws(()=>f.receive(kopi.id,[{name:'Kopi',umkm_price:20000,quantity:1}],'cashier'),/akses/);
  assert.throws(()=>f.receive(kopi.id,[{name:'Kopi',umkm_price:20000,quantity:1}],'leader'),/akses/);
  assert.throws(()=>f.call('outsider','umkm/docs'),/akses/);
  assert.equal(f.call('leader','umkm/partners').items.length,1);
  const caps=f.call('coordinator','overview').capabilities;
  assert.deepEqual([caps.umkm_read,caps.umkm_receive],[true,true]);
  assert.deepEqual([f.call('cashier','overview').capabilities.umkm_read,f.call('leader','overview').capabilities.umkm_receive],[false,false]);
});

test('mitra: kode unik 2–8 huruf/angka, nomor WhatsApp divalidasi, dapat diubah dan dinonaktifkan',t=>{
  const f=fixture(t);
  const kopi=f.partner('kopi');
  assert.equal(kopi.code,'KOPI');
  assert.throws(()=>f.partner('KOPI','Lain'),/sudah dipakai/);
  assert.throws(()=>f.partner('K','Lain'),/2–8 huruf/);
  assert.throws(()=>f.partner('KO PI','Lain'),/2–8 huruf/);
  assert.throws(()=>f.call('coordinator','umkm/partners','POST',{code:'DUPA',name:'Dupa',phone:'telepon'}),/WhatsApp/);
  const saved=f.call('coordinator',`umkm/partners/${kopi.id}`,'PATCH',{name:'Kopi Bu Sari',phone:'+62812345678',row_version:kopi.row_version,is_active:false});
  assert.deepEqual([saved.name,saved.phone,saved.is_active,saved.code],['Kopi Bu Sari','+62812345678',0,'KOPI']);
  assert.throws(()=>f.receive(kopi.id,[{name:'Kopi',umkm_price:20000,quantity:1}]),/nonaktif/);
});

test('terima barang UMKM: barang baru dengan SKU otomatis, harga +20% dibulatkan, stok dan tanda terima',t=>{
  const f=fixture(t);
  const kopi=f.partner(),dupa=f.partner('DUPA','Dupa Wangi');
  const doc=f.receive(kopi.id,[
    {name:'Kopi Bubuk 250 g',umkm_price:12500,quantity:10,location:'DISPLAY'},
    {name:'Kopi Biji 500 g',umkm_price:13000,quantity:4,location:'GUDANG'},
    {name:'Gula Aren',umkm_price:2700,quantity:6}
  ]);
  assert.match(doc.doc_no,/^TU-\d{8}-[0-9A-F]{8}$/);
  const [a,b,c]=['UMKM-KOPI-01','UMKM-KOPI-02','UMKM-KOPI-03'].map(f.product);
  assert.deepEqual([a.name,a.buy_price,a.sell_price,a.stock_qty,a.warehouse_qty,a.umkm_partner_id],['Kopi Bubuk 250 g',12500,15000,10,0,kopi.id]);
  assert.deepEqual([b.sell_price,b.stock_qty,b.warehouse_qty],[16000,0,4]);
  assert.deepEqual([c.sell_price,c.stock_qty],[3300,6],'tanpa lokasi = display');
  const moves=all(f.db,"SELECT kind,location,quantity_delta,unit_cost,umkm_doc_id FROM merchandise_stock_movements WHERE product_id IN (?,?,?) ORDER BY unit_cost",a.id,b.id,c.id);
  assert.deepEqual(moves.map(m=>[m.kind,m.location,m.quantity_delta,m.unit_cost,m.umkm_doc_id]),[['IN','DISPLAY',6,2700,doc.id],['IN','DISPLAY',10,12500,doc.id],['IN','GUDANG',4,13000,doc.id]]);
  // Barang yang sudah terdaftar menambah stok; dua lokasi untuk satu barang dalam satu dokumen.
  const second=f.receive(kopi.id,[{product_id:a.id,quantity:2,location:'DISPLAY'},{product_id:a.id,quantity:5,location:'GUDANG'},{name:'Kopi Sachet',umkm_price:4100,quantity:1}]);
  assert.deepEqual([f.product('UMKM-KOPI-01').stock_qty,f.product('UMKM-KOPI-01').warehouse_qty],[12,5]);
  assert.equal(f.product('UMKM-KOPI-04').sell_price,5000);
  const detail=f.call('coordinator',`umkm/docs/${second.id}`);
  assert.deepEqual(detail.items.map(i=>[i.sku,i.location,i.quantity,i.unit_cost,i.sell_price]),[['UMKM-KOPI-01','DISPLAY',2,12500,15000],['UMKM-KOPI-01','GUDANG',5,12500,15000],['UMKM-KOPI-04','DISPLAY',1,4100,5000]]);
  assert.deepEqual([detail.kind,detail.partner.code,detail.partner_name,detail.counterpart_name,detail.actor_name],['TERIMA','KOPI','Kopi Kintamani Bu Sari','Ni Made Sari','coordinator']);
  assert.equal(f.call('leader','umkm/docs').items.length,2);
  const partners=f.call('coordinator','umkm/partners').items;
  assert.deepEqual(partners.map(p=>[p.code,p.product_count,p.stock_total]),[['DUPA',0,0],['KOPI',4,28]]);
  // Penolakan: nama ganda, barang mitra lain, lokasi ganda, harga UMKM tidak wajar.
  assert.throws(()=>f.receive(kopi.id,[{name:'kopi bubuk 250 G',umkm_price:1000,quantity:1}]),/sudah terdaftar/);
  assert.throws(()=>f.receive(kopi.id,[{name:'Baru',umkm_price:1000,quantity:1},{name:'baru',umkm_price:1000,quantity:1}]),/sudah terdaftar/);
  assert.throws(()=>f.receive(dupa.id,[{product_id:a.id,quantity:1}]),/bukan barang titipan Dupa Wangi/);
  assert.throws(()=>f.receive(kopi.id,[{product_id:a.id,quantity:1},{product_id:a.id,quantity:2}]),/tercatat dua kali/);
  assert.throws(()=>f.receive(kopi.id,[{name:'Murah',umkm_price:50,quantity:1}]),/Harga UMKM/);
  assert.throws(()=>f.receive(kopi.id,[{name:'Kosong',umkm_price:1000,quantity:0}]),/Jumlah barang/);
  assert.throws(()=>f.call('coordinator','umkm/receipts','POST',{partner_id:kopi.id,items:[{name:'X',umkm_price:1000,quantity:1}]}),/perwakilan/);
  assert.equal(all(f.db,"SELECT id FROM merchandise_umkm_docs").length,2,'dokumen yang ditolak tidak tersimpan');
  // Barang baru langsung terhitung: tidak memicu peringatan stok/gudang belum dihitung.
  const overview=f.call('coordinator','overview');
  assert.deepEqual([overview.products_uninitialized,overview.products_warehouse_uncounted],[0,0]);
});

test('stok barang UMKM hanya lewat terima/takeout; pindah tetap bisa; koreksi wajib tanggungan',t=>{
  const f=fixture(t);
  const kopi=f.partner();f.receive(kopi.id,[{name:'Kopi Bubuk',umkm_price:12500,quantity:5,location:'GUDANG'}]);
  const item=f.product('UMKM-KOPI-01');
  const record=(key,body)=>f.call(key,`products/${item.id}/stock`,'POST',{reason:'Uji',...body,row_version:f.product('UMKM-KOPI-01').row_version});
  for(const kind of ['INITIAL','IN'])for(const key of ['cashier','manager'])assert.throws(()=>record(key,{kind,location:'DISPLAY',quantity:1}),/Terima barang/);
  record('cashier',{kind:'TRANSFER',location:'DISPLAY',quantity:3});
  assert.deepEqual([f.product('UMKM-KOPI-01').stock_qty,f.product('UMKM-KOPI-01').warehouse_qty],[3,2]);
  assert.throws(()=>record('cashier',{kind:'ADJUST',location:'DISPLAY',quantity:2}),/akses/);
  assert.throws(()=>record('coordinator',{kind:'ADJUST',location:'DISPLAY',quantity:2}),/ditanggung BP/);
  assert.throws(()=>record('coordinator',{kind:'ADJUST',location:'DISPLAY',quantity:2,loss_borne_by:'KANTOR'}),/Tanggungan/);
  record('coordinator',{kind:'ADJUST',location:'DISPLAY',quantity:1,loss_borne_by:'BP',reason:'Pecah saat dipajang'});
  record('coordinator',{kind:'ADJUST',location:'GUDANG',quantity:1,loss_borne_by:'UMKM',reason:'Kemasan rusak dari produsen'});
  record('coordinator',{kind:'ADJUST',location:'GUDANG',quantity:1,reason:'Hitung ulang, sama'});
  const rows=all(f.db,"SELECT location,quantity_delta,unit_cost,umkm_loss_borne_by FROM merchandise_stock_movements WHERE product_id=? AND kind='ADJUST' ORDER BY created_at,rowid",item.id);
  assert.deepEqual(rows.map(r=>[r.location,r.quantity_delta,r.unit_cost,r.umkm_loss_borne_by]),[['DISPLAY',-2,12500,'BP'],['GUDANG',-1,12500,'UMKM'],['GUDANG',0,12500,null]]);
  // Barang BP tidak terpengaruh: stok awal dan barang masuk tetap seperti biasa, tanpa tanggungan.
  f.call('cashier',`products/${f.merch.id}/stock`,'POST',{kind:'IN',location:'DISPLAY',quantity:2,reason:'Penerimaan',row_version:f.merch.row_version});
  f.call('coordinator',`products/${f.merch.id}/stock`,'POST',{kind:'ADJUST',location:'DISPLAY',quantity:21,reason:'Opname',row_version:f.merch.row_version+1});
  assert.equal(one(f.db,"SELECT umkm_loss_borne_by FROM merchandise_stock_movements WHERE product_id=? AND kind='ADJUST'",f.merch.id).umkm_loss_borne_by,null);
});

test('penjualan campuran menyimpan snapshot UMKM; petugas tidak melihat harga UMKM',t=>{
  const f=fixture(t);
  const kopi=f.partner();f.receive(kopi.id,[{name:'Kopi Bubuk',umkm_price:13000,quantity:5}]);
  const item=f.product('UMKM-KOPI-01');
  const sale=f.call('cashier','sales','POST',{payment_method:'QRIS',items:[{product_id:item.id,quantity:2},{product_id:f.merch.id,quantity:1}]});
  assert.equal(sale.total,2*16000+90000);
  const lines=all(f.db,'SELECT sku,unit_price,unit_cost,umkm_partner_id,umkm_partner_name,umkm_markup_pct FROM merchandise_sale_items WHERE sale_id=? ORDER BY sku',sale.id);
  assert.deepEqual(lines.map(l=>[l.sku,l.unit_price,l.unit_cost,l.umkm_partner_id,l.umkm_partner_name,l.umkm_markup_pct]),[
    ['MER-001',90000,60000,null,null,null],['UMKM-KOPI-01',16000,13000,kopi.id,'Kopi Kintamani Bu Sari',20]]);
  assert.equal(f.product('UMKM-KOPI-01').stock_qty,3);
  const seen=f.call('cashier','products').items.find(p=>p.sku==='UMKM-KOPI-01');
  assert.deepEqual([seen.umkm_partner_name,seen.umkm_partner_code,seen.sell_price,'buy_price' in seen],['Kopi Kintamani Bu Sari','KOPI',16000,false]);
  assert(f.call('cashier','sales').items[0].items.every(i=>!('unit_cost' in i)));
  const history=f.call('cashier','stock').items;
  assert(history.some(m=>m.umkm_partner_name==='Kopi Kintamani Bu Sari')&&history.every(m=>!('unit_cost' in m)),'harga UMKM tidak bocor lewat riwayat stok');
  assert(f.call('manager','stock').items.some(m=>m.unit_cost===13000));
  // Penjualan tetap mengikuti aturan display.
  assert.throws(()=>f.call('cashier','sales','POST',{payment_method:'TUNAI',items:[{product_id:item.id,quantity:4}]}),/tidak mencukupi/);
});

test('takeout: dicatat lebih dulu, tidak melebihi stok, alasan lainnya wajib keterangan',t=>{
  const f=fixture(t);
  const kopi=f.partner(),dupa=f.partner('DUPA','Dupa Wangi');
  f.receive(kopi.id,[{name:'Kopi Bubuk',umkm_price:12500,quantity:8},{name:'Kopi Biji',umkm_price:30000,quantity:2,location:'GUDANG'}]);
  const [bubuk,biji]=['UMKM-KOPI-01','UMKM-KOPI-02'].map(f.product);
  const takeout=(items,extra={},key='coordinator')=>f.call(key,'umkm/takeouts','POST',{partner_id:kopi.id,counterpart_name:'Ni Made Sari',reason:'DIAMBIL_UMKM',items,...extra});
  const doc=takeout([{product_id:bubuk.id,quantity:5,location:'DISPLAY'},{product_id:biji.id,quantity:2,location:'GUDANG'}]);
  assert.match(doc.doc_no,/^TO-\d{8}-[0-9A-F]{8}$/);
  assert.deepEqual([f.product('UMKM-KOPI-01').stock_qty,f.product('UMKM-KOPI-02').warehouse_qty],[3,0]);
  assert.deepEqual(all(f.db,"SELECT quantity_delta,umkm_doc_id,unit_cost FROM merchandise_stock_movements WHERE kind='TAKEOUT' ORDER BY unit_cost").map(m=>[m.quantity_delta,m.umkm_doc_id,m.unit_cost]),[[-5,doc.id,12500],[-2,doc.id,30000]]);
  assert.deepEqual(f.call('coordinator',`umkm/docs/${doc.id}`).items.map(i=>[i.sku,i.quantity]),[['UMKM-KOPI-01',5],['UMKM-KOPI-02',2]]);
  assert.throws(()=>takeout([{product_id:bubuk.id,quantity:4}]),/Stok display Kopi Bubuk hanya 3/);
  assert.throws(()=>takeout([{product_id:bubuk.id,quantity:1}],{reason:'LAINNYA'}),/Keterangan alasan/);
  takeout([{product_id:bubuk.id,quantity:1}],{reason:'LAINNYA',note:'Diganti kemasan baru'});
  assert.throws(()=>takeout([{product_id:bubuk.id,quantity:1}],{reason:'HILANG'}),/Alasan takeout/);
  assert.throws(()=>f.call('coordinator','umkm/takeouts','POST',{partner_id:dupa.id,counterpart_name:'X',reason:'RUSAK',items:[{product_id:bubuk.id,quantity:1}]}),/bukan barang titipan/);
  assert.throws(()=>takeout([{name:'Barang baru',umkm_price:1000,quantity:1}]),/sudah terdaftar/);
  assert.throws(()=>takeout([{product_id:f.merch.id,quantity:1}]),/bukan barang titipan/);
  assert.throws(()=>takeout([{product_id:bubuk.id,quantity:1}],{},'cashier'),/akses/);
  // Mitra nonaktif tetap bisa mengambil barangnya.
  f.call('coordinator',`umkm/partners/${kopi.id}`,'PATCH',{name:kopi.name,row_version:kopi.row_version,is_active:false});
  takeout([{product_id:bubuk.id,quantity:2}],{reason:'BERHENTI'});
  assert.equal(f.product('UMKM-KOPI-01').stock_qty,0);
});

test('pembatalan dokumen: hanya manager, bulan yang sama, dan tanda terima yang stoknya belum terpakai',t=>{
  const f=fixture(t);
  const kopi=f.partner();
  const first=f.receive(kopi.id,[{name:'Kopi Bubuk',umkm_price:12500,quantity:4}]);
  const item=f.product('UMKM-KOPI-01');
  f.call('cashier','sales','POST',{payment_method:'TUNAI',items:[{product_id:item.id,quantity:2}]});
  const docOf=id=>one(f.db,'SELECT * FROM merchandise_umkm_docs WHERE id=?',id);
  const voidDoc=(id,key='manager')=>f.call(key,`umkm/docs/${id}/void`,'POST',{reason:'Salah catat',row_version:docOf(id).row_version});
  assert.throws(()=>voidDoc(first.id,'coordinator'),/akses/);
  assert.throws(()=>voidDoc(first.id),/sudah terjual atau di-takeout/);
  const second=f.receive(kopi.id,[{product_id:item.id,quantity:3}]);
  voidDoc(second.id);
  assert.equal(f.product('UMKM-KOPI-01').stock_qty,2);
  assert.deepEqual([docOf(second.id).status,docOf(second.id).void_reason],['VOID','Salah catat']);
  assert.throws(()=>voidDoc(second.id),/sudah dibatalkan/);
  const out=f.call('coordinator','umkm/takeouts','POST',{partner_id:kopi.id,counterpart_name:'Ni Made',reason:'RUSAK',items:[{product_id:item.id,quantity:2}]});
  assert.equal(f.product('UMKM-KOPI-01').stock_qty,0);
  voidDoc(out.id);
  assert.equal(f.product('UMKM-KOPI-01').stock_qty,2,'pembatalan takeout mengembalikan stok');
  const reversals=all(f.db,"SELECT kind,quantity_delta FROM merchandise_stock_movements WHERE umkm_doc_id IN (?,?) AND reason LIKE 'Pembatalan%' ORDER BY kind",second.id,out.id);
  assert.deepEqual(reversals.map(m=>[m.kind,m.quantity_delta]),[['IN',-3],['TAKEOUT',2]]);
  const third=f.receive(kopi.id,[{product_id:item.id,quantity:1}]);
  f.db.prepare('UPDATE merchandise_umkm_docs SET doc_date=? WHERE id=?').run(previousMonth(),third.id);
  assert.throws(()=>voidDoc(third.id),/bulan sebelumnya/);
});

test('pembatalan transaksi berisi barang UMKM hanya di bulan yang sama; transaksi barang BP tetap seperti biasa',t=>{
  const f=fixture(t);
  const kopi=f.partner();f.receive(kopi.id,[{name:'Kopi Bubuk',umkm_price:12500,quantity:5}]);
  const item=f.product('UMKM-KOPI-01');
  const sell=items=>f.call('cashier','sales','POST',{payment_method:'TUNAI',items});
  const old=sell([{product_id:item.id,quantity:1}]),oldBp=sell([{product_id:f.merch.id,quantity:1}]),current=sell([{product_id:item.id,quantity:1}]);
  for(const sale of [old,oldBp])f.db.prepare('UPDATE merchandise_sales SET sold_on=? WHERE id=?').run(previousMonth(),sale.id);
  assert.throws(()=>f.call('manager',`sales/${old.id}/void`,'POST',{reason:'Salah',row_version:1}),/dasar pembayaran Keuangan/);
  f.call('manager',`sales/${oldBp.id}/void`,'POST',{reason:'Salah',row_version:1});
  f.call('manager',`sales/${current.id}/void`,'POST',{reason:'Salah',row_version:1});
  assert.equal(f.product('UMKM-KOPI-01').stock_qty,4);
});

test('ubah harga UMKM hanya manager; harga jual dihitung ulang dan tidak bisa diketik manual',t=>{
  const f=fixture(t);
  const kopi=f.partner();f.receive(kopi.id,[{name:'Kopi Bubuk',umkm_price:12500,quantity:5}]);
  const item=()=>f.product('UMKM-KOPI-01');
  const sold=f.call('cashier','sales','POST',{payment_method:'TUNAI',items:[{product_id:item().id,quantity:1}]});
  assert.throws(()=>f.call('coordinator',`products/${item().id}`,'PATCH',{buy_price:15000,row_version:item().row_version}),/akses/);
  assert.throws(()=>f.call('manager',`products/${item().id}`,'PATCH',{sell_price:20000,row_version:item().row_version}),/dihitung otomatis/);
  assert.throws(()=>f.call('manager',`products/${item().id}`,'PATCH',{buy_price:15000,sell_price:18000,row_version:item().row_version}),/dihitung otomatis/);
  const saved=f.call('manager',`products/${item().id}`,'PATCH',{name:'Kopi Bubuk 250 g',buy_price:15000,row_version:item().row_version});
  assert.deepEqual([saved.name,saved.buy_price,saved.sell_price],['Kopi Bubuk 250 g',15000,18000]);
  const next=f.call('cashier','sales','POST',{payment_method:'TUNAI',items:[{product_id:item().id,quantity:1}]});
  assert.deepEqual([sold.total,next.total],[15000,18000]);
  assert.equal(one(f.db,'SELECT unit_cost FROM merchandise_sale_items WHERE sale_id=?',sold.id).unit_cost,12500,'transaksi lama tetap');
  assert.throws(()=>f.call('manager','products','POST',{sku:'umkm-kopi-09',name:'Bukan UMKM',buy_price:1,sell_price:2}),/Awalan UMKM-/);
  // Barang BP tetap bebas menetapkan harga jual.
  const merch=f.call('manager',`products/${f.merch.id}`,'PATCH',{sell_price:95000,row_version:f.merch.row_version});
  assert.equal(merch.sell_price,95000);
});

test('laporan: tanggungan BP pada periode WITA, tanpa harga UMKM bagi yang tidak berhak',t=>{
  const f=fixture(t);
  const kopi=f.partner();f.receive(kopi.id,[{name:'Kopi Bubuk',umkm_price:12500,quantity:6}]);
  const item=()=>f.product('UMKM-KOPI-01');
  const adjust=(quantity,borne)=>f.call('coordinator',`products/${item().id}/stock`,'POST',{kind:'ADJUST',location:'DISPLAY',quantity,loss_borne_by:borne,reason:'Opname',row_version:item().row_version});
  adjust(4,'BP');adjust(3,'UMKM');adjust(4,'BP');
  const moves=all(f.db,"SELECT id FROM merchandise_stock_movements WHERE kind='ADJUST' ORDER BY created_at,rowid").map(r=>r.id);
  // 30 Nov 16.30 UTC = 1 Des 00.30 WITA: masuk Desember, bukan November.
  f.db.prepare("UPDATE merchandise_stock_movements SET created_at='2026-11-30T15:30:00.000Z' WHERE id=?").run(moves[0]);
  f.db.prepare("UPDATE merchandise_stock_movements SET created_at='2026-11-30T16:30:00.000Z' WHERE id IN (?,?)").run(moves[1],moves[2]);
  const nov=f.call('manager','reports','GET',{},'from=2026-11-01&to=2026-11-30').umkm_losses;
  const dec=f.call('manager','reports','GET',{},'from=2026-12-01&to=2026-12-31').umkm_losses;
  assert.deepEqual(nov.map(m=>[m.quantity_delta,m.unit_cost,m.umkm_partner_name]),[[-2,12500,'Kopi Kintamani Bu Sari']]);
  assert.deepEqual(dec.map(m=>m.quantity_delta),[1],'hanya tanggungan BP; koreksi tanggungan UMKM tidak masuk');
  const report=f.call('leader','reports','GET',{},'from=2026-11-01&to=2026-11-30');
  assert(report.stock.some(p=>p.umkm_partner_name==='Kopi Kintamani Bu Sari'));
});

test('basis data lokal sebelum barang UMKM ditingkatkan: kolom baru, TAKEOUT diterima, data lama utuh',t=>{
  const dir=mkdtempSync(resolve(tmpdir(),'sph-umkm-')),path=resolve(dir,'portal.sqlite');let db;
  t.after(()=>{db?.close();rmSync(dir,{recursive:true,force:true});});
  const schema=readFileSync(new URL('../schema.sql',import.meta.url),'utf8');
  const strip=(text,part)=>{assert(text.includes(part),'potongan skema tidak ditemukan: '+part.slice(0,50));return text.replace(part,'');};
  let oldSchema=strip(schema,', umkm_partner_id TEXT REFERENCES merchandise_umkm_partners(id));');
  oldSchema=oldSchema.replace('warehouse_qty INTEGER CHECK(warehouse_qty IS NULL OR warehouse_qty>=0)\n','warehouse_qty INTEGER CHECK(warehouse_qty IS NULL OR warehouse_qty>=0));\n');
  oldSchema=strip(oldSchema,"\n umkm_partner_id TEXT REFERENCES merchandise_umkm_partners(id), umkm_partner_name TEXT, umkm_markup_pct INTEGER CHECK(umkm_markup_pct IS NULL OR umkm_markup_pct BETWEEN 0 AND 100),");
  oldSchema=strip(oldSchema,",\n umkm_doc_id TEXT REFERENCES merchandise_umkm_docs(id), unit_cost INTEGER CHECK(unit_cost IS NULL OR unit_cost>=0),\n umkm_loss_borne_by TEXT CHECK(umkm_loss_borne_by IS NULL OR umkm_loss_borne_by IN('BP','UMKM'))");
  oldSchema=oldSchema.replace("'VOID','TRANSFER','TAKEOUT'","'VOID','TRANSFER'");
  for(const table of ['merchandise_umkm_partners','merchandise_umkm_docs','merchandise_umkm_doc_items'])oldSchema=oldSchema.replace(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?;\\n`),'').replace(new RegExp(`CREATE INDEX IF NOT EXISTS \\w+ ON ${table}\\([^;]+;\\n`,'g'),'');
  assert(!/umkm|TAKEOUT/i.test(oldSchema.replace(/--[^\n]*/g,'')),'skema lama tiruan tanpa barang UMKM');
  db=new DatabaseSync(path);db.exec(oldSchema);db.exec('PRAGMA foreign_keys=ON');
  const user=insert(db,'users',{username:'lama',password_hash:'x',status:'ACTIVE',must_change_password:0,failed_login_count:0,password_changed_at:now()});
  const product=insert(db,'merchandise_products',{sku:'MER-001',name:'Barang Lama',buy_price:1,sell_price:2,stock_qty:7,warehouse_qty:3,is_active:1,created_by:user.id});
  const sale=insert(db,'merchandise_sales',{sale_no:'MR-1',sold_on:'2026-11-22',payment_method:'CARD',status:'COMPLETED',total:2,cost_total:1,created_by:user.id});
  insert(db,'merchandise_sale_items',{sale_id:sale.id,product_id:product.id,sku:'MER-001',product_name:'Barang Lama',quantity:1,unit_price:2,unit_cost:1,subtotal:2});
  insert(db,'merchandise_stock_movements',{product_id:product.id,sale_id:sale.id,kind:'SALE',location:'DISPLAY',quantity_delta:-1,balance_before:8,balance_after:7,reason:'Penjualan MR-1',created_by:user.id});
  insert(db,'merchandise_stock_movements',{product_id:product.id,kind:'TRANSFER',location:'GUDANG',quantity_delta:1,balance_before:2,balance_after:3,reason:'Pindah',created_by:user.id});
  assert.throws(()=>insert(db,'merchandise_stock_movements',{product_id:product.id,kind:'TAKEOUT',location:'DISPLAY',quantity_delta:-1,balance_before:7,balance_after:6,reason:'x',created_by:user.id}),/CHECK constraint failed/);
  db.close();db=null;
  db=openDb(path);
  const columns=table=>db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);
  assert(columns('merchandise_products').includes('umkm_partner_id'));
  assert(['umkm_partner_id','umkm_partner_name','umkm_markup_pct'].every(c=>columns('merchandise_sale_items').includes(c)));
  assert(['umkm_doc_id','unit_cost','umkm_loss_borne_by','location'].every(c=>columns('merchandise_stock_movements').includes(c)));
  assert.deepEqual({...one(db,'SELECT stock_qty,warehouse_qty,umkm_partner_id FROM merchandise_products')},{stock_qty:7,warehouse_qty:3,umkm_partner_id:null});
  assert.deepEqual(all(db,'SELECT kind,location,quantity_delta,umkm_doc_id FROM merchandise_stock_movements ORDER BY kind').map(m=>({...m})),[
    {kind:'SALE',location:'DISPLAY',quantity_delta:-1,umkm_doc_id:null},{kind:'TRANSFER',location:'GUDANG',quantity_delta:1,umkm_doc_id:null}]);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  assert.equal(one(db,"SELECT count(*) n FROM sqlite_schema WHERE type='index' AND name IN('merchandise_stock_product_idx','merchandise_stock_created_idx','merchandise_stock_umkm_doc_idx','merchandise_products_umkm_idx','merchandise_sale_items_umkm_idx','merchandise_umkm_docs_date_idx')").n,6);
  insert(db,'merchandise_stock_movements',{product_id:product.id,kind:'TAKEOUT',location:'DISPLAY',quantity_delta:-1,balance_before:7,balance_after:6,reason:'Takeout',created_by:user.id});
  assert.throws(()=>insert(db,'merchandise_stock_movements',{product_id:product.id,kind:'ADJUST',location:'DISPLAY',quantity_delta:-1,balance_before:6,balance_after:5,reason:'x',umkm_loss_borne_by:'KANTOR',created_by:user.id}),/CHECK constraint failed/);
  assert.throws(()=>insert(db,'merchandise_stock_movements',{product_id:product.id,kind:'IN',location:'DISPLAY',quantity_delta:1,balance_before:6,balance_after:7,reason:'x',umkm_doc_id:'tidak-ada',created_by:user.id}),/FOREIGN KEY/);
  // Dibuka sekali lagi: tidak dibangun ulang lagi.
  const before=one(db,"SELECT sql FROM sqlite_schema WHERE name='merchandise_stock_movements'").sql;db.close();db=null;db=openDb(path);
  assert.equal(one(db,"SELECT sql FROM sqlite_schema WHERE name='merchandise_stock_movements'").sql,before);
  assert.equal(one(db,'SELECT count(*) n FROM merchandise_stock_movements').n,3);
});
