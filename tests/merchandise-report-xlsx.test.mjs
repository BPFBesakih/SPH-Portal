import test from 'node:test';
import assert from 'node:assert/strict';
import {merchandiseMonthlyWorkbook} from '../public/merchandise-report-xlsx.js';
const sku='MER-001',product={sku,id:'p1',name:'FLASHDISK',stock_qty:8,buy_price:60000,sell_price:90000};
const unpack=async blob=>{
  const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),decoder=new TextDecoder(),files=new Map();
  let pos=0;
  while(pos+30<=bytes.length&&view.getUint32(pos,true)===0x04034b50){
    const len=view.getUint32(pos+18,true),n=view.getUint16(pos+26,true),x=view.getUint16(pos+28,true);
    const file=decoder.decode(bytes.slice(pos+30,pos+30+n));
    files.set(file,decoder.decode(bytes.slice(pos+30+n+x,pos+30+n+x+len)));
    pos+=30+n+x+len;
  }
  return files;
};
const options={
  from:'2026-11-01',to:'2026-11-03',today:'2026-11-05',
  stock:[product],
  sales:[{sold_on:'2026-11-02',status:'COMPLETED',sale_no:'MR-01',payment_method:'QRIS',
    items:[{sku,product_name:'FLASHDISK',quantity:2,unit_price:90000,unit_cost:60000,subtotal:180000}]}],
  movements:[
    {sku,product_name:'FLASHDISK',kind:'IN',quantity_delta:3,created_at:'2026-11-01T08:00:00Z',reason:'Penerimaan'},
    {sku,product_name:'FLASHDISK',kind:'SALE',quantity_delta:-2,created_at:'2026-11-02T06:00:00Z',reason:'Penjualan'}
  ],canCost:true
};
test('monthly merchandise workbook produces Master, daily sheets and final stock reconciliation',async()=>{
  const r=merchandiseMonthlyWorkbook(options);
  assert.equal(r.totalOpening,7);
  assert.equal(r.totalClosing,8);
  assert.equal(r.salesRevenue,180000);
  assert.equal(r.sheetCount,7);
  const files=await unpack(r.blob),workbook=files.get('xl/workbook.xml');
  assert.match(workbook,/name="MASTER"/);
  assert.match(workbook,/name="MASTER AKHIR"/);
  assert.match(workbook,/name="Penjualan"/);
  assert.match(workbook,/name="Mutasi Stok"/);
  const final=files.get('xl/worksheets/sheet5.xml');
  assert.match(final,/<f>C10-E10\+J10\+K10\+L10<\/f><v>8<\/v>/);
  assert.match(final,/<f>G10\*60000<\/f><v>480000<\/v>/);
  assert.match(final,/<v>180000<\/v>/);
  assert.match(final,/<mergeCells count="/);
  assert.match(final,/<autoFilter ref="A9:L11"/);
  assert.equal(files.size,12);
});
test('historical incomplete October period is rejected',()=>{
  assert.throws(()=>merchandiseMonthlyWorkbook({...options,from:'2026-10-01',to:'2026-10-31'}),/belum diimpor/);
});
test('stock values can be exported without disclosing buy price to users lacking cost permission',async()=>{
  const r=merchandiseMonthlyWorkbook({...options,canCost:false});
  const files=await unpack(r.blob);
  const xml=files.get('xl/worksheets/sheet5.xml');
  assert(!xml.includes('60000'));
  assert(!xml.includes('480000'));
  assert(!files.get('xl/worksheets/sheet6.xml').includes('LABA KOTOR'));
});
test('invalid date, negative reconstructed opening, and future report are rejected',()=>{
  assert.throws(()=>merchandiseMonthlyWorkbook({...options,from:'2026-11-35'}),/tidak valid/);
  assert.throws(()=>merchandiseMonthlyWorkbook({...options,to:'2026-11-06'}),/hari ini/);
  assert.throws(()=>merchandiseMonthlyWorkbook({...options,stock:[{...product,stock_qty:0}]}),/Saldo historis negatif/);
});
