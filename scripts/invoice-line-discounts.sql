-- Applied to the live Supabase project on 2026-08-30 as migrations
--   add_invoice_item_line_discounts
--   save_sales_invoice_with_line_discounts
-- Kept here so the schema lives in the repo too, matching the other scripts/*.sql files.
--
-- WHY: the only discount an invoice could carry was one percentage applied to the whole thing,
-- which cannot express "10% off the filters, full price on the pump". Both columns are additive
-- with a 0 default, so every existing invoice item reads as "no line discount" and every existing
-- invoice keeps its whole-invoice discount working exactly as before.
--
-- line_total stays the amount actually charged for the line, now net of the line's own discount.
-- That is deliberate: the printable invoice's subtotal, sales returns and credit notes all already
-- read line_total, so they stay correct with no change of their own.
--
-- Rehearsed in BEGIN/ROLLBACK against real data before applying — including a full save through
-- the function, checking that a 10%-off line stored 1800 against a 2000 gross, and that the
-- invoice total equalled (subtotal - whole-invoice discount) x 1.18 to the paisa.

ALTER TABLE public.jde_invoice_items
  ADD COLUMN discount_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN discount_amount  numeric NOT NULL DEFAULT 0;

-- jde_save_sales_invoice then carries both new columns through its item insert:
--
--   insert into jde_invoice_items (..., line_total, discount_percent, discount_amount)
--   values (..., (v_item->>'line_total')::numeric,
--                coalesce((v_item->>'discount_percent')::numeric, 0),
--                coalesce((v_item->>'discount_amount')::numeric, 0));
--
-- The coalesce is what lets a caller that sends no discount fields behave exactly as before, so
-- nothing had to be deployed in lockstep with the schema change. Everything else in that function
-- is unchanged; see the migration for the full definition.
