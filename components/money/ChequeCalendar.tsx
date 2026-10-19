'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Lightbulb } from 'lucide-react';
import { dueDate, STATUS_LABEL, type ChequeRow, type ChequeStatus } from '@/lib/cheques';
import {
  addDays,
  breakdown,
  dailyAverage,
  flatPattern,
  partyHabit,
  projectDays,
  suggestDate,
  weekdayOf,
  type CollectionDay,
} from '@/lib/cheque-plan';

const rupees = (value: number | string) => `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;
/** Short enough for a calendar square on a phone. */
const compact = (value: number) => (value >= 100000 ? `₹${(value / 100000).toFixed(1)}L` : value >= 1000 ? `₹${Math.round(value / 1000)}k` : `₹${Math.round(value)}`);
const pretty = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthTitle = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shiftMonth = (month: string, by: number) => {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + by, 1)).toISOString().slice(0, 7);
};
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STATUS_BADGE: Record<ChequeStatus, string> = { pending: 'badge-warning', cleared: 'badge-success', bounced: 'badge-danger', cancelled: 'badge-muted', returned: 'badge-info' };
/** How far ahead the planner looks. */
const HORIZON = 90;

type DayTotals = { given: number; givenCount: number; received: number; receivedCount: number; bounced: number; cheques: ChequeRow[] };

/**
 * The Cheques page's Calendar: every cheque on the date written on it, and a planner that answers
 * "when can I date a cheque for this much?" from three figures the owner can see and change — the
 * money in the bank today, the money sales bring in on an average day (worked out from the last 30
 * days, lib/cheque-plan.ts), and the cheques already given and received. The answer is one sentence
 * with the sum that gives it underneath.
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
  const average = useMemo(() => dailyAverage(collections, today), [collections, today]);
  // The daily figure starts as the average from sales and can be changed to what the owner knows.
  const [perDayText, setPerDayText] = useState<string | null>(null);
  const perDay = perDayText === null ? Math.round(average.perDay) : Number(perDayText) || 0;

  const bankKnown = inBank.trim() !== '';
  const days = useMemo(() => projectDays({ cheques, pattern: flatPattern(perDay), today, startBalance: Number(inBank) || 0, horizon: HORIZON }), [cheques, perDay, today, inBank]);
  const dayByDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);
  const wanted = Number(amount) || 0;
  const suggestion = wanted > 0 && bankKnown ? suggestDate(days, wanted) : null;
  const parts = suggestion?.date ? breakdown(days, suggestion.date) : null;
  const habit = useMemo(() => partyHabit(cheques, party.trim() || null), [cheques, party]);

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
  const who = party.trim();

  return (
    <>
      <div className="card mb-4">
        <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}><Lightbulb size={16} /> When can I date a cheque?</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div className="form-group"><label className="form-label" htmlFor="plan-amount">Cheque amount (₹)</label>
            <input id="plan-amount" type="number" min="0" step="1" inputMode="numeric" className="form-input" placeholder="e.g. 40000" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
          <div className="form-group"><label className="form-label" htmlFor="plan-bank">Money in your bank today (₹)</label>
            <input id="plan-bank" type="number" step="1" inputMode="numeric" className="form-input" placeholder="e.g. 25000" value={inBank} onChange={(event) => setInBank(event.target.value)} /></div>
          <div className="form-group"><label className="form-label" htmlFor="plan-perday">Money coming in per day (₹)</label>
            <input id="plan-perday" type="number" min="0" step="1" inputMode="numeric" className="form-input" value={perDayText ?? String(Math.round(average.perDay))} onChange={(event) => setPerDayText(event.target.value)} />
            <span className="text-muted" style={{ fontSize: 12 }}>
              {average.days > 0 ? `Your sales brought in ${rupees(average.total)} in the last ${average.days} days. Change it if you know better.` : 'No sales money recorded in the last 30 days. Type your usual daily takings.'}
            </span></div>
          <div className="form-group"><label className="form-label" htmlFor="plan-party">To (optional)</label>
            <input id="plan-party" className="form-input" list="plan-parties" placeholder="Supplier" value={party} onChange={(event) => setParty(event.target.value)} />
            <datalist id="plan-parties">{parties.map((name) => <option key={name} value={name} />)}</datalist></div>
        </div>

        {wanted > 0 && !bankKnown && (
          <div className="alert alert-info" role="status" style={{ marginTop: 12 }}>Type how much money is in your bank today to get a date.</div>
        )}

        {suggestion && (suggestion.date ? (
          <div className="alert alert-success" role="status" style={{ marginTop: 12, flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
            <span style={{ fontSize: 16 }}>
              {suggestion.date === today
                ? <>✅ You can date it <strong>today</strong>{who ? <> for {who}</> : null}.</>
                : <>Date it <strong>{pretty(suggestion.date)}</strong> or later{who ? <> for {who}</> : null}.</>}
            </span>
            {parts && (
              <span style={{ fontSize: 13 }}>
                By {suggestion.date === today ? 'today' : pretty(suggestion.date)}: {rupees(Number(inBank) || 0)} in the bank
                {parts.sales > 0 && <> + {rupees(parts.sales)} from sales</>}
                {parts.chequesIn > 0 && <> + {rupees(parts.chequesIn)} cheques you will receive</>}
                {parts.chequesOut > 0 && <> − {rupees(parts.chequesOut)} cheques you have already given</>}
                {' '}= <strong>{rupees(dayByDate.get(suggestion.date)?.balance ?? 0)}</strong>, enough for {rupees(wanted)}.
              </span>
            )}
            {suggestion.date !== today && <button type="button" className="btn btn-secondary btn-sm" onClick={() => show(suggestion.date!)}>Show on calendar</button>}
          </div>
        ) : (
          <div className="alert alert-danger" role="alert" style={{ marginTop: 12 }}>
            <span>Not enough money in the next {HORIZON} days. You are about <strong>{rupees(suggestion.shortBy)}</strong> short.</span>
          </div>
        ))}

        {who && habit.count > 0 && habit.last && (
          <p className="text-sm text-muted" style={{ marginTop: 8 }}>
            Last cheque to {who}: {rupees(habit.last.amount)}, given {pretty(habit.last.issuedOn)}
            {habit.postDatedDays ? <>; you usually date their cheques {habit.postDatedDays} day{habit.postDatedDays === 1 ? '' : 's'} ahead</> : null}.
          </p>
        )}
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
            const isSuggested = suggestion?.date === day;
            return (
              <button key={day} type="button" onClick={() => setSelected(day)} aria-pressed={selected === day}
                aria-label={`${pretty(day)}${totals ? `: ${totals.givenCount} given, ${totals.receivedCount} received` : ''}${isSuggested ? ', suggested date' : ''}`}
                style={{
                  minHeight: 64, padding: 4, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2, borderRadius: 8, cursor: 'pointer', minWidth: 0, overflow: 'hidden',
                  border: isSuggested ? '2px solid var(--color-success)' : day === today ? '2px solid var(--brand-primary)' : '1px solid var(--line)',
                  background: selected === day ? 'var(--panel-2)' : 'var(--bg-card)', color: 'var(--ink)', font: 'inherit',
                }}>
                <span style={{ fontSize: 12, fontWeight: day === today ? 700 : 500, color: day < today ? 'var(--ink-3)' : 'var(--ink)' }}>{Number(day.slice(8))}</span>
                {totals && totals.givenCount > 0 && <span style={{ fontSize: 11, color: 'var(--color-danger)', fontWeight: 600, whiteSpace: 'nowrap' }}>−{compact(totals.given)}{totals.givenCount > 1 ? ` ·${totals.givenCount}` : ''}</span>}
                {totals && totals.receivedCount > 0 && <span style={{ fontSize: 11, color: 'var(--color-success)', fontWeight: 600, whiteSpace: 'nowrap' }}>+{compact(totals.received)}{totals.receivedCount > 1 ? ` ·${totals.receivedCount}` : ''}</span>}
                {totals && totals.bounced > 0 && <span style={{ fontSize: 10, color: 'var(--color-danger)' }}>{totals.bounced} bounced</span>}
                {isSuggested && <span style={{ fontSize: 10, color: 'var(--color-success)', fontWeight: 700 }}>✓ date it</span>}
              </button>
            );
          })}
        </div>
        <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}>−</span> cheques you gave, <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>+</span> cheques you received, on the date written on them.
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
          {bankKnown && pickedDay && selected >= today && (
            <p className="text-muted text-sm" style={{ marginTop: 8 }}>
              Expected in your bank by the end of the day: <strong style={{ color: pickedDay.balance < 0 ? 'var(--color-danger)' : undefined }}>{rupees(pickedDay.balance)}</strong>
              {pickedDay.balance < 0 && <> — not enough; a cheque presented by then may bounce</>}.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
