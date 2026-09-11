'use client';

import { useCallback, useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { useCompany } from '@/components/CompanyProvider';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';

type AuditRow = {
  id: string;
  at: string;
  actor_email: string;
  actor_name: string;
  action: string;
  entity: string;
  entity_id: string | null;
  summary: string;
  details: Record<string, unknown> | null;
};

// Categorical only, and deliberately not green / amber: this chip says what kind of thing
// happened, never whether it was good or bad. Deleting is the one exception - it is the action
// that cannot be undone, and it should catch the eye when scanning a long list.
const ACTION_TONE: Array<{ match: RegExp; color: string }> = [
  { match: /[.]delete$/, color: 'var(--chart-pink)' },
  { match: /^invoice[.]/, color: 'var(--chart-blue)' },
  { match: /payment/, color: 'var(--chart-teal)' },
  { match: /^purchase[.]/, color: 'var(--chart-orange)' },
  { match: /return/, color: 'var(--chart-violet)' },
];

function actionColor(action: string): string {
  return ACTION_TONE.find((tone) => tone.match.test(action))?.color ?? 'var(--ink-3)';
}

/** "invoice.edit" reads as "Invoice edit" - the machine key stays in the data, not on screen. */
function actionLabel(action: string): string {
  const words = action.replace(/[._]/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A before/after pair renders as one line per figure that actually moved. Anything else in
 *  `details` is left alone - this panel shows what changed, not a dump of the record. */
function changedFigures(details: Record<string, unknown> | null): Array<{ field: string; from: unknown; to: unknown }> {
  if (!details) return [];
  const before = details.before as Record<string, unknown> | null | undefined;
  const after = details.after as Record<string, unknown> | null | undefined;
  if (!before || !after) return [];
  return Object.keys(after)
    .filter((field) => String(before[field] ?? '') !== String(after[field] ?? ''))
    .map((field) => ({ field, from: before[field], to: after[field] }));
}

export default function AuditLogPanel() {
  const { activeCompany } = useCompany();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/audit-log?company_id=${encodeURIComponent(activeCompany.id)}`);
      setRows((await parseJsonOrThrow(res, 'Failed to load the audit trail.')) as AuditRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the audit trail.');
    } finally {
      setLoading(false);
    }
  }, [activeCompany]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3 className="card-title">Audit Logs</h3>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Every change to money, stock or records in this company, and who made it. Written by the
            server as each change is saved, so it cannot be edited from any screen, including this
            one. Recording started on 11 September 2026; nothing before that date was ever kept.
          </p>
        </div>
      </div>

      {error && (
        <div className="attention-item danger" style={{ cursor: 'default' }}>
          <div><p>Couldn&apos;t load the audit trail</p><span>{error}</span></div>
        </div>
      )}

      {loading ? (
        <div className="skeleton" style={{ height: '80px', width: '100%' }} />
      ) : (
        <div className="table-wrap">
          <table className="erp-table">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
            <tbody>
              {rows.map((row) => {
                const figures = changedFigures(row.details);
                const isOpen = expanded === row.id;
                return (
                  <tr key={row.id}>
                    <td className="text-muted" style={{ whiteSpace: 'nowrap', fontSize: '12px' }}>
                      {new Date(row.at).toLocaleString()}
                    </td>
                    <td style={{ fontSize: '12px' }}>
                      <div style={{ fontWeight: 600 }}>{row.actor_name || row.actor_email}</div>
                      {row.actor_name && <div className="text-muted">{row.actor_email}</div>}
                    </td>
                    <td>
                      <span
                        className="badge"
                        style={{ background: 'transparent', border: `1px solid ${actionColor(row.action)}`, color: actionColor(row.action) }}
                      >
                        {actionLabel(row.action)}
                      </span>
                      <div style={{ marginTop: '4px' }}>{row.summary}</div>
                    </td>
                    <td style={{ fontSize: '12px' }}>
                      {figures.length > 0 ? (
                        <ul style={{ margin: 0, paddingLeft: '16px' }}>
                          {figures.map((figure) => (
                            <li key={figure.field}>
                              {figure.field.replace(/_/g, ' ')}: <span className="text-muted">{String(figure.from ?? '-')}</span> &rarr; <strong>{String(figure.to ?? '-')}</strong>
                            </li>
                          ))}
                        </ul>
                      ) : row.details ? (
                        <>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExpanded(isOpen ? null : row.id)}>
                            {isOpen ? 'Hide' : 'Show'}
                          </button>
                          {isOpen && (
                            <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '11px' }}>
                              {JSON.stringify(row.details, null, 2)}
                            </pre>
                          )}
                        </>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && !error && (
                <tr><td colSpan={4}><div className="empty-state">
                  <ScrollText size={24} />
                  <p className="empty-state-title">Nothing recorded yet</p>
                  <p className="empty-state-desc">The next sale, purchase, payment or change to a part will appear here.</p>
                </div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
