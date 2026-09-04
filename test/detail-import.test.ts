import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countDetailOutcomes,
  fieldsToWrite,
  looksLikeAnInventedCode,
  planDetailUpdates,
  type DetailMatchProduct,
} from '../lib/detail-import';
import type { ImportedProduct } from '../lib/client-import';

function row(partial: Partial<ImportedProduct>): ImportedProduct {
  return {
    part_number: '', oem_number: '', hsn_code: '', name: '', brand: '', category: '',
    compatibility: '', cost_price: 0, mrp: 0, sale_price: 0, current_stock: 0, min_stock: 0, location: '',
    ...partial,
  };
}

function product(partial: Partial<DetailMatchProduct> & { id: string; name: string }): DetailMatchProduct {
  return { part_number: '', oem_number: '', ...partial };
}

// ── Telling an invented code from a real one ────────────────────────────────────────────────

test('the shop’s own generated codes are recognised', () => {
  // Every one of these is real, taken from the live inventory.
  for (const code of ['SP-053', 'SP-004', 'SP-00246', 'AIR-F90', 'STI-B168', 'STA-A27', 'BRA-R138', 'SMA-P18', 'JCB-E47', 'MA-M44']) {
    assert.equal(looksLikeAnInventedCode(code), true, code);
  }
});

test('a code typed with a stray space is recognised too', () => {
  for (const code of ['HP -G39', 'DA -W194', 'SLE- 98', '10 -B76']) {
    assert.equal(looksLikeAnInventedCode(code), true, code);
  }
});

/** The expensive mistake would be offering to overwrite a genuine manufacturer number. */
test('real manufacturer numbers are never mistaken for invented ones', () => {
  for (const code of ['331/34392', '335/Y7275', '335/Y2746', 'P00-12400', '32/925994', '02/630151', 'RE504836', '1R-0750']) {
    assert.equal(looksLikeAnInventedCode(code), false, code);
  }
});

test('an empty code is not an invented one', () => {
  assert.equal(looksLikeAnInventedCode(''), false);
  assert.equal(looksLikeAnInventedCode('   '), false);
});

// ── Planning what a document would change ───────────────────────────────────────────────────

test('a blank field is filled in from the document', () => {
  const products = [product({ id: 'p1', name: 'air filter jcb 2012' })];
  const [match] = planDetailUpdates([row({ name: 'Air Filter JCB 2012', part_number: '32/925994', hsn_code: '84213100' })], products);

  assert.equal(match.outcome, 'update');
  assert.equal(match.matchedBy, 'name');
  assert.deepEqual(
    match.changes.map((c) => [c.field, c.kind, c.from, c.to]),
    [['part_number', 'fill', '', '32/925994'], ['hsn_code', 'fill', '', '84213100']]
  );
});

/** The whole reason this exists. */
test('an invented part number is offered for replacement, shown as old to new', () => {
  const products = [product({ id: 'p1', name: 'air filter jcb 2012', part_number: 'AIR-F90' })];
  const [match] = planDetailUpdates([row({ name: 'air filter jcb 2012', part_number: '32/925994' })], products);

  assert.equal(match.outcome, 'update');
  const change = match.changes.find((c) => c.field === 'part_number')!;
  assert.equal(change.kind, 'replace');
  assert.equal(change.from, 'AIR-F90');
  assert.equal(change.to, '32/925994');
});

test('a real part number already on file is never overwritten automatically', () => {
  const products = [product({ id: 'p1', name: 'cab mounting', part_number: '331/34392' })];
  const [match] = planDetailUpdates([row({ name: 'cab mounting', part_number: '331/99999' })], products);

  const change = match.changes.find((c) => c.field === 'part_number')!;
  assert.equal(change.kind, 'keep', 'a genuine number must not be replaced on a document’s say-so');
  assert.equal(match.outcome, 'nothing_to_add', 'and there is nothing here worth writing');
});

test('a brand or category that disagrees is flagged, never replaced', () => {
  const products = [product({ id: 'p1', name: 'oil filter', brand: 'Bosch' })];
  const [match] = planDetailUpdates([row({ name: 'oil filter', brand: 'Mahle' })], products);
  assert.equal(match.changes.find((c) => c.field === 'brand')!.kind, 'keep');
});

