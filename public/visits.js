import {api,post,permitted,refresh,state} from './api.js';
import {esc,icon,toast,dialog,formDialog,localToday,formatDate,formatTime,number} from './ui.js';
import {createXlsx} from './xlsx-export.js';
import {encodeQR} from './vendor/qr.js';
import {readGuideFile,readHistoryFile,historyParts} from './visit-import.js';
import {mountTrend,rangeLabel} from './visit-trend.js';

// Ruang kerja Pengelolaan Kunjungan. Penilaian guide masuk dari tautan pos ke basis
// data portal, lalu disalin otomatis ke spreadsheet tahunan di Google Drive portal.
// Rincian penilaian disimpan 6 minggu; periode lebih lama dihitung dari rekap harian,
// rinciannya di spreadsheet. Riwayat NilaiGuide masuk sekali lewat migrasi awal
// (kartu di Laporan & Ekspor); aplikasi dan spreadsheet NilaiGuide tidak disentuh.
// Nilai pengantaran = 100 − potongan (keputusan pemilik 11 November 2026): petugas pos
// mencatat fakta, bobot potongan diatur per bulan di Aturan Nilai, dan laporan
// pelanggaran berat/apresiasi diputuskan Pengelola di Verifikasi.
// Review negatif & komplain (23 November 2026): dicatat petugas lewat menu HP pos dan diputuskan
// di Verifikasi. Review memotong nilai akhir bulan itu; komplain (dan pelanggaran berat)
// menghapus nilai bulan itu, gugur reward, dan tidak diperingkat.
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
 records:[],recordsMore:false,recordsTotal:0,recordsFolded:null,recordFilter:{pos:'',regu:'',status:''},links:null,report:null,reportMode:null,reportDay:null,reportWeek:null,trendScope:'hari',
 flags:null,guestReports:null,flagFrom:shiftDay(localToday(),-90),flagTo:localToday(),flagStatus:'menunggu',flagJenis:'',scoring:null};
