'use client';

import { useEffect, useState } from 'react';
import { Sparkles, Copy, Check } from 'lucide-react';

type Props = {
  direction: 'receivable' | 'payable';
  name: string;
  balance: number;
  context?: string;
  onClose: () => void;
};

export default function PaymentReminderModal({ direction, name, balance, context, onClose }: Props) {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/ai-draft-reminder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ direction, name, balance, context }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Failed to draft a message.');
        if (!cancelled) setMessage(body.message);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to draft a message.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async () => {
    await navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: '480px' }} role="dialog" aria-modal="true" aria-labelledby="reminder-modal-title">
        <div className="modal-header">
          <h3 id="reminder-modal-title" className="modal-title flex items-center gap-2"><Sparkles size={16} /> {direction === 'receivable' ? 'Payment Reminder' : 'Payment Follow-up'}</h3>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body flex flex-col gap-3">
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Drafted for <strong>{name}</strong> — ₹{balance.toLocaleString('en-IN')}. Review before sending; edit freely.
          </p>

          {loading && (
            <div style={{ display: 'grid', gap: '8px' }}>
              <div className="skeleton" style={{ height: '14px', width: '95%' }} />
              <div className="skeleton" style={{ height: '14px', width: '85%' }} />
              <div className="skeleton" style={{ height: '14px', width: '60%' }} />
            </div>
          )}

          {error && (
            <div className="attention-item danger" style={{ cursor: 'default' }}>
              <div><p>Couldn&apos;t draft a message</p><span>{error}</span></div>
            </div>
          )}

          {!loading && !error && (
            <textarea
              className="form-input"
              rows={5}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-primary" disabled={loading || !!error || !message} onClick={copy}>
            {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy message</>}
          </button>
        </div>
      </div>
    </div>
  );
}
