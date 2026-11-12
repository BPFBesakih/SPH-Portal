import {Buffer} from 'node:buffer';
import {all,one,run,insert,tx,audit,assert,AppError,now,today,uid} from './db.mjs';
import {archiveRules,archiveDirections,archiveClassifications,archiveReportTypes,archiveContentActions,archiveWitaDate,archiveWitaYear,archiveWitaHour,archiveShiftDay,
 archiveDayStart,archiveDayEnd,archiveValidDay,archiveAgendaCode,archiveAgendaNumber,archiveSuggestCode,archiveNormalNumber,archiveNormalSubject,archiveNormalName,
 archiveLike,archiveFingerprint,archiveDecide,archiveDuplicateReasons} from './archive-rules.mjs';

// E-Arsip Humas (Tahap 1) — rute portal `archives/*`.
//
// Siapa boleh apa (PRD bagian 5):
//   H  Humas: role yang MEMEGANG LANGSUNG izin archives.humas.manage. Membaca semua arsip
//      (termasuk Rahasia), mengubah klasifikasi, berbagi, memberi izin Rahasia/unduh,
//      menghapus logis dan memulihkan, mengelola jenis dokumen. Unduh tetap perlu izin.
//   S  lingkup daftar: anggota bagian pemilik, penerima berbagi Biasa, atau pengawasan
//      (izin archives.records.oversee pada unit cakupan role).
//   R  izin baca Rahasia per pengguna, terikat security_epoch arsip.
//   D  izin unduh per pengguna, terikat security_epoch arsip.
//   O  petugas yang ditunjuk administrator pada bagian pemilik (dan masih anggota bagian itu).
// Izin dibaca langsung dari tabel role, bukan lewat `has/can` gateway: di produksi Super
// Admin otomatis memegang semua izin, sedangkan PRD menetapkan administrator tidak otomatis
// membaca arsip Rahasia. Penyamaran metadata Rahasia terjadi di sini, sebelum data dikirim.
//
// Fungsi di berkas ini ditulis sinkron untuk SQLite; scripts/generate-cloud-modules.mjs
// mengubahnya menjadi asinkron untuk PostgreSQL. Karena itu semua pemanggilan basis data
// memakai fungsi bernama (bukan metode objek) dan nama fungsi diawali `arc` supaya tidak
// bertabrakan dengan modul lain.
const HUMAS='archives.humas.manage',OVERSEE='archives.records.oversee',ASSIGN='archives.officers.assign';
const HOLD_SQL='FROM user_roles ur JOIN roles r ON r.id=ur.role_id AND r.is_active=1 JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id';
const USER_SQL=`SELECT u.id,u.username,u.employee_id,e.full_name FROM users u LEFT JOIN employees e ON e.id=u.employee_id`;
const directionLabel={MASUK:'Masuk',KELUAR:'Keluar',INTERNAL:'Internal'};
const str=(value,label,max,{optional=false}={})=>{
 if(optional&&(value==null||String(value).trim()===''))return null;
 assert(typeof value==='string'&&value.trim().length>0&&value.trim().length<=max,`${label} wajib diisi (maksimal ${max} karakter).`);
 return value.trim();
};
const idOf=(value,label='Data')=>{assert(typeof value==='string'&&value.length>0&&value.length<=100&&/^[A-Za-z0-9_.:-]+$/.test(value),`${label} tidak ditemukan.`,404);return value;};
const placeholders=(values,params)=>{params.push(...values);return `(${values.map(()=>'?').join(',')})`;};
const parse=(value,fallback)=>{try{return value?JSON.parse(value):fallback;}catch{return fallback;}};
const notFound=()=>new AppError(404,'Arsip tidak ditemukan.');
const denied=(db,user,action,archiveId,message='Akses ditolak.',status=403)=>{
 // Penolakan membatalkan transaksi permintaan, jadi tidak bisa ditulis ke tabel audit di
 // transaksi yang sama. Dicatat ke log server (lihat docs/E-ARSIP.md, catatan audit).
 console.warn(JSON.stringify({event:'archive_denied',action,archive_id:archiveId||null,actor:user.id,request_id:user.request_id||null}));
 return new AppError(status,message);
};

/* ---------- Konteks pengguna ---------- */
function arcTree(db){
 const rows=all(db,'SELECT id,parent_id,code,name,is_active FROM org_units ORDER BY name,id'),byId=new Map(rows.map(r=>[r.id,r])),children=new Map();
 for(const r of rows)if(r.parent_id){const list=children.get(r.parent_id)||[];list.push(r.id);children.set(r.parent_id,list);}
 return {rows,byId,
  ancestors(id){const out=[];for(let at=id,guard=0;at&&byId.has(at)&&guard<50;guard++){out.push(at);at=byId.get(at).parent_id;}return out;},
  descendants(id){const out=new Set(),queue=[id];while(queue.length){const at=queue.shift();if(out.has(at)||!byId.has(at))continue;out.add(at);queue.push(...(children.get(at)||[]));}return out;}};
}
function arcHolds(db,userId,code){return Boolean(one(db,`SELECT 1 AS ok ${HOLD_SQL} WHERE ur.user_id=? AND p.code=? LIMIT 1`,userId,code));}
// Unit penempatan utama pegawai yang berlaku hari ini.
function arcPlacementUnits(db,employeeId){
 if(!employeeId)return [];
 const day=today();
 return all(db,`SELECT p.org_unit_id FROM employee_placements ep JOIN positions p ON p.id=ep.position_id JOIN employees e ON e.id=ep.employee_id
  WHERE ep.employee_id=? AND ep.is_primary=1 AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?) AND e.is_active=1`,employeeId,day,day).map(r=>r.org_unit_id);
}
// Anggota bagian U = penempatan utama di U atau unit di bawahnya.
function arcMemberUnits(db,tree,employeeId){
 const out=new Set();for(const unit of arcPlacementUnits(db,employeeId))for(const id of tree.ancestors(unit))out.add(id);return out;
}
function arcOversight(db,tree,userId){
 const roles=all(db,`SELECT DISTINCT ur.id,ur.scope_kind ${HOLD_SQL} WHERE ur.user_id=? AND p.code=?`,userId,OVERSEE);
 if(roles.some(r=>r.scope_kind==='ALL'))return 'ALL';
 const out=new Set();
 for(const role of roles.filter(r=>r.scope_kind==='ASSIGNED_UNITS'))for(const unit of all(db,'SELECT org_unit_id,include_descendants FROM user_role_units WHERE user_role_id=?',role.id)){
  if(Number(unit.include_descendants)===1)for(const id of tree.descendants(unit.org_unit_id))out.add(id);else out.add(unit.org_unit_id);
 }
 return out;
}
function arcActor(db,user){
 const tree=arcTree(db),nowIso=now(),memberUnits=arcMemberUnits(db,tree,user.employee_id);
 const officerUnits=new Set(all(db,'SELECT org_unit_id FROM archive_officers WHERE user_id=? AND revoked_at IS NULL AND valid_from<=? AND (expires_at IS NULL OR expires_at>?)',user.id,nowIso,nowIso)
  .map(r=>r.org_unit_id).filter(id=>memberUnits.has(id)&&tree.byId.get(id)?.is_active!==0));
 const ctx={user,tree,nowIso,humas:arcHolds(db,user.id,HUMAS),admin:arcHolds(db,user.id,ASSIGN),memberUnits,officerUnits,oversight:arcOversight(db,tree,user.id)};
 ctx.snapshot={username:user.username,humas:ctx.humas,admin:ctx.admin,officer_units:[...officerUnits]};
 return ctx;
}
export function archiveUploadAllowed(db,user){return arcActor(db,user).officerUnits.size>0;}

/* ---------- Audit modul ---------- */
function arcAudit(db,ctx,action,detail={}){
 insert(db,'archive_audit_events',{occurred_at:now(),actor_user_id:ctx.user.id,actor_snapshot:JSON.stringify(ctx.snapshot),actor_type:'USER',action,
  archive_id:detail.archive_id||null,document_id:detail.document_id||null,version_id:detail.version_id||null,request_id:ctx.user.request_id||uid(),
  operation_id:detail.operation_id||null,outcome:'SUCCESS',reason:detail.reason||null,before_data:detail.before?JSON.stringify(detail.before):null,
  after_data:detail.after?JSON.stringify(detail.after):null,safe_context:JSON.stringify(detail.context||{})});
}

/* ---------- Otorisasi kanonis ---------- */
// Potongan SQL lingkup. `params` diisi sesuai urutan potongan muncul di kueri.
function scopeSql(ctx,params){
 if(ctx.oversight==='ALL')return '1=1';
 const units=[...new Set([...ctx.memberUnits,...ctx.oversight])],member=[...ctx.memberUnits],parts=[];
 if(units.length)parts.push(`a.owner_unit_id IN ${placeholders(units,params)}`);
 params.push(ctx.user.id);
 parts.push(`EXISTS(SELECT 1 FROM archive_access_grants g WHERE g.archive_id=a.id AND g.purpose='BIASA_SHARE' AND g.revoked_at IS NULL AND (g.target_user_id=?${member.length?` OR g.target_unit_id IN ${placeholders(member,params)}`:''}))`);
 return `(${parts.join(' OR ')})`;
}
function grantSql(ctx,params,purpose){
 params.push(ctx.user.id,ctx.nowIso,ctx.nowIso);
 return `EXISTS(SELECT 1 FROM archive_access_grants g WHERE g.archive_id=a.id AND g.purpose='${purpose}' AND g.revoked_at IS NULL AND g.target_user_id=? AND g.security_epoch=a.security_epoch AND g.valid_from<=? AND (g.expires_at IS NULL OR g.expires_at>?))`;
}
const listSql=(ctx,params)=>ctx.humas?'1=1':`(${scopeSql(ctx,params)} OR ${grantSql(ctx,params,'RAHASIA_READ')})`;
const fullSql=(ctx,params)=>ctx.humas?'1=1':`((a.classification='BIASA' AND ${scopeSql(ctx,params)}) OR (a.classification='RAHASIA' AND ${grantSql(ctx,params,'RAHASIA_READ')}))`;

// Hak efektif satu arsip beserta sumbernya (untuk ditampilkan di antarmuka).
function arcAccess(db,ctx,a){
 const member=ctx.memberUnits.has(a.owner_unit_id),oversee=ctx.oversight==='ALL'||ctx.oversight.has(a.owner_unit_id);
 const memberUnits=[...ctx.memberUnits],params=[a.id,ctx.user.id];
 const shared=Boolean(one(db,`SELECT 1 AS ok FROM archive_access_grants g WHERE g.archive_id=? AND g.purpose='BIASA_SHARE' AND g.revoked_at IS NULL AND (g.target_user_id=?${memberUnits.length?` OR g.target_unit_id IN ${placeholders(memberUnits,params)}`:''}) LIMIT 1`,...params));
 const epochGrant=purpose=>Boolean(one(db,'SELECT 1 AS ok FROM archive_access_grants g WHERE g.archive_id=? AND g.purpose=? AND g.revoked_at IS NULL AND g.target_user_id=? AND g.security_epoch=? AND g.valid_from<=? AND (g.expires_at IS NULL OR g.expires_at>?) LIMIT 1',a.id,purpose,ctx.user.id,a.security_epoch,ctx.nowIso,ctx.nowIso));
 const rahasia=epochGrant('RAHASIA_READ'),download=epochGrant('DOWNLOAD'),officer=ctx.officerUnits.has(a.owner_unit_id);
 const decision=archiveDecide({deleted:Boolean(a.deleted_at),classification:a.classification,humas:ctx.humas,scope:member||oversee||shared,rahasia,download,officer});
 const sources=[];
 if(ctx.humas)sources.push('HUMAS');
 if(a.classification==='BIASA'){if(member)sources.push('BAGIAN');if(oversee)sources.push('PENGAWASAN');if(shared)sources.push('BERBAGI');}
 if(a.classification==='RAHASIA'&&rahasia)sources.push('IZIN_RAHASIA');
 return {...decision,member,oversee,shared,rahasia,download_grant:download,officer,sources};
}
// Arsip aktif yang boleh diketahui pengguna; di luar hak daftar selalu 404.
function arcLoad(db,ctx,id,action='READ'){
 const a=one(db,'SELECT a.*,u.name AS unit_name FROM archive_records a JOIN org_units u ON u.id=a.owner_unit_id WHERE a.id=?',idOf(id,'Arsip'));
 if(!a||a.deleted_at)throw notFound();
 const access=arcAccess(db,ctx,a);
 if(!access.list)throw notFound();
 return {a,access,action};
}
function arcLoadFull(db,ctx,id,action){
 const loaded=arcLoad(db,ctx,id,action);
 if(!loaded.access.read)throw denied(db,ctx.user,action,loaded.a.id,'Arsip ini berklasifikasi Rahasia. Hubungi Humas secara langsung untuk meminta akses.');
 return loaded;
}

