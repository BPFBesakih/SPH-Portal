// Pengelolaan Kunjungan: RBAC + token links in Supabase; records remain on Google Spreadsheet.
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {assert,AppError,audit} from './db.mjs';
import {has,requireAccess} from './auth.mjs';
const digest=s=>createHash('sha256').update(s).digest('hex');
const params=()=>({url:Deno.env.get('VISITS_BRIDGE_URL'),key:Deno.env.get('VISITS_BRIDGE_KEY')});
const safeDay=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v));
const validMonth=v=>typeof v==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(v);
async function bridge(operation,payload={}){
 const env=params();
 assert(env.url&&env.key,'Koneksi Google Spreadsheet Pengelolaan Kunjungan belum dikonfigurasi.',503);
 let url;try{url=new URL(env.url);}catch{throw new AppError(503,'Alamat jembatan Spreadsheet tidak valid.');}
 assert(url.protocol==='https:'&&!url.username&&!url.password,'Jembatan Spreadsheet harus melalui HTTPS.',503);
 // The bridge must validate the credential server-side, enforce operations, and never expose it to browsers.
 const response=await fetch(url.href,{method:'POST',redirect:'error',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({operation,credential:env.key,payload}),signal:AbortSignal.timeout(12000)});
 assert(response.ok,'Google Spreadsheet sedang tidak dapat diakses.',503);
 let body;try{body=await response.json();}catch{throw new AppError(503,'Balasan Spreadsheet tidak valid.');}
 assert(body&&body.ok===true&&body.data!==undefined,'Permintaan Spreadsheet belum berhasil.',503);
 return body.data;
}
export async function visitsRoutes(ctx){
 const {db,user,p,method,body:b={},url}=ctx;
 if(p[0]!=='visits')return undefined;
 const area=p[1],action=p[2];
 if(area==='overview'&&method==='GET'){
  await requireAccess(db,user,'visits.dashboard.read');
  const from=url.searchParams.get('from'),to=url.searchParams.get('to');
  assert(safeDay(from)&&safeDay(to)&&from<=to,'Rentang tanggal tidak valid.',400);
  return bridge('overview',{from,to});
 }
 if(area==='guides'){
  if(method==='GET'){
   await requireAccess(db,user,'visits.guides.read');
   return bridge('guides.list');
  }
  if(method==='POST'){
   await requireAccess(db,user,'visits.guides.manage');
   assert(typeof b.guideId==='string'&&/^G-[0-9]{1,7}$/.test(b.guideId),'ID guide tidak valid.',422);
   assert(typeof b.guideName==='string'&&b.guideName.trim().length>=2&&b.guideName.length<=120,'Nama guide tidak valid.',422);
   assert(['Asing','Domestik'].includes(b.kategori)&&['A1','A2','D1','D2'].includes(b.regu),'Kategori atau regu tidak valid.',422);
   assert((b.kategori==='Asing')===b.regu.startsWith('A'),'Kategori dan regu tidak sesuai.',422);
   assert(typeof b.aktif==='boolean','Status guide tidak valid.',422);
   const result=await bridge('guides.upsert',{guideId:b.guideId,guideName:b.guideName.trim(),kategori:b.kategori,regu:b.regu,aktif:b.aktif});
   await audit(db,user,'VISIT_GUIDE_UPSERT','visits_guides',b.guideId,{fields:['guideName','kategori','regu','aktif']});
   return result;
  }
 }
 if(area==='records'&&method==='GET'){
  await requireAccess(db,user,'visits.records.read');
  const from=url.searchParams.get('from'),to=url.searchParams.get('to');
  assert(safeDay(from)&&safeDay(to)&&from<=to,'Rentang tanggal tidak valid.',400);
  return bridge('records.list',{from,to});
 }
 if(area==='archive'&&method==='GET'){
  await requireAccess(db,user,'visits.archive.read');
  const month=url.searchParams.get('month'),offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||100);
  assert(validMonth(month)&&Number.isSafeInteger(offset)&&offset>=0&&offset<=100000&&Number.isSafeInteger(limit)&&limit>=1&&limit<=500,'Filter arsip tidak valid.',422);
  return bridge('archive.list',{month,offset,limit});
 }
 if(area==='links'&&method==='GET'&&!action){
  await requireAccess(db,user,'visits.forms.read');
  const rows=await db.query('SELECT id,pos,created_at,revoked_at FROM guide_form_links ORDER BY created_at DESC');
  return {items:rows};
 }
 if(area==='links'&&method==='POST'&&!action){
  await requireAccess(db,user,'visits.forms.manage');
  assert([1,3].includes(b.pos),'Pos harus 1 atau 3.',422);
  const token=randomBytes(32).toString('hex'),id=randomUUID();
  try{
   await db.query('INSERT INTO guide_form_links(id,pos,token_hash,created_by) VALUES($1,$2,$3,$4)',[id,b.pos,digest(token),user.id]);
  }catch(error){if(error?.code==='23505')throw new AppError(409,'Pos sudah memiliki tautan aktif. Nonaktifkan dahulu.',409);throw error;}
  await audit(db,user,'VISIT_FORM_LINK_CREATED','guide_form_links',id,{pos:b.pos});
  return {id,pos:b.pos,token};
 }
 if(area==='links'&&action==='revoke'&&method==='POST'){
  await requireAccess(db,user,'visits.forms.manage');
  assert(typeof b.id==='string'&&/^[0-9a-f-]{36}$/i.test(b.id),'ID tautan tidak valid.',422);
  const rows=await db.query('UPDATE guide_form_links SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL RETURNING id,pos',[b.id]);
  assert(rows.length===1,'Tautan tidak ditemukan atau sudah nonaktif.',404);
  await audit(db,user,'VISIT_FORM_LINK_REVOKED','guide_form_links',b.id,{pos:rows[0].pos});
  return {ok:true};
 }
 throw new AppError(404,'Alamat modul Kunjungan tidak ditemukan.');
}
