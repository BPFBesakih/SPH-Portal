import {loadDevice,saveDevice,forgetDevice,newKeys,publicKeyOf,request,signedRequest,replacementProof,serverNow,uuid,FormError} from './absen-core.js';

// Halaman absen BP Besakih. Alur harian dibuat sesingkat mungkin untuk pegawai yang
// belum terbiasa memakai HP: buka ikon → (pilih nama) → MASUK/PULANG → selfie.
// Yang didaftarkan adalah HP; di HP terdaftar mana pun siapa saja bisa absen dengan
// memilih namanya (pegawai tanpa HP menumpang di HP teman, koordinator, atau HP pos).
const app=document.querySelector('#app'),live=document.querySelector('#live');
const S={device:null,context:null,person:null,status:null,install:null,camera:null,attempt:null,timers:new Set(),searchSeq:0};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const witaTime=ms=>new Intl.DateTimeFormat('id-ID',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Makassar'}).format(new Date(ms));
const witaDay=ms=>new Intl.DateTimeFormat('id-ID',{weekday:'long',day:'numeric',month:'long',timeZone:'Asia/Makassar'}).format(new Date(ms));
const kindLabel={IN:'MASUK',OUT:'PULANG'};
const reasons=[['DINAS_LUAR','Dinas luar'],['TUGAS_LAPANGAN','Tugas lapangan'],['LAINNYA','Lainnya']];
const isIos=/iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
function say(text){live.textContent='';setTimeout(()=>{live.textContent=text;},30);}
function show(html,focus=true){clearTimers();app.innerHTML=html;if(focus)app.focus({preventScroll:true});window.scrollTo(0,0);}
function later(fn,ms){const id=setTimeout(()=>{S.timers.delete(id);fn();},ms);S.timers.add(id);return id;}
function clearTimers(){for(const id of S.timers)clearTimeout(id);S.timers.clear();}
function setLabel(text){document.querySelector('#device-label').textContent=text;}
setInterval(()=>{document.querySelector('#clock').textContent=witaTime(serverNow());},1000);
document.querySelector('#clock').textContent=witaTime(serverNow());
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();S.install=event;document.querySelectorAll('[data-install]').forEach(el=>{el.hidden=false;});});
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});

/* ---------- Layar umum ---------- */
function message(title,text,{tone='',actions=''}={}){
 show(`<section class="screen"><h1>${esc(title)}</h1>${text?`<div class="status ${tone}">${esc(text)}</div>`:''}${actions}</section>`);
}
function pasteBox(){
 return `<form class="card screen" data-paste><label class="field">Tempel tautan pendaftaran dari SDM<input type="url" name="link" inputmode="url" autocomplete="off" placeholder="https://bpbesakih.com/absen/#daftar=…" required></label><button class="primary wide" type="submit">Buka tautan</button></form>`;
}
function unregistered(note=''){
 setLabel('HP belum terdaftar');
 show(`<section class="screen">
  <h1>HP ini belum terdaftar untuk absen</h1>
  ${note?`<div class="status warn">${esc(note)}</div>`:''}
  <p class="lead">Minta SDM atau koordinator mengirim <strong>tautan pendaftaran</strong> lewat WhatsApp, lalu buka tautan itu di HP ini.</p>
  <p class="muted small">Pegawai yang tidak punya HP tidak perlu mendaftar. Cukup absen di HP teman atau koordinator yang sudah terdaftar.</p>
  ${isIos?`<p class="muted small">Di iPhone: pasang ikon dulu (Bagikan → Tambahkan ke Layar Utama), buka dari ikon itu, lalu tempel tautan pendaftaran di bawah.</p>`:''}
  ${pasteBox()}
 </section>`);
}
function failure(error,retry){
 const text=error instanceof FormError?error.message:'Terjadi gangguan. Coba lagi.';
 message('Belum berhasil',text,{tone:'bad',actions:`<div class="row">${retry?'<button class="primary" data-action="retry">Coba lagi</button>':''}<button class="secondary" data-action="home">Kembali</button></div>`});
 S.retry=retry||null;
}

