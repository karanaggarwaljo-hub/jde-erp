import assert from 'node:assert/strict';
import test from 'node:test';
import { bookLeaves, leavesOf, nextLeaf, registerOrder, shortfalls, summarise, type ChequeBook, type ChequeRow } from '../lib/cheques';

const today = '2026-10-18';
const cheque = (overrides: Partial<ChequeRow>): ChequeRow => ({
  id: 'c', direction: 'out', account_id: 'hdfc', bank_name: null, cheque_no: '000101', cheque_date: '2026-10-20', issued_on: '2026-10-15',
  party: 'Sharma Traders', party_type: 'supplier', amount: 10000, purpose: 'payment', status: 'pending', status_on: null,
  source_table: 'supplier_payments', source_id: 'SPAY-1001', reversed: false, note: null, created_at: '2026-10-15T10:00:00Z', ...overrides,
});
const book: ChequeBook = { id: 'b1', account_id: 'hdfc', first_no: '000101', last_no: '000110', received_on: '2026-10-01', note: null };

test('a book has every leaf from first to last, keeping the leading zeros', () => {
  const leaves = bookLeaves(book);
  assert.equal(leaves.length, 10);
  assert.equal(leaves[0], '000101');
  assert.equal(leaves[9], '000110');
  assert.deepEqual(bookLeaves({ first_no: 'ABC', last_no: '10' }), []);
  assert.deepEqual(bookLeaves({ first_no: '20', last_no: '10' }), []);
});

test('the next leaf is the first not yet written, across books oldest first', () => {
  const used = [cheque({ cheque_no: '000101' }), cheque({ id: 'x', cheque_no: '000102', status: 'cancelled' })];
  assert.equal(nextLeaf([book], used, 'hdfc'), '000103');
  assert.equal(nextLeaf([book], used, 'sbi'), null, 'no book for that account');
  const full = bookLeaves(book).map((no, index) => cheque({ id: String(index), cheque_no: no }));
  const second: ChequeBook = { ...book, id: 'b2', first_no: '000201', last_no: '000225', received_on: '2026-10-10' };
  assert.equal(nextLeaf([second, book], full, 'hdfc'), '000201');
  assert.equal(leavesOf(book, used)[1].cheque?.status, 'cancelled');
});

test('the summary separates what is due this week from post-dated cheques, and leaves security cheques out', () => {
  const cheques = [
    cheque({ id: '1', cheque_date: '2026-10-17', amount: 5000 }),
    cheque({ id: '2', cheque_date: '2026-10-24', amount: 7000 }),
    cheque({ id: '3', cheque_date: '2026-11-15', amount: 9000 }),
    cheque({ id: '4', status: 'bounced', amount: 3000 }),
    cheque({ id: '5', purpose: 'security', amount: 100000 }),
    cheque({ id: '6', direction: 'in', amount: 4000 }),
  ];
  const out = summarise(cheques, 'out', today);
  assert.equal(out.pendingCount, 3);
  assert.equal(out.pendingTotal, 21000);
  assert.equal(out.dueSoonTotal, 12000, 'overdue and within 7 days');
  assert.equal(out.postDatedTotal, 9000);
  assert.equal(out.bouncedTotal, 3000);
  assert.equal(summarise(cheques, 'in', today).pendingTotal, 4000);
});

test('a bank account that will not cover this week\'s cheques is flagged with the shortfall', () => {
  const cheques = [cheque({ id: '1', amount: 30000 }), cheque({ id: '2', cheque_date: '2026-10-23', amount: 25000 }), cheque({ id: '3', cheque_date: '2026-12-01', amount: 90000 })];
  assert.deepEqual(shortfalls(cheques, { hdfc: 40000 }, today), [{ accountId: 'hdfc', byDate: '2026-10-23', due: 55000, balance: 40000, short: 15000 }]);
  assert.deepEqual(shortfalls(cheques, { hdfc: 60000 }, today), []);
});

test('the register lists cheques still to clear first, by the date on them', () => {
  const order = registerOrder([
    cheque({ id: 'cleared', status: 'cleared', status_on: '2026-10-16' }),
    cheque({ id: 'late', cheque_date: '2026-10-30' }),
    cheque({ id: 'soon', cheque_date: '2026-10-19' }),
  ]).map((row) => row.id);
  assert.deepEqual(order, ['soon', 'late', 'cleared']);
});
