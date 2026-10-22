import assert from 'node:assert/strict';
import test from 'node:test';
import { amountInWords, buildTallyInvoice, indianAmount, rupeesInWords, stateOfGstin, tallyDate, type TallyItemInput, type TallyInvoiceInput } from '../lib/tally-invoice';

const COMPANY = { name: 'Jai Durga Enterprises', address: 'Shop 12, Industrial Area, Mohali', gstin: '03ABCDE1234F1Z5', contact_phone: '98140 00000' };
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

test('the state and state code come from the GSTIN; dates read 21-Oct-2026', () => {
  assert.deepEqual(stateOfGstin('03ABCDE1234F1Z5'), { code: '03', name: 'Punjab' });
  assert.deepEqual(stateOfGstin('not a gstin'), { code: '', name: '' });
  assert.equal(tallyDate('2026-10-21'), '21-Oct-2026');
  assert.equal(tallyDate('2026-08-01'), '1-Aug-2026');
});

test('a sale inside the state splits the tax into CGST and SGST, and the HSN summary adds up', () => {
  const doc = buildTallyInvoice({
    invoice: invoice({ total: 1770, gst_amount: 270 }),
    items: [item(), item({ part_number: 'GN-1', name: 'grease nipple', qty: 10, unit_price: 50, line_total: 500, hsn: '84812000' })],
    company: COMPANY, customer: { address: 'Kharar', gstin: '03ZZZZZ9999Z1Z9', phone: '' },
  });
  assert.equal(doc.interState, false);
  assert.equal(doc.seller.state, 'Punjab');
  assert.deepEqual(doc.charges.map((c) => [c.label, c.rate, c.amount]), [['CGST', '9%', '135.00'], ['SGST', '9%', '135.00']]);
  assert.equal(doc.total, '1,770.00');
  assert.equal(doc.amountInWords, 'INR One Thousand Seven Hundred Seventy Only');
  assert.deepEqual(doc.taxRows.map((r) => [r.hsn, r.taxable, r.cgst, r.sgst, r.totalTax]), [['84314930', '1,000.00', '90.00', '90.00', '180.00'], ['84812000', '500.00', '45.00', '45.00', '90.00']]);
  assert.equal(doc.taxTotal.totalTax, '270.00');
  assert.equal(doc.itemsTotal, '1,500.00');
  assert.equal(doc.details[2][0], 'Payment Terms');
  assert.equal(doc.details[2][1], 'Cash');
  assert.ok(!('bank' in doc) && !('pan' in doc.seller), 'no PAN or bank details: the owner left them off');
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
  assert.deepEqual(doc.charges.map((c) => c.label), ['Less: Discount', 'Taxable value', 'CGST', 'SGST']);
  assert.equal(doc.charges[1].amount, '950.00');
  const sum = doc.taxRows.reduce((total, row) => total + Number(row.totalTax.replace(/,/g, '')), 0);
  assert.equal(Math.round(sum * 100) / 100, 153.02);
  const withReturn = buildTallyInvoice({ invoice: invoice({ total: 590, gst_amount: 90 }), items: [item()], company: COMPANY, customer: null, returns: [{ id: 'SRN-1001', subtotal: 500 }] });
  assert.equal(withReturn.charges[0].label, 'Less: Goods returned (SRN-1001)');
  assert.equal(withReturn.taxTotal.taxable, '500.00');
});

test('an older bill with no stored rate shows the rate its tax works out to, not 0%', () => {
  const doc = buildTallyInvoice({ invoice: invoice({ gst_percent: null, total: 295, gst_amount: 45 }), items: [item({ qty: 1, unit_price: 250, line_total: 250 })], company: COMPANY, customer: null });
  assert.deepEqual(doc.charges.map((c) => [c.label, c.rate, c.amount]), [['CGST', '9%', '22.50'], ['SGST', '9%', '22.50']]);
});

test('a cancelled invoice prints as issued, stamped, with no payment line', async () => {
  const { asIssued } = await import('../lib/tally-invoice');
  const row = { id: 'INV-1008', date: '2026-08-24', customer: 'Walk-in', total: 0, paid: 0, status: 'cancelled', cancelled_at: '2026-10-21T10:00:00Z', cancel_reason: 'Wrong customer',
    cancelled_copy: { invoice: { id: 'INV-1008', date: '2026-08-24', customer: 'Walk-in', total: 295, paid: 100, gst_percent: 18, gst_amount: 45, gst_mode: 'exclusive', status: 'unpaid' }, items: [item({ qty: 1, unit_price: 250, line_total: 250 })] } };
  const issued = asIssued(row as Record<string, unknown>, [] as ReturnType<typeof item>[]);
  const doc = buildTallyInvoice({ invoice: issued.invoice as unknown as TallyInvoiceInput, items: issued.items, company: COMPANY, customer: null });
  assert.equal(doc.total, '295.00');
  assert.deepEqual(doc.cancelled, { on: '21-Oct-2026', reason: 'Wrong customer' });
  assert.equal(doc.payment, null);
  const live = asIssued({ id: 'INV-1', status: 'paid' } as Record<string, unknown>, [1, 2]);
  assert.deepEqual(live.items, [1, 2], 'an invoice never cancelled prints as it is');
});

