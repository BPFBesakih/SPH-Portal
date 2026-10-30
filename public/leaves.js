import {state,api,post,refresh} from './api.js';
import {esc,icon,button,dialog,formDialog,field,options,formatDate,formatTime,localToday,toast,empty} from './ui.js';
import {createXlsx} from './xlsx-export.js';
let data=null,owner=null,tab='dashboard',filters={search:'',unit:'',eligible:true},year=Number(localToday().slice(0,4)),month=Number(localToday().slice(5,7));
const statusNames={PENDING:'Menunggu atasan',APPROVED:'Disetujui',REJECTED:'Ditolak',CANCELLED:'Dibatalkan',CANCELLATION_PENDING:'Menunggu pembatalan'};
const eventNames={OPENING:'Saldo awal',ANNUAL_GRANT:'Hak Januari',EXPIRY:'Kedaluwarsa',CONSUMPTION:'Pemakaian disetujui',REVERSAL:'Pengembalian pembatalan'};
const status=r=>`<span class="leave-status leave-status-${r.status.toLowerCase()}">${esc(statusNames[r.status]||r.status)}</span>`;
const number=n=>new Intl.NumberFormat('id-ID').format(n||0);
const table=(headers,rows,note='Belum ada catatan.')=>rows.length?`<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`:empty(note,'Data akan tampil setelah tersedia.','calendar');
const card=(title,body)=>`<section class="card leave-section"><header class="card-header"><h2>${esc(title)}</h2></header><div class="card-body">${body}</div></section>`;
export function resetLeaves(){data=null;owner=null;tab='dashboard';filters={search:'',unit:'',eligible:true};}
const filteredBalances=()=>data.balances.filter(r=>(!filters.eligible||r.eligible)&&(!filters.unit||r.unit_id===filters.unit)&&(!filters.search||`${r.name} ${r.employee_no}`.toLowerCase().includes(filters.search)));
const units=()=>[...new Map(data.balances.filter(r=>r.unit_id).map(r=>[r.unit_id,{id:r.unit_id,name:r.unit_name}])).values()];
const stat=(label,value,note)=>`<div class="stat-card"><div class="stat-top"><span>${esc(label)}</span>${icon('calendar')}</div><div class="stat-value">${number(value)}</div><p class="muted">${esc(note)}</p></div>`;
export async function loadLeavesPage(){
 if(owner!==state.me){resetLeaves();owner=state.me;}
 const current=state.me,result=await api(`leaves?year=${year}`);
 if(current!==state.me)throw new Error('Sesi berubah.');
 data=result;return renderLeavesPage();
}
function renderLeavesPage(){
 const pending=data.requests.filter(r=>r.can_decide&&['PENDING','CANCELLATION_PENDING'].includes(r.status)).length;
 const mine=data.balances.find(r=>r.employee_id===data.me?.id),manager=data.capabilities.can_manage_reports;
 const tabs=[['dashboard','Ringkasan'],['mine','Pengajuan saya'],['approvals',`Persetujuan saya${pending?' ('+pending+')':''}`],['requests','Pengajuan tim'],['balances','Saldo pegawai'],['calendar','Kalender']];
 const visibleTabs=tabs.filter(([key])=>!['requests','balances'].includes(key)||manager||data.balances.some(r=>r.employee_id!==data.me?.id));
 if(!visibleTabs.some(([key])=>key===tab))tab='dashboard';
 let notice='';
 if(data.me&&!data.me.eligible)notice=`<div class="notice">${icon('info')}<p>Status ${esc(data.me.employment_status)} tidak memperoleh cuti tahunan. Kalender tetap mengikuti cakupan akses.</p></div>`;
 else if(data.me&&!data.approver)notice=`<div class="notice warning">${icon('people')}<p>Atasan langsung belum ditetapkan secara tunggal. Hubungi SDM agar pengajuan dapat dikirim kepada atasan yang benar.</p></div>`;
 else if(!data.me&&!manager)notice=`<div class="notice">${icon('people')}<p>Akun ini belum terhubung dengan profil pegawai. Hubungi SDM untuk menggunakan pengajuan pribadi.</p></div>`;
 return `<div class="page-heading"><div><h1>Cuti</h1><p>Saldo, pengajuan, dan kalender tim. Persetujuan hanya oleh atasan langsung.</p></div><div class="actions">${data.capabilities.can_export?button('Ekspor laporan','leave-export','download','outlined'):''}${data.capabilities.can_request?button('Ajukan cuti','leave-new','plus'):''}</div></div>
 ${notice}<div class="leave-tabs" role="tablist" aria-label="Bagian modul cuti">${visibleTabs.map(([key,label])=>`<button role="tab" aria-selected="${tab===key}" class="chip ${tab===key?'active':''}" data-action="leave-tab" data-tab="${key}">${esc(label)}</button>`).join('')}</div>
 <div id="leave-content">${tab==='dashboard'?dashboard(mine,manager):tab==='balances'?balances():tab==='calendar'?calendar():requests(tab)}</div>
 <footer class="page-footer"><span>SPH Portal · Cuti tahunan</span><span>Waktu operasional WITA</span></footer>`;
}
function dashboard(mine,manager){
 const rows=manager?data.balances.filter(r=>r.eligible):mine?[mine]:[];
 const monthly=Array(12).fill(0);
 for(const r of data.requests.filter(r=>['APPROVED','CANCELLATION_PENDING'].includes(r.status)))for(const date of r.dates)if(date.startsWith(String(year)))monthly[Number(date.slice(5,7))-1]++;
 const max=Math.max(1,...monthly),months=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
 const unitRows=units().map(u=>{const list=rows.filter(r=>r.unit_id===u.id);return `<tr><td>${esc(u.name)}</td><td>${list.length}</td><td>${number(list.reduce((n,r)=>n+r.available_days,0))}</td><td>${number(list.reduce((n,r)=>n+r.reserved_days,0))}</td></tr>`;});
 return `<div class="stats-grid leave-stats">${stat(manager?'Pegawai berhak cuti':'Saldo tersedia',manager?rows.length:mine?.available_days,'THL tidak memperoleh alokasi cuti')}${stat(manager?'Saldo tersedia hari ini':'Menunggu keputusan',manager?rows.reduce((n,r)=>n+r.available_days,0):mine?.reserved_days,'Saldo ditahan selama pengajuan menunggu atasan')}${stat('Pemakaian tahun '+year,rows.reduce((n,r)=>n+r.used_days,0),'Hari yang sudah disetujui')}${stat('Perlu keputusan Anda',data.requests.filter(r=>r.can_decide&&['PENDING','CANCELLATION_PENDING'].includes(r.status)).length,'Hanya pengajuan bawahan langsung')}</div>
 <div class="leave-dashboard-grid">${card('Ketentuan saldo',`<div class="leave-rule"><b>12 hari</b><p>Tambahan setiap Januari. Tambahan berikutnya pada 1 Januari ${data.rules.next_credit_year}.</p></div><div class="leave-rule"><b>31 Maret</b><p>Batas penggunaan sisa tahun sebelumnya. Saldo dipisahkan menurut tahun asal.</p></div><div class="leave-rule"><b>Atasan langsung</b><p>Memverifikasi hari kerja dan memutuskan pengajuan. ${data.approver?'Atasan Anda: '+esc(data.approver.name)+'.':''}</p></div>`)}
 ${card('Pemakaian cuti disetujui · '+year,`<label class="field"><span>Tahun laporan</span><input id="leave-year" type="number" min="2026" max="2100" value="${year}"></label><div class="leave-chart" aria-label="Hari cuti disetujui per bulan">${monthly.map((n,i)=>`<div class="leave-chart-row"><span>${months[i]}</span><div><i style="width:${Math.round(n/max*100)}%"></i></div><b>${n}</b></div>`).join('')}</div>`)}</div>
 ${manager?card('Rekap unit · saldo tersedia hari ini',table(['Unit','Pegawai','Tersedia','Ditahan'],unitRows)):mine?card('Saldo Anda per tahun',bucketTable(mine)):''}
 <div class="notice">${icon('calendar')}<p>Pegawai memilih tanggal yang merupakan hari kerjanya. Atasan memverifikasi tanggal tersebut. Cuti bersamaan di satu unit diberi peringatan dan tetap dapat diajukan.</p></div>`;
}
const bucketTable=r=>table(['Tahun asal','Diberikan','Terpakai','Kedaluwarsa','Sisa buku','Ditahan','Berlaku sampai'],r.buckets.map(b=>`<tr><td>${b.balance_year}</td><td>${b.granted_days}</td><td>${b.consumed_days}</td><td>${b.expired_days}</td><td>${b.remaining_days}</td><td>${b.reserved_days}</td><td>${formatDate(new Date(Date.parse(b.expires_on)-86400000).toISOString())}</td></tr>`))+
 `<div class="actions">${button('Riwayat saldo','leave-history','audit','text',`data-employee="${esc(r.employee_id)}"`)}</div>`;
