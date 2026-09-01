'use client';

import { ChangeEvent, FormEvent, useState } from 'react';
import {
  Plus,
  Minus,
  FileCheck,
  FileText,
  Upload,
  Undo2,
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
import { parseSpreadsheetFile, fileToBase64, hashFile, SPREADSHEET_ACCEPT, isSpreadsheetFileName, SCANNABLE_TYPES, type ImportedLine } from '@/lib/client-import';
import { matchImportedLine, normalizeImportText, planFieldUpdates, type LineMatch, type MatchableProduct } from '@/lib/import-matching';
import { savePurchase, receivePurchaseStock } from '@/lib/client-purchases';
import { getReturnablePurchaseItems, recordPurchaseReturn } from '@/lib/client-purchase-returns';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import { resizeImageForUpload, DOCUMENT_SCAN_DIMENSION } from '@/lib/imageResize';

type PurchaseTab = 'purchases' | 'invoices';
type PaymentStatus = 'paid' | 'partial' | 'unpaid';
type POLine = { description: string; quantity: number; unit_price: number };

type Product = { id: string; company_id: string; part_number: string; oem_number: string; hsn_code: string; brand: string; name: string; category: string; cost_price: number; current_stock: number };
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

/** The value stored in the link map when the owner has looked at a suggestion and rejected it —
 *  distinct from "not yet decided", which is what an absent entry means. */
const NEW_PART = 'new';

type ImportLineReview = {
  match: LineMatch;
  /** The part this line will actually be recorded against — after any owner decision. */
  matchedProduct: MatchableProduct | null;
  /** True while a suggested match is still waiting on Link / Keep separate. */
  needsDecision: boolean;
  warnings: string[];
  /** Fields where the invoice disagrees with data already on the part. Reported, never applied. */
  conflicts: string[];
  /** Blank fields on the existing part that this invoice will fill in. */
  fills: string[];
  costDifferencePercent: number | null;
};

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

function isSpreadsheetFile(file: File) {
  return isSpreadsheetFileName(file.name);
}

function isScannableFile(file: File) {
  return SCANNABLE_TYPES.includes(file.type);
}

function cleanedGuess(text: string): string {
  return text.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
}

function reviewImportedLines(lines: ImportedLine[], products: Product[], links: Record<number, string>): ImportLineReview[] {
  const descriptionCounts = new Map<string, number>();
  for (const line of lines) {
    const key = normalizeImportText(line.description);
    if (key) descriptionCounts.set(key, (descriptionCounts.get(key) ?? 0) + 1);
  }

  return lines.map((line, index) => {
    const match = matchImportedLine(line, products);

    // An owner decision always wins over what the matcher guessed — including the decision to
    // keep a suggested line separate and create a new part after all.
    const decision = links[index];
    const decided = decision === NEW_PART ? null : decision ? products.find((product) => product.id === decision) ?? null : undefined;
    const matchedProduct = decided !== undefined ? decided : match.kind === 'exact' ? match.product : null;
    const needsDecision = match.kind === 'suggested' && decision === undefined;

    const warnings: string[] = [];
    const descriptionKey = normalizeImportText(line.description);
    let costDifferencePercent: number | null = null;

    if (!line.description.trim()) warnings.push('Missing item description');
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) warnings.push('Quantity must be greater than zero');
    if (!Number.isFinite(line.unit_price) || line.unit_price <= 0) warnings.push('Unit cost must be greater than zero');
    if (descriptionKey && (descriptionCounts.get(descriptionKey) ?? 0) > 1) warnings.push('This item appears more than once in this import');

    if (!matchedProduct) {
      if (line.description.trim() && !needsDecision) warnings.push('No inventory match — a new part will be created');
    } else if (matchedProduct.cost_price > 0 && line.unit_price > 0) {
      costDifferencePercent = ((line.unit_price - matchedProduct.cost_price) / matchedProduct.cost_price) * 100;
      if (Math.abs(costDifferencePercent) >= 5) {
        warnings.push(`Cost is ${Math.abs(costDifferencePercent).toFixed(0)}% ${costDifferencePercent > 0 ? 'higher' : 'lower'} than previous cost (₹${Number(matchedProduct.cost_price).toLocaleString()})`);
      }
    }

    const plan = matchedProduct ? planFieldUpdates(line, matchedProduct) : null;

    return { match, matchedProduct, needsDecision, warnings, conflicts: plan?.conflicts ?? [], fills: plan?.filled ?? [], costDifferencePercent };
  });
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
  // Which PO's "Mark Received" is currently in flight — guards against a double-click opening
  // two FIFO stock batches for the same purchase order. Only the clicked order's own button
  // needs to disable, so this is one id rather than a page-wide saving flag.
  const [receivingPoId, setReceivingPoId] = useState<string | null>(null);
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
  // Line index -> the part the owner linked it to, or NEW_PART for "keep this separate".
  // Only suggested (not exact) matches ever need an entry here.
  const [importLinks, setImportLinks] = useState<Record<number, string>>({});
  const [returningOrder, setReturningOrder] = useState<PurchaseOrder | null>(null);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [returnNote, setReturnNote] = useState('');
  const [returnError, setReturnError] = useState('');
  const [savingReturn, setSavingReturn] = useState(false);
  const [returnableQtyByPoItemId, setReturnableQtyByPoItemId] = useState<Record<string, number> | null>(null);
  const [loadingReturnAvailability, setLoadingReturnAvailability] = useState(false);

  const total = lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);
  const paidAmount = paymentStatus === 'paid' ? total : paymentStatus === 'partial' ? Math.min(Math.max(amountPaid, 0), total) : 0;
  const importReviews = importPreview ? reviewImportedLines(importPreview.lines, products, importLinks) : [];
  const importWarningCount = importReviews.reduce((count, review) => count + review.warnings.length + review.conflicts.length, 0);
  const importNewPartCount = importReviews.filter((review) => !review.matchedProduct && !review.needsDecision).length;
  const importUndecidedCount = importReviews.filter((review) => review.needsDecision).length;
  const importFillCount = importReviews.reduce((count, review) => count + review.fills.length, 0);
  const importPriceChangeCount = importReviews.filter((review) => review.costDifferencePercent !== null && Math.abs(review.costDifferencePercent) >= 5).length;
  const importHasInvalidLine = importPreview?.lines.some((line) => !line.description.trim() || !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.unit_price) || line.unit_price <= 0) ?? false;
  const returnableItems = returningOrder ? poItems.filter((item) => item.po_id === returningOrder.id) : [];
  const selectedReturnLines = returnableItems
    .map((item) => ({ item, qty: Number(returnQuantities[item.id] ?? 0) }))
    .filter(({ qty }) => Number.isFinite(qty) && qty > 0);
  const returnTotal = selectedReturnLines.reduce((sum, { item, qty }) => sum + qty * Number(item.unit_cost), 0);
  const hasInvalidReturnQuantity = selectedReturnLines.some(({ item, qty }) => qty > Number(returnableQtyByPoItemId?.[item.id] ?? 0));

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

  const openReturnModal = async (order: PurchaseOrder) => {
    const originalLines = poItems.filter((item) => item.po_id === order.id);
    setReturningOrder(order);
    setReturnQuantities(Object.fromEntries(originalLines.map((item) => [item.id, 0])));
    setReturnNote('');
    setReturnError(originalLines.length === 0 ? 'No item lines are available for this purchase, so it cannot be returned safely.' : '');
    setReturnableQtyByPoItemId(null);
    if (!activeCompany || originalLines.length === 0) return;
    setLoadingReturnAvailability(true);
    try {
      const availability = await getReturnablePurchaseItems(activeCompany.id, order.id);
      setReturnableQtyByPoItemId(Object.fromEntries(availability.map((line) => [line.po_item_id, Number(line.returnable_qty)])));
    } catch (error) {
      setReturnError(error instanceof Error ? error.message : 'Could not check return availability. Nothing can be returned until this is resolved.');
    } finally {
      setLoadingReturnAvailability(false);
    }
  };

  const updateReturnQuantity = (poItemId: string, value: string) => {
    const qty = value === '' ? 0 : Number(value);
    setReturnQuantities((current) => ({ ...current, [poItemId]: qty }));
  };

  const submitPurchaseReturn = async () => {
    if (!returningOrder || !activeCompany) return;
    if (selectedReturnLines.length === 0) {
      setReturnError('Choose a quantity to return for at least one item.');
      return;
    }
    if (hasInvalidReturnQuantity) {
      setReturnError('A return quantity cannot exceed the quantity still available from this purchase.');
      return;
    }
    const supplier = suppliers.find((row) => row.name.trim().toLowerCase() === returningOrder.supplier.trim().toLowerCase());
    if (!supplier) {
      setReturnError(`Cannot find ${returningOrder.supplier} in the supplier directory. Add or correct the supplier before returning stock.`);
      return;
    }
    if (!window.confirm(`Record this supplier return for ₹${returnTotal.toLocaleString()}? Inventory will decrease and the supplier payable will decrease in the same transaction.`)) return;

    setReturnError('');
    setSavingReturn(true);
    try {
      const result = await recordPurchaseReturn({
        companyId: activeCompany.id,
        poId: returningOrder.id,
        supplierId: supplier.id,
        lines: selectedReturnLines.map(({ item, qty }) => ({ poItemId: item.id, qty })),
        note: returnNote,
      });
      await Promise.all([reloadPurchaseOrders(), reloadPoItems(), reloadGrns(), reloadSuppliers(), reloadProducts()]);
      const returnNumber = typeof result.return_number === 'string' ? ` (${result.return_number})` : '';
      setFeedback(`${returningOrder.id}: supplier return of ₹${returnTotal.toLocaleString()} recorded${returnNumber}. Stock and supplier balance were updated together.`);
      setReturningOrder(null);
    } catch (error) {
      setReturnError(error instanceof Error ? error.message : 'Could not record this supplier return. Nothing was changed.');
    } finally {
      setSavingReturn(false);
    }
  };

  const updateLine = (index: number, patch: Partial<POLine>) => {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const updateImportedLine = (index: number, patch: Partial<ImportedLine>) => {
    setImportPreview((current) => current
      ? { ...current, lines: current.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)) }
      : null);
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
  async function resolveProduct(description: string, unitCost: number, knownProducts: Product[], splitOnDash = true, source?: ImportedLine): Promise<Product | null> {
    const trimmed = description.trim();
    if (!trimmed) return null;
    const existing = knownProducts.find((p) => `${p.part_number} - ${p.name}` === trimmed);
    if (existing) return existing;

    const separatorIndex = splitOnDash ? trimmed.indexOf(' - ') : -1;
    // A part number printed on the document beats both the " - " convention and the SP-### stand-in:
    // it is the real code, and recording it now is what lets the next invoice recognise this part.
    const documentPartNumber = (source?.part_number ?? '').trim();
    const partNumber = documentPartNumber
      || (separatorIndex > 0 ? trimmed.slice(0, separatorIndex).trim() : `SP-${String(knownProducts.length + 1).padStart(3, '0')}`);
    const name = separatorIndex > 0 && !documentPartNumber ? trimmed.slice(separatorIndex + 3).trim() : trimmed;

    const res = await fetch('/api/local/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        part_number: partNumber,
        oem_number: (source?.oem_number ?? '').trim(),
        hsn_code: (source?.hsn_code ?? '').trim(),
        name: name || trimmed,
        brand: (source?.brand ?? '').trim(),
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
    if (!order || !activeCompany || receivingPoId) return;
    setFeedback('');
    setImportError('');
    setReceivingPoId(poId);
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
    } finally {
      setReceivingPoId(null);
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
    setImportLinks({});
    setImporting(true);
    try {
      if (isSpreadsheetFile(file)) {
        const imported = await parseSpreadsheetFile(file);
        if (imported.length === 0) {
          throw new Error('No rows with a recognizable description, quantity, or price column were found in this file.');
        }
        setImportPreview({ fileName: file.name, lines: imported, supplier: guessSupplierFromText(file.name) ?? '', supplierGstin: '', fileHash: null });
      } else if (isScannableFile(file)) {
        // Content-based, not filename-based, so the exact same invoice can't be scanned or
        // recorded twice even under a renamed/re-saved copy — checked server-side before this
        // spends an AI call, and again (as a hard guarantee) when the purchase is actually saved.
        // Hashed from the ORIGINAL file, before any resizing, so the identity of the document
        // does not change just because the browser shrank the copy it uploads.
        const fileHash = await hashFile(file);

        // A photo straight off a phone is 3-10MB, which becomes 4-13MB once base64-encoded into
        // this JSON body — past the platform's ~4.5MB request ceiling. Such a request is rejected
        // before it ever reaches the ERP, which is why this failed with nothing in the server
        // logs to explain it. Shrinking it in the browser is the only fix available; the limit is
        // not ours to raise. Confirmed against production: a 1MB body is accepted, a 6MB one is
        // refused outright.
        let base64: string;
        let mimeType: string;
        if (file.type === 'application/pdf') {
          // A PDF can't be redrawn through a canvas the way an image can, so there is nothing to
          // shrink — say so plainly instead of letting it fail with an unexplained error.
          if (file.size > 4_000_000) {
            throw new Error(
              'This PDF is too large to scan (over 4MB). Save or export it at a smaller size, or take a photo of the invoice and scan that instead.'
            );
          }
          base64 = await fileToBase64(file);
          mimeType = file.type;
        } else {
          ({ base64, mimeType } = await resizeImageForUpload(file, { maxDimension: DOCUMENT_SCAN_DIMENSION }));
        }

        const res = await fetch('/api/purchases/import-scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64, mimeType, fileHash, companyId: activeCompany?.id }),
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
    if (importHasInvalidLine) {
      setImportError('Fix every highlighted row before recording: each item needs a description, quantity, and unit cost greater than zero.');
      return;
    }
    setConfirmingImport(true);
    try {
      const supplierRow = await resolveSupplier(importPreview.supplier, importPreview.supplierGstin);
      const importedTotal = importPreview.lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);

      const knownProducts = [...products];
      const items = [];
      // Field updates are collected here and applied only after the purchase itself is safely
      // recorded — enriching a part for a purchase that then failed to save would be a lie.
      const enrichments: { product: MatchableProduct; fills: Record<string, string | number> }[] = [];

      for (const [index, line] of importPreview.lines.entries()) {
        if (!line.description.trim()) continue;

        // Whatever the review screen concluded — an identifier match, the owner's own Link
        // decision, or nothing — is what gets recorded. Only genuinely unmatched lines create a
        // new part, and that new part now carries the document's real identifiers.
        const review = importReviews[index];
        const matchedProduct = review?.matchedProduct
          // false: this description is raw AI-scanned invoice text, not a manually-typed
          // "part number - name" pair — see resolveProduct's own comment for why that matters.
          ?? await resolveProduct(line.description, line.unit_price, knownProducts, false, line);

        if (review?.matchedProduct) {
          const plan = planFieldUpdates(line, review.matchedProduct);
          if (Object.keys(plan.fills).length) enrichments.push({ product: review.matchedProduct, fills: plan.fills });
        }

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

      // The purchase is now safely recorded, so fill in what this document taught us about parts
      // already on file. Deliberately not fatal: a part that keeps a blank brand is a cosmetic
      // loss, and undoing a recorded purchase over one would be far worse. Failures are counted
      // and reported rather than thrown.
      let enriched = 0;
      let enrichFailures = 0;
      for (const { product, fills } of enrichments) {
        try {
          const res = await fetch(`/api/local/products/${product.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fills),
          });
          if (!res.ok) throw new Error(String(res.status));
          enriched += 1;
        } catch (error) {
          enrichFailures += 1;
          console.error(`Could not fill in details for part ${product.part_number}:`, error);
        }
      }

      await Promise.all([reloadPurchaseOrders(), reloadPoItems(), reloadGrns(), reloadSuppliers(), reloadProducts()]);

      const enrichedNote = enriched > 0 ? ` Filled in missing details on ${enriched} existing part${enriched === 1 ? '' : 's'}.` : '';
      const failureNote = enrichFailures > 0 ? ` ${enrichFailures} part${enrichFailures === 1 ? '' : 's'} could not be updated — check them in Inventory.` : '';
      setFeedback(`${po.id} recorded from ${importPreview.fileName} — ${items.length} item(s), ₹${importedTotal.toLocaleString()} from ${supplierRow.name}.${enrichedNote}${failureNote}`);
      setImportPreview(null);
      setImportLinks({});
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
            <input type="file" accept={`${SPREADSHEET_ACCEPT},.pdf,image/*`} hidden disabled={importing} onChange={handleImportFile} />
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
                ? <button className="btn btn-secondary btn-sm" disabled={receivingPoId === po.id} onClick={() => markReceived(po.id)}><PackageCheck size={14} /> {receivingPoId === po.id ? 'Marking…' : 'Mark Received'}</button>
                : <button className="btn btn-secondary btn-sm" onClick={() => openReturnModal(po)} title="Return some or all received items to this supplier"><Undo2 size={14} /> Return Items</button>}</td>
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

      {returningOrder && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '820px' }} role="dialog" aria-modal="true" aria-labelledby="purchase-return-title">
        <div className="modal-header"><h3 id="purchase-return-title" className="modal-title">Return items to {returningOrder.supplier}</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" disabled={savingReturn} onClick={() => setReturningOrder(null)}>✕</button></div>
        <div className="modal-body flex flex-col gap-4">
          {returnError && <div className="alert alert-danger" role="alert">{returnError}</div>}
          <div className="card card-sm bg-surface" style={{ padding: '12px' }}>
            <p style={{ fontSize: '13px', margin: 0 }}><strong>{returningOrder.id}</strong> · received {formatDay(returningOrder.date)} · original total ₹{Number(returningOrder.total).toLocaleString()}</p>
            <p className="text-muted" style={{ fontSize: '12px', margin: '6px 0 0' }}>{loadingReturnAvailability ? 'Checking what is still available from this purchase…' : 'Only enter items actually sent back. Saving reduces stock and the supplier payable together. If this purchase was already paid, the lower payable becomes supplier credit.'}</p>
          </div>
          <div className="table-wrap">
            <div className="tbl-toolbar">
              <div className="tbl-toolbar-title">
                <strong>Items on {returningOrder.id}</strong>
                <small>Available is what is still left to send back from this purchase</small>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="erp-table">
                <thead><tr><th>Item</th><th>Part #</th><th className="text-right">Purchased</th><th className="text-right">Available</th><th className="text-right">Unit cost</th><th style={{ minWidth: '150px' }} className="text-right">Return now</th></tr></thead>
                <tbody>{returnableItems.map((item) => {
                  const selected = Number(returnQuantities[item.id] ?? 0);
                  const availableQty = Number(returnableQtyByPoItemId?.[item.id] ?? 0);
                  const invalid = selected > availableQty || selected < 0 || !Number.isFinite(selected);
                  return <tr key={item.id} style={invalid ? { background: 'var(--color-danger-bg)' } : undefined}>
                    <td style={{ fontWeight: 600 }}>{item.name}</td><td className="text-muted">{item.part_number || '—'}</td><td className="text-right">{Number(item.qty)}</td><td className="text-right">{returnableQtyByPoItemId === null ? '—' : availableQty}</td><td className="text-right">₹{Number(item.unit_cost).toLocaleString()}</td>
                    <td><input type="number" min="0" max={availableQty} step="0.01" className="form-input text-right" aria-label={`Return quantity for ${item.name}`} value={returnQuantities[item.id] ?? 0} disabled={savingReturn || returnableQtyByPoItemId === null} onChange={(event) => updateReturnQuantity(item.id, event.target.value)} /></td>
                  </tr>;
                })}
                {returnableItems.length === 0 && <tr><td colSpan={6}><div className="empty-state"><p className="empty-state-title">No returnable item lines found</p><p className="empty-state-desc">This older purchase has no linked PO lines, so it cannot be safely returned.</p></div></td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Reason / supplier reference <span className="text-muted">(optional)</span></label>
            <textarea className="form-input" rows={3} maxLength={1000} placeholder="Example: damaged seal kit, supplier RMA 123" value={returnNote} disabled={savingReturn} onChange={(event) => setReturnNote(event.target.value)} />
          </div>
          <div className="flex justify-between items-center invoice-summary">
            <span className="text-muted">{selectedReturnLines.length} selected line{selectedReturnLines.length === 1 ? '' : 's'}</span>
            <div><strong>Supplier return total: </strong><span className="invoice-total">₹{returnTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
          </div>
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-secondary" disabled={savingReturn} onClick={() => setReturningOrder(null)}>Cancel</button><button type="button" className="btn btn-primary" disabled={savingReturn || loadingReturnAvailability || returnableQtyByPoItemId === null || selectedReturnLines.length === 0 || hasInvalidReturnQuantity || returnableItems.length === 0} onClick={submitPurchaseReturn}>{savingReturn ? 'Recording…' : loadingReturnAvailability ? 'Checking stock…' : 'Review & Record Return'}</button></div>
      </div></div>}

      {importPreview && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '880px' }} role="dialog" aria-modal="true" aria-labelledby="import-preview-title">
        <div className="modal-header"><h3 id="import-preview-title" className="modal-title">Record Purchase from File</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" disabled={confirmingImport} onClick={() => { setImportPreview(null); setImportLinks({}); }}>✕</button></div>
        <div className="modal-body flex flex-col gap-4">
          {importError && <div className="alert alert-danger" role="alert">{importError}</div>}

          <div className="flex justify-between items-center gap-3" style={{ flexWrap: 'wrap' }}>
            <div className="flex items-center gap-3">
              <div className="kpi-icon-wrap" style={{ '--kpi-color': 'var(--chart-amber)', '--kpi-color-bg': 'var(--amber-tint)' } as React.CSSProperties}><FileText size={18} /></div>
              <div>
                <strong style={{ fontSize: '13.5px' }}>{importPreview.fileName}</strong>
                <p className="text-muted" style={{ fontSize: '12px' }}>
                  Read <strong>{importPreview.lines.length} item(s)</strong>, total ₹{money(importedPreviewTotal)}
                </p>
              </div>
            </div>
            <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
              <span className="badge badge-success">{importPreview.lines.length - importNewPartCount} matched</span>
              {importNewPartCount > 0 && <span className="badge badge-warning">{importNewPartCount} new part{importNewPartCount === 1 ? '' : 's'}</span>}
              {importPriceChangeCount > 0 && <span className="badge badge-warning">{importPriceChangeCount} price check{importPriceChangeCount === 1 ? '' : 's'}</span>}
              {importWarningCount > 0 && <span className="badge badge-danger">{importWarningCount} review warning{importWarningCount === 1 ? '' : 's'}</span>}
            </div>
          </div>

          <p className="text-muted" style={{ fontSize: '12px' }}>
            Exact matches are attached to existing inventory. Unmatched rows create a new part when saved; review those carefully before continuing.
          </p>
          <div className="form-group">
            <label className="form-label">Supplier</label>
            <input list="purchase-supplier-options" className="form-input" placeholder="Type or select a supplier" value={importPreview.supplier} onChange={(event) => setImportPreview({ ...importPreview, supplier: event.target.value })} />
            <datalist id="purchase-supplier-options">{supplierOptions.map((s) => <option key={s} value={s} />)}</datalist>
            {importPreview.supplier.trim() && !suppliers.some((supplier) => supplier.name.toLowerCase() === importPreview.supplier.trim().toLowerCase()) && (
              <small className="text-warning">New supplier — this name will be created when you record the purchase.</small>
            )}
            {importPreview.supplierGstin.trim() && (
              <small style={{ color: 'var(--text-muted)' }}>
                GSTIN read from document: {importPreview.supplierGstin.trim()} — saved against this supplier if it&apos;s a new one.
              </small>
            )}
          </div>

          {/* Exactly what was read out of the file — nothing added, nothing rounded away — so it
              can be checked, and corrected, before it becomes stock and a supplier balance. */}
          <datalist id="import-part-options">{partOptions.map((option) => <option key={option.value} value={option.value} />)}</datalist>

          <div className="table-wrap">
            <div className="tbl-toolbar">
              <div className="tbl-toolbar-title">
                <strong>Review imported items</strong>
                <small>Edit a row to correct it before saving — a red row must be fixed first</small>
              </div>
            </div>

            <div style={{ overflowX: 'auto', maxHeight: '330px', overflowY: 'auto' }}>
              <table className="erp-table">
                <thead><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Unit cost (₹)</th><th className="text-right">Amount (₹)</th><th>Inventory match / review</th></tr></thead>
                <tbody>{importPreview.lines.map((line, index) => {
                  const review = importReviews[index];
                  const suggestion = review?.match.kind === 'suggested' ? review.match.product : null;
                  const isInvalid = !line.description.trim() || line.quantity <= 0 || line.unit_price <= 0;
                  return <tr key={index} style={isInvalid ? { background: 'var(--color-danger-bg)' } : undefined}>
                    <td style={{ minWidth: '220px' }}><input list="import-part-options" className="form-input" aria-label={`Item ${index + 1}`} value={line.description} disabled={confirmingImport} onChange={(event) => updateImportedLine(index, { description: event.target.value })} /></td>
                    <td style={{ minWidth: '82px' }}><input type="number" min="1" className="form-input text-right" aria-label={`Quantity for item ${index + 1}`} value={line.quantity} disabled={confirmingImport} onChange={(event) => updateImportedLine(index, { quantity: Number(event.target.value) })} /></td>
                    <td style={{ minWidth: '118px' }}><input type="number" min="0.01" step="0.01" className="form-input text-right" aria-label={`Unit cost for item ${index + 1}`} value={line.unit_price} disabled={confirmingImport} onChange={(event) => updateImportedLine(index, { unit_price: Number(event.target.value) })} /></td>
                    <td className="text-right font-semibold">₹{money(line.quantity * line.unit_price)}</td>
                    <td style={{ minWidth: '300px' }}>
                      {review?.needsDecision && review.match.kind === 'suggested' ? (
                        // Deliberately unresolved until the owner says so: the names only look
                        // alike, and guessing wrong puts this stock on the wrong part.
                        <div>
                          <span className="badge badge-warning">Same part?</span>
                          <div style={{ fontSize: '12px', marginTop: '3px' }}>
                            <strong>{review.match.product.part_number}</strong> — {review.match.product.name}
                            <div className="text-muted">Already in stock: {review.match.product.current_stock} · {review.match.reason}</div>
                          </div>
                          <div style={{ display: 'flex', gap: '6px', marginTop: '5px' }}>
                            <button type="button" className="btn btn-sm btn-primary" disabled={confirmingImport}
                              onClick={() => setImportLinks((current) => ({ ...current, [index]: suggestion?.id ?? NEW_PART }))}>
                              Same part
                            </button>
                            <button type="button" className="btn btn-sm btn-secondary" disabled={confirmingImport}
                              onClick={() => setImportLinks((current) => ({ ...current, [index]: NEW_PART }))}>
                              Different part
                            </button>
                          </div>
                        </div>
                      ) : review?.matchedProduct ? (
                        <div>
                          <span className="badge badge-success">{importLinks[index] ? 'Linked by you' : 'Matched'}</span>{' '}
                          <strong style={{ fontSize: '12px' }}>{review.matchedProduct.part_number}</strong>
                          <div className="text-muted" style={{ fontSize: '12px', marginTop: '3px' }}>
                            {review.matchedProduct.name}
                            {review.match.kind === 'exact' && !importLinks[index] ? ` · ${review.match.reason}` : ''}
                          </div>
                          {importLinks[index] && importLinks[index] !== NEW_PART && (
                            <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '0', fontSize: '11px' }} disabled={confirmingImport}
                              onClick={() => setImportLinks((current) => ({ ...current, [index]: NEW_PART }))}>
                              Undo — make it a new part
                            </button>
                          )}
                        </div>
                      ) : <span className="badge badge-warning">New part</span>}
                      {review && review.fills.length > 0 && (
                        <div className="text-success" style={{ fontSize: '12px', marginTop: '4px' }}>
                          Will fill in from this invoice: {review.fills.join(', ')}
                        </div>
                      )}
                      {review?.conflicts.map((conflict) => <div key={conflict} className="text-warning" style={{ fontSize: '12px', marginTop: '4px' }}>{conflict}</div>)}
                      {review?.warnings.map((warning) => <div key={warning} className={warning.includes('must be') ? 'text-danger' : 'text-warning'} style={{ fontSize: '12px', marginTop: '4px' }}>{warning}</div>)}
                    </td>
                  </tr>;
                })}</tbody>
              </table>
            </div>

            <div className="pager">
              <div className="pager-info"><strong>{importPreview.lines.length}</strong> {importPreview.lines.length === 1 ? 'line item' : 'line items'}</div>
              <div className="pager-info">Total <strong>₹{money(importedPreviewTotal)}</strong></div>
            </div>
          </div>

          {importHasInvalidLine && <div className="alert alert-danger" role="alert">Fix the red rows before recording this purchase.</div>}
          {importUndecidedCount > 0 && (
            <div className="alert alert-warning" role="alert">
              {importUndecidedCount === 1 ? 'One item looks' : `${importUndecidedCount} items look`} like {importUndecidedCount === 1 ? 'a part' : 'parts'} you already stock under a different name.
              Choose <strong>Same part</strong> or <strong>Different part</strong> for each — otherwise a duplicate part gets created.
            </div>
          )}

          <p className="text-muted" style={{ fontSize: '12px' }}>
            Anything here that isn&apos;t already in Inventory is added as a new part when you record this purchase.
            {importFillCount > 0 && ' Blank details on parts you already stock will be filled in from this invoice; anything you entered yourself is left alone.'}
          </p>
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-secondary" disabled={confirmingImport} onClick={() => { setImportPreview(null); setImportLinks({}); }}>Cancel</button><button type="button" className="btn btn-primary" onClick={confirmImportedPO} disabled={!importPreview.supplier.trim() || importHasInvalidLine || importUndecidedCount > 0 || confirmingImport}>{confirmingImport ? 'Saving…' : `Record Purchase${importWarningCount > 0 ? ' After Review' : ''}`}</button></div>
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
