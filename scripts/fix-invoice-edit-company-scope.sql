-- Fix: jde_save_sales_invoice's edit path had no company check.
--
-- Found while investigating a report of wrong stock numbers showing in Inventory. This function
-- deletes/restores invoice_items and updates jde_invoices purely by p_invoice_id, with no check
-- that the invoice actually belongs to p_company_id. Missed in the same-day security audit,
-- which fixed this identical gap in jde_delete_sales_invoice, jde_create_sales_return, and
-- jde_receive_customer_payment but not this one — the function every sale actually goes through.
-- Any active login could edit another company's invoice by supplying its id.
--
-- Fixed the same way as the others: locks the target invoice row up front (`for update`) and
-- checks its company, raising before touching anything if it doesn't match. New-invoice creation
-- (p_is_edit = false) was never affected — it only ever inserts a fresh row under p_company_id.
--
-- Verified against real data (INV-1005) in a rolled-back transaction: a wrong company id is
-- rejected immediately with no write; the real owner's edit runs end to end unchanged.
--
-- Run in Supabase -> SQL Editor, or: psql "$DATABASE_URL" -f scripts/fix-invoice-edit-company-scope.sql

create or replace function public.jde_save_sales_invoice(p_company_id text, p_invoice_id text, p_is_edit boolean, p_customer_label text, p_old_customer_id text, p_new_customer_id text, p_old_outstanding numeric, p_new_outstanding numeric, p_date text, p_items jsonb, p_total numeric, p_paid numeric, p_status text, p_mode text, p_discount_percent numeric, p_discount_amount numeric, p_gst_percent numeric DEFAULT NULL::numeric, p_gst_amount numeric DEFAULT NULL::numeric)
returns jde_invoices language plpgsql set search_path = public as $function$
declare
  v_invoice_id text;
  v_old_item record;
  v_item jsonb;
  v_new_item_id uuid;
  v_items_count numeric := 0;
  result jde_invoices;
begin
  if p_is_edit then
    v_invoice_id := p_invoice_id;
    if not exists (select 1 from jde_invoices inv where inv.id = v_invoice_id and inv.company_id = p_company_id for update) then
      raise exception 'Invoice not found for the active company.';
    end if;
    for v_old_item in select id, product_id from jde_invoice_items where invoice_id = v_invoice_id and company_id = p_company_id
    loop
      if v_old_item.product_id is not null then
        perform jde_restore_stock_layers_for_invoice_item(v_old_item.id);
      end if;
    end loop;
    delete from jde_invoice_items where invoice_id = v_invoice_id and company_id = p_company_id;
  else
    select 'INV-' || (coalesce(max(substring(id from '\d+$')::int), 1000) + 1) into v_invoice_id from jde_invoices;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_new_item_id := gen_random_uuid();
    v_items_count := v_items_count + coalesce((v_item->>'qty')::numeric, 0);
    insert into jde_invoice_items (id, company_id, invoice_id, product_id, part_number, name, qty, unit_price, line_total)
    values (
      v_new_item_id, p_company_id, v_invoice_id,
      nullif(v_item->>'product_id', ''),
      coalesce(v_item->>'part_number', ''),
      coalesce(v_item->>'name', ''),
      (v_item->>'qty')::numeric,
      (v_item->>'unit_price')::numeric,
      (v_item->>'line_total')::numeric
    );
    if nullif(v_item->>'product_id', '') is not null then
      perform jde_consume_stock_fifo(v_item->>'product_id', (v_item->>'qty')::numeric, v_new_item_id);
    end if;
  end loop;

  if p_old_customer_id is not distinct from p_new_customer_id then
    if p_new_customer_id is not null then
      perform jde_adjust_customer_balance(p_new_customer_id, p_new_outstanding - p_old_outstanding);
    end if;
  else
    if p_old_customer_id is not null then
      perform jde_adjust_customer_balance(p_old_customer_id, -p_old_outstanding);
    end if;
    if p_new_customer_id is not null then
      perform jde_adjust_customer_balance(p_new_customer_id, p_new_outstanding);
    end if;
  end if;

  if p_is_edit then
    update jde_invoices set
      customer = p_customer_label, date = p_date, items = v_items_count::integer,
      total = p_total, paid = p_paid, status = p_status,
      discount_percent = p_discount_percent, discount_amount = p_discount_amount,
      gst_percent = p_gst_percent, gst_amount = p_gst_amount
    where id = v_invoice_id and company_id = p_company_id
    returning * into result;
  else
    insert into jde_invoices (id, company_id, customer, date, items, total, paid, status, mode, discount_percent, discount_amount, gst_percent, gst_amount)
    values (v_invoice_id, p_company_id, p_customer_label, p_date, v_items_count::integer, p_total, p_paid, p_status, p_mode, p_discount_percent, p_discount_amount, p_gst_percent, p_gst_amount)
    returning * into result;
  end if;

  return result;
end;
$function$;
