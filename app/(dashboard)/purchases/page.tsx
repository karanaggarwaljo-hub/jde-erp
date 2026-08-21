'use client';

import { ChangeEvent, FormEvent, useState } from 'react';
import { Plus, FileCheck, Upload, Undo2 } from 'lucide-react';
import { parseSpreadsheetFile, fileToBase64, hashFile, SPREADSHEET_EXTENSIONS, SCANNABLE_TYPES, type ImportedLine } from '@/lib/client-import';
import { savePurchase, receivePurchaseStock } from '@/lib/client-purchases';
import { getReturnablePurchaseItems, recordPurchaseReturn } from '@/lib/client-purchase-returns';
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

type ImportLineReview = {
  matchedProduct: Product | null;
  warnings: string[];
  costDifferencePercent: number | null;
};

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

function normalizeImportText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/**
 * Only use exact, explainable matches for imports. A fuzzy match that silently attaches a
 * supplier's "Seal kit" to the wrong inventory part is much more costly than showing the owner
 * one extra review warning. The selected datalist format ("PART-1 - Part name") is supported too.
 */
function matchImportedProduct(description: string, products: Product[]): Product | null {
  const trimmed = description.trim();
  const normalized = normalizeImportText(trimmed);
  if (!normalized) return null;

  return products.find((product) => {
    const partNumber = product.part_number.trim();
    const partNumberPrefix = partNumber
      ? new RegExp(`^${partNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s*[-:|]\\s*|\\s*$)`, 'i')
      : null;
    return normalized === normalizeImportText(product.name)
      || normalized === normalizeImportText(`${partNumber} - ${product.name}`)
      || normalized === normalizeImportText(partNumber)
      || Boolean(partNumberPrefix?.test(trimmed));
  }) ?? null;
}

