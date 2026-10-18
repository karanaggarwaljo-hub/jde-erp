/**
 * The cash book: every rupee that came in or went out, which drawer or bank account it went
 * through, and what each holds now. Pure — the server gathers the rows (lib/db getMoneySource),
 * this turns them into one book, balances and statements.
 *
 * Money arrives from four kinds of record:
 *
 *   payments received   a customer paying against their bills          (in)
 *   supplier payments   paying a supplier against their bills          (out)
 *   expenses            rent, salary, freight…                         (out)
 *   money entries       money that moved inside another document — paid at the counter on a
 *                       bill, refunded on a return, paid on a purchase — and the owner's own
 *                       entries: transfers between accounts, money put in or taken out, bank
 *                       charges, drawer-count corrections                (signed)
 *
 * Rules:
 *   - A cheque counts toward its account only once it has cleared, and on the day it cleared.
 *     A pending cheque is listed separately; a bounced one never counts.
 *   - Each account starts from its opening balance on its opening date. Anything dated before
 *     that day is history the opening balance already includes, so it is not counted again.
 *   - A row with no account is "not placed": it is shown so it can be placed, never guessed into
 *     the cash drawer.
 */

export const MONEY_METHODS = [
  { key: 'cash', label: 'Cash' },
  { key: 'upi', label: 'UPI' },
  { key: 'card', label: 'Card' },
  { key: 'bank', label: 'Bank transfer' },
  { key: 'cheque', label: 'Cheque' },
] as const;
export type MoneyMethod = (typeof MONEY_METHODS)[number]['key'];

export function isMoneyMethod(value: unknown): value is MoneyMethod {
  return MONEY_METHODS.some((method) => method.key === value);
}

export function methodLabel(method: string | null | undefined): string {
  return MONEY_METHODS.find((entry) => entry.key === method)?.label ?? (method ? method : 'Not recorded');
}

/** Cash goes through a cash account; everything else through a bank account. */
export function accountKindFor(method: MoneyMethod): 'cash' | 'bank' {
  return method === 'cash' ? 'cash' : 'bank';
}

/** Old expenses recorded a free-text mode; read the common ones as methods. */
export function methodFromText(text: string | null | undefined): MoneyMethod | null {
  const value = (text ?? '').trim().toLowerCase();
  if (!value) return null;
  if (isMoneyMethod(value)) return value;
  if (value.includes('cheque') || value.includes('check')) return 'cheque';
  if (value.includes('upi') || value.includes('gpay') || value.includes('phonepe') || value.includes('paytm')) return 'upi';
  if (value.includes('card')) return 'card';
  if (value.includes('neft') || value.includes('rtgs') || value.includes('imps') || value.includes('bank')) return 'bank';
  if (value.includes('cash')) return 'cash';
  return null;
}

export type ChequeStatus = 'pending' | 'cleared' | 'bounced';

/** What a screen sends with a payment: how it was paid, and through which account. */
export type MoneyChoice = { method: MoneyMethod; accountId: string; chequeNo: string; chequeDate: string };

export type MoneyAccount = {
  id: string;
  name: string;
  kind: 'cash' | 'bank';
  opening_balance: number | string;
  opening_date: string;
  archived: boolean;
};

type ChequeFields = {
  cheque_no?: string | null;
  cheque_date?: string | null;
  cheque_status?: string | null;
  cleared_on?: string | null;
};
export type PaymentInRow = ChequeFields & { id: string; date: string; customer: string | null; amount: number | string; note: string | null; account_id: string | null; method: string | null };
export type SupplierPaymentRow = ChequeFields & { id: string; date: string; supplier: string | null; amount: number | string; note: string | null; reference: string | null; account_id: string | null; method: string | null };
export type ExpenseRow = ChequeFields & { id: string; date: string; category: string | null; description: string | null; amount: number | string; mode: string | null; account_id: string | null };
export type MoneyEntryKind = 'sale_counter' | 'sale_refund' | 'purchase_paid' | 'purchase_payment' | 'transfer' | 'owner_in' | 'owner_out' | 'bank_charge' | 'adjustment' | 'drawer_count';
export type MoneyEntryRow = ChequeFields & {
  id: string; date: string; kind: MoneyEntryKind; account_id: string | null; to_account_id: string | null; amount: number | string;
  method: string | null; source_type: string | null; source_id: string | null; party: string | null; note: string | null;
};

