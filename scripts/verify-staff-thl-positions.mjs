// Isolated PostgreSQL fixture; no production connection or employee data.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const modulePath=process.argv[2];
if(!modulePath)throw new Error('Supply the PGlite module path.');
const {PGlite}=await import(pathToFileURL(resolve(modulePath)).href),pg=new PGlite();
const sql=readFileSync(new URL('../supabase/setup/separate-staff-thl-positions.sql',import.meta.url),'utf8');
try{
  await pg.exec(`CREATE SCHEMA portal;
    CREATE TABLE portal.org_units(id text PRIMARY KEY,code text UNIQUE);
    CREATE TABLE portal.positions(id text PRIMARY KEY,code text UNIQUE,name text,org_unit_id text REFERENCES portal.org_units(id),is_active integer,created_at text,updated_at text,row_version integer);
    CREATE TABLE portal.employees(id text PRIMARY KEY,employment_status text,updated_at text,row_version integer);
    CREATE TABLE portal.employee_placements(id text PRIMARY KEY,employee_id text REFERENCES portal.employees(id),position_id text REFERENCES portal.positions(id),is_primary integer,valid_from text,valid_to text,supervisor_employee_id text,updated_at text,row_version integer);
    CREATE TABLE portal.audit_events(id text PRIMARY KEY,action text,object_type text,object_key text,occurred_at text,outcome text,request_id text,reason text,change_summary text,created_at text,updated_at text,row_version integer);
    INSERT INTO portal.org_units VALUES('fixture-unit','BPB_PLK');`);
  const suffixes=['Kebersihan Lingkungan','Kebersihan Bangunan','Pertamanan','Pengolahan Sampah'];
  for(const [index,suffix]of suffixes.entries()){
    const code=`BPB_PLK_P08${index}`,position=`fixture-position-${index}`;
    await pg.query('INSERT INTO portal.positions VALUES($1,$2,$3,$4,1,$5,$5,2)',[position,code,`Staf dan THL ${suffix}`,'fixture-unit','before']);
    for(const kind of ['STAF','THL']){
      const employee=`fixture-${index}-${kind}`;
      await pg.query('INSERT INTO portal.employees VALUES($1,$2,$3,1)',[employee,kind==='STAF'?'Pegawai Kontrak (PKWT)':'Tenaga Harian Lepas','before']);
      await pg.query('INSERT INTO portal.employee_placements VALUES($1,$2,$3,1,$4,NULL,$5,$6,1)',[`placement-${employee}`,employee,position,'2023-01-01','fixture-supervisor','before']);
    }
  }
  await pg.exec("INSERT INTO portal.employee_placements VALUES('fixture-history','fixture-0-THL','fixture-position-0',1,'2020-01-01','2022-12-31','old-supervisor','before',1)");
  await pg.exec("UPDATE portal.employees SET employment_status='Belum ditetapkan' WHERE id='fixture-0-STAF'");
  await assert.rejects(pg.exec(sql),/Status kerja/);await pg.exec('ROLLBACK');
  assert.equal((await pg.query('SELECT count(*)::int n FROM portal.positions')).rows[0].n,4);
  assert.equal((await pg.query('SELECT count(*)::int n FROM portal.audit_events')).rows[0].n,0);
  console.log('PASS unknown employment status rolls back the entire correction');
  await pg.exec("UPDATE portal.employees SET employment_status='Pegawai Kontrak (PKWT)' WHERE id='fixture-0-STAF'");
  const before=(await pg.query('SELECT id,employee_id,valid_from,valid_to,supervisor_employee_id FROM portal.employee_placements ORDER BY id')).rows;
  await pg.exec(sql);
  const positions=(await pg.query('SELECT * FROM portal.positions')).rows;
  assert.equal(positions.filter(p=>p.is_active===1).length,8);assert.equal(positions.filter(p=>p.is_active===0).length,4);
  for(const suffix of suffixes)for(const kind of ['Staf','THL'])assert(positions.some(p=>p.name===`${kind} ${suffix}`&&p.is_active===1));
  console.log('PASS four combined positions become eight separate active Staf and THL positions');
  const placements=(await pg.query('SELECT ep.id,p.name,e.employment_status,ep.row_version FROM portal.employee_placements ep JOIN portal.positions p ON p.id=ep.position_id JOIN portal.employees e ON e.id=ep.employee_id WHERE ep.valid_to IS NULL')).rows;
  assert.equal(placements.length,8);
  for(const placement of placements){assert(placement.name.startsWith(placement.employment_status==='Tenaga Harian Lepas'?'THL ':'Staf '));assert.equal(placement.row_version,2);}
  assert.deepEqual((await pg.query('SELECT id,employee_id,valid_from,valid_to,supervisor_employee_id FROM portal.employee_placements ORDER BY id')).rows,before);
  assert.equal((await pg.query("SELECT position_id FROM portal.employee_placements WHERE id='fixture-history'")).rows[0].position_id,'fixture-position-0');
  assert((await pg.query('SELECT row_version FROM portal.employees')).rows.every(e=>e.row_version===2));
  console.log('PASS current placements match employment status while dates, supervisors and closed history remain intact');
  assert.equal((await pg.query('SELECT count(*)::int n FROM portal.audit_events')).rows[0].n,20);
  const snapshot=async()=>JSON.stringify((await pg.query("SELECT jsonb_build_object('positions',(SELECT jsonb_agg(p ORDER BY id) FROM portal.positions p),'placements',(SELECT jsonb_agg(p ORDER BY id) FROM portal.employee_placements p),'employees',(SELECT jsonb_agg(e ORDER BY id) FROM portal.employees e),'audit',(SELECT jsonb_agg(a ORDER BY id) FROM portal.audit_events a)) snapshot")).rows);
  const first=await snapshot();await pg.exec(sql);assert.equal(await snapshot(),first);
  console.log('PASS correction is audited and reruns without duplicates or version changes');
}finally{await pg.close();}
