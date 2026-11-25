// Laporan barang titipan UMKM: Ekspor Penjualan Bulanan, Ekspor Stok Bulanan, Detail
// Transaksi, rekap halaman Laporan, dan lembar cetak tanda terima/takeout.
import test from 'node:test';
import assert from 'node:assert/strict';
import {merchandiseSalesData,merchandiseSalesWorkbook} from '../public/merchandise-sales-xlsx.js';
import {merchandiseMonthlyWorkbook} from '../public/merchandise-report-xlsx.js';
import {umkmSalesSummary,detailWorkbookSheets,umkmDocSheet,stockActions,saleProductOptions,pricePreview} from '../public/merchandise.js';
import {sample} from './merchandise-sales-xlsx.test.mjs';

const unpack=async blob=>{
  const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),decoder=new TextDecoder(),files=new Map();
  for(let pos=0;pos+30<=bytes.length&&view.getUint32(pos,true)===0x04034b50;){
    const size=view.getUint32(pos+18,true),n=view.getUint16(pos+26,true),extra=view.getUint16(pos+28,true),start=pos+30+n+extra;
    files.set(decoder.decode(bytes.slice(pos+30,pos+30+n)),decoder.decode(bytes.slice(start,start+size)));pos=start+size;
  }
  return files;
};
const cellText=(xml,ref)=>xml.match(new RegExp(`<c r="${ref}"[^>]*>(?:<f>([^<]*)</f>)?(?:<v>([^<]*)</v>|<is><t[^>]*>([^<]*)</t></is>)`))?.slice(1).filter(v=>v!==undefined);
const K=['p-kopi','Kopi Kintamani Bu Sari'],D=['p-dupa','Dupa Wangi Bali'];
const stock=[
  {sku:'MER-001',name:'Kaos Besakih',sell_price:90000,buy_price:60000},
  {sku:'MER-002',name:'Topi Besakih',sell_price:50000,buy_price:30000},
  {sku:'UMKM-KOPI-01',name:'Kopi Bubuk 250 g',sell_price:15000,buy_price:12500,umkm_partner_id:K[0],umkm_partner_name:K[1],is_active:1},
  {sku:'UMKM-KOPI-02',name:'Kopi Biji 500 g',sell_price:16000,buy_price:13000,umkm_partner_id:K[0],umkm_partner_name:K[1],is_active:1},
  {sku:'UMKM-DUPA-01',name:'Dupa Wangi Cendana',sell_price:3300,buy_price:2700,umkm_partner_id:D[0],umkm_partner_name:D[1],is_active:1},
  {sku:'UMKM-DUPA-02',name:'Dupa lama',sell_price:3000,buy_price:2500,umkm_partner_id:D[0],umkm_partner_name:D[1],is_active:0}
];
const line=(sku,quantity,unit_price,unit_cost,partner)=>({sku,product_name:stock.find(p=>p.sku===sku).name,quantity,unit_price,unit_cost,subtotal:quantity*unit_price,
  ...(partner?{umkm_partner_id:partner[0],umkm_partner_name:partner[1],umkm_markup_pct:20}:{})});
const sales=[
  {id:'a',sale_no:'MR-1',sold_on:'2026-11-01',status:'COMPLETED',payment_method:'TUNAI',items:[line('MER-001',1,90000,60000),line('UMKM-KOPI-01',2,15000,12500,K)]},
  {id:'b',sale_no:'MR-2',sold_on:'2026-11-02',status:'COMPLETED',payment_method:'QRIS',items:[line('UMKM-KOPI-02',3,16000,13000,K),line('UMKM-DUPA-01',5,3300,2700,D)]},
  {id:'c',sale_no:'MR-3',sold_on:'2026-11-03',status:'COMPLETED',payment_method:'CARD',items:[line('MER-002',2,50000,30000),line('UMKM-KOPI-01',1,15000,12500,K)]},
  {id:'d',sale_no:'MR-4',sold_on:'2026-11-03',status:'VOID',payment_method:'TUNAI',items:[line('UMKM-KOPI-01',1,15000,12500,K)]}
].map(s=>({...s,total:s.items.reduce((n,i)=>n+i.subtotal,0),cost_total:s.items.reduce((n,i)=>n+i.unit_cost*i.quantity,0)}));
const summary={revenue:299500,cost:210000,units_sold:14,transaction_count:3};
const umkmLosses=[{sku:'UMKM-KOPI-02',product_name:'Kopi Biji 500 g',umkm_partner_id:K[0],umkm_partner_name:K[1],quantity_delta:-1,unit_cost:13000,created_at:'2026-11-02T03:00:00.000Z'}];
const options={...sample,stock,sales,summary,umkmLosses,from:'2026-11-01',to:'2026-11-03',today:'2026-11-25',canCost:true};

