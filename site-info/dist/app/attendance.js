import {state,api,post,patch,refresh} from './api.js';
import {esc,icon,button,dialog,formDialog,field,options,toast} from './ui.js';
import {createXlsx} from './xlsx-export.js';

let data=null,owner=null,tab='today',rows=[],people=[],settings=null,pending=null,media=null,captureDialog=null,generation=0;
let period={from:'',to:''},scope='self';
const names={NOT_YET:'Belum absen',NOT_ACTIVE:'Belum aktif',NEEDS_SCHEDULE:'Jadwal draf',PRESENT:'Hadir',PRESENT_OFF:'Hadir hari libur',OFF:'Libur',ABSENT:'Alpa',ABSENT_PENDING:'Alpa sementara',SICK:'Sakit',PERMIT:'Izin',LEAVE:'Cuti',PENDING:'Menunggu',APPROVED:'Disetujui',REJECTED:'Ditolak',DRAFT:'Draf',PUBLISHED:'Diterbitkan'};
const clock=v=>v?new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Makassar',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(v)):'—';
const day=v=>new Date(new Date(v).getTime()+28800000).toISOString().slice(0,10);
const localInput=v=>v?new Date(Date.parse(v)+28800000).toISOString().slice(0,16):'';
const dateLabel=v=>v?new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Makassar',day:'numeric',month:'long',year:'numeric'}).format(new Date(v)):'—';
const badge=s=>`<span class="att-badge att-${String(s).toLowerCase()}">${esc(names[s]||s)}</span>`;
const action=(label,key,extra='',kind='outlined')=>button(label,'att-'+key,'calendar',kind,extra);
const card=(title,body)=>`<section class="card att-card"><h2>${esc(title)}</h2>${body}</section>`;
const table=(headers,items)=>items.length?`<div class="table-wrap"><table><thead><tr>${headers.map(v=>`<th>${esc(v)}</th>`).join('')}</tr></thead><tbody>${items.join('')}</tbody></table></div>`:'<div class="att-empty">Belum ada data untuk periode ini.</div>';
const select=(label,name,values,value='',optional=false)=>field(label,name,'select',options(values.map(([id,name])=>({id,name})),'id','name',value,'Pilih…'),optional?'optional':'');
const query=()=>new URLSearchParams({...period,scope}).toString();
const validSession=(session,token)=>session===state.me&&token===generation&&state.route==='attendance';
function stopCamera(){media?.getTracks().forEach(t=>t.stop());media=null;}
export function resetAttendance(){generation++;stopCamera();captureDialog?.close();captureDialog=null;data=null;owner=null;pending=null;rows=[];people=[];settings=null;tab='today';scope='self';period={from:'',to:''};}
export function leaveAttendance(){generation++;stopCamera();captureDialog?.close();captureDialog=null;}

