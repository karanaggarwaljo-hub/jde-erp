'use client';

/**
 * The manual "Record Purchase" form.
 *
 * Entry used to be: click "Add Item Row", click the part box, type the exact full catalogue label
 * into a native <datalist>. The part number on its own matched nothing, a barcode scanner matched
 * nothing, and a scanner's trailing Enter reached the surrounding <form> and could save the
 * purchase with one line on it — which on this screen also opens FIFO stock batches, so a mis-save
 * moves real inventory.
 *
 * It is now the same box the sale screen uses: scan or type, Enter, scan or type, Enter. Enter is
 * intercepted at the form so it can never submit by accident; Ctrl+Enter is the deliberate save.
 *
 * The rules — merging a repeated part, what this supplier last charged, and the cost warnings —
 * live in lib/purchase-entry.ts so they can be tested away from the DOM. This file decides how
 * they look, not what they are.
 *
 * Still deliberately presentational for the purchase's own state: every value and setter arrives
 * as a prop and the page owns them. The only state here belongs to the act of typing.
 */

import { useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { Plus, Minus, X, AlertTriangle, Keyboard } from 'lucide-react';
import { money } from '@/lib/money';
import PartPicker from '@/components/PartPicker';
import {
  addNewPartLine,
  addPartToPurchaseLines,
  purchaseLineWarnings,
  type LastPaid,
} from '@/lib/purchase-entry';
import { keepEnterInsideForm, SAVE_SHORTCUT_HINT } from '@/lib/form-keys';
import type { PartOption, PaymentStatus, POLine } from '@/lib/purchase-types';

export type PurchaseFormModalProps = {
  supplierName: string;
  setSupplierName: (value: string) => void;
  supplierOptions: string[];
  purchaseDate: string;
  setPurchaseDate: (value: string) => void;
  /** The supplier's own number for this bill. Blank is allowed — plenty of small bills carry none —
   *  but when it is given, the same bill cannot be recorded against this supplier twice. */
  supplierInvoiceNo: string;
  setSupplierInvoiceNo: (value: string) => void;
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
  /** What this supplier last charged per part, keyed by part label. Empty for a new supplier. */
  lastPaid: Map<string, LastPaid>;
  purchaseError: string;
  savingPurchase: boolean;
  setShowPurchaseModal: (open: boolean) => void;
  recordPurchase: (event: FormEvent) => void;
};

export default function PurchaseFormModal(props: PurchaseFormModalProps) {
  const {
    supplierName, setSupplierName, supplierOptions, purchaseDate, setPurchaseDate,
    supplierInvoiceNo, setSupplierInvoiceNo,
    partOptions, lines, setLines, updateLine,
    paymentStatus, setPaymentStatus, amountPaid, setAmountPaid, total, paidAmount, lastPaid,
    purchaseError, savingPurchase, setShowPurchaseModal, recordPurchase,
  } = props;

  // Held as the part label rather than an index: a scanner can fire twice inside one React batch,
  // and an index captured from a stale render would point at the wrong row.
  const [lastAdded, setLastAdded] = useState('');

  const canSubmit = Boolean(total) && Boolean(supplierName.trim()) && !savingPurchase;

  const handlePick = (part: PartOption) => {
    setLines((current) => addPartToPurchaseLines(current, part).lines);
    setLastAdded(part.value);
  };

  const handleNewPart = (description: string) => {
    setLines((current) => addNewPartLine(current, description).lines);
    setLastAdded(description);
  };

  return (
    <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '920px' }} role="dialog" aria-modal="true" aria-labelledby="purchase-modal-title">
      <form onSubmit={recordPurchase} onKeyDown={(event) => keepEnterInsideForm(event, canSubmit)}>
        <div className="modal-header">
          <div>
            <h3 id="purchase-modal-title" className="modal-title">Record Purchase</h3>
            <div className="text-muted text-sm" style={{ marginTop: '3px' }}>
              Stock goes in and the supplier&apos;s balance moves when this is saved
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setShowPurchaseModal(false)}>✕</button>
        </div>
        <div className="modal-body flex flex-col gap-4">
          {purchaseError && <div className="alert alert-danger" role="alert">{purchaseError}</div>}
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label" htmlFor="purchase-supplier">Supplier *</label>
              <input id="purchase-supplier" list="purchase-supplier-options" className="form-input" required placeholder="Type or select a supplier" value={supplierName} onChange={(event) => setSupplierName(event.target.value)} />
              <datalist id="purchase-supplier-options">{supplierOptions.map((s) => <option key={s} value={s} />)}</datalist>
              <span className="text-muted text-sm">
                {supplierName.trim() && !supplierOptions.includes(supplierName.trim())
                  ? 'New supplier — will be added when this is saved'
                  : lastPaid.size > 0
                    ? 'What you last paid them shows against each part'
                    : 'No purchases recorded from them yet'}
              </span>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="purchase-date">Date</label>
              <input id="purchase-date" type="date" className="form-input" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="purchase-bill-no">Supplier&apos;s bill number</label>
              <input
                id="purchase-bill-no"
                className="form-input"
                placeholder="As printed on the bill"
                value={supplierInvoiceNo}
                onChange={(event) => setSupplierInvoiceNo(event.target.value)}
              />
              <span className="form-hint">
                {supplierInvoiceNo.trim()
                  ? 'This bill cannot then be recorded twice for this supplier'
                  : 'Optional, but it is what stops the same bill being paid twice'}
              </span>
            </div>
          </div>

          <div className="table-wrap">
            <div className="tbl-toolbar" style={{ display: 'block' }}>
              <div className="tbl-toolbar-title" style={{ marginBottom: '8px' }}>
                <strong>Item details</strong>
                <small>Anything not already in Inventory is added as a new part when this is saved</small>
              </div>
              <PartPicker
                parts={partOptions}
                onPick={handlePick}
                onCustom={handleNewPart}
                lastTraded={lastPaid}
                lastLabel="last paid"
                disabled={savingPurchase}
                autoFocus
              />
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="erp-table" style={{ minWidth: '720px' }}>
                <thead>
                  <tr>
                    <th>Part</th>
                    <th className="text-center" style={{ width: '168px' }}>Quantity</th>
                    <th className="text-right" style={{ width: '140px' }}>Unit Cost (₹)</th>
                    <th className="text-right" style={{ width: '150px' }}>Amount (₹)</th>
                    <th style={{ width: '54px' }} aria-label="Remove line"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => {
                    const matched = partOptions.find((option) => option.value === line.description);
                    const previous = lastPaid.get(line.description);
                    const warnings = purchaseLineWarnings(line, matched, previous);
                    return (
                      <tr key={`${line.description}-${index}`} style={line.description === lastAdded ? { background: 'var(--amber-tint)' } : undefined}>
                        <td style={{ minWidth: '240px' }}>
                          {/* The part is chosen in the picker above, so this states what was
                              chosen rather than offering a second, weaker way to search. */}
                          {matched ? (
                            <>
                              <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                                <span className="pn-chip">{matched.partNumber}</span>
                                <strong style={{ fontSize: '13px' }}>{matched.name}</strong>
                              </div>
                              <div className="flex items-center gap-2 mt-1" style={{ flexWrap: 'wrap' }}>
                                {matched.brand && <span className="text-muted text-sm">{matched.brand}</span>}
                                <span className="text-muted text-sm">{matched.stock} in stock</span>
                                {matched.salePrice > 0 && <span className="text-muted text-sm">· sells at ₹{money(matched.salePrice)}</span>}
                                {previous && <span className="text-muted text-sm">· last paid ₹{money(previous.rate)} on {previous.ref}</span>}
                              </div>
                            </>
                          ) : (
                            <>
                              <strong style={{ fontSize: '13px' }}>{line.description}</strong>
                              <div className="text-muted text-sm mt-1">New part — will be added to Inventory</div>
                            </>
                          )}
                          {warnings.map((warning) => (
                            <div key={warning.kind} className={'line-warning' + (warning.kind === 'above-sale-price' ? ' is-stock' : '')}>
                              <AlertTriangle size={12} aria-hidden="true" /> {warning.message}
                            </div>
                          ))}
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
                            <input type="number" min="1" className="form-input text-center" style={{ width: '64px' }} aria-label={`Quantity for line ${index + 1}`} value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} />
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
                        <td>
                          <input type="number" min="0" className="form-input text-right" aria-label={`Unit cost for line ${index + 1}`} value={line.unit_price} onChange={(event) => updateLine(index, { unit_price: Number(event.target.value) })} />
                          {/* One click back to the rate this supplier last charged, which is what
                              the comparison above is against. */}
                          {previous && Number(line.unit_price) !== previous.rate && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{ padding: '2px 4px', fontSize: '11px' }}
                              onClick={() => updateLine(index, { unit_price: previous.rate })}
                            >use ₹{money(previous.rate)}</button>
                          )}
                        </td>
                        <td className="text-right font-semibold">₹{money(line.quantity * line.unit_price)}</td>
                        <td className="text-center">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            aria-label={`Remove line ${index + 1}`}
                            title="Remove this line"
                            style={{ color: 'var(--color-danger)' }}
                            onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}
                          ><X size={14} /></button>
                        </td>
                      </tr>
                    );
                  })}
                  {lines.length === 0 && (
                    <tr><td colSpan={5}><div className="empty-state" style={{ padding: '28px 20px' }}>
                      <p className="empty-state-title">Nothing on this purchase yet</p>
                      <p className="empty-state-desc">Scan a barcode or type a part number in the box above, then press Enter. A part you have never bought before can be typed in full.</p>
                    </div></td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="pager">
              <span className="pager-info flex items-center gap-2">
                <Keyboard size={13} aria-hidden="true" />
                Enter adds the highlighted part · ↑↓ to choose · {SAVE_SHORTCUT_HINT}
              </span>
              <div className="pager-info">
                <strong>{lines.length}</strong> {lines.length === 1 ? 'line item' : 'line items'}
                {lines.length > 0 && <> · <strong>{lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0)}</strong> units</>}
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
        <div className="modal-footer">
          <div className="text-muted text-sm" style={{ marginRight: 'auto', maxWidth: '340px' }}>
            {total <= 0 ? 'Scan or type a part above to record this purchase.' : `${lines.length === 1 ? 'One part' : `${lines.length} parts`} going into stock.`}
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => setShowPurchaseModal(false)}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>{savingPurchase ? 'Saving…' : `Save Purchase · ₹${money(total)}`}</button>
        </div>
      </form>
    </div></div>
  );
}
