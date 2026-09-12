/**
 * Every transaction of a day, from every part of the business, in one list.
 *
 * Each kind of entry is still recorded where it belongs — a sale on Sales, a purchase on
 * Purchases, an expense on Expenses — and each of those screens goes on showing only its own.
 * What was missing was the other half: one place to stand at the end of a day and see everything
 * that happened, in the order it happened, the way a day book has always worked.
 *
 * Two numbers are kept strictly apart, because conflating them is how a day's figures stop adding
 * up:
 *
 *   value    what the document is for. A ₹10,000 credit sale is a ₹10,000 sale whether or not a
 *            rupee has arrived.
 *   cash     what actually moved that day, in or out. The same credit sale moves nothing.
 *
 * The subtle part is a sale settled at the counter. `paid` on an invoice is not the money taken
 * that day — later payments are added to it as they are allocated. So the cash taken at the
 * counter is `paid` minus everything allocated to it since, and the later payments appear on
 * their own days as receipts. Without that subtraction the same rupee is counted twice: once on
 * the day of the sale and again on the day it was actually received. Purchases work the same way.
 *
 * Pure and synchronous — the route reads the rows, this decides what they mean.
 */

const IST_OFFSET_MINUTES = 330;

/**
 * The Indian calendar date a stored timestamp falls on.
 *
 * Returns, unlike invoices, carry only a `created_at` in UTC. The business trades in IST, so a
 * credit note written at 8pm on the 10th is stored as the 11th in UTC — slicing the raw string
 * files it on the wrong day, and a day's takings then disagree with the documents behind them.
 */
export function istDate(timestamp: string | null | undefined): string {
  if (!timestamp) return '';
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Date(parsed.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export type DayBookKind =
  | 'sale'
  | 'receipt'
  | 'purchase'
  | 'supplier-payment'
  | 'expense'
  | 'sales-return'
  | 'purchase-return'
  | 'settlement';

/** How each kind reads on screen, and whether it is money the business took or money it let go. */
export const DAYBOOK_LABELS: Record<DayBookKind, string> = {
  sale: 'Sale',
  receipt: 'Payment received',
  purchase: 'Purchase',
  'supplier-payment': 'Paid to supplier',
  expense: 'Expense',
  'sales-return': 'Sales return',
  'purchase-return': 'Purchase return',
  settlement: 'Settled off',
};

export type DayBookEntry = {
  id: string;
  /** YYYY-MM-DD in Indian time. */
  date: string;
  kind: DayBookKind;
  /** The document number, as printed. */
  reference: string;
  party: string;
  detail: string;
  /** What the document is for. Always positive; the kind says which direction it faces. */
  value: number;
  /** Money that actually came in on this date. */
  cashIn: number;
  /** Money that actually went out on this date. */
  cashOut: number;
  /** Where to open the document, when there is somewhere to open it. */
  href: string | null;
};

export type DayBookInvoice = { id: string; customer: string; date: string; total: unknown; paid: unknown; status: string };
export type DayBookAllocation = { invoice_id: string; amount: unknown };
export type DayBookReceipt = { id: string; customer: string; date: string; amount: unknown; note: string | null };
export type DayBookPurchase = { id: string; supplier: string; date: string; total: unknown; paid: unknown; status: string };
export type DayBookSupplierAllocation = { po_id: string; amount: unknown };
export type DayBookSupplierPayment = { id: string; supplier: string; date: string; amount: unknown; note: string | null; reference: string | null };
export type DayBookExpense = { id: string; category: string; description: string; amount: unknown; date: string; mode: string | null };
export type DayBookSalesReturn = { id: string; invoice_id: string; credit_total: unknown; refund_or_credit_amount: unknown; reason: string | null; created_at: string };
export type DayBookPurchaseReturn = { id: string; purchase_order_id: string; supplier: string; total: unknown; note: string | null; created_at: string };
export type DayBookSettlement = { id: string; invoice_id: string; customer: string; date: string; amount: unknown; reason: string | null };

export type DayBookSources = {
  invoices: DayBookInvoice[];
  paymentAllocations: DayBookAllocation[];
  receipts: DayBookReceipt[];
  purchases: DayBookPurchase[];
  supplierPaymentAllocations: DayBookSupplierAllocation[];
  supplierPayments: DayBookSupplierPayment[];
  expenses: DayBookExpense[];
  salesReturns: DayBookSalesReturn[];
  purchaseReturns: DayBookPurchaseReturn[];
  settlements: DayBookSettlement[];
};

const DRAFT_STATUS = 'draft';

function sumBy<T>(rows: T[], key: (row: T) => string, amount: (row: T) => number): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const id = key(row);
    totals.set(id, (totals.get(id) ?? 0) + amount(row));
  }
  return totals;
}

