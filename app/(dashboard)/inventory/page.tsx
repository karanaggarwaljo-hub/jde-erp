'use client';

import Link from 'next/link';
import { ChangeEvent, DragEvent, useEffect, useRef, useState } from 'react';
import {
  Plus,
  Search,
  Filter,
  Edit,
  Trash2,
  AlertTriangle,
  Upload,
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
import { money, wholeMoney } from '@/lib/money';
import { useCompany } from '@/components/CompanyProvider';
import { parseInventoryFile, readSheetForCostUpdate, extractCostRows, sampleColumnValues, sheetFromScannedParts, fileToBase64, SPREADSHEET_ACCEPT, SPREADSHEET_EXTENSIONS, SCANNABLE_IMPORT_ACCEPT, isSpreadsheetFileName, isScannableFileName, type SheetForCostUpdate, type ImportedProduct, type ScannedPart } from '@/lib/client-import';
import { planCostUpdates, countOutcomes, findExistingProduct, type CostMatch } from '@/lib/cost-import';
import { planDetailUpdates, countDetailOutcomes, fieldsToWrite, looksLikeAnInventedCode, type DetailChange } from '@/lib/detail-import';
import { addStockLayer, consumeStockFifo, correctOldestLayerCost } from '@/lib/client-fifo';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import { fifoCostLookup } from '@/lib/stock-value';
import { resizeImageForUpload, DOCUMENT_SCAN_DIMENSION } from '@/lib/imageResize';

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
  // The sheet is read once; which column means what stays the owner's choice, so changing it
  // re-plans instantly without touching the file again.
  const [costSheet, setCostSheet] = useState<
    { fileName: string; sheet: SheetForCostUpdate; newParts: ImportedProduct[]; guessedFields: string[] } | null
  >(null);
  // One file can mean two different jobs. Which one is proposed from the file's own content —
  // rows that match parts already stocked are a price list; rows that don't are a parts list.
  const [importMode, setImportMode] = useState<'costs' | 'new' | 'details'>('costs');
  // Individual field changes the owner has unticked, keyed "row:field". Storing exclusions
  // rather than selections means a change that appears after re-reading is offered by default
  // instead of being silently skipped.
  const [excludedDetails, setExcludedDetails] = useState<Set<string>>(new Set());
  const [excludedNew, setExcludedNew] = useState<Set<number>>(new Set());
  const [costColumn, setCostColumn] = useState('');
  const [idColumn, setIdColumn] = useState('');
  // Row numbers the owner has unticked. Storing exclusions rather than selections means a row
  // that appears after changing a column is included by default instead of silently skipped.
  const [excludedRows, setExcludedRows] = useState<Set<number>>(new Set());
  const [draggingFile, setDraggingFile] = useState(false);
  const dragDepth = useRef(0);
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

  /** Everything a chosen file goes through, shared by the picker and by drag-and-drop so the two
   *  can never behave differently. */
  const beginImport = async (file: File) => {
    // A dropped file bypasses the picker's filter entirely, so the check has to happen here —
    // and say what IS accepted rather than just refusing.
    const scannable = isScannableFileName(file.name, file.type);
    if (!scannable && !isSpreadsheetFileName(file.name)) {
      setImportError(
        `"${file.name}" can't be read. Drop a spreadsheet (${SPREADSHEET_EXTENSIONS.join(', ')}), ` +
          'or a photo or PDF of a parts list.'
      );
      return;
    }
    setImportError('');
    setFeedback('');
    setImporting(true);
    try {
      // Read the file once, both ways. Neither reading writes anything, and having both up front
      // is what lets the dialog offer either job — and switch between them — without re-uploading.
      let sheet: SheetForCostUpdate;
      let newParts: ImportedProduct[];
      let guessedFields: string[] = [];

      if (scannable) {
        // Same size problem as the purchase-invoice scan: a phone photo is far past the platform's
        // request limit once encoded, and is rejected before it reaches the app. Shrink first.
        let base64: string;
        let mimeType: string;
        if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
          if (file.size > 4_000_000) {
            throw new Error('This PDF is too large to read (over 4MB). Save it smaller, or photograph the page instead.');
          }
          base64 = await fileToBase64(file);
          mimeType = 'application/pdf';
        } else {
          ({ base64, mimeType } = await resizeImageForUpload(file, { maxDimension: DOCUMENT_SCAN_DIMENSION }));
        }

        const res = await fetch('/api/inventory/scan-list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64, mimeType }),
        });
        const body = (await parseJsonOrThrow(res, 'Could not read this document.')) as { items?: ScannedPart[] };
        const items = Array.isArray(body.items) ? body.items : [];
        if (items.length === 0) {
          throw new Error('No parts could be read from this image. Make sure the list is in focus and the whole page is in frame.');
        }
        // Turned into the shapes a spreadsheet produces, so the preview, the column pickers, the
        // matching and the tick boxes all work on a photo exactly as they do on a file.
        ({ sheet, products: newParts } = sheetFromScannedParts(items));
      } else {
        sheet = await readSheetForCostUpdate(file);
        ({ products: newParts, guessedFields } = await parseInventoryFile(file).catch(() => ({
          products: [] as ImportedProduct[],
          guessedFields: [] as string[],
        })));
      }

      const costColumnGuess = sheet.suggestedCostColumn ?? '';
      const idColumnGuess = sheet.suggestedIdColumn ?? sheet.columns[0] ?? '';

      // Propose the job that fits the file. A sheet whose rows are mostly parts already stocked is
      // a price list; one whose rows are mostly unknown is a list of parts to add. Getting this
      // wrong is harmless — it is a preview either way — but getting it right saves a step.
      let mode: 'costs' | 'new' | 'details' = 'new';
      if (costColumnGuess && idColumnGuess) {
        const rows = extractCostRows(sheet, costColumnGuess, idColumnGuess).rows;
        const known = planCostUpdates(rows, products).filter((m) => m.product).length;
        if (rows.length > 0 && known >= rows.length / 2) mode = 'costs';
      }
      if (newParts.length === 0) mode = 'costs';

      // A supplier document with no price column, whose rows are parts already stocked, is
      // almost always being used to fill in the real part numbers — propose that job rather than
      // opening on a cost screen with nothing to show.
      const detailUpdates = planDetailUpdates(newParts, products).filter((m) => m.outcome === 'update').length;
      if (!costColumnGuess && detailUpdates > 0) mode = 'details';

      setExcludedDetails(new Set());
      setCostColumn(costColumnGuess);
      setIdColumn(idColumnGuess);
      setExcludedRows(new Set());
      // Anything already stocked starts unticked in "add new parts" mode: re-adding it would
      // create a second copy, which is the single most likely way to damage inventory here.
      // It can still be ticked deliberately — the duplicate is named on the row.
      setExcludedNew(
        new Set(
          newParts
            .map((part, index) => (findExistingProduct(products, { partNumber: part.part_number, name: part.name }) ? index : -1))
            .filter((index) => index >= 0)
        )
      );
      setImportMode(mode);
      setCostSheet({ fileName: file.name, sheet, newParts, guessedFields });
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to read the file.');
    } finally {
      setImporting(false);
    }
  };

  const handleFileImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared before the await so picking the same file twice in a row still fires onChange.
    event.target.value = '';
    if (file) void beginImport(file);
  };

  // Only react to an actual file being dragged in — dragging selected text or a link across the
  // page should not put the screen into a drop state.
  const dragCarriesFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!dragCarriesFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDraggingFile(true);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    // Without preventDefault here the browser refuses the drop and opens the file instead.
    if (dragCarriesFiles(event)) event.preventDefault();
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!dragCarriesFiles(event)) return;
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDraggingFile(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!dragCarriesFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDraggingFile(false);
    if (importing) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) void beginImport(file);
  };

  // A file dropped just outside the zone — on the sidebar, or the margin beside it — would
  // otherwise make the browser navigate away to that file, losing whatever was on screen. Swallow
  // those so a near miss simply does nothing. The zone's own handlers still run first and are
  // unaffected, because they stop the event before it reaches the window.
  useEffect(() => {
    const swallow = (event: globalThis.DragEvent) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
      event.preventDefault();
    };
    const clear = () => {
      dragDepth.current = 0;
      setDraggingFile(false);
    };
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    window.addEventListener('drop', clear);
    window.addEventListener('dragend', clear);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
      window.removeEventListener('drop', clear);
      window.removeEventListener('dragend', clear);
    };
  }, []);

  const applyNewParts = async (chosen: ImportedProduct[]) => {
    if (!costSheet) return;
    setApplyingCosts(true);
    setImportError('');
    try {
      const res = await fetch('/api/local/products?bulk=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: chosen.map((product) => ({ ...product, company_id: activeCompany?.id })) }),
      });
      await parseJsonOrThrow(res, 'Failed to import parts.');
      await Promise.all([reload(), reloadStockLayers()]);
      const guessNote = costSheet.guessedFields.length > 0
        ? ` Your file's column titles didn't clearly label ${costSheet.guessedFields.join(', ')}, so those were guessed from the numbers — please spot-check a few rows.`
        : '';
      setFeedback(`Added ${chosen.length} new part(s) from ${costSheet.fileName}.${guessNote}`);
      setCostSheet(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to import parts.');
    } finally {
      setApplyingCosts(false);
    }
  };

  /** Writes only the identifying details the owner left ticked. Nothing here touches stock,
   *  cost, selling price or any batch — this changes what a part is CALLED, never how many
   *  there are or what they are worth. */
  const applyDetailPlan = async (pending: { productId: string; patch: Record<string, string>; name: string }[]) => {
    if (!costSheet) return;
    setApplyingCosts(true);
    setCostProgress(0);
    setImportError('');
    let done = 0;
    let fields = 0;
    try {
      for (const item of pending) {
        await update(item.productId, item.patch);
        fields += Object.keys(item.patch).length;
        done += 1;
        setCostProgress(done);
      }
      await reload();
      setFeedback(`Filled in ${fields} detail(s) across ${done} part(s) from ${costSheet.fileName}. Stock and prices were not touched.`);
      setCostSheet(null);
    } catch (err) {
      // Say exactly how far it got — a half-applied run whose shape the owner knows is
      // recoverable; a silent one is not.
      await reload();
      setImportError(
        `${err instanceof Error ? err.message : 'Failed to update part details.'} ` +
          `${done} of ${pending.length} part(s) were updated before this stopped.`
      );
    } finally {
      setApplyingCosts(false);
    }
  };

  const applyCostPlan = async (pending: CostMatch[]) => {
    if (!costSheet) return;
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
      setFeedback(`Updated the cost price of ${done} part(s) from ${costSheet.fileName}.`);
      setCostSheet(null);
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
    <div
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{ position: 'relative', minHeight: '60vh' }}
    >
      {draggingFile && (
        <div className="dropzone-overlay" role="status" aria-live="polite">
          <div className="dropzone-card">
            <Upload size={28} />
            <p className="dropzone-title">Drop the file to import</p>
            <p className="dropzone-hint">
              A spreadsheet ({SPREADSHEET_EXTENSIONS.slice(0, 4).join(', ')}…), or a photo or PDF of a parts list.
              You choose what it does next; nothing is saved yet.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="page-header">
        <div>
          <div className="eyebrow">Stock control</div>
          <h1 className="page-title">Spare Parts Inventory</h1>
          <p className="page-subtitle">Track stock levels, locations & pricing{catalogueSummary}</p>
        </div>
        <div className="flex gap-2">
          <label className="btn btn-secondary" style={{ cursor: importing ? 'not-allowed' : 'pointer' }}>
            <Upload size={16} /> {importing ? 'Reading…' : 'Import from File'}
            <input type="file" accept={`${SPREADSHEET_ACCEPT},${SCANNABLE_IMPORT_ACCEPT}`} hidden disabled={importing} onChange={handleFileImport} />
          </label>
          <button className="btn btn-primary" onClick={handleOpenAdd}>
            <Plus size={16} /> Add New Part
          </button>
          <span className="text-muted text-sm" style={{ alignSelf: 'center' }}>or drop a spreadsheet, photo or PDF anywhere on this page</span>
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
                  <td>
                    {p.part_number
                      ? <span className="pn-chip" title={looksLikeAnInventedCode(p.part_number) ? 'This is a code this app generated, not the manufacturer’s part number — don’t quote it to a customer or supplier' : undefined}>
                          {p.part_number}
                          {looksLikeAnInventedCode(p.part_number) && <span style={{ marginLeft: '4px', opacity: 0.65, fontWeight: 400 }}>(internal)</span>}
                        </span>
                      : <span className="text-muted" style={{ fontSize: '12px' }}>no part number</span>}
                  </td>
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

      {costSheet && (() => {
        const sheet = costSheet.sheet;
        // Re-derived on every render, so changing either dropdown immediately re-plans against
        // the same already-read sheet — no re-upload, no stale preview.
        const parsed = costColumn && idColumn ? extractCostRows(sheet, costColumn, idColumn) : null;
        const matches = parsed ? planCostUpdates(parsed.rows, products) : [];
        const counts = countOutcomes(matches);
        const updatable = matches.filter((m) => m.outcome === 'update' && m.product);
        const pending = updatable.filter((m) => !excludedRows.has(m.row.rowNumber));
        const allTicked = updatable.length > 0 && pending.length === updatable.length;
        const toggleRow = (rowNumber: number) =>
          setExcludedRows((previous) => {
            const next = new Set(previous);
            if (next.has(rowNumber)) next.delete(rowNumber);
            else next.add(rowNumber);
            return next;
          });
        const toggleAll = () =>
          setExcludedRows(allTicked ? new Set(updatable.map((m) => m.row.rowNumber)) : new Set());
        // Anything that will not be applied is listed first: the point of this screen is to show
        // what the file failed to do, not to bury it under a long list of successes.
        const ordered = [...matches].sort((a, b) => {
          const rank = { conflict: 0, not_found: 1, update: 2, unchanged: 3 } as const;
          return rank[a.outcome] - rank[b.outcome] || a.row.rowNumber - b.row.rowNumber;
        });
        const skipped = parsed ? parsed.skippedNoCost + parsed.skippedNoIdentifier : 0;
        const samples = costColumn ? sampleColumnValues(sheet, costColumn) : [];
        // The same rows, read for what they say a part IS rather than what it costs.
        const detailMatches = planDetailUpdates(costSheet.newParts, products);
        const detailCounts = countDetailOutcomes(detailMatches);
        const detailKey = (rowNumber: number, change: DetailChange) => `${rowNumber}:${change.field}`;
        const detailAccepted = (rowNumber: number) => (change: DetailChange) => !excludedDetails.has(detailKey(rowNumber, change));
        const detailPending = detailMatches
          .filter((m) => m.outcome === 'update' && m.product)
          .map((m) => ({ match: m, patch: fieldsToWrite(m, detailAccepted(m.rowNumber)) }))
          .filter(({ patch }) => Object.keys(patch).length > 0);
        const detailOfferedCount = detailMatches.reduce(
          (total, m) => total + m.changes.filter((c) => c.kind !== 'keep').length,
          0
        );
        const detailTickedCount = detailPending.reduce((total, { patch }) => total + Object.keys(patch).length, 0);
        const toggleDetail = (rowNumber: number, change: DetailChange) =>
          setExcludedDetails((previous) => {
            const next = new Set(previous);
            const key = detailKey(rowNumber, change);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          });
        // Anything that will not be applied is listed first, same reasoning as the cost plan.
        const detailOrdered = [...detailMatches].sort((a, b) => {
          const rank = { conflict: 0, not_found: 1, update: 2, nothing_to_add: 3 } as const;
          return rank[a.outcome] - rank[b.outcome] || a.rowNumber - b.rowNumber;
        });

        const chosenNew = costSheet.newParts.filter((_, index) => !excludedNew.has(index));
        const duplicateCount = costSheet.newParts.filter((part) =>
          findExistingProduct(products, { partNumber: part.part_number, name: part.name })
        ).length;
        const allNewTicked = costSheet.newParts.length > 0 && chosenNew.length === costSheet.newParts.length;
        const toggleNew = (index: number) =>
          setExcludedNew((previous) => {
            const next = new Set(previous);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
          });
        const toggleAllNew = () =>
          setExcludedNew(allNewTicked ? new Set(costSheet.newParts.map((_, index) => index)) : new Set());
        return (
          <div className="modal-overlay">
            <div className="modal-box" style={{ maxWidth: '820px' }} role="dialog" aria-modal="true" aria-labelledby="cost-import-title">
              <div className="modal-header">
                <h3 id="cost-import-title" className="modal-title">Import from {costSheet.fileName}</h3>
              </div>
              <div className="modal-body">
                <div className="form-group" style={{ marginBottom: '12px' }}>
                  <span className="form-label">What should this file do?</span>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      type="button"
                      className={'btn btn-sm ' + (importMode === 'costs' ? 'btn-primary' : 'btn-secondary')}
                      onClick={() => setImportMode('costs')}
                    >
                      Update cost prices of parts I already have
                    </button>
                    <button
                      type="button"
                      className={'btn btn-sm ' + (importMode === 'new' ? 'btn-primary' : 'btn-secondary')}
                      disabled={costSheet.newParts.length === 0}
                      onClick={() => setImportMode('new')}
                    >
                      Add as new parts{costSheet.newParts.length > 0 ? ' (' + costSheet.newParts.length + ')' : ''}
                    </button>
                    <button
                      type="button"
                      className={'btn btn-sm ' + (importMode === 'details' ? 'btn-primary' : 'btn-secondary')}
                      disabled={detailCounts.update === 0}
                      onClick={() => setImportMode('details')}
                    >
                      Fill in part numbers &amp; details{detailCounts.update > 0 ? ' (' + detailCounts.update + ')' : ''}
                    </button>
                  </div>
                </div>

                <div className="flex gap-4 flex-wrap" style={{ marginBottom: '12px', display: importMode === 'costs' ? undefined : 'none' }}>
                  <div className="form-group" style={{ margin: 0, minWidth: '230px' }}>
                    <label className="form-label" htmlFor="cost-col">Which column holds the cost?</label>
                    <select id="cost-col" className="form-select" value={costColumn} onChange={(e) => { setCostColumn(e.target.value); setExcludedRows(new Set()); }}>
                      <option value="">— choose a column —</option>
                      {sheet.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    {samples.length > 0 && (
                      <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                        First values: {samples.join(', ')}
                      </p>
                    )}
                  </div>
                  <div className="form-group" style={{ margin: 0, minWidth: '230px' }}>
                    <label className="form-label" htmlFor="id-col">Which column names the part?</label>
                    <select id="id-col" className="form-select" value={idColumn} onChange={(e) => { setIdColumn(e.target.value); setExcludedRows(new Set()); }}>
                      <option value="">— choose a column —</option>
                      {sheet.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  {importMode === 'costs'
                    ? 'Only the cost price changes — stock, selling price and every other detail are left exactly as they are.'
                    : importMode === 'details'
                      ? 'Fills in the real part number, OEM number, HSN, brand and category on parts you already stock. Stock, cost and selling price are not touched. A detail you already have is only replaced when the existing one is a code this app made up — shown as old → new, and you can untick any of them.'
                      : 'Each ticked row becomes a brand-new part. Rows matching something you already stock start unticked, so nothing is duplicated by accident.'}
                </p>
                {importMode === 'details' ? (
                  <>
                    <p style={{ fontSize: '13px', margin: '10px 0' }}>
                      <strong>{detailTickedCount} of {detailOfferedCount}</strong> detail(s) ticked, across {detailCounts.update} part(s)
                      {detailCounts.not_found > 0 && (
                        <span style={{ color: 'var(--text-muted)' }}> · {detailCounts.not_found} row(s) match no part you stock</span>
                      )}
                      {detailCounts.conflict > 0 && (
                        <span style={{ color: 'var(--color-warning)' }}> · {detailCounts.conflict} left alone</span>
                      )}
                    </p>
                    <div style={{ maxHeight: '320px', overflowY: 'auto', overflowX: 'auto' }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Part on file</th>
                            <th>What the document adds</th>
                            <th>Result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailOrdered.map((m) => (
                            <tr key={m.rowNumber}>
                              <td>
                                <strong style={{ fontSize: '13px' }}>{m.product?.name ?? m.name}</strong>
                                {m.product && (
                                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                                    {m.product.part_number ? m.product.part_number : 'no part number yet'}
                                    {m.matchedBy ? ` · matched by ${m.matchedBy}` : ''}
                                  </div>
                                )}
                              </td>
                              <td>
                                {m.changes.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>}
                                {m.changes.map((change) => (
                                  <div key={change.field} style={{ fontSize: '12px', marginBottom: '2px' }}>
                                    {change.kind === 'keep' ? (
                                      <span style={{ color: 'var(--color-warning)' }}>
                                        {change.label}: document says <strong>{change.to}</strong>, you have <strong>{change.from}</strong> — left alone
                                      </span>
                                    ) : (
                                      <label className="flex items-center gap-2" style={{ cursor: applyingCosts ? 'default' : 'pointer' }}>
                                        <input
                                          type="checkbox"
                                          disabled={applyingCosts}
                                          checked={!excludedDetails.has(`${m.rowNumber}:${change.field}`)}
                                          onChange={() => toggleDetail(m.rowNumber, change)}
                                        />
                                        <span>
                                          {change.label}: {change.kind === 'replace'
                                            ? <><span style={{ textDecoration: 'line-through', color: 'var(--text-muted)' }}>{change.from}</span> → <strong>{change.to}</strong></>
                                            : <strong>{change.to}</strong>}
                                        </span>
                                      </label>
                                    )}
                                  </div>
                                ))}
                              </td>
                              <td style={{ fontSize: '12px' }}>
                                {m.outcome === 'update' && <span className="badge badge-success">update</span>}
                                {m.outcome === 'nothing_to_add' && <span style={{ color: 'var(--text-muted)' }}>{m.reason}</span>}
                                {m.outcome === 'not_found' && <span style={{ color: 'var(--text-muted)' }}>{m.reason}</span>}
                                {m.outcome === 'conflict' && <span style={{ color: 'var(--color-warning)' }}>{m.reason}</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : importMode === 'new' ? (
                  <>
                    <p style={{ fontSize: '13px', margin: '10px 0' }}>
                      <strong>{chosenNew.length} of {costSheet.newParts.length}</strong> selected to add
                      {duplicateCount > 0 && (
                        <span style={{ color: 'var(--color-warning)' }}> · {duplicateCount} already stocked</span>
                      )}
                    </p>
                    <div style={{ maxHeight: '300px', overflowY: 'auto', overflowX: 'auto' }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th style={{ width: '34px' }}>
                              <input
                                type="checkbox"
                                aria-label={allNewTicked ? 'Clear all' : 'Select all'}
                                checked={allNewTicked}
                                ref={(el) => { if (el) el.indeterminate = chosenNew.length > 0 && !allNewTicked; }}
                                onChange={toggleAllNew}
                              />
                            </th>
                            <th>Part</th><th>Name</th><th>Stock</th><th>Cost</th><th>What happens</th>
                          </tr>
                        </thead>
                        <tbody>
                          {costSheet.newParts.map((part, index) => {
                            const existing = findExistingProduct(products, { partNumber: part.part_number, name: part.name });
                            return (
                              <tr key={index} style={excludedNew.has(index) ? { opacity: 0.45 } : undefined}>
                                <td>
                                  <input
                                    type="checkbox"
                                    aria-label={'Add ' + (part.part_number || part.name)}
                                    checked={!excludedNew.has(index)}
                                    onChange={() => toggleNew(index)}
                                  />
                                </td>
                                <td>{part.part_number || '—'}</td>
                                <td>{part.name}</td>
                                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{part.current_stock}</td>
                                <td style={{ fontVariantNumeric: 'tabular-nums' }}>₹{money(part.cost_price)}</td>
                                <td>
                                  {existing
                                    ? <span style={{ color: 'var(--color-warning)' }}>already stocked as {existing.part_number || existing.name}</span>
                                    : <span className="badge badge-success">add</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : !parsed ? (
                  <p style={{ fontSize: '13px', color: 'var(--color-warning)', marginTop: '10px' }}>
                    Choose both columns above to see what would change.
                  </p>
                ) : (
                  <>
                    <p style={{ fontSize: '13px', margin: '10px 0' }}>
                      <strong>{pending.length} of {counts.update}</strong> selected to update · {counts.unchanged} already correct · {counts.not_found} not found
                      {counts.conflict > 0 && <> · <span style={{ color: 'var(--color-warning)' }}>{counts.conflict} unclear</span></>}
                      {skipped > 0 && <span style={{ color: 'var(--text-muted)' }}> · {skipped} row(s) skipped as unreadable</span>}
                    </p>
                    {/* The likeliest cause of a wall of "not found" is not a bad file but the wrong
                        company being active — this sheet's part codes simply belong elsewhere.
                        Say that plainly instead of leaving 227 unexplained misses to decode. */}
                    {matches.length > 0 && counts.not_found > matches.length / 2 && (
                      <p className="alert alert-warning" style={{ fontSize: '13px', padding: '8px 12px' }}>
                        Most rows don&apos;t match anything in <strong>{activeCompany?.name ?? 'this company'}</strong>. If this
                        price list belongs to another company, switch to it first — or check that the
                        &ldquo;{idColumn}&rdquo; column really holds your part codes.
                      </p>
                    )}
                    <div style={{ maxHeight: '300px', overflowY: 'auto', overflowX: 'auto' }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th style={{ width: '34px' }}>
                              <input
                                type="checkbox"
                                aria-label={allTicked ? 'Clear all' : 'Select all'}
                                checked={allTicked}
                                disabled={updatable.length === 0}
                                // Partly-ticked has to be set on the node; there is no attribute for it.
                                ref={(el) => { if (el) el.indeterminate = pending.length > 0 && !allTicked; }}
                                onChange={toggleAll}
                              />
                            </th>
                            <th>Row</th><th>Part</th><th>Cost now</th><th>New cost</th><th>What happens</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ordered.map((m) => (
                            <tr key={m.row.rowNumber} style={m.outcome === 'update' && excludedRows.has(m.row.rowNumber) ? { opacity: 0.45 } : undefined}>
                              <td>
                                {m.outcome === 'update' && (
                                  <input
                                    type="checkbox"
                                    aria-label={`Update ${m.product?.part_number || m.product?.name || `row ${m.row.rowNumber}`}`}
                                    checked={!excludedRows.has(m.row.rowNumber)}
                                    onChange={() => toggleRow(m.row.rowNumber)}
                                  />
                                )}
                              </td>
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
                  </>
                )}
                {importError && <p className="form-error" role="alert">{importError}</p>}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" disabled={applyingCosts} onClick={() => setCostSheet(null)}>Cancel</button>
                {importMode === 'details' ? (
                  <button
                    className="btn btn-primary"
                    disabled={applyingCosts || detailPending.length === 0}
                    onClick={() => applyDetailPlan(detailPending.map(({ match, patch }) => ({ productId: match.product!.id, patch, name: match.product!.name })))}
                  >
                    {applyingCosts
                      ? `Updating ${costProgress} of ${detailPending.length}…`
                      : detailPending.length === 0
                        ? (detailCounts.update === 0 ? 'Nothing to fill in' : 'Nothing ticked')
                        : `Fill in ${detailTickedCount} detail(s) on ${detailPending.length} part(s)`}
                  </button>
                ) : importMode === 'new' ? (
                  <button className="btn btn-primary" disabled={applyingCosts || chosenNew.length === 0} onClick={() => applyNewParts(chosenNew)}>
                    {applyingCosts ? 'Adding\u2026' : chosenNew.length === 0 ? 'Nothing selected' : 'Add ' + chosenNew.length + ' new part(s)'}
                  </button>
                ) : (
                <button className="btn btn-primary" disabled={applyingCosts || pending.length === 0} onClick={() => applyCostPlan(pending)}>
                  {applyingCosts
                    ? `Updating ${costProgress} of ${pending.length}…`
                    : pending.length === 0
                      // "Nothing to update" would be wrong when there are updates and the owner
                      // has simply unticked them all — say which of the two it is.
                      ? (updatable.length === 0 ? 'Nothing to update' : 'Nothing selected')
                      : `Apply ${pending.length} cost update(s)`}
                </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
