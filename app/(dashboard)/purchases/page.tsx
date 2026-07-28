'use client';

import { ChangeEvent, FormEvent, useState } from 'react';
import { Plus, FileCheck, Upload } from 'lucide-react';
import { parseSpreadsheetFile, fileToBase64, SPREADSHEET_EXTENSIONS, SCANNABLE_TYPES, type ImportedLine } from '@/lib/client-import';
import { useCompanyTable } from '@/lib/useCompanyTable';

type PurchaseTab = 'po' | 'grn' | 'invoices';
type POLine = { description: string; quantity: number; unit_price: number };

type Product = { id: string; company_id: string; part_number: string; name: string; category: string; cost_price: number; current_stock: number };
type Supplier = { id: string; company_id: string; name: string; balance: number };
type PurchaseOrder = { id: string; company_id: string; supplier: string; date: string; expected: string; items: number; total: number; paid: number; status: string };
type Grn = { id: string; company_id: string; po_number: string; supplier: string; received_at: string; status: string };
type PoItem = { id: string; po_id: string; product_id: string | null; part_number: string; name: string; qty: number; unit_cost: number };

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

function daysFromNowIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
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

export default function PurchasesPage() {
  const { rows: products, update: updateProduct } = useCompanyTable<Product>('products');
  const { rows: suppliers, update: updateSupplier } = useCompanyTable<Supplier>('suppliers');
  const { rows: purchaseOrders, loading: poLoading, create: createPurchaseOrder, update: updatePurchaseOrder } = useCompanyTable<PurchaseOrder>('purchase_orders');
  const { rows: grns, loading: grnLoading, create: createGrn } = useCompanyTable<Grn>('grns');
  const { rows: poItems, create: createPoItem } = useCompanyTable<PoItem>('po_items');

  const partOptions = products.map((product) => ({
    value: `${product.part_number} - ${product.name}`,
    price: product.cost_price,
    category: product.category,
  }));
  const supplierOptions = suppliers.map((s) => s.name);

  const [activeTab, setActiveTab] = useState<PurchaseTab>('po');
  const [showPOModal, setShowPOModal] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [supplier, setSupplier] = useState('');
  const [poDate, setPoDate] = useState(todayIso());
  const [expectedDate, setExpectedDate] = useState(todayIso());
  const [lines, setLines] = useState<POLine[]>([]);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importPreview, setImportPreview] = useState<{ fileName: string; lines: ImportedLine[]; supplier: string; supplierGuessed: boolean } | null>(null);

  const total = lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);

  const openPOModal = () => {
    setSupplier(supplierOptions[0] ?? '');
    setPoDate(todayIso());
    setExpectedDate(todayIso());
    setLines(partOptions.length > 0 ? [{ description: partOptions[0].value, quantity: 1, unit_price: partOptions[0].price }] : []);
    setImportError('');
    setShowPOModal(true);
  };

  const updateLine = (index: number, patch: Partial<POLine>) => {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const createPO = async (event: FormEvent) => {
    event.preventDefault();
    const id = nextId(purchaseOrders, 'PO');
    await createPurchaseOrder({ id, supplier, date: poDate, expected: expectedDate, items: lines.length, total, paid: 0, status: 'sent' });

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
    }

    setShowPOModal(false);
    setFeedback(`${id} sent to ${supplier} for ${lines.length} line item(s).`);
    setActiveTab('po');
  };

  const recordGrn = async (poId: string) => {
    const order = purchaseOrders.find((po) => po.id === poId);
    if (!order) return;
    const grnId = nextId(grns, 'GRN');
    await updatePurchaseOrder(poId, { status: 'received' });
    await createGrn({ id: grnId, po_number: poId, supplier: order.supplier, received_at: new Date().toLocaleString('en-IN'), status: 'verified' });

    for (const item of poItems.filter((poItem) => poItem.po_id === poId)) {
      if (!item.product_id) continue;
      const product = products.find((p) => p.id === item.product_id);
      if (product) {
        await updateProduct(product.id, { current_stock: Number(product.current_stock) + Number(item.qty) });
      }
    }

    const matchedSupplier = suppliers.find((s) => s.name === order.supplier);
    if (matchedSupplier) {
      await updateSupplier(matchedSupplier.id, { balance: Number(matchedSupplier.balance) + Number(order.total) });
    }

    setFeedback(`${grnId} recorded and ${poId} marked received.`);
  };

  const guessSupplierFromText = (text: string | undefined | null): string | undefined => {
    if (!text) return undefined;
    const guess = text.toLowerCase();
    return supplierOptions.find((s) => s.toLowerCase().includes(guess) || guess.includes(s.toLowerCase()));
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
        const guessed = guessSupplierFromText(file.name);
        setImportPreview({ fileName: file.name, lines: imported, supplier: guessed ?? supplierOptions[0] ?? '', supplierGuessed: Boolean(guessed) });
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
        const guessed = guessSupplierFromText(data.supplier_name);
        setImportPreview({ fileName: file.name, lines: items, supplier: guessed ?? supplierOptions[0] ?? '', supplierGuessed: Boolean(guessed) });
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
    if (!importPreview) return;
    const importedTotal = importPreview.lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);
    const id = nextId(purchaseOrders, 'PO');
    await createPurchaseOrder({
      id,
      supplier: importPreview.supplier,
      date: todayIso(),
      expected: daysFromNowIso(7),
      items: importPreview.lines.length,
      total: importedTotal,
      paid: 0,
      status: 'sent',
    });

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
    }

    setFeedback(`${id} created from ${importPreview.fileName} — ${importPreview.lines.length} item(s), ₹${importedTotal.toLocaleString()} for ${importPreview.supplier}.`);
    setImportPreview(null);
    setActiveTab('po');
  };

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Purchases & Procurement</h1><p className="page-subtitle">Track Purchase Requests → Purchase Orders → Goods Received Notes (GRN) → Supplier Payments</p></div>
        <div className="flex gap-2">
          <label className="btn btn-secondary" style={{ cursor: importing || suppliers.length === 0 ? 'not-allowed' : 'pointer' }}>
            <Upload size={16} /> {importing ? 'Reading file…' : 'Import from File'}
            <input type="file" accept=".csv,.xls,.xlsx,.pdf,image/*" hidden disabled={importing || suppliers.length === 0} onChange={handleImportFile} />
          </label>
          <button className="btn btn-primary" onClick={openPOModal} disabled={suppliers.length === 0}><Plus size={16} /> Create Purchase Order</button>
        </div>
      </div>

      {feedback && <div className="alert alert-success mb-4" role="status">{feedback}</div>}
      {importError && <div className="alert alert-danger mb-4" role="alert">{importError}</div>}
      {suppliers.length === 0 && <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>Add a supplier first before creating a purchase order.</p>}

      <div className="tabs mb-6">
        <button className={`tab ${activeTab === 'po' ? 'active' : ''}`} onClick={() => setActiveTab('po')}>Purchase Orders ({purchaseOrders.length})</button>
        <button className={`tab ${activeTab === 'grn' ? 'active' : ''}`} onClick={() => setActiveTab('grn')}>Goods Received Notes (GRN) ({grns.length})</button>
        <button className={`tab ${activeTab === 'invoices' ? 'active' : ''}`} onClick={() => setActiveTab('invoices')}>Supplier Invoices</button>
      </div>

      {activeTab === 'po' && <div className="table-wrap"><table className="erp-table">
        <thead><tr><th>PO Number</th><th>Supplier Name</th><th>PO Date</th><th>Expected Delivery</th><th>Line Items</th><th className="text-right">Total (₹)</th><th>Status</th><th className="text-center">Actions</th></tr></thead>
        <tbody>{purchaseOrders.map((po) => <tr key={po.id}>
          <td style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>{po.id}</td><td style={{ fontWeight: 600 }}>{po.supplier}</td><td className="text-muted">{po.date}</td><td>{po.expected}</td><td>{po.items} Items</td><td className="text-right font-semibold">₹{po.total.toLocaleString()}</td>
          <td><span className={`badge ${po.status === 'received' ? 'badge-success' : po.status === 'sent' ? 'badge-info' : 'badge-warning'}`}>{po.status.toUpperCase()}</span></td>
          <td className="text-center">{po.status === 'sent' && <button className="btn btn-secondary btn-sm" onClick={() => recordGrn(po.id)}>Record GRN</button>}</td>
        </tr>)}
        {purchaseOrders.length === 0 && (
          <tr><td colSpan={8}><div className="empty-state"><p className="empty-state-title">{poLoading ? 'Loading purchase orders…' : 'No purchase orders yet'}</p><p className="empty-state-desc">{poLoading ? 'Fetching records for the active company.' : 'Create your first purchase order to get started.'}</p></div></td></tr>
        )}
        </tbody>
      </table></div>}

      {activeTab === 'grn' && <div className="table-wrap"><table className="erp-table">
        <thead><tr><th>GRN Number</th><th>Ref PO</th><th>Supplier</th><th>Received Time</th><th>Status</th></tr></thead>
        <tbody>{grns.map((grn) => <tr key={grn.id}><td style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>{grn.id}</td><td style={{ fontWeight: 600 }}>{grn.po_number}</td><td>{grn.supplier}</td><td className="text-muted">{grn.received_at}</td><td><span className="badge badge-success">{grn.status.toUpperCase()}</span></td></tr>)}
        {grns.length === 0 && (
          <tr><td colSpan={5}><div className="empty-state"><p className="empty-state-title">{grnLoading ? 'Loading GRNs…' : 'No goods received yet'}</p><p className="empty-state-desc">{grnLoading ? 'Fetching records for the active company.' : 'GRNs will appear here once a purchase order is received.'}</p></div></td></tr>
        )}
        </tbody>
      </table></div>}

      {activeTab === 'invoices' && <div className="card empty-state"><FileCheck size={32} /><p className="empty-state-title">No unmatched supplier invoices</p><p className="empty-state-desc">Invoices will appear here when uploaded or received against a purchase order.</p></div>}

      {importPreview && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '480px' }} role="dialog" aria-modal="true" aria-labelledby="import-preview-title">
        <div className="modal-header"><h3 id="import-preview-title" className="modal-title">Create Purchase Order from File</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setImportPreview(null)}>✕</button></div>
        <div className="modal-body flex flex-col gap-4">
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Read <strong>{importPreview.lines.length} item(s)</strong> from <strong>{importPreview.fileName}</strong>, total ₹{importPreview.lines.reduce((s, l) => s + l.quantity * l.unit_price, 0).toLocaleString()}.
          </p>
          <div className="form-group">
            <label className="form-label">Supplier {importPreview.supplierGuessed ? '(detected from file)' : '(please confirm)'}</label>
            <select className="form-input form-select" value={importPreview.supplier} onChange={(event) => setImportPreview({ ...importPreview, supplier: event.target.value })}>
              {supplierOptions.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setImportPreview(null)}>Cancel</button><button type="button" className="btn btn-primary" onClick={confirmImportedPO} disabled={!importPreview.supplier}>Create Purchase Order</button></div>
      </div></div>}

      {showPOModal && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '880px' }} role="dialog" aria-modal="true" aria-labelledby="po-modal-title"><form onSubmit={createPO}>
        <div className="modal-header"><h3 id="po-modal-title" className="modal-title">New Purchase Order</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setShowPOModal(false)}>✕</button></div>
        <div className="modal-body flex flex-col gap-4">
          <div className="form-group"><label className="form-label">Select Supplier *</label><select className="form-input form-select" value={supplier} onChange={(event) => setSupplier(event.target.value)}>{supplierOptions.map((s) => <option key={s}>{s}</option>)}</select></div>
          <div className="form-grid-2"><div className="form-group"><label className="form-label">PO Date</label><input type="date" className="form-input" value={poDate} onChange={(event) => setPoDate(event.target.value)} /></div><div className="form-group"><label className="form-label">Expected Delivery</label><input type="date" className="form-input" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} /></div></div>

          <div className="card card-sm bg-surface">
            <h4 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>Item Details</h4>

            <datalist id="po-part-options">
              {partOptions.map((option) => <option key={option.value} value={option.value} />)}
            </datalist>

            {lines.map((line, index) => {
              const category = partOptions.find((option) => option.value === line.description)?.category ?? '-';
              return (
                <div key={index} className="form-grid-4 mb-2">
                  <div className="form-group"><label className="form-label">Description</label><input list="po-part-options" className="form-input" value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} /></div>
                  <div className="form-group"><label className="form-label">Category</label><input type="text" className="form-input" value={category} disabled /></div>
                  <div className="form-group"><label className="form-label">Quantity</label><input type="number" min="1" className="form-input" value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} /></div>
                  <div className="form-group"><label className="form-label">Unit Price (₹)</label><input type="number" min="0" className="form-input" value={line.unit_price} onChange={(event) => updateLine(index, { unit_price: Number(event.target.value) })} /></div>
                </div>
              );
            })}

            <div className="flex justify-between items-center mt-2">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLines((current) => [...current, { description: partOptions[0]?.value ?? '', quantity: 1, unit_price: partOptions[0]?.price ?? 0 }])}>+ Add Item Row</button>
              {lines.length > 1 && <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)' }} onClick={() => setLines((current) => current.slice(0, -1))}>Remove Last Row</button>}
            </div>
          </div>

          <div className="flex justify-between items-center invoice-summary">
            <div><span className="text-muted">Line Items: </span><strong>{lines.length}</strong></div>
            <div><strong>Total: </strong><span className="invoice-total">₹{total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
          </div>
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setShowPOModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={!total || !supplier}>Send PO to Supplier</button></div>
      </form></div></div>}
    </div>
  );
}
