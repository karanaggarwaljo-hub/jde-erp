'use client';

/**
 * The supplier-return dialog, lifted out of app/(dashboard)/purchases/page.tsx.
 *
 * Deliberately presentational: every value and every setter arrives as a prop, and the page still
 * owns the state. That keeps this a pure move with no behaviour change — the compiler checks each
 * prop is supplied and correctly typed, which is the only safety net available for a screen with
 * no automated UI coverage and money running through it.
 *
 * The long prop list is the honest shape of the thing rather than a smell to hide: it is exactly
 * what the dialog reads from the page, and it is the map for later moving that state in here.
 * `formatDay` comes in the same way, because the page's order table still uses it too.
 */

import type { PoItem, PurchaseOrder } from '@/lib/purchase-types';

export type SupplierReturnModalProps = {
  returningOrder: PurchaseOrder;
  returnError: string;
  returnableItems: PoItem[];
  returnQuantities: Record<string, number>;
  /** How much of each line is still left to send back, straight from the database. Null while it
   *  is being checked — which is why nothing can be typed in until it arrives. */
  returnableQtyByPoItemId: Record<string, number> | null;
  loadingReturnAvailability: boolean;
  updateReturnQuantity: (poItemId: string, value: string) => void;
  returnNote: string;
  setReturnNote: (value: string) => void;
  selectedReturnLines: { item: PoItem; qty: number }[];
  returnTotal: number;
  hasInvalidReturnQuantity: boolean;
  savingReturn: boolean;
  setReturningOrder: (order: PurchaseOrder | null) => void;
  submitPurchaseReturn: () => void;
  formatDay: (iso: string) => string;
};

export default function SupplierReturnModal(props: SupplierReturnModalProps) {
  const {
    returningOrder, returnError, returnableItems, returnQuantities, returnableQtyByPoItemId,
    loadingReturnAvailability, updateReturnQuantity, returnNote, setReturnNote,
    selectedReturnLines, returnTotal, hasInvalidReturnQuantity,
    savingReturn, setReturningOrder, submitPurchaseReturn, formatDay,
  } = props;

  return (
    <div className="modal-overlay"><div className="modal-box" style={{ maxWidth: '820px' }} role="dialog" aria-modal="true" aria-labelledby="purchase-return-title">
    <div className="modal-header"><h3 id="purchase-return-title" className="modal-title">Return items to {returningOrder.supplier}</h3><button type="button" className="btn btn-ghost btn-sm" aria-label="Close" disabled={savingReturn} onClick={() => setReturningOrder(null)}>✕</button></div>
    <div className="modal-body flex flex-col gap-4">
      {returnError && <div className="alert alert-danger" role="alert">{returnError}</div>}
      <div className="card card-sm bg-surface" style={{ padding: '12px' }}>
        <p style={{ fontSize: '13px', margin: 0 }}><strong>{returningOrder.id}</strong> · received {formatDay(returningOrder.date)} · original total ₹{Number(returningOrder.total).toLocaleString()}</p>
        <p className="text-muted" style={{ fontSize: '12px', margin: '6px 0 0' }}>{loadingReturnAvailability ? 'Checking what is still available from this purchase…' : 'Only enter items actually sent back. Saving reduces stock and the supplier payable together. If this purchase was already paid, the lower payable becomes supplier credit.'}</p>
      </div>
      <div className="table-wrap">
        <div className="tbl-toolbar">
          <div className="tbl-toolbar-title">
            <strong>Items on {returningOrder.id}</strong>
            <small>Available is what is still left to send back from this purchase</small>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="erp-table">
            <thead><tr><th>Item</th><th>Part #</th><th className="text-right">Purchased</th><th className="text-right">Available</th><th className="text-right">Unit cost</th><th style={{ minWidth: '150px' }} className="text-right">Return now</th></tr></thead>
            <tbody>{returnableItems.map((item) => {
              const selected = Number(returnQuantities[item.id] ?? 0);
              const availableQty = Number(returnableQtyByPoItemId?.[item.id] ?? 0);
              const invalid = selected > availableQty || selected < 0 || !Number.isFinite(selected);
              return <tr key={item.id} style={invalid ? { background: 'var(--color-danger-bg)' } : undefined}>
                <td style={{ fontWeight: 600 }}>{item.name}</td><td className="text-muted">{item.part_number || '—'}</td><td className="text-right">{Number(item.qty)}</td><td className="text-right">{returnableQtyByPoItemId === null ? '—' : availableQty}</td><td className="text-right">₹{Number(item.unit_cost).toLocaleString()}</td>
                <td><input type="number" min="0" max={availableQty} step="0.01" className="form-input text-right" aria-label={`Return quantity for ${item.name}`} value={returnQuantities[item.id] ?? 0} disabled={savingReturn || returnableQtyByPoItemId === null} onChange={(event) => updateReturnQuantity(item.id, event.target.value)} /></td>
              </tr>;
            })}
            {returnableItems.length === 0 && <tr><td colSpan={6}><div className="empty-state"><p className="empty-state-title">No returnable item lines found</p><p className="empty-state-desc">This older purchase has no linked PO lines, so it cannot be safely returned.</p></div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Reason / supplier reference <span className="text-muted">(optional)</span></label>
        <textarea className="form-input" rows={3} maxLength={1000} placeholder="Example: damaged seal kit, supplier RMA 123" value={returnNote} disabled={savingReturn} onChange={(event) => setReturnNote(event.target.value)} />
      </div>
      <div className="flex justify-between items-center invoice-summary">
        <span className="text-muted">{selectedReturnLines.length} selected line{selectedReturnLines.length === 1 ? '' : 's'}</span>
        <div><strong>Supplier return total: </strong><span className="invoice-total">₹{returnTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
      </div>
    </div>
    <div className="modal-footer"><button type="button" className="btn btn-secondary" disabled={savingReturn} onClick={() => setReturningOrder(null)}>Cancel</button><button type="button" className="btn btn-primary" disabled={savingReturn || loadingReturnAvailability || returnableQtyByPoItemId === null || selectedReturnLines.length === 0 || hasInvalidReturnQuantity || returnableItems.length === 0} onClick={submitPurchaseReturn}>{savingReturn ? 'Recording…' : loadingReturnAvailability ? 'Checking stock…' : 'Review & Record Return'}</button></div>
    </div></div>
  );
}
