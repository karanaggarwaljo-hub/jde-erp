'use client';

import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { CalendarDays } from 'lucide-react';
import { buildActivityCalendar, type ActivityEvent, type DayCell } from '@/lib/activity-calendar';

type Props = {
  events: ActivityEvent[];
  /** Today as YYYY-MM-DD, passed in so the card and the rest of the page agree on the date. */
  today: string;
  /** How many calendar weeks of squares to draw. Half a year fills the Dashboard's full width with
   *  squares big enough to read at a glance. */
  weeks?: number;
};

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function prettyDay(day: string): string {
  const parsed = new Date(`${day}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return day;
  return parsed.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function describeDay(cell: DayCell): string {
  if (cell.future) return `${prettyDay(cell.day)} — not yet`;
  if (cell.beforeRecords) return `${prettyDay(cell.day)} — before your first record`;
  if (cell.total === 0) return `${prettyDay(cell.day)} — nothing recorded`;
  const parts = [
    cell.counts.sale ? `${cell.counts.sale} sale${cell.counts.sale === 1 ? '' : 's'}` : '',
    cell.counts.purchase ? `${cell.counts.purchase} purchase${cell.counts.purchase === 1 ? '' : 's'}` : '',
    cell.counts.expense ? `${cell.counts.expense} expense${cell.counts.expense === 1 ? '' : 's'}` : '',
    cell.counts.quotation ? `${cell.counts.quotation} quotation${cell.counts.quotation === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return `${prettyDay(cell.day)} — ${cell.total} record${cell.total === 1 ? '' : 's'}: ${parts.join(', ')}`;
}

/**
 * A day-by-day picture of how much the business actually did, and the streaks that go with it.
 *
 * Every square is counted from records entered in this company — invoices, purchases, expenses
 * and quotations — on the date written on each one. There is deliberately no "busiest hour" here:
 * a sale carries a date and no clock time, and the timestamps the database does keep record when
 * a row was typed in (and are dominated by bulk imports), so an hour figure would look convincing
 * and mean nothing. See lib/activity-calendar.ts.
 */
export default function ActivityCalendar({ events, today, weeks = 26 }: Props) {
  const { weeks: grid, stats, windowStart } = useMemo(
    () => buildActivityCalendar(events, today, weeks),
    [events, today, weeks]
  );

  // On a phone the squares stop shrinking and the grid scrolls sideways, so start it at the most
  // recent weeks rather than at the oldest.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  }, [grid.length]);

  // A month name above the column where that month starts, so a run of squares can be placed in
  // the year without labelling every column.
  const monthLabels = grid.map((column, index) => {
    const first = column[0].day;
    const month = first.slice(0, 7);
    const previous = index > 0 ? grid[index - 1][0].day.slice(0, 7) : '';
    if (month === previous) return '';
    return new Date(`${first}T00:00:00`).toLocaleDateString('en-IN', { month: 'short' });
  });

  const streakContext = stats.currentStreak === 0
    ? stats.longestStreak > 0 ? 'Nothing recorded for two days or more' : 'No records yet'
    : stats.streakEndsYesterday
      ? 'Still running — nothing entered today yet'
      : `${stats.currentStreak === 1 ? 'Today' : 'Including today'}`;

  return (
    <div className="card mb-6">
      <div className="card-header">
        <div>
          <h3 className="card-title flex items-center gap-2"><CalendarDays size={16} /> Everyday Activity</h3>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Every invoice, purchase, expense and quotation you recorded, by the date on it — last {grid.length} weeks
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', marginBottom: '22px' }}>
        <div className="activity-stat">
          <div className="activity-stat-label">Days with activity</div>
          <div className="activity-stat-value">{stats.activeDays}</div>
          <div className="activity-stat-context">{stats.quietDays} quiet {stats.quietDays === 1 ? 'day' : 'days'} since your first record</div>
        </div>
        <div className="activity-stat">
          <div className="activity-stat-label">Current run</div>
          <div className="activity-stat-value">{stats.currentStreak} {stats.currentStreak === 1 ? 'day' : 'days'}</div>
          <div className="activity-stat-context">{streakContext}</div>
        </div>
        <div className="activity-stat">
          <div className="activity-stat-label">Longest run</div>
          <div className="activity-stat-value">{stats.longestStreak} {stats.longestStreak === 1 ? 'day' : 'days'}</div>
          <div className="activity-stat-context">Most consecutive days worked</div>
        </div>
        <div className="activity-stat">
          <div className="activity-stat-label">Busiest day</div>
          <div className="activity-stat-value" style={{ fontSize: stats.busiestDay ? '19px' : '24px' }}>
            {stats.busiestDay ? prettyDay(stats.busiestDay.day) : '—'}
          </div>
          <div className="activity-stat-context">
            {stats.busiestDay ? `${stats.busiestDay.total} records that day` : 'Nothing recorded yet'}
          </div>
        </div>
        <div className="activity-stat">
          <div className="activity-stat-label">Records in total</div>
          <div className="activity-stat-value">{stats.totalRecords.toLocaleString('en-IN')}</div>
          <div className="activity-stat-context">
            {stats.totals.sale} {stats.totals.sale === 1 ? 'sale' : 'sales'} · {stats.totals.purchase} purchase{stats.totals.purchase === 1 ? '' : 's'} · {stats.totals.expense} expense{stats.totals.expense === 1 ? '' : 's'}
            {stats.totals.quotation > 0 ? ` · ${stats.totals.quotation} quotation${stats.totals.quotation === 1 ? '' : 's'}` : ''}
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="activity-scroll">
        <div
          className="activity-grid"
          style={{ '--activity-weeks': grid.length } as CSSProperties}
          role="img"
          aria-label={`Daily activity from ${windowStart} to ${today}: ${stats.activeDays} days with records`}
        >
          {monthLabels.map((label, index) => label && (
            <div key={`month-${index}`} className="activity-month" style={{ gridColumn: index + 2 }} aria-hidden="true">{label}</div>
          ))}
          {WEEKDAY_LABELS.map((label, index) => (
            <div key={label} className="activity-weekday" style={{ gridRow: index + 2 }} aria-hidden="true">{label}</div>
          ))}
          {grid.map((column, weekIndex) => column.map((cell, weekday) => (
            <div
              key={cell.day}
              className="activity-day"
              data-level={cell.level}
              data-future={cell.future ? 'true' : 'false'}
              data-before={cell.beforeRecords ? 'true' : 'false'}
              style={{ gridColumn: weekIndex + 2, gridRow: weekday + 2 }}
              title={describeDay(cell)}
            />
          )))}
        </div>
      </div>

      <div className="flex justify-between items-center" style={{ marginTop: '14px', flexWrap: 'wrap', gap: '10px' }}>
        <p className="text-muted" style={{ fontSize: '12px', margin: 0 }}>
          {stats.totalRecords === 0
            ? 'Nothing recorded yet — squares will fill in as you enter sales, purchases and expenses.'
            : `Records on file from ${prettyDay(stats.firstDay!)} onwards; the plain outlined squares before that are days before your first record. Hover a square to see that day.`}
          {' '}Time of day isn&apos;t shown because this system records the date on a sale, not the hour.
        </p>
        <div className="activity-legend">
          <span>Quieter</span>
          {[0, 1, 2, 3, 4].map((level) => <span key={level} className="activity-day" data-level={level} />)}
          <span>Busier</span>
        </div>
      </div>
    </div>
  );
}
