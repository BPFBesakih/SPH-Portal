import {assert,audit,today} from './db.mjs';
import {leaveRoutes} from './leaves.mjs';
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
 assert(typeof body.token==='string'&&/^[a-f0-9]{64}$/.test(body.token),'Tautan tidak aktif. Minta tautan pribadi kepada SDM.',404);
 const [link]=await db.query('SELECT id,employee_id,expires_at::text expires_at FROM leave_form_links WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE',[await formDigest(body.token)]);
 assert(link,'Tautan tidak aktif atau kedaluwarsa. Minta tautan baru kepada SDM.',404);
 assert(!body.website,'Permintaan tidak valid.');
 // Identity always comes from the server-side link. Never accept an employee/user ID supplied by the browser.
 const user={id:null,employee_id:link.employee_id,must_change_password:0,request_id:requestId};
 const ctx={db,user,p:['leaves',...(action==='preview'?['preview']:[])],method:action==='context'?'GET':'POST',
  body:{dates:body.dates,reason:body.reason,client_key:body.client_key},url:new URL('https://internal.invalid/leaves')};
 const result=await leaveRoutes(ctx,{assert,can:async()=>false,has:async()=>false,audit,today,formLink:link});
 if(action==='context'){
  assert(result.me?.eligible,'THL atau pegawai nonaktif tidak memperoleh cuti tahunan.',403);
  const own=result.balances.find(b=>b.employee_id===link.employee_id);
  return {today:result.today,name:result.me.name,unit_name:own?.unit_name||'',position_name:own?.position_name||'',
   available_days:own?.available_days||0,reserved_days:own?.reserved_days||0,approver:result.approver?.name||null,
   can_request:result.capabilities.can_request,expires_at:link.expires_at};
 }
 if(action==='preview')return {dates:result.dates,day_count:result.dates.length,approver:result.approver.name,
  conflicts:[...new Set(result.conflicts.map(c=>c.date))],allocations:result.allocations};
 return {reference:result.id,status:result.status,duplicate:result.duplicate===true};
}
