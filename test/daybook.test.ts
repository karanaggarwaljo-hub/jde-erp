import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDayBook,
  dayBookTotals,
  groupByDay,
  istDate,
  withinRange,
  type DayBookSources,
} from '../lib/daybook';

const EMPTY: DayBookSources = {
  invoices: [], paymentAllocations: [], receipts: [], purchases: [],
  supplierPaymentAllocations: [], supplierPayments: [], expenses: [],
  salesReturns: [], purchaseReturns: [], settlements: [],
};

const sources = (patch: Partial<DayBookSources>): DayBookSources => ({ ...EMPTY, ...patch });

test('a credit sale is its full value and no money in the till', () => {
  const [entry] = buildDayBook(sources({
    invoices: [{ id: 'INV-1012', customer: 'jasspal', date: '2026-09-01', total: 5626, paid: 0, status: 'unpaid' }],
  }));
  assert.equal(entry.kind, 'sale');
  assert.equal(entry.value, 5626);
  assert.equal(entry.cashIn, 0);
  assert.match(entry.detail, /On account/);
});

test('a counter sale paid in full is money in on its own day', () => {
  const [entry] = buildDayBook(sources({
    invoices: [{ id: 'INV-1016', customer: 'Walk-in Customer', date: '2026-09-03', total: 850, paid: 850, status: 'paid' }],
  }));
  assert.equal(entry.cashIn, 850);
  assert.match(entry.detail, /Paid in full at the counter/);
});

test('a payment received later is not counted twice', () => {
  // This is the trap. jde_invoices.paid grows as payments are allocated to it, so an invoice that
  // was sold on credit and paid a week later reads paid=13000 — and the receipt says 13000 too.
  // Counting both would put the same money in two different days.
  const entries = buildDayBook(sources({
    invoices: [{ id: 'INV-1013', customer: 'kareem', date: '2026-09-01', total: 13000, paid: 13000, status: 'paid' }],
    paymentAllocations: [{ invoice_id: 'INV-1013', amount: 13000 }],
    receipts: [{ id: 'RCPT-1001', customer: 'kareem', date: '2026-09-03', amount: 13000, note: null }],
  }));
  const sale = entries.find((entry) => entry.kind === 'sale')!;
  const receipt = entries.find((entry) => entry.kind === 'receipt')!;
  assert.equal(sale.cashIn, 0, 'the sale itself took nothing at the counter');
  assert.equal(sale.value, 13000);
  assert.equal(receipt.cashIn, 13000);
  assert.equal(dayBookTotals(entries).cashIn, 13000, 'the money must be counted exactly once');
});

test('a part payment at the counter is separated from a later one', () => {
  const entries = buildDayBook(sources({
    invoices: [{ id: 'INV-1', customer: 'jasspal', date: '2026-09-01', total: 10000, paid: 8000, status: 'partial' }],
    paymentAllocations: [{ invoice_id: 'INV-1', amount: 5000 }],
    receipts: [{ id: 'RCPT-1', customer: 'jasspal', date: '2026-09-05', amount: 5000, note: null }],
  }));
  const sale = entries.find((entry) => entry.kind === 'sale')!;
  assert.equal(sale.cashIn, 3000, '8000 recorded paid, 5000 of it arrived later');
  assert.match(sale.detail, /3,000 taken now/);
  assert.equal(dayBookTotals(entries).cashIn, 8000);
});

test('a draft is not a transaction', () => {
  // Nothing has been billed, so putting it in a day's figures would invent a sale.
  const entries = buildDayBook(sources({
    invoices: [{ id: 'INV-DRAFT', customer: 'jasspal', date: '2026-09-01', total: 9999, paid: 0, status: 'draft' }],
    purchases: [{ id: 'PO-DRAFT', supplier: 'Sharma', date: '2026-09-01', total: 5000, paid: 0, status: 'draft' }],
  }));
  assert.deepEqual(entries, []);
});

