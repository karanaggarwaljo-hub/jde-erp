-- Starting a company fresh, and never giving a document number out twice.
--
-- The owner stopped using the ERP for a while and asked for a clean start: every part keeps its
-- name, part number, what it fits, brand and category, but its stock and prices are cleared; every
-- sale, purchase, payment, return and quotation is deleted; customers are deleted; suppliers are
-- kept, with their balances cleared. Website listings, the audit log, staff and the company itself
-- are untouched.
--
-- 1. NUMBERS NEVER GO BACKWARDS
--
--    Every document number is "the highest one in the table, plus one", taken across every company
--    (the ids are global primary keys). Jai Durga's bills are INV-1010 to INV-1016 and the test
--    company's are INV-1001 to INV-1009, so deleting Jai Durga's bills would make the next one
--    INV-1010 again — a number a real customer already holds on paper. A bill number must be unique,
--    for GST as much as for anyone's sanity.
--
--    jde_number_floors remembers the highest number ever used for each kind of document, and every
--    number-maker now takes the greater of that and what is in its table. The table starts empty, so
--    until a reset writes to it every number comes out exactly as it did before.
--
--    The number-makers are patched in place, by exact text replacement of their one numbering
--    expression, so nothing else about them changes. Each replacement must match exactly once or the
--    whole migration fails. Older scripts in this folder that define these functions have been
--    updated to match; re-running one of them before this file would fail, by design, on the missing
--    jde_number_floor function.
--
-- 2. THE RESET
--
--    jde_reset_company_data does all of it in one transaction, or none of it. It refuses unless the
--    company's own name is typed back exactly, so a mis-click can never reach it. The deletion order
--    is jde_delete_company's, which is the order the foreign keys allow. The route that calls this
--    takes a full backup first and refuses to go on if the backup fails.
--
-- Grants match every other jde_ function: Supabase hands EXECUTE to anon and authenticated as
-- explicit grants that "revoke from public" does not remove, so they are revoked by name.

create table if not exists public.jde_number_floors (
  prefix text primary key,
  last_used integer not null,
  updated_at timestamptz not null default now()
);
alter table public.jde_number_floors enable row level security;
revoke all on public.jde_number_floors from anon, authenticated;

create or replace function public.jde_number_floor(p_prefix text)
returns integer
language sql
stable
set search_path to 'public'
as $function$
  select coalesce((select f.last_used from public.jde_number_floors f where f.prefix = p_prefix), 0);
$function$;

revoke execute on function public.jde_number_floor(text) from public;
revoke execute on function public.jde_number_floor(text) from anon;
revoke execute on function public.jde_number_floor(text) from authenticated;
grant execute on function public.jde_number_floor(text) to service_role;

-- Every number-maker: take the floor into account.
do $patch$
declare
  v_fix record;
  v_fn record;
  v_def text;
  v_hits integer;
  v_patched integer;
