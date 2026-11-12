import {api,post,patch,state} from './api.js';
import {esc,icon,toast,dialog,formDialog,localToday,formatDate,formatTime,number} from './ui.js';
import {createXlsx} from './xlsx-export.js';

// Menu E-Arsip (menu bersama, seperti Cuti dan Absensi). Semua hak diputuskan server:
// baris Rahasia tanpa izin baca datang dari server hanya dengan nomor agenda, tanggal
// pengarsipan, dan label Rahasia, jadi halaman ini tidak pernah menerima metadata yang
// disamarkan. Berkas dibuka lewat rute pratinjau; berkas asli hanya lewat rute unduh.
export const archivesTitle='E-Arsip';
// Ruang kerja Humas → E-Arsip (PRD 10.1). Tiap bagian E-Arsip adalah rute sendiri di
// sidebar Humas; detail arsip dibuka sebagai archive-list?id=… Petugas Arsip juga di sini,
// karena selain Super Admin, Kepala Urusan mengelola petugas di bawah urusannya.
export const archiveTitles={archives:'E-Arsip','archive-list':'Daftar Arsip','archive-new':'Tambah Arsip','archive-reports':'Laporan Arsip','archive-requests':'Pengajuan Hapus Arsip',
 'archive-types':'Jenis Dokumen Arsip','archive-deleted':'Arsip Dihapus','archive-officers':'Petugas Arsip'};
export const archiveRoutes=Object.keys(archiveTitles);
const routeTab={archives:'summary','archive-list':'list','archive-new':'new','archive-reports':'reports','archive-requests':'requests','archive-types':'types','archive-deleted':'deleted','archive-officers':'officers'};
export const archiveNav=[['archives','Ringkasan','dashboard','archives:home'],['archive-list','Daftar Arsip','folder','archives:home'],['archive-new','Tambah Arsip','plus','archives:officer'],
 ['archive-reports','Laporan','document','archives:home'],['archive-requests','Pengajuan Hapus','trash','archives:requests'],['archive-types','Jenis Dokumen','key','archives:humas'],['archive-deleted','Arsip Dihapus','trash','archives:humas'],
 ['archive-officers','Petugas Arsip','people','archives:officers']];
const freshFilters=()=>({q:'',from:'',to:'',unit:'',type:'',direction:'',classification:'',letter_from:'',letter_to:'',shared:false});
const R={owner:null,overview:null,tab:'summary',id:null,detail:null,missing:false,section:'documents',dashboard:null,notifications:null,filters:freshFilters(),list:null,
 types:null,deleted:null,requests:null,requestStatus:'PENDING',officers:null,history:null,access:null,report:null,uploads:new Map(),keys:new Map()};
const V={token:0,pdf:null,task:null,page:1,pages:0,zoom:1,url:null,kind:null,label:'',size:0};
const directionLabel={MASUK:'Masuk',KELUAR:'Keluar',INTERNAL:'Internal'};
const sourceLabel={HUMAS:'role Humas',BAGIAN:'keanggotaan bagian pemilik',PENGAWASAN:'cakupan pengawasan',BERBAGI:'berbagi oleh Humas',IZIN_RAHASIA:'izin baca Rahasia dari Humas'};
const reportLabel={recap_period:'Rekap per periode',recap_unit:'Rekap per bagian',recap_type:'Rekap per jenis dokumen',agenda_in:'Buku agenda surat masuk',agenda_out:'Buku agenda surat keluar'};
const requestLabel={PENDING:'Menunggu',APPROVED:'Disetujui',REJECTED:'Ditolak',CANCELLED:'Dibatalkan'};
const grantStatus={AKTIF:['Aktif','positive'],DICABUT:['Dicabut','neutral'],KEDALUWARSA:['Kedaluwarsa','neutral'],TIDAK_BERLAKU:['Tidak berlaku','neutral']};
const officerStatus={AKTIF:['Aktif','positive'],DICABUT:['Dicabut','neutral'],KEDALUWARSA:['Kedaluwarsa','neutral'],TIDAK_BERLAKU:['Tidak berlaku (bukan anggota bagian / akun nonaktif)','warm']};
const duplicateLabel={BERKAS_SAMA:'berkas sama',NOMOR_DAN_TANGGAL:'nomor dan tanggal surat sama',PERIHAL_DAN_TANGGAL:'perihal dan tanggal surat sama'};
const actionLabel={ARCHIVE_CREATED:'Arsip dibuat',METADATA_EDITED:'Informasi surat diubah',ATTACHMENT_ADDED:'Lampiran ditambahkan',ATTACHMENT_REMOVED:'Lampiran dilepas',VERSION_ADDED:'Berkas diganti (versi baru)',
 DUPLICATE_OVERRIDE:'Disimpan walau ada dugaan duplikat',CLASSIFICATION_CHANGED:'Klasifikasi diubah',SHARE_GRANTED:'Dibagikan',SHARE_REVOKED:'Berbagi dicabut',RAHASIA_GRANTED:'Izin baca Rahasia diberikan',
 RAHASIA_REVOKED:'Izin baca Rahasia dicabut',DOWNLOAD_GRANTED:'Izin unduh diberikan',DOWNLOAD_REVOKED:'Izin unduh dicabut',DELETE_REQUESTED:'Penghapusan diajukan',DELETE_REJECTED:'Pengajuan hapus ditolak',
 DELETE_REQUEST_CANCELLED:'Pengajuan hapus dibatalkan',ARCHIVE_DELETED:'Arsip dihapus (disembunyikan)',ARCHIVE_RESTORED:'Arsip dipulihkan',DOWNLOAD_STARTED:'Unduhan berkas asli dimulai'};
const fieldLabel={direction:'Arah surat',document_type_id:'Jenis dokumen',document_type:'Jenis dokumen',official_number:'Nomor surat',letter_date:'Tanggal surat',subject:'Perihal',classification:'Klasifikasi',
 security_epoch:'Periode izin',agenda_number:'Nomor agenda',filename:'Nama berkas',size:'Ukuran',version_number:'Versi',role:'Peran berkas'};
const EXTENSIONS={pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png'};
const ACCEPT='.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';

// Modul yang dimuat saat diperlukan berada di /app/, juga ketika halaman ini berjalan dari bundel /portal-static/.
const moduleURL=name=>new URL((new URL(import.meta.url).pathname.startsWith('/portal-static/')?'../app/':'./')+name,import.meta.url).href;
const monthStart=()=>localToday().slice(0,8)+'01';
const stamp=value=>value?`${formatDate(value)} ${formatTime(value)}`:'—';
const fileSize=bytes=>bytes>=1e6?`${(bytes/1e6).toLocaleString('id-ID',{maximumFractionDigits:1})} MB`:`${Math.max(1,Math.round(bytes/1000)).toLocaleString('id-ID')} KB`;
const pill=(text,tone='neutral')=>`<span class="badge ${tone}"><span class="status-dot"></span>${esc(text)}</span>`;
// Klasifikasi tidak dibedakan dengan warna saja: Rahasia selalu memakai ikon gembok dan teks.
const classBadge=value=>value==='RAHASIA'?`<span class="badge negative archive-secret">${icon('lock')}Rahasia</span>`:'<span class="badge neutral">Biasa</span>';
const head=(title,note,actions='')=>`<div class="page-heading"><div><h1>${esc(title)}</h1><p>${esc(note)}</p></div><div class="actions">${actions}</div></div>`;
const btn=(label,action,ico='plus',kind='primary',extra='')=>`<button type="button" class="button ${kind}" data-arc="${action}" ${extra}>${icon(ico)}<span>${esc(label)}</span></button>`;
const link=(label,action,extra='')=>`<button type="button" class="button text" data-arc="${action}" ${extra}>${esc(label)}</button>`;
const card=(title,sub,body,actions='')=>`<section class="card"><header class="card-header"><div><h2>${esc(title)}</h2>${sub?`<p>${esc(sub)}</p>`:''}</div>${actions?`<div class="actions">${actions}</div>`:''}</header>${body}</section>`;
const table=(heads,rows,empty='Belum ada data.',cls='')=>`<div class="table-wrap"><table class="archive-table ${cls}"><thead><tr>${heads.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr class="archive-empty-row"><td colspan="${heads.length}" class="muted">${esc(empty)}</td></tr>`}</tbody></table></div>`;
const cell=(label,html,cls='')=>`<td data-label="${esc(label)}" class="${cls}">${html}</td>`;
const stat=(label,value,note='')=>`<section class="stat-card"><div class="stat-top"><span>${esc(label)}</span></div><div class="stat-value">${esc(String(value))}</div>${note?`<div class="stat-bottom"><span>${esc(note)}</span></div>`:''}</section>`;
const notice=(title,text,ico='help',kind='')=>`<div class="notice ${kind}">${icon(ico)}<div><strong>${esc(title)}</strong><p>${esc(text)}</p></div></div>`;
const option=(value,label,selected)=>`<option value="${esc(value)}" ${String(value)===String(selected??'')?'selected':''}>${esc(label)}</option>`;
const input=(label,name,type,value='',extra='')=>`<label class="field"><span>${esc(label)}</span><input type="${type}" name="${name}" value="${esc(value)}" ${extra}></label>`;
const area=(label,name,extra='',value='')=>`<label class="field full"><span>${esc(label)}</span><textarea name="${name}" ${extra}>${esc(value)}</textarea></label>`;
const operationKey=()=>globalThis.crypto?.randomUUID?globalThis.crypto.randomUUID():Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
function saveBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function decode(base64){const text=atob(base64),bytes=new Uint8Array(text.length);for(let i=0;i<text.length;i++)bytes[i]=text.charCodeAt(i);return bytes;}
const go=(route,query='')=>{const hash=`#${route}${query?`?${query}`:''}`;if(location.hash===hash)document.dispatchEvent(new Event('refresh-app'));else location.hash=hash;};
const openArchive=(id,view)=>go('archive-list',`id=${encodeURIComponent(id)}${view?`&view=${view}`:''}`);
const typeOptions=(selected,{activeOnly=false,blank=''}={})=>`${blank?option('',blank,selected):''}${(R.overview?.types||[]).filter(t=>!activeOnly||t.active||t.id===selected).map(t=>option(t.id,t.active?t.name:`${t.name} (nonaktif)`,selected)).join('')}`;
const unitOptions=(selected,blank='Semua bagian dalam kewenangan')=>`${option('',blank,selected)}${(R.overview?.units||[]).map(u=>option(u.id,u.name,selected)).join('')}`;

