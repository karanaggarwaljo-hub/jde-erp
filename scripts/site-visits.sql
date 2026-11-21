-- Website visits (lib/site-visits.ts): how many times each page of the company website was opened,
-- and how many WhatsApp, call and share taps each page led to, per day. Counted from the website by
-- /api/public/site-hit and shown on the Website visits screen.
--
-- Only counts are kept: no visitor, address, device or cookie, so there is nothing personal here.
-- One row per company, India day, page, kind (view, whatsapp, call, share) and, for views, where
-- the visitor came from. Not in the backup: these are statistics, not records of the business.
--
-- Additive: one new table and one function. Nothing existing is altered and there is no DROP.
-- Service role only, like every jde_ table.

create table if not exists public.jde_site_visits (
  company_id text not null references public.jde_companies(id) on delete cascade,
  day date not null,
  path text not null check (path ~ '^/[a-z0-9/._-]{0,160}$'),
  kind text not null check (kind in ('view', 'whatsapp', 'call', 'share')),
  -- Where a page view came from (lib/site-visits.ts sourceOf); '' for a tap.
  source text not null default '' check (source in ('', 'direct', 'google', 'search', 'whatsapp', 'social', 'site', 'other')),
  count integer not null default 0 check (count >= 0),
  primary key (company_id, day, path, kind, source)
);

create index if not exists jde_site_visits_day_idx on public.jde_site_visits (company_id, day desc);

-- Adds one to a count. The website is public, so anyone could send made-up page addresses: a page
-- not yet counted that day is only added while the day has fewer than 5,000 rows, which keeps such
-- a flood from growing the table without limit. Pages already counted that day keep counting.
create or replace function public.jde_site_hit(p_company text, p_day date, p_path text, p_kind text, p_source text)
returns void language plpgsql set search_path to 'public' as $function$
begin
  if not exists (
    select 1 from jde_site_visits
    where company_id = p_company and day = p_day and path = p_path and kind = p_kind and source = p_source
  ) and (select count(*) from jde_site_visits where company_id = p_company and day = p_day) >= 5000 then
    return;
  end if;
  insert into jde_site_visits (company_id, day, path, kind, source, count)
  values (p_company, p_day, p_path, p_kind, p_source, 1)
  on conflict (company_id, day, path, kind, source) do update set count = jde_site_visits.count + 1;
end $function$;

alter table public.jde_site_visits enable row level security;
revoke all on public.jde_site_visits from anon, authenticated;
grant all on public.jde_site_visits to service_role;
revoke all on function public.jde_site_hit(text, date, text, text, text) from public, anon, authenticated;
grant execute on function public.jde_site_hit(text, date, text, text, text) to service_role;
