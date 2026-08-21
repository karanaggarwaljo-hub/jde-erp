-- JDE ERP: quotations, sales returns, and purchase returns.
-- The application server invokes these functions only with the Supabase service role.
begin;

alter table public.jde_quotations
  add column if not exists customer_id text,
  add column if not exists subtotal numeric not null default 0,
  add column if not exists discount_percent numeric not null default 0,
  add column if not exists discount_amount numeric not null default 0,
  add column if not exists gst_percent numeric not null default 0,
  add column if not exists gst_amount numeric not null default 0,
  add column if not exists converted_invoice_id text;

create table if not exists public.jde_quotation_items (
  id uuid primary key default gen_random_uuid(), company_id text not null, quotation_id text not null,
  product_id text not null, part_number text not null, name text not null,
  qty numeric not null check (qty > 0), unit_price numeric not null check (unit_price >= 0),
  line_total numeric not null check (line_total >= 0), created_at timestamptz not null default now()
);
create index if not exists jde_quotation_items_lookup on public.jde_quotation_items(company_id, quotation_id, created_at);

create table if not exists public.jde_sales_returns (
  id text primary key, company_id text not null, invoice_id text not null, customer_id text,
  reason text not null, subtotal numeric not null, discount_amount numeric not null default 0,
  gst_amount numeric not null default 0, credit_total numeric not null,
  refund_or_credit_amount numeric not null default 0, created_at timestamptz not null default now()
);
create index if not exists jde_sales_returns_lookup on public.jde_sales_returns(company_id, invoice_id, created_at);
create table if not exists public.jde_sales_return_items (
  id uuid primary key default gen_random_uuid(), sales_return_id text not null references public.jde_sales_returns(id) on delete cascade,
  company_id text not null, invoice_item_id uuid not null, product_id text,
  qty numeric not null check (qty > 0), unit_price numeric not null check (unit_price >= 0), line_total numeric not null check (line_total >= 0)
);
create index if not exists jde_sales_return_items_lookup on public.jde_sales_return_items(company_id, invoice_item_id);

create table if not exists public.jde_purchase_returns (
  id text primary key, company_id text not null, purchase_order_id text not null, supplier_id text not null,
  supplier text not null, note text not null default '', total numeric not null, created_at timestamptz not null default now()
);
create index if not exists jde_purchase_returns_lookup on public.jde_purchase_returns(company_id, purchase_order_id, created_at);
create table if not exists public.jde_purchase_return_items (
  id uuid primary key default gen_random_uuid(), purchase_return_id text not null references public.jde_purchase_returns(id) on delete cascade,
  company_id text not null, po_item_id uuid not null, product_id text not null,
  qty numeric not null check (qty > 0), unit_cost numeric not null check (unit_cost >= 0), line_total numeric not null check (line_total >= 0)
);
create index if not exists jde_purchase_return_items_lookup on public.jde_purchase_return_items(company_id, po_item_id);

alter table public.jde_quotation_items enable row level security;
alter table public.jde_sales_returns enable row level security;
alter table public.jde_sales_return_items enable row level security;
alter table public.jde_purchase_returns enable row level security;
alter table public.jde_purchase_return_items enable row level security;
revoke all on table public.jde_quotation_items, public.jde_sales_returns, public.jde_sales_return_items, public.jde_purchase_returns, public.jde_purchase_return_items from anon, authenticated;
grant select, insert, update, delete on table public.jde_quotation_items, public.jde_sales_returns, public.jde_sales_return_items, public.jde_purchase_returns, public.jde_purchase_return_items to service_role;

create or replace function public.jde_save_quotation(
  p_company_id text, p_quotation_id text, p_is_edit boolean, p_customer_id text, p_customer_label text,
  p_date text, p_validity text, p_items jsonb, p_subtotal numeric, p_discount_percent numeric,
  p_discount_amount numeric, p_gst_percent numeric, p_gst_amount numeric, p_total numeric
) returns public.jde_quotations language plpgsql set search_path = public as $fn$
declare v_id text; v_customer public.jde_customers%rowtype; v_product public.jde_products%rowtype;
  v_line record; v_subtotal numeric := 0; v_discount numeric; v_gst numeric; v_total numeric; v_result public.jde_quotations%rowtype;
