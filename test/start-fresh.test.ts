import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmationMatches, describeReset, startFreshPlan, type StartFreshCounts } from '../lib/start-fresh';

// Jai Durga Enterprises' real counts on 1 October 2026.
const LIVE: StartFreshCounts = {
  parts: 254, partsWithStock: 238, partsWithPrices: 250,
  invoices: 7, quotations: 0, salesReturns: 1, paymentsReceived: 2, writeOffs: 1,
  purchases: 2, purchaseReturns: 0, supplierPayments: 0, expenses: 0,
  customers: 3, suppliers: 3, liveOnWebsite: 22,
};

const NONE: StartFreshCounts = {
  parts: 5, partsWithStock: 0, partsWithPrices: 0,
  invoices: 0, quotations: 0, salesReturns: 0, paymentsReceived: 0, writeOffs: 0,
  purchases: 0, purchaseReturns: 0, supplierPayments: 0, expenses: 0,
  customers: 0, suppliers: 1, liveOnWebsite: 0,
};

test('what is cleared names the stock and the prices, with counts', () => {
  assert.deepEqual(startFreshPlan(LIVE).cleared, [
    'Stock on 238 parts goes to 0',
    'Cost, sale price and MRP cleared on 250 parts',
  ]);
});

test('what is deleted lists only the kinds there are any of', () => {
  assert.deepEqual(startFreshPlan(LIVE).deleted, [
    '7 sales bills', '1 credit note', '2 payments received', '1 settlement write-off', '2 purchases', '3 customers',
  ]);
});

test('what is kept says the parts list survives, and the suppliers do', () => {
  const { kept } = startFreshPlan(LIVE);
  assert.match(kept[0], /^254 parts: names, part numbers, what they fit/);
  assert.ok(kept.includes('3 suppliers, with what you owe them set to zero'));
  assert.ok(kept.includes('22 listings live on your website'));
});

test('a company with nothing to clear or delete says so', () => {
  const plan = startFreshPlan(NONE);
  assert.equal(plan.nothingToDo, true);
  assert.deepEqual(plan.deleted, []);
  assert.equal(startFreshPlan(LIVE).nothingToDo, false);
  assert.ok(!startFreshPlan(NONE).kept.some((line) => line.includes('website')), 'no website line with no listings');
});

test('the company name must be typed back, ignoring case and outer spaces only', () => {
  assert.equal(confirmationMatches('  jai durga enterprises ', 'Jai Durga Enterprises'), true);
  assert.equal(confirmationMatches('Jai Durga', 'Jai Durga Enterprises'), false);
  assert.equal(confirmationMatches('JaiDurga Enterprises', 'Jai Durga Enterprises'), false);
  assert.equal(confirmationMatches('', ''), false, 'an empty name never confirms');
});

test('the result reads as one sentence, from what the database reports', () => {
  assert.equal(
    describeReset({ invoices: 7, purchases: 2, customers: 3, sales_returns: 1, payments_received: 2, write_offs: 1, quotations: 0, parts_cleared: 254 }),
    'Deleted 7 sales bills, 1 credit note, 2 payments received, 1 settlement write-off, 2 purchases, 3 customers; cleared stock and prices on 254 parts',
  );
  assert.equal(describeReset({ parts_cleared: 1 }), 'Nothing to delete; cleared stock and prices on 1 part');
});