/** After the owner's reference bill: the letterhead carries the website, the MSME (Udyam) number
 *  and the IE Code, each only when filled in. PAN stays off. */
test('the letterhead shows phone, e-mail, website, GSTIN, Udyam No. and IE Code, leaving out what is blank', () => {
  const full = buildTallyInvoice({
    invoice: invoice(), items: [item()], customer: null,
    company: { ...COMPANY, contact_email: 'jde@example.com', website: 'www.jde.example', udyam_no: 'udyam-ch-01-0001234', iec_code: '0312345678' },
  });
  assert.equal(full.letterhead.contact, 'Phone: 98140 00000   |   E-mail: jde@example.com   |   Website: www.jde.example');
  assert.equal(full.letterhead.gstin, 'GSTIN/UIN: 03ABCDE1234F1Z5   |   Punjab (03)');
  assert.equal(full.letterhead.registrations, 'MSME (Udyam) No.: UDYAM-CH-01-0001234   |   IE Code: 0312345678');
  assert.ok(!JSON.stringify(full.letterhead).includes('PAN'));

  const bare = buildTallyInvoice({ invoice: invoice(), items: [item()], customer: null, company: { name: 'Jai Durga Enterprises', udyam_no: '  ' } });
  assert.deepEqual(bare.letterhead, { contact: '', gstin: '', registrations: '' });
});

test('a bill from a company with no GSTIN but a state set prints IGST to another state', () => {
  const doc = buildTallyInvoice({
    invoice: invoice({ place_of_supply: '02', total: 1180, gst_amount: 180 }), items: [item()], customer: null,
    company: { name: 'bkgkj', gstin: '', state_code: '04' },
  });
  assert.equal(doc.interState, true);
  assert.deepEqual(doc.charges.map((c) => c.label), ['IGST']);
  assert.equal(doc.seller.state, 'Chandigarh');
});

/** The owner found the HSN-wise tax table too much. The tax lines above the grand total carry the
 *  tax; "Taxable value" is added there only where the goods total does not already say it. */
test('the taxable value shows above the tax only after deductions', () => {
  const plain = buildTallyInvoice({ invoice: invoice(), items: [item()], company: COMPANY, customer: null });
  assert.deepEqual(plain.charges.map((c) => c.label), ['CGST', 'SGST']);
});

/** The owner's GST-inclusive bill read wrong: goods 12,000.00, then 10,169.49 and 1,830.51 under it,
 *  then a grand total of 12,000.00. Tally prints such a bill before GST, so it adds up downwards. */
test('a bill whose prices include GST is printed before GST and adds up to its grand total', () => {
  const doc = buildTallyInvoice({
    invoice: invoice({ total: 12000, gst_amount: 1830.51, gst_mode: 'inclusive' }),
    items: [item({ qty: 1, unit_price: 12000, line_total: 12000 })],
    company: COMPANY, customer: { gstin: '06AAAAA1111A1Z1' },
  });
  assert.equal(doc.items[0].rate, '10,169.49');
  assert.equal(doc.items[0].amount, '10,169.49');
  assert.equal(doc.itemsTotal, '10,169.49');
  assert.deepEqual(doc.charges.map((c) => [c.label, c.rate, c.amount]), [['IGST', '18%', '1,830.51']]);
  assert.equal(doc.total, '12,000.00');

  // With a discount and several lines, the paise still meet: goods - discount + tax = total.
  const mixed = buildTallyInvoice({
    invoice: invoice({ total: 950, discount_percent: 5, discount_amount: 50, gst_amount: 144.92, gst_mode: 'inclusive' }),
    items: [item({ qty: 1, unit_price: 333.33, line_total: 333.33 }), item({ qty: 1, unit_price: 333.33, line_total: 333.33 }), item({ qty: 1, unit_price: 333.34, line_total: 333.34 })],
    company: COMPANY, customer: null,
  });
  const money = (value: string) => Number(value.replace(/[,-]/g, ''));
  const goods = mixed.items.reduce((sum, line) => sum + money(line.amount), 0);
  assert.equal(Math.round(goods * 100) / 100, money(mixed.itemsTotal));
  const discount = money(mixed.charges.find((c) => c.label === 'Less: Discount')!.amount);
  const taxes = mixed.charges.filter((c) => /GST/.test(c.label)).reduce((sum, c) => sum + money(c.amount), 0);
  assert.equal(Math.round((money(mixed.itemsTotal) - discount + taxes) * 100) / 100, 950);
  assert.equal(mixed.charges.find((c) => c.label === 'Taxable value')!.amount, '805.08');
});
