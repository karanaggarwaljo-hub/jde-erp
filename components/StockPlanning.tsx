'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ClipboardList, Copy, MessageCircle, Minus, PackageX, Plus, Printer, ShoppingCart, Sparkles, Trash2, X } from 'lucide-react';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { partLabel } from '@/lib/purchase-entry';
import { DRAFT_STATUS, CANCELLED_STATUS } from '@/lib/sales-types';
import { shopDay } from '@/lib/logbook';
import { tallyDate } from '@/lib/tally-invoice';
import PartPicker from '@/components/PartPicker';
import { usePartPhotos } from '@/lib/usePartPhotos';
import {
  deadStock,
  DEFAULT_PLAN_SETTINGS,
  planParts,
  reorderList,
  type PlanBatch,
  type PlanPart,
  type PlanPurchase,
} from '@/lib/stock-planning';
import {
  addLine,
  addSuggestions,
  cleanQty,
  COVER_CHOICES,
  readSavedSheet,
  sheetSuppliers,
  sheetText,
  suggestedLines,
  type SheetLine,
} from '@/lib/requirement-sheet';

type Tab = 'sheet' | 'dead';
type Invoice = { id: string; date: string; status: string };
type InvoiceItem = { invoice_id: string; product_id: string | null; qty: number | string };
type Product = PlanPart & Record<string, unknown>;

/** Where Stock Planning leaves a purchase for the Purchases screen to open, filled in. */
export const PURCHASE_DRAFT_KEY = 'jde-purchase-draft';
export type PurchaseDraft = { companyId: string; supplier: string; lines: Array<{ description: string; quantity: number; unit_price: number }> };

const rupees = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;
const COVER_KEY = 'jde-requirement-cover-days';
const DEAD_KEY = 'jde-stock-planning-dead-days';
const sheetKey = (companyId: string) => `jde-requirement-sheet:${companyId}`;
const DEAD_CHOICES = [{ days: 60, label: '2 months' }, { days: 90, label: '3 months' }, { days: 180, label: '6 months' }];
const ALL = '__all__';

const readNumber = (key: string, fallback: number) => {
  try { return Number(localStorage.getItem(key)) || fallback; } catch { return fallback; }
};
const keep = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* private window: kept for this visit only */ }
};

const PRINT_CSS = `
.req-print { display:none; }
@media print {
  .req-screen { display:none !important; }
  .req-print { display:block; color:#000; font-family: Arial, Helvetica, sans-serif; font-size:12px; }
  .req-print h2 { font-size:18px; margin:0; text-transform:uppercase; letter-spacing:1px; }
  .req-print table { width:100%; border-collapse:collapse; margin-top:10px; }
  .req-print th, .req-print td { border:1px solid #000; padding:5px 7px; text-align:left; vertical-align:top; }
  .req-print th { background:#eee; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .req-print .r { text-align:right; }
}
`;

/**
 * Stock Planning: the requirement sheet — what to order, how many and from whom — in one list that
 * starts filled with what is running low and can be added to, changed and printed, sent as a
 * message, or turned into a purchase (lib/requirement-sheet.ts). And what is not selling, with the
 * money tied up in it.
 */
