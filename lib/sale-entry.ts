/**
 * The rules behind entering a sale at the counter, kept out of the form so they can be tested.
 *
 * Three things a trading ERP is expected to do while a sale is being typed, none of which the
 * form did before:
 *
 *   - scanning the same part twice means quantity two, not two identical rows
 *   - the rate this customer paid last time is on screen while the rate is being set, because
 *     "what did I charge him last time" is the question actually being asked at the counter
 *   - selling below cost, or more than is on the shelf, is said out loud before the invoice is
 *     saved rather than discovered in a report a month later
 *
 * Every warning here describes something real and recorded. None of them blocks a save: a trader
 * legitimately sells at a loss to clear stock and legitimately sells what they will order in
 * tomorrow. Being told is the point; being stopped is not.
 */

import { buildLastTradedIndex, partLabel, type LastTraded } from '@/lib/trade-history';
import type { InvoiceLine, PartOption } from '@/lib/sales-types';

export { partLabel };

export type AddPartResult = {
  lines: InvoiceLine[];
  /** Index of the line the part landed on, so the form can focus or flash it. */
  index: number;
  /** True when an existing line's quantity went up instead of a new line being added. */
  merged: boolean;
};

/**
 * Puts a part on the invoice, raising the quantity if it is already there.
 *
 * The old form appended a row every time, so scanning three of the same part produced three rows
 * of one — which prints badly, and makes the quantity on the invoice disagree with how anyone
 * would write it by hand.
 */
export function addPartToLines(lines: InvoiceLine[], part: PartOption, qty = 1): AddPartResult {
  const existing = lines.findIndex((line) => line.part === part.value);
  if (existing >= 0) {
    const next = lines.map((line, index) =>
      index === existing ? { ...line, qty: Number(line.qty) + qty } : line
    );
    return { lines: next, index: existing, merged: true };
  }
  // The rate comes from the catalogue sale price, which is what the form has always defaulted to.
  const line: InvoiceLine = { part: part.value, qty, price: part.price, discount: 0 };
  return { lines: [...lines, line], index: lines.length, merged: false };
}

/** A one-off line for something not in the catalogue — kept because the save path has always
 *  supported it (product_id null, no stock movement), and losing it would remove a real
 *  capability rather than tidy one up. */
export function addCustomLine(lines: InvoiceLine[], description: string): AddPartResult {
  return { lines: [...lines, { part: description, qty: 1, price: 0, discount: 0 }], index: lines.length, merged: false };
}

export type SoldInvoice = { id: string; customer: string; date: string; status: string };
export type SoldItem = {
  invoice_id: string;
  part_number: string;
  name: string;
  qty: number | string;
  unit_price: number | string;
};

/** Kept as a name the sales screens read well with. The shape is the shared one — buying asks the
 *  same question of a supplier, so the rule for answering it lives in lib/trade-history.ts. */
export type LastSold = LastTraded;

/**
 * What this customer last actually paid for each part, keyed by the same label a line carries.
 *
 * Drafts are excluded: nothing was billed, so nothing was agreed. The most recent invoice wins,
 * and where two share a date the higher invoice id does — invoice numbers are sequential here, so
 * that is the later of the two rather than an arbitrary pick.
 */
export function buildLastSoldIndex(
  customerName: string,
  invoices: SoldInvoice[],
  items: SoldItem[],
  draftStatus = 'draft'
): Map<string, LastSold> {
  return buildLastTradedIndex(
    customerName,
    invoices.map((invoice) => ({
      id: invoice.id,
      counterparty: invoice.customer,
      date: invoice.date,
      status: invoice.status,
    })),
    items.map((item) => ({
      documentId: item.invoice_id,
      partNumber: item.part_number,
      name: item.name,
      rate: Number(item.unit_price),
    })),
    draftStatus
  );
}

export type LineWarning = { kind: 'stock' | 'below-cost' | 'no-rate'; message: string };

/**
 * What is worth saying about a line as it is typed. Ordered most serious first, and empty for
 * an ordinary line so a normal sale stays quiet.
 *
 * `part` is undefined for a one-off line that is not in the catalogue: there is no stock and no
 * cost to compare against, so only the missing-rate check applies.
 */
export function lineWarnings(line: InvoiceLine, part: PartOption | undefined): LineWarning[] {
  const warnings: LineWarning[] = [];
  const qty = Number(line.qty) || 0;
  const rate = Number(line.price) || 0;

  if (part && qty > part.stock) {
    warnings.push({
      kind: 'stock',
      message: part.stock <= 0
        ? 'None on the shelf — this will show as negative stock until a purchase is recorded'
        : `Only ${part.stock} on the shelf, ${qty} being billed`,
    });
  }
  // Compared against the catalogue cost price, which is what the FIFO fallback uses when a part
  // was never purchased in, so this is the same number the profit figures will use.
  if (part && part.costPrice > 0 && rate > 0 && rate < part.costPrice) {
    warnings.push({ kind: 'below-cost', message: `Below cost of ₹${part.costPrice.toLocaleString('en-IN')}` });
  }
  if (rate <= 0) {
    warnings.push({ kind: 'no-rate', message: 'No rate set — this line bills nothing' });
  }
  return warnings;
}
