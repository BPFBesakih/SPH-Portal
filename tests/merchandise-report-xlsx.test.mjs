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
  assert.match(final,/<f>C24-E24\+3<\/f><v>8<\/v>/);
  assert.match(final,/<f>G24\*60000<\/f><v>480000<\/v>/);
  assert.match(final,/<v>180000<\/v>/);
  assert.match(final,/<mergeCells count="/);
  assert.match(final,/LAPORAN STOK DAN BARANG MASUK 1 - 3 NOVEMBER 2026/);
  assert.match(final,/I\. REKAPITULASI STOK DISPLAY DAN STOK AKHIR/);
  assert.match(final,/II\. PENJUALAN/);
  assert.match(final,/BADAN PENGELOLA/);
  assert.match(final,/FASILITAS KAWASAN SUCI PURA AGUNG BESAKIH/);
  assert.match(final,/<autoFilter ref="A22:I24"/);
  assert.equal(files.size,12);
});
test('official layout embeds the BPFKSPA logo in every stock worksheet',async()=>{
  const logoBytes=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0]);
  const r=merchandiseMonthlyWorkbook({...options,logoBytes});
  const files=await unpack(r.blob);
  assert(files.has('xl/media/bpf-logo.png'));
  for(let i=1;i<=5;i++){
    assert(files.has('xl/drawings/drawing'+i+'.xml'));
    assert(files.has('xl/worksheets/_rels/sheet'+i+'.xml.rels'));
    assert.match(files.get('xl/worksheets/sheet'+i+'.xml'),/<drawing r:id="rId1"\/>/);
  }
  assert.equal(files.size,28);
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

