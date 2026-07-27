'use client';

import { useEffect, useState } from 'react';
import { DatabaseBackup } from 'lucide-react';

type Backup = { filename: string; size_bytes: number; created_at: string };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BackupsPanel() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/backup');
      if (!res.ok) throw new Error('Failed to load backups.');
      setBackups(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load backups.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, []);

  const backupNow = async () => {
    setCreating(true);
    setFeedback('');
    setError('');
    try {
      const res = await fetch('/api/backup', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Backup failed.');
      setFeedback(`Backup saved: ${body.filename}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backup failed.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3 className="card-title">Local Data Backups</h3>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            A JSON snapshot of your Supabase data is saved to this computer automatically once per day while the app is running. Backups older than 7 days are deleted automatically — your live data is never touched.
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={backupNow} disabled={creating}>
          <DatabaseBackup size={14} /> {creating ? 'Backing up…' : 'Backup Now'}
        </button>
      </div>

      {feedback && <div className="alert alert-success mb-4" role="status">{feedback}</div>}

      {error && (
        <div className="attention-item danger" style={{ cursor: 'default' }}>
          <div><p>Couldn&apos;t load backups</p><span>{error}</span></div>
        </div>
      )}

      {loading ? (
        <div className="skeleton" style={{ height: '80px', width: '100%' }} />
      ) : (
        <div className="table-wrap">
          <table className="erp-table">
            <thead><tr><th>Backup File</th><th>Created</th><th className="text-right">Size</th></tr></thead>
            <tbody>
              {backups.map((backup) => (
                <tr key={backup.filename}>
                  <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{backup.filename}</td>
                  <td className="text-muted">{new Date(backup.created_at).toLocaleString()}</td>
                  <td className="text-right">{formatSize(backup.size_bytes)}</td>
                </tr>
              ))}
              {backups.length === 0 && (
                <tr><td colSpan={3}><div className="empty-state"><DatabaseBackup size={24} /><p className="empty-state-title">No backups yet</p><p className="empty-state-desc">One will be created automatically today, or click &quot;Backup Now&quot;.</p></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
