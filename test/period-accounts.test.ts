import assert from 'node:assert/strict';
import test from 'node:test';
import { costOfSales, grossProfit, gstPosition } from '../lib/period-accounts';

const invoice = (id: string, total: number) => ({ id, total });
const line = (id: string, invoiceId: string) => ({ id, invoice_id: invoiceId });
const draw = (itemId: string, qty: number, unitCost: number) =>
  ({ invoice_item_id: itemId, qty, unit_cost: unitCost });

// ── What the goods cost ──────────────────────────────────────────────────────────────────────

test('cost of sales is what the batches actually cost, not what was bought that month', () => {
  const cost = costOfSales(
    [invoice('INV-1', 1000)],
    [line('L1', 'INV-1'), line('L2', 'INV-1')],
    [draw('L1', 2, 100), draw('L2', 1, 250)]
  );
  assert.equal(cost.cost, 450);
  assert.equal(cost.complete, true);
});

test('one line drawn from two batches costs what both batches cost', () => {
  const cost = costOfSales([invoice('INV-1', 1000)], [line('L1', 'INV-1')], [draw('L1', 3, 100), draw('L1', 2, 200)]);
  assert.equal(cost.cost, 700);
});

test('invoices outside the period are left out', () => {
  const cost = costOfSales(
    [invoice('INV-1', 1000)],
    [line('L1', 'INV-1'), line('L9', 'INV-9')],
    [draw('L1', 1, 100), draw('L9', 1, 5000)]
  );
  assert.equal(cost.cost, 100);
});

/** A line with no recorded cost must never count as free — that reports the whole line as profit. */
test('a line with no recorded cost is counted, not valued at zero', () => {
  const cost = costOfSales(
    [invoice('INV-1', 1000)],
    [line('L1', 'INV-1'), line('L2', 'INV-1')],
    [draw('L1', 1, 100)]
  );
  assert.equal(cost.cost, 100);
  assert.equal(cost.linesWithoutCost, 1);
  assert.equal(cost.invoicesAffected, 1);
  assert.equal(cost.complete, false);
});

test('an empty period is complete rather than unknown', () => {
  const cost = costOfSales([], [], []);
  assert.equal(cost.cost, 0);
  assert.equal(cost.complete, true);
});

// ── What the sales earned ────────────────────────────────────────────────────────────────────

test('gross profit is sales less what those sales cost', () => {
  const invoices = [invoice('INV-1', 1000), invoice('INV-2', 500)];
  const cost = costOfSales(invoices, [line('L1', 'INV-1'), line('L2', 'INV-2')], [draw('L1', 1, 400), draw('L2', 1, 200)]);
  const profit = grossProfit(invoices, cost);
  assert.ok(profit);
  assert.equal(profit.netSales, 1500);
  assert.equal(profit.costOfSales, 600);
  assert.equal(profit.grossProfit, 900);
  assert.equal(profit.marginPercent, 60);
});

test('selling below cost is reported as the loss it is', () => {
  const invoices = [invoice('INV-1', 100)];
  const cost = costOfSales(invoices, [line('L1', 'INV-1')], [draw('L1', 1, 250)]);
  const profit = grossProfit(invoices, cost);
  assert.equal(profit?.grossProfit, -150);
});

/** The rule the settle-and-close dialog already follows: no cost, no figure. */
test('no profit figure at all when part of the cost is unknown', () => {
  const invoices = [invoice('INV-1', 1000)];
  const cost = costOfSales(invoices, [line('L1', 'INV-1'), line('L2', 'INV-1')], [draw('L1', 1, 100)]);
  assert.equal(grossProfit(invoices, cost), null);
});

test('a period with no sales has no margin percentage', () => {
  assert.equal(grossProfit([], costOfSales([], [], []))?.marginPercent, null);
});

// ── What tax the documents actually carry ────────────────────────────────────────────────────

/** The bug this replaces: the panel divided every total by 1.18 and called the difference tax
 *  collected. Not one invoice on the real data charges any GST, so it reported roughly ₹11,700
 *  of output tax that was never charged to anybody. */
test('with no tax on any document, there is nothing to report rather than a derived figure', () => {
  const position = gstPosition([{ gst_amount: 0 }, { gst_amount: null }], [{ gst_amount: null }]);
  assert.equal(position.outputTax, 0);
  assert.equal(position.inputTax, 0);
  assert.equal(position.anyTaxRecorded, false);
  assert.equal(position.invoicesWithTax, 0);
});

test('tax comes from what the documents record', () => {
  const position = gstPosition([{ gst_amount: 180 }, { gst_amount: 90 }], [{ gst_amount: 45 }]);
  assert.equal(position.outputTax, 270);
  assert.equal(position.inputTax, 45);
  assert.equal(position.netPayable, 225);
  assert.equal(position.anyTaxRecorded, true);
});

test('how many documents carry tax is reported, so a partial picture is visible as one', () => {
  const position = gstPosition([{ gst_amount: 180 }, { gst_amount: 0 }, { gst_amount: 0 }], [{ gst_amount: 0 }]);
  assert.equal(position.invoiceCount, 3);
  assert.equal(position.invoicesWithTax, 1);
  assert.equal(position.purchaseCount, 1);
  assert.equal(position.purchasesWithTax, 0);
});

test('more input tax than output is nothing payable, never a negative bill', () => {
  const position = gstPosition([{ gst_amount: 50 }], [{ gst_amount: 200 }]);
  assert.equal(position.netPayable, 0);
});
