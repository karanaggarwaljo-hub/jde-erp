begin;

create table if not exists public.jde_adaptive_platform_outbox (
  event_id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('company.created', 'company.updated')),
  aggregate_id text not null,
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'delivered', 'dead_letter')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.jde_adaptive_platform_outbox enable row level security;
revoke all on table public.jde_adaptive_platform_outbox from public, anon, authenticated;
grant select, insert, update on table public.jde_adaptive_platform_outbox to service_role;

create index if not exists jde_adaptive_platform_outbox_dispatch_idx
  on public.jde_adaptive_platform_outbox (status, next_attempt_at, created_at)
  where status in ('queued', 'processing');

create or replace function public.jde_enqueue_adaptive_platform_company_event()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_event_id uuid := gen_random_uuid();
  new_event_type text := case when tg_op = 'INSERT' then 'company.created' else 'company.updated' end;
begin
  insert into public.jde_adaptive_platform_outbox (
    event_id,
    event_type,
    aggregate_id,
    payload
  ) values (
    new_event_id,
    new_event_type,
    new.id,
    jsonb_build_object(
      'eventId', new_event_id,
      'type', new_event_type,
      'occurredAt', to_char(statement_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'company', jsonb_build_object('id', new.id, 'name', new.name)
    )
  );
  return new;
end;
$$;

revoke all on function public.jde_enqueue_adaptive_platform_company_event() from public, anon, authenticated;

drop trigger if exists jde_companies_adaptive_platform_insert_outbox on public.jde_companies;
create trigger jde_companies_adaptive_platform_insert_outbox
after insert on public.jde_companies
for each row
execute function public.jde_enqueue_adaptive_platform_company_event();

drop trigger if exists jde_companies_adaptive_platform_update_outbox on public.jde_companies;
create trigger jde_companies_adaptive_platform_update_outbox
after update of name on public.jde_companies
for each row
when (old.name is distinct from new.name)
execute function public.jde_enqueue_adaptive_platform_company_event();

create or replace function public.jde_claim_adaptive_platform_events(
  p_limit integer default 20,
  p_aggregate_id text default null,
  p_lease_id uuid default gen_random_uuid()
)
returns table (
  event_id uuid,
  event_type text,
  aggregate_id text,
  payload jsonb,
  attempt_count integer,
  lease_id uuid
)
language sql
security invoker
set search_path = ''
as $$
  with claimable as (
    select candidate.event_id
    from public.jde_adaptive_platform_outbox as candidate
    where (
      candidate.status = 'queued'
      or (candidate.status = 'processing' and candidate.lease_until < now())
    )
      and candidate.next_attempt_at <= now()
      and (p_aggregate_id is null or candidate.aggregate_id = p_aggregate_id)
    order by candidate.created_at
    for update skip locked
    limit least(greatest(p_limit, 1), 100)
  )
  update public.jde_adaptive_platform_outbox as claimed
  set
    status = 'processing',
    attempt_count = claimed.attempt_count + 1,
    lease_id = p_lease_id,
    lease_until = now() + interval '2 minutes',
    updated_at = now()
  from claimable
  where claimed.event_id = claimable.event_id
  returning
    claimed.event_id,
    claimed.event_type,
    claimed.aggregate_id,
    claimed.payload,
    claimed.attempt_count,
    claimed.lease_id;
$$;

revoke all on function public.jde_claim_adaptive_platform_events(integer, text, uuid) from public, anon, authenticated;
grant execute on function public.jde_claim_adaptive_platform_events(integer, text, uuid) to service_role;

-- Reconcile companies that existed before this outbox was installed.
with missing as (
  select company.id, company.name, gen_random_uuid() as event_id
  from public.jde_companies as company
  where not exists (
    select 1
    from public.jde_adaptive_platform_outbox as existing
    where existing.aggregate_id = company.id
      and existing.event_type = 'company.created'
  )
)
insert into public.jde_adaptive_platform_outbox (event_id, event_type, aggregate_id, payload)
select
  missing.event_id,
  'company.created',
  missing.id,
  jsonb_build_object(
    'eventId', missing.event_id,
    'type', 'company.created',
    'occurredAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'company', jsonb_build_object('id', missing.id, 'name', missing.name)
  )
from missing;

commit;
