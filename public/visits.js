import {api,post,permitted,refresh,state} from './api.js';
import {esc,icon,toast,dialog,formDialog,localToday,formatDate,formatTime,number} from './ui.js';
import {createXlsx} from './xlsx-export.js';
import {encodeQR} from './vendor/qr.js';

// Ruang kerja Pengelolaan Kunjungan. Penilaian guide dan data guide tinggal di
// Google Spreadsheet NilaiGuide; angka dibaca lewat jembatan berkunci, jadi
// halaman ini tidak pernah menampilkan angka lama seolah-olah terkini (ATR-RK-12).
export const visitTitles={
 visits:'Dashboard Kunjungan',
 'visits-guides':'Data Guide',
 'visits-records':'Penilaian Guide',
 'visits-links':'Tautan Pos',
 'visits-reports':'Laporan & Ekspor Kunjungan'
};
export const visitRoutes=Object.keys(visitTitles);
export const visitNav=[
 ['visits','Dashboard','dashboard','visits.dashboard.read'],
 ['visits-guides','Data Guide','people','visits.guides.read'],
 ['visits-records','Penilaian','log','visits.records.read'],
 ['visits-links','Tautan Pos','key','visits.forms.read'],
 ['visits-reports','Laporan & Ekspor','document','visits.reports.read']
];
const firstOfMonth=()=>localToday().slice(0,8)+'01';
const M={from:firstOfMonth(),to:localToday(),month:localToday().slice(0,7),overview:null,activity:null,guides:[],guideQuery:'',guideKategori:'',guideRegu:'',guideAktif:'1',
 records:[],recordsMore:false,recordsTotal:0,recordFilter:{pos:'',regu:'',status:''},links:null,health:null,reviews:null,report:null};
