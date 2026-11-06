import {Buffer} from 'node:buffer';
import {createHash,webcrypto} from 'node:crypto';

// Aturan Absensi yang tidak menyentuh basis data: jarak ke titik, tanda, tanda tangan
// HP, dan status harian. Dipakai server lokal, Edge attendance-form, dan rute portal.
export const attendanceRules=Object.freeze({
 sessionHours:16,          // masuk tanpa pulang lewat 16 jam = "tanpa absen pulang"
 radiusDefault:100,radiusMin:20,radiusMax:1000,
 accuracyLimit:100,        // akurasi GPS > 100 m ditandai
 crowdedPeople:4,crowdedMinutes:10, // HP pribadi dipakai ≥ 4 orang dalam 10 menit
 jumpKmh:120,jumpMinMeters:1000,jumpWindowHours:12,
 photoMaxBytes:300*1024,photoMaxAgeMinutes:5,locationMaxAgeMinutes:2,
 photoRetentionDays:90,referenceRetentionDays:90,
 correctionDays:7,          // atasan langsung boleh mengoreksi ≤ 7 hari setelah tanggal kerja
 signatureSkewMinutes:10,registrationDays:7,sessionMinutesMax:30,
 recapMaxDays:62,reviewDays:31,
});
export const attendanceFlags=Object.freeze({
 DI_LUAR_TITIK:'Di luar titik',GPS_KURANG_AKURAT:'GPS kurang akurat',LOKASI_MELOMPAT:'Lokasi melompat',
 HP_PRIBADI_RAMAI:'Banyak pegawai di satu HP pribadi',TANPA_FOTO_ACUAN:'Belum ada foto acuan',
 TANPA_MASUK:'Tanpa absen masuk',TANPA_PULANG:'Tanpa absen pulang',SAAT_CUTI:'Absen saat cuti',TITIK_BELUM_ADA:'Titik absen belum diatur',
});
export const outsideReasons=Object.freeze({DINAS_LUAR:'Dinas luar',TUGAS_LAPANGAN:'Tugas lapangan',LAINNYA:'Lainnya'});
export const dayNoteKinds=Object.freeze({IZIN:'Izin',SAKIT:'Sakit',DINAS_LUAR:'Dinas luar'});
export const dayStatuses=Object.freeze({
 HADIR:'Hadir',BELUM_PULANG:'Masuk, belum pulang',TANPA_PULANG:'Hadir, tanpa absen pulang',TANPA_MASUK:'Pulang tanpa absen masuk',
 CUTI:'Cuti',IZIN:'Izin',SAKIT:'Sakit',DINAS_LUAR:'Dinas luar',TIDAK_ADA_CATATAN:'Tidak ada catatan',
});
export const presentStatuses=Object.freeze(['HADIR','BELUM_PULANG','TANPA_PULANG','TANPA_MASUK']);
const DAY=86400000;
export const witaDate=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);
export const shiftDay=(day,days)=>new Date(Date.parse(day+'T00:00:00Z')+days*DAY).toISOString().slice(0,10);
export function daysBetween(from,to){const out=[];for(let d=from;d<=to;d=shiftDay(d,1))out.push(d);return out;}
export const parseFlags=value=>{
 if(Array.isArray(value))return value.filter(f=>typeof f==='string'&&Object.hasOwn(attendanceFlags,f));
 try{const parsed=JSON.parse(value||'[]');return Array.isArray(parsed)?parsed.filter(f=>typeof f==='string'&&Object.hasOwn(attendanceFlags,f)):[];}catch{return [];}
};

