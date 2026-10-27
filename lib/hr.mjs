import { all, one, run, get, insert, update, tx, audit, now, today, assert, text, date, instant, enumValue } from './db.mjs';
import { digest, can, has, requireAccess, employeeContext, coachingAllowed, documentAllowed, trainingAllowed, assertAdminRemains } from './auth.mjs';
import { claimFile, linkedFiles } from './files.mjs';
const optional = v => typeof v==='string' ? v.trim().slice(0,10000)||null : null;
const readList = (db,user,perm,rows) => { assert(has(db,user,perm),'Akses ditolak.',403); return rows.filter(r=>can(db,user,perm,r)); };
export function employees(db,asOf=today()) {
  return all(db,`SELECT e.*,ep.id placement_id,ep.valid_from,ep.supervisor_employee_id,p.name position_name,p.id position_id,p.org_unit_id,u.name unit_name FROM employees e LEFT JOIN employee_placements ep ON ep.employee_id=e.id AND ep.is_primary=1 AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?) LEFT JOIN positions p ON p.id=ep.position_id LEFT JOIN org_units u ON u.id=p.org_unit_id ORDER BY e.full_name`,asOf,asOf).map(e=>({...e,employee_id:e.id}));
}
function placement(db,user,employeeId,b,permission='hr.employees.update') {
  const position=get(db,'positions',b.position_id),from=date(b.valid_from,'Tanggal efektif');
  requireAccess(db,user,permission,{org_unit_id:position.org_unit_id,employee_id:employeeId});
  const supervisor=b.supervisor_employee_id||null;
  assert(supervisor!==employeeId,'Pegawai tidak boleh menjadi atasan dirinya sendiri.');
  if(supervisor) get(db,'employees',supervisor);
  const existing=all(db,'SELECT * FROM employee_placements WHERE employee_id=? AND is_primary=1 ORDER BY valid_from',employeeId);
  const active=existing.find(p=>p.valid_from<=from && (!p.valid_to||p.valid_to>=from));
  if(active) {
    assert(active.valid_from<from,'Penempatan di tanggal ini sudah ada. Gunakan tanggal efektif berikutnya.');
    run(db,'UPDATE employee_placements SET valid_to=?,row_version=row_version+1,updated_at=? WHERE id=?',new Date(Date.parse(from)-86400000).toISOString().slice(0,10),now(),active.id);
  }
  const next=existing.filter(p=>p.valid_from>from).sort((a,b)=>a.valid_from.localeCompare(b.valid_from))[0];
  const end=next?new Date(Date.parse(next.valid_from)-86400000).toISOString().slice(0,10):null;
  const row=insert(db,'employee_placements',{employee_id:employeeId,position_id:position.id,supervisor_employee_id:supervisor,valid_from:from,valid_to:end,is_primary:1,created_by:user.id});
  // Check every effective boundary, including future placements.
  const boundaries=all(db,'SELECT DISTINCT valid_from FROM employee_placements ORDER BY valid_from').map(r=>r.valid_from);
  for(const boundary of boundaries) {
    const graph=new Map(all(db,'SELECT employee_id,supervisor_employee_id FROM employee_placements WHERE is_primary=1 AND valid_from<=? AND (valid_to IS NULL OR valid_to>=?)',boundary,boundary).map(p=>[p.employee_id,p.supervisor_employee_id]));
    for(const start of graph.keys()) { let cursor=start; const seen=new Set(); while(cursor) { assert(!seen.has(cursor),'Rantai atasan membentuk siklus pada tanggal efektif.'); seen.add(cursor); cursor=graph.get(cursor); } }
  }
  audit(db,user,'PLACEMENT_CREATED','employees',employeeId,{placement_id:row.id,valid_from:from});return row;
}
export async function hrRoutes(c) {
  const {db,user,p,method:m,body:b,url}=c; const id=p[1],action=p[2];
  if(p[0]==='employees') {
    if(m==='GET'&&!id) {
      const asOf=url.searchParams.get('as_of')||today();date(asOf);
      let rows=readList(db,user,'hr.employees.read',employees(db,asOf));
      const q=(url.searchParams.get('q')||'').toLowerCase(),unit=url.searchParams.get('unit'),status=url.searchParams.get('status');
      rows=rows.filter(e=>(!q||`${e.full_name} ${e.employee_no}`.toLowerCase().includes(q))&&(!unit||e.org_unit_id===unit)&&(!status||e.employment_status===status));
      return {items:rows};
    }
    if(m==='POST'&&!id) return tx(db,()=> {
      const context=b.position_id?{org_unit_id:get(db,'positions',b.position_id).org_unit_id}:{};
      requireAccess(db,user,'hr.employees.create',context);
      const row=insert(db,'employees',{employee_no:text(b.employee_no,'Nomor pegawai',60).toUpperCase(),full_name:text(b.full_name,'Nama lengkap',200),employment_status:text(b.employment_status,'Status kepegawaian',80),joined_on:date(b.joined_on,'Tanggal mulai kerja'),phone:optional(b.phone),email:optional(b.email),is_active:1,created_by:user.id});
      if(b.position_id) placement(db,user,row.id,{...b,valid_from:b.valid_from||b.joined_on},'hr.employees.create');
      audit(db,user,'CREATE','employees',row.id,{fields:['employee_no','full_name','employment_status']});return row;
    });
    if(id) {
      const e=get(db,'employees',id),ctx=employeeContext(db,id);
      if(m==='GET'&&!action) {
        requireAccess(db,user,'hr.employees.read',ctx);
        return {...e,placements:all(db,'SELECT ep.*,p.name position_name,o.name unit_name FROM employee_placements ep JOIN positions p ON p.id=ep.position_id JOIN org_units o ON o.id=p.org_unit_id WHERE ep.employee_id=? ORDER BY ep.valid_from DESC',id),contracts:can(db,user,'hr.employee_files.read',ctx)?all(db,'SELECT * FROM employee_contracts WHERE employee_id=? ORDER BY starts_on DESC',id):[],files:can(db,user,'hr.employee_files.read',ctx)?linkedFiles(db,'employee',id):[],training:all(db,'SELECT t.*,p.attendance_status FROM training_participants p JOIN training_events t ON t.id=p.training_event_id WHERE p.employee_id=?',id).filter(t=>trainingAllowed(db,user,'read',t))};
      }
      if(m==='PATCH'&&!action) return tx(db,()=> {
        requireAccess(db,user,'hr.employees.update',ctx);
        const joined=date(b.joined_on===undefined?e.joined_on:b.joined_on),ended=b.ended_on===undefined?e.ended_on:b.ended_on?date(b.ended_on):null;
        assert(!ended||ended>=joined,'Tanggal akhir tidak boleh mendahului tanggal mulai.');
        const row=update(db,'employees',id,b.row_version,{employee_no:text(b.employee_no===undefined?e.employee_no:b.employee_no,'Nomor pegawai',60).toUpperCase(),full_name:text(b.full_name===undefined?e.full_name:b.full_name,'Nama',200),employment_status:text(b.employment_status===undefined?e.employment_status:b.employment_status),joined_on:joined,ended_on:ended,phone:b.phone===undefined?e.phone:optional(b.phone),email:b.email===undefined?e.email:optional(b.email),is_active:b.is_active===undefined?e.is_active:Number(Boolean(b.is_active))});
        assertAdminRemains(db);if(!row.is_active)run(db,'UPDATE auth_sessions SET revoked_at=? WHERE user_id IN (SELECT id FROM users WHERE employee_id=?)',now(),id);audit(db,user,'UPDATE','employees',id,{fields:Object.keys(b).filter(x=>x!=='row_version')});return row;
      });
      if(action==='placements'&&m==='POST') return tx(db,()=> { requireAccess(db,user,'hr.employees.update',ctx);assert(Number(b.row_version)===e.row_version,'Data berubah. Muat ulang.',409); const result=placement(db,user,id,b);run(db,'UPDATE employees SET row_version=row_version+1 WHERE id=?',id);return result; });
      if(action==='contracts'&&m==='POST') return tx(db,()=> {
        requireAccess(db,user,'hr.employee_files.manage',ctx);const start=date(b.starts_on),end=b.ends_on?date(b.ends_on):null;assert(!end||end>=start,'Rentang kontrak tidak valid.');if(b.file_id) claimFile(db,user,b.file_id);
        const row=insert(db,'employee_contracts',{employee_id:id,contract_no:text(b.contract_no),starts_on:start,ends_on:end,file_id:b.file_id||null,notes:optional(b.notes),created_by:user.id});audit(db,user,'CREATE','employee_contracts',row.id);return row;
      });
    }
  }
  if(['units','positions'].includes(p[0])) {
    const table=p[0]==='units'?'org_units':'positions';
    if(m==='GET'&&!id) return {items:readList(db,user,'hr.organization.read',all(db,`SELECT * FROM ${table} ORDER BY name`).map(r=>({...r,org_unit_id:table==='org_units'?r.id:r.org_unit_id})))};
    if(['POST','PATCH'].includes(m)) return tx(db,()=> {
      const old=id?get(db,table,id):null,unit=table==='org_units'?(old?.id||b.parent_id):b.org_unit_id;
      requireAccess(db,user,'hr.organization.manage',{org_unit_id:unit});
      const row={code:text(b.code,'Kode',64).toUpperCase(),name:text(b.name,'Nama',200),is_active:b.is_active===undefined?1:Number(Boolean(b.is_active))};
      if(table==='org_units') {
        row.parent_id=b.parent_id||null;
        if(row.parent_id&&row.parent_id!==old?.parent_id)requireAccess(db,user,'hr.organization.manage',{org_unit_id:row.parent_id});
        let parent=row.parent_id;const seen=new Set(id?[id]:[]);while(parent) {assert(!seen.has(parent),'Hierarki unit membentuk siklus.');seen.add(parent);parent=get(db,'org_units',parent).parent_id;}
      } else { get(db,'org_units',unit);row.org_unit_id=unit;assert(!old||old.org_unit_id===unit,'Unit posisi tidak dapat dipindah. Buat posisi baru.'); }
      const saved=old?update(db,table,id,b.row_version,row):insert(db,table,{...row,created_by:user.id});audit(db,user,old?'UPDATE':'CREATE',table,saved.id);return saved;
    });
  }
  if(p[0]==='documents') {
    if(m==='GET'&&!id) {
      assert(has(db,user,'hr.documents.read'),'Akses ditolak.',403);
      return {items:all(db,`SELECT d.*,o.name unit_name,(SELECT version_label FROM document_versions WHERE document_id=d.id AND state='ACTIVE') active_version,(SELECT effective_on FROM document_versions WHERE document_id=d.id AND state='ACTIVE') effective_on FROM documents d JOIN org_units o ON o.id=d.owner_org_unit_id WHERE d.is_archived=0 ORDER BY d.title`).filter(d=>documentAllowed(db,user,'read',d))};
    }
    if(m==='POST'&&!id) return tx(db,()=> {
      requireAccess(db,user,'hr.documents.manage',{org_unit_id:b.owner_org_unit_id});get(db,'org_units',b.owner_org_unit_id);
      const row=insert(db,'documents',{document_code:text(b.document_code,'Kode',64).toUpperCase(),title:text(b.title,'Judul',250),category:enumValue(b.category,['REGULATION','SOP_SECURITY','SOP','SERVICE_STANDARD'],'Kategori'),owner_org_unit_id:b.owner_org_unit_id,audience_kind:enumValue(b.audience_kind||'ALL_UNITS',['ALL_UNITS','SELECTED_UNITS']),description:optional(b.description),is_archived:0,created_by:user.id});
      if(row.audience_kind==='SELECTED_UNITS') { assert(Array.isArray(b.target_units)&&b.target_units.length,'Pilih minimal satu sasaran unit.');for(const unit of new Set(b.target_units))run(db,'INSERT INTO document_target_units (document_id,org_unit_id) VALUES(?,?)',row.id,get(db,'org_units',unit).id); }
      audit(db,user,'CREATE','documents',row.id);return row;
    });
    if(id) {
      const doc=get(db,'documents',id);
      assert(!doc.is_archived,'Dokumen tidak ditemukan.',404);
      if(m==='GET'&&!action) {
        assert(documentAllowed(db,user,'read',doc),'Akses ditolak.',403);
        const manage=documentAllowed(db,user,'manage',doc);
        return {...doc,can_manage:manage,can_delete:manage,can_publish:documentAllowed(db,user,'publish',doc),versions:all(db,'SELECT v.*,f.original_name FROM document_versions v JOIN files f ON f.id=v.file_id WHERE v.document_id=? ORDER BY v.created_at DESC',id).filter(v=>manage||v.state==='ACTIVE'),targets:all(db,'SELECT org_unit_id FROM document_target_units WHERE document_id=?',id)};
      }
      if(m==='DELETE'&&!action) return tx(db,()=> {
        assert(documentAllowed(db,user,'manage',doc),'Anda tidak memiliki akses untuk menghapus dokumen unit ini.',403);
        update(db,'documents',id,b.row_version,{is_archived:1});
        audit(db,user,'DELETE','documents',id,{document_code:doc.document_code,title:doc.title});return {deleted:true};
      });
      if(m==='POST'&&action==='versions') return tx(db,()=> {
        assert(documentAllowed(db,user,'manage',doc),'Akses ditolak.',403);claimFile(db,user,b.file_id);
        const row=insert(db,'document_versions',{document_id:id,file_id:b.file_id,version_label:text(b.version_label,'Versi',50),effective_on:date(b.effective_on),state:'DRAFT',change_notes:optional(b.change_notes),created_by:user.id});audit(db,user,'VERSION_ADDED','documents',id,{version_id:row.id});return row;
      });
      if(m==='POST'&&action==='activate') return tx(db,()=> {
        assert(documentAllowed(db,user,'publish',doc),'Akses ditolak.',403);
        const v=get(db,'document_versions',b.version_id);assert(v.document_id===id&&v.state==='DRAFT','Versi bukan draf dokumen ini.');assert(v.row_version===b.row_version,'Versi berubah. Muat ulang.',409);assert(v.effective_on<=today(),'Tanggal berlaku belum tiba.');
        assert(get(db,'files',v.file_id).status==='AVAILABLE','Berkas tidak tersedia.');
        run(db,"UPDATE document_versions SET state='ARCHIVED',archived_at=?,row_version=row_version+1 WHERE document_id=? AND state='ACTIVE'",now(),id);
        const row=update(db,'document_versions',v.id,b.row_version,{state:'ACTIVE',activated_by:user.id,activated_at:now()});audit(db,user,'ACTIVATE','document_versions',v.id);return row;
      });
    }
  }
  if(p[0]==='training') {
    if(m==='GET'&&id==='calendar'&&!action) {
      // Public-to-staff summary only: do not reuse the detailed training route,
      // which can include participant, material and certificate information.
      assert(user?.id&&user.status==='ACTIVE','Sesi pengguna tidak aktif.',403);
      const year=Number(url.searchParams.get('year'));
      assert(Number.isInteger(year)&&year>=2000&&year<=2100,'Tahun kalender tidak valid.');
      const from=new Date(`${year}-01-01T00:00:00+08:00`).toISOString();
      const until=new Date(`${year+1}-01-01T00:00:00+08:00`).toISOString();
      return {items:all(db,'SELECT id,title,starts_at,ends_at,location,description,status FROM training_events WHERE deleted_at IS NULL AND starts_at<? AND ends_at>? ORDER BY starts_at,id',until,from)};
    }
    if(m==='GET'&&!id) {assert(has(db,user,'hr.training.read'),'Akses ditolak.',403);return {items:all(db,'SELECT t.*,(SELECT count(*) FROM training_participants WHERE training_event_id=t.id) participant_count FROM training_events t WHERE t.deleted_at IS NULL ORDER BY starts_at DESC').filter(t=>trainingAllowed(db,user,'read',t))};}
    if(m==='POST'&&!id) return tx(db,()=> {
      requireAccess(db,user,'hr.training.manage',{org_unit_id:b.organizer_org_unit_id});get(db,'org_units',b.organizer_org_unit_id);
      const start=instant(b.starts_at),end=instant(b.ends_at);assert(end>start,'Waktu selesai harus setelah waktu mulai.');
      const row=insert(db,'training_events',{title:text(b.title),topic:text(b.topic),organizer_org_unit_id:b.organizer_org_unit_id,organizer_name:optional(b.organizer_name),starts_at:start,ends_at:end,location:optional(b.location),description:optional(b.description),status:'PLANNED',created_by:user.id});audit(db,user,'CREATE','training_events',row.id);return row;
    });
    if(id) {
      const event=get(db,'training_events',id);
      assert(!event.deleted_at,'Kegiatan tidak ditemukan.',404);
      if(m==='GET'&&!action) {
        assert(trainingAllowed(db,user,'read',event),'Akses ditolak.',403);
        const manage=trainingAllowed(db,user,'participants',event);
        return {...event,can_delete:user.username==='itadmin',can_upload_documentation:trainingAllowed(db,user,'manage',event),can_view_documentation:trainingAllowed(db,user,'download',event),participants:all(db,'SELECT tp.*,e.full_name,e.employee_no FROM training_participants tp JOIN employees e ON e.id=tp.employee_id WHERE tp.training_event_id=? ORDER BY e.full_name',id).filter(tp=>manage||can(db,user,'hr.training.read',{org_unit_id:event.organizer_org_unit_id,employee_id:tp.employee_id})),materials:all(db,"SELECT tm.*,dv.file_id document_file_id FROM training_materials tm LEFT JOIN document_versions dv ON dv.id=tm.document_version_id WHERE tm.training_event_id=? AND tm.usage_kind='MATERIAL'",id),documentation:all(db,"SELECT f.id,f.original_name,f.mime_type,f.size_bytes,tm.title caption,tm.created_at FROM training_materials tm JOIN files f ON f.id=tm.file_id WHERE tm.training_event_id=? AND tm.usage_kind='DOCUMENTATION' AND f.status='AVAILABLE' ORDER BY tm.created_at,tm.id",id),certificates:all(db,'SELECT pc.*,tp.employee_id FROM participant_certificates pc JOIN training_participants tp ON tp.id=pc.training_participant_id WHERE tp.training_event_id=?',id).filter(pc=>manage||pc.employee_id===user.employee_id)};
      }
      if(m==='DELETE'&&!action) return tx(db,()=> {
        assert(user.username==='itadmin','Hanya itadmin yang boleh menghapus kegiatan.',403);
        assert(trainingAllowed(db,user,'read',event),'Akses ditolak.',403);
        update(db,'training_events',id,b.row_version,{deleted_at:now(),deleted_by:user.id});
        audit(db,user,'DELETE','training_events',id,{title:event.title});return {deleted:true};
      });
      if(m==='POST'&&action==='documentation') return tx(db,()=> {
        assert(trainingAllowed(db,user,'manage',event),'Akses unggah dokumentasi ditolak.',403);
        const file=claimFile(db,user,b.file_id);assert(['image/jpeg','image/png'].includes(file.mime_type),'Dokumentasi hanya menerima foto JPG atau PNG.');
        const row=insert(db,'training_materials',{training_event_id:id,title:text(b.caption||file.original_name,'Keterangan foto'),file_id:file.id,usage_kind:'DOCUMENTATION',created_by:user.id});
        audit(db,user,'ADD_DOCUMENTATION','training_events',id,{file_id:file.id});return row;
      });
      if(m==='PATCH'&&!action) return tx(db,()=> {assert(trainingAllowed(db,user,'manage',event),'Akses ditolak.',403);const row=update(db,'training_events',id,b.row_version,{status:enumValue(b.status,['PLANNED','COMPLETED','CANCELLED'])});audit(db,user,'UPDATE','training_events',id,{status:row.status});return row;});
      if(m==='PATCH'&&action==='details') return tx(db,()=> {
        assert(trainingAllowed(db,user,'manage',event),'Akses ditolak.',403);
        const start=instant(b.starts_at),end=instant(b.ends_at);
        assert(end>start,'Waktu selesai harus setelah waktu mulai.');
        const values={title:text(b.title),starts_at:start,ends_at:end,location:optional(b.location),description:optional(b.description)};
        const row=update(db,'training_events',id,b.row_version,values);
        audit(db,user,'UPDATE_DETAILS','training_events',id,{changed_fields:Object.keys(values)});
        return row;
      });
      if(m==='POST'&&action==='participants') return tx(db,()=> {
        assert(trainingAllowed(db,user,'participants',event),'Akses ditolak.',403);
        const bulk=b.employee_ids!==undefined,employeeIds=bulk?b.employee_ids:[b.employee_id];
        assert(Array.isArray(employeeIds)&&employeeIds.length>0&&employeeIds.every(employeeId=>typeof employeeId==='string'&&employeeId.trim().length>0),'Pilih minimal satu peserta.');
        assert(new Set(employeeIds).size===employeeIds.length,'Daftar peserta tidak boleh berulang.');
        const items=[];
        for(const employeeId of employeeIds){
          const ec=employeeContext(db,get(db,'employees',employeeId).id);requireAccess(db,user,'hr.training.participants',ec);
          if(bulk)assert(!one(db,'SELECT id FROM training_participants WHERE training_event_id=? AND employee_id=?',id,employeeId),'Salah satu pegawai sudah terdaftar. Muat ulang kegiatan sebelum memilih peserta.',409);
          const row=insert(db,'training_participants',{training_event_id:id,employee_id:employeeId,attendance_status:'NOT_RECORDED',created_by:user.id});
          audit(db,user,'ADD_PARTICIPANT','training_events',id,{participant_id:row.id});items.push(row);
        }
        return bulk?{items}:items[0];
      });
      if(m==='PATCH'&&action==='participants') return tx(db,()=> {assert(trainingAllowed(db,user,'participants',event),'Akses ditolak.',403);const tp=get(db,'training_participants',p[3]);assert(tp.training_event_id===id,'Peserta tidak sesuai.');const status=enumValue(b.attendance_status,['NOT_RECORDED','PRESENT','ABSENT']);const row=update(db,'training_participants',tp.id,b.row_version,{attendance_status:status,attendance_notes:optional(b.attendance_notes),attendance_recorded_by:status==='NOT_RECORDED'?null:user.id,attendance_recorded_at:status==='NOT_RECORDED'?null:now()});audit(db,user,'ATTENDANCE','training_participants',row.id,{attendance_status:status});return row;});
      if(m==='POST'&&action==='materials') return tx(db,()=> {
        assert(trainingAllowed(db,user,'manage',event),'Akses ditolak.',403);assert(Boolean(b.file_id)!==Boolean(b.document_version_id),'Pilih satu berkas atau versi dokumen.');
        if(b.file_id)claimFile(db,user,b.file_id);else {const v=get(db,'document_versions',b.document_version_id);assert(v.state!=='DRAFT'&&documentAllowed(db,user,'read',get(db,'documents',v.document_id)),'Versi dokumen tidak tersedia.',403);}
        const row=insert(db,'training_materials',{training_event_id:id,title:text(b.title),file_id:b.file_id||null,document_version_id:b.document_version_id||null,created_by:user.id});audit(db,user,'ADD_MATERIAL','training_events',id);return row;
      });
      if(m==='POST'&&action==='certificates') return tx(db,()=> {assert(trainingAllowed(db,user,'participants',event),'Akses ditolak.',403);const tp=get(db,'training_participants',b.training_participant_id);assert(tp.training_event_id===id,'Peserta tidak sesuai.');claimFile(db,user,b.file_id);const row=insert(db,'participant_certificates',{training_participant_id:tp.id,file_id:b.file_id,certificate_no:optional(b.certificate_no),issued_on:b.issued_on?date(b.issued_on):null,created_by:user.id});audit(db,user,'ADD_CERTIFICATE','training_participants',tp.id);return row;});
    }
  }
  if(p[0]==='coaching-form-link') {
    assert(m==='GET'&&p.length===1,'Alamat tidak ditemukan.',404);
    assert(can(db,user,'hr.coaching.manage'),'Hanya pengelola coaching seluruh unit yang dapat mengambil tautan formulir.',403);
    const link=one(db,'SELECT id,label,token_hash,share_token FROM coaching_links WHERE is_active=1 AND revoked_at IS NULL');
    assert(link&&typeof link.share_token==='string'&&/^[a-f0-9]{64}$/.test(link.share_token)&&digest(link.share_token)===link.token_hash,'Tautan formulir coaching belum tersedia. Hubungi pengelola portal.',404);
    return {label:link.label,token:link.share_token};
  }
  if(p[0]==='coaching') {
    if(m==='GET'&&!id) {assert(has(db,user,'hr.coaching.read')||has(db,user,'hr.coaching.manage'),'Akses ditolak.',403);return {can_share_link:can(db,user,'hr.coaching.manage'),items:all(db,`SELECT s.*,e.full_name employee_name,c.full_name coach_name,(SELECT count(*) FROM coaching_actions WHERE coaching_session_id=s.id AND status<>'DONE') open_actions FROM coaching_sessions s JOIN employees e ON e.id=s.employee_id JOIN employees c ON c.id=s.coach_employee_id ORDER BY held_at DESC`).filter(s=>coachingAllowed(db,user,'read',s))};}
    if(m==='POST'&&!id) return tx(db,()=> {
      const ec=employeeContext(db,get(db,'employees',b.employee_id).id);get(db,'employees',b.coach_employee_id);const rowData={employee_id:b.employee_id,coach_employee_id:b.coach_employee_id,org_unit_id:ec.org_unit_id};assert(rowData.org_unit_id,'Pegawai belum memiliki penempatan utama.');assert(rowData.employee_id!==rowData.coach_employee_id,'Pembimbing harus berbeda dari pegawai.');
      assert(coachingAllowed(db,user,'create',rowData),'Akses pencatatan coaching ditolak.',403);
      const row=insert(db,'coaching_sessions',{...rowData,held_at:instant(b.held_at),topic:text(b.topic),guidance_notes:text(b.guidance_notes,'Arahan',10000),constraints_notes:optional(b.constraints_notes),agreement_notes:optional(b.agreement_notes),created_by:user.id});audit(db,user,'CREATE','coaching_sessions',row.id);return row;
    });
    if(id) {
      const session=get(db,'coaching_sessions',id);
      if(m==='GET'&&!action) {assert(coachingAllowed(db,user,'read',session),'Akses coaching ditolak.',403);return {...session,employee_name:get(db,'employees',session.employee_id).full_name,coach_name:get(db,'employees',session.coach_employee_id).full_name,actions:all(db,'SELECT a.*,e.full_name responsible_name FROM coaching_actions a JOIN employees e ON e.id=a.responsible_employee_id WHERE coaching_session_id=? ORDER BY a.created_at',id),files:linkedFiles(db,'coaching',id),held_date_only:Boolean(one(db,'SELECT id FROM coaching_form_submissions WHERE coaching_session_id=?',id))};}
      if(m==='POST'&&action==='actions') return tx(db,()=> {assert(coachingAllowed(db,user,'update',session),'Akses ditolak.',403);get(db,'employees',b.responsible_employee_id);const row=insert(db,'coaching_actions',{coaching_session_id:id,responsible_employee_id:b.responsible_employee_id,action_text:text(b.action_text,'Tindak lanjut',3000),due_on:b.due_on?date(b.due_on):null,status:'OPEN',created_by:user.id});audit(db,user,'ADD_ACTION','coaching_sessions',id);return row;});
      if(m==='PATCH'&&action==='actions') return tx(db,()=> {assert(coachingAllowed(db,user,'update',session),'Akses ditolak.',403);const a=get(db,'coaching_actions',p[3]);assert(a.coaching_session_id===id,'Tindak lanjut tidak sesuai.');const status=enumValue(b.status,['OPEN','IN_PROGRESS','DONE']);const row=update(db,'coaching_actions',a.id,b.row_version,{status,progress_notes:optional(b.progress_notes),completion_notes:status==='DONE'?text(b.completion_notes,'Hasil penyelesaian',5000):null,completed_at:status==='DONE'?now():null});audit(db,user,'ACTION_UPDATED','coaching_actions',a.id,{status});return row;});
    }
  }
  if(p[0]==='imports') {
    requireAccess(db,user,'hr.employees.create');
    if(m==='GET'&&!id)return {items:all(db,"SELECT * FROM import_candidates WHERE status='PENDING' ORDER BY org_path,full_name")};
    if(m==='POST'&&id) return tx(db,()=> {const candidate=get(db,'import_candidates',id);assert(candidate.status==='PENDING','Baris telah ditinjau.',409);const saved=insert(db,'employees',{employee_no:text(b.employee_no,'Nomor pegawai',60).toUpperCase(),full_name:text(b.full_name||candidate.full_name),employment_status:text(b.employment_status,'Status kepegawaian'),joined_on:date(b.joined_on),is_active:1,created_by:user.id});placement(db,user,saved.id,{position_id:b.position_id,valid_from:b.valid_from||b.joined_on,supervisor_employee_id:b.supervisor_employee_id},'hr.employees.create');update(db,'import_candidates',id,b.row_version,{status:'IMPORTED',employee_id:saved.id});audit(db,user,'IMPORT_REVIEWED','employees',saved.id,{source_cell:candidate.source_cell,source_name:candidate.source_name});return saved;});
  }
  return undefined;
}