const regu=['A1','A2','D1','D2'];
const head=(title,note,actions='')=>`<div class="page-heading"><div><h1>${esc(title)}</h1><p>${esc(note)}</p></div><div class="actions">${actions}</div></div>`;
const btn=(label,visit,ico='plus',kind='primary',extra='')=>`<button type="button" class="button ${kind}" data-visit="${visit}" ${extra}>${icon(ico)}<span>${esc(label)}</span></button>`;
const card=(title,sub,body,actions='')=>`<section class="card"><header class="card-header"><div><h2>${esc(title)}</h2>${sub?`<p>${esc(sub)}</p>`:''}</div>${actions?`<div class="actions">${actions}</div>`:''}</header>${body}</section>`;
const table=(heads,rows,empty='Belum ada data sesuai saringan.')=>`<div class="table-wrap"><table><thead><tr>${heads.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td colspan="${heads.length}" class="muted">${esc(empty)}</td></tr>`}</tbody></table></div>`;
const stat=(label,value,detail='')=>`<section class="stat-card visit-stat"><div class="stat-top"><span>${esc(label)}</span></div><div class="stat-value">${value==null?'—':esc(String(value))}</div>${detail?`<div class="stat-bottom"><span>${esc(detail)}</span></div>`:''}</section>`;
const pct=v=>v==null?'—':`${(v*100).toLocaleString('id-ID',{maximumFractionDigits:1})}%`;
const dec=(v,d=2)=>v==null?'—':Number(v).toLocaleString('id-ID',{minimumFractionDigits:d,maximumFractionDigits:d});
const signed=v=>v>0?`+${v}`:String(v);
const uniformLabel={'-1':'Tidak sesuai','1':'Sesuai','2':'Bagus'};
const when=t=>t?`${formatDate(t)} ${formatTime(t)}`:'—';
const range=()=>`from=${M.from}&to=${M.to}`;
const filters=(extra='')=>`<div class="toolbar"><label class="field"><span>Dari tanggal</span><input type="date" data-visit-field="from" value="${esc(M.from)}" max="${localToday()}"></label><label class="field"><span>Sampai tanggal</span><input type="date" data-visit-field="to" value="${esc(M.to)}" max="${localToday()}"></label>${extra}${btn('Terapkan','apply','filter','outlined')}</div>`;
function unavailable(title,error){
 return `${head(title,'Data dibaca langsung dari Google Spreadsheet penilaian guide.')}<div class="notice warning">${icon('incident')}<div><strong>${esc(error?.status===403?'Akses ditolak':'Spreadsheet sedang tidak dapat diakses')}</strong><p>${esc(error?.message||'Coba lagi beberapa saat lagi.')}</p><p class="muted">Angka tidak ditampilkan sampai spreadsheet dapat dibaca, supaya tidak ada angka lama yang tampak terkini.</p></div></div><div class="actions">${btn('Coba lagi','retry','refresh','outlined')}</div>`;
}

/* ---------- Dashboard ---------- */
function rankTable(title,rows,metric){
 const value=r=>metric==='taat'?pct(r.taat):metric==='etika'?dec(r.rataEtika):metric==='review'?number(r.review):metric==='antar'?number(r.antar):dec(r.rataTotal);
 const label={total:'Rata-rata total',taat:'Taat Uniform & ID',etika:'Rata-rata Etika',review:'REVIEW',antar:'Pengantaran'}[metric];
 return card(title,'',table(['#','Guide','Regu','Pengantaran',label],rows.map((r,i)=>`<tr><td>${i+1}</td><td><strong>${esc(r.nama)}</strong><br><span class="muted text-small">${esc(r.guideId)}</span></td><td>${esc(r.regu)}</td><td>${number(r.antar)}</td><td><strong>${value(r)}</strong></td></tr>`),'Belum ada guide yang memenuhi.'));
}
function dashboard(){
 const d=M.overview,s=d.ringkasan,p=d.peringkat;
 const activity=(M.activity?.items||[]).map(a=>`<tr><td>${esc(a.label)}</td><td>${a.last_received_at?when(a.last_received_at):'Belum ada kiriman'}</td><td>${number(a.accepted_24h)}</td><td>${number(a.rejected_24h)}</td></tr>`);
 return `${head('Dashboard Kunjungan',`Penilaian guide ${formatDate(d.from)} – ${formatDate(d.to)}. Dihitung dengan fungsi rekap yang sama dengan tab Dasbor spreadsheet.`)}${filters()}
 <div class="stats-grid">${stat('Pengantaran',number(s.pengantaran),`${number(s.hariDinilai)} hari berpenilaian`)}${stat('Guide dinilai',number(s.guideDinilai),`dari ${number(s.guideAktif)} guide aktif`)}${stat('Taat Uniform',pct(s.persenUniform),'Sesuai atau Bagus')}${stat('Taat ID-Card',pct(s.persenId))}${stat('Mutu Uniform',dec(s.mutuUniform),'skala −1 sampai +2')}${stat('Rata-rata Etika',dec(s.rataEtika),'skala −5 sampai +5')}</div>
 <div class="visit-grid">${card('Per pos','',table(['Pos','Pengantaran','Guide','% Uniform','% ID','Rata Etika'],d.perPos.map(r=>`<tr><td>Pos ${esc(r.pos)}</td><td>${number(r.pengantaran)}</td><td>${number(r.guideDinilai)}</td><td>${pct(r.persenUniform)}</td><td>${pct(r.persenId)}</td><td>${dec(r.rataEtika)}</td></tr>`)))}
 ${card('Per regu','',table(['Regu','Kategori','Pengantaran','% Uniform','% ID','Rata Etika'],d.perRegu.map(r=>`<tr><td>${esc(r.regu)}</td><td>${esc(r.kategori)}</td><td>${number(r.pengantaran)}</td><td>${pct(r.persenUniform)}</td><td>${pct(r.persenId)}</td><td>${dec(r.rataEtika)}</td></tr>`)))}</div>
 ${M.activity?card('Kiriman dari HP pos','Kiriman terakhir yang diterima tiap pos dan jumlahnya dalam 24 jam terakhir.',table(['Pos','Kiriman terakhir','Diterima 24 jam','Ditolak 24 jam'],activity)):''}
 <p class="muted visit-note">Peringkat memakai rata-rata per pengantaran, minimal ${number(d.minimalPengantaran)} pengantaran (${number(d.diperingkat)} guide memenuhi, ${number(d.belumCukup)} belum). REVIEW diambil dari ketikan tim di tab Rekap regu${d.reviewTidakPasti?`; ${number(d.reviewTidakPasti)} REVIEW tidak bisa dipastikan pemiliknya`:''}. Diperbarui ${when(d.diperbarui)}.</p>
 <div class="visit-grid">${rankTable('Nilai total tertinggi',p.totalTertinggi,'total')}${rankTable('Nilai total terendah',p.totalTerendah,'total')}${rankTable('Paling taat Uniform & ID',p.taatTertinggi,'taat')}${rankTable('Paling tidak taat Uniform & ID',p.taatTerendah,'taat')}${rankTable('Etika tertinggi',p.etikaTertinggi,'etika')}${rankTable('Etika terendah',p.etikaTerendah,'etika')}${rankTable('REVIEW terbanyak',p.review,'review')}${rankTable(`Belum cukup pengantaran (< ${d.minimalPengantaran})`,p.belumCukup,'total')}</div>`;
}

/* ---------- Data Guide ---------- */
function guidesPage(){
 const manage=permitted('visits.guides.manage'),q=M.guideQuery.toLocaleLowerCase('id');
 const rows=M.guides.filter(g=>(!q||g.guideName.toLocaleLowerCase('id').includes(q)||g.guideId.toLowerCase().includes(q))&&(!M.guideKategori||g.kategori===M.guideKategori)&&(!M.guideRegu||g.regu.split(',').map(x=>x.trim()).includes(M.guideRegu))&&(M.guideAktif===''||String(Number(g.aktif))===M.guideAktif));
 const aktif=M.guides.filter(g=>g.aktif).length;
 return `${head('Data Guide',`${number(aktif)} guide aktif dari ${number(M.guides.length)}. Tersimpan di tab Guides spreadsheet; guide tidak dihapus, hanya dinonaktifkan.`,manage?btn('Tambah guide','guide-new'):'')}
 <div class="toolbar"><label class="field"><span>Cari</span><input data-visit-field="guideQuery" value="${esc(M.guideQuery)}" placeholder="Nama atau ID guide"></label>
 <label class="field"><span>Kategori</span><select data-visit-field="guideKategori"><option value="">Semua</option>${['Asing','Domestik'].map(k=>`<option ${M.guideKategori===k?'selected':''}>${k}</option>`).join('')}</select></label>
 <label class="field"><span>Regu</span><select data-visit-field="guideRegu"><option value="">Semua</option>${regu.map(r=>`<option ${M.guideRegu===r?'selected':''}>${r}</option>`).join('')}</select></label>
 <label class="field"><span>Status</span><select data-visit-field="guideAktif"><option value="" ${M.guideAktif===''?'selected':''}>Semua</option><option value="1" ${M.guideAktif==='1'?'selected':''}>Aktif</option><option value="0" ${M.guideAktif==='0'?'selected':''}>Nonaktif</option></select></label></div>
 ${table(['ID','Nama','Kategori','Regu','Status',...(manage?['']:[])],rows.map(g=>`<tr class="${g.aktif?'':'visit-dim'}"><td>${esc(g.guideId)}</td><td><strong>${esc(g.guideName)}</strong></td><td>${esc(g.kategori)}</td><td>${esc(g.regu)}</td><td>${g.aktif?'<span class="badge positive"><span class="status-dot"></span>Aktif</span>':'<span class="badge negative"><span class="status-dot"></span>Nonaktif</span>'}</td>${manage?`<td>${btn('Ubah','guide-edit','settings','text',`data-id="${esc(g.guideId)}"`)}</td>`:''}</tr>`),'Tidak ada guide yang cocok.')}`;
}
function guideForm(g){
 const reguOptions=kategori=>regu.filter(r=>(kategori==='Asing')===r.startsWith('A'));
 const current=g?.regu?g.regu.split(',').map(x=>x.trim()):[];
 const fields=`<label class="field full"><span>Nama guide</span><input name="guideName" maxlength="120" required value="${esc(g?.guideName||'')}"></label>
 <label class="field"><span>Kategori</span><select name="kategori" data-guide-kategori>${['Asing','Domestik'].map(k=>`<option ${g?.kategori===k?'selected':''}>${k}</option>`).join('')}</select></label>
 <label class="field"><span>Regu</span><select name="regu" data-guide-regu>${reguOptions(g?.kategori||'Asing').map(r=>`<option ${current.includes(r)?'selected':''}>${r}</option>`).join('')}</select></label>
 <label class="check-field"><input type="checkbox" name="aktif" ${!g||g.aktif?'checked':''}><span>Aktif — tampil di formulir pos</span></label>
 <p class="form-note full" data-guide-twin hidden></p>`;
 const el=formDialog(g?`Ubah ${g.guideId}`:'Tambah guide',fields,async data=>{
  const saved=await post('visits/guides',{...(g?{guideId:g.guideId}:{}),guideName:data.guideName,kategori:data.kategori,regu:data.regu,aktif:data.aktif===true});
  toast(saved.created?`Guide ${saved.guideId} ditambahkan. Muncul di HP pos saat daftar guide diperbarui.`:`Guide ${saved.guideId} disimpan.`);refresh();
 },{note:g?'ID guide tidak berubah. Perubahan nama dan regu ikut tampil di rekap pada penyusunan berikutnya.':'ID guide diberi otomatis (G- berikutnya) dan tidak pernah dipakai ulang.'});
 const kategori=el.querySelector('[data-guide-kategori]'),reguSelect=el.querySelector('[data-guide-regu]'),name=el.querySelector('[name=guideName]'),twin=el.querySelector('[data-guide-twin]');
 const checkTwin=()=>{const n=name.value.trim().toLocaleLowerCase('id'),r=reguSelect.value;const other=M.guides.find(x=>x.guideId!==g?.guideId&&x.guideName.toLocaleLowerCase('id')===n&&x.regu.split(',').map(y=>y.trim()).includes(r));twin.hidden=!other;twin.textContent=other?`Nama ini sudah dipakai ${other.guideId} di regu ${r}. Beri pembeda dalam kurung, misalnya "${name.value.trim()} (2)".`:'';};
 kategori.addEventListener('change',()=>{reguSelect.innerHTML=reguOptions(kategori.value).map(r=>`<option>${r}</option>`).join('');checkTwin();});
 name.addEventListener('input',checkTwin);reguSelect.addEventListener('change',checkTwin);checkTwin();
}

/* ---------- Penilaian ---------- */
function recordRow(r){
 const replaced=r.status==='diganti';
 return `<tr class="${replaced?'visit-dim':''}"><td>${when(r.timestamp)}</td><td>Pos ${esc(r.pos)}</td><td><strong>${esc(r.guideName)}</strong><br><span class="muted text-small">${esc(r.guideId)} · ${esc(r.regu||'—')}</span></td><td>${esc(uniformLabel[String(r.uniform)]||r.uniform)}</td><td>${r.idCard?'Ya':'Tidak'}</td><td>${esc(signed(r.etika))}</td><td>${esc(r.catatan||'')}</td><td>${replaced?`Diganti${r.digantiOleh?`<br><span class="muted text-small">oleh ${esc(r.digantiOleh.slice(0,8))}</span>`:''}`:r.koreksiDari?`Koreksi<br><span class="muted text-small">dari ${esc(r.koreksiDari.slice(0,8))}</span>`:'Aktif'}</td></tr>`;
}
function recordsPage(){
 const f=M.recordFilter,sel=(key,label,opts)=>`<label class="field"><span>${label}</span><select data-visit-filter="${key}"><option value="">Semua</option>${opts.map(([v,t])=>`<option value="${v}" ${f[key]===v?'selected':''}>${t}</option>`).join('')}</select></label>`;
 const exportButton=permitted('visits.reports.export')?btn('Ekspor Excel','export-records','download','outlined'):'';
 return `${head('Penilaian Guide',`${number(M.recordsTotal)} penilaian ${formatDate(M.from)} – ${formatDate(M.to)}, terbaru dulu. Hanya baca; salah pencet hari ini dibetulkan dari HP pos.`,exportButton)}
 ${filters(sel('pos','Pos',[['1','Pos 1'],['3','Pos 3'],['2','Pos 2 (data lama)']])+sel('regu','Regu',regu.map(r=>[r,r]))+sel('status','Status',[['aktif','Aktif'],['diganti','Diganti koreksi']]))}
 ${table(['Waktu WITA','Pos','Guide','Uniform','ID-Card','Etika','Catatan','Status'],M.records.map(recordRow))}
 ${M.recordsMore?`<div class="actions visit-more">${btn(`Muat ${number(Math.min(1000,M.recordsTotal-M.records.length))} berikutnya`,'records-more','arrow','outlined')}</div>`:''}`;
}
const recordQuery=offset=>{const f=M.recordFilter,q=new URLSearchParams({from:M.from,to:M.to,limit:'1000',offset:String(offset)});for(const k of ['pos','regu','status'])if(f[k])q.set(k,f[k]);return q.toString();};
async function loadRecords(append=false){
 const data=await api(`visits/records?${recordQuery(append?M.records.length:0)}`);
 M.records=append?[...M.records,...data.items]:data.items;M.recordsMore=data.more;M.recordsTotal=data.total;
}

/* ---------- Tautan Pos ---------- */
const linkUrl=token=>`${location.origin}/penilaian-guide/#${token}`;
function linksPage(){
 const manage=M.links.can_manage,h=M.health;
 const cards=M.links.items.map(item=>{
  const l=item.link;
  const actions=manage?(l?`${btn('Salin tautan','link-copy','document','outlined',`data-pos="${item.pos}"`)}${btn('Tampilkan QR','link-qr','eye','outlined',`data-pos="${item.pos}"`)}${btn('Ganti','link-rotate','refresh','outlined',`data-pos="${item.pos}"`)}${btn('Cabut','link-revoke','close','text',`data-pos="${item.pos}"`)}`:btn('Buat tautan','link-create','plus','primary',`data-pos="${item.pos}"`)):'';
  return card(item.label,l?`Aktif sejak ${when(l.created_at)}${l.created_by_name?` · dibuat ${l.created_by_name}`:''}`:'Belum ada tautan aktif.',`<div class="card-body"><div class="visit-link-row"><div><p>Kiriman terakhir: <strong>${item.last_received_at?when(item.last_received_at):'belum ada'}</strong></p><p class="muted">24 jam terakhir: ${number(item.accepted_24h)} diterima · ${number(item.rejected_24h)} ditolak</p></div><div class="actions">${actions}</div></div></div>`);
 }).join('');
 const recent=table(['Waktu','Pos','Hasil','Alasan'],M.links.recent.map(r=>`<tr><td>${when(r.received_at)}</td><td>Pos ${esc(r.pos)}</td><td>${esc({ACCEPTED:'Diterima',DUPLICATE:'Kiriman ulang',REJECTED:'Ditolak'}[r.outcome]||r.outcome)}</td><td>${esc({JEDA:'Jeda < 15 menit',KOREKSI:'Koreksi tidak sah',GUIDE:'Guide tidak terdaftar',WAKTU:'Cap waktu di luar batas',POS:'Pos tidak sesuai',VALIDASI:'Isian tidak valid'}[r.reason]||'—')}</td></tr>`),'Belum ada kiriman.');
 const bridge=h?`<p class="muted visit-note">Jembatan spreadsheet versi ${esc(h.versi)} · ${number(h.barisEvaluations)} baris penilaian · ${number(h.triggerAktif)} trigger rekap aktif · aplikasi lama ${h.terimaAplikasiLama?'masih diterima':'sudah ditutup'}.</p>`:`<p class="muted visit-note">Status jembatan spreadsheet belum dapat dibaca.</p>`;
 return `${head('Tautan Pos','Satu tautan aktif per pos. HP pos menyimpan tautan saat pertama dibuka; petugas tidak perlu login dan tidak dicatat namanya.')}
 <div class="notice">${icon('shield')}<div><strong>Perlakukan tautan pos seperti kunci</strong><p>Siapa pun yang memegang tautan bisa mengirim penilaian untuk pos itu. Bila tautan tersebar ke luar petugas pos, tekan Ganti. Penilaian yang masih tersimpan di HP menunggu sampai HP membuka tautan baru, tidak hilang.</p></div></div>
 <div class="visit-grid">${cards}</div>${bridge}${card('Catatan kiriman terbaru','Tanpa nama guide, nilai, atau catatan. Disimpan 90 hari.',recent)}`;
}
async function linkAction(action,pos){
 const item=M.links.items.find(i=>i.pos===pos),l=item?.link;
 if(action==='link-create'){const r=await post('visits/links',{action:'create',pos});showLink(item.label,r.token,'Tautan baru dibuat. Kirim ke HP pos lewat WhatsApp atau minta petugas memindai QR.');refresh();return;}
 if(action==='link-rotate'){if(!confirm(`Ganti tautan ${item.label}? Tautan lama langsung tidak berlaku; HP pos harus membuka tautan baru. Penilaian yang masih di HP tetap menunggu dan terkirim setelah tautan baru dibuka.`))return;const r=await post('visits/links',{action:'rotate',pos,id:l.id,row_version:l.row_version});showLink(item.label,r.token,'Tautan diganti. Kirim tautan baru ini ke HP pos.');refresh();return;}
 if(action==='link-revoke'){if(!confirm(`Cabut tautan ${item.label}? HP pos tidak bisa mengirim sampai ada tautan baru.`))return;await post('visits/links',{action:'revoke',pos,id:l.id,row_version:l.row_version});toast('Tautan dicabut.');refresh();return;}
 const r=await post('visits/links',{action:'copy',pos,id:l.id,row_version:l.row_version});
 if(action==='link-copy'){try{await navigator.clipboard.writeText(linkUrl(r.token));toast('Tautan disalin. Kirim hanya ke HP pos.');}catch{showLink(item.label,r.token,'Salin tautan di bawah secara manual.');}return;}
 showLink(item.label,r.token,'Pindai QR ini dengan kamera HP pos, lalu buka tautannya.');
}
function showLink(label,token,note){
 let svg='';try{svg=encodeQR(linkUrl(token),'svg',{ecc:'medium'});}catch{}
 const el=dialog(`Tautan ${label}`,`<p>${esc(note)}</p><div class="visit-qr">${svg}</div><label class="field full"><span>Tautan</span><input readonly value="${esc(linkUrl(token))}" data-link-value></label><div class="form-actions"><button type="button" class="button outlined" data-close>Tutup</button><button type="button" class="button primary" data-link-copy>${icon('document')}<span>Salin</span></button></div>`);
 el.querySelector('[data-link-copy]').addEventListener('click',async()=>{const input=el.querySelector('[data-link-value]');try{await navigator.clipboard.writeText(input.value);toast('Tautan disalin.');}catch{input.select();toast('Tekan salin di keyboard untuk menyalin.',true);}});
}

