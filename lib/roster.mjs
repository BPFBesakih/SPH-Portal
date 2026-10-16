import { all,one,run,get,insert,update,tx,audit,now,today,assert,text,date,integer } from './db.mjs';
import { can,has,requireAccess,postContext,digest } from './auth.mjs';
export const GENERATOR_VERSION='besakih-rotation/1.0';
const DAY=86400000,MIN=60000;
export const addDays=(day,n)=>new Date(Date.parse(day)+n*DAY).toISOString().slice(0,10);
export const localDate=value=>new Date(Date.parse(value)+8*3600000).toISOString().slice(0,10);
export function days(from,to){const result=[];for(let d=from;d<=to;d=addDays(d,1))result.push(d);return result;}
export function shiftInterval(day,shift) {return {starts_at:new Date(`${day}T${shift.start_time}:00+08:00`).toISOString(),ends_at:new Date(`${addDays(day,shift.end_day_offset)}T${shift.end_time}:00+08:00`).toISOString()};}
export function cycleDay(binding,day,length){return ((Math.round((Date.parse(day)-Date.parse(binding.anchor_date))/DAY)+binding.phase_offset_days)%length+length)%length+1;}
const overlaps=(a,b)=>a.starts_at<b.ends_at&&b.starts_at<a.ends_at;
function covers(row,a){const start=localDate(a.starts_at),end=localDate(new Date(Date.parse(a.ends_at)-1).toISOString());return row.valid_from<=start&&(!row.valid_to||row.valid_to>=end);}
function dailySlices(a) {
  const out=[];let cursor=Date.parse(a.starts_at),end=Date.parse(a.ends_at);
  while(cursor<end){const day=localDate(new Date(cursor).toISOString()),next=Date.parse(`${addDays(day,1)}T00:00:00+08:00`),stop=Math.min(next,end);out.push([day,(stop-cursor)/MIN]);cursor=stop;}return out;
}
export function workErrors(local,external,rules) {
  if(!local.length)return [];
  const localIds=new Set(local.map((a,i)=>a.id||`local-${i}`));
  const items=[...external.map(a=>({...a,isLocal:false})),...local.map(a=>({...a,isLocal:true}))].sort((a,b)=>a.starts_at.localeCompare(b.starts_at));
  const errors=[];
  for(let i=1;i<items.length;i++) {
    const before=items[i-1],after=items[i];if(!before.isLocal&&!after.isLocal)continue;
    if(overlaps(before,after))errors.push('Penugasan bertabrakan.');
    else if((Date.parse(after.starts_at)-Date.parse(before.ends_at))/MIN<rules.min_rest_minutes)errors.push('Jeda istirahat minimum belum terpenuhi.');
  }
  const byDay=new Map(),localDays=new Set();
  for(const a of items)for(const [day,minutes] of dailySlices(a)){byDay.set(day,(byDay.get(day)||0)+minutes);if(a.isLocal)localDays.add(day);}
  for(const day of localDays)if(byDay.get(day)>rules.max_work_minutes_per_local_day)errors.push(`Batas menit kerja harian terlampaui (${day}).`);
  const windowEnds=new Set([...localDays].flatMap(d=>Array.from({length:7},(_,i)=>addDays(d,i))));
  for(const end of windowEnds){let minutes=0;for(let i=0;i<7;i++)minutes+=byDay.get(addDays(end,-i))||0;if(minutes>rules.max_work_minutes_rolling_7_days){errors.push('Batas menit kerja dalam tujuh hari terlampaui.');break;}}
  let chain=[],prev=null;
  const check=()=>{if(chain.length>rules.max_consecutive_work_days&&chain.some(d=>localDays.has(d)))errors.push('Batas hari kerja berturut-turut terlampaui.');};
  for(const day of [...byDay.keys()].sort()){if(prev&&day!==addDays(prev,1)){check();chain=[];}chain.push(day);prev=day;}check();
  return [...new Set(errors)];
}
export function routineStep(snapshot,employeeId,day) {
  const binding=snapshot.bindings.filter(b=>b.employee_id===employeeId&&b.effective_from<=day).sort((a,b)=>b.effective_from.localeCompare(a.effective_from))[0];
  if(!binding)return null;
  const pattern=snapshot.patterns.find(p=>p.id===binding.pattern_version_id);if(!pattern)return null;
  const step=pattern.steps.find(s=>s.cycle_day_no===cycleDay(binding,day,pattern.cycle_length_days));return {binding,pattern,step};
}
export function assignmentErrors(snapshot,a) {
  const errors=[],employee=snapshot.employees.find(e=>e.id===a.employee_id),post=snapshot.posts.find(p=>p.id===a.post_id),shift=snapshot.shifts.find(s=>s.id===a.shift_id);
  if(!employee||!employee.is_active||employee.joined_on>a.service_date||(employee.ended_on&&employee.ended_on<localDate(new Date(Date.parse(a.ends_at)-1).toISOString())))errors.push('Pegawai tidak aktif atau di luar masa kerja.');
  if(!post?.is_active||!snapshot.post_ids.includes(a.post_id))errors.push('Pos di luar cakupan atau tidak aktif.');
  if(!shift?.is_active||shift.org_unit_id!==post?.org_unit_id)errors.push('Shift tidak sah untuk pos.');
  if(shift){const expected=shiftInterval(a.service_date,shift);if(expected.starts_at!==a.starts_at||expected.ends_at!==a.ends_at)errors.push('Interval tidak cocok dengan snapshot shift.');}
  if(a.service_date<snapshot.period.starts_on||a.service_date>snapshot.period.ends_on)errors.push('Tanggal di luar periode.');
  if(!snapshot.members.some(m=>m.employee_id===a.employee_id&&covers(m,a)))errors.push('Keanggotaan kelompok tidak berlaku sepanjang tugas.');
  if(!snapshot.eligibility.some(e=>e.employee_id===a.employee_id&&e.post_id===a.post_id&&covers(e,a)))errors.push('Kelayakan pos tidak berlaku sepanjang tugas.');
  if(snapshot.unavailability.some(u=>u.employee_id===a.employee_id&&overlaps(u,a)))errors.push('Petugas tidak tersedia.');
  if(a.origin==='ROUTINE'){const routine=routineStep(snapshot,a.employee_id,a.service_date);if(!routine?.step||routine.step.step_kind!=='WORK'||routine.step.shift_id!==a.shift_id||(routine.step.post_id&&routine.step.post_id!==a.post_id))errors.push('Penugasan tidak sesuai langkah rotasi rutin.');}
  if(a.origin==='TEMPORARY'&&!snapshot.overrides.some(o=>o.id===a.source_override_id&&o.post_id===a.post_id&&o.shift_id===a.shift_id&&o.starts_on<=a.service_date&&o.ends_on>=a.service_date))errors.push('Sumber penyesuaian tidak sesuai.');
  if(a.origin==='MANUAL'&&!a.manual_change_reason?.trim())errors.push('Alasan perubahan manual wajib.');
  return errors;
}
export function validateAssignments(snapshot,assignments) {
  const errors=[];
  for(const a of assignments)for(const message of assignmentErrors(snapshot,a))errors.push({assignment_id:a.id,employee_id:a.employee_id,service_date:a.service_date,message});
  for(const employeeId of new Set(assignments.map(a=>a.employee_id))){const local=assignments.filter(a=>a.employee_id===employeeId),external=snapshot.external.filter(a=>a.employee_id===employeeId);for(const message of workErrors(local,external,snapshot.rules))errors.push({employee_id:employeeId,message});}
  return errors;
}
export function generateAssignments(snapshot,retained=[],seed='0',range) {
  const assignments=retained.map(a=>({...a}));const rejected=[];
  const order=snapshot.employees.map(e=>e.id).sort((a,b)=>digest(seed+a).localeCompare(digest(seed+b)));
  for(const slot of snapshot.slots) {
    if(range&&(slot.service_date<range.starts_on||slot.service_date>range.ends_on))continue;
    const current=()=>assignments.filter(a=>a.post_id===slot.post_id&&a.shift_id===slot.shift_id&&a.service_date===slot.service_date).length;
    const candidates=order.map((id,index)=>({id,index,count:assignments.filter(a=>a.employee_id===id).length})).sort((a,b)=>a.count-b.count||a.index-b.index);
    for(const candidate of candidates) {
      if(current()>=slot.required_count)break;
      const routine=routineStep(snapshot,candidate.id,slot.service_date);
      const isRoutine=routine?.step?.step_kind==='WORK'&&routine.step.shift_id===slot.shift_id&&(!routine.step.post_id||routine.step.post_id===slot.post_id);
      if(!isRoutine&&!slot.source_override_id)continue;
      const shift=snapshot.shifts.find(s=>s.id===slot.shift_id);if(!shift)continue;
      const a={employee_id:candidate.id,post_id:slot.post_id,shift_id:slot.shift_id,service_date:slot.service_date,...shiftInterval(slot.service_date,shift),origin:isRoutine?'ROUTINE':'TEMPORARY',source_override_id:isRoutine?null:slot.source_override_id,is_locked:0};
      const errors=[...assignmentErrors(snapshot,a),...workErrors([...assignments.filter(x=>x.employee_id===candidate.id),a],snapshot.external.filter(x=>x.employee_id===candidate.id),snapshot.rules)];
      if(!errors.length)assignments.push(a);else if(rejected.length<300)rejected.push({service_date:slot.service_date,post_id:slot.post_id,shift_id:slot.shift_id,employee_id:candidate.id,reasons:[...new Set(errors)]});
    }
  }
  const gaps=snapshot.slots.map(s=>({...s,assigned_count:assignments.filter(a=>a.post_id===s.post_id&&a.shift_id===s.shift_id&&a.service_date===s.service_date).length})).filter(s=>s.assigned_count<s.required_count);
  return {assignments,gaps,rejected,errors:validateAssignments(snapshot,assignments)};
}
function periodPosts(db,periodId){return all(db,'SELECT post_id FROM scheduling_period_posts WHERE scheduling_period_id=? ORDER BY post_id',periodId).map(r=>r.post_id);}
function requirePeriod(db,user,permission,periodId){const posts=periodPosts(db,periodId);assert(posts.length,'Periode tidak memiliki pos.');for(const id of posts)requireAccess(db,user,permission,postContext(db,id));return posts;}
export function buildSnapshot(db,periodId,rulesId) {
  const period=get(db,'scheduling_periods',periodId),postIds=periodPosts(db,periodId),rules=get(db,'scheduling_rule_versions',rulesId);
  assert(rules.org_unit_id===period.org_unit_id&&rules.is_active,'Aturan harus aktif dan sesuai unit periode.');
  const posts=postIds.map(id=>get(db,'security_posts',id));assert(posts.every(p=>p.org_unit_id===period.org_unit_id&&p.is_active),'Pos periode harus aktif dan sesuai unit.');
  const shifts=all(db,'SELECT * FROM shift_definitions WHERE org_unit_id=? AND is_active=1 ORDER BY id',period.org_unit_id);assert(shifts.length,'Konfigurasi shift belum tersedia.');
  const requirements=all(db,'SELECT * FROM staffing_requirements WHERE is_active=1 ORDER BY id').filter(r=>postIds.includes(r.post_id));
  const overrides=all(db,'SELECT * FROM staffing_overrides WHERE is_active=1 ORDER BY id').filter(r=>postIds.includes(r.post_id)&&r.ends_on>=period.starts_on&&r.starts_on<=period.ends_on);
  const slots=[];
  for(const day of days(period.starts_on,period.ends_on))for(const postId of postIds)for(const shift of shifts){
    const weekday=new Date(day).getUTCDay()||7,required=requirements.filter(r=>r.post_id===postId&&r.shift_id===shift.id&&r.weekday_no===weekday&&r.effective_from<=day&&(!r.effective_to||r.effective_to>=day));
    assert(required.length===1,`Kebutuhan rutin belum lengkap atau bertumpang tindih: ${day}, ${get(db,'security_posts',postId).name}, ${shift.name}. Isi juga kebutuhan nol.`);
    const override=overrides.find(o=>o.post_id===postId&&o.shift_id===shift.id&&o.starts_on<=day&&o.ends_on>=day);
    slots.push({service_date:day,post_id:postId,shift_id:shift.id,required_count:override?override.replacement_required_count:required[0].required_count,source_override_id:override?.id||null});
  }
  const groups=all(db,'SELECT * FROM security_groups WHERE is_active=1 ORDER BY id');
  const snapshot={schema_version:1,generator_version:GENERATOR_VERSION,period:{id:period.id,starts_on:period.starts_on,ends_on:period.ends_on,org_unit_id:period.org_unit_id},post_ids:postIds,rules,posts,shifts,slots,overrides,requirements,
    employees:all(db,'SELECT id,employee_no,full_name,is_active,joined_on,ended_on FROM employees ORDER BY id'),
    groups,members:all(db,'SELECT * FROM security_group_members ORDER BY id').filter(m=>groups.some(g=>g.id===m.security_group_id)),
    eligibility:all(db,'SELECT * FROM employee_post_eligibility ORDER BY id').filter(e=>postIds.includes(e.post_id)),
    unavailability:all(db,'SELECT id,employee_id,starts_at,ends_at FROM employee_unavailability ORDER BY id'),
    patterns:all(db,'SELECT * FROM roster_pattern_versions ORDER BY id').map(p=>({...p,steps:all(db,'SELECT * FROM roster_pattern_steps WHERE pattern_version_id=? ORDER BY cycle_day_no',p.id)})),
    bindings:all(db,'SELECT * FROM employee_rotation_bindings ORDER BY id'),
    external:all(db,`SELECT a.id,a.employee_id,a.starts_at,a.ends_at,a.service_date,a.post_id,r.id revision_id FROM roster_assignments a JOIN roster_revisions r ON r.id=a.roster_revision_id WHERE r.status='PUBLISHED' AND r.scheduling_period_id<>? ORDER BY a.id`,periodId)};
  snapshot.source_hash=digest(JSON.stringify(snapshot));return snapshot;
}
function display(snapshot,a){return JSON.stringify({employee_name:snapshot.employees.find(e=>e.id===a.employee_id)?.full_name,employee_no:snapshot.employees.find(e=>e.id===a.employee_id)?.employee_no,post_name:snapshot.posts.find(p=>p.id===a.post_id)?.name,shift_name:snapshot.shifts.find(s=>s.id===a.shift_id)?.name,start_time:snapshot.shifts.find(s=>s.id===a.shift_id)?.start_time,end_time:snapshot.shifts.find(s=>s.id===a.shift_id)?.end_time});}
function saveAssignment(db,user,revision,snapshot,a) {
  const routine=routineStep(snapshot,a.employee_id,a.service_date);let link=null;
  if(a.origin==='ROUTINE'&&routine){
    link=one(db,'SELECT * FROM revision_rotation_bindings WHERE roster_revision_id=? AND rotation_binding_id=?',revision.id,routine.binding.id);
    if(!link){const next=snapshot.bindings.filter(b=>b.employee_id===a.employee_id&&b.effective_from>routine.binding.effective_from).sort((a,b)=>a.effective_from.localeCompare(b.effective_from))[0];link=insert(db,'revision_rotation_bindings',{roster_revision_id:revision.id,rotation_binding_id:routine.binding.id,applies_from:routine.binding.effective_from>snapshot.period.starts_on?routine.binding.effective_from:snapshot.period.starts_on,applies_to:next&&next.effective_from<=snapshot.period.ends_on?addDays(next.effective_from,-1):snapshot.period.ends_on,created_by:user.id});}
  }
  return insert(db,'roster_assignments',{roster_revision_id:revision.id,employee_id:a.employee_id,post_id:a.post_id,shift_id:a.shift_id,service_date:a.service_date,starts_at:a.starts_at,ends_at:a.ends_at,origin:a.origin,is_locked:a.is_locked||0,display_snapshot:a.display_snapshot||display(snapshot,a),revision_rotation_binding_id:link?.id||null,source_override_id:a.source_override_id||null,copied_from_assignment_id:a.copied_from_assignment_id||null,locked_by:a.is_locked?(a.locked_by||user.id):null,locked_at:a.is_locked?(a.locked_at||now()):null,manual_change_reason:a.manual_change_reason||null,created_by:user.id});
}
function reportAndGaps(db,user,revision,snapshot,rejected=[]) {
  const assignments=all(db,'SELECT * FROM roster_assignments WHERE roster_revision_id=?',revision.id),errors=validateAssignments(snapshot,assignments);
  const gaps=snapshot.slots.map(s=>({...s,assigned_count:assignments.filter(a=>a.service_date===s.service_date&&a.post_id===s.post_id&&a.shift_id===s.shift_id).length})).filter(s=>s.required_count>s.assigned_count);
  run(db,'DELETE FROM roster_gaps WHERE roster_revision_id=?',revision.id);
  for(const gap of gaps)insert(db,'roster_gaps',{roster_revision_id:revision.id,post_id:gap.post_id,shift_id:gap.shift_id,service_date:gap.service_date,required_count:gap.required_count,assigned_count:gap.assigned_count,created_by:user.id});
  const report={errors,rejected,gap_count:gaps.reduce((s,g)=>s+g.required_count-g.assigned_count,0),assignment_count:assignments.length,validated_at:now()};
  run(db,'UPDATE roster_revisions SET validation_report=? WHERE id=?',JSON.stringify(report),revision.id);return report;
}
function assertFutureRange(from,to){assert(Date.parse(`${from}T00:00:00+08:00`)>Date.now(),'Generator hanya dapat mengubah tanggal setelah hari ini. Koreksi historis tidak tersedia.');assert(to>=from,'Rentang generasi tidak valid.');}
export async function rosterRoutes(c) {
  const {db,user,p,method:m,body:b}=c,id=p[1],action=p[2];
  if(p[0]==='periods') {
    if(m==='GET'&&!id) {assert(has(db,user,'security.roster.read'),'Akses ditolak.',403);return {items:all(db,'SELECT * FROM scheduling_periods ORDER BY starts_on DESC').filter(period=>periodPosts(db,period.id).some(postId=>can(db,user,'security.roster.read',postContext(db,postId))||has(db,user,'security.roster.read')&&user.employee_id&&one(db,"SELECT a.id FROM roster_assignments a JOIN roster_revisions r ON r.id=a.roster_revision_id WHERE r.scheduling_period_id=? AND r.status='PUBLISHED' AND a.employee_id=?",period.id,user.employee_id))).map(period=>({...period,post_ids:periodPosts(db,period.id).filter(postId=>can(db,user,'security.roster.read',postContext(db,postId))),revisions:all(db,'SELECT id,revision_no,status,row_version,published_at,created_at FROM roster_revisions WHERE scheduling_period_id=? ORDER BY revision_no DESC',period.id).filter(r=>r.status==='PUBLISHED'||periodPosts(db,period.id).every(pid=>can(db,user,'security.roster.generate',postContext(db,pid))))}))};}
    if(m==='POST'&&!id)return tx(db,()=> {
      const from=date(b.starts_on),to=date(b.ends_on);assert(to>=from&&(Date.parse(to)-Date.parse(from))/DAY<93,'Periode harus 1–93 hari.');assertFutureRange(from,to);assert(Array.isArray(b.post_ids)&&b.post_ids.length,'Pilih pos cakupan.');const posts=[...new Set(b.post_ids)];
      for(const pid of posts){const post=get(db,'security_posts',pid);assert(post.org_unit_id===b.org_unit_id&&post.is_active,'Pos harus aktif dan sesuai unit periode.');requireAccess(db,user,'security.roster.generate',postContext(db,pid));assert(!one(db,'SELECT p.id FROM scheduling_periods p JOIN scheduling_period_posts pp ON pp.scheduling_period_id=p.id WHERE pp.post_id=? AND p.starts_on<=? AND p.ends_on>=?',pid,to,from),'Pos telah dicakup periode yang bertumpang tindih.',409);}
      const period=insert(db,'scheduling_periods',{org_unit_id:b.org_unit_id,starts_on:from,ends_on:to,name:text(b.name,'Nama periode'),is_archived:0,created_by:user.id});for(const pid of posts)run(db,'INSERT INTO scheduling_period_posts (scheduling_period_id,post_id) VALUES(?,?)',period.id,pid);audit(db,user,'CREATE','scheduling_periods',period.id);return period;
    });
    if(id&&m==='POST'&&action==='revisions')return tx(db,()=> {
      requirePeriod(db,user,'security.roster.generate',id);const period=get(db,'scheduling_periods',id);const current=one(db,"SELECT * FROM roster_revisions WHERE scheduling_period_id=? AND status='PUBLISHED'",id);
      if(current)assert(b.based_on_revision_id===current.id,'Jadwal terbit berubah. Muat ulang.',409);else assert(!b.based_on_revision_id,'Revisi acuan tidak sesuai.');
      const snapshot=buildSnapshot(db,id,b.rules_version_id),number=one(db,'SELECT coalesce(max(revision_no),0)+1 n FROM roster_revisions WHERE scheduling_period_id=?',id).n;
      const revision=insert(db,'roster_revisions',{scheduling_period_id:id,revision_no:number,rules_version_id:b.rules_version_id,status:'DRAFT',input_snapshot:JSON.stringify(snapshot),input_hash:digest(JSON.stringify(snapshot)),generator_version:GENERATOR_VERSION,generator_seed:text(String(b.seed||'0'),'Seed',100),based_on_revision_id:current?.id||null,created_by:user.id});
      if(current)for(const a of all(db,'SELECT * FROM roster_assignments WHERE roster_revision_id=?',current.id))saveAssignment(db,user,revision,snapshot,{...a,copied_from_assignment_id:a.id});
      reportAndGaps(db,user,revision,snapshot);audit(db,user,'DRAFT_CREATED','roster_revisions',revision.id);return get(db,'roster_revisions',revision.id);
    });
  }
  if(p[0]==='revisions'&&id) {
    const revision=get(db,'roster_revisions',id),period=get(db,'scheduling_periods',revision.scheduling_period_id),snapshot=JSON.parse(revision.input_snapshot);
    if(m==='GET'&&!action) {
      assert(has(db,user,'security.roster.read'),'Akses ditolak.',403);
      const editor=periodPosts(db,period.id).every(pid=>can(db,user,'security.roster.generate',postContext(db,pid)));
      assert(editor||revision.status==='PUBLISHED','Draf atau riwayat hanya tersedia bagi pengelola.',403);
      const assignments=all(db,'SELECT * FROM roster_assignments WHERE roster_revision_id=? ORDER BY service_date,starts_at,post_id',id).filter(a=>can(db,user,'security.roster.read',{...a,...postContext(db,a.post_id)})).map(a=>({...a,display:JSON.parse(a.display_snapshot)}));
      const gaps=all(db,'SELECT g.*,p.name post_name,s.name shift_name FROM roster_gaps g JOIN security_posts p ON p.id=g.post_id JOIN shift_definitions s ON s.id=g.shift_id WHERE roster_revision_id=?',id).filter(g=>can(db,user,'security.roster.read',postContext(db,g.post_id)));
      assert(editor||assignments.length||gaps.length,'Cakupan revisi tidak dapat dibaca.',403);
      return {id:revision.id,period,revision_no:revision.revision_no,status:revision.status,row_version:revision.row_version,published_at:revision.published_at,input_hash:editor?revision.input_hash:undefined,assignments,gaps,report:editor?JSON.parse(revision.validation_report||'{}'):undefined};
    }
    if(m==='POST')return tx(db,()=> {
      const permission=action==='publish'?'security.roster.publish':action==='acknowledge'?'security.roster.acknowledge':action==='generate'?'security.roster.generate':'security.roster.edit';requirePeriod(db,user,permission,period.id);
      assert(revision.status==='DRAFT','Jadwal terbit tidak dapat diubah. Buat revisi baru.',409);assert(revision.row_version===b.row_version,'Draf berubah. Muat ulang.',409);
      if(action==='generate') {
        const from=b.starts_on?date(b.starts_on):period.starts_on,to=b.ends_on?date(b.ends_on):period.ends_on;assert(from>=period.starts_on&&to<=period.ends_on,'Rentang di luar periode.');assertFutureRange(from,to);
        const fresh=buildSnapshot(db,period.id,revision.rules_version_id);
        // Keep requirements outside an explicitly selected adjustment range frozen.
        for(const slot of fresh.slots.filter(s=>s.service_date<from||s.service_date>to)){const old=snapshot.slots.find(o=>o.service_date===slot.service_date&&o.post_id===slot.post_id&&o.shift_id===slot.shift_id);assert(old&&JSON.stringify(old)===JSON.stringify(slot),'Kebutuhan di luar rentang berubah. Perluas rentang revisi secara eksplisit.');}
        const old=all(db,'SELECT * FROM roster_assignments WHERE roster_revision_id=?',id),retained=old.filter(a=>a.is_locked||a.service_date<from||a.service_date>to);
        const result=generateAssignments(fresh,retained,revision.generator_seed,{starts_on:from,ends_on:to});
        for(const a of old)if(!retained.some(r=>r.id===a.id))run(db,'DELETE FROM roster_assignments WHERE id=?',a.id);
        for(const a of result.assignments)if(!a.id)saveAssignment(db,user,revision,fresh,a);
        const saved=update(db,'roster_revisions',id,b.row_version,{input_snapshot:JSON.stringify(fresh),input_hash:digest(JSON.stringify({snapshot:fresh,locked:retained.filter(a=>a.is_locked)}))});reportAndGaps(db,user,saved,fresh,result.rejected);audit(db,user,'GENERATE','roster_revisions',id,{starts_on:from,ends_on:to});return get(db,'roster_revisions',id);
      }
      if(action==='assign') {
        const post=get(db,'security_posts',b.post_id),shift=snapshot.shifts.find(s=>s.id===b.shift_id);assert(periodPosts(db,period.id).includes(post.id)&&shift,'Pos atau shift di luar cakupan.');const day=date(b.service_date);assert(day>=period.starts_on&&day<=period.ends_on,'Tanggal di luar periode.');assert(Date.parse(shiftInterval(day,shift).starts_at)>Date.now(),'Penugasan yang telah dimulai tidak dapat diubah.');get(db,'employees',b.employee_id);
        const a={employee_id:b.employee_id,post_id:b.post_id,shift_id:b.shift_id,service_date:day,...shiftInterval(day,shift),origin:'MANUAL',manual_change_reason:text(b.reason,'Alasan perubahan'),is_locked:Number(Boolean(b.is_locked))};
        const existing=all(db,'SELECT * FROM roster_assignments WHERE roster_revision_id=?',id),errors=validateAssignments(snapshot,[...existing,a]);assert(!errors.length,'Penugasan melanggar validasi: '+errors.slice(0,3).map(e=>e.message).join(' '));saveAssignment(db,user,revision,snapshot,a);update(db,'roster_revisions',id,b.row_version,{});reportAndGaps(db,user,revision,snapshot);audit(db,user,'MANUAL_ASSIGNMENT','roster_revisions',id,{},b.reason);return {ok:true};
      }
      if(['lock','remove'].includes(action)) {
        const a=get(db,'roster_assignments',b.assignment_id);assert(a.roster_revision_id===id,'Penugasan tidak sesuai revisi.');const reason=text(b.reason,'Alasan');assert(a.starts_at>now(),'Penugasan yang telah dimulai tidak dapat diubah.');
        if(action==='remove'){assert(!a.is_locked,'Buka kunci sebelum menghapus penugasan.');run(db,'DELETE FROM roster_assignments WHERE id=?',a.id);}else run(db,'UPDATE roster_assignments SET is_locked=?,locked_by=?,locked_at=?,row_version=row_version+1 WHERE id=?',b.is_locked?1:0,b.is_locked?user.id:null,b.is_locked?now():null,a.id);
        update(db,'roster_revisions',id,b.row_version,{});reportAndGaps(db,user,revision,snapshot);audit(db,user,action.toUpperCase(),'roster_assignments',a.id,{},reason);return {ok:true};
      }
      if(action==='validate') {const fresh=buildSnapshot(db,period.id,revision.rules_version_id);assert(fresh.source_hash===snapshot.source_hash,'Input berubah. Buat ulang draf untuk memperbarui snapshot.',409);const report=reportAndGaps(db,user,revision,snapshot);update(db,'roster_revisions',id,b.row_version,{});return report;}
      if(action==='acknowledge') {
        requirePeriod(db,user,'security.roster.publish',period.id);
        assert(one(db,"SELECT value FROM app_settings WHERE key='allow_gap_publication'").value==='true','Publikasi dengan kekurangan belum diaktifkan oleh pengelola.');const reason=text(b.reason,'Alasan pengakuan kekurangan',3000);run(db,'UPDATE roster_gaps SET acknowledged_by=?,acknowledged_at=?,acknowledgment_reason=? WHERE roster_revision_id=?',user.id,now(),reason,id);update(db,'roster_revisions',id,b.row_version,{});audit(db,user,'ACKNOWLEDGE_GAPS','roster_revisions',id,{},reason);return {ok:true};
      }
      if(action==='publish') {
        const active=one(db,"SELECT id FROM roster_revisions WHERE scheduling_period_id=? AND status='PUBLISHED'",period.id);assert((active?.id||null)===(revision.based_on_revision_id||null),'Revisi terbit berubah. Buat draf dari revisi terbaru.',409);
        const fresh=buildSnapshot(db,period.id,revision.rules_version_id);assert(fresh.source_hash===snapshot.source_hash,'Konfigurasi atau jadwal periode lain berubah. Buat ulang dan validasi draf.',409);
        const assignments=all(db,'SELECT * FROM roster_assignments WHERE roster_revision_id=?',id),errors=validateAssignments(fresh,assignments);assert(!errors.length,'Publikasi ditahan: '+errors.slice(0,4).map(e=>e.message).join(' '));
        // Recompute exact gaps; acknowledgments are valid only for unchanged counts.
        const gaps=all(db,'SELECT * FROM roster_gaps WHERE roster_revision_id=?',id);
        for(const slot of fresh.slots){const count=assignments.filter(a=>a.post_id===slot.post_id&&a.shift_id===slot.shift_id&&a.service_date===slot.service_date).length;if(count<slot.required_count){const gap=gaps.find(g=>g.post_id===slot.post_id&&g.shift_id===slot.shift_id&&g.service_date===slot.service_date&&g.required_count===slot.required_count&&g.assigned_count===count);assert(one(db,"SELECT value FROM app_settings WHERE key='allow_gap_publication'").value==='true'&&gap?.acknowledged_by&&gap.acknowledgment_reason,'Kekurangan belum diakui atau publikasi dengan kekurangan dinonaktifkan.');}}
        if(active)run(db,"UPDATE roster_revisions SET status='SUPERSEDED',superseded_at=?,row_version=row_version+1 WHERE id=?",now(),active.id);
        const saved=update(db,'roster_revisions',id,b.row_version,{status:'PUBLISHED',published_by:user.id,published_at:now()});audit(db,user,'PUBLISH','roster_revisions',id,{revision_no:revision.revision_no});return {id:saved.id,status:saved.status};
      }
    });
  }
  return undefined;
}
