'use client';

import { useState } from 'react';
import { Building2, Plus, Phone, Mail, MapPin, Clock } from 'lucide-react';

export default function SuppliersPage() {
  const [suppliers] = useState([
    { id: '1', name: 'Bosch India Ltd', phone: '9111222333', email: 'bosch.india@supplier.com', gstin: '07AAAAA1111A1Z1', terms: 30, balance: 45000 },
    { id: '2', name: 'Denso Auto Parts', phone: '9222333444', email: 'denso.auto@supplier.com', gstin: '07BBBBB2222B2Z2', terms: 45, balance: 18500 },
    { id: '3', name: 'NGK Spark Plugs', phone: '9333444555', email: 'ngk.india@supplier.com', gstin: '07CCCCC3333C3Z3', terms: 30, balance: 0 },
    { id: '4', name: 'LUK Clutch Systems', phone: '9444555666', email: 'luk.india@supplier.com', gstin: '07DDDDD4444D4Z4', terms: 60, balance: 28000 },
  ]);

  const [showModal, setShowModal] = useState(false);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Supplier & Vendor Directory</h1>
          <p className="page-subtitle">Manage spare parts manufacturers, distributors, payment terms and payables</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Add Supplier
        </button>
      </div>

      <div className="grid-4 mb-6">
        {suppliers.map((s) => (
          <div key={s.id} className="card flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-start mb-2">
                <span className="badge badge-warning">{s.terms} Days Terms</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>GSTIN: {s.gstin}</span>
              </div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>{s.name}</h3>

              <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div className="flex items-center gap-2">
                  <Phone size={13} color="var(--text-muted)" />
                  <span>{s.phone}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Mail size={13} color="var(--text-muted)" />
                  <span>{s.email}</span>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Payable Balance</span>
                <div style={{ fontSize: '16px', fontWeight: 700, color: s.balance > 0 ? 'var(--color-warning)' : 'var(--color-success)' }}>
                  ₹{s.balance.toLocaleString()}
                </div>
              </div>
              <button className="btn btn-secondary btn-sm">Pay Vendor</button>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-header">
              <h3 className="modal-title">Add Supplier Profile</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body flex flex-col gap-4">
              <div className="form-group">
                <label className="form-label">Supplier Company Name *</label>
                <input className="form-input" required placeholder="e.g. Bosch India" />
              </div>
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">GSTIN</label>
                  <input className="form-input" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Credit Terms (Days)</label>
                <input type="number" className="form-input" defaultValue="30" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => setShowModal(false)}>Save Supplier</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
