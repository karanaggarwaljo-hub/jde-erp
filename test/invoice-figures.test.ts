import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceFigures } from '../lib/invoice-figures';
import type { FigureInvoice, FigureItem } from '../lib/invoice-figures';

type DocInvoice = FigureInvoice & { id: string; date: string; customer: string };
type DocItem = FigureItem & { part_number?: string; name: string; qty: number; unit_price: number };

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
