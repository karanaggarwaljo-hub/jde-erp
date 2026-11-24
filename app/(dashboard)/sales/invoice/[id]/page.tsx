'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, FileDown, Printer } from 'lucide-react';
import { useCompany } from '@/components/CompanyProvider';
import TallyInvoiceSheet from '@/components/sales/TallyInvoiceSheet';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { type Customer, type Invoice, type InvoiceItem } from '@/lib/sales-types';
import { type SalesReturnRow } from '@/lib/client-sales-returns';
import { COPY_LABELS, type TallyCompany } from '@/lib/tally-invoice';
import { invoicePrintDoc, type PartHsn } from '@/lib/invoice-print-doc';

/** Remembered on this device only: whether printing a bill also prints the office copy. */
const OFFICE_COPY_KEY = 'jde.print.officeCopy';

/** A sales invoice, printed as a GST Tax Invoice. The saved PDF draws the same
 *  thing (lib/tally-invoice.ts builds both), so the two never disagree. The customer's copy is
 *  marked "Original for Recipient"; ticked, a second page marked "Office Copy" prints after it, for
 *  the file the CA collects at month end. */
export default function SalesInvoicePrintPage() {
  const { id } = useParams<{ id: string }>();
  const { activeCompany } = useCompany();
  const { rows: invoices, loading: invoicesLoading } = useCompanyTable<Invoice>('invoices');
  const { rows: invoiceItems, loading: itemsLoading } = useCompanyTable<InvoiceItem>('invoice_items');
  const { rows: customers } = useCompanyTable<Customer>('customers');
  const { rows: salesReturns } = useCompanyTable<SalesReturnRow>('sales_returns');
  const { rows: parts } = useCompanyTable<PartHsn>('products');
  const [officeCopy, setOfficeCopy] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from this device after mount
      if (window.localStorage.getItem(OFFICE_COPY_KEY) === '1') setOfficeCopy(true);
    } catch {
      // Storage blocked (private window): start unticked.
    }
  }, []);
  const chooseOfficeCopy = (on: boolean) => {
    setOfficeCopy(on);
    try { window.localStorage.setItem(OFFICE_COPY_KEY, on ? '1' : '0'); } catch { /* not remembered */ }
  };

  const loading = invoicesLoading || itemsLoading;
  const invoice = invoices.find((row) => row.id === id);

  const doc = useMemo(() => invoice
    ? invoicePrintDoc(invoice, { items: invoiceItems, customers, returns: salesReturns, parts, company: activeCompany as TallyCompany | null })
    : null, [invoice, invoiceItems, customers, salesReturns, parts, activeCompany]);

  if (loading && !invoice) {
    return <div className="empty-state"><p className="empty-state-title">Loading invoice…</p></div>;
  }

  if (!invoice || !doc) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Invoice not found</p>
        <p className="empty-state-desc">It may have been deleted, or belongs to a different company.</p>
        <Link href="/sales" className="btn btn-secondary" style={{ marginTop: '14px' }}><ArrowLeft size={14} /> Back to Sales</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="no-print flex justify-between items-center mb-4" style={{ flexWrap: 'wrap', gap: 8 }}>
        <Link href="/sales" className="btn btn-ghost btn-sm"><ArrowLeft size={14} /> Back to Sales</Link>
        <div className="flex gap-2 items-center" style={{ flexWrap: 'wrap' }}>
          <label className="text-sm flex items-center gap-2" style={{ cursor: 'pointer' }} title="Prints a second page marked Office Copy, for the CA's file">
            <input id="print-office-copy" type="checkbox" checked={officeCopy} onChange={(event) => chooseOfficeCopy(event.target.checked)} />
            Also print an office copy
          </label>
          {activeCompany && (
            <a className="btn btn-secondary btn-sm" target="_blank" rel="noopener"
              href={`/api/sales/invoice-pdf?companyId=${encodeURIComponent(activeCompany.id)}&invoiceId=${encodeURIComponent(invoice.id)}`}
              title="The invoice as it is saved — opens on any device signed in to the ERP">
              <FileDown size={14} /> Saved PDF
            </a>
          )}
          <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>
            <Printer size={14} /> {officeCopy ? 'Print both copies' : 'Print'}
          </button>
        </div>
      </div>
      <div className="invoice-sheet" style={{ background: '#fff', padding: 24, overflowX: 'auto' }}>
        <TallyInvoiceSheet doc={doc} copyLabel={COPY_LABELS.original} />
      </div>
      {officeCopy && (
        <div className="invoice-sheet" style={{ background: '#fff', padding: 24, overflowX: 'auto' }}>
          <TallyInvoiceSheet doc={doc} copyLabel={COPY_LABELS.office} />
        </div>
      )}
    </div>
  );
}
