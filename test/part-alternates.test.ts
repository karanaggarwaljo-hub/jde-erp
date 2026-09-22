import assert from 'node:assert/strict';
import test from 'node:test';
import { coreName, findAlternates, type AlternatePart } from '../lib/part-alternates';

const part = (overrides: Partial<AlternatePart> & { id: string; name: string }): AlternatePart => ({
  part_number: '', oem_number: '', brand: '', category: '', compatibility: '', current_stock: 0, sale_price: 0,
  ...overrides,
});

// Real entries from Jai Durga Enterprises' inventory.
const PINION_SEAL = part({ id: 'sp244', part_number: 'SP-00244', name: 'PInion seal', category: 'Seals', current_stock: 49 });
const PINION_SEAL_ORIGINAL = part({ id: 'pinsl1', part_number: 'PIN-SL1', name: 'Pinion seal (orignal)', category: 'Seals', current_stock: 1 });
const MASTER_CYLINDER = part({ id: 'mas82', part_number: 'MAS-C82', name: 'master cylinder', category: 'Brakes', current_stock: 10 });
const MASTER_CYLINDER_ORIGINAL = part({ id: 'mas83', part_number: 'MAS-C83', name: 'master cylinder orignal', category: 'Brakes', current_stock: 2 });
const PUMP_3D = part({ id: 'cha11', part_number: '20-900400', name: 'charging pump 3D', category: 'Pumps', compatibility: 'JCB 3D', current_stock: 2 });
const PUMP_3DX = part({ id: 'cha10', part_number: '20-925552', name: 'charging pump 3DX', category: 'Pumps', compatibility: 'JCB 3DX', current_stock: 8 });

const CATALOGUE = [PINION_SEAL, PINION_SEAL_ORIGINAL, MASTER_CYLINDER, MASTER_CYLINDER_ORIGINAL, PUMP_3D, PUMP_3DX];

test('an "(orignal)" of the same part is offered as the same part twice over', () => {
  const [match] = findAlternates(PINION_SEAL, CATALOGUE);
  assert.equal(match.part.id, 'pinsl1');
  assert.equal(match.why, 'same part, different entry');
});

test('the make word is ignored wherever it sits in the name', () => {
  assert.equal(coreName('master cylinder orignal'), 'master cylinder');
  assert.equal(coreName('Pinion seal (orignal)'), 'pinion seal');
  const [match] = findAlternates(MASTER_CYLINDER, CATALOGUE);
  assert.equal(match.part.id, 'mas83');
});

test('a different machine is never offered as a substitute', () => {
  // "charging pump 3D" and "charging pump 3DX" are two machines, not two makes of one part.
  assert.deepEqual(findAlternates(PUMP_3D, CATALOGUE).map((match) => match.part.id), []);
});

test('a part is never its own alternative', () => {
  assert.ok(!findAlternates(PINION_SEAL, CATALOGUE).some((match) => match.part.id === PINION_SEAL.id));
});

test('a shared number is the strongest reason, however it is punctuated', () => {
  const pin = part({ id: 'pin', part_number: '911-12400', name: 'bkt main pin' });
  const other = part({ id: 'other', part_number: 'BKT-M999', oem_number: '911 12400', name: 'bucket pin (old stock)' });
  const [match] = findAlternates(pin, [other]);
  assert.equal(match.why, 'same number');
  assert.match(match.detail, /911 12400/);
});

test('same category and same machine counts when the names overlap', () => {
  const filter = part({ id: 'a', name: 'air filter assembly 2014', category: 'Filters', compatibility: 'JCB 3DX', part_number: '32-920100' });
  const other = part({ id: 'b', name: 'air filter jcb 2012', category: 'Filters', compatibility: 'JCB 3DX', part_number: 'AIR-F90' });
  const [match] = findAlternates(filter, [other]);
  assert.equal(match.why, 'fits the same machine');
  assert.match(match.detail, /Filters for JCB 3DX/);
});

test('unrelated parts are not offered, and the list is capped', () => {
  const tyre = part({ id: 'tyre', name: 'front tyre', category: 'Tyres' });
  assert.deepEqual(findAlternates(tyre, CATALOGUE), []);
  const many = Array.from({ length: 12 }, (_, index) => part({ id: 'x' + index, name: 'stearing coupling', category: 'Steering' }));
  assert.equal(findAlternates(part({ id: 'me', name: 'stearing coupling', category: 'Steering' }), many).length, 8);
});
