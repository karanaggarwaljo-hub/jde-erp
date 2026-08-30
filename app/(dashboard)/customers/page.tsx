'use client';

import { Fragment, useMemo, useState } from 'react';
import { Plus, Phone, Mail, MapPin, Sparkles, Tag, IndianRupee, Users, TrendingUp, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCompanyTable } from '@/lib/useCompanyTable';
import PaymentReminderModal from '@/components/PaymentReminderModal';
import SegmentOfferModal from '@/components/SegmentOfferModal';
import AddCustomerModal from '@/components/AddCustomerModal';
import ReceivePaymentModal from '@/components/ReceivePaymentModal';
import {
  buildCustomerInsights,
  TIER_LABELS,
  FLAG_LABELS,
  TIER_ACTIONS,
  FLAG_ACTIONS,
  INSIGHT_RULES,
  type CustomerInsight,
  type CustomerTier,
  type CustomerFlag,
} from '@/lib/customer-insights';

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

type Invoice = { id: string; customer: string; date: string; total: number; paid: number; status: string; discount_amount: number };
type InvoiceItem = { id: string; invoice_id: string; line_total: number };
type StockConsumption = { invoice_item_id: string; qty: number; unit_cost: number };

type LedgerFilter = 'all' | 'balance' | 'settled';
/** Tiers and flags share one control: they answer the same question — "show me this group". */
type SegmentFilter = 'any' | CustomerTier | CustomerFlag;

const PAGE_SIZE = 12;

// The dot on a .brand-chip only ever carries an existing token — never a literal colour.
const TYPE_DOT: Record<string, string | undefined> = {
  wholesale: 'var(--chart-amber)',
  dealer: 'var(--chart-blue)',
  retail: 'var(--ink-3)',
};

// Same rule as TYPE_DOT — existing tokens only. Diamond and Gold deliberately borrow the two
// "good" hues already used for positive numbers elsewhere, so the ranking reads without a legend.
const TIER_DOT: Record<CustomerTier, string> = {
  diamond: 'var(--chart-teal)',
  gold: 'var(--chart-amber)',
  silver: 'var(--ink-3)',
  new: 'var(--ink-3)',
};

type CollectionQueueItem = {
  customer: Customer;
  oldestInvoice?: Invoice;
  unpaidInvoiceCount: number;
  daysOutstanding: number;
};