/* ---------- Muat halaman ---------- */
export async function loadArchivesPage(route='archives'){
 if(R.owner!==state.me)Object.assign(R,{owner:state.me,tab:'summary',filters:freshFilters(),list:null,report:null,requestStatus:'PENDING',uploads:new Map(),keys:new Map()});
 closeViewer();
 // Ringkasan hak baru saja diambil sebelum rute diputuskan (refreshArchivesForRoute); jangan ambil dua kali.
 R.overview=state.archives&&Date.now()-(state.archivesAt||0)<3000?state.archives:await api('archives/overview');state.archives=R.overview;state.archivesAt=Date.now();
 const params=new URLSearchParams(location.hash.split('?')[1]||'');
 R.tab=routeTab[route]||'summary';
 R.id=R.tab==='list'?params.get('id'):null;
 if(R.id){R.section=['documents','history','access'].includes(params.get('view'))?params.get('view'):'documents';await loadDetail();return renderDetail();}
 R.report=R.report||{type:'recap_period',from:monthStart(),to:localToday(),unit_id:'',document_type_id:''};
 await loadTab();
 return render();
}
function listQuery(cursor){
 const f=R.filters,query=new URLSearchParams();
 for(const key of ['q','from','to','unit','type','direction','classification','letter_from','letter_to'])if(f[key])query.set(key,f[key]);
 if(f.shared)query.set('shared','1');
 if(cursor)query.set('cursor',cursor);
 return query.toString();
}
async function loadTab(){
 if(R.tab==='summary'){[R.dashboard,R.notifications]=await Promise.all([api('archives/dashboard'),api('archives/notifications')]);R.overview.unread=R.notifications.unread;}
 if(R.tab==='list')R.list=await api(`archives?${listQuery()}`);
 if(R.tab==='requests')R.requests=await api(`archives/delete-requests?status=${R.requestStatus}`);
 if(R.tab==='types')R.types=(await api('archives/types')).types;
 if(R.tab==='deleted')R.deleted=await api('archives/deleted');
 if(R.tab==='officers')R.officers=await api('archives/officers');
}
async function loadDetail(){
 R.missing=false;R.history=null;R.access=null;
 try{R.detail=await api(`archives/${encodeURIComponent(R.id)}`);}
 catch(error){if(error.status!==404)throw error;R.detail=null;R.missing=true;return;}
 if(!R.detail.access.read)return;
 if(R.section==='history'&&!R.detail.access.history)R.section='documents';
 if(R.section==='access'&&!R.detail.access.humas)R.section='documents';
 if(R.section==='history')R.history=await api(`archives/${encodeURIComponent(R.id)}/history`);
 if(R.section==='access')R.access=await api(`archives/${encodeURIComponent(R.id)}/access`);
}
const headings={summary:['E-Arsip','Arsip digital dokumen administrasi per bagian, dengan pengawasan Humas.'],list:['Daftar Arsip','Cari dan saring arsip dalam kewenangan Anda.'],
 new:['Tambah Arsip','Arsipkan dokumen bagian Anda. Nomor agenda dibuat otomatis.'],reports:['Laporan Arsip','Rekap dan buku agenda sesuai hak akses Anda.'],
 requests:['Pengajuan Hapus','Pengajuan penghapusan arsip dari petugas kepada Humas.'],types:['Jenis Dokumen','Master jenis dokumen untuk arsip baru.'],
 deleted:['Arsip Dihapus','Arsip yang disembunyikan dan dapat dipulihkan Humas.'],officers:['Petugas Arsip','Penunjukan petugas arsip per bagian dan kode agenda bagian.']};
function render(){
 const body={summary:summaryTab,list:listTab,new:newTab,reports:reportsTab,requests:requestsTab,types:typesTab,deleted:deletedTab,officers:officersTab}[R.tab]();
 const [title,note]=headings[R.tab];
 return `${head(title,note,headerActions())}
 <div id="archive-content">${body}</div>
 <footer class="page-footer"><span>SPH Portal · E-Arsip</span><span>Waktu operasional WITA</span></footer>`;
}
function headerActions(){
 if(['summary','list'].includes(R.tab)&&R.overview.officer_units.length)return btn('Tambah Arsip','route','plus','primary','data-route="archive-new"');
 if(R.tab==='types')return btn('Tambah jenis','type-new');
 if(R.tab==='officers'&&R.officers?.can_assign)return btn('Tunjuk petugas','officer-new','people');
 return '';
}
async function rerender(){
 const main=document.querySelector('#main');if(!main||!archiveRoutes.includes(state.route))return;
 closeViewer();
 if(R.id){await loadDetail();main.innerHTML=renderDetail();afterDetail();}
 else{await loadTab();main.innerHTML=render();}
}
async function refreshOverview(){R.overview=await api('archives/overview');state.archives=R.overview;state.archivesAt=Date.now();document.dispatchEvent(new Event('badges-changed'));}

/* ---------- Ringkasan ---------- */
function rowLink(item){return `<button type="button" class="link-button" data-arc="open" data-id="${esc(item.id)}"><strong>${esc(item.agenda_number)}</strong></button>`;}
function notificationItem(n){
 const unread=n.read?'':' unread';
 if(n.type==='HUMAS_DAILY_SUMMARY'){
  if(n.total===null)return `<li class="archive-note${unread}"><div><strong>Ringkasan pengarsipan ${esc(formatDate(n.summary_date))}</strong><p class="muted text-small">Rincian hanya untuk Humas.</p></div></li>`;
  const units=n.units.length?n.units.map(u=>`${esc(u.unit)}: ${number(u.count)}`).join(' · '):'Tidak ada arsip baru.';
  return `<li class="archive-note${unread}"><div><strong>Ringkasan pengarsipan ${esc(formatDate(n.summary_date))}: ${number(n.total)} arsip baru</strong><p class="muted text-small">${units}</p></div></li>`;
 }
 if(!n.available)return `<li class="archive-note${unread}"><div><strong>Arsip dibagikan kepada Anda</strong><p class="muted text-small">Arsip ini tidak lagi tersedia untuk akun Anda. ${esc(stamp(n.created_at))}</p></div></li>`;
 return `<li class="archive-note${unread}"><div><strong>Humas membagikan arsip ${esc(n.archive.agenda_number)}</strong><p class="muted text-small">${n.archive.subject?`${esc(n.archive.subject)} · `:''}${esc(stamp(n.created_at))}</p></div>${link('Buka','open',`data-id="${esc(n.archive.id)}"`)}</li>`;
}
function summaryTab(){
 const d=R.dashboard,n=R.notifications;
 const types=d.by_type.map(t=>`<tr>${cell('Jenis dokumen',esc(t.name))}${cell('Jumlah',number(t.count))}</tr>`);
 if(d.restricted)types.push(`<tr>${cell('Jenis dokumen','Rahasia dengan informasi terbatas <span class="muted text-small">(jenis tidak ditampilkan)</span>')}${cell('Jumlah',number(d.restricted))}</tr>`);
 const latest=d.latest.map(item=>item.restricted
  ?`<tr>${cell('Nomor agenda',rowLink(item))}${cell('Diarsipkan',esc(formatDate(item.archived_at)))}${cell('Perihal',classBadge('RAHASIA'))}</tr>`
  :`<tr>${cell('Nomor agenda',rowLink(item))}${cell('Diarsipkan',esc(formatDate(item.archived_at)))}${cell('Perihal',`${esc(item.subject)}<br><span class="muted text-small">${esc(item.document_type)} · ${esc(directionLabel[item.direction])} · ${esc(item.unit.name)}</span>`)}</tr>`);
 return `<div class="stats-grid">${stat('Arsip aktif',number(d.total),'Dalam kewenangan Anda')}${stat('Dapat dibaca penuh',number(d.readable))}${stat('Rahasia, informasi terbatas',number(d.restricted),'Hanya nomor agenda dan tanggal arsip')}</div>
 <p class="muted text-small archive-hint">Angka di atas menghitung arsip aktif. Arsip yang dihapus tidak dihitung; ringkasan harian Humas menghitung pengarsipan baru per hari, jadi kedua angka bisa berbeda.</p>
 ${n.items.length||R.overview.humas?card('Notifikasi',n.unread?`${number(n.unread)} belum dibaca`:'Semua sudah dibaca',`<ul class="archive-notes">${n.items.length?n.items.map(notificationItem).join(''):'<li class="archive-note"><div class="muted">Belum ada notifikasi.</div></li>'}</ul>`,n.unread?btn('Tandai semua dibaca','notifications-read','check','outlined'):''):''}
 <div class="visit-grid">${card('Jumlah per jenis dokumen','Hanya arsip yang dapat Anda baca penuh.',table(['Jenis dokumen','Jumlah'],types,'Belum ada arsip.'))}
 ${card('Arsip terbaru','Delapan arsip terakhir dalam kewenangan Anda.',table(['Nomor agenda','Diarsipkan','Perihal'],latest,R.overview.officer_units.length?'Belum ada arsip. Mulai dengan Tambah Arsip.':'Belum ada arsip dalam kewenangan Anda.'))}</div>`;
}

/* ---------- Daftar, pencarian, dan saringan ---------- */
function activeFilterCount(){const f=R.filters;return ['from','to','unit','type','direction','classification','letter_from','letter_to'].filter(key=>f[key]).length+(f.shared?1:0);}
function listRow(item){
 if(item.restricted){
  // Sel terkunci tidak membawa nilai asli: server memang tidak mengirimkannya.
  const locked=label=>cell(label,`<span class="archive-locked" aria-label="Terkunci">${icon('lock')}</span>`,'locked');
  return `<tr class="archive-restricted">${cell('Nomor agenda',`<strong>${esc(item.agenda_number)}</strong>`)}${cell('Tgl arsip',esc(formatDate(item.archived_at)))}${locked('Tgl surat')}${locked('Jenis / arah')}${locked('Nomor surat')}${locked('Perihal')}${locked('Bagian')}${cell('Klasifikasi',classBadge('RAHASIA'))}${cell('Aksi',link('Info akses','open',`data-id="${esc(item.id)}"`),'archive-action')}</tr>`;
 }
 return `<tr>${cell('Nomor agenda',rowLink(item))}${cell('Tgl arsip',esc(formatDate(item.archived_at)))}${cell('Tgl surat',esc(formatDate(item.letter_date)))}${cell('Jenis / arah',`${esc(item.document_type)}<span class="muted text-small archive-sub">${esc(directionLabel[item.direction])}</span>`)}${cell('Nomor surat',item.official_number?esc(item.official_number):'<span class="muted">—</span>')}${cell('Perihal',esc(item.subject),'archive-subject')}${cell('Bagian',esc(item.unit.name))}${cell('Klasifikasi',classBadge(item.classification))}${cell('Aksi',link('Lihat','open',`data-id="${esc(item.id)}"`),'archive-action')}</tr>`;
}
function listTab(){
 const f=R.filters,l=R.list,count=activeFilterCount(),filtered=Boolean(count||f.q);
 const emptyText=filtered?'Tidak ada arsip yang cocok dengan pencarian dan saringan ini.':R.overview.officer_units.length?'Belum ada arsip. Mulai dengan Tambah Arsip.':'Belum ada arsip dalam kewenangan Anda.';
 return `<form class="archive-search" data-arc-form="search" role="search"><label class="archive-search-box">${icon('search')}<input type="search" name="q" value="${esc(f.q)}" maxlength="120" placeholder="Cari nomor agenda, nomor surat, atau perihal" aria-label="Cari nomor agenda, nomor surat, atau perihal"></label>
  <button type="submit" class="button primary">${icon('search')}<span>Cari</span></button></form>
 <details class="archive-filter" ${count?'open':''}><summary>${icon('filter')}<span>Saringan${count?` (${count} aktif)`:''}</span></summary>
  <form class="archive-filter-grid" data-arc-form="filter">
   ${input('Diarsipkan dari','from','date',f.from,`max="${localToday()}"`)}${input('Diarsipkan sampai','to','date',f.to,`max="${localToday()}"`)}
   <label class="field"><span>Bagian</span><select name="unit">${unitOptions(f.unit,'Semua bagian')}</select></label>
   <label class="field"><span>Jenis dokumen</span><select name="type">${typeOptions(f.type,{blank:'Semua jenis'})}</select></label>
   <label class="field"><span>Arah surat</span><select name="direction">${option('','Semua arah',f.direction)}${Object.entries(directionLabel).map(([k,v])=>option(k,v,f.direction)).join('')}</select></label>
   <label class="field"><span>Klasifikasi</span><select name="classification">${option('','Semua klasifikasi',f.classification)}${option('BIASA','Biasa',f.classification)}${option('RAHASIA','Rahasia',f.classification)}</select></label>
   ${input('Tanggal surat dari','letter_from','date',f.letter_from)}${input('Tanggal surat sampai','letter_to','date',f.letter_to)}
   <label class="check-field"><input type="checkbox" name="shared" ${f.shared?'checked':''}><span>Hanya yang dibagikan kepada saya</span></label>
   <div class="actions"><button type="submit" class="button primary">${icon('filter')}<span>Terapkan</span></button>${btn('Reset','filter-reset','refresh','outlined')}</div>
  </form></details>
 ${l.readable_only?notice('Pencarian rincian hanya pada arsip yang dapat Anda baca','Nomor surat, perihal, jenis, arah, dan tanggal surat arsip Rahasia tanpa izin baca tidak ikut dicari. Arsip seperti itu hanya dapat dicari lewat nomor agendanya.','lock'):''}
 <section class="card">${table(['Nomor agenda','Tgl arsip','Tgl surat','Jenis / arah','Nomor surat','Perihal','Bagian','Klasifikasi','Aksi'],l.items.map(listRow),emptyText,'archive-list')}
 <div class="archive-list-foot"><span class="muted text-small">Menampilkan ${number(l.items.length)} dari ${number(l.total)} arsip sesuai kewenangan Anda.${filtered?' Saringan aktif.':''}</span>${filtered?btn('Hapus saringan','filter-reset','refresh','outlined'):''}${l.next_cursor?btn('Muat lebih banyak','more','down','outlined'):''}</div></section>`;
}

