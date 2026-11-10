// Gateway publik halaman absen (/absen/). Hanya memeriksa asal, alamat IP, dan ukuran,
// lalu meneruskan ke Edge Function attendance-form dengan secret server. Tanda tangan
// HP, selfie, dan lokasi diperiksa di Edge; isinya tidak pernah dicatat di sini.
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
const respond=(body,status=200)=>Response.json(body,{status,headers});
const actions='registration|register|session|session-register|context|search|person|submit';
const pathPattern=new RegExp(`^/api/attendance-form/(${actions})$`);
// Rincian galat yang boleh diteruskan ke HP: jam server dan jarak ke titik absen.
function safeDetails(details){
 if(!details||typeof details!=='object'||Array.isArray(details))return undefined;
 const out={};
 if(typeof details.code==='string'&&/^[A-Z_]{2,30}$/.test(details.code))out.code=details.code;
 if(typeof details.server_time==='string'&&details.server_time.length<=30&&Number.isFinite(Date.parse(details.server_time)))out.server_time=details.server_time;
 if(typeof details.point_name==='string')out.point_name=details.point_name.slice(0,80);
 if(Number.isFinite(details.distance_m))out.distance_m=Math.round(details.distance_m);
 return Object.keys(out).length?out:undefined;
}
export async function handleAttendanceForm(request,env,fetchImpl=globalThis.fetch.bind(globalThis)){
 try{
  const url=new URL(request.url),match=url.pathname.match(pathPattern);
  if(!match||url.search)return respond({error:'Alamat tidak ditemukan.'},404);
  if(request.method!=='POST')return respond({error:'Gunakan halaman absen.'},405);
  const origin=new URL(env.PORTAL_ORIGIN);if(origin.protocol!=='https:'||origin.origin!==env.PORTAL_ORIGIN)throw new Error('Invalid origin');
  const allowed=[origin.origin];if(env.PORTAL_LEGACY_ORIGIN)allowed.push(new URL(env.PORTAL_LEGACY_ORIGIN).origin);
  if(!allowed.includes(url.origin)||request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return respond({error:'Buka halaman absen dari HP yang terdaftar.'},403);
  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))return respond({error:'Isi permintaan tidak valid.'},415);
  const ip=request.headers.get('CF-Connecting-IP');if(!ip||ip.length>45||!/^[a-f0-9:.]+$/i.test(ip))return respond({error:'Jalur pengiriman tidak valid.'},400);
  const reader=request.body?.getReader();if(!reader)return respond({error:'Isi permintaan kosong.'},400);
  let size=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>460000){await reader.cancel();return respond({error:'Selfie terlalu besar. Coba lagi.'},413);}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return respond({error:'Isi permintaan tidak valid.'},400);}
  if(!body||typeof body!=='object'||Array.isArray(body))return respond({error:'Isi permintaan tidak valid.'},400);
  const base=new URL(env.SUPABASE_URL);if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co')||base.username||base.password||!env.SUPABASE_SECRET_KEY)throw new Error('Invalid configuration');
  // Batas waktu berjenjang: HP 40 detik, Pages ke Edge 35 detik (termasuk unggah selfie ke Drive).
  const upstream=await fetchImpl(`${base.origin}/functions/v1/attendance-form`,{method:'POST',redirect:'manual',headers:{apikey:env.SUPABASE_SECRET_KEY,'Content-Type':'application/json','x-region':'ap-southeast-1'},body:JSON.stringify({operation:match[1],client_ip:ip,body}),signal:AbortSignal.timeout(35000)});
  const data=await upstream.json();
  if(!upstream.ok){
   const known=[400,401,403,404,409,413,415,422,429,503].includes(upstream.status),status=known?upstream.status:503;
   const message=typeof data?.error==='string'&&data.error.length<=300?data.error:'';
   const details=data?.ok===false?safeDetails(data.details):undefined;
   return respond({error:known&&message&&data?.ok===false?message:'Absen belum dapat dikonfirmasi. Coba lagi.',...(details?{details}:{})},status);
  }
  if(data.ok!==true||!data.result||typeof data.result!=='object'||Array.isArray(data.result))throw new Error('Invalid response');
  return respond(data.result);
 }catch{return respond({error:'Absen belum dapat dikonfirmasi. Coba lagi.'},503);}
}
