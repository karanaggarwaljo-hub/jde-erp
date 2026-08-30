'use client';

import { useState } from 'react';
import { Sparkles, Copy, Check } from 'lucide-react';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import { TIER_LABELS, FLAG_LABELS, TIER_ACTIONS, FLAG_ACTIONS, type CustomerInsight } from '@/lib/customer-insights';

type Props = {
  insight: CustomerInsight;
  onClose: () => void;
};

/**
 * Drafting an offer message for one customer.
 *
 * Deliberately not "generate me an offer": the owner types the actual terms and the AI only words
 * them. An offer is a commitment — a model that invented "15% off this week" would be writing
 * something the owner has to honour once it is sent. The guidance shown above the box comes from
 * the hardcoded TIER_ACTIONS/FLAG_ACTIONS in lib/customer-insights.ts, not from a model, so the
 * suggestion of what *kind* of offer suits this segment is stable and reviewable.
 */
export default function SegmentOfferModal({ insight, onClose }: Props) {
  const [offer, setOffer] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const draft = async () => {
    if (!offer.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai-draft-offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: insight.name,
          offer,
          tier: insight.tier,
          flags: insight.flags,
          orderCount: insight.orderCount,
          lastPurchaseDate: insight.lastPurchaseDate,
        }),
      });
      const body = (await parseJsonOrThrow(res, 'Failed to draft this offer.')) as { message: string };
      setMessage(body.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to draft this offer.');
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: '520px' }} role="dialog" aria-modal="true" aria-labelledby="offer-modal-title">
        <div className="modal-header">
          <h3 id="offer-modal-title" className="modal-title flex items-center gap-2"><Sparkles size={16} /> Draft an offer</h3>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body flex flex-col gap-3">
          <div>
            <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
              <strong>{insight.name}</strong>
              <span className="badge badge-info">{TIER_LABELS[insight.tier]}</span>
              {insight.flags.map((flag) => (
                <span key={flag} className={`badge ${flag === 'defaulter' ? 'badge-danger' : 'badge-warning'}`}>{FLAG_LABELS[flag]}</span>
              ))}
            </div>
            {/* Fixed guidance, not model output — what suits this segment shouldn't vary run to run. */}
            <p className="text-muted text-sm" style={{ marginTop: '6px' }}>
              {TIER_ACTIONS[insight.tier]}
              {insight.flags.map((flag) => <span key={flag}> {FLAG_ACTIONS[flag]}</span>)}
            </p>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="offer-terms">What are you offering?</label>
            <textarea
              id="offer-terms"
              className="form-input"
              rows={3}
              placeholder="e.g. 5% off on orders above ₹20,000 through September, or free delivery on the next order"
              value={offer}
              onChange={(event) => setOffer(event.target.value)}
              disabled={loading}
            />
            <span className="text-muted text-sm">
              You set the terms — the draft only words them. Nothing you haven&apos;t written here will be promised.
            </span>
          </div>

          {error && (
            <div className="attention-item danger" style={{ cursor: 'default' }}>
              <div><p>Couldn&apos;t draft this offer</p><span>{error}</span></div>
            </div>
          )}

          {loading && (
            <div style={{ display: 'grid', gap: '8px' }}>
              <div className="skeleton" style={{ height: '14px', width: '95%' }} />
              <div className="skeleton" style={{ height: '14px', width: '85%' }} />
              <div className="skeleton" style={{ height: '14px', width: '60%' }} />
            </div>
          )}

          {message && !loading && (
            <div className="form-group">
              <label className="form-label" htmlFor="offer-message">Message — review before sending, edit freely</label>
              <textarea
                id="offer-message"
                className="form-input"
                rows={6}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-secondary" disabled={!offer.trim() || loading} onClick={draft}>
            {loading ? 'Drafting…' : message ? 'Redraft' : 'Draft message'}
          </button>
          <button type="button" className="btn btn-primary" disabled={!message || loading} onClick={copy}>
            {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy message</>}
          </button>
        </div>
      </div>
    </div>
  );
}
