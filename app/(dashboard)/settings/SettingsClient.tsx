'use client';

import { FormEvent, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Edit,
  Globe,
  Lock,
  Plus,
  ScrollText,
  Trash2,
  UserPlus,
} from 'lucide-react';
import BackupsPanel from '@/components/BackupsPanel';
import { useCompany, type Company } from '@/components/CompanyProvider';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { inviteUser as sendInvite } from '@/lib/client-auth';
import { ROLE_LABELS, isRole } from '@/lib/authTypes';

type SettingsTab = 'users' | 'company' | 'audit' | 'backups';
type UserAccount = { email: string; company_id: string; name: string; role: string; status: string };

// Which people the table is showing. Purely a view filter over rows already loaded — it changes
// nothing about who has access, and adds no request.
type UserFilter = 'all' | 'active' | 'invited';

const emptyCompanyForm = { name: '', gstin: '', invoice_prefix: 'INV', po_prefix: 'PO', address: '', contact_email: '', contact_phone: '' };

// Categorical dot colours for the role chip — the dot only tells roles apart, it carries no
// status meaning, so green / amber / rose are deliberately absent here: on this screen those
// three are already spoken for by the Active / Invited / danger badges.
const ROLE_DOT: Record<string, string | undefined> = {
  owner: 'var(--chart-violet)',
  manager: 'var(--chart-blue)',
  salesman: 'var(--chart-teal)',
  accountant: 'var(--chart-pink)',
  warehouse: 'var(--ink-3)',
};

// Reuses the shared avatar chip at table scale. The owner keeps the class's amber fill; everyone
// else gets the neutral panel tone, so the one account that cannot be edited stands out.
const AVATAR_BASE = { width: '28px', height: '28px', minWidth: '28px', fontSize: '11px', borderRadius: 'var(--radius-md)' };
const AVATAR_STAFF = { ...AVATAR_BASE, background: 'var(--panel-2)', color: 'var(--ink-2)', border: '1px solid var(--line-2)' };

// Initials are derived from the name this page already loaded — a reading aid, never stored.
const initialsOf = (name: string, email: string) => {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length > 0) {
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (parts[0][0] + last).toUpperCase();
  }
  return (email || '?').charAt(0).toUpperCase();
};

