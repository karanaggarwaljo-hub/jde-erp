import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { buildTallyInvoice, type TallyItemInput } from '../lib/tally-invoice';
import { pdfSafe, renderTallyInvoicePdf } from '../lib/tally-invoice-pdf';
import { invoiceFingerprint } from '../lib/invoice-archive';

const COMPANY = { name: 'Jai Durga Enterprises', address: 'Shop 12, Industrial Area, Mohali', gstin: '03ABCDE1234F1Z5', contact_phone: '98140 00000', bank_name: 'HDFC Bank', bank_account_no: '50200012345678', bank_ifsc: 'HDFC0001234', bank_branch: 'Mohali' };

const lines = (n: number): TallyItemInput[] => Array.from({ length: n }, (_, index) => ({
  part_number: `20-90${String(index).padStart(4, '0')}`,
  name: index % 7 === 0 ? 'hydraulic pump shaft 32mm for JCB 3DX with oil seal and bearing kit, complete assembly' : 'charging pump 3D',
  qty: 1 + (index % 3), unit_price: 1250, line_total: 1250 * (1 + (index % 3)), hsn: index % 2 ? '84314930' : '84136090',
}));

const docWith = (items: TallyItemInput[], paid = 0) => buildTallyInvoice({
  invoice: { id: 'INV-1017', date: '2026-10-12', customer: 'kareem', total: 5900, paid, settlement_write_off: 0, gst_percent: 18, gst_amount: 900, gst_mode: 'exclusive', mode: 'credit' },
  items, company: COMPANY, customer: { phone: '98765 43210', gstin: '03ZZZZZ9999Z1Z9', address: 'Kharar' },
});

test('an everyday Tally-style invoice is a real one-page PDF of a few kilobytes', async () => {
  const bytes = await renderTallyInvoicePdf(docWith(lines(5)));
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString('latin1'), '%PDF-');
  assert.ok(bytes.byteLength < 16_000, `one page should stay small, was ${bytes.byteLength} bytes`);
  const loaded = await PDFDocument.load(bytes);
  assert.equal(loaded.getPageCount(), 1);
  assert.equal(loaded.getTitle(), 'Tax Invoice INV-1017');
});

test('a long invoice carries its goods on to more pages instead of being cut off', async () => {
  const bytes = await renderTallyInvoicePdf(docWith(lines(70)));
  const loaded = await PDFDocument.load(bytes);
  assert.ok(loaded.getPageCount() >= 2, `expected several pages, got ${loaded.getPageCount()}`);
  assert.ok(bytes.byteLength < 60_000, `still small at ${bytes.byteLength} bytes`);
});

test('characters the built-in fonts lack never stop an invoice from being saved', async () => {
  assert.equal(pdfSafe('₹500 — total'), 'Rs.500 — total');
  assert.equal(pdfSafe('पिन'), '???');
  const doc = buildTallyInvoice({
    invoice: { id: 'INV-1018', date: '2026-10-12', customer: 'राम ट्रेडर्स', total: 100, paid: 100, settlement_write_off: 0 },
    items: [{ part_number: 'X—1', name: 'pin “original”', qty: 1, unit_price: 100, line_total: 100 }],
    company: COMPANY, customer: null,
  });
  assert.ok((await renderTallyInvoicePdf(doc)).byteLength > 0);
});

test('an inter-state invoice and one with no line items both draw', async () => {
  const igst = buildTallyInvoice({ invoice: { id: 'INV-1', date: '2026-10-12', customer: 'Haryana Co', total: 1180, paid: 0, gst_percent: 18, gst_amount: 180 }, items: lines(2), company: COMPANY, customer: { gstin: '06AAAAA1111A1Z1' } });
  assert.equal(igst.interState, true);
  assert.ok((await renderTallyInvoicePdf(igst)).byteLength > 0);
  const old = buildTallyInvoice({ invoice: { id: 'INV-2', date: '2026-01-02', customer: 'old', total: 500, paid: 0 }, items: [], company: { name: 'X' }, customer: null });
  assert.ok((await renderTallyInvoicePdf(old)).byteLength > 0);
});

test('the fingerprint changes exactly when what the invoice would print changes', () => {
  assert.equal(invoiceFingerprint(docWith(lines(2))), invoiceFingerprint(docWith(lines(2))));
  assert.notEqual(invoiceFingerprint(docWith(lines(2))), invoiceFingerprint(docWith(lines(2), 5900)));
});
