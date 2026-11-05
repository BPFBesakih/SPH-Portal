// Laporan stok resmi (kolom A-I) yang mengikuti format BPFKSPA Besakih.
// Berjalan lokal di browser: tanpa layanan konversi, data tidak diunggah.
const enc=new TextEncoder();
const escapeXml=v=>String(v??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const letter=n=>{let s='';for(let x=n+1;x;x=Math.floor((x-1)/26))s=String.fromCharCode(65+(x-1)%26)+s;return s;};
const asNumber=v=>Number.isFinite(Number(v))?Number(v):0;
const moneyFmt='&quot;Rp&quot; #,##0;[Red](&quot;Rp&quot; #,##0);&quot;Rp&quot; -';
const styleXml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
'<numFmts count="3"><numFmt numFmtId="164" formatCode="'+moneyFmt+'"/><numFmt numFmtId="165" formatCode="dd mmm yyyy"/><numFmt numFmtId="166" formatCode="dd mmm yyyy hh:mm"/></numFmts>'+
'<fonts count="3"><font><sz val="9"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font><font><b/><sz val="9"/><name val="Arial"/></font></fonts>'+
'<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'+
'<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>'+
'<left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border></borders>'+
'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
'<cellXfs count="13">'+
'<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>'+// 0 default
'<xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'+// 1 title
'<xf numFmtId="0" fontId="2" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'+// 2 letterhead
'<xf numFmtId="0" fontId="2" fillId="0" borderId="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'+// 3 header
'<xf numFmtId="3" fontId="0" fillId="0" borderId="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'+// 4 qty
'<xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'+// 5 item
'<xf numFmtId="164" fontId="0" fillId="0" borderId="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right"/></xf>'+// 6 money
'<xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'+// 7 summary label
'<xf numFmtId="0" fontId="2" fillId="0" borderId="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left"/></xf>'+// 8 total
'<xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>'+// 9 note
'<xf numFmtId="0" fontId="2" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>'+// 10 section
'<xf numFmtId="165" fontId="0" fillId="0" borderId="1" applyBorder="1" applyNumberFormat="1"/>'+ //11 dates
'<xf numFmtId="166" fontId="0" fillId="0" borderId="1" applyBorder="1" applyNumberFormat="1"/>'+ //12 datetime
'</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
const cText=(ref,text,style=0)=>text===null||text===undefined||text===''?'':'<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+escapeXml(text)+'</t></is></c>';
const cNum=(ref,value,style=4)=>value===null||value===undefined||value===''?'':'<c r="'+ref+'" s="'+style+'"><v>'+asNumber(value)+'</v></c>';
const cFormula=(ref,expression,cached,style=4)=>'<c r="'+ref+'" s="'+style+'"><f>'+escapeXml(expression)+'</f><v>'+asNumber(cached)+'</v></c>';
const colXml=widths=>widths.map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join('');
const rowXml=(r,content,height)=>'<row r="'+r+'"'+(height?' ht="'+height+'" customHeight="1"':'')+'>'+content+'</row>';
const sheetRoot=body=>'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+body+'</worksheet>';
const dateSerial=value=>{
  if(value===null||value===undefined||value==='')return null;
  const s=String(value),d=/^\d{4}-\d{2}-\d{2}$/.test(s)?new Date(s+'T00:00:00Z'):new Date(new Date(s).getTime()+8*3600000);
  return Number.isFinite(d.getTime())?(d.getTime()-Date.UTC(1899,11,30))/86400000:null;
};
function officialXml(sheet,logo){
  const records=sheet.rows||[],merges=[],body=[];
  const merged=(start,end)=>merges.push('<mergeCell ref="'+start+':'+end+'"/>');
  const line=(r,content,height)=>body.push(rowXml(r,content,height));
  const paragraph=(r,value)=>{merged('A'+r,'I'+r);line(r,cText('A'+r,value,10),21);};
  merged('B3','I3');merged('B4','I4');merged('B5','I5');merged('B6','I6');merged('B7','I7');
  line(3,cText('B3','ᬒᬁ ᬲᬂ ᬳ᭄ᬬᬂ ᬯᬶᬥᬶ ᬯᬲ',2),20);
  line(4,cText('B4','BADAN PENGELOLA',1),21);
  line(5,cText('B5','FASILITAS KAWASAN SUCI PURA AGUNG BESAKIH',1),24);
  line(6,cText('B6','Sekretariat: Manik Mas, Desa Besakih, Kec. Rendang, Kab. Karangasem, Bali',2),16);
  line(7,cText('B7','Website: www.besakih.org   |   E-Mail: bpfkspab@gmail.com   |   Hotline: 081337513583',2),16);
  merged('A14','I14');line(14,cText('A14',sheet.title,1),26);
  paragraph(16,'I. REKAPITULASI STOK DISPLAY DAN STOK AKHIR');
  merged('A17','C17');merged('D17','I17');
  line(17,cText('A17','URAIAN',3)+cText('D17','NOMINAL (Rp)',3),24);
  const summaries=sheet.summary||[];
  for(let i=0;i<3;i++){
    const r=18+i,p=summaries[i]||{};
    merged('A'+r,'C'+r);merged('D'+r,'I'+r);
    line(r,cText('A'+r,p.label||'',7)+cNum('D'+r,p.value,6),22);
  }
  paragraph(21,'II. PENJUALAN');
  const heads=['NO','JENIS BARANG','STOK DISPLAY (Pcs)','TOTAL (Rp)','TERJUAL (Pcs)','TOTAL (Rp)','STOK AKHIR (Pcs)','TOTAL (Rp)','KET'];
  let head='';
  for(let i=0;i<9;i++){const l=letter(i);merged(l+'22',l+'23');head+=cText(l+'22',heads[i],3);}
  line(22,head,25);line(23,'',12);
  for(let i=0;i<records.length;i++){
    const r=i+24,p=records[i],delta=asNumber(p.received)+asNumber(p.returned)+asNumber(p.adjustment);
    const note=[p.note,p.received?'BARANG MASUK +'+p.received:'',p.returned?'RETUR +'+p.returned:'',p.adjustment?'KOREKSI '+(p.adjustment>0?'+':'')+p.adjustment:''].filter(Boolean).join(' | ');
    let cells=cNum('A'+r,p.no,4)+cText('B'+r,p.name,5)+cNum('C'+r,p.opening,4);
    if(p.unitCost!==null&&p.unitCost!==undefined)cells+=cFormula('D'+r,'C'+r+'*'+asNumber(p.unitCost),p.openingValue,6);
    cells+=cNum('E'+r,p.sold,4)+cNum('F'+r,p.revenue,6);
    cells+=cFormula('G'+r,'C'+r+'-E'+r+(delta<0?'':'+')+delta,p.closing,4);
    if(p.unitCost!==null&&p.unitCost!==undefined)cells+=cFormula('H'+r,'G'+r+'*'+asNumber(p.unitCost),p.closingValue,6);
    cells+=cText('I'+r,note,9);
    line(r,cells,20);
  }
  const last=records.length+23,total=last+1;
  merged('A'+total,'B'+total);
  let totalCell=cText('A'+total,'JUMLAH',8);
  for(const [col,key,style] of [['C','opening',4],['D','openingValue',6],['E','sold',4],['F','revenue',6],['G','closing',4],['H','closingValue',6]]){
    if((key==='openingValue'||key==='closingValue')&&records[0]?.unitCost===null)continue;
    const val=sheet.total?.[key];
    if(val===null||val===undefined)continue;
    totalCell+=records.length?cFormula(col+total,'SUM('+col+'24:'+col+last+')',val,style):cNum(col+total,val,style);
  }
  line(total,totalCell,23);
  let cursor=total+2;
  for(const section of sheet.sections||[]){
    paragraph(cursor++,section.title);
    merged('B'+cursor,'C'+cursor);merged('E'+cursor,'I'+cursor);
    line(cursor,cText('A'+cursor,'NO',3)+cText('B'+cursor,'JENIS BARANG',3)+cText('D'+cursor,'JUMLAH (Pcs)',3)+cText('E'+cursor,'KETERANGAN',3),24);
    cursor++;
    if(!section.rows?.length){
      merged('B'+cursor,'I'+cursor);line(cursor,cText('B'+cursor,'Tidak ada mutasi yang tercatat.',9),21);cursor++;
    }else for(const item of section.rows){
      merged('B'+cursor,'C'+cursor);merged('E'+cursor,'I'+cursor);
      line(cursor,cNum('A'+cursor,item.no,4)+cText('B'+cursor,item.name,5)+cNum('D'+cursor,item.qty,4)+cText('E'+cursor,(item.date||'')+' — '+(item.reason||''),9),21);
      cursor++;
    }
    cursor++;
  }
  const final=Math.max(total,cursor-1);
  return sheetRoot('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:I'+final+'"/>'+
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="23" topLeftCell="A24" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'+
    '<sheetFormatPr defaultRowHeight="18"/><cols>'+colXml([6,30,13,19,12,19,13,19,17])+'</cols><sheetData>'+body.join('')+'</sheetData>'+
    '<mergeCells count="'+merges.length+'">'+merges.join('')+'</mergeCells>'+
    '<autoFilter ref="A22:I'+last+'"/><printOptions horizontalCentered="1"/>'+
    '<pageMargins left="0.29" right="0.29" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>'+
    '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'+
    (logo?'<drawing r:id="rId1"/>':''));
}
function genericXml(sheet){
  const columns=sheet.columns||[],rows=sheet.rows||[];
  if(!columns.length)throw new Error('Sheet ekspor tidak memiliki kolom.');
  const head=columns.map((c,i)=>cText(letter(i)+'1',c.header,3)).join('');
  const content=[rowXml(1,head,26)];
  for(let i=0;i<rows.length;i++){
    const cells=columns.map((c,j)=>{
      const ref=letter(j)+(i+2),v=rows[i][c.key];
      if(v===null||v===undefined)return '';
      if(c.kind==='date'||c.kind==='datetime'){
        const numeric=dateSerial(v);
        return numeric===null?cText(ref,v,5):cNum(ref,numeric,c.kind==='date'?11:12);
      }
      if(c.kind==='number'||c.kind==='money')return cNum(ref,v,c.kind==='money'?6:4);
      return cText(ref,v,c.kind==='notes'?9:5);
    }).join('');
    content.push(rowXml(i+2,cells,20));
  }
  return sheetRoot('<dimension ref="A1:'+letter(columns.length-1)+(rows.length+1)+'"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'+
    '<sheetFormatPr defaultRowHeight="18"/><cols>'+colXml(columns.map(c=>Math.min(70,Math.max(12,c.width||c.header.length+3))))+'</cols>'+
    '<sheetData>'+content.join('')+'</sheetData><autoFilter ref="A1:'+letter(columns.length-1)+(rows.length+1)+'"/>');
}
function logoDrawingXml(){
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
    '<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>'+
    '<xdr:ext cx="930000" cy="930000"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Logo BPFKSPA Besakih"/><xdr:cNvPicPr/></xdr:nvPicPr>'+
    '<xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>'+
    '<xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>';
}
const crcTable=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc32=bytes=>{let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
function zip(files){
  const chunks=[],directory=[];let offset=0;
  const w16=(view,i,n)=>view.setUint16(i,n,true),w32=(view,i,n)=>view.setUint32(i,n,true);
  for(const [name,content] of files){
    const nameBytes=enc.encode(name),data=content instanceof Uint8Array?content:enc.encode(content);
    const crc=crc32(data),local=new Uint8Array(30+nameBytes.length),l=new DataView(local.buffer);
    w32(l,0,0x04034b50);w16(l,4,20);w16(l,6,0x0800);w32(l,14,crc);w32(l,18,data.length);w32(l,22,data.length);w16(l,26,nameBytes.length);local.set(nameBytes,30);
    chunks.push(local,data);
    const central=new Uint8Array(46+nameBytes.length),c=new DataView(central.buffer);
    w32(c,0,0x02014b50);w16(c,4,20);w16(c,6,20);w16(c,8,0x0800);w32(c,16,crc);w32(c,20,data.length);w32(c,24,data.length);w16(c,28,nameBytes.length);w32(c,42,offset);central.set(nameBytes,46);
    directory.push(central);offset+=local.length+data.length;
  }
  const centralSize=directory.reduce((n,c)=>n+c.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);
  w32(e,0,0x06054b50);w16(e,8,files.length);w16(e,10,files.length);w32(e,12,centralSize);w32(e,16,offset);
  return new Blob([...chunks,...directory,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export function createOfficialMerchandiseXlsx(sheets,{logoBytes=null}={}){
  if(!Array.isArray(sheets)||!sheets.length||sheets.length>40)throw new Error('Laporan harus berisi 1–40 sheet.');
  const logo=logoBytes instanceof Uint8Array&&logoBytes.length?logoBytes:null;
  const branded=sheets.flatMap((sheet,i)=>sheet.official&&logo?[i+1]:[]);
  const overrides=sheets.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('');
  const drawingOverrides=branded.map(i=>'<Override PartName="/xl/drawings/drawing'+i+'.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>').join('');
  const sheetEntries=sheets.map((s,i)=>'<sheet name="'+escapeXml(s.name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('');
  const rels=sheets.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('');
  const files=[
    ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+(logo?'<Default Extension="png" ContentType="image/png"/>':'')+'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+overrides+drawingOverrides+'</Types>'],
    ['_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml','<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+sheetEntries+'</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+rels+'<Relationship Id="rId'+(sheets.length+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml',styleXml],
    ...sheets.map((sheet,i)=>['xl/worksheets/sheet'+(i+1)+'.xml',sheet.official?officialXml(sheet,Boolean(logo)):genericXml(sheet)]),
    ...(logo?[['xl/media/bpf-logo.png',logo]]:[]),
    ...branded.flatMap(i=>[
      ['xl/worksheets/_rels/sheet'+i+'.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing'+i+'.xml"/></Relationships>'],
      ['xl/drawings/drawing'+i+'.xml',logoDrawingXml()],
      ['xl/drawings/_rels/drawing'+i+'.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/bpf-logo.png"/></Relationships>']
    ])
  ];
  return zip(files);
}
