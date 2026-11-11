import { useEffect, useState } from 'react';
import { AlertTriangle, BadgeCheck, Copy, ExternalLink, Loader2, RefreshCw, ShieldQuestion } from 'lucide-react';
import { KycService, type DigilockerStatus } from './services/kycService';

/**
 * DigiLocker identity verification for a client.
 *
 * Unlike the KRA PAN-status lookup (a passive check we can run alone), this is
 * an active consent flow: the RM generates a link, the client opens it, signs
 * in to DigiLocker and shares their PAN/Aadhaar, and the verified identity comes
 * back here. So the control is "generate a link to send", then a status that
 * fills in once the client has consented.
 *
 * Renders nothing until it knows the feature is on.
 */
export function DigilockerCheck({ clientId }: { clientId: string }) {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<DigilockerStatus>({ status: 'none' });
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<'start' | 'refresh' | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    void KycService.digilockerEnabled().then(async (on) => {
      if (!alive || !on) return;
      const s = await KycService.digilockerStatus(clientId);
      if (!alive) return;
      setStatus(s);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [clientId]);

  if (!ready) return null;

  const start = async () => {
    setError('');
    setBusy('start');
    const r = await KycService.startDigilocker(clientId);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setLink(r.data.authorizationUrl);
  };

  const refresh = async () => {
    setBusy('refresh');
    setStatus(await KycService.digilockerStatus(clientId));
    setBusy(null);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* on screen to copy by hand */
    }
  };

  const verified = status.status === 'verified';

  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ background: verified ? 'rgba(34,197,94,0.1)' : 'var(--bg-elevated)' }}
          >
            {verified ? (
              <BadgeCheck className="w-4 h-4" style={{ color: 'var(--success)' }} />
            ) : (
              <ShieldQuestion className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              DigiLocker:{' '}
              <span style={{ color: verified ? 'var(--success)' : 'var(--text-muted)' }}>
                {verified ? 'Verified' : status.status === 'pending' ? 'Link sent — awaiting consent' : status.status === 'failed' ? 'Not completed' : 'Not verified'}
              </span>
            </p>
            {verified ? (
              <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                {status.name ?? '—'}
                {status.pan ? ` · ${status.pan}` : ''}
                {status.aadhaarMasked ? ` · Aadhaar ${status.aadhaarMasked}` : ''}
              </p>
            ) : (
              <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                Client signs in to DigiLocker and shares PAN &amp; Aadhaar.
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!verified && (
            <button
              type="button"
              onClick={start}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'var(--on-accent, #0b1220)' }}
            >
              {busy === 'start' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {link ? 'New link' : 'Generate link'}
            </button>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={busy !== null}
            title="Refresh status"
            className="rounded-lg p-1.5 disabled:opacity-50"
            style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          >
            {busy === 'refresh' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {verified && status.nameMatch === false && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--warning)' }}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> DigiLocker name differs from the name on file — check before relying on it.
        </p>
      )}

      {error && <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}

      {link && !verified && (
        <div className="mt-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <code className="min-w-0 flex-1 truncate text-[11px]" style={{ color: 'var(--text-primary)' }}>{link}</code>
          <button type="button" onClick={copy} className="shrink-0" style={{ color: copied ? 'var(--success)' : 'var(--text-faint)' }} aria-label="Copy link">
            <Copy className="w-3.5 h-3.5" />
          </button>
          <a href={link} target="_blank" rel="noopener noreferrer" className="shrink-0" style={{ color: 'var(--text-faint)' }} aria-label="Open link">
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      )}
      {link && !verified && (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>Send this link to the client. Refresh once they&apos;ve completed it.</p>
      )}
    </div>
  );
}
