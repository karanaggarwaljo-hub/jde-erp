'use client';

/**
 * What an uploaded stock and price list is about to do, on one screen, with one button.
 *
 * The import dialog used to open on a question — "What should this file do?" — with three answers,
 * none of which was "update my stock and prices". This opens on the answer instead: how many parts
 * the file updates, how many it adds, and which rows it leaves alone and why. The three older jobs
 * are still there behind "Do something else with this file".
 *
 * The plan itself (lib/stock-sheet.ts) is pure and worked out again on every render from the rows
 * the page already read, so unticking a row or a whole figure re-plans at once without touching
 * the file. Nothing is written until the button is pressed; the page does the writing.
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import type { ImportedProduct } from '@/lib/client-import';
import { money } from '@/lib/money';
import {
  SHEET_FIELDS,
  countSheetOutcomes,
  describeSheetAction,
  fieldsInSheet,
  planSheetUpdate,
  type SheetField,
  type SheetProduct,
  type SheetRowPlan,
} from '@/lib/stock-sheet';

export type StockSheetModalProps = {
  fileName: string;
  rows: ImportedProduct[];
  /** Figures whose column had to be guessed from the numbers, because the heading did not say. */
  guessedFields: string[];
  products: SheetProduct[];
  companyName: string;
  saving: boolean;
  progress: { done: number; total: number };
  error: string;
  onCancel: () => void;
  /** Opens the older dialog: cost prices only, add as new parts, or fill in part numbers. */
  onSomethingElse: () => void;
  onSave: (updates: SheetRowPlan[], additions: ImportedProduct[]) => void;
};

const FIELD_NOTE: Record<SheetField, string> = {
  stock: 'set to the number in the file',
  cost: '',
  sale: '',
  mrp: '',
};

const figure = (field: SheetField, value: number) => (field === 'stock' ? String(value) : `₹${money(value)}`);

const ORDER: Record<SheetRowPlan['outcome'], number> = { unclear: 0, update: 1, new: 2, same: 3 };

