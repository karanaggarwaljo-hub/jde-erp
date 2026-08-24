'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import { useCompany } from '@/components/CompanyProvider';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { getQuotation, type QuotationDetail } from '@/lib/client-quotations';

// Copied from app/(dashboard)/sales/page.tsx (search `type Customer =` there) — that file is the
// source of truth for this shape and doesn't export it.
type Customer = { id: string; company_id: string; name: string; phone: string; email: string; gstin: string; address: string; type: string; balance: number };

// Same Indian digit-grouping convention as the `money` helper in app/(dashboard)/sales/page.tsx and
// the invoice print page, so every figure here reads identically to the rest of the app.
const money = (value: number) => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  converted: 'Converted to Invoice',
  cancelled: 'Cancelled',
};

/**
 * A formatted, printable quotation — the counterpart to app/(dashboard)/sales/invoice/[id], and
 * fixing the same bug that page fixed for invoices: the Quotation view modal's own "Print" button
 * used to call window.print() on the whole dashboard screen, not the quotation.
 *
 * Unlike the invoice page, this one fetches its data live from GET /api/sales/quotation rather
 * than reading an already-loaded table: quotation line items live in jde_quotation_items, which
 * nothing else on this page's route loads into a useCompanyTable cache, and quotations are looked
 * up one at a time (never a list of many open at once) so a dedicated fetch costs nothing extra.
 */
export default function SalesQuotationPrintPage() {
  const { id } = useParams<{ id: string }>();
  const { activeCompany } = useCompany();
  const { rows: customers } = useCompanyTable<Customer>('customers');

  const [quotation, setQuotation] = useState<QuotationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!activeCompany || !id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const detail = await getQuotation(id, activeCompany.id);
        if (!cancelled) setQuotation(detail);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Quotation could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeCompany, id]);

  if (loading) {
    return <div className="empty-state"><p className="empty-state-title">Loading quotation…</p></div>;
  }

  if (error || !quotation) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Quotation not found</p>
        <p className="empty-state-desc">{error || 'It may have been deleted, or belongs to a different company.'}</p>
        <Link href="/sales" className="btn btn-secondary" style={{ marginTop: '14px' }}><ArrowLeft size={14} /> Back to Sales</Link>
      </div>
    );
  }

  // Prefer the id this quotation was actually saved against — more reliable than a name match,
  // and available on every quotation (unlike invoices, which predate this column and still match
  // by name — see the invoice print page for that pattern).
  const customer = quotation.customer_id
    ? customers.find((row) => row.id === quotation.customer_id)
    : customers.find((row) => row.name === quotation.customer);

  const discountAmount = Number(quotation.discount_amount || 0);
  const gstAmount = Number(quotation.gst_amount || 0);

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
            <div className="invoice-heading-title">QUOTATION</div>
            <div className="pn-chip">{quotation.id}</div>
            <div className="text-muted text-sm" style={{ marginTop: '6px' }}>
              Date: {quotation.date} · Valid until: {quotation.validity}
            </div>
            <div className="text-muted text-sm">{STATUS_LABEL[quotation.status] ?? quotation.status}</div>
          </div>
        </div>

        <div className="invoice-bill-to">
          <small className="text-muted">Quoted To</small>
          <div style={{ fontWeight: 600, fontSize: '15px' }}>{quotation.customer}</div>
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
                <th className="text-right">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {quotation.items.map((item, index) => (
                <tr key={`${item.part_number}-${index}`}>
                  <td>{item.part_number || '—'}</td>
                  <td>{item.name}</td>
                  <td className="text-right">{item.qty}</td>
                  <td className="text-right">₹{money(Number(item.unit_price))}</td>
                  <td className="text-right">₹{money(Number(item.line_total))}</td>
                </tr>
              ))}
              {quotation.items.length === 0 && (
                <tr><td colSpan={5}><p className="text-muted text-sm" style={{ padding: '12px 0' }}>No line items on this quotation.</p></td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="report-summary">
          <div className="report-line"><span>Subtotal</span><span>₹{money(Number(quotation.subtotal ?? quotation.total))}</span></div>
          {discountAmount > 0 && (
            <div className="report-line"><span>Discount ({Number(quotation.discount_percent).toFixed(0)}%)</span><span className="text-danger">-₹{money(discountAmount)}</span></div>
          )}
          {gstAmount > 0 && (
            <div className="report-line"><span>GST ({Number(quotation.gst_percent ?? 0).toFixed(0)}%)</span><span>₹{money(gstAmount)}</span></div>
          )}
          <div className="report-line report-strong"><span>Quotation Total</span><strong>₹{money(Number(quotation.total))}</strong></div>
        </div>

        <p className="text-muted text-sm" style={{ marginTop: '16px' }}>
          This is a quotation, not a tax invoice — stock and customer balances are unaffected until it is converted.
        </p>
      </div>
    </div>
  );
}
