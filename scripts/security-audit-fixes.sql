-- Security audit, 2026-08-25. Two migrations, already applied to the live database directly
-- via Supabase — this file is the record of what changed, matching this repo's convention of
-- keeping a .sql copy of every applied database change (see scripts/returns-and-quotations.sql,
-- scripts/customer-payments.sql, scripts/fix-sales-return-ambiguous-id.sql).

-- ============================================================================================
-- 1. Lock down SECURITY DEFINER functions that were directly callable without signing in.
-- ============================================================================================
--
-- jde_set_storefront_company(target_id text) is SECURITY DEFINER with no argument validation
-- and no auth check of its own — it exists to be called from lib/db/index.ts's
-- setStorefrontCompany() (server-only, service-role client, reached via an owner-gated API
-- route). It was never explicitly revoked from anon/authenticated, so it was directly callable
-- via Supabase's own REST RPC endpoint by anyone on the internet, completely bypassing the
-- Next.js app and its login. Confirmed exploitable: anon had EXECUTE before this migration.
-- Anyone who knew or guessed another company's id could flip which company's private catalogue
-- is served on the public /catalog pages.
revoke all on function public.jde_set_storefront_company(text) from public, anon, authenticated;
grant execute on function public.jde_set_storefront_company(text) to service_role;

-- Same class of issue, lower severity: read-only (only ever returns which company id is the
-- storefront) and confirmed unused by the app anywhere (no caller in the codebase) — likely a
-- leftover from an earlier client-side implementation. Locked down for least-privilege.
revoke all on function public.jde_public_storefront_company_id() from public, anon, authenticated;
grant execute on function public.jde_public_storefront_company_id() to service_role;

-- A trigger function (RETURNS trigger) — calling it directly via RPC outside trigger context
-- errors ("OLD used in query that is not in a trigger"), so not practically exploitable, but had
-- no business being anon/authenticated-executable either. Its trigger attachment (fires
-- automatically on jde_products delete) is unaffected — Postgres always invokes trigger
-- functions as the table owner regardless of grants.
revoke all on function public.jde_unpublish_catalog_on_product_delete() from public, anon, authenticated;

-- Hardening: none of these pinned a search_path. Not currently exploitable (only reachable via
-- service_role from trusted server code), but the fix is free. Logic is byte-for-byte
-- unchanged — only `SET search_path` is added to each.
create or replace function public.jde_adjust_product_stock(p_id text, p_delta numeric)
returns jde_products language plpgsql set search_path = public as $function$
declare
  result public.jde_products;
begin
  update public.jde_products
  set current_stock = current_stock + p_delta
  where id = p_id
  returning * into result;
  return result;
end;
$function$;

create or replace function public.jde_adjust_customer_balance(c_id text, c_delta numeric)
returns jde_customers language plpgsql set search_path = public as $function$
declare
  result public.jde_customers;
begin
  update public.jde_customers
  set balance = balance + c_delta
  where id = c_id
  returning * into result;
  return result;
end;
$function$;

create or replace function public.jde_adjust_supplier_balance(s_id text, s_delta numeric)
returns jde_suppliers language plpgsql set search_path = public as $function$
declare
  result public.jde_suppliers;
begin
  update public.jde_suppliers
  set balance = balance + s_delta
  where id = s_id
  returning * into result;
  return result;
end;
$function$;

create or replace function public.jde_add_stock_layer(p_product_id text, p_qty numeric, p_unit_cost numeric, p_source_po_id text default null::text, p_adjust_stock boolean default true)
returns setof jde_stock_layers language plpgsql set search_path = public as $function$
DECLARE
  v_company_id text;
BEGIN
  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'p_qty must be positive, got %', p_qty;
  END IF;

  SELECT company_id INTO v_company_id FROM jde_products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found', p_product_id;
  END IF;

  UPDATE jde_products
  SET cost_price = p_unit_cost,
      current_stock = current_stock + (CASE WHEN p_adjust_stock THEN p_qty ELSE 0 END)
  WHERE id = p_product_id;

  RETURN QUERY
    INSERT INTO jde_stock_layers (company_id, product_id, unit_cost, qty_remaining, qty_original, source_po_id)
    VALUES (v_company_id, p_product_id, p_unit_cost, p_qty, p_qty, p_source_po_id)
    RETURNING *;
END;
$function$;