begin
  if coalesce(trim(p_company_id),'') = '' or coalesce(trim(p_customer_id),'') = '' or coalesce(trim(p_customer_label),'') = '' then raise exception 'Company and customer are required.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one quotation line.'; end if;
  if coalesce(p_discount_percent,0) not between 0 and 100 or coalesce(p_gst_percent,0) not between 0 and 100 then raise exception 'Discount and GST must be between 0 and 100.'; end if;
  if p_validity::date < p_date::date then raise exception 'The validity date cannot be before the quotation date.'; end if;
  select * into v_customer from public.jde_customers where id = p_customer_id and company_id = p_company_id;
  if not found or v_customer.name is distinct from p_customer_label then raise exception 'The selected customer does not belong to the active company.'; end if;
  for v_line in select * from jsonb_to_recordset(p_items) as x(product_id text, qty numeric, unit_price numeric) loop
    if coalesce(trim(v_line.product_id),'') = '' or coalesce(v_line.qty,0) <= 0 or coalesce(v_line.unit_price,-1) < 0 then raise exception 'Every quotation line needs a product, quantity, and non-negative price.'; end if;
    select * into v_product from public.jde_products where id = v_line.product_id and company_id = p_company_id;
    if not found then raise exception 'A quotation product is not in the active company.'; end if;
    v_subtotal := v_subtotal + round(v_line.qty * v_line.unit_price, 2);
  end loop;
  v_discount := round(v_subtotal * coalesce(p_discount_percent,0) / 100, 2);
  v_gst := round((v_subtotal - v_discount) * coalesce(p_gst_percent,0) / 100, 2);
  v_total := round(v_subtotal - v_discount + v_gst, 2);
  if abs(coalesce(p_subtotal,0)-v_subtotal) > .01 or abs(coalesce(p_discount_amount,0)-v_discount) > .01 or abs(coalesce(p_gst_amount,0)-v_gst) > .01 or abs(coalesce(p_total,0)-v_total) > .01 then raise exception 'Quotation totals do not match its lines.'; end if;
  if p_is_edit then
    select * into v_result from public.jde_quotations where id = p_quotation_id and company_id = p_company_id for update;
    if not found then raise exception 'Quotation not found for the active company.'; end if;
    if v_result.status in ('converted','cancelled') then raise exception 'Converted or cancelled quotations cannot be edited.'; end if;
    v_id := p_quotation_id;
    delete from public.jde_quotation_items where company_id = p_company_id and quotation_id = v_id;
  else
    perform pg_advisory_xact_lock(hashtext('jde-quotation-number'));
    select 'QT-' || (coalesce(max(nullif(regexp_replace(id, '[^0-9]', '', 'g'), '')::int),1000)+1) into v_id from public.jde_quotations;
  end if;
  for v_line in select * from jsonb_to_recordset(p_items) as x(product_id text, qty numeric, unit_price numeric) loop
    select * into v_product from public.jde_products where id = v_line.product_id and company_id = p_company_id;
    insert into public.jde_quotation_items(company_id,quotation_id,product_id,part_number,name,qty,unit_price,line_total)
    values (p_company_id,v_id,v_product.id,v_product.part_number,v_product.name,v_line.qty,v_line.unit_price,round(v_line.qty*v_line.unit_price,2));
  end loop;
  if p_is_edit then
    update public.jde_quotations set customer_id=p_customer_id,customer=p_customer_label,date=p_date,validity=p_validity,subtotal=v_subtotal,discount_percent=coalesce(p_discount_percent,0),discount_amount=v_discount,gst_percent=coalesce(p_gst_percent,0),gst_amount=v_gst,total=v_total where id=v_id and company_id=p_company_id returning * into v_result;
  else
    insert into public.jde_quotations(id,company_id,customer_id,customer,date,validity,subtotal,discount_percent,discount_amount,gst_percent,gst_amount,total,status)
    values(v_id,p_company_id,p_customer_id,p_customer_label,p_date,p_validity,v_subtotal,coalesce(p_discount_percent,0),v_discount,coalesce(p_gst_percent,0),v_gst,v_total,'draft') returning * into v_result;
  end if;
  return v_result;
end $fn$;

