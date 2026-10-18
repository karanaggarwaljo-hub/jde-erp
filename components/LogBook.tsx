'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, ScrollText, Search } from 'lucide-react';
import { useCompany } from '@/components/CompanyProvider';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import { actionLabel, kindOf, LOG_KINDS, logBookCsv, shopDay, shopDayHeading, shopTime, type LogKind, type LogRow } from '@/lib/logbook';

type Range = 'all' | 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom';
const RANGES: Array<{ key: Range; label: string }> = [
  { key: 'all', label: 'All time' },
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Pick dates…' },
];

const KIND_COLOR: Record<LogKind, string> = {
  sales: 'var(--chart-blue)',
  purchases: 'var(--chart-orange)',
  stock: 'var(--chart-teal)',
  expenses: 'var(--chart-pink)',
  files: 'var(--chart-violet)',
  website: 'var(--chart-teal)',
  access: 'var(--ink-2)',
  data: 'var(--ink-2)',
  money: 'var(--color-success)',
};

const PAGE = 100;

/** Shop days (India time) for a preset range. */
function rangeDays(range: Range, custom: { from: string; to: string }): { from: string; to: string } {
  const today = shopDay(new Date());
  const dayOffset = (days: number) => shopDay(new Date(Date.now() - days * 86_400_000));
  switch (range) {
    case 'today': return { from: today, to: today };
    case 'yesterday': return { from: dayOffset(1), to: dayOffset(1) };
    case '7d': return { from: dayOffset(6), to: today };
    case '30d': return { from: dayOffset(29), to: today };
    case 'month': return { from: `${today.slice(0, 8)}01`, to: today };
    case 'custom': return custom;
    default: return { from: '', to: '' };
  }
}

/** A before/after pair shows as one line per figure that actually moved. */
function changedFigures(details: Record<string, unknown> | null): Array<{ field: string; from: unknown; to: unknown }> {
  const before = details?.before as Record<string, unknown> | null | undefined;
  const after = details?.after as Record<string, unknown> | null | undefined;
  if (!before || !after) return [];
  return Object.keys(after)
    .filter((field) => String(before[field] ?? '') !== String(after[field] ?? ''))
    .map((field) => ({ field, from: before[field], to: after[field] }));
}

/**
 * The Log Book: everything done in the ERP, with the exact time, who did it and from which device.
 * Written by the server as each thing happens, so nobody can edit it from any screen, this one
 * included.
 */
