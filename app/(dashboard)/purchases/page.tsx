'use client';

import { ChangeEvent, FormEvent, useState } from 'react';
import { Plus, FileCheck } from 'lucide-react';
import { parseSpreadsheetFile, fileToBase64 } from '@/lib/client-import';
import { useCompanyTable } from '@/lib/useCompanyTable';

type PurchaseTab = 'po' | 'grn' | 'invoices';
type POLine = { description: string; quantity: number; unit_price: number };

type Product = { id: string; company_id: string; part_number: string; name: string; category: string; cost_price: number };
type Supplier = { id: string; company_id: string; name: string };
type PurchaseOrder = { id: string; company_id: string; supplier: string; date: string; expected: string; items: number; total: number; status: string };
type Grn = { id: string; company_id: string; po_number: string; supplier: string; received_at: string; status: string };

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

export default function PurchasesPage() {
  const { rows: products } = useCompanyTable<Product>('products');
  const { rows: suppliers } = useCompanyTable<Supplier>('suppliers');
  const { rows: purchaseOrders, loading: poLoading, create: createPurchaseOrder, update: updatePurchaseOrder } = useCompanyTable<PurchaseOrder>('purchase_orders');
  const { rows: grns, loading: grnLoading, create: createGrn } = useCompanyTable<Grn>('grns');

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
    await createPurchaseOrder({ id, supplier, date: poDate, expected: expectedDate, items: lines.length, total, status: 'sent' });
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
    setFeedback(`${grnId} recorded and ${poId} marked received.`);
  };

  const handleSpreadsheetImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImportError('');
    setImporting(true);
    try {
      const imported = await parseSpreadsheetFile(file);
      if (imported.length === 0) {
        throw new Error('No rows with a recognizable description, quantity, or price column were found in this file.');
      }
      setLines((current) => [...current, ...imported.map((item) => ({ description: item.description, quantity: item.quantity, unit_price: item.unit_price }))]);
      setFeedback(`Imported ${imported.length} item(s) from ${file.name}. Review before sending.`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to read the file.');
    } finally {
      setImporting(false);
    }
  };

  const handleScanImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImportError('');
    setImporting(true);
    try {
      const base64 = await fileToBase64(file);
      const res = await fetch('/api/purchases/import-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, mimeType: file.type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to scan document.');

      if (data.supplier_name) {
        const guess = String(data.supplier_name).toLowerCase();
        const match = supplierOptions.find((s) => s.toLowerCase().includes(guess) || guess.includes(s.toLowerCase()));
        if (match) setSupplier(match);
      }
      if (data.po_date) setPoDate(data.po_date);
      if (data.expected_delivery) setExpectedDate(data.expected_delivery);

      const items: Array<{ description: string; quantity: number; unit_price: number }> = Array.isArray(data.items) ? data.items : [];
      if (items.length === 0) {
        throw new Error('No line items could be read from this document.');
      }
      setLines((current) => [...current, ...items.map((item) => ({ description: item.description, quantity: item.quantity, unit_price: item.unit_price }))]);
      setFeedback(`Extracted ${items.length} item(s) from ${file.name}. Review before sending.`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to scan document.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Purchases & Procurement</h1><p className="page-subtitle">Track Purchase Requests → Purchase Orders → Goods Received Notes (GRN) → Supplier Payments</p></div>
        <button className="btn btn-primary" onClick={openPOModal} disabled={suppliers.length === 0}><Plus size={16} /> Create Purchase Order</button></div>

      {feedback && <div className="alert alert-success mb-4" role="status">{feedback}</div>}

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

      {showPOModal && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '880px' }} role="dialog" aria-modal="true" aria-labelledby="po-modal-title"><form onSubmit={createPO}>
        <div className="modal-header"><h3 id="po-modal-title" className="modal-title">New Purchase Order</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setShowPOModal(false)}>✕</button></div>
        <div className="modal-body flex flex-col gap-4">
          <div className="form-group"><label className="form-label">Select Supplier *</label><select className="form-input form-select" value={supplier} onChange={(event) => setSupplier(event.target.value)}>{supplierOptions.map((s) => <option key={s}>{s}</option>)}</select></div>
          <div className="form-grid-2"><div className="form-group"><label className="form-label">PO Date</label><input type="date" className="form-input" value={poDate} onChange={(event) => setPoDate(event.target.value)} /></div><div className="form-group"><label className="form-label">Expected Delivery</label><input type="date" className="form-input" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} /></div></div>

          <div className="card card-sm bg-surface">
            <div className="flex justify-between items-center flex-wrap gap-2 mb-2">
              <h4 style={{ fontSize: '13px', fontWeight: 600 }}>Item Details</h4>
              <div className="flex gap-2">
                <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                  Import CSV/Excel
                  <input type="file" accept=".csv,.xls,.xlsx" hidden disabled={importing} onChange={handleSpreadsheetImport} />
                </label>
                <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                  Scan PDF/Photo
                  <input type="file" accept=".pdf,image/*" hidden disabled={importing} onChange={handleScanImport} />
                </label>
              </div>
            </div>

            {importing && <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>Reading file…</p>}
            {importError && <p className="form-error" style={{ marginBottom: '8px' }}>{importError}</p>}
            {partOptions.length === 0 && <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Add parts in Inventory to pick from a catalog, or type a description below.</p>}

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
