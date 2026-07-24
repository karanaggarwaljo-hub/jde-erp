'use client';

import { useState } from 'react';
import { ShoppingBag, Plus, Truck, CheckCircle2, Clock, FileCheck } from 'lucide-react';

export default function PurchasesPage() {
  const [activeTab, setActiveTab] = useState<'po' | 'grn' | 'invoices'>('po');
  const [showPOModal, setShowPOModal] = useState(false);

  const purchaseOrders = [
    { id: 'PO-1008', supplier: 'Bosch India Ltd', date: '2026-07-20', expected: '2026-07-25', items: 4, total: 45000, status: 'received' },
    { id: 'PO-1009', supplier: 'Denso Auto Parts', date: '2026-07-22', expected: '2026-07-27', items: 2, total: 18500, status: 'sent' },
    { id: 'PO-1010', supplier: 'LUK Clutch Systems', date: '2026-07-23', expected: '2026-07-28', items: 1, total: 28000, status: 'draft' },
  ];

  const grns = [
    { id: 'GRN-1008', po_number: 'PO-1008', supplier: 'Bosch India Ltd', received_at: '2026-07-23 11:30 AM', status: 'verified' },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Purchases & Procurement</h1>
          <p className="page-subtitle">Track Purchase Requests → Purchase Orders → Goods Received Notes (GRN) → Supplier Payments</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowPOModal(true)}>
          <Plus size={16} /> Create Purchase Order
        </button>
      </div>

      <div className="tabs mb-6">
        <button className={`tab ${activeTab === 'po' ? 'active' : ''}`} onClick={() => setActiveTab('po')}>
          Purchase Orders ({purchaseOrders.length})
        </button>
        <button className={`tab ${activeTab === 'grn' ? 'active' : ''}`} onClick={() => setActiveTab('grn')}>
          Goods Received Notes (GRN) ({grns.length})
        </button>
        <button className={`tab ${activeTab === 'invoices' ? 'active' : ''}`} onClick={() => setActiveTab('invoices')}>
          Supplier Invoices
        </button>
      </div>

      {activeTab === 'po' && (
        <div className="table-wrap">
          <table className="erp-table">
            <thead>
              <tr>
                <th>PO Number</th>
                <th>Supplier Name</th>
                <th>PO Date</th>
                <th>Expected Delivery</th>
                <th>Line Items</th>
                <th className="text-right">Total (₹)</th>
                <th>Status</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {purchaseOrders.map((po) => (
                <tr key={po.id}>
                  <td style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>{po.id}</td>
                  <td style={{ fontWeight: 600 }}>{po.supplier}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{po.date}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{po.expected}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{po.items} Items</td>
                  <td className="text-right font-semibold">₹{po.total.toLocaleString()}</td>
                  <td>
                    <span className={`badge ${po.status === 'received' ? 'badge-success' : po.status === 'sent' ? 'badge-info' : 'badge-warning'}`}>
                      {po.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="text-center">
                    {po.status === 'sent' && (
                      <button className="btn btn-secondary btn-sm">
                        Record GRN
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'grn' && (
        <div className="table-wrap">
          <table className="erp-table">
            <thead>
              <tr>
                <th>GRN Number</th>
                <th>Ref PO</th>
                <th>Supplier</th>
                <th>Received Time</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {grns.map((g) => (
                <tr key={g.id}>
                  <td style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>{g.id}</td>
                  <td style={{ fontWeight: 600 }}>{g.po_number}</td>
                  <td>{g.supplier}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{g.received_at}</td>
                  <td>
                    <span className="badge badge-success">{g.status.toUpperCase()}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* PO Modal */}
      {showPOModal && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-header">
              <h3 className="modal-title">New Purchase Order</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowPOModal(false)}>✕</button>
            </div>
            <div className="modal-body flex flex-col gap-4">
              <div className="form-group">
                <label className="form-label">Select Supplier *</label>
                <select className="form-input form-select">
                  <option>Bosch India Ltd</option>
                  <option>Denso Auto Parts</option>
                  <option>NGK Spark Plugs</option>
                  <option>LUK Clutch Systems</option>
                </select>
              </div>

              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">PO Date</label>
                  <input type="date" className="form-input" defaultValue="2026-07-23" />
                </div>
                <div className="form-group">
                  <label className="form-label">Expected Delivery</label>
                  <input type="date" className="form-input" defaultValue="2026-07-30" />
                </div>
              </div>

              <div className="card card-sm bg-surface">
                <h4 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>Item Details</h4>
                <div className="form-grid-2">
                  <input className="form-input" placeholder="Part Number / Name" defaultValue="SP-001 - Brake Pad Set Front" />
                  <input type="number" className="form-input" placeholder="Quantity to Order" defaultValue="50" />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowPOModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => setShowPOModal(false)}>Send PO to Supplier</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
