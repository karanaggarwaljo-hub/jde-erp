'use client';

import { Fragment, FormEvent, useMemo, useState } from 'react';
import { Plus, Search, Phone, Mail, Sparkles, Truck, ChevronLeft, ChevronRight } from 'lucide-react';
import SummaryLine from '@/components/SummaryLine';
import { money, wholeMoney } from '@/lib/money';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import { useEntryIntent } from '@/lib/use-entry-intent';
import { keepEnterInsideForm, SAVE_SHORTCUT_HINT } from '@/lib/form-keys';
import PaymentReminderModal from '@/components/PaymentReminderModal';
import MoneyPicker from '@/components/money/MoneyPicker';
import type { MoneyChoice } from '@/lib/money-book';
import { shopDay } from '@/lib/logbook';

type Supplier = { id: string; company_id: string; name: string; category: string; phone: string; email: string; gstin: string; terms: number; balance: number };
type PurchaseOrder = { id: string; supplier: string; date: string; total: number; paid: number; status: string };

type LedgerFilter = 'all' | 'balance' | 'settled';

const categoryOptions = ['Engine', 'Brakes', 'Filters', 'Clutch', 'Suspension', 'Electrical'];

const PAGE_SIZE = 12;

// Categorical hues only, and never green / amber / rose: on this screen those three already mean
// settled / outstanding, and a category dot must not borrow that meaning.
const CATEGORY_CHIP_COLORS = [
  'var(--chart-blue)',
  'var(--chart-teal)',
  'var(--chart-violet)',
  'var(--chart-orange)',
  'var(--chart-pink)',
];

// Same category always gets the same dot, without storing anything — a reading aid, not data.
const categoryChipColor = (category: string) => {
  let hash = 0;
  for (let i = 0; i < category.length; i += 1) hash = (hash * 31 + category.charCodeAt(i)) % 100003;
  return CATEGORY_CHIP_COLORS[hash % CATEGORY_CHIP_COLORS.length];
};

// Forms the Day Book's Record tiles can open on arrival (see lib/entry-intent.ts).
const SUPPLIER_ENTRY_KINDS = ['payment'] as const;

