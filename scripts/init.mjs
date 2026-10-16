import {randomBytes} from 'node:crypto';
import {openDb,insert,one} from '../lib/db.mjs';
import {createAdmin} from '../lib/auth.mjs';
const db=openDb();
try{
  const password=process.env.ADMIN_PASSWORD||randomBytes(18).toString('base64url');
  const user=createAdmin(db,process.env.ADMIN_USERNAME||'admin',password);
  if(!one(db,"SELECT id FROM org_units WHERE code='BPB'"))insert(db,'org_units',{code:'BPB',name:'Badan Pengelola Besakih',is_active:1});
  console.log(`Inisialisasi berhasil. Username: ${user.username}`);
  if(!process.env.ADMIN_PASSWORD)console.log(`Password sementara (simpan sekarang): ${password}`);
  console.log('Pengguna wajib mengganti password pada login pertama. Jangan gunakan database demo untuk produksi.');
}finally{db.close();}
