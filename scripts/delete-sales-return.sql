-- Undoing a credit note.
--
-- There was no way to do this at all. A return could be recorded but never taken back, which is
-- why three identical credit notes against INV-1013 — SRN-1003, SRN-1004 and SRN-1005, the same
-- two lines, five and nine minutes apart, ₹3,500 each — sat in the live data for over a week and
-- needed a database console to even look at. Recording a return is a normal thing to get wrong;
-- being unable to correct it is not.
--
-- What deleting one has to put back:
--
--   stock      the goods come back off the shelf. Newest layer first, the mirror of how the
--              return put them on. A damaged-condition line never moved stock, so it moves none
--              back. Refused outright if the goods are no longer there to take — correcting that
--              is a stock decision, not something a delete should quietly force.
--
--   invoice    ONLY when this credit note's lines still point at the invoice lines they came
--              from. Editing an invoice replaces every line with a new row, so a credit note
--              recorded before an edit no longer has any bearing on the invoice's total — it was
--              rewritten by the edit. Adding the credit back there would invent money the customer
--              never owed. This is exactly the state INV-1013 is in, and getting it wrong would
--              turn a ₹13,000 invoice the customer has paid in full into a ₹16,500 one.
--
--   balance    follows the invoice, and only when the invoice is restored.
--
-- Deliberately refused where the invoice carries a settlement write-off. Creating the return
-- capped that write-off against the reduced total and kept no record of what it had been, so it
-- cannot be put back faithfully. Better to refuse and say so than to guess at forgiven debt.
-- No invoice in the live data carries one today.
--
-- Grants match every other jde_ function: Supabase hands EXECUTE to anon and authenticated as
-- explicit grants that "revoke from public" does not remove, so they are revoked by name.

create or replace function public.jde_delete_sales_return(p_company_id text, p_return_id text)
returns table(id text, credit_total numeric, invoice_restored boolean)
language plpgsql
set search_path to 'public'
as $function$
declare
  v_return public.jde_sales_returns%rowtype;
  v_invoice public.jde_invoices%rowtype;
  v_item record;
  v_layer record;
  v_remaining numeric;
  v_take numeric;
  v_lines_live boolean;
  v_has_invoice boolean;
  v_units integer := 0;
  v_old_due numeric;
  v_new_total numeric;
  v_new_paid numeric;
  v_new_due numeric;
  v_restore_invoice boolean := false;
begin
  if coalesce(trim(p_company_id), '') = '' or coalesce(trim(p_return_id), '') = '' then
    raise exception 'Company and credit note are required.';
  end if;

  perform pg_advisory_xact_lock(hashtext('jde-sales-return:' || p_return_id));

  select * into v_return from public.jde_sales_returns r
   where r.id = p_return_id and r.company_id = p_company_id
     for update;
  if not found then
    raise exception 'Credit note % was not found for the active company.', p_return_id;
  end if;

  select * into v_invoice from public.jde_invoices inv
   where inv.id = v_return.invoice_id and inv.company_id = p_company_id
     for update;
  v_has_invoice := found;

  if v_has_invoice and coalesce(v_invoice.settlement_write_off, 0) > 0 then
    raise exception 'Invoice % was settled for less than it was billed for, so this credit note cannot be undone automatically — the two overlap. Reopen the settlement first.', v_invoice.id;
  end if;

  -- True only when every line of this credit note still points at a live invoice line. Anything
  -- else means the invoice was rebuilt after the return, and its figures no longer include it.
  select not exists (
    select 1
      from public.jde_sales_return_items sri
      left join public.jde_invoice_items ii on ii.id = sri.invoice_item_id
     where sri.sales_return_id = p_return_id
       and sri.company_id = p_company_id
       and ii.id is null
  ) into v_lines_live;
  v_restore_invoice := v_has_invoice and v_lines_live;

  for v_item in
    select sri.* from public.jde_sales_return_items sri
     where sri.sales_return_id = p_return_id and sri.company_id = p_company_id
  loop
    v_units := v_units + v_item.qty::integer;
    -- A damaged return never went back on the shelf, so nothing comes off it now.
    if v_item.product_id is null or coalesce(v_item.condition, 'resellable') = 'damaged' then
      continue;
    end if;

    v_remaining := v_item.qty;
    for v_layer in
      select sl.id, sl.qty_remaining
        from public.jde_stock_layers sl
       where sl.product_id = v_item.product_id
         and sl.company_id = p_company_id
         and sl.qty_remaining > 0
       order by sl.created_at desc, sl.id desc
         for update
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, v_layer.qty_remaining);
      update public.jde_stock_layers sl
         set qty_remaining = sl.qty_remaining - v_take
       where sl.id = v_layer.id;
      v_remaining := v_remaining - v_take;
    end loop;

    if v_remaining > 0 then
      raise exception 'Undoing this credit note needs % of a part back off the shelf, and only % are there. Correct the stock before undoing it.', v_item.qty, v_item.qty - v_remaining;
    end if;

    update public.jde_products p
       set current_stock = p.current_stock - v_item.qty
     where p.id = v_item.product_id and p.company_id = p_company_id;
  end loop;

  if v_restore_invoice then
    v_old_due := greatest(coalesce(v_invoice.total, 0) - coalesce(v_invoice.paid, 0), 0);
    v_new_total := coalesce(v_invoice.total, 0) + coalesce(v_return.credit_total, 0);
    -- The return capped `paid` at the reduced total and recorded the excess as the refund owed;
    -- putting that back is what makes a fully-paid invoice read as fully paid again.
    v_new_paid := coalesce(v_invoice.paid, 0) + coalesce(v_return.refund_or_credit_amount, 0);
    v_new_due := greatest(v_new_total - v_new_paid, 0);

    update public.jde_invoices inv
       set total = v_new_total,
           paid = v_new_paid,
           items = coalesce(inv.items, 0) + v_units,
           discount_amount = coalesce(inv.discount_amount, 0) + coalesce(v_return.discount_amount, 0),
           gst_amount = coalesce(inv.gst_amount, 0) + coalesce(v_return.gst_amount, 0),
           status = case
                      when v_new_paid >= v_new_total then 'paid'
                      when v_new_paid > 0 then 'partial'
                      else 'unpaid'
                    end
     where inv.id = v_invoice.id and inv.company_id = p_company_id;

    if v_return.customer_id is not null then
      perform public.jde_adjust_customer_balance(v_return.customer_id, v_new_due - v_old_due);
    end if;
  end if;

  delete from public.jde_sales_return_items sri
   where sri.sales_return_id = p_return_id and sri.company_id = p_company_id;
  delete from public.jde_sales_returns r
   where r.id = p_return_id and r.company_id = p_company_id;

  return query select v_return.id, v_return.credit_total, v_restore_invoice;
end
$function$;

revoke execute on function public.jde_delete_sales_return(text, text) from public;
revoke execute on function public.jde_delete_sales_return(text, text) from anon;
revoke execute on function public.jde_delete_sales_return(text, text) from authenticated;
grant execute on function public.jde_delete_sales_return(text, text) to service_role;
