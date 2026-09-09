'use client';

/**
 * The invoice write/edit dialog, lifted out of app/(dashboard)/sales/page.tsx.
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
import { Plus, Minus, X } from 'lucide-react';
import { paise } from '@/lib/money';
import { lineDiscountPercent, lineGross, lineNet, type Totals } from '@/lib/invoice-totals';
import {
  DRAFT_STATUS,
  type Customer,
  type Invoice,
  type InvoiceLine,
  type PartOption,
  type PaymentStatus,
} from '@/lib/sales-types';

export type InvoiceFormModalProps = {
  lines: InvoiceLine[];
  setLines: Dispatch<SetStateAction<InvoiceLine[]>>;
  updateLine: (index: number, patch: Partial<InvoiceLine>) => void;
  invoiceDate: string;
  setInvoiceDate: (value: string) => void;
  customer: string;
  setCustomer: (value: string) => void;
  paymentStatus: PaymentStatus;
  setPaymentStatus: (value: PaymentStatus) => void;
  amountPaid: number;
  setAmountPaid: (value: number) => void;
  discountPercent: number;
  setDiscountPercent: (value: number) => void;
  gstPercent: number;
  setGstPercent: (value: number) => void;
  gstInclusive: boolean;
  setGstInclusive: (value: boolean) => void;
  totals: Totals;
  paidAmount: number;
  newOutstanding: number;
  editingInvoice: Invoice | null;
  setEditingInvoice: Dispatch<SetStateAction<Invoice | null>>;
  editingDraft: boolean;
  invoiceError: string;
  savingInvoice: boolean;
  savingDraft: boolean;
  selectedCustomer: Customer | undefined;
  creditSaleNeedsCustomer: boolean;
  partOptions: PartOption[];
  customers: Customer[];
  placeOfSupply: string;
  halfGstPercent: number;
  supplyKind: 'intra' | 'inter' | 'unknown';
  setShowInvoiceModal: (open: boolean) => void;
  setShowAddCustomer: (open: boolean) => void;
  saveInvoice: (event: FormEvent) => void;
  saveDraftInvoice: () => void;
};

export default function InvoiceFormModal(props: InvoiceFormModalProps) {
  const {
    lines, setLines, updateLine, invoiceDate, setInvoiceDate, customer, setCustomer,
    paymentStatus, setPaymentStatus, amountPaid, setAmountPaid,
    discountPercent, setDiscountPercent, gstPercent, setGstPercent, gstInclusive, setGstInclusive,
    totals, paidAmount, newOutstanding,
    editingInvoice, setEditingInvoice, editingDraft, invoiceError, savingInvoice, savingDraft,
    selectedCustomer, creditSaleNeedsCustomer, partOptions, customers, placeOfSupply, halfGstPercent, supplyKind,
    setShowInvoiceModal, setShowAddCustomer, saveInvoice, saveDraftInvoice,
  } = props;

  const {
    grossSubtotal, itemDiscountTotal, subtotal, discountAmount,
    taxableAmount, gstAmount, netTaxableValue, total,
  } = totals;

  return (
    <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '900px' }} role="dialog" aria-modal="true" aria-labelledby="invoice-modal-title">
      <form onSubmit={saveInvoice}>
        <div className="modal-header">
          <div>
            <h3 id="invoice-modal-title" className="modal-title">{editingInvoice ? `Edit ${editingInvoice.id}` : 'Create Sales Invoice'}</h3>
            {/* No invoice number is shown for a new sale: it is generated inside
                jde_save_sales_invoice on the server and simply is not known until the save
                comes back. An edit shows the real one, which is already in the title. */}
            <div className="text-muted text-sm flex items-center gap-2" style={{ marginTop: '3px', flexWrap: 'wrap' }}>
              <span>Tax invoice under GST</span>
              {placeOfSupply && <><span aria-hidden="true">·</span><span>Place of supply · {placeOfSupply}</span></>}
              {!editingInvoice && <><span aria-hidden="true">·</span><span>Number assigned on save</span></>}
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => { setShowInvoiceModal(false); setEditingInvoice(null); }}>✕</button>
        </div>
        <div className="modal-body flex flex-col gap-4">
          {invoiceError && <div className="alert alert-danger" role="alert">{invoiceError}</div>}

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Customer</label>
              <div className="flex gap-2">
                <select className="form-input form-select" value={customer} onChange={(event) => setCustomer(event.target.value)}><option value="">Walk-in Sale (no customer)</option>{customers.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAddCustomer(true)}>+ New</button>
              </div>
              {/* Both of these are fields on the customer record itself — nothing is inferred. */}
              {selectedCustomer ? (
                <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                  {selectedCustomer.gstin
                    ? <span className="pn-chip">GSTIN {selectedCustomer.gstin}</span>
                    : <span className="text-muted text-sm">No GSTIN on file</span>}
                  {selectedCustomer.address && (
                    <span className="text-muted text-sm truncate" style={{ maxWidth: '260px' }}>{selectedCustomer.address}</span>
                  )}
                </div>
              ) : creditSaleNeedsCustomer ? (
                // Said here, next to the field that fixes it, rather than only on save —
                // being told at the end that the whole form is invalid is the worse version.
                <span className="text-warning text-sm">Not fully paid — this sale needs a named customer before it can be saved.</span>
              ) : (
                <span className="text-muted text-sm">Walk-in sale — billed to the counter, no customer account.</span>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">Invoice Date</label>
              <input type="date" className="form-input" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} />
              <span className="text-muted text-sm">Date the goods leave the counter</span>
            </div>
          </div>

          <div className="table-wrap">
            <div className="tbl-toolbar">
              <div className="tbl-toolbar-title">
                <strong>Line items</strong>
                <small>Pick a part from Inventory — its rate fills in from the catalogue sale price</small>
              </div>
            </div>

            <datalist id="sales-part-options">{partOptions.map((part) => <option key={part.value} value={part.value} />)}</datalist>

            <div style={{ overflowX: 'auto' }}>
              <table className="erp-table" style={{ minWidth: '780px' }}>
                <thead>
                  <tr>
                    <th>Part &amp; Description</th>
                    <th style={{ width: '96px' }}>HSN</th>
                    <th className="text-right" style={{ width: '168px' }}>Qty</th>
                    <th className="text-right" style={{ width: '132px' }}>Rate</th>
                    <th className="text-right" style={{ width: '104px' }}>Disc %</th>
                    <th className="text-right" style={{ width: '150px' }}>Amount</th>
                    <th style={{ width: '54px' }} aria-label="Remove line"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => {
                    const matched = partOptions.find((part) => part.value === line.part);
                    return (
                      <tr key={index}>
                        <td>
                          <input
                            list="sales-part-options"
                            className="form-input"
                            placeholder="Type or scan a part number…"
                            value={line.part}
                            onChange={(event) => { const selected = partOptions.find((part) => part.value === event.target.value); updateLine(index, { part: event.target.value, price: selected?.price ?? line.price }); }}
                          />
                          {/* Brand and stock are read straight off the matched product row. */}
                          {matched && (
                            <div className="flex items-center gap-2 mt-1" style={{ flexWrap: 'wrap' }}>
                              <span className="pn-chip">{matched.partNumber}</span>
                              {matched.brand && <span className="text-muted text-sm">{matched.brand} ·</span>}
                              <span className="text-muted text-sm">{matched.stock} in stock</span>
                            </div>
                          )}
                          {line.part.trim() && !matched && <small className="text-danger">No matching part in Inventory</small>}
                        </td>
                        <td>
                          {matched?.hsn
                            ? <span className="pn-chip">{matched.hsn}</span>
                            : <span className="text-muted">—</span>}
                        </td>
                        <td>
                          {/* A stepper wrapped around the same number input as before: every
                              path here writes through updateLine(index, { qty }), and neither
                              button can take the quantity below one. */}
                          <div className="flex items-center gap-2" style={{ justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              aria-label={`Decrease quantity on line ${index + 1}`}
                              disabled={Number(line.qty) <= 1}
                              onClick={() => updateLine(index, { qty: Math.max(1, Number(line.qty) - 1) })}
                            ><Minus size={12} /></button>
                            <input
                              type="number"
                              min="1"
                              className="form-input"
                              style={{ width: '62px', textAlign: 'center', padding: '7px 6px' }}
                              aria-label={`Quantity on line ${index + 1}`}
                              value={line.qty}
                              onChange={(event) => updateLine(index, { qty: Number(event.target.value) })}
                            />
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              aria-label={`Increase quantity on line ${index + 1}`}
                              onClick={() => updateLine(index, { qty: Math.max(1, Number(line.qty) + 1) })}
                            ><Plus size={12} /></button>
                          </div>
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            className="form-input"
                            style={{ textAlign: 'right' }}
                            aria-label={`Rate on line ${index + 1}`}
                            value={line.price}
                            onChange={(event) => updateLine(index, { price: Number(event.target.value) })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            className="form-input"
                            style={{ textAlign: 'right' }}
                            aria-label={`Discount percent on line ${index + 1}`}
                            value={line.discount ?? 0}
                            onChange={(event) => updateLine(index, { discount: Math.min(100, Math.max(0, Number(event.target.value))) })}
                          />
                        </td>
                        <td className="text-right font-semibold">
                          {lineDiscountPercent(line) > 0 && (
                            <div style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-muted)', textDecoration: 'line-through' }}>
                              ₹{paise(lineGross(line))}
                            </div>
                          )}
                          ₹{paise(lineNet(line))}
                        </td>
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
                    <tr><td colSpan={7}><div className="empty-state" style={{ padding: '28px 20px' }}>
                      <p className="empty-state-title">{partOptions.length === 0 ? 'No parts to sell yet' : 'No lines on this invoice'}</p>
                      <p className="empty-state-desc">{partOptions.length === 0 ? 'Add parts in Inventory before creating an invoice.' : 'Add a line below to start billing.'}</p>
                    </div></td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="pager">
              {partOptions.length > 0
                ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLines((current) => [...current, { part: '', qty: 1, price: 0, discount: 0 }])}><Plus size={14} /> Add line — type or scan a part number</button>
                : <span className="pager-info">Add parts in Inventory before creating an invoice.</span>}
              <div className="pager-info"><strong>{lines.length}</strong> {lines.length === 1 ? 'line' : 'lines'}</div>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="flex flex-col gap-4">
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Whole-invoice discount (%)</label>
                  <input type="number" min="0" max="100" step="0.1" className="form-input" value={discountPercent} onChange={(event) => setDiscountPercent(Math.min(100, Math.max(0, Number(event.target.value))))} />
                  <small className="text-muted">Applied on top of any per-item discounts. Leave at 0 to discount items only.</small>
                  <span className="text-muted text-sm">Applied on the subtotal</span>
                </div>
                <div className="form-group">
                  <label className="form-label">GST Rate (%)</label>
                  <input type="number" min="0" max="28" step="0.1" className="form-input" value={gstPercent} onChange={(event) => setGstPercent(Math.min(28, Math.max(0, Number(event.target.value))))} />
                  <div className="flex gap-2 mt-2" role="group" aria-label="How the rates on the lines are priced">
                    <button
                      type="button"
                      className={'btn btn-sm ' + (gstInclusive ? 'btn-secondary' : 'btn-primary')}
                      onClick={() => setGstInclusive(false)}
                    >GST extra</button>
                    <button
                      type="button"
                      className={'btn btn-sm ' + (gstInclusive ? 'btn-primary' : 'btn-secondary')}
                      onClick={() => setGstInclusive(true)}
                    >GST included</button>
                  </div>
                  {/* States what the typed rates mean, which is the part that is easy to get
                      wrong — the arithmetic below follows from it. */}
                  <span className="text-muted text-sm">
                    {gstInclusive
                      ? 'Line rates already include GST — the tax is taken out of them, and the total is what you typed.'
                      : 'Line rates are before GST — the tax is added on top of them.'}
                  </span>
                  {/* Only claims intra/inter-state when both GSTINs are on file to compare. */}
                  <span className="text-muted text-sm">
                    {supplyKind === 'intra'
                      ? 'Intra-state · CGST + SGST'
                      : supplyKind === 'inter'
                        ? 'Inter-state · IGST'
                        : 'Charged on the taxable value'}
                  </span>
                </div>
              </div>

              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Payment Received</label>
                  <select className="form-input form-select" value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value as PaymentStatus)}>
                    <option value="paid">Paid in Full</option>
                    <option value="partial">Partially Paid</option>
                    <option value="unpaid">Unpaid (Credit)</option>
                  </select>
                </div>
                {paymentStatus === 'partial' && (
                  <div className="form-group"><label className="form-label">Amount Received (₹)</label><input type="number" min="0" max={total} className="form-input" value={amountPaid} onChange={(event) => setAmountPaid(Number(event.target.value))} /></div>
                )}
              </div>
            </div>

            {/* Every figure below is read straight from the totals computed above — nothing
                here is recalculated, and the CGST/SGST or IGST breakdown is a presentation
                of the same gstAmount, never a second sum. */}
            <div className="card" style={{ background: 'var(--surface-2)' }}>
              <div className="report-summary" style={{ maxWidth: 'none', margin: 0, padding: 0, gap: '0' }}>
                {/* Shown only when line discounts are actually in use, so an invoice without
                    them reads exactly as it always did. */}
                {itemDiscountTotal > 0 && (
                  <>
                    <div className="report-line"><span className="text-muted">Gross amount</span><strong>₹{paise(grossSubtotal)}</strong></div>
                    <div className="report-line">
                      <span className="text-muted">Item discounts</span>
                      <strong className="text-danger">-₹{paise(itemDiscountTotal)}</strong>
                    </div>
                  </>
                )}
                <div className="report-line"><span className="text-muted">Subtotal{itemDiscountTotal > 0 ? ' after item discounts' : ''}</span><strong>₹{paise(subtotal)}</strong></div>
                <div className="report-line">
                  <span className="text-muted">Whole-invoice discount ({discountPercent}%)</span>
                  {discountAmount > 0
                    ? <strong className="text-danger">-₹{paise(discountAmount)}</strong>
                    : <strong>₹{paise(0)}</strong>}
                </div>
                {gstInclusive && (
                  <div className="report-line"><span className="text-muted">Amount after discounts (GST included)</span><strong>₹{paise(taxableAmount)}</strong></div>
                )}
                <div className="report-line report-strong"><span>Taxable value</span><strong>₹{paise(netTaxableValue)}</strong></div>
                <div className="report-line">
                  <span className="text-muted">GST ({gstPercent}%){gstInclusive ? ' — included above' : ''}</span>
                  <strong>₹{paise(gstAmount)}</strong>
                </div>
              </div>

              <div className="flex gap-2 mt-2" style={{ flexWrap: 'wrap' }}>
                {supplyKind === 'inter'
                  ? <span className="badge badge-muted">IGST {gstPercent}% · ₹{paise(gstAmount)}</span>
                  : <>
                      <span className="badge badge-muted">CGST {halfGstPercent}% · ₹{paise(gstAmount / 2)}</span>
                      <span className="badge badge-muted">SGST {halfGstPercent}% · ₹{paise(gstAmount / 2)}</span>
                    </>}
              </div>

              <div className="report-line mt-2" style={{ borderBottom: 'none', paddingBottom: 0 }}>
                <span className="text-muted">Received</span>
                <strong className="text-success">₹{paise(paidAmount)}</strong>
              </div>

              <div className="report-total mt-2" style={{ background: 'var(--amber-tint)', borderLeftColor: 'var(--amber)' }}>
                <div>
                  <strong style={{ fontSize: '12.5px', color: 'var(--amber-3)' }}>Total Payable</strong>
                  <small>Inclusive of GST ₹{paise(gstAmount)}</small>
                </div>
                <strong style={{ color: 'var(--amber-3)' }}>₹{paise(total)}</strong>
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <div className="text-muted text-sm" style={{ marginRight: 'auto', maxWidth: '340px' }}>
            {total <= 0
              ? 'Add at least one line to bill this sale.'
              : newOutstanding > 0
                ? <>₹{paise(paidAmount)} received now · <strong>₹{paise(newOutstanding)}</strong> stays outstanding{selectedCustomer ? ` on ${selectedCustomer.name}'s account` : ' on this invoice'}.</>
                : 'Settled in full — nothing will be added to any outstanding balance.'}
            {editingDraft && (
              <div style={{ marginTop: '4px' }}>
                That applies when you confirm it. <strong>Save &amp; Keep as Draft</strong> changes nothing on any account.
              </div>
            )}
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => { setShowInvoiceModal(false); setEditingInvoice(null); }}>Cancel</button>
          {/* Offered on a new sale and on a draft being edited, so a draft can be worked on
              over several sittings. Not offered on a live invoice: that is already billed and
              on a customer's account, and un-billing it here would erase a real debt. */}
          {(!editingInvoice || editingDraft) && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!total || savingInvoice || savingDraft}
              onClick={saveDraftInvoice}
            >
              {savingDraft ? 'Saving…' : editingDraft ? 'Save & Keep as Draft' : 'Save as Draft'}
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={!total || savingInvoice || savingDraft || creditSaleNeedsCustomer}>
            {savingInvoice
              ? 'Saving…'
              : editingInvoice
                ? editingInvoice.status === DRAFT_STATUS
                  ? `Confirm Invoice · ₹${paise(total)}`
                  : `Save Changes · ₹${paise(total)}`
                : `Create Invoice · ₹${paise(total)}`}
          </button>
        </div>
      </form>
    </div></div>
  );
}
