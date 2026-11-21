import {all,one,get,insert,update,tx,audit,assert,text,integer,enumValue,today,now,uid,date} from './db.mjs';
import {has,requireAccess} from './auth.mjs';

const price=value=>integer(value,'Harga (rupiah)',0,1000000000);
const qty=value=>integer(value,'Jumlah barang',0,1000000);
// Stok per barang ada di dua tempat: DISPLAY (stock_qty, tempat barang dijual; stok
// lama sebelum pemisahan adalah stok display) dan GUDANG (warehouse_qty). NULL berarti
// belum pernah dihitung, berbeda dari 0.
const productFields='id,sku,name,buy_price,sell_price,stock_qty,warehouse_qty,is_active,row_version';
const LOCATIONS=['DISPLAY','GUDANG'];
const stockColumn=location=>location==='GUDANG'?'warehouse_qty':'stock_qty';
const PAYMENT_METHODS=['TUNAI','QRIS','TRANSFER','CARD','LAINNYA'];
const LOW_STOCK=5,STOCK_EXPORT_LIMIT=10000;
const isActive=row=>row.is_active===1||row.is_active===true;
const visibleProduct=(row,costs)=>costs?row:(({buy_price,...rest})=>rest)(row);
const saleItems=(db,id)=>all(db,'SELECT * FROM merchandise_sale_items WHERE sale_id=? ORDER BY created_at,id',id);
const canCosts=(db,user)=>has(db,user,'merchandise.catalog.costs');
const stockHistory='SELECT m.*,p.sku,p.name product_name,u.username actor_name FROM merchandise_stock_movements m JOIN merchandise_products p ON p.id=m.product_id JOIN users u ON u.id=m.created_by';

function movementsSince(db,from){
  const midnight=new Date(`${from}T00:00:00+08:00`).toISOString();
  return all(db,`${stockHistory} WHERE m.created_at>=? ORDER BY m.created_at DESC,m.id DESC LIMIT ${STOCK_EXPORT_LIMIT}`,midnight);
}

function reportedPayment(sale){
  // Arsip impor memakai penanda eksplisit saat CARD belum tersedia di formulir.
  const legacy=sale.sold_on>='2026-11-01'&&sale.sold_on<='2026-11-07'&&sale.payment_method==='LAINNYA';
  return legacy&&/(?:^|;)\s*pembayaran CARD \(kategori lainnya\)(?=\s*(?:[.;]|$))/i.test(sale.note||'')?'CARD':sale.payment_method;
}

// Satu pembaruan baris barang untuk semua lokasi yang berubah, lalu satu baris riwayat
// per lokasi. Perubahan berisi {location, delta} atau {location, target} (saldo baru).
function applyStock(db,user,product,kind,changes,reason,saleId=null){
  const balance={DISPLAY:product.stock_qty,GUDANG:product.warehouse_qty},values={},rows=[];
  for(const change of changes){
    const before=balance[change.location],setsBalance=change.target!==undefined;
    assert(setsBalance||before!==null,'Stok belum dihitung.',409);
    const after=setsBalance?change.target:before+change.delta;
    assert(Number.isSafeInteger(after)&&after>=0&&after<=1000000,'Stok tidak cukup atau jumlah melebihi batas.',409);
    balance[change.location]=after;values[stockColumn(change.location)]=after;
    rows.push({location:change.location,delta:setsBalance?(before===null?after:after-before):change.delta,before,after});
  }
  update(db,'merchandise_products',product.id,product.row_version,values);
  const saved=[];
  for(const row of rows)saved.push(insert(db,'merchandise_stock_movements',{
    product_id:product.id,sale_id:saleId,kind,location:row.location,quantity_delta:row.delta,
    balance_before:row.before,balance_after:row.after,reason,created_by:user.id
  }));
  return saved;
}
function productList(db,user){
  const costs=canCosts(db,user);
  return all(db,`SELECT ${productFields} FROM merchandise_products ORDER BY sku`).map(p=>visibleProduct(p,costs));
}
function saleList(db,user,from,to){
  const costs=canCosts(db,user);
  const rows=all(db,'SELECT * FROM merchandise_sales WHERE sold_on>=? AND sold_on<=? ORDER BY created_at DESC,id DESC',from,to);
  return rows.map(r=>({
    ...r,payment_method:reportedPayment(r),...(!costs?{cost_total:undefined}:{}),
    items:saleItems(db,r.id).map(item=>costs?item:(({unit_cost,...rest})=>rest)(item))
  }));
}
function dateRange(url){
  const todayValue=today();
  const from=date(url.searchParams.get('from')||`${todayValue.slice(0,7)}-01`);
  const to=date(url.searchParams.get('to')||todayValue);
  assert(from<=to,'Tanggal awal harus lebih dahulu daripada tanggal akhir.');
  return {from,to};
}
function totals(sales){
  const active=sales.filter(s=>s.status==='COMPLETED');
  return {
    transaction_count:active.length,
    units_sold:active.flatMap(s=>s.items).reduce((n,i)=>n+Number(i.quantity),0),
    revenue:active.reduce((n,s)=>n+Number(s.total),0),
    cost:active.reduce((n,s)=>n+Number(s.cost_total||0),0)
  };
}

