import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,insert,one,all,run,today,now} from '../lib/db.mjs';
import {seedPermissions,hashPasswordSync} from '../lib/auth.mjs';
import {fileAllowed} from '../lib/files.mjs';
import {purchasingRoutes,purchasingPendingCount} from '../lib/purchasing.mjs';
import * as R from '../lib/purchasing-rules.mjs';

const hash=hashPasswordSync('TestPassword!2026');
const asOf=today(),year=Number(asOf.slice(0,4)),roman=R.romanMonth(asOf),later=R.addDays(asOf,7);

// Struktur kecil: Sekretariat (Kaban, Sekban), Operasional (Kabid, staf), Umum (Purchasing), Keuangan, SPI.
function fixture(t){
  const db=openDb(':memory:');t.after(()=>db.close());seedPermissions(db);
  const unit=code=>insert(db,'org_units',{code,name:`Unit ${code}`,is_active:1});
  const units={SEK:unit('SEK'),OPS:unit('OPS'),UMM:unit('UMM'),KEU:unit('KEU')};
  const people={};
  const person=(key,position,unitKey,supervisor=null)=>{
    const pos=insert(db,'positions',{code:`POS_${key}`,name:position,org_unit_id:units[unitKey].id,is_active:1});
    const e=insert(db,'employees',{employee_no:`NIP-${key}`,full_name:`${position} ${key}`,employment_status:'Tetap',joined_on:'2020-01-01',is_active:1});
    insert(db,'employee_placements',{employee_id:e.id,position_id:pos.id,supervisor_employee_id:supervisor?.id||null,valid_from:'2020-01-01',is_primary:1});
    people[key]={...e,position_id:pos.id};return people[key];
  };
  const kaban=person('kaban','Kaban','SEK'),sekban=person('sekban','Sekban','SEK',kaban),kabid=person('kabid','Kabid Operasional','OPS',sekban);
  person('staff','Staf Operasional','OPS',kabid);person('purchasing','Staf Purchasing','UMM',sekban);person('finance','Verifikator Keuangan','KEU',sekban);person('auditor','Pemeriksa','SEK',kaban);person('plh','Kabag Umum','UMM',sekban);person('outsider','Staf Lain','OPS',kabid);
  const users={};
  const account=(key,roles,employee=people[key])=>{
    const user=insert(db,'users',{username:key,password_hash:hash,status:'ACTIVE',employee_id:employee?.id||null,must_change_password:0,failed_login_count:0,password_changed_at:now()});
    for(const [code,scope] of roles)insert(db,'user_roles',{user_id:user.id,role_id:one(db,'SELECT id FROM roles WHERE code=?',code).id,scope_kind:scope});
    users[key]=user;return user;
  };
  for(const key of ['staff','kabid','sekban','kaban','plh','outsider'])account(key,[['PURCHASE_REQUESTER','SELF']]);
  account('purchasing',[['PURCHASING_STAFF','ALL'],['PURCHASE_REQUESTER','SELF']]);account('finance',[['FINANCE_VERIFIER','ALL']]);account('auditor',[['PURCHASE_AUDITOR','ALL']]);account('admin',[['PURCHASE_ADMIN','ALL']],null);
  return {db,units,people,users};
}
const call=(f,user,path,method='GET',body={},query='')=>purchasingRoutes({db:f.db,user,p:['purchasing',...path.split('/')],method,body,url:new URL(`http://localhost/?${query}`)});
const file=(f,user,name='bukti.pdf')=>insert(f.db,'files',{storage_key:crypto.randomUUID(),original_name:name,mime_type:'application/pdf',size_bytes:10,checksum:'t',status:'AVAILABLE',uploaded_by:user.id});
async function setup(f){
  await call(f,f.users.admin,'settings','PATCH',{settings:{officials:{sekban_position_id:f.people.sekban.position_id,kaban_position_id:f.people.kaban.position_id},unit_codes:{[f.units.OPS.id]:'OPS'}}});
  const by=await call(f,f.users.finance,'budget/years','POST',{year});
  const line=await call(f,f.users.finance,'budget/lines','POST',{budget_year_id:by.id,code:'BHP',name:'Belanja barang habis pakai',org_unit_id:f.units.OPS.id,ceiling:50000000});
  const vendor=name=>call(f,f.users.purchasing,'vendors','POST',{name,leader_name:`Pimpinan ${name}`,leader_nik:'5108012345678901',address:'Karangasem',phone:'0812',bank_name:'BPD Bali',account_no:'0123456789',account_name:name});
  return {line,v1:await vendor('Toko Satu'),v2:await vendor('Toko Dua'),v3:await vendor('CV Tiga')};
}
const item=(extra={})=>({description:'Kertas A4 80 gsm',item_kind:'GOODS',quantity:'2',unit:'rim',unit_price:55000,reason:'Stok kantor habis',...extra});
const submit=(f,user,items,needed_on=later)=>call(f,user,'requests','POST',{needed_on,items});
async function decide(f,user,pr,action='APPROVE',extra={}){
  const fresh=await call(f,user,`requests/${pr.id}`);assert(fresh.actions.step,`tidak ada tahap untuk ${user.username}`);
  return call(f,user,`requests/${pr.id}/decide`,'POST',{step_id:fresh.actions.step.id,row_version:fresh.row_version,action,...extra});
}
async function approveToPurchasing(f,ctx,pr,{special=false}={}){
  pr=await decide(f,f.users.kabid,pr);assert.equal(pr.status,'pending_verification');
  pr=await decide(f,f.users.finance,pr,'APPROVE',{budget_line_id:ctx.line.id,special_budget:special});assert.equal(pr.status,'pending_final_approval');
  pr=await decide(f,pr.final_approver_kind==='SEKBAN'?f.users.sekban:f.users.kaban,pr);assert.equal(pr.status,'pending_completeness_check');
  return call(f,f.users.purchasing,`requests/${pr.id}/completeness`,'POST',{action:'ACCEPT',row_version:pr.row_version});
}

