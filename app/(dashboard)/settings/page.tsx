'use client';

import { FormEvent, useState } from 'react';

type SettingsTab = 'users' | 'company' | 'audit';
type UserAccount = { name: string; email: string; role: string; status: string };

const initialUsers: UserAccount[] = [
  { name: 'Karan Aggarwal', email: 'karan@jaidurga.com', role: 'owner', status: 'active' },
  { name: 'Rajesh Sharma', email: 'rajesh@jaidurga.com', role: 'manager', status: 'active' },
  { name: 'Vikram Singh', email: 'vikram@jaidurga.com', role: 'salesman', status: 'active' },
  { name: 'Amit Kumar', email: 'amit@jaidurga.com', role: 'accountant', status: 'active' },
  { name: 'Suresh Verma', email: 'suresh@jaidurga.com', role: 'warehouse', status: 'active' },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('users');
  const [users, setUsers] = useState(initialUsers);
  const [feedback, setFeedback] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ name: '', email: '', role: 'salesman' });
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState('salesman');
  const [company, setCompany] = useState({ name: 'Jai Durga Enterprises', gstin: '07AAAAA0000A1Z5', invoicePrefix: 'INV', poPrefix: 'PO', address: 'Plot 42, Mayapuri Industrial Area Phase II, New Delhi - 110064' });

  const auditLogs = [
    { user: 'Karan Aggarwal', action: 'Created Invoice #INV-1042', table: 'erp_invoices', time: '2026-07-23 04:15 PM' },
    { user: 'Rajesh Sharma', action: 'Updated stock for SP-001 (+45)', table: 'erp_stock_ledger', time: '2026-07-23 11:30 AM' },
    { user: 'Vikram Singh', action: 'Created Quotation #QT-1015', table: 'erp_quotations', time: '2026-07-23 10:00 AM' },
  ];

  const inviteUser = (event: FormEvent) => {
    event.preventDefault();
    setUsers((current) => [...current, { ...invite, status: 'invited' }]);
    setInviteOpen(false);
    setFeedback(`Invitation created for ${invite.email}.`);
    setInvite({ name: '', email: '', role: 'salesman' });
  };

  const saveRole = (event: FormEvent) => {
    event.preventDefault();
    setUsers((current) => current.map((user) => user.email === editingEmail ? { ...user, role: editingRole } : user));
    setFeedback('User role updated.');
    setEditingEmail(null);
  };

  return <div>
    <div className="page-header"><div><h1 className="page-title">System Settings & Administration</h1><p className="page-subtitle">Configure company details, role permissions, invoice formats and audit logs</p></div></div>
    {feedback && <div className="alert alert-success mb-4" role="status">{feedback}</div>}
    <div className="tabs mb-6"><button className={`tab ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>User Roles & Access ({users.length})</button><button className={`tab ${activeTab === 'company' ? 'active' : ''}`} onClick={() => setActiveTab('company')}>Company Profile & Tax</button><button className={`tab ${activeTab === 'audit' ? 'active' : ''}`} onClick={() => setActiveTab('audit')}>Audit Logs</button></div>

    {activeTab === 'users' && <div className="card"><div className="card-header"><h3 className="card-title">User Accounts & Roles</h3><button className="btn btn-primary btn-sm" onClick={() => setInviteOpen(true)}>+ Invite User</button></div><div className="table-wrap"><table className="erp-table"><thead><tr><th>User Name</th><th>Email</th><th>Role</th><th>Status</th><th className="text-center">Permissions</th></tr></thead><tbody>{users.map((user) => <tr key={user.email}><td className="font-semibold">{user.name}</td><td className="text-muted">{user.email}</td><td><span className={`badge ${user.role === 'owner' ? 'badge-warning' : user.role === 'manager' ? 'badge-info' : 'badge-muted'}`}>{user.role.toUpperCase()}</span></td><td><span className={`badge ${user.status === 'active' ? 'badge-success' : 'badge-warning'}`}>{user.status.toUpperCase()}</span></td><td className="text-center"><button className="btn btn-ghost btn-sm" disabled={user.role === 'owner'} onClick={() => { setEditingEmail(user.email); setEditingRole(user.role); }}>Edit Role</button></td></tr>)}</tbody></table></div></div>}

    {activeTab === 'company' && <form className="card settings-form" onSubmit={(event) => { event.preventDefault(); setFeedback('Company configuration saved.'); }}><h3 className="card-title mb-4">Jai Durga Enterprises Profile</h3><div className="flex flex-col gap-4"><div className="form-group"><label className="form-label">Company Business Name</label><input className="form-input" value={company.name} onChange={(event) => setCompany({ ...company, name: event.target.value })} /></div><div className="form-grid-2"><div className="form-group"><label className="form-label">GSTIN</label><input className="form-input" value={company.gstin} onChange={(event) => setCompany({ ...company, gstin: event.target.value })} /></div><div className="form-group"><label className="form-label">Currency</label><input className="form-input" value="INR (₹)" disabled /></div></div><div className="form-grid-2"><div className="form-group"><label className="form-label">Invoice Prefix</label><input className="form-input" value={company.invoicePrefix} onChange={(event) => setCompany({ ...company, invoicePrefix: event.target.value })} /></div><div className="form-group"><label className="form-label">PO Prefix</label><input className="form-input" value={company.poPrefix} onChange={(event) => setCompany({ ...company, poPrefix: event.target.value })} /></div></div><div className="form-group"><label className="form-label">Registered Office Address</label><textarea className="form-input" rows={2} value={company.address} onChange={(event) => setCompany({ ...company, address: event.target.value })} /></div><button type="submit" className="btn btn-primary settings-save">Save Configuration</button></div></form>}

    {activeTab === 'audit' && <div className="table-wrap"><table className="erp-table"><thead><tr><th>Timestamp</th><th>User</th><th>Action Performed</th><th>Table</th></tr></thead><tbody>{auditLogs.map((log) => <tr key={`${log.time}-${log.action}`}><td className="text-muted text-sm">{log.time}</td><td className="font-semibold">{log.user}</td><td>{log.action}</td><td className="audit-table-name">{log.table}</td></tr>)}</tbody></table></div>}

    {inviteOpen && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '480px' }} role="dialog" aria-modal="true" aria-labelledby="invite-title"><form onSubmit={inviteUser}><div className="modal-header"><h3 id="invite-title" className="modal-title">Invite User</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setInviteOpen(false)}>✕</button></div><div className="modal-body flex flex-col gap-4"><div className="form-group"><label className="form-label">Full Name</label><input required className="form-input" value={invite.name} onChange={(event) => setInvite({ ...invite, name: event.target.value })} /></div><div className="form-group"><label className="form-label">Email</label><input required type="email" className="form-input" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} /></div><div className="form-group"><label className="form-label">Role</label><select className="form-input form-select" value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value })}><option value="manager">Manager</option><option value="salesman">Salesperson</option><option value="accountant">Accountant</option><option value="warehouse">Warehouse</option></select></div></div><div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setInviteOpen(false)}>Cancel</button><button type="submit" className="btn btn-primary">Create Invitation</button></div></form></div></div>}

    {editingEmail && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '420px' }} role="dialog" aria-modal="true" aria-labelledby="role-title"><form onSubmit={saveRole}><div className="modal-header"><h3 id="role-title" className="modal-title">Edit User Role</h3></div><div className="modal-body"><div className="form-group"><label className="form-label">Role</label><select className="form-input form-select" value={editingRole} onChange={(event) => setEditingRole(event.target.value)}><option value="manager">Manager</option><option value="salesman">Salesperson</option><option value="accountant">Accountant</option><option value="warehouse">Warehouse</option></select></div></div><div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setEditingEmail(null)}>Cancel</button><button type="submit" className="btn btn-primary">Save Role</button></div></form></div></div>}
  </div>;
}
