-- Bank details and the declaration printed on Tally-style tax invoices (lib/tally-invoice.ts).
-- Additive: five optional text columns on the company, edited in Settings → Company. The state,
-- state code and PAN printed on the invoice come from the GSTIN, so they are not stored.
-- Applied 2026-10-21 as migration company_bank_details_for_invoices. jde_companies keeps its grants.
alter table public.jde_companies
  add column if not exists bank_name text,
  add column if not exists bank_account_no text,
  add column if not exists bank_ifsc text,
  add column if not exists bank_branch text,
  add column if not exists invoice_declaration text;
