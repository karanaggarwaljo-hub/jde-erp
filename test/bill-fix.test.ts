/**
 * The "Return or cancel a bill" window tells the owner, before he types anything, what can be done
 * to a bill and exactly what a return will take off it. Both answers are checked here against the
 * rules and the arithmetic of the database functions they stand in front of.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CANCEL_REASONS,
  RETURN_REASONS,
  billFixOptions,
  chosenReason,
  previewSalesReturn,
  searchBills,
  type FixableInvoice,
} from '../lib/bill-fix';

const bill = (extra: Partial<FixableInvoice> = {}): FixableInvoice => ({
  id: 'INV-1001', status: 'unpaid', total: 2124, paid: 0, settlement_write_off: 0,
  discount_percent: 0, gst_percent: 18, gst_mode: 'exclusive', ...extra,
});

const CLEAN = { lineCount: 2, returnCount: 0, laterPayments: [] };

test('an ordinary bill can be returned against, cancelled or deleted', () => {
  const options = billFixOptions(bill(), CLEAN);
  assert.deepEqual(options, { return: { allowed: true }, cancel: { allowed: true }, delete: { allowed: true } });
});

test('a bill paid at the counter can still be cancelled: only a later receipt stands in the way', () => {
  const paidAtCounter = billFixOptions(bill({ status: 'paid', paid: 2124 }), CLEAN);
  assert.equal(paidAtCounter.cancel.allowed, true);

  const paidLater = billFixOptions(bill({ status: 'paid', paid: 2124 }), { ...CLEAN, laterPayments: ['RCPT-1004'] });
  assert.equal(paidLater.cancel.allowed, false);
  assert.match(paidLater.cancel.allowed ? '' : paidLater.cancel.why, /RCPT-1004/);
  assert.match(paidLater.cancel.allowed ? '' : paidLater.cancel.why, /Customer Ledger/);
  assert.equal(paidLater.delete.allowed, false);
  // Returning goods is still fine: it only lowers what the bill comes to.
  assert.equal(paidLater.return.allowed, true);
});

test('a bill with a return on it cannot be cancelled, and says what to do instead', () => {
  const options = billFixOptions(bill(), { ...CLEAN, returnCount: 1 });
  assert.equal(options.cancel.allowed, false);
  assert.match(options.cancel.allowed ? '' : options.cancel.why, /return the rest of the goods instead/);
  assert.equal(options.return.allowed, true);
});

test('a bill settled short cannot be cancelled or deleted until the settlement is removed', () => {
  const options = billFixOptions(bill({ settlement_write_off: 24 }), CLEAN);
  assert.equal(options.cancel.allowed, false);
  assert.equal(options.delete.allowed, false);
  assert.match(options.cancel.allowed ? '' : options.cancel.why, /settled for less/);
});

test('a draft can only be discarded, and a cancelled bill has nothing left to do', () => {
  const draft = billFixOptions(bill({ status: 'draft' }), CLEAN);
  assert.equal(draft.return.allowed, false);
  assert.equal(draft.cancel.allowed, false);
  assert.equal(draft.delete.allowed, true);

  const cancelled = billFixOptions(bill({ status: 'cancelled', total: 0 }), CLEAN);
  assert.deepEqual([cancelled.return.allowed, cancelled.cancel.allowed, cancelled.delete.allowed], [false, false, false]);
});

test('a bill with no lines on record cannot have goods returned against it', () => {
  const options = billFixOptions(bill(), { ...CLEAN, lineCount: 0 });
  assert.equal(options.return.allowed, false);
  assert.equal(options.cancel.allowed, true);
});

// The figures below are the ones measured on the live database when the credit maths was fixed
// (scripts/sales-return-discounts-and-gst-mode.sql): a 2 x ₹1,000 line sold at 10% off.
test('a full return credits exactly what the bill charged, GST extra', () => {
  const preview = previewSalesReturn(bill({ total: 2124 }), [{ soldQty: 2, lineTotal: 1800, qty: 2 }]);
  assert.equal(preview.subtotal, 1800);
  assert.equal(preview.gst, 324);
  assert.equal(preview.credit, 2124);
  assert.equal(preview.newTotal, 0);
  assert.equal(preview.stillOwed, 0);
  assert.equal(preview.refund, 0);
});

test('a full return credits exactly what the bill charged, GST included', () => {
  const preview = previewSalesReturn(bill({ total: 1800, gst_mode: 'inclusive' }), [{ soldQty: 2, lineTotal: 1800, qty: 2 }]);
  assert.equal(preview.credit, 1800);
  assert.equal(preview.gst, 274.58);
  assert.equal(preview.newTotal, 0);
});

test('a part return is a share of the line, and the bill-wide discount comes off it too', () => {
  // 3 pieces at ₹100 with 5% off the whole bill, GST 18% extra: 300 - 15 = 285, + 51.30 = 336.30.
  const invoice = bill({ total: 336.3, discount_percent: 5 });
  const preview = previewSalesReturn(invoice, [{ soldQty: 3, lineTotal: 300, qty: 1 }]);
  assert.equal(preview.subtotal, 100);
  assert.equal(preview.discount, 5);
  assert.equal(preview.gst, 17.1);
  assert.equal(preview.credit, 112.1);
  assert.equal(preview.newTotal, 224.2);
  assert.equal(preview.stillOwed, 224.2);
});

test('money already paid beyond the new total is handed back', () => {
  // Paid in full at ₹2,124, one of the two pieces comes back: ₹1,062 off, so ₹1,062 to refund.
  const preview = previewSalesReturn(bill({ status: 'paid', paid: 2124 }), [{ soldQty: 2, lineTotal: 1800, qty: 1 }]);
  assert.equal(preview.credit, 1062);
  assert.equal(preview.refund, 1062);
  assert.equal(preview.stillOwed, 0);
});

test('a part-paid bill only refunds what was paid beyond what it now comes to', () => {
  const preview = previewSalesReturn(bill({ status: 'partial', paid: 500 }), [{ soldQty: 2, lineTotal: 1800, qty: 1 }]);
  assert.equal(preview.newTotal, 1062);
  assert.equal(preview.refund, 0);
  assert.equal(preview.stillOwed, 562);
});

test('damaged pieces are credited in full but counted apart from what goes back on the shelf', () => {
  const preview = previewSalesReturn(bill(), [
    { soldQty: 2, lineTotal: 1800, qty: 1, damaged: true },
    { soldQty: 4, lineTotal: 400, qty: 3 },
  ]);
  assert.equal(preview.units, 4);
  assert.equal(preview.damaged, 1);
  assert.equal(preview.restocked, 3);
  assert.equal(preview.subtotal, 1200);
});

test('lines with nothing coming back add nothing', () => {
  const preview = previewSalesReturn(bill(), [{ soldQty: 2, lineTotal: 1800, qty: 0 }]);
  assert.equal(preview.units, 0);
  assert.equal(preview.credit, 0);
  assert.equal(preview.newTotal, 2124);
});

test('a reason is the tapped one, or what was typed under Other, and blank until there is one', () => {
  assert.equal(chosenReason(RETURN_REASONS[0], ''), 'Wrong part');
  assert.equal(chosenReason(null, '  seal was leaking '), 'seal was leaking');
  assert.equal(chosenReason(null, '   '), '');
  assert.ok(CANCEL_REASONS.length >= 3);
});

test('the bill list is newest first, leaves out cancelled bills and searches number, customer and parts', () => {
  const invoices = [
    { id: 'INV-1001', customer: 'Jasspal', date: '2026-11-10', status: 'unpaid' },
    { id: 'INV-1010', customer: 'Raman', date: '2026-11-12', status: 'paid' },
    { id: 'INV-1002', customer: 'Raman', date: '2026-11-12', status: 'draft' },
    { id: 'INV-1003', customer: 'Walk-in Customer', date: '2026-11-13', status: 'cancelled' },
  ];
  const parts = (id: string) => (id === 'INV-1001' ? 'Fuel filter 3DX' : 'Clutch plate');
  assert.deepEqual(searchBills(invoices, parts, '').map((invoice) => invoice.id), ['INV-1010', 'INV-1002', 'INV-1001']);
  assert.deepEqual(searchBills(invoices, parts, 'jass').map((invoice) => invoice.id), ['INV-1001']);
  assert.deepEqual(searchBills(invoices, parts, 'fuel').map((invoice) => invoice.id), ['INV-1001']);
  assert.deepEqual(searchBills(invoices, parts, '1010').map((invoice) => invoice.id), ['INV-1010']);
});