test('aturan: rupiah, jumlah, subtotal, terbilang, nomor, dan ambang', ()=>{
  assert.equal(R.quantityMilli('2,5'),2500);assert.throws(()=>R.quantityMilli('0'),RangeError);assert.throws(()=>R.quantityMilli('1,2345'),RangeError);
  assert.equal(R.lineSubtotal(2500,1001),2503);assert.equal(R.lineSubtotal(4400,340000),1496000);assert.equal(R.formatQuantity(4400),'4,4');
  assert.equal(R.terbilang(5032000),'Lima Juta Tiga Puluh Dua Ribu Rupiah');assert.equal(R.terbilang(1100),'Seribu Seratus Rupiah');assert.equal(R.terbilang(0),'Nol Rupiah');
  assert.equal(R.finalApproverKind(5000000,0),'SEKBAN');assert.equal(R.finalApproverKind(5000001,0),'KABAN');assert.equal(R.finalApproverKind(100,1),'KABAN');
  assert.deepEqual(R.allowedPaths(999999),['A']);assert.deepEqual(R.allowedPaths(1000000),['B','C']);
  assert.equal(R.attachmentRequired(999999),false);assert.equal(R.attachmentRequired(1000000),true);
  assert.equal(R.documentKindFor(['GOODS','GOODS']),'PO');assert.equal(R.documentKindFor(['GOODS','SERVICE']),'SPK');
  assert.equal(R.documentNumber('PR',7,'2026-10-17','OPS'),'007/PR/OPS/X/2026');assert.equal(R.documentNumber('SPK',12,'2026-03-01'),'012/SPK/PURCHASE/III/2026');assert.equal(R.requestCode(2026,42),'PJ-2026-0042');
  assert.throws(()=>R.money(1.5),RangeError);assert.throws(()=>R.money(-1),RangeError);assert.equal(R.money('15000'),15000);
  assert.equal(R.canTransition('completed','in_procurement'),false);assert.equal(R.canTransition('pending_requester_confirmation','pending_reverification'),true);
});

test('role pengadaan dibuat tanpa mengubah role yang sudah ada', t=>{
  const f=fixture(t);
  const perms=code=>all(f.db,'SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id JOIN roles r ON r.id=rp.role_id WHERE r.code=? ORDER BY p.code',code).map(r=>r.code);
  assert.deepEqual(perms('PURCHASE_REQUESTER'),['purchasing.requests.create','purchasing.requests.read']);
  assert(perms('FINANCE_VERIFIER').includes('purchasing.requests.verify'));assert(!perms('PURCHASING_STAFF').includes('purchasing.requests.verify'));
  assert.equal(perms('SUPER_ADMIN').some(c=>c.startsWith('purchasing.')),false);assert.equal(perms('EMPLOYEE').some(c=>c.startsWith('purchasing.')),false);
  assert(!perms('PURCHASE_AUDITOR').includes('purchasing.vendors.sensitive'));
});

