-- Paying a supplier with several cheques, all recorded or none (October 2026, at the owner's
-- request: "the amount is big, I issue multiple cheques to the supplier").
-- Applied as migration pay_supplier_in_parts_2026_10_27.
--
-- Each cheque is its own supplier payment, so a bounced or stopped cheque undoes only its own part
-- (lib/cheque-register.ts, jde_reverse_supplier_payment). They are recorded in one transaction by
-- calling jde_pay_supplier once per cheque: if any part is refused (more than is owed, say), none
-- is kept. Part i carries the reference `<reference>:<i>`, so a repeated submission returns the
-- payments already recorded instead of paying twice, exactly as jde_pay_supplier does for one.

create or replace function public.jde_pay_supplier_in_parts(
  p_company_id text, p_supplier_id text, p_date text, p_amounts numeric[], p_note text, p_reference text)
returns table(part integer, payment_id text, applied_total numeric, orders_paid integer)
language plpgsql
set search_path to 'public'
as $$
declare
  v_count integer := coalesce(array_length(p_amounts, 1), 0);
  v_i integer;
  v_row record;
begin
  if v_count = 0 then raise exception 'Add at least one cheque.'; end if;
  if v_count > 24 then raise exception 'At most 24 cheques can be given in one payment.'; end if;
  if coalesce(trim(p_reference), '') = '' then raise exception 'A payment reference is required.'; end if;

  for v_i in 1 .. v_count loop
    select * into v_row from public.jde_pay_supplier(
      p_company_id, p_supplier_id, p_date, p_amounts[v_i],
      trim(coalesce(p_note, '') || ' Cheque ' || v_i || ' of ' || v_count),
      p_reference || ':' || v_i);
    part := v_i;
    payment_id := v_row.payment_id;
    applied_total := v_row.applied_total;
    orders_paid := v_row.orders_paid;
    return next;
  end loop;
end
$$;

-- Like every other jde_ function, called only by the ERP's server. New functions are executable by
-- everyone by default; migration lock_new_functions_to_server_2026_10_27 took that back (it also
-- covered jde_clean_other_numbers and jde_tidy_other_numbers from scripts/part-numbers-and-brands.sql).
revoke execute on function public.jde_pay_supplier_in_parts(text, text, text, numeric[], text, text) from public, anon, authenticated;
grant execute on function public.jde_pay_supplier_in_parts(text, text, text, numeric[], text, text) to service_role;
