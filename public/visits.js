import {api,post,permitted,refresh} from './api.js';
import {esc,icon,toast,formDialog,button,localToday} from './ui.js';
import {createXlsx} from './xlsx-export.js';

export const visitTitles={
 visits:'Dashboard Kunjungan',
 'visits-guides':'Data Guide',
 'visits-records':'Penilaian Guide',
 'visits-links':'Formulir Penilaian',
 'visits-archive':'Arsip NilaiGuide'
};
export const visitRoutes=Object.keys(visitTitles);
export const visitNav=[
 ['visits','Dashboard','dashboard','visits.dashboard.read'],
 ['visits-guides','Data Guide','people','visits.guides.read'],
 ['visits-records','Penilaian Baru','log','visits.records.read'],
 ['visits-links','Link Penilaian','calendar','visits.forms.read'],
 ['visits-archive','Arsip & Ekspor Lama','folder','visits.archive.read']
];
const M={items:[],links:[],overview:null,records:[],archive:[],from:localToday().slice(0,7)+'-01',to:localToday(),archiveMonth:'2026-10',lastCreated:null,more:false,offset:0};
const head=(title,note,actions='')=>`<div class="page-heading"><div><h1>${esc(title)}</h1><p>${esc(note)}</p></div><div class="actions">${actions}</div></div>`;
const table=(heads,rows)=>`<div class="table-wrap"><table><thead><tr>${heads.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td colspan="${heads.length}" class="muted">Belum ada data sesuai filter.</td></tr>`}</tbody></table></div>`;
const metric=(label,value)=>`<section class="stat-card visit-stat"><div class="stat-top"><span>${esc(label)}</span></div><div class="stat-value">${value==null?'—':esc(String(value))}</div></section>`;
const note=(msg)=>`<div class="notice"><div>${icon('shield')} <span>${esc(msg)}</span></div></div>`;
const pending=err=>`${head('Pengelolaan Kunjungan','Modul NilaiGuide pada SPH-Portal.')}${note(err?.message||'Jembatan Google Spreadsheet belum dikonfigurasi. Data tidak ditampilkan sampai koneksi aktif.')}`;
const day=t=>{const d=new Date(t);return Number.isNaN(d.getTime())?'-':new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Makassar',dateStyle:'medium',timeStyle:'short'}).format(d)};
const filters=()=>`<div class="toolbar"><label class="field"><span>Dari tanggal</span><input type="date" data-visit-date="from" value="${esc(M.from)}"></label><label class="field"><span>Sampai tanggal</span><input type="date" data-visit-date="to" value="${esc(M.to)}"></label>${button('Terapkan','visit-filter','filter','outlined')}</div>`;
function dashboard(){
 const d=M.overview||{},s=d.summary||{};
 return `${head('Dashboard Kunjungan','Hanya penilaian setelah tanggal integrasi; bukan seluruh riwayat NilaiGuide.')}${note('Data offline baru dihitung setelah berhasil tersinkron. Angka berasal dari Google Spreadsheet operasional.')}${filters()}<div class="stats-grid">${metric('Guide aktif',s.active_guides)}${metric('Pengantaran dalam periode',s.trips)}${metric('Penilaian hari ini',s.today)}${metric('Guide dinilai',s.guides_rated)}</div><div class="stats-grid">${metric('Kepatuhan Uniform',s.uniform_pct==null?null:s.uniform_pct+'%')}${metric('Kepatuhan ID-Card',s.id_pct==null?null:s.id_pct+'%')}${metric('Rata-rata Etika',s.etika_avg)}</div><section class="card"><header class="card-header"><h2>Perbandingan Pos 1 dan Pos 3</h2></header>${table(['Pos','Pengantaran','% Uniform','% ID'],(d.per_pos||[]).map(r=>`<tr><td>Pos ${esc(r.pos)}</td><td>${esc(r.trips)}</td><td>${r.uniform_pct??'—'}%</td><td>${r.id_pct??'—'}%</td></tr>`))}</section><section class="card"><header class="card-header"><h2>Regu</h2></header>${table(['Regu','Pengantaran','Rata-rata Etika'],(d.by_regu||[]).map(r=>`<tr><td>${esc(r.regu)}</td><td>${esc(r.trips)}</td><td>${esc(r.etika_avg??'—')}</td></tr>`))}</section>`;
}
function guides(){
 const manage=permitted('visits.guides.manage');
 return `${head('Data Guide','Master guide disimpan di Google Spreadsheet operasional.',manage?button('Tambah Guide','visit-guide-new','plus'):'')}${note('Guide dinonaktifkan tanpa menghapus riwayat penilaian. Nama kembar harus dibedakan berdasarkan guideId.')}${table(['ID','Nama','Kategori','Regu','Status',...(manage?['Aksi']:[])],M.items.map(g=>`<tr><td>${esc(g.guideId)}</td><td><strong>${esc(g.guideName)}</strong></td><td>${esc(g.kategori)}</td><td>${esc(g.regu)}</td><td>${g.aktif?'Aktif':'Nonaktif'}</td>${manage?`<td><button class="button outlined" data-visit-edit="${esc(g.guideId)}">Ubah</button></td>`:''}</tr>`))}`;
}
function records(){
 return `${head('Penilaian Baru','Penilaian sejak cutover. Baris koreksi tetap tersimpan dalam audit.')}${filters()}${table(['Waktu WITA','Pos','Guide','Uniform','ID-Card','Etika','Status'],M.records.map(r=>`<tr><td>${esc(day(r.timestamp))}</td><td>${esc(r.pos)}</td><td>${esc(r.guideName)}</td><td>${esc(r.uniform)}</td><td>${esc(r.idCard)}</td><td>${esc(r.etika)}</td><td>${esc(r.status)}</td></tr>`))}`;
}
function links(){
 return `${head('Formulir Penilaian','Tautan publik tanpa login, khusus Pos 1 dan Pos 3.')} ${note('Token hanya dapat dilihat saat dibuat. Jika hilang, nonaktifkan tautan dan buat pengganti.')}${[1,3].map(pos=>{
 const link=M.links.find(x=>Number(x.pos)===pos&&x.revoked_at===null);
 return `<section class="card"><div class="card-body"><div class="visit-link-row"><div><h2>Pos ${pos}</h2><p>${link?'Tautan aktif sejak '+day(link.created_at):'Belum ada tautan aktif.'}</p></div><div class="actions">${permitted('visits.forms.manage')?`${link?`<button class="button outlined" data-visit-revoke="${esc(link.id)}">Nonaktifkan</button>`:`<button class="button primary" data-visit-create="${pos}">Buat tautan</button>`}`:''}</div></div></div></section>`;
 }).join('')}${M.lastCreated?`<section class="card"><div class="card-body"><strong>Link baru Pos ${M.lastCreated.pos}</strong><p>Simpan atau salin sekarang, token tidak ditampilkan ulang.</p><div class="visit-link-row"><code>${esc(M.lastCreated.url)}</code><button class="button outlined" data-visit-copy>Salin link</button></div></div></section>`:''}`;
}
function archive(){
 return `${head('Arsip NilaiGuide','Data sebelum cutover tetap di spreadsheet lama dan tidak digabungkan ke dashboard baru.')}${note('Ekspor riwayat harus mempertahankan penilaian berstatus diganti dan REVIEW manual di tab rekap.')}<div class="toolbar"><label class="field"><span>Bulan arsip</span><input type="month" data-visit-archive-month value="${esc(M.archiveMonth)}"></label><button class="button outlined" data-visit-archive-load>Muat arsip</button>${permitted('visits.archive.export')?'<button class="button primary" data-visit-export>Ekspor Excel</button>':''}</div>${table(['Waktu','Pos','Guide','Uniform','ID','Etika','Koreksi','Status'],M.archive.map(r=>`<tr><td>${esc(day(r.timestamp))}</td><td>${esc(r.pos)}</td><td>${esc(r.guideName)}</td><td>${esc(r.uniform)}</td><td>${esc(r.idCard)}</td><td>${esc(r.etika)}</td><td>${esc(r.koreksiDari||'—')}</td><td>${esc(r.status)}</td></tr>`))}${M.more?note('Menampilkan halaman pertama. Ekspor Excel mengambil seluruh halaman arsip dalam bulan ini.'):''}`;
}
export async function loadVisitsPage(route){
 try {
  if(route==='visits'){M.overview=await api('visits/overview?from='+M.from+'&to='+M.to);return dashboard();}
  if(route==='visits-guides'){M.items=(await api('visits/guides')).items;return guides();}
  if(route==='visits-records'){M.records=(await api('visits/records?from='+M.from+'&to='+M.to)).items;return records();}
  if(route==='visits-links'){M.links=(await api('visits/links')).items;return links();}
  if(route==='visits-archive'){const data=await api('visits/archive?month='+M.archiveMonth+'&offset=0&limit=100');M.archive=data.items;M.more=data.more;return archive();}
 }catch(error){return pending(error);}
 return pending();
}
function guideForm(g){
 const fields=`<label class="field"><span>ID Guide</span><input name="guideId" maxlength="30" ${g?'readonly':''} value="${esc(g?.guideId||'')}" required></label><label class="field"><span>Nama</span><input name="guideName" maxlength="120" required value="${esc(g?.guideName||'')}"></label><label class="field"><span>Kategori</span><select name="kategori"><option ${g?.kategori==='Asing'?'selected':''}>Asing</option><option ${g?.kategori==='Domestik'?'selected':''}>Domestik</option></select></label><label class="field"><span>Regu</span><select name="regu">${['A1','A2','D1','D2'].map(r=>`<option ${g?.regu===r?'selected':''}>${r}</option>`).join('')}</select></label><label class="check"><input type="checkbox" name="aktif" ${!g||g.aktif?'checked':''}>Aktif</label>`;
 formDialog(g?'Ubah Guide':'Tambah Guide',fields,async(data,form)=>{
  await post('visits/guides',{guideId:data.guideId,guideName:data.guideName,kategori:data.kategori,regu:data.regu,aktif:form.querySelector('[name=aktif]').checked});
  toast('Data guide tersimpan di Spreadsheet.');refresh();
 });
}
async function exportArchive(){
 if(!permitted('visits.archive.export'))return;
 const all=[];for(let offset=0;offset<100000;offset+=500){
  const page=await api('visits/archive?month='+M.archiveMonth+'&offset='+offset+'&limit=500');
  all.push(...page.items);if(!page.more)break;
  if(offset>=99500)throw new Error('Terlalu banyak baris untuk satu ekspor. Persempit periode.');
 }
 if(!all.length)throw new Error('Tidak ada data arsip pada bulan yang dipilih.');
 const columns=['evaluationId','timestamp','pos','guideId','guideName','uniform','idCard','review','etika','catatan','receivedAt','koreksiDari','status'].map(key=>({header:key,key,kind:['uniform','idCard','review','etika','pos'].includes(key)?'number':'text'}));
 const blob=createXlsx([{name:'Evaluations',columns,rows:all}]);
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='arsip-nilaiguide-'+M.archiveMonth+'.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
 toast(all.length+' baris arsip siap diunduh. REVIEW manual tersedia di rekap spreadsheet lama.');
}
export function bindVisitsPage(route){
 const root=document.querySelector('#main');if(!root)return;
 root.querySelectorAll('[data-visit-date]').forEach(el=>el.addEventListener('change',e=>{M[e.target.dataset.visitDate]=e.target.value;}));
 root.querySelector('[data-action="visit-filter"]')?.addEventListener('click',refresh);
 root.querySelector('[data-action="visit-guide-new"]')?.addEventListener('click',()=>guideForm(null));
 root.querySelectorAll('[data-visit-edit]').forEach(el=>el.addEventListener('click',()=>guideForm(M.items.find(g=>g.guideId===el.dataset.visitEdit))));
 root.querySelectorAll('[data-visit-create]').forEach(el=>el.addEventListener('click',async()=>{
  try{const pos=Number(el.dataset.visitCreate),data=await post('visits/links',{pos});
   M.lastCreated={pos,url:location.origin+'/penilaian-guide/pos-'+pos+'/#token='+encodeURIComponent(data.token)};
   toast('Link Pos '+pos+' berhasil dibuat.');refresh();
  }catch(e){toast(e.message,true);}
 }));
 root.querySelectorAll('[data-visit-revoke]').forEach(el=>el.addEventListener('click',async()=>{
  if(!confirm('Nonaktifkan link? Penilaian offline yang belum masuk memerlukan link pengganti.'))return;
  try{await post('visits/links/revoke',{id:el.dataset.visitRevoke});M.lastCreated=null;toast('Link dinonaktifkan.');refresh();}catch(e){toast(e.message,true);}
 }));
 root.querySelector('[data-visit-copy]')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(M.lastCreated.url);toast('Link disalin.');}catch{toast('Tidak dapat menyalin otomatis.',true);}});
 root.querySelector('[data-visit-archive-month]')?.addEventListener('change',e=>{M.archiveMonth=e.target.value;});
 root.querySelector('[data-visit-archive-load]')?.addEventListener('click',refresh);
 root.querySelector('[data-visit-export]')?.addEventListener('click',()=>exportArchive().catch(e=>toast(e.message,true)));
}