test('alur jalur B: PR → atasan → Keuangan → Sekban → kelengkapan → perbandingan → PO → serah terima', async t=>{
  const f=fixture(t),ctx=await setup(f);
  await assert.rejects(submit(f,f.users.staff,[item({unit_price:600000})]),/wajib punya lampiran/);
  const evidence=file(f,f.users.staff);
  let pr=await submit(f,f.users.staff,[item({unit_price:600000,attachments:[{form:'FILE',file_id:evidence.id},{form:'LINK',url:'https://toko.example/kertas'}]}),item({description:'Tinta printer',quantity:'1,5',unit:'botol',unit_price:100000,attachments:[{form:'TEXT',note:'Toko ATK Amlapura'}]})]);
  assert.equal(pr.request_code,`PJ-${year}-0001`);assert.equal(pr.status,'pending_acknowledgement');assert.equal(pr.estimated_total,1350000);assert.equal(pr.items[1].quantity,'1,5');
  await assert.rejects(call(f,f.users.staff,`requests/${pr.id}/decide`,'POST',{step_id:pr.steps[0].id,row_version:pr.row_version,action:'APPROVE'}),/Pemohon tidak boleh/);
  await assert.rejects(call(f,f.users.outsider,`requests/${pr.id}/decide`,'POST',{step_id:pr.steps[0].id,row_version:pr.row_version,action:'APPROVE'}),/menunggu penyetuju lain/);
  await assert.rejects(call(f,f.users.outsider,`requests/${pr.id}`),/tidak memiliki akses/);
  assert.equal(purchasingPendingCount(f.db,f.users.kabid),1);
  pr=await decide(f,f.users.kabid,pr);
  await assert.rejects(decide(f,f.users.finance,pr,'APPROVE',{}),/Pos RKA wajib dipilih/);
  pr=await decide(f,f.users.finance,pr,'APPROVE',{budget_line_id:ctx.line.id});assert.equal(pr.final_approver_kind,'SEKBAN');
  pr=await decide(f,f.users.sekban,pr);assert.equal(pr.status,'pending_completeness_check');
  assert.equal(pr.documents.filter(d=>d.doc_type==='PR').length,1);
  assert.equal(pr.budget_line.commitment,1350000);

  const staffView=await call(f,f.users.purchasing,`requests/${pr.id}`);assert.equal(staffView.suggested_pr_number,`001/PR/OPS/${roman}/${year}`);
  pr=await call(f,f.users.purchasing,`requests/${pr.id}/completeness`,'POST',{action:'ACCEPT',row_version:pr.row_version});
  assert.equal(pr.pr_number,`001/PR/OPS/${roman}/${year}`);assert.equal(pr.status,'in_procurement');assert.equal(pr.pic_employee_id,f.people.purchasing.id);
  assert.equal(pr.documents.filter(d=>d.doc_type==='PR'&&!d.superseded_at).length,1);
  await assert.rejects(call(f,f.users.purchasing,`requests/${pr.id}/orders`,'POST',{path:'A',store_name:'Toko'}),/wajib lewat perbandingan/);

  const [paper,ink]=pr.items;
  const quote=(it,vendor,price)=>call(f,f.users.purchasing,`requests/${pr.id}/quotes`,'POST',{item_id:it.id,vendor_id:vendor.id,unit_price:price,evidence:[{form:'LINK',url:'https://toko.example/harga'}]});
  await assert.rejects(call(f,f.users.purchasing,`requests/${pr.id}/quotes`,'POST',{item_id:paper.id,vendor_id:ctx.v1.id,unit_price:590000}),/Bukti harga wajib/);
  await quote(paper,ctx.v1,590000);await quote(paper,ctx.v2,580000);await quote(ink,ctx.v1,95000);
  pr=await quote(ink,ctx.v2,90000);
  await assert.rejects(call(f,f.users.purchasing,`requests/${pr.id}/orders`,'POST',{path:'B'}),/Pilih satu harga/);
  const q=(it,vendor)=>pr.items.find(i=>i.id===it.id).quotes.find(x=>x.vendor_id===vendor.id);
  await assert.rejects(call(f,f.users.purchasing,`requests/${pr.id}/quotes/${q(paper,ctx.v1).id}/select`,'POST',{}),/bukan termurah/);
  await call(f,f.users.purchasing,`requests/${pr.id}/quotes/${q(paper,ctx.v1).id}/select`,'POST',{reason:'Garansi penukaran dan kirim hari ini'});
  pr=await call(f,f.users.purchasing,`requests/${pr.id}/quotes/${q(ink,ctx.v1).id}/select`,'POST',{reason:'Satu toko dengan kertas'});
  pr=await call(f,f.users.purchasing,`requests/${pr.id}/orders`,'POST',{path:'B'});
  assert.equal(pr.orders.length,1);const order=pr.orders[0];assert.equal(order.document_kind,'PO');assert.equal(order.total,1180000+142500);assert.equal(order.status,'draft');
  await assert.rejects(call(f,f.users.purchasing,`requests/${pr.id}/quotes/${q(paper,ctx.v2).id}/select`,'POST',{}),/sudah masuk pesanan/);

  const requesterView=await call(f,f.users.staff,`requests/${pr.id}`);
  assert.equal(requesterView.view,'requester');assert.equal(requesterView.items[0].quotes.length,0);assert.equal(requesterView.orders[0].vendor,undefined);

  pr=await call(f,f.users.purchasing,`orders/${order.id}`,'PATCH',{row_version:order.row_version,items:[{id:order.items[0].id,needed_on:later}]});
  pr=await call(f,f.users.purchasing,`orders/${order.id}/submit`,'POST',{row_version:pr.orders[0].row_version});
  assert.equal(pr.orders[0].status,'pending_order_approval');
  const sekbanView=await call(f,f.users.sekban,`requests/${pr.id}`);assert.equal(sekbanView.actions.step.kind,'ORDER');
  pr=await call(f,f.users.sekban,`orders/${order.id}/decide`,'POST',{step_id:sekbanView.actions.step.id,row_version:pr.orders[0].row_version,action:'APPROVE'});
  const issued=pr.orders[0];assert.equal(issued.status,'ordered');assert.equal(issued.document.number,`001/PO/PURCHASE/${roman}/${year}`);assert.equal(issued.document.signer_name,f.people.sekban.full_name);assert.equal(issued.due_on,later);
  const po=pr.documents.find(d=>d.doc_type==='PO');const doc=await call(f,f.users.purchasing,`documents/${po.id}`);
  assert.equal(doc.hash_valid,true);assert.equal(doc.snapshot.total_words,R.terbilang(issued.total));assert.equal(doc.snapshot.vendor.leader_nik,null);assert.equal(doc.snapshot.vendor.account_no,'0123456789');
  const verify=await call(f,f.users.outsider,`verify/${po.verification_code}`);assert.equal(verify.number,issued.document.number);assert.equal(verify.hash_valid,true);
  await assert.rejects(call(f,f.users.staff,`documents/${po.id}`),/hanya untuk pihak/);

  await assert.rejects(call(f,f.users.purchasing,`orders/${order.id}/purchase`,'POST',{row_version:issued.row_version,purchased_on:asOf,items:[{id:issued.items[0].id,unit_price:600000}]}),/lebih tinggi dari harga pesanan/);
  pr=await call(f,f.users.purchasing,`orders/${order.id}/purchase`,'POST',{row_version:issued.row_version,purchased_on:asOf,items:[{id:issued.items[0].id,unit_price:585000}]});
  await assert.rejects(call(f,f.users.purchasing,`orders/${order.id}/receive`,'POST',{row_version:pr.orders[0].row_version,received_on:asOf,condition_note:'Baik',invoice_total:1312500,invoice:[]}),/wajib diunggah/);
  const invoice=file(f,f.users.purchasing,'nota.pdf');
  pr=await call(f,f.users.purchasing,`orders/${order.id}/receive`,'POST',{row_version:pr.orders[0].row_version,received_on:asOf,condition_note:'Lengkap dan baik',invoice_total:1312500,invoice:[{form:'FILE',file_id:invoice.id}]});
  assert.equal(pr.status,'completed');assert.equal(pr.orders[0].status,'received');
  const budget=await call(f,f.users.finance,'budget','GET',{},`year=${year}`);assert.equal(budget.items[0].realization,1312500);assert.equal(budget.items[0].commitment,0);assert.equal(budget.items[0].remaining,50000000-1312500);

  assert.equal(fileAllowed(f.db,f.users.staff,evidence.id),true);assert.equal(fileAllowed(f.db,f.users.staff,invoice.id),false);assert.equal(fileAllowed(f.db,f.users.auditor,invoice.id),true);assert.equal(fileAllowed(f.db,f.users.outsider,evidence.id),false);
  const auditor=await call(f,f.users.auditor,'vendors');assert.equal(auditor.items[0].leader_nik,'••••8901');assert.equal(auditor.items[0].account_no,'••••6789');
  assert.equal((await call(f,f.users.auditor,'requests','GET',{},'view=all')).items.length,1);
  const report=await call(f,f.users.auditor,'reports','GET',{},`year=${year}`);assert.equal(report.realized_value,1312500);
  const csv=await call(f,f.users.auditor,'export','GET',{},`year=${year}`);assert.match(csv.csv,/001\/PR\/OPS/);
  assert(one(f.db,"SELECT id FROM audit_events WHERE action='RECEIVE' AND object_type='vendor_orders'"));
});

