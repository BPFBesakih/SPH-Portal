import assert from 'node:assert/strict';

export function driveFixture(options={}){
 const env={GOOGLE_DRIVE_FOLDER_ID:'fixture_folder',GOOGLE_DRIVE_CLIENT_ID:'fixture-client',GOOGLE_DRIVE_CLIENT_SECRET:'fixture-secret',GOOGLE_DRIVE_REFRESH_TOKEN:'fixture-refresh'};
 const files=new Map(),calls=[];let sequence=0,uncertain=options.uncertainMove;
 const add=(id,values={})=>{const row={id,parents:[env.GOOGLE_DRIVE_FOLDER_ID],trashed:false,mimeType:'image/png',appProperties:{sph_portal:'v1'},data:Buffer.from('fixture-content'),...values};files.set(id,row);return row;};
 add('legacy_file_001');
 const metadata=row=>{const {data,...meta}=row;return structuredClone(meta);};
 async function fetch(url,init={}){
  calls.push({url:String(url),init});assert.equal(init.redirect,'manual');
  const u=new URL(url);
  if(u.origin==='https://oauth2.googleapis.com')return Response.json({access_token:'fixture-access'});
  assert.equal(u.origin,'https://www.googleapis.com');assert.equal(init.headers.Authorization,'Bearer fixture-access');
  if(u.pathname==='/upload/drive/v3/files'){
   const bytes=Buffer.from(await init.body.arrayBuffer());
   const first=bytes.indexOf('\r\n\r\n')+4,end=bytes.indexOf('\r\n',first),meta=JSON.parse(bytes.subarray(first,end));
   const start=bytes.indexOf('\r\n\r\n',end)+4,boundary=init.headers['Content-Type'].split('boundary=')[1];
   const finish=bytes.lastIndexOf(`\r\n--${boundary}--`);
   const row=add(`uploaded_file_${++sequence}`,{...meta,mimeType:bytes.subarray(end,start).toString().match(/Content-Type: ([^\r]+)/)[1],data:bytes.subarray(start,finish)});
   return Response.json({id:row.id});
  }
  if(u.pathname==='/drive/v3/files'&&init.method==='POST'){
   if(options.folderError)return Response.json({error:{errors:[{reason:'insufficientPermissions'}]}},{status:403});
   const body=JSON.parse(init.body),row=add(`module_folder_${++sequence}`,body);
   return Response.json(metadata(row));
  }
  if(u.pathname==='/drive/v3/files'){
   const module=u.searchParams.get('q').match(/key='sph_module' and value='([^']+)'/)[1];
   const matching=[...files.values()].filter(f=>f.mimeType==='application/vnd.google-apps.folder'&&f.parents.includes(env.GOOGLE_DRIVE_FOLDER_ID)&&f.appProperties.sph_module===module&&!f.trashed);
   return Response.json({files:[...(options.extraCandidates||[]),...matching.map(metadata)]});
  }
  const id=u.pathname.split('/').at(-1),row=files.get(id);
  if(!row)return Response.json({error:{errors:[{reason:'notFound'}]}},{status:404});
  if(init.method==='DELETE'){files.delete(id);return new Response(null,{status:204});}
  if(init.method==='PATCH'){
   const from=u.searchParams.get('removeParents'),to=u.searchParams.get('addParents');
   row.parents=[...row.parents.filter(p=>p!==from),to];
   for(const [key,value] of Object.entries(JSON.parse(init.body).appProperties||{}))if(value===null)delete row.appProperties[key];else row.appProperties[key]=value;
   if(uncertain){uncertain=false;throw new Error('fixture: lost acknowledgement after move');}
   return Response.json(metadata(row));
  }
  if(u.searchParams.get('alt')==='media')return new Response(row.data);
  return Response.json(metadata(row));
 }
 return {env,files,calls,add,fetch};
}
