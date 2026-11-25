import {salesTemplate as template} from './merchandise-sales-template.js';

// Format penjualan resmi: template kosong, lembar per hari, rekap periode.
// Seluruh angka berasal dari snapshot transaksi, bukan harga katalog terkini.
const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MONTHS=['JANUARI','FEBRUARI','MARET','APRIL','MEI','JUNI','JULI','AGUSTUS','SEPTEMBER','OKTOBER','NOVEMBER','DESEMBER'];
const enc=new TextEncoder();
const xml=v=>String(v??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const attrs=a=>Object.entries(a).map(([k,v])=>' '+k+'="'+xml(v)+'"').join('');
const dateOK=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const label=d=>Number(d.slice(8))+' '+MONTHS[Number(d.slice(5,7))-1]+' '+d.slice(0,4);
const integer=(value,name,min=0)=>{
  if(value===null||value===undefined||value===''||!Number.isSafeInteger(Number(value))||Number(value)<min)throw new Error(name+' tidak valid. Muat ulang laporan atau periksa data transaksi.');
  return Number(value);
};
const add=(a,b)=>{const n=a+b;if(!Number.isSafeInteger(n))throw new Error('Nilai laporan melebihi batas angka aman.');return n;};
const zero=()=>({qty:0,revenue:0,cost:0});
// Bagian III metode pembayaran: QRIS tetap di baris NON TUNAI, sedangkan TRANSFER dan
// CARD masing-masing punya baris sendiri (keputusan pemilik 20 November 2026).
// LAINNYA hanya ditampilkan bila dipakai pada periode laporan.
export const PAYMENT_ROWS=[['cash','TUNAI'],['qris','NON TUNAI (QRIS)'],['transfer','TRANSFER'],['card','CARD'],['other','LAINNYA']];
const PAYMENT_GROUPS={TUNAI:'cash',QRIS:'qris',TRANSFER:'transfer',CARD:'card',KARTU:'card',LAINNYA:'other'};
const paymentZero=()=>Object.fromEntries(PAYMENT_ROWS.map(([key])=>[key,0]));
const accumulate=(a,b)=>{for(const k of ['qty','revenue','cost'])a[k]=add(a[k],b[k]);};

// Barang titipan UMKM (keputusan tim Bisnis & Keuangan 25 November 2026): baris penjualan
// UMKM tidak masuk II. PENJUALAN, tetapi masuk bagian III. PENJUALAN BARANG UMKM per mitra
// dengan hak UMKM (snapshot harga UMKM) dan keuntungan BP (20% + pembulatan). Koreksi yang
// ditanggung BP (umkmLosses) menambah hak UMKM tanpa uang masuk. Tanpa barang UMKM pada
// periode, susunan laporan sama persis dengan format resmi sebelumnya.
const umkmZero=()=>({qty:0,revenue:0,cost:0,markup:0,lossQty:0,loss:0});
const addUmkm=(a,b)=>{for(const k of ['qty','revenue','cost','markup','lossQty','loss'])a[k]=add(a[k],b[k]);};
const witaDay=value=>{const n=Date.parse(value||'');if(!Number.isFinite(n))throw new Error('Tanggal koreksi barang UMKM tidak valid.');return new Date(n+8*3600000).toISOString().slice(0,10);};
const signed=(value,name)=>{const n=Number(value);if(value===null||value===undefined||value===''||!Number.isSafeInteger(n))throw new Error(name+' tidak valid. Muat ulang laporan atau periksa data transaksi.');return n;};

export function merchandiseSalesData({from,to,stock=[],sales=[],canCost=false,today,summary,umkmLosses=[]}={}){
  const current=today||new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  if(!dateOK(from)||!dateOK(to)||!dateOK(current)||from>to)throw new Error('Rentang tanggal laporan tidak valid.');
  if(from.slice(0,7)!==to.slice(0,7))throw new Error('Pilih tanggal dalam satu bulan yang sama untuk format penjualan harian.');
  if(from<'2026-11-01')throw new Error('Transaksi penjualan sebelum 1 November 2026 belum diimpor ke sistem.');
  if(to>current)throw new Error('Tanggal akhir tidak boleh melebihi hari ini.');
  if(sales.length>=1000)throw new Error('Periode mencapai 1.000 transaksi. Pilih rentang lebih pendek agar laporan dapat diverifikasi.');
  const dates=[];
  for(let t=Date.parse(from+'T00:00:00Z');t<=Date.parse(to+'T00:00:00Z');t+=86400000)dates.push(new Date(t).toISOString().slice(0,10));
  const products=new Map(),umkmProducts=new Map(),daily=new Map(dates.map(d=>[d,{items:new Map(),payments:paymentZero(),totals:zero(),umkm:new Map(),umkmTotals:umkmZero()}]));
  const umkmProduct=(sku,name,partnerId,partnerName)=>{if(!umkmProducts.has(sku))umkmProducts.set(sku,{sku,name:name||sku,partnerId,partnerName:partnerName||''});return umkmProducts.get(sku);};
  for(const p of stock){
    if(!p.sku||products.has(p.sku)||umkmProducts.has(p.sku))throw new Error('SKU katalog kosong atau ganda.');
    if(p.umkm_partner_id){
      // Barang UMKM aktif tetap tercantum walau tidak terjual; yang nonaktif hanya bila ada transaksi.
      if(p.is_active!==0&&p.is_active!==false)umkmProduct(p.sku,p.name,p.umkm_partner_id,p.umkm_partner_name);
      continue;
    }
    products.set(p.sku,{sku:p.sku,name:p.name||p.sku});
  }
  const umkmSkus=new Set(stock.filter(p=>p.umkm_partner_id).map(p=>p.sku));
  const seen=new Set();let transactionCount=0,umkmUsed=false;
  for(const sale of sales){
    if(sale.status!=='COMPLETED')continue;
    if(!dateOK(sale.sold_on))throw new Error('Tanggal transaksi penjualan tidak valid.');
    const day=daily.get(sale.sold_on);if(!day)continue;
    const id=sale.id||sale.sale_no;
    if(!id||seen.has(id))throw new Error('Nomor transaksi kosong atau ganda.');
    seen.add(id);transactionCount++;
    if(!Array.isArray(sale.items)||!sale.items.length)throw new Error('Rincian transaksi tidak lengkap: '+id);
    const amounts=zero(),bp=zero();
    for(const item of sale.items){
      if(!item.sku)throw new Error('SKU rincian transaksi kosong: '+id);
      const qty=integer(item.quantity,'Jumlah barang',1),revenue=integer(item.subtotal,'Subtotal penjualan');
      const cost=canCost?integer(item.unit_cost,'Modal snapshot')*qty:0;
      if(!Number.isSafeInteger(cost))throw new Error('Modal transaksi melebihi batas angka aman.');
      const value={qty,revenue,cost};accumulate(amounts,value);
      if(item.umkm_partner_id||umkmSkus.has(item.sku)){
        if(!item.umkm_partner_id)throw new Error('Baris barang UMKM tanpa mitra: '+id);
        const markup=canCost?Math.round(integer(item.unit_cost,'Harga UMKM snapshot')*integer(item.umkm_markup_pct??20,'Persen keuntungan UMKM')/100)*qty:0;
        umkmProduct(item.sku,item.product_name,item.umkm_partner_id,item.umkm_partner_name);umkmUsed=true;
        if(!day.umkm.has(item.sku))day.umkm.set(item.sku,umkmZero());
        const share={qty,revenue,cost,markup,lossQty:0,loss:0};
        addUmkm(day.umkm.get(item.sku),share);addUmkm(day.umkmTotals,share);
        continue;
      }
      accumulate(bp,value);
      if(!products.has(item.sku))products.set(item.sku,{sku:item.sku,name:item.product_name||item.sku});
      if(!day.items.has(item.sku))day.items.set(item.sku,zero());
      accumulate(day.items.get(item.sku),value);
    }
    if(integer(sale.total,'Total transaksi')!==amounts.revenue)throw new Error('Total dan rincian transaksi berbeda: '+id);
    if(canCost&&sale.cost_total!==undefined&&integer(sale.cost_total,'Total modal')!==amounts.cost)throw new Error('Total modal transaksi berbeda: '+id);
    const method=String(sale.payment_method||'').toUpperCase();
    const group=PAYMENT_GROUPS[method]||null;
    if(!group)throw new Error('Metode pembayaran belum dikenali: '+method);
    day.payments[group]=add(day.payments[group],amounts.revenue);accumulate(day.totals,bp);
  }
  // Koreksi barang UMKM yang ditanggung BP: berkurang = UMKM tetap dibayar; bertambah = barang
  // yang sudah ditanggung ditemukan lagi, mengurangi tanggungan.
  const lossSkus=new Set();
  for(const m of umkmLosses||[]){
    const day=daily.get(witaDay(m.created_at));if(!day)continue;
    if(!m.sku||!m.umkm_partner_id)throw new Error('Koreksi barang UMKM tidak lengkap.');
    const qty=-signed(m.quantity_delta,'Jumlah koreksi barang UMKM'),loss=canCost?qty*integer(m.unit_cost,'Harga UMKM koreksi'):0;
    if(!Number.isSafeInteger(loss))throw new Error('Nilai koreksi barang UMKM melebihi batas angka aman.');
    umkmProduct(m.sku,m.product_name,m.umkm_partner_id,m.umkm_partner_name);umkmUsed=true;lossSkus.add(m.sku);
    if(!day.umkm.has(m.sku))day.umkm.set(m.sku,umkmZero());
    const share={qty:0,revenue:0,cost:0,markup:0,lossQty:qty,loss};
    addUmkm(day.umkm.get(m.sku),share);addUmkm(day.umkmTotals,share);
  }
  const totals=zero(),payments=paymentZero(),items=new Map(),umkmItems=new Map(),umkmTotals=umkmZero();
  for(const day of daily.values()){
    accumulate(totals,day.totals);addUmkm(umkmTotals,day.umkmTotals);
    for(const [sku,value] of day.items){if(!items.has(sku))items.set(sku,zero());accumulate(items.get(sku),value);}
    for(const [sku,value] of day.umkm){if(!umkmItems.has(sku))umkmItems.set(sku,umkmZero());addUmkm(umkmItems.get(sku),value);}
    for(const k of Object.keys(payments))payments[k]=add(payments[k],day.payments[k]);
  }
  if(summary){
    for(const [key,value] of [['revenue',totals.revenue+umkmTotals.revenue],['units_sold',totals.qty+umkmTotals.qty],['transaction_count',transactionCount],...(canCost?[['cost',totals.cost+umkmTotals.cost]]:[])])
      if(integer(summary[key],'Ringkasan '+key)!==value)throw new Error('Rincian laporan belum lengkap atau berubah. Muat ulang sebelum ekspor.');
  }
  // Kelompok per mitra (nama mitra, lalu SKU) agar Keuangan membayar dari subtotal tiap mitra.
  const groups=[];
  if(umkmUsed){
    const byPartner=new Map();
    for(const item of [...umkmProducts.values()].sort((a,b)=>a.sku.localeCompare(b.sku,'id',{numeric:true}))){
      if(!byPartner.has(item.partnerId))byPartner.set(item.partnerId,{id:item.partnerId,name:item.partnerName,items:[],losses:[]});
      const group=byPartner.get(item.partnerId);group.items.push(item);if(lossSkus.has(item.sku))group.losses.push(item);
    }
    groups.push(...[...byPartner.values()].sort((a,b)=>a.name.localeCompare(b.name,'id')||String(a.id).localeCompare(String(b.id))));
  }
  return {from,to,dates,products:[...products.values()].sort((a,b)=>a.sku.localeCompare(b.sku,'id',{numeric:true})),daily,items,totals,payments,canCost,transactionCount,hasOther:payments.other!==0,
    umkm:{active:umkmUsed,groups,items:umkmItems,totals:umkmTotals,hasLoss:lossSkus.size>0}};
}

const textCell=(ref,v,s)=>'<c r="'+ref+'" s="'+s+'" t="inlineStr"><is><t xml:space="preserve">'+xml(v)+'</t></is></c>';
const numberCell=(ref,v,s)=>'<c r="'+ref+'" s="'+s+'"><v>'+v+'</v></c>';
const formulaCell=(ref,f,v,s)=>'<c r="'+ref+'" s="'+s+'"><f>'+xml(f)+'</f><v>'+v+'</v></c>';
const crossSum=(dates,col,row)=>'SUM('+dates.map(d=>"'"+Number(d.slice(8))+"'!"+col+row).join(',')+')';

// Rekap barang UMKM di bagian I (baris tambahan di bawah LABA) dan blok III per mitra.
function umkmRekap(U){
  return [['PENJUALAN BARANG UMKM','D'],['HAK UMKM (DIBAYARKAN KEUANGAN)','E'],['KEUNTUNGAN BP DARI BARANG UMKM','F'],
    ['   - 20% DARI HARGA UMKM','markup'],['   - SELISIH PEMBULATAN HARGA JUAL','rounding'],...(U.hasLoss?[['   - BARANG HILANG/RUSAK DITANGGUNG BP','loss']]:[]),
    ['TOTAL LABA BP','profit'],['TOTAL UANG DITERIMA','received']];
}
function umkmBlock(U){
  const block=[{type:'title',proto:21},{type:'head1',proto:22},{type:'head2',proto:23}];
  for(const group of U.groups){
    block.push({type:'group',proto:96,group});
    group.items.forEach((item,i)=>block.push({type:'item',proto:24,item,no:i+1}));
    group.losses.forEach((item,i)=>block.push({type:'loss',proto:24,item,no:group.items.length+i+1}));
    block.push({type:'subtotal',proto:94,group});
  }
  block.push({type:'total',proto:94},{type:'blank',proto:95});
  return block;
}

function salesSheet(data,name,kind,day,artwork){
  // Template resmi: dua baris pembayaran (98–99) lalu JUMLAH (100). Setiap baris
  // pembayaran tambahan menggeser JUMLAH, blok tanda tangan, dan gambar di bawahnya.
  // Barang UMKM (bila ada pada periode) menambah k baris rekap di bawah LABA dan u baris
  // bagian III di antara JUMLAH penjualan dan metode pembayaran (yang menjadi IV).
  const methods=PAYMENT_ROWS.filter(([key])=>key!=='other'||data.hasOther);
  const count=Math.max(70,data.products.length),offset=count-70,extra=methods.length-2;
  const U=data.umkm?.active?data.umkm:null,rekap=U?umkmRekap(U):[],block=U?umkmBlock(U):[];
  const k=rekap.length,u=block.length;
  const totalRow=94+k+offset,paymentStart=98+k+offset+u,endRow=100+k+offset+u+extra,blockStart=96+k+offset;
  const rows=new Map(),values=new Map(),heights=new Map(),prototypes=new Map(template.rows.map(r=>[Number(r.attrs.r),r]));
  const set=(col,row,value,formula=null,style=null)=>values.set(col+row,{value,formula,style});
  const total=kind==='final'?data.totals:day?.totals||zero(),payments=kind==='final'?data.payments:day?.payments||paymentZero();
  const items=kind==='final'?data.items:day?.items||new Map();
  const umkmItems=kind==='final'?U?.items:day?.umkm,umkmTotal=(kind==='final'?U?.totals:day?.umkmTotals)||umkmZero();
  const days=kind==='final'?data.dates.length:1;
  const title=kind==='master'?'MASTER LAPORAN PENJUALAN':kind==='final'?'LAPORAN PENJUALAN '+Number(data.from.slice(8))+' - '+label(data.to):'TANGGAL '+label(day.date);
  const at=r=>r>=20?r+k:r;
  for(let r=1;r<=19;r++)rows.set(r,prototypes.get(r)||{attrs:{r},cells:[]});
  for(let i=0;i<k;i++)rows.set(20+i,prototypes.get(i===k-1?19:18));
  for(let r=20;r<=23;r++)rows.set(at(r),prototypes.get(r)||{attrs:{r},cells:[]});
  for(let i=0;i<count;i++)rows.set(24+k+i,prototypes.get(24+Math.min(i,69)));
  for(const r of [94,95])rows.set(r+k+offset,prototypes.get(r));
  block.forEach((b,i)=>rows.set(blockStart+i,prototypes.get(b.proto)));
  for(let r=96;r<=100;r++)rows.set(r+k+offset+u+(r===100?extra:0),prototypes.get(r));
  for(let i=0;i<extra;i++)rows.set(100+k+offset+u+i,prototypes.get(99));
  const labels={A14:title,A15:'I. REKAPITULASI PENJUALAN DAN LABA',A16:'URAIAN',D16:'NOMINAL (Rp.)',A17:'PENDAPATAN',A18:'MODAL',A19:'LABA',['A'+at(21)]:'II. PENJUALAN',['A'+at(22)]:'NO',['B'+at(22)]:'JENIS BARANG',['C'+at(22)]:'PENJUALAN',['G'+at(22)]:'RATA-RATA/\nHARI',['C'+at(23)]:'JUMLAH (PCS)',['D'+at(23)]:'NOMINAL (Rp.)',['E'+at(23)]:'MODAL (Rp.)',['F'+at(23)]:'LABA (Rp.)'};
  for(const [ref,value] of Object.entries(labels))set(ref.match(/[A-Z]+/)[0],Number(ref.match(/\d+/)[0]),value);
  for(const [r,col,val] of [[17,'D',total.revenue],[18,'E',total.cost],[19,'F',total.revenue-total.cost]])
    if(r===17||data.canCost)set('D',r,val,col+totalRow);
  if(!data.canCost){set('D',18,'Tidak ditampilkan');set('D',19,'Tidak ditampilkan');}
  for(let i=0;i<count;i++){
    const r=i+24+k,p=data.products[i],v=p?items.get(p.sku)||zero():zero();
    set('A',r,i+1);if(p)set('B',r,p.name);
    const f=col=>kind==='final'?crossSum(data.dates,col,r):null;
    set('C',r,v.qty,f('C'));set('D',r,v.revenue,f('D'));
    if(data.canCost){set('E',r,v.cost,f('E'));set('F',r,v.revenue-v.cost,'D'+r+'-E'+r);}
    set('G',r,v.qty/days,'C'+r+'/'+days,template.averageStyle);
  }
  set('A',totalRow,'JUMLAH');
  for(const [col,value] of [['C',total.qty],['D',total.revenue],...(data.canCost?[['E',total.cost],['F',total.revenue-total.cost]]:[])])set(col,totalRow,value,'SUM('+col+(24+k)+':'+col+(totalRow-1)+')');
  const merges=[];
  if(U){
    // III. PENJUALAN BARANG UMKM per mitra: baris barang, baris hilang/rusak ditanggung BP, JUMLAH mitra.
    const umkmTotalRow=blockStart+u-2,subtotals=[];let groupStart=0;
    block.forEach((b,i)=>{
      const r=blockStart+i;
      if(b.type==='title'){set('A',r,'III. PENJUALAN BARANG UMKM (TITIPAN)');merges.push('A'+r+':G'+r);}
      if(b.type==='head1'){set('A',r,'NO');set('B',r,'JENIS BARANG');set('C',r,'PENJUALAN');set('G',r,'RATA-RATA/\nHARI');merges.push('A'+r+':A'+(r+1),'B'+r+':B'+(r+1),'C'+r+':F'+r,'G'+r+':G'+(r+1));}
      if(b.type==='head2'){set('C',r,'JUMLAH (PCS)');set('D',r,'NOMINAL (Rp.)');set('E',r,'HAK UMKM (Rp.)');set('F',r,'KEUNTUNGAN BP (Rp.)');}
      if(b.type==='group'){set('A',r,'UMKM: '+b.group.name);merges.push('A'+r+':G'+r);groupStart=r+1;}
      if(b.type==='item'||b.type==='loss'){
        const v=umkmItems?.get(b.item.sku)||umkmZero(),loss=b.type==='loss',f=col=>kind==='final'?crossSum(data.dates,col,r):null;
        const text=loss?b.item.name+' — hilang/rusak, ditanggung BP':b.item.name;
        set('A',r,b.no);set('B',r,text,null,'34');if(text.length>32)heights.set(r,'30');
        set('C',r,loss?v.lossQty:v.qty,f('C'));set('D',r,loss?0:v.revenue,loss?null:f('D'));
        if(data.canCost){set('E',r,loss?v.loss:v.cost,f('E'));set('F',r,loss?-v.loss:v.revenue-v.cost,'D'+r+'-E'+r);}
        if(!loss)set('G',r,v.qty/days,'C'+r+'/'+days,template.averageStyle);
      }
      if(b.type==='subtotal'||b.type==='total'){
        const scope=b.type==='total'?null:new Set([...b.group.items,...b.group.losses].map(item=>item.sku));
        const sums=umkmZero();
        for(const [sku,v] of umkmItems||new Map())if(!scope||scope.has(sku))addUmkm(sums,v);
        const first=groupStart,last=r-1;
        set('A',r,b.type==='total'?'JUMLAH SEMUA MITRA':'JUMLAH '+b.group.name.toUpperCase());merges.push('A'+r+':B'+r);
        const formula=col=>b.type==='total'?subtotals.map(row=>col+row).join('+'):'SUM('+col+first+':'+col+last+')';
        for(const [col,value] of [['C',sums.qty+sums.lossQty],['D',sums.revenue],...(data.canCost?[['E',sums.cost+sums.loss],['F',sums.revenue-sums.cost-sums.loss]]:[])])set(col,r,value,formula(col));
        if(b.type==='subtotal')subtotals.push(r);
      }
    });
    // Rekap di bagian I: angka mengikuti JUMLAH semua mitra; rincian 20% dan pembulatan dari snapshot.
    const rounding=umkmTotal.revenue-umkmTotal.cost-umkmTotal.markup,profit=umkmTotal.revenue-umkmTotal.cost-umkmTotal.loss;
    rekap.forEach(([text,key],i)=>{
      const r=20+i;set('A',r,text);merges.push('A'+r+':C'+r,'D'+r+':G'+r);
      if(key==='D')set('D',r,umkmTotal.revenue,'D'+umkmTotalRow);
      else if(key==='received')set('D',r,total.revenue+umkmTotal.revenue,'D17+D20');
      else if(!data.canCost)set('D',r,'Tidak ditampilkan');
      else if(key==='E')set('D',r,umkmTotal.cost+umkmTotal.loss,'E'+umkmTotalRow);
      else if(key==='F')set('D',r,profit,'F'+umkmTotalRow);
      else if(key==='markup')set('D',r,umkmTotal.markup);
      else if(key==='rounding')set('D',r,rounding);
      else if(key==='loss')set('D',r,-umkmTotal.loss);
      else if(key==='profit')set('D',r,total.revenue-total.cost+profit,'D19+D22');
    });
  }
  const pay=96+k+offset+u;
  set('A',pay,U?'IV. METODE PEMBAYARAN':'III. METODE PEMBAYARAN');
  set('A',pay+1,'NO');set('B',pay+1,'JENIS PEMBAYARAN');set('C',pay+1,'NOMINAL (Rp.)');
  for(let i=0;i<methods.length;i++){
    const [key,label]=methods[i],r=paymentStart+i;set('A',r,i+1);set('B',r,label);set('C',r,payments[key],kind==='final'?crossSum(data.dates,'C',r):null);
  }
  set('A',endRow,'JUMLAH');set('C',endRow,total.revenue+umkmTotal.revenue,'SUM(C'+paymentStart+':C'+(endRow-1)+')');
  const body=[];
  for(const [r,proto] of [...rows].sort((a,b)=>a[0]-b[0])){
    const a={...proto.attrs,r};
    // Keep original styles and row dimensions; allow payment labels and new long names to wrap.
    const p=r>=24+k&&r<totalRow?data.products[r-24-k]:null;
    if((p&&p.name.length>32)||heights.has(r))a.ht='30',a.customHeight='1';
    const cells=[];
    for(const col of 'ABCDEFG'){
      const ref=col+r,original=proto.cells.find(c=>c.col===col),v=values.get(ref);
      let style=v?.style??original?.style??'0';
      if(col==='B'&&p)style='34';
      if(!v){cells.push('<c r="'+ref+'" s="'+style+'"/>');continue;}
      cells.push(v.formula?formulaCell(ref,v.formula,v.value,style):typeof v.value==='number'?numberCell(ref,v.value,style):textCell(ref,v.value,style));
    }
    body.push('<row'+attrs(a)+'>'+cells.join('')+'</row>');
  }
  const shiftRow=r=>r>=100?r+k+offset+u+extra:r>=96?r+k+offset+u:r>=94?r+k+offset:r>=20?r+k:r;
  const shiftRef=ref=>ref.replace(/(\d+)/g,x=>String(shiftRow(Number(x))));
  merges.unshift(...template.merges.map(shiftRef));
  const paymentMerges=[];
  for(let i=0;i<extra;i++)paymentMerges.push('C'+(100+k+offset+u+i)+':G'+(100+k+offset+u+i));
  merges.splice(template.merges.length,0,...paymentMerges);
  const lastRow=113+k+offset+u+extra;
  const sheet='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="'+NS+'" xmlns:r="'+REL+'">'+
    '<dimension ref="A1:G'+lastRow+'"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="14.4"/><cols>'+template.columns.map(c=>'<col'+attrs(c)+'/>').join('')+'</cols><sheetData>'+body.join('')+'</sheetData><mergeCells count="'+merges.length+'">'+merges.map(ref=>'<mergeCell ref="'+ref+'"/>').join('')+'</mergeCells><pageMargins'+attrs(template.margins)+'/><pageSetup'+attrs(template.pageSetup)+'/><drawing r:id="rId1"/></worksheet>';
  const date=label(kind==='daily'?day.date:data.to).toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase());
  // Baris drawing dihitung dari 0. Kop, tanda tangan, dan gambar lain digeser
  // persis seperti sel di bawahnya: setelah JUMLAH barang (baris 94) ikut
  // tambahan barang, setelah JUMLAH pembayaran (baris 100) ikut baris pembayaran
  // tambahan (TRANSFER, CARD, dan LAINNYA bila dipakai), dan rekap/bagian UMKM
  // menggeser semua yang ada di bawahnya.
  // Blok tanda tangan di file acuan dimulai tepat di bawah tabel pembayaran,
  // jadi ambang tetap (baris 103) membuat blok kanan menimpa tabel.
  const drawing=artwork.drawing.replace('{{REPORT_DATE}}',xml(date)).replace(/<xdr:row>(\d+)<\/xdr:row>/g,(match,n)=>'<xdr:row>'+(shiftRow(Number(n)+1)-1)+'</xdr:row>');
  return {name,xml:sheet,drawing,last:lastRow};
}