/* ---------- Proyeksi ---------- */
const arcRestricted=a=>({id:a.id,restricted:true,agenda_number:a.agenda_number,archived_at:a.archived_at,classification:'RAHASIA'});
const arcFull=a=>({id:a.id,restricted:false,agenda_number:a.agenda_number,archived_at:a.archived_at,archival_year:Number(a.archival_year),letter_date:a.letter_date,direction:a.direction,
 document_type_id:a.document_type_id,document_type:a.document_type_name_snapshot,official_number:a.official_number,subject:a.subject,unit:{id:a.owner_unit_id,name:a.unit_name},
 classification:a.classification,row_version:Number(a.row_version)});
const arcProject=a=>Number(a.is_full)===1?arcFull(a):arcRestricted(a);
function arcUserNames(db,ids){
 const unique=[...new Set(ids.filter(Boolean))],map=new Map();if(!unique.length)return map;
 const params=[];
 for(const u of all(db,`${USER_SQL} WHERE u.id IN ${placeholders(unique,params)}`,...params))map.set(u.id,u.full_name||u.username);
 return map;
}
function arcDocuments(db,archiveId){
 const docs=all(db,'SELECT * FROM archive_documents WHERE archive_id=? AND removed_at IS NULL ORDER BY role DESC,display_order,created_at,id',archiveId);
 const versions=all(db,'SELECT v.* FROM archive_document_versions v JOIN archive_documents d ON d.id=v.document_id WHERE d.archive_id=? AND d.removed_at IS NULL ORDER BY v.version_number DESC',archiveId);
 const names=arcUserNames(db,versions.map(v=>v.created_by));
 return docs.map(d=>({id:d.id,role:d.role,current_version_id:d.current_version_id,
  versions:versions.filter(v=>v.document_id===d.id).map(v=>({id:v.id,version_number:Number(v.version_number),filename:v.original_filename,mime:v.detected_mime,size:Number(v.byte_size),
   change_reason:v.change_reason,created_at:v.created_at,created_by:names.get(v.created_by)||'—',current:v.id===d.current_version_id}))}));
}
function arcDetail(db,ctx,a,access){
 if(!access.read)return {archive:arcRestricted(a),access:{read:false,sources:[]},
  notice:'Arsip ini berklasifikasi Rahasia. Hubungi Humas secara langsung (misalnya lewat WhatsApp) untuk meminta akses.'};
 const type=one(db,'SELECT name,is_active FROM archive_document_types WHERE id=?',a.document_type_id);
 const pending=one(db,"SELECT id,requested_by,requested_at,reason FROM archive_delete_requests WHERE archive_id=? AND status='PENDING'",a.id);
 const names=arcUserNames(db,[a.created_by,a.updated_by,pending?.requested_by]);
 const showPending=pending&&(ctx.humas||access.edit||pending.requested_by===ctx.user.id);
 return {archive:{...arcFull({...a,is_full:1}),security_epoch:Number(a.security_epoch),updated_at:a.updated_at,created_by:names.get(a.created_by)||'—',updated_by:names.get(a.updated_by)||'—',
   document_type_current:type?.name||a.document_type_name_snapshot,document_type_active:Number(type?.is_active)===1},
  documents:arcDocuments(db,a.id),
  access:{read:true,edit:access.edit,download:access.download,download_grant:access.download_grant,request_delete:access.edit,humas:ctx.humas,history:ctx.humas||access.edit,sources:access.sources},
  delete_request:showPending?{id:pending.id,requested_at:pending.requested_at,requested_by:names.get(pending.requested_by)||'—',reason:pending.reason,mine:pending.requested_by===ctx.user.id}:null};
}

function arcShow(db,ctx,id){const loaded=arcLoad(db,ctx,id);return arcDetail(db,ctx,loaded.a,loaded.access);}

/* ---------- Ikhtisar ---------- */
function arcTypes(db){return all(db,'SELECT id,code,name,is_active,row_version FROM archive_document_types ORDER BY is_active DESC,name,id').map(t=>({id:t.id,code:t.code,name:t.name,active:Number(t.is_active)===1,row_version:Number(t.row_version)}));}
function arcUnitCodes(db){return new Map(all(db,'SELECT org_unit_id,agenda_code FROM archive_units').map(r=>[r.org_unit_id,r.agenda_code]));}
function arcUnread(db,userId){return Number(one(db,'SELECT count(*) n FROM archive_notifications WHERE recipient_user_id=? AND read_at IS NULL',userId).n);}
function arcOverview(db,ctx){
 // Ringkasan harian disiapkan di sini juga, supaya lonceng Humas menghitungnya tanpa
 // harus membuka daftar notifikasi lebih dulu.
 if(ctx.humas)archiveEnsureDailySummaries(db);
 const codes=arcUnitCodes(db),unit=id=>({id,name:ctx.tree.byId.get(id)?.name||'—',agenda_code:codes.get(id)||null});
 // Bagian yang boleh diketahui untuk saringan: milik sendiri dan pengawasan; Humas semua bagian yang punya kode agenda.
 const known=ctx.humas||ctx.oversight==='ALL'?[...codes.keys()]:[...new Set([...ctx.memberUnits,...ctx.oversight])].filter(id=>codes.has(id));
 return {humas:ctx.humas,admin:ctx.admin,oversight:ctx.oversight==='ALL'||ctx.oversight.size>0,employee:Boolean(ctx.user.employee_id),
  officer_units:[...ctx.officerUnits].map(unit),units:known.map(unit).sort((x,y)=>x.name.localeCompare(y.name)),types:arcTypes(db),
  limits:{max_file_bytes:archiveRules.maxFileBytes,mimes:archiveRules.mimes,max_attachments:archiveRules.maxAttachmentsPerRequest,subject_max:archiveRules.subjectMax,number_max:archiveRules.numberMax},
  unread:arcUnread(db,ctx.user.id),
  pending_delete_requests:ctx.humas?Number(one(db,"SELECT count(*) n FROM archive_delete_requests WHERE status='PENDING'").n):0};
}

/* ---------- Daftar, pencarian, dan saringan ---------- */
function arcFilters(ctx,query,params){
 const where=['a.deleted_at IS NULL',listSql(ctx,params)];let hidden=false;
 const day=(key,label)=>{const v=query.get(key);if(!v)return null;assert(archiveValidDay(v),`${label} tidak valid.`);return v;};
 const from=day('from','Tanggal awal'),to=day('to','Tanggal akhir');
 if(from){where.push('a.archived_at>=?');params.push(archiveDayStart(from));}
 if(to){where.push('a.archived_at<?');params.push(archiveDayEnd(to));}
 if(from&&to)assert(from<=to,'Tanggal awal tidak boleh setelah tanggal akhir.');
 const unit=query.get('unit');if(unit){where.push('a.owner_unit_id=?');params.push(idOf(unit,'Bagian'));}
 const classification=query.get('classification');
 if(classification){assert(archiveClassifications.includes(classification),'Klasifikasi tidak valid.');where.push('a.classification=?');params.push(classification);}
 if(query.get('shared')==='1'){
  const member=[...ctx.memberUnits];params.push(ctx.user.id);
  where.push(`EXISTS(SELECT 1 FROM archive_access_grants g WHERE g.archive_id=a.id AND g.purpose='BIASA_SHARE' AND g.revoked_at IS NULL AND (g.target_user_id=?${member.length?` OR g.target_unit_id IN ${placeholders(member,params)}`:''}))`);
 }
 // Saringan pada atribut yang disamarkan hanya berlaku untuk arsip yang dapat dibaca penuh:
 // baris Rahasia terbatas tidak ikut, sehingga hasil tidak bisa dipakai menebak atributnya.
 const full=(condition,...values)=>{hidden=true;where.push(`(${fullSql(ctx,params)} AND ${condition})`);params.push(...values);};
 const type=query.get('type');if(type)full('a.document_type_id=?',idOf(type,'Jenis dokumen'));
 const direction=query.get('direction');if(direction){assert(archiveDirections.includes(direction),'Arah surat tidak valid.');full('a.direction=?',direction);}
 const letterFrom=day('letter_from','Tanggal surat awal'),letterTo=day('letter_to','Tanggal surat akhir');
 if(letterFrom)full('a.letter_date>=?',letterFrom);
 if(letterTo)full('a.letter_date<=?',letterTo);
 const q=(query.get('q')||'').trim();
 if(q){
  assert(q.length<=120,'Kata pencarian terlalu panjang.');hidden=true;
  const number=archiveNormalNumber(q),subject=archiveNormalSubject(q),inner=[],values=[];
  if(number){inner.push("a.official_number_normalized LIKE ? ESCAPE '\\'");values.push(archiveLike(number));}
  if(subject){inner.push("a.subject_normalized LIKE ? ESCAPE '\\'");values.push(archiveLike(subject));}
  params.push(archiveLike(q.toUpperCase().replace(/\s+/g,'')));
  let clause="(a.agenda_number LIKE ? ESCAPE '\\'";
  if(inner.length){clause+=` OR (${fullSql(ctx,params)} AND (${inner.join(' OR ')}))`;params.push(...values);}
  where.push(clause+')');
 }
 return {where,hidden:hidden&&!ctx.humas};
}
function arcList(db,ctx,query){
 const size=Math.min(Math.max(Number.parseInt(query.get('limit')||archiveRules.pageSize,10)||archiveRules.pageSize,1),archiveRules.maxPageSize);
 const selectParams=[],select=`SELECT a.*,u.name AS unit_name,CASE WHEN ${fullSql(ctx,selectParams)} THEN 1 ELSE 0 END AS is_full FROM archive_records a JOIN org_units u ON u.id=a.owner_unit_id`;
 const filterParams=[],filters=arcFilters(ctx,query,filterParams);
 const total=Number(one(db,`SELECT count(*) n FROM archive_records a WHERE ${filters.where.join(' AND ')}`,...filterParams).n);
 const pageWhere=[...filters.where],pageParams=[...selectParams,...filterParams],cursor=query.get('cursor');
 if(cursor){
  let at;try{at=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));}catch{at=null;}
  assert(Array.isArray(at)&&at.length===2&&typeof at[0]==='string'&&typeof at[1]==='string','Penanda halaman tidak valid.');
  pageWhere.push('(a.archived_at<? OR (a.archived_at=? AND a.id<?))');pageParams.push(at[0],at[0],at[1]);
 }
 const rows=all(db,`${select} WHERE ${pageWhere.join(' AND ')} ORDER BY a.archived_at DESC,a.id DESC LIMIT ${size+1}`,...pageParams);
 const page=rows.slice(0,size),last=page.at(-1);
 return {items:page.map(arcProject),total,next_cursor:rows.length>size?Buffer.from(JSON.stringify([last.archived_at,last.id])).toString('base64url'):null,
  // Rincian yang disamarkan hanya dicari pada arsip yang dapat dibaca penuh.
  readable_only:filters.hidden};
}
function arcDashboard(db,ctx){
 const p1=[],base=`FROM archive_records a WHERE a.deleted_at IS NULL AND ${listSql(ctx,p1)}`,total=Number(one(db,`SELECT count(*) n ${base}`,...p1).n);
 const p2=[],readable=Number(one(db,`SELECT count(*) n FROM archive_records a WHERE a.deleted_at IS NULL AND ${fullSql(ctx,p2)}`,...p2).n);
 const p3=[],types=all(db,`SELECT a.document_type_id,count(*) n FROM archive_records a WHERE a.deleted_at IS NULL AND ${fullSql(ctx,p3)} GROUP BY a.document_type_id`,...p3);
 const names=new Map(arcTypes(db).map(t=>[t.id,t.name]));
 const p4=[],latest=all(db,`SELECT a.*,u.name AS unit_name,CASE WHEN ${fullSql(ctx,p4)} THEN 1 ELSE 0 END AS is_full FROM archive_records a JOIN org_units u ON u.id=a.owner_unit_id
  WHERE a.deleted_at IS NULL AND ${listSql(ctx,p4)} ORDER BY a.archived_at DESC,a.id DESC LIMIT 8`,...p4);
 return {total,readable,restricted:total-readable,
  by_type:types.map(t=>({id:t.document_type_id,name:names.get(t.document_type_id)||'—',count:Number(t.n)})).sort((x,y)=>y.count-x.count||x.name.localeCompare(y.name)),
  latest:latest.map(arcProject)};
}

