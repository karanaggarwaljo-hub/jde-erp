-- Where a sale's goods are supplied to, as a GST state code (lib/gst-supply.ts). It decides IGST
-- (another state) versus CGST + SGST/UTGST (the same state) on the tax invoice. Chosen on the bill;
-- null on older invoices, which fall back to the buyer's GSTIN, else the seller's own state.
-- Additive; applied 2026-10-21 as migration invoice_place_of_supply. jde_invoices keeps its grants.
alter table public.jde_invoices add column if not exists place_of_supply text
  check (place_of_supply is null or place_of_supply ~ '^[0-9]{2}$');
