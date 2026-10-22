-- The dispatch details a GST tax invoice prints beside its number and date, as Tally does:
-- Dispatched through, Terms of delivery, Destination, Other reference and E-way bill no. All
-- optional, typed on the bill form (lib/invoice-dispatch.ts) and saved by /api/sales/save-invoice.
--
-- Additive; rollback-tested (values saved on the test company's INV-1019, an over-long e-way bill
-- number refused). Applied 2026-10-22 as migration invoice_dispatch_details.

alter table public.jde_invoices
  add column if not exists dispatched_through text check (char_length(dispatched_through) <= 120),
  add column if not exists delivery_terms text check (char_length(delivery_terms) <= 200),
  add column if not exists destination text check (char_length(destination) <= 120),
  add column if not exists other_reference text check (char_length(other_reference) <= 120),
  add column if not exists eway_bill_no text check (char_length(eway_bill_no) <= 40);
