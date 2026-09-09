import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceCostOfGoods, realisedProfit } from '../lib/invoice-profit';
import { round2 } from '../lib/money';

test('costs an invoice from the FIFO draws recorded against its lines', () => {
  const cost = invoiceCostOfGoods(
    [{ id: 'II-1' }, { id: 'II-2' }],
    [
      { invoice_item_id: 'II-1', qty: 2, unit_cost: 500 },
      { invoice_item_id: 'II-2', qty: 3, unit_cost: 120.5 },
    ]
  );
  assert.equal(cost.cost, 1361.5);
  assert.equal(cost.cost_known, true);
  assert.equal(cost.lines_without_cost, 0);
});

test('adds up several batches drawn for the same line', () => {
  // A line big enough to empty one batch and start the next has two consumption rows, at
  // different unit costs. Both belong to the same line and both count.
  const cost = invoiceCostOfGoods(
    [{ id: 'II-1' }],
    [
      { invoice_item_id: 'II-1', qty: 4, unit_cost: 100 },
      { invoice_item_id: 'II-1', qty: 6, unit_cost: 130 },
    ]
  );
  assert.equal(cost.cost, 1180);
  assert.equal(cost.cost_known, true);
});

test('a line with no recorded cost makes the whole invoice cost unknown', () => {
  // The failure this guards against: reporting the missing line as costing nothing, which turns
  // its full sale value into reported profit.
  const cost = invoiceCostOfGoods(
    [{ id: 'II-1' }, { id: 'II-2' }],
    [{ invoice_item_id: 'II-1', qty: 2, unit_cost: 500 }]
  );
  assert.equal(cost.cost_known, false);
  assert.equal(cost.lines_without_cost, 1);
  assert.equal(realisedProfit(5000, cost), null);
});

test('an invoice with no lines at all has no known cost', () => {
  const cost = invoiceCostOfGoods([], []);
  assert.equal(cost.cost_known, false);
  assert.equal(realisedProfit(5000, cost), null);
});

test('ignores draws belonging to another invoice', () => {
  const cost = invoiceCostOfGoods(
    [{ id: 'II-1' }],
    [
      { invoice_item_id: 'II-1', qty: 1, unit_cost: 200 },
      { invoice_item_id: 'II-9', qty: 50, unit_cost: 900 },
    ]
  );
  assert.equal(cost.cost, 200);
  assert.equal(cost.cost_known, true);
});

test('unreadable qty or cost counts as nothing rather than NaN', () => {
  const cost = invoiceCostOfGoods(
    [{ id: 'II-1' }],
    [{ invoice_item_id: 'II-1', qty: 'n/a' as unknown as number, unit_cost: 500 }]
  );
  assert.equal(cost.cost, 0);
  // The line does have a draw, so the cost is known — it is genuinely zero, not missing.
  assert.equal(cost.cost_known, true);
});

test('profit is measured against money received, not the invoice total', () => {
  // Invoice was 41,356.75; the customer paid 40,000 and the rest was settled off. The 1,356.75
  // never arrived, so it is simply absent from what is measured — it is not subtracted twice.
  const cost = invoiceCostOfGoods([{ id: 'II-1' }], [{ invoice_item_id: 'II-1', qty: 1, unit_cost: 32000 }]);
  const outcome = realisedProfit(40000, cost);
  assert.ok(outcome);
  assert.equal(outcome.received, 40000);
  assert.equal(outcome.cost, 32000);
  assert.equal(outcome.profit, 8000);
  assert.equal(outcome.margin_percent, 20);
});

test('a sale that cost more than it collected reports a real loss', () => {
  const cost = invoiceCostOfGoods([{ id: 'II-1' }], [{ invoice_item_id: 'II-1', qty: 1, unit_cost: 5000 }]);
  const outcome = realisedProfit(3000, cost);
  assert.ok(outcome);
  assert.equal(outcome.profit, -2000);
});

test('nothing received leaves no margin to quote', () => {
  const cost = invoiceCostOfGoods([{ id: 'II-1' }], [{ invoice_item_id: 'II-1', qty: 1, unit_cost: 900 }]);
  const outcome = realisedProfit(0, cost);
  assert.ok(outcome);
  assert.equal(outcome.profit, -900);
  assert.equal(outcome.margin_percent, null);
});

test('rupee figures are rounded to the paisa, not left as float dust', () => {
  assert.equal(round2(1356.7500000000002), 1356.75);
  assert.equal(round2(0.1 + 0.2), 0.3);
  const cost = invoiceCostOfGoods([{ id: 'II-1' }], [{ invoice_item_id: 'II-1', qty: 3, unit_cost: 0.1 }]);
  assert.equal(cost.cost, 0.3);
});