test('jalur A: PR kecil langsung dibeli tanpa PO/SPK', async t=>{
  const f=fixture(t),ctx=await setup(f);
  let pr=await approveToPurchasing(f,ctx,await submit(f,f.users.staff,[item()]));
  assert.deepEqual(pr.allowed_paths,['A']);
  await assert.rejects(call(f,f.users.purchasing,`requests/${pr.id}/orders`,'POST',{path:'B'}),/jalur langsung beli/);
  pr=await call(f,f.users.purchasing,`requests/${pr.id}/orders`,'POST',{path:'A',store_name:'Toko ATK Amlapura'});
  const order=pr.orders[0];assert.equal(order.document_kind,'NONE');assert.equal(order.status,'ordered');assert.equal(order.total,110000);
  pr=await call(f,f.users.purchasing,`orders/${order.id}/purchase`,'POST',{row_version:order.row_version,purchased_on:asOf});
  pr=await call(f,f.users.purchasing,`orders/${order.id}/receive`,'POST',{row_version:pr.orders[0].row_version,received_on:asOf,condition_note:'Baik',invoice_total:110000,invoice:[{form:'FILE',file_id:file(f,f.users.purchasing).id}]});
  assert.equal(pr.status,'completed');
});

test('jalur C: surat penunjukan disetujui Kaban lalu SPK langsung terbit; penolakan kembali ke draf', async t=>{
  const f=fixture(t),ctx=await setup(f);
  let pr=await submit(f,f.users.staff,[item({description:'Perbaikan portal besi',item_kind:'SERVICE',quantity:'1',unit:'set',unit_price:6000000,attachments:[{form:'TEXT',note:'Bengkel las Rendang'}]})]);
  pr=await approveToPurchasing(f,ctx,pr);assert.equal(pr.final_approver_kind,'KABAN');
  const body={path:'C',vendor_id:ctx.v3.id,prices:{[pr.items[0].id]:5500000},reason:'Hanya satu bengkel yang sanggup di lokasi',evidence:[{form:'LINK',url:'https://bengkel.example/penawaran'}],document:{work_description:'Perbaikan portal masuk',work_duration_days:14}};
  await assert.rejects(call(f,f.users.purchasing,`requests/${pr.id}/orders`,'POST',{...body,evidence:[]}),/Bukti harga dari vendor wajib/);
  await assert.rejects(call(f,f.users.purchasing,`requests/${pr.id}/orders`,'POST',{...body,prices:{[pr.items[0].id]:6000001}}),/lebih tinggi dari yang disetujui/);
  pr=await call(f,f.users.purchasing,`requests/${pr.id}/orders`,'POST',body);
  let order=pr.orders[0];assert.equal(order.status,'pending_appointment_approval');assert.equal(order.document_kind,'SPK');
  await assert.rejects(call(f,f.users.sekban,`requests/${pr.id}`),/tidak memiliki akses/);
  let kaban=await call(f,f.users.kaban,`requests/${pr.id}`);assert.equal(kaban.actions.step.kind,'APPOINTMENT');
  await assert.rejects(call(f,f.users.kaban,`orders/${order.id}/decide`,'POST',{step_id:kaban.actions.step.id,row_version:order.row_version,action:'REJECT'}),/Alasan penolakan/);
  pr=await call(f,f.users.kaban,`orders/${order.id}/decide`,'POST',{step_id:kaban.actions.step.id,row_version:order.row_version,action:'REJECT',reason:'Cari pembanding dulu'});
  order=pr.orders[0];assert.equal(order.status,'draft');assert.equal(order.appointments[0].status,'REJECTED');
  pr=await call(f,f.users.purchasing,`orders/${order.id}/submit`,'POST',{row_version:order.row_version,reason:'Sudah dicari, tetap satu bengkel',evidence:[{form:'LINK',url:'https://bengkel.example/penawaran-2'}]});
  kaban=await call(f,f.users.kaban,`requests/${pr.id}`);
  pr=await call(f,f.users.kaban,`orders/${order.id}/decide`,'POST',{step_id:kaban.actions.step.id,row_version:pr.orders[0].row_version,action:'APPROVE'});
  order=pr.orders[0];assert.equal(order.status,'ordered');assert.equal(order.document.number,`001/SPK/PURCHASE/${roman}/${year}`);assert.equal(order.appointments[1].number,`001/SPV/PURCHASE/${roman}/${year}`);
  assert.equal(order.due_on,R.addDays(asOf,14));
  const spk=await call(f,f.users.purchasing,`documents/${pr.documents.find(d=>d.doc_type==='SPK').id}`);assert.equal(spk.snapshot.vendor.leader_nik,'5108012345678901');assert.equal(spk.snapshot.signer.name,f.people.kaban.full_name);
  const auditorDoc=await call(f,f.users.auditor,`documents/${pr.documents.find(d=>d.doc_type==='SPK').id}`);assert.equal(auditorDoc.snapshot.vendor.leader_nik,'••••8901');
});

