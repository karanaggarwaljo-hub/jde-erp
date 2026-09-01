-- Applied to the live Supabase project on 2026-09-01 as migration `add_invoice_gst_mode`.
-- Kept here so the schema lives in the repo too, matching the other scripts/*.sql files.
--
-- WHY: prices could only ever be entered GST-EXCLUSIVE (tax added on top). A lot of counter trade
-- is quoted the other way round — the price on the shelf is what the customer pays, with the tax
-- already inside it — and there was no way to record that.
--
-- This is display metadata, alongside gst_percent/gst_amount. The atomic save needs no knowledge
-- of it: the invoice total it is handed is already final either way, so nothing about stock,
-- customer balances or the save path changes.
--
-- Defaults to 'exclusive', which is how every invoice recorded before this genuinely was priced,
-- so existing invoices keep reading and printing exactly as they did.

ALTER TABLE public.jde_invoices
  ADD COLUMN gst_mode text NOT NULL DEFAULT 'exclusive';

-- Arithmetic, for reference. `after` is the amount left once both discounts are applied:
--
--   exclusive:  gst = after * rate/100          total = after + gst    taxable value = after
--   inclusive:  gst = after * rate/(100+rate)   total = after          taxable value = after - gst
--
-- Verified against the live database (saved, checked, rolled back) with identical lines priced
-- both ways: after = 2185, rate = 18.
--   exclusive -> gst 393.30, taxable 2185.00, total 2578.30
--   inclusive -> gst 333.31, taxable 1851.69, total 2185.00
-- Taxable value + GST equals the total in both cases.
--
-- NOTE for anyone touching the printable invoice: it used to reconstruct the tax as
-- total - (subtotal - discount). That is only valid for exclusive pricing; on an inclusive invoice
-- it yields zero. It now prefers the stored gst_amount and keeps that subtraction only as the
-- fallback for invoices saved before the split was recorded — all of which were exclusive.
