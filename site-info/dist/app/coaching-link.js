import {esc,icon,formatDate,formatTime} from './ui.js';
import {employeePickerField,setupEmployeePicker} from './employee-picker.js';

const root=document.querySelector('#coaching-link'),token=location.hash.slice(1),intro=root.querySelector('.intro').outerHTML;
const departments=['SEKRETARIAT','PELAYANAN DAN OPERASIONAL','PENGELOLAAN ASET DAN PENGEMBANGAN USAHA','KEAMANAN DAN KETERTIBAN','LINGKUNGAN DAN INFRASTRUKTUR'];
const sections=['Pengadaan dan Pelayanan Internal','Keuangan','Teknis dan Teknologi Sistem Informasi','Pemeliharaan aset','Sumber Daya Manusia','Hubungan Masyarakat','Pengelolaan Kunjungan','Layanan Parkir dan Transportasi','Pengembangan UMKM','Pemasaran dan Penjualan','Pemeriksaan Internal','Pengelolaan Resiko','Keamanan dan Ketertiban','Kebersihan Bangunan dan Lingkungan','Pengelolaan Lingkungan Hidup'];
const topics=['Disiplin','Kinerja','Pelayanan','Sikap Kerja','Lainnya'];
let people=[],today='',requestKey=crypto.randomUUID(),photo=null,preview='',pending=null,busy=false;
async function request(action,body){
  const response=await fetch(`/api/coaching-link/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',redirect:'error',body:JSON.stringify({...body,token}),signal:AbortSignal.timeout(action==='submit'?45000:25000)});
  let data;try{data=await response.json();}catch{throw new Error('Hasil pengiriman belum dapat dikonfirmasi. Coba kirim kembali.');}
  if(!response.ok){const error=new Error(data.error||'Permintaan belum berhasil.');error.status=response.status;throw error;}return data;
}
const select=(label,name,items)=>`<label class="field"><span>${esc(label)} *</span><select name="${name}" required><option value="">Pilih ${label.toLocaleLowerCase('id')}</option>${items.map(v=>`<option>${esc(v)}</option>`).join('')}</select></label>`;
const notes=(label,name,max,placeholder)=>`<label class="field"><span>${esc(label)} *</span><textarea name="${name}" required maxlength="${max}" placeholder="${esc(placeholder)}"></textarea></label>`;
function clearPhoto(){if(preview)URL.revokeObjectURL(preview);photo=null;preview='';}
function render(){
  pending=null;busy=false;clearPhoto();
  root.innerHTML=`${intro}<form id="coaching-form"><fieldset class="coaching-fields"><section class="step"><div class="step-title"><span class="step-number">1</span><h2>Karyawan dan coach</h2></div><div data-employee-scope>${employeePickerField({label:'Nama karyawan *',required:true,placeholder:'Ketik nama karyawan…'})}</div><div data-coach-scope>${employeePickerField({label:'Nama coach / atasan *',required:true,name:'coach_employee_id',placeholder:'Ketik nama coach / atasan…'})}</div>${select('Bidang','department',departments)}${select('Urusan','section',sections)}</section><section class="step"><div class="step-title"><span class="step-number">2</span><h2>Hasil coaching</h2></div><div class="coaching-grid"><label class="field"><span>Tanggal coaching *</span><input type="date" name="held_on" value="${esc(today)}" required></label>${select('Topik pembahasan','topic',topics)}</div>${notes('Permasalahan yang dibahas','constraints_notes',10000,'Tuliskan permasalahan yang dibahas saat coaching.')}${notes('Arahan / solusi yang diberikan','guidance_notes',10000,'Tuliskan arahan atau solusi dari coach.')}${notes('Komitmen dan tindak lanjut karyawan','agreement_notes',3000,'Tuliskan tindakan yang disepakati.')}<label class="field"><span>Tanggal komitmen penyelesaian *</span><input type="date" name="due_on" min="${esc(today)}" required></label><p class="hint">Tanggal mengikuti WITA. Semua kolom wajib diisi.</p></section><section class="step coaching-photo"><div class="step-title"><span class="step-number">3</span><h2>Foto coaching</h2></div><label class="field"><span>Pilih atau ambil foto coaching *</span><input type="file" name="photo" accept="image/jpeg,image/png" required></label><p class="hint">Satu foto JPG atau PNG, maksimal 10 MB.</p><figure class="coaching-preview" hidden><img alt="Pratinjau foto coaching"></figure></section><div class="hidden-field" aria-hidden="true" inert><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div></fieldset><p class="form-error" role="alert"></p><button class="button primary wide" type="submit">${icon('check')}Kirim coaching</button><p class="submit-note">Pastikan nama karyawan dan coach sudah sesuai sebelum mengirim.</p></form>`;
  setupEmployeePicker(root.querySelector('[data-employee-scope]'),people,{required:true});setupEmployeePicker(root.querySelector('[data-coach-scope]'),people,{required:true});
  const form=root.querySelector('form'),fields=form.querySelector('fieldset'),error=form.querySelector('.form-error'),send=form.querySelector('[type=submit]'),image=form.querySelector('.coaching-preview');
  const held=form.querySelector('[name=held_on]'),due=form.querySelector('[name=due_on]');held.addEventListener('change',()=>{due.min=held.value;});
  form.querySelector('[name=photo]').addEventListener('change',async event=>{
    clearPhoto();image.hidden=true;error.textContent='';const file=event.target.files[0];if(!file)return;
    if(!['image/jpeg','image/png'].includes(file.type)||file.size>10485760||file.size<1){error.textContent='Pilih foto JPG/PNG maksimal 10 MB.';event.target.value='';return;}
    photo=file;preview=URL.createObjectURL(file);image.querySelector('img').src=preview;image.hidden=false;
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;error.textContent='';
    if(!pending){const values=Object.fromEntries(new FormData(form));if(!people.some(p=>p.id===values.employee_id&&!p.disabled)||!people.some(p=>p.id===values.coach_employee_id&&!p.disabled)){error.textContent='Pilih nama karyawan dan coach dari hasil pencarian.';return;}if(values.employee_id===values.coach_employee_id){error.textContent='Coach harus berbeda dari karyawan.';return;}if(!photo){error.textContent='Pilih satu foto coaching terlebih dahulu.';return;}}
    busy=true;fields.disabled=true;send.disabled=true;send.textContent='Mengirim coaching…';
    try{
      if(!pending){fields.disabled=false;const values=Object.fromEntries(new FormData(form));fields.disabled=true;const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Foto belum dapat dibaca. Coba pilih kembali.'));reader.readAsDataURL(photo);});const {photo:ignored,...data}=values;pending={...data,photo:{data:base64,mime_type:photo.type},idempotency_key:requestKey};}
      const result=await request('submit',pending);clearPhoto();pending=null;
      root.innerHTML=`<section class="message" role="status"><p class="eyebrow">Selesai</p><h1>Coaching berhasil dikirim</h1><p>Terima kasih. Hasil coaching dan tindak lanjut sudah tersimpan di SPH-Portal BP Besakih.</p><div class="receipt">${esc(result.reference)}</div><p class="hint">Diterima ${formatDate(result.received_at)} pukul ${formatTime(result.received_at)} WITA.</p><button class="button primary wide" type="button" data-new>Isi coaching berikutnya</button></section>`;
      root.querySelector('[data-new]').addEventListener('click',()=>{requestKey=crypto.randomUUID();render();window.scrollTo({top:0,behavior:'smooth'});});window.scrollTo({top:0,behavior:'smooth'});
    }catch(failure){busy=false;send.disabled=false;if([400,413,415,422].includes(failure.status)||!pending){pending=null;fields.disabled=false;send.innerHTML=`${icon('check')}Kirim coaching`;error.textContent=failure.message;}else{send.textContent='Kirim ulang';error.textContent=(failure.name==='TimeoutError'||failure.name==='TypeError'?'Pengiriman belum dapat dikonfirmasi.':failure.message)+' Tekan Kirim ulang untuk mengirim jawaban yang sama.';}}
  });
}
async function start(){
  if(!/^[a-f0-9]{64}$/.test(token)){root.innerHTML='<section class="message"><h1>Tautan belum lengkap</h1><p>Buka tautan coaching lengkap yang dibagikan pengelola melalui WhatsApp atau pesan Anda.</p></section>';return;}
  try{const data=await request('context',{});people=data.employees;today=data.today;document.title=`${data.label} · BP Besakih`;if(!people.some(p=>!p.disabled))throw new Error('Daftar karyawan belum tersedia. Hubungi pengelola.');render();}
  catch(error){root.innerHTML=`<section class="message"><h1>Formulir belum dapat dibuka</h1><p>${esc(error.message)}</p><button class="button primary wide" type="button" data-retry>Coba buka kembali</button></section>`;root.querySelector('[data-retry]').addEventListener('click',start);}
}
window.addEventListener('pagehide',clearPhoto);window.addEventListener('hashchange',()=>location.reload());start();
