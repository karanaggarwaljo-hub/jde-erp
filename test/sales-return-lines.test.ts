import assert from 'node:assert/strict';
import test from 'node:test';
import { damagedUnits, parseReturnLines } from '../lib/sales-return-lines';

const line = (over: Record<string, unknown> = {}) => ({ invoice_item_id: 'a', qty: 1, ...over });

test('a plain return line is read as resellable, because most returns are', () => {
  const parsed = parseReturnLines([line()]);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.lines, [{ invoice_item_id: 'a', qty: 1, condition: 'resellable' }]);
});

/** The whole point of the condition: damaged goods still credit the customer, but they must not
 *  reappear on the shelf to be sold to somebody else. */
test('damaged is carried through exactly as given', () => {
  const parsed = parseReturnLines([line({ condition: 'damaged' })]);
  assert.ok(parsed.ok);
  assert.equal(parsed.lines[0].condition, 'damaged');
});

/** Only the one word changes behaviour. Anything else — a typo, a null, a number — must fall back
 *  to resellable, so a malformed request can never quietly stop stock being restored. */
test('any other condition falls back to resellable rather than silently withholding stock', () => {
  for (const value of ['DAMAGED', 'broken', '', null, undefined, 0, true, { damaged: true }]) {
    const parsed = parseReturnLines([line({ condition: value })]);
    assert.ok(parsed.ok);
    assert.equal(parsed.lines[0].condition, 'resellable', `${JSON.stringify(value)} should not read as damaged`);
  }
});

// ── Quantities ───────────────────────────────────────────────────────────────────────────────

test('a fraction of a unit cannot come back', () => {
  assert.equal(parseReturnLines([line({ qty: 1.5 })]).ok, false);
});

test('a negative quantity is refused rather than credited', () => {
  assert.equal(parseReturnLines([line({ qty: -2 })]).ok, false);
});

test('zero is nothing to return', () => {
  assert.equal(parseReturnLines([line({ qty: 0 })]).ok, false);
});

test('an unreadable quantity is refused', () => {
  assert.equal(parseReturnLines([line({ qty: 'two' })]).ok, false);
  assert.equal(parseReturnLines([line({ qty: null })]).ok, false);
});

/** A return that silently credits fewer goods than the person selected is worse than one that
 *  fails outright — they would have no way of knowing a line was dropped. */
test('one bad line fails the whole request instead of quietly dropping it', () => {
  const parsed = parseReturnLines([line({ invoice_item_id: 'a' }), line({ invoice_item_id: 'b', qty: -1 })]);
  assert.equal(parsed.ok, false);
  assert.match((parsed as { error: string }).error, /whole-number/);
});

test('the same invoice line twice is refused, so it cannot be returned twice over', () => {
  const parsed = parseReturnLines([line({ invoice_item_id: 'a' }), line({ invoice_item_id: 'a' })]);
  assert.equal(parsed.ok, false);
  assert.match((parsed as { error: string }).error, /only once/);
});

test('an empty or missing list is nothing to do', () => {
  assert.equal(parseReturnLines([]).ok, false);
  assert.equal(parseReturnLines(undefined).ok, false);
  assert.equal(parseReturnLines('not a list').ok, false);
});

test('a line with no invoice item behind it is refused', () => {
  assert.equal(parseReturnLines([{ qty: 1 }]).ok, false);
});

// ── What will not go back on the shelf ───────────────────────────────────────────────────────

test('damaged units are counted across lines, by quantity and not by line', () => {
  const parsed = parseReturnLines([
    line({ invoice_item_id: 'a', qty: 3, condition: 'damaged' }),
    line({ invoice_item_id: 'b', qty: 2, condition: 'resellable' }),
    line({ invoice_item_id: 'c', qty: 4, condition: 'damaged' }),
  ]);
  assert.ok(parsed.ok);
  assert.equal(damagedUnits(parsed.lines), 7);
});

test('a return with nothing damaged counts none', () => {
  const parsed = parseReturnLines([line({ qty: 5 })]);
  assert.ok(parsed.ok);
  assert.equal(damagedUnits(parsed.lines), 0);
});