test('a purchase paid on collection is money out', () => {
  const [entry] = buildDayBook(sources({
    purchases: [{ id: 'PO-1004', supplier: 'Sharma Auto', date: '2026-09-01', total: 4000, paid: 4000, status: 'received' }],
  }));
  assert.equal(entry.kind, 'purchase');
  assert.equal(entry.cashOut, 4000);
  assert.equal(entry.cashIn, 0);
});

test('a supplier payment made later is not counted twice either', () => {
  const entries = buildDayBook(sources({
    purchases: [{ id: 'PO-1', supplier: 'Sharma Auto', date: '2026-09-01', total: 4000, paid: 4000, status: 'received' }],
    supplierPaymentAllocations: [{ po_id: 'PO-1', amount: 4000 }],
    supplierPayments: [{ id: 'SPAY-1', supplier: 'Sharma Auto', date: '2026-09-06', amount: 4000, note: null, reference: null }],
  }));
  assert.equal(entries.find((entry) => entry.kind === 'purchase')!.cashOut, 0);
  assert.equal(dayBookTotals(entries).cashOut, 4000);
});

test('an expense is always money out on its own date', () => {
  const [entry] = buildDayBook(sources({
    expenses: [{ id: 'EXP-1', category: 'transport', description: 'Courier to Ludhiana', amount: 450, date: '2026-09-02', mode: 'cash' }],
  }));
  assert.equal(entry.cashOut, 450);
  assert.equal(entry.detail, 'Courier to Ludhiana');
});

test('a settlement moves no money in either direction', () => {
  // The whole reason settlement_write_off is a separate column: forgiven debt is not cash. If it
  // showed as money in, the write-off would inflate the day's takings.
  const [entry] = buildDayBook(sources({
    settlements: [{ id: 'WOFF-1002', invoice_id: 'INV-1011', customer: 'Teja', date: '2026-09-05', amount: 3186.75, reason: 'settled short' }],
  }));
  assert.equal(entry.kind, 'settlement');
  assert.equal(entry.value, 3186.75);
  assert.equal(entry.cashIn, 0);
  assert.equal(entry.cashOut, 0);
});

test('a credit note taken off the account costs no cash; a refund does', () => {
  const entries = buildDayBook(sources({
    salesReturns: [
      { id: 'SRN-1', invoice_id: 'INV-1', credit_total: 3500, refund_or_credit_amount: 0, reason: 'wrong part', created_at: '2026-09-02T06:00:00Z' },
      { id: 'SRN-2', invoice_id: 'INV-2', credit_total: 1200, refund_or_credit_amount: 1200, reason: 'cash back', created_at: '2026-09-02T07:00:00Z' },
    ],
  }));
  const onAccount = entries.find((entry) => entry.id === 'SRN-1')!;
  const refunded = entries.find((entry) => entry.id === 'SRN-2')!;
  assert.equal(onAccount.value, 3500);
  assert.equal(onAccount.cashOut, 0);
  assert.equal(refunded.cashOut, 1200);
});

test('a return written in the evening is filed on the Indian day, not the UTC one', () => {
  // 20:30 UTC on the 10th is 02:00 IST on the 11th. Slicing the raw timestamp files it a day
  // early, and the day's documents then disagree with the day's totals.
  assert.equal(istDate('2026-09-10T20:30:00Z'), '2026-09-11');
  assert.equal(istDate('2026-09-10T10:00:00Z'), '2026-09-10');
  assert.equal(istDate('2026-09-10T18:29:00Z'), '2026-09-10');
  assert.equal(istDate('2026-09-10T18:31:00Z'), '2026-09-11');
});

test('an unreadable timestamp drops the row rather than inventing a date', () => {
  assert.equal(istDate('not a date'), '');
  assert.equal(istDate(null), '');
  const entries = buildDayBook(sources({
    salesReturns: [{ id: 'SRN-X', invoice_id: 'INV-1', credit_total: 100, refund_or_credit_amount: 0, reason: null, created_at: 'rubbish' }],
  }));
  assert.deepEqual(entries, []);
});

