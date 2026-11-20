import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {openDb,insert,one,all,now} from '../lib/db.mjs';
import {seedPermissions,merchandiseRoleCodes} from '../lib/auth.mjs';
import {merchandiseRoutes} from '../lib/merchandise.mjs';

function fixture(t){
  const db=openDb(':memory:');t.after(()=>db.close());seedPermissions(db);
  const users={};
  for(const [key,role] of [['manager','BISNIS_MANAGER'],['leader','BISNIS_PIMPINAN'],['coordinator','BISNIS_KOORDINATOR'],['cashier','BISNIS_PETUGAS'],['outsider','EMPLOYEE']]){
    users[key]=insert(db,'users',{username:key,password_hash:'test',status:'ACTIVE',must_change_password:0,failed_login_count:0,password_changed_at:now()});
    insert(db,'user_roles',{user_id:users[key].id,role_id:one(db,'SELECT id FROM roles WHERE code=?',role).id,scope_kind:'ALL'});
  }
  const product=insert(db,'merchandise_products',{sku:'MER-001',name:'Barang Uji',buy_price:12000,sell_price:20000,stock_qty:null,is_active:1});
  const call=(key,path,method='GET',body={},query='')=>merchandiseRoutes({db,user:users[key],p:['merchandise',...path.split('/')],method,body,url:new URL('http://local/?'+query)});
  return {db,users,product,call};
}
test('empat role Merchandise memiliki izin minimal sesuai tugas',t=>{
  const f=fixture(t);
  for(const code of Object.keys(merchandiseRoleCodes))assert(one(f.db,'SELECT id FROM roles WHERE code=?',code));
  const perm=code=>all(f.db,'SELECT p.code FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE r.code=?',code).map(p=>p.code);
  assert(perm('BISNIS_PETUGAS').includes('merchandise.stock.record'));
  assert(!perm('BISNIS_PETUGAS').includes('merchandise.catalog.costs'));
  assert(!perm('BISNIS_PETUGAS').includes('merchandise.sales.void'));
  assert(!perm('BISNIS_PIMPINAN').includes('merchandise.sales.create'));
  assert(perm('BISNIS_MANAGER').includes('merchandise.catalog.manage'));
  assert(!perm('EMPLOYEE').some(p=>p.startsWith('merchandise.')));
  assert(!perm('SUPER_ADMIN').some(p=>p.startsWith('merchandise.')));
});
test('stok belum dihitung tidak sama dengan nol dan tidak boleh dijual',t=>{
  const f=fixture(t);
  assert.equal(f.call('cashier','products').items[0].stock_qty,null);
  assert.equal(f.call('cashier','products').items[0].buy_price,undefined);
  assert.equal(f.call('manager','products').items[0].buy_price,12000);
  assert.throws(()=>f.call('cashier','sales','POST',{payment_method:'TUNAI',items:[{product_id:f.product.id,quantity:1}]}),/Stok awal/);
  const initial=f.call('cashier',`products/${f.product.id}/stock`,'POST',{kind:'INITIAL',quantity:10,reason:'Opname awal',row_version:1});
  assert.equal(initial.stock_qty,10);
  assert.throws(()=>f.call('cashier',`products/${f.product.id}/stock`,'POST',{kind:'INITIAL',quantity:11,reason:'Coba lagi',row_version:2}),/sudah dicatat/);
  assert.throws(()=>f.call('cashier',`products/${f.product.id}/stock`,'POST',{kind:'ADJUST',quantity:1,reason:'Koreksi',row_version:2}),/akses/);
});
test('penjualan mengurangi stok atomik, harga modal tidak bocor ke petugas',t=>{
  const f=fixture(t);
  f.call('cashier',`products/${f.product.id}/stock`,'POST',{kind:'INITIAL',quantity:4,reason:'Opname awal',row_version:1});
  const sale=f.call('cashier','sales','POST',{payment_method:'QRIS',items:[{product_id:f.product.id,quantity:3}]});
  assert.equal(sale.total,60000);
  assert.equal(one(f.db,'SELECT stock_qty FROM merchandise_products WHERE id=?',f.product.id).stock_qty,1);
  assert.equal(one(f.db,'SELECT unit_cost FROM merchandise_sale_items WHERE sale_id=?',sale.id).unit_cost,12000);
  assert.equal(f.call('cashier','sales').items[0].items[0].unit_cost,undefined);
  assert.throws(()=>f.call('cashier','sales','POST',{payment_method:'TUNAI',items:[{product_id:f.product.id,quantity:2}]}),/tidak mencukupi/);
  assert.equal(all(f.db,'SELECT * FROM merchandise_sales').length,1);
  assert.equal(one(f.db,'SELECT stock_qty FROM merchandise_products WHERE id=?',f.product.id).stock_qty,1);
  assert.throws(()=>f.call('cashier','reports'),/akses/);
  assert.throws(()=>f.call('outsider','products'),/akses/);
});
test('pembatalan hanya manager, stok kembali dan transaksi tetap tersimpan',t=>{
  const f=fixture(t);
  f.call('cashier',`products/${f.product.id}/stock`,'POST',{kind:'INITIAL',quantity:2,reason:'Opname awal',row_version:1});
  const sale=f.call('cashier','sales','POST',{payment_method:'TRANSFER',items:[{product_id:f.product.id,quantity:2}]});
  assert.throws(()=>f.call('coordinator',`sales/${sale.id}/void`,'POST',{row_version:1,reason:'Salah input'}),/akses/);
  f.call('manager',`sales/${sale.id}/void`,'POST',{row_version:1,reason:'Pembayaran dibatalkan'});
  assert.equal(one(f.db,'SELECT stock_qty FROM merchandise_products WHERE id=?',f.product.id).stock_qty,2);
  assert.equal(f.call('leader','reports').summary.revenue,0);
  assert.equal(one(f.db,'SELECT status FROM merchandise_sales WHERE id=?',sale.id).status,'VOID');
  assert.equal(all(f.db,'SELECT * FROM merchandise_stock_movements').length,3);
  assert.throws(()=>f.call('manager',`sales/${sale.id}/void`,'POST',{row_version:2,reason:'Sekali lagi'}),/sudah dibatalkan/);
});
test('laporan menghitung laba dari harga snapshot dan dapat difilter per periode',t=>{
  const f=fixture(t);
  f.call('cashier',`products/${f.product.id}/stock`,'POST',{kind:'INITIAL',quantity:6,reason:'Awal',row_version:1});
  f.call('cashier','sales','POST',{payment_method:'TUNAI',items:[{product_id:f.product.id,quantity:2}]});
  const report=f.call('manager','reports');
  assert.deepEqual(report.summary,{transaction_count:1,units_sold:2,revenue:40000,cost:24000});
  assert.equal(f.call('leader','reports').summary.revenue,40000);
  assert.equal(f.call('manager','reports','GET',{},'from=2000-01-01&to=2000-01-31').summary.revenue,0);
  assert.throws(()=>f.call('manager','reports','GET',{},'from=2099-01-01&to=2020-01-01'),/Tanggal awal/);
  assert.throws(()=>f.call('cashier','reports/export','POST',{period:'2026-10'}),/akses/);
  assert.deepEqual(f.call('manager','reports/export','POST',{period:'2026-10'}),{ok:true});
});

