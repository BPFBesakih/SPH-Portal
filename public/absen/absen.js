import {createGpsWindow,loadDevice,saveDevice,forgetDevice,loadPending,savePending,clearPending,persistStorage,newKeys,publicKeyOf,request,signedRequest,replacementProof,serverNow,syncClock,uuid,FormError} from './absen-core.js';

// Halaman absen BP Besakih. Alur harian dibuat sesingkat mungkin untuk pegawai yang
// belum terbiasa memakai HP: buka ikon → (pilih nama) → MASUK/PULANG → selfie.
// Yang didaftarkan adalah HP pribadi. Pemilik HP absen untuk dirinya sendiri; pegawai lain
// hanya bisa diabsenkan atasan langsungnya dari HP pribadi atasan itu (pegawai tanpa HP absen
// di HP atasan langsungnya). HP bersama tidak dipakai lagi. Server memeriksa ulang semuanya.
const app=document.querySelector('#app'),live=document.querySelector('#live');
const S={device:null,context:null,person:null,status:null,install:null,camera:null,attempt:null,timers:new Set()};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const witaTime=ms=>new Intl.DateTimeFormat('id-ID',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Makassar'}).format(new Date(ms));
const witaDay=ms=>new Intl.DateTimeFormat('id-ID',{weekday:'long',day:'numeric',month:'long',timeZone:'Asia/Makassar'}).format(new Date(ms));
const kindLabel={IN:'MASUK',OUT:'PULANG'};
const isIos=/iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
function say(text){live.textContent='';setTimeout(()=>{live.textContent=text;},30);}
const backButton=document.querySelector('#back');
function show(html,focus=true,back=null){
 backButton.hidden=!back;
 backButton.onclick=back?()=>Promise.resolve().then(back).catch(error=>failure(error,null)):null;
 clearTimers();app.innerHTML=html;if(focus)app.focus({preventScroll:true});window.scrollTo(0,0);}
function later(fn,ms){const id=setTimeout(()=>{S.timers.delete(id);fn();},ms);S.timers.add(id);return id;}
function clearTimers(){for(const id of S.timers)clearTimeout(id);S.timers.clear();}
function setLabel(text){document.querySelector('#device-label').textContent=text;}
setInterval(()=>{document.querySelector('#clock').textContent=witaTime(serverNow());},1000);
document.querySelector('#clock').textContent=witaTime(serverNow());
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();S.install=event;document.querySelectorAll('[data-install]').forEach(el=>{el.hidden=false;});});
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});

