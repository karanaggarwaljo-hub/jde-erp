/**
 * The "Change prices & stock" screen writes real prices and real stock counts for many parts on one
 * click, so what it decides is checked here, away from the browser: which typed boxes are changes,
 * which are refused, what a bulk price rule works out to, and the steps each part is saved by.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bulkPriceFor,
  describeCounts,
  effectiveValue,
  fillSalePrices,
  hasNoSalePrice,
  planQuickUpdate,
  readAmount,
  roundPrice,
  saveStepsFor,
  sellsAtOrBelowCost,
  type QuickPart,
} from '../lib/quick-prices';

const part = (id: string, extra: Partial<QuickPart> = {}): QuickPart => ({
  id, part_number: `P-${id}`, name: `Part ${id}`, brand: 'JCB', category: 'Engine',
  cost_price: 800, sale_price: 1000, current_stock: 5, ...extra,
});

const FILTER = part('1');
const PIN = part('2', { cost_price: 120, sale_price: 150, current_stock: 0 });
const UNPRICED = part('3', { cost_price: 0, sale_price: 0, current_stock: 2 });

test('a typed amount is read whether or not it carries a rupee sign or commas', () => {
  assert.equal(readAmount('1250'), 1250);
  assert.equal(readAmount('1,250.50'), 1250.5);
  assert.equal(readAmount('₹ 1,250'), 1250);
  assert.equal(readAmount('.5'), 0.5);
  assert.equal(readAmount('12.'), 12);
  assert.equal(readAmount('0'), 0);
});

test('anything that is not a plain number is refused rather than saved as a price', () => {
  for (const junk of ['', '   ', 'call', '12-', '-5', '1.2.3', '12abc', '₹']) {
    assert.equal(readAmount(junk), null, `"${junk}" must not read as a number`);
  }
});

test('only boxes typed to a different value count as changes', () => {
  const plan = planQuickUpdate([FILTER, PIN], {
    '1': { sale: '1100' },
    // Typed, then put back to what the part already has: nothing to save.
    '2': { sale: '150', stock: '0', cost: '120.00' },
  });
  assert.equal(plan.changes.length, 1);
  assert.deepEqual(plan.changes[0].sale, { from: 1000, to: 1100 });
  assert.equal(plan.changes[0].cost, undefined);
  assert.deepEqual(plan.counts, { parts: 1, stock: 0, cost: 0, sale: 1 });
  assert.equal(plan.problems.length, 0);
});

test('a blank box means "leave it", never zero', () => {
  const plan = planQuickUpdate([FILTER], { '1': { sale: '', stock: '  ' } });
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.problems.length, 0);
});

test('a box that is not a number is reported and the rest of that part still plans', () => {
  const plan = planQuickUpdate([FILTER], { '1': { sale: 'abc', stock: '9' } });
  assert.equal(plan.problems.length, 1);
  assert.equal(plan.problems[0].field, 'sale');
  assert.deepEqual(plan.changes[0].stock, { from: 5, to: 9 });
});

test('prices are compared and saved to the paisa', () => {
  const plan = planQuickUpdate([FILTER], { '1': { sale: '1000.004', cost: '800.456' } });
  // 1000.004 is ₹1,000.00, which the part already has.
  assert.equal(plan.changes[0].sale, undefined);
  assert.deepEqual(plan.changes[0].cost, { from: 800, to: 800.46 });
});

test('stock can be set to zero, and that is a change when there was some', () => {
  const plan = planQuickUpdate([FILTER], { '1': { stock: '0' } });
  assert.deepEqual(plan.changes[0].stock, { from: 5, to: 0 });
});

test('numbers the database hands over as text are still compared as numbers', () => {
  const fromDb = part('9', { cost_price: '800.00', sale_price: '1000.00', current_stock: '5' });
  const plan = planQuickUpdate([fromDb], { '9': { sale: '1000', cost: '800', stock: '5' } });
  assert.equal(plan.changes.length, 0);
});

test('the value a row works from is what is typed, falling back to the part when it is not a number', () => {
  assert.equal(effectiveValue(FILTER, { sale: '1200' }, 'sale'), 1200);
  assert.equal(effectiveValue(FILTER, { sale: 'abc' }, 'sale'), 1000);
  assert.equal(effectiveValue(FILTER, undefined, 'cost'), 800);
});

test('selling at or below cost, and having no price, are judged on the typed values', () => {
  assert.equal(sellsAtOrBelowCost(FILTER), false);
  assert.equal(sellsAtOrBelowCost(FILTER, { cost: '1000' }), true);
  assert.equal(sellsAtOrBelowCost(FILTER, { sale: '700' }), true);
  // No cost recorded is not "below cost": there is nothing to compare with.
  assert.equal(sellsAtOrBelowCost(UNPRICED), false);
  assert.equal(hasNoSalePrice(UNPRICED), true);
  assert.equal(hasNoSalePrice(UNPRICED, { sale: '40' }), false);
});

test('rounding goes to the nearest rupee, five or ten', () => {
  assert.equal(roundPrice(1052.4, 1), 1052);
  assert.equal(roundPrice(1052.5, 1), 1053);
  assert.equal(roundPrice(1052.4, 5), 1050);
  assert.equal(roundPrice(1053, 5), 1055);
  assert.equal(roundPrice(1054.9, 10), 1050);
  assert.equal(roundPrice(1055, 10), 1060);
  assert.equal(roundPrice(1052.456, 0), 1052.46);
});

test('raising by a percentage moves each sale price by that much', () => {
  assert.equal(bulkPriceFor(FILTER, undefined, { kind: 'percent', percent: 5 }, 1), 1050);
  assert.equal(bulkPriceFor(FILTER, undefined, { kind: 'percent', percent: -10 }, 1), 900);
  // Works on a price already typed into the box, not the saved one.
  assert.equal(bulkPriceFor(FILTER, { sale: '2000' }, { kind: 'percent', percent: 5 }, 1), 2100);
});

test('a margin rule prices from cost the way the Margin column reads it back', () => {
  // Cost 800 at a 20% margin is 1000: (1000 - 800) / 1000 = 20%.
  assert.equal(bulkPriceFor(FILTER, undefined, { kind: 'margin', percent: 20 }, 1), 1000);
  assert.equal(bulkPriceFor(PIN, undefined, { kind: 'margin', percent: 25 }, 5), 160);
  // And it follows a cost typed on the same row.
  assert.equal(bulkPriceFor(FILTER, { cost: '900' }, { kind: 'margin', percent: 10 }, 1), 1000);
});

test('a rule with nothing to work from leaves the part alone', () => {
  // No sale price to raise, no cost to price from.
  assert.equal(bulkPriceFor(UNPRICED, undefined, { kind: 'percent', percent: 5 }, 1), null);
  assert.equal(bulkPriceFor(UNPRICED, undefined, { kind: 'margin', percent: 20 }, 1), null);
  // Nonsense rules: a 100% margin is an infinite price, and -100% is a price of nothing.
  assert.equal(bulkPriceFor(FILTER, undefined, { kind: 'margin', percent: 100 }, 1), null);
  assert.equal(bulkPriceFor(FILTER, undefined, { kind: 'margin', percent: -5 }, 1), null);
  assert.equal(bulkPriceFor(FILTER, undefined, { kind: 'percent', percent: -100 }, 1), null);
  assert.equal(bulkPriceFor(FILTER, undefined, { kind: 'percent', percent: Number.NaN }, 1), null);
});

test('filling in many prices only fills boxes, keeps other typing, and counts what it skipped', () => {
  const before = { '1': { stock: '7' } };
  const result = fillSalePrices([FILTER, PIN, UNPRICED], before, { kind: 'percent', percent: 10 }, 1);
  assert.equal(result.filled, 2);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.drafts['1'], { stock: '7', sale: '1100' });
  assert.deepEqual(result.drafts['2'], { sale: '165' });
  assert.equal(result.drafts['3'], undefined);
  // The drafts handed in are not altered: the screen can still undo.
  assert.deepEqual(before, { '1': { stock: '7' } });
});

test('a part saves the way its Edit form saves it: prices first, then stock or the cost correction', () => {
  const [onlySale] = planQuickUpdate([FILTER], { '1': { sale: '1100' } }).changes;
  assert.deepEqual(saveStepsFor(onlySale), { partId: '1', patch: { sale_price: 1100 } });

  const [onlyCost] = planQuickUpdate([FILTER], { '1': { cost: '850' } }).changes;
  assert.deepEqual(saveStepsFor(onlyCost), { partId: '1', patch: { cost_price: 850 }, correctCost: 850 });

  // Stock changed: new units come in at the part's cost, and no separate cost correction runs.
  const [onlyStock] = planQuickUpdate([FILTER], { '1': { stock: '12' } }).changes;
  assert.deepEqual(saveStepsFor(onlyStock), { partId: '1', setStock: { target: 12, unitCost: 800 } });

  const [all] = planQuickUpdate([FILTER], { '1': { stock: '12', cost: '850', sale: '1100' } }).changes;
  assert.deepEqual(saveStepsFor(all), {
    partId: '1',
    patch: { cost_price: 850, sale_price: 1100 },
    setStock: { target: 12, unitCost: 850 },
  });
});

test('the line beside Save says what is about to change', () => {
  assert.equal(describeCounts({ parts: 0, stock: 0, cost: 0, sale: 0 }), 'Nothing changed yet');
  assert.equal(describeCounts({ parts: 1, stock: 0, cost: 0, sale: 1 }), '1 part changed: 1 sale price');
  assert.equal(describeCounts({ parts: 3, stock: 1, cost: 2, sale: 3 }), '3 parts changed: 3 sale prices, 2 costs, 1 stock count');
});
