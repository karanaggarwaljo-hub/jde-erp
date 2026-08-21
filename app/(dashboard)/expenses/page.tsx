'use client';

import { Fragment, useState } from 'react';
import { Plus, Sparkles, IndianRupee, PieChart, Receipt, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { createExpense } from '@/lib/client-expenses';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';

type Expense = { id: string; company_id: string; category: string; description: string; amount: number; date: string; paid_by: string; mode: string };

const PAGE_SIZE = 15;

// Stored values are terse keys; these are the same words the Log Expense form uses, so a row and
// the form that created it never disagree about what a category is called.
const CATEGORY_LABELS: Record<string, string> = {
  rent: 'Rent',
  salaries: 'Salaries',
  utilities: 'Utilities',
  transport: 'Freight & Transport',
  maintenance: 'Maintenance',
  office: 'Office & Stationery',
  other: 'Other',
};

const MODE_LABELS: Record<string, string> = {
  upi: 'UPI',
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
};

// Anything not in the maps above is shown as it was stored, just tidied — never dropped, so an
// older or hand-entered value still reads as itself rather than disappearing.
const titleCase = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : '');
const categoryLabel = (value: string) => CATEGORY_LABELS[value] ?? titleCase((value || '').replace(/_/g, ' '));
const modeLabel = (value: string) => MODE_LABELS[value] ?? titleCase((value || '').replace(/_/g, ' '));

