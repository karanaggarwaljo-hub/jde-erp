'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sunrise, Wallet2, HandCoins, PackageSearch, TrendingUp, X } from 'lucide-react';

type PriorityType = 'collect_receivable' | 'pay_supplier' | 'restock' | 'sales_note';

type Priority = {
  type: PriorityType;
  title: string;
  detail: string;
  impact_amount: number;
  action_label: string;
  action_href: '/customers' | '/suppliers' | '/inventory' | '/sales';
};

type Briefing = { priorities: Priority[] };

type Digest = {
  date: string;
  yesterday_sales: { date: string; invoice_count: number; total: number };
  // Named to match lib/ai/digest.ts's buildDailyBriefingDigest() exactly — these are ALL
  // outstanding receivables/payables (balance > 0), not filtered to what's due today; there's no
  // due-date logic in that function, so a "_today"-suffixed name here would be misleading, not
  // just mismatched.
  outstanding_receivables: { count: number; total: number };
  outstanding_payables: { count: number; total: number };
  low_stock: { count: number };
};

const priorityIcon: Record<PriorityType, typeof Wallet2> = {
  collect_receivable: HandCoins,
  pay_supplier: Wallet2,
  restock: PackageSearch,
  sales_note: TrendingUp,
};

const STORAGE_KEY = 'jde_daily_briefing_last_shown';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function DailyBriefingModal() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/daily-briefing');
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to generate the daily briefing.');
      setBriefing(body.briefing);
      setDigest(body.digest);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate the daily briefing.');
    } finally {
      setLoading(false);
    }
  };

  const openModal = () => {
    setOpen(true);
    load();
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (window.localStorage.getItem(STORAGE_KEY) !== todayStr()) {
      window.localStorage.setItem(STORAGE_KEY, todayStr());
      timer = setTimeout(openModal, 0);
    }
    const handler = () => openModal();
    window.addEventListener('open-daily-briefing', handler);
    return () => {
      window.removeEventListener('open-daily-briefing', handler);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!open) return null;

  const goTo = (href: Priority['action_href']) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: '560px' }} role="dialog" aria-modal="true" aria-labelledby="briefing-title">
        <div className="modal-header">
          <div className="flex items-center gap-2">
            <Sunrise size={20} color="var(--brand-primary)" />
            <div>
              <h3 id="briefing-title" className="modal-title">Daily Briefing</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Jai Durga Enterprises · {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setOpen(false)}><X size={16} /></button>
        </div>

        <div className="modal-body">
          {loading && (
            <div style={{ display: 'grid', gap: '10px' }}>
              <div className="skeleton" style={{ height: '16px', width: '70%' }} />
              <div className="skeleton" style={{ height: '48px', width: '100%' }} />
              <div className="skeleton" style={{ height: '48px', width: '100%' }} />
            </div>
          )}

          {error && (
            <div className="attention-item danger" style={{ cursor: 'default' }}>
              <div><p>Couldn&apos;t generate today&apos;s briefing</p><span>{error}</span></div>
            </div>
          )}

          {digest && (
            <div className="flex items-center gap-2 flex-wrap mb-4" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              <span>Yesterday: <strong style={{ color: 'var(--text-primary)' }}>₹{digest.yesterday_sales.total.toLocaleString()}</strong> ({digest.yesterday_sales.invoice_count} invoices)</span>
              <span>·</span>
              <span>Receivables due: <strong style={{ color: 'var(--text-primary)' }}>₹{digest.outstanding_receivables.total.toLocaleString()}</strong></span>
              <span>·</span>
              <span>Payables due: <strong style={{ color: 'var(--text-primary)' }}>₹{digest.outstanding_payables.total.toLocaleString()}</strong></span>
              <span>·</span>
              <span>Low stock: <strong style={{ color: 'var(--text-primary)' }}>{digest.low_stock.count}</strong></span>
            </div>
          )}

          {briefing && briefing.priorities.length === 0 && !loading && (
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Nothing urgent today — no overdue receivables, supplier dues, or low stock.</p>
          )}

          {briefing && briefing.priorities.length > 0 && (
            <div className="ai-insights-list">
              {briefing.priorities.map((priority) => {
                const Icon = priorityIcon[priority.type];
                return (
                  <div key={priority.title} className="ai-insights-row">
                    <Icon size={16} className="text-warning" />
                    <div style={{ flex: 1 }}>
                      <span className="ai-insights-row-title">
                        {priority.title}
                        {priority.impact_amount > 0 && <span className="badge badge-warning">₹{priority.impact_amount.toLocaleString()}</span>}
                      </span>
                      <span className="ai-insights-row-detail">{priority.detail}</span>
                      <button className="btn btn-secondary btn-sm mt-2" onClick={() => goTo(priority.action_href)}>{priority.action_label}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={() => setOpen(false)}>Close</button>
        </div>
      </div>
    </div>
  );
}
