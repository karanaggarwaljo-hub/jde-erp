/**
 * Renders the purchase entry form and reads the markup back.
 *
 * Same reasoning as test/sale-entry-render.test.ts: the project has no DOM test runner, so this
 * cannot press a key, but it can prove the form renders, that the warnings reach the screen, and
 * that there is still exactly one way for Enter to reach a submit button. That last one matters
 * more here than on the sales side — saving this form opens FIFO stock batches, so a form
 * submitted by a stray Enter moves real inventory.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PurchaseFormModal from '../components/purchases/PurchaseFormModal';
import { buildLastPaidIndex, partLabel } from '../lib/purchase-entry';
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
const PARTS = [PIN, part('SP-258', 'STEARING COUPLING 3DX', { price: 250, salePrice: 250, stock: 0 })];

const LAST_PAID = buildLastPaidIndex(
  'Sharma Auto',
  [{ id: 'PO-1004', supplier: 'Sharma Auto', date: '2026-09-01', status: 'received' }],
  [{ po_id: 'PO-1004', part_number: 'P00-12400', name: 'PIN (12400)', unit_cost: 390 }]
);

function render(lines: POLine[], overrides: Record<string, unknown> = {}) {
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);
  const props = {
    supplierName: 'Sharma Auto', setSupplierName: () => {},
    supplierOptions: ['Sharma Auto', 'Gupta Traders'],
    purchaseDate: '2026-09-10', setPurchaseDate: () => {},
    supplierInvoiceNo: '', setSupplierInvoiceNo: () => {},
    partOptions: PARTS, lines, setLines: () => {}, updateLine: () => {},
    paymentStatus: 'unpaid' as const, setPaymentStatus: () => {},
    amountPaid: 0, setAmountPaid: () => {},
    total, paidAmount: 0,
    lastPaid: LAST_PAID,
    purchaseError: '', savingPurchase: false,
    setShowPurchaseModal: () => {}, recordPurchase: () => {},
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToStaticMarkup(createElement(PurchaseFormModal as any, props));
}

test('an empty purchase tells you to scan rather than to click a button', () => {
  const markup = render([]);
  assert.match(markup, /Scan a barcode or type a part number in the box above/);
  // The old "Add Item Row" button is gone; the picker is how lines get added.
  assert.doesNotMatch(markup, /Add Item Row/);
});

test('the purchase form has exactly one submit control', () => {
  // Saving this form opens FIFO stock batches. A second way for Enter to reach a submit button
  // would be a second way to move inventory by accident.
  const markup = render([{ description: PIN.value, quantity: 10, unit_price: 390 }]);
  assert.equal((markup.match(/type="submit"/g) ?? []).length, 1);
});

test('the picker is labelled for buying, not for selling', () => {
  const markup = render([]);
  assert.match(markup, /Scan a barcode, or type a part number or name/);
});

test('a line shows the part, its stock, what it sells for and what this supplier last charged', () => {
  const markup = render([{ description: PIN.value, quantity: 10, unit_price: 390 }]);
  assert.match(markup, /P00-12400/);
  assert.match(markup, /PIN \(12400\)/);
  assert.match(markup, /5 in stock/);
  assert.match(markup, /sells at ₹650/);
  assert.match(markup, /last paid ₹390 on PO-1004/);
});

test('buying above the selling price is on the line', () => {
  const markup = render([{ description: PIN.value, quantity: 1, unit_price: 700 }]);
  assert.match(markup, /You sell this at ₹650/);
  assert.match(markup, /loses money on every one/);
});

test('a cost far off what this supplier last charged is on the line', () => {
  const markup = render([{ description: PIN.value, quantity: 1, unit_price: 3900 }]);
  assert.match(markup, /900% more than the ₹390 you paid on PO-1004/);
});

test('a line with no cost says what that would do to the stock value', () => {
  const markup = render([{ description: PIN.value, quantity: 1, unit_price: 0 }]);
  assert.match(markup, /valued at nothing/);
});

test('a part not in the catalogue renders as a new part', () => {
  const markup = render([{ description: 'HYDRAULIC SEAL KIT', quantity: 1, unit_price: 1200 }]);
  assert.match(markup, /HYDRAULIC SEAL KIT/);
  assert.match(markup, /New part — will be added to Inventory/);
});

test('a supplier not on file is called out before the purchase is saved', () => {
  const markup = render([], { supplierName: 'Brand New Supplier' });
  assert.match(markup, /New supplier — will be added when this is saved/);
});

test('the keyboard shortcuts are stated on the form', () => {
  assert.match(render([]), /Ctrl\+Enter saves/);
});
