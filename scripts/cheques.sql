-- Cheque management: every cheque given and received, cheque books, and bounces that undo the
-- payment they paid.
--
-- The owner asked for a way to track every cheque given to suppliers. Cash & Bank already kept a
-- cheque's state on the payment it paid, but a bounced cheque to a supplier still counted as paid
-- against the supplier's bills — the debt never came back. Everything here is additive.
--
--   jde_cheque_books   A book of cheque leaves for a bank account: its first and last number.
--                      Lets the ERP suggest the next leaf and show which are used or spoiled.
--
--   jde_cheques        The register: one row per cheque, given (out) or received (in), with its
--                      number, the date written on it, who it is to or from, the amount, its
--                      purpose (a payment, a security cheque, an advance) and its life — pending,
--                      cleared, bounced, cancelled (a spoiled leaf or a stopped cheque) or returned
--                      (a security cheque handed back). A cheque that paid something points at that
--                      record (source_table, source_id), whose own cheque fields Cash & Bank reads.
--
--   jde_reverse_supplier_payment   Undoes a supplier payment whose cheque bounced or was stopped:
--                      takes it off the purchases it was put against, puts the amount back on the
--                      supplier's balance, and removes it. The customer side already has
--                      jde_delete_customer_payment.
--   jde_unpay_purchase / jde_unpay_invoice   The same for a cheque paid on a purchase or at the
--                      counter on a bill, which has no payment row of its own.

