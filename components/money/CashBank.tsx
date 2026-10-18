'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Banknote, Building2, Calculator, Landmark, Plus, Settings2, Trash2, Wallet } from 'lucide-react';
import { useCompany } from '@/components/CompanyProvider';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import { shopDay, shopDayHeading } from '@/lib/logbook';
import {
  accountBalances,
  accountKindFor,
  accountStatement,
  MONEY_METHODS,
  methodLabel,
  pendingCheques,
  unplacedRows,
  type BookRow,
  type MoneyAccount,
  type MoneyMethod,
} from '@/lib/money-book';

type Account = MoneyAccount & { company_id: string };
type Period = 'today' | 'week' | 'month' | 'all' | 'custom';
type Dialog =
  | { type: 'account'; account: Account | null }
  | { type: 'entry'; kind: 'transfer' | 'owner_in' | 'owner_out' | 'bank_charge' }
  | { type: 'count'; account: Account }
  | null;

const rupees = (value: number) => `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const OWNER_KINDS = new Set(['transfer', 'owner_in', 'owner_out', 'bank_charge', 'adjustment', 'drawer_count']);
const TABLE_OF: Record<BookRow['source'], string> = { payment_in: 'payments_received', supplier_payment: 'supplier_payments', expense: 'expenses', entry: 'money_entries' };

function periodDays(period: Period, today: string, custom: { from: string; to: string }): { from: string | null; to: string | null } {
  const back = (days: number) => shopDay(new Date(new Date(`${today}T12:00:00+05:30`).getTime() - days * 86_400_000));
  if (period === 'today') return { from: today, to: today };
  if (period === 'week') return { from: back(6), to: today };
  if (period === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  if (period === 'custom') return { from: custom.from || null, to: custom.to || null };
  return { from: null, to: null };
}

/**
 * Cash & Bank: what is in the drawer and each bank account now, every rupee in and out with a
 * running balance, cheques waiting to clear, money not yet placed in an account, and the owner's
 * own entries — moving cash to the bank, putting money in or taking it out, bank charges, and the
 * end-of-day drawer count. lib/money-book.ts does the arithmetic.
 */
export default function CashBank() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? '';
  const [data, setData] = useState<{ accounts: Account[]; rows: BookRow[]; today: string } | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState('');
  const [period, setPeriod] = useState<Period>('today');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let active = true;
    void (async () => {
      try {
        const res = await fetch(`/api/money?companyId=${encodeURIComponent(companyId)}`);
        const body = (await parseJsonOrThrow(res, 'The cash book could not be loaded.')) as { accounts: Account[]; rows: BookRow[]; today: string };
        if (!active) return;
        setData(body);
        setError('');
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'The cash book could not be loaded.');
      }
    })();
    return () => { active = false; };
  }, [companyId, reloadKey]);

  const reload = () => setReloadKey((key) => key + 1);

  const post = async (body: Record<string, unknown>, fallback: string) => {
    setBusy(true);
    try {
      const res = await fetch('/api/money', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId, ...body }) });
      return await parseJsonOrThrow(res, fallback);
    } finally {
      setBusy(false);
    }
  };

  const accounts = useMemo(() => (data?.accounts ?? []).filter((account) => !account.archived), [data]);
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const today = data?.today ?? shopDay(new Date());
  const balances = useMemo(() => accountBalances(accounts, rows), [accounts, rows]);
  const current = accounts.find((account) => account.id === selected) ?? accounts[0];
  const days = periodDays(period, today, custom);
  const statement = current ? accountStatement(current, rows, days.from, days.to) : null;
  const unplaced = unplacedRows(rows);
  const cheques = pendingCheques(rows);
  const accountName = (id: string | null) => accounts.find((account) => account.id === id)?.name ?? (data?.accounts.find((account) => account.id === id)?.name ?? '—');

  const act = async (body: Record<string, unknown>, done: string, fallback: string) => {
    setError('');
    try {
      await post(body, fallback);
      setMessage(done);
      setDialog(null);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    }
  };

  if (!data && !error) return <div className="skeleton" style={{ height: 240, width: '100%' }} />;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Money</div>
          <h1 className="page-title">Cash &amp; Bank</h1>
          <p className="page-subtitle">What is in the drawer and each bank account, and every rupee in and out — India time.</p>
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setDialog({ type: 'entry', kind: 'transfer' })} disabled={accounts.length < 2} title={accounts.length < 2 ? 'Add a bank account first' : undefined}>
            <ArrowLeftRight size={15} /> Move money
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setDialog({ type: 'entry', kind: 'owner_in' })}><Plus size={15} /> Put money in</button>
          <button type="button" className="btn btn-secondary" onClick={() => setDialog({ type: 'entry', kind: 'owner_out' })}><Wallet size={15} /> Take money out</button>
          <button type="button" className="btn btn-primary" onClick={() => setDialog({ type: 'account', account: null })}><Landmark size={15} /> Add bank account</button>
        </div>
      </div>

      {message && <div className="alert alert-success mb-4" role="status">{message}</div>}
      {error && <div className="alert alert-danger mb-4" role="alert">{error}</div>}

      <div className="kpi-grid">
        {accounts.map((account) => {
          const balance = balances[account.id];
          const isCash = account.kind === 'cash';
          return (
            <div key={account.id} className="kpi-card" style={{ cursor: 'pointer', outline: current?.id === account.id ? '2px solid var(--brand)' : undefined, '--kpi-color': isCash ? 'var(--color-success)' : 'var(--chart-blue)', '--kpi-color-bg': isCash ? 'var(--color-success-bg)' : 'var(--color-info-bg)' } as React.CSSProperties}
              onClick={() => setSelected(account.id)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') setSelected(account.id); }}>
              <div className="flex justify-between items-center">
                <span className="kpi-label">{account.name}</span>
                <div className="kpi-icon-wrap">{isCash ? <Banknote size={18} /> : <Building2 size={18} />}</div>
              </div>
              <div className={`kpi-value ${balance && balance.balance < 0 ? 'text-danger' : ''}`}>{rupees(balance?.balance ?? 0)}</div>
              <div className="kpi-change text-muted" style={{ fontSize: 12 }}>
                {balance && (balance.pendingIn > 0 || balance.pendingOut > 0)
                  ? `Cheques waiting: ${balance.pendingIn > 0 ? `+${rupees(balance.pendingIn)}` : ''}${balance.pendingIn > 0 && balance.pendingOut > 0 ? ' / ' : ''}${balance.pendingOut > 0 ? `−${rupees(balance.pendingOut)}` : ''}`
                  : `Since ${account.opening_date} (opening ${rupees(Number(account.opening_balance))})`}
              </div>
              <div className="flex gap-2" style={{ marginTop: 6 }}>
                {isCash && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={(event) => { event.stopPropagation(); setDialog({ type: 'count', account }); }}>
                    <Calculator size={13} /> Count the drawer
                  </button>
                )}
                <button type="button" className="btn btn-ghost btn-sm" aria-label={`Settings for ${account.name}`} onClick={(event) => { event.stopPropagation(); setDialog({ type: 'account', account }); }}>
                  <Settings2 size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {unplaced.length > 0 && (
        <div className="card mb-4">
          <div className="card-header"><h3 className="card-title">Not placed in an account ({unplaced.length})</h3></div>
          <p className="text-muted" style={{ fontSize: 13, marginBottom: 8 }}>
            Money recorded before Cash &amp; Bank existed, or without a bank account set up. Say where each went and it joins that account&apos;s balance.
          </p>
          <div className="table-wrap">
            <table className="erp-table">
              <thead><tr><th>Date</th><th>What</th><th className="text-right">Amount</th><th>Place it</th></tr></thead>
              <tbody>
                {unplaced.slice(0, 50).map((row) => <PlaceRow key={row.key} row={row} accounts={accounts} busy={busy}
                  onPlace={(method, accountId) => act({ action: 'place', table: TABLE_OF[row.source], id: row.sourceId, method, accountId }, `Placed in ${accountName(accountId)}.`, 'Could not place it.')} />)}
              </tbody>
            </table>
          </div>
          {unplaced.length > 50 && <p className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>Showing the newest 50.</p>}
        </div>
      )}

      {cheques.length > 0 && (
        <div className="card mb-4">
          <div className="card-header"><h3 className="card-title">Cheques waiting to clear ({cheques.length})</h3></div>
          <div className="table-wrap">
            <table className="erp-table">
              <thead><tr><th>Date</th><th>From / to</th><th>Cheque</th><th>Account</th><th className="text-right">Amount</th><th /></tr></thead>
              <tbody>
                {cheques.map((row) => (
                  <tr key={row.key}>
                    <td>{row.date}</td>
                    <td>{row.party || row.what}<div className="text-muted" style={{ fontSize: 12 }}>{row.reference}</div></td>
                    <td>{row.cheque?.no || '—'}{row.cheque?.date && <div className="text-muted" style={{ fontSize: 12 }}>dated {row.cheque.date}</div>}</td>
                    <td>{accountName(row.accountId)}</td>
                    <td className={`text-right font-semibold ${row.amount < 0 ? 'text-danger' : 'text-success'}`}>{row.amount < 0 ? '−' : '+'}{rupees(Math.abs(row.amount))}</td>
                    <td className="text-right" style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn btn-secondary btn-sm" disabled={busy}
                        onClick={() => act({ action: 'cheque', table: TABLE_OF[row.source], id: row.sourceId, status: 'cleared', clearedOn: today }, 'Cheque marked cleared — it now counts in the account.', 'Could not update the cheque.')}>Cleared</button>{' '}
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
                        onClick={() => { if (window.confirm('Mark this cheque as bounced? The payment it made is undone: what it paid is owed again, and it never counts in any balance.')) void act({ action: 'cheque', table: TABLE_OF[row.source], id: row.sourceId, status: 'bounced' }, 'Cheque marked bounced, and the payment it made was undone.', 'Could not update the cheque.'); }}>Bounced</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {current && statement && (
        <div className="card">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 10 }}>
            <h3 className="card-title">{current.name}</h3>
            <div className="flex gap-2 items-center" style={{ flexWrap: 'wrap' }}>
              <div className="tabs" role="group" aria-label="Period">
                {(['today', 'week', 'month', 'all', 'custom'] as Period[]).map((key) => (
                  <button key={key} type="button" aria-pressed={period === key} className={`tab ${period === key ? 'active' : ''}`} onClick={() => setPeriod(key)}>
                    {{ today: 'Today', week: 'Last 7 days', month: 'This month', all: 'All', custom: 'Pick dates' }[key]}
                  </button>
                ))}
              </div>
              {period === 'custom' && (
                <>
                  <input type="date" className="form-input" style={{ width: 'auto' }} value={custom.from} onChange={(event) => setCustom({ ...custom, from: event.target.value })} aria-label="From" />
                  <input type="date" className="form-input" style={{ width: 'auto' }} value={custom.to} onChange={(event) => setCustom({ ...custom, to: event.target.value })} aria-label="To" />
                </>
              )}
            </div>
          </div>
          <div className="flex gap-4" style={{ flexWrap: 'wrap', fontSize: 13, marginBottom: 8 }}>
            <span>Opening <strong>{rupees(statement.opening)}</strong></span>
            <span className="text-success">In <strong>{rupees(statement.moneyIn)}</strong></span>
            <span className="text-danger">Out <strong>{rupees(statement.moneyOut)}</strong></span>
            <span>Closing <strong>{rupees(statement.closing)}</strong></span>
          </div>
          <div className="table-wrap">
            <table className="erp-table">
              <thead><tr><th>Date</th><th>What</th><th>By</th><th className="text-right">In</th><th className="text-right">Out</th><th className="text-right">Balance</th><th /></tr></thead>
              <tbody>
                {statement.lines.length === 0 && (
                  <tr><td colSpan={7} className="text-muted">No money in or out of {current.name} {period === 'today' ? 'today' : 'in this period'}.</td></tr>
                )}
                {[...statement.lines].reverse().map((line) => {
                  const row = line.row;
                  const transferNote = row.kind === 'transfer' ? (line.amount > 0 ? `from ${accountName(row.accountId)}` : `to ${accountName(row.toAccountId)}`) : '';
                  return (
                    <tr key={`${row.key}:${line.amount > 0 ? 'in' : 'out'}`}>
                      <td style={{ whiteSpace: 'nowrap' }}>{period === 'today' ? '' : line.date}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{row.what}{transferNote && <span className="text-muted" style={{ fontWeight: 400 }}> {transferNote}</span>}</div>
                        <div className="text-muted" style={{ fontSize: 12 }}>{[row.party, row.reference, row.note].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td>{methodLabel(row.method)}{row.cheque?.no ? ` #${row.cheque.no}` : ''}</td>
                      <td className="text-right text-success">{line.amount > 0 ? rupees(line.amount) : ''}</td>
                      <td className="text-right text-danger">{line.amount < 0 ? rupees(-line.amount) : ''}</td>
                      <td className="text-right font-semibold">{rupees(line.balance)}</td>
                      <td className="text-right">
                        {row.source === 'entry' && OWNER_KINDS.has(row.kind) && (
                          <button type="button" className="btn btn-ghost btn-sm" aria-label="Delete this entry" disabled={busy}
                            onClick={() => { if (window.confirm(`Delete this entry (${row.what}, ${rupees(Math.abs(row.amount))})?`)) void act({ action: 'delete-entry', id: row.sourceId }, 'Entry deleted.', 'Could not delete the entry.'); }}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pager"><span className="pager-info">{period === 'today' ? shopDayHeading(today, today) : ''} Cheques count on the day they clear. Bills, purchases and returns change their own entries when they are edited or deleted.</span></div>
        </div>
      )}

      {dialog?.type === 'account' && (
        <AccountDialog account={dialog.account} today={today} busy={busy} onClose={() => setDialog(null)}
          onSave={(body) => act(body, dialog.account ? 'Account saved.' : 'Account added.', 'Could not save the account.')} />
      )}
      {dialog?.type === 'entry' && (
        <EntryDialog kind={dialog.kind} accounts={accounts} today={today} busy={busy} defaultAccount={current?.id ?? ''} onClose={() => setDialog(null)}
          onSave={(body) => act({ action: 'entry', ...body }, 'Recorded.', 'Could not record it.')} />
      )}
      {dialog?.type === 'count' && (
        <CountDialog account={dialog.account} expected={balances[dialog.account.id]?.balance ?? 0} today={today} busy={busy} onClose={() => setDialog(null)}
          onCount={async (counted) => {
            setError('');
            try {
              const result = (await post({ action: 'drawer-count', accountId: dialog.account.id, counted, date: today }, 'Could not record the count.')) as { expected: number; difference: number };
              setMessage(result.difference === 0
                ? `The drawer matches the book exactly: ${rupees(counted)}.`
                : `The drawer is ${result.difference > 0 ? 'over' : 'short'} by ${rupees(Math.abs(result.difference))} (book said ${rupees(result.expected)}). A correction was recorded so the book matches the drawer.`);
              setDialog(null);
              reload();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not record the count.');
            }
          }} />
      )}
    </div>
  );
}

