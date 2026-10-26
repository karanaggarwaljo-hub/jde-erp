-- Fixes from the operation audit of 26 October 2026 (database side). Each change is to a function
-- the app already calls, or a new one; no table data is rewritten. Rollback-tested on the test
-- company before applying, as migration audit_fixes_2026_10_26.
--
--   1. jde_save_sales_invoice   works out what the customer owed before and after an edit from the
--                               saved invoice, not from figures the browser sends; refuses an edit
--                               that would leave less paid than receipts already record against it;
--                               checks the customer and every part belong to the company; numbers new
--                               bills under a lock so two computers cannot clash.
--   2. jde_receive_customer_payment  refuses a parked draft or a cancelled bill.
--   3. jde_create_sales_return       likewise.
--   4. jde_delete_sales_invoice      checks the customer is the bill's own.
--   5. jde_receive_purchase_stock    receives an order once only, in its own company.
--   6. jde_correct_oldest_layer_cost leaves a purchased batch's cost alone.
--   7. jde_reset_company_data        also clears job cards, cheques, cheque/bank money records and
--                                    bill-PDF records, inside the same transaction.
--   8. jde_open_import_layers (new)  gives parts imported with stock their opening batch.
--   9. jde_set_product_stock (new)   sets a counted stock figure under a lock (Edit Part).

-- ── 1. Saving a sales invoice ───────────────────────────────────────────────────────────────
create or replace function public.jde_save_sales_invoice(p_company_id text, p_invoice_id text, p_is_edit boolean, p_customer_label text, p_old_customer_id text, p_new_customer_id text, p_old_outstanding numeric, p_new_outstanding numeric, p_date text, p_items jsonb, p_total numeric, p_paid numeric, p_status text, p_mode text, p_discount_percent numeric, p_discount_amount numeric, p_gst_percent numeric DEFAULT NULL::numeric, p_gst_amount numeric DEFAULT NULL::numeric, p_gst_mode text DEFAULT NULL::text)
 returns jde_invoices
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_invoice_id text;
  v_old public.jde_invoices%rowtype;
  v_old_customer_id text;
  v_old_item record;
  v_item jsonb;
  v_new_item_id uuid;
  v_items_count numeric := 0;
  v_return_count integer;
  v_allocated numeric := 0;
  v_receipts text;
  v_old_due numeric := 0;
  v_new_due numeric;
  result jde_invoices;