function reviewImportedLines(lines: ImportedLine[], products: Product[]): ImportLineReview[] {
  const descriptionCounts = new Map<string, number>();
  for (const line of lines) {
    const key = normalizeImportText(line.description);
    if (key) descriptionCounts.set(key, (descriptionCounts.get(key) ?? 0) + 1);
  }

  return lines.map((line) => {
    const matchedProduct = matchImportedProduct(line.description, products);
    const warnings: string[] = [];
    const descriptionKey = normalizeImportText(line.description);
    let costDifferencePercent: number | null = null;

    if (!line.description.trim()) warnings.push('Missing item description');
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) warnings.push('Quantity must be greater than zero');
    if (!Number.isFinite(line.unit_price) || line.unit_price <= 0) warnings.push('Unit cost must be greater than zero');
    if (descriptionKey && (descriptionCounts.get(descriptionKey) ?? 0) > 1) warnings.push('This item appears more than once in this import');

    if (!matchedProduct) {
      if (line.description.trim()) warnings.push('No exact inventory match — a new part will be created');
    } else if (matchedProduct.cost_price > 0 && line.unit_price > 0) {
      costDifferencePercent = ((line.unit_price - matchedProduct.cost_price) / matchedProduct.cost_price) * 100;
      if (Math.abs(costDifferencePercent) >= 5) {
        warnings.push(`Cost is ${Math.abs(costDifferencePercent).toFixed(0)}% ${costDifferencePercent > 0 ? 'higher' : 'lower'} than previous cost (₹${Number(matchedProduct.cost_price).toLocaleString()})`);
      }
    } else if (matchedProduct.cost_price <= 0 && line.unit_price > 0) {
      warnings.push('Matched part has no previous cost to compare');
    }

    return { matchedProduct, warnings, costDifferencePercent };
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
  const [supplierName, setSupplierName] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(todayIso());
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('unpaid');
  const [amountPaid, setAmountPaid] = useState(0);
  const [lines, setLines] = useState<POLine[]>([]);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importPreview, setImportPreview] = useState<{ fileName: string; lines: ImportedLine[]; supplier: string; supplierGstin: string; fileHash: string | null } | null>(null);
  const [confirmingImport, setConfirmingImport] = useState(false);
  const [returningOrder, setReturningOrder] = useState<PurchaseOrder | null>(null);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [returnNote, setReturnNote] = useState('');
  const [returnError, setReturnError] = useState('');
  const [savingReturn, setSavingReturn] = useState(false);
  const [returnableQtyByPoItemId, setReturnableQtyByPoItemId] = useState<Record<string, number> | null>(null);
  const [loadingReturnAvailability, setLoadingReturnAvailability] = useState(false);

  const total = lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);
  const paidAmount = paymentStatus === 'paid' ? total : paymentStatus === 'partial' ? Math.min(Math.max(amountPaid, 0), total) : 0;
  const importReviews = importPreview ? reviewImportedLines(importPreview.lines, products) : [];
  const importWarningCount = importReviews.reduce((count, review) => count + review.warnings.length, 0);
  const importNewPartCount = importReviews.filter((review) => !review.matchedProduct).length;
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

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Purchases</h1><p className="page-subtitle">Record what you bought — stock and what you owe the supplier update immediately</p></div>
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

      <div className="tabs mb-6">
        <button className={`tab ${activeTab === 'purchases' ? 'active' : ''}`} onClick={() => setActiveTab('purchases')}>Purchases ({purchaseOrders.length})</button>
        <button className={`tab ${activeTab === 'invoices' ? 'active' : ''}`} onClick={() => setActiveTab('invoices')}>Supplier Invoices</button>
      </div>

      {activeTab === 'purchases' && <div className="table-wrap"><table className="erp-table">
        <thead><tr><th>Purchase #</th><th>Supplier</th><th>Date</th><th>Items</th><th className="text-right">Total (₹)</th><th className="text-right">Paid (₹)</th><th className="text-right">Balance (₹)</th><th>Payment</th><th>Status</th><th className="text-center">Actions</th></tr></thead>
        <tbody>{purchaseOrders.map((po) => {
          const balance = Number(po.total) - Number(po.paid);
          const paymentBadge = Number(po.paid) >= Number(po.total) ? 'badge-success' : Number(po.paid) > 0 ? 'badge-warning' : 'badge-danger';
          const paymentLabel = Number(po.paid) >= Number(po.total) ? 'PAID' : Number(po.paid) > 0 ? 'PARTIAL' : 'UNPAID';
          return <tr key={po.id}>
            <td style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>{po.id}</td><td style={{ fontWeight: 600 }}>{po.supplier}</td><td className="text-muted">{po.date}</td><td>{po.items} Items</td>
            <td className="text-right font-semibold">₹{Number(po.total).toLocaleString()}</td><td className="text-right text-success">₹{Number(po.paid).toLocaleString()}</td><td className="text-right text-danger">₹{balance.toLocaleString()}</td>
            <td><span className={`badge ${paymentBadge}`}>{paymentLabel}</span></td>
            <td><span className={`badge ${po.status === 'received' ? 'badge-success' : 'badge-warning'}`}>{po.status.toUpperCase()}</span></td>
            <td className="text-center">
              {po.status !== 'received'
                ? <button className="btn btn-secondary btn-sm" onClick={() => markReceived(po.id)}>Mark Received</button>
                : <button className="btn btn-secondary btn-sm" onClick={() => openReturnModal(po)} title="Return some or all received items to this supplier"><Undo2 size={14} /> Return Items</button>}
            </td>
          </tr>;
        })}
        {purchaseOrders.length === 0 && (
          <tr><td colSpan={10}><div className="empty-state"><p className="empty-state-title">{poLoading ? 'Loading purchases…' : 'No purchases yet'}</p><p className="empty-state-desc">{poLoading ? 'Fetching records for the active company.' : 'Record your first purchase to get started.'}</p></div></td></tr>
        )}
        </tbody>
      </table></div>}

      {activeTab === 'invoices' && <div className="card empty-state"><FileCheck size={32} /><p className="empty-state-title">Supplier invoice matching isn&apos;t available yet</p><p className="empty-state-desc">This will let you upload supplier invoices and match them against purchases — not built yet.</p></div>}

      {returningOrder && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '820px' }} role="dialog" aria-modal="true" aria-labelledby="purchase-return-title">
        <div className="modal-header"><h3 id="purchase-return-title" className="modal-title">Return items to {returningOrder.supplier}</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" disabled={savingReturn} onClick={() => setReturningOrder(null)}>✕</button></div>
        <div className="modal-body flex flex-col gap-4">
          {returnError && <div className="alert alert-danger" role="alert">{returnError}</div>}
          <div className="card card-sm bg-surface" style={{ padding: '12px' }}>
            <p style={{ fontSize: '13px', margin: 0 }}><strong>{returningOrder.id}</strong> · received {returningOrder.date} · original total ₹{Number(returningOrder.total).toLocaleString()}</p>
            <p className="text-muted" style={{ fontSize: '12px', margin: '6px 0 0' }}>{loadingReturnAvailability ? 'Checking what is still available from this purchase…' : 'Only enter items actually sent back. Saving reduces stock and the supplier payable together. If this purchase was already paid, the lower payable becomes supplier credit.'}</p>
          </div>
          <div className="table-wrap">
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
        <div className="modal-header"><h3 id="import-preview-title" className="modal-title">Record Purchase from File</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" disabled={confirmingImport} onClick={() => setImportPreview(null)}>✕</button></div>
        <div className="modal-body flex flex-col gap-4">
          {importError && <div className="alert alert-danger" role="alert">{importError}</div>}
          <div className="card card-sm bg-surface" style={{ padding: '12px' }}>
            <div className="flex justify-between items-center" style={{ gap: '12px', flexWrap: 'wrap' }}>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
                Read <strong>{importPreview.lines.length} item(s)</strong> from <strong>{importPreview.fileName}</strong>, total <strong>₹{importPreview.lines.reduce((s, l) => s + l.quantity * l.unit_price, 0).toLocaleString()}</strong>.
              </p>
              <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                <span className="badge badge-success">{importPreview.lines.length - importNewPartCount} matched</span>
                {importNewPartCount > 0 && <span className="badge badge-warning">{importNewPartCount} new part{importNewPartCount === 1 ? '' : 's'}</span>}
                {importPriceChangeCount > 0 && <span className="badge badge-warning">{importPriceChangeCount} price check{importPriceChangeCount === 1 ? '' : 's'}</span>}
                {importWarningCount > 0 && <span className="badge badge-danger">{importWarningCount} review warning{importWarningCount === 1 ? '' : 's'}</span>}
              </div>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '8px 0 0' }}>
              Exact matches are attached to existing inventory. Unmatched rows create a new part when saved; review those carefully before continuing.
            </p>
          </div>
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
          <div>
            <div className="flex justify-between items-center" style={{ marginBottom: '8px', gap: '12px' }}>
              <h4 style={{ fontSize: '13px', fontWeight: 600, margin: 0 }}>Review imported items</h4>
              <span className="text-muted" style={{ fontSize: '12px' }}>Edit a row to correct it before saving</span>
            </div>
            <datalist id="import-part-options">{partOptions.map((option) => <option key={option.value} value={option.value} />)}</datalist>
            <div className="table-wrap" style={{ maxHeight: '330px', overflowY: 'auto' }}>
              <table className="erp-table">
                <thead><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Unit cost</th><th>Inventory match / review</th></tr></thead>
                <tbody>{importPreview.lines.map((line, index) => {
                  const review = importReviews[index];
                  const isInvalid = !line.description.trim() || line.quantity <= 0 || line.unit_price <= 0;
                  return <tr key={index} style={isInvalid ? { background: 'var(--color-danger-bg)' } : undefined}>
                    <td style={{ minWidth: '220px' }}><input list="import-part-options" className="form-input" aria-label={`Item ${index + 1}`} value={line.description} disabled={confirmingImport} onChange={(event) => updateImportedLine(index, { description: event.target.value })} /></td>
                    <td style={{ minWidth: '82px' }}><input type="number" min="1" className="form-input text-right" aria-label={`Quantity for item ${index + 1}`} value={line.quantity} disabled={confirmingImport} onChange={(event) => updateImportedLine(index, { quantity: Number(event.target.value) })} /></td>
                    <td style={{ minWidth: '118px' }}><input type="number" min="0.01" step="0.01" className="form-input text-right" aria-label={`Unit cost for item ${index + 1}`} value={line.unit_price} disabled={confirmingImport} onChange={(event) => updateImportedLine(index, { unit_price: Number(event.target.value) })} /></td>
                    <td style={{ minWidth: '260px' }}>
                      {review?.matchedProduct ? <div><span className="badge badge-success">Matched</span> <strong style={{ fontSize: '12px' }}>{review.matchedProduct.part_number}</strong><div className="text-muted" style={{ fontSize: '12px', marginTop: '3px' }}>{review.matchedProduct.name}</div></div> : <span className="badge badge-warning">New part</span>}
                      {review?.warnings.map((warning) => <div key={warning} className={warning.includes('must be') ? 'text-danger' : 'text-warning'} style={{ fontSize: '12px', marginTop: '4px' }}>{warning}</div>)}
                    </td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          </div>
          {importHasInvalidLine && <div className="alert alert-danger" role="alert">Fix the red rows before recording this purchase.</div>}
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-secondary" disabled={confirmingImport} onClick={() => setImportPreview(null)}>Cancel</button><button type="button" className="btn btn-primary" onClick={confirmImportedPO} disabled={!importPreview.supplier.trim() || importHasInvalidLine || confirmingImport}>{confirmingImport ? 'Saving…' : `Record Purchase${importWarningCount > 0 ? ' After Review' : ''}`}</button></div>
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

          <div className="card card-sm bg-surface">
            <h4 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>Item Details</h4>

            <datalist id="po-part-options">
              {partOptions.map((option) => <option key={option.value} value={option.value} />)}
            </datalist>

            {lines.map((line, index) => {
              const matched = partOptions.find((option) => option.value === line.description);
              return (
                <div key={index} className="form-grid-4 mb-2">
                  <div className="form-group">
                    <label className="form-label">Product</label>
                    <input list="po-part-options" className="form-input" placeholder="Type a new part name or select an existing one" value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} />
                    {matched
                      ? <small style={{ color: 'var(--text-muted)' }}>Stock: {matched.stock}</small>
                      : line.description.trim() && <small style={{ color: 'var(--text-muted)' }}>New part — will be added to Inventory</small>}
                  </div>
                  <div className="form-group"><label className="form-label">Category</label><input type="text" className="form-input" value={matched?.category ?? '-'} disabled /></div>
                  <div className="form-group"><label className="form-label">Quantity</label><input type="number" min="1" className="form-input" value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} /></div>
                  <div className="form-group"><label className="form-label">Unit Cost (₹)</label><input type="number" min="0" className="form-input" value={line.unit_price} onChange={(event) => updateLine(index, { unit_price: Number(event.target.value) })} /></div>
                </div>
              );
            })}

            <div className="flex justify-between items-center mt-2">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLines((current) => [...current, { description: '', quantity: 1, unit_price: 0 }])}>+ Add Item Row</button>
              {lines.length > 1 && <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)' }} onClick={() => setLines((current) => current.slice(0, -1))}>Remove Last Row</button>}
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
            <div><span className="text-muted">Paid: </span><strong className="text-success">₹{paidAmount.toLocaleString()}</strong></div>
            <div><strong>Total: </strong><span className="invoice-total">₹{total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
          </div>
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setShowPurchaseModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={!total || !supplierName.trim() || savingPurchase}>{savingPurchase ? 'Saving…' : 'Save Purchase'}</button></div>
      </form></div></div>}
    </div>
  );
}
