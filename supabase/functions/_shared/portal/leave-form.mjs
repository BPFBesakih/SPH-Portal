import {assert,audit,today} from './db.mjs';
import {leaveRoutes} from './leaves.mjs';
import {leaveApprovalRoute} from './leave-approval.mjs';
export const formDigest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function takeLeaveFormSlot(db,ip,action){
 assert(typeof ip==='string'&&ip.length<=45&&/^[a-f0-9:.]+$/i.test(ip),'Jalur pengiriman tidak valid.',400);
 assert(['context','preview','submit'].includes(action),'Alamat tidak ditemukan.',404);
 const key=await formDigest(`leave-form:${action}:${ip}`),limit={context:120,preview:60,submit:15}[action];
 await db.query("DELETE FROM leave_form_rate_limits WHERE window_start<now()-interval '1 day'");
 const [row]=await db.query(`INSERT INTO leave_form_rate_limits(id,window_start,hits) VALUES($1,now(),1)
 ON CONFLICT(id) DO UPDATE SET window_start=CASE WHEN leave_form_rate_limits.window_start<now()-interval '10 minutes' THEN now() ELSE leave_form_rate_limits.window_start END,
 hits=CASE WHEN leave_form_rate_limits.window_start<now()-interval '10 minutes' THEN 1 ELSE leave_form_rate_limits.hits+1 END RETURNING hits`,[key]);
 return row.hits<=limit;
}
export async function publicLeaveForm(db,action,body,requestId){
 assert(['context','preview','submit'].includes(action),'Alamat tidak ditemukan.',404);
 assert(typeof body.token==='string'&&/^[a-f0-9]{64}$/.test(body.token),'Tautan tidak aktif. Minta tautan formulir kepada SDM.',404);
 const hash=await formDigest(body.token);
 let [link]=await db.query('SELECT id,employee_id,expires_at::text expires_at FROM leave_form_links WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE',[hash]);
 if(!link){[link]=await db.query('SELECT id,expires_at::text expires_at FROM leave_shared_form_links WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE',[hash]);if(link)link.shared=true;}
 assert(link,'Tautan tidak aktif atau kedaluwarsa. Minta tautan baru kepada SDM.',404);
 assert(!body.website,'Permintaan tidak valid.');
 if(link.shared&&action==='context'){
  const rows=await db.query(`SELECT e.id,e.full_name,e.is_active,e.employment_status,right(e.employee_no,4) suffix,p.name position_name,u.name unit_name,
   ep.supervisor_employee_id,boss.full_name approver,boss.is_active boss_active FROM employees e
   LEFT JOIN employee_placements ep ON ep.employee_id=e.id AND ep.is_primary=1 AND ep.valid_from<=$1 AND (ep.valid_to IS NULL OR ep.valid_to>=$1)
   LEFT JOIN positions p ON p.id=ep.position_id LEFT JOIN org_units u ON u.id=p.org_unit_id LEFT JOIN employees boss ON boss.id=ep.supervisor_employee_id
   WHERE e.is_active=1 ORDER BY e.full_name,e.id`,[today()]);
  const groups=new Map();for(const row of rows){const list=groups.get(row.id)||[];list.push(row);groups.set(row.id,list);}
  const everyone=[...groups.values()].map(list=>({...list[0],placement_ambiguous:list.length!==1})),byId=new Map(everyone.map(e=>[e.id,e]));
  const people=everyone.filter(e=>['Pegawai Kontrak (PKWT)','Pegawai Probation'].includes(e.employment_status));
  return {shared:true,today:today(),expires_at:link.expires_at,employees:people.map(e=>{let route=[];try{route=leaveApprovalRoute(e,byId,assert);}catch{}return {id:e.id,full_name:e.full_name,unit_name:e.unit_name||'',
   position_name:[e.position_name,e.unit_name,...(people.filter(p=>p.full_name===e.full_name).length>1?['ID berakhir '+e.suffix]:[])].filter(Boolean).join(' · '),
   approver:route.map(a=>a.name).join(' → ')||null,can_request:route.length>0};})};
 }
 if(link.shared){
  assert(typeof body.employee_id==='string','Pilih nama pegawai dari hasil pencarian.');
  const [employee]=await db.query("SELECT id FROM employees WHERE id=$1 AND is_active=1 AND employment_status IN ('Pegawai Kontrak (PKWT)','Pegawai Probation')",[body.employee_id]);
  assert(employee,'Pegawai tidak tersedia untuk cuti tahunan.',403);link.employee_id=employee.id;
 }
 // Personal links bind identity; shared links record the selected active employee as self-reported.
 // Neither pathway impersonates an authenticated account. Direct supervisors must verify identity.
 const user={id:null,employee_id:link.employee_id,must_change_password:0,request_id:requestId};
 const ctx={db,user,p:['leaves',...(action==='preview'?['preview']:[])],method:action==='context'?'GET':'POST',
  body:{dates:body.dates,reason:body.reason,client_key:body.client_key},url:new URL('https://internal.invalid/leaves')};
 const result=await leaveRoutes(ctx,{assert,can:async()=>false,has:async()=>false,audit,today,formLink:link});
 if(action==='context'){
  assert(result.me?.eligible,'THL atau pegawai nonaktif tidak memperoleh cuti tahunan.',403);
  const own=result.balances.find(b=>b.employee_id===link.employee_id);
  return {today:result.today,name:result.me.name,unit_name:own?.unit_name||'',position_name:own?.position_name||'',
   available_days:own?.available_days||0,reserved_days:own?.reserved_days||0,approver:result.approvers.map(a=>a.name).join(' → ')||null,
   can_request:result.capabilities.can_request,expires_at:link.expires_at};
 }
 if(action==='preview')return {dates:result.dates,day_count:result.dates.length,approver:result.approvers.map(a=>a.name).join(' → '),
  conflicts:[...new Set(result.conflicts.map(c=>c.date))],allocations:result.allocations};
 return {reference:result.id,status:result.status,duplicate:result.duplicate===true};
}
