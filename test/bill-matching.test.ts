import assert from 'node:assert/strict';
import test from 'node:test';
import {
  billTotals, duplicateBillNumbers, matchBills,
  type BillablePurchase, type PurchaseLine, type ReturnToSupplier,
} from '../lib/bill-matching';

const purchase = (over: Partial<BillablePurchase> = {}): BillablePurchase => ({
  id: 'PO-1001', supplier: 'JAIN AUTO SALES', date: '2026-09-01',
  total: 1000, paid: 0, status: 'received', supplier_invoice_no: 'B-77', ...over,
});

const line = (over: Partial<PurchaseLine> = {}): PurchaseLine =>
  ({ po_id: 'PO-1001', qty: 1, line_total: 1000, ...over });

const credit = (over: Partial<ReturnToSupplier> = {}): ReturnToSupplier =>
  ({ po_id: 'PO-1001', credit_total: 0, ...over });

const only = (...args: Parameters<typeof matchBills>) => {
  const matched = matchBills(...args);
  assert.equal(matched.length, 1);
  return matched[0];
};

// ── What is still owed on a bill ──────────────────────────────────────────────────────────────

test('a clean bill owes what has not been paid', () => {
  const bill = only([purchase({ total: 1000, paid: 400 })], [line()], []);
  assert.equal(bill.outstanding, 600);
  assert.deepEqual(bill.flags, []);
});

test('goods sent back reduce what is owed, before payment is counted', () => {
  const bill = only([purchase({ total: 1000, paid: 400 })], [line()], [credit({ credit_total: 200 })]);
  assert.equal(bill.credited, 200);
  assert.equal(bill.outstanding, 400, '1000 billed, 200 credited, 400 paid');
});

test('a fully settled bill owes nothing rather than a negative amount', () => {
  const bill = only([purchase({ total: 1000, paid: 1000 })], [line()], []);
  assert.equal(bill.outstanding, 0);
  assert.deepEqual(bill.flags, []);
});

/** Worth surfacing: money has left the business that the bill does not account for. */
test('paying more than the bill is flagged, and still reported as owing nothing', () => {
  const bill = only([purchase({ total: 1000, paid: 1200 })], [line()], []);
  assert.deepEqual(bill.flags, ['overpaid']);
  assert.equal(bill.outstanding, 0);
});

test('a credit that takes the bill below what was paid counts as overpaid too', () => {
  const bill = only([purchase({ total: 1000, paid: 1000 })], [line()], [credit({ credit_total: 300 })]);
  assert.deepEqual(bill.flags, ['overpaid'], '300 of the 1000 paid is now unaccounted for');
});

// ── What does not add up ──────────────────────────────────────────────────────────────────────

test('a bill with no number is flagged, because a second copy of it would not be caught', () => {
  const bill = only([purchase({ supplier_invoice_no: null })], [line()], []);
  assert.equal(bill.billNumber, null);
  assert.deepEqual(bill.flags, ['no_bill_number']);
});

test('a blank or whitespace bill number counts as none at all', () => {
  assert.equal(only([purchase({ supplier_invoice_no: '   ' })], [line()], []).billNumber, null);
  assert.equal(only([purchase({ supplier_invoice_no: '' })], [line()], []).billNumber, null);
});

test('a bill number keeps its own spelling, trimmed', () => {
  assert.equal(only([purchase({ supplier_invoice_no: '  inv/2026/88  ' })], [line()], []).billNumber, 'inv/2026/88');
});

test('billed but never received is flagged — nothing went into stock', () => {
  const bill = only([purchase({ status: 'pending' })], [line()], []);
  assert.ok(bill.flags.includes('billed_not_received'));
  assert.equal(bill.received, false);
});

test('a purchase with no item lines is flagged', () => {
  const bill = only([purchase()], [], []);
  assert.deepEqual(bill.flags, ['no_lines']);
  assert.equal(bill.lineCount, 0);
});

test('lines that do not add up to the bill total are flagged', () => {
  const bill = only([purchase({ total: 1000 })], [line({ line_total: 400 })], []);
  assert.deepEqual(bill.flags, ['lines_disagree_with_total']);
  assert.equal(bill.linesTotal, 400);
});

/** Reporting both about one purchase would read as two problems instead of one. */
test('a purchase with no lines is not also flagged for lines that disagree', () => {
  const bill = only([purchase({ total: 1000 })], [], []);
  assert.equal(bill.flags.includes('lines_disagree_with_total'), false);
});

