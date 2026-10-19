// Modul Pengadaan: Pengajuan Saya, Persetujuan, Antrean Purchasing, vendor, Pos RKA,
// laporan, pengaturan, detail PR, dan halaman cetak PR/PO/SPK/surat penunjukan.
import {state,api,post,patch,uploadFile,refresh} from './api.js';
import {esc,icon,button,dialog,formDialog,toast,formatDate,formatTime,empty,number,options,localToday} from './ui.js';
import {encodeQR} from './vendor/qr.js';
import {createSummaryResource} from './summary-resource.js';

export const purchasingTitles={purchasing:'Beranda Pengadaan','pr-mine':'Pengajuan Saya','pr-approvals':'Persetujuan PR','pr-queue':'Antrean Purchasing','pr-all':'Semua PR',vendors:'Daftar Vendor',budget:'Pos RKA','purchasing-reports':'Laporan Pengadaan','purchasing-settings':'Pengaturan Pengadaan','pr-verify':'Verifikasi Dokumen'};
export const purchasingRoutes=Object.keys(purchasingTitles);
export const purchasingNav=[['purchasing','Beranda','dashboard','purchasing:home'],['pr-mine','Pengajuan Saya','document','purchasing:submit'],['pr-approvals','Persetujuan','check','purchasing:home'],['pr-queue','Antrean Purchasing','folder','purchasing:procurement'],['pr-all','Semua PR','log','purchasing:read_all'],['vendors','Vendor','building','purchasing:vendors'],['budget','Pos RKA','audit','purchasing:budget'],['purchasing-reports','Laporan','filter','purchasing:reports'],['purchasing-settings','Pengaturan','settings','purchasing:settings']];
export const purchasingAllowed=key=>key==='home'||Boolean(state.purchasing?.capabilities?.[key]);
const overviewSummary=createSummaryResource('purchasing/overview',result=>{state.purchasing=result;});
export const loadPurchasingOverview=options=>overviewSummary.load(options);
export const invalidatePurchasingOverview=()=>overviewSummary.invalidate();
// Butir lonceng notifikasi dari ringkasan Pengadaan.
export function purchasingNotices(){
  const c=state.purchasing?.counts;if(!c)return [];
  return [
    c.approvals&&{route:'pr-approvals',count:c.approvals,title:'PR menunggu persetujuan Anda',note:'Tahap Diketahui, Verifikasi, Disetujui, atau PO/SPK',ico:'check'},
    c.my_action&&{route:'pr-mine',count:c.my_action,title:'Pengajuan Anda perlu tindakan',note:'Dikembalikan atau menunggu konfirmasi harga',ico:'document'},
    c.completeness&&{route:'pr-queue',count:c.completeness,title:'PR menunggu pemeriksaan Purchasing',note:'Beri nomor PR dan PIC pembelian',ico:'folder'}
  ].filter(Boolean);
}
export function resetPurchasingState(){overviewSummary.reset();state.purchasing=null;Object.assign(P,{items:[],detail:null,lookups:null,view:'',year:null,status:'',budget:null,vendors:null,settings:null,delegations:[],report:null});}

const P={items:[],detail:null,lookups:null,view:'',year:null,status:'',budget:null,vendors:null,settings:null,delegations:[]};
const rp=v=>v===null||v===undefined?'—':`Rp${number(v)}`;
const heading=(title,description,actions='')=>`<div class="page-heading"><div><h1>${esc(title)}</h1><p>${esc(description)}</p></div><div class="actions">${actions}</div></div>`;
const table=(headers,rows,emptyText='Belum ada data')=>rows.length?`<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`:empty(emptyText,'Data akan tampil di sini setelah ada pengajuan.');
const card=(title,sub,body,actions='')=>`<section class="card"><header class="card-header"><div><h2>${esc(title)}</h2>${sub?`<p>${esc(sub)}</p>`:''}</div>${actions?`<div class="actions">${actions}</div>`:''}</header>${body}</section>`;
const value=(label,val)=>`<div><p class="detail-label">${esc(label)}</p><p class="detail-value">${esc(val===null||val===undefined||val===''?'—':val)}</p></div>`;
const stat=(name,val,note,ico,route)=>`<a class="stat-card" href="#${route}"><div class="stat-top"><span>${esc(name)}</span><span class="stat-icon">${icon(ico)}</span></div><div class="stat-value">${number(val)}</div><div class="stat-bottom">${icon('arrow')}<span>${esc(note)}</span></div></a>`;
const tone=status=>['completed','received','APPROVED','ACCEPTED','ordered','purchased'].includes(status)?'positive':['rejected','cancelled','RETURNED','REJECTED','CANCELLED'].includes(status)?'negative':['SKIPPED','SUPERSEDED','draft'].includes(status)?'neutral':'warm';
const pill=(status,label)=>`<span class="badge ${tone(status)}"><span class="status-dot"></span>${esc(label||status)}</span>`;
const orderLabels={draft:'Draf',pending_appointment_approval:'Menunggu Kaban (penunjukan)',pending_order_approval:'Menunggu persetujuan PO/SPK',ordered:'Dipesan',purchased:'Dibeli',received:'Diterima',cancelled:'Dibatalkan'};
const stepLabels={PENDING:'Menunggu',APPROVED:'Disetujui',RETURNED:'Dikembalikan',REJECTED:'Ditolak',SKIPPED:'Dilewati',SUPERSEDED:'Tidak berlaku'};
const docLabels={PR:'PR',PO:'PO',SPK:'SPK',SPV:'Surat penunjukan'};
const pathLabels={A:'A · Langsung beli',B:'B · Perbandingan harga',C:'C · Surat penunjukan'};
const kindLabels={GOODS:'Barang',SERVICE:'Jasa'};
const statusChoices=[['','Semua status'],['pending_acknowledgement','Menunggu atasan'],['pending_verification','Menunggu Keuangan'],['pending_final_approval','Menunggu Sekban/Kaban'],['returned','Dikembalikan'],['pending_completeness_check','Diperiksa Purchasing'],['in_procurement','Diproses Purchasing'],['pending_requester_confirmation','Menunggu konfirmasi pemohon'],['pending_reverification','Verifikasi ulang Keuangan'],['pending_reapproval','Persetujuan ulang Kaban'],['completed','Selesai'],['rejected','Ditolak'],['cancelled','Dibatalkan']];
const parseQty=v=>{const n=Number(String(v||'').trim().replace(',','.'));return Number.isFinite(n)&&n>0?n:0;};
const fileLink=(id,name)=>`<a class="file-link" href="/api/files/${esc(id)}" download>${icon('download')}${esc(name||'Unduh berkas')}</a>`;
function attachmentList(list){
  if(!list?.length)return '<span class="muted text-small">—</span>';
  return `<div class="pg-attachments">${list.map(a=>a.form==='FILE'?fileLink(a.file_id,a.original_name):a.form==='LINK'?`<a class="file-link" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${icon('arrow')}${esc(a.note||a.url)}</a>`:`<span class="text-small">${esc(a.note)}</span>`).join('')}</div>`;
}
async function lookups(force=false){if(!P.lookups||force)P.lookups=await api(`purchasing/lookups?year=${P.year||localToday().slice(0,4)}`);return P.lookups;}
function hashQuery(){return new URLSearchParams(location.hash.split('?')[1]||'');}

export async function loadPurchasingPage(route){
  const overview=state.purchasing||await loadPurchasingOverview();
  if(route==='purchasing')return homePage(overview);
  if(['pr-mine','pr-approvals','pr-queue','pr-all'].includes(route)){
    P.view={'pr-mine':'mine','pr-approvals':'approvals','pr-queue':'procurement','pr-all':'all'}[route];
    const query=new URLSearchParams({view:P.view});if(P.status&&route==='pr-all')query.set('status',P.status);
    P.items=(await api(`purchasing/requests?${query}`)).items;
    return listPage(route,overview);
  }
  if(route==='vendors'){P.vendors=await api('purchasing/vendors');return vendorsPage();}
  if(route==='budget'){P.budget=await api(`purchasing/budget${P.year?`?year=${P.year}`:''}`);P.year=P.budget.year;return budgetPage();}
  if(route==='purchasing-reports'){P.report=await api(`purchasing/reports${P.year?`?year=${P.year}`:''}`);return reportsPage();}
  if(route==='purchasing-settings'){const [settings,delegations]=await Promise.all([api('purchasing/settings'),api('purchasing/delegations')]);P.settings=settings;P.delegations=delegations.items;await lookups(true);return settingsPage();}
  if(route==='pr-verify')return verifyPage(hashQuery().get('code'));
  return empty('Halaman tidak ditemukan','Pilih salah satu menu Pengadaan.');
}
// Dipanggil setelah halaman tampil: membuka detail PR dari tautan #pr-mine?id=…
export async function afterPurchasingPage(){
  const id=hashQuery().get('id');if(!id||location.hash.startsWith('#pr-verify'))return;
  history.replaceState(null,'',location.hash.split('?')[0]);
  if(/^[A-Za-z0-9-]{8,64}$/.test(id))try{await openRequest(id);}catch(e){toast(e.message,true);}
}

function homePage(o){
  const caps=o.capabilities;
  const missing=o.can_submit||!caps.submit?'':`<div class="notice warning">${icon('incident')}<div><strong>PR belum dapat dikirim dari akun ini</strong><p>Lengkapi: ${esc(o.missing.join(' '))} Hubungi SDM atau administrator portal.</p></div></div>`;
  const me=o.me?`<div class="detail-grid">${value('Pemohon',`${o.me.name} · ${o.me.employee_no}`)}${value('Jabatan',o.me.position)}${value('Unit',o.me.unit)}${value('Atasan langsung',o.me.supervisor)}</div>`:'<p class="muted">Akun ini belum tertaut ke data pegawai.</p>';
  const rules=`<ul class="pg-rules"><li>PR dengan total sampai ${rp(o.rules.sekban_max_total)} disetujui Sekban; di atasnya atau anggaran khusus disetujui Kaban.</li><li>Item bersubtotal ${rp(o.rules.attachment_min_item_subtotal)} atau lebih wajib berlampiran (link, foto, atau detail toko).</li><li>Total ${rp(o.rules.comparison_min_total)} atau lebih dibeli lewat perbandingan minimal ${o.rules.min_quotes_per_item} harga atau surat penunjukan yang disetujui Kaban.</li><li>Kenaikan harga berapa pun meminta konfirmasi Anda sebelum pembelian dilanjutkan.</li></ul>`;
  return `${heading('Pengadaan','Ajukan kebutuhan barang atau jasa dan ikuti prosesnya sampai serah terima.',caps.submit?button('Buat PR','pg-new-request','plus','primary',o.can_submit?'':'disabled'):'')}${missing}
  <div class="stats-grid">${stat('Perlu tindakan Anda',o.counts.my_action,'Pengajuan dikembalikan atau menunggu konfirmasi','document','pr-mine')}${stat('Menunggu persetujuan Anda',o.counts.approvals,'Tahap Diketahui, Verifikasi, atau Disetujui','check','pr-approvals')}${caps.procurement?stat('Diperiksa Purchasing',o.counts.completeness,'Menunggu nomor PR dan PIC','folder','pr-queue')+stat('Diproses Purchasing',o.counts.procurement,'Perbandingan, pesanan, dan serah terima','building','pr-queue'):''}</div>
  <div class="grid-two">${card('Data pemohon','Diambil dari data SDM portal saat PR dikirim.',`<div class="card-body">${me}</div>`)}${card('Aturan utama','Batas dapat diubah Pengelola Pengadaan dan tercatat di audit.',`<div class="card-body">${rules}</div>`)}</div>`;
}

