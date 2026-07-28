'use client';

import { ChangeEvent, FormEvent, useState } from 'react';
import { Plus, FileCheck, Upload } from 'lucide-react';
import { parseSpreadsheetFile, fileToBase64, SPREADSHEET_EXTENSIONS, SCANNABLE_TYPES, type ImportedLine } from '@/lib/client-import';
import { useCompanyTable } from '@/lib/useCompanyTable';

type PurchaseTab = 'purchases' | 'invoices';
type PaymentStatus = 'paid' | 'partial' | 'unpaid';
type POLine = { description: string; quantity: number; unit_price: number };

type Product = { id: string; company_id: string; part_number: string; name: string; category: string; cost_price: number; current_stock: number };
type Supplier = { id: string; company_id: string; name: string; balance: number };
type PurchaseOrder = { id: string; company_id: string; supplier: string; date: string; expected: string; items: number; total: number; paid: number; status: string };
type Grn = { id: string; company_id: string; po_number: string; supplier: string; received_at: string; status: string };
type PoItem = { id: string; po_id: string; product_id: string | null; part_number: string; name: string; qty: number; unit_cost: number };

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

function nextId(rows: Array<{ id: string }>, prefix: string) {
  const maxNum = rows.reduce((max, row) => {
    const match = row.id.match(/(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 1000);
  return `${prefix}-${maxNum + 1}`;
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
  const { rows: products, adjust: adjustProduct } = useCompanyTable<Product>('products');
  const { rows: suppliers, create: createSupplier, adjust: adjustSupplier } = useCompanyTable<Supplier>('suppliers');
  const { rows: purchaseOrders, loading: poLoading, create: createPurchaseOrder, update: updatePurchaseOrder } = useCompanyTable<PurchaseOrder>('purchase_orders');
  const { rows: grns, create: createGrn } = useCompanyTable<Grn>('grns');
  const { rows: poItems, create: createPoItem } = useCompanyTable<PoItem>('po_items');

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
  const [supplierName, setSupplierName] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(todayIso());
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('unpaid');
  const [amountPaid, setAmountPaid] = useState(0);
  const [lines, setLines] = useState<POLine[]>([]);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importPreview, setImportPreview] = useState<{ fileName: string; lines: ImportedLine[]; supplier: string } | null>(null);

  const total = lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);
  const paidAmount = paymentStatus === 'paid' ? total : paymentStatus === 'partial' ? Math.min(Math.max(amountPaid, 0), total) : 0;

  const openPurchaseModal = () => {
    setSupplierName('');
    setPurchaseDate(todayIso());
    setPaymentStatus('unpaid');
    setAmountPaid(0);
    setLines(partOptions.length > 0 ? [{ description: partOptions[0].value, quantity: 1, unit_price: partOptions[0].price }] : []);
    setImportError('');
    setShowPurchaseModal(true);
  };

  const updateLine = (index: number, patch: Partial<POLine>) => {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  async function resolveSupplier(name: string): Promise<Supplier> {
    const existing = suppliers.find((s) => s.name.toLowerCase() === name.trim().toLowerCase());
    if (existing) return existing;
    return createSupplier({ name: name.trim(), category: '', phone: '', email: '', gstin: '', terms: 30, balance: 0 }) as Promise<Supplier>;
  }

  async function receiveStock(poId: string, supplierName: string, items: Array<{ product_id: string | null; qty: number }>) {
    const grnId = nextId(grns, 'GRN');
    await createGrn({ id: grnId, po_number: poId, supplier: supplierName, received_at: new Date().toLocaleString('en-IN'), status: 'verified' });

    for (const item of items) {
      if (!item.product_id) continue;
      await adjustProduct(item.product_id, Number(item.qty));
    }
  }

  const recordPurchase = async (event: FormEvent) => {
    event.preventDefault();
    const supplierRow = await resolveSupplier(supplierName);
    const id = nextId(purchaseOrders, 'PO');
    const paid = paidAmount;

    await createPurchaseOrder({ id, supplier: supplierRow.name, date: purchaseDate, items: lines.length, total, paid, status: 'received' });

    const lineItems = [];
    for (const line of lines) {
      const matchedProduct = products.find((p) => `${p.part_number} - ${p.name}` === line.description);
      await createPoItem({
        po_id: id,
        product_id: matchedProduct?.id ?? null,
        part_number: matchedProduct?.part_number ?? '',
        name: matchedProduct?.name ?? line.description,
        qty: line.quantity,
        unit_cost: line.unit_price,
        line_total: line.quantity * line.unit_price,
      });
      lineItems.push({ product_id: matchedProduct?.id ?? null, qty: line.quantity });
    }

    await receiveStock(id, supplierRow.name, lineItems);

    // Newly created purchase — its amount has never been counted anywhere before, so it's safe to add to payables.
    const due = total - paid;
    if (due > 0) {
      await adjustSupplier(supplierRow.id, due);
    }

    setShowPurchaseModal(false);
    setFeedback(`${id} recorded — ${lines.length} item(s) added to stock from ${supplierRow.name}.`);
    setActiveTab('purchases');
  };

  const markReceived = async (poId: string) => {
    const order = purchaseOrders.find((po) => po.id === poId);
    if (!order) return;
    await updatePurchaseOrder(poId, { status: 'received' });
    // This is a pre-existing pending order created before per-purchase stock tracking existed — its
    // amount is presumed already reflected in the supplier's balance, so only stock catches up here.
    await receiveStock(
      poId,
      order.supplier,
      poItems.filter((item) => item.po_id === poId).map((item) => ({ product_id: item.product_id, qty: item.qty }))
    );
    setFeedback(`${poId} marked received and added to stock.`);
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
        setImportPreview({ fileName: file.name, lines: imported, supplier: guessSupplierFromText(file.name) ?? '' });
      } else if (isScannableFile(file)) {
        const base64 = await fileToBase64(file);
        const res = await fetch('/api/purchases/import-scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64, mimeType: file.type }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to scan document.');

        const items: ImportedLine[] = Array.isArray(data.items) ? data.items : [];
        if (items.length === 0) {
          throw new Error('No line items could be read from this document.');
        }
        setImportPreview({ fileName: file.name, lines: items, supplier: guessSupplierFromText(data.supplier_name) ?? '' });
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
    if (!importPreview || !importPreview.supplier.trim()) return;
    const supplierRow = await resolveSupplier(importPreview.supplier);
    const importedTotal = importPreview.lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);
    const id = nextId(purchaseOrders, 'PO');
    await createPurchaseOrder({ id, supplier: supplierRow.name, date: todayIso(), items: importPreview.lines.length, total: importedTotal, paid: 0, status: 'received' });

    const lineItems = [];
    for (const line of importPreview.lines) {
      const matchedProduct = products.find((p) => `${p.part_number} - ${p.name}` === line.description);
      await createPoItem({
        po_id: id,
        product_id: matchedProduct?.id ?? null,
        part_number: matchedProduct?.part_number ?? '',
        name: matchedProduct?.name ?? line.description,
        qty: line.quantity,
        unit_cost: line.unit_price,
        line_total: line.quantity * line.unit_price,
      });
      lineItems.push({ product_id: matchedProduct?.id ?? null, qty: line.quantity });
    }

    await receiveStock(id, supplierRow.name, lineItems);
    if (importedTotal > 0) {
      await adjustSupplier(supplierRow.id, importedTotal);
    }

    setFeedback(`${id} recorded from ${importPreview.fileName} — ${importPreview.lines.length} item(s), ₹${importedTotal.toLocaleString()} from ${supplierRow.name}.`);
    setImportPreview(null);
    setActiveTab('purchases');
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
            <td className="text-center">{po.status !== 'received' && <button className="btn btn-secondary btn-sm" onClick={() => markReceived(po.id)}>Mark Received</button>}</td>
          </tr>;
        })}
        {purchaseOrders.length === 0 && (
          <tr><td colSpan={10}><div className="empty-state"><p className="empty-state-title">{poLoading ? 'Loading purchases…' : 'No purchases yet'}</p><p className="empty-state-desc">{poLoading ? 'Fetching records for the active company.' : 'Record your first purchase to get started.'}</p></div></td></tr>
        )}
        </tbody>
      </table></div>}

      {activeTab === 'invoices' && <div className="card empty-state"><FileCheck size={32} /><p className="empty-state-title">No unmatched supplier invoices</p><p className="empty-state-desc">Invoices will appear here when uploaded or received against a purchase.</p></div>}

      {importPreview && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '480px' }} role="dialog" aria-modal="true" aria-labelledby="import-preview-title">
        <div className="modal-header"><h3 id="import-preview-title" className="modal-title">Record Purchase from File</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setImportPreview(null)}>✕</button></div>
        <div className="modal-body flex flex-col gap-4">
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Read <strong>{importPreview.lines.length} item(s)</strong> from <strong>{importPreview.fileName}</strong>, total ₹{importPreview.lines.reduce((s, l) => s + l.quantity * l.unit_price, 0).toLocaleString()}.
          </p>
          <div className="form-group">
            <label className="form-label">Supplier</label>
            <input list="purchase-supplier-options" className="form-input" placeholder="Type or select a supplier" value={importPreview.supplier} onChange={(event) => setImportPreview({ ...importPreview, supplier: event.target.value })} />
            <datalist id="purchase-supplier-options">{supplierOptions.map((s) => <option key={s} value={s} />)}</datalist>
          </div>
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setImportPreview(null)}>Cancel</button><button type="button" className="btn btn-primary" onClick={confirmImportedPO} disabled={!importPreview.supplier.trim()}>Record Purchase</button></div>
      </div></div>}

      {showPurchaseModal && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '880px' }} role="dialog" aria-modal="true" aria-labelledby="purchase-modal-title"><form onSubmit={recordPurchase}>
        <div className="modal-header"><h3 id="purchase-modal-title" className="modal-title">Record Purchase</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setShowPurchaseModal(false)}>✕</button></div>
        <div className="modal-body flex flex-col gap-4">
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
                    <input list="po-part-options" className="form-input" value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} />
                    {matched && <small style={{ color: 'var(--text-muted)' }}>Stock: {matched.stock}</small>}
                  </div>
                  <div className="form-group"><label className="form-label">Category</label><input type="text" className="form-input" value={matched?.category ?? '-'} disabled /></div>
                  <div className="form-group"><label className="form-label">Quantity</label><input type="number" min="1" className="form-input" value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} /></div>
                  <div className="form-group"><label className="form-label">Unit Cost (₹)</label><input type="number" min="0" className="form-input" value={line.unit_price} onChange={(event) => updateLine(index, { unit_price: Number(event.target.value) })} /></div>
                </div>
              );
            })}

            <div className="flex justify-between items-center mt-2">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLines((current) => [...current, { description: partOptions[0]?.value ?? '', quantity: 1, unit_price: partOptions[0]?.price ?? 0 }])}>+ Add Item Row</button>
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
        <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setShowPurchaseModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={!total || !supplierName.trim()}>Save Purchase</button></div>
      </form></div></div>}
    </div>
  );
}