test('kenaikan harga: konfirmasi pemohon → verifikasi ulang → persetujuan ulang Kaban bila melewati batas Sekban', async t=>{
  const f=fixture(t),ctx=await setup(f);
  let pr=await approveToPurchasing(f,ctx,await submit(f,f.users.staff,[item({description:'Meja kerja',quantity:'2',unit:'unit',unit_price:2400000,attachments:[{form:'TEXT',note:'Toko mebel'}]}),item({description:'Kursi',quantity:'2',unit:'unit',unit_price:100000})]));
  assert.equal(pr.final_approver_kind,'SEKBAN');const [desk,chair]=pr.items;
  await assert.rejects(call(f,f.users.purchasing,`requests/${pr.id}/confirmations`,'POST',{row_version:pr.row_version,items:[{item_id:desk.id,new_unit_price:2300000,reason:'Turun'}]}),/tidak lebih tinggi/);
  pr=await call(f,f.users.purchasing,`requests/${pr.id}/confirmations`,'POST',{row_version:pr.row_version,items:[{item_id:desk.id,new_unit_price:2600000,reason:'Harga distributor naik'},{item_id:chair.id,new_unit_price:150000,reason:'Model lama habis'}]});
  assert.equal(pr.status,'pending_requester_confirmation');
  const mine=await call(f,f.users.staff,`requests/${pr.id}`);assert.equal(mine.actions.answer,true);
  await assert.rejects(call(f,f.users.staff,`requests/${pr.id}/confirmations/answer`,'POST',{row_version:pr.row_version,answers:[{item_id:desk.id,accept:true}]}),/Jawab setiap item/);
  pr=await call(f,f.users.staff,`requests/${pr.id}/confirmations/answer`,'POST',{row_version:pr.row_version,answers:[{item_id:desk.id,accept:true},{item_id:chair.id,accept:false}]});
  assert.equal(pr.status,'pending_reverification');assert.equal(pr.items.find(i=>i.id===chair.id).status,'CANCELLED');
  pr=await decide(f,f.users.finance,pr);assert.equal(pr.status,'pending_reapproval');assert.equal(pr.approved_total,5200000);
  await assert.rejects(decide(f,f.users.sekban,pr),/tidak ada tahap/);
  pr=await decide(f,f.users.kaban,pr);assert.equal(pr.status,'in_procurement');assert.equal(pr.final_approver_kind,'KABAN');
  assert.equal(pr.items.find(i=>i.id===desk.id).approved_unit_price,2600000);
  assert.equal(pr.documents.filter(d=>d.doc_type==='PR'&&!d.superseded_at).length,1);assert.equal(pr.documents.filter(d=>d.doc_type==='PR').length,3);
});

