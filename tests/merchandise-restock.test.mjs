import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {restockCandidates,displayRefillCandidates,paymentSummary,saleProductOptions,stockActions,totalStock,todaySalesSummary,LOW_STOCK_LIMIT,PAYMENT_METHODS} from '../public/merchandise.js';

const products=[
  {id:'p1',sku:'MER-001',name:'Kaos',stock_qty:12,is_active:true},
  {id:'p2',sku:'MER-002',name:'Gantungan kunci',stock_qty:3,is_active:true},
  {id:'p3',sku:'MER-003',name:'Topi',stock_qty:0,is_active:true},
  {id:'p4',sku:'MER-004',name:'Buku lama',stock_qty:0,is_active:false},
  {id:'p5',sku:'MER-005',name:'Gelang',stock_qty:3,is_active:1},
  {id:'p6',sku:'MER-006',name:'Belum dihitung',stock_qty:null,is_active:true},
  {id:'p7',sku:'MER-007',name:'Stiker',stock_qty:5,is_active:true}
];
const sales=[
  {status:'COMPLETED',items:[{product_id:'p5',sku:'MER-005',quantity:4},{product_id:'p2',sku:'MER-002',quantity:1}]},
  {status:'COMPLETED',items:[{product_id:'p5',sku:'MER-005',quantity:2}]},
  {status:'VOID',items:[{product_id:'p2',sku:'MER-002',quantity:9}]}
];

test('daftar restock sama dengan hitungan kartu "Stok 5 atau kurang"',()=>{
  const list=restockCandidates(products,sales);
  // Server: stock_qty !== null && stock_qty + (warehouse_qty ?? 0) <= 5, termasuk barang nonaktif.
  assert.equal(list.length,products.filter(p=>p.stock_qty!==null&&p.stock_qty+(p.warehouse_qty??0)<=LOW_STOCK_LIMIT).length);
  assert(!list.some(p=>p.stock_qty===null||totalStock(p)>LOW_STOCK_LIMIT));
});
test('restock memakai total display + gudang; gudang belum dihitung dianggap 0',()=>{
  const list=restockCandidates([
    {id:'a',sku:'A',name:'Display sedikit, gudang banyak',stock_qty:1,warehouse_qty:40,is_active:true},
    {id:'b',sku:'B',name:'Total empat',stock_qty:2,warehouse_qty:2,is_active:true},
    {id:'c',sku:'C',name:'Gudang belum dihitung',stock_qty:3,warehouse_qty:null,is_active:true}
  ],null);
  assert.deepEqual(list.map(p=>[p.sku,p.total]),[['C',3],['B',4]]);
});
test('kartu "Display perlu diisi": aktif, display 5 atau kurang, gudang masih ada',()=>{
  const list=displayRefillCandidates([
    {id:'a',sku:'A',name:'A',stock_qty:1,warehouse_qty:40,is_active:true},
    {id:'b',sku:'B',name:'B',stock_qty:0,warehouse_qty:3,is_active:1},
    {id:'c',sku:'C',name:'C',stock_qty:5,warehouse_qty:0,is_active:true},
    {id:'d',sku:'D',name:'D',stock_qty:2,warehouse_qty:null,is_active:true},
    {id:'e',sku:'E',name:'E',stock_qty:0,warehouse_qty:9,is_active:false},
    {id:'f',sku:'F',name:'F',stock_qty:6,warehouse_qty:9,is_active:true}
  ]);
  assert.deepEqual(list.map(p=>p.sku),['B','A']);
});

test('urutan: aktif dulu, stok paling sedikit, lalu yang paling laku; transaksi batal tidak dihitung',()=>{
  const list=restockCandidates(products,sales);
  assert.deepEqual(list.map(p=>p.sku),['MER-003','MER-005','MER-002','MER-007','MER-004']);
  assert.deepEqual(list.map(p=>p.sold),[0,6,1,0,0]);
});

test('tanpa izin penjualan kolom terjual tidak diisi',()=>{
  const list=restockCandidates(products,null);
  assert(list.every(p=>p.sold===null));
  assert.deepEqual(list.map(p=>p.sku),['MER-003','MER-002','MER-005','MER-007','MER-004']);
});

