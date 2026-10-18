'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BookCheck, CalendarClock, Plus, Search, Trash2, XCircle } from 'lucide-react';
import { useCompany } from '@/components/CompanyProvider';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import {
  daysUntil,
  dueDate,
  leavesOf,
  nextLeaf,
  PURPOSE_LABEL,
  registerOrder,
  shortfalls,
  STATUS_LABEL,
  summarise,
  type ChequeBook,
  type ChequeDirection,
  type ChequeRow,
  type ChequeStatus,
} from '@/lib/cheques';

type Account = { id: string; name: string; kind: 'cash' | 'bank'; archived: boolean };
type Data = { cheques: ChequeRow[]; books: ChequeBook[]; accounts: Account[]; balances: Record<string, number>; today: string };
type Tab = 'out' | 'in' | 'books';
type Filter = 'open' | ChequeStatus | 'all';
type Dialog = { type: 'security'; direction: ChequeDirection } | { type: 'cancel-leaf' } | { type: 'book' } | { type: 'edit'; cheque: ChequeRow } | null;

const rupees = (value: number | string) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const STATUS_BADGE: Record<ChequeStatus, string> = { pending: 'badge-warning', cleared: 'badge-success', bounced: 'badge-danger', cancelled: 'badge-muted', returned: 'badge-info' };
const SOURCE_TEXT: Record<string, string> = { supplier_payments: 'Supplier payment', payments_received: 'Payment received', expenses: 'Expense', money_entries: 'Bill / purchase' };

/**
 * Cheques: every cheque given and received — what is still to clear and when, what bounced,
 * security cheques, and the leaves of each cheque book. lib/cheques.ts works out the figures;
 * lib/cheque-register.ts moves a cheque on (and undoes what a bounced one paid).
 */