test('pengembalian, revisi, pembatalan, dan tampilan Pengajuan Saya', async t=>{
  const f=fixture(t),ctx=await setup(f);
  let pr=await submit(f,f.users.staff,[item()]);
  await assert.rejects(decide(f,f.users.kabid,pr,'RETURN'),/Alasan pengembalian/);
  pr=await decide(f,f.users.kabid,pr,'RETURN',{reason:'Tambahkan jumlah'});assert.equal(pr.status,'returned');
  assert.equal((await call(f,f.users.staff,`requests/${pr.id}`)).actions.revise,true);
  await assert.rejects(call(f,f.users.kabid,`requests/${pr.id}`,'PATCH',{row_version:pr.row_version,needed_on:later,items:[item()]}),/Hanya pemohon/);
  pr=await call(f,f.users.staff,`requests/${pr.id}`,'PATCH',{row_version:pr.row_version,needed_on:later,items:[item({quantity:'3'})]});
  assert.equal(pr.status,'pending_acknowledgement');assert.equal(pr.revision_no,2);assert.equal(pr.estimated_total,165000);
  assert.equal(pr.steps.filter(s=>s.status==='PENDING').length,1);
  pr=await call(f,f.users.staff,`requests/${pr.id}/cancel`,'POST',{row_version:pr.row_version,reason:'Sudah ada pinjaman'});assert.equal(pr.status,'cancelled');
  assert.equal(pr.steps.some(s=>s.status==='PENDING'),false);
  const accepted=await approveToPurchasing(f,ctx,await submit(f,f.users.staff,[item()]));
  await assert.rejects(call(f,f.users.staff,`requests/${accepted.id}/cancel`,'POST',{row_version:accepted.row_version}),/sebelum nomor PR terbit/);
  const list=await call(f,f.users.staff,'requests','GET',{},'view=mine');assert.equal(list.items.length,2);
  await assert.rejects(call(f,f.users.staff,'requests','GET',{},'view=all'),/tidak memiliki akses/);
});

