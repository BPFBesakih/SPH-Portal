import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createLeaveFixture} from './helpers/leave-fixture.mjs';
import {LEAVE_TYPES,leaveRange} from '../public/leave-policy.js';
let f;
test.before(async()=>{f=await createLeaveFixture();});
test.beforeEach(async()=>{await f.reset();});
test.after(async()=>{await f?.pg.close();});
const body=(type,dates=['2026-12-01'])=>({leave_type:type,dates,reason:'Keperluan sesuai ketentuan / surat dokter',client_key:randomUUID()});
const datesFor=type=>Array.from({length:type.max_days},(_,i)=>new Date(Date.parse('2026-12-01')+i*86400000).toISOString().slice(0,10));

for(const type of LEAVE_TYPES.filter(t=>!t.deducts_balance))test(`${type.code}: zero annual balance, staged approval, calendar and cancellation never change the ledger`,async()=>{
 const before=await f.balance(),payload=body(type.code,datesFor(type));
 const preview=await f.route('employee','preview','POST',payload);assert.equal(preview.allocations.length,type.max_days);assert(preview.allocations.every(a=>a.balance_year===null));
 const result=await f.route('employee','','POST',payload);assert.equal((await f.row(result.id)).leave_type,type.code);
 assert.equal((await f.route('employee','','GET')).balances.find(b=>b.employee_id==='employee-employee').reserved_days,0);
 await assert.rejects(()=>f.decide('director',result.id),e=>e.status===403);
 await assert.rejects(()=>f.decide('boss',result.id,'approve',{verified_work_dates:false}),e=>e.status===422);
 await f.decide('boss',result.id);assert.equal((await f.row(result.id)).status,'PENDING');assert.equal(await f.balance(),before);
 await f.decide('director',result.id);assert.equal((await f.row(result.id)).status,'APPROVED');
 const own=await f.route('employee','','GET'),peer=await f.route('peer','','GET');
 assert.equal(own.requests[0].leave_type,type.code);assert.equal(peer.requests.length,0);assert(peer.calendar.length>0);assert(!JSON.stringify(peer.calendar).includes('leave_type'));assert(!JSON.stringify(peer.calendar).includes(payload.reason));
 await f.route('employee',result.id+'/cancel','POST',{row_version:(await f.row(result.id)).row_version,note:'Pembatalan pengujian'});
 await f.decide('boss',result.id,'approve-cancel');await f.decide('director',result.id,'approve-cancel');
 assert.equal((await f.row(result.id)).status,'CANCELLED');assert.equal(await f.balance(),before);assert.equal((await f.db.query('SELECT * FROM leave_balance_events')).length,0);
});

test('server validates all special durations, invalid types/dates, gaps and duplicate dates',async()=>{
 for(const type of LEAVE_TYPES.filter(t=>!t.deducts_balance))await assert.rejects(()=>f.route('employee','preview','POST',body(type.code,[...datesFor(type),'2027-03-01'])),/maksimal/);
 for(const type of ['OTHER','',{},['ANNUAL']])await assert.rejects(()=>f.route('employee','preview','POST',body(type)),/Jenis cuti/);
 for(const dates of [['2026-02-30'],['2026-11-01'],['2026-12-01','2026-12-01']])await assert.rejects(()=>f.route('employee','preview','POST',body('MARRIAGE',dates)));
 await assert.rejects(()=>f.route('employee','preview','POST',body('MATERNITY',['2026-12-01','2026-12-03'])),/berurutan/);
 assert.deepEqual(leaveRange('2026-02-30','2026-03-03'),[]);assert.equal(leaveRange('2028-02-28','2028-03-01').length,3);
 await assert.rejects(()=>f.route('thl','preview','POST',body('MARRIAGE')),e=>e.status===403);
});

test('retry keys bind the special type and rejection frees dates without balance effects',async()=>{
 const payload=body('CHILD_MARRIAGE'),r=await f.route('employee','','POST',payload);
 assert((await f.route('employee','','POST',payload)).duplicate);
 await assert.rejects(()=>f.route('employee','','POST',{...payload,leave_type:'WIFE_CHILDBIRTH'}),e=>e.status===409);
 await assert.rejects(()=>f.route('employee','','POST',body('MARRIAGE')),/sudah memiliki/);
 await f.decide('boss',r.id,'reject');assert.equal((await f.row(r.id)).status,'REJECTED');
 assert((await f.route('employee','preview','POST',body('MARRIAGE'))).allocations.every(a=>a.balance_year===null));
});

