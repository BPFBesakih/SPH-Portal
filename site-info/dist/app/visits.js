import {api,post,permitted,refresh,state} from './api.js';
import {esc,icon,toast,dialog,formDialog,localToday,formatDate,formatTime,number} from './ui.js';
import {createXlsx} from './xlsx-export.js';
import {encodeQR} from './vendor/qr.js';
import {readGuideFile,readHistoryFile,historyParts} from './visit-import.js';

// Ruang kerja Pengelolaan Kunjungan. Penilaian guide masuk dari tautan pos ke basis
// data portal, lalu disalin otomatis ke spreadsheet tahunan di Google Drive portal.
// Rincian penilaian disimpan 6 minggu; periode lebih lama dihitung dari rekap harian,
// rinciannya di spreadsheet. Riwayat NilaiGuide masuk sekali lewat migrasi awal
// (kartu di Laporan & Ekspor); aplikasi dan spreadsheet NilaiGuide tidak disentuh.
// Nilai pengantaran = 100 − potongan (keputusan pemilik 11 November 2026): petugas pos
// mencatat fakta, bobot potongan diatur per bulan di Aturan Nilai, dan laporan
// pelanggaran berat/apresiasi diputuskan Pengelola di Verifikasi.
export const visitTitles={
 visits:'Dashboard Kunjungan',
 'visits-guides':'Data Guide',
 'visits-records':'Penilaian Guide',
 'visits-flags':'Verifikasi Laporan',
 'visits-links':'Tautan Pos',
 'visits-scoring':'Aturan Nilai',
 'visits-reports':'Laporan & Ekspor Kunjungan'
};
export const visitRoutes=Object.keys(visitTitles);
export const visitNav=[
 ['visits','Dashboard','dashboard','visits.dashboard.read'],
 ['visits-guides','Data Guide','people','visits.guides.read'],
 ['visits-records','Penilaian','log','visits.records.read'],
 ['visits-flags','Verifikasi','check','visits.dashboard.read'],
 ['visits-links','Tautan Pos','key','visits.forms.read'],
 ['visits-scoring','Aturan Nilai','settings','visits.dashboard.read'],
 ['visits-reports','Laporan & Ekspor','document','visits.reports.read']
];
const firstOfMonth=()=>localToday().slice(0,8)+'01';
const shiftDay=(day,days)=>new Date(Date.parse(day+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
const M={from:firstOfMonth(),to:localToday(),month:localToday().slice(0,7),overview:null,activity:null,sheet:null,guides:[],guideQuery:'',guideKategori:'',guideRegu:'',guideAktif:'1',
 records:[],recordsMore:false,recordsTotal:0,recordsFolded:null,recordFilter:{pos:'',regu:'',status:''},links:null,report:null,
 flags:null,flagFrom:shiftDay(localToday(),-90),flagTo:localToday(),flagStatus:'menunggu',flagJenis:'',scoring:null};
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
const seragamLabel={lengkap:'Lengkap',kurang:'Kurang lengkap',tidak:'Tidak berseragam'};
const score=v=>v==null?'—':Number(v).toLocaleString('id-ID',{maximumFractionDigits:1});
const rewardBadge={layak:['positive','Layak'],gugur:['negative','Gugur — pelanggaran berat'],bawah:['warm','Di bawah ambang'],kurang:['neutral','Belum cukup data']};
const rewardCell=g=>{if(!g.status)return '—';const [kind,label]=rewardBadge[g.status]||['neutral',g.status];return `<span class="badge ${kind}" title="${esc(g.alasan||'')}">${esc(label)}</span>${g.beratMenunggu?`<br><span class="muted text-small">${number(g.beratMenunggu)} laporan berat menunggu</span>`:''}`;};
// Ringkasan aturan yang dipakai, mis. "tanpa ID −20 · kurang lengkap −10 · …".
const ruleLine=r=>r?`tanpa ID −${r.pot_id} · kurang lengkap −${r.pot_kurang} · tidak berseragam −${r.pot_tidak} · per teguran −${r.pot_teguran}`:'';
const monthLabel=m=>formatDate(m+'-01',{month:'long',year:'numeric'});
const when=t=>t?`${formatDate(t)} ${formatTime(t)}`:'—';
const range=()=>`from=${M.from}&to=${M.to}`;
const filters=(extra='')=>`<div class="toolbar"><label class="field"><span>Dari tanggal</span><input type="date" data-visit-field="from" value="${esc(M.from)}" max="${localToday()}"></label><label class="field"><span>Sampai tanggal</span><input type="date" data-visit-field="to" value="${esc(M.to)}" max="${localToday()}"></label>${extra}${btn('Terapkan','apply','filter','outlined')}</div>`;
function unavailable(title,error){
 const denied=error?.status===403,period=error?.status===422;
 return `${head(title,'Penilaian guide dari tautan pos, tersimpan di portal.')}<div class="notice ${period?'':'warning'}">${icon(period?'calendar':'incident')}<div><strong>${esc(denied?'Akses ditolak':period?'Periode perlu disesuaikan':'Data kunjungan belum dapat dimuat')}</strong><p>${esc(error?.message||'Coba lagi beberapa saat lagi.')}</p></div></div>${period?filters():`<div class="actions">${btn('Coba lagi','retry','refresh','outlined')}</div>`}`;
}
// Ringkasan status salinan spreadsheet untuk Dashboard dan Tautan Pos.
function sheetLine(s){
 if(!s)return '';
 const pending=s.pending+s.dirty;
 if(s.last_error)return `<div class="notice warning">${icon('incident')}<div><strong>Salinan spreadsheet tertunda</strong><p>${esc(s.last_error)}</p><p class="muted">${number(pending)} baris menunggu disalin. Penilaian tetap aman di portal dan tidak ada yang dihapus sampai tersalin.</p></div></div>`;
 return `<p class="muted visit-note">${icon('document')} Salinan spreadsheet: ${s.last_success_at?`terakhir tersinkron ${esc(when(s.last_success_at))}`:'belum pernah tersinkron'}${pending?` · ${number(pending)} baris menunggu`:' · semua baris sudah tersalin'}.</p>`;
}

/* ---------- Dashboard ---------- */
const rankMetric={
 nilai:['Nilai',r=>score(r.nilai)],
 tanpaId:['Tanpa ID',r=>`${number(r.tanpaId)} (${pct(r.porsiTanpaId)})`],
 seragam:['Seragam bermasalah',r=>`${number(r.kurangLengkap+r.tidakBerseragam)} (${pct(r.porsiSeragam)})`],
 teguran:['Teguran',r=>`${number(r.teguran)} (${dec(r.rataTeguran)}/antar)`],
 berat:['Pelanggaran berat',r=>number(r.berat)]};
function rankTable(title,rows,metric,note=''){
 const [label,value]=rankMetric[metric];
 return card(title,note,table(['#','Guide','Regu','Pengantaran',label],rows.map(r=>`<tr><td>${number(r.peringkat)}</td><td><strong>${esc(r.nama)}</strong><br><span class="muted text-small">${esc(r.guideId)}</span></td><td>${esc(r.regu)}</td><td>${number(r.antar)}</td><td><strong>${value(r)}</strong></td></tr>`),'Belum ada guide yang memenuhi.'));
}
const figureCells=r=>`<td>${number(r.pengantaran)}</td><td><strong>${score(r.nilai)}</strong></td><td>${pct(r.persenId)}</td><td>${pct(r.persenSeragam)}</td><td>${number(r.teguran)}</td>`;
const figureHeads=['Pengantaran','Nilai','% ID terpasang','% seragam lengkap','Teguran'];
const periodNote=d=>d.periode?.bulan_ringkasan?.length?` Bulan ${d.periode.bulan_ringkasan.map(m=>formatDate(m+'-01',{month:'long',year:'numeric'})).join(', ')} memakai ringkasan bulanan; rincian sampai ${formatDate(d.periode.folded_through)} ada di spreadsheet.`:'';
function ruleNote(d){
 const a=d.aturan;if(!a)return '';
 const months=a.per_bulan||[],same=months.every(m=>ruleLine(m)===ruleLine(a));
 return same?`Nilai pengantaran = 100 − potongan (${ruleLine(a)}).`:`Nilai pengantaran = 100 − potongan, dengan aturan bulan masing-masing: ${months.map(m=>`${monthLabel(m.bulan)}: ${ruleLine(m)}`).join('; ')}.`;
}
function dashboard(){
 const d=M.overview,s=d.ringkasan,p=d.peringkat,a=d.aturan;
 const activity=(M.activity?.items||[]).map(x=>`<tr><td>${esc(x.label)}</td><td>${x.last_received_at?when(x.last_received_at):'Belum ada kiriman'}</td><td>${number(x.accepted_24h)}</td><td>${number(x.rejected_24h)}</td></tr>`);
 const waiting=s.berat.menunggu+s.apresiasi.menunggu;
 const petugas=(d.perPetugas||[]).map(r=>`<tr><td>${r.petugas?esc(r.petugas):'<span class="muted">Tanpa nama petugas</span>'}</td><td>${esc(r.pos.map(x=>'Pos '+x).join(', '))}</td>${figureCells(r)}</tr>`);
 return `${head('Dashboard Kunjungan',`Penilaian guide ${formatDate(d.from)} – ${formatDate(d.to)}. ${ruleNote(d)}`)}${filters()}
 ${waiting?`<div class="notice warning">${icon('incident')}<div><strong>${number(waiting)} laporan menunggu verifikasi</strong><p>${number(s.berat.menunggu)} pelanggaran berat dan ${number(s.apresiasi.menunggu)} apresiasi dari HP pos belum diputuskan Pengelola Kunjungan. Pelanggaran berat baru menggugurkan reward setelah disetujui.</p><p><a href="#visits-flags">Buka Verifikasi</a></p></div></div>`:''}
 <div class="stats-grid">${stat('Pengantaran',number(s.pengantaran),`${number(s.hariDinilai)} hari berpenilaian`)}${stat('Guide dinilai',number(s.guideDinilai),`dari ${number(s.guideAktif)} guide aktif`)}${stat('Nilai rata-rata',score(s.nilai),'100 − potongan per pengantaran')}${stat('ID terpasang',pct(s.persenId),`${number(s.tanpaId)} kali tanpa ID`)}${stat('Seragam lengkap',pct(s.persenSeragam),`${number(s.kurangLengkap)} kurang · ${number(s.tidakBerseragam)} tidak`)}${stat('Teguran',number(s.teguran),`${number(s.berat.disetujui)} pelanggaran berat terverifikasi`)}${a?.satu_bulan?stat('Layak reward',number(s.layak),`nilai ≥ ${a.ambang}, ≥ ${a.minimal} antar, tanpa pelanggaran berat`):''}</div>
 <div class="visit-grid">${card('Per pos','Pos 1 dan Pos 3 dihitung masing-masing. Selisih besar biasanya tanda patokan antarpos belum sama.',table(['Pos','Guide',...figureHeads],d.perPos.map(r=>`<tr><td>Pos ${esc(r.pos)}</td><td>${number(r.guideDinilai)}</td>${figureCells(r)}</tr>`)))}
 ${card('Per regu','',table(['Regu','Kategori',...figureHeads],d.perRegu.map(r=>`<tr><td>${esc(r.regu)}</td><td>${esc(r.kategori)}</td>${figureCells(r)}</tr>`)))}</div>
 ${petugas.length?card('Per petugas penilai','Dari rincian 6 minggu terakhir. Petugas yang jauh lebih longgar atau ketat dari yang lain perlu dikalibrasi.',table(['Petugas','Pos',...figureHeads],petugas)):''}
 ${M.activity?card('Kiriman dari HP pos','Kiriman terakhir yang diterima tiap pos dan jumlahnya dalam 24 jam terakhir.',table(['Pos','Kiriman terakhir','Diterima 24 jam','Ditolak 24 jam'],activity)):''}
 <p class="muted visit-note">Peringkat memakai rata-rata nilai per pengantaran, minimal ${number(d.minimalPengantaran)} pengantaran (${number(d.diperingkat)} guide memenuhi, ${number(d.belumCukup)} belum). Nilai sama mendapat peringkat sama; apresiasi terverifikasi menjadi penentu, bukan jumlah pengantaran. Guide nonaktif ikut di total, tidak di peringkat.${esc(periodNote(d))} Diperbarui ${when(d.diperbarui)}.</p>
 ${sheetLine(M.sheet)}
 <div class="visit-grid">${rankTable('Nilai tertinggi',p.nilaiTertinggi,'nilai')}${rankTable('Nilai terendah',p.nilaiTerendah,'nilai')}${rankTable('Paling sering tanpa ID',p.tanpaIdTerbanyak,'tanpaId')}${rankTable('Paling sering seragam bermasalah',p.seragamTerbanyak,'seragam')}${rankTable('Teguran terbanyak',p.teguranTerbanyak,'teguran')}${rankTable('Pelanggaran berat terverifikasi',p.beratTerverifikasi,'berat','Menggugurkan reward bulan itu.')}${rankTable(`Belum cukup pengantaran (< ${d.minimalPengantaran})`,p.belumCukup,'nilai')}</div>`;
}

/* ---------- Data Guide ---------- */
function guidesPage(){
 const manage=permitted('visits.guides.manage'),q=M.guideQuery.toLocaleLowerCase('id');
 const rows=M.guides.filter(g=>(!q||g.guideName.toLocaleLowerCase('id').includes(q)||g.guideId.toLowerCase().includes(q))&&(!M.guideKategori||g.kategori===M.guideKategori)&&(!M.guideRegu||g.regu.split(',').map(x=>x.trim()).includes(M.guideRegu))&&(M.guideAktif===''||String(Number(g.aktif))===M.guideAktif));
 const aktif=M.guides.filter(g=>g.aktif).length;
 const empty=!M.guides.length;
 return `${head('Data Guide',`${number(aktif)} guide aktif dari ${number(M.guides.length)}. Guide tidak dihapus, hanya dinonaktifkan; HP pos hanya menampilkan guide aktif.`,manage?`${btn('Impor berkas','guide-import','upload','outlined')}${btn('Tambah guide','guide-new')}`:'')}
 ${empty&&manage?`<div class="notice">${icon('upload')}<div><strong>Mulai dari daftar guide lama</strong><p>Buka spreadsheet NilaiGuide, pilih tab <strong>Guides</strong>, lalu <em>File → Download → Microsoft Excel (.xlsx)</em> atau <em>CSV</em>. Impor berkas itu di sini supaya ID guide (G-001 …) sama dengan data lama. Spreadsheet lama tidak diubah.</p></div></div>`:''}
 <div class="toolbar"><label class="field"><span>Cari</span><input data-visit-field="guideQuery" value="${esc(M.guideQuery)}" placeholder="Nama atau ID guide"></label>
 <label class="field"><span>Kategori</span><select data-visit-field="guideKategori"><option value="">Semua</option>${['Asing','Domestik'].map(k=>`<option ${M.guideKategori===k?'selected':''}>${k}</option>`).join('')}</select></label>
 <label class="field"><span>Regu</span><select data-visit-field="guideRegu"><option value="">Semua</option>${regu.map(r=>`<option ${M.guideRegu===r?'selected':''}>${r}</option>`).join('')}</select></label>
 <label class="field"><span>Status</span><select data-visit-field="guideAktif"><option value="" ${M.guideAktif===''?'selected':''}>Semua</option><option value="1" ${M.guideAktif==='1'?'selected':''}>Aktif</option><option value="0" ${M.guideAktif==='0'?'selected':''}>Nonaktif</option></select></label></div>
 ${table(['ID','Nama','Kategori','Regu','Status',...(manage?['']:[])],rows.map(g=>`<tr class="${g.aktif?'':'visit-dim'}"><td>${esc(g.guideId)}</td><td><strong>${esc(g.guideName)}</strong></td><td>${esc(g.kategori)}</td><td>${esc(g.regu)}</td><td>${g.aktif?'<span class="badge positive"><span class="status-dot"></span>Aktif</span>':'<span class="badge negative"><span class="status-dot"></span>Nonaktif</span>'}</td>${manage?`<td>${btn('Ubah','guide-edit','settings','text',`data-id="${esc(g.guideId)}"`)}</td>`:''}</tr>`),empty?'Belum ada guide. Impor daftar guide lebih dulu.':'Tidak ada guide yang cocok.')}`;
}
function guideForm(g){
 const current=g?.regu?g.regu.split(',').map(x=>x.trim()):[];
 const fields=`<label class="field full"><span>Nama guide</span><input name="guideName" maxlength="120" required value="${esc(g?.guideName||'')}"></label>
 <label class="field"><span>Kategori</span><select name="kategori">${['Asing','Domestik'].map(k=>`<option ${g?.kategori===k?'selected':''}>${k}</option>`).join('')}</select></label>
 <fieldset class="field visit-regu"><span>Regu (paling banyak dua)</span><div>${regu.map(r=>`<label class="check-field"><input type="checkbox" name="regu[]" value="${r}" ${current.includes(r)?'checked':''}><span>${r}</span></label>`).join('')}</div></fieldset>
 <label class="check-field full"><input type="checkbox" name="aktif" ${!g||g.aktif?'checked':''}><span>Aktif — tampil di formulir pos</span></label>
 <p class="form-note full" data-guide-twin hidden></p>`;
 const el=formDialog(g?`Ubah ${g.guideId}`:'Tambah guide',fields,async data=>{
  const saved=await post('visits/guides',{...(g?{guideId:g.guideId,row_version:g.row_version}:{}),guideName:data.guideName,kategori:data.kategori,regu:data.regu||[],aktif:data.aktif===true});
  toast(saved.created?`Guide ${saved.guideId} ditambahkan. Muncul di HP pos saat daftar guide diperbarui.`:`Guide ${saved.guideId} disimpan.`);refresh();
 },{note:g?'ID guide tidak berubah. Penilaian lama tetap memakai nama saat dinilai.':'ID guide diberi otomatis (G- berikutnya) dan tidak pernah dipakai ulang.'});
 const name=el.querySelector('[name=guideName]'),twin=el.querySelector('[data-guide-twin]'),boxes=[...el.querySelectorAll('[name="regu[]"]')];
 const checkTwin=()=>{const n=name.value.trim().toLocaleLowerCase('id'),picked=boxes.filter(b=>b.checked).map(b=>b.value);
  const other=M.guides.find(x=>x.guideId!==g?.guideId&&x.guideName.toLocaleLowerCase('id')===n&&x.regu.split(',').map(y=>y.trim()).some(r=>picked.includes(r)));
  twin.hidden=!other;twin.textContent=other?`Nama ini sudah dipakai ${other.guideId} di regu ${other.regu}. Beri pembeda dalam kurung, misalnya "${name.value.trim()} (2)".`:'';};
 for(const box of boxes)box.addEventListener('change',()=>{if(boxes.filter(b=>b.checked).length>2)box.checked=false;checkTwin();});
 name.addEventListener('input',checkTwin);checkTwin();
}
function importDialog(){
 const el=dialog('Impor daftar guide',`<p>Pilih tab <strong>Guides</strong> yang diunduh dari spreadsheet NilaiGuide lama (<em>File → Download → .xlsx</em> atau <em>.csv</em>). Berkas dibaca di peramban ini; yang dikirim ke portal hanya isi kolomnya.</p>
 <p class="muted">Kolom yang dibaca: guideId, guideName, kategori, regu, aktif. Guide yang tidak ada di berkas tidak diubah. Baris tanpa guideId mendapat ID baru.</p>
 <label class="field full visit-import-file"><span>Berkas .xlsx atau .csv</span><input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-import-file></label>
 <div data-import-result></div>
 <div class="form-actions"><button type="button" class="button outlined" data-close>Tutup</button><button type="button" class="button primary" data-import-apply disabled>${icon('upload')}<span>Terapkan impor</span></button></div>`,{wide:true});
 const input=el.querySelector('[data-import-file]'),result=el.querySelector('[data-import-result]'),apply=el.querySelector('[data-import-apply]');let rows=null;
 const list=(title,items)=>items.length?`<h3 class="visit-import-title">${esc(title)}</h3>${table(['Baris','Keterangan'],items.map(x=>`<tr><td>${number(x.line)}</td><td>${esc(x.message)}</td></tr>`))}`:'';
 input.addEventListener('change',async()=>{
  rows=null;apply.disabled=true;result.innerHTML=`<p class="muted">Membaca berkas…</p>`;
  try{
   const file=await readGuideFile(input.files[0]);
   const preview=await post('visits/guides/import',{rows:file.rows});rows=file.rows;
   result.innerHTML=`<div class="notice ${preview.error_count?'error':''}">${icon(preview.error_count?'incident':'check')}<div><strong>${number(preview.total)} baris${file.sheet?` dari sheet "${esc(file.sheet)}"`:''}</strong><p>${number(preview.create)} guide baru · ${number(preview.update)} berubah · ${number(preview.unchanged)} tetap${preview.error_count?` · ${number(preview.error_count)} baris belum valid — perbaiki berkasnya lalu pilih ulang`:''}</p></div></div>
    ${list(`Baris belum valid (${number(preview.error_count)})`,preview.errors)}${list(`Perlu dicek (${number(preview.warning_count)})`,preview.warnings)}`;
   apply.disabled=Boolean(preview.error_count)||!(preview.create+preview.update);
  }catch(error){result.innerHTML=`<div class="notice error">${icon('incident')}<div><strong>Berkas belum dapat diimpor</strong><p>${esc(error.message)}</p></div></div>`;}
 });
 apply.addEventListener('click',async()=>{
  if(!rows)return;apply.disabled=true;
  try{const done=await post('visits/guides/import',{rows,apply:true});toast(`${number(done.create)} guide ditambahkan, ${number(done.update)} diperbarui.`);el.close();refresh();}
  catch(error){toast(error.message,true);apply.disabled=false;}
 });
}

/* ---------- Migrasi awal riwayat NilaiGuide ---------- */
const historyReasonOrder=['MASUK','DIGANTI','POS2','BENTROK','DUPLIKAT','ID','TANGGAL','POS','GUIDE','ID_PORTAL'];
function confirmDialog(title,message,action,kind='primary'){
 return new Promise(resolve=>{
  const el=dialog(title,`<p>${message}</p><div class="form-actions"><button type="button" class="button outlined" data-close>Kembali</button><button type="button" class="button ${kind}" data-confirm>${esc(action)}</button></div>`);
  let ok=false;el.querySelector('[data-confirm]').addEventListener('click',()=>{ok=true;el.close();});el.addEventListener('close',()=>resolve(ok),{once:true});
 });
}
// Gabungan hasil per bagian: jumlah per alasan dan tabel per bulan.
function mergeHistory(parts,duplicates=0){
 const counts=Object.fromEntries(historyReasonOrder.map(k=>[k,0])),months=new Map(),problems=[];let first=null,last=null;
 counts.DUPLIKAT+=duplicates;
 for(const p of parts){
  for(const k of historyReasonOrder)counts[k]+=p.counts?.[k]||0;
  for(const m of p.months||[]){const t=months.get(m.month)||{month:m.month,antar:0,uniform:0,uniform_patuh:0,id_card:0,etika:0,diganti:0,pos2:0,lainnya:0};for(const k of Object.keys(t))if(k!=='month')t[k]+=m[k]||0;months.set(m.month,t);}
  if(p.first&&(!first||p.first<first))first=p.first;if(p.last&&(!last||p.last>last))last=p.last;
  for(const x of p.problems||[])if(problems.length<200)problems.push(x);
 }
 return {counts,months:[...months.values()].sort((a,b)=>a.month<b.month?-1:1),first,last,problems};
}
const monthName=m=>formatDate(m+'-01',{month:'long',year:'numeric'});
function historySummary(s,reasons){
 const skipped=['DIGANTI','POS2','BENTROK','DUPLIKAT'].reduce((n,k)=>n+s.counts[k],0),rejected=['ID','TANGGAL','POS','GUIDE','ID_PORTAL'].reduce((n,k)=>n+s.counts[k],0);
 const countRows=historyReasonOrder.filter(k=>k==='MASUK'||s.counts[k]).map(k=>`<tr><td>${esc(reasons?.[k]||k)}</td><td><strong>${number(s.counts[k])}</strong></td></tr>`);
 const monthRows=s.months.filter(m=>m.antar||m.pos2||m.diganti||m.lainnya).map(m=>`<tr><td>${esc(monthName(m.month))}</td><td><strong>${number(m.antar)}</strong></td><td>${pct(m.antar?m.uniform_patuh/m.antar:null)}</td><td>${pct(m.antar?m.id_card/m.antar:null)}</td><td>${dec(m.antar?m.etika/m.antar:null)}</td><td>${number(m.pos2)}</td><td>${number(m.diganti)}</td><td>${number(m.lainnya)}</td></tr>`);
 return `<div class="notice ${rejected?'warning':''}">${icon(rejected?'incident':'check')}<div><strong>${number(s.counts.MASUK)} penilaian masuk ke rekap${s.first?`, ${esc(formatDate(s.first))} – ${esc(formatDate(s.last))}`:''}</strong><p>${number(skipped)} dilewati · ${number(rejected)} ditolak. Yang disimpan hanya rekap harian per guide; catatan, jam, dan nama petugas tetap di spreadsheet NilaiGuide.</p></div></div>
  <h3 class="visit-import-title">Cocokkan dengan tab Dasbor NilaiGuide</h3>
  <p class="muted text-small">Angka per bulan dari baris yang masuk. Bandingkan dengan baris TOTAL tab Dasbor NilaiGuide bulan yang sama: selisih pengantaran seharusnya hanya kolom Pos 2 dan Lainnya (ditolak atau bentrok). Nilai REVIEW tidak diimpor.</p>
  ${table(['Bulan','Pengantaran','% Uniform','% ID-Card','Rata Etika','Pos 2','Dikoreksi','Lainnya'],monthRows,'Tidak ada baris yang masuk.')}
  <h3 class="visit-import-title">Rincian per alasan</h3>${table(['Keterangan','Baris'],countRows)}
  ${s.problems.length?`<h3 class="visit-import-title">Baris yang perlu dicek (${number(s.problems.length)}${s.problems.length>=200?' pertama':''})</h3>${table(['Baris berkas','Keterangan'],s.problems.map(x=>`<tr><td>${number(x.line)}</td><td>${esc(reasons?.[x.reason]||x.reason)}</td></tr>`))}`:''}`;
}
function historyCard(h){
 if(!h?.can_manage)return '';
 const c=h.current,note='Sekali saja, setelah semua HP pos memakai tautan portal. Spreadsheet NilaiGuide tidak diubah dan tetap menjadi arsip.';
 if(!c)return card('Migrasi awal NilaiGuide',note,`<div class="card-body"><p>Unduh spreadsheet NilaiGuide lewat <em>File → Download → Microsoft Excel (.xlsx)</em>, lalu pilih berkasnya di sini. Pratinjau tidak menyimpan apa pun; angka per bulan bisa dicocokkan dulu dengan tab Dasbor NilaiGuide.</p></div>`,btn('Mulai migrasi awal','history-start','upload','primary'));
 const meta=`<p class="muted text-small">Berkas <strong>${esc(c.file_name)}</strong> · ${number(c.rows_total)} baris · dimulai ${esc(when(c.created_at))}</p>`;
 if(c.status==='menyusun')return card('Migrasi awal NilaiGuide belum selesai',`${number(c.parts_done.length)} dari ${number(c.parts_total)} bagian sudah diterima. Belum dihitung di Dashboard maupun Laporan.`,`<div class="card-body">${meta}<p>Lanjutkan dengan memilih berkas yang <strong>sama</strong>, atau batalkan untuk mulai dari awal.</p></div>`,`${btn('Lanjutkan','history-start','upload','primary')}${btn('Batalkan','history-cancel','close','outlined')}`);
 const counts=c.ringkasan?.counts||{},skipped=['DIGANTI','POS2','BENTROK','DUPLIKAT'].reduce((n,k)=>n+(counts[k]||0),0),rejected=['ID','TANGGAL','POS','GUIDE','ID_PORTAL'].reduce((n,k)=>n+(counts[k]||0),0);
 return card('Migrasi awal NilaiGuide',`Diterapkan ${when(c.finished_at)}. Riwayat ${c.first_day?`${formatDate(c.first_day)} – ${formatDate(c.last_day)}`:''} ikut dihitung di Dashboard dan Laporan.`,
  `<div class="card-body">${meta}<div class="visit-sheet-grid"><div><span class="muted">Masuk ke rekap</span><strong>${number(counts.MASUK||0)}</strong></div><div><span class="muted">Dilewati</span><strong>${number(skipped)}</strong></div><div><span class="muted">Ditolak</span><strong>${number(rejected)}</strong></div></div>
  <p class="muted text-small">Ada yang janggal? Batalkan migrasi: seluruh hasilnya dihapus dan angka kembali seperti sebelum impor. Setelah itu berkas bisa diimpor ulang.</p></div>`,btn('Batalkan migrasi','history-cancel','close','outlined'));
}
function historyDialog(h){
 const current=h.current?.status==='menyusun'?h.current:null;
 const el=dialog(current?'Lanjutkan migrasi awal NilaiGuide':'Migrasi awal NilaiGuide',`<p>Pilih <strong>unduhan seluruh spreadsheet NilaiGuide</strong> (.xlsx), atau .csv tab <strong>Evaluations</strong>. Berkas dibaca di peramban ini; yang dikirim ke portal hanya ID penilaian, waktu, pos, guide, dan nilainya.</p>
 <p class="muted">Lakukan setelah HP terakhir pindah ke tautan portal: penilaian yang masuk ke aplikasi lama sesudah berkas diunduh tidak ikut. Data Guide harus sudah diimpor, karena guide dicocokkan lewat ID G-….</p>
 ${current?`<div class="notice">${icon('document')}<div><strong>Pilih berkas yang sama: ${esc(current.file_name)}</strong><p>${number(current.parts_done.length)} dari ${number(current.parts_total)} bagian sudah diterima; sisanya akan dikirim.</p></div></div>`:''}
 <label class="field full visit-import-file"><span>Berkas .xlsx atau .csv</span><input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-history-file></label>
 <p class="muted" data-history-progress role="status"></p><div data-history-result></div>
 <div class="form-actions"><button type="button" class="button outlined" data-close>Tutup</button><button type="button" class="button primary" data-history-apply disabled>${icon('upload')}<span>${current?'Lanjutkan migrasi':'Terapkan migrasi'}</span></button></div>`,{wide:true});
 const input=el.querySelector('[data-history-file]'),result=el.querySelector('[data-history-result]'),progress=el.querySelector('[data-history-progress]'),applyButton=el.querySelector('[data-history-apply]');
 let file=null,parts=null,busy=false;
 const meta=()=>({name:file.fileName,sha256:file.sha256,rows_total:file.rowsTotal,parts_total:parts.length});
 input.addEventListener('change',async()=>{
  file=null;parts=null;applyButton.disabled=true;result.innerHTML='';progress.textContent='Membaca berkas…';
  try{
   const read=await readHistoryFile(input.files[0]);
   if(current&&read.sha256!==current.file_sha256)throw new Error(`Berkas ini berbeda dengan ${current.file_name} yang sedang dimigrasikan. Pilih berkas yang sama, atau tutup lalu batalkan migrasi itu.`);
   const split=historyParts(read.rows);if(!split.length)throw new Error('Sheet Evaluations tidak berisi penilaian.');
   if(current&&split.length!==current.parts_total)throw new Error('Pembagian berkas berbeda dengan migrasi yang sedang berjalan. Batalkan migrasi itu lalu mulai ulang.');
   const checked=[];
   for(let i=0;i<split.length;i++){progress.textContent=`Memeriksa bagian ${i+1} dari ${split.length}…`;checked.push(await post('visits/history/import',{mode:'preview',file:{name:read.fileName,sha256:read.sha256,rows_total:read.rowsTotal,parts_total:split.length},part:i,rows:split[i]}));}
   const summary=mergeHistory(checked,read.duplicates);
   progress.textContent=`${number(read.rowsTotal)} baris dari sheet ${read.sheet?`"${read.sheet}"`:'berkas'}. Pratinjau — belum ada yang disimpan.`;
   result.innerHTML=historySummary(summary,h.reasons);
   file=read;parts=split;applyButton.disabled=!summary.counts.MASUK;
  }catch(error){progress.textContent='';result.innerHTML=`<div class="notice error">${icon('incident')}<div><strong>Berkas belum dapat dipakai</strong><p>${esc(error.message)}</p></div></div>`;}
 });
 applyButton.addEventListener('click',async()=>{
  if(!file||!parts||busy)return;
  if(!current&&!await confirmDialog('Terapkan migrasi awal?',`Riwayat dari <strong>${esc(file.fileName)}</strong> akan ikut dihitung di Dashboard dan Laporan. Migrasi hanya bisa dilakukan sekali; bila ada yang salah, batalkan lalu impor ulang.`,'Terapkan'))return;
  busy=true;applyButton.disabled=true;input.disabled=true;
  try{
   let importId=current?.id||null,done=new Set(current?.parts_done||[]);
   for(let i=0;i<parts.length;i++){
    if(done.has(i))continue;
    progress.textContent=`Mengirim bagian ${i+1} dari ${parts.length}…`;
    const r=await post('visits/history/import',{mode:'apply',file:meta(),part:i,rows:parts[i],...(importId?{import_id:importId}:{})});
    importId=r.import.id;done=new Set(r.import.parts_done);
   }
   progress.textContent='Menyelesaikan migrasi…';
   const finished=await post('visits/history/finish',{import_id:importId});
   toast(`Migrasi awal selesai: ${number(finished.import.ringkasan.counts.MASUK)} penilaian NilaiGuide masuk ke rekap.`);el.close();refresh();
  }catch(error){
   busy=false;input.disabled=false;progress.textContent='';
   result.insertAdjacentHTML('afterbegin',`<div class="notice error">${icon('incident')}<div><strong>Migrasi terhenti</strong><p>${esc(error.message)} Bagian yang sudah terkirim tersimpan; tutup jendela ini lalu pilih <em>Lanjutkan</em> dengan berkas yang sama, atau batalkan.</p></div></div>`);
   refresh();
  }
 });
}
async function cancelHistory(){
 const c=M.history?.current;if(!c)return;
 if(!await confirmDialog('Batalkan migrasi awal?',`Seluruh rekap dari <strong>${esc(c.file_name)}</strong> dihapus dari portal, sehingga Dashboard dan Laporan kembali seperti sebelum impor. Spreadsheet NilaiGuide tidak terpengaruh. Setelah itu migrasi bisa diulang.`,'Batalkan migrasi','danger'))return;
 await post('visits/history/cancel',{import_id:c.id});toast('Migrasi awal dibatalkan.');refresh();
}

/* ---------- Penilaian ---------- */
function recordRow(r){
 const replaced=r.status==='diganti',v2=r.versi===2;
 // Penilaian cara lama ditampilkan dengan pemetaannya, plus angka aslinya.
 const lama=v2?'':`<br><span class="muted text-small">cara lama: Uniform ${esc(uniformLabel[String(r.uniform)]||r.uniform)}, Etika ${esc(signed(r.etika))}</span>`;
 const teguran=v2?(r.teguran.length?r.teguran.map(k=>esc(typeLabel(k))).join('<br>'):'—'):(r.teguranN?`${number(r.teguranN)} (dari Etika minus)`:'—');
 const laporan=[r.berat?`<span class="badge negative">Pelanggaran berat</span><br><span class="text-small">${esc(typeLabel(r.berat))}</span>`:'',r.apresiasi?`<span class="badge positive">Apresiasi</span><br><span class="text-small">${esc(typeLabel(r.apresiasi))}</span>`:''].filter(Boolean).join('<br>')||'—';
 return `<tr class="${replaced?'visit-dim':''}"><td>${when(r.timestamp)}</td><td>Pos ${esc(r.pos)}</td><td><strong>${esc(r.guideName)}</strong><br><span class="muted text-small">${esc(r.guideId)} · ${esc(r.regu||'—')}</span></td><td>${r.idCard?'Terpasang':'<strong>Tidak</strong>'}</td><td>${esc(seragamLabel[r.seragam]||r.seragam)}${lama}</td><td>${teguran}</td><td>${laporan}</td><td>${esc(r.petugas||'—')}</td><td><strong>${score(r.nilai)}</strong></td><td>${esc(r.catatan||'')}</td><td>${replaced?`Diganti${r.digantiOleh?`<br><span class="muted text-small">oleh ${esc(r.digantiOleh.slice(0,8))}</span>`:''}`:r.koreksiDari?`Koreksi<br><span class="muted text-small">dari ${esc(r.koreksiDari.slice(0,8))}</span>`:'Aktif'}</td></tr>`;
}
// Label jenis temuan dari Aturan Nilai (dimuat bersama halaman), atau kodenya.
const typeLabel=code=>(M.scoring?.jenis||[]).find(t=>t.kode===code)?.label||code;
function recordsPage(){
 const f=M.recordFilter,sel=(key,label,opts)=>`<label class="field"><span>${label}</span><select data-visit-filter="${key}"><option value="">Semua</option>${opts.map(([v,t])=>`<option value="${v}" ${f[key]===v?'selected':''}>${t}</option>`).join('')}</select></label>`;
 const exportButton=permitted('visits.reports.export')?btn('Ekspor Excel','export-records','download','outlined'):'';
 const folded=M.recordsFolded&&M.from<=M.recordsFolded?`<div class="notice">${icon('document')}<div><strong>Rincian lama ada di spreadsheet</strong><p>Portal menyimpan rincian penilaian 6 minggu terakhir. Penilaian sampai ${esc(formatDate(M.recordsFolded))} dibuka di spreadsheet tahunan (Tautan Pos → Salinan spreadsheet).</p></div></div>`:'';
 return `${head('Penilaian Guide',`${number(M.recordsTotal)} penilaian ${formatDate(M.from)} – ${formatDate(M.to)}, terbaru dulu. Hanya baca; salah pencet hari ini dibetulkan dari HP pos.`,exportButton)}
 ${filters(sel('pos','Pos',[['1','Pos 1'],['3','Pos 3']])+sel('regu','Regu',regu.map(r=>[r,r]))+sel('status','Status',[['aktif','Aktif'],['diganti','Diganti koreksi']]))}
 ${folded}${table(['Waktu WITA','Pos','Guide','ID-Card','Seragam','Teguran','Laporan','Petugas','Nilai','Catatan','Status'],M.records.map(recordRow))}
 ${M.recordsMore?`<div class="actions visit-more">${btn(`Muat ${number(Math.min(1000,M.recordsTotal-M.records.length))} berikutnya`,'records-more','arrow','outlined')}</div>`:''}`;
}
const recordQuery=offset=>{const f=M.recordFilter,q=new URLSearchParams({from:M.from,to:M.to,limit:'1000',offset:String(offset)});for(const k of ['pos','regu','status'])if(f[k])q.set(k,f[k]);return q.toString();};
async function loadRecords(append=false){
 const data=await api(`visits/records?${recordQuery(append?M.records.length:0)}`);
 M.records=append?[...M.records,...data.items]:data.items;M.recordsMore=data.more;M.recordsTotal=data.total;M.recordsFolded=data.folded_through;
}

/* ---------- Tautan Pos ---------- */
const linkUrl=token=>`${location.origin}/penilaian-guide/#${token}`;
function sheetCard(s){
 if(!s)return '';
 const files=s.files.length?s.files.map(f=>f.url?`<a class="button outlined" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${icon('document')}<span>Penilaian Guide ${esc(f.year)}</span></a>`:`<span class="badge neutral">Penilaian Guide ${esc(f.year)}</span>`).join(''):'<span class="muted">Spreadsheet tahun berjalan dibuat saat penilaian pertama disalin.</span>';
 const actions=s.can_sync?`${btn('Sinkronkan sekarang','sheet-sync','refresh','outlined')}${btn('Periksa koneksi','sheet-check','shield','text')}`:'';
 return card('Salinan spreadsheet',`Folder SPH-Portal-Kunjungan di Google Drive portal · satu file per tahun, satu tab per bulan. Rincian di portal disimpan ${number(s.retention_days/7)} minggu, lalu hanya di spreadsheet.`,`<div class="card-body">
  ${s.last_error?`<div class="notice warning">${icon('incident')}<div><strong>Penyalinan tertunda</strong><p>${esc(s.last_error)}</p><p class="muted">Sejak ${esc(when(s.last_error_at))}. Penilaian tetap tersimpan di portal; tidak ada yang dihapus sampai tersalin dan dicocokkan.</p></div></div>`:''}
  <div class="visit-sheet-grid"><div><span class="muted">Menunggu disalin</span><strong>${number(s.pending+s.dirty)}</strong></div><div><span class="muted">Terakhir tersinkron</span><strong>${s.last_success_at?esc(when(s.last_success_at)):'belum pernah'}</strong></div><div><span class="muted">Rincian tersimpan di portal</span><strong>${number(s.rows)} baris</strong></div><div><span class="muted">Sudah hanya di spreadsheet</span><strong>${s.folded_through?`sampai ${esc(formatDate(s.folded_through))}`:'belum ada'}</strong></div></div>
  <div class="actions visit-sheet-files">${files}${s.folder_url?`<a class="button text" href="${esc(s.folder_url)}" target="_blank" rel="noopener noreferrer">${icon('folder')}<span>Buka folder</span></a>`:''}</div>
  <p class="muted visit-note">Penilaian yang tertahan di HP lebih dari ${number(s.max_age_days)} hari tidak diterima lagi, supaya kiriman ulang yang sangat terlambat tidak tercatat dua kali.</p></div>`,actions);
}
function linksPage(){
 const manage=M.links.can_manage;
 const cards=M.links.items.map(item=>{
  const l=item.link;
  const actions=manage?(l?`${btn('Salin tautan','link-copy','document','outlined',`data-pos="${item.pos}"`)}${btn('Tampilkan QR','link-qr','eye','outlined',`data-pos="${item.pos}"`)}${btn('Ganti','link-rotate','refresh','outlined',`data-pos="${item.pos}"`)}${btn('Cabut','link-revoke','close','text',`data-pos="${item.pos}"`)}`:btn('Buat tautan','link-create','plus','primary',`data-pos="${item.pos}"`)):'';
  return card(item.label,l?`Aktif sejak ${when(l.created_at)}${l.created_by_name?` · dibuat ${l.created_by_name}`:''}`:'Belum ada tautan aktif.',`<div class="card-body"><div class="visit-link-row"><div><p>Kiriman terakhir: <strong>${item.last_received_at?when(item.last_received_at):'belum ada'}</strong></p><p class="muted">24 jam terakhir: ${number(item.accepted_24h)} diterima · ${number(item.rejected_24h)} ditolak</p></div><div class="actions">${actions}</div></div></div>`);
 }).join('');
 const recent=table(['Waktu','Pos','Hasil','Alasan'],M.links.recent.map(r=>`<tr><td>${when(r.received_at)}</td><td>Pos ${esc(r.pos)}</td><td>${esc({ACCEPTED:'Diterima',DUPLICATE:'Kiriman ulang',REJECTED:'Ditolak'}[r.outcome]||r.outcome)}</td><td>${esc({JEDA:'Jeda < 15 menit',KOREKSI:'Koreksi tidak sah',GUIDE:'Guide tidak terdaftar',WAKTU:'Tertahan di HP > 30 hari',POS:'Pos tidak sesuai',VALIDASI:'Isian tidak valid'}[r.reason]||'—')}</td></tr>`),'Belum ada kiriman.');
 return `${head('Tautan Pos','Satu tautan aktif per pos. HP pos menyimpan tautan saat pertama dibuka; petugas tidak perlu login dan tidak dicatat namanya.')}
 <div class="notice">${icon('shield')}<div><strong>Perlakukan tautan pos seperti kunci</strong><p>Siapa pun yang memegang tautan bisa mengirim penilaian untuk pos itu. Bila tautan tersebar ke luar petugas pos, tekan Ganti. Penilaian yang masih tersimpan di HP menunggu sampai HP membuka tautan baru, tidak hilang.</p><p>Pindahkan HP satu per satu: HP yang belum memakai tautan portal tetap memakai aplikasi lama seperti biasa.</p></div></div>
 <div class="visit-grid">${cards}</div><div class="visit-stack">${sheetCard(M.sheet)}${card('Catatan kiriman terbaru','Tanpa nama guide, nilai, atau catatan. Disimpan 90 hari.',recent)}</div>`;
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
async function sheetAction(action){
 if(action==='sheet-sync'){
  const r=await post('visits/sheet/sync',{});
  if(r.busy){toast('Penyalinan sedang berjalan. Coba lagi sebentar.');return;}
  if(!r.ok)throw new Error(r.error||'Penyalinan belum berhasil.');
  toast(`${number(r.written)} baris baru disalin${r.rewritten?`, ${number(r.rewritten)} diperbarui`:''}${r.deleted?`, ${number(r.deleted)} baris lama kini hanya di spreadsheet`:''}.`);refresh();return;
 }
 const r=await post('visits/sheet/check',{});
 dialog('Periksa koneksi spreadsheet',`<ol class="visit-check">${r.steps.map(s=>`<li class="${s.ok?'ok':'fail'}">${icon(s.ok?'check':'incident')}<div><strong>${esc(s.label)}</strong><p>${esc(s.message)}</p></div></li>`).join('')}</ol>
  ${r.ok?'<p>Koneksi siap. Tidak ada berkas yang dibuat atau diubah oleh pemeriksaan ini.</p>':'<p>Perbaiki langkah yang gagal di pengaturan Google Cloud/Supabase, lalu periksa lagi. Penilaian tetap tersimpan di portal selama koneksi belum siap.</p>'}
  <div class="form-actions"><button type="button" class="button primary" data-close>Tutup</button></div>`);
}

/* ---------- Laporan & Ekspor ---------- */
function reportsPage(){
 const d=M.report,canExport=permitted('visits.reports.export'),s=d.ringkasan,a=d.aturan;
 const perGuide=d.perGuide.map(g=>`<tr><td>${number(g.peringkat)}</td><td><strong>${esc(g.nama)}</strong><br><span class="muted text-small">${esc(g.guideId)}</span></td><td>${esc(g.regu)}</td><td>${number(g.antar)}</td><td><strong>${score(g.nilai)}</strong></td><td>${rewardCell(g)}</td><td>${pct(g.persenId)}</td><td>${pct(g.persenSeragam)}</td><td>${number(g.teguran)}</td><td>${number(g.berat)}</td><td>${number(g.apresiasi)}</td></tr>`);
 return `${head('Laporan & Ekspor',`Ringkasan bulan ${monthLabel(M.month)} per guide. ${ruleNote(d)}`,canExport?btn('Ekspor Excel','export-report','download','primary'):'')}
 <div class="toolbar"><label class="field"><span>Bulan</span><input type="month" data-visit-field="month" value="${esc(M.month)}" max="${localToday().slice(0,7)}"></label>${btn('Tampilkan','apply-month','filter','outlined')}</div>
 <div class="stats-grid">${stat('Pengantaran',number(s.pengantaran))}${stat('Guide dinilai',number(s.guideDinilai))}${stat('Nilai rata-rata',score(s.nilai))}${stat('Layak reward',s.layak==null?'—':number(s.layak),a?`nilai ≥ ${a.ambang}, minimal ${a.minimal} pengantaran, tanpa pelanggaran berat`:'')}</div>
 ${s.berat.menunggu?`<div class="notice warning">${icon('incident')}<div><strong>${number(s.berat.menunggu)} laporan pelanggaran berat belum diputuskan</strong><p>Putuskan di Verifikasi sebelum reward bulan ini dibagikan.</p></div></div>`:''}
 <div class="visit-stack">${card('Ringkasan per guide','Diurut menurut nilai. Bila reward terbatas: nilai lebih tinggi didahulukan, lalu apresiasi terverifikasi; selebihnya setara. Jumlah hari dan rincian temuan ada di Ekspor Excel.',table(['#','Guide','Regu','Antar','Nilai','Status reward','% ID','% seragam','Teguran','Berat','Apresiasi'],perGuide))}
 ${historyCard(M.history)}</div>
 <p class="muted visit-note">${esc(periodNote(d).trim())} Diperbarui ${when(d.diperbarui)}.</p>`;
}
const monthEnd=month=>{const [y,m]=month.split('-').map(Number);const last=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);return last>localToday()?localToday():last;};
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
const guideColumns=[{header:'Peringkat',key:'peringkat',kind:'number'},{header:'guideId',key:'guideId'},{header:'Nama',key:'nama',width:30},{header:'Regu',key:'regu'},{header:'Kategori',key:'kategori'},{header:'Pengantaran',key:'antar',kind:'number'},{header:'Hari',key:'hari',kind:'number'},
 {header:'Nilai (100 − potongan)',key:'nilai',kind:'number'},{header:'Tanpa ID',key:'tanpaId',kind:'number'},{header:'Kurang lengkap',key:'kurangLengkap',kind:'number'},{header:'Tidak berseragam',key:'tidakBerseragam',kind:'number'},{header:'Teguran',key:'teguran',kind:'number'},
 {header:'% ID terpasang',key:'persenId',kind:'number'},{header:'% seragam lengkap',key:'persenSeragam',kind:'number'},{header:'Pelanggaran berat terverifikasi',key:'berat',kind:'number'},{header:'Laporan berat menunggu',key:'beratMenunggu',kind:'number'},{header:'Apresiasi terverifikasi',key:'apresiasi',kind:'number'},{header:'Status reward',key:'statusReward',width:28}];
const rewardText=g=>g.status?`${(rewardBadge[g.status]||[null,g.status])[1]}${g.beratMenunggu?' (ada laporan berat menunggu)':''}`:'';
const guideRows=list=>list.map(g=>({...g,nilai:g.nilai==null?null:Math.round(g.nilai*100)/100,statusReward:rewardText(g)}));
async function exportRecords(){
 const rows=[];
 for(let offset=0;;offset+=1000){const page=await api(`visits/records?${recordQuery(offset)}`);rows.push(...page.items);if(!page.more)break;if(offset>=49000)throw new Error('Lebih dari 50.000 baris. Persempit rentang tanggal.');}
 if(!rows.length)throw new Error('Tidak ada penilaian pada saringan ini.');
 // Rentang yang memotong data lama (422) tetap bisa diekspor rinciannya, tanpa ringkasan.
 const summary=await api(`visits/overview?${range()}`).catch(error=>{if(error.status===422)return null;throw error;});
 const columns=['evaluationId','timestamp','tanggal','pos','guideId','guideName','regu','versi','idCard','seragam','teguran','berat','apresiasi','petugas','nilai','uniform','etika','catatan','receivedAt','koreksiDari','status','digantiOleh'].map(key=>({header:key,key,kind:['pos','versi','uniform','idCard','etika','nilai'].includes(key)?'number':key==='catatan'?'notes':'text',width:key==='catatan'?40:undefined}));
 const flat=rows.map(r=>({...r,teguran:r.teguran.join(', ')}));
 download(createXlsx([{name:'Penilaian',columns,rows:flat},...(summary?[{name:'Ringkasan per guide',columns:guideColumns,rows:guideRows(summary.perGuide)}]:[])]),`penilaian-guide-${M.from}-sd-${M.to}.xlsx`);
 await post('visits/exports',{kind:'records',from:M.from,to:M.to,rows:rows.length});
 toast(`${number(rows.length)} penilaian diekspor.`);
}
async function exportReport(){
 const d=M.report;
 download(createXlsx([{name:'Ringkasan per guide',columns:guideColumns,rows:guideRows(d.perGuide)}]),`laporan-penilaian-guide-${M.month}.xlsx`);
 await post('visits/exports',{kind:'summary',from:d.from,to:d.to,rows:d.perGuide.length});
 toast('Laporan bulanan diekspor.');
}

/* ---------- Verifikasi laporan pelanggaran berat & apresiasi ---------- */
const flagStatusLabel={menunggu:['warm','Menunggu'],disetujui:['positive','Disetujui'],ditolak:['neutral','Ditolak'],dibatalkan:['neutral','Dibatalkan (penilaian dikoreksi)']};
function flagRow(f,manage){
 const [kind,label]=flagStatusLabel[f.status]||['neutral',f.status];
 const actions=!manage?'':f.status==='menunggu'?`${btn('Setujui','flag-approve','check','primary',`data-id="${esc(f.id)}"`)}${btn('Tolak','flag-reject','close','outlined',`data-id="${esc(f.id)}"`)}`:['disetujui','ditolak'].includes(f.status)?btn('Buka kembali','flag-reopen','refresh','text',`data-id="${esc(f.id)}"`):'';
 return `<tr><td>${esc(formatDate(f.tanggal))}<br><span class="muted text-small">${esc(formatTime(f.waktu))} · Pos ${esc(f.pos)}</span></td><td><strong>${esc(f.guideName)}</strong><br><span class="muted text-small">${esc(f.guideId)} · ${esc(f.regu||'—')}</span></td>
  <td><span class="badge ${f.jenis==='berat'?'negative':'positive'}">${f.jenis==='berat'?'Pelanggaran berat':'Apresiasi'}</span><br>${esc(f.label)}</td><td>${esc(f.catatan)}</td><td>${esc(f.petugas||'—')}</td>
  <td><span class="badge ${kind}">${esc(label)}</span>${f.diputuskanPada?`<br><span class="muted text-small">${esc(f.diputuskanOleh)} · ${esc(when(f.diputuskanPada))}</span>`:''}${f.keputusanCatatan?`<br><span class="muted text-small">${esc(f.keputusanCatatan)}</span>`:''}</td>${manage?`<td><div class="actions">${actions}</div></td>`:''}</tr>`;
}
function flagsPage(){
 const d=M.flags,manage=d.can_decide;
 const sel=(key,label,opts)=>`<label class="field"><span>${label}</span><select data-visit-field="${key}"><option value="">Semua</option>${opts.map(([v,t])=>`<option value="${v}" ${M[key]===v?'selected':''}>${t}</option>`).join('')}</select></label>`;
 return `${head('Verifikasi Laporan','Pelanggaran berat dan apresiasi yang dilaporkan petugas pos. Pelanggaran berat yang disetujui menggugurkan reward guide bulan itu; apresiasi yang disetujui menjadi penentu bila nilai sama.')}
 ${d.menunggu_semua?`<div class="notice warning">${icon('incident')}<div><strong>${number(d.menunggu_semua)} laporan menunggu keputusan</strong><p>${manage?'Periksa catatan petugas, lalu setujui atau tolak. Setiap keputusan diaudit dan bisa dibuka kembali bila salah pilih.':'Keputusan diambil Pengelola Kunjungan.'}</p></div></div>`:`<p class="muted visit-note">Tidak ada laporan yang menunggu keputusan.</p>`}
 <div class="toolbar"><label class="field"><span>Dari tanggal</span><input type="date" data-visit-field="flagFrom" value="${esc(M.flagFrom)}" max="${localToday()}"></label><label class="field"><span>Sampai tanggal</span><input type="date" data-visit-field="flagTo" value="${esc(M.flagTo)}" max="${localToday()}"></label>
 ${sel('flagStatus','Status',[['menunggu','Menunggu'],['disetujui','Disetujui'],['ditolak','Ditolak'],['dibatalkan','Dibatalkan']])}${sel('flagJenis','Jenis',[['berat','Pelanggaran berat'],['apresiasi','Apresiasi']])}${btn('Terapkan','apply','filter','outlined')}</div>
 ${table(['Waktu','Guide','Laporan','Catatan petugas','Petugas','Status',...(manage?['']:[])],d.items.map(f=>flagRow(f,manage)),'Tidak ada laporan pada saringan ini.')}
 ${d.items.length>=d.batas?`<p class="muted visit-note">Menampilkan ${number(d.batas)} laporan pertama. Persempit rentang tanggal.</p>`:''}`;
}
const flagQuery=()=>{const q=new URLSearchParams({from:M.flagFrom,to:M.flagTo});if(M.flagStatus)q.set('status',M.flagStatus);if(M.flagJenis)q.set('jenis',M.flagJenis);return q.toString();};
async function flagAction(action,id){
 const f=M.flags.items.find(x=>x.id===id);if(!f)return;
 const send=async(tindakan,catatan='')=>{await post('visits/flags/decide',{id:f.id,row_version:f.row_version,action:tindakan,catatan});};
 if(action==='flag-approve'){
  if(!await confirmDialog(f.jenis==='berat'?'Setujui pelanggaran berat?':'Setujui apresiasi?',f.jenis==='berat'?`<strong>${esc(f.guideName)}</strong> gugur reward bulan ${esc(monthLabel(f.tanggal.slice(0,7)))}. Keputusan diaudit dan bisa dibuka kembali.`:`Apresiasi untuk <strong>${esc(f.guideName)}</strong> dipakai sebagai penentu bila nilainya sama dengan guide lain.`,'Setujui'))return;
  await send('setujui');toast('Laporan disetujui.');refresh();return;
 }
 if(action==='flag-reopen'){await send('buka');toast('Laporan dibuka kembali.');refresh();return;}
 formDialog('Tolak laporan',`<p class="full">${esc(f.label)} — <strong>${esc(f.guideName)}</strong>, ${esc(formatDate(f.tanggal))}.</p><label class="field full"><span>Alasan penolakan</span><textarea name="catatan" rows="3" maxlength="500" required></textarea></label>`,
  async data=>{await send('tolak',data.catatan);toast('Laporan ditolak.');refresh();},{submit:'Tolak laporan'});
}

/* ---------- Aturan nilai, jenis temuan, petugas, petunjuk ---------- */
const kindLabel={teguran:'Teguran',berat:'Pelanggaran berat',apresiasi:'Apresiasi'};
function scoringPage(){
 const d=M.scoring,manage=d.can_manage,a=d.aturan,now=a.berlaku,next=a.bulan_depan_aturan;
 const ruleRow=r=>`<tr><td>${esc(monthLabel(r.berlaku_mulai))}</td><td>−${number(r.pot_id)}</td><td>−${number(r.pot_kurang)}</td><td>−${number(r.pot_tidak)}</td><td>−${number(r.pot_teguran)}</td><td>${number(r.ambang)}</td><td>${number(r.minimal)}</td><td>${r.berlaku_mulai>a.bulan_ini?`<span class="badge warm">Rencana</span>${manage?` ${btn('Batalkan','rule-delete','close','text',`data-month="${esc(r.berlaku_mulai)}"`)}`:''}`:r.berlaku_mulai===now.berlaku_mulai?'<span class="badge positive">Berlaku</span>':'<span class="muted">Riwayat</span>'}</td></tr>`;
 const types=k=>d.jenis.filter(t=>t.jenis===k).map(t=>`<tr class="${t.aktif?'':'visit-dim'}"><td>${esc(t.label)}<br><span class="muted text-small">${esc(t.kode)}</span></td><td>${t.perlu_catatan?'Wajib':'Tidak'}</td><td>${t.aktif?'Aktif':'Nonaktif'}</td>${manage?`<td>${btn('Ubah','type-edit','settings','text',`data-kode="${esc(t.kode)}"`)}</td>`:''}</tr>`);
 const typeCard=k=>card(kindLabel[k],k==='teguran'?'Dipilih petugas, paling banyak 2 per pengantaran. Setiap teguran dipotong sesuai aturan.':k==='berat'?'Tidak dirata-rata. Bila disetujui Pengelola, guide gugur reward bulan itu.':'Tidak masuk nilai. Bila disetujui, menjadi penentu saat nilai sama.',
  table(['Jenis','Catatan','Status',...(manage?['']:[])],types(k)),manage?btn('Tambah','type-new','plus','outlined',`data-jenis="${k}"`):'');
 return `${head('Aturan Nilai','Nilai pengantaran = 100 − potongan. Petugas pos hanya mencatat fakta; besar potongan ditetapkan di sini. Perubahan berlaku mulai bulan depan dan diaudit.')}
 <div class="stats-grid">${stat('Tanpa ID-Card',`−${now.pot_id}`)}${stat('Seragam kurang lengkap',`−${now.pot_kurang}`)}${stat('Tidak berseragam',`−${now.pot_tidak}`)}${stat('Per teguran',`−${now.pot_teguran}`,'paling banyak 2 per pengantaran')}${stat('Ambang layak reward',number(now.ambang))}${stat('Minimal pengantaran',number(now.minimal),'di bawahnya: belum cukup data')}</div>
 <div class="visit-stack">${card(`Aturan bulan ${monthLabel(a.bulan_ini)} dan sesudahnya`,`${monthLabel(a.bulan_depan)}: ${ruleLine(next)}, ambang ${next.ambang}, minimal ${next.minimal} pengantaran. Aturan bulan berjalan tidak bisa diubah.`,
  table(['Berlaku mulai','Tanpa ID','Kurang lengkap','Tidak berseragam','Per teguran','Ambang','Minimal','Status'],a.riwayat.slice().reverse().map(ruleRow)),manage?btn(`Atur ${monthLabel(a.bulan_depan)}`,'rule-edit','settings','primary'):'')}
 <div class="visit-grid">${typeCard('teguran')}${typeCard('berat')}</div>${typeCard('apresiasi')}
 ${manage?card('Petugas penilai','Dipilih petugas sekali per shift di HP pos (berlaku 8 jam). Nama yang dinonaktifkan tidak muncul lagi di HP.',table(['Nama','Keterangan','Status',''],d.petugas.map(p=>`<tr class="${p.aktif?'':'visit-dim'}"><td><strong>${esc(p.nama)}</strong></td><td>${esc(p.keterangan||'—')}</td><td>${p.aktif?'Aktif':'Nonaktif'}</td><td>${btn('Ubah','assessor-edit','settings','text',`data-id="${esc(p.id)}"`)}</td></tr>`),'Belum ada petugas. Tanpa daftar ini, HP pos menyimpan penilaian tanpa nama petugas.'),btn('Tambah petugas','assessor-new','plus','outlined')):''}
 ${card('Petunjuk di formulir pos','Tampil di bawah tombol ID-Card dan Seragam, supaya Pos 1 dan Pos 3 memakai patokan yang sama.',`<div class="card-body"><p><strong>ID-Card:</strong> ${esc(d.petunjuk.petunjuk_id)}</p><p><strong>Seragam:</strong> ${esc(d.petunjuk.petunjuk_seragam)}</p></div>`,manage?btn('Ubah petunjuk','form-edit','settings','outlined'):'')}</div>
 <p class="muted visit-note">HP pos memperbarui daftar jenis, petugas, dan petunjuk bersama daftar guide (paling lama 10 menit, atau lewat Pengaturan → Tes Koneksi).</p>`;
}
function ruleDialog(){
 const a=M.scoring.aturan,r=a.bulan_depan_aturan,num=(name,label,min,max)=>`<label class="field"><span>${label}</span><input type="number" name="${name}" min="${min}" max="${max}" step="1" required value="${esc(r[name])}"></label>`;
 formDialog(`Aturan mulai ${monthLabel(a.bulan_depan)}`,`${num('pot_id','Potongan tanpa ID-Card',0,50)}${num('pot_kurang','Potongan seragam kurang lengkap',0,50)}${num('pot_tidak','Potongan tidak berseragam',0,50)}${num('pot_teguran','Potongan per teguran',0,50)}${num('ambang','Ambang layak reward',50,100)}${num('minimal','Minimal pengantaran sebulan',1,60)}`,
  async data=>{await post('visits/scoring/rule',{...data,berlaku_mulai:a.bulan_depan});toast(`Aturan ${monthLabel(a.bulan_depan)} disimpan.`);refresh();},
  {note:'Potongan terbesar per pengantaran (tanpa ID + tidak berseragam + 2 teguran) paling banyak 100, dan "kurang lengkap" tidak boleh lebih besar dari "tidak berseragam". Bulan berjalan tetap memakai aturannya.'});
}
function typeDialog(t,jenis){
 const k=t?t.jenis:jenis;
 formDialog(t?`Ubah ${kindLabel[k].toLowerCase()}`:`Tambah ${kindLabel[k].toLowerCase()}`,`<label class="field full"><span>Nama jenis</span><input name="label" maxlength="80" required value="${esc(t?.label||'')}"></label>
  ${k==='teguran'?`<label class="check-field full"><input type="checkbox" name="perlu_catatan" ${t?.perlu_catatan?'checked':''}><span>Wajib disertai catatan (mis. "teguran lain")</span></label>`:''}
  <label class="check-field full"><input type="checkbox" name="aktif" ${!t||t.aktif?'checked':''}><span>Aktif — tampil di HP pos</span></label>`,
  async data=>{await post('visits/scoring/types',{...(t?{kode:t.kode,row_version:t.row_version}:{jenis:k}),label:data.label,perlu_catatan:data.perlu_catatan===true,aktif:data.aktif===true});toast('Jenis temuan disimpan.');refresh();},
  {note:t?'Kode tidak berubah, jadi penilaian lama tetap merujuk jenis ini. Jenis tidak dihapus, hanya dinonaktifkan.':'Kode dibentuk dari nama dan tidak pernah dipakai ulang.'});
}
function assessorDialog(p){
 formDialog(p?'Ubah petugas':'Tambah petugas',`<label class="field full"><span>Nama petugas</span><input name="nama" maxlength="120" required value="${esc(p?.nama||'')}"></label><label class="field full"><span>Keterangan (mis. pos atau unit)</span><input name="keterangan" maxlength="80" value="${esc(p?.keterangan||'')}"></label>
  <label class="check-field full"><input type="checkbox" name="aktif" ${!p||p.aktif?'checked':''}><span>Aktif — bisa dipilih di HP pos</span></label>`,
  async data=>{await post('visits/scoring/assessors',{...(p?{id:p.id,row_version:p.row_version}:{}),nama:data.nama,keterangan:data.keterangan,aktif:data.aktif===true});toast('Petugas disimpan.');refresh();});
}
function formSettingsDialog(){
 const f=M.scoring.petunjuk;
 formDialog('Petunjuk di formulir pos',`<label class="field full"><span>ID-Card</span><textarea name="petunjuk_id" rows="2" maxlength="300" required>${esc(f.petunjuk_id)}</textarea></label><label class="field full"><span>Seragam (daftar atribut wajib)</span><textarea name="petunjuk_seragam" rows="4" maxlength="500" required>${esc(f.petunjuk_seragam)}</textarea></label>`,
  async data=>{await post('visits/scoring/form',{...data,row_version:f.row_version});toast('Petunjuk disimpan. HP pos memakainya setelah daftar diperbarui.');refresh();},{wide:true});
}

export async function loadVisitsPage(route){
 try{
  if(route==='visits'){
   const [overview,activity,sheet]=await Promise.all([api(`visits/overview?${range()}`),api('visits/activity').catch(()=>null),api('visits/sheet').catch(()=>null)]);
   M.overview=overview;M.activity=activity;M.sheet=sheet;return dashboard();
  }
  if(route==='visits-guides'){M.guides=(await api('visits/guides')).items;return guidesPage();}
  if(route==='visits-records'){const [,scoring]=await Promise.all([loadRecords(),api('visits/scoring').catch(()=>null)]);M.scoring=scoring;return recordsPage();}
  if(route==='visits-flags'){M.flags=await api(`visits/flags?${flagQuery()}`);return flagsPage();}
  if(route==='visits-scoring'){M.scoring=await api('visits/scoring');return scoringPage();}
  if(route==='visits-links'){const [links,sheet]=await Promise.all([api('visits/links'),api('visits/sheet').catch(()=>null)]);M.links=links;M.sheet=sheet;return linksPage();}
  if(route==='visits-reports'){const [report,history]=await Promise.all([api(`visits/overview?from=${M.month}-01&to=${monthEnd(M.month)}`),permitted('visits.settings.manage')?api('visits/history').catch(()=>null):null]);M.report=report;M.history=history;return reportsPage();}
 }catch(error){if(error.name==='AbortError')throw error;return unavailable(visitTitles[route],error);}
 return unavailable(visitTitles[route]);
}

export function bindVisitsPage(){
 const root=document.querySelector('#main');if(!root||root.dataset.visitBound)return;root.dataset.visitBound='1';
 root.addEventListener('input',e=>{const key=e.target.dataset?.visitField;if(!key)return;M[key]=e.target.value;if(['guideQuery','guideKategori','guideRegu','guideAktif'].includes(key)&&state.route==='visits-guides')rerender(guidesPage,e.target);});
 root.addEventListener('change',e=>{const key=e.target.dataset?.visitFilter;if(key)M.recordFilter[key]=e.target.value;const field=e.target.dataset?.visitField;if(field&&e.target.tagName==='SELECT')M[field]=e.target.value;});
 root.addEventListener('click',async e=>{
  const el=e.target.closest('[data-visit]');if(!el||!visitRoutes.includes(state.route))return;
  const action=el.dataset.visit;el.disabled=true;
  try{
   if(action==='apply'||action==='retry'){if(M.from>M.to||M.flagFrom>M.flagTo)throw new Error('Tanggal mulai harus sebelum tanggal akhir.');refresh();return;}
   if(action==='apply-month'){refresh();return;}
   if(action==='guide-new'){guideForm(null);return;}
   if(action==='guide-import'){importDialog();return;}
   if(action==='guide-edit'){guideForm(M.guides.find(g=>g.guideId===el.dataset.id));return;}
   if(action==='records-more'){await loadRecords(true);root.innerHTML=recordsPage();return;}
   if(action==='export-records'){await exportRecords();return;}
   if(action==='export-report'){await exportReport();return;}
   if(action==='history-start'){historyDialog(M.history);return;}
   if(action==='history-cancel'){await cancelHistory();return;}
   if(action.startsWith('sheet-')){await sheetAction(action);return;}
   if(action.startsWith('link-')){await linkAction(action,Number(el.dataset.pos));return;}
   if(action.startsWith('flag-')){await flagAction(action,el.dataset.id);return;}
   if(action==='rule-edit'){ruleDialog();return;}
   if(action==='rule-delete'){if(!await confirmDialog('Batalkan rencana aturan?',`Aturan ${esc(monthLabel(el.dataset.month))} kembali memakai aturan sebelumnya.`,'Batalkan rencana','danger'))return;await post('visits/scoring/rule-delete',{berlaku_mulai:el.dataset.month});toast('Rencana aturan dibatalkan.');refresh();return;}
   if(action==='type-new'){typeDialog(null,el.dataset.jenis);return;}
   if(action==='type-edit'){typeDialog(M.scoring.jenis.find(t=>t.kode===el.dataset.kode));return;}
   if(action==='assessor-new'){assessorDialog(null);return;}
   if(action==='assessor-edit'){assessorDialog(M.scoring.petugas.find(p=>p.id===el.dataset.id));return;}
   if(action==='form-edit'){formSettingsDialog();return;}
  }catch(error){toast(error.message,true);}
  finally{el.disabled=false;}
 });
}
// Saringan Data Guide digambar ulang tanpa memuat ulang data; fokus ketikan dipertahankan.
function rerender(render,target){const root=document.querySelector('#main'),key=target.dataset.visitField,pos=target.selectionStart;root.innerHTML=render();const next=root.querySelector(`[data-visit-field="${key}"]`);if(next){next.focus();if(pos!=null&&next.setSelectionRange)try{next.setSelectionRange(pos,pos);}catch{}}}
