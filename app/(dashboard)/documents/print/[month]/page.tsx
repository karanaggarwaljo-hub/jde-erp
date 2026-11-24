'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import { useCompany } from '@/components/CompanyProvider';
import TallyInvoiceSheet from '@/components/sales/TallyInvoiceSheet';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { CANCELLED_STATUS, DRAFT_STATUS, type Customer, type Invoice, type InvoiceItem } from '@/lib/sales-types';
import { type SalesReturnRow } from '@/lib/client-sales-returns';
import { COPY_LABELS, type TallyCompany } from '@/lib/tally-invoice';
import { invoicePrintDoc, monthTitle, type PartHsn } from '@/lib/invoice-print-doc';

/**
 * Every bill issued in one month, each as an "Office Copy" on its own sheet of paper, oldest first:
 * the physical file the CA collects at month end, printed in one go from Documents. Parked drafts
 * are left out (not issued); cancelled bills are kept, stamped CANCELLED, since the CA accounts for
 * those numbers too.
 */
export default function MonthOfficeCopiesPage() {
  const { month } = useParams<{ month: string }>();
  const title = monthTitle(month);
  const { activeCompany } = useCompany();
  const { rows: invoices, loading: invoicesLoading } = useCompanyTable<Invoice>('invoices');
  const { rows: invoiceItems, loading: itemsLoading } = useCompanyTable<InvoiceItem>('invoice_items');
  const { rows: customers, loading: customersLoading } = useCompanyTable<Customer>('customers');
  const { rows: salesReturns } = useCompanyTable<SalesReturnRow>('sales_returns');
  const { rows: parts, loading: partsLoading } = useCompanyTable<PartHsn>('products');
  const loading = invoicesLoading || itemsLoading || customersLoading || partsLoading;

  const bills = useMemo(() => invoices
    .filter((invoice) => invoice.status !== DRAFT_STATUS)
    .filter((invoice) => month === 'all' || String(invoice.date).slice(0, 7) === month)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id, undefined, { numeric: true })), [invoices, month]);
  const docs = useMemo(() => bills.map((invoice) => ({
    id: invoice.id,
    doc: invoicePrintDoc(invoice, { items: invoiceItems, customers, returns: salesReturns, parts, company: activeCompany as TallyCompany | null }),
  })), [bills, invoiceItems, customers, salesReturns, parts, activeCompany]);
  const cancelledCount = bills.filter((invoice) => invoice.status === CANCELLED_STATUS).length;

  const back = <Link href="/documents" className="btn btn-ghost btn-sm"><ArrowLeft size={14} /> Back to Bills &amp; Invoices</Link>;

  if (!title) {
    return <div className="empty-state"><p className="empty-state-title">That is not a month</p><div style={{ marginTop: 14 }}>{back}</div></div>;
  }
  if (loading && bills.length === 0) {
    return <div className="empty-state"><p className="empty-state-title">Loading the bills…</p></div>;
  }

  return (
    <div>
      <div className="no-print flex justify-between items-center mb-4" style={{ flexWrap: 'wrap', gap: 8 }}>
        {back}
        <div className="flex gap-2 items-center" style={{ flexWrap: 'wrap' }}>
          <span className="text-sm text-muted">
            Office copies, {title}: <strong>{bills.length}</strong> bill{bills.length === 1 ? '' : 's'}
            {cancelledCount > 0 ? ` (${cancelledCount} cancelled)` : ''}, one per page
          </span>
          <button type="button" className="btn btn-primary btn-sm" disabled={bills.length === 0} onClick={() => window.print()}>
            <Printer size={14} /> Print all
          </button>
        </div>
      </div>
      {bills.length === 0 && (
        <div className="empty-state"><p className="empty-state-title">No bills issued in {title}</p></div>
      )}
      {docs.map(({ id, doc }) => (
        <div key={id} className="invoice-sheet" style={{ background: '#fff', padding: 24, overflowX: 'auto' }}>
          <TallyInvoiceSheet doc={doc} copyLabel={COPY_LABELS.office} />
        </div>
      ))}
    </div>
  );
}
