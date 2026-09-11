/**
 * Which stretch of time a report covers.
 *
 * Reports had no such thing: every figure on the screen was summed from every record ever
 * recorded, so there was no way to ask what a month made, and no way to compare one month with the
 * one before it. The screen said so honestly — "Records on file: 1 Aug – 3 Sep" — but honest is not
 * the same as useful when the question is whether August was better than July.
 *
 * Everything here is pure string arithmetic on ISO dates (YYYY-MM-DD), with no Date maths in the
 * middle. That is deliberate: India runs at UTC+5:30, and a report that decides which month a sale
 * belongs to by converting through a timestamp can move a late-evening sale into the next month.
 * Dates are stored as plain days in this app, and they are compared as plain days here.
 *
 * The financial year is the Indian one, April to March. "Q1" therefore means April to June, which
 * is what a GST return means by it, not January to March.
 */

export type PeriodPreset =
  | 'this-month' | 'last-month' | 'this-quarter' | 'last-quarter'
  | 'this-fy' | 'last-fy' | 'all' | 'custom';

/** An inclusive span of days. `null` at either end means unbounded in that direction. */
export type Period = { start: string | null; end: string | null };

export const ALL_TIME: Period = { start: null, end: null };

/** Whether a period covers everything. Compared by VALUE, never by reference: a custom range with
 *  both boxes left empty is `{ start: null, end: null }` too, but it is a different object, and
 *  `period !== ALL_TIME` would call it a real period covering nothing. */
export function isAllTime(period: Period): boolean {
  return !period.start && !period.end;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (value: number) => String(value).padStart(2, '0');

/** Today as the person looking at the screen would write it — their own clock, not UTC. */
export function todayIso(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function parts(iso: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [, year, month, day] = match;
  return { year: Number(year), month: Number(month), day: Number(day) };
}

function lastDayOfMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one, and JS handles the February cases.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthSpan(year: number, month: number): Period {
  return { start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(lastDayOfMonth(year, month))}` };
}

/** Shifts a year/month pair by whole months, carrying the year. */
function shiftMonth(year: number, month: number, by: number): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) + by;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

/** The financial year a day falls in, as its starting calendar year: 2026-03-31 is FY 2025. */
export function financialYearStart(iso: string): number | null {
  const on = parts(iso);
  if (!on) return null;
  return on.month >= 4 ? on.year : on.year - 1;
}

function fySpan(startYear: number): Period {
  return { start: `${startYear}-04-01`, end: `${startYear + 1}-03-31` };
}

/** Which quarter of the Indian financial year a month is in: April–June is 1. */
function fyQuarter(month: number): number {
  return Math.floor(((month - 4 + 12) % 12) / 3) + 1;
}

function fyQuarterSpan(fyStartYear: number, quarter: number): Period {
  const firstMonth = shiftMonth(fyStartYear, 4, (quarter - 1) * 3);
  const lastMonth = shiftMonth(firstMonth.year, firstMonth.month, 2);
  return {
    start: `${firstMonth.year}-${pad(firstMonth.month)}-01`,
    end: `${lastMonth.year}-${pad(lastMonth.month)}-${pad(lastDayOfMonth(lastMonth.year, lastMonth.month))}`,
  };
}

/** The span a preset means, worked out from the day the person is looking at it. */
export function periodFor(preset: PeriodPreset, todayIsoDate: string): Period {
  const today = parts(todayIsoDate);
  if (!today || preset === 'all' || preset === 'custom') return ALL_TIME;

  switch (preset) {
    case 'this-month':
      return monthSpan(today.year, today.month);
    case 'last-month': {
      const previous = shiftMonth(today.year, today.month, -1);
      return monthSpan(previous.year, previous.month);
    }
    case 'this-quarter': {
      const fy = today.month >= 4 ? today.year : today.year - 1;
      return fyQuarterSpan(fy, fyQuarter(today.month));
    }
    case 'last-quarter': {
      const fy = today.month >= 4 ? today.year : today.year - 1;
      const quarter = fyQuarter(today.month);
      return quarter === 1 ? fyQuarterSpan(fy - 1, 4) : fyQuarterSpan(fy, quarter - 1);
    }
    case 'this-fy':
      return fySpan(today.month >= 4 ? today.year : today.year - 1);
    case 'last-fy':
      return fySpan((today.month >= 4 ? today.year : today.year - 1) - 1);
  }
}

/** Whether a record dated `iso` belongs in this period. A record with no usable date is left out
 *  of every bounded period — it cannot be shown to belong, and guessing would put real money in
 *  the wrong month. It is included only in All time, where nothing is being claimed about when. */
export function inPeriod(iso: string | null | undefined, period: Period): boolean {
  if (!period.start && !period.end) return true;
  if (typeof iso !== 'string' || !parts(iso)) return false;
  if (period.start && iso < period.start) return false;
  if (period.end && iso > period.end) return false;
  return true;
}

export function filterToPeriod<T>(rows: T[], dateOf: (row: T) => string | null | undefined, period: Period): T[] {
  if (!period.start && !period.end) return rows;
  return rows.filter((row) => inPeriod(dateOf(row), period));
}

/** Inclusive day count, or null when either end is open. UTC-pinned so it cannot drift by a day. */
export function daysInPeriod(period: Period): number | null {
  if (!period.start || !period.end) return null;
  const start = Date.parse(`${period.start}T00:00:00Z`);
  const end = Date.parse(`${period.end}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.floor((end - start) / 86400000) + 1;
}

/**
 * The same length of time immediately before this period, for a like-with-like comparison.
 *
 * Deliberately equal-length rather than "the previous calendar month": comparing a 31-day month
 * with a 28-day one and calling the difference a trend is how a report misleads. Null for an open
 * period, because there is nothing definite to compare against.
 */
export function previousPeriod(period: Period): Period | null {
  const days = daysInPeriod(period);
  if (!period.start || !period.end || days === null) return null;
  const endMs = Date.parse(`${period.start}T00:00:00Z`) - 86400000;
  const startMs = endMs - (days - 1) * 86400000;
  return { start: new Date(startMs).toISOString().slice(0, 10), end: new Date(endMs).toISOString().slice(0, 10) };
}

/** "1 Apr 2026" — built by hand so the string is identical on the server and in the browser. */
export function formatDay(iso: string): string {
  const on = parts(iso);
  if (!on || on.month > 12) return iso;
  return `${on.day} ${MONTHS[on.month - 1]} ${on.year}`;
}

export function formatPeriod(period: Period): string {
  if (!period.start && !period.end) return 'All records on file';
  if (period.start && period.end) {
    return period.start === period.end ? formatDay(period.start) : `${formatDay(period.start)} – ${formatDay(period.end)}`;
  }
  return period.start ? `From ${formatDay(period.start)}` : `Up to ${formatDay(period.end as string)}`;
}

export const PRESET_LABELS: Record<PeriodPreset, string> = {
  'this-month': 'This month',
  'last-month': 'Last month',
  'this-quarter': 'This quarter',
  'last-quarter': 'Last quarter',
  'this-fy': 'This financial year',
  'last-fy': 'Last financial year',
  all: 'All time',
  custom: 'Custom dates',
};

/** The financial year a period sits in, as "2026-27", or null when it straddles two. */
export function financialYearLabel(period: Period): string | null {
  if (!period.start || !period.end) return null;
  const start = financialYearStart(period.start);
  const end = financialYearStart(period.end);
  if (start === null || end === null || start !== end) return null;
  return `${start}-${String(start + 1).slice(2)}`;
}
