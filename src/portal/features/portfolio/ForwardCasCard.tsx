import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Copy, Forward, Loader2, RefreshCw } from 'lucide-react';
import { InboundEmailService, type InboundCheck } from '../../../../shared/portal/services/InboundEmailService';

/**
 * Forward-to-address import: the client forwards their CAS to a dedicated
 * address and it is imported automatically. No OAuth, no consent screen.
 *
 * Self-contained: renders nothing until it knows the feature is on. The address
 * is created lazily, on the client's first tap, so we never mint one for a
 * client who never uses it.
 */
export function ForwardCasCard({ onImported }: { onImported: () => void }) {
  const [ready, setReady] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [lastReceivedAt, setLastReceivedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<'create' | 'check' | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<InboundCheck | null>(null);

  useEffect(() => {
    let alive = true;
    void InboundEmailService.enabled().then(async (on) => {
      if (!alive || !on) return;
      const s = await InboundEmailService.status();
      if (!alive) return;
      setAddress(s.address);
      setLastReceivedAt(s.lastReceivedAt ?? null);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!ready) return null;

  const create = async () => {
    setError('');
    setBusy('create');
    const r = await InboundEmailService.ensure();
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setAddress(r.address);
  };

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the address is on screen to copy by hand */
    }
  };

  const check = async () => {
    setError('');
    setResult(null);
    setBusy('check');
    const r = await InboundEmailService.check();
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setResult(r.result);
    if (r.result.imported > 0) {
      setLastReceivedAt(new Date().toISOString());
      onImported();
    }
  };

  return (
    <div className="rounded-token-lg border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-token-md bg-accent/10">
          <Forward className="h-4 w-4 text-accent" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary">Forward your statements in</p>
          <p className="text-xs text-text-muted">
            {address
              ? 'Forward any CAS email here and we import it — no sign-in needed.'
              : 'Get a private address to forward your CAS statements to.'}
          </p>
        </div>
        {!address && (
          <button
            type="button"
            onClick={create}
            disabled={busy !== null}
            className="press flex shrink-0 items-center gap-1.5 rounded-token-md px-3 py-1.5 text-xs font-bold text-text-on-accent disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
          >
            {busy === 'create' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Get my address
          </button>
        )}
      </div>

      {address && (
        <div className="mt-3 flex items-center gap-2 rounded-token-md border border-border bg-bg-base px-3 py-2">
          <code className="min-w-0 flex-1 truncate text-xs text-text-primary">{address}</code>
          <button type="button" onClick={copy} className="shrink-0 text-text-faint hover:text-accent" aria-label="Copy address">
            {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-success-soft" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={check}
            disabled={busy !== null}
            className="flex shrink-0 items-center gap-1.5 rounded-token-md border border-border px-2.5 py-1 text-xs font-semibold text-text-muted hover:border-accent/40 disabled:opacity-50"
          >
            {busy === 'check' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {busy === 'check' ? 'Checking…' : 'Check now'}
          </button>
        </div>
      )}

      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-danger-soft">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      {result && !error && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-text-muted">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success-soft" />
          {result.imported > 0
            ? `Imported ${result.imported} statement${result.imported === 1 ? '' : 's'} (${result.holdings} holdings).`
            : 'Nothing new yet — forward a statement and check again in a moment.'}
          {result.mfFound > 0 ? ` ${result.mfFound} mutual-fund statement${result.mfFound === 1 ? '' : 's'} found — import those from the statement screen.` : ''}
        </p>
      )}

      {address && lastReceivedAt && !result && (
        <p className="mt-2 text-[11px] text-text-faint">Last statement received {new Date(lastReceivedAt).toLocaleDateString()}.</p>
      )}
    </div>
  );
}
