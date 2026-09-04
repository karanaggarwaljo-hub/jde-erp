import assert from 'node:assert/strict';
import test from 'node:test';
import { compatibilitySuggestions, matchesProductSearch } from '../lib/product-search';

/** The nine compatibility values actually on file, spellings and all. */
const REAL_COMPATIBILITY = [
  'Jcb 3dx', 'N/m bs4', 'with parker hydraulic pump', 'jcb bs4 & 5 (one more filter)',
  'JCB', 'N/M bs4', 'JCB bs 2 & 3', 'JCB N/M (bs4)', 'Jcb BS4 & 5 in n/m',
];

const part = (over: Partial<Parameters<typeof matchesProductSearch>[0]> = {}) => ({
  name: 'air filter', part_number: '', oem_number: '', brand: '', compatibility: '', category: '', ...over,
});

test('an empty search matches everything', () => {
  assert.equal(matchesProductSearch(part(), ''), true);
  assert.equal(matchesProductSearch(part(), '   '), true);
});

test('the fields that already worked still work', () => {
  assert.equal(matchesProductSearch(part({ name: 'Air Filter JCB 2012' }), 'filter'), true);
  assert.equal(matchesProductSearch(part({ brand: 'Bosch' }), 'bosch'), true);
  assert.equal(matchesProductSearch(part({ part_number: '331/34392' }), '34392'), true);
  assert.equal(matchesProductSearch(part({ oem_number: 'RE504836' }), 're5048'), true);
  assert.equal(matchesProductSearch(part({ name: 'brake pad' }), 'clutch'), false);
});

/** The gap this closes: compatibility was not searched at all. */
test('a machine model finds the parts that fit it', () => {
  assert.equal(matchesProductSearch(part({ compatibility: 'Jcb 3dx' }), '3dx'), true);
  assert.equal(matchesProductSearch(part({ compatibility: 'Jcb 3dx' }), 'JCB'), true);
});

test('the same machine spelled differently is all found by one search', () => {
  // "BS4" must reach every one of these, however the owner happened to type it.
  const fitsBs4 = ['N/m bs4', 'N/M bs4', 'JCB N/M (bs4)', 'Jcb BS4 & 5 in n/m'];
  for (const compatibility of fitsBs4) {
    assert.equal(matchesProductSearch(part({ compatibility }), 'BS4'), true, compatibility);
    assert.equal(matchesProductSearch(part({ compatibility }), 'bs 4'), true, compatibility);
    assert.equal(matchesProductSearch(part({ compatibility }), 'bs-4'), true, compatibility);
  }
});

test('searching n/m finds it however the slash was typed', () => {
  for (const compatibility of ['N/m bs4', 'JCB N/M (bs4)', 'Jcb BS4 & 5 in n/m']) {
    assert.equal(matchesProductSearch(part({ compatibility }), 'nm'), true, compatibility);
    assert.equal(matchesProductSearch(part({ compatibility }), 'n/m'), true, compatibility);
  }
});

test('a part number typed with the wrong separator still finds the part', () => {
  const p = part({ part_number: '331/34392' });
  assert.equal(matchesProductSearch(p, '331-34392'), true);
  assert.equal(matchesProductSearch(p, '331 34392'), true);
  assert.equal(matchesProductSearch(p, '33134392'), true);
});

test('a compatibility note that is prose is still searchable as written', () => {
  assert.equal(matchesProductSearch(part({ compatibility: 'with parker hydraulic pump' }), 'parker'), true);
});

/** A search of nothing but punctuation would squash to empty, which every part "contains". */
test('a punctuation-only search does not match everything', () => {
  assert.equal(matchesProductSearch(part({ part_number: '331/34392' }), '///'), false);
  assert.equal(matchesProductSearch(part({ name: 'filter' }), '---'), false);
});

test('searching still misses what genuinely does not fit', () => {
  assert.equal(matchesProductSearch(part({ compatibility: 'Jcb 3dx' }), 'tata'), false);
  assert.equal(matchesProductSearch(part({ compatibility: 'JCB bs 2 & 3' }), 'bs4'), false);
});

// ── Suggestions ──────────────────────────────────────────────────────────────────────────────

test('suggestions collapse the same machine spelled several ways into one', () => {
  const products = REAL_COMPATIBILITY.map((compatibility) => part({ compatibility }));
  const suggestions = compatibilitySuggestions(products);

  // "N/m bs4" and "N/M bs4" are one entry, not two.
  const nmBs4 = suggestions.filter((s) => s.toLowerCase().replace(/[^a-z0-9]/g, '') === 'nmbs4');
  assert.equal(nmBs4.length, 1, `expected one spelling of N/M BS4, got ${JSON.stringify(nmBs4)}`);
  assert.equal(suggestions.includes('Jcb 3dx'), true);
  assert.equal(suggestions.includes('with parker hydraulic pump'), true);
});

test('the most-used spelling is offered first', () => {
  const products = [
    part({ compatibility: 'Jcb 3dx' }),
    part({ compatibility: 'JCB N/M (bs4)' }),
    part({ compatibility: 'jcb n/m bs4' }),
    part({ compatibility: 'JCB-N/M-BS4' }),
  ];
  assert.equal(compatibilitySuggestions(products)[0], 'JCB N/M (bs4)', 'three parts share that machine');
});

test('parts with nothing filled in contribute no suggestions', () => {
  assert.deepEqual(compatibilitySuggestions([part(), part({ compatibility: '   ' })]), []);
});

test('the suggestion list is capped', () => {
  const products = Array.from({ length: 100 }, (_, i) => part({ compatibility: `Machine ${i}` }));
  assert.equal(compatibilitySuggestions(products, 30).length, 30);
});
