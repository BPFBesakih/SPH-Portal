import {createOfficialMerchandiseXlsx} from './merchandise-official-xlsx.js';

// Mengikuti struktur rekap stok: MASTER, lembar harian, dan MASTER AKHIR.
// Saldo 31 Oktober 2026 adalah titik awal yang telah direkonsiliasi di database;
// transaksi historis sebelum tanggal tersebut tidak tersedia secara terstruktur.
const BASELINE='2026-10-31';
const bulan=['JANUARI','FEBRUARI','MARET','APRIL','MEI','JUNI','JULI','AGUSTUS','SEPTEMBER','OKTOBER','NOVEMBER','DESEMBER'];
const dateLabel=value=>{const [y,m,d]=value.split('-');return Number(d)+' '+bulan[Number(m)-1]+' '+y;};
const periodLabel=(from,to)=>{const [a,b,c]=from.split('-'),[d,e,f]=to.split('-');return Number(c)+' - '+Number(f)+' '+bulan[Number(b)-1]+' '+a;};
const DAY_MS=86400000;
const dateOK=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
  Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const witaDay=value=>{
  const n=Date.parse(value||'');
  if(!Number.isFinite(n))throw new Error('Tanggal mutasi stok tidak valid.');
  return new Date(n+8*3600000).toISOString().slice(0,10);
};
const dayList=(from,to)=>{
  const days=[];
  for(let n=Date.parse(from+'T00:00:00Z');n<=Date.parse(to+'T00:00:00Z');n+=DAY_MS)
    days.push(new Date(n).toISOString().slice(0,10));
  return days;
};
const n=value=>Number(value||0);
const sum=(rows,key)=>rows.reduce((acc,row)=>acc+n(row[key]),0);
const columns=[
  {key:'no',header:'NO',width:7,kind:'number'},
  {key:'name',header:'JENIS BARANG',width:34},
  {key:'opening',header:'STOK DISPLAY (Pcs)',width:19,kind:'number'},
  {key:'openingValue',header:'NILAI STOK AWAL (Rp)',width:24,kind:'money'},
  {key:'sold',header:'TERJUAL (Pcs)',width:17,kind:'number'},
  {key:'revenue',header:'TOTAL PENJUALAN (Rp)',width:24,kind:'money'},
  {key:'closing',header:'STOK AKHIR (Pcs)',width:20,kind:'number'},
  {key:'closingValue',header:'NILAI STOK AKHIR (Rp)',width:25,kind:'money'},
  {key:'note',header:'KET',width:36},
  {key:'received',header:'BARANG MASUK',width:17,kind:'number'},
  {key:'returned',header:'BATAL / RETUR',width:17,kind:'number'},
  {key:'adjustment',header:'KOREKSI (+/-)',width:18,kind:'number'}
];
const summary=rows=>[
  {label:'STOK DISPLAY',value:rows[0]?.unitCost===null?null:sum(rows,'openingValue'),kind:'money'},
  {label:'TERJUAL',value:sum(rows,'revenue'),kind:'money'},
  {label:'STOK AKHIR',value:rows[0]?.unitCost===null?null:sum(rows,'closingValue'),kind:'money'}
];
const stockTotals=rows=>Object.fromEntries(
  ['opening','openingValue','sold','revenue','closing','closingValue','received','returned','adjustment'].map(key=>[key,sum(rows,key)])
);
const section=(title,movements)=>({
  title,
  columns:[
    {key:'no',header:'NO',width:7,kind:'number'},
    {key:'date',header:'TANGGAL / WAKTU WITA',width:25},
    {key:'name',header:'JENIS BARANG',width:34},
    {key:'qty',header:'JUMLAH (Pcs)',width:18,kind:'number'},
    {key:'reason',header:'KETERANGAN',width:55,kind:'notes'}
  ],
  rows:movements.map((m,i)=>({no:i+1,date:m.witaDay,name:m.product_name,qty:Math.abs(n(m.quantity_delta)),reason:m.reason||m.kind}))
});
const reportSheet=(title,period,rows,movements)=>{
  const arrivals=movements.filter(m=>m.kind==='IN'||m.kind==='INITIAL');
  const exits=movements.filter(m=>m.kind==='SALE'||(m.kind==='ADJUST'&&n(m.quantity_delta)<0));
  const returns=movements.filter(m=>m.kind==='VOID'||(m.kind==='ADJUST'&&n(m.quantity_delta)>0));
  return {
    name:title,official:true,title:'LAPORAN STOK DAN BARANG MASUK '+period,
    subtitle:'BPFKSPA BESAKIH | Perhitungan berdasarkan transaksi yang tercatat di SPH-Portal.',
    note:'Saldo awal berasal dari posisi 31 Oktober 2026. Perubahan setelahnya mengikuti mutasi sistem.',
    summary:summary(rows),columns,rows,total:stockTotals(rows),
    sections:[section('III. BARANG MASUK',arrivals),section('IV. BARANG KELUAR',exits),section('V. PEMBATALAN / KOREKSI POSITIF',returns)]
  };
};
export function merchandiseMonthlyWorkbook({from,to,stock=[],sales=[],movements=[],canCost=false,today,logoBytes=null}={}){
  const current=today||new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  if(!dateOK(from)||!dateOK(to)||!dateOK(current)||from>to)throw new Error('Rentang tanggal laporan tidak valid.');
  if(dayList(from,to).length>31)throw new Error('Periode ekspor maksimal 31 hari.');
  if(from.slice(0,7)!==to.slice(0,7))throw new Error('Laporan format harian harus berada dalam satu bulan yang sama.');
  if(from<=BASELINE)throw new Error('Transaksi harian sebelum 1 November 2026 belum diimpor; laporan lengkap tidak dapat dibuat dari saldo akhir Oktober saja.');
  if(to>current)throw new Error('Tanggal akhir tidak boleh melebihi hari ini.');
  if(!stock.length)throw new Error('Katalog barang belum tersedia.');
  if(movements.length>=2000)throw new Error('Jumlah mutasi mencapai batas API (2.000). Ekspor ditunda agar laporan tidak terpotong.');
  const dates=dayList(from,to),dateSet=new Set(dates);
  const products=[...stock].sort((a,b)=>String(a.sku).localeCompare(String(b.sku),'id'));
  if(products.some(p=>p.stock_qty===null||!Number.isSafeInteger(Number(p.stock_qty))))
    throw new Error('Masih ada barang yang belum memiliki saldo stok valid.');
  const bySku=new Map(products.map(p=>[p.sku,p]));
  const movementsByDay=new Map();
  const afterFrom=new Map(products.map(p=>[p.sku,0]));
  const detailed=[];
  for(const raw of movements){
    const m={...raw,witaDay:witaDay(raw.created_at)};
    if(!bySku.has(m.sku))throw new Error('Mutasi untuk SKU tidak ditemukan: '+m.sku);
    const delta=Number(m.quantity_delta);
    if(!Number.isSafeInteger(delta))throw new Error('Jumlah mutasi tidak valid: '+m.sku);
    if(m.witaDay>=from)afterFrom.set(m.sku,afterFrom.get(m.sku)+delta);
    if(!dateSet.has(m.witaDay))continue;
    detailed.push(m);
    if(!movementsByDay.has(m.witaDay))movementsByDay.set(m.witaDay,new Map());
    const map=movementsByDay.get(m.witaDay);
    if(!map.has(m.sku))map.set(m.sku,{sold:0,received:0,returned:0,adjustment:0});
    const item=map.get(m.sku);
    if(m.kind==='SALE')item.sold-=delta;
    else if(m.kind==='INITIAL'||m.kind==='IN')item.received+=delta;
    else if(m.kind==='VOID')item.returned+=delta;
    else if(m.kind==='ADJUST')item.adjustment+=delta;
    else throw new Error('Jenis mutasi belum didukung pada ekspor: '+m.kind);
  }
  const revenueByDay=new Map();
  const paid=sales.filter(s=>s.status==='COMPLETED');
  for(const sale of paid){
    if(!dateSet.has(sale.sold_on))continue;
    if(!revenueByDay.has(sale.sold_on))revenueByDay.set(sale.sold_on,new Map());
    for(const item of sale.items||[]){
      const revenue=revenueByDay.get(sale.sold_on);
      revenue.set(item.sku,n(revenue.get(item.sku))+n(item.subtotal));
    }
  }
  const opening=new Map(products.map(p=>{
    const balance=n(p.stock_qty)-afterFrom.get(p.sku);
    if(balance<0)throw new Error('Saldo historis negatif untuk '+p.sku+'; data mutasi perlu direkonsiliasi.');
    return [p.sku,balance];
  }));
  const makeRows=(start,end,activity,revenue)=>{
    return products.map((p,i)=>{
      const q=activity?.get(p.sku)||{sold:0,received:0,returned:0,adjustment:0};
      const c=n(end.get(p.sku)),o=n(start.get(p.sku));
      const unitCost=canCost?n(p.buy_price):null;
      const note=q.adjustment?'Ada koreksi stok':q.returned?'Ada pembatalan/retur':'';
      return {no:i+1,sku:p.sku,name:p.name,opening:o,
        openingValue:canCost?o*unitCost:null,
        sold:q.sold,revenue:n(revenue?.get(p.sku)),
        closing:c,closingValue:canCost?c*unitCost:null,
        note,received:q.received,returned:q.returned,adjustment:q.adjustment,
        unitCost};
    });
  };
  const empty=()=>new Map();
  const baseline=makeRows(opening,opening,empty(),empty());
  const dailySheets=[],totalsBySku=new Map(products.map(p=>[p.sku,{sold:0,received:0,returned:0,adjustment:0}])),revenues=new Map();
  let running=new Map(opening);
  for(const day of dates){
    const begin=new Map(running),changes=movementsByDay.get(day)||empty(),revenue=revenueByDay.get(day)||empty();
    for(const p of products){
      const q=changes.get(p.sku)||{sold:0,received:0,returned:0,adjustment:0};
      const balance=running.get(p.sku)-q.sold+q.received+q.returned+q.adjustment;
      if(balance<0)throw new Error('Saldo negatif pada '+day+' untuk '+p.sku+'.');
      running.set(p.sku,balance);
      const acc=totalsBySku.get(p.sku);
      for(const key of ['sold','received','returned','adjustment'])acc[key]+=q[key];
      revenues.set(p.sku,n(revenues.get(p.sku))+n(revenue.get(p.sku)));
    }
    const rows=makeRows(begin,running,changes,revenue);
    dailySheets.push(reportSheet(String(Number(day.slice(8))),dateLabel(day),rows,detailed.filter(m=>m.witaDay===day)));
  }
  const summaryRows=makeRows(opening,running,totalsBySku,revenues);
  const expected=products.reduce((acc,p)=>acc+n(p.stock_qty)-[...movements].filter(m=>m.sku===p.sku&&witaDay(m.created_at)>to).reduce((s,m)=>s+n(m.quantity_delta),0);
  if(sum(summaryRows,'closing')!==expected)
    throw new Error('Total stok periode tidak sesuai mutasi; ekspor dibatalkan.');
  const salesRows=paid.flatMap(s=>(s.items||[]).map(i=>({
    date:s.sold_on,no:s.sale_no,method:s.payment_method,sku:i.sku,name:i.product_name,qty:i.quantity,
    sell_price:i.unit_price,subtotal:i.subtotal,...(canCost?{cost:i.unit_cost,profit:n(i.subtotal)-n(i.unit_cost)*n(i.quantity)}:{})
  })));
  const saleColumns=[
    {key:'date',header:'TANGGAL',kind:'date'},{key:'no',header:'NOMOR TRANSAKSI',width:26},
    {key:'method',header:'PEMBAYARAN'},{key:'sku',header:'SKU'},
    {key:'name',header:'JENIS BARANG',width:35},{key:'qty',header:'JUMLAH',kind:'number'},
    {key:'sell_price',header:'HARGA JUAL',kind:'money'},{key:'subtotal',header:'TOTAL PENJUALAN',kind:'money'},
    ...(canCost?[{key:'cost',header:'HARGA MODAL',kind:'money'},{key:'profit',header:'LABA KOTOR',kind:'money'}]:[])
  ];
  const movementSheet={
    name:'Mutasi Stok',
    columns:[
      {key:'created_at',header:'WAKTU (WITA)',kind:'datetime',width:24},
      {key:'sku',header:'SKU'},{key:'product_name',header:'JENIS BARANG',width:35},
      {key:'kind',header:'JENIS MUTASI'},{key:'quantity_delta',header:'PERUBAHAN',kind:'number'},
      {key:'balance_before',header:'SALDO SEBELUM',kind:'number'},
      {key:'balance_after',header:'SALDO SESUDAH',kind:'number'},
      {key:'reason',header:'KETERANGAN',kind:'notes',width:55}
    ],rows:detailed
  };
  const sheets=[
    reportSheet('MASTER','SALDO AWAL '+dateLabel(from),baseline,[]),
    ...dailySheets,
    reportSheet('MASTER AKHIR',periodLabel(from,to),summaryRows,detailed),
    {name:'Penjualan',columns:saleColumns,rows:salesRows},
    movementSheet
  ];
  const blob=createOfficialMerchandiseXlsx(sheets,{logoBytes});
  return {blob,filename:'laporan-stok-merchandise-'+from+'-sd-'+to+'.xlsx',count:salesRows.length,
    days:dates.length,products:products.length,totalOpening:sum(summaryRows,'opening'),
    totalClosing:sum(summaryRows,'closing'),salesRevenue:sum(summaryRows,'revenue'),sheetCount:sheets.length};
}
