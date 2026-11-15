'use client';

/**
 * The invoice write/edit dialog.
 *
 * Entry used to be: click "Add line", click the part box, type the exact full catalogue label
 * into a native <datalist>, tab across, click "Add line" again. A part number on its own matched
 * nothing, a barcode scanner matched nothing — and worse, a scanner's trailing Enter reached the
 * surrounding <form> and submitted a half-typed invoice.
 *
 * It is now one box at the top: scan or type, Enter, scan or type, Enter. Focus never leaves that
 * box, so parts go on as fast as they can be read off a shelf. Enter is intercepted at the form
 * so it can never submit by accident; Ctrl+Enter is the deliberate save.
 *
 * The rules behind the entry — merging a repeated part into one line, the last rate this customer
 * paid, and the stock and below-cost warnings — live in lib/sale-entry.ts so they can be tested
 * away from the DOM. This file decides how they look, not what they are.
 *
 * Still deliberately presentational for the invoice's own state: every value and setter arrives
 * as a prop and the page owns them. The only state here is what belongs to the act of typing.
 */

import { PLACE_OF_SUPPLY_OPTIONS } from '@/lib/gst-supply';
import { useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import MoneyPicker from '@/components/money/MoneyPicker';
import type { MoneyChoice } from '@/lib/money-book';
import type { BillCreditCheck } from '@/lib/credit';
import { Plus, Minus, X, AlertTriangle, Keyboard } from 'lucide-react';
import { money, paise } from '@/lib/money';
import { lineDiscountPercent, lineGross, lineNet, type Totals } from '@/lib/invoice-totals';
import { addCustomLine, addPartToLines, lineWarnings, partsWithoutRate, type LastSold } from '@/lib/sale-entry';
import { keepEnterInsideForm, SAVE_SHORTCUT_HINT } from '@/lib/form-keys';
import PartPicker from '@/components/PartPicker';
import {
  DRAFT_STATUS,
  type Customer,
  type Invoice,
  type InvoiceLine,
  type PartOption,
  type PaymentStatus,
} from '@/lib/sales-types';
import { DISPATCH_FIELDS, hasDispatch, type InvoiceDispatch } from '@/lib/invoice-dispatch';

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
  companyId: string;
  /** The customer's credit limit against this bill (lib/credit.ts), when they have one. */
  creditCheck?: BillCreditCheck | null;
  moneyChoice: MoneyChoice | null;
  setMoneyChoice: (value: MoneyChoice) => void;
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
  /** The state half of intra-state GST: SGST, or UTGST in a Union Territory (lib/gst-supply.ts). */
  localTax: 'SGST' | 'UTGST';
  /** The place of supply in effect, as a GST state code, and a way to pick another. */
  placeOfSupplyCode: string;
  setPlaceOfSupplyChoice: (code: string) => void;
  /** Dispatch details printed beside the invoice number (lib/invoice-dispatch.ts); all optional. */
  dispatch: InvoiceDispatch;
  setDispatch: Dispatch<SetStateAction<InvoiceDispatch>>;
  /** A line at the top of the form saying what this bill is for, e.g. a job card's parts. */
  notice?: string;
  /** What the selected customer last paid per part, keyed by part label. Empty for a walk-in. */
  lastSold: Map<string, LastSold>;
  setShowInvoiceModal: (open: boolean) => void;
  setShowAddCustomer: (open: boolean) => void;
  saveInvoice: (event: FormEvent) => void;
  saveDraftInvoice: () => void;
};

/** The one question every bill needs answered, as three buttons instead of a drop-down. The values
 *  are the same three the form has always saved. */
const PAID_CHOICES: ReadonlyArray<{ value: PaymentStatus; label: string }> = [
  { value: 'paid', label: 'Paid in full' },
  { value: 'partial', label: 'Part paid' },
  { value: 'unpaid', label: 'Not paid yet' },
];

