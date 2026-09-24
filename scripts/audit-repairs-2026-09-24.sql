-- ALREADY APPLIED on 2026-09-24 as migration audit_repairs_approved_by_owner_2026_09_24.
-- Kept as the record of what was changed. Do not run again: every step checks the data is still
-- exactly as audited and raises otherwise, so a second run stops at step 1 and changes nothing.
--
-- Rehearsed first inside a rolled-back transaction, checking afterwards that every part's stock
-- matched its batches, none was negative or orphaned, and 450-10206 / BIG-P17 stayed at 67 / 28.
--
-- Repairs from the 24 September 2026 audit, each one approved by the owner in the pop-ups.
-- Every change leaves a row in jde_audit_log carrying what it replaced, so nothing here is lost:
-- a removed record is copied into that row's details before it goes.
do $repair$
declare
  co constant text := '6d0e3949-798e-4ea9-9de6-e0936b8bf198';
  actor constant text := 'Audit repair (approved by the owner)';
  petro constant text := 'db36074a-a1f5-48a0-ad42-16e12eeea833';
  leftover_a constant text := '3449c0d5-714a-4ba5-9273-2aa24bf4d0b6';
  leftover_b constant text := '55d77f53-f8ab-4975-9732-00c1d26b101c';
  sp268_sale constant uuid := '90112f1c-e446-4795-b4aa-3be734c48de4';
  v_count integer;
  v_sp268 text;
  v_sale_at timestamptz;
  v_layer uuid;
  v_detail jsonb;
