import {esc,icon} from './ui.js';

let pickerCount=0;
export function trainingParticipantPickerField(employees){
  const id=`training-participants-${++pickerCount}`;
  return `<fieldset class="training-participants full" data-training-participants>
    <legend>Pilih peserta</legend>
    <label class="field" for="${id}-search"><span>Cari nama atau nomor pegawai</span><input id="${id}-search" type="search" placeholder="Ketik nama atau nomor pegawai…" autocomplete="off" aria-controls="${id}-results"></label>
    <p class="muted text-small" data-selection-count role="status">0 peserta dipilih</p>
    <div class="training-participant-selection" data-selected-participants aria-label="Peserta yang dipilih"></div>
    <div id="${id}-results" class="training-participant-results">${employees.map(employee=>`<label class="check-field training-participant-option"><input type="checkbox" name="employee_ids[]" value="${esc(employee.id)}"><span><strong>${esc(employee.full_name)}</strong><small>${esc(employee.employee_no||'')}</small></span></label>`).join('')}</div>
    <p class="muted text-small" data-search-summary role="status"></p>
  </fieldset>`;
}

export function setupTrainingParticipantPicker(dialog,employees){
  const picker=dialog.querySelector('[data-training-participants]'),search=picker.querySelector('input[type=search]'),summary=picker.querySelector('[data-search-summary]'),count=picker.querySelector('[data-selection-count]'),selected=picker.querySelector('[data-selected-participants]');
  const normalize=value=>String(value||'').trim().toLocaleLowerCase('id-ID').replace(/\s+/g,' ');
  const inputs=[...picker.querySelectorAll('input[type=checkbox]')];
  const items=employees.map((employee,index)=>({employee,input:inputs[index],search:normalize(`${employee.full_name} ${employee.employee_no||''}`)}));
  function filter(){
    const terms=normalize(search.value).split(' ').filter(Boolean);let found=0;
    for(const item of items){const matches=terms.every(term=>item.search.includes(term));item.input.closest('label').hidden=!matches;if(matches)found++;}
    summary.textContent=!items.length?'Semua pegawai yang tersedia sudah menjadi peserta atau belum ada pegawai yang dapat dipilih.':!found?'Pegawai tidak ditemukan. Coba nama atau nomor pegawai lain.':`${found} pegawai ditampilkan. Centang peserta, lalu cari nama berikutnya.`;
  }
  function updateSelection(){
    const choices=items.filter(item=>item.input.checked);
    count.textContent=`${choices.length} peserta dipilih`;
    selected.innerHTML=choices.map(({employee})=>`<button type="button" class="training-participant-chip" data-remove-participant="${esc(employee.id)}" aria-label="Batalkan pilihan ${esc(employee.full_name)}${employee.employee_no?` (${esc(employee.employee_no)})`:''}"><span>${esc(employee.full_name)}${employee.employee_no?` (${esc(employee.employee_no)})`:''}</span>${icon('close')}</button>`).join('');
    const error=dialog.querySelector('.form-error');if(choices.length&&error.textContent==='Pilih minimal satu peserta.')error.textContent='';
  }
  search.addEventListener('input',filter);
  search.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing)event.preventDefault();});
  picker.addEventListener('change',event=>{if(event.target.matches('input[type=checkbox]'))updateSelection();});
  selected.addEventListener('click',event=>{const button=event.target.closest('[data-remove-participant]');if(!button||dialog.querySelector('form').dataset.busy)return;const item=items.find(item=>item.employee.id===button.dataset.removeParticipant);if(item){item.input.checked=false;updateSelection();search.focus();}});
  if(!items.length)dialog.querySelector('[type=submit]').disabled=true;
  filter();updateSelection();
}
