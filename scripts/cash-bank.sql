-- Cash & Bank: which drawer or bank account every rupee went into or came out of.
--
-- Until now a payment's method was free text ("Cash, UPI, cheque #") and money paid at the
-- counter on a bill was only a number on the bill, so the ERP could not say how much cash should
-- be in the drawer or what each bank account holds. Everything here is additive.
--
--   jde_money_accounts   The places money is kept: the cash drawer and each bank account, with an
--                        opening balance as of an opening date (the day the owner starts counting).
--
--   account_id / method / cheque_*   on the three tables that already have one row per payment
--                        (payments received from customers, payments to suppliers, expenses).
--
--   jde_money_entries    Money that moves inside another document and so has no row of its own:
--                        paid at the counter when billing, refunded on a customer return, paid on
--                        a purchase when it is recorded or later against it — and the owner's own
--                        entries: moving cash to the bank, putting money in or taking it out,
--                        bank charges, and the end-of-day drawer count. `amount` is signed: money
--                        into `account_id` is positive, money out negative. A transfer is one row
--                        out of `account_id` into `to_account_id`.
--
-- A cheque counts toward a bank balance only once it has cleared.
--
-- account_id columns are plain uuids, not foreign keys: a restore puts tables back one at a time
-- and must not depend on their order. The server checks an account belongs to the company.

create table if not exists public.jde_money_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  name text not null,
  kind text not null check (kind in ('cash', 'bank')),
  opening_balance numeric not null default 0,
  opening_date text not null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists jde_money_accounts_company_idx on public.jde_money_accounts (company_id);

create table if not exists public.jde_money_entries (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  date text not null,
  kind text not null check (kind in ('sale_counter', 'sale_refund', 'purchase_paid', 'purchase_payment', 'transfer', 'owner_in', 'owner_out', 'bank_charge', 'adjustment', 'drawer_count')),
  account_id uuid,
  to_account_id uuid,
  amount numeric not null,
  method text,
  cheque_no text,
  cheque_date text,
  cheque_status text check (cheque_status in ('pending', 'cleared', 'bounced')),
  cleared_on text,
  source_type text,
  source_id text,
  party text,
  note text,
  created_at timestamptz not null default now(),
  created_by text not null default ''
);
create index if not exists jde_money_entries_company_date_idx on public.jde_money_entries (company_id, date);
create index if not exists jde_money_entries_source_idx on public.jde_money_entries (company_id, source_type, source_id);

alter table public.jde_payments_received add column if not exists account_id uuid;
alter table public.jde_payments_received add column if not exists method text;
alter table public.jde_payments_received add column if not exists cheque_no text;
alter table public.jde_payments_received add column if not exists cheque_date text;
alter table public.jde_payments_received add column if not exists cheque_status text check (cheque_status in ('pending', 'cleared', 'bounced'));
alter table public.jde_payments_received add column if not exists cleared_on text;

alter table public.jde_supplier_payments add column if not exists account_id uuid;
alter table public.jde_supplier_payments add column if not exists method text;
alter table public.jde_supplier_payments add column if not exists cheque_no text;
alter table public.jde_supplier_payments add column if not exists cheque_date text;
alter table public.jde_supplier_payments add column if not exists cheque_status text check (cheque_status in ('pending', 'cleared', 'bounced'));
alter table public.jde_supplier_payments add column if not exists cleared_on text;

alter table public.jde_expenses add column if not exists account_id uuid;
alter table public.jde_expenses add column if not exists cheque_no text;
alter table public.jde_expenses add column if not exists cheque_date text;
alter table public.jde_expenses add column if not exists cheque_status text check (cheque_status in ('pending', 'cleared', 'bounced'));
alter table public.jde_expenses add column if not exists cleared_on text;

alter table public.jde_money_accounts enable row level security;
alter table public.jde_money_entries enable row level security;
revoke all on public.jde_money_accounts from anon, authenticated;
revoke all on public.jde_money_entries from anon, authenticated;
