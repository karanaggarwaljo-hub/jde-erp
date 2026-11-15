/**
 * Changing the price and stock of many parts in one go.
 *
 * The owner's prices move all the time, and the only way to change one was to open that part's
 * form, find the price among fourteen boxes, save, and do it again for the next part. The
 * "Change prices & stock" screen is one list with three boxes per part — stock, cost, sale price —
 * and one Save for everything typed.
 *
 * This file is what that screen decides with: which typed values are real changes, which cannot be
 * saved and why, what a "raise everything by 5%" works out to, and the exact steps a changed part
 * is saved by. Pure on purpose, like lib/cost-import.ts: it decides what happens to real prices
 * and real stock, so it has to be testable without a browser. Nothing here touches the database.
 */

import { round2 } from './money';

export type QuickPart = {
  id: string;
  part_number: string;
  name: string;
  brand?: string | null;
  category?: string | null;
  cost_price: number | string;
  sale_price: number | string;
  current_stock: number | string;
};

/** What has been typed into one part's boxes. A box nobody touched is simply absent. Strings,
 *  because that is what an input holds; they are read as numbers once, here. */
export type RowDraft = { stock?: string; cost?: string; sale?: string };
export type Drafts = Record<string, RowDraft>;
export type QuickField = keyof RowDraft;

const numberOf = (value: number | string | null | undefined): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Reads a typed amount: "1250", "1,250.50", "₹ 1250". Null for anything that is not a plain
 * number of zero or more — "call", "12-", "-5" — so a slip of the hand is never saved as a price.
 * A blank box is also null: on this screen blank means "I did not change this", never zero.
 */
