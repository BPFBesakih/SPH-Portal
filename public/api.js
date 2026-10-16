export const state={me:null,module:'hr',route:'dashboard',items:[],lookups:{},dashboard:null,periods:[],periodId:null,revision:null,revisionId:null,configKey:'posts',date:null,filter:'',unit:'',category:'',page:1,permissions:[]};
export const permitted=code=>state.permissions.includes(code);
export async function api(path,options={}) {
  const headers={...options.headers};if(options.body!==undefined){headers['Content-Type']='application/json';options={...options,body:JSON.stringify(options.body)};}
  if(state.me?.csrfToken)headers['X-CSRF-Token']=state.me.csrfToken;
  const response=await fetch(`/api/${path}`,{...options,headers,credentials:'same-origin'});
  const data=await response.json();if(!response.ok){if(response.status===401&&state.me){state.me=null;document.dispatchEvent(new Event('session-ended'));}const e=new Error(data.error||'Permintaan gagal.');e.status=response.status;throw e;}return data;
}
export const post=(path,body)=>api(path,{method:'POST',body});
export const patch=(path,body)=>api(path,{method:'PATCH',body});
export const refresh=()=>document.dispatchEvent(new Event('refresh-app'));
export async function uploadFile(file) {
  if(!file?.size)throw new Error('Pilih berkas terlebih dahulu.');if(file.size>10*1024*1024)throw new Error('Ukuran maksimum berkas 10 MB.');
  const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  const ext=file.name.split('.').pop().toLowerCase(),mime={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}[ext];
  return post('uploads',{name:file.name,mime_type:mime,data:btoa(binary)});
}
