// Inti halaman absen: kunci HP, penyimpanan di HP, dan permintaan bertanda tangan.
//  - Kunci dibuat dengan WebCrypto (ECDSA P-256) dan kunci privatnya TIDAK bisa diekspor;
//    yang dikirim ke portal hanya kunci publik. Kunci disimpan di IndexedDB HP ini.
//  - Setiap permintaan ke /api/attendance-form/* (kecuali pendaftaran) ditandatangani
//    bersama jam yang sudah disesuaikan ke jam server, jadi jam HP yang salah tidak masalah.
//  - Tidak ada data pegawai, selfie, atau riwayat yang disimpan di HP.
const DB_NAME='sph-absen',STORE='device',KEY='current';
function openStore(){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(DB_NAME,1);
  request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||new Error('Penyimpanan HP tidak dapat dibuka.'));
 });
}
async function withStore(mode,work){
 const db=await openStore();
 return new Promise((resolve,reject)=>{
  const transaction=db.transaction(STORE,mode),request=work(transaction.objectStore(STORE));
  transaction.oncomplete=()=>{db.close();resolve(request?.result);};
  transaction.onerror=transaction.onabort=()=>{db.close();reject(transaction.error||new Error('Penyimpanan HP gagal.'));};
 });
}
export const loadDevice=()=>withStore('readonly',store=>store.get(KEY));
export const saveDevice=record=>withStore('readwrite',store=>store.put(record,KEY));
export const forgetDevice=()=>withStore('readwrite',store=>store.delete(KEY));

export const newKeys=()=>crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
export async function publicKeyOf(keys){const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);return {kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y};}
const base64url=buffer=>{let text='';for(const byte of new Uint8Array(buffer))text+=String.fromCharCode(byte);return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};

// Selisih jam server − jam HP, diperbarui dari setiap balasan server.
let offset=0;
export const serverNow=()=>Date.now()+offset;
export function syncClock(serverTime){const ms=Date.parse(serverTime);if(Number.isFinite(ms))offset=ms-Date.now();}

export class FormError extends Error{constructor(message,status,details){super(message);this.status=status;this.details=details||{};}}
export async function request(action,body){
 let response;
 try{
  response=await fetch(`/api/attendance-form/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
   credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(40000)});
 }catch{throw new FormError(navigator.onLine===false?'Tidak ada sinyal internet. Coba lagi saat ada sinyal.':'Server belum dapat dihubungi. Coba lagi.',0);}
 let data={};try{data=await response.json();}catch{}
 if(!response.ok)throw new FormError(typeof data.error==='string'?data.error:'Permintaan belum berhasil. Coba lagi.',response.status,data.details);
 if(typeof data.server_time==='string')syncClock(data.server_time);
 return data;
}
async function sign(keys,action,deviceId,payload){
 const raw=JSON.stringify(payload||{}),ts=Math.round(serverNow());
 const message=new TextEncoder().encode(`sph-absen-v1\n${action}\n${deviceId}\n${ts}\n${raw}`);
 const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,message);
 return {device_id:deviceId,ts,sig:base64url(signature),payload:raw};
}
// Permintaan dari HP terdaftar. Bila jam HP berbeda jauh, jam disesuaikan lalu dicoba sekali lagi.
export async function signedRequest(device,action,payload,retry=true){
 try{return await request(action,await sign(device.keys,action,device.device_id,payload));}
 catch(error){
  if(retry&&error.status===401&&error.details?.code==='CLOCK'&&error.details.server_time){syncClock(error.details.server_time);return signedRequest(device,action,payload,false);}
  throw error;
 }
}
// Bukti bahwa HP ini memegang kunci pendaftaran lama, supaya pendaftaran lama dicabut.
export const replacementProof=(device,token)=>sign(device.keys,'replace',device.device_id,{token});

export function uuid(){
 if(crypto.randomUUID)return crypto.randomUUID();
 const b=crypto.getRandomValues(new Uint8Array(16));b[6]=b[6]&15|64;b[8]=b[8]&63|128;
 const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
