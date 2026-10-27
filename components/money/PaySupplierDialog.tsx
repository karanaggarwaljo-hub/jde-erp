'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Banknote, Plus, ScrollText, X } from 'lucide-react';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import { keepEnterInsideForm } from '@/lib/form-keys';
import { shopDay } from '@/lib/logbook';
import { money } from '@/lib/money';
import { loadBanks } from '@/components/money/MoneyPicker';
import {
  chequeProblem,
  chequesTotal,
  DATE_GAP_LABEL,
  MAX_CHEQUES,
  nextNumber,
  planCheques,
  spacedDates,
  type ChequeDraft,
  type DateGap,
} from '@/lib/cheque-split';

export type PayableSupplier = { id: string; name: string; balance: number };
export type SupplierPaid = { supplierName: string; amount: number; cheques: number; ordersPaid: number };

type Bank = { id: string; name: string };

const SPLITS = [2, 3, 4, 6];

/**
 * Paying a supplier, by cash or with one or more cheques. Opened from Suppliers (its Pay button,
 * and Home's or the Day Book's "Pay a supplier") and from the Cheques page ("Give cheques").
 *
 * The owner found cheques hard to enter and pays big bills with several, usually a month apart
 * (October 2026). So a cheque payment is a short list: each cheque its number, date and amount,
 * filled from the cheque book where one is recorded. "Split into 3" divides the amount into equal
 * cheques at the gap chosen. Each cheque is its own payment, all saved together or none
 * (jde_pay_supplier_in_parts), and each goes into the cheque register, so a bounced cheque undoes
 * only its own part.
 */
