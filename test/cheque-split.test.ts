import assert from 'node:assert/strict';
import test from 'node:test';
import { chequeProblem, chequesTotal, nextNumber, planCheques, spacedDates, splitAmount } from '../lib/cheque-split';

test('an amount splits into equal whole-rupee cheques, the last taking what is left', () => {
  assert.deepEqual(splitAmount(100000, 3), [33333, 33333, 33334]);
  assert.deepEqual(splitAmount(500000, 2), [250000, 250000]);
  assert.deepEqual(splitAmount(1000.5, 2), [500, 500.5]);
  assert.deepEqual(splitAmount(1200, 1), [1200]);
  assert.deepEqual(splitAmount(0, 3), []);
  // Too little to split stays one cheque rather than a ₹0 one.
  assert.deepEqual(splitAmount(0.5, 3), [0.5]);
});

test('cheque dates can be a month apart, keeping the day or the month’s last day', () => {
  assert.deepEqual(spacedDates('2026-10-31', 3, 'month'), ['2026-10-31', '2026-11-30', '2026-12-31']);
  assert.deepEqual(spacedDates('2026-12-15', 2, 'month'), ['2026-12-15', '2027-01-15']);
  assert.deepEqual(spacedDates('2026-10-27', 3, 'fortnight'), ['2026-10-27', '2026-11-11', '2026-11-26']);
  assert.deepEqual(spacedDates('2026-10-27', 2, 'week'), ['2026-10-27', '2026-11-03']);
  assert.deepEqual(spacedDates('2026-10-27', 2, 'same'), ['2026-10-27', '2026-10-27']);
});

test('the next leaf number keeps its leading zeros', () => {
  assert.equal(nextNumber('000101'), '000102');
  assert.equal(nextNumber('000999'), '001000');
  assert.equal(nextNumber('SBI-0099'), 'SBI-0100');
  assert.equal(nextNumber(''), '');
  assert.equal(nextNumber('ABC'), '');
});

test('a plan uses the cheque book’s free leaves, then counts on from the last one', () => {
  const plan = planCheques(300000, 3, '2026-11-01', 'month', ['000105', '000107']);
  assert.deepEqual(plan.map((cheque) => cheque.no), ['000105', '000107', '000108']);
  assert.deepEqual(plan.map((cheque) => cheque.date), ['2026-11-01', '2026-12-01', '2027-01-01']);
  assert.equal(chequesTotal(plan), 300000);
  // No book: numbered on from what was typed in the first cheque.
  assert.deepEqual(planCheques(200, 2, '2026-11-01', 'same', [], '123456').map((cheque) => cheque.no), ['123456', '123457']);
});

test('the form says plainly what is wrong with the cheques', () => {
  const good = [{ no: '1', date: '2026-11-01', amount: '600' }, { no: '2', date: '2026-12-01', amount: '400' }];
  assert.equal(chequeProblem(good, 1000), null);
  assert.match(chequeProblem(good, 1200) ?? '', /₹200 less/);
  assert.match(chequeProblem(good, 900) ?? '', /₹100 more/);
  assert.match(chequeProblem([{ ...good[0], amount: '' }], 600) ?? '', /needs an amount/);
  assert.match(chequeProblem([{ ...good[0], date: '' }], 600) ?? '', /needs the date/);
  assert.match(chequeProblem([good[0], { ...good[1], no: '1' }], 1000) ?? '', /written twice/);
  assert.match(chequeProblem([], 1000) ?? '', /Add a cheque/);
  // A cheque with no number is allowed: not every cheque book is in the ERP.
  assert.equal(chequeProblem([{ no: '', date: '2026-11-01', amount: '1000' }], 1000), null);
});
