import assert from 'node:assert/strict';
import test from 'node:test';
import { exactCodeMatches, isAmbiguousCode, normalizeCode, scannedPart, searchParts } from '../lib/part-search';
import type { PartOption } from '../lib/sales-types';

function part(partNumber: string, name: string, extra: Partial<PartOption> = {}): PartOption {
  return {
    value: `${partNumber} - ${name}`,
    partNumber,
    name,
    brand: '',
    price: 100,
    costPrice: 60,
    stock: 5,
    hsn: '8708',
    category: 'general',
    ...extra,
  };
}

const CATALOGUE: PartOption[] = [
  part('P00-12400', 'PIN (12400)'),
  part('SP-258', 'STEARING COUPLING 3DX'),
  part('SP-258', 'DIPPER ROD 3DX'),
  part('SP-258', 'TIPPING LEVER 3DX'),
  part('803149/10', 'BIG PINION BEARING', { brand: 'SKF' }),
  part('PG-77', 'PLANTARY GRARI', { stock: 0 }),
];

test('a part number typed with different punctuation still finds the part', () => {
  for (const typed of ['P00-12400', 'p0012400', 'P00 12400', 'p00/12400']) {
    const [top] = searchParts(typed, CATALOGUE);
    assert.equal(top.part.name, 'PIN (12400)', `failed for "${typed}"`);
    assert.equal(top.why, 'exact-code');
  }
});

test('normalizeCode strips everything that is not a letter or digit', () => {
  assert.equal(normalizeCode('P00-12400'), 'P0012400');
  assert.equal(normalizeCode('803149/10'), '80314910');
  assert.equal(normalizeCode('  sp 258 '), 'SP258');
});

test('loose words match in any order', () => {
  // Nobody remembers the catalogue word order; "bearing pinion" has to find "BIG PINION BEARING".
  const [top] = searchParts('bearing pinion', CATALOGUE);
  assert.equal(top.part.name, 'BIG PINION BEARING');
  assert.equal(top.why, 'all-words');
});

test('a name search finds the part without its number', () => {
  const [top] = searchParts('stearing', CATALOGUE);
  assert.equal(top.part.name, 'STEARING COUPLING 3DX');
});

test('a brand finds its parts', () => {
  const results = searchParts('skf', CATALOGUE);
  assert.equal(results.length, 1);
  assert.equal(results[0].part.name, 'BIG PINION BEARING');
});

test('a shared part number returns every part carrying it', () => {
  // SP-258 really is on three different products in the live catalogue.
  const results = searchParts('SP-258', CATALOGUE);
  assert.equal(results.length, 3);
  assert.ok(results.every((match) => match.why === 'exact-code'));
});

test('out of stock is ranked last but never hidden', () => {
  // Ordering a part in is a normal sale here, so it must still be findable.
  const results = searchParts('3dx', CATALOGUE);
  assert.ok(results.length > 0);
  const grari = searchParts('grari', CATALOGUE);
  assert.equal(grari.length, 1);
  assert.equal(grari[0].part.stock, 0);
});

test('an in-stock part outranks an out-of-stock one on an equal match', () => {
  const catalogue = [
    part('AA-1', 'FILTER', { stock: 0 }),
    part('BB-2', 'FILTER', { stock: 3 }),
  ];
  const [top] = searchParts('filter', catalogue);
  assert.equal(top.part.partNumber, 'BB-2');
});

test('an empty query offers nothing rather than the whole catalogue', () => {
  assert.deepEqual(searchParts('', CATALOGUE), []);
  assert.deepEqual(searchParts('   ', CATALOGUE), []);
});

test('the shortlist is capped', () => {
  const many = Array.from({ length: 40 }, (_, i) => part(`X-${i}`, `WASHER ${i}`));
  assert.equal(searchParts('washer', many).length, 8);
  assert.equal(searchParts('washer', many, 3).length, 3);
});

test('a scan resolves an unambiguous code', () => {
  assert.equal(scannedPart('p0012400', CATALOGUE)?.name, 'PIN (12400)');
  assert.equal(scannedPart('803149/10', CATALOGUE)?.name, 'BIG PINION BEARING');
});

test('a scan refuses to guess when a code is on more than one part', () => {
  // Billing whichever SP-258 happened to sort first is the mistake that reaches a customer.
  assert.equal(scannedPart('SP-258', CATALOGUE), null);
});

test('a scan of something unknown resolves to nothing', () => {
  assert.equal(scannedPart('ZZ-999', CATALOGUE), null);
  assert.equal(scannedPart('', CATALOGUE), null);
});

test('a code shared by several parts is reported as ambiguous', () => {
  // The picker uses this to refuse to resolve Enter on its own, so a scan of SP-258 leaves the
  // list open and waits for a real choice instead of billing whichever sorted first.
  assert.equal(isAmbiguousCode('SP-258', CATALOGUE), true);
  assert.equal(isAmbiguousCode('sp258', CATALOGUE), true);
});

test('a code on exactly one part is not ambiguous', () => {
  assert.equal(isAmbiguousCode('P00-12400', CATALOGUE), false);
  assert.equal(isAmbiguousCode('803149/10', CATALOGUE), false);
});

test('a name search is never treated as an ambiguous code', () => {
  assert.equal(isAmbiguousCode('3dx', CATALOGUE), false);
  assert.equal(isAmbiguousCode('', CATALOGUE), false);
});

test('exactCodeMatches returns every part carrying the code', () => {
  assert.equal(exactCodeMatches('sp 258', CATALOGUE).length, 3);
  assert.equal(exactCodeMatches('p0012400', CATALOGUE).length, 1);
  assert.deepEqual(exactCodeMatches('nope', CATALOGUE), []);
});
