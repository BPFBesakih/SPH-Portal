import {quickReportManagement,publicQuickReport,takeQuickReportSlot} from './lib/quick-reports.mjs';
import {createServer} from 'node:http';
import {readFileSync,existsSync,statSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDb,all,one,run,tx,audit,assert,AppError,now,uid} from './lib/db.mjs';
import {seedPermissions,authenticate,login,changePassword,safeUser,grants,cookies,digest,hashPassword,can,has,postContext,announcementsManager} from './lib/auth.mjs';
import {hrRoutes,employees} from './lib/hr.mjs';
import {securityRoutes} from './lib/security.mjs';
import {rosterRoutes} from './lib/roster.mjs';
import {adminRoutes} from './lib/admin.mjs';
import {announcementRoutes} from './lib/announcements.mjs';
import {dashboard,lookups} from './lib/read-models.mjs';
import {upload,download,attach} from './lib/files.mjs';
import {purchasingRoutes,purchasingPendingCount} from './lib/purchasing.mjs';

const root=fileURLToPath(new URL('.',import.meta.url));
function cookie(name,value,httpOnly=true,maxAge=8*3600){return `${name}=${value}; Path=/; SameSite=Strict; Max-Age=${maxAge}${httpOnly?'; HttpOnly':''}${process.env.COOKIE_SECURE==='true'?'; Secure':''}`;}
async function jsonBody(req) {
  const max=(Number(process.env.MAX_UPLOAD_MB)||10)*1400000+65536;let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;assert(size<=max,'Permintaan terlalu besar.',413);chunks.push(chunk);}
  if(!chunks.length)return {};
  assert((req.headers['content-type']||'').startsWith('application/json'),'Gunakan Content-Type application/json.',415);
  try{const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));assert(body&&typeof body==='object'&&!Array.isArray(body),'Isi permintaan harus objek.');return body;}catch(e){if(e instanceof AppError)throw e;throw new AppError(400,'JSON tidak valid.');}
}
export function createApp({db=openDb(),dataDir=resolve(process.env.DATA_DIR||'data'),origin=process.env.APP_ORIGIN||'http://127.0.0.1:3000'}={}) {
  if(process.env.NODE_ENV==='production')assert(origin.startsWith('https://')&&process.env.COOKIE_SECURE==='true','Mode produksi memerlukan APP_ORIGIN HTTPS dan COOKIE_SECURE=true.');
  seedPermissions(db);const attempts=new Map();
  function rateLimit(req,key){const ip=req.socket.remoteAddress||'unknown',k=ip+key,entry=attempts.get(k)||{count:0,until:Date.now()+15*60000};if(entry.until<Date.now()){entry.count=0;entry.until=Date.now()+15*60000;}entry.count++;attempts.set(k,entry);if(attempts.size>5000)for(const [key,v]of attempts)if(v.until<Date.now())attempts.delete(key);assert(entry.count<=30,'Terlalu banyak percobaan. Coba lagi 15 menit kemudian.',429);}
  const server=createServer(async(req,res)=> {
    const requestId=uid();res.setHeader('X-Request-Id',requestId);
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Permissions-Policy','camera=(self), microphone=(), geolocation=(self)');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if(process.env.COOKIE_SECURE==='true')res.setHeader('Strict-Transport-Security','max-age=31536000');
    const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    try {
      const url=new URL(req.url,'http://internal'),p=url.pathname.split('/').filter(Boolean).map(decodeURIComponent);const method=req.method;
      if(p[0]!=='api'){
        assert(['GET','HEAD'].includes(method),'Metode tidak diizinkan.',405);
        const pathname=url.pathname==='/'?'/index.html':['/laporan-cepat','/laporan-cepat/'].includes(url.pathname)?'/quick-report.html':url.pathname;
        assert(/^\/[a-zA-Z0-9/_-]+\.(html|js|css|svg|png|webp|ico|woff2)$/.test(pathname),'Halaman tidak ditemukan.',404);
        const path=resolve(root,'public',`.${pathname}`);assert(path.startsWith(resolve(root,'public')+String.fromCharCode(process.platform==='win32'?92:47))&&existsSync(path)&&statSync(path).isFile(),'Halaman tidak ditemukan.',404);
        const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(method==='HEAD'?undefined:readFileSync(path));return;
      }
      p.shift();
      if(p[0]==='health'&&method==='GET'){one(db,'SELECT 1');send({status:'ok'});return;}
      const mutating=!['GET','HEAD'].includes(method);
      if(mutating&&req.headers.origin)assert(req.headers.origin===origin,'Asal permintaan tidak diizinkan.',403);
      if(mutating&&req.headers['sec-fetch-site'])assert(req.headers['sec-fetch-site']!=='cross-site','Permintaan lintas situs ditolak.',403);
      const body=mutating?await jsonBody(req):{};
      if(p[0]==='quick-report'){
        assert(method==='POST'&&p.length===2,'Metode tidak diizinkan.',405);
        assert(req.headers.origin===origin&&req.headers['sec-fetch-site']!=='cross-site','Asal permintaan tidak diizinkan.',403);
        const allowed=tx(db,()=>takeQuickReportSlot(db,req.socket.remoteAddress,p[1]));assert(allowed,'Terlalu banyak percobaan. Coba lagi beberapa menit kemudian.',429);
        const result=tx(db,()=>publicQuickReport(db,p[1],body,dataDir,requestId));send(result);return;
      }
      if(p[0]==='auth'&&p[1]==='login'&&method==='POST') {
        rateLimit(req,'login');const result=await login(db,body,req);res.setHeader('Set-Cookie',[cookie('besakih_session',result.token,true,result.hours*3600),cookie('besakih_csrf',result.csrfToken,false,result.hours*3600)]);send({user:result.user,csrfToken:result.csrfToken});return;
      }
      if(p[0]==='auth'&&p[1]==='reset'&&method==='POST') {
        rateLimit(req,'reset');assert(typeof body.token==='string','Kredensial pemulihan tidak valid.');const token=one(db,'SELECT * FROM password_reset_tokens WHERE token_hash=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>?',digest(body.token),now());assert(token,'Kredensial pemulihan tidak valid atau kedaluwarsa.');const hash=await hashPassword(body.new_password);
        tx(db,()=>{assert(one(db,'SELECT id FROM password_reset_tokens WHERE id=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>?',token.id,now()),'Kredensial sudah dipakai.');run(db,'UPDATE users SET password_hash=?,must_change_password=0,failed_login_count=0,locked_until=NULL,password_changed_at=?,row_version=row_version+1 WHERE id=?',hash,now(),token.user_id);run(db,'UPDATE password_reset_tokens SET consumed_at=? WHERE id=?',now(),token.id);run(db,'UPDATE auth_sessions SET revoked_at=? WHERE user_id=?',now(),token.user_id);audit(db,{id:token.user_id},'PASSWORD_RESET','users',token.user_id);});send({ok:true});return;
      }
      const user=authenticate(db,req);user.request_id=requestId;
      if(mutating)assert(typeof req.headers['x-csrf-token']==='string'&&digest(req.headers['x-csrf-token'])===user.session.csrf_hash,'Token keamanan tidak valid. Muat ulang halaman.',403);
      if(p[0]==='auth'&&p[1]==='me'&&method==='GET'){
        const token=cookies(req.headers.cookie).besakih_csrf;send({user:safeUser(user),name:user.employee_id?one(db,'SELECT full_name FROM employees WHERE id=?',user.employee_id)?.full_name:user.username,csrfToken:token&&digest(token)===user.session.csrf_hash?token:null,permissions:[...new Set(grants(db,user).map(g=>g.code))],announcements_manage:announcementsManager(db,user),purchasing_pending:purchasingPendingCount(db,user),demo:one(db,"SELECT value FROM app_settings WHERE key='demo_mode'").value==='true'});return;
      }
      if(p[0]==='auth'&&p[1]==='logout'&&method==='POST'){run(db,'UPDATE auth_sessions SET revoked_at=? WHERE id=?',now(),user.session.id);res.setHeader('Set-Cookie',[cookie('besakih_session','',true,0),cookie('besakih_csrf','',false,0)]);send({ok:true});return;}
      if(p[0]==='auth'&&p[1]==='password'&&method==='POST'){await changePassword(db,user,body);send({ok:true});return;}
      assert(!user.must_change_password,'Anda wajib mengganti password sementara terlebih dahulu.',428);
      if(p[0]==='dashboard'&&method==='GET'){send(dashboard(db,user,url.searchParams.get('module')||'hr',url.searchParams.get('as_of')||undefined));return;}
      if(p[0]==='lookups'&&method==='GET'){send(lookups(db,user,url.searchParams.get('purpose')||'employees',url.searchParams.get('session_id')));return;}
      if(p[0]==='exports'&&method==='GET'){
        const cell=v=>'"'+String(v??'').replace(/^[=+\-@\t\r]/,"'$&").replaceAll('"','""')+'"';let rows,filename;
        if(p[1]==='employees'){assert(has(db,user,'hr.employees.export'),'Akses ekspor ditolak.',403);rows=[['Nomor pegawai','Nama','Unit','Posisi','Status','Tanggal mulai','Aktif'],...employees(db).filter(e=>can(db,user,'hr.employees.read',e)&&can(db,user,'hr.employees.export',e)).map(e=>[e.employee_no,e.full_name,e.unit_name,e.position_name,e.employment_status,e.joined_on,e.is_active?'Ya':'Tidak'])];filename='pegawai-besakih.csv';}
        else if(p[1]==='revisions'&&p[2]){const revision=await rosterRoutes({db,user,p:['revisions',p[2]],method:'GET',body:{},url});assert(has(db,user,'security.roster.export'),'Akses ekspor ditolak.',403);rows=[['Tanggal tugas','Nomor pegawai','Nama','Pos','Shift','Mulai UTC','Selesai UTC','Sumber'],...revision.assignments.filter(a=>can(db,user,'security.roster.export',{...a,...postContext(db,a.post_id)})).map(a=>[a.service_date,a.display.employee_no,a.display.employee_name,a.display.post_name,a.display.shift_name,a.starts_at,a.ends_at,a.origin])];filename=`jadwal-revisi-${revision.revision_no}.csv`;}
        else throw new AppError(404,'Jenis ekspor tidak ditemukan.');
        audit(db,user,'EXPORT',p[1],p[2]||'list',{row_count:rows.length-1});send({filename,csv:rows.map(row=>row.map(cell).join(',')).join('\r\n')});return;
      }
      if(p[0]==='uploads'&&method==='POST'){send(upload(db,user,body,dataDir),201);return;}
      if(p[0]==='attachments'&&method==='POST'){send(attach(db,user,body.type,body.owner_id,body),201);return;}
      if(p[0]==='files'&&p[1]&&method==='GET') {const {file,data}=download(db,user,p[1],dataDir);res.writeHead(200,{'Content-Type':file.mime_type,'Content-Disposition':`${url.searchParams.get('inline')==='1'&&['image/png','image/jpeg'].includes(file.mime_type)?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,'Content-Length':data.length,'Cache-Control':'private, no-store'});res.end(data);return;}
      const ctx={db,user,p,method,body,url};
      for(const handler of [quickReportManagement,announcementRoutes,hrRoutes,securityRoutes,rosterRoutes,adminRoutes,purchasingRoutes]){const result=await handler(ctx);if(result!==undefined){send(result,method==='POST'?201:200);return;}}
      throw new AppError(404,'Alamat API tidak ditemukan.');
    } catch(error) {
      const conflict=/UNIQUE constraint/.test(error.message),invalid=/FOREIGN KEY constraint|CHECK constraint|NOT NULL constraint/.test(error.message);
      const status=error.status||(conflict?409:invalid?422:500);
      if(status===500)console.error(`[${requestId}]`,error.stack);
      if(!res.headersSent)send({error:error.status?error.message:conflict?'Kode, nomor, atau relasi tersebut sudah ada.':invalid?'Relasi atau nilai data tidak valid.':'Terjadi kesalahan server.',request_id:requestId,details:error.details},status);else res.end();
    }
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  return {server,db};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const app=createApp();const port=Number(process.env.PORT)||3000,host=process.env.HOST||'127.0.0.1';app.server.listen(port,host,()=>console.log(`Portal Besakih: http://${host==='0.0.0.0'?'localhost':host}:${port}`));
  for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>app.server.close(()=>{app.db.close();process.exit(0);}));
}
