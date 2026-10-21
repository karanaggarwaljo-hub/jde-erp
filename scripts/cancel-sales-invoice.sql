-- Cancelling a sales invoice (GST): the invoice keeps its number and stays on record, marked
-- cancelled, instead of being deleted. Its goods go back on the shelf, the customer no longer owes
-- it, and its figures become zero so every report and balance is right without special cases. The
-- invoice exactly as issued is kept in cancelled_copy, so it can still be printed (stamped
-- CANCELLED) — lib/tally-invoice.ts.
--
-- Refused, like deleting, while a payment, a short settlement or a return is recorded against it:
-- those are undone first. Drafts are deleted, not cancelled.
--
-- Additive; rollback-tested on the test company's INV-1005 (stock restored, balance cleared, copy
-- kept, cancelling twice and cancelling a bill with a return both refused). Applied 2026-10-21 as
-- migration cancel_sales_invoice.

alter table public.jde_invoices
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists cancelled_copy jsonb;

create or replace function public.jde_cancel_sales_invoice(p_company_id text, p_invoice_id text, p_customer_id text, p_reason text)
returns void language plpgsql set search_path to 'public' as $function$
declare v_invoice public.jde_invoices%rowtype; v_item record; v_outstanding numeric; v_copy jsonb;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why the invoice is being cancelled.'; end if;
  select * into v_invoice from public.jde_invoices inv where inv.id = p_invoice_id and inv.company_id = p_company_id for update;
  if not found then raise exception 'Invoice not found for the active company.'; end if;
  if v_invoice.status = 'cancelled' then raise exception 'Invoice % is already cancelled.', p_invoice_id; end if;
  if v_invoice.status = 'draft' then raise exception 'A draft is not an invoice yet — delete it instead.'; end if;
  if exists(select 1 from public.jde_payment_allocations pa where pa.invoice_id = p_invoice_id and pa.company_id = p_company_id) then
    raise exception 'A payment has been recorded against this invoice — delete that payment first, then cancel the invoice.';
  end if;
  if coalesce(v_invoice.settlement_write_off, 0) > 0 then
    raise exception 'This invoice was settled short — remove that settlement before cancelling it.';
  end if;
  if exists(select 1 from public.jde_sales_returns sr where sr.invoice_id = p_invoice_id and sr.company_id = p_company_id) then
    raise exception 'Goods have been returned against this invoice — delete the return first, then cancel the invoice.';
  end if;
  if p_customer_id is not null and not exists(select 1 from public.jde_customers c where c.id = p_customer_id and c.company_id = p_company_id and c.name = v_invoice.customer) then
    raise exception 'The customer does not match this invoice.';
  end if;

  -- The invoice exactly as issued, kept so it can still be printed (marked CANCELLED).
  select jsonb_build_object('invoice', to_jsonb(v_invoice), 'items', coalesce(jsonb_agg(to_jsonb(ii) order by ii.id), '[]'::jsonb))
    into v_copy from public.jde_invoice_items ii where ii.invoice_id = p_invoice_id and ii.company_id = p_company_id;

  for v_item in select ii.id, ii.product_id from public.jde_invoice_items ii where ii.invoice_id = p_invoice_id and ii.company_id = p_company_id loop
    if v_item.product_id is not null then perform public.jde_restore_stock_layers_for_invoice_item(v_item.id); end if;
  end loop;
  delete from public.jde_invoice_items ii where ii.invoice_id = p_invoice_id and ii.company_id = p_company_id;

  if p_customer_id is not null then
    v_outstanding := greatest(coalesce(v_invoice.total, 0) - coalesce(v_invoice.paid, 0), 0);
    perform public.jde_adjust_customer_balance(p_customer_id, -v_outstanding);
  end if;

  update public.jde_invoices inv set status = 'cancelled', total = 0, paid = 0, items = 0, discount_amount = 0, gst_amount = 0,
    cancelled_at = now(), cancel_reason = trim(p_reason), cancelled_copy = v_copy
  where inv.id = p_invoice_id and inv.company_id = p_company_id;
end $function$;

revoke all on function public.jde_cancel_sales_invoice(text, text, text, text) from public, anon, authenticated;
grant execute on function public.jde_cancel_sales_invoice(text, text, text, text) to service_role;
