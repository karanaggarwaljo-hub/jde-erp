import assert from 'node:assert/strict';
import test from 'node:test';
import { planPartMerge, type MergeablePart } from '../lib/part-merge';

const part = (overrides: Partial<MergeablePart>): MergeablePart => ({
  id: 'x', part_number: '', oem_number: '', hsn_code: '', name: '', brand: '', category: '',
  compatibility: '', location: '', cost_price: 0, mrp: 0, sale_price: 0, current_stock: 0, min_stock: 0,
  ...overrides,
});

// The real pair, as it sits in Jai Durga Enterprises' inventory: one entry holds the stock, the
// other holds the sale.
const BKT_MAIN_PIN = part({
  id: 'bkt', part_number: 'BKT-M227', name: 'bkt main pin', category: 'Pins & Bushes',
  cost_price: 440, sale_price: 0, current_stock: 20,
});
const PIN_12400 = part({
  id: 'pin', part_number: '911-12400', name: 'PIN (12400)', category: 'Pins & Bushes', brand: 'Rokryder',
  compatibility: 'JCB 3D/3DX', cost_price: 390, sale_price: 390, current_stock: '-5',
});

test('the two stock counts add up: 20 on the shelf and −5 sold become 15', () => {
  assert.equal(planPartMerge(BKT_MAIN_PIN, PIN_12400).stockAfter, 15);
});

test('the real JCB number is suggested over the code the ERP made up, whichever entry is kept', () => {
  const plan = planPartMerge(BKT_MAIN_PIN, PIN_12400);
  assert.deepEqual(plan.numberChoices, ['BKT-M227', '911-12400']);
  assert.equal(plan.defaultNumber, '911-12400');
  assert.equal(planPartMerge(PIN_12400, BKT_MAIN_PIN).defaultNumber, '911-12400');
});

test('only details the kept part is blank on come across, and the name never does', () => {
  const plan = planPartMerge(BKT_MAIN_PIN, PIN_12400);
  const byField = Object.fromEntries(plan.fills.map((fill) => [fill.field, fill.value]));
  assert.deepEqual(byField, { brand: 'Rokryder', compatibility: 'JCB 3D/3DX', sale_price: '390' });
  assert.ok(!plan.fills.some((fill) => fill.field === 'cost_price'), 'the kept part already has a cost');
  assert.ok(!plan.fills.some((fill) => fill.field === 'name'));
});

test('two made-up codes keep the kept part’s own', () => {
  const coupling = part({ id: 'c140', part_number: 'STE-C140', name: 'stearing coupling', current_stock: 5, cost_price: 350 });
  const coupling3dx = part({ id: 'c268', part_number: 'SP-00268', name: 'STEARING COUPLING 3DX', current_stock: -1, cost_price: 250 });
  const plan = planPartMerge(coupling, coupling3dx);
  assert.equal(plan.defaultNumber, 'STE-C140');
  assert.equal(plan.stockAfter, 4);
});

test('two real numbers keep the kept part’s own, but both are offered', () => {
  const plan = planPartMerge(part({ part_number: '32-920100' }), part({ part_number: '32-915801/02' }));
  assert.equal(plan.defaultNumber, '32-920100');
  assert.deepEqual(plan.numberChoices, ['32-920100', '32-915801/02']);
});

test('the same number written differently is one choice, and no number at all is none', () => {
  assert.deepEqual(planPartMerge(part({ part_number: 'abc-1' }), part({ part_number: ' ABC-1 ' })).numberChoices, ['abc-1']);
  const blank = planPartMerge(part({}), part({}));
  assert.deepEqual(blank.numberChoices, []);
  assert.equal(blank.defaultNumber, '');
});

test('a kept part with no number takes the duplicate’s', () => {
  assert.equal(planPartMerge(part({}), part({ part_number: 'SP-00244' })).defaultNumber, 'SP-00244');
});

test('the kept part’s own details are never overwritten', () => {
  const plan = planPartMerge(
    part({ brand: 'JCB', compatibility: 'JCB 3DX', sale_price: 650, min_stock: 2 }),
    part({ brand: 'Rokryder', compatibility: 'JCB 3D', sale_price: 390, min_stock: 5 }),
  );
  assert.deepEqual(plan.fills, []);
});
