import assert from 'node:assert/strict';
import test from 'node:test';
import { brandsAgree, matchImportedLine, planFieldUpdates, type MatchableProduct } from '../lib/import-matching';
import type { ImportedLine } from '../lib/client-import';

const product = (over: Partial<MatchableProduct>): MatchableProduct => ({
  id: 'x', part_number: '', other_numbers: [], oem_number: '', hsn_code: '', brand: '', name: '', cost_price: 0, current_stock: 0, ...over,
});

const line = (over: Partial<ImportedLine>): ImportedLine => ({ description: '', quantity: 1, unit_price: 100, ...over });

const jcb = product({ id: 'jcb', part_number: '320/A7291', other_numbers: ['32/925694'], brand: 'JCB', name: 'Water Separator', cost_price: 1500 });
const fleetguard = product({ id: 'fg', part_number: '320/A7291', brand: 'Fleetguard', name: 'Water Separator', cost_price: 900 });
const pin = product({ id: 'pin', part_number: 'P00-12400', name: 'PIN (12400)' });

test('brands printed differently on a bill still agree', () => {
  assert.equal(brandsAgree('JCB', 'JCB India Ltd'), true);
  assert.equal(brandsAgree('', 'Fleetguard'), true);
  assert.equal(brandsAgree('JCB', 'Fleetguard'), false);
});

test('a bill printing one of a part’s other numbers finds it', () => {
  const match = matchImportedLine(line({ description: 'water sep', part_number: '32-925694' }), [jcb, pin]);
  assert.equal(match.kind, 'exact');
  assert.equal(match.kind === 'exact' && match.product.id, 'jcb');
  assert.match(match.kind === 'exact' ? match.reason : '', /other number/);
});

/** One number kept in two brands: the brand on the bill decides, and without one the owner does. */
test('the brand on the bill picks between two brands of one number', () => {
  const match = matchImportedLine(line({ description: 'Water separator', part_number: '320/A7291', brand: 'FLEETGUARD' }), [jcb, fleetguard]);
  assert.equal(match.kind, 'exact');
  assert.equal(match.kind === 'exact' && match.product.id, 'fg');
});

test('with no brand on the bill, every brand of the number is offered', () => {
  const match = matchImportedLine(line({ description: 'Water separator', part_number: '320/A7291' }), [jcb, fleetguard]);
  assert.equal(match.kind, 'suggested');
  if (match.kind !== 'suggested') return;
  assert.deepEqual([match.product.id, ...(match.others ?? []).map((p) => p.id)], ['jcb', 'fg']);
  assert.match(match.reason, /2 brands/);
});

test('a brand not stocked under that number is asked about rather than booked into another brand', () => {
  const match = matchImportedLine(line({ description: 'Water separator', part_number: '320/A7291', brand: 'Bosch' }), [jcb]);
  assert.equal(match.kind, 'suggested');
  assert.match(match.kind === 'suggested' ? match.reason : '', /Bosch/);
});

test('a part with no brand recorded still matches a bill that names one', () => {
  const unbranded = product({ id: 'u', part_number: '320/A7291', name: 'Water Separator' });
  assert.equal(matchImportedLine(line({ description: 'x', part_number: '320/A7291', brand: 'JCB' }), [unbranded]).kind, 'exact');
});

test('two brands with the same name are not decided by the order of the list', () => {
  const match = matchImportedLine(line({ description: 'Water Separator' }), [jcb, fleetguard]);
  assert.equal(match.kind, 'suggested');
});

/** A number the supplier prints for the part becomes another of its numbers; the owner's own stays. */
test('a supplier’s own number is kept as another number, never replacing the owner’s', () => {
  const plan = planFieldUpdates(line({ description: 'Water separator', part_number: 'FS19505' }), jcb);
  assert.deepEqual(plan.fills.other_numbers, ['32/925694', 'FS19505']);
  assert.equal(plan.fills.part_number, undefined);
  assert.deepEqual(plan.conflicts, []);
  // A number it already answers to adds nothing.
  assert.equal(planFieldUpdates(line({ description: 'x', part_number: '32 925694' }), jcb).fills.other_numbers, undefined);
});

test('a made-up SP- code is still replaced by the real number on a bill', () => {
  const placeholder = product({ id: 'sp', part_number: 'SP-00267', name: 'Dipper rod' });
  const plan = planFieldUpdates(line({ description: 'Dipper rod', part_number: '123/45678' }), placeholder);
  assert.equal(plan.fills.part_number, '123/45678');
  assert.equal(plan.fills.other_numbers, undefined);
});
