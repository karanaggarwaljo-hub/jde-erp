-- Revoke the leftover anon/authenticated TABLE grants on the older jde_* tables, 2026-09-02.
--
-- Applied to the live Supabase project on 2026-09-02 as migration
--   revoke_leftover_anon_table_grants_on_jde_tables
--
-- Rehearsed first in a transaction forced to roll back (18 changed, 0 leftover, storefront and
-- service_role intact) before applying. Post-apply verification:
--
--   jde_* tables reachable by anon/authenticated  = 0   (excluding jde_catalog_products)
--   jde_* functions reachable                     = 0   (excluding the storefront getter)
--   anon SELECT on jde_catalog_products           = true
--   service_role SELECT on jde_invoices           = true
--   service_role INSERT on jde_products           = true
--
-- Smoke tested over HTTPS with the published key:
--
--   GET /rest/v1/jde_invoices?select=id          -> 401, 42501 "permission denied for table
--                                                    jde_invoices"  <- now a PRIVILEGE refusal,
--                                                    where before only RLS stood in the way
--   GET /rest/v1/jde_catalog_products?select=*   -> 200, real rows; count 0-4/5, i.e. exactly the
--                                                    5 published parts the shop expects
--
-- Companion to scripts/lock-down-jde-function-grants.sql (migration
-- lock_down_jde_function_grants, applied the same day). That one closed the FUNCTION grants; this
-- closes the TABLE grants underneath them.
--
--
-- What this fixes
-- ---------------
-- Supabase's default privileges hand anon and authenticated full SELECT/INSERT/UPDATE/DELETE on
-- every table created through the dashboard. The newer tables in this project revoke them at
-- creation -- scripts/ai-result-cache.sql says so explicitly, and names the gap:
--
--   "REVOKE goes one step further than the older tables, which still carry unused
--    anon/authenticated table grants that RLS alone is left to neutralise."
--
-- These are those older tables. Eighteen of them still carry the full set:
--
--   jde_catalog_events      jde_expenses              jde_payments_received   jde_stock_consumptions
--   jde_catalog_leads       jde_grns                  jde_po_items            jde_stock_layers
--   jde_companies           jde_invoice_items         jde_products            jde_suppliers
--   jde_customers           jde_invoices              jde_purchase_orders     jde_users
--   jde_payment_allocations jde_quotations
--
-- Every one has RLS enabled with ZERO policies, so anon and authenticated are already refused in
-- practice -- verified directly, as anon, rolled back:
--
--   insert into jde_invoices ...       -> 42501 "new row violates row-level security policy"
--   select count(*) from jde_invoices  -> 0 rows visible
--
-- So this is not a live hole either. It is the same defence-in-depth argument as the function
-- migration: RLS is currently the only thing standing between a published key and this data, and
-- these grants are what make that single point of failure sharp. Remove the grants and a table
-- that ever loses its RLS -- by accident, by a migration, by a policy added carelessly -- still
-- refuses anon, because anon has no privilege on it in the first place.
--
--
-- The deliberate exception: jde_catalog_products
-- ----------------------------------------------
-- Excluded entirely, and unlike the function migration's exception this one is load-bearing
-- TODAY: the public storefront fetches it straight over REST with the publishable key
-- (Documents/jai-durga-enterprises/shop.html, products.html ->
-- /rest/v1/jde_catalog_products), filtered by its single anon RLS policy to published rows of the
-- storefront company.
--
-- It is already configured exactly right -- anon has SELECT and nothing else, authenticated has
-- nothing at all -- so there is nothing to tighten. Revoking here would take the shop down, the
-- same way revoking EXECUTE on jde_public_storefront_company_id() did on 2026-08-25.
--
--
-- Out of scope, flagged not fixed
-- -------------------------------
-- The audit turned up two other groups carrying the same default grants. Neither is touched here,
-- because neither is what was asked for and both need a decision first:
--
--   1. Twenty erp_* tables (erp_invoices, erp_customers, erp_products, erp_profiles, ...), each
--      with RLS on and one policy scoped to `authenticated` -- not zero policies like the jde_*
--      ones. That means something was designed to read them as a signed-in user rather than
--      through service_role. Nothing in THIS repo references an erp_* table (grepped), but the
--      policies did not write themselves, so confirm what owns them before revoking anything.
--
--   2. Six Supabase starter-template leftovers: orders, order_items, products, profiles, reviews,
--      subscribers -- all with RLS, policies, and full anon/authenticated grants, none referenced
--      anywhere in this repo. Note that scripts/security-audit-fixes.sql calls `products` and
--      `reviews` tables that "don't exist in this app's schema" while fixing update_product_rating
--      -- they do exist. Most likely safe to drop outright, which is better than revoking.