export default function StockSheetModal(props: StockSheetModalProps) {
  const { fileName, rows, guessedFields, products, companyName, saving, progress, error, onCancel, onSomethingElse, onSave } = props;

  const offered = useMemo(() => fieldsInSheet(rows), [rows]);
  // Which figures to take from this file. Everything the file has, until the owner unticks one.
  const [skipped, setSkipped] = useState<Set<SheetField>>(new Set());
  // Rows unticked, by row number. Exclusions rather than selections, as in the cost importer: a
  // row that only appears after a figure is ticked again is then included, not silently missed.
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [showSame, setShowSame] = useState(false);

  const fields = useMemo(() => new Set(offered.filter((field) => !skipped.has(field))), [offered, skipped]);
  const plans = useMemo(() => planSheetUpdate(rows, products, fields), [rows, products, fields]);
  const counts = countSheetOutcomes(plans);

  const actionable = plans.filter((plan) => plan.outcome === 'update' || plan.outcome === 'new');
  const chosen = actionable.filter((plan) => !excluded.has(plan.rowNumber));
  const updates = chosen.filter((plan) => plan.outcome === 'update');
  const additions = chosen.filter((plan) => plan.outcome === 'new');
  const allTicked = actionable.length > 0 && chosen.length === actionable.length;

  const toggleRow = (rowNumber: number) => setExcluded((previous) => {
    const next = new Set(previous);
    if (next.has(rowNumber)) next.delete(rowNumber); else next.add(rowNumber);
    return next;
  });
  const toggleAll = () => setExcluded(allTicked ? new Set(actionable.map((plan) => plan.rowNumber)) : new Set());
  const toggleField = (field: SheetField) => setSkipped((previous) => {
    const next = new Set(previous);
    if (next.has(field)) next.delete(field); else next.add(field);
    return next;
  });

  const shown = [...plans]
    .filter((plan) => showSame || plan.outcome !== 'same')
    .sort((a, b) => ORDER[a.outcome] - ORDER[b.outcome] || a.rowNumber - b.rowNumber);

  // Things worth a second look before pressing the button.
  const toZero = updates.filter((plan) => plan.changes.some((change) => change.field === 'stock' && change.to === 0 && change.from > 0)).length;
  const mostlyNew = products.length > 0 && plans.length >= 4 && counts.new > plans.length / 2;
  const nothingToRead = offered.length === 0;

  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: '860px' }} role="dialog" aria-modal="true" aria-labelledby="stock-sheet-title">
        <div className="modal-header">
          <div>
            <h3 id="stock-sheet-title" className="modal-title">Update stock &amp; prices</h3>
            <p className="text-muted text-sm" style={{ marginTop: '3px' }}>From {fileName}. Nothing is saved until you press the button below.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Close" disabled={saving} onClick={onCancel}>✕</button>
        </div>

        <div className="modal-body flex flex-col gap-3">
          {error && <div className="alert alert-danger" role="alert">{error}</div>}

          {/* The answer first: what this file does. */}
          <div className="sheet-summary">
            <div className="sheet-summary-figure">
              <strong>{updates.length}</strong>
              <span>{updates.length === 1 ? 'part' : 'parts'} to update</span>
            </div>
            <div className="sheet-summary-figure">
              <strong>{additions.length}</strong>
              <span>new {additions.length === 1 ? 'part' : 'parts'} to add</span>
            </div>
            <div className="sheet-summary-figure is-quiet">
              <strong>{counts.same}</strong>
              <span>already the same</span>
            </div>
            {counts.unclear > 0 && (
              <div className="sheet-summary-figure is-warn">
                <strong>{counts.unclear}</strong>
                <span>left alone</span>
              </div>
            )}
          </div>

          {nothingToRead ? (
            <div className="alert alert-warning" role="status">
              No stock or price column could be read from this file, so there is nothing to update from it.
              Use <strong>Do something else with this file</strong> below to add its rows as new parts or fill in part numbers.
            </div>
          ) : (
            <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }} role="group" aria-label="What to take from this file">
              <span className="form-label" style={{ margin: 0 }}>Take from this file:</span>
              {SHEET_FIELDS.filter((entry) => offered.includes(entry.field)).map((entry) => (
                <label key={entry.field} className="flex items-center gap-2" style={{ cursor: saving ? 'default' : 'pointer', fontSize: '13.5px' }}>
                  <input type="checkbox" checked={!skipped.has(entry.field)} disabled={saving} onChange={() => toggleField(entry.field)} />
                  <span>{entry.label}{FIELD_NOTE[entry.field] && <span className="text-muted"> ({FIELD_NOTE[entry.field]})</span>}</span>
                </label>
              ))}
            </div>
          )}

          {guessedFields.length > 0 && (
            <div className="alert alert-warning" role="status">
              <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: '1px' }} />
              <span>The headings in this file did not clearly say which column is the {guessedFields.join(', ')}, so {guessedFields.length === 1 ? 'that was' : 'those were'} worked out from the numbers. Check a few rows below before saving.</span>
            </div>
          )}
          {mostlyNew && (
            <div className="alert alert-warning" role="status">
              <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: '1px' }} />
              <span>Most rows match no part in <strong>{companyName || 'this company'}</strong>, so they would be added as new parts. If this list belongs to another company, switch to it first.</span>
            </div>
          )}
          {toZero > 0 && (
            <div className="alert alert-warning" role="status">
              <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: '1px' }} />
              <span>{plural(toZero, 'part')} will be set to <strong>0 in stock</strong>. Untick Stock above if the quantity column in this file is not your stock count.</span>
            </div>
          )}

          <div style={{ maxHeight: '340px', overflow: 'auto' }} className="table-wrap">
            <table className="erp-table">
              <thead>
                <tr>
                  <th style={{ width: '34px' }}>
                    <input
                      type="checkbox"
                      aria-label={allTicked ? 'Untick every row' : 'Tick every row'}
                      checked={allTicked}
                      disabled={saving || actionable.length === 0}
                      ref={(element) => { if (element) element.indeterminate = chosen.length > 0 && !allTicked; }}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>Part</th>
                  <th>What happens</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((plan) => {
                  const canTick = plan.outcome === 'update' || plan.outcome === 'new';
                  const off = canTick && excluded.has(plan.rowNumber);
                  const name = plan.product?.name ?? plan.row.name;
                  const number = plan.product?.part_number ?? plan.row.part_number;
                  const brand = plan.product?.brand ?? plan.row.brand;
                  return (
                    <tr key={plan.rowNumber} style={off ? { opacity: 0.45 } : undefined}>
                      <td>
                        {canTick && (
                          <input type="checkbox" aria-label={`Include ${name}`} checked={!off} disabled={saving} onChange={() => toggleRow(plan.rowNumber)} />
                        )}
                      </td>
                      <td>
                        <strong style={{ fontSize: '13px' }}>{name}</strong>
                        <div className="text-muted" style={{ fontSize: '11.5px' }}>
                          {[number, brand].filter(Boolean).join(' · ') || 'no part number'}
                          {plan.outcome !== 'new' && plan.matchedBy && plan.matchedBy !== 'part number' ? ` · found by its ${plan.matchedBy}` : ''}
                        </div>
                      </td>
                      <td>
                        {plan.outcome === 'update' && (
                          <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                            {plan.changes.map((change) => (
                              <span key={change.field} className="sheet-change">
                                {SHEET_FIELDS.find((entry) => entry.field === change.field)?.label}{' '}
                                <span className="text-muted">{figure(change.field, change.from)}</span>
                                <ArrowRight size={12} aria-label="becomes" />
                                <strong>{figure(change.field, change.to)}</strong>
                              </span>
                            ))}
                          </div>
                        )}
                        {plan.outcome === 'new' && (
                          <span>
                            <span className="badge badge-success">New part</span>{' '}
                            <span className="text-muted" style={{ fontSize: '12px' }}>
                              {[
                                `${plan.row.current_stock} in stock`,
                                plan.row.cost_price > 0 ? `cost ₹${money(plan.row.cost_price)}` : '',
                                plan.row.sale_price > 0 ? `sells at ₹${money(plan.row.sale_price)}` : 'no sale price',
                              ].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                        )}
                        {plan.outcome === 'same' && <span className="text-muted" style={{ fontSize: '12px' }}>Nothing to change: {plan.reason}</span>}
                        {plan.outcome === 'unclear' && <span className="text-warning" style={{ fontSize: '12.5px' }}>Left alone: {plan.reason}</span>}
                      </td>
                    </tr>
                  );
                })}
                {shown.length === 0 && (
                  <tr><td colSpan={3}><div className="empty-state" style={{ padding: '24px 20px' }}>
                    <p className="empty-state-title">{plans.length === 0 ? 'No rows could be read from this file' : 'Nothing to change'}</p>
                    <p className="empty-state-desc">{plans.length === 0 ? 'Check that it has a heading row with the part number or name.' : `All ${plural(counts.same, 'row')} already match what you have.`}</p>
                  </div></td></tr>
                )}
              </tbody>
            </table>
          </div>

          {counts.same > 0 && (
            <label className="flex items-center gap-2 text-muted" style={{ fontSize: '12.5px', cursor: 'pointer' }}>
              <input type="checkbox" checked={showSame} onChange={() => setShowSame((current) => !current)} />
              Show the {plural(counts.same, 'row')} already the same
            </label>
          )}
        </div>

        <div className="modal-footer modal-footer--sticky">
          <button type="button" className="btn btn-ghost" style={{ marginRight: 'auto' }} disabled={saving} onClick={onSomethingElse}
            title="Only correct cost prices, add every row as a new part, or fill in part numbers">
            Do something else with this file
          </button>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={saving || chosen.length === 0}
            onClick={() => onSave(updates, additions.map((plan) => plan.row))}>
            {saving
              ? `Saving ${progress.done} of ${progress.total}…`
              : chosen.length === 0
                ? (actionable.length === 0 ? 'Nothing to save' : 'Nothing ticked')
                : describeSheetAction(updates.length, additions.length)}
          </button>
        </div>
      </div>
    </div>
  );
}