/* ---------- Unggah berkas ---------- */
function checkFile(file){
 const limit=R.overview.limits.max_file_bytes,ext=file.name.includes('.')?file.name.split('.').pop().toLowerCase():'';
 if(['heic','heif'].includes(ext)||/hei[cf]/i.test(file.type))return 'format HEIC belum didukung. Simpan atau ekspor foto sebagai JPG atau PNG, lalu pilih kembali.';
 if(!EXTENSIONS[ext])return 'format harus PDF, JPG, JPEG, atau PNG.';
 if(!file.size)return 'berkas kosong.';
 if(file.size>limit)return `ukuran ${fileSize(file.size)} melebihi batas 10 MB per berkas.`;
 return null;
}
// Berkas yang sudah berhasil diunggah tidak dikirim lagi ketika penyimpanan dicoba ulang.
async function uploadOnce(file,onStatus=()=>{}){
 const known=R.uploads.get(file);if(known)return known;
 const problem=checkFile(file);if(problem)throw new Error(`${file.name}: ${problem}`);
 onStatus('Mengunggah dan memvalidasi…');
 const ext=file.name.split('.').pop().toLowerCase();
 try{
  const result=await api('uploads',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Upload-Name':encodeURIComponent(file.name),'X-Upload-Type':EXTENSIONS[ext]},body:file});
  R.uploads.set(file,result.id);onStatus('Selesai','done');return result.id;
 }catch(error){
  const offline=!error.status;onStatus(offline?'Gagal: koneksi terputus':'Gagal','failed');
  throw new Error(offline?`${file.name}: koneksi terputus saat mengunggah. Periksa internet, lalu tekan Simpan lagi; berkas yang sudah selesai tidak diunggah ulang.`:`${file.name}: ${error.message}`);
 }
}
// Kunci operasi mengikuti isi kiriman: kiriman yang sama memakai kunci yang sama (tidak
// membuat arsip kedua), isi yang diubah memakai kunci baru.
function keyFor(signature){if(!R.keys.has(signature))R.keys.set(signature,operationKey());return R.keys.get(signature);}

/* ---------- Tambah arsip ---------- */
function fileList(files,statuses=new Map()){
 return files.length?`<ul class="archive-files">${files.map(({file,role})=>{const problem=checkFile(file),status=statuses.get(file)||(problem?[`Tidak dapat diunggah: ${problem}`,'failed']:R.uploads.has(file)?['Selesai','done']:['Menunggu','']);
  return `<li class="${status[1]||''}"><span><strong>${esc(file.name)}</strong> <span class="muted text-small">${esc(role)} · ${fileSize(file.size)}</span></span><span class="archive-file-status">${esc(status[0])}</span></li>`;}).join('')}</ul>`:'';
}
function newTab(){
 const o=R.overview,units=o.officer_units,ready=units.filter(u=>u.agenda_code);
 if(!ready.length)return notice('Kode agenda bagian belum ditetapkan','Administrator portal perlu menetapkan kode agenda bagian Anda di menu Petugas Arsip sebelum arsip pertama disimpan.','lock','warning');
 return `<form class="card archive-form" data-arc-form="create" novalidate>
  <div class="archive-form-body">
  ${notice('Arsip baru langsung tersimpan sebagai Biasa','Setelah disimpan, arsip langsung aktif dan dapat dibaca pegawai bagian pemilik tanpa persetujuan Humas. Untuk dokumen sensitif, hubungi Humas agar klasifikasinya diubah menjadi Rahasia.','help')}
  <fieldset class="archive-fieldset"><legend>Informasi Surat</legend><div class="form-grid">
   ${ready.length>1?`<label class="field"><span>Bagian pemilik</span><select name="owner_unit_id" required>${ready.map(u=>option(u.id,`${u.name} (${u.agenda_code})`,'')).join('')}</select></label>`
    :`<div class="field"><span>Bagian pemilik</span><p class="archive-static">${esc(ready[0].name)} (${esc(ready[0].agenda_code)})</p><input type="hidden" name="owner_unit_id" value="${esc(ready[0].id)}"></div>`}
   <div class="field"><span>Nomor agenda</span><p class="archive-static muted">Dibuat setelah berhasil disimpan</p></div>
   <label class="field"><span>Arah surat</span><select name="direction" required><option value="">Pilih arah…</option>${Object.entries(directionLabel).map(([k,v])=>option(k,v,'')).join('')}</select></label>
   <label class="field"><span>Jenis dokumen</span><select name="document_type_id" required><option value="">Pilih jenis…</option>${o.types.filter(t=>t.active).map(t=>option(t.id,t.name,'')).join('')}</select></label>
   <label class="field"><span>Nomor surat <span class="muted">(opsional)</span></span><input name="official_number" maxlength="${o.limits.number_max}" autocomplete="off"></label>
   <label class="field"><span>Tanggal surat</span><input type="date" name="letter_date" required></label>
   <label class="field full"><span>Perihal</span><textarea name="subject" required maxlength="${o.limits.subject_max}" rows="3"></textarea></label>
  </div></fieldset>
  <fieldset class="archive-fieldset"><legend>Dokumen</legend><div class="form-grid">
   <label class="field full"><span>Dokumen utama (satu berkas PDF, JPG, JPEG, atau PNG; maksimal 10 MB)</span><input type="file" name="main" accept="${ACCEPT}" required></label>
   <label class="field full"><span>Lampiran <span class="muted">(opsional, boleh lebih dari satu; tiap berkas maksimal 10 MB)</span></span><input type="file" name="attachments" accept="${ACCEPT}" multiple></label>
  </div><div data-arc-files></div>
  <p class="form-note">Di HP, pemilih berkas dapat membuka kamera untuk memotret surat. Bila kamera menghasilkan HEIC, ubah dulu ke JPG atau PNG.</p></fieldset>
  <p class="form-error" role="alert"></p>
  <div class="form-actions">${btn('Batal','route','close','outlined','data-route="archive-list"')}<button type="submit" class="button primary">${icon('check')}<span>Simpan arsip</span></button></div>
  </div></form>`;
}
function formFiles(form){
 const main=form.elements.main.files[0],attachments=[...form.elements.attachments.files];
 return [...(main?[{file:main,role:'Dokumen utama'}]:[]),...attachments.map(file=>({file,role:'Lampiran'}))];
}
function duplicateDialog(candidates){
 return new Promise(resolve=>{
  let answered=false;
  const rows=candidates.map(c=>`<tr>${cell('Nomor agenda',`<strong>${esc(c.agenda_number)}</strong>`)}${cell('Tanggal surat',esc(formatDate(c.letter_date)))}${cell('Nomor surat',esc(c.official_number||'—'))}${cell('Perihal',esc(c.subject))}${cell('Kecocokan',esc(c.reasons.map(r=>duplicateLabel[r]||r).join(', ')))}</tr>`);
  const el=formDialog('Dugaan arsip ganda',`<div class="full">${table(['Nomor agenda','Tanggal surat','Nomor surat','Perihal','Kecocokan'],rows)}</div>${area('Alasan tetap menyimpan','duplicate_reason','required maxlength="500" rows="3" placeholder="Contoh: surat berbeda dengan perihal yang sama"')}`,
   async data=>{answered=true;resolve(data.duplicate_reason.trim());},{wide:true,submit:'Tetap simpan',note:'Arsip di atas tampak sama dengan yang akan disimpan. Batalkan bila ini memang arsip yang sama, atau tulis alasan untuk tetap menyimpan. Alasan dicatat dalam riwayat.'});
  el.addEventListener('close',()=>{if(!answered)resolve(null);});
 });
}
async function submitCreate(form){
 const error=form.querySelector('.form-error'),submit=form.querySelector('[type=submit]'),box=form.querySelector('[data-arc-files]');
 error.textContent='';
 if(!form.reportValidity())return;
 const files=formFiles(form),problems=files.map(({file})=>checkFile(file)?`${file.name}: ${checkFile(file)}`:null).filter(Boolean);
 if(problems.length){error.textContent=problems.join(' ');return;}
 if(files.length-1>R.overview.limits.max_attachments){error.textContent=`Paling banyak ${R.overview.limits.max_attachments} lampiran per penyimpanan. Lampiran lain dapat ditambahkan dari detail arsip.`;return;}
 const data=Object.fromEntries(new FormData(form)),statuses=new Map();
 submit.disabled=true;form.dataset.busy='1';
 try{
  const ids=[];
  for(const {file} of files){
   ids.push(await uploadOnce(file,(text,kind)=>{statuses.set(file,[text,kind]);box.innerHTML=fileList(files,statuses);}));
  }
  const body={owner_unit_id:data.owner_unit_id,direction:data.direction,document_type_id:data.document_type_id,official_number:data.official_number.trim()||null,letter_date:data.letter_date,subject:data.subject.trim(),main_file_id:ids[0],attachment_file_ids:ids.slice(1)};
  body.idempotency_key=keyFor(JSON.stringify(body));
  let result=await post('archives',body);
  if(result.duplicate_warning){
   const reason=await duplicateDialog(result.candidates);
   if(!reason){error.textContent='Penyimpanan dibatalkan. Arsip belum disimpan.';return;}
   result=await post('archives',{...body,duplicate_reason:reason});
   if(result.duplicate_warning)throw new Error('Alasan tetap menyimpan wajib diisi.');
  }
  toast(`Arsip tersimpan dengan nomor agenda ${result.archive.agenda_number}.`);
  refreshOverview().catch(()=>{});
  openArchive(result.archive.id);
 }catch(e){error.textContent=e.status?e.message:e.message||'Koneksi terputus. Periksa internet, lalu tekan Simpan lagi.';}
 finally{submit.disabled=false;delete form.dataset.busy;}
}

/* ---------- Detail arsip ---------- */
function metaItem(label,html){return `<div><dt>${esc(label)}</dt><dd>${html}</dd></div>`;}
function documentBlock(d,a,access){
 const current=d.versions.find(v=>v.current)||d.versions[0],older=d.versions.filter(v=>!v.current);
 const path=v=>`data-document="${esc(d.id)}" data-version="${esc(v.id)}" data-label="${esc(v.filename)}"`;
 const download=v=>access.download?link('Unduh','download',path(v)):'';
 return `<div class="archive-doc"><div class="archive-doc-main"><strong>${esc(current.filename)}</strong><span class="muted text-small">${d.role==='MAIN'?'Dokumen utama':'Lampiran'} · ${fileSize(current.size)} · versi ${current.version_number} · ${esc(stamp(current.created_at))} oleh ${esc(current.created_by)}</span></div>
  <div class="actions">${btn('Pratinjau','preview','eye','outlined',path(current))}${access.download?btn('Unduh','download','download','outlined',path(current)):''}
  ${access.edit?link('Ganti berkas','replace',`data-document="${esc(d.id)}"`):''}${access.edit&&d.role==='ATTACHMENT'?link('Lepas','remove-attachment',`data-document="${esc(d.id)}"`):''}</div>
  ${older.length?`<details class="archive-versions"><summary>${older.length} versi sebelumnya</summary><ul>${older.map(v=>`<li><span>Versi ${v.version_number} · ${esc(v.filename)} · ${fileSize(v.size)} · ${esc(stamp(v.created_at))} oleh ${esc(v.created_by)}</span><span class="actions">${link('Pratinjau','preview',path(v))}${download(v)}</span></li>`).join('')}</ul>
   <p class="muted text-small">Versi lama mengikuti izin yang berlaku sekarang.</p></details>`:''}
  ${current.change_reason?`<p class="muted text-small archive-doc-note">Alasan penggantian terakhir: ${esc(current.change_reason)}</p>`:''}</div>`;
}
function documentsSection(){
 const {archive:a,documents,access,delete_request:pending}=R.detail,main=documents.find(d=>d.role==='MAIN'),attachments=documents.filter(d=>d.role==='ATTACHMENT');
 const typeNote=a.document_type_current!==a.document_type?` <span class="muted text-small">(kini bernama ${esc(a.document_type_current)})</span>`:!a.document_type_active?' <span class="muted text-small">(jenis nonaktif)</span>':'';
 return `${pending?notice('Pengajuan penghapusan menunggu keputusan Humas',`Diajukan ${stamp(pending.requested_at)} oleh ${pending.requested_by}: ${pending.reason}. Arsip tetap aktif sampai Humas memutuskan.`,'trash','warning'):''}
 ${card('Informasi surat','',`<dl class="archive-meta">${metaItem('Nomor agenda',esc(a.agenda_number))}${metaItem('Diarsipkan',esc(stamp(a.archived_at)))}${metaItem('Bagian pemilik',esc(a.unit.name))}${metaItem('Arah surat',esc(directionLabel[a.direction]))}
  ${metaItem('Jenis dokumen',esc(a.document_type)+typeNote)}${metaItem('Nomor surat',a.official_number?esc(a.official_number):'<span class="muted">Tidak ada</span>')}${metaItem('Tanggal surat',esc(formatDate(a.letter_date)))}${metaItem('Klasifikasi',classBadge(a.classification))}
  ${metaItem('Diarsipkan oleh',esc(a.created_by))}${metaItem('Terakhir diubah',`${esc(stamp(a.updated_at))} oleh ${esc(a.updated_by)}`)}</dl><div class="archive-subject-full"><dt>Perihal</dt><dd>${esc(a.subject)}</dd></div>`,access.edit?btn('Ubah informasi','edit','edit','outlined'):'')}
 ${card('Pratinjau','Pratinjau ditampilkan di portal. Berkas asli hanya dapat diunduh dengan izin unduh dari Humas.',`<div class="archive-viewer" id="archive-viewer"><p class="muted archive-viewer-empty">Memuat pratinjau dokumen utama…</p></div>`)}
 ${card('Dokumen',access.download?'Anda memiliki izin unduh untuk arsip ini.':'Unduh memerlukan izin Humas. Hubungi Humas secara langsung bila perlu berkas aslinya.',`${documentBlock(main,a,access)}${attachments.length?`<h3 class="archive-subhead">Lampiran (${attachments.length})</h3>${attachments.map(d=>documentBlock(d,a,access)).join('')}`:'<p class="muted archive-doc-note">Tidak ada lampiran.</p>'}`,access.edit?btn('Tambah lampiran','attachment-add','plus','outlined'):'')}`;
}
function describeChange(item){
 const lines=[];
 if(item.before||item.after){
  const keys=[...new Set([...Object.keys(item.before||{}),...Object.keys(item.after||{})])].filter(k=>k!=='document_type_id');
  const show=(key,value)=>value==null||value===''?'—':key==='direction'?directionLabel[value]||value:key==='classification'?(value==='RAHASIA'?'Rahasia':'Biasa'):key==='letter_date'?formatDate(value):key==='size'?fileSize(value):key==='role'?(value==='MAIN'?'Dokumen utama':'Lampiran'):String(value);
  for(const key of keys){
   const before=item.before?.[key],after=item.after?.[key];
   lines.push(item.before&&key in item.before?`${fieldLabel[key]||key}: ${show(key,before)} → ${show(key,after)}`:`${fieldLabel[key]||key}: ${show(key,after)}`);
  }
 }
 if(item.context?.document_type_before)lines.push(`Jenis dokumen: ${item.context.document_type_before} → ${item.context.document_type_after}`);
 if(item.context?.grants_ended&&(item.context.grants_ended.rahasia_read||item.context.grants_ended.download))lines.push(`Izin berakhir: ${item.context.grants_ended.rahasia_read} baca Rahasia, ${item.context.grants_ended.download} unduh`);
 if(item.context?.expires_at)lines.push(`Berlaku sampai ${stamp(item.context.expires_at)}`);
 if(item.context?.self_grant)lines.push('Izin untuk diri sendiri');
 if(item.context?.reference)lines.push(`Rujukan: ${item.context.reference}`);
 if(item.reason)lines.push(`Alasan: ${item.reason}`);
 return lines.map(esc).join('<br>');
}
function historySection(){
 const rows=R.history.items.map(i=>`<tr>${cell('Waktu',esc(stamp(i.occurred_at)))}${cell('Tindakan',esc(actionLabel[i.action]||i.action))}${cell('Oleh',esc(i.actor))}${cell('Rincian',describeChange(i)||'<span class="muted">—</span>')}</tr>`);
 return card('Riwayat arsip',R.detail.access.humas?'Seluruh tindakan pada arsip ini. Pembukaan detail dan pratinjau dicatat tetapi tidak ditampilkan di sini.':'Perubahan isi dan informasi surat. Riwayat izin hanya untuk Humas.',table(['Waktu','Tindakan','Oleh','Rincian'],rows,'Belum ada riwayat.'));
}
function impactText(target){
 const i=R.access.impact;
 return target==='RAHASIA'
  ?`Setelah menjadi Rahasia: ${number(i.unit_members)} pegawai bagian pemilik, ${number(i.share_users)} pegawai dan ${number(i.share_units)} bagian penerima berbagi hanya melihat nomor agenda, tanggal arsip, dan label Rahasia. Humas tetap membaca penuh; pengguna lain perlu izin baca Rahasia. ${number(i.download_grants)} izin unduh berakhir dan perlu diberikan ulang bila masih diperlukan.`
  :`Setelah menjadi Biasa: ${number(i.unit_members)} pegawai bagian pemilik serta penerima berbagi yang belum dicabut (${number(i.share_users)} pegawai, ${number(i.share_units)} bagian) kembali dapat membaca arsip ini. ${number(i.rahasia_grants)} izin baca Rahasia dan ${number(i.download_grants)} izin unduh berakhir.`;
}
function accessSection(){
 const p=R.access,a=p.archive,secret=a.classification==='RAHASIA';
 const rows=p.grants.map(g=>{
  const [label,tone]=grantStatus[g.status]||[g.status,'neutral'];
  const ineffective=g.purpose==='DOWNLOAD'&&g.active&&g.effective===false?'<br><span class="muted text-small">Belum efektif: penerima belum dapat membaca arsip ini.</span>':'';
  return `<tr class="${g.open?'':'muted'}">${cell('Izin',esc(g.purpose_label))}${cell('Penerima',`${esc(g.target.name)}${g.target.kind==='UNIT'?' <span class="muted text-small">(bagian)</span>':''}`)}${cell('Berlaku',g.expires_at?`sampai ${esc(stamp(g.expires_at))}`:'sampai dicabut')}${cell('Diberikan',`${esc(stamp(g.granted_at))}<br><span class="muted text-small">oleh ${esc(g.granted_by)} · ${esc(g.reason)}</span>`)}${cell('Status',`${pill(label,tone)}${ineffective}${g.revoked_at?`<br><span class="muted text-small">${esc(stamp(g.revoked_at))}${g.revoked_reason?` · ${esc(g.revoked_reason)}`:''}</span>`:''}`)}${cell('Aksi',g.open?link('Cabut','grant-revoke',`data-id="${esc(g.id)}"`):'','archive-action')}</tr>`;
 });
 return `${card('Klasifikasi',`Saat ini: ${secret?'Rahasia':'Biasa'}. Hanya Humas yang dapat mengubah klasifikasi.`,`<p class="archive-doc-note">${esc(impactText(secret?'BIASA':'RAHASIA'))}</p>`,btn(secret?'Ubah menjadi Biasa':'Ubah menjadi Rahasia','classify','lock','outlined'))}
 ${card('Izin dan berbagi','Penerima berbagi hanya dapat membaca. Izin unduh diberikan terpisah, juga bagi Humas.',`${table(['Izin','Penerima','Berlaku','Diberikan','Status','Aksi'],rows,'Belum ada izin atau berbagi untuk arsip ini.')}
  <p class="muted text-small archive-doc-note">Permintaan akses disampaikan langsung kepada Humas (misalnya lewat WhatsApp); tidak ada formulir permintaan di aplikasi. Semua pemberian dan pencabutan dicatat dalam riwayat.</p>`,
  `${secret?btn('Beri izin baca Rahasia','grant-rahasia','key','primary'):btn('Bagikan','grant-share','people','primary')}${btn('Beri izin unduh','grant-download','download','outlined')}`)}`;
}
function renderDetail(){
 const back=`<p class="archive-back">${link('← Kembali ke daftar arsip','back')}</p>`;
 if(R.missing)return `${back}${notice('Arsip tidak ditemukan','Arsip ini tidak ada, sudah dihapus, atau berada di luar kewenangan Anda.','lock')}`;
 const {archive:a,access}=R.detail;
 if(!access.read)return `${back}${head(a.agenda_number,`Diarsipkan ${formatDate(a.archived_at)}`)}
  <section class="card"><dl class="archive-meta">${metaItem('Nomor agenda',esc(a.agenda_number))}${metaItem('Tanggal pengarsipan',esc(formatDate(a.archived_at)))}${metaItem('Klasifikasi',classBadge('RAHASIA'))}</dl></section>
  ${notice('Arsip ini berklasifikasi Rahasia','Rincian dan berkasnya hanya dapat dibuka dengan izin baca Rahasia. Hubungi Humas secara langsung (misalnya lewat WhatsApp) untuk meminta akses; tidak ada formulir permintaan di aplikasi.','lock')}`;
 const sections=[['documents','Dokumen'],...(access.history?[['history','Riwayat']]:[]),...(access.humas?[['access','Pengaturan Akses']]:[])];
 const actions=`${access.request_delete&&!R.detail.delete_request?btn('Ajukan penghapusan','delete-request','trash','outlined'):''}${R.detail.delete_request?.mine?btn('Batalkan pengajuan hapus','delete-cancel','close','outlined',`data-id="${esc(R.detail.delete_request.id)}"`):''}${access.humas?btn('Hapus arsip','delete-direct','trash','outlined'):''}`;
 const sources=access.sources.map(s=>sourceLabel[s]||s).join(', ');
 const body=R.section==='history'?historySection():R.section==='access'?accessSection():documentsSection();
 return `${back}${head(a.agenda_number,a.subject,actions)}
 <p class="archive-source">${classBadge(a.classification)} <span class="muted text-small">Anda dapat membaca arsip ini karena ${esc(sources||'hak akses Anda')}.${access.edit?' Anda dapat mengubahnya sebagai petugas arsip bagian pemilik.':access.sources.includes('BERBAGI')||access.sources.includes('IZIN_RAHASIA')?' Akses ini hanya untuk membaca.':''}</span></p>
 ${sections.length>1?`<div class="leave-tabs" role="tablist" aria-label="Bagian detail arsip">${sections.map(([key,label])=>`<button type="button" role="tab" aria-selected="${R.section===key}" class="chip ${R.section===key?'active':''}" data-arc="section" data-section="${key}">${esc(label)}</button>`).join('')}</div>`:''}
 <div id="archive-content">${body}</div>
 <footer class="page-footer"><span>SPH Portal · E-Arsip</span><span>Waktu operasional WITA</span></footer>`;
}
function afterDetail(){
 if(!R.id||!R.detail?.access.read||R.section!=='documents')return;
 const main=R.detail.documents.find(d=>d.role==='MAIN'),current=main?.versions.find(v=>v.current);
 if(!current)return;
 // Berkas besar tidak dimuat otomatis supaya kuota data HP tidak terpakai tanpa diminta.
 if(current.size<=3_000_000)openPreview(main.id,current.id,current.filename).catch(()=>{});
 else{const box=document.querySelector('#archive-viewer');if(box)box.innerHTML=`<p class="muted archive-viewer-empty">Dokumen utama berukuran ${fileSize(current.size)}. ${btn('Muat pratinjau','preview','eye','outlined',`data-document="${esc(main.id)}" data-version="${esc(current.id)}" data-label="${esc(current.filename)}"`)}</p>`;}
}

/* ---------- Penampil pratinjau ---------- */
let pdfjsPromise;
function pdfjs(){
 if(!pdfjsPromise){
  const path='/app/assets/vendor/pdfjs/pdf.js';
  pdfjsPromise=import(path).then(lib=>{lib.GlobalWorkerOptions.workerSrc='/app/assets/vendor/pdfjs/pdf-worker.js';return lib;}).catch(error=>{pdfjsPromise=null;throw error;});
 }
 return pdfjsPromise;
}
function closeViewer(){
 V.token++;
 try{V.task?.cancel();}catch{}
 try{V.pdf?.destroy();}catch{}
 if(V.url)URL.revokeObjectURL(V.url);
 Object.assign(V,{pdf:null,task:null,page:1,pages:0,zoom:1,url:null,kind:null,label:'',size:0});
}
function viewerBar(){
 const paging=V.kind==='pdf'?`<button type="button" class="icon-button" data-arc="viewer-prev" aria-label="Halaman sebelumnya" ${V.page<=1?'disabled':''}>${icon('chevron','flip')}</button><span aria-live="polite">Halaman ${V.page} dari ${V.pages}</span><button type="button" class="icon-button" data-arc="viewer-next" aria-label="Halaman berikutnya" ${V.page>=V.pages?'disabled':''}>${icon('chevron')}</button>`:'';
 return `<div class="archive-viewer-bar"><strong class="archive-viewer-name">${esc(V.label)}</strong><span class="archive-viewer-controls">${paging}<button type="button" class="icon-button" data-arc="viewer-out" aria-label="Perkecil" ${V.zoom<=0.5?'disabled':''}>−</button><span>${Math.round(V.zoom*100)}%</span><button type="button" class="icon-button" data-arc="viewer-in" aria-label="Perbesar" ${V.zoom>=3?'disabled':''}>+</button></span></div>`;
}
async function drawViewer(){
 const box=document.querySelector('#archive-viewer');if(!box)return;
 const token=V.token;
 if(V.kind==='image'){
  // Lebar diatur lewat CSSOM: atribut style sebaris diblokir CSP portal.
  box.innerHTML=`${viewerBar()}<div class="archive-viewer-stage"><img alt="Pratinjau ${esc(V.label)}"></div>`;
  const image=box.querySelector('img');image.style.width=`${Math.round(V.zoom*100)}%`;image.src=V.url;return;
 }
 box.innerHTML=`${viewerBar()}<div class="archive-viewer-stage"><canvas aria-label="Pratinjau ${esc(V.label)}, halaman ${V.page}"></canvas></div>`;
 const stage=box.querySelector('.archive-viewer-stage'),canvas=box.querySelector('canvas'),page=await V.pdf.getPage(V.page);
 if(token!==V.token)return;
 const base=page.getViewport({scale:1}),fit=Math.max(240,stage.clientWidth-24)/base.width,ratio=Math.min(window.devicePixelRatio||1,2);
 let scale=fit*V.zoom*ratio;
 // Batas ukuran kanvas supaya HP dengan memori kecil tidak gagal merender.
 const limit=Math.sqrt(12_000_000/(base.width*base.height));if(scale>limit)scale=limit;
 const viewport=page.getViewport({scale});
 canvas.width=Math.floor(viewport.width);canvas.height=Math.floor(viewport.height);canvas.style.width=`${Math.floor(viewport.width/ratio)}px`;
 try{V.task?.cancel();}catch{}
 V.task=page.render({canvasContext:canvas.getContext('2d'),viewport});
 try{await V.task.promise;}catch(error){if(error?.name!=='RenderingCancelledException')throw error;}
}
async function openPreview(documentId,versionId,label){
 closeViewer();
 const token=V.token,box=document.querySelector('#archive-viewer');if(!box)return;
 box.innerHTML='<div class="loading-panel"><span class="spinner"></span>Memuat pratinjau…</div>';
 const fail=message=>{if(token===V.token&&document.querySelector('#archive-viewer'))document.querySelector('#archive-viewer').innerHTML=`<p class="archive-viewer-empty">${icon('incident')} ${esc(message)}</p>`;};
 let data;
 try{data=await api(`archives/${encodeURIComponent(R.id)}/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/preview`);}
 catch(error){
  if(token!==V.token)return;
  // Izin berubah ketika halaman terbuka: tampilkan keadaan terbaru, bukan sisa tampilan lama.
  if([403,404].includes(error.status)){toast(error.message,true);await rerender();return;}
  fail(error.status===503?'Layanan berkas sedang terganggu. Informasi surat tetap dapat dibaca; coba pratinjau lagi nanti.':error.status?error.message:'Sambungkan internet untuk membuka pratinjau.');return;
 }
 if(token!==V.token)return;
 const bytes=decode(data.data);V.label=label;V.size=data.size;
 try{
  if(data.mime==='application/pdf'){
   const lib=await pdfjs();if(token!==V.token)return;
   const pdf=await lib.getDocument({data:bytes,isEvalSupported:false,useSystemFonts:false,standardFontDataUrl:'/app/assets/vendor/pdfjs/standard_fonts/',disableAutoFetch:true,disableStream:true}).promise;
   if(token!==V.token){pdf.destroy();return;}
   Object.assign(V,{pdf,kind:'pdf',pages:pdf.numPages,page:1,zoom:1});
  }else Object.assign(V,{url:URL.createObjectURL(new Blob([bytes],{type:data.mime})),kind:'image',zoom:1});
  await drawViewer();
 }catch(error){fail(error?.name==='PasswordException'?'PDF ini dikunci kata sandi sehingga tidak dapat dipratinjau.':'Berkas tidak dapat ditampilkan sebagai pratinjau di perangkat ini.');}
}
async function downloadOriginal(documentId,versionId){
 try{
  const data=await api(`archives/${encodeURIComponent(R.id)}/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/download`);
  saveBlob(new Blob([decode(data.data)],{type:data.mime}),data.filename);
 }catch(error){
  if([403,404].includes(error.status)){toast(error.message,true);await rerender();return;}
  throw error;
 }
}

/* ---------- Pemilih pegawai (Humas dan administrator) ---------- */
function userPicker(label='Pegawai'){
 return `<div class="field full archive-picker" data-picker><span>${esc(label)}</span><div class="archive-picker-row"><input type="search" data-picker-query maxlength="60" placeholder="Ketik minimal 2 huruf nama atau username" aria-label="Cari ${esc(label.toLowerCase())}"><button type="button" class="button outlined" data-picker-search>${icon('search')}<span>Cari</span></button></div>
  <div class="archive-picker-results" data-picker-results role="radiogroup" aria-label="Hasil pencarian"></div><input type="hidden" name="target_user_id"></div>`;
}
function bindPicker(root,onPick=()=>{}){
 const box=root.querySelector('[data-picker]');if(!box)return;
 const query=box.querySelector('[data-picker-query]'),results=box.querySelector('[data-picker-results]'),hidden=box.querySelector('[name=target_user_id]');
 const search=async()=>{
  const q=query.value.trim();hidden.value='';onPick(null);
  if(q.length<2){results.innerHTML='<p class="muted text-small">Ketik minimal 2 huruf.</p>';return;}
  results.innerHTML='<p class="muted text-small">Mencari…</p>';
  try{
   const {users}=await api(`archives/lookups?kind=users&q=${encodeURIComponent(q)}`);
   results.innerHTML=users.length?users.map(u=>`<label class="check-field"><input type="radio" name="picked_user" value="${esc(u.id)}" data-name="${esc(u.name)}"><span><strong>${esc(u.name)}</strong> <span class="muted text-small">${esc(u.note||'')}</span></span></label>`).join(''):'<p class="muted text-small">Tidak ada pengguna aktif yang cocok.</p>';
  }catch(error){results.innerHTML=`<p class="form-error">${esc(error.message)}</p>`;}
 };
 box.querySelector('[data-picker-search]').addEventListener('click',search);
 query.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();search();}});
 results.addEventListener('change',event=>{if(event.target.name==='picked_user'){hidden.value=event.target.value;onPick({id:event.target.value,name:event.target.dataset.name});}});
}
const needUser=data=>{if(!data.target_user_id)throw new Error('Cari lalu pilih pegawai terlebih dahulu.');return data.target_user_id;};

