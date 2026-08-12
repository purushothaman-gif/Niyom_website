/**
 * MandateService — SIP mandate (NACH/eNACH) boundary
 * -----------------------------------------------------------------------------
 * A registered mandate is required before an XSIP can be placed. This facade
 * registers mandates through the shared gateway (mock now, proxy later).
 */
import { bseGateway } from './bse/gateway';
import type { MandateRegistrationRequest, MandateRegistrationResult } from './bse/contract';

export const MandateService = {
  /** Register a NACH/eNACH mandate; live mode returns an eNACH auth URL. */
  register(req: MandateRegistrationRequest): Promise<MandateRegistrationResult> {
    return bseGateway().registerMandate(req);
  },
};
