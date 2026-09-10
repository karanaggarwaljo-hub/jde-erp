/**
 * Renders the sale-entry screens and reads the markup back.
 *
 * The project has no DOM test runner, so this cannot press a key. What it can do is prove the
 * things that would otherwise only be found by opening the app with a login I do not have: that
 * both components render at all, that the picker exposes the combobox contract a keyboard and a
 * screen reader depend on, and — the one that actually bit before — that the invoice form still
 * has no way for Enter to reach a submit button by accident.
 *
 * react-dom/server is already a dependency of the app, so this adds nothing to install.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PartPicker from '../components/PartPicker';
import InvoiceFormModal from '../components/sales/InvoiceFormModal';
import { buildLastSoldIndex, partLabel } from '../lib/sale-entry';
import { billTotals } from '../lib/invoice-totals';
import type { Customer, InvoiceLine, PartOption } from '../lib/sales-types';

function part(partNumber: string, name: string, extra: Partial<PartOption> = {}): PartOption {
  return {
    value: partLabel(partNumber, name),
    partNumber,
    name,
    brand: 'SKF',
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
const PARTS = [PIN, COUPLING];

test('the picker renders as a combobox a keyboard can drive', () => {
  const markup = renderToStaticMarkup(
    createElement(PartPicker, { parts: PARTS, onPick: () => {} })
  );
  assert.match(markup, /role="combobox"/);
  assert.match(markup, /aria-autocomplete="list"/);
  assert.match(markup, /aria-expanded="false"/);
  // The placeholder is the only instruction anyone gets, so it has to name both ways in.
  assert.match(markup, /Scan a barcode/);
  assert.match(markup, /part number or name/);
});

test('the picker offers no list until something is typed', () => {
  // Dropping 944 rows on screen the moment the box is focused is the thing being avoided.
  const markup = renderToStaticMarkup(
    createElement(PartPicker, { parts: PARTS, onPick: () => {} })
  );
  assert.doesNotMatch(markup, /role="listbox"/);
});

const CUSTOMER: Customer = {
  id: 'c1', company_id: '1', name: 'jasspal', phone: '', email: '',
  gstin: '03ABCDE1234F1Z5', address: 'Ludhiana', type: 'retail', balance: 7026,
};

function renderForm(lines: InvoiceLine[], overrides: Record<string, unknown> = {}) {
  const totals = billTotals({ lines, discountPercent: 0, gstPercent: 18, gstInclusive: false });
  const props = {
    lines, setLines: () => {}, updateLine: () => {},
    invoiceDate: '2026-09-10', setInvoiceDate: () => {},
    customer: 'jasspal', setCustomer: () => {},
    paymentStatus: 'unpaid' as const, setPaymentStatus: () => {},
    amountPaid: 0, setAmountPaid: () => {},
    discountPercent: 0, setDiscountPercent: () => {},
    gstPercent: 18, setGstPercent: () => {},
    gstInclusive: false, setGstInclusive: () => {},
    totals, paidAmount: 0, newOutstanding: totals.total,
    editingInvoice: null, setEditingInvoice: () => {}, editingDraft: false,
    invoiceError: '', savingInvoice: false, savingDraft: false,
    selectedCustomer: CUSTOMER, creditSaleNeedsCustomer: false,
    partOptions: PARTS, customers: [CUSTOMER],
    placeOfSupply: 'Punjab', halfGstPercent: 9, supplyKind: 'intra' as const,
    lastSold: new Map(),
    setShowInvoiceModal: () => {}, setShowAddCustomer: () => {},
    saveInvoice: () => {}, saveDraftInvoice: () => {},
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToStaticMarkup(createElement(InvoiceFormModal as any, props));
}

test('an empty invoice tells you to scan rather than to click a button', () => {
  const markup = renderForm([]);
  assert.match(markup, /Scan a barcode or type a part number in the box above/);
  // The old "+ Add line" button is gone; the picker is the way lines get added.
  assert.doesNotMatch(markup, /Add line/);
});

test('the invoice form has exactly one submit control', () => {
  // Enter in any text input clicks the form's submit button. One is the button in the footer,
  // which is deliberate; a second would be another way to save a half-typed sale by accident.
  const markup = renderForm([{ part: PIN.value, qty: 1, price: 650, discount: 0 }]);
  const submits = markup.match(/type="submit"/g) ?? [];
  assert.equal(submits.length, 1);
});

test('a billed line shows the part, its stock and its money', () => {
  const markup = renderForm([{ part: PIN.value, qty: 2, price: 650, discount: 0 }]);
  assert.match(markup, /P00-12400/);
  assert.match(markup, /PIN \(12400\)/);
  assert.match(markup, /5 in stock/);
  assert.match(markup, /1,300\.00/);
});

test('billing more than is on the shelf says so on the line', () => {
  const markup = renderForm([{ part: PIN.value, qty: 9, price: 650, discount: 0 }]);
  assert.match(markup, /Only 5 on the shelf/);
});

test('selling something with no stock warns about going negative', () => {
  // This is exactly what happened to two real parts on 1 September and went unnoticed.
  const markup = renderForm([{ part: COUPLING.value, qty: 1, price: 300, discount: 0 }]);
  assert.match(markup, /negative stock/);
});

test('a rate below cost is called out', () => {
  const markup = renderForm([{ part: PIN.value, qty: 1, price: 300, discount: 0 }]);
  assert.match(markup, /Below cost of ₹390/);
});

test('what this customer paid last time is on the line', () => {
  const lastSold = buildLastSoldIndex(
    'jasspal',
    [{ id: 'INV-1015', customer: 'jasspal', date: '2026-09-03', status: 'paid' }],
    [{ invoice_id: 'INV-1015', part_number: 'P00-12400', name: 'PIN (12400)', qty: 2, unit_price: 700 }]
  );
  const markup = renderForm([{ part: PIN.value, qty: 1, price: 650, discount: 0 }], { lastSold });
  assert.match(markup, /last billed at ₹700 on INV-1015/);
  // And a one-click way to charge it again, since the rate differs from what is typed.
  assert.match(markup, /use ₹700/);
});

test('a one-off line renders without a catalogue part behind it', () => {
  const markup = renderForm([{ part: 'Fitting labour', qty: 1, price: 500, discount: 0 }]);
  assert.match(markup, /Fitting labour/);
  assert.match(markup, /not in Inventory, so no stock moves/);
});

test('the keyboard shortcuts are stated on the form', () => {
  const markup = renderForm([]);
  assert.match(markup, /Ctrl\+Enter saves/);
});
