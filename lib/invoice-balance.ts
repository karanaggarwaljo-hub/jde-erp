/** What a sales invoice still has outstanding.
 *
 *  This used to be `total - paid` written out at every call site. That stopped being the whole
 *  story once a customer could settle an invoice by paying less than it was for: the shortfall is
 *  neither owed any more nor ever received, so it lives in its own column rather than being
 *  folded into either of the other two.
 *
 *  Keeping `paid` to mean "money that actually arrived" is the point — a write-off added to it
 *  would quietly turn forgiven debt into reported cash in every KPI, report and AI digest.
 */

export type BalanceableInvoice = {
  total: number | string | null | undefined;
  paid: number | string | null | undefined;
  /** Optional so rows loaded before this column existed, and test fixtures, still work. */
  settlement_write_off?: number | string | null;
};

/** Rupees below which a balance is treated as cleared — a rounding crumb, not a debt. */
const SETTLED_EPSILON = 0.01;

function num(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** How much of this invoice was forgiven rather than collected. */
export function invoiceWrittenOff(invoice: BalanceableInvoice): number {
  return Math.max(0, num(invoice.settlement_write_off));
}

/** Money actually received against this invoice. Never includes anything written off. */
export function invoicePaid(invoice: BalanceableInvoice): number {
  return num(invoice.paid);
}

/** What the customer still owes: never negative, so an over-payment on one invoice cannot
 *  silently cancel out a genuine debt on another when these are summed. */
export function invoiceBalanceDue(invoice: BalanceableInvoice): number {
  return Math.max(0, num(invoice.total) - num(invoice.paid) - invoiceWrittenOff(invoice));
}

/** True while there is still money to collect on this invoice. */
export function isInvoiceOpen(invoice: BalanceableInvoice): boolean {
  return invoiceBalanceDue(invoice) > SETTLED_EPSILON;
}

/** True when this invoice was closed for less than it was issued for. */
export function wasSettledShort(invoice: BalanceableInvoice): boolean {
  return invoiceWrittenOff(invoice) > SETTLED_EPSILON;
}
