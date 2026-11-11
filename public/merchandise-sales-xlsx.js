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
const paymentZero=()=>({cash:0,noncash:0,other:0});
const accumulate=(a,b)=>{for(const k of ['qty','revenue','cost'])a[k]=add(a[k],b[k]);};

export function merchandiseSalesData({from,to,stock=[],sales=[],canCost=false,today,summary}={}){
  const current=today||new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  if(!dateOK(from)||!dateOK(to)||!dateOK(current)||from>to)throw new Error('Rentang tanggal laporan tidak valid.');
  if(from.slice(0,7)!==to.slice(0,7))throw new Error('Pilih tanggal dalam satu bulan yang sama untuk format penjualan harian.');
  if(from<'2026-11-01')throw new Error('Transaksi penjualan sebelum 1 November 2026 belum diimpor ke sistem.');
  if(to>current)throw new Error('Tanggal akhir tidak boleh melebihi hari ini.');
  if(sales.length>=1000)throw new Error('Periode mencapai 1.000 transaksi. Pilih rentang lebih pendek agar laporan dapat diverifikasi.');
  const dates=[];
  for(let t=Date.parse(from+'T00:00:00Z');t<=Date.parse(to+'T00:00:00Z');t+=86400000)dates.push(new Date(t).toISOString().slice(0,10));
  const products=new Map(),daily=new Map(dates.map(d=>[d,{items:new Map(),payments:paymentZero(),totals:zero()}]));
  for(const p of stock){
    if(!p.sku||products.has(p.sku))throw new Error('SKU katalog kosong atau ganda.');
    products.set(p.sku,{sku:p.sku,name:p.name||p.sku});
  }
  const seen=new Set();let transactionCount=0;
  for(const sale of sales){
    if(sale.status!=='COMPLETED')continue;
    if(!dateOK(sale.sold_on))throw new Error('Tanggal transaksi penjualan tidak valid.');
    const day=daily.get(sale.sold_on);if(!day)continue;
    const id=sale.id||sale.sale_no;
    if(!id||seen.has(id))throw new Error('Nomor transaksi kosong atau ganda.');
    seen.add(id);transactionCount++;
    if(!Array.isArray(sale.items)||!sale.items.length)throw new Error('Rincian transaksi tidak lengkap: '+id);
    const amounts=zero();
    for(const item of sale.items){
      if(!item.sku)throw new Error('SKU rincian transaksi kosong: '+id);
      const qty=integer(item.quantity,'Jumlah barang',1),revenue=integer(item.subtotal,'Subtotal penjualan');
      const cost=canCost?integer(item.unit_cost,'Modal snapshot')*qty:0;
      if(!Number.isSafeInteger(cost))throw new Error('Modal transaksi melebihi batas angka aman.');
      const value={qty,revenue,cost};accumulate(amounts,value);
      if(!products.has(item.sku))products.set(item.sku,{sku:item.sku,name:item.product_name||item.sku});
      if(!day.items.has(item.sku))day.items.set(item.sku,zero());
      accumulate(day.items.get(item.sku),value);
    }
    if(integer(sale.total,'Total transaksi')!==amounts.revenue)throw new Error('Total dan rincian transaksi berbeda: '+id);
    if(canCost&&sale.cost_total!==undefined&&integer(sale.cost_total,'Total modal')!==amounts.cost)throw new Error('Total modal transaksi berbeda: '+id);
    const method=String(sale.payment_method||'').toUpperCase();
    const group=method==='TUNAI'?'cash':['QRIS','TRANSFER','CARD','KARTU'].includes(method)?'noncash':method==='LAINNYA'?'other':null;
    if(!group)throw new Error('Metode pembayaran belum dikenali: '+method);
    day.payments[group]=add(day.payments[group],amounts.revenue);accumulate(day.totals,amounts);
  }
  const totals=zero(),payments=paymentZero(),items=new Map();
  for(const day of daily.values()){
    accumulate(totals,day.totals);
    for(const [sku,value] of day.items){if(!items.has(sku))items.set(sku,zero());accumulate(items.get(sku),value);}
    for(const k of Object.keys(payments))payments[k]=add(payments[k],day.payments[k]);
  }
  if(summary){
    for(const [key,value] of [['revenue',totals.revenue],['units_sold',totals.qty],['transaction_count',transactionCount],...(canCost?[['cost',totals.cost]]:[])])
      if(integer(summary[key],'Ringkasan '+key)!==value)throw new Error('Rincian laporan belum lengkap atau berubah. Muat ulang sebelum ekspor.');
  }
  return {from,to,dates,products:[...products.values()].sort((a,b)=>a.sku.localeCompare(b.sku,'id',{numeric:true})),daily,items,totals,payments,canCost,transactionCount,hasOther:payments.other!==0};
}