function listPage(route,o){
  const titles={'pr-mine':['Pengajuan Saya','PR yang Anda ajukan, termasuk yang dikembalikan atau menunggu konfirmasi harga.'],'pr-approvals':['Persetujuan','PR, surat penunjukan, dan PO/SPK yang menunggu keputusan Anda, termasuk sebagai Plh.'],'pr-queue':['Antrean Purchasing','Periksa kelengkapan, bandingkan harga, terbitkan pesanan, dan catat serah terima.'],'pr-all':['Semua PR','PR dalam cakupan akses Anda.']}[route];
  const actions=(route==='pr-mine'&&o.capabilities.submit?button('Buat PR','pg-new-request','plus','primary',o.can_submit?'':'disabled'):'')+(route==='pr-all'&&o.capabilities.export?button('Ekspor CSV','pg-export','download','outlined'):'');
  const filter=route==='pr-all'?`<div class="toolbar"><label class="field"><span>Status</span><select data-pg-filter="status" aria-label="Saring status">${statusChoices.map(([v,l])=>`<option value="${v}" ${v===P.status?'selected':''}>${esc(l)}</option>`).join('')}</select></label></div>`:'';
  const rows=P.items.map(r=>`<tr><td><button class="button text pg-link" data-action="pg-open" data-id="${esc(r.id)}"><strong>${esc(r.pr_number||r.request_code)}</strong></button><small class="muted pg-block">${esc(r.pr_number?r.request_code:'Nomor PR belum terbit')}</small></td><td>${esc(r.requester_name)}<small class="muted pg-block">${esc(r.unit_name||'')}</small></td><td class="nowrap">${formatDate(r.request_date)}<small class="muted pg-block">Butuh ${formatDate(r.needed_on)}</small></td><td class="nowrap">${rp(r.approved_total??r.estimated_total)}<small class="muted pg-block">${number(r.item_count)} item</small></td><td>${pill(r.status,r.status_label)}${r.late?` ${pill('rejected','Terlambat')}`:''}${r.waiting_step?`<small class="muted pg-block">${esc(r.waiting_step.label)} · sejak ${formatDate(r.waiting_step.since)}</small>`:''}</td><td><button class="icon-button" data-action="pg-open" data-id="${esc(r.id)}" aria-label="Buka PR">${icon('chevron')}</button></td></tr>`);
  return `${heading(titles[0],titles[1],actions)}${filter}<section class="card">${table(['PR','Pemohon','Tanggal','Total','Status',''],rows,route==='pr-approvals'?'Tidak ada yang menunggu persetujuan Anda':'Belum ada PR')}</section>`;
}

// ---------- Formulir PR ----------
function itemBlock(item={},index=0){
  const keep=(item.attachments||[]).map(a=>`<label class="check-field"><input type="checkbox" data-keep checked value="${esc(JSON.stringify({form:a.form,url:a.url||undefined,note:a.note||undefined,file_id:a.file_id||undefined}))}"><span>${esc(a.form==='FILE'?a.original_name||'Berkas':a.form==='LINK'?a.url:a.note)}</span></label>`).join('');
  return `<fieldset class="pg-item" data-item><legend>Item <span data-item-no>${index+1}</span></legend><div class="form-grid">
  <label class="field full"><span>Deskripsi barang atau jasa (merek, ukuran, spesifikasi)</span><input data-f="description" maxlength="500" required value="${esc(item.description||'')}"></label>
  <label class="field"><span>Jenis</span><select data-f="item_kind" required><option value="GOODS" ${item.item_kind!=='SERVICE'?'selected':''}>Barang</option><option value="SERVICE" ${item.item_kind==='SERVICE'?'selected':''}>Jasa</option></select></label>
  <label class="field"><span>Jumlah (boleh desimal, mis. 2,5)</span><input data-f="quantity" inputmode="decimal" required value="${esc(item.quantity||'1')}"></label>
  <label class="field"><span>Satuan</span><input data-f="unit" maxlength="40" required placeholder="pcs, rim, set, m²" value="${esc(item.unit||'')}"></label>
  <label class="field"><span>Perkiraan harga satuan (Rp)</span><input data-f="unit_price" type="number" min="0" step="1" inputmode="numeric" required value="${esc(item.unit_price??'')}"></label>
  <label class="field full"><span>Alasan kebutuhan</span><textarea data-f="reason" maxlength="1000" required>${esc(item.reason||'')}</textarea></label>
  ${keep?`<div class="field full"><span>Lampiran sebelumnya (hapus centang untuk melepas)</span>${keep}</div>`:''}
  <label class="field"><span>Link pembelian (opsional)</span><input data-f="link" type="text" inputmode="url" autocomplete="off" maxlength="1000" placeholder="mis. www.shopee.co.id/nama-produk"></label>
  <label class="field"><span>Detail toko (opsional)</span><input data-f="store_text" maxlength="500" placeholder="Nama toko, alamat, kontak"></label>
  <label class="field full"><span>Foto atau berkas (PDF, PNG, JPEG; opsional)</span><input data-f="file" type="file" accept=".pdf,.png,.jpg,.jpeg"></label>
  </div><div class="pg-item-foot"><span class="muted text-small">Subtotal <strong data-subtotal>Rp0</strong></span><button type="button" class="button text" data-remove-item>${icon('trash')}<span>Hapus item</span></button></div></fieldset>`;
}
function bindItems(form,threshold){
  const recompute=()=>{
    let total=0;form.querySelectorAll('[data-item]').forEach((block,i)=>{
      block.querySelector('[data-item-no]').textContent=i+1;
      const subtotal=Math.round(parseQty(block.querySelector('[data-f=quantity]').value)*Number(block.querySelector('[data-f=unit_price]').value||0));total+=subtotal;
      block.querySelector('[data-subtotal]').textContent=rp(subtotal)+(subtotal>=threshold?' · wajib lampiran':'');
    });
    form.querySelector('[data-total]').textContent=rp(total);
  };
  form.addEventListener('input',recompute);
  form.addEventListener('click',e=>{
    if(e.target.closest('[data-add-item]')){form.querySelector('[data-items]').insertAdjacentHTML('beforeend',itemBlock({},form.querySelectorAll('[data-item]').length));recompute();}
    const remove=e.target.closest('[data-remove-item]');if(remove&&form.querySelectorAll('[data-item]').length>1){remove.closest('[data-item]').remove();recompute();}
  });
  recompute();
}
async function readItems(form){
  const items=[];
  for(const block of form.querySelectorAll('[data-item]')){
    const get=name=>block.querySelector(`[data-f=${name}]`);
    const attachments=[...block.querySelectorAll('[data-keep]:checked')].map(input=>JSON.parse(input.value));
    if(get('link').value.trim())attachments.push({form:'LINK',url:get('link').value.trim()});
    if(get('store_text').value.trim())attachments.push({form:'TEXT',note:get('store_text').value.trim()});
    const file=get('file').files[0];if(file)attachments.push({form:'FILE',file_id:(await uploadFile(file)).id});
    items.push({description:get('description').value,item_kind:get('item_kind').value,quantity:get('quantity').value,unit:get('unit').value,unit_price:Number(get('unit_price').value),reason:get('reason').value,attachments});
  }
  return items;
}
function requestForm(existing=null){
  const o=state.purchasing,threshold=o?.rules?.attachment_min_item_subtotal||1000000;
  const items=existing?existing.items.filter(i=>i.status==='ACTIVE').map(i=>({...i,unit_price:i.unit_price})):[{}];
  const fields=`<label class="field"><span>Tanggal barang dibutuhkan</span><input name="needed_on" type="date" min="${localToday()}" required value="${esc(existing?.needed_on||'')}"></label><div class="field"><span>Total estimasi</span><strong class="pg-total" data-total>Rp0</strong></div>
  <div class="full" data-items>${items.map(itemBlock).join('')}</div><div class="full"><button type="button" class="button outlined" data-add-item>${icon('plus')}<span>Tambah item</span></button></div>`;
  const el=formDialog(existing?`Revisi ${existing.request_code}`:'Buat PR',fields,async(data,form)=>{
    const body={needed_on:data.needed_on,items:await readItems(form)};
    const result=existing?await patch(`purchasing/requests/${existing.id}`,{...body,row_version:existing.row_version}):await post('purchasing/requests',body);
    toast(existing?'Revisi PR terkirim ke atasan.':`PR ${result.request_code} terkirim ke atasan.`);await afterChange(result);
  },{wide:true,submit:existing?'Kirim revisi':'Kirim PR',note:`Data pemohon, jabatan, unit, dan atasan diambil otomatis dari data SDM. Item bersubtotal ${rp(threshold)} atau lebih wajib berlampiran.`});
  bindItems(el.querySelector('form'),threshold);
}

