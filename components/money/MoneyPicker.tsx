'use client';

import { useEffect, useState } from 'react';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import { accountKindFor, MONEY_METHODS, type MoneyChoice, type MoneyMethod } from '@/lib/money-book';

export type { MoneyChoice };
type AccountOption = { id: string; name: string; kind: 'cash' | 'bank' };

const accountCache = new Map<string, Promise<AccountOption[]>>();

function loadAccounts(companyId: string): Promise<AccountOption[]> {
  let pending = accountCache.get(companyId);
  if (!pending) {
    pending = fetch(`/api/money/accounts?companyId=${encodeURIComponent(companyId)}`)
      .then((res) => parseJsonOrThrow(res, 'The accounts could not be loaded.') as Promise<AccountOption[]>)
      .catch((error) => {
        accountCache.delete(companyId);
        throw error;
      });
    accountCache.set(companyId, pending);
  }
  return pending;
}

const storageKey = (companyId: string, direction: 'in' | 'out') => `jde-money-choice:${companyId}:${direction}`;

function remembered(companyId: string, direction: 'in' | 'out'): Partial<MoneyChoice> {
  try {
    return JSON.parse(localStorage.getItem(storageKey(companyId, direction)) || '{}') as Partial<MoneyChoice>;
  } catch {
    return {};
  }
}

function remember(companyId: string, direction: 'in' | 'out', choice: MoneyChoice) {
  try {
    localStorage.setItem(storageKey(companyId, direction), JSON.stringify({ method: choice.method, accountId: choice.accountId }));
  } catch {
    // A private window: nothing is remembered, which is fine.
  }
}

/** The account a method should use: the one picked, if it is of the right kind, else the first. */
function accountFor(accounts: AccountOption[], method: MoneyMethod, preferred?: string): string {
  const kind = accountKindFor(method);
  return (accounts.find((account) => account.id === preferred && account.kind === kind) ?? accounts.find((account) => account.kind === kind))?.id ?? '';
}

/**
 * "Paid by / into which account" — on every screen that takes or pays money: cash, UPI, card,
 * bank transfer or cheque, and which drawer or bank account it went through. Remembers the last
 * choice per direction, so the usual case is no clicks at all. The server checks the choice again
 * (lib/cash-book.ts), and with no bank account set up yet a UPI or cheque payment is recorded as
 * not placed rather than turned away.
 */
export default function MoneyPicker({ companyId, direction, value, onChange, disabled = false }: {
  companyId: string;
  direction: 'in' | 'out';
  value: MoneyChoice | null;
  onChange: (choice: MoneyChoice) => void;
  disabled?: boolean;
}) {
  const [accounts, setAccounts] = useState<AccountOption[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!companyId) return;
    let active = true;
    void (async () => {
      try {
        const list = await loadAccounts(companyId);
        if (!active) return;
        setAccounts(list);
        if (!value) {
          const last = remembered(companyId, direction);
          const method = (MONEY_METHODS.some((entry) => entry.key === last.method) ? last.method : 'cash') as MoneyMethod;
          onChange({ method, accountId: accountFor(list, method, last.accountId), chequeNo: '', chequeDate: '' });
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'The accounts could not be loaded.');
      }
    })();
    return () => { active = false; };
    // Only when the company changes: the starting choice is made once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, direction]);

  const set = (patch: Partial<MoneyChoice>) => {
    const base: MoneyChoice = value ?? { method: 'cash', accountId: '', chequeNo: '', chequeDate: '' };
    const next = { ...base, ...patch };
    if (patch.method && accounts) next.accountId = accountFor(accounts, patch.method, base.accountId);
    remember(companyId, direction, next);
    onChange(next);
  };

  const method = value?.method ?? 'cash';
  const kind = accountKindFor(method);
  const choices = (accounts ?? []).filter((account) => account.kind === kind);
  const verb = direction === 'in' ? 'Received' : 'Paid';

  return (
    <div className="form-group">
      <label className="form-label">{verb} by</label>
      <div className="tabs" role="group" aria-label={`${verb} by`} style={{ flexWrap: 'wrap' }}>
        {MONEY_METHODS.map((entry) => (
          <button key={entry.key} type="button" disabled={disabled} aria-pressed={method === entry.key}
            className={`tab ${method === entry.key ? 'active' : ''}`} onClick={() => set({ method: entry.key })}>
            {entry.label}
          </button>
        ))}
      </div>
      {error && <span className="form-error" style={{ fontSize: 12 }}>{error}</span>}
      {accounts && choices.length > 1 && (
        <select className="form-input form-select" style={{ marginTop: 6 }} disabled={disabled} value={value?.accountId ?? ''}
          aria-label={direction === 'in' ? 'Into which account' : 'From which account'} onChange={(event) => set({ accountId: event.target.value })}>
          {choices.map((account) => <option key={account.id} value={account.id}>{direction === 'in' ? 'Into' : 'From'} {account.name}</option>)}
        </select>
      )}
      {accounts && choices.length === 1 && (
        <span className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>{direction === 'in' ? 'Into' : 'From'} {choices[0].name}</span>
      )}
      {accounts && choices.length === 0 && (
        <span className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
          No bank account is set up yet, so this will be listed as not placed. Add your bank account on the Cash &amp; Bank page.
        </span>
      )}
      {method === 'cheque' && (
        <div className="flex gap-2" style={{ marginTop: 6 }}>
          <input className="form-input" placeholder="Cheque number" disabled={disabled} value={value?.chequeNo ?? ''} onChange={(event) => set({ chequeNo: event.target.value })} aria-label="Cheque number" />
          <input className="form-input" type="date" disabled={disabled} value={value?.chequeDate ?? ''} onChange={(event) => set({ chequeDate: event.target.value })} aria-label="Cheque date" />
        </div>
      )}
    </div>
  );
}
