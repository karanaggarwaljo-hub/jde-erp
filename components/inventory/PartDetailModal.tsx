'use client';

/**
 * One part, opened from its row: what it looks like, what it fits, what it is worth, what it has
 * done, and what else could be sold in its place.
 *
 * Everything shown is this company's own recorded data — no estimate is presented as a fact. An
 * alternative always carries the reason it was offered, and clicking one opens that part here, so
 * a customer asking "what else have you got" is a couple of clicks rather than a search and a guess.
 */

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { X, ArrowRight, AlertTriangle, Edit, Camera, Pencil } from 'lucide-react';
import { savePartFitment } from '@/lib/client-part-fitment';
import { money } from '@/lib/money';
import { looksLikeAnInventedCode } from '@/lib/detail-import';
import { marginPercent } from '@/lib/margin';
import { formatDay } from '@/lib/report-period';
import { fetchPartDetail, type PartDetail } from '@/lib/client-part-overview';
import { removePartPhoto, savePartPhoto } from '@/lib/client-part-photo';
import type { PartPhotoRef } from '@/lib/part-photos';
import PartPhoto from '@/components/PartPhoto';

export type PartDetailModalProps = {
  companyId: string;
  productId: string;
  /** Opening an alternative swaps this panel over to that part. */
  onOpenPart: (productId: string) => void;
  onClose: () => void;
  onEdit: (productId: string) => void;
  /** A photo or the fitment changed here, so the list behind this panel should show it too. */
  onChanged: () => void;
  /** The ways this shop already writes machines, commonest first, offered while typing a fitment so
   *  "N/M bs4" and "N/m bs4" stay one thing a search can find. */
  fitmentSuggestions?: string[];
};

const amount = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{children}</div>
    </div>
  );
}

