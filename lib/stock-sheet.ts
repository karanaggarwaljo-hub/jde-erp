/**
 * Uploading a stock and price list: one file, read once, that updates the stock, cost, sale price
 * and MRP of the parts already here and adds the ones that are not.
 *
 * Before this the importer made the owner choose between three jobs, and none of them was the one
 * he came for. "Update cost prices" changed the cost and nothing else; "Add as new parts" skipped
 * every part already stocked; so a fresh list of stock and prices could not be uploaded at all.
 * With prices moving every week, that left retyping them one part at a time.
 *
 * This decides what such a file would do, row by row, before anything is written:
 *
 *   update   the row is a part already here and at least one figure differs
 *   same     the row is a part already here and nothing differs
 *   new      nothing here answers to it, so it becomes a new part
 *   unclear  it cannot be told which part is meant; left alone, with the reason
 *
 * Pure, like lib/cost-import.ts, and for the same reason: it decides a bulk overwrite of real
 * prices and real stock counts, so it must be inspectable in a preview and testable on its own.
 *
 * Two rules matter more than the rest. A figure is only ever taken from a cell that actually held
 * one (ImportedProduct.given): an empty cell never sets a price or a stock count to zero. And a
 * row is never matched by guessing: two candidates is "unclear", not "the first one".
 */

import type { ImportedProduct } from './client-import';
import { codeKey, nameKey, partFinder, type CostMatchProduct } from './cost-import';
import { brandKey, brandLabel } from './part-numbers';
import { round2 } from './money';
import type { SaveSteps } from './quick-prices';

export type SheetField = 'stock' | 'cost' | 'sale' | 'mrp';

export const SHEET_FIELDS: ReadonlyArray<{ field: SheetField; label: string }> = [
  { field: 'stock', label: 'Stock' },
  { field: 'cost', label: 'Cost' },
  { field: 'sale', label: 'Sale price' },
  { field: 'mrp', label: 'MRP' },
];

export type SheetProduct = CostMatchProduct & {
  sale_price: number | string;
  mrp?: number | string | null;
  current_stock: number | string;
};

export type SheetChange = { field: SheetField; from: number; to: number };

export type SheetOutcome = 'update' | 'same' | 'new' | 'unclear';

export type SheetRowPlan = {
  /** Position among the rows read, counting from 1. */
  rowNumber: number;
  row: ImportedProduct;
  outcome: SheetOutcome;
  product?: SheetProduct;
  matchedBy?: 'part number' | 'OEM number' | 'other number' | 'name';
  /** What would change on the part. Empty unless the outcome is `update`. */
  changes: SheetChange[];
  /** Plain words for a row that changes nothing or is left alone. */
  reason?: string;
};

const numberOf = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const FROM_ROW: Record<SheetField, (row: ImportedProduct) => number> = {
  stock: (row) => numberOf(row.current_stock),
  cost: (row) => round2(numberOf(row.cost_price)),
  sale: (row) => round2(numberOf(row.sale_price)),
  mrp: (row) => round2(numberOf(row.mrp)),
};

const FROM_PART: Record<SheetField, (part: SheetProduct) => number> = {
  stock: (part) => numberOf(part.current_stock),
  cost: (part) => round2(numberOf(part.cost_price)),
  sale: (part) => round2(numberOf(part.sale_price)),
  mrp: (part) => round2(numberOf(part.mrp)),
};

/** The figures at least one row of the file actually carries, in display order. A file with no
 *  MRP column is never offered an MRP tick box. */
export function fieldsInSheet(rows: readonly ImportedProduct[]): SheetField[] {
  return SHEET_FIELDS.map((entry) => entry.field).filter((field) => rows.some((row) => row.given?.[field]));
}

const partTitle = (part: SheetProduct): string =>
  `${part.name}${brandKey(part.brand) ? ` (${brandLabel(part.brand)})` : ''}`;

/**
 * Works out what each row of the file would do.
 *
 * `fields` is which figures the owner wants taken from this file. A supplier's price list often
 * has a quantity column that is a pack size, not his stock; unticking Stock for the whole file
 * leaves every stock count alone while the prices still update.
 */