function PlaceRow({ row, accounts, busy, onPlace }: { row: BookRow; accounts: Account[]; busy: boolean; onPlace: (method: MoneyMethod, accountId: string) => void }) {
  const [method, setMethod] = useState<MoneyMethod>((MONEY_METHODS.find((entry) => entry.key === row.method)?.key) ?? 'cash');
  const choices = accounts.filter((account) => account.kind === accountKindFor(method));
  const [accountId, setAccountId] = useState('');
  const chosen = choices.find((account) => account.id === accountId)?.id ?? choices[0]?.id ?? '';
  return (
    <tr>
      <td style={{ whiteSpace: 'nowrap' }}>{row.date}</td>
      <td>{row.what}<div className="text-muted" style={{ fontSize: 12 }}>{[row.party, row.reference].filter(Boolean).join(' · ')}</div></td>
      <td className={`text-right font-semibold ${row.amount < 0 ? 'text-danger' : 'text-success'}`}>{row.amount < 0 ? '−' : '+'}{rupees(Math.abs(row.amount))}</td>
      <td>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <select className="form-input form-select" style={{ width: 'auto' }} value={method} onChange={(event) => setMethod(event.target.value as MoneyMethod)} aria-label="Paid by">
            {MONEY_METHODS.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
          </select>
          <select className="form-input form-select" style={{ width: 'auto' }} value={chosen} onChange={(event) => setAccountId(event.target.value)} aria-label="Account" disabled={choices.length === 0}>
            {choices.length === 0 ? <option value="">Add a bank account first</option> : choices.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !chosen} onClick={() => onPlace(method, chosen)}>Place</button>
        </div>
      </td>
    </tr>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: 460 }} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-header"><h3 className="modal-title">{title}</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={onClose}>✕</button></div>
      {children}
    </div></div>
  );
}

