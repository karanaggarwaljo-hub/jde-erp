-- Merging a part that was entered twice.
--
-- "bkt main pin" (20 on the shelf, never sold) and "PIN (12400)" (5 sold, never bought, −5 in
-- stock) are one physical part under two entries. Neither entry's stock is true, and the sale was
-- costed at a guess because the entry it was billed from had no purchase batch to draw on. There
-- was no way to put that right short of a database console.
--
-- What merging the duplicate into the part being kept does, all in one transaction:
--
--   history    every invoice, purchase, quotation and return line, every purchase batch and every
--              FIFO consumption of the duplicate is re-pointed at the kept part. Invoice lines keep
--              the part number and name they were printed with — only the link moves.
--
--   stock      the two counts add up: 20 and −5 become 15.
--
--   details    the kept part keeps its own name, always. Its part number is whichever of the two
--              the owner chose. Any other detail it is blank on (OEM number, HSN, brand, category,
--              compatibility, location, cost, MRP, sale price, reorder level) is taken from the
--              duplicate; anything it already has stays. lib/part-merge.ts applies the same rules
--              to show the owner the result before they confirm, and must be kept in step.
--
--   cost       a sale made while stock showed below zero was costed without a batch (layer_id is
--              null) at the part's static cost. Once the kept part has batches with units left,
--              those sales are re-costed from them oldest first, exactly as the sale would have
--              been had the stock been on one entry all along. Without this the batches would
--              still hold 20 while the part reads 15, and the next five sales would be costed from
--              units that are already gone. A consumption split across batches becomes one row per
--              batch, which is the shape jde_consume_stock_fifo writes and
--              jde_restore_stock_layers_for_invoice_item reverses.
--
--   catalogue  a website catalogue entry of the duplicate moves to the kept part when the kept
--              part has none; otherwise the delete trigger unpublishes it as for any removed part.
--
-- The duplicate is then deleted. Refused, by name, for parts of another company, a part merged
-- with itself, or a part number that is neither part's own.
--
-- Grants match every other jde_ function: Supabase hands EXECUTE to anon and authenticated as
-- explicit grants that "revoke from public" does not remove, so they are revoked by name.

create or replace function public.jde_merge_products(
  p_company_id text,
  p_keep_id text,
  p_remove_id text,
  p_part_number text
)
returns table(id text, part_number text, name text, current_stock numeric, moved_lines integer, recosted_units numeric)
language plpgsql
set search_path to 'public'
as $function$
declare
  v_keep public.jde_products%rowtype;
  v_remove public.jde_products%rowtype;
  v_number text := coalesce(trim(p_part_number), '');
  v_final_number text;
  v_moved integer := 0;
  v_count integer;
  v_recosted numeric := 0;
  v_cons record;
  v_layer record;
  v_left numeric;
  v_take numeric;
  v_first boolean;