create or replace function public.jde_convert_quotation_to_invoice(p_quotation_id text, p_company_id text)
returns table("invoiceId" text) language plpgsql set search_path = public as $fn$
declare v_quote public.jde_quotations%rowtype; v_items jsonb; v_invoice public.jde_invoices%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('jde-quotation:'||coalesce(p_quotation_id,'')));
  select * into v_quote from public.jde_quotations where id=p_quotation_id and company_id=p_company_id for update;
  if not found then raise exception 'Quotation not found for the active company.'; end if;
  if v_quote.status in ('converted','cancelled') then raise exception 'This quotation can no longer be converted.'; end if;
  if coalesce(v_quote.customer_id,'') = '' then raise exception 'This quotation has no saved customer and cannot be converted.'; end if;
  select jsonb_agg(jsonb_build_object('product_id',product_id,'part_number',part_number,'name',name,'qty',qty,'unit_price',unit_price,'line_total',line_total) order by created_at,id) into v_items from public.jde_quotation_items where company_id=p_company_id and quotation_id=p_quotation_id;
  if v_items is null then raise exception 'This quotation has no saved lines.'; end if;
  if exists (select 1 from public.jde_quotation_items qi left join public.jde_products p on p.id=qi.product_id and p.company_id=p_company_id where qi.company_id=p_company_id and qi.quotation_id=p_quotation_id and p.id is null) then raise exception 'A quoted product is no longer available in the active company.'; end if;
  select * into v_invoice from public.jde_save_sales_invoice(p_company_id,null,false,v_quote.customer,null,v_quote.customer_id,0,v_quote.total,v_quote.date,v_items,v_quote.total,0,'unpaid','credit',v_quote.discount_percent,v_quote.discount_amount,v_quote.gst_percent,v_quote.gst_amount);
  update public.jde_quotations set status='converted',converted_invoice_id=v_invoice.id where id=p_quotation_id and company_id=p_company_id;
  return query select v_invoice.id;
end $fn$;

create or replace function public.jde_get_sales_returnable_items(p_company_id text,p_invoice_id text)
returns table(invoice_item_id uuid,product_id text,part_number text,name text,sold_qty numeric,returned_qty numeric,returnable_qty numeric,unit_price numeric,line_total numeric)
language sql security invoker set search_path = public as $fn$
  select ii.id,ii.product_id,ii.part_number,ii.name,ii.qty,coalesce(sum(sri.qty),0),greatest(ii.qty-coalesce(sum(sri.qty),0),0),ii.unit_price,ii.line_total
  from public.jde_invoice_items ii left join public.jde_sales_return_items sri on sri.invoice_item_id=ii.id and sri.company_id=ii.company_id
  where ii.company_id=p_company_id and ii.invoice_id=p_invoice_id
  group by ii.id,ii.product_id,ii.part_number,ii.name,ii.qty,ii.unit_price,ii.line_total order by ii.id;
$fn$;

create or replace function public.jde_create_sales_return(p_company_id text,p_invoice_id text,p_customer_id text,p_reason text,p_items jsonb)
returns table(id text,credit_total numeric) language plpgsql set search_path = public as $fn$
declare v_invoice public.jde_invoices%rowtype; v_customer public.jde_customers%rowtype; v_item public.jde_invoice_items%rowtype;
  v_line record; v_consume record; v_id text; v_subtotal numeric:=0; v_discount numeric; v_gst numeric; v_credit numeric;
  v_old_due numeric; v_new_total numeric; v_new_paid numeric; v_new_due numeric; v_refund numeric; v_returned numeric; v_remaining numeric; v_restore numeric; v_units numeric:=0;