/* ---------- Dialog tindakan ---------- */
function editDialog(){
 const a=R.detail.archive;
 formDialog('Ubah informasi surat',`<label class="field"><span>Arah surat</span><select name="direction" required>${Object.entries(directionLabel).map(([k,v])=>option(k,v,a.direction)).join('')}</select></label>
  <label class="field"><span>Jenis dokumen</span><select name="document_type_id" required>${typeOptions(a.document_type_id,{activeOnly:true})}</select></label>
  <label class="field"><span>Nomor surat <span class="muted">(opsional)</span></span><input name="official_number" value="${esc(a.official_number||'')}" maxlength="${R.overview.limits.number_max}" autocomplete="off"></label>
  ${input('Tanggal surat','letter_date','date',a.letter_date,'required')}${area('Perihal','subject',`required maxlength="${R.overview.limits.subject_max}" rows="3"`,a.subject)}`,
  async b=>{R.detail=await patch(`archives/${encodeURIComponent(a.id)}`,{expected_row_version:a.row_version,direction:b.direction,document_type_id:b.document_type_id,official_number:b.official_number.trim()||null,letter_date:b.letter_date,subject:b.subject.trim()});toast('Informasi surat diperbarui.');await rerender();},
  {note:'Nomor agenda, bagian pemilik, dan waktu pengarsipan tidak dapat diubah. Perubahan dicatat sebelum dan sesudahnya dalam riwayat.'});
}
function fileDialog(title,{reason=false,note,submit,send}){
 const key=operationKey();
 formDialog(title,`<label class="field full"><span>Berkas (PDF, JPG, JPEG, atau PNG; maksimal 10 MB)</span><input type="file" name="file" accept="${ACCEPT}" required></label>${reason?area('Alasan penggantian','change_reason','required maxlength="300" rows="2"'):''}`,
  async(b,form)=>{const file=form.elements.file.files[0];if(!file)throw new Error('Pilih berkas terlebih dahulu.');const id=await uploadOnce(file);await send(id,b,key);await rerender();},{note,submit});
}
function reasonDialog(title,label,{note='',submit='Simpan',max=500,optional=false,extra='',send}){
 formDialog(title,`${extra}${area(label,'reason',`${optional?'':'required'} maxlength="${max}" rows="3"`)}`,async b=>{await send((b.reason||'').trim(),b);},{note,submit});
}
function classifyDialog(){
 const a=R.access.archive,target=a.classification==='RAHASIA'?'BIASA':'RAHASIA';
 reasonDialog(`Ubah klasifikasi menjadi ${target==='RAHASIA'?'Rahasia':'Biasa'}`,'Alasan perubahan klasifikasi',{max:300,submit:'Simpan Perubahan',note:impactText(target),
  extra:`<div class="field full"><span>Klasifikasi saat ini</span><p class="archive-static">${a.classification==='RAHASIA'?'Rahasia':'Biasa'} → ${target==='RAHASIA'?'Rahasia':'Biasa'}</p></div>`,
  send:async reason=>{await post(`archives/${encodeURIComponent(a.id)}/classification`,{target,reason,expected_row_version:a.row_version});toast(`Klasifikasi diubah menjadi ${target==='RAHASIA'?'Rahasia':'Biasa'}.`);await rerender();}});
}
function shareDialog(){
 const id=R.detail.archive.id;
 const el=formDialog('Bagikan arsip',`<fieldset class="field full archive-choice"><legend>Penerima akses</legend><label class="check-field"><input type="radio" name="kind" value="USER" checked><span>Pegawai tertentu</span></label><label class="check-field"><input type="radio" name="kind" value="UNIT"><span>Satu bagian</span></label></fieldset>
  <div class="full" data-share-user>${userPicker('Pegawai penerima akses')}<label class="check-field"><input type="checkbox" name="notify_user" checked><span>Kirim notifikasi portal kepada pegawai ini</span></label></div>
  <div class="full" data-share-unit hidden><label class="field"><span>Bagian penerima akses</span><select name="target_unit_id"><option value="">Pilih bagian…</option></select></label>
   <fieldset class="field full archive-choice"><legend>Penerima notifikasi <span class="muted">(pilih pegawai yang memang dituju; boleh kosong)</span></legend><div data-share-members class="archive-picker-results"><p class="muted text-small">Pilih bagian untuk melihat anggotanya.</p></div></fieldset></div>
  ${area('Catatan (opsional)','reason','maxlength="300" rows="2"')}`,
  async b=>{
   const body={purpose:'BIASA_SHARE',reason:(b.reason||'').trim()||null};
   if(b.kind==='UNIT'){if(!b.target_unit_id)throw new Error('Pilih bagian penerima akses.');body.target_unit_id=b.target_unit_id;body.notify_user_ids=b.notify||[];}
   else{body.target_user_id=needUser(b);body.notify_user_ids=b.notify_user?[b.target_user_id]:[];}
   R.access=await post(`archives/${encodeURIComponent(id)}/grants`,body);
   toast(body.notify_user_ids.length?`Arsip dibagikan. ${body.notify_user_ids.length} pegawai diberi notifikasi portal.`:'Arsip dibagikan tanpa notifikasi.');await rerender();
  },{wide:true,submit:'Bagikan',note:'Penerima hanya dapat membaca dan akses berlaku sampai dicabut. Berbagi ke bagian memberi akses kepada seluruh anggotanya, tetapi notifikasi hanya dikirim kepada pegawai yang Anda pilih. Tidak ada email yang dikirim.'});
 bindPicker(el);
 const userBox=el.querySelector('[data-share-user]'),unitBox=el.querySelector('[data-share-unit]'),select=el.querySelector('[name=target_unit_id]'),members=el.querySelector('[data-share-members]');
 el.addEventListener('change',async event=>{
  if(event.target.name==='kind'){
   const unit=event.target.value==='UNIT';userBox.hidden=unit;unitBox.hidden=!unit;
   if(unit&&select.options.length===1){try{const {units}=await api('archives/lookups?kind=units');select.insertAdjacentHTML('beforeend',units.map(u=>option(u.id,u.name,'')).join(''));}catch(error){toast(error.message,true);}}
  }
  if(event.target===select){
   members.innerHTML=select.value?'<p class="muted text-small">Memuat anggota…</p>':'<p class="muted text-small">Pilih bagian untuk melihat anggotanya.</p>';
   if(!select.value)return;
   try{const {users}=await api(`archives/lookups?kind=unit-members&unit=${encodeURIComponent(select.value)}`);
    members.innerHTML=users.length?users.map(u=>`<label class="check-field"><input type="checkbox" name="notify[]" value="${esc(u.id)}"><span><strong>${esc(u.name)}</strong> <span class="muted text-small">${esc(u.note||'')}</span></span></label>`).join(''):'<p class="muted text-small">Bagian ini belum memiliki anggota dengan akun aktif.</p>';
   }catch(error){members.innerHTML=`<p class="form-error">${esc(error.message)}</p>`;}
  }
 });
}
function grantDialog(purpose){
 const id=R.detail.archive.id,rahasia=purpose==='RAHASIA_READ';
 const el=formDialog(rahasia?'Beri izin baca Rahasia':'Beri izin unduh',`${userPicker('Pegawai penerima izin')}
  ${rahasia?`<fieldset class="field full archive-choice"><legend>Masa berlaku</legend><label class="check-field"><input type="radio" name="period" value="PERMANENT" checked><span>Sampai dicabut</span></label><label class="check-field"><input type="radio" name="period" value="UNTIL"><span>Sampai waktu tertentu (WITA)</span></label><input type="datetime-local" name="expires_at" aria-label="Berlaku sampai (WITA)" disabled></fieldset>`:''}
  ${area('Alasan pemberian izin','reason','required maxlength="300" rows="2"')}`,
  async b=>{
   const body={purpose,target_user_id:needUser(b),reason:b.reason.trim()};
   if(rahasia&&b.period==='UNTIL'){if(!b.expires_at)throw new Error('Isi batas waktu izin.');body.expires_at=new Date(`${b.expires_at}:00+08:00`).toISOString();}
   R.access=await post(`archives/${encodeURIComponent(id)}/grants`,body);toast(rahasia?'Izin baca Rahasia diberikan.':'Izin unduh diberikan.');await rerender();
  },{wide:true,submit:'Beri izin',note:rahasia?'Izin baca Rahasia diberikan kepada pegawai bernama, untuk arsip ini saja. Izin berakhir tepat pada batas waktunya atau saat klasifikasi berubah. Izin ini tidak mencakup unduh.'
   :'Izin unduh berlaku untuk dokumen utama, lampiran, dan semua versinya pada arsip ini, sampai dicabut atau klasifikasi berubah. Izin ini hanya efektif selama penerima juga dapat membaca arsip. Humas pun perlu izin ini untuk mengunduh; pemberian kepada diri sendiri dicatat.'});
 bindPicker(el);
 el.addEventListener('change',event=>{if(event.target.name==='period'){const until=el.querySelector('[name=expires_at]');until.disabled=event.target.value!=='UNTIL';until.required=event.target.value==='UNTIL';}});
}
function typeDialog(type){
 formDialog(type?'Ubah jenis dokumen':'Tambah jenis dokumen',`${type?`<div class="field"><span>Kode</span><p class="archive-static">${esc(type.code)}</p></div>`:input('Kode (huruf kapital/angka, tidak dapat diubah)','code','text','','required maxlength="20" pattern="[A-Za-z0-9_\\-]{1,20}" autocomplete="off"')}${input('Nama jenis','name','text',type?.name||'','required maxlength="80" autocomplete="off"')}`,
  async b=>{R.types=(type?await patch(`archives/types/${encodeURIComponent(type.id)}`,{name:b.name.trim(),expected_row_version:type.row_version}):await post('archives/types',{code:b.code.trim(),name:b.name.trim()})).types;R.overview.types=R.types;toast(type?'Jenis dokumen diperbarui.':'Jenis dokumen ditambahkan.');await rerender();},
  {note:type?'Mengganti nama tidak mengubah nama jenis yang sudah tercatat pada arsip lama.':'Jenis baru langsung dapat dipilih pada arsip baru.'});
}
function officerDialog(){
 const units=R.officers.units;
 const el=formDialog('Tunjuk petugas arsip',`<label class="field full"><span>Bagian</span><select name="org_unit_id" required><option value="">Pilih bagian…</option>${units.map(u=>option(u.id,u.agenda_code?`${u.name} — kode agenda ${u.agenda_code}`:`${u.name} — belum ada kode agenda`,'')).join('')}</select></label>
  <label class="field full" data-code-field hidden><span>Kode agenda bagian (2–12 huruf kapital atau angka, mis. HMS)</span><input name="agenda_code" maxlength="12" pattern="[A-Za-z0-9]{2,12}" autocomplete="off"><small class="muted">Dipakai pada nomor agenda, misalnya HMS/2026/0001, dan tidak dapat diubah setelah arsip pertama tersimpan.</small></label>
  ${userPicker('Pegawai yang ditunjuk')}${input('Berlaku sampai (opsional, WITA)','expires_at','datetime-local','','')}${area('Dasar penunjukan','reason','required maxlength="300" rows="2" placeholder="Contoh: SK Kepala Badan nomor …"')}`,
  async b=>{
   const body={org_unit_id:b.org_unit_id,user_id:needUser(b),reason:b.reason.trim()};
   if(b.agenda_code)body.agenda_code=b.agenda_code.trim().toUpperCase();
   if(b.expires_at)body.expires_at=new Date(`${b.expires_at}:00+08:00`).toISOString();
   R.officers=await post('archives/officers',body);toast('Petugas arsip ditunjuk.');await refreshOverview();await rerender();
  },{wide:true,submit:'Tunjuk',note:'Petugas harus pegawai aktif yang ditempatkan pada bagian tersebut. Penunjukan berhenti berlaku sendiri bila pegawai pindah bagian, dan dapat dicabut tanpa menghapus riwayat.'});
 bindPicker(el);
 el.addEventListener('change',event=>{
  if(event.target.name!=='org_unit_id')return;
  const unit=units.find(u=>u.id===event.target.value),field=el.querySelector('[data-code-field]'),code=field.querySelector('input');
  field.hidden=!unit||Boolean(unit.agenda_code);code.required=!field.hidden;code.value=field.hidden?'':unit.suggested_code||'';
 });
}

