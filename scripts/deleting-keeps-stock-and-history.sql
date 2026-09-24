-- Applied 2026-09-24 as migration deleting_never_leaves_stock_or_history_behind.
--
-- Found by the 24 September 2026 audit: 51 units of stock (₹79,550 of it one part's, petro green
-- greas 18kg) sat in batches belonging to parts that had been deleted, so it had silently dropped
-- out of every total. And deleting a company removed its parts, customers and invoices while
-- leaving their stock batches, sales lines, returns and payments behind.
--
-- Rehearsed against the live database inside a rolled-back transaction, with five checks:
--   1. deleting a part with sales history is refused, with the message below
--   2. deleting a part that still holds stock is refused
--   3. once emptied, a never-used part deletes and takes its empty batch with it
--   4. jde_merge_products still merges a duplicate (it moves everything before deleting)
--   5. jde_delete_company leaves no row of that company in any jde_ table but the audit log

-- 1. Indexes behind five foreign keys that had none.
create index if not exists jde_sales_return_items_sales_return_id_idx on public.jde_sales_return_items (sales_return_id);
create index if not exists jde_sales_return_items_invoice_item_id_idx on public.jde_sales_return_items (invoice_item_id);
create index if not exists jde_purchase_return_items_purchase_return_id_idx on public.jde_purchase_return_items (purchase_return_id);
create index if not exists jde_payments_received_customer_id_idx on public.jde_payments_received (customer_id);
create index if not exists jde_supplier_payment_allocations_payment_id_idx on public.jde_supplier_payment_allocations (payment_id);

-- 2. A part that has been bought, sold or quoted, or still holds stock, cannot be deleted. Merging a
--    duplicate is unaffected: jde_merge_products moves every batch and line to the kept part before
--    it deletes the other, so by then there is nothing left to protect. Deleting a whole company
--    says so through jde.deleting_company and is let through, because everything of that company
--    is going too.
create or replace function public.jde_products_keep_history() returns trigger
language plpgsql set search_path to 'public' as $fn$
declare
  v_label text := coalesce(nullif(trim(old.part_number), ''), nullif(trim(old.name), ''), 'This part');
  v_left numeric;
begin
  if current_setting('jde.deleting_company', true) = old.company_id then return old; end if;
  if exists (select 1 from jde_invoice_items where product_id = old.id)
     or exists (select 1 from jde_po_items where product_id = old.id)
     or exists (select 1 from jde_quotation_items where product_id = old.id)
     or exists (select 1 from jde_sales_return_items where product_id = old.id)
     or exists (select 1 from jde_purchase_return_items where product_id = old.id)
     or exists (select 1 from jde_stock_consumptions where product_id = old.id) then
    raise exception '% has been bought, sold or quoted, so it cannot be deleted — its history would be lost. If it was entered twice, merge it into the other entry instead.', v_label using errcode = 'P0001';
  end if;
  select coalesce(sum(qty_remaining), 0) into v_left from jde_stock_layers where product_id = old.id;
  if v_left <> 0 then
    raise exception '% still has % in stock, so it cannot be deleted — that stock would vanish from your books. Set its stock to 0 first, or merge it into the entry it duplicates.', v_label, v_left using errcode = 'P0001';
  end if;
  -- Nothing left but an empty opening batch: it goes with the part, so nothing is left behind.
  delete from jde_stock_layers where product_id = old.id;
  return old;
end $fn$;

drop trigger if exists keep_history_on_delete on public.jde_products;
create trigger keep_history_on_delete before delete on public.jde_products
  for each row execute function public.jde_products_keep_history();

revoke all on function public.jde_products_keep_history() from public, anon, authenticated;
grant execute on function public.jde_products_keep_history() to service_role;

-- 3. Deleting a company removes everything of that company's, children before parents, instead of
--    only the top-level tables. The audit trail is kept on purpose: it is the record of what was
--    deleted and by whom.
create or replace function public.jde_delete_company(target_id text) returns void
language plpgsql security definer set search_path to 'public' as $fn$
begin
  perform set_config('jde.deleting_company', target_id, true);
  delete from jde_payment_allocations where company_id = target_id;
  delete from jde_supplier_payment_allocations where company_id = target_id;
  delete from jde_payments_received where company_id = target_id;
  delete from jde_supplier_payments where company_id = target_id;
  delete from jde_invoice_writeoffs where company_id = target_id;
  delete from jde_sales_return_items where company_id = target_id;
  delete from jde_sales_returns where company_id = target_id;
  delete from jde_purchase_return_items where company_id = target_id;
  delete from jde_purchase_returns where company_id = target_id;
  delete from jde_stock_consumptions where company_id = target_id;
  delete from jde_stock_layers where company_id = target_id;
  delete from jde_invoice_items where company_id = target_id;
  delete from jde_po_items where company_id = target_id;
  delete from jde_quotation_items where company_id = target_id;
  delete from jde_catalog_events where company_id = target_id;
  delete from jde_catalog_leads where company_id = target_id;
  delete from jde_catalog_products where company_id = target_id;
  delete from jde_ai_cache where company_id = target_id;
  delete from jde_products where company_id = target_id;
  delete from jde_customers where company_id = target_id;
  delete from jde_suppliers where company_id = target_id;
  delete from jde_invoices where company_id = target_id;
  delete from jde_quotations where company_id = target_id;
  delete from jde_purchase_orders where company_id = target_id;
  delete from jde_grns where company_id = target_id;
  delete from jde_expenses where company_id = target_id;
  delete from jde_users where company_id = target_id;
  delete from jde_companies where id = target_id;
end $fn$;
