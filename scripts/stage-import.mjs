import {readFileSync} from 'node:fs';
import {openDb,one,run,insert,tx,audit,assert} from '../lib/db.mjs';
const path=process.argv[2];assert(path,'Pemakaian: node scripts/stage-import.mjs data/imports/besakih-draft.json');
const source=JSON.parse(readFileSync(path,'utf8'));assert(source.schema_version===1&&Array.isArray(source.candidates),'Format sumber tidak sesuai.');
const db=openDb();
try{tx(db,()=>{
  const root=one(db,"SELECT * FROM org_units WHERE code='BPB'")||insert(db,'org_units',{code:'BPB',name:'Badan Pengelola Besakih',is_active:1});
  const units=new Map([['Badan Pengelola Besakih',root.id]]);
  for(const [i,name]of source.org_units.entries()){if(units.has(name))continue;const existing=one(db,'SELECT id FROM org_units WHERE name=?',name);const u=existing||insert(db,'org_units',{code:`BP-ORG-${String(i).padStart(2,'0')}`,name,parent_id:root.id,is_active:1});units.set(name,u.id);}
  for(const [i,p]of source.positions.entries()){if(!one(db,'SELECT id FROM positions WHERE name=? AND org_unit_id=?',p.name,units.get(p.org_path)))insert(db,'positions',{code:`BP-POS-${String(i+1).padStart(3,'0')}`,name:p.name,org_unit_id:units.get(p.org_path),is_active:1});}
  let added=0;
  for(const c of source.candidates){const cell=c.source_cells.join(', ');if(one(db,'SELECT id FROM import_candidates WHERE source_name=? AND source_cell=? AND full_name=?',source.source_name,cell,c.full_name))continue;insert(db,'import_candidates',{full_name:c.full_name,position_name:c.positions.map(p=>p.name).join(' / '),org_path:[...new Set(c.positions.map(p=>p.org_path))].join(' / '),source_cell:cell,source_name:source.source_name,status:'PENDING',notes:source.notes});added++;}
  audit(db,null,'STAGE_IMPORT','import_candidates',source.source_name,{added});console.log(`${added} calon data ditambahkan untuk ditinjau. Tidak ada akun atau profil pegawai aktif yang dibuat otomatis.`);
});}finally{db.close();}
