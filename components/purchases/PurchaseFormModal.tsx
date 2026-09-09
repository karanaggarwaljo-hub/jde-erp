'use client';

/**
 * The manual "Record Purchase" form, lifted out of app/(dashboard)/purchases/page.tsx.
 *
 * Deliberately presentational: every value and every setter arrives as a prop, and the page still
 * owns the state. That keeps this a pure move with no behaviour change — the compiler checks each
 * prop is supplied and correctly typed, which is the only safety net available for a screen with
 * no automated UI coverage and money running through it.
 *
 * The long prop list is the honest shape of the thing rather than a smell to hide: it is exactly
 * what the form reads from the page, and it is the map for later moving that state in here.
 */

import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { Plus, Minus } from 'lucide-react';
import { money } from '@/lib/money';
import type { PartOption, PaymentStatus, POLine } from '@/lib/purchase-types';

export type PurchaseFormModalProps = {
  supplierName: string;
  setSupplierName: (value: string) => void;
  supplierOptions: string[];
  purchaseDate: string;
  setPurchaseDate: (value: string) => void;
  partOptions: PartOption[];
  lines: POLine[];
  setLines: Dispatch<SetStateAction<POLine[]>>;
  updateLine: (index: number, patch: Partial<POLine>) => void;
  paymentStatus: PaymentStatus;
  setPaymentStatus: (value: PaymentStatus) => void;
  amountPaid: number;
  setAmountPaid: (value: number) => void;
  total: number;
  paidAmount: number;
  purchaseError: string;
  savingPurchase: boolean;
  setShowPurchaseModal: (open: boolean) => void;
  recordPurchase: (event: FormEvent) => void;
};

export default function PurchaseFormModal(props: PurchaseFormModalProps) {
  const {
    supplierName, setSupplierName, supplierOptions, purchaseDate, setPurchaseDate,
    partOptions, lines, setLines, updateLine,
    paymentStatus, setPaymentStatus, amountPaid, setAmountPaid, total, paidAmount,
    purchaseError, savingPurchase, setShowPurchaseModal, recordPurchase,
  } = props;

  return (
    <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '880px' }} role="dialog" aria-modal="true" aria-labelledby="purchase-modal-title"><form onSubmit={recordPurchase}>
    <div className="modal-header"><h3 id="purchase-modal-title" className="modal-title">Record Purchase</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setShowPurchaseModal(false)}>✕</button></div>
    <div className="modal-body flex flex-col gap-4">
      {purchaseError && <div className="alert alert-danger" role="alert">{purchaseError}</div>}
      <div className="form-grid-2">
        <div className="form-group">
          <label className="form-label">Supplier *</label>
          <input list="purchase-supplier-options" className="form-input" required placeholder="Type or select a supplier" value={supplierName} onChange={(event) => setSupplierName(event.target.value)} />
          <datalist id="purchase-supplier-options">{supplierOptions.map((s) => <option key={s} value={s} />)}</datalist>
        </div>
        <div className="form-group"><label className="form-label">Date</label><input type="date" className="form-input" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} /></div>
      </div>

      <datalist id="po-part-options">
        {partOptions.map((option) => <option key={option.value} value={option.value} />)}
      </datalist>

      <div className="table-wrap">
        <div className="tbl-toolbar">
          <div className="tbl-toolbar-title">
            <strong>Item details</strong>
            <small>Anything not already in Inventory is added as a new part when this is saved</small>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="erp-table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="text-center">Quantity</th>
                <th className="text-right">Unit Cost (₹)</th>
                <th className="text-right">Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const matched = partOptions.find((option) => option.value === line.description);
                return (
                  <tr key={index}>
                    <td style={{ minWidth: '260px' }}>
                      <input list="po-part-options" className="form-input" placeholder="Type a new part name or select an existing one" value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} />
                      {matched
                        ? <small className="text-muted" style={{ display: 'block', marginTop: '4px' }}>Stock: {matched.stock}{matched.category ? ` · ${matched.category}` : ''}</small>
                        : line.description.trim()
                          ? <small className="text-muted" style={{ display: 'block', marginTop: '4px' }}>New part — will be added to Inventory</small>
                          : null}
                    </td>
                    <td>
                      {/* Both steppers write through updateLine, exactly like typing in the box
                          does — the field stays the single source of the quantity. */}
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          className="btn btn-secondary btn-icon"
                          aria-label={`Decrease quantity for line ${index + 1}`}
                          disabled={Number(line.quantity) <= 1}
                          onClick={() => updateLine(index, { quantity: Math.max(1, Number(line.quantity) - 1) })}
                        >
                          <Minus size={14} />
                        </button>
                        <input type="number" min="1" className="form-input text-center" style={{ width: '64px' }} value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} />
                        <button
                          type="button"
                          className="btn btn-secondary btn-icon"
                          aria-label={`Increase quantity for line ${index + 1}`}
                          onClick={() => updateLine(index, { quantity: Number(line.quantity) + 1 })}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </td>
                    <td><input type="number" min="0" className="form-input text-right" value={line.unit_price} onChange={(event) => updateLine(index, { unit_price: Number(event.target.value) })} /></td>
                    <td className="text-right font-semibold">₹{money(line.quantity * line.unit_price)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="pager">
          <div className="pager-info"><strong>{lines.length}</strong> {lines.length === 1 ? 'line item' : 'line items'}</div>
          <div className="flex gap-2 items-center">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLines((current) => [...current, { description: '', quantity: 1, unit_price: 0 }])}><Plus size={14} /> Add Item Row</button>
            {lines.length > 1 && <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)' }} onClick={() => setLines((current) => current.slice(0, -1))}>Remove Last Row</button>}
          </div>
        </div>
      </div>

      <div className="form-grid-2">
        <div className="form-group">
          <label className="form-label">Payment to Supplier</label>
          <select className="form-input form-select" value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value as PaymentStatus)}>
            <option value="paid">Paid in Full</option>
            <option value="partial">Partially Paid</option>
            <option value="unpaid">Unpaid (Credit)</option>
          </select>
        </div>
        {paymentStatus === 'partial' && (
          <div className="form-group"><label className="form-label">Amount Paid (₹)</label><input type="number" min="0" max={total} className="form-input" value={amountPaid} onChange={(event) => setAmountPaid(Number(event.target.value))} /></div>
        )}
      </div>

      <div className="flex justify-between items-center invoice-summary">
        <div><span className="text-muted">Line Items: </span><strong>{lines.length}</strong></div>
        <div><span className="text-muted">Paid: </span><strong className="text-success">₹{money(paidAmount)}</strong></div>
        <div><span className="text-muted">Balance: </span><strong className={total - paidAmount > 0 ? 'text-danger' : 'text-muted'}>₹{money(total - paidAmount)}</strong></div>
        <div><strong>Total: </strong><span className="invoice-total">₹{money(total)}</span></div>
      </div>
    </div>
    <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setShowPurchaseModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={!total || !supplierName.trim() || savingPurchase}>{savingPurchase ? 'Saving…' : 'Save Purchase'}</button></div>
    </form></div></div>
  );
}
