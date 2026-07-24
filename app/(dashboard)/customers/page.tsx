'use client';

import { useState } from 'react';
import { Users, Plus, Phone, Mail, MapPin, CreditCard, DollarSign } from 'lucide-react';

export default function CustomersPage() {
  const [customers, setCustomers] = useState([
    { id: '1', name: 'Sharma Auto Works', phone: '9876543210', email: 'sharma.auto@email.com', gstin: '07AAAAA0000A1Z5', address: 'Plot 42, Mayapuri Phase II, New Delhi', type: 'dealer', credit_limit: 50000, balance: 18400 },
    { id: '2', name: 'City Motors Garage', phone: '9123456789', email: 'citymotors@email.com', gstin: '07BBBBB1111B2Z6', address: 'Shop 12, Kashmere Gate, New Delhi', type: 'wholesale', credit_limit: 75000, balance: 22500 },
    { id: '3', name: 'Kumar Spare Parts', phone: '9012345678', email: 'kumar.spare@email.com', gstin: '07CCCCC2222C3Z7', address: 'Main Road, Gurgaon', type: 'retail', credit_limit: 20000, balance: 8200 },
    { id: '4', name: 'Patel Auto Center', phone: '8901234567', email: 'patel.auto@email.com', gstin: '07DDDDD3333D4Z8', address: 'Sector 18, Noida', type: 'dealer', credit_limit: 100000, balance: 0 },
  ]);

  const [showModal, setShowModal] = useState(false);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Customer Ledger & Directory</h1>
          <p className="page-subtitle">Track accounts receivable, credit limits, GST numbers and purchase histories</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Add New Customer
        </button>
      </div>

      <div className="grid-4 mb-6">
        {customers.map((c) => (
          <div key={c.id} className="card flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-start mb-2">
                <span className="badge badge-info">{c.type.toUpperCase()}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>GSTIN: {c.gstin}</span>
              </div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>{c.name}</h3>

              <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div className="flex items-center gap-2">
                  <Phone size={13} color="var(--text-muted)" />
                  <span>{c.phone}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Mail size={13} color="var(--text-muted)" />
                  <span>{c.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin size={13} color="var(--text-muted)" />
                  <span className="truncate">{c.address}</span>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Outstanding</span>
                <div style={{ fontSize: '16px', fontWeight: 700, color: c.balance > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
                  ₹{c.balance.toLocaleString()}
                </div>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Credit Limit</span>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  ₹{c.credit_limit.toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-header">
              <h3 className="modal-title">Add Customer Account</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body flex flex-col gap-4">
              <div className="form-group">
                <label className="form-label">Customer / Business Name *</label>
                <input className="form-input" required placeholder="e.g. Acme Motors" />
              </div>
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input className="form-input" placeholder="10-digit number" />
                </div>
                <div className="form-group">
                  <label className="form-label">GSTIN</label>
                  <input className="form-input" placeholder="GST Number" />
                </div>
              </div>
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Customer Type</label>
                  <select className="form-input form-select">
                    <option value="retail">Retail</option>
                    <option value="wholesale">Wholesale</option>
                    <option value="dealer">Dealer</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Credit Limit (₹)</label>
                  <input type="number" className="form-input" defaultValue="50000" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Billing Address</label>
                <textarea className="form-input" rows={2} placeholder="Full postal address"></textarea>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => setShowModal(false)}>Save Customer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
