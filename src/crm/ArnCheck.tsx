import { useEffect, useState } from 'react';
import { AlertCircle, BadgeCheck, Loader2, Search, ShieldAlert } from 'lucide-react';
import { KycService, type ArnResult } from './services/kycService';

/**
 * Verify an AMFI ARN before onboarding a partner.
 *
 * A partner supplies an ARN; before granting them access an admin confirms it
 * is on the active AMFI register and NOT on an adverse (suspended/terminated)
 * list. "Not found" and "terminated" are very different answers, so this shows
 * the adverse-list hit in red rather than a bland failure.
 *
 * Stateless — nothing is stored. It hides itself unless the server can run the
 * check, so an admin is never shown a tool that only errors.
 */
export function ArnCheck() {
  const [enabled, setEnabled] = useState(false);
  const [arn, setArn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ArnResult | null>(null);

  useEffect(() => {
    let alive = true;
    void KycService.enabled().then((e) => alive && setEnabled(e));
    return () => {
      alive = false;
    };
  }, []);

  if (!enabled) return null;

  const valid = /^(ARN-)?[0-9]+$/.test(arn.trim().toUpperCase());

  const run = async () => {
    if (!valid) return;
    setError('');
    setResult(null);
    setBusy(true);
    const r = await KycService.verifyArn(arn.trim().toUpperCase());
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setResult(r.data);
  };

  return (
    <div className="rounded-2xl p-4 mb-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2 mb-1">
        <BadgeCheck className="w-4 h-4" style={{ color: 'var(--accent)' }} />
        <h3 className="text-sm font-bold text-text-primary">Verify a partner ARN</h3>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
        Check an AMFI Registration Number against the active register and the suspended/terminated list before onboarding.
      </p>
      <div className="flex items-center gap-2">
        <input
          value={arn}
          onChange={(e) => setArn(e.target.value.toUpperCase().replace(/[^0-9ARN-]/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          placeholder="ARN-123456"
          className="flex-1 px-3 py-2 rounded-xl text-sm text-text-primary outline-none font-mono"
          style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}
        />
        <button
          type="button"
          onClick={run}
          disabled={busy || !valid}
          className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold flex-shrink-0 disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'var(--on-accent, #0b1220)' }}
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          {busy ? 'Checking…' : 'Verify'}
        </button>
      </div>

      {error && <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}

      {result && (
        <div
          className="mt-3 rounded-xl p-3 flex items-start gap-2.5"
          style={
            result.negativeListHit
              ? { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }
              : result.verified
                ? { background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)' }
                : { background: 'var(--bg-raised)', border: '1px solid var(--border)' }
          }
        >
          {result.negativeListHit ? (
            <ShieldAlert className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--danger)' }} />
          ) : result.verified ? (
            <BadgeCheck className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--success)' }} />
          ) : (
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
          )}
          <div className="min-w-0 text-xs">
            <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              {result.negativeListHit
                ? `On the AMFI ${result.negativeList?.type?.replace(/_/g, ' ') ?? 'adverse'} list`
                : result.verified
                  ? 'Active and verified'
                  : `Not verified — ${result.registrationStatus.replace(/_/g, ' ').toLowerCase()}`}
            </p>
            <p className="mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {result.name ? `${result.name} · ` : ''}
              {result.euin ? `EUIN ${result.euin} · ` : ''}
              {result.registrationStatus}
              {result.validTill ? ` · valid till ${result.validTill}` : ''}
              {result.negativeList?.since ? ` · since ${result.negativeList.since}` : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