// ---------- Detail PR ----------
export async function openRequest(id){const detail=await api(`purchasing/requests/${id}`);renderRequest(detail);}
async function afterChange(detail){if(detail?.id&&detail.request_code)renderRequest(detail);state.purchasing=null;refresh();}
function renderRequest(d){
  P.detail=d;document.querySelectorAll('dialog[data-pg-detail]').forEach(x=>{x.close();x.remove();});
  const a=d.actions,full=d.view==='full';
  const actionButtons=[
    a.step?stepButtons(d):'',
    a.answer?button('Jawab konfirmasi harga','pg-answer','check','primary'):'',
    a.revise?button('Revisi PR','pg-revise','edit','primary'):'',
    a.completeness?button('Terima & beri nomor','pg-accept','check','primary')+button('Tolak','pg-reject-completeness','close','outlined'):'',
    a.procure?button('Tambah harga','pg-quote','plus','outlined')+button('Buat pesanan','pg-order','building','primary')+button('Minta konfirmasi harga','pg-confirm','incident','outlined'):'',
    a.cancel?button('Batalkan PR','pg-cancel','close','outlined'):'',
    a.reassign?button('Alihkan penyetuju','pg-reassign','people','outlined'):''
  ].join('');
  const closed=d.closed_reason?`<div class="notice ${d.status==='rejected'?'error':'warning'}">${icon('incident')}<div><strong>${esc(d.status_label)}</strong><p>${esc(d.closed_reason)}</p></div></div>`:'';
  const returned=d.status==='returned'?d.steps.filter(s=>s.status==='RETURNED').slice(-1).map(s=>`<div class="notice warning">${icon('incident')}<div><strong>Dikembalikan oleh ${esc(s.actor_name)}</strong><p>${esc(s.reason)}</p></div></div>`).join(''):'';
  const summary=`<div class="detail-grid">${value('Kode pengajuan',d.request_code)}${value('Nomor PR',d.pr_number||'Belum terbit')}${value('Pemohon',`${d.requester_name} · ${d.requester_no}`)}${value('Jabatan / unit',`${d.position_name||'—'} · ${d.unit_name||'—'}`)}${value('Tanggal PR',formatDate(d.request_date))}${value('Dibutuhkan',formatDate(d.needed_on))}${value('Total estimasi',rp(d.estimated_total))}${value('Total disetujui',rp(d.approved_total))}${value('Pos RKA',d.budget_line?`${d.budget_line.code} — ${d.budget_line.name}`:'Diisi Keuangan')}${value('Penyetuju akhir',d.final_approver_kind==='KABAN'?'Kaban':d.final_approver_kind==='SEKBAN'?'Sekban':'Ditentukan saat verifikasi')}${value('Jalur pengadaan',pathLabels[d.procurement_path])}${value('Revisi ke',d.revision_no)}</div>`;
  const items=table(['No','Item','Jumlah','Harga satuan','Subtotal','Lampiran'],d.items.map(i=>`<tr class="${i.status==='CANCELLED'?'pg-cancelled':''}"><td>${i.line_no}</td><td><strong>${esc(i.description)}</strong><small class="muted pg-block">${kindLabels[i.item_kind]} · ${esc(i.reason)}${i.status==='CANCELLED'?' · dibatalkan':''}</small></td><td class="nowrap">${esc(i.quantity)} ${esc(i.unit)}</td><td class="nowrap">${rp(i.approved_unit_price)}${i.approved_unit_price!==i.unit_price?`<small class="muted pg-block">awal ${rp(i.unit_price)}</small>`:''}</td><td class="nowrap">${rp(i.approved_subtotal)}</td><td>${attachmentList(i.attachments)}</td></tr>`));
  const confirmations=d.confirmations.length?card('Konfirmasi ulang harga','Kenaikan harga berapa pun perlu persetujuan pemohon dan verifikasi ulang Keuangan.',table(['Putaran','Item','Harga lama','Harga baru','Alasan','Jawaban'],d.confirmations.map(c=>`<tr><td>${c.round_no}</td><td>${esc(d.items.find(i=>i.id===c.item_id)?.description||'')}</td><td>${rp(c.old_unit_price)}</td><td>${rp(c.new_unit_price)}</td><td>${esc(c.reason)}</td><td>${pill(c.answer,{PENDING:'Menunggu',ACCEPTED:'Disetujui',CANCELLED:'Item dibatalkan'}[c.answer])}</td></tr>`))):'';
  const quotes=full&&d.items.some(i=>i.quotes?.length)?card('Perbandingan harga',`Minimal ${state.purchasing?.rules?.min_quotes_per_item||2} harga dari toko berbeda per item, termasuk toko yang dipilih.`,`<div class="card-body">${d.items.filter(i=>i.quotes?.length).map(i=>`<h3 class="pg-subtitle">${i.line_no}. ${esc(i.description)}</h3>${table(['Toko','Harga satuan','Bukti','Pilihan'],i.quotes.map(q=>`<tr><td>${esc(q.store_name)}${q.vendor_id?'':' <small class="muted">(belum terdaftar)</small>'}</td><td>${rp(q.unit_price)}</td><td>${attachmentList(q.attachments)}</td><td>${q.is_selected?pill('APPROVED','Dipilih')+(q.not_cheapest_reason?`<small class="muted pg-block">${esc(q.not_cheapest_reason)}</small>`:''):a.procure&&!i.ordered?`<button class="button text" data-action="pg-select-quote" data-id="${esc(q.id)}">Pilih</button><button class="icon-button" data-action="pg-delete-quote" data-id="${esc(q.id)}" aria-label="Hapus harga">${icon('trash')}</button>`:''}</td></tr>`))}`).join('')}</div>`):'';
  const orders=full&&d.orders.length?card('Pesanan','Satu pesanan per vendor; jalur B dan C menerbitkan PO atau SPK.',`<div class="card-body pg-orders">${d.orders.map(o=>orderCard(d,o)).join('')}</div>`):(!full&&d.orders.length?card('Pesanan',`${d.orders.length} pesanan`,`<div class="card-body">${d.orders.map(o=>`<p>${pill(o.status,orderLabels[o.status])} ${o.due_on?`tenggat ${formatDate(o.due_on)}`:''} ${o.late?pill('rejected','Terlambat'):''}</p>`).join('')}</div>`):'');
  const documents=d.documents.length?card('Dokumen','Dokumen final dibekukan dengan hash dan kode verifikasi.',table(['Dokumen','Nomor','Terbit','Status',''],[...d.documents].sort((x,y)=>Boolean(x.superseded_at)-Boolean(y.superseded_at)||y.created_at.localeCompare(x.created_at)).map(doc=>`<tr><td>${esc(docLabels[doc.doc_type])}</td><td>${esc(doc.number||d.request_code)}</td><td>${formatDate(doc.created_at)} ${formatTime(doc.created_at)}</td><td>${doc.superseded_at?pill('SUPERSEDED','Digantikan'):pill('APPROVED','Berlaku')}</td><td>${full||doc.doc_type==='PR'?`<button class="button text" data-action="pg-print" data-id="${esc(doc.id)}">${icon('document')}<span>Cetak</span></button>`:''}</td></tr>`))):'';
  const timeline=`<div class="timeline">${d.steps.map(s=>`<div class="timeline-item"><strong>${esc(s.label)}${s.object_type!=='REQUEST'?` · ${s.object_type==='ORDER'?'PO/SPK':'Surat penunjukan'}`:''}</strong> ${pill(s.status,stepLabels[s.status])}<p class="muted text-small">${s.status==='PENDING'?`Menunggu ${esc(s.target_label)} · sejak ${formatDate(s.created_at)}`:`${esc(s.actor_name||s.target_label)}${s.actor_position?` · ${esc(s.actor_position)}`:''}${s.as_delegate?` · Plh untuk ${esc(s.target_label)}`:''} · ${formatDate(s.acted_at)} ${formatTime(s.acted_at)}`}</p>${s.reason?`<p class="text-small">${esc(s.reason)}</p>`:''}${s.reassign_reason?`<p class="text-small muted">Dialihkan: ${esc(s.reassign_reason)}</p>`:''}</div>`).join('')}</div>`;
  const content=`<div class="pg-detail-head">${pill(d.status,d.status_label)}${d.view==='requester'?'<span class="muted text-small">Tampilan pemohon: data vendor dan harga pembanding tidak ditampilkan.</span>':''}</div>${closed}${returned}${actionButtons?`<div class="actions pg-actions">${actionButtons}</div>`:''}<section class="detail-section">${summary}</section>${d.budget_line&&a.verify_budget?`<p class="muted text-small">Pagu ${rp(d.budget_line.ceiling)} · komitmen ${rp(d.budget_line.commitment)} · realisasi ${rp(d.budget_line.realization)} · sisa ${rp(d.budget_line.remaining)}</p>`:''}<section class="detail-section"><h3>Item</h3>${items}</section>${confirmations}${quotes}${orders}${documents}<section class="detail-section"><h3>Riwayat persetujuan</h3>${timeline}</section>`;
  const el=dialog(d.pr_number||d.request_code,content,{wide:true,drawer:true,subtitle:`${d.requester_name} · ${d.unit_name||''}`});el.dataset.detail='true';el.dataset.pgDetail='true';
}
function stepButtons(d){
  const s=d.actions.step,plh=s.as_delegate?' (Plh)':'';
  const canReturn=['ACKNOWLEDGE','VERIFY','FINAL'].includes(s.kind);
  return button(`${s.kind==='VERIFY'?'Verifikasi':'Setujui'}${plh}`,'pg-approve','check','primary')+(canReturn?button('Kembalikan','pg-return','refresh','outlined'):'')+button('Tolak','pg-decline','close','outlined');
}
function orderCard(d,o){
  const proc=d.actions.procure,doc=o.document;
  const lines=table(['Item','Jumlah','Harga satuan','Subtotal','Dibutuhkan'],o.items.map(i=>`<tr><td>${esc(i.description)}</td><td class="nowrap">${(i.quantity_milli/1000).toLocaleString('id-ID')} ${esc(i.unit)}${i.calc_volume_milli?`<small class="muted pg-block">volume hitung ${(i.calc_volume_milli/1000).toLocaleString('id-ID')} ${esc(i.calc_unit)}</small>`:''}</td><td class="nowrap">${rp(i.unit_price)}${i.calc_unit?`/${esc(i.calc_unit)}`:''}${i.purchase_unit_price!==null&&i.purchase_unit_price!==undefined?`<small class="muted pg-block">beli ${rp(i.purchase_unit_price)}</small>`:''}</td><td class="nowrap">${rp(i.subtotal)}</td><td>${formatDate(i.needed_on)}</td></tr>`));
  const buttons=[];
  if(proc&&o.status==='draft'&&o.path!=='A')buttons.push(button('Ubah isi','pg-order-edit','edit','outlined',`data-id="${esc(o.id)}"`),button('Ajukan','pg-order-submit','arrow','primary',`data-id="${esc(o.id)}"`));
  if(proc&&o.status==='ordered')buttons.push(button('Catat pembelian','pg-order-purchase','check','primary',`data-id="${esc(o.id)}"`));
  if(proc&&o.status==='purchased')buttons.push(button('Serah terima','pg-order-receive','check','primary',`data-id="${esc(o.id)}"`));
  if(proc&&o.path!=='A'&&['ordered','purchased','received'].includes(o.status))buttons.push(button('Unggah scan bertanda tangan','pg-order-scan','upload','outlined',`data-id="${esc(o.id)}"`));
  if(proc&&['draft','pending_appointment_approval','pending_order_approval','ordered'].includes(o.status))buttons.push(button('Batalkan pesanan','pg-order-cancel','close','text',`data-id="${esc(o.id)}"`));
  const files=o.attachments?.length?`<p class="text-small">Berkas: ${attachmentList(o.attachments)}</p>`:'';
  const receipt=o.receipt?`<p class="text-small muted">Dibeli ${formatDate(o.receipt.purchased_on)}${o.receipt.received_on?` · diterima ${formatDate(o.receipt.received_on)} · nota ${rp(o.receipt.invoice_total)} · ${esc(o.receipt.condition_note)}`:''}</p>`:'';
  const appointment=o.appointments?.length?`<p class="text-small muted">Surat penunjukan: ${o.appointments.map(x=>`${x.number||'tanpa nomor'} (${({PENDING:'menunggu Kaban',APPROVED:'disetujui',REJECTED:'ditolak'})[x.status]})`).join(', ')}</p>`:'';
  return `<article class="pg-order"><header><div><strong>${esc(o.vendor?.name||o.store_name)}</strong> ${pill(o.status,orderLabels[o.status])}${o.late?' '+pill('rejected','Terlambat'):''}<p class="muted text-small">${pathLabels[o.path]} · ${o.document_kind==='NONE'?'tanpa PO/SPK':esc(doc?.number||`${o.document_kind} belum bernomor`)} · total ${rp(o.total)}${o.due_on?` · tenggat ${formatDate(o.due_on)}`:''}</p></div></header>${lines}${appointment}${receipt}${files}${o.cancelled_reason?`<p class="text-small">Dibatalkan: ${esc(o.cancelled_reason)}</p>`:''}${buttons.length?`<div class="actions">${buttons.join('')}</div>`:''}</article>`;
}

