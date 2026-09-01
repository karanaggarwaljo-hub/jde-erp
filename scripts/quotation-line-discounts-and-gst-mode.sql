-- Applied to the live Supabase project on 2026-09-01 as migrations
--   add_quotation_line_discounts_and_gst_mode
--   save_quotation_with_line_discounts_and_gst_mode
--   convert_quotation_carries_line_discounts_and_gst_mode
--   drop_old_save_quotation_overload_and_lock_grants
--
-- Brings quotations to parity with sales invoices: a discount per line, and the choice of quoting
-- GST-inclusive or GST-exclusive. All three columns are additive with defaults matching how every
-- existing quotation genuinely was.

ALTER TABLE public.jde_quotation_items
  ADD COLUMN discount_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN discount_amount  numeric NOT NULL DEFAULT 0;

ALTER TABLE public.jde_quotations
  ADD COLUMN gst_mode text NOT NULL DEFAULT 'exclusive';

-- jde_save_quotation differs from the invoice save in one way that matters here: it RECOMPUTES
-- every total from the lines and refuses the save when the client's figures disagree by more than
-- a paisa. So it had to learn both ideas, or a quotation with a line discount would have been
-- rejected as "Quotation totals do not match its lines." Its arithmetic is now:
--
--   line_net  = round(qty*price,2) - round(round(qty*price,2) * line_disc%/100, 2)
--   subtotal  = sum(line_net)
--   discount  = round(subtotal * whole_quote_disc%/100, 2)
--   after     = subtotal - discount
--   exclusive:  gst = round(after * r/100, 2)        total = round(after + gst, 2)
--   inclusive:  gst = round(after * r/(100+r), 2)    total = round(after, 2)
--
-- The sales screen mirrors this rounding step for step; summing unrounded values and rounding once
-- at the end drifts past the 0.01 tolerance on a long quotation and the save is refused.
--
-- jde_convert_quotation_to_invoice now carries each line's discount into the invoice's line JSON,
-- and stamps the quotation's gst_mode onto the created invoice — otherwise a GST-inclusive quote
-- became a GST-exclusive invoice whose printed tax was wrong while its total silently matched.
--
-- TWO TRAPS WORTH KNOWING, both hit while doing this:
--
-- 1. Adding a defaulted parameter to a function does NOT replace it. CREATE OR REPLACE with the
--    extra p_gst_mode argument created a SECOND, 15-argument function beside the original
--    14-argument one. The app calls this by named parameters and kept resolving to the old body,
--    so line discounts were silently ignored. The old overload is dropped explicitly:
--
--      DROP FUNCTION IF EXISTS public.jde_save_quotation(text, text, boolean, text, text, text,
--        text, jsonb, numeric, numeric, numeric, numeric, numeric, numeric);
--
-- 2. A newly created function is executable by PUBLIC by default. The replacement therefore came
--    into being with anon/authenticated rights the function it replaced did not have. Restored to
--    match the original — revoking from PUBLIC, since anon and authenticated inherit from it and
--    revoking from them alone would not be enough:
--
--      REVOKE ALL ON FUNCTION public.jde_save_quotation(...) FROM PUBLIC, anon, authenticated;
--      GRANT EXECUTE ON FUNCTION public.jde_save_quotation(...) TO service_role;
--
-- Verified end to end against the live database, rolled back: a quotation of 2x1000 less 10% plus
-- 1x500, whole-quote 5%, priced GST-inclusive at 18% stored subtotal 2300.00, discount 115.00,
-- gst 333.31, total 2185.00 with the line discounts on its rows; converting it produced an invoice
-- carrying both the line discounts and gst_mode='inclusive'; and a legacy call sending neither new
-- field produced exactly the figures it always did.