begin
  if coalesce(trim(p_company_id),'')='' or coalesce(trim(p_invoice_id),'')='' or coalesce(trim(p_reason),'')='' then raise exception 'Company, invoice, and return reason are required.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Select at least one invoice line.'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(invoice_item_id uuid,qty numeric) where qty is null or qty<=0) or exists(select invoice_item_id from jsonb_to_recordset(p_items) as x(invoice_item_id uuid,qty numeric) group by invoice_item_id having count(*)>1) then raise exception 'Return quantities must be positive and unique by invoice line.'; end if;
  perform pg_advisory_xact_lock(hashtext('jde-sales-return:'||p_invoice_id));
  select * into v_invoice from public.jde_invoices where id=p_invoice_id and company_id=p_company_id for update;
  if not found then raise exception 'Invoice not found for the active company.'; end if;
  if p_customer_id is not null then select * into v_customer from public.jde_customers where id=p_customer_id and company_id=p_company_id; if not found or v_customer.name is distinct from v_invoice.customer then raise exception 'The customer does not match this invoice.'; end if; end if;
  for v_line in select * from jsonb_to_recordset(p_items) as x(invoice_item_id uuid,qty numeric) loop
    select * into v_item from public.jde_invoice_items where id=v_line.invoice_item_id and company_id=p_company_id and invoice_id=p_invoice_id for update;
    if not found then raise exception 'A selected line does not belong to this invoice.'; end if;
    select coalesce(sum(qty),0) into v_returned from public.jde_sales_return_items where company_id=p_company_id and invoice_item_id=v_item.id;
    if v_line.qty > v_item.qty-v_returned then raise exception 'Return quantity exceeds the remaining quantity for %.',v_item.part_number; end if;
    v_subtotal:=v_subtotal+round(v_item.unit_price*v_line.qty,2); v_units:=v_units+v_line.qty;
  end loop;
  v_discount:=round(v_subtotal*coalesce(v_invoice.discount_percent,0)/100,2); v_gst:=round((v_subtotal-v_discount)*coalesce(v_invoice.gst_percent,0)/100,2); v_credit:=round(v_subtotal-v_discount+v_gst,2);
  v_old_due:=greatest(coalesce(v_invoice.total,0)-coalesce(v_invoice.paid,0),0); v_new_total:=greatest(coalesce(v_invoice.total,0)-v_credit,0); v_new_paid:=least(coalesce(v_invoice.paid,0),v_new_total); v_new_due:=greatest(v_new_total-v_new_paid,0); v_refund:=greatest(coalesce(v_invoice.paid,0)-v_new_total,0);
  perform pg_advisory_xact_lock(hashtext('jde-sales-return-number'));
  select 'SRN-'||(coalesce(max(nullif(regexp_replace(id,'[^0-9]','','g'),'')::int),1000)+1) into v_id from public.jde_sales_returns;
  insert into public.jde_sales_returns(id,company_id,invoice_id,customer_id,reason,subtotal,discount_amount,gst_amount,credit_total,refund_or_credit_amount) values(v_id,p_company_id,p_invoice_id,p_customer_id,trim(p_reason),v_subtotal,v_discount,v_gst,v_credit,v_refund);
  for v_line in select * from jsonb_to_recordset(p_items) as x(invoice_item_id uuid,qty numeric) loop
    select * into v_item from public.jde_invoice_items where id=v_line.invoice_item_id;
    insert into public.jde_sales_return_items(sales_return_id,company_id,invoice_item_id,product_id,qty,unit_price,line_total) values(v_id,p_company_id,v_item.id,v_item.product_id,v_line.qty,v_item.unit_price,round(v_item.unit_price*v_line.qty,2));
    if v_item.product_id is not null then
      v_remaining:=v_line.qty;
      for v_consume in select sc.id,sc.layer_id,sc.qty from public.jde_stock_consumptions sc join public.jde_stock_layers sl on sl.id=sc.layer_id where sc.invoice_item_id=v_item.id and sc.company_id=p_company_id order by sl.created_at desc,sc.id desc for update of sc,sl loop
        exit when v_remaining<=0; v_restore:=least(v_remaining,v_consume.qty); if v_consume.layer_id is null then raise exception 'FIFO audit is incomplete for %.',v_item.part_number; end if;
        update public.jde_stock_layers set qty_remaining=qty_remaining+v_restore where id=v_consume.layer_id;
        if v_restore=v_consume.qty then delete from public.jde_stock_consumptions where id=v_consume.id; else update public.jde_stock_consumptions set qty=qty-v_restore where id=v_consume.id; end if;
        v_remaining:=v_remaining-v_restore;
      end loop;
      if v_remaining>0 then raise exception 'FIFO audit is incomplete for %.',v_item.part_number; end if;
      update public.jde_products set current_stock=current_stock+v_line.qty where id=v_item.product_id and company_id=p_company_id;
    end if;
  end loop;
  update public.jde_invoices set total=v_new_total,paid=v_new_paid,items=greatest(coalesce(items,0)-v_units::integer,0),discount_amount=greatest(coalesce(discount_amount,0)-v_discount,0),gst_amount=greatest(coalesce(gst_amount,0)-v_gst,0),status=case when v_new_paid>=v_new_total then 'paid' when v_new_paid>0 then 'partial' else 'unpaid' end where id=p_invoice_id and company_id=p_company_id;
  if p_customer_id is not null then perform public.jde_adjust_customer_balance(p_customer_id,v_new_due-v_old_due); end if;
  return query select v_id,v_credit;
