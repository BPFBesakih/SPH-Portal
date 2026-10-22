import {esc,icon,formatDate,formatTime} from './ui.js';
import {employeePickerField,setupEmployeePicker} from './employee-picker.js';

const root=document.querySelector('#quick-report'),token=location.hash.slice(1),intro=root.querySelector('.intro').outerHTML;
let people=[],label='Laporan Keamanan',stream=null,locationData=null,photos=[],busy=false,closed=false,requestKey=crypto.randomUUID();
const previews=new Set();
async function request(action,body){
  const response=await fetch(`/api/quick-report/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',redirect:'error',body:JSON.stringify({...body,token}),signal:AbortSignal.timeout(action==='submit'?45000:25000)});
  let data;try{data=await response.json();}catch{throw new Error('Hasil pengiriman belum dapat dikonfirmasi. Coba kembali.');}
  if(!response.ok)throw new Error(data.error||'Permintaan belum berhasil. Coba kembali.');return data;
}
function stopCamera(){stream?.getTracks().forEach(track=>track.stop());stream=null;const video=root.querySelector('video');if(video)video.srcObject=null;const view=root.querySelector('.camera-view');if(view)view.hidden=true;}
function clearEvidence(){stopCamera();for(const url of previews)URL.revokeObjectURL(url);previews.clear();photos=[];locationData=null;}
function render(){
  root.innerHTML=`${intro}<form id="report-form"><section class="step"><div class="step-title"><span class="step-number">1</span><h2>Nama dan kegiatan</h2></div>${employeePickerField({label:'Nama petugas',required:true})}<label class="field"><span>Jenis kegiatan</span><select name="activity_type" required><option value="PATROLI">Patroli</option><option value="JAGA">Jaga</option><option value="LAINNYA">Lainnya</option></select></label><label class="field"><span>Ceritakan kegiatan Anda</span><textarea name="activity_notes" required maxlength="10000" placeholder="Contoh: Patroli area parkir. Kondisi aman, penerangan menyala."></textarea></label></section><section class="step"><div class="step-title"><span class="step-number">2</span><h2>Lokasi Anda</h2></div><p class="hint">Tekan tombol di bawah, lalu pilih Izinkan bila diminta.</p><button type="button" class="button wide" data-location>${icon('location')}Ambil lokasi</button><p class="status" role="status" data-location-status>Lokasi belum diambil.</p></section><section class="step"><div class="step-title"><span class="step-number">3</span><h2>Foto kegiatan</h2></div><p class="hint">Ambil minimal 1 foto. Maksimal 5 foto.</p><button type="button" class="button wide" data-camera>${icon('camera')}Buka kamera</button><div class="camera-view" hidden><video autoplay muted playsinline aria-label="Pratinjau kamera"></video><div class="camera-actions"><button class="button primary" type="button" data-snap>Ambil foto</button><button class="button" type="button" data-camera-close>Tutup kamera</button></div></div><p class="status" role="status" data-camera-status></p><div class="photos" data-photos></div></section><div class="hidden-field" aria-hidden="true" inert><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div><p class="form-error" role="alert"></p><button class="button primary wide" type="submit">${icon('check')}Kirim laporan</button><p class="submit-note">Pastikan nama yang dipilih adalah nama Anda. Waktu pengiriman dicatat otomatis.</p></form>`;
  setupEmployeePicker(root,people,{required:true});
  const form=root.querySelector('form'),error=form.querySelector('.form-error'),locationStatus=form.querySelector('[data-location-status]'),cameraStatus=form.querySelector('[data-camera-status]'),video=form.querySelector('video');
  form.querySelector('[data-location]').addEventListener('click',()=>{
    if(busy)return;const control=form.querySelector('[data-location]');
    if(!navigator.geolocation){locationStatus.textContent='Lokasi tidak didukung. Buka tautan ini pada browser HP Anda.';return;}
    control.disabled=true;locationData=null;locationStatus.classList.remove('success');locationStatus.textContent='Mengambil lokasi…';
    navigator.geolocation.getCurrentPosition(position=>{if(closed||!form.isConnected)return;locationData={latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,captured_at:new Date(position.timestamp).toISOString()};locationStatus.textContent=`Lokasi berhasil diambil · akurasi ±${Math.round(position.coords.accuracy)} m`;locationStatus.classList.add('success');control.textContent='Ambil lokasi ulang';control.disabled=busy;},failure=>{if(closed||!form.isConnected)return;locationStatus.textContent=failure.code===1?'Izin lokasi belum diberikan. Izinkan lokasi pada pengaturan browser, lalu tekan Ambil lokasi.':'Lokasi belum terbaca. Aktifkan lokasi HP dan coba lagi di tempat dengan sinyal lebih baik.';control.disabled=busy;},{enableHighAccuracy:true,maximumAge:0,timeout:20000});
  });
  form.querySelector('[data-camera]').addEventListener('click',async()=>{
    if(busy)return;const control=form.querySelector('[data-camera]');control.disabled=true;cameraStatus.textContent='';
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Buka tautan ini pada browser HP untuk memakai kamera.');
      stopCamera();const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:960}},audio:false});
      if(busy||closed||!form.isConnected){media.getTracks().forEach(track=>track.stop());return;}
      stream=media;video.srcObject=media;await video.play();form.querySelector('.camera-view').hidden=false;
    }catch(failure){stopCamera();cameraStatus.textContent=failure.name==='NotAllowedError'?'Izin kamera belum diberikan. Izinkan kamera pada pengaturan browser, lalu coba lagi.':failure.name==='NotFoundError'?'Kamera tidak ditemukan. Buka tautan ini di browser HP yang memiliki kamera.':failure.name==='NotReadableError'?'Kamera sedang dipakai atau belum dapat diakses. Tutup aplikasi kamera lain, lalu coba kembali.':'Kamera belum dapat dibuka. Buka tautan ini di browser HP dan coba kembali.';}finally{if(form.isConnected)control.disabled=busy;}
  });
  form.querySelector('[data-camera-close]').addEventListener('click',()=>{if(!busy)stopCamera();});
  function renderPhotos(){form.querySelector('[data-photos]').innerHTML=photos.map((photo,index)=>`<figure><img src="${photo.preview}" alt="Foto kegiatan ${index+1}"><figcaption>Foto ${index+1}<button class="remove-photo" type="button" data-remove="${index}" aria-label="Hapus foto ${index+1}">Hapus</button></figcaption></figure>`).join('');}
  form.querySelector('[data-snap]').addEventListener('click',async()=>{
    if(busy)return;if(photos.length>=5){cameraStatus.textContent='Sudah ada 5 foto. Hapus foto bila ingin menggantinya.';return;}
    if(!stream||!video.videoWidth){cameraStatus.textContent='Tunggu gambar kamera muncul, lalu coba lagi.';return;}
    const snap=form.querySelector('[data-snap]');snap.disabled=true;
    try{
      const canvas=document.createElement('canvas'),scale=Math.min(1,1280/video.videoWidth,1280/video.videoHeight);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.8));if(!blob||blob.size>1500000)throw new Error('Foto belum dapat disimpan. Coba ambil kembali.');
      const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
      if(closed||!form.isConnected)return;const preview=URL.createObjectURL(blob);previews.add(preview);photos.push({data:btoa(binary),mime_type:'image/jpeg',captured_at:new Date().toISOString(),source:'CAMERA',preview});renderPhotos();cameraStatus.textContent='Foto berhasil diambil. Anda dapat menutup kamera atau menambah foto.';
    }catch(failure){cameraStatus.textContent=failure.message;}finally{snap.disabled=busy;}
  });
  form.querySelector('[data-photos]').addEventListener('click',event=>{const button=event.target.closest('[data-remove]');if(button&&!busy){const [photo]=photos.splice(Number(button.dataset.remove),1);URL.revokeObjectURL(photo.preview);previews.delete(photo.preview);renderPhotos();}});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;error.textContent='';
    const data=Object.fromEntries(new FormData(form));
    if(!data.employee_id||!people.some(p=>p.id===data.employee_id)){error.textContent='Pilih nama Anda dari hasil pencarian.';return;}
    if(!locationData){error.textContent='Tekan Ambil lokasi terlebih dahulu.';form.querySelector('[data-location]').focus();return;}
    if(!photos.length){error.textContent='Ambil minimal satu foto kegiatan terlebih dahulu.';form.querySelector('[data-camera]').focus();return;}
    const cutoff=Date.now()-15*60000;if(Date.parse(locationData.captured_at)<cutoff||photos.some(p=>Date.parse(p.captured_at)<cutoff)){error.textContent='Foto atau lokasi sudah lebih dari 15 menit. Ambil foto dan lokasi kembali.';return;}
    busy=true;stopCamera();const controls=[...form.querySelectorAll('input,select,textarea,button')].map(control=>({control,disabled:control.disabled}));controls.forEach(({control})=>control.disabled=true);const submit=form.querySelector('[type=submit]');submit.textContent='Mengirim laporan…';
    try{
      const result=await request('submit',{employee_id:data.employee_id,activity_type:data.activity_type,activity_notes:data.activity_notes,website:data.website||'',location:locationData,photos:photos.map(({preview,...photo})=>photo),idempotency_key:requestKey});
      clearEvidence();root.innerHTML=`<section class="message" role="status"><p class="eyebrow">Selesai</p><h1>Laporan berhasil dikirim</h1><p>Terima kasih. Laporan kegiatan Anda sudah masuk ke Logbook &amp; Patroli BP Besakih.</p><div class="receipt">${esc(result.reference)}</div><p class="hint">Diterima ${formatDate(result.received_at)} pukul ${formatTime(result.received_at)} WITA.</p><button type="button" class="button primary wide" data-new-report>Buat laporan berikutnya</button></section>`;
      root.querySelector('[data-new-report]').addEventListener('click',()=>{busy=false;requestKey=crypto.randomUUID();render();window.scrollTo({top:0,behavior:'smooth'});});window.scrollTo({top:0,behavior:'smooth'});
    }catch(failure){error.textContent=failure.name==='TimeoutError'||failure.name==='TypeError'?'Pengiriman belum dapat dikonfirmasi. Periksa koneksi lalu tekan Kirim laporan lagi.':failure.message;busy=false;controls.forEach(({control,disabled})=>control.disabled=disabled);submit.innerHTML=`${icon('check')}Kirim laporan`;
    }
  });
}
async function start(){
  if(!/^[a-f0-9]{64}$/.test(token)){root.innerHTML='<section class="message"><h1>Tautan belum lengkap</h1><p>Buka tautan lengkap yang dibagikan koordinator melalui WhatsApp atau pesan Anda.</p></section>';return;}
  if(!window.isSecureContext){root.innerHTML='<section class="message"><h1>Buka melalui tautan HTTPS</h1><p>Kamera dan lokasi memerlukan sambungan aman. Minta tautan lengkap kepada koordinator.</p></section>';return;}
  try{const data=await request('context',{});people=data.employees;label=data.label;document.title=`${label} · BP Besakih`;if(!people.length)throw new Error('Belum ada petugas aktif pada formulir ini. Hubungi koordinator.');render();}
  catch(failure){root.innerHTML=`<section class="message"><h1>Formulir belum dapat dibuka</h1><p>${esc(failure.message)}</p><button class="button primary wide" type="button" data-retry>Coba buka kembali</button></section>`;root.querySelector('[data-retry]').addEventListener('click',start);}
}
window.addEventListener('pagehide',()=>{closed=true;clearEvidence();});window.addEventListener('pageshow',()=>{closed=false;});window.addEventListener('hashchange',()=>location.reload());
start();
