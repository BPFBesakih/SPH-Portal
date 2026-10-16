import { randomBytes, createHash, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { all, one, run, insert, update, tx, audit, now, today, assert, text, uid } from './db.mjs';
const scryptAsync = promisify(scrypt);
export const digest = value => createHash('sha256').update(value).digest('hex');
const params = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export function validPassword(password) { assert(typeof password === 'string' && password.length >= 12 && password.length <= 128, 'Password harus 12–128 karakter.'); return password; }
export function hashPasswordSync(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(validPassword(password), salt, 64, params).toString('hex')}`;
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${(await scryptAsync(validPassword(password), salt, 64, params)).toString('hex')}`;
}
const dummyHash = hashPasswordSync('Unusable-account-password-2026');
export async function verifyPassword(password, hash = dummyHash) {
  const [, salt, expected] = hash.split('$');
  const actual = await scryptAsync(typeof password === 'string' ? password.slice(0,128) : '', salt, 64, params);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
export const resourceActions = {
  'hr.employees': ['read','create','update','export'], 'hr.organization': ['read','manage'],
  'hr.employee_files': ['read','manage'], 'hr.documents': ['read','manage','publish','download'],
  'hr.training': ['read','manage','participants','download'], 'hr.coaching': ['read','create','update','manage'],
  'security.config': ['read','manage'], 'security.roster': ['read','generate','edit','publish','acknowledge','export'],
  'security.logbook': ['read','create','update','download'], 'security.incidents': ['read','create','update','reopen','download'],
  'admin.users': ['read','manage','reset'], 'admin.roles': ['read','manage'], 'admin.audit': ['read']
};
export function seedPermissions(db) {
  for (const [resource, actions] of Object.entries(resourceActions)) for (const action of actions) {
    const code = `${resource}.${action}`;
    if (!one(db,'SELECT id FROM permissions WHERE code=?', code)) insert(db,'permissions',{code,module_code:resource.split('.')[0],resource,action});
  }
  const roleSpecs = [
    ['SUPER_ADMIN','Super Admin', c => !c.startsWith('hr.coaching.') && !c.startsWith('hr.employee_files.')],
    ['SDM','Pengelola SDM', c => c.startsWith('hr.')],
    ['COORDINATOR','Koordinator Keamanan', c => c.startsWith('security.') || ['hr.documents.read','hr.documents.download'].includes(c)],
    ['OFFICER','Petugas Keamanan', c => ['security.roster.read','security.logbook.read','security.logbook.create','security.logbook.download','security.incidents.read','security.incidents.create','security.incidents.download','hr.documents.read','hr.documents.download'].includes(c)],
    ['EMPLOYEE','Pegawai', c => ['hr.employees.read','hr.training.read','hr.training.download','hr.coaching.read','hr.coaching.update','hr.documents.read','hr.documents.download'].includes(c)]
  ];
  for (const [code,name,filter] of roleSpecs) {
    if (one(db,'SELECT id FROM roles WHERE code=?',code)) continue;
    const role = insert(db,'roles',{code,name,is_system:code==='SUPER_ADMIN',is_active:1});
    for (const p of all(db,'SELECT * FROM permissions').filter(p=>filter(p.code))) run(db,'INSERT INTO role_permissions (role_id,permission_id) VALUES(?,?)',role.id,p.id);
  }
}
export function createAdmin(db, username, password) {
  seedPermissions(db);
  assert(!one(db,'SELECT id FROM users LIMIT 1'), 'Akun sudah diinisialisasi. Gunakan pengaturan akun.');
  return tx(db,()=> {
    const user=insert(db,'users',{username:text(username,'Username',64).toLowerCase(),password_hash:hashPasswordSync(password),status:'ACTIVE',must_change_password:1,failed_login_count:0,password_changed_at:now()});
    insert(db,'user_roles',{user_id:user.id,role_id:one(db,"SELECT id FROM roles WHERE code='SUPER_ADMIN'").id,scope_kind:'ALL'});
    audit(db,null,'INITIALIZE','users',user.id,{username:user.username}); return user;
  });
}
export function grants(db,user) {
  return all(db,`SELECT ur.id,ur.scope_kind,p.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id AND r.is_active=1 JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=?`,user.id);
}
export function employeeContext(db,id,asOf) {
  const e = one(db,`SELECT e.id employee_id,p.org_unit_id FROM employees e LEFT JOIN employee_placements ep ON ep.employee_id=e.id AND ep.is_primary=1 AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?) LEFT JOIN positions p ON p.id=ep.position_id WHERE e.id=?`,asOf||today(),asOf||today(),id);
  return e || {employee_id:id};
}
export function can(db,user,permission,context = {}) {
  const matches = grants(db,user).filter(g=>g.code===permission);
  return matches.some(g=> {
    if (g.scope_kind==='ALL') return true;
    if (g.scope_kind==='SELF') return Boolean(user.employee_id && [context.employee_id,context.reporter_employee_id,...(context.related_employees||[])].includes(user.employee_id));
    if (g.scope_kind==='ASSIGNED_POSTS') return permission.startsWith('security.') && Boolean(context.post_id && one(db,'SELECT 1 FROM user_role_posts WHERE user_role_id=? AND post_id=?',g.id,context.post_id));
    if (!context.org_unit_id) return false;
    return all(db,'SELECT * FROM user_role_units WHERE user_role_id=?',g.id).some(u=> {
      if (u.org_unit_id===context.org_unit_id) return true;
      return u.include_descendants && Boolean(one(db,'WITH RECURSIVE tree(id) AS (SELECT id FROM org_units WHERE parent_id=? UNION ALL SELECT o.id FROM org_units o JOIN tree t ON o.parent_id=t.id) SELECT id FROM tree WHERE id=?',u.org_unit_id,context.org_unit_id));
    });
  });
}
export function has(db,user,permission) { return grants(db,user).some(g=>g.code===permission); }
export function requireAccess(db,user,permission,context = {}) { assert(can(db,user,permission,context),'Anda tidak memiliki akses untuk tindakan atau cakupan data ini.',403); }
export function postContext(db,id) { const p=one(db,'SELECT org_unit_id,id post_id FROM security_posts WHERE id=?',id); assert(p,'Pos tidak ditemukan.',404); return p; }
export function reportContext(db,row) { return {...row,...(row.post_id?postContext(db,row.post_id):{org_unit_id:row.reporting_org_unit_id}),related_employees:[row.responsible_employee_id].filter(Boolean)}; }
export function announcementsManager(db,user) {
  return Boolean(one(db,"SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=? AND r.is_active=1 AND r.code IN ('SUPER_ADMIN','SDM')",user.id));
}
export function coachingAllowed(db,user,action,session) {
  if (can(db,user,'hr.coaching.manage',session)) return true;
  return [session.employee_id,session.coach_employee_id].includes(user.employee_id) && can(db,user,`hr.coaching.${action}`,{...session,related_employees:[session.employee_id,session.coach_employee_id]});
}
export function documentAllowed(db,user,action,doc) {
  const permission=`hr.documents.${action}`;
  if (!['read','download'].includes(action)) return can(db,user,permission,{org_unit_id:doc.owner_org_unit_id});
  const targets=all(db,'SELECT org_unit_id FROM document_target_units WHERE document_id=?',doc.id).map(t=>t.org_unit_id);
  return grants(db,user).filter(g=>g.code===permission).some(g=> {
    if (g.scope_kind==='ALL') return true;
    if (g.scope_kind==='ASSIGNED_POSTS') return false;
    if (g.scope_kind==='SELF') {
      const unit=user.employee_id && employeeContext(db,user.employee_id).org_unit_id;
      return Boolean(unit && (doc.audience_kind==='ALL_UNITS' || targets.includes(unit)));
    }
    return doc.audience_kind==='ALL_UNITS' || targets.some(org_unit_id=>can(db,user,permission,{org_unit_id}));
  });
}
export function trainingAllowed(db,user,action,event) {
  if(event.deleted_at)return false;
  const related=user.employee_id && one(db,'SELECT id FROM training_participants WHERE training_event_id=? AND employee_id=?',event.id,user.employee_id);
  return can(db,user,`hr.training.${action}`,{org_unit_id:event.organizer_org_unit_id,employee_id:related?user.employee_id:null});
}
export function assertAdminRemains(db) {
  const users=all(db,`SELECT u.* FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.status='ACTIVE' AND (u.employee_id IS NULL OR e.is_active=1)`);
  assert(users.some(u=>can(db,u,'admin.users.manage') && can(db,u,'admin.roles.manage')), 'Administrator terakhir yang aktif tidak boleh dinonaktifkan atau kehilangan izin.',409);
}
export function cookies(header='') { return Object.fromEntries(header.split(';').map(x=>x.trim().split(/=(.*)/s).slice(0,2)).filter(x=>x.length===2)); }
export function authenticate(db,req) {
  const token=cookies(req.headers.cookie).besakih_session;
  assert(token,'Silakan masuk terlebih dahulu.',401);
  const session=one(db,'SELECT * FROM auth_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?',digest(token),now());
  assert(session,'Sesi berakhir. Silakan masuk kembali.',401);
  const user=one(db,'SELECT * FROM users WHERE id=?',session.user_id);
  assert(user?.status==='ACTIVE' && (!user.employee_id || one(db,'SELECT is_active FROM employees WHERE id=?',user.employee_id)?.is_active===1),'Akun tidak aktif.',401);
  return {...user,session,request_id:uid()};
}
export const safeUser = u => ({id:u.id,username:u.username,employee_id:u.employee_id,must_change_password:Boolean(u.must_change_password),status:u.status,row_version:u.row_version});
export async function login(db,body,req) {
  const username = typeof body.username==='string'?body.username.toLowerCase().trim():'';
  const user=one(db,'SELECT * FROM users WHERE username=?',username);
  const valid=await verifyPassword(body.password,user?.password_hash);
  const current=user && one(db,'SELECT * FROM users WHERE id=?',user.id);
  if (!valid || !current || current.password_hash!==user.password_hash || current.status!=='ACTIVE' || (current.locked_until && current.locked_until>now()) || (current.employee_id && !one(db,'SELECT is_active FROM employees WHERE id=?',current.employee_id)?.is_active)) {
    if (current) {
      const count=current.failed_login_count+1;
      run(db,'UPDATE users SET failed_login_count=?,locked_until=? WHERE id=?',count,count>=5?new Date(Date.now()+15*60000).toISOString():current.locked_until,current.id);
    }
    assert(false,'Username atau password salah, atau akun belum dapat digunakan.',401);
  }
  const token=randomBytes(32).toString('hex'),csrfToken=randomBytes(24).toString('hex');
  const hours=Math.max(1,Math.min(24,Number(process.env.SESSION_HOURS)||8));
  insert(db,'auth_sessions',{user_id:current.id,token_hash:digest(token),csrf_hash:digest(csrfToken),expires_at:new Date(Date.now()+hours*3600000).toISOString(),last_seen_at:now(),ip_address:req.socket.remoteAddress,user_agent:(req.headers['user-agent']||'').slice(0,500)});
  run(db,'UPDATE users SET failed_login_count=0,locked_until=NULL,last_login_at=? WHERE id=?',now(),current.id);
  audit(db,current,'LOGIN','users',current.id);
  return {user:safeUser(current),token,csrfToken,hours};
}
export async function changePassword(db,user,body) {
  assert(await verifyPassword(body.current_password,user.password_hash),'Password saat ini salah.',422);
  const hash=await hashPassword(body.new_password);
  tx(db,()=> {
    const current=one(db,'SELECT password_hash FROM users WHERE id=?',user.id);
    assert(current.password_hash===user.password_hash,'Password berubah. Silakan masuk kembali.',409);
    run(db,'UPDATE users SET password_hash=?,must_change_password=0,password_changed_at=?,row_version=row_version+1 WHERE id=?',hash,now(),user.id);
    run(db,'UPDATE auth_sessions SET revoked_at=? WHERE user_id=?',now(),user.id);
    audit(db,user,'PASSWORD_CHANGED','users',user.id);
  });
}
