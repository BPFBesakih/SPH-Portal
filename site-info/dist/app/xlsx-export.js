// Workbook XLSX sederhana, berjalan sepenuhnya di browser tanpa mengirim data
// pribadi ke layanan konversi atau memuat pustaka pihak ketiga dari CDN.
const enc=new TextEncoder();
const xml=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const col=n=>{let name='';for(let i=n+1;i;i=Math.floor((i-1)/26))name=String.fromCharCode(65+(i-1)%26)+name;return name;};
const dateSerial=value=>{
  if(!value)return null;
  // Tanggal saja adalah hari lokal; timestamp ISO diubah dahulu ke WITA (UTC+8).
  const valueString=String(value),date=/^\d{4}-\d{2}-\d{2}$/.test(valueString)
    ?new Date(`${valueString}T00:00:00Z`):new Date(new Date(valueString).getTime()+8*3600000);
  return Number.isFinite(date.getTime())?(date.getTime()-Date.UTC(1899,11,30))/86400000:null;
};
function cell(value,kind,reference){
  if(value===undefined||value===null||value==='')return '';
  if(kind==='date'||kind==='datetime'){
    const n=dateSerial(value);if(n!==null)return `<c r="${reference}" s="${kind==='date'?2:3}"><v>${n}</v></c>`;
  }
  if(kind==='number'&&Number.isFinite(Number(value)))return `<c r="${reference}"><v>${Number(value)}</v></c>`;
  // Inline strings are data, never formulas (including values beginning with =,+,-,@).
  return `<c r="${reference}"${kind==='notes'?' s="4"':''} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}
function sheetXml(sheet){
  const columns=sheet.columns||[],rows=sheet.rows||[];
  if(!columns.length||columns.length>16384||rows.length>1048575)throw new Error('Jumlah kolom atau baris melebihi batas Excel.');
  const last=col(columns.length-1),end=rows.length+1;
  const widths=columns.map((c,i)=>`<col min="${i+1}" max="${i+1}" width="${Math.min(80,Math.max(12,c.width||c.header.length+3))}" customWidth="1"/>`).join('');
  const head=columns.map((c,i)=>`<c r="${col(i)}1" s="1" t="inlineStr"><is><t>${xml(c.header)}</t></is></c>`).join('');
  const body=rows.map((row,index)=>`<row r="${index+2}">${columns.map((c,i)=>cell(row[c.key],c.kind,`${col(i)}${index+2}`)).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}${end}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${widths}</cols><sheetData><row r="1" ht="25" customHeight="1">${head}</row>${body}</sheetData><autoFilter ref="A1:${last}${end}"/></worksheet>`;
}
// Excel reserves fill indices 0 (none) and 1 (gray125). Custom header fill starts at index 2.
const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="dd mmm yyyy"/><numFmt numFmtId="165" formatCode="dd mmm yyyy hh:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF7B1E34"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

// ZIP "store" sesuai spesifikasi ZIP dan OOXML; CRC32 dihitung per bagian.
const crcTable=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;};
function zip(files){
  const chunks=[],directory=[];let offset=0;
  const u16=(view,pos,value)=>view.setUint16(pos,value,true),u32=(view,pos,value)=>view.setUint32(pos,value,true);
  for(const [name,content] of files){
    const filename=enc.encode(name),data=enc.encode(content),crc=crc32(data);
    const local=new Uint8Array(30+filename.length),lh=new DataView(local.buffer);
    u32(lh,0,0x04034b50);u16(lh,4,20);u16(lh,6,0x0800);u32(lh,14,crc);u32(lh,18,data.length);u32(lh,22,data.length);u16(lh,26,filename.length);local.set(filename,30);
    chunks.push(local,data);
    const central=new Uint8Array(46+filename.length),ch=new DataView(central.buffer);
    u32(ch,0,0x02014b50);u16(ch,4,20);u16(ch,6,20);u16(ch,8,0x0800);u32(ch,16,crc);u32(ch,20,data.length);u32(ch,24,data.length);u16(ch,28,filename.length);u32(ch,42,offset);central.set(filename,46);
    directory.push(central);offset+=local.length+data.length;
  }
  const centralSize=directory.reduce((size,entry)=>size+entry.length,0),end=new Uint8Array(22),eh=new DataView(end.buffer);
  u32(eh,0,0x06054b50);u16(eh,8,files.length);u16(eh,10,files.length);u32(eh,12,centralSize);u32(eh,16,offset);
  return new Blob([...chunks,...directory,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export function createXlsx(sheets){
  if(!Array.isArray(sheets)||!sheets.length||sheets.length>20)throw new Error('Workbook harus berisi 1–20 sheet.');
  const types=sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const workbookSheets=sheets.map((s,i)=>`<sheet name="${xml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('');
  const relations=sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('');
  const files=[
    ['[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${types}</Types>`],
    ['_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels',`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relations}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml',styles],
    ...sheets.map((sheet,i)=>[`xl/worksheets/sheet${i+1}.xml`,sheetXml(sheet)])
  ];
  return zip(files);
}
