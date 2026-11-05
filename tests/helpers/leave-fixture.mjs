import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {insert,assert,audit} from '../../supabase/functions/_shared/portal/db.mjs';
import {leaveRoutes} from '../../supabase/functions/_shared/portal/leaves.mjs';
import {publicLeaveForm,formDigest} from '../../supabase/functions/_shared/portal/leave-form.mjs';
export async function createLeaveFixture(leaveHandler=leaveRoutes){
 const pg=new PGlite();
 await pg.exec(`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,encrypted_password text);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id));CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO authenticated;`);
 const directory=new URL('../../supabase/migrations/',import.meta.url);
 for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')&&!n.includes('enable_leave_year_maintenance_cron')).sort()){
  if(name==='20261102000100_visit_management.sql')await pg.exec("INSERT INTO public.app_roles(code,name) VALUES('IT_ADMIN','IT Admin')");
  await pg.exec(readFileSync(new URL(name,directory),'utf8'));
 }
 await pg.exec('SET search_path=portal,pg_catalog');
 const adapt=tx=>({inTransaction:true,query:async(sql,args=[])=>{const r=await tx.query(sql,args);return Object.assign(r.rows,{count:r.affectedRows??r.rows.length});}}),db=adapt(pg);
 const atomic=work=>pg.transaction(tx=>work(adapt(tx)));
 await insert(db,'org_units',{id:'test-unit',code:'TEST',name:'Unit Pengujian'});
 const actors={};
 for(const [key,name,boss] of [['director','Pimpinan',null],['boss','Atasan','director'],['employee','Pegawai','boss'],['peer','Rekan','boss'],['thl','THL','boss']]){
  await insert(db,'positions',{id:'position-'+key,code:'POS-'+key,org_unit_id:'test-unit',name:key==='director'?'Pimpinan':'Staf '+name});
  await insert(db,'employees',{id:'employee-'+key,employee_no:'TEST-'+key,full_name:name,employment_status:key==='thl'?'Tenaga Harian Lepas':'Pegawai Kontrak (PKWT)',is_active:1,joined_on:'2020-01-01'});
  await insert(db,'employee_placements',{employee_id:'employee-'+key,position_id:'position-'+key,supervisor_employee_id:boss?'employee-'+boss:null,valid_from:'2020-01-01',is_primary:1});
  const id=randomUUID();await pg.query('INSERT INTO auth.users(id) VALUES($1)',[id]);
  actors[key]=await insert(db,'users',{id,username:'test-'+key,employee_id:'employee-'+key,status:'ACTIVE',must_change_password:0});
 }
 const services={assert,audit,can:async()=>false,has:async()=>false,today:()=> '2026-11-05'};
 const route=(actor,path='',method='POST',body={})=>atomic(db=>leaveHandler({db,user:actors[actor],p:['leaves',...path.split('/').filter(Boolean)],method,body,url:new URL('https://fixture.test/leaves')},services));
 const row=async id=>(await db.query('SELECT * FROM leave_requests WHERE id=$1',[id]))[0];
 const decide=async(actor,id,decision='approve',extra={})=>route(actor,id+'/decision','POST',{row_version:(await row(id)).row_version,decision,verified_work_dates:true,verified_identity:true,note:'Verifikasi pengujian',...extra});
 const reset=async()=>{
  await pg.exec('DELETE FROM leave_approval_steps;DELETE FROM leave_request_days;DELETE FROM leave_requests;DELETE FROM leave_balance_events;DELETE FROM leave_year_balances;');
  await db.query("INSERT INTO leave_year_balances(employee_id,balance_year,origin,granted_days,remaining_days,consumed_days,effective_from,expires_on) VALUES('employee-employee',2026,'ANNUAL_GRANT',12,0,12,'2026-01-01','2027-04-01')");
 };
 const balance=async()=>JSON.stringify(await db.query('SELECT * FROM leave_year_balances ORDER BY employee_id,balance_year'));
 const form=(action,body)=>atomic(db=>publicLeaveForm(db,action,body,'fixture-'+randomUUID()));
 async function link(shared=true){const token=randomUUID().replaceAll('-','').repeat(2),id=randomUUID();await db.query(shared?'INSERT INTO leave_shared_form_links(id,token_hash,share_token,created_by,expires_at) VALUES($1,$2,$3,$4,now()+interval \'1 day\')':'INSERT INTO leave_form_links(id,token_hash,employee_id,created_by,expires_at) VALUES($1,$2,$3,$4,now()+interval \'1 day\')',[id,await formDigest(token),shared?token:'employee-employee',actors.boss.id]);return token;}
 return {pg,db,actors,atomic,route,row,decide,reset,balance,form,link};
}
