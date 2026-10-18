'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, PackageX, ShoppingCart, Truck } from 'lucide-react';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { partLabel } from '@/lib/purchase-entry';
import { DRAFT_STATUS } from '@/lib/sales-types';
import { shopDay } from '@/lib/logbook';
import {
  deadStock,
  DEFAULT_PLAN_SETTINGS,
  draftsBySupplier,
  planParts,
  reorderList,
  type PlanBatch,
  type PlanPart,
  type PlanPurchase,
  type PlanSettings,
} from '@/lib/stock-planning';

type Tab = 'reorder' | 'dead';
type Invoice = { id: string; date: string; status: string };
type InvoiceItem = { invoice_id: string; product_id: string | null; qty: number | string };

/** Where Stock Planning leaves a purchase for the Purchases screen to open, filled in. */
export const PURCHASE_DRAFT_KEY = 'jde-purchase-draft';
export type PurchaseDraft = { companyId: string; supplier: string; lines: Array<{ description: string; quantity: number; unit_price: number }> };

const rupees = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;
const SETTINGS_KEY = 'jde-stock-planning-settings';

function savedSettings(): PlanSettings {
  try {
    return { ...DEFAULT_PLAN_SETTINGS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') as Partial<PlanSettings>) };
  } catch {
    return DEFAULT_PLAN_SETTINGS;
  }
}

/**
 * Stock Planning: what to reorder before it runs out — worked out from how fast each part really
 * sells — turned into a draft purchase for its supplier in one click; and dead stock, with the
 * money tied up in it. lib/stock-planning.ts does the arithmetic.
 */
export default function StockPlanning() {
  const router = useRouter();
  const { rows: products, loading: productsLoading, activeCompany } = useCompanyTable<PlanPart & Record<string, unknown>>('products');
  const { rows: invoices, loading: invoicesLoading } = useCompanyTable<Invoice & Record<string, unknown>>('invoices');
  const { rows: invoiceItems } = useCompanyTable<InvoiceItem & Record<string, unknown>>('invoice_items');
  const { rows: batches } = useCompanyTable<PlanBatch & Record<string, unknown>>('stock_layers');
  const { rows: purchases } = useCompanyTable<PlanPurchase & Record<string, unknown>>('purchase_orders');
  const [tab, setTab] = useState<Tab>('reorder');
  const [settings, setSettings] = useState<PlanSettings>(DEFAULT_PLAN_SETTINGS);
  // The owner's own lead time and cover, once the page is on screen (the server cannot read them).
  useEffect(() => {
    const timer = setTimeout(() => setSettings(savedSettings()), 0);
    return () => clearTimeout(timer);
  }, []);

  const changeSetting = (key: keyof PlanSettings, value: number) => {
    const next = { ...settings, [key]: Math.max(1, Math.min(730, Math.round(value) || 1)) };
    setSettings(next);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* private window */ }
  };

  const today = shopDay(new Date());
  const plans = useMemo(() => {
    const invoiceDates = new Map(invoices.filter((invoice) => invoice.status !== DRAFT_STATUS).map((invoice) => [invoice.id, invoice.date]));
    const sales = invoiceItems
      .filter((item) => invoiceDates.has(item.invoice_id))
      .map((item) => ({ product_id: item.product_id, qty: item.qty, date: invoiceDates.get(item.invoice_id)! }));
    return planParts({ parts: products, sales, batches, purchases, today, settings });
  }, [products, invoices, invoiceItems, batches, purchases, today, settings]);

  const toOrder = useMemo(() => reorderList(plans), [plans]);
  const drafts = useMemo(() => draftsBySupplier(toOrder, (plan) => partLabel(plan.partNumber, plan.name)), [toOrder]);
  const dead = useMemo(() => deadStock(plans, settings.deadDays), [plans, settings.deadDays]);
  const deadValue = dead.reduce((total, plan) => total + plan.stockValue, 0);
  const loading = productsLoading || invoicesLoading;

  const draftPurchase = (supplier: string, lines: Array<{ label: string; qty: number; unitCost: number }>) => {
    if (!activeCompany) return;
    const draft: PurchaseDraft = { companyId: activeCompany.id, supplier, lines: lines.map((line) => ({ description: line.label, quantity: line.qty, unit_price: line.unitCost })) };
    try { sessionStorage.setItem(PURCHASE_DRAFT_KEY, JSON.stringify(draft)); } catch { /* the purchase opens empty instead */ }
    router.push('/purchases?record=purchase');
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Stock</div>
          <h1 className="page-title">Stock Planning</h1>
          <p className="page-subtitle">What to reorder before it runs out, from how fast each part really sells — and what is sitting on the shelf not selling.</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 mb-4" style={{ flexWrap: 'wrap' }}>
        <div className="tabs" role="group" aria-label="Stock planning view">
          <button type="button" aria-pressed={tab === 'reorder'} className={`tab ${tab === 'reorder' ? 'active' : ''}`} onClick={() => setTab('reorder')}>
            Reorder<span className="tab-count">{toOrder.length}</span>
          </button>
          <button type="button" aria-pressed={tab === 'dead'} className={`tab ${tab === 'dead' ? 'active' : ''}`} onClick={() => setTab('dead')}>
            Dead stock<span className="tab-count">{dead.length}</span>
          </button>
        </div>
        <div className="flex gap-3 items-center text-sm" style={{ flexWrap: 'wrap' }}>
          {tab === 'reorder' ? (
            <>
              <label className="flex items-center gap-1">Supplier takes <input type="number" min={1} className="form-input" style={{ width: 64 }} value={settings.leadDays} onChange={(event) => changeSetting('leadDays', Number(event.target.value))} /> days</label>
              <label className="flex items-center gap-1">order enough for <input type="number" min={1} className="form-input" style={{ width: 64 }} value={settings.coverDays} onChange={(event) => changeSetting('coverDays', Number(event.target.value))} /> days</label>
              <label className="flex items-center gap-1">pace from last <input type="number" min={7} className="form-input" style={{ width: 64 }} value={settings.windowDays} onChange={(event) => changeSetting('windowDays', Number(event.target.value))} /> days</label>
            </>
          ) : (
            <label className="flex items-center gap-1">Not sold in <input type="number" min={7} className="form-input" style={{ width: 70 }} value={settings.deadDays} onChange={(event) => changeSetting('deadDays', Number(event.target.value))} /> days</label>
          )}
        </div>
      </div>

      {loading && <div className="skeleton" style={{ height: 200, width: '100%' }} />}

      {!loading && tab === 'reorder' && (
        toOrder.length === 0 ? (
          <div className="card"><div className="empty-state">
            <div className="empty-state-icon"><Truck size={22} /></div>
            <p className="empty-state-title">Nothing needs ordering</p>
            <p className="empty-state-desc">A part shows here when its stock will not last {settings.leadDays} days at the pace it sold over the last {settings.windowDays} days, or falls to its own reorder level.</p>
          </div></div>
        ) : (
          drafts.map((draft) => (
            <div key={draft.supplier || 'none'} className="card mb-4">
              <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <h3 className="card-title">{draft.supplier || 'Not bought from any supplier yet'}</h3>
                  <p className="text-muted text-sm">{draft.lines.length} part{draft.lines.length === 1 ? '' : 's'} · about {rupees(draft.total)} at the last price paid</p>
                </div>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => draftPurchase(draft.supplier, draft.lines)}>
                  <ShoppingCart size={14} /> Draft purchase{draft.supplier ? ` from ${draft.supplier}` : ''}
                </button>
              </div>
              <div className="table-wrap">
                <table className="erp-table">
                  <thead><tr><th>Part</th><th className="text-right">In stock</th><th className="text-right">Sold ({settings.windowDays} days)</th><th className="text-right">Lasts</th><th className="text-right">Order</th><th className="text-right">Last price</th></tr></thead>
                  <tbody>
                    {toOrder.filter((plan) => (plan.lastSupplier ?? '') === draft.supplier).map((plan) => (
                      <tr key={plan.partId}>
                        <td><div style={{ fontWeight: 600 }}>{plan.name}</div>{plan.partNumber && <span className="pn-chip">{plan.partNumber}</span>}</td>
                        <td className={`text-right ${plan.onHand <= 0 ? 'text-danger font-semibold' : ''}`}>{plan.onHand}</td>
                        <td className="text-right">{plan.soldInWindow}{plan.perDay > 0 && <div className="text-muted text-sm">{(plan.perDay * 7).toFixed(1)} a week</div>}</td>
                        <td className="text-right">
                          {plan.onHand <= 0 ? <span className="badge badge-danger">Out of stock</span>
                            : plan.daysLeft === null ? <span className="text-muted">Below reorder level ({plan.reorderAt})</span>
                            : <span className={`badge ${plan.daysLeft <= settings.leadDays ? 'badge-danger' : 'badge-warning'}`}>{plan.daysLeft} day{plan.daysLeft === 1 ? '' : 's'}</span>}
                        </td>
                        <td className="text-right font-semibold">{plan.suggestQty}</td>
                        <td className="text-right">{plan.lastCost > 0 ? rupees(plan.lastCost) : <span className="text-muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )
      )}

      {!loading && tab === 'dead' && (
        <>
          {dead.length > 0 && (
            <div className="alert alert-warning mb-4" role="status">
              <AlertTriangle size={16} />
              <span><strong>{rupees(deadValue)}</strong> is tied up in {dead.length} part{dead.length === 1 ? '' : 's'} that have not sold in {settings.deadDays} days — at what you paid for them.</span>
            </div>
          )}
          {dead.length === 0 ? (
            <div className="card"><div className="empty-state">
              <div className="empty-state-icon"><PackageX size={22} /></div>
              <p className="empty-state-title">No dead stock</p>
              <p className="empty-state-desc">Every part in stock has sold in the last {settings.deadDays} days, or came in more recently than that.</p>
            </div></div>
          ) : (
            <div className="card">
              <div className="table-wrap">
                <table className="erp-table">
                  <thead><tr><th>Part</th><th className="text-right">In stock</th><th className="text-right">Cost of that stock</th><th>Last sold</th><th className="text-right">Idle</th></tr></thead>
                  <tbody>
                    {dead.map((plan) => (
                      <tr key={plan.partId}>
                        <td><div style={{ fontWeight: 600 }}>{plan.name}</div>{plan.partNumber && <span className="pn-chip">{plan.partNumber}</span>}</td>
                        <td className="text-right">{plan.onHand}</td>
                        <td className="text-right font-semibold">{rupees(plan.stockValue)}</td>
                        <td>{plan.lastSoldDate ?? <span className="text-muted">Never sold</span>}</td>
                        <td className="text-right"><span className="badge badge-warning">{plan.idleDays} days</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pager"><span className="pager-info">Ideas: offer these at a discount, return them to the supplier, or stop reordering them. A part whose stock has no recorded arrival date and has never sold is left off — its age is not known.</span></div>
            </div>
          )}
        </>
      )}

      {!loading && (
        <p className="text-muted text-sm" style={{ marginTop: 12 }}>
          The pace counts every piece billed (drafts are not sales). Customer returns are not taken off it — they are rare next to the sales around them.
        </p>
      )}
    </div>
  );
}