/* ---------- Berkas dan duplikasi ---------- */
// Berkas diunggah lebih dulu lewat `uploads` (tanda tangan isi, ukuran, dan checksum
// diperiksa di sana), lalu diikat ke arsip saat finalisasi.
function arcClaim(db,ctx,deps,fileId){
 const file=one(db,'SELECT * FROM files WHERE id=?',idOf(fileId,'Berkas'));
 assert(file&&file.status==='AVAILABLE'&&file.uploaded_by===ctx.user.id,'Berkas tidak tersedia. Unggah ulang berkas tersebut.',422);
 assert(!one(db,'SELECT 1 AS ok FROM archive_document_versions WHERE file_id=?',file.id),'Berkas sudah dipakai arsip lain. Unggah berkas baru.',422);
 assert(archiveRules.mimes.includes(file.mime_type),`${file.original_name}: jenis berkas harus PDF, JPG, JPEG, atau PNG.`,422);
 assert(Number(file.size_bytes)>0&&Number(file.size_bytes)<=archiveRules.maxFileBytes,`${file.original_name}: ukuran berkas melebihi 10 MB.`,413);
 const extension=String(file.original_name).split('.').pop().toLowerCase();
 assert(archiveRules.extensions[extension]===file.mime_type,`${file.original_name}: ekstensi tidak sesuai dengan isi berkas.`,422);
 const claimFile=deps.claimFile;
 if(claimFile)claimFile(db,ctx.user,file.id);
 return file;
}
function arcVersion(db,ctx,deps,documentId,number,file,reason){
 const id=uid();
 insert(db,'archive_document_versions',{id,document_id:documentId,version_number:number,file_id:file.id,original_filename:file.original_name,detected_mime:file.mime_type,
  byte_size:Number(file.size_bytes),sha256:file.checksum,change_reason:reason||null,created_by:ctx.user.id});
 if(deps.claimStorage)deps.claimStorage(file.storage_key);
 return id;
}
// Kandidat duplikat menurut RT04. Yang ditampilkan hanya arsip yang dapat dibaca pemohon;
// kecocokan dengan arsip lain dicatat untuk Humas tanpa mengubah jawaban kepada pemohon.
function arcDuplicates(db,ctx,incoming,checksums){
 const found=new Map(),add=(row,checksum)=>{const item=found.get(row.id)||{...row,checksum_match:false};if(checksum)item.checksum_match=true;found.set(row.id,item);};
 const fields='a.id,a.agenda_number,a.archived_at,a.letter_date,a.official_number,a.official_number_normalized,a.subject,a.subject_normalized,a.classification,a.owner_unit_id,a.security_epoch,a.deleted_at,a.document_type_name_snapshot';
 if(checksums.length){
  const params=[];
  for(const row of all(db,`SELECT DISTINCT ${fields} FROM archive_records a JOIN archive_documents d ON d.archive_id=a.id AND d.removed_at IS NULL JOIN archive_document_versions v ON v.document_id=d.id WHERE v.sha256 IN ${placeholders(checksums,params)}`,...params))add(row,true);
 }
 if(incoming.official_number_normalized)for(const row of all(db,`SELECT ${fields} FROM archive_records a WHERE a.official_number_normalized=? AND a.letter_date=?`,incoming.official_number_normalized,incoming.letter_date))add(row,false);
 for(const row of all(db,`SELECT ${fields} FROM archive_records a WHERE a.letter_date=? AND a.subject_normalized=?`,incoming.letter_date,incoming.subject_normalized))add(row,false);
 const visible=[],internal=[];
 for(const row of found.values()){
  const reasons=archiveDuplicateReasons(row,incoming);if(!reasons.length)continue;
  if(!row.deleted_at&&arcAccess(db,ctx,row).read)visible.push({id:row.id,agenda_number:row.agenda_number,archived_at:row.archived_at,letter_date:row.letter_date,official_number:row.official_number,subject:row.subject,document_type:row.document_type_name_snapshot,reasons});
  else internal.push(row.id);
 }
 return {visible,internal};
}
function arcOperation(db,ctx,type,key,fingerprint){
 assert(typeof key==='string'&&/^[A-Za-z0-9_-]{16,64}$/.test(key),'Kunci operasi tidak valid. Muat ulang halaman.',422);
 const done=one(db,'SELECT * FROM archive_upload_operations WHERE actor_id=? AND operation_type=? AND idempotency_key=?',ctx.user.id,type,key);
 if(done)assert(done.payload_fingerprint===fingerprint,'Operasi ini sudah selesai dengan isi berbeda. Mulai operasi baru.',409);
 return done||null;
}
function arcType(db,id,{mustBeActive}){
 const type=one(db,'SELECT * FROM archive_document_types WHERE id=?',idOf(id,'Jenis dokumen'));
 assert(type,'Jenis dokumen tidak ditemukan.',422);
 if(mustBeActive)assert(Number(type.is_active)===1,'Jenis dokumen ini sudah nonaktif. Pilih jenis lain.',422);
 return type;
}
function arcMetadata(db,b,{currentTypeId=null}={}){
 assert(archiveDirections.includes(b.direction),'Arah surat wajib dipilih: Masuk, Keluar, atau Internal.');
 const type=arcType(db,b.document_type_id,{mustBeActive:b.document_type_id!==currentTypeId});
 const official=str(b.official_number,'Nomor surat',archiveRules.numberMax,{optional:true});
 assert(archiveValidDay(b.letter_date),'Tanggal surat wajib diisi dengan tanggal yang valid.');
 const subject=str(b.subject,'Perihal',archiveRules.subjectMax);
 return {direction:b.direction,document_type_id:type.id,document_type_name_snapshot:type.name,official_number:official,
  official_number_normalized:official?archiveNormalNumber(official):null,letter_date:b.letter_date,subject,subject_normalized:archiveNormalSubject(subject)};
}
const arcMetaView=m=>({direction:m.direction,document_type_id:m.document_type_id,document_type:m.document_type_name_snapshot,official_number:m.official_number,letter_date:m.letter_date,subject:m.subject});

