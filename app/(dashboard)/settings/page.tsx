'use client';

import { FormEvent, useState } from 'react';
import BackupsPanel from '@/components/BackupsPanel';
import { useCompany, type Company } from '@/components/CompanyProvider';
import { useCompanyTable } from '@/lib/useCompanyTable';

type SettingsTab = 'users' | 'company' | 'audit' | 'backups';
type UserAccount = { email: string; company_id: string; name: string; role: string; status: string };

const emptyCompanyForm = { name: '', gstin: '', invoice_prefix: 'INV', po_prefix: 'PO', address: '' };

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('users');
  const { rows: users, loading: usersLoading, create: createUser, update: updateUser } = useCompanyTable<UserAccount>('users');
  const [feedback, setFeedback] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ name: '', email: '', role: 'salesman' });
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState('salesman');

  const { companies, addCompany, updateCompany, switchCompany, removeCompany } = useCompany();
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [companyForm, setCompanyForm] = useState(emptyCompanyForm);
  const [deleteCompanyCandidate, setDeleteCompanyCandidate] = useState<Company | null>(null);
  const [deleteCompanyError, setDeleteCompanyError] = useState('');

  const auditLogs = [
    { user: 'Karan Aggarwal', action: 'Created Invoice #INV-1042', table: 'erp_invoices', time: '2026-07-23 04:15 PM' },
    { user: 'Rajesh Sharma', action: 'Updated stock for SP-001 (+45)', table: 'erp_stock_ledger', time: '2026-07-23 11:30 AM' },
    { user: 'Vikram Singh', action: 'Created Quotation #QT-1015', table: 'erp_quotations', time: '2026-07-23 10:00 AM' },
  ];

  const inviteUser = async (event: FormEvent) => {
    event.preventDefault();
    await createUser({ ...invite, status: 'invited' });
    setInviteOpen(false);
    setFeedback(`Invitation created for ${invite.email}.`);
    setInvite({ name: '', email: '', role: 'salesman' });
  };

  const saveRole = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingEmail) return;
    await updateUser(editingEmail, { role: editingRole });
    setFeedback('User role updated.');
    setEditingEmail(null);
  };

  const openAddCompany = () => {
    setEditingCompanyId(null);
    setCompanyForm(emptyCompanyForm);
    setCompanyModalOpen(true);
  };

  const openEditCompany = (company: Company) => {
    setEditingCompanyId(company.id);
    setCompanyForm({ name: company.name, gstin: company.gstin, invoice_prefix: company.invoice_prefix, po_prefix: company.po_prefix, address: company.address });
    setCompanyModalOpen(true);
  };

  const saveCompany = async (event: FormEvent) => {
    event.preventDefault();
    if (editingCompanyId) {
      await updateCompany(editingCompanyId, companyForm);
      setFeedback(`${companyForm.name} updated.`);
    } else {
      await addCompany(companyForm);
      setFeedback(`${companyForm.name} added with no data of its own yet. Click "Set Active" when you're ready to switch to it.`);
    }
    setCompanyModalOpen(false);
  };

  const handleSetActiveCompany = async (id: string) => {
    const target = companies.find((c) => c.id === id);
    await switchCompany(id);
    setFeedback(`${target?.name ?? 'Company'} is now the active company.`);
  };

  const confirmDeleteCompany = async () => {
    if (!deleteCompanyCandidate) return;
    setDeleteCompanyError('');
    const result = await removeCompany(deleteCompanyCandidate.id);
    if ('error' in result) {
      setDeleteCompanyError(result.error);
      return;
    }
    setFeedback(`${deleteCompanyCandidate.name} removed.`);
    setDeleteCompanyCandidate(null);
  };

  return <div>
    <div className="page-header"><div><h1 className="page-title">System Settings & Administration</h1><p className="page-subtitle">Configure company details, role permissions, invoice formats and audit logs</p></div></div>
    {feedback && <div className="alert alert-success mb-4" role="status">{feedback}</div>}
    <div className="tabs mb-6"><button className={`tab ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>User Roles & Access ({users.length})</button><button className={`tab ${activeTab === 'company' ? 'active' : ''}`} onClick={() => setActiveTab('company')}>Companies ({companies.length})</button><button className={`tab ${activeTab === 'audit' ? 'active' : ''}`} onClick={() => setActiveTab('audit')}>Audit Logs</button><button className={`tab ${activeTab === 'backups' ? 'active' : ''}`} onClick={() => setActiveTab('backups')}>Data Backups</button></div>

    {activeTab === 'users' && <div className="card"><div className="card-header"><h3 className="card-title">User Accounts & Roles</h3><button className="btn btn-primary btn-sm" onClick={() => setInviteOpen(true)}>+ Invite User</button></div><div className="table-wrap"><table className="erp-table"><thead><tr><th>User Name</th><th>Email</th><th>Role</th><th>Status</th><th className="text-center">Permissions</th></tr></thead><tbody>{users.map((user) => <tr key={user.email}><td className="font-semibold">{user.name}</td><td className="text-muted">{user.email}</td><td><span className={`badge ${user.role === 'owner' ? 'badge-warning' : user.role === 'manager' ? 'badge-info' : 'badge-muted'}`}>{user.role.toUpperCase()}</span></td><td><span className={`badge ${user.status === 'active' ? 'badge-success' : 'badge-warning'}`}>{user.status.toUpperCase()}</span></td><td className="text-center"><button className="btn btn-ghost btn-sm" disabled={user.role === 'owner'} onClick={() => { setEditingEmail(user.email); setEditingRole(user.role); }}>Edit Role</button></td></tr>)}
      {users.length === 0 && (
        <tr><td colSpan={5}><div className="empty-state"><p className="empty-state-title">{usersLoading ? 'Loading users…' : 'No users yet'}</p><p className="empty-state-desc">{usersLoading ? 'Fetching accounts for the active company.' : 'Invite your first user to get started.'}</p></div></td></tr>
      )}
      </tbody></table></div></div>}

    {activeTab === 'company' && (
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Companies</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Manage the businesses run through this ERP. Only one company can be active at a time — switch anytime.</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={openAddCompany}>+ Add Company</button>
        </div>
        <div className="table-wrap">
          <table className="erp-table">
            <thead><tr><th>Company</th><th>GSTIN</th><th>Invoice Prefix</th><th>PO Prefix</th><th>Status</th><th className="text-center">Actions</th></tr></thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-secondary)' }}>{c.gstin || 'Not provided'}</td>
                  <td>{c.invoice_prefix}</td>
                  <td>{c.po_prefix}</td>
                  <td>{c.is_active ? <span className="badge badge-success">ACTIVE</span> : <span className="badge badge-muted">INACTIVE</span>}</td>
                  <td className="text-center">
                    <div className="flex justify-between gap-1 items-center">
                      {!c.is_active && <button className="btn btn-secondary btn-sm" onClick={() => handleSetActiveCompany(c.id)}>Set Active</button>}
                      <button className="btn btn-ghost btn-sm" onClick={() => openEditCompany(c)}>Edit</button>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--color-danger)' }}
                        disabled={!!c.is_active || companies.length <= 1}
                        title={c.is_active ? 'Set another company active before deleting this one' : companies.length <= 1 ? 'At least one company must remain' : undefined}
                        onClick={() => { setDeleteCompanyError(''); setDeleteCompanyCandidate(c); }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )}

    {activeTab === 'audit' && <div className="table-wrap"><table className="erp-table"><thead><tr><th>Timestamp</th><th>User</th><th>Action Performed</th><th>Table</th></tr></thead><tbody>{auditLogs.map((log) => <tr key={`${log.time}-${log.action}`}><td className="text-muted text-sm">{log.time}</td><td className="font-semibold">{log.user}</td><td>{log.action}</td><td className="audit-table-name">{log.table}</td></tr>)}</tbody></table></div>}

    {activeTab === 'backups' && <BackupsPanel />}

    {inviteOpen && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '480px' }} role="dialog" aria-modal="true" aria-labelledby="invite-title"><form onSubmit={inviteUser}><div className="modal-header"><h3 id="invite-title" className="modal-title">Invite User</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setInviteOpen(false)}>✕</button></div><div className="modal-body flex flex-col gap-4"><div className="form-group"><label className="form-label">Full Name</label><input required className="form-input" value={invite.name} onChange={(event) => setInvite({ ...invite, name: event.target.value })} /></div><div className="form-group"><label className="form-label">Email</label><input required type="email" className="form-input" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} /></div><div className="form-group"><label className="form-label">Role</label><select className="form-input form-select" value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value })}><option value="manager">Manager</option><option value="salesman">Salesperson</option><option value="accountant">Accountant</option><option value="warehouse">Warehouse</option></select></div></div><div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setInviteOpen(false)}>Cancel</button><button type="submit" className="btn btn-primary">Create Invitation</button></div></form></div></div>}

    {editingEmail && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '420px' }} role="dialog" aria-modal="true" aria-labelledby="role-title"><form onSubmit={saveRole}><div className="modal-header"><h3 id="role-title" className="modal-title">Edit User Role</h3></div><div className="modal-body"><div className="form-group"><label className="form-label">Role</label><select className="form-input form-select" value={editingRole} onChange={(event) => setEditingRole(event.target.value)}><option value="manager">Manager</option><option value="salesman">Salesperson</option><option value="accountant">Accountant</option><option value="warehouse">Warehouse</option></select></div></div><div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setEditingEmail(null)}>Cancel</button><button type="submit" className="btn btn-primary">Save Role</button></div></form></div></div>}

    {companyModalOpen && <div className="modal-overlay"><div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="company-modal-title"><form onSubmit={saveCompany}>
      <div className="modal-header"><h3 id="company-modal-title" className="modal-title">{editingCompanyId ? 'Edit Company' : 'Add New Company'}</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setCompanyModalOpen(false)}>✕</button></div>
      <div className="modal-body flex flex-col gap-4">
        <div className="form-group"><label className="form-label">Company Business Name *</label><input className="form-input" required value={companyForm.name} onChange={(event) => setCompanyForm({ ...companyForm, name: event.target.value })} /></div>
        <div className="form-grid-2">
          <div className="form-group"><label className="form-label">GSTIN</label><input className="form-input" value={companyForm.gstin} onChange={(event) => setCompanyForm({ ...companyForm, gstin: event.target.value })} /></div>
          <div className="form-group"><label className="form-label">Currency</label><input className="form-input" value="INR (₹)" disabled /></div>
        </div>
        <div className="form-grid-2">
          <div className="form-group"><label className="form-label">Invoice Prefix</label><input className="form-input" value={companyForm.invoice_prefix} onChange={(event) => setCompanyForm({ ...companyForm, invoice_prefix: event.target.value })} /></div>
          <div className="form-group"><label className="form-label">PO Prefix</label><input className="form-input" value={companyForm.po_prefix} onChange={(event) => setCompanyForm({ ...companyForm, po_prefix: event.target.value })} /></div>
        </div>
        <div className="form-group"><label className="form-label">Registered Office Address</label><textarea className="form-input" rows={2} value={companyForm.address} onChange={(event) => setCompanyForm({ ...companyForm, address: event.target.value })} /></div>
      </div>
      <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setCompanyModalOpen(false)}>Cancel</button><button type="submit" className="btn btn-primary">{editingCompanyId ? 'Save Changes' : 'Add Company'}</button></div>
    </form></div></div>}

    {deleteCompanyCandidate && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '440px' }} role="dialog" aria-modal="true" aria-labelledby="delete-company-title">
      <div className="modal-header"><h3 id="delete-company-title" className="modal-title">Delete company?</h3></div>
      <div className="modal-body">
        <p>This will permanently remove <strong>{deleteCompanyCandidate.name}</strong> and every record that belongs to it (products, customers, suppliers, invoices, purchase orders, expenses). This cannot be undone.</p>
        {deleteCompanyError && <p className="form-error mt-2">{deleteCompanyError}</p>}
      </div>
      <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setDeleteCompanyCandidate(null)}>Cancel</button><button className="btn btn-danger" onClick={confirmDeleteCompany}>Delete Company</button></div>
    </div></div>}
  </div>;
}
