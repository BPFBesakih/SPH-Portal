const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
const respond=(body,status=200)=>Response.json(body,{status,headers});
export async function handleBriefingLink(request,env,fetchImpl=globalThis.fetch.bind(globalThis)){
  try{
    const url=new URL(request.url),action=url.pathname.split('/').at(-1);
    if(!/^\/api\/briefing-link\/(context|submit)$/.test(url.pathname)||url.search)return respond({error:'Alamat tidak ditemukan.'},404);
    if(request.method!=='POST')return respond({error:'Gunakan formulir briefing.'},405);
    const origin=new URL(env.PORTAL_ORIGIN);if(origin.protocol!=='https:'||origin.origin!==env.PORTAL_ORIGIN)throw new Error('Invalid origin');
    const allowed=[origin.origin];if(env.PORTAL_LEGACY_ORIGIN){const legacy=new URL(env.PORTAL_LEGACY_ORIGIN);if(legacy.protocol!=='https:'||legacy.origin!==env.PORTAL_LEGACY_ORIGIN)throw new Error('Invalid origin');allowed.push(legacy.origin);}
    if(!allowed.includes(url.origin)||request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return respond({error:'Buka formulir melalui tautan yang diberikan pengelola.'},403);
    if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))return respond({error:'Isi permintaan tidak valid.'},415);
    const clientIp=request.headers.get('CF-Connecting-IP');if(!clientIp||clientIp.length>45||!/^[a-f0-9:.]+$/i.test(clientIp))return respond({error:'Jalur pengiriman tidak valid.'},400);
    const limit=action==='context'?4096:14*1024*1024+65536,reader=request.body?.getReader();if(!reader)return respond({error:'Isi permintaan kosong.'},400);
    let size=0;const chunks=[];
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();return respond({error:'Ukuran kiriman terlalu besar. Pilih foto maksimal 10 MB.'},413);}chunks.push(value);}}finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return respond({error:'Isi permintaan tidak valid.'},400);}
    if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))return respond({error:'Tautan briefing tidak aktif. Minta tautan terbaru kepada pengelola.'},404);
    const base=new URL(env.SUPABASE_URL);if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co')||base.username||base.password||typeof env.SUPABASE_SECRET_KEY!=='string'||!env.SUPABASE_SECRET_KEY)throw new Error('Invalid configuration');
    const upstream=await fetchImpl(`${base.origin}/functions/v1/briefing-native`,{method:'POST',redirect:'manual',headers:{apikey:env.SUPABASE_SECRET_KEY,'Content-Type':'application/json','x-region':'ap-southeast-1'},body:JSON.stringify({operation:action,client_ip:clientIp,body}),signal:AbortSignal.timeout(40000)});
    const data=await upstream.json();
    if(!upstream.ok){const status=[400,403,404,409,413,422,429].includes(upstream.status)?upstream.status:503;return respond({error:status===503?'Pengiriman belum dapat dikonfirmasi. Coba kirim kembali; briefing yang sama tidak akan digandakan.':typeof data.error==='string'?data.error:'Briefing belum dapat dikirim.'},status);}
    if(data.ok!==true||!data.result||typeof data.result!=='object')throw new Error('Invalid response');
    if(action==='context'){
      if(typeof data.result.label!=='string'||typeof data.result.today!=='string'||!Array.isArray(data.result.employees))throw new Error('Invalid context');
      return respond({label:data.result.label,today:data.result.today,employees:data.result.employees.map(e=>({id:e.id,full_name:e.full_name,position_name:e.position_name,org_unit_id:e.org_unit_id,unit_name:e.unit_name,job_title:e.job_title,...(e.disabled?{disabled:true}:{})}))});
    }
    if(typeof data.result.reference!=='string'||typeof data.result.received_at!=='string')throw new Error('Invalid receipt');
    return respond({reference:data.result.reference,received_at:data.result.received_at});
  }catch{return respond({error:'Pengiriman belum dapat dikonfirmasi. Periksa koneksi lalu coba kembali.'},503);}
}
