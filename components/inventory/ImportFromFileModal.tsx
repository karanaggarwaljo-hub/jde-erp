'use client';

/**
 * The "import from file" dialog, lifted out of app/(dashboard)/inventory/page.tsx.
 *
 * One chosen file, three jobs it can be put to — correct cost prices, add parts that aren't
 * stocked yet, or fill in real part numbers and other details — with a full preview of what each
 * would change before anything is written. All three previews are worked out here on every render
 * from the sheet the page has already read, which is what lets the owner switch between the jobs,
 * or change which column means what, without re-uploading.
 *
 * Deliberately presentational: every value and every setter arrives as a prop, the page still owns
 * the state, and the three "apply" calls that actually write to the database still live there. That
 * keeps this a pure move with no behaviour change — the compiler checks each prop is supplied and
 * correctly typed, which is the only safety net available for a screen with no automated UI
 * coverage that nobody can sign into and click through here.
 *
 * The long prop list is the honest shape of the thing rather than a smell to hide: it is exactly
 * what the dialog reads from the page, and it is the map for later moving that state in here.
 */

import type { Dispatch, SetStateAction } from 'react';
import type { Company } from '@/components/CompanyProvider';
import { money } from '@/lib/money';
import { extractCostRows, sampleColumnValues, type ImportedProduct } from '@/lib/client-import';
import { planCostUpdates, countOutcomes, findExistingProduct, type CostMatch } from '@/lib/cost-import';
import { planDetailUpdates, countDetailOutcomes, fieldsToWrite, type DetailChange } from '@/lib/detail-import';
import type { CostSheetImport, ImportMode, Product } from '@/lib/inventory-types';

export type ImportFromFileModalProps = {
  costSheet: CostSheetImport;
  setCostSheet: (sheet: CostSheetImport | null) => void;
  products: Product[];
  activeCompany: Company | null;
  importMode: ImportMode;
  setImportMode: (mode: ImportMode) => void;
  costColumn: string;
  setCostColumn: (column: string) => void;
  idColumn: string;
  setIdColumn: (column: string) => void;
  /** Rows and fields the owner has UNticked, rather than the ones they have ticked: anything that
   *  appears after changing a column is then offered by default instead of silently skipped. */
  excludedRows: Set<number>;
  setExcludedRows: Dispatch<SetStateAction<Set<number>>>;
  excludedNew: Set<number>;
  setExcludedNew: Dispatch<SetStateAction<Set<number>>>;
  excludedDetails: Set<string>;
  setExcludedDetails: Dispatch<SetStateAction<Set<string>>>;
  applyingCosts: boolean;
  costProgress: number;
  importError: string;
  applyCostPlan: (pending: CostMatch[]) => void;
  applyNewParts: (chosen: ImportedProduct[]) => void;
  applyDetailPlan: (pending: { productId: string; patch: Record<string, string>; name: string }[]) => void;
};

