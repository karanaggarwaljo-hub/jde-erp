/**
 * Entering cheques from the routes that take or pay money. Server-only.
 *
 * Every screen that takes or pays money can send `money: { method, accountId, chequeNo,
 * chequeDate, bankName }`. Only a cheque is recorded: the route does its usual work first (saving
 * the bill, the payment, the expense — each its own database transaction), then calls one of these
 * to enter the cheque in the register (lib/cheque-register.ts). Anything else (cash, UPI…) records
 * nothing here. They never throw: by then the sale or payment is already saved, and failing the
 * request over the cheque would tell the owner it was not. A failure is written to the Log Book.
 *
 * Cash & Bank (drawer and bank balances) was removed on 2026-10-19 at the owner's request. Its
 * tables stay: jde_money_accounts now holds only the owner's banks, which cheque books and cheques
 * given are drawn on, and jde_money_entries only the record behind a cheque taken or paid inside a
 * bill or a purchase, which is what a bounce undoes.
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
import type { MoneyEntryKind } from './money-book';

export type ResolvedMoney = {
  method: 'cheque' | 'other';
  accountId: string | null;
  chequeNo: string | null;
  chequeDate: string | null;
  /** The bank a cheque received is drawn on (the customer's bank). */
  bankName: string | null;
};

/** The company's banks, for cheque books and the cheques drawn on them. */
export async function listBanks(companyId: string): Promise<MoneyAccountRow[]> {
  return (await listMoneyAccounts(companyId)).filter((account) => account.kind === 'bank' && !account.archived);
}

/** The bank with this name, added first if the company does not have it yet. */
export async function bankNamed(companyId: string, name: string): Promise<MoneyAccountRow> {
  const wanted = name.trim().slice(0, 80);
  const same = (account: MoneyAccountRow) => account.kind === 'bank' && account.name.trim().toLowerCase() === wanted.toLowerCase();
  const existing = (await listMoneyAccounts(companyId)).find(same);
  if (existing) return existing;
  try {
    return await insertMoneyAccount({ company_id: companyId, name: wanted, kind: 'bank', opening_balance: 0, opening_date: shopDay(new Date()) });
  } catch (error) {
    // Two screens added it at once (unique company + name).
    const again = (await listMoneyAccounts(companyId)).find(same);
    if (again) return again;
    throw error;
  }
}

const text = (value: unknown, max = 60) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);

/** Reads `money` from a request body. A cheque given is drawn on the bank chosen, or the
 *  company's only bank; with several and none chosen, or none at all, it is entered without one. */
export async function resolveMoney(companyId: string, raw: unknown, direction: 'in' | 'out' = 'out'): Promise<ResolvedMoney> {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  if (input.method !== 'cheque') return { method: 'other', accountId: null, chequeNo: null, chequeDate: null, bankName: null };
  let accountId: string | null = null;
  if (direction === 'out') {
    const banks = await listBanks(companyId);
    accountId = (banks.find((bank) => bank.id === input.accountId) ?? (banks.length === 1 ? banks[0] : undefined))?.id ?? null;
  }
  return {
    method: 'cheque',
    accountId,
    chequeNo: text(input.chequeNo, 30),
    chequeDate: text(input.chequeDate, 10),
    bankName: direction === 'in' ? text(input.bankName, 80) : null,
  };
}

function chequeColumns(money: ResolvedMoney) {
  return {
    account_id: money.accountId,
    method: 'cheque',
    cheque_no: money.chequeNo,
    cheque_date: money.chequeDate,
    cheque_status: 'pending' as const,
  };
}

async function noteFailure(companyId: string, what: string, error: unknown): Promise<void> {
  console.error(`Cheques: ${what} failed:`, error);
  await recordAudit({
    companyId, action: 'cheque.failed', entity: 'cheques', entityId: null,
    summary: `Could not enter the cheque in the register: ${what}. Add it on the Cheques page.`,
    details: { error: error instanceof Error ? error.message : String(error) },
  });
}

/** Enters the cheque that paid a payment received, a supplier payment or an expense — rows that
 *  already exist. Not a cheque: nothing to do. */
export async function placeMoney(companyId: string, table: Exclude<MoneySourceTable, 'money_entries'>, id: string, raw: unknown, by = ''): Promise<void> {
  const direction = table === 'payments_received' ? 'in' : 'out';
  try {
    const money = await resolveMoney(companyId, raw, direction);
    if (money.method !== 'cheque') return;
    await setMoneyFields(companyId, table, id, chequeColumns(money));
    await registerChequeFor(companyId, by, table, id, money, direction);
  } catch (error) {
    await noteFailure(companyId, `${table.replace(/_/g, ' ')} ${id}`, error);
  }
}

/** Enters a cheque that moved money inside another document (a bill, a purchase, a return).
 *  `amount` is signed: money in positive, out negative. Zero, or not a cheque, records nothing. */
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
  const direction = amount > 0 ? 'in' : 'out';
  try {
    const money = await resolveMoney(companyId, entry.raw, direction);
    if (money.method !== 'cheque') return;
    // The record a bounce undoes (lib/cheque-register.ts): which bill or purchase, and how much.
    const created = await insertMoneyEntry({
      company_id: companyId,
      date: /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? entry.date : shopDay(new Date()),
      kind: entry.kind,
      amount,
      ...chequeColumns(money),
      source_type: entry.sourceType,
      source_id: entry.sourceId,
      party: entry.party ?? null,
      note: entry.note ?? null,
      created_by: by,
    });
    await registerChequeFor(companyId, by, 'money_entries', created.id, money, direction);
  } catch (error) {
    await noteFailure(companyId, `${entry.kind.replace(/_/g, ' ')} of ₹${Math.abs(amount)} on ${entry.sourceId}`, error);
  }
}
