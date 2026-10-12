'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, HardDrive, RefreshCw, Unplug } from 'lucide-react';
import { useCompany } from '@/components/CompanyProvider';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';

type DriveStatus = {
  redirectUri: string;
  app: { clientId: string; updatedAt: string; usable: boolean } | null;
  connection: {
    email: string;
    connectedAt: string;
    connectedBy: string;
    folderLink: string | null;
    lastError: string | null;
    lastErrorAt: string | null;
  } | null;
  bills: { total: number; inDrive: number };
  invoices: { saved: number; inDrive: number };
};

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

/**
 * Settings -> Google Drive: where supplier bills and invoice PDFs are kept.
 *
 * Two steps, the first done once for the whole ERP: register the ERP with Google (a Client ID and
 * secret from the owner's own Google Cloud project — Google requires the account owner to do this),
 * then connect each company to a Google account. Everything after that is automatic.
 */
export default function DrivePanel({ outcome }: { outcome: { ok: boolean; message: string } | null }) {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? '';
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [editingApp, setEditingApp] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState<'' | 'save' | 'sync' | 'disconnect'>('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(outcome ? { ok: outcome.ok, text: outcome.message } : null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let active = true;
    void (async () => {
      try {
        const res = await fetch(`/api/drive?companyId=${encodeURIComponent(companyId)}`);
        const data = (await parseJsonOrThrow(res, 'Could not load the Google Drive settings.')) as DriveStatus;
        if (!active) return;
        setStatus(data);
        setLoadError('');
      } catch (error) {
        if (active) setLoadError(error instanceof Error ? error.message : 'Could not load the Google Drive settings.');
      }
    })();
    return () => { active = false; };
  }, [companyId, reloadKey]);

  // Back from Google: drop ?drive=… from the address so a refresh does not repeat the message.
  useEffect(() => {
    if (outcome && typeof window !== 'undefined') window.history.replaceState(null, '', '/settings?tab=drive');
  }, [outcome]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  const post = async (body: Record<string, unknown>, fallback: string) => {
    const res = await fetch('/api/drive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId, ...body }) });
    return parseJsonOrThrow(res, fallback);
  };

  const saveApp = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('save');
    setMessage(null);
    try {
      await post({ action: 'save-app', clientId, clientSecret }, 'Could not save the Google app details.');
      setClientSecret('');
      setEditingApp(false);
      setMessage({ ok: true, text: 'Saved. Now press Connect Google Drive below.' });
      reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not save the Google app details.' });
    } finally {
      setBusy('');
    }
  };

  const syncNow = async () => {
    setBusy('sync');
    setMessage(null);
    try {
      const result = (await post({ action: 'sync' }, 'Could not send the waiting files.')) as {
        bills: { sent: number; waiting: number; failed: number };
        invoices: { sent: number; waiting: number; failed: number };
      };
      const sent = result.bills.sent + result.invoices.sent;
      const failed = result.bills.failed + result.invoices.failed;
      const waiting = result.bills.waiting + result.invoices.waiting;
      setMessage({
        ok: failed === 0,
        text: `${sent ? `Sent ${result.bills.sent} supplier bill(s) and ${result.invoices.sent} invoice PDF(s) to Google Drive.` : 'Nothing was waiting.'}`
          + (waiting ? ` ${waiting} more are on their way.` : '')
          + (failed ? ` ${failed} could not be sent — see the note above.` : ''),
      });
      reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not send the waiting files.' });
    } finally {
      setBusy('');
    }
  };

  const disconnect = async () => {
    if (!status?.connection) return;
    const sure = window.confirm(
      `Disconnect Google Drive (${status.connection.email})?\n\nFiles already in the Drive stay there. New bills will be kept in the ERP until a Drive is connected again, and bills already in the Drive will not open from the ERP meanwhile.`,
    );
    if (!sure) return;
    setBusy('disconnect');
    setMessage(null);
    try {
      await post({ action: 'disconnect' }, 'Could not disconnect Google Drive.');
      setMessage({ ok: true, text: 'Google Drive disconnected. Files already there were left in place.' });
      reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not disconnect Google Drive.' });
    } finally {
      setBusy('');
    }
  };

  const copyRedirect = async () => {
    if (!status) return;
    try {
      await navigator.clipboard.writeText(status.redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const appReady = Boolean(status?.app?.usable);
  const showAppForm = status && (!appReady || editingApp);

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3 className="card-title flex items-center gap-2"><HardDrive size={18} /> Google Drive</h3>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Every supplier bill you upload and every sales invoice PDF is saved in your own Google Drive, in a folder
            called <strong>JDE ERP - {activeCompany?.name ?? 'your company'}</strong>, sorted by year and month. Open them
            from the ERP on any device, or straight from the Google Drive app. The ERP can only see the files it made
            itself — nothing else in your Drive.
          </p>
        </div>
      </div>

      {message && (
        <div className={`alert ${message.ok ? 'alert-success' : 'alert-danger'} mb-4`} role={message.ok ? 'status' : 'alert'}>{message.text}</div>
      )}
      {loadError && <div className="alert alert-danger mb-4" role="alert">{loadError}</div>}
      {!status && !loadError && <div className="skeleton" style={{ height: '120px', width: '100%' }} />}

      {status && (
        <div className="flex flex-col gap-6">
          <section>
            <h4 style={{ fontWeight: 700, marginBottom: '8px' }}>Step 1 — Register the ERP with Google (once)</h4>
            {appReady && !editingApp ? (
              <p className="flex items-center gap-2" style={{ fontSize: '13px' }}>
                <CheckCircle2 size={16} className="text-success" />
                Done. Client ID …{status.app!.clientId.split('-')[0].slice(-6)} saved {when(status.app!.updatedAt)}.
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingApp(true)}>Change</button>
              </p>
            ) : null}
            {status.app && !status.app.usable && (
              <p className="form-error mb-2">The saved Google secret can no longer be opened by this server. Paste the Client ID and secret again.</p>
            )}
            {showAppForm && (
              <>
                <p style={{ fontSize: '13px', marginBottom: '8px' }}>
                  Google only lets the owner of a Google account allow an app into its Drive, so this part is yours.
                  It takes about five minutes, in the same Google Cloud project as your Gemini key.
                </p>
                <ol style={{ fontSize: '13px', paddingLeft: '22px', lineHeight: 1.7, marginBottom: '12px', listStyle: 'decimal' }}>
                  <li>Open <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">console.cloud.google.com <ExternalLink size={11} style={{ display: 'inline' }} /></a> and choose your project at the top.</li>
                  <li><strong>APIs &amp; Services → Library</strong>: search <em>Google Drive API</em> and press <strong>Enable</strong>.</li>
                  <li><strong>APIs &amp; Services → OAuth consent screen</strong> (Google Auth Platform): <strong>Get started</strong>. App name <em>JDE ERP</em>, your email, Audience <strong>External</strong>, then <strong>Create</strong>.</li>
                  <li><strong>Audience</strong>: press <strong>Publish app</strong> and confirm. <em>Important</em> — while it says “Testing”, Google disconnects the Drive every 7 days.</li>
                  <li><strong>Clients</strong> (or Credentials): <strong>Create client</strong> → type <strong>Web application</strong>, name <em>JDE ERP</em>. Under <strong>Authorised redirect URIs</strong> press <strong>Add URI</strong> and paste:
                    <div className="flex items-center gap-2" style={{ margin: '6px 0' }}>
                      <code style={{ background: 'var(--panel-2)', padding: '4px 8px', borderRadius: '6px', wordBreak: 'break-all' }}>{status.redirectUri}</code>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={copyRedirect}><Copy size={13} /> {copied ? 'Copied' : 'Copy'}</button>
                    </div>
                    then <strong>Create</strong>.
                  </li>
                  <li>Google shows a <strong>Client ID</strong> and a <strong>Client secret</strong>. Paste both here and press Save.</li>
                </ol>
                <form onSubmit={saveApp} className="flex flex-col gap-3" style={{ maxWidth: '560px' }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="drive-client-id">Client ID</label>
                    <input id="drive-client-id" className="form-input" required autoComplete="off" spellCheck={false}
                      placeholder="1234567890-abc123.apps.googleusercontent.com" value={clientId} onChange={(event) => setClientId(event.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="drive-client-secret">Client secret</label>
                    <input id="drive-client-secret" className="form-input" required type="password" autoComplete="off" spellCheck={false}
                      value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} />
                    <span className="text-muted" style={{ fontSize: '12px' }}>Stored sealed on the server and never shown again, not even here.</span>
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" className="btn btn-primary" disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
                    {editingApp && <button type="button" className="btn btn-secondary" onClick={() => setEditingApp(false)}>Cancel</button>}
                  </div>
                </form>
              </>
            )}
          </section>

          <section>
            <h4 style={{ fontWeight: 700, marginBottom: '8px' }}>Step 2 — Connect {activeCompany?.name ?? 'this company'} to your Google Drive</h4>
            {!status.connection ? (
              <>
                <p style={{ fontSize: '13px', marginBottom: '8px' }}>
                  Google will ask which account to use, then show what the ERP may do: only see and change the files it
                  makes. Press <strong>Continue</strong> / <strong>Allow</strong>. If it says “Google hasn’t verified this
                  app”, that is your own app from step 1 — press <strong>Advanced</strong>, then <strong>Go to JDE ERP</strong>.
                </p>
                {appReady ? (
                  <a className="btn btn-primary" href={`/api/drive/connect?companyId=${encodeURIComponent(companyId)}`}><HardDrive size={15} /> Connect Google Drive</a>
                ) : (
                  <button type="button" className="btn btn-primary" disabled title="Finish step 1 first"><HardDrive size={15} /> Connect Google Drive</button>
                )}
                {status.bills.total > 0 && (
                  <p className="text-muted" style={{ fontSize: '12px', marginTop: '8px' }}>
                    {status.bills.total} supplier bill(s) are kept in the ERP meanwhile, and will be copied over when you connect.
                  </p>
                )}
              </>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="flex items-center gap-2" style={{ fontSize: '13px' }}>
                  <CheckCircle2 size={16} className="text-success" />
                  Connected to <strong>{status.connection.email || 'a Google account'}</strong> since {when(status.connection.connectedAt)}.
                  {status.connection.folderLink && (
                    <a href={status.connection.folderLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                      Open the folder <ExternalLink size={12} />
                    </a>
                  )}
                </p>
                {status.connection.lastError && (
                  <div className="alert alert-danger" role="alert">
                    <strong>Last problem ({status.connection.lastErrorAt ? when(status.connection.lastErrorAt) : 'recently'}):</strong> {status.connection.lastError}
                    <div style={{ marginTop: '6px' }}>
                      If it says access was refused or expired, press{' '}
                      <a href={`/api/drive/connect?companyId=${encodeURIComponent(companyId)}`}>Connect again</a>. Nothing is lost meanwhile — files wait in the ERP.
                    </div>
                  </div>
                )}
                <table className="erp-table" style={{ maxWidth: '520px' }}>
                  <tbody>
                    <tr><td>Supplier bills</td><td className="text-right"><strong>{status.bills.inDrive}</strong> of {status.bills.total} in Google Drive</td></tr>
                    <tr><td>Sales invoice PDFs</td><td className="text-right"><strong>{status.invoices.inDrive}</strong> of {status.invoices.saved} up to date in Google Drive</td></tr>
                  </tbody>
                </table>
                <p className="text-muted" style={{ fontSize: '12px' }}>
                  New files go to the Drive as they are saved; anything that could not (no internet, Google busy) is sent
                  every night on its own.
                </p>
                <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-secondary" disabled={busy !== ''} onClick={syncNow}>
                    <RefreshCw size={14} /> {busy === 'sync' ? 'Sending…' : 'Send waiting files now'}
                  </button>
                  <button type="button" className="btn btn-ghost" disabled={busy !== ''} onClick={disconnect}>
                    <Unplug size={14} /> {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
