/**
 * Recording where money went, for the routes that move it. Server-only.
 *
 * Every screen that takes or pays money sends `money: { method, accountId, chequeNo, chequeDate }`
 * alongside its usual fields. The route does its usual work first (saving the bill, the payment,
 * the expense — each its own database transaction), then calls one of these to place the money in
 * the cash book. They never throw: by then the sale or payment is already saved, and failing the
 * request over the cash book would tell the owner it was not. A failure is written to the Log Book
 * instead, and a payment or expense left without an account shows on the Cash & Bank page as "not
 * placed", where it can be placed by hand.
 */

import { recordAudit } from './audit-log';
import {
  insertMoneyAccount,
  insertMoneyEntry,
  listMoneyAccounts,
  setMoneyFields,
  type MoneyAccountRow,
  type MoneySourceTable,
} from './db';
import { shopDay } from './logbook';
import { registerChequeFor } from './cheque-register';
import { accountKindFor, isMoneyMethod, type MoneyEntryKind, type MoneyMethod } from './money-book';

export const CASH_DRAWER = 'Cash drawer';

export type ResolvedMoney = {
  method: MoneyMethod;
  accountId: string | null;
  chequeNo: string | null;
  chequeDate: string | null;
};

/** The company's accounts, starting it with a cash drawer the first time it is needed. Its
 *  opening balance is zero from today; the owner sets the real figure on the Cash & Bank page. */
export async function ensureMoneyAccounts(companyId: string): Promise<MoneyAccountRow[]> {
  const accounts = await listMoneyAccounts(companyId);
  if (accounts.length > 0) return accounts;
  try {
    return [await insertMoneyAccount({ company_id: companyId, name: CASH_DRAWER, kind: 'cash', opening_balance: 0, opening_date: shopDay(new Date()) })];
  } catch {
    // Two screens asked at once and the other made it first (unique company + name).
    return listMoneyAccounts(companyId);
  }
}

const text = (value: unknown, max = 60) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);

/** Reads `money` from a request body. With no choice made, cash into the cash drawer. An account
 *  that is not this company's, archived, or the wrong kind for the method is not used: the money
 *  goes to the method's first account of the right kind, or stays unplaced if there is none (a
 *  UPI payment with no bank account set up yet). */
export async function resolveMoney(companyId: string, raw: unknown): Promise<ResolvedMoney> {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const method: MoneyMethod = isMoneyMethod(input.method) ? input.method : 'cash';
  const kind = accountKindFor(method);
  const accounts = (await ensureMoneyAccounts(companyId)).filter((account) => !account.archived);
  const chosen = accounts.find((account) => account.id === input.accountId && account.kind === kind);
  const fallback = accounts.find((account) => account.kind === kind);
  return {
    method,
    accountId: (chosen ?? fallback)?.id ?? null,
    chequeNo: method === 'cheque' ? text(input.chequeNo, 30) : null,
    chequeDate: method === 'cheque' ? text(input.chequeDate, 10) : null,
  };
}

function moneyColumns(money: ResolvedMoney) {
  return {
    account_id: money.accountId,
    method: money.method,
    cheque_no: money.chequeNo,
    cheque_date: money.chequeDate,
    cheque_status: money.method === 'cheque' ? ('pending' as const) : null,
  };
}

async function noteFailure(companyId: string, what: string, error: unknown): Promise<void> {
  console.error(`Cash book: ${what} failed:`, error);
  await recordAudit({
    companyId, action: 'money.failed', entity: 'money_entries', entityId: null,
    summary: `Could not record in Cash & Bank: ${what}. Place it by hand on the Cash & Bank page.`,
    details: { error: error instanceof Error ? error.message : String(error) },
  });
}

/** Places a payment received, a supplier payment or an expense — rows that already exist — in an
 *  account. */
export async function placeMoney(companyId: string, table: Exclude<MoneySourceTable, 'money_entries'>, id: string, raw: unknown, by = ''): Promise<void> {
  try {
    const money = await resolveMoney(companyId, raw);
    await setMoneyFields(companyId, table, id, moneyColumns(money));
    // Paid by cheque: into the cheque register too (lib/cheque-register.ts).
    await registerChequeFor(companyId, by, table, id, money, table === 'payments_received' ? 'in' : 'out');
  } catch (error) {
    await noteFailure(companyId, `placing ${table.replace(/_/g, ' ')} ${id}`, error);
  }
}

/** Records money that moved inside another document (a bill, a purchase, a return). `amount` is
 *  signed: money in positive, out negative. Zero records nothing. */
export async function recordMoney(companyId: string, by: string, entry: {
  kind: MoneyEntryKind;
  date: string;
  amount: number;
  raw: unknown;
  sourceType: string;
  sourceId: string;
  party?: string | null;
  note?: string | null;
}): Promise<void> {
  const amount = Math.round(entry.amount * 100) / 100;
  if (!amount) return;
  try {
    const money = await resolveMoney(companyId, entry.raw);
    const created = await insertMoneyEntry({
      company_id: companyId,
      date: /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? entry.date : shopDay(new Date()),
      kind: entry.kind,
      amount,
      ...moneyColumns(money),
      source_type: entry.sourceType,
      source_id: entry.sourceId,
      party: entry.party ?? null,
      note: entry.note ?? null,
      created_by: by,
    });
    await registerChequeFor(companyId, by, 'money_entries', created.id, money, amount > 0 ? 'in' : 'out');
  } catch (error) {
    await noteFailure(companyId, `${entry.kind.replace(/_/g, ' ')} of ₹${Math.abs(amount)} on ${entry.sourceId}`, error);
  }
}
