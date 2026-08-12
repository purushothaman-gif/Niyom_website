/**
 * PaymentService — order payment boundary
 * -----------------------------------------------------------------------------
 * A purchase is placed first, then paid: BSE returns a payment link, and status
 * is polled until settled. This facade wraps both through the shared gateway
 * (mock now, proxy later) — matching BSE payment-link (fn '03') / status (fn '11').
 */
import { bseGateway } from './bse/gateway';
import type {
  PaymentLinkRequest,
  PaymentLinkResult,
  PaymentStatusResult,
} from './bse/contract';

export const PaymentService = {
  /** Get a payment link the client uses to fund a placed order. */
  getLink(req: PaymentLinkRequest): Promise<PaymentLinkResult> {
    return bseGateway().getPaymentLink(req);
  },

  /** Poll the payment status for an order. */
  getStatus(orderId: string): Promise<PaymentStatusResult> {
    return bseGateway().getPaymentStatus(orderId);
  },
};
