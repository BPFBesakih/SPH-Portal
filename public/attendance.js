import {api,post,patch,state} from './api.js';
import {esc,icon,toast,dialog,formDialog,localToday,formatDate,formatTime,number} from './ui.js';
import {createXlsx} from './xlsx-export.js';
import {encodeQR} from './vendor/qr.js';
import {employeePickerField,setupEmployeePicker} from './employee-picker.js';

// Menu Absensi (menu bersama, seperti Cuti). Isi halaman mengikuti cakupan akun:
// pegawai melihat absennya sendiri, atasan melihat bawahannya, Pengelola Absensi
// sesuai cakupan role. Selfie dibuka satu per satu lewat antrean API.
export const attendanceTitle='Absensi';
const A={owner:null,overview:null,tab:null,unit:'',query:'',from:null,to:null,today:null,recap:null,reviewFrom:null,reviewTo:null,reviewStatus:'open',review:null,
 devices:null,points:null,mine:null,sessionTokens:new Map(),poll:null,map:null};
const statusLabel={HADIR:'Hadir',BELUM_PULANG:'Masuk, belum pulang',TANPA_PULANG:'Tanpa absen pulang',TANPA_MASUK:'Tanpa absen masuk',CUTI:'Cuti',IZIN:'Izin',SAKIT:'Sakit',DINAS_LUAR:'Dinas luar',TIDAK_ADA_CATATAN:'Tidak ada catatan'};
const statusTone={HADIR:'positive',BELUM_PULANG:'warm',TANPA_PULANG:'negative',TANPA_MASUK:'negative',CUTI:'neutral',IZIN:'neutral',SAKIT:'neutral',DINAS_LUAR:'neutral',TIDAK_ADA_CATATAN:'neutral'};
const flagLabel={DI_LUAR_TITIK:'Di luar titik',GPS_KURANG_AKURAT:'GPS kurang akurat',LOKASI_MELOMPAT:'Lokasi melompat',HP_PRIBADI_RAMAI:'Banyak orang di 1 HP pribadi',TANPA_FOTO_ACUAN:'Belum ada foto acuan',TANPA_MASUK:'Tanpa absen masuk',TANPA_PULANG:'Tanpa absen pulang',SAAT_CUTI:'Absen saat cuti',TITIK_BELUM_ADA:'Titik belum diatur'};
const reasonLabel={DINAS_LUAR:'Dinas luar',TUGAS_LAPANGAN:'Tugas lapangan',LAINNYA:'Lainnya'};
const noteLabel={IZIN:'Izin',SAKIT:'Sakit',DINAS_LUAR:'Dinas luar'};
const deviceStatus={PENDING:'Menunggu',ACTIVE:'Aktif',REVOKED:'Nonaktif',REJECTED:'Ditolak'};
const kindLabel={IN:'Masuk',OUT:'Pulang'};
const leaveLabel={ANNUAL:'Cuti tahunan'};
const monthStart=()=>localToday().slice(0,8)+'01';
const shift=(day,days)=>new Date(Date.parse(day+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
const pill=(text,tone='neutral')=>`<span class="badge ${tone}"><span class="status-dot"></span>${esc(text)}</span>`;
const flags=list=>(list||[]).map(f=>pill(flagLabel[f]||f,'warm')).join(' ');
const time=t=>t?formatTime(t):'—';
const day=d=>formatDate(d,{weekday:'short',day:'numeric',month:'short',year:'numeric'});
const head=(title,note,actions='')=>`<div class="page-heading"><div><h1>${esc(title)}</h1><p>${esc(note)}</p></div><div class="actions">${actions}</div></div>`;
const btn=(label,action,ico='plus',kind='primary',extra='')=>`<button type="button" class="button ${kind}" data-att="${action}" ${extra}>${icon(ico)}<span>${esc(label)}</span></button>`;
const card=(title,sub,body,actions='')=>`<section class="card"><header class="card-header"><div><h2>${esc(title)}</h2>${sub?`<p>${esc(sub)}</p>`:''}</div>${actions?`<div class="actions">${actions}</div>`:''}</header>${body}</section>`;
const table=(heads,rows,empty='Belum ada data.')=>`<div class="table-wrap"><table><thead><tr>${heads.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td colspan="${heads.length}" class="muted">${esc(empty)}</td></tr>`}</tbody></table></div>`;
const stat=(label,value)=>`<section class="stat-card"><div class="stat-top"><span>${esc(label)}</span></div><div class="stat-value">${esc(String(value))}</div></section>`;
const person=e=>`<strong>${esc(e.name)}</strong><br><span class="muted text-small">${esc([e.position,e.unit].filter(Boolean).join(' · '))}</span>`;
const where=e=>!e?'—':e.point_name?`${esc(e.point_name)} · ${number(e.distance_m)} m${e.within_point?'':' (di luar)'}`:'Titik belum diatur';
const hours=m=>m?`${Math.floor(m/60)} j ${m%60} m`:'—';
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
const unitOptions=(selected,{blank='Semua unit'}={})=>`${blank?`<option value="">${esc(blank)}</option>`:''}${(A.overview?.units||[]).map(u=>`<option value="${esc(u.id)}" ${u.id===selected?'selected':''}>${esc(u.name)}</option>`).join('')}`;
function tabs(){
 const o=A.overview,list=[];
 const team=o.read_scope||o.subordinates>0||o.readable>1;
 if(team)list.push(['today','Hari ini'],['recap','Rekap']);
 if(o.manage||o.read_scope)list.push(['review','Perlu dicek']);
 if(o.devices)list.push(['devices','HP Absen']);
 if(o.settings||o.devices)list.push(['points','Titik Absen']);
 if(o.self)list.push(['mine','Absen saya']);
 return list;
}
function stopPolling(){if(A.poll){clearInterval(A.poll);A.poll=null;}}
// Peta Leaflet dilepas tanpa animasi yang masih berjalan (mencegah galat _leaflet_pos).
function dispose(map){if(!map)return;try{map.stop();map.remove();}catch{}}

/* ---------- Muat halaman ---------- */
export async function loadAttendancePage(){
 if(A.owner!==state.me){Object.assign(A,{owner:state.me,tab:null,unit:'',query:'',from:null,to:null,reviewFrom:null,reviewTo:null,sessionTokens:new Map()});}
 stopPolling();dispose(A.map);A.map=null;
 A.overview=await api('attendance/overview');
 const list=tabs(),requested=new URLSearchParams(location.hash.split('?')[1]||'').get('tab');
 if(requested&&list.some(([key])=>key===requested))A.tab=requested;
 if(!list.some(([key])=>key===A.tab))A.tab=list[0]?.[0]||null;
 A.from=A.from||monthStart();A.to=A.to||localToday();
 A.reviewFrom=A.reviewFrom||shift(localToday(),-13);A.reviewTo=A.reviewTo||localToday();
 return render(await loadTab());
}
async function loadTab(){
 const unit=A.unit?`&unit=${encodeURIComponent(A.unit)}`:'';
 if(A.tab==='today')A.today=await api(`attendance/today${A.unit?`?unit=${encodeURIComponent(A.unit)}`:''}`);
 if(A.tab==='recap')A.recap=await api(`attendance/recap?from=${A.from}&to=${A.to}${unit}`);
 if(A.tab==='review')A.review=await api(`attendance/review?from=${A.reviewFrom}&to=${A.reviewTo}&status=${A.reviewStatus}`);
 if(A.tab==='devices')A.devices=await api('attendance/devices');
 if(A.tab==='points')A.points=await api('attendance/points');
 if(A.tab==='mine')A.mine=await api(`attendance/recap/${encodeURIComponent(A.overview.employee_id)}?from=${A.from}&to=${A.to}`);
 return A.tab;
}
function render(){
 const list=tabs();
 if(!list.length)return `${head('Absensi','Absen harian pegawai dengan selfie dan lokasi.')}<div class="notice">${icon('people')}<div><strong>Belum ada data absensi untuk akun ini</strong><p>Akun ini belum terhubung dengan profil pegawai dan tidak memegang izin Absensi. Hubungi SDM bila perlu.</p></div></div>`;
 const body={today:todayTab,recap:recapTab,review:reviewTab,devices:devicesTab,points:pointsTab,mine:mineTab}[A.tab]();
 return `${head('Absensi','Absen harian lewat HP terdaftar: GPS + selfie. Status terlambat menyusul setelah jam kerja dan shift diimpor.',headerActions())}
 <div class="leave-tabs" role="tablist" aria-label="Bagian absensi">${list.map(([key,label])=>`<button role="tab" aria-selected="${A.tab===key}" class="chip ${A.tab===key?'active':''}" data-att="tab" data-tab="${key}">${esc(label)}</button>`).join('')}</div>
 <div id="attendance-content">${body}</div>
 <footer class="page-footer"><span>SPH Portal · Absensi</span><span>Waktu operasional WITA</span></footer>`;
}
function headerActions(){
 if(A.tab==='recap')return btn('Ekspor Excel','export','download','outlined');
 if(A.tab==='devices')return `${btn('Daftarkan HP pribadi','device-personal','plus','primary')}${btn('Daftarkan HP bersama','device-shared','plus','outlined')}${btn('Buka sesi pendaftaran','session-open','people','outlined')}`;
 if(A.tab==='points'&&A.points?.can_manage)return btn('Tambah titik','point-new','location','primary');
 return '';
}
async function rerender(){const main=document.querySelector('#main');if(!main)return;stopPolling();dispose(A.map);A.map=null;await loadTab();main.innerHTML=render();afterRender();}
function afterRender(){
 if(A.tab==='points')drawMap().catch(error=>{const box=document.querySelector('#attendance-map');if(box)box.innerHTML=`<p class="muted">Peta belum dapat dimuat: ${esc(error.message)}</p>`;});
 if(A.tab==='devices'&&A.devices?.sessions?.length)A.poll=setInterval(()=>{if(state.route!=='attendance'||A.tab!=='devices'){stopPolling();return;}if(!document.hidden)refreshSessions().catch(()=>{});},5000);
}

/* ---------- Hari ini ---------- */
function todayTab(){
 const rows=A.today.rows.filter(r=>!A.query||r.employee.name.toLowerCase().includes(A.query.toLowerCase()));
 const count=s=>A.today.rows.filter(r=>s.includes(r.status)).length;
 return `<div class="stats-grid">${stat('Hadir',count(['HADIR','BELUM_PULANG','TANPA_PULANG','TANPA_MASUK']))}${stat('Belum pulang',count(['BELUM_PULANG']))}${stat('Belum ada catatan',count(['TIDAK_ADA_CATATAN']))}${stat('Cuti / izin / sakit / dinas',count(['CUTI','IZIN','SAKIT','DINAS_LUAR']))}${stat('Ditandai',A.today.rows.filter(r=>r.flags.length).length)}</div>
 <div class="toolbar"><label class="field"><span>Unit</span><select data-att-field="unit">${unitOptions(A.unit)}</select></label><label class="field"><span>Cari nama</span><input type="search" data-att-field="query" value="${esc(A.query)}"></label>${btn('Terapkan','apply','filter','outlined')}</div>
 ${card(`Absen ${day(A.today.date)}`,'Status dihitung dari absen hari ini, koreksi, keterangan, dan cuti yang disetujui.',table(['Pegawai','Status','Masuk','Pulang','Titik terakhir','Tanda',''],rows.map(r=>`<tr><td>${person(r.employee)}</td><td>${pill(statusLabel[r.status],statusTone[r.status])}${r.note?`<br><span class="muted text-small">${esc(noteLabel[r.note.kind])}</span>`:''}</td><td>${time(r.in_at)}</td><td>${time(r.out_at)}</td><td>${where(r.last_event)}${r.last_event?`<br><span class="muted text-small">lewat ${esc(r.last_event.device.label)}${r.last_event.device.borrowed?' (menumpang)':''}</span>`:''}</td><td>${flags(r.flags)}</td><td><button type="button" class="button text" data-att="detail" data-id="${esc(r.employee.id)}">Rincian</button></td></tr>`),'Tidak ada pegawai pada saringan ini.'))}`;
}

/* ---------- Rekap ---------- */
function rangeBar(extra=''){return `<div class="toolbar"><label class="field"><span>Dari tanggal</span><input type="date" data-att-field="from" value="${esc(A.from)}" max="${localToday()}"></label><label class="field"><span>Sampai tanggal</span><input type="date" data-att-field="to" value="${esc(A.to)}" max="${localToday()}"></label>${extra}${btn('Terapkan','apply','filter','outlined')}</div>`;}
function recapTab(){
 const rows=A.recap.employees.map(r=>{const s=r.summary;return `<tr><td><button type="button" class="link-button" data-att="detail" data-id="${esc(r.employee.id)}">${person(r.employee)}</button></td><td>${number(s.hadir)}</td><td>${number(s.tanpa_pulang)}</td><td>${number(s.tanpa_masuk)}</td><td>${number(s.cuti)}</td><td>${number(s.izin)}</td><td>${number(s.sakit)}</td><td>${number(s.dinas_luar)}</td><td>${number(s.tanpa_catatan)}</td><td>${number(s.ditandai)}</td><td>${hours(s.menit)}</td></tr>`;});
 return `${rangeBar(`<label class="field"><span>Unit</span><select data-att-field="unit">${unitOptions(A.unit)}</select></label>`)}
 <div class="notice">${icon('help')}<div><strong>Belum ada jadwal kerja</strong><p>"Tidak ada catatan" belum berarti alpa: sistem belum tahu hari kerja tiap pegawai. Status terlambat dan tidak hadir menyusul setelah jam kerja unit dan shift diimpor.</p></div></div>
 ${card(`Rekap ${formatDate(A.recap.from)} – ${formatDate(A.recap.to)}`,'Klik nama untuk melihat rincian harian, selfie, keterangan, dan koreksi.',table(['Pegawai','Hadir','Tanpa pulang','Tanpa masuk','Cuti','Izin','Sakit','Dinas luar','Tidak ada catatan','Ditandai','Jam kerja'],rows,'Belum ada pegawai dalam cakupan ini.'))}`;
}
async function exportRecap(){
 const unit=A.unit?`&unit=${encodeURIComponent(A.unit)}`:'';
 const data=await api(`attendance/recap?from=${A.from}&to=${A.to}&detail=1${unit}`);
 const summary=data.employees.map(r=>({nama:r.employee.name,nomor:r.employee.employee_no,jabatan:r.employee.position,unit:r.employee.unit,...r.summary,jam:Math.round(r.summary.menit/6)/10}));
 const detail=[];
 for(const r of data.employees)for(const d of r.days)detail.push({tanggal:d.date,nama:r.employee.name,nomor:r.employee.employee_no,unit:r.employee.unit,status:statusLabel[d.status],masuk:d.in_at,pulang:d.out_at,menit:d.minutes,tanda:d.flags.map(f=>flagLabel[f]||f).join(', '),keterangan:d.note?`${noteLabel[d.note.kind]}${d.note.note?': '+d.note.note:''}`:'',koreksi:d.corrected?'Ya':''});
 await post('attendance/exports',{kind:'detail',from:data.from,to:data.to,rows:detail.length});
 const col=(header,key,kind='text',width)=>({header,key,kind,width});
 download(createXlsx([
  {name:'Ringkasan',columns:[col('Nama','nama','text',30),col('Nomor pegawai','nomor'),col('Jabatan','jabatan','text',28),col('Unit','unit','text',24),col('Hadir','hadir','number'),col('Tanpa pulang','tanpa_pulang','number'),col('Tanpa masuk','tanpa_masuk','number'),col('Cuti','cuti','number'),col('Izin','izin','number'),col('Sakit','sakit','number'),col('Dinas luar','dinas_luar','number'),col('Tidak ada catatan','tanpa_catatan','number'),col('Hari ditandai','ditandai','number'),col('Jam kerja','jam','number')],rows:summary},
  {name:'Rincian harian',columns:[col('Tanggal','tanggal','date'),col('Nama','nama','text',30),col('Nomor pegawai','nomor'),col('Unit','unit','text',24),col('Status','status','text',22),col('Masuk','masuk','datetime'),col('Pulang','pulang','datetime'),col('Menit kerja','menit','number'),col('Tanda','tanda','notes',30),col('Keterangan','keterangan','notes',30),col('Dikoreksi','koreksi')],rows:detail}
 ]),`absensi-${data.from}-sd-${data.to}.xlsx`);
}

/* ---------- Rincian pegawai ---------- */
function daysTable(d){
 const byDay=new Map(d.days.map(x=>[x.date,x])),rows=[];
 for(let x=d.to;x>=d.from;x=shift(x,-1)){
  const v=byDay.get(x);
  rows.push(`<tr><td>${day(x)}</td><td>${v?pill(statusLabel[v.status],statusTone[v.status]):pill('Tidak ada catatan')}${v?.leave_type?`<br><span class="muted text-small">${esc(leaveLabel[v.leave_type]||'Cuti khusus')}</span>`:''}${v?.corrected?'<br><span class="muted text-small">Dikoreksi</span>':''}</td><td>${time(v?.in_at)}</td><td>${time(v?.out_at)}</td><td>${hours(v?.minutes)}</td><td>${flags(v?.flags)}</td><td>${v?.note?`${esc(noteLabel[v.note.kind])}${v.note.note?`: ${esc(v.note.note)}`:''}`:''}</td></tr>`);
 }
 return table(['Tanggal','Status','Masuk','Pulang','Durasi','Tanda','Keterangan'],rows);
}
function eventsTable(d,manage){
 const voided=new Set(d.corrections.filter(c=>c.void_event_id).map(c=>c.void_event_id));
 return table(['Waktu','Absen','Titik','Tanda','HP','Selfie',''],[...d.events].reverse().map(e=>`<tr class="${voided.has(e.id)?'muted':''}"><td>${day(e.work_date)}<br><span class="muted text-small">${formatDate(e.recorded_at)} ${time(e.recorded_at)}</span></td><td>${esc(kindLabel[e.kind])}${voided.has(e.id)?'<br><span class="text-small">Disisihkan</span>':''}</td><td>${where(e)}${e.outside_reason?`<br><span class="muted text-small">${esc(reasonLabel[e.outside_reason])}${e.outside_note?`: ${esc(e.outside_note)}`:''}</span>`:''}<br><span class="muted text-small">akurasi ±${number(e.accuracy_m)} m</span></td><td>${flags(e.flags)}</td><td>${esc(e.device.label)}${e.device.borrowed?'<br><span class="muted text-small">menumpang</span>':''}</td><td>${e.has_photo?`<button type="button" class="button text" data-att="photo" data-id="${esc(e.id)}">Lihat</button>`:'<span class="muted text-small">Dihapus (90 hari)</span>'}</td><td>${manage&&!voided.has(e.id)&&(!d.correction_from||e.work_date>=d.correction_from)?`<button type="button" class="button text" data-att="void" data-id="${esc(e.id)}" data-date="${esc(e.work_date)}">Sisihkan</button>`:''}</td></tr>`),'Belum ada absen pada rentang ini.');
}
function adjustmentsList(d,manage){
 const corr=d.corrections.map(c=>`<tr><td>${day(c.work_date)}</td><td>${c.in_at?`Masuk ${time(c.in_at)}`:''}${c.in_at&&c.out_at?'<br>':''}${c.out_at?`Pulang ${time(c.out_at)}`:''}${c.void_event_id?'Absen disisihkan':''}</td><td>${esc(c.reason)}</td><td>${esc(c.created_by)}<br><span class="muted text-small">${formatDate(c.created_at)} ${time(c.created_at)}</span></td><td>${manage&&(!d.correction_from||c.work_date>=d.correction_from)?`<button type="button" class="button text" data-att="correction-revoke" data-id="${esc(c.id)}" data-version="${c.row_version}">Cabut</button>`:''}</td></tr>`);
 const notes=d.notes.map(n=>`<tr><td>${day(n.work_date)}</td><td>${esc(noteLabel[n.kind])}</td><td>${esc(n.note||'—')}</td><td>${esc(n.created_by)}</td><td>${manage?`<button type="button" class="button text" data-att="note-revoke" data-id="${esc(n.id)}" data-version="${n.row_version}">Cabut</button>`:''}</td></tr>`);
 return `${table(['Tanggal','Koreksi','Alasan','Oleh',''],corr,'Belum ada koreksi.')}${table(['Tanggal','Keterangan','Catatan','Oleh',''],notes,'Belum ada keterangan.')}`;
}
function detailBody(d){
 const manage=d.can_manage;
 return `<div class="actions">${manage?`${btn('Tambah keterangan','note','plus','outlined')}${btn('Koreksi jam','correct','edit','outlined')}`:''}${d.reference?btn('Foto acuan','reference','eye','text'):''}</div>
 ${manage&&d.correction_from?`<p class="muted text-small">Sebagai atasan langsung, Anda dapat mengoreksi sejak ${formatDate(d.correction_from)}. Koreksi lebih lama dilakukan Pengelola Absensi.</p>`:''}
 <h3>Harian</h3>${daysTable(d)}<h3>Catatan absen</h3>${eventsTable(d,manage)}<h3>Koreksi dan keterangan</h3>${adjustmentsList(d,manage)}`;
}
async function openDetail(employeeId,from=A.from,to=A.to){
 const d=await api(`attendance/recap/${encodeURIComponent(employeeId)}?from=${from}&to=${to}`);
 const el=dialog(d.employee.name,`<div data-detail>${detailBody(d)}</div>`,{wide:true,subtitle:`${[d.employee.position,d.employee.unit].filter(Boolean).join(' · ')} · ${formatDate(d.from)} – ${formatDate(d.to)}`});
 const reload=async()=>{const next=await api(`attendance/recap/${encodeURIComponent(employeeId)}?from=${from}&to=${to}`);el.querySelector('[data-detail]').innerHTML=detailBody(next);Object.assign(d,next);};
 bindDetail(el,d,reload);
}
function bindDetail(root,d,reload){
 root.addEventListener('click',async event=>{
  const el=event.target.closest('[data-att]');if(!el||!root.contains(el))return;
  event.stopPropagation();
  const action=el.dataset.att;
  try{
   if(action==='photo'){const e=d.events.find(x=>x.id===el.dataset.id);await showPhoto(e,{employee:d.employee,canSet:d.can_manage&&d.reference?.event_id!==e.id,onChange:reload});return;}
   if(action==='reference'){await showPhoto({id:d.reference.event_id,employee_id:d.employee.id},{employee:d.employee,title:'Foto acuan'});return;}
   if(action==='note')return noteForm(d,reload);
   if(action==='correct')return correctionForm(d,reload);
   if(action==='void')return voidForm(d,el.dataset.id,el.dataset.date,reload);
   if(action==='correction-revoke'||action==='note-revoke'){
    const kind=action==='note-revoke'?'notes':'corrections';
    if(!confirm('Cabut catatan ini? Catatan tetap tersimpan di riwayat audit.'))return;
    await post(`attendance/${kind}/${el.dataset.id}/revoke`,{row_version:Number(el.dataset.version)});toast('Sudah dicabut.');await reload();return;
   }
  }catch(error){toast(error.message,true);}
 });
}
function noteForm(d,reload){
 formDialog('Tambah keterangan',`<label class="field"><span>Tanggal</span><input type="date" name="work_date" value="${localToday()}" required></label><label class="field"><span>Keterangan</span><select name="kind" required><option value="IZIN">Izin</option><option value="SAKIT">Sakit</option><option value="DINAS_LUAR">Dinas luar</option></select></label><label class="field full"><span>Catatan (opsional)</span><textarea name="note" maxlength="500"></textarea></label>`,
  async b=>{await post('attendance/notes',{employee_id:d.employee.id,...b});toast('Keterangan tersimpan.');await reload();},{note:'Lampiran (misalnya surat dokter) menyusul di tahap berikutnya.'});
}
function correctionForm(d,reload){
 formDialog('Koreksi jam',`<label class="field"><span>Tanggal kerja</span><input type="date" name="work_date" value="${localToday()}" min="${d.correction_from||''}" max="${localToday()}" required></label><label class="field"><span>Jam masuk (WITA)</span><input type="time" name="in_time"></label><label class="field"><span>Jam pulang (WITA)</span><input type="time" name="out_time"></label><label class="check-field"><input type="checkbox" name="next_day"><span>Pulang keesokan harinya (shift malam)</span></label><label class="field full"><span>Alasan koreksi</span><textarea name="reason" minlength="3" maxlength="500" required></textarea></label>`,
  async b=>{
   const toIso=(date,clock)=>new Date(`${date}T${clock}:00+08:00`).toISOString();
   if(!b.in_time&&!b.out_time)throw new Error('Isi jam masuk atau jam pulang.');
   await post('attendance/corrections',{employee_id:d.employee.id,work_date:b.work_date,reason:b.reason,in_at:b.in_time?toIso(b.work_date,b.in_time):null,out_at:b.out_time?toIso(b.next_day?shift(b.work_date,1):b.work_date,b.out_time):null});
   toast('Koreksi tersimpan. Catatan asli tetap ada.');await reload();
  },{note:'Koreksi tidak mengubah atau menghapus catatan absen asli.'});
}
function voidForm(d,eventId,workDate,reload){
 formDialog('Sisihkan absen',`<p class="detail-prose full">Pakai ini bila absen tercatat atas nama yang salah (salah pilih nama). Catatan asli tetap tersimpan dan tidak dihitung di rekap.</p><label class="field full"><span>Alasan</span><textarea name="reason" minlength="3" maxlength="500" required></textarea></label>`,
  async b=>{await post('attendance/corrections',{employee_id:d.employee.id,work_date:workDate,void_event_id:eventId,reason:b.reason});toast('Absen disisihkan.');await reload();});
}

/* ---------- Selfie dan foto acuan ---------- */
async function photoUrl(path){
 const data=await api(path);
 const bytes=Uint8Array.from(atob(data.data),c=>c.charCodeAt(0));
 return URL.createObjectURL(new Blob([bytes],{type:data.mime_type}));
}
// Selfie absen berdampingan dengan foto acuan. `review` menampilkan tombol penilaian;
// `canSet` menampilkan tombol untuk menjadikan selfie ini foto acuan.
async function showPhoto(event,{employee,title='Selfie absen',review=null,canSet=false,onChange=null}={}){
 const urls=[],reference=title==='Foto acuan';
 const el=dialog(title,`<div class="attendance-photos"><figure><figcaption>${reference?'Foto acuan':'Selfie absen'}</figcaption><div data-photo="event" class="attendance-photo"><span class="muted">Memuat…</span></div></figure>${reference?'':`<figure><figcaption>Foto acuan</figcaption><div data-photo="reference" class="attendance-photo"><span class="muted">Memuat…</span></div></figure>`}</div><div data-review></div>`,{wide:!reference,subtitle:employee?[employee.name,employee.unit].filter(Boolean).join(' · '):''});
 el.addEventListener('close',()=>urls.forEach(u=>URL.revokeObjectURL(u)));
 const put=(slot,html)=>{const box=el.querySelector(`[data-photo=${slot}]`);if(box)box.innerHTML=html;};
 const load=async(slot,path,alt)=>{try{const url=await photoUrl(path);urls.push(url);if(!el.open)return;put(slot,`<img src="${url}" alt="${esc(alt)}">`);}catch(error){put(slot,`<span class="muted">${esc(slot==='reference'&&error.status===404?'Belum ada foto acuan. Pilih selfie yang jelas sebagai acuan.':error.message)}</span>`);}};
 const box=el.querySelector('[data-review]'),item=review||event;
 const meta=!item.recorded_at?'':!item.device?`<p>Selfie ${formatDate(item.recorded_at)} ${time(item.recorded_at)}</p>`:`<p>${esc(kindLabel[item.kind]||'')} ${formatDate(item.recorded_at)} ${time(item.recorded_at)} · ${where(item)}${Number.isFinite(item.latitude)?` · <a href="https://www.google.com/maps?q=${item.latitude},${item.longitude}" target="_blank" rel="noopener">lokasi di peta</a>`:''}</p>${item.flags?.length?`<p>${flags(item.flags)}</p>`:''}${item.outside_reason?`<p class="muted">${esc(reasonLabel[item.outside_reason])}${item.outside_note?`: ${esc(item.outside_note)}`:''}</p>`:''}<p class="muted text-small">Lewat ${esc(item.device.label)}${item.device.borrowed?' (menumpang)':''} · akurasi GPS ±${number(item.accuracy_m)} m</p>`;
 const actions=[];
 if(review?.can_review)actions.push(btn('Sesuai','review-ok','check','primary'),btn('Perlu klarifikasi','review-ask','help','outlined'));
 if(canSet||(review?.can_review&&!review.has_reference))actions.push(btn('Jadikan foto acuan','reference-set','eye',review?'text':'outlined'));
 box.innerHTML=`<div class="detail-section">${meta}
  ${review?.review?`<p class="muted text-small">Penilaian terakhir: ${esc(review.review.decision==='SESUAI'?'Sesuai':'Perlu klarifikasi')}${review.review.reviewer?` oleh ${esc(review.review.reviewer)}`:''}${review.review.note?` · ${esc(review.review.note)}`:''}</p>`:''}
  ${review?.can_review?`<label class="field full"><span>Catatan (wajib untuk Perlu klarifikasi)</span><textarea data-review-note maxlength="500">${esc(review.review?.note||'')}</textarea></label>`:review?'<p class="muted">Hanya atasan langsung atau Pengelola Absensi yang dapat menilai.</p>':''}
  ${actions.length?`<div class="actions">${actions.join('')}</div>`:''}</div>`;
 box.addEventListener('click',async e=>{
  const button=e.target.closest('[data-att]');if(!button)return;e.stopPropagation();button.disabled=true;
  try{
   if(button.dataset.att==='reference-set'){
    await post('attendance/references',{employee_id:event.employee_id,event_id:event.id});toast('Foto acuan tersimpan.');el.close();
    if(onChange)await onChange();else await rerender();return;
   }
   const decision=button.dataset.att==='review-ok'?'SESUAI':'KLARIFIKASI';
   await post('attendance/reviews',{event_id:event.id,decision,note:box.querySelector('[data-review-note]')?.value||''});
   toast(decision==='SESUAI'?'Ditandai sesuai.':'Ditandai perlu klarifikasi.');el.close();await rerender();
  }catch(error){toast(error.message,true);button.disabled=false;}
 });
 await Promise.all([reference?load('event',`attendance/references/${encodeURIComponent(event.employee_id)}`,'Foto acuan'):load('event',`attendance/photos/${encodeURIComponent(event.id)}`,'Selfie absen'),reference?null:load('reference',`attendance/references/${encodeURIComponent(event.employee_id)}`,'Foto acuan')]);
}

/* ---------- Perlu dicek ---------- */
function reviewTab(){
 const r=A.review;
 const items=r.items.map(i=>`<tr><td>${person(i.employee)}</td><td>${esc(kindLabel[i.kind])}<br><span class="muted text-small">${formatDate(i.recorded_at)} ${time(i.recorded_at)}</span></td><td>${flags(i.flags)}</td><td>${where(i)}${i.outside_reason?`<br><span class="muted text-small">${esc(reasonLabel[i.outside_reason])}${i.outside_note?`: ${esc(i.outside_note)}`:''}</span>`:''}</td><td>${esc(i.device.label)}${i.device.borrowed?'<br><span class="muted text-small">menumpang</span>':''}</td><td>${i.review?pill(i.review.decision==='SESUAI'?'Sesuai':'Perlu klarifikasi',i.review.decision==='SESUAI'?'positive':'warm'):pill('Belum dicek')}</td><td>${i.has_photo?`<button type="button" class="button text" data-att="review" data-id="${esc(i.id)}">Periksa</button>`:'<span class="muted text-small">Selfie dihapus</span>'}</td></tr>`);
 const missing=r.missing_reference.map(m=>`<tr><td>${person(m.employee)}</td><td>${formatDate(m.recorded_at)} ${time(m.recorded_at)}</td><td>${m.can_set?`<button type="button" class="button text" data-att="reference-pick" data-id="${esc(m.event_id)}" data-employee="${esc(m.employee.id)}">Lihat selfie & jadikan acuan</button>`:''}</td></tr>`);
 return `<div class="toolbar"><label class="field"><span>Dari tanggal</span><input type="date" data-att-field="reviewFrom" value="${esc(A.reviewFrom)}" max="${localToday()}"></label><label class="field"><span>Sampai tanggal</span><input type="date" data-att-field="reviewTo" value="${esc(A.reviewTo)}" max="${localToday()}"></label><label class="field"><span>Tampilkan</span><select data-att-field="reviewStatus"><option value="open" ${A.reviewStatus==='open'?'selected':''}>Belum dicek</option><option value="all" ${A.reviewStatus==='all'?'selected':''}>Semua bertanda</option></select></label>${btn('Terapkan','apply','filter','outlined')}</div>
 ${card('Absen bertanda','Absen bertanda tetap sah sampai atasan atau Pengelola Absensi menilai sebaliknya. Bandingkan selfie dengan foto acuan.',table(['Pegawai','Absen','Tanda','Titik','HP','Hasil',''],items,'Tidak ada absen bertanda pada rentang ini.'))}
 ${missing.length?card('Belum punya foto acuan','Pilih selfie yang jelas dan memang orangnya sebagai foto acuan.',table(['Pegawai','Selfie terakhir',''],missing)):''}`;
}

/* ---------- HP Absen ---------- */
const registrationUrl=token=>`${location.origin}/absen/#daftar=${token}`;
const sessionUrl=token=>`${location.origin}/absen/#sesi=${token}`;
const waNumber=phone=>{let d=String(phone||'').replace(/\D/g,'');if(d.startsWith('0'))d='62'+d.slice(1);return /^62\d{8,13}$/.test(d)?d:'';};
function shareDialog(title,link,{phone='',text,note}){
 const qr=encodeQR(link,'svg',{ecc:'medium'}),wa=`https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(`${text}\n${link}`)}`;
 const el=dialog(title,`<div class="detail-section"><p class="detail-prose">${esc(note)}</p>
  <div class="actions"><a class="button primary" href="${esc(wa)}" target="_blank" rel="noopener">${icon('arrow')}<span>Kirim lewat WhatsApp</span></a><button type="button" class="button outlined" data-copy>${icon('document')}<span>Salin tautan</span></button></div>
  <details><summary>Tampilkan QR (cara lain membuka tautan yang sama)</summary><div class="attendance-qr">${qr}</div><p class="muted text-small">QR hanya untuk membuka tautan pendaftaran di HP tersebut. Absen harian tidak memakai QR.</p></details>
  <label class="field full"><span>Tautan</span><input readonly value="${esc(link)}" data-link></label></div>`);
 el.querySelector('[data-copy]').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(link);toast('Tautan disalin.');}catch{el.querySelector('[data-link]').select();toast('Salin tautan dari kotak di bawah.');}});
}
function sessionCard(s){
 const token=A.sessionTokens.get(s.id),left=Math.max(0,Math.round((Date.parse(s.expires_at)-Date.now())/60000));
 const rows=s.devices.map(d=>`<tr><td>${d.owner?person(d.owner):'—'}${d.duplicate_name?`<br>${pill('Nama sama dipilih HP lain','warm')}`:''}</td><td>${pill(deviceStatus[d.status]||d.status,d.status==='ACTIVE'?'positive':d.status==='PENDING'?'warm':'negative')}</td><td>${d.status==='PENDING'?`<button type="button" class="button text" data-att="approve" data-id="${esc(d.id)}" data-version="${d.row_version}">Setujui</button><button type="button" class="button text" data-att="reject" data-id="${esc(d.id)}" data-version="${d.row_version}">Tolak</button>`:''}</td></tr>`);
 return card(`Sesi pendaftaran · ${s.unit.name}`,`Berakhir dalam ±${left} menit. Setujui hanya HP milik orang yang namanya benar.`,table(['Nama yang dipilih','Status',''],rows,'Belum ada HP yang masuk.'),
  `${token?btn('Bagikan tautan sesi','session-share','arrow','outlined',`data-id="${esc(s.id)}"`):''}${btn('Tutup sesi','session-close','close','text',`data-id="${esc(s.id)}" data-version="${s.row_version}"`)}`);
}
function devicesTab(){
 const d=A.devices;
 const rows=d.devices.map(x=>`<tr><td>${esc(x.label)}${x.owner?`<br><span class="muted text-small">${esc([x.owner.position,x.owner.unit].filter(Boolean).join(' · '))}</span>`:x.unit?`<br><span class="muted text-small">${esc(x.unit.name)}</span>`:''}</td><td>${x.kind==='SHARED'?'HP bersama':'HP pribadi'}</td><td>${pill(x.status==='ACTIVE'&&!x.owner_active?'Nonaktif (pemilik nonaktif)':x.status==='PENDING'&&!x.registered?'Menunggu dibuka':deviceStatus[x.status],x.status==='ACTIVE'&&x.owner_active?'positive':x.status==='PENDING'?'warm':'negative')}${x.status==='PENDING'&&x.expires_at?`<br><span class="muted text-small">Tautan berlaku sampai ${formatDate(x.expires_at)}</span>`:''}${x.revoke_reason?`<br><span class="muted text-small">${esc(x.revoke_reason)}</span>`:''}</td><td>${x.last_seen_at?`${formatDate(x.last_seen_at)} ${time(x.last_seen_at)}`:'—'}</td><td>${number(x.events_7d)} absen · ${number(x.people_7d)} orang</td><td>${x.status==='PENDING'&&!x.registered?`<button type="button" class="button text" data-att="device-link" data-id="${esc(x.id)}" data-version="${x.row_version}">Tautan baru</button>`:''}${['PENDING','ACTIVE'].includes(x.status)?`<button type="button" class="button text" data-att="device-revoke" data-id="${esc(x.id)}" data-version="${x.row_version}">Nonaktifkan</button>`:''}</td></tr>`);
 return `<div data-sessions>${d.sessions.map(sessionCard).join('')}</div>
 ${card('HP terdaftar','Satu HP terdaftar bisa dipakai banyak pegawai. Pegawai tanpa HP tidak perlu didaftarkan.',table(['HP','Jenis','Status','Terakhir dipakai','7 hari terakhir',''],rows,'Belum ada HP terdaftar.'))}`;
}
async function refreshSessions(){
 for(const s of A.devices.sessions){const next=(await api(`attendance/sessions/${s.id}`,{background:true})).session;Object.assign(s,next);}
 A.devices.sessions=A.devices.sessions.filter(s=>s.open);
 const box=document.querySelector('#attendance-content [data-sessions]');if(box&&A.tab==='devices')box.innerHTML=A.devices.sessions.map(sessionCard).join('');
 if(!A.devices.sessions.length)stopPolling();
}
async function devicePersonal(){
 const people=(await api('attendance/people')).people;
 const el=formDialog('Daftarkan HP pribadi',employeePickerField({label:'Pemilik HP',name:'owner_employee_id',placeholder:'Ketik nama atau nomor pegawai…'}),
  async b=>{
   const owner=people.find(p=>p.id===b.owner_employee_id);if(!owner)throw new Error('Pilih pemilik HP dari hasil pencarian.');
   const result=await post('attendance/devices',{kind:'PERSONAL',owner_employee_id:owner.id});
   await rerender();
   shareDialog('Tautan pendaftaran HP pribadi',registrationUrl(result.token),{phone:result.phone,text:`Tautan pendaftaran HP absen untuk ${owner.name}. Buka di HP Anda (sekali pakai):`,note:`Kirim tautan ini ke WhatsApp ${owner.name}${result.phone?'':' (nomor HP belum tercatat di data pegawai, jadi pilih kontaknya di WhatsApp)'}. Tautan hanya bisa dipakai di satu HP dan berlaku sampai ${formatDate(result.expires_at)}.`});
  },{note:'Nama pemilik langsung muncul setiap kali aplikasi absen dibuka di HP itu. HP pribadi tetap bisa dipakai teman yang menumpang absen.'});
 setupEmployeePicker(el,people.map(p=>({id:p.id,full_name:p.name,employee_no:p.employee_no,position_name:[p.position,p.unit].filter(Boolean).join(' · ')})));
}
function deviceShared(){
 formDialog('Daftarkan HP bersama',`<label class="field"><span>Unit</span><select name="org_unit_id" required>${unitOptions('',{blank:'Pilih unit…'})}</select></label><label class="field"><span>Label HP</span><input name="label" required minlength="3" maxlength="80" placeholder="HP Koordinator Pos 3"></label>`,
  async b=>{
   const result=await post('attendance/devices',{kind:'SHARED',...b});
   await rerender();
   shareDialog('Tautan pendaftaran HP bersama',registrationUrl(result.token),{text:`Tautan pendaftaran ${b.label} untuk absen. Buka di HP tersebut (sekali pakai):`,note:`Kirim ke WhatsApp koordinator, lalu buka tautan itu di ${b.label}. Saat absen, HP ini menampilkan daftar nama unitnya.`});
  },{note:'HP koordinator atau HP pos. Pegawai memilih namanya sendiri lalu selfie.'});
}
function sessionOpen(){
 formDialog('Buka sesi pendaftaran',`<label class="field"><span>Unit</span><select name="org_unit_id" required>${unitOptions('',{blank:'Pilih unit…'})}</select></label><label class="field"><span>Lama sesi (menit)</span><input type="number" name="minutes" min="5" max="30" value="30" required></label>`,
  async b=>{
   const result=await post('attendance/sessions',{org_unit_id:b.org_unit_id,minutes:Number(b.minutes)});
   A.sessionTokens.set(result.session.id,result.token);await rerender();
   shareDialog('Tautan sesi pendaftaran',sessionUrl(result.token),{text:`Sesi pendaftaran HP absen ${result.session.unit.name}. Buka di HP Anda, pilih nama Anda, lalu tunggu disetujui:`,note:'Kirim ke grup WhatsApp unit. Setiap HP yang masuk muncul di halaman ini; centang yang benar dan tolak yang tidak dikenal.'});
  },{note:'Untuk mendaftarkan banyak HP pribadi sekaligus, misalnya sesudah briefing pagi.'});
}