/* ---------- Laporan ---------- */
function reportsTab(){
 const r=R.report,typed=['recap_period','recap_type'].includes(r.type);
 return `${card('Buat laporan','Rekap dan buku agenda mengikuti hak akses Anda. Laporan berisi metadata arsip, bukan berkas dokumennya.',`<form class="archive-filter-grid archive-report" data-arc-form="report">
  <label class="field"><span>Jenis laporan</span><select name="type">${Object.entries(reportLabel).map(([k,v])=>option(k,v,r.type)).join('')}</select></label>
  ${input('Diarsipkan dari','from','date',r.from,`required max="${localToday()}"`)}${input('Diarsipkan sampai','to','date',r.to,`required max="${localToday()}"`)}
  <label class="field"><span>Bagian</span><select name="unit_id">${unitOptions(r.unit_id)}</select></label>
  <label class="field" ${typed?'':'hidden'}><span>Jenis dokumen</span><select name="document_type_id">${typeOptions(r.document_type_id,{blank:'Semua jenis'})}</select></label>
  <div class="actions"><button type="submit" class="button primary" value="xlsx">${icon('download')}<span>Unduh XLSX</span></button><button type="submit" class="button outlined" value="pdf">${icon('download')}<span>Unduh PDF</span></button></div>
  <p class="form-error" role="alert"></p></form>`)}
 ${notice('Tentang isi laporan','Periode memakai tanggal pengarsipan; tanggal surat ditampilkan sebagai kolom. Arsip Rahasia tanpa izin baca hanya muncul dengan nomor agenda, tanggal pengarsipan, dan label Rahasia, dan tidak dimasukkan ke buku agenda masuk/keluar. Arsip yang dihapus tidak masuk laporan. Arah Internal hanya ada di rekap.','help')}`;
}
async function runReport(form,format){
 const data=Object.fromEntries(new FormData(form)),error=form.querySelector('.form-error');error.textContent='';
 Object.assign(R.report,{type:data.type,from:data.from,to:data.to,unit_id:data.unit_id,document_type_id:data.document_type_id||''});
 if(!data.from||!data.to||data.from>data.to){error.textContent='Tanggal awal harus sebelum atau sama dengan tanggal akhir.';return;}
 const body={type:data.type,format,from:data.from,to:data.to};
 if(data.unit_id)body.unit_id=data.unit_id;
 if(data.document_type_id&&['recap_period','recap_type'].includes(data.type))body.document_type_id=data.document_type_id;
 const report=await post('archives/reports',body);
 const rows=report.rows.map((row,index)=>({no:index+1,agenda:row.agenda_number,diarsipkan:row.archived_on,tanggal_surat:row.restricted?'':row.letter_date,arah:row.restricted?'':row.direction,jenis:row.restricted?'':row.document_type,nomor:row.restricted?'':row.official_number,perihal:row.restricted?'':row.subject,bagian:row.restricted?'':row.unit,klasifikasi:row.classification}));
 const made=`Dibuat ${stamp(report.generated_at)} WITA oleh ${report.requested_by}`,name=`e-arsip-${report.type.replace('_','-')}-${report.period.from}-sd-${report.period.to}.${format}`;
 if(format==='xlsx'){
  const col=(header,key,kind='text',width)=>({header,key,kind,width});
  const info=[{k:'Laporan',v:report.title},...report.filters.map(f=>({k:'Saringan',v:f})),{k:'Dibuat',v:made},{k:'Jumlah baris',v:String(report.total)},...report.groups.map(g=>({k:'Rekap',v:`${g.label}: ${g.count}`})),...report.notes.map(n=>({k:'Catatan',v:n}))];
  saveBlob(createXlsx([{name:'Laporan',columns:[col('No','no','number',6),col('Nomor agenda','agenda','text',18),col('Tanggal arsip','diarsipkan','date',15),col('Tanggal surat','tanggal_surat','date',15),col('Arah','arah','text',10),col('Jenis dokumen','jenis','text',20),col('Nomor surat','nomor','text',24),col('Perihal','perihal','notes',50),col('Bagian','bagian','text',24),col('Klasifikasi','klasifikasi','text',12)],rows},
   {name:'Keterangan',columns:[col('Butir','k','text',16),col('Isi','v','notes',90)],rows:info}]),name);
 }else{
  const {createReportPdf}=await import(moduleURL('archive-report-pdf.js'));
  const dateText=value=>value?formatDate(value):'';
  saveBlob(createReportPdf({title:report.title,footer:`SPH-Portal · E-Arsip · ${report.title}`,lines:[...report.filters,made,`Jumlah baris: ${report.total}`],summary:report.groups,notes:report.notes,
   columns:[{header:'No',key:'no',weight:.5},{header:'Nomor agenda',key:'agenda',weight:1.5},{header:'Tgl arsip',key:'diarsipkan',weight:1.1},{header:'Tgl surat',key:'tanggal_surat',weight:1.1},{header:'Arah',key:'arah',weight:.8},{header:'Jenis',key:'jenis',weight:1.4},{header:'Nomor surat',key:'nomor',weight:1.8},{header:'Perihal',key:'perihal',weight:4},{header:'Bagian',key:'bagian',weight:1.7},{header:'Klasifikasi',key:'klasifikasi',weight:1}],
   rows:rows.map(r=>({...r,no:String(r.no),diarsipkan:dateText(r.diarsipkan),tanggal_surat:dateText(r.tanggal_surat)}))}),name);
 }
 toast(`Laporan ${format.toUpperCase()} dibuat: ${number(report.total)} baris.`);
}

