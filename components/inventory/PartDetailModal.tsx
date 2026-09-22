'use client';

/**
 * One part, opened from its row: what it fits, what it is worth, what it has done, and what else
 * could be sold in its place.
 *
 * Everything shown is this company's own recorded data — no estimate is presented as a fact. An
 * alternative always carries the reason it was offered, and clicking one opens that part here, so
 * a customer asking "what else have you got" is a couple of clicks rather than a search and a guess.
 */

import { useEffect, useState } from 'react';
import { X, ArrowRight, AlertTriangle, Edit } from 'lucide-react';
import { money } from '@/lib/money';
import { looksLikeAnInventedCode } from '@/lib/detail-import';
import { marginPercent } from '@/lib/margin';
import { fetchPartDetail, type PartDetail } from '@/lib/client-part-overview';

export type PartDetailModalProps = {
  companyId: string;
  productId: string;
  /** Opening an alternative swaps this panel over to that part. */
  onOpenPart: (productId: string) => void;
  onClose: () => void;
  onEdit: (productId: string) => void;
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

export default function PartDetailModal({ companyId, productId, onOpenPart, onClose, onEdit }: PartDetailModalProps) {
  const [detail, setDetail] = useState<PartDetail | null>(null);
  const [failure, setFailure] = useState<{ productId: string; message: string } | null>(null);

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
  }, [companyId, productId]);

  const showing = detail && detail.part.id === productId ? detail : null;
  const error = failure && failure.productId === productId ? failure.message : '';
  const loading = !showing && !error;

  const part = showing?.part;
  const totals = showing?.overview.totals;
  const margin = part ? marginPercent(amount(part.sale_price), totals?.nextCost ?? amount(part.cost_price)) : null;

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
              <section style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 13, marginBottom: 4 }} className="text-muted">Fits</div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>
                  {part.compatibility || <span className="text-muted" style={{ fontWeight: 400 }}>Not recorded yet &mdash; add it with Edit</span>}
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
                <h4 style={{ marginBottom: 8 }}>Stock on the shelf</h4>
                {showing.overview.batches.length === 0 ? (
                  <p className="text-muted" style={{ fontSize: 13 }}>
                    <AlertTriangle size={13} /> No purchase batch recorded, so a sale of this part is costed from its own cost price.
                  </p>
                ) : (
                  <table className="table">
                    <thead><tr><th>Bought on</th><th className="text-right">Left</th><th className="text-right">Of</th><th className="text-right">Cost each</th></tr></thead>
                    <tbody>
                      {showing.overview.batches.map((batch) => (
                        <tr key={batch.id}>
                          <td>{batch.boughtOn}</td>
                          <td className="text-right">{batch.left}</td>
                          <td className="text-right">{batch.bought}</td>
                          <td className="text-right">&#8377;{money(batch.unitCost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section style={{ marginBottom: 20 }}>
                <h4 style={{ marginBottom: 8 }}>Sold</h4>
                {showing.overview.sales.length === 0 ? <p className="text-muted" style={{ fontSize: 13 }}>Never sold yet.</p> : (
                  <table className="table">
                    <thead><tr><th>Date</th><th>Bill</th><th>Customer</th><th className="text-right">Qty</th><th className="text-right">Rate</th></tr></thead>
                    <tbody>
                      {showing.overview.sales.map((line) => (
                        <tr key={line.id}>
                          <td>{line.date}</td><td>{line.documentId}</td><td>{line.who}</td>
                          <td className="text-right">{line.qty}</td><td className="text-right">&#8377;{money(line.rate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section>
                <h4 style={{ marginBottom: 8 }}>Bought</h4>
                {showing.overview.purchases.length === 0 ? <p className="text-muted" style={{ fontSize: 13 }}>No purchase recorded for this part.</p> : (
                  <table className="table">
                    <thead><tr><th>Date</th><th>Order</th><th>Supplier</th><th className="text-right">Qty</th><th className="text-right">Cost</th></tr></thead>
                    <tbody>
                      {showing.overview.purchases.map((line) => (
                        <tr key={line.id}>
                          <td>{line.date}</td><td>{line.documentId}</td><td>{line.who}</td>
                          <td className="text-right">{line.qty}</td><td className="text-right">&#8377;{money(line.rate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
    </div>
  );
}
