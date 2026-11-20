// Verifikasi stok Display & Gudang, pindah stok, dan pembayaran CARD (modul Bisnis)
// di PostgreSQL sementara (PGlite).
//
//   node scripts/verify-merchandise-postgres.mjs [pglite/dist/index.js] [snapshot-lama.ts]
//
// Memeriksa urutan rilis yang sebenarnya:
//   1. sebelum migrasi: gateway lama (bila snapshot lama diberikan) bekerja seperti biasa;
//   2. migrasi 20261120090000: kolom/batasan baru, data lama utuh (stok lama = display,
//      riwayat lama = DISPLAY), batasan lama benar-benar terganti, aman dijalankan dua kali,
//      RLS tetap aktif tanpa grant ke klien;
//   3. gateway lama SESUDAH migrasi tetap bekerja (migrasi dijalankan lebih dulu);
//   4. snapshot portal-api yang sudah ditambal (supabase/deploy/portal-api/index.ts):
//      hitung awal gudang, barang masuk ke gudang, pindah dua arah, koreksi per lokasi,
//      penjualan hanya dari display, CARD, pembatalan, ringkasan beranda, riwayat sejak
//      tanggal awal WITA, serta penolakan nilai yang tidak sah oleh database.
// Snapshot lama, mis.: git show <commit-rilis>:supabase/deploy/portal-api/index.ts > /tmp/lama.ts
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {insert,one,all,now} from '../supabase/functions/_shared/portal/db.mjs';

const MIGRATION='20261120090000_merchandise_stock_locations_card.sql';
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2]||'/tmp/pglite/node_modules/@electric-sql/pglite/dist/index.js')).href);
const oldSnapshot=process.argv[3]?readFileSync(resolve(process.argv[3]),'utf8'):null;
const pg=new PGlite();let checks=0;
const check=async(name,work)=>{await work();console.log('PASS '+name);checks++;};
const cronShim=`CREATE SCHEMA IF NOT EXISTS cron;CREATE TABLE IF NOT EXISTS cron.job(jobid bigserial PRIMARY KEY,jobname text UNIQUE,schedule text NOT NULL,command text NOT NULL);
CREATE OR REPLACE FUNCTION cron.schedule(job_name text,schedule text,command text) RETURNS bigint LANGUAGE sql AS $shim$ INSERT INTO cron.job(jobname,schedule,command) VALUES(job_name,schedule,command) ON CONFLICT(jobname) DO UPDATE SET schedule=EXCLUDED.schedule,command=EXCLUDED.command RETURNING jobid $shim$;`;
const pgliteSql=sql=>sql.replace(/^\s*CREATE EXTENSION IF NOT EXISTS pg_cron\b[^;]*;\s*$/im,cronShim).replace(/^\s*COMMENT ON EXTENSION pg_cron\b[^;]*;\s*$/im,'');
const bootstrapSql=`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,encrypted_password text);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id));CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO authenticated;`;
const shim=source=>source.replace('import { withSupabase } from "npm:@supabase/server@1";','const withSupabase=(mode,handler)=>handler;').replace('import postgres from "npm:postgres@3.4.7";','const postgres=()=>{throw new Error("no database in fixture")};');
const load=async source=>import(`data:text/javascript;base64,${Buffer.from(shim(source)+'\nexport {routeOperation,AppError};').toString('base64')}`);

