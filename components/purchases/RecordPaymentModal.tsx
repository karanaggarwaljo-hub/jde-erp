'use client';

/**
 * The "Record Payment" dialog, lifted out of app/(dashboard)/purchases/page.tsx.
 *
 * Deliberately presentational: every value and every setter arrives as a prop, and the page still
 * owns the state. That keeps this a pure move with no behaviour change — the compiler checks each
 * prop is supplied and correctly typed, which is the only safety net available for a screen with
 * no automated UI coverage and money running through it.
 *
 * The prop list is the honest shape of the thing rather than a smell to hide: it is exactly what
 * the dialog reads from the page, and it is the map for later moving that state in here.
 */

import type { FormEvent } from 'react';
import { money } from '@/lib/money';
import type { PurchaseOrder } from '@/lib/purchase-types';

export type RecordPaymentModalProps = {
  payingOrder: PurchaseOrder;
  payAmount: number;
  setPayAmount: (value: number) => void;
  payError: string;
  savingPayment: boolean;
  setPayingOrder: (order: PurchaseOrder | null) => void;
  submitPayment: (event: FormEvent) => void;
};

export default function RecordPaymentModal(props: RecordPaymentModalProps) {
  const {
    payingOrder, payAmount, setPayAmount, payError, savingPayment, setPayingOrder, submitPayment,
  } = props;

  return (
    <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '440px' }} role="dialog" aria-modal="true" aria-labelledby="pay-modal-title"><form onSubmit={submitPayment}>
    <div className="modal-header">
      <h3 id="pay-modal-title" className="modal-title">Record Payment</h3>
      <button type="button" className="btn btn-ghost btn-sm" aria-label="Close" disabled={savingPayment} onClick={() => setPayingOrder(null)}>✕</button>
    </div>
    <div className="modal-body">
      {payError && <div className="alert alert-danger" role="alert">{payError}</div>}
      <p className="text-muted" style={{ fontSize: '13px', marginTop: 0 }}>
        <strong>{payingOrder.id}</strong> — {payingOrder.supplier}, dated {payingOrder.date}.
      </p>
      <div className="flex justify-between items-center invoice-summary" style={{ marginBottom: '12px' }}>
        <div><span className="text-muted">Order total: </span><strong>₹{money(payingOrder.total)}</strong></div>
        <div><span className="text-muted">Already paid: </span><strong className="text-success">₹{money(payingOrder.paid)}</strong></div>
        <div><span className="text-muted">Still owing: </span><strong className="text-danger">₹{money(Number(payingOrder.total) - Number(payingOrder.paid))}</strong></div>
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="pay-amount">Amount Paid Now (₹)</label>
        <input id="pay-amount" type="number" min="0.01" step="0.01" max={Number(payingOrder.total) - Number(payingOrder.paid)}
          className="form-input" value={payAmount} disabled={savingPayment}
          onChange={(event) => setPayAmount(Number(event.target.value))} autoFocus />
      </div>
      <p className="text-muted" style={{ fontSize: '12px' }}>
        This reduces what you owe {payingOrder.supplier} by the same amount. Nothing about the stock
        already received changes.
      </p>
    </div>
    <div className="modal-footer">
      <button type="button" className="btn btn-secondary" disabled={savingPayment} onClick={() => setPayingOrder(null)}>Cancel</button>
      <button type="submit" className="btn btn-primary" disabled={savingPayment || !(payAmount > 0)}>{savingPayment ? 'Recording…' : 'Record Payment'}</button>
    </div>
    </form></div></div>
  );
}
