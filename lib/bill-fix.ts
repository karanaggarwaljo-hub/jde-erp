/**
 * Putting a bill right: goods came back, the whole bill is cancelled, or it is deleted.
 *
 * These were three separate entries in a bill's "⋯" menu — Return goods, Cancel this bill, Delete —
 * each opening its own window with its own wording, and the owner had to know beforehand which of
 * the three his situation was. Two of them could also be refused by the database only after a
 * reason had been typed ("a payment has been recorded against this invoice").
 *
 * There is now one window (components/sales/FixBillModal.tsx) that asks what happened. This file is
 * what it decides with, kept pure so it can be tested away from the screen:
 *
 *   billFixOptions      which of the three can be done to this bill right now, and if not, why,
 *                       said before anything is typed. The rules are the database's own
 *                       (jde_create_sales_return, jde_cancel_sales_invoice,
 *                       jde_delete_sales_invoice); the database still enforces them.
 *   previewSalesReturn  what a return will take off the bill, to the paisa, worked out exactly as
 *                       jde_create_sales_return does, so the figure on screen is the figure saved.
 */

import { round2 } from './money';

export const DRAFT = 'draft';
export const CANCELLED = 'cancelled';

export type FixableInvoice = {
  id: string;
  status: string;
  total: number | string;
  paid: number | string;
  settlement_write_off?: number | string | null;
  discount_percent?: number | string | null;
  gst_percent?: number | string | null;
  gst_mode?: string | null;
};

