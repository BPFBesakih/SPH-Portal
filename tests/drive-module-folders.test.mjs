import test from 'node:test';
import assert from 'node:assert/strict';
import {createDriveStorage,driveModuleForOperation,driveModuleFolders} from '../supabase/functions/_shared/portal/drive.mjs';
import {driveFixture} from './helpers/drive-fixture.mjs';

const make=(module,options={})=>{const f=driveFixture(options);return {...f,storage:createDriveStorage(f.env,f.fetch,{module})};};
const folderPosts=f=>f.calls.filter(c=>new URL(c.url).pathname==='/drive/v3/files'&&c.init.method==='POST');
const mediaReads=f=>f.calls.filter(c=>new URL(c.url).searchParams.get('alt')==='media');

test('attachment operations select fixed server-side module folders',()=>{
 for(const [path,body,module] of [
  ['documents/doc-id/versions',{},'sop'],['training/event-id/documentation',{},'pelatihan'],
  ['employees/employee-id/contracts',{},'pegawai'],['attachments',{type:'employee'},'pegawai'],
  ['logbook',{},'patroli'],['attachments',{type:'logbook'},'patroli'],['incidents/incident-id/updates',{},'kejadian'],
  ['attachments',{type:'incident'},'kejadian'],['announcements',{},'informasi'],
  ['purchasing/orders/order-id/attachments',{},'pengadaan'],['website/media',{},'website'],
  ['uploads',{module:'sop',folder_id:'attacker_folder'},null],['files/anything',{},null],['attachments',{type:'../../sop'},null],
 ])assert.equal(driveModuleForOperation(path,body),module);
});

test('successful attachment finalization creates one private SOP folder and preserves file IDs',async()=>{
 const f=make('sop');f.storage.claim('legacy_file_001');f.storage.claim('legacy_file_001');
 assert.equal(folderPosts(f).length,0);
 await f.storage.finalize();
 const folder=[...f.files.values()].find(x=>x.mimeType==='application/vnd.google-apps.folder');
 assert.equal(folder.name,'SPH-Portal-SOP');assert.deepEqual(folder.parents,['fixture_folder']);
 assert.deepEqual(f.files.get('legacy_file_001').parents,[folder.id]);
 assert.equal(f.files.get('legacy_file_001').appProperties.sph_module,'sop');
 f.add('legacy_file_002');f.storage.claim('legacy_file_002');await f.storage.finalize();
 assert.deepEqual(f.files.get('legacy_file_002').parents,[folder.id]);assert.equal(folderPosts(f).length,1);
 assert.equal(f.calls.some(c=>c.url.includes('/permissions')),false);
});

test('a later request reuses the tagged module folder instead of creating duplicates',async()=>{
 const f=make('pelatihan');f.storage.claim('legacy_file_001');await f.storage.finalize();
 const folder=f.files.get('legacy_file_001').parents[0];
 f.add('legacy_file_002');const later=createDriveStorage(f.env,f.fetch,{module:'pelatihan'});
 later.claim('legacy_file_002');await later.finalize();
 assert.deepEqual(f.files.get('legacy_file_002').parents,[folder]);assert.equal(folderPosts(f).length,1);
 assert.equal((await later.get('legacy_file_002','pelatihan')).toString(),'fixture-content');
});

test('authorized reads organize legacy root files without changing their contents or IDs',async()=>{
 const f=make();const before=f.files.get('legacy_file_001').data;
 assert.deepEqual(await f.storage.get('legacy_file_001','sop'),before);
 assert.equal(f.files.get('legacy_file_001').id,'legacy_file_001');
 assert.equal(f.files.get('legacy_file_001').appProperties.sph_module,'sop');
 assert.equal(f.calls.filter(c=>c.init.method==='PATCH').length,1);
 await f.storage.get('legacy_file_001','sop');assert.equal(f.calls.filter(c=>c.init.method==='PATCH').length,1);
});

