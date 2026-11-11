import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Mail, RefreshCw, Unplug } from 'lucide-react';
import { InboxService, type InboxStatus, type SyncSummary } from '../../../../shared/portal/services/InboxService';

/**
 * Connect an email inbox so CAS statements are imported automatically.
 *
 * Self-contained: it checks whether the server can do this and whether a mailbox
 * is already connected, and renders nothing until it knows the feature is on —
 * so it never shows a client an option that would only error.
 *
 * Connecting leaves the app for the provider's consent screen and returns
 * through a page the proxy serves; on return the client is back here and the
 * status reflects the new connection.
 */
const PROVIDERS = [
  { value: 'gmail', label: 'Gmail' },
  { value: 'outlook', label: 'Outlook' },
  { value: 'zoho', label: 'Zoho' },
];

export function ConnectInbox({ onImported }: { onImported: () => void }) {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<InboxStatus>({ connected: false });
  const [provider, setProvider] = useState('gmail');
  const [busy, setBusy] = useState<'connect' | 'sync' | 'disconnect' | null>(null);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<SyncSummary | null>(null);

  useEffect(() => {
    let alive = true;
    void InboxService.enabled().then(async (on) => {
      if (!alive || !on) return;
      const s = await InboxService.status();
      if (!alive) return;
      setStatus(s);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!ready) return null;

  const connect = async () => {
    setError('');
    setBusy('connect');
    const r = await InboxService.connect(provider);
    if (!r.ok) {
      setBusy(null);
      return setError(r.error);
    }
    // Leaves the SPA for the provider's consent screen.
    window.location.href = r.oauthUrl;
  };

  const sync = async () => {
    setError('');
    setSummary(null);
    setBusy('sync');
    const r = await InboxService.sync();
    setBusy(null);
    if (!r.ok) return setError(r.error);
    if (r.summary.reconnectNeeded) {
      setStatus({ connected: false });
      return setError('Your email connection expired. Please connect again.');
    }
    setSummary(r.summary);
    if (r.summary.imported > 0) onImported();
  };

  const disconnect = async () => {
    setBusy('disconnect');
    await InboxService.disconnect();
    setBusy(null);
    setStatus({ connected: false });
    setSummary(null);
  };

  return (
    <div className="rounded-token-lg border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-token-md bg-accent/10">
          <Mail className="h-4 w-4 text-accent" />
        </span>
        <div className="min-w-0 flex-1">
          {status.connected ? (
            <>
              <p className="text-sm font-semibold text-text-primary">
                Email connected
                {status.provider ? <span className="font-normal text-text-muted"> · {status.provider}</span> : null}
              </p>
              <p className="truncate text-xs text-text-muted">
                {status.email ?? 'We check for new statements when you ask.'}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-text-primary">Import statements from your email</p>
              <p className="text-xs text-text-muted">
                Connect once and we bring in CAS statements automatically — no uploads.
              </p>
            </>
          )}
        </div>

        {status.connected ? (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={sync}
              disabled={busy !== null}
              className="press flex items-center gap-1.5 rounded-token-md px-3 py-1.5 text-xs font-bold text-text-on-accent disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
            >
              {busy === 'sync' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {busy === 'sync' ? 'Checking…' : 'Sync now'}
            </button>
            <button
              type="button"
              onClick={disconnect}
              disabled={busy !== null}
              title="Disconnect"
              className="rounded-token-md border border-border p-1.5 text-text-faint hover:text-danger-soft disabled:opacity-50"
            >
              <Unplug className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="rounded-token-md border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary outline-none"
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={connect}
              disabled={busy !== null}
              className="press flex items-center gap-1.5 rounded-token-md px-3 py-1.5 text-xs font-bold text-text-on-accent disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
            >
              {busy === 'connect' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Connect
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-danger-soft">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      {summary && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-text-muted">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success-soft" />
          {summary.imported > 0
            ? `Imported ${summary.imported} statement${summary.imported === 1 ? '' : 's'} (${summary.holdings} holdings).`
            : summary.filesSeen === 0
              ? 'No new statements in your inbox yet.'
              : 'Nothing new to import.'}
          {summary.mfFound > 0 ? ` ${summary.mfFound} mutual-fund statement${summary.mfFound === 1 ? '' : 's'} found — import those from the statement screen.` : ''}
        </p>
      )}
    </div>
  );
}
