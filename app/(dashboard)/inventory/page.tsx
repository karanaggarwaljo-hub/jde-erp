'use client';

import Link from 'next/link';
import { ChangeEvent, useRef, useState } from 'react';
import {
  Plus,
  Search,
  Filter,
  Edit,
  Trash2,
  AlertTriangle,
  Upload,
  IndianRupee,
  Sparkles,
  Boxes,
  LayoutGrid,
  Percent,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
} from 'lucide-react';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { useCompany } from '@/components/CompanyProvider';
import { parseInventoryFile, parseCostUpdateFile } from '@/lib/client-import';
import { planCostUpdates, countOutcomes, type CostMatch } from '@/lib/cost-import';
import { addStockLayer, consumeStockFifo, correctOldestLayerCost } from '@/lib/client-fifo';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import { fifoCostLookup } from '@/lib/stock-value';

type Product = {
  id: string;
  company_id: string;
  part_number: string;
  oem_number: string;
  hsn_code: string;
  name: string;
  brand: string;
  category: string;
  compatibility: string;
  cost_price: number;
  mrp: number;
  sale_price: number;
  current_stock: number;
  min_stock: number;
  location: string;
};

type StockLayer = { id: string; product_id: string; unit_cost: number; qty_remaining: number; created_at: string };

const DEFAULT_CATEGORIES = ['Engine', 'Brakes', 'Filters', 'Clutch', 'Suspension', 'Electrical'];

type StockFilter = 'all' | 'in' | 'low' | 'out';

// How many rows are painted at once. Every part is already in memory — this changes nothing
// about what is loaded, only how much of it is rendered, so paging costs no extra request.
const PAGE_SIZE = 25;

// Categorical brand hues. Green / amber / rose are deliberately absent: on this screen those
// three mean in stock / low / out, and a brand dot must never borrow that meaning.
const BRAND_CHIP_COLORS = [
  'var(--chart-blue)',
  'var(--chart-teal)',
  'var(--chart-violet)',
  'var(--chart-orange)',
  'var(--chart-pink)',
];

// Same brand always gets the same dot, without storing anything — it is a reading aid, not data.
const brandChipColor = (brand: string) => {
  let hash = 0;
  for (let i = 0; i < brand.length; i += 1) hash = (hash * 31 + brand.charCodeAt(i)) % 100003;
  return BRAND_CHIP_COLORS[hash % BRAND_CHIP_COLORS.length];
};

const money = (value: number) => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const wholeMoney = (value: number) => Math.round(Number(value || 0)).toLocaleString('en-IN');

// One definition of "low" and "out" for the whole screen, so the KPI cards, the reorder alert,
// the filter tabs and the row badges can never disagree with each other.
const isOutOfStock = (p: Product) => Number(p.current_stock) <= 0;
const isLowStock = (p: Product) => Number(p.min_stock) > 0 && Number(p.current_stock) <= Number(p.min_stock);
const isHealthyStock = (p: Product) => !isOutOfStock(p) && !isLowStock(p);

// The stock bar is scaled against this part's OWN reorder level — half full is exactly at the
// reorder line — because 42 of a fast mover and 3 of a slow one are not comparable on a shared
// scale. A part with no reorder level set has no meaningful scale, so it gets no bar at all.
const meterPercent = (p: Product) => {
  const reorder = Number(p.min_stock);
  if (!(reorder > 0)) return null;
  return Math.max(0, Math.min(100, Math.round((Number(p.current_stock) / (reorder * 2)) * 100)));
};

// "SP-0018" -> "SP-0019", preserving the prefix and the zero padding. Falls back to returning
// the input untouched when there is no trailing number to advance, so an unusual part-number
// scheme is never mangled into something wrong — the user just types the next one themselves.
function nextPartNumber(current: string): string {
  const match = current.match(/^(.*?)(\d+)(\D*)$/);
  if (!match) return current;
  const [, prefix, digits, suffix] = match;
  return `${prefix}${String(Number(digits) + 1).padStart(digits.length, '0')}${suffix}`;
}

// Which page buttons to show: short lists show every page, long ones collapse to 1 … n-1 n n+1 … last.
function pageWindow(current: number, total: number): Array<number | 'gap'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const wanted = [1, total, current - 1, current, current + 1]
    .filter((n) => n >= 1 && n <= total)
    .sort((a, b) => a - b);
  const shown: Array<number | 'gap'> = [];
  let previous = 0;
  for (const n of wanted) {
    if (n === previous) continue;
    if (previous && n - previous > 1) shown.push('gap');
    shown.push(n);
    previous = n;
  }
  return shown;
}

