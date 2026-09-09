import { round2 } from './money';

/** The arithmetic of a bill, in one place — used for both an invoice and a quotation.
 *
 *  There were two copies of this in app/(dashboard)/sales/page.tsx, and they did not agree. The
 *  quotation copy rounded at every step, deliberately, because jde_save_quotation recomputes each
 *  figure from the lines and refuses the save if what the browser sent differs by more than a
 *  paisa. The invoice copy rounded nowhere, and jde_save_sales_invoice stores whatever total it is
 *  given — so nothing ever caught the drift. It is visible in the real data: invoice INV-1005 is
 *  stored as ₹5002.624, three decimal places of floating-point noise in a money column.
 *
 *  One implementation now, rounding per step, which is what the database does. The visible effect
 *  is that an invoice total becomes a real two-decimal amount instead of 5002.624. Figures already
 *  saved are not touched.
 *
 *  The order the two discounts stack in is not cosmetic: each line is discounted on its own first,
 *  and the bill-wide discount applies to what that leaves. Doing it the other way changes the tax
 *  base and therefore the tax.
 */

export type TotalsLine = {
  qty: number | string;
  price: number | string;
  /** Per-line discount as a percentage. Missing means none. */
  discount?: number | string;
};

export type TotalsInput = {
  lines: TotalsLine[];
  /** Discount applied to the whole bill, after the per-line ones. */
  discountPercent: number;
  gstPercent: number;
  /** True when the prices already contain the tax, so it is extracted rather than added. */
  gstInclusive: boolean;
};

export type Totals = {
  /** Before any discount. */
  grossSubtotal: number;
  /** What the per-line discounts came to. */
  itemDiscountTotal: number;
  /** After per-line discounts, before the bill-wide one. */
  subtotal: number;
  /** What the bill-wide discount came to. */
  discountAmount: number;
  /** After both discounts. Priced exclusive this is the taxable value; priced inclusive it is
   *  already the amount payable, with the tax inside it. */
  taxableAmount: number;
  gstAmount: number;
  /** What the tax is actually charged on — differs from taxableAmount only when inclusive. */
  netTaxableValue: number;
  total: number;
};

const num = (value: number | string | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** A per-line discount is a percentage, so anything outside 0–100 is a typo, not an instruction. */
export const lineDiscountPercent = (line: TotalsLine): number =>
  Math.min(100, Math.max(0, num(line.discount)));

export const lineGross = (line: TotalsLine): number => round2(num(line.qty) * num(line.price));

export const lineDiscountAmount = (line: TotalsLine): number =>
  round2(lineGross(line) * (lineDiscountPercent(line) / 100));

export const lineNet = (line: TotalsLine): number => lineGross(line) - lineDiscountAmount(line);

export function billTotals({ lines, discountPercent, gstPercent, gstInclusive }: TotalsInput): Totals {
  const rate = Math.max(0, num(gstPercent));
  const billDiscount = Math.min(100, Math.max(0, num(discountPercent)));

  const grossSubtotal = lines.reduce((sum, line) => sum + lineGross(line), 0);
  const subtotal = lines.reduce((sum, line) => sum + lineNet(line), 0);
  const itemDiscountTotal = round2(grossSubtotal - subtotal);
  const discountAmount = round2(subtotal * (billDiscount / 100));
  const taxableAmount = round2(subtotal - discountAmount);

  const gstAmount = round2(
    gstInclusive ? taxableAmount * (rate / (100 + rate)) : taxableAmount * (rate / 100)
  );
  const netTaxableValue = gstInclusive ? round2(taxableAmount - gstAmount) : taxableAmount;
  const total = gstInclusive ? taxableAmount : round2(taxableAmount + gstAmount);

  return {
    grossSubtotal: round2(grossSubtotal),
    itemDiscountTotal,
    subtotal: round2(subtotal),
    discountAmount,
    taxableAmount,
    gstAmount,
    netTaxableValue,
    total,
  };
}

/** How much of a bill has actually been received, given which of the three the owner chose.
 *  A part payment is clamped to the bill: you cannot receive more than the thing is worth. */
export function amountReceived(
  status: 'paid' | 'partial' | 'unpaid',
  total: number,
  typedAmount: number
): number {
  if (status === 'paid') return round2(total);
  if (status === 'partial') return round2(Math.min(Math.max(num(typedAmount), 0), total));
  return 0;
}