export default function Cheques() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? '';
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<Tab>('out');
  const [filter, setFilter] = useState<Filter>('open');
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let active = true;
    void (async () => {
      try {
        const res = await fetch(`/api/cheques?companyId=${encodeURIComponent(companyId)}`);
        const body = (await parseJsonOrThrow(res, 'The cheque register could not be loaded.')) as Data;
        if (!active) return;
        setData(body);
        setError('');
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'The cheque register could not be loaded.');
      }
    })();
    return () => { active = false; };
  }, [companyId, reloadKey]);

  const act = async (body: Record<string, unknown>, done: string, fallback: string): Promise<boolean> => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/cheques', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId, ...body }) });
      const result = (await parseJsonOrThrow(res, fallback)) as { undone?: string | null };
      setMessage(result?.undone ? `${done} ${result.undone}` : done);
      setDialog(null);
      setReloadKey((key) => key + 1);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const today = data?.today ?? '';
  const banks = useMemo(() => (data?.accounts ?? []).filter((account) => account.kind === 'bank' && !account.archived), [data]);
  const accountName = (id: string | null) => data?.accounts.find((account) => account.id === id)?.name ?? '';
  const direction: ChequeDirection = tab === 'in' ? 'in' : 'out';
  const summary = data ? summarise(data.cheques, direction, today) : null;
  const shorts = data && tab === 'out' ? shortfalls(data.cheques, data.balances, today) : [];
  const rows = useMemo(() => {
    if (!data) return [];
    const term = search.trim().toLowerCase();
    return registerOrder(data.cheques.filter((cheque) => cheque.direction === direction))
      .filter((cheque) => filter === 'all' || (filter === 'open' ? cheque.status === 'pending' : cheque.status === filter))
      .filter((cheque) => !term || `${cheque.cheque_no ?? ''} ${cheque.party} ${cheque.source_id ?? ''} ${cheque.bank_name ?? ''} ${cheque.note ?? ''}`.toLowerCase().includes(term));
  }, [data, direction, filter, search]);

  const move = (cheque: ChequeRow, status: ChequeStatus) => {
    const what = `cheque ${cheque.cheque_no || '(no number)'} ${cheque.direction === 'out' ? 'to' : 'from'} ${cheque.party || 'someone'} for ${rupees(cheque.amount)}`;
    const pays = cheque.purpose === 'payment' && cheque.source_id && !cheque.reversed;
    const ask: Record<ChequeStatus, string> = {
      cleared: `Mark ${what} as cleared today?`,
      bounced: `Mark ${what} as bounced?${pays ? `\n\nThe payment it made (${cheque.source_id}) will be undone: the money will be owed again.` : ''}`,
      cancelled: `Stop / cancel ${what}?${pays ? `\n\nThe payment it made (${cheque.source_id}) will be undone: the money will be owed again.` : ''}`,
      returned: `Mark security ${what} as returned?`,
      pending: `Mark ${what} as not yet cleared again?`,
    };
    if (!window.confirm(ask[status])) return;
    void act({ action: 'status', id: cheque.id, status, date: today }, `Cheque ${STATUS_LABEL[status].toLowerCase()}.`, 'Could not update the cheque.');
  };

  if (!data && !error) return <div className="skeleton" style={{ height: 240, width: '100%' }} />;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Money</div>
          <h1 className="page-title">Cheques</h1>
          <p className="page-subtitle">Every cheque you have given and received — what is still to clear and when, what bounced, and your cheque books.</p>
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          {tab !== 'books' && (
            <button type="button" className="btn btn-secondary" onClick={() => setDialog({ type: 'security', direction })}><Plus size={15} /> Security cheque</button>
          )}
          {tab === 'out' && <button type="button" className="btn btn-secondary" onClick={() => setDialog({ type: 'cancel-leaf' })} disabled={banks.length === 0}><XCircle size={15} /> Cancel a spoiled leaf</button>}
          {tab === 'books' && <button type="button" className="btn btn-primary" onClick={() => setDialog({ type: 'book' })} disabled={banks.length === 0}><BookCheck size={15} /> Add cheque book</button>}
        </div>
      </div>

      {message && <div className="alert alert-success mb-4" role="status">{message}</div>}
      {error && <div className="alert alert-danger mb-4" role="alert">{error}</div>}
      {data && banks.length === 0 && (
        <div className="alert alert-info mb-4" role="status">Add your bank account on the Cash &amp; Bank page first — cheques you give are drawn on it.</div>
      )}

      <div className="tabs mb-4" role="group" aria-label="Cheques view">
        <button type="button" aria-pressed={tab === 'out'} className={`tab ${tab === 'out' ? 'active' : ''}`} onClick={() => setTab('out')}>Given<span className="tab-count">{data ? summarise(data.cheques, 'out', today).pendingCount : 0}</span></button>
        <button type="button" aria-pressed={tab === 'in'} className={`tab ${tab === 'in' ? 'active' : ''}`} onClick={() => setTab('in')}>Received<span className="tab-count">{data ? summarise(data.cheques, 'in', today).pendingCount : 0}</span></button>
        <button type="button" aria-pressed={tab === 'books'} className={`tab ${tab === 'books' ? 'active' : ''}`} onClick={() => setTab('books')}>Cheque books<span className="tab-count">{data?.books.length ?? 0}</span></button>
      </div>

      {data && tab !== 'books' && summary && (
        <>
          <div className="kpi-grid">
            <Stat title="Not yet cleared" value={rupees(summary.pendingTotal)} note={`${summary.pendingCount} cheque${summary.pendingCount === 1 ? '' : 's'}`} color="var(--chart-amber)" />
            <Stat title="Due this week" value={rupees(summary.dueSoonTotal)} note={`${summary.dueSoonCount} dated on or before ${shiftDay(today, 7)}`} color="var(--color-danger)" />
            <Stat title="Post-dated" value={rupees(summary.postDatedTotal)} note={`${summary.postDatedCount} dated later`} color="var(--chart-blue)" />
            <Stat title="Bounced" value={rupees(summary.bouncedTotal)} note={`${summary.bouncedCount} in all`} color="var(--chart-pink)" />
          </div>

          {shorts.map((short) => (
            <div key={short.accountId} className="alert alert-danger mb-4" role="alert">
              <AlertTriangle size={16} />
              <span>
                Cheques worth <strong>{rupees(short.due)}</strong> on <strong>{accountName(short.accountId)}</strong> fall due by {short.byDate}, but it holds {rupees(short.balance)} —
                <strong> short by {rupees(short.short)}</strong>. Put money in before they are presented, or a cheque may bounce.
              </span>
            </div>
          ))}

          <div className="card">
            <div className="card-header" style={{ flexWrap: 'wrap', gap: 10 }}>
              <div className="tabs" role="group" aria-label="Show">
                {(['open', 'cleared', 'bounced', 'cancelled', 'all'] as Filter[]).map((key) => (
                  <button key={key} type="button" aria-pressed={filter === key} className={`tab ${filter === key ? 'active' : ''}`} onClick={() => setFilter(key)}>
                    {key === 'open' ? 'Not yet cleared' : key === 'all' ? 'All' : STATUS_LABEL[key as ChequeStatus]}
                  </button>
                ))}
              </div>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }} />
                <input className="form-input" style={{ paddingLeft: 30, width: 230 }} placeholder="Number, name, payment…" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search cheques" />
              </div>
            </div>
            <div className="table-wrap">
              <table className="erp-table">
                <thead><tr><th>Cheque</th><th>Date on cheque</th><th>{direction === 'out' ? 'To' : 'From'}</th><th>For</th><th className="text-right">Amount</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={7} className="text-muted">{filter === 'open' ? `No cheque ${direction === 'out' ? 'given' : 'received'} is waiting to clear.` : 'Nothing here.'}</td></tr>}
                  {rows.map((cheque) => {
                    const due = dueDate(cheque);
                    const days = daysUntil(due, today);
                    return (
                      <tr key={cheque.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{cheque.cheque_no ? <span className="pn-chip">{cheque.cheque_no}</span> : <span className="text-muted">No number</span>}</div>
                          <div className="text-muted text-sm">{cheque.direction === 'out' ? accountName(cheque.account_id) : (cheque.bank_name || accountName(cheque.account_id))}</div>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {cheque.cheque_date ?? <span className="text-muted">—</span>}
                          {cheque.status === 'pending' && (
                            <div><span className={`badge ${days < 0 ? 'badge-danger' : days <= 7 ? 'badge-warning' : 'badge-info'}`}>
                              {days < 0 ? `${-days} day${days === -1 ? '' : 's'} ago` : days === 0 ? 'Today' : `In ${days} day${days === 1 ? '' : 's'}`}
                            </span></div>
                          )}
                          <div className="text-muted text-sm">{direction === 'out' ? 'Given' : 'Received'} {cheque.issued_on}</div>
                        </td>
                        <td>{cheque.party || <span className="text-muted">—</span>}</td>
                        <td>
                          {cheque.purpose === 'payment' ? (SOURCE_TEXT[cheque.source_table ?? ''] ?? 'Payment') : PURPOSE_LABEL[cheque.purpose]}
                          {cheque.source_id && <div className="text-muted text-sm">{cheque.source_id}</div>}
                          {cheque.note && <div className="text-muted text-sm">{cheque.note}</div>}
                        </td>
                        <td className="text-right font-semibold">{Number(cheque.amount) ? rupees(cheque.amount) : <span className="text-muted">—</span>}</td>
                        <td>
                          <span className={`badge ${STATUS_BADGE[cheque.status]}`}>{STATUS_LABEL[cheque.status]}</span>
                          {cheque.status_on && cheque.status !== 'pending' && <div className="text-muted text-sm">{cheque.status_on}</div>}
                          {cheque.reversed && <div className="text-danger text-sm">Payment undone</div>}
                        </td>
                        <td className="text-right" style={{ whiteSpace: 'nowrap' }}>
                          {cheque.status === 'pending' && cheque.purpose !== 'security' && (
                            <>
                              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => move(cheque, 'cleared')}>Cleared</button>{' '}
                              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => move(cheque, 'bounced')}>Bounced</button>{' '}
                              {cheque.direction === 'out' && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => move(cheque, 'cancelled')}>Stop</button>}
                            </>
                          )}
                          {cheque.status === 'pending' && cheque.purpose === 'security' && (
                            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => move(cheque, 'returned')}>Returned</button>
                          )}
                          {' '}<button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setDialog({ type: 'edit', cheque })}>Edit</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="pager"><span className="pager-info">
              {direction === 'out'
                ? 'A cheque you pay a supplier with is entered here by itself when you choose "Cheque" on Pay supplier, a purchase, or an expense. Bounced or stopped undoes that payment, so the money is owed again.'
                : 'A cheque a customer pays with is entered here by itself when you choose "Cheque" on Receive payment or at billing. Bounced undoes that payment, so the bills are owed again.'}
            </span></div>
          </div>
        </>
      )}

      {data && tab === 'books' && (
        data.books.length === 0 ? (
          <div className="card"><div className="empty-state">
            <div className="empty-state-icon"><BookCheck size={22} /></div>
            <p className="empty-state-title">No cheque book recorded</p>
            <p className="empty-state-desc">Add a book with its first and last leaf numbers. The ERP then fills in the next number when you pay by cheque, and shows which leaves are used or spoiled.</p>
          </div></div>
        ) : (
          data.books.map((book) => {
            const leaves = leavesOf(book, data.cheques);
            const used = leaves.filter((leaf) => leaf.cheque && leaf.cheque.status !== 'cancelled').length;
            const spoiled = leaves.filter((leaf) => leaf.cheque?.status === 'cancelled').length;
            const next = nextLeaf([book], data.cheques, book.account_id);
            return (
              <div key={book.id} className="card mb-4">
                <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <h3 className="card-title">{accountName(book.account_id)} — {book.first_no} to {book.last_no}</h3>
                    <p className="text-muted text-sm">Received {book.received_on} · {used} used · {spoiled} cancelled · {leaves.length - used - spoiled} left{next ? ` · next ${next}` : ' · book finished'}</p>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" aria-label="Remove this cheque book" disabled={busy}
                    onClick={() => { if (window.confirm('Remove this cheque book? Cheques written from it stay in the register.')) void act({ action: 'delete-book', id: book.id }, 'Cheque book removed.', 'Could not remove the book.'); }}>
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
                  {leaves.map((leaf) => (
                    <span key={leaf.no} title={leaf.cheque ? `${STATUS_LABEL[leaf.cheque.status]}${leaf.cheque.party ? ` · ${leaf.cheque.party}` : ''}${Number(leaf.cheque.amount) ? ` · ${rupees(leaf.cheque.amount)}` : ''}` : 'Unused'}
                      className={`badge ${leaf.cheque ? STATUS_BADGE[leaf.cheque.status] : ''}`}
                      style={!leaf.cheque ? { border: '1px dashed var(--line-2)', background: 'transparent', color: 'var(--ink-3)' } : undefined}>
                      {leaf.no.slice(-3)}
                    </span>
                  ))}
                </div>
              </div>
            );
          })
        )
      )}

      {dialog?.type === 'security' && (
        <SecurityDialog direction={dialog.direction} banks={banks} today={today} busy={busy} onClose={() => setDialog(null)}
          onSave={(body) => act({ action: 'add', direction: dialog.direction, ...body }, 'Security cheque entered.', 'Could not enter the cheque.')} />
      )}
      {dialog?.type === 'cancel-leaf' && data && (
        <LeafDialog banks={banks} suggest={(accountId) => nextLeaf(data.books, data.cheques, accountId) ?? ''} busy={busy} onClose={() => setDialog(null)}
          onSave={(body) => act({ action: 'cancel-leaf', ...body }, 'Leaf cancelled.', 'Could not cancel the leaf.')} />
      )}
      {dialog?.type === 'book' && (
        <BookDialog banks={banks} today={today} busy={busy} onClose={() => setDialog(null)}
          onSave={(body) => act({ action: 'add-book', ...body }, 'Cheque book added.', 'Could not add the book.')} />
      )}
      {dialog?.type === 'edit' && (
        <EditDialog cheque={dialog.cheque} busy={busy} onClose={() => setDialog(null)}
          onSave={(body) => act({ action: 'edit', id: dialog.cheque.id, ...body }, 'Cheque updated.', 'Could not update the cheque.')} />
      )}
    </div>
  );
}

