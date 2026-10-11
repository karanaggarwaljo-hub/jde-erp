import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { pdfSafe, renderInvoicePdf } from '../lib/invoice-pdf';
import { buildInvoiceDocument, type DocItem } from '../lib/invoice-document';
import { invoiceFingerprint } from '../lib/invoice-archive';

const COMPANY = { name: 'Jai Durga Enterprises', address: 'Chandigarh', gstin: '03ABCDE1234F1Z5', contact_phone: '98140 00000' };

const lines = (n: number): DocItem[] => Array.from({ length: n }, (_, index) => ({
  part_number: `20-90${String(index).padStart(4, '0')}`,
  name: index % 7 === 0 ? 'hydraulic pump shaft 32mm for JCB 3DX with oil seal and bearing kit, complete assembly' : 'charging pump 3D',
  qty: 1 + (index % 3), unit_price: 1250, line_total: 1250 * (1 + (index % 3)),
}));

const docWith = (items: DocItem[]) => buildInvoiceDocument({
  invoice: { id: 'INV-1017', date: '2026-10-12', customer: 'kareem', total: 5000, paid: 0, settlement_write_off: 0, gst_amount: 0, gst_mode: 'exclusive' },
  items, company: COMPANY, customer: { phone: '98765 43210' },
});

test('an everyday invoice is a real PDF of a few kilobytes', async () => {
  const bytes = await renderInvoicePdf(docWith(lines(5)));
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString('latin1'), '%PDF-');
  assert.ok(bytes.byteLength < 12_000, `one page should stay small, was ${bytes.byteLength} bytes`);
  const loaded = await PDFDocument.load(bytes);
  assert.equal(loaded.getPageCount(), 1);
  assert.equal(loaded.getTitle(), 'Invoice INV-1017');
});

test('a long invoice runs on to more pages instead of being cut off', async () => {
  const bytes = await renderInvoicePdf(docWith(lines(70)));
  const loaded = await PDFDocument.load(bytes);
  assert.ok(loaded.getPageCount() >= 2, `expected several pages, got ${loaded.getPageCount()}`);
  assert.ok(bytes.byteLength < 40_000, `still small at ${bytes.byteLength} bytes`);
});

test('characters the built-in fonts lack never stop an invoice from being saved', async () => {
  assert.equal(pdfSafe('₹500 — total'), 'Rs.500 — total');
  assert.equal(pdfSafe('पिन'), '???');
  const doc = buildInvoiceDocument({
    invoice: { id: 'INV-1018', date: '2026-10-12', customer: 'राम ट्रेडर्स', total: 100, paid: 100, settlement_write_off: 0 },
    items: [{ part_number: 'X—1', name: 'pin “original”', qty: 1, unit_price: 100, line_total: 100 }],
    company: COMPANY, customer: null,
  });
  const bytes = await renderInvoicePdf(doc);
  assert.ok(bytes.byteLength > 0);
});

test('the fingerprint changes exactly when what the invoice would print changes', () => {
  const unpaid = docWith(lines(2));
  const again = docWith(lines(2));
  const paid = buildInvoiceDocument({
    invoice: { id: 'INV-1017', date: '2026-10-12', customer: 'kareem', total: 5000, paid: 5000, settlement_write_off: 0, gst_amount: 0, gst_mode: 'exclusive' },
    items: lines(2), company: COMPANY, customer: { phone: '98765 43210' },
  });
  assert.equal(invoiceFingerprint(unpaid), invoiceFingerprint(again));
  assert.notEqual(invoiceFingerprint(unpaid), invoiceFingerprint(paid));
});
