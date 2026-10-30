import {employeePickerField,setupEmployeePicker} from './employee-picker.js';
const root=document.querySelector('#leave-form-root'),token=new URLSearchParams(location.hash.slice(1)).get('token');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=d=>new Intl.DateTimeFormat('id-ID',{weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Makassar'}).format(new Date(d+'T00:00:00+08:00'));
async function call(action,body={}){
 const response=await fetch('/api/leave-form/'+action,{method:'POST',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,...body})});
 let result;try{result=await response.json();}catch{throw new Error('Pengiriman belum dapat dikonfirmasi. Periksa koneksi dan coba kembali.');}
 if(!response.ok)throw new Error(result.error||'Formulir belum dapat diproses.');return result;
}
async function start(){
 try{
  if(!/^[a-f0-9]{64}$/.test(token||''))throw new Error('Buka tautan formulir yang diberikan SDM. Halaman ini membutuhkan tautan aktif.');
  const ctx=await call('context');
  if(ctx.shared){
   root.innerHTML=`<section class="card"><h2>Pilih nama Anda</h2><p class="muted">Satu formulir untuk seluruh pegawai non-THL. Cari nama, lalu pastikan jabatan dan unitnya sesuai.</p>${employeePickerField({label:'Nama pegawai',required:true})}<p class="privacy">Saldo dan riwayat pribadi tidak ditampilkan pada formulir bersama. Atasan langsung akan memastikan identitas pemohon sebelum menyetujui.</p></section><div id="selected-employee"></div>`;
   setupEmployeePicker(root,ctx.employees,{required:true,onSelect:e=>{if(!e){document.querySelector('#selected-employee').innerHTML='';return;}renderRequest({shared:true,today:ctx.today,name:e.full_name,unit_name:e.unit_name,position_name:e.position_name,approver:e.approver,can_request:e.can_request,employee_id:e.id},document.querySelector('#selected-employee'));}});
  }else renderRequest(ctx,root);
 }catch(err){root.innerHTML=`<section class="card"><h2>Formulir belum dapat dibuka</h2><p class="error" role="alert">${esc(err.message)}</p><button type="button" id="retry">Coba lagi</button></section>`;document.querySelector('#retry').addEventListener('click',start);}
}
function renderRequest(ctx,target){
  target.innerHTML=`<section class="card person"><div><p class="eyebrow">PEMOHON</p><h2>${esc(ctx.name)}</h2><p class="muted">${esc(ctx.position_name)}${!ctx.shared&&ctx.unit_name?' · '+esc(ctx.unit_name):''}</p><small>Persetujuan: ${esc(ctx.approver||'Atasan belum ditetapkan')}</small></div>${!ctx.shared?`<div class="balance"><strong>${ctx.available_days} hari</strong><span>Saldo tersedia${ctx.reserved_days?' · '+ctx.reserved_days+' hari ditahan':''}</span></div>`:''}</section>
  ${ctx.can_request?`<form id="request"><h2>Rencana cuti</h2><p class="muted">Pilih rentang tanggal, lalu centang hanya hari kerja Anda.</p><div class="dates-row"><label class="field"><span>Dari tanggal</span><input type="date" name="from" min="${ctx.today}" value="${ctx.today}" required></label><label class="field"><span>Sampai tanggal</span><input type="date" name="to" min="${ctx.today}" value="${ctx.today}" required></label></div><button type="button" id="show-dates">Tampilkan tanggal</button><div id="work-dates"></div>
  <label class="field"><span>Alasan / keperluan cuti</span><textarea name="reason" required maxlength="2000" placeholder="Tuliskan keperluan cuti Anda"></textarea></label>
  <label class="check"><input type="checkbox" name="confirmed" required><span>Saya adalah ${esc(ctx.name)}. Tanggal yang saya pilih merupakan hari kerja saya dan data pengajuan ini benar.</span></label>
  <p class="error" id="form-error" role="alert"></p><div id="preview"></div><div class="actions"><button type="submit" class="primary" id="review">Periksa pengajuan</button><button type="button" class="primary" id="send" hidden>Kirim ke atasan</button></div><p class="privacy">Saldo ditahan selama pengajuan menunggu atasan. ${ctx.shared?'Pastikan nama yang dipilih adalah nama Anda sendiri.':'Simpan tautan pribadi ini dan bagikan hanya kepada pemiliknya.'}</p></form>`:'<div class="notice"><p>Atasan langsung belum ditetapkan secara tunggal. Hubungi SDM untuk melengkapi data sebelum mengajukan cuti.</p></div>'}`;
  if(!ctx.can_request)return;
  const form=document.querySelector('#request'),error=document.querySelector('#form-error'),preview=document.querySelector('#preview'),review=document.querySelector('#review'),send=document.querySelector('#send'),days=document.querySelector('#work-dates');
  let planned=null,key=crypto.randomUUID(),busy=false,attempt=null;
  const reset=()=>{planned=null;preview.innerHTML='';send.hidden=true;review.hidden=false;};
  const values=()=>({dates:[...form.querySelectorAll('[name=work_date]:checked')].map(i=>i.value),reason:form.elements.reason.value.trim(),...(ctx.shared?{employee_id:ctx.employee_id}:{})});
  form.addEventListener('input',()=>{if(!busy){reset();error.textContent='';}});
  for(const name of ['from','to'])form.elements[name].addEventListener('change',()=>{days.innerHTML='';});
  document.querySelector('#show-dates').addEventListener('click',()=>{
   reset();error.textContent='';const from=form.elements.from.value,to=form.elements.to.value,n=(Date.parse(to)-Date.parse(from))/86400000+1;
   if(!Number.isInteger(n)||n<1||n>366||from<ctx.today){error.textContent='Pilih rentang mulai hari ini, maksimal 366 hari.';return;}
   const dates=Array.from({length:n},(_,i)=>new Date(Date.parse(from)+i*86400000).toISOString().slice(0,10));
   days.innerHTML=`<fieldset><legend>Tanggal hari kerja yang diajukan</legend><small>Sabtu/Minggu tidak otomatis dianggap libur. Sesuaikan dengan jadwal kerja Anda.</small><div class="day-grid">${dates.map(d=>`<label class="check"><input type="checkbox" name="work_date" value="${d}"><span>${esc(date(d))}</span></label>`).join('')}</div></fieldset>`;
  });
  const lock=value=>{busy=value;for(const el of root.querySelectorAll('input,textarea,button'))el.disabled=value;};
  form.addEventListener('submit',async e=>{
   e.preventDefault();if(busy)return;error.textContent='';const body=values();if(!body.dates.length){error.textContent='Tampilkan tanggal dan centang minimal satu hari kerja.';return;}
   lock(true);try{
    const result=await call('preview',body);planned=body;
    preview.innerHTML=`<section class="preview"><h2>Periksa sebelum dikirim</h2><p><strong>${result.day_count} hari kerja</strong> · Persetujuan ${esc(result.approver)}</p><ul>${result.dates.map(d=>`<li>${esc(date(d))}</li>`).join('')}</ul><p>${esc(body.reason)}</p>${result.conflicts.length?`<div class="notice">Ada rekan satu unit yang sudah cuti pada ${result.conflicts.map(d=>esc(date(d))).join(', ')}. Anda tetap dapat mengajukan; atasan akan mempertimbangkannya.</div>`:''}<small>Saldo dipotong setelah disetujui atasan langsung.</small></section>`;
    send.hidden=false;review.hidden=true;
   }catch(err){error.textContent=err.message;reset();}finally{lock(false);}
  });
  send.addEventListener('click',async()=>{
   if(busy||!planned||!form.reportValidity())return;
   const payload=JSON.stringify(planned);if(attempt!==payload){key=crypto.randomUUID();attempt=payload;}
   lock(true);error.textContent='';try{
    const receipt=await call('submit',{...planned,client_key:key});
    root.innerHTML=`<section class="card receipt"><p class="eyebrow">PENGAJUAN TERKIRIM</p><h2>Pengajuan cuti diterima</h2><p>${esc(ctx.name)}, pengajuan Anda ${receipt.status==='PENDING'?'menunggu keputusan '+esc(ctx.approver):'sudah tercatat dengan status '+esc(receipt.status)}.</p><p>Nomor pengajuan</p><p class="reference">${esc(receipt.reference)}</p><p class="muted">Simpan nomor ini. Keputusan diproses oleh atasan langsung. Untuk perubahan atau pembatalan, buka menu Cuti di akun portal atau hubungi atasan.</p><button type="button" id="another">Kembali ke formulir</button></section>`;
    document.querySelector('#another').addEventListener('click',start);
   }catch(err){error.textContent=err.message;lock(false);}
  });
}
start();
