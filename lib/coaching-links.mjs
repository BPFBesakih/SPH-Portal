import {Buffer} from 'node:buffer';
import {all,one,insert,run,update,assert,text,now,today,audit} from './db.mjs';
import {digest} from './auth.mjs';
import {storeUpload} from './files.mjs';

const invalidLink='Tautan coaching tidak aktif. Minta tautan terbaru kepada pengelola.';
const topics=['Disiplin','Kinerja','Pelayanan','Sikap Kerja','Lainnya'];
function linkFor(db,token){
  assert(typeof token==='string'&&/^[a-f0-9]{64}$/.test(token),invalidLink,404);
  const link=one(db,'SELECT * FROM coaching_links WHERE token_hash=? AND is_active=1',digest(token));
  assert(link,invalidLink,404);return link;
}
function peopleFor(db){
  const stamp=today(),rows=all(db,`SELECT e.id,e.full_name,p.name position_name,u.name unit_name FROM employees e
    LEFT JOIN employee_placements ep ON ep.employee_id=e.id AND ep.is_primary=1 AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?)
    LEFT JOIN positions p ON p.id=ep.position_id LEFT JOIN org_units u ON u.id=p.org_unit_id
    WHERE e.is_active=1 ORDER BY e.full_name,e.id`,stamp,stamp);
  const groups=new Map(),ids=new Map();
  for(const row of rows){const context=[row.unit_name,row.position_name].filter(Boolean).join(' · '),key=JSON.stringify([row.full_name.trim().toLocaleLowerCase('id'),context]);const group=groups.get(key)||[];group.push({...row,position_name:context});groups.set(key,group);ids.set(row.id,(ids.get(row.id)||0)+1);}
  return [...groups.values()].map(group=>group.length===1&&ids.get(group[0].id)===1?{id:group[0].id,full_name:group[0].full_name,position_name:group[0].position_name}:{id:'',full_name:group[0].full_name,position_name:`${group[0].position_name||'Penempatan belum tersedia'} · Data ganda — hubungi SDM`,disabled:true});
}
const day=(value,label)=>{assert(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,`${label} tidak valid.`);return value;};
const receipt=row=>({reference:`CH-${row.coaching_session_id.slice(0,8).toUpperCase()}`,received_at:row.submitted_at});

// Commit rate limits separately, including requests containing an invalid link.
export function takeCoachingLinkSlot(db,clientIp,action){
  assert(typeof clientIp==='string'&&clientIp.length<=45&&/^[a-f0-9:.]+$/i.test(clientIp),'Permintaan tidak valid.',400);
  assert(['context','submit'].includes(action),'Alamat tidak ditemukan.',404);
  const stamp=now(),cutoff=new Date(Date.now()-10*60000).toISOString(),key=digest(`coaching-link\0${action}\0${clientIp}`);
  run(db,'DELETE FROM quick_report_rate_limits WHERE window_start<?',new Date(Date.now()-24*3600000).toISOString());
  const slot=one(db,'SELECT * FROM quick_report_rate_limits WHERE id=?',key);
  if(!slot)insert(db,'quick_report_rate_limits',{id:key,window_start:stamp,hits:1});
  else if(slot.window_start<cutoff)update(db,'quick_report_rate_limits',key,slot.row_version,{window_start:stamp,hits:1});
  else update(db,'quick_report_rate_limits',key,slot.row_version,{hits:slot.hits+1});
  return !slot||slot.window_start<cutoff||slot.hits<(action==='context'?120:30);
}

