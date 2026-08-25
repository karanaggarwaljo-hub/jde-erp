-- Applied to the live Supabase project as migration `create_jde_ai_cache` on 2026-08-26.
-- Kept here so the schema lives in the repo too, matching the other scripts/*.sql files.
--
-- Backs the daily allowance on the AI features (lib/ai/cache.ts): the last result per company per
-- feature is stored and replayed, so a provider is only called a fixed number of times a day
-- instead of on every page load and every report tab switch.
--
-- Purely additive. Rehearsed in a BEGIN/ROLLBACK block against real data before being applied.

CREATE TABLE public.jde_ai_cache (
  company_id   text        NOT NULL,
  feature      text        NOT NULL,
  -- Distinguishes sub-views of one feature (e.g. which report tab a summary belongs to).
  variant      text        NOT NULL DEFAULT '',
  -- Fingerprint of the input the answer was produced from. Lets a caller tell "this summary
  -- still describes what is on screen" from "the numbers have moved since", so a cached answer
  -- is never presented as describing figures it never saw.
  fingerprint  text        NOT NULL DEFAULT '',
  payload      jsonb       NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  -- The business day (Asia/Kolkata) that runs_on_day counts against. Kept as a stored date
  -- rather than derived from generated_at so the allowance resets on the owner's local day,
  -- not at UTC midnight (which falls at 5:30am in India, mid-morning).
  day_ist      date        NOT NULL,
  runs_on_day  integer     NOT NULL DEFAULT 1,
  PRIMARY KEY (company_id, feature, variant)
);

-- Same posture as every other jde_ table: RLS on with zero policies, so only the service-role
-- key used by the server can touch it and the browser can never reach it directly. The explicit
-- REVOKE goes one step further than the older tables, which still carry unused anon/authenticated
-- table grants that RLS alone is left to neutralise.
ALTER TABLE public.jde_ai_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jde_ai_cache FROM anon, authenticated;