export default function InvoiceFormModal(props: InvoiceFormModalProps) {
  const {
    lines, setLines, updateLine, invoiceDate, setInvoiceDate, customer, setCustomer,
    paymentStatus, setPaymentStatus, amountPaid, setAmountPaid, companyId, moneyChoice, setMoneyChoice, creditCheck,
    discountPercent, setDiscountPercent, gstPercent, setGstPercent, gstInclusive, setGstInclusive,
    totals, paidAmount, newOutstanding,
    editingInvoice, setEditingInvoice, editingDraft, invoiceError, savingInvoice, savingDraft,
    selectedCustomer, creditSaleNeedsCustomer, partOptions, customers, placeOfSupply, halfGstPercent, supplyKind, localTax,
    placeOfSupplyCode, setPlaceOfSupplyChoice, dispatch, setDispatch, notice,
    lastSold, setShowInvoiceModal, setShowAddCustomer, saveInvoice, saveDraftInvoice,
  } = props;

  const {
    grossSubtotal, itemDiscountTotal, subtotal, discountAmount,
    taxableAmount, gstAmount, netTaxableValue, total,
  } = totals;

  // Which part was put on last, so its row can be picked out of a long invoice. Held as the part
  // label rather than an index: a scanner can fire twice inside one React batch, and an index
  // captured from a stale render would point at the wrong row.
  const [lastAdded, setLastAdded] = useState('');

  const canSubmit = Boolean(total) && !savingInvoice && !savingDraft && !creditSaleNeedsCustomer;

  // Whether "More options" starts open: only on a bill that already uses one of them. Decided once,
  // when the form opens — afterwards it opens and closes only when its heading is pressed, so it
  // never folds shut under someone who has just typed a rate back to the usual one.
  const [moreOpenAtStart] = useState(() => discountPercent > 0 || gstPercent !== 18 || gstInclusive || hasDispatch(dispatch));

  const handlePick = (part: PartOption) => {
    // Functional form for the same reason: two fast scans must both land.
    setLines((current) => addPartToLines(current, part).lines);
    setLastAdded(part.value);
  };

  const handleCustom = (description: string) => {
    setLines((current) => addCustomLine(current, description).lines);
    setLastAdded(description);
  };

  return (
    <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '920px' }} role="dialog" aria-modal="true" aria-labelledby="invoice-modal-title">
      <form onSubmit={saveInvoice} onKeyDown={(event) => keepEnterInsideForm(event, canSubmit)}>
        <div className="modal-header">
          <div>
            <h3 id="invoice-modal-title" className="modal-title">{editingInvoice ? `Edit ${editingInvoice.id}` : 'Make a bill'}</h3>
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
          {notice && <div className="alert alert-warning" role="status">{notice}</div>}
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
            <div className="tbl-toolbar" style={{ display: 'block' }}>
              <div className="tbl-toolbar-title" style={{ marginBottom: '8px' }}>
                <strong>Line items</strong>
                <small>
                  {selectedCustomer
                    ? `Rates fill in from the catalogue — what ${selectedCustomer.name} paid last time is shown beside each part`
                    : 'Rates fill in from the catalogue sale price'}
                </small>
              </div>
              {partOptions.length > 0 ? (
                <PartPicker
                  parts={partOptions}
                  onPick={handlePick}
                  onCustom={handleCustom}
                  lastTraded={lastSold}
                  disabled={savingInvoice || savingDraft}
                  autoFocus
                />
              ) : (
                <span className="text-muted text-sm">Add parts in Stock before creating an invoice.</span>
              )}
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="erp-table" style={{ minWidth: '760px' }}>
                <thead>
                  <tr>
                    <th>Part &amp; Description</th>
                    <th style={{ width: '96px' }}>HSN</th>
                    <th className="text-right" style={{ width: '160px' }}>Qty</th>
                    <th className="text-right" style={{ width: '132px' }}>Rate</th>
                    <th className="text-right" style={{ width: '96px' }}>Disc %</th>
                    <th className="text-right" style={{ width: '150px' }}>Amount</th>
                    <th style={{ width: '54px' }} aria-label="Remove line"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => {
                    const matched = partOptions.find((part) => part.value === line.part);
                    const warnings = lineWarnings(line, matched);
                    const previous = lastSold.get(line.part);
                    return (
                      <tr key={`${line.part}-${index}`} style={line.part === lastAdded ? { background: 'var(--amber-tint)' } : undefined}>
                        <td>
                          {/* The part is chosen in the picker above, so this states what was
                              chosen rather than offering a second, weaker way to search. An
                              invoice reopened for editing can carry a part that has since been
                              renamed or removed, so an unmatched label still shows as itself. */}
                          {matched ? (
                            <>
                              <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                                <span className="pn-chip">{matched.partNumber}</span>
                                <strong style={{ fontSize: '13px' }}>{matched.name}</strong>
                              </div>
                              <div className="flex items-center gap-2 mt-1" style={{ flexWrap: 'wrap' }}>
                                {matched.brand && <span className="text-muted text-sm">{matched.brand}</span>}
                                <span className="text-muted text-sm">{matched.stock} in stock</span>
                                {previous && (
                                  <span className="text-muted text-sm">· last billed at ₹{money(previous.rate)} on {previous.ref}</span>
                                )}
                              </div>
                            </>
                          ) : (
                            <>
                              <strong style={{ fontSize: '13px' }}>{line.part}</strong>
                              <div className="text-muted text-sm mt-1">One-off line — not in Stock, so no stock moves</div>
                            </>
                          )}
                          {warnings.map((warning) => (
                            <div key={warning.kind} className={'line-warning' + (warning.kind === 'stock' ? ' is-stock' : '')}>
                              <AlertTriangle size={12} aria-hidden="true" /> {warning.message}
                            </div>
                          ))}
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
                          {/* One click to charge what this customer was charged last time, which
                              is the question being asked whenever this field is touched. */}
                          {previous && Number(line.price) !== previous.rate && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{ padding: '2px 4px', fontSize: '11px' }}
                              onClick={() => updateLine(index, { price: previous.rate })}
                            >use ₹{money(previous.rate)}</button>
                          )}
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
                      <p className="empty-state-title">{partOptions.length === 0 ? 'No parts to sell yet' : 'Nothing on this invoice yet'}</p>
                      <p className="empty-state-desc">{partOptions.length === 0 ? 'Add parts in Stock before creating an invoice.' : 'Scan a barcode or type a part number in the box above, then press Enter.'}</p>
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
                <strong>{lines.length}</strong> {lines.length === 1 ? 'line' : 'lines'}
                {lines.length > 0 && <> · <strong>{lines.reduce((sum, line) => sum + (Number(line.qty) || 0), 0)}</strong> items</>}
              </div>
            </div>
          </div>

          {/* Under the lines: on the left the one question every bill needs answered, and the
              settings most bills never touch folded away beneath it; on the right, what it comes to. */}
          <div className="form-grid-2">
            <div className="flex flex-col gap-4">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <span className="form-label" id="bill-paid-label">Has the customer paid?</span>
                <div className="pay-how bill-paid-choices" role="group" aria-labelledby="bill-paid-label">
                  {PAID_CHOICES.map((choice) => (
                    <button key={choice.value} type="button" aria-pressed={paymentStatus === choice.value}
                      className={`pay-how-choice${paymentStatus === choice.value ? ' active' : ''}`}
                      onClick={() => setPaymentStatus(choice.value)}>
                      {choice.label}
                    </button>
                  ))}
                </div>
                {paymentStatus === 'partial' && (
                  <div className="form-group" style={{ marginTop: '10px', marginBottom: 0 }}>
                    <label className="form-label" htmlFor="bill-amount-paid">How much did they pay now? (₹)</label>
                    <input id="bill-amount-paid" type="number" min="0" max={total} className="form-input" value={amountPaid} onChange={(event) => setAmountPaid(Number(event.target.value))} />
                  </div>
                )}
              </div>
              {paymentStatus !== 'unpaid' && companyId && (
                <MoneyPicker companyId={companyId} direction="in" value={moneyChoice} onChange={setMoneyChoice} />
              )}

              {/* Discount on the whole bill, the GST rate and how it is read, where the goods go,
                  and the dispatch details printed beside the bill number. Most counter sales
                  change none of them, so they wait here; a bill that already uses one opens with
                  them showing. */}
              <details className="card bill-more" open={moreOpenAtStart || undefined}>
                <summary>
                  More options
                  <span className="text-muted text-sm" style={{ fontWeight: 400 }}> · discount, GST, place of supply, dispatch</span>
                </summary>
                <div className="flex flex-col gap-4" style={{ marginTop: 12 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" htmlFor="bill-discount">Discount on the whole bill (%)</label>
                    <input id="bill-discount" type="number" min="0" max="100" step="0.1" className="form-input" value={discountPercent} onChange={(event) => setDiscountPercent(Math.min(100, Math.max(0, Number(event.target.value))))} />
                    <span className="text-muted text-sm">Taken off after any discount typed on a line. Leave at 0 for none.</span>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" htmlFor="bill-gst">GST Rate (%)</label>
                    <input id="bill-gst" type="number" min="0" max="28" step="0.1" className="form-input" value={gstPercent} onChange={(event) => setGstPercent(Math.min(28, Math.max(0, Number(event.target.value))))} />
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
                        wrong — the arithmetic beside it follows from it. */}
                    <span className="text-muted text-sm">
                      {gstInclusive
                        ? 'Line rates already include GST — the tax is taken out of them, and the total is what you typed.'
                        : 'Line rates are before GST — the tax is added on top of them.'}
                    </span>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    {/* Where the goods go decides the split: another state is IGST. Filled in from the
                        customer's GSTIN, else the shop's state; can be changed for a buyer from
                        elsewhere who has no GSTIN. */}
                    <label className="form-label" htmlFor="place-of-supply">Place of supply</label>
                    <select id="place-of-supply" className="form-input form-select" value={placeOfSupplyCode}
                      onChange={(event) => setPlaceOfSupplyChoice(event.target.value)}>
                      {!placeOfSupplyCode && <option value="">Choose a state</option>}
                      {PLACE_OF_SUPPLY_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.name} ({option.code})</option>)}
                    </select>
                    <span className="text-muted text-sm">
                      {supplyKind === 'intra'
                        ? `Same state · CGST + ${localTax}`
                        : supplyKind === 'inter'
                          ? 'Another state · IGST'
                          : 'Add your GSTIN or state in Settings (Companies → Edit) to know IGST from CGST'}
                    </span>
                  </div>
                  {/* Printed beside the invoice number, as on a Tally invoice. */}
                  <div>
                    <span className="form-label">Dispatch details <span className="text-muted text-sm" style={{ fontWeight: 400 }}>· optional · printed on the invoice</span></span>
                    <div className="form-grid-2" style={{ marginTop: 6 }}>
                      {DISPATCH_FIELDS.map((field) => (
                        <div className="form-group" key={field.key}>
                          <label className="form-label" htmlFor={`dispatch-${field.key}`}>{field.label}</label>
                          <input id={`dispatch-${field.key}`} className="form-input" maxLength={field.max} placeholder={field.placeholder}
                            value={dispatch[field.key]} onChange={(event) => { const value = event.target.value; setDispatch((current) => ({ ...current, [field.key]: value })); }} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </details>
            </div>

            {/* Every figure below is read straight from the totals computed above — nothing
                here is recalculated, and the CGST/SGST or IGST breakdown is a presentation
                of the same gstAmount, never a second sum. A line that would only say zero, or
                repeat the one above it, is left out. */}
            <div className="card" style={{ background: 'var(--surface-2)', alignSelf: 'start' }}>
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
                {discountAmount > 0 && (
                  <div className="report-line">
                    <span className="text-muted">Discount on the whole bill ({discountPercent}%)</span>
                    <strong className="text-danger">-₹{paise(discountAmount)}</strong>
                  </div>
                )}
                {gstInclusive && (
                  <div className="report-line"><span className="text-muted">Amount after discounts (GST included)</span><strong>₹{paise(taxableAmount)}</strong></div>
                )}
                {(discountAmount > 0 || gstInclusive) && (
                  <div className="report-line report-strong"><span>Taxable value</span><strong>₹{paise(netTaxableValue)}</strong></div>
                )}
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
                      <span className="badge badge-muted">{localTax} {halfGstPercent}% · ₹{paise(gstAmount / 2)}</span>
                    </>}
              </div>

              <div className="report-total mt-2" style={{ background: 'var(--amber-tint)', borderLeftColor: 'var(--amber)' }}>
                <div>
                  <strong style={{ fontSize: '12.5px', color: 'var(--amber-3)' }}>Total Payable</strong>
                  <small>Inclusive of GST ₹{paise(gstAmount)}</small>
                </div>
                <strong style={{ color: 'var(--amber-3)' }}>₹{paise(total)}</strong>
              </div>

              <div className="report-line mt-2" style={{ borderBottom: 'none', paddingBottom: 0 }}>
                <span className="text-muted">Received now</span>
                <strong className="text-success">₹{paise(paidAmount)}</strong>
              </div>
            </div>
          </div>
        </div>
        {creditCheck?.limit != null && (creditCheck.over || (creditCheck.usedPercent ?? 0) >= 80) && (
          <div className={`alert ${creditCheck.over ? 'alert-danger' : 'alert-warning'}`} role="status" style={{ margin: '0 20px 12px' }}>
            {creditCheck.over
              ? <>After this bill <strong>{customer}</strong> will owe <strong>₹{paise(creditCheck.after)}</strong> — <strong>₹{paise(creditCheck.overBy)} over</strong> their ₹{paise(creditCheck.limit)} credit limit.</>
              : <>After this bill <strong>{customer}</strong> will owe ₹{paise(creditCheck.after)} — {creditCheck.usedPercent?.toFixed(0)}% of their ₹{paise(creditCheck.limit)} credit limit.</>}
          </div>
        )}
        {/* Stays in view while the lines above scroll, so the total and the button are never hunted for. */}
        <div className="modal-footer modal-footer--sticky">
          <div className="text-muted text-sm" style={{ marginRight: 'auto', maxWidth: '340px' }}>
            {total <= 0
              ? (() => {
                  const unpriced = partsWithoutRate(lines);
                  if (unpriced.length === 0) return 'Scan or type a part above to bill this sale.';
                  const named = unpriced.slice(0, 2).join(', ') + (unpriced.length > 2 ? ` and ${unpriced.length - 2} more` : '');
                  return <span className="text-danger">Type a rate for <strong>{named}</strong> — {unpriced.length === 1 ? 'it has' : 'they have'} no sale price yet, so this bill is ₹0 and cannot be saved.</span>;
                })()
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
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
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
