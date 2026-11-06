import {distanceMeters,readiness,summarizeAttendance,punchProblem,witaDate,validDay,iso} from './attendance-rules.mjs';

const fail=(ok,message,status=422)=>{if(!ok){const e=new Error(message);e.status=status;throw e;}};
const q=(db,sql,args=[])=>db.query(sql,args);
const one=async(db,sql,args=[])=>(await q(db,sql,args))[0];
const text=(v,label,max=1000)=>{fail(typeof v==='string'&&v.trim()&&v.length<=max,`${label} wajib diisi, maksimal ${max} karakter.`);return v.trim();};
const day=v=>{fail(validDay(v),'Tanggal tidak valid.');return v;};
const ymd=v=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
const num=(v,label,min,max)=>{fail(typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max,`${label} tidak valid.`);return v;};
const instant=v=>{fail(typeof v==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v)),'Waktu wajib valid dan memuat zona waktu.');return iso(v);};
const key=v=>{fail(typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),'Identitas permintaan tidak valid.');return v;};
const hash=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof v==='string'?new TextEncoder().encode(v):v))).map(n=>n.toString(16).padStart(2,'0')).join('');
const b64=bytes=>{let result='';for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(result);};
const requiredTables=['attendance_config','attendance_locations','attendance_schedules'];
async function installed(db){const r=await q(db,"SELECT tablename FROM pg_tables WHERE schemaname='portal' AND tablename=ANY($1::text[])",[requiredTables]);return r.length===requiredTables.length;}
async function configOf(db){return one(db,'SELECT * FROM attendance_config WHERE id=1');}
async function employee(db,id,clock){
 const e=await one(db,`SELECT e.id,e.employee_no,e.full_name,e.is_active,
  (SELECT p.org_unit_id FROM employee_placements ep JOIN positions p ON p.id=ep.position_id
   WHERE ep.employee_id=e.id AND ep.is_primary=1 AND ep.valid_from<=$2 AND (ep.valid_to IS NULL OR ep.valid_to>=$2)
   ORDER BY ep.valid_from DESC,ep.id LIMIT 1) org_unit_id FROM employees e WHERE e.id=$1`,[id,witaDate(clock)]);
 fail(e,'Pegawai belum terhubung.',403);return {...e,employee_id:e.id};
}
async function capability(ctx,permission,who){return ctx.services.can(ctx.db,ctx.user,'hr.attendance.'+permission,who||{});}
async function requireCap(ctx,permission,who){fail(await capability(ctx,permission,who),'Anda tidak berwenang untuk tindakan atau cakupan ini.',403);}
async function own(ctx){fail(ctx.user.employee_id,'Akun belum terhubung dengan data pegawai.',403);const who=await employee(ctx.db,ctx.user.employee_id,ctx.clock);fail(who.is_active===1,'Pegawai sudah tidak aktif.',403);return who;}
async function profileOf(db,id){return await one(db,'SELECT * FROM attendance_employee_settings WHERE employee_id=$1',[id])||{employee_id:id,enabled:false,location_mode:'DEFAULT',location_id:null,active_from:null,row_version:0};}
async function locationOf(db,profile){
 const location=profile.location_mode==='CUSTOM'?await one(db,'SELECT * FROM attendance_locations WHERE id=$1',[profile.location_id]):await one(db,'SELECT * FROM attendance_locations WHERE is_default=true');
 fail(location&&location.is_active,'Titik absensi belum tersedia atau tidak aktif. Hubungi pengelola.',409);return location;
}
function active(config,profile,date){return !!(config.enabled&&config.activation_on&&profile.enabled&&profile.active_from&&date>=ymd(config.activation_on)&&date>=ymd(profile.active_from));}
function requireActive(config,profile,date){fail(!readiness(config).length&&active(config,profile,date),'Absensi belum diaktifkan untuk pegawai/tanggal ini. Hubungi pengelola.',409);}
async function loadResult(ctx,schedule,config,profile){
 const events=await q(ctx.db,'SELECT id,kind,received_at,evidence_id,policy_snapshot FROM attendance_events WHERE schedule_id=$1',[schedule.id]);
 const correction=await one(ctx.db,'SELECT * FROM attendance_corrections WHERE schedule_id=$1 ORDER BY revision DESC LIMIT 1',[schedule.id]);
 const requests=await q(ctx.db,"SELECT kind,status FROM attendance_requests WHERE employee_id=$1 AND work_date=$2 AND status IN ('PENDING','APPROVED')",[schedule.employee_id,ymd(schedule.work_date)]);
 const leave=await one(ctx.db,`SELECT 1 FROM leave_requests r JOIN leave_request_days d ON d.request_id=r.id
  WHERE r.employee_id=$1 AND r.status='APPROVED' AND d.work_date=$2 LIMIT 1`,[schedule.employee_id,ymd(schedule.work_date)]);
 return resultOf(ctx,schedule,config,profile,events,correction,requests,!!leave);
}
function resultOf(ctx,schedule,config,profile,events,correction,requests,leave){
 const absence=leave?{kind:'LEAVE'}:requests.find(r=>r.status==='APPROVED')||(requests.length?{kind:'PENDING'}:null);
 const historic=events.find(e=>e.kind==='IN')?.policy_snapshot;
 const effectiveConfig=historic?.config||schedule.policy_snapshot?.config||config;
 const effectiveSchedule=historic?.schedule||schedule;
 return {schedule:{...schedule,policy_snapshot:undefined,work_date:ymd(schedule.work_date)},...summarizeAttendance(effectiveSchedule,events,correction,absence,effectiveConfig,ctx.clock,!!historic||schedule.policy_snapshot?.eligible===true),events:events.map(({policy_snapshot,...e})=>e),correction:correction?{id:correction.id,reason:correction.reason,revision:correction.revision,created_at:correction.created_at}:null};
}
async function audit(ctx,action,id,summary={},reason=''){return ctx.services.audit(ctx.db,ctx.user,action,'attendance',id,summary,reason);}
async function evidence(ctx,who,purpose,input,config){
 fail(input&&['image/jpeg','image/png',...(purpose==='REQUEST'?['application/pdf']:[])].includes(input.mime_type),'Jenis bukti tidak diizinkan.');
 fail(typeof input.data==='string'&&input.data.length<=2796204&&/^[A-Za-z0-9+/]+={0,2}$/.test(input.data),'Isi bukti tidak valid atau terlalu besar.');
 let bytes;try{bytes=Uint8Array.from(atob(input.data),c=>c.charCodeAt(0));}catch{fail(false,'Bukti tidak valid.');}
 fail(bytes.length>0&&bytes.length<=2097152&&b64(bytes)===input.data,'Bukti maksimal 2 MB dan harus berupa base64 valid.');
 const valid=input.mime_type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217:input.mime_type==='image/png'?[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v):new TextDecoder().decode(bytes.subarray(0,5))==='%PDF-';
 fail(valid,'Isi bukti tidak sesuai jenis berkas.');
 const checksum=await hash(bytes),storageKey=await ctx.db.storage.put(bytes,input.mime_type),id=crypto.randomUUID();
 await q(ctx.db,`INSERT INTO attendance_evidence(id,employee_id,purpose,storage_key,mime_type,size_bytes,checksum,created_by,created_at,expires_at)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,who.id,purpose,storageKey,input.mime_type,bytes.length,checksum,ctx.user.id,ctx.clock,new Date(Date.parse(ctx.clock)+config.evidence_retention_days*86400000).toISOString()]);
 return id;
}
const publicReceipt=r=>({id:r.id,schedule_id:r.schedule_id,kind:r.kind,received_at:r.received_at,client_key:r.client_key,distance_m:r.distance_m});
async function punch(ctx){
 const {db,user,body,clock}=ctx,who=await own(ctx);fail(!('employee_id' in body),'Identitas pegawai ditentukan dari sesi.',403);
 const clientKey=key(body.client_key);fail(['IN','OUT'].includes(body.kind),'Jenis absensi tidak valid.');
 const payloadHash=await hash(JSON.stringify({schedule_id:body.schedule_id,kind:body.kind,latitude:body.latitude,longitude:body.longitude,accuracy_m:body.accuracy_m,location_read_at:body.location_read_at,photo:body.photo}));
 await q(db,'SELECT id FROM employees WHERE id=$1 FOR UPDATE',[who.id]);
 const prior=await one(db,'SELECT * FROM attendance_events WHERE employee_id=$1 AND client_key=$2',[who.id,clientKey]);
 if(prior){fail(prior.payload_hash===payloadHash,'Identitas permintaan sudah dipakai untuk data berbeda.',409);return {receipt:publicReceipt(prior),replayed:true};}
 fail(ctx.services.collectionEnabled===true,'Penerimaan absensi belum dibuka oleh pengelola.',409);
 const config=await configOf(db),profile=await profileOf(db,who.id);
 const schedule=await one(db,'SELECT * FROM attendance_schedules WHERE id=$1 AND employee_id=$2 FOR UPDATE',[body.schedule_id,who.id]);
 fail(schedule,'Jadwal belum tersedia. Hubungi pengelola.',409);requireActive(config,profile,ymd(schedule.work_date));
 const result=await loadResult(ctx,schedule,config,profile),problem=punchProblem(schedule,result,body.kind,clock,schedule.policy_snapshot?.config||config);fail(!problem,problem,409);
 fail(!result.events.some(e=>e.kind===body.kind),'Absen sudah tercatat. Perubahan melalui koreksi pengelola.',409);
 const lat=num(body.latitude,'Latitude',-90,90),lon=num(body.longitude,'Longitude',-180,180),accuracy=num(body.accuracy_m,'Akurasi lokasi',0.01,config.gps_max_accuracy_m),readAt=instant(body.location_read_at);
 const age=Date.parse(clock)-Date.parse(readAt);fail(age>=-5000&&age<=config.gps_max_age_seconds*1000,'Lokasi sudah usang atau waktu lokasi tidak valid. Baca ulang GPS.');
 const location=await locationOf(db,profile),distance=distanceMeters(lat,lon,location.latitude,location.longitude);
 fail(profile.location_mode==='UNRESTRICTED'||distance<=location.radius_m,`Di luar radius absensi (${distance.toFixed(2)} m; batas ${location.radius_m} m).`);
 fail(body.capture_source==='CAMERA','Selfie harus diambil melalui kamera saat absensi.');
 const evidenceId=await evidence(ctx,who,'SELFIE',body.photo,config),id=crypto.randomUUID();
 const snapshot={config:schedule.policy_snapshot?.config||config,schedule,location,location_mode:profile.location_mode};
 await q(db,`INSERT INTO attendance_events(id,schedule_id,employee_id,kind,received_at,client_key,payload_hash,evidence_id,latitude,longitude,accuracy_m,location_read_at,distance_m,policy_snapshot,created_by)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)`,[id,schedule.id,who.id,body.kind,clock,clientKey,payloadHash,evidenceId,lat,lon,accuracy,readAt,distance,JSON.stringify(snapshot),user.id]);
 await audit(ctx,'ATTENDANCE_'+body.kind,id,{employee_id:who.id,schedule_id:schedule.id});
 return {receipt:publicReceipt(await one(db,'SELECT * FROM attendance_events WHERE id=$1',[id])),replayed:false};
}
async function me(ctx){
 const config=await configOf(ctx.db),date=witaDate(ctx.clock);
 const capabilities=Object.fromEntries(await Promise.all(['read','export','approve','correct','evidence','schedule','settings'].map(async p=>[p,p==='settings'?await capability(ctx,p):await ctx.services.has(ctx.db,ctx.user,'hr.attendance.'+p)])));
 let who;try{who=await own(ctx);}catch(e){if(e.status!==403)throw e;return {employee:null,server_time:ctx.clock,timezone:'Asia/Makassar',config,capabilities,actions:{in:false,out:false},reason:e.message};}
 const profile=await profileOf(ctx.db,who.id);
 let location=null,locationError='';try{location=await locationOf(ctx.db,profile);}catch(e){locationError=e.message;}
 const schedules=await q(ctx.db,`SELECT * FROM attendance_schedules WHERE employee_id=$1 AND status='PUBLISHED'
  AND (work_date=$2 OR (checkin_opens_at<=$3 AND checkout_closes_at>=$3)) ORDER BY starts_at`,[who.id,date,ctx.clock]);
 const ongoing=schedules.filter(s=>Date.parse(ctx.clock)>=Date.parse(s.checkin_opens_at)&&Date.parse(ctx.clock)<=Date.parse(s.checkout_closes_at)+59999);
 const schedule=ongoing.length===1?ongoing[0]:ongoing.length>1?null:schedules.find(s=>ymd(s.work_date)===date);
 const result=schedule?await loadResult(ctx,schedule,config,profile):null;
 const ready=ctx.services.collectionEnabled===true&&!readiness(config).length&&active(config,profile,schedule?ymd(schedule.work_date):date)&&!locationError;
 const reason=ctx.services.collectionEnabled!==true?'Penerimaan absensi belum dibuka oleh pengelola.':!config.enabled?'Modul absensi belum diaktifkan.':!profile.enabled?'Absensi akun ini belum diaktifkan.':readiness(config).length?'Kebijakan absensi belum lengkap.':ongoing.length>1?'Jadwal bertumpang tindih. Hubungi pengelola.':!schedule?'Jadwal belum tersedia. Hubungi pengelola.':locationError||(!ready?'Aktivasi belum berlaku untuk tanggal ini.':'');
 return {employee:who,server_time:ctx.clock,timezone:'Asia/Makassar',config,profile,location,result,reason,
  actions:{in:ready&&!!result&&!reason&&!result.events.some(e=>e.kind==='IN')&&!punchProblem(schedule,result,'IN',ctx.clock,schedule.policy_snapshot?.config||config),out:ready&&!!result&&!reason&&!result.events.some(e=>e.kind==='OUT')&&!punchProblem(schedule,result,'OUT',ctx.clock,schedule.policy_snapshot?.config||config)},
  capabilities};
}
function period(url,clock){const d=witaDate(clock),from=day(url.searchParams.get('from')||d.slice(0,8)+'01'),to=day(url.searchParams.get('to')||d);fail(from<=to&&Date.parse(to)-Date.parse(from)<=366*86400000,'Periode maksimal 367 hari dan tanggal awal tidak boleh melewati akhir.');return {from,to};}
async function records(ctx,exporting=false){
 const range=period(ctx.url,ctx.clock),config=await configOf(ctx.db),scope=ctx.url.searchParams.get('scope')==='all'?'all':'self';
 if(scope==='self')await own(ctx);
 if(scope==='all')fail(await ctx.services.has(ctx.db,ctx.user,'hr.attendance.'+(exporting?'export':'read')),'Akses rekap ditolak.',403);
 const schedules=await q(ctx.db,`SELECT s.*,e.full_name,e.employee_no FROM attendance_schedules s JOIN employees e ON e.id=s.employee_id
  WHERE s.work_date BETWEEN $1 AND $2 AND ($3::text IS NULL OR s.employee_id=$3) ORDER BY s.work_date DESC,e.full_name LIMIT 10001`,[range.from,range.to,scope==='self'?ctx.user.employee_id:null]);
 fail(schedules.length<=10000,'Terlalu banyak data. Persempit periode laporan.');
 const rows=[],cache=new Map(),ids=schedules.map(s=>s.id),employeeIds=[...new Set(schedules.map(s=>s.employee_id))];
 const allEvents=await q(ctx.db,'SELECT id,schedule_id,kind,received_at,evidence_id,policy_snapshot FROM attendance_events WHERE schedule_id=ANY($1::text[])',[ids]);
 const allCorrections=await q(ctx.db,'SELECT DISTINCT ON (schedule_id) * FROM attendance_corrections WHERE schedule_id=ANY($1::text[]) ORDER BY schedule_id,revision DESC',[ids]);
 const allRequests=await q(ctx.db,"SELECT employee_id,work_date,kind,status FROM attendance_requests WHERE employee_id=ANY($1::text[]) AND work_date BETWEEN $2 AND $3 AND status IN ('PENDING','APPROVED')",[employeeIds,range.from,range.to]);
 const allLeaves=await q(ctx.db,"SELECT r.employee_id,d.work_date FROM leave_requests r JOIN leave_request_days d ON d.request_id=r.id WHERE r.status='APPROVED' AND r.employee_id=ANY($1::text[]) AND d.work_date BETWEEN $2 AND $3",[employeeIds,range.from,range.to]);
 const groups=(list,key)=>{const m=new Map();for(const r of list){const k=key(r);if(!m.has(k))m.set(k,[]);m.get(k).push(r);}return m;};
 const events=groups(allEvents,r=>r.schedule_id),corrections=new Map(allCorrections.map(r=>[r.schedule_id,r])),requestsByDay=groups(allRequests,r=>r.employee_id+'/'+ymd(r.work_date)),leaveDays=new Set(allLeaves.map(r=>r.employee_id+'/'+ymd(r.work_date)));
 for(const s of schedules){
  if(!cache.has(s.employee_id)){const who=await employee(ctx.db,s.employee_id,ctx.clock);cache.set(s.employee_id,{who,profile:await profileOf(ctx.db,s.employee_id),allowed:scope==='self'||await capability(ctx,exporting?'export':'read',who)});}
  const c=cache.get(s.employee_id);if(!c.allowed)continue;
  const k=s.employee_id+'/'+ymd(s.work_date),result=resultOf(ctx,s,config,c.profile,events.get(s.id)||[],corrections.get(s.id),requestsByDay.get(k)||[],leaveDays.has(k));delete result.events;rows.push({...result,employee_name:s.full_name,employee_no:s.employee_no});
 }
 if(scope==='all')fail(await ctx.services.has(ctx.db,ctx.user,'hr.attendance.'+(exporting?'export':'read')),'Akses rekap ditolak.',403);
 if(exporting)await audit(ctx,'ATTENDANCE_EXPORT',scope,{...range,count:rows.length});
 return {items:rows,...range,timezone:'Asia/Makassar',generated_at:ctx.clock};
}
async function requests(ctx){
 const all=ctx.url.searchParams.get('scope')==='all';if(!all)await own(ctx);
 const range=period(ctx.url,ctx.clock),rows=await q(ctx.db,`SELECT r.*,e.full_name employee_name FROM attendance_requests r JOIN employees e ON e.id=r.employee_id
 WHERE r.work_date BETWEEN $1 AND $2 AND ($3::text IS NULL OR r.employee_id=$3) ORDER BY r.created_at DESC LIMIT 2001`,[range.from,range.to,all?null:ctx.user.employee_id]);
 fail(rows.length<=2000,'Persempit periode pengajuan.');const items=[];
 for(const r of rows){const who=await employee(ctx.db,r.employee_id,ctx.clock);if(!all||await capability(ctx,'approve',who))items.push({...r,payload_hash:undefined,client_key:undefined,work_date:ymd(r.work_date)});}
 if(all)fail(await ctx.services.has(ctx.db,ctx.user,'hr.attendance.approve'),'Akses pemeriksaan pengajuan ditolak.',403);return {items};
}
async function requestCreate(ctx){
 const {body,db}=ctx,who=await own(ctx);fail(!('employee_id' in body),'Pengajuan hanya untuk pegawai yang login.',403);
 const clientKey=key(body.client_key),date=day(body.work_date),kind=body.kind,reason=text(body.reason,'Alasan',2000),config=await configOf(db),profile=await profileOf(db,who.id);
 const payloadHash=await hash(JSON.stringify({date,kind,reason,evidence:body.evidence}));
 await q(db,'SELECT id FROM employees WHERE id=$1 FOR UPDATE',[who.id]);
 const prior=await one(db,'SELECT id,payload_hash,status FROM attendance_requests WHERE employee_id=$1 AND client_key=$2',[who.id,clientKey]);
 if(prior){fail(prior.payload_hash===payloadHash,'Identitas permintaan sudah dipakai untuk data berbeda.',409);return {id:prior.id,status:prior.status,replayed:true};}
 fail(ctx.services.collectionEnabled===true,'Penerimaan pengajuan absensi belum dibuka.',409);
 requireActive(config,profile,date);fail(config.request_day_mode==='SINGLE_DAY','Kebijakan durasi Sakit/Izin belum ditetapkan.',409);
 fail(['SICK','PERMIT'].includes(kind),'Jenis pengajuan tidak valid.');const today=witaDate(ctx.clock),tomorrow=witaDate(new Date(Date.parse(ctx.clock)+86400000));
 fail(kind==='PERMIT'?date>today:date===today||date===tomorrow,kind==='PERMIT'?'Izin wajib diajukan sebelum hari pelaksanaan.':'Sakit diajukan pada hari H atau H-1.');
 fail(!await one(db,"SELECT id FROM attendance_requests WHERE employee_id=$1 AND work_date=$2 AND status IN ('PENDING','APPROVED')",[who.id,date]),'Sudah ada pengajuan aktif pada tanggal ini.',409);
 const evidenceId=await evidence(ctx,who,'REQUEST',body.evidence,config),id=crypto.randomUUID();
 await q(db,'INSERT INTO attendance_requests(id,employee_id,kind,work_date,reason,evidence_id,client_key,payload_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,who.id,kind,date,reason,evidenceId,clientKey,payloadHash,ctx.user.id]);
 await audit(ctx,'ATTENDANCE_REQUEST',id,{employee_id:who.id,work_date:date,kind});return {id,status:'PENDING'};
}
async function decision(ctx,id){
 const r=await one(ctx.db,'SELECT * FROM attendance_requests WHERE id=$1 FOR UPDATE',[id]);fail(r,'Pengajuan tidak ditemukan.',404);
 const who=await employee(ctx.db,r.employee_id,ctx.clock);await requireCap(ctx,'approve',who);await requireCap(ctx,'evidence',who);
 fail(r.created_by!==ctx.user.id&&r.employee_id!==ctx.user.employee_id,'Pengajuan sendiri harus diperiksa pengelola berwenang lainnya.',403);
 fail(r.status==='PENDING'&&r.row_version===ctx.body.row_version,'Pengajuan sudah berubah. Muat ulang.',409);
 const status=ctx.body.status;fail(['APPROVED','REJECTED'].includes(status),'Keputusan tidak valid.');fail(ctx.body.evidence_reviewed===true,'Periksa bukti pendukung terlebih dahulu.');
 const note=status==='REJECTED'?text(ctx.body.note,'Alasan penolakan'):String(ctx.body.note||'').slice(0,1000);
 await q(ctx.db,'UPDATE attendance_requests SET status=$1,decision_note=$2,decided_by=$3,decided_at=$4,row_version=row_version+1 WHERE id=$5',[status,note,ctx.user.id,ctx.clock,id]);
 await audit(ctx,'ATTENDANCE_'+status,id,{employee_id:r.employee_id},note);return {ok:true};
}
async function correct(ctx,id){
 const schedule=await one(ctx.db,'SELECT * FROM attendance_schedules WHERE id=$1 FOR UPDATE',[id]);fail(schedule,'Jadwal tidak ditemukan.',404);
 await requireCap(ctx,'correct',await employee(ctx.db,schedule.employee_id,ctx.clock));fail(schedule.row_version===ctx.body.row_version,'Catatan sudah berubah. Muat ulang.',409);
 const config=schedule.policy_snapshot?.config||await configOf(ctx.db),profile=await profileOf(ctx.db,schedule.employee_id);fail(schedule.status==='PUBLISHED'&&schedule.policy_snapshot?.eligible,'Koreksi hanya untuk jadwal terbit yang telah aktif.',409);
 const before=await loadResult(ctx,schedule,config,profile),reason=text(ctx.body.reason,'Alasan koreksi',2000);
 const input=ctx.body.in_at?instant(ctx.body.in_at):null,output=ctx.body.out_at?instant(ctx.body.out_at):null;
 fail(!output||!!input,'Catatan keluar memerlukan jam masuk.');fail(!output||Date.parse(output)>=Date.parse(input),'Jam keluar harus setelah masuk.');
 for(const v of [input,output].filter(Boolean))fail(Date.parse(v)>=Date.parse(schedule.checkin_opens_at)&&Date.parse(v)<=Date.parse(schedule.checkout_closes_at)+(config.boundary_mode==='WHOLE_MINUTE'?59999:0),'Jam koreksi harus berada dalam jendela penugasan.');
 const id2=crypto.randomUUID(),revision=schedule.row_version+1;
 await q(ctx.db,'INSERT INTO attendance_corrections(id,schedule_id,revision,before_value,after_value,reason,actor_id) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)',[id2,id,revision,JSON.stringify({in_at:before.in_at,out_at:before.out_at}),JSON.stringify({in_at:input,out_at:output}),reason,ctx.user.id]);
 await q(ctx.db,'UPDATE attendance_schedules SET row_version=$1,updated_at=$2 WHERE id=$3',[revision,ctx.clock,id]);
 await audit(ctx,'ATTENDANCE_CORRECTION',id,{revision,before:{in_at:before.in_at,out_at:before.out_at},after:{in_at:input,out_at:output}},reason);return {ok:true};
}
async function scheduleSave(ctx){
 const b=ctx.body,who=await employee(ctx.db,b.employee_id,ctx.clock);await requireCap(ctx,'schedule',who);
 await q(ctx.db,'SELECT id FROM employees WHERE id=$1 FOR UPDATE',[who.id]);
 const date=day(b.work_date),name=text(b.name,'Nama jadwal',80),kind=b.day_kind;fail(['WORK','OFF'].includes(kind),'Jenis hari tidak valid.');
 const times=['starts_at','ends_at','checkin_opens_at','checkin_closes_at','checkout_closes_at','late_after'].map(k=>instant(b[k])),[start,end,opens,closes,checkout,late]=times;
 fail(ymd(date)===witaDate(start),'Tanggal kerja mengikuti tanggal mulai penugasan WITA.');
 fail(start<end&&Date.parse(end)-Date.parse(start)<=36*3600000&&opens<=start&&closes>start&&closes<=end&&checkout>=end&&late>=start&&late<end,'Urutan waktu jadwal tidak valid.');
 const prior=await one(ctx.db,'SELECT * FROM attendance_schedules WHERE employee_id=$1 AND work_date=$2 FOR UPDATE',[who.id,date]);
 if(prior?.status==='PUBLISHED')fail(Date.parse(ctx.clock)<=Date.parse(prior.checkout_closes_at),'Jadwal terbit yang telah ditutup tidak dapat diubah. Gunakan koreksi.',409);
 if(prior){fail(prior.row_version===b.row_version,'Jadwal sudah berubah. Muat ulang.',409);fail(!await one(ctx.db,'SELECT id FROM attendance_events WHERE schedule_id=$1 UNION ALL SELECT id FROM attendance_corrections WHERE schedule_id=$1 LIMIT 1',[prior.id]),'Jadwal yang memiliki catatan tidak dapat diubah. Gunakan koreksi beralasan.',409);}
 const id=prior?.id||crypto.randomUUID(),status=b.status;fail(['DRAFT','PUBLISHED'].includes(status),'Status jadwal tidak valid.');
 let snapshot=null;
 if(status==='PUBLISHED'){
  fail(who.is_active===1,'Pegawai sudah tidak aktif.',409);
  const config=await configOf(ctx.db),profile=await profileOf(ctx.db,who.id);requireActive(config,profile,date);
  fail(date>=witaDate(ctx.clock)&&Date.parse(checkout)>=Date.parse(ctx.clock),'Jadwal lampau tidak dapat diterbitkan untuk membuat alpa secara retroaktif.',409);
  snapshot={eligible:true,config};
 }
 if(status==='PUBLISHED')fail(!await one(ctx.db,"SELECT id FROM attendance_schedules WHERE employee_id=$1 AND status='PUBLISHED' AND id<>$2 AND checkin_opens_at<=$4::timestamptz+interval '59.999 seconds' AND checkout_closes_at+interval '59.999 seconds'>=$3::timestamptz LIMIT 1",[who.id,id,opens,checkout]),'Jendela absensi bertumpang tindih dengan penugasan lain.',409);
 await q(ctx.db,`INSERT INTO attendance_schedules(id,employee_id,work_date,name,day_kind,starts_at,ends_at,checkin_opens_at,checkin_closes_at,checkout_closes_at,late_after,status,policy_snapshot,created_by,updated_by)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$14) ON CONFLICT(employee_id,work_date) DO UPDATE SET name=EXCLUDED.name,day_kind=EXCLUDED.day_kind,
 starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,checkin_opens_at=EXCLUDED.checkin_opens_at,checkin_closes_at=EXCLUDED.checkin_closes_at,
 checkout_closes_at=EXCLUDED.checkout_closes_at,late_after=EXCLUDED.late_after,status=EXCLUDED.status,policy_snapshot=EXCLUDED.policy_snapshot,updated_by=EXCLUDED.updated_by,updated_at=now(),row_version=attendance_schedules.row_version+1`,[id,who.id,date,name,kind,...times,status,JSON.stringify(snapshot),ctx.user.id]);
 await audit(ctx,'ATTENDANCE_SCHEDULE',id,{employee_id:who.id,date,status},text(b.reason,'Alasan penetapan',1000));return {id};
}
async function settings(ctx){
 await requireCap(ctx,'settings');
 if(ctx.method==='GET')return {config:await configOf(ctx.db),locations:await q(ctx.db,'SELECT * FROM attendance_locations ORDER BY is_default DESC,name')};
 const b=ctx.body,current=await one(ctx.db,'SELECT * FROM attendance_config WHERE id=1 FOR UPDATE');fail(b.row_version===current.row_version,'Pengaturan sudah berubah. Muat ulang.',409);
 const value={enabled:b.enabled===true,activation_on:b.activation_on?day(b.activation_on):null,boundary_mode:b.boundary_mode||null,minute_rounding:b.minute_rounding||null,
  gps_max_accuracy_m:b.gps_max_accuracy_m==null?null:num(b.gps_max_accuracy_m,'Ambang akurasi',1,100),gps_max_age_seconds:b.gps_max_age_seconds==null?null:num(b.gps_max_age_seconds,'Usia GPS',5,300),
  evidence_retention_days:b.evidence_retention_days==null?null:num(b.evidence_retention_days,'Retensi bukti',1,3650),evidence_policy_confirmed:b.evidence_policy_confirmed===true,
  request_day_mode:b.request_day_mode||null,privacy_notice:String(b.privacy_notice||'').slice(0,3000)};
 fail(!value.boundary_mode||['EXACT','WHOLE_MINUTE'].includes(value.boundary_mode),'Ketentuan detik tidak valid.');fail(!value.minute_rounding||['FLOOR','CEIL'].includes(value.minute_rounding),'Pembulatan tidak valid.');
 fail(!value.request_day_mode||value.request_day_mode==='SINGLE_DAY','Cakupan pengajuan belum didukung.');
 for(const n of ['gps_max_age_seconds','evidence_retention_days'])fail(value[n]==null||Number.isInteger(value[n]),'Nilai hari/detik harus bulat.');
 if(value.enabled)fail(!readiness(value).length,'Lengkapi keputusan kebijakan sebelum aktivasi: '+readiness(value).join(', '));
 const keys=Object.keys(value);await q(ctx.db,`UPDATE attendance_config SET ${keys.map((k,i)=>k+'=$'+(i+1)).join(',')},row_version=row_version+1,updated_at=now(),updated_by=$${keys.length+1} WHERE id=1`,[...Object.values(value),ctx.user.id]);
 await audit(ctx,'ATTENDANCE_SETTINGS','1',{before:current,after:value},text(b.reason,'Alasan perubahan',1000));return {ok:true};
}
async function people(ctx){
 fail(await ctx.services.has(ctx.db,ctx.user,'hr.attendance.schedule')||await capability(ctx,'settings'),'Akses pengelolaan pegawai ditolak.',403);
 const rows=await q(ctx.db,'SELECT id FROM employees WHERE is_active=1 ORDER BY full_name'),items=[];
 for(const r of rows){const who=await employee(ctx.db,r.id,ctx.clock);if(await capability(ctx,'settings')||await capability(ctx,'schedule',who))items.push({...who,profile:await profileOf(ctx.db,r.id)});}
 return {items};
}
async function profileSave(ctx,id){
 const who=await employee(ctx.db,id,ctx.clock);await requireCap(ctx,'settings');const b=ctx.body;
 await q(ctx.db,'SELECT id FROM employees WHERE id=$1 FOR UPDATE',[id]);
 const prior=await profileOf(ctx.db,id);fail(prior.row_version===b.row_version,'Profil sudah berubah. Muat ulang.',409);
 fail(['DEFAULT','CUSTOM','UNRESTRICTED'].includes(b.location_mode),'Mode lokasi tidak valid.');const activeFrom=b.active_from?day(b.active_from):null;
 if(b.enabled)fail(activeFrom,'Tanggal mulai aktivasi wajib diisi.');
 if(b.location_mode==='CUSTOM')fail(await one(ctx.db,'SELECT id FROM attendance_locations WHERE id=$1 AND is_active=true',[b.location_id]),'Titik khusus belum tersedia.');
 await q(ctx.db,`INSERT INTO attendance_employee_settings(employee_id,enabled,active_from,location_mode,location_id,updated_by)
 VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(employee_id) DO UPDATE SET enabled=EXCLUDED.enabled,active_from=EXCLUDED.active_from,location_mode=EXCLUDED.location_mode,location_id=EXCLUDED.location_id,updated_by=EXCLUDED.updated_by,updated_at=now(),row_version=attendance_employee_settings.row_version+1`,[who.id,b.enabled===true,activeFrom,b.location_mode,b.location_mode==='CUSTOM'?b.location_id:null,ctx.user.id]);
 await audit(ctx,'ATTENDANCE_EMPLOYEE_SETTINGS',id,{before:prior,after:{enabled:b.enabled===true,active_from:activeFrom,location_mode:b.location_mode,location_id:b.location_id}},text(b.reason,'Alasan perubahan'));return {ok:true};
}
async function locationSave(ctx){
 await requireCap(ctx,'settings');const b=ctx.body,id=b.id||crypto.randomUUID(),prior=await one(ctx.db,'SELECT * FROM attendance_locations WHERE id=$1 FOR UPDATE',[id]);
 if(prior)fail(prior.row_version===b.row_version,'Lokasi sudah berubah. Muat ulang.',409);
 const name=text(b.name,'Nama lokasi',100),lat=num(b.latitude,'Latitude',-90,90),lon=num(b.longitude,'Longitude',-180,180),radius=num(b.radius_m,'Radius',1,10000);
 fail(!(prior?.is_default&&b.is_active===false),'Titik default tidak dapat dinonaktifkan. Ubah koordinat bila perlu.');
 await q(ctx.db,`INSERT INTO attendance_locations(id,name,latitude,longitude,radius_m,is_active,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7)
 ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,radius_m=EXCLUDED.radius_m,is_active=EXCLUDED.is_active,updated_by=EXCLUDED.updated_by,updated_at=now(),row_version=attendance_locations.row_version+1`,[id,name,lat,lon,radius,b.is_active!==false,ctx.user.id]);
 await audit(ctx,'ATTENDANCE_LOCATION',id,{before:prior||null,after:{name,lat,lon,radius}},text(b.reason,'Alasan perubahan'));return {id};
}
async function proof(ctx,id){
 const record=await one(ctx.db,`SELECT e.* FROM attendance_evidence e WHERE e.id=$1
 AND (EXISTS(SELECT 1 FROM attendance_events a WHERE a.evidence_id=e.id) OR EXISTS(SELECT 1 FROM attendance_requests r WHERE r.evidence_id=e.id))`,[id]);
 fail(record,'Bukti tidak ditemukan.',404);const who=await employee(ctx.db,record.employee_id,ctx.clock);
 fail(who.id===ctx.user.employee_id||await capability(ctx,'evidence',who),'Akses bukti ditolak.',403);
 fail(Date.parse(record.expires_at)>Date.parse(ctx.clock),'Masa akses bukti telah berakhir.',404);
 const bytes=new Uint8Array(await ctx.db.storage.get(record.storage_key));fail(bytes.length===record.size_bytes&&await hash(bytes)===record.checksum,'Integritas bukti belum dapat diverifikasi.',503);
 await audit(ctx,'ATTENDANCE_EVIDENCE_READ',id,{employee_id:who.id});
 return {binary:true,data:b64(bytes),mime_type:record.mime_type,name:`bukti-absensi-${id}.${record.mime_type==='image/jpeg'?'jpg':record.mime_type==='image/png'?'png':'pdf'}`,inline:record.mime_type!=='application/pdf'};
}
async function detail(ctx,id){
 const schedule=await one(ctx.db,'SELECT * FROM attendance_schedules WHERE id=$1',[id]);fail(schedule,'Catatan tidak ditemukan.',404);
 const who=await employee(ctx.db,schedule.employee_id,ctx.clock);
 if(who.id!==ctx.user.employee_id)await requireCap(ctx,'read',who);
 const result=await loadResult(ctx,schedule,await configOf(ctx.db),await profileOf(ctx.db,who.id));
 const canEvidence=who.id===ctx.user.employee_id||await capability(ctx,'evidence',who);
 if(!canEvidence)result.events=result.events.map(({evidence_id,...e})=>e);
 return {...result,employee:who,can_correct:await capability(ctx,'correct',who)};
}
async function schedulesList(ctx){
 fail(await ctx.services.has(ctx.db,ctx.user,'hr.attendance.schedule'),'Akses jadwal ditolak.',403);
 const range=period(ctx.url,ctx.clock),rows=await q(ctx.db,'SELECT s.*,e.full_name employee_name FROM attendance_schedules s JOIN employees e ON e.id=s.employee_id WHERE work_date BETWEEN $1 AND $2 ORDER BY work_date DESC,e.full_name LIMIT 2001',[range.from,range.to]);
 fail(rows.length<=2000,'Persempit periode jadwal.');const items=[],allowed=new Map();
 for(const r of rows){if(!allowed.has(r.employee_id))allowed.set(r.employee_id,await capability(ctx,'schedule',await employee(ctx.db,r.employee_id,ctx.clock)));if(allowed.get(r.employee_id))items.push({...r,policy_snapshot:undefined,work_date:ymd(r.work_date)});}
 return {items};
}
export async function attendanceRoutes(context,services){
 if(context.p[0]!=='attendance')return;
 fail(context.user?.id&&context.user.status==='ACTIVE','Sesi tidak valid.',401);
 const ctx={...context,body:context.body||{},services,clock:iso(services.now?.()||new Date())};fail(ctx.db.inTransaction,'Absensi memerlukan transaksi.',500);
 if(!await installed(ctx.db)){if(context.method==='GET'&&context.p[1]==='me')return {installed:false,reason:'Modul absensi sedang disiapkan. Jadwal dan kebijakan akan diumumkan pengelola.'};fail(false,'Skema absensi belum dipasang.',503);}
 const route=ctx.p.slice(1).join('/'),method=ctx.method;
 if(route==='me'&&method==='GET')return {installed:true,...await me(ctx)};
 if(route==='events'&&method==='POST')return punch(ctx);
 if(ctx.p[1]==='submissions'&&ctx.p.length===3&&method==='GET'){const who=await own(ctx),r=await one(ctx.db,'SELECT * FROM attendance_events WHERE employee_id=$1 AND client_key=$2',[who.id,key(ctx.p[2])]);fail(r,'Penyimpanan belum ditemukan.',404);return {receipt:publicReceipt(r)};}
 if(route==='records'&&method==='GET')return records(ctx);
 if(ctx.p[1]==='records'&&ctx.p.length===3&&method==='GET')return detail(ctx,ctx.p[2]);
 if(route==='export'&&method==='GET')return records(ctx,true);
 if(route==='requests'&&method==='GET')return requests(ctx);
 if(route==='requests'&&method==='POST')return requestCreate(ctx);
 if(ctx.p[1]==='requests'&&ctx.p[3]==='decision'&&ctx.p.length===4&&method==='POST')return decision(ctx,ctx.p[2]);
 if(ctx.p[1]==='schedules'&&ctx.p[3]==='correction'&&ctx.p.length===4&&method==='POST')return correct(ctx,ctx.p[2]);
 if(route==='schedules'&&method==='POST')return scheduleSave(ctx);
 if(route==='schedules'&&method==='GET')return schedulesList(ctx);
 if(route==='settings'&&['GET','PATCH'].includes(method))return settings(ctx);
 if(route==='people'&&method==='GET')return people(ctx);
 if(ctx.p[1]==='people'&&ctx.p.length===3&&method==='PATCH')return profileSave(ctx,ctx.p[2]);
 if(route==='locations'&&method==='POST')return locationSave(ctx);
 if(ctx.p[1]==='evidence'&&ctx.p.length===3&&method==='GET')return proof(ctx,ctx.p[2]);
 fail(false,'Alamat absensi tidak ditemukan.',404);
}
