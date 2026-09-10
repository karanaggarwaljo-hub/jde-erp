import assert from 'node:assert/strict';
import test from 'node:test';
import { addPartToLines, buildLastSoldIndex, lineWarnings, partLabel } from '../lib/sale-entry';
import type { InvoiceLine, PartOption } from '../lib/sales-types';

function part(partNumber: string, name: string, extra: Partial<PartOption> = {}): PartOption {
  return {
    value: partLabel(partNumber, name),
    partNumber,
    name,
    brand: '',
    price: 650,
    costPrice: 390,
    stock: 5,
    hsn: '8708',
    category: 'general',
    ...extra,
  };
}

const PIN = part('P00-12400', 'PIN (12400)');
const COUPLING = part('SP-258', 'STEARING COUPLING 3DX', { price: 250, costPrice: 250, stock: 0 });

test('the first part becomes a line at its catalogue rate', () => {
  const { lines, index, merged } = addPartToLines([], PIN);
  assert.equal(merged, false);
  assert.equal(index, 0);
  assert.deepEqual(lines, [{ part: PIN.value, qty: 1, price: 650, discount: 0 }]);
});

test('scanning the same part again raises the quantity instead of adding a row', () => {
  // Three of the same part is qty 3, not three rows of one — which is how anyone would write it
  // by hand, and how it has to print.
  let lines: InvoiceLine[] = [];
  for (let i = 0; i < 3; i += 1) lines = addPartToLines(lines, PIN).lines;
  assert.equal(lines.length, 1);
  assert.equal(lines[0].qty, 3);
});

test('merging reports which line it landed on', () => {
  const start = addPartToLines(addPartToLines([], COUPLING).lines, PIN).lines;
  const { index, merged, lines } = addPartToLines(start, COUPLING);
  assert.equal(merged, true);
  assert.equal(index, 0);
  assert.equal(lines[0].qty, 2);
  assert.equal(lines[1].qty, 1);
});

test('a manually edited rate survives the same part being scanned again', () => {
  const first = addPartToLines([], PIN).lines;
  const negotiated = first.map((line) => ({ ...line, price: 600 }));
  const { lines } = addPartToLines(negotiated, PIN);
  assert.equal(lines[0].price, 600, 'the agreed rate must not be reset by a second scan');
  assert.equal(lines[0].qty, 2);
});

test('a part can be added several at a time', () => {
  const { lines } = addPartToLines([], PIN, 5);
  assert.equal(lines[0].qty, 5);
});

const INVOICES = [
  { id: 'INV-1012', customer: 'jasspal', date: '2026-09-01', status: 'unpaid' },
  { id: 'INV-1015', customer: 'jasspal', date: '2026-09-03', status: 'paid' },
  { id: 'INV-1014', customer: 'Walk-in Customer', date: '2026-09-01', status: 'paid' },
  { id: 'INV-1020', customer: 'jasspal', date: '2026-09-05', status: 'draft' },
];

const ITEMS = [
  { invoice_id: 'INV-1012', part_number: 'P00-12400', name: 'PIN (12400)', qty: 5, unit_price: 650 },
  { invoice_id: 'INV-1015', part_number: 'P00-12400', name: 'PIN (12400)', qty: 2, unit_price: 700 },
  { invoice_id: 'INV-1014', part_number: 'SP-258', name: 'STEARING COUPLING 3DX', qty: 1, unit_price: 650 },
  { invoice_id: 'INV-1020', part_number: 'P00-12400', name: 'PIN (12400)', qty: 1, unit_price: 999 },
];

test('the last rate is the one on this customer most recent billed invoice', () => {
  const index = buildLastSoldIndex('jasspal', INVOICES, ITEMS);
  assert.equal(index.get(PIN.value)?.rate, 700);
  assert.equal(index.get(PIN.value)?.invoiceId, 'INV-1015');
});

test('a draft is not a price anyone agreed to', () => {
  // INV-1020 is newer and quotes 999, but nothing was billed, so it must not set the last rate.
  const index = buildLastSoldIndex('jasspal', INVOICES, ITEMS);
  assert.notEqual(index.get(PIN.value)?.rate, 999);
});

test('another customer rates are never shown for this one', () => {
  const index = buildLastSoldIndex('jasspal', INVOICES, ITEMS);
  assert.equal(index.get(COUPLING.value), undefined);
});

test('a walk-in sale has no history to look back on', () => {
  assert.equal(buildLastSoldIndex('', INVOICES, ITEMS).size, 0);
});

test('two invoices on the same day resolve to the later number', () => {
  const sameDay = [
    { id: 'INV-1001', customer: 'kareem', date: '2026-09-01', status: 'paid' },
    { id: 'INV-1002', customer: 'kareem', date: '2026-09-01', status: 'paid' },
  ];
  const items = [
    { invoice_id: 'INV-1001', part_number: 'P00-12400', name: 'PIN (12400)', qty: 1, unit_price: 500 },
    { invoice_id: 'INV-1002', part_number: 'P00-12400', name: 'PIN (12400)', qty: 1, unit_price: 550 },
  ];
  assert.equal(buildLastSoldIndex('kareem', sameDay, items).get(PIN.value)?.rate, 550);
});

test('an ordinary line says nothing', () => {
  assert.deepEqual(lineWarnings({ part: PIN.value, qty: 2, price: 650, discount: 0 }, PIN), []);
});

test('billing more than is on the shelf is said out loud', () => {
  const warnings = lineWarnings({ part: PIN.value, qty: 9, price: 650, discount: 0 }, PIN);
  assert.equal(warnings[0].kind, 'stock');
  assert.match(warnings[0].message, /Only 5 on the shelf/);
});

test('selling a part that is not on the shelf at all names the consequence', () => {
  const warnings = lineWarnings({ part: COUPLING.value, qty: 1, price: 300, discount: 0 }, COUPLING);
  assert.equal(warnings[0].kind, 'stock');
  assert.match(warnings[0].message, /negative stock/);
});

test('a rate below cost is flagged but never blocked', () => {
  // Selling at a loss to clear stock is a real decision; the job here is to say so, not to refuse.
  const warnings = lineWarnings({ part: PIN.value, qty: 1, price: 300, discount: 0 }, PIN);
  assert.ok(warnings.some((warning) => warning.kind === 'below-cost'));
  assert.match(warnings.find((w) => w.kind === 'below-cost')!.message, /390/);
});

test('a line with no rate is flagged', () => {
  const warnings = lineWarnings({ part: PIN.value, qty: 1, price: 0, discount: 0 }, PIN);
  assert.ok(warnings.some((warning) => warning.kind === 'no-rate'));
});

test('a one-off line has no stock or cost to be judged against', () => {
  const warnings = lineWarnings({ part: 'Labour charge', qty: 1, price: 500, discount: 0 }, undefined);
  assert.deepEqual(warnings, []);
});

test('a part with no cost on file is not called below cost', () => {
  // cost_price 0 means nobody recorded one, not that the part is free.
  const noCost = part('X-1', 'UNKNOWN COST', { costPrice: 0 });
  const warnings = lineWarnings({ part: noCost.value, qty: 1, price: 10, discount: 0 }, noCost);
  assert.ok(!warnings.some((warning) => warning.kind === 'below-cost'));
});
