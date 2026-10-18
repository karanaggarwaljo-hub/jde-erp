import assert from 'node:assert/strict';
import test from 'node:test';
import { deadStock, draftsBySupplier, planParts, reorderList, type PlanBatch, type PlanPart, type PlanSale } from '../lib/stock-planning';

const today = '2026-10-18';
const parts: PlanPart[] = [
  { id: 'pump', part_number: '20/925552', name: 'charging pump 3DX', current_stock: 3, min_stock: 0, cost_price: 3000 },
  { id: 'pin', part_number: '911-12400', name: 'PIN (12400)', current_stock: 40, min_stock: 0, cost_price: 300 },
  { id: 'seal', part_number: '332/Y5599', name: 'stabilizer seal', current_stock: 1, min_stock: 5, cost_price: 120 },
  { id: 'lever', part_number: '40-301257', name: 'TIPPING LEVER', current_stock: 6, min_stock: 0, cost_price: 3950 },
  { id: 'empty', part_number: 'X', name: 'never stocked', current_stock: 0, min_stock: 0, cost_price: 0 },
];
// 45 pumps in 90 days = half a pump a day; 9 pins = 0.1 a day; the lever last sold in May.
const sales: PlanSale[] = [
  ...Array.from({ length: 45 }, (_, index) => ({ product_id: 'pump', qty: 1, date: `2026-${index < 30 ? '09' : '10'}-${String((index % 28) + 1).padStart(2, '0')}` })),
  { product_id: 'pin', qty: 9, date: '2026-10-01' },
  { product_id: 'lever', qty: 1, date: '2026-05-02' },
  { product_id: null, qty: 4, date: '2026-10-10' },
];
const batches: PlanBatch[] = [
  { product_id: 'pump', qty_remaining: 3, unit_cost: 3100, source_po_id: 'PO-2', created_at: '2026-10-05T10:00:00Z' },
  { product_id: 'pump', qty_remaining: 0, unit_cost: 2950, source_po_id: 'PO-1', created_at: '2026-08-01T10:00:00Z' },
  { product_id: 'lever', qty_remaining: 6, unit_cost: 3800, source_po_id: null, created_at: '2026-04-01T10:00:00Z' },
];
const purchases = [{ id: 'PO-1', supplier: 'Sharma Traders', date: '2026-08-01' }, { id: 'PO-2', supplier: 'Gupta Auto', date: '2026-10-05' }];
const plans = planParts({ parts, sales, batches, purchases, today });
const byId = (id: string) => plans.find((plan) => plan.partId === id)!;

test('the pace is pieces sold over the window, and days left follow from it', () => {
  const pump = byId('pump');
  assert.equal(pump.soldInWindow, 45);
  assert.equal(pump.perDay, 0.5);
  assert.equal(pump.daysLeft, 6);
  assert.equal(pump.lastCost, 3100, 'the newest batch');
  assert.equal(pump.lastSupplier, 'Gupta Auto');
  assert.equal(pump.stockValue, 9300);
});

test('reorder when the shelf will not last the lead time; order enough for lead time plus cover', () => {
  const pump = byId('pump');
  assert.equal(pump.needsReorder, true, '6 days left, 7 days lead time');
  assert.equal(pump.suggestQty, Math.ceil(0.5 * 37) - 3);
  assert.equal(byId('pin').needsReorder, false, '400 days of pins on the shelf');
});

test('a part\'s own reorder level is a floor, even when it has not sold lately', () => {
  const seal = byId('seal');
  assert.equal(seal.needsReorder, true);
  assert.equal(seal.suggestQty, 9, 'up to twice its reorder level');
  assert.equal(byId('empty').needsReorder, false, 'nothing to plan from');
});

test('the reorder list puts the most urgent first: running out soonest, then below a reorder level', () => {
  assert.deepEqual(reorderList(plans).map((plan) => plan.partId), ['pump', 'seal']);
});

test('dead stock: in stock, not sold in the window, most money first', () => {
  const dead = deadStock(plans, 90);
  assert.deepEqual(dead.map((plan) => plan.partId), ['lever']);
  assert.equal(dead[0].stockValue, 22800);
  assert.equal(dead[0].idleDays, 169);
  // The seal is in stock and never sold, but nothing says when it came in: its age is unknown.
  assert.equal(dead.some((plan) => plan.partId === 'seal'), false);
});

test('drafts are grouped by who supplied each part last', () => {
  const drafts = draftsBySupplier(reorderList(plans), (plan) => `${plan.partNumber} - ${plan.name}`);
  assert.deepEqual(drafts.map((draft) => draft.supplier), ['Gupta Auto', '']);
  assert.equal(drafts[0].lines[0].unitCost, 3100);
});
