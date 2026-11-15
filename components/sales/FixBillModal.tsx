'use client';

/**
 * "Return or cancel": the one window for putting a bill right.
 *
 * A bill's "⋯" menu used to offer Return goods, Cancel this bill and Delete as three separate
 * entries, each with its own window, and the owner had to know which of the three his situation
 * was before he started. This asks instead — "What happened?" — and each answer says in a line
 * what it will do to stock and to money. An answer that cannot be used on this bill is greyed out
 * with the reason beside it (lib/bill-fix.ts), rather than refused after a reason has been typed.
 *
 * Each path is also shorter than the window it replaces:
 *   - a return has "Return everything", − / + on each line, and the exact amount coming off the
 *     bill worked out as the database will work it out, instead of a paragraph describing the sum;
 *   - a reason is one tap on the usual ones, with "Other" for anything else;
 *   - nothing asks "are you sure?" in a second box: the summary and the button are the question.
 *
 * What is saved, and how, is unchanged: the same three calls (lib/client-sales.ts,
 * lib/client-sales-returns.ts), each one database transaction. The page that opens this re-reads
 * its lists when `onDone` is called.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, Ban, Minus, PackageCheck, Plus, Trash2, Undo2 } from 'lucide-react';
import MoneyPicker from '@/components/money/MoneyPicker';
import type { MoneyChoice } from '@/lib/money-book';
import { cancelSalesInvoice, deleteSalesInvoice } from '@/lib/client-sales';
import { createSalesReturn, getReturnableInvoiceItems, type ReturnableInvoiceItem } from '@/lib/client-sales-returns';
import { invoiceBalanceDue } from '@/lib/invoice-balance';
import { money, paise } from '@/lib/money';
import { CANCEL_REASONS, RETURN_REASONS, billFixOptions, chosenReason, previewSalesReturn, type FixKind } from '@/lib/bill-fix';
import { DRAFT_STATUS, type Customer, type Invoice, type InvoiceItem } from '@/lib/sales-types';

export type FixBillModalProps = {
  invoice: Invoice;
  companyId: string;
  /** The customer's account, when the bill is on one. A walk-in bill has none. */
  customer: Customer | undefined;
  /** The bill's lines as the page has them, for counting what goes back into stock. */
  items: InvoiceItem[];
  /** Returns already recorded against the bill. */
  returnCount: number;
  /** Receipts applied to the bill after it was made, by number. */
  laterPayments: string[];
  /** Opens the bill for editing instead, when only a price or a quantity is wrong. Left out when
   *  the bill cannot be edited. */
  onEdit?: () => void;
  onClose: () => void;
  /** Called after a save, with the sentence to show. The page re-reads its lists. */
  onDone: (message: string) => void | Promise<void>;
};

type Step = 'choose' | FixKind;

const pieces = (count: number) => `${count} ${count === 1 ? 'piece' : 'pieces'}`;

/** The usual reasons as one-tap buttons, with "Other" opening a box for anything else. */
function ReasonPicker({ label, reasons, picked, other, disabled, onPick, onOther }: {
  label: string;
  reasons: readonly string[];
  /** One of `reasons`, null once "Other" is chosen, undefined while nothing is. */
  picked: string | null | undefined;
  other: string;
  disabled: boolean;
  onPick: (reason: string | null) => void;
  onOther: (text: string) => void;
}) {
  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      <span className="form-label">{label}</span>
      <div className="chip-row" role="group" aria-label={label}>
        {reasons.map((reason) => (
          <button key={reason} type="button" className={`chip${picked === reason ? ' active' : ''}`} aria-pressed={picked === reason} disabled={disabled} onClick={() => onPick(reason)}>
            {reason}
          </button>
        ))}
        <button type="button" className={`chip${picked === null ? ' active' : ''}`} aria-pressed={picked === null} disabled={disabled} onClick={() => onPick(null)}>
          Other
        </button>
      </div>
      {picked === null && (
        <input className="form-input" style={{ marginTop: '8px' }} autoFocus maxLength={300} placeholder="Say what happened, in a few words"
          aria-label={`${label} (your own words)`} value={other} disabled={disabled} onChange={(event) => onOther(event.target.value)} />
      )}
    </div>
  );
}

