'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, BookCheck, CalendarDays, Check, List, MoreHorizontal, Plus, Search, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { useCompany } from '@/components/CompanyProvider';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import { useCompanyTable } from '@/lib/useCompanyTable';
import ChequeCalendar from '@/components/money/ChequeCalendar';
import type { CollectionDay } from '@/lib/cheque-plan';
import {
  daysUntil,
  dueDate,
  leavesOf,
  nextLeaf,
  registerOrder,
  STATUS_LABEL,
  type ChequeBook,
  type ChequeDirection,
  type ChequeRow,
  type ChequeStatus,
} from '@/lib/cheques';

type Bank = { id: string; name: string };
type Data = { cheques: ChequeRow[]; books: ChequeBook[]; banks: Bank[]; collections: CollectionDay[]; today: string };
/** A bank picked from the company's banks, or named new (which adds it). */
type BankChoice = { accountId: string; newBank: string };
type View = 'upcoming' | 'calendar' | 'past';
type Side = 'all' | ChequeDirection;
type Dialog = { type: 'security'; direction: ChequeDirection } | { type: 'cancel-leaf' } | { type: 'book' } | { type: 'books' } | { type: 'edit'; cheque: ChequeRow } | null;

const rupees = (value: number | string) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const STATUS_BADGE: Record<ChequeStatus, string> = { pending: 'badge-warning', cleared: 'badge-success', bounced: 'badge-danger', cancelled: 'badge-muted', returned: 'badge-info' };
const shortDate = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const isMoney = (cheque: ChequeRow) => cheque.purpose !== 'security';

/**
 * Cheques, kept simple: the cheques still to clear in one list, soonest first, each with one
 * button for what usually happens next (Cleared, or Returned for a security cheque); a calendar;
 * and the past. Bounced, Stop and Edit sit in each row's menu; cheque books, spoiled leaves and
 * security cheques in the page's More menu. lib/cheques.ts works out the figures;
 * lib/cheque-register.ts moves a cheque on (and undoes what a bounced one paid).
 */
