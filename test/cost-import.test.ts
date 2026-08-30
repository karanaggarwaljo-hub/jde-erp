import assert from 'node:assert/strict';
import test from 'node:test';
import { planCostUpdates, countOutcomes, type CostMatchProduct } from '../lib/cost-import';
import type { CostUpdateRow } from '../lib/client-import';

const product = (over: Partial<CostMatchProduct> & { id: string }): CostMatchProduct => ({
  part_number: '',
  oem_number: '',
  name: '',
  cost_price: 0,
  ...over,
});

const row = (over: Partial<CostUpdateRow> & { rowNumber: number; cost: number }): CostUpdateRow => ({
  partNumber: '',
  oemNumber: '',
  name: '',
  ...over,
});

const INVENTORY: CostMatchProduct[] = [
  product({ id: 'p1', part_number: 'JCB-H49', name: 'jcb hydarulic oil 20l', cost_price: 5990 }),
  product({ id: 'p2', part_number: 'SER-E37', name: 'servo engine oil 5l', cost_price: 1250 }),
  product({ id: 'p3', part_number: 'BOS-F12', oem_number: 'F026402062', name: 'Bosch Fuel Filter', cost_price: 430 }),
];

test('updates a matched part whose cost has changed, and leaves an identical one alone', () => {
  const matches = planCostUpdates(
    [row({ rowNumber: 1, partNumber: 'JCB-H49', cost: 6250 }), row({ rowNumber: 2, partNumber: 'BOS-F12', cost: 430 })],
    INVENTORY
  );
  assert.equal(matches[0].outcome, 'update');
  assert.equal(matches[0].product?.id, 'p1');
  assert.equal(matches[1].outcome, 'unchanged');
});

test('matches part numbers regardless of case, spacing and punctuation', () => {
  for (const written of ['jcb-h49', 'JCB H49', 'jcbh49', ' JCB_H49 ']) {
    const [match] = planCostUpdates([row({ rowNumber: 1, partNumber: written, cost: 6250 })], INVENTORY);
    assert.equal(match.outcome, 'update', `expected "${written}" to match`);
    assert.equal(match.product?.id, 'p1');
  }
});

test('falls back to OEM number, then to name, when there is no part number', () => {
  const [byOem] = planCostUpdates([row({ rowNumber: 1, oemNumber: 'F026402062', cost: 500 })], INVENTORY);
  assert.equal(byOem.outcome, 'update');
  assert.equal(byOem.matchedBy, 'OEM number');

  const [byName] = planCostUpdates([row({ rowNumber: 1, name: 'Servo Engine Oil 5L', cost: 1310 })], INVENTORY);
  assert.equal(byName.outcome, 'update');
  assert.equal(byName.matchedBy, 'name');
  assert.equal(byName.product?.id, 'p2');
});

test('a part number wins over a name that points somewhere else', () => {
  const [match] = planCostUpdates(
    [row({ rowNumber: 1, partNumber: 'SER-E37', name: 'Bosch Fuel Filter', cost: 1310 })],
    INVENTORY
  );
  assert.equal(match.matchedBy, 'part number');
  assert.equal(match.product?.id, 'p2');
});

test('a row matching nothing is reported, never created', () => {
  const [match] = planCostUpdates([row({ rowNumber: 1, partNumber: 'XYZ-99', cost: 100 })], INVENTORY);
  assert.equal(match.outcome, 'not_found');
  assert.equal(match.product, undefined);
});

test('an ambiguous name is refused rather than guessed at', () => {
  const duplicated = [
    product({ id: 'a', name: 'Oil Filter', cost_price: 100 }),
    product({ id: 'b', name: 'oil filter', cost_price: 200 }),
  ];
  const [match] = planCostUpdates([row({ rowNumber: 1, name: 'Oil Filter', cost: 150 })], duplicated);
  assert.equal(match.outcome, 'conflict');
  assert.equal(match.product, undefined);
  assert.match(match.reason ?? '', /matches 2 different parts/);
});

test('two rows disagreeing about one part block each other instead of last-one-wins', () => {
  const matches = planCostUpdates(
    [row({ rowNumber: 1, partNumber: 'JCB-H49', cost: 6250 }), row({ rowNumber: 4, partNumber: 'jcb h49', cost: 7000 })],
    INVENTORY
  );
  assert.deepEqual(
    matches.map((m) => m.outcome),
    ['conflict', 'conflict']
  );
  assert.match(matches[0].reason ?? '', /rows 1, 4 give different costs/);
});

test('the same part repeated at the same cost is applied once, not twice', () => {
  const matches = planCostUpdates(
    [row({ rowNumber: 1, partNumber: 'JCB-H49', cost: 6250 }), row({ rowNumber: 2, partNumber: 'JCB-H49', cost: 6250 })],
    INVENTORY
  );
  assert.deepEqual(
    matches.map((m) => m.outcome),
    ['update', 'unchanged']
  );
  assert.equal(countOutcomes(matches).update, 1);
});

test('counts add up to the rows supplied, so the preview can never under-report', () => {
  const matches = planCostUpdates(
    [
      row({ rowNumber: 1, partNumber: 'JCB-H49', cost: 6250 }),
      row({ rowNumber: 2, partNumber: 'BOS-F12', cost: 430 }),
      row({ rowNumber: 3, partNumber: 'XYZ-99', cost: 100 }),
    ],
    INVENTORY
  );
  const counts = countOutcomes(matches);
  assert.deepEqual(counts, { update: 1, unchanged: 1, not_found: 1, conflict: 0 });
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), matches.length);
});

test('an empty inventory matches nothing rather than throwing', () => {
  const matches = planCostUpdates([row({ rowNumber: 1, partNumber: 'JCB-H49', cost: 1 })], []);
  assert.equal(matches[0].outcome, 'not_found');
});
