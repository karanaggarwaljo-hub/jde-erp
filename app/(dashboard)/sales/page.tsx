'use client';

import { FormEvent, useState } from 'react';
import { Plus, Printer, Send, FileText } from 'lucide-react';
import { printCurrentPage } from '@/lib/client-export';

type SalesTab = 'invoices' | 'quotations' | 'orders' | 'returns';
type InvoiceLine = { part: string; qty: number; price: number };

const partOptions = [
  { value: 'SP-001 - Brake Pad Set Front', price: 1100, category: 'Brakes' },
  { value: 'SP-002 - Air Filter Premium', price: 580, category: 'Filters' },
  { value: 'SP-003 - Oil Filter', price: 300, category: 'Filters' },
];

export default function SalesPage() {
  const [activeTab, setActiveTab] = useState<SalesTab>('invoices');
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [customer, setCustomer] = useState('Sharma Auto Works');
  const [invoiceDate, setInvoiceDate] = useState('2026-07-23');
  const [lines, setLines] = useState<InvoiceLine[]>([{ part: partOptions[0].value, qty: 2, price: partOptions[0].price }]);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [invoices, setInvoices] = useState([
    { id: 'INV-1042', customer: 'Sharma Auto Works', date: '2026-07-23', items: 3, total: 18400, paid: 18400, status: 'paid', mode: 'UPI' },
    { id: 'INV-1041', customer: 'City Motors Garage', date: '2026-07-22', items: 5, total: 42500, paid: 20000, status: 'partial', mode: 'Bank Transfer' },
    { id: 'INV-1040', customer: 'Kumar Spare Parts', date: '2026-07-21', items: 2, total: 8200, paid: 0, status: 'unpaid', mode: 'Credit' },
    { id: 'INV-1039', customer: 'Patel Auto Center', date: '2026-07-20', items: 8, total: 95000, paid: 95000, status: 'paid', mode: 'Cheque' },
  ]);

  const quotations = [
    { id: 'QT-1015', customer: 'Kumar Spare Parts', date: '2026-07-23', validity: '2026-07-30', total: 12500, status: 'sent' },
    { id: 'QT-1014', customer: 'City Motors Garage', date: '2026-07-22', validity: '2026-07-29', total: 68000, status: 'accepted' },
  ];

  const subtotal = lines.reduce((sum, line) => sum + line.qty * line.price, 0);
  const discountAmount = subtotal * (discountPercent / 100);
  const total = subtotal - discountAmount;
  const includedGst = total - total / 1.18;

  const openInvoice = (presetCustomer = 'Sharma Auto Works') => {
    setCustomer(presetCustomer);
    setLines([{ part: partOptions[0].value, qty: 1, price: partOptions[0].price }]);
    setDiscountPercent(0);
    setShowInvoiceModal(true);
  };

  const updateLine = (index: number, patch: Partial<InvoiceLine>) => {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  };

  const generateInvoice = (event: FormEvent) => {
    event.preventDefault();
    const nextNumber = 1043 + invoices.length - 4;
    const invoice = {
      id: `INV-${nextNumber}`,
      customer,
      date: invoiceDate,
      items: lines.reduce((sum, line) => sum + line.qty, 0),
      total,
      paid: 0,
      status: 'unpaid',
      mode: 'Credit',
    };
    setInvoices((current) => [invoice, ...current]);
    setShowInvoiceModal(false);
    setActiveTab('invoices');
    setFeedback(`${invoice.id} generated for ${customer}.`);
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Sales Management</h1><p className="page-subtitle">Manage Quotations → Sales Orders → Invoices → Payments & Returns</p></div>
        <button className="btn btn-primary" onClick={() => openInvoice()}><Plus size={16} /> Create Sales Invoice</button>
      </div>

      {feedback && <div className="alert alert-success mb-4" role="status">{feedback}</div>}

      <div className="tabs mb-6">
        <button className={`tab ${activeTab === 'invoices' ? 'active' : ''}`} onClick={() => setActiveTab('invoices')}>Invoices & Billing ({invoices.length})</button>
        <button className={`tab ${activeTab === 'quotations' ? 'active' : ''}`} onClick={() => setActiveTab('quotations')}>Quotations ({quotations.length})</button>
        <button className={`tab ${activeTab === 'orders' ? 'active' : ''}`} onClick={() => setActiveTab('orders')}>Sales Orders</button>
        <button className={`tab ${activeTab === 'returns' ? 'active' : ''}`} onClick={() => setActiveTab('returns')}>Returns & Credit Notes</button>
      </div>

      {activeTab === 'invoices' && (
        <div className="table-wrap"><table className="erp-table">
          <thead><tr><th>Invoice #</th><th>Customer Name</th><th>Date</th><th>Items</th><th className="text-right">Total (₹)</th><th className="text-right">Paid (₹)</th><th className="text-right">Balance (₹)</th><th>Payment Status</th><th className="text-center">Actions</th></tr></thead>
          <tbody>{invoices.map((invoice) => {
            const balance = invoice.total - invoice.paid;
            return <tr key={invoice.id}>
              <td style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>{invoice.id}</td><td style={{ fontWeight: 600 }}>{invoice.customer}</td><td className="text-muted">{invoice.date}</td><td>{invoice.items} Parts</td>
              <td className="text-right font-semibold">₹{invoice.total.toLocaleString()}</td><td className="text-right text-success">₹{invoice.paid.toLocaleString()}</td><td className="text-right text-danger">₹{balance.toLocaleString()}</td>
              <td><span className={`badge ${invoice.status === 'paid' ? 'badge-success' : invoice.status === 'partial' ? 'badge-warning' : 'badge-danger'}`}>{invoice.status.toUpperCase()}</span></td>
              <td className="text-center"><div className="flex justify-between gap-1 items-center">
                <button className="btn btn-ghost btn-sm" aria-label={`Print ${invoice.id}`} title="Print invoice" onClick={printCurrentPage}><Printer size={14} /></button>
                <button className="btn btn-ghost btn-sm" aria-label={`Send ${invoice.id}`} title="Send WhatsApp/Email" onClick={() => setFeedback(`${invoice.id} queued for WhatsApp and email delivery.`)}><Send size={14} /></button>
              </div></td>
            </tr>;
          })}</tbody>
        </table></div>
      )}

      {activeTab === 'quotations' && (
        <div className="table-wrap"><table className="erp-table">
          <thead><tr><th>Quote #</th><th>Customer Name</th><th>Quote Date</th><th>Valid Until</th><th className="text-right">Total Amount</th><th>Status</th><th className="text-center">Convert</th></tr></thead>
          <tbody>{quotations.map((quote) => <tr key={quote.id}>
            <td style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>{quote.id}</td><td style={{ fontWeight: 600 }}>{quote.customer}</td><td className="text-muted">{quote.date}</td><td>{quote.validity}</td><td className="text-right font-semibold">₹{quote.total.toLocaleString()}</td>
            <td><span className={`badge ${quote.status === 'accepted' ? 'badge-success' : 'badge-info'}`}>{quote.status.toUpperCase()}</span></td>
            <td className="text-center"><button className="btn btn-secondary btn-sm" onClick={() => openInvoice(quote.customer)}>Convert to Invoice →</button></td>
          </tr>)}</tbody>
        </table></div>
      )}

      {(activeTab === 'orders' || activeTab === 'returns') && (
        <div className="card empty-state"><FileText size={32} /><p className="empty-state-title">No {activeTab === 'orders' ? 'open sales orders' : 'returns or credit notes'}</p><p className="empty-state-desc">New records will appear here when they are created.</p></div>
      )}

      {showInvoiceModal && (
        <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '880px' }} role="dialog" aria-modal="true" aria-labelledby="invoice-modal-title">
          <form onSubmit={generateInvoice}>
            <div className="modal-header"><h3 id="invoice-modal-title" className="modal-title">Create Sales Invoice</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setShowInvoiceModal(false)}>✕</button></div>
            <div className="modal-body flex flex-col gap-4">
              <div className="form-grid-2"><div className="form-group"><label className="form-label">Customer *</label><select className="form-input form-select" value={customer} onChange={(event) => setCustomer(event.target.value)}><option>Sharma Auto Works</option><option>City Motors Garage</option><option>Kumar Spare Parts</option><option>Patel Auto Center</option></select></div>
                <div className="form-group"><label className="form-label">Invoice Date</label><input type="date" className="form-input" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} /></div></div>
              <div className="card card-sm bg-surface"><h4 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>Invoice Line Items</h4>
                {lines.map((line, index) => {
                  const category = partOptions.find((part) => part.value === line.part)?.category ?? '-';
                  return <div key={index} className="form-grid-4 mb-2">
                    <div className="form-group"><label className="form-label">Select Part</label><select className="form-input form-select" value={line.part} onChange={(event) => { const selected = partOptions.find((part) => part.value === event.target.value); updateLine(index, { part: event.target.value, price: selected?.price ?? line.price }); }}>{partOptions.map((part) => <option key={part.value}>{part.value}</option>)}</select></div>
                    <div className="form-group"><label className="form-label">Category</label><input type="text" className="form-input" value={category} disabled /></div>
                    <div className="form-group"><label className="form-label">Qty</label><input type="number" min="1" className="form-input" value={line.qty} onChange={(event) => updateLine(index, { qty: Number(event.target.value) })} /></div>
                    <div className="form-group"><label className="form-label">Unit Price (₹)</label><input type="number" min="0" className="form-input" value={line.price} onChange={(event) => updateLine(index, { price: Number(event.target.value) })} /></div>
                  </div>;
                })}
                <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => setLines((current) => [...current, { part: partOptions[0].value, qty: 1, price: partOptions[0].price }])}>+ Add Item Row</button>
              </div>
              <div className="form-grid-2">
                <div className="form-group"><label className="form-label">Discount (%)</label><input type="number" min="0" max="100" step="0.1" className="form-input" value={discountPercent} onChange={(event) => setDiscountPercent(Math.min(100, Math.max(0, Number(event.target.value))))} /></div>
                <div className="form-group"><label className="form-label">Discount Amount (₹)</label><input type="text" className="form-input" value={discountAmount.toFixed(2)} disabled /></div>
              </div>
              <div className="flex justify-between items-center invoice-summary">
                <div><span className="text-muted">Subtotal: </span><strong>₹{subtotal.toLocaleString()}</strong></div>
                {discountAmount > 0 && <div><span className="text-muted">Discount: </span><strong className="text-danger">-₹{discountAmount.toFixed(2)}</strong></div>}
                <div><span className="text-muted">GST (18% included): </span><strong>₹{includedGst.toFixed(2)}</strong></div>
                <div><strong>Total Payable: </strong><span className="invoice-total">₹{total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
              </div>
            </div>
            <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setShowInvoiceModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={!total}>Generate & Save Invoice</button></div>
          </form>
        </div></div>
      )}
    </div>
  );
}
