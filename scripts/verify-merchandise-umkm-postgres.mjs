// Verifikasi barang titipan UMKM (modul Bisnis) di PostgreSQL sementara (PGlite).
//
//   node scripts/verify-merchandise-umkm-postgres.mjs [pglite/dist/index.js] [snapshot-lama.ts]
//
// Memeriksa urutan rilis yang sebenarnya:
//   1. sebelum migrasi: gateway lama (bila snapshot lama diberikan) bekerja seperti biasa;
//   2. migrasi 20261125090000: tabel mitra/dokumen baru ber-RLS tanpa grant ke klien, kolom
//      UMKM baru kosong untuk data lama, jenis mutasi TAKEOUT, izin merchandise.umkm.* untuk
//      template role Bisnis, aman dijalankan dua kali, dan syarat health portal-api tetap
//      terpenuhi (semua tabel portal ber-RLS);
//   3. gateway lama SESUDAH migrasi tetap bekerja (migrasi dijalankan lebih dulu);
//   4. snapshot portal-api yang sudah ditambal (supabase/deploy/portal-api/index.ts): mitra,
//      terima barang dengan harga +20% dibulatkan, penjualan campuran, takeout, koreksi
//      dengan tanggungan, pembatalan dokumen dan transaksi, serta data laporan.
// Snapshot lama, mis.: git show <commit-rilis>:supabase/deploy/portal-api/index.ts > /tmp/lama.ts
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {insert,one,all,now,today} from '../supabase/functions/_shared/portal/db.mjs';

