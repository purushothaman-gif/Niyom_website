import { coreFundName } from '../../../../shared/mf/fundEnrich';
import type { PortalHolding } from '../../types/cas';

/**
 * Does the client already hold this fund?
 *
 * Holdings arrive from registrar feeds and statements with free-text scheme
 * names and no AMFI code, so the match is on the normalised core name (plan and
 * option words stripped): holding "Axis Multicap Fund - Regular Growth" is the
 * catalog's "Axis Multicap Fund". Any plan/option of the fund counts as held.
 */
export function isFundHeld(fundName: string, holdings: PortalHolding[]): boolean {
  const core = coreFundName(fundName);
  if (!core) return false;
  return holdings.some(
    (h) =>
      h.product_type === 'mutual_fund' &&
      Number(h.current_value ?? 0) > 0 &&
      coreFundName(h.product_name ?? '') === core,
  );
}