test('the same value written differently is not treated as a change', () => {
  const products = [product({ id: 'p1', name: 'cab mounting', part_number: '331/34392' })];
  const [match] = planDetailUpdates([row({ name: 'cab mounting', part_number: '331-34392' })], products);
  assert.equal(match.changes.length, 0);
  assert.equal(match.outcome, 'nothing_to_add');
});

test('a part the document does not cover is left completely alone', () => {
  const products = [product({ id: 'p1', name: 'brake pad' })];
  const [match] = planDetailUpdates([row({ name: 'something else entirely', part_number: 'X1' })], products);
  assert.equal(match.outcome, 'not_found');
  assert.deepEqual(match.changes, []);
});

test('an ambiguous name is reported, not guessed at', () => {
  const products = [product({ id: 'p1', name: 'oil filter' }), product({ id: 'p2', name: 'Oil Filter' })];
  const [match] = planDetailUpdates([row({ name: 'oil filter', part_number: '32/925994' })], products);
  assert.equal(match.outcome, 'conflict');
  assert.match(match.reason!, /2 different parts/);
  assert.deepEqual(match.changes, []);
});

test('two rows pointing at one part cancel each other rather than racing', () => {
  const products = [product({ id: 'p1', name: 'oil filter' })];
  const matches = planDetailUpdates(
    [row({ name: 'oil filter', part_number: 'AAA' }), row({ name: 'Oil  Filter', part_number: 'BBB' })],
    products
  );
  assert.ok(matches.every((m) => m.outcome === 'conflict'), 'neither may win silently');
  assert.ok(matches.every((m) => m.changes.length === 0));
});

test('matching prefers a part number over a name', () => {
  const products = [
    product({ id: 'p1', name: 'filter', part_number: '32/925994' }),
    product({ id: 'p2', name: 'air filter jcb' }),
  ];
  const [match] = planDetailUpdates([row({ name: 'air filter jcb', part_number: '32/925994', brand: 'JCB' })], products);
  assert.equal(match.matchedBy, 'part number');
  assert.equal(match.product!.id, 'p1');
});

// ── What actually gets written ──────────────────────────────────────────────────────────────

test('only ticked changes are written, and a flagged conflict never is', () => {
  const products = [product({ id: 'p1', name: 'filter', part_number: 'AIR-F90', brand: 'Bosch' })];
  const [match] = planDetailUpdates(
    [row({ name: 'filter', part_number: '32/925994', hsn_code: '84213100', brand: 'Mahle' })],
    products
  );

  const all = fieldsToWrite(match, () => true);
  assert.deepEqual(all, { part_number: '32/925994', hsn_code: '84213100' }, 'the disagreeing brand is excluded');

  const onlyFills = fieldsToWrite(match, (change) => change.kind === 'fill');
  assert.deepEqual(onlyFills, { hsn_code: '84213100' }, 'unticking the replacement leaves the fill');

  assert.deepEqual(fieldsToWrite(match, () => false), {}, 'nothing ticked writes nothing');
});

test('the summary counts every row exactly once', () => {
  const products = [product({ id: 'p1', name: 'a' }), product({ id: 'p2', name: 'b', part_number: '331/34392' })];
  const matches = planDetailUpdates(
    [
      row({ name: 'a', part_number: '32/925994' }),
      row({ name: 'b', part_number: '331/34392' }),
      row({ name: 'unknown part', part_number: 'Z9' }),
    ],
    products
  );
  const counts = countDetailOutcomes(matches);
  assert.equal(counts.update, 1);
  assert.equal(counts.nothing_to_add, 1);
  assert.equal(counts.not_found, 1);
  assert.equal(counts.conflict, 0);
  assert.equal(counts.update + counts.nothing_to_add + counts.not_found + counts.conflict, matches.length);
});

/** Nothing in this feature may touch stock or money. */
test('no price or stock field is ever part of a plan', () => {
  const products = [product({ id: 'p1', name: 'filter' })];
  const [match] = planDetailUpdates(
    [row({ name: 'filter', part_number: '32/925994', cost_price: 999, sale_price: 1200, current_stock: 50, mrp: 1500 })],
    products
  );
  const written = fieldsToWrite(match, () => true);
  for (const forbidden of ['cost_price', 'sale_price', 'current_stock', 'mrp', 'min_stock']) {
    assert.equal(forbidden in written, false, `${forbidden} must never be written by this tool`);
  }
  assert.deepEqual(Object.keys(written), ['part_number']);
});