/* ---------- Tambah arsip (finalisasi atomik) ---------- */
function arcCreate(db,ctx,deps,b){
 const unitId=idOf(b.owner_unit_id,'Bagian');
 if(!ctx.officerUnits.has(unitId))throw denied(db,ctx.user,'CREATE',null,'Hanya petugas arsip yang ditunjuk untuk bagian ini yang dapat menambah arsip.');
 const attachments=Array.isArray(b.attachment_file_ids)?b.attachment_file_ids:[];
 assert(typeof b.main_file_id==='string'&&b.main_file_id,'Dokumen utama wajib diunggah.');
 assert(attachments.length<=archiveRules.maxAttachmentsPerRequest,`Paling banyak ${archiveRules.maxAttachmentsPerRequest} lampiran per penyimpanan. Lampiran lain dapat ditambahkan dari detail arsip.`);
 const fileIds=[b.main_file_id,...attachments];
 assert(fileIds.every(id=>typeof id==='string')&&new Set(fileIds).size===fileIds.length,'Daftar berkas tidak valid.');
 return tx(db,()=>{
  const meta=arcMetadata(db,b);
  const fingerprint=archiveFingerprint([unitId,arcMetaView(meta),fileIds]);
  const done=arcOperation(db,ctx,'CREATE_ARCHIVE',b.idempotency_key,fingerprint);
  if(done){const a=one(db,'SELECT a.*,u.name AS unit_name FROM archive_records a JOIN org_units u ON u.id=a.owner_unit_id WHERE a.id=?',done.result_archive_id);return {archive:arcFull({...a,is_full:1}),repeated:true};}
  const unit=one(db,'SELECT agenda_code FROM archive_units WHERE org_unit_id=?',unitId);
  assert(unit,'Kode agenda bagian ini belum ditetapkan. Hubungi administrator portal.',422);
  const files=fileIds.map(id=>arcClaim(db,ctx,deps,id));
  const duplicates=arcDuplicates(db,ctx,meta,[...new Set(files.map(f=>f.checksum))]);
  const reason=str(b.duplicate_reason,'Alasan tetap menyimpan',archiveRules.longReasonMax,{optional:true});
  // Peringatan saja: tidak ada yang ditulis sampai petugas memberi alasan atau membatalkan.
  if(duplicates.visible.length&&!reason)return {duplicate_warning:true,candidates:duplicates.visible};
  // Klasifikasi awal selalu Biasa, apa pun yang dikirim klien (Q31).
  const archivedAt=now(),year=archiveWitaYear(Date.parse(archivedAt)),id=uid(),operationId=uid();
  const sequence=Number(one(db,`INSERT INTO archive_agenda_counters(id,org_unit_id,archival_year,last_value,updated_at) VALUES(?,?,?,1,?)
   ON CONFLICT(org_unit_id,archival_year) DO UPDATE SET last_value=archive_agenda_counters.last_value+1,updated_at=excluded.updated_at RETURNING last_value`,uid(),unitId,year,archivedAt).last_value);
  const agenda=archiveAgendaNumber(unit.agenda_code,year,sequence);
  run(db,`INSERT INTO archive_records(id,owner_unit_id,unit_code_snapshot,archival_year,agenda_sequence,agenda_number,archived_at,direction,document_type_id,document_type_name_snapshot,
   official_number,official_number_normalized,letter_date,subject,subject_normalized,classification,security_epoch,row_version,source_kind,created_by,updated_by,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'BIASA',1,1,'MANUAL',?,?,?,?)`,id,unitId,unit.agenda_code,year,sequence,agenda,archivedAt,meta.direction,meta.document_type_id,meta.document_type_name_snapshot,
   meta.official_number,meta.official_number_normalized,meta.letter_date,meta.subject,meta.subject_normalized,ctx.user.id,ctx.user.id,archivedAt,archivedAt);
  files.forEach((file,index)=>{
   const documentId=uid(),versionId=uid();
   run(db,'INSERT INTO archive_documents(id,archive_id,role,display_order,current_version_id,created_by,created_at,updated_at,row_version) VALUES(?,?,?,?,?,?,?,?,1)',
    documentId,id,index===0?'MAIN':'ATTACHMENT',index,versionId,ctx.user.id,archivedAt,archivedAt);
   insert(db,'archive_document_versions',{id:versionId,document_id:documentId,version_number:1,file_id:file.id,original_filename:file.original_name,detected_mime:file.mime_type,
    byte_size:Number(file.size_bytes),sha256:file.checksum,change_reason:null,created_by:ctx.user.id});
   if(deps.claimStorage)deps.claimStorage(file.storage_key);
  });
  insert(db,'archive_upload_operations',{id:operationId,actor_id:ctx.user.id,owner_unit_id:unitId,operation_type:'CREATE_ARCHIVE',idempotency_key:b.idempotency_key,payload_fingerprint:fingerprint,
   status:'COMMITTED',result_archive_id:id,request_id:ctx.user.request_id||uid()});
  arcAudit(db,ctx,'ARCHIVE_CREATED',{archive_id:id,operation_id:operationId,after:{...arcMetaView(meta),agenda_number:agenda,classification:'BIASA'},context:{files:files.length}});
  if(duplicates.visible.length||duplicates.internal.length){
   insert(db,'archive_duplicate_overrides',{archive_id:id,operation_id:operationId,actor_id:ctx.user.id,reason:duplicates.visible.length?reason:null,rule_version:archiveRules.duplicateRuleVersion,
    visible_match_ids:JSON.stringify(duplicates.visible.map(c=>c.id)),internal_match_ids:JSON.stringify(duplicates.internal)});
   // Jumlah kecocokan tersembunyi hanya ada di tabel duplikat (dibaca Humas), tidak di audit yang bisa dibaca petugas.
   if(duplicates.visible.length)arcAudit(db,ctx,'DUPLICATE_OVERRIDE',{archive_id:id,operation_id:operationId,reason,context:{visible:duplicates.visible.length}});
  }
  const a=one(db,'SELECT a.*,u.name AS unit_name FROM archive_records a JOIN org_units u ON u.id=a.owner_unit_id WHERE a.id=?',id);
  return {archive:arcFull({...a,is_full:1})};
 });
}
// Menaikkan row_version arsip; gagal bila data sudah berubah sejak dibaca (konflik 409).
function arcBump(db,ctx,a,expected,fields={}){
 assert(Number.isInteger(expected),'Versi data wajib dikirim. Muat ulang arsip.',409);
 const row={...fields,updated_at:now(),updated_by:ctx.user.id},keys=Object.keys(row);
 const changed=run(db,`UPDATE archive_records SET ${keys.map(k=>`${k}=?`).join(',')},row_version=row_version+1 WHERE id=? AND row_version=? AND deleted_at IS NULL`,...keys.map(k=>row[k]??null),a.id,expected);
 assert(changed.changes===1,'Arsip ini sudah diubah orang lain. Muat ulang, tinjau perubahan terbaru, lalu simpan kembali.',409);
}
function arcEdit(db,ctx,id,b){
 return tx(db,()=>{
  const {a,access}=arcLoadFull(db,ctx,id,'EDIT');
  if(!access.edit)throw denied(db,ctx.user,'EDIT',a.id,'Hanya petugas arsip bagian pemilik yang dapat mengubah arsip ini.');
  const meta=arcMetadata(db,b,{currentTypeId:a.document_type_id});
  // Jenis tidak berubah: snapshot nama lama dipertahankan walau master sudah diganti namanya.
  if(meta.document_type_id===a.document_type_id)meta.document_type_name_snapshot=a.document_type_name_snapshot;
  const before=arcMetaView(a),after=arcMetaView(meta);
  const changedKeys=Object.keys(after).filter(k=>k!=='document_type'&&(before[k]??null)!==(after[k]??null));
  assert(changedKeys.length,'Tidak ada perubahan untuk disimpan.');
  arcBump(db,ctx,a,b.expected_row_version,meta);
  arcAudit(db,ctx,'METADATA_EDITED',{archive_id:a.id,before:Object.fromEntries(changedKeys.map(k=>[k,before[k]??null])),after:Object.fromEntries(changedKeys.map(k=>[k,after[k]??null])),
   context:meta.document_type_id!==a.document_type_id?{document_type_before:a.document_type_name_snapshot,document_type_after:meta.document_type_name_snapshot}:{}});
  return arcShow(db,ctx,a.id);
 });
}
function arcAddAttachment(db,ctx,deps,id,b){
 return tx(db,()=>{
  const {a,access}=arcLoadFull(db,ctx,id,'ADD_ATTACHMENT');
  if(!access.edit)throw denied(db,ctx.user,'ADD_ATTACHMENT',a.id,'Hanya petugas arsip bagian pemilik yang dapat menambah lampiran.');
  const fingerprint=archiveFingerprint([a.id,b.file_id]),done=arcOperation(db,ctx,'ADD_ATTACHMENT',b.idempotency_key,fingerprint);
  if(!done){
   const file=arcClaim(db,ctx,deps,b.file_id);
   arcBump(db,ctx,a,b.expected_row_version);
   const order=Number(one(db,'SELECT coalesce(max(display_order),0)+1 AS n FROM archive_documents WHERE archive_id=?',a.id).n),documentId=uid(),versionId=uid(),at=now(),operationId=uid();
   run(db,"INSERT INTO archive_documents(id,archive_id,role,display_order,current_version_id,created_by,created_at,updated_at,row_version) VALUES(?,?,'ATTACHMENT',?,?,?,?,?,1)",documentId,a.id,order,versionId,ctx.user.id,at,at);
   insert(db,'archive_document_versions',{id:versionId,document_id:documentId,version_number:1,file_id:file.id,original_filename:file.original_name,detected_mime:file.mime_type,byte_size:Number(file.size_bytes),sha256:file.checksum,change_reason:null,created_by:ctx.user.id});
   if(deps.claimStorage)deps.claimStorage(file.storage_key);
   insert(db,'archive_upload_operations',{id:operationId,actor_id:ctx.user.id,owner_unit_id:a.owner_unit_id,operation_type:'ADD_ATTACHMENT',idempotency_key:b.idempotency_key,payload_fingerprint:fingerprint,status:'COMMITTED',
    result_archive_id:a.id,result_document_id:documentId,result_version_id:versionId,request_id:ctx.user.request_id||uid()});
   arcAudit(db,ctx,'ATTACHMENT_ADDED',{archive_id:a.id,document_id:documentId,version_id:versionId,operation_id:operationId,after:{filename:file.original_name,size:Number(file.size_bytes)}});
  }
  return arcShow(db,ctx,a.id);
 });
}
function arcDocument(db,a,documentId){
 const d=one(db,'SELECT * FROM archive_documents WHERE id=? AND archive_id=? AND removed_at IS NULL',idOf(documentId,'Dokumen'),a.id);
 if(!d)throw new AppError(404,'Dokumen tidak ditemukan.');
 return d;
}
function arcReplaceFile(db,ctx,deps,id,documentId,b){
 return tx(db,()=>{
  const {a,access}=arcLoadFull(db,ctx,id,'REPLACE_FILE');
  if(!access.edit)throw denied(db,ctx.user,'REPLACE_FILE',a.id,'Hanya petugas arsip bagian pemilik yang dapat mengganti berkas.');
  const d=arcDocument(db,a,documentId),reason=str(b.change_reason,'Alasan penggantian berkas',archiveRules.reasonMax);
  const fingerprint=archiveFingerprint([a.id,d.id,b.file_id,reason]),done=arcOperation(db,ctx,'REPLACE_FILE',b.idempotency_key,fingerprint);
  if(!done){
   const file=arcClaim(db,ctx,deps,b.file_id);
   // Kunci optimistik arsip diambil sebelum nomor versi dihitung, sehingga dua penggantian
   // bersamaan tidak memperoleh nomor yang sama.
   arcBump(db,ctx,a,b.expected_row_version);
   const number=Number(one(db,'SELECT coalesce(max(version_number),0)+1 AS n FROM archive_document_versions WHERE document_id=?',d.id).n),operationId=uid();
   const versionId=arcVersion(db,ctx,deps,d.id,number,file,reason);
   run(db,'UPDATE archive_documents SET current_version_id=?,updated_at=?,row_version=row_version+1 WHERE id=?',versionId,now(),d.id);
   insert(db,'archive_upload_operations',{id:operationId,actor_id:ctx.user.id,owner_unit_id:a.owner_unit_id,operation_type:'REPLACE_FILE',idempotency_key:b.idempotency_key,payload_fingerprint:fingerprint,status:'COMMITTED',
    result_archive_id:a.id,result_document_id:d.id,result_version_id:versionId,request_id:ctx.user.request_id||uid()});
   arcAudit(db,ctx,'VERSION_ADDED',{archive_id:a.id,document_id:d.id,version_id:versionId,operation_id:operationId,reason,after:{role:d.role,version_number:number,filename:file.original_name,size:Number(file.size_bytes)}});
  }
  return arcShow(db,ctx,a.id);
 });
}
function arcRemoveAttachment(db,ctx,id,documentId,b){
 return tx(db,()=>{
  const {a,access}=arcLoadFull(db,ctx,id,'REMOVE_ATTACHMENT');
  if(!access.edit)throw denied(db,ctx.user,'REMOVE_ATTACHMENT',a.id,'Hanya petugas arsip bagian pemilik yang dapat melepas lampiran.');
  const d=arcDocument(db,a,documentId);
  assert(d.role==='ATTACHMENT','Dokumen utama tidak dapat dilepas. Ganti berkasnya dengan versi baru.');
  const reason=str(b.reason,'Alasan melepas lampiran',archiveRules.reasonMax),at=now();
  arcBump(db,ctx,a,b.expected_row_version);
  run(db,'UPDATE archive_documents SET removed_at=?,removed_by=?,remove_reason=?,updated_at=?,row_version=row_version+1 WHERE id=?',at,ctx.user.id,reason,at,d.id);
  arcAudit(db,ctx,'ATTACHMENT_REMOVED',{archive_id:a.id,document_id:d.id,reason});
  return arcShow(db,ctx,a.id);
 });
}
// Versi berkas milik arsip yang benar; setiap permintaan memeriksa izin terkini.
function arcVersionOf(db,a,documentId,versionId){
 const v=one(db,`SELECT v.*,f.storage_key,f.size_bytes,f.checksum,f.status FROM archive_document_versions v JOIN archive_documents d ON d.id=v.document_id JOIN files f ON f.id=v.file_id
  WHERE v.id=? AND d.id=? AND d.archive_id=? AND d.removed_at IS NULL`,idOf(versionId,'Versi'),idOf(documentId,'Dokumen'),a.id);
 if(!v||v.status!=='AVAILABLE')throw new AppError(404,'Berkas tidak ditemukan.');
 return v;
}

