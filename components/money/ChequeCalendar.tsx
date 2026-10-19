'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Lightbulb } from 'lucide-react';
import { dueDate, STATUS_LABEL, type ChequeRow, type ChequeStatus } from '@/lib/cheques';
import {
  addDays,
  collectionPattern,
  coveredOn,
  partyHabit,
  projectDays,
  suggestDate,
  weekdayOf,
  type CollectionDay,
} from '@/lib/cheque-plan';

const rupees = (value: number | string) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
/** Short enough for a calendar square on a phone. */
const compact = (value: number) => (value >= 100000 ? `₹${(value / 100000).toFixed(1)}L` : value >= 1000 ? `₹${Math.round(value / 1000)}k` : `₹${Math.round(value)}`);
const pretty = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const monthTitle = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shiftMonth = (month: string, by: number) => {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, number - 1 + by, 1));
  return date.toISOString().slice(0, 7);
};
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const STATUS_BADGE: Record<ChequeStatus, string> = { pending: 'badge-warning', cleared: 'badge-success', bounced: 'badge-danger', cancelled: 'badge-muted', returned: 'badge-info' };
/** How far ahead the projection and the suggestion look. */
const HORIZON = 90;

type DayTotals = { given: number; givenCount: number; received: number; receivedCount: number; bounced: number; cheques: ChequeRow[] };

/**
 * The Cheques page's Calendar: every cheque on the date written on it, and a planner that suggests
 * the date to give a new cheque — the earliest date it stays covered by the money your sales bring
 * in (lib/cheque-plan.ts), and the date you usually give that supplier, from your earlier cheques.
 */
