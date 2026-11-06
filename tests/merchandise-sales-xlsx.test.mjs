import test from 'node:test';
import assert from 'node:assert/strict';
import {merchandiseSalesData,merchandiseSalesWorkbook} from '../public/merchandise-sales-xlsx.js';
import {salesTemplate} from '../public/merchandise-sales-template.js';

export const sample={
  artwork:{drawing:'<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><xdr:row>102</xdr:row><date>Besakih, {{REPORT_DATE}}</date></xdr:wsDr>',drawingRels:'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',images:{'xl/media/test.png':new Uint8Array([137,80,78,71,13,10,26,10])}},
  from:'2026-11-01',to:'2026-11-03',today:'2026-11-06',canCost:true,
  stock:[{sku:'MER-001',name:'Barang Uji',sell_price:999999,buy_price:888888},{sku:'MER-002',name:'Barang tanpa penjualan'}],
  sales:[
    {id:'a',sale_no:'M-1',sold_on:'2026-11-01',status:'COMPLETED',total:180000,payment_method:'TUNAI',items:[{sku:'MER-001',product_name:'Barang Uji',quantity:2,unit_price:90000,unit_cost:60000,subtotal:180000}]},
    {id:'b',sale_no:'M-2',sold_on:'2026-11-03',status:'COMPLETED',total:100000,payment_method:'QRIS',items:[{sku:'MER-001',product_name:'Barang Uji',quantity:1,unit_price:100000,unit_cost:65000,subtotal:100000}]},
    {id:'c',sale_no:'M-3',sold_on:'2026-11-02',status:'VOID',total:90000,payment_method:'TUNAI',items:[{sku:'MER-001',quantity:1,unit_cost:60000,subtotal:90000}]},
    {id:'d',sale_no:'M-4',sold_on:'2026-11-04',status:'COMPLETED',total:90000,payment_method:'TUNAI',items:[{sku:'MER-001',quantity:1,unit_cost:60000,subtotal:90000}]}
  ],summary:{revenue:280000,cost:185000,units_sold:3,transaction_count:2}
};
const unpack=async blob=>{
  const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),decoder=new TextDecoder(),files=new Map();
  for(let pos=0;pos+30<=bytes.length&&view.getUint32(pos,true)===0x04034b50;){
    const size=view.getUint32(pos+18,true),n=view.getUint16(pos+26,true),extra=view.getUint16(pos+28,true),start=pos+30+n+extra;
    files.set(decoder.decode(bytes.slice(pos+30,pos+30+n)),decoder.decode(bytes.slice(start,start+size)));pos=start+size;
  }
  return files;
};
test('snapshot prices, period boundaries, zero-sale products and cancelled sales reconcile',()=>{
  const d=merchandiseSalesData(sample);
  assert.deepEqual(d.totals,{qty:3,revenue:280000,cost:185000});
  assert.deepEqual(d.payments,{cash:180000,noncash:100000,other:0});
  assert.equal(d.products.length,2);assert.equal(d.daily.get('2026-11-02').totals.revenue,0);
});
test('workbook retains original artwork, styles, daily sheets and official report blocks',async()=>{
  const out=merchandiseSalesWorkbook(sample),f=await unpack(out.blob);
  assert.equal(out.sheetCount,5);assert.equal(out.revenue,280000);
  assert.match(f.get('xl/workbook.xml'),/name="MASTER".*name="1".*name="2".*name="3".*name="MASTER AKHIR"/);
  assert.equal(f.get('xl/styles.xml'),salesTemplate.styles);
  assert(f.has('xl/media/test.png'));
  const final=f.get('xl/worksheets/sheet5.xml');
  for(const label of ['I. REKAPITULASI PENJUALAN DAN LABA','II. PENJUALAN','III. METODE PEMBAYARAN','RATA-RATA/\nHARI'])assert(final.includes(label));
  assert.match(final,/<f>SUM\(&apos;1&apos;!D24,&apos;2&apos;!D24,&apos;3&apos;!D24\)<\/f><v>280000<\/v>/);
  assert.match(final,/<f>C24\/3<\/f><v>1<\/v>/);
  assert.match(final,/<f>D24-E24<\/f><v>95000<\/v>/);
  assert.match(final,/<pageSetup paperSize="5" scale="75" orientation="portrait"/);
  assert.match(final,/<mergeCell ref="C22:F22"/);
  assert.match(f.get('xl/drawings/drawing5.xml'),/Besakih, 3 November 2026/);
  for(const [name,content] of f)if(name.endsWith('.xml'))assert(!content.includes('#REF!'),name);
  assert(![...f.values()].join('').includes('888888'));
});
test('unauthorized exports contain no cost, margin, cost formulas or hidden source prices',async()=>{
  const f=await unpack(merchandiseSalesWorkbook({...sample,canCost:false}).blob);
  const sheet=f.get('xl/worksheets/sheet5.xml');
  assert(!sheet.includes('185000'));assert(!sheet.includes('65000'));assert(!sheet.includes('95000'));
  assert(!sheet.includes('D24-E24'));assert(sheet.includes('Tidak ditampilkan'));
  assert.match(sheet,/<c r="E24" s="\d+"\/>/);
});
test('all payment categories reconcile, including a separate LAINNYA line',async()=>{
  const sales=[...sample.sales,{...sample.sales[1],id:'transfer',sale_no:'M-5',payment_method:'TRANSFER'}, {...sample.sales[1],id:'other',sale_no:'M-6',payment_method:'LAINNYA'}];
  const options={...sample,sales,summary:undefined};
  const d=merchandiseSalesData(options);assert.deepEqual(d.payments,{cash:180000,noncash:200000,other:100000});
  const f=await unpack(merchandiseSalesWorkbook(options).blob),s=f.get('xl/worksheets/sheet5.xml');
  assert(s.includes('LAINNYA'));assert.match(s,/<f>SUM\(C98:C100\)<\/f><v>480000<\/v>/);
  assert.match(s,/<mergeCell ref="C100:G100"/);
});
test('incomplete summaries, duplicate transactions, bad dates and missing snapshots fail visibly',()=>{
  assert.throws(()=>merchandiseSalesData({...sample,summary:{...sample.summary,revenue:999}}),/belum lengkap/);
  assert.throws(()=>merchandiseSalesData({...sample,sales:[sample.sales[0],sample.sales[0]]}),/ganda/);
  assert.throws(()=>merchandiseSalesData({...sample,from:'2026-11-31'}),/tidak valid/);
  assert.throws(()=>merchandiseSalesData({...sample,to:'2026-12-01'}),/satu bulan/);
  assert.throws(()=>merchandiseSalesData({...sample,to:'2026-11-07'}),/hari ini/);
  assert.throws(()=>merchandiseSalesData({...sample,from:'2026-10-01',to:'2026-10-31'}),/belum diimpor/);
  const bad=structuredClone(sample);delete bad.sales[0].items[0].unit_cost;
  assert.throws(()=>merchandiseSalesData(bad),/Modal snapshot/);
});
test('historic products missing from catalogue stay in the report and >70 products extend the layout',async()=>{
  const stock=Array.from({length:72},(_,i)=>({sku:'EXTRA-'+i,name:'Produk '+i}));
  const d=merchandiseSalesData({...sample,stock});assert.equal(d.products.length,73);
  const f=await unpack(merchandiseSalesWorkbook({...sample,stock}).blob),s=f.get('xl/worksheets/sheet5.xml');
  assert.match(s,/<mergeCell ref="A97:B97"/);
  assert.match(s,/<f>SUM\(C24:C96\)<\/f><v>3<\/v>/);
  assert.match(f.get('xl/drawings/drawing5.xml'),/<xdr:row>105<\/xdr:row>/);
});
test('empty periods remain valid zero-valued reports',async()=>{
  const out=merchandiseSalesWorkbook({...sample,sales:[],summary:{revenue:0,cost:0,units_sold:0,transaction_count:0}});
  assert.equal(out.revenue,0);assert.equal(out.units,0);assert.equal(out.days,3);
});
