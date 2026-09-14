import assert from 'node:assert/strict';
import test from 'node:test';
import { currentIdentity, indexProductsById, savedLineLabel } from '../lib/trade-history';
import { buildLastSoldIndex } from '../lib/sale-entry';
import { buildLastPaidIndex } from '../lib/purchase-entry';

// The part as it is called after the worksheet import renamed it and gave it its real number.
const CATALOGUE = indexProductsById([
  { id: 'p-bearing', part_number: '803149/10', name: 'Big Pinion Bearing' },
]);

test('a line saved before a rename reopens under the part as it is called now', () => {
  const saved = { product_id: 'p-bearing', part_number: 'BIG-P17', name: 'big pinion beraing 803149/10' };
  assert.equal(savedLineLabel(saved, CATALOGUE), '803149/10 - Big Pinion Bearing');
});

test('a one-off line with no part behind it keeps its own text', () => {
  const saved = { product_id: null, part_number: '', name: 'Fitting labour' };
  assert.equal(savedLineLabel(saved, CATALOGUE), ' - Fitting labour');
});

test('a line whose part has since been deleted keeps its saved text', () => {
  const saved = { product_id: 'p-gone', part_number: 'OLD-1', name: 'discontinued part' };
  assert.equal(savedLineLabel(saved, CATALOGUE), 'OLD-1 - discontinued part');
});

test('only the number and the name are swapped; the rest of the line is untouched', () => {
  const saved = { product_id: 'p-bearing', part_number: 'BIG-P17', name: 'old name', qty: 2, unit_price: 2000, invoice_id: 'INV-1013' };
  const current = currentIdentity(saved, CATALOGUE);
  assert.equal(current.part_number, '803149/10');
  assert.equal(current.name, 'Big Pinion Bearing');
  assert.equal(current.qty, 2);
  assert.equal(current.unit_price, 2000);
  assert.equal(current.invoice_id, 'INV-1013');
});

test('the price a customer last paid is still found after the part is renamed', () => {
  const invoices = [{ id: 'INV-1015', customer: 'jasspal', date: '2026-09-03', status: 'paid' }];
  const items = [{ invoice_id: 'INV-1015', product_id: 'p-bearing', part_number: 'BIG-P17', name: 'big pinion beraing 803149/10', qty: 1, unit_price: 2000 }];
  const label = '803149/10 - Big Pinion Bearing';

  const fromSavedText = buildLastSoldIndex('jasspal', invoices, items);
  assert.equal(fromSavedText.get(label), undefined, 'this is the break being fixed: the old text no longer matches');

  const byPart = buildLastSoldIndex('jasspal', invoices, items.map((item) => currentIdentity(item, CATALOGUE)));
  assert.equal(byPart.get(label)?.rate, 2000);
});

test('what a supplier last charged is still found after the part is renamed', () => {
  const orders = [{ id: 'PO-1009', supplier: 'KRISHNA HYDRAULICS', date: '2026-09-01', status: 'received' }];
  const items = [{ po_id: 'PO-1009', product_id: 'p-bearing', part_number: 'BIG-P17', name: 'big pinion beraing 803149/10', unit_cost: 1300 }];
  const index = buildLastPaidIndex('KRISHNA HYDRAULICS', orders, items.map((item) => currentIdentity(item, CATALOGUE)));
  assert.equal(index.get('803149/10 - Big Pinion Bearing')?.rate, 1300);
});
