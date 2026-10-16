import { all,one,run,get,insert,update,tx,audit,now,today,assert,text,date,instant,integer,enumValue } from './db.mjs';
import { can,has,requireAccess,employeeContext,postContext,digest } from './auth.mjs';
import {linkedFiles} from './files.mjs';
export const configTables={groups:'security_groups',posts:'security_posts',shifts:'shift_definitions',members:'security_group_members',eligibility:'employee_post_eligibility',unavailability:'employee_unavailability',rules:'scheduling_rule_versions',patterns:'roster_pattern_versions',bindings:'employee_rotation_bindings',requirements:'staffing_requirements',overrides:'staffing_overrides'};
const opt=v=>typeof v==='string'?v.trim().slice(0,5000)||null:null;
export function configContext(db,key,r) {
  if(r.post_id)return postContext(db,r.post_id);
  if(key==='posts')return {...r,post_id:r.id};
  if(r.security_group_id)return {org_unit_id:get(db,'security_groups',r.security_group_id).org_unit_id};
  if(r.employee_id)return employeeContext(db,r.employee_id);
  return {org_unit_id:r.org_unit_id};
}
function rangeOverlap(db,table,where,args,from,to,startKey='valid_from',endKey='valid_to',exclude='') {
  assert(!one(db,`SELECT id FROM ${table} WHERE ${where} AND ${startKey}<=? AND (${endKey} IS NULL OR ${endKey}>=?) AND id<>?`,...args,to||'9999-12-31',from,exclude),'Rentang aktif bertumpang tindih.');
}
function configPayload(db,user,key,b,old) {
  const r={};
  if(['groups','posts','shifts','rules','patterns'].includes(key)){get(db,'org_units',b.org_unit_id);r.org_unit_id=b.org_unit_id;assert(!old||old.org_unit_id===r.org_unit_id,'Unit master tidak dapat dipindahkan.');}
  if(['groups','posts','shifts'].includes(key)){r.code=text(b.code,'Kode',64).toUpperCase();r.name=text(b.name,'Nama',200);r.is_active=b.is_active===undefined?1:Number(Boolean(b.is_active));}
  if(key==='posts'){r.home_group_id=b.home_group_id||null;r.location_notes=opt(b.location_notes);if(r.home_group_id)assert(get(db,'security_groups',r.home_group_id).org_unit_id===r.org_unit_id,'Kelompok pengelola harus sesuai unit pos.');}
  if(key==='shifts') {
    r.start_time=text(b.start_time);r.end_time=text(b.end_time);r.end_day_offset=integer(b.end_day_offset,'Pergantian hari',0,1);
    assert([r.start_time,r.end_time].every(t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t)),'Format jam harus HH:mm.');
    const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3));const duration=minutes(r.end_time)+r.end_day_offset*1440-minutes(r.start_time);assert(duration>0&&duration<=1440,'Durasi shift harus lebih dari 0 dan maksimal 24 jam.');
  }
  if(['members','eligibility','unavailability','bindings'].includes(key)){get(db,'employees',b.employee_id);r.employee_id=b.employee_id;}
  if(['members','eligibility'].includes(key)){
    r.valid_from=date(b.valid_from);r.valid_to=b.valid_to?date(b.valid_to):null;assert(!r.valid_to||r.valid_to>=r.valid_from,'Rentang tanggal tidak valid.');
    const fk=key==='members'?'security_group_id':'post_id';r[fk]=b[fk];get(db,key==='members'?'security_groups':'security_posts',b[fk]);
    rangeOverlap(db,configTables[key],`${fk}=? AND employee_id=?`,[r[fk],r.employee_id],r.valid_from,r.valid_to,'valid_from','valid_to',old?.id||'');
    if(key==='eligibility')r.notes=opt(b.notes);
  }
  if(key==='unavailability'){r.starts_at=instant(b.starts_at);r.ends_at=instant(b.ends_at);assert(r.ends_at>r.starts_at,'Waktu selesai harus setelah waktu mulai.');r.reason=text(b.reason);r.notes=opt(b.notes);r.recorded_by=user.id;}
  if(['rules','patterns'].includes(key)) {r.version_no=integer(b.version_no,'Nomor versi',1);r.is_active=1;r.notes=opt(b.notes);assert(!old,'Master versi tidak diubah. Tambahkan versi baru.');}
  if(key==='rules') for(const field of ['min_rest_minutes','max_consecutive_work_days','max_work_minutes_per_local_day','max_work_minutes_rolling_7_days'])r[field]=integer(b[field],field,1,field==='max_consecutive_work_days'?365:field==='max_work_minutes_per_local_day'?1440:10080);
  if(key==='patterns'){r.pattern_code=text(b.pattern_code,'Kode pola',64).toUpperCase();r.name=text(b.name);r.cycle_length_days=integer(b.cycle_length_days,'Jumlah hari siklus',1,366);assert(Array.isArray(b.steps)&&b.steps.length===r.cycle_length_days,'Langkah pola harus lengkap untuk setiap hari.');for(const step of b.steps){enumValue(step.step_kind,['WORK','REST']);if(step.step_kind==='WORK'){assert(get(db,'shift_definitions',step.shift_id).org_unit_id===r.org_unit_id,'Shift pola harus sesuai unit.');if(step.post_id)assert(get(db,'security_posts',step.post_id).org_unit_id===r.org_unit_id,'Pos pola harus sesuai unit.');}}}
  if(key==='bindings'){assert(!old,'Binding immutable. Tambahkan binding bertanggal efektif baru.');const pattern=get(db,'roster_pattern_versions',b.pattern_version_id);r.pattern_version_id=pattern.id;r.anchor_date=date(b.anchor_date);r.phase_offset_days=integer(b.phase_offset_days,'Fase',0,pattern.cycle_length_days-1);r.effective_from=date(b.effective_from);r.notes=opt(b.notes);}
  if(['requirements','overrides'].includes(key)){
    r.post_id=get(db,'security_posts',b.post_id).id;r.shift_id=get(db,'shift_definitions',b.shift_id).id;assert(get(db,'security_posts',r.post_id).org_unit_id===get(db,'shift_definitions',r.shift_id).org_unit_id,'Pos dan shift harus sesuai unit.');r.is_active=b.is_active===undefined?1:Number(Boolean(b.is_active));
    if(key==='requirements') {r.weekday_no=integer(b.weekday_no,'Hari',1,7);r.required_count=integer(b.required_count,'Kebutuhan',0,200);r.effective_from=date(b.effective_from);r.effective_to=b.effective_to?date(b.effective_to):null;assert(!r.effective_to||r.effective_to>=r.effective_from,'Rentang tanggal tidak valid.');if(r.is_active)rangeOverlap(db,configTables[key],'post_id=? AND shift_id=? AND weekday_no=? AND is_active=1',[r.post_id,r.shift_id,r.weekday_no],r.effective_from,r.effective_to,'effective_from','effective_to',old?.id||'');}
    else {r.starts_on=date(b.starts_on);r.ends_on=date(b.ends_on);assert(r.ends_on>=r.starts_on,'Rentang penyesuaian tidak valid.');r.replacement_required_count=integer(b.replacement_required_count,'Kebutuhan pengganti',0,200);r.reason=text(b.reason);if(r.is_active)rangeOverlap(db,configTables[key],'post_id=? AND shift_id=? AND is_active=1',[r.post_id,r.shift_id],r.starts_on,r.ends_on,'starts_on','ends_on',old?.id||'');}
  }
  return r;
}
export async function securityRoutes(c) {
  const {db,user,p,method:m,body:b,url}=c;const id=p[1],action=p[2];
  if(p[0]==='config'&&p[1]) {
    const key=p[1],table=configTables[key];assert(table,'Jenis pengaturan tidak dikenal.',404);
    if(m==='GET') {assert(has(db,user,'security.config.read'),'Akses ditolak.',403);return {items:all(db,`SELECT * FROM ${table} ORDER BY created_at DESC`).filter(r=>can(db,user,'security.config.read',configContext(db,key,r))).map(r=>key==='patterns'?{...r,steps:all(db,'SELECT * FROM roster_pattern_steps WHERE pattern_version_id=? ORDER BY cycle_day_no',r.id)}:r)};}
    if(['POST','PATCH'].includes(m))return tx(db,()=> {
      const old=p[2]?get(db,table,p[2]):null;
      if(old)requireAccess(db,user,'security.config.manage',configContext(db,key,old));
      const row=configPayload(db,user,key,b,old);requireAccess(db,user,'security.config.manage',configContext(db,key,{...old,...row}));
      if(key==='eligibility')requireAccess(db,user,'security.config.manage',employeeContext(db,row.employee_id));
      const saved=old?update(db,table,old.id,b.row_version,row):insert(db,table,{...row,created_by:user.id});
      if(key==='patterns')b.steps.forEach((s,i)=>insert(db,'roster_pattern_steps',{pattern_version_id:saved.id,cycle_day_no:i+1,step_kind:s.step_kind,shift_id:s.step_kind==='WORK'?s.shift_id:null,post_id:s.step_kind==='WORK'?(s.post_id||null):null,created_by:user.id}));
      audit(db,user,old?'UPDATE':'CREATE',table,saved.id);return saved;
    });
  }
  if(p[0]==='logbook') {
    if(m==='GET'&&!id){assert(has(db,user,'security.logbook.read'),'Akses ditolak.',403);return {items:all(db,'SELECT l.*,e.full_name employee_name,p.name post_name FROM logbook_entries l JOIN employees e ON e.id=l.employee_id JOIN security_posts p ON p.id=l.post_id ORDER BY occurred_at DESC').filter(l=>can(db,user,'security.logbook.read',{...l,...postContext(db,l.post_id)}))};}
    if(m==='POST'&&!id)return tx(db,()=> {
      const ctx={...postContext(db,b.post_id),employee_id:b.employee_id};requireAccess(db,user,'security.logbook.create',ctx);assert(get(db,'employees',b.employee_id).is_active,'Pegawai tidak aktif.');
      if(b.roster_assignment_id){const a=get(db,'roster_assignments',b.roster_assignment_id);assert(a.employee_id===b.employee_id&&a.post_id===b.post_id&&get(db,'roster_revisions',a.roster_revision_id).status!=='DRAFT','Penugasan tidak sesuai atau belum pernah terbit.');}
      const row=insert(db,'logbook_entries',{employee_id:b.employee_id,post_id:b.post_id,occurred_at:instant(b.occurred_at),activity_type:enumValue(b.activity_type,['JAGA','PATROLI','LAINNYA']),activity_notes:text(b.activity_notes,'Uraian kegiatan',10000),findings:opt(b.findings),roster_assignment_id:b.roster_assignment_id||null,created_by:user.id});audit(db,user,'CREATE','logbook_entries',row.id);return row;
    });
    if(id){const log=get(db,'logbook_entries',id),ctx={...log,...postContext(db,log.post_id)};
      if(m==='GET'&&!action){requireAccess(db,user,'security.logbook.read',ctx);return {...log,employee_name:get(db,'employees',log.employee_id).full_name,post_name:get(db,'security_posts',log.post_id).name,files:linkedFiles(db,'logbook',id),incidents:all(db,'SELECT * FROM incidents WHERE source_logbook_entry_id=?',id).filter(i=>can(db,user,'security.incidents.read',{...i,...postContext(db,i.post_id)}))};}
      if(m==='PATCH'&&!action)return tx(db,()=> {requireAccess(db,user,'security.logbook.update',ctx);const row=update(db,'logbook_entries',id,b.row_version,{activity_notes:text(b.activity_notes,'Uraian',10000),findings:opt(b.findings)});audit(db,user,'UPDATE','logbook_entries',id);return row;});
    }
  }
  if(p[0]==='incidents') {
    if(m==='GET'&&!id){assert(has(db,user,'security.incidents.read'),'Akses ditolak.',403);return {items:all(db,'SELECT i.*,p.name post_name,e.full_name reporter_name,r.full_name responsible_name FROM incidents i JOIN security_posts p ON p.id=i.post_id JOIN employees e ON e.id=i.reporter_employee_id LEFT JOIN employees r ON r.id=i.responsible_employee_id ORDER BY i.occurred_at DESC').filter(i=>can(db,user,'security.incidents.read',{...i,...postContext(db,i.post_id),related_employees:[i.responsible_employee_id]}))};}
    if(m==='POST'&&!id)return tx(db,()=> {
      const ctx={...postContext(db,b.post_id),reporter_employee_id:b.reporter_employee_id};requireAccess(db,user,'security.incidents.create',ctx);get(db,'employees',b.reporter_employee_id);
      const key=text(b.idempotency_key,'Kunci permintaan',100),payload={post_id:b.post_id,reporter_employee_id:b.reporter_employee_id,occurred_at:instant(b.occurred_at),incident_type:text(b.incident_type),chronology:text(b.chronology,'Kronologi',20000),initial_action:text(b.initial_action,'Tindakan awal',10000),source_logbook_entry_id:b.source_logbook_entry_id||null};
      const previous=one(db,'SELECT * FROM incidents WHERE idempotency_key=?',key);
      if(previous){assert(previous.created_by===user.id&&Object.entries(payload).every(([k,v])=>previous[k]===v),'Kunci permintaan sudah dipakai untuk laporan berbeda.',409);return previous;}
      if(payload.source_logbook_entry_id){const log=get(db,'logbook_entries',payload.source_logbook_entry_id);requireAccess(db,user,'security.logbook.read',{...log,...postContext(db,log.post_id)});assert(log.post_id===payload.post_id,'Pos logbook tidak sesuai.');}
      const count=one(db,'SELECT count(*) count FROM incidents').count+1;
      const row=insert(db,'incidents',{...payload,incident_no:`INC-${today().replaceAll('-','')}-${String(count).padStart(4,'0')}`,idempotency_key:key,status:'RECORDED',created_by:user.id});insert(db,'incident_updates',{incident_id:row.id,actor_user_id:user.id,event_type:'CREATED',notes:'Laporan dicatat.',to_status:'RECORDED'});audit(db,user,'CREATE','incidents',row.id);return row;
    });
    if(id){const incident=get(db,'incidents',id),ctx={...incident,...postContext(db,incident.post_id),related_employees:[incident.responsible_employee_id]};
      if(m==='GET'&&!action){requireAccess(db,user,'security.incidents.read',ctx);return {...incident,post_name:get(db,'security_posts',incident.post_id).name,reporter_name:get(db,'employees',incident.reporter_employee_id).full_name,responsible_name:incident.responsible_employee_id?get(db,'employees',incident.responsible_employee_id).full_name:null,updates:all(db,'SELECT iu.*,u.username actor_name FROM incident_updates iu JOIN users u ON u.id=iu.actor_user_id WHERE incident_id=? ORDER BY iu.created_at,iu.rowid',id),files:linkedFiles(db,'incident',id)};}
      if(m==='POST'&&action==='updates')return tx(db,()=> {
        requireAccess(db,user,'security.incidents.update',ctx);assert(b.row_version===incident.row_version,'Laporan berubah. Muat ulang.',409);const notes=text(b.notes,'Catatan perkembangan',10000);const status=b.status||incident.status;enumValue(status,['RECORDED','IN_PROGRESS','RESOLVED']);
        const responsible=b.responsible_employee_id||incident.responsible_employee_id; if(responsible)get(db,'employees',responsible);
        const reopen=incident.status==='RESOLVED'&&status==='IN_PROGRESS';if(reopen)requireAccess(db,user,'security.incidents.reopen',ctx);
        assert(status===incident.status||(incident.status==='RECORDED'&&status==='IN_PROGRESS')||(incident.status==='IN_PROGRESS'&&status==='RESOLVED')||reopen,'Transisi status tidak diizinkan.');
        assert(status==='RECORDED'||responsible,'Penanggung jawab wajib ditetapkan.');
        const row=update(db,'incidents',id,b.row_version,{status,responsible_employee_id:responsible||null,resolved_at:status==='RESOLVED'?(incident.resolved_at||now()):null,resolution_notes:status==='RESOLVED'?(incident.status==='RESOLVED'?incident.resolution_notes:notes):null});
        insert(db,'incident_updates',{incident_id:id,actor_user_id:user.id,event_type:reopen?'REOPENED':status!==incident.status?'STATUS_CHANGED':responsible!==incident.responsible_employee_id?'RESPONSIBLE_CHANGED':'NOTE',notes,from_status:status!==incident.status?incident.status:null,to_status:status!==incident.status?status:null,new_responsible_employee_id:responsible!==incident.responsible_employee_id?responsible:null});audit(db,user,reopen?'REOPEN':'UPDATE','incidents',id,{from_status:incident.status,to_status:status});return row;
      });
    }
  }
  return undefined;
}