test('each module uses a distinct folder, including direct website uploads',async()=>{
 const f=make();const parents=new Set();
 for(const [module,name] of Object.entries(driveModuleFolders)){
  const storage=createDriveStorage(f.env,f.fetch,{module});
  const id=await storage.put(Buffer.from('bytes'),'image/png','private-name.png');
  const file=f.files.get(id),parent=f.files.get(file.parents[0]);
  assert.equal(parent.name,name);assert.equal(file.appProperties.sph_module,module);
  assert.notEqual(file.name,'private-name.png');assert.equal(file.data.toString(),'bytes');parents.add(parent.id);
  assert.equal((await storage.get(id)).toString(),'bytes');
 }
 assert.equal(parents.size,Object.keys(driveModuleFolders).length);
});

test('legacy files remain readable without migration when their module is not requested',async()=>{
 const f=make();assert.equal((await f.storage.get('legacy_file_001')).toString(),'fixture-content');
 assert.equal(folderPosts(f).length,0);assert.deepEqual(f.files.get('legacy_file_001').parents,['fixture_folder']);
});

test('foreign, trashed, untagged, mismatched and nested folders are rejected before media access',async()=>{
 for(const change of [
  parent=>{parent.parents=['foreign_root'];},parent=>{parent.trashed=true;},
  parent=>{delete parent.appProperties.sph_portal;},parent=>{parent.appProperties.sph_module='unknown';},
  (parent,file)=>{file.appProperties.sph_module='sop';},parent=>{parent.mimeType='image/png';},
  parent=>{parent.parents=['nested_folder'];},
 ]){
  const f=make('pelatihan');f.storage.claim('legacy_file_001');await f.storage.finalize();
  const file=f.files.get('legacy_file_001'),parent=f.files.get(file.parents[0]);change(parent,file);
  await assert.rejects(f.storage.get(file.id),e=>e.status===404);assert.equal(mediaReads(f).length,0);
 }
});

test('folder search results are validated instead of trusting their names or the query',async()=>{
 const impostor={id:'foreign_candidate',name:'SPH-Portal-SOP',mimeType:'application/vnd.google-apps.folder',parents:['foreign_root'],trashed:false,appProperties:{sph_portal:'v1',sph_module:'sop'}};
 const f=make('sop',{extraCandidates:[impostor]});
 f.storage.claim('legacy_file_001');await f.storage.finalize();
 assert.notEqual(f.files.get('legacy_file_001').parents[0],impostor.id);assert.equal(folderPosts(f).length,1);
});

test('rollback restores preexisting attachments after a failed database operation',async()=>{
 const f=make('sop');f.storage.claim('legacy_file_001');await f.storage.finalize();await f.storage.rollback();
 const file=f.files.get('legacy_file_001');assert.deepEqual(file.parents,['fixture_folder']);
 assert.deepEqual(file.appProperties,{sph_portal:'v1'});assert.equal(file.data.toString(),'fixture-content');
 assert.equal(f.calls.some(c=>c.init.method==='DELETE'),false);
});

test('rollback reconciles a move whose network acknowledgement was lost',async()=>{
 const f=make('sop',{uncertainMove:true});f.storage.claim('legacy_file_001');
 await assert.rejects(f.storage.finalize(),e=>e.status===503);await f.storage.rollback();
 assert.deepEqual(f.files.get('legacy_file_001').parents,['fixture_folder']);
 assert.equal(f.files.get('legacy_file_001').appProperties.sph_module,undefined);
});

test('folder permission failures leave legacy files untouched and reveal no Google response body',async()=>{
 const f=make('sop',{folderError:true});f.storage.claim('legacy_file_001');
 await assert.rejects(f.storage.finalize(),e=>e.status===503&&e.details.stage==='folder'&&e.details.reason==='insufficientPermissions');
 assert.deepEqual(f.files.get('legacy_file_001').parents,['fixture_folder']);assert.equal(f.calls.some(c=>c.init.method==='PATCH'),false);
});

test('unknown modules cannot create folders or move claimed uploads',async()=>{
 const f=make('../../outside');f.storage.claim('legacy_file_001');
 await assert.rejects(f.storage.finalize(),e=>e.status===503);assert.equal(f.calls.length,0);
 await assert.rejects(f.storage.put(Buffer.from('x'),'image/png'),e=>e.status===422);assert.equal(f.calls.length,0);
});