/* ---------- Kewenangan Humas ---------- */
function arcHumas(db,ctx,action,archiveId=null){
 if(!ctx.humas)throw denied(db,ctx.user,action,archiveId,'Tindakan ini hanya untuk Humas.');
}
function arcRevokeEpochGrants(db,ctx,a,reason){
 const at=now(),open=all(db,"SELECT id,purpose FROM archive_access_grants WHERE archive_id=? AND revoked_at IS NULL AND purpose IN('RAHASIA_READ','DOWNLOAD')",a.id);
 run(db,"UPDATE archive_access_grants SET revoked_at=?,revoked_by=?,revoked_reason=?,updated_at=?,row_version=row_version+1 WHERE archive_id=? AND revoked_at IS NULL AND purpose IN('RAHASIA_READ','DOWNLOAD')",at,ctx.user.id,reason,at,a.id);
 return {rahasia_read:open.filter(g=>g.purpose==='RAHASIA_READ').length,download:open.filter(g=>g.purpose==='DOWNLOAD').length};
}
function arcClassify(db,ctx,id,b){
 return tx(db,()=>{
  arcHumas(db,ctx,'CLASSIFY',id);
  const {a}=arcLoadFull(db,ctx,id,'CLASSIFY');
  assert(archiveClassifications.includes(b.target)&&b.target!==a.classification,'Pilih klasifikasi yang berbeda dari klasifikasi saat ini.');
  const reason=str(b.reason,'Alasan perubahan klasifikasi',archiveRules.reasonMax);
  // RT10: epoch naik dan izin Rahasia/unduh dari epoch lama diakhiri, supaya tidak hidup
  // kembali diam-diam ketika klasifikasi bolak-balik. Berbagi Biasa tetap tercatat.
  arcBump(db,ctx,a,b.expected_row_version,{classification:b.target,security_epoch:Number(a.security_epoch)+1});
  const ended=arcRevokeEpochGrants(db,ctx,a,`Klasifikasi diubah menjadi ${b.target==='RAHASIA'?'Rahasia':'Biasa'}`);
  arcAudit(db,ctx,'CLASSIFICATION_CHANGED',{archive_id:a.id,reason,before:{classification:a.classification,security_epoch:Number(a.security_epoch)},
   after:{classification:b.target,security_epoch:Number(a.security_epoch)+1},context:{grants_ended:ended}});
  return arcShow(db,ctx,a.id);
 });
}
function arcActiveUser(db,id){
 const u=one(db,`${USER_SQL} WHERE u.id=? AND u.status='ACTIVE' AND (u.employee_id IS NULL OR e.is_active=1)`,idOf(id,'Pengguna'));
 assert(u,'Pengguna tidak ditemukan atau tidak aktif.',422);return u;
}
function arcUnitMembers(db,tree,unitId){
 const inside=tree.descendants(unitId),day=today();
 return all(db,`SELECT u.id,u.username,e.full_name,p.org_unit_id,p.name AS position_name FROM users u JOIN employees e ON e.id=u.employee_id AND e.is_active=1
  JOIN employee_placements ep ON ep.employee_id=e.id AND ep.is_primary=1 AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?)
  JOIN positions p ON p.id=ep.position_id WHERE u.status='ACTIVE' ORDER BY e.full_name,u.id`,day,day).filter(r=>inside.has(r.org_unit_id));
}
function arcCanRead(db,tree,a,userId){
 const user=one(db,'SELECT id,username,employee_id FROM users WHERE id=?',userId);
 if(!user)return false;
 const nowIso=now(),ctx={user,tree,nowIso,humas:arcHolds(db,userId,HUMAS),memberUnits:arcMemberUnits(db,tree,user.employee_id),officerUnits:new Set(),oversight:arcOversight(db,tree,userId)};
 return arcAccess(db,ctx,a).read;
}
function arcGrantView(db,ctx,a){
 const grants=all(db,'SELECT * FROM archive_access_grants WHERE archive_id=? ORDER BY revoked_at IS NOT NULL,granted_at DESC,id LIMIT 200',a.id);
 const names=arcUserNames(db,grants.flatMap(g=>[g.target_user_id,g.granted_by,g.revoked_by]));
 const label={BIASA_SHARE:'Berbagi Biasa',RAHASIA_READ:'Baca Rahasia',DOWNLOAD:'Unduh'};
 return grants.map(g=>{
  const open=!g.revoked_at,epochOk=g.purpose==='BIASA_SHARE'||Number(g.security_epoch)===Number(a.security_epoch),timeOk=g.valid_from<=ctx.nowIso&&(!g.expires_at||g.expires_at>ctx.nowIso);
  const active=open&&epochOk&&timeOk&&(g.purpose!=='BIASA_SHARE'||a.classification==='BIASA')&&(g.purpose!=='RAHASIA_READ'||a.classification==='RAHASIA');
  return {id:g.id,purpose:g.purpose,purpose_label:label[g.purpose],
   target:g.target_user_id?{kind:'USER',id:g.target_user_id,name:names.get(g.target_user_id)||'—'}:{kind:'UNIT',id:g.target_unit_id,name:ctx.tree.byId.get(g.target_unit_id)?.name||'—'},
   valid_from:g.valid_from,expires_at:g.expires_at,granted_at:g.granted_at,granted_by:names.get(g.granted_by)||'—',reason:g.reason,
   revoked_at:g.revoked_at,revoked_by:g.revoked_by?names.get(g.revoked_by)||'—':null,revoked_reason:g.revoked_reason,open,active,
   status:!open?'DICABUT':!timeOk&&g.expires_at&&g.expires_at<=ctx.nowIso?'KEDALUWARSA':!active?'TIDAK_BERLAKU':'AKTIF',
   // Izin unduh tidak berlaku secara efektif selama penerimanya belum dapat membaca arsip.
   effective:g.purpose==='DOWNLOAD'&&active?arcCanRead(db,ctx.tree,a,g.target_user_id):undefined};
 });
}
function arcAccessPanel(db,ctx,id){
 arcHumas(db,ctx,'ACCESS_PANEL',id);
 const {a}=arcLoadFull(db,ctx,id,'ACCESS_PANEL'),grants=arcGrantView(db,ctx,a),open=purpose=>grants.filter(g=>g.open&&g.purpose===purpose);
 return {archive:{id:a.id,agenda_number:a.agenda_number,classification:a.classification,security_epoch:Number(a.security_epoch),row_version:Number(a.row_version),unit:{id:a.owner_unit_id,name:a.unit_name}},
  grants,
  // Dampak perubahan klasifikasi, ditampilkan sebelum Humas menyimpan.
  impact:{unit_members:arcUnitMembers(db,ctx.tree,a.owner_unit_id).length,share_users:open('BIASA_SHARE').filter(g=>g.target.kind==='USER').length,
   share_units:open('BIASA_SHARE').filter(g=>g.target.kind==='UNIT').length,rahasia_grants:open('RAHASIA_READ').length,download_grants:open('DOWNLOAD').length}};
}
function arcGrant(db,ctx,id,b){
 return tx(db,()=>{
  arcHumas(db,ctx,'GRANT',id);
  const {a}=arcLoadFull(db,ctx,id,'GRANT'),purpose=b.purpose,at=now();
  assert(['BIASA_SHARE','RAHASIA_READ','DOWNLOAD'].includes(purpose),'Jenis izin tidak valid.');
  let targetUser=null,targetUnit=null,expires=null;
  if(b.target_unit_id){
   assert(purpose==='BIASA_SHARE'&&!b.target_user_id,'Izin Rahasia dan unduh hanya diberikan kepada pengguna bernama.');
   targetUnit=ctx.tree.byId.get(idOf(b.target_unit_id,'Bagian'));assert(targetUnit&&targetUnit.is_active!==0,'Bagian tidak ditemukan atau tidak aktif.',422);
  }else targetUser=arcActiveUser(db,b.target_user_id);
  if(purpose==='BIASA_SHARE')assert(a.classification==='BIASA','Berbagi hanya untuk arsip Biasa. Untuk arsip Rahasia, berikan izin baca Rahasia.');
  if(purpose==='RAHASIA_READ'){
   assert(a.classification==='RAHASIA','Izin baca Rahasia hanya untuk arsip Rahasia.');
   if(b.expires_at){assert(typeof b.expires_at==='string'&&!Number.isNaN(Date.parse(b.expires_at)),'Batas waktu izin tidak valid.');expires=new Date(b.expires_at).toISOString();assert(expires>at,'Batas waktu izin harus setelah waktu sekarang.');}
  }else assert(!b.expires_at,'Hanya izin baca Rahasia yang dapat diberi batas waktu.');
  const reason=purpose==='BIASA_SHARE'?str(b.reason,'Catatan',archiveRules.reasonMax,{optional:true})||'Dibagikan oleh Humas':str(b.reason,'Alasan pemberian izin',archiveRules.reasonMax);
  // Perpanjangan: izin lama ditutup dan izin baru dibuat dalam transaksi yang sama.
  const previous=targetUser?one(db,'SELECT id FROM archive_access_grants WHERE archive_id=? AND purpose=? AND target_user_id=? AND revoked_at IS NULL',a.id,purpose,targetUser.id)
   :one(db,'SELECT id FROM archive_access_grants WHERE archive_id=? AND purpose=? AND target_unit_id=? AND revoked_at IS NULL',a.id,purpose,targetUnit.id);
  if(previous){
   assert(purpose!=='BIASA_SHARE','Arsip ini sudah dibagikan kepada penerima tersebut.',409);
   run(db,"UPDATE archive_access_grants SET revoked_at=?,revoked_by=?,revoked_reason='Diganti izin baru',updated_at=?,row_version=row_version+1 WHERE id=?",at,ctx.user.id,at,previous.id);
  }
  const grant=insert(db,'archive_access_grants',{archive_id:a.id,purpose,target_user_id:targetUser?.id||null,target_unit_id:targetUnit?.id||null,security_epoch:purpose==='BIASA_SHARE'?null:Number(a.security_epoch),
   valid_from:at,expires_at:expires,granted_by:ctx.user.id,granted_at:at,reason});
  // Notifikasi berbagi hanya untuk pegawai yang secara khusus dituju (Q27); berbagi ke
  // bagian tidak otomatis memberi tahu seluruh anggota.
  let notified=0;
  if(purpose==='BIASA_SHARE'){
   const requested=Array.isArray(b.notify_user_ids)?[...new Set(b.notify_user_ids)]:[];
   assert(requested.length<=100&&requested.every(x=>typeof x==='string'),'Daftar penerima notifikasi tidak valid.');
   const eligible=new Set(targetUser?[targetUser.id]:arcUnitMembers(db,ctx.tree,targetUnit.id).map(m=>m.id));
   assert(requested.every(x=>eligible.has(x)),'Penerima notifikasi harus termasuk penerima akses.',422);
   for(const recipient of requested){
    run(db,`INSERT INTO archive_notifications(id,event_id,notification_type,recipient_user_id,archive_id,payload_minimal,created_at,updated_at,row_version) VALUES(?,?,'ARCHIVE_SHARED',?,?,'{}',?,?,1) ON CONFLICT DO NOTHING`,
     uid(),grant.id,recipient,a.id,at,at);notified++;
   }
  }
  arcAudit(db,ctx,purpose==='BIASA_SHARE'?'SHARE_GRANTED':purpose==='RAHASIA_READ'?'RAHASIA_GRANTED':'DOWNLOAD_GRANTED',{archive_id:a.id,reason,
   context:{grant_id:grant.id,target_user_id:targetUser?.id||null,target_unit_id:targetUnit?.id||null,expires_at:expires,renewed:Boolean(previous),notified,self_grant:targetUser?.id===ctx.user.id}});
  return arcAccessPanel(db,ctx,a.id);
 });
}
function arcRevoke(db,ctx,id,grantId,b){
 return tx(db,()=>{
  arcHumas(db,ctx,'REVOKE',id);
  const {a}=arcLoadFull(db,ctx,id,'REVOKE');
  const grant=one(db,'SELECT * FROM archive_access_grants WHERE id=? AND archive_id=?',idOf(grantId,'Izin'),a.id);
  assert(grant&&!grant.revoked_at,'Izin tidak ditemukan atau sudah dicabut.',409);
  const reason=str(b.reason,'Alasan pencabutan',archiveRules.reasonMax,{optional:true})||'Dicabut oleh Humas',at=now();
  run(db,'UPDATE archive_access_grants SET revoked_at=?,revoked_by=?,revoked_reason=?,updated_at=?,row_version=row_version+1 WHERE id=? AND revoked_at IS NULL',at,ctx.user.id,reason,at,grant.id);
  arcAudit(db,ctx,grant.purpose==='BIASA_SHARE'?'SHARE_REVOKED':grant.purpose==='RAHASIA_READ'?'RAHASIA_REVOKED':'DOWNLOAD_REVOKED',{archive_id:a.id,reason,
   context:{grant_id:grant.id,target_user_id:grant.target_user_id,target_unit_id:grant.target_unit_id}});
  return arcAccessPanel(db,ctx,a.id);
 });
}