create or replace function public.jde_consume_stock_fifo(p_product_id text, p_qty numeric, p_invoice_item_id uuid default null::uuid)
returns table(layer_id uuid, qty_consumed numeric, unit_cost numeric) language plpgsql set search_path = public as $function$
DECLARE
  v_company_id text;
  v_static_cost numeric;
  v_remaining numeric := p_qty;
  v_take numeric;
  v_fallback_cost numeric;
  v_layer RECORD;
  c_layers CURSOR FOR
    SELECT sl.id, sl.unit_cost, sl.qty_remaining
    FROM jde_stock_layers sl
    WHERE sl.product_id = p_product_id AND sl.qty_remaining > 0
    ORDER BY sl.created_at ASC
    FOR UPDATE;
BEGIN
  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'p_qty must be positive, got %', p_qty;
  END IF;

  SELECT company_id, cost_price INTO v_company_id, v_static_cost FROM jde_products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found', p_product_id;
  END IF;

  UPDATE jde_products SET current_stock = current_stock - p_qty WHERE id = p_product_id;

  OPEN c_layers;
  LOOP
    EXIT WHEN v_remaining <= 0;
    FETCH c_layers INTO v_layer;
    EXIT WHEN NOT FOUND;

    v_take := LEAST(v_layer.qty_remaining, v_remaining);
    UPDATE jde_stock_layers SET qty_remaining = qty_remaining - v_take WHERE id = v_layer.id;

    IF p_invoice_item_id IS NOT NULL THEN
      INSERT INTO jde_stock_consumptions (company_id, invoice_item_id, product_id, layer_id, qty, unit_cost)
      VALUES (v_company_id, p_invoice_item_id, p_product_id, v_layer.id, v_take, v_layer.unit_cost);
    END IF;

    layer_id := v_layer.id;
    qty_consumed := v_take;
    unit_cost := v_layer.unit_cost;
    RETURN NEXT;

    v_remaining := v_remaining - v_take;
  END LOOP;
  CLOSE c_layers;

  IF v_remaining > 0 THEN
    SELECT sl.unit_cost INTO v_fallback_cost
    FROM jde_stock_layers sl
    WHERE sl.product_id = p_product_id
    ORDER BY sl.created_at DESC
    LIMIT 1;

    v_fallback_cost := COALESCE(v_fallback_cost, v_static_cost, 0);

    IF p_invoice_item_id IS NOT NULL THEN
      INSERT INTO jde_stock_consumptions (company_id, invoice_item_id, product_id, layer_id, qty, unit_cost)
      VALUES (v_company_id, p_invoice_item_id, p_product_id, NULL, v_remaining, v_fallback_cost);
    END IF;

    layer_id := NULL;
    qty_consumed := v_remaining;
    unit_cost := v_fallback_cost;
    RETURN NEXT;
  END IF;

  RETURN;
END;
$function$;

create or replace function public.jde_restore_stock_layers_for_invoice_item(p_invoice_item_id uuid)
returns table(restored_qty numeric) language plpgsql set search_path = public as $function$
DECLARE
  v_product_id text;
  v_total numeric := 0;
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT product_id, qty
    FROM jde_stock_consumptions
    WHERE invoice_item_id = p_invoice_item_id
    FOR UPDATE
  LOOP
    v_product_id := v_row.product_id;
    v_total := v_total + v_row.qty;
  END LOOP;

  IF v_product_id IS NULL THEN
    restored_qty := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE jde_products SET current_stock = current_stock + v_total WHERE id = v_product_id;

  FOR v_row IN
    SELECT sc.layer_id, sc.qty
    FROM jde_stock_consumptions sc
    JOIN jde_stock_layers sl ON sl.id = sc.layer_id
    WHERE sc.invoice_item_id = p_invoice_item_id AND sc.layer_id IS NOT NULL
    ORDER BY sl.created_at ASC
  LOOP
    UPDATE jde_stock_layers SET qty_remaining = qty_remaining + v_row.qty WHERE id = v_row.layer_id;
  END LOOP;

  DELETE FROM jde_stock_consumptions WHERE invoice_item_id = p_invoice_item_id;

  restored_qty := v_total;
  RETURN NEXT;
END;
$function$;

create or replace function public.jde_correct_oldest_layer_cost(p_product_id text, p_new_cost numeric)
returns setof jde_stock_layers language plpgsql set search_path = public as $function$
DECLARE
  v_layer_id uuid;
BEGIN
  SELECT id INTO v_layer_id
  FROM jde_stock_layers
  WHERE product_id = p_product_id AND qty_remaining > 0
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF v_layer_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    UPDATE jde_stock_layers SET unit_cost = p_new_cost WHERE id = v_layer_id RETURNING *;
END;
$function$;

