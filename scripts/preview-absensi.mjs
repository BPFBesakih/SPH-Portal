// Pratinjau lokal modul Absensi dengan data fiktif — tanpa layanan cloud.
//
//   node scripts/preview-absensi.mjs            (lanjutkan data pratinjau sebelumnya)
//   node scripts/preview-absensi.mjs --reset    (mulai dari awal)
//
// Menjalankan portal lokal (SQLite). Selfie disimpan sebagai berkas di
// data/pratinjau-absensi/attendance/ (diabaikan Git). Tidak ada yang dikirim ke Google.
//
// Kamera dan lokasi hanya berjalan di "secure context": buka /absen/ di laptop yang sama
// (http://127.0.0.1), misalnya dengan Chrome DevTools → Toggle device toolbar dan
// Sensors → Location. Untuk mencoba di HP sungguhan, lewatkan port ini melalui tunnel
// HTTPS lalu jalankan dengan PREVIEW_ORIGIN=https://alamat-tunnel (asal yang sama
// dengan yang dibuka di HP).
import {resolve} from 'node:path';
import {rmSync,mkdirSync} from 'node:fs';
import {openDb,insert,one,run,now} from '../lib/db.mjs';
import {seedPermissions,digest,hashPasswordSync} from '../lib/auth.mjs';
import {attendanceRules} from '../lib/attendance-rules.mjs';
import {createApp} from '../server.mjs';

if(process.env.NODE_ENV==='production')throw new Error('Pratinjau tidak boleh dijalankan dalam mode produksi.');
const dir=resolve('data','pratinjau-absensi');
if(process.argv.includes('--reset'))rmSync(dir,{recursive:true,force:true});
mkdirSync(dir,{recursive:true});
const port=Number(process.env.PORT)||4625,origin=process.env.PREVIEW_ORIGIN||`http://127.0.0.1:${port}`;
const db=openDb(resolve(dir,'portal.sqlite'));seedPermissions(db);
const password=hashPasswordSync('Preview2026!');

// Struktur dan pegawai fiktif hanya bila basis data pratinjau masih kosong.
if(!one(db,"SELECT id FROM org_units WHERE code='ABS-KANTOR'")){
  const unit=(code,name,parent=null)=>insert(db,'org_units',{code,name,parent_id:parent,is_active:1});
  const office=unit('ABS-KANTOR','Sekretariat Contoh'),pos1=unit('ABS-POS1','Pos Contoh 1',office.id),pos2=unit('ABS-POS2','Pos Contoh 2',office.id);
  const position=(code,name,u)=>insert(db,'positions',{code,name,org_unit_id:u.id,is_active:1});
  const employee=(no,name,pos,boss=null,status='Tetap')=>{const e=insert(db,'employees',{employee_no:no,full_name:name,employment_status:status,joined_on:'2020-01-01',is_active:1,phone:'081200000'+no.slice(-3)});insert(db,'employee_placements',{employee_id:e.id,position_id:pos.id,supervisor_employee_id:boss?.id||null,valid_from:'2020-01-01',is_primary:1});return e;};
  const head=employee('ABS-001','Kepala Contoh',position('ABS-P01','Kepala Sekretariat Contoh',office));
  const staff=employee('ABS-002','Staf Contoh',position('ABS-P02','Staf Administrasi Contoh',office),head);
  const coordinator=employee('ABS-003','Koordinator Pos Contoh',position('ABS-P03','Koordinator Pos 1',pos1),head);
  for(const [i,name] of ['Petugas Contoh Satu','Petugas Contoh Dua','Petugas Contoh Tiga'].entries())employee(`ABS-01${i}`,name,position(`ABS-P1${i}`,'Petugas Pos 1',pos1),coordinator);
  employee('ABS-020','Pekerja Harian Contoh',position('ABS-P20','THL Pos 2',pos2),head,'Tenaga Harian Lepas');
  const account=(username,employeeNo,role,scope='ALL',units=[])=>{
    const employeeId=employeeNo?one(db,'SELECT id FROM employees WHERE employee_no=?',employeeNo).id:null;
    const user=insert(db,'users',{username,password_hash:password,employee_id:employeeId,status:'ACTIVE',must_change_password:0,failed_login_count:0,password_changed_at:now()});
    if(role){const grant=insert(db,'user_roles',{user_id:user.id,role_id:one(db,'SELECT id FROM roles WHERE code=?',role).id,scope_kind:scope});for(const id of units)run(db,'INSERT INTO user_role_units(user_role_id,org_unit_id,include_descendants) VALUES(?,?,0)',grant.id,id);}
  };
  account('pengelola.absen','ABS-001','ABSENSI_PENGELOLA');
  account('koordinator.absen','ABS-003','ABSENSI_KOORDINATOR','ASSIGNED_UNITS',[pos1.id]);
  account('pegawai.absen','ABS-002',null);
  account('admin.preview',null,'SUPER_ADMIN');
  insert(db,'attendance_points',{name:'Titik Contoh Sekretariat',latitude:-8.3741,longitude:115.4512,radius_m:attendanceRules.radiusDefault,is_active:1,created_by:null});
  // HP bersama contoh dengan token tetap, supaya tautannya tetap sama setiap restart.
  insert(db,'attendance_devices',{kind:'SHARED',org_unit_id:pos1.id,label:'HP Pos Contoh 1',status:'PENDING',registration_token_hash:digest('a'.repeat(64)),
    registration_expires_at:new Date(Date.now()+365*86400000).toISOString(),created_by:null});
}
const pending=one(db,"SELECT id FROM attendance_devices WHERE registration_token_hash=? AND status='PENDING'",digest('a'.repeat(64)));
const {server}=createApp({db,dataDir:dir,origin});
server.listen(port,'127.0.0.1',()=>console.log(`
Portal pratinjau : ${origin}/#attendance
Akun (password Preview2026!):
  pengelola.absen   — Pengelola Absensi (semua unit), juga atasan pegawai contoh
  koordinator.absen — Koordinator HP Absen untuk Pos Contoh 1
  pegawai.absen     — pegawai biasa (hanya absen sendiri)
  admin.preview     — Superadmin
Halaman absen    : ${origin}/absen/
Tautan HP contoh : ${pending?`${origin}/absen/#daftar=${'a'.repeat(64)}`:'(sudah dipakai — buat tautan baru di menu Absensi → HP Absen)'}
Titik contoh     : -8.3741, 115.4512 (radius ${attendanceRules.radiusDefault} m). Atur lokasi tiruan di Chrome DevTools → Sensors.
Selfie pratinjau : ${resolve(dir,'attendance')}
Hentikan dengan Ctrl+C. Jalankan dengan --reset untuk memulai dari awal.`));
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{server.close();db.close();process.exit(0);});