/* ---------- Pengajuan hapus, hapus logis, dan pemulihan ---------- */
function arcSoftDelete(db,ctx,a,reason,context={}){
 const at=now();
 const changed=run(db,'UPDATE archive_records SET deleted_at=?,deleted_by=?,delete_reason=?,updated_at=?,updated_by=?,row_version=row_version+1 WHERE id=? AND deleted_at IS NULL',at,ctx.user.id,reason,at,ctx.user.id,a.id);
 assert(changed.changes===1,'Arsip sudah dihapus.',409);
 // RT10: izin Rahasia dan unduh berakhir, supaya pemulihan tidak menghidupkan izin lama.
 // Berbagi Biasa tetap tercatat sampai dicabut Humas (Q28). Berkas di Drive tidak disentuh.
 const ended=arcRevokeEpochGrants(db,ctx,a,'Arsip dihapus');
 arcAudit(db,ctx,'ARCHIVE_DELETED',{archive_id:a.id,reason,context:{...context,grants_ended:ended}});
}
function arcRequestDelete(db,ctx,id,b){
 return tx(db,()=>{
  const {a,access}=arcLoadFull(db,ctx,id,'DELETE_REQUEST');
  if(!access.edit)throw denied(db,ctx.user,'DELETE_REQUEST',a.id,'Hanya petugas arsip bagian pemilik yang dapat mengajukan penghapusan.');
  assert(!one(db,"SELECT 1 AS ok FROM archive_delete_requests WHERE archive_id=? AND status='PENDING'",a.id),'Sudah ada pengajuan penghapusan yang menunggu keputusan Humas.',409);
  const reason=str(b.reason,'Alasan penghapusan',archiveRules.longReasonMax),at=now();
  const request=insert(db,'archive_delete_requests',{archive_id:a.id,requested_by:ctx.user.id,requested_at:at,reason,status:'PENDING'});
  arcAudit(db,ctx,'DELETE_REQUESTED',{archive_id:a.id,reason,context:{request_id:request.id}});
  return arcShow(db,ctx,a.id);
 });
}
function arcDeleteRequests(db,ctx,query){
 const status=query.get('status')||'PENDING';assert(['PENDING','APPROVED','REJECTED','CANCELLED','ALL'].includes(status),'Status tidak valid.');
 const params=[],where=[];
 if(status!=='ALL'){where.push('q.status=?');params.push(status);}
 if(!ctx.humas){where.push('q.requested_by=?');params.push(ctx.user.id);}
 const rows=all(db,`SELECT q.*,a.agenda_number,a.subject,a.classification,a.owner_unit_id,a.deleted_at,u.name AS unit_name FROM archive_delete_requests q JOIN archive_records a ON a.id=q.archive_id JOIN org_units u ON u.id=a.owner_unit_id
  ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY q.requested_at DESC,q.id LIMIT 200`,...params);
 const names=arcUserNames(db,rows.flatMap(r=>[r.requested_by,r.decided_by]));
 // Perihal hanya untuk Humas: pemohon mungkin tidak lagi berhak membaca arsip yang kini Rahasia.
 return {items:rows.map(r=>({id:r.id,archive_id:r.archive_id,agenda_number:r.agenda_number,subject:ctx.humas?r.subject:undefined,classification:ctx.humas?r.classification:undefined,unit:r.unit_name,status:r.status,reason:r.reason,
  requested_at:r.requested_at,requested_by:names.get(r.requested_by)||'—',decided_at:r.decided_at,decided_by:r.decided_by?names.get(r.decided_by)||'—':null,decision_reason:r.decision_reason,
  mine:r.requested_by===ctx.user.id,archive_deleted:Boolean(r.deleted_at)}))};
}
function arcDecideDelete(db,ctx,requestId,b){
 return tx(db,()=>{
  arcHumas(db,ctx,'DELETE_DECIDE');
  const request=one(db,'SELECT * FROM archive_delete_requests WHERE id=?',idOf(requestId,'Pengajuan'));
  assert(request&&request.status==='PENDING','Pengajuan tidak ditemukan atau sudah diputuskan.',409);
  assert(['APPROVE','REJECT'].includes(b.decision),'Keputusan tidak valid.');
  const reason=str(b.reason,'Alasan keputusan',archiveRules.longReasonMax),at=now(),a=one(db,'SELECT * FROM archive_records WHERE id=?',request.archive_id);
  assert(a&&!a.deleted_at,'Arsip sudah dihapus.',409);
  run(db,'UPDATE archive_delete_requests SET status=?,decided_by=?,decided_at=?,decision_reason=?,updated_at=?,row_version=row_version+1 WHERE id=? AND status=?',b.decision==='APPROVE'?'APPROVED':'REJECTED',ctx.user.id,at,reason,at,request.id,'PENDING');
  // Persetujuan dan hapus logis berada dalam satu transaksi.
  if(b.decision==='APPROVE')arcSoftDelete(db,ctx,a,reason,{request_id:request.id});
  else arcAudit(db,ctx,'DELETE_REJECTED',{archive_id:a.id,reason,context:{request_id:request.id}});
  return {ok:true,status:b.decision==='APPROVE'?'APPROVED':'REJECTED'};
 });
}
function arcCancelDelete(db,ctx,requestId){
 return tx(db,()=>{
  const request=one(db,'SELECT * FROM archive_delete_requests WHERE id=?',idOf(requestId,'Pengajuan'));
  if(!request||request.requested_by!==ctx.user.id)throw new AppError(404,'Pengajuan tidak ditemukan.');
  assert(request.status==='PENDING','Pengajuan sudah diputuskan.',409);
  const at=now();
  run(db,"UPDATE archive_delete_requests SET status='CANCELLED',updated_at=?,row_version=row_version+1 WHERE id=? AND status='PENDING'",at,request.id);
  arcAudit(db,ctx,'DELETE_REQUEST_CANCELLED',{archive_id:request.archive_id,context:{request_id:request.id}});
  return {ok:true,status:'CANCELLED'};
 });
}
// Hapus langsung oleh Humas (pengajuan lewat kanal manual): alasan dan rujukan wajib dicatat.
function arcDeleteDirect(db,ctx,id,b){
 return tx(db,()=>{
  arcHumas(db,ctx,'DELETE',id);
  const {a}=arcLoadFull(db,ctx,id,'DELETE');
  const reason=str(b.reason,'Alasan penghapusan',archiveRules.longReasonMax),reference=str(b.reference,'Rujukan pengajuan',archiveRules.reasonMax),at=now();
  const pending=one(db,"SELECT id FROM archive_delete_requests WHERE archive_id=? AND status='PENDING'",a.id);
  if(pending)run(db,"UPDATE archive_delete_requests SET status='APPROVED',decided_by=?,decided_at=?,decision_reason=?,updated_at=?,row_version=row_version+1 WHERE id=?",ctx.user.id,at,reason,at,pending.id);
  arcSoftDelete(db,ctx,a,reason,{reference,request_id:pending?.id||null});
  return {ok:true};
 });
}
function arcDeletedList(db,ctx){
 arcHumas(db,ctx,'DELETED_LIST');
 const rows=all(db,'SELECT a.*,u.name AS unit_name FROM archive_records a JOIN org_units u ON u.id=a.owner_unit_id WHERE a.deleted_at IS NOT NULL ORDER BY a.deleted_at DESC,a.id LIMIT 300');
 const names=arcUserNames(db,rows.map(r=>r.deleted_by));
 // Metadata pemulihan saja; pratinjau dan unduh tetap tertutup selama arsip dihapus.
 return {items:rows.map(r=>({...arcFull({...r,is_full:1}),deleted_at:r.deleted_at,deleted_by:names.get(r.deleted_by)||'—',delete_reason:r.delete_reason}))};
}
function arcRestore(db,ctx,id,b){
 return tx(db,()=>{
  arcHumas(db,ctx,'RESTORE',id);
  const a=one(db,'SELECT * FROM archive_records WHERE id=?',idOf(id,'Arsip'));
  assert(a&&a.deleted_at,'Arsip yang dihapus tidak ditemukan.',404);
  const reason=str(b.reason,'Alasan pemulihan',archiveRules.longReasonMax),at=now();
  run(db,'UPDATE archive_records SET deleted_at=NULL,deleted_by=NULL,delete_reason=NULL,updated_at=?,updated_by=?,row_version=row_version+1 WHERE id=? AND deleted_at IS NOT NULL',at,ctx.user.id,a.id);
  arcAudit(db,ctx,'ARCHIVE_RESTORED',{archive_id:a.id,reason,context:{deleted_at:a.deleted_at,previous_reason:a.delete_reason}});
  return {ok:true,id:a.id,agenda_number:a.agenda_number,classification:a.classification};
 });
}

/* ---------- Riwayat ---------- */
function arcHistory(db,ctx,id){
 const {a,access}=arcLoadFull(db,ctx,id,'HISTORY');
 // RT07: audit lengkap untuk Humas; petugas pembaca melihat perubahan isi/metadata saja.
 if(!ctx.humas&&!access.edit)throw denied(db,ctx.user,'HISTORY',a.id,'Riwayat arsip hanya untuk petugas arsip bagian pemilik dan Humas.');
 const rows=all(db,"SELECT * FROM archive_audit_events WHERE archive_id=? AND outcome='SUCCESS' ORDER BY occurred_at DESC,id LIMIT 300",a.id)
  .filter(r=>ctx.humas?!['DETAIL_OPENED','PREVIEW_OPENED'].includes(r.action):archiveContentActions.includes(r.action));
 const names=arcUserNames(db,rows.map(r=>r.actor_user_id));
 return {items:rows.map(r=>({id:r.id,occurred_at:r.occurred_at,action:r.action,actor:names.get(r.actor_user_id)||'Sistem',reason:r.reason,before:parse(r.before_data,null),after:parse(r.after_data,null),
  context:ctx.humas?parse(r.safe_context,{}):undefined}))};
}

/* ---------- Master jenis dokumen ---------- */
function arcTypeSave(db,ctx,id,b){
 return tx(db,()=>{
  arcHumas(db,ctx,'TYPE_MANAGE');
  const at=now();
  if(!id){
   const code=str(b.code,'Kode jenis',20).toUpperCase();assert(/^[A-Z0-9_-]{1,20}$/.test(code),'Kode jenis hanya huruf, angka, garis bawah, atau tanda hubung.');
   const name=str(b.name,'Nama jenis',80),normalized=archiveNormalName(name);
   assert(!one(db,'SELECT 1 AS ok FROM archive_document_types WHERE code=? OR name_normalized=?',code,normalized),'Kode atau nama jenis dokumen sudah ada.',409);
   const type=insert(db,'archive_document_types',{code,name,name_normalized:normalized,is_active:1,created_by:ctx.user.id,updated_by:ctx.user.id});
   arcAudit(db,ctx,'TYPE_CREATED',{after:{code,name},context:{type_id:type.id}});
   audit(db,ctx.user,'ARCHIVE_TYPE_CREATED','archive_document_types',type.id,{code,name});
  }else{
   const type=arcType(db,id,{mustBeActive:false}),name=b.name===undefined?type.name:str(b.name,'Nama jenis',80),active=b.is_active===undefined?Number(type.is_active):b.is_active?1:0,normalized=archiveNormalName(name);
   assert(b.code===undefined||String(b.code).toUpperCase()===type.code,'Kode jenis tidak dapat diubah.');
   assert(!one(db,'SELECT 1 AS ok FROM archive_document_types WHERE name_normalized=? AND id<>?',normalized,type.id),'Nama jenis dokumen sudah dipakai.',409);
   assert(Number.isInteger(b.expected_row_version),'Versi data wajib dikirim. Muat ulang data.',409);
   // Mengganti nama master tidak mengubah snapshot nama pada arsip yang sudah tersimpan.
   const changed=run(db,'UPDATE archive_document_types SET name=?,name_normalized=?,is_active=?,updated_by=?,updated_at=?,row_version=row_version+1 WHERE id=? AND row_version=?',name,normalized,active,ctx.user.id,at,type.id,b.expected_row_version);
   assert(changed.changes===1,'Data sudah berubah. Muat ulang sebelum menyimpan.',409);
   arcAudit(db,ctx,'TYPE_UPDATED',{before:{name:type.name,active:Number(type.is_active)===1},after:{name,active:active===1},context:{type_id:type.id}});
   audit(db,ctx.user,'ARCHIVE_TYPE_UPDATED','archive_document_types',type.id,{name,active:active===1});
  }
  return {types:arcTypes(db)};
 });
}

