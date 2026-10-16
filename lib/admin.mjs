import {randomBytes} from 'node:crypto';
import {all,one,run,get,insert,update,tx,audit,now,assert,text,enumValue} from './db.mjs';
import {requireAccess,has,can,employeeContext,postContext,hashPassword,digest,safeUser,assertAdminRemains} from './auth.mjs';
export async function adminRoutes(c) {
  const {db,user,p,method:m,body:b}=c,id=p[1],action=p[2];
  if(p[0]==='users') {
    if(m==='GET'&&!id){requireAccess(db,user,'admin.users.read');return {items:all(db,'SELECT id,username,employee_id,status,must_change_password,last_login_at,row_version FROM users ORDER BY username').map(u=>({...u,grants:all(db,'SELECT ur.*,r.name role_name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE user_id=?',u.id).map(g=>({...g,units:all(db,'SELECT * FROM user_role_units WHERE user_role_id=?',g.id),posts:all(db,'SELECT post_id FROM user_role_posts WHERE user_role_id=?',g.id).map(p=>p.post_id)}))}))};}
    if(m==='POST'&&!id) {
      requireAccess(db,user,'admin.users.manage');const hash=await hashPassword(b.password);
      return tx(db,()=>{const row=insert(db,'users',{username:text(b.username,'Username',64).toLowerCase(),employee_id:b.employee_id||null,password_hash:hash,status:'ACTIVE',must_change_password:1,failed_login_count:0,password_changed_at:now(),created_by:user.id});audit(db,user,'CREATE','users',row.id,{username:row.username});return safeUser(row);});
    }
    if(id&&m==='PATCH'&&!action)return tx(db,()=> {requireAccess(db,user,'admin.users.manage');get(db,'users',id);const status=enumValue(b.status,['ACTIVE','INACTIVE']);const saved=update(db,'users',id,b.row_version,{status});if(status!=='ACTIVE')run(db,'UPDATE auth_sessions SET revoked_at=? WHERE user_id=?',now(),id);assertAdminRemains(db);audit(db,user,'STATUS_CHANGED','users',id,{status});return safeUser(saved);});
    if(id&&m==='POST'&&action==='grants')return tx(db,()=> {
      requireAccess(db,user,'admin.roles.manage');const account=get(db,'users',id);assert(account.row_version===b.row_version,'Data akun berubah. Muat ulang.',409);assert(Array.isArray(b.grants)&&b.grants.length<=30,'Pemberian role tidak valid.');
      run(db,'DELETE FROM user_roles WHERE user_id=?',id);
      for(const g of b.grants){const role=get(db,'roles',g.role_id);assert(role.is_active,'Role tidak aktif.');const kind=enumValue(g.scope_kind,['SELF','ASSIGNED_UNITS','ASSIGNED_POSTS','ALL']);if(role.code==='SUPER_ADMIN')assert(kind==='ALL','Super Admin memerlukan cakupan seluruh organisasi.');const grant=insert(db,'user_roles',{user_id:id,role_id:g.role_id,scope_kind:kind});
        if(kind==='ASSIGNED_UNITS'){assert(Array.isArray(g.units)&&g.units.length,'Pilih minimal satu unit.');for(const unit of g.units)run(db,'INSERT INTO user_role_units (user_role_id,org_unit_id,include_descendants) VALUES(?,?,?)',grant.id,get(db,'org_units',unit.org_unit_id).id,Number(Boolean(unit.include_descendants)));}
        if(kind==='ASSIGNED_POSTS'){assert(Array.isArray(g.posts)&&g.posts.length,'Pilih minimal satu pos.');for(const postId of new Set(g.posts))run(db,'INSERT INTO user_role_posts (user_role_id,post_id) VALUES(?,?)',grant.id,get(db,'security_posts',postId).id);}
      }
      assertAdminRemains(db);update(db,'users',id,b.row_version,{});audit(db,user,'GRANTS_CHANGED','users',id,{grant_count:b.grants.length});return {ok:true};
    });
    if(id&&m==='POST'&&action==='reset')return tx(db,()=> {requireAccess(db,user,'admin.users.reset');get(db,'users',id);const token=randomBytes(24).toString('hex');run(db,'UPDATE password_reset_tokens SET revoked_at=? WHERE user_id=? AND consumed_at IS NULL',now(),id);insert(db,'password_reset_tokens',{user_id:id,token_hash:digest(token),expires_at:new Date(Date.now()+30*60000).toISOString(),issued_by:user.id});run(db,'UPDATE auth_sessions SET revoked_at=? WHERE user_id=?',now(),id);audit(db,user,'RESET_ISSUED','users',id);return {token,expires_in_minutes:30};});
  }
  if(p[0]==='roles') {
    if(m==='GET'&&!id){requireAccess(db,user,'admin.roles.read');return {items:all(db,'SELECT * FROM roles ORDER BY name').map(r=>({...r,permissions:all(db,'SELECT p.code FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id=?',r.id).map(p=>p.code)})),permissions:all(db,'SELECT * FROM permissions ORDER BY code')};}
    if(['POST','PATCH'].includes(m))return tx(db,()=> {
      requireAccess(db,user,'admin.roles.manage');const old=id?get(db,'roles',id):null;
      assert(Array.isArray(b.permissions),'Daftar izin wajib diisi.');
      const code=text(b.code===undefined?old?.code:b.code,'Kode role',64).toUpperCase();
      assert(!old?.is_system||code===old.code,'Kode role sistem tidak dapat diubah. Izin role tetap dapat disesuaikan.');
      const values={code,name:text(b.name===undefined?old?.name:b.name,'Nama role',120),description:b.description===undefined?old?.description||null:typeof b.description==='string'?b.description.slice(0,2000):null,is_active:b.is_active===undefined?old?.is_active??1:Number(Boolean(b.is_active))};
      const saved=old?update(db,'roles',id,b.row_version,values):insert(db,'roles',{...values,is_system:0,created_by:user.id});
      run(db,'DELETE FROM role_permissions WHERE role_id=?',saved.id);
      for(const code of new Set(b.permissions)){const perm=one(db,'SELECT id FROM permissions WHERE code=?',code);assert(perm,'Izin tidak dikenal.');run(db,'INSERT INTO role_permissions (role_id,permission_id) VALUES(?,?)',saved.id,perm.id);}
      assertAdminRemains(db);audit(db,user,old?'UPDATE':'CREATE','roles',saved.id,{permission_count:b.permissions.length});return saved;
    });
  }
  if(p[0]==='audit'&&m==='GET'){requireAccess(db,user,'admin.audit.read');return {items:all(db,'SELECT a.id,a.actor_user_id,u.username actor_name,a.action,a.object_type,a.object_key,a.occurred_at,a.outcome,a.reason,a.change_summary FROM audit_events a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.occurred_at DESC,a.rowid DESC LIMIT 500')};}
  if(p[0]==='settings'){
    requireAccess(db,user,'admin.roles.manage');if(m==='GET')return Object.fromEntries(all(db,'SELECT key,value FROM app_settings').map(r=>[r.key,r.value]));
    if(m==='PATCH')return tx(db,()=> {assert(typeof b.allow_gap_publication==='boolean','Pilihan kebijakan tidak valid.');run(db,"UPDATE app_settings SET value=? WHERE key='allow_gap_publication'",String(b.allow_gap_publication));audit(db,user,'POLICY_CHANGED','app_settings','allow_gap_publication',{enabled:b.allow_gap_publication},text(b.reason,'Dasar keputusan'));return {ok:true};});
  }
  return undefined;
}