test('penjualan bulanan: barang UMKM keluar dari II, masuk rekap per mitra dengan hak UMKM dan keuntungan BP',()=>{
  const d=merchandiseSalesData(options);
  assert.deepEqual(d.totals,{qty:3,revenue:190000,cost:120000},'II. PENJUALAN hanya merchandise BP');
  assert.deepEqual(d.products.map(p=>p.sku),['MER-001','MER-002']);
  assert.deepEqual(d.umkm.totals,{qty:11,revenue:109500,cost:90000,markup:18000,lossQty:1,loss:13000});
  assert.deepEqual(d.umkm.groups.map(g=>[g.name,g.items.map(i=>i.sku),g.losses.map(i=>i.sku)]),[['Dupa Wangi Bali',['UMKM-DUPA-01'],[]],['Kopi Kintamani Bu Sari',['UMKM-KOPI-01','UMKM-KOPI-02'],['UMKM-KOPI-02']]],
    'barang UMKM nonaktif tanpa transaksi tidak tercantum');
  assert.deepEqual(d.payments,{cash:120000,qris:64500,transfer:0,card:115000,other:0},'pembayaran memuat barang BP dan UMKM');
  assert.throws(()=>merchandiseSalesData({...options,summary:{...summary,revenue:190000}}),/Rincian laporan/);
  assert.throws(()=>merchandiseSalesData({...options,sales:[{...sales[0],items:[{...sales[0].items[1],umkm_partner_id:undefined}]}],summary:undefined}),/tanpa mitra/);
});

test('penjualan bulanan: rekap I, bagian III per mitra, dan IV metode pembayaran tersusun dan berumus',async()=>{
  const files=await unpack(merchandiseSalesWorkbook(options).blob),final=files.get('xl/worksheets/sheet5.xml');
  const rekap=[['A20','PENJUALAN BARANG UMKM','D20','D96',109500],['A21','HAK UMKM (DIBAYARKAN KEUANGAN)','D21','E115',103000],['A22','KEUNTUNGAN BP DARI BARANG UMKM','D22','F115',6500],
    ['A26','TOTAL LABA BP','D26','D19+D22',76500],['A27','TOTAL UANG DITERIMA','D27','D17+D20',299500]];
  for(const [labelRef,label,valueRef,formula,value] of rekap){
    assert.deepEqual(cellText(final,labelRef),[label]);
    const [f,v]=cellText(final,valueRef);
    if(formula!=='D96')assert.equal(f,formula,label);
    assert.equal(Number(v),value,label);
  }
  assert.deepEqual(cellText(final,'D20'),['D115','109500']);
  for(const [ref,value] of [['D23',18000],['D24',1500],['D25',-13000]])assert.equal(Number(cellText(final,ref)[0]),value,ref);
  assert.deepEqual(cellText(final,'A29'),['II. PENJUALAN']);
  assert.deepEqual(cellText(final,'A104'),['III. PENJUALAN BARANG UMKM (TITIPAN)']);
  assert.deepEqual(cellText(final,'E106'),['HAK UMKM (Rp.)']);
  assert.deepEqual(cellText(final,'A107'),['UMKM: Dupa Wangi Bali']);
  assert.deepEqual(cellText(final,'B113'),['Kopi Biji 500 g — hilang/rusak, ditanggung BP']);
  assert.deepEqual(cellText(final,'E114'),['SUM(E111:E113)','89500']);
  assert.deepEqual(cellText(final,'A115'),['JUMLAH SEMUA MITRA']);
  assert.deepEqual(cellText(final,'C115'),['C109+C114','12']);
  assert.deepEqual(cellText(final,'A117'),['IV. METODE PEMBAYARAN']);
  assert.deepEqual(cellText(final,'C123'),['SUM(C119:C122)','299500']);
  assert.match(final,/<dimension ref="A1:G136"\/>/);
  assert.match(final,/<mergeCell ref="A107:G107"\/>/);
  assert.match(files.get('xl/drawings/drawing5.xml'),/<xdr:row>125<\/xdr:row>/,'tanda tangan ikut turun sebanyak baris tambahan');
  // Lembar harian memakai susunan yang sama sehingga MASTER AKHIR bisa menjumlah antarlembar.
  assert.deepEqual(cellText(files.get('xl/worksheets/sheet3.xml'),'C112'),['3']);
  assert.match(final,/<f>SUM\(&apos;1&apos;!E113,&apos;2&apos;!E113,&apos;3&apos;!E113\)<\/f><v>13000<\/v>/);
});