export function planSheetUpdate(
  rows: readonly ImportedProduct[],
  products: readonly SheetProduct[],
  fields: ReadonlySet<SheetField>
): SheetRowPlan[] {
  const find = partFinder([...products]);
  const takenCodes = new Set(products.flatMap((part) => [part.part_number, ...(part.other_numbers ?? [])]).map((code) => codeKey(code ?? '')).filter(Boolean));

  const plans: SheetRowPlan[] = rows.map((row, index) => {
    const rowNumber = index + 1;
    const base = { rowNumber, row, changes: [] as SheetChange[] };
    const rowBrand = brandKey(row.brand);

    let lookup = find({ partNumber: row.part_number, oemNumber: row.oem_number, name: row.name });
    // The parts worksheet carries the code a part has in the ERP right now in its own column; a
    // row whose part number was corrected on that sheet is still found by it.
    if (lookup.found === 'none' && row.current_code) {
      lookup = find({ partNumber: row.current_code, oemNumber: '', name: '' });
    }

    // One number or name kept in several brands: the brand on the row says which.
    if (lookup.found === 'many') {
      const sameBrand = rowBrand ? lookup.products.filter((part) => brandKey(part.brand) === rowBrand) : [];
      if (sameBrand.length === 1) {
        lookup = { found: 'one', product: sameBrand[0], matchedBy: lookup.matchedBy };
      } else {
        const brands = Array.from(new Set(lookup.products.map((part) => brandLabel(part.brand)))).join(', ');
        return {
          ...base,
          outcome: 'unclear',
          matchedBy: lookup.matchedBy,
          reason: rowBrand
            ? `${lookup.products.length} parts share this ${lookup.matchedBy} and none is ${brandLabel(row.brand)} alone (${brands})`
            : `${lookup.products.length} parts share this ${lookup.matchedBy} (${brands}). Add a Brand column to say which`,
        };
      }
    }

    if (lookup.found === 'one') {
      const product = lookup.product;
      const partBrand = brandKey(product.brand);
      // The row names a brand and the part on file is another one. By name alone that is simply a
      // different item; by number it is another brand of the same part, which is added from that
      // part's own menu, where its name, numbers and fitment are copied.
      if (rowBrand && partBrand && rowBrand !== partBrand) {
        if (lookup.matchedBy === 'name' && !takenCodes.has(codeKey(row.part_number))) {
          return { ...base, outcome: 'new' };
        }
        return {
          ...base,
          outcome: 'unclear',
          product,
          matchedBy: lookup.matchedBy,
          reason: `You keep this as ${partTitle(product)}. To stock it in ${brandLabel(row.brand)} too, use "Add another brand" on that part`,
        };
      }

      const changes: SheetChange[] = [];
      let givenAny = false;
      for (const { field } of SHEET_FIELDS) {
        if (!row.given?.[field]) continue;
        givenAny = true;
        if (!fields.has(field)) continue;
        const to = FROM_ROW[field](row);
        const from = FROM_PART[field](product);
        if (to !== from) changes.push({ field, from, to });
      }
      return changes.length > 0
        ? { ...base, outcome: 'update', product, matchedBy: lookup.matchedBy, changes }
        : { ...base, outcome: 'same', product, matchedBy: lookup.matchedBy, reason: givenAny ? 'already the same' : 'no stock or price on this row' };
    }

    return { ...base, outcome: 'new' };
  });

  // Two rows about one part. The same figures twice is harmless: apply once. Different figures is
  // a mistake in the file, and neither row is allowed to win quietly.
  const byProduct = new Map<string, SheetRowPlan[]>();
  for (const plan of plans) {
    if (!plan.product || (plan.outcome !== 'update' && plan.outcome !== 'same')) continue;
    byProduct.set(plan.product.id, [...(byProduct.get(plan.product.id) ?? []), plan]);
  }
  for (const group of byProduct.values()) {
    if (group.length < 2) continue;
    const figures = (plan: SheetRowPlan) => SHEET_FIELDS
      .map(({ field }) => (plan.row.given?.[field] && fields.has(field) ? FROM_ROW[field](plan.row) : 'x'))
      .join('|');
    if (new Set(group.map(figures)).size > 1) {
      const rowNumbers = group.map((plan) => plan.rowNumber).join(', ');
      for (const plan of group) {
        plan.outcome = 'unclear';
        plan.changes = [];
        plan.reason = `rows ${rowNumbers} give different figures for this part`;
      }
    } else {
      for (const plan of group.slice(1)) {
        plan.outcome = 'same';
        plan.changes = [];
        plan.reason = `same part as row ${group[0].rowNumber}`;
      }
    }
  }

  // Two new rows with one part number: adding both would be refused as a whole by the database,
  // which lets a number name only one new part at a time.
  const firstNewByCode = new Map<string, number>();
  const firstNewByName = new Map<string, number>();
  for (const plan of plans) {
    if (plan.outcome !== 'new') continue;
    const code = codeKey(plan.row.part_number);
    if (code && takenCodes.has(code)) {
      plan.outcome = 'unclear';
      plan.reason = 'a part you already have uses this part number';
      continue;
    }
    const key = code || `${nameKey(plan.row.name)}|${brandKey(plan.row.brand)}`;
    const seen = code ? firstNewByCode : firstNewByName;
    const first = seen.get(key);
    if (first !== undefined) {
      plan.outcome = 'unclear';
      plan.reason = `same ${code ? 'part number' : 'part'} as row ${first} of this file`;
    } else {
      seen.set(key, plan.rowNumber);
    }
  }

  return plans;
}

