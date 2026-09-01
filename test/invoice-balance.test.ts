import assert from 'node:assert/strict';
import test from 'node:test';
import {
  invoiceBalanceDue,
  invoicePaid,
  invoiceWrittenOff,
  isInvoiceOpen,
  wasSettledShort,
} from '../lib/invoice-balance';

test('an ordinary unpaid invoice still owes its full total', () => {
  const invoice = { total: 41356.75, paid: 0 };
  assert.equal(invoiceBalanceDue(invoice), 41356.75);
  assert.equal(isInvoiceOpen(invoice), true);
  assert.equal(wasSettledShort(invoice), false);
});

test('a part payment leaves the rest owing', () => {
  const invoice = { total: 41356.75, paid: 40000 };
  assert.equal(Math.round(invoiceBalanceDue(invoice) * 100) / 100, 1356.75);
  assert.equal(isInvoiceOpen(invoice), true);
});

/** The situation this whole feature exists for. */
test('a customer who settles by paying less closes the invoice', () => {
  const invoice = { total: 41356.75, paid: 40000, settlement_write_off: 1356.75 };
  assert.equal(invoiceBalanceDue(invoice), 0);
  assert.equal(isInvoiceOpen(invoice), false);
  assert.equal(wasSettledShort(invoice), true);
});

test('what was written off is never counted as money received', () => {
  const invoice = { total: 41356.75, paid: 40000, settlement_write_off: 1356.75 };
  assert.equal(invoicePaid(invoice), 40000, 'paid must stay the cash that actually arrived');
  assert.equal(invoiceWrittenOff(invoice), 1356.75);
});

test('a partial write-off still leaves the remainder owing', () => {
  const invoice = { total: 5000, paid: 1000, settlement_write_off: 500 };
  assert.equal(invoiceBalanceDue(invoice), 3500);
  assert.equal(isInvoiceOpen(invoice), true);
  assert.equal(wasSettledShort(invoice), true);
});

test('rows saved before settlements existed behave exactly as before', () => {
  for (const missing of [undefined, null, 0]) {
    const invoice = { total: 1000, paid: 400, settlement_write_off: missing as number | null | undefined };
    assert.equal(invoiceBalanceDue(invoice), 600);
    assert.equal(wasSettledShort(invoice), false);
  }
});

/** Summing balances across invoices must not let one customer's overpayment hide another's debt. */
test('an over-payment reads as nothing owing, not as a negative balance', () => {
  assert.equal(invoiceBalanceDue({ total: 1000, paid: 1200 }), 0);
  const owed = [{ total: 1000, paid: 1200 }, { total: 500, paid: 0 }]
    .reduce((sum, invoice) => sum + invoiceBalanceDue(invoice), 0);
  assert.equal(owed, 500, 'the 500 still owed must not be cancelled out by the 200 overpaid');
});

test('a rounding crumb left over is treated as settled', () => {
  const invoice = { total: 1000, paid: 999.995 };
  assert.equal(isInvoiceOpen(invoice), false);
});

test('string amounts from the database are read as numbers, not concatenated', () => {
  const invoice = { total: '41356.75', paid: '40000', settlement_write_off: '1356.75' };
  assert.equal(invoiceBalanceDue(invoice), 0);
  assert.equal(invoiceWrittenOff(invoice), 1356.75);
});

test('junk in the column is treated as nothing rather than poisoning the arithmetic', () => {
  const invoice = { total: 1000, paid: 200, settlement_write_off: 'n/a' };
  assert.equal(invoiceBalanceDue(invoice), 800);
});
