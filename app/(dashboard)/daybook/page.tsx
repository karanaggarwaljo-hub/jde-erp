'use client';

/**
 * The day book: every transaction of a day, from every part of the business, in one list.
 *
 * Each kind is still recorded where it belongs, and each of those screens still shows only its
 * own. This is the other half — one place to stand at the end of a day and see what actually
 * happened, the way a day book has always worked.
 *
 * What it deliberately does NOT do is mix up two different numbers. The value of a document and
 * the cash that moved are separate columns, because a ₹10,000 credit sale is a real sale and is
 * also zero rupees in the till, and a screen that adds those together is worse than no screen.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  BookOpen, RefreshCw, ShoppingCart, ShoppingBag, Receipt,
} from 'lucide-react';
import { useCompany } from '@/components/CompanyProvider';
import { getDayBook } from '@/lib/client-daybook';
import { groupByDay, DAYBOOK_LABELS, type DayBookEntry, type DayBookKind, type DayBookTotals } from '@/lib/daybook';
import DayBookDays, { niceDate } from '@/components/DayBookDays';
import { wholeMoney } from '@/lib/money';

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function shift(isoDate: string, days: number): string {
  const parsed = new Date(`${isoDate}T00:00:00`);
  parsed.setDate(parsed.getDate() + days);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}


type RangeName = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

export default function DayBookPage() {
  const { activeCompany } = useCompany();
  const [range, setRange] = useState<RangeName>('today');
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [kindFilter, setKindFilter] = useState<DayBookKind | 'all'>('all');
  const [entries, setEntries] = useState<DayBookEntry[]>([]);
  const [totals, setTotals] = useState<DayBookTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Bumped by Refresh. The fetch lives in the effect rather than in a handler the effect calls,
  // so asking for it again is a dependency change like any other.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    // Changing the range while a request is in flight must not let the older answer land on top
    // of the newer one — which, on a screen whose whole job is a day's figures, would be a
    // wrong day's figures under the right day's heading.
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      if (!activeCompany) {
        setEntries([]);
        setTotals(null);
        setLoading(false);
        return;
      }
      try {
        const result = await getDayBook(activeCompany.id, from, to);
        if (cancelled) return;
        setEntries(result.entries);
        setTotals(result.totals);
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : 'Could not load the day book.');
        setEntries([]);
        setTotals(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeCompany, from, to, reloadToken]);

  const pickRange = (name: RangeName) => {
    setRange(name);
    const today = todayIso();
    if (name === 'today') { setFrom(today); setTo(today); }
    else if (name === 'yesterday') { const y = shift(today, -1); setFrom(y); setTo(y); }
    else if (name === 'week') { setFrom(shift(today, -6)); setTo(today); }
    else if (name === 'month') { setFrom(`${today.slice(0, 7)}-01`); setTo(today); }
  };

  const shown = kindFilter === 'all' ? entries : entries.filter((entry) => entry.kind === kindFilter);
  const days = groupByDay(shown);
  // Counted off everything in the period, not off what the filter leaves, so the chips still say
  // how much there is to look at after one of them is chosen.
  const countOf = (kind: DayBookKind) => entries.filter((entry) => entry.kind === kind).length;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title flex items-center gap-2"><BookOpen size={20} /> Day Book</h1>
          <p className="page-subtitle">
            Every sale, purchase, payment and expense together, in the order it happened. Each one is
            still recorded on its own screen — this is where they all show up.
          </p>
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <Link href="/sales" className="btn btn-secondary btn-sm"><ShoppingCart size={14} /> Record a sale</Link>
          <Link href="/purchases" className="btn btn-secondary btn-sm"><ShoppingBag size={14} /> Record a purchase</Link>
          <Link href="/expenses" className="btn btn-secondary btn-sm"><Receipt size={14} /> Log an expense</Link>
        </div>
      </div>

      <div className="card mb-4">
        <div className="flex gap-2 items-end" style={{ flexWrap: 'wrap' }}>
          <div className="flex gap-1" role="group" aria-label="Period">
            {([['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'Last 7 days'], ['month', 'This month']] as const).map(([name, label]) => (
              <button
                key={name}
                type="button"
                className={'btn btn-sm ' + (range === name ? 'btn-primary' : 'btn-secondary')}
                onClick={() => pickRange(name)}
              >{label}</button>
            ))}
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="daybook-from">From</label>
            <input id="daybook-from" type="date" className="form-input" value={from}
              onChange={(event) => { setFrom(event.target.value); setRange('custom'); }} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="daybook-to">To</label>
            <input id="daybook-to" type="date" className="form-input" value={to}
              onChange={(event) => { setTo(event.target.value); setRange('custom'); }} />
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReloadToken((token) => token + 1)} disabled={loading}>
            <RefreshCw size={14} /> {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-danger mb-4" role="alert">{error}</div>}

      {totals && (
        <div className="kpi-grid mb-4">
          <div className="kpi-card">
            <div className="kpi-label">Money in</div>
            <div className="kpi-value text-success">₹{wholeMoney(totals.cashIn)}</div>
            <div className="kpi-context">Cash and transfers that actually arrived</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Money out</div>
            <div className="kpi-value text-danger">₹{wholeMoney(totals.cashOut)}</div>
            <div className="kpi-context">Paid to suppliers, expenses and refunds</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Net</div>
            <div className={'kpi-value ' + (totals.netCash >= 0 ? 'text-success' : 'text-danger')}>
              ₹{wholeMoney(Math.abs(totals.netCash))}
            </div>
            <div className="kpi-context">{totals.netCash >= 0 ? 'More came in than went out' : 'More went out than came in'}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Billed</div>
            <div className="kpi-value">₹{wholeMoney(totals.sold)}</div>
            {/* Said plainly: this is what was invoiced, not what was collected. */}
            <div className="kpi-context">Sales written, paid or on account</div>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-4" style={{ flexWrap: 'wrap' }}>
        <button type="button" className={'btn btn-sm ' + (kindFilter === 'all' ? 'btn-primary' : 'btn-secondary')}
          onClick={() => setKindFilter('all')}>Everything ({entries.length})</button>
        {(Object.keys(DAYBOOK_LABELS) as DayBookKind[]).map((kind) => {
          const count = countOf(kind);
          if (count === 0) return null;
          return (
            <button key={kind} type="button"
              className={'btn btn-sm ' + (kindFilter === kind ? 'btn-primary' : 'btn-secondary')}
              onClick={() => setKindFilter(kind)}>{DAYBOOK_LABELS[kind]} ({count})</button>
          );
        })}
      </div>

      {loading && entries.length === 0 && <div className="card"><p className="text-muted">Loading the day book…</p></div>}

      {!loading && shown.length === 0 && !error && (
        <div className="card"><div className="empty-state" style={{ padding: '36px 20px' }}>
          <p className="empty-state-title">Nothing recorded {from === to ? niceDate(from, todayIso()).toLowerCase() : 'in this period'}</p>
          <p className="empty-state-desc">
            Sales, purchases, payments and expenses all appear here the moment they are saved on their own screens.
          </p>
        </div></div>
      )}

      <DayBookDays days={days} today={todayIso()} />

      {shown.length > 0 && (
        <p className="text-muted text-sm">
          <strong>Value</strong> is what the document is for. <strong>Money in</strong> and <strong>money out</strong> are
          what actually moved that day, so a sale on account shows its full value and nothing in the
          money column until the customer pays. Drafts are not shown — nothing has been billed yet.
          A balance settled off shows its value with no money either way, because none arrived.
        </p>
      )}
    </div>
  );
}

