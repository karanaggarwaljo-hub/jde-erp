/**
 * Exercises the customer-ledger timeline builder — the logic that merges invoices and payments
 * into one chronological list with a running balance. This is the piece that directly answers
 * the owner's own scenario: a customer buys across three separate days on credit, then pays the
 * running total in one visit on the fourth.
 *
 *   npx tsx scripts/customer-ledger-check.ts
 *
 * No API keys, no database, no login: buildCustomerLedger is pure.
 */
import { buildCustomerLedger, runningBalanceAfter, type LedgerAllocation, type LedgerInvoice, type LedgerPayment } from '../lib/customer-ledger';

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}\n      got:      ${JSON.stringify(actual)}\n      expected: ${JSON.stringify(expected)}`);
  }
}

// The owner's own scenario: three days of purchases, one payment on the fourth day covering two
// of the three invoices in full and part of the third.
const invoices: LedgerInvoice[] = [
  { id: 'INV-1001', customer: 'Sharma Motors', date: '2026-08-20', total: 1000 },
  { id: 'INV-1002', customer: 'Sharma Motors', date: '2026-08-21', total: 1500 },
  { id: 'INV-1003', customer: 'Sharma Motors', date: '2026-08-22', total: 800 },
  { id: 'INV-1004', customer: 'Someone Else', date: '2026-08-21', total: 9999 }, // must not leak into the ledger below
];
const payments: LedgerPayment[] = [
  { id: 'RCPT-1001', customer: 'Sharma Motors', date: '2026-08-23', amount: 2800, created_at: '2026-08-23T10:00:00Z' },
];
const allocations: LedgerAllocation[] = [
  { payment_id: 'RCPT-1001', invoice_id: 'INV-1001', amount: 1000 },
  { payment_id: 'RCPT-1001', invoice_id: 'INV-1002', amount: 1500 },
  { payment_id: 'RCPT-1001', invoice_id: 'INV-1003', amount: 300 },
];

const entries = buildCustomerLedger('Sharma Motors', invoices, payments, allocations);

check('every entry belongs to the right customer', entries.length, 4);
check('chronological order: three invoices then the payment', entries.map((e) => (e.kind === 'invoice' ? e.invoice.id : e.payment.id)), ['INV-1001', 'INV-1002', 'INV-1003', 'RCPT-1001']);
check('the payment records which invoices it covered', entries[3].kind === 'payment' ? entries[3].appliedTo.map((a) => a.invoiceId) : null, ['INV-1001', 'INV-1002', 'INV-1003']);
check('running balance after all four entries', runningBalanceAfter(entries), 1000 + 1500 + 800 - 2800);
check('a different customer\'s invoice never appears here', entries.some((e) => e.kind === 'invoice' && e.invoice.id === 'INV-1004'), false);

// Same-day tiebreak: two invoices on the same date must stay in a stable, id-ordered sequence
// (a date string alone carries no time to sort by).
const sameDayInvoices: LedgerInvoice[] = [
  { id: 'INV-2002', customer: 'Same Day Co', date: '2026-08-20', total: 100 },
  { id: 'INV-2001', customer: 'Same Day Co', date: '2026-08-20', total: 200 },
];
const sameDayEntries = buildCustomerLedger('Same Day Co', sameDayInvoices, [], []);
check('same-day invoices break ties by id', sameDayEntries.map((e) => (e.kind === 'invoice' ? e.invoice.id : '')), ['INV-2001', 'INV-2002']);

// A payment with no timestamp must not be able to sort itself before an invoice made on the
// same date — it should fall at the end of that day, never the start.
const untimedPayment: LedgerPayment = { id: 'RCPT-3001', customer: 'No Timestamp Co', date: '2026-08-20', amount: 50, created_at: '' };
const untimedInvoice: LedgerInvoice = { id: 'INV-3001', customer: 'No Timestamp Co', date: '2026-08-20', total: 50 };
const untimedEntries = buildCustomerLedger('No Timestamp Co', [untimedInvoice], [untimedPayment], []);
check('an untimed same-day payment sorts after the invoice, not before', untimedEntries.map((e) => e.kind), ['invoice', 'payment']);

console.log(`\n${passed}/${passed + failed} checks passed.`);
process.exit(failed ? 1 : 0);