try{
  await pg.exec(bootstrapSql);
  const directory=new URL('../supabase/migrations/',import.meta.url),migration=pgliteSql(readFileSync(new URL(MIGRATION,directory),'utf8'));
  for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')&&n!==MIGRATION).sort())await pg.exec(pgliteSql(readFileSync(new URL(name,directory),'utf8')));
  await pg.exec('SET search_path=portal,pg_catalog');
  let inTx=false;
  const db={inTransaction:true,query:async(statement,args=[])=>{const result=await pg.query(statement,args);return Object.assign(result.rows,{count:result.affectedRows??result.rows.length});}};
  const atomic=async work=>{assert(!inTx,'nested transaction');await pg.exec('BEGIN');inTx=true;try{const result=await work();await pg.exec('COMMIT');return result;}catch(error){await pg.exec('ROLLBACK');throw error;}finally{inTx=false;}};
  globalThis.Deno={env:{toObject:()=>({SUPABASE_DB_URL:'postgresql://fixture:fixture@localhost/fixture'})}};
  globalThis.fetch=async url=>{throw new Error('Unexpected network call '+url);};
  const account=async(name,roleCode)=>{
    const id=randomUUID();await pg.query('INSERT INTO auth.users(id) VALUES($1)',[id]);
    const user=await insert(db,'users',{id,username:name,must_change_password:0,status:'ACTIVE',password_changed_at:now()});
    await insert(db,'user_roles',{user_id:id,role_id:(await one(db,'SELECT id FROM roles WHERE code=?',roleCode)).id,scope_kind:'ALL'});return user;
  };
  const manager=await account('manager','BISNIS_MANAGER'),coordinator=await account('koordinator','BISNIS_KOORDINATOR'),cashier=await account('petugas','BISNIS_PETUGAS');
  const product=async(sku,name)=>(await insert(db,'merchandise_products',{sku,name,buy_price:60000,sell_price:90000,stock_qty:null,is_active:1})).id;
  const [flashdisk,payung,kaos]=[await product('MER-001','FLASHDISK'),await product('MER-002','PAYUNG BESAKIH HITAM'),await product('MER-003','KAOS')];
  const portalWith=api=>async(user,path,method='GET',body={},query='')=>atomic(()=>api.routeOperation({db,user:{...user,request_id:randomUUID()},path,method,body,query}));
  const version=async id=>(await one(db,'SELECT row_version FROM merchandise_products WHERE id=?',id)).row_version;
  const stockOf=async id=>{const r=await one(db,'SELECT stock_qty,warehouse_qty FROM merchandise_products WHERE id=?',id);return [r.stock_qty,r.warehouse_qty];};
  const denied=(api,promise,status,pattern)=>assert.rejects(promise,error=>{assert(error instanceof api.AppError,String(error?.stack||error));assert.equal(error.status,status,error.message);if(pattern)assert.match(error.message,pattern);return true;});
  const pgRejects=(sql,args,pattern=/violates check constraint/)=>assert.rejects(pg.query(sql,args),pattern);

  let legacy=null;
  if(oldSnapshot){
    legacy=await load(oldSnapshot);const old=portalWith(legacy);
    await check('before the migration the released gateway sells and records stock as usual',async()=>{
      await old(cashier,`merchandise/products/${flashdisk}/stock`,'POST',{kind:'INITIAL',quantity:5,reason:'Opname awal',row_version:await version(flashdisk)});
      const sale=await old(cashier,'merchandise/sales','POST',{payment_method:'LAINNYA',items:[{product_id:flashdisk,quantity:1}]});
      assert.equal(sale.total,90000);
      assert.equal((await one(db,'SELECT stock_qty FROM merchandise_products WHERE id=?',flashdisk)).stock_qty,4);
    });
  }else{
    // Tanpa snapshot lama: data sebelum migrasi ditulis dengan bentuk tabel lama.
    await pg.query('UPDATE merchandise_products SET stock_qty=5,row_version=row_version+1 WHERE id=$1',[flashdisk]);
    await insert(db,'merchandise_stock_movements',{product_id:flashdisk,kind:'INITIAL',quantity_delta:5,balance_before:null,balance_after:5,reason:'Opname awal',created_by:cashier.id});
  }
  const before=await all(db,'SELECT id,kind,quantity_delta,balance_after FROM merchandise_stock_movements ORDER BY created_at,id');
  await pgRejects("INSERT INTO portal.merchandise_sales(id,sale_no,sold_on,payment_method,status,total,cost_total,created_at,updated_at,row_version,created_by) VALUES($1,'X-0','2026-11-20','CARD','COMPLETED',0,0,'t','t',1,$2)",[randomUUID(),cashier.id]);

  await pg.exec(migration);
  await check('migration adds warehouse stock and locations, keeps old data, and replaces the old constraints',async()=>{
    const columns=async table=>(await all(db,"SELECT column_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='portal' AND table_name=? ORDER BY column_name",table));
    const warehouse=(await columns('merchandise_products')).find(c=>c.column_name==='warehouse_qty');
    assert(warehouse&&warehouse.is_nullable==='YES'&&warehouse.column_default===null,'warehouse_qty NULL = belum dihitung');
    const location=(await columns('merchandise_stock_movements')).find(c=>c.column_name==='location');
    assert(location&&location.is_nullable==='NO'&&/DISPLAY/.test(location.column_default));
    assert(oldSnapshot?(await stockOf(flashdisk))[0]===4:(await stockOf(flashdisk))[0]===5,'stok lama tetap, sekarang berarti display');
    assert.equal((await stockOf(flashdisk))[1],null);
    const after=await all(db,'SELECT id,kind,quantity_delta,balance_after,location FROM merchandise_stock_movements ORDER BY created_at,id');
    assert.deepEqual(after.map(({location,...rest})=>rest),[...before]);assert(after.every(m=>m.location==='DISPLAY'));
    const checks=async table=>(await all(db,"SELECT conname,pg_get_constraintdef(oid) def FROM pg_constraint WHERE conrelid=('portal.'||?)::regclass AND contype='c' ORDER BY conname",table));
    const kinds=(await checks('merchandise_stock_movements')).filter(c=>/\bkind\b/.test(c.def)),payments=(await checks('merchandise_sales')).filter(c=>/payment_method/.test(c.def));
    assert.equal(kinds.length,1);assert.match(kinds[0].def,/TRANSFER/);assert.equal(payments.length,1);assert.match(payments[0].def,/CARD/);
    const sale=['X-1','2026-11-20','COMPLETED',0,0,'t','t',1,cashier.id],insertSale=method=>pg.query("INSERT INTO portal.merchandise_sales(id,sale_no,sold_on,payment_method,status,total,cost_total,created_at,updated_at,row_version,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",[randomUUID(),randomUUID(),...sale.slice(1,2),method,...sale.slice(2)]);
    await insertSale('CARD');await assert.rejects(insertSale('KARTU'),/violates check constraint/);
    await pg.query("DELETE FROM portal.merchandise_sales WHERE payment_method='CARD'");
    const move=(kind,location,balance)=>pg.query("INSERT INTO portal.merchandise_stock_movements(id,product_id,kind,location,quantity_delta,balance_after,reason,created_at,updated_at,row_version,created_by) VALUES($1,$2,$3,$4,0,$5,'uji','t','t',1,$6)",[randomUUID(),kaos,kind,location,balance,cashier.id]);
    await assert.rejects(move('PINDAH','DISPLAY',0),/violates check constraint/);await assert.rejects(move('TRANSFER','RAK',0),/violates check constraint/);
    await assert.rejects(move('TRANSFER','GUDANG',-1),/violates check constraint/);
    await assert.rejects(pg.query('UPDATE portal.merchandise_products SET warehouse_qty=-1 WHERE id=$1',[kaos]),/violates check constraint/);
  });
  await check('migration is idempotent and keeps RLS without client grants',async()=>{
    await pg.exec(migration);
    assert.equal((await all(db,"SELECT conname FROM pg_constraint WHERE conrelid='portal.merchandise_sales'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%payment_method%'")).length,1);
    for(const table of ['merchandise_products','merchandise_sales','merchandise_sale_items','merchandise_stock_movements']){
      assert.equal((await pg.query("SELECT rowsecurity FROM pg_tables WHERE schemaname='portal' AND tablename=$1",[table])).rows[0].rowsecurity,true,table);
      for(const role of ['anon','authenticated','service_role'])assert.equal((await pg.query("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') allowed",[role,'portal.'+table])).rows[0].allowed,false);
    }
    assert((await one(db,"SELECT 1 ok FROM pg_indexes WHERE schemaname='portal' AND indexname='merchandise_stock_created_idx'")).ok);
  });
  if(legacy){
    const old=portalWith(legacy);
    await check('after the migration the released gateway still works (old rows default to DISPLAY)',async()=>{
      await old(cashier,`merchandise/products/${payung}/stock`,'POST',{kind:'INITIAL',quantity:3,reason:'Opname',row_version:await version(payung)});
      const sale=await old(cashier,'merchandise/sales','POST',{payment_method:'TUNAI',items:[{product_id:payung,quantity:1}]});
      await old(manager,`merchandise/sales/${sale.id}/void`,'POST',{reason:'Uji',row_version:1});
      assert.deepEqual(await stockOf(payung),[3,null]);
      assert((await all(db,'SELECT location FROM merchandise_stock_movements WHERE product_id=?',payung)).every(m=>m.location==='DISPLAY'));
      const overview=await old(cashier,'merchandise/overview');assert.equal(overview.products_total,3);
    });
  }

  const api=await load(readFileSync(new URL('../supabase/deploy/portal-api/index.ts',import.meta.url),'utf8')),portal=portalWith(api);
  const record=async(user,id,body)=>portal(user,`merchandise/products/${id}/stock`,'POST',{reason:'Uji',...body,row_version:await version(id)});
  await check('patched gateway: warehouse count, receipts, transfers both ways and per-location corrections',async()=>{
    const start=(await stockOf(flashdisk))[0];
    await denied(api,record(cashier,flashdisk,{kind:'TRANSFER',location:'DISPLAY',quantity:1}),409,/stok awal gudang/);
    const counted=await record(cashier,flashdisk,{kind:'INITIAL',location:'GUDANG',quantity:40,reason:'Hitung gudang'});
    assert.deepEqual([counted.stock_qty,counted.warehouse_qty],[start,40]);
    await record(cashier,flashdisk,{kind:'IN',location:'GUDANG',quantity:10});
    const moved=await record(cashier,flashdisk,{kind:'TRANSFER',location:'DISPLAY',quantity:6});
    assert.deepEqual([moved.stock_qty,moved.warehouse_qty],[start+6,44]);
    await record(cashier,flashdisk,{kind:'TRANSFER',location:'GUDANG',quantity:1});
    await denied(api,record(cashier,flashdisk,{kind:'ADJUST',location:'GUDANG',quantity:40}),403);
    await record(coordinator,flashdisk,{kind:'ADJUST',location:'GUDANG',quantity:44,reason:'Opname gudang'});
    assert.deepEqual(await stockOf(flashdisk),[start+5,44]);
    const tail=(await all(db,'SELECT kind,location,quantity_delta FROM merchandise_stock_movements WHERE product_id=? ORDER BY created_at,id',flashdisk)).slice(-7);
    assert.deepEqual(tail.map(m=>`${m.kind}:${m.location}:${m.quantity_delta}`).sort(),['ADJUST:GUDANG:-1','IN:GUDANG:10','INITIAL:GUDANG:40','TRANSFER:DISPLAY:-1','TRANSFER:DISPLAY:6','TRANSFER:GUDANG:-6','TRANSFER:GUDANG:1'].sort());
    const created=await portal(manager,'merchandise/products','POST',{sku:'MER-004',name:'TOPI',buy_price:1,sell_price:2});
    const both=await record(cashier,created.id,{kind:'INITIAL',quantity:2,warehouse_quantity:7});
    assert.deepEqual([both.stock_qty,both.warehouse_qty],[2,7]);
  });
  await check('patched gateway: sales only from display, CARD accepted, void returns to display',async()=>{
    const [display,gudang]=await stockOf(flashdisk);
    await denied(api,portal(cashier,'merchandise/sales','POST',{payment_method:'TUNAI',items:[{product_id:flashdisk,quantity:display+1}]}),409,new RegExp(`Gudang masih ${gudang}: catat "Pindah ke display" dulu`));
    const sale=await portal(cashier,'merchandise/sales','POST',{payment_method:'CARD',items:[{product_id:flashdisk,quantity:2}]});
    assert.equal((await one(db,'SELECT payment_method FROM merchandise_sales WHERE id=?',sale.id)).payment_method,'CARD');
    assert.deepEqual(await stockOf(flashdisk),[display-2,gudang]);
    await denied(api,portal(cashier,'merchandise/sales','POST',{payment_method:'KARTU',items:[{product_id:flashdisk,quantity:1}]}),422);
    await portal(manager,`merchandise/sales/${sale.id}/void`,'POST',{reason:'Uji batal',row_version:1});
    assert.deepEqual(await stockOf(flashdisk),[display,gudang]);
    const report=await portal(manager,'merchandise/reports','GET',{},'from=2000-01-01&to=2099-12-31');
    assert(report.stock.every(p=>'warehouse_qty' in p));assert(report.movements.every(m=>['DISPLAY','GUDANG'].includes(m.location)));
  });
  await check('patched gateway: home counts restock by total and display refill by warehouse',async()=>{
    await pg.query('UPDATE merchandise_products SET stock_qty=1,warehouse_qty=0,row_version=row_version+1 WHERE id=$1',[kaos]);
    await pg.query('UPDATE merchandise_products SET stock_qty=3,warehouse_qty=NULL,row_version=row_version+1 WHERE id=$1',[payung]);
    const r=await portal(cashier,'merchandise/overview');
    // FLASHDISK display>5; PAYUNG 3+gudang belum dihitung; KAOS 1+0; TOPI 2+7.
    assert.equal(r.products_low,2);assert.equal(r.products_display_low,1);assert.equal(r.products_warehouse_uncounted,1);
  });
  await check('patched gateway: export ledger returns every movement since 00:00 WITA of the start date',async()=>{
    const all2=(await portal(cashier,'merchandise/stock')).items;
    const target=all2[all2.length-1];
    await pg.query("UPDATE merchandise_stock_movements SET created_at='2026-10-31T15:59:59.999Z' WHERE id=$1",[target.id]);
    const since=await portal(cashier,'merchandise/stock','GET',{},'from=2026-11-01');
    assert.equal(since.items.length,all2.length-1);assert(!since.items.some(m=>m.id===target.id));assert.equal(since.limit,10000);
  });
  console.log(`OK ${checks} pemeriksaan merchandise PostgreSQL${oldSnapshot?' (termasuk gateway lama)':''}.`);
}finally{await pg.close();}