export default function PaySupplierDialog({ companyId, suppliers, supplierId: initialSupplierId, startWithCheques = false, onClose, onPaid }: {
  companyId: string;
  suppliers: PayableSupplier[];
  /** The supplier being paid; without one, the dialog asks. */
  supplierId?: string;
  /** Opened from the Cheques page: start on Cheque. */
  startWithCheques?: boolean;
  onClose: () => void;
  onPaid: (paid: SupplierPaid) => void;
}) {
  const today = shopDay(new Date());
  const owed = useMemo(() => suppliers.filter((supplier) => Number(supplier.balance) > 0).sort((a, b) => a.name.localeCompare(b.name)), [suppliers]);
  const [supplierId, setSupplierId] = useState(initialSupplierId ?? '');
  const supplier = suppliers.find((row) => row.id === supplierId) ?? null;
  const balance = Math.max(0, Number(supplier?.balance) || 0);
  const [amount, setAmount] = useState(initialSupplierId ? String(balance || '') : '');
  const [paidOn, setPaidOn] = useState(today);
  const [byCheque, setByCheque] = useState(startWithCheques);
  const [banks, setBanks] = useState<Bank[] | null>(null);
  const [accountId, setAccountId] = useState('');
  const [newBank, setNewBank] = useState('');
  const [freeLeaves, setFreeLeaves] = useState<string[]>([]);
  // Opened on Cheque, it starts with one cheque, which takes the amount once it is known.
  const [cheques, setCheques] = useState<ChequeDraft[]>(() => (startWithCheques ? [{ no: '', date: today, amount: '' }] : []));
  const [gap, setGap] = useState<DateGap>('month');
  // Fixed for this dialog, and reused by every retry of the same payment, so a double click or a
  // re-submit after a lost answer returns the payment already recorded instead of paying twice.
  const [reference] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const total = Number(amount) || 0;

  // The owner's banks, once a cheque is being written; the only one is chosen by itself.
  useEffect(() => {
    if (!byCheque || banks) return;
    let active = true;
    loadBanks(companyId)
      .then((list) => {
        if (!active) return;
        setBanks(list);
        if (list.length >= 1) setAccountId((current) => current || list[0].id);
      })
      .catch(() => { if (active) setBanks([]); });
    return () => { active = false; };
  }, [byCheque, banks, companyId]);

  // The free leaves of that bank's cheque books, to number the cheques. Blank numbers are filled
  // with them; a number already typed is never changed.
  useEffect(() => {
    if (!byCheque || !accountId) return;
    let active = true;
    void (async () => {
      try {
        const res = await fetch(`/api/cheques/next?companyId=${encodeURIComponent(companyId)}&accountId=${encodeURIComponent(accountId)}&count=${MAX_CHEQUES}`);
        const body = (await parseJsonOrThrow(res, '')) as { nexts?: string[] };
        if (!active) return;
        const leaves = body.nexts ?? [];
        setFreeLeaves(leaves);
        setCheques((rows) => {
          const taken = new Set(rows.map((row) => row.no).filter(Boolean));
          const spare = leaves.filter((leaf) => !taken.has(leaf));
          return rows.map((row) => (row.no ? row : { ...row, no: spare.shift() ?? '' }));
        });
      } catch {
        // No suggestion: the numbers are typed by hand.
      }
    })();
    return () => { active = false; };
  }, [byCheque, accountId, companyId]);

  const chooseCheque = (yes: boolean) => {
    setByCheque(yes);
    setError('');
    if (yes && cheques.length === 0) setCheques(planCheques(total, 1, paidOn, gap, freeLeaves));
  };

  const changeAmount = (value: string) => {
    setAmount(value);
    // One cheque follows the amount; several are left as typed, and the difference is shown.
    if (cheques.length === 1) setCheques([{ ...cheques[0], amount: value }]);
  };

  const chooseSupplier = (id: string) => {
    setSupplierId(id);
    const chosen = suppliers.find((row) => row.id === id);
    const owes = Math.max(0, Number(chosen?.balance) || 0);
    changeAmount(owes ? String(owes) : '');
  };

  const split = (count: number) => {
    setCheques(planCheques(total, count, cheques[0]?.date || paidOn, gap, freeLeaves, cheques[0]?.no ?? ''));
  };

  const addCheque = () => {
    const last = cheques[cheques.length - 1];
    const taken = new Set(cheques.map((row) => row.no).filter(Boolean));
    const no = freeLeaves.find((leaf) => !taken.has(leaf)) ?? (last ? nextNumber(last.no) : '');
    const date = last ? spacedDates(last.date, 2, gap === 'same' ? 'month' : gap)[1] : paidOn;
    const left = Math.round((total - chequesTotal(cheques)) * 100) / 100;
    setCheques([...cheques, { no, date, amount: left > 0 ? String(left) : '' }]);
  };

  const setCheque = (index: number, patch: Partial<ChequeDraft>) => setCheques(cheques.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const removeCheque = (index: number) => setCheques(cheques.filter((_, i) => i !== index));

  const problem = byCheque ? chequeProblem(cheques, total) : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setError('');
    if (!supplier) { setError('Choose who you are paying.'); return; }
    if (!(total > 0)) { setError('Type how much you are paying.'); return; }
    if (total > balance + 0.005) { setError(`You owe ${supplier.name} only ₹${money(balance)}.`); return; }
    if (problem) { setError(problem); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/suppliers/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          supplierId: supplier.id,
          date: paidOn || today,
          amount: total,
          note: '',
          reference,
          ...(byCheque
            ? {
                cheques: cheques.map((row) => ({ chequeNo: row.no.trim(), chequeDate: row.date, amount: Number(row.amount) })),
                accountId,
                newBank: accountId ? '' : newBank.trim(),
              }
            : {}),
        }),
      });
      const result = (await parseJsonOrThrow(res, 'This payment was not saved.')) as { orders_paid?: number };
      onPaid({ supplierName: supplier.name, amount: total, cheques: byCheque ? cheques.length : 0, ordersPaid: result.orders_paid ?? 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This payment was not saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-labelledby="pay-supplier-title">
        <form onSubmit={submit} onKeyDown={(event) => keepEnterInsideForm(event, !saving)}>
          <div className="modal-header">
            <h3 id="pay-supplier-title" className="modal-title">{byCheque ? 'Pay a supplier by cheque' : 'Pay a supplier'}</h3>
            <button type="button" className="btn btn-ghost btn-sm" aria-label="Close" disabled={saving} onClick={onClose}>✕</button>
          </div>
          <div className="modal-body flex flex-col gap-4">
            {initialSupplierId && supplier ? (
              <p>You owe <strong>{supplier.name}</strong> ₹{money(balance)}.</p>
            ) : (
              <div className="form-group">
                <label className="form-label" htmlFor="pay-supplier">Who are you paying?</label>
                <select id="pay-supplier" className="form-input form-select" value={supplierId} disabled={saving} onChange={(event) => chooseSupplier(event.target.value)}>
                  <option value="">Choose a supplier</option>
                  {owed.map((row) => <option key={row.id} value={row.id}>{row.name} · you owe ₹{money(Number(row.balance))}</option>)}
                </select>
                {owed.length === 0 && <small className="text-muted">You owe no supplier anything right now. A payment is put against unpaid purchases.</small>}
              </div>
            )}

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label" htmlFor="pay-amount">Amount (₹)</label>
                <input id="pay-amount" type="number" min="0.01" step="0.01" className="form-input" disabled={saving} value={amount} onChange={(event) => changeAmount(event.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="pay-on">Paid on</label>
                <input id="pay-on" type="date" className="form-input" disabled={saving} value={paidOn} max={today} onChange={(event) => setPaidOn(event.target.value)} />
              </div>
            </div>

            <div className="form-group">
              <span className="form-label">How did you pay?</span>
              <div className="pay-how" role="group" aria-label="How did you pay?">
                <button type="button" aria-pressed={!byCheque} className={`pay-how-choice${!byCheque ? ' active' : ''}`} disabled={saving} onClick={() => chooseCheque(false)}>
                  <Banknote size={18} aria-hidden="true" /> Cash, UPI or bank transfer
                </button>
                <button type="button" aria-pressed={byCheque} className={`pay-how-choice${byCheque ? ' active' : ''}`} disabled={saving} onClick={() => chooseCheque(true)}>
                  <ScrollText size={18} aria-hidden="true" /> Cheque
                </button>
              </div>
            </div>

            {byCheque && (
              <>
                {banks && banks.length > 1 && (
                  <div className="form-group">
                    <label className="form-label" htmlFor="pay-bank">From which bank?</label>
                    <select id="pay-bank" className="form-input form-select" disabled={saving} value={accountId}
                      onChange={(event) => { setAccountId(event.target.value); setCheques(cheques.map((row) => ({ ...row, no: '' }))); }}>
                      {banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}
                    </select>
                  </div>
                )}
                {banks && banks.length === 1 && <p className="text-muted text-sm" style={{ marginTop: -8 }}>From {banks[0].name}.</p>}
                {banks && banks.length === 0 && (
                  <div className="form-group">
                    <label className="form-label" htmlFor="pay-new-bank">Your bank (optional)</label>
                    <input id="pay-new-bank" className="form-input" placeholder="e.g. HDFC Bank" disabled={saving} value={newBank} onChange={(event) => setNewBank(event.target.value)} />
                  </div>
                )}

                <div className="cheque-rows">
                  <div className="cheque-row cheque-row-head" aria-hidden="true">
                    <span>#</span><span>Cheque number</span><span>Date on cheque</span><span>Amount (₹)</span><span />
                  </div>
                  {cheques.map((row, index) => (
                    <div key={index} className="cheque-row">
                      <span className="cheque-row-index">{index + 1}</span>
                      <input className="form-input" aria-label={`Cheque ${index + 1} number`} placeholder="Number" disabled={saving} value={row.no} onChange={(event) => setCheque(index, { no: event.target.value })} />
                      <input className="form-input" type="date" aria-label={`Cheque ${index + 1} date`} disabled={saving} value={row.date} onChange={(event) => setCheque(index, { date: event.target.value })} />
                      <input className="form-input" type="number" min="0.01" step="0.01" aria-label={`Cheque ${index + 1} amount`} disabled={saving} value={row.amount} onChange={(event) => setCheque(index, { amount: event.target.value })} />
                      <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove cheque ${index + 1}`} disabled={saving || cheques.length === 1} onClick={() => removeCheque(index)}><X size={14} /></button>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 items-center" style={{ flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={saving || cheques.length >= MAX_CHEQUES} onClick={addCheque}><Plus size={14} /> Add another cheque</button>
                  <span className="text-muted text-sm" style={{ marginLeft: 6 }}>or split the amount into</span>
                  {SPLITS.map((count) => (
                    <button key={count} type="button" className="btn btn-ghost btn-sm" disabled={saving || !(total > 0)} onClick={() => split(count)}>{count}</button>
                  ))}
                  <select className="form-input form-select" style={{ width: 'auto', padding: '4px 28px 4px 8px', fontSize: 13 }} aria-label="Dates of the cheques"
                    disabled={saving} value={gap} onChange={(event) => setGap(event.target.value as DateGap)}>
                    {(Object.keys(DATE_GAP_LABEL) as DateGap[]).map((key) => <option key={key} value={key}>{DATE_GAP_LABEL[key]}</option>)}
                  </select>
                </div>

                <p className={`text-sm ${problem ? 'text-warning' : 'text-success'}`} role="status">
                  {problem ?? `${cheques.length} ${cheques.length === 1 ? 'cheque' : 'cheques'} for ₹${money(chequesTotal(cheques))}. Each goes into the Cheques list, to mark cleared when it is paid.`}
                </p>
              </>
            )}

            {error && <p className="form-error" role="alert">{error}</p>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : !(total > 0) ? 'Pay' : byCheque && cheques.length > 1 ? `Pay ₹${money(total)} with ${cheques.length} cheques` : `Pay ₹${money(total)}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
