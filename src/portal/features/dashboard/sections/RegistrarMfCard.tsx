import { ChevronRight, ExternalLink, Repeat, TrendingUp } from 'lucide-react';
import { fmt } from '../../../../crm/utils';
import { Card } from '../../../components/Card';
import { SectionHeader } from '../../../components/SectionHeader';
import { EmptyState } from '../../../components/EmptyState';
import type { RtaMfData } from '../../../../../shared/mf/rtaMf';

/**
 * The client's mutual funds as the registrar (CAMS/KFintech) reports them,
 * shown right on the Dashboard so "what do I hold?" is answered without leaving
 * the page. This is the real holdings + running SIPs, refreshed daily.
 *
 * When mutual funds run on the external platform, "Open Mutual Funds" still
 * launches it for transacting — but the holdings themselves are shown here, so
 * the Dashboard no longer reads ₹0 for a client who clearly holds funds.
 */
interface Props {
  data: RtaMfData | null;
  loading: boolean;
  ssoOn: boolean;
  onOpen: () => void;
}

export function RegistrarMfCard({ data, loading, ssoOn, onOpen }: Props) {
  const hasData = !!data?.hasData;
  const activeSips = data?.sips.filter((s) => s.status === 'active') ?? [];
  const holdings = data?.holdings ?? [];
  const shown = holdings.slice(0, 4);

  const openBtn = (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-0.5 text-xs font-semibold text-accent hover:text-accent-soft"
    >
      {ssoOn ? (<><ExternalLink className="h-3.5 w-3.5" /> Open</>) : (<>View all <ChevronRight className="h-3.5 w-3.5" /></>)}
    </button>
  );

  return (
    <Card className="animate-fadeInUp animate-delay-200">
      <SectionHeader title="Mutual Funds" icon={TrendingUp} action={hasData || ssoOn ? openBtn : undefined} />

      {loading && !data ? (
        <div className="space-y-2">
          <div className="h-10 animate-pulse rounded-token-md bg-bg-surface" />
          <div className="h-10 animate-pulse rounded-token-md bg-bg-surface" />
        </div>
      ) : !hasData ? (
        <EmptyState
          icon={TrendingUp}
          title="No mutual fund holdings yet."
          hint="Funds you hold through us appear here, updated daily from the registrar."
          compact
        />
      ) : (
        <>
          <div className="mb-4 flex items-baseline justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-text-secondary">Value</p>
              <p className="mt-0.5 font-display text-lg font-bold text-text-primary">{fmt(data!.totalValue)}</p>
            </div>
            {activeSips.length > 0 && (
              <p className="flex items-center gap-1 text-[11px] font-medium text-text-secondary">
                <Repeat className="h-3.5 w-3.5 text-accent" /> {activeSips.length} active SIP{activeSips.length > 1 ? 's' : ''}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            {shown.map((h) => (
              <div key={h.id} className="flex items-center gap-3 rounded-token-md bg-bg-surface px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-text-primary">{h.schemeName ?? h.schemeCode}</p>
                  <p className="truncate text-[11px] text-text-secondary">
                    Folio {h.folio} · {h.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })} units
                  </p>
                </div>
                <p className="text-xs font-bold text-text-primary">{fmt(h.rtaValue ?? h.navValue ?? 0)}</p>
              </div>
            ))}
            {holdings.length > shown.length && (
              <button
                type="button"
                onClick={onOpen}
                className="w-full rounded-token-md px-3 py-2 text-left text-[11px] font-semibold text-accent hover:bg-bg-surface"
              >
                +{holdings.length - shown.length} more
              </button>
            )}
          </div>

          {ssoOn && (
            <button
              type="button"
              onClick={onOpen}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-token-md px-4 py-2.5 text-sm font-bold text-on-accent"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
            >
              <ExternalLink className="h-4 w-4" /> Open Mutual Funds
            </button>
          )}
        </>
      )}
    </Card>
  );
}