/* ---------- Pengajuan hapus, arsip dihapus, jenis, petugas ---------- */
function requestsTab(){
 const humas=R.overview.humas,rows=R.requests.items.map(r=>{
  const actions=r.status==='PENDING'?`${humas?`${link('Setujui','request-approve',`data-id="${esc(r.id)}"`)}${link('Tolak','request-reject',`data-id="${esc(r.id)}"`)}`:''}${r.mine?link('Batalkan','request-cancel',`data-id="${esc(r.id)}"`):''}`:'';
  return `<tr>${cell('Arsip',r.archive_deleted?`<strong>${esc(r.agenda_number)}</strong>`:rowLink({id:r.archive_id,agenda_number:r.agenda_number})+(r.subject?`<br><span class="muted text-small">${esc(r.subject)}</span>`:''))}${cell('Bagian',esc(r.unit))}${cell('Diajukan',`${esc(stamp(r.requested_at))}<br><span class="muted text-small">oleh ${esc(r.requested_by)}</span>`)}${cell('Alasan',esc(r.reason))}${cell('Status',`${pill(requestLabel[r.status],r.status==='PENDING'?'warm':r.status==='APPROVED'?'negative':'neutral')}${r.decided_at?`<br><span class="muted text-small">${esc(stamp(r.decided_at))} oleh ${esc(r.decided_by)}${r.decision_reason?` · ${esc(r.decision_reason)}`:''}</span>`:''}`)}${cell('Aksi',actions,'archive-action')}</tr>`;
 });
 return `<div class="leave-tabs archive-subtabs" role="tablist" aria-label="Status pengajuan">${[['PENDING','Menunggu'],['APPROVED','Disetujui'],['REJECTED','Ditolak'],['CANCELLED','Dibatalkan'],['ALL','Semua']].map(([key,label])=>`<button type="button" role="tab" aria-selected="${R.requestStatus===key}" class="chip ${R.requestStatus===key?'active':''}" data-arc="request-status" data-status="${key}">${label}</button>`).join('')}</div>
 ${card('Pengajuan penghapusan',humas?'Arsip tetap aktif sampai Anda memutuskan. Persetujuan menyembunyikan arsip; arsip dapat dipulihkan dari Arsip Dihapus.':'Pengajuan Anda kepada Humas. Arsip tetap aktif sampai Humas memutuskan.',table(['Arsip','Bagian','Diajukan','Alasan','Status','Aksi'],rows,'Tidak ada pengajuan pada status ini.'))}`;
}
function deletedTab(){
 const rows=R.deleted.items.map(a=>`<tr>${cell('Arsip',`<strong>${esc(a.agenda_number)}</strong><br><span class="muted text-small">${esc(a.subject)}</span>`)}${cell('Bagian',esc(a.unit.name))}${cell('Klasifikasi',classBadge(a.classification))}${cell('Dihapus',`${esc(stamp(a.deleted_at))}<br><span class="muted text-small">oleh ${esc(a.deleted_by)}</span>`)}${cell('Alasan',esc(a.delete_reason))}${cell('Aksi',link('Pulihkan','restore',`data-id="${esc(a.id)}" data-class="${esc(a.classification)}" data-agenda="${esc(a.agenda_number)}"`),'archive-action')}</tr>`);
 return `${notice('Arsip yang dihapus disembunyikan, tidak dimusnahkan','Berkas dan seluruh versinya tetap tersimpan. Selama dihapus, arsip tidak dapat dibuka, dipratinjau, diunduh, atau masuk laporan. Tidak ada penghapusan permanen atau pemusnahan otomatis.','trash')}
 ${card('Arsip dihapus','Hanya Humas yang melihat daftar ini.',table(['Arsip','Bagian','Klasifikasi','Dihapus','Alasan','Aksi'],rows,'Tidak ada arsip yang dihapus.'))}`;
}
function typesTab(){
 const rows=R.types.map(t=>`<tr class="${t.active?'':'muted'}">${cell('Kode',esc(t.code))}${cell('Nama',esc(t.name))}${cell('Status',pill(t.active?'Aktif':'Nonaktif',t.active?'positive':'neutral'))}${cell('Aksi',`${link('Ubah nama','type-edit',`data-id="${esc(t.id)}"`)}${link(t.active?'Nonaktifkan':'Aktifkan','type-toggle',`data-id="${esc(t.id)}"`)}`,'archive-action')}</tr>`);
 return card('Jenis dokumen','Jenis nonaktif tidak dapat dipilih untuk arsip baru, tetapi tetap terbaca pada arsip lama. Jenis tidak dapat dihapus.',table(['Kode','Nama','Status','Aksi'],rows,'Belum ada jenis dokumen.'));
}
function officersTab(){
 const o=R.officers;
 const rows=o.officers.map(r=>{const [label,tone]=officerStatus[r.status]||[r.status,'neutral'];
  return `<tr class="${r.revoked_at?'muted':''}">${cell('Petugas',`<strong>${esc(r.user.name)}</strong>`)}${cell('Bagian',esc(r.unit.name))}${cell('Berlaku',`${esc(stamp(r.valid_from))}<br><span class="muted text-small">${r.expires_at?`sampai ${esc(stamp(r.expires_at))}`:'sampai dicabut'}</span>`)}${cell('Dasar',`${esc(r.reason)}<br><span class="muted text-small">oleh ${esc(r.assigned_by)}</span>`)}${cell('Status',`${pill(label,tone)}${r.revoked_at?`<br><span class="muted text-small">${esc(stamp(r.revoked_at))}${r.revoke_reason?` · ${esc(r.revoke_reason)}`:''}</span>`:''}`)}${cell('Aksi',r.can_revoke?link('Cabut','officer-revoke',`data-id="${esc(r.id)}"`):'','archive-action')}</tr>`;});
 const codes=o.units.filter(u=>u.agenda_code).map(u=>`<tr>${cell('Bagian',esc(u.name))}${cell('Kode agenda',`<strong>${esc(u.agenda_code)}</strong>`)}${cell('Aksi',u.code_locked?'<span class="muted text-small">Sudah dipakai nomor agenda</span>':o.can_manage_codes?link('Ubah kode','unit-code',`data-id="${esc(u.id)}"`):'','archive-action')}</tr>`);
 return `${notice('Penunjukan petugas arsip','Petugas mengelola arsip bagiannya. Kepala Urusan dapat mencabut petugas di bawah urusannya; Super Admin dapat mengelola semua arsip dan penunjukan.','people')}
 ${card('Petugas arsip','Penunjukan berlaku per bagian.',table(['Petugas','Bagian','Berlaku','Dasar','Status','Aksi'],rows,'Belum ada petugas arsip. Mulai dengan Tunjuk petugas.'))}
 ${card('Kode agenda bagian','Awalan nomor agenda tiap bagian, misalnya HMS/2026/0001.',table(['Bagian','Kode agenda','Aksi'],codes,'Belum ada kode agenda. Kode ditetapkan saat petugas pertama suatu bagian ditunjuk.'))}`;
}