export default function SuppliersPage() {
  const { rows: suppliers, loading, create, reload: reloadSuppliers, activeCompany } = useCompanyTable<Supplier>('suppliers');
  const { rows: purchaseOrders, reload: reloadPurchaseOrders } = useCompanyTable<PurchaseOrder>('purchase_orders');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [paymentSupplier, setPaymentSupplier] = useState<Supplier | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  // Whether the supplier was paid by cheque, and its details (the cheque register).
  const [paymentMoney, setPaymentMoney] = useState<MoneyChoice | null>(null);
  // Fixed when the dialog opens and reused by every retry of that same payment, so a double-click
  // or a re-submit after a timeout lands on the payment already recorded instead of a second one.
  const [paymentReference, setPaymentReference] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [supplierError, setSupplierError] = useState('');
  const [reminderSupplier, setReminderSupplier] = useState<Supplier | null>(null);
  const [feedback, setFeedback] = useState('');
  const [form, setForm] = useState({ name: '', category: categoryOptions[0], phone: '', email: '', gstin: '', terms: 30 });
  const [filter, setFilter] = useState<LedgerFilter>('all');
  const [page, setPage] = useState(1);

  function overdueContext(supplierName: string): string {
    const overdue = purchaseOrders
      .filter((po) => po.supplier === supplierName && po.status === 'received' && Number(po.total) > Number(po.paid))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (overdue.length === 0) return '';
    return `${overdue.length} unpaid purchase order${overdue.length > 1 ? 's' : ''}, oldest ${overdue[0].id} dated ${overdue[0].date}.`;
  }

  const filteredSuppliers = suppliers.filter((supplier) => {
    const query = search.toLowerCase();
    return (
      supplier.name.toLowerCase().includes(query) ||
      supplier.category.toLowerCase().includes(query) ||
      supplier.phone.toLowerCase().includes(query) ||
      supplier.email.toLowerCase().includes(query) ||
      supplier.gstin.toLowerCase().includes(query)
    );
  });

  const saveSupplier = async (event: FormEvent) => {
    event.preventDefault();
    if (savingSupplier) return;
    setSupplierError('');
    setSavingSupplier(true);
    try {
      await create({ ...form, balance: 0 });
      setShowModal(false);
      setFeedback(`${form.name} added to the supplier directory.`);
      setForm({ name: '', category: categoryOptions[0], phone: '', email: '', gstin: '', terms: 30 });
    } catch (error) {
      setSupplierError(error instanceof Error ? error.message : 'Failed to add this supplier.');
    } finally {
      setSavingSupplier(false);
    }
  };

  const openPayment = (supplier: Supplier) => {
    setPaymentSupplier(supplier);
    setPaymentAmount(supplier.balance);
    setPaymentReference(crypto.randomUUID());
    setPaymentError('');
  };

  const recordPayment = async (event: FormEvent) => {
    event.preventDefault();
    if (!paymentSupplier || savingPayment || !activeCompany) return;
    setPaymentError('');
    setSavingPayment(true);
    const paid = Math.min(Math.max(paymentAmount, 0), paymentSupplier.balance);

    try {
      // One request, one database transaction. The purchase orders, the payment record, its
      // per-order allocations and the payable balance either all move or none of them do
      // (jde_pay_supplier). This screen used to PATCH each purchase order from here in a loop and
      // then adjust the balance separately, so a connection failure partway through could leave
      // orders marked paid while nothing came off what the supplier was owed — and a retry made
      // it worse rather than better.
      const res = await fetch('/api/suppliers/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: activeCompany.id,
          supplierId: paymentSupplier.id,
          date: shopDay(new Date()),
          amount: paid,
          note: '',
          reference: paymentReference,
          money: paymentMoney,
        }),
      });
      const result = await parseJsonOrThrow(res, 'Failed to record this payment.');
      await Promise.all([reloadSuppliers(), reloadPurchaseOrders()]);
      const orders = (result as { orders_paid?: number }).orders_paid ?? 0;
      setFeedback(
        `₹${paid.toLocaleString()} payment recorded for ${paymentSupplier.name}` +
          (orders > 0 ? ` against ${orders} purchase order${orders > 1 ? 's' : ''}.` : '.')
      );
      setPaymentSupplier(null);
      setPickSupplierPrompt(false);
      finishEntry();
    } catch (error) {
      // Nothing partial can be left behind now — the payment either landed whole or not at all.
      setPaymentError(error instanceof Error ? error.message : 'Failed to record this payment.');
    } finally {
      setSavingPayment(false);
    }
  };

  // How many purchase orders this vendor still has open. Counted with exactly the same test the
  // payment flow above uses, off orders this page already loads — nothing estimated.
  const unpaidOrderCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const po of purchaseOrders) {
      if (po.status === 'received' && Number(po.total) > Number(po.paid)) counts.set(po.supplier, (counts.get(po.supplier) ?? 0) + 1);
    }
    return counts;
  }, [purchaseOrders]);

  const balanceOf = (supplier: Supplier) => Number(supplier.balance) || 0;

  // Headline figures — a straight roll-up of the supplier rows this page already loaded. There is
  // no month-on-month movement here because the page holds no historical series to compare with.
  const owing = suppliers.filter((supplier) => balanceOf(supplier) > 0);
  // For the title line: what is owed, and apart from it what was paid in advance. Netted together,
  // an advance to one supplier would hide a debt to another.
  const youOwe = suppliers.reduce((sum, supplier) => sum + Math.max(0, balanceOf(supplier)), 0);
  const paidAhead = suppliers.reduce((sum, supplier) => sum + Math.max(0, -balanceOf(supplier)), 0);
  const largestCreditor = owing.reduce<Supplier | null>(
    (top, supplier) => (!top || balanceOf(supplier) > balanceOf(top) ? supplier : top),
    null,
  );

  const selectFilter = (next: LedgerFilter) => {
    setFilter(next);
    setPage(1);
  };

  // Paying needs a supplier, so arriving from the Day Book shows only the suppliers still owed and
  // says which button to press, rather than opening a payment for nobody. Saving the payment then
  // brings the owner back to the Day Book.
  const [pickSupplierPrompt, setPickSupplierPrompt] = useState(false);
  const { finishEntry } = useEntryIntent(SUPPLIER_ENTRY_KINDS, () => {
    selectFilter('balance');
    setPickSupplierPrompt(true);
  });

  // Tab counts are taken from the search result rather than the whole directory, so the number on
  // a tab is always exactly how many rows clicking it will show.
  const searchedOwing = filteredSuppliers.filter((supplier) => balanceOf(supplier) > 0);
  const searchedSettled = filteredSuppliers.filter((supplier) => balanceOf(supplier) <= 0);
  const filtered = filter === 'balance' ? searchedOwing : filter === 'settled' ? searchedSettled : filteredSuppliers;

  // Paging is clamped rather than reset by an effect: paying off the last vendor on page 3 lands
  // the view on the new last page instead of showing an empty table.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const firstIndex = (currentPage - 1) * PAGE_SIZE;
  const visible = filtered.slice(firstIndex, firstIndex + PAGE_SIZE);
  const pagePayable = visible.reduce((sum, supplier) => sum + balanceOf(supplier), 0);
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1).filter(
    (number) => number === 1 || number === totalPages || Math.abs(number - currentPage) <= 1,
  );

  return <div>
    <div className="page-header">
      <div>
        <h1 className="page-title">Suppliers</h1>
        {/* The headline figures, as one line where three number boxes and a warning strip used to be. */}
        {suppliers.length > 0 ? (
          <SummaryLine facts={[
            { value: String(suppliers.length), label: suppliers.length === 1 ? 'supplier' : 'suppliers' },
            { value: `₹${wholeMoney(youOwe)}`, label: 'to pay', tone: youOwe > 0 ? 'warn' : 'good', hint: 'What you owe suppliers, added up' },
            ...(paidAhead > 0 ? [{ value: `₹${wholeMoney(paidAhead)}`, label: 'paid ahead', hint: 'Suppliers you have paid more than they billed' }] : []),
            ...(owing.length > 0 ? [{
              value: String(owing.length),
              label: owing.length === 1 ? 'is waiting to be paid' : 'are waiting to be paid',
              hint: largestCreditor ? `Most: ${largestCreditor.name}, ₹${money(balanceOf(largestCreditor))}` : undefined,
            }] : []),
          ]} />
        ) : (
          <p className="page-subtitle">The companies you buy parts from, and what you owe each one</p>
        )}
      </div>
      <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> Add a supplier</button>
    </div>

    {feedback && <div className="alert alert-success mb-4" role="status">{feedback}</div>}
    {pickSupplierPrompt && (
      <div className="alert alert-info mb-4" role="status">
        Find the supplier you paid and press <strong>Pay</strong> on their row. Only suppliers you still owe are shown.
      </div>
    )}

    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="tbl-toolbar">
        <div className="tbl-toolbar-title">
          <strong>All suppliers</strong>
          <small>What you owe each one, their credit terms and how to reach them</small>
        </div>
        <div className="tbl-tools">
          <div className="tabs" role="tablist" aria-label="Filter suppliers">
            <button type="button" role="tab" aria-selected={filter === 'all'} className={`tab ${filter === 'all' ? 'active' : ''}`} onClick={() => selectFilter('all')}>
              All <span className="tab-count">{filteredSuppliers.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={filter === 'balance'} className={`tab ${filter === 'balance' ? 'active' : ''}`} onClick={() => selectFilter('balance')}>
              With balance <span className="tab-count">{searchedOwing.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={filter === 'settled'} className={`tab ${filter === 'settled' ? 'active' : ''}`} onClick={() => selectFilter('settled')}>
              Settled <span className="tab-count">{searchedSettled.length}</span>
            </button>
          </div>

          <div className="search-bar" style={{ minWidth: '240px' }}>
            <Search className="search-bar-icon" size={16} />
            <input
              type="text"
              placeholder="Search by name, phone, email, GSTIN..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>
      </div>

      {suppliers.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Truck size={22} /></div>
          <div className="empty-state-title">{loading ? 'Loading suppliers…' : 'No suppliers yet'}</div>
          <p className="empty-state-desc">
            {loading ? 'Fetching suppliers for the active company.' : 'Add your first supplier to get started.'}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">Nothing in this view</div>
          <p className="empty-state-desc">
            {search
              ? 'No supplier matches this search in the selected tab.'
              : filter === 'balance'
                ? 'No supplier is carrying a balance right now.'
                : 'Every supplier on file is carrying a balance.'}
          </p>
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="erp-table" style={{ minWidth: '1040px' }}>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Contact</th>
                  <th>GSTIN</th>
                  <th>Category</th>
                  <th>Terms</th>
                  <th className="text-right" style={{ textAlign: 'right' }}>Payable</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((supplier) => {
                  const balance = balanceOf(supplier);
                  const openOrders = unpaidOrderCount.get(supplier.name) ?? 0;
                  return (
                    <tr key={supplier.id}>
                      <td>
                        <div className="font-semibold">{supplier.name}</div>
                      </td>
                      <td>
                        <div className="directory-details">
                          <div className="flex items-center gap-2"><Phone size={13} /><span>{supplier.phone || 'No phone'}</span></div>
                          <div className="flex items-center gap-2"><Mail size={13} /><span className="truncate" style={{ maxWidth: '190px' }}>{supplier.email || 'No email'}</span></div>
                        </div>
                      </td>
                      <td>
                        {supplier.gstin
                          ? <span className="pn-chip">{supplier.gstin}</span>
                          : <span className="text-muted text-sm">Not provided</span>}
                      </td>
                      <td>
                        {supplier.category
                          ? <span className="brand-chip" style={{ '--brand-chip-color': categoryChipColor(supplier.category) } as React.CSSProperties}>{supplier.category}</span>
                          : <span className="text-muted text-sm">—</span>}
                      </td>
                      <td><span className="badge badge-muted">{supplier.terms} days</span></td>
                      <td className="text-right">
                        {balance > 0 ? (
                          <>
                            <strong>₹{balance.toLocaleString()}</strong>
                            {openOrders > 0 && (
                              <div className="text-muted text-sm">{openOrders} unpaid order{openOrders > 1 ? 's' : ''}</div>
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
                          <button className="btn btn-secondary btn-sm" disabled={!supplier.balance} onClick={() => openPayment(supplier)}>Pay</button>
                          <button className="btn btn-ghost btn-sm" aria-label={`Draft payment follow-up for ${supplier.name}`} title="Draft a payment follow-up message" disabled={!supplier.balance} onClick={() => setReminderSupplier(supplier)}><Sparkles size={14} /></button>
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
              Showing <strong>{firstIndex + 1}–{firstIndex + visible.length}</strong> of <strong>{filtered.length}</strong> suppliers
              {pagePayable > 0 && <> · <strong>₹{pagePayable.toLocaleString()}</strong> payable on this page</>}
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

    {showModal && <div className="modal-overlay"><div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="supplier-modal-title"><form onSubmit={saveSupplier} onKeyDown={(event) => keepEnterInsideForm(event, !savingSupplier)}>
      <div className="modal-header"><h3 id="supplier-modal-title" className="modal-title">Add Supplier Profile</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setShowModal(false)}>✕</button></div>
      <div className="modal-body flex flex-col gap-4"><div className="form-group"><label className="form-label">Supplier Company Name *</label><input className="form-input" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
        <div className="form-grid-2"><div className="form-group"><label className="form-label">Category</label><select className="form-input form-select" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{categoryOptions.map((c) => <option key={c}>{c}</option>)}</select></div><div className="form-group"><label className="form-label">Credit Terms (Days)</label><input type="number" min="0" className="form-input" value={form.terms} onChange={(event) => setForm({ ...form, terms: Number(event.target.value) })} /></div></div>
        <div className="form-grid-2"><div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div><div className="form-group"><label className="form-label">Email</label><input type="email" className="form-input" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div></div>
        <div className="form-group"><label className="form-label">GSTIN</label><input className="form-input" value={form.gstin} onChange={(event) => setForm({ ...form, gstin: event.target.value })} /></div>
        {supplierError && <p className="form-error" role="alert">{supplierError}</p>}
      </div><div className="modal-footer"><span className="text-muted text-sm" style={{ marginRight: 'auto' }}>{SAVE_SHORTCUT_HINT}</span><button type="button" className="btn btn-secondary" disabled={savingSupplier} onClick={() => setShowModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={savingSupplier}>{savingSupplier ? 'Saving…' : 'Save Supplier'}</button></div>
    </form></div></div>}

    {paymentSupplier && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '440px' }} role="dialog" aria-modal="true" aria-labelledby="payment-modal-title"><form onSubmit={recordPayment}>
      <div className="modal-header"><h3 id="payment-modal-title" className="modal-title">Pay a supplier</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" disabled={savingPayment} onClick={() => setPaymentSupplier(null)}>✕</button></div>
      <div className="modal-body flex flex-col gap-4"><p>Outstanding balance for <strong>{paymentSupplier.name}</strong>: ₹{paymentSupplier.balance.toLocaleString()}</p><div className="form-group"><label className="form-label">Payment Amount (₹)</label><input type="number" min="1" max={paymentSupplier.balance} className="form-input" disabled={savingPayment} value={paymentAmount} onChange={(event) => setPaymentAmount(Number(event.target.value))} /></div>{activeCompany && <MoneyPicker companyId={activeCompany.id} direction="out" value={paymentMoney} onChange={setPaymentMoney} disabled={savingPayment} />}
        {paymentError && <p className="form-error" role="alert">{paymentError}</p>}
      </div>
      <div className="modal-footer"><button type="button" className="btn btn-secondary" disabled={savingPayment} onClick={() => setPaymentSupplier(null)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={savingPayment}>{savingPayment ? 'Recording…' : 'Record Payment'}</button></div>
    </form></div></div>}

    {reminderSupplier && (
      <PaymentReminderModal
        direction="payable"
        name={reminderSupplier.name}
        balance={reminderSupplier.balance}
        context={overdueContext(reminderSupplier.name)}
        onClose={() => setReminderSupplier(null)}
      />
    )}
  </div>;
}