export default function LogBook() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? '';
  const [range, setRange] = useState<Range>('all');
  const [custom, setCustom] = useState({ from: shopDay(new Date()), to: shopDay(new Date()) });
  const [kind, setKind] = useState<LogKind | ''>('');
  const [actor, setActor] = useState('');
  const [searchText, setSearchText] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<LogRow[]>([]);
  const [people, setPeople] = useState<Array<{ email: string; name: string }>>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Typing settles for a moment before it searches, instead of a request per key.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchText.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchText]);

  const days = useMemo(() => rangeDays(range, custom), [range, custom]);

  const urlFor = (extra: Record<string, string>) => {
    const params = new URLSearchParams({ company_id: companyId, ...extra });
    if (days.from) params.set('from', days.from);
    if (days.to) params.set('to', days.to);
    if (kind) params.set('kind', kind);
    if (actor) params.set('actor', actor);
    if (query) params.set('q', query);
    return `/api/audit-log?${params.toString()}`;
  };

  useEffect(() => {
    if (!companyId) return;
    let active = true;
    void (async () => {
      try {
        const res = await fetch(urlFor({ limit: String(PAGE), people: '1' }));
        const data = (await parseJsonOrThrow(res, 'Could not load the Log Book.')) as { rows: LogRow[]; people: Array<{ email: string; name: string }> | null; hasMore: boolean };
        if (!active) return;
        setRows(data.rows);
        setHasMore(data.hasMore);
        if (data.people) setPeople(data.people);
        setError('');
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Could not load the Log Book.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
    // urlFor reads exactly these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, days.from, days.to, kind, actor, query, refreshKey]);

  const showOlder = async () => {
    const last = rows[rows.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const res = await fetch(urlFor({ limit: String(PAGE), before: last.at }));
      const data = (await parseJsonOrThrow(res, 'Could not load older entries.')) as { rows: LogRow[]; hasMore: boolean };
      setRows((current) => [...current, ...data.rows]);
      setHasMore(data.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load older entries.');
    } finally {
      setLoadingMore(false);
    }
  };

  const download = async () => {
    setDownloading(true);
    try {
      // Every entry the filters match, not only the ones on screen, up to a sane ceiling.
      const all: LogRow[] = [];
      let before = '';
      for (let page = 0; page < 40; page += 1) {
        const res = await fetch(urlFor({ limit: '500', ...(before ? { before } : {}) }));
        const data = (await parseJsonOrThrow(res, 'Could not prepare the download.')) as { rows: LogRow[]; hasMore: boolean };
        all.push(...data.rows);
        if (!data.hasMore || data.rows.length === 0) break;
        before = data.rows[data.rows.length - 1].at;
      }
      const blob = new Blob([logBookCsv(all)], { type: 'text/csv;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `log-book-${(activeCompany?.name ?? 'company').replace(/[^A-Za-z0-9]+/g, '-')}-${days.from || 'all'}${days.to && days.to !== days.from ? `-to-${days.to}` : ''}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare the download.');
    } finally {
      setDownloading(false);
    }
  };

  const grouped = useMemo(() => {
    const out: Array<{ day: string; rows: LogRow[] }> = [];
    for (const row of rows) {
      const day = shopDay(row.at);
      const last = out[out.length - 1];
      if (last?.day === day) last.rows.push(row);
      else out.push({ day, rows: [row] });
    }
    return out;
  }, [rows]);

  const restart = () => setLoading(true);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2"><ScrollText size={22} /> Log Book</h1>
          <p className="page-subtitle">
            Everything done in the ERP for {activeCompany?.name ?? 'this company'} — who, what, the exact time (India time)
            and from which device. Written automatically as it happens; nobody can edit or delete it.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => { restart(); setRefreshKey((key) => key + 1); }}><RefreshCw size={15} /> Refresh</button>
          <button type="button" className="btn btn-primary" disabled={downloading || rows.length === 0} onClick={download}>
            <Download size={15} /> {downloading ? 'Preparing…' : 'Download (Excel)'}
          </button>
        </div>
      </div>

      <div className="card mb-4">
        <div className="flex gap-3" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ minWidth: '150px' }}>
            <label className="form-label" htmlFor="log-range">When</label>
            <select id="log-range" className="form-input form-select" value={range} onChange={(event) => { restart(); setRange(event.target.value as Range); }}>
              {RANGES.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
            </select>
          </div>
          {range === 'custom' && (
            <>
              <div className="form-group">
                <label className="form-label" htmlFor="log-from">From</label>
                <input id="log-from" type="date" className="form-input" value={custom.from} max={custom.to} onChange={(event) => { restart(); setCustom({ ...custom, from: event.target.value }); }} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="log-to">To</label>
                <input id="log-to" type="date" className="form-input" value={custom.to} min={custom.from} onChange={(event) => { restart(); setCustom({ ...custom, to: event.target.value }); }} />
              </div>
            </>
          )}
          <div className="form-group" style={{ minWidth: '190px' }}>
            <label className="form-label" htmlFor="log-kind">What</label>
            <select id="log-kind" className="form-input form-select" value={kind} onChange={(event) => { restart(); setKind(event.target.value as LogKind | ''); }}>
              <option value="">Everything</option>
              {LOG_KINDS.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ minWidth: '170px' }}>
            <label className="form-label" htmlFor="log-actor">Who</label>
            <select id="log-actor" className="form-input form-select" value={actor} onChange={(event) => { restart(); setActor(event.target.value); }}>
              <option value="">Everyone</option>
              {people.map((person) => <option key={person.email} value={person.email}>{person.name || person.email}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ flex: '1 1 220px' }}>
            <label className="form-label" htmlFor="log-search">Find</label>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }} />
              <input id="log-search" className="form-input" style={{ paddingLeft: '30px' }} placeholder="Bill number, part, customer, supplier…"
                value={searchText} onChange={(event) => { restart(); setSearchText(event.target.value); }} />
            </div>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-danger mb-4" role="alert">{error}</div>}

      {loading ? (
        <div className="skeleton" style={{ height: '160px', width: '100%' }} />
      ) : rows.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon"><ScrollText size={22} /></div>
            <p className="empty-state-title">Nothing recorded {range === 'all' && !kind && !actor && !query ? 'yet' : 'for this choice'}</p>
            <p className="empty-state-desc">Try a wider date range, or clear the filters.</p>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="erp-table">
              <thead><tr><th style={{ width: '110px' }}>Time</th><th>What happened</th><th style={{ width: '220px' }}>Who &amp; device</th></tr></thead>
              <tbody>
                {grouped.map((group) => (
                  <Fragment key={group.day}>
                    <tr>
                      <td colSpan={3} style={{ background: 'var(--panel-2)', fontWeight: 700, fontSize: '12px', letterSpacing: '0.02em' }}>
                        {shopDayHeading(group.day)} <span className="text-muted" style={{ fontWeight: 400 }}>· {group.rows.length} entr{group.rows.length === 1 ? 'y' : 'ies'}{hasMore && group === grouped[grouped.length - 1] ? ' so far' : ''}</span>
                      </td>
                    </tr>
                    {group.rows.map((row) => {
                      const rowKind = kindOf(row.action);
                      const color = rowKind ? KIND_COLOR[rowKind] : 'var(--ink-3)';
                      const figures = changedFigures(row.details);
                      const isOpen = expanded === row.id;
                      const deleted = /[.]delete$/.test(row.action) || row.action === 'auth.signin_failed';
                      return (
                        <tr key={row.id}>
                          <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: '13px' }}>{shopTime(row.at)}</td>
                          <td>
                            <span className="badge" style={{ background: 'transparent', border: `1px solid ${deleted ? 'var(--chart-pink)' : color}`, color: deleted ? 'var(--chart-pink)' : color }}>
                              {actionLabel(row.action)}
                            </span>
                            <div style={{ marginTop: '4px' }}>{row.summary}</div>
                            {figures.length > 0 && (
                              <ul style={{ margin: '4px 0 0', paddingLeft: '16px', fontSize: '12px' }}>
                                {figures.map((figure) => (
                                  <li key={figure.field}>
                                    {figure.field.replace(/_/g, ' ')}: <span className="text-muted">{String(figure.from ?? '-')}</span> &rarr; <strong>{String(figure.to ?? '-')}</strong>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {figures.length === 0 && row.details && (
                              <>
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExpanded(isOpen ? null : row.id)}>{isOpen ? 'Hide details' : 'Details'}</button>
                                {isOpen && (
                                  <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '11px' }}>{JSON.stringify(row.details, null, 2)}</pre>
                                )}
                              </>
                            )}
                          </td>
                          <td style={{ fontSize: '12px' }}>
                            <div style={{ fontWeight: 600 }}>{row.actor_name || row.actor_email}</div>
                            {row.actor_name && row.actor_email !== 'system' && <div className="text-muted">{row.actor_email}</div>}
                            {row.device && <div className="text-muted">{row.device}</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between" style={{ padding: '12px 16px', borderTop: '1px solid var(--line-2)' }}>
            <span className="text-muted" style={{ fontSize: '12px' }}>Showing {rows.length} entr{rows.length === 1 ? 'y' : 'ies'}, newest first</span>
            {hasMore && (
              <button type="button" className="btn btn-secondary btn-sm" disabled={loadingMore} onClick={showOlder}>{loadingMore ? 'Loading…' : 'Show older'}</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
