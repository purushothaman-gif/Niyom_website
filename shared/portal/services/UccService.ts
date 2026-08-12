/**
 * UccService — client (UCC) registration boundary
 * -----------------------------------------------------------------------------
 * BSE requires every investor to hold a Unique Client Code (UCC) before any
 * order. This facade registers/queries UCCs through the same swappable gateway
 * as BSEService (mock now, proxy later). The Admin console's Client/UCC and KYC
 * modules build on this.
 */
import { bseGateway } from './bse/gateway';
import type { UccRegistrationRequest, UccRegistrationResult } from './bse/contract';

export const UccService = {
  /** Register a new BSE UCC for a client (returns the assigned code + status). */
  register(req: UccRegistrationRequest): Promise<UccRegistrationResult> {
    return bseGateway().registerUcc(req);
  },
};
