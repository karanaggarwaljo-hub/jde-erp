-- Supplier bills and invoice PDFs kept in the owner's own Google Drive, and a Log Book of everything
-- that happens in the ERP.
--
-- The owner asked where an uploaded supplier bill is saved (nowhere: it was read by the AI and
-- dropped), wanted every bill kept and openable from any device, and has 5 TB of Google Drive. They
-- also asked for a log book of all activity with the time. Everything here is additive.
--
--   jde_drive_app          The Google OAuth client the owner registers once for this installation
--                          (Settings -> Google Drive). The secret is stored encrypted by the server
--                          (lib/drive/crypto.ts); nothing here is readable from a browser.
--
--   jde_drive_connections  One Google account per company: its refresh token (encrypted), and the
--                          ids of the folders the ERP made in that Drive.
--
--   jde_purchase_bills     Every supplier bill file uploaded: which purchase it belongs to, and
--                          where it is now. It waits in the private jde-bill-inbox bucket until
--                          it is in Google Drive, then the inbox copy is removed.
--
--   jde_invoice_files      Gains where its PDF sits in Google Drive, and which version is there.
--
--   jde_audit_log          Gains the device an action came from ("Chrome on Windows"). Rows with
--                          company_id '*' are about the installation (a sign-in), not a company,
--                          and the Log Book shows them in every company.

alter table public.jde_audit_log add column if not exists device text;

create table if not exists public.jde_drive_app (
  id text primary key default 'default' check (id = 'default'),
  client_id text not null,
  client_secret_enc text not null,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);

create table if not exists public.jde_drive_connections (
  company_id text primary key,
  google_email text not null default '',
  refresh_token_enc text not null,
  root_folder_id text,
  folders jsonb not null default '{}'::jsonb,
  connected_at timestamptz not null default now(),
  connected_by text not null default '',
  last_error text,
  last_error_at timestamptz
);

create table if not exists public.jde_purchase_bills (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  file_hash text not null,
  purchase_id text,
  file_name text not null default '',
  mime_type text not null,
  size_bytes integer not null,
  inbox_path text,
  drive_file_id text,
  drive_link text,
  uploaded_at timestamptz not null default now(),
  uploaded_by text not null default '',
  drive_saved_at timestamptz,
  last_error text,
  unique (company_id, file_hash)
);
create index if not exists jde_purchase_bills_purchase_idx on public.jde_purchase_bills (company_id, purchase_id);

alter table public.jde_invoice_files add column if not exists drive_file_id text;
alter table public.jde_invoice_files add column if not exists drive_fingerprint text;
alter table public.jde_invoice_files add column if not exists drive_saved_at timestamptz;

alter table public.jde_drive_app enable row level security;
alter table public.jde_drive_connections enable row level security;
alter table public.jde_purchase_bills enable row level security;
revoke all on public.jde_drive_app from anon, authenticated;
revoke all on public.jde_drive_connections from anon, authenticated;
revoke all on public.jde_purchase_bills from anon, authenticated;

-- Where a bill waits until it is in Google Drive (or for good, while no Drive is connected).
-- Private: a supplier bill names prices and a supplier. 5 MB is above anything the browser sends
-- (photos are shrunk first; PDFs over 4 MB are refused before upload).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('jde-bill-inbox', 'jde-bill-inbox', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