const textCell=(ref,v,s)=>'<c r="'+ref+'" s="'+s+'" t="inlineStr"><is><t xml:space="preserve">'+xml(v)+'</t></is></c>';
const numberCell=(ref,v,s)=>'<c r="'+ref+'" s="'+s+'"><v>'+v+'</v></c>';
const formulaCell=(ref,f,v,s)=>'<c r="'+ref+'" s="'+s+'"><f>'+xml(f)+'</f><v>'+v+'</v></c>';
const crossSum=(dates,col,row)=>'SUM('+dates.map(d=>"'"+Number(d.slice(8))+"'!"+col+row).join(',')+')';

function salesSheet(data,name,kind,day,artwork){
  const count=Math.max(70,data.products.length),offset=count-70,other=data.hasOther?1:0;
  const totalRow=94+offset,paymentStart=98+offset,endRow=100+offset+other;
  const rows=new Map(),values=new Map(),prototypes=new Map(template.rows.map(r=>[Number(r.attrs.r),r]));
  const set=(col,row,value,formula=null,style=null)=>values.set(col+row,{value,formula,style});
  const total=kind==='final'?data.totals:day?.totals||zero(),payments=kind==='final'?data.payments:day?.payments||paymentZero();
  const items=kind==='final'?data.items:day?.items||new Map();
  const days=kind==='final'?data.dates.length:1;
  const title=kind==='master'?'MASTER LAPORAN PENJUALAN':kind==='final'?'LAPORAN PENJUALAN '+Number(data.from.slice(8))+' - '+label(data.to):'TANGGAL '+label(day.date);
  for(let r=1;r<=23;r++)rows.set(r,prototypes.get(r)||{attrs:{r},cells:[]});
  for(let i=0;i<count;i++)rows.set(24+i,prototypes.get(24+Math.min(i,69)));
  for(let r=94;r<=100;r++)rows.set(r+offset+(r===100?other:0),prototypes.get(r));
  if(other)rows.set(100+offset,prototypes.get(99));
  const labels={A14:title,A15:'I. REKAPITULASI PENJUALAN DAN LABA',A16:'URAIAN',D16:'NOMINAL (Rp.)',A17:'PENDAPATAN',A18:'MODAL',A19:'LABA',A21:'II. PENJUALAN',A22:'NO',B22:'JENIS BARANG',C22:'PENJUALAN',G22:'RATA-RATA/\nHARI',C23:'JUMLAH (PCS)',D23:'NOMINAL (Rp.)',E23:'MODAL (Rp.)',F23:'LABA (Rp.)'};
  for(const [ref,value] of Object.entries(labels))set(ref.match(/[A-Z]+/)[0],Number(ref.match(/\d+/)[0]),value);
  for(const [r,col,val] of [[17,'D',total.revenue],[18,'E',total.cost],[19,'F',total.revenue-total.cost]])
    if(r===17||data.canCost)set('D',r,val,col+totalRow);
  if(!data.canCost){set('D',18,'Tidak ditampilkan');set('D',19,'Tidak ditampilkan');}
  for(let i=0;i<count;i++){
    const r=i+24,p=data.products[i],v=p?items.get(p.sku)||zero():zero();
    set('A',r,i+1);if(p)set('B',r,p.name);
    const f=col=>kind==='final'?crossSum(data.dates,col,r):null;
    set('C',r,v.qty,f('C'));set('D',r,v.revenue,f('D'));
    if(data.canCost){set('E',r,v.cost,f('E'));set('F',r,v.revenue-v.cost,'D'+r+'-E'+r);}
    set('G',r,v.qty/days,'C'+r+'/'+days,template.averageStyle);
  }
  set('A',totalRow,'JUMLAH');
  for(const [col,value] of [['C',total.qty],['D',total.revenue],...(data.canCost?[['E',total.cost],['F',total.revenue-total.cost]]:[])])set(col,totalRow,value,'SUM('+col+'24:'+col+(totalRow-1)+')');
  set('A',96+offset,'III. METODE PEMBAYARAN');
  set('A',97+offset,'NO');set('B',97+offset,'JENIS PEMBAYARAN');set('C',97+offset,'NOMINAL (Rp.)');
  const methods=[['cash','TUNAI'],['noncash','NON TUNAI (QRIS / TRANSFER / CARD)'],...(other?[['other','LAINNYA']]:[])];
  for(let i=0;i<methods.length;i++){
    const [key,label]=methods[i],r=paymentStart+i;set('A',r,i+1);set('B',r,label);set('C',r,payments[key],kind==='final'?crossSum(data.dates,'C',r):null);
  }
  set('A',endRow,'JUMLAH');set('C',endRow,total.revenue,'SUM(C'+paymentStart+':C'+(endRow-1)+')');
  const body=[];
  for(const [r,proto] of [...rows].sort((a,b)=>a[0]-b[0])){
    const a={...proto.attrs,r};
    // Keep original styles and row dimensions; allow payment labels and new long names to wrap.
    const p=r>=24&&r<totalRow?data.products[r-24]:null;
    if(p&&p.name.length>32)a.ht='30',a.customHeight='1';
    const cells=[];
    for(const col of 'ABCDEFG'){
      const ref=col+r,original=proto.cells.find(c=>c.col===col),v=values.get(ref);
      let style=v?.style??original?.style??'0';
      if(col==='B'&&p)style='34';
      if(col==='B'&&r===paymentStart+1)style='34';
      if(!v){cells.push('<c r="'+ref+'" s="'+style+'"/>');continue;}
      cells.push(v.formula?formulaCell(ref,v.formula,v.value,style):typeof v.value==='number'?numberCell(ref,v.value,style):textCell(ref,v.value,style));
    }
    body.push('<row'+attrs(a)+'>'+cells.join('')+'</row>');
  }
  const shiftRow=r=>r>=100?r+offset+other:r>=94?r+offset:r;
  const shiftRef=ref=>ref.replace(/(\d+)/g,x=>String(shiftRow(Number(x))));
  const merges=template.merges.map(shiftRef);
  if(other)merges.push('C'+(100+offset)+':G'+(100+offset));
  const sheet='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="'+NS+'" xmlns:r="'+REL+'">'+
    '<dimension ref="A1:G'+(113+offset+other)+'"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="14.4"/><cols>'+template.columns.map(c=>'<col'+attrs(c)+'/>').join('')+'</cols><sheetData>'+body.join('')+'</sheetData><mergeCells count="'+merges.length+'">'+merges.map(ref=>'<mergeCell ref="'+ref+'"/>').join('')+'</mergeCells><pageMargins'+attrs(template.margins)+'/><pageSetup'+attrs(template.pageSetup)+'/><drawing r:id="rId1"/></worksheet>';
  const date=label(kind==='daily'?day.date:data.to).toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase());
  // Baris drawing dihitung dari 0. Kop, tanda tangan, dan gambar lain digeser
  // persis seperti sel di bawahnya: setelah JUMLAH barang (baris 94) ikut
  // tambahan barang, setelah JUMLAH pembayaran (baris 100) ikut baris LAINNYA.
  // Blok tanda tangan di file acuan dimulai tepat di bawah tabel pembayaran,
  // jadi ambang tetap (baris 103) membuat blok kanan menimpa tabel.
  const drawing=artwork.drawing.replace('{{REPORT_DATE}}',xml(date)).replace(/<xdr:row>(\d+)<\/xdr:row>/g,(match,n)=>'<xdr:row>'+(shiftRow(Number(n)+1)-1)+'</xdr:row>');
  return {name,xml:sheet,drawing,last:113+offset+other};
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
