'use client';

/**
 * Starting the active company fresh: stock and prices cleared, every bill, purchase and payment
 * deleted, customers deleted — while the parts list, the suppliers and the website stay.
 *
 * Owner-only, and built so it cannot be done by accident: it states exactly what will happen from
 * live counts, the company's name has to be typed back, a full backup is taken first, and the
 * database does all of it in one go or none of it.
 */

import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useCompany } from '@/components/CompanyProvider';
import { confirmationMatches, startFreshPlan, type StartFreshCounts } from '@/lib/start-fresh';
import { fetchStartFreshCounts, startCompanyFresh, type StartFreshOutcome } from '@/lib/client-start-fresh';

function List({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{title}</div>
      {items.length === 0
        ? <p className="text-muted" style={{ fontSize: 13 }}>{empty}</p>
        : <ul style={{ paddingLeft: 18, display: 'grid', gap: 4, fontSize: 13 }}>{items.map((item) => <li key={item}>{item}</li>)}</ul>}
    </div>
  );
}

export default function StartFreshCard() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? '';
  const [loaded, setLoaded] = useState<{ companyId: string; counts: StartFreshCounts } | null>(null);
  const [loadError, setLoadError] = useState('');
  // Bumped after a reset, to count again.
  const [version, setVersion] = useState(0);
  const [typed, setTyped] = useState('');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const [outcome, setOutcome] = useState<StartFreshOutcome | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let active = true;
    void (async () => {
      try {
        const counts = await fetchStartFreshCounts(companyId);
        if (active) {
          setLoaded({ companyId, counts });
          setLoadError('');
        }
      } catch (cause) {
        if (active) setLoadError(cause instanceof Error ? cause.message : 'Could not count what would be cleared.');
      }
    })();
    return () => { active = false; };
  }, [companyId, version]);

  if (!activeCompany) return null;
  const counts = loaded && loaded.companyId === companyId ? loaded.counts : null;
  const plan = counts ? startFreshPlan(counts) : null;
  const confirmed = confirmationMatches(typed, activeCompany.name);

  const run = async () => {
    if (!confirmed || running) return;
    setRunning(true);
    setRunError('');
    setOutcome(null);
    try {
      setOutcome(await startCompanyFresh(companyId, typed));
      setTyped('');
      setVersion((value) => value + 1);
    } catch (cause) {
      setRunError(cause instanceof Error ? cause.message : 'Nothing was changed.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: 24, borderColor: 'var(--color-danger)' }}>
      <div className="card-header">
        <div>
          <h3 className="card-title">Start {activeCompany.name} fresh</h3>
          <p className="text-muted" style={{ fontSize: 13, marginTop: 2 }}>
            For starting again with a clean slate. Your parts list stays, so you do not have to enter it again.
          </p>
        </div>
        <span className="badge badge-danger">Cannot be undone</span>
      </div>
      <div className="p-4 pt-0">
        {loadError && <p className="form-error" role="alert">{loadError}</p>}
        {!plan && !loadError && <p className="text-muted">Counting&hellip;</p>}
        {plan && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18, marginBottom: 16 }}>
            <List title="Cleared" items={plan.cleared} empty="No stock or prices to clear." />
            <List title="Deleted" items={plan.deleted} empty="No bills, purchases, payments or customers." />
            <List title="Kept" items={plan.kept} empty="" />
          </div>
        )}
        <p className="text-muted" style={{ fontSize: 13, marginBottom: 14 }}>
          A full backup of everything is taken first. If it cannot be taken, nothing is changed. New bills,
          purchases and receipts carry on numbering from where they stopped, so no number is ever given out twice.
        </p>

        {outcome && (
          <div className="alert alert-success mb-4" role="status">
            Done. {outcome.summary}. A backup was saved first as {outcome.backup}.
          </div>
        )}
        {runError && <div className="alert alert-danger mb-4" role="alert">{runError}</div>}

        <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: '1 1 260px', marginBottom: 0 }}>
            <label className="form-label" htmlFor="start-fresh-confirm">Type <strong>{activeCompany.name}</strong> to confirm</label>
            <input id="start-fresh-confirm" className="form-input" value={typed} autoComplete="off"
              disabled={running || !plan || plan.nothingToDo} onChange={(event) => setTyped(event.target.value)} />
          </div>
          <button type="button" className="btn btn-danger" disabled={!confirmed || running || !plan || plan.nothingToDo} onClick={run}>
            <RotateCcw size={14} /> {running ? 'Backing up and clearing…' : 'Start fresh'}
          </button>
        </div>
      </div>
    </div>
  );
}