/* ---------- Titik Absen ---------- */
function pointsTab(){
 const p=A.points;
 const rows=p.points.map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td>${x.latitude.toFixed(6)}, ${x.longitude.toFixed(6)}</td><td>${number(x.radius_m)} m</td><td>${pill(x.is_active?'Aktif':'Nonaktif',x.is_active?'positive':'negative')}</td><td><a class="button text" href="https://www.google.com/maps?q=${x.latitude},${x.longitude}" target="_blank" rel="noopener">Lihat di Google Maps</a>${p.can_manage?`<button type="button" class="button text" data-att="point-edit" data-id="${esc(x.id)}">Ubah</button>`:''}</td></tr>`);
 return `${p.points.some(x=>x.is_active)?'':`<div class="notice warning">${icon('location')}<div><strong>Belum ada titik absen aktif</strong><p>Absen tetap tercatat dan ditandai "Titik belum diatur" sampai titik ditambahkan.</p></div></div>`}
 ${card('Peta titik absen','Lingkaran menunjukkan radius toleransi tiap titik.',`<div id="attendance-map" class="attendance-map" aria-label="Peta titik absen"></div>`)}
 ${card('Daftar titik','Absen di luar semua radius tetap tercatat, wajib diberi alasan, dan masuk Perlu dicek.',table(['Nama','Koordinat','Radius','Status',''],rows,'Belum ada titik absen.'))}
 ${retentionCard()}`;
}
// Status penghapusan selfie lama (hanya untuk pemegang pengaturan absensi).
function retentionCard(){
 const r=A.overview?.retention;if(!r)return '';
 const last=r.last_run_at?`${formatDate(r.last_run_at)} ${formatTime(r.last_run_at)} WITA`:'belum pernah';
 const stale=!r.last_run_at||Date.now()-Date.parse(r.last_run_at)>2*86400000;
 const warn=r.last_error||(r.due_photos>0&&stale);
 return `<div class="notice ${warn?'warning':''}" data-retention>${icon('clock')}<div><strong>Penghapusan selfie lama (90 hari)</strong>
  <p>Terakhir berjalan: ${esc(last)} · ${number(r.deleted_photos)} selfie terhapus · ${number(r.due_photos)} menunggu dihapus.</p>
  ${r.last_error?`<p>Galat terakhir: ${esc(r.last_error)}</p>`:''}
  ${warn?'<p>Penghapusan berjalan otomatis saat halaman absen dibuka di HP terdaftar. Bila absen sedang tidak dipakai, pasang jadwal harian sesuai panduan di docs/ABSENSI.md.</p>':''}</div></div>`;
}
let leafletPromise;
function leaflet(){
 if(!leafletPromise){
  if(!document.querySelector('link[data-leaflet]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/assets/vendor/leaflet/leaflet.css';link.dataset.leaflet='1';document.head.append(link);}
  const path='/assets/vendor/leaflet/leaflet.js';
  leafletPromise=import(path).catch(error=>{leafletPromise=null;throw error;});
 }
 return leafletPromise;
}
function baseMap(L,element,center=[-8.3741,115.4512],zoom=16){
 const map=L.map(element,{scrollWheelZoom:false,zoomAnimation:false,fadeAnimation:false,markerZoomAnimation:false}).setView(center,zoom);
 map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
 L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).addTo(map);
 return map;
}
async function drawMap(){
 const box=document.querySelector('#attendance-map');if(!box)return;
 const L=await leaflet(),points=A.points.points;
 if(!document.body.contains(box))return;
 A.map=baseMap(L,box);
 const shapes=[];
 for(const p of points){
  const color=p.is_active?'#821b34':'#7d7579';
  shapes.push(L.circle([p.latitude,p.longitude],{radius:p.radius_m,color,weight:2,fillOpacity:.12}).addTo(A.map).bindTooltip(`${p.name} · ${p.radius_m} m`));
  L.circleMarker([p.latitude,p.longitude],{radius:5,color,fillColor:color,fillOpacity:1}).addTo(A.map);
 }
 if(shapes.length)A.map.fitBounds(L.featureGroup(shapes).getBounds(),{padding:[24,24],maxZoom:18,animate:false});
}
// Koordinat dari teks Google Maps: "-8.374, 115.452" atau tautan berisi @-8.374,115.452 / q=-8.374,115.452.
export function parseCoordinates(text){
 const s=String(text||'').trim(),match=s.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/)||s.match(/[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/)||s.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
 if(!match)return null;
 const lat=Number(match[1]),lon=Number(match[2]);
 return Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180?{latitude:lat,longitude:lon}:null;
}
async function pointForm(point){
 const el=formDialog(point?'Ubah titik absen':'Tambah titik absen',`
  <label class="field"><span>Nama titik</span><input name="name" required maxlength="80" value="${esc(point?.name||'')}" placeholder="Kantor Sekretariat"></label>
  <label class="field"><span>Radius (meter)</span><input type="number" name="radius_m" min="20" max="1000" value="${point?.radius_m||100}" required></label>
  <label class="field"><span>Lintang (latitude)</span><input name="latitude" required inputmode="decimal" value="${point?point.latitude:''}"></label>
  <label class="field"><span>Bujur (longitude)</span><input name="longitude" required inputmode="decimal" value="${point?point.longitude:''}"></label>
  <label class="field full"><span>Tempel koordinat atau tautan Google Maps (opsional)</span><input data-paste placeholder="-8.37412, 115.45123"></label>
  <div class="field full"><div class="actions"><button type="button" class="button outlined" data-here>${icon('location')}<span>Pakai lokasi saya</span></button></div><p class="muted text-small" data-here-status>Klik peta untuk memilih titik. Lingkaran menunjukkan radius.</p></div>
  <div class="full attendance-map small" data-map></div>
  ${point?`<label class="check-field"><input type="checkbox" name="is_active" ${point.is_active?'checked':''}><span>Titik aktif</span></label>`:''}`,
  async b=>{
   const body={name:b.name,latitude:Number(b.latitude),longitude:Number(b.longitude),radius_m:Number(b.radius_m),...(point?{is_active:b.is_active===true,row_version:point.row_version}:{})};
   if(point)await patch(`attendance/points/${point.id}`,body);else await post('attendance/points',body);
   toast('Titik absen tersimpan.');await rerender();
  },{wide:true,note:'Koordinat bisa diambil dengan menekan lama di Google Maps lalu menyalin angkanya.'});
 const form=el.querySelector('form'),lat=form.elements.latitude,lon=form.elements.longitude,radius=form.elements.radius_m;
 let L,map,circle,dot;
 const draw=()=>{
  if(!map)return;const la=Number(lat.value),lo=Number(lon.value),r=Number(radius.value)||100;
  if(!Number.isFinite(la)||!Number.isFinite(lo)||!lat.value||!lon.value)return;
  if(!circle){circle=L.circle([la,lo],{radius:r,color:'#821b34',weight:2,fillOpacity:.15}).addTo(map);dot=L.circleMarker([la,lo],{radius:5,color:'#821b34',fillColor:'#821b34',fillOpacity:1}).addTo(map);}
  else{circle.setLatLng([la,lo]).setRadius(r);dot.setLatLng([la,lo]);}
  map.panTo([la,lo],{animate:false});
 };
 form.querySelector('[data-paste]').addEventListener('input',event=>{const c=parseCoordinates(event.target.value);if(c){lat.value=c.latitude.toFixed(7);lon.value=c.longitude.toFixed(7);draw();}});
 for(const input of [lat,lon,radius])input.addEventListener('change',draw);
 form.querySelector('[data-here]').addEventListener('click',()=>{
  const status=form.querySelector('[data-here-status]');
  if(!navigator.geolocation){status.textContent='Peramban ini tidak mendukung lokasi. Isi koordinat manual.';return;}
  status.textContent='Mengambil lokasi…';
  navigator.geolocation.getCurrentPosition(p=>{lat.value=p.coords.latitude.toFixed(7);lon.value=p.coords.longitude.toFixed(7);status.textContent=`Lokasi diambil · akurasi ±${Math.round(p.coords.accuracy)} m`;draw();},
   ()=>{status.textContent='Lokasi belum didapat. Izinkan lokasi atau isi koordinat manual.';},{enableHighAccuracy:true,maximumAge:0,timeout:20000});
 });
 try{
  L=await leaflet();if(!el.open)return;
  const has=point||(lat.value&&lon.value);
  map=baseMap(L,form.querySelector('[data-map]'),has?[Number(lat.value),Number(lon.value)]:[-8.3741,115.4512],has?17:15);
  map.on('click',event=>{lat.value=event.latlng.lat.toFixed(7);lon.value=event.latlng.lng.toFixed(7);draw();});
  el.addEventListener('close',()=>{const m=map;map=null;dispose(m);},{once:true});
  setTimeout(()=>{if(map){map.invalidateSize();draw();}},150);
 }catch{form.querySelector('[data-map]').innerHTML='<p class="muted">Peta belum dapat dimuat. Isi koordinat secara manual.</p>';}
}

/* ---------- Absen saya ---------- */
function mineTab(){
 const d=A.mine;
 const s=d.summary;
 return `${rangeBar()}
 <div class="stats-grid">${stat('Hadir',s.hadir)}${stat('Tanpa absen pulang',s.tanpa_pulang)}${stat('Cuti / izin / sakit / dinas',s.cuti+s.izin+s.sakit+s.dinas_luar)}${stat('Jam kerja',hours(s.menit))}</div>
 ${card('Riwayat absen saya',`${formatDate(d.from)} – ${formatDate(d.to)}. Absen dilakukan lewat HP terdaftar di /absen/.`,daysTable(d))}`;
}

/* ---------- Ikatan peristiwa ---------- */
export function bindAttendancePage(){
 const root=document.querySelector('#main');if(!root||root.dataset.attendanceBound)return;root.dataset.attendanceBound='1';
 afterRender();
 root.addEventListener('change',event=>{const key=event.target.dataset?.attField;if(key)A[key]=event.target.value;});
 root.addEventListener('input',event=>{
  const key=event.target.dataset?.attField;if(!key)return;A[key]=event.target.value;
  if(key==='query'&&A.tab==='today'){const box=document.querySelector('#attendance-content');const focus=event.target.selectionStart;box.innerHTML=todayTab();const input=box.querySelector('[data-att-field=query]');input.focus();input.setSelectionRange(focus,focus);}
 });
 root.addEventListener('click',async event=>{
  const el=event.target.closest('[data-att]');if(!el||state.route!=='attendance'||el.closest('dialog'))return;
  const action=el.dataset.att;el.disabled=true;
  try{
   if(action==='tab'){A.tab=el.dataset.tab;history.replaceState(null,'',`#attendance?tab=${A.tab}`);await rerender();return;}
   if(action==='apply'){
    if(A.from>A.to||A.reviewFrom>A.reviewTo)throw new Error('Tanggal mulai harus sebelum tanggal akhir.');
    await rerender();return;
   }
   if(action==='detail'){await openDetail(el.dataset.id);return;}
   if(action==='export'){await exportRecap();return;}
   if(action==='review'){const item=A.review.items.find(i=>i.id===el.dataset.id);await showPhoto(item,{employee:item.employee,review:item});return;}
   if(action==='reference-pick'){const m=A.review.missing_reference.find(x=>x.event_id===el.dataset.id);await showPhoto({id:m.event_id,employee_id:m.employee.id,recorded_at:m.recorded_at,kind:m.kind},{employee:m.employee,canSet:m.can_set});return;}
   if(action==='device-personal'){await devicePersonal();return;}
   if(action==='device-shared'){deviceShared();return;}
   if(action==='session-open'){sessionOpen();return;}
   if(action==='session-share'){const s=A.devices.sessions.find(x=>x.id===el.dataset.id),token=A.sessionTokens.get(s.id);shareDialog('Tautan sesi pendaftaran',sessionUrl(token),{text:`Sesi pendaftaran HP absen ${s.unit.name}. Buka di HP Anda, pilih nama Anda, lalu tunggu disetujui:`,note:'Kirim ke grup WhatsApp unit.'});return;}
   if(action==='session-close'){if(!confirm('Tutup sesi? HP yang belum disetujui akan ditolak.'))return;await post(`attendance/sessions/${el.dataset.id}/close`,{row_version:Number(el.dataset.version)});A.sessionTokens.delete(el.dataset.id);toast('Sesi ditutup.');await rerender();return;}
   if(action==='approve'||action==='reject'){await post(`attendance/devices/${el.dataset.id}/${action}`,{row_version:Number(el.dataset.version)});toast(action==='approve'?'HP disetujui.':'HP ditolak.');await refreshSessions();return;}
   if(action==='device-link'){const result=await post(`attendance/devices/${el.dataset.id}/link`,{row_version:Number(el.dataset.version)});await rerender();shareDialog('Tautan pendaftaran baru',registrationUrl(result.token),{phone:result.phone,text:'Tautan pendaftaran HP absen (sekali pakai):',note:'Tautan lama tidak berlaku lagi.'});return;}
   if(action==='device-revoke'){
    formDialog('Nonaktifkan HP',`<label class="field full"><span>Alasan</span><textarea name="reason" required minlength="3" maxlength="300" placeholder="HP hilang / berganti tangan"></textarea></label>`,async b=>{await post(`attendance/devices/${el.dataset.id}/revoke`,{row_version:Number(el.dataset.version),reason:b.reason});toast('HP dinonaktifkan.');await rerender();},{note:'HP itu tidak bisa dipakai absen lagi. Catatan absen lama tetap ada.'});return;
   }
   if(action==='point-new'){await pointForm(null);return;}
   if(action==='point-edit'){await pointForm(A.points.points.find(p=>p.id===el.dataset.id));return;}
  }catch(error){toast(error.message,true);}
  finally{el.disabled=false;}
 });
}
export function resetAttendance(){stopPolling();dispose(A.map);A.map=null;A.owner=null;A.sessionTokens=new Map();probe=null;state.attendanceReady=undefined;}

// Pengaman rilis: menu Absensi hanya tampil bila server sudah memiliki rute absensi
// (migrasi + tambalan portal-api). Sebelum itu rute menjawab 404 dan menu disembunyikan.
// Hasilnya disimpan per sesi; memuat ulang halaman memeriksa lagi.
export const attendanceEligible=()=>Boolean(state.me?.user.employee_id||state.permissions.some(p=>p.startsWith('hr.attendance.')));
let probe=null;
export function probeAttendance(){
 if(state.attendanceReady!==undefined)return Promise.resolve(state.attendanceReady);
 if(!probe){
  const session=state.me;
  // Hanya 404 yang berarti server belum memasang Absensi. Galat sementara (jaringan, 5xx,
  // sesi sibuk) tidak disimpan, jadi pemeriksaan diulang saat pengguna berpindah halaman.
  probe=api('attendance/overview',{background:true}).then(()=>true,error=>error?.status===404?false:undefined)
   .then(ready=>{if(state.me===session)state.attendanceReady=ready;probe=null;return ready===true;});
 }
 return probe;
}
