'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles, RefreshCw } from 'lucide-react';

type Props = {
  reportType: string;
  data: unknown;
};

export default function AIReportSummary({ reportType, data }: Props) {
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Guards against out-of-order responses: while data is still loading (invoices/purchaseOrders
  // resolve async), this can fire once with an empty digest and again with the real one — without
  // this, a slower first response can land after and overwrite the correct later one.
  const requestId = useRef(0);

  const dataKey = JSON.stringify(data);

  const fetchSummary = async () => {
    const thisRequest = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai-report-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportType, data }),
      });
      const body = await res.json();
      if (thisRequest !== requestId.current) return;
      if (!res.ok) throw new Error(body.error || 'Failed to summarize this report.');
      setSummary(body.summary);
    } catch (err) {
      if (thisRequest !== requestId.current) return;
      setError(err instanceof Error ? err.message : 'Failed to summarize this report.');
    } finally {
      if (thisRequest === requestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(fetchSummary, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportType, dataKey]);

  return (
    <div className="card mb-4" style={{ padding: '14px 16px' }}>
      <div className="flex items-center justify-between" style={{ marginBottom: loading || error || summary ? '8px' : 0 }}>
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-brand" />
          <span style={{ fontSize: '13px', fontWeight: 600 }}>AI Summary</span>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={fetchSummary} disabled={loading} aria-label="Refresh summary">
          <RefreshCw size={13} className={loading ? 'spin' : ''} />
        </button>
      </div>
      {loading && <div className="skeleton" style={{ height: '14px', width: '80%' }} />}
      {error && <p style={{ fontSize: '13px', color: 'var(--color-danger)' }}>{error}</p>}
      {!loading && !error && summary && <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{summary}</p>}
    </div>
  );
}
