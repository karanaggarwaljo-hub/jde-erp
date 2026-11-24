-- Optional shipping address for a customer (November 2026). Blank means goods go to the billing
-- address, and the bill's Ship To repeats it.
alter table public.jde_customers add column if not exists shipping_address text;