test('a penny of rounding is not a discrepancy', () => {
  const bill = only([purchase({ total: 1000 })], [line({ line_total: 1000.004 })], []);
  assert.deepEqual(bill.flags, []);
});

test('several item lines add up together', () => {
  const bill = only(
    [purchase({ total: 1000 })],
    [line({ line_total: 600 }), line({ line_total: 400 })],
    []
  );
  assert.equal(bill.linesTotal, 1000);
  assert.equal(bill.lineCount, 2);
  assert.deepEqual(bill.flags, []);
});

test('lines and credits belonging to another purchase are not counted here', () => {
  const bill = only(
    [purchase({ id: 'PO-1001', total: 1000 })],
    [line({ po_id: 'PO-1001', line_total: 1000 }), line({ po_id: 'PO-9999', line_total: 5000 })],
    [credit({ po_id: 'PO-9999', credit_total: 800 })]
  );
  assert.equal(bill.linesTotal, 1000);
  assert.equal(bill.credited, 0);
});

test('an unreadable amount counts as nothing, not NaN', () => {
  const bill = only(
    [purchase({ total: undefined as unknown as number, paid: 'x' as unknown as number })],
    [line({ line_total: undefined as unknown as number })],
    []
  );
  assert.equal(bill.outstanding, 0);
  assert.equal(bill.linesTotal, 0);
  assert.ok(Number.isFinite(bill.outstanding));
});

// ── The totals across a supplier ──────────────────────────────────────────────────────────────

test('the totals are the sum of the bills, and count what needs looking at', () => {
  const matched = matchBills(
    [
      purchase({ id: 'PO-1', total: 1000, paid: 1000 }),
      purchase({ id: 'PO-2', total: 500, paid: 0, supplier_invoice_no: null }),
      purchase({ id: 'PO-3', total: 300, paid: 0, status: 'pending' }),
    ],
    [line({ po_id: 'PO-1' }), line({ po_id: 'PO-2', line_total: 500 }), line({ po_id: 'PO-3', line_total: 300 })],
    []
  );
  const totals = billTotals(matched);
  assert.equal(totals.count, 3);
  assert.equal(totals.billed, 1800);
  assert.equal(totals.paid, 1000);
  assert.equal(totals.outstanding, 800);
  assert.equal(totals.flagged, 2, 'the one with no bill number, and the one not received');
  assert.equal(totals.withoutBillNumber, 1);
});

test('no bills at all totals zero rather than failing', () => {
  assert.deepEqual(billTotals([]), {
    billed: 0, paid: 0, credited: 0, outstanding: 0, count: 0, flagged: 0, withoutBillNumber: 0,
  });
});

// ── Bills already on file twice ───────────────────────────────────────────────────────────────

/** The database refuses this for anything recorded from now on, so the only way one can appear is
 *  that it was already there before the rule existed. */
test('two bills sharing a number from one supplier are grouped together', () => {
  const matched = matchBills(
    [
      purchase({ id: 'PO-1', supplier_invoice_no: 'B-77' }),
      purchase({ id: 'PO-2', supplier_invoice_no: 'b-77' }),
      purchase({ id: 'PO-3', supplier_invoice_no: 'B-88' }),
    ],
    [],
    []
  );
  const groups = duplicateBillNumbers(matched);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map((bill) => bill.purchase.id), ['PO-1', 'PO-2']);
});

/** Two suppliers numbering their own bills the same way is normal, not a duplicate. */
test('the same number from two different suppliers is two different bills', () => {
  const matched = matchBills(
    [
      purchase({ id: 'PO-1', supplier: 'JAIN AUTO SALES', supplier_invoice_no: 'B-77' }),
      purchase({ id: 'PO-2', supplier: 'SOMEBODY ELSE', supplier_invoice_no: 'B-77' }),
    ],
    [],
    []
  );
  assert.deepEqual(duplicateBillNumbers(matched), []);
});

test('bills with no number are never treated as duplicates of each other', () => {
  const matched = matchBills(
    [purchase({ id: 'PO-1', supplier_invoice_no: null }), purchase({ id: 'PO-2', supplier_invoice_no: null })],
    [],
    []
  );
  assert.deepEqual(duplicateBillNumbers(matched), []);
});
