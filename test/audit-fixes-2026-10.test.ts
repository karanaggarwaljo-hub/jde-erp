/**
 * The operation audit of October 2026: each test pins one fix, so the bug cannot quietly return.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { costOfSales, grossProfit, outputTaxSplit } from '../lib/period-accounts';
import { invoiceBalanceDue, isInvoiceOpen } from '../lib/invoice-balance';
import { paymentTerms } from '../lib/tally-invoice';
import { withOpeningBalance, withoutProtectedColumns } from '../lib/generic-write-guard';
import { describeReset, startFreshPlan, type StartFreshCounts } from '../lib/start-fresh';

test('gross profit is worked from sales before GST, not the GST-inclusive total', () => {
  // ₹1,180 billed = ₹1,000 of goods + ₹180 GST; the goods cost ₹600.
  const invoices = [{ id: 'INV-1', total: 1180, gst_amount: 180 }];
  const cost = costOfSales(invoices, [{ id: 'L1', invoice_id: 'INV-1' }], [{ invoice_item_id: 'L1', qty: 1, unit_cost: 600 }]);
  const profit = grossProfit(invoices, cost);
  assert.equal(profit?.salesIncludingGst, 1180);
  assert.equal(profit?.gstCollected, 180);
  assert.equal(profit?.netSales, 1000);
  assert.equal(profit?.grossProfit, 400); // was 580, counting the tax as profit
  assert.equal(profit?.marginPercent, 40);
});

test('a parked draft and a cancelled bill owe nothing, so they never reach payments, reminders or receivables', () => {
  assert.equal(invoiceBalanceDue({ total: 1000, paid: 0, status: 'draft' }), 0);
  assert.equal(isInvoiceOpen({ total: 1000, paid: 0, status: 'draft' }), false);
  assert.equal(invoiceBalanceDue({ total: 0, paid: 0, status: 'cancelled' }), 0);
  assert.equal(invoiceBalanceDue({ total: 1000, paid: 400, status: 'partial' }), 600);
  assert.equal(invoiceBalanceDue({ total: 1000, paid: 0 }), 1000);
});

test('output GST is split by each bill\'s place of supply: IGST to other states, CGST + UTGST in Chandigarh', () => {
  const seller = { gstin: '04AGOPA6394H1ZA', state_code: null };
  const gstins = new Map<string, string>([['Punjab Buyer', '03ABCDE1234F1Z5']]);
  const split = outputTaxSplit([
    { customer: 'Punjab Buyer', gst_amount: 180 }, // to Punjab by GSTIN: IGST
    { customer: 'Walk-in Customer', gst_amount: 90 }, // counter sale in Chandigarh: CGST + UTGST
    { customer: 'Walk-in Customer', gst_amount: 36, place_of_supply: '02' }, // chosen Himachal: IGST
  ], seller, (name) => gstins.get(name));
  assert.deepEqual(split, { igst: 216, cgst: 45, stateTax: 45, stateTaxName: 'UTGST' });
});

test('a bill closed for less than it was billed says Settled, not Paid', () => {
  assert.equal(paymentTerms('Credit', 900, 0, 100), 'Settled');
  assert.equal(paymentTerms('Credit', 1000, 0, 0), 'Paid');
});

test('a plain edit cannot set stock or what is owed; a new customer or supplier starts at nothing', () => {
  assert.deepEqual(withoutProtectedColumns('products', { name: 'pin', current_stock: 50, cost_price: 10 }), { name: 'pin', cost_price: 10 });
  assert.deepEqual(withoutProtectedColumns('customers', { phone: '1', balance: 9999 }), { phone: '1' });
  assert.deepEqual(withoutProtectedColumns('suppliers', { balance: -4000 }), {});
  assert.equal(withOpeningBalance('suppliers', { name: 'x', balance: 5000 }).balance, 0);
  assert.equal(withOpeningBalance('products', { name: 'x', current_stock: 5 }).current_stock, 5);
});

test('start fresh names job cards and cheques among what goes, and says what is kept', () => {
  const counts: StartFreshCounts = {
    parts: 10, partsWithStock: 0, partsWithPrices: 0, invoices: 0, quotations: 0, salesReturns: 0, paymentsReceived: 0, writeOffs: 0,
    purchases: 0, purchaseReturns: 0, supplierPayments: 0, expenses: 0, customers: 0, suppliers: 1, liveOnWebsite: 0, jobCards: 2, cheques: 1,
  };
  const plan = startFreshPlan(counts);
  assert.ok(plan.deleted.includes('2 job cards'));
  assert.ok(plan.deleted.includes('1 cheque in the register'));
  assert.ok(plan.kept.some((line) => line.includes('Supplier bill files')));
  assert.match(describeReset({ job_cards: 2, cheques: 1, parts_cleared: 0 }), /2 job cards, 1 cheque in the register/);
});
