-- Modul Bisnis (merchandise): barang titipan UMKM. Keputusan tim Bisnis & Keuangan
-- 25 November 2026.
--
-- Aditif dan aman dijalankan SEBELUM portal-api baru: backend lama tetap bekerja.
--   * mitra UMKM dan dokumen terima/takeout disimpan di tabel baru;
--   * merchandise_products.umkm_partner_id NULL = barang milik BP (semua barang lama);
--     untuk barang UMKM, buy_price berarti harga UMKM (hak UMKM per barang terjual);
--   * baris penjualan menyimpan snapshot mitra dan persen keuntungan BP;
--   * mutasi stok mendapat jenis TAKEOUT, tautan dokumen, snapshot harga UMKM, dan
--     tanda tanggungan untuk koreksi barang UMKM;
--   * izin merchandise.umkm.read/receive ditambahkan ke template role Bisnis.
-- Tidak ada data lama yang diubah. Aman dijalankan dua kali.
BEGIN;
SET LOCAL search_path=portal,pg_catalog;

CREATE TABLE IF NOT EXISTS portal.merchandise_umkm_partners (
 id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 owner_name TEXT, phone TEXT, address TEXT, notes TEXT,
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 created_by UUID REFERENCES public.app_users(id),
 CHECK(length(code) BETWEEN 2 AND 8), CHECK(length(name) BETWEEN 1 AND 160));
CREATE TABLE IF NOT EXISTS portal.merchandise_umkm_docs (
 id TEXT PRIMARY KEY, doc_no TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN('TERIMA','TAKEOUT')),
 partner_id TEXT NOT NULL REFERENCES portal.merchandise_umkm_partners(id), doc_date TEXT NOT NULL,
 counterpart_name TEXT NOT NULL, reason TEXT, note TEXT,
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','VOID')),
 void_reason TEXT, voided_at TEXT, voided_by UUID REFERENCES public.app_users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 created_by UUID NOT NULL REFERENCES public.app_users(id));
