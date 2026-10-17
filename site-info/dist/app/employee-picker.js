import {esc} from './ui.js';

let pickerCount=0;
export function employeePickerField(){
  const id=`employee-picker-${++pickerCount}`;
  return `<div class="field full employee-picker" data-employee-picker>
    <label for="${id}">Tautkan pegawai (opsional)</label>
    <input id="${id}" type="search" placeholder="Cari nama atau nomor pegawai…" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-results" aria-describedby="${id}-hint">
    <input type="hidden" name="employee_id" value="">
    <div id="${id}-results" class="employee-picker-results" role="listbox" aria-label="Hasil pencarian pegawai" hidden></div>
    <small id="${id}-hint" class="employee-picker-hint" role="status"></small>
  </div>`;
}

export function setupEmployeePicker(dialog,employees=[]){
  const picker=dialog.querySelector('[data-employee-picker]'),input=picker.querySelector('[role=combobox]'),value=picker.querySelector('[name=employee_id]'),list=picker.querySelector('[role=listbox]'),hint=picker.querySelector('[role=status]');
  const normalize=text=>String(text||'').trim().toLocaleLowerCase('id-ID').replace(/\s+/g,' ');
  const items=employees.map(employee=>({...employee,search:normalize(`${employee.full_name} ${employee.employee_no||''}`)}));
  let matches=[],active=-1;
  function close(){list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;}
  function highlight(index){
    active=index;
    [...list.children].forEach((option,i)=>option.setAttribute('aria-selected',String(i===active)));
    input.setAttribute('aria-activedescendant',list.children[active].id);
    list.children[active].scrollIntoView({block:'nearest'});
  }
  function choose(index){
    const employee=matches[index];if(!employee)return;
    value.value=employee.id;input.value=employee.full_name;input.setCustomValidity('');
    close();hint.textContent=`Dipilih: ${employee.full_name}${employee.employee_no?` (${employee.employee_no})`:''}. Kosongkan pencarian untuk membatalkan tautan.`;
  }
  function search(){
    close();const query=normalize(input.value);
    if(value.value)return;
    if(query.length<2){hint.textContent=items.length?'Ketik minimal 2 karakter nama atau nomor pegawai. Kosongkan bila tidak ditautkan.':'Belum ada pegawai yang dapat ditautkan.';return;}
    const terms=query.split(' '),found=items.filter(employee=>terms.every(term=>employee.search.includes(term)));matches=found.slice(0,8);
    list.innerHTML=matches.map((employee,index)=>`<div id="${list.id}-${index}" class="employee-picker-option" role="option" aria-selected="false" data-index="${index}"><span>${esc(employee.full_name)}</span>${employee.employee_no?`<small>${esc(employee.employee_no)}</small>`:''}</div>`).join('');
    hint.textContent=!found.length?'Pegawai tidak ditemukan. Coba nama atau nomor pegawai lain.':found.length>matches.length?`Menampilkan ${matches.length} dari ${found.length} hasil. Perjelas pencarian untuk mempersempit hasil.`:`${found.length} pegawai ditemukan. Pilih pegawai yang sesuai.`;
    list.hidden=!matches.length;input.setAttribute('aria-expanded',String(!!matches.length));
  }
  input.addEventListener('input',()=>{value.value='';input.setCustomValidity(normalize(input.value)?'Pilih pegawai dari hasil pencarian atau kosongkan kolom ini.':'');search();});
  input.addEventListener('focus',search);
  input.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    if(event.key==='Tab'){close();return;}
    if(event.key==='Escape'&&!list.hidden){event.preventDefault();event.stopPropagation();close();return;}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      if(list.hidden)search();if(list.hidden)return;
      event.preventDefault();highlight(event.key==='ArrowDown'?(active+1)%matches.length:(active<0?matches.length-1:(active-1+matches.length)%matches.length));
    }else if(event.key==='Enter'&&!list.hidden){event.preventDefault();if(active>=0)choose(active);}
  });
  list.addEventListener('pointerdown',event=>event.preventDefault());
  list.addEventListener('click',event=>{const option=event.target.closest('[role=option]');if(option){choose(Number(option.dataset.index));input.focus();}});
  // Keep buttons still between pointerdown and click when focus leaves the search.
  picker.addEventListener('focusout',event=>{if(!picker.contains(event.relatedTarget)&&!event.relatedTarget?.closest('button'))close();});
  dialog.addEventListener('click',event=>{if(!picker.contains(event.target))close();});
  search();
}
