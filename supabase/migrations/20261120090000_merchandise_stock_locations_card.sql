-- Modul Bisnis (merchandise): stok Display & Gudang, pindah stok, dan metode
-- pembayaran CARD. Keputusan pemilik 20 November 2026.
--
-- Aditif dan aman dijalankan SEBELUM portal-api baru: backend lama tetap bekerja.
--   * stock_qty yang sudah ada = stok DISPLAY (stok lama menghitung display saja);
--   * warehouse_qty baru = stok GUDANG, NULL berarti belum dihitung (bukan 0);
--   * semua riwayat mutasi lama otomatis berlokasi DISPLAY;
--   * jenis mutasi TRANSFER (pindah gudang <-> display) dan pembayaran CARD
--     hanya ditambahkan ke daftar yang diizinkan; data lama tidak diubah.
BEGIN;
SET LOCAL search_path=portal,pg_catalog;

ALTER TABLE portal.merchandise_products ADD COLUMN IF NOT EXISTS warehouse_qty INTEGER;
DO $c$ BEGIN
  ALTER TABLE portal.merchandise_products ADD CONSTRAINT merchandise_products_warehouse_qty_check
    CHECK (warehouse_qty IS NULL OR warehouse_qty>=0);
EXCEPTION WHEN duplicate_object THEN NULL; END $c$;

ALTER TABLE portal.merchandise_stock_movements ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT 'DISPLAY';
DO $c$ BEGIN
  ALTER TABLE portal.merchandise_stock_movements ADD CONSTRAINT merchandise_stock_movements_location_check
    CHECK (location IN ('DISPLAY','GUDANG'));
EXCEPTION WHEN duplicate_object THEN NULL; END $c$;

-- Batasan lama dicari dari isinya, bukan dari namanya, supaya pasti terganti
-- walaupun nama otomatisnya berbeda di database produksi.
DO $c$ DECLARE r record; BEGIN
  FOR r IN SELECT conname FROM pg_catalog.pg_constraint
    WHERE conrelid='portal.merchandise_stock_movements'::regclass AND contype='c'
      AND pg_catalog.pg_get_constraintdef(oid) ~ '\mkind\M' LOOP
    EXECUTE format('ALTER TABLE portal.merchandise_stock_movements DROP CONSTRAINT %I',r.conname);
  END LOOP;
  ALTER TABLE portal.merchandise_stock_movements ADD CONSTRAINT merchandise_stock_movements_kind_check
    CHECK (kind IN ('INITIAL','IN','ADJUST','SALE','VOID','TRANSFER'));

  FOR r IN SELECT conname FROM pg_catalog.pg_constraint
    WHERE conrelid='portal.merchandise_sales'::regclass AND contype='c'
      AND pg_catalog.pg_get_constraintdef(oid) ~ '\mpayment_method\M' LOOP
    EXECUTE format('ALTER TABLE portal.merchandise_sales DROP CONSTRAINT %I',r.conname);
  END LOOP;
  ALTER TABLE portal.merchandise_sales ADD CONSTRAINT merchandise_sales_payment_method_check
    CHECK (payment_method IN ('TUNAI','QRIS','TRANSFER','CARD','LAINNYA'));
END $c$;

-- Ekspor stok bulanan mengambil mutasi sejak tanggal awal periode.
CREATE INDEX IF NOT EXISTS merchandise_stock_created_idx ON portal.merchandise_stock_movements(created_at);

NOTIFY pgrst,'reload schema';
COMMIT;
