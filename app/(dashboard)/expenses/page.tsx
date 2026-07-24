'use client';

import { useState } from 'react';
import { Receipt, Plus, Filter, Calendar, CreditCard, DollarSign } from 'lucide-react';

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState([
    { id: 'EXP-101', category: 'rent', description: 'Warehouse & Office Rent (July 2026)', amount: 45000, date: '2026-07-01', paid_by: 'Karan Aggarwal', mode: 'bank_transfer' },
    { id: 'EXP-102', category: 'transport', description: 'Freight charges for Bosch order', amount: 3200, date: '2026-07-15', paid_by: 'Warehouse Staff', mode: 'cash' },
    { id: 'EXP-103', category: 'utilities', description: 'Electricity Bill - Shop & Storage', amount: 8400, date: '2026-07-18', paid_by: 'Manager', mode: 'upi' },
    { id: 'EXP-104', category: 'salaries', description: 'Staff Salaries Advance', amount: 25000, date: '2026-07-20', paid_by: 'Karan Aggarwal', mode: 'bank_transfer' },
    { id: 'EXP-105', category: 'office', description: 'Printer paper & packaging tape', amount: 1450, date: '2026-07-22', paid_by: 'Accountant', mode: 'cash' },
  ]);

  const [showModal, setShowModal] = useState(false);
  const [newExp, setNewExp] = useState({
    category: 'transport',
    description: '',
    amount: '',
    paid_by: 'Karan Aggarwal',
    mode: 'upi',
  });

  const totalExpense = expenses.reduce((acc, curr) => acc + curr.amount, 0);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    setExpenses([
      {
        id: `EXP-10${expenses.length + 1}`,
        category: newExp.category,
        description: newExp.description,
        amount: Number(newExp.amount),
        date: new Date().toISOString().split('T')[0],
        paid_by: newExp.paid_by,
        mode: newExp.mode,
      },
      ...expenses,
    ]);
    setShowModal(false);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Expense Management</h1>
          <p className="page-subtitle">Log operational costs, freight, salaries, rent & utility expenditures</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Log New Expense
        </button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid-3 mb-6">
        <div className="card">
          <span className="kpi-label">Total Expenses (This Month)</span>
          <div className="kpi-value text-danger" style={{ marginTop: '8px' }}>₹{totalExpense.toLocaleString()}</div>
        </div>
        <div className="card">
          <span className="kpi-label">Largest Expense Category</span>
          <div className="kpi-value" style={{ marginTop: '8px', fontSize: '18px' }}>Rent & Facility (₹45,000)</div>
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
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">Category *</label>
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
                  <input className="form-input" required placeholder="e.g. Courier charges for spare shipment" value={newExp.description} onChange={e => setNewExp({ ...newExp, description: e.target.value })} />
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
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Expense Entry</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