export default function Cheques() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? '';
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [view, setView] = useState<View>('upcoming');
  const [side, setSide] = useState<Side>('all');
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { rows: suppliers } = useCompanyTable<{ id: string; name: string }>('suppliers');

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

  // A menu closes when anything outside it is clicked.
  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => { if (!(event.target as HTMLElement).closest('[data-menu]')) setMenu(null); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menu]);

  const act = async (body: Record<string, unknown>, done: string, fallback: string): Promise<boolean> => {
    setBusy(true);
    setError('');
    setMenu(null);
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
  const banks = useMemo(() => data?.banks ?? [], [data]);
  const bankName = (id: string | null) => banks.find((bank) => bank.id === id)?.name ?? '';
  // Who a planned cheque can be for: suppliers, and anyone you have given a cheque to.
  const parties = useMemo(() => [...new Set([...suppliers.map((row) => row.name), ...(data?.cheques ?? []).filter((cheque) => cheque.direction === 'out').map((cheque) => cheque.party)].map((name) => (name ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [suppliers, data]);

  const pending = useMemo(() => (data?.cheques ?? []).filter((cheque) => cheque.status === 'pending'), [data]);
  const toPay = pending.filter((cheque) => cheque.direction === 'out' && isMoney(cheque));
  const toReceive = pending.filter((cheque) => cheque.direction === 'in' && isMoney(cheque));
  const sum = (rows: ChequeRow[]) => rows.reduce((total, cheque) => total + (Number(cheque.amount) || 0), 0);
  const nextOf = (rows: ChequeRow[]) => rows.map(dueDate).sort()[0];

  const rows = useMemo(() => {
    if (!data) return [];
    const term = search.trim().toLowerCase();
    const wanted = data.cheques
      .filter((cheque) => (view === 'past' ? cheque.status !== 'pending' : cheque.status === 'pending'))
      // A spoiled leaf is not a cheque; it shows in its cheque book.
      .filter((cheque) => !(cheque.status === 'cancelled' && !Number(cheque.amount) && !cheque.party))
      .filter((cheque) => side === 'all' || cheque.direction === side)
      .filter((cheque) => !term || `${cheque.cheque_no ?? ''} ${cheque.party} ${cheque.source_id ?? ''} ${cheque.bank_name ?? ''} ${cheque.note ?? ''} ${cheque.amount}`.toLowerCase().includes(term));
    return registerOrder(wanted);
  }, [data, view, side, search]);

  const move = (cheque: ChequeRow, status: ChequeStatus) => {
    const what = `cheque ${cheque.cheque_no || '(no number)'} ${cheque.direction === 'out' ? 'to' : 'from'} ${cheque.party || 'someone'} for ${rupees(cheque.amount)}`;
    const pays = cheque.purpose === 'payment' && cheque.source_id && !cheque.reversed;
    const undo = pays ? `\n\nThe payment it made (${cheque.source_id}) will be undone, so the money is owed again.` : '';
    const ask: Record<ChequeStatus, string> = {
      cleared: `Mark ${what} as cleared?`,
      bounced: `Mark ${what} as bounced?${undo}`,
      cancelled: `Stop ${what}?${undo}`,
      returned: `Mark security ${what} as returned?`,
      pending: `Mark ${what} as not yet cleared again?`,
    };
    setMenu(null);
    if (!window.confirm(ask[status])) return;
    void act({ action: 'status', id: cheque.id, status, date: today }, `Cheque ${STATUS_LABEL[status].toLowerCase()}.`, 'Could not update the cheque.');
  };

  if (!data && !error) return <div className="skeleton" style={{ height: 240, width: '100%' }} />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Cheques</h1>
          <p className="page-subtitle">Cheques you have given and received, and when each one is due.</p>
        </div>
        <div style={{ position: 'relative' }} data-menu>
          <button type="button" className="btn btn-secondary" aria-haspopup="menu" aria-expanded={menu === 'page'} onClick={() => setMenu(menu === 'page' ? null : 'page')}>
            <MoreHorizontal size={15} /> More
          </button>
          {menu === 'page' && (
            <MenuList align="right">
              <MenuItem icon={<BookCheck size={14} />} onClick={() => { setMenu(null); setDialog({ type: 'books' }); }}>Cheque books{data?.books.length ? ` (${data.books.length})` : ''}</MenuItem>
              <MenuItem icon={<XCircle size={14} />} disabled={banks.length === 0} onClick={() => { setMenu(null); setDialog({ type: 'cancel-leaf' }); }}>Cancel a spoiled leaf</MenuItem>
              <MenuItem icon={<ShieldCheck size={14} />} onClick={() => { setMenu(null); setDialog({ type: 'security', direction: 'out' }); }}>Security cheque given</MenuItem>
              <MenuItem icon={<ShieldCheck size={14} />} onClick={() => { setMenu(null); setDialog({ type: 'security', direction: 'in' }); }}>Security cheque taken</MenuItem>
            </MenuList>
          )}
        </div>
      </div>

      {message && <div className="alert alert-success mb-4" role="status">{message}</div>}
      {error && <div className="alert alert-danger mb-4" role="alert">{error}</div>}

      {data && (
        <div className="form-grid-2 mb-4">
          <Total icon={<ArrowUpRight size={18} />} color="var(--color-danger)" title="You have to pay" amount={sum(toPay)} count={toPay.length} next={nextOf(toPay)} today={today}
            onClick={() => { setView('upcoming'); setSide('out'); }} />
          <Total icon={<ArrowDownLeft size={18} />} color="var(--color-success)" title="You will receive" amount={sum(toReceive)} count={toReceive.length} next={nextOf(toReceive)} today={today}
            onClick={() => { setView('upcoming'); setSide('in'); }} />
        </div>
      )}

      <div className="flex gap-2 mb-4" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="tabs" role="group" aria-label="Show">
          <button type="button" aria-pressed={view === 'upcoming'} className={`tab ${view === 'upcoming' ? 'active' : ''}`} onClick={() => setView('upcoming')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><List size={14} />Upcoming<span className="tab-count">{pending.length}</span></span>
          </button>
          <button type="button" aria-pressed={view === 'calendar'} className={`tab ${view === 'calendar' ? 'active' : ''}`} onClick={() => setView('calendar')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><CalendarDays size={14} />Calendar</span>
          </button>
          <button type="button" aria-pressed={view === 'past'} className={`tab ${view === 'past' ? 'active' : ''}`} onClick={() => setView('past')}>Past</button>
        </div>
        {view !== 'calendar' && (
          <>
            <div className="tabs" role="group" aria-label="Which cheques">
              {(['all', 'out', 'in'] as Side[]).map((key) => (
                <button key={key} type="button" aria-pressed={side === key} className={`tab ${side === key ? 'active' : ''}`} onClick={() => setSide(key)}>
                  {key === 'all' ? 'All' : key === 'out' ? 'Given' : 'Received'}
                </button>
              ))}
            </div>
            <div style={{ position: 'relative', marginLeft: 'auto' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }} />
              <input className="form-input" style={{ paddingLeft: 30, width: 210 }} placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search cheques" />
            </div>
          </>
        )}
      </div>

      {data && view === 'calendar' && (
        <ChequeCalendar cheques={data.cheques} collections={data.collections ?? []} today={today} parties={parties} />
      )}

      {data && view !== 'calendar' && (
        <div className="card" style={{ padding: 0 }}>
          {rows.length === 0 && (
            <div className="empty-state">
              <p className="empty-state-title">{view === 'upcoming' ? 'No cheque is waiting to clear' : 'Nothing here yet'}</p>
              {view === 'upcoming' && <p className="empty-state-desc">Tick &ldquo;Paid by cheque&rdquo; when you pay a supplier, or &ldquo;Received by cheque&rdquo; when a customer pays, and the cheque shows up here.</p>}
            </div>
          )}
          {rows.map((cheque) => {
            const due = dueDate(cheque);
            const days = daysUntil(due, today);
            const out = cheque.direction === 'out';
            const bank = out ? bankName(cheque.account_id) : (cheque.bank_name || '');
            return (
              <div key={cheque.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
                <div style={{ width: 74, flexShrink: 0 }}>
                  <div style={{ fontWeight: 700 }}>{shortDate(due)}</div>
                  {cheque.status === 'pending'
                    ? <div className={`text-sm ${days < 0 ? 'text-danger' : days <= 3 ? 'text-warning' : 'text-muted'}`}>{days < 0 ? `${-days}d late` : days === 0 ? 'Today' : `in ${days}d`}</div>
                    : <span className={`badge ${STATUS_BADGE[cheque.status]}`} style={{ fontSize: 11 }}>{STATUS_LABEL[cheque.status]}</span>}
                </div>
                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: out ? 'var(--color-danger)' : 'var(--color-success)', display: 'inline-flex' }}>{out ? <ArrowUpRight size={15} /> : <ArrowDownLeft size={15} />}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{out ? 'To' : 'From'} {cheque.party || 'someone'}</span>
                  </div>
                  <div className="text-muted text-sm">
                    {[cheque.cheque_no ? `No. ${cheque.cheque_no}` : 'No number', bank, cheque.purpose === 'security' ? 'Security cheque' : cheque.source_id, cheque.reversed ? 'payment undone' : null].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {/* A security cheque moves no money: its amount is shown plainly, without + or −. */}
                <div style={{ fontWeight: 700, fontSize: 16, color: !isMoney(cheque) ? 'var(--ink-3)' : out ? 'var(--color-danger)' : 'var(--color-success)', whiteSpace: 'nowrap' }}>
                  {Number(cheque.amount) ? `${isMoney(cheque) ? (out ? '−' : '+') : ''}${rupees(cheque.amount)}` : <span className="text-muted">—</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
                  {cheque.status === 'pending' && (cheque.purpose === 'security'
                    ? <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => move(cheque, 'returned')}>Returned</button>
                    : <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => move(cheque, 'cleared')}><Check size={14} /> Cleared</button>)}
                  <div style={{ position: 'relative' }} data-menu>
                    <button type="button" className="btn btn-ghost btn-sm" aria-label="More for this cheque" aria-haspopup="menu" aria-expanded={menu === cheque.id} onClick={() => setMenu(menu === cheque.id ? null : cheque.id)}>
                      <MoreHorizontal size={16} />
                    </button>
                    {menu === cheque.id && (
                      <MenuList align="right">
                        {cheque.status === 'pending' && cheque.purpose !== 'security' && <MenuItem onClick={() => move(cheque, 'bounced')}>Bounced</MenuItem>}
                        {cheque.status === 'pending' && out && cheque.purpose !== 'security' && <MenuItem onClick={() => move(cheque, 'cancelled')}>Stop payment</MenuItem>}
                        {cheque.status === 'cleared' && <MenuItem onClick={() => move(cheque, 'pending')}>Not cleared after all</MenuItem>}
                        <MenuItem onClick={() => { setMenu(null); setDialog({ type: 'edit', cheque }); }}>Edit number, date or note</MenuItem>
                      </MenuList>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dialog?.type === 'books' && data && (
        <BooksDialog books={data.books} cheques={data.cheques} bankName={bankName} busy={busy} onClose={() => setDialog(null)}
          onAdd={() => setDialog({ type: 'book' })}
          onDelete={(book) => { if (window.confirm('Remove this cheque book? Cheques written from it stay in the register.')) void act({ action: 'delete-book', id: book.id }, 'Cheque book removed.', 'Could not remove the book.'); }} />
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

function Total({ icon, color, title, amount, count, next, today, onClick }: { icon: React.ReactNode; color: string; title: string; amount: number; count: number; next?: string; today: string; onClick: () => void }) {
  const days = next ? daysUntil(next, today) : null;
  return (
    <button type="button" className="card" onClick={onClick} style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, font: 'inherit', color: 'inherit' }}>
      <span style={{ color, background: 'var(--panel-2)', borderRadius: 10, padding: 10, display: 'inline-flex' }}>{icon}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="text-muted text-sm">{title}</span>
        <span style={{ fontSize: 24, fontWeight: 700, color }}>{rupees(amount)}</span>
        <span className="text-muted text-sm">
          {count === 0 ? 'No cheques waiting' : `${count} cheque${count === 1 ? '' : 's'}`}
          {next && days !== null && <> · next {days < 0 ? <strong className="text-danger">{-days} day{days === -1 ? '' : 's'} late</strong> : days === 0 ? <strong>today</strong> : `on ${shortDate(next)}`}</>}
        </span>
      </span>
    </button>
  );
}

function MenuList({ children, align }: { children: React.ReactNode; align: 'left' | 'right' }) {
  return (
    <div role="menu" style={{ position: 'absolute', top: '100%', [align]: 0, marginTop: 4, zIndex: 30, minWidth: 210, background: 'var(--bg-card)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: 'var(--shadow-md)', padding: 4 }}>
      {children}
    </div>
  );
}

function MenuItem({ children, onClick, icon, disabled = false }: { children: React.ReactNode; onClick: () => void; icon?: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick} className="btn btn-ghost btn-sm"
      style={{ width: '100%', justifyContent: 'flex-start', gap: 8, display: 'flex', alignItems: 'center', opacity: disabled ? 0.5 : 1 }}>
      {icon}{children}
    </button>
  );
}

function BooksDialog({ books, cheques, bankName, busy, onClose, onAdd, onDelete }: { books: ChequeBook[]; cheques: ChequeRow[]; bankName: (id: string | null) => string; busy: boolean; onClose: () => void; onAdd: () => void; onDelete: (book: ChequeBook) => void }) {
  return (
    <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-label="Cheque books">
      <div className="modal-header"><h3 className="modal-title">Cheque books</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={onClose}>✕</button></div>
      <div className="modal-body flex flex-col gap-4">
        {books.length === 0 && (
          <p className="text-muted" style={{ fontSize: 13 }}>Add your cheque book with its bank and its first and last leaf numbers. Then, when you pay by cheque, the bank and the next number are filled in for you.</p>
        )}
        {books.map((book) => {
          const leaves = leavesOf(book, cheques);
          const used = leaves.filter((leaf) => leaf.cheque && leaf.cheque.status !== 'cancelled').length;
          const spoiled = leaves.filter((leaf) => leaf.cheque?.status === 'cancelled').length;
          const next = nextLeaf([book], cheques, book.account_id);
          return (
            <div key={book.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 12 }}>
              <div className="flex justify-between items-center" style={{ gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{bankName(book.account_id) || 'Bank'} · {book.first_no} to {book.last_no}</div>
                  <div className="text-muted text-sm">{leaves.length - used - spoiled} left{next ? `, next ${next}` : ', book finished'} · {used} used{spoiled ? ` · ${spoiled} cancelled` : ''}</div>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" aria-label="Remove this cheque book" disabled={busy} onClick={() => onDelete(book)}><Trash2 size={14} /></button>
              </div>
              <div className="flex gap-1" style={{ flexWrap: 'wrap', marginTop: 8 }}>
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
        })}
      </div>
      <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={onClose}>Close</button><button type="button" className="btn btn-primary" onClick={onAdd}><Plus size={14} /> Add cheque book</button></div>
    </div></div>
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

function BankField({ id, label, banks, value, onChange }: { id: string; label: string; banks: Bank[]; value: BankChoice; onChange: (value: BankChoice) => void }) {
  const naming = banks.length === 0 || !value.accountId;
  return (
    <div className="form-group"><label className="form-label" htmlFor={id}>{label}</label>
      {banks.length > 0 && (
        <select id={id} className="form-input form-select" value={value.accountId} onChange={(event) => onChange({ accountId: event.target.value, newBank: '' })}>
          {banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}
          <option value="">Another bank…</option>
        </select>
      )}
      {naming && (
        <input id={banks.length === 0 ? id : undefined} aria-label={banks.length === 0 ? undefined : 'Name of the other bank'} className="form-input" required
          style={banks.length > 0 ? { marginTop: 6 } : undefined} placeholder="e.g. HDFC Bank, Sector 17" value={value.newBank}
          onChange={(event) => onChange({ accountId: '', newBank: event.target.value })} />
      )}
    </div>
  );
}

function SecurityDialog({ direction, banks, today, busy, onClose, onSave }: { direction: ChequeDirection; banks: Bank[]; today: string; busy: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const [form, setForm] = useState({ accountId: banks[0]?.id ?? '', newBank: '', bankName: '', chequeNo: '', chequeDate: '', issuedOn: today, party: '', partyType: direction === 'out' ? 'supplier' : 'customer', amount: '', note: '' });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  return (
    <Modal title={direction === 'out' ? 'Security cheque given' : 'Security cheque taken'} busy={busy} onClose={onClose}
      onSubmit={(event) => { event.preventDefault(); onSave({ ...form, amount: Number(form.amount) || 0 }); }}>
      <p className="text-muted" style={{ fontSize: 13 }}>
        A cheque kept as a guarantee, not a payment — it pays nothing. To pay by cheque, choose &quot;Cheque&quot; when you pay; it is entered here by itself.
      </p>
      <div className="form-group"><label className="form-label" htmlFor="sec-party">{direction === 'out' ? 'Given to' : 'Taken from'}</label>
        <input id="sec-party" className="form-input" required value={form.party} onChange={(event) => set({ party: event.target.value })} /></div>
      {direction === 'out' ? (
        <BankField id="sec-bank" label="Drawn on" banks={banks} value={form} onChange={(bank) => set(bank)} />
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

function LeafDialog({ banks, suggest, busy, onClose, onSave }: { banks: Bank[]; suggest: (accountId: string) => string; busy: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const [accountId, setAccountId] = useState(banks[0]?.id ?? '');
  const [chequeNo, setChequeNo] = useState(() => (banks[0] ? suggest(banks[0].id) : ''));
  const [note, setNote] = useState('');
  return (
    <Modal title="Cancel a spoiled leaf" submit="Cancel this leaf" busy={busy} onClose={onClose} onSubmit={(event) => { event.preventDefault(); onSave({ accountId, chequeNo, note }); }}>
      <p className="text-muted" style={{ fontSize: 13 }}>For a leaf written wrongly or torn — it is marked cancelled, so the next number moves on and the book shows why it was not used.</p>
      <div className="form-group"><label className="form-label" htmlFor="leaf-bank">Bank</label>
        <select id="leaf-bank" className="form-input form-select" value={accountId} onChange={(event) => { setAccountId(event.target.value); setChequeNo(suggest(event.target.value)); }}>
          {banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}
        </select></div>
      <div className="form-group"><label className="form-label" htmlFor="leaf-no">Leaf number</label><input id="leaf-no" className="form-input" required value={chequeNo} onChange={(event) => setChequeNo(event.target.value)} /></div>
      <div className="form-group"><label className="form-label" htmlFor="leaf-note">Why</label><input id="leaf-note" className="form-input" placeholder="e.g. wrong amount written" value={note} onChange={(event) => setNote(event.target.value)} /></div>
    </Modal>
  );
}

function BookDialog({ banks, today, busy, onClose, onSave }: { banks: Bank[]; today: string; busy: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const [form, setForm] = useState({ accountId: banks[0]?.id ?? '', newBank: '', firstNo: '', lastNo: '', receivedOn: today, note: '' });
  return (
    <Modal title="Add a cheque book" busy={busy} onClose={onClose} onSubmit={(event) => { event.preventDefault(); onSave(form); }}>
      <BankField id="book-bank" label="Bank" banks={banks} value={form} onChange={(bank) => setForm({ ...form, ...bank })} />
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
