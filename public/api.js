import {createRequestQueue} from './request-queue.js';
export const state={me:null,module:'hr',route:'dashboard',items:[],lookups:{},dashboard:null,periods:[],periodId:null,revision:null,revisionId:null,configKey:'posts',date:null,filter:'',unit:'',category:'',page:1,permissions:[]};
export const permitted=code=>state.permissions.includes(code);
const enqueue=createRequestQueue();
export function api(path,options={}){
  const {background=false,...requestOptions}=options;
  const session=state.me;
  return enqueue(()=>{
    // Discard queued work from an ended/replaced login before it reaches fetch.
    if(session!==state.me){const error=new Error('Sesi berubah.');error.name='AbortError';throw error;}
    return sendRequest(path,requestOptions);
  },{background});
}
async function sendRequest(path,options={}) {
  const headers={...options.headers};if(options.body!==undefined&&!(options.body instanceof Blob)){headers['Content-Type']='application/json';options={...options,body:JSON.stringify(options.body)};}
  if(state.me?.csrfToken)headers['X-CSRF-Token']=state.me.csrfToken;
  const response=await fetch(`/api/${path}`,{...options,headers,credentials:'same-origin'});
  const data=await response.json();if(!response.ok){if(response.status===401&&state.me){state.me=null;document.dispatchEvent(new Event('session-ended'));}const e=new Error(data.error||'Permintaan gagal.');e.status=response.status;throw e;}
  if(options.method&&options.method!=='GET')document.dispatchEvent(new Event('data-changed'));
  return data;
}
export const post=(path,body)=>api(path,{method:'POST',body});
export const patch=(path,body)=>api(path,{method:'PATCH',body});
export const refresh=()=>document.dispatchEvent(new Event('refresh-app'));
export async function uploadFile(file) {
  if(!file?.size)throw new Error('Pilih berkas terlebih dahulu.');if(file.size>10*1024*1024)throw new Error('Ukuran maksimum berkas 10 MB.');
  const ext=file.name.split('.').pop().toLowerCase(),mime={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}[ext];
  if(!mime)throw new Error('Jenis berkas yang diizinkan: PDF, PNG, JPEG, DOCX, XLSX.');
  return api('uploads',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Upload-Name':encodeURIComponent(file.name),'X-Upload-Type':mime},body:file});
}
