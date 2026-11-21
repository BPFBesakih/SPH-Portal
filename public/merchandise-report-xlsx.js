import {createOfficialMerchandiseXlsx} from './merchandise-official-xlsx.js';

// Mengikuti struktur rekap stok: MASTER, lembar harian, dan MASTER AKHIR.
// Saldo 31 Oktober 2026 adalah titik awal yang telah direkonsiliasi di database;
// transaksi historis sebelum tanggal tersebut tidak tersedia secara terstruktur.
//
// Sejak 20 November 2026 stok dipisah: DISPLAY (stock_qty, tempat barang dijual; stok
// lama adalah stok display) dan GUDANG (warehouse_qty). Tabel utama format resmi tetap
// berisi stok display; stok gudang punya tabel sendiri (III). Sebelum dihitung pertama
// kali, stok gudang kosong ("belum dihitung") dan hitungan pertama itu dicatat sebagai
// stok awal gudang, bukan barang masuk.
const BASELINE='2026-10-31';
export const MOVEMENT_LIMIT=10000;
const bulan=['JANUARI','FEBRUARI','MARET','APRIL','MEI','JUNI','JULI','AGUSTUS','SEPTEMBER','OKTOBER','NOVEMBER','DESEMBER'];
const dateLabel=value=>{const [y,m,d]=value.split('-');return Number(d)+' '+bulan[Number(m)-1]+' '+y;};
const shortDate=value=>{const [,m,d]=value.split('-');return Number(d)+' '+bulan[Number(m)-1].slice(0,3).toLowerCase().replace(/^./,c=>c.toUpperCase());};
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
const counted=value=>value!==null&&value!==undefined;
const location=m=>m.location==='GUDANG'?'GUDANG':'DISPLAY';
const locationLabel=value=>value==='GUDANG'?'Gudang':'Display';
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
  ['opening','openingValue','sold','revenue','closing','closingValue','received','returned','adjustment','moved'].map(key=>[key,sum(rows,key)])
);
const warehouseTotals=rows=>Object.fromEntries(['opening','received','moved','adjustment','closing','closingValue'].map(key=>[key,sum(rows,key)]));
const section=(title,movements,describe)=>({
  title,
  columns:[
    {key:'no',header:'NO',width:7,kind:'number'},
    {key:'date',header:'TANGGAL / WAKTU WITA',width:25},
    {key:'name',header:'JENIS BARANG',width:34},
    {key:'qty',header:'JUMLAH (Pcs)',width:18,kind:'number'},
    {key:'reason',header:'KETERANGAN',width:55,kind:'notes'}
  ],
  rows:movements.map((m,i)=>({no:i+1,date:m.witaDay,name:m.product_name,qty:Math.abs(n(m.quantity_delta)),reason:describe(m)}))
});
const atLocation=m=>locationLabel(m.location)+': '+(m.reason||m.kind);
const transferText=m=>(m.location==='DISPLAY'?'Gudang → Display':'Display → Gudang')+': '+(m.reason||m.kind);
const reportSheet=(title,period,rows,warehouse,movements)=>{
  // Hitungan pertama gudang adalah stok awal gudang (tabel III), bukan barang masuk.
  const arrivals=movements.filter(m=>m.kind==='IN'||(m.kind==='INITIAL'&&m.location==='DISPLAY'));
  const transfers=movements.filter(m=>m.kind==='TRANSFER'&&n(m.quantity_delta)>0);
  const exits=movements.filter(m=>m.kind==='SALE'||(m.kind==='ADJUST'&&n(m.quantity_delta)<0));
  const returns=movements.filter(m=>m.kind==='VOID'||(m.kind==='ADJUST'&&n(m.quantity_delta)>0));
  return {
    name:title,official:true,title:'LAPORAN STOK DAN BARANG MASUK '+period,
    subtitle:'BPFKSPA BESAKIH | Perhitungan berdasarkan transaksi yang tercatat di SPH-Portal.',
    note:'Saldo awal berasal dari posisi 31 Oktober 2026. Perubahan setelahnya mengikuti mutasi sistem.',
    summary:summary(rows),columns,rows,total:stockTotals(rows),
    warehouse:{title:'III. STOK GUDANG',rows:warehouse,total:warehouseTotals(warehouse),canCost:rows[0]?.unitCost!==null&&rows[0]?.unitCost!==undefined},
    sections:[section('IV. BARANG MASUK',arrivals,atLocation),section('V. PINDAH STOK',transfers,transferText),
      section('VI. BARANG KELUAR',exits,atLocation),section('VII. PEMBATALAN / KOREKSI POSITIF',returns,atLocation)]
  };
};
const emptyDisplay=()=>({sold:0,received:0,returned:0,adjustment:0,moved:0});
const emptyWarehouse=()=>({received:0,moved:0,adjustment:0});
export function merchandiseMonthlyWorkbook({from,to,stock=[],sales=[],movements=[],canCost=false,today,logoBytes=null}={}){
  const current=today||new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  if(!dateOK(from)||!dateOK(to)||!dateOK(current)||from>to)throw new Error('Rentang tanggal laporan tidak valid.');
  if(dayList(from,to).length>31)throw new Error('Periode ekspor maksimal 31 hari.');
  if(from.slice(0,7)!==to.slice(0,7))throw new Error('Laporan format harian harus berada dalam satu bulan yang sama.');
  if(from<=BASELINE)throw new Error('Transaksi harian sebelum 1 November 2026 belum diimpor; laporan lengkap tidak dapat dibuat dari saldo akhir Oktober saja.');
  if(to>current)throw new Error('Tanggal akhir tidak boleh melebihi hari ini.');
  if(!stock.length)throw new Error('Katalog barang belum tersedia.');
  if(movements.length>=MOVEMENT_LIMIT)throw new Error('Jumlah mutasi mencapai batas API ('+MOVEMENT_LIMIT.toLocaleString('id-ID')+'). Ekspor ditunda agar laporan tidak terpotong.');
  const dates=dayList(from,to),dateSet=new Set(dates);
  const products=[...stock].sort((a,b)=>String(a.sku).localeCompare(String(b.sku),'id'));
  if(products.some(p=>p.stock_qty===null||!Number.isSafeInteger(Number(p.stock_qty))))
    throw new Error('Masih ada barang yang belum memiliki saldo stok valid.');
  if(products.some(p=>counted(p.warehouse_qty)&&!Number.isSafeInteger(Number(p.warehouse_qty))))
    throw new Error('Saldo stok gudang tidak valid.');
  const bySku=new Map(products.map(p=>[p.sku,p]));
  const displayByDay=new Map(),warehouseByDay=new Map();
  const afterFrom=new Map(products.map(p=>[p.sku,0])),warehouseAfterFrom=new Map(products.map(p=>[p.sku,0]));
  const warehouseStart=new Map(),detailed=[];
  const bucket=(map,day,sku,empty)=>{if(!map.has(day))map.set(day,new Map());const days=map.get(day);if(!days.has(sku))days.set(sku,empty());return days.get(sku);};
  for(const raw of movements){
    const m={...raw,witaDay:witaDay(raw.created_at),location:location(raw)};
    if(!bySku.has(m.sku))throw new Error('Mutasi untuk SKU tidak ditemukan: '+m.sku);
    const delta=Number(m.quantity_delta);
    if(!Number.isSafeInteger(delta))throw new Error('Jumlah mutasi tidak valid: '+m.sku);
    if(m.location==='GUDANG'){
      if(!counted(bySku.get(m.sku).warehouse_qty))throw new Error('Ada mutasi gudang untuk barang yang stok gudangnya belum dihitung: '+m.sku);
      if(m.kind==='INITIAL'){
        if(warehouseStart.has(m.sku))throw new Error('Stok awal gudang tercatat lebih dari sekali: '+m.sku);
        warehouseStart.set(m.sku,{day:m.witaDay,count:n(m.balance_after)});
      }else if(m.witaDay>=from)warehouseAfterFrom.set(m.sku,warehouseAfterFrom.get(m.sku)+delta);
    }else if(m.witaDay>=from)afterFrom.set(m.sku,afterFrom.get(m.sku)+delta);
    if(!dateSet.has(m.witaDay))continue;
    detailed.push(m);
    if(m.location==='GUDANG'){
      if(m.kind==='INITIAL')continue;
      const item=bucket(warehouseByDay,m.witaDay,m.sku,emptyWarehouse);
      if(m.kind==='IN')item.received+=delta;
      else if(m.kind==='TRANSFER')item.moved+=delta;
      else if(m.kind==='ADJUST')item.adjustment+=delta;
      else throw new Error('Jenis mutasi gudang belum didukung pada ekspor: '+m.kind);
      continue;
    }
    const item=bucket(displayByDay,m.witaDay,m.sku,emptyDisplay);
    if(m.kind==='SALE')item.sold-=delta;
    else if(m.kind==='INITIAL'||m.kind==='IN')item.received+=delta;
    else if(m.kind==='VOID')item.returned+=delta;
    else if(m.kind==='ADJUST')item.adjustment+=delta;
    else if(m.kind==='TRANSFER')item.moved+=delta;
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
  // Gudang di awal periode: null bila belum dihitung saat itu. Bila dihitung di dalam
  // periode, semua mutasi gudang lain terjadi sesudah hitungan itu.
  const warehouseOpening=new Map(products.map(p=>{
    if(!counted(p.warehouse_qty))return [p.sku,null];
    const start=warehouseStart.get(p.sku);
    if(start&&start.day>=from){
      if(start.count+warehouseAfterFrom.get(p.sku)!==n(p.warehouse_qty))throw new Error('Mutasi gudang '+p.sku+' tidak sesuai saldo; data perlu direkonsiliasi.');
      return [p.sku,null];
    }
    const balance=n(p.warehouse_qty)-warehouseAfterFrom.get(p.sku);
    if(balance<0)throw new Error('Saldo gudang historis negatif untuk '+p.sku+'; data mutasi perlu direkonsiliasi.');
    return [p.sku,balance];
  }));
  const makeRows=(start,end,activity,revenue)=>{
    return products.map((p,i)=>{
      const q=activity?.get(p.sku)||emptyDisplay();
      const c=n(end.get(p.sku)),o=n(start.get(p.sku));
      const unitCost=canCost?n(p.buy_price):null;
      const note=q.adjustment?'Ada koreksi stok':q.returned?'Ada pembatalan/retur':'';
      return {no:i+1,sku:p.sku,name:p.name,opening:o,
        openingValue:canCost?o*unitCost:null,
        sold:q.sold,revenue:n(revenue?.get(p.sku)),
        closing:c,closingValue:canCost?c*unitCost:null,
        note,received:q.received,returned:q.returned,adjustment:q.adjustment,moved:q.moved,
        unitCost};
    });
  };
  // Baris gudang: kosong selama belum dihitung; hari/periode hitungan pertama memakai
  // hitungan itu sebagai dasar (STOK AWAL kosong, keterangan menyebut hitungannya).
  const warehouseRows=(start,end,activity,firstDay,lastDay)=>products.map((p,i)=>{
    const q=activity?.get(p.sku)||emptyWarehouse(),begin=start.get(p.sku),close=end.get(p.sku);
    const first=warehouseStart.get(p.sku),countedHere=first&&first.day>=firstDay&&first.day<=lastDay?first:null;
    const unitCost=canCost?n(p.buy_price):null,known=counted(close);
    const notes=[];
    if(!known)notes.push('Belum dihitung');
    if(countedHere)notes.push('Hitung awal '+shortDate(countedHere.day)+': '+countedHere.count);
    if(known&&q.adjustment)notes.push('Ada koreksi');
    return {no:i+1,sku:p.sku,name:p.name,opening:counted(begin)?begin:null,counted:countedHere?countedHere.count:null,
      received:known?q.received:null,moved:known?-q.moved:null,adjustment:known?q.adjustment:null,
      closing:known?close:null,closingValue:known&&canCost?close*unitCost:null,unitCost,note:notes.join('; ')};
  });
  const empty=()=>new Map();
  const baseline=makeRows(opening,opening,empty(),empty());
  const warehouseBaseline=warehouseRows(warehouseOpening,warehouseOpening,empty(),'','');
  const dailySheets=[],totalsBySku=new Map(products.map(p=>[p.sku,emptyDisplay()])),revenues=new Map();
  const warehouseTotalsBySku=new Map(products.map(p=>[p.sku,emptyWarehouse()]));
  let running=new Map(opening),warehouseRunning=new Map(warehouseOpening);
  for(const day of dates){
    const begin=new Map(running),changes=displayByDay.get(day)||empty(),revenue=revenueByDay.get(day)||empty();
    const warehouseBegin=new Map(warehouseRunning),warehouseChanges=warehouseByDay.get(day)||empty();
    for(const p of products){
      const q=changes.get(p.sku)||emptyDisplay();
      const balance=running.get(p.sku)-q.sold+q.received+q.returned+q.adjustment+q.moved;
      if(balance<0)throw new Error('Saldo negatif pada '+day+' untuk '+p.sku+'.');
      running.set(p.sku,balance);
      const acc=totalsBySku.get(p.sku);
      for(const key of ['sold','received','returned','adjustment','moved'])acc[key]+=q[key];
      revenues.set(p.sku,n(revenues.get(p.sku))+n(revenue.get(p.sku)));
      const w=warehouseChanges.get(p.sku)||emptyWarehouse(),first=warehouseStart.get(p.sku);
      const base=first&&first.day===day?first.count:warehouseRunning.get(p.sku);
      if(!counted(base)){
        if(w.received||w.moved||w.adjustment)throw new Error('Mutasi gudang sebelum stok gudang dihitung: '+p.sku+'.');
        continue;
      }
      const warehouseBalance=base+w.received+w.moved+w.adjustment;
      if(warehouseBalance<0)throw new Error('Saldo gudang negatif pada '+day+' untuk '+p.sku+'.');
      warehouseRunning.set(p.sku,warehouseBalance);
      const wacc=warehouseTotalsBySku.get(p.sku);
      for(const key of ['received','moved','adjustment'])wacc[key]+=w[key];
    }
    const rows=makeRows(begin,running,changes,revenue);
    const wrows=warehouseRows(warehouseBegin,warehouseRunning,warehouseChanges,day,day);
    dailySheets.push(reportSheet(String(Number(day.slice(8))),dateLabel(day),rows,wrows,detailed.filter(m=>m.witaDay===day)));
  }
  const summaryRows=makeRows(opening,running,totalsBySku,revenues);
  const warehouseSummary=warehouseRows(warehouseOpening,warehouseRunning,warehouseTotalsBySku,from,to);
  const later=m=>witaDay(m.created_at)>to;
  const expected=products.reduce((acc,p)=>acc+n(p.stock_qty)-movements.filter(m=>m.sku===p.sku&&location(m)==='DISPLAY'&&later(m)).reduce((s,m)=>s+n(m.quantity_delta),0),0);
  if(sum(summaryRows,'closing')!==expected)
    throw new Error('Total stok periode tidak sesuai mutasi; ekspor dibatalkan.');
  for(const p of products){
    const first=warehouseStart.get(p.sku),end=warehouseRunning.get(p.sku);
    const want=!counted(p.warehouse_qty)||(first&&first.day>to)?null:
      n(p.warehouse_qty)-movements.filter(m=>m.sku===p.sku&&location(m)==='GUDANG'&&m.kind!=='INITIAL'&&later(m)).reduce((s,m)=>s+n(m.quantity_delta),0);
    if((counted(want)?want:null)!==(counted(end)?end:null))throw new Error('Stok gudang periode tidak sesuai mutasi ('+p.sku+'); ekspor dibatalkan.');
  }
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
      {key:'kind',header:'JENIS MUTASI'},{key:'place',header:'LOKASI'},{key:'quantity_delta',header:'PERUBAHAN',kind:'number'},
      {key:'balance_before',header:'SALDO SEBELUM',kind:'number'},
      {key:'balance_after',header:'SALDO SESUDAH',kind:'number'},
      {key:'reason',header:'KETERANGAN',kind:'notes',width:55}
    ],rows:detailed.map(m=>({...m,place:locationLabel(m.location)}))
  };
  const sheets=[
    reportSheet('MASTER','SALDO AWAL '+dateLabel(from),baseline,warehouseBaseline,[]),
    ...dailySheets,
    reportSheet('MASTER AKHIR',periodLabel(from,to),summaryRows,warehouseSummary,detailed),
    {name:'Penjualan',columns:saleColumns,rows:salesRows},
    movementSheet
  ];
  const blob=createOfficialMerchandiseXlsx(sheets,{logoBytes});
  return {blob,filename:'laporan-stok-merchandise-'+from+'-sd-'+to+'.xlsx',count:salesRows.length,
    days:dates.length,products:products.length,totalOpening:sum(summaryRows,'opening'),
    totalClosing:sum(summaryRows,'closing'),warehouseClosing:warehouseSummary.some(p=>counted(p.closing))?sum(warehouseSummary,'closing'):null,
    salesRevenue:sum(summaryRows,'revenue'),sheetCount:sheets.length};
}