export function readAmount(text: string | undefined): number | null {
  const cleaned = String(text ?? '').replace(/[₹,\s]/g, '');
  if (!cleaned || !/^\d*\.?\d+$|^\d+\.$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** True when the box holds nothing: the part keeps the value it has. */
export const isBlank = (text: string | undefined): boolean => String(text ?? '').trim() === '';

export type FieldChange = { from: number; to: number };

export type RowChange = {
  part: QuickPart;
  stock?: FieldChange;
  cost?: FieldChange;
  sale?: FieldChange;
};

export type RowProblem = { partId: string; field: QuickField; message: string };

export type QuickPlan = {
  /** Parts with at least one real change, in the order the parts were given. */
  changes: RowChange[];
  /** Boxes holding something that cannot be saved. While there are any, nothing is saved. */
  problems: RowProblem[];
  /** How many of each kind of change, for the sentence beside the Save button. */
  counts: { parts: number; stock: number; cost: number; sale: number };
};

const CURRENT: Record<QuickField, (part: QuickPart) => number> = {
  stock: (part) => numberOf(part.current_stock),
  cost: (part) => numberOf(part.cost_price),
  sale: (part) => numberOf(part.sale_price),
};

const PROBLEM: Record<QuickField, string> = {
  stock: 'Type how many you have, as a number (0 or more).',
  cost: 'Type the cost as a number.',
  sale: 'Type the sale price as a number.',
};

/**
 * Works out what the typed boxes would change.
 *
 * A value typed back to what the part already has is not a change, so retyping a price and then
 * putting it back leaves nothing to save. Prices are compared to the paisa.
 */
export function planQuickUpdate(parts: readonly QuickPart[], drafts: Drafts): QuickPlan {
  const changes: RowChange[] = [];
  const problems: RowProblem[] = [];
  const counts = { parts: 0, stock: 0, cost: 0, sale: 0 };

  for (const part of parts) {
    const draft = drafts[part.id];
    if (!draft) continue;
    const change: RowChange = { part };
    for (const field of ['stock', 'cost', 'sale'] as const) {
      const typed = draft[field];
      if (typed === undefined || isBlank(typed)) continue;
      const value = readAmount(typed);
      if (value === null) {
        problems.push({ partId: part.id, field, message: PROBLEM[field] });
        continue;
      }
      const to = field === 'stock' ? value : round2(value);
      const from = CURRENT[field](part);
      if (to === (field === 'stock' ? from : round2(from))) continue;
      change[field] = { from, to };
      counts[field] += 1;
    }
    if (change.stock || change.cost || change.sale) {
      changes.push(change);
      counts.parts += 1;
    }
  }
  return { changes, problems, counts };
}

/** The number a part's box shows and its margin is worked out from: what is typed if that reads as
 *  a number, otherwise what the part has now. */
export function effectiveValue(part: QuickPart, draft: RowDraft | undefined, field: QuickField): number {
  const typed = draft?.[field];
  if (typed !== undefined && !isBlank(typed)) {
    const value = readAmount(typed);
    if (value !== null) return value;
  }
  return CURRENT[field](part);
}

/** Parts being sold for no more than they cost. Only where both figures are known. */
export function sellsAtOrBelowCost(part: QuickPart, draft?: RowDraft): boolean {
  const cost = effectiveValue(part, draft, 'cost');
  const sale = effectiveValue(part, draft, 'sale');
  return cost > 0 && sale > 0 && sale <= cost;
}

/** Parts with no sale price yet: a bill for one comes to ₹0 until a rate is typed on it. */
export function hasNoSalePrice(part: QuickPart, draft?: RowDraft): boolean {
  return !(effectiveValue(part, draft, 'sale') > 0);
}

/* ---------------------------------------------------------------------------------------------
 * Changing many sale prices at once
 * ------------------------------------------------------------------------------------------- */

export type BulkRule =
  /** Raise (a positive percent) or lower (a negative one) each sale price by that much. */
  | { kind: 'percent'; percent: number }
  /** Price each part from its cost so the margin comes to this. Margin is on the sale price, the
   *  same way lib/margin.ts and the Margin column work it out: cost ₹800 at 20% is ₹1,000. */
  | { kind: 'margin'; percent: number };

/** Round a worked-out price to the nearest ₹1, ₹5 or ₹10; 0 keeps the paise. */
export type Rounding = 0 | 1 | 5 | 10;

export function roundPrice(value: number, rounding: Rounding): number {
  if (rounding === 0) return round2(value);
  return Math.round((value + Number.EPSILON) / rounding) * rounding;
}

/** The sale price a rule gives one part, or null when the rule has nothing to work from: a
 *  percentage of no price, or a margin on no cost. Those parts are left exactly as they are. */
export function bulkPriceFor(part: QuickPart, draft: RowDraft | undefined, rule: BulkRule, rounding: Rounding): number | null {
  if (!Number.isFinite(rule.percent)) return null;
  if (rule.kind === 'percent') {
    const sale = effectiveValue(part, draft, 'sale');
    if (!(sale > 0) || rule.percent <= -100) return null;
    return roundPrice(sale * (1 + rule.percent / 100), rounding);
  }
  const cost = effectiveValue(part, draft, 'cost');
  if (!(cost > 0) || rule.percent < 0 || rule.percent >= 100) return null;
  return roundPrice(cost / (1 - rule.percent / 100), rounding);
}

export type BulkResult = {
  drafts: Drafts;
  /** Parts given a new sale price. */
  filled: number;
  /** Parts the rule could not price (no sale price to move, or no cost to price from). */
  skipped: number;
};

/**
 * Fills in the sale-price box of every part given, by one rule. Nothing is saved: the boxes are
 * only filled, exactly as if each had been typed, so every new price can be looked at, changed or
 * undone before Save is pressed.
 */
export function fillSalePrices(parts: readonly QuickPart[], drafts: Drafts, rule: BulkRule, rounding: Rounding): BulkResult {
  const next: Drafts = { ...drafts };
  let filled = 0;
  let skipped = 0;
  for (const part of parts) {
    const price = bulkPriceFor(part, drafts[part.id], rule, rounding);
    if (price === null) {
      skipped += 1;
      continue;
    }
    next[part.id] = { ...next[part.id], sale: String(price) };
    filled += 1;
  }
  return { drafts: next, filled, skipped };
}

/* ---------------------------------------------------------------------------------------------
 * Saving one changed part
 * ------------------------------------------------------------------------------------------- */

export type SaveSteps = {
  partId: string;
  /** The part's own price fields, sent as one edit. Absent when only the stock changed. */
  patch?: { cost_price?: number; sale_price?: number; mrp?: number };
  /** A new stock count. The database works out the difference against the stock as it is at that
   *  moment, and anything added comes in at `unitCost`. */
  setStock?: { target: number; unitCost: number };
  /** The cost changed and the stock did not: the batch the Stock list reads its cost from is
   *  corrected too, so the cost and margin shown there follow. */
  correctCost?: number;
};

/**
 * The steps that save one part, the same ones and in the same order as the part's own Edit form
 * (app/(dashboard)/inventory/page.tsx handleSave): the price fields first, then either the stock
 * count or the cost correction, never both. One part saved here is exactly one part edited there.
 */
export function saveStepsFor(change: RowChange): SaveSteps {
  const steps: SaveSteps = { partId: change.part.id };
  const patch: NonNullable<SaveSteps['patch']> = {};
  if (change.cost) patch.cost_price = change.cost.to;
  if (change.sale) patch.sale_price = change.sale.to;
  if (Object.keys(patch).length > 0) steps.patch = patch;

  const cost = change.cost ? change.cost.to : numberOf(change.part.cost_price);
  if (change.stock) steps.setStock = { target: change.stock.to, unitCost: cost };
  else if (change.cost) steps.correctCost = cost;
  return steps;
}

/** "3 parts: 2 prices, 1 cost, 1 stock count" — what Save is about to do, in a few words. */
export function describeCounts(counts: QuickPlan['counts']): string {
  if (counts.parts === 0) return 'Nothing changed yet';
  const bits = [
    counts.sale > 0 ? `${counts.sale} sale ${counts.sale === 1 ? 'price' : 'prices'}` : '',
    counts.cost > 0 ? `${counts.cost} ${counts.cost === 1 ? 'cost' : 'costs'}` : '',
    counts.stock > 0 ? `${counts.stock} stock ${counts.stock === 1 ? 'count' : 'counts'}` : '',
  ].filter(Boolean);
  return `${counts.parts} ${counts.parts === 1 ? 'part' : 'parts'} changed: ${bits.join(', ')}`;
}
