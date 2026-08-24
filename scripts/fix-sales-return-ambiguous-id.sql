-- Fix: sales returns always failed with 'column reference "id" is ambiguous'.
--
-- jde_create_sales_return is declared `returns table(id text, credit_total numeric)`, which makes
-- "id" an output *variable* for the entire function body. Every unqualified `id` column reference
-- inside it was therefore ambiguous, and Postgres refused the very first statement — so no sales
-- return could ever be recorded, for any invoice.
--
-- This replaces the function with an identical one in which every column reference is
-- table-qualified. No data is read, written, or migrated; only the function body changes, and
-- re-running it is harmless.
--
-- Run in Supabase -> SQL Editor, or: psql "$DATABASE_URL" -f scripts/fix-sales-return-ambiguous-id.sql

create or replace function public.jde_create_sales_return(p_company_id text,p_invoice_id text,p_customer_id text,p_reason text,p_items jsonb)
-- NOTE: `returns table(id text, ...)` makes `id` an output *variable* for this whole body, so
-- every column reference below must stay table-qualified. An unqualified `id` raises
-- 'column reference "id" is ambiguous' at runtime and no return can be recorded at all.
returns table(id text,credit_total numeric) language plpgsql set search_path = public as $fn$
declare v_invoice public.jde_invoices%rowtype; v_customer public.jde_customers%rowtype; v_item public.jde_invoice_items%rowtype;
  v_line record; v_consume record; v_id text; v_subtotal numeric:=0; v_discount numeric; v_gst numeric; v_credit numeric;
  v_old_due numeric; v_new_total numeric; v_new_paid numeric; v_new_due numeric; v_refund numeric; v_returned numeric; v_remaining numeric; v_restore numeric; v_units numeric:=0;
begin
  if coalesce(trim(p_company_id),'')='' or coalesce(trim(p_invoice_id),'')='' or coalesce(trim(p_reason),'')='' then raise exception 'Company, invoice, and return reason are required.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Select at least one invoice line.'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(invoice_item_id uuid,qty numeric) where qty is null or qty<=0) or exists(select invoice_item_id from jsonb_to_recordset(p_items) as x(invoice_item_id uuid,qty numeric) group by invoice_item_id having count(*)>1) then raise exception 'Return quantities must be positive and unique by invoice line.'; end if;
  perform pg_advisory_xact_lock(hashtext('jde-sales-return:'||p_invoice_id));
  select * into v_invoice from public.jde_invoices inv where inv.id=p_invoice_id and inv.company_id=p_company_id for update;
  if not found then raise exception 'Invoice not found for the active company.'; end if;
  if p_customer_id is not null then select * into v_customer from public.jde_customers c where c.id=p_customer_id and c.company_id=p_company_id; if not found or v_customer.name is distinct from v_invoice.customer then raise exception 'The customer does not match this invoice.'; end if; end if;
  for v_line in select * from jsonb_to_recordset(p_items) as x(invoice_item_id uuid,qty numeric) loop
    select * into v_item from public.jde_invoice_items ii where ii.id=v_line.invoice_item_id and ii.company_id=p_company_id and ii.invoice_id=p_invoice_id for update;
    if not found then raise exception 'A selected line does not belong to this invoice.'; end if;
    select coalesce(sum(sri.qty),0) into v_returned from public.jde_sales_return_items sri where sri.company_id=p_company_id and sri.invoice_item_id=v_item.id;
    if v_line.qty > v_item.qty-v_returned then raise exception 'Return quantity exceeds the remaining quantity for %.',v_item.part_number; end if;
    v_subtotal:=v_subtotal+round(v_item.unit_price*v_line.qty,2); v_units:=v_units+v_line.qty;
  end loop;
  v_discount:=round(v_subtotal*coalesce(v_invoice.discount_percent,0)/100,2); v_gst:=round((v_subtotal-v_discount)*coalesce(v_invoice.gst_percent,0)/100,2); v_credit:=round(v_subtotal-v_discount+v_gst,2);
  v_old_due:=greatest(coalesce(v_invoice.total,0)-coalesce(v_invoice.paid,0),0); v_new_total:=greatest(coalesce(v_invoice.total,0)-v_credit,0); v_new_paid:=least(coalesce(v_invoice.paid,0),v_new_total); v_new_due:=greatest(v_new_total-v_new_paid,0); v_refund:=greatest(coalesce(v_invoice.paid,0)-v_new_total,0);
  perform pg_advisory_xact_lock(hashtext('jde-sales-return-number'));
  select 'SRN-'||(coalesce(max(nullif(regexp_replace(sr.id,'[^0-9]','','g'),'')::int),1000)+1) into v_id from public.jde_sales_returns sr;
  insert into public.jde_sales_returns(id,company_id,invoice_id,customer_id,reason,subtotal,discount_amount,gst_amount,credit_total,refund_or_credit_amount) values(v_id,p_company_id,p_invoice_id,p_customer_id,trim(p_reason),v_subtotal,v_discount,v_gst,v_credit,v_refund);
  for v_line in select * from jsonb_to_recordset(p_items) as x(invoice_item_id uuid,qty numeric) loop
    select * into v_item from public.jde_invoice_items ii where ii.id=v_line.invoice_item_id;
    insert into public.jde_sales_return_items(sales_return_id,company_id,invoice_item_id,product_id,qty,unit_price,line_total) values(v_id,p_company_id,v_item.id,v_item.product_id,v_line.qty,v_item.unit_price,round(v_item.unit_price*v_line.qty,2));
    if v_item.product_id is not null then
      v_remaining:=v_line.qty;
      for v_consume in select sc.id,sc.layer_id,sc.qty from public.jde_stock_consumptions sc join public.jde_stock_layers sl on sl.id=sc.layer_id where sc.invoice_item_id=v_item.id and sc.company_id=p_company_id order by sl.created_at desc,sc.id desc for update of sc,sl loop
        exit when v_remaining<=0; v_restore:=least(v_remaining,v_consume.qty); if v_consume.layer_id is null then raise exception 'FIFO audit is incomplete for %.',v_item.part_number; end if;
        update public.jde_stock_layers sl set qty_remaining=sl.qty_remaining+v_restore where sl.id=v_consume.layer_id;
        if v_restore=v_consume.qty then delete from public.jde_stock_consumptions sc where sc.id=v_consume.id; else update public.jde_stock_consumptions sc set qty=sc.qty-v_restore where sc.id=v_consume.id; end if;
        v_remaining:=v_remaining-v_restore;
      end loop;
      if v_remaining>0 then raise exception 'FIFO audit is incomplete for %.',v_item.part_number; end if;
      update public.jde_products p set current_stock=p.current_stock+v_line.qty where p.id=v_item.product_id and p.company_id=p_company_id;
    end if;
  end loop;
  update public.jde_invoices inv set total=v_new_total,paid=v_new_paid,items=greatest(coalesce(inv.items,0)-v_units::integer,0),discount_amount=greatest(coalesce(inv.discount_amount,0)-v_discount,0),gst_amount=greatest(coalesce(inv.gst_amount,0)-v_gst,0),status=case when v_new_paid>=v_new_total then 'paid' when v_new_paid>0 then 'partial' else 'unpaid' end where inv.id=p_invoice_id and inv.company_id=p_company_id;
  if p_customer_id is not null then perform public.jde_adjust_customer_balance(p_customer_id,v_new_due-v_old_due); end if;
  return query select v_id,v_credit;
end $fn$;

revoke all on function public.jde_create_sales_return(text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.jde_create_sales_return(text,text,text,text,jsonb) to service_role;