/** Every transaction, newest first. Drafts are left out entirely: nothing has been billed, so
 *  nothing has happened yet — showing them would put money in a day that was never agreed. */
export function buildDayBook(sources: DayBookSources): DayBookEntry[] {
  const entries: DayBookEntry[] = [];

  const allocatedToInvoice = sumBy(sources.paymentAllocations, (row) => row.invoice_id, (row) => num(row.amount));
  const allocatedToPurchase = sumBy(sources.supplierPaymentAllocations, (row) => row.po_id, (row) => num(row.amount));

  for (const invoice of sources.invoices) {
    if (invoice.status === DRAFT_STATUS) continue;
    const paid = num(invoice.paid);
    // Only what was taken at the counter. Anything allocated since is a receipt on its own day.
    const atCounter = Math.max(0, round2(paid - (allocatedToInvoice.get(invoice.id) ?? 0)));
    const total = num(invoice.total);
    entries.push({
      id: invoice.id,
      date: invoice.date,
      kind: 'sale',
      reference: invoice.id,
      party: invoice.customer,
      detail: atCounter >= total && total > 0
        ? 'Paid in full at the counter'
        : atCounter > 0
          ? `₹${round2(atCounter).toLocaleString('en-IN')} taken now, rest on account`
          : 'On account',
      value: round2(total),
      cashIn: atCounter,
      cashOut: 0,
      href: `/sales/invoice/${invoice.id}`,
    });
  }

  for (const receipt of sources.receipts) {
    const amount = round2(num(receipt.amount));
    entries.push({
      id: receipt.id,
      date: receipt.date,
      kind: 'receipt',
      reference: receipt.id,
      party: receipt.customer,
      detail: receipt.note?.trim() || 'Against outstanding invoices',
      value: amount,
      cashIn: amount,
      cashOut: 0,
      href: null,
    });
  }

  for (const purchase of sources.purchases) {
    if (purchase.status === DRAFT_STATUS) continue;
    const paid = num(purchase.paid);
    const atCounter = Math.max(0, round2(paid - (allocatedToPurchase.get(purchase.id) ?? 0)));
    const total = num(purchase.total);
    entries.push({
      id: purchase.id,
      date: purchase.date,
      kind: 'purchase',
      reference: purchase.id,
      party: purchase.supplier,
      detail: atCounter >= total && total > 0
        ? 'Paid in full on collection'
        : atCounter > 0
          ? `₹${round2(atCounter).toLocaleString('en-IN')} paid now, rest on account`
          : 'On account',
      value: round2(total),
      cashIn: 0,
      cashOut: atCounter,
      href: null,
    });
  }

  for (const payment of sources.supplierPayments) {
    const amount = round2(num(payment.amount));
    entries.push({
      id: payment.id,
      date: payment.date,
      kind: 'supplier-payment',
      reference: payment.reference?.trim() || payment.id,
      party: payment.supplier,
      detail: payment.note?.trim() || 'Against outstanding bills',
      value: amount,
      cashIn: 0,
      cashOut: amount,
      href: null,
    });
  }

  for (const expense of sources.expenses) {
    const amount = round2(num(expense.amount));
    entries.push({
      id: expense.id,
      date: expense.date,
      kind: 'expense',
      reference: expense.id,
      party: expense.category,
      detail: expense.description?.trim() || expense.category,
      value: amount,
      cashIn: 0,
      // An expense is recorded when it is paid, so it is always money out on its own date.
      cashOut: amount,
      href: null,
    });
  }

  for (const credit of sources.salesReturns) {
    // credit_total is what the note is worth; refund_or_credit_amount is what left the till, which
    // is zero when it was taken off the customer's account instead of handed back in cash.
    const value = round2(num(credit.credit_total));
    const refunded = round2(num(credit.refund_or_credit_amount));
    entries.push({
      id: credit.id,
      date: istDate(credit.created_at),
      kind: 'sales-return',
      reference: credit.id,
      party: credit.invoice_id,
      detail: credit.reason?.trim() || `Goods back against ${credit.invoice_id}`,
      value,
      cashIn: 0,
      cashOut: refunded,
      href: null,
    });
  }

  for (const credit of sources.purchaseReturns) {
    const value = round2(num(credit.total));
    entries.push({
      id: credit.id,
      date: istDate(credit.created_at),
      kind: 'purchase-return',
      reference: credit.id,
      party: credit.supplier,
      detail: credit.note?.trim() || `Goods back to supplier against ${credit.purchase_order_id}`,
      value,
      cashIn: 0,
      cashOut: 0,
      href: null,
    });
  }

  for (const settlement of sources.settlements) {
    const amount = round2(num(settlement.amount));
    entries.push({
      id: settlement.id,
      date: settlement.date,
      kind: 'settlement',
      reference: settlement.id,
      party: settlement.customer,
      // No cash either way: this closes a balance that was never going to arrive. Counting it as
      // money in would be the write-off inflating the day's takings, which is the whole thing the
      // settlement column exists to prevent.
      detail: settlement.reason?.trim() || `Closed the balance on ${settlement.invoice_id}`,
      value: amount,
      cashIn: 0,
      cashOut: 0,
      href: null,
    });
  }

  return entries
    .filter((entry) => entry.date)
    .sort((a, b) => (a.date === b.date ? b.reference.localeCompare(a.reference) : b.date.localeCompare(a.date)));
}