begin
  for v_fix in
    select * from (values
      ('jde_save_sales_invoice', 'INV',
        $q$'INV-' || (coalesce(max(substring(id from '\d+$')::int), 1000) + 1)$q$,
        $q$'INV-' || (greatest(coalesce(max(substring(id from '\d+$')::int), 1000), public.jde_number_floor('INV')) + 1)$q$),
      ('jde_save_purchase', 'PO',
        $q$'PO-' || (coalesce(max(substring(id from '\d+$')::int), 1000) + 1)$q$,
        $q$'PO-' || (greatest(coalesce(max(substring(id from '\d+$')::int), 1000), public.jde_number_floor('PO')) + 1)$q$),
      ('jde_save_purchase', 'GRN',
        $q$'GRN-' || (coalesce(max(substring(id from '\d+$')::int), 1000) + 1)$q$,
        $q$'GRN-' || (greatest(coalesce(max(substring(id from '\d+$')::int), 1000), public.jde_number_floor('GRN')) + 1)$q$),
      ('jde_receive_purchase_stock', 'GRN',
        $q$'GRN-' || (coalesce(max(substring(id from '\d+$')::int), 1000) + 1)$q$,
        $q$'GRN-' || (greatest(coalesce(max(substring(id from '\d+$')::int), 1000), public.jde_number_floor('GRN')) + 1)$q$),
      ('jde_create_sales_return', 'SRN',
        $q$'SRN-'||(coalesce(max(nullif(regexp_replace(sr.id,'[^0-9]','','g'),'')::int),1000)+1)$q$,
        $q$'SRN-'||(greatest(coalesce(max(nullif(regexp_replace(sr.id,'[^0-9]','','g'),'')::int),1000), public.jde_number_floor('SRN'))+1)$q$),
      ('jde_receive_customer_payment', 'RCPT',
        $q$'RCPT-'||(coalesce(max(nullif(regexp_replace(pr.id,'[^0-9]','','g'),'')::int),1000)+1)$q$,
        $q$'RCPT-'||(greatest(coalesce(max(nullif(regexp_replace(pr.id,'[^0-9]','','g'),'')::int),1000), public.jde_number_floor('RCPT'))+1)$q$),
      ('jde_pay_supplier', 'SPAY',
        $q$'SPAY-' || (coalesce(max(nullif(regexp_replace(sp.id, '[^0-9]', '', 'g'), '')::int), 1000) + 1)$q$,
        $q$'SPAY-' || (greatest(coalesce(max(nullif(regexp_replace(sp.id, '[^0-9]', '', 'g'), '')::int), 1000), public.jde_number_floor('SPAY')) + 1)$q$),
      ('jde_write_off_invoice_balance', 'WOFF',
        $q$'WOFF-' || (coalesce(max(nullif(regexp_replace(w.id, '[^0-9]', '', 'g'), '')::int), 1000) + 1)$q$,
        $q$'WOFF-' || (greatest(coalesce(max(nullif(regexp_replace(w.id, '[^0-9]', '', 'g'), '')::int), 1000), public.jde_number_floor('WOFF')) + 1)$q$),
      ('jde_save_quotation', 'QT',
        $q$'QT-' || (coalesce(max(nullif(regexp_replace(id, '[^0-9]', '', 'g'), '')::int),1000)+1)$q$,
        $q$'QT-' || (greatest(coalesce(max(nullif(regexp_replace(id, '[^0-9]', '', 'g'), '')::int),1000), public.jde_number_floor('QT'))+1)$q$),
      ('jde_create_expense', 'EXP',
        $q$'EXP-' || (coalesce(max(substring(id from '\d+$')::int), 100) + 1)$q$,
        $q$'EXP-' || (greatest(coalesce(max(substring(id from '\d+$')::int), 100), public.jde_number_floor('EXP')) + 1)$q$),
      ('jde_record_purchase_return', 'PRN',
        $q$'PRN-'||(coalesce(max(nullif(regexp_replace(id,'[^0-9]','','g'),'')::int),1000)+1)$q$,
        $q$'PRN-'||(greatest(coalesce(max(nullif(regexp_replace(id,'[^0-9]','','g'),'')::int),1000), public.jde_number_floor('PRN'))+1)$q$)
    ) as fixes(fn, prefix, old_text, new_text)
  loop
    v_patched := 0;
    for v_fn in
      select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_fix.fn
    loop
      v_def := pg_get_functiondef(v_fn.oid);
      -- Already patched (this file re-run): leave it.
      if position(v_fix.new_text in v_def) > 0 then
        v_patched := v_patched + 1;
        continue;
      end if;
      v_hits := (length(v_def) - length(replace(v_def, v_fix.old_text, ''))) / length(v_fix.old_text);
      if v_hits = 0 then
        continue;
      end if;
      if v_hits > 1 then
        raise exception 'start-fresh: % numbers % in % places; expected one', v_fix.fn, v_fix.prefix, v_hits;
      end if;
      execute replace(v_def, v_fix.old_text, v_fix.new_text);
      v_patched := v_patched + 1;
    end loop;
    if v_patched = 0 then
      raise exception 'start-fresh: could not find how % numbers %', v_fix.fn, v_fix.prefix;
    end if;
  end loop;
end
$patch$;

create or replace function public.jde_reset_company_data(p_company_id text, p_confirm_name text)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_company public.jde_companies%rowtype;
  v_counts jsonb := '{}'::jsonb;
  v_count integer;
  v_floor record;
