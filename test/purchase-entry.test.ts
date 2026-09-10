import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addNewPartLine,
  addPartToPurchaseLines,
  buildLastPaidIndex,
  partLabel,
  purchaseLineWarnings,
} from '../lib/purchase-entry';
import type { PartOption, POLine } from '../lib/purchase-types';

function part(partNumber: string, name: string, extra: Partial<PartOption> = {}): PartOption {
  return {
    value: partLabel(partNumber, name),
    partNumber,
    name,
    brand: 'SKF',
    price: 390,
    salePrice: 650,
    stock: 5,
    category: 'general',
    ...extra,
  };
}

const PIN = part('P00-12400', 'PIN (12400)');
const COUPLING = part('SP-258', 'STEARING COUPLING 3DX', { price: 250, salePrice: 250, stock: 0 });

test('the first part becomes a line at the cost already on file', () => {
  // Seeded with the known cost, not zero: zero would make every line look like a price change.
  const { lines, index, merged } = addPartToPurchaseLines([], PIN);
  assert.equal(merged, false);
  assert.equal(index, 0);
  assert.deepEqual(lines, [{ description: PIN.value, quantity: 1, unit_price: 390 }]);
});

test('scanning the same part again raises the quantity instead of adding a row', () => {
  // A supplier's invoice lists a part once with a quantity, so keying it must produce one line.
  let lines: POLine[] = [];
  for (let i = 0; i < 4; i += 1) lines = addPartToPurchaseLines(lines, PIN).lines;
  assert.equal(lines.length, 1);
  assert.equal(lines[0].quantity, 4);
});

test('a corrected cost survives the same part being scanned again', () => {
  const first = addPartToPurchaseLines([], PIN).lines;
  const corrected = first.map((line) => ({ ...line, unit_price: 420 }));
  const { lines } = addPartToPurchaseLines(corrected, PIN);
  assert.equal(lines[0].unit_price, 420, 'the cost off the supplier document must not be reset');
  assert.equal(lines[0].quantity, 2);
});

test('a part not in the catalogue is added as a new part at no cost', () => {
  const { lines } = addNewPartLine([], 'HYDRAULIC SEAL KIT');
  assert.deepEqual(lines, [{ description: 'HYDRAULIC SEAL KIT', quantity: 1, unit_price: 0 }]);
});

const ORDERS = [
  { id: 'PO-1002', supplier: 'Sharma Auto', date: '2026-08-10', status: 'received' },
  { id: 'PO-1004', supplier: 'Sharma Auto', date: '2026-09-01', status: 'received' },
  { id: 'PO-1003', supplier: 'Gupta Traders', date: '2026-08-20', status: 'received' },
];

const ITEMS = [
  { po_id: 'PO-1002', part_number: 'P00-12400', name: 'PIN (12400)', unit_cost: 340 },
  { po_id: 'PO-1004', part_number: 'P00-12400', name: 'PIN (12400)', unit_cost: 390 },
  { po_id: 'PO-1003', part_number: 'P00-12400', name: 'PIN (12400)', unit_cost: 500 },
];

test('the last cost is the one on this supplier most recent order', () => {
  const index = buildLastPaidIndex('Sharma Auto', ORDERS, ITEMS);
  assert.equal(index.get(PIN.value)?.rate, 390);
  assert.equal(index.get(PIN.value)?.ref, 'PO-1004');
});

test('another supplier rate is never shown for this one', () => {
  // Gupta charges 500 for the same part; that must not appear against Sharma.
  const index = buildLastPaidIndex('Sharma Auto', ORDERS, ITEMS);
  assert.notEqual(index.get(PIN.value)?.rate, 500);
});

test('a supplier with no history has nothing to compare against', () => {
  assert.equal(buildLastPaidIndex('Brand New Supplier', ORDERS, ITEMS).size, 0);
  assert.equal(buildLastPaidIndex('', ORDERS, ITEMS).size, 0);
});

