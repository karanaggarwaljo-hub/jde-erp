'use client';

import { useState } from 'react';
import { ShoppingCart, Plus, FileText, CheckCircle, Clock, DollarSign, Download, Printer, Send } from 'lucide-react';

export default function SalesPage() {
  const [activeTab, setActiveTab] = useState<'invoices' | 'quotations' | 'orders' | 'returns'>('invoices');
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  const invoices = [
    { id: 'INV-1042', customer: 'Sharma Auto Works', date: '2026-07-23', items: 3, total: 18400, paid: 18400, status: 'paid', mode: 'UPI' },
    { id: 'INV-1041', customer: 'City Motors Garage', date: '2026-07-22', items: 5, total: 42500, paid: 20000, status: 'partial', mode: 'Bank Transfer' },
    { id: 'INV-1040', customer: 'Kumar Spare Parts', date: '2026-07-21', items: 2, total: 8200, paid: 0, status: 'unpaid', mode: 'Credit' },
    { id: 'INV-1039', customer: 'Patel Auto Center', date: '2026-07-20', items: 8, total: 95000, paid: 95000, status: 'paid', mode: 'Cheque' },
  ];

  const quotations = [
    { id: 'QT-1015', customer: 'Kumar Spare Parts', date: '2026-07-23', validity: '2026-07-30', total: 12500, status: 'sent' },
    { id: 'QT-1014', customer: 'City Motors Garage', date: '2026-07-22', validity: '2026-07-29', total: 68000, status: 'accepted' },
  ];

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Sales Management</h1>
          <p className="page-subtitle">Manage Quotations → Sales Orders → Invoices → Payments & Returns</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowInvoiceModal(true)}>
          <Plus size={16} /> Create Sales Invoice
        </button>
      </div>

      {/* Tabs */}
      <div className="tabs mb-6">
        <button className={`tab ${activeTab === 'invoices' ? 'active' : ''}`} onClick={() => setActiveTab('invoices')}>
          Invoices & Billing ({invoices.length})
        </button>
        <button className={`tab ${activeTab === 'quotations' ? 'active' : ''}`} onClick={() => setActiveTab('quotations')}>
          Quotations ({quotations.length})
        </button>
        <button className={`tab ${activeTab === 'orders' ? 'active' : ''}`} onClick={() => setActiveTab('orders')}>
          Sales Orders
        </button>
        <button className={`tab ${activeTab === 'returns' ? 'active' : ''}`} onClick={() => setActiveTab('returns')}>
          Returns & Credit Notes
        </button>
      </div>

      {/* Invoices List */}
      {activeTab === 'invoices' && (
        <div className="table-wrap">
          <table className="erp-table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Customer Name</th>
                <th>Date</th>
                <th>Items</th>
                <th className="text-right">Total (₹)</th>
                <th className="text-right">Paid (₹)</th>
                <th className="text-right">Balance (₹)</th>
                <th>Payment Status</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const balance = inv.total - inv.paid;
                return (
                  <tr key={inv.id}>
                    <td style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>{inv.id}</td>
                    <td style={{ fontWeight: 600 }}>{inv.customer}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{inv.date}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{inv.items} Parts</td>
                    <td className="text-right font-semibold">₹{inv.total.toLocaleString()}</td>
                    <td className="text-right text-success">₹{inv.paid.toLocaleString()}</td>
                    <td className="text-right text-danger">₹{balance.toLocaleString()}</td>
                    <td>
                      <span className={`badge ${inv.status === 'paid' ? 'badge-success' : inv.status === 'partial' ? 'badge-warning' : 'badge-danger'}`}>
                        {inv.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="text-center">
                      <div className="flex justify-between gap-1 items-center">
                        <button className="btn btn-ghost btn-sm" title="Print PDF">
                          <Printer size={14} />
                        </button>
                        <button className="btn btn-ghost btn-sm" title="Send WhatsApp/Email">
                          <Send size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Quotations List */}
      {activeTab === 'quotations' && (
        <div className="table-wrap">
          <table className="erp-table">
            <thead>
              <tr>
                <th>Quote #</th>
                <th>Customer Name</th>
                <th>Quote Date</th>
                <th>Valid Until</th>
                <th className="text-right">Total Amount</th>
                <th>Status</th>
                <th className="text-center">Convert</th>
              </tr>
            </thead>
            <tbody>
              {quotations.map((q) => (
                <tr key={q.id}>
                  <td style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>{q.id}</td>
                  <td style={{ fontWeight: 600 }}>{q.customer}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{q.date}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{q.validity}</td>
                  <td className="text-right font-semibold">₹{q.total.toLocaleString()}</td>
                  <td>
                    <span className={`badge ${q.status === 'accepted' ? 'badge-success' : 'badge-info'}`}>
                      {q.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="text-center">
                    <button className="btn btn-secondary btn-sm">
                      Convert to Invoice →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Invoice Modal */}
      {showInvoiceModal && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: '700px' }}>
            <div className="modal-header">
              <h3 className="modal-title">Create Sales Invoice</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowInvoiceModal(false)}>✕</button>
            </div>
            <div className="modal-body flex flex-col gap-4">
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Customer *</label>
                  <select className="form-input form-select">
                    <option>Sharma Auto Works</option>
                    <option>City Motors Garage</option>
                    <option>Kumar Spare Parts</option>
                    <option>Patel Auto Center</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Invoice Date</label>
                  <input type="date" className="form-input" defaultValue="2026-07-23" />
                </div>
              </div>

              {/* Items Table */}
              <div className="card card-sm bg-surface">
                <h4 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>Invoice Line Items</h4>
                <div className="form-grid-3 mb-2">
                  <div className="form-group">
                    <label className="form-label">Select Part</label>
                    <select className="form-input form-select">
                      <option>SP-001 - Brake Pad Set Front (₹1,100)</option>
                      <option>SP-002 - Air Filter Premium (₹580)</option>
                      <option>SP-003 - Oil Filter (₹300)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Qty</label>
                    <input type="number" className="form-input" defaultValue="2" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Unit Price (₹)</label>
                    <input type="number" className="form-input" defaultValue="1100" />
                  </div>
                </div>
                <button className="btn btn-secondary btn-sm mt-2">+ Add Item Row</button>
              </div>

              {/* Summary */}
              <div className="flex justify-between items-center" style={{ padding: '12px 16px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)' }}>
                <div>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>GST (18% included): </span>
                  <span style={{ fontWeight: 600 }}>₹335.59</span>
                </div>
                <div>
                  <span style={{ fontSize: '14px', fontWeight: 600 }}>Total Payable: </span>
                  <span style={{ fontSize: '18px', fontWeight: 800, color: 'var(--brand-primary)' }}>₹2,200</span>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowInvoiceModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => setShowInvoiceModal(false)}>
                Generate & Save Invoice
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
