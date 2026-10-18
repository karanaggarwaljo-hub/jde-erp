import assert from 'node:assert/strict';
import test from 'node:test';
import { groupProfit, NO_SUPPLIER, profitLines, profitTotals, sortProfitRows, type ProfitConsumption, type ProfitInvoice, type ProfitItem } from '../lib/part-profit';
import { OPENING_STOCK, partCostHistory, partSales } from '../lib/part-cost-history';

const parts = [
  { id: 'p-pin', part_number: '911-12400', name: 'PIN (12400)', category: 'Pins & Bushes', brand: 'Rokryder' },
  { id: 'p-oil', part_number: '4000/2500', name: 'jcb transmission oil', category: 'Oils', brand: 'JCB' },
];
const invoice = (overrides: Partial<ProfitInvoice> = {}): ProfitInvoice => ({
  id: 'INV-1', date: '2026-10-10', customer: 'kareem', total: 0, discount_amount: 0, gst_amount: 0, gst_mode: 'exclusive', ...overrides,
});
const item = (overrides: Partial<ProfitItem> = {}): ProfitItem => ({
  id: 'i-pin', invoice_id: 'INV-1', product_id: 'p-pin', part_number: '911-12400', name: 'PIN (12400)', qty: 2, line_total: 1000, ...overrides,
});
const draw = (overrides: Partial<ProfitConsumption> = {}): ProfitConsumption => ({ invoice_item_id: 'i-pin', layer_id: 'L1', qty: 2, unit_cost: 300, ...overrides });
const build = (input: Partial<Parameters<typeof profitLines>[0]>) => profitLines({
  invoices: [], items: [], returnItems: [], consumptions: [], parts, batchSuppliers: { L1: 'Sharma Traders', L2: 'Gupta Auto' }, ...input,
});

test('a plain sale: sales before GST, cost from the batch, profit and margin', () => {
  const lines = build({
    invoices: [invoice({ total: 1180, gst_amount: 180 })],
    items: [item()],
    consumptions: [draw()],
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].sales, 1000, 'GST charged on top is not sales');
  assert.equal(lines[0].cost, 600);
  const totals = profitTotals(lines);
  assert.equal(totals.profit, 400);
  assert.equal(totals.marginPercent, 40);
});

test('GST-inclusive prices have the tax taken out of sales', () => {
  const lines = build({
    invoices: [invoice({ total: 1180, gst_amount: 180, gst_mode: 'inclusive' })],
    items: [item({ line_total: 1180 })],
    consumptions: [draw()],
  });
  assert.equal(lines[0].sales, 1000);
});

test('a whole-bill discount is shared across the lines by what each was worth', () => {
  const lines = build({
    invoices: [invoice({ total: 1350, discount_amount: 150 })],
    items: [item({ line_total: 1000 }), item({ id: 'i-oil', product_id: 'p-oil', name: 'jcb transmission oil', qty: 1, line_total: 500 })],
    consumptions: [draw(), draw({ invoice_item_id: 'i-oil', qty: 1, unit_cost: 400 })],
  });
  const pin = lines.find((line) => line.productId === 'p-pin')!;
  const oil = lines.find((line) => line.productId === 'p-oil')!;
  assert.equal(pin.sales, 900);
  assert.equal(oil.sales, 450);
  assert.equal(profitTotals(lines).sales, 1350);
});

test('a resellable return takes its share out of sales, and its cost went back on the shelf', () => {
  // One of two pins came back resellable: the database undid one piece's draw.
  const lines = build({
    invoices: [invoice()],
    items: [item()],
    returnItems: [{ invoice_item_id: 'i-pin', qty: 1 }],
    consumptions: [draw({ qty: 1 })],
  });
  assert.equal(lines[0].qty, 1);
  assert.equal(lines[0].sales, 500);
  assert.equal(lines[0].cost, 300);
});

