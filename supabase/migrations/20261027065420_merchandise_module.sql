-- Persiapan Modul Penjualan Merchandise. BELUM diterapkan ke production.
-- Role dibuat tanpa penugasan akun; stok awal NULL sampai petugas mencatat opname.
BEGIN;
SET LOCAL search_path=portal,pg_catalog;

CREATE TABLE IF NOT EXISTS portal.merchandise_products (
 id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 buy_price BIGINT NOT NULL CHECK(buy_price>=0), sell_price BIGINT NOT NULL CHECK(sell_price>=0),
 stock_qty INTEGER CHECK(stock_qty IS NULL OR stock_qty>=0), is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 created_by UUID REFERENCES public.app_users(id));
CREATE TABLE IF NOT EXISTS portal.merchandise_sales (
 id TEXT PRIMARY KEY, sale_no TEXT NOT NULL UNIQUE, sold_on TEXT NOT NULL,
 payment_method TEXT NOT NULL CHECK(payment_method IN('TUNAI','QRIS','TRANSFER','LAINNYA')),
 status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK(status IN('COMPLETED','VOID')),
 total BIGINT NOT NULL CHECK(total>=0), cost_total BIGINT NOT NULL CHECK(cost_total>=0),
 note TEXT, void_reason TEXT, voided_at TEXT, voided_by UUID REFERENCES public.app_users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 created_by UUID NOT NULL REFERENCES public.app_users(id));
CREATE INDEX IF NOT EXISTS merchandise_sales_date_idx ON portal.merchandise_sales(sold_on,status);
CREATE TABLE IF NOT EXISTS portal.merchandise_sale_items (
 id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES portal.merchandise_sales(id),
 product_id TEXT NOT NULL REFERENCES portal.merchandise_products(id),
 sku TEXT NOT NULL, product_name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0),
 unit_price BIGINT NOT NULL CHECK(unit_price>=0), unit_cost BIGINT NOT NULL CHECK(unit_cost>=0),
 subtotal BIGINT NOT NULL CHECK(subtotal>=0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 UNIQUE(sale_id,product_id));
CREATE TABLE IF NOT EXISTS portal.merchandise_stock_movements (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES portal.merchandise_products(id),
 sale_id TEXT REFERENCES portal.merchandise_sales(id),
 kind TEXT NOT NULL CHECK(kind IN('INITIAL','IN','ADJUST','SALE','VOID')),
 quantity_delta INTEGER NOT NULL, balance_before INTEGER, balance_after INTEGER NOT NULL CHECK(balance_after>=0),
 reason TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 created_by UUID NOT NULL REFERENCES public.app_users(id));
CREATE INDEX IF NOT EXISTS merchandise_stock_product_idx ON portal.merchandise_stock_movements(product_id,created_at);

DO $rls$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['merchandise_products','merchandise_sales','merchandise_sale_items','merchandise_stock_movements'] LOOP
  EXECUTE format('ALTER TABLE portal.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE portal.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $rls$;

WITH resources(resource,actions) AS (VALUES
 ('merchandise.catalog',ARRAY['read','manage','costs']),
 ('merchandise.stock',ARRAY['read','record','adjust']),
 ('merchandise.sales',ARRAY['read','create','void']),
 ('merchandise.reports',ARRAY['read','export']))
INSERT INTO public.app_permissions(code,module_code,resource,action)
SELECT resource||'.'||a.action,'merchandise',resource,a.action
FROM resources CROSS JOIN LATERAL unnest(actions) AS a(action)
ON CONFLICT(code) DO NOTHING;

WITH templates(code,name,codes) AS (VALUES
 ('BISNIS_PIMPINAN','Pimpinan Bisnis',ARRAY['merchandise.catalog.read','merchandise.catalog.costs','merchandise.stock.read','merchandise.sales.read','merchandise.reports.read','merchandise.reports.export']),
 ('BISNIS_MANAGER','Pengelola Bisnis',ARRAY['merchandise.catalog.read','merchandise.catalog.manage','merchandise.catalog.costs','merchandise.stock.read','merchandise.stock.record','merchandise.stock.adjust','merchandise.sales.read','merchandise.sales.create','merchandise.sales.void','merchandise.reports.read','merchandise.reports.export']),
 ('BISNIS_KOORDINATOR','Koordinator Merchandise',ARRAY['merchandise.catalog.read','merchandise.catalog.costs','merchandise.stock.read','merchandise.stock.record','merchandise.stock.adjust','merchandise.sales.read','merchandise.sales.create','merchandise.reports.read','merchandise.reports.export']),
 ('BISNIS_PETUGAS','Petugas Penjualan Merchandise',ARRAY['merchandise.catalog.read','merchandise.stock.read','merchandise.stock.record','merchandise.sales.read','merchandise.sales.create'])),
added AS (
 INSERT INTO public.app_roles(code,name) SELECT code,name FROM templates
 ON CONFLICT(code) DO NOTHING RETURNING id,code),
assigned AS (
 SELECT id,code FROM added
 UNION ALL
 SELECT r.id,r.code FROM public.app_roles r JOIN templates t ON t.code=r.code
 WHERE NOT EXISTS(SELECT 1 FROM added a WHERE a.code=r.code))
INSERT INTO public.app_role_permissions(role_id,permission_id)
SELECT a.id,p.id FROM assigned a JOIN templates t ON t.code=a.code JOIN public.app_permissions p ON p.code=ANY(t.codes)
ON CONFLICT DO NOTHING;

-- Impor katalog 68 barang berikut harga beli/jual dilakukan lewat jalur privat.
-- Jangan menyimpan daftar harga beli dalam source repository publik.

NOTIFY pgrst,'reload schema';
COMMIT;