end $fn$;

create or replace function public.jde_get_returnable_purchase_items(p_company_id text,p_po_id text)
returns table(po_item_id uuid,returned_qty numeric,returnable_qty numeric) language plpgsql security invoker set search_path = public as $fn$
begin
  if not exists(select 1 from public.jde_purchase_orders where id=p_po_id and company_id=p_company_id and status='received') then raise exception 'Only a received purchase order can be returned.'; end if;
  return query with items as (
    select pi.id,pi.product_id,pi.qty,coalesce(sum(pri.qty),0) returned_qty from public.jde_po_items pi left join public.jde_purchase_return_items pri on pri.po_item_id=pi.id and pri.company_id=pi.company_id where pi.company_id=p_company_id and pi.po_id=p_po_id and pi.product_id is not null group by pi.id,pi.product_id,pi.qty
  ), stock as (select product_id,sum(qty_remaining) available_qty from public.jde_stock_layers where company_id=p_company_id and source_po_id=p_po_id and qty_remaining>0 group by product_id), ready as (
    select i.*,coalesce(s.available_qty,0) available_qty,coalesce(sum(i.qty-i.returned_qty) over(partition by i.product_id order by i.id rows between unbounded preceding and 1 preceding),0) earlier_remaining from items i left join stock s on s.product_id=i.product_id
  ) select r.id,r.returned_qty,greatest(least(r.qty-r.returned_qty,r.available_qty-r.earlier_remaining),0) from ready r order by r.id;
end $fn$;

create or replace function public.jde_record_purchase_return(p_company_id text,p_po_id text,p_supplier_id text,p_lines jsonb,p_note text default '')
returns table(return_number text,total numeric) language plpgsql set search_path = public as $fn$
declare v_po public.jde_purchase_orders%rowtype; v_supplier public.jde_suppliers%rowtype; v_item public.jde_po_items%rowtype;
  v_line record; v_request record; v_layer record; v_id text; v_total numeric:=0; v_returned numeric; v_remaining numeric; v_taken numeric;