test('penyetuju akhir: Sekban dan Kaban tidak menyetujui PR sendiri; Plh bertindak atas nama pejabat', async t=>{
  const f=fixture(t),ctx=await setup(f);
  let own=await submit(f,f.users.sekban,[item()]);
  own=await decide(f,f.users.kaban,own);own=await decide(f,f.users.finance,own,'APPROVE',{budget_line_id:ctx.line.id});
  assert.equal(own.final_approver_kind,'KABAN');
  let top=await submit(f,f.users.kaban,[item()]);
  assert.equal(top.status,'pending_verification');assert.equal(top.steps.find(s=>s.step_kind==='ACKNOWLEDGE').status,'SKIPPED');
  top=await decide(f,f.users.finance,top,'APPROVE',{budget_line_id:ctx.line.id});assert.equal(top.final_approver_kind,'SEKBAN');
  const big=await submit(f,f.users.kaban,[item({quantity:'2',unit_price:3000000,attachments:[{form:'TEXT',note:'Penawaran'}]})]);
  await assert.rejects(decide(f,f.users.finance,big,'APPROVE',{budget_line_id:ctx.line.id}),/keputusan terbuka/);

  const delegation=await call(f,f.users.admin,'delegations','POST',{from_employee_id:f.people.sekban.id,to_employee_id:f.people.plh.id,starts_on:asOf,ends_on:later,reason:'SK Plh Sekban'});
  let pr=await submit(f,f.users.staff,[item()]);pr=await decide(f,f.users.kabid,pr);pr=await decide(f,f.users.finance,pr,'APPROVE',{budget_line_id:ctx.line.id});
  assert.equal(purchasingPendingCount(f.db,f.users.plh),2);
  const view=await call(f,f.users.plh,`requests/${pr.id}`);assert.equal(view.actions.step.as_delegate,true);assert.equal(view.view,'full');
  pr=await decide(f,f.users.plh,pr);const step=pr.steps.find(s=>s.step_kind==='FINAL');assert.equal(step.as_delegate,1);assert.equal(step.actor_employee_id,f.people.plh.id);
  await call(f,f.users.admin,`delegations/${delegation.id}/revoke`,'POST',{row_version:delegation.row_version});
  assert.equal(purchasingPendingCount(f.db,f.users.plh),0);

  let next=await submit(f,f.users.staff,[item()]);
  await assert.rejects(call(f,f.users.admin,`steps/${next.steps[0].id}/reassign`,'POST',{employee_id:f.people.staff.id,reason:'x'}),/Pemohon tidak boleh/);
  next=await call(f,f.users.admin,`steps/${next.steps[0].id}/reassign`,'POST',{employee_id:f.people.sekban.id,reason:'Kabid cuti panjang'});
  assert.equal(next.steps[0].reassigned_from_employee_id,f.people.kabid.id);
  await assert.rejects(decide(f,f.users.kabid,next),/tidak memiliki akses/);
  next=await decide(f,f.users.sekban,next);assert.equal(next.status,'pending_verification');
  assert.throws(()=>run(f.db,"UPDATE purchase_approval_steps SET reason='ubah' WHERE id=?",next.steps[0].id),/sudah diputuskan/);
});