function AccountDialog({ account, today, busy, onClose, onSave }: { account: Account | null; today: string; busy: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const [name, setName] = useState(account?.name ?? '');
  const [opening, setOpening] = useState(String(account ? Number(account.opening_balance) : ''));
  const [openingDate, setOpeningDate] = useState(account?.opening_date ?? today);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(account
      ? { action: 'edit-account', id: account.id, name, openingBalance: Number(opening) || 0, openingDate }
      : { action: 'add-account', name, kind: 'bank', openingBalance: Number(opening) || 0, openingDate });
  };
  return (
    <Modal title={account ? `Settings — ${account.name}` : 'Add a bank account'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body flex flex-col gap-4">
          <div className="form-group"><label className="form-label" htmlFor="acct-name">Name</label>
            <input id="acct-name" className="form-input" required maxLength={60} placeholder="e.g. HDFC current, SBI, Shop UPI" value={name} onChange={(event) => setName(event.target.value)} /></div>
          <div className="form-grid-2">
            <div className="form-group"><label className="form-label" htmlFor="acct-opening">Balance on that day (₹)</label>
              <input id="acct-opening" className="form-input" type="number" step="0.01" value={opening} onChange={(event) => setOpening(event.target.value)} /></div>
            <div className="form-group"><label className="form-label" htmlFor="acct-date">Starting from</label>
              <input id="acct-date" className="form-input" type="date" required value={openingDate} onChange={(event) => setOpeningDate(event.target.value)} /></div>
          </div>
          <p className="text-muted" style={{ fontSize: 12 }}>
            {account?.kind === 'cash'
              ? 'Count the cash in the drawer and enter it here with today’s date — the book carries on from there.'
              : 'Use the balance your bank shows for the start of that day. Money dated before it is already in that figure.'}
          </p>
        </div>
        <div className="modal-footer">
          {account && account.kind === 'bank' && (
            <button type="button" className="btn btn-ghost" style={{ marginRight: 'auto' }} disabled={busy}
              onClick={() => { if (window.confirm(`Stop using "${account.name}"? Its history stays; it just stops being offered.`)) onSave({ action: 'edit-account', id: account.id, archived: true }); }}>Stop using</button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

const ENTRY_TITLE = { transfer: 'Move money between accounts', owner_in: 'Put money in', owner_out: 'Take money out', bank_charge: 'Bank charges' };

function EntryDialog({ kind, accounts, today, busy, defaultAccount, onClose, onSave }: {
  kind: 'transfer' | 'owner_in' | 'owner_out' | 'bank_charge'; accounts: Account[]; today: string; busy: boolean; defaultAccount: string;
  onClose: () => void; onSave: (body: Record<string, unknown>) => void;
}) {
  const [entryKind, setEntryKind] = useState(kind);
  const cash = accounts.find((account) => account.kind === 'cash');
  const bank = accounts.find((account) => account.kind === 'bank');
  const [from, setFrom] = useState(kind === 'transfer' ? (cash?.id ?? defaultAccount) : (defaultAccount || cash?.id || ''));
  const [to, setTo] = useState(kind === 'transfer' ? (bank?.id ?? '') : '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ kind: entryKind, accountId: from, toAccountId: entryKind === 'transfer' ? to : undefined, amount: Number(amount), date, note });
  };
  return (
    <Modal title={ENTRY_TITLE[entryKind]} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body flex flex-col gap-4">
          {entryKind !== 'transfer' && (
            <div className="tabs" role="group" aria-label="Kind">
              {(['owner_in', 'owner_out', 'bank_charge'] as const).map((key) => (
                <button key={key} type="button" aria-pressed={entryKind === key} className={`tab ${entryKind === key ? 'active' : ''}`} onClick={() => setEntryKind(key)}>{ENTRY_TITLE[key]}</button>
              ))}
            </div>
          )}
          <div className="form-group"><label className="form-label" htmlFor="entry-from">{entryKind === 'transfer' ? 'From' : entryKind === 'owner_in' ? 'Into' : 'From'}</label>
            <select id="entry-from" className="form-input form-select" value={from} onChange={(event) => setFrom(event.target.value)}>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select></div>
          {entryKind === 'transfer' && (
            <div className="form-group"><label className="form-label" htmlFor="entry-to">To</label>
              <select id="entry-to" className="form-input form-select" value={to} onChange={(event) => setTo(event.target.value)}>
                {accounts.filter((account) => account.id !== from).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
              <span className="text-muted" style={{ fontSize: 12 }}>For example: cash taken to the bank, or cash drawn from it.</span></div>
          )}
          <div className="form-grid-2">
            <div className="form-group"><label className="form-label" htmlFor="entry-amount">Amount (₹)</label>
              <input id="entry-amount" className="form-input" type="number" min="0.01" step="0.01" required autoFocus value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
            <div className="form-group"><label className="form-label" htmlFor="entry-date">Date</label>
              <input id="entry-date" className="form-input" type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></div>
          </div>
          <div className="form-group"><label className="form-label" htmlFor="entry-note">Note</label>
            <input id="entry-note" className="form-input" maxLength={300} placeholder={entryKind === 'owner_out' ? 'e.g. home expenses' : entryKind === 'owner_in' ? 'e.g. added to run the shop' : ''} value={note} onChange={(event) => setNote(event.target.value)} /></div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !(Number(amount) > 0) || (entryKind === 'transfer' && (!to || to === from))}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

function CountDialog({ account, expected, today, busy, onClose, onCount }: { account: Account; expected: number; today: string; busy: boolean; onClose: () => void; onCount: (counted: number) => void }) {
  const [counted, setCounted] = useState('');
  const difference = counted === '' ? null : Math.round((Number(counted) - expected) * 100) / 100;
  return (
    <Modal title={`Count the drawer — ${account.name}`} onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); onCount(Number(counted)); }}>
        <div className="modal-body flex flex-col gap-4">
          <p>The book says <strong>{rupees(expected)}</strong> should be in {account.name} now ({today}).</p>
          <div className="form-group"><label className="form-label" htmlFor="count-amount">Cash you counted (₹)</label>
            <input id="count-amount" className="form-input" type="number" min="0" step="0.01" required autoFocus value={counted} onChange={(event) => setCounted(event.target.value)} /></div>
          {difference !== null && (
            <p className={difference === 0 ? 'text-success' : 'text-danger'} style={{ fontWeight: 600 }}>
              {difference === 0 ? 'Matches exactly.' : `${difference > 0 ? 'Over' : 'Short'} by ${rupees(Math.abs(difference))}. Saving records a correction so the book matches the drawer.`}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || counted === ''}>{busy ? 'Saving…' : 'Save the count'}</button>
        </div>
      </form>
    </Modal>
  );
}