// ---------- Tindakan ----------
const attachmentFields=(prefix='evidence',label='Bukti harga')=>`<label class="field"><span>${esc(label)}: link</span><input name="${prefix}_link" type="text" inputmode="url" autocomplete="off" maxlength="1000" placeholder="mis. www.tokopedia.com/nama-produk"></label><label class="field"><span>${esc(label)}: foto/berkas</span><input name="${prefix}_file" type="file" accept=".pdf,.png,.jpg,.jpeg"></label>`;
async function readAttachments(form,prefix='evidence'){
  const list=[],link=form.querySelector(`[name=${prefix}_link]`)?.value.trim(),file=form.querySelector(`[name=${prefix}_file]`)?.files[0];
  if(link)list.push({form:'LINK',url:link});if(file)list.push({form:'FILE',file_id:(await uploadFile(file)).id});return list;
}
const orderById=id=>P.detail.orders.find(o=>o.id===id);
const stepOrderId=s=>s.object_type==='ORDER'?s.object_id:P.detail.orders.find(o=>o.appointments?.some(x=>x.id===s.object_id))?.id;
async function decideStep(verdict){
  const d=P.detail,s=d.actions.step;
  const reasonRequired=verdict!=='APPROVE';
  let extra='';
  if(verdict==='APPROVE'&&s.kind==='VERIFY'){
    const l=await lookups(true);
    extra=`<label class="field full"><span>Pos RKA</span><select name="budget_line_id" required>${options(l.budget_lines.map(b=>({id:b.id,name:`${b.code} — ${b.name} · sisa ${rp(b.remaining)}`})),'id','name','','Pilih Pos RKA…')}</select></label><label class="check-field full"><input type="checkbox" name="special_budget"><span>Anggaran khusus (selalu disetujui Kaban)</span></label>`;
  }
  const title={APPROVE:s.kind==='VERIFY'?'Verifikasi PR':`Setujui: ${s.label}`,RETURN:'Kembalikan ke pemohon',REJECT:'Tolak'}[verdict];
  formDialog(title,`${extra}<label class="field full"><span>${reasonRequired?'Alasan (wajib, terlihat oleh pemohon)':'Catatan (opsional)'}</span><textarea name="reason" maxlength="2000" ${reasonRequired?'required':''}></textarea></label>`,async b=>{
    const body={step_id:s.id,action:verdict,reason:b.reason||undefined,...(b.budget_line_id?{budget_line_id:b.budget_line_id,special_budget:b.special_budget}:{})};
    const result=s.object_type==='REQUEST'?await post(`purchasing/requests/${d.id}/decide`,{...body,row_version:d.row_version}):await post(`purchasing/orders/${stepOrderId(s)}/decide`,{...body,row_version:orderById(stepOrderId(s)).row_version});
    toast('Keputusan tersimpan.');await afterChange(result);
  },{submit:verdict==='APPROVE'?'Simpan keputusan':verdict==='RETURN'?'Kembalikan':'Tolak',note:s.as_delegate?'Anda bertindak sebagai Plh; nama Anda dan pejabat yang diwakili tercatat di riwayat dan dokumen.':''});
}
async function acceptForm(){
  const d=P.detail,l=await lookups(true);
  formDialog('Terima PR dan beri nomor',`<label class="field full"><span>Nomor PR</span><input name="pr_number" maxlength="80" required value="${esc(d.suggested_pr_number||'')}"></label><label class="field full"><span>PIC pembelian</span><select name="pic_employee_id" required>${options(l.employees.map(e=>({id:e.id,name:`${e.full_name} · ${e.employee_no}`})),'id','name',state.me.user.employee_id||'','Pilih PIC…')}</select></label>`,async b=>{
    const result=await post(`purchasing/requests/${d.id}/completeness`,{action:'ACCEPT',row_version:d.row_version,pr_number:b.pr_number,pic_employee_id:b.pic_employee_id});toast(`Nomor PR ${result.pr_number} terbit.`);await afterChange(result);
  },{submit:'Terima PR',note:'Pastikan semua tahap persetujuan selesai, Pos RKA terisi, dan setiap item cukup jelas untuk dicari. Nomor yang sudah dipakai ditolak.'});
}
async function quoteForm(){
  const d=P.detail,l=await lookups(true),open=d.items.filter(i=>i.status==='ACTIVE'&&!i.ordered);
  formDialog('Tambah harga pembanding',`<label class="field full"><span>Item</span><select name="item_id" required>${options(open.map(i=>({id:i.id,name:`${i.line_no}. ${i.description} (disetujui ${rp(i.approved_unit_price)})`})),'id','name','','Pilih item…')}</select></label><label class="field"><span>Vendor terdaftar</span><select name="vendor_id">${options(l.vendors,'id','name','','Bukan vendor terdaftar')}</select></label><label class="field"><span>Nama toko (bila belum terdaftar)</span><input name="store_name" maxlength="200"></label><label class="field"><span>Harga satuan (Rp)</span><input name="unit_price" type="number" min="0" step="1" required></label>${attachmentFields()}`,async(b,form)=>{
    const result=await post(`purchasing/requests/${d.id}/quotes`,{item_id:b.item_id,vendor_id:b.vendor_id||undefined,store_name:b.store_name||undefined,unit_price:Number(b.unit_price),evidence:await readAttachments(form)});toast('Harga tercatat.');await afterChange(result);
  },{note:'Bukti harga wajib: link, screenshot, atau foto. PO/SPK hanya dapat diterbitkan untuk harga terpilih dari vendor terdaftar.'});
}
async function selectQuote(id){
  const d=P.detail,item=d.items.find(i=>i.quotes?.some(q=>q.id===id)),quote=item.quotes.find(q=>q.id===id),cheapest=Math.min(...item.quotes.map(q=>q.unit_price));
  const send=async reason=>{const result=await post(`purchasing/requests/${d.id}/quotes/${id}/select`,{reason});toast('Harga dipilih.');await afterChange(result);};
  if(quote.unit_price>cheapest)formDialog('Alasan memilih harga bukan termurah',`<label class="field full"><span>Alasan singkat</span><textarea name="reason" required maxlength="1000"></textarea></label>`,async b=>send(b.reason));else await send();
}
async function orderForm(){
  const d=P.detail,l=await lookups(true),open=d.items.filter(i=>i.status==='ACTIVE'&&!i.ordered),paths=d.allowed_paths;
  const itemChecks=open.map(i=>`<label class="check-field"><input type="checkbox" name="item_ids[]" value="${esc(i.id)}" checked><span>${i.line_no}. ${esc(i.description)} · ${esc(i.quantity)} ${esc(i.unit)} · disetujui ${rp(i.approved_unit_price)}</span></label>`).join('');
  const prices=open.map(i=>`<label class="field"><span>Harga satuan item ${i.line_no} (Rp)</span><input name="price_${esc(i.id)}" type="number" min="0" step="1" value="${i.approved_unit_price}"></label>`).join('');
  const fields=`<label class="field full"><span>Jalur</span><select name="path" required data-pg-path>${paths.map(p=>`<option value="${p}">${pathLabels[p]}</option>`).join('')}</select></label><div class="field full"><span>Item</span>${itemChecks}</div>
  <div class="full pg-path" data-for="A C"><div class="form-grid"><label class="field"><span>Vendor</span><select name="vendor_id">${options(l.vendors,'id','name','',paths.includes('A')?'Bukan vendor terdaftar':'Pilih vendor…')}</select></label>${paths.includes('A')?'<label class="field"><span>Nama toko (jalur A tanpa vendor)</span><input name="store_name" maxlength="200"></label>':''}${prices}</div></div>
  <div class="full pg-path" data-for="C"><div class="form-grid"><label class="field full"><span>Alasan tidak ada pembanding</span><textarea name="reason" maxlength="2000"></textarea></label>${attachmentFields('evidence','Bukti harga dari vendor')}<label class="field full"><span>Uraian pekerjaan (SPK)</span><input name="work_description" maxlength="1000"></label><label class="field"><span>Lama pengerjaan (hari, SPK)</span><input name="work_duration_days" type="number" min="1" max="3650"></label></div></div>
  <p class="form-note full pg-path" data-for="B">Jalur B mengelompokkan item per vendor dari harga yang dipilih. Setiap item butuh minimal ${state.purchasing?.rules?.min_quotes_per_item||2} harga dari toko berbeda.</p>`;
  const el=formDialog('Buat pesanan',fields,async(b,form)=>{
    const body={path:b.path,item_ids:b.item_ids};
    if(b.path!=='B'){body.vendor_id=b.vendor_id||undefined;body.store_name=b.store_name||undefined;body.prices=Object.fromEntries(open.filter(i=>b.item_ids.includes(i.id)).map(i=>[i.id,Number(b[`price_${i.id}`])]));}
    if(b.path==='C'){body.reason=b.reason;body.evidence=await readAttachments(form);body.document={work_description:b.work_description||undefined,work_duration_days:b.work_duration_days?Number(b.work_duration_days):undefined};}
    const result=await post(`purchasing/requests/${d.id}/orders`,body);toast(b.path==='C'?'Surat penunjukan diajukan ke Kaban.':'Pesanan dibuat.');await afterChange(result);
  },{wide:true,submit:'Buat pesanan',note:'Harga lebih tinggi dari yang disetujui ditolak; ajukan konfirmasi ulang ke pemohon terlebih dahulu.'});
  const form=el.querySelector('form'),sync=()=>{const path=form.querySelector('[data-pg-path]').value;form.querySelectorAll('.pg-path').forEach(x=>x.hidden=!x.dataset.for.split(' ').includes(path));};
  form.querySelector('[data-pg-path]').addEventListener('change',sync);sync();
}
function confirmForm(){
  const d=P.detail,open=d.items.filter(i=>i.status==='ACTIVE'&&!i.ordered);
  formDialog('Minta konfirmasi harga ke pemohon',open.map(i=>`<label class="field"><span>Harga baru item ${i.line_no} (disetujui ${rp(i.approved_unit_price)})</span><input name="new_${esc(i.id)}" type="number" min="0" step="1"></label><label class="field"><span>Alasan kenaikan item ${i.line_no}</span><input name="why_${esc(i.id)}" maxlength="1000"></label>`).join(''),async b=>{
    const items=open.filter(i=>b[`new_${i.id}`]).map(i=>({item_id:i.id,new_unit_price:Number(b[`new_${i.id}`]),reason:b[`why_${i.id}`]}));
    const result=await post(`purchasing/requests/${d.id}/confirmations`,{row_version:d.row_version,items});toast('Permintaan konfirmasi terkirim ke pemohon.');await afterChange(result);
  },{wide:true,submit:'Kirim ke pemohon',note:'Isi hanya item yang harganya naik. Setelah pemohon setuju, Keuangan memverifikasi ulang; bila total melewati batas Sekban, Kaban menyetujui ulang.'});
}
function answerForm(){
  const d=P.detail,open=d.confirmations.filter(c=>c.answer==='PENDING'&&c.round_no===d.confirmation_round);
  formDialog('Konfirmasi kenaikan harga',open.map(c=>{const item=d.items.find(i=>i.id===c.item_id);return `<fieldset class="pg-item full"><legend>${esc(item?.description||'Item')}</legend><p class="text-small">Harga satuan ${rp(c.old_unit_price)} → <strong>${rp(c.new_unit_price)}</strong> · subtotal ${rp(c.old_subtotal)} → <strong>${rp(c.new_subtotal)}</strong></p><p class="text-small muted">${esc(c.reason)}</p><label class="check-field"><input type="radio" name="answer_${esc(c.item_id)}" value="accept" required><span>Setujui harga baru</span></label><label class="check-field"><input type="radio" name="answer_${esc(c.item_id)}" value="cancel"><span>Batalkan item ini</span></label></fieldset>`;}).join(''),async b=>{
    const result=await post(`purchasing/requests/${d.id}/confirmations/answer`,{row_version:d.row_version,answers:open.map(c=>({item_id:c.item_id,accept:b[`answer_${c.item_id}`]==='accept'}))});toast('Jawaban tersimpan.');await afterChange(result);
  },{wide:true,submit:'Kirim jawaban'});
}
function orderEditForm(id){
  const o=orderById(id),doc=o.document||{};
  formDialog(`Ubah ${o.document_kind}`,`<label class="field"><span>Jenis dokumen</span><select name="doc_kind"><option value="PO" ${doc.doc_kind==='PO'?'selected':''}>PO (barang)</option><option value="SPK" ${doc.doc_kind==='SPK'?'selected':''}>SPK (jasa/campuran)</option></select></label><label class="field"><span>Lama pengerjaan (hari, SPK)</span><input name="work_duration_days" type="number" min="1" max="3650" value="${esc(doc.work_duration_days||'')}"></label><label class="field full"><span>Uraian pekerjaan (SPK)</span><input name="work_description" maxlength="1000" value="${esc(doc.work_description||'')}"></label><label class="field full"><span>Termin pembayaran</span><input name="payment_terms" maxlength="500" value="${esc(doc.payment_terms||'')}"></label><label class="field full"><span>Ketentuan penagihan</span><textarea name="billing_text" maxlength="3000">${esc(doc.billing_text||'')}</textarea></label>
  ${o.items.map(i=>`<fieldset class="pg-item full"><legend>${esc(i.description)}</legend><div class="form-grid"><label class="field"><span>Tanggal dibutuhkan</span><input type="date" name="needed_${esc(i.id)}" value="${esc(i.needed_on)}"></label><label class="field"><span>Volume hitung (opsional, mis. 4,4)</span><input name="volume_${esc(i.id)}" inputmode="decimal" value="${i.calc_volume_milli?String(i.calc_volume_milli/1000).replace('.',','):''}"></label><label class="field"><span>Satuan volume (mis. m²)</span><input name="calcunit_${esc(i.id)}" maxlength="20" value="${esc(i.calc_unit||'')}"></label></div></fieldset>`).join('')}`,async b=>{
    const result=await patch(`purchasing/orders/${id}`,{row_version:o.row_version,document:{doc_kind:b.doc_kind,work_description:b.work_description,work_duration_days:b.work_duration_days?Number(b.work_duration_days):null,payment_terms:b.payment_terms,billing_text:b.billing_text},items:o.items.map(i=>({id:i.id,needed_on:b[`needed_${i.id}`],calc_volume:b[`volume_${i.id}`]||null,calc_unit:b[`calcunit_${i.id}`]||null}))});
    toast('Isi pesanan disimpan.');await afterChange(result);
  },{wide:true,note:'Bila volume hitung diisi, subtotal = volume hitung × harga satuan dan tidak boleh melebihi subtotal yang disetujui.'});
}
function orderSubmitForm(id){
  const o=orderById(id);
  if(o.path==='C')return formDialog('Ajukan ulang surat penunjukan',`<label class="field full"><span>Alasan tidak ada pembanding</span><textarea name="reason" required maxlength="2000"></textarea></label>${attachmentFields('evidence','Bukti harga dari vendor')}`,async(b,form)=>{const result=await post(`purchasing/orders/${id}/submit`,{row_version:o.row_version,reason:b.reason,evidence:await readAttachments(form)});toast('Diajukan ke Kaban.');await afterChange(result);});
  return formDialog(`Ajukan ${o.document_kind}`,`<p class="detail-prose full">${esc(o.document_kind)} untuk ${esc(o.vendor?.name||o.store_name)} senilai ${rp(o.total)} akan diajukan ke penyetuju akhir PR (${P.detail.final_approver_kind==='KABAN'?'Kaban':'Sekban'}). Nomor terbit otomatis saat disetujui.</p>`,async()=>{const result=await post(`purchasing/orders/${id}/submit`,{row_version:o.row_version});toast('Pesanan diajukan.');await afterChange(result);},{submit:'Ajukan'});
}
function purchaseForm(id){
  const o=orderById(id);
  formDialog('Catat pembelian',`<label class="field"><span>Tanggal beli</span><input name="purchased_on" type="date" max="${localToday()}" value="${localToday()}" required></label>${o.items.map(i=>`<label class="field"><span>Harga beli satuan: ${esc(i.description)}</span><input name="buy_${esc(i.id)}" type="number" min="0" step="1" value="${i.unit_price}"></label>`).join('')}`,async b=>{
    const result=await post(`purchasing/orders/${id}/purchase`,{row_version:o.row_version,purchased_on:b.purchased_on,items:o.items.map(i=>({id:i.id,unit_price:Number(b[`buy_${i.id}`])}))});toast('Pembelian tercatat.');await afterChange(result);
  },{note:'Harga beli tidak boleh melebihi harga pesanan. Bila naik, batalkan dulu dan minta konfirmasi ulang ke pemohon.'});
}
function receiveForm(id){
  const o=orderById(id);
  formDialog('Serah terima',`<label class="field"><span>Tanggal diterima</span><input name="received_on" type="date" max="${localToday()}" value="${localToday()}" required></label><label class="field"><span>Total nota vendor (Rp)</span><input name="invoice_total" type="number" min="0" step="1" required></label><label class="field full"><span>Nota, kwitansi, atau invoice vendor</span><input name="invoice_file" type="file" accept=".pdf,.png,.jpg,.jpeg" required></label>${o.items.map(i=>`<label class="field"><span>Jumlah diterima: ${esc(i.description)}</span><input name="qty_${esc(i.id)}" inputmode="decimal" value="${String(i.quantity_milli/1000).replace('.',',')}"></label>`).join('')}<label class="field full"><span>Kondisi barang atau hasil pekerjaan</span><textarea name="condition_note" required maxlength="2000"></textarea></label>`,async(b,form)=>{
    const file=form.querySelector('[name=invoice_file]').files[0];const invoice=[{form:'FILE',file_id:(await uploadFile(file)).id}];
    const result=await post(`purchasing/orders/${id}/receive`,{row_version:o.row_version,received_on:b.received_on,invoice_total:Number(b.invoice_total),condition_note:b.condition_note,invoice,items:o.items.map(i=>({id:i.id,received_quantity:b[`qty_${i.id}`]}))});
    toast(result.status==='completed'?'Serah terima tercatat. PR selesai.':'Serah terima tercatat.');await afterChange(result);
  },{wide:true});
}
function scanForm(id){formDialog('Unggah scan bertanda tangan',`<label class="field full"><span>Scan PO/SPK yang sudah ditandatangani vendor</span><input name="scan_file" type="file" accept=".pdf,.png,.jpg,.jpeg" required></label>`,async(b,form)=>{const file=form.querySelector('[name=scan_file]').files[0];const result=await post(`purchasing/orders/${id}/attachments`,{attachments:[{form:'FILE',file_id:(await uploadFile(file)).id}]});toast('Scan tersimpan.');await afterChange(result);});}
function reasonForm(title,path,extra={},label='Alasan',submit='Simpan'){formDialog(title,`<label class="field full"><span>${esc(label)}</span><textarea name="reason" required maxlength="1000"></textarea></label>`,async b=>{const result=await post(path,{...extra,reason:b.reason});toast('Tersimpan.');await afterChange(result);},{submit});}
async function reassignForm(){
  const d=P.detail,l=await lookups(true),pending=d.steps.filter(s=>s.status==='PENDING'&&s.target_kind==='EMPLOYEE');
  formDialog('Alihkan penyetuju',`<label class="field full"><span>Tahap</span><select name="step_id" required>${options(pending.map(s=>({id:s.id,name:`${s.label} · ${s.target_label}`})),'id','name','','Pilih tahap…')}</select></label><label class="field full"><span>Penyetuju baru</span><select name="employee_id" required>${options(l.employees.map(e=>({id:e.id,name:`${e.full_name} · ${e.employee_no}`})),'id','name','','Pilih pegawai…')}</select></label><label class="field full"><span>Alasan pengalihan</span><textarea name="reason" required maxlength="1000"></textarea></label>`,async b=>{const result=await post(`purchasing/steps/${b.step_id}/reassign`,{employee_id:b.employee_id,reason:b.reason});toast('Penyetuju dialihkan.');await afterChange(result);},{note:'Gunakan bila penyetuju berhalangan lama dan tidak ada Plh. Pengalihan tercatat di riwayat dan audit.'});
}

