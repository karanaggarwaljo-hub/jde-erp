/**
 * Renders the "Return or cancel" window and the bill list it can start from, and reads the markup
 * back. As with the other render tests there is no DOM here to click in, so this proves what the
 * windows say on opening: the two answers, a blocked answer carrying its reason instead of being
 * offered, a draft going straight to "discard", and the bill list showing what can be acted on.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import FixBillModal, { type FixBillModalProps } from '../components/sales/FixBillModal';
import BillPickerModal from '../components/sales/BillPickerModal';
import type { Customer, Invoice, InvoiceItem } from '../lib/sales-types';

const invoice = (extra: Partial<Invoice> = {}): Invoice => ({
  id: 'INV-1001', company_id: 'c1', customer: 'Jasspal', date: '2026-11-10', items: 3, total: 3540, paid: 0,
  settlement_write_off: 0, status: 'unpaid', mode: 'Credit', discount_percent: 0, discount_amount: 0,
  gst_percent: 18, gst_amount: 540, gst_mode: 'exclusive', ...extra,
});

const CUSTOMER: Customer = { id: 'cu1', company_id: 'c1', name: 'Jasspal', phone: '', email: '', gstin: '', address: '', type: 'retail', balance: 3540 };

const ITEMS: InvoiceItem[] = [
  { id: 'i1', invoice_id: 'INV-1001', product_id: 'p1', part_number: '32/925694', name: 'Fuel filter 3DX', qty: 2, unit_price: 1000, line_total: 2000 },
  { id: 'i2', invoice_id: 'INV-1001', product_id: null, part_number: '', name: 'Fitting labour', qty: 1, unit_price: 1000, line_total: 1000 },
];

function render(overrides: Partial<FixBillModalProps> = {}) {
  return renderToStaticMarkup(createElement(FixBillModal, {
    invoice: invoice(), companyId: 'c1', customer: CUSTOMER, items: ITEMS, returnCount: 0, laterPayments: [],
    onClose: () => {}, onDone: () => {},
    ...overrides,
  }));
}

test('the window opens by asking what happened, with one answer for goods back and one for cancelling', () => {
  const markup = render();
  assert.match(markup, /Return or cancel INV-1001/);
  assert.match(markup, /What happened\?/);
  assert.match(markup, /Goods came back/);
  assert.match(markup, /Cancel the whole bill/);
  // What the bill is, so the right one is being acted on.
  assert.match(markup, /Jasspal · 2026-11-10 · ₹3,540/);
  assert.match(markup, /₹3,540 still to pay/);
  // Deleting is still possible, but as a quiet link rather than a third big button.
  assert.match(markup, /deleted completely/);
  // Nothing is saved from this first step: there is no save or danger button on it yet.
  assert.doesNotMatch(markup, /btn-danger/);
});

test('an answer that cannot be used says why, and is not offered', () => {
  const markup = render({ invoice: invoice({ status: 'partial', paid: 590 }), laterPayments: ['RCPT-1001'] });
  assert.match(markup, /Money was received on this bill afterwards \(RCPT-1001\)/);
  // The cancel button is disabled; the return one is not.
  const buttons = markup.match(/<button type="button" class="fix-choice[^>]*>/g) ?? [];
  assert.equal(buttons.length, 2);
  assert.doesNotMatch(buttons[0], /disabled/);
  assert.match(buttons[1], /disabled/);
  // And with cancelling blocked, deleting is blocked for the same reason, so its link is gone.
  assert.doesNotMatch(markup, /deleted completely/);
});

test('editing is offered only when the page says the bill can be edited', () => {
  assert.doesNotMatch(render(), /Edit the bill/);
  assert.match(render({ onEdit: () => {} }), /Edit the bill/);
});

test('a draft opens straight on discarding it', () => {
  const markup = render({ invoice: invoice({ status: 'draft' }) });
  assert.match(markup, /Discard draft INV-1001\?/);
  assert.match(markup, /never billed/);
  // Only the two pieces that are stock are counted; the labour line holds none.
  assert.match(markup, /2 pieces/);
  assert.match(markup, /Keep the draft/);
  assert.doesNotMatch(markup, /What happened\?/);
});

test('the bill list shows what can be acted on, newest first, and never a cancelled bill', () => {
  const bills = [
    invoice(),
    invoice({ id: 'INV-1002', customer: 'Raman', date: '2026-11-12', status: 'paid', paid: 3540 }),
    invoice({ id: 'INV-1003', customer: 'Walk-in Customer', date: '2026-11-13', status: 'cancelled', total: 0 }),
    invoice({ id: 'INV-1004', customer: 'Raman', date: '2026-11-13', status: 'draft' }),
  ];
  const markup = renderToStaticMarkup(createElement(BillPickerModal, { invoices: bills, invoiceItems: ITEMS, onPick: () => {}, onClose: () => {} }));
  assert.match(markup, /Which bill is it\?/);
  assert.doesNotMatch(markup, /INV-1003/);
  assert.ok(markup.indexOf('INV-1004') < markup.indexOf('INV-1002'), 'newest first');
  assert.ok(markup.indexOf('INV-1002') < markup.indexOf('INV-1001'), 'newest first');
  assert.match(markup, /Fuel filter 3DX and 1 more/);
  assert.match(markup, /₹3,540 to pay/);
  assert.match(markup, />Draft</);
});

test('with no bills at all the list says so', () => {
  const markup = renderToStaticMarkup(createElement(BillPickerModal, { invoices: [], invoiceItems: [], onPick: () => {}, onClose: () => {} }));
  assert.match(markup, /No bills yet/);
});
