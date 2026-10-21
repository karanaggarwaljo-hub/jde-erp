import assert from 'node:assert/strict';
import test from 'node:test';
import { amountInWords, buildTallyInvoice, indianAmount, panOfGstin, rupeesInWords, stateOfGstin, tallyDate, type TallyItemInput, type TallyInvoiceInput } from '../lib/tally-invoice';

const COMPANY = { name: 'Jai Durga Enterprises', address: 'Shop 12, Industrial Area, Mohali', gstin: '03ABCDE1234F1Z5', contact_phone: '98140 00000', bank_name: 'HDFC Bank', bank_account_no: '50200012345678', bank_ifsc: 'hdfc0001234', bank_branch: 'Phase 7, Mohali' };
const invoice = (overrides: Partial<TallyInvoiceInput> = {}): TallyInvoiceInput => ({
  id: 'INV-1021', date: '2026-10-21', customer: 'Sharma Earthmovers', total: 1180, paid: 0, mode: 'cash',
  settlement_write_off: 0, discount_percent: 0, discount_amount: 0, gst_percent: 18, gst_amount: 180, gst_mode: 'exclusive',
  ...overrides,
});
const item = (overrides: Partial<TallyItemInput> = {}): TallyItemInput => ({
  part_number: '911-12400', name: 'bkt main pin', qty: 2, unit_price: 500, line_total: 1000, discount_percent: 0, discount_amount: 0, hsn: '84314930',
  ...overrides,
});

test('amounts are grouped the Indian way and written in words as Tally does', () => {
  assert.equal(indianAmount(1234567.5), '12,34,567.50');
  assert.equal(indianAmount(999), '999.00');
  assert.equal(indianAmount(-1500), '-1,500.00');
  assert.equal(rupeesInWords(125000), 'One Lakh Twenty Five Thousand');
  assert.equal(rupeesInWords(10600), 'Ten Thousand Six Hundred');
  assert.equal(rupeesInWords(23456789), 'Two Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine');
  assert.equal(amountInWords(1180.5), 'INR One Thousand One Hundred Eighty and Fifty paise Only');
  assert.equal(amountInWords(0), 'INR Zero Only');
});

test('the state, state code and PAN come from the GSTIN; the date is Tally\'s', () => {
  assert.deepEqual(stateOfGstin('03ABCDE1234F1Z5'), { code: '03', name: 'Punjab' });
  assert.deepEqual(stateOfGstin('not a gstin'), { code: '', name: '' });
  assert.equal(panOfGstin('03abcde1234f1z5'), 'ABCDE1234F');
  assert.equal(tallyDate('2026-10-21'), '21-Oct-26');
});

test('a sale inside the state splits the tax into CGST and SGST, and the HSN summary adds up', () => {
  const doc = buildTallyInvoice({
    invoice: invoice({ total: 1770, gst_amount: 270 }),
    items: [item(), item({ part_number: 'GN-1', name: 'grease nipple', qty: 10, unit_price: 50, line_total: 500, hsn: '84812000' })],
    company: COMPANY, customer: { address: 'Kharar', gstin: '03ZZZZZ9999Z1Z9', phone: '' },
  });
  assert.equal(doc.interState, false);
  assert.equal(doc.seller.state, 'Punjab');
  assert.equal(doc.seller.pan, 'ABCDE1234F');
  assert.deepEqual(doc.charges.map((c) => [c.label, c.rate, c.amount]), [['CGST', '9%', '135.00'], ['SGST', '9%', '135.00']]);
  assert.equal(doc.total, '1,770.00');
  assert.equal(doc.amountInWords, 'INR One Thousand Seven Hundred Seventy Only');
  assert.deepEqual(doc.taxRows.map((r) => [r.hsn, r.taxable, r.cgst, r.sgst, r.totalTax]), [['84314930', '1,000.00', '90.00', '90.00', '180.00'], ['84812000', '500.00', '45.00', '45.00', '90.00']]);
  assert.equal(doc.taxTotal.totalTax, '270.00');
  assert.deepEqual(doc.bank, { name: 'HDFC Bank', account: '50200012345678', ifsc: 'HDFC0001234', branch: 'Phase 7, Mohali' });
  assert.equal(doc.details[3][1], 'Cash');
});

test('a buyer in another state is charged IGST; a counter sale with no GSTIN is in the seller\'s state', () => {
  const outside = buildTallyInvoice({ invoice: invoice(), items: [item()], company: COMPANY, customer: { gstin: '06AAAAA1111A1Z1' } });
  assert.equal(outside.interState, true);
  assert.equal(outside.buyer.state, 'Haryana');
  assert.deepEqual(outside.charges.map((c) => [c.label, c.rate, c.amount]), [['IGST', '18%', '180.00']]);
  assert.equal(outside.taxRows[0].igst, '180.00');
  const counter = buildTallyInvoice({ invoice: invoice({ customer: '' }), items: [item()], company: COMPANY, customer: null });
  assert.equal(counter.interState, false);
  assert.equal(counter.buyer.name, 'Cash');
  assert.equal(counter.buyer.stateCode, '03');
});

test('returns and the bill discount come off before the tax, and odd paise land on the last HSN', () => {
  const doc = buildTallyInvoice({
    invoice: invoice({ total: 1003.02, discount_percent: 5, discount_amount: 50, gst_amount: 153.02 }),
    items: [item({ line_total: 333.33, hsn: 'A' }), item({ line_total: 333.33, hsn: 'B' }), item({ line_total: 333.34, hsn: 'C' })],
    company: COMPANY, customer: null, returns: [],
  });
  assert.deepEqual(doc.charges.map((c) => c.label), ['Less: Discount', 'CGST', 'SGST']);
  const sum = doc.taxRows.reduce((total, row) => total + Number(row.totalTax.replace(/,/g, '')), 0);
  assert.equal(Math.round(sum * 100) / 100, 153.02);
  const withReturn = buildTallyInvoice({ invoice: invoice({ total: 590, gst_amount: 90 }), items: [item()], company: COMPANY, customer: null, returns: [{ id: 'SRN-1001', subtotal: 500 }] });
  assert.equal(withReturn.charges[0].label, 'Less: Goods returned (SRN-1001)');
  assert.equal(withReturn.taxTotal.taxable, '500.00');
});
