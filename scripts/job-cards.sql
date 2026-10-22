-- Job cards: a machine in for repair over several days, with the parts it takes. The parts live on
-- one draft bill linked by invoice_id (the bill form already reserves their stock and turns the draft
-- into the final bill when the customer pays), so a job card holds only the job's own details.
-- "Billed" is not stored: it is read from the linked bill (lib/job-cards.ts).
--
-- Additive; rollback-tested (JOB-1001 numbering, blank customer and unknown status refused). Applied
-- 2026-10-23 as migration job_cards. Service role only, like every jde_ table.

create sequence if not exists public.jde_job_card_no_seq start 1001;
create table if not exists public.jde_job_cards (
  id text primary key default gen_random_uuid()::text,
  company_id text not null references public.jde_companies(id) on delete cascade,
  job_no text not null default ('JOB-' || nextval('public.jde_job_card_no_seq')::text) unique,
  customer text not null check (char_length(trim(customer)) between 1 and 120),
  machine text not null default '' check (char_length(machine) <= 120),
  machine_no text not null default '' check (char_length(machine_no) <= 60),
  complaint text not null default '' check (char_length(complaint) <= 500),
  notes text not null default '' check (char_length(notes) <= 1000),
  status text not null default 'open' check (status in ('open', 'ready', 'cancelled')),
  opened_on date not null default current_date,
  ready_on date,
  invoice_id text,
  created_at timestamptz not null default now()
);
create index if not exists jde_job_cards_company_idx on public.jde_job_cards (company_id, opened_on desc);
alter table public.jde_job_cards enable row level security;
revoke all on public.jde_job_cards from anon, authenticated;
revoke all on sequence public.jde_job_card_no_seq from anon, authenticated;
grant all on public.jde_job_cards to service_role;
grant usage on sequence public.jde_job_card_no_seq to service_role;
