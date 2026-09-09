import assert from 'node:assert/strict';
import test from 'node:test';
import { AGE_BUCKETS, agingFrom, agingRows, bucketFor, daysOutstanding, emptyBuckets } from '../lib/aging';

const TODAY = new Date('2026-09-04T00:00:00Z');

test('the buckets are the four the reports and the export both print', () => {
  assert.deepEqual([...AGE_BUCKETS], ['0-30', '31-60', '61-90', '90+']);
  assert.deepEqual(emptyBuckets(), { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 });
});

test('boundaries are inclusive at the top', () => {
  assert.equal(bucketFor(0), '0-30');
  assert.equal(bucketFor(30), '0-30');
  assert.equal(bucketFor(31), '31-60');
  assert.equal(bucketFor(60), '31-60');
  assert.equal(bucketFor(61), '61-90');
  assert.equal(bucketFor(90), '61-90');
  assert.equal(bucketFor(91), '90+');
});

test('days are counted from the date on the invoice', () => {
  assert.equal(daysOutstanding('2026-09-04', TODAY), 0);
  assert.equal(daysOutstanding('2026-09-03', TODAY), 1);
  assert.equal(daysOutstanding('2026-08-05', TODAY), 30);
  assert.equal(daysOutstanding('2026-08-04', TODAY), 31);
});

/** The reason this is pinned to UTC: India is +5:30, so a local-time comparison made a bill's age
 *  depend on the hour the report happened to be opened, and a 30-day-old bill could fall either
 *  side of the boundary. */
test('the answer does not change with the hour of day it is asked', () => {
  const morning = new Date('2026-09-04T04:30:00Z');   // 10:00 in Chandigarh
  const night = new Date('2026-09-04T20:00:00Z');     // 01:30 the next day, local
  for (const date of ['2026-09-04', '2026-08-05', '2026-08-04', '2026-06-06']) {
    assert.equal(daysOutstanding(date, morning), daysOutstanding(date, night), date);
  }
});

test('a future date reads as nothing outstanding rather than a negative age', () => {
  assert.equal(daysOutstanding('2026-12-25', TODAY), 0);
});

test('an unreadable date is treated as today, not as 1970', () => {
  assert.equal(daysOutstanding('', TODAY), 0);
  assert.equal(daysOutstanding('not a date', TODAY), 0);
});

test('a timestamp is accepted as well as a plain date', () => {
  assert.equal(daysOutstanding('2026-08-05T13:45:00+05:30', TODAY), 30);
});

// ── Grouping ────────────────────────────────────────────────────────────────────────────────

test('what each customer owes lands in the bucket for its age', () => {
  const { totals, byKey } = agingFrom([
    { key: 'kareem', date: '2026-09-01', due: 5000 },
    { key: 'kareem', date: '2026-07-01', due: 2000 },
    { key: 'Teja', date: '2026-08-04', due: 1000 },
  ], TODAY);

  assert.equal(totals['0-30'], 5000);
  assert.equal(totals['31-60'], 1000);
  assert.equal(totals['61-90'], 2000);
  assert.equal(totals['90+'], 0);
  assert.deepEqual(byKey.get('kareem'), { '0-30': 5000, '31-60': 0, '61-90': 2000, '90+': 0 });
  assert.deepEqual(byKey.get('Teja'), { '0-30': 0, '31-60': 1000, '61-90': 0, '90+': 0 });
});

test('someone who owes nothing is left out entirely', () => {
  const { byKey, totals } = agingFrom([
    { key: 'settled', date: '2026-09-01', due: 0 },
    { key: 'overpaid', date: '2026-09-01', due: -500 },
    { key: 'owing', date: '2026-09-01', due: 100 },
  ], TODAY);
  assert.equal(byKey.has('settled'), false);
  assert.equal(byKey.has('overpaid'), false, 'an overpayment must not subtract from a bucket');
  assert.equal(totals['0-30'], 100);
});

test('no entries gives four honest zeroes, not an empty object', () => {
  const { totals, byKey } = agingFrom([], TODAY);
  assert.deepEqual(totals, emptyBuckets());
  assert.equal(byKey.size, 0);
});

/** The whole point of sharing this: the spreadsheet's columns cannot drift from the report's. */
test('the spreadsheet rows carry the buckets in the declared order', () => {
  const rows = agingRows([
    { key: 'kareem', date: '2026-09-01', due: 5000 },
    { key: 'kareem', date: '2026-01-01', due: 700 },
  ], TODAY);

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], ['kareem', 5000, 0, 0, 700]);
  assert.equal(rows[0].length, 1 + AGE_BUCKETS.length);
});

test('the flattened rows and the totals agree, because one produces the other', () => {
  const entries = [
    { key: 'a', date: '2026-09-02', due: 120 },
    { key: 'b', date: '2026-07-20', due: 340 },
    { key: 'a', date: '2026-05-01', due: 60 },
  ];
  const { totals } = agingFrom(entries, TODAY);
  const rows = agingRows(entries, TODAY);
  const summed = rows.reduce((sum, row) => sum + row.slice(1).reduce((a: number, b) => a + Number(b), 0), 0);
  assert.equal(summed, AGE_BUCKETS.reduce((sum, bucket) => sum + totals[bucket], 0));
});
