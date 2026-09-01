'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import { useCompany } from '@/components/CompanyProvider';
import { useCompanyTable } from '@/lib/useCompanyTable';

// Copied verbatim from app/(dashboard)/sales/page.tsx (search `type Invoice =` / `type InvoiceItem =`
// / `type Customer =` there) — that file is the source of truth for these shapes and doesn't export
// them, so they're redeclared here rather than imported. Keep in sync if that file's shapes change.
type Invoice = {
  id: string;
  company_id: string;
  customer: string;
  date: string;
  items: number;
  total: number;
  paid: number;
  status: string;
  mode: string;
  discount_percent: number;
  discount_amount: number;
};
type InvoiceItem = {
  id: string;
  invoice_id: string;
  product_id: string | null;
  part_number: string;
  name: string;
  qty: number;
  unit_price: number;
  line_total: number;
  discount_percent?: number;
  discount_amount?: number;
};
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

// Same Indian digit-grouping convention as the `money` helper in app/(dashboard)/sales/page.tsx,
// so every figure on the printed invoice reads identically to the rest of the app.
const money = (value: number) => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export default function SalesInvoicePrintPage() {
  const { id } = useParams<{ id: string }>();
  const { activeCompany } = useCompany();
  const { rows: invoices, loading: invoicesLoading } = useCompanyTable<Invoice>('invoices');
  const { rows: invoiceItems, loading: itemsLoading } = useCompanyTable<InvoiceItem>('invoice_items');
  const { rows: customers } = useCompanyTable<Customer>('customers');

  const loading = invoicesLoading || itemsLoading;
  const invoice = invoices.find((row) => row.id === id);

  if (loading && !invoice) {
    return <div className="empty-state"><p className="empty-state-title">Loading invoice…</p></div>;
  }

  if (!invoice) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Invoice not found</p>
        <p className="empty-state-desc">It may have been deleted, or belongs to a different company.</p>
        <Link href="/sales" className="btn btn-secondary" style={{ marginTop: '14px' }}><ArrowLeft size={14} /> Back to Sales</Link>
      </div>
    );
  }

  const items = invoiceItems.filter((item) => item.invoice_id === invoice.id);
  const customer = customers.find((row) => row.name === invoice.customer);
  const balanceDue = Number(invoice.total) - Number(invoice.paid);
  const discountAmount = Number(invoice.discount_amount || 0);

  // Subtotal and GST are not columns on the invoice row itself — only `total`, `discount_percent`
  // and `discount_amount` are (see the Invoice type above, copied from the sales page). When line
  // items were recorded, both are exact reconstructions from numbers that ARE stored: summing each
  // line's `line_total` reproduces the same subtotal the sales page's invoice form summed at save
  // time, and `total - (subtotal - discount)` reverses the same formula that form uses to arrive at
  // `total` (see `saveInvoice` in app/(dashboard)/sales/page.tsx: taxableAmount = subtotal -
  // discountAmount; total = taxableAmount + gstAmount). This is exact arithmetic on real stored
  // figures, not an estimate, so it's shown. Invoices that predate line-item tracking have nothing
  // to reconstruct it from, so the subtotal/GST rows are simply left out for them.
  const subtotal = items.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
  // Only worth a column when the invoice actually uses per-line discounts.
  const anyLineDiscount = items.some((item) => Number(item.discount_percent) > 0);
  const lineDiscountTotal = items.reduce((sum, item) => sum + Number(item.discount_amount || 0), 0);
  const gstAmount = items.length > 0 ? Number(invoice.total) - (subtotal - discountAmount) : 0;

  return (
    <div>
      <div className="no-print flex justify-between items-center mb-4">
        <Link href="/sales" className="btn btn-ghost btn-sm"><ArrowLeft size={14} /> Back to Sales</Link>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      <div className="invoice-sheet">
        <div className="invoice-letterhead">
          <div>
            <div className="invoice-company-name">{activeCompany?.name || 'Company'}</div>
            {activeCompany?.address && <div className="text-muted text-sm">{activeCompany.address}</div>}
            <div className="text-muted text-sm">
              {activeCompany?.gstin && <span>GSTIN: {activeCompany.gstin}</span>}
              {activeCompany?.contact_phone && <span>{activeCompany.gstin ? ' · ' : ''}Phone: {activeCompany.contact_phone}</span>}
              {activeCompany?.contact_email && <span>{(activeCompany.gstin || activeCompany.contact_phone) ? ' · ' : ''}{activeCompany.contact_email}</span>}
            </div>
          </div>
          <div className="invoice-heading">
            <div className="invoice-heading-title">TAX INVOICE</div>
            <div className="pn-chip">{invoice.id}</div>
            <div className="text-muted text-sm" style={{ marginTop: '6px' }}>Date: {invoice.date}</div>
          </div>
        </div>

        <div className="invoice-bill-to">
          <small className="text-muted">Bill To</small>
          <div style={{ fontWeight: 600, fontSize: '15px' }}>{invoice.customer}</div>
          {customer?.address && <div className="text-muted text-sm">{customer.address}</div>}
          {(customer?.phone || customer?.gstin) && (
            <div className="text-muted text-sm">
              {customer?.phone && <span>Phone: {customer.phone}</span>}
              {customer?.gstin && <span>{customer.phone ? ' · ' : ''}GSTIN: {customer.gstin}</span>}
            </div>
          )}
        </div>

        <div className="table-wrap">
          <table className="erp-table invoice-items-table">
            <thead>
              <tr>
                <th>Part No.</th>
                <th>Description</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Unit Price</th>
                {anyLineDiscount && <th className="text-right">Discount</th>}
                <th className="text-right">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.part_number || '—'}</td>
                  <td>{item.name}</td>
                  <td className="text-right">{item.qty}</td>
                  <td className="text-right">₹{money(Number(item.unit_price))}</td>
                  {anyLineDiscount && (
                    <td className="text-right">
                      {Number(item.discount_percent) > 0
                        ? `${Number(item.discount_percent)}%  (-₹${money(Number(item.discount_amount ?? 0))})`
                        : '—'}
                    </td>
                  )}
                  <td className="text-right">₹{money(Number(item.line_total))}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={anyLineDiscount ? 6 : 5}><p className="text-muted text-sm" style={{ padding: '12px 0' }}>Line items weren&apos;t recorded for this older invoice — only the total is available.</p></td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="report-summary">
          {items.length > 0 && lineDiscountTotal > 0 && (
            <div className="report-line"><span>Item discounts</span><span className="text-danger">-₹{money(lineDiscountTotal)}</span></div>
          )}
          {items.length > 0 && (
            <div className="report-line"><span>Subtotal{lineDiscountTotal > 0 ? " after item discounts" : ""}</span><span>₹{money(subtotal)}</span></div>
          )}
          {discountAmount > 0 && (
            <div className="report-line"><span>Discount ({Number(invoice.discount_percent).toFixed(0)}%)</span><span className="text-danger">-₹{money(discountAmount)}</span></div>
          )}
          {items.length > 0 && gstAmount > 0.005 && (
            <div className="report-line"><span>GST</span><span>₹{money(gstAmount)}</span></div>
          )}
          <div className="report-line report-strong"><span>Total</span><strong>₹{money(Number(invoice.total))}</strong></div>
          <div className="report-line"><span>Paid</span><strong className="text-success">₹{money(Number(invoice.paid))}</strong></div>
          <div className={`report-line report-strong${balanceDue > 0 ? ' invoice-balance-due' : ''}`}>
            <span>Balance Due</span>
            <strong className={balanceDue > 0 ? 'text-danger' : 'text-success'}>₹{money(balanceDue)}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