export async function loadAttendancePage(){
 if(owner!==state.me){resetAttendance();owner=state.me;}
 const session=state.me,token=++generation;
 const next=await api('attendance/me');if(!validSession(session,token))throw new Error('Halaman atau sesi berubah.');data=next;
 if(!data.installed)return `<div class="att-page"><div class="page-heading"><div><div class="eyebrow">KEHADIRAN PEGAWAI</div><h1>Absensi</h1></div></div>${card('Absensi sedang disiapkan',`<p>${esc(data.reason)}</p><p>Jam kerja dan shift akan mengikuti jadwal yang ditetapkan pengelola.</p>`)}</div>`;
 if(!period.to){period.to=day(data.server_time);period.from=period.to.slice(0,8)+'01';}
 if(!tabs().some(([id])=>id===tab))tab='today';
 let result=null;
 if(tab==='history')result=await api('attendance/records?'+query());
 if(tab==='requests')result=await api('attendance/requests?'+query());
 if(tab==='schedules')result=await api('attendance/schedules?'+query());
 if(tab==='settings')result=await api('attendance/settings');
 if(!validSession(session,token))throw new Error('Halaman atau sesi berubah.');
 rows=result?.items||[];settings=tab==='settings'?result:null;
 return render();
}
function tabs(){const c=data.capabilities||{};return [['today','Hari ini'],['history','Riwayat'],['requests','Sakit & izin'],...(c.schedule?[['schedules','Jadwal']]:[]),...(c.settings?[['settings','Pengaturan']]:[])];}
function render(){
 return `<div class="att-page"><div class="page-heading"><div><div class="eyebrow">KEHADIRAN PEGAWAI</div><h1>Absensi</h1><p>Catat kehadiran, lihat riwayat, dan ajukan sakit atau izin.</p></div>${action('Muat ulang','reload')}</div>
 <nav class="att-tabs" aria-label="Bagian absensi">${tabs().map(([id,label])=>`<button class="${tab===id?'active':''}" data-action="att-tab" data-tab="${id}" ${tab===id?'aria-current="page"':''}>${esc(label)}</button>`).join('')}</nav>
 ${pending?`<div class="notice warning"><p>Status pengiriman sebelumnya belum dipastikan. Periksa sebelum mengambil absen baru.</p>${action('Periksa pengiriman','recover')}</div>`:''}
 ${tab==='today'?todayView():tab==='settings'?settingsView():`${filters()}${tab==='history'?historyView():tab==='requests'?requestsView():schedulesView()}`}
 <p class="att-foot">Waktu mengikuti WITA · Jadwal kosong tidak dihitung alpa.</p></div>`;
}
function todayView(){
 const r=data.result,s=r?.schedule,c=data.config,loc=data.location;
 return `<div class="att-dashboard"><section class="att-hero"><div class="att-hero-top"><span>${esc(dateLabel(data.server_time))}</span><span>WITA</span></div><h2>${esc(data.employee?.full_name||state.me.name||'Selamat datang')}</h2><p>${esc(s?s.name:'Jadwal belum tersedia')}</p><div class="att-time">${clock(data.server_time)}</div><small>Waktu server saat halaman dimuat</small><div class="att-punches"><div><span>Masuk</span><strong>${clock(r?.in_at)}</strong></div><div><span>Keluar</span><strong>${clock(r?.out_at)}</strong></div></div><div class="att-punch-actions">${button('Absen masuk','att-in','arrow','primary',!data.actions.in||pending?'disabled':'')}${button('Absen keluar','att-out','arrow','outlined',!data.actions.out||pending?'disabled':'')}</div>${data.reason?`<p class="att-hero-note">${esc(data.reason)}</p>`:''}</section>
 <div class="att-side">${card('Status hari ini',`${badge(r?.status||'NEEDS_SCHEDULE')}<dl class="att-facts"><div><dt>Jadwal kerja</dt><dd>${s?clock(s.starts_at)+' – '+clock(s.ends_at):'Menunggu penetapan'}</dd></div><div><dt>Keterlambatan</dt><dd>${r?Number(r.late_minutes)+' menit':'—'}</dd></div><div><dt>Catatan</dt><dd>${r?.conflict?'Hadir bersamaan dengan cuti/sakit/izin. Perlu pemeriksaan.':r?.completeness==='INCOMPLETE'?'Hadir; absen keluar belum lengkap.':r?.corrected?'Dikoreksi oleh pengelola.':'—'}</dd></div></dl>`)}
 ${card('Lokasi absensi',loc?`<div class="att-location">${icon('building')}<div><strong>${esc(loc.name)}</strong><p>${data.profile.location_mode==='UNRESTRICTED'?'Akun memiliki pengecualian batas lokasi.':`Radius ${Number(loc.radius_m)} meter`}</p></div></div><p class="muted">${Number(loc.latitude)}, ${Number(loc.longitude)}</p><a class="att-map-link" href="https://www.openstreetmap.org/?mlat=${Number(loc.latitude)}&mlon=${Number(loc.longitude)}#map=18/${Number(loc.latitude)}/${Number(loc.longitude)}" target="_blank" rel="noopener noreferrer">Lihat titik kantor ↗</a>`:'<p>Titik lokasi belum tersedia.</p>')}</div></div>
 <div class="att-bottom">${card('Sebelum melakukan absensi','<ol><li>Berada di lokasi yang ditentukan.</li><li>Izinkan kamera dan lokasi saat diminta.</li><li>Ambil selfie, lalu periksa konfirmasi tersimpan.</li></ol><p class="muted">Kehadiran tercatat setelah server menerima dan memvalidasi kiriman.</p>')}${card('Sakit atau izin?',`<p>Pengajuan dilengkapi bukti dan diperiksa pengelola. Statusnya bisa dipantau di tab Sakit & izin.</p>${action('Buat pengajuan','request-new','', 'primary')}`)}</div>
 ${c.privacy_notice?`<div class="att-privacy"><strong>Penggunaan foto dan lokasi</strong><p>${esc(c.privacy_notice)}</p></div>`:''}`;
}
function filters(){const team=tab==='history'?data.capabilities.read:tab==='requests'?data.capabilities.approve:false;return `<form id="att-filter" class="att-filter">${field('Dari','from','date',period.from)}${field('Sampai','to','date',period.to)}${team?select('Cakupan','scope',[['self','Saya'],['all','Tim sesuai hak akses']],scope):''}<button class="button outlined" type="submit">Tampilkan</button></form>`;}
function historyView(){
 const count=status=>rows.filter(r=>r.status===status).length;
 return `<div class="att-metrics"><div><strong>${count('PRESENT')+count('PRESENT_OFF')}</strong><span>Hadir</span></div><div><strong>${rows.reduce((a,r)=>a+r.late_minutes,0)}</strong><span>Menit terlambat</span></div><div><strong>${rows.filter(r=>r.completeness==='INCOMPLETE').length}</strong><span>Belum lengkap</span></div><div><strong>${count('ABSENT')}</strong><span>Alpa</span></div></div><section class="card"><div class="att-toolbar"><h2>Riwayat kehadiran</h2>${scope==='self'||data.capabilities.export?action('Ekspor Excel','export'):''}</div>${table(['Tanggal','Pegawai','Jadwal','Masuk','Keluar','Status',''],rows.map(r=>`<tr><td>${esc(r.schedule.work_date)}</td><td>${esc(r.employee_name)}</td><td>${esc(r.schedule.name)}</td><td>${clock(r.in_at)}</td><td>${clock(r.out_at)}</td><td>${badge(r.status)}${r.completeness==='INCOMPLETE'?'<small class="att-warning">Belum lengkap</small>':''}${r.conflict?'<small class="att-warning">Perlu pemeriksaan</small>':''}</td><td>${action('Detail','detail',`data-id="${esc(r.schedule.id)}"`,'text')}</td></tr>`))}</section>`;
}
function requestsView(){return `<section class="card"><div class="att-toolbar"><h2>Pengajuan sakit & izin</h2>${action('Ajukan','request-new','', 'primary')}</div>${table(['Tanggal','Pegawai','Jenis','Status',''],rows.map(r=>`<tr><td>${esc(r.work_date)}</td><td>${esc(r.employee_name)}</td><td>${esc(names[r.kind])}</td><td>${badge(r.status)}</td><td>${action('Lihat','request-detail',`data-id="${esc(r.id)}"`,'text')}</td></tr>`))}</section>`;}
function schedulesView(){return `<section class="card"><div class="att-toolbar"><h2>Jadwal pegawai</h2>${action('Tetapkan jadwal','schedule-new','', 'primary')}</div><p class="att-padding muted">Satu penugasan per tanggal mulai. Jam kerja, toleransi, dan jendela absensi diisi pengelola dalam WITA.</p>${table(['Tanggal','Pegawai','Jadwal','Jam kerja','Status',''],rows.map(r=>`<tr><td>${esc(r.work_date)}</td><td>${esc(r.employee_name)}</td><td>${esc(r.name)}</td><td>${clock(r.starts_at)} – ${clock(r.ends_at)}</td><td>${badge(r.status)}</td><td>${action('Ubah','schedule-edit',`data-id="${esc(r.id)}"`,'text')}</td></tr>`))}</section>`;}
function settingsView(){const c=settings.config;return `<div class="att-bottom">${card('Kebijakan & aktivasi',`<p>${c.enabled?'Konfigurasi aktif. Penerimaan absensi juga memerlukan pembukaan layanan dan aktivasi setiap pegawai.':'Penerimaan absensi belum aktif.'}</p><dl class="att-facts"><div><dt>Tanggal mulai</dt><dd>${esc(c.activation_on?.slice(0,10)||'Belum ditetapkan')}</dd></div><div><dt>Akurasi GPS maksimum</dt><dd>${c.gps_max_accuracy_m?c.gps_max_accuracy_m+' m':'Belum ditetapkan'}</dd></div><div><dt>Retensi bukti</dt><dd>${c.evidence_retention_days?c.evidence_retention_days+' hari':'Belum ditetapkan'}</dd></div></dl>${action('Atur kebijakan','config')}${action('Pengaturan pegawai','people')}`)}${card('Titik absensi',settings.locations.map(l=>`<div class="att-location-row"><strong>${esc(l.name)}</strong><p>${Number(l.latitude)}, ${Number(l.longitude)} · ${Number(l.radius_m)} m</p>${action('Ubah titik','location-edit',`data-id="${esc(l.id)}"`,'text')}</div>`).join('')+action('Tambah titik','location-new'))}</div>`;}

