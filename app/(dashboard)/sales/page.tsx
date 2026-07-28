'use client';

import { FormEvent, useState } from 'react';
import { Plus, Printer, Search, Eye, Pencil, Trash2, ArrowRight, ArrowLeft } from 'lucide-react';
import { printCurrentPage } from '@/lib/client-export';
import { useCompanyTable } from '@/lib/useCompanyTable';

type SalesTab = 'invoices' | 'quotations';
type PaymentStatus = 'paid' | 'partial' | 'unpaid';
type InvoiceLine = { part: string; qty: number; price: number };

type Product = { id: string; company_id: string; part_number: string; name: string; category: string; sale_price: number; current_stock: number };
type Customer = { id: string; company_id: string; name: string; balance: number; credit_limit: number };
type Invoice = { id: string; company_id: string; customer: string; date: string; items: number; total: number; paid: number; status: string; mode: string; discount_percent: number; discount_amount: number };
type Quotation = { id: string; company_id: string; customer: string; date: string; validity: string; total: number; status: string };
type InvoiceItem = { id: string; invoice_id: string; product_id: string | null; part_number: string; name: string; qty: number; unit_price: number; line_total: number };

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

function nextId(rows: Array<{ id: string }>, prefix: string) {
  const maxNum = rows.reduce((max, row) => {
    const match = row.id.match(/(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 1000);
  return `${prefix}-${maxNum + 1}`;
}

export default function SalesPage() {
  const { rows: products, adjust: adjustProduct } = useCompanyTable<Product>('products');
  const { rows: customers, adjust: adjustCustomer } = useCompanyTable<Customer>('customers');
  const { rows: invoices, loading: invoicesLoading, create: createInvoice, update: updateInvoice, remove: removeInvoice } = useCompanyTable<Invoice>('invoices');
  const { rows: quotations, loading: quotationsLoading } = useCompanyTable<Quotation>('quotations');
  const { rows: invoiceItems, create: createInvoiceItem, remove: removeInvoiceItem } = useCompanyTable<InvoiceItem>('invoice_items');

  const partOptions = products.map((product) => ({
    value: `${product.part_number} - ${product.name}`,
    price: product.sale_price,
    category: product.category,
  }));

  const [activeTab, setActiveTab] = useState<SalesTab>('invoices');
  const [search, setSearch] = useState('');
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Invoice | null>(null);
  const [feedback, setFeedback] = useState('');
  const [customer, setCustomer] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [gstPercent, setGstPercent] = useState(18);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('unpaid');
  const [amountPaid, setAmountPaid] = useState(0);

  const subtotal = lines.reduce((sum, line) => sum + line.qty * line.price, 0);
  const discountAmount = subtotal * (discountPercent / 100);
  const total = subtotal - discountAmount;
  const includedGst = gstPercent > 0 ? total - total / (1 + gstPercent / 100) : 0;
  const paidAmount = paymentStatus === 'paid' ? total : paymentStatus === 'partial' ? Math.min(Math.max(amountPaid, 0), total) : 0;

  const selectedCustomer = customers.find((c) => c.name === customer);
  const editingOldOutstanding = editingInvoice ? Number(editingInvoice.total) - Number(editingInvoice.paid) : 0;
  const isEditingSameCustomer = !!editingInvoice && editingInvoice.customer === customer;
  const balanceBeforeThisInvoice = Number(selectedCustomer?.balance ?? 0) - (isEditingSameCustomer ? editingOldOutstanding : 0);
  const newOutstanding = total - paidAmount;
  const projectedBalance = balanceBeforeThisInvoice + newOutstanding;
  const overCreditLimit = !!selectedCustomer && Number(selectedCustomer.credit_limit) > 0 && projectedBalance > Number(selectedCustomer.credit_limit);

  const filteredInvoices = invoices.filter((invoice) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    const items = invoiceItems.filter((item) => item.invoice_id === invoice.id).map((item) => item.name).join(' ');
    return invoice.id.toLowerCase().includes(query) || invoice.customer.toLowerCase().includes(query) || items.toLowerCase().includes(query);
  });

  const totalRevenue = invoices.reduce((t, inv) => t + Number(inv.total || 0), 0);
  const avgOrderValue = invoices.length > 0 ? totalRevenue / invoices.length : 0;
  const outstandingDue = invoices.reduce((t, inv) => t + Math.max(0, Number(inv.total) - Number(inv.paid)), 0);
  const productRevenue = new Map<string, number>();
  for (const item of invoiceItems) {
    productRevenue.set(item.name, (productRevenue.get(item.name) ?? 0) + Number(item.line_total || 0));
  }
  const topProduct = Array.from(productRevenue.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];

  const openInvoice = (presetCustomer?: string) => {
    setEditingInvoice(null);
    setCustomer(presetCustomer ?? customers[0]?.name ?? '');
    setLines(partOptions.length > 0 ? [{ part: partOptions[0].value, qty: 1, price: partOptions[0].price }] : []);
    setDiscountPercent(0);
    setGstPercent(18);
    setInvoiceDate(todayIso());
    setPaymentStatus('unpaid');
    setAmountPaid(0);
    setShowInvoiceModal(true);
  };

  const openEditInvoice = (invoice: Invoice) => {
    const items = invoiceItems.filter((item) => item.invoice_id === invoice.id);
    setEditingInvoice(invoice);
    setCustomer(invoice.customer);
    setInvoiceDate(invoice.date);
    setDiscountPercent(Number(invoice.discount_percent));
    setGstPercent(18);
    setLines(items.map((item) => ({ part: `${item.part_number} - ${item.name}`, qty: Number(item.qty), price: Number(item.unit_price) })));
    const paid = Number(invoice.paid);
    const invoiceTotal = Number(invoice.total);
    setPaymentStatus(paid >= invoiceTotal && invoiceTotal > 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid');
    setAmountPaid(paid);
    setShowInvoiceModal(true);
  };

  const updateLine = (index: number, patch: Partial<InvoiceLine>) => {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  };

  const saveInvoice = async (event: FormEvent) => {
    event.preventDefault();

    if (editingInvoice) {
      const oldItems = invoiceItems.filter((item) => item.invoice_id === editingInvoice.id);

      // Net stock delta per product across both the reversal and the new lines, applied once each,
      // so a product appearing in both the old and new item sets doesn't get overwritten mid-edit.
      const stockDelta = new Map<string, number>();
      for (const item of oldItems) {
        if (item.product_id) stockDelta.set(item.product_id, (stockDelta.get(item.product_id) ?? 0) + Number(item.qty));
      }
      for (const line of lines) {
        const product = products.find((p) => `${p.part_number} - ${p.name}` === line.part);
        if (product) stockDelta.set(product.id, (stockDelta.get(product.id) ?? 0) - line.qty);
      }

      for (const item of oldItems) {
        await removeInvoiceItem(item.id);
      }
      for (const line of lines) {
        const product = products.find((p) => `${p.part_number} - ${p.name}` === line.part);
        await createInvoiceItem({
          invoice_id: editingInvoice.id,
          product_id: product?.id ?? null,
          part_number: product?.part_number ?? '',
          name: product?.name ?? line.part,
          qty: line.qty,
          unit_price: line.price,
          line_total: line.qty * line.price,
        });
      }
      for (const [productId, delta] of stockDelta.entries()) {
        if (delta === 0) continue;
        await adjustProduct(productId, delta);
      }

      const oldCustomerRow = customers.find((c) => c.name === editingInvoice.customer);
      const newCustomerRow = customers.find((c) => c.name === customer);
      if (oldCustomerRow && newCustomerRow && oldCustomerRow.id === newCustomerRow.id) {
        await adjustCustomer(oldCustomerRow.id, newOutstanding - editingOldOutstanding);
      } else {
        if (oldCustomerRow) await adjustCustomer(oldCustomerRow.id, -editingOldOutstanding);
        if (newCustomerRow) await adjustCustomer(newCustomerRow.id, newOutstanding);
      }

      await updateInvoice(editingInvoice.id, {
        customer,
        date: invoiceDate,
        items: lines.reduce((sum, line) => sum + line.qty, 0),
        total,
        paid: paidAmount,
        status: paidAmount >= total && total > 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid',
        discount_percent: discountPercent,
        discount_amount: discountAmount,
      });

      setShowInvoiceModal(false);
      setEditingInvoice(null);
      setFeedback(`${editingInvoice.id} updated.`);
      return;
    }

    const id = nextId(invoices, 'INV');
    await createInvoice({
      id,
      customer,
      date: invoiceDate,
      items: lines.reduce((sum, line) => sum + line.qty, 0),
      total,
      paid: paidAmount,
      status: paidAmount >= total && total > 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid',
      mode: 'Credit',
      discount_percent: discountPercent,
      discount_amount: discountAmount,
    });

    for (const line of lines) {
      const product = products.find((p) => `${p.part_number} - ${p.name}` === line.part);
      await createInvoiceItem({
        invoice_id: id,
        product_id: product?.id ?? null,
        part_number: product?.part_number ?? '',
        name: product?.name ?? line.part,
        qty: line.qty,
        unit_price: line.price,
        line_total: line.qty * line.price,
      });
      if (product) {
        await adjustProduct(product.id, -line.qty);
      }
    }

    if (selectedCustomer) {
      await adjustCustomer(selectedCustomer.id, newOutstanding);
    }

    setShowInvoiceModal(false);
    setActiveTab('invoices');
    setFeedback(`${id} generated for ${customer}.`);
  };

  const confirmDeleteInvoice = async () => {
    if (!deleteCandidate) return;
    const items = invoiceItems.filter((item) => item.invoice_id === deleteCandidate.id);
    for (const item of items) {
      if (item.product_id) {
        await adjustProduct(item.product_id, Number(item.qty));
      }
      await removeInvoiceItem(item.id);
    }
    const custRow = customers.find((c) => c.name === deleteCandidate.customer);
    if (custRow) {
      const due = Number(deleteCandidate.total) - Number(deleteCandidate.paid);
      await adjustCustomer(custRow.id, -due);
    }
    await removeInvoice(deleteCandidate.id);
    setFeedback(`${deleteCandidate.id} deleted — stock and customer balance reversed.`);
    setDeleteCandidate(null);
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Sales Management</h1><p className="page-subtitle">Invoices, billing and quotations</p></div>
        <button className="btn btn-primary" onClick={() => openInvoice()} disabled={customers.length === 0}><Plus size={16} /> Create Sales Invoice</button>
      </div>

      {feedback && <div className="alert alert-success mb-4" role="status">{feedback}</div>}

      {activeTab === 'invoices' && (
        <>
          <div className="flex justify-between items-center mb-4">
            <div className="ms">
              <div className="msc"><div className="msv text-brand">₹{totalRevenue.toLocaleString()}</div><div className="msl">Total Revenue</div></div>
              <div className="msc"><div className="msv text-info">{invoices.length}</div><div className="msl">Transactions</div></div>
              <div className="msc"><div className="msv text-success">₹{avgOrderValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div><div className="msl">Avg Order Value</div></div>
              <div className="msc"><div className="msv text-brand truncate" style={{ maxWidth: '160px' }}>{topProduct ?? '—'}</div><div className="msl">Top Product</div></div>
              <div className="msc"><div className="msv text-danger">₹{outstandingDue.toLocaleString()}</div><div className="msl">Outstanding Due</div></div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setActiveTab('quotations')}>Quotations ({quotations.length}) <ArrowRight size={14} /></button>
          </div>
          <div className="card mb-4 p-4">
            <div className="search-bar">
              <Search className="search-bar-icon" size={16} />
              <input type="text" placeholder="Search invoice, customer, product..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="table-wrap"><table className="erp-table">
            <thead><tr><th>Invoice #</th><th>Date</th><th>Customer</th><th>Products</th><th>Units</th><th className="text-right">Discount</th><th className="text-right">Grand Total</th><th>Payment</th><th className="text-center">Actions</th></tr></thead>
            <tbody>{filteredInvoices.map((invoice) => {
              const balance = Number(invoice.total) - Number(invoice.paid);
              const items = invoiceItems.filter((item) => item.invoice_id === invoice.id);
              const productLabel = items[0]?.name ?? (invoice.items > 0 ? 'Legacy sale' : '—');
              return <tr key={invoice.id}>
                <td style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>{invoice.id}</td>
                <td className="text-muted">{invoice.date}</td>
                <td style={{ fontWeight: 600 }}>{invoice.customer}</td>
                <td>
                  <span style={{ fontWeight: 600 }}>{productLabel}</span>
                  {items.length > 0 && <span className="badge badge-muted" style={{ marginLeft: '6px' }}>{items.length} item{items.length > 1 ? 's' : ''}</span>}
                </td>
                <td>{invoice.items} units</td>
                <td className="text-right">
                  {Number(invoice.discount_amount) > 0
                    ? <span className="text-danger">-₹{Number(invoice.discount_amount).toLocaleString(undefined, { maximumFractionDigits: 0 })} ({Number(invoice.discount_percent).toFixed(0)}%)</span>
                    : <span className="text-muted">—</span>}
                </td>
                <td className="text-right font-semibold text-success">₹{Number(invoice.total).toLocaleString()}</td>
                <td>{balance > 0 ? <span className="badge badge-warning">Due ₹{balance.toLocaleString()}</span> : <span className="badge badge-success">Paid</span>}</td>
                <td className="text-center"><div className="flex justify-between gap-1 items-center">
                  <button className="btn btn-ghost btn-sm" aria-label={`View ${invoice.id}`} title="View invoice" onClick={() => setViewingInvoice(invoice)}><Eye size={14} /></button>
                  <button
                    className="btn btn-ghost btn-sm"
                    aria-label={`Edit ${invoice.id}`}
                    title={items.length > 0 ? 'Edit invoice' : "Edit unavailable — this invoice predates line-item tracking"}
                    disabled={items.length === 0}
                    style={items.length === 0 ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                    onClick={() => items.length > 0 && openEditInvoice(invoice)}
                  ><Pencil size={14} /></button>
                  <button className="btn btn-ghost btn-sm" aria-label={`Print ${invoice.id}`} title="Print invoice" onClick={printCurrentPage}><Printer size={14} /></button>
                  <button className="btn btn-ghost btn-sm" aria-label={`Delete ${invoice.id}`} title="Delete invoice" style={{ color: 'var(--color-danger)' }} onClick={() => setDeleteCandidate(invoice)}><Trash2 size={14} /></button>
                </div></td>
              </tr>;
            })}
            {filteredInvoices.length === 0 && (
              <tr><td colSpan={9}><div className="empty-state"><p className="empty-state-title">{invoicesLoading ? 'Loading invoices…' : search ? 'No invoices match your search' : 'No invoices yet'}</p><p className="empty-state-desc">{invoicesLoading ? 'Fetching records for the active company.' : search ? 'Try a different search term.' : 'Create your first sales invoice to get started.'}</p></div></td></tr>
            )}
            </tbody>
          </table></div>
        </>
      )}

      {activeTab === 'quotations' && (
        <>
        <button className="btn btn-ghost btn-sm mb-4" onClick={() => setActiveTab('invoices')}><ArrowLeft size={14} /> Back to Invoices</button>
        <div className="table-wrap"><table className="erp-table">
          <thead><tr><th>Quote #</th><th>Customer Name</th><th>Quote Date</th><th>Valid Until</th><th className="text-right">Total Amount</th><th>Status</th><th className="text-center">Convert</th></tr></thead>
          <tbody>{quotations.map((quote) => <tr key={quote.id}>
            <td style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>{quote.id}</td><td style={{ fontWeight: 600 }}>{quote.customer}</td><td className="text-muted">{quote.date}</td><td>{quote.validity}</td><td className="text-right font-semibold">₹{quote.total.toLocaleString()}</td>
            <td><span className={`badge ${quote.status === 'accepted' ? 'badge-success' : 'badge-info'}`}>{quote.status.toUpperCase()}</span></td>
            <td className="text-center"><button className="btn btn-secondary btn-sm" onClick={() => openInvoice(quote.customer)}>Convert to Invoice →</button></td>
          </tr>)}
          {quotations.length === 0 && (
            <tr><td colSpan={7}><div className="empty-state"><p className="empty-state-title">{quotationsLoading ? 'Loading quotations…' : 'No quotations yet'}</p><p className="empty-state-desc">{quotationsLoading ? 'Fetching records for the active company.' : 'This company has no quotations on file.'}</p></div></td></tr>
          )}
          </tbody>
        </table></div>
        </>
      )}

      {viewingInvoice && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '560px' }} role="dialog" aria-modal="true" aria-labelledby="view-invoice-title">
        <div className="modal-header"><h3 id="view-invoice-title" className="modal-title">{viewingInvoice.id}</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setViewingInvoice(null)}>✕</button></div>
        <div className="modal-body flex flex-col gap-4">
          <div className="flex justify-between"><div><small className="text-muted">Customer</small><div style={{ fontWeight: 600 }}>{viewingInvoice.customer}</div></div><div><small className="text-muted">Date</small><div style={{ fontWeight: 600 }}>{viewingInvoice.date}</div></div></div>
          <div className="table-wrap"><table className="erp-table">
            <thead><tr><th>Product</th><th className="text-right">Qty</th><th className="text-right">Unit Price</th><th className="text-right">Line Total</th></tr></thead>
            <tbody>
              {invoiceItems.filter((item) => item.invoice_id === viewingInvoice.id).map((item) => (
                <tr key={item.id}><td>{item.name}</td><td className="text-right">{item.qty}</td><td className="text-right">₹{Number(item.unit_price).toLocaleString()}</td><td className="text-right">₹{Number(item.line_total).toLocaleString()}</td></tr>
              ))}
              {invoiceItems.filter((item) => item.invoice_id === viewingInvoice.id).length === 0 && (
                <tr><td colSpan={4}><p className="text-muted text-sm" style={{ padding: '12px 0' }}>Line items weren&apos;t recorded for this older invoice — only the total is available.</p></td></tr>
              )}
            </tbody>
          </table></div>
          <div className="report-summary">
            {Number(viewingInvoice.discount_amount) > 0 && <div className="report-line"><span>Discount ({Number(viewingInvoice.discount_percent).toFixed(0)}%)</span><span className="text-danger">-₹{Number(viewingInvoice.discount_amount).toLocaleString()}</span></div>}
            <div className="report-line report-strong"><span>Total</span><strong>₹{Number(viewingInvoice.total).toLocaleString()}</strong></div>
            <div className="report-line"><span>Paid</span><strong className="text-success">₹{Number(viewingInvoice.paid).toLocaleString()}</strong></div>
            <div className="report-line"><span>Balance</span><strong className="text-danger">₹{(Number(viewingInvoice.total) - Number(viewingInvoice.paid)).toLocaleString()}</strong></div>
          </div>
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setViewingInvoice(null)}>Close</button></div>
      </div></div>}

      {deleteCandidate && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '440px' }} role="dialog" aria-modal="true" aria-labelledby="delete-invoice-title">
        <div className="modal-header"><h3 id="delete-invoice-title" className="modal-title">Delete invoice?</h3></div>
        <div className="modal-body">
          <p>This will delete <strong>{deleteCandidate.id}</strong>, add its items back to stock, and reduce {deleteCandidate.customer}&apos;s balance by the outstanding ₹{(Number(deleteCandidate.total) - Number(deleteCandidate.paid)).toLocaleString()}.</p>
        </div>
        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setDeleteCandidate(null)}>Cancel</button><button className="btn btn-danger" onClick={confirmDeleteInvoice}>Delete Invoice</button></div>
      </div></div>}

      {showInvoiceModal && (
        <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '880px' }} role="dialog" aria-modal="true" aria-labelledby="invoice-modal-title">
          <form onSubmit={saveInvoice}>
            <div className="modal-header"><h3 id="invoice-modal-title" className="modal-title">{editingInvoice ? `Edit ${editingInvoice.id}` : 'Create Sales Invoice'}</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => { setShowInvoiceModal(false); setEditingInvoice(null); }}>✕</button></div>
            <div className="modal-body flex flex-col gap-4">
              <div className="form-grid-2"><div className="form-group"><label className="form-label">Customer *</label><select className="form-input form-select" value={customer} onChange={(event) => setCustomer(event.target.value)}>{customers.map((c) => <option key={c.id}>{c.name}</option>)}</select></div>
                <div className="form-group"><label className="form-label">Invoice Date</label><input type="date" className="form-input" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} /></div></div>
              <div className="card card-sm bg-surface"><h4 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>Invoice Line Items</h4>
                {partOptions.length === 0 && <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Add parts in Inventory before creating an invoice.</p>}
                {lines.map((line, index) => {
                  const category = partOptions.find((part) => part.value === line.part)?.category ?? '-';
                  return <div key={index} className="form-grid-4 mb-2">
                    <div className="form-group"><label className="form-label">Select Part</label><select className="form-input form-select" value={line.part} onChange={(event) => { const selected = partOptions.find((part) => part.value === event.target.value); updateLine(index, { part: event.target.value, price: selected?.price ?? line.price }); }}>{partOptions.map((part) => <option key={part.value}>{part.value}</option>)}</select></div>
                    <div className="form-group"><label className="form-label">Category</label><input type="text" className="form-input" value={category} disabled /></div>
                    <div className="form-group"><label className="form-label">Qty</label><input type="number" min="1" className="form-input" value={line.qty} onChange={(event) => updateLine(index, { qty: Number(event.target.value) })} /></div>
                    <div className="form-group"><label className="form-label">Unit Price (₹)</label><input type="number" min="0" className="form-input" value={line.price} onChange={(event) => updateLine(index, { price: Number(event.target.value) })} /></div>
                  </div>;
                })}
                {partOptions.length > 0 && <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => setLines((current) => [...current, { part: partOptions[0].value, qty: 1, price: partOptions[0].price }])}>+ Add Item Row</button>}
              </div>
              <div className="form-grid-2">
                <div className="form-group"><label className="form-label">Discount (%)</label><input type="number" min="0" max="100" step="0.1" className="form-input" value={discountPercent} onChange={(event) => setDiscountPercent(Math.min(100, Math.max(0, Number(event.target.value))))} /></div>
                <div className="form-group"><label className="form-label">Discount Amount (₹)</label><input type="text" className="form-input" value={discountAmount.toFixed(2)} disabled /></div>
              </div>
              <div className="form-grid-2">
                <div className="form-group"><label className="form-label">GST Rate (%)</label><input type="number" min="0" max="28" step="0.1" className="form-input" value={gstPercent} onChange={(event) => setGstPercent(Math.min(28, Math.max(0, Number(event.target.value))))} /></div>
                <div className="form-group"><label className="form-label">GST Amount (₹, included in total)</label><input type="text" className="form-input" value={includedGst.toFixed(2)} disabled /></div>
              </div>
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Payment Received</label>
                  <select className="form-input form-select" value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value as PaymentStatus)}>
                    <option value="paid">Paid in Full</option>
                    <option value="partial">Partially Paid</option>
                    <option value="unpaid">Unpaid (Credit)</option>
                  </select>
                </div>
                {paymentStatus === 'partial' && (
                  <div className="form-group"><label className="form-label">Amount Received (₹)</label><input type="number" min="0" max={total} className="form-input" value={amountPaid} onChange={(event) => setAmountPaid(Number(event.target.value))} /></div>
                )}
              </div>
              <div className="flex justify-between items-center invoice-summary">
                <div><span className="text-muted">Subtotal: </span><strong>₹{subtotal.toLocaleString()}</strong></div>
                {discountAmount > 0 && <div><span className="text-muted">Discount: </span><strong className="text-danger">-₹{discountAmount.toFixed(2)}</strong></div>}
                <div><span className="text-muted">GST ({gstPercent}% included): </span><strong>₹{includedGst.toFixed(2)}</strong></div>
                <div><span className="text-muted">Received: </span><strong className="text-success">₹{paidAmount.toLocaleString()}</strong></div>
                <div><strong>Total Payable: </strong><span className="invoice-total">₹{total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
              </div>
              {overCreditLimit && selectedCustomer && (
                <div className="alert alert-warning" role="alert">
                  This will put {selectedCustomer.name} ₹{(projectedBalance - Number(selectedCustomer.credit_limit)).toLocaleString()} over their ₹{Number(selectedCustomer.credit_limit).toLocaleString()} credit limit (new balance would be ₹{projectedBalance.toLocaleString()}). You can still save this invoice.
                </div>
              )}
            </div>
            <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => { setShowInvoiceModal(false); setEditingInvoice(null); }}>Cancel</button><button type="submit" className="btn btn-primary" disabled={!total || !customer}>{editingInvoice ? 'Save Changes' : 'Generate & Save Invoice'}</button></div>
          </form>
        </div></div>
      )}
    </div>
  );
}