/* ---------- Pendaftaran HP ---------- */
function readFragment(){
 const match=location.hash.match(/^#(daftar|sesi)=([a-f0-9]{64})$/);
 if(match)window.history.replaceState(null,'',location.pathname);
 return match?{kind:match[1],token:match[2]}:null;
}
async function registration(link){
 try{
  if(link.kind==='daftar'){
   const preview=await request('registration',{token:link.token});
   const who=preview.kind==='PERSONAL'?`HP pribadi milik <strong>${esc(preview.owner?.name)}</strong>${preview.owner?.position?`<br><span class="muted">${esc(preview.owner.position)}${preview.owner.unit?` · ${esc(preview.owner.unit)}`:''}</span>`:''}`:`HP bersama <strong>${esc(preview.label)}</strong>${preview.unit?.name?`<br><span class="muted">${esc(preview.unit.name)}</span>`:''}`;
   setLabel('Pendaftaran HP');
   show(`<section class="screen">
    <h1>Daftarkan HP ini untuk absen</h1>
    <div class="card"><p class="lead">HP ini akan didaftarkan sebagai:</p><p class="lead">${who}</p></div>
    ${replaceNote()}
    <button class="primary wide" data-action="register" data-token="${link.token}">Ya, daftarkan</button>
    <button class="ghost" data-action="home">Batal</button>
   </section>`);
   return;
  }
  const preview=await request('session',{token:link.token});
  S.session={token:link.token,preview};
  setLabel(`Sesi pendaftaran · ${preview.unit?.name||''}`);
  sessionPicker();
 }catch(error){
  if(error.status===404)unregistered(error.message);else failure(error,()=>registration(link));
 }
}
function replaceNote(){
 if(!S.device)return '';
 return `<div class="status warn">HP ini sudah terdaftar sebelumnya. Pendaftaran lama akan diganti dengan yang baru.</div>`;
}
function sessionList(query){
 const q=query.trim().toLowerCase(),people=S.session.preview.people.filter(p=>!q||p.name.toLowerCase().includes(q));
 return `<ul class="list">${people.map(p=>`<li><button data-action="session-person" data-id="${esc(p.id)}">${esc(p.name)}<small>${esc([p.position,p.unit].filter(Boolean).join(' · '))}</small></button></li>`).join('')||'<li class="muted">Nama tidak ditemukan di unit ini.</li>'}</ul>`;
}
function sessionPicker(){
 show(`<section class="screen">
  <h1>Pilih nama Anda</h1>
  <p class="muted">Sesi pendaftaran ${esc(S.session.preview.unit?.name||'')}. Pilih nama <strong>pemilik HP ini</strong>.</p>
  <label class="field">Cari nama<input type="search" data-session-search autocomplete="off"></label>
  <div data-session-list>${sessionList('')}</div>
 </section>`,false);
}
function sessionConfirm(person){
 show(`<section class="screen">
  <h1>Benar ini Anda?</h1>
  <div class="card person"><span class="name">${esc(person.name)}</span><span class="role">${esc([person.position,person.unit].filter(Boolean).join(' · '))}</span></div>
  ${replaceNote()}
  <button class="primary wide" data-action="session-register" data-id="${esc(person.id)}">Ya, ini HP saya</button>
  <button class="secondary wide" data-action="session-back">Bukan, pilih lagi</button>
 </section>`);
}
async function register(action,body){
 show('<section class="screen center"><div class="spinner"></div><p class="lead">Mendaftarkan HP…</p></section>');
 const keys=await newKeys();
 const payload={...body,public_key:await publicKeyOf(keys),client_info:navigator.userAgent.slice(0,200)};
 if(S.device?.keys&&S.device?.device_id)payload.replaces=await replacementProof(S.device,body.token);
 const result=await request(action,payload);
 S.device={device_id:result.device_id,keys,registered_at:new Date().toISOString()};
 await saveDevice(S.device);
 return result;
}
function installScreen(){
 const ready=standalone();
 show(`<section class="screen">
  <h1>HP berhasil didaftarkan</h1>
  <div class="status ok">HP ini sekarang bisa dipakai untuk absen.</div>
  ${ready?'':`<div class="card screen"><h2>Pasang ikon di layar utama</h2>
   ${isIos?`<ol class="steps"><li>Tekan tombol <strong>Bagikan</strong> di Safari.</li><li>Pilih <strong>Tambahkan ke Layar Utama</strong>.</li><li>Buka absen dari ikon <strong>Absen</strong>.</li></ol>`:`<button class="primary wide" data-action="install" data-install ${S.install?'':'hidden'}>Pasang ikon</button><ol class="steps"><li>Bila tombol di atas tidak muncul, buka menu <strong>⋮</strong> di Chrome.</li><li>Pilih <strong>Tambahkan ke layar utama</strong> atau <strong>Instal aplikasi</strong>.</li></ol>`}
  </div>`}
  <button class="${ready?'primary':'secondary'} wide" data-action="home">Mulai absen</button>
 </section>`);
}
async function waitApproval(){
 setLabel('Menunggu persetujuan');
 show(`<section class="screen center">
  <div class="spinner"></div>
  <h1>Menunggu persetujuan SDM</h1>
  <p class="lead">Tunjukkan nama Anda kepada petugas SDM. Halaman ini lanjut sendiri setelah disetujui.</p>
  <button class="ghost" data-action="forget">Batalkan pendaftaran di HP ini</button>
 </section>`);
 const poll=async()=>{
  try{
   const context=await signedRequest(S.device,'context',{});
   if(context.device.status==='ACTIVE'){S.context=context;installScreen();return;}
   if(context.device.status!=='PENDING'){inactive(context.device.status);return;}
  }catch(error){if(error.status===401){unregistered('Pendaftaran HP ini tidak ditemukan. Minta tautan baru.');return;}}
  later(poll,5000);
 };
 later(poll,4000);
}
function inactive(status){
 setLabel('HP tidak aktif');
 message(status==='REJECTED'?'Pendaftaran HP ditolak':'HP ini tidak aktif untuk absen',status==='REJECTED'?'Pendaftaran tidak disetujui atau sesi sudah berakhir. Minta SDM mendaftarkan HP ini lagi.':'HP ini sudah dinonaktifkan atau pemiliknya tidak aktif. Minta SDM mendaftarkan HP ini lagi.',
  {tone:'warn',actions:`${pasteBox()}<button class="ghost" data-action="forget">Hapus pendaftaran lama dari HP ini</button>`});
}

/* ---------- Beranda absen ---------- */
async function start(){
 S.device=await loadDevice().catch(()=>null);
 const link=readFragment();
 if(link){await registration(link);return;}
 await home();
}
async function home(){
 stopCapture();
 if(!S.device?.device_id){unregistered();return;}
 show('<section class="screen center"><div class="spinner"></div><p class="lead">Memuat…</p></section>',false);
 try{S.context=await signedRequest(S.device,'context',{});}
 catch(error){if(error.status===401&&!error.details?.code){unregistered('Pendaftaran HP ini tidak dikenali lagi. Minta tautan baru kepada SDM.');return;}failure(error,home);return;}
 const d=S.context.device;
 if(d.status==='PENDING'){await waitApproval();return;}
 if(d.status!=='ACTIVE'){inactive(d.status);return;}
 setLabel(d.kind==='SHARED'?`HP bersama · ${d.label}`:d.label);
 if(!S.person&&d.kind==='PERSONAL'&&d.owner)S.person=d.owner;
 if(!S.person){picker();return;}
 await personHome();
}
async function personHome(){
 const d=S.context.device;
 try{S.status=await signedRequest(S.device,'person',{employee_id:S.person.id});}
 catch(error){if(error.status===404){S.person=null;picker();return;}failure(error,personHome);return;}
 const p=S.status.employee,suggested=S.status.suggested,open=S.status.open_since;
 const statusText=open?`Sudah absen masuk pukul ${witaTime(Date.parse(open))}. Sekarang absen pulang.`:S.status.last_today?.kind==='OUT'?`Sudah absen pulang pukul ${witaTime(Date.parse(S.status.last_today.recorded_at))}.`:'Belum absen masuk hari ini.';
 const ownerHere=d.kind==='PERSONAL'&&d.owner?.id===p.id;
 show(`<section class="screen">
  <p class="muted">${esc(witaDay(serverNow()))}</p>
  <div class="card person"><span class="muted small">Absen sebagai</span><span class="name">${esc(p.name)}</span><span class="role">${esc([p.position,p.unit].filter(Boolean).join(' · '))}</span>
   <button class="ghost" data-action="pick">${ownerHere?'Absen untuk orang lain':'Ganti nama'}</button></div>
  <div class="status ${open?'ok':''}">${esc(statusText)}</div>
  ${S.context.points_ready?'':'<div class="status warn">Titik absen belum diatur pengelola. Absen tetap tercatat.</div>'}
  <div class="big-actions">
   <button class="${suggested==='IN'?'suggested':'other'}" data-action="kind" data-kind="IN">MASUK<small>${suggested==='IN'?'Disarankan':''}</small></button>
   <button class="${suggested==='OUT'?'suggested':'other'}" data-action="kind" data-kind="OUT">PULANG<small>${suggested==='OUT'?'Disarankan':''}</small></button>
  </div>
  ${d.kind==='PERSONAL'&&ownerHere?'<button class="ghost" data-action="history">Riwayat absen saya (30 hari)</button>':''}
  ${standalone()?'':`<button class="ghost" data-action="install" data-install ${S.install?'':'hidden'}>Pasang ikon di layar utama</button>`}
 </section>`);
}
function pickerLists(query){
 const people=S.context.people,q=query.trim().toLowerCase();
 const section=(title,list)=>list.length?`<p class="group">${esc(title)}</p><ul class="list">${list.map(p=>`<li><button data-action="choose" data-id="${esc(p.id)}">${esc(p.name)}<small>${esc([p.position,p.unit].filter(Boolean).join(' · '))}</small></button></li>`).join('')}</ul>`:'';
 const match=p=>!q||p.name.toLowerCase().includes(q);
 const owner=people.filter(p=>p.group==='owner'&&match(p)),recent=people.filter(p=>p.group==='recent'&&match(p)),unit=people.filter(p=>p.group==='unit'&&match(p));
 const html=section('Pemilik HP',owner)+section('Terakhir absen di HP ini',recent)+section(`Unit ${S.context.device.unit?.name||''}`.trim(),unit);
 return html||(q?'':'<p class="muted">Ketik nama untuk mencari.</p>');
}
function picker(){
 show(`<section class="screen">
  <h1>Siapa yang absen?</h1>
  <label class="field">Cari nama<input type="search" data-search autocomplete="off" placeholder="Ketik nama"></label>
  <div data-search-results></div>
  <div data-lists>${pickerLists('')}</div>
  ${S.person?'<button class="ghost" data-action="home">Kembali</button>':''}
 </section>`,false);
}
async function searchPeople(query){
 const box=app.querySelector('[data-search-results]');if(!box)return;
 const q=query.trim();if(q.length<3){box.innerHTML=q?'<p class="muted small">Ketik minimal 3 huruf untuk mencari nama di luar daftar.</p>':'';return;}
 const seq=++S.searchSeq;
 try{
  const result=await signedRequest(S.device,'search',{query:q});if(seq!==S.searchSeq)return;
  const known=new Set(S.context.people.map(p=>p.id)),extra=result.people.filter(p=>!known.has(p.id));
  box.innerHTML=extra.length?`<p class="group">Hasil pencarian</p><ul class="list">${extra.map(p=>`<li><button data-action="choose" data-id="${esc(p.id)}" data-found='${esc(JSON.stringify(p))}'>${esc(p.name)}<small>${esc([p.position,p.unit].filter(Boolean).join(' · '))}</small></button></li>`).join('')}</ul>`:'';
 }catch{}
}
function confirmPerson(person){
 show(`<section class="screen">
  <h1>Absen sebagai</h1>
  <div class="card person"><span class="name">${esc(person.name)}</span><span class="role">${esc([person.position,person.unit].filter(Boolean).join(' · '))}</span></div>
  <p class="lead">Benar?</p>
  <button class="primary wide" data-action="confirm-person" data-id="${esc(person.id)}">Ya, benar</button>
  <button class="secondary wide" data-action="pick">Bukan, pilih lagi</button>
 </section>`);
 S.candidate=person;
}
function historyScreen(){
 const items=S.context.history||[];
 show(`<section class="screen"><h1>Riwayat absen saya</h1><p class="muted">30 hari terakhir dari HP ini dan HP lain.</p>
  <div class="history">${items.map(e=>`<div><span>${esc(new Intl.DateTimeFormat('id-ID',{weekday:'short',day:'numeric',month:'short',timeZone:'Asia/Makassar'}).format(new Date(e.recorded_at)))}</span><strong>${kindLabel[e.kind]} ${witaTime(Date.parse(e.recorded_at))}</strong><span class="muted">${esc(e.point_name||'')}${e.within_point?'':' (di luar titik)'}</span></div>`).join('')||'<p class="muted">Belum ada absen.</p>'}</div>
  <button class="secondary wide" data-action="home">Kembali</button></section>`);
}

/* ---------- Absen: kamera depan + lokasi ---------- */
function stopCapture(){
 const c=S.camera;if(!c)return;
 c.stream?.getTracks().forEach(t=>t.stop());
 if(c.watch!=null)navigator.geolocation.clearWatch(c.watch);
 S.camera=null;
}
function chooseKind(kind){
 const open=S.status?.open_since,suggested=S.status?.suggested;
 if(kind!==suggested){
  const text=kind==='OUT'?'Anda belum absen masuk. Tetap absen PULANG?':`Anda sudah absen masuk pukul ${witaTime(Date.parse(open))}. Tetap absen MASUK lagi?`;
  show(`<section class="screen"><h1>Yakin?</h1><div class="status warn">${esc(text)}</div>
   <button class="primary wide" data-action="kind-confirmed" data-kind="${kind}">Ya, absen ${kindLabel[kind]}</button>
   <button class="secondary wide" data-action="home">Kembali</button></section>`);
  return;
 }
 capture(kind,false);
}
async function capture(kind,confirmed){
 stopCapture();
 S.attempt={client_key:uuid(),kind,confirmed,employee:S.status.employee,photo:null,outside:null};
 show(`<section class="screen">
  <h1>Selfie untuk absen ${kindLabel[kind]}</h1>
  <div class="camera"><video playsinline muted autoplay></video><p class="hint" data-location>Mencari lokasi…</p></div>
  <button class="capture" data-action="shoot" aria-label="Ambil foto" disabled></button>
  <p class="center muted small" data-camera>Menyalakan kamera depan…</p>
  <button class="ghost" data-action="home">Batal</button>
 </section>`);
 const camera={stream:null,watch:null,position:null,started:Date.now()};S.camera=camera;
 const locationText=app.querySelector('[data-location]'),cameraText=app.querySelector('[data-camera]');
 if(!navigator.geolocation){cameraText.textContent='HP ini tidak mendukung lokasi.';}
 else camera.watch=navigator.geolocation.watchPosition(position=>{
  const fix={latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,at:Date.now()};
  if(!camera.position||fix.accuracy<=camera.position.accuracy||Date.now()-camera.position.at>30000)camera.position=fix;
  if(locationText)locationText.textContent=`Lokasi didapat · akurasi ±${Math.round(camera.position.accuracy)} m`;
 },error=>{
  if(locationText)locationText.textContent=error.code===1?'Izin lokasi ditolak. Izinkan lokasi untuk absen.':'Lokasi belum didapat. Pastikan Lokasi (GPS) menyala.';
 },{enableHighAccuracy:true,maximumAge:0,timeout:20000});
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Kamera tidak tersedia di browser ini.');
  camera.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:960},height:{ideal:1280}},audio:false});
  if(S.camera!==camera){camera.stream.getTracks().forEach(t=>t.stop());return;}
  const video=app.querySelector('video');video.srcObject=camera.stream;await video.play().catch(()=>{});
  cameraText.textContent='Lihat ke kamera, lalu tekan tombol bulat.';
  app.querySelector('[data-action=shoot]').disabled=false;
 }catch(error){
  stopCapture();
  message('Kamera belum bisa dipakai',error?.name==='NotAllowedError'?'Izin kamera ditolak. Buka pengaturan browser, izinkan Kamera untuk halaman ini, lalu coba lagi.':'Kamera depan tidak dapat dinyalakan. Tutup aplikasi lain yang memakai kamera, lalu coba lagi.',
   {tone:'bad',actions:'<button class="primary wide" data-action="home">Kembali</button>'});
 }
}
async function shoot(){
 const video=app.querySelector('video');if(!video?.videoWidth)return;
 const scale=Math.min(1,640/Math.max(video.videoWidth,video.videoHeight)),canvas=document.createElement('canvas');
 canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
 canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
 let blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.7));
 if(blob&&blob.size>290*1024)blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.5));
 if(!blob){failure(new FormError('Foto belum bisa diambil. Coba lagi.'),()=>capture(S.attempt.kind,S.attempt.confirmed));return;}
 const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});
 S.camera.stream?.getTracks().forEach(t=>t.stop());
 S.attempt.photo={data,at:Date.now(),preview:URL.createObjectURL(blob)};
 await waitForLocation();
}
async function waitForLocation(){
 show(`<section class="screen center"><div class="spinner"></div><p class="lead" data-wait>Mengambil lokasi…</p></section>`,false);
 const camera=S.camera,deadline=(camera?.started||Date.now())+20000;
 while(camera&&S.camera===camera&&(!camera.position||camera.position.accuracy>100)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,500));
 if(!camera||S.camera!==camera)return;
 if(!camera.position){
  message('Lokasi belum didapat','Nyalakan Lokasi (GPS) di HP dan izinkan lokasi untuk halaman ini, lalu coba lagi.',{tone:'bad',actions:'<button class="primary wide" data-action="retry-location">Coba lagi</button><button class="secondary wide" data-action="home">Batal</button>'});
  return;
 }
 await submit();
}
async function submit(){
 const a=S.attempt,camera=S.camera;
 if(!a?.photo)return;
 if(Date.now()-a.photo.at>4.5*60000){message('Selfie sudah lama','Ambil selfie lagi supaya absen bisa dikirim.',{tone:'warn',actions:'<button class="primary wide" data-action="retake">Ambil selfie lagi</button>'});return;}
 const fix=camera?.position;
 if(!fix){await waitForLocation();return;}
 show(`<section class="screen center"><div class="spinner"></div><p class="lead">Mengirim absen ${kindLabel[a.kind]}…</p></section>`,false);
 const payload={client_key:a.client_key,employee_id:a.employee.id,kind:a.kind,confirmed_order:a.confirmed,
  location:{latitude:fix.latitude,longitude:fix.longitude,accuracy:fix.accuracy,age_ms:Date.now()-fix.at},
  photo:{mime_type:'image/jpeg',data:a.photo.data,age_ms:Date.now()-a.photo.at},...(a.outside?{outside:a.outside}:{})};
 try{
  const receipt=await signedRequest(S.device,'submit',payload);
  stopCapture();success(receipt);
 }catch(error){
  if(error.status===422&&error.details?.code==='OUTSIDE_POINT'){outside(error);return;}
  stopCapture();
  failure(error,error.status===0||error.status===503?()=>{retrySubmit();}:null);
 }
}
// Kiriman ulang memakai kunci kiriman yang sama, jadi tidak pernah tercatat dua kali.
async function retrySubmit(){
 if(!S.attempt?.photo){home();return;}
 if(!navigator.geolocation){message('Lokasi tidak tersedia','HP ini tidak mendukung lokasi.',{tone:'bad',actions:'<button class="primary wide" data-action="home">Kembali</button>'});return;}
 const camera={stream:null,watch:null,position:null,started:Date.now()};S.camera=camera;
 camera.watch=navigator.geolocation.watchPosition(p=>{camera.position={latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,at:Date.now()};},()=>{},{enableHighAccuracy:true,maximumAge:0,timeout:20000});
 await waitForLocation();
}
function outside(error){
 const d=error.details||{};
 show(`<section class="screen">
  <h1>Di luar titik absen</h1>
  <div class="status warn">Anda ${esc(d.distance_m)} m dari ${esc(d.point_name||'titik absen')}, di luar titik absen.</div>
  <p class="lead">Pilih alasan, lalu kirim. Absen tetap tercatat dan akan dicek atasan.</p>
  <div class="screen">${reasons.map(([code,label])=>`<button class="secondary wide" data-action="reason" data-reason="${code}">${label}</button>`).join('')}</div>
  <label class="field" data-note hidden>Tuliskan alasannya<textarea name="note" rows="3" maxlength="300"></textarea></label>
  <button class="primary wide" data-action="send-outside" hidden>Kirim absen</button>
  <button class="ghost" data-action="home">Batal</button>
 </section>`);
}
function success(receipt){
 const a=S.attempt;if(a?.photo?.preview)URL.revokeObjectURL(a.photo.preview);S.attempt=null;
 const where=receipt.point_name?(receipt.within_point?`${receipt.point_name} (${receipt.distance_m} m)`:`Di luar titik · ${receipt.distance_m} m dari ${receipt.point_name}`):'';
 navigator.vibrate?.([120,60,120]);
 say(`${kindLabel[receipt.kind]} tercatat pukul ${witaTime(Date.parse(receipt.recorded_at))}`);
 show(`<section class="screen">
  <div class="success"><div class="kind">${kindLabel[receipt.kind]} TERCATAT</div><div class="time">${witaTime(Date.parse(receipt.recorded_at))}</div>
   <div class="who">${esc(receipt.employee.name)}</div>${where?`<div class="where">${esc(where)}</div>`:''}</div>
  <button class="primary wide" data-action="done">Selesai</button>
 </section>`);
 later(done,8000);
}
function done(){
 const d=S.context?.device;
 // Sesudah absen untuk orang lain, kembali ke pemilik HP (HP pribadi) atau ke daftar nama (HP bersama).
 S.person=d?.kind==='PERSONAL'&&d.owner?d.owner:null;S.status=null;
 home();
}

