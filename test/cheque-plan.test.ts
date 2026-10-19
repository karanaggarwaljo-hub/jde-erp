import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays, collectionPattern, coveredOn, partyHabit, projectDays, suggestDate } from '../lib/cheque-plan';
import type { ChequeRow } from '../lib/cheques';

// 2026-10-19 is a Monday.
const today = '2026-10-19';
const cheque = (overrides: Partial<ChequeRow>): ChequeRow => ({
  id: '1', direction: 'out', account_id: 'hdfc', bank_name: null, cheque_no: '000101', cheque_date: '2026-10-21', issued_on: '2026-10-19',
  party: 'Ramesh Traders', party_type: 'supplier', amount: 10000, purpose: 'payment', status: 'pending', status_on: null,
  source_table: null, source_id: null, reversed: false, note: null, created_at: '2026-10-19T10:00:00Z',
  ...overrides,
});

test('the usual day is worked out per weekday from the first day with money in, empty days counting as zero', () => {
  // Two weeks from Monday 5 Oct: Rs. 7,000 every Monday, Rs. 1,000 on one Tuesday, nothing else.
  const pattern = collectionPattern([
    { date: '2026-10-05', amount: 7000 }, { date: '2026-10-12', amount: 7000 }, { date: '2026-10-06', amount: 1000 },
  ], today);
  assert.equal(pattern.daysCovered, 14);
  assert.equal(pattern.byWeekday[1], 7000, 'Mondays');
  assert.equal(pattern.byWeekday[2], 500, 'one Tuesday of two');
  assert.equal(pattern.byWeekday[0], 0, 'Sundays');
  assert.equal(pattern.total, 15000);
});

test('no sales history means nothing is expected, never a guess', () => {
  const pattern = collectionPattern([], today);
  assert.equal(pattern.daysCovered, 0);
  assert.deepEqual(pattern.byWeekday, [0, 0, 0, 0, 0, 0, 0]);
});

test('the projection adds the usual sales and cheques coming in, takes off cheques going out, and counts overdue ones today', () => {
  const pattern = { byWeekday: [0, 1000, 1000, 1000, 1000, 1000, 1000], daysCovered: 28, total: 0 };
  const days = projectDays({
    cheques: [
      cheque({ id: 'a', cheque_date: '2026-10-21', amount: 4000 }),
      cheque({ id: 'b', direction: 'in', cheque_date: '2026-10-20', amount: 2500 }),
      cheque({ id: 'c', cheque_date: '2026-10-10', amount: 500 }), // overdue: counted today
      cheque({ id: 'd', purpose: 'security', cheque_date: '2026-10-20', amount: 99999 }), // moves no money
      cheque({ id: 'e', status: 'cleared', cheque_date: '2026-10-20', amount: 99999 }),
    ],
    pattern, today, startBalance: 1000, horizon: 3,
  });
  assert.deepEqual(days.map((day) => day.balance), [500, 4000, 1000, 2000]);
  assert.equal(days[0].expectedIn, 0, 'nothing more is expected today');
});

test('the suggested date is the first from which the cheque stays covered, even past a later dip', () => {
  const pattern = { byWeekday: [1000, 1000, 1000, 1000, 1000, 1000, 1000], daysCovered: 28, total: 0 };
  // A cheque of Rs. 5,000 already given falls due on the 24th.
  const days = projectDays({ cheques: [cheque({ cheque_date: '2026-10-24', amount: 5000 })], pattern, today, startBalance: 0, horizon: 20 });
  // Balances: 19th 0, 20th 1000 … 23rd 4000, 24th 0, then +1000 a day. Rs. 3,000 is first safe on the 27th.
  assert.deepEqual(suggestDate(days, 3000), { date: '2026-10-27', shortBy: 0 });
  assert.equal(coveredOn(days, 3000, '2026-10-22'), false, 'it would bounce when the earlier cheque is presented');
  assert.equal(coveredOn(days, 3000, '2026-10-27'), true);
  assert.equal(suggestDate(days, 3000, '2026-11-01').date, '2026-11-01', 'never before the date asked for');
});

test('a cheque never covered in the window says how much is missing', () => {
  const pattern = { byWeekday: [0, 0, 0, 0, 0, 0, 0], daysCovered: 0, total: 0 };
  const days = projectDays({ cheques: [], pattern, today, startBalance: 2000, horizon: 10 });
  assert.deepEqual(suggestDate(days, 5000), { date: null, shortBy: 3000 });
});

test('how you usually pay someone: how far ahead the cheques are dated, and how often', () => {
  const cheques = [
    cheque({ id: '1', issued_on: '2026-08-01', cheque_date: '2026-08-16', amount: 20000 }),
    cheque({ id: '2', issued_on: '2026-09-01', cheque_date: '2026-09-11', amount: 25000 }),
    cheque({ id: '3', issued_on: '2026-10-01', cheque_date: '2026-10-16', amount: 30000 }),
    cheque({ id: '4', party: 'Someone else', issued_on: '2026-10-05', cheque_date: '2026-10-05' }),
    cheque({ id: '5', status: 'cancelled', issued_on: '2026-10-10', cheque_date: '2026-12-31' }),
  ];
  const habit = partyHabit(cheques, ' ramesh traders ');
  assert.equal(habit.count, 3);
  assert.equal(habit.postDatedDays, 15);
  assert.equal(habit.everyDays, 31, 'a month apart: 31 and 30 days');
  assert.deepEqual(habit.last, { issuedOn: '2026-10-01', chequeDate: '2026-10-16', amount: 30000 });
  assert.equal(partyHabit(cheques).count, 4, 'everyone, when no one is chosen');
  assert.equal(addDays(today, 15), '2026-11-03');
});
