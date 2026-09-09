import assert from 'node:assert/strict';
import test from 'node:test';
import { amountReceived, billTotals, lineGross, lineNet, lineDiscountPercent } from '../lib/invoice-totals';

test('a plain bill with no discount and no tax', () => {
  const t = billTotals({ lines: [{ qty: 2, price: 6000 }], discountPercent: 0, gstPercent: 0, gstInclusive: false });
  assert.equal(t.grossSubtotal, 12000);
  assert.equal(t.subtotal, 12000);
  assert.equal(t.itemDiscountTotal, 0);
  assert.equal(t.gstAmount, 0);
  assert.equal(t.total, 12000);
});

/** From the owner's real invoice INV-1011. */
test('a per-line discount comes off that line only', () => {
  const t = billTotals({
    lines: [{ qty: 1, price: 7170, discount: 15 }, { qty: 1, price: 6000 }],
    discountPercent: 0, gstPercent: 0, gstInclusive: false,
  });
  assert.equal(t.grossSubtotal, 13170);
  assert.equal(t.itemDiscountTotal, 1075.5);
  assert.equal(t.subtotal, 12094.5);
  assert.equal(t.total, 12094.5);
});

/** The order matters: line discounts first, then the bill-wide one on what remains. */
test('the two discounts stack in the fixed order', () => {
  const t = billTotals({
    lines: [{ qty: 1, price: 1000, discount: 10 }],
    discountPercent: 10, gstPercent: 0, gstInclusive: false,
  });
  assert.equal(t.subtotal, 900, 'line discount first');
  assert.equal(t.discountAmount, 90, 'bill discount applies to 900, not to 1000');
  assert.equal(t.taxableAmount, 810);
});

test('GST added on top when prices exclude it', () => {
  const t = billTotals({ lines: [{ qty: 1, price: 1000 }], discountPercent: 0, gstPercent: 18, gstInclusive: false });
  assert.equal(t.taxableAmount, 1000);
  assert.equal(t.netTaxableValue, 1000, 'the tax is charged on the full 1000');
  assert.equal(t.gstAmount, 180);
  assert.equal(t.total, 1180);
});

test('GST taken out when prices already contain it', () => {
  const t = billTotals({ lines: [{ qty: 1, price: 1180 }], discountPercent: 0, gstPercent: 18, gstInclusive: true });
  assert.equal(t.total, 1180, 'the customer pays the price on the label');
  assert.equal(t.gstAmount, 180);
  assert.equal(t.netTaxableValue, 1000, 'and the taxable value is what is left underneath');
});

test('the two GST modes describe the same sale from both ends', () => {
  const exclusive = billTotals({ lines: [{ qty: 1, price: 1000 }], discountPercent: 0, gstPercent: 18, gstInclusive: false });
  const inclusive = billTotals({ lines: [{ qty: 1, price: 1180 }], discountPercent: 0, gstPercent: 18, gstInclusive: true });
  assert.equal(exclusive.total, inclusive.total);
  assert.equal(exclusive.gstAmount, inclusive.gstAmount);
  assert.equal(exclusive.netTaxableValue, inclusive.netTaxableValue);
});

/** The reason this module exists. The invoice screen used to round nowhere, which is how
 *  INV-1005 came to be stored as 5002.624 — three decimals in a money column. */
test('every figure comes out at two decimals, never floating-point noise', () => {
  const t = billTotals({
    lines: [{ qty: 3, price: 1667.541 }, { qty: 7, price: 0.07 }],
    discountPercent: 7.5, gstPercent: 18, gstInclusive: false,
  });
  for (const [name, value] of Object.entries(t)) {
    assert.equal(value, Math.round(value * 100) / 100, `${name} = ${value} must be a real 2dp amount`);
  }
});

test('a halfway paisa rounds up, the way a price list expects', () => {
  assert.equal(lineGross({ qty: 1, price: 1.005 }), 1.01);
  assert.equal(lineGross({ qty: 3, price: 0.005 }), 0.02);
});

test('a nonsense discount is clamped rather than obeyed', () => {
  assert.equal(lineDiscountPercent({ qty: 1, price: 100, discount: 150 }), 100);
  assert.equal(lineDiscountPercent({ qty: 1, price: 100, discount: -20 }), 0);
  assert.equal(lineNet({ qty: 1, price: 100, discount: 150 }), 0, 'a 100% discount is free, never negative');
});

test('missing or unreadable numbers count as nothing, not NaN', () => {
  const t = billTotals({
    lines: [{ qty: '2', price: '500' }, { qty: undefined as unknown as number, price: 100 }],
    discountPercent: NaN, gstPercent: NaN, gstInclusive: false,
  });
  assert.equal(t.subtotal, 1000);
  assert.equal(t.total, 1000);
  assert.ok(Number.isFinite(t.gstAmount));
});

test('an empty bill is zero everywhere, not an empty object', () => {
  const t = billTotals({ lines: [], discountPercent: 10, gstPercent: 18, gstInclusive: false });
  assert.equal(t.total, 0);
  assert.equal(t.gstAmount, 0);
  assert.equal(t.grossSubtotal, 0);
});

// ── What was received ────────────────────────────────────────────────────────────────────────

test('paid in full receives the whole bill', () => {
  assert.equal(amountReceived('paid', 1180, 0), 1180);
});

test('unpaid receives nothing, whatever was typed', () => {
  assert.equal(amountReceived('unpaid', 1180, 500), 0);
});

test('a part payment is clamped to the bill', () => {
  assert.equal(amountReceived('partial', 1180, 500), 500);
  assert.equal(amountReceived('partial', 1180, 99999), 1180, 'cannot receive more than it is worth');
  assert.equal(amountReceived('partial', 1180, -50), 0, 'nor a negative amount');
});