export type SheetCounts = Record<SheetOutcome, number>;

export function countSheetOutcomes(plans: readonly SheetRowPlan[]): SheetCounts {
  const counts: SheetCounts = { update: 0, same: 0, new: 0, unclear: 0 };
  for (const plan of plans) counts[plan.outcome] += 1;
  return counts;
}

/**
 * The steps that save one updated part: the same ones, in the same order, as that part's Edit form
 * and the "Change prices & stock" screen (lib/quick-prices.ts saveStepsFor). Prices first as one
 * edit, then either the new stock count or, when only the cost moved, the cost correction.
 */
export function sheetSaveSteps(plan: SheetRowPlan): SaveSteps | null {
  if (plan.outcome !== 'update' || !plan.product) return null;
  const change = (field: SheetField) => plan.changes.find((entry) => entry.field === field);
  const steps: SaveSteps = { partId: plan.product.id };
  const patch: NonNullable<SaveSteps['patch']> = {};
  const cost = change('cost');
  const sale = change('sale');
  const mrp = change('mrp');
  const stock = change('stock');
  if (cost) patch.cost_price = cost.to;
  if (sale) patch.sale_price = sale.to;
  if (mrp) patch.mrp = mrp.to;
  if (Object.keys(patch).length > 0) steps.patch = patch;
  const unitCost = cost ? cost.to : numberOf(plan.product.cost_price);
  if (stock) steps.setStock = { target: stock.to, unitCost };
  else if (cost) steps.correctCost = unitCost;
  return steps;
}

/** "Update 38 parts and add 5 new parts" — what the one button is about to do. */
export function describeSheetAction(updates: number, additions: number): string {
  const parts = (count: number) => `${count} ${count === 1 ? 'part' : 'parts'}`;
  if (updates > 0 && additions > 0) return `Update ${parts(updates)} and add ${additions} new`;
  if (updates > 0) return `Update ${parts(updates)}`;
  if (additions > 0) return `Add ${additions} new ${additions === 1 ? 'part' : 'parts'}`;
  return 'Nothing to save';
}

/* ---------------------------------------------------------------------------------------------
 * The list to start from
 *
 * The easiest file to upload is the one this app wrote: every part with its stock and prices, to
 * be changed in Excel and brought straight back. Its headings are the ones lib/client-import.ts
 * recognises without guessing, so nothing has to be chosen on the way back in.
 * ------------------------------------------------------------------------------------------- */

export type PriceListProduct = SheetProduct & { category?: string | null };

export const PRICE_LIST_COLUMNS = ['Part No', 'Name', 'Brand', 'Category', 'Stock', 'Cost Price', 'Sale Price', 'MRP'] as const;

const escapeCell = (value: string): string => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** Every part with its stock and prices, as a CSV that Excel, Google Sheets and a phone all open.
 *  The BOM is what makes Excel on Windows read it as UTF-8 (see lib/parts-worksheet.ts). */
export function priceListCsv(products: readonly PriceListProduct[]): string {
  const figure = (value: unknown) => String(round2(numberOf(value)));
  const rows = [...products]
    .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
    .map((part) => [
      String(part.part_number ?? ''),
      String(part.name ?? ''),
      String(part.brand ?? ''),
      String(part.category ?? ''),
      String(numberOf(part.current_stock)),
      figure(part.cost_price),
      figure(part.sale_price),
      figure(part.mrp),
    ].map(escapeCell).join(','));
  return '﻿' + [PRICE_LIST_COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
}

/** A filename that sorts by date and says which company it came from. */
export function priceListFileName(companyName: string, today: string): string {
  const safe = (companyName || 'company').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return `stock-and-prices-${safe || 'company'}-${today}.csv`;
}
