'use client';

import Link from 'next/link';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, ArrowLeft, Check, Percent, Search, Undo2 } from 'lucide-react';
import { useCompany } from '@/components/CompanyProvider';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { correctOldestLayerCost, setProductStock } from '@/lib/client-fifo';
import { saveEach, IMPORT_SAVES_AT_ONCE } from '@/lib/bulk-save';
import { matchesProductSearch } from '@/lib/product-search';
import { marginPercent } from '@/lib/margin';
import { money, round2 } from '@/lib/money';
import type { Product } from '@/lib/inventory-types';
import {
  bulkPriceFor,
  describeCounts,
  effectiveValue,
  fillSalePrices,
  hasNoSalePrice,
  isBlank,
  planQuickUpdate,
  readAmount,
  saveStepsFor,
  sellsAtOrBelowCost,
  type BulkRule,
  type Drafts,
  type QuickField,
  type Rounding,
  type RowDraft,
} from '@/lib/quick-prices';

/**
 * Change prices & stock: every part in one list, with three boxes each — how many there are, what
 * it costs, what it sells for — and one Save for everything typed.
 *
 * The owner's prices move all the time. Changing one meant opening that part's form, finding the
 * price among fourteen boxes, saving, and starting again on the next part; the file import could
 * only ever change a cost. Here a new price is typed straight into the list, and a whole brand or
 * category can be moved by a percentage in one step.
 *
 * Nothing is written until Save is pressed. Each changed part is then saved by exactly the steps its
 * own Edit form uses (lib/quick-prices.ts saveStepsFor), so a part changed here is a part edited
 * there: the same audit entry, the same stock batch, the same cost correction.
 */

type Layer = { id: string };
type ShowFilter = 'all' | 'no-price' | 'below-cost' | 'changed';
type BulkMode = 'raise' | 'lower' | 'margin';

/** A number as it sits in a box: no rupee sign, no commas, paise only when there are some. */
const plain = (value: number | string): string => String(round2(Number(value) || 0));
const plainCount = (value: number | string): string => String(Number(value) || 0);

const FIELD_LABEL: Record<QuickField, string> = { stock: 'Stock', cost: 'Cost', sale: 'Sale price' };

type RowProps = {
  part: Product;
  draft: RowDraft | undefined;
  index: number;
  disabled: boolean;
  onType: (partId: string, field: QuickField, value: string) => void;
  onLeave: (partId: string, field: QuickField) => void;
  onKey: (event: KeyboardEvent<HTMLInputElement>, index: number, field: QuickField, partId: string) => void;
};

/** One part's row. Memoised, so typing in one box redraws that row and not the other nine hundred. */
const PriceRow = memo(function PriceRow({ part, draft, index, disabled, onType, onLeave, onKey }: RowProps) {
  const current: Record<QuickField, number> = {
    stock: Number(part.current_stock) || 0,
    cost: Number(part.cost_price) || 0,
    sale: Number(part.sale_price) || 0,
  };
  const cost = effectiveValue(part, draft, 'cost');
  const sale = effectiveValue(part, draft, 'sale');
  const margin = marginPercent(sale, cost);
  const mrp = Number(part.mrp) || 0;

  const box = (field: QuickField) => {
    const typed = draft?.[field];
    const bad = typed !== undefined && !isBlank(typed) && readAmount(typed) === null;
    const value = typed !== undefined && !isBlank(typed) ? readAmount(typed) : null;
    const was = current[field];
    const changed = value !== null && (field === 'stock' ? value !== was : round2(value) !== round2(was));
    return (
      <td className="text-right">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className={`form-input price-box${changed ? ' is-changed' : ''}${bad ? ' is-bad' : ''}`}
          aria-label={`${FIELD_LABEL[field]} of ${part.name}`}
          aria-invalid={bad || undefined}
          data-row={index}
          data-col={field}
          value={typed ?? (field === 'stock' ? plainCount(was) : plain(was))}
          disabled={disabled}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => onType(part.id, field, event.target.value)}
          onBlur={() => onLeave(part.id, field)}
          onKeyDown={(event) => onKey(event, index, field, part.id)}
        />
        {bad && <small className="price-was is-bad">Not a number</small>}
        {changed && <small className="price-was">was {field === 'stock' ? plainCount(was) : `₹${money(was)}`}</small>}
      </td>
    );
  };

  return (
    <tr>
      <td>
        <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
          {part.part_number && <span className="pn-chip">{part.part_number}</span>}
          <strong style={{ fontSize: '13.5px' }}>{part.name}</strong>
        </div>
        {(part.brand || part.category) && (
          <div className="text-muted text-sm" style={{ marginTop: '2px' }}>{[part.brand, part.category].filter(Boolean).join(' · ')}</div>
        )}
        {mrp > 0 && sale > mrp && (
          <div className="line-warning"><AlertTriangle size={12} aria-hidden="true" /> Above its MRP of ₹{money(mrp)}</div>
        )}
      </td>
      {box('stock')}
      {box('cost')}
      {box('sale')}
      <td className="text-right">
        {margin === null
          ? <span className="text-muted" title="Needs both a cost and a sale price">—</span>
          : <span className={margin > 0 ? 'text-success font-semibold' : 'text-danger font-semibold'}>{margin.toFixed(1)}%</span>}
        {margin !== null && margin <= 0 && <small className="price-was is-bad">{margin === 0 ? 'no profit' : 'a loss'}</small>}
      </td>
    </tr>
  );
});

