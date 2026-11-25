-- Change a saved bill's number (November 2026, at the owner's request). Everything that points at
-- the bill by its number moves with it, in one transaction: its lines, receipts set against it,
-- goods returned, a short settlement, the saved PDF record (so the Drive copy is renamed in place
-- when it is next replaced), a repair job, the quotation it came from, and its cash-book entry.
-- The audit log keeps the old number as history. A cancelled bill keeps its number. The new number
-- follows the same GST Rule 46 rules as a typed one (jde_save_sales_invoice) and must be unused.
-- An INV-<digits> number given up is remembered in jde_number_floors, so the automatic numbering
-- never hands it to another bill (it may already be on paper with a customer).
create or replace function public.jde_rename_invoice(p_company_id text, p_old_id text, p_new_id text)
returns text
language plpgsql
set search_path to 'public'
as $function$
declare
  v_new text := upper(btrim(coalesce(p_new_id, '')));
  v_old public.jde_invoices%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('jde-invoice-number'));
  select * into v_old from public.jde_invoices inv where inv.id = p_old_id and inv.company_id = p_company_id for update;
  if not found then
    raise exception 'Invoice not found for the active company.';
  end if;
  if v_new = v_old.id then
    return v_old.id;
  end if;
  if v_old.status = 'cancelled' then
    raise exception 'Invoice % is cancelled, so it keeps its number.', v_old.id;
  end if;
  if v_new = '' or length(v_new) > 16 or v_new !~ '^[A-Z0-9/-]+$' or v_new !~ '[0-9]' then
    raise exception 'Invoice number % cannot be used: use up to 16 letters, numbers, - or /, with at least one number.', v_new;
  end if;
  if exists (select 1 from public.jde_invoices inv where upper(inv.id) = v_new and inv.id <> v_old.id) then
    raise exception '% is already used by another bill. Type a different number.', v_new;
  end if;

  insert into public.jde_invoices
    select (jsonb_populate_record(null::public.jde_invoices, to_jsonb(v_old) || jsonb_build_object('id', v_new))).*;
  update public.jde_invoice_items set invoice_id = v_new where invoice_id = v_old.id;
  update public.jde_payment_allocations set invoice_id = v_new where invoice_id = v_old.id;
  update public.jde_sales_returns set invoice_id = v_new where invoice_id = v_old.id;
  update public.jde_invoice_writeoffs set invoice_id = v_new where invoice_id = v_old.id;
  update public.jde_invoice_files set invoice_id = v_new where invoice_id = v_old.id;
  update public.jde_job_cards set invoice_id = v_new where invoice_id = v_old.id;
  update public.jde_quotations set converted_invoice_id = v_new where converted_invoice_id = v_old.id;
  update public.jde_money_entries set source_id = v_new where source_type = 'invoice' and source_id = v_old.id;
  delete from public.jde_invoices where id = v_old.id;

  if v_old.id ~ '^INV-\d{1,9}$' then
    insert into public.jde_number_floors (prefix, last_used)
    values ('INV', substring(v_old.id from '^INV-(\d{1,9})$')::int)
    on conflict (prefix) do update set last_used = greatest(public.jde_number_floors.last_used, excluded.last_used);
  end if;
  return v_new;
end;
$function$;
revoke all on function public.jde_rename_invoice(text, text, text) from public, anon, authenticated;
grant execute on function public.jde_rename_invoice(text, text, text) to service_role;