test('penjualan bulanan tanpa barang UMKM pada periode: susunan resmi tidak berubah',async()=>{
  const files=await unpack(merchandiseSalesWorkbook({...sample}).blob),final=files.get('xl/worksheets/sheet5.xml');
  assert.doesNotMatch([...files.values()].join(''),/UMKM/);
  assert.deepEqual(cellText(final,'A96'),['III. METODE PEMBAYARAN']);
  const onlyCatalog=await unpack(merchandiseSalesWorkbook({...sample,stock:[...sample.stock,stock[2]]}).blob);
  assert.doesNotMatch([...onlyCatalog.values()].join(''),/UMKM/,'barang UMKM di katalog tanpa penjualan tidak memunculkan bagian III');
});

test('stok bulanan: barang UMKM bukan aset BP, punya bagian VIII per mitra, dan kolom pemilik',async()=>{
  const P=(sku,name,stock_qty,warehouse_qty,buy_price)=>({sku,id:sku,name,stock_qty,warehouse_qty,buy_price,sell_price:buy_price*2});
  const bp=[P('MER-001','FLASHDISK',8,0,60000)];
  const umkm=[{...P('UMKM-KOPI-01','Kopi Bubuk',5,0,12500),umkm_partner_id:K[0],umkm_partner_name:K[1]}];
  const mv=(sku,kind,quantity_delta,created_at,extra={})=>({sku,product_name:sku,kind,quantity_delta,created_at,reason:kind,location:'DISPLAY',...extra});
  const movements=[mv('MER-001','SALE',-2,'2026-11-02T06:00:00Z'),
    mv('UMKM-KOPI-01','IN',9,'2026-11-01T02:00:00Z'),mv('UMKM-KOPI-01','SALE',-3,'2026-11-02T02:00:00Z'),
    mv('UMKM-KOPI-01','ADJUST',-1,'2026-11-02T03:00:00Z',{umkm_loss_borne_by:'BP'}),mv('UMKM-KOPI-01','TAKEOUT',-2,'2026-11-03T03:00:00Z')].reverse();
  const sales=[{sold_on:'2026-11-02',status:'COMPLETED',sale_no:'MR-1',payment_method:'TUNAI',items:[
    {sku:'MER-001',product_name:'FLASHDISK',quantity:2,unit_price:120000,unit_cost:60000,subtotal:240000},
    {sku:'UMKM-KOPI-01',product_name:'Kopi Bubuk',quantity:3,unit_price:15000,unit_cost:12500,subtotal:45000,umkm_partner_id:K[0],umkm_partner_name:K[1]}]}];
  const base={from:'2026-11-01',to:'2026-11-03',today:'2026-11-05',canCost:true};
  const without=merchandiseMonthlyWorkbook({...base,stock:bp,sales:[{...sales[0],items:[sales[0].items[0]]}],movements:movements.filter(m=>m.sku==='MER-001')});
  const r=merchandiseMonthlyWorkbook({...base,stock:[...bp,...umkm],sales,movements});
  assert.deepEqual([r.products,r.totalClosing,r.salesRevenue,r.umkmClosing],[1,8,240000,5]);
  assert.deepEqual([without.totalClosing,without.salesRevenue,without.umkmClosing],[8,240000,null]);
  const files=await unpack(r.blob),final=files.get('xl/worksheets/sheet5.xml');
  assert.doesNotMatch(final.slice(0,final.indexOf('VIII.')),/Kopi Bubuk/,'tidak ada di tabel resmi I–VII');
  assert.match(final,/VIII\. STOK BARANG UMKM \(TITIPAN, BUKAN MILIK BP\)/);
  assert.match(final,/UMKM: Kopi Kintamani Bu Sari/);
  assert.match(final,/<f>C\d+\+D\d+-E\d+-F\d+\+G\d+<\/f><v>5<\/v>/);
  assert.match(final,/Selisih ditanggung BP −1/);
  assert.match(files.get('xl/worksheets/sheet6.xml'),/PEMILIK/);
  assert.match(files.get('xl/worksheets/sheet6.xml'),/UMKM Kopi Kintamani Bu Sari/);
  assert.match(files.get('xl/worksheets/sheet7.xml'),/selisih ditanggung BP/);
  assert.doesNotMatch([...(await unpack(without.blob)).values()].join(''),/UMKM|PEMILIK/);
  assert.throws(()=>merchandiseMonthlyWorkbook({...base,stock:[...bp,{...umkm[0],stock_qty:1}],sales,movements}),/Saldo historis barang UMKM negatif/);
});

