'use client';

import { useEffect, useMemo, useState } from 'react';
import { shopDay } from '@/lib/logbook';
import { Ban, ExternalLink, Eye, FileDown, FileText, FolderOpen, Paperclip, Search } from 'lucide-react';
import { useCompany } from '@/components/CompanyProvider';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { money } from '@/lib/money';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import { CANCELLED_STATUS, DRAFT_STATUS, type Invoice } from '@/lib/sales-types';
import type { PurchaseOrder } from '@/lib/purchase-types';
import { invoiceBalanceDue } from '@/lib/invoice-balance';

type Tab = 'issued' | 'bills';
type Range = 'month' | 'last' | 'all';
type BillSummary = { inDrive: boolean; driveLink: string | null; fileName: string; sizeBytes: number; mimeType: string; uploadedAt: string };

const monthKey = (iso: string) => iso.slice(0, 7);
// Months in the shop's own time: in UTC it is still last month until 5:30 am on the 1st.
const thisMonth = () => shopDay(new Date()).slice(0, 7);
const lastMonth = () => {
  const [year, month] = thisMonth().split('-').map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
};
const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const inRange = (date: string, range: Range) => range === 'all' || monthKey(date) === (range === 'month' ? thisMonth() : lastMonth());

/**
 * Bills & Invoices: every invoice the shop has issued and every supplier bill uploaded against a
 * purchase, in one place, to open, print or download. The invoice is drawn as it is now (or as it
 * was issued, stamped CANCELLED); a supplier bill opens from Google Drive or the ERP's own store.
 */