begin
  if coalesce(trim(p_company_id),'')='' or coalesce(trim(p_po_id),'')='' or coalesce(trim(p_supplier_id),'')='' then raise exception 'Company, purchase order, and supplier are required.'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'Select at least one purchase line.'; end if;
  if exists(select 1 from jsonb_to_recordset(p_lines) as x(po_item_id uuid,qty numeric) where qty is null or qty<=0) or exists(select po_item_id from jsonb_to_recordset(p_lines) as x(po_item_id uuid,qty numeric) group by po_item_id having count(*)>1) then raise exception 'Return quantities must be positive and unique by purchase line.'; end if;
  perform pg_advisory_xact_lock(hashtext('jde-purchase-return:'||p_po_id));
  select * into v_po from public.jde_purchase_orders where id=p_po_id and company_id=p_company_id for update;
  if not found or v_po.status<>'received' then raise exception 'Only a received purchase order can be returned.'; end if;
  select * into v_supplier from public.jde_suppliers where id=p_supplier_id and company_id=p_company_id;
  if not found or v_supplier.name is distinct from v_po.supplier then raise exception 'The supplier does not match this purchase order.'; end if;
  for v_line in select * from jsonb_to_recordset(p_lines) as x(po_item_id uuid,qty numeric) loop
    select * into v_item from public.jde_po_items where id=v_line.po_item_id and company_id=p_company_id and po_id=p_po_id for update;
    if not found or v_item.product_id is null then raise exception 'A selected purchase line cannot be returned from inventory.'; end if;
    select coalesce(sum(qty),0) into v_returned from public.jde_purchase_return_items where company_id=p_company_id and po_item_id=v_item.id;
    if v_line.qty>v_item.qty-v_returned then raise exception 'Return quantity exceeds the original remaining quantity for %.',v_item.part_number; end if;
    v_total:=v_total+round(v_item.unit_cost*v_line.qty,2);
  end loop;
  for v_request in select pi.product_id,sum(x.qty) qty from jsonb_to_recordset(p_lines) as x(po_item_id uuid,qty numeric) join public.jde_po_items pi on pi.id=x.po_item_id group by pi.product_id loop
    select coalesce(sum(qty_remaining),0) into v_remaining from public.jde_stock_layers where company_id=p_company_id and source_po_id=p_po_id and product_id=v_request.product_id;
    if v_request.qty>v_remaining then raise exception 'Only % unit(s) from this purchase batch remain available to return.',v_remaining; end if;
  end loop;
  perform pg_advisory_xact_lock(hashtext('jde-purchase-return-number'));
  select 'PRN-'||(coalesce(max(nullif(regexp_replace(id,'[^0-9]','','g'),'')::int),1000)+1) into v_id from public.jde_purchase_returns;
  insert into public.jde_purchase_returns(id,company_id,purchase_order_id,supplier_id,supplier,note,total) values(v_id,p_company_id,p_po_id,p_supplier_id,v_supplier.name,coalesce(trim(p_note),''),v_total);
  for v_line in select * from jsonb_to_recordset(p_lines) as x(po_item_id uuid,qty numeric) loop
    select * into v_item from public.jde_po_items where id=v_line.po_item_id;
    insert into public.jde_purchase_return_items(purchase_return_id,company_id,po_item_id,product_id,qty,unit_cost,line_total) values(v_id,p_company_id,v_item.id,v_item.product_id,v_line.qty,v_item.unit_cost,round(v_item.unit_cost*v_line.qty,2));
  end loop;
  for v_request in select pi.product_id,sum(x.qty) qty from jsonb_to_recordset(p_lines) as x(po_item_id uuid,qty numeric) join public.jde_po_items pi on pi.id=x.po_item_id group by pi.product_id loop
    v_remaining:=v_request.qty;
    for v_layer in select id,qty_remaining from public.jde_stock_layers where company_id=p_company_id and source_po_id=p_po_id and product_id=v_request.product_id and qty_remaining>0 order by created_at desc,id desc for update loop
      exit when v_remaining<=0; v_taken:=least(v_remaining,v_layer.qty_remaining); update public.jde_stock_layers set qty_remaining=qty_remaining-v_taken where id=v_layer.id; v_remaining:=v_remaining-v_taken;
    end loop;
    if v_remaining>0 then raise exception 'Unable to reserve the requested returned stock.'; end if;
    update public.jde_products set current_stock=current_stock-v_request.qty where id=v_request.product_id and company_id=p_company_id;
  end loop;
  update public.jde_suppliers set balance=coalesce(balance,0)-v_total where id=p_supplier_id and company_id=p_company_id;
  return query select v_id,v_total;
end $fn$;

revoke all on function public.jde_save_quotation(text,text,boolean,text,text,text,text,jsonb,numeric,numeric,numeric,numeric,numeric,numeric) from public,anon,authenticated;
revoke all on function public.jde_convert_quotation_to_invoice(text,text) from public,anon,authenticated;
revoke all on function public.jde_get_sales_returnable_items(text,text) from public,anon,authenticated;
revoke all on function public.jde_create_sales_return(text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.jde_get_returnable_purchase_items(text,text) from public,anon,authenticated;
revoke all on function public.jde_record_purchase_return(text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.jde_save_quotation(text,text,boolean,text,text,text,text,jsonb,numeric,numeric,numeric,numeric,numeric,numeric) to service_role;
grant execute on function public.jde_convert_quotation_to_invoice(text,text) to service_role;
grant execute on function public.jde_get_sales_returnable_items(text,text) to service_role;
grant execute on function public.jde_create_sales_return(text,text,text,text,jsonb) to service_role;
grant execute on function public.jde_get_returnable_purchase_items(text,text) to service_role;
grant execute on function public.jde_record_purchase_return(text,text,text,jsonb,text) to service_role;
commit;
