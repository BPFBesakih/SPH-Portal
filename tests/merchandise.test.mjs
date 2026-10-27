import test from 'node:test';
import assert from 'node:assert/strict';
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