export default function ChequeCalendar({ cheques, collections, today, parties }: {
  cheques: ChequeRow[];
  collections: CollectionDay[];
  today: string;
  /** Supplier names, for choosing who the cheque is for. */
  parties: string[];
}) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [amount, setAmount] = useState('');
  const [party, setParty] = useState('');
  const [inBank, setInBank] = useState('');
  const [notBefore, setNotBefore] = useState('');

  const pattern = useMemo(() => collectionPattern(collections, today), [collections, today]);
  const days = useMemo(() => projectDays({ cheques, pattern, today, startBalance: Number(inBank) || 0, horizon: HORIZON }), [cheques, pattern, today, inBank]);
  const dayByDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);
  const wanted = Number(amount) || 0;
  const suggestion = wanted > 0 ? suggestDate(days, wanted, notBefore || null) : null;
  const habit = useMemo(() => partyHabit(cheques, party.trim() || null), [cheques, party]);
  const usualDate = habit.postDatedDays != null ? addDays(today, habit.postDatedDays) : null;
  const nextPayment = party.trim() && habit.everyDays && habit.last ? addDays(habit.last.issuedOn, habit.everyDays) : null;
  const busiest = pattern.daysCovered > 0 ? pattern.byWeekday.indexOf(Math.max(...pattern.byWeekday)) : -1;

  // Every cheque on the date written on it. A spoiled leaf (cancelled, no amount) is not a cheque.
  const byDate = useMemo(() => {
    const map = new Map<string, DayTotals>();
    for (const cheque of cheques) {
      if (cheque.status === 'cancelled' && !Number(cheque.amount)) continue;
      const day = dueDate(cheque);
      const entry = map.get(day) ?? { given: 0, givenCount: 0, received: 0, receivedCount: 0, bounced: 0, cheques: [] };
      entry.cheques.push(cheque);
      if (cheque.status === 'bounced') entry.bounced += 1;
      else if (cheque.status !== 'cancelled') {
        if (cheque.direction === 'out') { entry.given += Number(cheque.amount) || 0; entry.givenCount += 1; }
        else { entry.received += Number(cheque.amount) || 0; entry.receivedCount += 1; }
      }
      map.set(day, entry);
    }
    return map;
  }, [cheques]);

  const first = `${month}-01`;
  const offset = (weekdayOf(first) + 6) % 7;
  const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const cells: Array<string | null> = [...Array.from({ length: offset }, () => null), ...Array.from({ length: daysInMonth }, (_, index) => addDays(first, index))];
  while (cells.length % 7) cells.push(null);

  const show = (day: string) => {
    setMonth(day.slice(0, 7));
    setSelected(day);
  };
  const picked = byDate.get(selected);
  const pickedDay = dayByDate.get(selected);

  return (
    <>
      <div className="card mb-4">
        <div className="card-header"><h3 className="card-title"><Lightbulb size={16} style={{ verticalAlign: '-3px' }} /> When should I date a cheque?</h3></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          <div className="form-group"><label className="form-label" htmlFor="plan-amount">Amount (₹)</label>
            <input id="plan-amount" type="number" min="0" step="1" inputMode="numeric" className="form-input" placeholder="e.g. 50000" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
          <div className="form-group"><label className="form-label" htmlFor="plan-party">To (optional)</label>
            <input id="plan-party" className="form-input" list="plan-parties" placeholder="Supplier" value={party} onChange={(event) => setParty(event.target.value)} />
            <datalist id="plan-parties">{parties.map((name) => <option key={name} value={name} />)}</datalist></div>
          <div className="form-group"><label className="form-label" htmlFor="plan-bank">In the bank today (optional)</label>
            <input id="plan-bank" type="number" step="1" inputMode="numeric" className="form-input" placeholder="₹" value={inBank} onChange={(event) => setInBank(event.target.value)} /></div>
          <div className="form-group"><label className="form-label" htmlFor="plan-after">Not before (optional)</label>
            <input id="plan-after" type="date" className="form-input" min={today} value={notBefore} onChange={(event) => setNotBefore(event.target.value)} /></div>
        </div>

        {suggestion && (
          suggestion.date ? (
            <div className="alert alert-success" role="status" style={{ marginTop: 12, flexWrap: 'wrap' }}>
              <span>
                <strong>Date it {pretty(suggestion.date)}</strong> or later. From that day on, the money expected in covers {rupees(wanted)} along with every cheque you have already given.
              </span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => show(suggestion.date!)}>Show on calendar</button>
            </div>
          ) : (
            <div className="alert alert-danger" role="alert" style={{ marginTop: 12 }}>
              <span>
                Not covered in the next {HORIZON} days: about <strong>{rupees(suggestion.shortBy)}</strong> more is needed. Put money in the bank first, or split it into smaller cheques dated further apart.
              </span>
            </div>
          )
        )}

        {party.trim() && (
          <p className="text-sm" style={{ marginTop: 10 }}>
            {habit.count === 0 ? (
              <span className="text-muted">No earlier cheques to {party.trim()} in the register.</span>
            ) : (
              <>
                <strong>Your earlier cheques to {party.trim()}:</strong> {habit.count} given
                {habit.postDatedDays != null && <>, usually dated <strong>{habit.postDatedDays} day{habit.postDatedDays === 1 ? '' : 's'}</strong> after you gave them</>}
                {habit.last && <>; the last was {rupees(habit.last.amount)}, given {habit.last.issuedOn}</>}.
                {nextPayment && <> You pay them about every {habit.everyDays} days, so the next is due around <strong>{pretty(nextPayment)}</strong>.</>}
                {usualDate && wanted > 0 && (
                  coveredOn(days, wanted, usualDate)
                    ? <> Your usual date, <strong>{pretty(usualDate)}</strong>, is covered.</>
                    : <> Your usual date, {pretty(usualDate)}, would <strong className="text-danger">not</strong> be covered{suggestion?.date ? <> — use {pretty(suggestion.date)} or later</> : null}.</>
                )}
              </>
            )}
          </p>
        )}
        {!party.trim() && habit.postDatedDays != null && (
          <p className="text-sm text-muted" style={{ marginTop: 10 }}>Across all your earlier cheques, you usually date them {habit.postDatedDays} day{habit.postDatedDays === 1 ? '' : 's'} after you give them.</p>
        )}

        <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          {pattern.daysCovered > 0
            ? <>Based on {rupees(pattern.total)} received from sales over the last {pattern.daysCovered} days (about {rupees(pattern.total / pattern.daysCovered)} a day; most on {WEEKDAY_NAMES[busiest]}s), the cheques you have received that are still to clear, and the cheques you have already given. </>
            : <>No money has been received from sales in the last 12 weeks, so only cheques coming in and the bank figure are counted. </>}
          {pattern.daysCovered > 0 && pattern.daysCovered < 28 && <>Only {pattern.daysCovered} days of history so far, so this gets better as more sales are recorded. </>}
          {!inBank && <>With &ldquo;In the bank today&rdquo; blank it starts from nothing, which errs on the safe side. </>}
          It assumes the money you take in reaches the bank.
        </p>
      </div>

      <div className="card">
        <div className="card-header" style={{ gap: 8 }}>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} /></button>
          <h3 className="card-title" style={{ flex: 1, textAlign: 'center' }}>{monthTitle(month)}</h3>
          {month !== today.slice(0, 7) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => show(today)}>Today</button>}
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} /></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
          {WEEKDAYS.map((name) => <div key={name} className="text-muted" style={{ fontSize: 11, textAlign: 'center', fontWeight: 600 }}>{name}</div>)}
          {cells.map((day, index) => {
            if (!day) return <div key={`blank-${index}`} />;
            const totals = byDate.get(day);
            const projected = dayByDate.get(day);
            const isSuggested = suggestion?.date === day;
            return (
              <button key={day} type="button" onClick={() => setSelected(day)} aria-pressed={selected === day}
                aria-label={`${pretty(day)}${totals ? `: ${totals.givenCount} given, ${totals.receivedCount} received` : ''}${isSuggested ? ', suggested date' : ''}`}
                style={{
                  minHeight: 74, padding: 4, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2, borderRadius: 8, cursor: 'pointer', minWidth: 0, overflow: 'hidden',
                  border: isSuggested ? '2px solid var(--color-success)' : day === today ? '2px solid var(--brand-primary)' : '1px solid var(--line)',
                  background: selected === day ? 'var(--panel-2)' : 'var(--bg-card)', color: 'var(--ink)', font: 'inherit',
                }}>
                <span style={{ fontSize: 12, fontWeight: day === today ? 700 : 500, color: day < today ? 'var(--ink-3)' : 'var(--ink)' }}>{Number(day.slice(8))}</span>
                {totals && totals.givenCount > 0 && <span style={{ fontSize: 11, color: 'var(--color-danger)', fontWeight: 600, whiteSpace: 'nowrap' }}>−{compact(totals.given)}{totals.givenCount > 1 ? ` ·${totals.givenCount}` : ''}</span>}
                {totals && totals.receivedCount > 0 && <span style={{ fontSize: 11, color: 'var(--color-success)', fontWeight: 600, whiteSpace: 'nowrap' }}>+{compact(totals.received)}{totals.receivedCount > 1 ? ` ·${totals.receivedCount}` : ''}</span>}
                {totals && totals.bounced > 0 && <span style={{ fontSize: 10, color: 'var(--color-danger)' }}>{totals.bounced} bounced</span>}
                {projected && day > today && projected.expectedIn > 0 && <span className="text-muted" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>~{compact(projected.expectedIn)} sales</span>}
                {isSuggested && <span style={{ fontSize: 10, color: 'var(--color-success)', fontWeight: 700 }}>✓ date it</span>}
              </button>
            );
          })}
        </div>
        <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}>−</span> cheques you gave, <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>+</span> cheques you received, on the date written on them. &ldquo;~ sales&rdquo; is the money a usual day of that weekday brings in.
        </p>

        <div style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 12 }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{pretty(selected)}</h4>
          {(!picked || picked.cheques.length === 0) && <p className="text-muted text-sm">No cheque is dated this day.</p>}
          {picked && picked.cheques.length > 0 && (
            <div className="table-wrap">
              <table className="erp-table">
                <tbody>
                  {picked.cheques.map((cheque) => (
                    <tr key={cheque.id}>
                      <td style={{ color: cheque.direction === 'out' ? 'var(--color-danger)' : 'var(--color-success)', fontWeight: 600, whiteSpace: 'nowrap' }}>{cheque.direction === 'out' ? 'Given' : 'Received'}</td>
                      <td>{cheque.party || <span className="text-muted">—</span>}{cheque.purpose === 'security' && <div className="text-muted text-sm">Security cheque</div>}</td>
                      <td>{cheque.cheque_no ? <span className="pn-chip">{cheque.cheque_no}</span> : <span className="text-muted">No number</span>}</td>
                      <td className="text-right font-semibold">{Number(cheque.amount) ? rupees(cheque.amount) : <span className="text-muted">—</span>}</td>
                      <td><span className={`badge ${STATUS_BADGE[cheque.status]}`}>{STATUS_LABEL[cheque.status]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pickedDay && selected >= today && (
            <p className="text-muted text-sm" style={{ marginTop: 8 }}>
              {selected > today && <>Usual money in from sales: {rupees(pickedDay.expectedIn)}. </>}
              Expected {inBank ? 'in the bank' : 'built up from today'} by the end of the day: <strong style={{ color: pickedDay.balance < 0 ? 'var(--color-danger)' : undefined }}>{rupees(pickedDay.balance)}</strong>
              {pickedDay.balance < 0 && <> — short; a cheque presented by then may bounce</>}.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