test('an ordinary purchase line says nothing', () => {
  const line = { description: PIN.value, quantity: 10, unit_price: 390 };
  const lastPaid = { rate: 390, date: '2026-09-01', ref: 'PO-1004' };
  assert.deepEqual(purchaseLineWarnings(line, PIN, lastPaid), []);
});

test('a line with no cost names what it would actually do', () => {
  // A zero-cost FIFO batch makes every later sale from it report the full sale value as profit.
  const warnings = purchaseLineWarnings({ description: PIN.value, quantity: 1, unit_price: 0 }, PIN);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].kind, 'no-cost');
  assert.match(warnings[0].message, /valued at nothing/);
  assert.match(warnings[0].message, /report the full sale value as profit/);
});

test('buying above the selling price is the warning that matters most here', () => {
  const warnings = purchaseLineWarnings({ description: PIN.value, quantity: 1, unit_price: 700 }, PIN);
  assert.equal(warnings[0].kind, 'above-sale-price');
  assert.match(warnings[0].message, /You sell this at ₹650/);
  assert.match(warnings[0].message, /loses money on every one/);
});

test('buying at exactly the selling price is worded as earning nothing, not as a loss', () => {
  const warnings = purchaseLineWarnings({ description: COUPLING.value, quantity: 1, unit_price: 250 }, COUPLING);
  assert.equal(warnings[0].kind, 'above-sale-price');
  assert.match(warnings[0].message, /earns nothing/);
});

test('a part with no sale price on file is never called a loss', () => {
  // sale_price 0 means nobody set one, not that it is given away.
  const unpriced = part('X-1', 'NO SALE PRICE', { salePrice: 0 });
  const warnings = purchaseLineWarnings({ description: unpriced.value, quantity: 1, unit_price: 900 }, unpriced);
  assert.ok(!warnings.some((w) => w.kind === 'above-sale-price'));
});

test('a cost well above what this supplier last charged is flagged', () => {
  const lastPaid = { rate: 390, date: '2026-09-01', ref: 'PO-1004' };
  const warnings = purchaseLineWarnings({ description: PIN.value, quantity: 1, unit_price: 520 }, PIN, lastPaid);
  const change = warnings.find((w) => w.kind === 'cost-change');
  assert.ok(change);
  assert.match(change.message, /33% more/);
  assert.match(change.message, /₹390/);
  assert.match(change.message, /PO-1004/);
});

test('a mistyped extra zero is caught by the same check', () => {
  const lastPaid = { rate: 390, date: '2026-09-01', ref: 'PO-1004' };
  const warnings = purchaseLineWarnings({ description: PIN.value, quantity: 1, unit_price: 3900 }, PIN, lastPaid);
  assert.ok(warnings.some((w) => w.kind === 'cost-change'));
  // And it is above the sale price too, so both are said.
  assert.ok(warnings.some((w) => w.kind === 'above-sale-price'));
});

test('a cost well below what was last paid is flagged too', () => {
  // A dropped digit looks exactly like a good deal, so both directions are reported.
  const lastPaid = { rate: 390, date: '2026-09-01', ref: 'PO-1004' };
  const warnings = purchaseLineWarnings({ description: PIN.value, quantity: 1, unit_price: 39 }, PIN, lastPaid);
  const change = warnings.find((w) => w.kind === 'cost-change');
  assert.ok(change);
  assert.match(change.message, /90% less/);
});

test('an ordinary price revision stays quiet', () => {
  // 10% is a supplier revision, not a typo, and saying so every time would train it to be ignored.
  const lastPaid = { rate: 390, date: '2026-09-01', ref: 'PO-1004' };
  const warnings = purchaseLineWarnings({ description: PIN.value, quantity: 1, unit_price: 429 }, PIN, lastPaid);
  assert.ok(!warnings.some((w) => w.kind === 'cost-change'));
});

test('a brand new part has no sale price and no history to judge', () => {
  const warnings = purchaseLineWarnings({ description: 'HYDRAULIC SEAL KIT', quantity: 1, unit_price: 1200 }, undefined);
  assert.deepEqual(warnings, []);
});