/* ---------- Tindakan ---------- */
app.addEventListener('click',async event=>{
 const el=event.target.closest('[data-action]');if(!el)return;
 const action=el.dataset.action;
 try{
  if(action==='home'){S.retry=null;await home();return;}
  if(action==='retry'){const retry=S.retry;S.retry=null;if(retry)await retry();else await home();return;}
  if(action==='install'){if(S.install){S.install.prompt();await S.install.userChoice.catch(()=>{});S.install=null;el.hidden=true;}return;}
  if(action==='register'){el.disabled=true;await register('register',{token:el.dataset.token});installScreen();return;}
  if(action==='session-person'){sessionConfirm(S.session.preview.people.find(p=>p.id===el.dataset.id));return;}
  if(action==='session-back'){sessionPicker();return;}
  if(action==='session-register'){el.disabled=true;await register('session-register',{token:S.session.token,employee_id:el.dataset.id});await waitApproval();return;}
  if(action==='forget'){await forgetDevice();S.device=null;S.context=null;S.person=null;unregistered();return;}
  if(action==='pick'){picker();return;}
  if(action==='choose'){
   const person=S.context.people.find(p=>p.id===el.dataset.id)||(el.dataset.found?JSON.parse(el.dataset.found):null);if(!person)return;
   const d=S.context.device;
   if(d.kind==='PERSONAL'&&d.owner?.id===person.id){S.person=person;await personHome();return;}
   confirmPerson(person);return;
  }
  if(action==='confirm-person'){S.person=S.candidate;S.candidate=null;await personHome();return;}
  if(action==='history'){historyScreen();return;}
  if(action==='kind'){chooseKind(el.dataset.kind);return;}
  if(action==='kind-confirmed'){await capture(el.dataset.kind,true);return;}
  if(action==='shoot'){el.disabled=true;await shoot();return;}
  if(action==='retake'){await capture(S.attempt.kind,S.attempt.confirmed);return;}
  if(action==='retry-location'){await retrySubmit();return;}
  if(action==='reason'){
   app.querySelectorAll('[data-action=reason]').forEach(b=>{b.className=b===el?'primary wide':'secondary wide';});
   S.attempt.outside={reason:el.dataset.reason,note:''};
   app.querySelector('[data-note]').hidden=el.dataset.reason!=='LAINNYA';
   app.querySelector('[data-action=send-outside]').hidden=false;return;
  }
  if(action==='send-outside'){
   const note=app.querySelector('[data-note] textarea').value.trim();
   if(S.attempt.outside.reason==='LAINNYA'&&note.length<3){app.querySelector('[data-note] textarea').focus();return;}
   S.attempt.outside.note=note;el.disabled=true;
   if(!S.camera)await retrySubmit();else await submit();return;
  }
  if(action==='done'){done();return;}
 }catch(error){failure(error,null);}
});
app.addEventListener('input',event=>{
 if(event.target.matches('[data-session-search]')){app.querySelector('[data-session-list]').innerHTML=sessionList(event.target.value);return;}
 if(event.target.matches('[data-search]')){
  const value=event.target.value;app.querySelector('[data-lists]').innerHTML=pickerLists(value);
  clearTimeout(S.searchTimer);S.searchTimer=setTimeout(()=>searchPeople(value),400);
 }
});
app.addEventListener('submit',async event=>{
 const form=event.target.closest('[data-paste]');if(!form)return;event.preventDefault();
 const text=form.querySelector('input').value.trim(),match=text.match(/#(daftar|sesi)=([a-f0-9]{64})/);
 if(!match){form.querySelector('input').setCustomValidity('Tautan tidak dikenali. Salin seluruh tautan dari WhatsApp.');form.reportValidity();form.querySelector('input').setCustomValidity('');return;}
 await registration({kind:match[1],token:match[2]});
});
window.addEventListener('hashchange',()=>{const link=readFragment();if(link)registration(link);});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&S.camera?.stream&&!S.attempt?.photo){stopCapture();home();}});
start().catch(error=>failure(error,()=>start()));
