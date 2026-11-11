import {LEAVE_TYPES,getLeaveType,leaveRange,leaveDayLabel} from './leave-policy.js';
export const leaveTypeOptions=()=>LEAVE_TYPES.map(t=>`<option value="${t.code}">${t.code==='ANNUAL'?'':'Cuti khusus — '}${t.name} (${t.entitlement})</option>`).join('');
export function bindLeaveDatePicker(form,{today,container,note,showButton,formatDate,esc,reset,onError}){
 const selected=()=>getLeaveType(form.elements.leave_type.value);
 let previous=null;
 function show(){
  reset();onError('');const dates=leaveRange(form.elements.from.value,form.elements.to.value),type=selected();
  if(!dates.length||dates[0]<today){container.innerHTML='';onError('Pilih rentang tanggal yang valid mulai hari ini, maksimal 366 hari.');return;}
  if(type.calendar_days){
   if(dates.length>type.max_days){container.innerHTML='';onError(`${type.name} maksimal ${type.entitlement}.`);return;}
   container.innerHTML=`<p><strong>${dates.length} hari kalender</strong>, termasuk hari libur. Seluruh tanggal dalam rentang diajukan.</p><p>${esc(formatDate(dates[0]))} – ${esc(formatDate(dates.at(-1)))}</p>`;
  }else container.innerHTML=`<p class="muted">Centang hari kerja Anda. Sabtu/Minggu mengikuti jadwal kerja.${type.deducts_balance?' Hari pilihan akan memakai saldo tahunan.':' Maksimal '+type.max_days+' hari; saldo tahunan tidak berkurang.'}</p><div class="leave-day-grid day-grid">${dates.map(d=>`<label class="check-field check"><input type="checkbox" name="work_date" value="${d}" ${!type.deducts_balance&&dates.length<=type.max_days?'checked':''}><span>${esc(formatDate(d))}</span></label>`).join('')}</div>`;
 }
 function policy(){
  const type=selected();reset();onError('');container.innerHTML='';
  if(!type.calendar_days&&previous?.calendar_days)form.elements.to.value=form.elements.from.value;
  previous=type;
  note.textContent=type.note+(type.deducts_balance?'':' Cuti khusus tidak mengurangi saldo tahunan.');
  if(type.calendar_days&&leaveRange(form.elements.from.value,form.elements.from.value).length){
   form.elements.to.value=new Date(Date.parse(form.elements.from.value)+(type.max_days-1)*86400000).toISOString().slice(0,10);
  }
  show();
 }
 showButton.addEventListener('click',show);
 form.elements.leave_type.addEventListener('change',policy);
 form.elements.from.addEventListener('change',()=>{if(selected().calendar_days)policy();else{reset();container.innerHTML='';}});
 form.elements.to.addEventListener('change',()=>{reset();container.innerHTML='';if(selected().calendar_days)show();});
 policy();
 return {type:selected,dates:()=>selected().calendar_days?leaveRange(form.elements.from.value,form.elements.to.value):[...container.querySelectorAll('[name=work_date]:checked')].map(e=>e.value),label:()=>leaveDayLabel(selected().code)};
}
