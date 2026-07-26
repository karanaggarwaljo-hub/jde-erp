'use client';

import { FormEvent, useState } from 'react';
import { Plus, FileCheck } from 'lucide-react';

type PurchaseTab = 'po' | 'grn' | 'invoices';

const partOptions = [
  { value: 'SP-001 - Brake Pad Set Front', price: 850, category: 'Brakes' },
  { value: 'SP-002 - Air Filter Premium', price: 320, category: 'Filters' },
  { value: 'SP-003 - Oil Filter', price: 180, category: 'Filters' },
  { value: 'SP-004 - Clutch Plate', price: 2800, category: 'Clutch' },
];

export default function PurchasesPage() {
  const [activeTab, setActiveTab] = useState<PurchaseTab>('po');
  const [showPOModal, setShowPOModal] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [supplier, setSupplier] = useState('Bosch India Ltd');
  const [poDate, setPoDate] = useState('2026-07-23');
  const [expectedDate, setExpectedDate] = useState('2026-07-30');
  const [part, setPart] = useState(partOptions[0].value);
  const [quantity, setQuantity] = useState(50);
  const [purchaseOrders, setPurchaseOrders] = useState([
    { id: 'PO-1008', supplier: 'Bosch India Ltd', date: '2026-07-20', expected: '2026-07-25', items: 4, total: 45000, status: 'received' },
    { id: 'PO-1009', supplier: 'Denso Auto Parts', date: '2026-07-22', expected: '2026-07-27', items: 2, total: 18500, status: 'sent' },
    { id: 'PO-1010', supplier: 'LUK Clutch Systems', date: '2026-07-23', expected: '2026-07-28', items: 1, total: 28000, status: 'draft' },
  ]);
  const [grns, setGrns] = useState([
    { id: 'GRN-1008', po_number: 'PO-1008', supplier: 'Bosch India Ltd', received_at: '2026-07-23 11:30 AM', status: 'verified' },
  ]);

  const createPO = (event: FormEvent) => {
    event.preventDefault();
    const id = `PO-${1011 + purchaseOrders.length - 3}`;
    const unitPrice = partOptions.find((option) => option.value === part)?.price ?? 0;
    setPurchaseOrders((current) => [{ id, supplier, date: poDate, expected: expectedDate, items: 1, total: quantity * unitPrice, status: 'sent' }, ...current]);
    setShowPOModal(false);
    setFeedback(`${id} sent to ${supplier} for ${quantity} units of ${part.split(' - ')[0]}.`);
    setActiveTab('po');
  };

  const recordGrn = (poId: string) => {
    const order = purchaseOrders.find((po) => po.id === poId);
    if (!order) return;
    const grnId = `GRN-${1009 + grns.length - 1}`;
    setPurchaseOrders((current) => current.map((po) => po.id === poId ? { ...po, status: 'received' } : po));
    setGrns((current) => [{ id: grnId, po_number: poId, supplier: order.supplier, received_at: new Date().toLocaleString('en-IN'), status: 'verified' }, ...current]);
    setFeedback(`${grnId} recorded and ${poId} marked received.`);
  };

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Purchases & Procurement</h1><p className="page-subtitle">Track Purchase Requests → Purchase Orders → Goods Received Notes (GRN) → Supplier Payments</p></div>
        <button className="btn btn-primary" onClick={() => setShowPOModal(true)}><Plus size={16} /> Create Purchase Order</button></div>

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
        </tr>)}</tbody>
      </table></div>}

      {activeTab === 'grn' && <div className="table-wrap"><table className="erp-table">
        <thead><tr><th>GRN Number</th><th>Ref PO</th><th>Supplier</th><th>Received Time</th><th>Status</th></tr></thead>
        <tbody>{grns.map((grn) => <tr key={grn.id}><td style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>{grn.id}</td><td style={{ fontWeight: 600 }}>{grn.po_number}</td><td>{grn.supplier}</td><td className="text-muted">{grn.received_at}</td><td><span className="badge badge-success">{grn.status.toUpperCase()}</span></td></tr>)}</tbody>
      </table></div>}

      {activeTab === 'invoices' && <div className="card empty-state"><FileCheck size={32} /><p className="empty-state-title">No unmatched supplier invoices</p><p className="empty-state-desc">Invoices will appear here when uploaded or received against a purchase order.</p></div>}

      {showPOModal && <div className="modal-overlay"><div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="po-modal-title"><form onSubmit={createPO}>
        <div className="modal-header"><h3 id="po-modal-title" className="modal-title">New Purchase Order</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setShowPOModal(false)}>✕</button></div>
        <div className="modal-body flex flex-col gap-4">
          <div className="form-group"><label className="form-label">Select Supplier *</label><select className="form-input form-select" value={supplier} onChange={(event) => setSupplier(event.target.value)}><option>Bosch India Ltd</option><option>Denso Auto Parts</option><option>NGK Spark Plugs</option><option>LUK Clutch Systems</option></select></div>
          <div className="form-grid-2"><div className="form-group"><label className="form-label">PO Date</label><input type="date" className="form-input" value={poDate} onChange={(event) => setPoDate(event.target.value)} /></div><div className="form-group"><label className="form-label">Expected Delivery</label><input type="date" className="form-input" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} /></div></div>
          <div className="card card-sm bg-surface"><h4 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>Item Details</h4>
            <div className="form-grid-3">
              <div className="form-group"><label className="form-label">Select Part</label><select className="form-input form-select" value={part} onChange={(event) => setPart(event.target.value)}>{partOptions.map((option) => <option key={option.value} value={option.value}>{option.value}</option>)}</select></div>
              <div className="form-group"><label className="form-label">Category</label><input type="text" className="form-input" value={partOptions.find((option) => option.value === part)?.category ?? '-'} disabled /></div>
              <div className="form-group"><label className="form-label">Quantity</label><input type="number" min="1" className="form-input" required value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></div>
            </div>
          </div>
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setShowPOModal(false)}>Cancel</button><button type="submit" className="btn btn-primary">Send PO to Supplier</button></div>
      </form></div></div>}
    </div>
  );
}
