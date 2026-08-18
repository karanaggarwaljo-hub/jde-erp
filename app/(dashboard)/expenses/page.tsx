'use client';

import { useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { createExpense } from '@/lib/client-expenses';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';

type Expense = { id: string; company_id: string; category: string; description: string; amount: number; date: string; paid_by: string; mode: string };

export default function ExpensesPage() {
  const { rows: expenses, loading, reload, activeCompany } = useCompanyTable<Expense>('expenses');

  const [showModal, setShowModal] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [expenseError, setExpenseError] = useState('');
  const [savingExpense, setSavingExpense] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [categorizeFailed, setCategorizeFailed] = useState(false);
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Expense Management</h1>
          <p className="page-subtitle">Log operational costs, freight, salaries, rent & utility expenditures</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setCategorizeFailed(false); setShowModal(true); }}>
          <Plus size={16} /> Log New Expense
        </button>
      </div>

      {feedback && <div className="alert alert-success mb-4" role="status">{feedback}</div>}

      {/* Summary KPI Cards */}
      <div className="grid-3 mb-6">
        <div className="card">
          <span className="kpi-label">Total Expenses (This Month)</span>
          <div className="kpi-value text-danger" style={{ marginTop: '8px' }}>₹{totalExpense.toLocaleString()}</div>
        </div>
        <div className="card">
          <span className="kpi-label">Largest Expense Category</span>
          <div className="kpi-value" style={{ marginTop: '8px', fontSize: '18px' }}>{largestCategory ? `${largestCategory[0]} (₹${largestCategory[1].toLocaleString()})` : 'No expenses yet'}</div>
        </div>
        <div className="card">
          <span className="kpi-label">Log Entries</span>
          <div className="kpi-value" style={{ marginTop: '8px', fontSize: '18px' }}>{expenses.length} Records</div>
        </div>
      </div>

      {/* Expenses Table */}
      <div className="table-wrap">
        <table className="erp-table">
          <thead>
            <tr>
              <th>Exp #</th>
              <th>Category</th>
              <th>Description</th>
              <th>Date</th>
              <th>Paid By</th>
              <th>Mode</th>
              <th className="text-right">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((exp) => (
              <tr key={exp.id}>
                <td style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>{exp.id}</td>
                <td>
                  <span className="badge badge-info">{exp.category.toUpperCase()}</span>
                </td>
                <td style={{ fontWeight: 600 }}>{exp.description}</td>
                <td style={{ color: 'var(--text-muted)' }}>{exp.date}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{exp.paid_by}</td>
                <td style={{ color: 'var(--text-muted)' }}>{exp.mode.toUpperCase()}</td>
                <td className="text-right font-semibold text-danger">₹{exp.amount.toLocaleString()}</td>
              </tr>
            ))}
            {expenses.length === 0 && (
              <tr><td colSpan={7}><div className="empty-state"><p className="empty-state-title">{loading ? 'Loading expenses…' : 'No expenses logged yet'}</p><p className="empty-state-desc">{loading ? 'Fetching records for the active company.' : 'Log your first expense to get started.'}</p></div></td></tr>
            )}
          </tbody>
        </table>
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
