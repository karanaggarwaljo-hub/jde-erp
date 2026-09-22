import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPartOverview, type PartOverviewRows } from '../lib/part-overview';

// Shaped like the live rows behind PIN (12400): one sale of 5 to jasspal, an opening batch, a return.
const ROWS: PartOverviewRows = {
  layers: [
    { id: 'l1', created_at: '2026-07-30T18:26:59Z', unit_cost: 440, qty_remaining: 15, qty_original: 20 },
    { id: 'l2', created_at: '2026-08-20T10:00:00Z', unit_cost: 460, qty_remaining: 4, qty_original: 4 },
  ],
  invoiceItems: [
    { id: 'ii1', invoice_id: 'INV-1012', qty: 5, unit_price: 650, line_total: 3250 },
    { id: 'ii2', invoice_id: 'INV-1009', qty: 2, unit_price: 600, line_total: 1200 },
  ],
  invoices: [
    { id: 'INV-1012', date: '2026-09-01', customer: 'jasspal' },
    { id: 'INV-1009', date: '2026-08-11', customer: '' },
  ],
  poItems: [{ id: 'pi1', po_id: 'PO-1004', qty: 20, unit_cost: 440, line_total: 8800 }],
  purchaseOrders: [{ id: 'PO-1004', date: '2026-07-30', supplier: 'Nitlux Auto' }],
  returnItems: [{ id: 'ri1', sales_return_id: 'SRN-1002', qty: 1, unit_price: 650, line_total: 650, condition: 'damaged' }],
  returns: [{ id: 'SRN-1002', created_at: '2026-09-03T09:00:00Z' }],
};

test('sales and purchases read newest first, with the customer and supplier named', () => {
  const overview = buildPartOverview(ROWS);
  assert.deepEqual(overview.sales.map((line) => line.documentId), ['INV-1012', 'INV-1009']);
  assert.equal(overview.sales[0].who, 'jasspal');
  assert.equal(overview.sales[1].who, 'Walk-in Customer', 'a blank customer is the counter sale');
  assert.equal(overview.purchases[0].who, 'Nitlux Auto');
  assert.equal(overview.purchases[0].date, '2026-07-30');
});

test('the shelf is valued batch by batch, not stock times one price', () => {
  const { totals } = buildPartOverview(ROWS);
  assert.equal(totals.onHandValue, 15 * 440 + 4 * 460);
  assert.equal(totals.nextCost, 440, 'the next sale costs the oldest open batch');
});

test('what it has sold and cost is added from the lines themselves', () => {
  const { totals } = buildPartOverview(ROWS);
  assert.equal(totals.soldQty, 7);
  assert.equal(totals.soldValue, 4450);
  assert.equal(totals.boughtQty, 20);
  assert.equal(totals.boughtValue, 8800);
  assert.equal(totals.returnedQty, 1);
});

test('a damaged return says so, and batches read newest first', () => {
  const overview = buildPartOverview(ROWS);
  assert.equal(overview.returns[0].who, 'Came back damaged');
  assert.deepEqual(overview.batches.map((batch) => batch.id), ['l2', 'l1']);
});

test('a part with no history at all still adds up to zero', () => {
  const empty = buildPartOverview({ layers: [], invoiceItems: [], invoices: [], poItems: [], purchaseOrders: [], returnItems: [], returns: [] });
  assert.deepEqual(empty.totals, { soldQty: 0, soldValue: 0, boughtQty: 0, boughtValue: 0, returnedQty: 0, onHandValue: 0, nextCost: null });
  assert.deepEqual(empty.sales, []);
});

test('only the most recent movements are kept, but the totals count everything', () => {
  const many = {
    ...ROWS,
    invoiceItems: Array.from({ length: 30 }, (_, index) => ({ id: 'x' + index, invoice_id: 'INV-1012', qty: 1, unit_price: 10, line_total: 10 })),
  };
  assert.equal(buildPartOverview(many).sales.length, 10);
  assert.equal(buildPartOverview(many).totals.soldQty, 30);
});
