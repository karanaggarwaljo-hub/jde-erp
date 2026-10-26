'use client';

/**
 * The add / edit part dialog, lifted out of app/(dashboard)/inventory/page.tsx.
 *
 * Deliberately presentational: every value and every setter arrives as a prop, and the page still
 * owns the state. That keeps this a pure move with no behaviour change — the compiler checks each
 * prop is supplied and correctly typed, which is the only safety net available for a screen with
 * no automated UI coverage that nobody can sign into and click through here.
 *
 * The long prop list is the honest shape of the thing rather than a smell to hide: it is exactly
 * what the dialog reads from the page, and it is the map for later moving that state in here.
 */

import type { Dispatch, FormEvent, ReactNode, RefObject, SetStateAction } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { money, wholeMoney } from '@/lib/money';
import { compatibilitySuggestions } from '@/lib/product-search';
import { brandLabel, cleanOtherNumbers, splitNumberList } from '@/lib/part-numbers';
import { keepEnterInsideForm, SAVE_SHORTCUT_HINT } from '@/lib/form-keys';
import type { PartDraftSummary, PartFormData, Product } from '@/lib/inventory-types';

export type PartFormModalProps = {
  formData: PartFormData;
  setFormData: Dispatch<SetStateAction<PartFormData>>;
  editingProduct: Product | null;
  products: Product[];
  categoryOptions: string[];
  possibleDuplicate: Product | undefined;
  /** Other parts already using the part number being typed: the same brand is a clash the database
   *  refuses (one number per brand); another brand is the same part from another maker, and fine. */
  numberUsers: { sameBrand: Product[]; otherBrands: Product[] };
  /** Other parts that already answer to one of the other numbers typed. Allowed, only noted. */
  otherNumberUsers: Array<{ number: string; part: Product }>;
  /** Set while adding another brand of an existing part: the details were copied from it. */
  addingBrandOf: Product | null;
  draft: PartDraftSummary;
  draftMargin: number | null;
  saveError: string;
  savingProduct: boolean;
  savedThisSession: number;
  suggesting: boolean;
  suggestFailed: boolean;
  suggestPartDetails: () => void;
  /** Set by "Save & add another" just before submit, so one handler covers both paths. A ref
   *  rather than state because it must be readable inside that same submit. */
  addAnotherRef: RefObject<boolean>;
  handleSave: (event: FormEvent) => void;
  setShowModal: (open: boolean) => void;
  /** Same brand always gets the same dot. Passed in rather than redefined so a brand reads
   *  identically here and in the table behind it. */
  brandChipColor: (brand: string) => string;
  /** The part's photo and the buttons to change it, when an existing part is being edited. */
  photoEditor?: ReactNode;
};