test('a return is counted once: the bill header already shrank to the goods that were kept', () => {
  // INV-1003 on the test company: two lines and a 5% bill discount; the ₹10,600 line came back.
  // The return rewrote the header to 95% of the ₹8,777 line that was kept.
  const lines = build({
    invoices: [invoice({ id: 'INV-1003', total: 8338.15, discount_amount: 438.85, gst_amount: 0 })],
    items: [
      item({ id: 'kept', invoice_id: 'INV-1003', qty: 1, line_total: 8777 }),
      item({ id: 'back', invoice_id: 'INV-1003', qty: 1, line_total: 10600 }),
    ],
    returnItems: [{ invoice_item_id: 'back', qty: 1 }],
    consumptions: [draw({ invoice_item_id: 'kept', qty: 1, unit_cost: 8777 })],
  });
  assert.equal(lines.find((line) => line.itemId === 'kept')!.sales, 8338.15);
  assert.equal(lines.find((line) => line.itemId === 'back')!.sales, 0);
  assert.equal(profitTotals(lines).sales, 8338.15, 'matches what the bill now says');
});

test('everything returned resellable earns and costs nothing — known, not unknown', () => {
  const lines = build({ invoices: [invoice()], items: [item()], returnItems: [{ invoice_item_id: 'i-pin', qty: 2 }], consumptions: [] });
  assert.equal(lines[0].sales, 0);
  assert.equal(lines[0].cost, 0);
});

test('a damaged return keeps its cost: the shop paid for a piece it cannot sell', () => {
  const lines = build({
    invoices: [invoice()],
    items: [item()],
    returnItems: [{ invoice_item_id: 'i-pin', qty: 1 }],
    consumptions: [draw({ qty: 2 })],
  });
  assert.equal(lines[0].sales, 500);
  assert.equal(lines[0].cost, 600);
  assert.equal(profitTotals(lines).profit, -100);
});

test('a line with no recorded cost is counted in sales but never as pure profit', () => {
  const lines = build({
    invoices: [invoice()],
    items: [item(), item({ id: 'i-free', product_id: null, name: 'labour charge', qty: 1, line_total: 200 })],
    consumptions: [draw()],
  });
  const totals = profitTotals(lines);
  assert.equal(totals.sales, 1200);
  assert.equal(totals.uncostedLines, 1);
  assert.equal(totals.uncostedSales, 200);
  assert.equal(totals.profit, 400, 'only the costed line earns profit');
  assert.equal(totals.marginPercent, 40, 'margin is on the costed sales only');
});

test('grouping by part, category, brand and customer', () => {
  const lines = build({
    invoices: [invoice(), invoice({ id: 'INV-2', customer: '' })],
    items: [item(), item({ id: 'i-pin2', invoice_id: 'INV-2', qty: 1, line_total: 450 })],
    consumptions: [draw(), draw({ invoice_item_id: 'i-pin2', qty: 1 })],
  });
  const byPart = groupProfit(lines, 'part');
  assert.equal(byPart.length, 1);
  assert.equal(byPart[0].qty, 3);
  assert.equal(byPart[0].bills, 2);
  assert.equal(byPart[0].detail, '911-12400');
  assert.equal(groupProfit(lines, 'category')[0].label, 'Pins & Bushes');
  assert.equal(groupProfit(lines, 'brand')[0].label, 'Rokryder');
  assert.deepEqual(groupProfit(lines, 'customer').map((row) => row.label).sort(), ['Walk-in Customer', 'kareem']);
});

test('by supplier, a sale drawn from two batches counts toward each supplier in proportion', () => {
  const lines = build({
    invoices: [invoice()],
    items: [item()],
    consumptions: [draw({ qty: 1, layer_id: 'L1', unit_cost: 300 }), draw({ qty: 1, layer_id: 'L2', unit_cost: 350 }), ],
  });
  const rows = groupProfit(lines, 'supplier');
  const sharma = rows.find((row) => row.label === 'Sharma Traders')!;
  const gupta = rows.find((row) => row.label === 'Gupta Auto')!;
  assert.equal(sharma.sales, 500);
  assert.equal(sharma.profit, 200);
  assert.equal(gupta.profit, 150);
  // A batch with no purchase behind it (opening stock).
  const opening = groupProfit(build({ invoices: [invoice()], items: [item()], consumptions: [draw({ layer_id: 'L9' })] }), 'supplier');
  assert.equal(opening[0].label, NO_SUPPLIER);
});

