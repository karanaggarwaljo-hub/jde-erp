-- A company's own state, for a company without a GSTIN. The state decides IGST against CGST + SGST
-- (or UTGST) on every bill (lib/gst-supply.ts); a GSTIN states it in its first two digits, but a
-- company without one printed CGST + SGST even on a sale to another state. Settings -> Companies
-- -> Edit picks it; a GSTIN's own state always wins.
--
-- Additive; rollback-tested (a bad code refused by the check). Applied 2026-10-22 as migration
-- company_state_code.

alter table public.jde_companies add column if not exists state_code text;
alter table public.jde_companies drop constraint if exists jde_companies_state_code_check;
alter table public.jde_companies add constraint jde_companies_state_code_check check (state_code is null or state_code ~ '^[0-9]{2}$');