export default function CustomersPage() {
  const { rows: customers, loading, create } = useCompanyTable<Customer>('customers');
  const { rows: invoices, loading: invoicesLoading } = useCompanyTable<Invoice>('invoices');
  // Needed to work out what each sale actually earned: line totals against the real FIFO cost
  // drawn for them. Without these two, the tiers could only rank revenue, which on this app's own
  // data points at the wrong customer (see lib/customer-insights.ts).
  const { rows: invoiceItems } = useCompanyTable<InvoiceItem>('invoice_items');
  const { rows: stockConsumptions } = useCompanyTable<StockConsumption>('stock_consumptions');
  const [showModal, setShowModal] = useState(false);
  const [payingCustomerId, setPayingCustomerId] = useState<string | null>(null);
  const [reminderCustomer, setReminderCustomer] = useState<Customer | null>(null);
  const [offerCustomerId, setOfferCustomerId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [filter, setFilter] = useState<LedgerFilter>('all');
  const [page, setPage] = useState(1);
  /** Which customer's tier reasoning is expanded — the numbers behind the badge, on demand. */
  const [openInsightId, setOpenInsightId] = useState<string | null>(null);
  const [segment, setSegment] = useState<SegmentFilter>('any');

  // Recomputed from the loaded rows rather than stored: a grade that went stale against the
  // sales it was derived from would be worse than no grade at all.
  const insightsByCustomerId = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const rows = buildCustomerInsights({
      customers,
      invoices,
      items: invoiceItems,
      consumptions: stockConsumptions,
      today,
    });
    return new Map<string, CustomerInsight>(rows.map((row) => [row.customerId, row]));
  }, [customers, invoices, invoiceItems, stockConsumptions]);

  // This is intentionally a review queue, not an automatic reminder sender. As a solo owner,
  // it puts the oldest/largest receivables in one place while keeping the final message and
  // payment decision under your control.
  const collectionQueue = useMemo<CollectionQueueItem[]>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return customers
      .filter((customer) => Number(customer.balance) > 0)
      .map((customer) => {
        const unpaidInvoices = invoices
          .filter((invoice) => invoice.customer === customer.name && Number(invoice.total) > Number(invoice.paid))
          .sort((a, b) => a.date.localeCompare(b.date));
        const oldestInvoice = unpaidInvoices[0];
        const oldestDate = oldestInvoice ? new Date(`${oldestInvoice.date}T00:00:00`) : null;
        const daysOutstanding = oldestDate && !Number.isNaN(oldestDate.getTime())
          ? Math.max(0, Math.floor((today.getTime() - oldestDate.getTime()) / 86_400_000))
          : 0;

        return { customer, oldestInvoice, unpaidInvoiceCount: unpaidInvoices.length, daysOutstanding };
      })
      .sort((a, b) => {
        const aHasInvoice = a.oldestInvoice ? 1 : 0;
        const bHasInvoice = b.oldestInvoice ? 1 : 0;
        return bHasInvoice - aHasInvoice || b.daysOutstanding - a.daysOutstanding || Number(b.customer.balance) - Number(a.customer.balance);
      });
  }, [customers, invoices]);

  const totalReceivables = collectionQueue.reduce((total, item) => total + Number(item.customer.balance), 0);
  const agedReceivables = collectionQueue.filter((item) => item.daysOutstanding > 0);

  function overdueContext(customerName: string): string {
    const overdue = invoices
      .filter((inv) => inv.customer === customerName && Number(inv.total) > Number(inv.paid))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (overdue.length === 0) return '';
    return `${overdue.length} unpaid invoice${overdue.length > 1 ? 's' : ''}, oldest ${overdue[0].id} dated ${overdue[0].date}.`;
  }

  const openPayment = (customer: Customer) => setPayingCustomerId(customer.id);

  // How many invoices this customer still has open. Counted with exactly the same test the
  // payment flow above uses, off invoices this page already loads — nothing estimated.
  const unpaidInvoiceCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const inv of invoices) {
      if (Number(inv.total) > Number(inv.paid)) counts.set(inv.customer, (counts.get(inv.customer) ?? 0) + 1);
    }
    return counts;
  }, [invoices]);

  const balanceOf = (customer: Customer) => Number(customer.balance) || 0;

  // Every figure below is a straight roll-up of the customer rows on screen.
  const owing = customers.filter((customer) => balanceOf(customer) > 0);
  const settled = customers.filter((customer) => balanceOf(customer) <= 0);
  const totalOutstanding = customers.reduce((sum, customer) => sum + balanceOf(customer), 0);
  const largestDebtor = owing.reduce<Customer | null>(
    (top, customer) => (!top || balanceOf(customer) > balanceOf(top) ? customer : top),
    null,
  );

  const selectFilter = (next: LedgerFilter) => {
    setFilter(next);
    setPage(1);
  };

  const byBalance = filter === 'balance' ? owing : filter === 'settled' ? settled : customers;
  // Narrowing to one segment is the point of grading at all — it's how "send the Bargainers a
  // bundle offer" becomes a list you can actually work from rather than a label you just read.
  const filtered = segment === 'any'
    ? byBalance
    : byBalance.filter((customer) => {
        const insight = insightsByCustomerId.get(customer.id);
        if (!insight) return false;
        return insight.tier === segment || insight.flags.some((flag) => flag === segment);
      });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const firstIndex = (currentPage - 1) * PAGE_SIZE;
  const visible = filtered.slice(firstIndex, firstIndex + PAGE_SIZE);
  const pageOutstanding = visible.reduce((sum, customer) => sum + balanceOf(customer), 0);
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1).filter(
    (number) => number === 1 || number === totalPages || Math.abs(number - currentPage) <= 1,
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Accounts receivable</div>
          <h1 className="page-title">Customers</h1>
          <p className="page-subtitle">Track accounts receivable, GST numbers and purchase histories</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> Add New Customer</button>
      </div>

      {feedback && <div className="alert alert-success mb-4" role="status">{feedback}</div>}

      {/* auto-fit rather than the shared auto-fill so three cards stretch across the row
          instead of leaving two empty tracks on a wide screen. */}
      {customers.length > 0 && (
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <div className="kpi-card" style={{ '--kpi-color': 'var(--chart-amber)', '--kpi-color-bg': 'var(--amber-tint)' } as React.CSSProperties}>
            <div className="flex justify-between items-center">
              <span className="kpi-label">Total outstanding</span>
              <div className="kpi-icon-wrap"><IndianRupee size={18} /></div>
            </div>
            <div className="kpi-value">₹{totalOutstanding.toLocaleString()}</div>
            <span className="kpi-context">Sum of every customer balance on file</span>
          </div>

          <div className="kpi-card" style={{ '--kpi-color': 'var(--chart-blue)', '--kpi-color-bg': 'var(--color-info-bg)' } as React.CSSProperties}>
            <div className="flex justify-between items-center">
              <span className="kpi-label">Customers who owe</span>
              <div className="kpi-icon-wrap"><Users size={18} /></div>
            </div>
            <div className="kpi-value">{owing.length}</div>
            <span className="kpi-context">of {customers.length} accounts · {settled.length} settled</span>
          </div>

          <div className="kpi-card" style={{ '--kpi-color': 'var(--chart-red)', '--kpi-color-bg': 'var(--rose-tint)' } as React.CSSProperties}>
            <div className="flex justify-between items-center">
              <span className="kpi-label">Largest balance</span>
              <div className="kpi-icon-wrap"><TrendingUp size={18} /></div>
            </div>
            <div className="kpi-value">₹{(largestDebtor ? balanceOf(largestDebtor) : 0).toLocaleString()}</div>
            <span className="kpi-context">{largestDebtor ? largestDebtor.name : 'No customer is carrying a balance'}</span>
          </div>
        </div>
      )}

      <section className="card mb-6" aria-labelledby="collections-queue-title">
        <div className="card-header">
          <div>
            <h2 id="collections-queue-title" className="card-title">Collections to review</h2>
            <p className="text-muted text-sm">Start with the oldest unpaid invoices. Draft a reminder, then record the payment once it arrives.</p>
          </div>
          <div className="flex gap-2 items-center" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {agedReceivables.length > 0 && <span className="badge badge-warning">{agedReceivables.length} aged</span>}
            <span className={totalReceivables > 0 ? 'badge badge-danger' : 'badge badge-success'}>₹{totalReceivables.toLocaleString('en-IN')} due</span>
          </div>
        </div>
        <div className="table-wrap" style={{ borderLeft: 'none', borderRight: 'none', borderBottom: 'none', borderRadius: 0 }}>
          <table className="erp-table">
            <thead><tr><th>Customer</th><th>Oldest unpaid invoice</th><th>Age</th><th className="text-right">Due</th><th className="text-center">Quick action</th></tr></thead>
            <tbody>
              {collectionQueue.slice(0, 8).map(({ customer, oldestInvoice, unpaidInvoiceCount: openCount, daysOutstanding }) => (
                <tr key={customer.id}>
                  <td><div className="font-semibold">{customer.name}</div><div className="text-muted text-sm">{customer.phone || customer.email || 'No contact details'}</div></td>
                  <td>{oldestInvoice ? <><span className="text-brand font-semibold">{oldestInvoice.id}</span><div className="text-muted text-sm">{openCount} open invoice{openCount === 1 ? '' : 's'} · {oldestInvoice.date}</div></> : <span className="text-muted">No linked open invoice</span>}</td>
                  <td>{oldestInvoice ? <span className={daysOutstanding > 30 ? 'badge badge-danger' : daysOutstanding > 0 ? 'badge badge-warning' : 'badge badge-info'}>{daysOutstanding === 0 ? 'Due today' : `${daysOutstanding} days`}</span> : <span className="text-muted">—</span>}</td>
                  <td className="text-right"><strong className="text-danger">₹{Number(customer.balance).toLocaleString('en-IN')}</strong></td>
                  <td className="text-center"><div className="flex gap-1 justify-center"><button className="btn btn-secondary btn-sm" onClick={() => setReminderCustomer(customer)}><Sparkles size={14} /> Draft reminder</button><button className="btn btn-ghost btn-sm" onClick={() => openPayment(customer)}>Record received</button></div></td>
                </tr>
              ))}
              {collectionQueue.length === 0 && <tr><td colSpan={5}><div className="empty-state"><p className="empty-state-title">{loading || invoicesLoading ? 'Loading collections…' : 'No customer payments need follow-up'}</p><p className="empty-state-desc">{loading || invoicesLoading ? 'Checking customer balances and open invoices.' : 'All customer balances are cleared. New outstanding invoices will appear here.'}</p></div></td></tr>}
            </tbody>
          </table>
        </div>
        {collectionQueue.length > 8 && <p className="text-muted text-sm" style={{ padding: '12px 16px 0' }}>Showing the first 8 priorities out of {collectionQueue.length} customers with money due.</p>}
      </section>

      {owing.length > 0 && (
        <div className="alert alert-warning mb-4">
          <AlertTriangle size={16} style={{ flex: 'none', marginTop: '1px' }} />
          <span>
            {owing.length} customer{owing.length > 1 ? 's are' : ' is'} carrying a balance, ₹{totalOutstanding.toLocaleString()} in total.
          </span>
          <button type="button" className="alert-action" onClick={() => selectFilter('balance')}>Show who owes</button>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="tbl-toolbar">
          <div className="tbl-toolbar-title">
            <strong>Customer ledger</strong>
            <small>Outstanding balances, GST numbers and contact details</small>
          </div>
          <div className="tbl-tools">
            <div className="tabs" role="tablist" aria-label="Filter customers">
              <button type="button" role="tab" aria-selected={filter === 'all'} className={`tab ${filter === 'all' ? 'active' : ''}`} onClick={() => selectFilter('all')}>
                All <span className="tab-count">{customers.length}</span>
              </button>
              <button type="button" role="tab" aria-selected={filter === 'balance'} className={`tab ${filter === 'balance' ? 'active' : ''}`} onClick={() => selectFilter('balance')}>
                With balance <span className="tab-count">{owing.length}</span>
              </button>
              <button type="button" role="tab" aria-selected={filter === 'settled'} className={`tab ${filter === 'settled' ? 'active' : ''}`} onClick={() => selectFilter('settled')}>
                Settled <span className="tab-count">{settled.length}</span>
              </button>
            </div>
            <select
              className="form-input form-select"
              style={{ maxWidth: '190px' }}
              aria-label="Filter by segment"
              value={segment}
              onChange={(event) => { setSegment(event.target.value as SegmentFilter); setPage(1); }}
            >
              <option value="any">All segments</option>
              <option value="diamond">💎 {TIER_LABELS.diamond}</option>
              <option value="gold">🥇 {TIER_LABELS.gold}</option>
              <option value="silver">🥈 {TIER_LABELS.silver}</option>
              <option value="new">{TIER_LABELS.new}</option>
              <option value="defaulter">{FLAG_LABELS.defaulter}</option>
              <option value="bargainer">{FLAG_LABELS.bargainer}</option>
              <option value="dormant">{FLAG_LABELS.dormant}</option>
            </select>
          </div>
        </div>

        {customers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Users size={22} /></div>
            <div className="empty-state-title">{loading ? 'Loading customers…' : 'No customers yet'}</div>
            <p className="empty-state-desc">
              {loading ? 'Fetching the customer ledger for this company.' : 'Add your first customer to get started.'}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">Nothing in this view</div>
            <p className="empty-state-desc">
              {segment !== 'any'
                ? `No customer is in this segment yet. Grades need at least ${INSIGHT_RULES.minOrdersToGrade} recorded sales before anyone can be placed in one.`
                : filter === 'balance' ? 'No customer is carrying a balance right now.' : 'Every customer on file is carrying a balance.'}
            </p>
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="erp-table" style={{ minWidth: '940px' }}>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Segment</th>
                    <th>Contact</th>
                    <th>GSTIN</th>
                    <th>Type</th>
                    <th className="text-right" style={{ textAlign: 'right' }}>Outstanding</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((customer) => {
                    const balance = balanceOf(customer);
                    const openInvoices = unpaidInvoiceCount.get(customer.name) ?? 0;
                    const typeKey = (customer.type || '').toLowerCase();
                    const insight = insightsByCustomerId.get(customer.id);
                    const insightOpen = openInsightId === customer.id;
                    return (
                      <Fragment key={customer.id}>
                      <tr>
                        <td>
                          <div className="font-semibold">{customer.name}</div>
                          <div className="text-muted text-sm flex items-center gap-2" style={{ maxWidth: '260px', marginTop: '2px' }}>
                            <MapPin size={12} />
                            <span className="truncate">{customer.address || 'No address on file'}</span>
                          </div>
                        </td>
                        <td style={{ minWidth: '190px' }}>
                          {insight ? (
                            <>
                              <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                                <span className="brand-chip" style={{ '--brand-chip-color': TIER_DOT[insight.tier] } as React.CSSProperties}>
                                  {TIER_LABELS[insight.tier]}
                                </span>
                                {insight.flags.map((flag) => (
                                  <span key={flag} className={`badge ${flag === 'defaulter' ? 'badge-danger' : 'badge-warning'}`}>
                                    {FLAG_LABELS[flag]}
                                  </span>
                                ))}
                              </div>
                              {/* The grade is only trustworthy if the reasoning behind it can be
                                  read — so every badge can be opened to the actual figures. */}
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                style={{ padding: 0, fontSize: '11px', marginTop: '2px' }}
                                aria-expanded={insightOpen}
                                onClick={() => setOpenInsightId(insightOpen ? null : customer.id)}
                              >
                                {insightOpen ? 'Hide why' : 'Why?'}
                              </button>
                            </>
                          ) : <span className="text-muted text-sm">—</span>}
                        </td>
                        <td>
                          <div className="directory-details">
                            <div className="flex items-center gap-2"><Phone size={13} /><span>{customer.phone || 'No phone'}</span></div>
                            <div className="flex items-center gap-2"><Mail size={13} /><span className="truncate" style={{ maxWidth: '190px' }}>{customer.email || 'No email'}</span></div>
                          </div>
                        </td>
                        <td>
                          {customer.gstin
                            ? <span className="pn-chip">{customer.gstin}</span>
                            : <span className="text-muted text-sm">Not provided</span>}
                        </td>
                        <td>
                          {customer.type
                            ? <span className="brand-chip" style={{ '--brand-chip-color': TYPE_DOT[typeKey] ?? 'var(--ink-3)' } as React.CSSProperties}>{customer.type.charAt(0).toUpperCase() + customer.type.slice(1)}</span>
                            : <span className="text-muted text-sm">—</span>}
                        </td>
                        <td className="text-right">
                          {balance > 0 ? (
                            <>
                              <strong>₹{balance.toLocaleString()}</strong>
                              {openInvoices > 0 && (
                                <div className="text-muted text-sm">{openInvoices} unpaid invoice{openInvoices > 1 ? 's' : ''}</div>
                              )}
                            </>
                          ) : (
                            <span className="text-muted">₹0</span>
                          )}
                        </td>
                        <td>
                          {balance > 0
                            ? <span className="badge badge-warning">Outstanding</span>
                            : <span className="badge badge-success">Settled</span>}
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <button className="btn btn-secondary btn-sm" disabled={!customer.balance} onClick={() => openPayment(customer)}>Received</button>
                            <button className="btn btn-ghost btn-sm" aria-label={`Draft payment reminder for ${customer.name}`} title="Draft a payment reminder" disabled={!customer.balance} onClick={() => setReminderCustomer(customer)}><Sparkles size={14} /></button>
                            {/* Available whatever the grade — a New customer is often exactly who
                                you want to make an opening offer to. */}
                            <button className="btn btn-ghost btn-sm" aria-label={`Draft an offer for ${customer.name}`} title="Draft an offer" disabled={!insight} onClick={() => setOfferCustomerId(customer.id)}><Tag size={14} /></button>
                          </div>
                        </td>
                      </tr>
                      {insightOpen && insight && (
                        <tr>
                          <td colSpan={8} style={{ background: 'var(--surface-2)' }}>
                            <div style={{ padding: '4px 2px 8px' }}>
                              <div className="flex items-center gap-4" style={{ flexWrap: 'wrap', marginBottom: '6px' }}>
                                <span className="text-sm"><span className="text-muted">Sales:</span> <strong>{insight.orderCount}</strong></span>
                                <span className="text-sm"><span className="text-muted">Revenue:</span> <strong>₹{Math.round(insight.revenue).toLocaleString('en-IN')}</strong></span>
                                {/* Profit, not revenue, is what the tier is actually cut from. */}
                                <span className="text-sm"><span className="text-muted">Profit:</span> <strong>₹{Math.round(insight.grossProfit).toLocaleString('en-IN')}</strong>{insight.marginPercent !== null && <> ({insight.marginPercent}%)</>}</span>
                                <span className="text-sm"><span className="text-muted">Avg discount:</span> <strong>{insight.avgDiscountPercent}%</strong></span>
                                {insight.lastPurchaseDate && <span className="text-sm"><span className="text-muted">Last bought:</span> <strong>{insight.lastPurchaseDate}</strong></span>}
                              </div>
                              {insight.reasons.map((reason) => (
                                <div key={reason} className="text-muted text-sm">• {reason}</div>
                              ))}
                              <div className="text-sm" style={{ marginTop: '6px' }}>
                                <strong>What to do:</strong> {TIER_ACTIONS[insight.tier]}
                                {insight.flags.map((flag) => <span key={flag}> {FLAG_ACTIONS[flag]}</span>)}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="pager">
              <div className="pager-info">
                Showing <strong>{firstIndex + 1}–{firstIndex + visible.length}</strong> of <strong>{filtered.length}</strong> customers
                {pageOutstanding > 0 && <> · <strong>₹{pageOutstanding.toLocaleString()}</strong> outstanding on this page</>}
              </div>
              {totalPages > 1 && (
                <div className="pager-controls">
                  <button type="button" className="pager-btn" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={15} /></button>
                  {pageNumbers.map((number, index) => (
                    <Fragment key={number}>
                      {index > 0 && number - pageNumbers[index - 1] > 1 && <span className="pager-info">…</span>}
                      <button type="button" className={`pager-btn ${number === currentPage ? 'active' : ''}`} aria-current={number === currentPage ? 'page' : undefined} onClick={() => setPage(number)}>{number}</button>
                    </Fragment>
                  ))}
                  <button type="button" className="pager-btn" aria-label="Next page" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={15} /></button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {showModal && (
        <AddCustomerModal
          onClose={() => setShowModal(false)}
          onSave={create}
          onCreated={(customer) => { setShowModal(false); setFeedback(`${customer.name} added to the customer directory.`); }}
        />
      )}

      {payingCustomerId && (
        <ReceivePaymentModal
          customerId={payingCustomerId}
          onClose={() => setPayingCustomerId(null)}
          onRecorded={(result) => {
            setPayingCustomerId(null);
            setFeedback(`₹${result.appliedTotal.toLocaleString('en-IN')} received from ${result.customerName} (${result.paymentId}).`);
          }}
        />
      )}

      {reminderCustomer && (
        <PaymentReminderModal
          direction="receivable"
          name={reminderCustomer.name}
          balance={reminderCustomer.balance}
          context={overdueContext(reminderCustomer.name)}
          onClose={() => setReminderCustomer(null)}
        />
      )}

      {/* Reads the insight live rather than capturing it when the button was clicked, so the
          grade in the dialog can never disagree with the badge in the row behind it. */}
      {offerCustomerId && insightsByCustomerId.get(offerCustomerId) && (
        <SegmentOfferModal
          insight={insightsByCustomerId.get(offerCustomerId)!}
          onClose={() => setOfferCustomerId(null)}
        />
      )}
    </div>
  );
}
