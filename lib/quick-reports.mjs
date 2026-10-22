import {randomBytes} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {all,one,run,get,insert,update,tx,audit,assert,text,now,today,enumValue} from './db.mjs';
import {has,can,digest} from './auth.mjs';
import {storeUpload} from './files.mjs';
import {fieldReportDetails,attachEvidence} from './field-reports.mjs';

const tokenPattern=/^[a-f0-9]{64}$/;
const securityPosition=name=>/\b(keamanan|ketertiban|bankamda|linmas|satpam|security)\b/i.test(name);
const invalidLink='Tautan laporan tidak aktif. Minta tautan terbaru kepada koordinator.';
function positionIds(link){try{const ids=JSON.parse(link.position_ids);assert(Array.isArray(ids)&&ids.length>0,'Konfigurasi tautan tidak valid.',403);return ids;}catch{assert(false,invalidLink,403);}}
function manageable(db,user,link){return positionIds(link).every(id=>{const position=one(db,'SELECT * FROM positions WHERE id=?',id);return position&&can(db,user,'security.config.manage',{org_unit_id:position.org_unit_id});});}
function securityPositions(db,user){return all(db,'SELECT p.id,p.name,p.org_unit_id,u.name unit_name FROM positions p JOIN org_units u ON u.id=p.org_unit_id WHERE p.is_active=1 AND u.is_active=1 ORDER BY p.name').filter(p=>securityPosition(p.name)&&can(db,user,'security.config.manage',{org_unit_id:p.org_unit_id}));}
function eligibleEmployees(db,ids){
  return all(db,`SELECT e.id,e.full_name,p.name position_name,p.id position_id,p.org_unit_id FROM employees e JOIN employee_placements ep ON ep.employee_id=e.id JOIN positions p ON p.id=ep.position_id JOIN org_units u ON u.id=p.org_unit_id WHERE e.is_active=1 AND p.is_active=1 AND u.is_active=1 AND ep.is_primary=1 AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?) ORDER BY e.full_name,e.id`,today(),today()).filter(e=>ids.includes(e.position_id)&&securityPosition(e.position_name));
}
function validLink(db,token){
  assert(typeof token==='string'&&tokenPattern.test(token),invalidLink,404);
  const link=one(db,'SELECT * FROM quick_report_links WHERE token_hash=? AND is_active=1',digest(token));assert(link,invalidLink,404);
  const owner=one(db,"SELECT * FROM users WHERE id=? AND status='ACTIVE'",link.created_by);
  assert(owner&&!owner.must_change_password&&(!owner.employee_id||get(db,'employees',owner.employee_id).is_active)&&manageable(db,owner,link),invalidLink,403);
  return link;
}
export function quickReportManagement(c){
  const {db,user,p,method,body:b}=c;if(p[0]!=='report-links')return;
  assert(has(db,user,'security.config.manage'),'Akses pengelolaan tautan ditolak.',403);
  if(method==='GET'&&p.length===1){
    const active=one(db,'SELECT * FROM quick_report_links WHERE is_active=1');
    return {positions:securityPositions(db,user),link:active&&manageable(db,user,active)?{id:active.id,label:active.label,position_ids:positionIds(active),created_at:active.created_at,row_version:active.row_version}:null,can_manage_active:!active||manageable(db,user,active)};
  }
  if(method==='POST'&&p.length===1)return tx(db,()=>{
    const active=one(db,'SELECT * FROM quick_report_links WHERE is_active=1');assert(!active||manageable(db,user,active),'Tautan aktif berada di luar cakupan pengelolaan Anda.',403);
    assert((active?.id||null)===(b.active_link_id||null),'Tautan sudah berubah. Buka kembali pengaturan tautan.',409);
    if(active)assert(active.row_version===b.row_version,'Tautan sudah berubah. Buka kembali pengaturan tautan.',409);
    const ids=b.position_ids,allowed=securityPositions(db,user);
    assert(Array.isArray(ids)&&ids.length>0&&ids.every(id=>typeof id==='string'&&allowed.some(p=>p.id===id))&&new Set(ids).size===ids.length,'Pilih posisi pegawai Keamanan yang termasuk cakupan Anda.');
    assert(eligibleEmployees(db,ids).length>0,'Belum ada pegawai Keamanan aktif untuk posisi yang dipilih.');
    if(active){update(db,'quick_report_links',active.id,active.row_version,{is_active:0,revoked_at:now()});audit(db,user,'REVOKE','quick_report_links',active.id);}
    const token=randomBytes(32).toString('hex'),row=insert(db,'quick_report_links',{token_hash:digest(token),label:text(b.label||'Laporan Keamanan','Nama tautan',120),position_ids:JSON.stringify(ids),is_active:1,created_by:user.id});
    audit(db,user,'CREATE','quick_report_links',row.id,{position_ids:ids});
    return {id:row.id,label:row.label,token,row_version:row.row_version};
  });
  if(method==='POST'&&p.length===3&&p[2]==='revoke')return tx(db,()=>{
    const link=get(db,'quick_report_links',p[1]);assert(manageable(db,user,link),'Akses pengelolaan tautan ditolak.',403);
    assert(link.is_active,'Tautan sudah dinonaktifkan.',409);update(db,'quick_report_links',link.id,b.row_version,{is_active:0,revoked_at:now()});audit(db,user,'REVOKE','quick_report_links',link.id);return {revoked:true};
  });
  assert(false,'Alamat tidak ditemukan.',404);
}

