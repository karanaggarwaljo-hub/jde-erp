'use client';

import { Fragment, FormEvent, useMemo, useState } from 'react';
import { Plus, Phone, Mail, MapPin, Sparkles, IndianRupee, Users, TrendingUp, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCompanyTable } from '@/lib/useCompanyTable';
import PaymentReminderModal from '@/components/PaymentReminderModal';
import AddCustomerModal from '@/components/AddCustomerModal';

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

type Invoice = { id: string; customer: string; date: string; total: number; paid: number; status: string };

type LedgerFilter = 'all' | 'balance' | 'settled';

const PAGE_SIZE = 12;

// The dot on a .brand-chip only ever carries an existing token — never a literal colour.
const TYPE_DOT: Record<string, string | undefined> = {
  wholesale: 'var(--chart-amber)',
  dealer: 'var(--chart-blue)',
  retail: 'var(--ink-3)',
};

type CollectionQueueItem = {
  customer: Customer;
  oldestInvoice?: Invoice;
  unpaidInvoiceCount: number;
  daysOutstanding: number;
};

export default function CustomersPage() {
  const { rows: customers, loading, create, adjust } = useCompanyTable<Customer>('customers');
  const { rows: invoices, loading: invoicesLoading, update: updateInvoice } = useCompanyTable<Invoice>('invoices');
  const [showModal, setShowModal] = useState(false);
  const [paymentCustomer, setPaymentCustomer] = useState<Customer | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [reminderCustomer, setReminderCustomer] = useState<Customer | null>(null);
  const [feedback, setFeedback] = useState('');
  const [filter, setFilter] = useState<LedgerFilter>('all');
  const [page, setPage] = useState(1);

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

  const openPayment = (customer: Customer) => {
    setPaymentCustomer(customer);
    setPaymentAmount(customer.balance);
  };

  const recordPayment = async (event: FormEvent) => {
    event.preventDefault();
    if (!paymentCustomer) return;
    const received = Math.min(Math.max(paymentAmount, 0), paymentCustomer.balance);

    let remaining = received;
    const outstandingInvoices = invoices
      .filter((inv) => inv.customer === paymentCustomer.name && Number(inv.total) > Number(inv.paid))
      .sort((a, b) => a.date.localeCompare(b.date));
    for (const inv of outstandingInvoices) {
      if (remaining <= 0) break;
      const due = Number(inv.total) - Number(inv.paid);
      const apply = Math.min(due, remaining);
      const newPaid = Number(inv.paid) + apply;
      await updateInvoice(inv.id, { paid: newPaid, status: newPaid >= Number(inv.total) ? 'paid' : 'partial' });
      remaining -= apply;
    }

    await adjust(paymentCustomer.id, -received);
    setFeedback(`₹${received.toLocaleString()} payment received from ${paymentCustomer.name}.`);
    setPaymentCustomer(null);
  };

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

  const filtered = filter === 'balance' ? owing : filter === 'settled' ? settled : customers;
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
              {filter === 'balance' ? 'No customer is carrying a balance right now.' : 'Every customer on file is carrying a balance.'}
            </p>
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="erp-table" style={{ minWidth: '940px' }}>
                <thead>
                  <tr>
                    <th>Customer</th>
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
                    return (
                      <tr key={customer.id}>
                        <td>
                          <div className="font-semibold">{customer.name}</div>
                          <div className="text-muted text-sm flex items-center gap-2" style={{ maxWidth: '260px', marginTop: '2px' }}>
                            <MapPin size={12} />
                            <span className="truncate">{customer.address || 'No address on file'}</span>
                          </div>
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
                          </div>
                        </td>
                      </tr>
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

      {paymentCustomer && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '440px' }} role="dialog" aria-modal="true" aria-labelledby="payment-modal-title"><form onSubmit={recordPayment}>
        <div className="modal-header"><h3 id="payment-modal-title" className="modal-title">Record Payment Received</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setPaymentCustomer(null)}>✕</button></div>
        <div className="modal-body flex flex-col gap-4"><p>Outstanding balance for <strong>{paymentCustomer.name}</strong>: ₹{paymentCustomer.balance.toLocaleString()}</p><div className="form-group"><label className="form-label">Amount Received (₹)</label><input type="number" min="1" max={paymentCustomer.balance} className="form-input" value={paymentAmount} onChange={(event) => setPaymentAmount(Number(event.target.value))} /></div></div>
        <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setPaymentCustomer(null)}>Cancel</button><button type="submit" className="btn btn-primary">Record Payment</button></div>
      </form></div></div>}

      {reminderCustomer && (
        <PaymentReminderModal
          direction="receivable"
          name={reminderCustomer.name}
          balance={reminderCustomer.balance}
          context={overdueContext(reminderCustomer.name)}
          onClose={() => setReminderCustomer(null)}
        />
      )}
    </div>
  );
}
