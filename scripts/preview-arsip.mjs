// Pratinjau lokal modul E-Arsip dengan data fiktif — tanpa layanan cloud.
//
//   node scripts/preview-arsip.mjs            (lanjutkan data pratinjau sebelumnya)
//   node scripts/preview-arsip.mjs --reset    (mulai dari awal)
//
// Menjalankan portal lokal (SQLite). Berkas arsip disimpan di data/pratinjau-arsip/files/
// (diabaikan Git). Tidak ada yang dikirim ke Supabase atau Google Drive.
import {resolve} from 'node:path';
import {rmSync,mkdirSync} from 'node:fs';
import {openDb,one} from '../lib/db.mjs';
import {seedPermissions,hashPasswordSync} from '../lib/auth.mjs';
import {createApp} from '../server.mjs';
import {seedArchiveDemo} from './archive-demo-data.mjs';

if(process.env.NODE_ENV==='production')throw new Error('Pratinjau tidak boleh dijalankan dalam mode produksi.');
const dir=resolve('data','pratinjau-arsip');
if(process.argv.includes('--reset'))rmSync(dir,{recursive:true,force:true});
mkdirSync(dir,{recursive:true});
const port=Number(process.env.PORT)||4626,origin=process.env.PREVIEW_ORIGIN||`http://127.0.0.1:${port}`;
const db=openDb(resolve(dir,'portal.sqlite'));seedPermissions(db);
if(!one(db,"SELECT id FROM org_units WHERE code='ARS-SEK'"))await seedArchiveDemo(db,dir,hashPasswordSync('Preview2026!'));
const {server}=createApp({db,dataDir:dir,origin});
server.listen(port,'127.0.0.1',()=>console.log(`
Portal pratinjau : ${origin}/#archives
Akun (password Preview2026!):
  admin.arsip    — administrator: menunjuk petugas arsip, tidak membaca Rahasia
  humas.arsip    — Humas: membaca semua arsip, klasifikasi, berbagi, izin, hapus/pulihkan
  petugas.keu    — petugas arsip Keuangan Contoh: tambah dan ubah arsip bagiannya
  pegawai.keu    — pegawai Keuangan Contoh: membaca arsip Biasa bagiannya, punya satu izin unduh
  petugas.ops    — petugas arsip Operasional Contoh
  pegawai.ops    — pegawai Operasional Contoh
  pimpinan.arsip — Pengawas Arsip untuk Sekretariat Contoh dan unit di bawahnya
Data fiktif di ${dir}. Hentikan dengan Ctrl+C.
`));
