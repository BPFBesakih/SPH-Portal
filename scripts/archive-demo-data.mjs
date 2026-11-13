// Data fiktif E-Arsip untuk pratinjau lokal dan uji browser. Semua nama, nomor surat, dan
// isi dokumen di sini karangan; tidak ada data operasional.
import {resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {deflateSync,crc32} from 'node:zlib';
import {insert,one,run,now} from '../lib/db.mjs';
import {claimFile} from '../lib/files.mjs';
import {archiveRoutes} from '../lib/archives.mjs';
import {createReportPdf} from '../public/archive-report-pdf.js';

// PDF contoh beberapa halaman, dibuat dengan penulis PDF laporan milik portal.
export async function samplePdf(title,paragraphs=40){
 const rows=Array.from({length:paragraphs},(_,i)=>({no:String(i+1),isi:`Paragraf contoh ${i+1}. Dokumen ini fiktif dan hanya dipakai untuk mencoba pratinjau, penggantian versi, dan izin unduh pada E-Arsip.`}));
 const blob=createReportPdf({title,lines:['Dokumen contoh — bukan surat resmi.'],columns:[{header:'No',key:'no',weight:.4},{header:'Isi',key:'isi',weight:6}],rows});
 return Buffer.from(await blob.arrayBuffer());
}
// PNG contoh (garis berwarna) tanpa pustaka gambar.
export function samplePng(width=600,height=820,tint=[123,30,52]){
 const raw=Buffer.alloc((width*3+1)*height);
 for(let y=0;y<height;y++){
  const row=y*(width*3+1);raw[row]=0;
  for(let x=0;x<width;x++){
   const band=y<70||(y>120&&y%46<3&&x>50&&x<width-50),at=row+1+x*3;
   raw[at]=band?tint[0]:250;raw[at+1]=band?tint[1]:248;raw[at+2]=band?tint[2]:244;
  }
 }
 const chunk=(type,data)=>{const body=Buffer.concat([Buffer.from(type),data]),out=Buffer.alloc(8+data.length+4);out.writeUInt32BE(data.length,0);body.copy(out,4);out.writeUInt32BE(crc32(body)>>>0,8+data.length);return out;};
 const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}

export async function seedArchiveDemo(db,dataDir,passwordHash){
 mkdirSync(resolve(dataDir,'files'),{recursive:true});
 const unit=(code,name,parent=null)=>insert(db,'org_units',{code,name,parent_id:parent,is_active:1});
 const sek=unit('ARS-SEK','Sekretariat Contoh'),hms=unit('ARS-HMS','Humas Contoh',sek.id),keu=unit('ARS-KEU','Keuangan Contoh',sek.id),ops=unit('ARS-OPS','Operasional Contoh');
 let n=0;
 const person=(username,name,unitRow,role=null,scope='ALL',scopeUnits=[])=>{
  let employee=null;
  if(unitRow){
   const position=insert(db,'positions',{code:`ARS-P${++n}`,name:`Staf ${unitRow.name}`,org_unit_id:unitRow.id,is_active:1});
   employee=insert(db,'employees',{employee_no:`ARS-${String(n).padStart(3,'0')}`,full_name:name,employment_status:'Tetap',joined_on:'2020-01-01',is_active:1});
   insert(db,'employee_placements',{employee_id:employee.id,position_id:position.id,valid_from:'2020-01-01',is_primary:1});
  }
  const user=insert(db,'users',{username,password_hash:passwordHash,status:'ACTIVE',employee_id:employee?.id||null,must_change_password:0,failed_login_count:0,password_changed_at:now()});
  if(role){const grant=insert(db,'user_roles',{user_id:user.id,role_id:one(db,'SELECT id FROM roles WHERE code=?',role).id,scope_kind:scope});for(const id of scopeUnits)run(db,'INSERT INTO user_role_units(user_role_id,org_unit_id,include_descendants) VALUES(?,?,1)',grant.id,id);}
  return user;
 };
 const u={admin:person('admin.arsip','Administrator Contoh',null,'SUPER_ADMIN'),humas:person('humas.arsip','Humas Contoh Satu',hms,'HUMAS'),
  officerKeu:person('petugas.keu','Petugas Arsip Keuangan',keu),staffKeu:person('pegawai.keu','Pegawai Keuangan Contoh',keu),
  officerOps:person('petugas.ops','Petugas Arsip Operasional',ops),staffOps:person('pegawai.ops','Pegawai Operasional Contoh',ops),
  boss:person('pimpinan.arsip','Pimpinan Sekretariat Contoh',sek,'ARSIP_PENGAWAS','ASSIGNED_UNITS',[sek.id])};
 const deps={claimFile,readFile:()=>null,claimStorage:()=>{}};
 const call=(user,method,path,body={},query='')=>archiveRoutes({db,user:{...user,request_id:randomUUID()},p:path.split('/'),method,body,url:new URL(`http://localhost/?${query}`)},deps);
 const file=(user,name,bytes)=>{
  const key=randomUUID();writeFileSync(resolve(dataDir,'files',key),bytes,{flag:'wx',mode:0o600});
  return insert(db,'files',{storage_key:key,original_name:name,mime_type:name.endsWith('.png')?'image/png':'application/pdf',size_bytes:bytes.length,checksum:createHash('sha256').update(bytes).digest('hex'),status:'AVAILABLE',uploaded_by:user.id});
 };
 await call(u.admin,'POST','archives/officers',{user_id:u.officerKeu.id,org_unit_id:keu.id,reason:'SK penunjukan contoh nomor 01',agenda_code:'KEU'});
 await call(u.admin,'POST','archives/officers',{user_id:u.officerOps.id,org_unit_id:ops.id,reason:'SK penunjukan contoh nomor 02',agenda_code:'OPS'});
 const create=async(user,unitRow,fields,attachments=[])=>(await call(user,'POST','archives',{idempotency_key:randomUUID(),owner_unit_id:unitRow.id,direction:'MASUK',document_type_id:'arsip-jenis-surat',
  letter_date:'2026-11-03',...fields,main_file_id:file(user,fields.file||'surat-contoh.pdf',await samplePdf(fields.subject,fields.paragraphs||40)).id,attachment_file_ids:attachments.map(a=>a.id)})).archive;
 const invitation=await create(u.officerKeu,keu,{direction:'MASUK',document_type_id:'arsip-jenis-und',official_number:'005/CONTOH/XI/2026',letter_date:'2026-11-02',subject:'Undangan rapat koordinasi anggaran contoh',file:'undangan-rapat.pdf',paragraphs:70},
  [file(u.officerKeu,'lampiran-daftar-hadir.png',samplePng())]);
 const note=await create(u.officerKeu,keu,{direction:'INTERNAL',document_type_id:'arsip-jenis-nd',official_number:'012/ND-KEU/XI/2026',letter_date:'2026-11-05',subject:'Nota dinas penyesuaian jadwal pembayaran contoh',file:'nota-dinas.pdf',paragraphs:12});
 const decree=await create(u.officerKeu,keu,{direction:'KELUAR',document_type_id:'arsip-jenis-sk',official_number:'SK-07/CONTOH/2026',letter_date:'2024-06-14',subject:'Surat keputusan pembentukan tim contoh (arsip lama)',file:'sk-tim.pdf',paragraphs:25});
 const secret=await create(u.officerKeu,keu,{direction:'MASUK',document_type_id:'arsip-jenis-surat',official_number:'R-01/CONTOH/XI/2026',letter_date:'2026-11-06',subject:'Surat pemeriksaan internal contoh',file:'surat-pemeriksaan.pdf',paragraphs:18});
 const report=await create(u.officerOps,ops,{direction:'KELUAR',document_type_id:'arsip-jenis-ba',official_number:'BA-03/OPS/XI/2026',letter_date:'2026-11-07',subject:'Berita acara serah terima peralatan contoh',file:'berita-acara.pdf',paragraphs:30});
 const task=await create(u.officerOps,ops,{direction:'INTERNAL',document_type_id:'arsip-jenis-st',official_number:null,letter_date:'2026-11-08',subject:'Surat tugas pendampingan kegiatan contoh',file:'surat-tugas.pdf',paragraphs:9});
 const version=id=>Number(one(db,'SELECT row_version FROM archive_records WHERE id=?',id).row_version);
 await call(u.humas,'POST',`archives/${secret.id}/classification`,{target:'RAHASIA',reason:'Memuat hasil pemeriksaan contoh',expected_row_version:version(secret.id)});
 await call(u.humas,'POST',`archives/${report.id}/grants`,{purpose:'BIASA_SHARE',target_user_id:u.staffKeu.id,notify_user_ids:[u.staffKeu.id],reason:'Untuk tindak lanjut pembayaran contoh'});
 await call(u.humas,'POST',`archives/${invitation.id}/grants`,{purpose:'DOWNLOAD',target_user_id:u.staffKeu.id,reason:'Perlu dicetak untuk rapat contoh'});
 await call(u.officerOps,'POST',`archives/${task.id}/delete-requests`,{reason:'Salah unggah: dokumen contoh ini bukan versi final.'});
 return {units:{sek,hms,keu,ops},users:u,archives:{invitation,note,decree,secret,report,task}};
}