export default function ChangePricesPage() {
  const { configError } = useCompany();
  const { rows: products, loading, update, reload } = useCompanyTable<Product>('products');
  // Not shown here. Read only so it can be re-read after a save: the Stock list works a part's cost
  // out from these batches, and it would otherwise go on showing the old one for a few seconds.
  const { reload: reloadLayers } = useCompanyTable<Layer>('stock_layers');

  const [drafts, setDrafts] = useState<Drafts>({});
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [brand, setBrand] = useState('all');
  const [show, setShow] = useState<ShowFilter>('all');
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [bulkMode, setBulkMode] = useState<BulkMode>('raise');
  const [bulkPercent, setBulkPercent] = useState('');
  const [rounding, setRounding] = useState<Rounding>(1);
  const bulkPanel = useRef<HTMLDetailsElement>(null);

  // The parts as last loaded, for the handlers below to look a part up without being rebuilt (and
  // every row redrawn) each time the list reloads.
  const productsRef = useRef<Map<string, Product>>(new Map());
  useEffect(() => {
    productsRef.current = new Map(products.map((product) => [product.id, product]));
  }, [products]);

  const plan = useMemo(() => planQuickUpdate(products, drafts), [products, drafts]);
  const unsaved = plan.counts.parts > 0;

  // Closing the tab or reloading with prices typed but not saved asks first.
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  const categories = useMemo(() => Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort(), [products]);
  const brands = useMemo(() => Array.from(new Set(products.map((p) => p.brand).filter(Boolean))).sort(), [products]);

  const narrowed = useMemo(
    () => products.filter((p) =>
      matchesProductSearch(p, search)
      && (category === 'all' || p.category === category)
      && (brand === 'all' || p.brand === brand)),
    [products, search, category, brand]
  );

  // Which rows a tab holds is judged on the SAVED figures, and "Changed" on any box touched, so a
  // row never jumps out from under the cursor while its new price is half typed.
  const tabs: Array<{ key: ShowFilter; label: string; rows: Product[] }> = [
    { key: 'all', label: 'All', rows: narrowed },
    { key: 'no-price', label: 'No sale price', rows: narrowed.filter((p) => hasNoSalePrice(p)) },
    { key: 'below-cost', label: 'At or below cost', rows: narrowed.filter((p) => sellsAtOrBelowCost(p)) },
    { key: 'changed', label: 'Changed', rows: narrowed.filter((p) => drafts[p.id] !== undefined) },
  ];
  const visible = (tabs.find((tab) => tab.key === show) ?? tabs[0]).rows;

  const onType = useCallback((partId: string, field: QuickField, value: string) => {
    setMessage('');
    setDrafts((current) => ({ ...current, [partId]: { ...current[partId], [field]: value } }));
  }, []);

  /** Forgets one box, so it shows the part's own value again. */
  const forget = useCallback((partId: string, field: QuickField) => {
    setDrafts((current) => {
      const draft = current[partId];
      if (!draft || draft[field] === undefined) return current;
      const rest = { ...draft };
      delete rest[field];
      const next = { ...current };
      if (Object.keys(rest).length === 0) delete next[partId];
      else next[partId] = rest;
      return next;
    });
  }, []);

  /** Leaving a box that was emptied, or typed back to what the part already has, forgets it. */
  const onLeave = useCallback((partId: string, field: QuickField) => {
    setDrafts((current) => {
      const typed = current[partId]?.[field];
      if (typed === undefined) return current;
      const part = productsRef.current.get(partId);
      const value = readAmount(typed);
      const same = part !== undefined && value !== null && (
        field === 'stock'
          ? value === (Number(part.current_stock) || 0)
          : round2(value) === round2(Number(field === 'cost' ? part.cost_price : part.sale_price) || 0)
      );
      if (!isBlank(typed) && !same) return current;
      const rest = { ...current[partId] };
      delete rest[field];
      const next = { ...current };
      if (Object.keys(rest).length === 0) delete next[partId];
      else next[partId] = rest;
      return next;
    });
  }, []);

  /** Enter or the down arrow goes to the same box on the next part, like a spreadsheet column;
   *  the up arrow goes back; Escape puts the box back to what it was. */
  const onKey = useCallback((event: KeyboardEvent<HTMLInputElement>, index: number, field: QuickField, partId: string) => {
    const move = event.key === 'Enter' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (move !== 0) {
      event.preventDefault();
      document.querySelector<HTMLInputElement>(`input[data-col="${field}"][data-row="${index + move}"]`)?.focus();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      forget(partId, field);
    }
  }, [forget]);

  const percent = readAmount(bulkPercent);
  const rule: BulkRule | null = percent === null || percent <= 0
    ? null
    : bulkMode === 'margin'
      ? { kind: 'margin', percent }
      : { kind: 'percent', percent: bulkMode === 'raise' ? percent : -percent };
  // The first part on screen the rule can price, worked through, so the result is seen before any
  // box is filled.
  const example = (() => {
    if (!rule) return null;
    for (const part of visible) {
      const to = bulkPriceFor(part, drafts[part.id], rule, rounding);
      if (to !== null) return { name: part.name, from: effectiveValue(part, drafts[part.id], 'sale'), cost: effectiveValue(part, drafts[part.id], 'cost'), to };
    }
    return null;
  })();
  const bulkTooHigh = bulkMode === 'margin' ? (percent ?? 0) >= 100 : bulkMode === 'lower' && (percent ?? 0) >= 100;

  const applyBulk = () => {
    if (!rule || visible.length === 0) return;
    const result = fillSalePrices(visible, drafts, rule, rounding);
    setDrafts(result.drafts);
    // Folded away again once it has done its job, so the new prices and the Save bar are in view.
    if (result.filled > 0 && bulkPanel.current) bulkPanel.current.open = false;
    setError('');
    setMessage(
      result.filled === 0
        ? `None of these ${visible.length} parts could be priced: ${bulkMode === 'margin' ? 'they have no cost to work from' : 'they have no sale price to change'}.`
        : `Filled in a new sale price for ${result.filled} ${result.filled === 1 ? 'part' : 'parts'}`
          + (result.skipped > 0 ? ` (${result.skipped} left alone: no ${bulkMode === 'margin' ? 'cost' : 'sale price'} to work from)` : '')
          + '. Nothing is saved yet. Look them over, then press Save changes.'
    );
  };

  const undoAll = () => {
    if (unsaved && !window.confirm('Put every box back to what it was? Nothing typed here has been saved.')) return;
    setDrafts({});
    setMessage('');
    setError('');
  };

  const save = async () => {
    if (saving || plan.problems.length > 0 || plan.changes.length === 0) return;
    const changes = plan.changes;
    const summary = describeCounts(plan.counts);
    setSaving(true);
    setError('');
    setMessage('');
    setProgress({ done: 0, total: changes.length });
    try {
      // A few parts at a time. Each part's own steps stay in order; only different parts overlap,
      // and no part appears twice in one plan.
      const result = await saveEach(
        changes,
        async (change) => {
          const steps = saveStepsFor(change);
          if (steps.patch) await update(steps.partId, steps.patch, { reload: false });
          if (steps.setStock) await setProductStock(steps.partId, steps.setStock.target, steps.setStock.unitCost);
          else if (steps.correctCost !== undefined) await correctOldestLayerCost(steps.partId, steps.correctCost);
        },
        { concurrency: IMPORT_SAVES_AT_ONCE, onSaved: (done) => setProgress({ done, total: changes.length }) }
      );
      await Promise.all([reload(), reloadLayers()]);
      if (result.failed) {
        // Says how far it got. The parts already saved now match what is typed, so pressing Save
        // again only does the ones that are left.
        setError(
          `${result.error instanceof Error ? result.error.message : 'Saving stopped.'} `
          + `${result.done} of ${changes.length} parts were saved before this stopped. The rest are still typed in below: press Save changes again.`
        );
        return;
      }
      setDrafts({});
      setShow((current) => (current === 'changed' ? 'all' : current));
      setMessage(`Saved. ${summary}.`);
    } finally {
      setSaving(false);
    }
  };

  const warnLeaving = (event: React.MouseEvent) => {
    if (unsaved && !window.confirm('You have changes that are not saved. Leave without saving them?')) event.preventDefault();
  };

  // Only where a price was changed here: a part already selling at cost whose stock was recounted
  // is not something this save is about to cause.
  const lossCount = plan.changes.filter((change) => (change.cost || change.sale) && sellsAtOrBelowCost(change.part, drafts[change.part.id])).length;

  return (
    <div className="prices-page">
      <div className="page-header">
        <div>
          <Link href="/inventory" prefetch={false} className="text-muted text-sm flex items-center gap-2" style={{ marginBottom: '4px', textDecoration: 'none' }} onClick={warnLeaving}>
            <ArrowLeft size={14} /> Back to Stock
          </Link>
          <h1 className="page-title">Change prices &amp; stock</h1>
          <p className="page-subtitle">Type the new number in any box. Nothing changes until you press Save changes.</p>
        </div>
      </div>

      {configError && (
        <div className="alert alert-danger mb-4" role="alert">Can&apos;t reach the database right now — {configError}</div>
      )}
      {message && <div className="alert alert-success mb-4" role="status">{message}</div>}
      {error && <div className="alert alert-danger mb-4" role="alert">{error}</div>}

      {!configError && (
        <>
          {/* Moving many prices in one step. It only fills the boxes below. */}
          <details ref={bulkPanel} className="card card-sm bulk-prices mb-4">
            <summary><Percent size={15} aria-hidden="true" /> Change many prices at once</summary>
            <div className="bulk-prices-body">
              <div className="pay-how bulk-prices-modes" role="group" aria-label="How to change the prices">
                <button type="button" aria-pressed={bulkMode === 'raise'} className={`pay-how-choice${bulkMode === 'raise' ? ' active' : ''}`} onClick={() => setBulkMode('raise')}>Raise sale prices</button>
                <button type="button" aria-pressed={bulkMode === 'lower'} className={`pay-how-choice${bulkMode === 'lower' ? ' active' : ''}`} onClick={() => setBulkMode('lower')}>Lower sale prices</button>
                <button type="button" aria-pressed={bulkMode === 'margin'} className={`pay-how-choice${bulkMode === 'margin' ? ' active' : ''}`} onClick={() => setBulkMode('margin')}>Price from cost</button>
              </div>
              <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
                <label className="flex items-center gap-2" htmlFor="bulk-percent">
                  <span>{bulkMode === 'margin' ? 'Keep a margin of' : 'By'}</span>
                  <input id="bulk-percent" type="text" inputMode="decimal" className="form-input" style={{ width: '84px', textAlign: 'right' }}
                    placeholder={bulkMode === 'margin' ? '20' : '5'} value={bulkPercent} onChange={(event) => setBulkPercent(event.target.value)} />
                  <span>%</span>
                </label>
                <label className="flex items-center gap-2" htmlFor="bulk-rounding">
                  <span>and round to</span>
                  <select id="bulk-rounding" className="form-input form-select" style={{ width: '150px' }} value={rounding}
                    onChange={(event) => setRounding(Number(event.target.value) as Rounding)}>
                    <option value={1}>the nearest ₹1</option>
                    <option value={5}>the nearest ₹5</option>
                    <option value={10}>the nearest ₹10</option>
                    <option value={0}>don&apos;t round</option>
                  </select>
                </label>
                <button type="button" className="btn btn-secondary" disabled={!rule || bulkTooHigh || visible.length === 0 || saving} onClick={applyBulk}>
                  Fill in for the {visible.length} {visible.length === 1 ? 'part' : 'parts'} shown
                </button>
              </div>
              <p className="text-muted text-sm">
                {bulkTooHigh
                  ? 'That percentage is too high to make a price from.'
                  : example
                    ? bulkMode === 'margin'
                      ? <>For example, {example.name}: cost ₹{money(example.cost)}, so sale price <strong>₹{money(example.to)}</strong>.</>
                      : <>For example, {example.name}: ₹{money(example.from)} becomes <strong>₹{money(example.to)}</strong>.</>
                    : bulkMode === 'margin'
                      ? 'Sets each sale price from its cost. A part that cost ₹800 at a 20% margin sells for ₹1,000.'
                      : 'Use Find, Brand and Category below first to choose which parts this applies to.'}
                {' '}This only fills in the boxes. Nothing is saved until you press Save changes.
              </p>
            </div>
          </details>

          <div className="table-wrap prices-list">
            <div className="tbl-toolbar">
              <div className="tabs" role="group" aria-label="Which parts to show">
                {tabs.map((tab) => (
                  <button key={tab.key} type="button" aria-pressed={show === tab.key} className={`tab${show === tab.key ? ' active' : ''}`} onClick={() => setShow(tab.key)}>
                    {tab.label}<span className="tab-count">{tab.rows.length}</span>
                  </button>
                ))}
              </div>
              <div className="tbl-tools">
                <div className="search-bar" style={{ minWidth: '230px' }}>
                  <Search className="search-bar-icon" size={16} />
                  <input type="text" aria-label="Find a part" placeholder="Find a part: number, name or brand" value={search} onChange={(event) => setSearch(event.target.value)} />
                </div>
                <select className="form-input form-select" style={{ width: '150px' }} aria-label="Brand" value={brand} onChange={(event) => setBrand(event.target.value)}>
                  <option value="all">All brands</option>
                  {brands.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
                <select className="form-input form-select" style={{ width: '160px' }} aria-label="Category" value={category} onChange={(event) => setCategory(event.target.value)}>
                  <option value="all">All categories</option>
                  {categories.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
            </div>

            <div className="prices-table-scroll">
              <table className="erp-table" style={{ minWidth: '680px' }}>
                <thead>
                  <tr>
                    <th>Part</th>
                    <th className="text-right" style={{ width: '132px' }}>Stock</th>
                    <th className="text-right" style={{ width: '132px' }}>Cost (₹)</th>
                    <th className="text-right" style={{ width: '132px' }}>Sale price (₹)</th>
                    <th className="text-right" style={{ width: '96px' }}>Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((part, index) => (
                    <PriceRow key={part.id} part={part} draft={drafts[part.id]} index={index} disabled={saving}
                      onType={onType} onLeave={onLeave} onKey={onKey} />
                  ))}
                  {visible.length === 0 && (
                    <tr><td colSpan={5}><div className="empty-state">
                      <p className="empty-state-title">{loading ? 'Loading your parts…' : products.length === 0 ? 'No parts yet' : 'No parts here'}</p>
                      <p className="empty-state-desc">
                        {loading
                          ? 'Fetching parts for the active company.'
                          : products.length === 0
                            ? 'Add parts on the Stock screen first.'
                            : show === 'changed' ? 'Nothing has been changed yet.' : 'Try another search, brand or category.'}
                      </p>
                    </div></td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Always in view under the list: what Save is about to do, and the button. */}
            <div className={`save-bar${unsaved ? ' has-changes' : ''}`}>
              <div className="save-bar-text">
                <strong>{saving ? `Saving ${progress.done} of ${progress.total}…` : describeCounts(plan.counts)}</strong>
                {plan.problems.length > 0 && (
                  <span className="text-danger"> · {plan.problems.length} {plan.problems.length === 1 ? 'box is' : 'boxes are'} not a number. Fix or clear {plan.problems.length === 1 ? 'it' : 'them'} to save.</span>
                )}
                {plan.problems.length === 0 && lossCount > 0 && (
                  <span className="text-warning"> · {lossCount} would sell at or below cost</span>
                )}
                {!unsaved && plan.problems.length === 0 && !saving && (
                  <span className="text-muted"> · Enter or ↓ moves down a column · Esc puts a box back</span>
                )}
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn btn-secondary" disabled={saving || Object.keys(drafts).length === 0} onClick={undoAll}>
                  <Undo2 size={15} /> Undo all
                </button>
                <button type="button" className="btn btn-primary" disabled={saving || !unsaved || plan.problems.length > 0} onClick={save}>
                  <Check size={16} /> {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