export default function PartDetailModal({ companyId, productId, onOpenPart, onClose, onEdit, onChanged, fitmentSuggestions = [] }: PartDetailModalProps) {
  const [detail, setDetail] = useState<PartDetail | null>(null);
  const [failure, setFailure] = useState<{ productId: string; message: string } | null>(null);
  // Bumped after a photo changes, to read the part again.
  const [version, setVersion] = useState(0);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [viewingPhoto, setViewingPhoto] = useState(false);
  const [editingFitment, setEditingFitment] = useState(false);
  const [fitmentDraft, setFitmentDraft] = useState('');
  const [savingFitment, setSavingFitment] = useState(false);
  const [fitmentError, setFitmentError] = useState('');
  const [fitmentNote, setFitmentNote] = useState('');
  const photoInput = useRef<HTMLInputElement>(null);

  // Opening an alternative swaps the part underneath, so anything half-done for the last one goes.
  const [seenProductId, setSeenProductId] = useState(productId);
  if (seenProductId !== productId) {
    setSeenProductId(productId);
    setViewingPhoto(false);
    setEditingFitment(false);
    setFitmentError('');
    setFitmentNote('');
  }

  // Esc closes the enlarged photo only, leaving the part window open behind it.
  useEffect(() => {
    if (!viewingPhoto) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setViewingPhoto(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [viewingPhoto]);

  // Nothing is set before the fetch resolves, and what came back carries the part it belongs to.
  // Opening an alternative therefore never shows the previous part's figures under the new name,
  // and a reply that arrives after the panel has moved on is dropped.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const loaded = await fetchPartDetail(companyId, productId);
        if (active) {
          setDetail(loaded);
          setFailure(null);
        }
      } catch (cause) {
        if (active) setFailure({ productId, message: cause instanceof Error ? cause.message : 'Could not load this part.' });
      }
    })();
    return () => { active = false; };
  }, [companyId, productId, version]);

  const showing = detail && detail.part.id === productId ? detail : null;
  const error = failure && failure.productId === productId ? failure.message : '';
  const loading = !showing && !error;

  const part = showing?.part;
  const totals = showing?.overview.totals;
  const margin = part ? marginPercent(amount(part.sale_price), totals?.nextCost ?? amount(part.cost_price)) : null;
  // Only batches with something left are on the shelf. A used-up one is counted underneath rather
  // than listed as a row of 0, which read as unexplained sales — FIL-K04's "0 of 4" was an opening
  // count corrected a minute later, and the old table could not say so.
  const listingFitmentText = showing?.catalogFitment ?? '';
  const shelfBatches = showing ? showing.overview.batches.filter((batch) => batch.left > 0) : [];
  const usedUpBatches = showing ? showing.overview.batches.length - shelfBatches.length : 0;
  const photo: PartPhotoRef | null = part?.image_url
    ? { url: part.image_url, source: 'own' }
    : showing?.catalogPhoto ? { url: showing.catalogPhoto, source: 'catalog' } : null;

  const changePhoto = async (work: () => Promise<unknown>) => {
    setPhotoBusy(true);
    setPhotoError('');
    try {
      await work();
      setVersion((value) => value + 1);
      onChanged();
    } catch (cause) {
      setPhotoError(cause instanceof Error ? cause.message : 'The photo was not changed.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const handlePhotoChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void changePhoto(() => savePartPhoto(companyId, productId, file));
  };

  // Which machines the part fits is edited right here, beside where it is shown — the full Edit
  // form asked for it under another name ("Fits which machines"), a scroll away.
  const startFitment = () => {
    // With nothing on the part, start from what its website listing already says.
    setFitmentDraft(part?.compatibility || listingFitmentText || '');
    setFitmentError('');
    setFitmentNote('');
    setEditingFitment(true);
  };

  const cancelFitment = () => {
    setEditingFitment(false);
    setFitmentError('');
  };

  const saveFitment = async (event: FormEvent) => {
    event.preventDefault();
    if (savingFitment) return;
    setSavingFitment(true);
    setFitmentError('');
    try {
      const saved = await savePartFitment(companyId, productId, fitmentDraft);
      setDetail((current) => current && current.part.id === productId
        ? { ...current, part: { ...current.part, compatibility: saved.after } }
        : current);
      setFitmentNote(
        saved.listingFollowed
          ? 'Saved. Your website listing shows it too.'
          : saved.listingKept !== null
            ? `Saved. Your website listing keeps its own wording, "${saved.listingKept}" — change that on the Website Catalog page if it should match.`
            : 'Saved.'
      );
      setEditingFitment(false);
      onChanged();
    } catch (cause) {
      setFitmentError(cause instanceof Error ? cause.message : 'The fitment was not saved.');
    } finally {
      setSavingFitment(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: '860px' }} role="dialog" aria-modal="true" aria-labelledby="part-detail-title">
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h3 id="part-detail-title" className="modal-title">{part ? part.name : 'Part'}</h3>
            {part && (
              <div className="flex items-center gap-2" style={{ flexWrap: 'wrap', marginTop: 6 }}>
                {part.part_number
                  ? <span className="pn-chip">{part.part_number}</span>
                  : <span className="text-muted" style={{ fontSize: 12 }}>no part number</span>}
                {part.part_number && looksLikeAnInventedCode(part.part_number) && (
                  <span className="pn-tag" title="A code this app generated, not the manufacturer&rsquo;s part number">Internal</span>
                )}
                {part.brand && <span className="badge badge-info">{part.brand}</span>}
                {part.category && <span className="badge">{part.category}</span>}
              </div>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {loading && <p className="text-muted">Loading this part&hellip;</p>}
          {error && <p className="form-error" role="alert">{error}</p>}

          {part && showing && totals && (
            <>
              <section className="part-detail-photo">
                <PartPhoto
                  url={photo?.url} name={part.name} size={150} addable={!photo} busy={photoBusy}
                  onClick={photo ? () => setViewingPhoto(true) : () => photoInput.current?.click()}
                  title={photo ? `See the photo of ${part.name} larger` : `Add a photo of ${part.name}`}
                />
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <div style={{ fontSize: 13, marginBottom: 4 }} className="text-muted">Fits</div>
                  {editingFitment ? (
                    <form className="fitment-edit" onSubmit={saveFitment}>
                      <input
                        id="part-fitment"
                        className="form-input"
                        list="part-fitment-options"
                        placeholder="e.g. JCB 3DX, JCB N/M (bs4)"
                        aria-label={`Machines ${part.name} fits`}
                        autoFocus
                        value={fitmentDraft}
                        disabled={savingFitment}
                        onChange={(event) => setFitmentDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== 'Escape') return;
                          event.stopPropagation();
                          cancelFitment();
                        }}
                      />
                      <datalist id="part-fitment-options">
                        {fitmentSuggestions.map((option) => <option key={option} value={option} />)}
                      </datalist>
                      <button type="submit" className="btn btn-primary btn-sm" disabled={savingFitment}>{savingFitment ? 'Saving…' : 'Save'}</button>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={savingFitment} onClick={cancelFitment}>Cancel</button>
                    </form>
                  ) : (
                    <div className="fitment-view">
                      <span style={{ fontWeight: 600, fontSize: 16 }}>
                        {part.compatibility || <span className="text-muted" style={{ fontWeight: 400 }}>Not recorded yet</span>}
                      </span>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={startFitment}>
                        <Pencil size={13} /> {part.compatibility ? 'Change' : 'Add fitment'}
                      </button>
                    </div>
                  )}
                  {!part.compatibility && listingFitmentText && !editingFitment && (
                    <p className="text-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
                      Your website listing says it fits <strong>{listingFitmentText}</strong> — press Add fitment to use that here too.
                    </p>
                  )}
                  {fitmentError && <p className="form-error" role="alert" style={{ marginBottom: 10 }}>{fitmentError}</p>}
                  {fitmentNote && !editingFitment && <p className="text-muted" role="status" style={{ fontSize: 12, marginBottom: 10 }}>{fitmentNote}</p>}
                  <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
                    {photo?.source === 'own'
                      ? 'Your photo of this part.'
                      : photo?.source === 'catalog'
                        ? 'Picture from your Website Catalog. Add your own photo and it is used instead.'
                        : 'No photo yet. Add one so this part is known on sight.'}
                  </div>
                  <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary btn-sm" disabled={photoBusy} onClick={() => photoInput.current?.click()}>
                      <Camera size={14} /> {photoBusy ? 'Saving…' : photo?.source === 'own' ? 'Change photo' : 'Add photo'}
                    </button>
                    {photo?.source === 'own' && (
                      <button className="btn btn-ghost btn-sm" disabled={photoBusy}
                        onClick={() => void changePhoto(() => removePartPhoto(companyId, productId))}>
                        Remove photo
                      </button>
                    )}
                  </div>
                  {photoError && <p className="form-error" role="alert" style={{ marginTop: 8 }}>{photoError}</p>}
                  <input ref={photoInput} type="file" accept="image/*" hidden onChange={handlePhotoChosen} />
                </div>
              </section>

              <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 20 }}>
                <Fact label="In stock">
                  {amount(part.current_stock)}
                  {amount(part.min_stock) > 0 && <span className="text-muted" style={{ fontWeight: 400, fontSize: 12 }}> · reorder at {amount(part.min_stock)}</span>}
                </Fact>
                <Fact label="Stock is worth">&#8377;{money(totals.onHandValue)}</Fact>
                <Fact label="Next sale costs">{totals.nextCost === null ? <span className="text-muted">no batch left</span> : `₹${money(totals.nextCost)}`}</Fact>
                <Fact label="Sells for">&#8377;{money(amount(part.sale_price))}</Fact>
                <Fact label="Margin">{margin === null ? <span className="text-muted">&mdash;</span> : `${margin.toFixed(1)}%`}</Fact>
                {amount(part.mrp) > 0 && <Fact label="MRP">&#8377;{money(amount(part.mrp))}</Fact>}
                {part.oem_number && <Fact label="OEM number">{part.oem_number}</Fact>}
                {part.hsn_code && <Fact label="HSN">{part.hsn_code}</Fact>}
                {part.location && <Fact label="Kept at">{part.location}</Fact>}
                <Fact label="Sold so far">{totals.soldQty} for &#8377;{money(totals.soldValue)}</Fact>
                <Fact label="Bought so far">{totals.boughtQty} for &#8377;{money(totals.boughtValue)}</Fact>
                {totals.returnedQty > 0 && <Fact label="Came back">{totals.returnedQty}</Fact>}
              </section>

              <section style={{ marginBottom: 20 }}>
                <h4 style={{ marginBottom: 8 }}>Other parts you could use instead</h4>
                {showing.alternates.length === 0 ? (
                  <p className="text-muted" style={{ fontSize: 13 }}>Nothing else in your inventory looks like this part.</p>
                ) : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {showing.alternates.map((alternate) => (
                      <button key={alternate.id} className="btn btn-secondary"
                        style={{ justifyContent: 'space-between', textAlign: 'left', width: '100%' }}
                        onClick={() => onOpenPart(alternate.id)}>
                        <span>
                          <strong>{alternate.name}</strong>
                          {alternate.part_number && <span className="pn-chip" style={{ marginLeft: 8 }}>{alternate.part_number}</span>}
                          <span className="text-muted" style={{ display: 'block', fontSize: 12, fontWeight: 400 }}>
                            {alternate.detail} · {amount(alternate.current_stock)} in stock
                            {amount(alternate.sale_price) > 0 && ` · ₹${money(amount(alternate.sale_price))}`}
                          </span>
                        </span>
                        <ArrowRight size={14} />
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section style={{ marginBottom: 20 }}>
                <h4 style={{ marginBottom: 4 }}>Stock on the shelf</h4>
                {showing.overview.batches.length === 0 ? (
                  <p className="text-muted" style={{ fontSize: 13 }}>
                    <AlertTriangle size={13} /> No purchase batch recorded, so a sale of this part is costed from its own cost price.
                  </p>
                ) : (
                  <>
                    <p className="text-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
                      What you have of this part, batch by batch. The oldest batch is sold first, at the cost it came in at.
                    </p>
                    {shelfBatches.length === 0 ? (
                      <p className="text-muted" style={{ fontSize: 13 }}>Nothing of this part is left on the shelf.</p>
                    ) : (
                      <div className="table-wrap">
                        <table className="erp-table">
                          <thead><tr><th>Came in on</th><th>From</th><th className="text-right">On the shelf</th><th className="text-right">Cost each</th></tr></thead>
                          <tbody>
                            {shelfBatches.map((batch) => (
                              <tr key={batch.id}>
                                <td>{formatDay(batch.boughtOn)}</td>
                                <td>{batch.source ?? 'Opening stock'}</td>
                                <td className="text-right"><strong>{batch.left}</strong> <span className="text-muted">of {batch.bought}</span></td>
                                <td className="text-right">&#8377;{money(batch.unitCost)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {usedUpBatches > 0 && (
                      <p className="text-muted" style={{ fontSize: 12.5, marginTop: 8 }}>
                        {usedUpBatches === 1 ? 'One earlier batch is' : `${usedUpBatches} earlier batches are`} used up, so not listed.
                      </p>
                    )}
                  </>
                )}
              </section>

              <section style={{ marginBottom: 20 }}>
                <h4 style={{ marginBottom: 8 }}>Sold</h4>
                {showing.overview.sales.length === 0 ? <p className="text-muted" style={{ fontSize: 13 }}>Never sold yet.</p> : (
                  <div className="table-wrap">
                    <table className="erp-table">
                      <thead><tr><th>Date</th><th>Bill</th><th>Customer</th><th className="text-right">Qty</th><th className="text-right">Rate</th></tr></thead>
                      <tbody>
                        {showing.overview.sales.map((line) => (
                          <tr key={line.id}>
                            <td>{formatDay(line.date)}</td><td>{line.documentId}</td><td>{line.who}</td>
                            <td className="text-right">{line.qty}</td><td className="text-right">&#8377;{money(line.rate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section>
                <h4 style={{ marginBottom: 8 }}>Bought</h4>
                {showing.overview.purchases.length === 0 ? <p className="text-muted" style={{ fontSize: 13 }}>No purchase recorded for this part.</p> : (
                  <div className="table-wrap">
                    <table className="erp-table">
                      <thead><tr><th>Date</th><th>Order</th><th>Supplier</th><th className="text-right">Qty</th><th className="text-right">Cost</th></tr></thead>
                      <tbody>
                        {showing.overview.purchases.map((line) => (
                          <tr key={line.id}>
                            <td>{formatDay(line.date)}</td><td>{line.documentId}</td><td>{line.who}</td>
                            <td className="text-right">{line.qty}</td><td className="text-right">&#8377;{money(line.rate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          {part && <button className="btn btn-primary" onClick={() => onEdit(part.id)}><Edit size={14} /> Edit this part</button>}
        </div>
      </div>

      {/* The photo at full size over everything. A click anywhere or Esc closes it. */}
      {viewingPhoto && photo && part && (
        <div className="photo-viewer" role="dialog" aria-modal="true" aria-label={`Photo of ${part.name}`} onClick={() => setViewingPhoto(false)}>
          <button type="button" className="photo-viewer-close" aria-label="Close the photo" onClick={() => setViewingPhoto(false)}>
            <X size={20} />
          </button>
          <figure className="photo-viewer-figure">
            {/* Plain <img>, as in PartPhoto: next/image would need every storage host configured. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt={`Photo of ${part.name}`} />
            <figcaption>
              {part.name}{part.part_number ? ` · ${part.part_number}` : ''}
              {photo.source === 'catalog' ? ' · picture from your Website Catalog' : ''}
            </figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}
