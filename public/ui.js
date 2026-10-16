export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={
 dashboard:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
 people:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
 document:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6',
 training:'m2 9 10-5 10 5-10 5zM6 11v6c4 3 8 3 12 0v-6M22 9v7',
 coaching:'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8zM8 11h8M8 15h4',
 calendar:'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2M8 14h2M14 14h2M8 18h2',
 shield:'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11zM9 12l2 2 4-4',
 log:'M4 3h16v18H4zM8 7h8M8 11h8M8 15h5',
 incident:'m10.3 3.9-8.1 14a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3l-8.1-14a2 2 0 0 0-3.4 0M12 9v4M12 17h.01',
 settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
 key:'M8 15a6 6 0 1 1 5-9l8-3v5h-3v3h-3l-2 2a6 6 0 0 1-5 2',
 audit:'M9 5h11v16H4V5h2M9 3h6v4H9zM8 12h8M8 16h6',
 plus:'M12 5v14M5 12h14',search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
 arrow:'M5 12h14M13 6l6 6-6 6',chevron:'m9 5 7 7-7 7',down:'m6 9 6 6 6-6',
 bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
 logout:'M9 21H5V3h4M9 12h12M17 8l4 4-4 4',download:'M12 3v12M7 10l5 5 5-5M5 16v5h14v-5',
 upload:'M12 16V4M7 9l5-5 5 5M4 16v5h16v-5',close:'M6 6l12 12M18 6 6 18',check:'m5 12 4 4L19 6',
 clock:'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',help:'M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5M12 18h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
 building:'M4 22V4h16v18M2 22h20M8 8h2M14 8h2M8 12h2M14 12h2M10 22v-5h4v5',
 lock:'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4M12 15v2',edit:'m16 3 5 5-12 12-6 1 1-6zM14 5l5 5',
 refresh:'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 2M18 17a7 7 0 0 1-12 2l-2-2',
 moon:'M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10',menu:'M4 6h16M4 12h16M4 18h16',filter:'M4 7h16M7 12h10M10 17h4',
 folder:'M3 7h7l2 2h9v12H3zM3 7V4h7l2 3h9v2',location:'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
 spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',trash:'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
 eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0'
};
export const icon=(name,cls='')=>`<svg class="icon ${cls}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.document}"/></svg>`;
export const initials=name=>String(name||'?').split(' ').filter(Boolean).slice(0,2).map(s=>s[0]).join('').toUpperCase();
export const avatar=(name,tone=0)=>`<span class="avatar tone-${tone%5}" aria-hidden="true">${esc(initials(name))}</span>`;
export const labels={ACTIVE:'Aktif',INACTIVE:'Nonaktif',PLANNED:'Direncanakan',COMPLETED:'Selesai',CANCELLED:'Dibatalkan',DRAFT:'Draf',ARCHIVED:'Diarsipkan',PUBLISHED:'Terbit',SUPERSEDED:'Digantikan',NOT_RECORDED:'Belum dicatat',PRESENT:'Hadir',ABSENT:'Tidak hadir',OPEN:'Belum mulai',IN_PROGRESS:'Dalam proses',DONE:'Selesai',RECORDED:'Dicatat',RESOLVED:'Selesai',ROUTINE:'Rutin',TEMPORARY:'Sementara',MANUAL:'Manual',REGULATION:'Regulasi',SOP:'SOP',SOP_SECURITY:'SOP Keamanan',SERVICE_STANDARD:'Standar layanan',ALL:'Seluruh organisasi',SELF:'Data sendiri',ASSIGNED_UNITS:'Unit yang ditugaskan',ASSIGNED_POSTS:'Pos yang ditugaskan',JAGA:'Jaga',PATROLI:'Patroli',LAINNYA:'Lainnya'};
export const badge=(status,label)=>`<span class="badge ${['ACTIVE','PRESENT','DONE','RESOLVED','PUBLISHED','COMPLETED'].includes(status)?'positive':['IN_PROGRESS','PLANNED','DRAFT','TEMPORARY'].includes(status)?'warm':['INACTIVE','ABSENT','CANCELLED'].includes(status)?'negative':'neutral'}"><span class="status-dot"></span>${esc(label||labels[status]||status)}</span>`;
export const formatDate=(d,opts={day:'numeric',month:'short',year:'numeric'})=>d?new Intl.DateTimeFormat('id-ID',{...opts,timeZone:'Asia/Makassar'}).format(new Date(d)):'—';
export const formatTime=d=>d?new Intl.DateTimeFormat('id-ID',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Makassar'}).format(new Date(d)):'—';
export const localToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Makassar'}).format(new Date());
export const localNow=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,16);
export const toUTC=v=>new Date(`${v}:00+08:00`).toISOString();
export const empty=(title='Belum ada data',description='Tambahkan catatan pertama untuk mulai mengelola data.',ico='folder')=>`<div class="empty">${icon(ico)}<strong>${esc(title)}</strong><p>${esc(description)}</p></div>`;
export const button=(label,action,ico='plus',kind='primary',extra='')=>`<button class="button ${kind}" data-action="${action}" ${extra}>${icon(ico)}<span>${esc(label)}</span></button>`;
export const number=v=>new Intl.NumberFormat('id-ID').format(v||0);
export const options=(items,valueKey='id',labelKey='name',selected='',placeholder='Pilih…')=>`<option value="">${esc(placeholder)}</option>`+items.map(i=>`<option value="${esc(i[valueKey])}" ${String(i[valueKey])===String(selected)?'selected':''}>${esc(i[labelKey])}</option>`).join('');
export function field(label,name,type='text',value='',extra='') {
  const required=extra.includes('optional')?'':'required';extra=extra.replace('optional','');
  if(type==='textarea')return `<label class="field full"><span>${esc(label)}</span><textarea name="${name}" ${required} ${extra}>${esc(value)}</textarea></label>`;
  if(type==='select')return `<label class="field"><span>${esc(label)}</span><select name="${name}" aria-label="${esc(label)}" ${required} ${extra}>${value}</select></label>`;
  if(type==='checkbox')return `<label class="check-field"><input type="checkbox" name="${name}" ${value?'checked':''} ${extra}><span>${esc(label)}</span></label>`;
  return `<label class="field ${type==='file'?'full':''}"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value)}" ${required} ${extra}></label>`;
}
export const choices=(items,selected='')=>options(items.map(v=>({id:v,name:labels[v]||v})),'id','name',selected);
export function toast(message,error=false){const region=document.querySelector('#toast-region');const el=document.createElement('div');el.className='toast'+(error?' toast-error':'');el.textContent=message;region.append(el);setTimeout(()=>el.remove(),6500);}
export function dialog(title,content,{wide=false,subtitle='',drawer=false}={}) {
  const el=document.createElement('dialog');el.className=`dialog ${wide?'wide':''} ${drawer?'drawer':''}`;
  el.innerHTML=`<header class="dialog-header"><div><h2>${esc(title)}</h2>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div><button type="button" class="icon-button" data-close aria-label="Tutup">${icon('close')}</button></header><div class="dialog-body">${content}</div>`;
  document.body.append(el);el.addEventListener('click',e=>{if(e.target.closest('[data-close]'))el.close();});el.addEventListener('close',()=>el.remove(),{once:true});el.showModal();return el;
}
export function formDialog(title,fields,onSubmit,{wide=false,note='',submit='Simpan',initial={}}={}) {
  const el=dialog(title,`<form class="form"><div class="form-grid">${fields}</div>${note?`<p class="form-note">${esc(note)}</p>`:''}<p class="form-error" role="alert"></p><div class="form-actions"><button class="button outlined" type="button" data-close>Batal</button><button class="button primary" type="submit">${esc(submit)}</button></div></form>`,{wide});
  el.querySelector('form').addEventListener('submit',async e=>{
    e.preventDefault();const form=e.target,submitButton=form.querySelector('[type=submit]'),error=form.querySelector('.form-error');error.textContent='';submitButton.disabled=true;submitButton.textContent='Menyimpan…';
    const fd=new FormData(form),data={...initial,...Object.fromEntries(fd)};
    for(const input of form.querySelectorAll('input[type=checkbox]'))if(!input.name.endsWith('[]'))data[input.name]=input.checked;
    for(const select of form.querySelectorAll('select[multiple]'))data[select.name]=[...select.selectedOptions].map(o=>o.value);
    for(const input of form.querySelectorAll('[name$="[]"]'))data[input.name.slice(0,-2)]=fd.getAll(input.name);
    try{await onSubmit(data,form);el.close();}catch(err){error.textContent=err.message;submitButton.disabled=false;submitButton.textContent=submit;}
  });return el;
}
