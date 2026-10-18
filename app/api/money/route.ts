import { requireOwner, checkCompanyAccess } from '@/lib/auth/dal';
import { money as rupees, recordAudit } from '@/lib/audit-log';
import { ensureMoneyAccounts } from '@/lib/cash-book';
import { chequeForSource, setChequeStatus } from '@/lib/cheque-register';
import {
  dbErrorMessage,
  deleteMoneyEntry,
  getMoneySource,
  insertMoneyAccount,
  insertMoneyEntry,
  setMoneyFields,
  updateMoneyAccount,
  type MoneySourceTable,
} from '@/lib/db';
import { shopDay } from '@/lib/logbook';
import { accountBalances, accountKindFor, bookRows, drawerDifference, isMoneyMethod, type MoneyEntryKind } from '@/lib/money-book';

export const dynamic = 'force-dynamic';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const OWNER_ENTRY_KINDS: MoneyEntryKind[] = ['transfer', 'owner_in', 'owner_out', 'bank_charge', 'adjustment', 'drawer_count'];
const PLACEABLE: MoneySourceTable[] = ['payments_received', 'supplier_payments', 'expenses', 'money_entries'];

const amountOf = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : NaN;
};
const textOf = (value: unknown, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * Cash & Bank. GET: the company's accounts and every money row (the page works out balances and
 * statements with lib/money-book.ts). POST: the owner's actions — accounts, transfers and other
 * own entries, the drawer count, placing a payment in an account, a cheque clearing or bouncing.
 *
 * Owner-only (proxy.ts too): it shows what is in the drawer and the bank.
 */