export default function DocumentsPage() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? '';
  const { rows: invoices, loading: invoicesLoading } = useCompanyTable<Invoice>('invoices');
  const { rows: purchases, loading: purchasesLoading } = useCompanyTable<PurchaseOrder>('purchase_orders');
  const [bills, setBills] = useState<Record<string, BillSummary> | null>(null);
  const [billsError, setBillsError] = useState('');
  const [tab, setTab] = useState<Tab>('issued');
  const [range, setRange] = useState<Range>('month');
  const [search, setSearch] = useState('');
  const [withoutBill, setWithoutBill] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let active = true;
    fetch(`/api/purchases/bill?companyId=${encodeURIComponent(companyId)}&list=1`)
      .then((res) => parseJsonOrThrow(res, 'The supplier bills could not be loaded.') as Promise<Record<string, BillSummary>>)
      .then((list) => { if (active) { setBills(list); setBillsError(''); } })
      .catch((error) => { if (active) setBillsError(error instanceof Error ? error.message : 'The supplier bills could not be loaded.'); });
    return () => { active = false; };
  }, [companyId]);

  const term = search.trim().toLowerCase();

  // Invoices issued: every invoice but a parked draft (that is not issued yet), newest first.
  const issued = useMemo(() => invoices
    .filter((invoice) => invoice.status !== DRAFT_STATUS)
    .filter((invoice) => inRange(invoice.date, range))
    .filter((invoice) => !term || `${invoice.id} ${invoice.customer}`.toLowerCase().includes(term))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)), [invoices, range, term]);
  const issuedTotal = issued.filter((invoice) => invoice.status !== CANCELLED_STATUS).reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);

  // Supplier bills: purchases with a bill uploaded, or (switched on) the ones still missing one.
  const purchaseRows = useMemo(() => purchases
    .filter((purchase) => purchase.status !== DRAFT_STATUS)
    .filter((purchase) => inRange(purchase.date, range))
    .filter((purchase) => (withoutBill ? !bills?.[purchase.id] : Boolean(bills?.[purchase.id])))
    .filter((purchase) => !term || `${purchase.id} ${purchase.supplier} ${purchase.supplier_invoice_no ?? ''}`.toLowerCase().includes(term))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)), [purchases, range, term, withoutBill, bills]);
  const missingCount = purchases.filter((purchase) => purchase.status !== DRAFT_STATUS && inRange(purchase.date, range) && bills && !bills[purchase.id]).length;

  const pdfLink = (invoiceId: string) => `/api/sales/invoice-pdf?companyId=${encodeURIComponent(companyId)}&invoiceId=${encodeURIComponent(invoiceId)}`;
  const billLink = (purchaseId: string) => `/api/purchases/bill?companyId=${encodeURIComponent(companyId)}&purchaseId=${encodeURIComponent(purchaseId)}`;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Bills &amp; Invoices</h1>
          <p className="page-subtitle">Every bill you gave and every supplier bill you kept, to open, print or download.</p>
        </div>
      </div>

      <div className="flex gap-2 mb-4" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="tabs" role="group" aria-label="Which documents">
          <button type="button" aria-pressed={tab === 'issued'} className={`tab ${tab === 'issued' ? 'active' : ''}`} onClick={() => setTab('issued')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><FileText size={14} />Invoices issued</span>
          </button>
          <button type="button" aria-pressed={tab === 'bills'} className={`tab ${tab === 'bills' ? 'active' : ''}`} onClick={() => setTab('bills')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Paperclip size={14} />Supplier bills</span>
          </button>
        </div>
        <div className="tabs" role="group" aria-label="When">
          {(['month', 'last', 'all'] as Range[]).map((key) => (
            <button key={key} type="button" aria-pressed={range === key} className={`tab ${range === key ? 'active' : ''}`} onClick={() => setRange(key)}>
              {key === 'month' ? 'This month' : key === 'last' ? 'Last month' : 'All'}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', marginLeft: 'auto', flex: '0 1 240px' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }} />
          <input className="form-input" style={{ paddingLeft: 30, width: '100%' }} placeholder={tab === 'issued' ? 'Invoice no. or customer' : 'Purchase, supplier or bill no.'}
            value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search" />
        </div>
      </div>

      {tab === 'issued' && (
        <div className="card" style={{ padding: 0 }}>
          <div className="card-header" style={{ padding: '12px 16px' }}>
            <span className="text-muted text-sm">
              {issued.length} invoice{issued.length === 1 ? '' : 's'}
              {issued.some((invoice) => invoice.status === CANCELLED_STATUS) ? ` (${issued.filter((invoice) => invoice.status === CANCELLED_STATUS).length} cancelled)` : ''} · ₹{money(issuedTotal)} billed
            </span>
          </div>
          <div className="table-wrap">
            <table className="erp-table">
              <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th className="text-right">Amount</th><th>Status</th><th className="text-right">Open</th></tr></thead>
              <tbody>
                {issued.map((invoice) => {
                  const cancelled = invoice.status === CANCELLED_STATUS;
                  const due = invoiceBalanceDue(invoice);
                  return (
                    <tr key={invoice.id}>
                      <td><span className="pn-chip">{invoice.id}</span></td>
                      <td className="text-muted">{invoice.date}</td>
                      <td>{invoice.customer}</td>
                      <td className="text-right font-semibold">
                        {cancelled ? <s className="text-muted">₹{money(Number(invoice.cancelled_copy?.invoice?.total ?? 0))}</s> : <>₹{money(Number(invoice.total))}</>}
                      </td>
                      <td>
                        {cancelled
                          ? <span className="badge badge-muted" title={invoice.cancel_reason ?? undefined}><Ban size={12} />Cancelled</span>
                          : due <= 0 ? <span className="badge badge-success">Paid</span>
                          : Number(invoice.paid) > 0 ? <span className="badge badge-warning">Due ₹{money(due)}</span>
                          : <span className="badge badge-danger">Unpaid</span>}
                      </td>
                      <td className="text-right" style={{ whiteSpace: 'nowrap' }}>
                        <a className="btn btn-ghost btn-sm" href={`/sales/invoice/${encodeURIComponent(invoice.id)}`} target="_blank" rel="noopener" title="View and print"><Eye size={14} /> View</a>
                        {companyId && <a className="btn btn-ghost btn-sm" href={pdfLink(invoice.id)} target="_blank" rel="noopener" title="The saved PDF"><FileDown size={14} /> PDF</a>}
                      </td>
                    </tr>
                  );
                })}
                {issued.length === 0 && (
                  <tr><td colSpan={6}><div className="empty-state">
                    <p className="empty-state-title">{invoicesLoading ? 'Loading…' : 'No invoices here'}</p>
                    {!invoicesLoading && <p className="empty-state-desc">{range === 'all' ? 'Invoices you make in Sales appear here.' : 'Try another month, or All.'}</p>}
                  </div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'bills' && (
        <div className="card" style={{ padding: 0 }}>
          <div className="card-header" style={{ padding: '12px 16px', flexWrap: 'wrap', gap: 8 }}>
            <span className="text-muted text-sm">
              {withoutBill ? `${purchaseRows.length} purchase${purchaseRows.length === 1 ? '' : 's'} with no bill uploaded` : `${purchaseRows.length} bill${purchaseRows.length === 1 ? '' : 's'} uploaded`}
            </span>
            <label className="flex items-center gap-2 text-sm" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={withoutBill} onChange={(event) => setWithoutBill(event.target.checked)} />
              Show purchases with no bill{missingCount > 0 && !withoutBill ? ` (${missingCount})` : ''}
            </label>
          </div>
          {billsError && <div className="alert alert-danger" role="alert" style={{ margin: 12 }}>{billsError}</div>}
          <div className="table-wrap">
            <table className="erp-table">
              <thead><tr><th>Purchase</th><th>Date</th><th>Supplier</th><th>Supplier&apos;s bill no.</th><th className="text-right">Amount</th><th>{withoutBill ? '' : 'File'}</th><th className="text-right">{withoutBill ? '' : 'Open'}</th></tr></thead>
              <tbody>
                {purchaseRows.map((purchase) => {
                  const bill = bills?.[purchase.id];
                  return (
                    <tr key={purchase.id}>
                      <td><span className="pn-chip">{purchase.id}</span></td>
                      <td className="text-muted">{purchase.date}</td>
                      <td>{purchase.supplier}</td>
                      <td>{purchase.supplier_invoice_no || <span className="text-muted">—</span>}</td>
                      <td className="text-right font-semibold">₹{money(Number(purchase.total))}</td>
                      <td>
                        {bill
                          ? <div className="text-sm"><div>{bill.mimeType === 'application/pdf' ? 'PDF' : 'Photo'} · {kb(bill.sizeBytes)}</div><div className="text-muted">Uploaded {bill.uploadedAt.slice(0, 10)}{bill.inDrive ? ' · in Google Drive' : ''}</div></div>
                          : <a className="btn btn-ghost btn-sm" href="/purchases" title="Open Purchases to upload the bill on this purchase">Upload in Purchases</a>}
                      </td>
                      <td className="text-right" style={{ whiteSpace: 'nowrap' }}>
                        {bill && companyId && <a className="btn btn-ghost btn-sm" href={billLink(purchase.id)} target="_blank" rel="noopener"><Eye size={14} /> Open</a>}
                        {bill?.driveLink && <a className="btn btn-ghost btn-sm" href={bill.driveLink} target="_blank" rel="noopener" title="Open in Google Drive"><ExternalLink size={14} /> Drive</a>}
                      </td>
                    </tr>
                  );
                })}
                {purchaseRows.length === 0 && (
                  <tr><td colSpan={7}><div className="empty-state">
                    <div className="empty-state-icon"><FolderOpen size={22} /></div>
                    <p className="empty-state-title">{purchasesLoading || !bills ? 'Loading…' : withoutBill ? 'Every purchase here has its bill' : 'No supplier bills here'}</p>
                    {!purchasesLoading && bills && !withoutBill && <p className="empty-state-desc">Attach the supplier&apos;s bill on a purchase (Purchases → Attach bill) and it appears here.</p>}
                  </div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