export default function PartFormModal(props: PartFormModalProps) {
  const {
    formData, setFormData, editingProduct, products, categoryOptions, possibleDuplicate, numberUsers, otherNumberUsers, addingBrandOf,
    draft, draftMargin, saveError, savingProduct, savedThisSession,
    suggesting, suggestFailed, suggestPartDetails,
    addAnotherRef, handleSave, setShowModal, brandChipColor, photoEditor,
  } = props;

  return (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: '980px' }}>
            <div className="modal-header">
              <div>
                <h3 className="modal-title">{editingProduct ? 'Edit Spare Part' : addingBrandOf ? 'Add Another Brand' : 'Add New Spare Part'}</h3>
                <p className="page-subtitle" style={{ marginTop: '2px' }}>
                  {editingProduct
                    ? <>Editing <span className="pn-chip">{editingProduct.part_number}</span> · changes apply the moment you save</>
                    : addingBrandOf
                      ? <>The same part as <strong>{addingBrandOf.name}</strong> ({brandLabel(addingBrandOf.brand)}), in another brand, with its own stock and price</>
                      : 'Added to this company’s catalogue and available to sell straight away'}
                </p>
              </div>
              <button className="btn btn-ghost btn-sm" disabled={savingProduct} onClick={() => setShowModal(false)}>✕</button>
            </div>
            {/* Sixteen fields, and "Save & add another" keeps it open for the next part —
                Enter partway through used to save whatever had been filled in so far. */}
            <form onSubmit={handleSave} onKeyDown={(event) => keepEnterInsideForm(event, !savingProduct)}>
              {/* Form on the left, a live picture of the part on the right — the same split the
                  invoice dialog uses, so what you are about to create is visible while you type
                  rather than only after saving. */}
              <div className="modal-body part-form">
                <div className="part-form-fields">
                {saveError && <div className="alert alert-danger" role="alert">{saveError}</div>}
                {addingBrandOf && (
                  <div className="alert alert-info" role="status">
                    <span>
                      The name, part numbers, category and fitment are copied from {addingBrandOf.name}. Type the new
                      <strong> brand</strong>, then its own price and how many you have.
                    </span>
                  </div>
                )}
                {possibleDuplicate && (
                  <div className="alert alert-warning" role="alert">
                    A part named &quot;{possibleDuplicate.name}&quot; already exists ({possibleDuplicate.part_number}, {possibleDuplicate.current_stock} in stock) — this will add a separate, second entry rather than update it. If you meant to edit the existing one, cancel and use its Edit button instead.
                  </div>
                )}
                {/* One number per brand: the database refuses the same number twice in the same
                    brand, so that is said here, before the button. The same number in another brand
                    is the same part from another maker, and is fine. */}
                {numberUsers.sameBrand.length > 0 && (
                  <div className="alert alert-warning" role="alert">
                    <span>
                      <strong>{formData.part_number.trim()}</strong> is already on{' '}
                      {numberUsers.sameBrand.map((p) => p.name).join(', ')}, in the same brand ({brandLabel(formData.brand)}). This will
                      not save as it stands. If this is another brand of that part, type its brand. Otherwise give it its own number,
                      or clear the box and one will be made for it.
                    </span>
                  </div>
                )}
                {numberUsers.sameBrand.length === 0 && numberUsers.otherBrands.length > 0 && (
                  <div className="alert alert-info" role="status">
                    <span>
                      {formData.part_number.trim()} is also on {numberUsers.otherBrands.map((p) => `${p.name} (${brandLabel(p.brand)})`).join(', ')}.
                      That is fine: this one is a different brand, with its own stock and price.
                    </span>
                  </div>
                )}
                {photoEditor && (
                  <div className="form-section">
                    <div className="form-section-head"><h4>Photo</h4><small>Changes save straight away</small></div>
                    {photoEditor}
                  </div>
                )}
                {/* ── What the part is ───────────────────────────────────────── */}
                <div className="form-section">
                  <div className="form-section-head">
                    <h4>Part details</h4>
                    <small>Fields marked * are required</small>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Part Name / Description *</label>
                    <input className="form-input" required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} onBlur={suggestPartDetails} />
                    <small style={{ color: 'var(--text-muted)' }}>{suggestFailed ? "Couldn't get a suggestion this time — go ahead and fill these in yourself." : 'Brand and category are suggested once you finish typing this — override either anytime.'}</small>
                  </div>

                  <div className="form-grid-2">
                    <div className="form-group">
                      <label className="form-label flex items-center gap-1">Brand {suggesting && <Sparkles size={12} className="text-brand spin" />}</label>
                      <input className="form-input" value={formData.brand} onChange={e => setFormData({ ...formData, brand: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label className="form-label flex items-center gap-1">Category {suggesting && <Sparkles size={12} className="text-brand spin" />}</label>
                      <input
                        className="form-input"
                        list="category-options"
                        placeholder="Pick or type a new category"
                        value={formData.category}
                        onChange={e => setFormData({ ...formData, category: e.target.value })}
                      />
                      <datalist id="category-options">
                        {categoryOptions.map((category) => <option key={category} value={category} />)}
                      </datalist>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Fits which machines</label>
                    <input
                      className="form-input"
                      list="compatibility-options"
                      placeholder="e.g. JCB 3DX, JCB N/M (bs4)"
                      value={formData.compatibility}
                      onChange={e => setFormData({ ...formData, compatibility: e.target.value })}
                    />
                    {/* The spellings this shop already uses, commonest first. Picking one instead
                        of retyping it is what keeps "N/M bs4" and "N/m bs4" a single thing that a
                        search can find — the field stays free text either way. */}
                    <datalist id="compatibility-options">
                      {compatibilitySuggestions(products).map((option) => <option key={option} value={option} />)}
                    </datalist>
                  </div>
                </div>

                {/* ── How it is identified on paper ──────────────────────────── */}
                <div className="form-section">
                  <div className="form-section-head">
                    <h4>Reference numbers</h4>
                    <small>HSN is what appears on a GST invoice</small>
                  </div>
                  {/* OEM number was dropped from this form at the owner's request — it is not part
                      of how this business identifies a part. The field itself is kept in state and
                      still round-trips through save, so any OEM already recorded on an older part
                      survives an edit here instead of being blanked. */}
                  <div className="form-grid-2">
                    <div className="form-group">
                      <label className="form-label">Part Number</label>
                      {/* Not required. Left blank, the database gives this part the next free
                          internal code for the company — which is the only place that can see
                          every code already in use. Typing a real supplier code is always better
                          than a generated one, so the field stays first and empty rather than
                          pre-filled with a stand-in somebody might keep by accident. */}
                      <input
                        className="form-input"
                        placeholder="The supplier's code, or leave blank for one of ours"
                        value={formData.part_number}
                        onChange={e => setFormData({ ...formData, part_number: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">HSN Code</label>
                      <input className="form-input" placeholder="e.g. 84314990" value={formData.hsn_code} onChange={e => setFormData({ ...formData, hsn_code: e.target.value })} />
                    </div>
                  </div>
                  {/* Any number of other numbers, typed with commas between them. One box rather
                      than a row per number, so nothing half-typed is lost when Save is pressed. */}
                  <div className="form-group">
                    <label className="form-label" htmlFor="part-other-numbers">Other part numbers</label>
                    <input
                      id="part-other-numbers"
                      className="form-input"
                      placeholder="e.g. 32/925694, FS19505 (put a comma between them)"
                      value={formData.other_numbers}
                      onChange={e => setFormData({ ...formData, other_numbers: e.target.value })}
                    />
                    {(() => {
                      const kept = cleanOtherNumbers(splitNumberList(formData.other_numbers), formData.part_number);
                      if (kept.length === 0) {
                        return <small className="text-muted">The supplier&apos;s code, an old number, the maker&apos;s number. Searching, billing and scanned supplier bills find the part by any of them.</small>;
                      }
                      return (
                        <div className="flex items-center gap-2" style={{ flexWrap: 'wrap', marginTop: '6px' }}>
                          <small className="text-muted">{kept.length === 1 ? 'Also found as' : `Also found as (${kept.length})`}</small>
                          {kept.map((number) => <span key={number} className="pn-chip">{number}</span>)}
                        </div>
                      );
                    })()}
                    {otherNumberUsers.length > 0 && (
                      <small className="text-muted" style={{ display: 'block', marginTop: '4px' }}>
                        {otherNumberUsers.map(({ number, part }) => `${number} is also on ${part.name} (${brandLabel(part.brand)})`).join(' · ')}.
                      </small>
                    )}
                  </div>
                </div>

                {/* ── What it costs and sells for ────────────────────────────── */}
                <div className="form-section">
                  <div className="form-section-head">
                    <h4>Pricing</h4>
                    {/* Worked out live from what is being typed, so the margin is checked before
                        saving rather than discovered later in a report. Only shown once both
                        numbers are real — never a placeholder. */}
                    {draftMargin !== null && (
                      <span className={`form-readout ${draftMargin < 0 ? 'is-bad' : draftMargin >= 15 ? 'is-good' : ''}`}>
                        Margin {draftMargin.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <div className="form-grid-3">
                    <div className="form-group">
                      <label className="form-label">Cost Price (₹)</label>
                      <input type="number" min="0" className="form-input" value={formData.cost_price} onChange={e => setFormData({ ...formData, cost_price: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">MRP (₹)</label>
                      <input type="number" min="0" className="form-input" value={formData.mrp} onChange={e => setFormData({ ...formData, mrp: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Sale Price (₹) *</label>
                      <input type="number" min="0" className="form-input" required value={formData.sale_price} onChange={e => setFormData({ ...formData, sale_price: e.target.value })} />
                    </div>
                  </div>
                </div>

                {/* ── How much there is and where it sits ────────────────────── */}
                <div className="form-section">
                  <div className="form-section-head">
                    <h4>Stock</h4>
                    <small>Below the threshold, this part shows as low stock</small>
                  </div>
                  <div className="form-grid-3">
                    <div className="form-group">
                      <label className="form-label">Initial Stock{!editingProduct && ' *'}</label>
                      <input type="number" className="form-input" min={editingProduct ? 0 : 1} required={!editingProduct} value={formData.current_stock} onChange={e => setFormData({ ...formData, current_stock: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Min Stock Threshold</label>
                      <input type="number" className="form-input" value={formData.min_stock} onChange={e => setFormData({ ...formData, min_stock: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Rack Location</label>
                      <input className="form-input" placeholder="e.g. A-01" value={formData.location} onChange={e => setFormData({ ...formData, location: e.target.value })} />
                    </div>
                  </div>
                </div>
                </div>

                {/* ── Live summary of the part being described ───────────────── */}
                <aside className="part-form-summary">
                  <div className="card" style={{ background: 'var(--surface-2)' }}>
                    <div className="form-section-head" style={{ marginBottom: '12px' }}>
                      <h4>{editingProduct ? 'After saving' : 'New part'}</h4>
                    </div>

                    <div style={{ marginBottom: '14px' }}>
                      <div className="directory-card-title" style={{ marginBottom: '6px' }}>
                        {draft.name || <span className="text-muted">Part name goes here</span>}
                      </div>
                      <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                        {draft.partNumber && <span className="pn-chip">{draft.partNumber}</span>}
                        {draft.brand && (
                          <span className="brand-chip" style={{ ['--brand-chip-color' as string]: brandChipColor(draft.brand) } as React.CSSProperties}>
                            {draft.brand}
                          </span>
                        )}
                        {draft.category && <span className="badge badge-muted">{draft.category}</span>}
                      </div>
                    </div>

                    {/* Same stock wording the table uses, so a part reads identically here and there. */}
                    <div className="flex justify-between items-center" style={{ marginBottom: '4px' }}>
                      <span className="text-muted" style={{ fontSize: '12.5px' }}>Opening stock</span>
                      <span className={`badge ${draft.stockBadge.tone}`}>{draft.stockBadge.label}</span>
                    </div>
                    {draft.meterPercent !== null && (
                      <div className={`meter ${draft.stock <= 0 ? 'meter--out' : draft.isLow ? 'meter--low' : ''}`} style={{ marginBottom: '14px' }}>
                        <i style={{ width: `${draft.meterPercent}%` }} />
                      </div>
                    )}

                    <div className="report-summary" style={{ maxWidth: 'none', margin: 0, padding: 0, gap: 0 }}>
                      <div className="report-line"><span className="text-muted">Cost price</span><strong>{draft.cost > 0 ? `₹${money(draft.cost)}` : '—'}</strong></div>
                      <div className="report-line"><span className="text-muted">Sale price</span><strong>{draft.sale > 0 ? `₹${money(draft.sale)}` : '—'}</strong></div>
                      {draft.mrp > 0 && (
                        <div className="report-line"><span className="text-muted">MRP</span><strong>₹{money(draft.mrp)}</strong></div>
                      )}
                      {draftMargin !== null && (
                        <div className="report-line report-strong">
                          <span>Margin per piece</span>
                          <strong className={draftMargin < 0 ? 'text-danger' : 'text-success'}>
                            ₹{money(draft.sale - draft.cost)} · {draftMargin.toFixed(1)}%
                          </strong>
                        </div>
                      )}
                    </div>

                    {draft.stockValue > 0 && (
                      <div className="report-total mt-2">
                        <div>
                          <small>Opening stock at cost</small>
                          <strong>₹{wholeMoney(draft.stockValue)}</strong>
                        </div>
                      </div>
                    )}

                    {/* Only things that are actually wrong or genuinely missing — never nagging. */}
                    {draft.warnings.length > 0 && (
                      <div className="flex flex-col gap-2 mt-2">
                        {draft.warnings.map((warning) => (
                          <div key={warning.text} className={`alert ${warning.tone}`} role="status" style={{ fontSize: '12.5px', padding: '9px 11px' }}>
                            {warning.text}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </aside>
              </div>

              <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
                <span className="text-muted" style={{ fontSize: '12.5px' }}>
                  {savedThisSession > 0
                    ? `${savedThisSession} ${savedThisSession === 1 ? 'part' : 'parts'} added so far`
                    : ''}
                </span>
                <div className="flex gap-2 items-center">
                  <span className="text-muted text-sm">{SAVE_SHORTCUT_HINT}</span>
                  <button type="button" className="btn btn-secondary" disabled={savingProduct} onClick={() => setShowModal(false)}>
                    {savedThisSession > 0 ? 'Done' : 'Cancel'}
                  </button>
                  {/* Only offered when adding: "another" makes no sense mid-edit of one part. */}
                  {!editingProduct && (
                    <button
                      type="submit"
                      className="btn btn-secondary"
                      disabled={savingProduct}
                      onClick={() => { addAnotherRef.current = true; }}
                    >
                      <Plus size={15} /> Save &amp; add another
                    </button>
                  )}
                  <button type="submit" className="btn btn-primary" disabled={savingProduct}>
                    {savingProduct ? 'Saving…' : editingProduct ? 'Save Changes' : 'Save Part'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
  );
}