// ---------- Vendor, Pos RKA, laporan, pengaturan ----------
function vendorsPage(){
  const manage=state.purchasing?.capabilities?.vendors_manage,rows=P.vendors.items.map(v=>`<tr><td><strong>${esc(v.name)}</strong><small class="muted pg-block">${esc(v.address||'')}</small></td><td>${esc(v.leader_name||'—')}<small class="muted pg-block">${esc(v.leader_title||'')}${v.leader_nik?` · NIK ${esc(v.leader_nik)}`:''}</small></td><td>${esc(v.phone||'—')}<small class="muted pg-block">${esc(v.contact_name||'')}</small></td><td>${esc(v.bank_name||'—')}<small class="muted pg-block">${esc(v.account_no||'')} ${esc(v.account_name||'')}</small></td><td>${pill(v.is_active?'APPROVED':'SUPERSEDED',v.is_active?'Aktif':'Nonaktif')}</td><td>${manage?`<button class="icon-button" data-action="pg-vendor" data-id="${esc(v.id)}" aria-label="Ubah vendor">${icon('edit')}</button>`:''}</td></tr>`);
  return `${heading('Daftar Vendor','Data vendor dipakai untuk PO, SPK, dan surat penunjukan.',manage?button('Tambah vendor','pg-vendor','plus'):'')}${P.vendors.sensitive?'':`<div class="notice">${icon('lock')}<div><strong>NIK dan rekening disamarkan</strong><p>Hanya Purchasing, Keuangan, dan Pengelola Pengadaan yang melihat data lengkap.</p></div></div>`}<section class="card">${table(['Vendor','Pimpinan','Kontak','Rekening','Status',''],rows,'Belum ada vendor')}</section>`;
}
function vendorForm(id){
  const v=id?P.vendors.items.find(x=>x.id===id):{is_active:1},sensitive=P.vendors.sensitive;
  const input=(name,label,max=200,extra='')=>`<label class="field"><span>${esc(label)}</span><input name="${name}" maxlength="${max}" value="${esc(v[name]||'')}" ${extra}></label>`;
  formDialog(id?'Ubah vendor':'Tambah vendor',`${input('name','Nama vendor',200,'required')}${input('address','Alamat',500)}${input('phone','Telepon',40)}${input('contact_name','Nama kontak')}${input('leader_name','Nama pimpinan')}${input('leader_title','Jabatan pimpinan',120)}${sensitive?input('leader_nik','NIK pimpinan (dicetak di SPK)',16,'inputmode="numeric" pattern="[0-9]{16}"'):''}${input('bank_name','Bank',120)}${input('bank_branch','Cabang',120)}${sensitive?input('account_no','Nomor rekening',40):''}${input('account_name','Atas nama rekening')}<label class="field full"><span>Catatan</span><textarea name="notes" maxlength="1000">${esc(v.notes||'')}</textarea></label>${id?`<label class="check-field"><input type="checkbox" name="is_active" ${v.is_active?'checked':''}><span>Aktif</span></label>`:''}`,async b=>{
    if(id)await patch(`purchasing/vendors/${id}`,{...b,row_version:v.row_version});else await post('purchasing/vendors',b);P.lookups=null;toast('Vendor tersimpan.');refresh();
  },{wide:true});
}
function budgetPage(){
  const manage=state.purchasing?.capabilities?.budget_manage,b=P.budget;
  const rows=b.items.map(l=>`<tr><td><strong>${esc(l.code)}</strong></td><td>${esc(l.name)}<small class="muted pg-block">${esc(l.unit_name||'Semua unit')}</small></td><td class="nowrap">${rp(l.ceiling)}</td><td class="nowrap">${rp(l.commitment)}</td><td class="nowrap">${rp(l.realization)}</td><td class="nowrap"><strong>${rp(l.remaining)}</strong></td><td>${pill(l.is_active?'APPROVED':'SUPERSEDED',l.is_active?'Aktif':'Nonaktif')}</td><td>${manage?`<button class="icon-button" data-action="pg-budget-line" data-id="${esc(l.id)}" aria-label="Ubah Pos RKA">${icon('edit')}</button>`:''}</td></tr>`);
  const years=b.years.length?`<label class="field"><span>Tahun anggaran</span><select data-pg-filter="year">${b.years.map(y=>`<option value="${y.year}" ${y.year===b.year?'selected':''}>${y.year}</option>`).join('')}</select></label>`:'';
  return `${heading('Pos RKA','Sisa pagu = pagu − komitmen − realisasi. Komitmen = PR disetujui yang belum diterima; realisasi = nilai nota vendor.',manage?button('Tambah tahun','pg-budget-year','calendar','outlined')+(b.years.some(y=>y.year===b.year)?button('Tambah Pos RKA','pg-budget-line','plus'):''):'')}<div class="toolbar">${years}</div><section class="card">${table(['Kode','Pos','Pagu','Komitmen','Realisasi','Sisa','Status',''],rows,`Belum ada Pos RKA untuk ${b.year}`)}</section>`;
}
async function budgetLineForm(id){
  const l=await lookups(true),line=id?P.budget.items.find(x=>x.id===id):null,year=P.budget.years.find(y=>y.year===P.budget.year);
  formDialog(id?`Ubah ${line.code}`:'Tambah Pos RKA',`${id?'':'<label class="field"><span>Kode (mis. BHP)</span><input name="code" maxlength="20" required></label>'}<label class="field"><span>Nama Pos</span><input name="name" maxlength="200" required value="${esc(line?.name||'')}"></label><label class="field"><span>Unit (opsional)</span><select name="org_unit_id">${options(l.units,'id','name',line?.org_unit_id||'','Semua unit')}</select></label><label class="field"><span>Pagu ${P.budget.year} (Rp)</span><input name="ceiling" type="number" min="0" step="1" required value="${esc(line?.ceiling??'')}"></label>${id?`<label class="check-field"><input type="checkbox" name="is_active" ${line.is_active?'checked':''}><span>Aktif</span></label>`:''}`,async b=>{
    if(id)await patch(`purchasing/budget/lines/${id}`,{row_version:line.row_version,name:b.name,org_unit_id:b.org_unit_id||null,ceiling:Number(b.ceiling),is_active:b.is_active});
    else await post('purchasing/budget/lines',{budget_year_id:year.id,code:b.code,name:b.name,org_unit_id:b.org_unit_id||undefined,ceiling:Number(b.ceiling)});
    P.lookups=null;toast('Pos RKA tersimpan.');refresh();
  });
}
function reportsPage(){
  const r=P.report,caps=state.purchasing?.capabilities||{};
  const statuses=table(['Status','Jumlah PR'],r.by_status.map(s=>`<tr><td>${pill(s.status,s.label)}</td><td>${number(s.count)}</td></tr>`),'Belum ada PR tahun ini');
  const budget=r.budget.length?table(['Pos','Pagu','Komitmen','Realisasi','Sisa'],r.budget.map(l=>`<tr><td>${esc(l.code)} — ${esc(l.name)}</td><td>${rp(l.ceiling)}</td><td>${rp(l.commitment)}</td><td>${rp(l.realization)}</td><td>${rp(l.remaining)}</td></tr>`)):'';
  return `${heading(`Laporan Pengadaan ${r.year}`,'Ringkasan PR dalam cakupan akses Anda.',caps.export?button('Ekspor CSV','pg-export','download','outlined'):'')}<div class="stats-grid"><div class="stat-card"><div class="stat-top"><span>Total PR</span></div><div class="stat-value">${number(r.total_requests)}</div></div><div class="stat-card"><div class="stat-top"><span>Nilai disetujui</span></div><div class="stat-value pg-money">${rp(r.approved_value)}</div></div><div class="stat-card"><div class="stat-top"><span>Realisasi (nota)</span></div><div class="stat-value pg-money">${rp(r.realized_value)}</div></div><div class="stat-card"><div class="stat-top"><span>Pesanan terlambat</span></div><div class="stat-value">${number(r.late_orders)}</div></div></div><div class="grid-two">${card('PR per status','',statuses)}${budget?card('Pos RKA','',budget):''}</div>`;
}
function settingsPage(){
  const s=P.settings.settings,l=P.lookups,holders=P.settings.officials;
  const holder=list=>list.length===1?`Pemegang: ${list[0].full_name}`:list.length?`${list.length} pemegang aktif — harus tepat satu`:'Belum ada pemegang aktif';
  const delegations=table(['Pejabat','Plh','Periode','Dasar','Status',''],P.delegations.map(x=>`<tr><td>${esc(x.from_name)}</td><td>${esc(x.to_name)}</td><td class="nowrap">${formatDate(x.starts_on)} – ${formatDate(x.ends_on)}</td><td>${esc(x.reason)}</td><td>${x.revoked_at?pill('SUPERSEDED','Dicabut'):x.ends_on<localToday()?pill('SUPERSEDED','Berakhir'):pill('APPROVED','Berlaku')}</td><td>${x.revoked_at?'':`<button class="button text" data-action="pg-revoke" data-id="${esc(x.id)}" data-version="${x.row_version}">Cabut</button>`}</td></tr>`),'Belum ada Plh');
  const units=l.units.map(u=>`<label class="field"><span>Kode PR ${esc(u.name)}</span><input name="unit_${esc(u.id)}" maxlength="20" placeholder="${esc(u.code)}" value="${esc(s.unit_codes[u.id]||'')}"></label>`).join('');
  return `${heading('Pengaturan Pengadaan','Batas, pejabat, penomoran, kop dokumen, dan Plh. Setiap perubahan tercatat di audit.',button('Ubah pengaturan','pg-settings','edit')+button('Tambah Plh','pg-delegation','people','outlined'))}
  <div class="grid-two">${card('Batas dan pejabat','',`<div class="card-body detail-grid">${value('Batas Sekban',rp(s.sekban_max_total))}${value('Lampiran wajib mulai',rp(s.attachment_min_item_subtotal))}${value('Perbandingan harga mulai',rp(s.comparison_min_total))}${value('Harga pembanding minimal',s.min_quotes_per_item)}${value('Posisi Sekban',l.positions.find(p=>p.id===s.officials.sekban_position_id)?.name||'Belum dipilih')}${value('Sekban',holder(holders.sekban))}${value('Posisi Kaban',l.positions.find(p=>p.id===s.officials.kaban_position_id)?.name||'Belum dipilih')}${value('Kaban',holder(holders.kaban))}</div>`)}${card('Kop dan penomoran','',`<div class="card-body detail-grid">${value('Nama badan',s.organization.name)}${value('Alamat',s.organization.address)}${value('Kota',s.organization.city)}${value('Termin',s.texts.payment_terms)}${value('Nomor terakhir manual',s.number_floor.year?`${s.number_floor.year}: PO ${s.number_floor.PO}, SPK ${s.number_floor.SPK}, penunjukan ${s.number_floor.SPV}`:'Tidak ada')}</div>`)}</div>
  ${card('Pelaksana harian (Plh)','Plh dapat bertindak atas nama pejabat selama periode berlaku; namanya tercatat di riwayat dan dokumen.',delegations)}<template id="pg-unit-fields">${units}</template>`;
}
function settingsForm(){
  const s=P.settings.settings,l=P.lookups,positions=l.positions.map(p=>({id:p.id,name:`${p.name} · ${p.unit_name}`}));
  const units=document.querySelector('#pg-unit-fields')?.innerHTML||'';
  formDialog('Ubah pengaturan pengadaan',`<label class="field"><span>Batas Sekban (Rp)</span><input name="sekban_max_total" type="number" min="0" required value="${s.sekban_max_total}"></label><label class="field"><span>Lampiran wajib mulai (Rp)</span><input name="attachment_min_item_subtotal" type="number" min="0" required value="${s.attachment_min_item_subtotal}"></label><label class="field"><span>Perbandingan harga mulai (Rp)</span><input name="comparison_min_total" type="number" min="0" required value="${s.comparison_min_total}"></label><label class="field"><span>Harga pembanding minimal</span><input name="min_quotes_per_item" type="number" min="2" max="5" required value="${s.min_quotes_per_item}"></label>
  <label class="field"><span>Posisi Sekban</span><select name="sekban_position_id">${options(positions,'id','name',s.officials.sekban_position_id||'','Pilih posisi…')}</select></label><label class="field"><span>Posisi Kaban</span><select name="kaban_position_id">${options(positions,'id','name',s.officials.kaban_position_id||'','Pilih posisi…')}</select></label>
  <label class="field full"><span>Nama badan (kop)</span><input name="org_name" maxlength="300" required value="${esc(s.organization.name)}"></label><label class="field"><span>Nama singkat</span><input name="org_short" maxlength="100" value="${esc(s.organization.short_name)}"></label><label class="field"><span>Kota</span><input name="org_city" maxlength="100" value="${esc(s.organization.city)}"></label><label class="field full"><span>Alamat (kop)</span><input name="org_address" maxlength="500" value="${esc(s.organization.address)}"></label>
  <label class="field full"><span>Termin pembayaran</span><input name="payment_terms" maxlength="500" required value="${esc(s.texts.payment_terms)}"></label><label class="field full"><span>Ketentuan penagihan</span><textarea name="billing_text" maxlength="3000" required>${esc(s.texts.billing_text)}</textarea></label>
  <label class="field"><span>Tahun nomor manual terakhir</span><input name="floor_year" type="number" min="2000" max="2100" value="${esc(s.number_floor.year||'')}"></label><label class="field"><span>Nomor PO terakhir</span><input name="floor_PO" type="number" min="0" value="${s.number_floor.PO}"></label><label class="field"><span>Nomor SPK terakhir</span><input name="floor_SPK" type="number" min="0" value="${s.number_floor.SPK}"></label><label class="field"><span>Nomor surat penunjukan terakhir</span><input name="floor_SPV" type="number" min="0" value="${s.number_floor.SPV}"></label>
  ${units}<label class="field full"><span>Dasar perubahan</span><textarea name="reason" required maxlength="1000"></textarea></label>`,async b=>{
    const unit_codes=Object.fromEntries(Object.entries(b).filter(([k,v])=>k.startsWith('unit_')&&v).map(([k,v])=>[k.slice(5),v]));
    await patch('purchasing/settings',{reason:b.reason,settings:{sekban_max_total:Number(b.sekban_max_total),attachment_min_item_subtotal:Number(b.attachment_min_item_subtotal),comparison_min_total:Number(b.comparison_min_total),min_quotes_per_item:Number(b.min_quotes_per_item),officials:{sekban_position_id:b.sekban_position_id||null,kaban_position_id:b.kaban_position_id||null},organization:{name:b.org_name,short_name:b.org_short,address:b.org_address,city:b.org_city},texts:{payment_terms:b.payment_terms,billing_text:b.billing_text},number_floor:{year:b.floor_year?Number(b.floor_year):null,PO:Number(b.floor_PO||0),SPK:Number(b.floor_SPK||0),SPV:Number(b.floor_SPV||0)},unit_codes}});
    state.purchasing=null;toast('Pengaturan tersimpan.');refresh();
  },{wide:true,note:'Kode unit dipakai di nomor PR (nnn/PR/<kode>/<bulan romawi>/<tahun>). Kosongkan untuk memakai kode unit organisasi. Nomor manual terakhir membuat urutan PO/SPK/surat penunjukan berlanjut setelah nomor tersebut.'});
}
function delegationForm(){
  const l=P.lookups,people=l.employees.map(e=>({id:e.id,name:`${e.full_name} · ${e.employee_no}`}));
  formDialog('Tambah Plh',`<label class="field full"><span>Pejabat yang diwakili</span><select name="from_employee_id" required>${options(people,'id','name','','Pilih pejabat…')}</select></label><label class="field full"><span>Plh</span><select name="to_employee_id" required>${options(people,'id','name','','Pilih pegawai…')}</select></label><label class="field"><span>Mulai</span><input name="starts_on" type="date" required value="${localToday()}"></label><label class="field"><span>Selesai</span><input name="ends_on" type="date" required></label><label class="field full"><span>Dasar penunjukan (mis. nomor SK)</span><textarea name="reason" required maxlength="1000"></textarea></label>`,async b=>{await post('purchasing/delegations',b);toast('Plh tersimpan.');refresh();});
}
async function verifyPage(code){
  if(!code)return `${heading('Verifikasi Dokumen','Pindai QR pada dokumen cetak untuk memeriksa keasliannya.')}${empty('Kode verifikasi tidak ada','Buka tautan dari QR dokumen.','lock')}`;
  let r;try{r=await api(`purchasing/verify/${encodeURIComponent(code)}`);}catch(e){return `${heading('Verifikasi Dokumen','Hasil pemeriksaan kode QR.')}<div class="notice error">${icon('incident')}<div><strong>Dokumen tidak ditemukan</strong><p>${esc(e.message)}</p></div></div>`;}
  const ok=r.hash_valid&&!r.superseded_at;
  return `${heading('Verifikasi Dokumen','Hasil pemeriksaan kode QR.')}<div class="notice ${ok?'':'warning'}">${icon(ok?'check':'incident')}<div><strong>${ok?'Dokumen asli dan berlaku':r.superseded_at?'Dokumen sudah digantikan versi yang lebih baru':'Isi dokumen tidak cocok dengan hash'}</strong><p>${esc(docLabels[r.doc_type])} ${esc(r.number||r.request_code)} · terbit ${formatDate(r.issued_at)} ${formatTime(r.issued_at)}</p></div></div>${card('Rincian','',`<div class="card-body detail-grid">${value('Jenis',docLabels[r.doc_type])}${value('Nomor',r.number||'—')}${value('Kode pengajuan',r.request_code)}${value('Tanggal',formatDate(r.date))}${value('Total',rp(r.total))}${value('Hash',r.snapshot_hash.slice(0,16)+'…')}</div>${table(['Tahap','Nama','Jabatan','Waktu'],(r.approvals||[]).map(a=>`<tr><td>${esc(a.stage||'Disetujui')}</td><td>${esc(a.name||'—')}${a.plh?' (Plh)':''}</td><td>${esc(a.position||'—')}</td><td>${a.at?`${formatDate(a.at)} ${formatTime(a.at)}`:'—'}</td></tr>`))}`)}`;
}

