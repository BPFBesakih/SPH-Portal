import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {openDb,insert,one,tx,today,now} from '../lib/db.mjs';
import {seedPermissions,digest,hashPasswordSync} from '../lib/auth.mjs';
import {publicBriefingLink} from '../lib/briefings.mjs';
import {createApp} from '../server.mjs';

// Isolated fixture: never opens the workspace database or any cloud service.
const db=openDb(':memory:'),directory=mkdtempSync(resolve(tmpdir(),'briefing-preview-')),token='1'.repeat(64),port=4614;
seedPermissions(db);
const employees=[],units=[];
for(const [index,name]of ['Operasional & Pelayanan','Sekretariat'].entries()){
  const unit=insert(db,'org_units',{code:`PREVIEW${index}`,name,is_active:1});units.push(unit);
  const position=insert(db,'positions',{code:`PREVIEW${index}`,name:index?'Staf Sumber Daya Manusia':'Koordinator Pelayanan',org_unit_id:unit.id,is_active:1});
  const employee=insert(db,'employees',{employee_no:`DEMO${index}`,full_name:index?'Putu Contoh':'Made Contoh',employment_status:'Tetap',is_active:1,joined_on:'2020-01-01'});employees.push(employee);
  insert(db,'employee_placements',{employee_id:employee.id,position_id:position.id,valid_from:'2020-01-01',is_primary:1});
  const user=insert(db,'users',{username:index?'sdm.preview':'pegawai.preview',employee_id:employee.id,password_hash:hashPasswordSync('Preview2026!'),status:'ACTIVE',must_change_password:0,failed_login_count:0,password_changed_at:now()});
  insert(db,'user_roles',{user_id:user.id,role_id:one(db,'SELECT id FROM roles WHERE code=?',index?'SDM':'EMPLOYEE').id,scope_kind:index?'ALL':'SELF'});
}
insert(db,'briefing_links',{token_hash:digest(token),share_token:token,label:'Briefing Pagi (Wewarah Semeng)',is_active:1,created_by:null});
const photo={data:readFileSync(new URL('../public/assets/icons/icon-192.png',import.meta.url)).toString('base64'),mime_type:'image/png',captured_at:now(),source:'CAMERA'};
for(const [index,employee]of employees.entries())tx(db,()=>publicBriefingLink(db,'submit',{token,employee_id:employee.id,org_unit_id:units[index].id,held_on:today(),section:index?'Sumber Daya Manusia':'Pelayanan & Informasi',absent_notes:'Nihil',briefing_notes:index?'Contoh: Koordinasikan kebutuhan pegawai dan tindak lanjut pelatihan hari ini.':'Contoh: Sambut pengunjung dengan ramah, periksa kesiapan area pelayanan, dan sampaikan kendala kepada koordinator.',photo,idempotency_key:crypto.randomUUID()},directory,'fixture-preview'));
const {server}=createApp({db,dataDir:directory,origin:`http://127.0.0.1:${port}`});
server.listen(port,'127.0.0.1',()=>console.log(`Fixture: http://127.0.0.1:${port}/#briefings | form: /briefing-pagi/#${token} | sdm.preview / pegawai.preview | password: Preview2026!`));