// Stok Display & Gudang (20 November 2026): tabel utama tetap stok display, stok gudang di
// tabel III. Hitungan pertama gudang menjadi stok awal gudang, bukan barang masuk.
const split={
  ...options,stock:[{...product,stock_qty:8,warehouse_qty:37}],
  movements:[
    ...options.movements,
    {sku,product_name:'FLASHDISK',kind:'INITIAL',location:'GUDANG',quantity_delta:40,balance_before:null,balance_after:40,created_at:'2026-11-02T07:00:00Z',reason:'Hitung gudang'},
    {sku,product_name:'FLASHDISK',kind:'TRANSFER',location:'GUDANG',quantity_delta:-5,balance_before:40,balance_after:35,created_at:'2026-11-02T08:00:00Z',reason:'Isi display'},
    {sku,product_name:'FLASHDISK',kind:'TRANSFER',location:'DISPLAY',quantity_delta:5,balance_before:3,balance_after:8,created_at:'2026-11-02T08:00:00Z',reason:'Isi display'},
    {sku,product_name:'FLASHDISK',kind:'IN',location:'GUDANG',quantity_delta:2,balance_before:35,balance_after:37,created_at:'2026-11-03T02:00:00Z',reason:'Kiriman pemasok'}
  ]
};
const cellAt=(xml,ref)=>xml.match(new RegExp(`<c r="${ref}"[^>]*?(?:/>|>(.*?)</c>)`))?.[1]??null;
const text=(xml,ref)=>cellAt(xml,ref)?.match(/<t xml:space="preserve">([^<]*)<\/t>/)?.[1]??null;
test('stok gudang: tabel III, hitungan pertama sebagai stok awal gudang, pindah stok ke display',async()=>{
  const r=merchandiseMonthlyWorkbook(split);
  assert.equal(r.totalOpening,2);assert.equal(r.totalClosing,8);assert.equal(r.warehouseClosing,37);
  const f=await unpack(r.blob),master=f.get('xl/worksheets/sheet1.xml'),day1=f.get('xl/worksheets/sheet2.xml'),day2=f.get('xl/worksheets/sheet3.xml'),day3=f.get('xl/worksheets/sheet4.xml'),final=f.get('xl/worksheets/sheet5.xml');
  // Tabel display: pindahan dari gudang ikut menambah stok akhir display.
  assert.match(final,/<f>C24-E24\+8<\/f><v>8<\/v>/);
  assert.match(text(final,'I24'),/BARANG MASUK \+3 \| DARI GUDANG \+5/);
  // Tabel III mulai dua baris setelah JUMLAH (baris 25).
  assert.equal(text(final,'A27'),'III. STOK GUDANG');
  assert.deepEqual(['C','D','E','F','G'].map(c=>text(final,c+'28')),['STOK AWAL (Pcs)','BARANG MASUK (Pcs)','PINDAH KE DISPLAY (Pcs)','KOREKSI (+/-)','STOK AKHIR (Pcs)']);
  assert.equal(cellAt(final,'C29'),null,'stok awal gudang kosong: belum dihitung pada 1 November');
  assert.equal(cellAt(final,'D29'),'<v>2</v>');assert.equal(cellAt(final,'E29'),'<v>5</v>');
  assert.equal(cellAt(final,'G29'),'<f>40+D29-E29+F29</f><v>37</v>');
  assert.equal(cellAt(final,'H29'),'<f>G29*60000</f><v>2220000</v>');
  assert.equal(text(final,'I29'),'Hitung awal 2 Nov: 40');
  assert.match(final,/<c r="G30" s="4"><f>SUM\(G29:G29\)<\/f><v>37<\/v><\/c>/);
  // Sebelum dihitung: kosong dan berketerangan; sesudahnya saldo berjalan biasa.
  for(const sheet of [master,day1]){assert.equal(cellAt(sheet,'G29'),null);assert.equal(text(sheet,'I29'),'Belum dihitung');}
  assert.equal(cellAt(day2,'G29'),'<f>40+D29-E29+F29</f><v>35</v>');
  assert.equal(cellAt(day3,'C29'),'<v>35</v>');assert.equal(cellAt(day3,'G29'),'<f>C29+D29-E29+F29</f><v>37</v>');assert.equal(text(day3,'I29'),null);
  // Daftar mutasi: hitungan gudang bukan barang masuk; pindah stok satu baris.
  const listed=title=>{const at=final.indexOf(title);return at<0?null:final.slice(at,final.indexOf('</row>',final.indexOf('KETERANGAN',at)+200));};
  assert.match(final,/IV\. BARANG MASUK/);assert.match(final,/V\. PINDAH STOK/);assert.match(final,/VI\. BARANG KELUAR/);assert.match(final,/VII\. PEMBATALAN \/ KOREKSI POSITIF/);
  assert(final.includes('2026-11-01 — Display: Penerimaan'));assert(final.includes('2026-11-03 — Gudang: Kiriman pemasok'));
  assert(!final.includes('Gudang: Hitung gudang'),'hitungan pertama gudang tidak dicatat sebagai barang masuk');
  assert(final.includes('2026-11-02 — Gudang → Display: Isi display'));
  assert.equal((final.match(/Gudang → Display/g)||[]).length,1);
  assert(listed('V. PINDAH STOK'));
  const ledger=f.get('xl/worksheets/sheet7.xml');
  assert.match(ledger,/LOKASI/);assert.match(ledger,/>Gudang</);assert.match(ledger,/>Display</);
});
test('stok gudang di luar periode hitungan: kosong sebelum dihitung, saldo awal sesudahnya',async()=>{
  const before=merchandiseMonthlyWorkbook({...split,to:'2026-11-01'});
  assert.equal(before.warehouseClosing,0);
  const f=await unpack(before.blob);
  assert.equal(text(f.get('xl/worksheets/sheet3.xml'),'I29'),'Belum dihitung');
  const after=merchandiseMonthlyWorkbook({...split,from:'2026-11-03',to:'2026-11-03'});
  const g=await unpack(after.blob),final=g.get('xl/worksheets/sheet3.xml');
  assert.equal(cellAt(final,'C29'),'<v>35</v>');assert.equal(cellAt(final,'G29'),'<f>C29+D29-E29+F29</f><v>37</v>');
  assert.equal(text(final,'I29'),null,'dihitung sebelum periode: tanpa keterangan hitung awal');
});
test('data gudang yang tidak konsisten ditolak, bukan ditebak',()=>{
  assert.throws(()=>merchandiseMonthlyWorkbook({...split,stock:[{...product,stock_qty:8,warehouse_qty:null}]}),/belum dihitung/);
  assert.throws(()=>merchandiseMonthlyWorkbook({...split,stock:[{...product,stock_qty:8,warehouse_qty:30}]}),/tidak sesuai/);
  const twice=[...split.movements,{...split.movements[2],created_at:'2026-11-03T05:00:00Z'}];
  assert.throws(()=>merchandiseMonthlyWorkbook({...split,movements:twice}),/lebih dari sekali/);
  assert.throws(()=>merchandiseMonthlyWorkbook({...split,movements:Array.from({length:10000},()=>split.movements[0])}),/batas API/);
});
