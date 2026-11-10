import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {restockCandidates,LOW_STOCK_LIMIT} from '../public/merchandise.js';

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
  // Server: stock_qty !== null && stock_qty <= 5, termasuk barang nonaktif.
  assert.equal(list.length,products.filter(p=>p.stock_qty!==null&&p.stock_qty<=LOW_STOCK_LIMIT).length);
  assert(!list.some(p=>p.stock_qty===null||p.stock_qty>LOW_STOCK_LIMIT));
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

test('kartu stok rendah adalah tombol yang membuka daftar restock',async()=>{
  const source=await readFile(new URL('../public/merchandise.js',import.meta.url),'utf8');
  assert.match(source,/statLink\('Stok 5 atau kurang',r\.products_low,'Termasuk stok kosong','mm-low-stock'/);
  assert.match(source,/if\(action==='mm-low-stock'\)await showLowStock\(\);/);
  assert.match(source,/<button type="button" class="stat-card mm-stat mm-stat-link"/);
});