export type BookSource = 'payment_in' | 'supplier_payment' | 'expense' | 'entry';

export type BookRow = {
  /** `${source}:${id}` — unique across the book. */
  key: string;
  source: BookSource;
  sourceId: string;
  kind: MoneyEntryKind | 'payment_in' | 'supplier_payment' | 'expense';
  date: string;
  accountId: string | null;
  /** Transfers only: where the money went. */
  toAccountId: string | null;
  /** Signed, as seen from accountId: in is positive, out negative. */
  amount: number;
  method: string | null;
  what: string;
  party: string;
  /** The bill, purchase or return it belongs to. */
  reference: string | null;
  note: string | null;
  cheque: { no: string | null; date: string | null; status: ChequeStatus; clearedOn: string | null } | null;
};

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const round2 = (value: number) => Math.round(value * 100) / 100;

function chequeOf(row: ChequeFields, method: string | null): BookRow['cheque'] {
  if (method !== 'cheque') return null;
  const status = row.cheque_status === 'cleared' || row.cheque_status === 'bounced' ? row.cheque_status : 'pending';
  return { no: row.cheque_no ?? null, date: row.cheque_date ?? null, status, clearedOn: status === 'cleared' ? row.cleared_on ?? null : null };
}

const ENTRY_TEXT: Record<MoneyEntryKind, string> = {
  sale_counter: 'Paid at the counter',
  sale_refund: 'Refund on a return',
  purchase_paid: 'Paid with a purchase',
  purchase_payment: 'Paid against a purchase',
  transfer: 'Moved between accounts',
  owner_in: 'Money put in',
  owner_out: 'Money taken out',
  bank_charge: 'Bank charges',
  adjustment: 'Correction',
  drawer_count: 'Drawer count difference',
};

export function entryText(kind: string): string {
  return ENTRY_TEXT[kind as MoneyEntryKind] ?? kind.replace(/_/g, ' ');
}

/** Every record that moved money, as one list, newest first. */
export function bookRows(input: {
  payments: PaymentInRow[];
  supplierPayments: SupplierPaymentRow[];
  expenses: ExpenseRow[];
  entries: MoneyEntryRow[];
}): BookRow[] {
  const rows: BookRow[] = [];
  for (const row of input.payments) {
    rows.push({
      key: `payment_in:${row.id}`, source: 'payment_in', sourceId: row.id, kind: 'payment_in', date: row.date,
      accountId: row.account_id, toAccountId: null, amount: round2(num(row.amount)), method: row.method,
      what: 'Payment received', party: row.customer ?? '', reference: row.id, note: row.note, cheque: chequeOf(row, row.method),
    });
  }
  for (const row of input.supplierPayments) {
    rows.push({
      key: `supplier_payment:${row.id}`, source: 'supplier_payment', sourceId: row.id, kind: 'supplier_payment', date: row.date,
      accountId: row.account_id, toAccountId: null, amount: -round2(num(row.amount)), method: row.method,
      what: 'Paid a supplier', party: row.supplier ?? '', reference: row.reference || row.id, note: row.note, cheque: chequeOf(row, row.method),
    });
  }
  for (const row of input.expenses) {
    const method = methodFromText(row.mode);
    rows.push({
      key: `expense:${row.id}`, source: 'expense', sourceId: row.id, kind: 'expense', date: row.date,
      accountId: row.account_id, toAccountId: null, amount: -round2(num(row.amount)), method,
      what: `Expense${row.category ? ` · ${row.category}` : ''}`, party: '', reference: row.id, note: row.description, cheque: chequeOf(row, method),
    });
  }
  for (const row of input.entries) {
    rows.push({
      key: `entry:${row.id}`, source: 'entry', sourceId: row.id, kind: row.kind, date: row.date,
      accountId: row.account_id, toAccountId: row.to_account_id, amount: round2(num(row.amount)), method: row.method,
      what: entryText(row.kind), party: row.party ?? '', reference: row.source_id, note: row.note, cheque: chequeOf(row, row.method),
    });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date) || b.key.localeCompare(a.key));
}

