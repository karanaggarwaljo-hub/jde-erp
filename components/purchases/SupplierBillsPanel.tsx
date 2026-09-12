'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, FileCheck, Search } from 'lucide-react';
import {
  FLAG_TEXT, billTotals, duplicateBillNumbers, matchBills,
  type BillablePurchase, type MatchedBill, type PurchaseLine, type ReturnToSupplier,
} from '@/lib/bill-matching';

const money = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;

export type SupplierBillsPanelProps = {
  purchases: BillablePurchase[];
  lines: PurchaseLine[];
  returns: ReturnToSupplier[];
  loading: boolean;
};

type Filter = 'all' | 'owing' | 'needs-checking';

/**
 * Checking each supplier bill against what was ordered, received and paid.
 *
 * This tab used to say only that matching was not available yet. Everything it needed was already
 * being recorded — what was billed, whether it was received, what has been paid, what was sent
 * back — it had just never been put side by side.
 *
 * Nothing here is estimated. Where two recorded documents disagree, the disagreement is shown
 * rather than reconciled away, because that is the thing worth looking at.
 */
export default function SupplierBillsPanel({ purchases, lines, returns, loading }: SupplierBillsPanelProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const matched = useMemo(() => matchBills(purchases, lines, returns), [purchases, lines, returns]);
  const totals = useMemo(() => billTotals(matched), [matched]);
  const duplicates = useMemo(() => duplicateBillNumbers(matched), [matched]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return matched
      .filter((bill) => {
        if (filter === 'owing' && bill.outstanding <= 0) return false;
        if (filter === 'needs-checking' && bill.flags.length === 0) return false;
        if (!query) return true;
        return (
          bill.purchase.id.toLowerCase().includes(query)
          || bill.purchase.supplier.toLowerCase().includes(query)
          || (bill.billNumber ?? '').toLowerCase().includes(query)
        );
      })
      .sort((a, b) => b.purchase.date.localeCompare(a.purchase.date));
  }, [matched, filter, search]);

  if (loading) return <div className="skeleton" style={{ height: '160px', width: '100%' }} />;

  if (matched.length === 0) {
    return (
      <div className="card empty-state">
        <div className="empty-state-icon"><FileCheck size={22} /></div>
        <p className="empty-state-title">No purchases recorded yet</p>
        <p className="empty-state-desc">Record a purchase and its bill will be checked here against what arrived and what was paid.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="kpi-grid">
        <Tile label="Billed" value={money(totals.billed)} note={`${totals.count} purchase${totals.count === 1 ? '' : 's'}`} />
        <Tile label="Paid" value={money(totals.paid)} note={totals.credited > 0 ? `${money(totals.credited)} credited back` : 'nothing credited back'} />
        <Tile label="Still owed" value={money(totals.outstanding)} note="bills less credits less payments" />
        <Tile
          label="Needs checking"
          value={`${totals.flagged}`}
          note={totals.flagged === 0 ? 'nothing to look at' : 'bills where something does not add up'}
        />
      </div>

      {duplicates.length > 0 && (
        <div className="alert alert-warning" role="alert">
          <AlertTriangle size={16} />
          <span>
            {duplicates.length === 1 ? 'One bill number appears' : `${duplicates.length} bill numbers appear`} twice
            for the same supplier: {duplicates.map((group) => `${group[0].billNumber} (${group.map((bill) => bill.purchase.id).join(' and ')})`).join('; ')}.
            These were recorded before the same bill could be refused, so check whether one of each pair should be removed.
          </span>
        </div>
      )}

      <div className="table-wrap">
        <div className="tbl-toolbar">
          <div className="tbl-toolbar-title">
            <strong>Supplier bills</strong>
            <small>
              Each bill against what was ordered, received and paid. Every figure is read off a
              recorded document — nothing here is estimated.
            </small>
          </div>
          <div className="tbl-tools">
            <div className="search-box">
              <Search size={14} />
              <input
                type="text"
                placeholder="Search bill number, purchase or supplier"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="tabs">
              {(['all', 'owing', 'needs-checking'] as Filter[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={filter === option}
                  className={`tab ${filter === option ? 'active' : ''}`}
                  onClick={() => setFilter(option)}
                >
                  {option === 'all' ? 'All' : option === 'owing' ? 'Still owed' : 'Needs checking'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <table className="erp-table">
          <thead>
            <tr>
              <th>Bill number</th>
              <th>Purchase</th>
              <th>Supplier</th>
              <th>Date</th>
              <th className="text-right">Billed</th>
              <th className="text-right">Lines add to</th>
              <th className="text-right">Credited</th>
              <th className="text-right">Paid</th>
              <th className="text-right">Still owed</th>
              <th>Checks</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((bill) => <Row key={bill.purchase.id} bill={bill} />)}
            {visible.length === 0 && (
              <tr><td colSpan={10}><div className="empty-state">
                <p className="empty-state-title">Nothing matches</p>
                <p className="empty-state-desc">Clear the search, or switch back to All.</p>
              </div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Said plainly rather than implied: this worksheet checks a bill as a whole. A delivery that
          arrives in two parts against one bill is not something the app records yet, and pretending
          otherwise on this screen would be the same mistake as the tab that claimed nothing at all. */}
      <p className="text-muted" style={{ fontSize: '12px' }}>
        A purchase is either received or not — receiving one bill in two separate deliveries is not
        recorded yet, so this checks each bill as a whole.
      </p>
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="kpi-card">
      <span className="kpi-label">{label}</span>
      <div className="kpi-value">{value}</div>
      <div className="kpi-context">{note}</div>
    </div>
  );
}

function Row({ bill }: { bill: MatchedBill }) {
  const { purchase } = bill;
  return (
    <tr>
      <td>
        {bill.billNumber
          ? <span className="pn-chip">{bill.billNumber}</span>
          : <span className="text-muted" style={{ fontSize: '12px' }}>not recorded</span>}
        {purchase.supplier_invoice_date && (
          <div className="text-muted" style={{ fontSize: '11px' }}>dated {purchase.supplier_invoice_date}</div>
        )}
      </td>
      <td style={{ fontWeight: 600 }}>{purchase.id}</td>
      <td className="truncate" style={{ maxWidth: '160px' }}>{purchase.supplier}</td>
      <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{purchase.date}</td>
      <td className="text-right">{money(Number(purchase.total) || 0)}</td>
      <td className="text-right">
        {bill.lineCount === 0
          ? <span className="text-muted">—</span>
          : <span className={bill.flags.includes('lines_disagree_with_total') ? 'text-warning' : undefined}>{money(bill.linesTotal)}</span>}
      </td>
      <td className="text-right">{bill.credited > 0 ? money(bill.credited) : <span className="text-muted">—</span>}</td>
      <td className="text-right">{money(Number(purchase.paid) || 0)}</td>
      <td className="text-right" style={{ fontWeight: 600 }}>
        {bill.outstanding > 0 ? money(bill.outstanding) : <span className="badge badge-success">Settled</span>}
      </td>
      <td>
        {bill.flags.length === 0
          ? <span className="badge badge-success">Adds up</span>
          : <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px' }}>
              {bill.flags.map((flag) => <li key={flag}>{FLAG_TEXT[flag]}</li>)}
            </ul>}
      </td>
    </tr>
  );
}
