'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import { OPENING_STOCK, PRICE_RISE_ALERT_PERCENT, type PartCostHistory, type PartSales } from '@/lib/part-cost-history';

const rupees = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const qtyText = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2));
const day = (iso: string) => {
  const date = new Date(`${iso}T12:00:00`);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

function Earned({ title, totals }: { title: string; totals: PartSales['allTime'] }) {
  const known = totals.lines > totals.uncostedLines;
  return (
    <div style={{ border: '1px solid var(--line-2)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
      <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>{title}</div>
      {totals.lines === 0 ? (
        <div className="text-muted">Not sold</div>
      ) : (
        <>
          <div style={{ fontWeight: 700 }}>{qtyText(totals.qty)} sold for {rupees(totals.sales)}</div>
          <div style={{ fontSize: 13 }}>
            {known ? (
              <>Profit <strong className={totals.profit < 0 ? 'text-danger' : 'text-success'}>{rupees(totals.profit)}</strong>
                {totals.marginPercent !== null && <span className="text-muted"> · {totals.marginPercent.toFixed(1)}% margin</span>}</>
            ) : <span className="text-muted">Profit not known — no cost recorded for these sales</span>}
          </div>
          {known && totals.uncostedLines > 0 && (
            <div className="text-muted" style={{ fontSize: 12 }}>{rupees(totals.uncostedSales)} of it has no recorded cost and is left out of profit</div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * In a part's window: what it has earned, and what it has cost — every batch bought, from whom and
 * at what price, whether the price is rising, and each supplier's latest price side by side.
 * Sales are before GST, after discounts, less returns; cost is from the batches the pieces came
 * out of (lib/part-profit.ts, lib/part-cost-history.ts).
 */
export default function PartCostPanel({ companyId, productId }: { companyId: string; productId: string }) {
  const [data, setData] = useState<{ productId: string; history: PartCostHistory; sales: PartSales } | null>(null);
  const [failure, setFailure] = useState<{ productId: string; message: string } | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch(`/api/inventory/part-costs?companyId=${encodeURIComponent(companyId)}&productId=${encodeURIComponent(productId)}`);
        const body = (await parseJsonOrThrow(res, "This part's costs could not be loaded.")) as { history: PartCostHistory; sales: PartSales };
        if (active) setData({ productId, ...body });
      } catch (error) {
        if (active) setFailure({ productId, message: error instanceof Error ? error.message : "This part's costs could not be loaded." });
      }
    })();
    return () => { active = false; };
  }, [companyId, productId]);

  // Only what belongs to the part on screen: the window can move to another part before an answer.
  const shown = data?.productId === productId ? data : null;
  const error = failure?.productId === productId ? failure.message : '';

  if (error) return <p className="form-error" role="alert" style={{ marginBottom: 20 }}>{error}</p>;
  if (!shown) return <div className="skeleton" style={{ height: 120, width: '100%', marginBottom: 20 }} />;

  const { history, sales } = shown;
  const cheapest = history.suppliers.length > 1 ? history.suppliers[0] : null;
  return (
    <>
      <section style={{ marginBottom: 20 }}>
        <h4 style={{ marginBottom: 8 }}>What it has earned</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          <Earned title="Last 90 days" totals={sales.recent} />
          <Earned title="All time" totals={sales.allTime} />
        </div>
        {sales.topCustomers.length > 0 && (
          <p className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
            Bought most by {sales.topCustomers.map((entry) => `${entry.customer} (${qtyText(entry.qty)})`).join(', ')}
          </p>
        )}
      </section>

      <section style={{ marginBottom: 20 }}>
        <h4 style={{ marginBottom: 8 }}>What it has cost you</h4>
        {history.entries.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13 }}>
            No purchase of this part is recorded yet. Record a purchase with what you paid, and every price, supplier
            and batch will show here.
          </p>
        ) : (
          <>
            <div className="flex gap-4" style={{ flexWrap: 'wrap', fontSize: 13, marginBottom: 8 }}>
              <span>Last paid <strong>{history.lastCost === null ? '—' : rupees(history.lastCost)}</strong></span>
              {history.changePercent !== null && history.previousCost !== null && (
                <span className={history.changePercent > 0 ? 'text-danger' : history.changePercent < 0 ? 'text-success' : 'text-muted'}>
                  {history.changePercent > 0 ? <TrendingUp size={13} style={{ display: 'inline' }} /> : history.changePercent < 0 ? <TrendingDown size={13} style={{ display: 'inline' }} /> : null}
                  {' '}{history.changePercent > 0 ? '+' : ''}{history.changePercent.toFixed(1)}% on the time before ({rupees(history.previousCost)})
                </span>
              )}
              {history.averageCost !== null && <span>Average paid <strong>{rupees(history.averageCost)}</strong></span>}
              <span>On the shelf <strong>{qtyText(history.onHand)}</strong>, cost <strong>{rupees(history.stockValue)}</strong></span>
            </div>

            {history.rising && (
              <div className="alert alert-warning mb-2" role="status" style={{ fontSize: 13 }}>
                <AlertTriangle size={15} />
                <span>The last batch cost {history.changePercent?.toFixed(1)}% more than the one before (alert at {PRICE_RISE_ALERT_PERCENT}%). Check this part&apos;s selling price still leaves the margin you want.</span>
              </div>
            )}

            {cheapest && (
              <div style={{ fontSize: 13, marginBottom: 8 }}>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 2 }}>Each supplier&apos;s latest price</div>
                {history.suppliers.map((entry) => (
                  <div key={entry.supplier} className="flex justify-between" style={{ maxWidth: 420 }}>
                    <span>{entry.supplier}{entry === cheapest && <span className="badge badge-success" style={{ marginLeft: 6 }}>cheapest</span>}</span>
                    <span><strong>{rupees(entry.lastCost)}</strong> <span className="text-muted">· {day(entry.lastDate)}{entry.times > 1 ? ` · bought ${entry.times}×` : ''}</span></span>
                  </div>
                ))}
              </div>
            )}

            <div className="table-wrap">
              <table className="erp-table">
                <thead><tr><th>Date</th><th>From</th><th className="text-right">Bought</th><th className="text-right">Still in stock</th><th className="text-right">Cost each</th></tr></thead>
                <tbody>
                  {history.entries.map((entry) => (
                    <tr key={entry.batchId}>
                      <td style={{ whiteSpace: 'nowrap' }}>{day(entry.date)}</td>
                      <td>
                        {entry.supplier === OPENING_STOCK ? <span className="text-muted">{entry.supplier}</span> : entry.supplier}
                        {entry.purchaseId && <span className="text-muted" style={{ fontSize: 12 }}> · {entry.purchaseId}{entry.supplierBillNo ? ` · bill ${entry.supplierBillNo}` : ''}</span>}
                      </td>
                      <td className="text-right">{qtyText(entry.qtyBought)}</td>
                      <td className="text-right">{entry.qtyLeft > 0 ? qtyText(entry.qtyLeft) : <span className="text-muted">0</span>}</td>
                      <td className="text-right font-semibold">{entry.unitCost > 0 ? rupees(entry.unitCost) : <span className="text-muted">no cost</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}
