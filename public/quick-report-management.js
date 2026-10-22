import {api,post} from './api.js';
import {esc,field,formDialog,dialog,toast} from './ui.js';

function showLink(result){
  const url=new URL('/laporan-cepat/',location.origin);url.hash=result.token;
  const el=dialog('Tautan laporan siap dibagikan',`<p class="detail-prose">Bagikan tautan ini kepada petugas Keamanan. Petugas dapat memilih nama, mengisi kegiatan, mengambil foto dan lokasi, lalu mengirim laporan.</p><label class="field full"><span>Tautan Laporan Cepat</span><input type="url" readonly value="${esc(url.href)}" data-share-link></label><div class="actions"><button type="button" class="button primary" data-copy-link>Salin tautan</button><a class="button outlined" href="${esc(url.href)}" target="_blank" rel="noreferrer">Pratinjau formulir</a></div><p class="form-note">Salin dan simpan tautan ini sebelum menutup. Jika tautan hilang, buat tautan baru.</p><p role="status" data-copy-status></p>`);
  el.querySelector('[data-copy-link]').addEventListener('click',async()=>{const input=el.querySelector('[data-share-link]'),status=el.querySelector('[data-copy-status]');try{await navigator.clipboard.writeText(input.value);status.textContent='Tautan berhasil disalin.';}catch{input.select();status.textContent='Tekan dan tahan tautan untuk menyalinnya.';}});
}
export async function openQuickReportSettings(){
  const data=await api('report-links'),active=data.link;
  if(!data.can_manage_active){dialog('Tautan laporan cepat','<p class="detail-prose">Tautan aktif dikelola di luar cakupan Anda. Hubungi pengelola Keamanan yang membuat tautan.</p>');return;}
  if(!data.positions.length){dialog('Tautan laporan cepat','<p class="detail-prose">Belum ada posisi Keamanan dalam cakupan Anda. Lengkapi posisi dan penempatan pegawai terlebih dahulu.</p>');return;}
  const selected=new Set(active?.position_ids||data.positions.map(p=>p.id));
  const positions=`<fieldset class="document-targets full"><legend>Posisi pegawai Keamanan</legend><p class="muted text-small">Hanya pegawai aktif pada posisi terpilih yang dapat dipilih melalui tautan.</p><div class="document-target-list">${data.positions.map(p=>`<label class="check-field document-target-option"><input type="checkbox" name="position_ids[]" value="${esc(p.id)}" ${selected.has(p.id)?'checked':''}><span>${esc(p.name)}<small class="muted"> · ${esc(p.unit_name)}</small></span></label>`).join('')}</div></fieldset>`;
  const el=formDialog('Tautan laporan cepat',`<p class="full detail-prose">${active?'Tautan sudah aktif. Membuat tautan baru akan menonaktifkan tautan sebelumnya.':'Buat satu tautan bersama untuk petugas Keamanan. Petugas tidak perlu login.'}</p>`+field('Nama formulir','label','text',active?.label||'Laporan Keamanan','maxlength="120"')+positions+(active?'<div class="full"><button type="button" class="button outlined" data-revoke-link>Nonaktifkan tautan</button></div>':''),async b=>{
    if(!b.position_ids?.length)throw new Error('Pilih minimal satu posisi Keamanan.');
    const result=await post('report-links',{label:b.label,position_ids:b.position_ids,active_link_id:active?.id||null,row_version:active?.row_version});showLink(result);
  },{submit:active?'Buat tautan baru':'Buat tautan',note:'Nama pada laporan dipilih oleh pengirim. Laporan dari tautan diberi penanda khusus pada Logbook & Patroli.'});
  el.querySelector('[data-revoke-link]')?.addEventListener('click',()=>formDialog('Nonaktifkan tautan laporan?',`<p class="full detail-prose">Petugas tidak dapat mengirim laporan melalui tautan ini setelah dinonaktifkan. Laporan yang sudah tersimpan tetap dapat dibaca di portal.</p>`,async()=>{await post(`report-links/${active.id}/revoke`,{row_version:active.row_version});el.close();toast('Tautan laporan dinonaktifkan.');},{submit:'Nonaktifkan tautan'}));
}
