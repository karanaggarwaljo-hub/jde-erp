'use client';

import { FormEvent, useState } from 'react';

const emptyForm = { name: '', phone: '', email: '', gstin: '', address: '', type: 'retail' };

type Customer = { id: string; company_id: string; name: string; phone: string; email: string; gstin: string; address: string; type: string; balance: number };

type AddCustomerModalProps = {
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => Promise<Customer>;
  onCreated: (customer: Customer) => void;
};

export default function AddCustomerModal({ onClose, onSave, onCreated }: AddCustomerModalProps) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const created = await onSave({ ...form, balance: 0 });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save this customer — please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay"><div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="add-customer-modal-title"><form onSubmit={handleSubmit}>
      <div className="modal-header"><h3 id="add-customer-modal-title" className="modal-title">Add Customer Account</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={onClose}>✕</button></div>
      <div className="modal-body flex flex-col gap-4">
        {error && <div className="alert alert-danger" role="alert">{error}</div>}
        <div className="form-group"><label className="form-label">Customer / Business Name *</label><input className="form-input" required placeholder="e.g. Acme Motors" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
        <div className="form-grid-2">
          <div className="form-group"><label className="form-label">Phone</label><input className="form-input" placeholder="10-digit number" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div>
          <div className="form-group"><label className="form-label">Email</label><input type="email" className="form-input" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div>
        </div>
        <div className="form-grid-2">
          <div className="form-group"><label className="form-label">GSTIN</label><input className="form-input" placeholder="GST Number" value={form.gstin} onChange={(event) => setForm({ ...form, gstin: event.target.value })} /></div>
          <div className="form-group"><label className="form-label">Customer Type</label><select className="form-input form-select" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option value="retail">Retail</option><option value="wholesale">Wholesale</option><option value="dealer">Dealer</option></select></div>
        </div>
        <div className="form-group"><label className="form-label">Billing Address</label><textarea className="form-input" rows={2} placeholder="Full postal address" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></div>
      </div>
      <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Customer'}</button></div>
    </form></div></div>
  );
}
