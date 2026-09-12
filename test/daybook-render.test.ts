/**
 * Renders the day book's tables and reads them back.
 *
 * The figures are already covered by test/daybook.test.ts; what this adds is that they reach the
 * screen in the right column. A day book whose maths is right and whose money lands under the
 * wrong heading is still a day book nobody can trust.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DayBookDays, { niceDate } from '../components/DayBookDays';
import { buildDayBook, groupByDay, type DayBookSources } from '../lib/daybook';

const EMPTY: DayBookSources = {
  invoices: [], paymentAllocations: [], receipts: [], purchases: [],
  supplierPaymentAllocations: [], supplierPayments: [], expenses: [],
  salesReturns: [], purchaseReturns: [], settlements: [],
};

function render(patch: Partial<DayBookSources>, today = '2026-09-03') {
  const days = groupByDay(buildDayBook({ ...EMPTY, ...patch }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToStaticMarkup(createElement(DayBookDays as any, { days, today }));
}

test('today and yesterday are named, everything else is dated', () => {
  assert.equal(niceDate('2026-09-03', '2026-09-03'), 'Today');
  assert.equal(niceDate('2026-09-02', '2026-09-03'), 'Yesterday');
  assert.equal(niceDate('2026-09-01', '2026-09-03'), '1 Sep 2026');
  // Across a month boundary, which is where a naive subtraction goes wrong.
  assert.equal(niceDate('2026-08-31', '2026-09-01'), 'Yesterday');
});

test('a credit sale shows its value and nothing in either money column', () => {
  const markup = render({
    invoices: [{ id: 'INV-1013', customer: 'kareem', date: '2026-09-03', total: 13000, paid: 0, status: 'unpaid' }],
  });
  assert.match(markup, /INV-1013/);
  assert.match(markup, /kareem/);
  assert.match(markup, /₹13,000\.00/);
  assert.match(markup, /On account/);
  // The em dash is what stands in for "no money moved".
  assert.match(markup, /—/);
});

test('money in and money out reach different columns', () => {
  const markup = render({
    invoices: [{ id: 'INV-1016', customer: 'Walk-in Customer', date: '2026-09-03', total: 850, paid: 850, status: 'paid' }],
    expenses: [{ id: 'EXP-1', category: 'transport', description: 'Courier to Ludhiana', amount: 450, date: '2026-09-03', mode: 'cash' }],
  });
  assert.match(markup, /text-success">₹850\.00/);
  assert.match(markup, /text-danger">₹450\.00/);
  assert.match(markup, /₹850\.00 in/);
  assert.match(markup, /₹450\.00 out/);
});

test('a settlement is shown with no money against it', () => {
  const markup = render({
    settlements: [{ id: 'WOFF-1002', invoice_id: 'INV-1011', customer: 'Teja', date: '2026-09-03', amount: 3186.75, reason: 'rounded off in cash' }],
  });
  assert.match(markup, /Settled off/);
  assert.match(markup, /₹3,186\.75/);
  assert.match(markup, /rounded off in cash/);
  // Nothing was received, so the day's takings must still read zero.
  assert.match(markup, /₹0\.00 in/);
  assert.match(markup, /₹0\.00 out/);
});

test('every amount carries two decimals, as a ledger should', () => {
  const markup = render({
    purchases: [{ id: 'PO-1009', supplier: 'KRISHNA HYDRAULICS', date: '2026-09-03', total: 4440.7, paid: 4440.7, status: 'received' }],
  });
  assert.match(markup, /₹4,440\.70/);
  assert.doesNotMatch(markup, /₹4,440\.7</);
});

test('a sale links to its invoice and everything else does not pretend to', () => {
  const markup = render({
    invoices: [{ id: 'INV-1016', customer: 'Walk-in Customer', date: '2026-09-03', total: 850, paid: 850, status: 'paid' }],
    expenses: [{ id: 'EXP-1', category: 'rent', description: 'shop rent', amount: 5000, date: '2026-09-03', mode: 'bank' }],
  });
  assert.match(markup, /href="\/sales\/invoice\/INV-1016"/);
  assert.doesNotMatch(markup, /href="[^"]*EXP-1"/);
});

test('days are headed separately, newest first', () => {
  const markup = render({
    expenses: [
      { id: 'EXP-1', category: 'rent', description: 'rent', amount: 5000, date: '2026-09-03', mode: null },
      { id: 'EXP-2', category: 'transport', description: 'courier', amount: 450, date: '2026-09-01', mode: null },
    ],
  });
  assert.ok(markup.indexOf('Today') < markup.indexOf('1 Sep 2026'), 'the newest day comes first');
  assert.match(markup, /1 transaction</, 'a single entry is not called "1 transactions"');
});

test('nothing to show renders nothing rather than an empty shell', () => {
  assert.equal(render({}), '');
});
