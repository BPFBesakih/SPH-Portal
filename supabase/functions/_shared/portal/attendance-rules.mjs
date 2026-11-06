export const ATTENDANCE_TIMEZONE='Asia/Makassar';
export const iso=value=>new Date(value).toISOString();
export const witaDate=value=>new Date(new Date(value).getTime()+28800000).toISOString().slice(0,10);
export const validDay=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function distanceMeters(lat,lon,targetLat,targetLon){
 const rad=Math.PI/180,dlat=(targetLat-lat)*rad,dlon=(targetLon-lon)*rad;
 const a=Math.sin(dlat/2)**2+Math.cos(lat*rad)*Math.cos(targetLat*rad)*Math.sin(dlon/2)**2;
 return 6371000*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));
}
export function readiness(config){
 const missing=[];
 if(!config.activation_on)missing.push('Tanggal mulai aktivasi');
 if(!['EXACT','WHOLE_MINUTE'].includes(config.boundary_mode))missing.push('Ketentuan detik batas waktu');
 if(!['FLOOR','CEIL'].includes(config.minute_rounding))missing.push('Pembulatan durasi menit');
 if(!(config.gps_max_accuracy_m>0))missing.push('Ambang akurasi GPS');
 if(!(config.gps_max_age_seconds>0))missing.push('Usia maksimum lokasi');
 if(!(config.evidence_retention_days>0)||!config.evidence_policy_confirmed)missing.push('Kebijakan bukti dan retensi');
 if(!config.privacy_notice?.trim())missing.push('Pemberitahuan penggunaan foto dan lokasi');
 return missing;
}
const boundary=(value,config)=>Date.parse(value)+(config.boundary_mode==='WHOLE_MINUTE'?59999:0);
const duration=(ms,config)=>Math[config.minute_rounding==='CEIL'?'ceil':'floor'](Math.max(0,ms)/60000);
export function summarizeAttendance(schedule,events=[],correction=null,absence=null,config={},clock=new Date(),enabled=true){
 const input=events.find(e=>e.kind==='IN'),output=events.find(e=>e.kind==='OUT');
 const actualIn=input?.received_at?iso(input.received_at):null,actualOut=output?.received_at?iso(output.received_at):null;
 const effective=correction?.after_value||{in_at:actualIn,out_at:actualOut};
 const inAt=effective.in_at||null,outAt=effective.out_at||null,closed=Date.parse(clock)>boundary(schedule.checkout_closes_at,config);
 const approved=absence&&['SICK','PERMIT','LEAVE'].includes(absence.kind),pending=absence?.kind==='PENDING';
 let status='NOT_YET';
 if(!enabled)status='NOT_ACTIVE';else if(schedule.status!=='PUBLISHED')status='NEEDS_SCHEDULE';
 else if(inAt)status=schedule.day_kind==='OFF'?'PRESENT_OFF':'PRESENT';
 else if(approved)status=absence.kind;else if(schedule.day_kind==='OFF')status='OFF';else if(closed)status=pending?'ABSENT_PENDING':'ABSENT';
 const late=schedule.day_kind==='WORK'&&inAt&&Date.parse(inAt)>boundary(schedule.late_after,config)?duration(Date.parse(inAt)-Date.parse(schedule.late_after),config):0;
 return {status,in_at:inAt,out_at:outAt,actual_in_at:actualIn,actual_out_at:actualOut,late_minutes:late,
  early_minutes:schedule.day_kind==='WORK'&&outAt?duration(Date.parse(schedule.ends_at)-Date.parse(outAt),config):0,
  completeness:!inAt?'NO_IN':outAt?'COMPLETE':closed?'INCOMPLETE':'NO_OUT',corrected:!!correction,
  conflict:!!inAt&&!!approved,duration_minutes:inAt&&outAt?Math.floor((Date.parse(outAt)-Date.parse(inAt))/60000):null};
}
export function punchProblem(schedule,result,kind,clock,config){
 const t=Date.parse(clock);
 if(schedule.status!=='PUBLISHED')return 'Jadwal belum diterbitkan.';
 if(kind==='IN'){
  if(result.in_at)return 'Absen masuk sudah tercatat.';
  if(t<Date.parse(schedule.checkin_opens_at)||t>=Date.parse(schedule.checkin_closes_at))return 'Di luar waktu absen masuk pada jadwal ini.';
 }else{
  if(!result.in_at)return 'Belum ada absen masuk. Hubungi pengelola untuk koreksi.';
  if(result.out_at)return 'Absen keluar sudah tercatat.';
  if(t<Date.parse(result.in_at)||t>boundary(schedule.checkout_closes_at,config))return 'Di luar waktu absen keluar pada jadwal ini.';
 }
 return '';
}
