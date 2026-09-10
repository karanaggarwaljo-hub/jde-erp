import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fifoCostLookup, stockCountMismatches, stockValueOf, totalStockValue,
  type StockLayerLike, type ValuedProduct,
} from '../lib/stock-value';

const part = (over: Partial<ValuedProduct> = {}): ValuedProduct =>
  ({ id: 'P1', current_stock: 0, cost_price: 0, ...over });

const batch = (over: Partial<StockLayerLike> = {}): StockLayerLike =>
  ({ product_id: 'P1', unit_cost: 0, qty_remaining: 0, created_at: '2026-01-01T00:00:00Z', ...over });

/** The bug this replaces. Ten bought at ₹100 and ten at ₹200 are worth ₹3,000, but valuing all
 *  twenty at the oldest open batch reported ₹2,000 — a third of the value simply missing. */
test('stock bought at two prices is worth what both batches cost', () => {
  const layers = [
    batch({ unit_cost: 100, qty_remaining: 10, created_at: '2026-01-01T00:00:00Z' }),
    batch({ unit_cost: 200, qty_remaining: 10, created_at: '2026-02-01T00:00:00Z' }),
  ];
  assert.equal(stockValueOf(part({ current_stock: 20, cost_price: 100 }), layers), 3000);
});

test('one batch is still just quantity times its cost', () => {
  const layers = [batch({ unit_cost: 150, qty_remaining: 4 })];
  assert.equal(stockValueOf(part({ current_stock: 4, cost_price: 999 }), layers), 600);
});

test('a part with no batches at all falls back to its cost price', () => {
  assert.equal(stockValueOf(part({ current_stock: 5, cost_price: 80 }), []), 400);
});

/** Stock is not free. A batch recorded at ₹0 means the price was never captured, and valuing it
 *  at nothing is how ₹27,970 of oil once came to be declared worthless. */
test('a batch with no cost recorded falls back to the cost price rather than valuing at nothing', () => {
  const layers = [batch({ unit_cost: 0, qty_remaining: 6 })];
  assert.equal(stockValueOf(part({ current_stock: 6, cost_price: 50 }), layers), 300);
});

test('a priced batch and an unpriced one are each valued their own way', () => {
  const layers = [
    batch({ unit_cost: 100, qty_remaining: 2, created_at: '2026-01-01T00:00:00Z' }),
    batch({ unit_cost: 0, qty_remaining: 3, created_at: '2026-02-01T00:00:00Z' }),
  ];
  assert.equal(stockValueOf(part({ current_stock: 5, cost_price: 10 }), layers), 200 + 30);
});

test('stock beyond what the batches cover is valued at the cost price', () => {
  const layers = [batch({ unit_cost: 100, qty_remaining: 3 })];
  assert.equal(stockValueOf(part({ current_stock: 5, cost_price: 40 }), layers), 300 + 80);
});

/** Valuing units the shelf does not claim to have would overstate the total. */
test('batch quantity beyond the stock count is left out, oldest units counted first', () => {
  const layers = [
    batch({ unit_cost: 100, qty_remaining: 5, created_at: '2026-01-01T00:00:00Z' }),
    batch({ unit_cost: 200, qty_remaining: 5, created_at: '2026-02-01T00:00:00Z' }),
  ];
  assert.equal(stockValueOf(part({ current_stock: 6, cost_price: 1 }), layers), 500 + 200);
});

test('a part with nothing on the shelf is worth nothing, whatever its batches say', () => {
  const layers = [batch({ unit_cost: 100, qty_remaining: 4 })];
  assert.equal(stockValueOf(part({ current_stock: 0, cost_price: 90 }), layers), 0);
  assert.equal(stockValueOf(part({ current_stock: -3, cost_price: 90 }), layers), 0);
});

test('the total is the sum of the parts, each on its own batches', () => {
  const products = [part({ id: 'A', current_stock: 2, cost_price: 10 }), part({ id: 'B', current_stock: 3, cost_price: 20 })];
  const layers = [
    batch({ product_id: 'A', unit_cost: 100, qty_remaining: 2 }),
    batch({ product_id: 'B', unit_cost: 5, qty_remaining: 3 }),
  ];
  assert.equal(totalStockValue(products, layers), 200 + 15);
});

test('an empty shelf is worth nothing rather than failing', () => {
  assert.equal(totalStockValue([], []), 0);
});

// ── What to go and count ─────────────────────────────────────────────────────────────────────

test('a part whose batches and stock count disagree is reported', () => {
  const products = [part({ id: 'A', current_stock: 8 })];
  const layers = [batch({ product_id: 'A', unit_cost: 100, qty_remaining: 10 })];
  assert.deepEqual(stockCountMismatches(products, layers), [{ id: 'A', currentStock: 8, batchQty: 10 }]);
});

test('a part that simply predates batch tracking is not a disagreement', () => {
  assert.deepEqual(stockCountMismatches([part({ id: 'A', current_stock: 8 })], []), []);
});

test('agreement reports nothing', () => {
  const products = [part({ id: 'A', current_stock: 10 })];
  const layers = [batch({ product_id: 'A', unit_cost: 100, qty_remaining: 10 })];
  assert.deepEqual(stockCountMismatches(products, layers), []);
});

// ── The per-unit cost shown next to a part ───────────────────────────────────────────────────

/** A different question from the valuation: what the NEXT sale of this part will cost. */
test('the cost shown per part is its oldest open priced batch', () => {
  const layers = [
    batch({ unit_cost: 100, qty_remaining: 10, created_at: '2026-01-01T00:00:00Z' }),
    batch({ unit_cost: 200, qty_remaining: 10, created_at: '2026-02-01T00:00:00Z' }),
  ];
  assert.equal(fifoCostLookup(layers)(part({ current_stock: 20, cost_price: 999 })), 100);
});

test('an unpriced batch is skipped in favour of a later priced one', () => {
  const layers = [
    batch({ unit_cost: 0, qty_remaining: 10, created_at: '2026-01-01T00:00:00Z' }),
    batch({ unit_cost: 200, qty_remaining: 10, created_at: '2026-02-01T00:00:00Z' }),
  ];
  assert.equal(fifoCostLookup(layers)(part({ current_stock: 20, cost_price: 999 })), 200);
});

test('with no usable batch the part falls back to its cost price', () => {
  assert.equal(fifoCostLookup([])(part({ current_stock: 5, cost_price: 77 })), 77);
});