// Jarak permukaan bumi (haversine), dalam meter.
export function distanceMeters(lat1,lon1,lat2,lon2){
 const r=6371008.8,rad=d=>d*Math.PI/180,dLat=rad(lat2-lat1),dLon=rad(lon2-lon1);
 const a=Math.sin(dLat/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;
 return 2*r*Math.asin(Math.min(1,Math.sqrt(a)));
}
// Titik yang memuat lokasi (jarak ≤ radius) dengan jarak terdekat; bila tidak ada, titik terdekat.
export function matchPoint(points,latitude,longitude){
 let inside=null,nearest=null;
 for(const p of points){
  const distance=distanceMeters(latitude,longitude,Number(p.latitude),Number(p.longitude));
  if(distance<=Number(p.radius_m)&&(!inside||distance<inside.distance))inside={point:p,distance};
  if(!nearest||distance<nearest.distance)nearest={point:p,distance};
 }
 const best=inside||nearest;
 return best?{point:best.point,distance:Math.round(best.distance),within:Boolean(inside)}:null;
}
// Dua absen berurutan yang jaraknya mustahil ditempuh dalam selisih waktunya.
export function jumped(previous,current){
 if(!previous)return false;
 const hours=(Date.parse(current.recorded_at)-Date.parse(previous.recorded_at))/3600000;
 if(!(hours>=0)||hours>attendanceRules.jumpWindowHours)return false;
 const meters=distanceMeters(Number(previous.latitude),Number(previous.longitude),Number(current.latitude),Number(current.longitude));
 if(meters<=Math.max(attendanceRules.jumpMinMeters,Number(previous.accuracy_m)+Number(current.accuracy_m)))return false;
 return meters/1000/Math.max(hours,1/3600)>attendanceRules.jumpKmh;
}

// Tanda tangan HP: ECDSA P-256 + SHA-256 dengan kunci privat yang tidak bisa diekspor.
// Isi yang ditandatangani memuat tindakan, ID HP, jam (sudah disesuaikan ke jam server),
// dan teks payload persis seperti dikirim, sehingga tidak perlu kanonisasi JSON.
export const signatureMessage=(action,deviceId,ts,payload)=>`sph-absen-v1\n${action}\n${deviceId}\n${ts}\n${payload}`;
const b64url=/^[A-Za-z0-9_-]+$/;
export function cleanPublicKey(jwk){
 const valid=jwk&&typeof jwk==='object'&&!Array.isArray(jwk)&&jwk.kty==='EC'&&jwk.crv==='P-256'&&typeof jwk.x==='string'&&typeof jwk.y==='string'&&jwk.x.length===43&&jwk.y.length===43&&b64url.test(jwk.x)&&b64url.test(jwk.y)&&!('d' in jwk);
 if(!valid)return null;
 return {crv:'P-256',kty:'EC',x:jwk.x,y:jwk.y};
}
// Thumbprint RFC 7638 (urutan anggota leksikografis).
export const keyThumbprint=key=>createHash('sha256').update(JSON.stringify({crv:key.crv,kty:key.kty,x:key.x,y:key.y})).digest('hex');
const subtle=()=>globalThis.crypto?.subtle||webcrypto.subtle;
export async function importPublicKey(key){
 try{return await subtle().importKey('jwk',{...key,ext:true},{name:'ECDSA',namedCurve:'P-256'},false,['verify']);}catch{return null;}
}
export async function verifySignature(publicKeyText,message,signature){
 let key;try{key=JSON.parse(publicKeyText);}catch{return false;}
 const clean=cleanPublicKey(key);if(!clean||typeof signature!=='string'||!b64url.test(signature))return false;
 const imported=await importPublicKey(clean);if(!imported)return false;
 const bytes=Buffer.from(signature,'base64url');if(bytes.length!==64)return false;
 try{return await subtle().verify({name:'ECDSA',hash:'SHA-256'},imported,bytes,new TextEncoder().encode(message));}catch{return false;}
}

// Status satu hari kerja dari catatan mentah + koreksi + keterangan + cuti. Tidak disimpan,
// supaya jadwal atau koreksi yang datang belakangan langsung berlaku.
export function dayStatus({events=[],corrections=[],note=null,leave=null,nowMs=Date.now()}){
 const voided=new Set(corrections.filter(c=>c.void_event_id).map(c=>c.void_event_id));
 const live=events.filter(e=>!voided.has(e.id)).sort((a,b)=>String(a.recorded_at).localeCompare(String(b.recorded_at)));
 const ins=live.filter(e=>e.kind==='IN'),outs=live.filter(e=>e.kind==='OUT');
 let correctedIn=null,correctedOut=null;
 for(const c of [...corrections].sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)))){if(c.in_at)correctedIn=c.in_at;if(c.out_at)correctedOut=c.out_at;}
 const inAt=correctedIn||ins[0]?.recorded_at||null;
 let outAt=correctedOut||outs.at(-1)?.recorded_at||null;
 if(inAt&&outAt&&outAt<=inAt)outAt=null;
 const flags=new Set();for(const e of live)for(const f of parseFlags(e.flags))flags.add(f);
 let status;
 if(inAt&&outAt)status='HADIR';
 else if(inAt)status=nowMs-Date.parse(inAt)<=attendanceRules.sessionHours*3600000?'BELUM_PULANG':'TANPA_PULANG';
 else if(outAt)status='TANPA_MASUK';
 else if(leave)status='CUTI';
 else if(note)status=note.kind;
 else status='TIDAK_ADA_CATATAN';
 if(inAt)flags.delete('TANPA_MASUK');else if(outAt)flags.add('TANPA_MASUK');
 if(status==='TANPA_PULANG')flags.add('TANPA_PULANG');
 if(leave&&(inAt||outAt))flags.add('SAAT_CUTI');
 return {status,in_at:inAt,out_at:outAt,minutes:inAt&&outAt?Math.round((Date.parse(outAt)-Date.parse(inAt))/60000):null,
  flags:[...flags],corrected:Boolean(correctedIn||correctedOut||voided.size),event_ids:live.map(e=>e.id),
  note:note?{id:note.id,kind:note.kind,note:note.note||''}:null,leave_type:leave?.leave_type||null};
}