test('titipan yang masuk setelah periode tidak mengubah stok maupun detail Excel periode lama',async()=>{
  const bp={...stock[0],stock_qty:3,warehouse_qty:0};
  const later={...stock[2],created_at:'2026-11-03T16:30:00.000Z',stock_qty:4,warehouse_qty:0};
  const move={sku:later.sku,kind:'IN',quantity_delta:4,created_at:later.created_at,reason:'Terima barang',location:'DISPLAY'};
  const period={from:'2026-11-01',to:'2026-11-03',today:'2026-11-25',stock:[bp],sales:[],movements:[],canCost:true};
  const original=merchandiseMonthlyWorkbook(period);
  const withNewStock=merchandiseMonthlyWorkbook({...period,stock:[bp,later],movements:[move]});
  assert.equal(withNewStock.umkmClosing,null);
  assert.deepEqual(new Uint8Array(await withNewStock.blob.arrayBuffer()),new Uint8Array(await original.blob.arrayBuffer()));
  assert.deepEqual(detailWorkbookSheets({...period,stock:[bp,later]},true),detailWorkbookSheets(period,true));
  assert.equal(detailWorkbookSheets({...period,to:'2026-11-04',stock:[bp,later]},true)[1].rows[1].sku,later.sku);
});

test('detail transaksi dan rekap halaman Laporan memisahkan barang UMKM per mitra',()=>{
  const report={sales,stock,movements:[{created_at:'2026-11-02T03:00:00Z',sku:'UMKM-KOPI-02',product_name:'Kopi Biji 500 g',kind:'ADJUST',location:'DISPLAY',quantity_delta:-1,balance_after:2,reason:'Pecah',umkm_partner_id:K[0],umkm_partner_name:K[1],umkm_loss_borne_by:'BP'}]};
  const [penjualan,stok,mutasi]=detailWorkbookSheets(report,true);
  assert.deepEqual(penjualan.columns.map(c=>c.header),['Tanggal','Nomor transaksi','Pembayaran','SKU','Nama barang','Pemilik','Qty','Harga jual','Subtotal','Harga beli / harga UMKM','Hak UMKM','Laba kotor / keuntungan BP']);
  const kopi=penjualan.rows.find(r=>r.sku==='UMKM-KOPI-02');
  assert.deepEqual([kopi.owner,kopi.umkmShare,kopi.margin],['UMKM Kopi Kintamani Bu Sari',39000,9000]);
  assert.equal(penjualan.rows.find(r=>r.sku==='MER-001').umkmShare,null);
  assert(stok.columns.some(c=>c.header==='Pemilik')&&mutasi.rows[0].reason.endsWith('selisih ditanggung BP'));
  const bpOnly=detailWorkbookSheets({sales:[sales[0]].map(s=>({...s,items:[s.items[0]]})),stock:stock.slice(0,2),movements:[]},true);
  assert.deepEqual(bpOnly[0].columns.map(c=>c.header),['Tanggal','Nomor transaksi','Pembayaran','SKU','Nama barang','Qty','Harga jual','Subtotal','Harga beli','Laba kotor']);
  const rows=umkmSalesSummary(sales,umkmLosses);
  assert.deepEqual(rows.map(r=>[r.name,r.qty,r.revenue,r.payable,r.profit,r.markup,r.rounding,r.lossQty,r.loss]),[
    ['Dupa Wangi Bali',5,16500,13500,3000,2700,300,0,0],
    ['Kopi Kintamani Bu Sari',6,93000,89500,3500,15300,1200,1,13000]]);
});