function balances(){
 return `<section class="card"><div class="toolbar"><label class="search-field">${icon('search')}<input id="leave-search" value="${esc(filters.search)}" placeholder="Cari nama atau nomor pegawai" aria-label="Cari saldo pegawai"></label><select id="leave-unit" aria-label="Unit">${options(units(),'id','name',filters.unit,'Semua unit')}</select><label class="check-field"><input id="leave-eligible" type="checkbox" ${filters.eligible?'checked':''}>Pegawai berhak cuti</label></div><div id="leave-balance-list">${balanceList()}</div></section>`;
}
function balanceList(){const list=filteredBalances();return table(['Pegawai','Unit','Status','Tersedia','Ditahan','Terpakai '+year,''],list.map(r=>`<tr><td><strong>${esc(r.name)}</strong><small class="muted leave-block">${esc(r.employee_no)}</small></td><td>${esc(r.unit_name||'Belum ditempatkan')}</td><td>${esc(r.is_active?r.employment_status:'Nonaktif')}</td><td><strong>${r.eligible?r.available_days:'Tidak berhak'}</strong></td><td>${r.reserved_days}</td><td>${r.used_days}</td><td>${button('Detail saldo','leave-balance','chevron','text',`data-employee="${esc(r.employee_id)}"`)}</td></tr>`),'Tidak ada pegawai dalam filter ini.')+`<div class="table-footer">${list.length} pegawai · ${number(list.reduce((n,r)=>n+r.available_days,0))} hari tersedia</div>`;}
function requests(kind){
 const list=data.requests.filter(r=>kind==='mine'?r.employee_id===data.me?.id:kind==='approvals'?r.can_decide&&['PENDING','CANCELLATION_PENDING'].includes(r.status):r.employee_id!==data.me?.id);
 return card(kind==='mine'?'Pengajuan Anda':kind==='approvals'?'Menunggu keputusan atasan langsung':'Pengajuan dalam cakupan Anda',table(['Pegawai','Tanggal hari kerja','Hari','Status','Atasan',''],list.map(r=>`<tr><td><strong>${esc(r.employee_name)}</strong><small class="muted leave-block">${esc(r.unit_name||'')}</small></td><td>${formatDate(r.first_date)} – ${formatDate(r.last_date)}</td><td>${r.day_count}</td><td>${status(r)}${r.supervisor_changed?'<small class="muted leave-block">Atasan berubah; hubungi SDM</small>':''}</td><td>${esc(r.approver_name)}</td><td>${button('Lihat','leave-detail','chevron','text',`data-id="${esc(r.id)}"`)}</td></tr>`),'Belum ada pengajuan pada bagian ini.'));
}
function calendar(){
 const prefix=`${year}-${String(month).padStart(2,'0')}`,events=data.calendar.filter(r=>r.date.startsWith(prefix));
 return `<section class="card"><div class="toolbar"><label class="field"><span>Bulan</span><input id="leave-month" type="month" min="2026-01" value="${prefix}"></label><p class="muted">Hanya cuti disetujui. Alasan pribadi tidak ditampilkan.</p></div>
 ${table(['Tanggal','Pegawai','Unit'],events.map(r=>`<tr><td>${formatDate(r.date)}</td><td>${esc(r.name)}</td><td>${esc(r.unit_name||'')}</td></tr>`),'Belum ada cuti disetujui pada bulan ini.')}<div class="card-body"><p class="muted">Pegawai melihat satu bagian; atasan melihat bawahannya; SDM/pimpinan mengikuti cakupan izin organisasi.</p></div></section>`;
}
function repaint(){document.querySelector('#main').innerHTML=renderLeavesPage();bindLeavesPage();}
export function bindLeavesPage(){
 if(state.route!=='leaves'||!data)return;
 document.querySelector('#leave-search')?.addEventListener('input',e=>{filters.search=e.target.value.toLowerCase();document.querySelector('#leave-balance-list').innerHTML=balanceList();});
 document.querySelector('#leave-unit')?.addEventListener('change',e=>{filters.unit=e.target.value;document.querySelector('#leave-balance-list').innerHTML=balanceList();});
 document.querySelector('#leave-eligible')?.addEventListener('change',e=>{filters.eligible=e.target.checked;document.querySelector('#leave-balance-list').innerHTML=balanceList();});
 document.querySelector('#leave-year')?.addEventListener('change',async e=>{const n=Number(e.target.value);if(n>=2026&&n<=2100){year=n;await reload();}});
 document.querySelector('#leave-month')?.addEventListener('change',async e=>{const [y,m]=e.target.value.split('-').map(Number);year=y;month=m;await reload();});
}
async function reload(){const result=await api(`leaves?year=${year}`);if(owner!==state.me)return;data=result;repaint();}
function newRequest(){
 if(!data.capabilities.can_request)return;
 const modal=dialog('Ajukan cuti tahunan',`<form id="leave-request-form"><div class="notice"><p>Pilih hanya tanggal yang merupakan hari kerja Anda. Persetujuan: <strong>${esc(data.approver.name)}</strong>.</p></div>
 <div class="form-grid">${field('Dari tanggal','from','date',data.today,`min="${data.today}"`)}${field('Sampai tanggal','to','date',data.today,`min="${data.today}"`)}</div>
 <button class="button outlined" type="button" id="leave-show-dates">Tampilkan tanggal</button><div id="leave-date-options" class="leave-date-options"></div>
 ${field('Alasan / keperluan','reason','textarea','','maxlength="2000"')}
 <p class="form-error" role="alert"></p><div id="leave-preview"></div><div class="form-actions"><button type="button" class="button outlined" data-close>Tutup</button><button class="button primary" id="leave-review" type="submit">Periksa pengajuan</button><button class="button primary" id="leave-send" type="button" hidden>Kirim ke atasan</button></div></form>`,{wide:true});
 const form=modal.querySelector('form'),preview=modal.querySelector('#leave-preview'),error=modal.querySelector('.form-error'),send=modal.querySelector('#leave-send'),review=modal.querySelector('#leave-review');
 const key=crypto.randomUUID();let planned=null;
 const reset=()=>{planned=null;preview.innerHTML='';send.hidden=true;review.hidden=false;};
 const showDates=()=>{
  reset();error.textContent='';
  const from=form.elements.from.value,to=form.elements.to.value;
  if(!from||!to||from>to||from<data.today){error.textContent='Pilih rentang tanggal yang valid mulai hari ini.';return;}
  const days=Math.floor((Date.parse(to)-Date.parse(from))/86400000)+1;
  if(days>366){error.textContent='Rentang maksimal 366 hari.';return;}
  const dates=Array.from({length:days},(_,i)=>new Date(Date.parse(from)+i*86400000).toISOString().slice(0,10));
  modal.querySelector('#leave-date-options').innerHTML=`<p class="muted">Centang hari kerja yang akan dipotong dari saldo. Sabtu/Minggu tidak diasumsikan libur.</p><div class="leave-day-grid">${dates.map(d=>`<label class="check-field"><input type="checkbox" name="work_date" value="${d}">${formatDate(d,{weekday:'short',day:'numeric',month:'short'})}</label>`).join('')}</div>`;
 };
 modal.querySelector('#leave-show-dates').addEventListener('click',showDates);
 form.addEventListener('input',reset);
 form.elements.from.addEventListener('change',()=>{modal.querySelector('#leave-date-options').innerHTML='';});
 form.elements.to.addEventListener('change',()=>{modal.querySelector('#leave-date-options').innerHTML='';});
 form.addEventListener('submit',async event=>{
  event.preventDefault();error.textContent='';review.disabled=true;
  try{
   const dates=[...form.querySelectorAll('[name=work_date]:checked')].map(e=>e.value);
   const result=await post('leaves/preview',{dates});
   planned={dates,reason:form.elements.reason.value.trim()};
   preview.innerHTML=`<section class="leave-review"><h3>${result.dates.length} hari kerja · ${esc(result.approver.name)}</h3><p>${result.dates.map(d=>esc(formatDate(d))).join(', ')}</p>${result.conflicts.length?`<div class="notice warning"><p><strong>Ada cuti bersamaan di unit Anda.</strong> ${result.conflicts.map(c=>esc(c.name)+' ('+esc(formatDate(c.date))+')').join(', ')}. Pengajuan tetap diperbolehkan.</p></div>`:''}<p class="muted">Saldo ditahan sampai atasan memutuskan. Pemotongan dilakukan satu kali saat disetujui.</p></section>`;
   review.hidden=true;send.hidden=false;
  }catch(e){error.textContent=e.message;}finally{review.disabled=false;}
 });
 send.addEventListener('click',async()=>{if(!planned)return;send.disabled=true;error.textContent='';try{await post('leaves',{...planned,client_key:key});modal.close();toast('Pengajuan dikirim ke atasan langsung.');await reload();}catch(e){error.textContent=e.message;send.disabled=false;}});
 showDates();
}
function showRequest(r){
 const modal=dialog('Detail pengajuan cuti',`<div class="leave-detail-head">${status(r)}<strong>${esc(r.employee_name)}</strong><span>${r.day_count} hari kerja · ${esc(r.approver_name)}</span></div>
 <h3>Tanggal hari kerja</h3><p>${r.dates.map(d=>esc(formatDate(d))).join(', ')}</p>
 ${r.conflicts?.length?`<div class="notice warning"><p><strong>Cuti bersamaan dalam satu unit.</strong> ${r.conflicts.map(c=>esc(c.name)+' ('+esc(formatDate(c.date))+')').join(', ')}. Peringatan ini tidak melarang persetujuan.</p></div>`:''}
 <h3>Alasan</h3><p class="detail-prose">${esc(r.reason)}</p>
 ${r.cancellation_reason?`<h3>Alasan pembatalan</h3><p class="detail-prose">${esc(r.cancellation_reason)}</p>`:''}
 ${r.decision_note?`<h3>Catatan atasan</h3><p class="detail-prose">${esc(r.decision_note)}</p>`:''}
 <p class="muted">Dikirim ${formatDate(r.created_at)} ${formatTime(r.created_at)} WITA</p>
 ${r.supervisor_changed?'<div class="notice warning"><p>Atasan langsung telah berubah. Pengajuan yang menunggu perlu dibatalkan dan diajukan ulang kepada atasan saat ini.</p></div>':''}
 <div class="actions">${r.can_decide&&['PENDING','CANCELLATION_PENDING'].includes(r.status)?button(r.status==='PENDING'?'Setujui':'Setujui pembatalan','leave-decision','check','primary',`data-id="${r.id}" data-decision="${r.status==='PENDING'?'approve':'approve-cancel'}"`)+button('Tolak','leave-decision','close','outlined',`data-id="${r.id}" data-decision="${r.status==='PENDING'?'reject':'reject-cancel'}"`):''}
 ${r.can_cancel?button(r.status==='PENDING'?'Batalkan pengajuan':'Minta pembatalan','leave-cancel','close','outlined',`data-id="${r.id}"`):''}</div>`,{wide:true});
 modal.dataset.leaveDetail='true';
}
function decide(r,decision){
 const approve=decision.startsWith('approve'),cancel=decision.includes('cancel');
 formDialog(approve?(cancel?'Setujui pembatalan':'Setujui cuti'):'Tolak permintaan',`<p class="form-note full">${esc(r.employee_name)} · ${r.day_count} hari kerja: ${r.dates.map(d=>esc(formatDate(d))).join(', ')}</p>
 ${approve?field(cancel?'Saya memverifikasi pembatalan sebelum cuti berlangsung.':'Saya telah memverifikasi tanggal pilihan sebagai hari kerja pegawai.','verified','checkbox',false,'required'):''}
 ${field(approve?'Catatan (opsional)':'Alasan penolakan','note','textarea','',approve?'optional maxlength="2000"':'maxlength="2000"')}`,async b=>{
  await post(`leaves/${r.id}/decision`,{decision,row_version:r.row_version,note:b.note,verified_work_dates:b.verified===true});
  document.querySelectorAll('[data-leave-detail]').forEach(d=>d.close());toast('Keputusan tersimpan.');await reload();
 },{submit:approve?'Setujui':'Tolak',wide:true});
}
async function history(employeeId){
 const result=await api(`leaves/history?employee_id=${encodeURIComponent(employeeId)}`);
 dialog('Riwayat saldo · '+result.employee_name,table(['Tanggal','Tahun','Perubahan','Sebelum','Sesudah','Kejadian'],result.items.map(r=>`<tr><td>${formatDate(r.created_at)}</td><td>${r.balance_year}</td><td>${r.delta_days>0?'+':''}${r.delta_days}</td><td>${r.before_days}</td><td>${r.after_days}</td><td>${esc(eventNames[r.event_type]||r.event_type)}</td></tr>`)),{wide:true});
}
const columns={
 balances:[['name','Nama pegawai'],['employee_no','Nomor pegawai'],['unit_name','Unit'],['balance_year','Tahun asal'],['granted_days','Diberikan'],['consumed_days','Terpakai'],['expired_days','Kedaluwarsa'],['reserved_days','Ditahan'],['remaining_days','Sisa buku'],['available_days','Tersedia']],
 requests:[['name','Nama pegawai'],['employee_no','Nomor pegawai'],['unit_name','Unit'],['from','Tanggal awal'],['to','Tanggal akhir'],['day_count','Hari dalam periode'],['status','Status'],['approver','Atasan'],['reason','Alasan'],['decision_note','Catatan keputusan']]
};
const reportColumns=kind=>columns[kind].map(([key,label],i)=>`<label class="check-field"><input type="checkbox" name="columns[]" value="${key}" ${i<8?'checked':''}>${esc(label)}</label>`).join('');
function exportReport(){
 const modal=formDialog('Ekspor laporan cuti',field('Jenis laporan','kind','select','<option value="balances">Saldo per tahun</option><option value="requests">Riwayat pengajuan</option>')+
 field('Tahun saldo / pengajuan','year','number',year,'min="2026" max="2100"')+field('Unit','unit','select',options(units(),'id','name',filters.unit,'Semua unit'),'optional')+
 field('Dari tanggal (pengajuan)','from','date','','optional')+field('Sampai tanggal (pengajuan)','to','date','','optional')+
 field('Status pengajuan','status','select','<option value="">Semua status</option>'+Object.entries(statusNames).map(([k,v])=>`<option value="${k}">${v}</option>`).join(''),'optional')+
 field('Format','format','select','<option value="xlsx">Excel (.xlsx)</option><option value="pdf">Cetak / simpan PDF</option>')+
 `<fieldset class="full leave-report-columns"><legend>Kolom laporan</legend><div id="leave-report-columns">${reportColumns('balances')}</div></fieldset>`,async values=>{
  const selected=columns[values.kind].filter(([key])=>values.columns?.includes(key));
  if(!selected.length)throw new Error('Pilih minimal satu kolom.');
  if(values.from&&values.to&&values.from>values.to)throw new Error('Rentang tanggal tidak valid.');
  const popup=values.format==='pdf'?window.open('','_blank'):null;
  if(values.format==='pdf'&&!popup)throw new Error('Izinkan jendela laporan untuk mencetak PDF.');
  try{
   const report=await api('leaves?year='+Number(values.year));
  const rows=values.kind==='balances'?report.balances.filter(r=>!values.unit||r.unit_id===values.unit).flatMap(r=>r.buckets.filter(b=>b.balance_year===Number(values.year)).map(b=>({...b,employee_id:r.employee_id,name:r.name,employee_no:r.employee_no,unit_name:r.unit_name,reserved_days:b.reserved_days,available_days:Math.max(0,b.available_days-b.reserved_days)}))):
   report.requests.filter(r=>(!values.unit||r.unit_id===values.unit)&&(!values.status||r.status===values.status)).flatMap(r=>{const dates=r.dates.filter(d=>d.startsWith(values.year)&&(!values.from||d>=values.from)&&(!values.to||d<=values.to));return dates.length?[{...r,name:r.employee_name,status:statusNames[r.status],from:dates[0],to:dates.at(-1),day_count:dates.length,approver:r.approver_name}]:[];});
   if(!rows.length)throw new Error('Tidak ada data pada periode dan filter tersebut.');
   await post('leaves/export-audit',{employee_ids:[...new Set(rows.map(r=>r.employee_id))],kind:values.kind});
   if(popup){
    popup.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Laporan Cuti ${esc(values.year)}</title><style>@page{size:A4 landscape;margin:12mm}body{font-family:Arial,sans-serif;font-size:10px;color:#222}h1{font-size:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}tr{break-inside:avoid}</style></head><body><h1>SPH Portal BP Besakih · Laporan Cuti ${esc(values.year)}</h1><p>${rows.length} catatan · Dicetak ${esc(formatDate(localToday()))} · WITA</p><table><thead><tr>${selected.map(([,h])=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${selected.map(([k])=>`<td>${esc(r[k]??'')}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`);
    popup.document.close();setTimeout(()=>popup.print(),150);
   }else{
    const blob=createXlsx([{name:values.kind==='balances'?'Saldo Cuti':'Pengajuan Cuti',columns:selected.map(([key,header])=>({key,header,width:26,kind:['granted_days','consumed_days','expired_days','reserved_days','remaining_days','available_days','day_count'].includes(key)?'number':['from','to'].includes(key)?'date':undefined})),rows}]);
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`cuti-${values.kind}-${values.year}.xlsx`;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
   }
  }catch(e){popup?.close();throw e;}
 },{wide:true,submit:'Siapkan laporan',note:'Data mengikuti cakupan akses Anda. PDF menggunakan dialog cetak browser; pilih Simpan sebagai PDF.'});
 modal.querySelector('[name=kind]').addEventListener('change',e=>{modal.querySelector('#leave-report-columns').innerHTML=reportColumns(e.target.value);});
}
export async function handleLeaveAction(action,element){
 if(!action.startsWith('leave-'))return false;
 if(!data||owner!==state.me)throw new Error('Muat ulang halaman Cuti.');
 const r=data.requests.find(r=>r.id===element.dataset.id);
 if(action==='leave-tab'){tab=element.dataset.tab;repaint();}
 else if(action==='leave-new')newRequest();
 else if(action==='leave-detail'&&r)showRequest(r);
 else if(action==='leave-decision'&&r)decide(r,element.dataset.decision);
 else if(action==='leave-cancel'&&r)formDialog(r.status==='PENDING'?'Batalkan pengajuan':'Minta pembatalan cuti',field('Alasan pembatalan','note','textarea','','maxlength="2000"'),async b=>{await post(`leaves/${r.id}/cancel`,{row_version:r.row_version,note:b.note});document.querySelectorAll('[data-leave-detail]').forEach(d=>d.close());toast(r.status==='PENDING'?'Pengajuan dibatalkan.':'Permintaan pembatalan dikirim ke atasan.');await reload();});
 else if(action==='leave-balance'){const r=data.balances.find(r=>r.employee_id===element.dataset.employee);if(r)dialog('Saldo · '+r.name,bucketTable(r),{wide:true});}
 else if(action==='leave-history')await history(element.dataset.employee);
 else if(action==='leave-export')exportReport();
 return true;
}
