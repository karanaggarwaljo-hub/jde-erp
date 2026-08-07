'use client';

import { FormEvent, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { buildWhatsAppUrl } from './CatalogBrowser';

type Props = {
  catalogProductId: string;
  partTitle: string;
  partNumber: string;
  /** The storefront company's quote-request phone, if set — used only for the "message us on
   *  WhatsApp now" fallback shown after a successful submission. Graceful-hides like every other
   *  WhatsApp button in this feature when there's no usable number. */
  contactPhone?: string | null;
};

type FormState = {
  customerName: string;
  customerPhone: string;
  quantity: string;
  machineModel: string;
  message: string;
};

const INITIAL_FORM: FormState = { customerName: '', customerPhone: '', quantity: '1', machineModel: '', message: '' };

export default function RfqForm({ catalogProductId, partTitle, partNumber, contactPhone }: Props) {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const waHref = buildWhatsAppUrl(
    contactPhone,
    `Hi, I just requested a quote for: ${partTitle}${partNumber ? ` (Part #: ${partNumber})` : ''} on your website. Following up here.`
  );

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!form.customerName.trim() || !form.customerPhone.trim()) {
      setError('Please enter your name and phone/WhatsApp number.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/catalog-rfq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          catalogProductId,
          partTitle,
          partNumber,
          customerName: form.customerName.trim(),
          customerPhone: form.customerPhone.trim(),
          quantity: form.quantity.trim() ? Number(form.quantity) : 1,
          machineModel: form.machineModel.trim() || null,
          message: form.message.trim() || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not submit your request. Please try again.');
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit your request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="card">
        <div className="alert alert-success" role="alert">
          Thanks — we&apos;ll get back to you during business hours (Mon–Sat, 9:30 AM–7 PM).
        </div>
        {waHref && (
          <a href={waHref} target="_blank" rel="noreferrer" className="btn btn-secondary mt-4">
            <MessageCircle size={16} /> Message us on WhatsApp now
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header"><h3 className="card-title">Request a Quote</h3></div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <div className="alert alert-danger" role="alert">{error}</div>}
        <div className="form-grid-2">
          <div className="form-group">
            <label className="form-label">Your Name *</label>
            <input className="form-input" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} required />
          </div>
          <div className="form-group">
            <label className="form-label">Phone / WhatsApp Number *</label>
            <input className="form-input" type="tel" value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} required />
          </div>
          <div className="form-group">
            <label className="form-label">Quantity</label>
            <input className="form-input" type="number" min="1" step="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Machine Model (optional)</label>
            <input className="form-input" value={form.machineModel} onChange={(e) => setForm({ ...form, machineModel: e.target.value })} placeholder="e.g. JCB 3DX" />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Message (optional)</label>
          <textarea className="form-input" rows={3} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Anything else we should know?" />
        </div>
        <div>
          <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Sending…' : 'Send Request'}</button>
        </div>
      </form>
    </div>
  );
}
