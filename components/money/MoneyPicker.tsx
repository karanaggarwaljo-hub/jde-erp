'use client';

import { useEffect, useState } from 'react';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import type { MoneyChoice } from '@/lib/money-book';

export type { MoneyChoice };
type Bank = { id: string; name: string };

const bankCache = new Map<string, Promise<Bank[]>>();

function loadBanks(companyId: string): Promise<Bank[]> {
  let pending = bankCache.get(companyId);
  if (!pending) {
    pending = fetch(`/api/money/accounts?companyId=${encodeURIComponent(companyId)}`)
      .then((res) => parseJsonOrThrow(res, 'Your banks could not be loaded.') as Promise<Bank[]>)
      .catch((error) => {
        bankCache.delete(companyId);
        throw error;
      });
    bankCache.set(companyId, pending);
  }
  return pending;
}

const NOT_CHEQUE: MoneyChoice = { method: 'other', accountId: '', chequeNo: '', chequeDate: '', bankName: '' };

/**
 * "Paid by cheque" — on every screen that takes or pays money. Ticked, the cheque's number, date
 * and bank go with the payment and it is entered in the cheque register by itself
 * (lib/cash-book.ts). Unticked, nothing about how it was paid is recorded. `alwaysCheque` is for a
 * screen that already asked how it was paid (an expense's payment mode) and only needs the details.
 */
export default function MoneyPicker({ companyId, direction, value, onChange, disabled = false, alwaysCheque = false }: {
  companyId: string;
  direction: 'in' | 'out';
  value: MoneyChoice | null;
  onChange: (choice: MoneyChoice) => void;
  disabled?: boolean;
  alwaysCheque?: boolean;
}) {
  const [banks, setBanks] = useState<Bank[] | null>(null);
  const cheque = alwaysCheque || value?.method === 'cheque';

  // The owner's banks, for a cheque given: only once one is being written.
  useEffect(() => {
    if (!companyId || direction !== 'out' || !cheque || banks) return;
    let active = true;
    loadBanks(companyId).then((list) => { if (active) setBanks(list); }).catch(() => { if (active) setBanks([]); });
    return () => { active = false; };
  }, [companyId, direction, cheque, banks]);

  // Which bank: the one chosen, or the only one there is.
  const chosenBank = banks?.find((bank) => bank.id === value?.accountId)?.id ?? (banks?.length === 1 ? banks[0].id : '');
  useEffect(() => {
    if (cheque && direction === 'out' && value && chosenBank && value.accountId !== chosenBank) onChange({ ...value, accountId: chosenBank });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cheque, chosenBank]);

  // A cheque you give: suggest the next unused leaf of that bank's cheque books (Cheques page),
  // unless a number is already typed. Only a suggestion — it can be changed.
  const leafAccount = cheque && direction === 'out' && chosenBank && !value?.chequeNo ? chosenBank : '';
  useEffect(() => {
    if (!leafAccount || !companyId) return;
    let active = true;
    void (async () => {
      try {
        const res = await fetch(`/api/cheques/next?companyId=${encodeURIComponent(companyId)}&accountId=${encodeURIComponent(leafAccount)}`);
        const body = (await parseJsonOrThrow(res, '')) as { next: string | null };
        if (active && body.next && value && !value.chequeNo) onChange({ ...value, method: 'cheque', accountId: leafAccount, chequeNo: body.next });
      } catch {
        // No suggestion; the number is typed by hand.
      }
    })();
    return () => { active = false; };
    // Asked once per bank chosen for a cheque.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafAccount, companyId]);

  // Every time the form opens it starts afresh, so the last payment's cheque number is never carried
  // into the next one. A screen that only shows this for a cheque starts with a cheque.
  useEffect(() => {
    onChange(alwaysCheque ? { ...NOT_CHEQUE, method: 'cheque' } : { ...NOT_CHEQUE });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (patch: Partial<MoneyChoice>) => onChange({ ...(value ?? NOT_CHEQUE), ...patch });
  const verb = direction === 'in' ? 'Received' : 'Paid';

  return (
    <div className="form-group">
      {!alwaysCheque && (
        <label className="flex items-center gap-2" style={{ cursor: disabled ? 'default' : 'pointer', fontSize: 14 }}>
          <input type="checkbox" disabled={disabled} checked={cheque}
            onChange={(event) => set(event.target.checked ? { method: 'cheque' } : { ...NOT_CHEQUE })} />
          {verb} by cheque
        </label>
      )}
      {cheque && (
        <>
          <div className="flex gap-2" style={{ marginTop: 6 }}>
            <input className="form-input" placeholder="Cheque number" disabled={disabled} value={value?.chequeNo ?? ''} onChange={(event) => set({ chequeNo: event.target.value })} aria-label="Cheque number" />
            <input className="form-input" type="date" disabled={disabled} value={value?.chequeDate ?? ''} onChange={(event) => set({ chequeDate: event.target.value })} aria-label="Date on the cheque" title="Date written on the cheque" />
          </div>
          {direction === 'in' && (
            <input className="form-input" style={{ marginTop: 6 }} placeholder="Their bank (optional)" disabled={disabled} value={value?.bankName ?? ''} onChange={(event) => set({ bankName: event.target.value })} aria-label="Bank the cheque is drawn on" />
          )}
          {direction === 'out' && banks && banks.length > 1 && (
            <select className="form-input form-select" style={{ marginTop: 6 }} disabled={disabled} value={chosenBank}
              aria-label="Bank the cheque is drawn on" onChange={(event) => set({ accountId: event.target.value, chequeNo: '' })}>
              <option value="" disabled>Drawn on which bank?</option>
              {banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}
            </select>
          )}
          {direction === 'out' && banks && banks.length === 1 && (
            <span className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>Drawn on {banks[0].name}</span>
          )}
          {direction === 'out' && banks && banks.length === 0 && (
            <span className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
              It goes into the cheque register. Add your cheque book on the Cheques page to have the bank and next number filled in.
            </span>
          )}
        </>
      )}
    </div>
  );
}
