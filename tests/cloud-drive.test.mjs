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
  if(init.method==='POST')return Response.json({id:'fixture_file_001',parents:[env.GOOGLE_DRIVE_FOLDER_ID],trashed:false,mimeType:'image/png',appProperties:{sph_portal:'v1'}});
  if(init.method==='DELETE')return new Response(null,{status:204});
  if(url.includes('alt=media'))return new Response('fixture-content');
  return Response.json({id:'fixture_file_001',parents:[options.foreign?'other_folder':env.GOOGLE_DRIVE_FOLDER_ID],trashed:false,mimeType:'image/png',appProperties:{sph_portal:'v1'}});
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
test('Drive storage identifies token, permission and folder errors without returning private Google details',async()=>{
 for(const [stage,status,reason] of [['token',400,'invalid_grant'],['token',401,'invalid_client'],['upload',403,'insufficientPermissions'],['upload',404,'notFound'],['upload',403,'storageQuotaExceeded']]){
  const storage=createDriveStorage(env,async url=>{
   if(url==='https://oauth2.googleapis.com/token'&&stage!=='token')return Response.json({access_token:'private-access-token'});
   return Response.json(stage==='token'?{error:reason,error_description:'private-google-detail'}:{error:{message:'private-google-detail',errors:[{reason,message:'private-google-detail'}]}},{status});
  });
  await assert.rejects(storage.put(Buffer.from('x'),'image/png'),error=>{
   assert.equal(error.status,503);assert.deepEqual(error.details,{service:'google_drive',stage,upstream_status:status,reason});
   assert.equal(JSON.stringify(error).includes('private-'),false);assert.equal(error.message.includes('private-'),false);return true;
  });
 }
});
test('unknown or oversized Google errors cannot inject private values into storage diagnostics',async()=>{
 for(const body of [JSON.stringify({error:{message:'private-message',errors:[{reason:'private-token-or-folder-id'}]}}),'private-upstream-response'.repeat(2000)]){
  const storage=createDriveStorage(env,async url=>url==='https://oauth2.googleapis.com/token'?Response.json({access_token:'private-access-token'}):new Response(body,{status:403}));
  await assert.rejects(storage.put(Buffer.from('x'),'image/png'),error=>error.details.stage==='upload'&&error.details.reason==='unknown'&&!JSON.stringify(error).includes('private-'));
 }
});
test('Drive settings ignore surrounding whitespace consistently with the connection check',async()=>{
 const padded=Object.fromEntries(Object.entries(env).map(([key,value])=>[key,` \n${value}\n `]));
 const storage=createDriveStorage(padded,async(url,init)=>{
  if(url==='https://oauth2.googleapis.com/token'){
   for(const [name,key] of [['client_id','GOOGLE_DRIVE_CLIENT_ID'],['client_secret','GOOGLE_DRIVE_CLIENT_SECRET'],['refresh_token','GOOGLE_DRIVE_REFRESH_TOKEN']])assert.equal(init.body.get(name),env[key]);
   return Response.json({access_token:'fixture-access'});
  }
  const body=await init.body.text();assert(body.includes('"parents":["fixture_folder"]'));return Response.json({id:'fixture_file_001',parents:[env.GOOGLE_DRIVE_FOLDER_ID],trashed:false,mimeType:'image/png',appProperties:{sph_portal:'v1'}});
 });
 assert.equal(await storage.put(Buffer.from('x'),'image/png'),'fixture_file_001');
});