begin
  if coalesce(trim(p_company_id), '') = '' then
    raise exception 'Choose the company to start fresh.';
  end if;

  select * into v_company from public.jde_companies c where c.id = p_company_id;
  if not found then
    raise exception 'That company was not found.';
  end if;
  if lower(trim(coalesce(p_confirm_name, ''))) <> lower(trim(v_company.name)) then
    raise exception 'Type the company name exactly as it is shown to confirm. Nothing was changed.';
  end if;

  -- One reset at a time, and no sale or purchase can be numbered while the floors are written.
  perform pg_advisory_xact_lock(hashtext('jde-reset-company:' || p_company_id));

  -- Remember the highest number every kind of document has reached, across every company, before
  -- any of it is deleted.
  for v_floor in
    select 'INV' as prefix, max(nullif(regexp_replace(id, '[^0-9]', '', 'g'), '')::int) as top from public.jde_invoices
    union all select 'PO', max(nullif(regexp_replace(id, '[^0-9]', '', 'g'), '')::int) from public.jde_purchase_orders
    union all select 'GRN', max(nullif(regexp_replace(id, '[^0-9]', '', 'g'), '')::int) from public.jde_grns
    union all select 'SRN', max(nullif(regexp_replace(id, '[^0-9]', '', 'g'), '')::int) from public.jde_sales_returns
    union all select 'RCPT', max(nullif(regexp_replace(id, '[^0-9]', '', 'g'), '')::int) from public.jde_payments_received
    union all select 'SPAY', max(nullif(regexp_replace(id, '[^0-9]', '', 'g'), '')::int) from public.jde_supplier_payments
    union all select 'WOFF', max(nullif(regexp_replace(id, '[^0-9]', '', 'g'), '')::int) from public.jde_invoice_writeoffs
    union all select 'QT', max(nullif(regexp_replace(id, '[^0-9]', '', 'g'), '')::int) from public.jde_quotations
    union all select 'EXP', max(nullif(regexp_replace(id, '[^0-9]', '', 'g'), '')::int) from public.jde_expenses
    union all select 'PRN', max(nullif(regexp_replace(id, '[^0-9]', '', 'g'), '')::int) from public.jde_purchase_returns
  loop
    if v_floor.top is not null then
      insert into public.jde_number_floors (prefix, last_used, updated_at)
      values (v_floor.prefix, v_floor.top, now())
      on conflict (prefix) do update
        set last_used = greatest(public.jde_number_floors.last_used, excluded.last_used),
            updated_at = now();
    end if;
  end loop;

  -- Everything that happened, in the order the foreign keys allow (jde_delete_company's order).
  delete from public.jde_payment_allocations where company_id = p_company_id;
  delete from public.jde_supplier_payment_allocations where company_id = p_company_id;
  delete from public.jde_payments_received where company_id = p_company_id;
  get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('payments_received', v_count);
  delete from public.jde_supplier_payments where company_id = p_company_id;
  get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('supplier_payments', v_count);
  delete from public.jde_invoice_writeoffs where company_id = p_company_id;
  get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('write_offs', v_count);
  delete from public.jde_sales_return_items where company_id = p_company_id;
  delete from public.jde_sales_returns where company_id = p_company_id;
  get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('sales_returns', v_count);
  delete from public.jde_purchase_return_items where company_id = p_company_id;
  delete from public.jde_purchase_returns where company_id = p_company_id;
  get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('purchase_returns', v_count);
  delete from public.jde_stock_consumptions where company_id = p_company_id;
  delete from public.jde_stock_layers where company_id = p_company_id;
  get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('stock_batches', v_count);
  delete from public.jde_invoice_items where company_id = p_company_id;
  delete from public.jde_po_items where company_id = p_company_id;
  delete from public.jde_quotation_items where company_id = p_company_id;
  delete from public.jde_invoices where company_id = p_company_id;
  get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('invoices', v_count);
  delete from public.jde_quotations where company_id = p_company_id;
  get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('quotations', v_count);
  delete from public.jde_purchase_orders where company_id = p_company_id;
  get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('purchases', v_count);
  delete from public.jde_grns where company_id = p_company_id;
  delete from public.jde_expenses where company_id = p_company_id;
  get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('expenses', v_count);
  -- AI digests summarised the sales just deleted; left behind, they would describe a business that
  -- no longer has those records.
  delete from public.jde_ai_cache where company_id = p_company_id;

  -- People: customers go, suppliers stay with nothing owed either way.
  delete from public.jde_customers where company_id = p_company_id;
  get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('customers', v_count);
  update public.jde_suppliers set balance = 0 where company_id = p_company_id;
  get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('suppliers_kept', v_count);

  -- Parts: names, numbers, fitment, brand, category, location, HSN, reorder level and photos stay.
  update public.jde_products
     set current_stock = 0, cost_price = 0, sale_price = 0, mrp = 0
   where company_id = p_company_id;
  get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('parts_cleared', v_count);

  return v_counts;
end
$function$;

revoke execute on function public.jde_reset_company_data(text, text) from public;
revoke execute on function public.jde_reset_company_data(text, text) from anon;
revoke execute on function public.jde_reset_company_data(text, text) from authenticated;
grant execute on function public.jde_reset_company_data(text, text) to service_role;