test('everything is newest first, and the later document of a day comes first', () => {
  const entries = buildDayBook(sources({
    invoices: [
      { id: 'INV-1010', customer: 'a', date: '2026-09-01', total: 100, paid: 0, status: 'unpaid' },
      { id: 'INV-1012', customer: 'b', date: '2026-09-01', total: 100, paid: 0, status: 'unpaid' },
      { id: 'INV-1011', customer: 'c', date: '2026-09-03', total: 100, paid: 0, status: 'unpaid' },
    ],
  }));
  assert.deepEqual(entries.map((entry) => entry.reference), ['INV-1011', 'INV-1012', 'INV-1010']);
});

test('the day book is grouped into days, each with its own totals', () => {
  const entries = buildDayBook(sources({
    invoices: [{ id: 'INV-1', customer: 'a', date: '2026-09-01', total: 1000, paid: 1000, status: 'paid' }],
    expenses: [
      { id: 'EXP-1', category: 'transport', description: 'courier', amount: 200, date: '2026-09-01', mode: 'cash' },
      { id: 'EXP-2', category: 'rent', description: 'shop rent', amount: 5000, date: '2026-09-02', mode: 'bank' },
    ],
  }));
  const days = groupByDay(entries);
  assert.deepEqual(days.map((day) => day.date), ['2026-09-02', '2026-09-01']);
  assert.equal(days[0].totals.cashOut, 5000);
  assert.equal(days[1].totals.cashIn, 1000);
  assert.equal(days[1].totals.cashOut, 200);
  assert.equal(days[1].totals.netCash, 800);
  assert.equal(days[1].totals.entryCount, 2);
});

test('totals keep document value and cash apart', () => {
  const entries = buildDayBook(sources({
    invoices: [{ id: 'INV-1', customer: 'a', date: '2026-09-01', total: 10000, paid: 0, status: 'unpaid' }],
    purchases: [{ id: 'PO-1', supplier: 'b', date: '2026-09-01', total: 4000, paid: 4000, status: 'received' }],
    expenses: [{ id: 'EXP-1', category: 'rent', description: 'rent', amount: 500, date: '2026-09-01', mode: 'cash' }],
  }));
  const totals = dayBookTotals(entries);
  assert.equal(totals.sold, 10000, 'billed in full');
  assert.equal(totals.cashIn, 0, 'and not a rupee of it collected');
  assert.equal(totals.bought, 4000);
  assert.equal(totals.spent, 500);
  assert.equal(totals.cashOut, 4500);
  assert.equal(totals.netCash, -4500);
});

test('a range keeps both of its ends', () => {
  const entries = buildDayBook(sources({
    expenses: [
      { id: 'A', category: 'x', description: 'a', amount: 1, date: '2026-09-01', mode: null },
      { id: 'B', category: 'x', description: 'b', amount: 1, date: '2026-09-02', mode: null },
      { id: 'C', category: 'x', description: 'c', amount: 1, date: '2026-09-03', mode: null },
    ],
  }));
  assert.deepEqual(withinRange(entries, '2026-09-01', '2026-09-02').map((e) => e.id), ['B', 'A']);
  assert.deepEqual(withinRange(entries, '2026-09-02', '2026-09-02').map((e) => e.id), ['B']);
  // Blank ends mean open-ended, which is how "everything so far" is asked for.
  assert.equal(withinRange(entries, '', '').length, 3);
  assert.deepEqual(withinRange(entries, '2026-09-03', '').map((e) => e.id), ['C']);
});

test('figures arriving as strings are still money', () => {
  // Postgres numeric columns come over the REST API as strings.
  const [entry] = buildDayBook(sources({
    invoices: [{ id: 'INV-1', customer: 'a', date: '2026-09-01', total: '41356.75', paid: '40000', status: 'partial' }],
  }));
  assert.equal(entry.value, 41356.75);
  assert.equal(entry.cashIn, 40000);
});
