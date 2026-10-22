import assert from 'node:assert/strict';
import test from 'node:test';
import { supplyTax, stateCodeOfGstin } from '../lib/gst-supply';
import { buildTallyInvoice } from '../lib/tally-invoice';

const CHANDIGARH = '04AGOPA6394H1ZA';
const PUNJAB_BUYER = '03ZZZZZ9999Z1Z9';

test('a sale inside Chandigarh, a Union Territory, is CGST + UTGST', () => {
  const counter = supplyTax(CHANDIGARH, null);
  assert.deepEqual([counter.kind, counter.localTax, counter.placeCode, counter.placeName, counter.localTaxColumn], ['intra', 'UTGST', '04', 'Chandigarh', 'UT Tax']);
  assert.equal(supplyTax(CHANDIGARH, '04ZZZZZ9999Z1Z9').localTax, 'UTGST');
});

test('Delhi and Puducherry have legislatures, so they charge SGST like a state', () => {
  assert.equal(supplyTax('07AAAAA1111A1Z1', null).localTax, 'SGST');
  assert.equal(supplyTax('34AAAAA1111A1Z1', null).localTax, 'SGST');
  assert.equal(supplyTax('03AAAAA1111A1Z1', null).localTax, 'SGST');
});

test('a buyer in another state, by GSTIN or by the place chosen on the bill, is IGST', () => {
  assert.equal(supplyTax(CHANDIGARH, PUNJAB_BUYER).kind, 'inter');
  // A walk-in from Punjab with no GSTIN: the place picked on the bill decides.
  const picked = supplyTax(CHANDIGARH, null, '03');
  assert.deepEqual([picked.kind, picked.placeName], ['inter', 'Punjab']);
  // The place picked wins over the GSTIN, e.g. goods sent to the buyer's site in Chandigarh.
  assert.equal(supplyTax(CHANDIGARH, PUNJAB_BUYER, '04').kind, 'intra');
  // Nonsense is ignored.
  assert.equal(supplyTax(CHANDIGARH, null, 'XX').placeCode, '04');
  assert.equal(supplyTax(null, PUNJAB_BUYER).kind, 'unknown');
  assert.equal(stateCodeOfGstin('not one'), '');
});

test('the invoice prints UTGST and a UT Tax column for Chandigarh, and IGST for a chosen other state', () => {
  const base = { id: 'INV-1', date: '2026-10-21', customer: 'Walk-in', total: 1180, paid: 0, gst_percent: 18, gst_amount: 180, gst_mode: 'exclusive' };
  const items = [{ part_number: 'P1', name: 'pin', qty: 1, unit_price: 1000, line_total: 1000, hsn: '8431' }];
  const company = { name: 'Jai Durga Enterprises', gstin: CHANDIGARH };
  const local = buildTallyInvoice({ invoice: base, items, company, customer: null });
  assert.deepEqual(local.charges.map((c) => c.label), ['CGST', 'UTGST']);
  assert.equal(local.localTaxColumn, 'UT Tax');
  assert.equal(local.buyer.state, 'Chandigarh');
  const away = buildTallyInvoice({ invoice: { ...base, place_of_supply: '03' }, items, company, customer: null });
  assert.deepEqual(away.charges.map((c) => [c.label, c.amount]), [['IGST', '180.00']]);
  assert.equal(away.buyer.state, 'Punjab');
});

/** The owner's test bill to Himachal Pradesh printed CGST + SGST: the company had no GSTIN, so the
 *  shop's own state was unknown. A company without a GSTIN now has its state chosen in Settings. */
test('a company with no GSTIN uses the state chosen in Settings, and its GSTIN wins when it has one', () => {
  assert.equal(supplyTax('', null, '02').kind, 'unknown');
  const himachal = supplyTax('', null, '02', '04');
  assert.equal(himachal.kind, 'inter');
  assert.equal(supplyTax('', null, null, '04').kind, 'intra');
  assert.equal(supplyTax('', null, null, '04').localTax, 'UTGST');
  assert.equal(supplyTax('03AAAAA1111A1Z1', null, '03', '04').kind, 'intra');
  assert.equal(supplyTax('', null, '02', 'XX').kind, 'unknown');
});