test('sorting puts unknown margins last, whichever way margins are sorted', () => {
  const rows = [
    { key: 'a', label: 'a', detail: '', qty: 1, sales: 100, cost: 90, profit: 10, marginPercent: 10, uncostedLines: 0, uncostedSales: 0, bills: 1 },
    { key: 'b', label: 'b', detail: '', qty: 5, sales: 100, cost: 0, profit: 0, marginPercent: null, uncostedLines: 1, uncostedSales: 100, bills: 1 },
    { key: 'c', label: 'c', detail: '', qty: 2, sales: 300, cost: 150, profit: 150, marginPercent: 50, uncostedLines: 0, uncostedSales: 0, bills: 1 },
  ];
  assert.deepEqual(sortProfitRows(rows, 'margin-low').map((row) => row.key), ['a', 'c', 'b']);
  assert.deepEqual(sortProfitRows(rows, 'margin-high').map((row) => row.key), ['c', 'a', 'b']);
  assert.deepEqual(sortProfitRows(rows, 'profit').map((row) => row.key), ['c', 'a', 'b']);
  assert.deepEqual(sortProfitRows(rows, 'qty').map((row) => row.key), ['b', 'c', 'a']);
});

test('a part\'s cost history: newest first, price change, cheapest supplier, stock at cost', () => {
  const history = partCostHistory(
    [
      { id: 'b1', unit_cost: 300, qty_original: 10, qty_remaining: 0, created_at: '2026-09-02T10:00:00Z', source_po_id: 'PO-1' },
      { id: 'b2', unit_cost: 330, qty_original: 5, qty_remaining: 3, created_at: '2026-10-05T10:00:00Z', source_po_id: 'PO-2' },
      { id: 'b0', unit_cost: 280, qty_original: 2, qty_remaining: 1, created_at: '2026-09-01T10:00:00Z', source_po_id: null },
    ],
    [
      { id: 'PO-1', supplier: 'Sharma Traders', date: '2026-09-02', supplier_invoice_no: '4471' },
      { id: 'PO-2', supplier: 'Gupta Auto', date: '2026-10-04' },
    ],
  );
  assert.deepEqual(history.entries.map((entry) => entry.batchId), ['b2', 'b1', 'b0']);
  assert.equal(history.entries[0].date, '2026-10-04', 'the purchase date, not the day it was received');
  assert.equal(history.entries[2].supplier, OPENING_STOCK);
  assert.equal(history.lastCost, 330);
  assert.equal(history.previousCost, 300);
  assert.equal(history.changePercent, 10);
  assert.equal(history.rising, true);
  assert.equal(history.onHand, 4);
  assert.equal(history.stockValue, 1270);
  assert.equal(history.averageCost, Math.round(((300 * 10 + 330 * 5 + 280 * 2) / 17) * 100) / 100);
  assert.deepEqual(history.suppliers.map((entry) => entry.supplier), ['Sharma Traders', 'Gupta Auto'], 'cheapest first, opening stock left out');
});

test('a part never bought has an empty, honest history', () => {
  const history = partCostHistory([], []);
  assert.equal(history.lastCost, null);
  assert.equal(history.changePercent, null);
  assert.equal(history.rising, false);
  assert.equal(history.averageCost, null);
});

test('a part\'s earnings: all time and the last 90 days', () => {
  const lines = build({
    invoices: [invoice({ date: '2026-10-10' }), invoice({ id: 'INV-OLD', date: '2026-05-01' })],
    items: [item(), item({ id: 'i-old', invoice_id: 'INV-OLD', qty: 1, line_total: 500 })],
    consumptions: [draw(), draw({ invoice_item_id: 'i-old', qty: 1 })],
  });
  const sales = partSales(lines, '2026-10-18');
  assert.equal(sales.allTime.qty, 3);
  assert.equal(sales.recent.qty, 2);
  assert.equal(sales.recent.profit, 400);
  assert.equal(sales.topCustomers[0].customer, 'kareem');
});
