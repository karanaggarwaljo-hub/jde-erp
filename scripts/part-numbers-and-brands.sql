-- A part can carry several part numbers, and the same part can be stocked in more than one brand.
-- Applied as migration part_numbers_and_brands_2026_10_26, at the owner's request (October 2026).
--
-- 1. other_numbers: every other number a part is known by (a supplier's code, a superseded JCB
--    number, the maker's own number), searched everywhere the main part number is. Kept tidy by a
--    trigger whatever writes the row: blanks dropped, one spelling per code ("320/A7291" and
--    "320-A7291" are one code), never the part's own number, at most 30.
-- 2. One part number may now be used by more than one brand. Each brand is its own item with its
--    own stock, cost and price (the owner chose this over one shared stock count), so the rule is
--    "one number per brand", not "one number per company". The new rule is strictly weaker than
--    the old one, so every row the old rule allowed is still allowed.
-- 3. Merging two entries of one part keeps the dropped entry's number as one of the other numbers,
--    unless it was only a made-up SP- code.

alter table public.jde_products add column if not exists other_numbers text[] not null default '{}'::text[];
-- The website listing keeps no copy of these: the public catalogue feed reads them live from the
-- part (lib/db listPublishedCatalogProducts). A copy on jde_catalog_products was added and then
-- dropped the same day (migration catalog_reads_part_numbers_live_2026_10_26), unused and empty.

create or replace function public.jde_clean_other_numbers(p_numbers text[], p_main text)
returns text[]
language sql
immutable
set search_path to 'public'
as $$
  select coalesce((array_agg(d.n order by d.ord))[1:30], '{}'::text[])
  from (
    select distinct on (k.code) k.n, k.ord
    from (
      select left(trim(t.raw), 60) as n, t.ord,
             upper(regexp_replace(coalesce(t.raw, ''), '[^A-Za-z0-9]', '', 'g')) as code
      from unnest(coalesce(p_numbers, '{}'::text[])) with ordinality as t(raw, ord)
    ) k
    where k.code <> ''
      and k.code <> upper(regexp_replace(coalesce(p_main, ''), '[^A-Za-z0-9]', '', 'g'))
    order by k.code, k.ord
  ) d
$$;

create or replace function public.jde_tidy_other_numbers()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.other_numbers := public.jde_clean_other_numbers(new.other_numbers, new.part_number);
  return new;
end
$$;

drop trigger if exists jde_products_tidy_other_numbers on public.jde_products;
create trigger jde_products_tidy_other_numbers
  before insert or update of other_numbers, part_number on public.jde_products
  for each row execute function public.jde_tidy_other_numbers();

-- The new rule is created before the old one is dropped, so there is no moment without one.
create unique index if not exists jde_products_company_part_number_brand_key
  on public.jde_products (company_id, lower(trim(part_number)), lower(trim(coalesce(brand, ''))))
  where coalesce(trim(part_number), '') <> '';
drop index if exists public.jde_products_company_part_number_key;

create or replace function public.jde_create_product(p_company_id text, p_product jsonb, p_opening_qty numeric, p_opening_cost numeric)
 returns jde_products
 language plpgsql
 set search_path to 'public'
as $function$
declare v_id text; v_code text; v_brand text; v_numbers text[]; v_qty numeric; v_cost numeric; v_result public.jde_products;
begin
  if coalesce(trim(p_company_id), '') = '' then raise exception 'A company is required.'; end if;
  if coalesce(trim(p_product->>'name'), '') = '' then raise exception 'A part needs a name.'; end if;

  v_qty := round(coalesce(p_opening_qty, 0), 2);
  v_cost := round(coalesce(p_opening_cost, 0), 2);
  if v_qty < 0 then raise exception 'Opening stock cannot be negative.'; end if;

  -- Held for the rest of the transaction so two people adding a part at the same moment cannot
  -- both be handed the same next code.
  perform pg_advisory_xact_lock(hashtext('jde-part-number:' || p_company_id));

  v_brand := trim(coalesce(p_product->>'brand', ''));
  v_code := nullif(trim(coalesce(p_product->>'part_number', '')), '');
  if v_code is null then
    v_code := public.jde_next_part_number(p_company_id);
  elsif exists (select 1 from public.jde_products
                 where company_id = p_company_id and lower(trim(part_number)) = lower(v_code)
                   and lower(trim(coalesce(brand, ''))) = lower(v_brand)) then
    -- One number may be used by several brands of a part, but not twice by the same brand. Named,
    -- and refused before anything is written, so the screen can say which code clashed.
    if v_brand = '' then
      raise exception 'Part number % is already used by another part with no brand. Type this one''s brand, or give it its own number.', v_code;
    end if;
    raise exception 'Part number % is already used by another % part. Change the brand, or give this one its own number.', v_code, v_brand;
  end if;

  -- The part's other numbers, as a JSON list of text. The trigger tidies them.
  select coalesce(array_agg(x), '{}'::text[]) into v_numbers
    from jsonb_array_elements_text(
      case when jsonb_typeof(p_product->'other_numbers') = 'array' then p_product->'other_numbers' else '[]'::jsonb end
    ) as t(x);

  v_id := gen_random_uuid()::text;
  insert into public.jde_products (
    id, company_id, part_number, other_numbers, oem_number, name, brand, category, compatibility,
    cost_price, mrp, sale_price, current_stock, min_stock, location, hsn_code)
  values (
    v_id, p_company_id, v_code, v_numbers,
    coalesce(p_product->>'oem_number',''), trim(p_product->>'name'),
    v_brand, coalesce(p_product->>'category',''),
    coalesce(p_product->>'compatibility',''),
    v_cost,
    coalesce((p_product->>'mrp')::numeric, 0), coalesce((p_product->>'sale_price')::numeric, 0),
    v_qty, coalesce((p_product->>'min_stock')::numeric, 0),
    coalesce(p_product->>'location',''), coalesce(p_product->>'hsn_code',''))
  returning * into v_result;

  -- The opening batch, in the same transaction as the part itself. These were two calls from the
  -- browser: the part was created, then its batch. A failure between them left a part whose stock
  -- count had no purchase history behind it, so every FIFO figure for it was guesswork.
  -- adjust_stock is false because the insert above already set current_stock.
  if v_qty > 0 then
    perform public.jde_add_stock_layer(v_id, v_qty, v_cost, null, false);
    select * into v_result from public.jde_products where id = v_id;
  end if;

  return v_result;
end $function$;

-- Merging: the kept part also keeps both entries' other numbers, and the number of the entry that
-- goes (unless it was only a made-up SP- code), so a search for either number still finds it. One
-- line is added to the existing function, and nothing else in it changes; the edit refuses to run
-- if the line it attaches to has moved.
do $merge$
declare
  v_def text := pg_get_functiondef('public.jde_merge_products'::regproc);
  v_anchor text := E'else v_keep.image_url end\n  where p.id = p_keep_id';
  v_added text := E'else v_keep.image_url end,\n'
    || E'    other_numbers = coalesce(v_keep.other_numbers, ''{}''::text[]) || coalesce(v_remove.other_numbers, ''{}''::text[])\n'
    || E'      || array_remove(array[\n'
    || E'           case when v_keep.part_number ~* ''^sp-?[0-9]+$'' then null else v_keep.part_number end,\n'
    || E'           case when v_remove.part_number ~* ''^sp-?[0-9]+$'' then null else v_remove.part_number end], null)\n'
    || E'  where p.id = p_keep_id';
begin
  if position('other_numbers' in v_def) > 0 then
    return; -- already applied
  end if;
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'jde_merge_products has changed; the other-numbers line was not added.';
  end if;
  execute replace(v_def, v_anchor, v_added);
end
$merge$;
