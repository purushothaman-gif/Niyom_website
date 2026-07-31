/**
 * Systematic plans — the client's real registrations at BSE.
 *
 * Previously this rendered plausible mandates derived from holdings, which
 * meant a client could be shown a SIP they had never started. It now reads
 * BSE directly: the proxy scopes the request to their own UCC, so what appears
 * here is exactly what is registered in their name and nothing else.
 */
import { useEffect, useState } from 'react';
import { CalendarClock, Plus } from 'lucide-react';
import { bseGateway } from '../../services/bse/gateway';
import type { SystematicPlan } from '../../services/bse/contract';
import type { PortalView } from '../../layout/navigation';
import { Blank, Figure, MiniStat, Pill, PortalButton, ScreenHead, Tile } from '../../ui/kit';
import { inr, humanise, shortDate } from '../../../lib/money';

const FREQ: Record<string, string> = {
  m: 'Monthly',
  w: 'Weekly',
  d: 'Daily',
  f: 'Fortnightly',
  q: 'Quarterly',
  h: 'Half-yearly',
  y: 'Yearly',
};

export function SipPage({ onNavigate }: { onNavigate: (view: PortalView) => void }) {
  const [plans, setPlans] = useState<SystematicPlan[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    bseGateway()
      .getSystematicPlans()
      .then((p) => alive && setPlans(p))
      .catch((e) => {
        if (!alive) return;
        // Clients get plain language; the endpoint and status code go to the
        // console for us, not onto the screen of someone checking their SIPs.
        console.error('[portal] systematic plans failed', e);
        setError(true);
        setPlans([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const startCta = (
    <PortalButton variant="primary" icon={Plus} onClick={() => onNavigate('mutual-funds')}>
      Start a SIP
    </PortalButton>
  );

  if (plans === null) {
    return (
      <>
        <ScreenHead title="Systematic Plans" />
        <Tile>
          <p className="py-10 text-center text-sm text-text-faint">Loading your plans from BSE…</p>
        </Tile>
      </>
    );
  }

  const active = plans.filter((p) => p.status.toLowerCase() === 'active');
  // Only active plans actually collect — counting the unauthorised ones would
  // tell the client they are committing money they are not.
  const monthly = active
    .filter((p) => (p.frequency || '').toLowerCase() === 'm')
    .reduce((s, p) => s + p.amount, 0);
  const awaiting = plans.length - active.length;

  return (
    <>
      <ScreenHead
        title="Systematic Plans"
        subtitle="Your SIPs, STPs and SWPs as registered at BSE StAR MF."
        actions={plans.length > 0 ? startCta : undefined}
      />

      {error && (
        <Tile className="mb-5 border-warning/25 bg-warning/5">
          <p className="text-sm text-warning">
            We couldn’t load your plans just now. This is on our side, not yours — pull to refresh
            in a moment, or contact your relationship manager if it persists.
          </p>
        </Tile>
      )}

      {plans.length === 0 ? (
        <Tile flush>
          <Blank
            icon={CalendarClock}
            title="No systematic plans yet"
            body="A SIP invests a fixed amount every month automatically, so you don't have to time the market. Once you start one it appears here with its next debit date."
            action={startCta}
          />
        </Tile>
      ) : (
        <>
          <Tile className="mb-5">
            <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:items-end">
              <Figure label="Monthly commitment" value={inr(monthly)} size="lg" />
              <div className="grid grid-cols-3 gap-4">
                <MiniStat label="Active" value={String(active.length)} tone="positive" />
                <MiniStat label="Registered" value={String(plans.length)} />
                <MiniStat
                  label="Awaiting you"
                  value={String(awaiting)}
                  tone={awaiting > 0 ? 'negative' : 'default'}
                />
              </div>
            </div>
            {awaiting > 0 && (
              <p className="mt-4 border-t border-border-subtle pt-3 text-xs text-warning">
                {awaiting} plan{awaiting === 1 ? '' : 's'} still need your approval before the first
                instalment can be collected. Check your email for the approval link from BSE.
              </p>
            )}
          </Tile>

          <div className="grid gap-4 sm:grid-cols-2">
            {plans.map((p) => {
              const isActive = p.status.toLowerCase() === 'active';
              return (
                <Tile key={p.regNum}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm font-semibold text-text-primary">
                        {p.schemeName || p.schemeCode}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-text-faint">{p.regNum}</p>
                    </div>
                    <Pill tone={isActive ? 'success' : 'warning'}>{humanise(p.status)}</Pill>
                  </div>

                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div>
                      <p className="font-display text-2xl font-bold tabular-nums text-text-primary">
                        {inr(p.amount)}
                      </p>
                      <p className="text-[11px] text-text-secondary">
                        {FREQ[p.frequency] ?? p.frequency} · {p.type}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="flex items-center justify-end gap-1 text-[11px] text-text-faint">
                        <CalendarClock className="h-3 w-3" /> Started
                      </p>
                      <p className="text-sm font-semibold text-text-primary">
                        {shortDate(p.startDate)}
                      </p>
                    </div>
                  </div>
                </Tile>
              );
            })}
          </div>
        </>
      )}

      <p className="mt-5 px-1 text-[11px] leading-relaxed text-text-faint">
        To pause, modify or cancel a plan, contact your Niyom relationship manager.
      </p>
    </>
  );
}
