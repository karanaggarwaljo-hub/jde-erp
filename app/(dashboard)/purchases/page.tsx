'use client';

import { ChangeEvent, FormEvent, useState } from 'react';
import {
  Plus,
  Minus,
  FileCheck,
  FileText,
  Upload,
  Receipt,
  Wallet,
  Truck,
  Building2,
  PackageCheck,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
} from 'lucide-react';
import { parseSpreadsheetFile, fileToBase64, hashFile, SPREADSHEET_EXTENSIONS, SCANNABLE_TYPES, type ImportedLine } from '@/lib/client-import';
import { savePurchase, receivePurchaseStock } from '@/lib/client-purchases';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';

type PurchaseTab = 'purchases' | 'invoices';
type PaymentStatus = 'paid' | 'partial' | 'unpaid';
type POLine = { description: string; quantity: number; unit_price: number };

type Product = { id: string; company_id: string; part_number: string; name: string; category: string; cost_price: number; current_stock: number };
type Supplier = { id: string; company_id: string; name: string; balance: number };
type PurchaseOrder = { id: string; company_id: string; supplier: string; date: string; expected: string; items: number; total: number; paid: number; status: string };
type Grn = { id: string; company_id: string; po_number: string; supplier: string; received_at: string; status: string };
type PoItem = { id: string; po_id: string; product_id: string | null; part_number: string; name: string; qty: number; unit_cost: number };

/** Which purchase orders the table is showing. Purely a view filter — it never changes what is
 *  loaded, only which of the already-loaded rows get painted. */
type OrderFilter = 'all' | 'awaiting' | 'unpaid' | 'received';

// How many rows are painted at once. Every order is already in memory — paging costs no request.
const PAGE_SIZE = 25;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-08-18" -> "18 Aug 2026". Anything that isn't a plain ISO date is shown exactly as stored,
 *  so an unrecognised format is never silently reinterpreted into a different day. */
function formatDay(iso: string) {
  if (typeof iso !== 'string' || !ISO_DATE.test(iso)) return iso;
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day || month > 12) return iso;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

const money = (value: number) => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const wholeMoney = (value: number) => Math.round(Number(value || 0)).toLocaleString('en-IN');

/** Which page buttons to show: short lists show every page, long ones collapse to 1 … n-1 n n+1 … last. */
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

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

function isSpreadsheetFile(file: File) {
  return SPREADSHEET_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
}

function isScannableFile(file: File) {
  return SCANNABLE_TYPES.includes(file.type);
}

function cleanedGuess(text: string): string {
  return text.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
}

