'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Download, IndianRupee, Percent, Search, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import { groupProfit, sortProfitRows, type ProfitGroupBy, type ProfitLine, type ProfitSort, type ProfitTotals } from '@/lib/part-profit';
import type { Period } from '@/lib/report-period';

const GROUPS: Array<{ key: ProfitGroupBy; label: string; noun: string }> = [
  { key: 'part', label: 'By part', noun: 'Part' },
  { key: 'category', label: 'By category', noun: 'Category' },
  { key: 'brand', label: 'By brand', noun: 'Brand' },
  { key: 'customer', label: 'By customer', noun: 'Customer' },
  { key: 'supplier', label: 'By supplier', noun: 'Bought from' },
];

const SORTS: Array<{ key: ProfitSort; label: string }> = [
  { key: 'profit', label: 'Most profit first' },
  { key: 'sales', label: 'Most sales first' },
  { key: 'qty', label: 'Most sold first' },
  { key: 'margin-low', label: 'Lowest margin first' },
  { key: 'margin-high', label: 'Highest margin first' },
];

/** Below this, a margin is worth a second look. */
const THIN_MARGIN_PERCENT = 10;

const rupees = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const qtyText = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2));

function Stat({ title, value, icon: Icon, color, bg, note }: { title: string; value: string; icon: typeof TrendingUp; color: string; bg: string; note?: string }) {
  return (
    <div className="kpi-card" style={{ '--kpi-color': color, '--kpi-color-bg': bg } as React.CSSProperties}>
      <div className="flex justify-between items-center">
        <span className="kpi-label">{title}</span>
        <div className="kpi-icon-wrap"><Icon size={18} /></div>
      </div>
      <div className="kpi-value">{value}</div>
      {note && <div className="kpi-change text-muted" style={{ fontSize: '12px' }}>{note}</div>}
    </div>
  );
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Reports → Profit: what each part, category, brand, customer or supplier earned in the period —
 * sales before GST, what those goods cost from the batches they came out of, and the profit and
 * margin between them. lib/part-profit.ts does the arithmetic; the server gathers the records.
 */
export default function ProfitReport({ companyId, companyName, period, periodLabel }: {
  companyId: string;
  companyName: string;
  period: Period;
  periodLabel: string;
}) {
  const [lines, setLines] = useState<ProfitLine[] | null>(null);
  const [totals, setTotals] = useState<ProfitTotals | null>(null);
  const [error, setError] = useState('');
  const [groupBy, setGroupBy] = useState<ProfitGroupBy>('part');
  const [sort, setSort] = useState<ProfitSort>('profit');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!companyId) return;
    let active = true;
    void (async () => {
      try {
        const params = new URLSearchParams({ companyId });
        if (period.start) params.set('from', period.start);
        if (period.end) params.set('to', period.end);
        const res = await fetch(`/api/reports/profit?${params.toString()}`);
        const data = (await parseJsonOrThrow(res, 'The profit report could not be loaded.')) as { lines: ProfitLine[]; totals: ProfitTotals };
        if (!active) return;
        setLines(data.lines);
        setTotals(data.totals);
        setError('');
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'The profit report could not be loaded.');
      }
    })();
    return () => { active = false; };
  }, [companyId, period.start, period.end]);

  const group = GROUPS.find((entry) => entry.key === groupBy) ?? GROUPS[0];
  const rows = useMemo(() => {
    if (!lines) return [];
    const term = search.trim().toLowerCase();
    const grouped = groupProfit(lines, groupBy).filter((row) => !term || `${row.label} ${row.detail}`.toLowerCase().includes(term));
    return sortProfitRows(grouped, sort);
  }, [lines, groupBy, sort, search]);
  const totalProfit = rows.reduce((sum, row) => sum + Math.max(0, row.profit), 0);

  const download = () => {
    const header = [group.noun, ...(groupBy === 'part' ? ['Part number'] : []), 'Qty sold', 'Sales before GST (Rs)', 'Cost (Rs)', 'Profit (Rs)', 'Margin %', 'Bills', 'Sales with no recorded cost (Rs)'];
    const body = rows.map((row) => [
      row.label, ...(groupBy === 'part' ? [row.detail] : []), qtyText(row.qty), row.sales, row.cost, row.profit,
      row.marginPercent ?? '', row.bills, row.uncostedSales || '',
    ].map(csvCell).join(','));
    const blob = new Blob(['﻿' + [header.map(csvCell).join(','), ...body].join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `profit-${groupBy}-${companyName.replace(/[^A-Za-z0-9]+/g, '-')}-${period.start ?? 'start'}-to-${period.end ?? 'today'}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  };

  if (error) return <div className="alert alert-danger mb-4" role="alert">{error}</div>;
  if (!lines || !totals) return <div className="skeleton" style={{ height: '220px', width: '100%' }} />;

  if (lines.length === 0) {
    return (
      <div className="card">
        <div className="empty-state">
          <div className="empty-state-icon"><TrendingUp size={22} /></div>
          <p className="empty-state-title">No sales in {periodLabel}</p>
          <p className="empty-state-desc">
            Profit shows here as soon as bills are made. For a part to show its real profit, record the purchase
            of that stock with what you paid — the ERP then knows the cost of every piece it sells.
          </p>
        </div>
      </div>
    );
  }

  const allUncosted = totals.uncostedLines === totals.lines;
  return (
    <>
      <div className="kpi-grid">
        <Stat title="Sales before GST" value={rupees(totals.sales)} icon={IndianRupee} color="var(--color-success)" bg="var(--color-success-bg)"
          note={`${totals.bills} bill${totals.bills === 1 ? '' : 's'}, after discounts and returns`} />
        <Stat title="Cost of what was sold" value={allUncosted ? 'Not known' : rupees(totals.cost)} icon={Wallet} color="var(--chart-blue)" bg="var(--color-info-bg)"
          note="What you paid for those pieces, batch by batch" />
        <Stat title="Gross profit" value={allUncosted ? 'Not known' : rupees(totals.profit)} icon={totals.profit >= 0 ? TrendingUp : TrendingDown}
          color={totals.profit >= 0 ? 'var(--color-success)' : 'var(--color-danger)'} bg={totals.profit >= 0 ? 'var(--color-success-bg)' : 'var(--color-danger-bg)'}
          note="Sales less their cost, before expenses" />
        <Stat title="Margin" value={totals.marginPercent === null ? 'Not known' : `${totals.marginPercent.toFixed(1)}%`} icon={Percent} color="var(--chart-amber)" bg="var(--color-warning-bg)"
          note="Profit as a share of sales" />
      </div>

      {totals.uncostedLines > 0 && (
        <div className="alert alert-warning mb-4" role="status">
          <AlertCircle size={16} />
          <span>
            {totals.uncostedLines} of {totals.lines} bill line{totals.lines === 1 ? '' : 's'} ({rupees(totals.uncostedSales)} of sales) {totals.uncostedLines === 1 ? 'has' : 'have'} no
            recorded cost — usually a line typed by hand rather than picked from stock, or stock entered without a cost.
            {' '}{allUncosted ? 'So no profit can be worked out yet.' : 'Their sales are counted, but they are left out of profit and margin rather than counted as pure profit.'}
          </span>
        </div>
      )}

      <div className="card">
        <div className="card-header" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="tabs" role="group" aria-label="Group the profit report">
            {GROUPS.map((entry) => (
              <button key={entry.key} type="button" aria-pressed={groupBy === entry.key} className={`tab ${groupBy === entry.key ? 'active' : ''}`} onClick={() => setGroupBy(entry.key)}>
                {entry.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2 items-center" style={{ flexWrap: 'wrap' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }} />
              <input className="form-input" style={{ paddingLeft: 30, width: 200 }} placeholder={`Find a ${group.noun.toLowerCase()}…`} value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search the profit report" />
            </div>
            <select className="form-input form-select" style={{ width: 'auto' }} value={sort} onChange={(event) => setSort(event.target.value as ProfitSort)} aria-label="Sort the profit report">
              {SORTS.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
            </select>
            <button type="button" className="btn btn-secondary btn-sm" onClick={download}><Download size={14} /> Download (Excel)</button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="erp-table">
            <thead>
              <tr>
                <th>{group.noun}</th>
                <th className="text-right">Qty sold</th>
                <th className="text-right">Sales ₹</th>
                <th className="text-right">Cost ₹</th>
                <th className="text-right">Profit ₹</th>
                <th className="text-right">Margin</th>
                <th style={{ width: 140 }}>Share of profit</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={7} className="text-muted">Nothing matches “{search}”.</td></tr>
              )}
              {rows.map((row) => {
                const loss = row.profit < 0;
                const thin = row.marginPercent !== null && row.marginPercent < THIN_MARGIN_PERCENT;
                const share = totalProfit > 0 && row.profit > 0 ? (row.profit / totalProfit) * 100 : 0;
                const costed = row.sales - row.uncostedSales > 0;
                return (
                  <tr key={row.key}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{row.label}</div>
                      <div className="text-muted" style={{ fontSize: 12 }}>
                        {row.detail && <span className="pn-chip" style={{ marginRight: 6 }}>{row.detail}</span>}
                        {row.bills} bill{row.bills === 1 ? '' : 's'}
                        {row.uncostedLines > 0 && <span> · {rupees(row.uncostedSales)} with no recorded cost</span>}
                      </div>
                    </td>
                    <td className="text-right">{qtyText(row.qty)}</td>
                    <td className="text-right">{rupees(row.sales)}</td>
                    <td className="text-right">{costed ? rupees(row.cost) : <span className="text-muted">Not known</span>}</td>
                    <td className={`text-right font-semibold ${loss ? 'text-danger' : ''}`}>{costed ? rupees(row.profit) : <span className="text-muted">—</span>}</td>
                    <td className="text-right">
                      {row.marginPercent === null
                        ? <span className="text-muted">—</span>
                        : <span className={`badge ${loss ? 'badge-danger' : thin ? 'badge-warning' : 'badge-success'}`}>{row.marginPercent.toFixed(1)}%</span>}
                    </td>
                    <td>
                      <div className="meter" aria-label={`${share.toFixed(0)}% of profit`}><i style={{ width: `${Math.min(100, share)}%` }} /></div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <span className="pager-info">
            Sales are what customers were charged before GST, after every discount and less returns. Cost is what you paid for the
            pieces sold, from the batches they came out of. A margin under {THIN_MARGIN_PERCENT}% is marked amber, a loss red.
            {groupBy === 'supplier' && ' By supplier, a sale of stock bought from two suppliers counts toward each, in proportion.'}
          </span>
        </div>
      </div>
    </>
  );
}