/* ---------- Layar umum ---------- */
function message(title,text,{tone='',actions='',back=null}={}){
 show(`<section class="screen"><h1>${esc(title)}</h1>${text?`<div class="status ${tone}">${esc(text)}</div>`:''}${actions}</section>`,true,back);
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
  <p class="muted small">Pegawai yang tidak punya HP tidak perlu mendaftar. Minta atasan langsung Anda mengabsenkan dari HP-nya yang sudah terdaftar.</p>
  ${isIos?`<p class="muted small">Di iPhone: pasang ikon dulu (Bagikan → Tambahkan ke Layar Utama), buka dari ikon itu, lalu tempel tautan pendaftaran di bawah.</p>`:''}
  ${pasteBox()}
 </section>`);
}
function failure(error,retry){
 const text=error instanceof FormError?error.message:'Terjadi gangguan. Coba lagi.';
 message('Belum berhasil',text,{tone:'bad',back:home,actions:retry?'<button class="primary" data-action="retry">Coba lagi</button>':''});
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
   </section>`,true,home);
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
 </section>`,false,home);
}
function sessionConfirm(person){
 show(`<section class="screen">
  <h1>Benar ini Anda?</h1>
  <div class="card person"><span class="name">${esc(person.name)}</span><span class="role">${esc([person.position,person.unit].filter(Boolean).join(' · '))}</span></div>
  ${replaceNote()}
  <button class="primary wide" data-action="session-register" data-id="${esc(person.id)}">Ya, ini HP saya</button>
 </section>`,true,sessionPicker);
}
async function register(action,body){
 show('<section class="screen center"><div class="spinner"></div><p class="lead">Mendaftarkan HP…</p></section>');
 // Kunci baru disimpan di HP SEBELUM dikirim. Bila balasan hilang (sinyal putus sesudah server
 // menyimpan), kiriman ulang memakai kunci yang sama dan server mengenali HP ini lagi.
 const employee=body.employee_id||null;
 let pending=await loadPending().catch(()=>null);
 if(!pending?.keys||pending.action!==action||pending.token!==body.token||pending.employee_id!==employee){
  pending={action,token:body.token,employee_id:employee,keys:await newKeys(),created_at:new Date().toISOString()};
  await savePending(pending);
 }
 const payload={...body,public_key:await publicKeyOf(pending.keys),client_info:navigator.userAgent.slice(0,200)};
 if(S.device?.keys&&S.device?.device_id)payload.replaces=await replacementProof(S.device,body.token);
 const result=await request(action,payload);
 S.device={device_id:result.device_id,keys:pending.keys,registered_at:new Date().toISOString()};
 await saveDevice(S.device);
 await clearPending().catch(()=>{});
 persistStorage();
 return result;
}
// Mendaftar lalu lanjut ke layar yang sesuai. Gangguan jaringan atau server menampilkan
// "Coba lagi" dengan kunci yang sama; tautan yang ditolak membuang kunci yang belum terpakai.
async function registerAndContinue(action,body,clockRetry=true){
 let result;
 try{result=await register(action,body);}
 catch(error){
  if(clockRetry&&error?.status===401&&error.details?.code==='CLOCK'&&error.details.server_time){syncClock(error.details.server_time);return registerAndContinue(action,body,false);}
  const retryable=!(error instanceof FormError)||error.status===0||error.status===429||error.status>=500;
  if(!retryable)await clearPending().catch(()=>{});
  failure(error,retryable?()=>registerAndContinue(action,body):null);
  return;
 }
 if(result.status==='ACTIVE'){installScreen();return;}
 if(result.status==='PENDING'){await waitApproval();return;}
 inactive(result.status);
}
// Pendaftaran sebelumnya terputus sebelum balasan diterima: lanjutkan dengan kunci yang sama.
async function resumeRegistration(pending){
 setLabel('Pendaftaran HP');
 await registerAndContinue(pending.action,{token:pending.token,...(pending.employee_id?{employee_id:pending.employee_id}:{})});
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
// HP bersama tidak dipakai lagi. HP ini bisa didaftarkan ulang sebagai HP pribadi pemegangnya
// (misalnya koordinator) lewat tautan HP pribadi; pendaftaran lama otomatis diganti.
function retiredShared(d){
 S.person=null;
 setLabel(d?.label?`HP bersama · ${d.label}`:'HP bersama');
 message('HP bersama tidak dipakai lagi','Absen untuk orang lain kini hanya bisa dilakukan atasan langsung dari HP pribadinya. Absen di HP sendiri, atau minta atasan langsung Anda mengabsenkan dari HP-nya.',
  {tone:'warn',actions:`<p class="muted small">Bila HP ini dipegang koordinator, minta SDM membuat tautan HP pribadi atas nama koordinator itu, lalu buka tautannya di HP ini.</p>${pasteBox()}<button class="ghost" data-action="forget">Hapus pendaftaran lama dari HP ini</button>`});
}
// Nama yang tidak boleh diabsenkan dari HP ini (bukan bawahan langsung pemilik HP).
function notAllowed(error){
 S.person=null;S.attempt=null;
 message('Tidak bisa absen untuk nama ini',error.message,{tone:'warn',back:home,actions:'<button class="primary wide" data-action="home">Kembali</button>'});
}

/* ---------- Beranda absen ---------- */
async function start(){
 S.device=await loadDevice().catch(()=>null);
 if(S.device?.device_id)persistStorage();
 const link=readFragment();
 if(link){await registration(link);return;}
 const pending=await loadPending().catch(()=>null);
 if(pending?.keys&&pending.token){
  if(Date.now()-Date.parse(pending.created_at)<8*86400000){await resumeRegistration(pending);return;}
  await clearPending().catch(()=>{});
 }
 await home();
}
async function home(){
 stopCapture();S.attempt=null;
 if(!S.device?.device_id){unregistered();return;}
 show('<section class="screen center"><div class="spinner"></div><p class="lead">Memuat…</p></section>',false);
 try{S.context=await signedRequest(S.device,'context',{});}
 catch(error){if(error.status===401&&!error.details?.code){unregistered('Pendaftaran HP ini tidak dikenali lagi. Minta tautan baru kepada SDM.');return;}failure(error,home);return;}
 const d=S.context.device;
 if(d.status==='PENDING'){await waitApproval();return;}
 // Server lama masih menjawab HP bersama sebagai ACTIVE; layar yang sama tetap dipakai.
 if(d.retired||d.kind==='SHARED'){retiredShared(d);return;}
 if(d.status!=='ACTIVE'){inactive(d.status);return;}
 setLabel(d.label);
 if(S.person&&!choices().some(p=>p.id===S.person.id))S.person=null;
 if(!S.person&&d.owner)S.person=d.owner;
 if(!S.person){inactive('REVOKED');return;}
 await personHome();
}
// Nama yang boleh dipilih di HP ini: pemilik dan bawahan langsungnya (grup "team" dari server).
const team=()=>(S.context?.people||[]).filter(p=>p.group==='team');
const choices=()=>{const d=S.context?.device;return [...(d?.owner?[d.owner]:[]),...team()];};
async function personHome(){
 const d=S.context.device;
 try{S.status=await signedRequest(S.device,'person',{employee_id:S.person.id});}
 catch(error){
  const code=error.details?.code;
  if(error.status===404){S.person=null;await home();return;}
  if(error.status===403&&code==='NOT_DIRECT_SUPERVISOR'){notAllowed(error);return;}
  if(error.status===403&&code==='SHARED_RETIRED'){retiredShared(d);return;}
  failure(error,personHome);return;
 }
 const p=S.status.employee,suggested=S.status.suggested,open=S.status.open_since,today=S.status.state;
 // Jam hanya dikirim server untuk pemilik HP di HP-nya sendiri; bawahan yang diabsenkan atasan melihat keadaannya saja.
 const done=S.status.last_today?.kind==='OUT'?S.status.last_today:null;
 const statusText=open?`Sudah absen masuk pukul ${witaTime(Date.parse(open))}. Sekarang absen pulang.`
  :today==='OPEN'?'Sudah absen masuk. Sekarang absen pulang.'
  :done?`Sudah absen pulang pukul ${witaTime(Date.parse(done.recorded_at))}.`
  :today==='DONE'?'Sudah absen pulang hari ini.':'Belum absen masuk hari ini.';
 const ownerHere=d.owner?.id===p.id,canPick=team().length>0;
 show(`<section class="screen">
  <p class="muted">${esc(witaDay(serverNow()))}</p>
  <div class="card person"><span class="muted small">${ownerHere?'Absen sebagai':'Absen untuk bawahan langsung'}</span><span class="name">${esc(p.name)}</span><span class="role">${esc([p.position,p.unit].filter(Boolean).join(' · '))}</span>
   ${canPick?`<button class="ghost" data-action="pick">${ownerHere?'Absen untuk bawahan':'Ganti nama'}</button>`:''}</div>
  <div class="status ${open||today==='OPEN'?'ok':''}">${esc(statusText)}</div>
  ${S.context.points_ready?'':'<div class="status warn">Belum ada titik absen aktif. Hubungi Pengelola Absensi jika Anda perlu absen dari kantor.</div>'}
  <div class="big-actions">
   <button class="${suggested==='IN'?'suggested':'other'}" data-action="kind" data-kind="IN">MASUK<small>${suggested==='IN'?'Disarankan':''}</small></button>
   <button class="${suggested==='OUT'?'suggested':'other'}" data-action="kind" data-kind="OUT">PULANG<small>${suggested==='OUT'?'Disarankan':''}</small></button>
  </div>
  ${ownerHere?'<button class="ghost" data-action="history">Riwayat absen saya (30 hari)</button>':''}
  ${standalone()?'':`<button class="ghost" data-action="install" data-install ${S.install?'':'hidden'}>Pasang ikon di layar utama</button>`}
 </section>`,true,ownerHere?null:picker);
}
// Daftar nama tidak memanggil pencarian server: semua nama yang boleh dipilih sudah dikirim
// lewat `context` (pemilik + bawahan langsung), jadi saringan cukup dilakukan di HP.
function pickerLists(query){
 const q=query.trim().toLowerCase(),owner=S.context.device.owner;
 const section=(title,list)=>list.length?`<p class="group">${esc(title)}</p><ul class="list">${list.map(p=>`<li><button data-action="choose" data-id="${esc(p.id)}">${esc(p.name)}<small>${esc([p.position,p.unit].filter(Boolean).join(' · '))}</small></button></li>`).join('')}</ul>`:'';
 const match=p=>!q||p.name.toLowerCase().includes(q);
 const html=section('Saya',owner&&match(owner)?[owner]:[])+section('Bawahan langsung',team().filter(match));
 return html||'<p class="muted">Nama tidak ada di daftar bawahan langsung Anda.</p>';
}
function picker(){
 show(`<section class="screen">
  <h1>Absen untuk siapa?</h1>
  <p class="muted small">Dari HP ini Anda bisa absen untuk diri sendiri dan untuk bawahan langsung Anda. Pegawai lain absen di HP sendiri atau di HP atasan langsungnya.</p>
  ${team().length>6?'<label class="field">Cari nama<input type="search" data-search autocomplete="off" placeholder="Ketik nama"></label>':''}
  <div data-lists>${pickerLists('')}</div>
 </section>`,false,home);
}
function confirmPerson(person){
 show(`<section class="screen">
  <h1>Absen untuk bawahan langsung</h1>
  <div class="card person"><span class="name">${esc(person.name)}</span><span class="role">${esc([person.position,person.unit].filter(Boolean).join(' · '))}</span></div>
  <p class="lead">Benar? Pastikan orangnya sendiri yang berfoto.</p>
  <button class="primary wide" data-action="confirm-person" data-id="${esc(person.id)}">Ya, benar</button>
 </section>`,true,picker);
 S.candidate=person;
}
// Jam ditulis 08.00 seperti jam lain di halaman ini; 60 menit ke atas ditulis dalam jam dan menit.
const clockText=value=>String(value||'').replace(':','.');
function durationText(minutes){
 const hours=Math.floor(minutes/60),rest=minutes%60;
 return hours?`${hours} jam${rest?` ${rest} menit`:''}`:`${rest} menit`;
}
function timingText(timing){
 if(!timing)return '';
 return timing.late?`Terlambat ${durationText(timing.minutes)} dari jam masuk ${clockText(timing.start_time)} WITA`:'Tepat waktu';
}
function historyScreen(){
 const items=S.context.history||[];
 show(`<section class="screen"><h1>Riwayat absen saya</h1><p class="muted">30 hari terakhir dari HP ini dan HP lain.</p>
  <div class="history">${items.map(e=>`<div><span>${esc(new Intl.DateTimeFormat('id-ID',{weekday:'short',day:'numeric',month:'short',timeZone:'Asia/Makassar'}).format(new Date(e.recorded_at)))}</span><strong>${kindLabel[e.kind]} ${witaTime(Date.parse(e.recorded_at))}${e.timing?`<small>${esc(timingText(e.timing))}</small>`:''}</strong><span class="muted">${esc(e.point_name||'')}${e.within_point?'':' (di luar titik)'}</span></div>`).join('')||'<p class="muted">Belum ada absen.</p>'}</div>
  </section>`,true,home);
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
  const text=kind==='OUT'?'Anda belum absen masuk. Tetap absen PULANG?':open?`Anda sudah absen masuk pukul ${witaTime(Date.parse(open))}. Tetap absen MASUK lagi?`:'Anda sudah absen masuk. Tetap absen MASUK lagi?';
  show(`<section class="screen"><h1>Yakin?</h1><div class="status warn">${esc(text)}</div>
   <button class="primary wide" data-action="kind-confirmed" data-kind="${kind}">Ya, absen ${kindLabel[kind]}</button>
   </section>`,true,home);
  return;
 }
 capture(kind,false);
}
async function capture(kind,confirmed){
 S.attempt={client_key:uuid(),kind,confirmed,employee:S.status.employee,photo:null,photoConfirmed:false};
 await locateAttempt();
}
const locationPayload=fix=>({latitude:fix.latitude,longitude:fix.longitude,accuracy:fix.accuracy,age_ms:Math.max(0,Date.now()-fix.at)});
const gpsLabel=fix=>fix?`Lokasi didapat · akurasi ±${Math.round(fix.accuracy)} m`:'Menunggu lokasi terbaru.';
async function locateAttempt(){
 stopCapture();
 const attempt=S.attempt;if(!attempt)return;
 if(!navigator.geolocation){message('Lokasi tidak tersedia','HP ini tidak mendukung lokasi untuk absen.',{tone:'bad',back:home});return;}
 show('<section class="screen center"><h1>Memeriksa lokasi</h1><div class="spinner"></div><p class="lead" data-location>Mencari lokasi HP.</p></section>',true,home);
 const camera={stream:null,watch:null,gps:createGpsWindow(),denied:false};S.camera=camera;
 const deadline=Date.now()+20000;
 camera.watch=navigator.geolocation.watchPosition(position=>{
  if(S.camera!==camera)return;
  const at=Number.isFinite(position.timestamp)?Math.min(position.timestamp,Date.now()):Date.now();
  const fix=camera.gps.add({latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,at});
  const label=app.querySelector('[data-location]');if(label)label.textContent=gpsLabel(fix);
 },error=>{if(error.code===1)camera.denied=true;},{enableHighAccuracy:true,maximumAge:0,timeout:20000});
 while(S.camera===camera&&!camera.denied&&((camera.gps.best()?.accuracy??Infinity)>100)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,200));
 if(S.camera!==camera)return;
 const fix=camera.gps.best();
 if(camera.denied||!fix){
  stopCapture();
  message('Lokasi belum didapat',camera.denied?'Izinkan akses lokasi untuk halaman absen, lalu coba lagi.':'Nyalakan Lokasi (GPS) di HP, lalu coba lagi.',{tone:'bad',back:home,actions:'<button class="primary wide" data-action="retry-location">Coba lagi</button>'});return;
 }
 // Kiriman ulang memakai selfie dan kunci kiriman yang sama agar balasan yang hilang bisa dipulihkan.
 if(attempt.photoConfirmed){await submit();return;}
 try{
  const result=await signedRequest(S.device,'check-location',{employee_id:attempt.employee.id,location:locationPayload(fix)});
  if(S.camera!==camera)return;
  if(result.allowed!==true)throw new FormError('Lokasi belum dapat dikonfirmasi. Coba lagi.',503);
 }catch(error){if(S.camera===camera)captureFailure(error);return;}
 await openSelfie(camera,attempt.kind);
}
function captureFailure(error){
 stopCapture();
 const code=error.details?.code;
 if(error.status===403&&code==='NOT_DIRECT_SUPERVISOR'){notAllowed(error);return;}
 if(error.status===403&&code==='SHARED_RETIRED'){S.attempt=null;retiredShared(S.context?.device);return;}
 if(error.status===403&&['OUTSIDE_FORBIDDEN','NO_ACTIVE_POINT'].includes(code)){
  // Di luar radius bisa karena GPS melenceng sesaat. Pegawai boleh mengecek lokasi lagi tanpa
  // mengulang dari awal; selfie yang sudah dikonfirmasi dikirim ulang dengan kunci yang sama.
  const again=code==='OUTSIDE_FORBIDDEN'&&S.attempt?S.attempt:null;
  if(!again)S.attempt=null;
  const hint=again?`<p class="muted small">Bila Anda sudah berada di area kantor, tunggu sebentar lalu tekan Cek lokasi lagi.${again.photoConfirmed?' Foto tadi dikirim ulang.':''}</p><button class="primary wide" data-action="retry-location">Cek lokasi lagi</button>`:'';
  message('Absen ditolak',error.message,{tone:'bad',back:home,actions:hint});return;
 }
 failure(error,error.status===0||error.status===503?locateAttempt:null);
}
async function openSelfie(camera,kind){
 show(`<section class="screen">
  <h1>Selfie untuk absen ${kindLabel[kind]}</h1>
  <div class="camera"><video playsinline muted autoplay></video><p class="hint" data-location>${gpsLabel(camera.gps.best())}</p></div>
  <button class="capture" data-action="shoot" aria-label="Ambil foto" disabled></button>
  <p class="center muted small" data-camera>Menyalakan kamera depan…</p>
 </section>`,true,home);
 const cameraText=app.querySelector('[data-camera]');
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Kamera tidak tersedia di browser ini.');
  camera.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:960},height:{ideal:1280}},audio:false});
  if(S.camera!==camera){camera.stream.getTracks().forEach(t=>t.stop());return;}
  const video=app.querySelector('video');video.srcObject=camera.stream;await video.play().catch(()=>{});
  if(S.camera!==camera)return;
  cameraText.textContent='Lihat ke kamera, lalu tekan tombol bulat.';
  app.querySelector('[data-action=shoot]').disabled=false;
 }catch(error){
  if(S.camera!==camera)return;
  stopCapture();
  message('Kamera belum bisa dipakai',error?.name==='NotAllowedError'?'Izin kamera ditolak. Buka pengaturan browser, izinkan Kamera untuk halaman ini, lalu coba lagi.':'Kamera depan tidak dapat dinyalakan. Tutup aplikasi lain yang memakai kamera, lalu coba lagi.',
   {tone:'bad',back:home});
 }
}
async function shoot(){
 const camera=S.camera,attempt=S.attempt;
 const video=app.querySelector('video');if(!video?.videoWidth){const button=app.querySelector('[data-action=shoot]');if(button)button.disabled=false;return;}
 const takenAt=Date.now();
 const scale=Math.min(1,640/Math.max(video.videoWidth,video.videoHeight)),canvas=document.createElement('canvas');
 canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
 canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
 let blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.7));
 if(blob&&blob.size>290*1024)blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.5));
 if(S.camera!==camera||S.attempt!==attempt)return;
 if(!blob){stopCapture();failure(new FormError('Foto belum bisa diambil. Coba lagi.'),()=>capture(attempt.kind,attempt.confirmed));return;}
 const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});
 if(S.camera!==camera||S.attempt!==attempt)return;
 camera.stream?.getTracks().forEach(t=>t.stop());
 camera.stream=null;
 attempt.photo={data,at:takenAt};
 show(`<section class="screen">
  <h1>Periksa foto absen ${kindLabel[attempt.kind]}</h1>
  <img class="selfie-preview" src="data:image/jpeg;base64,${data}" alt="Selfie yang akan dikirim">
  <button class="primary wide" data-action="submit-photo">Kirim absen</button>
  <button class="secondary wide" data-action="retake">Ambil ulang foto</button>
 </section>`,true,retake);
}
function retake(){
 const attempt=S.attempt,camera=S.camera;if(!attempt)return;
 attempt.photo=null;
 attempt.photoConfirmed=false;
 // Lokasi sudah didapat dan radius sudah dicek sebelum selfie pertama, dan GPS tetap berjalan.
 // Kamera langsung dibuka lagi tanpa mencari lokasi ulang; server tetap memeriksa lokasi saat
 // absen dicatat. Bila GPS sudah berhenti (misalnya sesudah gangguan), lokasi dicari dari awal.
 if(camera&&camera.watch!=null&&!camera.denied)return openSelfie(camera,attempt.kind);
 return locateAttempt();
}
async function submit(){
 const a=S.attempt,camera=S.camera;
 if(!a?.photo || !a.photoConfirmed)return;
 if(Date.now()-a.photo.at>4.5*60000){message('Selfie sudah lama','Ambil selfie lagi supaya absen bisa dikirim.',{tone:'warn',back:home,actions:'<button class="primary wide" data-action="retake">Ambil selfie lagi</button>'});return;}
 const fix=camera?.gps.best();
 if(!fix||camera.denied){await locateAttempt();return;}
 show(`<section class="screen center"><div class="spinner"></div><p class="lead">Mengirim absen ${kindLabel[a.kind]}…</p></section>`,false);
 const payload={client_key:a.client_key,employee_id:a.employee.id,kind:a.kind,confirmed_order:a.confirmed,
  location:locationPayload(fix),
  photo:{mime_type:'image/jpeg',data:a.photo.data,age_ms:Date.now()-a.photo.at}};
 try{
  const receipt=await signedRequest(S.device,'submit',payload);
  stopCapture();success(receipt);
 }catch(error){captureFailure(error);}
}
function success(receipt){
 S.attempt=null;
 const where=receipt.point_name?(receipt.within_point?`${receipt.point_name} (${receipt.distance_m} m)`:`Di luar titik · ${receipt.distance_m} m dari ${receipt.point_name}`):'';
 navigator.vibrate?.([120,60,120]);
 say(`${kindLabel[receipt.kind]} tercatat pukul ${witaTime(Date.parse(receipt.recorded_at))}`);
 show(`<section class="screen">
  <div class="success"><div class="kind">${kindLabel[receipt.kind]} TERCATAT</div><div class="time">${witaTime(Date.parse(receipt.recorded_at))}</div>
   <div class="who">${esc(receipt.employee.name)}</div>${where?`<div class="where">${esc(where)}</div>`:''}</div>
  ${receipt.timing?`<div class="status ${receipt.timing.late?'warn':'ok'}">${esc(timingText(receipt.timing))}</div>`:''}
  <button class="primary wide" data-action="done">Selesai</button>
 </section>`,true,done);
 later(done,8000);
}
function done(){
 const d=S.context?.device;
 // Sesudah atasan mengabsenkan bawahannya, kembali ke pemilik HP supaya absen berikutnya
 // tidak tercatat atas nama yang salah.
 S.person=d?.owner||null;S.status=null;
 return home();
}

/* ---------- Tindakan ---------- */
app.addEventListener('click',async event=>{
 const el=event.target.closest('[data-action]');if(!el)return;
 const action=el.dataset.action;
 try{
  if(action==='home'){S.retry=null;await home();return;}
  if(action==='retry'){const retry=S.retry;S.retry=null;if(retry)await retry();else await home();return;}
  if(action==='install'){if(S.install){S.install.prompt();await S.install.userChoice.catch(()=>{});S.install=null;el.hidden=true;}return;}
  if(action==='register'){el.disabled=true;await registerAndContinue('register',{token:el.dataset.token});return;}
  if(action==='session-person'){sessionConfirm(S.session.preview.people.find(p=>p.id===el.dataset.id));return;}
  if(action==='session-register'){el.disabled=true;await registerAndContinue('session-register',{token:S.session.token,employee_id:el.dataset.id});return;}
  if(action==='forget'){await forgetDevice();S.device=null;S.context=null;S.person=null;unregistered();return;}
  if(action==='pick'){picker();return;}
  if(action==='choose'){
   const person=choices().find(p=>p.id===el.dataset.id);if(!person)return;
   if(S.context.device.owner?.id===person.id){S.person=person;await personHome();return;}
   confirmPerson(person);return;
  }
  if(action==='confirm-person'){S.person=S.candidate;S.candidate=null;await personHome();return;}
  if(action==='history'){historyScreen();return;}
  if(action==='kind'){chooseKind(el.dataset.kind);return;}
  if(action==='kind-confirmed'){await capture(el.dataset.kind,true);return;}
  if(action==='shoot'){el.disabled=true;await shoot();return;}
  if(action==='submit-photo'){el.disabled=true;S.attempt.photoConfirmed=true;await submit();return;}
  if(action==='retake'){await retake();return;}
  if(action==='retry-location'){await locateAttempt();return;}
  if(action==='done'){done();return;}
 }catch(error){failure(error,null);}
});
app.addEventListener('input',event=>{
 if(event.target.matches('[data-session-search]')){app.querySelector('[data-session-list]').innerHTML=sessionList(event.target.value);return;}
 if(event.target.matches('[data-search]')){app.querySelector('[data-lists]').innerHTML=pickerLists(event.target.value);}
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