test('kartu stok rendah dan display perlu diisi adalah tombol yang membuka daftarnya',async()=>{
  const source=await readFile(new URL('../public/merchandise.js',import.meta.url),'utf8');
  assert.match(source,/statLink\('Stok 5 atau kurang',r\.products_low,'Display \+ gudang, termasuk kosong','mm-low-stock'/);
  assert.match(source,/statLink\('Display perlu diisi',r\.products_display_low\?\?0,'Display 5 atau kurang, gudang ada','mm-display-refill'/);
  assert.match(source,/if\(action==='mm-low-stock'\)await showLowStock\(\);/);
  assert.match(source,/if\(action==='mm-display-refill'\)await showDisplayRefill\(\);/);
  assert.match(source,/<button type="button" class="stat-card mm-stat mm-stat-link"/);
});
test('pilihan pembayaran: TUNAI, QRIS, TRANSFER, CARD, LAINNYA; rekap seperti Excel',()=>{
  assert.deepEqual(PAYMENT_METHODS,['TUNAI','QRIS','TRANSFER','CARD','LAINNYA']);
  const done=(payment_method,total)=>({status:'COMPLETED',payment_method,total});
  const rows=paymentSummary([done('TUNAI',10),done('QRIS',20),done('CARD',30),done('CARD',5),{status:'VOID',payment_method:'TRANSFER',total:99}]);
  assert.deepEqual(rows.map(r=>[r.label,r.count,r.total]),[['TUNAI',1,10],['NON TUNAI (QRIS)',1,20],['TRANSFER',0,0],['CARD',2,35]]);
  assert.deepEqual(paymentSummary([done('LAINNYA',7)]).map(r=>r.label),['TUNAI','NON TUNAI (QRIS)','TRANSFER','CARD','LAINNYA']);
});
test('Catat Penjualan: hanya stok display yang bisa dipilih; display habis tapi gudang ada tetap terlihat',()=>{
  const {sellable,inWarehouse,html}=saleProductOptions([
    {id:'a',name:'Kaos',sell_price:90000,stock_qty:3,warehouse_qty:10,is_active:true},
    {id:'b',name:'Topi',sell_price:50000,stock_qty:0,warehouse_qty:4,is_active:true},
    {id:'c',name:'Stiker',sell_price:5000,stock_qty:0,warehouse_qty:0,is_active:true},
    {id:'d',name:'Gelang',sell_price:10000,stock_qty:2,warehouse_qty:null,is_active:true}
  ]);
  assert.deepEqual(sellable.map(p=>p.id),['a','d']);assert.deepEqual(inWarehouse.map(p=>p.id),['b']);
  assert.match(html,/Kaos — Rp90\.000 \(display 3 · gudang 10\)/);assert.match(html,/Gelang — Rp10\.000 \(display 2\)/);
  assert.match(html,/<optgroup label="Display habis — pindahkan dari gudang dulu"><option value="b" disabled>Topi \(gudang 4\)<\/option><\/optgroup>/);
  assert.doesNotMatch(html,/Stiker/);
});
test('pilihan Catat stok: bawaan barang masuk ke gudang; hitung gudang dulu bila belum',()=>{
  const values=(p,adjust=false)=>stockActions(p,adjust).map(a=>a.value);
  assert.deepEqual(values({stock_qty:null,warehouse_qty:null}),['INITIAL:DISPLAY']);
  assert.deepEqual(values({stock_qty:4,warehouse_qty:null}),['INITIAL:GUDANG','IN:DISPLAY']);
  assert.deepEqual(values({stock_qty:4,warehouse_qty:null},true),['INITIAL:GUDANG','IN:DISPLAY','ADJUST:DISPLAY']);
  assert.deepEqual(values({stock_qty:4,warehouse_qty:10},true),['IN:GUDANG','IN:DISPLAY','TRANSFER:DISPLAY','TRANSFER:GUDANG','ADJUST:DISPLAY','ADJUST:GUDANG']);
  assert.deepEqual(values({stock_qty:0,warehouse_qty:0}),['IN:GUDANG','IN:DISPLAY'],'pindah hanya bila asalnya ada');
  assert.equal(stockActions({stock_qty:4,warehouse_qty:10},false).find(a=>a.value==='TRANSFER:DISPLAY').max,10);
});

test('kartu "Penjualan hari ini" menghitung transaksi selesai saja',()=>{
  assert.deepEqual(todaySalesSummary([
    {status:'COMPLETED',total:150000,items:[{quantity:2},{quantity:1}]},
    {status:'COMPLETED',total:30000,items:[{quantity:1}]},
    {status:'VOID',total:999000,items:[{quantity:9}]}
  ]),{revenue:180000,count:2,units:4});
  assert.deepEqual(todaySalesSummary([]),{revenue:0,count:0,units:0});
});

test('"Belum input stok" diganti "Penjualan hari ini"; peringatan stok awal tetap muncul bila perlu',async()=>{
  const source=await readFile(new URL('../public/merchandise.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/stat\('Belum input stok'/);
  assert.match(source,/stat\('Penjualan hari ini'/);
  assert.match(source,/merchandise\/sales\?from=\$\{today\}&to=\$\{today\}/);
  assert.match(source,/\$\{r\.products_uninitialized\?`<div class="notice warning">/);
});
