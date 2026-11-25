import {state,api,post,patch,refresh} from './api.js';
import {esc,icon,button,dialog,formDialog,toast,number,localToday,formatDate} from './ui.js';
import {createXlsx} from './xlsx-export.js';

export const merchandiseTitles={
  merchandise:'Beranda Merchandise',
  'merchandise-products':'Daftar Merchandise',
  'merchandise-umkm':'Barang Titipan UMKM',
  'merchandise-sales':'Penjualan Merchandise',
  'merchandise-stock':'Mutasi Stok Merchandise',
  'merchandise-reports':'Laporan Penjualan Merchandise'
};
export const merchandiseRoutes=Object.keys(merchandiseTitles);
export const merchandiseNav=[
  ['merchandise','Beranda','dashboard','merchandise.catalog.read'],
  ['merchandise-products','Daftar Barang','folder','merchandise.catalog.read'],
  ['merchandise-umkm','Barang UMKM','people','merchandise.umkm.read'],
  ['merchandise-sales','Penjualan','building','merchandise.sales.read'],
  ['merchandise-stock','Stok Barang','log','merchandise.stock.read'],
  ['merchandise-reports','Laporan','filter','merchandise.reports.read']
];
const M={products:[],sales:[],movements:[],overview:null,today:null,report:null,query:'',owner:'ALL',umkm:{partners:[],docs:[]},from:localToday().slice(0,7)+'-01',to:localToday(),salesArtwork:null,salesTemplateName:''};
const allowed=code=>state.permissions.includes(code);
const money=n=>'Rp'+number(n);
const exportModuleURL=name=>new URL((new URL(import.meta.url).pathname.startsWith('/portal-static/')?'../app/':'./')+name,import.meta.url).href;
const pageHead=(title,subtitle,actions='')=>`<div class="page-heading mm-heading"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="actions">${actions}</div></div>`;
const table=(heads,rows,empty='Belum ada data')=>rows.length?`<div class="table-wrap mm-table" tabindex="0" role="region" aria-label="Tabel merchandise, geser ke samping untuk melihat semua kolom"><table><thead><tr>${heads.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`:`<section class="card"><div class="card-body"><p class="muted">${esc(empty)}</p></div></section>`;
const actions=(name,action,ico='plus')=>button(name,action,ico,'primary');
function stat(title,value,detail){return `<section class="stat-card mm-stat${String(value).startsWith('Rp')?' mm-stat-money':''}"><div class="stat-top"><span>${esc(title)}</span></div><div class="stat-value">${esc(String(value))}</div><div class="stat-bottom"><span>${esc(detail)}</span></div></section>`;}
function statLink(title,value,detail,action,label){return `<button type="button" class="stat-card mm-stat mm-stat-link" data-action="${action}" aria-haspopup="dialog" aria-label="${esc(label)}"><span class="stat-top"><span>${esc(title)}</span></span><span class="stat-value">${esc(String(value))}</span><span class="stat-bottom"><span>${esc(detail)}</span><span class="mm-stat-more">Lihat daftar${icon('arrow')}</span></span></button>`;}
export const LOW_STOCK_LIMIT=5,RESTOCK_SALES_DAYS=30;
// Barang titipan UMKM: harga jual = harga UMKM + 20%, dibulatkan ke atas ke kelipatan
// Rp500 (di bawah Rp5.000: kelipatan Rp100); selisih pembulatan masuk keuntungan BP.
// Rumus sama dengan lib/merchandise.mjs (umkmSellPrice). Di sini hanya untuk pratinjau dan
// rincian laporan; harga yang tersimpan selalu dihitung server.
export const UMKM_MARKUP_PCT=20;
export function umkmPricing(cost,pct=UMKM_MARKUP_PCT){
  const value=Number(cost),markup=Math.round(value*pct/100),base=value+markup,step=base<5000?100:500,sell=Math.ceil(base/step)*step;
  return {cost:value,markup,base,rounding:sell-base,sell,profit:sell-value};
}
export const isUmkm=item=>Boolean(item?.umkm_partner_id);
const umkmTag=name=>`<span class="badge neutral mm-umkm-tag">UMKM · ${esc(name||'')}</span>`;
// Rekap barang UMKM per mitra dari baris penjualan selesai (snapshot harga UMKM dan persen)
// dan koreksi yang ditanggung BP. Hak UMKM = terjual × harga UMKM + barang hilang/rusak yang
// ditanggung BP; keuntungan BP = penjualan − hak UMKM (20% + pembulatan − tanggungan).
export function umkmSalesSummary(sales,losses=[]){
  const partners=new Map();
  const partner=(id,name)=>{if(!partners.has(id))partners.set(id,{id,name:name||'',qty:0,revenue:0,payable:0,profit:0,markup:0,rounding:0,lossQty:0,loss:0});return partners.get(id);};
  for(const sale of sales||[]){
    if(sale.status!=='COMPLETED')continue;
    for(const item of sale.items||[]){
      if(!item.umkm_partner_id)continue;
      const row=partner(item.umkm_partner_id,item.umkm_partner_name),qty=Number(item.quantity||0),unit=Number(item.unit_cost||0);
      const cost=unit*qty,markup=Math.round(unit*Number(item.umkm_markup_pct??UMKM_MARKUP_PCT)/100)*qty,revenue=Number(item.subtotal||0);
      row.qty+=qty;row.revenue+=revenue;row.payable+=cost;row.profit+=revenue-cost;row.markup+=markup;row.rounding+=revenue-cost-markup;
    }
  }
  for(const m of losses||[]){
    const row=partner(m.umkm_partner_id,m.umkm_partner_name),qty=-Number(m.quantity_delta||0),amount=qty*Number(m.unit_cost||0);
    row.lossQty+=qty;row.loss+=amount;row.payable+=amount;row.profit-=amount;
  }
  return [...partners.values()].sort((a,b)=>a.name.localeCompare(b.name,'id'));
}
// Stok per barang: display (stock_qty, tempat barang dijual) dan gudang (warehouse_qty).
// null = belum dihitung, berbeda dari 0. Gudang yang belum dihitung dianggap 0 pada total.
export const PAYMENT_METHODS=['TUNAI','QRIS','TRANSFER','CARD','LAINNYA'];
const counted=value=>value!==null&&value!==undefined;
const isActive=p=>p.is_active!==false&&p.is_active!==0;
export const totalStock=p=>Number(p.stock_qty??0)+Number(p.warehouse_qty??0);
const stockCell=value=>counted(value)?number(value):'<span class="badge warm">Belum dihitung</span>';
const stockSplit=p=>`Display ${number(p.stock_qty)} · ${counted(p.warehouse_qty)?'Gudang '+number(p.warehouse_qty):'Gudang belum dihitung'}`;
// Sama dengan hitungan kartu di server: stok display sudah dicatat dan total display +
// gudang 5 atau kurang. Barang aktif lebih dulu, lalu total paling sedikit, lalu yang paling laku.
export function restockCandidates(products,sales=null){
  const sold=new Map();
  for(const s of sales||[])if(s.status==='COMPLETED')for(const i of s.items||[]){const key=i.product_id||i.sku;sold.set(key,(sold.get(key)||0)+Number(i.quantity||0));}
  return products.filter(p=>counted(p.stock_qty)&&totalStock(p)<=LOW_STOCK_LIMIT)
    .map(p=>({...p,total:totalStock(p),sold:sales?(sold.get(p.id)??sold.get(p.sku)??0):null}))
    .sort((a,b)=>Number(isActive(b))-Number(isActive(a))||a.total-b.total||(b.sold??0)-(a.sold??0)||String(a.name).localeCompare(String(b.name),'id'));
}
// Sama dengan kartu "Display perlu diisi" di server: barang aktif dengan display 5 atau
// kurang padahal gudang masih ada. Display paling sedikit lebih dulu.
export function displayRefillCandidates(products){
  return products.filter(p=>isActive(p)&&counted(p.stock_qty)&&Number(p.stock_qty)<=LOW_STOCK_LIMIT&&Number(p.warehouse_qty)>0)
    .sort((a,b)=>Number(a.stock_qty)-Number(b.stock_qty)||Number(b.warehouse_qty)-Number(a.warehouse_qty)||String(a.name).localeCompare(String(b.name),'id'));
}
// Rekap metode pembayaran transaksi selesai, urutan sama dengan laporan Excel.
export function paymentSummary(sales){
  const rows=new Map([['TUNAI','TUNAI'],['QRIS','NON TUNAI (QRIS)'],['TRANSFER','TRANSFER'],['CARD','CARD'],['LAINNYA','LAINNYA']].map(([method,label])=>[method,{method,label,count:0,total:0}]));
  for(const s of sales||[]){
    if(s.status!=='COMPLETED')continue;
    const row=rows.get(s.payment_method==='KARTU'?'CARD':s.payment_method)||rows.get('LAINNYA');
    row.count++;row.total+=Number(s.total||0);
  }
  return [...rows.values()].filter(row=>row.method!=='LAINNYA'||row.count);
}
// Ringkasan Beranda: hanya transaksi selesai pada tanggal WITA hari ini.
export function todaySalesSummary(sales){
  const done=(sales||[]).filter(s=>s.status==='COMPLETED');
  return {revenue:done.reduce((n,s)=>n+Number(s.total||0),0),count:done.length,units:done.reduce((n,s)=>n+(s.items||[]).reduce((m,i)=>m+Number(i.quantity||0),0),0)};
}
const daysBefore=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')-n*86400000).toISOString().slice(0,10);
async function showLowStock(){
  const to=localToday(),from=daysBefore(to,RESTOCK_SALES_DAYS-1),withSales=allowed('merchandise.sales.read');
  const [products,sales]=await Promise.all([api('merchandise/products').then(r=>r.items),withSales?api(`merchandise/sales?from=${from}&to=${to}`).then(r=>r.items):null]);
  M.products=products;
  const list=restockCandidates(products,sales),canRecord=Boolean(M.overview?.capabilities?.stock_record);
  const out=list.filter(p=>p.total===0).length,inactive=list.filter(p=>!isActive(p)).length;
  const summary=list.length?`<p class="mm-restock-summary"><strong>${number(list.length)} barang</strong>: ${number(out)} habis, ${number(list.length-out)} tersisa 1–${LOW_STOCK_LIMIT}${inactive?`; ${number(inactive)} di antaranya nonaktif (di bagian bawah)`:''}. Sisa = display + gudang.${withSales?` Kolom terjual menghitung transaksi selesai ${RESTOCK_SALES_DAYS} hari terakhir (${formatDate(from)} – ${formatDate(to)}).`:''}</p>`:'';
  const rows=list.map(p=>{
    const off=!isActive(p);
    return `<li class="mm-restock-item${off?' is-inactive':''}"><div class="mm-restock-name"><strong>${esc(p.name)}</strong><small class="muted">${esc(p.sku)}${isUmkm(p)?` · UMKM ${esc(p.umkm_partner_name)} (hubungi UMKM)`:''}${off?' · Nonaktif':''} · ${esc(stockSplit(p))}</small></div>
      <div class="mm-restock-qty">${p.total===0?'<span class="badge negative">Habis</span>':`<span class="badge warm">Sisa ${number(p.total)}</span>`}</div>
      ${withSales?`<div class="mm-restock-sold"><strong>${number(p.sold)}</strong> terjual</div>`:''}
      ${canRecord?`<div class="mm-restock-action">${button('Catat stok','mm-restock-record','plus','outlined',`data-id="${esc(p.id)}"`)}</div>`:''}</li>`;
  });
  const el=dialog('Barang perlu restock',list.length?`${summary}<ul class="mm-restock-list">${rows.join('')}</ul>`:`<p class="muted">Tidak ada barang dengan stok ${LOW_STOCK_LIMIT} atau kurang.</p>`,{wide:true,subtitle:`Total display + gudang ${LOW_STOCK_LIMIT} atau kurang, termasuk stok kosong. Urut dari stok paling sedikit.`});
  el.addEventListener('click',async e=>{
    const b=e.target.closest('[data-action=mm-restock-record]');if(!b)return;
    el.close();
    try{await changeStock(b.dataset.id);}catch(error){toast(error.message,true);}
  });
}
async function showDisplayRefill(){
  const products=(await api('merchandise/products')).items;M.products=products;
  const list=displayRefillCandidates(products),canRecord=Boolean(M.overview?.capabilities?.stock_record);
  const rows=list.map(p=>`<li class="mm-restock-item mm-refill-item"><div class="mm-restock-name"><strong>${esc(p.name)}</strong><small class="muted">${esc(p.sku)}${isUmkm(p)?` · UMKM ${esc(p.umkm_partner_name)}`:''}</small></div>
      <div class="mm-restock-qty">${Number(p.stock_qty)===0?'<span class="badge negative">Display habis</span>':`<span class="badge warm">Display ${number(p.stock_qty)}</span>`}</div>
      <div class="mm-restock-sold">Gudang <strong>${number(p.warehouse_qty)}</strong></div>
      ${canRecord?`<div class="mm-restock-action">${button('Pindah ke display','mm-refill-move','arrow','outlined',`data-id="${esc(p.id)}"`)}</div>`:''}</li>`);
  const el=dialog('Display perlu diisi',list.length?`<p class="mm-restock-summary"><strong>${number(list.length)} barang</strong> di display tinggal ${LOW_STOCK_LIMIT} atau kurang, padahal gudang masih ada. Pindahkan dari gudang supaya bisa dijual.</p><ul class="mm-restock-list">${rows.join('')}</ul>`:`<p class="muted">Tidak ada barang yang perlu diisi dari gudang.</p>`,{wide:true,subtitle:`Barang aktif dengan display ${LOW_STOCK_LIMIT} atau kurang dan gudang masih ada. Urut dari display paling sedikit.`});
  el.addEventListener('click',async e=>{
    const b=e.target.closest('[data-action=mm-refill-move]');if(!b)return;
    el.close();
    try{await changeStock(b.dataset.id,'TRANSFER:DISPLAY');}catch(error){toast(error.message,true);}
  });
}
function filterPeriod(){return `<div class="toolbar mm-toolbar"><label class="field"><span>Dari</span><input type="date" data-mm-date="from" value="${M.from}"></label><label class="field"><span>Sampai</span><input type="date" data-mm-date="to" value="${M.to}"></label>${button('Terapkan periode','mm-filter','filter','outlined')}</div>`;}
function home(){
  const r=M.overview;
  return `${pageHead('Merchandise','Ringkasan penjualan dan ketersediaan barang Bidang Bisnis.',r.capabilities.sales_create?actions('Catat Penjualan','mm-sale'): '')}
    <div class="stats-grid mm-stats${M.today&&r.capabilities.reports?' mm-stats-split':''}">${stat('Jenis barang',r.products_total,'Terdaftar dalam katalog')}${M.today?stat('Penjualan hari ini',M.today.error?'—':money(M.today.revenue),M.today.error?'Belum dapat dimuat':`${number(M.today.count)} transaksi · ${number(M.today.units)} barang`):''}${r.capabilities.reports?stat('Omzet bulan ini',money(r.revenue),'Transaksi selesai'):''}${statLink('Stok 5 atau kurang',r.products_low,'Display + gudang, termasuk kosong','mm-low-stock','Stok 5 atau kurang: '+r.products_low+' barang. Lihat daftar barang yang perlu restock')}${statLink('Display perlu diisi',r.products_display_low??0,'Display 5 atau kurang, gudang ada','mm-display-refill','Display perlu diisi: '+(r.products_display_low??0)+' barang. Lihat daftar barang yang perlu dipindah dari gudang')}</div>
    ${r.products_uninitialized?`<div class="notice warning">${icon('incident')}<div><strong>Stok awal belum lengkap</strong><p>${number(r.products_uninitialized)} barang belum dicatat stok awalnya. Barang itu tidak dapat dijual sampai petugas mengisi stok awalnya lewat Daftar Barang.</p></div></div>`:''}
    ${r.products_warehouse_uncounted?`<div class="notice warning">${icon('incident')}<div><strong>Stok gudang belum dihitung</strong><p>${number(r.products_warehouse_uncounted)} barang aktif belum dicatat stok gudangnya. Hitung isi gudang, lalu catat lewat Daftar Barang → <strong>Stok</strong> → Stok awal gudang. Penjualan tetap berjalan dari stok display.</p></div></div>`:''}
    <section class="card"><div class="card-body"><p>Gunakan <strong>Daftar Barang</strong> untuk mengatur harga dan mencatat stok display maupun gudang. Penjualan mengurangi stok display; bila display kurang, catat <strong>Pindah ke display</strong> dari gudang lewat tombol Stok. Pembatalan memerlukan kewenangan manager.</p></div></section>`;
}
function products(){
  const c=M.overview.capabilities,query=M.query.toLowerCase(),withUmkm=M.products.some(isUmkm);
  const owned=p=>M.owner==='ALL'||(M.owner==='UMKM')===isUmkm(p);
  const rows=M.products.filter(p=>owned(p)&&(p.name.toLowerCase().includes(query)||p.sku.toLowerCase().includes(query))).map(p=>`<tr>
    <td><strong>${esc(p.name)}</strong><small class="muted pg-block">${esc(p.sku)}</small>${isUmkm(p)?umkmTag(p.umkm_partner_name):''}</td>
    <td class="nowrap">${money(p.sell_price)}</td>
    ${c.costs?`<td class="nowrap">${money(p.buy_price)}</td>`:''}
    <td class="mm-num">${stockCell(p.stock_qty)}</td>
    <td class="mm-num">${stockCell(p.warehouse_qty)}</td>
    <td class="mm-num">${counted(p.stock_qty)?`<strong>${number(totalStock(p))}</strong>`:'—'}</td>
    <td>${p.is_active?'<span class="badge positive">Aktif</span>':'<span class="badge neutral">Nonaktif</span>'}</td>
    <td class="nowrap"><div class="actions">${c.stock_record?button('Stok','mm-stock','plus','outlined',`data-id="${esc(p.id)}"`):''}${c.catalog_manage?button('Ubah','mm-edit','edit','outlined',`data-id="${esc(p.id)}"`):''}</div></td></tr>`);
  const ownerFilter=withUmkm?`<label class="field"><span>Pemilik barang</span><select data-mm-owner>${[['ALL','Semua barang'],['BP','Milik BP'],['UMKM','Barang UMKM (titipan)']].map(([value,label])=>`<option value="${value}"${M.owner===value?' selected':''}>${label}</option>`).join('')}</select></label>`:'';
  return `${pageHead('Daftar Merchandise','Katalog, harga, serta stok display dan gudang barang Bidang Bisnis.',c.catalog_manage?actions('Tambah Barang','mm-new'): '')}
    <div class="toolbar mm-toolbar"><label class="field"><span>Cari barang</span><input data-mm-search placeholder="Nama barang atau SKU" value="${esc(M.query)}"></label>${ownerFilter}</div>
    <section class="card">${table(['Barang','Harga jual',...(c.costs?[withUmkm?'Harga beli / UMKM':'Harga beli']:[]),'Display','Gudang','Total','Status','Tindakan'],rows,'Barang tidak ditemukan.')}</section>`;
}
function sales(){
  const r=M.sales.map(s=>`<tr><td><strong>${esc(s.sale_no)}</strong><small class="muted pg-block">${esc(s.payment_method)}</small></td><td class="nowrap">${formatDate(s.sold_on)}</td><td>${s.items.map(i=>`${esc(i.product_name)} × ${number(i.quantity)}${i.umkm_partner_id?' <span class="mm-umkm-mark">UMKM</span>':''}`).join('<br>')}</td><td>${money(s.total)}</td><td>${s.status==='VOID'?'<span class="badge negative">Batal</span>':'<span class="badge positive">Selesai</span>'}</td><td>${M.overview.capabilities.sales_void&&s.status==='COMPLETED'?button('Batalkan','mm-void','trash','outlined',`data-id="${esc(s.id)}"`):''}</td></tr>`);
  return `${pageHead('Transaksi Penjualan','Setiap transaksi menyimpan harga saat penjualan dan mengurangi stok display.',allowed('merchandise.sales.create')?actions('Transaksi Baru','mm-sale'): '')}
  ${filterPeriod()}<section class="card">${table(['Nomor','Tanggal','Barang','Total','Status','Tindakan'],r,'Belum ada transaksi pada periode ini.')}</section>`;
}
export const STOCK_KIND_LABELS={INITIAL:'Stok awal',IN:'Barang masuk',ADJUST:'Koreksi',SALE:'Terjual',VOID:'Pengembalian',TRANSFER:'Pindah stok',TAKEOUT:'Takeout UMKM'};
// Keterangan mutasi dengan tanggungan koreksi barang UMKM.
export const movementNote=m=>(m.reason||'')+(m.umkm_loss_borne_by==='BP'?' · selisih ditanggung BP':m.umkm_loss_borne_by==='UMKM'?' · selisih tidak ditanggung BP':'');
export const locationLabel=value=>value==='GUDANG'?'Gudang':'Display';
function stock(){
  const rows=M.movements.map(r=>`<tr><td class="nowrap">${formatDate(r.created_at)}</td><td>${esc(r.product_name)}<small class="muted pg-block">${esc(r.sku)}${r.umkm_partner_id?` · UMKM ${esc(r.umkm_partner_name)}`:''}</small></td><td>${esc(STOCK_KIND_LABELS[r.kind]||r.kind)}</td><td>${esc(locationLabel(r.location))}</td><td class="mm-num">${r.quantity_delta>0?'+':''}${number(r.quantity_delta)}</td><td class="mm-num">${number(r.balance_after)}</td><td>${esc(movementNote(r))}</td><td>${esc(r.actor_name||'')}</td></tr>`);
  return `${pageHead('Riwayat Stok','Semua stok awal, barang masuk, pindah stok, penjualan, takeout barang UMKM, dan koreksi tercatat per lokasi. Saldo adalah sisa di lokasi itu.')}${table(['Waktu','Barang','Jenis','Lokasi','Perubahan','Saldo','Alasan','Petugas'],rows,'Belum ada mutasi stok.')}`;
}
function umkmReportSection(rows,canCost){
  if(!rows.length)return '';
  const total=key=>rows.reduce((n,row)=>n+row[key],0);
  const body=rows.map(row=>`<tr><td>${esc(row.name)}</td><td class="mm-num">${number(row.qty)}</td><td class="mm-num">${money(row.revenue)}</td>${canCost?`<td class="mm-num">${money(row.payable)}</td><td class="mm-num">${money(row.profit)}</td><td class="mm-num">${row.lossQty?`${number(row.lossQty)} pcs · ${money(row.loss)}`:'—'}</td>`:''}</tr>`).join('');
  const sum=`<tr class="mm-total"><td>Jumlah</td><td class="mm-num">${number(total('qty'))}</td><td class="mm-num">${money(total('revenue'))}</td>${canCost?`<td class="mm-num">${money(total('payable'))}</td><td class="mm-num">${money(total('profit'))}</td><td class="mm-num">${total('lossQty')?`${number(total('lossQty'))} pcs · ${money(total('loss'))}`:'—'}</td>`:''}</tr>`;
  return `<section class="card mm-section"><div class="card-header"><div><h2>Barang UMKM per mitra</h2><p>${canCost?`Hak UMKM dibayar Keuangan berdasarkan Ekspor Penjualan Bulanan. Keuntungan BP: ${money(total('markup'))} (${UMKM_MARKUP_PCT}% dari harga UMKM) + pembulatan ${money(total('rounding'))}${total('loss')?` − barang hilang/rusak ditanggung BP ${money(total('loss'))}`:''}.`:'Penjualan barang titipan UMKM pada periode terpilih.'}</p></div></div>
    <div class="table-wrap mm-payments" tabindex="0" role="region" aria-label="Rekap barang UMKM per mitra"><table><thead><tr><th scope="col">Mitra UMKM</th><th scope="col">Terjual</th><th scope="col">Penjualan</th>${canCost?'<th scope="col">Hak UMKM</th><th scope="col">Keuntungan BP</th><th scope="col">Hilang/rusak ditanggung BP</th>':''}</tr></thead><tbody>${body}${sum}</tbody></table></div></section>`;
}
function reports(){
  const r=M.report,summary=r.summary,canCost=allowed('merchandise.catalog.costs'),umkm=umkmSalesSummary(r.sales,r.umkm_losses);
  // Laba kotor = TOTAL LABA BP di Ekspor Penjualan Bulanan: barang UMKM hilang/rusak yang
  // ditanggung BP dibayar ke UMKM, jadi ikut mengurangi laba periode itu.
  const umkmRevenue=umkm.reduce((n,row)=>n+row.revenue,0),umkmLoss=umkm.reduce((n,row)=>n+row.loss,0);
  const profitNote=umkmLoss>0?`Termasuk barang UMKM, sudah dikurangi barang hilang/rusak ditanggung BP ${money(umkmLoss)}`:umkm.length?'Termasuk keuntungan BP dari barang UMKM':'Dari harga beli snapshot';
  return `${pageHead('Laporan Merchandise','Rekap stok harian dan penjualan berdasarkan periode.',allowed('merchandise.reports.export')?button('Ekspor Penjualan Bulanan','mm-export-sales-monthly','download','primary')+button('Ekspor Stok Bulanan','mm-export-monthly','download','outlined')+button('Ekspor Detail Transaksi','mm-export','download','outlined'): '')}${filterPeriod()}
    <div class="notice"><p><strong>Format penjualan bulanan:</strong> mengikuti Excel resmi dengan kop dan logo, rekap pendapatan/modal/laba, penjualan per barang, metode pembayaran, lembar harian dan MASTER AKHIR. Pilih periode dalam satu bulan. Metode pembayaran: tunai, non tunai (QRIS), transfer, dan card masing-masing satu baris; lainnya ditampilkan bila dipakai. Modal dan laba mengikuti izin akses.</p></div>
    ${allowed('merchandise.reports.export')?`<div class="toolbar mm-toolbar"><label class="field"><span>Excel acuan penjualan</span><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-mm-sales-template><small data-mm-template-status>${esc(M.salesTemplateName?'Template siap: '+M.salesTemplateName:'Pilih file laporan penjualan resmi. Kop dan tanda tangan dibaca di perangkat ini.')}</small></label></div>`:''}
    <div class="notice"><p><strong>Format lengkap (Ekspor Stok Bulanan):</strong> MASTER, lembar per tanggal, MASTER AKHIR, penjualan, dan mutasi stok. Tabel utama berisi stok display; stok gudang dan pindah stok punya bagian sendiri. Riwayat harian yang belum tercatat sebelum 1 November 2026 tidak dapat direkonstruksi hanya dari saldo akhir Oktober.</p></div>
    <div class="stats-grid mm-stats">${stat('Omzet',money(summary.revenue),umkm.length?`Termasuk barang UMKM ${money(umkmRevenue)}`:'Transaksi selesai')}${stat('Transaksi',summary.transaction_count,'Di periode terpilih')}${stat('Barang terjual',summary.units_sold,'Satuan merchandise')}${canCost?stat('Laba kotor',money(summary.revenue-summary.cost-umkmLoss),profitNote):''}</div>
    ${paymentTable(r.sales)}
    ${umkmReportSection(umkm,canCost)}
    <section class="card">${table(['Transaksi','Barang','Qty','Harga satuan','Subtotal'],r.sales.filter(s=>s.status==='COMPLETED').flatMap(s=>s.items.map(i=>`<tr><td>${esc(s.sale_no)}</td><td>${esc(i.product_name)}${i.umkm_partner_id?umkmTag(i.umkm_partner_name):''}</td><td>${number(i.quantity)}</td><td>${money(i.unit_price)}</td><td>${money(i.subtotal)}</td></tr>`)),'Belum ada penjualan pada periode ini.')}</section>`;
}
function paymentTable(sales){
  const rows=paymentSummary(sales),count=rows.reduce((n,row)=>n+row.count,0),total=rows.reduce((n,row)=>n+row.total,0);
  const body=rows.map(row=>`<tr><td>${esc(row.label)}</td><td>${number(row.count)}</td><td>${money(row.total)}</td></tr>`).join('');
  return `<section class="card mm-section"><div class="card-header"><div><h2>Metode pembayaran</h2><p>Transaksi selesai di periode terpilih, urutan sama dengan Excel penjualan bulanan.</p></div></div>
    <div class="table-wrap mm-payments" tabindex="0" role="region" aria-label="Rekap metode pembayaran"><table><thead><tr><th scope="col">Jenis pembayaran</th><th scope="col">Transaksi</th><th scope="col">Nominal</th></tr></thead>
    <tbody>${body}<tr class="mm-total"><td>Jumlah</td><td>${number(count)}</td><td>${money(total)}</td></tr></tbody></table></div></section>`;
}
export async function loadMerchandisePage(route){
  if(route==='merchandise'){
    const today=localToday(),withSales=allowed('merchandise.sales.read');
    const [overview,sales]=await Promise.all([api('merchandise/overview'),withSales?api(`merchandise/sales?from=${today}&to=${today}`).then(r=>r.items,()=>undefined):null]);
    M.overview=overview;M.today=sales===null?null:sales===undefined?{error:true}:todaySalesSummary(sales);
    return home();
  }
  M.overview=await api('merchandise/overview');
  if(route==='merchandise-products'){M.products=(await api('merchandise/products')).items;return products();}
  if(route==='merchandise-umkm'){
    const [products,partners,docs]=await Promise.all([api('merchandise/products'),api('merchandise/umkm/partners'),api(`merchandise/umkm/docs?from=${M.from}&to=${M.to}`)]);
    M.products=products.items;M.umkm={partners:partners.items,docs:docs.items};return umkmPage();
  }
  if(route==='merchandise-sales'){M.sales=(await api(`merchandise/sales?from=${M.from}&to=${M.to}`)).items;return sales();}
  if(route==='merchandise-stock'){M.movements=(await api('merchandise/stock')).items;return stock();}
  if(route==='merchandise-reports'){M.report=await api(`merchandise/reports?from=${M.from}&to=${M.to}`);return reports();}
  return '';
}
const selected=id=>M.products.find(p=>p.id===id);
async function reloadProducts(){M.products=(await api('merchandise/products')).items;}
// Pilihan "Catat stok" sesuai keadaan barang. Nilai = JENIS:LOKASI; untuk pindah stok,
// lokasi adalah tujuan. Pilihan pertama menjadi bawaan (barang masuk ke gudang).
// Barang UMKM: tanpa stok awal dan barang masuk (lewat Terima barang); hanya pindah dan koreksi.
export function stockActions(p,canAdjust){
  const gudang=counted(p.warehouse_qty),display=counted(p.stock_qty),umkm=isUmkm(p),list=[];
  if(!display&&!umkm)return [{value:'INITIAL:DISPLAY',label:'Stok awal',amount:'Stok display (hasil hitung)',sets:true}];
  if(!gudang&&!umkm)list.push({value:'INITIAL:GUDANG',label:'Stok awal gudang',amount:'Stok gudang (hasil hitung)',sets:true});
  if(gudang&&!umkm)list.push({value:'IN:GUDANG',label:'Barang masuk ke gudang',amount:'Jumlah masuk'});
  if(!umkm)list.push({value:'IN:DISPLAY',label:'Barang masuk ke display',amount:'Jumlah masuk'});
  if(gudang&&Number(p.warehouse_qty)>0)list.push({value:'TRANSFER:DISPLAY',label:'Pindah gudang → display',amount:'Jumlah dipindah',max:Number(p.warehouse_qty)});
  if(gudang&&Number(p.stock_qty)>0)list.push({value:'TRANSFER:GUDANG',label:'Pindah display → gudang',amount:'Jumlah dipindah',max:Number(p.stock_qty)});
  if(canAdjust){
    list.push({value:'ADJUST:DISPLAY',label:'Koreksi saldo display',amount:'Saldo display baru (hasil hitung)',sets:true});
    if(gudang)list.push({value:'ADJUST:GUDANG',label:'Koreksi saldo gudang',amount:'Saldo gudang baru (hasil hitung)',sets:true});
  }
  return list;
}
async function changeStock(id,preset=''){
  await reloadProducts();const p=selected(id);if(!p)return;
  const umkm=isUmkm(p),choices=stockActions(p,allowed('merchandise.stock.adjust'));
  if(!choices.length){toast('Barang UMKM bertambah lewat Barang UMKM → Terima barang dan berkurang lewat Takeout.',true);return;}
  const first=choices.find(c=>c.value===preset)||choices[0];
  const adjusting=value=>value.startsWith('ADJUST:');
  const borne=umkm?`<label class="field" data-mm-borne${adjusting(first.value)?'':' hidden'}><span>Selisih ditanggung BP?</span><select name="loss_borne_by"${adjusting(first.value)?' required':''}><option value="">Pilih…</option><option value="BP">Ya — UMKM tetap dibayar sebesar harga UMKM</option><option value="UMKM">Tidak — tidak dibayar ke UMKM</option></select></label>`:'';
  const isNew=first.value==='INITIAL:DISPLAY';
  const now=`<p class="mm-stock-now"><span class="badge neutral">Display: ${counted(p.stock_qty)?number(p.stock_qty):'belum dihitung'}</span><span class="badge neutral">Gudang: ${counted(p.warehouse_qty)?number(p.warehouse_qty):'belum dihitung'}</span></p>`;
  const fields=isNew?`${now}<label class="field"><span>Stok display (hasil hitung)</span><input name="quantity" type="number" step="1" min="0" max="1000000" required></label>
    ${counted(p.warehouse_qty)?'':'<label class="field"><span>Stok gudang (hasil hitung)</span><input name="warehouse_quantity" type="number" step="1" min="0" max="1000000" placeholder="Kosongkan bila belum dihitung"></label>'}
    <label class="field full"><span>Alasan / keterangan</span><textarea name="reason" maxlength="300" required></textarea></label>`
    :`${now}<label class="field"><span>Jenis</span><select name="action">${choices.map(c=>`<option value="${c.value}"${c===first?' selected':''}>${esc(c.label)}</option>`).join('')}</select></label>
    <label class="field"><span data-mm-amount-label>${esc(first.amount)}</span><input name="quantity" type="number" step="1" min="${first.sets?0:1}" max="${first.max??1000000}" required></label>
    ${borne}<label class="field full"><span>${umkm?'Alasan / keterangan':'Alasan / keterangan (mis. nomor dokumen penerimaan)'}</span><textarea name="reason" maxlength="300" required></textarea></label>`;
  const el=formDialog('Catat stok: '+p.name,fields,async data=>{
    const [kind,location]=(isNew?'INITIAL:DISPLAY':data.action).split(':');
    const body={kind,location,quantity:Number(data.quantity),reason:data.reason,row_version:p.row_version};
    if(isNew&&data.warehouse_quantity!==undefined&&data.warehouse_quantity!=='')body.warehouse_quantity=Number(data.warehouse_quantity);
    if(umkm&&kind==='ADJUST')body.loss_borne_by=data.loss_borne_by||null;
    await post(`merchandise/products/${id}/stock`,body);toast('Stok berhasil dicatat.');refresh();
  },{note:umkm?'Barang UMKM bertambah lewat Terima barang dan diambil kembali lewat Takeout; di sini hanya pindah display ↔ gudang dan koreksi hasil hitung. Koreksi yang mengurangi stok dan ditanggung BP tetap dibayar ke UMKM sebesar harga UMKM.':isNew?'Masukkan jumlah fisik berdasarkan penghitungan pertama. Penjualan selalu mengurangi stok display.':'Barang masuk dan pindah stok mengubah saldo sebesar jumlah yang diisi. Stok awal dan koreksi mengisi saldo baru sesuai hasil hitung. Penjualan hanya mengurangi stok display.'});
  const select=el.querySelector('[name=action]');
  select?.addEventListener('change',()=>{
    const choice=choices.find(c=>c.value===select.value);if(!choice)return;
    el.querySelector('[data-mm-amount-label]').textContent=choice.amount;
    const input=el.querySelector('[name=quantity]');input.min=choice.sets?'0':'1';input.max=String(choice.max??1000000);
    const box=el.querySelector('[data-mm-borne]');
    if(box){box.hidden=!adjusting(choice.value);box.querySelector('select').required=adjusting(choice.value);}
  });
}
function umkmProductForm(p){
  const el=formDialog('Ubah barang UMKM',`<p class="mm-stock-now">${umkmTag(p.umkm_partner_name)}<span class="badge neutral">${esc(p.sku)}</span></p>
    <label class="field"><span>Nama barang</span><input name="name" maxlength="160" value="${esc(p.name)}" required></label>
    <label class="field"><span>Harga UMKM (Rp)</span><input name="buy_price" type="number" min="100" max="100000000" step="1" value="${p.buy_price??''}" required data-mm-cost></label>
    <p class="form-note full" data-mm-preview>${esc(pricePreview(p.buy_price))}</p>
    <label class="check-field"><input type="checkbox" name="is_active" ${p.is_active?'checked':''}><span>Barang aktif</span></label>`,
    async d=>{
      await patch(`merchandise/products/${p.id}`,{name:d.name,buy_price:Number(d.buy_price),is_active:d.is_active,row_version:p.row_version});
      toast('Data barang UMKM tersimpan.');refresh();
    },{note:UMKM_PRICE_NOTE+' Harga baru berlaku untuk penjualan berikutnya; ganti juga label harga di display.'});
  el.querySelector('[data-mm-cost]').addEventListener('input',e=>{el.querySelector('[data-mm-preview]').textContent=pricePreview(e.target.value);});
}
async function productForm(id){
  await reloadProducts();const p=id?selected(id):null;
  if(isUmkm(p))return umkmProductForm(p);
  formDialog(p?'Ubah Merchandise':'Tambah Merchandise',`
    ${p?'':`<label class="field"><span>SKU</span><input name="sku" maxlength="40" required placeholder="MER-069"></label>`}
    <label class="field"><span>Nama barang</span><input name="name" maxlength="160" value="${esc(p?.name||'')}" required></label>
    <label class="field"><span>Harga beli (Rp)</span><input name="buy_price" type="number" min="0" step="1" value="${p?.buy_price??''}" required></label>
    <label class="field"><span>Harga jual (Rp)</span><input name="sell_price" type="number" min="0" step="1" value="${p?.sell_price??''}" required></label>
    ${p?`<label class="check-field"><input type="checkbox" name="is_active" ${p.is_active?'checked':''}><span>Barang aktif</span></label>`:''}`,
    async d=>{
      const body={name:d.name,buy_price:Number(d.buy_price),sell_price:Number(d.sell_price),...(p?{is_active:d.is_active,row_version:p.row_version}:{sku:d.sku})};
      if(p)await patch(`merchandise/products/${p.id}`,body);else await post('merchandise/products',body);
      toast('Data barang tersimpan.');refresh();
    },{note:p?'':'Untuk barang milik BP. Barang titipan UMKM ditambahkan lewat Barang UMKM → Terima barang.'});
}
// Pilihan barang di Catat Penjualan: yang display-nya ada bisa dipilih; yang display-nya
// habis tetapi gudangnya ada tetap terlihat (tidak bisa dipilih) agar dipindah dulu.
export function saleProductOptions(products){
  const sellable=products.filter(p=>isActive(p)&&counted(p.stock_qty)&&Number(p.stock_qty)>0);
  const inWarehouse=products.filter(p=>isActive(p)&&counted(p.stock_qty)&&Number(p.stock_qty)===0&&Number(p.warehouse_qty)>0);
  const where=p=>counted(p.warehouse_qty)?`display ${number(p.stock_qty)} · gudang ${number(p.warehouse_qty)}`:`display ${number(p.stock_qty)}`;
  const html=sellable.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} — ${money(p.sell_price)} (${where(p)})${isUmkm(p)?` · UMKM ${esc(p.umkm_partner_name)}`:''}</option>`).join('')
    +(inWarehouse.length?`<optgroup label="Display habis — pindahkan dari gudang dulu">${inWarehouse.map(p=>`<option value="${esc(p.id)}" disabled>${esc(p.name)} (gudang ${number(p.warehouse_qty)})</option>`).join('')}</optgroup>`:'');
  return {sellable,inWarehouse,html};
}
async function saleForm(){
  await reloadProducts();const {sellable,inWarehouse,html:options}=saleProductOptions(M.products);
  if(!sellable.length){toast(inWarehouse.length?'Stok display kosong. Pindahkan barang dari gudang dulu lewat Daftar Barang → Stok.':'Belum ada barang dengan stok siap dijual.',true);return;}
  const fields=`<div class="full" data-mm-lines><div class="form-grid mm-sale-line" data-mm-line><label class="field"><span>Barang</span><select name="product_id[]" required>${options}</select></label><label class="field"><span>Jumlah</span><input name="quantity[]" type="number" min="1" max="10000" value="1" required></label></div></div>
    <div class="full"><button type="button" class="button outlined" data-mm-add-line>${icon('plus')} Tambah barang</button></div>
    <label class="field"><span>Pembayaran</span><select name="payment_method">${PAYMENT_METHODS.map(method=>`<option>${method}</option>`).join('')}</select></label>
    <label class="field full"><span>Catatan (opsional)</span><textarea name="note" maxlength="300"></textarea></label>`;
  const el=formDialog('Catat Penjualan',fields,async(_,form)=>{
    const ids=[...form.querySelectorAll('[name="product_id[]"]')].map(x=>x.value),quantities=[...form.querySelectorAll('[name="quantity[]"]')].map(x=>Number(x.value));
    const result=await post('merchandise/sales',{payment_method:form.querySelector('[name=payment_method]').value,note:form.querySelector('[name=note]').value,items:ids.map((product_id,i)=>({product_id,quantity:quantities[i]}))});
    toast(`Transaksi ${result.sale_no} tersimpan (${money(result.total)}).`);refresh();
  },{wide:true,submit:'Simpan penjualan',note:'Harga mengikuti katalog. Stok display langsung berkurang saat transaksi tersimpan.'});
  el.querySelector('[data-mm-add-line]').addEventListener('click',()=>el.querySelector('[data-mm-lines]').insertAdjacentHTML('beforeend',`<div class="form-grid mm-sale-line" data-mm-line><label class="field"><span>Barang</span><select name="product_id[]" required>${options}</select></label><label class="field"><span>Jumlah</span><input name="quantity[]" type="number" min="1" max="10000" value="1" required></label></div>`));
}
function voidSale(id){
  const sale=M.sales.find(s=>s.id===id);if(!sale)return;
  formDialog('Batalkan '+sale.sale_no,`<label class="field full"><span>Alasan pembatalan</span><textarea name="reason" maxlength="300" required></textarea></label>`,
    async d=>{await post(`merchandise/sales/${id}/void`,{reason:d.reason,row_version:sale.row_version});toast('Transaksi dibatalkan dan stok dikembalikan.');refresh();},
    {note:'Riwayat penjualan tidak dihapus. Pembatalan mengembalikan jumlah barang ke stok.'});
}
function saveBlob(blob,filename){
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
// Detail Transaksi. Kolom pemilik dan hak UMKM hanya muncul bila ada barang UMKM, supaya
// ekspor tanpa barang UMKM tetap sama seperti sebelumnya.
export function detailWorkbookSheets(r,canCost){
  const withUmkm=r.stock.some(isUmkm)||r.sales.some(s=>(s.items||[]).some(isUmkm));
  const owner=item=>isUmkm(item)?'UMKM '+(item.umkm_partner_name||''):'BP';
  const columns=[
    {key:'date',header:'Tanggal',kind:'date'},{key:'number',header:'Nomor transaksi'},{key:'method',header:'Pembayaran'},
    {key:'sku',header:'SKU'},{key:'product',header:'Nama barang'},...(withUmkm?[{key:'owner',header:'Pemilik'}]:[]),{key:'qty',header:'Qty',kind:'number'},
    {key:'price',header:'Harga jual',kind:'number'},{key:'subtotal',header:'Subtotal',kind:'number'}];
  if(canCost)columns.push({key:'cost',header:withUmkm?'Harga beli / harga UMKM':'Harga beli',kind:'number'},...(withUmkm?[{key:'umkmShare',header:'Hak UMKM',kind:'number'}]:[]),{key:'margin',header:withUmkm?'Laba kotor / keuntungan BP':'Laba kotor',kind:'number'});
  const rows=r.sales.filter(s=>s.status==='COMPLETED').flatMap(s=>s.items.map(i=>({date:s.sold_on,number:s.sale_no,method:s.payment_method,sku:i.sku,product:i.product_name,...(withUmkm?{owner:owner(i)}:{}),qty:i.quantity,price:i.unit_price,subtotal:i.subtotal,
    ...(canCost?{cost:i.unit_cost,...(withUmkm?{umkmShare:isUmkm(i)?i.unit_cost*i.quantity:null}:{}),margin:i.subtotal-i.unit_cost*i.quantity}:{})})));
  return [
    {name:'Penjualan',columns,rows},
    {name:'Stok',columns:[{key:'sku',header:'SKU'},{key:'name',header:'Barang'},...(withUmkm?[{key:'owner',header:'Pemilik'}]:[]),{key:'display',header:'Stok display',kind:'number'},{key:'warehouse',header:'Stok gudang',kind:'number'},{key:'total',header:'Total stok',kind:'number'},{key:'price',header:'Harga jual',kind:'number'}],
      rows:r.stock.map(p=>({sku:p.sku,name:p.name,...(withUmkm?{owner:owner(p)}:{}),display:p.stock_qty,warehouse:p.warehouse_qty??null,total:counted(p.stock_qty)?totalStock(p):null,price:p.sell_price}))},
    {name:'Mutasi Stok',columns:[{key:'date',header:'Waktu',kind:'datetime'},{key:'sku',header:'SKU'},{key:'name',header:'Barang'},...(withUmkm?[{key:'owner',header:'Pemilik'}]:[]),{key:'kind',header:'Jenis'},{key:'location',header:'Lokasi'},{key:'delta',header:'Perubahan',kind:'number'},{key:'balance',header:'Saldo akhir lokasi',kind:'number'},{key:'reason',header:'Alasan'}],
      rows:r.movements.map(m=>({date:m.created_at,sku:m.sku,name:m.product_name,...(withUmkm?{owner:owner(m)}:{}),kind:STOCK_KIND_LABELS[m.kind]||m.kind,location:locationLabel(m.location),delta:m.quantity_delta,balance:m.balance_after,reason:withUmkm?movementNote(m):m.reason}))}
  ];
}
async function exportReport(){
  if(!allowed('merchandise.reports.export'))return;
  const workbook=createXlsx(detailWorkbookSheets(M.report,allowed('merchandise.catalog.costs')));
  await post('merchandise/reports/export',{period:`${M.from}/${M.to}`});
  saveBlob(workbook,`laporan-merchandise-${M.from}-${M.to}.xlsx`);
  toast('Laporan Excel siap diunduh.');
}

async function exportSalesMonthlyReport(){
  if(!allowed('merchandise.reports.export'))return;
  if(!M.salesArtwork)throw new Error('Pilih file Excel acuan penjualan terlebih dahulu.');
  const from=M.from,to=M.to,artwork=M.salesArtwork;
  const {merchandiseSalesWorkbook}=await import(exportModuleURL('merchandise-sales-xlsx.js'));
  const report=await api(`merchandise/reports?from=${from}&to=${to}`);
  const result=merchandiseSalesWorkbook({
    from,to,stock:report.stock,sales:report.sales,summary:report.summary,umkmLosses:report.umkm_losses||[],
    canCost:allowed('merchandise.catalog.costs'),today:localToday(),artwork
  });
  await post('merchandise/reports/export',{period:from+'/'+to,format:'DAILY_SALES'});
  saveBlob(result.blob,result.filename);
  toast('Laporan penjualan '+result.days+' hari / '+result.products+' barang siap diunduh.');
}

async function exportMonthlyReport(){
  if(!allowed('merchandise.reports.export'))return;
  const from=M.from,to=M.to;
  const {merchandiseMonthlyWorkbook}=await import('./merchandise-report-xlsx.js');
  const snapshot=await api(`merchandise/stock-export?from=${from}&to=${to}`);
  const logoUrl=exportModuleURL('assets/bp-besakih.png');
  const logoResponse=await fetch(logoUrl);
  if(!logoResponse.ok)throw new Error('Logo resmi BPFKSPA gagal dimuat. Silakan coba kembali.');
  const logoBytes=new Uint8Array(await logoResponse.arrayBuffer());
  const result=merchandiseMonthlyWorkbook({
    ...snapshot,canCost:allowed('merchandise.catalog.costs'),today:localToday(),logoBytes
  });
  await post('merchandise/reports/export',{period:from+'/'+to,format:'DAILY_STOCK'});
  saveBlob(result.blob,result.filename);
  toast('Laporan stok lengkap '+result.days+' hari / '+result.products+' barang siap diunduh.');
}

// ── Barang titipan UMKM ─────────────────────────────────────────────────────────
// Mitra, Terima barang, dan Takeout (koordinator ke atas). Takeout dicatat dan dicetak dulu,
// baru barang diserahkan. Keuangan membayar UMKM dari Ekspor Penjualan Bulanan.
const UMKM_TAKEOUT_REASONS=[['DIAMBIL_UMKM','Diambil kembali oleh UMKM'],['RUSAK','Rusak'],['TIDAK_LAKU','Tidak laku'],['BERHENTI','Berhenti kerja sama'],['LAINNYA','Lainnya (isi keterangan)']];
export const umkmReasonLabel=value=>(UMKM_TAKEOUT_REASONS.find(([key])=>key===value)||[null,value||''])[1];
const UMKM_PRICE_NOTE=`Harga jual = harga UMKM + ${UMKM_MARKUP_PCT}%, dibulatkan ke atas ke kelipatan Rp500 (di bawah Rp5.000 ke kelipatan Rp100). Selisih pembulatan masuk keuntungan BP.`;
export function pricePreview(value){
  const cost=Number(value);
  if(value===''||value===null||value===undefined||!Number.isInteger(cost)||cost<100)return 'Isi harga UMKM (minimal Rp100) untuk melihat harga jual.';
  const p=umkmPricing(cost);
  return `Harga jual ${money(p.sell)} · keuntungan BP ${money(p.profit)} (${UMKM_MARKUP_PCT}% ${money(p.markup)}${p.rounding?` + pembulatan ${money(p.rounding)}`:''}).`;
}
const sameMonth=day=>String(day||'').slice(0,7)===localToday().slice(0,7);
async function reloadPartners(){M.umkm={...M.umkm,partners:(await api('merchandise/umkm/partners')).items};}
const goodsOf=(partnerId,{inStock=false}={})=>M.products.filter(p=>p.umkm_partner_id===partnerId&&(inStock?totalStock(p)>0:isActive(p)));
const partnerOptions=(list,selectedId='')=>list.map(p=>`<option value="${esc(p.id)}"${p.id===selectedId?' selected':''}>${esc(p.name)} (${esc(p.code)})</option>`).join('');
function umkmPage(){
  const c=M.overview.capabilities,costs=c.costs,{partners,docs}=M.umkm;
  const partnerRows=partners.map(p=>`<tr${p.is_active?'':' class="muted"'}><td><strong>${esc(p.code)}</strong></td><td>${esc(p.name)}${p.notes?`<small class="muted pg-block">${esc(p.notes)}</small>`:''}</td>
    <td>${esc(p.owner_name||'—')}${p.phone?`<small class="muted pg-block">${esc(p.phone)}</small>`:''}</td><td class="mm-num">${number(p.product_count)}</td><td class="mm-num">${number(p.stock_total)}</td>
    <td>${p.is_active?'<span class="badge positive">Aktif</span>':'<span class="badge neutral">Nonaktif</span>'}</td><td class="nowrap">${c.umkm_receive?button('Ubah','mm-umkm-partner-edit','edit','outlined',`data-id="${esc(p.id)}"`):''}</td></tr>`);
  const goods=M.products.filter(isUmkm).sort((a,b)=>String(a.umkm_partner_name).localeCompare(String(b.umkm_partner_name),'id')||String(a.name).localeCompare(String(b.name),'id'));
  const goodRows=goods.map(p=>`<tr${isActive(p)?'':' class="muted"'}><td><strong>${esc(p.name)}</strong><small class="muted pg-block">${esc(p.sku)}${isActive(p)?'':' · Nonaktif'}</small></td><td>${esc(p.umkm_partner_name)}</td>
    ${costs?`<td class="nowrap">${money(p.buy_price)}</td>`:''}<td class="nowrap">${money(p.sell_price)}</td><td class="mm-num">${number(p.stock_qty)}</td><td class="mm-num">${number(p.warehouse_qty)}</td><td class="mm-num"><strong>${number(totalStock(p))}</strong></td></tr>`);
  const docRows=docs.map(d=>{
    const lines=d.items.map(i=>`${esc(i.product_name)} × ${number(i.quantity)}${i.location==='GUDANG'?' (gudang)':''}`).join('<br>');
    const canVoid=c.sales_void&&d.status==='ACTIVE'&&sameMonth(d.doc_date);
    return `<tr><td><strong>${esc(d.doc_no)}</strong><small class="muted pg-block">${d.kind==='TERIMA'?'Terima barang':'Takeout · '+esc(umkmReasonLabel(d.reason))}</small></td><td class="nowrap">${formatDate(d.doc_date)}</td>
      <td>${esc(d.partner_name)}<small class="muted pg-block">${d.kind==='TERIMA'?'Diserahkan':'Diambil'}: ${esc(d.counterpart_name)}</small></td><td>${lines}</td>
      <td>${d.status==='VOID'?`<span class="badge negative">Batal</span><small class="muted pg-block">${esc(d.void_reason||'')}</small>`:'<span class="badge positive">Aktif</span>'}</td>
      <td class="nowrap"><div class="actions">${button('Cetak','mm-umkm-print','download','outlined',`data-id="${esc(d.id)}"`)}${canVoid?button('Batalkan','mm-umkm-void','close','outlined',`data-id="${esc(d.id)}"`):''}</div></td></tr>`;
  });
  const head=pageHead('Barang UMKM','Barang titipan UMKM lokal yang dipajang dan dijual bersama merchandise BP.',
    c.umkm_receive?actions('Terima barang','mm-umkm-receive')+button('Takeout','mm-umkm-takeout','arrow','outlined')+button('Tambah mitra','mm-umkm-partner-new','people','outlined'):'');
  return `${head}
    <div class="notice">${icon('help')}<div><strong>Aturan barang UMKM</strong><p>${esc(UMKM_PRICE_NOTE)} Barang UMKM hanya bertambah lewat <strong>Terima barang</strong> dan diambil kembali lewat <strong>Takeout</strong>: catat dan cetak buktinya dulu, baru serahkan barang. Tidak ada batas waktu titip. Uang penjualan disetor utuh ke Keuangan; Keuangan membayar tiap UMKM sebesar subtotal hak UMKM di Ekspor Penjualan Bulanan.</p></div></div>
    <section class="card mm-section"><div class="card-header"><div><h2>Mitra UMKM</h2><p>Kode mitra menjadi awalan SKU barangnya, misalnya UMKM-KOPI-01.</p></div></div>${table(['Kode','Nama usaha','Pemilik · WhatsApp','Jenis barang','Stok','Status','Tindakan'],partnerRows,'Belum ada mitra UMKM. Tambahkan mitra sebelum menerima barang.')}</section>
    <section class="card mm-section"><div class="card-header"><div><h2>Barang UMKM</h2><p>Stok display dan gudang. Harga UMKM diubah Manager lewat Daftar Barang → Ubah; harga jual ikut dihitung ulang.</p></div></div>${table(['Barang','Mitra',...(costs?['Harga UMKM']:[]),'Harga jual','Display','Gudang','Total'],goodRows,'Belum ada barang UMKM. Gunakan Terima barang.')}</section>
    <section class="card mm-section"><div class="card-header"><div><h2>Tanda terima & takeout</h2><p>Dokumen pada periode terpilih. Pembatalan hanya oleh Manager pada bulan yang sama.</p></div></div><div class="card-body">${filterPeriod()}</div>${table(['Nomor','Tanggal','Mitra','Barang','Status','Tindakan'],docRows,'Belum ada dokumen pada periode ini.')}</section>`;
}
function partnerForm(id){
  const p=id?M.umkm.partners.find(x=>x.id===id):null;
  formDialog(p?'Ubah mitra UMKM':'Tambah mitra UMKM',`
    ${p?`<p class="mm-stock-now"><span class="badge neutral">Kode ${esc(p.code)}</span></p>`:'<label class="field"><span>Kode mitra (2–8 huruf/angka)</span><input name="code" maxlength="8" required pattern="[A-Za-z0-9]{2,8}" placeholder="KOPI" autocapitalize="characters"></label>'}
    <label class="field"><span>Nama usaha</span><input name="name" maxlength="160" required value="${esc(p?.name||'')}"></label>
    <label class="field"><span>Nama pemilik (opsional)</span><input name="owner_name" maxlength="160" value="${esc(p?.owner_name||'')}"></label>
    <label class="field"><span>Nomor WhatsApp (opsional)</span><input name="phone" maxlength="20" inputmode="tel" value="${esc(p?.phone||'')}"></label>
    <label class="field full"><span>Alamat (opsional)</span><input name="address" maxlength="300" value="${esc(p?.address||'')}"></label>
    <label class="field full"><span>Catatan (opsional)</span><textarea name="notes" maxlength="500">${esc(p?.notes||'')}</textarea></label>
    ${p?`<label class="check-field"><input type="checkbox" name="is_active" ${p.is_active?'checked':''}><span>Mitra aktif (bisa menitipkan barang)</span></label>`:''}`,
    async d=>{
      const body={name:d.name,owner_name:d.owner_name,phone:d.phone,address:d.address,notes:d.notes};
      if(p)await patch(`merchandise/umkm/partners/${p.id}`,{...body,is_active:d.is_active,row_version:p.row_version});
      else await post('merchandise/umkm/partners',{...body,code:d.code});
      toast('Data mitra UMKM tersimpan.');refresh();
    },{note:p?'Kode mitra tidak bisa diubah. Rekening tidak disimpan di portal karena pembayaran dilakukan Keuangan.':'Kode mitra tidak bisa diubah setelah disimpan. Rekening tidak disimpan di portal karena pembayaran dilakukan Keuangan.'});
}
const removeLineButton='<div class="full mm-umkm-line-actions"><button type="button" class="button outlined" data-mm-remove-line>Hapus baris</button></div>';
function receiveLine(partnerId){
  const goods=goodsOf(partnerId);
  return `<div class="form-grid mm-umkm-line" data-mm-line>
    <label class="field"><span>Barang</span><select data-mm-item required><option value="">Pilih barang…</option>${goods.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} — ${money(p.sell_price)}</option>`).join('')}<option value="__new"${goods.length?'':' selected'}>+ Barang baru…</option></select></label>
    <label class="field"><span>Jumlah</span><input data-mm-qty type="number" min="1" max="1000000" step="1" value="1" required></label>
    <label class="field"><span>Lokasi</span><select data-mm-location><option value="DISPLAY">Display</option><option value="GUDANG">Gudang</option></select></label>
    <div class="form-grid full mm-umkm-new" data-mm-new${goods.length?' hidden':''}>
      <label class="field"><span>Nama barang baru</span><input data-mm-name maxlength="160"${goods.length?'':' required'}></label>
      <label class="field"><span>Harga UMKM (Rp)</span><input data-mm-cost type="number" min="100" max="100000000" step="1"${goods.length?'':' required'}></label>
      <p class="form-note full" data-mm-preview>${esc(pricePreview(''))}</p>
    </div>${removeLineButton}</div>`;
}
function takeoutLine(partnerId){
  const goods=goodsOf(partnerId,{inStock:true});
  return `<div class="form-grid mm-umkm-line" data-mm-line>
    <label class="field"><span>Barang</span><select data-mm-item required><option value="">Pilih barang…</option>${goods.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} (display ${number(p.stock_qty)} · gudang ${number(p.warehouse_qty)})</option>`).join('')}</select></label>
    <label class="field"><span>Jumlah</span><input data-mm-qty type="number" min="1" max="1000000" step="1" value="1" required></label>
    <label class="field"><span>Diambil dari</span><select data-mm-location><option value="DISPLAY">Display</option><option value="GUDANG">Gudang</option></select></label>
    ${removeLineButton}</div>`;
}
// Baris barang pada dokumen dibaca langsung dari formulir (barang baru punya isian tambahan).
const docItems=form=>[...form.querySelectorAll('[data-mm-line]')].map(line=>{
  const item=line.querySelector('[data-mm-item]').value,quantity=Number(line.querySelector('[data-mm-qty]').value),location=line.querySelector('[data-mm-location]').value;
  return item==='__new'?{name:line.querySelector('[data-mm-name]').value,umkm_price:Number(line.querySelector('[data-mm-cost]').value),quantity,location}:{product_id:item,quantity,location};
});
function bindDocLines(el,lineFor){
  const lines=el.querySelector('[data-mm-lines]'),partner=el.querySelector('[data-mm-partner]');
  partner.addEventListener('change',()=>{lines.innerHTML=lineFor(partner.value);});
  el.querySelector('[data-mm-add-line]').addEventListener('click',()=>lines.insertAdjacentHTML('beforeend',lineFor(partner.value)));
  el.addEventListener('click',e=>{
    const remove=e.target.closest('[data-mm-remove-line]');
    if(remove&&lines.querySelectorAll('[data-mm-line]').length>1)remove.closest('[data-mm-line]').remove();
  });
  el.addEventListener('change',e=>{
    const select=e.target.closest('[data-mm-item]'),box=select?.closest('[data-mm-line]')?.querySelector('[data-mm-new]');
    if(!box)return;
    box.hidden=select.value!=='__new';
    for(const input of box.querySelectorAll('input'))input.required=select.value==='__new';
  });
  el.addEventListener('input',e=>{
    const cost=e.target.closest('[data-mm-cost]');
    if(cost)cost.closest('[data-mm-line]').querySelector('[data-mm-preview]').textContent=pricePreview(cost.value);
  });
}
async function receiveForm(){
  await Promise.all([reloadProducts(),reloadPartners()]);
  const active=M.umkm.partners.filter(isActive);
  if(!active.length){toast('Tambahkan mitra UMKM aktif dulu lewat Tambah mitra.',true);return;}
  const el=formDialog('Terima barang UMKM',`<label class="field"><span>Mitra UMKM</span><select name="partner_id" data-mm-partner required>${partnerOptions(active,active[0].id)}</select></label>
    <label class="field"><span>Nama perwakilan yang menyerahkan</span><input name="counterpart_name" maxlength="120" required></label>
    <div class="full" data-mm-lines>${receiveLine(active[0].id)}</div>
    <div class="full"><button type="button" class="button outlined" data-mm-add-line>${icon('plus')} Tambah barang</button></div>
    <label class="field full"><span>Catatan (opsional)</span><textarea name="note" maxlength="300"></textarea></label>`,
    async(data,form)=>{
      const result=await post('merchandise/umkm/receipts',{partner_id:data.partner_id,counterpart_name:data.counterpart_name,note:data.note,items:docItems(form)});
      toast(`Tanda terima ${result.doc_no} tersimpan.`);refresh();
      printUmkmDoc(result.id).catch(error=>toast(error.message,true));
    },{wide:true,submit:'Simpan & cetak tanda terima',note:UMKM_PRICE_NOTE+' Stok langsung bertambah di lokasi yang dipilih.'});
  bindDocLines(el,receiveLine);
}
async function takeoutForm(){
  await Promise.all([reloadProducts(),reloadPartners()]);
  const partners=M.umkm.partners.filter(p=>goodsOf(p.id,{inStock:true}).length);
  if(!partners.length){toast('Tidak ada barang UMKM yang masih tersisa di stok.',true);return;}
  const el=formDialog('Takeout barang UMKM',`<label class="field"><span>Mitra UMKM</span><select name="partner_id" data-mm-partner required>${partnerOptions(partners,partners[0].id)}</select></label>
    <label class="field"><span>Nama pengambil</span><input name="counterpart_name" maxlength="120" required></label>
    <label class="field"><span>Alasan</span><select name="reason" required>${UMKM_TAKEOUT_REASONS.map(([value,label])=>`<option value="${value}">${esc(label)}</option>`).join('')}</select></label>
    <label class="field"><span>Keterangan (wajib bila alasan Lainnya)</span><input name="note" maxlength="300"></label>
    <div class="full" data-mm-lines>${takeoutLine(partners[0].id)}</div>
    <div class="full"><button type="button" class="button outlined" data-mm-add-line>${icon('plus')} Tambah barang</button></div>`,
    async(data,form)=>{
      const result=await post('merchandise/umkm/takeouts',{partner_id:data.partner_id,counterpart_name:data.counterpart_name,reason:data.reason,note:data.note,items:docItems(form)});
      toast(`Takeout ${result.doc_no} tercatat. Cetak buktinya, lalu serahkan barang.`);refresh();
      printUmkmDoc(result.id).catch(error=>toast(error.message,true));
    },{wide:true,submit:'Simpan & cetak bukti takeout',note:'Catat takeout dan cetak buktinya dulu, baru serahkan barang. Stok langsung berkurang.'});
  bindDocLines(el,takeoutLine);
}
export function umkmDocSheet(doc){
  const receipt=doc.kind==='TERIMA',showCost=doc.items.some(i=>i.unit_cost!==undefined&&i.unit_cost!==null);
  const rows=doc.items.map((i,n)=>`<tr><td>${n+1}</td><td>${esc(i.product_name)}<br><small>${esc(i.sku)}</small></td><td>${esc(locationLabel(i.location))}</td><td>${number(i.quantity)}</td>${showCost?`<td>${money(i.unit_cost)}</td>`:''}<td>${money(i.sell_price)}</td></tr>`).join('');
  const total=doc.items.reduce((n,i)=>n+Number(i.quantity),0),partner=doc.partner||{};
  const blank='( .................................... )';
  return `<div class="pg-sheet mm-umkm-sheet">
    <header class="pg-kop"><img src="/assets/bp-besakih.png" alt="" width="56" height="56"><div><strong>Badan Pengelola Fasilitas Kawasan Suci Pura Agung Besakih</strong><span>Bidang Bisnis · Manik Mas, Desa Besakih, Kec. Rendang, Kab. Karangasem, Bali</span></div></header>
    <h1 class="pg-print-title">${receipt?'Tanda Terima Barang Titipan UMKM':'Bukti Takeout Barang Titipan UMKM'}</h1>
    <p class="pg-center">Nomor: ${esc(doc.doc_no)}${doc.status==='VOID'?` — <strong>DIBATALKAN</strong> (${esc(doc.void_reason||'')})`:''}</p>
    <table class="pg-print-meta"><tr><td>Tanggal</td><td>${esc(formatDate(doc.doc_date))}</td><td>Mitra UMKM</td><td><strong>${esc(partner.name||doc.partner_name||'')}</strong> (${esc(partner.code||doc.partner_code||'')})</td></tr>
      <tr><td>${receipt?'Diserahkan oleh':'Diambil oleh'}</td><td>${esc(doc.counterpart_name)}</td><td>Pemilik</td><td>${esc(partner.owner_name||'—')}${partner.phone?' · '+esc(partner.phone):''}</td></tr>
      ${receipt?'':`<tr><td>Alasan</td><td colspan="3">${esc(umkmReasonLabel(doc.reason))}${doc.note?' — '+esc(doc.note):''}</td></tr>`}
      ${receipt&&doc.note?`<tr><td>Catatan</td><td colspan="3">${esc(doc.note)}</td></tr>`:''}</table>
    <table class="pg-print-table"><thead><tr><th>No</th><th>Barang</th><th>Lokasi</th><th>Jumlah</th>${showCost?'<th>Harga UMKM</th>':''}<th>Harga jual</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td colspan="3">Jumlah barang</td><td>${number(total)}</td><td colspan="${showCost?2:1}"></td></tr></tfoot></table>
    <p class="pg-print-sub">${receipt?`Barang di atas dititipkan untuk dipajang dan dijual oleh Bidang Bisnis. Harga jual = harga UMKM + ${UMKM_MARKUP_PCT}%, dibulatkan. Hak UMKM dibayar Keuangan berdasarkan laporan penjualan bulanan. Barang tetap milik UMKM sampai terjual dan hanya diambil kembali lewat takeout yang tercatat di sistem.`:'Barang di atas diambil kembali dari Bidang Bisnis dan tidak lagi tercatat sebagai stok titipan.'}</p>
    <div class="pg-sign-row"><div class="pg-sign">${receipt?'Yang menyerahkan (UMKM)':'Yang menyerahkan (Bidang Bisnis)'}<div class="pg-sign-space"></div>${receipt?esc(doc.counterpart_name):blank}</div>
      <div class="pg-sign">${receipt?'Yang menerima (Bidang Bisnis)':'Yang menerima (UMKM)'}<div class="pg-sign-space"></div>${receipt?blank:esc(doc.counterpart_name)}</div></div>
  </div>`;
}
function printSheet(el){
  const sheetEl=el.querySelector('.pg-sheet');if(!sheetEl)return;
  let root=document.querySelector('#pg-print-root');if(!root){root=document.createElement('div');root.id='pg-print-root';document.body.append(root);}
  root.innerHTML=sheetEl.outerHTML;document.body.classList.add('pg-printing');
  const done=()=>{document.body.classList.remove('pg-printing');root.innerHTML='';window.removeEventListener('afterprint',done);};
  window.addEventListener('afterprint',done);window.print();setTimeout(done,60000);
}
async function printUmkmDoc(id){
  const doc=await api(`merchandise/umkm/docs/${id}`);
  const el=dialog(`${doc.kind==='TERIMA'?'Tanda terima':'Bukti takeout'} ${doc.doc_no}`,`<div class="actions no-print">${button('Cetak / simpan PDF','mm-print-now','download')}</div>${umkmDocSheet(doc)}`,{wide:true});
  el.addEventListener('click',e=>{if(e.target.closest('[data-action=mm-print-now]'))printSheet(el);});
}
function voidUmkmDoc(id){
  const doc=M.umkm.docs.find(d=>d.id===id);if(!doc)return;
  formDialog('Batalkan '+doc.doc_no,`<label class="field full"><span>Alasan pembatalan</span><textarea name="reason" maxlength="300" required></textarea></label>`,
    async d=>{await post(`merchandise/umkm/docs/${id}/void`,{reason:d.reason,row_version:doc.row_version});toast('Dokumen dibatalkan dan stok disesuaikan.');refresh();},
    {note:doc.kind==='TERIMA'?'Stok dari tanda terima ini dikurangi lagi. Ditolak bila sebagian barangnya sudah terjual atau di-takeout.':'Barang yang di-takeout dikembalikan ke stok titipan.'});
}

export function bindMerchandisePage(){
  const root=document.querySelector('#main');if(!root||root.dataset.mmBound)return;root.dataset.mmBound='1';
  root.addEventListener('click',async e=>{
    if(!merchandiseRoutes.includes(state.route))return;
    const b=e.target.closest('[data-action]');if(!b)return;
    const id=b.dataset.id,action=b.dataset.action;
    if(!action?.startsWith('mm-'))return;
    e.stopPropagation();
    try{
      if(action==='mm-sale')await saleForm();
      if(action==='mm-stock')await changeStock(id);
      if(action==='mm-new'||action==='mm-edit')await productForm(id);
      if(action==='mm-void')voidSale(id);
      if(action==='mm-low-stock')await showLowStock();
      if(action==='mm-display-refill')await showDisplayRefill();
      if(action==='mm-export')await exportReport();
      if(action==='mm-export-monthly')await exportMonthlyReport();
      if(action==='mm-export-sales-monthly')await exportSalesMonthlyReport();
      if(action==='mm-umkm-receive')await receiveForm();
      if(action==='mm-umkm-takeout')await takeoutForm();
      if(action==='mm-umkm-partner-new')partnerForm();
      if(action==='mm-umkm-partner-edit')partnerForm(id);
      if(action==='mm-umkm-print')await printUmkmDoc(id);
      if(action==='mm-umkm-void')voidUmkmDoc(id);
      if(action==='mm-filter'){
        const from=root.querySelector('[data-mm-date=from]')?.value,to=root.querySelector('[data-mm-date=to]')?.value;
        if(from>to)throw new Error('Tanggal awal harus sebelum tanggal akhir.');
        M.from=from;M.to=to;refresh();
      }
    }catch(error){toast(error.message,true);}
  });
  root.addEventListener('input',e=>{
    if(!merchandiseRoutes.includes(state.route)||!e.target.matches('[data-mm-search]'))return;
    M.query=e.target.value;const cursor=e.target.selectionStart;
    root.innerHTML=products();const input=root.querySelector('[data-mm-search]');input?.focus();input?.setSelectionRange(cursor,cursor);
  });
  root.addEventListener('change',e=>{
    if(!merchandiseRoutes.includes(state.route)||!e.target.matches('[data-mm-owner]'))return;
    M.owner=e.target.value;root.innerHTML=products();root.querySelector('[data-mm-owner]')?.focus();
  });
  root.addEventListener('change',async e=>{
    if(!allowed('merchandise.reports.export')||!e.target.matches('[data-mm-sales-template]'))return;
    M.salesArtwork=null;M.salesTemplateName='';
    const file=e.target.files?.[0],status=root.querySelector('[data-mm-template-status]');
    if(!file){if(status)status.textContent='Pilih file Excel acuan penjualan.';return;}
    if(status)status.textContent='Membaca format Excel…';
    try{
      const {loadMerchandiseSalesArtwork}=await import(exportModuleURL('merchandise-sales-artwork.js'));
      const artwork=await loadMerchandiseSalesArtwork(file);
      if(e.target.files?.[0]!==file)return;
      M.salesArtwork=artwork;M.salesTemplateName=file.name;
      if(status)status.textContent='Template siap: '+file.name;
      toast('Format kop dan tanda tangan siap digunakan.');
    }catch(error){if(e.target.files?.[0]!==file)return;if(status)status.textContent=error.message;toast(error.message,true);}
  });
}
