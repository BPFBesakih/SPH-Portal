// Penulis PDF kecil untuk laporan E-Arsip: tabel teks A4 mendatar dengan font bawaan PDF
// (Helvetica), sepenuhnya di browser dan tanpa pustaka pihak ketiga.
// Metadata dokumen hanya berisi judul laporan yang generik: tidak ada perihal, nama
// pemohon, atau data lain di luar yang terlihat pada halaman.
const PAGE={width:841.89,height:595.28,margin:36};
const SIZE={title:13,meta:9,cell:8.5,line:11,pad:3.5};
// Lebar glif Helvetica (AFM) untuk kode 32–126.
const WIDTHS=[278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,
 667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,
 556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const SPECIAL={'€':128,'‚':130,'…':133,'‘':145,'’':146,'“':147,'”':148,'•':149,'–':150,'—':151,'™':153};

// Teks → kode WinAnsi. Karakter di luar WinAnsi diganti huruf dasarnya atau tanda tanya.
function encode(text){
 const out=[];
 for(const char of String(text??'').normalize('NFC')){
  const code=char.codePointAt(0);
  if(code===9||code===10||code===13){out.push(32);continue;}
  if((code>=32&&code<=126)||(code>=160&&code<=255)){out.push(code);continue;}
  if(SPECIAL[char]){out.push(SPECIAL[char]);continue;}
  const base=char.normalize('NFKD').replace(/[̀-ͯ]/g,'');
  if(base&&[...base].every(c=>c.codePointAt(0)>=32&&c.codePointAt(0)<=126))for(const c of base)out.push(c.codePointAt(0));
  else if(code>=32)out.push(63);
 }
 return out;
}
const glyph=code=>code>=32&&code<=126?WIDTHS[code-32]:556;
const widthOf=(codes,size,bold=false)=>codes.reduce((sum,code)=>sum+glyph(code),0)*size/1000*(bold?1.07:1);
const literal=codes=>'('+codes.map(code=>code===40||code===41||code===92?'\\'+String.fromCharCode(code):String.fromCharCode(code)).join('')+')';

// Memotong teks menjadi baris selebar kolom; kata yang terlalu panjang dipotong per huruf.
function wrap(text,width,size,bold=false){
 const lines=[];let line=[];
 const fits=codes=>widthOf(codes,size,bold)<=width;
 const words=[];let word=[];
 for(const code of encode(text)){if(code===32){if(word.length)words.push(word);word=[];}else word.push(code);}
 if(word.length)words.push(word);
 for(let part of words){
  const candidate=line.length?[...line,32,...part]:part;
  if(fits(candidate)){line=candidate;continue;}
  if(line.length){lines.push(line);line=[];}
  while(!fits(part)&&part.length>1){
   let cut=part.length-1;while(cut>1&&!fits(part.slice(0,cut)))cut--;
   lines.push(part.slice(0,cut));part=part.slice(cut);
  }
  line=part;
 }
 if(line.length||!lines.length)lines.push(line);
 return lines;
}

const number=value=>Number(value.toFixed(2));
const pdfDate=date=>{const wita=new Date(date.getTime()+8*3600000),p=(n,l=2)=>String(n).padStart(l,'0');return `D:${wita.getUTCFullYear()}${p(wita.getUTCMonth()+1)}${p(wita.getUTCDate())}${p(wita.getUTCHours())}${p(wita.getUTCMinutes())}${p(wita.getUTCSeconds())}+08'00'`;};

// report: {title, lines:[teks], summary:[{label,count}], notes:[teks], columns:[{header,key,weight}], rows:[objek]}
export function createReportPdf(report){
 const usable=PAGE.width-2*PAGE.margin,weights=report.columns.reduce((sum,c)=>sum+(c.weight||1),0);
 const columns=report.columns.map(c=>({...c,width:usable*(c.weight||1)/weights}));
 const pages=[];let ops,y;
 const text=(codes,x,at,size,bold=false)=>ops.push(`BT /${bold?'F2':'F1'} ${size} Tf ${number(x)} ${number(at)} Td ${literal(codes)} Tj ET`);
 const newPage=()=>{ops=[];pages.push(ops);y=PAGE.height-PAGE.margin;};
 const room=height=>{if(y-height<PAGE.margin+18){newPage();return true;}return false;};
 const paragraph=(value,size,bold=false,gap=3)=>{
  for(const line of wrap(value,usable,size,bold)){room(size+gap);y-=size;text(line,PAGE.margin,y,size,bold);y-=gap;}
 };
 const fitsOnPage=height=>y-height>=PAGE.margin+18;
 const layout=(cells,bold=false)=>{
  const wrapped=cells.map((cell,i)=>wrap(cell,columns[i].width-2*SIZE.pad,SIZE.cell,bold));
  return {wrapped,height:Math.max(...wrapped.map(lines=>lines.length))*SIZE.line+2*SIZE.pad};
 };
 const draw=({wrapped,height},bold=false,fill=false)=>{
  const top=y,bottom=y-height;let x=PAGE.margin;
  if(fill)ops.push(`0.92 g ${number(PAGE.margin)} ${number(bottom)} ${number(usable)} ${number(height)} re f 0 g`);
  ops.push('0.6 G 0.5 w');
  wrapped.forEach((lines,i)=>{
   ops.push(`${number(x)} ${number(bottom)} ${number(columns[i].width)} ${number(height)} re S`);
   lines.forEach((line,index)=>text(line,x+SIZE.pad,top-SIZE.pad-SIZE.cell-index*SIZE.line+1,SIZE.cell,bold));
   x+=columns[i].width;
  });
  y=bottom;
 };
 const headerRow=layout(columns.map(c=>c.header),true);

 newPage();
 paragraph(report.title,SIZE.title,true,6);
 for(const line of report.lines||[])paragraph(line,SIZE.meta);
 if(report.summary?.length){
  y-=6;paragraph('Rekap',SIZE.meta,true);
  for(const item of report.summary)paragraph(`${item.label}: ${item.count}`,SIZE.meta);
 }
 for(const note of report.notes||[]){y-=2;paragraph(`Catatan: ${note}`,SIZE.meta);}
 y-=10;
 if(report.rows.length){
  // Judul kolom diulang di setiap halaman dan tidak pernah berdiri sendiri di dasar halaman.
  let needHeader=true;
  for(const row of report.rows){
   const cells=layout(columns.map(c=>row[c.key]??''));
   if(!fitsOnPage(cells.height+(needHeader?headerRow.height:0))){newPage();needHeader=true;}
   if(needHeader){draw(headerRow,true,true);needHeader=false;}
   draw(cells);
  }
 }else paragraph('Tidak ada arsip pada saringan ini.',SIZE.meta);

 // Kaki halaman setelah jumlah halaman diketahui.
 const footer=encode(report.footer||report.title);
 pages.forEach((page,index)=>{
  ops=page;
  text(footer,PAGE.margin,PAGE.margin-14,7.5);
  const label=encode(`Halaman ${index+1} dari ${pages.length}`);
  text(label,PAGE.width-PAGE.margin-widthOf(label,7.5),PAGE.margin-14,7.5);
 });

 const objects=[];
 const add=body=>{objects.push(body);return objects.length;};
 const catalog=add(''),tree=add('');
 const regular=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
 const bold=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
 const kids=[];
 for(const page of pages){
  const stream=page.join('\n');
  const content=add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
 }
 objects[catalog-1]=`<< /Type /Catalog /Pages ${tree} 0 R >>`;
 objects[tree-1]=`<< /Type /Pages /Kids [${kids.map(id=>`${id} 0 R`).join(' ')}] /Count ${kids.length} >>`;
 const info=add(`<< /Title ${literal(encode(report.title))} /Producer (SPH-Portal) /CreationDate (${pdfDate(new Date())}) >>`);
 let output='%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';const offsets=[];
 objects.forEach((body,index)=>{offsets.push(output.length);output+=`${index+1} 0 obj\n${body}\nendobj\n`;});
 const start=output.length;
 output+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${start}\n%%EOF\n`;
 const bytes=new Uint8Array(output.length);
 for(let i=0;i<output.length;i++)bytes[i]=output.charCodeAt(i)&255;
 return new Blob([bytes],{type:'application/pdf'});
}
