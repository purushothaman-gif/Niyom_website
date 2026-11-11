import { useState } from 'react';
import { Loader2, ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react';
import { KycService, type KycResult } from './services/kycService';

/**
 * KRA KYC status for a client, with a one-click check.
 *
 * Shows what we last learned from the KRA system (cached on the record) and a
 * button to refresh it. Deliberately separate from our own onboarding
 * verification_status: this is the registrar's verdict on whether the investor
 * is KYC-compliant at all, which an RM wants before chasing paperwork.
 *
 * The lookup queries the CVL KRA portal and can take up to a minute, so the
 * button states that rather than looking hung.
 */
const TONE: Record<string, { bg: string; fg: string; label: string }> = {
  ok: { bg: 'rgba(34,197,94,0.1)', fg: 'var(--success)', label: '' },
  warn: { bg: 'rgba(245,158,11,0.1)', fg: 'var(--warning)', label: '' },
  bad: { bg: 'rgba(239,68,68,0.1)', fg: 'var(--danger)', label: '' },
  none: { bg: 'var(--bg-raised)', fg: 'var(--text-muted)', label: '' },
};

function toneFor(status: string | null, compliant: boolean | null): keyof typeof TONE {
  if (status == null) return 'none';
  if (compliant) return 'ok';
  if (status === 'on_hold' || status === 'rejected') return 'bad';
  return 'warn';
}

const prettyStatus = (s: string): string =>
  s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function KycCheck({
  clientId,
  pan,
  initialStatus,
  initialCompliant,
  checkedAt,
}: {
  clientId: string;
  pan: string | null | undefined;
  initialStatus: string | null;
  initialCompliant: boolean | null;
  checkedAt: string | null;
}) {
  const [status, setStatus] = useState<string | null>(initialStatus);
  const [compliant, setCompliant] = useState<boolean | null>(initialCompliant);
  const [when, setWhen] = useState<string | null>(checkedAt);
  const [result, setResult] = useState<KycResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const validPan = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test((pan ?? '').trim().toUpperCase());

  const run = async () => {
    setError('');
    setBusy(true);
    const r = await KycService.checkPan(clientId);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setResult(r.data);
    setStatus(r.data.status);
    setCompliant(r.data.compliant);
    setWhen(new Date().toISOString());
  };

  const tone = TONE[toneFor(status, compliant)];
  const Icon = status == null ? ShieldQuestion : compliant ? ShieldCheck : ShieldAlert;
  const active = result?.activeKra ?? null;

  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: tone.bg }}>
            <Icon className="w-4 h-4" style={{ color: tone.fg }} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              KRA KYC:{' '}
              <span style={{ color: tone.fg }}>
                {status == null ? 'Not checked' : prettyStatus(status)}
              </span>
              {active ? <span style={{ color: 'var(--text-faint)' }}> · {active.toUpperCase()}</span> : null}
            </p>
            <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
              {when ? `Checked ${new Date(when).toLocaleDateString()}` : 'Across all 5 KRAs · takes up to a minute'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={busy || !validPan}
          title={!validPan ? 'A valid PAN is needed first' : undefined}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold flex-shrink-0 disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'var(--on-accent, #0b1220)' }}
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {busy ? 'Checking…' : when ? 'Re-check' : 'Check KYC'}
        </button>
      </div>

      {error && (
        <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>
      )}

      {result && result.status === 'on_hold' && (
        <p className="mt-2 text-[11px]" style={{ color: 'var(--warning)' }}>
          On hold{(() => {
            const a = result.activeKra ? result.kras[result.activeKra] : null;
            return a?.remarks ? ` — ${a.remarks}` : '';
          })()}
        </p>
      )}
    </div>
  );
}
