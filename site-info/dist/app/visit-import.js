// Membaca berkas daftar guide di peramban, tanpa mengirim berkasnya ke server.
// Format yang diharapkan: tab Guides spreadsheet NilaiGuide lama yang diunduh lewat
// File → Download → Microsoft Excel (.xlsx) atau Nilai yang dipisahkan koma (.csv).
// Baris pertama = judul kolom: guideId, guideName, kategori, regu, aktif.
const headerNames={guideid:'guideId',id:'guideId','id guide':'guideId',kode:'guideId',guidename:'guideName',nama:'guideName','nama guide':'guideName',name:'guideName',
 kategori:'kategori',category:'kategori',regu:'regu',team:'regu',aktif:'aktif',active:'aktif',status:'aktif'};
const required=['guideName','kategori','regu'];
const maxRows=2000;

async function inflate(bytes,method){
 if(method===0)return bytes;
 if(method!==8)throw new Error('Berkas .xlsx memakai kompresi yang tidak dikenal. Simpan ulang sebagai .xlsx atau .csv.');
 if(typeof DecompressionStream!=='function')throw new Error('Peramban ini belum bisa membuka .xlsx. Gunakan berkas .csv.');
 return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
}
// Pembaca ZIP minimal: direktori pusat → isi berkas yang diminta.
async function unzip(buffer,wanted){
 const view=new DataView(buffer),bytes=new Uint8Array(buffer),decoder=new TextDecoder();
 let end=-1;for(let i=buffer.byteLength-22;i>=Math.max(0,buffer.byteLength-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0)throw new Error('Berkas bukan .xlsx yang valid.');
 const count=view.getUint16(end+10,true);let offset=view.getUint32(end+16,true);const out=new Map();
 for(let n=0;n<count;n++){
  if(view.getUint32(offset,true)!==0x02014b50)throw new Error('Berkas .xlsx rusak.');
  const method=view.getUint16(offset+10,true),size=view.getUint32(offset+20,true),nameLength=view.getUint16(offset+28,true),extra=view.getUint16(offset+30,true),comment=view.getUint16(offset+32,true),local=view.getUint32(offset+42,true);
  const name=decoder.decode(bytes.subarray(offset+46,offset+46+nameLength));
  if(wanted(name)){
   const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);
   out.set(name,decoder.decode(await inflate(bytes.subarray(start,start+size),method)));
  }
  offset+=46+nameLength+extra+comment;
 }
 return out;
}
const xml=text=>new DOMParser().parseFromString(text,'application/xml');
const byName=(node,name)=>[...node.getElementsByTagNameNS('*',name)];
const columnOf=ref=>[...String(ref).replace(/\d+$/,'')].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
// Dua tahap: daftar sheet dulu, baru sheet yang dipakai — unduhan seluruh spreadsheet
// NilaiGuide memuat puluhan tab rekap yang tidak perlu dibuka.
async function readXlsx(buffer,wantedSheet){
 const meta=await unzip(buffer,name=>/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml)$/.test(name));
 const book=xml(meta.get('xl/workbook.xml')||''),rels=xml(meta.get('xl/_rels/workbook.xml.rels')||'');
 const sheets=byName(book,'sheet').map(s=>({name:s.getAttribute('name'),rel:s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id')||s.getAttribute('r:id')}));
 if(!sheets.length)throw new Error('Tidak ada sheet di berkas .xlsx.');
 const chosen=sheets.find(s=>s.name.trim().toLowerCase()===wantedSheet)||(wantedSheet==='guides'?sheets[0]:null);
 if(!chosen)throw new Error(`Sheet "${wantedSheet}" tidak ditemukan. Unduh spreadsheet NilaiGuide lewat File → Download → Microsoft Excel (.xlsx), tanpa mengganti nama tabnya.`);
 const target=byName(rels,'Relationship').find(r=>r.getAttribute('Id')===chosen.rel)?.getAttribute('Target')||'';
 const path=target.startsWith('/')?target.slice(1):`xl/${target.replace(/^\.\//,'')}`;
 const sheet=(await unzip(buffer,name=>name===path)).get(path);if(!sheet)throw new Error(`Sheet "${chosen.name}" tidak dapat dibaca.`);
 const shared=byName(xml(meta.get('xl/sharedStrings.xml')||'<sst/>'),'si').map(si=>byName(si,'t').map(t=>t.textContent).join(''));
 const rows=[];
 for(const row of byName(xml(sheet),'row')){
  const line=Number(row.getAttribute('r'))||rows.length+1,cells=[];
  for(const c of byName(row,'c')){
   const type=c.getAttribute('t'),v=byName(c,'v')[0]?.textContent??'';
   cells[columnOf(c.getAttribute('r'))]=type==='s'?shared[Number(v)]??'':type==='b'?v==='1':type==='inlineStr'?byName(c,'t').map(t=>t.textContent).join(''):v;
  }
  rows.push({line,cells});
 }
 return {sheet:chosen.name,rows};
}
function readCsv(text){
 text=text.replace(/^﻿/,'');
 const first=text.split(/\r?\n/,1)[0],delimiter=[';','\t',','].sort((a,b)=>first.split(b).length-first.split(a).length)[0];
 const rows=[];let cell='',cells=[],quoted=false,line=1,rowLine=1;
 const push=()=>{cells.push(cell);cell='';};
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(ch==='"')quoted=false;else{if(ch==='\n')line++;cell+=ch;}continue;}
  if(ch==='"')quoted=true;
  else if(ch===delimiter)push();
  else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;push();rows.push({line:rowLine,cells});cells=[];line++;rowLine=line;}
  else cell+=ch;
 }
 if(cell!==''||cells.length){push();rows.push({line:rowLine,cells});}
 return {sheet:null,rows};
}