// Rekap per pegawai untuk rentang tanggal. Hari tanpa data tidak dikirim (klien mengisi
// "Tidak ada catatan"), supaya ringkasan sebulan tetap kecil.
export function buildRecap({employees,events=[],corrections=[],notes=[],leaveDays=[],from,to,nowMs=Date.now()}){
 const key=(employeeId,day)=>`${employeeId}\0${day}`;
 const group=(rows,field='work_date')=>{const map=new Map();for(const r of rows){const k=key(r.employee_id,r[field]);if(!map.has(k))map.set(k,[]);map.get(k).push(r);}return map;};
 const byEvents=group(events),byCorrections=group(corrections),byLeave=group(leaveDays);
 const byNotes=new Map(notes.map(n=>[key(n.employee_id,n.work_date),n]));
 const dates=daysBetween(from,to);
 return employees.map(e=>{
  const days=[];const summary={hadir:0,tanpa_pulang:0,tanpa_masuk:0,belum_pulang:0,cuti:0,izin:0,sakit:0,dinas_luar:0,tanpa_catatan:0,ditandai:0,menit:0};
  for(const day of dates){
   const k=key(e.id,day);
   const result=dayStatus({events:byEvents.get(k)||[],corrections:byCorrections.get(k)||[],note:byNotes.get(k)||null,leave:byLeave.get(k)?.[0]||null,nowMs});
   if(presentStatuses.includes(result.status))summary.hadir++;
   if(result.status==='TANPA_PULANG')summary.tanpa_pulang++;
   if(result.status==='TANPA_MASUK')summary.tanpa_masuk++;
   if(result.status==='BELUM_PULANG')summary.belum_pulang++;
   if(result.status==='CUTI')summary.cuti++;
   if(result.status==='IZIN')summary.izin++;
   if(result.status==='SAKIT')summary.sakit++;
   if(result.status==='DINAS_LUAR')summary.dinas_luar++;
   if(result.status==='TIDAK_ADA_CATATAN')summary.tanpa_catatan++;
   if(result.flags.length)summary.ditandai++;
   if(result.minutes)summary.menit+=result.minutes;
   if(result.status!=='TIDAK_ADA_CATATAN'||result.flags.length)days.push({date:day,...result});
  }
  return {employee_id:e.id,days,summary};
 });
}
