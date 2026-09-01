-- Lock down EXECUTE on every jde_* function, 2026-09-02.
--
-- Applied to the live Supabase project on 2026-09-02 as migration
--   lock_down_jde_function_grants
--
-- Rehearsed first in a transaction that was forced to roll back with a RAISE, then re-audited
-- (still 15 reachable, i.e. the rollback took) before applying for real. 15 functions changed:
--
--   jde_add_stock_layer(text,numeric,numeric,text,boolean)
--   jde_adjust_customer_balance(text,numeric)
--   jde_adjust_product_stock(text,numeric)
--   jde_adjust_supplier_balance(text,numeric)
--   jde_consume_stock_fifo(text,numeric,uuid)
--   jde_correct_oldest_layer_cost(text,numeric)
--   jde_create_expense(text,text,text,numeric,text,text,text)
--   jde_receive_purchase_stock(text,text,text,text,jsonb)              <- stale overload
--   jde_receive_purchase_stock(text,text,text,text,text,jsonb)
--   jde_restore_stock_layers_for_invoice_item(uuid)
--   jde_save_purchase(text,text,text,text,text,jsonb,numeric,numeric,text)          <- stale overload
--   jde_save_purchase(text,text,text,text,text,jsonb,numeric,numeric,text,text)     <- stale overload
--   jde_save_purchase(text,text,text,text,text,text,text,jsonb,numeric,numeric,text)
--   jde_save_sales_invoice(text,text,boolean,text,text,text,numeric,numeric,text,jsonb,numeric,numeric,text,text,numeric,numeric,numeric,numeric)
--   jde_set_updated_at()                                               <- in no repo script
--
-- All 15 now read {postgres=X/postgres,service_role=X/postgres}. Post-apply audit returns zero
-- jde_* functions reachable by anon or authenticated, excluding the storefront getter below,
-- which correctly still reads {postgres=X/postgres,service_role=X/postgres,anon=X/postgres}.
--
-- Note how many of those the naming approach would have missed: three jde_save_purchase
-- overloads where the app only calls one, two jde_receive_purchase_stock overloads, and
-- jde_set_updated_at(), which appears in no .sql file in this repo at all.
--
--
-- What prompted this
-- ------------------
-- jde_save_sales_invoice — the function that writes every sales invoice — carries these grants:
--
--   {=X/postgres, postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
--
-- The bare "=X/postgres" is the grant to PUBLIC; anon and authenticated then hold their own
-- explicit grants on top of it, which is what Supabase's default privileges hand to every newly
-- created function. Newer functions in this codebase were locked down at creation and sit at
-- {postgres=X/postgres,service_role=X/postgres}: jde_delete_sales_invoice,
-- jde_record_purchase_return, jde_record_purchase_payment, jde_write_off_invoice_balance.
-- jde_save_sales_invoice predates that habit; nothing in recent work introduced this.
--
-- The anon/publishable key is a public credential — it ships in readable form in the storefront
-- repo's own HTML (Documents/jai-durga-enterprises/shop.html:340, products.html:175) — so "anon
-- has EXECUTE" means anyone on the internet could reach POST /rest/v1/rpc/jde_save_sales_invoice
-- with no login, bypassing the Next.js app, its session check and its company-access check.
--
-- How bad was it, precisely? Less bad than it first looks, and it is worth being exact rather
-- than alarming, because the distinction is the whole reason this is defence-in-depth and not an
-- incident:
--
--   All 15 functions were SECURITY INVOKER. An anon caller therefore ran the body AS anon, and
--   every jde_* table has RLS enabled with zero policies, so the writes inside were refused.
--   Verified directly, as anon, rolled back:
--
--     insert into jde_invoices ... -> 42501 "new row violates row-level security policy"
--     select count(*) from jde_invoices -> 0 rows visible
--
-- So no invoice could actually be forged through this. Contrast jde_set_storefront_company in
-- scripts/security-audit-fixes.sql section 1, which was SECURITY DEFINER: that one ran as the
-- owner, bypassed RLS entirely, and was genuinely exploitable. This is not that.
--
-- What it was: the entire safety of a dozen money-and-stock code paths resting on RLS being
-- correctly configured on every table they touch, forever, with no second layer. That bet is
-- worse than it sounds, because anon still holds redundant table-level INSERT/UPDATE/SELECT
-- grants on jde_invoices, jde_invoice_items, jde_products, jde_customers, jde_suppliers,
-- jde_stock_layers, jde_expenses and jde_purchase_orders — RLS is the only thing neutralising
-- them, which scripts/ai-result-cache.sql already flagged as a known gap on the older tables.
-- One table with RLS accidentally disabled or a policy added carelessly, and the function layer
-- offered no resistance at all. Now it does. Revoking those leftover table grants is the obvious
-- companion cleanup and is NOT done here.
--
--
-- Why this sweeps the catalogue instead of naming functions one at a time
-- ----------------------------------------------------------------------
-- Every prior grant fix in this repo names its target and full argument list, e.g.
--   revoke all on function public.jde_receive_customer_payment(text,text,text,numeric,text,jsonb) from public,anon,authenticated;
-- That works when you are locking down a function you just wrote and whose signature you have in
-- front of you. It is the wrong tool here, for two reasons:
--
--   1. Several jde_* functions the app calls have no create statement anywhere in this repo —
--      jde_activate_company, jde_delete_company, jde_save_purchase, jde_receive_purchase_stock,
--      jde_create_expense — so their exact argument lists cannot be written down from the source
--      tree. A guessed signature does not fail loudly; it either errors on a name that does not
--      resolve or locks down nothing, which is the worst outcome for a security fix.
--   2. Postgres identifies functions by full signature, so an overload left behind by an earlier
--      create-or-replace keeps its own grants. scripts/security-audit-fixes.sql section 2 hit
--      exactly this with the old 3-arg jde_delete_sales_invoice. A catalogue sweep cannot miss
--      one.
--
-- The loop below reads pg_proc, so it is correct and complete by construction against whatever
-- is actually deployed, whether or not this repo has a copy of it. It is idempotent — re-running
-- it is a no-op once everything is locked — and it names every function it touches via RAISE
-- NOTICE, so the migration output IS the record of what changed. Paste that output back into
-- this comment block once applied.
--
-- Note on reading proacl: a NULL proacl means "owner defaults", and the default for a FUNCTION
-- includes EXECUTE for PUBLIC. A blank acl column in the audit is therefore reachable, not
-- locked. The loop tests has_function_privilege rather than parsing the acl text, which gets
-- this right without special-casing.
--
--
-- The one deliberate exception: jde_public_storefront_company_id()
-- ---------------------------------------------------------------
-- anon is EXPECTED to hold EXECUTE on this one. Do not "tidy it up" — it is load-bearing for the
-- public website, and a sweep that revokes it takes the storefront down.
--
--   The RLS policy "public can read published catalog products" on jde_catalog_products calls
--   jde_public_storefront_company_id(). An RLS policy expression is evaluated as the querying
--   role, so anon must have EXECUTE on that function for the policy to pass — without it every
--   public catalogue read fails with 42501 and the shop page shows its error state.
--
-- This has already happened once. scripts/security-audit-fixes.sql section 1 revoked the grant
-- as part of the 2026-08-25 pass (reasonably — the function had no known caller at the time),
-- which broke every public read; the storefront repo's commit c06b029 recorded the breakage, and
-- it was restored on 2026-08-31 by migration grant_anon_execute_on_storefront_company_id, then
-- verified: anon sees only the published rows, cannot write, and every other jde_* table still
-- returns empty. So the live grant today should read anon=X in addition to service_role.
--
-- Granting it is the defensible call: the function is read-only, takes no arguments and only
-- returns which company id is the storefront. That is emphatically NOT true of the setter,
-- jde_set_storefront_company(text), which let anyone flip which company's private catalogue is
-- served publicly and must stay locked forever.
--
-- Excluding it from the loop keeps this migration safe to re-run at any time. Confirm the live
-- state in the section 1 audit before applying: this function appearing with
-- anon_can_execute = true is the correct result, not a finding.


-- ============================================================================================
-- 1. Audit. Run this FIRST, on its own, and keep the output — it is the "before" record.
-- ============================================================================================
--
-- Anything with anon_can_execute or authenticated_can_execute = true is reachable from the
-- internet with the published key. Expected true for jde_save_sales_invoice; the point of
-- running it is to find the ones nobody has thought about yet.
--
-- Exactly one true is a correct result and must be left alone: jde_public_storefront_company_id,
-- for the RLS reason above. Every other true is a finding.
--
--   select
--     p.oid::regprocedure                                       as function,
--     case when p.prosecdef then 'definer' else 'invoker' end   as security,
--     coalesce(p.proacl::text, '(null - owner default, PUBLIC has EXECUTE)') as acl,
--     has_function_privilege('anon', p.oid, 'execute')          as anon_can_execute,
--     has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname like 'jde\_%'
--   order by
--     (has_function_privilege('anon', p.oid, 'execute')
--      or has_function_privilege('authenticated', p.oid, 'execute')) desc,
--     p.proname;


-- ============================================================================================
-- 2. The lockdown.
-- ============================================================================================

do $lockdown$
declare
  fn      record;
  changed integer := 0;
begin
  -- Guard rather than assume: has_function_privilege() raises if the role is missing, which
  -- would abort the whole migration on a database where these roles are named differently.
  if to_regrole('anon') is null or to_regrole('authenticated') is null then
    raise exception 'Expected Supabase roles anon and authenticated to exist; refusing to guess.';
  end if;

  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'jde\_%'
      -- See "The one deliberate exception" above. Keeps this migration re-runnable.
      and p.proname <> 'jde_public_storefront_company_id'
      -- A grant to PUBLIC makes has_function_privilege() true for both roles, so testing these
      -- two catches the PUBLIC case as well; no separate aclcontains() check is needed.
      and (has_function_privilege('anon', p.oid, 'execute')
           or has_function_privilege('authenticated', p.oid, 'execute'))
    order by 1
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
    execute format('grant execute on function %s to service_role', fn.sig);
    changed := changed + 1;
    raise notice 'locked down %', fn.sig;
  end loop;

  raise notice '% jde_* function(s) locked down to {postgres=X,service_role=X}', changed;
end
$lockdown$;

-- Trigger functions caught by the sweep (jde_enqueue_adaptive_platform_company_event,
-- jde_unpublish_catalog_on_product_delete, and any like them) keep firing normally: Postgres
-- invokes a trigger function as the table owner regardless of EXECUTE grants. That was already
-- established in scripts/security-audit-fixes.sql sections 1 and 4. The redundant grant to
-- service_role on such a function is harmless.


-- ============================================================================================
-- 3. Verify. Expect zero rows.
-- ============================================================================================
--
--   select p.oid::regprocedure as still_reachable, p.proacl::text as acl
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname like 'jde\_%'
--     and p.proname <> 'jde_public_storefront_company_id'
--     and (has_function_privilege('anon', p.oid, 'execute')
--          or has_function_privilege('authenticated', p.oid, 'execute'));
--
-- And the specific function this started from, expected
-- {postgres=X/postgres,service_role=X/postgres}:
--
--   select p.oid::regprocedure, p.proacl
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'jde_save_sales_invoice';


-- ============================================================================================
-- 4. Rehearsal — run this whole block first and confirm the counts before applying for real.
-- ============================================================================================
--
--   begin;
--     -- section 1 audit query here        (the "before" list)
--     -- section 2 do $lockdown$ ... ;     (watch the NOTICE lines)
--     -- section 3 verify queries here     (expect zero rows)
--   rollback;
--
-- ROLLBACK genuinely undoes this: GRANT and REVOKE are transactional in Postgres, so the
-- rehearsal leaves the live grants untouched. Only once the NOTICE list looks right — nothing
-- unexpected in it — re-run the same block with COMMIT.
--
--
-- 5. Smoke test after applying — results, 2026-09-02
-- --------------------------------------------------
-- Signed out, over plain HTTPS, with the published anon key. Note that a bare 404 on
-- jde_save_sales_invoice proves nothing on its own: PostgREST returns the same PGRST202 for a
-- parameter mismatch as for a function it cannot see. The discriminating test is an A/B on two
-- ZERO-ARGUMENT functions, where "{}" matches the signature exactly and the grant is the only
-- variable:
--
--   A  POST /rest/v1/rpc/jde_set_updated_at              -> 404 PGRST202 (revoked, invisible)
--   B  POST /rest/v1/rpc/jde_public_storefront_company_id -> 200 "6d0e3949-..." (grant kept)
--
-- Same key, same call shape, opposite results: the revoke is real and effective at the API edge,
-- and the storefront's dependency is intact. The catalogue read anon actually uses was checked
-- too — GET /rest/v1/jde_catalog_products?select=id&limit=1 still returns 200.
--
-- Positive, that the app's own path is unbroken: called as service_role inside a transaction
-- that was then rolled back —
--
--   set local role service_role;
--   perform public.jde_save_sales_invoice(...);   -- "function body executed with no exception"
--
-- A 42501 insufficient_privilege there would have meant this migration broke invoice saving.
-- It executed, so service_role retains EXECUTE and lib/db/index.ts is unaffected.
--
-- NOT RUN, by the owner's decision: an end-to-end save through the running app
-- (POST /api/sales/save-invoice -> lib/db/index.ts -> this function). The worktree has no
-- .env.local, and the evidence above already covers the same path — every RPC in lib/db/index.ts
-- goes through the service-role client, and service_role was shown to still execute this exact
-- function. Worth one real invoice save through the Sales page at the next opportunity to close
-- it off in the app itself.