export type DayBookTotals = {
  cashIn: number;
  cashOut: number;
  /** What the till is up or down over the period. */
  netCash: number;
  sold: number;
  bought: number;
  spent: number;
  entryCount: number;
};

export function dayBookTotals(entries: DayBookEntry[]): DayBookTotals {
  let cashIn = 0, cashOut = 0, sold = 0, bought = 0, spent = 0;
  for (const entry of entries) {
    cashIn += entry.cashIn;
    cashOut += entry.cashOut;
    if (entry.kind === 'sale') sold += entry.value;
    if (entry.kind === 'purchase') bought += entry.value;
    if (entry.kind === 'expense') spent += entry.value;
  }
  return {
    cashIn: round2(cashIn),
    cashOut: round2(cashOut),
    netCash: round2(cashIn - cashOut),
    sold: round2(sold),
    bought: round2(bought),
    spent: round2(spent),
    entryCount: entries.length,
  };
}

export type DayBookDay = { date: string; entries: DayBookEntry[]; totals: DayBookTotals };

/** The same entries broken into days, newest day first — which is what makes it a day book rather
 *  than a list. Each day carries its own totals so a day can be read on its own. */
export function groupByDay(entries: DayBookEntry[]): DayBookDay[] {
  const days = new Map<string, DayBookEntry[]>();
  for (const entry of entries) {
    const bucket = days.get(entry.date);
    if (bucket) bucket.push(entry);
    else days.set(entry.date, [entry]);
  }
  return Array.from(days.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, dayEntries]) => ({ date, entries: dayEntries, totals: dayBookTotals(dayEntries) }));
}

/** Keeps only what falls inside the range, inclusive at both ends. Blank ends mean open-ended. */
export function withinRange(entries: DayBookEntry[], from: string, to: string): DayBookEntry[] {
  return entries.filter((entry) => (!from || entry.date >= from) && (!to || entry.date <= to));
}