export default function FixBillModal(props: FixBillModalProps) {
  const { invoice, companyId, customer, items, returnCount, laterPayments, onEdit, onClose, onDone } = props;

  const isDraft = invoice.status === DRAFT_STATUS;
  const options = billFixOptions(invoice, { lineCount: items.length, returnCount, laterPayments });
  // A draft has only one thing that can be done to it, so it opens straight on that.
  const [step, setStep] = useState<Step>(isDraft ? 'delete' : 'choose');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Reason, shared by the return and cancel steps (only one of them is ever on screen).
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const [other, setOther] = useState('');
  const reason = picked === undefined ? '' : chosenReason(picked, other);

  // The return step. What is still returnable is always asked of the server, never worked out here:
  // goods already returned must not be returned a second time.
  const [returnable, setReturnable] = useState<ReturnableInvoiceItem[] | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [damaged, setDamaged] = useState<Record<string, boolean>>({});
  const [refundChoice, setRefundChoice] = useState<MoneyChoice | null>(null);

  useEffect(() => {
    if (step !== 'return' || returnable !== null) return;
    let active = true;
    getReturnableInvoiceItems(companyId, invoice.id)
      .then((rows) => { if (active) setReturnable(rows); })
      .catch((cause) => { if (active) { setReturnable([]); setError(cause instanceof Error ? cause.message : `Could not load ${invoice.id}.`); } });
    return () => { active = false; };
  }, [step, returnable, companyId, invoice.id]);

  const go = (next: Step) => {
    setError('');
    setPicked(undefined);
    setOther('');
    setStep(next);
  };

  const lines = (returnable ?? []).filter((item) => Number(item.returnable_qty) > 0);
  const qtyOf = (item: ReturnableInvoiceItem) => Math.min(Number(item.returnable_qty), Math.max(0, quantities[item.invoice_item_id] ?? 0));
  const setQty = (item: ReturnableInvoiceItem, value: number) => {
    const qty = Number.isFinite(value) ? Math.min(Number(item.returnable_qty), Math.max(0, Math.floor(value))) : 0;
    setQuantities((current) => ({ ...current, [item.invoice_item_id]: qty }));
  };
  const everything = lines.length > 0 && lines.every((item) => qtyOf(item) === Number(item.returnable_qty));
  const returnEverything = () => setQuantities(everything ? {} : Object.fromEntries(lines.map((item) => [item.invoice_item_id, Number(item.returnable_qty)])));

  const chosenLines = lines
    .map((item) => ({ item, qty: qtyOf(item), isDamaged: Boolean(damaged[item.invoice_item_id]) }))
    .filter((line) => line.qty > 0);
  const preview = previewSalesReturn(invoice, chosenLines.map((line) => ({
    soldQty: line.item.sold_qty, lineTotal: line.item.line_total, qty: line.qty, damaged: line.isDamaged,
  })));
  // Pieces that are stock at all: a one-off line (labour, a part not kept) never moves stock.
  const stockPieces = (onlyDamaged: boolean) => chosenLines
    .filter((line) => line.item.product_id && line.isDamaged === onlyDamaged)
    .reduce((sum, line) => sum + line.qty, 0);

  const run = async (work: () => Promise<string>) => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const message = await work();
      await onDone(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That was not saved. Nothing was changed.');
      setSaving(false);
    }
  };

  const saveReturn = () => run(async () => {
    const result = await createSalesReturn({
      companyId,
      invoiceId: invoice.id,
      customerId: customer?.id ?? null,
      reason,
      items: chosenLines.map((line) => ({ invoice_item_id: line.item.invoice_item_id, qty: line.qty, condition: line.isDamaged ? 'damaged' : 'resellable' })),
      money: preview.refund > 0 ? refundChoice : null,
    });
    const back = stockPieces(false);
    const kept = stockPieces(true);
    return `${result.id} saved: ₹${paise(Number(result.credit_total))} taken off ${invoice.id}.`
      + (back > 0 ? ` ${pieces(back)} back in stock.` : '')
      + (kept > 0 ? ` ${pieces(kept)} marked damaged and kept out of stock.` : '')
      + (preview.refund > 0 ? ` Give ₹${paise(preview.refund)} back to ${invoice.customer}.` : '');
  });

  const saveCancel = () => run(async () => {
    await cancelSalesInvoice(companyId, invoice.id, customer?.id ?? null, reason);
    return `${invoice.id} cancelled. Its parts are back in stock and nothing is owed on it. It stays on record, marked cancelled.`;
  });

  const saveDelete = () => run(async () => {
    await deleteSalesInvoice(companyId, invoice.id, customer?.id ?? null);
    return isDraft
      ? `${invoice.id} discarded. Its reserved parts are back in stock.`
      : `${invoice.id} deleted. Its parts are back in stock${customer ? ` and it is off ${customer.name}'s account` : ''}.`;
  });

  const due = invoiceBalanceDue(invoice);
  const paid = Number(invoice.paid) || 0;
  const stockOnBill = items.filter((item) => item.product_id).reduce((sum, item) => sum + (Number(item.qty) || 0), 0);

  const choice = (kind: FixKind, icon: ReactNode, title: string, text: string, danger = false) => {
    const option = options[kind];
    return (
      <button type="button" className={`fix-choice${danger ? ' danger' : ''}`} disabled={!option.allowed} onClick={() => go(kind)}>
        <span className="fix-choice-icon">{icon}</span>
        <span className="fix-choice-text">
          <strong>{title}</strong>
          <small>{option.allowed ? text : option.why}</small>
        </span>
      </button>
    );
  };

  const title = step === 'return'
    ? `Goods came back on ${invoice.id}`
    : step === 'cancel'
      ? `Cancel ${invoice.id}`
      : step === 'delete'
        ? (isDraft ? `Discard draft ${invoice.id}?` : `Delete ${invoice.id}?`)
        : `Return or cancel ${invoice.id}`;

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: step === 'return' ? '720px' : '560px' }} role="dialog" aria-modal="true" aria-labelledby="fix-bill-title">
        <div className="modal-header">
          <div>
            <h3 id="fix-bill-title" className="modal-title">{title}</h3>
            <p className="text-muted text-sm" style={{ marginTop: '3px' }}>
              {invoice.customer} · {invoice.date} · ₹{money(Number(invoice.total))}
              {!isDraft && (due > 0 ? ` · ₹${money(due)} still to pay` : ' · paid')}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Close" disabled={saving} onClick={onClose}>✕</button>
        </div>

        <div className="modal-body flex flex-col gap-4">
          {error && <div className="alert alert-danger" role="alert">{error}</div>}

          {step === 'choose' && (
            <>
              <p className="form-label" style={{ margin: 0, fontSize: '14px' }}>What happened?</p>
              <div className="flex flex-col gap-3">
                {choice('return', <Undo2 size={22} aria-hidden="true" />, 'Goods came back',
                  'The customer returned some or all of the parts. They go back into stock and their amount comes off the bill.')}
                {choice('cancel', <Ban size={22} aria-hidden="true" />, 'Cancel the whole bill',
                  'The sale did not happen. Every part goes back into stock and nothing is owed. The bill keeps its number, marked cancelled.')}
              </div>
              <p className="text-muted text-sm">
                {onEdit && <>Only a price, a quantity or the customer is wrong? <button type="button" className="link-button" onClick={onEdit}>Edit the bill</button> instead. </>}
                {options.delete.allowed
                  ? <>A bill made only as a test can be <button type="button" className="link-button" onClick={() => go('delete')}>deleted completely</button>.</>
                  : null}
              </p>
            </>
          )}

          {step === 'return' && (
            returnable === null ? (
              <p className="text-muted">Checking what can still be returned…</p>
            ) : lines.length === 0 ? (
              <div className="alert alert-warning" role="status">Everything on {invoice.id} has already been returned. There is nothing left to take back.</div>
            ) : (
              <>
                <div className="flex justify-between items-center" style={{ flexWrap: 'wrap', gap: '8px' }}>
                  <span className="form-label" style={{ margin: 0 }}>How many came back?</span>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={returnEverything}>
                    <PackageCheck size={14} /> {everything ? 'Clear' : 'Return everything'}
                  </button>
                </div>
                <div className="table-wrap">
                  <table className="erp-table">
                    <thead><tr><th>Part</th><th className="text-right" style={{ width: '170px' }}>Came back</th></tr></thead>
                    <tbody>
                      {lines.map((item) => {
                        const qty = qtyOf(item);
                        const max = Number(item.returnable_qty);
                        const each = Number(item.sold_qty) > 0 ? Number(item.line_total) / Number(item.sold_qty) : Number(item.unit_price);
                        return (
                          <tr key={item.invoice_item_id}>
                            <td>
                              <strong style={{ fontSize: '13.5px' }}>{item.name}</strong>
                              <div className="text-muted text-sm">
                                {[item.part_number, `sold ${Number(item.sold_qty)} at ₹${money(each)} each`, Number(item.returned_qty) > 0 ? `${Number(item.returned_qty)} already returned` : '']
                                  .filter(Boolean).join(' · ')}
                              </div>
                              {qty > 0 && item.product_id && (
                                <label className="flex items-center gap-2" style={{ marginTop: '6px', fontSize: '12.5px', cursor: saving ? 'default' : 'pointer' }}>
                                  <input type="checkbox" checked={Boolean(damaged[item.invoice_item_id])} disabled={saving}
                                    onChange={(event) => setDamaged((current) => ({ ...current, [item.invoice_item_id]: event.target.checked }))} />
                                  Damaged, keep out of stock
                                </label>
                              )}
                            </td>
                            <td>
                              <div className="flex items-center gap-2" style={{ justifyContent: 'flex-end' }}>
                                <button type="button" className="btn btn-secondary btn-sm" aria-label={`One less ${item.name}`} disabled={saving || qty <= 0} onClick={() => setQty(item, qty - 1)}><Minus size={12} /></button>
                                <input type="number" min="0" max={max} step="1" className="form-input" style={{ width: '62px', textAlign: 'center', padding: '7px 6px' }}
                                  aria-label={`How many ${item.name} came back`} value={qty} disabled={saving} onChange={(event) => setQty(item, Number(event.target.value))} />
                                <button type="button" className="btn btn-secondary btn-sm" aria-label={`One more ${item.name}`} disabled={saving || qty >= max} onClick={() => setQty(item, qty + 1)}><Plus size={12} /></button>
                              </div>
                              <div className="text-muted text-sm text-right" style={{ marginTop: '3px' }}>of {max}</div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <ReasonPicker label="Why did it come back?" reasons={RETURN_REASONS} picked={picked} other={other} disabled={saving} onPick={setPicked} onOther={setOther} />

                {preview.units > 0 && (
                  <div className="fix-summary">
                    <div className="fix-summary-line is-main"><span>Comes off the bill</span><strong>₹{paise(preview.credit)}</strong></div>
                    {stockPieces(false) > 0 && <div className="fix-summary-line"><span>Goes back into stock</span><span>{pieces(stockPieces(false))}</span></div>}
                    {stockPieces(true) > 0 && <div className="fix-summary-line"><span>Damaged, kept out of stock</span><span>{pieces(stockPieces(true))}</span></div>}
                    {preview.refund > 0
                      ? <div className="fix-summary-line is-warn"><span>Give back to {invoice.customer}</span><strong>₹{paise(preview.refund)}</strong></div>
                      : <div className="fix-summary-line"><span>{preview.stillOwed > 0 ? 'Still to pay on this bill' : 'Left to pay on this bill'}</span><span>₹{paise(preview.stillOwed)}</span></div>}
                  </div>
                )}
                {preview.refund > 0 && (
                  <div>
                    <p className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>If you are giving that back by cheque, tick this:</p>
                    <MoneyPicker companyId={companyId} direction="out" value={refundChoice} onChange={setRefundChoice} disabled={saving} />
                  </div>
                )}
              </>
            )
          )}

          {step === 'cancel' && (
            <>
              <div className="fix-summary">
                {stockOnBill > 0 && <div className="fix-summary-line"><span>Goes back into stock</span><span>{pieces(stockOnBill)}</span></div>}
                {customer && due > 0 && <div className="fix-summary-line"><span>{customer.name} no longer owes</span><span>₹{paise(due)}</span></div>}
                {paid > 0 && <div className="fix-summary-line is-warn"><span>Give back to {invoice.customer}</span><strong>₹{paise(paid)}</strong></div>}
                <div className="fix-summary-line"><span>The bill</span><span>keeps number {invoice.id}, marked CANCELLED</span></div>
              </div>
              <ReasonPicker label="Why is it being cancelled?" reasons={CANCEL_REASONS} picked={picked} other={other} disabled={saving} onPick={setPicked} onOther={setOther} />
            </>
          )}

          {step === 'delete' && (
            isDraft ? (
              <p>This draft was never billed. Discarding it puts the {stockOnBill > 0 ? pieces(stockOnBill) : 'parts'} it was holding back into stock. Nothing changes on any account.</p>
            ) : (
              <>
                <div className="alert alert-warning" role="status">
                  <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: '1px' }} />
                  <span>Deleting removes the bill and its number altogether. If this bill was ever given to the customer, go back and <strong>cancel</strong> it instead, so the number stays on record.</span>
                </div>
                <div className="fix-summary">
                  {stockOnBill > 0 && <div className="fix-summary-line"><span>Goes back into stock</span><span>{pieces(stockOnBill)}</span></div>}
                  {customer && due > 0 && <div className="fix-summary-line"><span>{customer.name} no longer owes</span><span>₹{paise(due)}</span></div>}
                  {paid > 0 && <div className="fix-summary-line is-warn"><span>Give back to {invoice.customer}</span><strong>₹{paise(paid)}</strong></div>}
                </div>
              </>
            )
          )}
        </div>

        <div className="modal-footer modal-footer--sticky" style={{ flexWrap: 'wrap' }}>
          {step !== 'choose' && !isDraft && (
            <button type="button" className="btn btn-ghost" style={{ marginRight: 'auto' }} disabled={saving} onClick={() => go('choose')}>
              <ArrowLeft size={15} /> Back
            </button>
          )}
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>{step === 'choose' ? 'Close' : isDraft ? 'Keep the draft' : 'Keep the bill'}</button>
          {step === 'return' && lines.length > 0 && (
            <button type="button" className="btn btn-primary" disabled={saving || preview.units === 0 || !reason} onClick={saveReturn}>
              {saving ? 'Saving…' : preview.units === 0 ? 'Choose what came back' : !reason ? 'Choose a reason' : `Save return · ₹${paise(preview.credit)}`}
            </button>
          )}
          {step === 'cancel' && (
            <button type="button" className="btn btn-danger" disabled={saving || !reason} onClick={saveCancel}>
              <Ban size={15} /> {saving ? 'Cancelling…' : !reason ? 'Choose a reason' : 'Cancel this bill'}
            </button>
          )}
          {step === 'delete' && (
            <button type="button" className="btn btn-danger" disabled={saving} onClick={saveDelete}>
              <Trash2 size={15} /> {saving ? (isDraft ? 'Discarding…' : 'Deleting…') : isDraft ? 'Discard draft' : 'Delete bill'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
