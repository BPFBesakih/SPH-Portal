// Jembatan spreadsheet TIRUAN untuk uji lokal modul Pengelolaan Kunjungan.
//
// Menjalankan kode Apps Script NilaiGuide yang sebenarnya (server-gas/*.gs,
// termasuk 13_Jembatan.gs) di dalam Node, di atas spreadsheet palsu berisi data
// fiktif. Tidak pernah menghubungi Google. Dipakai oleh scripts/preview-kunjungan.mjs
// atau dijalankan sendiri:
//
//   node scripts/visits-bridge-dev.mjs <folder-repo-nilaiguide> [port]
//
// Folder NilaiGuide harus berada di branch yang memuat server-gas/13_Jembatan.gs.
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,existsSync,mkdirSync,readdirSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';

export const devBridgeKey='uji-lokal-jembatan-kunjungan-bukan-rahasia-2026-0000';

class Sheet{
 constructor(name,data=[]){this.name=name;this.data=data;}
 getName(){return this.name;}
 getLastRow(){return this.data.length;}
 getLastColumn(){return this.data.reduce((n,row)=>Math.max(n,(row||[]).length),0);}
 getMaxRows(){return Math.max(this.data.length,1000);}
 getMaxColumns(){return Math.max(this.getLastColumn(),26);}
 getDataRange(){return this.getRange(1,1,Math.max(this.data.length,1),Math.max(this.getLastColumn(),1));}
 clearContents(){this.data=[];return this;}
 clear(){this.data=[];return this;}
 setFrozenRows(){}setFrozenColumns(){}setColumnWidth(){}setRowHeight(){return this;}setHiddenGridlines(){return this;}
 getRange(row,col,rows=1,cols=1){
  const sheet=this,self={
   getValues(){const out=[];for(let i=0;i<rows;i++){const r=sheet.data[row-1+i]||[];out.push(Array.from({length:cols},(_,j)=>r[col-1+j]??''));}return out;},
   setValues(values){values.forEach((r,i)=>{const at=row-1+i;sheet.data[at]=sheet.data[at]||[];r.forEach((v,j)=>{sheet.data[at][col-1+j]=v;});});return self;},
   setValue(v){return self.setValues([[v]]);}
  };
  for(const name of ['setFontWeight','setFontColor','setBackground','setHorizontalAlignment','setNumberFormat','setNote','setWrap','setBorder','setFontSize'])self[name]=()=>self;
  return self;
 }
}
class Spreadsheet{
 constructor(state){this.sheets=new Map(Object.entries(state.sheets||{}).map(([n,d])=>[n,new Sheet(n,d)]));}
 getSheetByName(n){return this.sheets.get(n)||null;}
 insertSheet(n){const s=new Sheet(n);this.sheets.set(n,s);return s;}
 getSheets(){return [...this.sheets.values()];}
 getSpreadsheetTimeZone(){return 'Asia/Makassar';}
 toJSON(){return Object.fromEntries([...this.sheets].map(([n,s])=>[n,s.data]));}
}
function formatDate(d,tz,pattern){
 const p=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(d).reduce((o,x)=>(o[x.type]=x.value,o),{});
 if(pattern==='yyyy-MM')return `${p.year}-${p.month}`;
 if(pattern==='yyyy-MM-dd')return `${p.year}-${p.month}-${p.day}`;
 return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// Data fiktif: nama guide bukan nama orang sungguhan.
function seedState(){
 const guides=[['guideId','guideName','kategori','regu','aktif']];let n=0;
 for(const [regu,kategori]of [['A1','Asing'],['A2','Asing'],['D1','Domestik'],['D2','Domestik']])
  for(let i=1;i<=10;i++){n++;guides.push([`G-${String(n).padStart(3,'0')}`,`Guide Contoh ${regu}-${String(i).padStart(2,'0')}`,kategori,regu,!(regu==='D2'&&i===10)]);}
 guides.push(['G-041','Guide Kembar Contoh','Asing','A1',true],['G-042','Guide Kembar Contoh','Domestik','D1',true]);
 return {sheets:{Guides:guides,Evaluations:[]},props:{}};
}

export async function startBridgeSimulator({nilaiguideDir,port=4620,host='127.0.0.1',key=devBridgeKey,stateFile=resolve('data','jembatan-uji','spreadsheet.json'),seedDays=21,delayMs=Number(process.env.VISITS_BRIDGE_DEV_DELAY_MS)||0,log=console.log}={}){
 if(!nilaiguideDir)throw new Error('Sebutkan folder repo NilaiGuide (branch claude/jembatan-portal).');
 const dir=resolve(nilaiguideDir,'server-gas');
 const files=existsSync(dir)?readdirSync(dir).filter(f=>/^\d\d_.*\.gs$/.test(f)).sort():[];
 if(!files.includes('13_Jembatan.gs'))throw new Error(`Berkas ${join(dir,'13_Jembatan.gs')} tidak ditemukan. Checkout branch NilaiGuide claude/jembatan-portal.`);
 const fresh=!stateFile||!existsSync(stateFile);
 const state=fresh?seedState():JSON.parse(readFileSync(stateFile,'utf8'));
 const doc=new Spreadsheet(state),props=new Map(Object.entries(state.props||{}));
 props.set('JEMBATAN_KUNCI',key);
 const cache=new Map();
 const sandbox={
  SpreadsheetApp:{getActiveSpreadsheet:()=>doc,flush(){}},
  Utilities:{formatDate},
  ScriptApp:{getProjectTriggers:()=>[{getHandlerFunction:()=>'rekapOtomatis'}]},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.has(k)?props.get(k):null,setProperty(k,v){props.set(k,String(v));return this;},deleteProperty(k){props.delete(k);return this;}})},
  CacheService:{getScriptCache:()=>({get:k=>{const e=cache.get(k);return e&&e.until>Date.now()?e.v:null;},put:(k,v,s)=>{if(v.length>100000)throw new Error('Argument too large');cache.set(k,{v,until:Date.now()+s*1000});},remove:k=>cache.delete(k)})},
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:t=>{const o={getContent:()=>t};o.setMimeType=()=>o;return o;}},
  Logger:{log(){}},console
 };
 vm.createContext(sandbox);
 for(const f of files)vm.runInContext(readFileSync(join(dir,f),'utf8'),sandbox,{filename:f});
 if(fresh){
  doc.getSheetByName('Evaluations').data=[[...sandbox.HEADER_EVAL]];
  // Riwayat fiktif tiga minggu: tiap hari sebagian guide dinilai di Pos 1 dan Pos 3.
  let seed=20261103;const rand=()=>((seed=(seed*1103515245+12345)%2147483648)/2147483648);
  const day=86400000,start=Date.now()-seedDays*day;
  for(let d=0;d<seedDays;d++){
   const items=[];
   for(let g=1;g<=40;g++){
    if(rand()<0.45)continue;
    for(const pos of [1,3]){if(rand()<0.3)continue;
     const at=new Date(Math.floor((start+d*day)/day)*day+(pos===1?0:2)*3600000+g*240000);
     items.push({evaluationId:randomUUID(),guideId:`G-${String(g).padStart(3,'0')}`,guideName:'x',pos,timestamp:at.toISOString(),catatan:rand()<0.1?'Contoh catatan uji (fiktif)':'',
      criteria:{uniform:[-1,1,1,2,2][Math.floor(rand()*5)],idCard:rand()>0.12,etika:[-1,0,0,1,1,2][Math.floor(rand()*6)]}});}
   }
   for(let i=0;i<items.length;i+=200)sandbox.terimaPenilaian_(items.slice(i,i+200),{});
  }
 }
 let timer;
 const save=()=>{if(!stateFile)return;clearTimeout(timer);timer=setTimeout(()=>{mkdirSync(dirname(stateFile),{recursive:true});const p=Object.fromEntries(props);delete p.JEMBATAN_KUNCI;writeFileSync(stateFile,JSON.stringify({sheets:doc.toJSON(),props:p}));},200);};
 save();
 const server=createServer((req,res)=>{
  const chunks=[];
  req.on('data',c=>chunks.push(c));
  req.on('end',async()=>{
   try{
    if(delayMs)await new Promise(r=>setTimeout(r,delayMs));
    const out=req.method==='POST'?sandbox.doPost({postData:{contents:Buffer.concat(chunks).toString('utf8')}}):sandbox.doGet({parameter:{}});
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(out.getContent());save();
   }catch(error){res.writeHead(500);res.end(String(error?.message||error));}
  });
 });
 await new Promise(r=>server.listen(port,host,r));
 const url=`http://${host}:${server.address().port}/exec`;
 log?.(`Jembatan uji (tiruan, data fiktif) aktif: ${url}${fresh?' — spreadsheet tiruan baru dibuat':''}`);
 return {server,url,key,sandbox,doc,close:()=>new Promise(r=>{clearTimeout(timer);server.close(r);})};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [dir,port]=process.argv.slice(2);
 const bridge=await startBridgeSimulator({nilaiguideDir:dir||process.env.NILAIGUIDE_DIR,port:Number(port)||4620});
 console.log(`\nDi terminal server portal (PowerShell):\n  $env:VISITS_BRIDGE_URL = '${bridge.url}'\n  $env:VISITS_BRIDGE_KEY = '${bridge.key}'\n  node server.mjs\n`);
}
