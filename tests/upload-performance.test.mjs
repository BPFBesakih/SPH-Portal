import test from 'node:test';
import assert from 'node:assert/strict';
import {createDriveStorage} from '../supabase/functions/_shared/portal/drive.mjs';
import {driveFixture} from './helpers/drive-fixture.mjs';
const oauth=f=>f.calls.filter(c=>c.url.startsWith('https://oauth2.googleapis.com')).length;
test('completed OAuth tokens are reused until expiry and isolated by credential configuration',async t=>{
 const f=driveFixture(),cache=new Map(),storage=(env=f.env)=>createDriveStorage(env,f.fetch,{tokenCache:cache});const data=Buffer.from('fixture');
 await storage().put(data,'image/png');await storage().put(data,'image/png');assert.equal(oauth(f),1);
 const clock=Date.now();t.mock.method(Date,'now',()=>clock+3601000);await storage().put(data,'image/png');assert.equal(oauth(f),2);
 await storage({...f.env,GOOGLE_DRIVE_CLIENT_ID:'changed-client'}).put(data,'image/png');assert.equal(oauth(f),3);assert(cache.size<=4);
});
test('revoked cached access fails once, is discarded, and reacquires access on the next request',async()=>{
 const f=driveFixture(),cache=new Map();let deny=false;const fetch=async(url,init)=>deny&&url.startsWith('https://www.googleapis.com')?Response.json({error:{errors:[{reason:'authError'}]}},{status:401}):f.fetch(url,init);
 const storage=()=>createDriveStorage(f.env,fetch,{tokenCache:cache});await storage().put(Buffer.from('fixture'),'image/png');deny=true;await assert.rejects(storage().put(Buffer.from('fixture'),'image/png'),e=>e.status===503);assert.equal(cache.size,0);assert.equal(oauth(f),1);deny=false;await storage().put(Buffer.from('fixture'),'image/png');assert.equal(oauth(f),2);
});
test('five direct camera uploads finalize with verified metadata in seven upstream calls instead of seventeen',async()=>{
 const f=driveFixture();f.add('existing_module',{mimeType:'application/vnd.google-apps.folder',appProperties:{sph_portal:'v1',sph_module:'patroli'}});const s=createDriveStorage(f.env,f.fetch,{module:'patroli'});
 for(let i=0;i<5;i++){const id=await s.put(Buffer.from('fixture'),'image/png');s.claim(id);}await s.finalize();assert.equal(f.calls.length,7);assert.equal(f.calls.filter(c=>new URL(c.url).pathname.startsWith('/drive/v3/files/')).length,0);assert(!f.calls.some(c=>c.url.includes('/permissions')));
 console.log(JSON.stringify({fixture:'five direct patrol photos',before_storage_requests:17,after_storage_requests:f.calls.length}));
});
test('unexpected upload metadata is rejected and rollback removes only the newly created upload',async()=>{
 const f=driveFixture(),fetch=async(url,init)=>{const r=await f.fetch(url,init);if(url.includes('/upload/'))return Response.json({...await r.json(),parents:['foreign_folder']});return r;};const s=createDriveStorage(f.env,fetch);await assert.rejects(s.put(Buffer.from('fixture'),'image/png'),e=>e.status===503);await s.rollback();assert(f.files.has('legacy_file_001'));assert.equal(f.calls.filter(c=>c.init.method==='DELETE').length,1);
});
