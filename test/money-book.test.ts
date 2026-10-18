import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accountBalances,
  accountStatement,
  bookRows,
  drawerDifference,
  methodFromText,
  pendingCheques,
  unplacedRows,
  type MoneyAccount,
  type MoneyEntryRow,
} from '../lib/money-book';

const cash: MoneyAccount = { id: 'cash', name: 'Cash drawer', kind: 'cash', opening_balance: 5000, opening_date: '2026-10-01', archived: false };
const bank: MoneyAccount = { id: 'hdfc', name: 'HDFC current', kind: 'bank', opening_balance: 100000, opening_date: '2026-10-01', archived: false };
const entry = (overrides: Partial<MoneyEntryRow>): MoneyEntryRow => ({
  id: 'e1', date: '2026-10-10', kind: 'sale_counter', account_id: 'cash', to_account_id: null, amount: 1000, method: 'cash',
  source_type: 'invoice', source_id: 'INV-1018', party: 'kareem', note: null, ...overrides,
});

const rows = bookRows({
  payments: [
    { id: 'PAY-1', date: '2026-10-11', customer: 'bawa', amount: 2000, note: null, account_id: 'hdfc', method: 'upi' },
    { id: 'PAY-2', date: '2026-10-12', customer: 'motor', amount: 7000, note: null, account_id: 'hdfc', method: 'cheque', cheque_no: '445566', cheque_status: 'pending' },
    { id: 'PAY-3', date: '2026-09-20', customer: 'old', amount: 900, note: null, account_id: 'cash', method: 'cash' },
  ],
  supplierPayments: [
    { id: 'SPAY-1', date: '2026-10-12', supplier: 'Sharma Traders', amount: 3000, note: null, reference: 'PO-1001', account_id: 'hdfc', method: 'cheque', cheque_no: '000123', cheque_status: 'cleared', cleared_on: '2026-10-14' },
    { id: 'SPAY-2', date: '2026-10-12', supplier: 'Gupta', amount: 500, note: null, reference: null, account_id: 'hdfc', method: 'cheque', cheque_status: 'bounced' },
  ],
  expenses: [
    { id: 'EXP-1', date: '2026-10-11', category: 'freight', description: 'tempo', amount: 300, mode: 'cash', account_id: 'cash' },
    { id: 'EXP-2', date: '2026-10-11', category: 'tea', description: null, amount: 50, mode: 'UPI', account_id: null },
  ],
  entries: [
    entry({}),
    entry({ id: 'e2', date: '2026-10-13', kind: 'transfer', account_id: 'cash', to_account_id: 'hdfc', amount: -4000, method: 'cash', source_type: null, source_id: null, party: null }),
    entry({ id: 'e3', date: '2026-10-13', kind: 'sale_refund', amount: -200, source_type: 'sales_return', source_id: 'SRN-1002' }),
  ],
});

test('every record becomes one signed row, newest first', () => {
  assert.equal(rows.length, 10);
  assert.equal(rows.find((row) => row.key === 'payment_in:PAY-1')!.amount, 2000);
  assert.equal(rows.find((row) => row.key === 'supplier_payment:SPAY-1')!.amount, -3000);
  assert.equal(rows.find((row) => row.key === 'expense:EXP-1')!.amount, -300);
  assert.equal(rows.find((row) => row.key === 'expense:EXP-2')!.method, 'upi', 'old free-text mode read as a method');
  assert.ok(rows[0].date >= rows[rows.length - 1].date);
});

test('balances: opening plus what came in and out since the opening day; transfers land on both sides', () => {
  const balances = accountBalances([cash, bank], rows);
  // Cash: 5000 + 1000 (counter) − 300 (freight) − 4000 (to bank) − 200 (refund). PAY-3 is before the opening day.
  assert.equal(balances.cash.balance, 1500);
  // Bank: 100000 + 2000 (UPI) + 4000 (from cash) − 3000 (cleared cheque). The pending cheque in and the bounced one do not count.
  assert.equal(balances.hdfc.balance, 103000);
  assert.equal(balances.hdfc.pendingIn, 7000);
  assert.equal(balances.hdfc.pendingOut, 0, 'a bounced cheque is not pending');
});

test('a cheque counts on the day it cleared, not the day it was written', () => {
  const before = accountBalances([bank], rows, '2026-10-13');
  const after = accountBalances([bank], rows, '2026-10-14');
  assert.equal(before.hdfc.balance, 106000);
  assert.equal(after.hdfc.balance, 103000);
});

test('a statement carries the opening forward and keeps a running balance', () => {
  const statement = accountStatement(cash, rows, '2026-10-11', '2026-10-13');
  assert.equal(statement.opening, 6000, 'opening 5000 plus the 10th');
  assert.deepEqual(statement.lines.map((line) => line.balance), [5700, 1700, 1500]);
  assert.equal(statement.closing, 1500);
  assert.equal(statement.moneyOut, 4500);
  const bankDay = accountStatement(bank, rows, '2026-10-13', '2026-10-13');
  assert.equal(bankDay.lines[0].amount, 4000, 'the transfer arrives as money in');
});

test('unplaced money and waiting cheques are listed', () => {
  assert.deepEqual(unplacedRows(rows).map((row) => row.key), ['expense:EXP-2']);
  assert.deepEqual(pendingCheques(rows).map((row) => row.key), ['payment_in:PAY-2']);
});

test('the drawer count says over or short', () => {
  assert.equal(drawerDifference(1500, 1450), -50);
  assert.equal(drawerDifference(1500, 1500), 0);
  assert.equal(drawerDifference(1500, 1600.5), 100.5);
});

test('free-text payment modes are read as methods where they can be', () => {
  assert.equal(methodFromText('Cheque no 4471'), 'cheque');
  assert.equal(methodFromText('GPay'), 'upi');
  assert.equal(methodFromText('bank_transfer'), 'bank');
  assert.equal(methodFromText('NEFT'), 'bank');
  assert.equal(methodFromText('cash'), 'cash');
  assert.equal(methodFromText('given to Ramesh'), null);
  assert.equal(methodFromText(''), null);
});
