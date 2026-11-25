-- An invoice number typed by hand (November 2026). jde_save_sales_invoice already took p_invoice_id
-- and ignored it on a new bill; now a new bill uses it when one is typed, after the GST Rule 46
-- checks (at most 16 letters, numbers, - and /, with a number in it) and a check that no bill
-- already has it (in any company: the id is the table's key). Left blank, the bill is numbered as
-- before. The automatic number now counts only INV-<digits> numbers, so a typed number of another
-- shape (JDE/25-26/001, or a long run of digits) neither moves the sequence nor breaks it.
-- Same signature, so CREATE OR REPLACE keeps the function's grants; only the "new bill" branch changed.
CREATE OR REPLACE FUNCTION public.jde_save_sales_invoice(p_company_id text, p_invoice_id text, p_is_edit boolean, p_customer_label text, p_old_customer_id text, p_new_customer_id text, p_old_outstanding numeric, p_new_outstanding numeric, p_date text, p_items jsonb, p_total numeric, p_paid numeric, p_status text, p_mode text, p_discount_percent numeric, p_discount_amount numeric, p_gst_percent numeric DEFAULT NULL::numeric, p_gst_amount numeric DEFAULT NULL::numeric, p_gst_mode text DEFAULT NULL::text)
 RETURNS jde_invoices
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    if nullif(btrim(coalesce(p_invoice_id, '')), '') is not null then
      -- Typed by hand on the bill.
      v_invoice_id := upper(btrim(p_invoice_id));
      if length(v_invoice_id) > 16 or v_invoice_id !~ '^[A-Z0-9/-]+$' or v_invoice_id !~ '[0-9]' then
        raise exception 'Invoice number % cannot be used: use up to 16 letters, numbers, - or /, with at least one number.', v_invoice_id;
      end if;
      if exists (select 1 from jde_invoices inv where upper(inv.id) = v_invoice_id) then
        raise exception '% is already used by another bill. Type a different number, or leave it blank for the next one.', v_invoice_id;
      end if;
    else
      select 'INV-' || (greatest(coalesce(max(substring(id from '^INV-(\d{1,9})$')::int), 1000), public.jde_number_floor('INV')) + 1) into v_invoice_id from jde_invoices;
    end if;
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