/* ---------- Penunjukan petugas (administrator) ---------- */
function arcAdmin(db,ctx,action){if(!ctx.admin)throw denied(db,ctx.user,action,null,'Tindakan ini hanya untuk administrator portal.');}
function arcOfficers(db,ctx){
 arcAdmin(db,ctx,'OFFICER_LIST');
 const rows=all(db,'SELECT * FROM archive_officers ORDER BY revoked_at IS NOT NULL,assigned_at DESC,id LIMIT 500'),names=arcUserNames(db,rows.flatMap(r=>[r.user_id,r.assigned_by,r.revoked_by])),codes=arcUnitCodes(db);
 const used=new Set(all(db,'SELECT DISTINCT owner_unit_id FROM archive_records').map(r=>r.owner_unit_id));
 return {officers:rows.map(r=>{
   const user=one(db,'SELECT id,employee_id,status FROM users WHERE id=?',r.user_id),member=user?arcMemberUnits(db,ctx.tree,user.employee_id).has(r.org_unit_id):false;
   const timeOk=r.valid_from<=ctx.nowIso&&(!r.expires_at||r.expires_at>ctx.nowIso);
   return {id:r.id,user:{id:r.user_id,name:names.get(r.user_id)||'—'},unit:{id:r.org_unit_id,name:ctx.tree.byId.get(r.org_unit_id)?.name||'—'},valid_from:r.valid_from,expires_at:r.expires_at,
    assigned_at:r.assigned_at,assigned_by:names.get(r.assigned_by)||'—',reason:r.reason,revoked_at:r.revoked_at,revoked_by:r.revoked_by?names.get(r.revoked_by)||'—':null,revoke_reason:r.revoke_reason,
    // Penunjukan hanya berlaku selama petugas masih anggota aktif bagian itu (RT16).
    status:r.revoked_at?'DICABUT':!timeOk?'KEDALUWARSA':user?.status!=='ACTIVE'||!member?'TIDAK_BERLAKU':'AKTIF'};}),
  units:ctx.tree.rows.filter(u=>u.is_active!==0).map(u=>({id:u.id,name:u.name,code:u.code,agenda_code:codes.get(u.id)||null,suggested_code:archiveSuggestCode(u.code),code_locked:used.has(u.id)}))};
}
function arcAssign(db,ctx,b){
 return tx(db,()=>{
  arcAdmin(db,ctx,'OFFICER_ASSIGN');
  const unit=ctx.tree.byId.get(idOf(b.org_unit_id,'Bagian'));assert(unit&&unit.is_active!==0,'Bagian tidak ditemukan atau tidak aktif.',422);
  const target=arcActiveUser(db,b.user_id),reason=str(b.reason,'Dasar penunjukan',archiveRules.reasonMax),at=now();
  assert(target.employee_id&&arcMemberUnits(db,ctx.tree,target.employee_id).has(unit.id),'Petugas harus pegawai aktif yang ditempatkan pada bagian tersebut.',422);
  let expires=null;
  if(b.expires_at){assert(typeof b.expires_at==='string'&&!Number.isNaN(Date.parse(b.expires_at)),'Batas waktu penunjukan tidak valid.');expires=new Date(b.expires_at).toISOString();assert(expires>at,'Batas waktu penunjukan harus setelah waktu sekarang.');}
  // Kode agenda bagian ditetapkan sekali, sebelum nomor agenda pertama terbit.
  const existing=one(db,'SELECT agenda_code FROM archive_units WHERE org_unit_id=?',unit.id);
  if(!existing){
   const code=String(b.agenda_code||'').trim().toUpperCase();
   assert(archiveAgendaCode(code),'Kode agenda bagian wajib diisi: 2–12 huruf kapital atau angka, misalnya HMS.');
   assert(!one(db,'SELECT 1 AS ok FROM archive_units WHERE agenda_code=?',code),'Kode agenda sudah dipakai bagian lain.',409);
   insert(db,'archive_units',{org_unit_id:unit.id,agenda_code:code,created_by:ctx.user.id});
  }
  // Penunjukan lama (termasuk yang kedaluwarsa) ditutup eksplisit sebelum yang baru dibuat.
  const open=one(db,'SELECT id FROM archive_officers WHERE user_id=? AND org_unit_id=? AND revoked_at IS NULL',target.id,unit.id);
  if(open)run(db,"UPDATE archive_officers SET revoked_at=?,revoked_by=?,revoke_reason='Diganti penunjukan baru',updated_at=?,row_version=row_version+1 WHERE id=?",at,ctx.user.id,at,open.id);
  const officer=insert(db,'archive_officers',{user_id:target.id,org_unit_id:unit.id,valid_from:at,expires_at:expires,assigned_by:ctx.user.id,assigned_at:at,reason});
  arcAudit(db,ctx,'OFFICER_ASSIGNED',{reason,context:{officer_id:officer.id,user_id:target.id,org_unit_id:unit.id,expires_at:expires,renewed:Boolean(open)}});
  audit(db,ctx.user,'ARCHIVE_OFFICER_ASSIGNED','archive_officers',officer.id,{user_id:target.id,org_unit_id:unit.id},reason);
  return arcOfficers(db,ctx);
 });
}
function arcUnassign(db,ctx,officerId,b){
 return tx(db,()=>{
  arcAdmin(db,ctx,'OFFICER_REVOKE');
  const officer=one(db,'SELECT * FROM archive_officers WHERE id=?',idOf(officerId,'Penunjukan'));
  assert(officer&&!officer.revoked_at,'Penunjukan tidak ditemukan atau sudah dicabut.',409);
  const reason=str(b.reason,'Alasan pencabutan',archiveRules.reasonMax),at=now();
  run(db,'UPDATE archive_officers SET revoked_at=?,revoked_by=?,revoke_reason=?,updated_at=?,row_version=row_version+1 WHERE id=? AND revoked_at IS NULL',at,ctx.user.id,reason,at,officer.id);
  arcAudit(db,ctx,'OFFICER_REVOKED',{reason,context:{officer_id:officer.id,user_id:officer.user_id,org_unit_id:officer.org_unit_id}});
  audit(db,ctx.user,'ARCHIVE_OFFICER_REVOKED','archive_officers',officer.id,{user_id:officer.user_id,org_unit_id:officer.org_unit_id},reason);
  return arcOfficers(db,ctx);
 });
}
function arcSetUnitCode(db,ctx,b){
 return tx(db,()=>{
  arcAdmin(db,ctx,'UNIT_CODE');
  const unit=ctx.tree.byId.get(idOf(b.org_unit_id,'Bagian'));assert(unit,'Bagian tidak ditemukan.',422);
  const code=String(b.agenda_code||'').trim().toUpperCase();assert(archiveAgendaCode(code),'Kode agenda: 2–12 huruf kapital atau angka, misalnya HMS.');
  assert(!one(db,'SELECT 1 AS ok FROM archive_records WHERE owner_unit_id=? LIMIT 1',unit.id),'Kode agenda tidak dapat diubah setelah dipakai nomor agenda.',409);
  assert(!one(db,'SELECT 1 AS ok FROM archive_units WHERE agenda_code=? AND org_unit_id<>?',code,unit.id),'Kode agenda sudah dipakai bagian lain.',409);
  const existing=one(db,'SELECT id,agenda_code FROM archive_units WHERE org_unit_id=?',unit.id),at=now();
  if(existing)run(db,'UPDATE archive_units SET agenda_code=?,updated_at=?,row_version=row_version+1 WHERE id=?',code,at,existing.id);
  else insert(db,'archive_units',{org_unit_id:unit.id,agenda_code:code,created_by:ctx.user.id});
  arcAudit(db,ctx,'UNIT_CODE_SET',{before:existing?{agenda_code:existing.agenda_code}:null,after:{agenda_code:code},context:{org_unit_id:unit.id}});
  return arcOfficers(db,ctx);
 });
}
// Pencarian penerima izin/petugas. Hanya Humas dan administrator.
function arcLookup(db,ctx,query){
 if(!ctx.humas&&!ctx.admin)throw denied(db,ctx.user,'LOOKUP',null);
 const kind=query.get('kind');
 if(kind==='unit-members')return {users:arcUnitMembers(db,ctx.tree,idOf(query.get('unit'),'Bagian')).map(m=>({id:m.id,name:m.full_name,note:[m.position_name,ctx.tree.byId.get(m.org_unit_id)?.name].filter(Boolean).join(' · ')}))};
 if(kind==='units')return {units:ctx.tree.rows.filter(u=>u.is_active!==0).map(u=>({id:u.id,name:u.name}))};
 assert(kind==='users','Jenis pencarian tidak valid.');
 const q=archiveNormalName(query.get('q')||'');assert(q.length>=2&&q.length<=60,'Ketik minimal 2 huruf nama atau username.');
 const day=today();
 const rows=all(db,`SELECT u.id,u.username,e.full_name,(SELECT p.name FROM employee_placements ep JOIN positions p ON p.id=ep.position_id WHERE ep.employee_id=e.id AND ep.is_primary=1 AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?) LIMIT 1) AS position_name
  FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.status='ACTIVE' AND (u.employee_id IS NULL OR e.is_active=1) AND (lower(u.username) LIKE ? ESCAPE '\\' OR lower(coalesce(e.full_name,'')) LIKE ? ESCAPE '\\') ORDER BY coalesce(e.full_name,u.username),u.id LIMIT 20`,
  day,day,archiveLike(q),archiveLike(q));
 return {users:rows.map(r=>({id:r.id,name:r.full_name||r.username,note:[r.position_name,r.username].filter(Boolean).join(' · ')}))};
}

/* ---------- Laporan ---------- */
const reportTitles={recap_period:'Rekap Arsip per Periode',recap_unit:'Rekap Arsip per Bagian',recap_type:'Rekap Arsip per Jenis Dokumen',agenda_in:'Buku Agenda Surat Masuk',agenda_out:'Buku Agenda Surat Keluar'};
function arcReport(db,ctx,b){
 const type=b.type;assert(archiveReportTypes.includes(type),'Jenis laporan tidak valid.');
 assert(['xlsx','pdf'].includes(b.format),'Format laporan tidak valid.');
 assert(archiveValidDay(b.from)&&archiveValidDay(b.to)&&b.from<=b.to,'Periode laporan tidak valid.');
 // RT19: periode memakai tanggal pengarsipan; tanggal surat hanya kolom.
 const query=new URLSearchParams({from:b.from,to:b.to}),notes=[];
 if(b.unit_id)query.set('unit',b.unit_id);
 if(type==='agenda_in')query.set('direction','MASUK');
 if(type==='agenda_out')query.set('direction','KELUAR');
 if(b.document_type_id&&['recap_type','recap_period'].includes(type))query.set('type',b.document_type_id);
 const selectParams=[],filterParams=[],filters=arcFilters(ctx,query,filterParams);
 const rows=all(db,`SELECT a.*,u.name AS unit_name,CASE WHEN ${fullSql(ctx,selectParams)} THEN 1 ELSE 0 END AS is_full FROM archive_records a JOIN org_units u ON u.id=a.owner_unit_id
  WHERE ${filters.where.join(' AND ')} ORDER BY a.archived_at ASC,a.id ASC LIMIT ${archiveRules.reportMaxRows+1}`,...selectParams,...filterParams);
 assert(rows.length<=archiveRules.reportMaxRows,`Laporan melebihi ${archiveRules.reportMaxRows} baris. Persempit periode laporan.`);
 const items=rows.map(arcProject),restricted=items.filter(i=>i.restricted).length,groups=[];
 const count=(key,label)=>{const map=new Map();for(const i of items.filter(x=>!x.restricted)){const k=key(i);map.set(k,(map.get(k)||0)+1);}for(const [name,total] of [...map].sort((x,y)=>String(x[0]).localeCompare(String(y[0]))))groups.push({label:`${label}: ${name}`,count:total});};
 if(type==='recap_unit'){
  // Bagian dapat diketahui dari nomor agenda, jadi baris Rahasia terbatas ikut dihitung per bagian.
  const map=new Map();for(const r of rows)map.set(r.unit_name,(map.get(r.unit_name)||0)+1);
  for(const [name,total] of [...map].sort((x,y)=>x[0].localeCompare(y[0])))groups.push({label:`Bagian: ${name}`,count:total});
 }
 if(type==='recap_type'){count(i=>i.document_type,'Jenis');if(restricted)groups.push({label:'Rahasia dengan informasi terbatas (jenis tidak ditampilkan)',count:restricted});}
 if(type==='recap_period')count(i=>directionLabel[i.direction],'Arah');
 if(type==='recap_period'&&restricted)groups.push({label:'Rahasia dengan informasi terbatas',count:restricted});
 if(['agenda_in','agenda_out'].includes(type))notes.push('Laporan ini hanya memuat arsip dengan arah surat yang boleh Anda ketahui.');
 if(filters.hidden&&!['agenda_in','agenda_out'].includes(type))notes.push('Saringan jenis hanya diterapkan pada arsip yang dapat Anda baca.');
 if(restricted)notes.push('Arsip Rahasia tanpa izin baca hanya menampilkan nomor agenda, tanggal pengarsipan, dan label Rahasia.');
 const unitName=b.unit_id?ctx.tree.byId.get(b.unit_id)?.name||'—':'Semua bagian dalam kewenangan',typeName=query.get('type')?arcTypes(db).find(t=>t.id===query.get('type'))?.name||'—':null;
 const requester=arcUserNames(db,[ctx.user.id]).get(ctx.user.id)||ctx.user.username;
 arcAudit(db,ctx,'REPORT_EXPORTED',{context:{type,format:b.format,from:b.from,to:b.to,unit_id:b.unit_id||null,document_type_id:query.get('type')||null,rows:items.length}});
 return {type,title:reportTitles[type],format:b.format,period:{from:b.from,to:b.to},generated_at:now(),requested_by:requester,
  filters:[`Periode pengarsipan: ${b.from} s.d. ${b.to}`,`Bagian: ${unitName}`,...(typeName?[`Jenis dokumen: ${typeName}`]:[])],notes,groups,total:items.length,
  rows:items.map(i=>i.restricted?{agenda_number:i.agenda_number,archived_on:archiveWitaDate(Date.parse(i.archived_at)),classification:'Rahasia',restricted:true}
   :{agenda_number:i.agenda_number,archived_on:archiveWitaDate(Date.parse(i.archived_at)),letter_date:i.letter_date,direction:directionLabel[i.direction],document_type:i.document_type,
     official_number:i.official_number||'',subject:i.subject,unit:i.unit.name,classification:i.classification==='RAHASIA'?'Rahasia':'Biasa',restricted:false})};
}

