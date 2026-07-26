'use client';

import { FormEvent, useState } from 'react';
import { Plus, Phone, Mail, MapPin } from 'lucide-react';

const initialCustomers = [
  { id: '1', name: 'Sharma Auto Works', phone: '9876543210', email: 'sharma.auto@email.com', gstin: '07AAAAA0000A1Z5', address: 'Plot 42, Mayapuri Phase II, New Delhi', type: 'dealer', credit_limit: 50000, balance: 18400 },
  { id: '2', name: 'City Motors Garage', phone: '9123456789', email: 'citymotors@email.com', gstin: '07BBBBB1111B2Z6', address: 'Shop 12, Kashmere Gate, New Delhi', type: 'wholesale', credit_limit: 75000, balance: 22500 },
  { id: '3', name: 'Kumar Spare Parts', phone: '9012345678', email: 'kumar.spare@email.com', gstin: '07CCCCC2222C3Z7', address: 'Main Road, Gurgaon', type: 'retail', credit_limit: 20000, balance: 8200 },
  { id: '4', name: 'Patel Auto Center', phone: '8901234567', email: 'patel.auto@email.com', gstin: '07DDDDD3333D4Z8', address: 'Sector 18, Noida', type: 'dealer', credit_limit: 100000, balance: 0 },
];

const emptyForm = { name: '', phone: '', email: '', gstin: '', address: '', type: 'retail', credit_limit: 50000 };

type Customer = typeof initialCustomers[number];

export default function CustomersPage() {
  const [customers, setCustomers] = useState(initialCustomers);
  const [showModal, setShowModal] = useState(false);
  const [paymentCustomer, setPaymentCustomer] = useState<Customer | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [form, setForm] = useState(emptyForm);

  const saveCustomer = (event: FormEvent) => {
    event.preventDefault();
    setCustomers((current) => [{ id: String(Date.now()), ...form, balance: 0 }, ...current]);
    setShowModal(false);
    setFeedback(`${form.name} added to the customer directory.`);
    setForm(emptyForm);
  };

  const openPayment = (customer: Customer) => {
    setPaymentCustomer(customer);
    setPaymentAmount(customer.balance);
  };

  const recordPayment = (event: FormEvent) => {
    event.preventDefault();
    if (!paymentCustomer) return;
    const received = Math.min(Math.max(paymentAmount, 0), paymentCustomer.balance);
    setCustomers((current) => current.map((customer) => customer.id === paymentCustomer.id ? { ...customer, balance: customer.balance - received } : customer));
    setFeedback(`₹${received.toLocaleString()} payment received from ${paymentCustomer.name}.`);
    setPaymentCustomer(null);
  };

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Customer Ledger & Directory</h1><p className="page-subtitle">Track accounts receivable, credit limits, GST numbers and purchase histories</p></div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> Add New Customer</button></div>

      {feedback && <div className="alert alert-success mb-4" role="status">{feedback}</div>}

      <div className="grid-4 mb-6">
        {customers.map((customer) => <div key={customer.id} className="card flex flex-col justify-between">
          <div><div className="flex justify-between items-start mb-2"><span className="badge badge-info">{customer.type.toUpperCase()}</span><span className="customer-gstin">GSTIN: {customer.gstin || 'Not provided'}</span></div>
            <h3 className="directory-card-title">{customer.name}</h3>
            <div className="directory-details"><div className="flex items-center gap-2"><Phone size={13} /><span>{customer.phone || 'No phone'}</span></div><div className="flex items-center gap-2"><Mail size={13} /><span>{customer.email || 'No email'}</span></div><div className="flex items-center gap-2"><MapPin size={13} /><span className="truncate">{customer.address || 'No address'}</span></div></div>
          </div>
          <div className="directory-financials"><div><small>Outstanding</small><strong className={customer.balance > 0 ? 'text-danger' : 'text-success'}>₹{customer.balance.toLocaleString()}</strong></div><div><small>Credit Limit</small><strong>₹{customer.credit_limit.toLocaleString()}</strong></div></div>
          <button className="btn btn-secondary btn-sm mt-2 w-full" style={{ justifyContent: 'center' }} disabled={!customer.balance} onClick={() => openPayment(customer)}>Received</button>
        </div>)}
      </div>

      {showModal && <div className="modal-overlay"><div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="customer-modal-title"><form onSubmit={saveCustomer}>
        <div className="modal-header"><h3 id="customer-modal-title" className="modal-title">Add Customer Account</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setShowModal(false)}>✕</button></div>
        <div className="modal-body flex flex-col gap-4">
          <div className="form-group"><label className="form-label">Customer / Business Name *</label><input className="form-input" required placeholder="e.g. Acme Motors" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
          <div className="form-grid-2"><div className="form-group"><label className="form-label">Phone</label><input className="form-input" placeholder="10-digit number" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div><div className="form-group"><label className="form-label">Email</label><input type="email" className="form-input" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div></div>
          <div className="form-grid-2"><div className="form-group"><label className="form-label">GSTIN</label><input className="form-input" placeholder="GST Number" value={form.gstin} onChange={(event) => setForm({ ...form, gstin: event.target.value })} /></div><div className="form-group"><label className="form-label">Customer Type</label><select className="form-input form-select" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option value="retail">Retail</option><option value="wholesale">Wholesale</option><option value="dealer">Dealer</option></select></div></div>
          <div className="form-group"><label className="form-label">Credit Limit (₹)</label><input type="number" min="0" className="form-input" value={form.credit_limit} onChange={(event) => setForm({ ...form, credit_limit: Number(event.target.value) })} /></div>
          <div className="form-group"><label className="form-label">Billing Address</label><textarea className="form-input" rows={2} placeholder="Full postal address" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></div>
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button><button type="submit" className="btn btn-primary">Save Customer</button></div>
      </form></div></div>}

      {paymentCustomer && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '440px' }} role="dialog" aria-modal="true" aria-labelledby="payment-modal-title"><form onSubmit={recordPayment}>
        <div className="modal-header"><h3 id="payment-modal-title" className="modal-title">Record Payment Received</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setPaymentCustomer(null)}>✕</button></div>
        <div className="modal-body flex flex-col gap-4"><p>Outstanding balance for <strong>{paymentCustomer.name}</strong>: ₹{paymentCustomer.balance.toLocaleString()}</p><div className="form-group"><label className="form-label">Amount Received (₹)</label><input type="number" min="1" max={paymentCustomer.balance} className="form-input" value={paymentAmount} onChange={(event) => setPaymentAmount(Number(event.target.value))} /></div></div>
        <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setPaymentCustomer(null)}>Cancel</button><button type="submit" className="btn btn-primary">Record Payment</button></div>
      </form></div></div>}
    </div>
  );
}
