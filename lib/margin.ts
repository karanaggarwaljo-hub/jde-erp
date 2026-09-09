/** What a part earns, in one place.
 *
 *  Inventory worked this out twice — once for the average across the shelf, once per row in the
 *  table — and the two did not agree on the awkward cases. The average deliberately skipped any
 *  part with no cost recorded, because averaging those in reports a 100% margin nobody earns; the
 *  per-row version had no such guard and printed exactly that 100% next to the part.
 *
 *  Margin here is on the selling price (what a shop calls margin), not on cost (mark-up). A part
 *  bought at ₹800 and sold at ₹1,000 shows 20%, not 25%.
 */

/** No margin can be worked out — the part has no selling price, or no cost was ever recorded.
 *  Deliberately distinct from a margin of zero, which is a real answer meaning "sold at cost". */
export const NO_MARGIN = null;

export function marginPercent(salePrice: number, cost: number): number | null {
  const sale = Number(salePrice);
  const paid = Number(cost);
  if (!Number.isFinite(sale) || sale <= 0) return NO_MARGIN;
  if (!Number.isFinite(paid) || paid <= 0) return NO_MARGIN;
  return ((sale - paid) / sale) * 100;
}

/** The average margin across the parts that have one, or null when none of them do.
 *  Parts without a usable cost or price are left out rather than counted as 100%. */
export function averageMarginPercent<T>(
  items: T[],
  salePriceOf: (item: T) => number,
  costOf: (item: T) => number
): number | null {
  const margins = items
    .map((item) => marginPercent(salePriceOf(item), costOf(item)))
    .filter((margin): margin is number => margin !== null);
  if (margins.length === 0) return NO_MARGIN;
  return margins.reduce((total, margin) => total + margin, 0) / margins.length;
}
