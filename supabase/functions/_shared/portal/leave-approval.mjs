// Use actual dated primary placements. No role grants or guessed substitute approvers.
export function leaveApprovalRoute(employee,byId,assert){
 const bossOf=e=>{
  const boss=byId.get(e?.supervisor_employee_id);
  assert(e&&!e.placement_ambiguous&&boss?.is_active===1&&!boss.placement_ambiguous&&boss.id!==e.id,'Data jenjang atasan belum lengkap atau tidak tunggal. Hubungi pengelola Kontrol Cuti.');
  return boss;
 };
 const first=bossOf(employee),head=/^Kepala Bidang\b/i.test(employee.position_name||''),leader=/^Kepala Badan\b|^Pimpinan\b/i.test(first.position_name||'');
 if(head)assert(leader,'Atasan kepala bidang harus Pimpinan/Kepala Badan. Periksa master penempatan.');
 const route=head||leader?[first]:[first,bossOf(first)];
 assert(new Set([employee.id,...route.map(e=>e.id)]).size===route.length+1,'Struktur atasan berulang. Periksa master penempatan.');
 return route.map(e=>({id:e.id,name:e.full_name}));
}
