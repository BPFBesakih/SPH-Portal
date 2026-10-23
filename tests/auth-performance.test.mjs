import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,insert,one,run} from '../lib/db.mjs';
import {seedPermissions,can,has} from '../lib/auth.mjs';
import {hrRoutes} from '../lib/hr.mjs';
function fixture(t){
 const raw=openDb(':memory:');t.after(()=>raw.close());seedPermissions(raw);
 const units=['Induk','Anak','Lain'].map((name,i)=>insert(raw,'org_units',{code:'U'+i,name,parent_id:i===1?one(raw,"SELECT id FROM org_units WHERE code='U0'").id:null,is_active:1}));
 const positions=units.map((u,i)=>insert(raw,'positions',{code:'P'+i,name:'Posisi '+i,org_unit_id:u.id,is_active:1}));
 for(let i=0;i<90;i++){const e=insert(raw,'employees',{employee_no:'E'+i,full_name:'Pegawai '+i,employment_status:'Tetap',joined_on:'2020-01-01',is_active:1});insert(raw,'employee_placements',{employee_id:e.id,position_id:positions[i%3].id,valid_from:'2020-01-01',is_primary:1});}
 const user=insert(raw,'users',{username:'scoped',password_hash:'fixture',password_changed_at:new Date().toISOString(),status:'ACTIVE',must_change_password:0}),role=insert(raw,'roles',{code:'PERF_TEST',name:'Pembaca cakupan',is_active:1,is_system:0});
 run(raw,"INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE code='hr.employees.read'",role.id);
 const grant=insert(raw,'user_roles',{user_id:user.id,role_id:role.id,scope_kind:'ASSIGNED_UNITS'});run(raw,'INSERT INTO user_role_units(user_role_id,org_unit_id,include_descendants) VALUES(?,?,1)',grant.id,units[0].id);
 const request=(readOnly=true)=>{let queries=0;return {prepare(sql){queries++;return raw.prepare(sql);},get queries(){return queries;},...(readOnly?{authorizationCache:new Map()}:{}),exec:raw.exec.bind(raw)};};
 return {raw,units,positions,user,role,grant,request};
}
const employees=(db,user)=>hrRoutes({db,user,p:['employees'],method:'GET',body:{},url:new URL('https://fixture/api/employees')});
test('one request reuses authorization across a full employee menu with identical scoped results',async t=>{
 const f=fixture(t),uncached=f.request(false),cached=f.request();
 const before=await employees(uncached,f.user),after=await employees(cached,f.user);assert.deepEqual(after,before);assert.equal(after.items.length,60);assert(cached.queries<=8);assert(uncached.queries>200);
 console.log(JSON.stringify({fixture:'90 employees across 3 units',before_queries:uncached.queries,after_queries:cached.queries,visible_rows:after.items.length}));
});
test('new requests and mutations observe changed grants and unit assignments immediately',t=>{
 const f=fixture(t),first=f.request();assert(has(first,f.user,'hr.employees.read'));assert(can(first,f.user,'hr.employees.read',{org_unit_id:f.units[1].id}));
 run(f.raw,'UPDATE user_role_units SET include_descendants=0 WHERE user_role_id=?',f.grant.id);assert.equal(can(f.request(),f.user,'hr.employees.read',{org_unit_id:f.units[1].id}),false);
 const mutation=f.request(false);assert(has(mutation,f.user,'hr.employees.read'));run(f.raw,'DELETE FROM role_permissions WHERE role_id=?',f.role.id);assert.equal(has(mutation,f.user,'hr.employees.read'),false);assert.equal(has(f.request(),f.user,'hr.employees.read'),false);
});
test('request caches preserve user and post boundaries, including cached denials',t=>{
 const f=fixture(t);run(f.raw,"INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE code='security.logbook.read'",f.role.id);run(f.raw,"UPDATE user_roles SET scope_kind='ASSIGNED_POSTS' WHERE id=?",f.grant.id);
 const post=insert(f.raw,'security_posts',{code:'POST',name:'Pos uji',org_unit_id:f.units[0].id,is_active:1});run(f.raw,'INSERT INTO user_role_posts(user_role_id,post_id) VALUES(?,?)',f.grant.id,post.id);
 const r=f.request();for(let i=0;i<10;i++){assert(can(r,f.user,'security.logbook.read',{post_id:post.id}));assert.equal(can(r,f.user,'security.logbook.read',{post_id:'different'}),false);assert.equal(can(r,f.user,'hr.employees.read',{post_id:post.id}),false);}assert(r.queries<=3);
 const other=insert(f.raw,'users',{username:'no_access',password_hash:'fixture',password_changed_at:new Date().toISOString(),status:'ACTIVE'});assert.equal(has(r,other,'security.logbook.read'),false);
});