export async function GET(request: Request) {
  await requireOwner();
  const companyId = new URL(request.url).searchParams.get('companyId') ?? '';
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  try {
    await ensureMoneyAccounts(companyId);
    const source = await getMoneySource(companyId);
    return Response.json({ accounts: source.accounts, rows: bookRows(source), today: shopDay(new Date()) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('GET /api/money failed:', error);
    return Response.json({ error: dbErrorMessage(error, 'The cash book could not be loaded.') }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  const body = await request.json().catch(() => ({}));
  const companyId = textOf(body?.companyId, 80);
  const access = await checkCompanyAccess(companyId);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  const action = textOf(body?.action, 40);
  const bad = (error: string) => Response.json({ error }, { status: 400 });

  try {
    const accounts = await ensureMoneyAccounts(companyId);
    const accountById = (id: unknown) => accounts.find((account) => account.id === id);

    if (action === 'add-account') {
      const name = textOf(body?.name, 60);
      const kind = body?.kind === 'cash' ? 'cash' : 'bank';
      const opening = amountOf(body?.openingBalance ?? 0);
      const openingDate = DAY.test(String(body?.openingDate ?? '')) ? String(body.openingDate) : shopDay(new Date());
      if (!name) return bad('Give the account a name, such as "HDFC current" or "Shop UPI".');
      if (Number.isNaN(opening)) return bad('The opening balance must be a number.');
      if (accounts.some((account) => account.name.toLowerCase() === name.toLowerCase())) return bad(`There is already an account called "${name}".`);
      const created = await insertMoneyAccount({ company_id: companyId, name, kind, opening_balance: opening, opening_date: openingDate });
      await recordAudit({ companyId, action: 'money.account', entity: 'money_accounts', entityId: created.id, summary: `Added the ${kind} account "${name}" with ${rupees(opening)} as of ${openingDate}` });
      return Response.json(created, { status: 201 });
    }

    if (action === 'edit-account') {
      const account = accountById(body?.id);
      if (!account) return bad('That account is not in this company.');
      const patch: Record<string, unknown> = {};
      if (typeof body?.name === 'string') {
        const name = textOf(body.name, 60);
        if (!name) return bad('An account needs a name.');
        if (accounts.some((other) => other.id !== account.id && other.name.toLowerCase() === name.toLowerCase())) return bad(`There is already an account called "${name}".`);
        patch.name = name;
      }
      if (body?.openingBalance !== undefined) {
        const opening = amountOf(body.openingBalance);
        if (Number.isNaN(opening)) return bad('The opening balance must be a number.');
        patch.opening_balance = opening;
      }
      if (body?.openingDate !== undefined) {
        if (!DAY.test(String(body.openingDate))) return bad('Pick an opening date.');
        patch.opening_date = String(body.openingDate);
      }
      if (typeof body?.archived === 'boolean') patch.archived = body.archived;
      const updated = await updateMoneyAccount(companyId, account.id, patch);
      await recordAudit({
        companyId, action: 'money.account', entity: 'money_accounts', entityId: account.id,
        summary: `Changed the account "${account.name}"`,
        details: { before: { name: account.name, opening_balance: account.opening_balance, opening_date: account.opening_date, archived: account.archived }, after: patch },
      });
      return Response.json(updated);
    }

    if (action === 'entry') {
      const kind = body?.kind as MoneyEntryKind;
      if (!OWNER_ENTRY_KINDS.includes(kind) || kind === 'drawer_count') return bad('Unknown kind of entry.');
      const amount = amountOf(body?.amount);
      if (!(amount > 0)) return bad('Enter an amount greater than zero.');
      const date = DAY.test(String(body?.date ?? '')) ? String(body.date) : shopDay(new Date());
      const from = accountById(body?.accountId);
      if (!from || from.archived) return bad('Choose an account.');
      const to = kind === 'transfer' ? accountById(body?.toAccountId) : undefined;
      if (kind === 'transfer' && (!to || to.archived || to.id === from.id)) return bad('Choose a different account to move the money into.');
      // Money in for owner_in and an adjustment upward; everything else leaves `from`.
      const direction = kind === 'owner_in' || (kind === 'adjustment' && body?.direction === 'in') ? 1 : -1;
      const method = isMoneyMethod(body?.method) ? body.method : (from.kind === 'cash' ? 'cash' : 'bank');
      const created = await insertMoneyEntry({
        company_id: companyId, date, kind, account_id: from.id, to_account_id: to?.id ?? null, amount: direction * amount,
        method, party: null, note: textOf(body?.note, 300) || null, created_by: owner.email,
      });
      await recordAudit({
        companyId, action: 'money.entry', entity: 'money_entries', entityId: created.id,
        summary: kind === 'transfer'
          ? `Moved ${rupees(amount)} from "${from.name}" to "${to!.name}"`
          : `${direction > 0 ? 'Put' : 'Took'} ${rupees(amount)} ${direction > 0 ? 'into' : 'out of'} "${from.name}" (${kind.replace(/_/g, ' ')})`,
      });
      return Response.json(created, { status: 201 });
    }

    if (action === 'drawer-count') {
      const account = accountById(body?.accountId);
      if (!account || account.kind !== 'cash') return bad('Choose a cash account to count.');
      const counted = amountOf(body?.counted);
      if (Number.isNaN(counted) || counted < 0) return bad('Enter the cash you counted.');
      const date = DAY.test(String(body?.date ?? '')) ? String(body.date) : shopDay(new Date());
      const source = await getMoneySource(companyId);
      const expected = accountBalances([account], bookRows(source), date)[account.id]?.balance ?? 0;
      const difference = drawerDifference(expected, counted);
      if (difference !== 0 && body?.record !== false) {
        await insertMoneyEntry({
          company_id: companyId, date, kind: 'drawer_count', account_id: account.id, amount: difference, method: 'cash',
          note: `Counted ${rupees(counted)}; the book said ${rupees(expected)}`, created_by: owner.email,
        });
      }
      await recordAudit({
        companyId, action: 'money.count', entity: 'money_accounts', entityId: account.id,
        summary: difference === 0
          ? `Counted "${account.name}": ${rupees(counted)}, exactly what the book says`
          : `Counted "${account.name}": ${rupees(counted)} against ${rupees(expected)} in the book — ${difference > 0 ? 'more' : 'short'} by ${rupees(Math.abs(difference))}`,
      });
      return Response.json({ expected, counted, difference });
    }

    if (action === 'place') {
      const table = body?.table as MoneySourceTable;
      if (!PLACEABLE.includes(table)) return bad('Unknown record.');
      const method = isMoneyMethod(body?.method) ? body.method : 'cash';
      const account = accountById(body?.accountId);
      if (!account || account.archived || account.kind !== accountKindFor(method)) {
        return bad(method === 'cash' ? 'Choose a cash account for a cash payment.' : 'Choose a bank account for this payment.');
      }
      const ok = await setMoneyFields(companyId, table, String(body?.id ?? ''), {
        account_id: account.id,
        method,
        cheque_no: method === 'cheque' ? textOf(body?.chequeNo, 30) || null : null,
        cheque_date: method === 'cheque' && DAY.test(String(body?.chequeDate ?? '')) ? String(body.chequeDate) : null,
        cheque_status: method === 'cheque' ? 'pending' : null,
        cleared_on: null,
      });
      if (!ok) return bad('That record is not in this company.');
      await recordAudit({ companyId, action: 'money.place', entity: table, entityId: String(body?.id ?? ''), summary: `Placed ${String(body?.id ?? '')} in "${account.name}" (${method})` });
      return Response.json({ ok: true });
    }

    if (action === 'cheque') {
      const table = body?.table as MoneySourceTable;
      if (!PLACEABLE.includes(table)) return bad('Unknown record.');
      const status = body?.status === 'cleared' || body?.status === 'bounced' || body?.status === 'pending' ? body.status : null;
      if (!status) return bad('Say whether the cheque cleared or bounced.');
      const clearedOn = status === 'cleared' ? (DAY.test(String(body?.clearedOn ?? '')) ? String(body.clearedOn) : shopDay(new Date())) : null;
      // A cheque in the register moves through it, so a bounce also undoes what it paid
      // (lib/cheque-register.ts). Only a cheque from before the register is updated in place.
      const registered = await chequeForSource(companyId, table, String(body?.id ?? ''));
      if (registered) {
        const result = await setChequeStatus(companyId, owner.email, registered.id, status, clearedOn);
        return Response.json({ ok: true, undone: result.undone });
      }
      const ok = await setMoneyFields(companyId, table, String(body?.id ?? ''), { cheque_status: status, cleared_on: clearedOn });
      if (!ok) return bad('That record is not in this company.');
      await recordAudit({
        companyId, action: 'money.cheque', entity: table, entityId: String(body?.id ?? ''),
        summary: status === 'cleared' ? `Cheque on ${String(body?.id ?? '')} cleared on ${clearedOn}` : status === 'bounced' ? `Cheque on ${String(body?.id ?? '')} bounced` : `Cheque on ${String(body?.id ?? '')} marked as not yet cleared`,
      });
      return Response.json({ ok: true });
    }

    if (action === 'delete-entry') {
      const source = await getMoneySource(companyId);
      const entry = source.entries.find((row) => row.id === body?.id);
      if (!entry) return bad('That entry is not in this company.');
      if (!OWNER_ENTRY_KINDS.includes(entry.kind)) {
        return bad('This entry belongs to a bill, return or purchase. Change or delete that instead.');
      }
      await deleteMoneyEntry(companyId, entry.id);
      await recordAudit({
        companyId, action: 'money.entry_delete', entity: 'money_entries', entityId: entry.id,
        summary: `Deleted a cash-book entry: ${entry.kind.replace(/_/g, ' ')} of ${rupees(Math.abs(Number(entry.amount)))} on ${entry.date}`,
      });
      return Response.json({ ok: true });
    }

    return bad('Unknown action.');
  } catch (error) {
    console.error(`POST /api/money (${action}) failed:`, error);
    return Response.json({ error: dbErrorMessage(error, 'The cash book could not be updated.') }, { status: 500 });
  }
}