function shiftDay(day: string, days: number): string {
  if (!day) return '';
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function Stat({ title, value, note, color }: { title: string; value: string; note: string; color: string }) {
  return (
    <div className="kpi-card" style={{ '--kpi-color': color, '--kpi-color-bg': 'var(--panel-2)' } as React.CSSProperties}>
      <div className="flex justify-between items-center"><span className="kpi-label">{title}</span><div className="kpi-icon-wrap"><CalendarClock size={18} /></div></div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-change text-muted" style={{ fontSize: 12 }}>{note}</div>
    </div>
  );
}

function Modal({ title, onClose, onSubmit, busy, children, submit = 'Save' }: { title: string; onClose: () => void; onSubmit: (event: FormEvent) => void; busy: boolean; children: React.ReactNode; submit?: string }) {
  return (
    <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: 460 }} role="dialog" aria-modal="true" aria-label={title}>
      <form onSubmit={onSubmit}>
        <div className="modal-header"><h3 className="modal-title">{title}</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="modal-body flex flex-col gap-4">{children}</div>
        <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : submit}</button></div>
      </form>
    </div></div>
  );
}

function SecurityDialog({ direction, banks, today, busy, onClose, onSave }: { direction: ChequeDirection; banks: Account[]; today: string; busy: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const [form, setForm] = useState({ accountId: banks[0]?.id ?? '', bankName: '', chequeNo: '', chequeDate: '', issuedOn: today, party: '', partyType: direction === 'out' ? 'supplier' : 'customer', amount: '', note: '' });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  return (
    <Modal title={direction === 'out' ? 'Security cheque given' : 'Security cheque taken'} busy={busy} onClose={onClose}
      onSubmit={(event) => { event.preventDefault(); onSave({ ...form, amount: Number(form.amount) || 0 }); }}>
      <p className="text-muted" style={{ fontSize: 13 }}>
        A cheque kept as a guarantee, not a payment — it does not change any balance. To pay by cheque, choose &quot;Cheque&quot; when you pay; it is entered here by itself.
      </p>
      <div className="form-group"><label className="form-label" htmlFor="sec-party">{direction === 'out' ? 'Given to' : 'Taken from'}</label>
        <input id="sec-party" className="form-input" required value={form.party} onChange={(event) => set({ party: event.target.value })} /></div>
      {direction === 'out' ? (
        <div className="form-group"><label className="form-label" htmlFor="sec-bank">Drawn on</label>
          <select id="sec-bank" className="form-input form-select" value={form.accountId} onChange={(event) => set({ accountId: event.target.value })}>
            {banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}
          </select></div>
      ) : (
        <div className="form-group"><label className="form-label" htmlFor="sec-bankname">Their bank</label>
          <input id="sec-bankname" className="form-input" value={form.bankName} onChange={(event) => set({ bankName: event.target.value })} /></div>
      )}
      <div className="form-grid-2">
        <div className="form-group"><label className="form-label" htmlFor="sec-no">Cheque number</label><input id="sec-no" className="form-input" value={form.chequeNo} onChange={(event) => set({ chequeNo: event.target.value })} /></div>
        <div className="form-group"><label className="form-label" htmlFor="sec-amount">Amount (₹, if written)</label><input id="sec-amount" type="number" min="0" step="0.01" className="form-input" value={form.amount} onChange={(event) => set({ amount: event.target.value })} /></div>
      </div>
      <div className="form-grid-2">
        <div className="form-group"><label className="form-label" htmlFor="sec-date">Date on cheque</label><input id="sec-date" type="date" className="form-input" value={form.chequeDate} onChange={(event) => set({ chequeDate: event.target.value })} /></div>
        <div className="form-group"><label className="form-label" htmlFor="sec-on">{direction === 'out' ? 'Given on' : 'Taken on'}</label><input id="sec-on" type="date" className="form-input" required value={form.issuedOn} onChange={(event) => set({ issuedOn: event.target.value })} /></div>
      </div>
      <div className="form-group"><label className="form-label" htmlFor="sec-note">Note</label><input id="sec-note" className="form-input" placeholder="e.g. against credit of ₹2 lakh" value={form.note} onChange={(event) => set({ note: event.target.value })} /></div>
    </Modal>
  );
}

function LeafDialog({ banks, suggest, busy, onClose, onSave }: { banks: Account[]; suggest: (accountId: string) => string; busy: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const [accountId, setAccountId] = useState(banks[0]?.id ?? '');
  const [chequeNo, setChequeNo] = useState(() => (banks[0] ? suggest(banks[0].id) : ''));
  const [note, setNote] = useState('');
  return (
    <Modal title="Cancel a spoiled leaf" submit="Cancel this leaf" busy={busy} onClose={onClose} onSubmit={(event) => { event.preventDefault(); onSave({ accountId, chequeNo, note }); }}>
      <p className="text-muted" style={{ fontSize: 13 }}>For a leaf written wrongly or torn — it is marked cancelled, so the next number moves on and the book shows why it was not used.</p>
      <div className="form-group"><label className="form-label" htmlFor="leaf-bank">Bank account</label>
        <select id="leaf-bank" className="form-input form-select" value={accountId} onChange={(event) => { setAccountId(event.target.value); setChequeNo(suggest(event.target.value)); }}>
          {banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}
        </select></div>
      <div className="form-group"><label className="form-label" htmlFor="leaf-no">Leaf number</label><input id="leaf-no" className="form-input" required value={chequeNo} onChange={(event) => setChequeNo(event.target.value)} /></div>
      <div className="form-group"><label className="form-label" htmlFor="leaf-note">Why</label><input id="leaf-note" className="form-input" placeholder="e.g. wrong amount written" value={note} onChange={(event) => setNote(event.target.value)} /></div>
    </Modal>
  );
}

function BookDialog({ banks, today, busy, onClose, onSave }: { banks: Account[]; today: string; busy: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const [form, setForm] = useState({ accountId: banks[0]?.id ?? '', firstNo: '', lastNo: '', receivedOn: today, note: '' });
  return (
    <Modal title="Add a cheque book" busy={busy} onClose={onClose} onSubmit={(event) => { event.preventDefault(); onSave(form); }}>
      <div className="form-group"><label className="form-label" htmlFor="book-bank">Bank account</label>
        <select id="book-bank" className="form-input form-select" value={form.accountId} onChange={(event) => setForm({ ...form, accountId: event.target.value })}>
          {banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}
        </select></div>
      <div className="form-grid-2">
        <div className="form-group"><label className="form-label" htmlFor="book-first">First leaf number</label><input id="book-first" className="form-input" required inputMode="numeric" placeholder="e.g. 000101" value={form.firstNo} onChange={(event) => setForm({ ...form, firstNo: event.target.value })} /></div>
        <div className="form-group"><label className="form-label" htmlFor="book-last">Last leaf number</label><input id="book-last" className="form-input" required inputMode="numeric" placeholder="e.g. 000125" value={form.lastNo} onChange={(event) => setForm({ ...form, lastNo: event.target.value })} /></div>
      </div>
      <div className="form-group"><label className="form-label" htmlFor="book-on">Received on</label><input id="book-on" type="date" className="form-input" value={form.receivedOn} onChange={(event) => setForm({ ...form, receivedOn: event.target.value })} /></div>
    </Modal>
  );
}

function EditDialog({ cheque, busy, onClose, onSave }: { cheque: ChequeRow; busy: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const [chequeNo, setChequeNo] = useState(cheque.cheque_no ?? '');
  const [chequeDate, setChequeDate] = useState(cheque.cheque_date ?? '');
  const [note, setNote] = useState(cheque.note ?? '');
  return (
    <Modal title={`Cheque ${cheque.direction === 'out' ? 'to' : 'from'} ${cheque.party || 'someone'}`} busy={busy} onClose={onClose}
      onSubmit={(event) => { event.preventDefault(); onSave({ chequeNo, chequeDate: chequeDate || null, note }); }}>
      <div className="form-grid-2">
        <div className="form-group"><label className="form-label" htmlFor="edit-no">Cheque number</label><input id="edit-no" className="form-input" value={chequeNo} onChange={(event) => setChequeNo(event.target.value)} /></div>
        <div className="form-group"><label className="form-label" htmlFor="edit-date">Date on cheque</label><input id="edit-date" type="date" className="form-input" value={chequeDate} onChange={(event) => setChequeDate(event.target.value)} /></div>
      </div>
      <div className="form-group"><label className="form-label" htmlFor="edit-note">Note</label><input id="edit-note" className="form-input" value={note} onChange={(event) => setNote(event.target.value)} /></div>
      <p className="text-muted" style={{ fontSize: 12 }}>The amount and who it is {cheque.direction === 'out' ? 'to' : 'from'} come from the payment it made, and are changed there.</p>
    </Modal>
  );
}