export default function InventoryPage() {
  const { configError } = useCompany();
  const { rows: products, loading, create, update, remove, reload, activeCompany } = useCompanyTable<Product>('products');
  const { rows: stockLayers, reload: reloadStockLayers } = useCompanyTable<StockLayer>('stock_layers');

  // Cost price shown per product = the oldest FIFO batch that still has stock left (i.e. what the
  // next sale will actually cost), falling back to the static cost_price field when a product has
  // no batches at all (e.g. it's never been purchased through the FIFO-tracked flow).
  // Shared with the Dashboard's Inventory Value KPI — the two used to compute this separately and
  // disagreed by ₹27,970 on real data. See lib/stock-value.ts.
  const fifoCostFor = fifoCostLookup(stockLayers);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Product | null>(null);
  const [feedback, setFeedback] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  // Cost-sheet import. Nothing is written until the owner has seen this plan and pressed
  // Apply — a bulk price overwrite is not something to do on a file-picker click.
  const [costPlan, setCostPlan] = useState<
    { fileName: string; costColumn: string; matches: CostMatch[]; skippedNoCost: number; skippedNoIdentifier: number } | null
  >(null);
  const [applyingCosts, setApplyingCosts] = useState(false);
  const [costProgress, setCostProgress] = useState(0);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestFailed, setSuggestFailed] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const [deletingProduct, setDeletingProduct] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [saveError, setSaveError] = useState('');
  // How many parts this one trip through the dialog has already saved — drives the
  // running count and the footer wording, and resets whenever the dialog is reopened.
  const [savedThisSession, setSavedThisSession] = useState(0);

  const [formData, setFormData] = useState({
    part_number: '',
    oem_number: '',
    hsn_code: '',
    name: '',
    brand: '',
    category: '',
    compatibility: '',
    cost_price: '',
    mrp: '',
    sale_price: '',
    current_stock: '',
    min_stock: '',
    location: '',
  });

  const categoryOptions = Array.from(new Set([...DEFAULT_CATEGORIES, ...products.map((p) => p.category).filter(Boolean)])).sort();

  // Warns before creating a likely-accidental duplicate (e.g. re-adding a part because a previous
  // save gave no visible confirmation) without blocking a genuinely intentional re-add — same name,
  // case-insensitive, only checked while adding a brand-new part, never while editing one.
  const possibleDuplicate = !editingProduct && formData.name.trim()
    ? products.find((p) => p.name.trim().toLowerCase() === formData.name.trim().toLowerCase())
    : undefined;

  // Margin implied by whatever cost and sale price are currently typed into the form. Null until
  // both are genuine positive numbers — a part priced at zero has no meaningful margin, and a
  // half-filled form should show nothing rather than a misleading 100%.
  const draftMargin = (() => {
    const cost = Number(formData.cost_price);
    const sale = Number(formData.sale_price);
    if (!(cost > 0) || !(sale > 0)) return null;
    return ((sale - cost) / sale) * 100;
  })();

  // Everything the summary panel shows, derived from what is currently typed. Nothing here is
  // stored or guessed — an empty field simply produces an empty readout, and each warning
  // describes a condition that is actually true of the numbers on screen right now.
  const draft = (() => {
    const cost = Number(formData.cost_price) || 0;
    const sale = Number(formData.sale_price) || 0;
    const mrp = Number(formData.mrp) || 0;
    const stock = Number(formData.current_stock) || 0;
    const reorder = Number(formData.min_stock) || 0;
    const isLow = reorder > 0 && stock <= reorder;
    const isOut = stock <= 0;

    const warnings: Array<{ text: string; tone: string }> = [];
    if (cost > 0 && sale > 0 && sale < cost) {
      warnings.push({ text: `Sale price is below cost — you would lose ₹${money(cost - sale)} on every piece sold.`, tone: 'alert-danger' });
    }
    if (mrp > 0 && sale > mrp) {
      warnings.push({ text: 'Sale price is above MRP, which is the maximum a customer can legally be charged.', tone: 'alert-warning' });
    }
    if (reorder <= 0) {
      warnings.push({ text: 'No reorder level set, so this part will never appear in the low-stock list.', tone: 'alert-warning' });
    }

    return {
      name: formData.name.trim(),
      partNumber: formData.part_number.trim(),
      brand: formData.brand.trim(),
      category: formData.category.trim(),
      cost, sale, mrp, stock, isLow,
      stockValue: stock * cost,
      meterPercent: reorder > 0 ? Math.max(0, Math.min(100, Math.round((stock / (reorder * 2)) * 100))) : null,
      stockBadge: isOut
        ? { label: 'Out of stock', tone: 'badge-danger' }
        : isLow
          ? { label: `Low · ${stock} of ${reorder}`, tone: 'badge-warning' }
          : { label: `${stock} in stock`, tone: 'badge-success' },
      warnings,
    };
  })();

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.part_number.toLowerCase().includes(search.toLowerCase()) ||
      p.oem_number.toLowerCase().includes(search.toLowerCase()) ||
      p.brand.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || p.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  // Tab counts are taken from the search/category result rather than the whole catalogue, so the
  // number on a tab is always exactly how many rows clicking it will show.
  const stockTabs: Array<{ key: StockFilter; label: string; title: string; rows: Product[] }> = [
    { key: 'all', label: 'All', title: 'All parts', rows: filteredProducts },
    { key: 'in', label: 'In Stock', title: 'Parts in stock', rows: filteredProducts.filter(isHealthyStock) },
    { key: 'low', label: 'Low', title: 'Parts at or below reorder level', rows: filteredProducts.filter(isLowStock) },
    { key: 'out', label: 'Out of Stock', title: 'Parts out of stock', rows: filteredProducts.filter(isOutOfStock) },
  ];
  const activeStockTab = stockTabs.find((tab) => tab.key === stockFilter) ?? stockTabs[0];
  const visibleProducts = activeStockTab.rows;

  // Paging is clamped rather than reset by an effect: deleting the last part on page 4 simply
  // lands the view on the new last page instead of showing an empty table.
  const totalPages = Math.max(1, Math.ceil(visibleProducts.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pagedProducts = visibleProducts.slice(pageStart, pageStart + PAGE_SIZE);

  // Headline figures, every one of them summed from the parts this page has already loaded.
  const lowStockCount = products.filter(isLowStock).length;
  const outOfStockCount = products.filter(isOutOfStock).length;
  const stockValue = products.reduce((total, p) => total + Number(p.current_stock || 0) * fifoCostFor(p), 0);
  const brandCount = new Set(products.map((p) => p.brand).filter(Boolean)).size;
  // Only parts that carry both a cost and a sale price can have a margin — averaging in the ones
  // priced at zero cost would report a 100% margin that nobody actually earns.
  const marginParts = products.filter((p) => Number(p.sale_price) > 0 && fifoCostFor(p) > 0);
  const averageMargin = marginParts.length > 0
    ? marginParts.reduce((total, p) => total + ((Number(p.sale_price) - fifoCostFor(p)) / Number(p.sale_price)) * 100, 0) / marginParts.length
    : null;

  const suggestPartDetails = async () => {
    if (!formData.name.trim()) return;
    setSuggesting(true);
    setSuggestFailed(false);
    try {
      const res = await fetch('/api/ai-suggest-part-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formData.name, oem_number: formData.oem_number, existingCategories: categoryOptions }),
      });
      const body = (await parseJsonOrThrow(res, 'Suggestion failed.')) as { category?: string; brand?: string };
      setFormData((current) => ({
        ...current,
        category: body.category || current.category,
        brand: !current.brand && body.brand ? body.brand : current.brand,
      }));
    } catch {
      // Suggestion is a convenience, not required — both fields stay freely editable either way.
      // Still worth a quiet heads-up though: silently doing nothing looks identical to "broken."
      setSuggestFailed(true);
    } finally {
      setSuggesting(false);
    }
  };

  const handleOpenAdd = () => {
    setEditingProduct(null);
    setSaveError('');
    setSuggestFailed(false);
    setSavedThisSession(0);
    setFormData({
      part_number: `SP-00${products.length + 1}`,
      oem_number: '',
      hsn_code: '',
      name: '',
      brand: '',
      category: 'Engine',
      compatibility: '',
      cost_price: '',
      mrp: '',
      sale_price: '',
      current_stock: '',
      min_stock: '10',
      location: 'A-01',
    });
    setShowModal(true);
  };

  // Set by the "Save & add another" button just before submit, so one handler covers both paths.
  // A ref rather than state: it must be readable inside this submit, not on the next render.
  const addAnotherRef = useRef(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const addAnother = addAnotherRef.current;
    addAnotherRef.current = false;
    setSaveError('');
    setSavingProduct(true);
    try {
      const newCostPrice = Number(formData.cost_price);
      const newStock = Number(formData.current_stock);
      if (!editingProduct && newStock <= 0) {
        throw new Error('Initial stock must be greater than 0 for a new part — enter the quantity you actually have on hand.');
      }
      const payload = {
        ...formData,
        cost_price: newCostPrice,
        mrp: Number(formData.mrp),
        sale_price: Number(formData.sale_price),
        current_stock: newStock,
        min_stock: Number(formData.min_stock),
      };
      if (editingProduct) {
        // current_stock is owned by the FIFO calls below, not this PATCH — writing it here too
        // would double-count. A stock-unchanged edit (e.g. fixing a typo'd sale price) correctly
        // touches only the static fields and opens no new batch.
        const patch: Record<string, unknown> = { ...payload };
        delete patch.current_stock;
        await update(editingProduct.id, patch);
        const delta = newStock - Number(editingProduct.current_stock);
        if (delta > 0) {
          await addStockLayer(editingProduct.id, delta, newCostPrice, null, true);
        } else if (delta < 0) {
          await consumeStockFifo(editingProduct.id, -delta, null);
        } else if (newCostPrice !== Number(editingProduct.cost_price)) {
          // Stock didn't change, only the cost figure did — correct the batch the display is
          // currently reading from instead of silently leaving it stale (the bug that made typing
          // a new cost price not actually change the shown cost/margin).
          await correctOldestLayerCost(editingProduct.id, newCostPrice);
        }
      } else {
        const created = await create(payload);
        if (newStock > 0) {
          // adjustStock=false: current_stock was already set by the insert above, so this only
          // opens the matching opening batch without bumping stock a second time.
          await addStockLayer(created.id, newStock, newCostPrice, null, false);
        }
      }
      // Same class of bug, two different tables: update()/create() above reload `products`, but
      // both run *before* addStockLayer/consumeStockFifo — which are what actually change
      // current_stock in the database (deliberately excluded from the plain PATCH above, see its
      // own comment) — so that first reload always captures the pre-change stock, and nothing
      // reloaded `products` again afterward. Changing Initial Stock on an existing part, or the
      // opening stock on a new one, genuinely saved every time; the Stock Level column just kept
      // showing the old number until a full page reload. Reloading both tables here, after
      // everything above has actually finished, is what makes the screen match the database.
      await Promise.all([reload(), reloadStockLayers()]);

      if (addAnother && !editingProduct) {
        // Stay in the dialog for the next part. Parts are almost never added one at a time at a
        // counter — a delivery arrives and five filters of the same brand go on the same rack —
        // so brand, category, rack and reorder level carry over and only the part-specific
        // fields reset. The part number advances from the one just saved.
        const added = savedThisSession + 1;
        setSavedThisSession(added);
        setFormData((current) => ({
          ...current,
          part_number: nextPartNumber(current.part_number),
          name: '',
          hsn_code: '',
          compatibility: '',
          cost_price: '',
          mrp: '',
          sale_price: '',
          current_stock: '',
          // brand, category, location and min_stock deliberately kept.
        }));
        setSuggestFailed(false);
        setFeedback(`${added} ${added === 1 ? 'part' : 'parts'} added — keep going, or Done when finished.`);
        return;
      }

      setShowModal(false);
      setFeedback(
        editingProduct
          ? 'Part updated successfully.'
          : savedThisSession > 0
            ? `${savedThisSession + 1} parts added to inventory.`
            : 'New part added to inventory.',
      );
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save this part — please try again.');
    } finally {
      setSavingProduct(false);
    }
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setSaveError('');
    setSuggestFailed(false);
    setSavedThisSession(0);
    setFormData({
      part_number: product.part_number,
      oem_number: product.oem_number,
      hsn_code: product.hsn_code || '',
      name: product.name,
      brand: product.brand,
      category: product.category,
      compatibility: product.compatibility,
      cost_price: String(product.cost_price),
      mrp: String(product.mrp),
      sale_price: String(product.sale_price),
      current_stock: String(product.current_stock),
      min_stock: String(product.min_stock),
      location: product.location,
    });
    setShowModal(true);
  };

  const confirmDelete = async () => {
    if (!deleteCandidate || deletingProduct) return;
    setDeleteError('');
    setDeletingProduct(true);
    try {
      await remove(deleteCandidate.id);
      setFeedback(`${deleteCandidate.part_number} removed from inventory.`);
      setDeleteCandidate(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : `Failed to remove ${deleteCandidate.part_number}.`);
    } finally {
      setDeletingProduct(false);
    }
  };

  const handleCostFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImportError('');
    setFeedback('');
    setImporting(true);
    try {
      const parsed = await parseCostUpdateFile(file);
      if (parsed.rows.length === 0) {
        throw new Error('No usable rows found — every row was missing either a cost or a way to identify the part.');
      }
      setCostPlan({
        fileName: file.name,
        costColumn: parsed.costColumn,
        matches: planCostUpdates(parsed.rows, products),
        skippedNoCost: parsed.skippedNoCost,
        skippedNoIdentifier: parsed.skippedNoIdentifier,
      });
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to read the file.');
    } finally {
      setImporting(false);
    }
  };

  const applyCostPlan = async () => {
    if (!costPlan) return;
    const pending = costPlan.matches.filter((m) => m.outcome === 'update' && m.product);
    setApplyingCosts(true);
    setCostProgress(0);
    setImportError('');
    let done = 0;
    try {
      for (const match of pending) {
        // Same two steps the edit form performs for a cost change: the part's own field, and the
        // purchase batch the displayed cost and margin actually read from. Updating only the
        // first is the bug that made a typed-in cost price appear not to take effect.
        await update(match.product!.id, { cost_price: match.row.cost });
        await correctOldestLayerCost(match.product!.id, match.row.cost);
        done += 1;
        setCostProgress(done);
      }
      await Promise.all([reload(), reloadStockLayers()]);
      setFeedback(`Updated the cost price of ${done} part(s) from ${costPlan.fileName}.`);
      setCostPlan(null);
    } catch (err) {
      // Say exactly how far it got — a half-applied run the owner knows the shape of is
      // recoverable; a silent one is not.
      await Promise.all([reload(), reloadStockLayers()]);
      setImportError(
        `${err instanceof Error ? err.message : 'Failed to update costs.'} ${done} of ${pending.length} part(s) were updated before this stopped; re-uploading the same file will retry the rest.`
      );
    } finally {
      setApplyingCosts(false);
    }
  };

  const handleFileImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImportError('');
    setFeedback('');
    setImporting(true);
    try {
      const { products: imported, guessedFields } = await parseInventoryFile(file);
      if (imported.length === 0) {
        throw new Error('Couldn’t find a part name/description column in this file. Recognized headers include things like "Name", "Item Name", "Description", or "Part Number" — check your column titles, or share them and we can adjust the import.');
      }
      const res = await fetch('/api/local/products?bulk=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: imported.map((product) => ({ ...product, company_id: activeCompany?.id })) }),
      });
      await parseJsonOrThrow(res, 'Failed to import parts.');
      await reload();
      const guessNote = guessedFields.length > 0
        ? ` Your file's column titles didn't clearly label ${guessedFields.join(', ')}, so those were guessed from the numbers — please spot-check a few rows.`
        : '';
      setFeedback(`Imported ${imported.length} part(s) from ${file.name}.${guessNote}`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to read the file.');
    } finally {
      setImporting(false);
    }
  };

  // Both halves of this sentence count real rows, and the alert itself is skipped when both are
  // zero — nothing on this screen ever announces a shortage that isn't there.
  const reorderSentence = `${[
    lowStockCount > 0 ? `${lowStockCount} ${lowStockCount === 1 ? 'part is' : 'parts are'} at or below reorder level` : '',
    outOfStockCount > 0
      ? (lowStockCount > 0
        ? `${outOfStockCount} ${outOfStockCount === 1 ? 'is' : 'are'} fully out of stock`
        : `${outOfStockCount} ${outOfStockCount === 1 ? 'part is' : 'parts are'} fully out of stock`)
      : '',
  ].filter(Boolean).join(', and ')}.`;

  const catalogueSummary = products.length > 0
    ? ` · ${products.length} ${products.length === 1 ? 'part' : 'parts'}${brandCount > 0 ? ` across ${brandCount} ${brandCount === 1 ? 'brand' : 'brands'}` : ''}`
    : '';

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="eyebrow">Stock control</div>
          <h1 className="page-title">Spare Parts Inventory</h1>
          <p className="page-subtitle">Track stock levels, locations & pricing{catalogueSummary}</p>
        </div>
        <div className="flex gap-2">
          <label className="btn btn-secondary" style={{ cursor: importing ? 'not-allowed' : 'pointer' }}>
            <Upload size={16} /> {importing ? 'Importing…' : 'Import from File'}
            <input type="file" accept=".csv,.xls,.xlsx" hidden disabled={importing} onChange={handleFileImport} />
          </label>
          <label className="btn btn-secondary" style={{ cursor: importing ? 'not-allowed' : 'pointer' }}>
            <IndianRupee size={16} /> Update Costs from File
            <input type="file" accept=".csv,.xls,.xlsx" hidden disabled={importing} onChange={handleCostFileSelected} />
          </label>
          <button className="btn btn-primary" onClick={handleOpenAdd}>
            <Plus size={16} /> Add New Part
          </button>
        </div>
      </div>

      {configError && (
        <div className="alert alert-danger mb-4" role="alert">
          Can&apos;t reach the database right now — {configError}
        </div>
      )}

      {!configError && (
      <>
      {feedback && <div className="alert alert-success mb-4" role="status">{feedback}</div>}
      {importError && <div className="alert alert-danger mb-4" role="alert">{importError}</div>}

      {/* Headline figures. Each one is summed from the parts this page already loaded — there is
          no month-on-month delta or trend line here because the page holds no historical series
          to compare against, and an invented one would be worse than none. */}
      <div className="kpi-grid">
        <div className="kpi-card" style={{ '--kpi-color': 'var(--chart-amber)', '--kpi-color-bg': 'var(--amber-tint)' } as React.CSSProperties}>
          <div className="flex justify-between items-center">
            <span className="kpi-label">Stock Value</span>
            <div className="kpi-icon-wrap"><Boxes size={18} /></div>
          </div>
          <div className="kpi-value">₹{wholeMoney(stockValue)}</div>
          <span className="kpi-context">Stock on hand, valued at each part&apos;s oldest open purchase batch</span>
        </div>

        <div className="kpi-card" style={{ '--kpi-color': 'var(--chart-blue)', '--kpi-color-bg': 'var(--color-info-bg)' } as React.CSSProperties}>
          <div className="flex justify-between items-center">
            <span className="kpi-label">Total Parts</span>
            <div className="kpi-icon-wrap"><LayoutGrid size={18} /></div>
          </div>
          <div className="kpi-value">{products.length}</div>
          <span className="kpi-context">{brandCount > 0 ? `Across ${brandCount} ${brandCount === 1 ? 'brand' : 'brands'}` : 'No brand recorded yet'}</span>
        </div>

        <div className="kpi-card" style={{ '--kpi-color': 'var(--chart-amber)', '--kpi-color-bg': 'var(--amber-tint)' } as React.CSSProperties}>
          <div className="flex justify-between items-center">
            <span className="kpi-label">Low Stock</span>
            <div className="kpi-icon-wrap"><AlertTriangle size={18} /></div>
          </div>
          <div className="kpi-value">{lowStockCount}</div>
          <div className={`kpi-change ${lowStockCount > 0 ? 'negative' : 'positive'}`}>
            {lowStockCount > 0 ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
            <span>{lowStockCount > 0 ? 'Needs action' : 'All stocked'}</span>
          </div>
          <span className="kpi-context">At or below their own reorder level{outOfStockCount > 0 ? ` · ${outOfStockCount} fully out` : ''}</span>
        </div>

        <div className="kpi-card" style={{ '--kpi-color': 'var(--chart-green)', '--kpi-color-bg': 'var(--em-tint)' } as React.CSSProperties}>
          <div className="flex justify-between items-center">
            <span className="kpi-label">Avg. Margin</span>
            <div className="kpi-icon-wrap"><Percent size={18} /></div>
          </div>
          <div className="kpi-value">{averageMargin === null ? '—' : `${averageMargin.toFixed(1)}%`}</div>
          <span className="kpi-context">
            {averageMargin === null
              ? 'Needs a cost and a sale price on at least one part'
              : `Across ${marginParts.length} ${marginParts.length === 1 ? 'part' : 'parts'} that have both a cost and a sale price`}
          </span>
        </div>
      </div>

      {(lowStockCount > 0 || outOfStockCount > 0) && (
        <div className="alert alert-warning mb-4" role="status">
          <AlertTriangle size={16} style={{ flex: 'none' }} />
          <span>{reorderSentence}</span>
          {/* Goes to the Purchases screen, which is where restocking is actually recorded — it is
              real navigation, not a button that quietly does nothing. */}
          <Link className="alert-action" href="/purchases">Record a purchase <ArrowRight size={14} /></Link>
        </div>
      )}

      {/* Product Table */}
      <div className="table-wrap">
        <div className="tbl-toolbar">
          <div className="tbl-toolbar-title">
            <strong>{activeStockTab.title}</strong>
            <small>Cost is the oldest purchase batch still in stock</small>
          </div>

          <div className="tabs" role="group" aria-label="Filter by stock level">
            {stockTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                aria-pressed={stockFilter === tab.key}
                className={`tab${stockFilter === tab.key ? ' active' : ''}`}
                onClick={() => { setStockFilter(tab.key); setPage(1); }}
              >
                {tab.label}<span className="tab-count">{tab.rows.length}</span>
              </button>
            ))}
          </div>

          <div className="tbl-tools">
            <div className="search-bar" style={{ minWidth: '220px' }}>
              <Search className="search-bar-icon" size={16} />
              <input
                type="text"
                placeholder="Search by Part #, OEM #, Description, Brand..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Filter size={16} color="var(--text-muted)" />
              <select
                className="form-input form-select"
                style={{ width: '160px' }}
                value={categoryFilter}
                onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
              >
                <option value="all">All Categories</option>
                {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
        <table className="erp-table">
          <thead>
            <tr>
              <th>Part Number</th>
              <th>HSN Code</th>
              <th>Item Name</th>
              <th>Brand</th>
              <th>Category</th>
              <th className="text-right">Stock (Pcs)</th>
              <th className="text-right">Cost</th>
              <th className="text-right">Sale Price</th>
              <th className="text-right">Margin</th>
              <th>Status</th>
              <th className="text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pagedProducts.map((p) => {
              const isLow = isLowStock(p);
              const isOut = isOutOfStock(p);
              const fifoCost = fifoCostFor(p);
              const margin = p.sale_price > 0 ? ((p.sale_price - fifoCost) / p.sale_price) * 100 : 0;
              const status = isOut ? 'Out of Stock' : isLow ? 'Low Stock' : 'In Stock';
              const statusBadge = isOut ? 'badge-danger' : isLow ? 'badge-warning' : 'badge-success';
              const meter = meterPercent(p);
              return (
                <tr key={p.id}>
                  <td><span className="pn-chip">{p.part_number}</span></td>
                  <td style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{p.hsn_code || '-'}</td>
                  <td style={{ fontWeight: 600, maxWidth: '150px' }} className="truncate">{p.name}</td>
                  <td>
                    {p.brand
                      ? <span className="brand-chip" style={{ '--brand-chip-color': brandChipColor(p.brand) } as React.CSSProperties}>{p.brand}</span>
                      : <span className="text-muted">-</span>}
                  </td>
                  <td><span className="badge badge-info">{p.category}</span></td>
                  <td>
                    {/* The bar is scaled to this part's own reorder level, so half full always
                        means "sitting exactly on the reorder line" no matter how fast it moves.
                        Parts with no reorder level set show the number alone. */}
                    <div className={`qty-cell${isOut ? ' is-out' : ''}`}>
                      <strong>{p.current_stock}</strong>
                      {meter !== null && (
                        <div className={`meter${isOut ? ' meter--out' : isLow ? ' meter--low' : ''}`} aria-hidden="true">
                          <i style={{ width: `${meter}%` }} />
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="text-right">₹{money(fifoCost)}</td>
                  <td className="text-right font-semibold">₹{money(p.sale_price)}</td>
                  <td className="text-right">
                    <span className={margin >= 0 ? 'text-success font-semibold' : 'text-danger font-semibold'}>{margin.toFixed(1)}%</span>
                  </td>
                  <td>
                    <span className={`badge ${statusBadge}`}>
                      {isOut ? <XCircle size={12} /> : isLow ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
                      {status}
                    </span>
                  </td>
                  <td className="text-center">
                    <div className="flex justify-between gap-1 items-center">
                      <button className="btn btn-ghost btn-sm" aria-label={`Edit ${p.name}`} onClick={() => handleEdit(p)}>
                        <Edit size={14} />
                      </button>
                      <button className="btn btn-ghost btn-sm" aria-label={`Delete ${p.name}`} style={{ color: 'var(--color-danger)' }} onClick={() => { setDeleteError(''); setDeleteCandidate(p); }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {pagedProducts.length === 0 && (
              <tr><td colSpan={11}><div className="empty-state"><AlertTriangle size={24} /><p className="empty-state-title">{loading ? 'Loading inventory…' : 'No parts found'}</p><p className="empty-state-desc">{loading ? 'Fetching parts for the active company.' : 'Try another search term, category or stock filter, or this company simply has no parts yet.'}</p></div></td></tr>
            )}
          </tbody>
        </table>
        </div>

        {visibleProducts.length > 0 && (
          <div className="pager">
            <div className="pager-info">
              Showing <strong>{pageStart + 1}–{pageStart + pagedProducts.length}</strong> of <strong>{visibleProducts.length}</strong> parts
            </div>
            {totalPages > 1 && (
              <div className="pager-controls">
                <button type="button" className="pager-btn" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
                  <ChevronLeft size={14} />
                </button>
                {pageWindow(currentPage, totalPages).map((entry, index) => (
                  entry === 'gap'
                    ? <span key={`gap-${index}`} className="pager-info">…</span>
                    : (
                      <button
                        key={entry}
                        type="button"
                        className={`pager-btn${entry === currentPage ? ' active' : ''}`}
                        aria-current={entry === currentPage ? 'page' : undefined}
                        aria-label={`Page ${entry}`}
                        onClick={() => setPage(entry)}
                      >
                        {entry}
                      </button>
                    )
                ))}
                <button type="button" className="pager-btn" aria-label="Next page" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      </>
      )}

      {/* Add / Edit Product Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: '980px' }}>
            <div className="modal-header">
              <div>
                <h3 className="modal-title">{editingProduct ? 'Edit Spare Part' : 'Add New Spare Part'}</h3>
                <p className="page-subtitle" style={{ marginTop: '2px' }}>
                  {editingProduct
                    ? <>Editing <span className="pn-chip">{editingProduct.part_number}</span> · changes apply the moment you save</>
                    : 'Added to this company’s catalogue and available to sell straight away'}
                </p>
              </div>
              <button className="btn btn-ghost btn-sm" disabled={savingProduct} onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSave}>
              {/* Form on the left, a live picture of the part on the right — the same split the
                  invoice dialog uses, so what you are about to create is visible while you type
                  rather than only after saving. */}
              <div className="modal-body part-form">
                <div className="part-form-fields">
                {saveError && <div className="alert alert-danger" role="alert">{saveError}</div>}
                {possibleDuplicate && (
                  <div className="alert alert-warning" role="alert">
                    A part named &quot;{possibleDuplicate.name}&quot; already exists ({possibleDuplicate.part_number}, {possibleDuplicate.current_stock} in stock) — this will add a separate, second entry rather than update it. If you meant to edit the existing one, cancel and use its Edit button instead.
                  </div>
                )}
                {/* ── What the part is ───────────────────────────────────────── */}
                <div className="form-section">
                  <div className="form-section-head">
                    <h4>Part details</h4>
                    <small>Fields marked * are required</small>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Part Name / Description *</label>
                    <input className="form-input" required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} onBlur={suggestPartDetails} />
                    <small style={{ color: 'var(--text-muted)' }}>{suggestFailed ? "Couldn't get a suggestion this time — go ahead and fill these in yourself." : 'Brand and category are suggested once you finish typing this — override either anytime.'}</small>
                  </div>

                  <div className="form-grid-2">
                    <div className="form-group">
                      <label className="form-label flex items-center gap-1">Brand {suggesting && <Sparkles size={12} className="text-brand spin" />}</label>
                      <input className="form-input" value={formData.brand} onChange={e => setFormData({ ...formData, brand: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label className="form-label flex items-center gap-1">Category {suggesting && <Sparkles size={12} className="text-brand spin" />}</label>
                      <input
                        className="form-input"
                        list="category-options"
                        placeholder="Pick or type a new category"
                        value={formData.category}
                        onChange={e => setFormData({ ...formData, category: e.target.value })}
                      />
                      <datalist id="category-options">
                        {categoryOptions.map((category) => <option key={category} value={category} />)}
                      </datalist>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Fits which machines</label>
                    <input className="form-input" placeholder="e.g. JCB 3DX, JCB 4DX" value={formData.compatibility} onChange={e => setFormData({ ...formData, compatibility: e.target.value })} />
                  </div>
                </div>

                {/* ── How it is identified on paper ──────────────────────────── */}
                <div className="form-section">
                  <div className="form-section-head">
                    <h4>Reference numbers</h4>
                    <small>HSN is what appears on a GST invoice</small>
                  </div>
                  {/* OEM number was dropped from this form at the owner's request — it is not part
                      of how this business identifies a part. The field itself is kept in state and
                      still round-trips through save, so any OEM already recorded on an older part
                      survives an edit here instead of being blanked. */}
                  <div className="form-grid-2">
                    <div className="form-group">
                      <label className="form-label">Part Number *</label>
                      <input className="form-input" required value={formData.part_number} onChange={e => setFormData({ ...formData, part_number: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">HSN Code</label>
                      <input className="form-input" placeholder="e.g. 84314990" value={formData.hsn_code} onChange={e => setFormData({ ...formData, hsn_code: e.target.value })} />
                    </div>
                  </div>
                </div>

                {/* ── What it costs and sells for ────────────────────────────── */}
                <div className="form-section">
                  <div className="form-section-head">
                    <h4>Pricing</h4>
                    {/* Worked out live from what is being typed, so the margin is checked before
                        saving rather than discovered later in a report. Only shown once both
                        numbers are real — never a placeholder. */}
                    {draftMargin !== null && (
                      <span className={`form-readout ${draftMargin < 0 ? 'is-bad' : draftMargin >= 15 ? 'is-good' : ''}`}>
                        Margin {draftMargin.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <div className="form-grid-3">
                    <div className="form-group">
                      <label className="form-label">Cost Price (₹)</label>
                      <input type="number" min="0" className="form-input" value={formData.cost_price} onChange={e => setFormData({ ...formData, cost_price: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">MRP (₹)</label>
                      <input type="number" min="0" className="form-input" value={formData.mrp} onChange={e => setFormData({ ...formData, mrp: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Sale Price (₹) *</label>
                      <input type="number" min="0" className="form-input" required value={formData.sale_price} onChange={e => setFormData({ ...formData, sale_price: e.target.value })} />
                    </div>
                  </div>
                </div>

                {/* ── How much there is and where it sits ────────────────────── */}
                <div className="form-section">
                  <div className="form-section-head">
                    <h4>Stock</h4>
                    <small>Below the threshold, this part shows as low stock</small>
                  </div>
                  <div className="form-grid-3">
                    <div className="form-group">
                      <label className="form-label">Initial Stock{!editingProduct && ' *'}</label>
                      <input type="number" className="form-input" min={editingProduct ? 0 : 1} required={!editingProduct} value={formData.current_stock} onChange={e => setFormData({ ...formData, current_stock: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Min Stock Threshold</label>
                      <input type="number" className="form-input" value={formData.min_stock} onChange={e => setFormData({ ...formData, min_stock: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Rack Location</label>
                      <input className="form-input" placeholder="e.g. A-01" value={formData.location} onChange={e => setFormData({ ...formData, location: e.target.value })} />
                    </div>
                  </div>
                </div>
                </div>

                {/* ── Live summary of the part being described ───────────────── */}
                <aside className="part-form-summary">
                  <div className="card" style={{ background: 'var(--surface-2)' }}>
                    <div className="form-section-head" style={{ marginBottom: '12px' }}>
                      <h4>{editingProduct ? 'After saving' : 'New part'}</h4>
                    </div>

                    <div style={{ marginBottom: '14px' }}>
                      <div className="directory-card-title" style={{ marginBottom: '6px' }}>
                        {draft.name || <span className="text-muted">Part name goes here</span>}
                      </div>
                      <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                        {draft.partNumber && <span className="pn-chip">{draft.partNumber}</span>}
                        {draft.brand && (
                          <span className="brand-chip" style={{ ['--brand-chip-color' as string]: brandChipColor(draft.brand) } as React.CSSProperties}>
                            {draft.brand}
                          </span>
                        )}
                        {draft.category && <span className="badge badge-muted">{draft.category}</span>}
                      </div>
                    </div>

                    {/* Same stock wording the table uses, so a part reads identically here and there. */}
                    <div className="flex justify-between items-center" style={{ marginBottom: '4px' }}>
                      <span className="text-muted" style={{ fontSize: '12.5px' }}>Opening stock</span>
                      <span className={`badge ${draft.stockBadge.tone}`}>{draft.stockBadge.label}</span>
                    </div>
                    {draft.meterPercent !== null && (
                      <div className={`meter ${draft.stock <= 0 ? 'meter--out' : draft.isLow ? 'meter--low' : ''}`} style={{ marginBottom: '14px' }}>
                        <i style={{ width: `${draft.meterPercent}%` }} />
                      </div>
                    )}

                    <div className="report-summary" style={{ maxWidth: 'none', margin: 0, padding: 0, gap: 0 }}>
                      <div className="report-line"><span className="text-muted">Cost price</span><strong>{draft.cost > 0 ? `₹${money(draft.cost)}` : '—'}</strong></div>
                      <div className="report-line"><span className="text-muted">Sale price</span><strong>{draft.sale > 0 ? `₹${money(draft.sale)}` : '—'}</strong></div>
                      {draft.mrp > 0 && (
                        <div className="report-line"><span className="text-muted">MRP</span><strong>₹{money(draft.mrp)}</strong></div>
                      )}
                      {draftMargin !== null && (
                        <div className="report-line report-strong">
                          <span>Margin per piece</span>
                          <strong className={draftMargin < 0 ? 'text-danger' : 'text-success'}>
                            ₹{money(draft.sale - draft.cost)} · {draftMargin.toFixed(1)}%
                          </strong>
                        </div>
                      )}
                    </div>

                    {draft.stockValue > 0 && (
                      <div className="report-total mt-2">
                        <div>
                          <small>Opening stock at cost</small>
                          <strong>₹{wholeMoney(draft.stockValue)}</strong>
                        </div>
                      </div>
                    )}

                    {/* Only things that are actually wrong or genuinely missing — never nagging. */}
                    {draft.warnings.length > 0 && (
                      <div className="flex flex-col gap-2 mt-2">
                        {draft.warnings.map((warning) => (
                          <div key={warning.text} className={`alert ${warning.tone}`} role="status" style={{ fontSize: '12.5px', padding: '9px 11px' }}>
                            {warning.text}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </aside>
              </div>

              <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
                <span className="text-muted" style={{ fontSize: '12.5px' }}>
                  {savedThisSession > 0
                    ? `${savedThisSession} ${savedThisSession === 1 ? 'part' : 'parts'} added so far`
                    : ''}
                </span>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-secondary" disabled={savingProduct} onClick={() => setShowModal(false)}>
                    {savedThisSession > 0 ? 'Done' : 'Cancel'}
                  </button>
                  {/* Only offered when adding: "another" makes no sense mid-edit of one part. */}
                  {!editingProduct && (
                    <button
                      type="submit"
                      className="btn btn-secondary"
                      disabled={savingProduct}
                      onClick={() => { addAnotherRef.current = true; }}
                    >
                      <Plus size={15} /> Save &amp; add another
                    </button>
                  )}
                  <button type="submit" className="btn btn-primary" disabled={savingProduct}>
                    {savingProduct ? 'Saving…' : editingProduct ? 'Save Changes' : 'Save Part'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteCandidate && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: '440px' }} role="dialog" aria-modal="true" aria-labelledby="delete-part-title">
            <div className="modal-header"><h3 id="delete-part-title" className="modal-title">Delete inventory part?</h3></div>
            <div className="modal-body">
              <p>This will remove <strong>{deleteCandidate.part_number} — {deleteCandidate.name}</strong> from the current inventory list.</p>
              {deleteError && <p className="form-error" role="alert">{deleteError}</p>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" disabled={deletingProduct} onClick={() => setDeleteCandidate(null)}>Cancel</button>
              <button className="btn btn-danger" disabled={deletingProduct} onClick={confirmDelete}>{deletingProduct ? 'Deleting…' : 'Delete Part'}</button>
            </div>
          </div>
        </div>
      )}

      {costPlan && (() => {
        const counts = countOutcomes(costPlan.matches);
        // Anything that will not be applied is listed first: the point of this screen is to show
        // what the file failed to do, not to bury it under a long list of successes.
        const ordered = [...costPlan.matches].sort((a, b) => {
          const rank = { conflict: 0, not_found: 1, update: 2, unchanged: 3 } as const;
          return rank[a.outcome] - rank[b.outcome] || a.row.rowNumber - b.row.rowNumber;
        });
        const skipped = costPlan.skippedNoCost + costPlan.skippedNoIdentifier;
        return (
          <div className="modal-overlay">
            <div className="modal-box" style={{ maxWidth: '760px' }} role="dialog" aria-modal="true" aria-labelledby="cost-import-title">
              <div className="modal-header">
                <h3 id="cost-import-title" className="modal-title">Update cost prices from {costPlan.fileName}</h3>
              </div>
              <div className="modal-body">
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Costs read from the <strong>{costPlan.costColumn}</strong> column. Only the cost price changes — stock,
                  selling price and every other detail are left exactly as they are.
                </p>
                <p style={{ fontSize: '13px', margin: '10px 0' }}>
                  <strong>{counts.update}</strong> to update · {counts.unchanged} already correct · {counts.not_found} not found
                  {counts.conflict > 0 && <> · <span style={{ color: 'var(--color-warning)' }}>{counts.conflict} unclear</span></>}
                  {skipped > 0 && <span style={{ color: 'var(--text-muted)' }}> · {skipped} row(s) skipped as unreadable</span>}
                </p>
                <div style={{ maxHeight: '320px', overflowY: 'auto', overflowX: 'auto' }}>
                  <table className="table">
                    <thead>
                      <tr><th>Row</th><th>Part</th><th>Cost now</th><th>New cost</th><th>What happens</th></tr>
                    </thead>
                    <tbody>
                      {ordered.map((m) => (
                        <tr key={m.row.rowNumber}>
                          <td style={{ color: 'var(--text-muted)' }}>{m.row.rowNumber}</td>
                          <td>{m.product ? `${m.product.part_number || '—'} · ${m.product.name}` : (m.row.partNumber || m.row.name || m.row.oemNumber)}</td>
                          <td style={{ fontVariantNumeric: 'tabular-nums' }}>{m.product ? `₹${money(Number(m.product.cost_price))}` : '—'}</td>
                          <td style={{ fontVariantNumeric: 'tabular-nums' }}>₹{money(m.row.cost)}</td>
                          <td>
                            {m.outcome === 'update' && <span className="badge badge-success">update</span>}
                            {m.outcome === 'unchanged' && <span style={{ color: 'var(--text-muted)' }}>{m.reason ?? 'no change'}</span>}
                            {m.outcome === 'not_found' && <span style={{ color: 'var(--text-muted)' }}>{m.reason}</span>}
                            {m.outcome === 'conflict' && <span style={{ color: 'var(--color-warning)' }}>{m.reason}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {importError && <p className="form-error" role="alert">{importError}</p>}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" disabled={applyingCosts} onClick={() => setCostPlan(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={applyingCosts || counts.update === 0} onClick={applyCostPlan}>
                  {applyingCosts
                    ? `Updating ${costProgress} of ${counts.update}…`
                    : counts.update === 0
                      ? 'Nothing to update'
                      : `Apply ${counts.update} cost update(s)`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
