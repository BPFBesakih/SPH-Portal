// Gateway publik formulir penilaian guide (/penilaian-guide/). Hanya memeriksa
// dan meneruskan ke Edge Function guide-form dengan secret server; token tautan
// pos dan isi penilaian tidak pernah dicatat di sini.
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
const respond=(body,status=200)=>Response.json(body,{status,headers});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Hanya bahan formulir yang boleh sampai ke HP; bobot nilai dan metadata internal
// tetap di server. Daftar kosong adalah pengaturan sah, bukan alasan memakai contoh.
function scoringContext(s){
 if(s?.versi!==2||!Number.isInteger(s.teguranMaks)||!Number.isInteger(s.catatanMin)||
  !['teguran','berat','apresiasi','petugas'].every(k=>Array.isArray(s[k]))||
  typeof s.petunjuk?.idCard!=='string'||typeof s.petunjuk?.seragam!=='string')throw new Error('Invalid scoring context');
 const finding=t=>{
  if(typeof t?.kode!=='string'||typeof t.label!=='string'||typeof t.perluCatatan!=='boolean')throw new Error('Invalid finding context');
  return {kode:t.kode,label:t.label,perluCatatan:t.perluCatatan};
 };
 const petugas=s.petugas.map(p=>{
  if(typeof p?.id!=='string'||typeof p.nama!=='string'||typeof p.keterangan!=='string')throw new Error('Invalid assessor context');
  return {id:p.id,nama:p.nama,keterangan:p.keterangan};
 });
 // Rentang Etika hanya dikirim guide-form yang menyimpan Etika. Tanpanya formulir 2.3
 // menahan kiriman di HP sampai server diperbarui.
 let etika;
 if(s.etika!==undefined){
  if(!Number.isInteger(s.etika?.min)||!Number.isInteger(s.etika.max)||s.etika.min>=0||s.etika.max<=0)throw new Error('Invalid Etika context');
  etika={min:s.etika.min,max:s.etika.max};
 }
 return {versi:s.versi,teguranMaks:s.teguranMaks,catatanMin:s.catatanMin,...(etika?{etika}:{}),
  teguran:s.teguran.map(finding),berat:s.berat.map(finding),apresiasi:s.apresiasi.map(finding),petugas,
  petunjuk:{idCard:s.petunjuk.idCard,seragam:s.petunjuk.seragam}};
}
export async function handleGuideForm(request,env,fetchImpl=globalThis.fetch.bind(globalThis)){
 try{
  const url=new URL(request.url),action=url.pathname.split('/').at(-1);
  if(!/^\/api\/guide-form\/(context|submit)$/.test(url.pathname)||url.search)return respond({error:'Alamat tidak ditemukan.'},404);
  if(request.method!=='POST')return respond({error:'Gunakan formulir penilaian guide.'},405);
  const origin=new URL(env.PORTAL_ORIGIN);if(origin.protocol!=='https:'||origin.origin!==env.PORTAL_ORIGIN)throw new Error('Invalid origin');
  const allowed=[origin.origin];if(env.PORTAL_LEGACY_ORIGIN)allowed.push(new URL(env.PORTAL_LEGACY_ORIGIN).origin);
  if(!allowed.includes(url.origin)||request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return respond({error:'Buka formulir melalui tautan pos.'},403);
  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))return respond({error:'Isi permintaan tidak valid.'},415);
  const ip=request.headers.get('CF-Connecting-IP');if(!ip||ip.length>45||!/^[a-f0-9:.]+$/i.test(ip))return respond({error:'Jalur pengiriman tidak valid.'},400);
  const reader=request.body?.getReader();if(!reader)return respond({error:'Isi permintaan kosong.'},400);
  let size=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>24576){await reader.cancel();return respond({error:'Kiriman terlalu besar. Kirim paling banyak 20 penilaian.'},413);}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return respond({error:'Isi permintaan tidak valid.'},400);}
  if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))return respond({error:'Tautan pos tidak aktif. Minta tautan pos terbaru kepada pengelola kunjungan.'},404);
  const base=new URL(env.SUPABASE_URL);if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co')||base.username||base.password||!env.SUPABASE_SECRET_KEY)throw new Error('Invalid configuration');
  // Batas waktu berjenjang: HP 35 detik, Pages ke Edge 32 detik.
  const upstream=await fetchImpl(`${base.origin}/functions/v1/guide-form`,{method:'POST',redirect:'manual',headers:{apikey:env.SUPABASE_SECRET_KEY,'Content-Type':'application/json','x-region':'ap-southeast-1'},body:JSON.stringify({operation:action,client_ip:ip,body}),signal:AbortSignal.timeout(32000)});
  const data=await upstream.json();
  if(!upstream.ok){
   const known=[400,403,404,409,413,415,422,429,503].includes(upstream.status),status=known?upstream.status:503,message=typeof data?.error==='string'&&data.error.length<=300?data.error:'';
   // Pesan 503 hanya diteruskan bila berasal dari fungsi guide-form sendiri.
   const safe=known&&message&&(status!==503||/^Kiriman /.test(message));
   return respond({error:safe?message:'Kiriman belum dapat dikonfirmasi. HP akan mencoba lagi.'},status);
  }
  if(data.ok!==true||!data.result||typeof data.result!=='object')throw new Error('Invalid response');
  const r=data.result;
  if(action==='context'){
   if(!Array.isArray(r.guides)||![1,2,3].includes(r.pos)||typeof r.label!=='string')throw new Error('Invalid context');
   return respond({pos:r.pos,label:r.label,serverTime:r.serverTime,guides:r.guides.map(g=>({guideId:String(g.guideId),guideName:String(g.guideName),kategori:String(g.kategori||''),regu:String(g.regu||'')})),
    ...(r.penilaian!==undefined?{penilaian:scoringContext(r.penilaian)}:{})});
  }
  if(!Array.isArray(r.accepted)||!Array.isArray(r.rejected))throw new Error('Invalid receipt');
  return respond({serverTime:r.serverTime,
   accepted:r.accepted.filter(a=>uuid.test(a?.evaluationId)).map(a=>({evaluationId:a.evaluationId,synced:true,duplicate:a.duplicate===true})),
   rejected:r.rejected.map(x=>({evaluationId:uuid.test(x?.evaluationId)?x.evaluationId:null,errors:Array.isArray(x?.errors)?x.errors.map(e=>String(e).slice(0,500)).slice(0,5):['Ditolak'],...(x?.terlaluCepat?{terlaluCepat:true,sudahDinilai:true}:{})}))});
 }catch{return respond({error:'Kiriman belum dapat dikonfirmasi. HP akan mencoba lagi.'},503);}
}
