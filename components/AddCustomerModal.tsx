'use client';

import { FormEvent, useState } from 'react';
import { keepEnterInsideForm, SAVE_SHORTCUT_HINT } from '@/lib/form-keys';

const emptyForm = { name: '', phone: '', email: '', gstin: '', address: '', type: 'retail', credit_limit: '' };

type Customer = { id: string; company_id: string; name: string; phone: string; email: string; gstin: string; address: string; type: string; balance: number };

type AddCustomerModalProps = {
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => Promise<Customer>;
  onCreated: (customer: Customer) => void;
  /** Given, the form edits this customer instead of adding one. */
  customer?: Customer & { credit_limit?: number | string | null };
};

const text = (value: unknown) => (value == null ? '' : String(value));

export default function AddCustomerModal({ onClose, onSave, onCreated, customer }: AddCustomerModalProps) {
  const editing = Boolean(customer);
  const [form, setForm] = useState(() => customer ? {
    name: text(customer.name), phone: text(customer.phone), email: text(customer.email), gstin: text(customer.gstin),
    address: text(customer.address), type: text(customer.type) || 'retail',
    credit_limit: Number(customer.credit_limit) > 0 ? String(Number(customer.credit_limit)) : '',
  } : emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const creditLimit = Number(form.credit_limit) > 0 ? Number(form.credit_limit) : null;
      // An edit leaves the name alone: bills, payments and the balance find the customer by it.
      const { name, ...details } = form;
      const created = await onSave(editing ? { ...details, credit_limit: creditLimit } : { ...form, name, credit_limit: creditLimit, balance: 0 });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save this customer — please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay"><div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="add-customer-modal-title"><form onSubmit={handleSubmit} onKeyDown={(event) => keepEnterInsideForm(event, !saving)}>
      <div className="modal-header"><h3 id="add-customer-modal-title" className="modal-title">{editing ? 'Edit customer' : 'Add Customer Account'}</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={onClose}>✕</button></div>
      <div className="modal-body flex flex-col gap-4">
        {error && <div className="alert alert-danger" role="alert">{error}</div>}
        <div className="form-group"><label className="form-label">Customer / Business Name *</label><input className="form-input" required placeholder="e.g. Acme Motors" value={form.name} disabled={editing} onChange={(event) => setForm({ ...form, name: event.target.value })} />{editing && <span className="text-muted" style={{ fontSize: 12 }}>The name stays as it is: bills and payments are linked to it.</span>}</div>
        <div className="form-grid-2">
          <div className="form-group"><label className="form-label">Phone</label><input className="form-input" placeholder="10-digit number" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div>
          <div className="form-group"><label className="form-label">Email</label><input type="email" className="form-input" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div>
        </div>
        <div className="form-grid-2">
          <div className="form-group"><label className="form-label">GSTIN</label><input className="form-input" placeholder="GST Number" value={form.gstin} onChange={(event) => setForm({ ...form, gstin: event.target.value })} /></div>
          <div className="form-group"><label className="form-label">Customer Type</label><select className="form-input form-select" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option value="retail">Retail</option><option value="wholesale">Wholesale</option><option value="dealer">Dealer</option></select></div>
        </div>
        <div className="form-group"><label className="form-label">Credit limit (₹)</label><input type="number" min="0" step="1" className="form-input" placeholder="Leave blank for no limit" value={form.credit_limit} onChange={(event) => setForm({ ...form, credit_limit: event.target.value })} /><span className="text-muted" style={{ fontSize: 12 }}>The most this customer may owe. Billing warns you before going over it.</span></div>
        <div className="form-group"><label className="form-label" htmlFor="customer-address">Billing Address</label><textarea id="customer-address" className="form-input" rows={3} placeholder="Full postal address" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></div>
      </div>
      <div className="modal-footer"><span className="text-muted text-sm" style={{ marginRight: 'auto' }}>{SAVE_SHORTCUT_HINT}</span><button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Save Customer'}</button></div>
    </form></div></div>
  );
}