begin
  -- The customer named on the bill has to be this company's, and the one the bill is made out to.
  if p_new_customer_id is not null and not exists (
    select 1 from public.jde_customers c where c.id = p_new_customer_id and c.company_id = p_company_id and c.name = p_customer_label) then
    raise exception 'That customer was not found in this company.';
  end if;
  -- And so does every part on it.
  if exists (
    select 1 from jsonb_array_elements(p_items) x
     where nullif(x->>'product_id', '') is not null
       and not exists (select 1 from public.jde_products p where p.id = x->>'product_id' and p.company_id = p_company_id)) then
    raise exception 'A part on this bill was not found in this company.';
  end if;

  if p_is_edit then
    v_invoice_id := p_invoice_id;
    select * into v_old from jde_invoices inv where inv.id = v_invoice_id and inv.company_id = p_company_id for update;
    if not found then
      raise exception 'Invoice not found for the active company.';
    end if;
    if v_old.status = 'cancelled' then
      raise exception 'Invoice % is cancelled and cannot be edited.', v_invoice_id;
    end if;
    if coalesce(v_old.settlement_write_off, 0) > 0 then
      raise exception 'This invoice was settled short — ₹% was written off, so its amounts can no longer be changed. Remove that settlement first if it needs editing.', round(v_old.settlement_write_off, 2);
    end if;
    select count(*) into v_return_count from jde_sales_returns sr where sr.invoice_id = v_invoice_id and sr.company_id = p_company_id;
    if v_return_count > 0 then
      raise exception 'Goods have already been returned against this invoice (% return(s) recorded), so its items can no longer be changed. Editing it would detach those returns and let the same goods be returned again.', v_return_count;
    end if;
    -- Money received against the bill through receipts stays received. An edit made on another
    -- computer that had not yet seen a receipt, or one that cuts the bill below what was paid,
    -- would otherwise quietly undo it.
    select coalesce(sum(pa.amount), 0), string_agg(distinct pa.payment_id, ', ') into v_allocated, v_receipts
      from public.jde_payment_allocations pa where pa.invoice_id = v_invoice_id and pa.company_id = p_company_id;
    if v_allocated > coalesce(p_total, 0) + 0.005 then
      raise exception 'Receipt % records ₹% against this bill, more than its new total of ₹%. Delete or change that receipt first.', v_receipts, round(v_allocated, 2), round(p_total, 2);
    end if;
    if coalesce(p_paid, 0) + 0.005 < v_allocated then
      raise exception 'Receipt % records ₹% against this bill since it was opened here. Close the bill, open it again and redo the change.', v_receipts, round(v_allocated, 2);
    end if;
    -- What the customer owed on it before this edit, read from the saved bill: nothing for a parked
    -- draft (it never went on their account).
    v_old_due := case when v_old.status = 'draft' then 0 else greatest(coalesce(v_old.total, 0) - coalesce(v_old.paid, 0), 0) end;
    select c.id into v_old_customer_id from public.jde_customers c where c.company_id = p_company_id and c.name = v_old.customer limit 1;
    for v_old_item in select id, product_id from jde_invoice_items where invoice_id = v_invoice_id and company_id = p_company_id
    loop
      if v_old_item.product_id is not null then
        perform jde_restore_stock_layers_for_invoice_item(v_old_item.id);
      end if;
    end loop;
    delete from jde_invoice_items where invoice_id = v_invoice_id and company_id = p_company_id;
  else
    -- One number at a time, so two computers saving together cannot both take the same one.
    perform pg_advisory_xact_lock(hashtext('jde-invoice-number'));
    select 'INV-' || (greatest(coalesce(max(substring(id from '\d+$')::int), 1000), public.jde_number_floor('INV')) + 1) into v_invoice_id from jde_invoices;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_new_item_id := gen_random_uuid();
    v_items_count := v_items_count + coalesce((v_item->>'qty')::numeric, 0);
    insert into jde_invoice_items (id, company_id, invoice_id, product_id, part_number, name, qty, unit_price, line_total, discount_percent, discount_amount)
    values (
      v_new_item_id, p_company_id, v_invoice_id,
      nullif(v_item->>'product_id', ''),
      coalesce(v_item->>'part_number', ''),
      coalesce(v_item->>'name', ''),
      (v_item->>'qty')::numeric,
      (v_item->>'unit_price')::numeric,
      (v_item->>'line_total')::numeric,
      coalesce((v_item->>'discount_percent')::numeric, 0),
      coalesce((v_item->>'discount_amount')::numeric, 0)
    );
    if nullif(v_item->>'product_id', '') is not null then
      perform jde_consume_stock_fifo(v_item->>'product_id', (v_item->>'qty')::numeric, v_new_item_id);
    end if;
  end loop;

  -- What the customer owes on it now: nothing while it is a draft.
  v_new_due := case when p_status = 'draft' then 0 else greatest(coalesce(p_total, 0) - coalesce(p_paid, 0), 0) end;
  if v_old_customer_id is not distinct from p_new_customer_id then
    if p_new_customer_id is not null then
      perform jde_adjust_customer_balance(p_new_customer_id, v_new_due - v_old_due);
    end if;
  else
    if v_old_customer_id is not null then
      perform jde_adjust_customer_balance(v_old_customer_id, -v_old_due);
    end if;
    if p_new_customer_id is not null then
      perform jde_adjust_customer_balance(p_new_customer_id, v_new_due);
    end if;
  end if;

  if p_is_edit then
    update jde_invoices set
      customer = p_customer_label, date = p_date, items = v_items_count::integer,
      total = p_total, paid = p_paid, status = p_status,
      discount_percent = p_discount_percent, discount_amount = p_discount_amount,
      gst_percent = p_gst_percent, gst_amount = p_gst_amount,
      -- An older caller that does not send it leaves what is already recorded alone, rather than
      -- blanking the tax basis of an invoice it was not trying to change.
      gst_mode = coalesce(p_gst_mode, gst_mode)
    where id = v_invoice_id and company_id = p_company_id
    returning * into result;
  else
    insert into jde_invoices (id, company_id, customer, date, items, total, paid, status, mode, discount_percent, discount_amount, gst_percent, gst_amount, gst_mode)
    values (v_invoice_id, p_company_id, p_customer_label, p_date, v_items_count::integer, p_total, p_paid, p_status, p_mode, p_discount_percent, p_discount_amount, p_gst_percent, p_gst_amount, p_gst_mode)
    returning * into result;
  end if;

  return result;
