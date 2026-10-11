import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceFigures } from '../lib/invoice-figures';
import { buildInvoiceDocument, type DocInvoice, type DocItem } from '../lib/invoice-document';

const COMPANY = { name: 'Jai Durga Enterprises', address: 'Chandigarh', gstin: '03ABCDE1234F1Z5', contact_phone: '98140 00000', contact_email: '' };

const invoice = (overrides: Partial<DocInvoice> = {}): DocInvoice => ({
  id: 'INV-1017', date: '2026-10-12', customer: 'kareem', total: 1180, paid: 0,
  settlement_write_off: 0, discount_percent: 0, discount_amount: 0, gst_percent: 18, gst_amount: 180, gst_mode: 'exclusive',
  ...overrides,
});
const item = (overrides: Partial<DocItem> = {}): DocItem => ({
  part_number: '911-12400', name: 'bkt main pin', qty: 2, unit_price: 500, line_total: 1000, discount_percent: 0, discount_amount: 0,
  ...overrides,
});

test('GST priced on top: taxable value is the bill before tax', () => {
  const f = invoiceFigures(invoice(), [item()]);
  assert.equal(f.subtotal, 1000);
  assert.equal(f.gstAmount, 180);
  assert.equal(f.netTaxableValue, 1000);
  assert.equal(f.balanceDue, 1180);
});

test('GST included in the price: the tax is taken back out of the taxable value', () => {
  const f = invoiceFigures(invoice({ total: 1000, gst_amount: 152.54, gst_mode: 'inclusive' }), [item()]);
  assert.equal(f.gstInclusive, true);
  assert.equal(Math.round(f.netTaxableValue * 100) / 100, 847.46);
});

test('an older invoice with no stored GST works it out from the totals', () => {
  const f = invoiceFigures(invoice({ gst_amount: null, total: 1180 }), [item()]);
  assert.equal(f.gstAmount, 180);
});

test('a write-off is its own figure and closes the balance without counting as paid', () => {
  const f = invoiceFigures(invoice({ paid: 1000, settlement_write_off: 180 }), [item()]);
  assert.equal(f.writtenOff, 180);
  assert.equal(f.balanceDue, 0);
});

test('the document carries the letterhead, the customer and every line', () => {
  const doc = buildInvoiceDocument({
    invoice: invoice(), items: [item(), item({ part_number: '', name: 'grease nipple', qty: 3, unit_price: 20, line_total: 60 })],
    company: COMPANY, customer: { address: 'Mohali', phone: '98765 43210', gstin: '' },
  });
  assert.equal(doc.companyName, 'Jai Durga Enterprises');
  assert.deepEqual(doc.companyLines, ['Chandigarh', 'GSTIN: 03ABCDE1234F1Z5  |  Phone: 98140 00000']);
  assert.equal(doc.billToName, 'kareem');
  assert.deepEqual(doc.billToLines, ['Mohali', 'Phone: 98765 43210']);
  assert.equal(doc.rows.length, 2);
  assert.equal(doc.rows[1].partNumber, '-', 'a line with no part number says so');
  assert.equal(doc.rows[0].rate, 'Rs. 500.00');
  assert.equal(doc.showDiscountColumn, false);
  assert.equal(doc.status, 'UNPAID');
});

test('the totals read in the same order as the printed invoice', () => {
  const doc = buildInvoiceDocument({ invoice: invoice({ paid: 500 }), items: [item()], company: COMPANY, customer: null });
  assert.deepEqual(doc.totals.map((t) => t.label), ['Subtotal', 'Taxable value', 'GST (18%)', 'Total', 'Paid', 'Balance due']);
  assert.equal(doc.totals.find((t) => t.label === 'Balance due')?.value, 'Rs. 680.00');
  assert.equal(doc.status, 'PART PAID');
});

test('line discounts get their own column and lines; a walk-in sale with nothing owed is PAID', () => {
  const doc = buildInvoiceDocument({
    invoice: invoice({ customer: '', total: 900, paid: 900, gst_amount: 0, gst_percent: 0 }),
    items: [item({ discount_percent: 10, discount_amount: 100, line_total: 900 })],
    company: COMPANY, customer: null,
  });
  assert.equal(doc.showDiscountColumn, true);
  assert.equal(doc.rows[0].discount, '10% (-Rs. 100.00)');
  assert.equal(doc.totals[0].label, 'Item discounts');
  assert.equal(doc.billToName, 'Walk-in Customer');
  assert.equal(doc.status, 'PAID');
});

test('an invoice from before line items were recorded still has a document', () => {
  const doc = buildInvoiceDocument({ invoice: invoice({ gst_amount: null }), items: [], company: COMPANY, customer: null });
  assert.ok(doc.emptyNote);
  assert.deepEqual(doc.totals.map((t) => t.label), ['Total', 'Paid', 'Balance due']);
});