export default function PurchasesPage() {
  const { rows: products, reload: reloadProducts, activeCompany } = useCompanyTable<Product>('products');
  const { rows: suppliers, create: createSupplier, reload: reloadSuppliers } = useCompanyTable<Supplier>('suppliers');
  const { rows: purchaseOrders, loading: poLoading, reload: reloadPurchaseOrders } = useCompanyTable<PurchaseOrder>('purchase_orders');
  const { reload: reloadGrns } = useCompanyTable<Grn>('grns');
  const { rows: poItems, reload: reloadPoItems } = useCompanyTable<PoItem>('po_items');

  const partOptions = products.map((product) => ({
    value: `${product.part_number} - ${product.name}`,
    price: product.cost_price,
    category: product.category,
    stock: product.current_stock,
  }));
  const supplierOptions = suppliers.map((s) => s.name);

  const [activeTab, setActiveTab] = useState<PurchaseTab>('purchases');
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [purchaseError, setPurchaseError] = useState('');
  const [savingPurchase, setSavingPurchase] = useState(false);
  const [supplierName, setSupplierName] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(todayIso());
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('unpaid');
  const [amountPaid, setAmountPaid] = useState(0);
  const [lines, setLines] = useState<POLine[]>([]);

  // View-only state: which slice of the already-loaded orders the table paints.
  const [orderSearch, setOrderSearch] = useState('');
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('all');
  const [page, setPage] = useState(1);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importPreview, setImportPreview] = useState<{ fileName: string; lines: ImportedLine[]; supplier: string; supplierGstin: string; fileHash: string | null } | null>(null);
  const [confirmingImport, setConfirmingImport] = useState(false);

  const total = lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);
  const paidAmount = paymentStatus === 'paid' ? total : paymentStatus === 'partial' ? Math.min(Math.max(amountPaid, 0), total) : 0;

  const openPurchaseModal = () => {
    setSupplierName('');
    setPurchaseDate(todayIso());
    setPaymentStatus('unpaid');
    setAmountPaid(0);
    setLines([{ description: '', quantity: 1, unit_price: 0 }]);
    setImportError('');
    setPurchaseError('');
    setShowPurchaseModal(true);
  };

  const updateLine = (index: number, patch: Partial<POLine>) => {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  async function resolveSupplier(name: string, gstin?: string): Promise<Supplier> {
    const existing = suppliers.find((s) => s.name.toLowerCase() === name.trim().toLowerCase());
    if (existing) return existing;
    return createSupplier({ name: name.trim(), category: '', phone: '', email: '', gstin: gstin?.trim() ?? '', terms: 30, balance: 0 }) as Promise<Supplier>;
  }

  /** Matches a typed line description against an existing part; if nothing matches, auto-creates
   *  a new Inventory item from it — same pattern as resolveSupplier above, so buying a brand-new
   *  part works the first time instead of silently doing nothing because nothing matched.
   *
   *  knownProducts is a local, caller-owned list (seeded from `products`, mutated in place as new
   *  parts get created) rather than reading `products` directly — two things this fixes at once:
   *  1. Speed: creating a part through the hook's own `create()` reloads the *entire* products
   *     table after every single call. A 14-line invoice import was doing that 14 times in a row —
   *     each one slower than the last as Inventory grows — which is what made recording a purchase
   *     feel painfully slow. This uses a direct, unwrapped POST instead; the caller reloads once,
   *     after the whole batch, not per item.
   *  2. Correctness: `products` from the hook is a React value captured once when this function
   *     started running — it never updates mid-loop no matter how many items get created before
   *     it. Multiple genuinely-new items in the *same* purchase could all compute the same
   *     `products.length`-based fallback part number and collide (this is what produced several
   *     real items all sharing "SP-235" after one multi-line invoice import). knownProducts is
   *     grown after every creation, so each subsequent item in the same batch sees the ones before it.
   *
   *  splitOnDash controls whether a " - " in the description is treated as an already-formatted
   *  "part number - name" pair (matching the po-part-options datalist's own `${part_number} -
   *  ${name}` convention, so typing/picking a new part in that same shape works as expected).
   *  Only safe for manually-typed descriptions — pass false for AI-scanned invoice text, which is
   *  plain natural-language and can contain " - " for unrelated reasons (e.g. "LOADER CUTTER KIT
   *  - JCB", where JCB is a brand, not a part number). Splitting there mangled real line items
   *  into a part "number" like "PIN" named "12400" instead of one part named "PIN - 12400". */
  async function resolveProduct(description: string, unitCost: number, knownProducts: Product[], splitOnDash = true): Promise<Product | null> {
    const trimmed = description.trim();
    if (!trimmed) return null;
    const existing = knownProducts.find((p) => `${p.part_number} - ${p.name}` === trimmed);
    if (existing) return existing;

    const separatorIndex = splitOnDash ? trimmed.indexOf(' - ') : -1;
    const partNumber = separatorIndex > 0 ? trimmed.slice(0, separatorIndex).trim() : `SP-${String(knownProducts.length + 1).padStart(3, '0')}`;
    const name = separatorIndex > 0 ? trimmed.slice(separatorIndex + 3).trim() : trimmed;

    const res = await fetch('/api/local/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        part_number: partNumber,
        oem_number: '',
        name: name || trimmed,
        brand: '',
        category: '',
        compatibility: '',
        // Sale price starts equal to cost (0% margin) rather than a guessed markup — an honest
        // placeholder that's obviously not final, editable in Inventory once a real price is set.
        cost_price: unitCost,
        mrp: unitCost,
        sale_price: unitCost,
        current_stock: 0,
        min_stock: 0,
        location: '',
        company_id: activeCompany?.id,
      }),
    });
    const created = await parseJsonOrThrow(res, 'Failed to create part.') as Product;
    knownProducts.push(created);
    return created;
  }

  const recordPurchase = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeCompany) return;
    setPurchaseError('');
    setSavingPurchase(true);
    try {
      const supplierRow = await resolveSupplier(supplierName);
      const paid = paidAmount;

      const knownProducts = [...products];
      const items = [];
      for (const line of lines) {
        if (!line.description.trim()) continue;
        const matchedProduct = await resolveProduct(line.description, line.unit_price, knownProducts);
        items.push({
          product_id: matchedProduct?.id ?? null,
          part_number: matchedProduct?.part_number ?? '',
          name: matchedProduct?.name ?? line.description,
          qty: line.quantity,
          unit_cost: line.unit_price,
          line_total: line.quantity * line.unit_price,
        });
      }

      // Atomic on the database side (jde_save_purchase): PO header, line items, GRN, FIFO stock
      // layers, and the supplier balance all land as one transaction — a failure partway through
      // leaves nothing half-done. Supplier/product auto-creation above stays a separate step (each
      // already a single atomic insert on its own). The PO/GRN id is generated inside the function
      // itself and read back from the result — not guessed client-side — since id is globally
      // unique across every company, not just the ones this browser has loaded.
      const po = await savePurchase({
        companyId: activeCompany.id,
        supplierId: supplierRow.id,
        supplierName: supplierRow.name,
        date: purchaseDate,
        receivedAt: new Date().toLocaleString('en-IN'),
        items,
        total,
        paid,
        status: 'received',
      });

      await Promise.all([reloadPurchaseOrders(), reloadPoItems(), reloadGrns(), reloadSuppliers(), reloadProducts()]);

      setShowPurchaseModal(false);
      setFeedback(`${po.id} recorded — ${items.length} item(s) added to stock from ${supplierRow.name}.`);
      setActiveTab('purchases');
    } catch (error) {
      setPurchaseError(error instanceof Error ? error.message : 'Failed to record this purchase — please check Purchases and Inventory before retrying.');
    } finally {
      setSavingPurchase(false);
    }
  };

  const markReceived = async (poId: string) => {
    const order = purchaseOrders.find((po) => po.id === poId);
    if (!order || !activeCompany) return;
    setFeedback('');
    setImportError('');
    try {
      // This is a pre-existing pending order created before per-purchase stock tracking existed —
      // its amount is presumed already reflected in the supplier's balance, so only stock catches
      // up here (atomic on the database side via jde_receive_purchase_stock: GRN + FIFO stock
      // layers + status together). The GRN id is generated inside the function itself, same
      // reasoning as savePurchase above.
      await receivePurchaseStock({
        companyId: activeCompany.id,
        poId,
        supplierName: order.supplier,
        receivedAt: new Date().toLocaleString('en-IN'),
        items: poItems
          .filter((item) => item.po_id === poId)
          .map((item) => ({ product_id: item.product_id, qty: item.qty, unit_cost: item.unit_cost })),
      });
      await Promise.all([reloadPurchaseOrders(), reloadGrns(), reloadProducts()]);
      setFeedback(`${poId} marked received and added to stock.`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : `Failed to mark ${poId} received.`);
    }
  };

  const guessSupplierFromText = (text: string | undefined | null): string | undefined => {
    if (!text) return undefined;
    const guess = text.toLowerCase();
    const matched = supplierOptions.find((s) => s.toLowerCase().includes(guess) || guess.includes(s.toLowerCase()));
    return matched ?? cleanedGuess(text) ?? undefined;
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImportError('');
    setFeedback('');
    setImportPreview(null);
    setImporting(true);
    try {
      if (isSpreadsheetFile(file)) {
        const imported = await parseSpreadsheetFile(file);
        if (imported.length === 0) {
          throw new Error('No rows with a recognizable description, quantity, or price column were found in this file.');
        }
        setImportPreview({ fileName: file.name, lines: imported, supplier: guessSupplierFromText(file.name) ?? '', supplierGstin: '', fileHash: null });
      } else if (isScannableFile(file)) {
        const base64 = await fileToBase64(file);
        // Content-based, not filename-based, so the exact same invoice can't be scanned or
        // recorded twice even under a renamed/re-saved copy — checked server-side before this
        // spends an AI call, and again (as a hard guarantee) when the purchase is actually saved.
        const fileHash = await hashFile(file);
        const res = await fetch('/api/purchases/import-scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64, mimeType: file.type, fileHash, companyId: activeCompany?.id }),
        });
        const data = (await parseJsonOrThrow(res, 'Failed to scan document.')) as { items?: unknown; supplier_name?: string; supplier_gstin?: string };

        const items: ImportedLine[] = Array.isArray(data.items) ? data.items : [];
        if (items.length === 0) {
          throw new Error('No line items could be read from this document.');
        }
        setImportPreview({
          fileName: file.name,
          lines: items,
          supplier: guessSupplierFromText(data.supplier_name) ?? '',
          supplierGstin: typeof data.supplier_gstin === 'string' ? data.supplier_gstin : '',
          fileHash,
        });
      } else {
        throw new Error('Unsupported file type. Upload a CSV/Excel file, or a PDF/photo of a supplier document.');
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to read the file.');
    } finally {
      setImporting(false);
    }
  };

  const confirmImportedPO = async () => {
    if (!importPreview || !importPreview.supplier.trim() || !activeCompany) return;
    setImportError('');
    setConfirmingImport(true);
    try {
      const supplierRow = await resolveSupplier(importPreview.supplier, importPreview.supplierGstin);
      const importedTotal = importPreview.lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);

      const knownProducts = [...products];
      const items = [];
      for (const line of importPreview.lines) {
        if (!line.description.trim()) continue;
        // false: this description is raw AI-scanned invoice text, not a manually-typed
        // "part number - name" pair — see resolveProduct's own comment for why that matters.
        const matchedProduct = await resolveProduct(line.description, line.unit_price, knownProducts, false);
        items.push({
          product_id: matchedProduct?.id ?? null,
          part_number: matchedProduct?.part_number ?? '',
          name: matchedProduct?.name ?? line.description,
          qty: line.quantity,
          unit_cost: line.unit_price,
          line_total: line.quantity * line.unit_price,
        });
      }

      const po = await savePurchase({
        companyId: activeCompany.id,
        supplierId: supplierRow.id,
        supplierName: supplierRow.name,
        date: todayIso(),
        receivedAt: new Date().toLocaleString('en-IN'),
        items,
        total: importedTotal,
        paid: 0,
        status: 'received',
        sourceFileHash: importPreview.fileHash,
      });

      await Promise.all([reloadPurchaseOrders(), reloadPoItems(), reloadGrns(), reloadSuppliers(), reloadProducts()]);

      setFeedback(`${po.id} recorded from ${importPreview.fileName} — ${items.length} item(s), ₹${importedTotal.toLocaleString()} from ${supplierRow.name}.`);
      setImportPreview(null);
      setActiveTab('purchases');
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Failed to record this purchase — please check Purchases and Inventory before retrying.');
    } finally {
      setConfirmingImport(false);
    }
  };

  /* ── Headline figures. Every one of them is summed from the purchase orders this page has
        already loaded; nothing here is estimated, projected or carried over from anywhere else.
        There is no month-on-month delta and no trend line because these records hold no
        comparable prior period — an invented one would be worse than none. ───────────────── */
  const orderBalanceOf = (po: PurchaseOrder) => Number(po.total || 0) - Number(po.paid || 0);
  const isReceived = (po: PurchaseOrder) => po.status === 'received';

  const totalPurchased = purchaseOrders.reduce((sum, po) => sum + Number(po.total || 0), 0);
  const totalPaidToSuppliers = purchaseOrders.reduce((sum, po) => sum + Number(po.paid || 0), 0);
  // Only balances still owing are added up — netting an overpaid order against an unpaid one
  // would report less payable than the supplier is actually waiting on.
  const payable = purchaseOrders.reduce((sum, po) => sum + Math.max(0, orderBalanceOf(po)), 0);
  const unpaidOrders = purchaseOrders.filter((po) => orderBalanceOf(po) > 0);
  const pendingOrders = purchaseOrders.filter((po) => !isReceived(po));
  const pendingValue = pendingOrders.reduce((sum, po) => sum + Number(po.total || 0), 0);

  // "Late" is only claimed for orders that actually carry a readable expected date. Orders with
  // no expected date are simply not counted — the page never guesses one.
  const todayKey = todayIso();
  const overdueOrders = pendingOrders.filter((po) => typeof po.expected === 'string' && ISO_DATE.test(po.expected) && po.expected < todayKey);

  const supplierNames = new Set(purchaseOrders.map((po) => po.supplier).filter(Boolean));
  const spendBySupplier = new Map<string, number>();
  for (const po of purchaseOrders) {
    if (!po.supplier) continue;
    spendBySupplier.set(po.supplier, (spendBySupplier.get(po.supplier) ?? 0) + Number(po.total || 0));
  }
  const topSupplier = Array.from(spendBySupplier.entries()).sort((a, b) => b[1] - a[1])[0];

  // The span this screen covers isn't a setting — it is simply the first and last dated order on
  // file. Rows whose date isn't a plain ISO date are left out rather than reinterpreted.
  const orderDates = purchaseOrders.map((po) => po.date).filter((date) => typeof date === 'string' && ISO_DATE.test(date)).sort();
  const dateRangeLabel = orderDates.length > 0 ? `${formatDay(orderDates[0])} – ${formatDay(orderDates[orderDates.length - 1])}` : null;

  const ledgerSummary = purchaseOrders.length > 0
    ? ` · ${purchaseOrders.length} ${purchaseOrders.length === 1 ? 'order' : 'orders'}${supplierNames.size > 0 ? ` from ${supplierNames.size} ${supplierNames.size === 1 ? 'supplier' : 'suppliers'}` : ''}`
    : '';

  /* ── Table view: search, status tabs, paging. All of it filters rows already in memory. ── */
  const searchTerm = orderSearch.trim().toLowerCase();
  const searchedOrders = searchTerm
    ? purchaseOrders.filter((po) =>
      String(po.id ?? '').toLowerCase().includes(searchTerm) ||
      String(po.supplier ?? '').toLowerCase().includes(searchTerm) ||
      String(po.date ?? '').toLowerCase().includes(searchTerm))
    : purchaseOrders;

  // Tab counts come from the search result rather than the whole ledger, so the number on a tab
  // is always exactly how many rows clicking it will show.
  const orderTabs: Array<{ key: OrderFilter; label: string; title: string; rows: PurchaseOrder[] }> = [
    { key: 'all', label: 'All', title: 'Purchase orders', rows: searchedOrders },
    { key: 'awaiting', label: 'Awaiting', title: 'Orders awaiting delivery', rows: searchedOrders.filter((po) => !isReceived(po)) },
    { key: 'unpaid', label: 'Unpaid', title: 'Orders with a balance owing', rows: searchedOrders.filter((po) => orderBalanceOf(po) > 0) },
    { key: 'received', label: 'Received', title: 'Orders received into stock', rows: searchedOrders.filter(isReceived) },
  ];
  const activeOrderTab = orderTabs.find((tab) => tab.key === orderFilter) ?? orderTabs[0];
  const visibleOrders = activeOrderTab.rows;

  // Paging is clamped rather than reset by an effect: the view lands on the new last page instead
  // of showing an empty table when the row count shrinks.
  const totalPages = Math.max(1, Math.ceil(visibleOrders.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pagedOrders = visibleOrders.slice(pageStart, pageStart + PAGE_SIZE);

  // Footer row under the table — the same rows that are on screen, added up. Nothing off-page.
  const pageItems = pagedOrders.reduce((sum, po) => sum + Number(po.items || 0), 0);
  const pageTotal = pagedOrders.reduce((sum, po) => sum + Number(po.total || 0), 0);
  const pagePaid = pagedOrders.reduce((sum, po) => sum + Number(po.paid || 0), 0);

  const awaitingSentence = `${pendingOrders.length} ${pendingOrders.length === 1 ? 'order' : 'orders'} worth ₹${wholeMoney(pendingValue)} ${pendingOrders.length === 1 ? 'is' : 'are'} still awaiting delivery${overdueOrders.length > 0 ? `, and ${overdueOrders.length} ${overdueOrders.length === 1 ? 'is' : 'are'} past the expected date on the order` : ''}.`;

  const importedPreviewTotal = importPreview ? importPreview.lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0) : 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Procurement</div>
          <h1 className="page-title">Purchases</h1>
          <p className="page-subtitle">Record what you bought — stock and what you owe the supplier update immediately{ledgerSummary}</p>
        </div>
        <div className="flex gap-2">
          <label className="btn btn-secondary" style={{ cursor: importing ? 'not-allowed' : 'pointer' }}>
            <Upload size={16} /> {importing ? 'Reading file…' : 'Import from File'}
            <input type="file" accept=".csv,.xls,.xlsx,.pdf,image/*" hidden disabled={importing} onChange={handleImportFile} />
          </label>
          <button className="btn btn-primary" onClick={openPurchaseModal}><Plus size={16} /> Record Purchase</button>
        </div>
      </div>

      {feedback && <div className="alert alert-success mb-4" role="status">{feedback}</div>}
      {importError && <div className="alert alert-danger mb-4" role="alert">{importError}</div>}

      <div className="kpi-grid">
        <div className="kpi-card" style={{ '--kpi-color': 'var(--chart-amber)', '--kpi-color-bg': 'var(--amber-tint)' } as React.CSSProperties}>
          <div className="flex justify-between items-center">
            <span className="kpi-label">Total Purchased</span>
            <div className="kpi-icon-wrap"><Receipt size={18} /></div>
          </div>
          <div className="kpi-value">₹{wholeMoney(totalPurchased)}</div>
          <span className="kpi-context">
            {purchaseOrders.length === 0
              ? 'No purchases recorded yet'
              : `Across ${purchaseOrders.length} ${purchaseOrders.length === 1 ? 'order' : 'orders'} on file${dateRangeLabel ? ` · ${dateRangeLabel}` : ''}`}
          </span>
        </div>

        <div className="kpi-card" style={{ '--kpi-color': 'var(--chart-red)', '--kpi-color-bg': 'var(--rose-tint)' } as React.CSSProperties}>
          <div className="flex justify-between items-center">
            <span className="kpi-label">Payable</span>
            <div className="kpi-icon-wrap"><Wallet size={18} /></div>
          </div>
          <div className="kpi-value">₹{wholeMoney(payable)}</div>
          {purchaseOrders.length > 0 && (
            <div className={`kpi-change ${payable > 0 ? 'negative' : 'positive'}`}>
              {payable > 0 ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
              <span>{payable > 0 ? 'Owed to suppliers' : 'All settled'}</span>
            </div>
          )}
          <span className="kpi-context">
            {purchaseOrders.length === 0
              ? 'Nothing owed — no purchase orders on file'
              : payable > 0
                ? `Still owing on ${unpaidOrders.length} of ${purchaseOrders.length} ${purchaseOrders.length === 1 ? 'order' : 'orders'}`
                : `₹${wholeMoney(totalPaidToSuppliers)} paid across every order on file`}
          </span>
        </div>

        <div className="kpi-card" style={{ '--kpi-color': 'var(--chart-amber)', '--kpi-color-bg': 'var(--amber-tint)' } as React.CSSProperties}>
          <div className="flex justify-between items-center">
            <span className="kpi-label">Awaiting Delivery</span>
            <div className="kpi-icon-wrap"><Truck size={18} /></div>
          </div>
          <div className="kpi-value">{pendingOrders.length}</div>
          {purchaseOrders.length > 0 && (
            <div className={`kpi-change${overdueOrders.length > 0 ? ' negative' : pendingOrders.length === 0 ? ' positive' : ''}`}>
              {overdueOrders.length > 0 ? <AlertTriangle size={14} /> : pendingOrders.length === 0 ? <CheckCircle2 size={14} /> : <Clock size={14} />}
              <span>
                {overdueOrders.length > 0
                  ? `${overdueOrders.length} past the expected date`
                  : pendingOrders.length === 0 ? 'All received' : 'Not yet marked received'}
              </span>
            </div>
          )}
          <span className="kpi-context">
            {purchaseOrders.length === 0
              ? 'No purchase orders on file yet'
              : pendingOrders.length > 0
                ? `₹${wholeMoney(pendingValue)} of orders not yet marked received`
                : 'Every order on file has been received into stock'}
          </span>
        </div>

        <div className="kpi-card" style={{ '--kpi-color': 'var(--chart-blue)', '--kpi-color-bg': 'var(--color-info-bg)' } as React.CSSProperties}>
          <div className="flex justify-between items-center">
            <span className="kpi-label">Suppliers Bought From</span>
            <div className="kpi-icon-wrap"><Building2 size={18} /></div>
          </div>
          <div className="kpi-value">{supplierNames.size}</div>
          <span className="kpi-context">
            {topSupplier
              ? `Most spend: ${topSupplier[0]} · ₹${wholeMoney(topSupplier[1])}`
              : suppliers.length > 0
                ? `${suppliers.length} in the supplier directory, none purchased from yet`
                : 'No suppliers on file yet'}
          </span>
        </div>
      </div>

      {pendingOrders.length > 0 && (
        <div className="alert alert-warning mb-4" role="status">
          <Truck size={16} style={{ flex: 'none' }} />
          <span>{awaitingSentence}</span>
          <button
            type="button"
            className="alert-action"
            onClick={() => { setActiveTab('purchases'); setOrderFilter('awaiting'); setPage(1); }}
          >
            Show awaiting <ArrowRight size={14} />
          </button>
        </div>
      )}

      <div className="flex justify-between items-center gap-3 mb-6">
        <div className="tabs">
          <button className={`tab ${activeTab === 'purchases' ? 'active' : ''}`} onClick={() => setActiveTab('purchases')}>
            Purchases<span className="tab-count">{purchaseOrders.length}</span>
          </button>
          <button className={`tab ${activeTab === 'invoices' ? 'active' : ''}`} onClick={() => setActiveTab('invoices')}>Supplier Invoices</button>
        </div>
        {dateRangeLabel && <span className="pager-info">Records on file: <strong>{dateRangeLabel}</strong></span>}
      </div>

      {activeTab === 'purchases' && <div className="table-wrap">
        <div className="tbl-toolbar">
          <div className="tbl-toolbar-title">
            <strong>{activeOrderTab.title}</strong>
            <small>Balance is what is still owed to the supplier on that order</small>
          </div>

          <div className="tabs" role="group" aria-label="Filter purchase orders">
            {orderTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                aria-pressed={orderFilter === tab.key}
                className={`tab${orderFilter === tab.key ? ' active' : ''}`}
                onClick={() => { setOrderFilter(tab.key); setPage(1); }}
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
                placeholder="Search by purchase #, supplier or date..."
                value={orderSearch}
                onChange={(event) => { setOrderSearch(event.target.value); setPage(1); }}
              />
            </div>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
        <table className="erp-table">
          <thead><tr><th>Purchase #</th><th>Supplier</th><th>Date</th><th className="text-right">Items</th><th className="text-right">Total (₹)</th><th className="text-right">Paid (₹)</th><th className="text-right">Balance (₹)</th><th>Payment</th><th>Status</th><th className="text-center">Actions</th></tr></thead>
          <tbody>{pagedOrders.map((po) => {
            const balance = Number(po.total) - Number(po.paid);
            const paymentBadge = Number(po.paid) >= Number(po.total) ? 'badge-success' : Number(po.paid) > 0 ? 'badge-warning' : 'badge-danger';
            const paymentLabel = Number(po.paid) >= Number(po.total) ? 'PAID' : Number(po.paid) > 0 ? 'PARTIAL' : 'UNPAID';
            // Share of this order that has actually been paid. An order with no total has no
            // meaningful share, so it gets the figure alone and no bar.
            const paidPercent = Number(po.total) > 0
              ? Math.max(0, Math.min(100, Math.round((Number(po.paid) / Number(po.total)) * 100)))
              : null;
            return <tr key={po.id}>
              <td><span className="pn-chip">{po.id}</span></td>
              <td style={{ fontWeight: 600 }}>{po.supplier}</td>
              <td className="text-muted">{formatDay(po.date)}</td>
              <td className="text-right">{po.items}</td>
              <td className="text-right font-semibold">₹{money(po.total)}</td>
              <td>
                <div className="qty-cell">
                  <strong className="text-success">₹{money(po.paid)}</strong>
                  {paidPercent !== null && (
                    <div className={`meter${paidPercent === 0 ? ' meter--out' : paidPercent < 100 ? ' meter--low' : ''}`} aria-hidden="true">
                      <i style={{ width: `${paidPercent}%` }} />
                    </div>
                  )}
                </div>
              </td>
              <td className={`text-right ${balance > 0 ? 'text-danger font-semibold' : 'text-muted'}`}>₹{money(balance)}</td>
              <td><span className={`badge ${paymentBadge}`}>{paymentLabel}</span></td>
              <td>
                <span className={`badge ${po.status === 'received' ? 'badge-success' : 'badge-warning'}`}>
                  {po.status === 'received' ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                  {po.status.toUpperCase()}
                </span>
              </td>
              <td className="text-center">{po.status !== 'received'
                ? <button className="btn btn-secondary btn-sm" onClick={() => markReceived(po.id)}><PackageCheck size={14} /> Mark Received</button>
                : <span className="text-muted">—</span>}</td>
            </tr>;
          })}
          {pagedOrders.length === 0 && (
            <tr><td colSpan={10}><div className="empty-state"><div className="empty-state-icon"><Receipt size={22} /></div><p className="empty-state-title">{poLoading ? 'Loading purchases…' : purchaseOrders.length === 0 ? 'No purchases yet' : 'No purchases match this view'}</p><p className="empty-state-desc">{poLoading ? 'Fetching records for the active company.' : purchaseOrders.length === 0 ? 'Record your first purchase to get started.' : 'Try another search term or filter tab.'}</p></div></td></tr>
          )}
          </tbody>
          {pagedOrders.length > 0 && (
            <tfoot>
              <tr style={{ background: 'var(--panel)', borderTop: '1px solid var(--line-2)' }}>
                <td colSpan={3} className="text-muted">Total on this page</td>
                <td className="text-right font-semibold">{pageItems}</td>
                <td className="text-right font-semibold">₹{money(pageTotal)}</td>
                <td className="text-right font-semibold text-success">₹{money(pagePaid)}</td>
                <td className={`text-right font-semibold ${pageTotal - pagePaid > 0 ? 'text-danger' : 'text-muted'}`}>₹{money(pageTotal - pagePaid)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
        </div>

        {visibleOrders.length > 0 && (
          <div className="pager">
            <div className="pager-info">
              Showing <strong>{pageStart + 1}–{pageStart + pagedOrders.length}</strong> of <strong>{visibleOrders.length}</strong> {visibleOrders.length === 1 ? 'order' : 'orders'}
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
      </div>}

      {activeTab === 'invoices' && <div className="card empty-state"><div className="empty-state-icon"><FileCheck size={22} /></div><p className="empty-state-title">Supplier invoice matching isn&apos;t available yet</p><p className="empty-state-desc">This will let you upload supplier invoices and match them against purchases — not built yet.</p></div>}

      {importPreview && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '640px' }} role="dialog" aria-modal="true" aria-labelledby="import-preview-title">
        <div className="modal-header"><h3 id="import-preview-title" className="modal-title">Record Purchase from File</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" disabled={confirmingImport} onClick={() => setImportPreview(null)}>✕</button></div>
        <div className="modal-body flex flex-col gap-4">
          {importError && <div className="alert alert-danger" role="alert">{importError}</div>}

          <div className="flex items-center gap-3">
            <div className="kpi-icon-wrap" style={{ '--kpi-color': 'var(--chart-amber)', '--kpi-color-bg': 'var(--amber-tint)' } as React.CSSProperties}><FileText size={18} /></div>
            <div>
              <strong style={{ fontSize: '13.5px' }}>{importPreview.fileName}</strong>
              <p className="text-muted" style={{ fontSize: '12px' }}>
                Read <strong>{importPreview.lines.length} item(s)</strong>, total ₹{money(importedPreviewTotal)}
              </p>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Supplier</label>
            <input list="purchase-supplier-options" className="form-input" placeholder="Type or select a supplier" value={importPreview.supplier} onChange={(event) => setImportPreview({ ...importPreview, supplier: event.target.value })} />
            <datalist id="purchase-supplier-options">{supplierOptions.map((s) => <option key={s} value={s} />)}</datalist>
            {importPreview.supplierGstin.trim() && (
              <small style={{ color: 'var(--text-muted)' }}>
                GSTIN read from document: {importPreview.supplierGstin.trim()} — saved against this supplier if it&apos;s a new one.
              </small>
            )}
          </div>

          {/* Exactly what was read out of the file — nothing added, nothing rounded away — so it
              can be checked before it becomes stock and a supplier balance. */}
          <div className="table-wrap">
            <div style={{ overflowX: 'auto', maxHeight: '240px', overflowY: 'auto' }}>
              <table className="erp-table">
                <thead><tr><th>Line item</th><th className="text-right">Qty</th><th className="text-right">Rate (₹)</th><th className="text-right">Amount (₹)</th></tr></thead>
                <tbody>
                  {importPreview.lines.map((line, index) => (
                    <tr key={index}>
                      <td>{line.description}</td>
                      <td className="text-right">{line.quantity}</td>
                      <td className="text-right">₹{money(line.unit_price)}</td>
                      <td className="text-right font-semibold">₹{money(line.quantity * line.unit_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <div className="pager-info"><strong>{importPreview.lines.length}</strong> {importPreview.lines.length === 1 ? 'line item' : 'line items'}</div>
              <div className="pager-info">Total <strong>₹{money(importedPreviewTotal)}</strong></div>
            </div>
          </div>

          <p className="text-muted" style={{ fontSize: '12px' }}>Anything here that isn&apos;t already in Inventory is added as a new part when you record this purchase.</p>
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-secondary" disabled={confirmingImport} onClick={() => setImportPreview(null)}>Cancel</button><button type="button" className="btn btn-primary" onClick={confirmImportedPO} disabled={!importPreview.supplier.trim() || confirmingImport}>{confirmingImport ? 'Saving…' : 'Record Purchase'}</button></div>
      </div></div>}

      {showPurchaseModal && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '880px' }} role="dialog" aria-modal="true" aria-labelledby="purchase-modal-title"><form onSubmit={recordPurchase}>
        <div className="modal-header"><h3 id="purchase-modal-title" className="modal-title">Record Purchase</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setShowPurchaseModal(false)}>✕</button></div>
        <div className="modal-body flex flex-col gap-4">
          {purchaseError && <div className="alert alert-danger" role="alert">{purchaseError}</div>}
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Supplier *</label>
              <input list="purchase-supplier-options" className="form-input" required placeholder="Type or select a supplier" value={supplierName} onChange={(event) => setSupplierName(event.target.value)} />
              <datalist id="purchase-supplier-options">{supplierOptions.map((s) => <option key={s} value={s} />)}</datalist>
            </div>
            <div className="form-group"><label className="form-label">Date</label><input type="date" className="form-input" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} /></div>
          </div>

          <datalist id="po-part-options">
            {partOptions.map((option) => <option key={option.value} value={option.value} />)}
          </datalist>

          <div className="table-wrap">
            <div className="tbl-toolbar">
              <div className="tbl-toolbar-title">
                <strong>Item details</strong>
                <small>Anything not already in Inventory is added as a new part when this is saved</small>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="erp-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="text-center">Quantity</th>
                    <th className="text-right">Unit Cost (₹)</th>
                    <th className="text-right">Amount (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => {
                    const matched = partOptions.find((option) => option.value === line.description);
                    return (
                      <tr key={index}>
                        <td style={{ minWidth: '260px' }}>
                          <input list="po-part-options" className="form-input" placeholder="Type a new part name or select an existing one" value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} />
                          {matched
                            ? <small className="text-muted" style={{ display: 'block', marginTop: '4px' }}>Stock: {matched.stock}{matched.category ? ` · ${matched.category}` : ''}</small>
                            : line.description.trim()
                              ? <small className="text-muted" style={{ display: 'block', marginTop: '4px' }}>New part — will be added to Inventory</small>
                              : null}
                        </td>
                        <td>
                          {/* Both steppers write through updateLine, exactly like typing in the box
                              does — the field stays the single source of the quantity. */}
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              className="btn btn-secondary btn-icon"
                              aria-label={`Decrease quantity for line ${index + 1}`}
                              disabled={Number(line.quantity) <= 1}
                              onClick={() => updateLine(index, { quantity: Math.max(1, Number(line.quantity) - 1) })}
                            >
                              <Minus size={14} />
                            </button>
                            <input type="number" min="1" className="form-input text-center" style={{ width: '64px' }} value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} />
                            <button
                              type="button"
                              className="btn btn-secondary btn-icon"
                              aria-label={`Increase quantity for line ${index + 1}`}
                              onClick={() => updateLine(index, { quantity: Number(line.quantity) + 1 })}
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        </td>
                        <td><input type="number" min="0" className="form-input text-right" value={line.unit_price} onChange={(event) => updateLine(index, { unit_price: Number(event.target.value) })} /></td>
                        <td className="text-right font-semibold">₹{money(line.quantity * line.unit_price)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="pager">
              <div className="pager-info"><strong>{lines.length}</strong> {lines.length === 1 ? 'line item' : 'line items'}</div>
              <div className="flex gap-2 items-center">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLines((current) => [...current, { description: '', quantity: 1, unit_price: 0 }])}><Plus size={14} /> Add Item Row</button>
                {lines.length > 1 && <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)' }} onClick={() => setLines((current) => current.slice(0, -1))}>Remove Last Row</button>}
              </div>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Payment to Supplier</label>
              <select className="form-input form-select" value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value as PaymentStatus)}>
                <option value="paid">Paid in Full</option>
                <option value="partial">Partially Paid</option>
                <option value="unpaid">Unpaid (Credit)</option>
              </select>
            </div>
            {paymentStatus === 'partial' && (
              <div className="form-group"><label className="form-label">Amount Paid (₹)</label><input type="number" min="0" max={total} className="form-input" value={amountPaid} onChange={(event) => setAmountPaid(Number(event.target.value))} /></div>
            )}
          </div>

          <div className="flex justify-between items-center invoice-summary">
            <div><span className="text-muted">Line Items: </span><strong>{lines.length}</strong></div>
            <div><span className="text-muted">Paid: </span><strong className="text-success">₹{money(paidAmount)}</strong></div>
            <div><span className="text-muted">Balance: </span><strong className={total - paidAmount > 0 ? 'text-danger' : 'text-muted'}>₹{money(total - paidAmount)}</strong></div>
            <div><strong>Total: </strong><span className="invoice-total">₹{money(total)}</span></div>
          </div>
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setShowPurchaseModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={!total || !supplierName.trim() || savingPurchase}>{savingPurchase ? 'Saving…' : 'Save Purchase'}</button></div>
      </form></div></div>}
    </div>
  );
}