end;
$function$;

-- ── 2–4. Small guards, inserted into the existing functions at an exact place ──────────────────
do $patch$
declare d text; anchor text;
begin
  -- 2. Payments: never against a draft or a cancelled bill; a bill settled short owes nothing more.
  d := pg_get_functiondef('public.jde_receive_customer_payment(text,text,text,numeric,text,jsonb)'::regprocedure);
  anchor := $a$if v_invoice.customer is distinct from v_customer.name then raise exception 'Invoice % does not belong to this customer.', v_line.invoice_id; end if;$a$;
  if position(anchor in d) = 0 then raise exception 'payment: anchor not found'; end if;
  d := replace(d, anchor, anchor || $b$
    if v_invoice.status = 'draft' then raise exception 'Invoice % is a parked draft, not a bill yet — confirm it before taking payment against it.', v_line.invoice_id; end if;
    if v_invoice.status = 'cancelled' then raise exception 'Invoice % is cancelled — nothing can be paid against it.', v_line.invoice_id; end if;$b$);
  anchor := $a$v_old_due := greatest(coalesce(v_invoice.total,0) - coalesce(v_invoice.paid,0), 0);$a$;
  if position(anchor in d) = 0 then raise exception 'payment: due anchor not found'; end if;
  d := replace(d, anchor, $b$v_old_due := greatest(coalesce(v_invoice.total,0) - coalesce(v_invoice.paid,0) - coalesce(v_invoice.settlement_write_off,0), 0);$b$);
  execute d;

  -- 3. Returns: never against a draft or a cancelled bill.
  d := pg_get_functiondef('public.jde_create_sales_return(text,text,text,text,jsonb)'::regprocedure);
  anchor := $a$if not found then raise exception 'Invoice not found for the active company.'; end if;$a$;
  if position(anchor in d) = 0 then raise exception 'return: anchor not found'; end if;
  d := replace(d, anchor, anchor || $b$
  if v_invoice.status = 'draft' then raise exception 'Invoice % is a parked draft — take the goods off the draft instead of returning them.', p_invoice_id; end if;
  if v_invoice.status = 'cancelled' then raise exception 'Invoice % is cancelled — its goods are already back in stock.', p_invoice_id; end if;$b$);
  execute d;

  -- 4. Deleting a bill: the customer whose balance is changed must be the bill's own.
  d := pg_get_functiondef('public.jde_delete_sales_invoice(text,text,text)'::regprocedure);
  anchor := $a$if not found then raise exception 'Invoice not found for the active company.'; end if;$a$;
  if position(anchor in d) = 0 then raise exception 'delete: anchor not found'; end if;
  d := replace(d, anchor, anchor || $b$
  if p_customer_id is not null and not exists (select 1 from public.jde_customers c where c.id = p_customer_id and c.company_id = p_company_id and c.name = v_invoice.customer) then
    raise exception 'The customer does not match this invoice.';
  end if;$b$);
  execute d;

  -- 6. A cost correction typed on a part leaves batches that came from a purchase at what was paid.
  d := pg_get_functiondef('public.jde_correct_oldest_layer_cost(text,numeric)'::regprocedure);
  anchor := 'WHERE product_id = p_product_id AND qty_remaining > 0';
  if position(anchor in d) = 0 then raise exception 'cost: anchor not found'; end if;
  d := replace(d, anchor, 'WHERE product_id = p_product_id AND qty_remaining > 0 AND source_po_id IS NULL');
  execute d;

  -- 7. Start fresh: the newer records go in the same transaction as everything else.
  d := pg_get_functiondef('public.jde_reset_company_data(text,text)'::regprocedure);
  anchor := 'delete from public.jde_ai_cache where company_id = p_company_id;';
  if position(anchor in d) = 0 then raise exception 'reset: anchor not found'; end if;
  d := replace(d, anchor, $b$delete from public.jde_job_cards where company_id = p_company_id;
  get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('job_cards', v_count);
  delete from public.jde_money_entries where company_id = p_company_id;
  delete from public.jde_cheques where company_id = p_company_id;
  get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('cheques', v_count);
  -- The record of each bill's saved PDF goes with the bill; the copies already in Google Drive stay.
  delete from public.jde_invoice_files where company_id = p_company_id;
  -- Supplier bill files are kept (they are the supplier's documents), no longer tied to a purchase.
  update public.jde_purchase_bills set purchase_id = null where company_id = p_company_id and purchase_id is not null;
  $b$ || anchor);
  execute d;
end
$patch$;

-- ── 5. Receiving a purchase order's goods ─────────────────────────────────────────────────────
create or replace function public.jde_receive_purchase_stock(p_company_id text, p_po_id text, p_supplier_name text, p_received_at text, p_items jsonb)
 returns jde_purchase_orders
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_po public.jde_purchase_orders%rowtype;
  v_grn_id text;
  v_line record;
  result jde_purchase_orders;
begin
  -- Once only, and only this company's order: a second click (or a second computer showing an old
  -- list) must not put the same goods into stock twice.
  select * into v_po from public.jde_purchase_orders po where po.id = p_po_id and po.company_id = p_company_id for update;
  if not found then raise exception 'Purchase % was not found in this company.', p_po_id; end if;
  if v_po.status = 'received' then raise exception 'Purchase % has already been received — its goods are in stock.', p_po_id; end if;

  -- The order's own lines when it has them, else the lines sent; every part must be this company's.
  if exists (select 1 from public.jde_po_items pi where pi.po_id = p_po_id and pi.company_id = p_company_id) then
    p_items := (select coalesce(jsonb_agg(jsonb_build_object('product_id', pi.product_id, 'qty', pi.qty, 'unit_cost', pi.unit_cost)), '[]'::jsonb)
                  from public.jde_po_items pi where pi.po_id = p_po_id and pi.company_id = p_company_id);
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
     where nullif(x->>'product_id', '') is not null
       and not exists (select 1 from public.jde_products p where p.id = x->>'product_id' and p.company_id = p_company_id)) then
    raise exception 'A part on purchase % was not found in this company.', p_po_id;
  end if;

  perform pg_advisory_xact_lock(hashtext('jde-grn-number'));
  select 'GRN-' || (greatest(coalesce(max(substring(id from '\d+$')::int), 1000), public.jde_number_floor('GRN')) + 1) into v_grn_id from jde_grns;
  insert into jde_grns (id, company_id, po_number, supplier, received_at, status)
  values (v_grn_id, p_company_id, p_po_id, p_supplier_name, p_received_at, 'verified');

  for v_line in select * from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as x(product_id text, qty numeric, unit_cost numeric)
  loop
    if nullif(v_line.product_id, '') is not null and coalesce(v_line.qty, 0) > 0 then
      perform jde_add_stock_layer(v_line.product_id, v_line.qty, coalesce(v_line.unit_cost, 0), p_po_id, true);
    end if;
  end loop;

  update jde_purchase_orders set status = 'received' where id = p_po_id and company_id = p_company_id returning * into result;
  return result;