const regu=['A1','A2','D1','D2'];
const head=(title,note,actions='')=>`<div class="page-heading"><div><h1>${esc(title)}</h1><p>${esc(note)}</p></div><div class="actions">${actions}</div></div>`;
const btn=(label,visit,ico='plus',kind='primary',extra='')=>`<button type="button" class="button ${kind}" data-visit="${visit}" ${extra}>${icon(ico)}<span>${esc(label)}</span></button>`;
const card=(title,sub,body,actions='')=>`<section class="card"><header class="card-header"><div><h2>${esc(title)}</h2>${sub?`<p>${esc(sub)}</p>`:''}</div>${actions?`<div class="actions">${actions}</div>`:''}</header>${body}</section>`;
const table=(heads,rows,empty='Belum ada data sesuai saringan.')=>`<div class="table-wrap"><table><thead><tr>${heads.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td colspan="${heads.length}" class="muted">${esc(empty)}</td></tr>`}</tbody></table></div>`;
const stat=(label,value,detail='')=>`<section class="stat-card visit-stat"><div class="stat-top"><span>${esc(label)}</span></div><div class="stat-value">${value==null?'—':esc(String(value))}</div>${detail?`<div class="stat-bottom"><span>${esc(detail)}</span></div>`:''}</section>`;
const pct=v=>v==null?'—':`${(v*100).toLocaleString('id-ID',{maximumFractionDigits:1})}%`;
const dec=(v,d=2)=>v==null?'—':Number(v).toLocaleString('id-ID',{minimumFractionDigits:d,maximumFractionDigits:d});
const signed=v=>v>0?`+${v}`:String(v);
// Etika: jumlah dengan tanda (+3, −2, 0) dan rata-rata per pengantaran (+0,15).
const etikaSum=v=>v==null?'—':v>0?`+${number(v)}`:v<0?`−${number(-v)}`:'0';
const etikaAvg=v=>v==null?'—':`${v>0?'+':v<0?'−':''}${Math.abs(v).toLocaleString('id-ID',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const uniformLabel={'-1':'Tidak sesuai','1':'Sesuai','2':'Bagus'};
const seragamLabel={lengkap:'Lengkap',kurang:'Kurang lengkap',tidak:'Tidak berseragam'};
const score=v=>v==null?'—':Number(v).toLocaleString('id-ID',{maximumFractionDigits:1});
const rewardBadge={layak:['positive','Layak'],gugur:['negative','Gugur'],bawah:['warm','Di bawah ambang'],kurang:['neutral','Belum cukup data']};
// Gugur karena komplain atau pelanggaran berat (keduanya menghapus nilai bulan itu). portal-api
// sebelum 23 November tidak mengirim `sebab`; saat itu gugur hanya karena pelanggaran berat.
const gugurLabel={komplain:'Gugur — komplain',berat:'Gugur — pelanggaran berat'};
const rewardLabel=g=>g.status==='gugur'?gugurLabel[g.sebab]||gugurLabel.berat:(rewardBadge[g.status]||[null,g.status])[1];
const pendingNote=g=>[g.beratMenunggu?`${number(g.beratMenunggu)} laporan berat`:'',g.komplainMenunggu?`${number(g.komplainMenunggu)} komplain`:'',g.reviewMenunggu?`${number(g.reviewMenunggu)} review negatif`:''].filter(Boolean).join(', ');
const rewardCell=g=>{if(!g.status)return '—';const [kind]=rewardBadge[g.status]||['neutral'];const wait=pendingNote(g);return `<span class="badge ${kind}" title="${esc(g.alasan||'')}">${esc(rewardLabel(g))}</span>${wait?`<br><span class="muted text-small">${esc(wait)} menunggu</span>`:''}`;};
// Jumlah yang mungkin belum dikirim portal-api versi sebelumnya: tampil "—", bukan NaN.
const count=v=>v==null?'—':number(v);
const reviewCell=g=>g.review==null?'—':`${number(g.review)}${g.potonganReview?` <span class="muted text-small">(−${number(g.potonganReview)})</span>`:''}${g.reviewMenunggu?`<br><span class="muted text-small">${number(g.reviewMenunggu)} menunggu</span>`:''}`;
const komplainCell=g=>g.komplain==null?'—':`${number(g.komplain)}${g.komplainMenunggu?`<br><span class="muted text-small">${number(g.komplainMenunggu)} menunggu</span>`:''}`;
const rankCell=r=>r.peringkat==null?'<span class="muted" title="Nilai bulan ini dihapus (komplain atau pelanggaran berat)">—</span>':number(r.peringkat);
// Ringkasan aturan yang dipakai, mis. "tanpa ID −20 · kurang lengkap −10 · …". Etika
// −10…+10 ditambahkan langsung ke nilai (Etika menggantikan teguran sejak 17 November 2026).
// Patokan Etika (pemilik, 18 November 2026); teks yang sama tampil di formulir HP pos.
const etikaPatokan='0 = standar (tertib, tidak ada catatan khusus). Minus hanya untuk perilaku yang perlu ditegur, bukan untuk seragam atau ID-Card yang sudah dinilai sendiri. Plus hanya untuk yang benar-benar menonjol, mis. menolong wisatawan; rapi dan tertib termasuk standar.';
const ruleLine=r=>r?`tanpa ID −${r.pot_id} · kurang lengkap −${r.pot_kurang} · tidak berseragam −${r.pot_tidak} · Etika −10…+10`:'';
const monthLabel=m=>formatDate(m+'-01',{month:'long',year:'numeric'});
const when=t=>t?`${formatDate(t)} ${formatTime(t)}`:'—';
const range=()=>`from=${M.from}&to=${M.to}`;
const filters=(extra='')=>`<div class="toolbar"><label class="field"><span>Dari tanggal</span><input type="date" data-visit-field="from" value="${esc(M.from)}" max="${localToday()}"></label><label class="field"><span>Sampai tanggal</span><input type="date" data-visit-field="to" value="${esc(M.to)}" max="${localToday()}"></label>${extra}${btn('Terapkan','apply','filter','outlined')}</div>`;
function unavailable(title,error,periodControls=filters){
 const denied=error?.status===403,period=error?.status===422;
 return `${head(title,'Penilaian guide dari tautan pos, tersimpan di portal.')}<div class="notice ${period?'':'warning'}">${icon(period?'calendar':'incident')}<div><strong>${esc(denied?'Akses ditolak':period?'Periode perlu disesuaikan':'Data kunjungan belum dapat dimuat')}</strong><p>${esc(error?.message||'Coba lagi beberapa saat lagi.')}</p></div></div>${period?periodControls():`<div class="actions">${btn('Coba lagi','retry','refresh','outlined')}</div>`}`;
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
 // Satu bulan: nilai akhir (sesudah potongan review negatif); rentang lain: nilai pengantaran.
 nilai:['Nilai',r=>score(r.nilaiAkhir??r.nilai)],
 komplain:['Komplain',r=>number(r.komplain)],
 review:['Potongan review',r=>`−${number(r.potonganReview)} (${number(r.review)} review)`],
 tanpaId:['Tanpa ID',r=>`${number(r.tanpaId)} (${pct(r.porsiTanpaId)})`],
 seragam:['Seragam bermasalah',r=>`${number(r.kurangLengkap+r.tidakBerseragam)} (${pct(r.porsiSeragam)})`],
 etika:['Etika rata-rata',r=>`${etikaAvg(r.etikaRata)} (jumlah ${etikaSum(r.etika)})`],
 berat:['Pelanggaran berat',r=>number(r.berat)]};
function rankTable(title,rows,metric,note=''){
 const [label,value]=rankMetric[metric];
 return card(title,note,table(['#','Guide','Regu','Pengantaran',label],rows.map(r=>`<tr><td>${number(r.peringkat)}</td><td><strong>${esc(r.nama)}</strong><br><span class="muted text-small">${esc(r.guideId)}</span></td><td>${esc(r.regu)}</td><td>${number(r.antar)}</td><td><strong>${value(r)}</strong></td></tr>`),'Belum ada guide yang memenuhi.'));
}
const figureCells=r=>`<td>${number(r.pengantaran)}</td><td><strong>${score(r.nilai)}</strong></td><td>${pct(r.persenId)}</td><td>${pct(r.persenSeragam)}</td><td>${etikaAvg(r.etikaRata)}</td>`;
const figureHeads=['Pengantaran','Nilai','% ID terpasang','% seragam lengkap','Etika rata-rata'];
// Per petugas: angka penilaian pos + review negatif/komplain yang dicatat (termasuk yang ditolak).
const assessorHasReports=rows=>rows.some(r=>r.review!==undefined);
const assessorReportCells=r=>`<td>${count(r.review)}</td><td>${count(r.komplain)}</td><td>${count(r.laporanDitolak)}</td>`;
const assessorReportHeads=['Review dicatat','Komplain dicatat','Ditolak Pengelola'];
const periodNote=d=>d.periode?.bulan_ringkasan?.length?` Bulan ${d.periode.bulan_ringkasan.map(m=>formatDate(m+'-01',{month:'long',year:'numeric'})).join(', ')} memakai ringkasan bulanan; rincian sampai ${formatDate(d.periode.folded_through)} ada di spreadsheet.`:'';
function ruleNote(d){
 const a=d.aturan;if(!a)return '';
 const months=a.per_bulan||[],same=months.every(m=>ruleLine(m)===ruleLine(a));
 return same?`Nilai pengantaran = 100 − potongan + Etika (${ruleLine(a)}).`:`Nilai pengantaran = 100 − potongan + Etika, dengan aturan bulan masing-masing: ${months.map(m=>`${monthLabel(m.bulan)}: ${ruleLine(m)}`).join('; ')}.`;
}
// Catatan review negatif/komplain yang menunggu, untuk pemberitahuan di Dashboard dan Laporan.
const reportWaiting=s=>({review:s.laporan?.review.menunggu||0,komplain:s.laporan?.komplain.menunggu||0});
function waitingText(s){
 const w=reportWaiting(s);
 return [s.berat.menunggu?`${number(s.berat.menunggu)} pelanggaran berat`:'',s.apresiasi?.menunggu?`${number(s.apresiasi.menunggu)} apresiasi`:'',w.komplain?`${number(w.komplain)} komplain`:'',w.review?`${number(w.review)} review negatif`:''].filter(Boolean).join(', ');
}
function reportStatsCards(s,statCard){
 if(!s.laporan)return '';
 const r=s.laporan.review,k=s.laporan.komplain;
 return statCard('Review negatif disetujui',number(r.disetujui),`potongan nilai akhir ${number(r.potongan)} poin${r.menunggu?` · ${number(r.menunggu)} menunggu`:''}`)+
  statCard('Komplain disetujui',number(k.disetujui),`nilai bulan itu dihapus${k.menunggu?` · ${number(k.menunggu)} menunggu`:''}`);
}
function dashboard(){
 const d=M.overview,s=d.ringkasan,p=d.peringkat,a=d.aturan;
 const activity=(M.activity?.items||[]).map(x=>`<tr><td>${esc(x.label)}</td><td>${x.last_received_at?when(x.last_received_at):'Belum ada kiriman'}</td><td>${number(x.accepted_24h)}</td><td>${number(x.rejected_24h)}</td></tr>`);
 const w=reportWaiting(s),waiting=s.berat.menunggu+s.apresiasi.menunggu+w.review+w.komplain,withReports=assessorHasReports(d.perPetugas||[]);
 const petugas=(d.perPetugas||[]).map(r=>`<tr><td>${r.petugas?esc(r.petugas):'<span class="muted">Tanpa nama petugas</span>'}</td><td>${esc(r.pos.map(x=>'Pos '+x).join(', '))}</td>${figureCells(r)}${withReports?assessorReportCells(r):''}</tr>`);
 return `${head('Dashboard Kunjungan',`Penilaian guide ${formatDate(d.from)} – ${formatDate(d.to)}. ${ruleNote(d)}`)}${filters()}
 ${waiting?`<div class="notice warning">${icon('incident')}<div><strong>${number(waiting)} laporan menunggu verifikasi</strong><p>${esc(waitingText(s))} dari HP pos belum diputuskan Pengelola Kunjungan. Semuanya baru berdampak setelah disetujui: komplain dan pelanggaran berat menghapus nilai bulan itu, review negatif memotong nilai akhir.</p><p><a href="#visits-flags">Buka Verifikasi</a></p></div></div>`:''}
 <div class="stats-grid">${stat('Pengantaran',number(s.pengantaran),`${number(s.hariDinilai)} hari berpenilaian`)}${stat('Guide dinilai',number(s.guideDinilai),`dari ${number(s.guideAktif)} guide aktif`)}${stat('Nilai rata-rata',score(s.nilai),'100 − potongan + Etika per pengantaran')}${stat('ID terpasang',pct(s.persenId),`${number(s.tanpaId)} kali tanpa ID`)}${stat('Seragam lengkap',pct(s.persenSeragam),`${number(s.kurangLengkap)} kurang · ${number(s.tidakBerseragam)} tidak`)}${stat('Etika rata-rata',etikaAvg(s.etikaRata),`jumlah ${etikaSum(s.etika)} · ${number(s.berat.disetujui)} pelanggaran berat terverifikasi`)}${reportStatsCards(s,stat)}${a?.satu_bulan?stat('Layak reward',number(s.layak),`nilai akhir ≥ ${a.ambang}, ≥ ${a.minimal} antar, tanpa komplain atau pelanggaran berat`):''}</div>
 <div class="visit-grid">${card('Per pos','Pos 1 dan Pos 3 dihitung masing-masing. Selisih besar biasanya tanda patokan antarpos belum sama.',table(['Pos','Guide',...figureHeads],d.perPos.map(r=>`<tr><td>Pos ${esc(r.pos)}</td><td>${number(r.guideDinilai)}</td>${figureCells(r)}</tr>`)))}
 ${card('Per regu','',table(['Regu','Kategori',...figureHeads],d.perRegu.map(r=>`<tr><td>${esc(r.regu)}</td><td>${esc(r.kategori)}</td>${figureCells(r)}</tr>`)))}</div>
 ${petugas.length?card('Per petugas penilai',`Penilaian dari rincian 6 minggu terakhir. Petugas yang jauh lebih longgar atau ketat dari yang lain perlu dikalibrasi, termasuk patokan Etika (rata-rata jauh dari 0)${withReports?'; begitu juga yang jauh lebih sering mencatat review negatif atau komplain, atau sering ditolak':''}.`,table(['Petugas','Pos',...figureHeads,...(withReports?assessorReportHeads:[])],petugas)):''}
 ${M.activity?card('Kiriman dari HP pos','Kiriman terakhir yang diterima tiap pos dan jumlahnya dalam 24 jam terakhir.',table(['Pos','Kiriman terakhir','Diterima 24 jam','Ditolak 24 jam'],activity)):''}
 <p class="muted visit-note">Peringkat memakai rata-rata nilai per pengantaran${a?.satu_bulan&&s.laporan?' dikurangi potongan review negatif (nilai akhir)':''}, minimal ${number(d.minimalPengantaran)} pengantaran (${number(d.diperingkat)} guide diperingkat, ${number(d.belumCukup)} belum cukup).${s.laporan?' Guide dengan komplain atau pelanggaran berat yang disetujui nilainya dihapus dan tidak diperingkat.':''} Nilai sama mendapat peringkat sama; apresiasi terverifikasi menjadi penentu, bukan jumlah pengantaran. Guide nonaktif ikut di total, tidak di peringkat.${esc(periodNote(d))} Diperbarui ${when(d.diperbarui)}.</p>
 ${sheetLine(M.sheet)}
 <div class="visit-grid">${rankTable('Nilai tertinggi',p.nilaiTertinggi,'nilai')}${rankTable('Nilai terendah',p.nilaiTerendah,'nilai')}${rankTable('Paling sering tanpa ID',p.tanpaIdTerbanyak,'tanpaId')}${rankTable('Paling sering seragam bermasalah',p.seragamTerbanyak,'seragam')}${rankTable('Etika rata-rata terendah',p.etikaTerendah||[],'etika','Hanya guide dengan Etika rata-rata di bawah 0.')}${rankTable('Pelanggaran berat terverifikasi',p.beratTerverifikasi,'berat',s.laporan?'Nilai bulan itu dihapus dan gugur reward.':'Menggugurkan reward bulan itu.')}${p.komplainDisetujui?rankTable('Komplain disetujui',p.komplainDisetujui,'komplain','Nilai bulan itu dihapus dan gugur reward.'):''}${p.reviewNegatif?rankTable('Review negatif disetujui',p.reviewNegatif,'review','Jumlah potongan nilai akhir; tanpa batas per bulan.'):''}${rankTable(`Belum cukup pengantaran (< ${d.minimalPengantaran})`,p.belumCukup,'nilai')}</div>`;
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
 return `<div class="notice ${rejected?'warning':''}">${icon(rejected?'incident':'check')}<div><strong>${number(s.counts.MASUK)} penilaian masuk ke rekap${s.first?`, ${esc(formatDate(s.first))} – ${esc(formatDate(s.last))}`:''}</strong><p>${number(skipped)} dilewati · ${number(rejected)} ditolak. Penilaian diringkas per hari; catatan dan nama petugas tetap di spreadsheet NilaiGuide.</p></div></div>
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
   // Saat melanjutkan, baris yang sudah tersimpan dibaca sebagai duplikat oleh
   // pratinjau. Tetap izinkan bagian tersisa (meski semuanya dilewati) dan tahap
   // selesai, berdasarkan jumlah yang sudah diterima dalam migrasi ini.
   const saved=current?.ringkasan?.counts?.MASUK||0;
   if(saved)result.insertAdjacentHTML('afterbegin',`<div class="notice">${icon('document')}<div><strong>${number(saved)} penilaian sudah tersimpan dari pengiriman sebelumnya.</strong><p>Lanjutkan untuk menyelesaikan migrasi. Baris tersebut tidak ditambahkan lagi.</p></div></div>`);
   file=read;parts=split;applyButton.disabled=!(summary.counts.MASUK||saved);
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
 // Penilaian cara lama ditampilkan dengan pemetaannya, plus Uniform aslinya. Etika semua
 // bentuk ada di kolom Etika; penilaian formulir 2.2 menyebut jenis tegurannya (−1 per teguran).
 const lama=v2?'':`<br><span class="muted text-small">cara lama: Uniform ${esc(uniformLabel[String(r.uniform)]||r.uniform)}</span>`;
 const teguran=v2&&r.teguran.length?`<br><span class="muted text-small">dari teguran: ${r.teguran.map(k=>esc(typeLabel(k))).join(', ')}</span>`:'';
 const etika=`<strong>${esc(signed(r.etika))}</strong>${teguran}`;
 const laporan=[r.berat?`<span class="badge negative">Pelanggaran berat</span><br><span class="text-small">${esc(typeLabel(r.berat))}</span>`:'',r.apresiasi?`<span class="badge positive">Apresiasi</span><br><span class="text-small">${esc(typeLabel(r.apresiasi))}</span>`:''].filter(Boolean).join('<br>')||'—';
 return `<tr class="${replaced?'visit-dim':''}"><td>${when(r.timestamp)}</td><td>Pos ${esc(r.pos)}</td><td><strong>${esc(r.guideName)}</strong><br><span class="muted text-small">${esc(r.guideId)} · ${esc(r.regu||'—')}</span></td><td>${r.idCard?'Terpasang':'<strong>Tidak</strong>'}</td><td>${esc(seragamLabel[r.seragam]||r.seragam)}${lama}</td><td>${etika}</td><td>${laporan}</td><td>${esc(r.petugas||'—')}</td><td><strong>${score(r.nilai)}</strong></td><td>${esc(r.catatan||'')}</td><td>${replaced?`Diganti${r.digantiOleh?`<br><span class="muted text-small">oleh ${esc(r.digantiOleh.slice(0,8))}</span>`:''}`:r.koreksiDari?`Koreksi<br><span class="muted text-small">dari ${esc(r.koreksiDari.slice(0,8))}</span>`:'Aktif'}</td></tr>`;
}
// Label jenis temuan dari Aturan Nilai (dimuat bersama halaman), atau kodenya.
const typeLabel=code=>(M.scoring?.jenis||[]).find(t=>t.kode===code)?.label||code;
function recordsPage(){
 const f=M.recordFilter,sel=(key,label,opts)=>`<label class="field"><span>${label}</span><select data-visit-filter="${key}"><option value="">Semua</option>${opts.map(([v,t])=>`<option value="${v}" ${f[key]===v?'selected':''}>${t}</option>`).join('')}</select></label>`;
 const exportButton=permitted('visits.reports.export')?btn('Ekspor Excel','export-records','download','outlined'):'';
 const folded=M.recordsFolded&&M.from<=M.recordsFolded?`<div class="notice">${icon('document')}<div><strong>Rincian lama ada di spreadsheet</strong><p>Portal menyimpan rincian penilaian 6 minggu terakhir. Penilaian sampai ${esc(formatDate(M.recordsFolded))} dibuka di spreadsheet tahunan (Tautan Pos → Salinan spreadsheet).</p></div></div>`:'';
 return `${head('Penilaian Guide',`${number(M.recordsTotal)} penilaian ${formatDate(M.from)} – ${formatDate(M.to)}, terbaru dulu. Hanya baca; salah pencet hari ini dibetulkan dari HP pos.`,exportButton)}
 ${filters(sel('pos','Pos',[['1','Pos 1'],['3','Pos 3']])+sel('regu','Regu',regu.map(r=>[r,r]))+sel('status','Status',[['aktif','Aktif'],['diganti','Diganti koreksi']]))}
 ${folded}${table(['Waktu WITA','Pos','Guide','ID-Card','Seragam','Etika','Laporan','Petugas','Nilai','Catatan','Status'],M.records.map(recordRow))}
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
// Laporan mingguan (Senin–Minggu WITA, untuk memantau) dan bulanan (bulan kalender, dasar
// reward dan arsip), dengan pembanding periode sebelumnya dan grafik tren. Datanya dari rute
// visits/report. portal-api versi sebelumnya hanya punya visits/overview: laporan tetap tampil
// dari situ, tanpa pembanding dan grafik, sampai portal-api diperbarui.
const weekStartOf=day=>shiftDay(day,-((new Date(day+'T00:00:00Z').getUTCDay()+6)%7));
const addMonth=(month,n)=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7))-1+n,1)).toISOString().slice(0,7);
const lastDayOf=month=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
const reportModes=[['hari','Harian'],['minggu','Mingguan'],['bulan','Bulanan']];
const reportModeKey='sph-kunjungan-laporan';
function rememberMode(mode){try{localStorage.setItem(reportModeKey,mode);}catch{}}
function rememberedMode(){try{const mode=localStorage.getItem(reportModeKey);return mode==='hari'||mode==='minggu'?mode:'bulan';}catch{return 'bulan';}}
const dayTitle=day=>formatDate(day,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
const clock=t=>t?t.replace(':','.'):'';
const hourLabel=h=>{const hh=String(h.jam).padStart(2,'0');return `${hh}.00–${hh}.59`;};
function reportPeriod(){
 if(M.reportMode==='hari')return {from:M.reportDay,to:M.reportDay};
 if(M.reportMode==='minggu')return {from:M.reportWeek,to:shiftDay(M.reportWeek,6)};
 return {from:`${M.month}-01`,to:lastDayOf(M.month)};
}
async function loadReport(){
 const mode=M.reportMode,{from,to}=reportPeriod();
 const query=M.reportMode==='bulan'?`jenis=bulan&bulan=${M.month}`:`jenis=${M.reportMode}&tanggal=${M.reportMode==='hari'?M.reportDay:M.reportWeek}`;
 try{return await api(`visits/report?${query}`);}
 catch(error){
  if(error.status!==404)throw error;
  return {...await api(`visits/overview?from=${from}&to=${to>localToday()?localToday():to}`),laporan:null,jenis:mode};
 }
}
// Pilihan bulan: Januari 2026 (awal data) sampai bulan berjalan, terbaru dulu.
function monthChoices(){
 const current=localToday().slice(0,7),out=[];
 for(let m=current;m>=(M.month<'2026-01'?M.month:'2026-01');m=addMonth(m,-1))out.push(`<option value="${m}" ${m===M.month?'selected':''}>${esc(monthLabel(m))}</option>`);
 return out.join('');
}
function periodBar(){
 const mode=M.reportMode,{from,to}=reportPeriod(),today=localToday(),unit={hari:'Hari',minggu:'Minggu',bulan:'Bulan'}[mode];
 const next=mode==='hari'?shiftDay(from,1):mode==='minggu'?shiftDay(from,7):`${addMonth(M.month,1)}-01`;
 const current=mode==='hari'?from===today:mode==='minggu'?from===weekStartOf(today):M.month===today.slice(0,7);
 const periodControl=mode==='bulan'
  ? `<div class="field"><select aria-label="Bulan laporan" data-visit-field="month">${monthChoices()}</select></div>`
  : `<strong aria-live="polite">${esc(mode==='hari'?formatDate(from,{weekday:'short',day:'numeric',month:'short',year:'numeric'}):rangeLabel(from,to))}</strong>`;
 const datePicker=mode==='bulan'?'':`<label class="field"><span>${mode==='hari'?'Tanggal':'Minggu yang memuat tanggal'}</span><input type="date" data-visit-field="${mode==='hari'?'reportDayPick':'reportWeekPick'}" value="${esc(from)}" min="2025-01-01" max="${today}"></label>`;
 return `<div class="toolbar visit-period">
 <div class="visit-mode" role="group" aria-label="Jenis laporan">${reportModes.map(([key,text])=>`<button type="button" class="chip ${mode===key?'active':''}" data-visit="report-mode" data-mode="${key}" aria-pressed="${mode===key}">${text}</button>`).join('')}</div>
 <div class="visit-stepper"><button type="button" class="icon-button" data-visit="report-prev" aria-label="${unit} sebelumnya" title="${unit} sebelumnya">${icon('chevron','flip')}</button>${periodControl}<button type="button" class="icon-button" data-visit="report-next" aria-label="${unit} berikutnya" title="${unit} berikutnya" ${next>today?'disabled':''}>${icon('chevron')}</button></div>
 ${datePicker}
 ${current?'':btn(`${unit} ini`,'report-current','calendar','outlined')}</div>`;
}
// Pembanding: periode sebelumnya yang utuh, atau — bila periode ini masih berjalan — periode lalu
// sampai jam yang sama (kemarin s.d. 10.16; 9–12 Nov s.d. 10.16).
function comparison(L){
 const p=L.sebelumnya,jam=p.sampaiJam?` s.d. ${clock(p.sampaiJam)}`:'';
 if(L.jenis==='hari')return p.utuh?'hari sebelumnya':`kemarin${jam}`;
 if(p.utuh)return L.jenis==='minggu'?'minggu sebelumnya':'bulan sebelumnya';
 return `${rangeLabel(p.from,p.to)}${jam}`;
}
function runningNote(L){
 const jam=L.sebelumnya.sampaiJam?`pukul ${clock(L.sebelumnya.sampaiJam)}`:'';
 if(L.jenis==='hari')return `Hari berjalan: angka sampai ${jam||'saat ini'}, dibanding ${comparison(L)}.`;
 return `${L.jenis==='minggu'?'Minggu':'Bulan'} berjalan: angka sampai ${formatDate(L.sampai,{weekday:'long',day:'numeric',month:'long'})}${jam?` ${jam}`:''}, dibanding periode yang sama ${L.jenis==='minggu'?'minggu':'bulan'} lalu (${comparison(L)}).`;
}
// Selisih dengan pembanding. Untuk ukuran mutu naik = membaik (hijau), turun = memburuk (merah);
// jumlah tidak diberi warna. Panah dan teks tetap ada, jadi arti tidak bergantung pada warna.
function deltaLine(current,previous,kind){
 if(current==null||previous==null)return '<span class="visit-delta flat">tanpa pembanding</span>';
 const factor=kind==='count'?1:kind==='etika'?100:10,diff=Math.round((kind==='pct'?(current-previous)*100:current-previous)*factor)/factor;
 if(!diff)return '<span class="visit-delta flat">sama</span>';
 const up=diff>0,size=Math.abs(diff),tone=kind==='count'?'flat':up?'good':'bad';
 const text=kind==='count'?number(size):kind==='etika'?size.toLocaleString('id-ID',{minimumFractionDigits:2,maximumFractionDigits:2}):`${size.toLocaleString('id-ID',{maximumFractionDigits:1})} ${kind==='pct'?'poin %':'poin'}`;
 return `<span class="visit-delta ${tone}"><span aria-hidden="true">${up?'▲':'▼'}</span><span class="sr-only">${up?'naik':'turun'}</span> ${text}</span>`;
}
const reportStat=(label,value,delta,detail)=>`<section class="stat-card visit-stat"><div class="stat-top"><span>${esc(label)}</span></div><div class="stat-value">${value==null?'—':esc(String(value))}</div>${delta?`<div class="stat-bottom visit-stat-delta">${delta}</div>`:''}${detail?`<div class="stat-bottom"><span>${esc(detail)}</span></div>`:''}</section>`;
function reportStats(d,mode){
 const s=d.ringkasan,L=d.laporan,p=d.sebelumnya,a=d.aturan;
 const vs=L?` <span>vs ${esc(comparison(L))}</span>`:'',delta=(key,kind)=>!L?'':s[key]==null||p[key]==null?deltaLine(null,null,kind):deltaLine(s[key],p[key],kind)+vs;
 return [reportStat('Pengantaran',number(s.pengantaran),delta('pengantaran','count'),mode==='hari'?d.perPos.map(r=>`Pos ${r.pos}: ${number(r.pengantaran)}`).join(' · '):`${number(s.hariDinilai)} hari berpenilaian`),
  reportStat('Guide dinilai',number(s.guideDinilai),delta('guideDinilai','count'),`dari ${number(s.guideAktif)} guide aktif`),
  reportStat('Nilai rata-rata',score(s.nilai),delta('nilai','nilai'),'100 − potongan + Etika per pengantaran'),
  reportStat('ID terpasang',pct(s.persenId),delta('persenId','pct'),`${number(s.tanpaId)} kali tanpa ID`),
  reportStat('Seragam lengkap',pct(s.persenSeragam),delta('persenSeragam','pct'),`${number(s.kurangLengkap)} kurang · ${number(s.tidakBerseragam)} tidak`),
  reportStat('Etika rata-rata',etikaAvg(s.etikaRata),delta('etikaRata','etika'),`jumlah ${etikaSum(s.etika)}`),
  reportStatsCards(s,(label,value,detail)=>reportStat(label,value,'',detail)),
  ...(mode==='bulan'?[reportStat('Layak reward',s.layak==null?'-':number(s.layak),delta('layak','count'),a?`nilai akhir ≥ ${a.ambang}, minimal ${a.minimal} pengantaran, tanpa komplain atau pelanggaran berat`:'')]:[])].join('');
}
// Rentang grafik per jenis laporan. Laporan harian: per jam (dari rincian ±6 minggu terakhir) dan 30 hari.
function trendScopes(mode,d){
 if(mode==='hari')return [...(d.perJam?[['jam','Per jam']]:[]),['tren','30 hari']];
 if(mode==='minggu')return [['hari','Per hari'],['tren','12 minggu']];
 return [['hari','Per hari'],['minggu','Per minggu'],['tren','12 bulan']];
}
// Titik grafik untuk rentang yang dipilih. Sisa periode yang belum berjalan tetap ada di sumbu
// (kosong), dan titik periode yang masih berjalan ditandai.
function trendSlots(d,mode,scope){
 const L=d.laporan,today=localToday();
 if(scope==='jam'){
  // Jam 07.00–17.59 selalu tampil; jam lain hanya bila ada penilaian.
  const filled=d.perJam.filter(h=>h.pengantaran).map(h=>h.jam),first=Math.min(7,...filled),last=Math.max(17,...filled);
  const hour=L.berjalan?Number(new Date(Date.now()+8*3600000).toISOString().slice(11,13)):24;
  return {unit:'jam',slots:d.perJam.slice(first,last+1).map(h=>({...h,mendatang:h.jam>hour,berjalan:h.jam===hour}))};
 }
 if(scope==='tren')return {unit:mode,slots:d.tren.map((b,i,list)=>({...b,berjalan:L.berjalan&&i===list.length-1}))};
 const unit=scope==='minggu'?'minggu':'hari',slots=(unit==='minggu'?d.perMinggu:d.perHari).map(b=>({...b}));
 let resume=shiftDay(L.sampai,1);
 const last=slots.at(-1);
 if(last&&L.berjalan){
  const end=unit==='minggu'?[shiftDay(weekStartOf(last.mulai),6),L.to].sort()[0]:last.mulai;
  last.berjalan=last.sampai===today||last.sampai<end;resume=shiftDay(end,1);
 }
 for(let day=resume;day<=L.to;){const end=unit==='hari'?day:[shiftDay(weekStartOf(day),6),L.to].sort()[0];slots.push({mulai:day,sampai:end,mendatang:true});day=shiftDay(end,1);}
 return {unit,slots};
}
const slotRowLabel=(s,unit)=>unit==='jam'?hourLabel(s):unit==='hari'?formatDate(s.mulai,{weekday:'short',day:'numeric',month:'short',year:'numeric'}):unit==='bulan'?monthLabel(s.mulai.slice(0,7)):rangeLabel(s.mulai,s.sampai);
function trendCard(d,mode){
 const scopes=trendScopes(mode,d);if(!scopes.some(([key])=>key===M.trendScope))M.trendScope=scopes[0][0];
 const L=d.laporan,{unit,slots}=trendSlots(d,mode,M.trendScope);
 const period=mode==='hari'?formatDate(L.from,{weekday:'long',day:'numeric',month:'long',year:'numeric'}):mode==='minggu'?rangeLabel(L.from,L.to):monthLabel(M.month);
 const span={hari:'30 hari',minggu:'12 minggu',bulan:'12 bulan'}[mode],each={hari:'hari',minggu:'minggu',bulan:'bulan'}[mode];
 const sub={jam:`Per jam (WITA), ${period}.`,hari:`Per hari, ${period}.`,minggu:`Per minggu (Senin–Minggu) di ${period}.`,tren:`${span} terakhir sampai ${period}.`}[M.trendScope];
 const filled=slots.filter(s=>!s.mendatang&&s.pengantaran).length;
 // Tren yang masih jarang: jelaskan kenapa, termasuk riwayat NilaiGuide yang belum dimigrasikan.
 const migrated=M.history?.current?.status==='aktif',history=migrated?'':M.history?.can_manage?' Riwayat NilaiGuide sebelum peralihan ikut tampil setelah migrasi awal diterapkan (kartu Migrasi awal di bawah).':' Riwayat NilaiGuide sebelum peralihan ikut tampil setelah Pengelola Kunjungan menjalankan migrasi awal.';
 const sparse=M.trendScope==='tren'&&filled<2?`<p class="muted visit-note">${icon('help')} Tren antar${each} terbaca setelah ada data minimal dua ${each}.${history}</p>`:'';
 const noHours=mode==='hari'&&!d.perJam?`<p class="muted visit-note">${icon('help')} Rincian per jam hanya ada untuk ±6 minggu terakhir; penilaian tanggal ini sudah diringkas per hari.</p>`:'';
 const rows=slots.filter(s=>!s.mendatang&&(unit!=='jam'||s.pengantaran)).map(s=>`<tr><td>${esc(slotRowLabel(s,unit))}${s.berjalan?' <span class="muted text-small">(berjalan)</span>':''}</td><td>${number(s.pengantaran)}</td><td>${number(s.guideDinilai)}</td><td><strong>${score(s.nilai)}</strong></td><td>${pct(s.persenId)}</td><td>${pct(s.persenSeragam)}</td><td>${etikaAvg(s.etikaRata)}</td></tr>`);
 return card('Grafik tren',`${sub} Arahkan kursor, ketuk, atau pakai panah kiri/kanan untuk melihat angka tiap titik.`,`<div class="card-body visit-trend-body">
 <div class="chips visit-scope" role="group" aria-label="Rentang grafik">${scopes.map(([key,label])=>`<button type="button" class="chip ${M.trendScope===key?'active':''}" data-visit="trend-scope" data-scope="${key}" aria-pressed="${M.trendScope===key}">${label}</button>`).join('')}</div>
 ${noHours}<div class="visit-trend" data-trend></div>${sparse}
 <details class="visit-trend-table"><summary>Lihat angka dalam tabel</summary>${table([{jam:'Jam',hari:'Tanggal',minggu:'Minggu',bulan:'Bulan'}[unit],'Pengantaran','Guide dinilai','Nilai rata-rata','% ID terpasang','% seragam lengkap','Etika rata-rata'],rows)}</details></div>`);
}
function mountReportChart(){
 const el=document.querySelector('#main [data-trend]');if(!el||!M.report?.laporan)return;
 const {slots,unit}=trendSlots(M.report,M.reportMode,M.trendScope);mountTrend(el,slots,unit);
}
const petugasRow=(r,withReports)=>`<tr><td>${r.petugas?esc(r.petugas):'<span class="muted">Tanpa nama petugas</span>'}</td><td>${esc(r.pos.map(x=>'Pos '+x).join(', '))}</td>${figureCells(r)}${withReports?assessorReportCells(r):''}</tr>`;
function reportsPage(){
 const d=M.report,mode=M.reportMode,daily=mode==='hari',monthly=mode==='bulan',canExport=permitted('visits.reports.export'),s=d.ringkasan,L=d.laporan,{from,to}=reportPeriod();
 const intro=daily?`Laporan harian ${dayTitle(from)} untuk memantau pos; reward memakai laporan bulanan.`
  :mode==='minggu'?`Laporan mingguan ${rangeLabel(from,to)} (Senin–Minggu WITA) untuk memantau; reward memakai laporan bulanan.`:'Laporan bulanan per guide untuk penetapan reward dan arsip.';
 // Kolom review negatif & komplain hanya bila portal-api sudah mengirimnya (23 November 2026).
 const reports=Boolean(s.laporan),finalScore=monthly&&reports;
 const perGuide=d.perGuide.map(g=>`<tr class="${g.peringkat==null?'visit-dim':''}"><td>${rankCell(g)}</td><td><strong>${esc(g.nama)}</strong><br><span class="muted text-small">${esc(g.guideId)}</span></td><td>${esc(g.regu)}</td><td>${number(g.antar)}</td><td>${finalScore?score(g.nilai):`<strong>${score(g.nilai)}</strong>`}</td>${reports?`<td>${reviewCell(g)}</td><td>${komplainCell(g)}</td>`:''}${finalScore?`<td><strong>${score(g.nilaiAkhir)}</strong></td>`:''}${monthly?`<td>${rewardCell(g)}</td>`:''}<td>${pct(g.persenId)}</td><td>${pct(g.persenSeragam)}</td><td>${etikaAvg(g.etikaRata)}</td><td>${number(g.berat)}</td><td>${number(g.apresiasi)}</td></tr>`);
 const guideHeads=['#','Guide','Regu','Antar',finalScore?'Nilai pengantaran':'Nilai',...(reports?['Review negatif','Komplain']:[]),...(finalScore?['Nilai akhir']:[]),...(monthly?['Status reward']:[]),'% ID','% seragam','Etika rata-rata','Berat','Apresiasi'];
 const guideNote=monthly?`Diurut menurut ${finalScore?'nilai akhir (nilai pengantaran − potongan review negatif yang disetujui, paling rendah 0). Guide dengan komplain atau pelanggaran berat yang disetujui nilainya dihapus (0) dan tidak diperingkat. ':'nilai. '}Bila reward terbatas: nilai lebih tinggi didahulukan, lalu apresiasi terverifikasi; selebihnya setara. Jumlah hari dan rincian temuan ada di Ekspor Excel.`
  :`Diurut menurut nilai ${daily?'hari':'minggu'} ini. Status reward dan nilai akhir hanya di laporan bulanan. ${daily?'Rincian tiap penilaian ada di halaman Penilaian dan di Ekspor Excel.':'Jumlah hari dan rincian temuan ada di Ekspor Excel.'}`;
 const records=daily&&permitted('visits.records.read')?btn('Rincian penilaian','report-records','log','outlined'):'';
 return `${head('Laporan & Ekspor',`${intro} ${ruleNote(d)}`,canExport?btn('Ekspor Excel','export-report','download','primary'):'')}
 ${periodBar()}
 ${L?.berjalan?`<p class="muted visit-note">${icon('clock')} ${esc(runningNote(L))}</p>`:''}
 ${L?'':`<div class="notice">${icon('incident')}<div><strong>Grafik tren dan pembanding belum tersedia</strong><p>Server portal belum diperbarui untuk laporan harian, mingguan, dan bulanan. Angka di bawah tetap benar.</p></div></div>`}
 <div class="stats-grid">${reportStats(d,mode)}</div>
 ${s.berat.menunggu+reportWaiting(s).review+reportWaiting(s).komplain?`<div class="notice warning">${icon('incident')}<div><strong>${esc([s.berat.menunggu?`${number(s.berat.menunggu)} pelanggaran berat`:'',reportWaiting(s).komplain?`${number(reportWaiting(s).komplain)} komplain`:'',reportWaiting(s).review?`${number(reportWaiting(s).review)} review negatif`:''].filter(Boolean).join(', '))} belum diputuskan</strong><p>${monthly?'Putuskan di Verifikasi sebelum reward bulan ini dibagikan.':'Putuskan di Verifikasi; yang disetujui berdampak pada nilai bulan kejadiannya.'}</p><p><a href="#visits-flags">Buka Verifikasi</a></p></div></div>`:''}
 ${L?trendCard(d,mode):''}
 <div class="visit-stack">${card('Per pos','Pos 1 dan Pos 3 dihitung masing-masing. Selisih besar biasanya tanda patokan antarpos belum sama.',table(['Pos','Guide',...figureHeads],d.perPos.map(r=>`<tr><td>Pos ${esc(r.pos)}</td><td>${number(r.guideDinilai)}</td>${figureCells(r)}</tr>`)))}
 ${card('Per regu','',table(['Regu','Kategori','Guide',...figureHeads],d.perRegu.map(r=>`<tr><td>${esc(r.regu)}</td><td>${esc(r.kategori)}</td><td>${number(r.guideDinilai)}</td>${figureCells(r)}</tr>`)))}
 ${daily&&d.perPetugas?.length?card('Per petugas penilai','Dari rincian penilaian. Petugas yang jauh lebih longgar atau ketat dari yang lain perlu dikalibrasi, termasuk patokan Etika (rata-rata jauh dari 0).',table(['Petugas','Pos',...figureHeads,...(assessorHasReports(d.perPetugas)?assessorReportHeads:[])],d.perPetugas.map(r=>petugasRow(r,assessorHasReports(d.perPetugas))))):''}
 ${card('Ringkasan per guide',guideNote,table(guideHeads,perGuide),records)}
 ${historyCard(M.history)}</div>
 <p class="muted visit-note">${esc(periodNote(d).trim())} Diperbarui ${when(d.diperbarui)}.</p>`;
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
const guideColumns=[{header:'Peringkat',key:'peringkat',kind:'number'},{header:'guideId',key:'guideId'},{header:'Nama',key:'nama',width:30},{header:'Regu',key:'regu'},{header:'Kategori',key:'kategori'},{header:'Pengantaran',key:'antar',kind:'number'},{header:'Hari',key:'hari',kind:'number'},
 {header:'Nilai (100 − potongan + Etika)',key:'nilai',kind:'number'},
 {header:'Review negatif disetujui',key:'review',kind:'number'},{header:'Potongan review negatif',key:'potonganReview',kind:'number'},{header:'Review negatif menunggu',key:'reviewMenunggu',kind:'number'},
 {header:'Komplain disetujui',key:'komplain',kind:'number'},{header:'Komplain menunggu',key:'komplainMenunggu',kind:'number'},{header:'Nilai akhir',key:'nilaiAkhir',kind:'number'},
 {header:'Tanpa ID',key:'tanpaId',kind:'number'},{header:'Kurang lengkap',key:'kurangLengkap',kind:'number'},{header:'Tidak berseragam',key:'tidakBerseragam',kind:'number'},
 {header:'Jumlah Etika',key:'etika',kind:'number'},{header:'Etika rata-rata',key:'etikaRata',kind:'number'},
 {header:'% ID terpasang',key:'persenId',kind:'percent'},{header:'% seragam lengkap',key:'persenSeragam',kind:'percent'},{header:'Pelanggaran berat terverifikasi',key:'berat',kind:'number'},{header:'Laporan berat menunggu',key:'beratMenunggu',kind:'number'},{header:'Apresiasi terverifikasi',key:'apresiasi',kind:'number'},{header:'Status reward',key:'statusReward',width:28}];
const rewardText=g=>{if(!g.status)return '';const wait=pendingNote(g);return `${rewardLabel(g)}${wait?` (${wait} menunggu)`:''}`;};
const round2=v=>v==null?null:Math.round(v*100)/100;
const guideRows=list=>list.map(g=>({...g,nilai:round2(g.nilai),nilaiAkhir:round2(g.nilaiAkhir),etikaRata:round2(g.etikaRata),statusReward:rewardText(g)}));
// Kolom per guide sesuai jenis laporan dan versi portal-api: nilai akhir dan status reward hanya bulanan.
const guideColumnsFor=(monthly,reports)=>guideColumns.filter(c=>(monthly||!['statusReward','nilaiAkhir'].includes(c.key))&&(reports||!['review','potonganReview','reviewMenunggu','komplain','komplainMenunggu','nilaiAkhir'].includes(c.key)));
// Lembar review negatif & komplain di Ekspor Excel, tanpa data wisatawan (nama/asal/kontak).
const guestReportLabel={review:'Review negatif',komplain:'Komplain'};
const guestStatusText={menunggu:'Menunggu',disetujui:'Disetujui',ditolak:'Ditolak'};
const guestColumns=[{header:'Tanggal kejadian',key:'tanggal',kind:'date'},{header:'Dicatat',key:'waktu'},{header:'Pos',key:'pos',kind:'number'},{header:'guideId',key:'guideId'},{header:'Guide',key:'guideName',width:28},
 {header:'Jenis',key:'jenisLabel'},{header:'Jenis keluhan',key:'label',width:30},{header:'Apa kata wisatawan',key:'keterangan',kind:'notes',width:40},{header:'Kronologi',key:'kronologi',kind:'notes',width:40},
 {header:'Petugas pos',key:'petugas',width:24},{header:'Status',key:'statusLabel'},{header:'Potongan',key:'potongan',kind:'number'},{header:'Klarifikasi guide',key:'klarifikasi',kind:'notes',width:40},
 {header:'Catatan keputusan',key:'keputusanCatatan',kind:'notes',width:36},{header:'Diputuskan oleh',key:'diputuskanOleh'},{header:'Diputuskan pada',key:'diputuskanPada'}];
const guestExportRow=r=>({...r,jenisLabel:`${guestReportLabel[r.jenis]}${r.jenisAwal!==r.jenis?` (dipindah dari ${guestReportLabel[r.jenisAwal].toLowerCase()})`:''}`,statusLabel:guestStatusText[r.status]||r.status});
// Kolom tren dan ringkasan periode di Ekspor Excel; persen disimpan sebagai pecahan berformat %.
const trendColumns=[{header:'Periode',key:'periode',width:30},{header:'Dari',key:'mulai',kind:'date'},{header:'Sampai',key:'sampai',kind:'date'},{header:'Pengantaran',key:'pengantaran',kind:'number'},{header:'Guide dinilai',key:'guideDinilai',kind:'number'},{header:'Hari berpenilaian',key:'hariDinilai',kind:'number'},
 {header:'Nilai rata-rata (100 − potongan + Etika)',key:'nilai',kind:'number'},{header:'% ID terpasang',key:'persenId',kind:'percent'},{header:'% seragam lengkap',key:'persenSeragam',kind:'percent'},{header:'Etika rata-rata',key:'etikaRata',kind:'number'},
 {header:'Tanpa ID',key:'tanpaId',kind:'number'},{header:'Kurang lengkap',key:'kurangLengkap',kind:'number'},{header:'Tidak berseragam',key:'tidakBerseragam',kind:'number'},{header:'Jumlah Etika',key:'etika',kind:'number'},{header:'Jumlah potongan',key:'potongan',kind:'number'}];
const trendRow=(b,label)=>({...b,periode:label,nilai:round2(b.nilai),etikaRata:round2(b.etikaRata)});
const figureColumns=first=>[...first,{header:'Guide dinilai',key:'guideDinilai',kind:'number'},{header:'Pengantaran',key:'pengantaran',kind:'number'},{header:'Nilai rata-rata',key:'nilai',kind:'number'},{header:'% ID terpasang',key:'persenId',kind:'percent'},{header:'% seragam lengkap',key:'persenSeragam',kind:'percent'},
 {header:'Etika rata-rata',key:'etikaRata',kind:'number'},{header:'Tanpa ID',key:'tanpaId',kind:'number'},{header:'Kurang lengkap',key:'kurangLengkap',kind:'number'},{header:'Tidak berseragam',key:'tidakBerseragam',kind:'number'}];
function summaryRows(d,mode){
 const L=d.laporan,s=d.ringkasan,label=mode==='hari'?`Hari ${dayTitle(L.from)}`:mode==='minggu'?`Minggu ${rangeLabel(L.from,L.to)}`:monthLabel(L.from.slice(0,7));
 const rows=[trendRow({...s,mulai:L.from,sampai:L.sampai,layak:mode==='bulan'?s.layak:null},`${label}${L.berjalan?' (berjalan)':''}`)];
 const p=d.sebelumnya;rows.push(trendRow({...p,mulai:L.sebelumnya.from,sampai:L.sebelumnya.to},`Pembanding: ${comparison(L)}`));
 const diff={};for(const key of ['pengantaran','guideDinilai','hariDinilai','nilai','persenId','persenSeragam','etikaRata','tanpaId','kurangLengkap','tidakBerseragam','etika','potongan','layak'])diff[key]=s[key]==null||p[key]==null?null:s[key]-p[key];
 rows.push(trendRow(diff,'Selisih (periode laporan − pembanding)'));
 return rows;
}
// Kolom rincian penilaian (Ekspor di halaman Penilaian dan laporan harian). Etika untuk semua
// bentuk; kolom teguran hanya terisi pada penilaian formulir 2.2.
const recordColumns=['evaluationId','timestamp','tanggal','pos','guideId','guideName','regu','versi','idCard','seragam','etika','teguran','berat','apresiasi','petugas','nilai','uniform','catatan','receivedAt','koreksiDari','status','digantiOleh'].map(key=>({header:key,key,kind:['pos','versi','uniform','idCard','etika','nilai'].includes(key)?'number':key==='catatan'?'notes':'text',width:key==='catatan'?40:undefined}));
const recordExportRow=r=>({...r,teguran:r.teguran.join(', ')});
async function exportRecords(){
 const rows=[];
 for(let offset=0;;offset+=1000){const page=await api(`visits/records?${recordQuery(offset)}`);rows.push(...page.items);if(!page.more)break;if(offset>=49000)throw new Error('Lebih dari 50.000 baris. Persempit rentang tanggal.');}
 if(!rows.length)throw new Error('Tidak ada penilaian pada saringan ini.');
 // Rentang yang memotong data lama (422) tetap bisa diekspor rinciannya, tanpa ringkasan.
 const summary=await api(`visits/overview?${range()}`).catch(error=>{if(error.status===422)return null;throw error;});
 download(createXlsx([{name:'Penilaian',columns:recordColumns,rows:rows.map(recordExportRow)},...(summary?[{name:'Ringkasan per guide',columns:guideColumnsFor(summary.aturan?.satu_bulan,Boolean(summary.ringkasan.laporan)),rows:guideRows(summary.perGuide)}]:[])]),`penilaian-guide-${M.from}-sd-${M.to}.xlsx`);
 await post('visits/exports',{kind:'records',from:M.from,to:M.to,rows:rows.length});
 toast(`${number(rows.length)} penilaian diekspor.`);
}
async function exportReport(){
 const d=M.report,L=d.laporan,mode=L?.jenis||d.jenis,daily=mode==='hari',monthly=mode==='bulan',sheets=[];
 if(L){
  sheets.push({name:'Ringkasan',columns:monthly?[...trendColumns,{header:'Layak reward',key:'layak',kind:'number'}]:trendColumns,rows:summaryRows(d,mode)});
  if(daily){
   if(d.perJam)sheets.push({name:'Per jam',columns:trendColumns,rows:d.perJam.filter(h=>h.pengantaran).map(h=>trendRow(h,hourLabel(h)))});
   sheets.push({name:'Tren 30 hari',columns:trendColumns,rows:d.tren.map(b=>trendRow(b,slotRowLabel(b,'hari')))});
  }else{
   sheets.push({name:'Per hari',columns:trendColumns,rows:d.perHari.map(b=>trendRow(b,slotRowLabel(b,'hari')))});
   if(d.perMinggu)sheets.push({name:'Per minggu',columns:trendColumns,rows:d.perMinggu.map(b=>trendRow(b,rangeLabel(b.mulai,b.sampai)))});
   sheets.push({name:monthly?'Tren 12 bulan':'Tren 12 minggu',columns:trendColumns,rows:d.tren.map(b=>trendRow(b,monthly?monthLabel(b.mulai.slice(0,7)):`Minggu ${rangeLabel(b.mulai,b.sampai)}`))});
  }
 }
 sheets.push({name:'Per pos',columns:figureColumns([{header:'Pos',key:'pos',kind:'number'}]),rows:d.perPos.map(r=>trendRow(r,''))});
 sheets.push({name:'Per regu',columns:figureColumns([{header:'Regu',key:'regu'},{header:'Kategori',key:'kategori'}]),rows:d.perRegu.map(r=>trendRow(r,''))});
 if(daily&&d.perPetugas?.length)sheets.push({name:'Per petugas',columns:[...figureColumns([{header:'Petugas',key:'petugas',width:28},{header:'Pos',key:'posList'}]).filter(c=>c.key!=='guideDinilai'),
  ...(assessorHasReports(d.perPetugas)?[{header:'Review negatif dicatat',key:'review',kind:'number'},{header:'Komplain dicatat',key:'komplain',kind:'number'},{header:'Ditolak Pengelola',key:'laporanDitolak',kind:'number'}]:[])],
  rows:d.perPetugas.map(r=>trendRow({...r,petugas:r.petugas||'Tanpa nama petugas',posList:r.pos.map(x=>'Pos '+x).join(', ')},''))});
 sheets.push({name:'Ringkasan per guide',columns:guideColumnsFor(monthly,Boolean(d.ringkasan.laporan)),rows:guideRows(d.perGuide)});
 // Review negatif & komplain periode ini beserta keputusannya (arsip dasar reward).
 if(d.ringkasan.laporan){
  const guest=await api(`visits/guest-reports?from=${d.from}&to=${d.to}`).catch(()=>null);
  if(guest?.items.length)sheets.push({name:'Review & komplain',columns:guestColumns,rows:guest.items.map(guestExportRow)});
 }
 // Laporan harian ikut memuat rincian tiap penilaian hari itu (selama rinciannya masih ada).
 if(daily&&permitted('visits.records.read')){
  const rows=[];
  for(let offset=0;;offset+=1000){const page=await api(`visits/records?from=${d.from}&to=${d.to}&limit=1000&offset=${offset}`);rows.push(...page.items);if(!page.more||offset>=49000)break;}
  if(rows.length)sheets.push({name:'Penilaian',columns:recordColumns,rows:rows.map(recordExportRow)});
 }
 const from=d.from;
 download(createXlsx(sheets),daily?`laporan-harian-penilaian-guide-${from}.xlsx`:monthly?`laporan-bulanan-penilaian-guide-${from.slice(0,7)}.xlsx`:`laporan-mingguan-penilaian-guide-${from}-sd-${L?.to||shiftDay(from,6)}.xlsx`);
 await post('visits/exports',{kind:'summary',from:d.from,to:d.to,rows:d.perGuide.length});
 toast(`Laporan ${daily?'harian':monthly?'bulanan':'mingguan'} diekspor.`);
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
 const d=M.flags,g=M.guestReports,manage=d?.can_decide||g?.can_decide;
 const sel=(key,label,opts)=>`<label class="field"><span>${label}</span><select data-visit-field="${key}"><option value="">Semua</option>${opts.map(([v,t])=>`<option value="${v}" ${M[key]===v?'selected':''}>${t}</option>`).join('')}</select></label>`;
 // Laporan pos (pelanggaran berat, apresiasi) dan catatan wisatawan (review negatif, komplain)
 // digabung dalam satu daftar: yang menunggu dulu, lalu tanggal kejadian terbaru.
 const rows=[...(d?.items||[]).map(f=>({sort:[f.status==='menunggu'?0:1,f.tanggal,f.waktu],html:flagRow(f,d.can_decide)})),
  ...(g?.items||[]).map(r=>({sort:[r.status==='menunggu'?0:1,r.tanggal,r.waktu],html:guestRow(r,g.can_decide)}))]
  .sort((a,b)=>a.sort[0]-b.sort[0]||(a.sort[1]<b.sort[1]?1:a.sort[1]>b.sort[1]?-1:0)||(a.sort[2]<b.sort[2]?1:a.sort[2]>b.sort[2]?-1:0)).map(x=>x.html);
 const waiting=(d?.menunggu_semua||0)+(g?.menunggu_semua||0);
 const waitingParts=[d?.menunggu_semua?`${number(d.menunggu_semua)} laporan pos`:'',g?.menunggu_jenis?.komplain?`${number(g.menunggu_jenis.komplain)} komplain`:'',g?.menunggu_jenis?.review?`${number(g.menunggu_jenis.review)} review negatif`:''].filter(Boolean).join(', ');
 const kinds=[['berat','Pelanggaran berat'],['apresiasi','Apresiasi'],...(g?[['komplain','Komplain'],['review','Review negatif']]:[])];
 const limited=(d&&d.items.length>=d.batas)||(g&&g.items.length>=g.batas);
 return `${head('Verifikasi Laporan',`Pelanggaran berat dan apresiasi dari penilaian pos${g?', serta komplain dan review negatif wisatawan yang dicatat petugas pos':''}. Pelanggaran berat${g?' dan komplain':''} yang disetujui ${g?'menghapus nilai guide bulan itu (gugur reward); review negatif yang disetujui memotong nilai akhir bulan itu':'menggugurkan reward guide bulan itu'}; apresiasi yang disetujui menjadi penentu bila nilai sama.`)}
 ${waiting?`<div class="notice warning">${icon('incident')}<div><strong>${number(waiting)} menunggu keputusan</strong><p>${esc(waitingParts)}. ${manage?'Periksa catatannya, lalu setujui atau tolak. Setiap keputusan diaudit dan bisa dibuka kembali bila salah pilih.':'Keputusan diambil Pengelola Kunjungan.'}</p></div></div>`:`<p class="muted visit-note">Tidak ada yang menunggu keputusan.</p>`}
 <div class="toolbar"><label class="field"><span>Dari tanggal</span><input type="date" data-visit-field="flagFrom" value="${esc(M.flagFrom)}" max="${localToday()}"></label><label class="field"><span>Sampai tanggal</span><input type="date" data-visit-field="flagTo" value="${esc(M.flagTo)}" max="${localToday()}"></label>
 ${sel('flagStatus','Status',[['menunggu','Menunggu'],['disetujui','Disetujui'],['ditolak','Ditolak'],['dibatalkan','Dibatalkan']])}${sel('flagJenis','Jenis',kinds)}${btn('Terapkan','apply','filter','outlined')}</div>
 ${table(['Tanggal','Guide','Laporan','Catatan','Petugas','Status',...(manage?['']:[])],rows,'Tidak ada laporan pada saringan ini.')}
 ${limited?`<p class="muted visit-note">Sebagian laporan tidak ditampilkan karena terlalu banyak. Persempit rentang tanggal.</p>`:''}
 ${g?`<p class="muted visit-note">Tanggal = tanggal kejadian. Komplain baru bisa disetujui setelah klarifikasi guide dicatat. Review negatif dan komplain yang tertukar bisa dipindah selama masih menunggu.${g.can_decide?' Nama dan kontak wisatawan hanya terlihat oleh Pengelola Kunjungan.':''}</p>`:''}`;
}
const flagKinds=['berat','apresiasi'],guestKinds=['review','komplain'];
const flagQuery=()=>{const q=new URLSearchParams({from:M.flagFrom,to:M.flagTo});if(M.flagStatus)q.set('status',M.flagStatus);if(flagKinds.includes(M.flagJenis))q.set('jenis',M.flagJenis);return q.toString();};
const guestQuery=()=>{const q=new URLSearchParams({from:M.flagFrom,to:M.flagTo});if(M.flagStatus)q.set('status',M.flagStatus);if(guestKinds.includes(M.flagJenis))q.set('jenis',M.flagJenis);return q.toString();};
// Muat laporan pos dan catatan wisatawan sesuai saringan. portal-api sebelum 23 November tidak
// punya rute guest-reports: daftar itu dilewati (null), laporan pos tetap tampil.
async function loadVerification(){
 const empty=list=>({items:[],counts:{},menunggu_semua:list?.menunggu_semua||0,batas:500,can_decide:list?.can_decide});
 const wantFlags=!guestKinds.includes(M.flagJenis),wantGuest=!flagKinds.includes(M.flagJenis)&&M.flagStatus!=='dibatalkan';
 const [flags,guest]=await Promise.all([api(`visits/flags?${wantFlags?flagQuery():new URLSearchParams({from:M.flagFrom,to:M.flagTo,status:'menunggu'})}`),
  api(`visits/guest-reports?${wantGuest?guestQuery():new URLSearchParams({from:M.flagFrom,to:M.flagTo,status:'menunggu'})}`).catch(error=>{if(error.status===404)return null;throw error;})]);
 M.flags=wantFlags?flags:{...empty(flags),menunggu_semua:flags.menunggu_semua,can_decide:flags.can_decide};
 M.guestReports=guest&&!wantGuest?{...guest,items:[],menunggu_semua:guest.menunggu_semua}:guest;
}
/* ---------- Review negatif & komplain (menu HP pos, 23 November 2026) ---------- */
const guestStatusLabel={menunggu:['warm','Menunggu'],disetujui:['positive','Disetujui'],ditolak:['neutral','Ditolak']};
function guestRow(r,manage){
 const [kind,label]=guestStatusLabel[r.status]||['neutral',r.status];
 const actions=!manage?'':r.status==='menunggu'?`${btn('Setujui','guest-approve','check','primary',`data-id="${esc(r.id)}"`)}${btn('Tolak','guest-reject','close','outlined',`data-id="${esc(r.id)}"`)}${btn(r.jenis==='review'?'Pindah ke komplain':'Pindah ke review','guest-move','refresh','text',`data-id="${esc(r.id)}"`)}`:btn('Buka kembali','guest-reopen','refresh','text',`data-id="${esc(r.id)}"`);
 const w=r.wisatawan,tourist=w&&(w.nama||w.asal||w.kontak)?`<br><span class="muted text-small">Wisatawan: ${esc([w.nama,w.asal,w.kontak].filter(Boolean).join(' · '))}</span>`:'';
 const effect=r.status!=='disetujui'?'':r.jenis==='review'?`<br><span class="muted text-small">Nilai akhir −${number(r.potongan)}</span>`:'<br><span class="muted text-small">Nilai bulan itu dihapus</span>';
 return `<tr><td>${esc(formatDate(r.tanggal))}<br><span class="muted text-small">dicatat ${esc(when(r.waktu))} · Pos ${esc(r.pos)}</span></td><td><strong>${esc(r.guideName)}</strong><br><span class="muted text-small">${esc(r.guideId)} · ${esc(r.regu||'—')}</span></td>
  <td><span class="badge ${r.jenis==='komplain'?'negative':'warm'}">${r.jenis==='komplain'?'Komplain':'Review negatif'}</span><br>${esc(r.label)}${r.jenisAwal!==r.jenis?`<br><span class="muted text-small">dipindah dari ${r.jenisAwal==='komplain'?'komplain':'review negatif'}</span>`:''}</td>
  <td>${esc(r.keterangan)}${r.kronologi?`<br><span class="muted text-small">Kronologi: ${esc(r.kronologi)}</span>`:''}${tourist}${r.klarifikasi?`<br><span class="muted text-small">Klarifikasi guide: ${esc(r.klarifikasi)}</span>`:''}</td><td>${esc(r.petugas||'—')}</td>
  <td><span class="badge ${kind}">${esc(label)}</span>${effect}${r.diputuskanPada?`<br><span class="muted text-small">${esc(r.diputuskanOleh)} · ${esc(when(r.diputuskanPada))}</span>`:''}${r.keputusanCatatan?`<br><span class="muted text-small">${esc(r.keputusanCatatan)}</span>`:''}</td>${manage?`<td><div class="actions">${actions}</div></td>`:''}</tr>`;
}
async function guestAction(action,id){
 const r=M.guestReports?.items.find(x=>x.id===id);if(!r)return;
 const send=async body=>{await post('visits/guest-reports/decide',{id:r.id,row_version:r.row_version,...body});};
 const who=`<p class="full">${esc(r.label)} — <strong>${esc(r.guideName)}</strong>, ${esc(formatDate(r.tanggal))}. ${esc(r.keterangan)}</p>`;
 const month=esc(monthLabel(r.tanggal.slice(0,7)));
 const clarify=(required,hint)=>`<label class="field full"><span>Klarifikasi guide${required?'':' (boleh kosong)'}</span><textarea name="klarifikasi" rows="3" maxlength="1000"${required?' required':''} placeholder="${esc(hint)}">${esc(r.klarifikasi||'')}</textarea></label>`;
 const decisionNote=label=>`<label class="field full"><span>${label}</span><textarea name="catatan" rows="2" maxlength="500"></textarea></label>`;
 if(action==='guest-reopen'){await send({action:'buka'});toast('Catatan dibuka kembali.');refresh();return;}
 if(action==='guest-approve'&&r.jenis==='review'){
  formDialog('Setujui review negatif',`${who}<label class="field"><span>Potongan nilai akhir (poin)</span><input type="number" name="potongan" min="1" max="100" step="1" required value="${esc(M.guestReports.pot_review||5)}"></label>${clarify(false,'Tanggapan guide, bila ada.')}${decisionNote('Catatan keputusan (boleh kosong)')}`,
   async data=>{await send({action:'setujui',potongan:Number(data.potongan),klarifikasi:data.klarifikasi,catatan:data.catatan});toast('Review negatif disetujui.');refresh();},
   {submit:'Setujui',note:`Nilai akhir ${r.guideName} bulan ${monthLabel(r.tanggal.slice(0,7))} dipotong sebesar ini. Tanpa batas per bulan; nilai akhir paling rendah 0. Keputusan diaudit dan bisa dibuka kembali.`});
  return;
 }
 if(action==='guest-approve'){
  formDialog('Setujui komplain',`${who}${r.kronologi?`<p class="full muted text-small">Kronologi: ${esc(r.kronologi)}</p>`:''}${clarify(true,'Tanggapan guide setelah dihubungi, atau tulis bahwa guide tidak menanggapi.')}${decisionNote('Catatan keputusan (boleh kosong)')}`,
   async data=>{await send({action:'setujui',klarifikasi:data.klarifikasi,catatan:data.catatan});toast('Komplain disetujui.');refresh();},
   {submit:'Setujui komplain',note:`Nilai ${r.guideName} bulan ${monthLabel(r.tanggal.slice(0,7))} dihapus (menjadi 0): gugur reward dan tidak diperingkat. Keputusan diaudit dan bisa dibuka kembali.`});
  return;
 }
 if(action==='guest-reject'){
  formDialog(r.jenis==='review'?'Tolak review negatif':'Tolak komplain',`${who}<label class="field full"><span>Alasan penolakan</span><textarea name="catatan" rows="3" maxlength="500" required></textarea></label>${r.jenis==='komplain'?clarify(false,'Tanggapan guide, bila ada.'):''}`,
   async data=>{await send({action:'tolak',catatan:data.catatan,...(r.jenis==='komplain'?{klarifikasi:data.klarifikasi}:{})});toast('Catatan ditolak.');refresh();},{submit:'Tolak'});
  return;
 }
 if(action==='guest-move'){
  const target=r.jenis==='review'?'komplain':'review',choices=M.guestReports.jenis?.[target]||[];
  if(!choices.length){toast(`Belum ada jenis ${target==='review'?'review negatif':'komplain'} yang aktif di Aturan Nilai.`,true);return;}
  formDialog(target==='komplain'?'Pindahkan ke komplain':'Pindahkan ke review negatif',`${who}<label class="field full"><span>Jenis ${target==='review'?'review negatif':'komplain'}</span><select name="kode" required>${choices.map(t=>`<option value="${esc(t.kode)}">${esc(t.label)}</option>`).join('')}</select></label>${decisionNote('Alasan dipindah (boleh kosong)')}`,
   async data=>{await send({action:'pindah',jenis:target,kode:data.kode,catatan:data.catatan});toast(`Catatan dipindah ke ${target==='review'?'review negatif':'komplain'}.`);refresh();},
   {submit:'Pindahkan',note:target==='komplain'?`Bila nanti disetujui sebagai komplain, nilai ${r.guideName} bulan ${monthLabel(r.tanggal.slice(0,7))} dihapus.`:'Bila nanti disetujui sebagai review negatif, nilai akhir bulan itu dipotong sebesar yang ditetapkan.'});
 }
}
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
const kindLabel={teguran:'Teguran',berat:'Pelanggaran berat',apresiasi:'Apresiasi',review:'Review negatif',komplain:'Komplain'};
// Keterangan tiap daftar jenis. Sejak 23 November 2026 pelanggaran berat dan komplain yang disetujui
// menghapus nilai bulan itu; review negatif memotong nilai akhir sebesar yang ditetapkan Pengelola.
const kindNote=(k,reports)=>({berat:reports?'Dilihat sendiri oleh petugas pos. Bila disetujui Pengelola, nilai guide bulan itu dihapus (0) dan gugur reward.':'Tidak dirata-rata. Bila disetujui Pengelola, guide gugur reward bulan itu.',
 apresiasi:'Tidak masuk nilai. Bila disetujui, menjadi penentu saat nilai sama.',
 komplain:'Disampaikan wisatawan, dugaan pelanggaran; dicatat di menu Komplain HP pos. Bila disetujui, nilai guide bulan itu dihapus (0) dan gugur reward.',
 review:'Disampaikan wisatawan, soal pelayanan; dicatat di menu Review Negatif HP pos. Bila disetujui, nilai akhir bulan itu dipotong sebesar yang ditetapkan Pengelola.'})[k];
function scoringPage(){
 const d=M.scoring,manage=d.can_manage,a=d.aturan,now=a.berlaku,next=a.bulan_depan_aturan,reports=d.petunjuk.pot_review!==undefined;
 const ruleRow=r=>`<tr><td>${esc(monthLabel(r.berlaku_mulai))}</td><td>−${number(r.pot_id)}</td><td>−${number(r.pot_kurang)}</td><td>−${number(r.pot_tidak)}</td><td>${number(r.ambang)}</td><td>${number(r.minimal)}</td><td>${r.berlaku_mulai>a.bulan_ini?`<span class="badge warm">Rencana</span>${manage?` ${btn('Batalkan','rule-delete','close','text',`data-month="${esc(r.berlaku_mulai)}"`)}`:''}`:r.berlaku_mulai===now.berlaku_mulai?'<span class="badge positive">Berlaku</span>':'<span class="muted">Riwayat</span>'}</td></tr>`;
 const types=k=>d.jenis.filter(t=>t.jenis===k).map(t=>`<tr class="${t.aktif?'':'visit-dim'}"><td>${esc(t.label)}<br><span class="muted text-small">${esc(t.kode)}</span></td><td>${t.perlu_catatan?'Wajib':'Tidak'}</td><td>${t.aktif?'Aktif':'Nonaktif'}</td>${manage?`<td>${btn('Ubah','type-edit','settings','text',`data-kode="${esc(t.kode)}"`)}</td>`:''}</tr>`);
 const typeCard=k=>card(kindLabel[k],kindNote(k,reports),
  table(['Jenis','Catatan','Status',...(manage?['']:[])],types(k)),manage?btn('Tambah','type-new','plus','outlined',`data-jenis="${k}"`):'');
 // Teguran perilaku diganti Etika (−10…+10) sejak 17 November 2026; jenis teguran lama
 // tetap tersimpan untuk label penilaian formulir 2.2, tetapi tidak lagi diatur di sini.
 return `${head('Aturan Nilai',`Nilai pengantaran = 100 − potongan + Etika. Petugas pos mencatat ID-Card, seragam, dan Etika; besar potongan ditetapkan di sini. Perubahan berlaku mulai bulan depan dan diaudit.${reports?' Review negatif dan komplain yang disetujui menentukan nilai akhir bulanan.':''}`)}
 <div class="stats-grid">${stat('Tanpa ID-Card',`−${now.pot_id}`)}${stat('Seragam kurang lengkap',`−${now.pot_kurang}`)}${stat('Tidak berseragam',`−${now.pot_tidak}`)}${stat('Etika','−10 … +10','ditambahkan langsung; 0 = standar')}${stat('Ambang layak reward',number(now.ambang))}${stat('Minimal pengantaran',number(now.minimal),'di bawahnya: belum cukup data')}${reports?`${stat('Review negatif',`−${d.petunjuk.pot_review}`,'bawaan per review; bisa diubah saat menyetujui')}${stat('Komplain','nilai dihapus','begitu juga pelanggaran berat yang disetujui')}`:''}</div>
 <div class="visit-stack">${card(`Aturan bulan ${monthLabel(a.bulan_ini)} dan sesudahnya`,`${monthLabel(a.bulan_depan)}: ${ruleLine(next)}, ambang ${next.ambang}, minimal ${next.minimal} pengantaran. Aturan bulan berjalan tidak bisa diubah.`,
  table(['Berlaku mulai','Tanpa ID','Kurang lengkap','Tidak berseragam','Ambang','Minimal','Status'],a.riwayat.slice().reverse().map(ruleRow)),manage?btn(`Atur ${monthLabel(a.bulan_depan)}`,'rule-edit','settings','primary'):'')}
 <div class="visit-grid">${typeCard('berat')}${typeCard('apresiasi')}</div>
 ${reports?card('Review negatif & komplain dari HP pos','Dicatat petugas pos lewat menu Review Negatif dan Komplain, lalu diputuskan Pengelola di Verifikasi. Yang menunggu belum berdampak. Nilai akhir bulanan = nilai pengantaran − jumlah potongan review negatif yang disetujui (tanpa batas per bulan, paling rendah 0); komplain yang disetujui menghapus nilai bulan itu.',
  `<div class="card-body"><p><strong>Potongan bawaan review negatif:</strong> −${esc(String(d.petunjuk.pot_review))} poin per review. Pengelola bisa memakai angka lain (1–100) saat menyetujui.</p><p><strong>Komplain:</strong> baru bisa disetujui setelah klarifikasi guide dicatat.</p></div>`,manage?btn('Ubah potongan bawaan','report-settings','settings','outlined'):''):''}
 ${reports?`<div class="visit-grid">${typeCard('komplain')}${typeCard('review')}</div>`:''}
 ${manage?card('Petugas penilai','Dipilih petugas sekali per shift di HP pos (berlaku 8 jam). Nama yang dinonaktifkan tidak muncul lagi di HP.',table(['Nama','Keterangan','Status',''],d.petugas.map(p=>`<tr class="${p.aktif?'':'visit-dim'}"><td><strong>${esc(p.nama)}</strong></td><td>${esc(p.keterangan||'—')}</td><td>${p.aktif?'Aktif':'Nonaktif'}</td><td>${btn('Ubah','assessor-edit','settings','text',`data-id="${esc(p.id)}"`)}</td></tr>`),'Belum ada petugas. Tanpa daftar ini, HP pos menyimpan penilaian tanpa nama petugas.'),btn('Tambah petugas','assessor-new','plus','outlined')):''}
 ${card('Petunjuk di formulir pos','Tampil di bawah tombol masing-masing, supaya Pos 1 dan Pos 3 memakai patokan yang sama. Patokan Etika berlaku untuk semua pos dan tidak diubah di sini.',`<div class="card-body"><p><strong>ID-Card:</strong> ${esc(d.petunjuk.petunjuk_id)}</p><p><strong>Seragam:</strong> ${esc(d.petunjuk.petunjuk_seragam)}</p><p><strong>Etika:</strong> ${esc(etikaPatokan)}</p></div>`,manage?btn('Ubah petunjuk','form-edit','settings','outlined'):'')}</div>
 <p class="muted visit-note">HP pos memperbarui daftar jenis, petugas, dan petunjuk bersama daftar guide (paling lama 10 menit, atau lewat Pengaturan → Tes Koneksi).</p>`;
}
function ruleDialog(){
 const a=M.scoring.aturan,r=a.bulan_depan_aturan,num=(name,label,min,max)=>`<label class="field"><span>${label}</span><input type="number" name="${name}" min="${min}" max="${max}" step="1" required value="${esc(r[name])}"></label>`;
 formDialog(`Aturan mulai ${monthLabel(a.bulan_depan)}`,`${num('pot_id','Potongan tanpa ID-Card',0,50)}${num('pot_kurang','Potongan seragam kurang lengkap',0,50)}${num('pot_tidak','Potongan tidak berseragam',0,50)}${num('ambang','Ambang layak reward',50,100)}${num('minimal','Minimal pengantaran sebulan',1,60)}`,
  async data=>{await post('visits/scoring/rule',{...data,berlaku_mulai:a.bulan_depan});toast(`Aturan ${monthLabel(a.bulan_depan)} disimpan.`);refresh();},
  {note:'Tanpa ID + tidak berseragam paling banyak 90 (supaya Etika −10 tidak membawa nilai di bawah 0), dan "kurang lengkap" tidak boleh lebih besar dari "tidak berseragam". Etika −10…+10 ditambahkan langsung ke nilai. Bulan berjalan tetap memakai aturannya.'});
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
function reportSettingsDialog(){
 const f=M.scoring.petunjuk;
 formDialog('Potongan bawaan review negatif',`<label class="field"><span>Potongan per review (poin)</span><input type="number" name="pot_review" min="1" max="100" step="1" required value="${esc(f.pot_review)}"></label>`,
  async data=>{await post('visits/scoring/reports',{pot_review:Number(data.pot_review),row_version:f.row_version});toast('Potongan bawaan disimpan.');refresh();},
  {note:'Dipakai sebagai isian awal saat menyetujui review negatif; Pengelola tetap bisa memakai angka lain. Keputusan yang sudah diambil tidak berubah.'});
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
  if(route==='visits-flags'){await loadVerification();return flagsPage();}
  if(route==='visits-scoring'){M.scoring=await api('visits/scoring');return scoringPage();}
  if(route==='visits-links'){const [links,sheet]=await Promise.all([api('visits/links'),api('visits/sheet').catch(()=>null)]);M.links=links;M.sheet=sheet;return linksPage();}
  if(route==='visits-reports'){
   M.reportMode||=rememberedMode();M.reportDay||=localToday();M.reportWeek||=weekStartOf(localToday());
   const [report,history]=await Promise.all([loadReport(),permitted('visits.settings.manage')?api('visits/history').catch(()=>null):null]);M.report=report;M.history=history;return reportsPage();
  }
 }catch(error){if(error.name==='AbortError')throw error;return unavailable(visitTitles[route],error,route==='visits-reports'?periodBar:filters);}
 return unavailable(visitTitles[route]);
}

export function bindVisitsPage(route){
 if(route==='visits-reports')mountReportChart();
 const root=document.querySelector('#main');if(!root||root.dataset.visitBound)return;root.dataset.visitBound='1';
 root.addEventListener('input',e=>{const key=e.target.dataset?.visitField;if(!key)return;M[key]=e.target.value;if(['guideQuery','guideKategori','guideRegu','guideAktif'].includes(key)&&state.route==='visits-guides')rerender(guidesPage,e.target);});
 root.addEventListener('change',e=>{const key=e.target.dataset?.visitFilter;if(key)M.recordFilter[key]=e.target.value;const field=e.target.dataset?.visitField;if(field&&e.target.tagName==='SELECT')M[field]=e.target.value;
  // Laporan: bulan dan tanggal langsung diterapkan. Tanggal setengah diketik (tahun 0002) diabaikan.
  if(state.route!=='visits-reports')return;
  if(field==='month')refresh();
  const day=e.target.value;if(!(day>='2025-01-01'&&day<=localToday()))return;
  if(field==='reportDayPick'){M.reportDay=day;refresh();}
  if(field==='reportWeekPick'){M.reportWeek=weekStartOf(day);refresh();}
 });
 root.addEventListener('click',async e=>{
  const el=e.target.closest('[data-visit]');if(!el||!visitRoutes.includes(state.route))return;
  const action=el.dataset.visit;el.disabled=true;
  try{
   if(action==='apply'||action==='retry'){if(M.from>M.to||M.flagFrom>M.flagTo)throw new Error('Tanggal mulai harus sebelum tanggal akhir.');refresh();return;}
   // Ganti jenis laporan: grafik kembali ke rentang bawaannya (per jam untuk harian, per hari lainnya).
   if(action==='report-mode'){M.reportMode=['hari','minggu'].includes(el.dataset.mode)?el.dataset.mode:'bulan';M.trendScope='';rememberMode(M.reportMode);refresh();return;}
   if(action==='report-prev'||action==='report-next'){const step=action==='report-prev'?-1:1;
    if(M.reportMode==='hari')M.reportDay=shiftDay(M.reportDay,step);else if(M.reportMode==='minggu')M.reportWeek=shiftDay(M.reportWeek,7*step);else M.month=addMonth(M.month,step);refresh();return;}
   if(action==='report-current'){M.reportDay=localToday();M.reportWeek=weekStartOf(localToday());M.month=localToday().slice(0,7);refresh();return;}
   if(action==='report-records'){M.from=M.to=M.reportDay;M.recordFilter={pos:'',regu:'',status:''};location.hash='#visits-records';return;}
   if(action==='trend-scope'){M.trendScope=el.dataset.scope;root.innerHTML=reportsPage();mountReportChart();root.querySelector(`[data-visit="trend-scope"][data-scope="${M.trendScope}"]`)?.focus();return;}
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
   if(action.startsWith('guest-')){await guestAction(action,el.dataset.id);return;}
   if(action==='report-settings'){reportSettingsDialog();return;}
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