const MIGRATION='20261125090000_merchandise_umkm.sql';
const {PGlite}=await import(process.argv[2]?pathToFileURL(resolve(process.argv[2])).href:'@electric-sql/pglite');
const oldSnapshot=process.argv[3]?readFileSync(resolve(process.argv[3]),'utf8'):null;
const pg=new PGlite();let checks=0;
const check=async(name,work)=>{await work();console.log('PASS '+name);checks++;};
const cronShim=`CREATE SCHEMA IF NOT EXISTS cron;CREATE TABLE IF NOT EXISTS cron.job(jobid bigserial PRIMARY KEY,jobname text UNIQUE,schedule text NOT NULL,command text NOT NULL);
CREATE OR REPLACE FUNCTION cron.schedule(job_name text,schedule text,command text) RETURNS bigint LANGUAGE sql AS $shim$ INSERT INTO cron.job(jobname,schedule,command) VALUES(job_name,schedule,command) ON CONFLICT(jobname) DO UPDATE SET schedule=EXCLUDED.schedule,command=EXCLUDED.command RETURNING jobid $shim$;`;
const pgliteSql=sql=>sql.replace(/^\s*CREATE EXTENSION IF NOT EXISTS pg_cron\b[^;]*;\s*$/im,cronShim).replace(/^\s*COMMENT ON EXTENSION pg_cron\b[^;]*;\s*$/im,'');
const bootstrapSql=`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,encrypted_password text);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id));CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO authenticated;`;
const shim=source=>source.replace('import { withSupabase } from "npm:@supabase/server@1";','const withSupabase=(mode,handler)=>handler;').replace('import postgres from "npm:postgres@3.4.7";','const postgres=()=>{throw new Error("no database in fixture")};');
const load=async source=>import(`data:text/javascript;base64,${Buffer.from(shim(source)+'\nexport {routeOperation,AppError};').toString('base64')}`);
const previousMonth=()=>{const [y,m]=today().split('-').map(Number);return (m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,'0')}`)+'-15';};

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
  const manager=await account('manager','BISNIS_MANAGER'),coordinator=await account('koordinator','BISNIS_KOORDINATOR');
  const leader=await account('pimpinan','BISNIS_PIMPINAN'),cashier=await account('petugas','BISNIS_PETUGAS');
  const kaos=(await insert(db,'merchandise_products',{sku:'MER-001',name:'KAOS',buy_price:60000,sell_price:90000,stock_qty:null,is_active:1})).id;
  const portalWith=api=>async(user,path,method='GET',body={},query='')=>atomic(()=>api.routeOperation({db,user:{...user,request_id:randomUUID()},path,method,body,query}));
  const version=async id=>(await one(db,'SELECT row_version FROM merchandise_products WHERE id=?',id)).row_version;
  const stockOf=async id=>{const r=await one(db,'SELECT stock_qty,warehouse_qty FROM merchandise_products WHERE id=?',id);return [r.stock_qty,r.warehouse_qty];};
  const denied=(api,promise,status,pattern)=>assert.rejects(promise,error=>{assert(error instanceof api.AppError,String(error?.stack||error));assert.equal(error.status,status,error.message);if(pattern)assert.match(error.message,pattern);return true;});
  const healthy=async()=>{const r=await one(db,"SELECT count(*)::integer total,count(*) FILTER(WHERE rowsecurity)::integer protected FROM pg_catalog.pg_tables WHERE schemaname='portal'");return r.total>=65&&r.protected===r.total;};

  let legacy=null;
  if(oldSnapshot){
    legacy=await load(oldSnapshot);const old=portalWith(legacy);
    await check('before the migration the released gateway sells and records stock as usual',async()=>{
      await old(cashier,`merchandise/products/${kaos}/stock`,'POST',{kind:'INITIAL',quantity:5,warehouse_quantity:2,reason:'Opname awal',row_version:await version(kaos)});
      const sale=await old(cashier,'merchandise/sales','POST',{payment_method:'CARD',items:[{product_id:kaos,quantity:1}]});
      assert.equal(sale.total,90000);assert.deepEqual(await stockOf(kaos),[4,2]);
    });
  }else{
    await pg.query('UPDATE merchandise_products SET stock_qty=4,warehouse_qty=2,row_version=row_version+1 WHERE id=$1',[kaos]);
    await insert(db,'merchandise_stock_movements',{product_id:kaos,kind:'INITIAL',location:'DISPLAY',quantity_delta:4,balance_before:null,balance_after:4,reason:'Opname awal',created_by:cashier.id});
  }
  const before=await all(db,'SELECT id,kind,location,quantity_delta,balance_after FROM merchandise_stock_movements ORDER BY created_at,id');
  await assert.rejects(pg.query("INSERT INTO portal.merchandise_stock_movements(id,product_id,kind,location,quantity_delta,balance_after,reason,created_at,updated_at,row_version,created_by) VALUES($1,$2,'TAKEOUT','DISPLAY',0,0,'uji','t','t',1,$3)",[randomUUID(),kaos,cashier.id]),/violates check constraint/);

  await pg.exec(migration);
  await check('migration adds UMKM partners, documents, columns, TAKEOUT and keeps old data',async()=>{
    const columns=async table=>(await all(db,"SELECT column_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='portal' AND table_name=? ORDER BY column_name",table)).map(c=>c.column_name);
    assert((await columns('merchandise_products')).includes('umkm_partner_id'));
    for(const c of ['umkm_partner_id','umkm_partner_name','umkm_markup_pct'])assert((await columns('merchandise_sale_items')).includes(c),c);
    for(const c of ['umkm_doc_id','unit_cost','umkm_loss_borne_by'])assert((await columns('merchandise_stock_movements')).includes(c),c);
    for(const table of ['merchandise_umkm_partners','merchandise_umkm_docs','merchandise_umkm_doc_items'])assert((await columns(table)).length>5,table);
    assert.equal((await one(db,'SELECT umkm_partner_id FROM merchandise_products WHERE id=?',kaos)).umkm_partner_id,null);
    const after=await all(db,'SELECT id,kind,location,quantity_delta,balance_after FROM merchandise_stock_movements ORDER BY created_at,id');
    assert.deepEqual(after,before);
    const kinds=(await all(db,"SELECT pg_get_constraintdef(oid) def FROM pg_constraint WHERE conrelid='portal.merchandise_stock_movements'::regclass AND contype='c'")).filter(c=>/\bkind\b/.test(c.def));
    assert.equal(kinds.length,1);assert.match(kinds[0].def,/TAKEOUT/);assert.match(kinds[0].def,/TRANSFER/);
    const move=(fields)=>pg.query(`INSERT INTO portal.merchandise_stock_movements(id,product_id,kind,location,quantity_delta,balance_after,reason,created_at,updated_at,row_version,created_by,umkm_loss_borne_by,unit_cost) VALUES($1,$2,$3,'DISPLAY',0,0,'uji','t','t',1,$4,$5,$6)`,[randomUUID(),kaos,fields.kind,cashier.id,fields.borne??null,fields.cost??null]);
    await assert.rejects(move({kind:'ADJUST',borne:'KANTOR'}),/violates check constraint/);
    await assert.rejects(move({kind:'ADJUST',cost:-1}),/violates check constraint/);
    await assert.rejects(pg.query("INSERT INTO portal.merchandise_umkm_docs(id,doc_no,kind,partner_id,doc_date,counterpart_name,created_at,updated_at,row_version,created_by) VALUES($1,'X','RETUR',$2,'2026-11-25','x','t','t',1,$3)",[randomUUID(),randomUUID(),cashier.id]),/violates check constraint|violates foreign key/);
  });
  await check('migration grants merchandise.umkm.* to Bisnis role templates only, keeps RLS, and is idempotent',async()=>{
    await pg.exec(migration);
    const grants=await all(db,"SELECT r.code,p.code permission FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE p.code LIKE 'merchandise.umkm.%' ORDER BY r.code,p.code");
    assert.deepEqual(grants.map(g=>g.code+':'+g.permission),['BISNIS_KOORDINATOR:merchandise.umkm.read','BISNIS_KOORDINATOR:merchandise.umkm.receive','BISNIS_MANAGER:merchandise.umkm.read','BISNIS_MANAGER:merchandise.umkm.receive','BISNIS_PIMPINAN:merchandise.umkm.read']);
    for(const table of ['merchandise_umkm_partners','merchandise_umkm_docs','merchandise_umkm_doc_items']){
      assert.equal((await pg.query("SELECT rowsecurity FROM pg_tables WHERE schemaname='portal' AND tablename=$1",[table])).rows[0].rowsecurity,true,table);
      for(const role of ['anon','authenticated','service_role'])assert.equal((await pg.query("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') allowed",[role,'portal.'+table])).rows[0].allowed,false);
    }
    assert(await healthy(),'semua tabel portal ber-RLS: health portal-api tetap sehat');
    assert.equal((await all(db,"SELECT conname FROM pg_constraint WHERE conrelid='portal.merchandise_stock_movements'::regclass AND contype='c' AND pg_get_constraintdef(oid) ~ '\\mkind\\M'")).length,1);
  });
  if(legacy){
    const old=portalWith(legacy);
    await check('after the migration the released gateway still sells, records stock, voids and reports',async()=>{
      await old(cashier,`merchandise/products/${kaos}/stock`,'POST',{kind:'TRANSFER',location:'DISPLAY',quantity:1,reason:'Isi display',row_version:await version(kaos)});
      const sale=await old(cashier,'merchandise/sales','POST',{payment_method:'TUNAI',items:[{product_id:kaos,quantity:2}]});
      await old(manager,`merchandise/sales/${sale.id}/void`,'POST',{reason:'Uji',row_version:1});
      assert.deepEqual(await stockOf(kaos),[5,1]);
      assert.equal((await old(cashier,'merchandise/overview')).products_total,1);
      assert((await old(manager,'merchandise/reports','GET',{},'from=2000-01-01&to=2099-12-31')).stock.length===1);
    });
  }

  const api=await load(readFileSync(new URL('../supabase/deploy/portal-api/index.ts',import.meta.url),'utf8')),portal=portalWith(api);
  const sku=async code=>(await one(db,'SELECT * FROM merchandise_products WHERE sku=?',code));
  let kopi;
  await check('patched gateway: partners and receipts with +20% rounded prices, generated SKUs and documents',async()=>{
    await denied(api,portal(cashier,'merchandise/umkm/partners'),403);
    kopi=await portal(coordinator,'merchandise/umkm/partners','POST',{code:'kopi',name:'Kopi Kintamani',owner_name:'Ni Made Sari',phone:'081234567890'});
    await denied(api,portal(coordinator,'merchandise/umkm/partners','POST',{code:'KOPI',name:'Lain'}),409,/sudah dipakai/);
    await denied(api,portal(leader,'merchandise/umkm/receipts','POST',{partner_id:kopi.id,counterpart_name:'Ni Made',items:[{name:'X',umkm_price:1000,quantity:1}]}),403);
    const doc=await portal(coordinator,'merchandise/umkm/receipts','POST',{partner_id:kopi.id,counterpart_name:'Ni Made',items:[
      {name:'Kopi Bubuk',umkm_price:12500,quantity:10},{name:'Kopi Biji',umkm_price:13000,quantity:4,location:'GUDANG'},{name:'Gula Aren',umkm_price:2700,quantity:6}]});
    const [a,b,c]=[await sku('UMKM-KOPI-01'),await sku('UMKM-KOPI-02'),await sku('UMKM-KOPI-03')];
    assert.deepEqual([a.sell_price,b.sell_price,c.sell_price],[15000,16000,3300]);
    assert.deepEqual([a.stock_qty,a.warehouse_qty,b.stock_qty,b.warehouse_qty],[10,0,0,4]);
    const detail=await portal(leader,`merchandise/umkm/docs/${doc.id}`);
    assert.deepEqual(detail.items.map(i=>[i.line_no,i.sku,i.quantity,i.unit_cost]),[[1,'UMKM-KOPI-01',10,12500],[2,'UMKM-KOPI-02',4,13000],[3,'UMKM-KOPI-03',6,2700]]);
    assert.deepEqual([detail.partner.code,detail.partner_name,detail.actor_name],['KOPI','Kopi Kintamani','koordinator']);
    const partners=(await portal(leader,'merchandise/umkm/partners')).items;
    assert.deepEqual(partners.map(p=>[p.code,p.product_count,p.stock_total]),[['KOPI',3,20]]);
    assert.equal((await portal(coordinator,'merchandise/umkm/docs','GET',{},'from=2000-01-01&to=2099-12-31')).items.length,1);
    const overview=await portal(coordinator,'merchandise/overview');
    assert.deepEqual([overview.capabilities.umkm_read,overview.capabilities.umkm_receive],[true,true]);
  });
  await check('patched gateway: UMKM stock only via receipts/takeouts, corrections need a liability answer',async()=>{
    const item=await sku('UMKM-KOPI-02');
    const record=async(user,body)=>portal(user,`merchandise/products/${item.id}/stock`,'POST',{reason:'Uji',...body,row_version:await version(item.id)});
    await denied(api,record(manager,{kind:'IN',location:'GUDANG',quantity:1}),409,/Terima barang/);
    await record(cashier,{kind:'TRANSFER',location:'DISPLAY',quantity:3});
    await denied(api,record(coordinator,{kind:'ADJUST',location:'DISPLAY',quantity:2}),422,/ditanggung BP/);
    await record(coordinator,{kind:'ADJUST',location:'DISPLAY',quantity:2,loss_borne_by:'BP',reason:'Pecah'});
    const row=await one(db,"SELECT quantity_delta,unit_cost,umkm_loss_borne_by FROM merchandise_stock_movements WHERE product_id=? AND kind='ADJUST'",item.id);
    assert.deepEqual([row.quantity_delta,row.unit_cost,row.umkm_loss_borne_by],[-1,13000,'BP']);
    const report=await portal(manager,'merchandise/reports','GET',{},`from=${today()}&to=${today()}`);
    assert.deepEqual(report.umkm_losses.map(m=>[m.sku,m.quantity_delta,m.unit_cost,m.umkm_partner_name]),[['UMKM-KOPI-02',-1,13000,'Kopi Kintamani']]);
    assert(!(await portal(cashier,'merchandise/stock')).items.some(m=>'unit_cost' in m),'harga UMKM tidak bocor ke petugas');
  });
  await check('patched gateway: mixed sale snapshots the partner; month rule for voiding UMKM sales',async()=>{
    const item=await sku('UMKM-KOPI-01');
    const sale=await portal(cashier,'merchandise/sales','POST',{payment_method:'QRIS',items:[{product_id:item.id,quantity:2},{product_id:kaos,quantity:1}]});
    assert.equal(sale.total,2*15000+90000);
    const lines=await all(db,'SELECT sku,unit_cost,umkm_partner_id,umkm_partner_name,umkm_markup_pct FROM merchandise_sale_items WHERE sale_id=? ORDER BY sku',sale.id);
    assert.deepEqual(lines.map(l=>[l.sku,l.unit_cost,l.umkm_partner_id,l.umkm_partner_name,l.umkm_markup_pct]),[['MER-001',60000,null,null,null],['UMKM-KOPI-01',12500,kopi.id,'Kopi Kintamani',20]]);
    const seen=(await portal(cashier,'merchandise/products')).items.find(p=>p.sku==='UMKM-KOPI-01');
    assert.deepEqual([seen.umkm_partner_name,'buy_price' in seen],['Kopi Kintamani',false]);
    const old=await portal(cashier,'merchandise/sales','POST',{payment_method:'TUNAI',items:[{product_id:item.id,quantity:1}]});
    await pg.query('UPDATE merchandise_sales SET sold_on=$1 WHERE id=$2',[previousMonth(),old.id]);
    await denied(api,portal(manager,`merchandise/sales/${old.id}/void`,'POST',{reason:'Uji',row_version:1}),409,/dasar pembayaran Keuangan/);
    await portal(manager,`merchandise/sales/${sale.id}/void`,'POST',{reason:'Uji',row_version:1});
    assert.equal((await sku('UMKM-KOPI-01')).stock_qty,9);
  });
  await check('patched gateway: takeout limits, document voids, and UMKM price changes',async()=>{
    const item=await sku('UMKM-KOPI-03');
    const out=await portal(coordinator,'merchandise/umkm/takeouts','POST',{partner_id:kopi.id,counterpart_name:'Ni Made',reason:'TIDAK_LAKU',items:[{product_id:item.id,quantity:4}]});
    assert.equal((await sku('UMKM-KOPI-03')).stock_qty,2);
    await denied(api,portal(coordinator,'merchandise/umkm/takeouts','POST',{partner_id:kopi.id,counterpart_name:'Ni Made',reason:'RUSAK',items:[{product_id:item.id,quantity:3}]}),409,/hanya 2/);
    await denied(api,portal(cashier,'merchandise/umkm/takeouts','POST',{partner_id:kopi.id,counterpart_name:'Ni Made',reason:'RUSAK',items:[{product_id:item.id,quantity:1}]}),403);
    const voidDoc=async(user,id)=>portal(user,`merchandise/umkm/docs/${id}/void`,'POST',{reason:'Salah catat',row_version:(await one(db,'SELECT row_version FROM merchandise_umkm_docs WHERE id=?',id)).row_version});
    await denied(api,voidDoc(coordinator,out.id),403);
    await voidDoc(manager,out.id);
    assert.equal((await sku('UMKM-KOPI-03')).stock_qty,6);
    const receipt=(await one(db,"SELECT id FROM merchandise_umkm_docs WHERE kind='TERIMA'")).id;
    await denied(api,voidDoc(manager,receipt),409,/sudah terjual atau di-takeout/);
    const kopi1=await sku('UMKM-KOPI-01');
    const restock=await portal(coordinator,'merchandise/umkm/receipts','POST',{
      partner_id:kopi.id,counterpart_name:'Ni Made',items:[{product_id:kopi1.id,quantity:4}]
    });
    assert.equal((await sku('UMKM-KOPI-01')).stock_qty,13);
    await denied(api,voidDoc(manager,receipt),409,/sudah terjual atau di-takeout/);
    await voidDoc(manager,restock.id);
    assert.equal((await sku('UMKM-KOPI-01')).stock_qty,9);
    await portal(coordinator,'merchandise/umkm/receipts','POST',{
      partner_id:kopi.id,counterpart_name:'Ni Made',items:[{name:'Kopi Sachet',umkm_price:4167,quantity:1}]
    });
    assert.equal((await sku('UMKM-KOPI-04')).sell_price,5500);
    await denied(api,portal(manager,`merchandise/products/${kopi1.id}`,'PATCH',{sell_price:20000,row_version:kopi1.row_version}),422,/dihitung otomatis/);
    await denied(api,portal(coordinator,`merchandise/products/${kopi1.id}`,'PATCH',{buy_price:15000,row_version:kopi1.row_version}),403);
    const saved=await portal(manager,`merchandise/products/${kopi1.id}`,'PATCH',{buy_price:15000,row_version:await version(kopi1.id)});
    assert.deepEqual([saved.buy_price,saved.sell_price],[15000,18000]);
    await denied(api,portal(manager,'merchandise/products','POST',{sku:'UMKM-X-01',name:'X',buy_price:1,sell_price:2}),422,/Awalan UMKM-/);
    const exported=await portal(manager,'merchandise/stock-export','GET',{},`from=${today()}&to=${today()}`);
    assert(exported.stock.some(p=>p.umkm_partner_code==='KOPI')&&exported.movements.some(m=>m.kind==='TAKEOUT'&&m.umkm_partner_name==='Kopi Kintamani'));
    assert(await healthy());
  });
  await check('stock surplus offsets only matching losses at their original price',async()=>{
    const item=await sku('UMKM-KOPI-04');
    const adjust=async quantity=>portal(coordinator,`merchandise/products/${item.id}/stock`,'POST',{
      kind:'ADJUST',quantity,loss_borne_by:'BP',reason:'Opname',row_version:await version(item.id)
    });
    const losses=async()=> (await portal(manager,'merchandise/reports','GET',{},`from=${today()}&to=${today()}`))
      .umkm_losses.filter(m=>m.sku===item.sku);
    await adjust(3);
    assert.deepEqual(await losses(),[]);
    await adjust(2);
    await portal(manager,`merchandise/products/${item.id}`,'PATCH',{buy_price:6000,row_version:await version(item.id)});
    await adjust(5);
    assert.deepEqual((await losses()).map(m=>[m.quantity_delta,m.unit_cost]),[[-1,4167],[1,4167]]);
  });
  console.log(`OK ${checks} pemeriksaan barang UMKM PostgreSQL${oldSnapshot?' (termasuk gateway lama)':''}.`);
}finally{await pg.close();}