// This runs in a separate committed transaction so invalid attempts still count.
export function takeQuickReportSlot(db,clientIp,action){
  assert(typeof clientIp==='string'&&clientIp.length<=45&&/^[a-f0-9:.]+$/i.test(clientIp),'Permintaan tidak valid.',400);
  assert(['context','submit'].includes(action),'Alamat tidak ditemukan.',404);
  const stamp=now(),cutoff=new Date(Date.now()-10*60000).toISOString(),key=digest(`quick-report\0${action}\0${clientIp}`);
  run(db,'DELETE FROM quick_report_rate_limits WHERE window_start<?',new Date(Date.now()-24*3600000).toISOString());
  const slot=one(db,'SELECT * FROM quick_report_rate_limits WHERE id=?',key);
  if(!slot)insert(db,'quick_report_rate_limits',{id:key,window_start:stamp,hits:1});
  else if(slot.window_start<cutoff)update(db,'quick_report_rate_limits',key,slot.row_version,{window_start:stamp,hits:1});
  else update(db,'quick_report_rate_limits',key,slot.row_version,{hits:slot.hits+1});
  return !slot||slot.window_start<cutoff||slot.hits<(action==='context'?120:30);
}
const receipt=row=>({reference:`LB-${row.id.slice(0,8).toUpperCase()}`,received_at:row.created_at});
export function publicQuickReport(db,action,b,dataDir,requestId){
  const link=validLink(db,b.token),people=eligibleEmployees(db,positionIds(link));
  if(action==='context')return {label:link.label,employees:people.map(e=>({id:e.id,full_name:e.full_name,position_name:e.position_name}))};
  assert(action==='submit','Alamat tidak ditemukan.',404);
  assert(!b.website,'Permintaan tidak valid.');
  const employee=people.find(e=>e.id===b.employee_id);assert(employee,'Pilih pegawai Keamanan aktif dari daftar.');
  assert(typeof b.idempotency_key==='string'&&/^[a-f0-9-]{36}$/i.test(b.idempotency_key),'Kunci laporan tidak valid.');
  const notes=text(b.activity_notes,'Uraian kegiatan',10000),type=enumValue(b.activity_type,['JAGA','PATROLI','LAINNYA']);
  assert(Array.isArray(b.photos)&&b.photos.length>=1&&b.photos.length<=5,'Ambil minimal satu dan maksimal lima foto.');
  let bytes=0;
  const photos=b.photos.map(photo=>{
    assert(photo&&photo.source==='CAMERA'&&['image/jpeg','image/png'].includes(photo.mime_type)&&typeof photo.data==='string'&&photo.data.length<=2100000&&/^[A-Za-z0-9+/]+={0,2}$/.test(photo.data),'Foto tidak valid atau terlalu besar. Ambil foto kembali.');
    const decoded=Buffer.from(photo.data,'base64');
    assert(decoded.length>0&&decoded.toString('base64')===photo.data,'Isi foto tidak valid.');
    assert(photo.mime_type==='image/png'?decoded.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):decoded[0]===255&&decoded[1]===216&&decoded[2]===255,'Isi foto tidak cocok dengan jenisnya.');
    bytes+=photo.data.length;return {mime_type:photo.mime_type,data:photo.data,captured_at:photo.captured_at,source:'CAMERA'};
  });
  assert(bytes<=8400000,'Jumlah ukuran foto terlalu besar. Kurangi foto.');
  assert(new Set(photos.map(p=>digest(p.data))).size===photos.length,'Foto yang sama tidak dapat digunakan berulang.');
  const fingerprint=digest(JSON.stringify({link:link.id,employee:employee.id,type,notes,location:b.location,photos}));
  const previous=one(db,'SELECT * FROM logbook_entries WHERE idempotency_key=?',b.idempotency_key);
  if(previous){assert(previous.report_source==='PUBLIC_LINK'&&previous.report_link_id===link.id&&previous.request_fingerprint===fingerprint,'Kunci laporan sudah digunakan. Periksa hasil pengiriman sebelumnya.',409);return receipt(previous);}
  // Validate evidence before any external upload. Temporary file IDs are replaced
  // only after every photo, capture time and coordinate has passed validation.
  const input={occurred_at:now(),activity_type:type,activity_notes:notes,location:b.location,idempotency_key:b.idempotency_key,photos:photos.map((p,i)=>({file_id:`pending-${i}`,source:p.source,captured_at:p.captured_at}))};
  const details=fieldReportDetails(input,employee.id,employee.org_unit_id);
  const actor={id:null,request_id:requestId};
  const uploaded=photos.map((photo,i)=>{
    const file=storeUpload(db,actor,{name:`laporan-${i+1}.${photo.mime_type==='image/png'?'png':'jpg'}`,mime_type:photo.mime_type,data:photo.data},dataDir);
    return {file_id:file.id,captured_at:photo.captured_at,capture_source:'CAMERA'};
  });
  const row=insert(db,'logbook_entries',{...details.payload,idempotency_key:b.idempotency_key,request_fingerprint:fingerprint,report_source:'PUBLIC_LINK',report_link_id:link.id,created_by:null});
  attachEvidence(db,actor,'logbook',row.id,uploaded);
  audit(db,actor,'PUBLIC_SUBMISSION','logbook_entries',row.id,{employee_id:employee.id,report_link_id:link.id,identity:'SELF_REPORTED'});
  return receipt(row);
}