CREATE TABLE IF NOT EXISTS portal.merchandise_umkm_doc_items (
 id TEXT PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES portal.merchandise_umkm_docs(id), line_no INTEGER NOT NULL CHECK(line_no>0),
 product_id TEXT NOT NULL REFERENCES portal.merchandise_products(id), sku TEXT NOT NULL, product_name TEXT NOT NULL,
 location TEXT NOT NULL CHECK(location IN('DISPLAY','GUDANG')), quantity INTEGER NOT NULL CHECK(quantity>0),
 unit_cost BIGINT NOT NULL CHECK(unit_cost>=0), sell_price BIGINT NOT NULL CHECK(sell_price>=0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, row_version INTEGER NOT NULL,
 UNIQUE(doc_id,product_id,location), UNIQUE(doc_id,line_no));

ALTER TABLE portal.merchandise_products ADD COLUMN IF NOT EXISTS umkm_partner_id TEXT REFERENCES portal.merchandise_umkm_partners(id);
ALTER TABLE portal.merchandise_sale_items ADD COLUMN IF NOT EXISTS umkm_partner_id TEXT REFERENCES portal.merchandise_umkm_partners(id);
ALTER TABLE portal.merchandise_sale_items ADD COLUMN IF NOT EXISTS umkm_partner_name TEXT;
ALTER TABLE portal.merchandise_sale_items ADD COLUMN IF NOT EXISTS umkm_markup_pct INTEGER;
ALTER TABLE portal.merchandise_stock_movements ADD COLUMN IF NOT EXISTS umkm_doc_id TEXT REFERENCES portal.merchandise_umkm_docs(id);
ALTER TABLE portal.merchandise_stock_movements ADD COLUMN IF NOT EXISTS unit_cost BIGINT;
ALTER TABLE portal.merchandise_stock_movements ADD COLUMN IF NOT EXISTS umkm_loss_borne_by TEXT;
DO $c$ BEGIN
  ALTER TABLE portal.merchandise_sale_items ADD CONSTRAINT merchandise_sale_items_umkm_markup_check
    CHECK (umkm_markup_pct IS NULL OR umkm_markup_pct BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $c$;
DO $c$ BEGIN
  ALTER TABLE portal.merchandise_stock_movements ADD CONSTRAINT merchandise_stock_movements_unit_cost_check
    CHECK (unit_cost IS NULL OR unit_cost>=0);
EXCEPTION WHEN duplicate_object THEN NULL; END $c$;
DO $c$ BEGIN
  ALTER TABLE portal.merchandise_stock_movements ADD CONSTRAINT merchandise_stock_movements_umkm_loss_check
    CHECK (umkm_loss_borne_by IS NULL OR umkm_loss_borne_by IN ('BP','UMKM'));
EXCEPTION WHEN duplicate_object THEN NULL; END $c$;

-- Batasan jenis mutasi dicari dari isinya, bukan dari namanya (pola migrasi 20261120090000).
DO $c$ DECLARE r record; BEGIN
  FOR r IN SELECT conname FROM pg_catalog.pg_constraint
    WHERE conrelid='portal.merchandise_stock_movements'::regclass AND contype='c'
      AND pg_catalog.pg_get_constraintdef(oid) ~ '\mkind\M' LOOP
    EXECUTE format('ALTER TABLE portal.merchandise_stock_movements DROP CONSTRAINT %I',r.conname);
  END LOOP;
  ALTER TABLE portal.merchandise_stock_movements ADD CONSTRAINT merchandise_stock_movements_kind_check
    CHECK (kind IN ('INITIAL','IN','ADJUST','SALE','VOID','TRANSFER','TAKEOUT'));
END $c$;

CREATE INDEX IF NOT EXISTS merchandise_products_umkm_idx ON portal.merchandise_products(umkm_partner_id);
CREATE INDEX IF NOT EXISTS merchandise_sale_items_umkm_idx ON portal.merchandise_sale_items(umkm_partner_id);
CREATE INDEX IF NOT EXISTS merchandise_stock_umkm_doc_idx ON portal.merchandise_stock_movements(umkm_doc_id);
CREATE INDEX IF NOT EXISTS merchandise_umkm_docs_date_idx ON portal.merchandise_umkm_docs(doc_date,partner_id);
CREATE INDEX IF NOT EXISTS merchandise_umkm_doc_items_doc_idx ON portal.merchandise_umkm_doc_items(doc_id);

-- Pemeriksaan health portal-api mewajibkan semua tabel portal ber-RLS tanpa grant ke klien.
DO $rls$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['merchandise_umkm_partners','merchandise_umkm_docs','merchandise_umkm_doc_items'] LOOP
  EXECUTE format('ALTER TABLE portal.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE portal.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $rls$;

INSERT INTO public.app_permissions(code,module_code,resource,action)
SELECT 'merchandise.umkm.'||a.action,'merchandise','merchandise.umkm',a.action
FROM unnest(ARRAY['read','receive']) AS a(action)
ON CONFLICT(code) DO NOTHING;

-- Hanya menambah izin ke template role Bisnis yang sudah ada; penugasan akun tidak berubah.
WITH grants(role_code,permission_code) AS (VALUES
 ('BISNIS_PIMPINAN','merchandise.umkm.read'),
 ('BISNIS_MANAGER','merchandise.umkm.read'),('BISNIS_MANAGER','merchandise.umkm.receive'),
 ('BISNIS_KOORDINATOR','merchandise.umkm.read'),('BISNIS_KOORDINATOR','merchandise.umkm.receive'))
INSERT INTO public.app_role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM grants g
JOIN public.app_roles r ON r.code=g.role_code
JOIN public.app_permissions p ON p.code=g.permission_code
ON CONFLICT DO NOTHING;

NOTIFY pgrst,'reload schema';
COMMIT;
