import {mkdtempSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {openDb,insert} from '../lib/db.mjs';
import {digest} from '../lib/auth.mjs';
import {createApp} from '../server.mjs';
const db=openDb(':memory:'),token='1'.repeat(64),directory=mkdtempSync(resolve(tmpdir(),'native-coaching-preview-'));
const unit=insert(db,'org_units',{code:'FIXTURE',name:'Unit Contoh',is_active:1}),position=insert(db,'positions',{code:'FIXTURE',name:'Staf Contoh',org_unit_id:unit.id,is_active:1});
for(const [i,name] of ['Pegawai Contoh','Coach Contoh','Pegawai Lain'].entries()){
 const employee=insert(db,'employees',{employee_no:`FIXTURE${i}`,full_name:name,employment_status:'Tetap',joined_on:'2020-01-01',is_active:1});insert(db,'employee_placements',{employee_id:employee.id,position_id:position.id,valid_from:'2020-01-01',is_primary:1});
}
insert(db,'coaching_links',{token_hash:digest(token),label:'Formulir Coaching Uji',is_active:1,created_by:null});
const {server}=createApp({db,dataDir:directory,origin:'http://127.0.0.1:4603'});
server.listen(4603,'127.0.0.1',()=>console.log(`Fixture preview http://127.0.0.1:4603/coaching/#${token}`));
writeFileSync(new URL('../test-results/coaching-native/fixture-photo.png',import.meta.url),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX5kAAAAASUVORK5CYII=','base64'));
