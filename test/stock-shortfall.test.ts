import assert from 'node:assert/strict';
import test from 'node:test';
import { heldByProduct, shortfallNotice, stockShortfalls } from '../lib/stock-shortfall';

const stock = new Map([['coupling', 0], ['grease', 20], ['bearing', 3]]);

/** How STEARING COUPLING 3DX reached −1: one sold with none on the shelf. */
test('a part sold with nothing on the shelf is named', () => {
  assert.deepEqual(
    stockShortfalls([{ productId: 'coupling', label: 'SP-00268 STEARING COUPLING 3DX', qty: 1 }], stock),
    [{ label: 'SP-00268 STEARING COUPLING 3DX', available: 0, selling: 1 }]
  );
});

test('a sale within the stock on the shelf raises nothing', () => {
  assert.deepEqual(stockShortfalls([{ productId: 'grease', label: 'PET-G52', qty: 20 }], stock), []);
});

test('the same part on two lines is judged on its total', () => {
  const lines = [
    { productId: 'bearing', label: 'BEA-320', qty: 2 },
    { productId: 'bearing', label: 'BEA-320', qty: 2 },
  ];
  assert.deepEqual(stockShortfalls(lines, stock), [{ label: 'BEA-320', available: 3, selling: 4 }]);
});

/** Saving an invoice again gives back what it already took before drawing the new lines. */
test('an edit counts what the invoice already holds as on the shelf', () => {
  const held = heldByProduct([{ product_id: 'bearing', qty: 2 }, { product_id: null, qty: 5 }]);
  assert.deepEqual(stockShortfalls([{ productId: 'bearing', label: 'BEA-320', qty: 5 }], stock, held), []);
  assert.equal(stockShortfalls([{ productId: 'bearing', label: 'BEA-320', qty: 6 }], stock, held).length, 1);
});

test('lines with no part picked, or no quantity, are left alone', () => {
  const lines = [
    { productId: null, label: 'typed text', qty: 9 },
    { productId: 'coupling', label: 'SP-00268', qty: 0 },
  ];
  assert.deepEqual(stockShortfalls(lines, stock), []);
});

test('a part missing from the stock list counts as none on the shelf', () => {
  assert.equal(stockShortfalls([{ productId: 'unknown', label: 'X', qty: 1 }], stock)[0].available, 0);
});

test('the notice names each part with its stock and what is being sold', () => {
  const one = shortfallNotice([{ label: 'SP-00268 STEARING COUPLING 3DX', available: 0, selling: 1 }]);
  assert.match(one, /^This part does not have enough stock:/);
  assert.match(one, /SP-00268 STEARING COUPLING 3DX — 0 in stock, selling 1/);
  assert.match(one, /Its stock will go below zero/);

  const two = shortfallNotice([
    { label: 'A', available: -1, selling: 2 },
    { label: 'B', available: 1.5, selling: 2.25 },
  ]);
  assert.match(two, /^These parts do not have enough stock:/);
  assert.match(two, /A — -1 in stock, selling 2/);
  assert.match(two, /B — 1\.5 in stock, selling 2\.25/);
  assert.match(two, /Their stock will go below zero/);
});
