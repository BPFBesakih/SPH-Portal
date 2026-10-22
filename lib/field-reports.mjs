import {get,insert,assert,text,instant,now} from './db.mjs';
import {employeeContext,requireAccess,digest} from './auth.mjs';
import {claimFile} from './files.mjs';
const fresh=value=>{const stamp=instant(value);assert(Date.parse(stamp)>=Date.now()-15*60000&&Date.parse(stamp)<=Date.now()+60000,'Lokasi atau foto sudah kedaluwarsa. Ambil lokasi dan foto kembali.');return stamp;};
export function fieldReportPayload(db,user,b,incident=false) {
  assert(user.employee_id,'Akun Anda belum terhubung dengan profil pegawai. Hubungi Admin/SDM.',403);
  const employee=get(db,'employees',user.employee_id);assert(employee.is_active,'Profil pegawai tidak aktif.',403);
  for(const key of ['employee_id','reporter_employee_id'])assert(!b[key]||b[key]===user.employee_id,'Identitas pelapor harus sesuai akun yang sedang login.',403);
  assert(!b.post_id,'Formulir pelaporan sudah diperbarui. Muat ulang halaman.');
  const ctx=employeeContext(db,employee.id);
  requireAccess(db,user,incident?'security.incidents.create':'security.logbook.create',{...ctx,reporter_employee_id:employee.id});
  return fieldReportDetails(b,employee.id,ctx.org_unit_id,incident);
}
export function fieldReportDetails(b,employeeId,orgUnitId,incident=false) {
  const location=b.location;
  assert(location&&typeof location==='object','Lokasi perangkat wajib berhasil didapatkan sebelum laporan dikirim.');
  const numeric=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
  assert(numeric(location.latitude,-90,90)&&numeric(location.longitude,-180,180)&&numeric(location.accuracy,0,10000000),'Koordinat atau akurasi lokasi tidak valid.');
  assert(Array.isArray(b.photos)&&b.photos.length>=1&&b.photos.length<=5,'Ambil minimal satu dan maksimal lima foto melalui kamera aplikasi.');
  const photos=b.photos.map(photo=>{assert(photo&&photo.source==='CAMERA','Foto wajib diambil melalui kamera aplikasi.');return {file_id:text(photo.file_id,'Berkas foto',100),captured_at:fresh(photo.captured_at),capture_source:'CAMERA'};});
  assert(new Set(photos.map(p=>p.file_id)).size===photos.length,'Foto yang sama tidak dapat digunakan berulang.');
  const payload={post_id:null,reporting_org_unit_id:orgUnitId||null,latitude:location.latitude,longitude:location.longitude,location_accuracy:location.accuracy,location_captured_at:fresh(location.captured_at),occurred_at:instant(b.occurred_at)};
  if(incident)Object.assign(payload,{reporter_employee_id:employeeId,incident_type:text(b.incident_type,'Kategori kejadian',200),chronology:text(b.chronology,'Kronologi',20000),initial_action:null,source_logbook_entry_id:b.source_logbook_entry_id||null});
  else Object.assign(payload,{employee_id:employeeId,activity_type:b.activity_type,activity_notes:text(b.activity_notes,'Uraian kegiatan',10000),findings:null,roster_assignment_id:null});
  return {payload,photos,key:text(b.idempotency_key,'Kunci permintaan',100),fingerprint:digest(JSON.stringify({payload,photos}))};
}
export function attachEvidence(db,user,kind,id,photos) {
  for(const photo of photos){
    const file=claimFile(db,user,photo.file_id);
    assert(['image/png','image/jpeg'].includes(file.mime_type),'Bukti kamera harus berupa foto JPG atau PNG.');
    assert(Date.parse(file.created_at)>=Date.now()-15*60000,'Foto unggahan sudah kedaluwarsa. Ambil foto kembali.');
    insert(db,kind==='incident'?'incident_files':'logbook_files',{[kind==='incident'?'incident_id':'logbook_entry_id']:id,...photo,caption:'Foto bukti dari kamera',created_by:user.id});
  }
}
