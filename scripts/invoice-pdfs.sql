-- Every sales invoice kept as a PDF, in private storage.
--
-- The owner asked for invoices to be saved automatically, take very little space, and open from
-- any device through the ERP. lib/invoice-archive.ts draws and saves them; this is where they live.
--
--   jde-invoices        A PRIVATE bucket, like jde-backups and unlike jde-catalog-images: an
--                       invoice names a customer and what they paid. Nothing is served from it
--                       directly; the ERP reads a file and hands it to a signed-in user. Capped
--                       at 1 MB a file and PDFs only. A one-page invoice is a few kilobytes.
--
--   jde_invoice_files   One row per invoice that has a saved PDF: where it is, how big, when it
--                       was saved, and a fingerprint of the text it was drawn from, so it is
--                       redrawn exactly when that text would change. Derived data — every file
--                       can be drawn again from the invoice — so it is deliberately not in the
--                       nightly backup.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('jde-invoices', 'jde-invoices', false, 1048576, array['application/pdf'])
on conflict (id) do nothing;

create table if not exists public.jde_invoice_files (
  invoice_id text primary key,
  company_id text not null,
  path text not null,
  fingerprint text not null,
  size_bytes integer not null,
  saved_at timestamptz not null default now()
);
create index if not exists jde_invoice_files_company_idx on public.jde_invoice_files (company_id);
alter table public.jde_invoice_files enable row level security;
revoke all on public.jde_invoice_files from anon, authenticated;
