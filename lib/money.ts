/**
 * How rupee figures are formatted, in one place.
 *
 * These three were previously redeclared in five page files — identical each time, which is the
 * kind of duplication that stays harmless right up until one copy is "improved" and two screens
 * start disagreeing about what the same number looks like. Indian digit grouping (1,23,456) is
 * what `en-IN` gives, and it is deliberate: this is the grouping every customer-facing document
 * this business prints has to use.
 */

/** Up to two decimals, and none shown when the value is whole. The general-purpose one. */
export const money = (value: number): string =>
  Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** Always exactly two decimals — for totals on an invoice, where "₹1,200" beside "₹1,200.50"
 *  reads as a formatting slip rather than a real difference in precision. */
export const paise = (value: number): string =>
  Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Rounded to whole rupees — for headline figures and KPI tiles, where the paise are noise. */
export const wholeMoney = (value: number): string =>
  Math.round(Number(value || 0)).toLocaleString('en-IN');
