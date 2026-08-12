/**
 * Gateway resolver
 * -----------------------------------------------------------------------------
 * Picks the BseGateway implementation from runtime config. Defaults to `mock`
 * so the app is always demoable with zero backend. Flip to `live` only once the
 * NIYOM BSE proxy exists (see dossier §5/§7):
 *
 *   VITE_BSE_MODE=live
 *   VITE_BSE_PROXY_URL=https://<your-proxy>/bse
 */
import { mockGateway } from './mockGateway';
import { createLiveGateway } from './liveGateway';
import type { BseGateway, BseMode, BseProxyConfig } from './contract';
import { bseProxyBaseUrl, getEnv } from '../../../platform/env';

function readConfig(): BseProxyConfig {
  // Live by default. The proxy holds the BSE credentials, so nothing secret
  // depends on this; defaulting to mock only meant production silently showed
  // illustrative funds whenever the Vercel env var was missing.
  const mode: BseMode = getEnv().bseMode === 'mock' ? 'mock' : 'live';
  return { mode, baseUrl: bseProxyBaseUrl() };
}

let cached: BseGateway | null = null;

/** The active gateway (memoised). */
export function bseGateway(): BseGateway {
  if (cached) return cached;
  const cfg = readConfig();
  cached = cfg.mode === 'live' ? createLiveGateway(cfg.baseUrl) : mockGateway;
  return cached;
}

/** True while running against the illustrative mock (no real BSE). */
export function isBseMock(): boolean {
  return readConfig().mode !== 'live';
}
