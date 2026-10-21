-- The letterhead on tax invoices, after the owner's reference bill: the MSME (Udyam) registration
-- number, the website and the Import Export Code, each printed only when filled in
-- (Settings -> Companies -> Edit; lib/tally-invoice.ts). PAN stays off, as the owner chose.
--
-- Additive; rollback-tested (one company filled, the real company untouched). Applied 2026-10-21
-- as migration company_letterhead_details.

alter table public.jde_companies
  add column if not exists udyam_no text,
  add column if not exists website text,
  add column if not exists iec_code text;
