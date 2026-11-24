-- Part numbers on bills are optional (lib/tally-invoice.ts PART_NUMBER_CHOICES): each company
-- chooses in Settings whether its bills print every part number ('all', as before), only real ones
-- ('real': the codes the ERP made up, like BKT-P127, are left off) or none ('none').
--
-- Additive: one new column on jde_companies, defaulting to 'all' so every bill prints exactly as
-- it did until the owner chooses otherwise. Nothing else is altered and there is no DROP.

alter table public.jde_companies
  add column if not exists bill_part_numbers text not null default 'all'
  check (bill_part_numbers in ('all', 'real', 'none'));
