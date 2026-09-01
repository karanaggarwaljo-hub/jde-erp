/** The day-by-day trading calendar behind the Dashboard's Activity card.
 *
 *  Everything here is counted from records the business actually entered — invoices, purchases,
 *  expenses, quotations — keyed on the date written on each one. Deliberately NOT included:
 *  anything resembling a time of day. This system stores a date on a sale, never a clock time,
 *  and the nearest timestamps it does keep (when a row was written to the database) say when
 *  something was typed in, not when it happened at the counter — and they are polluted by bulk
 *  imports, e.g. 675 opening-stock batches all landing in one late-night hour. A "busiest hour"
 *  drawn from that would look convincing and be false.
 */

/** The kinds of record that count as a day's activity. */
export const ACTIVITY_KINDS = ['sale', 'purchase', 'expense', 'quotation'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export type ActivityEvent = {
  /** The date written on the record, as YYYY-MM-DD. */
  day: string;
  kind: ActivityKind;
};

export type DayCell = {
  day: string;
  counts: Record<ActivityKind, number>;
  total: number;
  /** 0 (nothing) to 4 (this period's busiest), for shading. */
  level: 0 | 1 | 2 | 3 | 4;
  /** True for grid squares that fall after today — drawn empty, never as a quiet day. */
  future: boolean;
};

export type ActivityStats = {
  activeDays: number;
  /** Days in the window with no record at all — the honest denominator for activeDays. */
  quietDays: number;
  currentStreak: number;
  /** True when the run is still alive but today has nothing on it yet. */
  streakEndsYesterday: boolean;
  longestStreak: number;
  busiestDay: { day: string; total: number } | null;
  totals: Record<ActivityKind, number>;
  totalRecords: number;
  firstDay: string | null;
  lastDay: string | null;
};

export type ActivityCalendar = {
  /** Columns of 7 days, Monday first — the shape the heatmap is drawn in. */
  weeks: DayCell[][];
  stats: ActivityStats;
  windowStart: string;
  windowEnd: string;
};

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function toUtc(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function shiftDay(day: string, days: number): string {
  return fromUtc(toUtc(day) + days * DAY_MS);
}

/** Monday = 0 … Sunday = 6. Indian trading weeks are read Monday-first. */
function weekdayIndex(day: string): number {
  return (new Date(toUtc(day)).getUTCDay() + 6) % 7;
}

function emptyCounts(): Record<ActivityKind, number> {
  return { sale: 0, purchase: 0, expense: 0, quotation: 0 };
}

/** Four evenly spaced bands up to the busiest day in view, so shading always means something
 *  relative to how this business actually trades rather than to a number picked in advance. */
function levelFor(total: number, busiest: number): DayCell['level'] {
  if (total <= 0) return 0;
  if (busiest <= 1) return 4;
  const share = total / busiest;
  if (share > 0.75) return 4;
  if (share > 0.5) return 3;
  if (share > 0.25) return 2;
  return 1;
}

/** How many weeks of squares are worth drawing.
 *
 *  Fixed at 26 weeks, a business that started keeping records five weeks ago gets four months of
 *  blank grid — squares that read as "quiet days" when the truth is the books simply don't go
 *  back that far. So the window reaches back to the oldest record and no further, within sensible
 *  bounds: never so short that a run of good days fills the card, never longer than half a year. */
export function suggestWeeks(events: ActivityEvent[], today: string, min = 8, max = 26): number {
  let oldest: string | null = null;
  for (const event of events) {
    if (!ISO_DAY.test(event.day)) continue;
    if (!oldest || event.day < oldest) oldest = event.day;
  }
  if (!oldest) return min + 4;
  const days = Math.max(0, Math.round((toUtc(today) - toUtc(oldest)) / DAY_MS));
  return Math.min(max, Math.max(min, Math.ceil(days / 7) + 1));
}

/**
 * Lays the given events out over the `weeks` calendar weeks ending with the week containing
 * `today`, and counts the streaks and totals that go with them.
 *
 * Events dated outside the window are ignored for the grid but still shape `firstDay`/`lastDay`,
 * so the card can say how far back the records actually go rather than implying the window is
 * all there is.
 */
export function buildActivityCalendar(
  events: ActivityEvent[],
  today: string,
  weeks = 26
): ActivityCalendar {
  const valid = events.filter((event) => ISO_DAY.test(event.day));

  const byDay = new Map<string, Record<ActivityKind, number>>();
  const totals = emptyCounts();
  let firstDay: string | null = null;
  let lastDay: string | null = null;

  for (const event of valid) {
    const counts = byDay.get(event.day) ?? emptyCounts();
    counts[event.kind] += 1;
    byDay.set(event.day, counts);
    totals[event.kind] += 1;
    if (!firstDay || event.day < firstDay) firstDay = event.day;
    if (!lastDay || event.day > lastDay) lastDay = event.day;
  }

  // The grid always ends on the Sunday of this week, so today sits in the last column and the
  // squares after it are drawn as "not yet" rather than as quiet days.
  const windowEnd = shiftDay(today, 6 - weekdayIndex(today));
  const windowStart = shiftDay(windowEnd, -(weeks * 7 - 1));

  const grid: DayCell[][] = [];
  let busiestInWindow = 0;
  for (let index = 0; index < weeks * 7; index += 1) {
    const day = shiftDay(windowStart, index);
    const counts = byDay.get(day);
    if (counts && day <= today) {
      const total = ACTIVITY_KINDS.reduce((sum, kind) => sum + counts[kind], 0);
      if (total > busiestInWindow) busiestInWindow = total;
    }
  }

  for (let week = 0; week < weeks; week += 1) {
    const column: DayCell[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const day = shiftDay(windowStart, week * 7 + weekday);
      const counts = byDay.get(day) ?? emptyCounts();
      const total = ACTIVITY_KINDS.reduce((sum, kind) => sum + counts[kind], 0);
      const future = day > today;
      column.push({
        day,
        counts,
        total: future ? 0 : total,
        level: future ? 0 : levelFor(total, busiestInWindow),
        future,
      });
    }
    grid.push(column);
  }

  // Streaks and active-day counts are measured over the window that is on screen, so the number
  // in the tile always matches the squares beside it.
  const daysInWindow: string[] = [];
  for (let day = windowStart; day <= today; day = shiftDay(day, 1)) daysInWindow.push(day);

  const isActive = (day: string) => (byDay.get(day)?.sale ?? 0) + (byDay.get(day)?.purchase ?? 0)
    + (byDay.get(day)?.expense ?? 0) + (byDay.get(day)?.quotation ?? 0) > 0;

  const activeDays = daysInWindow.filter(isActive).length;

  let longestStreak = 0;
  let run = 0;
  for (const day of daysInWindow) {
    run = isActive(day) ? run + 1 : 0;
    if (run > longestStreak) longestStreak = run;
  }

  // A run that reaches yesterday is still alive — the day simply isn't over. Saying so is the
  // difference between "you stopped" and "nothing recorded yet today".
  const streakEndsYesterday = !isActive(today) && isActive(shiftDay(today, -1));
  let currentStreak = 0;
  let cursor = isActive(today) ? today : streakEndsYesterday ? shiftDay(today, -1) : '';
  while (cursor && cursor >= windowStart && isActive(cursor)) {
    currentStreak += 1;
    cursor = shiftDay(cursor, -1);
  }

  let busiestDay: ActivityStats['busiestDay'] = null;
  for (const day of daysInWindow) {
    const counts = byDay.get(day);
    if (!counts) continue;
    const total = ACTIVITY_KINDS.reduce((sum, kind) => sum + counts[kind], 0);
    if (total > 0 && (!busiestDay || total > busiestDay.total)) busiestDay = { day, total };
  }

  return {
    weeks: grid,
    windowStart,
    windowEnd,
    stats: {
      activeDays,
      quietDays: daysInWindow.length - activeDays,
      currentStreak,
      streakEndsYesterday,
      longestStreak,
      busiestDay,
      totals,
      totalRecords: valid.length,
      firstDay,
      lastDay,
    },
  };
}
