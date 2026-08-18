'use client';

import { FormEvent, useState } from 'react';
import BackupsPanel from '@/components/BackupsPanel';
import { useCompany, type Company } from '@/components/CompanyProvider';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { inviteUser as sendInvite } from '@/lib/client-auth';

type SettingsTab = 'users' | 'company' | 'audit' | 'backups';
type UserAccount = { email: string; company_id: string; name: string; role: string; status: string };

const emptyCompanyForm = { name: '', gstin: '', invoice_prefix: 'INV', po_prefix: 'PO', address: '', contact_email: '', contact_phone: '' };

export default function SettingsClient() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('users');
  const { rows: users, loading: usersLoading, update: updateUser, reload: reloadUsers } = useCompanyTable<UserAccount>('users');
  const [feedback, setFeedback] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ name: '', email: '', role: 'salesman' });
  const [inviteError, setInviteError] = useState('');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState('salesman');
  const [roleError, setRoleError] = useState('');
  const [roleSubmitting, setRoleSubmitting] = useState(false);

  const { companies, addCompany, updateCompany, switchCompany, setStorefrontCompany, removeCompany } = useCompany();
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [companyForm, setCompanyForm] = useState(emptyCompanyForm);
  const [companyError, setCompanyError] = useState('');
  const [companySubmitting, setCompanySubmitting] = useState(false);
  const [companyListError, setCompanyListError] = useState('');
  const [deleteCompanyCandidate, setDeleteCompanyCandidate] = useState<Company | null>(null);
  const [deleteCompanyError, setDeleteCompanyError] = useState('');

  const inviteUser = async (event: FormEvent) => {
    event.preventDefault();
    setInviteError('');
    setInviteSubmitting(true);
    try {
      await sendInvite(invite.email, invite.name, invite.role);
      setInviteOpen(false);
      setFeedback(`Invite email sent to ${invite.email}.`);
      setInvite({ name: '', email: '', role: 'salesman' });
      await reloadUsers();
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : 'Could not send the invite.');
    } finally {
      setInviteSubmitting(false);
    }
  };

  const saveRole = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingEmail) return;
    setRoleError('');
    setRoleSubmitting(true);
    try {
      await updateUser(editingEmail, { role: editingRole });
      setFeedback('User role updated.');
      setEditingEmail(null);
    } catch (error) {
      setRoleError(error instanceof Error ? error.message : 'Could not update this role.');
    } finally {
      setRoleSubmitting(false);
    }
  };

  const openAddCompany = () => {
    setEditingCompanyId(null);
    setCompanyForm(emptyCompanyForm);
    setCompanyError('');
    setCompanyModalOpen(true);
  };

  const openEditCompany = (company: Company) => {
    setEditingCompanyId(company.id);
    setCompanyForm({ name: company.name, gstin: company.gstin, invoice_prefix: company.invoice_prefix, po_prefix: company.po_prefix, address: company.address, contact_email: company.contact_email || '', contact_phone: company.contact_phone || '' });
    setCompanyError('');
    setCompanyModalOpen(true);
  };

  const saveCompany = async (event: FormEvent) => {
    event.preventDefault();
    setCompanyError('');
    setCompanySubmitting(true);
    try {
      if (editingCompanyId) {
        await updateCompany(editingCompanyId, companyForm);
        setFeedback(`${companyForm.name} updated.`);
      } else {
        await addCompany(companyForm);
        setFeedback(`${companyForm.name} added with no data of its own yet. Click "Set Active" when you're ready to switch to it.`);
      }
      setCompanyModalOpen(false);
    } catch (error) {
      setCompanyError(error instanceof Error ? error.message : 'Could not save this company.');
    } finally {
      setCompanySubmitting(false);
    }
  };

  const handleSetActiveCompany = async (id: string) => {
    const target = companies.find((c) => c.id === id);
    setCompanyListError('');
    try {
      await switchCompany(id);
      setFeedback(`${target?.name ?? 'Company'} is now the active company.`);
    } catch (error) {
      setCompanyListError(error instanceof Error ? error.message : 'Could not switch the active company.');
    }
  };

  const handleSetStorefrontCompany = async (id: string) => {
    const target = companies.find((c) => c.id === id);
    setCompanyListError('');
    try {
      await setStorefrontCompany(id);
      setFeedback(`${target?.name ?? 'Company'}'s published listings now show on the public Website Catalog.`);
    } catch (error) {
      setCompanyListError(error instanceof Error ? error.message : 'Could not set the storefront company.');
    }
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
    {companyListError && <div className="alert alert-danger mb-4" role="alert">{companyListError}</div>}
    <div className="tabs mb-6"><button className={`tab ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>User Roles & Access ({users.length})</button><button className={`tab ${activeTab === 'company' ? 'active' : ''}`} onClick={() => setActiveTab('company')}>Companies ({companies.length})</button><button className={`tab ${activeTab === 'audit' ? 'active' : ''}`} onClick={() => setActiveTab('audit')}>Audit Logs</button><button className={`tab ${activeTab === 'backups' ? 'active' : ''}`} onClick={() => setActiveTab('backups')}>Data Backups</button></div>

    {activeTab === 'users' && <div className="card"><div className="card-header"><h3 className="card-title">User Accounts & Roles</h3><button className="btn btn-primary btn-sm" onClick={() => setInviteOpen(true)}>+ Invite User</button></div><div className="table-wrap"><table className="erp-table"><thead><tr><th>User Name</th><th>Email</th><th>Role</th><th>Status</th><th className="text-center">Permissions</th></tr></thead><tbody>{users.map((user) => <tr key={user.email}><td className="font-semibold">{user.name}</td><td className="text-muted">{user.email}</td><td><span className={`badge ${user.role === 'owner' ? 'badge-warning' : user.role === 'manager' ? 'badge-info' : 'badge-muted'}`}>{user.role.toUpperCase()}</span></td><td><span className={`badge ${user.status === 'active' ? 'badge-success' : 'badge-warning'}`}>{user.status.toUpperCase()}</span></td><td className="text-center"><button className="btn btn-ghost btn-sm" disabled={user.role === 'owner'} onClick={() => { setEditingEmail(user.email); setEditingRole(user.role); setRoleError(''); }}>Edit Role</button></td></tr>)}
      {users.length === 0 && (
        <tr><td colSpan={5}><div className="empty-state"><p className="empty-state-title">{usersLoading ? 'Loading users…' : 'No users yet'}</p><p className="empty-state-desc">{usersLoading ? 'Fetching accounts for the active company.' : 'Invite your first user to get started.'}</p></div></td></tr>
      )}
      </tbody></table></div></div>}

    {activeTab === 'company' && (
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Companies</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Manage the businesses run through this ERP. Only one company can be active at a time — switch anytime. Only one company&apos;s published listings can show on the public Website Catalog at a time, too — that&apos;s independent of which one is &quot;active,&quot; so switching companies to work on something else never changes what the public site shows.</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={openAddCompany}>+ Add Company</button>
        </div>
        <div className="table-wrap">
          <table className="erp-table">
            <thead><tr><th>Company</th><th>GSTIN</th><th>Invoice Prefix</th><th>PO Prefix</th><th>Status</th><th>Public Website Catalog</th><th className="text-center">Actions</th></tr></thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-secondary)' }}>{c.gstin || 'Not provided'}</td>
                  <td>{c.invoice_prefix}</td>
                  <td>{c.po_prefix}</td>
                  <td>{c.is_active ? <span className="badge badge-success">ACTIVE</span> : <span className="badge badge-muted">INACTIVE</span>}</td>
                  <td>
                    {c.is_storefront ? (
                      <span className="badge badge-success">LIVE ON /catalog</span>
                    ) : (
                      <button className="btn btn-ghost btn-sm" onClick={() => handleSetStorefrontCompany(c.id)}>Make Public</button>
                    )}
                  </td>
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

    {activeTab === 'audit' && <div className="card empty-state"><p className="empty-state-title">Audit logging isn&apos;t wired up yet</p><p className="empty-state-desc">User actions aren&apos;t being recorded to a log at this time, so there&apos;s nothing real to show here.</p></div>}

    {activeTab === 'backups' && <BackupsPanel />}

    {inviteOpen && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '480px' }} role="dialog" aria-modal="true" aria-labelledby="invite-title"><form onSubmit={inviteUser}><div className="modal-header"><h3 id="invite-title" className="modal-title">Invite User</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setInviteOpen(false)}>✕</button></div><div className="modal-body flex flex-col gap-4">{inviteError && <p className="form-error">{inviteError}</p>}<div className="form-group"><label className="form-label">Full Name</label><input required className="form-input" value={invite.name} onChange={(event) => setInvite({ ...invite, name: event.target.value })} /></div><div className="form-group"><label className="form-label">Email</label><input required type="email" className="form-input" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} /></div><div className="form-group"><label className="form-label">Role</label><select className="form-input form-select" value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value })}><option value="manager">Manager</option><option value="salesman">Salesperson</option><option value="accountant">Accountant</option><option value="warehouse">Warehouse</option></select></div></div><div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setInviteOpen(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={inviteSubmitting}>{inviteSubmitting ? 'Sending…' : 'Send Invite'}</button></div></form></div></div>}

    {editingEmail && <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '420px' }} role="dialog" aria-modal="true" aria-labelledby="role-title"><form onSubmit={saveRole}><div className="modal-header"><h3 id="role-title" className="modal-title">Edit User Role</h3></div><div className="modal-body flex flex-col gap-4">{roleError && <p className="form-error">{roleError}</p>}<div className="form-group"><label className="form-label">Role</label><select className="form-input form-select" value={editingRole} onChange={(event) => setEditingRole(event.target.value)}><option value="manager">Manager</option><option value="salesman">Salesperson</option><option value="accountant">Accountant</option><option value="warehouse">Warehouse</option></select></div></div><div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setEditingEmail(null)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={roleSubmitting}>{roleSubmitting ? 'Saving…' : 'Save Role'}</button></div></form></div></div>}

    {companyModalOpen && <div className="modal-overlay"><div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="company-modal-title"><form onSubmit={saveCompany}>
      <div className="modal-header"><h3 id="company-modal-title" className="modal-title">{editingCompanyId ? 'Edit Company' : 'Add New Company'}</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setCompanyModalOpen(false)}>✕</button></div>
      <div className="modal-body flex flex-col gap-4">
        {companyError && <p className="form-error">{companyError}</p>}
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
        <div className="form-grid-2">
          <div className="form-group"><label className="form-label">Quote Request Email</label><input type="email" className="form-input" placeholder="For the website's Request a Quote button" value={companyForm.contact_email} onChange={(event) => setCompanyForm({ ...companyForm, contact_email: event.target.value })} /></div>
          <div className="form-group"><label className="form-label">Quote Request Phone</label><input className="form-input" placeholder="Optional" value={companyForm.contact_phone} onChange={(event) => setCompanyForm({ ...companyForm, contact_phone: event.target.value })} /></div>
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '-8px' }}>Shown only on published Website Catalog listings, as a Request a Quote / Call button. Leave blank to hide it.</p>
      </div>
      <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setCompanyModalOpen(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={companySubmitting}>{companySubmitting ? 'Saving…' : editingCompanyId ? 'Save Changes' : 'Add Company'}</button></div>
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
