export async function leaveControlEligible(db,user){
 if(!user?.id)return false;
 const [row]=await db.query(`SELECT EXISTS(SELECT 1 FROM leave_controller_accounts WHERE user_id=$1)
  OR EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND r.code='SUPER_ADMIN' AND r.is_active=1) allowed`,[user.id]);
 return row?.allowed===true;
}
// Keep the restricted control role from being propagated through the generic role editor.
// Operational approval is independent of this administrative role.
export async function guardLeaveRoleChanges({db,p,method,body},assert){
 if(p[0]==='roles'&&['POST','PATCH'].includes(method)&&Array.isArray(body.permissions)&&body.permissions.some(code=>typeof code==='string'&&code.startsWith('hr.leaves.'))){
  const old=p[1]?(await db.query('SELECT code FROM roles WHERE id::text=$1',[p[1]]))[0]:null;
  const code=String(body.code??old?.code??'').toUpperCase();
  assert(['SUPER_ADMIN','LEAVE_CONTROLLER'].includes(code),'Izin Kontrol Cuti hanya tersedia pada role Kontrol Cuti dan Super Admin.',403);
 }
 if(p[0]==='users'&&p[2]==='grants'&&method==='POST'&&Array.isArray(body.grants)){
  const ids=body.grants.map(g=>g?.role_id).filter(id=>typeof id==='string');
  const roles=ids.length?await db.query('SELECT code FROM roles WHERE id::text=ANY($1::text[])',[ids]):[];
  if(roles.some(r=>r.code==='LEAVE_CONTROLLER')&&!roles.some(r=>r.code==='SUPER_ADMIN')){
   const allowed=(await db.query('SELECT 1 FROM leave_controller_accounts WHERE user_id::text=$1',[p[1]]))[0];
   assert(allowed,'Role Kontrol Cuti hanya dapat diberikan kepada akun yang telah ditetapkan.',403);
  }
 }
}