export function merchandiseRoutes(c){
  const {db,user,p,method,body:b={},url}=c;
  if(p[0]!=='merchandise')return undefined;
  const part=p[1],id=p[2],action=p[3];
  if(method==='GET'&&(!part||part==='overview')){
    requireAccess(db,user,'merchandise.catalog.read');
    const products=productList(db,user),{from,to}=dateRange(url),sales=has(db,user,'merchandise.reports.read')?saleList(db,user,from,to):[];
    const summary=totals(sales);
    return {products_total:products.length,products_uninitialized:products.filter(r=>r.stock_qty===null).length,
      // Perlu restock: total display + gudang 5 atau kurang (gudang belum dihitung = 0).
      products_low:products.filter(r=>r.stock_qty!==null&&r.stock_qty+(r.warehouse_qty??0)<=LOW_STOCK).length,
      // Perlu diisi dari gudang: display 5 atau kurang padahal gudang masih ada.
      products_display_low:products.filter(r=>isActive(r)&&r.stock_qty!==null&&r.stock_qty<=LOW_STOCK&&r.warehouse_qty>0).length,
      products_warehouse_uncounted:products.filter(r=>isActive(r)&&r.warehouse_qty===null).length,
      ...summary,...(!canCosts(db,user)?{cost:undefined}:{}),
      capabilities:{
        catalog_manage:has(db,user,'merchandise.catalog.manage'),
        costs:canCosts(db,user),
        stock_record:has(db,user,'merchandise.stock.record'),
        stock_adjust:has(db,user,'merchandise.stock.adjust'),
        sales_create:has(db,user,'merchandise.sales.create'),
        sales_void:has(db,user,'merchandise.sales.void'),
        reports:has(db,user,'merchandise.reports.read'),
        export:has(db,user,'merchandise.reports.export')
      }};
  }
  if(part==='products'&&method==='GET'&&!id){
    requireAccess(db,user,'merchandise.catalog.read');
    return {items:productList(db,user)};
  }
  if(part==='products'&&method==='POST'&&!id){
    requireAccess(db,user,'merchandise.catalog.manage');
    const sku=text(b.sku,'SKU',40).toUpperCase(),name=text(b.name,'Nama barang',160);
    assert(/^[A-Z0-9-]+$/.test(sku),'SKU hanya boleh huruf, angka, dan tanda hubung.');
    return tx(db,()=>{
      assert(!one(db,'SELECT id FROM merchandise_products WHERE sku=?',sku),'Kode barang sudah dipakai.',409);
      const saved=insert(db,'merchandise_products',{sku,name,buy_price:price(b.buy_price),sell_price:price(b.sell_price),stock_qty:null,warehouse_qty:null,is_active:1,created_by:user.id});
      audit(db,user,'CREATE','merchandise_products',saved.id,{sku});
      return visibleProduct(saved,canCosts(db,user));
    });
  }
  if(part==='products'&&id&&method==='PATCH'&&!action){
    requireAccess(db,user,'merchandise.catalog.manage');
    return tx(db,()=>{
      const old=get(db,'merchandise_products',id);
      const values={};
      if(b.name!==undefined)values.name=text(b.name,'Nama barang',160);
      if(b.sell_price!==undefined)values.sell_price=price(b.sell_price);
      if(b.buy_price!==undefined)values.buy_price=price(b.buy_price);
      if(b.is_active!==undefined){assert(typeof b.is_active==='boolean','Status barang tidak valid.');values.is_active=Number(b.is_active);}
      assert(Object.keys(values).length,'Tidak ada perubahan.');
      const saved=update(db,'merchandise_products',id,b.row_version,values);
      audit(db,user,'UPDATE','merchandise_products',id,{fields:Object.keys(values)});
      return visibleProduct(saved,canCosts(db,user));
    });
  }
  if(part==='products'&&id&&action==='stock'&&method==='POST'){
    requireAccess(db,user,'merchandise.stock.record');
    const kind=enumValue(b.kind,['INITIAL','IN','ADJUST','TRANSFER'],'Jenis mutasi stok');
    // Tanpa lokasi berarti DISPLAY, sehingga kiriman tampilan lama tetap bermakna sama.
    // Untuk TRANSFER, lokasi adalah tujuan: DISPLAY = pindah dari gudang ke display.
    const location=b.location===undefined||b.location===null?'DISPLAY':enumValue(b.location,LOCATIONS,'Lokasi stok');
    if(kind==='ADJUST')requireAccess(db,user,'merchandise.stock.adjust');
    const amount=qty(b.quantity),reason=text(b.reason,'Alasan perubahan stok',300);
    const warehouseStart=kind==='INITIAL'&&location==='DISPLAY'&&b.warehouse_quantity!==undefined&&b.warehouse_quantity!==null&&b.warehouse_quantity!==''?qty(b.warehouse_quantity):null;
    return tx(db,()=>{
      const product=get(db,'merchandise_products',id);
      assert(product.row_version===b.row_version,'Stok berubah. Muat ulang daftar barang.',409);
      const current=product[stockColumn(location)],source=location==='GUDANG'?'DISPLAY':'GUDANG';
      let changes;
      if(kind==='INITIAL'){
        assert(current===null,location==='GUDANG'?'Stok awal gudang sudah dicatat. Gunakan barang masuk, pindah stok, atau koreksi.':'Stok awal sudah dicatat. Gunakan barang masuk atau penyesuaian.',409);
        changes=[{location,target:amount}];
        if(warehouseStart!==null){
          assert(product.warehouse_qty===null,'Stok awal gudang sudah dicatat.',409);
          changes.push({location:'GUDANG',target:warehouseStart});
        }
      }else if(kind==='TRANSFER'){
        assert(product.stock_qty!==null,'Masukkan stok awal terlebih dahulu.',409);
        assert(product.warehouse_qty!==null,'Hitung stok awal gudang terlebih dahulu.',409);
        assert(amount>0,'Jumlah barang yang dipindah harus lebih dari nol.');
        const available=product[stockColumn(source)];
        assert(available>=amount,`Stok ${source==='GUDANG'?'gudang':'display'} ${product.name} hanya ${available}.`,409);
        changes=[{location:source,delta:-amount},{location,delta:amount}];
      }else{
        assert(current!==null,location==='GUDANG'?'Hitung stok awal gudang terlebih dahulu.':'Masukkan stok awal terlebih dahulu.',409);
        assert(kind!=='IN'||amount>0,'Jumlah barang masuk harus lebih dari nol.');
        changes=[kind==='IN'?{location,delta:amount}:{location,target:amount}];
      }
      const moved=applyStock(db,user,product,kind,changes,reason);
      audit(db,user,'STOCK_'+kind,'merchandise_products',id,{changes:moved.map(m=>({location:m.location,before:m.balance_before,after:m.balance_after})),reason});
      const after=Object.fromEntries(moved.map(m=>[stockColumn(m.location),m.balance_after]));
      return {ok:true,stock_qty:after.stock_qty??product.stock_qty,warehouse_qty:after.warehouse_qty??product.warehouse_qty,row_version:product.row_version+1};
    });
  }
  if(part==='stock'&&method==='GET'){
    requireAccess(db,user,'merchandise.stock.read');
    const since=url.searchParams.get('from');
    if(!since)return {items:all(db,`${stockHistory} ORDER BY m.created_at DESC,m.id DESC LIMIT 2000`)};
    // Ekspor bulanan: semua mutasi sejak pukul 00.00 WITA tanggal awal periode.
    const from=date(since);
    return {from,limit:STOCK_EXPORT_LIMIT,items:movementsSince(db,from)};
  }
  if(part==='stock-export'&&!id&&method==='GET'){
    requireAccess(db,user,'merchandise.reports.read');
    requireAccess(db,user,'merchandise.reports.export');
    requireAccess(db,user,'merchandise.stock.read');
    const {from,to}=dateRange(url);
    return tx(db,()=>({from,to,stock:productList(db,user),sales:saleList(db,user,from,to),movements:movementsSince(db,from)}));
  }
  if(part==='sales'&&method==='GET'&&!id){
    requireAccess(db,user,'merchandise.sales.read');
    const {from,to}=dateRange(url);
    return {items:saleList(db,user,from,to),from,to};
  }
  if(part==='sales'&&method==='POST'&&!id){
    requireAccess(db,user,'merchandise.sales.create');
    assert(Array.isArray(b.items)&&b.items.length>0&&b.items.length<=50,'Pilih 1–50 barang dalam transaksi.');
    const items=b.items.map(i=>({product_id:text(i.product_id,'ID barang',64),quantity:integer(i.quantity,'Jumlah beli',1,10000)}));
    assert(new Set(items.map(i=>i.product_id)).size===items.length,'Barang yang sama tidak boleh dimasukkan dua kali.');
    const payment=enumValue(b.payment_method,PAYMENT_METHODS,'Metode pembayaran');
    const note=b.note?text(b.note,'Catatan',300):null;
    return tx(db,()=>{
      const snapshot=items.map(item=>{
        const product=get(db,'merchandise_products',item.product_id);
        assert(product.is_active===1,'Barang tidak aktif.',409);
        assert(product.stock_qty!==null,'Stok awal barang belum diisi.',409);
        // Penjualan hanya dari display; barang di gudang dipindahkan dulu.
        assert(product.stock_qty>=item.quantity,product.warehouse_qty>0
          ?`Stok display ${product.name} tidak mencukupi (tersisa ${product.stock_qty}). Gudang masih ${product.warehouse_qty}: catat "Pindah ke display" dulu.`
          :`Stok ${product.name} tidak mencukupi.`,409);
        return {...item,product,subtotal:item.quantity*product.sell_price,cost_total:item.quantity*product.buy_price};
      });
      const total=snapshot.reduce((n,item)=>n+item.subtotal,0);
      const costTotal=snapshot.reduce((n,item)=>n+item.cost_total,0);
      assert(Number.isSafeInteger(total)&&Number.isSafeInteger(costTotal),'Total transaksi tidak valid.');
      const soldOn=today(),saleNo=`MR-${soldOn.replaceAll('-','')}-${uid().slice(0,8).toUpperCase()}`;
      const sale=insert(db,'merchandise_sales',{sale_no:saleNo,sold_on:soldOn,payment_method:payment,status:'COMPLETED',total,cost_total:costTotal,note,created_by:user.id});
      for(const item of snapshot){
        insert(db,'merchandise_sale_items',{sale_id:sale.id,product_id:item.product.id,sku:item.product.sku,product_name:item.product.name,quantity:item.quantity,unit_price:item.product.sell_price,unit_cost:item.product.buy_price,subtotal:item.subtotal});
        applyStock(db,user,item.product,'SALE',[{location:'DISPLAY',delta:-item.quantity}],`Penjualan ${saleNo}`,sale.id);
      }
      audit(db,user,'SALE','merchandise_sales',sale.id,{sale_no:saleNo,total,item_count:items.length});
      return {id:sale.id,sale_no:saleNo,total,sold_on:soldOn};
    });
  }
  if(part==='sales'&&id&&action==='void'&&method==='POST'){
    requireAccess(db,user,'merchandise.sales.void');
    const reason=text(b.reason,'Alasan pembatalan',300);
    return tx(db,()=>{
      const sale=get(db,'merchandise_sales',id);
      assert(sale.status==='COMPLETED','Transaksi sudah dibatalkan.',409);
      assert(sale.row_version===b.row_version,'Transaksi berubah. Muat ulang.',409);
      for(const item of saleItems(db,id)){
        const product=get(db,'merchandise_products',item.product_id);
        applyStock(db,user,product,'VOID',[{location:'DISPLAY',delta:item.quantity}],`Pembatalan ${sale.sale_no}: ${reason}`,sale.id);
      }
      const updated=update(db,'merchandise_sales',id,b.row_version,{status:'VOID',void_reason:reason,voided_at:now(),voided_by:user.id});
      audit(db,user,'VOID','merchandise_sales',id,{sale_no:sale.sale_no,reason});
      return {ok:true,status:updated.status};
    });
  }
  if(part==='reports'&&method==='GET'){
    requireAccess(db,user,'merchandise.reports.read');
    const {from,to}=dateRange(url),sales=saleList(db,user,from,to);
    const summary=totals(sales),costs=canCosts(db,user);
    return {from,to,summary:costs?summary:(({cost,...rest})=>rest)(summary),sales,
      stock:productList(db,user),
      movements:has(db,user,'merchandise.stock.read')?
        all(db,'SELECT m.*,p.sku,p.name product_name FROM merchandise_stock_movements m JOIN merchandise_products p ON p.id=m.product_id WHERE substr(m.created_at,1,10)>=? AND substr(m.created_at,1,10)<=? ORDER BY m.created_at DESC',from,to):[]};
  }
  if(part==='reports'&&p[2]==='export'&&method==='POST'){
    requireAccess(db,user,'merchandise.reports.export');
    audit(db,user,'EXPORT','merchandise_reports',b.period||today());
    return {ok:true};
  }
  return undefined;
}
