import {state,api,post,patch,refresh} from './api.js';
import {esc,icon,button,formDialog,toast,number,localToday,formatDate} from './ui.js';
import {createXlsx} from './xlsx-export.js';

export const merchandiseTitles={
  merchandise:'Beranda Merchandise',
  'merchandise-products':'Daftar Merchandise',
  'merchandise-sales':'Penjualan Merchandise',
  'merchandise-stock':'Mutasi Stok Merchandise',
  'merchandise-reports':'Laporan Penjualan Merchandise'
};
export const merchandiseRoutes=Object.keys(merchandiseTitles);
export const merchandiseNav=[
  ['merchandise','Beranda','dashboard','merchandise.catalog.read'],
  ['merchandise-products','Daftar Barang','folder','merchandise.catalog.read'],
  ['merchandise-sales','Penjualan','building','merchandise.sales.read'],
  ['merchandise-stock','Stok Barang','log','merchandise.stock.read'],
  ['merchandise-reports','Laporan','filter','merchandise.reports.read']
];
const M={products:[],sales:[],movements:[],overview:null,report:null,query:'',from:localToday().slice(0,7)+'-01',to:localToday()};
const allowed=code=>state.permissions.includes(code);
const money=n=>'Rp'+number(n);
const pageHead=(title,subtitle,actions='')=>`<div class="page-heading"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="actions">${actions}</div></div>`;
const table=(heads,rows,empty='Belum ada data')=>rows.length?`<div class="table-wrap"><table><thead><tr>${heads.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`:`<section class="card"><div class="card-body"><p class="muted">${esc(empty)}</p></div></section>`;
const actions=(name,action,ico='plus')=>button(name,action,ico,'primary');
function stat(title,value,detail){return `<section class="stat-card"><div class="stat-top"><span>${esc(title)}</span></div><div class="stat-value">${esc(String(value))}</div><div class="stat-bottom"><span>${esc(detail)}</span></div></section>`;}
function filterPeriod(){return `<div class="toolbar"><label class="field"><span>Dari</span><input type="date" data-mm-date="from" value="${M.from}"></label><label class="field"><span>Sampai</span><input type="date" data-mm-date="to" value="${M.to}"></label>${button('Terapkan periode','mm-filter','filter','outlined')}</div>`;}
function home(){
  const r=M.overview;
  return `${pageHead('Merchandise','Ringkasan penjualan dan ketersediaan barang Bidang Bisnis.',r.capabilities.sales_create?actions('Catat Penjualan','mm-sale'): '')}
    <div class="stats-grid">${stat('Jenis barang',r.products_total,'Terdaftar dalam katalog')}${stat('Belum input stok',r.products_uninitialized,'Perlu opname awal')}${stat('Stok 5 atau kurang',r.products_low,'Termasuk stok kosong')}${r.capabilities.reports?stat('Omzet bulan ini',money(r.revenue),'Transaksi selesai'):''}</div>
    ${r.products_uninitialized?`<div class="notice warning">${icon('incident')}<div><strong>Stok awal belum lengkap</strong><p>Barang yang belum dihitung tidak dapat dijual sampai petugas mengisi stok awalnya.</p></div></div>`:''}
    <section class="card"><div class="card-body"><p>Gunakan <strong>Daftar Barang</strong> untuk mengatur harga dan mencatat stok awal. Transaksi penjualan langsung mengurangi stok; pembatalan memerlukan kewenangan manager.</p></div></section>`;
}
function products(){
  const c=M.overview.capabilities,rows=M.products.filter(p=>p.name.toLowerCase().includes(M.query.toLowerCase())||p.sku.toLowerCase().includes(M.query.toLowerCase())).map(p=>`<tr>
    <td><strong>${esc(p.name)}</strong><small class="muted pg-block">${esc(p.sku)}</small></td>
    <td class="nowrap">${money(p.sell_price)}</td>
    ${c.costs?`<td class="nowrap">${money(p.buy_price)}</td>`:''}
    <td>${p.stock_qty===null?'<span class="badge warm">Belum dihitung</span>':number(p.stock_qty)}</td>
    <td>${p.is_active?'<span class="badge positive">Aktif</span>':'<span class="badge neutral">Nonaktif</span>'}</td>
    <td class="nowrap"><div class="actions">${c.stock_record?button('Stok','mm-stock','plus','outlined',`data-id="${esc(p.id)}"`):''}${c.catalog_manage?button('Ubah','mm-edit','edit','outlined',`data-id="${esc(p.id)}"`):''}</div></td></tr>`);
  return `${pageHead('Daftar Merchandise','Katalog dan harga barang dari daftar Bidang Bisnis.',c.catalog_manage?actions('Tambah Barang','mm-new'): '')}
    <div class="toolbar"><label class="field"><span>Cari barang</span><input data-mm-search placeholder="Nama barang atau SKU" value="${esc(M.query)}"></label></div>
    <section class="card">${table(['Barang','Harga jual',...(c.costs?['Harga beli']:[]),'Stok','Status','Tindakan'],rows,'Barang tidak ditemukan.')}</section>`;
}
function sales(){
  const r=M.sales.map(s=>`<tr><td><strong>${esc(s.sale_no)}</strong><small class="muted pg-block">${esc(s.payment_method)}</small></td><td class="nowrap">${formatDate(s.sold_on)}</td><td>${s.items.map(i=>`${esc(i.product_name)} × ${number(i.quantity)}`).join('<br>')}</td><td>${money(s.total)}</td><td>${s.status==='VOID'?'<span class="badge negative">Batal</span>':'<span class="badge positive">Selesai</span>'}</td><td>${M.overview.capabilities.sales_void&&s.status==='COMPLETED'?button('Batalkan','mm-void','trash','outlined',`data-id="${esc(s.id)}"`):''}</td></tr>`);
  return `${pageHead('Transaksi Penjualan','Setiap transaksi menyimpan harga saat penjualan dan mengurangi stok.',allowed('merchandise.sales.create')?actions('Transaksi Baru','mm-sale'): '')}
  ${filterPeriod()}<section class="card">${table(['Nomor','Tanggal','Barang','Total','Status','Tindakan'],r,'Belum ada transaksi pada periode ini.')}</section>`;
}
function stock(){
  const rows=M.movements.map(r=>`<tr><td class="nowrap">${formatDate(r.created_at)}</td><td>${esc(r.product_name)}<small class="muted pg-block">${esc(r.sku)}</small></td><td>${esc({INITIAL:'Stok awal',IN:'Barang masuk',ADJUST:'Koreksi',SALE:'Terjual',VOID:'Pengembalian'}[r.kind]||r.kind)}</td><td>${r.quantity_delta>0?'+':''}${number(r.quantity_delta)}</td><td>${number(r.balance_after)}</td><td>${esc(r.reason)}</td><td>${esc(r.actor_name||'')}</td></tr>`);
  return `${pageHead('Riwayat Stok','Semua stok awal, penerimaan, penjualan, dan koreksi tercatat.')}${table(['Waktu','Barang','Jenis','Perubahan','Saldo','Alasan','Petugas'],rows,'Belum ada mutasi stok.')}`;
}
function reports(){
  const r=M.report,summary=r.summary,canCost=allowed('merchandise.catalog.costs');
  return `${pageHead('Laporan Merchandise','Ringkasan penjualan berdasarkan tanggal dan ekspor Excel.',allowed('merchandise.reports.export')?button('Ekspor Excel','mm-export','download','primary'): '')}${filterPeriod()}
    <div class="stats-grid">${stat('Omzet',money(summary.revenue),'Transaksi selesai')}${stat('Transaksi',summary.transaction_count,'Di periode terpilih')}${stat('Barang terjual',summary.units_sold,'Satuan merchandise')}${canCost?stat('Laba kotor',money(summary.revenue-summary.cost),'Dari harga beli snapshot'):''}</div>
    <section class="card">${table(['Transaksi','Barang','Qty','Harga satuan','Subtotal'],r.sales.filter(s=>s.status==='COMPLETED').flatMap(s=>s.items.map(i=>`<tr><td>${esc(s.sale_no)}</td><td>${esc(i.product_name)}</td><td>${number(i.quantity)}</td><td>${money(i.unit_price)}</td><td>${money(i.subtotal)}</td></tr>`)),'Belum ada penjualan pada periode ini.')}</section>`;
}
export async function loadMerchandisePage(route){
  M.overview=await api('merchandise/overview');
  if(route==='merchandise')return home();
  if(route==='merchandise-products'){M.products=(await api('merchandise/products')).items;return products();}
  if(route==='merchandise-sales'){M.sales=(await api(`merchandise/sales?from=${M.from}&to=${M.to}`)).items;return sales();}
  if(route==='merchandise-stock'){M.movements=(await api('merchandise/stock')).items;return stock();}
  if(route==='merchandise-reports'){M.report=await api(`merchandise/reports?from=${M.from}&to=${M.to}`);return reports();}
  return '';
}
const selected=id=>M.products.find(p=>p.id===id);
async function reloadProducts(){M.products=(await api('merchandise/products')).items;}
async function changeStock(id){
  await reloadProducts();const p=selected(id);if(!p)return;
  const types=p.stock_qty===null?'<option value="INITIAL">Stok awal</option>':`<option value="IN">Barang masuk</option>${allowed('merchandise.stock.adjust')?'<option value="ADJUST">Koreksi saldo stok</option>':''}`;
  formDialog('Catat stok: '+p.name,`<label class="field"><span>Jenis</span><select name="kind">${types}</select></label>
    <label class="field"><span>Jumlah / saldo baru</span><input name="quantity" type="number" step="1" min="0" max="1000000" required></label>
    <label class="field full"><span>Alasan / dokumen penerimaan</span><textarea name="reason" maxlength="300" required></textarea></label>`,
    async data=>{await post(`merchandise/products/${id}/stock`,{...data,quantity:Number(data.quantity),row_version:p.row_version});toast('Stok berhasil dicatat.');refresh();},
    {note:p.stock_qty===null?'Masukkan jumlah fisik berdasarkan hasil penghitungan pertama.':`Stok saat ini: ${p.stock_qty}. Koreksi mengisi saldo akhir, barang masuk menambah saldo.`});
}
async function productForm(id){
  await reloadProducts();const p=id?selected(id):null;
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
    });
}
async function saleForm(){
  await reloadProducts();const available=M.products.filter(p=>p.is_active&&p.stock_qty!==null&&p.stock_qty>0);
  if(!available.length){toast('Belum ada barang dengan stok siap dijual.',true);return;}
  const options=available.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} — ${money(p.sell_price)} (stok ${number(p.stock_qty)})</option>`).join('');
  const fields=`<div class="full" data-mm-lines><div class="form-grid" data-mm-line><label class="field"><span>Barang</span><select name="product_id[]" required>${options}</select></label><label class="field"><span>Jumlah</span><input name="quantity[]" type="number" min="1" max="10000" value="1" required></label></div></div>
    <div class="full"><button type="button" class="button outlined" data-mm-add-line>${icon('plus')} Tambah barang</button></div>
    <label class="field"><span>Pembayaran</span><select name="payment_method"><option>TUNAI</option><option>QRIS</option><option>TRANSFER</option><option>LAINNYA</option></select></label>
    <label class="field full"><span>Catatan (opsional)</span><textarea name="note" maxlength="300"></textarea></label>`;
  const el=formDialog('Catat Penjualan',fields,async(_,form)=>{
    const ids=[...form.querySelectorAll('[name="product_id[]"]')].map(x=>x.value),quantities=[...form.querySelectorAll('[name="quantity[]"]')].map(x=>Number(x.value));
    const result=await post('merchandise/sales',{payment_method:form.querySelector('[name=payment_method]').value,note:form.querySelector('[name=note]').value,items:ids.map((product_id,i)=>({product_id,quantity:quantities[i]}))});
    toast(`Transaksi ${result.sale_no} tersimpan (${money(result.total)}).`);refresh();
  },{wide:true,submit:'Simpan penjualan',note:'Harga mengikuti katalog. Stok akan langsung berkurang saat transaksi tersimpan.'});
  el.querySelector('[data-mm-add-line]').addEventListener('click',()=>el.querySelector('[data-mm-lines]').insertAdjacentHTML('beforeend',`<div class="form-grid" data-mm-line><label class="field"><span>Barang</span><select name="product_id[]" required>${options}</select></label><label class="field"><span>Jumlah</span><input name="quantity[]" type="number" min="1" max="10000" value="1" required></label></div>`));
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
async function exportReport(){
  if(!allowed('merchandise.reports.export'))return;
  const r=M.report,columns=[
    {key:'date',header:'Tanggal',kind:'date'},{key:'number',header:'Nomor transaksi'},{key:'method',header:'Pembayaran'},
    {key:'sku',header:'SKU'},{key:'product',header:'Nama barang'},{key:'qty',header:'Qty',kind:'number'},
    {key:'price',header:'Harga jual',kind:'number'},{key:'subtotal',header:'Subtotal',kind:'number'}];
  if(allowed('merchandise.catalog.costs'))columns.push({key:'cost',header:'Harga beli',kind:'number'},{key:'margin',header:'Laba kotor',kind:'number'});
  const rows=r.sales.filter(s=>s.status==='COMPLETED').flatMap(s=>s.items.map(i=>({date:s.sold_on,number:s.sale_no,method:s.payment_method,sku:i.sku,product:i.product_name,qty:i.quantity,price:i.unit_price,subtotal:i.subtotal,...(allowed('merchandise.catalog.costs')?{cost:i.unit_cost,margin:i.subtotal-i.unit_cost*i.quantity}:{})})));
  const workbook=createXlsx([
    {name:'Penjualan',columns,rows},
    {name:'Stok',columns:[{key:'sku',header:'SKU'},{key:'name',header:'Barang'},{key:'qty',header:'Stok saat ini',kind:'number'},{key:'price',header:'Harga jual',kind:'number'}],rows:r.stock.map(p=>({sku:p.sku,name:p.name,qty:p.stock_qty,price:p.sell_price}))},
    {name:'Mutasi Stok',columns:[{key:'date',header:'Waktu',kind:'datetime'},{key:'sku',header:'SKU'},{key:'name',header:'Barang'},{key:'kind',header:'Jenis'},{key:'delta',header:'Perubahan',kind:'number'},{key:'balance',header:'Saldo akhir',kind:'number'},{key:'reason',header:'Alasan'}],rows:r.movements.map(m=>({date:m.created_at,sku:m.sku,name:m.product_name,kind:m.kind,delta:m.quantity_delta,balance:m.balance_after,reason:m.reason}))}
  ]);
  await post('merchandise/reports/export',{period:`${M.from}/${M.to}`});
  saveBlob(workbook,`laporan-merchandise-${M.from}-${M.to}.xlsx`);
  toast('Laporan Excel siap diunduh.');
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
      if(action==='mm-export')await exportReport();
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
}
