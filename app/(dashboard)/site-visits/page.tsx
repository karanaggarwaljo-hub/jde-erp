'use client';

/**
 * Website visits: how many people open each page of jd-enterprise.com, and which pages lead to a
 * WhatsApp message, a call or a share (lib/site-visits.ts).
 *
 * The owner asked to see what brings people to the website. This answers it without an outside
 * analytics account: the four totals for the period, visits per day, then every blog post, product
 * and other page with its own counts, and where visitors came from. Counts only: no cookies and
 * nothing about who visited.
 */

import { useEffect, useState } from 'react';
import { Eye, MessageCircle, Phone, Share2, type LucideIcon } from 'lucide-react';
import { useCompany } from '@/components/CompanyProvider';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import type { PageLine, VisitSummary } from '@/lib/site-visits';

type Period = 7 | 30 | 90;
type Answer = VisitSummary & { storefront: boolean; period: Period; from: string; to: string };

const PERIODS: Array<{ days: Period; label: string }> = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
];
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://jd-enterprise.com').replace(/\/$/, '');
const SHOWN = 10;

const number = (value: number) => value.toLocaleString('en-IN');
const dayLabel = (day: string, withYear = false) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });

function Tile({ title, value, icon: Icon, note }: { title: string; value: number; icon: LucideIcon; note: string }) {
  return (
    <div className="kpi-card" style={{ '--kpi-color': 'var(--ink-2)', '--kpi-color-bg': 'var(--panel)' } as React.CSSProperties}>
      <div className="flex justify-between items-center">
        <span className="kpi-label">{title}</span>
        <div className="kpi-icon-wrap"><Icon size={18} aria-hidden="true" /></div>
      </div>
      <div className="kpi-value">{number(value)}</div>
      <div className="kpi-context">{note}</div>
    </div>
  );
}

/** Visits per day: one bar a day, anchored at the base line, the busiest day at full height. Each
 *  bar names its day and count when pointed at or tabbed to. One series, so no legend: the heading
 *  says what it is. The tables below hold every number. */
function VisitsChart({ days }: { days: VisitSummary['days'] }) {
  const most = Math.max(...days.map((entry) => entry.views), 0);
  const total = days.reduce((sum, entry) => sum + entry.views, 0);
  return (
    <div className="card visits-chart-card">
      <div className="flex justify-between items-center" style={{ gap: '8px', flexWrap: 'wrap' }}>
        <strong>Visits per day</strong>
        <span className="text-muted text-sm">{most > 0 ? `Busiest day: ${number(most)} visit${most === 1 ? '' : 's'}` : 'No visits counted in this period'}</span>
      </div>
      <div className="visits-chart" role="img" aria-label={`Visits per day from ${dayLabel(days[0]?.day ?? '')} to ${dayLabel(days[days.length - 1]?.day ?? '')}: ${number(total)} in all, ${number(most)} on the busiest day.`}>
        {days.map((entry) => {
          const tip = `${dayLabel(entry.day, true)}: ${number(entry.views)} visit${entry.views === 1 ? '' : 's'}`;
          return (
            <div key={entry.day} className="visits-chart-slot" tabIndex={0} data-tip={tip} aria-label={tip}>
              <span className="visits-chart-bar" style={{ height: most > 0 ? `${Math.max(entry.views > 0 ? 3 : 0, (entry.views / most) * 100)}%` : 0 }} />
            </div>
          );
        })}
      </div>
      <div className="visits-chart-axis text-muted text-sm">
        <span>{dayLabel(days[0]?.day ?? '')}</span>
        <span>{dayLabel(days[days.length - 1]?.day ?? '')}</span>
      </div>
    </div>
  );
}

