import assert from 'node:assert/strict';
import test from 'node:test';
import {
  brandLabel, cleanOtherNumbers, hasNumber, numbersOf, otherBrandsOf, partCode, partNumberUsers,
  partsAnsweringTo, sameBrand, splitNumberList,
} from '../lib/part-numbers';

test('a code ignores punctuation, spaces and case', () => {
  assert.equal(partCode('320/A7291'), '320A7291');
  assert.equal(partCode(' 320-a7291 '), '320A7291');
  assert.equal(partCode(null), '');
});

/** The same tidying the database applies (jde_clean_other_numbers), so the form shows what is kept. */
test('other numbers are tidied like the database tidies them', () => {
  assert.deepEqual(
    cleanOtherNumbers(['  ', ' abc-1 ', 'ABC1', '320/A7291', 'xyz', 'abc 1'], '320-A7291'),
    ['abc-1', 'xyz'],
  );
  assert.deepEqual(cleanOtherNumbers(null, 'X'), []);
  assert.equal(cleanOtherNumbers(Array.from({ length: 40 }, (_, i) => `N${i}`), '').length, 30);
});

/** "/" and spaces are inside real numbers here, so only commas, semicolons and lines split a list. */
test('a pasted list splits on commas and lines, never inside a number', () => {
  assert.deepEqual(splitNumberList('335/Y1458, 531-03208/09;  X 1\nY2'), ['335/Y1458', '531-03208/09', 'X 1', 'Y2']);
  assert.deepEqual(splitNumberList(' , ;'), []);
});

test('every number a part answers to', () => {
  const part = { part_number: '320/A7291', other_numbers: ['32/925694'], oem_number: '' };
  assert.deepEqual(numbersOf(part), ['320/A7291', '32/925694']);
  assert.equal(hasNumber(part, '32-925694'), true);
  assert.equal(hasNumber(part, '320a7291'), true);
  assert.equal(hasNumber(part, '---'), false);
});

test('brands compare without case or outer spaces, and no brand is a brand of its own', () => {
  assert.equal(sameBrand('JCB', ' jcb '), true);
  assert.equal(sameBrand('', null), true);
  assert.equal(sameBrand('JCB', ''), false);
  assert.equal(brandLabel(' '), 'no brand');
});

const catalogue = [
  { id: 'jcb', name: 'Water Separator', part_number: '320/A7291', brand: 'JCB', other_numbers: ['32/925694'] },
  { id: 'fg', name: 'Water Separator', part_number: '320/A7291', brand: 'Fleetguard', other_numbers: [] },
  { id: 'own', name: 'Water Separator (Sakura)', part_number: 'SFC-7932', brand: 'Sakura', other_numbers: ['32/925694'] },
  { id: 'pin', name: 'Pin', part_number: 'P00-12400', brand: '', other_numbers: [] },
];

/** One number per brand: the same brand is a clash the database refuses, another brand is fine. */
test('a part number in use is split into same-brand clashes and other brands', () => {
  const users = partNumberUsers('320-a7291', 'jcb', catalogue);
  assert.deepEqual(users.sameBrand.map((p) => p.id), ['jcb']);
  assert.deepEqual(users.otherBrands.map((p) => p.id), ['fg']);
  assert.deepEqual(partNumberUsers('320/A7291', 'Bosch', catalogue).sameBrand, []);
  // Editing a part never clashes with itself.
  assert.deepEqual(partNumberUsers('320/A7291', 'JCB', catalogue, 'jcb').sameBrand, []);
  // A blank box or bare punctuation is never a clash with every unnumbered part.
  assert.deepEqual(partNumberUsers('', '', catalogue), { sameBrand: [], otherBrands: [] });
  assert.deepEqual(partNumberUsers('---', '', catalogue), { sameBrand: [], otherBrands: [] });
});

test('the other brands of a part share one of its numbers and differ in brand', () => {
  const jcb = catalogue[0];
  assert.deepEqual(otherBrandsOf(jcb, catalogue).map((p) => p.id), ['fg', 'own']);
  assert.deepEqual(otherBrandsOf(catalogue[3], catalogue), []);
});

test('the form can say which other parts already answer to a number', () => {
  const hits = partsAnsweringTo(['32 925694', 'NEW-1'], catalogue, 'jcb');
  assert.deepEqual(hits.map((hit) => [hit.number, hit.part.id]), [['32 925694', 'own']]);
});