export function bindAttendancePage(){
 if(state.route!=='attendance')return;
 document.querySelector('#att-filter')?.addEventListener('submit',e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.target));period={from:b.from,to:b.to};scope=b.scope||'self';refresh();});
}
async function getPeople(){const session=state.me;const result=await api('attendance/people');if(session!==state.me)throw new Error('Sesi berubah.');people=result.items;return people;}
function afterSave(message){toast(message);refresh();}
function cameraError(error){return ({NotAllowedError:'Izin kamera ditolak. Izinkan kamera pada pengaturan browser.',NotFoundError:'Kamera tidak ditemukan.',NotReadableError:'Kamera sedang dipakai aplikasi lain.'})[error.name]||error.message;}
function locate(){return new Promise((resolve,reject)=>{if(!navigator.geolocation)return reject(new Error('Browser ini tidak mendukung lokasi.'));navigator.geolocation.getCurrentPosition(resolve,e=>reject(new Error(({1:'Izin lokasi ditolak. Izinkan lokasi pada pengaturan browser.',2:'Lokasi belum ditemukan. Coba di area terbuka.',3:'Pembacaan lokasi melewati batas waktu. Coba lagi.'})[e.code]||'Lokasi gagal dibaca.')),{enableHighAccuracy:true,maximumAge:0,timeout:20000});});}
async function capture(kind){
 if(pending)return recover();
 const session=state.me,token=generation;
 if(!data.actions[kind==='IN'?'in':'out'])throw new Error('Absensi belum dapat dilakukan. Muat ulang halaman.');
 const d=dialog(kind==='IN'?'Absen masuk':'Absen keluar',`<p>${esc(data.config.privacy_notice)}</p><div class="att-camera"><video autoplay playsinline muted aria-label="Pratinjau kamera depan"></video></div><p data-status role="status">Menghubungkan kamera…</p><p class="form-error" role="alert"></p><button class="button primary" data-capture disabled>Ambil selfie & kirim</button><p class="muted">Lokasi dibaca saat tombol ditekan. Foto tidak disimpan di perangkat.</p>`);captureDialog=d;
 d.addEventListener('close',()=>{stopCamera();captureDialog=null;},{once:true});
 const live=()=>validSession(session,token)&&d.open;
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Kamera memerlukan browser yang mendukung akses kamera melalui HTTPS.');
  const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:{ideal:960},height:{ideal:1280}}});
  if(!live()){stream.getTracks().forEach(t=>t.stop());return;}media=stream;
  const video=d.querySelector('video');video.srcObject=stream;await video.play();if(!live())return;
  d.querySelector('[data-status]').textContent='Posisikan wajah dengan jelas, lalu ambil selfie.';
  const submit=d.querySelector('[data-capture]');submit.disabled=false;
  submit.addEventListener('click',async()=>{
   submit.disabled=true;const error=d.querySelector('.form-error');error.textContent='';
   try{
    d.querySelector('[data-status]').textContent='Membaca lokasi…';const gps=await locate();if(!live())return;
    if(!video.videoWidth)throw new Error('Kamera belum siap. Coba lagi.');
    const canvas=document.createElement('canvas'),scale=Math.min(1,960/video.videoWidth);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
    const photo={mime_type:'image/jpeg',data:canvas.toDataURL('image/jpeg',0.78).split(',')[1]};canvas.width=0;canvas.height=0;
    if(photo.data.length>2796204)throw new Error('Foto terlalu besar. Coba ulangi pengambilan.');
    pending={client_key:crypto.randomUUID(),schedule_id:data.result.schedule.id,kind,latitude:gps.coords.latitude,longitude:gps.coords.longitude,accuracy_m:gps.coords.accuracy,location_read_at:new Date(gps.timestamp).toISOString(),capture_source:'CAMERA',photo};
    d.querySelector('[data-status]').textContent='Mengirim dan memeriksa absensi…';
    await sendPending();if(live())d.close();
   }catch(e){if(live()){error.textContent=e.message;submit.disabled=!!pending;if(pending){d.querySelector('[data-status]').textContent='Tutup jendela, lalu pilih Periksa pengiriman.';refresh();}}}
  });
 }catch(e){if(live())d.querySelector('.form-error').textContent=cameraError(e);}
}
async function sendPending(){
 const body=pending,session=state.me;if(!body)return;
 try{const result=await api('attendance/events',{method:'POST',body,signal:AbortSignal.timeout(25000)});if(session!==state.me)return;pending=null;stopCamera();afterSave(`${body.kind==='IN'?'Absen masuk':'Absen keluar'} tersimpan pukul ${clock(result.receipt.received_at)} WITA.`);}
 catch(e){if(session!==state.me)return;if(e.status&&e.status<500){pending=null;throw e;}throw new Error('Koneksi terputus atau server belum memberi kepastian. Periksa pengiriman untuk menghindari catatan ganda.');}
}
async function recover(){
 if(!pending)return;const session=state.me,body=pending;
 try{const r=await api('attendance/submissions/'+body.client_key);if(session!==state.me)return;pending=null;afterSave(`Absensi sudah tersimpan pukul ${clock(r.receipt.received_at)} WITA.`);}
 catch(e){if(session!==state.me)return;if(e.status===404)await sendPending();else throw e;}
}
async function fileEvidence(file){if(!file?.size||file.size>2097152)throw new Error('Bukti wajib diisi, maksimal 2 MB.');if(!['image/jpeg','image/png','application/pdf'].includes(file.type))throw new Error('Gunakan JPEG, PNG, atau PDF.');const bytes=new Uint8Array(await file.arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return {mime_type:file.type,data:btoa(text)};}
function newRequest(){let last=null;formDialog('Pengajuan sakit atau izin',select('Jenis','kind',[['SICK','Sakit'],['PERMIT','Izin']])+field('Tanggal','work_date','date',day(data.server_time))+field('Alasan','reason','textarea','','maxlength="2000"')+field('Bukti pendukung (maks. 2 MB)','evidence','file','','accept="image/jpeg,image/png,application/pdf"'),async b=>{const session=state.me,evidence=await fileEvidence(b.evidence);if(session!==state.me)throw new Error('Sesi berubah.');const payload={kind:b.kind,work_date:b.work_date,reason:b.reason,evidence},fingerprint=JSON.stringify(payload);if(last?.fingerprint!==fingerprint)last={fingerprint,key:crypto.randomUUID()};await post('attendance/requests',{...payload,client_key:last.key});tab='requests';scope='self';period.from=period.from<b.work_date?period.from:b.work_date;period.to=period.to>b.work_date?period.to:b.work_date;afterSave('Pengajuan tersimpan dan menunggu pemeriksaan.');},{note:'Tahap awal: satu tanggal per pengajuan. Sakit diajukan pada hari H atau H-1; izin sebelum hari pelaksanaan.'});}
async function showProof(id){
 const session=state.me,response=await fetch('/api/attendance/evidence/'+encodeURIComponent(id),{credentials:'same-origin',cache:'no-store'});
 if(!response.ok){const e=await response.json();throw new Error(e.error||'Bukti tidak dapat dibuka.');}
 const blob=await response.blob();if(session!==state.me)return;const url=URL.createObjectURL(blob);
 if(blob.type.startsWith('image/')){const d=dialog('Bukti absensi',`<img class="att-proof" src="${url}" alt="Bukti absensi yang diizinkan untuk akun ini">`);d.addEventListener('close',()=>URL.revokeObjectURL(url),{once:true});}
 else{const a=document.createElement('a');a.href=url;a.download='bukti-absensi.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
async function showDetail(id){const session=state.me,r=await api('attendance/records/'+id);if(session!==state.me)return;const d=dialog('Detail kehadiran',`<p><strong>${esc(r.employee.full_name)}</strong> · ${esc(r.schedule.work_date)}</p>${badge(r.status)}<dl class="att-facts"><div><dt>Masuk / keluar efektif</dt><dd>${clock(r.in_at)} / ${clock(r.out_at)}</dd></div><div><dt>Catatan asli</dt><dd>${clock(r.actual_in_at)} / ${clock(r.actual_out_at)}</dd></div><div><dt>Terlambat / pulang awal</dt><dd>${r.late_minutes} / ${r.early_minutes} menit</dd></div></dl>${r.correction?`<p>Koreksi: ${esc(r.correction.reason)}</p>`:''}<div class="actions">${r.events.filter(e=>e.evidence_id).map(e=>action('Selfie '+(e.kind==='IN'?'masuk':'keluar'),'proof',`data-id="${esc(e.evidence_id)}"`)).join('')}${r.can_correct?'<button class="button primary" data-correct>Koreksi catatan</button>':''}</div>`);
 d.querySelector('[data-correct]')?.addEventListener('click',()=>{d.close();formDialog('Koreksi kehadiran',field('Masuk (WITA)','in_at','datetime-local',localInput(r.in_at),'optional')+field('Keluar (WITA)','out_at','datetime-local',localInput(r.out_at),'optional')+field('Alasan koreksi','reason','textarea','','maxlength="2000"'),async b=>{await post('attendance/schedules/'+id+'/correction',{...b,in_at:b.in_at?b.in_at+':00+08:00':null,out_at:b.out_at?b.out_at+':00+08:00':null,row_version:r.schedule.row_version});afterSave('Koreksi tersimpan. Catatan asli tetap tersedia.');},{note:'Kosongkan jam untuk menghapus nilai efektif. Setiap perubahan dicatat dalam audit.'});});}
function requestDetail(id){const r=rows.find(r=>r.id===id);if(!r)return;const d=dialog('Detail pengajuan',`<p><strong>${esc(r.employee_name)}</strong> · ${esc(r.work_date)}</p>${badge(r.status)}<p>${esc(r.reason)}</p>${r.decision_note?`<p>Catatan pengelola: ${esc(r.decision_note)}</p>`:''}${action('Buka bukti','proof',`data-id="${esc(r.evidence_id)}"`)}${scope==='all'&&data.capabilities.approve&&r.status==='PENDING'?'<button class="button primary" data-decide>Periksa pengajuan</button>':''}`);d.querySelector('[data-decide]')?.addEventListener('click',()=>{d.close();formDialog('Keputusan pengajuan',select('Keputusan','status',[['APPROVED','Setujui'],['REJECTED','Tolak']])+field('Catatan (wajib untuk penolakan)','note','textarea','','optional maxlength="1000"')+field('Saya telah memeriksa bukti pendukung','evidence_reviewed','checkbox',false),async b=>{await post('attendance/requests/'+id+'/decision',{...b,row_version:r.row_version});afterSave('Keputusan tersimpan.');});});}
async function scheduleForm(row={}){await getPeople();const times=[['starts_at','Mulai kerja'],['ends_at','Selesai kerja'],['checkin_opens_at','Absen masuk dibuka'],['checkin_closes_at','Absen masuk ditutup'],['checkout_closes_at','Absen keluar ditutup'],['late_after','Batas toleransi terlambat']];formDialog('Jadwal absensi',field('Pegawai','employee_id','select',options(people,'id','full_name',row.employee_id))+field('Tanggal mulai kerja','work_date','date',row.work_date||'')+field('Nama jadwal','name','text',row.name||'','maxlength="80"')+select('Jenis hari','day_kind',[['WORK','Hari kerja'],['OFF','Hari libur']],row.day_kind||'WORK')+times.map(([key,label])=>field(label+' (WITA)',key,'datetime-local',localInput(row[key]))).join('')+select('Status','status',[['DRAFT','Simpan draf'],['PUBLISHED','Terbitkan']],row.status||'DRAFT')+field('Alasan penetapan','reason','textarea'),async b=>{await post('attendance/schedules',{...b,...Object.fromEntries(times.map(([k])=>[k,b[k]+':00+08:00'])),row_version:row.row_version});period.from=period.from<b.work_date?period.from:b.work_date;period.to=period.to>b.work_date?period.to:b.work_date;afterSave('Jadwal tersimpan.');},{wide:true,note:'Isi seluruh jam secara eksplisit. Untuk shift melewati tengah malam, pilih tanggal akhir yang sesuai. Penerbitan membutuhkan kebijakan dan pegawai yang sudah aktif.'});}
function configForm(){const c=settings.config;formDialog('Kebijakan absensi',field('Aktifkan konfigurasi','enabled','checkbox',c.enabled)+field('Tanggal mulai','activation_on','date',c.activation_on?.slice(0,10)||'','optional')+select('Batas waktu','boundary_mode',[['EXACT','Tepat pada detik yang ditetapkan'],['WHOLE_MINUTE','Sampai akhir menit batas']],c.boundary_mode,true)+select('Pembulatan menit','minute_rounding',[['FLOOR','Bulatkan ke bawah'],['CEIL','Bulatkan ke atas']],c.minute_rounding,true)+field('Akurasi GPS maksimum (meter)','gps_max_accuracy_m','number',c.gps_max_accuracy_m??'','optional min="1" max="100"')+field('Usia lokasi maksimum (detik)','gps_max_age_seconds','number',c.gps_max_age_seconds??'','optional min="5" max="300"')+field('Retensi bukti (hari)','evidence_retention_days','number',c.evidence_retention_days??'','optional min="1" max="3650"')+select('Cakupan pengajuan','request_day_mode',[['SINGLE_DAY','Satu hari per pengajuan']],c.request_day_mode,true)+field('Pemberitahuan penggunaan foto dan lokasi','privacy_notice','textarea',c.privacy_notice,'optional maxlength="3000"')+field('Kebijakan bukti dan retensi telah ditetapkan','evidence_policy_confirmed','checkbox',c.evidence_policy_confirmed)+field('Alasan perubahan','reason','textarea'),async b=>{await patch('attendance/settings',{...b,...Object.fromEntries(['gps_max_accuracy_m','gps_max_age_seconds','evidence_retention_days'].map(k=>[k,b[k]===''?null:Number(b[k])])),row_version:c.row_version});afterSave('Kebijakan tersimpan.');},{wide:true,note:'Penerimaan absensi dibuka setelah kesiapan operasional, pengelolaan bukti, dan jadwal diselesaikan.'});}
function locationForm(row={}){formDialog('Titik absensi',field('Nama titik','name','text',row.name||'','maxlength="100"')+field('Latitude','latitude','number',row.latitude??'','step="any" min="-90" max="90"')+field('Longitude','longitude','number',row.longitude??'','step="any" min="-180" max="180"')+field('Radius (meter)','radius_m','number',row.radius_m??100,'step="any" min="1" max="10000"')+field('Titik aktif','is_active','checkbox',row.is_active!==false)+field('Alasan perubahan','reason','textarea'),async b=>{await post('attendance/locations',{...b,id:row.id,row_version:row.row_version,latitude:Number(b.latitude),longitude:Number(b.longitude),radius_m:Number(b.radius_m)});afterSave('Titik absensi tersimpan.');});}
async function peopleForm(){await getPeople();const d=formDialog('Aktivasi pegawai',field('Pegawai','employee_id','select',options(people,'id','full_name')),async b=>{const person=people.find(p=>p.id===b.employee_id),p=person.profile;formDialog(person.full_name,field('Aktifkan absensi','enabled','checkbox',p.enabled)+field('Berlaku mulai','active_from','date',p.active_from?.slice(0,10)||'','optional')+select('Ketentuan lokasi','location_mode',[['DEFAULT','Titik kantor'],['CUSTOM','Titik khusus'],['UNRESTRICTED','Tanpa pembatasan radius']],p.location_mode)+field('Titik khusus','location_id','select',options(settings.locations,'id','name',p.location_id),'optional')+field('Alasan perubahan','reason','textarea'),async b2=>{await patch('attendance/people/'+person.id,{...b2,row_version:p.row_version});afterSave('Pengaturan pegawai tersimpan.');},{note:'Pengecualian lokasi harus disertai alasan. Aktivasi tidak membuat jadwal secara otomatis.'});},{submit:'Lanjut'});return d;}
async function exportReport(){const session=state.me,r=await api('attendance/export?'+query());if(session!==state.me)return;const detail=r.items.map(x=>({date:x.schedule.work_date,name:x.employee_name,no:x.employee_no,schedule:x.schedule.name,status:names[x.status],in:x.in_at,out:x.out_at,late:x.late_minutes,early:x.early_minutes,note:[x.completeness==='INCOMPLETE'?'Belum lengkap':'',x.corrected?'Dikoreksi':'',x.conflict?'Perlu pemeriksaan':''].filter(Boolean).join('; ')}));
 const summary=[...new Set(detail.map(r=>r.no))].map(no=>{const list=detail.filter(r=>r.no===no);return {no,name:list[0].name,present:list.filter(r=>['Hadir','Hadir hari libur'].includes(r.status)).length,absent:list.filter(r=>r.status==='Alpa').length,late:list.reduce((n,r)=>n+r.late,0)};});
 const cols=(items)=>items.map(([key,header,kind='string'])=>({key,header,kind,width:22}));
 const blob=createXlsx([{name:'Ringkasan',columns:cols([['no','Nomor pegawai'],['name','Pegawai'],['present','Hadir','number'],['absent','Alpa','number'],['late','Menit terlambat','number']]),rows:summary},{name:'Detail',columns:cols([['date','Tanggal','date'],['no','Nomor pegawai'],['name','Pegawai'],['schedule','Jadwal'],['status','Status'],['in','Masuk WITA','datetime'],['out','Keluar WITA','datetime'],['late','Terlambat (menit)','number'],['early','Pulang awal (menit)','number'],['note','Keterangan']]),rows:detail},{name:'Keterangan',columns:cols([['key','Keterangan'],['value','Nilai']]),rows:[{key:'Periode',value:r.from+' s.d. '+r.to},{key:'Zona waktu',value:'WITA (Asia/Makassar)'},{key:'Jadwal kosong',value:'Tidak dihitung alpa; tidak menghasilkan baris kehadiran.'},{key:'Alpa sementara',value:'Pengajuan sakit/izin masih menunggu keputusan.'},{key:'Dibuat',value:r.generated_at}]}]);const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`Absensi_${r.from}_${r.to}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export async function handleAttendanceAction(name,el){
 if(!name.startsWith('att-'))return false;if(!data?.installed&&name!=='att-reload')return true;
 const key=name.slice(4);el.disabled=true;
 try{
  if(key==='tab'){tab=el.dataset.tab;scope='self';refresh();}
  else if(key==='reload')refresh();else if(key==='in'||key==='out')await capture(key.toUpperCase());
  else if(key==='recover')await recover();else if(key==='request-new')newRequest();
  else if(key==='proof')await showProof(el.dataset.id);else if(key==='detail')await showDetail(el.dataset.id);
  else if(key==='request-detail')requestDetail(el.dataset.id);else if(key==='schedule-new')await scheduleForm();
  else if(key==='schedule-edit')await scheduleForm(rows.find(r=>r.id===el.dataset.id));else if(key==='config')configForm();
  else if(key==='location-new')locationForm();else if(key==='location-edit')locationForm(settings.locations.find(r=>r.id===el.dataset.id));
  else if(key==='people')await peopleForm();else if(key==='export')await exportReport();
 }finally{if(el.isConnected)el.disabled=false;}return true;
}
