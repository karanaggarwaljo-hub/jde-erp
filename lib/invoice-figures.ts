/**
 * The figures printed at the foot of a sales invoice, worked out in one place.
 *
 * The printed invoice page and the saved PDF both read these, so the two can never disagree about
 * what a customer was charged. Every figure is exact arithmetic on numbers the invoice stored —
 * see the notes on GST below — never an estimate.
 */

import { invoiceBalanceDue, invoiceWrittenOff, type BalanceableInvoice } from './invoice-balance';

export type FigureInvoice = BalanceableInvoice & {
  discount_percent?: number | string | null;
  discount_amount?: number | string | null;
  gst_percent?: number | string | null;
  gst_amount?: number | string | null;
  gst_mode?: string | null;
};

export type FigureItem = {
  line_total: number | string | null;
  discount_percent?: number | string | null;
  discount_amount?: number | string | null;
};

/** A credit note against the invoice (jde_sales_returns): what the returned lines were worth. */
export type FigureReturn = { id: string; subtotal: number | string | null };

export type InvoiceFigures = {
  /** The lines added up, after any discount on each line — as sold, before any return. */
  subtotal: number;
  /** What the goods returned against the invoice were worth, at the line amounts they were sold
   *  for. A return lowers the invoice's discount, GST and total but leaves its lines as sold, so
   *  without this the lines would not add up to the total. */
  returnedValue: number;
  /** The credit notes behind returnedValue, oldest first. */
  returnIds: string[];
  /** subtotal less returnedValue: what the discount and GST now apply to. */
  keptSubtotal: number;
  anyLineDiscount: boolean;
  lineDiscountTotal: number;
  /** The discount on the whole bill. */
  discountAmount: number;
  gstInclusive: boolean;
  gstAmount: number;
  /** What the GST was charged on. */
  netTaxableValue: number;
  writtenOff: number;
  balanceDue: number;
};

const num = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function invoiceFigures(invoice: FigureInvoice, items: FigureItem[], returns: FigureReturn[] = []): InvoiceFigures {
  const subtotal = items.reduce((sum, item) => sum + num(item.line_total), 0);
  // With no lines there is nothing for a return to be taken off; the total already says it all.
  const counted = items.length > 0 ? returns.filter((back) => num(back.subtotal) > 0) : [];
  const returnedValue = Math.round(counted.reduce((sum, back) => sum + num(back.subtotal), 0) * 100) / 100;
  const keptSubtotal = subtotal - returnedValue;
  const anyLineDiscount = items.some((item) => num(item.discount_percent) > 0);
  const lineDiscountTotal = items.reduce((sum, item) => sum + num(item.discount_amount), 0);
  const discountAmount = num(invoice.discount_amount);
  const gstInclusive = invoice.gst_mode === 'inclusive';
  // Prefer the tax the sale recorded. Reconstructing it as total − (subtotal − discount) is only
  // right for GST-exclusive pricing, where total = taxable + tax; on an inclusive invoice the tax
  // is inside the total and that subtraction gives zero. Every invoice from before the stored
  // split was priced exclusive, so the fallback stays right for those.
  const gstAmount = invoice.gst_amount == null
    ? (items.length > 0 ? num(invoice.total) - (keptSubtotal - discountAmount) : 0)
    : num(invoice.gst_amount);
  // Priced exclusive, tax was charged on the discounted amount; priced inclusive, on that amount
  // with the tax taken back out.
  const netTaxableValue = (keptSubtotal - discountAmount) - (gstInclusive ? gstAmount : 0);

  return {
    subtotal,
    returnedValue,
    returnIds: counted.map((back) => back.id),
    keptSubtotal,
    anyLineDiscount,
    lineDiscountTotal,
    discountAmount,
    gstInclusive,
    gstAmount,
    netTaxableValue,
    writtenOff: invoiceWrittenOff(invoice),
    balanceDue: invoiceBalanceDue(invoice),
  };
}
