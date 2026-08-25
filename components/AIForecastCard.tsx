'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, RefreshCw, ArrowRight, PackageSearch } from 'lucide-react';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import { AiCacheNote, describeGenerated, type CacheMeta } from './AiCacheNote';

type ForecastItem = {
  part_number: string;
  name: string;
  current_stock: number;
  min_stock: number;
  recommended_order_qty: number;
  urgency: 'low' | 'medium' | 'high';
  reason: string;
};

type Forecast = {
  headline: string;
  confidence: 'low' | 'medium' | 'high';
  items: ForecastItem[];
};

const confidenceBadge = { low: 'badge-warning', medium: 'badge-info', high: 'badge-success' } as const;
const urgencyBadge = { low: 'badge-info', medium: 'badge-warning', high: 'badge-danger' } as const;

export default function AIForecastCard() {
  const router = useRouter();
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<CacheMeta | null>(null);

  // `manual` marks a press of Refresh, which is allowed to spend one of the day's two AI runs.
  // An automatic load never does — it shows the stored answer unless one is genuinely due.
  const fetchForecast = async (manual = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai-forecast${manual ? '?refresh=1' : ''}`);
      const body = (await parseJsonOrThrow(res, 'Failed to generate forecast.')) as { forecast: Forecast; cache?: CacheMeta };
      setForecast(body.forecast);
      setMeta(body.cache ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate forecast.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => fetchForecast(false), 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="card mb-6 forecast-hero">
      <div className="flex items-start gap-4">
        <div className="forecast-icon"><Sparkles size={24} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="forecast-title">AI Stock Reorder Recommendation</h3>
            {forecast && <span className={`badge ${confidenceBadge[forecast.confidence]}`}>{forecast.confidence} confidence</span>}
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
            {describeGenerated(meta) ?? 'Based on current stock levels and each part’s reorder level'}
          </p>

          {loading && !forecast && (
            <div style={{ display: 'grid', gap: '10px', marginTop: '12px' }}>
              <div className="skeleton" style={{ height: '16px', width: '70%' }} />
              <div className="skeleton" style={{ height: '14px', width: '90%' }} />
            </div>
          )}

          {error && (
            <p className="forecast-copy text-danger" style={{ marginTop: '10px' }}>{error}</p>
          )}

          {forecast && (
            <>
              <p className="forecast-copy" style={{ marginTop: '10px' }}>{forecast.headline}</p>

              {forecast.items.length > 0 && (
                <div className="ai-insights-list" style={{ marginTop: '14px' }}>
                  {forecast.items.map((item) => (
                    <div key={item.part_number} className="ai-insights-row">
                      <PackageSearch size={15} className="text-warning" />
                      <div>
                        <span className="ai-insights-row-title">
                          {item.name} <span className={`badge ${urgencyBadge[item.urgency]}`}>{item.urgency}</span>
                        </span>
                        <span className="ai-insights-row-detail">
                          {item.part_number} · {item.current_stock} in stock (min {item.min_stock}) · reorder {item.recommended_order_qty} units — {item.reason}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <AiCacheNote meta={meta} />

          <div className="flex gap-2 mt-4">
            <button className="btn btn-primary btn-sm" onClick={() => router.push('/purchases')}>
              Review Purchase Orders <ArrowRight size={14} />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => fetchForecast(true)} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'spin' : ''} /> {loading ? 'Analyzing…' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