export async function readGuideFile(file){
 if(!file)throw new Error('Pilih berkas lebih dulu.');
 if(file.size>5*1024*1024)throw new Error('Berkas lebih dari 5 MB. Unduh hanya tab Guides.');
 const name=file.name.toLowerCase(),buffer=await file.arrayBuffer();
 const table=name.endsWith('.xlsx')?await readXlsx(buffer,'guides'):name.endsWith('.csv')||file.type==='text/csv'?readCsv(new TextDecoder('utf-8').decode(buffer)):null;
 if(!table)throw new Error('Gunakan berkas .xlsx atau .csv.');
 const [header,...body]=table.rows.filter(r=>r.cells.some(c=>String(c??'').trim()!==''));
 if(!header)throw new Error('Berkas kosong.');
 const columns=header.cells.map(c=>headerNames[String(c??'').trim().toLowerCase()]||null);
 const missing=required.filter(key=>!columns.includes(key));
 if(missing.length)throw new Error(`Kolom ${missing.join(', ')} tidak ditemukan. Baris pertama berkas harus berisi judul kolom: guideId, guideName, kategori, regu, aktif.`);
 if(body.length>maxRows)throw new Error(`Berkas berisi ${body.length} baris; maksimal ${maxRows}.`);
 const rows=body.map(r=>{const out={line:r.line};columns.forEach((key,i)=>{if(key&&out[key]===undefined)out[key]=typeof r.cells[i]==='boolean'?r.cells[i]:String(r.cells[i]??'').trim();});return out;});
 return {sheet:table.sheet,rows};
}

/* ---------- Riwayat NilaiGuide (migrasi awal) ---------- */
// Sheet Evaluations dari unduhan seluruh spreadsheet NilaiGuide (.xlsx), atau .csv tab
// itu saja. Yang dikirim ke portal hanya kolom yang dihitung rekap — catatan, nama
// petugas, dan jam terima tidak pernah meninggalkan peramban.
const historyColumns=['evaluationId','timestamp','pos','guideId','uniform','idCard','etika','status'];
const historyRequired=historyColumns.filter(c=>c!=='status');
const cellValue=v=>typeof v==='boolean'?v:v==null?null:String(v).trim().slice(0,100);
async function sha256(buffer){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(b=>b.toString(16).padStart(2,'0')).join('');}

export async function readHistoryFile(file){
 if(!file)throw new Error('Pilih berkas lebih dulu.');
 if(file.size>60*1024*1024)throw new Error('Berkas lebih dari 60 MB. Unduh ulang spreadsheet NilaiGuide sebagai .xlsx.');
 const name=file.name.toLowerCase(),buffer=await file.arrayBuffer();
 const table=name.endsWith('.xlsx')?await readXlsx(buffer,'evaluations'):name.endsWith('.csv')||file.type==='text/csv'?readCsv(new TextDecoder('utf-8').decode(buffer)):null;
 if(!table)throw new Error('Gunakan berkas .xlsx (unduhan seluruh spreadsheet NilaiGuide) atau .csv tab Evaluations.');
 const [header,...body]=table.rows.filter(r=>r.cells.some(c=>String(c??'').trim()!==''));
 if(!header)throw new Error('Sheet Evaluations kosong.');
 const index=Object.fromEntries(historyColumns.map(key=>[key,header.cells.findIndex(c=>String(c??'').trim().toLowerCase()===key.toLowerCase())]));
 const missing=historyRequired.filter(key=>index[key]<0);
 if(missing.length)throw new Error(`Kolom ${missing.join(', ')} tidak ditemukan di baris pertama sheet ${table.sheet?`"${table.sheet}"`:'berkas'}. Gunakan tab Evaluations NilaiGuide apa adanya.`);
 if(body.length>100000)throw new Error(`Berkas berisi ${body.length} baris; maksimal 100.000.`);
 // ID kembar di berkas: yang pertama dipakai, sisanya dihitung "dilewati".
 const seen=new Set(),rows=[];let duplicates=0;
 for(const r of body){
  const id=String(r.cells[index.evaluationId]??'').trim().toLowerCase();
  if(id&&seen.has(id)){duplicates++;continue;}
  if(id)seen.add(id);
  rows.push([r.line,...historyColumns.map(key=>index[key]<0?null:cellValue(r.cells[index[key]]))]);
 }
 return {sheet:table.sheet,fileName:file.name,sha256:await sha256(buffer),rowsTotal:body.length,duplicates,rows};
}

// Badan permintaan portal paling besar 128 KB: bagian dibatasi jumlah baris DAN ukuran.
export function historyParts(rows,maxRows=800,maxBytes=100000){
 const parts=[];let part=[],bytes=0;
 for(const row of rows){
  const size=JSON.stringify(row).length+1;
  if(part.length&&(part.length>=maxRows||bytes+size>maxBytes)){parts.push(part);part=[];bytes=0;}
  part.push(row);bytes+=size;
 }
 if(part.length)parts.push(part);
 return parts;
}
