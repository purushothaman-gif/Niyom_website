import { ChevronRight, Hourglass, Loader2, Plus, Repeat, ShieldCheck, TrendingUp } from 'lucide-react';
import { fmt, fmtDate } from '../../../crm/utils';
import { PortalButton, Tile } from '../../ui/kit';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { LogoLoader } from '../../../components/LogoLoader';
import type { PortalView } from '../../layout/navigation';
import { useRtaMf } from '../../hooks/useRtaMf';
import type { MfLaunchState } from './useMfLaunch';

interface Props {
  clientId: string;
  state: MfLaunchState;
  onLaunch: () => void;
  onNavigate: (view: PortalView) => void;
}

/**
 * The Mutual Funds home. Funds are transacted on our MF platform, but the
 * client should feel they are inside their own account, not sent off to a
 * third-party site: their real holdings and running SIPs (from the registrar
 * feed) are shown here, and investing is a single in-place action that opens
 * the platform, pre-signed, only at the moment they choose to transact.
 */
export function MfLaunchPage({ clientId, state, onLaunch, onNavigate }: Props) {
  const { data, loading } = useRtaMf(clientId);
  const holdings = data?.holdings ?? [];
  const activeSips = data?.sips.filter((s) => s.status === 'active') ?? [];
  const hasData = !!data?.hasData;
  const busy = state === 'opening';

  // What the primary action is, and whether investing is possible right now.
  const gated = state === 'kyc_incomplete' || state === 'not_mapped' || state === 'not_available' || state === 'demo';
  const statusNote = STATUS_NOTE[state];

  const InvestCta = ({ full = false }: { full?: boolean }) => {
    if (state === 'kyc_incomplete') {
      return (
        <PortalButton variant="primary" onClick={() => onNavigate('onboarding')} full={full}>
          Complete KYC to invest
        </PortalButton>
      );
    }
    if (state === 'not_mapped') {
      return (
        <span className="inline-flex items-center gap-2 rounded-token-md border border-border px-4 py-2 text-xs font-medium text-text-secondary">
          <Hourglass className="h-3.5 w-3.5" /> Investing account being set up
        </span>
      );
    }
    if (state === 'not_available' || state === 'demo') return null;
    return (
      <PortalButton variant="primary" icon={busy ? Loader2 : Plus} onClick={onLaunch} disabled={busy} full={full}>
        {busy ? 'Opening…' : hasData ? 'Invest more' : 'Start investing'}
      </PortalButton>
    );
  };

  return (
    <div className="space-y-5">
      {/* Value header + invest */}
      <Tile>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-text-secondary">Mutual Funds</p>
            <p className="mt-1 font-display text-2xl font-bold text-text-primary">{fmt(data?.totalValue ?? 0)}</p>
            <p className="mt-1 text-[11px] text-text-faint">
              {data?.snapshotDate ? `Updated ${fmtDate(data.snapshotDate)}` : 'Your mutual fund holdings'}
            </p>
          </div>
          <div className="hidden sm:block"><InvestCta /></div>
        </div>
        {statusNote && (
          <p className={`mt-4 border-t border-border-subtle pt-3 text-xs ${statusNote.warn ? 'text-danger' : 'text-text-secondary'}`}>
            {state === 'opening' && <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />}
            {statusNote.text}
            {(state === 'opened' || state === 'blocked' || state === 'error') && (
              <button type="button" onClick={onLaunch} className="ml-1 font-semibold text-accent underline underline-offset-2">
                try again
              </button>
            )}
          </p>
        )}
        <div className="mt-4 sm:hidden"><InvestCta full /></div>
      </Tile>

      {loading && !data ? (
        <div className="flex min-h-[30vh] items-center justify-center"><LogoLoader size={40} /></div>
      ) : !hasData ? (
        <Card>
          <EmptyState
            icon={TrendingUp}
            title="Start your mutual fund journey"
            hint={gated ? 'Your holdings will appear here once you invest.' : 'Invest in handpicked funds and start a SIP — your holdings then appear here, updated daily.'}
          />
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            {holdings.map((h) => (
              <Card key={h.id} padding="md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-text-primary">{h.schemeName ?? h.schemeCode}</p>
                    <p className="mt-0.5 text-[11px] text-text-secondary">
                      Folio {h.folio} · {h.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })} units
                    </p>
                  </div>
                  <p className="flex-shrink-0 text-sm font-bold text-text-primary">{fmt(h.rtaValue ?? h.navValue ?? 0)}</p>
                </div>
              </Card>
            ))}
          </div>

          {activeSips.length > 0 && (
            <Card padding="md">
              <div className="mb-3 flex items-center gap-2">
                <Repeat className="h-4 w-4 text-accent" />
                <h3 className="text-sm font-bold text-text-primary">Running SIPs ({activeSips.length})</h3>
              </div>
              <div className="space-y-3">
                {activeSips.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 border-t border-border pt-3 first:border-0 first:pt-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-text-primary">{s.schemeName ?? s.schemeCode}</p>
                      <p className="text-[11px] text-text-secondary">{(s.type ?? 'SIP')} · {s.frequency ?? '—'}</p>
                    </div>
                    <p className="flex-shrink-0 text-sm font-semibold text-text-primary">{s.amount != null ? fmt(s.amount) : '—'}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {!gated && (
            <button
              type="button"
              onClick={onLaunch}
              disabled={busy}
              className="flex w-full items-center justify-between rounded-token-xl border border-border bg-bg-surface px-4 py-3.5 text-left hover:border-accent/40 disabled:opacity-60"
            >
              <span className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-token-lg bg-accent/10">
                  <Plus className="h-4 w-4 text-accent" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-text-primary">Invest or start a new SIP</span>
                  <span className="block text-[11px] text-text-secondary">Explore funds and transact securely</span>
                </span>
              </span>
              <ChevronRight className="h-4 w-4 text-text-secondary" />
            </button>
          )}
        </>
      )}

      <p className="flex items-center justify-center gap-1.5 pt-1 text-center text-[11px] text-text-faint">
        <ShieldCheck className="h-3 w-3" /> Holdings updated daily from the registrar · Investing is secured and signed in for you
      </p>
    </div>
  );
}

const STATUS_NOTE: Partial<Record<MfLaunchState, { text: string; warn?: boolean }>> = {
  opening: { text: 'Opening your investment account securely…' },
  opened: { text: 'Opened in a new tab.' },
  blocked: { text: 'Your browser blocked the new tab — allow pop-ups, then', warn: true },
  not_mapped: { text: 'Your investing account is being set up — your relationship manager will let you know when it’s ready.' },
  kyc_incomplete: { text: 'Verify your PAN to start investing.', warn: true },
  error: { text: 'We couldn’t open your investing account —', warn: true },
};