test('pengaturan, kelengkapan PR, dan batas jumlah query detail', async t=>{
  const f=fixture(t),ctx=await setup(f);
  await assert.rejects(call(f,f.users.purchasing,'settings'),/Pengelola Pengadaan/);
  await assert.rejects(call(f,f.users.admin,'settings','PATCH',{settings:{min_quotes_per_item:1}}),/minimal 2–5/);
  await assert.rejects(call(f,f.users.admin,'settings','PATCH',{settings:{unit_codes:{[f.units.OPS.id]:'O/P'}}}),/Kode unit/);
  const saved=await call(f,f.users.admin,'settings','PATCH',{settings:{number_floor:{year,PO:41,SPK:0,SPV:0}},reason:'Lanjutkan nomor manual'});assert.equal(saved.settings.number_floor.PO,41);
  const overview=await call(f,f.users.outsider,'overview');assert.equal(overview.can_submit,true);assert.equal(overview.me.supervisor,f.people.kabid.full_name);
  const noRole=insert(f.db,'users',{username:'tanpa',password_hash:hash,status:'ACTIVE',employee_id:null,must_change_password:0,failed_login_count:0,password_changed_at:now()});
  const blocked=await call(f,noRole,'overview');assert.equal(blocked.can_submit,false);assert(blocked.missing.length>=2);
  await assert.rejects(call(f,noRole,'requests','POST',{needed_on:later,items:[item()]}),/belum dapat dikirim/);

  let pr=await submit(f,f.users.staff,[item()]);pr=await decide(f,f.users.kabid,pr);pr=await decide(f,f.users.finance,pr,'APPROVE',{budget_line_id:ctx.line.id});pr=await decide(f,f.users.sekban,pr);
  const other=await submit(f,f.users.outsider,[item()]);
  await assert.rejects(call(f,f.users.purchasing,`requests/${other.id}/completeness`,'POST',{action:'ACCEPT',row_version:other.row_version}),/tidak sedang menunggu/);
  pr=await call(f,f.users.purchasing,`requests/${pr.id}/completeness`,'POST',{action:'ACCEPT',row_version:pr.row_version,pr_number:`017/PR/OPS/${roman}/${year}`});
  assert.equal(pr.pr_number,`017/PR/OPS/${roman}/${year}`);
  let second=await submit(f,f.users.outsider,[item()]);second=await decide(f,f.users.kabid,second);second=await decide(f,f.users.finance,second,'APPROVE',{budget_line_id:ctx.line.id});second=await decide(f,f.users.sekban,second);
  await assert.rejects(call(f,f.users.purchasing,`requests/${second.id}/completeness`,'POST',{action:'ACCEPT',row_version:second.row_version,pr_number:pr.pr_number}),/sudah dipakai/);
  assert.equal((await call(f,f.users.purchasing,`requests/${second.id}`)).suggested_pr_number,`018/PR/OPS/${roman}/${year}`);
  const rejected=await call(f,f.users.purchasing,`requests/${second.id}/completeness`,'POST',{action:'REJECT',row_version:second.row_version,reason:'Spesifikasi tidak jelas'});assert.equal(rejected.status,'rejected');assert.equal(rejected.closed_reason,'Spesifikasi tidak jelas');

  const prepare=f.db.prepare.bind(f.db);let queries=0;f.db.prepare=sql=>{queries++;return prepare(sql);};
  await call(f,f.users.purchasing,`requests/${pr.id}`);f.db.prepare=prepare;
  assert(queries<=25,`detail PR memakai ${queries} query`);
});
