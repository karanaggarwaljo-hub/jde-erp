'use client';

import { useEffect, useState } from 'react';
import { Sparkles, RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle, Lightbulb } from 'lucide-react';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import { AiCacheNote, describeGenerated, type CacheMeta } from './AiCacheNote';

type Trend = { label: string; detail: string; direction: 'up' | 'down' | 'flat' };
type Risk = { title: string; detail: string; severity: 'low' | 'medium' | 'high' };
type Recommendation = { action: string; reason: string };

type Insights = {
  headline: string;
  data_confidence: 'low' | 'medium' | 'high';
  key_trends: Trend[];
  forecast: { horizon: string; narrative: string };
  risks: Risk[];
  recommendations: Recommendation[];
};

const directionIcon = { up: TrendingUp, down: TrendingDown, flat: Minus } as const;
const severityBadge = { low: 'badge-info', medium: 'badge-warning', high: 'badge-danger' } as const;
const confidenceBadge = { low: 'badge-warning', medium: 'badge-info', high: 'badge-success' } as const;

export default function AIInsightsCard() {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<CacheMeta | null>(null);

  // Only a deliberate press of Refresh may spend one of the day's two AI runs.
  const fetchInsights = async (manual = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai-insights${manual ? '?refresh=1' : ''}`);
      const body = (await parseJsonOrThrow(res, 'Failed to generate insights.')) as { insights: Insights; cache?: CacheMeta };
      setInsights(body.insights);
      setMeta(body.cache ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate insights.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => fetchInsights(false), 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="card mb-6 ai-insights-card">
      <div className="card-header">
        <div className="flex items-center" style={{ gap: '10px' }}>
          <div className="ai-insights-icon"><Sparkles size={18} /></div>
          <div>
            <h3 className="card-title">AI Business Insights</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {describeGenerated(meta) ?? 'Trends, forecast, and recommended actions'}
            </p>
          </div>
        </div>
        <div className="flex items-center" style={{ gap: '8px' }}>
          {insights && (
            <span className={`badge ${confidenceBadge[insights.data_confidence]}`}>
              {insights.data_confidence} confidence
            </span>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => fetchInsights(true)} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> {loading ? 'Analyzing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {loading && !insights && (
        <div style={{ display: 'grid', gap: '10px' }}>
          <div className="skeleton" style={{ height: '18px', width: '60%' }} />
          <div className="skeleton" style={{ height: '14px', width: '90%' }} />
          <div className="skeleton" style={{ height: '14px', width: '80%' }} />
        </div>
      )}

      {error && (
        <div className="attention-item danger" style={{ cursor: 'default' }}>
          <div>
            <p>Couldn&apos;t generate insights</p>
            <span>{error}</span>
          </div>
        </div>
      )}

      {insights && (
        <div className="ai-insights-body">
          <p className="ai-insights-headline">{insights.headline}</p>

          {insights.key_trends.length > 0 && (
            <div className="ai-insights-section">
              <p className="eyebrow">Key trends</p>
              <div className="ai-insights-list">
                {insights.key_trends.map((trend) => {
                  const Icon = directionIcon[trend.direction];
                  return (
                    <div key={trend.label} className="ai-insights-row">
                      <Icon size={15} className={trend.direction === 'up' ? 'text-success' : trend.direction === 'down' ? 'text-danger' : 'text-muted'} />
                      <div>
                        <span className="ai-insights-row-title">{trend.label}</span>
                        <span className="ai-insights-row-detail">{trend.detail}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="ai-insights-section">
            <p className="eyebrow">Forecast &middot; {insights.forecast.horizon}</p>
            <p className="ai-insights-narrative">{insights.forecast.narrative}</p>
          </div>

          {insights.risks.length > 0 && (
            <div className="ai-insights-section">
              <p className="eyebrow">Risks to watch</p>
              <div className="ai-insights-list">
                {insights.risks.map((risk) => (
                  <div key={risk.title} className="ai-insights-row">
                    <AlertTriangle size={15} className="text-warning" />
                    <div>
                      <span className="ai-insights-row-title">
                        {risk.title} <span className={`badge ${severityBadge[risk.severity]}`}>{risk.severity}</span>
                      </span>
                      <span className="ai-insights-row-detail">{risk.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {insights.recommendations.length > 0 && (
            <div className="ai-insights-section">
              <p className="eyebrow">Recommended actions</p>
              <div className="ai-insights-list">
                {insights.recommendations.map((rec) => (
                  <div key={rec.action} className="ai-insights-row">
                    <Lightbulb size={15} className="text-info" />
                    <div>
                      <span className="ai-insights-row-title">{rec.action}</span>
                      <span className="ai-insights-row-detail">{rec.reason}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <AiCacheNote meta={meta} />
    </div>
  );
}
