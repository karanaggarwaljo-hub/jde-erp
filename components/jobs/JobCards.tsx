'use client';

import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronDown, ChevronRight, FileText, PackagePlus, Pencil, Plus, Receipt, RotateCcw, Wrench, XCircle } from 'lucide-react';
import { useCompanyTable } from '@/lib/useCompanyTable';
import { shopDay } from '@/lib/logbook';
import { tallyDate } from '@/lib/tally-invoice';
import {
  cleanJobInput,
  daysBetween,
  JOB_STATE_LABELS,
  jobBill,
  jobBillLink,
  jobState,
  sortJobs,
  type JobBill,
  type JobCard,
  type JobState,
} from '@/lib/job-cards';

type Invoice = JobBill & { customer: string; gst_mode?: string | null } & Record<string, unknown>;
type InvoiceItem = { invoice_id: string; name: string; part_number?: string | null; qty: number | string; line_total: number | string } & Record<string, unknown>;
type Tab = 'shop' | 'billed' | 'all';

const rupees = (value: number) => `₹${value.toLocaleString('en-IN', Number.isInteger(value) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATE_BADGE: Record<JobState, string> = { open: 'badge-warning', ready: 'badge-info', billed: 'badge-success', cancelled: 'badge-muted' };
const emptyForm = () => ({ customer: '', machine: '', machine_no: '', complaint: '', notes: '', opened_on: shopDay(new Date()) });

/**
 * Job Cards: machines in for repair. Each job keeps the machine and the complaint; the parts the
 * customer takes go on one draft bill (Sales), and when the machine is ready the draft becomes the
 * final bill and is paid in one go. lib/job-cards.ts holds the rules.
 */
export default function JobCards() {
  const { rows: jobs, loading, create, update } = useCompanyTable<JobCard & Record<string, unknown>>('job_cards');
  const { rows: invoices } = useCompanyTable<Invoice>('invoices');
  const { rows: invoiceItems } = useCompanyTable<InvoiceItem>('invoice_items');
  const { rows: customers } = useCompanyTable<{ id: string; name: string }>('customers');
  const [tab, setTab] = useState<Tab>('shop');
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<JobCard | 'new' | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');

  const today = shopDay(new Date());
  const bills = useMemo(() => new Map(invoices.map((invoice) => [invoice.id, invoice])), [invoices]);
  const rows = useMemo(() => sortJobs(jobs.map((job) => {
    const bill = jobBill(job, bills);
    const parts = bill ? invoiceItems.filter((item) => item.invoice_id === bill.id) : [];
    return { job, bill, parts, state: jobState(job, bill) };
  })), [jobs, bills, invoiceItems]);
  const inShop = rows.filter((row) => row.state === 'open' || row.state === 'ready');
  const shown = tab === 'shop' ? inShop : tab === 'billed' ? rows.filter((row) => row.state === 'billed') : rows;

  const startNew = () => { setForm(emptyForm()); setError(''); setEditing('new'); };
  const startEdit = (job: JobCard) => {
    setForm({ customer: job.customer, machine: job.machine, machine_no: job.machine_no, complaint: job.complaint, notes: job.notes, opened_on: job.opened_on });
    setError('');
    setEditing(job);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const cleaned = cleanJobInput(form);
    if (!cleaned.ok) { setError(cleaned.error); return; }
    setSaving(true);
    try {
      if (editing === 'new') {
        const created = await create(cleaned.row);
        setFeedback(`${String(created.job_no ?? 'Job card')} opened for ${cleaned.row.customer}. Use "Add parts" whenever they take something.`);
        setOpen(String(created.id ?? ''));
        setTab('shop');
      } else if (editing) {
        await update(editing.id, cleaned.row);
        setFeedback(`${editing.job_no} updated.`);
      }
      setEditing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the job card.');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (job: JobCard, status: JobCard['status']) => {
    try {
      await update(job.id, { status, ready_on: status === 'ready' ? today : null });
      setFeedback(status === 'ready' ? `${job.job_no} is ready — bill it when ${job.customer} comes to pay.` : status === 'cancelled' ? `${job.job_no} cancelled.` : `${job.job_no} is back in repair.`);
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : 'Could not change the job.');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Job Cards</h1>
          <p className="page-subtitle">Machines in for repair. Parts the customer takes during the job go on one bill, paid in one go when the machine is ready.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={startNew}><Plus size={16} /> New job card</button>
      </div>

      {feedback && <div className="alert alert-success mb-4" role="status"><CheckCircle2 size={16} /><span>{feedback}</span></div>}

      <div className="tabs mb-4" role="group" aria-label="Which jobs">
        <button type="button" aria-pressed={tab === 'shop'} className={`tab ${tab === 'shop' ? 'active' : ''}`} onClick={() => setTab('shop')}>In the shop<span className="tab-count">{inShop.length}</span></button>
        <button type="button" aria-pressed={tab === 'billed'} className={`tab ${tab === 'billed' ? 'active' : ''}`} onClick={() => setTab('billed')}>Billed<span className="tab-count">{rows.filter((row) => row.state === 'billed').length}</span></button>
        <button type="button" aria-pressed={tab === 'all'} className={`tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>All<span className="tab-count">{rows.length}</span></button>
      </div>

      {loading && <div className="skeleton" style={{ height: 160, width: '100%' }} />}

      {!loading && shown.length === 0 && (
        <div className="card"><div className="empty-state">
          <div className="empty-state-icon"><Wrench size={22} /></div>
          <p className="empty-state-title">{tab === 'shop' ? 'No machines in the shop' : 'No job cards here yet'}</p>
          <p className="empty-state-desc">When a machine comes in for repair, open a job card. Add the parts the customer takes day by day, then bill the whole job when they pay.</p>
          <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={startNew}><Plus size={14} /> New job card</button>
        </div></div>
      )}

      {!loading && shown.map(({ job, bill, parts, state }) => {
        const expanded = open === job.id;
        const partsValue = parts.reduce((sum, item) => sum + (Number(item.line_total) || 0), 0);
        const pieces = parts.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
        const days = daysBetween(job.opened_on, state === 'ready' && job.ready_on ? job.ready_on : today);
        const active = state === 'open' || state === 'ready';
        return (
          <div key={job.id} className="card mb-3">
            <div className="card-header" style={{ flexWrap: 'wrap', gap: 10, cursor: 'pointer' }} onClick={() => setOpen(expanded ? null : job.id)}>
              <div className="flex items-center gap-2" style={{ minWidth: 0, flex: '1 1 280px' }}>
                {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{job.job_no} · {job.customer}</div>
                  <div className="text-muted text-sm">
                    {[job.machine, job.machine_no].filter(Boolean).join(' · ') || 'Machine not noted'}
                    {' · '}in {tallyDate(job.opened_on)}{active ? ` (${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`})` : ''}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
                <span className="text-sm">{parts.length > 0 ? `${parts.length} part${parts.length === 1 ? '' : 's'} · ${rupees(state === 'billed' ? Number(bill?.total ?? 0) : partsValue)}` : <span className="text-muted">No parts yet</span>}</span>
                <span className={`badge ${STATE_BADGE[state]}`}>{JOB_STATE_LABELS[state]}</span>
              </div>
            </div>

            {expanded && (
              <div style={{ padding: '0 16px 16px' }}>
                {(job.complaint || job.notes) && (
                  <div className="text-sm mb-3">
                    {job.complaint && <div><span className="text-muted">Complaint: </span>{job.complaint}</div>}
                    {job.notes && <div><span className="text-muted">Notes: </span>{job.notes}</div>}
                  </div>
                )}

                {parts.length > 0 ? (
                  <div className="table-wrap mb-3">
                    <table className="erp-table">
                      <thead><tr><th>Part taken</th><th className="text-right">Qty</th><th className="text-right">Amount</th></tr></thead>
                      <tbody>
                        {parts.map((item, index) => (
                          <tr key={`${item.invoice_id}-${index}`}>
                            <td><div style={{ fontWeight: 600 }}>{item.name}</div>{item.part_number && <span className="pn-chip">{item.part_number}</span>}</td>
                            <td className="text-right">{Number(item.qty)}</td>
                            <td className="text-right">{rupees(Number(item.line_total) || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-sm text-muted" style={{ marginTop: 6 }}>{pieces} piece{pieces === 1 ? '' : 's'}, {rupees(partsValue)}{(bill as Invoice | null)?.gst_mode === 'inclusive' ? ' (GST included)' : ' before GST'}{state !== 'billed' ? '. Nothing is billed until you press "Bill & take payment".' : '.'}</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted mb-3">No parts on this job yet. Press &quot;Add parts&quot; when the customer takes something — they go on one draft bill for this job.</p>
                )}

                <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                  {active && <Link className="btn btn-secondary btn-sm" href={jobBillLink(job, 'parts')}><PackagePlus size={14} /> Add parts</Link>}
                  {active && <Link className="btn btn-primary btn-sm" href={jobBillLink(job, 'bill')}><Receipt size={14} /> Bill &amp; take payment</Link>}
                  {state === 'open' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStatus(job, 'ready')}><CheckCircle2 size={14} /> Repair done</button>}
                  {state === 'ready' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStatus(job, 'open')}><RotateCcw size={14} /> Back in repair</button>}
                  {state === 'billed' && bill && <Link className="btn btn-secondary btn-sm" href={`/sales/invoice/${encodeURIComponent(bill.id)}`}><FileText size={14} /> View bill {bill.id}</Link>}
                  {state !== 'cancelled' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => startEdit(job)}><Pencil size={14} /> Edit details</button>}
                  {active && (
                    parts.length === 0
                      ? <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)' }} onClick={() => { if (window.confirm(`Cancel ${job.job_no}?`)) void setStatus(job, 'cancelled'); }}><XCircle size={14} /> Cancel job</button>
                      : <span className="text-muted text-sm" style={{ alignSelf: 'center' }}>To cancel, first delete its draft bill {bill?.id} in Sales.</span>
                  )}
                  {state === 'cancelled' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStatus(job, 'open')}><RotateCcw size={14} /> Reopen</button>}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {editing && (
        <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: 520 }} role="dialog" aria-modal="true" aria-labelledby="job-form-title">
          <form onSubmit={save}>
            <div className="modal-header">
              <h3 id="job-form-title" className="modal-title">{editing === 'new' ? 'New job card' : `Edit ${editing.job_no}`}</h3>
              <button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setEditing(null)}>✕</button>
            </div>
            <div className="modal-body flex flex-col gap-3">
              {error && <div className="alert alert-danger" role="alert">{error}</div>}
              <div className="form-group">
                <label className="form-label" htmlFor="job-customer">Customer *</label>
                <input id="job-customer" className="form-input" list="job-customers" required autoFocus placeholder="Choose or type a name"
                  value={form.customer} onChange={(event) => setForm({ ...form, customer: event.target.value })} disabled={editing !== 'new' && Boolean(editing.invoice_id)} />
                <datalist id="job-customers">{customers.map((customer) => <option key={customer.id} value={customer.name} />)}</datalist>
                {editing !== 'new' && editing.invoice_id && <span className="text-muted text-sm">The customer is fixed once parts are on the job&apos;s bill.</span>}
              </div>
              <div className="form-grid-2">
                <div className="form-group"><label className="form-label" htmlFor="job-machine">Machine</label><input id="job-machine" className="form-input" placeholder="e.g. JCB 3DX" maxLength={120} value={form.machine} onChange={(event) => setForm({ ...form, machine: event.target.value })} /></div>
                <div className="form-group"><label className="form-label" htmlFor="job-machine-no">Machine / vehicle no.</label><input id="job-machine-no" className="form-input" placeholder="e.g. PB65 AB 1234" maxLength={60} value={form.machine_no} onChange={(event) => setForm({ ...form, machine_no: event.target.value })} /></div>
              </div>
              <div className="form-group"><label className="form-label" htmlFor="job-complaint">Complaint / work to do</label><textarea id="job-complaint" className="form-input" rows={2} maxLength={500} placeholder="e.g. Hydraulic leak, bucket pin worn" value={form.complaint} onChange={(event) => setForm({ ...form, complaint: event.target.value })} /></div>
              <div className="form-grid-2">
                <div className="form-group"><label className="form-label" htmlFor="job-date">Came in on</label><input id="job-date" type="date" className="form-input" value={form.opened_on} onChange={(event) => setForm({ ...form, opened_on: event.target.value })} /></div>
              </div>
              <div className="form-group"><label className="form-label" htmlFor="job-notes">Notes</label><textarea id="job-notes" className="form-input" rows={2} maxLength={1000} placeholder="Optional" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : editing === 'new' ? 'Open job card' : 'Save'}</button>
            </div>
          </form>
        </div></div>
      )}
    </div>
  );
}