/* ---------- Notifikasi portal dan ringkasan harian Humas ---------- */
function arcHumasUsers(db){
 return all(db,`SELECT DISTINCT u.id ${HOLD_SQL} JOIN users u ON u.id=ur.user_id LEFT JOIN employees e ON e.id=u.employee_id WHERE p.code=? AND u.status='ACTIVE' AND (u.employee_id IS NULL OR e.is_active=1)`,HUMAS).map(r=>r.id);
}
// Satu ringkasan per tanggal per Humas aktif: jumlah arsip yang difinalisasi pada hari itu
// (WITA), per bagian, tanpa isi dokumen. Dibuat saat Humas pertama membuka notifikasi
// setelah pukul 07.00 WITA; kunci unik mencegah ringkasan ganda bila dijalankan ulang.
export function archiveEnsureDailySummaries(db,nowMs=Date.now()){
 const todayWita=archiveWitaDate(nowMs),lastDay=archiveShiftDay(todayWita,archiveWitaHour(nowMs)>=archiveRules.digestHour?-1:-2);
 const latest=one(db,'SELECT max(summary_date) AS day FROM archive_daily_summary_runs')?.day||null;
 if(latest&&latest>=lastDay)return 0;
 let first=latest?archiveShiftDay(latest,1):lastDay;
 const earliest=archiveShiftDay(lastDay,-(archiveRules.summaryBackfillDays-1));if(first<earliest)first=earliest;
 const tree=arcTree(db),recipients=arcHumasUsers(db);let created=0;
 for(let day=first;day<=lastDay;day=archiveShiftDay(day,1)){
  const start=archiveDayStart(day),end=archiveDayEnd(day),at=now(),runId=uid();
  // Peristiwa pengarsipan: arsip yang kemudian dihapus logis tetap dihitung; edit, versi baru, dan pemulihan tidak.
  const counts=all(db,'SELECT owner_unit_id,count(*) n FROM archive_records WHERE archived_at>=? AND archived_at<? GROUP BY owner_unit_id',start,end)
   .map(r=>({unit_id:r.owner_unit_id,unit:tree.byId.get(r.owner_unit_id)?.name||'—',count:Number(r.n)})).sort((x,y)=>x.unit.localeCompare(y.unit));
  const total=counts.reduce((n,c)=>n+c.count,0);
  const inserted=run(db,`INSERT INTO archive_daily_summary_runs(id,summary_date,timezone,period_start,period_end,counts_by_unit,total,status,prepared_at,created_at,updated_at,row_version) VALUES(?,?,?,?,?,?,?,'PREPARED',?,?,?,1) ON CONFLICT(summary_date) DO NOTHING`,
   runId,day,archiveRules.timezone,start,end,JSON.stringify(counts),total,at,at,at);
  if(inserted.changes!==1)continue;
  const payload=JSON.stringify({total,units:counts.map(c=>({unit:c.unit,count:c.count}))});
  for(const recipient of recipients)run(db,`INSERT INTO archive_notifications(id,event_id,notification_type,recipient_user_id,summary_date,payload_minimal,created_at,updated_at,row_version) VALUES(?,?,'HUMAS_DAILY_SUMMARY',?,?,?,?,?,1) ON CONFLICT DO NOTHING`,
   uid(),runId,recipient,day,payload,at,at);
  run(db,"UPDATE archive_daily_summary_runs SET status='COMPLETED',completed_at=?,updated_at=?,row_version=row_version+1 WHERE id=?",at,at,runId);
  created++;
 }
 return created;
}
function arcNotifications(db,ctx){
 if(ctx.humas)archiveEnsureDailySummaries(db);
 const rows=all(db,'SELECT * FROM archive_notifications WHERE recipient_user_id=? ORDER BY created_at DESC,id LIMIT 40',ctx.user.id);
 return {unread:arcUnread(db,ctx.user.id),items:rows.map(n=>{
  const base={id:n.id,type:n.notification_type,created_at:n.created_at,read:Boolean(n.read_at)};
  if(n.notification_type==='HUMAS_DAILY_SUMMARY'){
   // Ringkasan hanya untuk pengguna yang saat ini masih Humas.
   const payload=ctx.humas?parse(n.payload_minimal,{}):{};
   return {...base,summary_date:n.summary_date,total:ctx.humas?Number(payload.total||0):null,units:ctx.humas?payload.units||[]:[]};
  }
  // Notifikasi hanya menyimpan rujukan; isi yang tampil mengikuti hak akses saat dibaca.
  const a=one(db,'SELECT a.*,u.name AS unit_name FROM archive_records a JOIN org_units u ON u.id=a.owner_unit_id WHERE a.id=?',n.archive_id),access=a?arcAccess(db,ctx,a):null;
  if(!a||!access.list)return {...base,available:false};
  return {...base,available:true,archive:access.read?{id:a.id,agenda_number:a.agenda_number,subject:a.subject,unit:a.unit_name}:{id:a.id,agenda_number:a.agenda_number}};
 })};
}
function arcReadNotifications(db,ctx,b){
 const at=now();
 if(b.all===true)run(db,'UPDATE archive_notifications SET read_at=?,updated_at=?,row_version=row_version+1 WHERE recipient_user_id=? AND read_at IS NULL',at,at,ctx.user.id);
 else{
  assert(Array.isArray(b.ids)&&b.ids.length>0&&b.ids.length<=100&&b.ids.every(x=>typeof x==='string'),'Daftar notifikasi tidak valid.');
  for(const id of b.ids)run(db,'UPDATE archive_notifications SET read_at=?,updated_at=?,row_version=row_version+1 WHERE id=? AND recipient_user_id=? AND read_at IS NULL',at,at,id,ctx.user.id);
 }
 return {unread:arcUnread(db,ctx.user.id)};
}

/* ---------- Rute ---------- */
// deps: { readFile(storageKey) -> bytes, claimFile(db,user,fileId), claimStorage(storageKey) }.
// Di produksi gateway portal-api menyuntikkan pembaca Drive (folder SPH-Portal-Arsip) dan
// pemeriksa lampiran miliknya; di portal lokal server.mjs menyuntikkan penyimpanan berkas lokal.
export async function archiveRoutes({db,user,p,method,body,url},deps={}){
 if(p[0]!=='archives')return undefined;
 const ctx=arcActor(db,user),b=body||{},query=url.searchParams;
 const GET=method==='GET',POST=method==='POST',PATCH=method==='PATCH';
 if(p.length===1&&GET)return arcList(db,ctx,query);
 if(p.length===1&&POST)return arcCreate(db,ctx,deps,b);
 if(p.length===2){
  if(p[1]==='overview'&&GET)return arcOverview(db,ctx);
  if(p[1]==='dashboard'&&GET)return arcDashboard(db,ctx);
  if(p[1]==='types'&&GET)return {types:arcTypes(db)};
  if(p[1]==='types'&&POST)return arcTypeSave(db,ctx,null,b);
  if(p[1]==='officers'&&GET)return arcOfficers(db,ctx);
  if(p[1]==='officers'&&POST)return arcAssign(db,ctx,b);
  if(p[1]==='units'&&POST)return arcSetUnitCode(db,ctx,b);
  if(p[1]==='lookups'&&GET)return arcLookup(db,ctx,query);
  if(p[1]==='reports'&&POST)return arcReport(db,ctx,b);
  if(p[1]==='notifications'&&GET)return arcNotifications(db,ctx);
  if(p[1]==='delete-requests'&&GET)return arcDeleteRequests(db,ctx,query);
  if(p[1]==='deleted'&&GET)return arcDeletedList(db,ctx);
 }
 if(p[1]==='types'&&p.length===3&&PATCH)return arcTypeSave(db,ctx,p[2],b);
 if(p[1]==='officers'&&p.length===4&&p[3]==='revoke'&&POST)return arcUnassign(db,ctx,p[2],b);
 if(p[1]==='notifications'&&p.length===3&&p[2]==='read'&&POST)return arcReadNotifications(db,ctx,b);
 if(p[1]==='delete-requests'&&p.length===4&&POST){
  if(p[3]==='decide')return arcDecideDelete(db,ctx,p[2],b);
  if(p[3]==='cancel')return arcCancelDelete(db,ctx,p[2]);
 }
 if(p[1]==='deleted'&&p.length===4&&p[3]==='restore'&&POST)return arcRestore(db,ctx,p[2],b);
 if(['overview','dashboard','types','officers','units','lookups','reports','notifications','delete-requests','deleted'].includes(p[1]))return undefined;
 // archives/<id>/…
 const id=p[1];
 if(p.length===2&&GET){
  const loaded=arcLoad(db,ctx,id);
  if(loaded.access.read)arcAudit(db,ctx,'DETAIL_OPENED',{archive_id:loaded.a.id});
  return arcDetail(db,ctx,loaded.a,loaded.access);
 }
 if(p.length===2&&PATCH)return arcEdit(db,ctx,id,b);
 if(p.length===3){
  if(p[2]==='history'&&GET)return arcHistory(db,ctx,id);
  if(p[2]==='access'&&GET)return arcAccessPanel(db,ctx,id);
  if(p[2]==='classification'&&POST)return arcClassify(db,ctx,id,b);
  if(p[2]==='grants'&&POST)return arcGrant(db,ctx,id,b);
  if(p[2]==='delete-requests'&&POST)return arcRequestDelete(db,ctx,id,b);
  if(p[2]==='delete'&&POST)return arcDeleteDirect(db,ctx,id,b);
  if(p[2]==='documents'&&POST)return arcAddAttachment(db,ctx,deps,id,b);
 }
 if(p.length===5&&p[2]==='grants'&&p[4]==='revoke'&&POST)return arcRevoke(db,ctx,id,p[3],b);
 if(p.length===5&&p[2]==='documents'&&POST){
  if(p[4]==='versions')return arcReplaceFile(db,ctx,deps,id,p[3],b);
  if(p[4]==='remove')return arcRemoveAttachment(db,ctx,id,p[3],b);
 }
 // Pratinjau dan unduh adalah dua rute berbeda dengan pemeriksaan berbeda:
 //   pratinjau = hak baca; unduh berkas asli = hak baca DAN izin unduh aktif (termasuk Humas).
 // Versi lama mengikuti izin terkini. Bytes selalu disalurkan portal, tidak pernah URL Drive.
 if(p.length===7&&p[2]==='documents'&&p[4]==='versions'&&['preview','download'].includes(p[6])&&GET){
  const download=p[6]==='download',{a,access}=arcLoadFull(db,ctx,id,download?'DOWNLOAD':'PREVIEW');
  if(download&&!access.download)throw denied(db,ctx.user,'DOWNLOAD',a.id,'Unduh memerlukan izin Humas. Hubungi Humas secara langsung.');
  const v=arcVersionOf(db,a,p[3],p[5]);
  assert(typeof deps.readFile==='function','Penyimpanan berkas belum dikonfigurasi.',503);
  let bytes;
  try{bytes=await deps.readFile(v.storage_key);}catch(error){if(error?.status&&error.status!==404)throw error;bytes=null;}
  assert(bytes&&bytes.length===Number(v.byte_size),'Layanan berkas sedang terganggu atau berkas belum dapat diverifikasi. Coba lagi nanti.',503);
  arcAudit(db,ctx,download?'DOWNLOAD_STARTED':'PREVIEW_OPENED',{archive_id:a.id,document_id:p[3],version_id:v.id});
  return {mime:v.detected_mime,size:Number(v.byte_size),data:Buffer.from(bytes).toString('base64'),...(download?{filename:v.original_filename}:{})};
 }
 return undefined;
}