/** A row's effect on one account: the signed amount, and the day it counts from. Null when it
 *  does not touch the account, or does not count (a cheque not yet cleared, or bounced). */
export function effectOn(row: BookRow, accountId: string): { amount: number; date: string } | null {
  if (row.cheque && row.cheque.status !== 'cleared') return null;
  const date = row.cheque?.clearedOn || row.date;
  if (row.accountId === accountId) return { amount: row.amount, date };
  // A transfer is stored as money out of accountId (negative), so it arrives as the opposite.
  if (row.kind === 'transfer' && row.toAccountId === accountId) return { amount: -row.amount, date };
  return null;
}

export type AccountBalance = {
  accountId: string;
  balance: number;
  moneyIn: number;
  moneyOut: number;
  /** Cheques in hand not yet cleared, coming into this account. */
  pendingIn: number;
  /** Cheques written from this account not yet cleared. */
  pendingOut: number;
};

/** Each account's balance as of `asOf` (inclusive; open-ended when null). */
export function accountBalances(accounts: MoneyAccount[], rows: BookRow[], asOf: string | null = null): Record<string, AccountBalance> {
  const out: Record<string, AccountBalance> = {};
  for (const account of accounts) {
    let balance = num(account.opening_balance);
    let moneyIn = 0;
    let moneyOut = 0;
    let pendingIn = 0;
    let pendingOut = 0;
    for (const row of rows) {
      if (row.cheque?.status === 'pending' && row.accountId === account.id) {
        if (row.amount > 0) pendingIn += row.amount;
        else pendingOut += -row.amount;
        continue;
      }
      const effect = effectOn(row, account.id);
      if (!effect || effect.date < account.opening_date || (asOf && effect.date > asOf)) continue;
      balance += effect.amount;
      if (effect.amount > 0) moneyIn += effect.amount;
      else moneyOut += -effect.amount;
    }
    out[account.id] = {
      accountId: account.id,
      balance: round2(balance),
      moneyIn: round2(moneyIn),
      moneyOut: round2(moneyOut),
      pendingIn: round2(pendingIn),
      pendingOut: round2(pendingOut),
    };
  }
  return out;
}

export type StatementLine = { row: BookRow; amount: number; date: string; balance: number };
export type Statement = { opening: number; lines: StatementLine[]; closing: number; moneyIn: number; moneyOut: number };

/** One account's statement between two days (inclusive; either may be null), oldest first, with
 *  a running balance. */
export function accountStatement(account: MoneyAccount, rows: BookRow[], from: string | null, to: string | null): Statement {
  const counted = rows
    .map((row) => ({ row, effect: effectOn(row, account.id) }))
    .filter((entry): entry is { row: BookRow; effect: { amount: number; date: string } } => entry.effect !== null && entry.effect.date >= account.opening_date)
    .sort((a, b) => a.effect.date.localeCompare(b.effect.date) || a.row.key.localeCompare(b.row.key));

  let balance = num(account.opening_balance);
  for (const entry of counted) if (from && entry.effect.date < from) balance += entry.effect.amount;
  const opening = round2(balance);
  const lines: StatementLine[] = [];
  let moneyIn = 0;
  let moneyOut = 0;
  for (const entry of counted) {
    if (from && entry.effect.date < from) continue;
    if (to && entry.effect.date > to) continue;
    balance += entry.effect.amount;
    if (entry.effect.amount > 0) moneyIn += entry.effect.amount;
    else moneyOut += -entry.effect.amount;
    lines.push({ row: entry.row, amount: entry.effect.amount, date: entry.effect.date, balance: round2(balance) });
  }
  return { opening, lines, closing: round2(balance), moneyIn: round2(moneyIn), moneyOut: round2(moneyOut) };
}

/** Rows not yet placed in any account — shown so the owner can place them. */
export function unplacedRows(rows: BookRow[]): BookRow[] {
  return rows.filter((row) => !row.accountId && row.kind !== 'transfer');
}

export function pendingCheques(rows: BookRow[]): BookRow[] {
  return rows.filter((row) => row.cheque?.status === 'pending');
}

/** What a drawer count found against what the book says should be there. Positive: more cash
 *  than expected. */
export function drawerDifference(expected: number, counted: number): number {
  return round2(counted - expected);
}