export default function StockPlanning() {
  const router = useRouter();
  const { rows: products, loading: productsLoading, activeCompany } = useCompanyTable<Product>('products');
  const { rows: invoices, loading: invoicesLoading } = useCompanyTable<Invoice & Record<string, unknown>>('invoices');
  const { rows: invoiceItems, loading: itemsLoading } = useCompanyTable<InvoiceItem & Record<string, unknown>>('invoice_items');
  const { rows: batches, loading: batchesLoading } = useCompanyTable<PlanBatch & Record<string, unknown>>('stock_layers');
  const { rows: purchases, loading: purchasesLoading } = useCompanyTable<PlanPurchase & Record<string, unknown>>('purchase_orders');
  const { rows: suppliers } = useCompanyTable<{ id: string; name: string }>('suppliers');
  const [tab, setTab] = useState<Tab>('sheet');
  const [coverDays, setCoverDays] = useState(DEFAULT_PLAN_SETTINGS.coverDays);
  const [deadDays, setDeadDays] = useState(DEFAULT_PLAN_SETTINGS.deadDays);
  const [lines, setLines] = useState<SheetLine[] | null>(null);
  const [supplierFilter, setSupplierFilter] = useState(ALL);
  const [notice, setNotice] = useState('');
  const photoFor = usePartPhotos();

  // The owner's choices, once the page is on screen (the server cannot read them).
  useEffect(() => {
    const timer = setTimeout(() => {
      setCoverDays(readNumber(COVER_KEY, DEFAULT_PLAN_SETTINGS.coverDays));
      setDeadDays(readNumber(DEAD_KEY, DEFAULT_PLAN_SETTINGS.deadDays));
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const today = shopDay(new Date());
  const sales = useMemo(() => {
    const invoiceDates = new Map(invoices.filter((invoice) => invoice.status !== DRAFT_STATUS && invoice.status !== CANCELLED_STATUS).map((invoice) => [invoice.id, invoice.date]));
    return invoiceItems
      .filter((item) => invoiceDates.has(item.invoice_id))
      .map((item) => ({ product_id: item.product_id, qty: item.qty, date: invoiceDates.get(item.invoice_id)! }));
  }, [invoices, invoiceItems]);
  const plans = useMemo(
    () => planParts({ parts: products, sales, batches, purchases, today, settings: { coverDays, deadDays } }),
    [products, sales, batches, purchases, today, coverDays, deadDays],
  );
  const plansById = useMemo(() => new Map(plans.map((plan) => [plan.partId, plan])), [plans]);
  // Sold in the last 30 days, the one sales figure the sheet shows.
  const soldLastMonth = useMemo(() => {
    const from = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
    const sold = new Map<string, number>();
    for (const sale of sales) if (sale.product_id && sale.date.slice(0, 10) >= from) sold.set(sale.product_id, (sold.get(sale.product_id) ?? 0) + (Number(sale.qty) || 0));
    return sold;
  }, [sales, today]);

  const suggestions = useMemo(() => suggestedLines(reorderList(plans)), [plans]);
  const dead = useMemo(() => deadStock(plans, deadDays), [plans, deadDays]);
  const deadValue = dead.reduce((total, plan) => total + plan.stockValue, 0);
  // Everything the suggestions are worked out from, so the first sheet is not filled from half the data.
  const loading = productsLoading || invoicesLoading || itemsLoading || batchesLoading || purchasesLoading;

  // The sheet is kept in this browser between visits, per company. Until it is first changed it is
  // simply what is running low, worked out live, so it can never be filled from half-loaded data.
  const companyId = activeCompany?.id ?? null;
  useEffect(() => {
    if (!companyId) return;
    let saved: SheetLine[] | null = null;
    try { saved = readSavedSheet(localStorage.getItem(sheetKey(companyId))); } catch { /* none */ }
    const timer = setTimeout(() => setLines(saved), 0);
    return () => clearTimeout(timer);
  }, [companyId]);

  const sheet = useMemo(() => lines ?? suggestions, [lines, suggestions]);
  const change = (next: SheetLine[]) => {
    setLines(next);
    setNotice('');
    if (activeCompany) keep(sheetKey(activeCompany.id), JSON.stringify(next));
  };
  const setQty = (partId: string, qty: number) => change(sheet.map((line) => (line.partId === partId ? { ...line, qty: cleanQty(qty) } : line)));
  const setSupplier = (partId: string, supplier: string) => change(sheet.map((line) => (line.partId === partId ? { ...line, supplier } : line)));
  const remove = (partId: string) => change(sheet.filter((line) => line.partId !== partId));

  const suppliersOnSheet = sheetSuppliers(sheet);
  const filter = supplierFilter !== ALL && suppliersOnSheet.includes(supplierFilter) ? supplierFilter : ALL;
  const shown = filter === ALL ? sheet : sheet.filter((line) => line.supplier.trim() === filter);
  const newSuggestions = suggestions.filter((line) => !sheet.some((existing) => existing.partId === line.partId)).length;
  const estimate = shown.reduce((total, line) => total + line.qty * (plansById.get(line.partId)?.lastCost ?? 0), 0);
  // The one supplier a purchase can be made for: the one picked, or the only one on the sheet.
  const purchaseSupplier = filter !== ALL ? filter : suppliersOnSheet.length === 1 ? suppliersOnSheet[0] : null;

  const partOptions = useMemo(() => products.map((product) => ({
    id: product.id,
    value: partLabel(String(product.part_number ?? ''), product.name),
    partNumber: String(product.part_number ?? ''),
    name: product.name,
    brand: String(product.brand ?? ''),
    stock: Number(product.current_stock) || 0,
    price: Number(product.cost_price) || 0,
    photo: photoFor(product)?.url ?? null,
  })), [products, photoFor]);

  const addPart = (part: (typeof partOptions)[number]) => {
    const plan = plansById.get(part.id);
    change(addLine(sheet, { partId: part.id, partNumber: part.partNumber.trim(), name: part.name, qty: Math.max(1, plan?.suggestQty ?? 1), supplier: plan?.lastSupplier ?? '' }));
  };

  const company = activeCompany?.name ?? '';
  const text = sheetText({ company, date: tallyDate(today), supplier: filter !== ALL ? filter || 'No supplier' : undefined, lines: shown });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('Copied — paste it into WhatsApp, an SMS or an email.');
    } catch {
      setNotice('Could not copy here. Use Print or WhatsApp instead.');
    }
  };
  const whatsapp = () => window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');

  const makePurchase = () => {
    if (!activeCompany || purchaseSupplier === null) return;
    const draftLines = sheet.filter((line) => line.supplier.trim() === purchaseSupplier);
    const draft: PurchaseDraft = {
      companyId: activeCompany.id,
      supplier: purchaseSupplier,
      lines: draftLines.map((line) => ({ description: partLabel(line.partNumber, line.name), quantity: line.qty, unit_price: plansById.get(line.partId)?.lastCost ?? 0 })),
    };
    try { sessionStorage.setItem(PURCHASE_DRAFT_KEY, JSON.stringify(draft)); } catch { /* the purchase opens empty instead */ }
    router.push('/purchases?record=purchase');
  };

  return (
    <div>
      <style>{PRINT_CSS}</style>
      <div className="req-screen">
        <div className="page-header">
          <div>
            <div className="eyebrow">Stock</div>
            <h1 className="page-title">Stock Planning</h1>
            <p className="page-subtitle">Make a requirement sheet: what to order, how many, and from whom. Then print it, send it on WhatsApp, or turn it into a purchase.</p>
          </div>
        </div>

        <div className="tabs mb-4" role="group" aria-label="Stock planning view">
          <button type="button" aria-pressed={tab === 'sheet'} className={`tab ${tab === 'sheet' ? 'active' : ''}`} onClick={() => setTab('sheet')}>
            Requirement sheet<span className="tab-count">{sheet.length}</span>
          </button>
          <button type="button" aria-pressed={tab === 'dead'} className={`tab ${tab === 'dead' ? 'active' : ''}`} onClick={() => setTab('dead')}>
            Not selling<span className="tab-count">{dead.length}</span>
          </button>
        </div>

        {loading && tab === 'sheet' && <div className="skeleton" style={{ height: 200, width: '100%' }} />}

        {!loading && tab === 'sheet' && (
          <div className="card">
            <div className="card-header" style={{ flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                <PartPicker parts={partOptions} onPick={addPart} lastLabel="last paid" />
                <p className="text-muted text-sm" style={{ marginTop: 6 }}>Type a part name or number to add it to the sheet.</p>
              </div>
              <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary btn-sm" disabled={newSuggestions === 0} onClick={() => change(addSuggestions(sheet, suggestions))}
                  title="Adds the parts that are out of stock or running low, with how many to order">
                  <Sparkles size={14} /> Add what is running low{newSuggestions > 0 ? ` (${newSuggestions})` : ''}
                </button>
                {sheet.length > 0 && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { if (window.confirm('Clear the whole requirement sheet?')) change([]); }}>
                    <Trash2 size={14} /> Clear
                  </button>
                )}
              </div>
            </div>

            <div className="flex gap-3 items-center text-sm" style={{ flexWrap: 'wrap', padding: '0 16px 12px' }}>
              <span className="text-muted">Suggested amounts last</span>
              <div className="tabs" role="group" aria-label="How long an order should last">
                {COVER_CHOICES.map((choice) => (
                  <button key={choice.days} type="button" aria-pressed={coverDays === choice.days} className={`tab ${coverDays === choice.days ? 'active' : ''}`}
                    onClick={() => { setCoverDays(choice.days); keep(COVER_KEY, String(choice.days)); }}>{choice.label}</button>
                ))}
              </div>
              {suppliersOnSheet.length > 1 && (
                <label className="flex items-center gap-2" style={{ marginLeft: 'auto' }}>
                  <span className="text-muted">Show</span>
                  <select className="form-input form-select" style={{ width: 'auto' }} value={filter} onChange={(event) => setSupplierFilter(event.target.value)}>
                    <option value={ALL}>All suppliers ({sheet.length})</option>
                    {suppliersOnSheet.map((name) => <option key={name || 'none'} value={name}>{name || 'No supplier yet'} ({sheet.filter((line) => line.supplier.trim() === name).length})</option>)}
                  </select>
                </label>
              )}
            </div>

            {shown.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon"><ClipboardList size={22} /></div>
                <p className="empty-state-title">The sheet is empty</p>
                <p className="empty-state-desc">
                  Add parts with the box above{suggestions.length > 0 ? ', or press "Add what is running low"' : ''}.
                  {suggestions.length === 0 && ' Nothing is running low right now.'}
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="erp-table">
                  <thead>
                    <tr><th style={{ width: 36 }}>#</th><th>Part</th><th className="text-right">In stock</th><th className="text-right">Sold last month</th><th className="text-right" style={{ width: 150 }}>Order</th><th>Supplier</th><th style={{ width: 40 }} /></tr>
                  </thead>
                  <tbody>
                    {shown.map((line, index) => {
                      const plan = plansById.get(line.partId);
                      const onHand = plan?.onHand ?? 0;
                      return (
                        <tr key={line.partId}>
                          <td className="text-muted">{index + 1}</td>
                          <td><div style={{ fontWeight: 600 }}>{line.name}</div>{line.partNumber && <span className="pn-chip">{line.partNumber}</span>}</td>
                          <td className={`text-right ${onHand <= 0 ? 'text-danger font-semibold' : ''}`}>{onHand <= 0 ? 'Out' : onHand}</td>
                          <td className="text-right">{soldLastMonth.get(line.partId) ?? 0}</td>
                          <td className="text-right">
                            <div className="flex items-center gap-1" style={{ justifyContent: 'flex-end' }}>
                              <button type="button" className="btn btn-ghost btn-sm" aria-label={`One less ${line.name}`} onClick={() => setQty(line.partId, line.qty - 1)} disabled={line.qty <= 1}><Minus size={12} /></button>
                              <input type="number" min={1} className="form-input" style={{ width: 64, textAlign: 'right' }} aria-label={`How many ${line.name}`}
                                value={line.qty} onChange={(event) => setQty(line.partId, Number(event.target.value))} />
                              <button type="button" className="btn btn-ghost btn-sm" aria-label={`One more ${line.name}`} onClick={() => setQty(line.partId, line.qty + 1)}><Plus size={12} /></button>
                            </div>
                          </td>
                          <td>
                            <input className="form-input" list="requirement-suppliers" placeholder="Supplier" style={{ minWidth: 140 }} aria-label={`Supplier for ${line.name}`}
                              value={line.supplier} onChange={(event) => setSupplier(line.partId, event.target.value)} />
                          </td>
                          <td><button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${line.name}`} onClick={() => remove(line.partId)}><X size={14} /></button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <datalist id="requirement-suppliers">{suppliers.map((supplier) => <option key={supplier.id} value={supplier.name} />)}</datalist>
              </div>
            )}

            {shown.length > 0 && (
              <div className="card-header" style={{ borderTop: '1px solid var(--line)', flexWrap: 'wrap', gap: 10 }}>
                <p className="text-sm text-muted" style={{ margin: 0 }}>
                  {shown.length} part{shown.length === 1 ? '' : 's'} · {shown.reduce((sum, line) => sum + line.qty, 0)} pcs{estimate > 0 ? ` · about ${rupees(estimate)} at the last price paid` : ''}
                </p>
                <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.print()}><Printer size={14} /> Print</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={whatsapp}><MessageCircle size={14} /> WhatsApp</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={copy}><Copy size={14} /> Copy</button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={makePurchase} disabled={purchaseSupplier === null || purchaseSupplier === ''}
                    title={purchaseSupplier === null ? 'Choose one supplier in "Show" first' : purchaseSupplier === '' ? 'Type a supplier for these parts first' : `Opens a new purchase from ${purchaseSupplier} with these parts filled in`}>
                    <ShoppingCart size={14} /> Make purchase{purchaseSupplier ? ` from ${purchaseSupplier}` : ''}
                  </button>
                </div>
              </div>
            )}
            {notice && <p className="text-sm" role="status" style={{ padding: '0 16px 12px', margin: 0 }}>{notice}</p>}
          </div>
        )}

        {!loading && tab === 'dead' && (
          <>
            <div className="flex gap-3 items-center text-sm mb-4" style={{ flexWrap: 'wrap' }}>
              <span className="text-muted">Not sold in</span>
              <div className="tabs" role="group" aria-label="How long without a sale">
                {DEAD_CHOICES.map((choice) => (
                  <button key={choice.days} type="button" aria-pressed={deadDays === choice.days} className={`tab ${deadDays === choice.days ? 'active' : ''}`}
                    onClick={() => { setDeadDays(choice.days); keep(DEAD_KEY, String(choice.days)); }}>{choice.label}</button>
                ))}
              </div>
            </div>
            {dead.length > 0 && (
              <div className="alert alert-warning mb-4" role="status">
                <AlertTriangle size={16} />
                <span><strong>{rupees(deadValue)}</strong> is tied up in {dead.length} part{dead.length === 1 ? '' : 's'} that have not sold in {deadDays} days, at what you paid for them.</span>
              </div>
            )}
            {dead.length === 0 ? (
              <div className="card"><div className="empty-state">
                <div className="empty-state-icon"><PackageX size={22} /></div>
                <p className="empty-state-title">Everything is selling</p>
                <p className="empty-state-desc">Every part in stock has sold in the last {deadDays} days, or came in more recently than that.</p>
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
                          <td>{plan.lastSoldDate ? tallyDate(plan.lastSoldDate) : <span className="text-muted">Never sold</span>}</td>
                          <td className="text-right"><span className="badge badge-warning">{plan.idleDays} days</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="pager"><span className="pager-info">Ideas: offer these at a discount, return them to the supplier, or stop reordering them.</span></div>
              </div>
            )}
          </>
        )}
      </div>

      {/* What Print puts on paper: the sheet alone, as a plain list for the supplier or the shop. */}
      <div className="req-print">
        <h2>{company}</h2>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <b>Requirement Sheet{filter !== ALL ? ` - ${filter || 'No supplier'}` : ''}</b>
          <span>Date: {tallyDate(today)}</span>
        </div>
        <table>
          <thead><tr><th style={{ width: 34 }}>Sr.</th><th style={{ width: 120 }}>Part No.</th><th>Description</th><th className="r" style={{ width: 60 }}>Qty</th>{filter === ALL && <th style={{ width: 140 }}>Supplier</th>}<th style={{ width: 120 }}>Remarks</th></tr></thead>
          <tbody>
            {shown.map((line, index) => (
              <tr key={line.partId}><td>{index + 1}</td><td>{line.partNumber}</td><td>{line.name}</td><td className="r">{line.qty}</td>{filter === ALL && <td>{line.supplier}</td>}<td /></tr>
            ))}
          </tbody>
        </table>
        <p style={{ marginTop: 8 }}>Total: {shown.length} item{shown.length === 1 ? '' : 's'}, {shown.reduce((sum, line) => sum + line.qty, 0)} pcs</p>
      </div>
    </div>
  );
}
