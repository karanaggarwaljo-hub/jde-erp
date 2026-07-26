'use client';

import { FormEvent, useState } from 'react';
import { Plus, Search, Phone, Mail } from 'lucide-react';

type Supplier = { id: string; name: string; phone: string; email: string; gstin: string; terms: number; balance: number };

const initialSuppliers: Supplier[] = [
  { id: '1', name: 'Bosch India Ltd', phone: '9111222333', email: 'bosch.india@supplier.com', gstin: '07AAAAA1111A1Z1', terms: 30, balance: 45000 },
  { id: '2', name: 'Denso Auto Parts', phone: '9222333444', email: 'denso.auto@supplier.com', gstin: '07BBBBB2222B2Z2', terms: 45, balance: 18500 },
  { id: '3', name: 'NGK Spark Plugs', phone: '9333444555', email: 'ngk.india@supplier.com', gstin: '07CCCCC3333C3Z3', terms: 30, balance: 0 },
  { id: '4', name: 'LUK Clutch Systems', phone: '9444555666', email: 'luk.india@supplier.com', gstin: '07DDDDD4444D4Z4', terms: 60, balance: 28000 },
];

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [paymentSupplier, setPaymentSupplier] = useState<Supplier | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', email: '', gstin: '', terms: 30 });

  const filteredSuppliers = suppliers.filter((supplier) => {
    const query = search.toLowerCase();
    return (
      supplier.name.toLowerCase().includes(query) ||
      supplier.phone.toLowerCase().includes(query) ||
      supplier.email.toLowerCase().includes(query) ||
      supplier.gstin.toLowerCase().includes(query)
    );
  });

  const totalPayables = suppliers.reduce((total, supplier) => total + supplier.balance, 0);

  const saveSupplier = (event: FormEvent) => {
    event.preventDefault();
    setSuppliers((current) => [{ id: String(Date.now()), ...form, balance: 0 }, ...current]);
    setShowModal(false);
    setFeedback(`${form.name} added to the supplier directory.`);
    setForm({ name: '', phone: '', email: '', gstin: '', terms: 30 });
  };

  const openPayment = (supplier: Supplier) => {
    setPaymentSupplier(supplier);
    setPaymentAmount(supplier.balance);
  };

  const recordPayment = (event: FormEvent) => {
    event.preventDefault();
    if (!paymentSupplier) return;
    const paid = Math.min(Math.max(paymentAmount, 0), paymentSupplier.balance);
    setSuppliers((current) => current.map((supplier) => supplier.id === paymentSupplier.id ? { ...supplier, balance: supplier.balance - paid } : supplier));
    setFeedback(`₹${paid.toLocaleString()} payment recorded for ${paymentSupplier.name}.`);
    setPaymentSupplier(null);
  };

  return <div>
    <div className="page-header">
      <div>
        <h1 className="page-title">Supplier & Vendor Directory</h1>
        <p className="page-subtitle">Manage spare parts manufacturers, distributors, payment terms and payables</p>
      </div>
      <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> Add Supplier</button>
    </div>

    {feedback && <div className="alert alert-success mb-4" role="status">{feedback}</div>}

    <div className="card mb-6 p-4">
      <div className="flex gap-4 items-center flex-wrap">
        <div className="search-bar" style={{ flex: 1, minWidth: '240px' }}>
          <Search className="search-bar-icon" size={16} />
          <input
            type="text"
            placeholder="Search by name, phone, email, GSTIN..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          {suppliers.length} suppliers · <strong style={{ color: 'var(--text-primary)' }}>₹{totalPayables.toLocaleString()}</strong> total payable
        </span>
      </div>
    </div>

    <div className="table-wrap">
      <table className="erp-table">
        <thead>
          <tr>
            <th>Supplier</th>
            <th>GSTIN</th>
            <th>Contact</th>
            <th>Terms</th>
            <th className="text-right">Payable Balance</th>
            <th className="text-center">Action</th>
          </tr>
        </thead>
        <tbody>
          {filteredSuppliers.map((supplier) => (
            <tr key={supplier.id}>
              <td style={{ fontWeight: 600 }}>{supplier.name}</td>
              <td style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '12px' }}>{supplier.gstin || 'Not provided'}</td>
              <td>
                <div className="flex items-center gap-2" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  <Phone size={12} /><span>{supplier.phone || 'No phone'}</span>
                </div>
                <div className="flex items-center gap-2" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  <Mail size={12} /><span>{supplier.email || 'No email'}</span>
                </div>
              </td>
              <td><span className="badge badge-warning">{supplier.terms} Days</span></td>
              <td className="text-right">
                <strong className={supplier.balance > 0 ? 'text-warning' : 'text-success'}>₹{supplier.balance.toLocaleString()}</strong>
              </td>
              <td className="text-center">
                <button className="btn btn-secondary btn-sm" disabled={!supplier.balance} onClick={() => openPayment(supplier)}>Pay Vendor</button>
              </td>
            </tr>
          ))}
          {filteredSuppliers.length === 0 && (
            <tr><td colSpan={6}><div className="empty-state"><p className="empty-state-title">No suppliers found</p><p className="empty-state-desc">Try another search term.</p></div></td></tr>
          )}
        </tbody>
      </table>
    </div>

    {showModal && <div className="modal-overlay"><div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="supplier-modal-title"><form onSubmit={saveSupplier}>
      <div className="modal-header"><h3 id="supplier-modal-title" className="modal-title">Add Supplier Profile</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setShowModal(false)}>✕</button></div>
      <div className="modal-body flex flex-col gap-4"><div className="form-group"><label className="form-label">Supplier Company Name *</label><input className="form-input" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
        <div className="form-grid-2"><div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div><div className="form-group"><label className="form-label">Email</label><input type="email" className="form-input" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div></div>
        <div className="form-grid-2"><div className="form-group"><label className="form-label">GSTIN</label><input className="form-input" value={form.gstin} onChange={(event) => setForm({ ...form, gstin: event.target.value })} /></div><div className="form-group"><label className="form-label">Credit Terms (Days)</label><input type="number" min="0" className="form-input" value={form.terms} onChange={(event) => setForm({ ...form, terms: Number(event.target.value) })} /></div></div>
      </div><div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button><button type="submit" className="btn btn-primary">Save Supplier</button></div>
    </form></div></div>}

    {paymentSupplier && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '440px' }} role="dialog" aria-modal="true" aria-labelledby="payment-modal-title"><form onSubmit={recordPayment}>
      <div className="modal-header"><h3 id="payment-modal-title" className="modal-title">Record Vendor Payment</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setPaymentSupplier(null)}>✕</button></div>
      <div className="modal-body flex flex-col gap-4"><p>Outstanding balance for <strong>{paymentSupplier.name}</strong>: ₹{paymentSupplier.balance.toLocaleString()}</p><div className="form-group"><label className="form-label">Payment Amount (₹)</label><input type="number" min="1" max={paymentSupplier.balance} className="form-input" value={paymentAmount} onChange={(event) => setPaymentAmount(Number(event.target.value))} /></div></div>
      <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setPaymentSupplier(null)}>Cancel</button><button type="submit" className="btn btn-primary">Record Payment</button></div>
    </form></div></div>}
  </div>;
}