export default function ExpensesPage() {
  const { rows: expenses, loading, reload, activeCompany } = useCompanyTable<Expense>('expenses');

  const [showModal, setShowModal] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [expenseError, setExpenseError] = useState('');
  const [savingExpense, setSavingExpense] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [categorizeFailed, setCategorizeFailed] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [newExp, setNewExp] = useState({
    category: 'transport',
    description: '',
    amount: '',
    paid_by: 'Karan Aggarwal',
    mode: 'upi',
  });

  const suggestCategory = async () => {
    if (!newExp.description.trim()) return;
    setCategorizing(true);
    setCategorizeFailed(false);
    try {
      const res = await fetch('/api/ai-categorize-expense', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: newExp.description }),
      });
      const body = (await parseJsonOrThrow(res, 'Categorization failed.')) as { category?: string };
      if (body.category) {
        setNewExp((current) => ({ ...current, category: body.category as string }));
      }
    } catch {
      // Suggestion is a convenience, not required — the category dropdown stays usable either way.
      // Still worth a quiet heads-up though: silently doing nothing looks identical to "broken."
      setCategorizeFailed(true);
    } finally {
      setCategorizing(false);
    }
  };

  const totalExpense = expenses.reduce((acc, curr) => acc + curr.amount, 0);

  const categoryTotals = new Map<string, number>();
  for (const exp of expenses) categoryTotals.set(exp.category, (categoryTotals.get(exp.category) ?? 0) + exp.amount);
  const largestCategory = Array.from(categoryTotals.entries()).sort((a, b) => b[1] - a[1])[0];

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCompany) return;
    setExpenseError('');
    setSavingExpense(true);
    try {
      // Id is generated inside jde_create_expense itself, not guessed client-side — same reasoning
      // as Purchases/Sales: it's globally unique across every company on this account, not scoped
      // per company, so a locally-computed guess can collide with another company's real records.
      await createExpense({
        companyId: activeCompany.id,
        category: newExp.category,
        description: newExp.description,
        amount: Number(newExp.amount),
        date: new Date().toISOString().split('T')[0],
        paidBy: newExp.paid_by,
        mode: newExp.mode,
      });
      await reload();
      setShowModal(false);
      setFeedback(`Expense ${newExp.description} saved.`);
      setNewExp({ category: 'transport', description: '', amount: '', paid_by: 'Karan Aggarwal', mode: 'upi' });
    } catch (error) {
      setExpenseError(error instanceof Error ? error.message : 'Failed to log this expense — please try again.');
    } finally {
      setSavingExpense(false);
    }
  };

  // Only the categories that actually appear in the loaded entries — the dropdown never offers a
  // filter that would return nothing.
  const presentCategories = Array.from(categoryTotals.keys()).sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b)));

  const filtered = categoryFilter === 'all' ? expenses : expenses.filter((exp) => exp.category === categoryFilter);

  // Paging is clamped rather than reset by an effect, so the view can never land on an empty page.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const firstIndex = (currentPage - 1) * PAGE_SIZE;
  const visible = filtered.slice(firstIndex, firstIndex + PAGE_SIZE);
  const pageTotal = visible.reduce((sum, exp) => sum + Number(exp.amount || 0), 0);
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1).filter(
    (number) => number === 1 || number === totalPages || Math.abs(number - currentPage) <= 1,
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Operating costs</div>
          <h1 className="page-title">Expense Management</h1>
          <p className="page-subtitle">Log operational costs, freight, salaries, rent &amp; utility expenditures</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setCategorizeFailed(false); setShowModal(true); }}>
          <Plus size={16} /> Log New Expense
        </button>
      </div>

      {feedback && <div className="alert alert-success mb-4" role="status">{feedback}</div>}

      {/* Headline figures, each one summed from the entries this page already loaded. The page
          loads every expense on file for the company — not a date range — so nothing here claims
          to be a month, a period or a trend. */}
      {expenses.length > 0 && (
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <div className="kpi-card" style={{ '--kpi-color': 'var(--chart-red)', '--kpi-color-bg': 'var(--rose-tint)' } as React.CSSProperties}>
            <div className="flex justify-between items-center">
              <span className="kpi-label">Total logged</span>
              <div className="kpi-icon-wrap"><IndianRupee size={18} /></div>
            </div>
            <div className="kpi-value">₹{totalExpense.toLocaleString()}</div>
            <span className="kpi-context">Every expense on file for this company</span>
          </div>

          <div className="kpi-card" style={{ '--kpi-color': 'var(--chart-violet)', '--kpi-color-bg': 'var(--panel-2)' } as React.CSSProperties}>
            <div className="flex justify-between items-center">
              <span className="kpi-label">Largest category</span>
              <div className="kpi-icon-wrap"><PieChart size={18} /></div>
            </div>
            <div className="kpi-value" style={{ fontSize: '18px' }}>{largestCategory ? categoryLabel(largestCategory[0]) : '—'}</div>
            <span className="kpi-context">
              {largestCategory
                ? `₹${largestCategory[1].toLocaleString()} of ₹${totalExpense.toLocaleString()} logged`
                : 'No expenses logged yet'}
            </span>
          </div>

          <div className="kpi-card" style={{ '--kpi-color': 'var(--chart-blue)', '--kpi-color-bg': 'var(--color-info-bg)' } as React.CSSProperties}>
            <div className="flex justify-between items-center">
              <span className="kpi-label">Log entries</span>
              <div className="kpi-icon-wrap"><Receipt size={18} /></div>
            </div>
            <div className="kpi-value">{expenses.length}</div>
            <span className="kpi-context">
              {categoryTotals.size > 0
                ? `Across ${categoryTotals.size} ${categoryTotals.size === 1 ? 'category' : 'categories'}`
                : 'No category recorded yet'}
            </span>
          </div>
        </div>
      )}

      {/* Expenses Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="tbl-toolbar">
          <div className="tbl-toolbar-title">
            <strong>Expense log</strong>
            <small>Every operational cost recorded for this company</small>
          </div>
          {presentCategories.length > 1 && (
            <div className="tbl-tools">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Filter size={16} color="var(--text-muted)" />
                <select
                  className="form-input form-select"
                  style={{ width: '200px' }}
                  aria-label="Filter by category"
                  value={categoryFilter}
                  onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
                >
                  <option value="all">All categories</option>
                  {presentCategories.map((category) => (
                    <option key={category} value={category}>{categoryLabel(category)}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {expenses.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Receipt size={22} /></div>
            <div className="empty-state-title">{loading ? 'Loading expenses…' : 'No expenses logged yet'}</div>
            <p className="empty-state-desc">
              {loading ? 'Fetching records for the active company.' : 'Log your first expense to get started.'}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">Nothing in this view</div>
            <p className="empty-state-desc">No expense is logged under this category.</p>
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="erp-table" style={{ minWidth: '900px' }}>
                <thead>
                  <tr>
                    <th>Exp #</th>
                    <th>Category</th>
                    <th>Description</th>
                    <th>Date</th>
                    <th>Paid By</th>
                    <th>Mode</th>
                    <th className="text-right" style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((exp) => (
                    <tr key={exp.id}>
                      <td><span className="pn-chip">{exp.id}</span></td>
                      <td><span className="badge badge-info">{categoryLabel(exp.category)}</span></td>
                      <td className="font-semibold truncate" style={{ maxWidth: '280px' }}>{exp.description}</td>
                      <td className="text-muted">{exp.date}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{exp.paid_by}</td>
                      <td className="text-muted">{modeLabel(exp.mode)}</td>
                      <td className="text-right"><strong>₹{Number(exp.amount || 0).toLocaleString()}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pager">
              <div className="pager-info">
                Showing <strong>{firstIndex + 1}–{firstIndex + visible.length}</strong> of <strong>{filtered.length}</strong> entries
                {pageTotal > 0 && <> · <strong>₹{pageTotal.toLocaleString()}</strong> on this page</>}
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

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-header">
              <h3 className="modal-title">Log Operational Expense</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={handleAdd}>
              <div className="modal-body flex flex-col gap-4">
                {expenseError && <div className="alert alert-danger" role="alert">{expenseError}</div>}
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label flex items-center gap-1">Category * {categorizing && <Sparkles size={12} className="text-brand spin" />}</label>
                    <select className="form-input form-select" value={newExp.category} onChange={e => setNewExp({ ...newExp, category: e.target.value })}>
                      <option value="rent">Rent</option>
                      <option value="salaries">Salaries</option>
                      <option value="utilities">Utilities</option>
                      <option value="transport">Freight & Transport</option>
                      <option value="maintenance">Maintenance</option>
                      <option value="office">Office & Stationery</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Amount (₹) *</label>
                    <input type="number" className="form-input" required value={newExp.amount} onChange={e => setNewExp({ ...newExp, amount: e.target.value })} />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Expense Description *</label>
                  <input className="form-input" required placeholder="e.g. Courier charges for spare shipment" value={newExp.description} onChange={e => setNewExp({ ...newExp, description: e.target.value })} onBlur={suggestCategory} />
                  <small style={{ color: 'var(--text-muted)' }}>{categorizeFailed ? "Couldn't suggest a category this time — pick one yourself above." : 'Category is suggested automatically once you finish typing this — override it anytime.'}</small>
                </div>

                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">Paid By</label>
                    <input className="form-input" value={newExp.paid_by} onChange={e => setNewExp({ ...newExp, paid_by: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Payment Mode</label>
                    <select className="form-input form-select" value={newExp.mode} onChange={e => setNewExp({ ...newExp, mode: e.target.value })}>
                      <option value="upi">UPI</option>
                      <option value="cash">Cash</option>
                      <option value="bank_transfer">Bank Transfer</option>
                      <option value="cheque">Cheque</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" disabled={savingExpense} onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={savingExpense}>{savingExpense ? 'Saving…' : 'Save Expense Entry'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