begin
  if coalesce(trim(p_company_id), '') = '' or coalesce(trim(p_keep_id), '') = '' or coalesce(trim(p_remove_id), '') = '' then
    raise exception 'Company and both parts are required.';
  end if;
  if p_keep_id = p_remove_id then
    raise exception 'A part cannot be merged with itself.';
  end if;

  perform pg_advisory_xact_lock(hashtext('jde-merge-products:' || p_company_id));

  select * into v_keep from public.jde_products p
   where p.id = p_keep_id and p.company_id = p_company_id
     for update;
  if not found then
    raise exception 'The part to keep was not found for the active company.';
  end if;

  select * into v_remove from public.jde_products p
   where p.id = p_remove_id and p.company_id = p_company_id
     for update;
  if not found then
    raise exception 'The duplicate part was not found for the active company.';
  end if;

  if lower(v_number) = lower(coalesce(trim(v_keep.part_number), '')) then
    v_final_number := v_keep.part_number;
  elsif lower(v_number) = lower(coalesce(trim(v_remove.part_number), '')) then
    v_final_number := v_remove.part_number;
  else
    raise exception 'The part number to keep must be one of the two parts'' own numbers.';
  end if;

  -- History.
  update public.jde_invoice_items t set product_id = p_keep_id
   where t.product_id = p_remove_id and t.company_id = p_company_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved + v_count;

  update public.jde_po_items t set product_id = p_keep_id
   where t.product_id = p_remove_id and t.company_id = p_company_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved + v_count;

  update public.jde_quotation_items t set product_id = p_keep_id
   where t.product_id = p_remove_id and t.company_id = p_company_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved + v_count;

  update public.jde_sales_return_items t set product_id = p_keep_id
   where t.product_id = p_remove_id and t.company_id = p_company_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved + v_count;

  update public.jde_purchase_return_items t set product_id = p_keep_id
   where t.product_id = p_remove_id and t.company_id = p_company_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved + v_count;

  update public.jde_stock_layers t set product_id = p_keep_id
   where t.product_id = p_remove_id and t.company_id = p_company_id;

  update public.jde_stock_consumptions t set product_id = p_keep_id
   where t.product_id = p_remove_id and t.company_id = p_company_id;

  update public.jde_catalog_products c set erp_product_id = p_keep_id
   where c.erp_product_id = p_remove_id and c.company_id = p_company_id
     and not exists (
       select 1 from public.jde_catalog_products k
        where k.erp_product_id = p_keep_id and k.company_id = p_company_id
     );

  -- The duplicate goes first, so its part number is free before the kept part may take it.
  delete from public.jde_products p where p.id = p_remove_id and p.company_id = p_company_id;

  update public.jde_products p set
    current_stock = coalesce(v_keep.current_stock, 0) + coalesce(v_remove.current_stock, 0),
    part_number = v_final_number,
    oem_number = case when coalesce(trim(v_keep.oem_number), '') = '' then v_remove.oem_number else v_keep.oem_number end,
    hsn_code = case when coalesce(trim(v_keep.hsn_code), '') = '' then v_remove.hsn_code else v_keep.hsn_code end,
    brand = case when coalesce(trim(v_keep.brand), '') = '' then v_remove.brand else v_keep.brand end,
    category = case when coalesce(trim(v_keep.category), '') = '' then v_remove.category else v_keep.category end,
    compatibility = case when coalesce(trim(v_keep.compatibility), '') = '' then v_remove.compatibility else v_keep.compatibility end,
    location = case when coalesce(trim(v_keep.location), '') = '' then v_remove.location else v_keep.location end,
    cost_price = case when coalesce(v_keep.cost_price, 0) > 0 then v_keep.cost_price else coalesce(v_remove.cost_price, v_keep.cost_price) end,
    mrp = case when coalesce(v_keep.mrp, 0) > 0 then v_keep.mrp else coalesce(v_remove.mrp, v_keep.mrp) end,
    sale_price = case when coalesce(v_keep.sale_price, 0) > 0 then v_keep.sale_price else coalesce(v_remove.sale_price, v_keep.sale_price) end,
    min_stock = case when coalesce(v_keep.min_stock, 0) > 0 then v_keep.min_stock else coalesce(v_remove.min_stock, v_keep.min_stock) end
  where p.id = p_keep_id and p.company_id = p_company_id;

  -- Cost: sales made below zero take their cost from the batches that were really on the shelf.
  for v_cons in
    select sc.id as cons_id, sc.qty as cons_qty, sc.unit_cost as cons_cost, sc.invoice_item_id as cons_item, sc.created_at as cons_at
      from public.jde_stock_consumptions sc
     where sc.product_id = p_keep_id and sc.company_id = p_company_id
       and sc.layer_id is null and sc.qty > 0
     order by sc.created_at asc, sc.id asc
       for update
  loop
    exit when not exists (
      select 1 from public.jde_stock_layers sl
       where sl.product_id = p_keep_id and sl.company_id = p_company_id and sl.qty_remaining > 0
    );

    v_left := v_cons.cons_qty;
    v_first := true;
    for v_layer in
      select sl.id as layer_id, sl.unit_cost as layer_cost, sl.qty_remaining as layer_left
        from public.jde_stock_layers sl
       where sl.product_id = p_keep_id and sl.company_id = p_company_id and sl.qty_remaining > 0
       order by sl.created_at asc, sl.id asc
         for update
    loop
      exit when v_left <= 0;
      v_take := least(v_left, v_layer.layer_left);

      update public.jde_stock_layers sl
         set qty_remaining = sl.qty_remaining - v_take
       where sl.id = v_layer.layer_id;

      if v_first then
        update public.jde_stock_consumptions sc
           set layer_id = v_layer.layer_id, qty = v_take, unit_cost = v_layer.layer_cost
         where sc.id = v_cons.cons_id;
        v_first := false;
      else
        insert into public.jde_stock_consumptions (company_id, invoice_item_id, product_id, layer_id, qty, unit_cost, created_at)
        values (p_company_id, v_cons.cons_item, p_keep_id, v_layer.layer_id, v_take, v_layer.layer_cost, v_cons.cons_at);
      end if;

      v_left := v_left - v_take;
      v_recosted := v_recosted + v_take;
    end loop;

    -- Batches ran out partway: the rest of this sale stays costed as it was.
    if v_left > 0 and not v_first then
      insert into public.jde_stock_consumptions (company_id, invoice_item_id, product_id, layer_id, qty, unit_cost, created_at)
      values (p_company_id, v_cons.cons_item, p_keep_id, null, v_left, v_cons.cons_cost, v_cons.cons_at);
    end if;
  end loop;

  return query
    select p.id, p.part_number, p.name, p.current_stock, v_moved, v_recosted
      from public.jde_products p
     where p.id = p_keep_id;
end
$function$;

revoke execute on function public.jde_merge_products(text, text, text, text) from public;
revoke execute on function public.jde_merge_products(text, text, text, text) from anon;
revoke execute on function public.jde_merge_products(text, text, text, text) from authenticated;
grant execute on function public.jde_merge_products(text, text, text, text) to service_role;