end;
$function$;

-- The older six-argument form (a caller-chosen GRN number) is no longer called; it now takes the
-- same checked path, so it cannot be used to receive an order twice either.
create or replace function public.jde_receive_purchase_stock(p_company_id text, p_po_id text, p_grn_id text, p_supplier_name text, p_received_at text, p_items jsonb)
 returns jde_purchase_orders
 language sql
 set search_path to 'public'
as $function$
  select public.jde_receive_purchase_stock(p_company_id, p_po_id, p_supplier_name, p_received_at, p_items);
$function$;

-- ── 8. Opening batches for parts imported from a file with stock ─────────────────────────────
create or replace function public.jde_open_import_layers(p_company_id text, p_product_ids text[])
 returns integer
 language plpgsql
 set search_path to 'public'
as $function$
declare v_count integer;
begin
  -- The count imported becomes an opening batch at the part's own cost, exactly as adding a part
  -- by hand does (jde_create_product), so cost of goods and stock value have something to draw on.
  insert into public.jde_stock_layers (company_id, product_id, unit_cost, qty_remaining, qty_original, source_po_id)
  select p.company_id, p.id, coalesce(p.cost_price, 0), p.current_stock, p.current_stock, null
    from public.jde_products p
   where p.company_id = p_company_id and p.id = any(p_product_ids) and p.current_stock > 0
     and not exists (select 1 from public.jde_stock_layers sl where sl.product_id = p.id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- ── 9. Setting a counted stock figure ─────────────────────────────────────────────────────────
create or replace function public.jde_set_product_stock(p_company_id text, p_product_id text, p_target numeric, p_unit_cost numeric)
 returns numeric
 language plpgsql
 set search_path to 'public'
as $function$
declare v_current numeric; v_delta numeric;
begin
  if p_target is null or p_target < 0 then raise exception 'Stock cannot be below zero.'; end if;
  -- The difference is worked out here, against the stock as it is at this moment, so a sale made on
  -- another computer while the form was open is not lost.
  select current_stock into v_current from public.jde_products where id = p_product_id and company_id = p_company_id for update;
  if not found then raise exception 'That part was not found in this company.'; end if;
  v_delta := p_target - coalesce(v_current, 0);
  if v_delta > 0 then
    perform public.jde_add_stock_layer(p_product_id, v_delta, coalesce(p_unit_cost, 0), null, true);
  elsif v_delta < 0 then
    perform public.jde_consume_stock_fifo(p_product_id, -v_delta, null);
  end if;
  return v_delta;
end;
$function$;

revoke all on function public.jde_open_import_layers(text, text[]) from public, anon, authenticated;
grant execute on function public.jde_open_import_layers(text, text[]) to service_role;
revoke all on function public.jde_set_product_stock(text, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.jde_set_product_stock(text, text, numeric, numeric) to service_role;

-- ── Separately applied: migration lock_legacy_erp_tables ─────────────────────────────────────
-- The erp_* tables are left over from an older version of the app; nothing reads them (checked in
-- this repo and every project folder on this computer). They were open to any signed-in Supabase
-- session through the policy "Allow authenticated access" (qual true). Their data (4 customers,
-- 8 products, 4 suppliers, 1 settings row …) is kept; only outside access is removed. To undo:
--   grant all on public.<table> to authenticated;
--   create policy "Allow authenticated access" on public.<table> for all to authenticated using (true) with check (true);
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='public' and tablename like 'erp\_%' loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('drop policy if exists "Allow authenticated access" on public.%I', t);
  end loop;
end $$;