test('annual legacy payloads still reserve, consume and refund once; annual/special dates cannot overlap',async()=>{
 await f.db.query("UPDATE leave_year_balances SET remaining_days=12,consumed_days=0 WHERE employee_id='employee-employee'");
 const payload=body(undefined),r=await f.route('employee','','POST',payload);
 assert((await f.route('employee','','POST',{...payload,leave_type:'ANNUAL'})).duplicate);
 await assert.rejects(()=>f.route('employee','','POST',body('MARRIAGE')),/sudah memiliki/);
 assert.equal((await f.route('employee','','GET')).balances[0].reserved_days,1);
 await f.decide('boss',r.id);await f.decide('director',r.id);
 assert.equal((await f.db.query('SELECT remaining_days FROM leave_year_balances'))[0].remaining_days,11);
 await assert.rejects(()=>f.decide('director',r.id),e=>e.status===403);
 await f.route('employee',r.id+'/cancel','POST',{row_version:(await f.row(r.id)).row_version,note:'Pembatalan'});
 await f.decide('boss',r.id,'approve-cancel');await f.decide('director',r.id,'approve-cancel');
 assert.equal((await f.db.query('SELECT remaining_days FROM leave_year_balances'))[0].remaining_days,12);
 assert.equal((await f.db.query('SELECT * FROM leave_balance_events')).length,2);
});

test('personal and shared forms preserve special types, zero-balance access, idempotency and privacy',async()=>{
 for(const shared of [true,false]){
  await f.reset();const token=await f.link(shared),payload={token,...body('MARRIAGE'),...(shared?{employee_id:'employee-employee'}:{})};
  const context=await f.form('context',{token});if(shared){assert(context.shared);assert(!JSON.stringify(context).includes('available_days'));}else assert.equal(context.available_days,0);
  assert.equal((await f.form('preview',payload)).day_count,1);
  const receipt=await f.form('submit',payload);assert((await f.form('submit',payload)).duplicate);assert.equal((await f.row(receipt.reference)).leave_type,'MARRIAGE');
  await assert.rejects(()=>f.decide('boss',receipt.reference,'approve',{verified_identity:false}),e=>e.status===422);
  await f.decide('boss',receipt.reference);await f.decide('director',receipt.reference);
  assert.equal((await f.db.query('SELECT * FROM leave_balance_events')).length,0);
 }
});

test('database rejects special/annual allocation mismatches and retains RLS without direct grants',async()=>{
 const r=await f.route('employee','','POST',body('MARRIAGE'));
 await assert.rejects(()=>f.db.query('UPDATE leave_request_days SET balance_year=2026 WHERE request_id=$1',[r.id]),/leave_request_days_balance_kind/);
 await assert.rejects(()=>f.db.query("UPDATE leave_request_days SET leave_type='ANNUAL',balance_year=2026 WHERE request_id=$1",[r.id]),/leave_request_days_request_type_fkey/);
 await assert.rejects(()=>f.db.query('UPDATE leave_requests SET day_count=4 WHERE id=$1',[r.id]),/leave_requests_special_duration/);
 for(const table of ['leave_requests','leave_request_days']){
  assert.equal((await f.db.query("SELECT rowsecurity FROM pg_tables WHERE schemaname='portal' AND tablename=$1",[table]))[0].rowsecurity,true);
  for(const role of ['anon','authenticated','service_role'])assert.equal((await f.db.query("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') ok",[role,'portal.'+table]))[0].ok,false);
 }
});


test('shipped gateway runs special leave through its isolated handler',async()=>{
 const source=readFileSync(new URL('../supabase/deploy/portal-api/index.ts',import.meta.url),'utf8');
 const start=source.indexOf('// BEGIN SPECIAL LEAVE MODULE'),end=source.indexOf('// END SPECIAL LEAVE MODULE');
 assert(start>=0&&end>start,'Expected isolated leave module in the shipped gateway');
 const handler=new Function('crypto',source.slice(start,end)+';return __specialLeave.leaveRoutes;')(webcrypto);
 const shipped=await createLeaveFixture(handler);
 try{
  await shipped.reset();const before=await shipped.balance();
  const r=await shipped.route('employee','','POST',body('MARRIAGE'));
  await shipped.decide('boss',r.id);await shipped.decide('director',r.id);
  assert.equal((await shipped.row(r.id)).status,'APPROVED');
  assert.equal(await shipped.balance(),before);assert.equal((await shipped.db.query('SELECT * FROM leave_balance_events')).length,0);
 }finally{await shipped.pg.close();}
});
