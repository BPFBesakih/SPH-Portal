import test from 'node:test';
import assert from 'node:assert/strict';
import {createDriveStorage} from '../supabase/functions/_shared/portal/drive.mjs';
const env={GOOGLE_DRIVE_FOLDER_ID:'fixture_folder',GOOGLE_DRIVE_CLIENT_ID:'fixture-client',GOOGLE_DRIVE_CLIENT_SECRET:'fixture-secret',GOOGLE_DRIVE_REFRESH_TOKEN:'fixture-refresh'};
function fixture(options={}){
 const calls=[];
 const storage=createDriveStorage(env,async(url,init)=>{
  calls.push({url,init});assert.equal(init.redirect,'manual');
  if(options.throws)throw new Error('private-upstream-detail');
  if(url==='https://oauth2.googleapis.com/token')return options.tokenError?new Response('private-upstream-detail',{status:400}):Response.json({access_token:'fixture-access'});
  assert.equal(init.headers.Authorization,'Bearer fixture-access');
  if(options.redirect)return new Response(null,{status:302,headers:{Location:'https://attacker.invalid'}});
  if(init.method==='POST')return Response.json({id:'fixture_file_001'});
  if(init.method==='DELETE')return new Response(null,{status:204});
  if(url.includes('alt=media'))return new Response('fixture-content');
  return Response.json({id:'fixture_file_001',parents:[options.foreign?'other_folder':env.GOOGLE_DRIVE_FOLDER_ID],trashed:false,appProperties:{sph_portal:'v1'}});
 });return {storage,calls};
}
test('private Drive uploads use the existing folder, opaque names and no public permissions',async()=>{
 const f=fixture();const id=await f.storage.put(Buffer.from('fixture-content'),'image/png','private-name.png');assert.equal(id,'fixture_file_001');
 const upload=f.calls.find(c=>c.init.method==='POST'&&c.url.includes('/upload/'));const body=await upload.init.body.text();
 assert(body.includes('fixture_folder'));assert.equal(body.includes('private-name.png'),false);assert.equal(body.includes('permissions'),false);assert.equal(body.includes('anyone'),false);
 assert.equal(f.calls[0].init.body.get('refresh_token'),env.GOOGLE_DRIVE_REFRESH_TOKEN);
});
test('Drive downloads check folder ownership and app metadata before reading media',async()=>{
 const f=fixture();assert.equal((await f.storage.get('fixture_file_001')).toString(),'fixture-content');
 const foreign=fixture({foreign:true});await assert.rejects(foreign.storage.get('fixture_file_001'),e=>e.status===404);assert.equal(foreign.calls.some(c=>c.url.includes('alt=media')),false);
 await assert.rejects(f.storage.get('../outside'),e=>e.status===404);
});
test('failed database work can clean up only uploads created by that request',async()=>{
 const f=fixture();await f.storage.get('fixture_file_001');await f.storage.rollback();assert.equal(f.calls.some(c=>c.init.method==='DELETE'),false);
 await f.storage.put(Buffer.from('x'),'image/png');await f.storage.rollback();assert.equal(f.calls.filter(c=>c.init.method==='DELETE').length,1);
});
test('Drive failures and redirects never disclose upstream details or follow another origin',async()=>{
 for(const options of [{throws:true},{tokenError:true},{redirect:true}]){
  const f=fixture(options);await assert.rejects(f.storage.put(Buffer.from('x'),'image/png'),error=>error.status===503&&!error.message.includes('private-upstream-detail'));
  assert.equal(f.calls.some(c=>c.url.startsWith('https://attacker.invalid')),false);
 }
});