// Stok Display & Gudang, pindah stok, dan pembayaran CARD (keputusan pemilik 20 Nov 2026).
const stockOf=(f,id=f.product.id)=>one(f.db,'SELECT stock_qty,warehouse_qty,row_version FROM merchandise_products WHERE id=?',id);
const record=(f,key,body,id=f.product.id)=>f.call(key,`products/${id}/stock`,'POST',{reason:'Uji',...body,row_version:stockOf(f,id).row_version});
test('stok display dan gudang: hitung awal gudang, barang masuk, pindah dua arah, koreksi per lokasi',t=>{
  const f=fixture(t);
  record(f,'cashier',{kind:'INITIAL',quantity:3});
  assert.deepEqual(f.call('cashier','products').items.map(p=>[p.stock_qty,p.warehouse_qty]),[[3,null]],'gudang belum dihitung, bukan 0');
  assert.throws(()=>record(f,'cashier',{kind:'IN',location:'GUDANG',quantity:5}),/stok awal gudang/);
  assert.throws(()=>record(f,'cashier',{kind:'TRANSFER',location:'DISPLAY',quantity:1}),/stok awal gudang/);
  const counted=record(f,'cashier',{kind:'INITIAL',location:'GUDANG',quantity:20,reason:'Hitung gudang'});
  assert.deepEqual([counted.stock_qty,counted.warehouse_qty],[3,20]);
  assert.throws(()=>record(f,'cashier',{kind:'INITIAL',location:'GUDANG',quantity:21}),/sudah dicatat/);
  record(f,'cashier',{kind:'IN',location:'GUDANG',quantity:10});
  const moved=record(f,'cashier',{kind:'TRANSFER',location:'DISPLAY',quantity:7,reason:'Isi display'});
  assert.deepEqual([moved.stock_qty,moved.warehouse_qty],[10,23]);
  record(f,'cashier',{kind:'TRANSFER',location:'GUDANG',quantity:2,reason:'Kembalikan ke gudang'});
  assert.deepEqual([stockOf(f).stock_qty,stockOf(f).warehouse_qty],[8,25]);
  assert.throws(()=>record(f,'cashier',{kind:'TRANSFER',location:'DISPLAY',quantity:26}),/gudang Barang Uji hanya 25/);
  assert.throws(()=>record(f,'cashier',{kind:'TRANSFER',location:'DISPLAY',quantity:0}),/lebih dari nol/);
  assert.throws(()=>record(f,'cashier',{kind:'ADJUST',location:'GUDANG',quantity:24}),/akses/,'koreksi tetap hanya koordinator/manager');
  record(f,'coordinator',{kind:'ADJUST',location:'GUDANG',quantity:24,reason:'Opname gudang'});
  assert.throws(()=>record(f,'cashier',{kind:'IN',location:'RAK',quantity:1}),/Lokasi stok/);
  const rows=all(f.db,'SELECT kind,location,quantity_delta,balance_before,balance_after FROM merchandise_stock_movements ORDER BY created_at,rowid');
  assert.deepEqual(rows.map(r=>[r.kind,r.location,r.quantity_delta,r.balance_before,r.balance_after]),[
    ['INITIAL','DISPLAY',3,null,3],['INITIAL','GUDANG',20,null,20],['IN','GUDANG',10,20,30],
    ['TRANSFER','GUDANG',-7,30,23],['TRANSFER','DISPLAY',7,3,10],
    ['TRANSFER','DISPLAY',-2,10,8],['TRANSFER','GUDANG',2,23,25],['ADJUST','GUDANG',-1,25,24]
  ]);
  const ledger=f.call('cashier','stock').items;
  assert(ledger.every(m=>m.location&&m.actor_name));
});
test('barang baru: stok awal display dan gudang sekaligus; gudang boleh dikosongkan',t=>{
  const f=fixture(t);
  const second=f.call('manager','products','POST',{sku:'MER-002',name:'Barang Kedua',buy_price:1000,sell_price:2000});
  assert.equal(second.warehouse_qty,null);
  const both=record(f,'cashier',{kind:'INITIAL',quantity:4,warehouse_quantity:9},second.id);
  assert.deepEqual([both.stock_qty,both.warehouse_qty],[4,9]);
  const onlyDisplay=record(f,'cashier',{kind:'INITIAL',quantity:2,warehouse_quantity:''});
  assert.deepEqual([onlyDisplay.stock_qty,onlyDisplay.warehouse_qty],[2,null]);
});
test('penjualan hanya mengurangi display; bila kurang padahal gudang ada, minta pindahkan dulu',t=>{
  const f=fixture(t);
  record(f,'cashier',{kind:'INITIAL',quantity:1,warehouse_quantity:10});
  assert.throws(()=>f.call('cashier','sales','POST',{payment_method:'TUNAI',items:[{product_id:f.product.id,quantity:2}]}),
    /Stok display Barang Uji tidak mencukupi \(tersisa 1\)\. Gudang masih 10: catat "Pindah ke display" dulu\./);
  assert.equal(all(f.db,'SELECT * FROM merchandise_sales').length,0);
  record(f,'cashier',{kind:'TRANSFER',location:'DISPLAY',quantity:4});
  const sale=f.call('cashier','sales','POST',{payment_method:'CARD',items:[{product_id:f.product.id,quantity:2}]});
  assert.deepEqual([stockOf(f).stock_qty,stockOf(f).warehouse_qty],[3,6]);
  assert.equal(one(f.db,'SELECT payment_method FROM merchandise_sales WHERE id=?',sale.id).payment_method,'CARD');
  f.call('manager',`sales/${sale.id}/void`,'POST',{row_version:1,reason:'Kartu ditolak'});
  assert.deepEqual([stockOf(f).stock_qty,stockOf(f).warehouse_qty],[5,6],'pembatalan kembali ke display');
  assert.deepEqual(all(f.db,"SELECT kind,location FROM merchandise_stock_movements WHERE kind IN('SALE','VOID') ORDER BY created_at,rowid").map(r=>r.kind+':'+r.location),['SALE:DISPLAY','VOID:DISPLAY']);
  assert.throws(()=>f.call('cashier','sales','POST',{payment_method:'KARTU',items:[{product_id:f.product.id,quantity:1}]}),/Metode pembayaran/);
  for(const method of ['TUNAI','QRIS','TRANSFER','CARD','LAINNYA'])f.call('cashier','sales','POST',{payment_method:method,items:[{product_id:f.product.id,quantity:1}]});
  assert.equal(stockOf(f).stock_qty,0);
});
test('kiriman tampilan lama tanpa lokasi tetap berarti stok display',t=>{
  const f=fixture(t);
  f.call('cashier',`products/${f.product.id}/stock`,'POST',{kind:'INITIAL',quantity:5,reason:'Opname awal',row_version:1});
  f.call('cashier',`products/${f.product.id}/stock`,'POST',{kind:'IN',quantity:2,reason:'Penerimaan',row_version:2});
  f.call('coordinator',`products/${f.product.id}/stock`,'POST',{kind:'ADJUST',quantity:6,reason:'Opname',row_version:3});
  assert.deepEqual([stockOf(f).stock_qty,stockOf(f).warehouse_qty],[6,null]);
  assert(all(f.db,'SELECT location FROM merchandise_stock_movements').every(r=>r.location==='DISPLAY'));
});
test('beranda: perlu restock dari total, display perlu diisi, gudang belum dihitung',t=>{
  const f=fixture(t);
  const make=(sku,display,gudang,active=1)=>{
    const p=insert(f.db,'merchandise_products',{sku,name:sku,buy_price:1,sell_price:2,stock_qty:display,warehouse_qty:gudang,is_active:active});return p;
  };
  make('A',2,2);   // total 4: restock; display 2 dengan gudang 2: isi display
  make('B',1,30);  // total 31: isi display saja
  make('C',4,null);// total 4 (gudang belum dihitung = 0): restock; gudang belum dihitung
  make('D',9,0);   // aman
  make('E',0,6,0); // nonaktif: tidak dihitung untuk isi display/gudang belum dihitung
  const r=f.call('cashier','overview');
  assert.equal(r.products_low,2);
  assert.equal(r.products_display_low,2);
  assert.equal(r.products_warehouse_uncounted,2,'Barang Uji (stok belum dihitung) dan C, tanpa E nonaktif');
  assert.equal(r.products_uninitialized,1);
});
test('riwayat stok untuk ekspor: semua mutasi sejak 00.00 WITA tanggal awal',t=>{
  const f=fixture(t);
  record(f,'cashier',{kind:'INITIAL',quantity:5,warehouse_quantity:5});
  const ids=all(f.db,'SELECT id FROM merchandise_stock_movements ORDER BY rowid').map(r=>r.id);
  // 31 Okt 15.59 UTC = 31 Okt 23.59 WITA (di luar); 31 Okt 16.00 UTC = 1 Nov 00.00 WITA (masuk).
  f.db.prepare('UPDATE merchandise_stock_movements SET created_at=? WHERE id=?').run('2026-10-31T15:59:59.999Z',ids[0]);
  f.db.prepare('UPDATE merchandise_stock_movements SET created_at=? WHERE id=?').run('2026-10-31T16:00:00.000Z',ids[1]);
  const since=f.call('cashier','stock','GET',{},'from=2026-11-01');
  assert.deepEqual(since.items.map(m=>m.id),[ids[1]]);
  assert.equal(since.from,'2026-11-01');
  assert.equal(f.call('cashier','stock').items.length,2);
  assert.throws(()=>f.call('cashier','stock','GET',{},'from=2026-11-31'),/Tanggal/);
});
test('basis data lokal lama ditingkatkan: stok lama jadi display, riwayat lama DISPLAY, CARD dan TRANSFER diterima',t=>{
  const dir=mkdtempSync(resolve(tmpdir(),'sph-bisnis-')),path=resolve(dir,'portal.sqlite');let db;
  t.after(()=>{db?.close();rmSync(dir,{recursive:true,force:true});});
  const schema=readFileSync(new URL('../schema.sql',import.meta.url),'utf8');
  const oldSchema=schema.replace(",\n warehouse_qty INTEGER CHECK(warehouse_qty IS NULL OR warehouse_qty>=0)","")
    .replace("payment_method IN('TUNAI','QRIS','TRANSFER','CARD','LAINNYA')","payment_method IN('TUNAI','QRIS','TRANSFER','LAINNYA')")
    .replace("kind IN('INITIAL','IN','ADJUST','SALE','VOID','TRANSFER')","kind IN('INITIAL','IN','ADJUST','SALE','VOID')")
    .replace(",\n location TEXT NOT NULL DEFAULT 'DISPLAY' CHECK(location IN('DISPLAY','GUDANG'))","");
  assert(!oldSchema.includes('warehouse_qty INTEGER')&&!oldSchema.includes("'CARD'")&&!oldSchema.includes("'VOID','TRANSFER'")&&!oldSchema.includes('location TEXT NOT NULL'),'skema lama tiruan');
  db=new DatabaseSync(path);db.exec(oldSchema);db.exec('PRAGMA foreign_keys=ON');
  const user=insert(db,'users',{username:'lama',password_hash:'x',status:'ACTIVE',must_change_password:0,failed_login_count:0,password_changed_at:now()});
  const product=insert(db,'merchandise_products',{sku:'MER-001',name:'Barang Lama',buy_price:1,sell_price:2,stock_qty:7,is_active:1,created_by:user.id});
  const sale=insert(db,'merchandise_sales',{sale_no:'MR-1',sold_on:'2026-11-02',payment_method:'LAINNYA',status:'COMPLETED',total:2,cost_total:1,created_by:user.id});
  insert(db,'merchandise_sale_items',{sale_id:sale.id,product_id:product.id,sku:'MER-001',product_name:'Barang Lama',quantity:1,unit_price:2,unit_cost:1,subtotal:2});
  insert(db,'merchandise_stock_movements',{product_id:product.id,sale_id:sale.id,kind:'SALE',quantity_delta:-1,balance_before:8,balance_after:7,reason:'Penjualan MR-1',created_by:user.id});
  assert.throws(()=>insert(db,'merchandise_sales',{sale_no:'MR-2',sold_on:'2026-11-02',payment_method:'CARD',status:'COMPLETED',total:0,cost_total:0,created_by:user.id}),/CHECK constraint failed/);
  db.close();db=null;
  db=openDb(path);
  assert.deepEqual({...one(db,'SELECT stock_qty,warehouse_qty FROM merchandise_products')},{stock_qty:7,warehouse_qty:null});
  assert.deepEqual({...one(db,'SELECT kind,location,sale_id FROM merchandise_stock_movements')},{kind:'SALE',location:'DISPLAY',sale_id:sale.id});
  assert.equal(one(db,'SELECT payment_method FROM merchandise_sales WHERE id=?',sale.id).payment_method,'LAINNYA');
  assert.equal(one(db,"SELECT count(*) n FROM sqlite_schema WHERE type='index' AND name IN('merchandise_sales_date_idx','merchandise_stock_product_idx','merchandise_stock_created_idx')").n,3);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  insert(db,'merchandise_sales',{sale_no:'MR-3',sold_on:'2026-11-20',payment_method:'CARD',status:'COMPLETED',total:0,cost_total:0,created_by:user.id});
  insert(db,'merchandise_stock_movements',{product_id:product.id,kind:'TRANSFER',location:'GUDANG',quantity_delta:1,balance_before:0,balance_after:1,reason:'Uji',created_by:user.id});
  assert.throws(()=>insert(db,'merchandise_stock_movements',{product_id:product.id,kind:'TRANSFER',location:'RAK',quantity_delta:1,balance_before:0,balance_after:1,reason:'Uji',created_by:user.id}),/CHECK constraint failed/);
  assert.throws(()=>insert(db,'merchandise_stock_movements',{product_id:'tidak-ada',kind:'IN',quantity_delta:1,balance_before:0,balance_after:1,reason:'Uji',created_by:user.id}),/FOREIGN KEY/,'relasi tetap ditegakkan');
  // Dibuka sekali lagi: tidak dibangun ulang lagi.
  const before=one(db,"SELECT sql FROM sqlite_schema WHERE name='merchandise_sales'").sql;db.close();db=null;db=openDb(path);
  assert.equal(one(db,"SELECT sql FROM sqlite_schema WHERE name='merchandise_sales'").sql,before);
  assert.equal(one(db,'SELECT count(*) n FROM merchandise_sales').n,2);
});