-- ============================================================================================
-- 1. Audit (before)
-- ============================================================================================
--
--   select c.relname,
--          c.relrowsecurity as rls_on,
--          (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
--          has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
--          has_table_privilege('anon', c.oid, 'INSERT') as anon_insert,
--          has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relkind in ('r','p') and c.relname like 'jde\_%'
--   order by c.relname;


-- ============================================================================================
-- 2. The revoke
-- ============================================================================================

do $revoke_tables$
declare
  t       record;
  changed integer := 0;
begin
  if to_regrole('anon') is null or to_regrole('authenticated') is null then
    raise exception 'Expected Supabase roles anon and authenticated to exist; refusing to guess.';
  end if;

  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','p')
      and c.relname like 'jde\_%'
      -- The storefront reads this one with the publishable key. See above.
      and c.relname <> 'jde_catalog_products'
      and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
        or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE')
        or has_table_privilege('authenticated', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'INSERT')
        or has_table_privilege('authenticated', c.oid, 'UPDATE') or has_table_privilege('authenticated', c.oid, 'DELETE'))
    order by c.relname
  loop
    execute format('revoke all on table public.%I from public, anon, authenticated', t.relname);
    changed := changed + 1;
    raise notice 'revoked anon/authenticated grants on %', t.relname;
  end loop;

  raise notice '% jde_* table(s) cleaned', changed;
end
$revoke_tables$;


-- ============================================================================================
-- 3. Verify
-- ============================================================================================
--
-- Expect zero rows:
--
--   select c.relname
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relkind in ('r','p') and c.relname like 'jde\_%'
--     and c.relname <> 'jde_catalog_products'
--     and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
--       or has_table_privilege('authenticated', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'INSERT'));
--
-- Expect SELECT, and service_role untouched:
--
--   select has_table_privilege('anon', 'public.jde_catalog_products', 'SELECT') as storefront_ok,
--          has_table_privilege('service_role', 'public.jde_invoices', 'SELECT') as app_ok;


-- ============================================================================================
-- 4. Rehearsal result -- already run, 2026-09-02
-- ============================================================================================
--
-- Section 2 was executed inside a transaction ended by a RAISE, so it rolled back cleanly:
--
--   changed_count = 18
--   changed       = {jde_catalog_events, jde_catalog_leads, jde_companies, jde_customers,
--                    jde_expenses, jde_grns, jde_invoice_items, jde_invoices,
--                    jde_payment_allocations, jde_payments_received, jde_po_items, jde_products,
--                    jde_purchase_orders, jde_quotations, jde_stock_consumptions,
--                    jde_stock_layers, jde_suppliers, jde_users}
--   leftover      = {}                 -- nothing still reachable
--   catalog_products_anon = [SELECT]   -- storefront dependency intact
--   service_role_invoices_select = t   -- the app keeps full access
--
--
-- 5. After applying -- done, results in the header above
-- ------------------------------------------------------
-- The one check left for the owner's eyes: load https://jd-enterprise.com/shop.html and confirm
-- the catalogue renders. The REST endpoint it depends on was verified returning all 5 published
-- rows, so the data path is proven; this is just seeing it on the page. Note the deployed site
-- may still be serving the older static catalog.html -- the local storefront repo is ahead of
-- production -- so a stale-looking shop page is a deploy question, not a grants one.
