'use client';

/**
 * The "Record Purchase from File" review dialog, lifted out of app/(dashboard)/purchases/page.tsx.
 *
 * Deliberately presentational: every value and every setter arrives as a prop, and the page still
 * owns the state — including the reading of the file, the matching against Inventory and the save.
 * That keeps this a pure move with no behaviour change, which matters most here: this is the
 * screen where a scanned supplier document turns into stock and a supplier balance. The compiler
 * checking each prop is supplied and correctly typed is the only safety net available, since there
 * is no automated UI coverage.
 *
 * The long prop list is the honest shape of the thing rather than a smell to hide: it is exactly
 * what the dialog reads from the page, and it is the map for later moving that state in here.
 */

import type { Dispatch, SetStateAction } from 'react';
import type { ImportedLine } from '@/lib/client-import';
import { FileText } from 'lucide-react';
import { money } from '@/lib/money';
import {
  NEW_PART,
  type ImportLineReview,
  type ImportPreview,
  type PartOption,
  type PaymentStatus,
  type Supplier,
} from '@/lib/purchase-types';

/** The identifiers a supplier document prints alongside each line. Shown on the review screen so
 *  what the scan read can be checked, and typed in when it read nothing. */
const IMPORT_IDENTIFIERS: { field: 'part_number' | 'hsn_code' | 'oem_number' | 'brand'; label: string }[] = [
  { field: 'part_number', label: 'Part no' },
  { field: 'hsn_code', label: 'HSN' },
  { field: 'oem_number', label: 'OEM no' },
  { field: 'brand', label: 'Brand' },
];

export type ImportReviewModalProps = {
  importPreview: ImportPreview;
  setImportPreview: (preview: ImportPreview | null) => void;
  importedPreviewTotal: number;
  importReviews: ImportLineReview[];
  updateImportedLine: (index: number, patch: Partial<ImportedLine>) => void;
  /** Line index -> the part the owner linked it to, or NEW_PART for "keep this separate". */
  importLinks: Record<number, string>;
  setImportLinks: Dispatch<SetStateAction<Record<number, string>>>;
  importNewPartCount: number;
  importPriceChangeCount: number;
  importWarningCount: number;
  importUndecidedCount: number;
  importFillCount: number;
  importHasInvalidLine: boolean;
  importPaymentStatus: PaymentStatus;
  setImportPaymentStatus: (value: PaymentStatus) => void;
  importAmountPaid: number;
  setImportAmountPaid: (value: number) => void;
  importPaidAmount: number;
  partOptions: PartOption[];
  supplierOptions: string[];
  suppliers: Supplier[];
  importError: string;
  confirmingImport: boolean;
  confirmImportedPO: () => void;
};

