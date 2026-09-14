/**
 * What merging two entries of the same part will produce, shown to the owner before they confirm.
 *
 * The merge itself is jde_merge_products (scripts/merge-duplicate-parts.sql). These are the same
 * rules, so the dialog never promises something the database then does differently — change one
 * and the other must change with it.
 */

import { looksLikeAnInventedCode } from './detail-import';

export type MergeablePart = {
  id: string;
  part_number: string;
  oem_number: string;
  hsn_code: string;
  name: string;
  brand: string;
  category: string;
  compatibility: string;
  location: string;
  cost_price: number | string;
  mrp: number | string;
  sale_price: number | string;
  current_stock: number | string;
  min_stock: number | string;
};

/** A detail the kept part is blank on, and takes from the duplicate. */
export type MergeFill = { field: keyof MergeablePart; label: string; value: string; money?: boolean };

export type MergePlan = {
  /** The two counts added together: 20 on the shelf and −5 sold-but-never-bought is 15. */
  stockAfter: number;
  /** The distinct part numbers the merged part could carry. Fewer than two means no choice. */
  numberChoices: string[];
  /** A real manufacturer's number over a code the ERP made up; otherwise the kept part's own. */
  defaultNumber: string;
  fills: MergeFill[];
};

const TEXT_FIELDS = [
  ['oem_number', 'OEM number'],
  ['hsn_code', 'HSN code'],
  ['brand', 'brand'],
  ['category', 'category'],
  ['compatibility', 'compatibility'],
  ['location', 'location'],
] as const;

const NUMBER_FIELDS = [
  ['cost_price', 'cost price', true],
  ['mrp', 'MRP', true],
  ['sale_price', 'sale price', true],
  ['min_stock', 'reorder level', false],
] as const;

const clean = (value: unknown) => String(value ?? '').trim();
const amount = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export function planPartMerge(keep: MergeablePart, remove: MergeablePart): MergePlan {
  const keepNumber = clean(keep.part_number);
  const removeNumber = clean(remove.part_number);

  const numberChoices: string[] = [];
  for (const number of [keepNumber, removeNumber]) {
    if (number && !numberChoices.some((choice) => choice.toLowerCase() === number.toLowerCase())) numberChoices.push(number);
  }

  const isReal = (number: string) => number !== '' && !looksLikeAnInventedCode(number);
  const defaultNumber = isReal(keepNumber) || !removeNumber
    ? keepNumber
    : isReal(removeNumber)
      ? removeNumber
      : keepNumber || removeNumber;

  // The kept part's own details always win; the duplicate only fills what is blank. The name is
  // deliberately absent: the part being kept keeps its name.
  const fills: MergeFill[] = [];
  for (const [field, label] of TEXT_FIELDS) {
    if (!clean(keep[field]) && clean(remove[field])) fills.push({ field, label, value: clean(remove[field]) });
  }
  for (const [field, label, isMoney] of NUMBER_FIELDS) {
    if (!(amount(keep[field]) > 0) && amount(remove[field]) > 0) {
      fills.push({ field, label, value: String(amount(remove[field])), money: isMoney });
    }
  }

  return {
    stockAfter: amount(keep.current_stock) + amount(remove.current_stock),
    numberChoices,
    defaultNumber,
    fills,
  };
}
