-- What customers call a part (November 2026): any number of other names, found by every part
-- search alongside the name (lib/part-names.ts). Typed in Stock, or saved from a bill with one
-- click the first time a part is found under a new word.
alter table public.jde_products add column if not exists other_names text[] not null default '{}';