// 'salesman' in the database, "Salesperson" on screen — one shared label list rather than a
// second copy that can drift. An unrecognised role is shown exactly as stored, not relabelled.
const roleLabel = (role: string) => (isRole(role) ? ROLE_LABELS[role] : role);
const sentenceCase = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : '');

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
  const [userFilter, setUserFilter] = useState<UserFilter>('all');

  const { companies, loading: companiesLoading, addCompany, updateCompany, switchCompany, setStorefrontCompany, removeCompany } = useCompany();
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

  // Every count below is taken from the rows this page already loaded. There is no "last active"
  // or "invited on" column here because the user record carries no such field — a gap is correct,
  // an invented timestamp would not be.
  const activeUsers = users.filter((user) => user.status === 'active');
  const invitedUsers = users.filter((user) => user.status === 'invited');
  const hasOwnerAccount = users.some((user) => user.role === 'owner');

  const userTabs: Array<{ key: UserFilter; label: string; title: string; rows: UserAccount[] }> = [
    { key: 'all', label: 'All', title: 'People with access', rows: users },
    { key: 'active', label: 'Active', title: 'People who can sign in now', rows: activeUsers },
    { key: 'invited', label: 'Invited', title: 'Invitations still waiting', rows: invitedUsers },
  ];
  const activeUserTab = userTabs.find((tab) => tab.key === userFilter) ?? userTabs[0];
  const visibleUsers = activeUserTab.rows;

  const peopleSentence = [
    `${activeUsers.length} ${activeUsers.length === 1 ? 'person' : 'people'} can sign in`,
    invitedUsers.length > 0 ? `${invitedUsers.length} ${invitedUsers.length === 1 ? 'invitation is' : 'invitations are'} waiting` : '',
    hasOwnerAccount ? 'the owner account cannot be edited or removed' : '',
  ].filter(Boolean).join(' · ');

  const activeCompanyRow = companies.find((c) => c.is_active);
  const storefrontCompanyRow = companies.find((c) => c.is_storefront);
  const companySentence = [
    `${companies.length} ${companies.length === 1 ? 'company' : 'companies'}`,
    activeCompanyRow ? `${activeCompanyRow.name} is active` : '',
    storefrontCompanyRow
      ? `${storefrontCompanyRow.name} is on the public Website Catalog`
      : 'no company is on the public Website Catalog',
  ].filter(Boolean).join(' · ');

  const companySummary = companies.length > 0
    ? ` · ${companies.length} ${companies.length === 1 ? 'company' : 'companies'}`
    : '';

  return <div>
    <div className="page-header">
      <div>
        <div className="eyebrow">Administration</div>
        <h1 className="page-title">System Settings &amp; Administration</h1>
        <p className="page-subtitle">Configure company details, role permissions, invoice formats and audit logs{companySummary}</p>
      </div>
    </div>

    {feedback && <div className="alert alert-success mb-4" role="status">{feedback}</div>}
    {companyListError && <div className="alert alert-danger mb-4" role="alert">{companyListError}</div>}

    <div className="flex items-center justify-between gap-4 mb-6" style={{ flexWrap: 'wrap' }}>
      <div className="tabs" role="group" aria-label="Settings section">
        <button type="button" aria-pressed={activeTab === 'users'} className={`tab ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
          Users &amp; Access<span className="tab-count">{users.length}</span>
        </button>
        <button type="button" aria-pressed={activeTab === 'company'} className={`tab ${activeTab === 'company' ? 'active' : ''}`} onClick={() => setActiveTab('company')}>
          Companies<span className="tab-count">{companies.length}</span>
        </button>
        <button type="button" aria-pressed={activeTab === 'backups'} className={`tab ${activeTab === 'backups' ? 'active' : ''}`} onClick={() => setActiveTab('backups')}>
          Data Backups
        </button>
        <button type="button" aria-pressed={activeTab === 'audit'} className={`tab ${activeTab === 'audit' ? 'active' : ''}`} onClick={() => setActiveTab('audit')}>
          Audit Logs
        </button>
      </div>
      {/* True of this whole route, not decoration: /settings is gated by requireOwner(). */}
      <span className="text-muted flex items-center gap-2" style={{ fontSize: '12px' }}>
        <Lock size={14} /> Only the owner can open these settings
      </span>
    </div>

    {activeTab === 'users' && (
      <div className="table-wrap">
        <div className="tbl-toolbar">
          <div className="tbl-toolbar-title">
            <strong>{activeUserTab.title}</strong>
            <small>Only the owner can invite someone or change a role</small>
          </div>

          <div className="tabs" role="group" aria-label="Filter people by status">
            {userTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                aria-pressed={userFilter === tab.key}
                className={`tab${userFilter === tab.key ? ' active' : ''}`}
                onClick={() => setUserFilter(tab.key)}
              >
                {tab.label}<span className="tab-count">{tab.rows.length}</span>
              </button>
            ))}
          </div>

          <div className="tbl-tools">
            <button className="btn btn-primary btn-sm" onClick={() => setInviteOpen(true)}>
              <UserPlus size={14} /> Invite User
            </button>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="erp-table">
            <thead>
              <tr>
                <th>User Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th className="text-right">Access</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((user) => {
                const isOwnerAccount = user.role === 'owner';
                return (
                  <tr key={user.email}>
                    <td>
                      <div className="flex items-center gap-3">
                        <span
                          className="profile-avatar"
                          aria-hidden="true"
                          style={isOwnerAccount ? AVATAR_BASE : AVATAR_STAFF}
                        >
                          {initialsOf(user.name, user.email)}
                        </span>
                        <span className="font-semibold">{user.name}</span>
                      </div>
                    </td>
                    <td className="text-muted">{user.email}</td>
                    <td>
                      <span
                        className="brand-chip"
                        style={{ '--brand-chip-color': ROLE_DOT[user.role] ?? 'var(--ink-3)' } as React.CSSProperties}
                      >
                        {roleLabel(user.role)}
                      </span>
                    </td>
                    <td>
                      {user.status === 'active' ? (
                        <span className="badge badge-success"><CheckCircle2 size={12} /> Active</span>
                      ) : user.status === 'invited' ? (
                        <span className="badge badge-warning"><Clock size={12} /> Invited</span>
                      ) : (
                        <span className="badge badge-muted">{sentenceCase(user.status) || '—'}</span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={isOwnerAccount}
                          title={isOwnerAccount ? 'The owner account cannot be edited or removed' : undefined}
                          onClick={() => { setEditingEmail(user.email); setEditingRole(user.role); setRoleError(''); }}
                        >
                          {isOwnerAccount ? <Lock size={14} /> : <Edit size={14} />} Edit Role
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visibleUsers.length === 0 && (
                /* Three genuinely different situations, told apart rather than flattened into one
                   message: still loading, nobody at all, or nobody under this particular filter. */
                <tr><td colSpan={5}><div className="empty-state">
                  <p className="empty-state-title">{usersLoading ? 'Loading users…' : users.length === 0 ? 'No users yet' : 'Nobody in this list'}</p>
                  <p className="empty-state-desc">{usersLoading ? 'Fetching accounts for the active company.' : users.length === 0 ? 'Invite your first user to get started.' : 'Everyone with access is on another tab — try All.'}</p>
                </div></td></tr>
              )}
            </tbody>
          </table>
        </div>

        {users.length > 0 && (
          <div className="pager">
            <div className="pager-info">{peopleSentence}</div>
          </div>
        )}
      </div>
    )}

    {activeTab === 'company' && (
      <div className="table-wrap">
        <div className="tbl-toolbar">
          <div className="tbl-toolbar-title">
            <strong>Companies</strong>
            <small>Separate books, stock and invoice numbering</small>
          </div>
          <div className="tbl-tools">
            <button className="btn btn-primary btn-sm" onClick={openAddCompany}>
              <Plus size={14} /> Add Company
            </button>
          </div>
        </div>

        <p className="text-muted" style={{ fontSize: '12px', lineHeight: 1.55, padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          Manage the businesses run through this ERP. Only one company can be active at a time — switch anytime. Only one company&apos;s published listings can show on the public Website Catalog at a time, too — that&apos;s independent of which one is &quot;active,&quot; so switching companies to work on something else never changes what the public site shows.
        </p>

        <div style={{ overflowX: 'auto' }}>
          <table className="erp-table">
            <thead><tr><th>Company</th><th>GSTIN</th><th>Invoice Prefix</th><th>PO Prefix</th><th>Status</th><th>Public Website Catalog</th><th className="text-right">Actions</th></tr></thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div style={{ minWidth: 0 }}>
                      <div className="font-semibold">{c.name}</div>
                      {/* Only shown when the company actually has an address on file. */}
                      {c.address && <div className="text-muted truncate" style={{ fontSize: '11.5px', maxWidth: '260px' }}>{c.address}</div>}
                    </div>
                  </td>
                  <td>{c.gstin ? <span className="pn-chip">{c.gstin}</span> : <span className="text-muted">Not provided</span>}</td>
                  <td>{c.invoice_prefix ? <span className="pn-chip">{c.invoice_prefix}</span> : <span className="text-muted">—</span>}</td>
                  <td>{c.po_prefix ? <span className="pn-chip">{c.po_prefix}</span> : <span className="text-muted">—</span>}</td>
                  <td>{c.is_active ? <span className="badge badge-success"><CheckCircle2 size={12} /> Active</span> : <span className="badge badge-muted">Inactive</span>}</td>
                  <td>
                    {c.is_storefront ? (
                      <span className="badge badge-success"><Globe size={12} /> Live on /catalog</span>
                    ) : (
                      <button className="btn btn-ghost btn-sm" onClick={() => handleSetStorefrontCompany(c.id)}><Globe size={14} /> Make Public</button>
                    )}
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-2">
                      {!c.is_active && <button className="btn btn-secondary btn-sm" onClick={() => handleSetActiveCompany(c.id)}>Set Active</button>}
                      <button className="btn btn-ghost btn-sm" onClick={() => openEditCompany(c)}><Edit size={14} /> Edit</button>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--color-danger)' }}
                        disabled={!!c.is_active || companies.length <= 1}
                        title={c.is_active ? 'Set another company active before deleting this one' : companies.length <= 1 ? 'At least one company must remain' : undefined}
                        onClick={() => { setDeleteCompanyError(''); setDeleteCompanyCandidate(c); }}
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {companies.length === 0 && (
                <tr><td colSpan={7}><div className="empty-state"><p className="empty-state-title">{companiesLoading ? 'Loading companies…' : 'No companies yet'}</p><p className="empty-state-desc">{companiesLoading ? 'Fetching the businesses set up on this ERP.' : 'Add a company to start keeping its books.'}</p></div></td></tr>
              )}
            </tbody>
          </table>
        </div>

        {companies.length > 0 && (
          <div className="pager">
            <div className="pager-info">{companySentence}</div>
          </div>
        )}
      </div>
    )}

    {activeTab === 'audit' && <div className="card empty-state"><ScrollText size={24} color="var(--ink-4)" /><p className="empty-state-title">Audit logging isn&apos;t wired up yet</p><p className="empty-state-desc">User actions aren&apos;t being recorded to a log at this time, so there&apos;s nothing real to show here.</p></div>}

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
