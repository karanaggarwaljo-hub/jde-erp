'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, FileDown, Printer } from 'lucide-react';
import { useCompany } from '@/components/CompanyProvider';
import TallyInvoiceSheet from '@/components/sales/TallyInvoiceSheet';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { type Customer, type Invoice, type InvoiceItem } from '@/lib/sales-types';
import { type SalesReturnRow } from '@/lib/client-sales-returns';
import { buildTallyInvoice, type TallyCompany } from '@/lib/tally-invoice';

type PartHsn = { id: string; hsn_code?: string | null };

/** A sales invoice, printed the way Tally prints a GST Tax Invoice. The saved PDF draws the same
 *  thing (lib/tally-invoice.ts builds both), so the two never disagree. */
export default function SalesInvoicePrintPage() {
  const { id } = useParams<{ id: string }>();
  const { activeCompany } = useCompany();
  const { rows: invoices, loading: invoicesLoading } = useCompanyTable<Invoice>('invoices');
  const { rows: invoiceItems, loading: itemsLoading } = useCompanyTable<InvoiceItem>('invoice_items');
  const { rows: customers } = useCompanyTable<Customer>('customers');
  const { rows: salesReturns } = useCompanyTable<SalesReturnRow>('sales_returns');
  const { rows: parts } = useCompanyTable<PartHsn>('products');

  const loading = invoicesLoading || itemsLoading;
  const invoice = invoices.find((row) => row.id === id);

  const doc = useMemo(() => {
    if (!invoice) return null;
    const hsnOf = new Map(parts.map((part) => [part.id, part.hsn_code ?? '']));
    const items = invoiceItems
      .filter((item) => item.invoice_id === invoice.id)
      .map((item) => ({ ...item, hsn: item.product_id ? hsnOf.get(String(item.product_id)) ?? '' : '' }));
    const customer = customers.find((row) => row.name === invoice.customer);
    const returns = salesReturns
      .filter((row) => row.invoice_id === invoice.id)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    return buildTallyInvoice({
      invoice: { ...invoice, mode: (invoice as Invoice & { mode?: string | null }).mode ?? null },
      items,
      company: (activeCompany ?? { name: 'Company' }) as TallyCompany,
      customer: customer ? { address: customer.address, phone: customer.phone, gstin: customer.gstin } : null,
      returns,
    });
  }, [invoice, invoiceItems, customers, salesReturns, parts, activeCompany]);

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
      <div className="no-print flex justify-between items-center mb-4">
        <Link href="/sales" className="btn btn-ghost btn-sm"><ArrowLeft size={14} /> Back to Sales</Link>
        <div className="flex gap-2">
          {activeCompany && (
            <a className="btn btn-secondary btn-sm" target="_blank" rel="noopener"
              href={`/api/sales/invoice-pdf?companyId=${encodeURIComponent(activeCompany.id)}&invoiceId=${encodeURIComponent(invoice.id)}`}
              title="The invoice as it is saved — opens on any device signed in to the ERP">
              <FileDown size={14} /> Saved PDF
            </a>
          )}
          <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>
            <Printer size={14} /> Print
          </button>
        </div>
      </div>
      {!doc.bank && (
        <p className="no-print text-muted text-sm mb-4" style={{ textAlign: 'center' }}>
          Add your bank details in Settings → Company to print them on every invoice.
        </p>
      )}
      <div className="invoice-sheet" style={{ background: '#fff', padding: 24 }}>
        <TallyInvoiceSheet doc={doc} />
      </div>
    </div>
  );
}