create table if not exists public.jde_cheque_books (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  account_id uuid not null,
  first_no text not null,
  last_no text not null,
  received_on text not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists jde_cheque_books_company_idx on public.jde_cheque_books (company_id);

create table if not exists public.jde_cheques (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  direction text not null check (direction in ('out', 'in')),
  account_id uuid,
  bank_name text,
  cheque_no text not null,
  cheque_date text,
  issued_on text not null,
  party text not null default '',
  party_type text check (party_type in ('supplier', 'customer', 'other')),
  amount numeric not null default 0,
  purpose text not null default 'payment' check (purpose in ('payment', 'security', 'advance', 'other')),
  status text not null default 'pending' check (status in ('pending', 'cleared', 'bounced', 'cancelled', 'returned')),
  status_on text,
  source_table text,
  source_id text,
  reversed boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  created_by text not null default ''
);
create index if not exists jde_cheques_company_idx on public.jde_cheques (company_id, direction, status);
create index if not exists jde_cheques_source_idx on public.jde_cheques (company_id, source_table, source_id);
-- A leaf of one of your own books is used once; cheques received come from many banks, so their
-- numbers are not unique.
create unique index if not exists jde_cheques_own_leaf_idx on public.jde_cheques (company_id, account_id, cheque_no) where direction = 'out';

alter table public.jde_cheque_books enable row level security;
alter table public.jde_cheques enable row level security;
revoke all on public.jde_cheque_books from anon, authenticated;
revoke all on public.jde_cheques from anon, authenticated;

create or replace function public.jde_reverse_supplier_payment(p_company_id text, p_payment_id text)
returns table(reversed_amount numeric, orders_touched integer)
language plpgsql
set search_path to 'public'
as $function$
declare v_payment public.jde_supplier_payments%rowtype; v_alloc record; v_count integer := 0;
begin
  select * into v_payment from public.jde_supplier_payments sp where sp.id = p_payment_id and sp.company_id = p_company_id for update;
  if not found then raise exception 'Supplier payment % was not found for this company.', p_payment_id; end if;
  perform pg_advisory_xact_lock(hashtext('jde-supplier-payment:' || v_payment.supplier_id));

  for v_alloc in select a.po_id, a.amount from public.jde_supplier_payment_allocations a where a.payment_id = p_payment_id and a.company_id = p_company_id loop
    update public.jde_purchase_orders o set paid = greatest(round(coalesce(o.paid, 0) - v_alloc.amount, 2), 0)
     where o.id = v_alloc.po_id and o.company_id = p_company_id;
    v_count := v_count + 1;
  end loop;

  perform public.jde_adjust_supplier_balance(v_payment.supplier_id, round(v_payment.amount, 2));
  delete from public.jde_supplier_payment_allocations a where a.payment_id = p_payment_id and a.company_id = p_company_id;
  delete from public.jde_supplier_payments sp where sp.id = p_payment_id and sp.company_id = p_company_id;
  return query select round(v_payment.amount, 2), v_count;
end $function$;

create or replace function public.jde_unpay_purchase(p_company_id text, p_po_id text, p_amount numeric)
returns numeric
language plpgsql
set search_path to 'public'
as $function$
declare v_po public.jde_purchase_orders%rowtype; v_take numeric; v_supplier_id text;
begin
  select * into v_po from public.jde_purchase_orders o where o.id = p_po_id and o.company_id = p_company_id for update;
  if not found then raise exception 'Purchase % was not found for this company.', p_po_id; end if;
  v_take := least(round(coalesce(p_amount, 0), 2), round(coalesce(v_po.paid, 0), 2));
  if v_take <= 0 then return 0; end if;
  update public.jde_purchase_orders o set paid = round(coalesce(o.paid, 0) - v_take, 2) where o.id = p_po_id and o.company_id = p_company_id;
  select s.id into v_supplier_id from public.jde_suppliers s where s.company_id = p_company_id and lower(s.name) = lower(v_po.supplier) limit 1;
  if v_supplier_id is not null then perform public.jde_adjust_supplier_balance(v_supplier_id, v_take); end if;
  return v_take;
end $function$;

create or replace function public.jde_unpay_invoice(p_company_id text, p_invoice_id text, p_amount numeric)
returns numeric
language plpgsql
set search_path to 'public'
as $function$
declare v_inv public.jde_invoices%rowtype; v_take numeric; v_old_due numeric; v_new_paid numeric; v_new_due numeric; v_customer_id text;
begin
  select * into v_inv from public.jde_invoices i where i.id = p_invoice_id and i.company_id = p_company_id for update;
  if not found then raise exception 'Bill % was not found for this company.', p_invoice_id; end if;
  v_take := least(round(coalesce(p_amount, 0), 2), round(coalesce(v_inv.paid, 0), 2));
  if v_take <= 0 then return 0; end if;
  v_old_due := greatest(coalesce(v_inv.total, 0) - coalesce(v_inv.paid, 0) - coalesce(v_inv.settlement_write_off, 0), 0);
  v_new_paid := round(coalesce(v_inv.paid, 0) - v_take, 2);
  v_new_due := greatest(coalesce(v_inv.total, 0) - v_new_paid - coalesce(v_inv.settlement_write_off, 0), 0);
  update public.jde_invoices i set paid = v_new_paid,
    status = case when v_new_paid + coalesce(v_inv.settlement_write_off, 0) >= coalesce(v_inv.total, 0) then 'paid' when v_new_paid > 0 then 'partial' else 'unpaid' end
   where i.id = p_invoice_id and i.company_id = p_company_id;
  select c.id into v_customer_id from public.jde_customers c where c.company_id = p_company_id and c.name = v_inv.customer limit 1;
  if v_customer_id is not null then perform public.jde_adjust_customer_balance(v_customer_id, v_new_due - v_old_due); end if;
  return v_take;
end $function$;

revoke all on function public.jde_reverse_supplier_payment(text, text) from public, anon, authenticated;
revoke all on function public.jde_unpay_purchase(text, text, numeric) from public, anon, authenticated;
revoke all on function public.jde_unpay_invoice(text, text, numeric) from public, anon, authenticated;
grant execute on function public.jde_reverse_supplier_payment(text, text) to service_role;
grant execute on function public.jde_unpay_purchase(text, text, numeric) to service_role;
grant execute on function public.jde_unpay_invoice(text, text, numeric) to service_role;

-- A cheque recorded without its number (the owner can add it later) must not block the next one:
-- the unique leaf index ignores blanks.
alter table public.jde_cheques alter column cheque_no drop not null;
