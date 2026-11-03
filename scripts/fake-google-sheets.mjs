// Google Drive + Sheets TIRUAN untuk uji dan pratinjau lokal salinan penilaian guide.
// Tidak pernah menghubungi Google. Meniru perilaku yang diandalkan visit-sheets.mjs
// secara KETAT: batas grid (menulis di luar jumlah baris/kolom tab ditolak 400),
// sel kosong di ujung baris tidak dikembalikan, ID berkas acak, dan galat bergaya
// Google (SERVICE_DISABLED, ACCESS_TOKEN_SCOPE_INSUFFICIENT, NOT_FOUND).
//
//   const google=createFakeGoogle({folderId:'folder-pusat-uji'});
//   runVisitSheetSync({fetchImpl:google.fetch, env:google.env, ...})
import {randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const failure=(status,reason,message=reason)=>json({error:{code:status,message,status:status===404?'NOT_FOUND':status===400?'INVALID_ARGUMENT':'PERMISSION_DENIED',details:[{'@type':'type.googleapis.com/google.rpc.ErrorInfo',reason}],errors:[{reason}]}},status);
const columnIndex=letters=>[...letters].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
const columnName=index=>{let s='';for(let n=index;n>0;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
export function parseA1(range){
 const m=/^'((?:[^']|'')+)'!([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/.exec(range)||/^([^'!]+)!([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/.exec(range);
 if(!m)return null;
 return {title:m[1].replaceAll("''","'"),c1:columnIndex(m[2]),r1:m[3]?Number(m[3]):1,c2:columnIndex(m[4]||m[2]),r2:m[5]?Number(m[5]):(m[4]?Infinity:(m[3]?Number(m[3]):Infinity))};
}

export function createFakeGoogle({folderId='folder-pusat-uji-0001',stateFile,exportDir,clock=()=>Date.now()}={}){
 let state={files:{[folderId]:{id:folderId,name:'Folder pusat portal (uji)',mimeType:'application/vnd.google-apps.folder',parents:['root'],trashed:false,appProperties:{}}},sheets:{}};
 if(stateFile&&existsSync(stateFile))state=JSON.parse(readFileSync(stateFile,'utf8'));
 const faults=[],calls=[];
 const options={sheetsDisabled:false,scopeInsufficient:false,tokenRevoked:false,offline:false,latencyMs:0};
 const newId=()=>randomBytes(22).toString('base64url');
 function save(){
  if(stateFile){mkdirSync(join(stateFile,'..'),{recursive:true});writeFileSync(stateFile,JSON.stringify(state));}
  if(exportDir)for(const [id,book] of Object.entries(state.sheets)){
   const dir=join(exportDir,state.files[id]?.name||id);rmSync(dir,{recursive:true,force:true});if(state.files[id]?.deleted)continue;mkdirSync(dir,{recursive:true});
   for(const tab of book.tabs){
    const rows=[];for(let r=1;r<=Math.max(0,...Object.keys(tab.cells).map(Number));r++)rows.push((tab.cells[r]||[]).map(v=>{const s=String(v??'');return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;}).join(','));
    writeFileSync(join(dir,`${tab.title}.csv`),'﻿'+rows.join('\r\n'));
   }
  }
 }
 const tabOf=(book,title)=>book.tabs.find(t=>t.title===title);
 function readRange(book,range,major='ROWS'){
  const a=parseA1(range);if(!a)throw Object.assign(new Error('bad range'),{status:400});
  const tab=tabOf(book,a.title);if(!tab)throw Object.assign(new Error('Unable to parse range: '+range),{status:400});
  const r2=Math.min(a.r2,tab.rowCount),c2=Math.min(a.c2,tab.columnCount),rows=[];
  for(let r=a.r1;r<=r2;r++){const src=tab.cells[r]||[],row=[];for(let c=a.c1;c<=c2;c++)row.push(src[c-1]??'');while(row.length&&row.at(-1)==='')row.pop();rows.push(row);}
  while(rows.length&&!rows.at(-1).length)rows.pop();
  if(major==='COLUMNS'){const cols=[];for(let c=0;c<=c2-a.c1;c++){const col=rows.map(r=>r[c]??'');while(col.length&&col.at(-1)==='')col.pop();cols.push(col);}while(cols.length&&!cols.at(-1).length)cols.pop();return {range,majorDimension:'COLUMNS',values:cols};}
  return {range,majorDimension:'ROWS',...(rows.length?{values:rows}:{})};
 }
 function writeRange(book,item){
  const a=parseA1(item.range);if(!a)throw Object.assign(new Error('bad range'),{status:400});
  const tab=tabOf(book,a.title);if(!tab)throw Object.assign(new Error('Unable to parse range'),{status:400});
  const values=item.values||[],r2=a.r1+values.length-1,c2=a.c1+Math.max(0,...values.map(v=>v.length))-1;
  if(Number.isFinite(a.r2)&&r2>a.r2||c2>a.c2)throw Object.assign(new Error('Requested writing within range, but tried writing beyond it'),{status:400});
  // Ketat: Sheets tidak boleh dianggap memperluas grid sendiri.
  if(r2>tab.rowCount||c2>tab.columnCount)throw Object.assign(new Error(`Range (${a.title}!${columnName(c2)}${r2}) exceeds grid limits. Max rows: ${tab.rowCount}, max columns: ${tab.columnCount}`),{status:400});
  values.forEach((row,i)=>{const target=tab.cells[a.r1+i]||(tab.cells[a.r1+i]=[]);row.forEach((v,j)=>{target[a.c1-1+j]=v===''?'':v;});});
  return values.length*(c2-a.c1+1);
 }
 function batchUpdate(book,requests){
  const replies=[];
  for(const q of requests){
   if(q.addSheet){const p=q.addSheet.properties;if(book.tabs.some(t=>t.title===p.title||t.sheetId===p.sheetId))throw Object.assign(new Error('A sheet with that name/id already exists'),{status:400});
    const tab={sheetId:p.sheetId??Math.floor(Math.random()*1e9),title:p.title,rowCount:p.gridProperties?.rowCount??1000,columnCount:p.gridProperties?.columnCount??26,frozen:p.gridProperties?.frozenRowCount||0,cells:{},protected:false};
    book.tabs.push(tab);replies.push({addSheet:{properties:{sheetId:tab.sheetId,title:tab.title}}});continue;}
   const sheetId=q.updateSheetProperties?.properties.sheetId??q.updateCells?.range.sheetId??q.updateDimensionProperties?.range.sheetId??q.addProtectedRange?.protectedRange.range.sheetId??q.appendDimension?.sheetId;
   const tab=book.tabs.find(t=>t.sheetId===sheetId);if(!tab)throw Object.assign(new Error('No grid with id: '+sheetId),{status:400});
   if(q.updateSheetProperties){const p=q.updateSheetProperties.properties;if(p.title)tab.title=p.title;if(p.gridProperties?.rowCount)tab.rowCount=p.gridProperties.rowCount;if(p.gridProperties?.columnCount)tab.columnCount=p.gridProperties.columnCount;}
   else if(q.updateCells){const r=q.updateCells.range;(q.updateCells.rows||[]).forEach((row,i)=>{const target=tab.cells[r.startRowIndex+1+i]||(tab.cells[r.startRowIndex+1+i]=[]);row.values.forEach((v,j)=>{target[r.startColumnIndex+j]=v.userEnteredValue?.stringValue??v.userEnteredValue?.numberValue??'';});});}
   else if(q.appendDimension){if(q.appendDimension.dimension==='ROWS')tab.rowCount+=q.appendDimension.length;else tab.columnCount+=q.appendDimension.length;}
   else if(q.addProtectedRange)tab.protected=true;
   replies.push({});
  }
  return replies;
 }
 const matchesQuery=(file,q)=>{
  const parent=/'([^']+)' in parents/.exec(q)?.[1],mime=/mimeType = '([^']+)'/.exec(q)?.[1];
  if(file.deleted)return false;if(parent&&!file.parents.includes(parent))return false;if(mime&&file.mimeType!==mime)return false;if(/trashed = false/.test(q)&&file.trashed)return false;
  for(const [,key,value] of q.matchAll(/appProperties has \{ key='([^']+)' and value='([^']*)' \}/g))if(file.appProperties?.[key]!==value)return false;
  return true;
 };
 async function handle(url,init={}){
  const u=new URL(url),method=init.method||'GET',auth=init.headers?.Authorization||init.headers?.authorization;
  calls.push({method,host:u.hostname,path:u.pathname,at:clock()});
  if(options.latencyMs)await new Promise(r=>setTimeout(r,options.latencyMs));
  if(options.offline)throw new TypeError('fetch failed');
  const fault=faults.findIndex(f=>f.match(method,u));if(fault>=0){const [f]=faults.splice(fault,1);if(f.throws)throw new TypeError('fetch failed');return failure(f.status,f.reason);}
  if(u.hostname==='oauth2.googleapis.com'){
   if(options.tokenRevoked)return json({error:'invalid_grant',error_description:'Token has been expired or revoked.'},400);
   return json({access_token:'tiruan-'+randomBytes(8).toString('hex'),expires_in:3599,token_type:'Bearer'});
  }
  if(!/^Bearer tiruan-/.test(auth||''))return failure(401,'UNAUTHENTICATED');
  if(u.hostname==='www.googleapis.com'&&u.pathname.startsWith('/drive/v3/files')){
   if(options.scopeInsufficient)return failure(403,'ACCESS_TOKEN_SCOPE_INSUFFICIENT','Request had insufficient authentication scopes.');
   const id=decodeURIComponent(u.pathname.slice('/drive/v3/files/'.length));
   if(method==='GET'&&!id){const q=u.searchParams.get('q')||'';return json({files:Object.values(state.files).filter(f=>matchesQuery(f,q))});}
   if(method==='GET'){const f=state.files[id];return f&&!f.deleted?json(f):failure(404,'notFound','File not found: '+id);}
   if(method==='POST'){
    const body=JSON.parse(init.body),created={id:newId(),name:body.name,mimeType:body.mimeType,parents:body.parents||['root'],trashed:false,appProperties:body.appProperties||{}};
    if(!state.files[created.parents[0]])return failure(404,'notFound','File not found: '+created.parents[0]);
    state.files[created.id]=created;
    if(created.mimeType==='application/vnd.google-apps.spreadsheet')state.sheets[created.id]={tabs:[{sheetId:0,title:'Sheet1',rowCount:1000,columnCount:26,cells:{}}]};
    save();return json(created);
   }
  }
  if(u.hostname==='sheets.googleapis.com'){
   if(options.sheetsDisabled)return failure(403,'SERVICE_DISABLED','Google Sheets API has not been used in project 000 before or it is disabled.');
   if(options.scopeInsufficient)return failure(403,'ACCESS_TOKEN_SCOPE_INSUFFICIENT','Request had insufficient authentication scopes.');
   const m=/^\/v4\/spreadsheets\/([^/:]+)(?::batchUpdate|\/values:batchUpdate|\/values:batchGet|\/values\/(.+))?$/.exec(u.pathname);
   if(!m)return failure(404,'NOT_FOUND');
   const book=state.sheets[decodeURIComponent(m[1])];if(!book||state.files[decodeURIComponent(m[1])]?.deleted)return failure(404,'NOT_FOUND','Requested entity was not found.');
   try{
    if(u.pathname.endsWith('/values:batchUpdate')){const body=JSON.parse(init.body);if(body.valueInputOption!=='RAW')return failure(400,'INVALID_ARGUMENT');let cells=0;
     // Seperti Google: seluruh permintaan diperiksa dulu, baru ditulis.
     const copy=JSON.parse(JSON.stringify(book));for(const item of body.data)writeRange(copy,item);for(const item of body.data)cells+=writeRange(book,item);save();return json({totalUpdatedCells:cells,totalUpdatedRows:body.data.reduce((n,d)=>n+d.values.length,0)});}
    if(u.pathname.endsWith('/values:batchGet'))return json({valueRanges:u.searchParams.getAll('ranges').map(r=>readRange(book,r,u.searchParams.get('majorDimension')||'ROWS'))});
    if(m[2])return json(readRange(book,decodeURIComponent(m[2]),u.searchParams.get('majorDimension')||'ROWS'));
    if(u.pathname.endsWith(':batchUpdate')){const body=JSON.parse(init.body);const copy=JSON.parse(JSON.stringify(book));batchUpdate(copy,body.requests);const replies=batchUpdate(book,body.requests);save();return json({replies});}
    return json({spreadsheetId:m[1],sheets:book.tabs.map(t=>({properties:{sheetId:t.sheetId,title:t.title,gridProperties:{rowCount:t.rowCount,columnCount:t.columnCount}}}))});
   }catch(error){return failure(error.status||500,'INVALID_ARGUMENT',error.message);}
  }
  return failure(404,'NOT_FOUND','Unknown fake endpoint '+u.href);
 }
 return {
  fetch:handle,options,calls,
  env:{GOOGLE_DRIVE_FOLDER_ID:folderId,GOOGLE_DRIVE_CLIENT_ID:'client-uji',GOOGLE_DRIVE_CLIENT_SECRET:'secret-uji-tidak-rahasia',GOOGLE_DRIVE_REFRESH_TOKEN:'refresh-uji-tidak-rahasia'},
  state:()=>state,
  // Gangguan sekali pakai untuk permintaan berikutnya yang cocok.
  fail(match,status=503,reason='backendError',{throws=false}={}){faults.push({match:typeof match==='function'?match:(method,u)=>u.pathname.includes(match),status,reason,throws});},
  spreadsheets:()=>Object.entries(state.files).filter(([,f])=>f.mimeType==='application/vnd.google-apps.spreadsheet'&&!f.deleted).map(([id,f])=>({id,name:f.name,parents:f.parents,appProperties:f.appProperties,tabs:state.sheets[id].tabs})),
  tab(title){for(const book of Object.values(state.sheets)){const t=tabOf(book,title);if(t)return t;}return null;},
  rows(title){const t=this.tab(title);if(!t)return [];const last=Math.max(1,...Object.keys(t.cells).map(Number));const out=[];for(let r=2;r<=last;r++)out.push(t.cells[r]||[]);return out;},
  // Meniru pengguna yang mengurutkan tab bulanan menurut kolom tertentu.
  sortTab(title,column=4){const t=this.tab(title);const rows=this.rows(title).filter(r=>r.length);rows.sort((a,b)=>String(a[column]).localeCompare(String(b[column])));for(const k of Object.keys(t.cells))if(Number(k)>=2)delete t.cells[k];rows.forEach((r,i)=>{t.cells[i+2]=r;});save();},
  editCell(title,row,col,value){const t=this.tab(title);(t.cells[row]||(t.cells[row]=[]))[col]=value;save();},
  deleteSpreadsheet(id){state.files[id].deleted=true;save();},
  removeTab(title){for(const book of Object.values(state.sheets)){const i=book.tabs.findIndex(t=>t.title===title);if(i>=0)book.tabs.splice(i,1);}save();},
  clearRow(title,row){const t=this.tab(title);delete t.cells[row];save();}
 };
}