/* ---------- Ikatan peristiwa ---------- */
async function handle(action,el){
 const id=R.id?encodeURIComponent(R.id):null;
 if(action==='route'){go(el.dataset.route);return;}
 if(action==='open'){openArchive(el.dataset.id);return;}
 if(action==='back'){go('archive-list');return;}
 if(action==='section'){R.section=el.dataset.section;history.replaceState(null,'',`#archive-list?id=${id}${R.section==='documents'?'':`&view=${R.section}`}`);await rerender();return;}
 if(action==='filter-reset'){R.filters=freshFilters();await rerender();return;}
 if(action==='more'){const next=await api(`archives?${listQuery(R.list.next_cursor)}`);R.list={...next,items:[...R.list.items,...next.items]};document.querySelector('#archive-content').innerHTML=listTab();return;}
 if(action==='notifications-read'){await post('archives/notifications/read',{all:true});await refreshOverview();await rerender();return;}
 if(action==='preview'){document.querySelector('#archive-viewer')?.scrollIntoView({block:'nearest',behavior:'smooth'});await openPreview(el.dataset.document,el.dataset.version,el.dataset.label);return;}
 if(action==='download'){await downloadOriginal(el.dataset.document,el.dataset.version);return;}
 if(['viewer-prev','viewer-next','viewer-in','viewer-out'].includes(action)){
  if(action==='viewer-prev'&&V.page>1)V.page--;if(action==='viewer-next'&&V.page<V.pages)V.page++;
  if(action==='viewer-in')V.zoom=Math.min(3,Math.round((V.zoom+0.25)*100)/100);if(action==='viewer-out')V.zoom=Math.max(0.5,Math.round((V.zoom-0.25)*100)/100);
  await drawViewer();return;
 }
 if(action==='edit'){editDialog();return;}
 if(action==='attachment-add'){const a=R.detail.archive;fileDialog('Tambah lampiran',{submit:'Tambahkan',note:'Lampiran baru langsung tersimpan pada arsip ini.',send:async(fileId,_,key)=>{await post(`archives/${id}/documents`,{file_id:fileId,idempotency_key:key,expected_row_version:a.row_version});toast('Lampiran ditambahkan.');}});return;}
 if(action==='replace'){const a=R.detail.archive,doc=el.dataset.document;fileDialog('Ganti berkas',{reason:true,submit:'Simpan versi baru',note:'Berkas lama tidak ditimpa: tersimpan sebagai versi sebelumnya dan tetap dapat dibuka oleh yang berwenang.',send:async(fileId,b,key)=>{await post(`archives/${id}/documents/${encodeURIComponent(doc)}/versions`,{file_id:fileId,change_reason:b.change_reason.trim(),idempotency_key:key,expected_row_version:a.row_version});toast('Versi baru tersimpan.');}});return;}
 if(action==='remove-attachment'){const a=R.detail.archive,doc=el.dataset.document;reasonDialog('Lepas lampiran','Alasan melepas lampiran',{max:300,submit:'Lepas lampiran',note:'Lampiran disembunyikan dari arsip; riwayat versinya tetap tersimpan.',send:async reason=>{await post(`archives/${id}/documents/${encodeURIComponent(doc)}/remove`,{reason,expected_row_version:a.row_version});toast('Lampiran dilepas.');await rerender();}});return;}
 if(action==='delete-request'){reasonDialog('Ajukan penghapusan','Alasan penghapusan',{submit:'Ajukan ke Humas',note:'Arsip tetap aktif sampai Humas memutuskan. Bila disetujui, arsip akan disembunyikan dan dapat dipulihkan Humas.',send:async reason=>{await post(`archives/${id}/delete-requests`,{reason});toast('Pengajuan penghapusan dikirim ke Humas.');await rerender();}});return;}
 if(action==='delete-cancel'||action==='request-cancel'){if(!confirm('Batalkan pengajuan penghapusan ini?'))return;await post(`archives/delete-requests/${encodeURIComponent(el.dataset.id)}/cancel`,{});toast('Pengajuan dibatalkan.');await rerender();return;}
 if(action==='delete-direct'){reasonDialog('Hapus arsip','Alasan penghapusan',{submit:'Hapus arsip',extra:input('Rujukan pengajuan (mis. pesan WhatsApp petugas, tanggal)','reference','text','','required maxlength="300" autocomplete="off"').replace('class="field"','class="field full"'),
  note:'Arsip akan disembunyikan dan dapat dipulihkan; berkas tidak dihapus. Izin baca Rahasia dan izin unduh arsip ini berakhir.',send:async(reason,b)=>{await post(`archives/${id}/delete`,{reason,reference:b.reference.trim()});toast('Arsip dihapus dan dapat dipulihkan dari Arsip Dihapus.');await refreshOverview();go('archive-deleted');}});return;}
 if(action==='classify'){classifyDialog();return;}
 if(action==='grant-share'){shareDialog();return;}
 if(action==='grant-rahasia'){grantDialog('RAHASIA_READ');return;}
 if(action==='grant-download'){grantDialog('DOWNLOAD');return;}
 if(action==='grant-revoke'){reasonDialog('Cabut izin','Alasan pencabutan (opsional)',{optional:true,max:300,submit:'Cabut',note:'Pencabutan berlaku pada permintaan berikutnya dari penerima.',send:async reason=>{R.access=await post(`archives/${id}/grants/${encodeURIComponent(el.dataset.id)}/revoke`,{reason:reason||null});toast('Izin dicabut.');await rerender();}});return;}
 if(action==='request-status'){R.requestStatus=el.dataset.status;await rerender();return;}
 if(action==='request-approve'||action==='request-reject'){
  const approve=action==='request-approve';
  reasonDialog(approve?'Setujui penghapusan':'Tolak penghapusan','Alasan keputusan',{submit:approve?'Setujui dan hapus arsip':'Tolak pengajuan',note:approve?'Arsip akan disembunyikan dan dapat dipulihkan; berkas tidak dihapus.':'Arsip tetap aktif.',
   send:async reason=>{await post(`archives/delete-requests/${encodeURIComponent(el.dataset.id)}/decide`,{decision:approve?'APPROVE':'REJECT',reason});toast(approve?'Pengajuan disetujui. Arsip dihapus.':'Pengajuan ditolak.');await refreshOverview();await rerender();}});return;
 }
 if(action==='restore'){
  const secret=el.dataset.class==='RAHASIA';
  reasonDialog(`Pulihkan arsip ${el.dataset.agenda}`,'Alasan pemulihan',{submit:'Pulihkan',note:secret?'Arsip kembali aktif sebagai Rahasia dengan nomor agenda dan versi yang sama. Izin baca Rahasia dan izin unduh lama sudah berakhir; berikan ulang yang masih diperlukan.':'Arsip kembali aktif dengan nomor agenda dan versi yang sama. Pegawai bagian pemilik dan penerima berbagi yang belum dicabut kembali dapat membacanya. Izin unduh lama sudah berakhir; berikan ulang bila perlu.',
   send:async reason=>{const result=await post(`archives/deleted/${encodeURIComponent(el.dataset.id)}/restore`,{reason});toast(`Arsip ${result.agenda_number} dipulihkan.`);openArchive(result.id,'access');}});return;
 }
 if(action==='type-new'){typeDialog(null);return;}
 if(action==='type-edit'){typeDialog(R.types.find(t=>t.id===el.dataset.id));return;}
 if(action==='type-toggle'){const type=R.types.find(t=>t.id===el.dataset.id);if(type.active&&!confirm(`Nonaktifkan jenis "${type.name}"? Arsip lama tetap terbaca; jenis ini tidak dapat dipilih untuk arsip baru.`))return;
  R.types=(await patch(`archives/types/${encodeURIComponent(type.id)}`,{is_active:!type.active,expected_row_version:type.row_version})).types;R.overview.types=R.types;toast(type.active?'Jenis dinonaktifkan.':'Jenis diaktifkan.');await rerender();return;}
 if(action==='officer-new'){officerDialog();return;}
 if(action==='officer-revoke'){reasonDialog('Cabut penunjukan petugas','Alasan pencabutan',{max:300,submit:'Cabut penunjukan',note:'Penunjukan sebagai petugas bagian ini dicabut. Hak dari role lain tetap berlaku. Arsip dan riwayat yang sudah ada tetap tersimpan.',send:async reason=>{R.officers=await post(`archives/officers/${encodeURIComponent(el.dataset.id)}/revoke`,{reason});toast('Penunjukan dicabut.');await rerender();}});return;}
 if(action==='unit-code'){const unit=R.officers.units.find(u=>u.id===el.dataset.id);formDialog(`Kode agenda ${unit.name}`,input('Kode agenda (2–12 huruf kapital atau angka)','agenda_code','text',unit.agenda_code,'required maxlength="12" pattern="[A-Za-z0-9]{2,12}" autocomplete="off"'),async b=>{R.officers=await post('archives/units',{org_unit_id:unit.id,agenda_code:b.agenda_code.trim().toUpperCase()});toast('Kode agenda diperbarui.');await refreshOverview();await rerender();},{note:'Kode hanya dapat diubah sebelum arsip pertama bagian ini tersimpan.'});return;}
}
export function bindArchivesPage(){
 const root=document.querySelector('#main');if(!root||root.dataset.archivesBound)return;root.dataset.archivesBound='1';
 afterDetail();
 root.addEventListener('click',async event=>{
  const el=event.target.closest('[data-arc]');if(!el||!archiveRoutes.includes(state.route)||el.closest('dialog'))return;
  if(el.disabled)return;el.disabled=true;
  try{await handle(el.dataset.arc,el);}
  catch(error){
   // Konflik versi: data sudah diubah orang lain. Tampilkan keadaan terbaru.
   if(error.status===409&&R.id){toast(error.message,true);await rerender().catch(()=>{});}
   else toast(error.status?error.message:error.message||'Sambungkan internet untuk membuka arsip.',true);
  }
  finally{if(el.isConnected)el.disabled=false;}
 });
 root.addEventListener('submit',async event=>{
  const form=event.target.closest('[data-arc-form]');if(!form)return;event.preventDefault();
  if(form.dataset.busy)return;
  try{
   const kind=form.dataset.arcForm;
   if(kind==='search'){R.filters.q=new FormData(form).get('q').trim();await rerender();return;}
   if(kind==='filter'){
    const data=Object.fromEntries(new FormData(form));
    if(data.from&&data.to&&data.from>data.to)throw new Error('Tanggal arsip awal harus sebelum tanggal akhir.');
    if(data.letter_from&&data.letter_to&&data.letter_from>data.letter_to)throw new Error('Tanggal surat awal harus sebelum tanggal akhir.');
    Object.assign(R.filters,{from:data.from,to:data.to,unit:data.unit,type:data.type,direction:data.direction,classification:data.classification,letter_from:data.letter_from,letter_to:data.letter_to,shared:form.elements.shared.checked});
    await rerender();return;
   }
   if(kind==='create'){await submitCreate(form);return;}
   if(kind==='report'){
    const buttons=[...form.querySelectorAll('[type=submit]')];buttons.forEach(b=>b.disabled=true);form.dataset.busy='1';
    try{await runReport(form,event.submitter?.value==='pdf'?'pdf':'xlsx');}finally{buttons.forEach(b=>b.disabled=false);delete form.dataset.busy;}
   }
  }catch(error){toast(error.status?error.message:error.message||'Sambungkan internet untuk membuka arsip.',true);}
 });
 root.addEventListener('change',event=>{
  const form=event.target.closest('[data-arc-form]');if(!form)return;
  if(form.dataset.arcForm==='create'&&event.target.type==='file'){form.querySelector('[data-arc-files]').innerHTML=fileList(formFiles(form));form.querySelector('.form-error').textContent='';}
  if(form.dataset.arcForm==='report'&&event.target.name==='type'){const field=form.querySelector('[name=document_type_id]').closest('.field');field.hidden=!['recap_period','recap_type'].includes(event.target.value);}
 });
}
export function resetArchives(){closeViewer();Object.assign(R,{owner:null,overview:null,detail:null,list:null,dashboard:null,notifications:null,access:null,history:null,officers:null,deleted:null,requests:null,types:null,uploads:new Map(),keys:new Map()});probe=null;state.archivesReady=undefined;state.archives=null;state.archivesAt=0;}