function PageTable({ title, nameHeading, lines, shares }: { title: string; nameHeading: string; lines: PageLine[]; shares?: boolean }) {
  const [all, setAll] = useState(false);
  if (!lines.length) return null;
  const shown = all ? lines : lines.slice(0, SHOWN);
  return (
    <div className="table-wrap">
      <div className="tbl-toolbar"><strong>{title}</strong></div>
      <div style={{ overflowX: 'auto' }}>
        <table className="erp-table" style={{ minWidth: '560px' }}>
          <thead>
            <tr>
              <th>{nameHeading}</th>
              <th className="text-right">Visits</th>
              <th className="text-right">WhatsApp</th>
              <th className="text-right">Calls</th>
              {shares && <th className="text-right">Shares</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((line) => (
              <tr key={line.path}>
                <td style={{ maxWidth: '420px' }}>
                  <a href={`${SITE}${line.path}`} target="_blank" rel="noreferrer" className="part-name-btn" style={{ textAlign: 'left' }}>{line.title}</a>
                  <div className="text-muted text-sm truncate">{line.path}</div>
                </td>
                <td className="text-right">{number(line.counts.view)}</td>
                <td className="text-right">{number(line.counts.whatsapp)}</td>
                <td className="text-right">{number(line.counts.call)}</td>
                {shares && <td className="text-right">{number(line.counts.share)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lines.length > SHOWN && (
        <div style={{ padding: '10px 14px' }}>
          <button type="button" className="link-button text-sm" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${lines.length}`}</button>
        </div>
      )}
    </div>
  );
}

export default function SiteVisitsPage() {
  const { activeCompany, companies, configError } = useCompany();
  const [period, setPeriod] = useState<Period>(30);
  const [result, setResult] = useState<{ key: string; data?: Answer; error?: string } | null>(null);
  const key = activeCompany ? `${activeCompany.id}:${period}` : '';

  useEffect(() => {
    if (!activeCompany) return;
    let current = true;
    const want = `${activeCompany.id}:${period}`;
    (async () => {
      try {
        const res = await fetch(`/api/site-visits?companyId=${encodeURIComponent(activeCompany.id)}&days=${period}`, { cache: 'no-store' });
        const data = (await parseJsonOrThrow(res, 'The visit counts could not be read.')) as Answer;
        if (current) setResult({ key: want, data });
      } catch (cause) {
        if (current) setResult({ key: want, error: cause instanceof Error ? cause.message : 'The visit counts could not be read.' });
      }
    })();
    return () => { current = false; };
  }, [activeCompany, period]);

  const loading = !result || result.key !== key;
  const data = loading ? undefined : result?.data;
  const error = loading ? '' : result?.error ?? '';
  const storefrontName = companies.find((company) => company.is_storefront)?.name;
  const leads = data ? data.totals.whatsapp + data.totals.call : 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Website visits</h1>
          <p className="page-subtitle">How many people open each page of your website, and which pages bring WhatsApp messages and calls.</p>
        </div>
        <div className="tabs" role="tablist" aria-label="Period" style={{ marginLeft: 'auto' }}>
          {PERIODS.map((entry) => (
            <button key={entry.days} type="button" role="tab" aria-selected={period === entry.days} className={`tab${period === entry.days ? ' active' : ''}`} onClick={() => setPeriod(entry.days)}>
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      {configError && <div className="alert alert-danger mb-4" role="alert">Can&apos;t reach the database right now — {configError}</div>}
      {error && <div className="alert alert-danger mb-4" role="alert">{error}</div>}
      {loading && !configError && <p className="text-muted">Loading the visit counts…</p>}

      {data && !data.storefront && (
        <div className="empty-state">
          <p className="empty-state-title">Visits are counted for the company your website shows</p>
          <p className="empty-state-desc">{storefrontName ? `That is ${storefrontName}. Switch to it to see its visits.` : 'No company is set to be shown on the website yet.'}</p>
        </div>
      )}

      {data && data.storefront && (
        <>
          <div className="kpi-grid">
            <Tile title="Visits" value={data.totals.view} icon={Eye} note="Pages opened in a browser" />
            <Tile title="WhatsApp taps" value={data.totals.whatsapp} icon={MessageCircle} note="WhatsApp buttons and quote forms" />
            <Tile title="Calls" value={data.totals.call} icon={Phone} note="Call buttons tapped" />
            <Tile title="Shares" value={data.totals.share} icon={Share2} note="Articles shared on WhatsApp" />
          </div>

          {data.totals.view === 0 && leads === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No visits counted yet</p>
              <p className="empty-state-desc">Counting starts when the website update goes live. Open your website once, then come back here: your visit shows within a minute.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <VisitsChart days={data.days} />
              <PageTable title="Blog posts" nameHeading="Post" lines={data.posts} shares />
              <PageTable title="Products" nameHeading="Part" lines={data.products} />
              <PageTable title="Other pages" nameHeading="Page" lines={data.pages} />
              {data.sources.length > 0 && (
                <div className="table-wrap">
                  <div className="tbl-toolbar"><strong>Where visitors came from</strong></div>
                  <table className="erp-table">
                    <thead><tr><th>From</th><th className="text-right">Visits</th><th className="text-right">Share</th></tr></thead>
                    <tbody>
                      {data.sources.map((entry) => (
                        <tr key={entry.source}>
                          <td>{entry.label}</td>
                          <td className="text-right">{number(entry.views)}</td>
                          <td className="text-right">{Math.round((entry.views / Math.max(1, data.totals.view)) * 100)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <p className="text-muted text-sm" style={{ marginTop: '16px' }}>
            A visit is counted each time a page of your website is opened in a browser; search engine robots are not counted. Only the counts are kept: no cookies and nothing about who visited. Days run midnight to midnight, India time.
          </p>
        </>
      )}
    </div>
  );
}