export default function ImportReviewModal(props: ImportReviewModalProps) {
  const {
    importPreview, setImportPreview, importedPreviewTotal, importReviews, updateImportedLine,
    importLinks, setImportLinks,
    importNewPartCount, importPriceChangeCount, importWarningCount, importUndecidedCount,
    importFillCount, importHasInvalidLine,
    importPaymentStatus, setImportPaymentStatus, importAmountPaid, setImportAmountPaid,
    importPaidAmount,
    partOptions, supplierOptions, suppliers,
    importError, confirmingImport, confirmImportedPO,
  } = props;

  return (
    <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '880px' }} role="dialog" aria-modal="true" aria-labelledby="import-preview-title">
    <div className="modal-header"><h3 id="import-preview-title" className="modal-title">Record Purchase from File</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" disabled={confirmingImport} onClick={() => { setImportPreview(null); setImportLinks({}); }}>✕</button></div>
    <div className="modal-body flex flex-col gap-4">
      {importError && <div className="alert alert-danger" role="alert">{importError}</div>}

      <div className="flex justify-between items-center gap-3" style={{ flexWrap: 'wrap' }}>
        <div className="flex items-center gap-3">
          <div className="kpi-icon-wrap" style={{ '--kpi-color': 'var(--chart-amber)', '--kpi-color-bg': 'var(--amber-tint)' } as React.CSSProperties}><FileText size={18} /></div>
          <div>
            <strong style={{ fontSize: '13.5px' }}>{importPreview.fileName}</strong>
            <p className="text-muted" style={{ fontSize: '12px' }}>
              Read <strong>{importPreview.lines.length} item(s)</strong>, total ₹{money(importedPreviewTotal)}
            </p>
          </div>
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <span className="badge badge-success">{importPreview.lines.length - importNewPartCount} matched</span>
          {importNewPartCount > 0 && <span className="badge badge-warning">{importNewPartCount} new part{importNewPartCount === 1 ? '' : 's'}</span>}
          {importPriceChangeCount > 0 && <span className="badge badge-warning">{importPriceChangeCount} price check{importPriceChangeCount === 1 ? '' : 's'}</span>}
          {importWarningCount > 0 && <span className="badge badge-danger">{importWarningCount} review warning{importWarningCount === 1 ? '' : 's'}</span>}
        </div>
      </div>

      <p className="text-muted" style={{ fontSize: '12px' }}>
        Exact matches are attached to existing inventory. Unmatched rows create a new part when saved; review those carefully before continuing.
      </p>
      <div className="form-group">
        <label className="form-label">Supplier</label>
        <input list="purchase-supplier-options" className="form-input" placeholder="Type or select a supplier" value={importPreview.supplier} onChange={(event) => setImportPreview({ ...importPreview, supplier: event.target.value })} />
        <datalist id="purchase-supplier-options">{supplierOptions.map((s) => <option key={s} value={s} />)}</datalist>
        {importPreview.supplier.trim() && !suppliers.some((supplier) => supplier.name.toLowerCase() === importPreview.supplier.trim().toLowerCase()) && (
          <small className="text-warning">New supplier — this name will be created when you record the purchase.</small>
        )}
        {importPreview.supplierGstin.trim() && (
          <small style={{ color: 'var(--text-muted)' }}>
            GSTIN read from document: {importPreview.supplierGstin.trim()} — saved against this supplier if it&apos;s a new one.
          </small>
        )}
      </div>

      {/* The supplier's own number for this bill. Worth a field of its own rather than being
          buried: it is the only thing that can recognise this same bill arriving again, re-typed
          or re-photographed, since the file check only catches the identical file. */}
      <div className="form-group">
        <label className="form-label" htmlFor="import-bill-no">Supplier&apos;s bill number</label>
        <input
          id="import-bill-no"
          className="form-input"
          placeholder="As printed on the bill — leave blank if it has none"
          value={importPreview.supplierInvoiceNo}
          onChange={(event) => setImportPreview({ ...importPreview, supplierInvoiceNo: event.target.value })}
        />
        <small style={{ color: 'var(--text-muted)' }}>
          {importPreview.supplierInvoiceNo.trim()
            ? 'This bill cannot then be recorded twice for this supplier.'
            : 'Without it, the same bill typed in again would be recorded as a second purchase.'}
        </small>
      </div>

      {/* Exactly what was read out of the file — nothing added, nothing rounded away — so it
          can be checked, and corrected, before it becomes stock and a supplier balance. */}
      <datalist id="import-part-options">{partOptions.map((option) => <option key={option.value} value={option.value} />)}</datalist>

      <div className="table-wrap">
        <div className="tbl-toolbar">
          <div className="tbl-toolbar-title">
            <strong>Review imported items</strong>
            <small>Edit a row to correct it before saving — a red row must be fixed first. Part no, HSN, OEM and brand are read from the document; fill in anything blank.</small>
          </div>
        </div>

        <div style={{ overflowX: 'auto', maxHeight: '330px', overflowY: 'auto' }}>
          <table className="erp-table">
            <thead><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Unit cost (₹)</th><th className="text-right">Amount (₹)</th><th>Inventory match / review</th></tr></thead>
            <tbody>{importPreview.lines.map((line, index) => {
              const review = importReviews[index];
              const suggestion = review?.match.kind === 'suggested' ? review.match.product : null;
              const isInvalid = !line.description.trim() || line.quantity <= 0 || line.unit_price <= 0;
              return <tr key={index} style={isInvalid ? { background: 'var(--color-danger-bg)' } : undefined}>
                <td style={{ minWidth: '250px' }}>
                  <input list="import-part-options" className="form-input" aria-label={`Item ${index + 1}`} value={line.description} disabled={confirmingImport} onChange={(event) => updateImportedLine(index, { description: event.target.value })} />
                  {/* These are what let the next invoice from any supplier recognise this
                      same part, whoever's name it is printed under, so they are worth
                      checking now — while the document is still in front of you. */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginTop: '4px' }}>
                    {IMPORT_IDENTIFIERS.map(({ field, label }) => (
                      <input key={field} className="form-input" style={{ fontSize: '12px', padding: '4px 6px' }}
                        placeholder={label} aria-label={`${label} for item ${index + 1}`}
                        value={line[field] ?? ''} disabled={confirmingImport}
                        onChange={(event) => updateImportedLine(index, { [field]: event.target.value })} />
                    ))}
                  </div>
                </td>
                <td style={{ minWidth: '82px' }}><input type="number" min="1" className="form-input text-right" aria-label={`Quantity for item ${index + 1}`} value={line.quantity} disabled={confirmingImport} onChange={(event) => updateImportedLine(index, { quantity: Number(event.target.value) })} /></td>
                <td style={{ minWidth: '118px' }}><input type="number" min="0.01" step="0.01" className="form-input text-right" aria-label={`Unit cost for item ${index + 1}`} value={line.unit_price} disabled={confirmingImport} onChange={(event) => updateImportedLine(index, { unit_price: Number(event.target.value) })} /></td>
                <td className="text-right font-semibold">₹{money(line.quantity * line.unit_price)}</td>
                <td style={{ minWidth: '300px' }}>
                  {review?.needsDecision && review.match.kind === 'suggested' ? (
                    // Deliberately unresolved until the owner says so: the names only look
                    // alike, and guessing wrong puts this stock on the wrong part.
                    <div>
                      <span className="badge badge-warning">Same part?</span>
                      <div style={{ fontSize: '12px', marginTop: '3px' }}>
                        <strong>{review.match.product.part_number}</strong> — {review.match.product.name}
                        <div className="text-muted">Already in stock: {review.match.product.current_stock} · {review.match.reason}</div>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', marginTop: '5px' }}>
                        <button type="button" className="btn btn-sm btn-primary" disabled={confirmingImport}
                          onClick={() => setImportLinks((current) => ({ ...current, [index]: suggestion?.id ?? NEW_PART }))}>
                          Same part
                        </button>
                        <button type="button" className="btn btn-sm btn-secondary" disabled={confirmingImport}
                          onClick={() => setImportLinks((current) => ({ ...current, [index]: NEW_PART }))}>
                          Different part
                        </button>
                      </div>
                    </div>
                  ) : review?.matchedProduct ? (
                    <div>
                      <span className="badge badge-success">{importLinks[index] ? 'Linked by you' : 'Matched'}</span>{' '}
                      <strong style={{ fontSize: '12px' }}>{review.matchedProduct.part_number}</strong>
                      <div className="text-muted" style={{ fontSize: '12px', marginTop: '3px' }}>
                        {review.matchedProduct.name}
                        {review.match.kind === 'exact' && !importLinks[index] ? ` · ${review.match.reason}` : ''}
                      </div>
                      {importLinks[index] && importLinks[index] !== NEW_PART && (
                        <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '0', fontSize: '11px' }} disabled={confirmingImport}
                          onClick={() => setImportLinks((current) => ({ ...current, [index]: NEW_PART }))}>
                          Undo — make it a new part
                        </button>
                      )}
                    </div>
                  ) : <span className="badge badge-warning">New part</span>}
                  {review && review.fills.length > 0 && (
                    <div className="text-success" style={{ fontSize: '12px', marginTop: '4px' }}>
                      Will fill in from this invoice: {review.fills.join(', ')}
                    </div>
                  )}
                  {review?.conflicts.map((conflict) => <div key={conflict} className="text-warning" style={{ fontSize: '12px', marginTop: '4px' }}>{conflict}</div>)}
                  {review?.warnings.map((warning) => <div key={warning} className={warning.includes('must be') ? 'text-danger' : 'text-warning'} style={{ fontSize: '12px', marginTop: '4px' }}>{warning}</div>)}
                </td>
              </tr>;
            })}</tbody>
          </table>
        </div>

        <div className="pager">
          <div className="pager-info"><strong>{importPreview.lines.length}</strong> {importPreview.lines.length === 1 ? 'line item' : 'line items'}</div>
          <div className="pager-info">Total <strong>₹{money(importedPreviewTotal)}</strong></div>
        </div>
      </div>

      {importHasInvalidLine && <div className="alert alert-danger" role="alert">Fix the red rows before recording this purchase.</div>}
      {importUndecidedCount > 0 && (
        <div className="alert alert-warning" role="alert">
          {importUndecidedCount === 1 ? 'One item looks' : `${importUndecidedCount} items look`} like {importUndecidedCount === 1 ? 'a part' : 'parts'} you already stock under a different name.
          Choose <strong>Same part</strong> or <strong>Different part</strong> for each — otherwise a duplicate part gets created.
        </div>
      )}

      <div className="form-grid-2">
        <div className="form-group">
          <label className="form-label" htmlFor="import-payment-status">Payment to Supplier</label>
          <select id="import-payment-status" className="form-input form-select" value={importPaymentStatus} disabled={confirmingImport}
            onChange={(event) => setImportPaymentStatus(event.target.value as PaymentStatus)}>
            <option value="paid">Paid in Full</option>
            <option value="partial">Partially Paid</option>
            <option value="unpaid">Unpaid (Credit)</option>
          </select>
        </div>
        {importPaymentStatus === 'partial' && (
          <div className="form-group">
            <label className="form-label" htmlFor="import-amount-paid">Amount Paid (₹)</label>
            <input id="import-amount-paid" type="number" min="0" max={importedPreviewTotal} className="form-input" value={importAmountPaid}
              disabled={confirmingImport} onChange={(event) => setImportAmountPaid(Number(event.target.value))} />
          </div>
        )}
      </div>

      <div className="flex justify-between items-center invoice-summary">
        <div><span className="text-muted">Paid: </span><strong className="text-success">₹{money(importPaidAmount)}</strong></div>
        <div><span className="text-muted">Balance to supplier: </span><strong className={importedPreviewTotal - importPaidAmount > 0 ? 'text-danger' : 'text-muted'}>₹{money(importedPreviewTotal - importPaidAmount)}</strong></div>
        <div><strong>Total: </strong><span className="invoice-total">₹{money(importedPreviewTotal)}</span></div>
      </div>

      <p className="text-muted" style={{ fontSize: '12px' }}>
        Anything here that isn&apos;t already in Inventory is added as a new part when you record this purchase.
        {importFillCount > 0 && ' Blank details on parts you already stock will be filled in from this invoice; anything you entered yourself is left alone.'}
      </p>
    </div>
    <div className="modal-footer"><button type="button" className="btn btn-secondary" disabled={confirmingImport} onClick={() => { setImportPreview(null); setImportLinks({}); }}>Cancel</button><button type="button" className="btn btn-primary" onClick={confirmImportedPO} disabled={!importPreview.supplier.trim() || importHasInvalidLine || importUndecidedCount > 0 || confirmingImport}>{confirmingImport ? 'Saving…' : `Record Purchase${importWarningCount > 0 ? ' After Review' : ''}`}</button></div>
    </div></div>
  );
}