-- Dead code: references bare `products`/`reviews` tables that don't exist in this app's schema
-- (every real table here is jde_-prefixed — see README). Left over from the Supabase starter
-- template this project began from. Fixing search_path only, not removing it — flagged
-- separately for the owner to confirm before deletion.
create or replace function public.update_product_rating()
returns trigger language plpgsql set search_path = public as $function$
BEGIN
  UPDATE products
  SET
    rating       = (SELECT ROUND(AVG(rating)::NUMERIC, 1) FROM reviews WHERE product_id = NEW.product_id),
    review_count = (SELECT COUNT(*) FROM reviews WHERE product_id = NEW.product_id)
  WHERE id = NEW.product_id;
  RETURN NEW;
END;
$function$;

-- ============================================================================================
-- 2. jde_delete_sales_invoice had no company parameter at all, and trusted a client-supplied
--    "outstanding" number for the customer balance reversal instead of computing it itself.
-- ============================================================================================
--
-- Any logged-in ERP user, regardless of which company they belonged to, could delete another
-- company's invoice and push a customer's balance by any amount they chose, just by calling the
-- app's own /api/sales/delete-invoice with a different invoiceId/customerId/outstanding. The
-- app-layer session check (lib/auth/dal.ts's checkCompanyAccess, added the same day) is the
-- first line of defense; this is the second — the function now refuses to touch an invoice
-- outside p_company_id, and computes the real outstanding from the invoice row itself.
--
-- Postgres function overloading is by full argument signature: create-or-replace with a
-- different parameter list would leave the old 3-arg (text,text,numeric) version live alongside
-- a new one rather than actually replacing it, so the vulnerable version is dropped explicitly.
drop function if exists public.jde_delete_sales_invoice(text, text, numeric);

create or replace function public.jde_delete_sales_invoice(p_company_id text, p_invoice_id text, p_customer_id text)
returns void language plpgsql set search_path = public as $function$
declare v_invoice public.jde_invoices%rowtype; v_item record; v_outstanding numeric;
begin
  select * into v_invoice from public.jde_invoices inv where inv.id = p_invoice_id and inv.company_id = p_company_id for update;
  if not found then raise exception 'Invoice not found for the active company.'; end if;

  if exists(select 1 from public.jde_payment_allocations pa where pa.invoice_id = p_invoice_id and pa.company_id = p_company_id) then
    raise exception 'A payment has already been recorded against this invoice — delete or edit that payment first.';
  end if;

  for v_item in select ii.id, ii.product_id from public.jde_invoice_items ii where ii.invoice_id = p_invoice_id and ii.company_id = p_company_id loop
    if v_item.product_id is not null then
      perform public.jde_restore_stock_layers_for_invoice_item(v_item.id);
    end if;
  end loop;
  delete from public.jde_invoice_items ii where ii.invoice_id = p_invoice_id and ii.company_id = p_company_id;

  -- A parked draft (added the same day as this fix, in a separate PR) never adjusted the
  -- customer's balance at save time — saveDraft in app/(dashboard)/sales/page.tsx saves with
  -- newOutstanding: 0 — so discarding one must not reverse a debt that was never recorded.
  -- Checked from the invoice's own status column, not a client-supplied flag: nothing sent from
  -- the browser can talk this into skipping or applying the reversal wrongly.
  if p_customer_id is not null and v_invoice.status is distinct from 'draft' then
    v_outstanding := greatest(coalesce(v_invoice.total, 0) - coalesce(v_invoice.paid, 0), 0);
    perform public.jde_adjust_customer_balance(p_customer_id, -v_outstanding);
  end if;

  delete from public.jde_invoices inv where inv.id = p_invoice_id and inv.company_id = p_company_id;
end $function$;

revoke all on function public.jde_delete_sales_invoice(text, text, text) from public, anon, authenticated;
grant execute on function public.jde_delete_sales_invoice(text, text, text) to service_role;

-- ============================================================================================
-- 3. Follow-up, applied while resolving a merge conflict with a same-day "Save as Draft" PR:
--    the rewrite above (§2) computes the reversal from total-paid unconditionally, which is
--    wrong for a draft — draft invoices carry a real total but never touched the customer's
--    balance in the first place. Folded into the create-or-replace above rather than kept as a
--    separate statement, since it's the same function; this section exists only to record that
--    the status check was a distinct, later fix, not part of the original security pass.
-- ============================================================================================
