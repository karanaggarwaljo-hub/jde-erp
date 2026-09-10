/**
 * The rules behind keying a supplier's invoice, kept out of the form so they can be tested.
 *
 * Buying is not selling with the sign flipped. The three things worth saying while a purchase is
 * typed are different from the three worth saying while a sale is:
 *
 *   - what you last paid THIS supplier for THIS part, because a supplier quietly raising a rate
 *     is invisible otherwise, and because a mistyped extra zero looks exactly like one
 *   - whether the cost you have typed is at or above what you sell the part for, which is the
 *     one mistake at this desk that loses money on every unit for as long as the stock lasts
 *   - a line with no cost, which is worse than it looks: it opens a FIFO batch valued at zero,
 *     so every sale drawn from it later reports the entire sale value as profit
 *
 * As on the sales side, nothing here blocks a save. Buying above your current selling price is a
 * real thing to do when a part is scarce or the sale price is stale. Being told is the point.
 */

import { buildLastTradedIndex, partLabel, type LastTraded } from '@/lib/trade-history';
import type { PartOption, POLine } from '@/lib/purchase-types';

export { partLabel };

export type AddPartResult = {
  lines: POLine[];
  /** Index of the line the part landed on, so the form can pick it out. */
  index: number;
  /** True when an existing line's quantity went up instead of a new line being added. */
  merged: boolean;
};

/**
 * Puts a part on the purchase, raising the quantity if it is already there.
 *
 * A supplier's invoice lists a part once with a quantity, so keying it should produce one line
 * with a quantity — not one row per scan, which then has to be reconciled by hand against the
 * document it was copied from.
 */
export function addPartToPurchaseLines(lines: POLine[], part: PartOption, quantity = 1): AddPartResult {
  const existing = lines.findIndex((line) => line.description === part.value);
  if (existing >= 0) {
    const next = lines.map((line, index) =>
      index === existing ? { ...line, quantity: Number(line.quantity) + quantity } : line
    );
    return { lines: next, index: existing, merged: true };
  }
  // Seeded with the cost already on file, which is the likeliest figure and the one worth
  // correcting against — not zero, which would make every line look like a price change.
  return {
    lines: [...lines, { description: part.value, quantity, unit_price: part.price }],
    index: lines.length,
    merged: false,
  };
}

/** A line for something not in the catalogue yet. The save path already creates the part from the
 *  description, which is how a genuinely new part first enters Inventory. */
export function addNewPartLine(lines: POLine[], description: string): AddPartResult {
  return { lines: [...lines, { description, quantity: 1, unit_price: 0 }], index: lines.length, merged: false };
}

export type PurchaseDocument = { id: string; supplier: string; date: string; status: string };
export type PurchaseItem = {
  po_id: string;
  part_number: string;
  name: string;
  unit_cost: number | string;
};

/** Kept as a name the purchase screens read well with; the shape is the shared one. */
export type LastPaid = LastTraded;

/** What this supplier last charged for each part, keyed by the same label a line carries. */
export function buildLastPaidIndex(
  supplierName: string,
  orders: PurchaseDocument[],
  items: PurchaseItem[],
  draftStatus = 'draft'
): Map<string, LastPaid> {
  return buildLastTradedIndex(
    supplierName,
    orders.map((order) => ({
      id: order.id,
      counterparty: order.supplier,
      date: order.date,
      status: order.status,
    })),
    items.map((item) => ({
      documentId: item.po_id,
      partNumber: item.part_number,
      name: item.name,
      rate: Number(item.unit_cost),
    })),
    draftStatus
  );
}

/** How far a rate may move from what this supplier last charged before it is worth mentioning.
 *  Set where a real price revision usually lands below it and a mistyped digit always lands above:
 *  a stray zero is +900%, and dropping one is -90%. */
export const COST_CHANGE_THRESHOLD_PERCENT = 20;

export type PurchaseWarning = { kind: 'no-cost' | 'above-sale-price' | 'cost-change'; message: string };

/**
 * What is worth saying about a purchase line as it is typed. Ordered most serious first, and
 * empty for an ordinary line so a routine purchase stays quiet.
 *
 * `part` is undefined for a part that is not in the catalogue yet: there is no sale price and no
 * history to compare against, so only the missing-cost check applies.
 */
export function purchaseLineWarnings(
  line: POLine,
  part: PartOption | undefined,
  lastPaid?: LastPaid
): PurchaseWarning[] {
  const warnings: PurchaseWarning[] = [];
  const cost = Number(line.unit_price) || 0;

  if (cost <= 0) {
    warnings.push({
      kind: 'no-cost',
      message: 'No cost entered — this stock would be valued at nothing, and every sale from it would report the full sale value as profit',
    });
    // Everything below compares against this cost, so there is nothing further worth saying.
    return warnings;
  }

  if (part && part.salePrice > 0 && cost >= part.salePrice) {
    warnings.push({
      kind: 'above-sale-price',
      message: cost === part.salePrice
        ? `You sell this at ₹${part.salePrice.toLocaleString('en-IN')} — buying at the same rate earns nothing`
        : `You sell this at ₹${part.salePrice.toLocaleString('en-IN')} — buying at ₹${cost.toLocaleString('en-IN')} loses money on every one`,
    });
  }

  if (lastPaid && lastPaid.rate > 0) {
    const changePercent = ((cost - lastPaid.rate) / lastPaid.rate) * 100;
    if (Math.abs(changePercent) >= COST_CHANGE_THRESHOLD_PERCENT) {
      const direction = changePercent > 0 ? 'more' : 'less';
      warnings.push({
        kind: 'cost-change',
        message: `${Math.abs(Math.round(changePercent))}% ${direction} than the ₹${lastPaid.rate.toLocaleString('en-IN')} you paid on ${lastPaid.ref}`,
      });
    }
  }

  return warnings;
}