/* ---------- Laporan & Ekspor ---------- */
function reportsPage(){
 const d=M.report,r=M.reviews,canExport=permitted('visits.reports.export');
 const perGuide=d.perGuide.map(g=>`<tr><td><strong>${esc(g.nama)}</strong><br><span class="muted text-small">${esc(g.guideId)}</span></td><td>${esc(g.regu)}</td><td>${number(g.antar)}</td><td>${number(g.hari)}</td><td>${number(g.uniform)}</td><td>${number(g.idCard)}</td><td>${number(g.etika)}</td><td>${number(g.review)}</td><td><strong>${number(g.total)}</strong></td><td>${dec(g.rataTotal)}</td></tr>`);
 return `${head('Laporan & Ekspor',`Ringkasan bulan ${formatDate(M.month+'-01',{month:'long',year:'numeric'})} per guide, sama dengan blok TOTAL di tab Rekap regu. Laporan cetak tetap disusun dari menu spreadsheet.`,canExport?btn('Ekspor Excel','export-report','download','primary'):'')}
 <div class="toolbar"><label class="field"><span>Bulan</span><input type="month" data-visit-field="month" value="${esc(M.month)}" max="${localToday().slice(0,7)}"></label>${btn('Tampilkan','apply-month','filter','outlined')}</div>
 <div class="stats-grid">${stat('Pengantaran',number(d.ringkasan.pengantaran))}${stat('Guide dinilai',number(d.ringkasan.guideDinilai))}${stat('Taat Uniform',pct(d.ringkasan.persenUniform))}${stat('Taat ID-Card',pct(d.ringkasan.persenId))}${stat('REVIEW tercatat',number(r.items.length),'hari-guide berisi REVIEW')}</div>
 ${card('Ringkasan per guide',`Total = Uniform + ID + Etika + REVIEW. Diurut rata-rata per pengantaran.`,table(['Guide','Regu','Pengantaran','Hari','Uniform','ID','Etika','REVIEW','Total','Rata-rata'],perGuide))}
 ${r.tidakPasti.length?card('REVIEW yang tidak bisa dipastikan pemiliknya','Nama di tab Rekap regu cocok untuk lebih dari satu guide atau tidak ada di daftar. Betulkan namanya di spreadsheet.',table(['Nama di tab','Regu tab','Tanggal','REVIEW'],r.tidakPasti.map(x=>`<tr><td>${esc(x.nama)}</td><td>${esc(x.regu)}</td><td>${formatDate(x.tanggal)}</td><td>${number(x.review)}</td></tr>`))):''}
 <p class="muted visit-note">REVIEW dibaca saja dari tab Rekap regu yang diketik tim. Diperbarui ${when(d.diperbarui)}.</p>`;
}
const monthEnd=month=>{const [y,m]=month.split('-').map(Number);const last=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);return last>localToday()?localToday():last;};
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
const guideColumns=[{header:'guideId',key:'guideId'},{header:'Nama',key:'nama',width:30},{header:'Regu',key:'regu'},{header:'Kategori',key:'kategori'},{header:'Pengantaran',key:'antar',kind:'number'},{header:'Hari',key:'hari',kind:'number'},{header:'Uniform (jumlah)',key:'uniform',kind:'number'},{header:'Uniform patuh',key:'uniformPatuh',kind:'number'},{header:'ID-Card',key:'idCard',kind:'number'},{header:'Etika',key:'etika',kind:'number'},{header:'REVIEW',key:'review',kind:'number'},{header:'Total',key:'total',kind:'number'},{header:'Rata-rata total',key:'rataTotal',kind:'number'},{header:'Taat Uniform & ID',key:'taat',kind:'number'},{header:'Rata-rata Etika',key:'rataEtika',kind:'number'}];
async function exportRecords(){
 const rows=[];
 for(let offset=0;;offset+=1000){const page=await api(`visits/records?${recordQuery(offset)}`);rows.push(...page.items);if(!page.more)break;if(offset>=49000)throw new Error('Lebih dari 50.000 baris. Persempit rentang tanggal.');}
 if(!rows.length)throw new Error('Tidak ada penilaian pada saringan ini.');
 const summary=await api(`visits/overview?${range()}`);
 const columns=['evaluationId','timestamp','tanggal','pos','guideId','guideName','regu','uniform','idCard','etika','review','catatan','receivedAt','koreksiDari','status','digantiOleh'].map(key=>({header:key,key,kind:['pos','uniform','idCard','etika','review'].includes(key)?'number':key==='catatan'?'notes':'text',width:key==='catatan'?40:undefined}));
 download(createXlsx([{name:'Penilaian',columns,rows},{name:'Ringkasan per guide',columns:guideColumns,rows:summary.perGuide}]),`penilaian-guide-${M.from}-sd-${M.to}.xlsx`);
 await post('visits/exports',{kind:'records',from:M.from,to:M.to,rows:rows.length});
 toast(`${number(rows.length)} penilaian diekspor.`);
}
async function exportReport(){
 const d=M.report,r=M.reviews;
 const reviewColumns=[{header:'guideId',key:'guideId'},{header:'Nama',key:'guideName',width:30},{header:'Regu',key:'regu'},{header:'Tanggal',key:'tanggal',kind:'date'},{header:'REVIEW',key:'review',kind:'number'}];
 const sheets=[{name:'Ringkasan per guide',columns:guideColumns,rows:d.perGuide},{name:'REVIEW',columns:reviewColumns,rows:r.items}];
 if(r.tidakPasti.length)sheets.push({name:'REVIEW tidak pasti',columns:[{header:'Nama di tab',key:'nama',width:30},{header:'Regu tab',key:'regu'},{header:'Tanggal',key:'tanggal',kind:'date'},{header:'REVIEW',key:'review',kind:'number'}],rows:r.tidakPasti});
 download(createXlsx(sheets),`laporan-penilaian-guide-${M.month}.xlsx`);
 await post('visits/exports',{kind:'summary',from:d.from,to:d.to,rows:d.perGuide.length});
 toast('Laporan bulanan diekspor.');
}

