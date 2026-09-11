import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALL_TIME, daysInPeriod, filterToPeriod, financialYearLabel, formatPeriod, inPeriod,
  isAllTime, periodFor, previousPeriod, todayIso,
} from '../lib/report-period';

// ── What each preset means ───────────────────────────────────────────────────────────────────

test('this month is the whole calendar month around today', () => {
  assert.deepEqual(periodFor('this-month', '2026-09-12'), { start: '2026-09-01', end: '2026-09-30' });
});

test('last month carries back across a year boundary', () => {
  assert.deepEqual(periodFor('last-month', '2026-01-15'), { start: '2025-12-01', end: '2025-12-31' });
});

test('a month ending on the 31st ends on the 31st, and February knows its own length', () => {
  assert.deepEqual(periodFor('this-month', '2026-01-09'), { start: '2026-01-01', end: '2026-01-31' });
  assert.deepEqual(periodFor('this-month', '2026-02-09'), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(periodFor('this-month', '2028-02-09'), { start: '2028-02-01', end: '2028-02-29' });
});

/** Q1 is April to June, which is what a GST return means by it — not January to March. */
test('quarters follow the Indian financial year, not the calendar', () => {
  assert.deepEqual(periodFor('this-quarter', '2026-05-20'), { start: '2026-04-01', end: '2026-06-30' });
  assert.deepEqual(periodFor('this-quarter', '2026-09-12'), { start: '2026-07-01', end: '2026-09-30' });
  assert.deepEqual(periodFor('this-quarter', '2026-02-02'), { start: '2026-01-01', end: '2026-03-31' });
});

test('last quarter steps back into the previous financial year when it has to', () => {
  assert.deepEqual(periodFor('last-quarter', '2026-09-12'), { start: '2026-04-01', end: '2026-06-30' });
  assert.deepEqual(periodFor('last-quarter', '2026-05-20'), { start: '2026-01-01', end: '2026-03-31' });
});

test('the financial year runs April to March', () => {
  assert.deepEqual(periodFor('this-fy', '2026-09-12'), { start: '2026-04-01', end: '2027-03-31' });
  assert.deepEqual(periodFor('this-fy', '2026-03-31'), { start: '2025-04-01', end: '2026-03-31' });
  assert.deepEqual(periodFor('last-fy', '2026-09-12'), { start: '2025-04-01', end: '2026-03-31' });
});

test('all time is unbounded at both ends', () => {
  assert.deepEqual(periodFor('all', '2026-09-12'), { start: null, end: null });
});

// ── What belongs in a period ─────────────────────────────────────────────────────────────────

const SEPTEMBER = { start: '2026-09-01', end: '2026-09-30' };

test('both end days are inside the period', () => {
  assert.equal(inPeriod('2026-09-01', SEPTEMBER), true);
  assert.equal(inPeriod('2026-09-30', SEPTEMBER), true);
  assert.equal(inPeriod('2026-08-31', SEPTEMBER), false);
  assert.equal(inPeriod('2026-10-01', SEPTEMBER), false);
});

/** Guessing would put real money in the wrong month. */
test('a record with no usable date is left out of a real period, not guessed into it', () => {
  assert.equal(inPeriod(null, SEPTEMBER), false);
  assert.equal(inPeriod('', SEPTEMBER), false);
  assert.equal(inPeriod('not a date', SEPTEMBER), false);
});

test('all time includes everything, including records with no date', () => {
  assert.equal(inPeriod(null, { start: null, end: null }), true);
  assert.equal(inPeriod('2019-01-01', { start: null, end: null }), true);
});

test('filtering keeps the rows in the period and nothing else', () => {
  const rows = [{ d: '2026-08-31' }, { d: '2026-09-01' }, { d: '2026-09-30' }, { d: '2026-10-01' }, { d: null }];
  assert.deepEqual(
    filterToPeriod(rows, (row) => row.d, SEPTEMBER).map((row) => row.d),
    ['2026-09-01', '2026-09-30']
  );
});

test('filtering over all time hands back the same rows untouched', () => {
  const rows = [{ d: '2026-08-31' }, { d: null }];
  assert.equal(filterToPeriod(rows, (row) => row.d, { start: null, end: null }), rows);
});

// ── Comparing with the period before ─────────────────────────────────────────────────────────

test('a period is as long as the days it covers, counting both ends', () => {
  assert.equal(daysInPeriod(SEPTEMBER), 30);
  assert.equal(daysInPeriod({ start: '2026-09-12', end: '2026-09-12' }), 1);
  assert.equal(daysInPeriod({ start: null, end: '2026-09-12' }), null);
});

/** Comparing a 31-day month with a 28-day one and calling the difference a trend is how a report
 *  misleads, so the comparison period is always the same length, ending the day before. */
test('the period before is the same length, immediately before', () => {
  assert.deepEqual(previousPeriod(SEPTEMBER), { start: '2026-08-02', end: '2026-08-31' });
  assert.deepEqual(previousPeriod({ start: '2026-01-01', end: '2026-01-31' }), { start: '2025-12-01', end: '2025-12-31' });
});

test('a single day compares against the day before it', () => {
  assert.deepEqual(previousPeriod({ start: '2026-09-12', end: '2026-09-12' }), { start: '2026-09-11', end: '2026-09-11' });
});

test('an open period has nothing definite to compare against', () => {
  assert.equal(previousPeriod({ start: null, end: null }), null);
  assert.equal(previousPeriod({ start: '2026-09-01', end: null }), null);
});

// ── How it reads ─────────────────────────────────────────────────────────────────────────────

test('a period reads as days, not as ISO dates', () => {
  assert.equal(formatPeriod(SEPTEMBER), '1 Sep 2026 – 30 Sep 2026');
  assert.equal(formatPeriod({ start: '2026-09-12', end: '2026-09-12' }), '12 Sep 2026');
  assert.equal(formatPeriod({ start: null, end: null }), 'All records on file');
  assert.equal(formatPeriod({ start: '2026-09-01', end: null }), 'From 1 Sep 2026');
});

test('a period inside one financial year is labelled with it', () => {
  assert.equal(financialYearLabel(SEPTEMBER), '2026-27');
  assert.equal(financialYearLabel({ start: '2026-01-01', end: '2026-03-31' }), '2025-26');
});

test('a period straddling two financial years is labelled with neither', () => {
  assert.equal(financialYearLabel({ start: '2026-03-01', end: '2026-05-31' }), null);
  assert.equal(financialYearLabel({ start: null, end: null }), null);
});

/** The shop's own clock decides what "today" is, not UTC — India runs 5½ hours ahead, so a late
 *  evening here is already tomorrow in UTC, and "this month" must not jump early because of it. */
test('today is read off the local clock', () => {
  assert.equal(todayIso(new Date(2026, 8, 12, 23, 45)), '2026-09-12');
  assert.equal(todayIso(new Date(2026, 0, 5, 0, 15)), '2026-01-05');
});

// ── Covering everything ──────────────────────────────────────────────────────────────────────

/** The bug this guards: a custom range with both boxes empty is a different object from ALL_TIME,
 *  so a reference check called it a real period that happened to contain nothing, and the screen
 *  announced "no sales were recorded" over a page showing every sale ever made. */
test('an empty custom range covers everything, the same as All time', () => {
  assert.equal(isAllTime(ALL_TIME), true);
  assert.equal(isAllTime({ start: null, end: null }), true);
  assert.equal(isAllTime({ start: '', end: '' }), true);
});

test('a period with either end set does not cover everything', () => {
  assert.equal(isAllTime({ start: '2026-09-01', end: null }), false);
  assert.equal(isAllTime({ start: null, end: '2026-09-30' }), false);
  assert.equal(isAllTime(SEPTEMBER), false);
});