test('tampilan: pilihan stok barang UMKM, label penjualan, pratinjau harga, dan lembar cetak',()=>{
  const item={...stock[2],stock_qty:3,warehouse_qty:2,is_active:1};
  assert.deepEqual(stockActions(item,true).map(c=>c.value),['TRANSFER:DISPLAY','TRANSFER:GUDANG','ADJUST:DISPLAY','ADJUST:GUDANG']);
  assert.deepEqual(stockActions({...item,stock_qty:0,warehouse_qty:0},false),[],'tanpa stok dan tanpa izin koreksi: arahkan ke Terima barang');
  assert.match(saleProductOptions([item]).html,/UMKM Kopi Kintamani Bu Sari/);
  assert.equal(pricePreview('13000'),'Harga jual Rp16.000 · keuntungan BP Rp3.000 (20% Rp2.600 + pembulatan Rp400).');
  assert.match(pricePreview(''),/minimal Rp100/);
  const doc={doc_no:'TU-20261125-ABCD1234',kind:'TERIMA',status:'ACTIVE',doc_date:'2026-11-25',counterpart_name:'Ni Made Sari',note:'',
    partner:{code:'KOPI',name:K[1],owner_name:'Ni Made Sari',phone:'0812'},items:[{line_no:1,sku:'UMKM-KOPI-01',product_name:'Kopi Bubuk 250 g',location:'DISPLAY',quantity:10,unit_cost:12500,sell_price:15000}]};
  const html=umkmDocSheet(doc);
  for(const text of ['Tanda Terima Barang Titipan UMKM','TU-20261125-ABCD1234','Kopi Kintamani Bu Sari','Harga UMKM','Rp12.500','Rp15.000','Yang menyerahkan (UMKM)','Yang menerima (Bidang Bisnis)'])assert(html.includes(text),text);
  const takeout=umkmDocSheet({...doc,kind:'TAKEOUT',doc_no:'TO-1',reason:'TIDAK_LAKU',items:doc.items.map(({unit_cost,...i})=>i)});
  for(const text of ['Bukti Takeout Barang Titipan UMKM','Tidak laku','Yang menerima (UMKM)'])assert(takeout.includes(text),text);
  assert(!takeout.includes('Harga UMKM'),'tanpa izin harga modal, kolom harga UMKM tidak dicetak');
});