export default function ImportFromFileModal(props: ImportFromFileModalProps) {
  const {
    costSheet, setCostSheet, products, activeCompany,
    importMode, setImportMode, costColumn, setCostColumn, idColumn, setIdColumn,
    excludedRows, setExcludedRows, excludedNew, setExcludedNew, excludedDetails, setExcludedDetails,
    applyingCosts, costProgress, importError,
    applyCostPlan, applyNewParts, applyDetailPlan,
  } = props;

        const sheet = costSheet.sheet;
        // Re-derived on every render, so changing either dropdown immediately re-plans against
        // the same already-read sheet — no re-upload, no stale preview.
        const parsed = costColumn && idColumn ? extractCostRows(sheet, costColumn, idColumn) : null;
        const matches = parsed ? planCostUpdates(parsed.rows, products) : [];
        const counts = countOutcomes(matches);
        const updatable = matches.filter((m) => m.outcome === 'update' && m.product);
        const pending = updatable.filter((m) => !excludedRows.has(m.row.rowNumber));
        const allTicked = updatable.length > 0 && pending.length === updatable.length;
        const toggleRow = (rowNumber: number) =>
          setExcludedRows((previous) => {
            const next = new Set(previous);
            if (next.has(rowNumber)) next.delete(rowNumber);
            else next.add(rowNumber);
            return next;
          });
        const toggleAll = () =>
          setExcludedRows(allTicked ? new Set(updatable.map((m) => m.row.rowNumber)) : new Set());
        // Anything that will not be applied is listed first: the point of this screen is to show
        // what the file failed to do, not to bury it under a long list of successes.
        const ordered = [...matches].sort((a, b) => {
          const rank = { conflict: 0, not_found: 1, update: 2, unchanged: 3 } as const;
          return rank[a.outcome] - rank[b.outcome] || a.row.rowNumber - b.row.rowNumber;
        });
        const skipped = parsed ? parsed.skippedNoCost + parsed.skippedNoIdentifier : 0;
        const samples = costColumn ? sampleColumnValues(sheet, costColumn) : [];
        // The same rows, read for what they say a part IS rather than what it costs.
        const detailMatches = planDetailUpdates(costSheet.newParts, products);
        const detailCounts = countDetailOutcomes(detailMatches);
        const detailKey = (rowNumber: number, change: DetailChange) => `${rowNumber}:${change.field}`;
        const detailAccepted = (rowNumber: number) => (change: DetailChange) => !excludedDetails.has(detailKey(rowNumber, change));
        const detailPending = detailMatches
          .filter((m) => m.outcome === 'update' && m.product)
          .map((m) => ({ match: m, patch: fieldsToWrite(m, detailAccepted(m.rowNumber)) }))
          .filter(({ patch }) => Object.keys(patch).length > 0);
        const detailOfferedCount = detailMatches.reduce(
          (total, m) => total + m.changes.filter((c) => c.kind !== 'keep').length,
          0
        );
        const detailTickedCount = detailPending.reduce((total, { patch }) => total + Object.keys(patch).length, 0);
        const toggleDetail = (rowNumber: number, change: DetailChange) =>
          setExcludedDetails((previous) => {
            const next = new Set(previous);
            const key = detailKey(rowNumber, change);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          });
        // Anything that will not be applied is listed first, same reasoning as the cost plan.
        const detailOrdered = [...detailMatches].sort((a, b) => {
          const rank = { conflict: 0, not_found: 1, update: 2, nothing_to_add: 3 } as const;
          return rank[a.outcome] - rank[b.outcome] || a.rowNumber - b.rowNumber;
        });

        const chosenNew = costSheet.newParts.filter((_, index) => !excludedNew.has(index));
        const duplicateCount = costSheet.newParts.filter((part) =>
          findExistingProduct(products, { partNumber: part.part_number, name: part.name })
        ).length;
        const allNewTicked = costSheet.newParts.length > 0 && chosenNew.length === costSheet.newParts.length;
        const toggleNew = (index: number) =>
          setExcludedNew((previous) => {
            const next = new Set(previous);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
          });
        const toggleAllNew = () =>
          setExcludedNew(allNewTicked ? new Set(costSheet.newParts.map((_, index) => index)) : new Set());
        return (
          <div className="modal-overlay">
            <div className="modal-box" style={{ maxWidth: '820px' }} role="dialog" aria-modal="true" aria-labelledby="cost-import-title">
              <div className="modal-header">
                <h3 id="cost-import-title" className="modal-title">Import from {costSheet.fileName}</h3>
              </div>
              <div className="modal-body">
                <div className="form-group" style={{ marginBottom: '12px' }}>
                  <span className="form-label">What should this file do?</span>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      type="button"
                      className={'btn btn-sm ' + (importMode === 'costs' ? 'btn-primary' : 'btn-secondary')}
                      onClick={() => setImportMode('costs')}
                    >
                      Update cost prices of parts I already have
                    </button>
                    <button
                      type="button"
                      className={'btn btn-sm ' + (importMode === 'new' ? 'btn-primary' : 'btn-secondary')}
                      disabled={costSheet.newParts.length === 0}
                      onClick={() => setImportMode('new')}
                    >
                      Add as new parts{costSheet.newParts.length > 0 ? ' (' + costSheet.newParts.length + ')' : ''}
                    </button>
                    <button
                      type="button"
                      className={'btn btn-sm ' + (importMode === 'details' ? 'btn-primary' : 'btn-secondary')}
                      disabled={detailCounts.update === 0}
                      onClick={() => setImportMode('details')}
                    >
                      Fill in part numbers &amp; details{detailCounts.update > 0 ? ' (' + detailCounts.update + ')' : ''}
                    </button>
                  </div>
                </div>

                <div className="flex gap-4 flex-wrap" style={{ marginBottom: '12px', display: importMode === 'costs' ? undefined : 'none' }}>
                  <div className="form-group" style={{ margin: 0, minWidth: '230px' }}>
                    <label className="form-label" htmlFor="cost-col">Which column holds the cost?</label>
                    <select id="cost-col" className="form-select" value={costColumn} onChange={(e) => { setCostColumn(e.target.value); setExcludedRows(new Set()); }}>
                      <option value="">— choose a column —</option>
                      {sheet.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    {samples.length > 0 && (
                      <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                        First values: {samples.join(', ')}
                      </p>
                    )}
                  </div>
                  <div className="form-group" style={{ margin: 0, minWidth: '230px' }}>
                    <label className="form-label" htmlFor="id-col">Which column names the part?</label>
                    <select id="id-col" className="form-select" value={idColumn} onChange={(e) => { setIdColumn(e.target.value); setExcludedRows(new Set()); }}>
                      <option value="">— choose a column —</option>
                      {sheet.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  {importMode === 'costs'
                    ? 'Only the cost price changes — stock, selling price and every other detail are left exactly as they are.'
                    : importMode === 'details'
                      ? 'Fills in the real part number, OEM number, HSN, brand and category on parts you already stock. Stock, cost and selling price are not touched. A detail you already have is only replaced when the existing one is a code this app made up — shown as old → new, and you can untick any of them.'
                      : 'Each ticked row becomes a brand-new part. Rows matching something you already stock start unticked, so nothing is duplicated by accident.'}
                </p>
                {importMode === 'details' ? (
                  <>
                    <p style={{ fontSize: '13px', margin: '10px 0' }}>
                      <strong>{detailTickedCount} of {detailOfferedCount}</strong> detail(s) ticked, across {detailCounts.update} part(s)
                      {detailCounts.not_found > 0 && (
                        <span style={{ color: 'var(--text-muted)' }}> · {detailCounts.not_found} row(s) match no part you stock</span>
                      )}
                      {detailCounts.conflict > 0 && (
                        <span style={{ color: 'var(--color-warning)' }}> · {detailCounts.conflict} left alone</span>
                      )}
                    </p>
                    <div style={{ maxHeight: '320px', overflowY: 'auto', overflowX: 'auto' }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Part on file</th>
                            <th>What the document adds</th>
                            <th>Result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailOrdered.map((m) => (
                            <tr key={m.rowNumber}>
                              <td>
                                <strong style={{ fontSize: '13px' }}>{m.product?.name ?? m.name}</strong>
                                {m.product && (
                                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                                    {m.product.part_number ? m.product.part_number : 'no part number yet'}
                                    {m.matchedBy ? ` · matched by ${m.matchedBy}` : ''}
                                  </div>
                                )}
                              </td>
                              <td>
                                {m.changes.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>}
                                {m.changes.map((change) => (
                                  <div key={change.field} style={{ fontSize: '12px', marginBottom: '2px' }}>
                                    {change.kind === 'keep' ? (
                                      <span style={{ color: 'var(--color-warning)' }}>
                                        {change.label}: document says <strong>{change.to}</strong>, you have <strong>{change.from}</strong> — left alone
                                      </span>
                                    ) : (
                                      <label className="flex items-center gap-2" style={{ cursor: applyingCosts ? 'default' : 'pointer' }}>
                                        <input
                                          type="checkbox"
                                          disabled={applyingCosts}
                                          checked={!excludedDetails.has(`${m.rowNumber}:${change.field}`)}
                                          onChange={() => toggleDetail(m.rowNumber, change)}
                                        />
                                        <span>
                                          {change.label}: {change.kind === 'replace'
                                            ? <><span style={{ textDecoration: 'line-through', color: 'var(--text-muted)' }}>{change.from}</span> → <strong>{change.to}</strong></>
                                            : <strong>{change.to}</strong>}
                                        </span>
                                      </label>
                                    )}
                                  </div>
                                ))}
                              </td>
                              <td style={{ fontSize: '12px' }}>
                                {m.outcome === 'update' && <span className="badge badge-success">update</span>}
                                {m.outcome === 'nothing_to_add' && <span style={{ color: 'var(--text-muted)' }}>{m.reason}</span>}
                                {m.outcome === 'not_found' && <span style={{ color: 'var(--text-muted)' }}>{m.reason}</span>}
                                {m.outcome === 'conflict' && <span style={{ color: 'var(--color-warning)' }}>{m.reason}</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : importMode === 'new' ? (
                  <>
                    <p style={{ fontSize: '13px', margin: '10px 0' }}>
                      <strong>{chosenNew.length} of {costSheet.newParts.length}</strong> selected to add
                      {duplicateCount > 0 && (
                        <span style={{ color: 'var(--color-warning)' }}> · {duplicateCount} already stocked</span>
                      )}
                    </p>
                    <div style={{ maxHeight: '300px', overflowY: 'auto', overflowX: 'auto' }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th style={{ width: '34px' }}>
                              <input
                                type="checkbox"
                                aria-label={allNewTicked ? 'Clear all' : 'Select all'}
                                checked={allNewTicked}
                                ref={(el) => { if (el) el.indeterminate = chosenNew.length > 0 && !allNewTicked; }}
                                onChange={toggleAllNew}
                              />
                            </th>
                            <th>Part</th><th>Name</th><th>Stock</th><th>Cost</th><th>What happens</th>
                          </tr>
                        </thead>
                        <tbody>
                          {costSheet.newParts.map((part, index) => {
                            const existing = findExistingProduct(products, { partNumber: part.part_number, name: part.name });
                            return (
                              <tr key={index} style={excludedNew.has(index) ? { opacity: 0.45 } : undefined}>
                                <td>
                                  <input
                                    type="checkbox"
                                    aria-label={'Add ' + (part.part_number || part.name)}
                                    checked={!excludedNew.has(index)}
                                    onChange={() => toggleNew(index)}
                                  />
                                </td>
                                <td>{part.part_number || '—'}</td>
                                <td>{part.name}</td>
                                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{part.current_stock}</td>
                                <td style={{ fontVariantNumeric: 'tabular-nums' }}>₹{money(part.cost_price)}</td>
                                <td>
                                  {existing
                                    ? <span style={{ color: 'var(--color-warning)' }}>already stocked as {existing.part_number || existing.name}</span>
                                    : <span className="badge badge-success">add</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : !parsed ? (
                  <p style={{ fontSize: '13px', color: 'var(--color-warning)', marginTop: '10px' }}>
                    Choose both columns above to see what would change.
                  </p>
                ) : (
                  <>
                    <p style={{ fontSize: '13px', margin: '10px 0' }}>
                      <strong>{pending.length} of {counts.update}</strong> selected to update · {counts.unchanged} already correct · {counts.not_found} not found
                      {counts.conflict > 0 && <> · <span style={{ color: 'var(--color-warning)' }}>{counts.conflict} unclear</span></>}
                      {skipped > 0 && <span style={{ color: 'var(--text-muted)' }}> · {skipped} row(s) skipped as unreadable</span>}
                    </p>
                    {/* The likeliest cause of a wall of "not found" is not a bad file but the wrong
                        company being active — this sheet's part codes simply belong elsewhere.
                        Say that plainly instead of leaving 227 unexplained misses to decode. */}
                    {matches.length > 0 && counts.not_found > matches.length / 2 && (
                      <p className="alert alert-warning" style={{ fontSize: '13px', padding: '8px 12px' }}>
                        Most rows don&apos;t match anything in <strong>{activeCompany?.name ?? 'this company'}</strong>. If this
                        price list belongs to another company, switch to it first — or check that the
                        &ldquo;{idColumn}&rdquo; column really holds your part codes.
                      </p>
                    )}
                    <div style={{ maxHeight: '300px', overflowY: 'auto', overflowX: 'auto' }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th style={{ width: '34px' }}>
                              <input
                                type="checkbox"
                                aria-label={allTicked ? 'Clear all' : 'Select all'}
                                checked={allTicked}
                                disabled={updatable.length === 0}
                                // Partly-ticked has to be set on the node; there is no attribute for it.
                                ref={(el) => { if (el) el.indeterminate = pending.length > 0 && !allTicked; }}
                                onChange={toggleAll}
                              />
                            </th>
                            <th>Row</th><th>Part</th><th>Cost now</th><th>New cost</th><th>What happens</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ordered.map((m) => (
                            <tr key={m.row.rowNumber} style={m.outcome === 'update' && excludedRows.has(m.row.rowNumber) ? { opacity: 0.45 } : undefined}>
                              <td>
                                {m.outcome === 'update' && (
                                  <input
                                    type="checkbox"
                                    aria-label={`Update ${m.product?.part_number || m.product?.name || `row ${m.row.rowNumber}`}`}
                                    checked={!excludedRows.has(m.row.rowNumber)}
                                    onChange={() => toggleRow(m.row.rowNumber)}
                                  />
                                )}
                              </td>
                              <td style={{ color: 'var(--text-muted)' }}>{m.row.rowNumber}</td>
                              <td>{m.product ? `${m.product.part_number || '—'} · ${m.product.name}` : (m.row.partNumber || m.row.name || m.row.oemNumber)}</td>
                              <td style={{ fontVariantNumeric: 'tabular-nums' }}>{m.product ? `₹${money(Number(m.product.cost_price))}` : '—'}</td>
                              <td style={{ fontVariantNumeric: 'tabular-nums' }}>₹{money(m.row.cost)}</td>
                              <td>
                                {m.outcome === 'update' && <span className="badge badge-success">update</span>}
                                {m.outcome === 'unchanged' && <span style={{ color: 'var(--text-muted)' }}>{m.reason ?? 'no change'}</span>}
                                {m.outcome === 'not_found' && <span style={{ color: 'var(--text-muted)' }}>{m.reason}</span>}
                                {m.outcome === 'conflict' && <span style={{ color: 'var(--color-warning)' }}>{m.reason}</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                {importError && <p className="form-error" role="alert">{importError}</p>}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" disabled={applyingCosts} onClick={() => setCostSheet(null)}>Cancel</button>
                {importMode === 'details' ? (
                  <button
                    className="btn btn-primary"
                    disabled={applyingCosts || detailPending.length === 0}
                    onClick={() => applyDetailPlan(detailPending.map(({ match, patch }) => ({ productId: match.product!.id, patch, name: match.product!.name })))}
                  >
                    {applyingCosts
                      ? `Updating ${costProgress} of ${detailPending.length}…`
                      : detailPending.length === 0
                        ? (detailCounts.update === 0 ? 'Nothing to fill in' : 'Nothing ticked')
                        : `Fill in ${detailTickedCount} detail(s) on ${detailPending.length} part(s)`}
                  </button>
                ) : importMode === 'new' ? (
                  <button className="btn btn-primary" disabled={applyingCosts || chosenNew.length === 0} onClick={() => applyNewParts(chosenNew)}>
                    {applyingCosts ? 'Adding\u2026' : chosenNew.length === 0 ? 'Nothing selected' : 'Add ' + chosenNew.length + ' new part(s)'}
                  </button>
                ) : (
                <button className="btn btn-primary" disabled={applyingCosts || pending.length === 0} onClick={() => applyCostPlan(pending)}>
                  {applyingCosts
                    ? `Updating ${costProgress} of ${pending.length}…`
                    : pending.length === 0
                      // "Nothing to update" would be wrong when there are updates and the owner
                      // has simply unticked them all — say which of the two it is.
                      ? (updatable.length === 0 ? 'Nothing to update' : 'Nothing selected')
                      : `Apply ${pending.length} cost update(s)`}
                </button>
                )}
              </div>
            </div>
          </div>
        );
}
