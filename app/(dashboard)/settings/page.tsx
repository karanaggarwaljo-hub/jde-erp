'use client';

import { useState } from 'react';
import { Settings, Shield, User, Building, FileText, Lock, History } from 'lucide-react';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'users' | 'company' | 'audit'>('users');

  const users = [
    { name: 'Karan Aggarwal', email: 'karan@jaidurga.com', role: 'owner', status: 'active' },
    { name: 'Rajesh Sharma', email: 'rajesh@jaidurga.com', role: 'manager', status: 'active' },
    { name: 'Vikram Singh', email: 'vikram@jaidurga.com', role: 'salesman', status: 'active' },
    { name: 'Amit Kumar', email: 'amit@jaidurga.com', role: 'accountant', status: 'active' },
    { name: 'Suresh Verma', email: 'suresh@jaidurga.com', role: 'warehouse', status: 'active' },
  ];

  const auditLogs = [
    { user: 'Karan Aggarwal', action: 'Created Invoice #INV-1042', table: 'erp_invoices', time: '2026-07-23 04:15 PM' },
    { user: 'Rajesh Sharma', action: 'Updated stock for SP-001 (+45)', table: 'erp_stock_ledger', time: '2026-07-23 11:30 AM' },
    { user: 'Vikram Singh', action: 'Created Quotation #QT-1015', table: 'erp_quotations', time: '2026-07-23 10:00 AM' },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">System Settings & Administration</h1>
          <p className="page-subtitle">Configure company details, role permissions, invoice formats & inspect audit logs</p>
        </div>
      </div>

      <div className="tabs mb-6">
        <button className={`tab ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
          User Roles & Access ({users.length})
        </button>
        <button className={`tab ${activeTab === 'company' ? 'active' : ''}`} onClick={() => setActiveTab('company')}>
          Company Profile & Tax
        </button>
        <button className={`tab ${activeTab === 'audit' ? 'active' : ''}`} onClick={() => setActiveTab('audit')}>
          Audit Logs
        </button>
      </div>

      {activeTab === 'users' && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">User Accounts & Roles</h3>
            <button className="btn btn-primary btn-sm">+ Invite User</button>
          </div>

          <div className="table-wrap">
            <table className="erp-table">
              <thead>
                <tr>
                  <th>User Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th className="text-center">Permissions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{u.name}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{u.email}</td>
                    <td>
                      <span className={`badge ${u.role === 'owner' ? 'badge-warning' : u.role === 'manager' ? 'badge-info' : 'badge-muted'}`}>
                        {u.role.toUpperCase()}
                      </span>
                    </td>
                    <td><span className="badge badge-success">ACTIVE</span></td>
                    <td className="text-center">
                      <button className="btn btn-ghost btn-sm">Edit Role</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'company' && (
        <div className="card" style={{ maxWidth: '650px' }}>
          <h3 className="card-title mb-4">Jai Durga Enterprises Profile</h3>
          <div className="flex flex-col gap-4">
            <div className="form-group">
              <label className="form-label">Company Business Name</label>
              <input className="form-input" defaultValue="Jai Durga Enterprises" />
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">GSTIN</label>
                <input className="form-input" defaultValue="07AAAAA0000A1Z5" />
              </div>
              <div className="form-group">
                <label className="form-label">Currency</label>
                <input className="form-input" defaultValue="INR (₹)" disabled />
              </div>
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Invoice Prefix</label>
                <input className="form-input" defaultValue="INV" />
              </div>
              <div className="form-group">
                <label className="form-label">PO Prefix</label>
                <input className="form-input" defaultValue="PO" />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Registered Office Address</label>
              <textarea className="form-input" rows={2} defaultValue="Plot 42, Mayapuri Industrial Area Phase II, New Delhi - 110064" />
            </div>
            <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>Save Configuration</button>
          </div>
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="table-wrap">
          <table className="erp-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Action Performed</th>
                <th>Table</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log, i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{log.time}</td>
                  <td style={{ fontWeight: 600 }}>{log.user}</td>
                  <td>{log.action}</td>
                  <td style={{ fontFamily: 'monospace', color: 'var(--brand-primary)', fontSize: '12px' }}>{log.table}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
