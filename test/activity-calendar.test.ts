import assert from 'node:assert/strict';
import test from 'node:test';
import { buildActivityCalendar, shiftDay, suggestWeeks, type ActivityEvent } from '../lib/activity-calendar';

const TODAY = '2026-09-02'; // a Wednesday

function sale(day: string): ActivityEvent {
  return { day, kind: 'sale' };
}

test('the grid is whole weeks, Monday first, ending with the week containing today', () => {
  const { weeks, windowStart, windowEnd } = buildActivityCalendar([], TODAY, 4);
  assert.equal(weeks.length, 4);
  assert.ok(weeks.every((column) => column.length === 7));
  assert.equal(windowStart, '2026-08-10', 'starts on a Monday');
  assert.equal(windowEnd, '2026-09-06', 'ends on the Sunday of this week');
  assert.equal(weeks[0][0].day, windowStart);
  assert.equal(weeks[3][6].day, windowEnd);
});

test('days after today are marked future, so an empty square is never read as a quiet day', () => {
  const { weeks } = buildActivityCalendar([], TODAY, 1);
  const lastColumn = weeks[0];
  assert.equal(lastColumn.find((cell) => cell.day === TODAY)?.future, false);
  assert.equal(lastColumn.find((cell) => cell.day === '2026-09-03')?.future, true);
});

test('a day counts every kind of record entered on it', () => {
  const { weeks } = buildActivityCalendar(
    [sale(TODAY), sale(TODAY), { day: TODAY, kind: 'purchase' }, { day: TODAY, kind: 'expense' }],
    TODAY,
    1
  );
  const cell = weeks[0].find((c) => c.day === TODAY)!;
  assert.equal(cell.total, 4);
  assert.equal(cell.counts.sale, 2);
  assert.equal(cell.counts.purchase, 1);
  assert.equal(cell.counts.quotation, 0);
});

test('shading is relative to the busiest day actually in view', () => {
  const events = [
    ...Array.from({ length: 8 }, () => sale('2026-09-01')),
    sale('2026-08-31'),
  ];
  const { weeks } = buildActivityCalendar(events, TODAY, 2);
  const busiest = weeks.flat().find((c) => c.day === '2026-09-01')!;
  const quiet = weeks.flat().find((c) => c.day === '2026-08-31')!;
  assert.equal(busiest.level, 4);
  assert.equal(quiet.level, 1);
  assert.equal(weeks.flat().find((c) => c.day === '2026-08-30')!.level, 0);
});

test('a single day of trading still shades, rather than dividing by itself into nothing', () => {
  const { weeks } = buildActivityCalendar([sale(TODAY)], TODAY, 1);
  assert.equal(weeks[0].find((c) => c.day === TODAY)!.level, 4);
});

test('counts active and quiet days over the window on screen', () => {
  const { stats } = buildActivityCalendar([sale('2026-09-01'), sale(TODAY)], TODAY, 1);
  // Monday 31 Aug to Wednesday 2 Sep is 3 days elapsed this week.
  assert.equal(stats.activeDays, 2);
  assert.equal(stats.quietDays, 1);
});

test('a run of consecutive trading days is the current streak', () => {
  const events = ['2026-08-31', '2026-09-01', TODAY].map(sale);
  const { stats } = buildActivityCalendar(events, TODAY, 4);
  assert.equal(stats.currentStreak, 3);
  assert.equal(stats.streakEndsYesterday, false);
  assert.equal(stats.longestStreak, 3);
});

/** The day isn't over — a run reaching yesterday has not been broken. */
test('a streak that reaches yesterday is still alive, and says so', () => {
  const events = ['2026-08-31', '2026-09-01'].map(sale);
  const { stats } = buildActivityCalendar(events, TODAY, 4);
  assert.equal(stats.currentStreak, 2);
  assert.equal(stats.streakEndsYesterday, true);
});

test('a gap two days back really has ended the streak', () => {
  const { stats } = buildActivityCalendar(['2026-08-30', '2026-08-31'].map(sale), TODAY, 4);
  assert.equal(stats.currentStreak, 0);
  assert.equal(stats.streakEndsYesterday, false);
  assert.equal(stats.longestStreak, 2);
});

test('the longest streak survives later gaps', () => {
  const events = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-09-01'].map(sale);
  const { stats } = buildActivityCalendar(events, TODAY, 8);
  assert.equal(stats.longestStreak, 4);
  assert.equal(stats.currentStreak, 1);
  assert.equal(stats.streakEndsYesterday, true);
});

test('the busiest day is the one with the most records, not the most recent', () => {
  const events = [
    ...Array.from({ length: 5 }, () => sale('2026-08-25')),
    sale(TODAY),
  ];
  const { stats } = buildActivityCalendar(events, TODAY, 8);
  assert.deepEqual(stats.busiestDay, { day: '2026-08-25', total: 5 });
});

test('with nothing recorded, every figure is an honest zero rather than a blank', () => {
  const { stats } = buildActivityCalendar([], TODAY, 4);
  assert.equal(stats.activeDays, 0);
  assert.equal(stats.currentStreak, 0);
  assert.equal(stats.longestStreak, 0);
  assert.equal(stats.busiestDay, null);
  assert.equal(stats.totalRecords, 0);
  assert.equal(stats.firstDay, null);
});

test('records older than the window still report how far back the books go', () => {
  const { stats, weeks } = buildActivityCalendar([sale('2025-01-15'), sale(TODAY)], TODAY, 2);
  assert.equal(stats.firstDay, '2025-01-15');
  assert.equal(stats.lastDay, TODAY);
  assert.equal(stats.totalRecords, 2);
  assert.equal(stats.activeDays, 1, 'the old sale is outside the squares on screen');
  assert.ok(!weeks.flat().some((cell) => cell.day === '2025-01-15'));
});

test('a malformed date is ignored instead of landing on a wrong square', () => {
  const events = [{ day: '', kind: 'sale' as const }, { day: '01/09/2026', kind: 'sale' as const }, sale(TODAY)];
  const { stats } = buildActivityCalendar(events, TODAY, 2);
  assert.equal(stats.totalRecords, 1);
  assert.equal(stats.activeDays, 1);
});

test('day arithmetic crosses month and year boundaries', () => {
  assert.equal(shiftDay('2026-08-31', 1), '2026-09-01');
  assert.equal(shiftDay('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDay('2028-02-28', 1), '2028-02-29');
});

test('the window reaches back to the oldest record, not a fixed six months', () => {
  // Books that start five weeks ago should not be padded with four blank months.
  const events = [sale('2026-07-30'), sale(TODAY)];
  assert.equal(suggestWeeks(events, TODAY), 8, 'clamped up to the eight-week floor');

  const older = [sale('2026-01-05'), sale(TODAY)];
  assert.equal(suggestWeeks(older, TODAY), 26, 'clamped down to the six-month ceiling');

  const middling = [sale('2026-05-01'), sale(TODAY)];
  assert.equal(suggestWeeks(middling, TODAY), 19);
});

test('with no records at all it still draws a sensible empty grid', () => {
  assert.equal(suggestWeeks([], TODAY), 12);
});

test('a malformed date cannot stretch the window back to 1970', () => {
  assert.equal(suggestWeeks([{ day: 'not-a-date', kind: 'sale' }, sale(TODAY)], TODAY), 8);
});