// Same small ZIP/store approach as the portal's existing XLSX exporters.
const crcTable=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function zip(files){
  const chunks=[],directory=[];let offset=0;
  for(const [name,content] of files){
    const filename=enc.encode(name),bytes=typeof content==='string'?enc.encode(content):content;
    let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);crc=(crc^0xffffffff)>>>0;
    const local=new Uint8Array(30+filename.length),l=new DataView(local.buffer);
    l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint32(14,crc,true);l.setUint32(18,bytes.length,true);l.setUint32(22,bytes.length,true);l.setUint16(26,filename.length,true);local.set(filename,30);chunks.push(local,bytes);
    const central=new Uint8Array(46+filename.length),c=new DataView(central.buffer);
    c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint32(16,crc,true);c.setUint32(20,bytes.length,true);c.setUint32(24,bytes.length,true);c.setUint16(28,filename.length,true);c.setUint32(42,offset,true);central.set(filename,46);directory.push(central);offset+=local.length+bytes.length;
  }
  const size=directory.reduce((n,c)=>n+c.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
  return new Blob([...chunks,...directory,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export function merchandiseSalesWorkbook(options={}){
  const artwork=options.artwork;
  if(!artwork?.drawing||!artwork.drawingRels||!Object.keys(artwork.images||{}).length)throw new Error('Pilih file Excel acuan penjualan terlebih dahulu.');
  const data=merchandiseSalesData(options);
  const sheets=[salesSheet(data,'MASTER','master',null,artwork),...data.dates.map(d=>salesSheet(data,String(Number(d.slice(8))),'daily',{...data.daily.get(d),date:d},artwork)),salesSheet(data,'MASTER AKHIR','final',null,artwork)];
  const relationships=items=>'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+items.join('')+'</Relationships>';
  const rel=(id,type,target)=>'<Relationship Id="rId'+id+'" Type="'+REL+'/'+type+'" Target="'+target+'"/>';
  const override=(part,type)=>'<Override PartName="/'+part+'" ContentType="application/vnd.openxmlformats-officedocument.'+type+'+xml"/>';
  const files=[
    ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'+override('xl/workbook.xml','spreadsheetml.sheet.main')+override('xl/styles.xml','spreadsheetml.styles')+override('xl/theme/theme1.xml','theme')+sheets.map((_,i)=>override('xl/worksheets/sheet'+(i+1)+'.xml','spreadsheetml.worksheet')+override('xl/drawings/drawing'+(i+1)+'.xml','drawing')).join('')+'</Types>'],
    ['_rels/.rels',relationships([rel(1,'officeDocument','xl/workbook.xml')])],
    ['xl/workbook.xml','<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="'+NS+'" xmlns:r="'+REL+'"><bookViews><workbookView activeTab="'+(sheets.length-1)+'"/></bookViews><sheets>'+sheets.map((s,i)=>'<sheet name="'+s.name+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets><definedNames>'+sheets.map((s,i)=>'<definedName name="_xlnm.Print_Area" localSheetId="'+i+'">\''+s.name+'\'!$A$1:$G$'+s.last+'</definedName>').join('')+'</definedNames><calcPr calcMode="auto" fullCalcOnLoad="1"/></workbook>'],
    ['xl/_rels/workbook.xml.rels',relationships([...sheets.map((_,i)=>rel(i+1,'worksheet','worksheets/sheet'+(i+1)+'.xml')),rel(sheets.length+1,'styles','styles.xml'),rel(sheets.length+2,'theme','theme/theme1.xml')])],
    ['xl/styles.xml',template.styles],['xl/theme/theme1.xml',template.theme],
    ...Object.entries(artwork.images),
    ...sheets.flatMap((s,i)=>[
      ['xl/worksheets/sheet'+(i+1)+'.xml',s.xml],
      ['xl/worksheets/_rels/sheet'+(i+1)+'.xml.rels',relationships([rel(1,'drawing','../drawings/drawing'+(i+1)+'.xml')])],
      ['xl/drawings/drawing'+(i+1)+'.xml',s.drawing],
      ['xl/drawings/_rels/drawing'+(i+1)+'.xml.rels',artwork.drawingRels]
    ])
  ];
  return {blob:zip(files),filename:'laporan-penjualan-merchandise-'+data.from+'-sd-'+data.to+'.xlsx',days:data.dates.length,products:data.products.length,sheetCount:sheets.length,revenue:data.totals.revenue,units:data.totals.qty};
}