// Lonceng: notifikasi berbagi/ringkasan harian yang belum dibaca, dan pengajuan hapus yang menunggu Humas.
export function archiveNotices(){
 const o=state.archivesReady===true?state.archives:null,items=[];if(!o)return items;
 if(o.unread)items.push({route:'archives',count:o.unread,title:'Notifikasi E-Arsip',note:o.humas?'Ringkasan harian atau arsip yang dibagikan':'Arsip yang dibagikan kepada Anda',ico:'folder'});
 if(o.humas&&o.pending_delete_requests)items.push({route:'archive-requests',count:o.pending_delete_requests,title:'Pengajuan hapus arsip',note:'Menunggu keputusan Humas',ico:'trash'});
 return items;
}

// Pengaman rilis: menu E-Arsip hanya tampil bila server sudah memiliki rute arsip (migrasi
// + tambalan portal-api). Sebelum itu rute menjawab 404 dan menu disembunyikan. Hasilnya
// disimpan per sesi; galat sementara tidak disimpan sehingga pemeriksaan diulang.
// Ruang kerja Humas tampil bila rute arsip sudah siap di server dan akun dapat memakainya.
export const archivesReadyFor=()=>state.archivesReady===true&&archivesEligible();
export function archivesAllowed(kind){
 const o=state.archives;if(!archivesReadyFor()||!o)return false;
 if(kind==='home')return true;
 if(kind==='officer')return o.officer_units.length>0;
 if(kind==='requests')return o.humas||o.officer_units.length>0;
 if(kind==='humas')return o.humas;
 if(kind==='officers')return Boolean(o.officer_management||o.admin);
 return false;
}
export const archivesEligible=()=>Boolean(state.me?.user.employee_id||state.permissions.some(p=>p.startsWith('archives.')));
let probe=null;
export function probeArchives(){
 if(state.archivesReady!==undefined)return Promise.resolve(state.archivesReady);
 if(!probe){
  const session=state.me;
  probe=api('archives/overview',{background:true}).then(overview=>{if(state.me===session){state.archives=overview;state.archivesAt=Date.now();}return true;},error=>error?.status===404?false:undefined)
   .then(ready=>{if(state.me===session)state.archivesReady=ready;probe=null;return ready===true;});
 }
 return probe;
}
// Sebelum rute E-Arsip diputuskan: ambil hak terbaru, supaya menu dan rute mengikuti
// perubahan sejak halaman dibuka (mis. baru ditunjuk sebagai petugas arsip).
export async function refreshArchivesForRoute(){
 if(!archivesEligible())return;
 if(state.archivesReady===undefined){await probeArchives();return;}
 if(state.archivesReady!==true)return;
 const session=state.me,overview=await api('archives/overview');
 if(state.me===session){state.archives=overview;state.archivesAt=Date.now();}
}
// Ringkasan untuk lonceng, paling sering sekali semenit.
export async function loadArchiveSummary({background=true}={}){
 if(!archivesEligible())return false;
 if(state.archivesReady===undefined)return probeArchives();
 if(state.archivesReady!==true||Date.now()-(state.archivesAt||0)<60000)return false;
 const session=state.me;state.archivesAt=Date.now();
 const overview=await api('archives/overview',{background});
 if(state.me===session)state.archives=overview;
 return true;
}