const num = (value: number | string | null | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export type FixKind = 'return' | 'cancel' | 'delete';

export type FixOption = { allowed: true } | { allowed: false; why: string };

export type BillFacts = {
  /** How many line items the bill has on file. Bills older than line-by-line billing have none. */
  lineCount: number;
  /** Returns already recorded against it. */
  returnCount: number;
  /** Receipts recorded later through "Money received" and applied to this bill, by number. Money
   *  taken at the counter when the bill was made is not one of these. */
  laterPayments: string[];
};

const ok: FixOption = { allowed: true };
const no = (why: string): FixOption => ({ allowed: false, why });

/**
 * What can be done to this bill, and the reason for anything that cannot.
 *
 * Returning goods is the forgiving one: it works on a part-paid or fully paid bill and simply
 * lowers what the bill comes to. Cancelling and deleting undo the whole bill, so anything recorded
 * on top of it (a later payment, a short settlement, a return) has to be undone first.
 */
export function billFixOptions(invoice: FixableInvoice, facts: BillFacts): Record<FixKind, FixOption> {
  if (invoice.status === CANCELLED) {
    const done = no('This bill is already cancelled.');
    return { return: done, cancel: done, delete: done };
  }
  if (invoice.status === DRAFT) {
    const notYet = no('A draft has not been billed yet. Open it to change its parts, or discard it.');
    return { return: notYet, cancel: notYet, delete: ok };
  }

  const writtenOff = num(invoice.settlement_write_off) > 0;
  const receipts = facts.laterPayments.join(', ');
  const undoWhole: FixOption = facts.laterPayments.length > 0
    ? no(`Money was received on this bill afterwards (${receipts}). Reverse that payment first, in Sales → Customer Ledger.`)
    : writtenOff
      ? no('This bill was settled for less than its total. That settlement has to be removed first.')
      : facts.returnCount > 0
        ? no('Goods were already returned on this bill. Undo that return first (Sales → Returns), or return the rest of the goods instead.')
        : ok;

  return {
    return: facts.lineCount === 0 ? no('This bill is older than line-by-line bills, so its parts are not on record.') : ok,
    cancel: undoWhole,
    delete: undoWhole,
  };
}

/* ---------------------------------------------------------------------------------------------
 * What a return takes off the bill
 * ------------------------------------------------------------------------------------------- */

export type ReturnLineInput = {
  /** How many were sold on the line, and what the line was charged in all (after its own discount). */
  soldQty: number | string;
  lineTotal: number | string;
  /** How many are coming back now. */
  qty: number;
  damaged?: boolean;
};

export type ReturnPreview = {
  /** Pieces coming back, and how many of those go back on the shelf. */
  units: number;
  restocked: number;
  damaged: number;
  /** What the returned pieces were charged, before the bill's own discount and GST. */
  subtotal: number;
  discount: number;
  gst: number;
  /** What comes off the bill. */
  credit: number;
  /** What the bill comes to afterwards. */
  newTotal: number;
  /** Money to hand back: what the customer had paid beyond the bill's new total. */
  refund: number;
  /** What is still owed on the bill afterwards. */
  stillOwed: number;
};

/**
 * The same arithmetic, in the same order and with the same rounding, as jde_create_sales_return:
 * each line at what it was actually charged per piece, the bill's own discount taken off the sum,
 * then GST read the way the bill was priced (added on top, or already inside the amount).
 */
export function previewSalesReturn(invoice: FixableInvoice, lines: readonly ReturnLineInput[]): ReturnPreview {
  let subtotal = 0;
  let units = 0;
  let damaged = 0;
  for (const line of lines) {
    const qty = num(line.qty);
    if (!(qty > 0)) continue;
    const sold = num(line.soldQty);
    const netRate = sold > 0 ? num(line.lineTotal) / sold : 0;
    subtotal += round2(netRate * qty);
    units += qty;
    if (line.damaged) damaged += qty;
  }
  subtotal = round2(subtotal);

  const discount = round2(subtotal * num(invoice.discount_percent) / 100);
  const after = round2(subtotal - discount);
  const rate = num(invoice.gst_percent);
  const inclusive = (invoice.gst_mode ?? 'exclusive') === 'inclusive';
  const gst = inclusive ? round2(after * rate / (100 + rate)) : round2(after * rate / 100);
  const credit = inclusive ? after : round2(after + gst);

  const total = num(invoice.total);
  const paid = num(invoice.paid);
  const writeOff = num(invoice.settlement_write_off);
  const newTotal = round2(Math.max(total - credit, 0));
  const newPaid = Math.min(paid, newTotal);
  const newWriteOff = Math.min(writeOff, Math.max(newTotal - newPaid, 0));
  return {
    units,
    restocked: units - damaged,
    damaged,
    subtotal,
    discount,
    gst,
    credit,
    newTotal,
    refund: round2(Math.max(paid - newTotal, 0)),
    stillOwed: round2(Math.max(newTotal - newPaid - newWriteOff, 0)),
  };
}

/* ---------------------------------------------------------------------------------------------
 * Reasons
 *
 * A reason is kept with every return and every cancelled bill, and the database refuses either
 * without one. Typing a sentence each time was the slow part, so the usual ones are a single tap;
 * "Other" still takes any words.
 * ------------------------------------------------------------------------------------------- */

export const RETURN_REASONS = ['Wrong part', 'Damaged or faulty', 'Not needed any more', 'Too many taken'] as const;
export const CANCEL_REASONS = ['Wrong customer', 'Wrong parts or price', 'Customer cancelled the order', 'Bill made by mistake'] as const;

/** The reason to save: the chosen one, or what was typed under "Other". Blank until there is one. */
export function chosenReason(picked: string | null, other: string): string {
  return (picked === null ? other : picked).trim();
}

/** Bills worth offering in the "which bill?" list: every bill something can still be done to,
 *  newest first, narrowed by whatever was typed. Number, customer and the parts on it all count. */
export function searchBills<T extends { id: string; customer: string; date: string; status: string }>(
  invoices: readonly T[],
  partsOn: (invoiceId: string) => string,
  query: string
): T[] {
  const wanted = query.trim().toLowerCase();
  return invoices
    .filter((invoice) => invoice.status !== CANCELLED)
    .filter((invoice) => !wanted
      || invoice.id.toLowerCase().includes(wanted)
      || invoice.customer.toLowerCase().includes(wanted)
      || partsOn(invoice.id).toLowerCase().includes(wanted))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id, undefined, { numeric: true }));
}
