// Database demo terpisah untuk mencoba modul Pengadaan di komputer sendiri.
// Data fiktif; ditolak dalam mode produksi dan tidak menimpa database yang sudah berisi akun.
// Pakai: node scripts/demo-pengadaan.mjs [folder-data]   (bawaan: data/demo-pengadaan)
import {resolve} from 'node:path';
import {openDb,insert,one,run,now,today} from '../lib/db.mjs';
import {seedPermissions,hashPasswordSync} from '../lib/auth.mjs';
import {purchasingRoutes} from '../lib/purchasing.mjs';
import {addDays} from '../lib/purchasing-rules.mjs';
if(process.env.NODE_ENV==='production')throw new Error('Data demo tidak boleh dipasang dalam mode produksi.');
const directory=resolve(process.argv[2]||'data/demo-pengadaan'),db=openDb(resolve(directory,'portal.sqlite'));
if(one(db,'SELECT id FROM users LIMIT 1')){console.log(`Database demo Pengadaan sudah ada: ${directory}`);db.close();process.exit(0);}
const PASSWORD='BesakihDemo!2026';
try{
  seedPermissions(db);run(db,"UPDATE app_settings SET value='true' WHERE key='demo_mode'");
  const hash=hashPasswordSync(PASSWORD),root=insert(db,'org_units',{code:'BPB',name:'Badan Pengelola Besakih',is_active:1});
  const unit=(code,name)=>insert(db,'org_units',{code,name,parent_id:root.id,is_active:1});
  const units={SEK:unit('SEK','Sekretariat'),OPS:unit('OPS','Bidang Operasional & Pelayanan'),UMM:unit('UMM','Urusan Umum'),KEU:unit('KEU','Urusan Keuangan'),SPI:unit('SPI','Satuan Pengawas Internal')};
  const people={};
  const person=(key,name,position,unitKey,supervisor=null)=>{
    const pos=insert(db,'positions',{code:`DEMO-PJ-${key.toUpperCase()}`,name:position,org_unit_id:units[unitKey].id,is_active:1});
    const e=insert(db,'employees',{employee_no:`DEMO-PJ-${String(Object.keys(people).length+1).padStart(2,'0')}`,full_name:`${name} (Demo)`,employment_status:'Tetap',joined_on:'2020-01-01',is_active:1});
    insert(db,'employee_placements',{employee_id:e.id,position_id:pos.id,supervisor_employee_id:supervisor?.id||null,valid_from:'2020-01-01',is_primary:1});
    return people[key]={...e,position_id:pos.id};
  };
  person('kaban','Made Wirawan','Kepala Badan Pengelola','SEK');
  person('sekban','Ketut Suardana','Sekretaris Badan Pengelola','SEK',people.kaban);
  person('kabid','Nyoman Arta','Kepala Bidang Operasional','OPS',people.sekban);
  person('pemohon','Putu Ayu Lestari','Staf Pelayanan','OPS',people.kabid);
  person('purchasing','Kadek Sukerta','Staf Purchasing','UMM',people.sekban);
  person('keuangan','Komang Sriani','Verifikator Keuangan','KEU',people.sekban);
  person('spi','Gede Mahardika','Pemeriksa SPI','SPI',people.kaban);
  person('plh','Wayan Sudira','Kepala Urusan Umum','UMM',people.sekban);
  const users={};
  const account=(username,roles,employee=null)=>{
    const u=insert(db,'users',{username,password_hash:hash,status:'ACTIVE',employee_id:employee?.id||null,must_change_password:0,failed_login_count:0,password_changed_at:now()});
    for(const [code,scope] of roles)insert(db,'user_roles',{user_id:u.id,role_id:one(db,'SELECT id FROM roles WHERE code=?',code).id,scope_kind:scope});
    return users[username]=u;
  };
  account('admin.demo',[['SUPER_ADMIN','ALL'],['PURCHASE_ADMIN','ALL']]);
  for(const key of ['pemohon','kabid','sekban','kaban','plh'])account(`${key}.demo`,[['PURCHASE_REQUESTER','SELF']],people[key]);
  account('purchasing.demo',[['PURCHASING_STAFF','ALL'],['PURCHASE_REQUESTER','SELF']],people.purchasing);
  account('keuangan.demo',[['FINANCE_VERIFIER','ALL']],people.keuangan);
  account('spi.demo',[['PURCHASE_AUDITOR','ALL']],people.spi);

  const call=(user,path,method='GET',body={})=>purchasingRoutes({db,user:{...user},p:['purchasing',...path.split('/')],method,body,url:new URL('http://demo.invalid/')});
  const admin=users['admin.demo'],finance=users['keuangan.demo'],buyer=users['purchasing.demo'];
  await call(admin,'settings','PATCH',{reason:'Data demo',settings:{officials:{sekban_position_id:people.sekban.position_id,kaban_position_id:people.kaban.position_id},unit_codes:{[units.OPS.id]:'OPS',[units.UMM.id]:'UMUM'},organization:{address:'Jalan Raya Besakih, Rendang, Karangasem, Bali (alamat contoh)'}}});
  const year=Number(today().slice(0,4)),by=await call(finance,'budget/years','POST',{year});
  const bhp=await call(finance,'budget/lines','POST',{budget_year_id:by.id,code:'BHP',name:'Belanja barang habis pakai',ceiling:25000000});
  await call(finance,'budget/lines','POST',{budget_year_id:by.id,code:'PML',name:'Pemeliharaan sarana dan prasarana',org_unit_id:units.OPS.id,ceiling:60000000});
  const vendor=(name,extra)=>call(buyer,'vendors','POST',{name,address:'Karangasem, Bali',phone:'0812-0000-0000',bank_name:'Bank Contoh',account_name:name,...extra});
  await vendor('Toko ATK Sari Amerta (Demo)',{leader_name:'I Made Sari',leader_title:'Pemilik',account_no:'0011223344'});
  await vendor('CV Karya Besakih (Demo)',{leader_name:'I Ketut Karya',leader_title:'Direktur',leader_nik:'5107010101800001',account_no:'0099887766'});
  await vendor('UD Bangunan Rendang (Demo)',{leader_name:'Ni Luh Rendang',leader_title:'Pemilik',account_no:'0055667788'});

  const needed=addDays(today(),10),pemohon=users['pemohon.demo'];
  const decide=async(user,pr,extra={})=>{const view=await call(user,`requests/${pr.id}`);return call(user,`requests/${pr.id}/decide`,'POST',{step_id:view.actions.step.id,row_version:view.row_version,action:'APPROVE',...extra});};
  // 1. Menunggu atasan (Kabid).
  await call(pemohon,'requests','POST',{needed_on:needed,items:[{description:'Map plastik snelhecter biru',item_kind:'GOODS',quantity:'2',unit:'pak',unit_price:45000,reason:'Arsip layanan pengunjung'},{description:'Pulpen gel hitam 0,5 mm',item_kind:'GOODS',quantity:'3',unit:'kotak',unit_price:60000,reason:'Stok meja layanan'}]});
  // 2. Sudah disetujui penuh dan diterima Purchasing: siap dibandingkan harganya.
  let pr=await call(pemohon,'requests','POST',{needed_on:needed,items:[{description:'Kertas A4 80 gsm',item_kind:'GOODS',quantity:'2,5',unit:'rim',unit_price:400000,reason:'Stok kantor habis',attachments:[{form:'LINK',url:'https://toko.example/kertas-a4'}]},{description:'Tinta printer hitam',item_kind:'GOODS',quantity:'1',unit:'botol',unit_price:150000,reason:'Tinta habis'}]});
  pr=await decide(users['kabid.demo'],pr);pr=await decide(finance,pr,{budget_line_id:bhp.id});pr=await decide(users['sekban.demo'],pr);
  await call(buyer,`requests/${pr.id}/completeness`,'POST',{action:'ACCEPT',row_version:pr.row_version});
  // 3. Jasa di atas batas Sekban: menunggu persetujuan Kaban.
  pr=await call(pemohon,'requests','POST',{needed_on:addDays(today(),21),items:[{description:'Perbaikan portal besi pintu masuk 5,50 × 0,80 m',item_kind:'SERVICE',quantity:'1',unit:'set',unit_price:6500000,reason:'Portal rusak dan membahayakan pengunjung',attachments:[{form:'TEXT',note:'Penawaran lisan bengkel las Rendang'}]}]});
  pr=await decide(users['kabid.demo'],pr);await decide(finance,pr,{budget_line_id:one(db,"SELECT id FROM budget_lines WHERE code='PML'").id});

  console.log(`Database demo Pengadaan dibuat: ${directory}`);
  console.log(`Semua akun memakai password: ${PASSWORD}`);
  for(const [u,role] of [['pemohon.demo','Pemohon (staf pelayanan)'],['kabid.demo','Atasan pemohon'],['keuangan.demo','Verifikator Keuangan'],['sekban.demo','Sekban'],['kaban.demo','Kaban'],['purchasing.demo','Staf Purchasing'],['spi.demo','Pemeriksa SPI'],['plh.demo','Calon Plh'],['admin.demo','Super Admin + Pengelola Pengadaan']])console.log(`  ${u.padEnd(17)} ${role}`);
}finally{db.close();}
