'use client';

import { FormEvent, useState } from 'react';
import { Plus, Phone, Mail, MapPin, Sparkles } from 'lucide-react';
import { useCompanyTable } from '@/lib/useCompanyTable';
import PaymentReminderModal from '@/components/PaymentReminderModal';
import AddCustomerModal from '@/components/AddCustomerModal';

type Customer = {
  id: string;
  company_id: string;
  name: string;
  phone: string;
  email: string;
  gstin: string;
  address: string;
  type: string;
  balance: number;
};

type Invoice = { id: string; customer: string; date: string; total: number; paid: number; status: string };

export default function CustomersPage() {
  const { rows: customers, loading, create, adjust } = useCompanyTable<Customer>('customers');
  const { rows: invoices, update: updateInvoice } = useCompanyTable<Invoice>('invoices');
  const [showModal, setShowModal] = useState(false);
  const [paymentCustomer, setPaymentCustomer] = useState<Customer | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [reminderCustomer, setReminderCustomer] = useState<Customer | null>(null);
  const [feedback, setFeedback] = useState('');

  function overdueContext(customerName: string): string {
    const overdue = invoices
      .filter((inv) => inv.customer === customerName && Number(inv.total) > Number(inv.paid))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (overdue.length === 0) return '';
    return `${overdue.length} unpaid invoice${overdue.length > 1 ? 's' : ''}, oldest ${overdue[0].id} dated ${overdue[0].date}.`;
  }

  const openPayment = (customer: Customer) => {
    setPaymentCustomer(customer);
    setPaymentAmount(customer.balance);
  };

  const recordPayment = async (event: FormEvent) => {
    event.preventDefault();
    if (!paymentCustomer) return;
    const received = Math.min(Math.max(paymentAmount, 0), paymentCustomer.balance);

    let remaining = received;
    const outstandingInvoices = invoices
      .filter((inv) => inv.customer === paymentCustomer.name && Number(inv.total) > Number(inv.paid))
      .sort((a, b) => a.date.localeCompare(b.date));
    for (const inv of outstandingInvoices) {
      if (remaining <= 0) break;
      const due = Number(inv.total) - Number(inv.paid);
      const apply = Math.min(due, remaining);
      const newPaid = Number(inv.paid) + apply;
      await updateInvoice(inv.id, { paid: newPaid, status: newPaid >= Number(inv.total) ? 'paid' : 'partial' });
      remaining -= apply;
    }

    await adjust(paymentCustomer.id, -received);
    setFeedback(`₹${received.toLocaleString()} payment received from ${paymentCustomer.name}.`);
    setPaymentCustomer(null);
  };

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Customer Ledger & Directory</h1><p className="page-subtitle">Track accounts receivable, GST numbers and purchase histories</p></div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> Add New Customer</button></div>

      {feedback && <div className="alert alert-success mb-4" role="status">{feedback}</div>}

      <div className="grid-4 mb-6">
        {customers.length === 0 && (
          <div className="card" style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
            {loading ? 'Loading customers…' : 'No customers yet — add your first customer to get started.'}
          </div>
        )}
        {customers.map((customer) => <div key={customer.id} className="card flex flex-col justify-between">
          <div><div className="flex justify-between items-start mb-2"><span className="badge badge-info">{customer.type.toUpperCase()}</span><span className="customer-gstin">GSTIN: {customer.gstin || 'Not provided'}</span></div>
            <h3 className="directory-card-title">{customer.name}</h3>
            <div className="directory-details"><div className="flex items-center gap-2"><Phone size={13} /><span>{customer.phone || 'No phone'}</span></div><div className="flex items-center gap-2"><Mail size={13} /><span>{customer.email || 'No email'}</span></div><div className="flex items-center gap-2"><MapPin size={13} /><span className="truncate">{customer.address || 'No address'}</span></div></div>
          </div>
          <div className="directory-financials"><div><small>Outstanding</small><strong className={customer.balance > 0 ? 'text-danger' : 'text-success'}>₹{customer.balance.toLocaleString()}</strong></div></div>
          <div className="flex gap-2 mt-2">
            <button className="btn btn-secondary btn-sm w-full" style={{ justifyContent: 'center' }} disabled={!customer.balance} onClick={() => openPayment(customer)}>Received</button>
            <button className="btn btn-ghost btn-sm" aria-label={`Draft payment reminder for ${customer.name}`} title="Draft a payment reminder" disabled={!customer.balance} onClick={() => setReminderCustomer(customer)}><Sparkles size={14} /></button>
          </div>
        </div>)}
      </div>

      {showModal && (
        <AddCustomerModal
          onClose={() => setShowModal(false)}
          onSave={create}
          onCreated={(customer) => { setShowModal(false); setFeedback(`${customer.name} added to the customer directory.`); }}
        />
      )}

      {paymentCustomer && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '440px' }} role="dialog" aria-modal="true" aria-labelledby="payment-modal-title"><form onSubmit={recordPayment}>
        <div className="modal-header"><h3 id="payment-modal-title" className="modal-title">Record Payment Received</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setPaymentCustomer(null)}>✕</button></div>
        <div className="modal-body flex flex-col gap-4"><p>Outstanding balance for <strong>{paymentCustomer.name}</strong>: ₹{paymentCustomer.balance.toLocaleString()}</p><div className="form-group"><label className="form-label">Amount Received (₹)</label><input type="number" min="1" max={paymentCustomer.balance} className="form-input" value={paymentAmount} onChange={(event) => setPaymentAmount(Number(event.target.value))} /></div></div>
        <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setPaymentCustomer(null)}>Cancel</button><button type="submit" className="btn btn-primary">Record Payment</button></div>
      </form></div></div>}

      {reminderCustomer && (
        <PaymentReminderModal
          direction="receivable"
          name={reminderCustomer.name}
          balance={reminderCustomer.balance}
          context={overdueContext(reminderCustomer.name)}
          onClose={() => setReminderCustomer(null)}
        />
      )}
    </div>
  );
}