export async function loadVisitsPage(route){
 try{
  if(route==='visits'){
   const [overview,activity]=await Promise.all([api(`visits/overview?${range()}`),api('visits/activity').catch(()=>null)]);
   M.overview=overview;M.activity=activity;return dashboard();
  }
  if(route==='visits-guides'){M.guides=(await api('visits/guides')).items;return guidesPage();}
  if(route==='visits-records'){await loadRecords();return recordsPage();}
  if(route==='visits-links'){const [links,health]=await Promise.all([api('visits/links'),api('visits/health').catch(()=>null)]);M.links=links;M.health=health;return linksPage();}
  if(route==='visits-reports'){const from=M.month+'-01',to=monthEnd(M.month);const [report,reviews]=await Promise.all([api(`visits/overview?from=${from}&to=${to}`),api(`visits/reviews?month=${M.month}`)]);M.report=report;M.reviews=reviews;return reportsPage();}
 }catch(error){if(error.name==='AbortError')throw error;return unavailable(visitTitles[route],error);}
 return unavailable(visitTitles[route]);
}

export function bindVisitsPage(){
 const root=document.querySelector('#main');if(!root||root.dataset.visitBound)return;root.dataset.visitBound='1';
 root.addEventListener('input',e=>{const key=e.target.dataset?.visitField;if(!key)return;M[key]=e.target.value;if(['guideQuery','guideKategori','guideRegu','guideAktif'].includes(key)&&state.route==='visits-guides')rerender(guidesPage,e.target);});
 root.addEventListener('change',e=>{const key=e.target.dataset?.visitFilter;if(key)M.recordFilter[key]=e.target.value;});
 root.addEventListener('click',async e=>{
  const el=e.target.closest('[data-visit]');if(!el||!visitRoutes.includes(state.route))return;
  const action=el.dataset.visit;el.disabled=true;
  try{
   if(action==='apply'||action==='retry'){if(M.from>M.to)throw new Error('Tanggal mulai harus sebelum tanggal akhir.');refresh();return;}
   if(action==='apply-month'){refresh();return;}
   if(action==='guide-new'){guideForm(null);return;}
   if(action==='guide-edit'){guideForm(M.guides.find(g=>g.guideId===el.dataset.id));return;}
   if(action==='records-more'){await loadRecords(true);root.innerHTML=recordsPage();return;}
   if(action==='export-records'){await exportRecords();return;}
   if(action==='export-report'){await exportReport();return;}
   if(action.startsWith('link-')){await linkAction(action,Number(el.dataset.pos));return;}
  }catch(error){toast(error.message,true);}
  finally{el.disabled=false;}
 });
}
// Saringan Data Guide digambar ulang tanpa memuat ulang spreadsheet; fokus ketikan dipertahankan.
function rerender(render,target){const root=document.querySelector('#main'),key=target.dataset.visitField,pos=target.selectionStart;root.innerHTML=render();const next=root.querySelector(`[data-visit-field="${key}"]`);if(next){next.focus();if(pos!=null&&next.setSelectionRange)try{next.setSelectionRange(pos,pos);}catch{}}}