begin
  -- 1. INV-1013. One return was recorded four times over: the two parts were edited off the
  --    invoice, and three identical notes were saved as well. The edit already records the
  --    return and the stock is right, so the three notes go.
  insert into jde_audit_log (company_id, actor_email, actor_name, action, entity, entity_id, summary, details)
  select sr.company_id, 'system', actor, 'sales_returns.delete', 'sales_returns', sr.id,
         'Removed ' || sr.id || ' from INV-1013 — the same return was also recorded by editing the invoice. Stock and the invoice total are unchanged.',
         jsonb_build_object('note', to_jsonb(sr),
                            'lines', (select coalesce(jsonb_agg(to_jsonb(ri)), '[]'::jsonb) from jde_sales_return_items ri where ri.sales_return_id = sr.id))
    from jde_sales_returns sr
   where sr.company_id = co and sr.invoice_id = 'INV-1013' and sr.id in ('SRN-1003', 'SRN-1004', 'SRN-1005');
  get diagnostics v_count = row_count;
  if v_count <> 3 then raise exception 'Expected the 3 INV-1013 return notes, found %', v_count; end if;
  delete from jde_sales_return_items ri using jde_sales_returns sr
   where ri.sales_return_id = sr.id and sr.company_id = co and sr.id in ('SRN-1003', 'SRN-1004', 'SRN-1005');
  delete from jde_sales_returns where company_id = co and id in ('SRN-1003', 'SRN-1004', 'SRN-1005');

  -- 2. STEARING COUPLING 3DX. Sold once on INV-1014 with no stock ever entered; the owner counts 0.
  --    Its sale is already costed at the part's ₹250, so a one-unit opening batch at that cost is
  --    added and linked to the sale, which completes the stock history instead of just editing a number.
  select p.id into v_sp268 from jde_products p where p.company_id = co and p.part_number = 'SP-00268' and p.current_stock = -1;
  if v_sp268 is null then raise exception 'SP-00268 is no longer at -1 — left alone'; end if;
  select sc.created_at into v_sale_at from jde_stock_consumptions sc
   where sc.id = sp268_sale and sc.product_id = v_sp268 and sc.layer_id is null and sc.unit_cost = 250;
  if v_sale_at is null then raise exception 'The SP-00268 sale record is not what was audited — left alone'; end if;
  insert into jde_stock_layers (company_id, product_id, unit_cost, qty_remaining, qty_original, source_po_id, created_at)
  values (co, v_sp268, 250, 0, 1, null, v_sale_at - interval '1 second')
  returning id into v_layer;
  update jde_stock_consumptions set layer_id = v_layer where id = sp268_sale;
  update jde_products set current_stock = 0 where id = v_sp268;
  insert into jde_audit_log (company_id, actor_email, actor_name, action, entity, entity_id, summary, details)
  values (co, 'system', actor, 'products.edit', 'products', v_sp268,
          'STEARING COUPLING 3DX (SP-00268) stock set from −1 to 0, as counted by the owner. The one sold on INV-1014 is now recorded as coming from an opening batch at ₹250.',
          jsonb_build_object('before', jsonb_build_object('current_stock', -1), 'after', jsonb_build_object('current_stock', 0), 'opening_batch', v_layer));

  -- 3. petro green greas 18kg. Deleted in August while its opening batch (43 at ₹1,850) stayed
  --    behind with nothing pointing at it. Recreated under its old id, so that batch is its own
  --    again, with the 20 the owner counts on the shelf.
  if exists (select 1 from jde_products where id = petro) then raise exception 'The petro green grease id is already in use — left alone'; end if;
  select count(*) into v_count from jde_stock_layers
   where product_id = petro and company_id = co and qty_original = 43 and qty_remaining = 43 and unit_cost = 1850;
  if v_count <> 1 then raise exception 'The petro green grease batch is not what was audited — left alone'; end if;
  insert into jde_products (id, company_id, part_number, oem_number, name, brand, category, compatibility,
                            cost_price, mrp, sale_price, current_stock, min_stock, location, hsn_code, image_url)
  values (petro, co, 'PET-G52', '', 'petro green greas 18kg', 'Petro Green', 'Lubricants & Fluids', '',
          1850, 0, 0, 20, 0, '', '271019', null);
  update jde_stock_layers set qty_remaining = 20 where product_id = petro and company_id = co;
  insert into jde_audit_log (company_id, actor_email, actor_name, action, entity, entity_id, summary, details)
  values (co, 'system', actor, 'products.create', 'products', petro,
          'Brought back petro green greas 18kg (PET-G52), deleted in August while 43 were still on record. Set to the 20 the owner counted, at ₹1,850 each.',
          jsonb_build_object('before', jsonb_build_object('current_stock', 43), 'after', jsonb_build_object('current_stock', 20)));

  -- 4. Two unnamed leftovers from parts deleted before September: 1 and 7 units at ₹0, which no
  --    screen or total counts. Copied into the audit row, then cleared.
  select jsonb_agg(to_jsonb(sl)) into v_detail from jde_stock_layers sl
   where sl.company_id = co and sl.product_id in (leftover_a, leftover_b)
     and not exists (select 1 from jde_products p where p.id = sl.product_id);
  if coalesce(jsonb_array_length(v_detail), 0) <> 3 then raise exception 'Expected 3 leftover batches, found %', coalesce(jsonb_array_length(v_detail), 0); end if;
  delete from jde_stock_layers sl
   where sl.company_id = co and sl.product_id in (leftover_a, leftover_b)
     and not exists (select 1 from jde_products p where p.id = sl.product_id);
  insert into jde_audit_log (company_id, actor_email, actor_name, action, entity, entity_id, summary, details)
  values (co, 'system', actor, 'stock_layers.delete', 'stock_layers', 'leftovers',
          'Cleared 3 stock records left behind by two parts deleted before September (1 and 7 units at ₹0, names unknown).',
          jsonb_build_object('removed', v_detail));

  -- 5. Opening batches saved at ₹0 for parts that do have a cost price. Valued at that price,
  --    along with any sale drawn from them at ₹0. The four parts with no cost price at all are
  --    left for the owner, as asked.
  with fixed as (
    update jde_stock_layers sl set unit_cost = p.cost_price
      from jde_products p
     where p.id = sl.product_id and sl.company_id = co and coalesce(sl.unit_cost, 0) <= 0 and coalesce(p.cost_price, 0) > 0
    returning p.part_number, p.cost_price, sl.qty_original, sl.qty_remaining)
  select jsonb_agg(to_jsonb(fixed)) into v_detail from fixed;
  if coalesce(jsonb_array_length(v_detail), 0) <> 13 then raise exception 'Expected 13 zero-cost batches to value, found %', coalesce(jsonb_array_length(v_detail), 0); end if;
  update jde_stock_consumptions sc set unit_cost = sl.unit_cost
    from jde_stock_layers sl
   where sc.layer_id = sl.id and sc.company_id = co and coalesce(sc.unit_cost, 0) <= 0 and sl.unit_cost > 0;
  get diagnostics v_count = row_count;
  insert into jde_audit_log (company_id, actor_email, actor_name, action, entity, entity_id, summary, details)
  values (co, 'system', actor, 'stock_layers.edit', 'stock_layers', 'opening-costs',
          '13 opening stock batches saved at ₹0 now carry their part''s own cost price' ||
          case when v_count > 0 then ', and ' || v_count || ' sale(s) drawn from them are costed to match.' else '.' end,
          jsonb_build_object('batches', v_detail, 'sales_recosted', v_count));

  -- 6. HSN codes by part type, as the owner chose. Four-digit headings, except where the owner's own
  --    entries already set a longer code for the same kind of part (271019 for oils and greases,
  --    84129090 for mountings). Parts whose type cannot be told from the name stay blank.
  with plan as (
    select p.id, p.part_number, p.name,
      case
        when p.category = 'Miscellaneous' then null
        when p.category = 'Attachments' then '8431'
        when p.name ilike '%coolant%' then '3820'
        when p.name ilike '%greas gun%' or p.name ilike '%grease gun%' then '8424'
        when p.name ilike '%greas pump%' or p.name ilike '%grease pump%' then '8413'
        when p.name ilike '%drive shaft%' then '8483'
        when p.name ilike '%seal%' or p.name ilike '%o ring%' then '4016'
        when p.name ilike '%gaskit%' or p.name ilike '%gasket%' then '8484'
        when p.name ilike '%filter%' or p.name ilike '%strainer%' or p.name ilike '%stanner%' or p.name ilike '%suct%' then '8421'
        when p.name ilike '%pump%' then '8413'
        when p.name ilike '%valve%' or lower(trim(p.name)) in ('arv', 'mrv') or p.name ilike '%nipple%' then '8481'
        when p.name ilike '%bearing%' or p.name ilike '%beraing%' then '8482'
        when p.name ilike 'pipe%' then '8431'
        when p.name ilike '%bolt%' or p.name ilike '% nut%' then '7318'
        when p.name ilike '%spring%' then '7320'
        when p.name ilike '%tyre%' then '4011'
        when p.name ilike '%paint%' then '3208'
        when p.name ilike '%bond%' then '3506'
        when p.name ilike '%mounting%' then '84129090'
        when p.name ilike '%altinator%' or p.name ilike '%alternator%' then '8511'
        when p.name ilike '%coil%' then '8505'
        when p.name ilike '%ceiling fan%' or p.category = 'Cooling' then '8414'
        when p.name ilike '%switch%' or p.name ilike '%dandi%' then '8536'
        when p.name ilike '%light%' or p.name ilike '%lamp%' then '8512'
        when p.name ilike '%handle lock%' then '8301'
        when p.name ilike '%nylon%' or p.name ilike '%tiki%' then '3926'
        when p.name ilike '%nozzle%' then '8409'
        when p.category = 'jack' or p.name ilike '%rod 3dx%' or p.name ilike '%tube 3dx%' or p.name ilike '%ram assy%' then '8412'
        when p.name ilike '%ball joint%' then '8431'
        when p.name ilike '%coupling%' or p.name ilike '%cross%' or p.name ilike '%u/j%' or p.name ilike '%universal joint%' then '8483'
        when p.name ilike '%liver%' or p.name ilike '%leaver%' or p.name ilike '%lever%' then '8431'
        when p.category in ('Transmission', 'Axle', 'Hub', 'rear hub', 'shaft') then '8483'
        when p.category in ('Lubricants & Fluids', 'Lubricant') then '271019'
        when p.category = 'Bearings' then '8482'
        when p.category = 'Filters' then '8421'
        when p.category = 'Seals' then '4016'
        when p.category = 'Valves' then '8481'
        when p.category = 'Pumps' then '8413'
        when p.category = 'Electrical' then '8536'
        else '8431'
      end as code
    from jde_products p
    where p.company_id = co and coalesce(p.hsn_code, '') = ''
  ),
  done as (
    update jde_products p set hsn_code = plan.code from plan
     where p.id = plan.id and plan.code is not null
    returning plan.part_number, plan.code
  )
  select jsonb_object_agg(done.part_number, done.code) into v_detail from done;
  insert into jde_audit_log (company_id, actor_email, actor_name, action, entity, entity_id, summary, details)
  values (co, 'system', actor, 'products.edit', 'products', 'hsn-codes',
          'HSN codes filled by part type for ' || (select count(*) from jsonb_object_keys(v_detail)) || ' parts, as the owner chose — to be checked with the accountant.',
          jsonb_build_object('codes', v_detail));
end
$repair$;
