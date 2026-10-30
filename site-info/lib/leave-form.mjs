const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
const respond=(body,status=200)=>Response.json(body,{status,headers});
export async function handleLeaveForm(request,env,fetchImpl=globalThis.fetch.bind(globalThis)){
 try{
  const url=new URL(request.url),action=url.pathname.split('/').at(-1);
  if(!/^\/api\/leave-form\/(context|preview|submit)$/.test(url.pathname)||url.search)return respond({error:'Alamat tidak ditemukan.'},404);
  if(request.method!=='POST')return respond({error:'Gunakan formulir cuti.'},405);
  const origin=new URL(env.PORTAL_ORIGIN);if(origin.protocol!=='https:'||origin.origin!==env.PORTAL_ORIGIN)throw new Error('Invalid origin');
  const allowed=[origin.origin];if(env.PORTAL_LEGACY_ORIGIN)allowed.push(new URL(env.PORTAL_LEGACY_ORIGIN).origin);
  if(!allowed.includes(url.origin)||request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return respond({error:'Buka formulir melalui tautan pribadi dari SDM.'},403);
  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))return respond({error:'Isi permintaan tidak valid.'},415);
  const ip=request.headers.get('CF-Connecting-IP');if(!ip||ip.length>45||!/^[a-f0-9:.]+$/i.test(ip))return respond({error:'Jalur pengiriman tidak valid.'},400);
  const reader=request.body?.getReader();if(!reader)return respond({error:'Isi permintaan kosong.'},400);
  let size=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>24576){await reader.cancel();return respond({error:'Isi formulir terlalu besar.'},413);}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return respond({error:'Isi permintaan tidak valid.'},400);}
  if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))return respond({error:'Tautan tidak aktif. Minta tautan pribadi kepada SDM.'},404);
  const base=new URL(env.SUPABASE_URL);if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co')||base.username||base.password||!env.SUPABASE_SECRET_KEY)throw new Error('Invalid configuration');
  const upstream=await fetchImpl(`${base.origin}/functions/v1/leave-form`,{method:'POST',redirect:'manual',headers:{apikey:env.SUPABASE_SECRET_KEY,'Content-Type':'application/json','x-region':'ap-southeast-1'},body:JSON.stringify({operation:action,client_ip:ip,body}),signal:AbortSignal.timeout(25000)});
  const data=await upstream.json();
  if(!upstream.ok){const status=[400,403,404,409,413,415,422,429].includes(upstream.status)?upstream.status:503;return respond({error:status===503?'Pengiriman belum dapat dikonfirmasi. Coba kembali dengan isi yang sama.':data.error||'Formulir belum dapat diproses.'},status);}
  if(data.ok!==true||!data.result||typeof data.result!=='object')throw new Error('Invalid response');
  const r=data.result;
  if(action==='context'){
   if(typeof r.name!=='string'||typeof r.today!=='string'||!Number.isInteger(r.available_days))throw new Error('Invalid context');
   return respond({today:r.today,name:r.name,unit_name:r.unit_name||'',position_name:r.position_name||'',available_days:r.available_days,reserved_days:r.reserved_days||0,approver:r.approver||null,can_request:r.can_request===true,expires_at:r.expires_at});
  }
  if(action==='preview'){
   if(!Array.isArray(r.dates)||!Number.isInteger(r.day_count)||typeof r.approver!=='string'||!Array.isArray(r.conflicts))throw new Error('Invalid preview');
   return respond({dates:r.dates,day_count:r.day_count,approver:r.approver,conflicts:r.conflicts});
  }
  if(typeof r.reference!=='string'||typeof r.status!=='string')throw new Error('Invalid receipt');
  return respond({reference:r.reference,status:r.status,duplicate:r.duplicate===true});
 }catch{return respond({error:'Pengiriman belum dapat dikonfirmasi. Periksa koneksi lalu coba kembali dengan isi yang sama.'},503);}
}
