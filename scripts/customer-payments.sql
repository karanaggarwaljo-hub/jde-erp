-- JDE ERP: recording a customer payment that settles one or more open invoices.
-- The application server invokes these functions only with the Supabase service role.
--
-- Why this exists: invoices already track their own paid/balance, but there was no way to
-- record a single lump-sum payment against several invoices at once (e.g. a customer buys on
-- three separate days on credit, then pays the running total in one go on the fourth) — the
-- owner had to open and hand-edit each invoice's paid amount individually, and nothing recorded
-- that the payment itself ever happened as its own event.
--
-- Every RETURNS TABLE column below is deliberately named to never collide with a real table
-- column (payment_id/applied_total, not id/amount) — jde_create_sales_return shipped with
-- exactly that collision (RETURNS TABLE(id text, ...) makes "id" an output variable, so every
-- unqualified `id` column reference in the body became ambiguous and the function could never
-- run) and every column reference here is table-qualified regardless, as a second line of
-- defense against the same class of bug.
begin;

create table if not exists public.jde_payments_received (
  id text primary key,
  company_id text not null references public.jde_companies(id),
  -- Required, not nullable: a payment is recorded against a real customer with a running
  -- balance. A walk-in sale with no customer row has nothing for this feature to attach to —
  -- that invoice's own paid amount is still edited directly, exactly as before this migration.
  customer_id text not null references public.jde_customers(id),
  customer text not null,
  date text not null,
  amount numeric not null check (amount > 0),
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists jde_payments_received_lookup on public.jde_payments_received(company_id, customer_id, date);
alter table public.jde_payments_received enable row level security;

create table if not exists public.jde_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id text not null references public.jde_payments_received(id) on delete cascade,
  company_id text not null,
  invoice_id text not null references public.jde_invoices(id),
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index if not exists jde_payment_allocations_payment_idx on public.jde_payment_allocations(payment_id);
create index if not exists jde_payment_allocations_invoice_idx on public.jde_payment_allocations(invoice_id);
alter table public.jde_payment_allocations enable row level security;

-- Records one payment and applies it across the owner's chosen invoices, atomically: the
-- payment row, its per-invoice allocations, each invoice's paid/status, and the customer's
-- running balance all land together or not at all.
--
-- p_allocations must sum to exactly p_amount — every rupee entered has to be assigned to a
-- specific invoice. This was a deliberate choice over allowing a partial/unapplied remainder:
-- it keeps the model simple (a payment IS its allocations, nothing left floating unexplained)
-- and matches the owner's own choice of manual, per-invoice allocation over a single running
-- balance. If a customer pays before an invoice exists to apply it to, that is not yet
-- supported — record the invoice first.
create or replace function public.jde_receive_customer_payment(
  p_company_id text, p_customer_id text, p_date text, p_amount numeric, p_note text, p_allocations jsonb
) returns table(payment_id text, applied_total numeric) language plpgsql set search_path = public as $fn$
declare v_customer public.jde_customers%rowtype; v_invoice public.jde_invoices%rowtype;
  v_line record; v_id text; v_allocated numeric := 0; v_old_due numeric; v_new_paid numeric; v_new_due numeric; v_new_status text; v_delta numeric := 0;
begin
  if coalesce(trim(p_company_id),'')='' or coalesce(trim(p_customer_id),'')='' or coalesce(trim(p_date),'')='' then
    raise exception 'Company, customer, and date are required.';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be greater than zero.'; end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'Select at least one invoice to apply this payment to.';
  end if;
  if exists(select 1 from jsonb_to_recordset(p_allocations) as x(invoice_id text, amount numeric) where x.amount is null or x.amount <= 0)
     or exists(select x.invoice_id from jsonb_to_recordset(p_allocations) as x(invoice_id text, amount numeric) group by x.invoice_id having count(*) > 1) then
    raise exception 'Each invoice may appear once in a payment, with an amount greater than zero.';
  end if;

  select sum(x.amount) into v_allocated from jsonb_to_recordset(p_allocations) as x(invoice_id text, amount numeric);
  if abs(v_allocated - p_amount) > 0.01 then
    raise exception 'The amounts applied to invoices (₹%) must add up to the payment amount (₹%).', v_allocated, p_amount;
  end if;

  perform pg_advisory_xact_lock(hashtext('jde-customer-payment:'||p_customer_id));
  select * into v_customer from public.jde_customers c where c.id = p_customer_id and c.company_id = p_company_id for update;
  if not found then raise exception 'Customer not found for the active company.'; end if;

  perform pg_advisory_xact_lock(hashtext('jde-customer-payment-number'));
  select 'RCPT-'||(coalesce(max(nullif(regexp_replace(pr.id,'[^0-9]','','g'),'')::int),1000)+1) into v_id from public.jde_payments_received pr;

  insert into public.jde_payments_received(id, company_id, customer_id, customer, date, amount, note)
  values (v_id, p_company_id, p_customer_id, v_customer.name, p_date, p_amount, coalesce(trim(p_note),''));

  for v_line in select * from jsonb_to_recordset(p_allocations) as x(invoice_id text, amount numeric) loop
    select * into v_invoice from public.jde_invoices inv where inv.id = v_line.invoice_id and inv.company_id = p_company_id for update;
    if not found then raise exception 'Invoice % was not found for the active company.', v_line.invoice_id; end if;
    if v_invoice.customer is distinct from v_customer.name then raise exception 'Invoice % does not belong to this customer.', v_line.invoice_id; end if;

    v_old_due := greatest(coalesce(v_invoice.total,0) - coalesce(v_invoice.paid,0), 0);
    if v_line.amount > v_old_due + 0.01 then
      raise exception 'Applied amount for % (₹%) exceeds its remaining balance (₹%).', v_line.invoice_id, v_line.amount, v_old_due;
    end if;

    v_new_paid := coalesce(v_invoice.paid,0) + v_line.amount;
    v_new_due := greatest(coalesce(v_invoice.total,0) - v_new_paid, 0);
    v_new_status := case when v_new_paid >= v_invoice.total then 'paid' when v_new_paid > 0 then 'partial' else 'unpaid' end;

    insert into public.jde_payment_allocations(payment_id, company_id, invoice_id, amount)
    values (v_id, p_company_id, v_line.invoice_id, v_line.amount);

    update public.jde_invoices inv set paid = v_new_paid, status = v_new_status where inv.id = v_line.invoice_id and inv.company_id = p_company_id;

    v_delta := v_delta + (v_new_due - v_old_due);
  end loop;

  perform public.jde_adjust_customer_balance(p_customer_id, v_delta);

  return query select v_id, p_amount;
end $fn$;

-- Reverses a payment: every invoice it was applied to gets its paid amount and status put back,
-- the customer's balance is corrected by the same total, then the allocations and the payment
-- itself are removed. An allocation whose invoice has since been deleted is simply skipped
-- (there is nothing left to credit back) rather than failing the whole reversal.
create or replace function public.jde_delete_customer_payment(p_company_id text, p_payment_id text)
returns void language plpgsql set search_path = public as $fn$
declare v_payment public.jde_payments_received%rowtype; v_alloc record; v_invoice public.jde_invoices%rowtype;
  v_old_due numeric; v_new_paid numeric; v_new_due numeric; v_new_status text; v_delta numeric := 0;
begin
  select * into v_payment from public.jde_payments_received pr where pr.id = p_payment_id and pr.company_id = p_company_id for update;
  if not found then raise exception 'Payment not found for the active company.'; end if;

  for v_alloc in select pa.invoice_id, pa.amount from public.jde_payment_allocations pa where pa.payment_id = p_payment_id and pa.company_id = p_company_id loop
    select * into v_invoice from public.jde_invoices inv where inv.id = v_alloc.invoice_id and inv.company_id = p_company_id for update;
    if found then
      v_old_due := greatest(coalesce(v_invoice.total,0) - coalesce(v_invoice.paid,0), 0);
      v_new_paid := greatest(coalesce(v_invoice.paid,0) - v_alloc.amount, 0);
      v_new_due := greatest(coalesce(v_invoice.total,0) - v_new_paid, 0);
      v_new_status := case when v_new_paid >= v_invoice.total then 'paid' when v_new_paid > 0 then 'partial' else 'unpaid' end;
      update public.jde_invoices inv set paid = v_new_paid, status = v_new_status where inv.id = v_alloc.invoice_id and inv.company_id = p_company_id;
      v_delta := v_delta + (v_new_due - v_old_due);
    end if;
  end loop;

  perform public.jde_adjust_customer_balance(v_payment.customer_id, v_delta);

  delete from public.jde_payment_allocations pa where pa.payment_id = p_payment_id and pa.company_id = p_company_id;
  delete from public.jde_payments_received pr where pr.id = p_payment_id and pr.company_id = p_company_id;
end $fn$;

-- A payment already recorded against an invoice is a real-world fact (money changed hands) —
-- deleting that invoice out from under it would strand the allocation and silently corrupt the
-- customer's balance. Block it with a clear instruction instead. This does not change how
-- deleting any invoice with no payment allocations behaves (every invoice today, since the
-- feature is new) — only adds a guard for the case this migration makes possible.
create or replace function public.jde_delete_sales_invoice(p_invoice_id text, p_customer_id text, p_outstanding numeric)
returns void language plpgsql set search_path = public as $fn$
declare v_item record;
begin
  if exists(select 1 from public.jde_payment_allocations pa where pa.invoice_id = p_invoice_id) then
    raise exception 'A payment has already been recorded against this invoice — delete or edit that payment first.';
  end if;

  for v_item in select ii.id, ii.product_id from public.jde_invoice_items ii where ii.invoice_id = p_invoice_id loop
    if v_item.product_id is not null then
      perform public.jde_restore_stock_layers_for_invoice_item(v_item.id);
    end if;
  end loop;
  delete from public.jde_invoice_items ii where ii.invoice_id = p_invoice_id;

  if p_customer_id is not null then
    perform public.jde_adjust_customer_balance(p_customer_id, -p_outstanding);
  end if;

  delete from public.jde_invoices inv where inv.id = p_invoice_id;
end $fn$;

revoke all on function public.jde_receive_customer_payment(text,text,text,numeric,text,jsonb) from public,anon,authenticated;
grant execute on function public.jde_receive_customer_payment(text,text,text,numeric,text,jsonb) to service_role;
revoke all on function public.jde_delete_customer_payment(text,text) from public,anon,authenticated;
grant execute on function public.jde_delete_customer_payment(text,text) to service_role;
revoke all on function public.jde_delete_sales_invoice(text,text,numeric) from public,anon,authenticated;
grant execute on function public.jde_delete_sales_invoice(text,text,numeric) to service_role;

commit;
