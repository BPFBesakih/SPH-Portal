/* sw.js — Service Worker halaman absen (SPH-Portal). Lingkup: /absen/ saja.
   Hanya menyimpan tampilan halaman (app shell) supaya cepat dibuka. Balasan /api/
   TIDAK PERNAH disimpan. Jaringan didahulukan supaya versi baru langsung terpakai.
   Naikkan CACHE setiap ada perubahan berkas. */
const CACHE='sph-absen-v1.1.0';
const SHELL=['./','./index.html','./absen.css','./absen.js','./absen-core.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/icon-maskable-512.png'];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL.map(url=>new Request(url,{cache:'reload'})))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('sph-absen-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 const request=event.request;if(request.method!=='GET')return;
 const url=new URL(request.url);
 if(url.origin!==self.location.origin||url.pathname.startsWith('/api/')||!url.pathname.startsWith(new URL('./',self.registration.scope).pathname))return;
 event.respondWith(fetch(request).then(response=>{
  if(response.ok&&response.type==='basic'){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{});}
  return response;
 }).catch(()=>caches.match(request,{ignoreSearch:true}).then(cached=>cached||caches.match('./index.html'))));
});
