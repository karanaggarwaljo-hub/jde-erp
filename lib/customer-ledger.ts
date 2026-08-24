/**
 * Merges one customer's invoices and payments into a single chronological timeline with a
 * running balance — the view that answers "this customer bought across three separate days on
 * credit, then paid the running total in one visit" in one place, instead of three invoices with
 * no record connecting them.
 *
 * Kept out of the Sales page as a pure, dependency-free function (like lib/import-matching.ts)
 * so it can be exercised directly by scripts/customer-ledger-check.ts — a wrong sort order or
 * sign here would show the owner an incorrect running balance without ever raising an error.
 *
 * Generic over the caller's own row shapes (constrained to the minimal fields this file actually
 * reads) rather than fixed types: the Sales page needs the *real* Invoice/Payment objects back
 * out of the ledger — to open the existing View Invoice modal or the existing delete-payment
 * confirmation — not a trimmed-down copy missing the fields those already expect.
 */

export type LedgerInvoice = { id: string; customer: string; date: string; total: number };
export type LedgerPayment = { id: string; customer: string; date: string; amount: number; created_at: string };
export type LedgerAllocation = { payment_id: string; invoice_id: string; amount: number };

export type LedgerEntry<Invoice extends LedgerInvoice, Payment extends LedgerPayment> =
  | { kind: 'invoice'; date: string; sortKey: string; invoice: Invoice }
  | { kind: 'payment'; date: string; sortKey: string; payment: Payment; appliedTo: { invoiceId: string; amount: number }[] };

export function buildCustomerLedger<Invoice extends LedgerInvoice, Payment extends LedgerPayment>(
  customerName: string,
  invoices: Invoice[],
  payments: Payment[],
  allocations: LedgerAllocation[]
): LedgerEntry<Invoice, Payment>[] {
  const invoiceEntries: LedgerEntry<Invoice, Payment>[] = invoices
    .filter((invoice) => invoice.customer === customerName)
    .map((invoice) => ({ kind: 'invoice', date: invoice.date, sortKey: `${invoice.date}T00:00 ${invoice.id}`, invoice }));

  const paymentEntries: LedgerEntry<Invoice, Payment>[] = payments
    .filter((payment) => payment.customer === customerName)
    .map((payment) => ({
      kind: 'payment',
      date: payment.date,
      // created_at breaks same-day ties in the order they actually happened — a plain date
      // string alone can't, since it carries no time. A payment with no usable timestamp sorts
      // last on its date rather than first, so it never looks like it happened before the
      // invoice it was actually applied to. Checked by length rather than a bare `?? fallback`:
      // created_at is `''` (falls past `??`, which only catches null/undefined) for a row with
      // no real timestamp, and slicing that would silently sort the payment first instead.
      sortKey: `${payment.date}T${payment.created_at && payment.created_at.length >= 19 ? payment.created_at.slice(11, 19) : '23:59:59'} ${payment.id}`,
      payment,
      appliedTo: allocations
        .filter((allocation) => allocation.payment_id === payment.id)
        .map((allocation) => ({ invoiceId: allocation.invoice_id, amount: Number(allocation.amount) })),
    }));

  return [...invoiceEntries, ...paymentEntries].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

/** Convenience for callers that just want the final running balance, not the full timeline —
 *  e.g. a check script confirming it agrees with the customer's own `balance` column. */
export function runningBalanceAfter<Invoice extends LedgerInvoice, Payment extends LedgerPayment>(
  entries: LedgerEntry<Invoice, Payment>[]
): number {
  return entries.reduce((balance, entry) => (
    entry.kind === 'invoice' ? balance + Number(entry.invoice.total) : balance - Number(entry.payment.amount)
  ), 0);
}
