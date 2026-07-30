/**
 * EnvBadge — states which BSE environment the console is talking to.
 *
 * The label is driven by the proxy's /health, never hardcoded: a badge that
 * says "Live" while pointed at the sandbox (or still says "Demo" after go-live)
 * is worse than no badge at all, especially on the money-moving screens.
 */
import { useEffect, useState } from 'react';
import { StatusPill } from '../../../portal/components/StatusPill';
import { bseEnvironment, type BseEnv } from '../../services/BseOpsService';

export function useBseEnv(): BseEnv | null {
  const [env, setEnv] = useState<BseEnv | null>(null);
  useEffect(() => {
    let alive = true;
    void bseEnvironment().then((e) => alive && setEnv(e));
    return () => {
      alive = false;
    };
  }, []);
  return env;
}

const LABEL: Record<BseEnv, string> = {
  demo: 'Live · Demo',
  prod: 'Live · Production',
  unknown: 'Environment unknown',
};

const TONE: Record<BseEnv, 'success' | 'warning' | 'muted'> = {
  // Demo is amber, not green: the data is live but no real money moves, and
  // that distinction should be visible at a glance.
  demo: 'warning',
  prod: 'success',
  unknown: 'muted',
};

export function EnvBadge({ env }: { env: BseEnv | null }) {
  if (!env) return null;
  return <StatusPill tone={TONE[env]}>{LABEL[env]}</StatusPill>;
}

/** One-line clarification for screens that place real orders. */
export function envNote(env: BseEnv | null): string {
  if (env === 'demo') return 'Orders go to BSE’s demo environment — no real money moves.';
  if (env === 'prod') return 'Orders are placed directly with BSE StAR MF — this is real money.';
  return 'Could not confirm which BSE environment is connected.';
}