// ---------- Cetak ----------
function verifyUrl(code){return `${location.origin}${location.pathname}#pr-verify?code=${code}`;}
function qr(code){try{return `<div class="pg-qr">${encodeQR(verifyUrl(code),'svg',{ecc:'medium'})}</div>`;}catch{return '';}}
function kop(org){return `<header class="pg-kop"><img src="/assets/mark.svg" alt="" width="56" height="56"><div><strong>${esc(org.name)}</strong>${org.address?`<span>${esc(org.address)}</span>`:''}</div></header>`;}
function sheet(doc){
  const s=doc.snapshot,org=s.organization,stamp=`<div class="pg-stamp">${qr(doc.verification_code)}<p>Kode verifikasi <strong>${esc(doc.verification_code)}</strong><br>Hash ${esc(doc.snapshot_hash.slice(0,16))}…<br>${doc.superseded_at?'<strong>DIGANTIKAN — tidak berlaku</strong>':'Ditandatangani elektronik'}</p></div>`;
  const itemsTable=(rows,withReason=false)=>`<table class="pg-print-table"><thead><tr><th>No</th><th>Uraian</th><th>Jumlah</th><th>Harga satuan</th><th>Subtotal</th>${withReason?'<th>Alasan</th>':''}</tr></thead><tbody>${rows.map((i,n)=>`<tr><td>${n+1}</td><td>${esc(i.description)}</td><td>${esc(i.quantity)} ${esc(i.unit)}${i.calc_volume?`<br><small>vol. ${esc(i.calc_volume)} ${esc(i.calc_unit)}</small>`:''}</td><td>${rp(i.unit_price)}${i.calc_unit?`/${esc(i.calc_unit)}`:''}</td><td>${rp(i.subtotal)}</td>${withReason?`<td>${esc(i.reason)}</td>`:''}</tr>`).join('')}</tbody><tfoot><tr><td colspan="4">Total</td><td>${rp(s.total)}</td>${withReason?'<td></td>':''}</tr></tfoot></table><p class="pg-terbilang">Terbilang: <em>${esc(s.total_words)}</em></p>`;
  if(doc.doc_type==='PR')return `${kop(org)}<h1 class="pg-print-title">Permohonan Pemesanan Barang (PR)</h1><table class="pg-print-meta"><tr><td>Nomor PR</td><td>${esc(s.pr_number||'Belum terbit')}</td><td>Kode pengajuan</td><td>${esc(s.request_code)}</td></tr><tr><td>Pemohon</td><td>${esc(s.requester.name)} (${esc(s.requester.employee_no)})</td><td>Tanggal</td><td>${formatDate(s.request_date)}</td></tr><tr><td>Jabatan / unit</td><td>${esc(s.requester.position||'—')} · ${esc(s.requester.unit||'—')}</td><td>Dibutuhkan</td><td>${formatDate(s.needed_on)}</td></tr><tr><td>Pos RKA</td><td>${esc(s.budget_line||'—')}${s.special_budget?' (anggaran khusus)':''}</td><td>Penyetuju akhir</td><td>${s.final_approver==='KABAN'?'Kaban':'Sekban'}</td></tr></table>${itemsTable(s.items,true)}<h2 class="pg-print-sub">Persetujuan elektronik</h2><table class="pg-print-table"><thead><tr><th>Tahap</th><th>Nama</th><th>Jabatan</th><th>Waktu</th></tr></thead><tbody>${s.approvals.map(a=>`<tr><td>${esc(a.stage)}</td><td>${a.status==='SKIPPED'?'—':esc(a.name)}${a.plh?` (Plh, atas nama ${esc(a.on_behalf)})`:''}</td><td>${a.status==='SKIPPED'?esc(a.note||'Dilewati'):esc(a.position||'—')}</td><td>${a.at?`${formatDate(a.at)} ${formatTime(a.at)} WITA`:'—'}</td></tr>`).join('')}</tbody></table>${stamp}`;
  const vendor=s.vendor||{};
  if(doc.doc_type==='SPV')return `${kop(org)}<h1 class="pg-print-title">Surat Penunjukan Vendor</h1><p class="pg-center">Nomor: ${esc(s.number)}</p><p>Berdasarkan PR ${esc(s.pr_number||s.request_code)}, Badan Pengelola menunjuk <strong>${esc(vendor.name)}</strong>${vendor.address?`, ${esc(vendor.address)}`:''}, untuk menyediakan barang/jasa berikut tanpa pembanding harga dengan alasan: ${esc(s.reason)}.</p>${itemsTable(s.items)}<div class="pg-sign-row"><div class="pg-sign"><p>${esc(org.city||'')}, ${formatDate(s.date,{day:'numeric',month:'long',year:'numeric'})}</p><p>${esc(s.signer.position||'Kaban')}</p>${stamp}<p><strong>${esc(s.signer.name||'')}</strong>${s.signer.plh?`<br><small>Plh: ${esc(s.signer.plh)}</small>`:''}</p></div></div>`;
  const spk=doc.doc_type==='SPK';
  return `${kop(org)}<h1 class="pg-print-title">${spk?'Surat Perintah Kerja (SPK)':'Purchase Order (PO)'}</h1><p class="pg-center">Nomor: ${esc(s.number)}</p><table class="pg-print-meta"><tr><td>Kepada</td><td><strong>${esc(vendor.name||'')}</strong><br>${esc(vendor.address||'')}${vendor.phone?`<br>Telp. ${esc(vendor.phone)}`:''}</td><td>Tanggal</td><td>${formatDate(s.date,{day:'numeric',month:'long',year:'numeric'})}</td></tr><tr><td>${spk?'Pimpinan':'Kontak'}</td><td>${esc((spk?vendor.leader_name:vendor.contact)||'—')}${spk&&vendor.leader_title?`, ${esc(vendor.leader_title)}`:''}${spk&&vendor.leader_nik?`<br>NIK ${esc(vendor.leader_nik)}`:''}</td><td>Referensi PR</td><td>${esc(s.pr_number||s.request_code)}</td></tr>${spk?`<tr><td>Pekerjaan</td><td>${esc(s.work_description||'—')}</td><td>Lama pengerjaan</td><td>${s.work_duration_days?`${s.work_duration_days} hari`:'—'}</td></tr>`:''}</table>${itemsTable(s.items)}<table class="pg-print-meta"><tr><td>Pembayaran</td><td>${esc(s.payment_terms)}${vendor.bank?`<br>Transfer ke ${esc(vendor.bank)}${vendor.branch?` ${esc(vendor.branch)}`:''} ${esc(vendor.account_no||'')} a.n. ${esc(vendor.account_name||'')}`:''}</td></tr><tr><td>Penagihan</td><td class="pg-pre">${esc(s.billing_text)}</td></tr></table><div class="pg-sign-row"><div class="pg-sign"><p>Vendor,</p><div class="pg-sign-space"></div><p><strong>${esc((spk?vendor.leader_name:vendor.contact)||vendor.name||'')}</strong></p></div><div class="pg-sign"><p>${esc(org.city||'')}, ${formatDate(s.date,{day:'numeric',month:'long',year:'numeric'})}<br>${esc(s.signer.position||'')}</p>${stamp}<p><strong>${esc(s.signer.name||'')}</strong><br><small>Disetujui ${formatDate(s.signer.approved_at)} ${formatTime(s.signer.approved_at)} WITA</small></p></div></div>`;
}
async function printDocument(id){
  const doc=await api(`purchasing/documents/${id}`),html=sheet(doc);
  const el=dialog(`${docLabels[doc.doc_type]} ${doc.number||''}`,`<div class="actions no-print">${button('Cetak / simpan PDF','pg-print-now','download')}</div>${doc.superseded_at?`<div class="notice warning">${icon('incident')}<div><strong>Versi ini sudah digantikan</strong><p>Gunakan versi terbaru untuk keperluan resmi.</p></div></div>`:''}<article class="pg-sheet">${html}</article>`,{wide:true});
  el.dataset.pgPrint='true';
}
function printNow(){
  const sheetEl=document.querySelector('dialog[data-pg-print] .pg-sheet');if(!sheetEl)return;
  let root=document.querySelector('#pg-print-root');if(!root){root=document.createElement('div');root.id='pg-print-root';document.body.append(root);}
  root.innerHTML=sheetEl.outerHTML;document.body.classList.add('pg-printing');
  const done=()=>{document.body.classList.remove('pg-printing');root.innerHTML='';window.removeEventListener('afterprint',done);};
  window.addEventListener('afterprint',done);window.print();setTimeout(done,60000);
}
async function exportCsv(){const year=P.year||localToday().slice(0,4),data=await api(`purchasing/export?year=${year}`),blob=new Blob(['﻿',data.csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=data.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export function bindPurchasingPage(){
  document.querySelectorAll('[data-pg-filter]').forEach(select=>select.addEventListener('change',e=>{if(e.target.dataset.pgFilter==='status')P.status=e.target.value;else P.year=Number(e.target.value);refresh();}));
}
export async function handlePurchasingAction(action,el){
  if(!action.startsWith('pg-'))return false;
  const d=P.detail,id=el.dataset.id;
  const actions={
    'pg-new-request':()=>requestForm(),'pg-open':()=>openRequest(id),'pg-revise':()=>requestForm(d),
    'pg-cancel':()=>reasonForm('Batalkan PR',`purchasing/requests/${d.id}/cancel`,{row_version:d.row_version},'Alasan pembatalan','Batalkan PR'),
    'pg-approve':()=>decideStep('APPROVE'),'pg-return':()=>decideStep('RETURN'),'pg-decline':()=>decideStep('REJECT'),
    'pg-accept':()=>acceptForm(),'pg-reject-completeness':()=>reasonForm('Tolak PR',`purchasing/requests/${d.id}/completeness`,{action:'REJECT',row_version:d.row_version},'Alasan penolakan (terlihat oleh pemohon)','Tolak PR'),
    'pg-quote':()=>quoteForm(),'pg-select-quote':()=>selectQuote(id),
    'pg-delete-quote':async()=>{const result=await api(`purchasing/requests/${d.id}/quotes/${id}`,{method:'DELETE'});toast('Harga dihapus.');await afterChange(result);},
    'pg-order':()=>orderForm(),'pg-confirm':()=>confirmForm(),'pg-answer':()=>answerForm(),
    'pg-order-edit':()=>orderEditForm(id),'pg-order-submit':()=>orderSubmitForm(id),'pg-order-purchase':()=>purchaseForm(id),'pg-order-receive':()=>receiveForm(id),'pg-order-scan':()=>scanForm(id),
    'pg-order-cancel':()=>reasonForm('Batalkan pesanan',`purchasing/orders/${id}/cancel`,{row_version:orderById(id).row_version},'Alasan pembatalan pesanan','Batalkan pesanan'),
    'pg-reassign':()=>reassignForm(),'pg-print':()=>printDocument(id),'pg-print-now':()=>printNow(),'pg-export':()=>exportCsv(),
    'pg-vendor':()=>vendorForm(id),'pg-budget-line':()=>budgetLineForm(id),
    'pg-budget-year':()=>formDialog('Tambah tahun anggaran',`<label class="field"><span>Tahun</span><input name="year" type="number" min="2000" max="2100" required value="${Number(localToday().slice(0,4))+1}"></label>`,async b=>{await post('purchasing/budget/years',{year:Number(b.year)});P.year=Number(b.year);toast('Tahun anggaran ditambahkan.');refresh();}),
    'pg-settings':()=>settingsForm(),'pg-delegation':()=>delegationForm(),
    'pg-revoke':async()=>{await post(`purchasing/delegations/${id}/revoke`,{row_version:Number(el.dataset.version)});toast('Plh dicabut.');refresh();}
  };
  const run=actions[action];if(!run)return false;await run();return true;
}