// Called in one transaction after validating the server key, origin and rate limit.
// The link permits submitting a new coaching record, never reading existing records.
export function publicCoachingLink(db,action,b,dataDir,requestId){
  const link=linkFor(db,b.token),people=peopleFor(db);
  if(action==='context')return {label:link.label,today:today(),employees:people};
  assert(action==='submit','Alamat tidak ditemukan.',404);assert(!b.website,'Permintaan tidak valid.');
  const employee=people.find(e=>e.id===b.employee_id&&!e.disabled),coach=people.find(e=>e.id===b.coach_employee_id&&!e.disabled);
  assert(employee&&coach,'Pilih nama karyawan dan coach dari hasil pencarian. Data ganda perlu diperiksa SDM.');
  assert(employee.id!==coach.id,'Coach harus berbeda dari karyawan.');
  assert(typeof b.idempotency_key==='string'&&/^[a-f0-9-]{36}$/i.test(b.idempotency_key),'Kunci coaching tidak valid.');
  const held=day(b.held_on,'Tanggal coaching'),due=day(b.due_on,'Target penyelesaian');assert(due>=held,'Target penyelesaian harus pada atau setelah tanggal coaching.');
  assert(topics.includes(b.topic),'Pilih topik coaching.');
  const payload={employee_id:employee.id,coach_employee_id:coach.id,held_on:held,due_on:due,topic:b.topic,
    department:text(b.department,'Bidang',200),section:text(b.section,'Urusan',200),constraints_notes:text(b.constraints_notes,'Permasalahan',10000),guidance_notes:text(b.guidance_notes,'Arahan',10000),agreement_notes:text(b.agreement_notes,'Komitmen',3000)};
  const photo=b.photo;
  assert(photo&&['image/jpeg','image/png'].includes(photo.mime_type)&&typeof photo.data==='string'&&photo.data.length<=13981016&&/^[A-Za-z0-9+/]+={0,2}$/.test(photo.data),'Sertakan satu foto JPG/PNG maksimal 10 MB.');
  const bytes=Buffer.from(photo.data,'base64');assert(bytes.length>0&&bytes.length<=10485760&&bytes.toString('base64')===photo.data,'Isi foto tidak valid atau terlalu besar.');
  assert(photo.mime_type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes[0]===255&&bytes[1]===216&&bytes[2]===255,'Isi foto tidak cocok dengan jenisnya.');
  const fingerprint=digest(JSON.stringify({...payload,photo_hash:digest(photo.data)})),source=`NATIVE_LINK:${link.id}`;
  const previous=one(db,'SELECT coaching_session_id,payload_hash,submitted_at FROM coaching_form_submissions WHERE form_id=? AND response_id=?',source,b.idempotency_key);
  if(previous){assert(previous.payload_hash===fingerprint,'Kunci coaching sudah digunakan untuk jawaban berbeda. Periksa hasil pengiriman sebelumnya.',409);return receipt(previous);}
  const placements=all(db,'SELECT p.org_unit_id FROM employee_placements ep JOIN positions p ON p.id=ep.position_id WHERE ep.employee_id=? AND ep.is_primary=1 AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?)',employee.id,held,held);
  assert(placements.length===1,'Penempatan utama karyawan pada tanggal coaching perlu diperiksa SDM.');
  const stamp=now(),actor={id:null,request_id:requestId};
  const file=storeUpload(db,actor,{name:`Coaching_${held}.${photo.mime_type==='image/png'?'png':'jpg'}`,mime_type:photo.mime_type,data:photo.data},dataDir);
  // Only this fresh server-created upload can be linked; no existing file ID is accepted.
  const stored=one(db,'SELECT storage_key FROM files WHERE id=? AND uploaded_by IS NULL',file.id);
  assert(stored,'Foto coaching belum dapat dikonfirmasi.',503);db.storage?.claim?.(stored.storage_key);
  const session=insert(db,'coaching_sessions',{employee_id:employee.id,coach_employee_id:coach.id,org_unit_id:placements[0].org_unit_id,
    held_at:new Date(`${held}T00:00:00+08:00`).toISOString(),topic:payload.topic,constraints_notes:payload.constraints_notes,guidance_notes:payload.guidance_notes,agreement_notes:payload.agreement_notes,created_by:null});
  insert(db,'coaching_actions',{coaching_session_id:session.id,responsible_employee_id:employee.id,action_text:payload.agreement_notes,status:'OPEN',due_on:due,created_by:null});
  insert(db,'coaching_files',{coaching_session_id:session.id,file_id:file.id,caption:'Foto coaching',created_by:null});
  const submission=insert(db,'coaching_form_submissions',{form_id:source,response_id:b.idempotency_key,payload_hash:fingerprint,coaching_session_id:session.id,submitted_at:stamp,department:payload.department,section:payload.section});
  audit(db,actor,'PUBLIC_COACHING_SUBMISSION','coaching_sessions',session.id,{source:'NATIVE_LINK',link_id:link.id,employee_id:employee.id,coach_employee_id:coach.id,identity:'SELF_REPORTED'});
  return receipt(submission);
}
